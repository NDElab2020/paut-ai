/**
 * 패널 계산 (renderer/src/labeling/analysis.ts · review.ts · recordOverlays.ts — 순수, 합성 볼륨):
 *  - 길이 제안: 전문가가 잰 기록 하나로 derive 와 같은 규칙 — 반사체 구간을 내고, 포화면 '제안 불가'(이유), 대조 전 그룹은 막음, 결함만
 *  - 관측 표: 그룹 × 레그 계산 상태, 전문가 확인 행 저장 값(버전 이어 받기)
 *  - 형상 에코 후보: 루트 자리 띠 → 후보, 결함 기록 U 범위는 잘림, 승인·거절한 것은 목록에서 뺌
 *  - 장면 미리보기: runDerive 장면 수 = 그룹 × 스캔 칸
 *  - 검토 구간: 지금 게이트 → 펼친 깊이·레그 범위, 품질 불량은 사유가 있어야, 검사 통과
 *  - 덮개: 기록 상자·점·검토 띠(끝 빔 두 줄, 영상 전체를 칠하지 않음)·빔 모르는 기록은 세로선·에코 후보
 */
import { describe, expect, it } from 'vitest'
import { defaultPost, withGroupPost } from '@shared/imaging'
import { echoCandidateRecordFields, groupLevelsOf, newIndicationRecord, newObservationRow, newReviewInterval, validateReviewInterval, type IndicationRecord, type ReviewInterval } from '@shared/labels'
import { KEY, SHA, T, blobAmplitude, draftPoint, levelGroup, loadRenderer, uuid, type Blob } from './panelKit'

const A = await loadRenderer('analysis')
const R = await loadRenderer('record')
const RV = await loadRenderer('review')
const OV = await loadRenderer('recordOverlays')
const ST = await loadRenderer('state')

const NS = 41
const G = levelGroup(90, 0, NS)
const GROUPS = new Map([[0, G]])
/** 결함 반사체: 스캔 15~25, V 0, 펼친 20 (레그 2 · 실제 4) */
const DEFECT = { k0: 15, k1: 25, vMm: 0, dMm: 20, pct: 90 }

function file(blobs: readonly Blob[] = [DEFECT], group = G) {
  return { sha256: SHA, thicknessMm: T, weld: null, groups: [{ group, amplitude: blobAmplitude(group, blobs) }] }
}

/** 전문가 기록: 최대 진폭 점 + 측정 불가 + 길이 R 16 → 24 */
function expertRecord(start = 16, end = 24, group = G): IndicationRecord {
  let s = ST.initialLabelState()
  s = ST.labelReducer(s, { type: 'addPoint', point: draftPoint(group, 'peak', 20, 0, 20) })
  const pts = R.lengthPointsFor(group, s.draft, { groupId: 0, scanMm: start, beam: 19 }, end, T, () => null, 0)
  s = ST.labelReducer(s, { type: 'setPoints', points: pts })
  const out = R.buildRecord({
    key: KEY,
    uuid: uuid(1),
    base: null,
    draft: s.draft,
    form: { ...R.defaultForm(), heightMethod: 'unmeasurable', defectType: 'slag', existenceConfidence: 'certain' },
    groups: new Map([[0, group]]),
    thicknessMm: T,
    peak: null,
    // 위치만 (사각형 없이 최대 진폭 점·길이로 — 패널의 제안 계산용 기록과 같음)
    positionOnly: true,
    levelsOf: (id: number) => (id === 0 ? groupLevelsOf(group, T) : null),
    shownSuggestion: null,
    viewSnapshot: null
  })
  expect(out.problems).toEqual([])
  return out.record
}

