/** 가져오기 분석: 경로 → 파일별 판정 미리보기. 파일을 복사하거나 바꾸지 않는다. 형식은 확장자로 나눈다(.nde = HDF5, .opd = core/opd 구조 읽기). */
import { stat } from 'node:fs/promises'
import { AppError, toApiError } from '@shared/errors'
import { sanitizeSpecimenId } from '@shared/ids'
import {
  IMPORT_VERDICTS,
  STORE_PATH_WARN_LENGTH,
  SUPPORTED_EXTENSIONS,
  UNSUPPORTED_EXTENSIONS,
  type FileMeta,
  type ImportItemPreview,
  type ImportPreview,
  type ImportVerdict,
  type NewPlanCandidate,
  type NormalizedSetup
} from '@shared/types'
import { localIso } from '../catalog'
import { normalizeSetup, openNde } from '../nde'
import { readImportOffsetWarnings } from '../nde/viewer'
import { readOpdFile } from '../opd'
import { opdFileMeta, opdImportWarnings, opdSetupText } from '../opd/meta'
import { normalizeOpd } from '../opd/normalize'
import { hashFile, plannedRelPath, scanInputPaths, toAbsolutePath, type InputFile } from '../storage'
import { checkAbort, makeEmitter, yieldToLoop, type Emit, type ImportContext } from './context'
import { itemIdOf, newPreviewId } from './ids'
import { buildNewPlans } from './planning'
import { folderSpecimenNote, suggestForItem } from './suggest'

function emptyItem(itemId: string, f: InputFile): ImportItemPreview {
  return {
    itemId,
    sourcePath: f.path,
    fileName: f.fileName,
    sizeBytes: f.sizeBytes,
    sha256: null,
    verdict: 'error',
    meta: null,
    setup: null,
    matchedPlanId: null,
    newPlanKey: null,
    nearestPlan: null,
    duplicateOf: null,
    suggestedSpecimenId: null,
    suggestedSpecimenSource: null,
    suggestedStateTag: null,
    suggestedRound: null,
    unsupportedReason: null,
    errorMessage: null,
    warnings: []
  }
}

/** 카탈로그 레코드의 사본이 저장소에 실제로 있고 크기가 맞는지 */
async function storedCopyIntact(storeRoot: string, relPath: string, sizeBytes: number): Promise<boolean> {
  try {
    const st = await stat(toAbsolutePath(storeRoot, relPath))
    return st.isFile() && st.size === sizeBytes
  } catch {
    return false
  }
}

/** 형식별 읽기 결과 (해시·크기·경로 제외 메타 + 정규화 셋업 + 셋업 원문) */
export interface ReadForImport {
  meta: Omit<FileMeta, 'sha256' | 'sizeBytes' | 'sourcePath' | 'sourceFileName'>
  setup: NormalizedSetup
  setupText: string
  /** 미리보기 항목에 보일 주의 (형식별) */
  itemWarnings: string[]
}

/** .nde 1개: 읽기 → 정규화 (원문 셋업은 버린다; 확정 때 검증된 사본에서 다시 읽는다) */
export async function readNde(path: string): Promise<{ meta: Omit<FileMeta, 'sha256' | 'sizeBytes' | 'sourcePath' | 'sourceFileName'>; setup: NormalizedSetup; setupText: string }> {
  const raw = await openNde(path)
  const setup = normalizeSetup(raw.setup, raw.version)
  return { meta: raw.meta, setup: { ...setup, warnings: [...raw.warnings, ...setup.warnings] }, setupText: raw.setupText }
}

/**
 * .opd 1개: 구조 읽기(core/opd) → 정규화. 구조 점검이 하나라도 맞지 않으면 '보류(해석 실패): …'(NDE_READ_ERROR) 로 던진다.
 * fileName 은 장비 저장 이름과 비교할 파일 이름(확장자 포함).
 */
export async function readOpd(path: string, fileName: string): Promise<ReadForImport> {
  const file = await readOpdFile(path)
  return { meta: opdFileMeta(file), setup: normalizeOpd(file), setupText: opdSetupText(file), itemWarnings: opdImportWarnings(file, fileName) }
}

