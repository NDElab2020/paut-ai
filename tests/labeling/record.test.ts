/**
 * 초안 + 속성 → 지시 기록 (renderer/src/labeling/record.ts — 순수):
 *  - 앵커 → mm: 점마다 접은 깊이·레그, 파생 위치 = derivedFromPoints (스캔 = 길이 시작·끝, V·깊이 = 사각형 또는 단면 점)
 *  - 길이 점: 앵커 빔·샘플은 단면 기준점(최대 진폭 점)과 같고 잰 빔은 measuredBeam → length.beam
 *  - 높이 5가지 (상하 팁·팁 + 표면(가까운 면)·노정 시간·−6 dB·측정 불가), 점이 모자라면 저장을 막음
 *  - 신호 = 최대 진폭 읽기값 + levels.ts (Ref 대비 dB, 평가·기록 기준, 대조 전)
 *  - 제안 기록: 보여 준 제안만(전문가가 먼저 잰 뒤), 수락·수정량, 제안 불가 · 2인 모드(보이지 않음)면 남기지 않음
 *  - 대조·확정 단계는 설계값 봤음, 형상 에코·형상 불완전 칸, 검사(validateIndicationRecord) 통과
 *  - 고치기: 기록 → 초안 → 기록 왕복, 엑셀 기록은 위치를 두고 속성만, 좌표 규칙이 바뀐 기록은 다시 계산
 *  - 표시(재확인 필요·좌표 규칙·대조 전·엑셀), 지시 번호·갈 곳, 화면 스냅샷 왕복
 */
import { describe, expect, it } from 'vitest'
import { defaultPost, groupPostOf, withGroupPost } from '@shared/imaging'
import { LABEL_COORD_RULES_VERSION, groupLevelsOf, newIndicationRecord, validateIndicationRecord, type IndicationRecord, type LengthSuggestion } from '@shared/labels'
import { KEY, SHA, T, draftPoint, levelGroup, loadRenderer, uuid } from './panelKit'

const R = await loadRenderer('record')
const ST = await loadRenderer('state')

const G = levelGroup(90, 0, 41)
const G1 = { ...levelGroup(270, 1, 41), verified: false }
const GROUPS = new Map([
  [0, G],
  [1, G1]
])
const LEVELS = groupLevelsOf(G, T)!

/** 새 기록 양식 + 존재 확신도 (기본값을 미리 채우지 않으므로 시험에서 고른다) */
function form0(over: Record<string, unknown> = {}) {
  return { ...R.defaultForm('blind'), existenceConfidence: 'certain', ...over }
}

/** 에코 범위 사각형 (펼친 18.5~21.5 = 레그 2 실제 2.5~5.5, V ±0.2) — 결함 기록은 사각형이 있어야 저장된다 */
const RECT = { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -0.2, vMaxMm: 0.2, depthMinMm: 18.5, depthMaxMm: 21.5, displayGainDb: 0 }

/** 단면: 최대 진폭(V 0, 펼친 20 → 레그 2 실제 4) · 위 팁(펼친 21.5 → 실제 2.5) · 아래 팁(펼친 18.5 → 실제 5.5), 스캔 칸 20 */
function sectionDraft(extra: Array<Record<string, unknown>> = [], rect: Record<string, unknown> | null = RECT) {
  let s = ST.initialLabelState()
  for (const p of [draftPoint(G, 'peak', 20, 0, 20), draftPoint(G, 'tip-top', 20, 0.2, 21.5), draftPoint(G, 'tip-bottom', 20, -0.2, 18.5), ...extra]) {
    s = ST.labelReducer(s, { type: 'addPoint', point: p })
  }
  if (rect) s = ST.labelReducer(s, { type: 'setRect', rect })
  return s
}

const READING = {
  groupId: 0,
  scanIndex: 20,
  scanMm: 20,
  vMm: 0,
  unfoldedDepthMm: 20,
  depthMm: 4,
  leg: 2,
  beam: 18.6,
  nearestBeam: 19,
  angleDeg: 58.6,
  sample: 380,
  soundPathMm: 37,
  amplitudePct: 87.5,
  saturated: false
}

