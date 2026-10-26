/**
 * 가져오기 확정: 새 플랜 생성 → 시편 ensure → 검증 복사 → 카탈로그 기록 → 배치 이력.
 * 원본은 읽기만 한다. 파일 단위로 실패를 격리하고, DB 기록이 실패하면 방금 만든 사본을 지워 DB 와 파일을 맞춘다.
 * (복사와 DB 기록 사이에 앱이 강제 종료되면 남는 사본은 다음 저장소 점검(storage/recovery)이 '미등록_파일'로 옮긴다)
 */
import { rm, rmdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { AppError, toApiError } from '@shared/errors'
import { sanitizeSpecimenId } from '@shared/ids'
import {
  isOpdMeta,
  type CommitItem,
  type ImportBatchStatus,
  type ImportCommitRequest,
  type ImportItemPreview,
  type ImportItemResult,
  type ImportPreview,
  type ImportResult,
  type PlanId,
  type SpecimenId
} from '@shared/types'
import { localIso, type ImportItemRecord, type NewPlanInput } from '../catalog'
import { normalizeSetup, openNde } from '../nde'
import { readOpdFile } from '../opd'
import { opdSetupText } from '../opd/meta'
import { normalizeOpd } from '../opd/normalize'
import { copyVerified, plannedRelPath, toAbsolutePath, toRelPath, withFsRetry } from '../storage'
import { isCancelled, makeEmitter, yieldToLoop, type Emit, type ImportContext } from './context'
import { newBatchId } from './ids'

type WithSha = ImportItemPreview & { sha256: string }

interface Work {
  kind: 'import' | 'restore'
  item: WithSha
  edit: CommitItem | null
  specimenId: SpecimenId
  planName: string | null
}

interface Run {
  ctx: ImportContext
  emit: Emit
  now: () => string
  batchId: string
  plansByKey: Map<string, PlanId>
  createdPlanIds: PlanId[]
  createdSpecimenIds: SpecimenId[]
}

const isImportable = (i: ImportItemPreview): boolean => i.verdict === 'match-existing' || i.verdict === 'new-plan'
const CANCELLED_MESSAGE = '가져오기를 취소해 건너뛰었습니다.'

function result(item: ImportItemPreview, status: ImportItemResult['status'], extra: Partial<ImportItemResult> = {}): ImportItemRecord {
  return {
    itemId: item.itemId,
    fileName: item.fileName,
    sourcePath: item.sourcePath,
    status,
    fileId: null,
    planId: null,
    specimenId: null,
    storedRelPath: null,
    errorMessage: null,
    ...extra
  }
}

/** 미리보기 판정만으로 정해지는 결과 (복사 대상이 아닌 항목). 같은 배치 중복은 기준 항목 결과를 본 뒤 정하므로 null */
function staticResult(item: ImportItemPreview, edit: CommitItem | undefined): ImportItemRecord | null {
  switch (item.verdict) {
    case 'duplicate':
      if (item.duplicateOf?.inBatchItemId) return null
      return result(item, 'skipped-duplicate', {
        fileId: item.duplicateOf?.fileId ?? null,
        planId: item.duplicateOf?.planId ?? null,
        specimenId: item.duplicateOf?.specimenId ?? null,
        storedRelPath: item.duplicateOf?.storedRelPath ?? null,
        errorMessage: `이미 있는 파일과 같습니다 (${item.duplicateOf?.storedRelPath ?? '저장소'})`
      })
    case 'unsupported':
      return result(item, 'skipped-unsupported', { errorMessage: item.unsupportedReason })
    case 'error':
      return result(item, 'failed', { errorMessage: `분석 실패: ${item.errorMessage ?? '알 수 없는 오류'}` })
    case 'missing-copy':
      if (edit && !edit.include) return result(item, 'skipped-excluded')
      if (!item.sha256 || !item.duplicateOf?.fileId) return result(item, 'failed', { errorMessage: '분석 정보가 없습니다. 다시 분석하세요.' })
      return null
    default:
      if (!edit || !edit.include) return result(item, 'skipped-excluded')
      if (!item.sha256 || !item.meta || !item.setup) return result(item, 'failed', { errorMessage: '분석 정보가 없습니다. 다시 분석하세요.' })
      return null
  }
}

/** 요청 검증. 문제가 있으면 아무것도 하지 않고 INVALID_ARGUMENT */
function planWork(preview: ImportPreview, req: ImportCommitRequest): { works: Work[]; statics: Map<string, ImportItemRecord>; inBatch: ImportItemPreview[] } {
  const edits = new Map((req.items ?? []).map((e) => [e.itemId, e]))
  const names = new Map((req.newPlans ?? []).map((n) => [n.key, (n.name ?? '').trim()]))
  const works: Work[] = []
  const statics = new Map<string, ImportItemRecord>()
  const inBatch: ImportItemPreview[] = []
  for (const item of preview.items) {
    const edit = edits.get(item.itemId)
    const fixed = staticResult(item, isImportable(item) || item.verdict === 'missing-copy' ? edit : undefined)
    if (fixed) {
      statics.set(item.itemId, fixed)
      continue
    }
    if (item.verdict === 'duplicate') {
      inBatch.push(item)
      continue
    }
    if (item.verdict === 'missing-copy') {
      works.push({ kind: 'restore', item: item as WithSha, edit: null, specimenId: item.duplicateOf?.specimenId ?? '', planName: null })
      continue
    }
    const specimenId = sanitizeSpecimenId(edit!.specimenId ?? '')
    if (!specimenId) throw new AppError('INVALID_ARGUMENT', `시편 ID 가 비어 있습니다: ${item.fileName}`)
    let planName: string | null = null
    if (item.verdict === 'new-plan') {
      const cand = preview.newPlans.find((n) => n.key === item.newPlanKey)
      if (!cand) throw new AppError('INVALID_ARGUMENT', `새 플랜 후보를 찾을 수 없습니다: ${item.fileName}`)
      planName = names.get(cand.key) || cand.suggestedName
    }
    works.push({ kind: 'import', item: item as WithSha, edit: edit!, specimenId, planName })
  }
  return { works, statics, inBatch }
}

/** 같은 배치 안 중복: 기준 항목이 실제로 저장됐는지에 따라 결과를 정한다 */
function inBatchResult(item: ImportItemPreview, preview: ImportPreview, done: Map<string, ImportItemRecord>): ImportItemRecord {
  const baseId = item.duplicateOf!.inBatchItemId!
  const base = done.get(baseId)
  const baseName = preview.items.find((x) => x.itemId === baseId)?.fileName ?? baseId
  if (base && (base.status === 'copied' || base.status === 'restored' || base.status === 'skipped-duplicate')) {
    return result(item, 'skipped-duplicate', {
      fileId: base.fileId,
      planId: base.planId,
      specimenId: base.specimenId,
      storedRelPath: base.storedRelPath,
      errorMessage: `같은 내용의 ${baseName} 으로 저장되었습니다${base.storedRelPath ? ` (${base.storedRelPath})` : ''}`
    })
  }
  if (base?.status === 'skipped-excluded') {
    return result(item, 'skipped-excluded', {
      errorMessage:
        base.errorMessage === CANCELLED_MESSAGE ? CANCELLED_MESSAGE : `같은 내용의 ${baseName} 을(를) 제외해 이 파일도 저장하지 않았습니다.`
    })
  }
  return result(item, 'failed', {
    errorMessage: `같은 내용의 ${baseName} 이(가) 저장되지 않아 이 파일도 저장하지 않았습니다. 원인을 해결한 뒤 다시 분석하세요.`
  })
}

/** 플랜 ID 정하기. 새 플랜이면 아직 만들지 않고 다음 ID 와 생성 입력을 돌려준다 (첫 파일 기록과 같은 트랜잭션에서 만든다) */
function resolvePlan(w: Work, run: Run): { planId: PlanId; create: NewPlanInput | null } {
  const { catalog } = run.ctx
  const setup = w.item.setup!
  if (w.item.verdict === 'match-existing') {
    const plan = (w.item.matchedPlanId ? catalog.getPlan(w.item.matchedPlanId) : null) ?? catalog.findPlanByFingerprint(setup.fingerprint)
    if (!plan) throw new AppError('NOT_FOUND', `스캔플랜 ${w.item.matchedPlanId ?? ''} 을(를) 찾을 수 없습니다.`)
    return { planId: plan.id, create: null }
  }
  const known = run.plansByKey.get(w.item.newPlanKey!) ?? catalog.findPlanByFingerprint(setup.fingerprint)?.id
  if (known) return { planId: known, create: null }
  const [next] = catalog.peekNextPlanIds(1)
  return {
    planId: next!,
    create: { fingerprint: setup.fingerprint, spec: setup.spec, summary: setup.summary, name: w.planName ?? setup.summary }
  }
}

/**
 * 검증된 사본을 다시 읽어 셋업 원문을 얻고, 분석 때 지문과 같은지 확인한다
 * (해시와 셋업 읽기 사이에 원본이 바뀌었다 돌아온 경우 등을 막는다). 읽지 못하면 오류.
 */
async function verifiedSetupText(copyPath: string, expectedFingerprint: string, format: 'nde' | 'opd'): Promise<string> {
  if (format === 'opd') {
    // OPD: 사본을 다시 구조 읽기 → 지문 비교. 원문은 우리가 읽은 구조 JSON (날 값 + 읽기 규칙 버전)
    const file = await readOpdFile(copyPath)
    const fp = normalizeOpd(file).fingerprint
    if (fp !== expectedFingerprint) {
      throw new AppError('HASH_MISMATCH', '복사한 파일의 셋업이 분석 때와 다릅니다. 다시 분석하세요.', `${fp} != ${expectedFingerprint}`)
    }
    return opdSetupText(file)
  }
  const raw = await openNde(copyPath)
  const fp = normalizeSetup(raw.setup, raw.version).fingerprint
  if (fp !== expectedFingerprint) {
    throw new AppError('HASH_MISMATCH', '복사한 파일의 셋업이 분석 때와 다릅니다. 다시 분석하세요.', `${fp} != ${expectedFingerprint}`)
  }
  if (!raw.setupText) throw new AppError('NDE_READ_ERROR', '복사한 파일에서 셋업 원문을 읽지 못했습니다.')
  return raw.setupText
}

async function commitOne(w: Work, run: Run, index: number, total: number): Promise<ImportItemRecord> {
  const { ctx } = run
  const { catalog } = ctx
  const { item } = w
  const dup = catalog.findFileBySha256(item.sha256)
  if (dup) return result(item, 'skipped-duplicate', { fileId: dup.id, planId: dup.planId, specimenId: dup.specimenId, storedRelPath: dup.storedRelPath, errorMessage: `이미 있는 파일과 같습니다 (${dup.storedRelPath})` })

  const known = catalog.getSpecimen(w.specimenId)
  const specimenId = known?.id ?? w.specimenId
  const { planId, create } = resolvePlan(w, run)
  const dest = toAbsolutePath(ctx.storeRoot, plannedRelPath(planId, specimenId, item.fileName))
  try {
    return await copyAndRecord(w, run, index, total, { planId, create, specimenId, known: !!known, dest })
  } catch (err) {
    await removeEmptyDirs(dest)
    throw err
  }
}

/** 사라진 사본 복원: 기존 레코드 자리로 다시 복사하고 (이름이 바뀌면) 레코드 경로를 고친다 */
async function restoreOne(w: Work, run: Run, index: number, total: number): Promise<ImportItemRecord> {
  const { ctx, emit } = run
  const { item } = w
  const existing = ctx.catalog.findFileBySha256(item.sha256)
  if (!existing) throw new AppError('NOT_FOUND', '복원할 카탈로그 기록이 없습니다. 다시 분석하세요.')
  const dest = toAbsolutePath(ctx.storeRoot, existing.storedRelPath)
  const progress = { fileName: item.fileName, bytesTotal: item.sizeBytes }
  const copy = await copyVerified(item.sourcePath, dest, item.sha256, {
    signal: ctx.signal,
    onBytes: (done) => emit('copy', index, total, { ...progress, bytesDone: done }),
    onVerifyBytes: (done) => emit('verify', index, total, { ...progress, bytesDone: done })
  })
  emit('catalog', index, total, { fileName: item.fileName })
  const rel = toRelPath(ctx.storeRoot, copy.destPath)
  if (rel !== existing.storedRelPath) {
    try {
      ctx.catalog.setFileStoredPath(existing.id, rel, basename(copy.destPath).normalize('NFC'))
    } catch (err) {
      if (!copy.reusedExisting) await withFsRetry(() => rm(copy.destPath, { force: true })).catch(() => undefined)
      throw err
    }
  }
  return result(item, 'restored', {
    fileId: existing.id,
    planId: existing.planId,
    specimenId: existing.specimenId,
    storedRelPath: rel,
    errorMessage: `저장소에 없던 사본을 다시 복사했습니다${rel !== existing.storedRelPath ? ` (새 이름: ${basename(rel)})` : ''}`
  })
}

/** 실패한 항목 때문에 새로 생긴 빈 시편·플랜 폴더 정리 (비어 있을 때만 지워진다) */
async function removeEmptyDirs(dest: string): Promise<void> {
  const specimenDir = dirname(dest)
  for (const dir of [specimenDir, dirname(specimenDir)]) {
    if (!(await rmdir(dir).then(() => true, () => false))) return
  }
}

interface Target {
  planId: PlanId
  create: NewPlanInput | null
  specimenId: SpecimenId
  known: boolean
  dest: string
}

async function copyAndRecord(w: Work, run: Run, index: number, total: number, t: Target): Promise<ImportItemRecord> {
  const { ctx, emit } = run
  const { catalog } = ctx
  const { item } = w
  const edit = w.edit!
  const { planId, create, specimenId, dest } = t
  const progress = { fileName: item.fileName, bytesTotal: item.sizeBytes }
  emit('copy', index, total, { ...progress, bytesDone: 0 })
  const copy = await copyVerified(item.sourcePath, dest, item.sha256, {
    signal: ctx.signal,
    onBytes: (done) => emit('copy', index, total, { ...progress, bytesDone: done }),
    onVerifyBytes: (done) => emit('verify', index, total, { ...progress, bytesDone: done })
  })

  emit('catalog', index, total, { fileName: item.fileName })
  try {
    const storedRelPath = toRelPath(ctx.storeRoot, copy.destPath)
    const setupText = await verifiedSetupText(copy.destPath, item.setup!.fingerprint, isOpdMeta(item.meta) ? 'opd' : 'nde')
    const ok = result(item, 'copied', { planId, specimenId, storedRelPath })
    const record = catalog.transaction(() => {
      if (create) {
        const plan = catalog.createPlan(create)
        if (plan.id !== planId) throw new AppError('INTERNAL', `플랜 ID 배정이 어긋났습니다 (${planId} ≠ ${plan.id}).`)
      }
      catalog.ensureSpecimen({ id: specimenId, displayName: edit.specimenDisplayName ?? specimenId, source: edit.specimenSource })
      const rec = catalog.insertFile(
        {
          planId,
          specimenId,
          storedRelPath,
          storedFileName: basename(copy.destPath).normalize('NFC'),
          meta: { ...item.meta!, sha256: copy.sha256, sizeBytes: copy.sizeBytes },
          stateTag: edit.stateTag,
          tags: edit.tags ?? [],
          round: edit.round,
          memo: edit.memo ?? '',
          acquisition: item.setup!.acquisition,
          importBatchId: run.batchId,
          importedAt: run.now()
        },
        setupText
      )
      // 항목 이력도 파일 기록과 같은 트랜잭션에 (중간에 끊겨도 이력과 파일이 어긋나지 않게)
      catalog.recordImportItem(run.batchId, { ...ok, fileId: rec.id })
      return rec
    })
    if (create) {
      run.plansByKey.set(item.newPlanKey!, planId)
      run.createdPlanIds.push(planId)
    }
    if (!t.known && !run.createdSpecimenIds.includes(specimenId)) run.createdSpecimenIds.push(specimenId)
    return { ...ok, fileId: record.id }
  } catch (err) {
    if (!copy.reusedExisting) await withFsRetry(() => rm(copy.destPath, { force: true })).catch(() => undefined)
    throw err
  }
}

function batchStatus(cancelled: boolean, copied: number, failed: number): ImportBatchStatus {
  if (cancelled) return 'cancelled'
  if (failed > 0) return copied > 0 ? 'partial' : 'failed'
  return 'completed'
}

/** 이력 기록 실패가 이미 끝난 복사 결과를 오류로 바꾸지 않게 한다 (못 닫은 배치는 다음 저장소 점검이 닫는다) */
function recordHistory(ctx: ImportContext, batchId: string, items: ImportItemRecord[], finish: Parameters<ImportContext['catalog']['finishImportBatch']>[0]): void {
  try {
    ctx.catalog.transaction(() => {
      for (const it of items) if (it.status !== 'copied') ctx.catalog.recordImportItem(batchId, it)
      ctx.catalog.finishImportBatch(finish)
    })
  } catch (err) {
    console.warn(`[import] 가져오기 이력을 기록하지 못했습니다 (${batchId}):`, err)
  }
}

export async function commitImport(preview: ImportPreview, req: ImportCommitRequest, ctx: ImportContext): Promise<ImportResult> {
  if (req.previewId !== preview.previewId) throw new AppError('INVALID_ARGUMENT', '미리보기 ID 가 맞지 않습니다.')
  if (resolve(preview.storeRoot) !== resolve(ctx.storeRoot)) {
    throw new AppError('PREVIEW_EXPIRED', '분석한 뒤 저장소 위치가 바뀌었습니다. 다시 분석하세요.')
  }
  const { works, statics, inBatch } = planWork(preview, req)
  const clock = ctx.now ?? (() => new Date())
  const run: Run = {
    ctx,
    emit: () => undefined,
    now: () => localIso(clock()),
    batchId: ctx.operationId ?? newBatchId(clock()),
    plansByKey: new Map(),
    createdPlanIds: [],
    createdSpecimenIds: []
  }
  run.emit = makeEmitter(ctx, 'commit', run.batchId)
  const startedAt = run.now()
  ctx.catalog.beginImportBatch({ batchId: run.batchId, inputPaths: preview.inputPaths, totalItems: preview.items.length, startedAt })

  const done = new Map<string, ImportItemRecord>(statics)
  let cancelled = false
  let totalBytes = 0
  try {
    for (const [i, w] of works.entries()) {
      if (cancelled || ctx.signal?.aborted) {
        cancelled = true
        done.set(w.item.itemId, result(w.item, 'skipped-excluded', { errorMessage: CANCELLED_MESSAGE }))
        continue
      }
      let r: ImportItemRecord
      try {
        r = w.kind === 'restore' ? await restoreOne(w, run, i, works.length) : await commitOne(w, run, i, works.length)
        if (r.status === 'copied' || r.status === 'restored') totalBytes += w.item.sizeBytes
      } catch (err) {
        if (isCancelled(err)) {
          cancelled = true
          r = result(w.item, 'skipped-excluded', { errorMessage: CANCELLED_MESSAGE })
        } else {
          r = result(w.item, 'failed', { errorMessage: toApiError(err).message })
        }
      }
      done.set(w.item.itemId, r)
      await yieldToLoop()
    }
  } finally {
    run.emit('done', works.length, works.length)
  }
  for (const item of inBatch) done.set(item.itemId, inBatchResult(item, preview, done))

  const items = preview.items.map((it) => done.get(it.itemId)!)
  const copiedCount = items.filter((x) => x.status === 'copied' || x.status === 'restored').length
  const failedCount = items.filter((x) => x.status === 'failed').length
  const skippedCount = items.length - copiedCount - failedCount
  const finishedAt = run.now()
  const status = batchStatus(cancelled, copiedCount, failedCount)
  recordHistory(ctx, run.batchId, items, {
    batchId: run.batchId,
    finishedAt,
    status,
    copiedCount,
    skippedCount,
    failedCount,
    createdPlanIds: run.createdPlanIds,
    totalBytes
  })
  return {
    batchId: run.batchId,
    status,
    startedAt,
    finishedAt,
    createdPlanIds: run.createdPlanIds,
    createdSpecimenIds: run.createdSpecimenIds,
    copiedCount,
    skippedCount,
    failedCount,
    items: items.map(({ sourcePath: _s, ...r }) => r)
  }
}
