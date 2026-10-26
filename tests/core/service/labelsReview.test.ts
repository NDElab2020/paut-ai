/**
 * 3단계 검수 서비스 E2E (core 서비스만, 'labels:reviewSources · compareSets · previewFinal · saveFinal · saveReviewCsv').
 * 임시 저장소에 X3 실데이터 4개를 가져온 뒤(원본은 읽기만):
 *   엑셀 픽스처 kim-l2 블라인드 + 테스트가 만든 lee-l2 블라인드 엑셀 + 대조용 픽스처(물리 결함 11건)
 *   → 검수 목록 → 2인 모드에서 막힘 → 두 세트 비교(행·지문) → Level III 결정·설계값 대조 미리보기
 *   → 확정 세트 저장(Level III 확인 · 한 트랜잭션 · 원래 두 세트 그대로) → 같은 결정 다시 저장은 그대로
 *   → 결정을 바꾸면 빠진 확정 기록 지움 표시 → 잠긴 시험 세트는 이유와 확인 → 그사이 기록이 바뀌면 CONFLICT
 *   → 학습 데이터 세트 고르기 규칙이 확정 세트를 고름 → CSV 세 가지.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAppService, type AppService } from '@core/service'
import { DEFAULT_TRAINING_SET_RULE, isLevel3Qualification, type ReviewCompareRequest, type ReviewComparison, type ReviewFinalRequest } from '@shared/api'
import { LABEL_SHEETS, columnsOf, sheetHeaders, type LabelSheetId } from '@shared/labels'
import type { AdjudicationDecision } from '@shared/labels/review'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { X3_FILES } from '../../paths'
import { buildXlsx, fixture, type KitCell } from '../labels/xlsxKit'

const hasData = X3_FILES.every((f) => existsSync(f))
const work = mkdtempSync(join(tmpdir(), 'paut-review-svc-'))
const store = join(work, '저장소')
let s: AppService

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

type Rows = Partial<Record<LabelSheetId, Array<Record<string, KitCell>>>>

/** columns.ts 머리글로 양식 모양 엑셀을 만들어 파일로 쓴다 */
function writeWorkbook(name: string, rows: Rows): string {
  const buf = buildXlsx(
    LABEL_SHEETS.map((sh) => {
      const keys = columnsOf(sh.id).map((c) => c.key)
      return { name: sh.name, rows: [sheetHeaders(sh.id) as KitCell[], ...(rows[sh.id] ?? []).map((r) => keys.map((k) => r[k] ?? null))] }
    })
  )
  const path = join(work, name)
  writeFileSync(path, buf)
  return path
}

const F1 = '12T-SV-01-Cap on.nde'
const F2 = '12T-SV-02-Cap on.nde'
const F3 = '12T-SV-03-Cap off.nde'
const F4 = '12T-SV-04-Cap on.nde'
const S90 = '섹토리얼 Skew 90'
const S270 = '섹토리얼 Skew 270'

/**
 * 두 번째 판독자 lee-l2 (블라인드). kim 픽스처와 견줘:
 * F1 토우 균열 33~47(깊이·길이·높이 조금 다름) · F1 측벽 융합불량 같음 · F2 루트 균열 길이 23·높이 3.5 ·
 * F3 용입불량 없음(→ A 만) · F4 기공을 슬래그로(종류 다름) · F4 100~110 중앙 균열 더함(→ B 만). 검토 완료는 네 파일 모두.
 */