function build(over: Record<string, unknown> = {}) {
  const s = (over['state'] as ReturnType<typeof sectionDraft>) ?? sectionDraft()
  return R.buildRecord({
    key: KEY,
    uuid: uuid(1),
    base: null,
    draft: s.draft,
    form: form0(),
    groups: GROUPS,
    thicknessMm: T,
    peak: READING,
    levelsOf: (id: number) => groupLevelsOf(GROUPS.get(id)!, T),
    shownSuggestion: null,
    viewSnapshot: null,
    ...over
  })
}

/** 길이 시작·끝 점을 더한 상태 (R = 칸 14 · 빔 19, 끝 = 칸 26) */
function withLength(s = sectionDraft(), ref = { groupId: 0, scanMm: 14, beam: 19 }, endK = 26) {
  const pts = R.lengthPointsFor(G, s.draft, ref, endK, T, () => null, 0)
  expect(pts).not.toBeNull()
  return ST.labelReducer(s, { type: 'setPoints', points: pts })
}

function suggestion(over: Partial<LengthSuggestion> = {}): LengthSuggestion {
  return {
    available: true,
    reason: null,
    message: null,
    method: 'eval-level',
    rule: 'eval-level',
    ruleDb: -14,
    groupId: 0,
    leg: 2,
    beam: 19,
    angleDeg: 59,
    thresholdPct: 31.8,
    peakPct: 90,
    peakScanMm: 20,
    peakDepthMm: 4,
    saturated: false,
    scanStartMm: 15,
    scanEndMm: 25,
    uncorrectedMm: null,
    lengthMm: 10,
    backgroundPct: 2,
    dynamicRangeDb: 33,
    reachedEdge: false,
    needsCheck: false,
    checkReason: null,
    ...over
  }
}