/**
 * 확장자(소문자)별 읽기. 지원 확장자(SUPPORTED_EXTENSIONS)만.
 * NDE 4.x 는 분석 오프셋(X7)이 0 이 아니면 미리보기 항목에 경고 — 지문 (c) 가 분석 때 바꾼 위치로 계산되므로 확정 전에 알린다
 */
async function readForImport(f: InputFile): Promise<ReadForImport> {
  if (f.ext === '.opd') return readOpd(f.path, f.fileName)
  const nde = await readNde(f.path)
  return { ...nde, itemWarnings: nde.meta.ndeVersion.family === '4.x' ? await readImportOffsetWarnings(f.path) : [] }
}

interface Batch {
  ctx: ImportContext
  emit: Emit
  bySha: Map<string, string>
  /** 지문 → newPlanKey */
  newKeys: Map<string, string>
}

async function analyzeFile(item: ImportItemPreview, f: InputFile, b: Batch, index: number, total: number): Promise<void> {
  const { ctx, emit } = b
  emit('hash', index, total, { fileName: f.fileName, bytesDone: 0, bytesTotal: f.sizeBytes })
  const sha = await hashFile(f.path, {
    signal: ctx.signal,
    onBytes: (done, all) => emit('hash', index, total, { fileName: f.fileName, bytesDone: done, bytesTotal: all })
  })
  item.sha256 = sha

  const prior = b.bySha.get(sha)
  if (prior) {
    item.verdict = 'duplicate'
    item.duplicateOf = { inBatchItemId: prior }
    return
  }
  const existing = ctx.catalog.findFileBySha256(sha)
  if (existing) {
    item.duplicateOf = { fileId: existing.id, planId: existing.planId, specimenId: existing.specimenId, storedRelPath: existing.storedRelPath }
    // 사본이 지워졌거나 바뀌었으면 '이미 저장됨'이 사실이 아니다 → 복원 대상
    item.verdict = (await storedCopyIntact(ctx.storeRoot, existing.storedRelPath, existing.meta.sizeBytes)) ? 'duplicate' : 'missing-copy'
    if (item.verdict === 'missing-copy' && !b.bySha.has(sha)) b.bySha.set(sha, item.itemId)
    return
  }
  b.bySha.set(sha, item.itemId)

  emit('read', index, total, { fileName: f.fileName })
  const read = await readForImport(f)
  item.meta = { ...read.meta, sha256: sha, sizeBytes: f.sizeBytes, sourcePath: f.path, sourceFileName: f.fileName }
  item.setup = read.setup
  item.warnings.push(...read.itemWarnings)
  const s = suggestForItem(read.meta, f.fileName)
  item.suggestedSpecimenId = s.specimenId
  item.suggestedSpecimenSource = s.specimenSource
  item.suggestedStateTag = s.stateTag
  item.suggestedRound = s.round
  if (f.ext === '.opd') {
    // OPD 는 파일을 옮겨 담은 폴더가 시편과 어긋난 예가 있다 (PCN교육/TP06/tp07-root-l-01.opd = TP07)
    const note = folderSpecimenNote(f.path, s.specimenId)
    if (note) item.warnings.push(note)
  }

  emit('match', index, total, { fileName: f.fileName })
  const plan = ctx.catalog.findPlanByFingerprint(read.setup.fingerprint)
  if (plan) {
    item.verdict = 'match-existing'
    item.matchedPlanId = plan.id
    return
  }
  let key = b.newKeys.get(read.setup.fingerprint)
  if (!key) {
    key = `n${b.newKeys.size + 1}`
    b.newKeys.set(read.setup.fingerprint, key)
  }
  item.verdict = 'new-plan'
  item.newPlanKey = key
}

/** 제안 시편 ID 기준 저장 경로가 윈도우 경로 제한에 가까우면 경고 (시편 ID 를 고치면 달라진다) */
function warnLongPath(it: ImportItemPreview, storeRoot: string, planId: string): void {
  const specimen = sanitizeSpecimenId(it.suggestedSpecimenId ?? '') || 'X'
  try {
    const abs = toAbsolutePath(storeRoot, plannedRelPath(planId, specimen, it.fileName))
    if (abs.length > STORE_PATH_WARN_LENGTH) {
      it.warnings.push(`저장 경로가 ${abs.length}자로 깁니다. 윈도우 탐색기나 다른 프로그램이 열지 못할 수 있으니 저장소 위치나 시편 ID 를 짧게 하세요.`)
    }
  } catch {
    // 경로를 만들 수 없는 이름은 확정 때 오류로 보인다
  }
}