const LEE: Rows = {
  reader: [{ labelerId: 'lee-l2', readingStage: '블라인드 (설계값 안 봄)', qualification: 'UT Level II' }],
  indication: [
    { fileName: F1, externalRef: 'L1', kind: '결함', group: S90, scanStartMm: 33, scanEndMm: 47, depthTopMm: 0.8, depthBottomMm: 3.4, maxAmplitudePct: 90, defectType: '균열 (토우)', character: '면상', lengthMm: 14, lengthMethod: '평가 기준 초과 구간 (t≥8)', heightMethod: '상하 팁', heightMm: 3, existenceConfidence: '확실' },
    { fileName: F1, externalRef: 'L2', kind: '결함', group: S270, scanStartMm: 126, scanEndMm: 144, depthTopMm: 5.2, depthBottomMm: 8.1, maxAmplitudePct: 200, saturated: '예', defectType: '융합불량 (측벽)', character: '면상', lengthMm: 18, lengthMethod: '평가 기준 초과 구간 (t≥8)', heightMethod: '측정 불가', existenceConfidence: '확실' },
    { fileName: F2, externalRef: 'L3', kind: '결함', group: S90, scanStartMm: 149, scanEndMm: 170, depthTopMm: 9.5, depthBottomMm: 12, maxAmplitudePct: 120, defectType: '균열 (루트)', lengthMm: 23, lengthMethod: '평가 기준 초과 구간 (t≥8)', heightMethod: '팁 + 표면', heightMm: 3.5, existenceConfidence: '확실' },
    { fileName: F4, externalRef: 'L4', kind: '결함', group: S90, scanStartMm: 214, scanEndMm: 226, depthTopMm: 6, depthBottomMm: 8, maxAmplitudePct: 45, defectType: '슬래그', existenceConfidence: '보통' },
    { fileName: F4, externalRef: 'L5', kind: '결함', group: S270, scanStartMm: 100, scanEndMm: 110, depthTopMm: 7, depthBottomMm: 9, maxAmplitudePct: 70, defectType: '균열 (중앙)', existenceConfidence: '보통' }
  ],
  review: [F1, F2, F3, F4].map((fileName) => ({ fileName, kind: '검토 완료', scanStartMm: 0, scanEndMm: 300 }))
}

const KIM = { labelerId: 'kim-l2', readingStage: 'blind' as const, guidelineVersion: 'v1' }
const LEE_KEY = { labelerId: 'lee-l2', readingStage: 'blind' as const, guidelineVersion: 'v1' }

let shas: Record<string, string> = {}
let cmpReq: ReviewCompareRequest
let cmp: ReviewComparison

/** 행마다 기본 결정: 짝 = A, A 만 = A, B 만 = 결함 아님, 참고 단위만 = 보류 */
function decide(c: ReviewComparison, over: Record<string, AdjudicationDecision> = {}): AdjudicationDecision[] {
  return c.comparison.rows.map((r) => {
    if (over[r.id]) return over[r.id]!
    if (r.kind === 'pair') return { rowId: r.id, choice: 'a' }
    if (r.kind === 'only-a') return { rowId: r.id, choice: r.counted ? 'a' : 'defer' }
    return { rowId: r.id, choice: 'neither' }
  })
}

function finalReq(c: ReviewComparison, decisions: AdjudicationDecision[]): ReviewFinalRequest {
  return { compare: c.request, rowsKey: c.rowsKey, decisions, design: { minTier: 'any' } }
}

const rowAt = (c: ReviewComparison, file: string, startMm: number) =>
  c.comparison.rows.find((r) => (r.a ?? r.b)!.fileNames.includes(file) && Math.abs(((r.a ?? r.b)!.item.scanStartMm) - startMm) < 2)!

beforeAll(async () => {
  if (!hasData) return
  s = createAppService({ settingsPath: join(work, 'ud', 'settings.json') })
  await s.setStoreRoot(store)
  const r = await s.commit(acceptAll(await s.analyze(X3_FILES)))
  expect(r).toMatchObject({ copiedCount: 4, failedCount: 0 })
  const files = (await s.listFiles({ limit: 100 })).items
  shas = Object.fromEntries(files.map((f) => [f.storedFileName, f.meta.sha256]))
  for (const path of [fixture('x3_blind_kim.xlsx'), writeWorkbook('lee_blind.xlsx', LEE), fixture('x3_reconciled_kim.xlsx')]) {
    const pv = await s.labels.previewWorkbook(path)
    expect(pv.errors, path).toEqual([])
    await s.labels.commitWorkbook(pv.previewId)
  }
  await s.labels.registerLabeler({ id: 'park-l3', name: '박 조정', qualification: 'PAUT Level III', organization: '○○검사' })
  cmpReq = { sha256s: [F1, F2, F3, F4].map((n) => shas[n]!), a: KIM, b: LEE_KEY }
}, 180_000)

afterAll(() => {
  s?.close()
  rmSync(work, { recursive: true, force: true })
})

describe('Level III 자격 글자', () => {
  it('Level III 만 참', () => {
    for (const q of ['UT Level III', 'PAUT Level 3', 'level iii', 'L3', 'UT3', 'ISO 9712 Level 3', '3급']) expect(isLevel3Qualification(q), q).toBe(true)
    for (const q of [null, '', 'UT Level II', 'Level 2', 'L2', 'Level 30', '13급', 'kim']) expect(isLevel3Qualification(q), String(q)).toBe(false)
  })
})