describe('초안 → 기록: 앵커 → mm · 파생 위치 · 높이 · 신호 · 길이', () => {
  it('상하 팁 + 길이: 검사 통과, 점마다 실제 깊이·레그, 파생 위치 = 길이 구간 × 단면 점 범위', () => {
    const s = withLength()
    const out = build({ state: s })
    expect(out.problems).toEqual([])
    const r: IndicationRecord = out.record
    expect(validateIndicationRecord(r).ok).toBe(true)
    expect(r.coordSource).toBe('app-anchor')
    expect(r.anchors.map((p) => p.role).sort()).toEqual(['length-end', 'length-start', 'peak', 'rect-a', 'rect-b', 'tip-bottom', 'tip-top'])
    const tip = r.anchors.find((p) => p.role === 'tip-top')!
    expect(tip.leg).toBe(2)
    expect(tip.mm!.depthMm).toBeCloseTo(2.5, 9)
    expect(tip.anchor.coordRulesVersion).toBe(LABEL_COORD_RULES_VERSION)
    expect(tip.anchor.groupVerified).toBe(true)
    expect(r.derived.scanStartMm).toBe(14)
    expect(r.derived.scanEndMm).toBe(26)
    expect(r.derived.depthTopMm).toBeCloseTo(2.5, 9)
    expect(r.derived.depthBottomMm).toBeCloseTo(5.5, 9)
    expect(r.derived.vMinMm).toBeCloseTo(-0.2, 9)
    expect(r.derived.vMaxMm).toBeCloseTo(0.2, 9)
    // 높이 = |아래 팁 − 위 팁| (실제 깊이), 정한 점 = 그 두 점
    expect(r.height.method).toBe('tip-tip')
    expect(r.height.valueMm).toBeCloseTo(3, 6)
    expect(r.height.pointIds).toEqual([r.anchors.find((p) => p.role === 'tip-top')!.id, r.anchors.find((p) => p.role === 'tip-bottom')!.id])
    // 길이: 두께 12 ≥ 8 → 평가 기준 초과 구간, 문턱 = 평가 기준 %FSH, 잰 빔 = R 의 빔
    expect(r.length).toMatchObject({ valueMm: 12, method: 'eval-level', groupId: 0, beam: 19, uncorrectedMm: null })
    expect(r.length.thresholdPct).toBeCloseTo(LEVELS.evaluationPct, 2)
    expect(r.length.angleDeg).toBe(G.beams[19]!.angleDeg)
    // 신호: 파일 이득 0 dB 읽기값 + Ref 대비 dB (대조 전)
    expect(r.signal.maxAmplitudePct).toBe(87.5)
    expect(r.signal.refDb).toBeCloseTo(20 * Math.log10(87.5 / LEVELS.refPct), 2)
    expect(r.signal.refDbVerified).toBe(false)
    expect(r.signal.exceedsEvaluationLevel).toBe(true)
    // 길이 12 ≤ t → 기록 기준 Ref −8 dB(≈ 63.5 %) — 87.5 % 는 넘음
    expect(r.signal.exceedsRecordingLevel).toBe(true)
    expect(r.signal.peak).toEqual({ groupId: 0, beam: 19, angleDeg: G.beams[19]!.angleDeg, scanMm: 20, depthMm: 4 })
    expect(r.suggestions).toEqual([])
    expect(r.recheckNeeded).toBe(false)
    expect(r.knowledge.designValueSeen).toBe(false)
  })

  it('길이 점: 앵커 빔·샘플·V·깊이는 최대 진폭 점과 같고(파생 V·깊이를 끌지 않음), 잰 빔은 measuredBeam', () => {
    const s = withLength()
    const peak = s.draft.points.find((p: { role: string }) => p.role === 'peak')
    const a = s.draft.points.find((p: { role: string }) => p.role === 'length-start')
    const b = s.draft.points.find((p: { role: string }) => p.role === 'length-end')
    for (const p of [a, b]) {
      expect(p.beam).toBe(peak.beam)
      expect(p.sample).toBe(peak.sample)
      expect(p.vMm).toBe(peak.vMm)
      expect(p.measuredBeam).toBe(19)
    }
    expect([a.scanIndex, b.scanIndex]).toEqual([14, 26])
    // R 이 끝보다 뒤여도 시작 ≤ 끝
    const rev = R.lengthPointsFor(G, s.draft, { groupId: 0, scanMm: 30, beam: 19 }, 22, T, () => null, 0)
    expect(rev.map((p: { scanIndex: number }) => p.scanIndex)).toEqual([22, 30])
    expect(R.draftLength(s.draft)).toEqual({ groupId: 0, startMm: 14, endMm: 26, beam: 19, lengthMm: 12 })
  })

  it('단면 점이 없으면 R 칸·빔의 게이트 최대 샘플로 기준점을 잡고, 그것도 없으면 길이 점을 만들지 않는다', () => {
    const empty = ST.initialLabelState().draft
    expect(R.lengthPointsFor(G, empty, { groupId: 0, scanMm: 10, beam: 15 }, 20, T, () => null, 0)).toBeNull()
    const pts = R.lengthPointsFor(G, empty, { groupId: 0, scanMm: 10, beam: 15 }, 20, T, (_g: number, k: number, b: number) => (k === 10 && b === 15 ? 400 : null), 0)
    expect(pts[0]).toMatchObject({ beam: 15, sample: 400, measuredBeam: 15, scanIndex: 10 })
  })

  it('높이 점이 모자라면 저장을 막고(문제), 측정 불가는 높이 없이 저장된다', () => {
    let s = sectionDraft()
    s = ST.labelReducer(s, { type: 'removePoint', id: s.draft.points.find((p: { role: string }) => p.role === 'tip-bottom').id })
    const out = build({ state: s })
    expect(out.record).toBeNull()
    expect(out.problems.join(' ')).toContain('아래 팁')
    const ok = build({ state: s, form: form0({ heightMethod: 'unmeasurable' }) })
    expect(ok.problems).toEqual([])
    expect(ok.record.height).toEqual({ method: 'unmeasurable', valueMm: null, pointIds: [] })
    // 점이 하나도 없으면 막음
    const none = build({ state: ST.initialLabelState() })
    expect(none.record).toBeNull()
    expect(none.problems.length).toBeGreaterThan(0)
  })

  it('높이 다섯 가지: 팁 + 표면은 가까운 면(0 또는 t)까지, 노정 시간·−6 dB 는 두 점 차', () => {
    const at = (id: string, role: string, depthMm: number, leg = 1) => ({ id, role, anchor: { groupId: 0, scanIndex: 1, beam: 1, sample: 1, coordRulesVersion: 1, groupVerified: true }, leg, displayGainDb: 0, mm: { scanMm: 1, vMm: 0, depthMm } })
    // 루트(바닥)에 이어짐: t − 위 팁
    expect(R.heightOf('tip-surface', [at('p1', 'tip', 8.4), at('p2', 'surface', 11.7)], T).height).toEqual({ method: 'tip-surface', valueMm: 3.6, pointIds: ['p1', 'p2'] })
    // 윗면에 이어짐: 아래 팁 깊이
    expect(R.heightOf('tip-surface', [at('p1', 'tip', 2.2), at('p2', 'surface', 0.4)], T).height.valueMm).toBe(2.2)
    expect(R.heightOf('transit-time', [at('p1', 'tip-top', 5), at('p2', 'tip-bottom', 7.5)], T).height.valueMm).toBe(2.5)
    expect(R.heightOf('6db', [at('p1', 'drop-top', 5), at('p2', 'drop-bottom', 6)], T).height.valueMm).toBe(1)
    expect(R.heightOf('6db', [at('p1', 'drop-top', 5)], T).problem).toContain('−6 dB')
    expect(R.heightOf('unmeasurable', [], T)).toEqual({ height: { method: 'unmeasurable', valueMm: null, pointIds: [] }, problem: null, warning: null })
  })

  it('사각형(에코 범위)이 있으면 V·실제 깊이 범위는 사각형 — 측정 불가 + 사각형만으로도 저장', () => {
    let s = ST.initialLabelState()
    s = ST.labelReducer(s, { type: 'setRect', rect: { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -1, vMaxMm: 1, depthMinMm: 17, depthMaxMm: 19, displayGainDb: 0 } })
    const out = build({ state: s, form: form0({ heightMethod: 'unmeasurable' }), peak: null })
    expect(out.problems).toEqual([])
    const r: IndicationRecord = out.record
    expect(r.anchors.map((p) => p.role)).toEqual(['rect-a', 'rect-b'])
    expect(r.derived.vMinMm).toBeCloseTo(-1, 9)
    expect(r.derived.vMaxMm).toBeCloseTo(1, 9)
    // 펼친 17~19 (레그 2) → 실제 5~7
    expect(r.derived.depthTopMm).toBeCloseTo(5, 9)
    expect(r.derived.depthBottomMm).toBeCloseTo(7, 9)
    expect(r.signal.maxAmplitudePct).toBeNull()
    expect(out.warnings.join(' ')).toContain('최대 진폭')
  })

  it('6 dB 강하 + 곡률 보정 (t < 8): l_c = l_s × (OD − 2d) / OD, 보정 전 길이와 문턱(최대 − 6 dB)', () => {
    const m = R.lengthMeasureOf({ groupId: 0, startMm: 10, endMm: 20, beam: 19, lengthMm: 10 }, '6db-curvature', G, LEVELS, 80, 3, 139.8)
    expect(m.valueMm).toBeCloseTo((10 * (139.8 - 6)) / 139.8, 3)
    expect(m.uncorrectedMm).toBe(10)
    expect(m.thresholdPct).toBeCloseTo(80 / 10 ** (6 / 20), 2)
    expect(R.lengthMethodFor(6, null)).toBe('6db-curvature')
    expect(R.lengthMethodFor(12, null)).toBe('eval-level')
    expect(R.lengthMethodFor(12, 'other')).toBe('other')
  })
})