function countVerdicts(items: ImportItemPreview[]): Record<ImportVerdict, number> {
  const counts = Object.fromEntries(IMPORT_VERDICTS.map((v) => [v, 0])) as Record<ImportVerdict, number>
  for (const i of items) counts[i.verdict]++
  return counts
}

/**
 * 경로들 → 판정 미리보기.
 * 판정: 카탈로그에 같은 sha256 → duplicate, 같은 배치 앞 항목과 같은 sha256 → duplicate(inBatchItemId),
 * 지문이 기존 플랜과 같음 → match-existing, 아니면 new-plan(같은 지문끼리 newPlanKey 공유),
 * 미지원 확장자 → unsupported, 읽기 실패 → error (파일 단위로 격리).
 * 취소되면 AppError('CANCELLED').
 */
export async function analyzeImport(paths: string[], ctx: ImportContext): Promise<ImportPreview> {
  if (!Array.isArray(paths) || paths.length === 0) throw new AppError('INVALID_ARGUMENT', '가져올 파일이나 폴더를 고르세요.')
  const t0 = performance.now()
  const now = ctx.now ?? (() => new Date())
  const previewId = ctx.operationId ?? newPreviewId(now())
  const emit = makeEmitter(ctx, 'analyze', previewId)
  let total = 0
  try {
    emit('scan', 0, 0)
    const scan = await scanInputPaths(paths, { excludeDirs: [ctx.storeRoot], ...(ctx.signal ? { signal: ctx.signal } : {}) })
    const b: Batch = { ctx, emit, bySha: new Map(), newKeys: new Map() }
    const items: ImportItemPreview[] = []
    let ignoredCount = 0
    const relevant = scan.files.filter((f) => SUPPORTED_EXTENSIONS.includes(f.ext) || f.ext in UNSUPPORTED_EXTENSIONS)
    ignoredCount = scan.files.length - relevant.length
    total = relevant.length

    for (const [i, f] of relevant.entries()) {
      checkAbort(ctx.signal)
      const item = emptyItem(itemIdOf(i), f)
      items.push(item)
      if (!SUPPORTED_EXTENSIONS.includes(f.ext)) {
        item.verdict = 'unsupported'
        item.unsupportedReason = UNSUPPORTED_EXTENSIONS[f.ext] ?? '지원하지 않는 형식입니다.'
        continue
      }
      try {
        await analyzeFile(item, f, b, i, relevant.length)
      } catch (err) {
        if (err instanceof AppError && err.code === 'CANCELLED') throw err
        const e = toApiError(err)
        item.verdict = 'error'
        item.meta = null
        item.setup = null
        item.warnings = []
        item.errorMessage = e.message
      }
      await yieldToLoop()
    }
    checkAbort(ctx.signal)

    const newPlans: NewPlanCandidate[] = buildNewPlans(items, ctx)
    for (const it of items) {
      if (it.newPlanKey) it.nearestPlan = newPlans.find((n) => n.key === it.newPlanKey)?.nearestPlan ?? null
      const planId = it.matchedPlanId ?? newPlans.find((n) => n.key === it.newPlanKey)?.provisionalPlanId ?? null
      if (planId) warnLongPath(it, ctx.storeRoot, planId)
    }
    return {
      previewId,
      createdAt: localIso(now()),
      storeRoot: ctx.storeRoot,
      inputPaths: [...paths],
      items,
      newPlans,
      counts: countVerdicts(items),
      skippedHiddenCount: scan.skippedHiddenCount,
      ignoredCount: ignoredCount + scan.skippedLinkCount,
      skippedStoreCount: scan.skippedExcludedCount,
      unreadablePaths: scan.unreadablePaths,
      elapsedMs: Math.round(performance.now() - t0)
    }
  } finally {
    emit('done', total, total)
  }
}
