/**
 * 학습 데이터 분할 · 내보내기 서비스 (core/service/labels.ts, 'labels:*' 2b 계약). Electron 없이.
 * 임시 저장소에 X3 실데이터 4개를 가져온 뒤(원본은 읽기만):
 *   라벨러·기록·검토 구간 저장 → 세트 고르기 미리보기(확정 > 대조 > 지정 블라인드, 2인 모드)
 *   → 시편 분할·시험 세트 잠금(확인·이유·기록, 다시 열어도 그대로) → 분할로 고른 내보내기 · 진행률 · 취소 · 동시 실행 BUSY.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openCatalog } from '@core/catalog'
import { saveLabelRecord } from '@core/labels'
import { createAppService, type AppService } from '@core/service'
import { DEFAULT_TRAINING_SET_RULE, type TrainingExportRequest } from '@shared/api'
import { newIndicationRecord, newReviewInterval } from '@shared/labels/factory'
import type { LabelSetKey, ReadingStage } from '@shared/labels/types'
import type { FileRecord, ImportCommitRequest, ImportPreview } from '@shared/types'
import { X3_FILES } from '../../paths'

const hasData = X3_FILES.every((f) => existsSync(f))
const work = mkdtempSync(join(tmpdir(), 'paut-train-svc-'))
const store = join(work, '저장소')
const outParent = join(work, '내보내기')
let s: AppService
let files: FileRecord[] = []

function acceptAll(p: ImportPreview): ImportCommitRequest {
  return {
    previewId: p.previewId,
    newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
    items: p.items
      .filter((i) => i.verdict === 'match-existing' || i.verdict === 'new-plan')
      .map((i) => ({
        itemId: i.itemId,
        include: true,
        specimenId: i.suggestedSpecimenId ?? 'X',
        specimenSource: i.suggestedSpecimenSource ?? 'manual',
        stateTag: i.suggestedStateTag,
        round: i.suggestedRound,
        memo: ''
      }))
  }
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'OK'
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

const byName = (n: string): FileRecord => files.find((f) => f.storedFileName === n)!
const F1 = '12T-SV-01-Cap on.nde'
const F2 = '12T-SV-02-Cap on.nde'
const F3 = '12T-SV-03-Cap off.nde'
const F4 = '12T-SV-04-Cap on.nde'

let seq = 0
async function addSet(file: string, labelerId: string, stage: ReadingStage, uStart: number): Promise<LabelSetKey> {
  const set: LabelSetKey = { sha256: byName(file).meta.sha256, labelerId, guidelineVersion: 'v1', readingStage: stage }
  const rec = newIndicationRecord({
    ...set,
    uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    defectType: 'lof-unspecified',
    derived: { scanStartMm: uStart, scanEndMm: uStart + 12, vMinMm: 3, vMaxMm: 8, depthTopMm: 2, depthBottomMm: 8 },
    length: { valueMm: 12, method: 'eval-level' }
  })
  const iv = newReviewInterval({ ...set, uuid: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`, kind: 'reviewed', scanStartMm: 0, scanEndMm: 300 })
  if (stage === 'final') {
    // 확정 세트는 서비스 saveRecord 가 받지 않는다(검수 saveFinal 로만) — 시험 준비는 저장소에 바로, 검수 출처를 붙여서
    const c = openCatalog(join(store, 'catalog.db'))
    try {
      const ctx = { pcId: 'pc-test', versionSlot: 'pc-test:r0001' }
      saveLabelRecord(c, { ...rec, adjudication: { format: 'paut-adjudication', rowId: 'P001', decision: 'a' } } as typeof rec, ctx)
      c.labels.saveReviewInterval(iv, ctx)
    } finally {
      c.close()
    }
    return set
  }
  await s.labels.saveRecord(rec)
  await s.labels.saveReview(iv)
  return set
}

beforeAll(async () => {
  if (!hasData) return
  mkdirSync(outParent)
  s = createAppService({ settingsPath: join(work, 'ud', 'settings.json') })
  await s.setStoreRoot(store)
  const r = await s.commit(acceptAll(await s.analyze(X3_FILES)))
  expect(r).toMatchObject({ copiedCount: 4, failedCount: 0 })
  files = (await s.listFiles({ limit: 100 })).items
  for (const [id, name] of [
    ['kim-l2', '김 판독'],
    ['lee-l2', '이 판독'],
    ['park-l3', '박 조정']
  ] as const) {
    await s.labels.registerLabeler({ id, name, qualification: null, organization: null })
  }
  await addSet(F1, 'kim-l2', 'blind', 128)
  await addSet(F1, 'park-l3', 'final', 128)
  await addSet(F2, 'kim-l2', 'blind', 214)
  await addSet(F3, 'kim-l2', 'blind', 140)
  await addSet(F3, 'lee-l2', 'blind', 141)
}, 120_000)

afterAll(() => {
  s?.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!hasData)('학습 데이터 서비스 (X3 실데이터)', () => {
  it('세트 고르기 미리보기: 확정 > 대조 > 지정 블라인드, 2인 모드면 지금 라벨러 세트만', async () => {
    const c0 = await s.labels.trainingCandidates(DEFAULT_TRAINING_SET_RULE)
    expect(c0.files.map((f) => f.fileName)).toEqual([F1, F2, F3]) // 라벨 없는 F4 는 없음
    const pick = (name: string, list = c0.files) => list.find((f) => f.fileName === name)!
    expect(pick(F1).chosen).toContain('|park-l3|v1|final')
    expect(pick(F1).candidates).toHaveLength(2)
    expect(pick(F2).chosen).toBeNull()
    expect(pick(F2).reason).toContain('라벨러를 지정')
    expect(pick(F1).hasFile).toBe(true)
    const c1 = await s.labels.trainingCandidates({ ...DEFAULT_TRAINING_SET_RULE, blindLabelerId: 'kim-l2' })
    expect(pick(F2, c1.files).chosen).toContain('|kim-l2|v1|blind')
    expect(pick(F3, c1.files).chosen).toContain('|kim-l2|v1|blind')
    const c2 = await s.labels.trainingCandidates({ stages: ['blind'], blindLabelerId: 'kim-l2', overrides: { [byName(F3).meta.sha256]: pick(F3).candidates.find((x) => x.labelerId === 'lee-l2')!.setId } })
    expect(pick(F1, c2.files).chosen).toContain('|kim-l2|v1|blind')
    expect(pick(F3, c2.files).chosen).toContain('|lee-l2|')
    // 2인 모드: lee 로 고르면 lee 세트만 후보
    await s.labels.setSession({ labelerId: 'lee-l2', blindMode: true })
    const c3 = await s.labels.trainingCandidates({ stages: ['final', 'blind'], blindLabelerId: 'lee-l2' })
    expect(c3.blindModeLabelerId).toBe('lee-l2')
    expect(c3.files.map((f) => f.fileName)).toEqual([F3])
    expect(c3.files[0]!.candidates.map((x) => x.labelerId)).toEqual(['lee-l2'])
    await s.labels.setSession({ blindMode: false, labelerId: 'park-l3' })
  })

  it('분할: 시편 표 · 잠금 · 확인과 이유 · 기록 · 다시 열어도 그대로', async () => {
    const v0 = await s.labels.trainingSplits()
    expect(v0.specimens).toHaveLength(4)
    expect(v0.counts).toEqual({ train: 0, val: 0, test: 0, unassigned: 4 })
    const sp = (n: string): string => byName(n).specimenId
    const row = v0.specimens.find((x) => x.specimenId === sp(F1))!
    expect(row).toMatchObject({ fileCount: 1, labeledFileCount: 1, defectCount: 1, split: null })
    expect(v0.specimens.find((x) => x.specimenId === sp(F4))!.labeledFileCount).toBe(0)

    const v1 = await s.labels.setTrainingSplits([
      { specimenId: sp(F1), split: 'train' },
      { specimenId: sp(F2).toLowerCase(), split: 'test' },
      { specimenId: sp(F3), split: 'val' }
    ])
    expect(v1.counts).toEqual({ train: 1, val: 1, test: 1, unassigned: 1 })
    expect(v1.specimens.find((x) => x.specimenId === sp(F2))!.split).toBe('test')

    const v2 = await s.labels.lockTrainingTest(true)
    expect(v2.testLocked).toBe(true)
    expect(v2.testLockedBy).toBe('park-l3')
    expect(await code(s.labels.setTrainingSplits([{ specimenId: sp(F2), split: 'train' }]))).toBe('CONFLICT')
    expect(await code(s.labels.setTrainingSplits([{ specimenId: sp(F4), split: 'test' }], { confirmLocked: true }))).toBe('CONFLICT')
    expect((await s.labels.trainingSplits()).specimens.find((x) => x.specimenId === sp(F2))!.split).toBe('test')
    // train ↔ val 은 그대로 된다
    await s.labels.setTrainingSplits([{ specimenId: sp(F3), split: 'train' }])
    const v3 = await s.labels.setTrainingSplits([{ specimenId: sp(F4), split: 'test' }], { confirmLocked: true, reason: '정상 용접부 시편을 시험에 추가' })
    expect(v3.log[0]).toMatchObject({ action: 'locked-change', specimenId: sp(F4), from: null, to: 'test', reason: '정상 용접부 시편을 시험에 추가', labelerId: 'park-l3' })
    expect(await code(s.labels.lockTrainingTest(false))).toBe('CONFLICT')

    // 저장소를 다시 열어도 (새 서비스) 그대로
    const again = createAppService({ settingsPath: join(work, 'ud', 'settings.json') })
    const v4 = await again.labels.trainingSplits()
    again.close()
    expect(v4.testLocked).toBe(true)
    expect(v4.counts).toEqual({ train: 2, val: 0, test: 2, unassigned: 0 })
    expect(v4.log.map((e) => e.action)).toEqual(['locked-change', 'assign', 'lock', 'assign', 'assign', 'assign'])
    const cands = await s.labels.trainingCandidates(DEFAULT_TRAINING_SET_RULE)
    expect(cands.files.find((f) => f.fileName === F1)!.split).toBe('train')
  })

  it('분할로 고른 내보내기: train 만, 진행률, 새 폴더', async () => {
    const req: TrainingExportRequest = {
      splits: ['train'],
      setRule: { ...DEFAULT_TRAINING_SET_RULE, blindLabelerId: 'kim-l2' },
      options: { amplitude: false, images: false, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep', fixedExportedAt: '2026-10-06T12:00:00+09:00' }
    }
    expect(s.labels.trainingStatus()).toBeNull()
    const p = s.labels.exportTraining(req, outParent, '0.1.0-test')
    const st = s.labels.trainingStatus()
    expect(st).not.toBeNull()
    expect(st!.operationId).toMatch(/^TX-/)
    // 동시에 두 번은 BUSY
    expect(await code(s.labels.exportTraining(req, outParent, '0.1.0-test'))).toBe('BUSY')
    const r = await p
    expect(s.labels.trainingStatus()).toBeNull()
    expect(r.folderName.startsWith('학습데이터_')).toBe(true)
    expect(r.path).toBe(join(outParent, r.folderName))
    // train = F1(확정 park) · F3(kim 블라인드). F2(test)·F4(test) 는 없음
    expect(r.files.map((f) => [f.fileName, f.status])).toEqual([
      [F1, 'exported'],
      [F3, 'exported']
    ])
    const m = JSON.parse(readFileSync(join(r.path, 'manifest.json'), 'utf8'))
    expect(m.exportedAt).toBe('2026-10-06T12:00:00+09:00')
    expect(m.split).toMatchObject({ unit: 'specimen', testLocked: true })
    expect(m.files.map((f: { readingStage: string }) => f.readingStage)).toEqual(['final', 'blind'])
    expect(m.files.every((f: { split: string }) => f.split === 'train')).toBe(true)
    expect(m.setRule).toEqual({ stages: ['final', 'reconciled', 'blind'], blindLabelerId: 'kim-l2', testFinalOnly: true })
    // 같은 시각에 한 번 더 → 새 이름 (덮어쓰지 않음)
    const r2 = await s.labels.exportTraining({ ...req, sha256s: [byName(F1).meta.sha256], splits: undefined }, outParent, '0.1.0-test')
    expect(r2.path).not.toBe(r.path)
    expect(r2.files.map((f) => f.fileName)).toEqual([F1])
  }, 120_000)

  it('취소 → CANCELLED, 폴더 남지 않음 · 잘못된 요청', async () => {
    const req: TrainingExportRequest = {
      sha256s: [byName(F1).meta.sha256, byName(F3).meta.sha256],
      setRule: { ...DEFAULT_TRAINING_SET_RULE, blindLabelerId: 'kim-l2' },
      options: { amplitude: true, images: true, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep' }
    }
    const before = new Set(readdirSync(outParent))
    const p = s.labels.exportTraining(req, outParent, 't')
    const id = s.labels.trainingStatus()!.operationId
    expect(s.labels.cancelTraining('TX-다른것')).toBe(false)
    // 그림 단계까지 기다렸다가 취소
    for (let i = 0; i < 400 && s.labels.trainingStatus()?.phase !== 'images'; i++) await new Promise((r) => setTimeout(r, 25))
    expect(s.labels.cancelTraining(id)).toBe(true)
    expect(s.labels.trainingStatus()?.cancelling).toBe(true)
    expect(await code(p)).toBe('CANCELLED')
    expect(new Set(readdirSync(outParent))).toEqual(before)
    expect(s.labels.trainingStatus()).toBeNull()

    expect(await code(s.labels.exportTraining({ setRule: DEFAULT_TRAINING_SET_RULE, options: req.options }, outParent, 't'))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.exportTraining({ ...req, splits: ['val'], sha256s: undefined }, outParent, 't'))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.exportTraining(req, join(work, '없는폴더'), 't'))).toBe('NOT_FOUND')
    expect(await code(s.labels.exportTraining({ ...req, options: { ...req.options, mmPerPx: 9 } }, outParent, 't'))).toBe('INVALID_ARGUMENT')
  }, 120_000)
})