describe('앱 길이 제안 기록 (전문가가 먼저 잰 뒤 보인 것만)', () => {
  it('보인 제안 + 고친 길이: 길이·시작·끝 세 줄, 수정량 = 최종 − 제안, 그대로 받지 않음', () => {
    const out = build({ state: withLength(), shownSuggestion: suggestion() })
    const sg = out.record.suggestions
    expect(sg.map((x: { target: string }) => x.target)).toEqual(['length', 'length-start', 'length-end'])
    expect(sg[0]).toMatchObject({ suggestedMm: 10, finalMm: 12, correctionMm: 2, acceptedUnchanged: false, shownAfterExpert: true, rule: 'eval-level' })
    expect(sg[1]).toMatchObject({ suggestedMm: 15, finalMm: 14, correctionMm: -1 })
    expect(sg[2]).toMatchObject({ suggestedMm: 25, finalMm: 26, correctionMm: 1 })
    expect(validateIndicationRecord(out.record).ok).toBe(true)
  })

  it('제안값으로 바꾼 뒤 저장: 그대로 받음 · 수정량 0 (검사 통과)', () => {
    const s = withLength(sectionDraft(), { groupId: 0, scanMm: 15, beam: 19 }, 25)
    const out = build({ state: s, shownSuggestion: suggestion() })
    expect(out.record.suggestions.every((x: { acceptedUnchanged: boolean; correctionMm: number }) => x.acceptedUnchanged && x.correctionMm === 0)).toBe(true)
    expect(R.acceptedSuggestion(suggestion(), R.draftLength(s.draft))).toBe(true)
    expect(validateIndicationRecord(out.record).ok).toBe(true)
  })

  it('제안 불가(포화 등)였으면 한 줄: 제안값 없음, 받지 않음', () => {
    const out = build({ state: withLength(), shownSuggestion: suggestion({ available: false, reason: 'saturated', message: '포화', scanStartMm: null, scanEndMm: null, lengthMm: null }) })
    expect(out.record.suggestions).toEqual([{ target: 'length', rule: 'eval-level', ruleDb: -14, suggestedMm: null, finalMm: 12, acceptedUnchanged: false, correctionMm: null, shownAfterExpert: true }])
    expect(validateIndicationRecord(out.record).ok).toBe(true)
  })

  it('보이지 않은 제안(2인 독립 모드·길이 전)은 남기지 않는다', () => {
    expect(build({ state: withLength(), shownSuggestion: null }).record.suggestions).toEqual([])
    expect(R.suggestionRecords(suggestion(), null)).toEqual([])
  })
})

