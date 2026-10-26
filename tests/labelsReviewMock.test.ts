/**
 * 브라우저 mock 의 검수 API (dev:web 화면 확인용) 가 실제 서비스(tests/core/service/labelsReview.test.ts)와
 * 같은 계약·오류 코드를 지키는지. 계산은 둘 다 shared/labels/review 를 그대로 쓴다.
 * 검수 시연 데이터(reviewDemo)는 브라우저에서만 기본으로 들어가므로 여기서는 직접 켠다.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRAINING_SET_RULE, type PautApi, type ReviewComparison, type ReviewFinalRequest } from '@shared/api'
import type { ApiResult } from '@shared/errors'
import type { AdjudicationDecision } from '@shared/labels/review'
import { createMockApi } from '../src/renderer/src/api/mock'

async function data<T>(p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.data
}
async function code(p: Promise<ApiResult<unknown>>): Promise<string> {
  const r = await p
  return r.ok ? 'OK' : r.code
}

const KIM = { labelerId: 'kim-l2', readingStage: 'blind' as const, guidelineVersion: 'v1' }
const LEE = { labelerId: 'lee-l2', readingStage: 'blind' as const, guidelineVersion: 'v1' }

function decide(c: ReviewComparison, over: Record<string, AdjudicationDecision> = {}): AdjudicationDecision[] {
  return c.comparison.rows.map(
    (r): AdjudicationDecision => over[r.id] ?? { rowId: r.id, choice: r.kind === 'only-b' ? 'neither' : r.kind === 'pair' ? 'a' : r.counted ? 'a' : 'defer' }
  )
}
const finalReq = (c: ReviewComparison, decisions: AdjudicationDecision[]): ReviewFinalRequest => ({ compare: c.request, rowsKey: c.rowsKey, decisions })

async function setup(): Promise<{ api: PautApi; shas: string[]; cmp: ReviewComparison }> {
  const api = createMockApi('default', { reviewDemo: true })
  const src = await data(api.labels.reviewSources())
  const shas = src.files.map((f) => f.sha256)
  const cmp = await data(api.labels.compareSets({ sha256s: shas, a: KIM, b: LEE }))
  return { api, shas, cmp }
}

describe('브라우저 mock 검수 API', () => {
  it('node 기본(createMockApi())에는 검수 시연 데이터가 없다 — 라벨러 1명 데모 그대로', async () => {
    const api = createMockApi()
    const src = await data(api.labels.reviewSources())
    expect(src.files.every((f) => f.sets.length === 1 && f.sets[0]!.labelerId === 'kim-l2')).toBe(true)
    expect(src.physicalDefects).toBe(0)
  }, 20_000)

  it('검수 목록 · 비교 (짝 3 · A 만 1 · B 만 1) · 같은 입력이면 같은 지문 · 잘못된 요청', async () => {
    const { api, shas, cmp } = await setup()
    const src = await data(api.labels.reviewSources())
    expect(src.blocked).toBeNull()
    expect(src.files).toHaveLength(2)
    expect(src.physicalDefects).toBe(4)
    expect(src.adjudicator?.id).toBe('kim-l2')
    expect(src.adjudicatorIsLevel3).toBe(false)
    expect(cmp.comparison.summary.counts).toMatchObject({ pairs: 3, onlyA: 1, onlyB: 1 })
    expect(cmp.request.options).toMatchObject({ purpose: 'inter-reader', unit: 'grouping', frame: 'file', scanGapMm: 10, depthDiffMm: 5 })
    expect(cmp.files.every((f) => f.hasA && f.hasB && f.fileId !== null)).toBe(true)
    expect((await data(api.labels.compareSets({ sha256s: shas, a: KIM, b: LEE }))).rowsKey).toBe(cmp.rowsKey)
    expect(await code(api.labels.compareSets({ sha256s: shas, a: KIM, b: KIM }))).toBe('INVALID_ARGUMENT')
    expect(await code(api.labels.compareSets({ sha256s: shas, a: KIM, b: { ...LEE, labelerId: '없는' } }))).toBe('INVALID_ARGUMENT')
  }, 20_000)

  it('확정: 미리보기(설계값 대조) → Level III 확인 → 저장 → 다시 저장은 그대로 → 학습 데이터가 확정 세트를 고름', async () => {
    const { api, cmp } = await setup()
    const empty = await data(api.labels.previewFinal(finalReq(cmp, [])))
    expect(empty.canSave).toBe(false)
    const decisions = decide(cmp)
    const p = await data(api.labels.previewFinal(finalReq(cmp, decisions)))
    expect(p).toMatchObject({ canSave: true, adjudicatorIsLevel3: false, adjudicatorIsReader: true, designDefects: 4 })
    expect(p.result.designCheck?.rows.length).toBeGreaterThan(0)
    expect(await code(api.labels.saveFinal(finalReq(cmp, decisions)))).toBe('CONFLICT')
    await data(api.labels.setSession({ labelerId: 'park-l3' }))
    const r = await data(api.labels.saveFinal(finalReq(cmp, decisions)))
    expect(r.records.created).toBe(p.result.records.length)
    expect(r.labelSets.every((k) => k.labelerId === 'park-l3' && k.readingStage === 'final')).toBe(true)
    const again = await data(api.labels.saveFinal(finalReq(cmp, decisions)))
    expect(again.records).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: p.result.records.length })
    const cand = await data(api.labels.trainingCandidates(DEFAULT_TRAINING_SET_RULE))
    expect(cand.files.every((f) => f.chosen?.endsWith('|park-l3|v1|final'))).toBe(true)
    // 그사이 기록이 바뀌면 지문이 달라 CONFLICT
    const [rec] = await data(api.labels.listRecords({ set: { sha256: cmp.request.sha256s[0]!, ...LEE } }))
    await data(api.labels.setSession({ labelerId: 'lee-l2' }))
    await data(api.labels.saveRecord({ ...rec!, note: '다시 봄' }))
    await data(api.labels.setSession({ labelerId: 'park-l3' }))
    expect(await code(api.labels.previewFinal(finalReq(cmp, decisions)))).toBe('CONFLICT')
  }, 20_000)

  it('잠긴 시험 세트의 확정 세트를 바꾸려면 이유와 확인 (분할 기록에 남음) · 빠진 기록은 지움 표시', async () => {
    const { api, cmp } = await setup()
    await data(api.labels.setSession({ labelerId: 'park-l3' }))
    await data(api.labels.saveFinal(finalReq(cmp, decide(cmp))))
    const sp = cmp.files[0]!.specimenId!
    await data(api.labels.setTrainingSplits([{ specimenId: sp, split: 'test' }]))
    await data(api.labels.lockTrainingTest(true))
    const first = cmp.comparison.rows.find((r) => r.kind === 'pair' && r.a!.fileNames.includes(cmp.files[0]!.fileName))!
    const changed = decide(cmp, { [first.id]: { rowId: first.id, choice: 'neither' } })
    const p = await data(api.labels.previewFinal(finalReq(cmp, changed)))
    expect(p.lockedTestFiles).toEqual([cmp.files[0]!.sha256])
    expect(p.result.removed.records).toHaveLength(1)
    expect(await code(api.labels.saveFinal(finalReq(cmp, changed)))).toBe('CONFLICT')
    const r = await data(api.labels.saveFinal(finalReq(cmp, changed), { confirmLockedTest: true, reason: '형상 에코로 재판정' }))
    expect(r.records.removed).toBe(1)
    expect(r.lockedLog).toEqual([sp])
    const v = await data(api.labels.trainingSplits())
    expect(v.log[0]).toMatchObject({ action: 'locked-change', specimenId: sp, from: 'test', to: 'test' })
  }, 20_000)

  it('CSV: 대화상자 경로 → 쓰기 (설계값 대조는 결정이 있어야) · 2인 모드는 모두 막음', async () => {
    const { api, cmp } = await setup()
    const req = { kind: 'comparison' as const, compare: cmp.request }
    const path = await data(api.labels.chooseReviewCsvPath(req))
    expect(path).toMatch(/검수_쌍판정표_kim-l2-vs-lee-l2_\d{8}-\d{4}_pc-mock01\.csv$/)
    const out = await data(api.labels.saveReviewCsv(req, path!))
    expect(out).toMatchObject({ rows: cmp.comparison.rows.length })
    expect(out.bytes).toBeGreaterThan(100)
    expect(await code(api.labels.saveReviewCsv({ kind: 'design', compare: cmp.request }, path!))).toBe('INVALID_ARGUMENT')
    const d = await data(api.labels.saveReviewCsv({ kind: 'design', compare: cmp.request, final: { rowsKey: cmp.rowsKey, decisions: decide(cmp) } }, path!))
    expect(d.rows).toBeGreaterThan(0)
    const rep = await data(api.labels.saveReviewCsv({ kind: 'report', compare: cmp.request, header: { datasetVersion: '시범' } }, path!))
    expect(rep.rows).toBeGreaterThan(10)
    await data(api.labels.setSession({ blindMode: true }))
    const src = await data(api.labels.reviewSources())
    expect(src.blocked).toContain('2인 독립 모드')
    expect(src.files).toEqual([])
    expect(await code(api.labels.compareSets(cmp.request))).toBe('INVALID_ARGUMENT')
    expect(await code(api.labels.previewFinal(finalReq(cmp, decide(cmp))))).toBe('INVALID_ARGUMENT')
    expect(await code(api.labels.chooseReviewCsvPath(req))).toBe('INVALID_ARGUMENT')
  }, 20_000)
})