describe('길이 제안 (전문가가 먼저 잰 뒤)', () => {
  it('반사체 구간을 평가 기준 초과로 제안한다 (derive 와 같은 고르기)', () => {
    const r = A.lengthSuggestionFor(file(), KEY, expertRecord())
    expect(r.reason).toBeNull()
    const s = r.suggestion
    expect(s.available).toBe(true)
    expect(s.method).toBe('eval-level')
    expect(s.scanStartMm).toBe(15)
    expect(s.scanEndMm).toBe(25)
    expect(s.lengthMm).toBe(10)
    expect(s.thresholdPct).toBeCloseTo(groupLevelsOf(G, T)!.evaluationPct, 2)
  })

  it('포화면 제안 불가 (이유: 포화), 결함이 아니면 제안하지 않음, 대조 전 그룹은 막힌 이유', () => {
    const sat = A.lengthSuggestionFor(file([{ ...DEFECT, pct: 400 }]), KEY, expertRecord())
    expect(sat.suggestion.available).toBe(false)
    expect(sat.suggestion.reason).toBe('saturated')
    expect(sat.suggestion.message).toContain('포화')
    const echo = { ...expertRecord(), kind: 'geometric-echo' as const, defectType: null, geometricEcho: { kind: 'other' as const, fromSuggestion: false } }
    expect(A.lengthSuggestionFor(file(), KEY, echo).suggestion).toBeNull()
    const unv = { ...G, verified: false }
    const blocked = A.lengthSuggestionFor(file([DEFECT], unv), KEY, expertRecord(16, 24, unv))
    expect(blocked.suggestion).toBeNull()
    expect(blocked.reason).toContain('대조 전')
    // 진폭을 아직 읽지 않았으면
    expect(A.lengthSuggestionFor({ ...file(), groups: [{ group: G, amplitude: null }] }, KEY, expertRecord()).reason).toBe(A.NO_VOLUME_TEXT)
  })

  it('동적 범위 < 6 dB (띠 바탕 50 % 위 60 % 지시) 면 제안 불가, 띠와 끝까지 이어지면 제안하되 확인 필요', () => {
    // 바탕: 지시 앞뒤 띠 50 % (0~10, 30~40) — 지시(15~25) 60 % 와 차 1.6 dB
    const bandAround = [
      { ...DEFECT, k0: 0, k1: 10, pct: 50 },
      { ...DEFECT, k0: 30, k1: NS - 1, pct: 50 },
      { ...DEFECT, pct: 60 }
    ]
    const dr = A.lengthSuggestionFor(file(bandAround), KEY, expertRecord())
    expect(dr.suggestion.available).toBe(false)
    expect(dr.suggestion.reason).toBe('dynamic-range')
    expect(dr.suggestion.message).toContain('동적 범위')
    // 띠가 끊기지 않고 이어지면 구간이 끝에 닿아 '확인 필요(띠 끌림 가능)'
    const flat = A.lengthSuggestionFor(file([{ ...DEFECT, k0: 0, k1: NS - 1, pct: 50 }, { ...DEFECT, pct: 60 }]), KEY, expertRecord())
    expect(flat.suggestion.available).toBe(true)
    expect(flat.suggestion.needsCheck).toBe(true)
    expect(flat.suggestion.checkReason).toContain('끝에 닿')
  })
})

describe('관측 표 (그룹 × 레그)', () => {
  it('계산 상태: 찍은 레그(2)는 보임 · 출처 record, 확인 행을 저장하면 그 상태 · 버전 이어 받기', () => {
    const rec = expertRecord()
    const views = A.observationsFor(file(), KEY, rec, [])
    expect(views).toHaveLength(1)
    const g = views[0]
    expect(g.blocked).toBeNull()
    // 실제 깊이 4 mm · V 0 은 1레그에서는 부채꼴 밖 → 레그 2~4
    expect(g.legs.map((l: { leg: number }) => l.leg)).toEqual([2, 3, 4])
    const l2 = g.legs.find((l: { leg: number }) => l.leg === 2)
    expect(l2).toMatchObject({ computedStatus: 'visible', status: 'visible', expertConfirmed: false, observation: 'record', stale: false })
    expect(l2.peakPct).toBeGreaterThan(80)
    const stored = [newObservationRow({ ...l2.row, status: 'visible', expertConfirmed: true, versions: [{ pcId: 'pc:r', edits: 2 }], revision: 2 })]
    const row = A.confirmedRow(l2.row, 'weak', stored)
    expect(row).toMatchObject({ status: 'weak', expertConfirmed: true, versions: [{ pcId: 'pc:r', edits: 2 }], revision: 2, deleted: false })
    // 확인 행이 있으면 그 상태를 쓴다
    const again = A.observationsFor(file(), KEY, rec, [{ ...row }])
    expect(again[0].legs.find((l: { leg: number }) => l.leg === 2)).toMatchObject({ status: 'weak', expertConfirmed: true, observation: 'expert' })
    // 새 행은 빈 버전 (저장소가 올림)
    expect(A.confirmedRow(l2.row, 'visible', []).versions).toEqual([])
  })

  it('대조 전 그룹은 막힌 이유만', () => {
    const unv = { ...G, verified: false }
    const v = A.observationsFor(file([DEFECT], unv), KEY, expertRecord(16, 24, unv), [])
    expect(v[0].blocked).toContain('대조 전')
    expect(v[0].legs).toEqual([])
  })
})