describe('속성 칸', () => {
  it('설계값 대조·확정 단계는 늘 설계값 봤음, 블라인드는 고른 값', () => {
    expect(build({ key: { ...KEY, readingStage: 'reconciled' } }).record.knowledge.designValueSeen).toBe(true)
    expect(build({ form: form0({ designValueSeen: true }) }).record.knowledge.designValueSeen).toBe(true)
    expect(build().record.knowledge.designValueSeen).toBe(false)
  })

  it('결함 종류 → ISO 코드·판정 특성 기본값, 일렬 체적 → 면상(전환 확인), 종류가 없으면 경고', () => {
    const lof = build({ form: form0({ defectType: 'lof-sidewall' }) }).record
    expect(lof).toMatchObject({ isoCode: '4011', character: { value: 'planar', alignedVolumetric: false, expertConfirmed: false } })
    const por = build({ form: form0({ defectType: 'porosity-single', alignedVolumetric: true }) }).record
    expect(por.character).toEqual({ value: 'planar', alignedVolumetric: true, expertConfirmed: true })
    expect(validateIndicationRecord(por).warnings.join(' ')).not.toContain('판정 특성이')
    expect(build().warnings.join(' ')).toContain('결함 종류')
  })

  it('형상 에코·형상 불완전: 결함 칸(종류·높이·표면)은 비우고 세부를 둔다 — 검사 통과', () => {
    const echo = build({ form: form0({ kind: 'geometric-echo', defectType: 'slag', echoKind: 'root', surface: 'embedded' }) }).record
    expect(echo).toMatchObject({ kind: 'geometric-echo', defectType: null, isoCode: null, surface: null, geometricEcho: { kind: 'root', fromSuggestion: false }, geometricImperfection: null })
    expect(echo.height).toEqual({ method: null, valueMm: null, pointIds: [] })
    expect(validateIndicationRecord(echo).ok).toBe(true)
    const imp = build({ form: form0({ kind: 'geometric-imperfection', imperfectionKind: 'undercut' }) }).record
    expect(imp).toMatchObject({ isoCode: '501', geometricImperfection: { kind: 'undercut' }, geometricEcho: null })
    expect(validateIndicationRecord(imp).ok).toBe(true)
  })

  it('단면 점이 서로 다른 스캔 칸이면 경고, 신호 점은 최대 진폭 점 → 없으면 가장 센 점', () => {
    const s = sectionDraft([draftPoint(G, 'other', 22, 0, 19)])
    expect(R.sectionScanMismatch(s.draft)).toBe(true)
    expect(build({ state: s }).warnings.join(' ')).toContain('다른 스캔 위치')
    const amp = new Map<string, number>([
      ['tip-top', 30],
      ['tip-bottom', 60]
    ])
    const noPeak = ST.labelReducer(s, { type: 'removePoint', id: s.draft.points.find((p: { role: string }) => p.role === 'peak').id })
    const pk = R.peakPointOf(noPeak.draft, (p: { role: string }) => ({ ...READING, amplitudePct: amp.get(p.role) ?? 1 }))
    expect(pk.fromPeak).toBe(false)
    expect(pk.point.role).toBe('tip-bottom')
  })

  it('단면 체크 목록: 높이 방식에 따른 점, 다음 찍을 역할', () => {
    const empty = ST.initialLabelState().draft
    const items = R.sectionChecklist({ kind: 'defect', heightMethod: 'tip-surface' }, empty)
    expect(items.map((i: { id: string }) => i.id)).toEqual(['peak', 'tip', 'surface', 'rect'])
    // 결함은 에코 범위(사각형)도 필수 (지침서 6.4)
    expect(items.filter((i: { required: boolean }) => i.required).map((i: { id: string }) => i.id)).toEqual(['tip', 'surface', 'rect'])
    expect(R.nextRole(items)).toBe('tip')
    // 초안을 비운 뒤 처음 찍을 점은 목록 순서대로 (최대 진폭부터)
    expect(R.firstRole(items)).toBe('peak')
    const done = R.sectionChecklist({ kind: 'defect', heightMethod: 'tip-tip' }, sectionDraft().draft)
    expect(R.nextRole(done)).toBeNull()
    expect(R.sectionChecklist({ kind: 'geometric-echo', heightMethod: 'tip-tip' }, empty).map((i: { id: string }) => i.id)).toEqual(['peak', 'rect'])
    expect(R.roleName('tip-top', 'transit-time')).toBe('위 끝 (노정)')
  })
})