describe.skipIf(!hasData)('검수 서비스 (X3 실데이터 · 엑셀 픽스처 두 라벨러)', () => {
  it('검수 목록: 파일 4개 · 세트 · 물리 결함 · 지금 라벨러', async () => {
    await s.labels.setSession({ labelerId: 'kim-l2' })
    const src = await s.labels.reviewSources()
    expect(src.blocked).toBeNull()
    expect(src.files.map((f) => f.fileName)).toEqual([F1, F2, F3, F4])
    const f1 = src.files[0]!
    expect(f1.sets.map((x) => `${x.labelerId}|${x.readingStage}`).sort()).toEqual(['kim-l2|blind', 'kim-l2|reconciled', 'lee-l2|blind'])
    expect(f1.fileId).not.toBeNull()
    expect(src.physicalDefects).toBe(11)
    expect(src.adjudicator?.id).toBe('kim-l2')
    expect(src.adjudicatorIsLevel3).toBe(false)
  })

  it('2인 독립 모드에서는 검수를 막고 이유를 알린다 (목록도 비움)', async () => {
    await s.labels.setSession({ blindMode: true })
    const src = await s.labels.reviewSources()
    expect(src.blocked).toContain('2인 독립 모드')
    expect(src.files).toEqual([])
    expect(await code(s.labels.compareSets(cmpReq))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.reviewCsvFileName({ kind: 'comparison', compare: cmpReq }))).toBe('INVALID_ARGUMENT')
    await s.labels.setSession({ blindMode: false })
  })

  it('두 세트 비교: 짝 · A 만 · B 만, mm 차이, 종류, 검토 범위 밖 따로, 같은 입력이면 같은 지문', async () => {
    expect(await code(s.labels.compareSets({ ...cmpReq, b: KIM }))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.compareSets({ ...cmpReq, sha256s: ['zz'] }))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.compareSets({ ...cmpReq, b: { ...LEE_KEY, labelerId: '없는' } }))).toBe('INVALID_ARGUMENT')
    cmp = await s.labels.compareSets(cmpReq)
    const c = cmp.comparison
    expect(cmp.request.options).toMatchObject({ purpose: 'inter-reader', unit: 'grouping', frame: 'file', scanGapMm: 10, depthDiffMm: 5, gradingUnitMm: 20 })
    expect(c.name).toBe('사람 간 일치도')
    expect(cmp.files.map((f) => [f.fileName, f.hasA, f.hasB])).toEqual([
      [F1, true, true],
      [F2, true, true],
      [F3, true, true],
      [F4, true, true]
    ])
    // F1 토우 균열: 짝, 스캔 중심 차 = (33+47)/2 − (30+46)/2 = 2, 길이 14 − 16
    const toe = rowAt(cmp, F1, 30)
    expect(toe.kind).toBe('pair')
    expect(toe.diff.scanCenter).toBeCloseTo(2, 6)
    expect(toe.diff.length).toBeCloseTo(-2, 6)
    expect(toe.agreement?.type.agree).toBe(true)
    // F4 기공 ↔ 슬래그: 짝, 종류 다름
    const f4 = rowAt(cmp, F4, 214)
    expect(f4.kind).toBe('pair')
    expect(f4.agreement?.type.agree).toBe(false)
    // F3 용입불량: A 만 (kim 은 F3 검토 완료가 없어 두 쪽 교집합 밖 → 따로)
    const f3 = rowAt(cmp, F3, 140)
    expect(f3).toMatchObject({ kind: 'only-a', outcome: 'outside-coverage' })
    // F4 100~110 중앙 균열: B 만, 검토 범위 안 → 'B 만 봄'
    expect(rowAt(cmp, F4, 100)).toMatchObject({ kind: 'only-b', outcome: 'b-only' })
    expect(c.summary.outside.rowIds).toContain(f3.id)
    expect(c.summary.detection.f1).not.toBeNull()
    expect(c.summary.errors.scanCenter.n).toBeGreaterThanOrEqual(3)
    expect(cmp.rowsKey).toMatch(/^[0-9a-f]{32}$/)
    expect((await s.labels.compareSets(cmpReq)).rowsKey).toBe(cmp.rowsKey)
    const loose = await s.labels.compareSets({ ...cmpReq, options: { scanGapMm: 30 } })
    expect(loose.rowsKey).not.toBe(cmp.rowsKey)
  })

  it('확정 미리보기: 결정하지 않은 행이 있으면 저장할 수 없고, 다 고르면 설계값 대조까지', async () => {
    const partial = await s.labels.previewFinal(finalReq(cmp, []))
    expect(partial.canSave).toBe(false)
    expect(partial.blockers[0]).toContain('결정하지 않은 행')
    expect(partial.result.undecided).toHaveLength(cmp.comparison.rows.length)
    const merge = rowAt(cmp, F2, 149)
    const p = await s.labels.previewFinal(finalReq(cmp, decide(cmp, { [merge.id]: { rowId: merge.id, choice: 'merge', fields: { length: 'b', height: 'b' }, note: '길이는 B' } })))
    expect(p.canSave).toBe(true)
    expect(p.adjudicator?.id).toBe('kim-l2')
    expect(p.adjudicatorIsLevel3).toBe(false)
    expect(p.adjudicatorIsReader).toBe(true)
    expect(p.guidelineVersion).toBe('v1')
    expect(p.previousRecords).toBe(0)
    expect(p.designDefects).toBe(11)
    expect(p.result.designCheck?.minTier).toBe('any')
    expect(p.result.designCheck!.rows.length).toBeGreaterThan(0)
    expect(p.result.records.every((r) => r.readingStage === 'final' && r.labelerId === 'kim-l2')).toBe(true)
    const merged = p.result.records.find((r) => r.adjudication.rowId === merge.id)!
    expect(merged.length.valueMm).toBe(23)
    expect(merged.height.valueMm).toBe(3.5)
    expect(merged.note).toContain('Level III: 길이는 B')
    // B 만 '결함 아님' 은 기록을 만들지 않는다
    expect(p.result.records.some((r) => r.adjudication.rowId === rowAt(cmp, F4, 100).id)).toBe(false)
  })

  it('확정 세트 저장: Level III 가 아니면 확인을 받고, 한 번에 저장하며 원래 두 세트는 그대로', async () => {
    const decisions = decide(cmp)
    const before = await s.labels.listRecords({ set: { sha256: shas[F1]!, ...LEE_KEY } })
    // kim-l2 (Level II) 로는 확인 없이 저장하지 않는다
    expect(await code(s.labels.saveFinal(finalReq(cmp, decisions)))).toBe('CONFLICT')
    // 바깥 확인은 남기되 Level III 로 바꿔 저장
    await s.labels.setSession({ labelerId: 'park-l3' })
    const src = await s.labels.reviewSources()
    expect(src.adjudicatorIsLevel3).toBe(true)
    const p = await s.labels.previewFinal(finalReq(cmp, decisions))
    const r = await s.labels.saveFinal(finalReq(cmp, decisions))
    expect(r.records).toEqual({ created: p.result.records.length, updated: 0, unchanged: 0, removed: 0 })
    expect(r.reviewIntervals.created).toBe(p.result.reviewIntervals.length)
    expect(r.labelSets.every((k) => k.labelerId === 'park-l3' && k.readingStage === 'final')).toBe(true)
    expect(r.warnings.some((w) => w.includes('adjudication'))).toBe(false)
    const finalF1 = await s.labels.listRecords({ set: { sha256: shas[F1]!, labelerId: 'park-l3', guidelineVersion: 'v1', readingStage: 'final' } })
    expect(finalF1.length).toBeGreaterThan(0)
    expect(finalF1.every((x) => x.knowledge.designValueSeen === true && x.readerDetail.qualification === 'PAUT Level III')).toBe(true)
    expect((finalF1[0] as unknown as { adjudication: { format: string } }).adjudication.format).toBe('paut-adjudication')
    // 원래 세트는 그대로 (버전도)
    const after = await s.labels.listRecords({ set: { sha256: shas[F1]!, ...LEE_KEY } })
    expect(after).toEqual(before)
    // 같은 결정을 다시 저장하면 모두 그대로
    const again = await s.labels.saveFinal(finalReq(cmp, decisions))
    expect(again.records).toMatchObject({ created: 0, updated: 0, removed: 0 })
    expect(again.records.unchanged).toBe(p.result.records.length)
  })

  it('결정을 바꾸면 이번에 빠진 확정 기록을 지움 표시하고, 잠긴 시험 세트는 이유와 확인이 있어야 한다', async () => {
    const toe = rowAt(cmp, F1, 30)
    const decisions = decide(cmp, { [toe.id]: { rowId: toe.id, choice: 'neither', note: '형상 에코로 봄' } })
    const p = await s.labels.previewFinal(finalReq(cmp, decisions))
    expect(p.previousRecords).toBeGreaterThan(0)
    expect(p.result.removed.records).toHaveLength(1)
    expect(p.lockedTestFiles).toEqual([])
    // F1 시편을 test 로 정하고 잠근다
    const files = (await s.listFiles({ limit: 100 })).items
    const sp1 = files.find((f) => f.storedFileName === F1)!.specimenId
    await s.labels.setTrainingSplits([{ specimenId: sp1, split: 'test' }])
    await s.labels.lockTrainingTest(true)
    const p2 = await s.labels.previewFinal(finalReq(cmp, decisions))
    expect(p2.lockedTestFiles).toEqual([shas[F1]])
    expect(await code(s.labels.saveFinal(finalReq(cmp, decisions)))).toBe('CONFLICT')
    expect(await code(s.labels.saveFinal(finalReq(cmp, decisions), { confirmLockedTest: true }))).toBe('CONFLICT')
    const r = await s.labels.saveFinal(finalReq(cmp, decisions), { confirmLockedTest: true, reason: 'L3 재판정: 토우 지시는 형상 에코' })
    expect(r.records.removed).toBe(1)
    expect(r.lockedLog).toEqual([sp1])
    const split = await s.labels.trainingSplits()
    expect(split.log[0]).toMatchObject({ action: 'locked-change', specimenId: sp1, from: 'test', to: 'test', labelerId: 'park-l3' })
    expect(split.log[0]!.reason).toContain('L3 재판정')
    const all = await s.labels.listRecords({ set: { sha256: shas[F1]!, labelerId: 'park-l3', guidelineVersion: 'v1', readingStage: 'final' }, includeDeleted: true })
    expect(all.filter((x) => x.deleted)).toHaveLength(1)
    // 같은 결정을 다시 저장하면 바뀌는 것이 없어 잠금 확인·기록을 건너뛴다
    const p3 = await s.labels.previewFinal(finalReq(cmp, decisions))
    expect(p3.lockedTestFiles).toEqual([])
    const r3 = await s.labels.saveFinal(finalReq(cmp, decisions))
    expect(r3.lockedLog).toEqual([])
    expect(r3.records).toMatchObject({ created: 0, updated: 0, removed: 0 })
    // 확정 세트는 패널(saveRecord·deleteRecord)로 고칠 수 없다 — 검수 화면에서만 (Level III 확인·잠금 이유·출처)
    const live = all.find((x) => !x.deleted)!
    expect(await code(s.labels.saveRecord({ ...live, note: '손으로 고침' }))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.deleteRecord(live.uuid))).toBe('INVALID_ARGUMENT')
    await s.labels.lockTrainingTest(false, { confirmLocked: true, reason: '시험 끝' })
  })

  it('그사이 기록이 바뀌면 행 번호가 다른 짝을 가리킬 수 있어 CONFLICT (다시 비교하면 됨)', async () => {
    const [rec] = await s.labels.listRecords({ set: { sha256: shas[F4]!, ...LEE_KEY } })
    await s.labels.setSession({ labelerId: 'lee-l2' })
    await s.labels.saveRecord({ ...rec!, note: '다시 봄' })
    await s.labels.setSession({ labelerId: 'park-l3' })
    expect(await code(s.labels.previewFinal(finalReq(cmp, decide(cmp))))).toBe('CONFLICT')
    cmp = await s.labels.compareSets(cmpReq)
    expect((await s.labels.previewFinal(finalReq(cmp, decide(cmp)))).canSave).toBe(true)
  })

  it('학습 데이터 세트 고르기: 기본 규칙(확정 > 대조 > 블라인드)이 확정 세트를 고른다', async () => {
    const c = await s.labels.trainingCandidates(DEFAULT_TRAINING_SET_RULE)
    for (const name of [F1, F2, F3, F4]) {
      const f = c.files.find((x) => x.fileName === name)!
      expect(f.chosen, name).toBe(`${shas[name]}|park-l3|v1|final`)
      expect(f.reason).toContain('확정')
    }
  })

  it('CSV: 쌍 판정 표 · 설계값 대조 · 평가 보고서 (BOM·CRLF, 서비스가 다시 계산)', async () => {
    const decisions = decide(cmp)
    const name = await s.labels.reviewCsvFileName({ kind: 'comparison', compare: cmpReq })
    expect(name).toMatch(/^검수_쌍판정표_kim-l2-vs-lee-l2_\d{8}-\d{4}_pc-[0-9a-f]{8}\.csv$/)
    const out = (n: string): string => join(work, n)
    const r1 = await s.labels.saveReviewCsv({ kind: 'comparison', compare: cmpReq }, out('pairs.csv'))
    expect(r1.rows).toBe(cmp.comparison.rows.length)
    const t1 = readFileSync(out('pairs.csv'), 'utf8')
    expect(t1.startsWith('﻿')).toBe(true)
    expect(t1).toContain('\r\n')
    expect(t1).toContain('P001')
    expect(await code(s.labels.saveReviewCsv({ kind: 'design', compare: cmpReq }, out('design.csv')))).toBe('INVALID_ARGUMENT')
    const r2 = await s.labels.saveReviewCsv(
      { kind: 'design', compare: cmpReq, final: { rowsKey: cmp.rowsKey, decisions, design: { minTier: 'any' } } },
      out('design.csv')
    )
    expect(r2.rows).toBeGreaterThan(0)
    expect(readFileSync(out('design.csv'), 'utf8')).toContain('D001')
    const r3 = await s.labels.saveReviewCsv(
      { kind: 'report', compare: cmpReq, final: { rowsKey: cmp.rowsKey, decisions, design: { minTier: 'any' } }, header: { datasetVersion: 'X3-시범' } },
      out('report.csv')
    )
    expect(r3.bytes).toBeGreaterThan(200)
    const t3 = readFileSync(out('report.csv'), 'utf8')
    expect(t3).toContain('X3-시범')
    expect(t3).toContain('사람 간 일치도')
    expect(existsSync(out('report.csv.partial'))).toBe(false)
  })

  it('블라인드 제출(잠금) · 설계값 대조 시작: 사본은 새 UUID·대조 단계·같은 지시 번호, 원본은 고칠 수 없고, 풀 때 이유', async () => {
    await s.labels.setSession({ labelerId: 'lee-l2' })
    const lee = { sha256: shas[F4]!, ...LEE_KEY }
    const before = await s.labels.listRecords({ set: lee })
    expect(before.length).toBeGreaterThan(0)
    // 남의 세트는 제출할 수 없다
    expect(await code(s.labels.submitSet({ sha256: shas[F4]!, ...KIM }, true))).toBe('INVALID_ARGUMENT')
    const r = await s.labels.startReconcile(lee)
    expect(r).toMatchObject({ set: { ...lee, readingStage: 'reconciled' }, records: before.length, submittedSource: true })
    const copy = await s.labels.listRecords({ set: r.set })
    expect(copy).toHaveLength(before.length)
    expect(copy.every((x) => !before.some((b) => b.uuid === x.uuid))).toBe(true)
    expect(copy.map((x) => x.externalRef).sort()).toEqual(before.map((x) => x.externalRef).sort())
    expect(copy.every((x) => x.readingStage === 'reconciled' && x.knowledge.designValueSeen === true)).toBe(true)
    const sets = await s.labels.listSets({ sha256: shas[F4]! })
    const blindSet = sets.find((x) => x.labelerId === 'lee-l2' && x.readingStage === 'blind')!
    expect(blindSet.submittedAt).not.toBeNull()
    expect(sets.find((x) => x.labelerId === 'lee-l2' && x.readingStage === 'reconciled')!.copiedFrom).toBe(blindSet.setId)
    // 제출한 블라인드는 고칠 수 없다, 대조 세트는 고칠 수 있다
    expect(await code(s.labels.saveRecord({ ...before[0]!, note: '설계값 보고 고침' }))).toBe('CONFLICT')
    expect((await s.labels.saveRecord({ ...copy[0]!, note: '설계값 보고 고침' })).changed).toBe(true)
    // 이미 대조 세트가 있으면 다시 시작하지 않는다
    expect(await code(s.labels.startReconcile(lee))).toBe('CONFLICT')
    // 제출을 풀 때는 이유가 있어야 한다
    expect(await code(s.labels.submitSet(lee, false))).toBe('CONFLICT')
    expect((await s.labels.submitSet(lee, false, { reason: '블라인드 오타 고침 (판독 내용은 그대로)' })).submittedAt).toBeNull()
    expect((await s.labels.saveRecord({ ...before[0]!, note: '오타 고침' })).changed).toBe(true)
    await s.labels.setSession({ labelerId: 'park-l3' })
  })
})