describe('형상 에코 후보', () => {
  /** 루트 자리 띠: 모든 스캔, V 0 · 펼친 13.5 (레그 2 · 실제 10.5) */
  const BAND = { k0: 0, k1: NS - 1, vMm: 0, dMm: 13.5, pct: 60, sigmaMm: 0.6 }

  it('루트 띠 → 후보 (레그 2), 결함 기록 U 범위는 잘리고, 승인한(겹치는 형상 에코 기록)·거절한 후보는 뺀다', () => {
    const f = file([BAND])
    const all = A.echoCandidatesFor(f, KEY, [])
    expect(all.candidates.length).toBeGreaterThanOrEqual(1)
    const c = all.candidates[0]
    expect(c).toMatchObject({ groupId: 0, zone: 'root', leg: 2, kind: 'other', cutByDefect: false })
    expect(c.scanStartMm).toBe(0)
    expect(c.scanEndMm).toBe(NS - 1)
    // 결함 기록(16~24)이 있으면 그 구간이 잘린다
    const cut = A.echoCandidatesFor(f, KEY, [expertRecord()])
    expect(cut.candidates.some((x: { cutByDefect: boolean }) => x.cutByDefect)).toBe(true)
    expect(cut.candidates.every((x: { scanStartMm: number; scanEndMm: number }) => x.scanEndMm < 16 || x.scanStartMm > 24)).toBe(true)
    // 승인 = 형상 에코 기록 → 같은 그룹 겹침이면 목록에서 빠짐
    const fields = echoCandidateRecordFields(c)
    const approved = newIndicationRecord({ uuid: uuid(7), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', ...fields })
    expect(approved.coordSource).toBe('imported-mm')
    expect(A.openEchoCandidates(all.candidates, [approved], [])).toEqual(all.candidates.filter((x: { groupId: number; scanStartMm: number; scanEndMm: number }) => !(x.scanStartMm <= c.scanEndMm && x.scanEndMm >= c.scanStartMm)))
    expect(A.openEchoCandidates(all.candidates, [], [c.id]).some((x: { id: string }) => x.id === c.id)).toBe(false)
    expect(A.openEchoCandidates(all.candidates, [{ ...approved, deleted: true }], []).length).toBe(all.candidates.length)
  })

  it('장면 미리보기: 그룹 × 스캔 칸 장면, 결함 구간 양성', () => {
    const rec = expertRecord()
    const out = A.scenePreviewFor(file(), KEY, [rec], [], [])
    expect(out.scenes).toHaveLength(NS)
    expect(out.stats.scenes.positive).toBeGreaterThan(0)
    expect(out.scenes.find((s: { scanIndex: number }) => s.scanIndex === 20).state).toBe('positive')
  })
})

describe('검토 구간', () => {
  it('지금 게이트(펼친 7~28 mm) → 레그 1~3, 편집한 게이트를 따른다', () => {
    const gr = RV.reviewGateRange([G], defaultPost(SHA), T)
    expect(gr.depthTopMm).toBeCloseTo(7, 1)
    expect(gr.depthBottomMm).toBeCloseTo(28, 1)
    expect([gr.legMin, gr.legMax]).toEqual([1, 3])
    const edited = withGroupPost(defaultPost(SHA), 0, { gates: { 1: { startMm: 13, lengthMm: 8 } } })
    const e = RV.reviewGateRange([G], edited, T)
    expect(e.depthTopMm).toBeCloseTo(13, 1)
    expect([e.legMin, e.legMax]).toEqual([2, 2])
    expect(RV.reviewGateRange([G], defaultPost(SHA), null)).toBeNull()
  })

  it('검토 완료 = 게이트 범위 포함, 품질 불량은 사유가 있어야, 구간 없으면 막음 — 검사 통과', () => {
    const gate = RV.reviewGateRange([G], defaultPost(SHA), T)
    const draft = { groupId: 0, scanStartMm: 0, scanEndMm: 40 }
    const ok = RV.reviewIntervalOf(KEY, uuid(30), draft, { kind: 'reviewed', reason: null, note: '' }, gate)
    expect(ok.problems).toEqual([])
    const v: ReviewInterval = ok.interval
    expect(v).toMatchObject({ kind: 'reviewed', groupId: 0, scanStartMm: 0, scanEndMm: 40, labelerId: 'kim-l2', readingStage: 'blind', reason: null })
    expect(v.gate).toEqual(gate)
    expect(validateReviewInterval(v).ok).toBe(true)
    const bad = RV.reviewIntervalOf(KEY, uuid(31), draft, { kind: 'quality-bad', reason: null, note: '' }, gate)
    expect(bad.interval).toBeNull()
    expect(bad.problems.join(' ')).toContain('사유')
    const qb = RV.reviewIntervalOf(KEY, uuid(32), { ...draft, groupId: null }, { kind: 'quality-bad', reason: 'coupling', note: '접촉 불량' }, gate)
    expect(qb.interval).toMatchObject({ kind: 'quality-bad', reason: 'coupling', gate: null, groupId: null, note: '접촉 불량' })
    expect(validateReviewInterval(qb.interval).ok).toBe(true)
    expect(RV.reviewIntervalOf(KEY, uuid(33), null, { kind: 'below-threshold', reason: null, note: '' }, gate).problems.length).toBe(1)
    expect(RV.fullScanRange([G])).toEqual([0, NS - 1])
  })
})

describe('덮개 (저장한 기록·검토 구간·후보)', () => {
  const base = {
    numbers: new Map([[uuid(1), 1]]),
    selectedUuid: null,
    editingUuid: null,
    groups: [G],
    activeGroupId: 0,
    scanIndexOf: () => 20,
    beamOf: () => 19,
    thicknessMm: T
  }

  it('없으면 null (뷰어가 그리지 않음)', () => {
    expect(OV.recordOverlays({ ...base, records: [], reviews: [] })).toBeNull()
  })

  it('앱 기록: C-scan = 길이 구간 × 찍은 빔 범위 + 번호, S-scan = 찍은 레그의 영역 + 점, B-scan = 레그 영역', () => {
    const rec = expertRecord()
    const o = OV.recordOverlays({ ...base, records: [rec], reviews: [] })
    const c = o.cscan[0].rects.find((x: { id: string }) => x.id === `r-${rec.uuid}`)
    expect(c).toMatchObject({ tone: 'record', x0: 16, x1: 24, label: '#1' })
    expect(c.y0).toBeLessThanOrEqual(18.6 - 0.5 + 1e-9)
    expect(c.y1).toBeGreaterThanOrEqual(19 + 0.5 - 1e-9)
    const s = o.sscan[0]
    expect(s.rects.map((x: { id: string }) => x.id)).toEqual([`rs-${rec.uuid}-2`])
    expect(s.rects[0].y0).toBeCloseTo(20, 6)
    expect(s.points.map((p: { shape: string }) => p.shape)).toEqual(['circle'])
    expect(o.bscan.rects[0]).toMatchObject({ x0: 16, x1: 24 })
    // 범위 밖 칸이면 S-scan 상자 없음
    const far = OV.recordOverlays({ ...base, scanIndexOf: () => 35, records: [rec], reviews: [] })
    expect(far.sscan[0]).toBeUndefined()
    // 고르면 'selected', 고치는 중이면 그리지 않음 (초안이 대신)
    expect(OV.recordOverlays({ ...base, selectedUuid: rec.uuid, records: [rec], reviews: [] }).cscan[0].rects[0].tone).toBe('selected')
    expect(OV.recordOverlays({ ...base, editingUuid: rec.uuid, records: [rec], reviews: [] })).toBeNull()
  })

  it('검토 구간은 C-scan 끝 빔 두 줄 띠(영상 전체를 칠하지 않음), B-scan 은 세로선 · 빔을 모르는 엑셀 기록은 세로선', () => {
    const rv: ReviewInterval = newReviewInterval({ uuid: uuid(40), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', kind: 'reviewed', groupId: null, scanStartMm: 0, scanEndMm: 40 })
    const imported = newIndicationRecord({ uuid: uuid(41), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', derived: { scanStartMm: 30, scanEndMm: 36, vMinMm: -1, vMaxMm: 1, depthTopMm: 3, depthBottomMm: 5 } })
    const o = OV.recordOverlays({ ...base, records: [imported], reviews: [rv] })
    const strip = o.cscan[0].rects.find((x: { id: string }) => x.id === `rv-${rv.uuid}`)
    expect(strip).toMatchObject({ tone: 'reviewed', x0: 0, x1: 40, y0: G.beams.length - 2.5, y1: G.beams.length - 0.5 })
    expect(o.cscan[0].vlines.map((l: { value: number; tone: string }) => [l.value, l.tone])).toEqual([
      [30, 'ghost'],
      [36, 'ghost']
    ])
    expect(o.bscan.vlines.map((l: { value: number }) => l.value)).toEqual([0, 40])
    // 지운·풀린 구간은 그리지 않음
    expect(OV.recordOverlays({ ...base, records: [], reviews: [{ ...rv, released: true }] })).toBeNull()
  })

  it('형상 에코 후보(펼쳤을 때): C-scan 형상 빔 띠 + 지금 칸 S-scan 자리 단면 (청록)', () => {
    const f = file([{ k0: 0, k1: NS - 1, vMm: 0, dMm: 13.5, pct: 60, sigmaMm: 0.6 }])
    const cands = A.echoCandidatesFor(f, KEY, []).candidates
    const o = OV.recordOverlays({ ...base, records: [], reviews: [], echoCandidates: cands })
    expect(o.cscan[0].rects[0]).toMatchObject({ tone: 'echo', label: '후보' })
    expect(o.sscan[0].rects[0].tone).toBe('echo')
  })
})