describe('고치기 · 표시 · 스냅샷', () => {
  it('기록 → 초안 → 기록 왕복: 점 id·앵커·파생 위치·높이가 같고, 버전은 그대로(그사이 바뀌면 저장이 CONFLICT)', () => {
    const first: IndicationRecord = { ...build({ state: withLength() }).record, versions: [{ pcId: 'pc-a:r1', edits: 2 }], revision: 2 }
    const d = R.draftFromRecord(first, GROUPS, T)
    expect(d.rect).not.toBeNull()
    expect(d.points.map((p: { id: string }) => p.id)).toEqual(first.anchors.filter((p) => p.role !== 'rect-a' && p.role !== 'rect-b').map((p) => p.id))
    expect(d.points.find((p: { role: string }) => p.role === 'length-start').measuredBeam).toBe(19)
    const again = R.buildRecord({
      key: KEY,
      uuid: uuid(99),
      base: first,
      draft: d,
      form: R.formFromRecord(first),
      groups: GROUPS,
      thicknessMm: T,
      peak: READING,
      levelsOf: (id: number) => groupLevelsOf(GROUPS.get(id)!, T),
      shownSuggestion: null,
      viewSnapshot: null
    }).record as IndicationRecord
    expect(again.uuid).toBe(first.uuid)
    expect(again.versions).toEqual(first.versions)
    expect(again.derived.scanStartMm).toBeCloseTo(first.derived.scanStartMm, 9)
    expect(again.derived.depthTopMm).toBeCloseTo(first.derived.depthTopMm!, 6)
    expect(again.height.valueMm).toBeCloseTo(first.height.valueMm!, 6)
    for (let i = 0; i < first.anchors.length; i++) {
      expect(again.anchors[i]!.mm!.depthMm).toBeCloseTo(first.anchors[i]!.mm!.depthMm, 6)
      expect(again.anchors[i]!.anchor.beam).toBeCloseTo(first.anchors[i]!.anchor.beam, 9)
    }
  })

  it('사각형 기록은 사각형으로 불러온다', () => {
    let s = ST.initialLabelState()
    s = ST.labelReducer(s, { type: 'setRect', rect: { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -1, vMaxMm: 1, depthMinMm: 17, depthMaxMm: 19, displayGainDb: 0 } })
    const r = build({ state: s, form: form0({ heightMethod: 'unmeasurable' }), peak: null }).record
    const d = R.draftFromRecord(r, GROUPS, T)
    expect(d.points).toEqual([])
    expect(d.rect.vMinMm).toBeCloseTo(-1, 6)
    expect(d.rect.depthMaxMm).toBeCloseTo(19, 6)
  })

  it('엑셀 기록(앵커 없음)은 점을 찍지 않으면 위치·길이·신호를 두고 속성만 고친다', () => {
    const imported = newIndicationRecord({
      uuid: uuid(5),
      sha256: SHA,
      labelerId: 'kim-l2',
      guidelineVersion: 'v1',
      derived: { scanStartMm: 30, scanEndMm: 46, vMinMm: -8, vMaxMm: -5.5, depthTopMm: 0.5, depthBottomMm: 3 },
      length: { valueMm: 16, method: 'eval-level' },
      signal: { maxAmplitudePct: 87.5, saturated: false },
      defectType: 'crack-toe',
      externalRef: '1'
    })
    const out = build({ base: imported, state: ST.initialLabelState(), form: { ...R.formFromRecord(imported), existenceConfidence: 'probable', heightMethod: 'unmeasurable' }, peak: null })
    expect(out.problems).toEqual([])
    expect(out.record).toMatchObject({ coordSource: 'imported-mm', anchors: [], externalRef: '1', existenceConfidence: 'probable', derived: imported.derived, length: imported.length })
    expect(out.record.signal.maxAmplitudePct).toBe(87.5)
    expect(validateIndicationRecord(out.record).ok).toBe(true)
  })

  it('표시: 좌표 규칙이 바뀐 앵커 기록 = 좌표 규칙 바뀜·재확인 필요, 대조 전 그룹, 엑셀', () => {
    const r: IndicationRecord = build({ state: withLength() }).record
    expect(R.recordFlags(r, GROUPS)).toEqual([])
    const old = { ...r, anchors: r.anchors.map((p) => ({ ...p, anchor: { ...p.anchor, coordRulesVersion: LABEL_COORD_RULES_VERSION + 1 } })), derived: { ...r.derived, coordRulesVersion: LABEL_COORD_RULES_VERSION + 1 } }
    expect(R.recordFlags(old, GROUPS).map((f: { code: string }) => f.code)).toEqual(['coord-rules', 'recheck'])
    const other = { ...r, signal: { ...r.signal, peak: { ...r.signal.peak!, groupId: 1 } } }
    expect(R.recordFlags(other, GROUPS).map((f: { code: string }) => f.code)).toEqual(['unverified'])
    const imported = newIndicationRecord({ uuid: uuid(6), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', derived: { scanStartMm: 1, scanEndMm: 2 } })
    expect(R.recordFlags(imported, GROUPS).map((f: { code: string; text: string }) => f.text)).toEqual(['엑셀'])
    // 고치기로 불러오면 앵커에서 다시 계산한 위치 (같은 규칙 식이라 값은 같음)
    const d = R.draftFromRecord(old, GROUPS, T)
    expect(d.points.length + (d.rect ? 2 : 0)).toBe(r.anchors.length)
  })

  it('지시 번호 = 스캔 시작 순서, 갈 곳 = 최대 진폭 위치', () => {
    const a = newIndicationRecord({ uuid: uuid(11), sha256: SHA, labelerId: 'k', guidelineVersion: 'v1', derived: { scanStartMm: 50, scanEndMm: 60 } })
    const b = newIndicationRecord({ uuid: uuid(12), sha256: SHA, labelerId: 'k', guidelineVersion: 'v1', derived: { scanStartMm: 10, scanEndMm: 20 } })
    const c = { ...b, uuid: uuid(13), deleted: true }
    const n = R.recordNumbers([a, b, c])
    expect([n.get(uuid(12)), n.get(uuid(11)), n.get(uuid(13))]).toEqual(['1', '2', undefined])
    // 고정 지시 번호(externalRef)가 있으면 그것 — 앞에 기록이 생겨도 이름이 바뀌지 않는다
    const m = R.recordNumbers([{ ...a, externalRef: 'A7' }, b])
    expect([m.get(uuid(12)), m.get(uuid(11))]).toEqual(['1', 'A7'])
    expect([...m.keys()]).toEqual([uuid(12), uuid(11)])
    const r: IndicationRecord = build().record
    expect(R.gotoOf(r)).toEqual({ groupId: 0, scanMm: 20, beam: 19 })
    expect(R.gotoOf({ ...b, length: { ...b.length, groupId: 1, beam: 7 } })).toEqual({ groupId: 1, scanMm: 15, beam: 7 })
  })

  it('화면 스냅샷: 이득·게이트·색표를 남기고, 지금 후처리에 덮어 되돌린다 (범위는 지금 그대로)', () => {
    let post = withGroupPost(defaultPost(SHA), 0, { gainDb: 6, gates: { 1: { thresholdPct: 40 } } })
    post = { ...post, palette: { minPct: 10, maxPct: 90 } }
    const snap = R.snapshotOf(post, [0, 1], { groupId: 0, scanMm: 20, beam: 19 })
    expect(R.snapshotCursor(snap)).toEqual({ groupId: 0, scanMm: 20, beam: 19 })
    const now = { ...defaultPost(SHA), scanRangeMm: [10, 30] as [number, number] }
    const back = R.postWithSnapshot(now, JSON.parse(JSON.stringify(snap)), [G, G1])
    expect(groupPostOf(back, 0).gainDb).toBe(6)
    expect(groupPostOf(back, 0).gates[1]).toEqual({ thresholdPct: 40 })
    expect(back.palette).toEqual({ minPct: 10, maxPct: 90 })
    expect(back.scanRangeMm).toEqual([10, 30])
    expect(R.postWithSnapshot(now, { format: 'other' }, [G])).toBeNull()
    expect(R.snapshotCursor(null)).toBeNull()
    // NDE(읽기 규칙 없음): 형식 출처 칸을 만들지 않는다 (스냅샷 바이트 그대로)
    expect(R.snapshotFormatSourceOf({ formatFamily: '3.x', groups: [G, G1] })).toBeNull()
    expect(Object.keys(snap)).toEqual(['format', 'version', 'rulesVersion', 'cursor', 'palette', 'groups'])
  })

  it('OPD: 스냅샷에 읽기 규칙·진폭 눈금(추정)·V 부호 추정을 남기고, 지시 표에 \'추정 값\'·\'두께 확인\' 을 붙인다', () => {
    const amp = { rawMax: 255, unitMax: 250, estimated: true }
    const opd90 = { ...G, verified: false, ampScale: amp }
    const opd270 = { ...G1, ampScale: amp, selfCheck: { thicknessMismatch: true } }
    const info = { formatFamily: 'opd', reader: { name: 'opd-structure', version: 2 }, groups: [opd90] }
    const src = R.snapshotFormatSourceOf(info)
    expect(src).toEqual({ formatFamily: 'opd', reader: { name: 'opd-structure', version: 2 }, ampScale: amp, vSignEstimated: false })
    expect(R.snapshotFormatSourceOf({ ...info, groups: [opd270] }).vSignEstimated).toBe(true)
    const snap = R.snapshotOf(defaultPost(SHA), [0], { groupId: 0, scanMm: 20, beam: 19 }, src)
    expect(snap.formatSource).toEqual(src)
    expect(R.snapshotCursor(snap)).toEqual({ groupId: 0, scanMm: 20, beam: 19 })
    const r: IndicationRecord = build().record
    const flags = (m: Map<number, unknown>): string[] => R.recordFlags(r, m).map((f: { code: string }) => f.code)
    expect(flags(new Map([[0, opd90]]))).toEqual(['unverified', 'estimated'])
    const t270 = R.recordFlags(r, new Map([[0, { ...opd270, id: 0 }]]))
    expect(t270.map((f: { code: string }) => f.code)).toEqual(['unverified', 'estimated', 'thickness'])
    expect(t270.find((f: { code: string }) => f.code === 'estimated').title).toContain('스큐 270 의 V')
    // NDE 그룹(추정 눈금 아님)에는 붙지 않는다
    expect(flags(new Map([[0, G]]))).toEqual([])
  })
})
