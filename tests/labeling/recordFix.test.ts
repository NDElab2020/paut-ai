/**
 * 1b 검토 반영 (renderer/src/labeling — 순수, 합성 볼륨):
 *  - 높이: 아래 점이 위 점보다 얕으면 막음(짝수 레그 위아래), 레그가 다르면 경고, 경계 ± 0.3 mm 는 면으로 붙임
 *  - 신호 = 단면 둘레 최대 (찍은 점 한 픽셀이 아님), 찍은 점이 6 dB 넘게 낮으면 경고, 평가 기준 미만 경고
 *  - 고치기에서 진폭을 못 읽으면 고치기 전 신호를 둠, 새 결함이고 진폭을 읽는 중이면 저장을 막음
 *  - 길이 점은 저장 직전 지금 단면 기준점으로 (옛 V·깊이가 파생 위치에 남지 않음)
 *  - 사각형: 레그 경계를 넘으면 최대 진폭 점 레그로 자름, 에코 범위 자동(평가 기준 이상 칸 덩어리)
 *  - 존재 확신도·형상 불완전 세부는 미리 채우지 않음(골라야 저장), 결함은 에코 범위 필수, 엑셀 기록의 길이·높이는 다시 재지 않으면 둠
 *  - 고정 지시 번호 (A1·C1, 지운 번호도 다시 쓰지 않음), 제안 기록의 '길이' 줄은 기록 길이(곡률 보정 뒤)와 같은 기준
 *  - 정수 빔 점(끝 빔 선 위 N 점)도 읽기값이 있다
 */
import { describe, expect, it } from 'vitest'
import { rawToPercent, samplePoint, type ViewerGroup } from '@shared/imaging'
import { groupLevelsOf, newIndicationRecord, type IndicationRecord } from '@shared/labels'
import { KEY, SHA, T, draftPoint, levelGroup, loadRenderer, uuid } from './panelKit'

const R = await loadRenderer('record')
const RD = await loadRenderer('reading')
const CV = await loadRenderer('convert')
const ST = await loadRenderer('state')

const NS = 41
const G = levelGroup(90, 0, NS)
const GROUPS = new Map([[0, G]])

/** 합성 볼륨 (Int16): (V, 펼친 깊이) 가우시안 반사체 하나, 스캔 [k0, k1] */
function volume(g: ViewerGroup, blob: { k0: number; k1: number; vMm: number; dMm: number; pct: number; sigmaMm?: number }, noisePct = 2) {
  const [ns, nb, nt] = g.shape
  const amp = new Int16Array(ns * nb * nt)
  const toRaw = (pct: number): number => Math.min(32767, Math.round((pct / g.ampScale.unitMax) * g.ampScale.rawMax))
  for (let b = 0; b < nb; b++) {
    for (let i = 0; i < nt; i++) {
      const p = samplePoint(g.beams[b]!, i, g.ultrasound)
      const s = blob.sigmaMm ?? 0.7
      const a = blob.pct * Math.exp(-((p.vMm - blob.vMm) ** 2 + (p.depthMm - blob.dMm) ** 2) / (2 * s * s))
      for (let k = 0; k < ns; k++) amp[(k * nb + b) * nt + i] = toRaw(k >= blob.k0 && k <= blob.k1 ? Math.max(noisePct, a) : noisePct)
    }
  }
  return { amplitude: amp, status: null }
}

const BLOB = { k0: 15, k1: 25, vMm: 0, dMm: 20, pct: 90 }
const VOL = volume(G, BLOB)
const source = (gid: number) => (gid === 0 ? { group: G, volume: VOL } : null)

function form0(over: Record<string, unknown> = {}) {
  return { ...R.defaultForm('blind'), existenceConfidence: 'certain', ...over }
}

function stateWith(points: Array<Record<string, unknown>>, rect: Record<string, unknown> | null = null) {
  let s = ST.initialLabelState()
  for (const p of points) s = ST.labelReducer(s, { type: 'addPoint', point: p })
  if (rect) s = ST.labelReducer(s, { type: 'setRect', rect })
  return s
}

function build(over: Record<string, unknown>) {
  return R.buildRecord({
    key: KEY,
    uuid: uuid(1),
    base: null,
    form: form0(),
    groups: GROUPS,
    thicknessMm: T,
    peak: null,
    levelsOf: (id: number) => groupLevelsOf(GROUPS.get(id)!, T),
    shownSuggestion: null,
    viewSnapshot: null,
    ...over
  })
}

const at = (id: string, role: string, depthMm: number, leg: number) => ({
  id,
  role,
  anchor: { groupId: 0, scanIndex: 1, beam: 1, sample: 1, coordRulesVersion: 1, groupVerified: true },
  leg,
  displayGainDb: 0,
  mm: { scanMm: 1, vMm: 0, depthMm }
})

describe('높이: 레그·위아래 검사', () => {
  it('아래 점이 위 점보다 얕으면 막는다 (짝수 레그는 화면 위아래가 반대)', () => {
    const h = R.heightOf('tip-tip', [at('p1', 'tip-top', 10, 1), at('p2', 'tip-bottom', 8, 1)], T)
    expect(h.problem).toContain('얕습니다')
    expect(R.heightOf('tip-tip', [at('p1', 'tip-top', 8, 1), at('p2', 'tip-bottom', 10, 1)], T)).toMatchObject({ problem: null, warning: null, height: { valueMm: 2 } })
  })

  it('두 점의 레그가 다르면 경고 (레그 경계를 넘은 두 반사), 경계 ± 0.3 mm 안이면 면으로 붙인다', () => {
    // 검토 지적 예: 위 팁 10 mm L1 · 아래 팁 8 mm L2 → 예전에는 높이 2 로 조용히 저장
    const cross = R.heightOf('tip-tip', [at('p1', 'tip-top', 10, 1), at('p2', 'tip-bottom', 8, 2)], T)
    expect(cross.problem).toContain('얕습니다')
    expect(cross.warning).toContain('서로 다른 레그')
    // 위 팁 11.0 (L1) · 아래 팁 펼친 12.2 (L2 → 실제 11.8) → 경계(12)에 붙여 높이 1
    const snap = R.heightOf('tip-tip', [at('p1', 'tip-top', 11, 1), at('p2', 'tip-bottom', 11.8, 2)], T)
    expect(snap.problem).toBeNull()
    expect(snap.height.valueMm).toBeCloseTo(1, 6)
    expect(snap.warning).toContain('붙였습니다')
  })
})

describe('신호 = 단면 둘레 최대 (파일 이득 0 dB)', () => {
  it('최대 진폭 점을 1 mm 비켜 찍어도 신호는 둘레 최대, 찍은 값이 6 dB 넘게 낮으면 경고', () => {
    const off = draftPoint(G, 'peak', 20, 0, 21.2) // 1.2 mm 깊게
    const s = stateWith([off], { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -0.5, vMaxMm: 0.5, depthMinMm: 19.5, depthMaxMm: 20.5, displayGainDb: 0 })
    const clicked = RD.sscanPointReading(G, VOL, 20, off.vMm, off.unfoldedDepthMm, T)
    expect(clicked.amplitudePct).toBeLessThan(45)
    const region = R.regionPeakOf(s.draft, source, T)
    expect(region.volumeMissing).toBe(false)
    expect(region.reading.amplitudePct).toBeGreaterThan(80)
    const out = build({ draft: s.draft, peak: region.reading, clicked, form: form0({ heightMethod: 'unmeasurable' }) })
    expect(out.problems).toEqual([])
    expect(out.record.signal.maxAmplitudePct).toBeGreaterThan(80)
    expect(out.record.signal.exceedsEvaluationLevel).toBe(true)
    expect(out.warnings.join(' ')).toContain('dB 낮습니다')
  })

  it('길이가 있으면 길이 구간 전체에서 찾는다 (스캔 위치도 최대 칸)', () => {
    const vol = volume(G, { ...BLOB, k0: 18, k1: 18 }) // 칸 18 에만 반사체
    const s0 = stateWith([draftPoint(G, 'peak', 20, 0, 20)], { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -0.5, vMaxMm: 0.5, depthMinMm: 19.5, depthMaxMm: 20.5, displayGainDb: 0 })
    const pts = R.lengthPointsFor(G, s0.draft, { groupId: 0, scanMm: 10, beam: 19 }, 30, T, () => null, 0)
    const s = ST.labelReducer(s0, { type: 'setPoints', points: pts })
    const r = R.regionPeakOf(s.draft, () => ({ group: G, volume: vol }), T).reading
    expect(r.scanIndex).toBe(18)
    expect(r.amplitudePct).toBeGreaterThan(80)
  })

  it('진폭을 읽는 중이면 새 결함은 저장을 막고, 고치기는 고치기 전 신호를 둔다', () => {
    const s = stateWith([draftPoint(G, 'peak', 20, 0, 20)], { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -0.5, vMaxMm: 0.5, depthMinMm: 19.5, depthMaxMm: 20.5, displayGainDb: 0 })
    const missing = R.regionPeakOf(s.draft, () => ({ group: G, volume: null }), T)
    expect(missing).toMatchObject({ reading: null, volumeMissing: true })
    const fresh = build({ draft: s.draft, peak: null, volumeReady: false, form: form0({ heightMethod: 'unmeasurable' }) })
    expect(fresh.problems.join(' ')).toContain('진폭을 아직 읽는 중')
    const base: IndicationRecord = { ...build({ draft: s.draft, peak: R.regionPeakOf(s.draft, source, T).reading, form: form0({ heightMethod: 'unmeasurable' }) }).record }
    expect(base.signal.maxAmplitudePct).toBeGreaterThan(80)
    const edit = build({ base, draft: s.draft, peak: null, volumeReady: false, form: { ...R.formFromRecord(base), note: '속성만 고침' } })
    expect(edit.problems).toEqual([])
    expect(edit.record.signal).toEqual(base.signal)
    expect(edit.warnings.join(' ')).toContain('고치기 전 값')
  })

  it('평가 기준 미만이면 경고 (검토 구간 기준 미만 지시로)', () => {
    const weak = volume(G, { ...BLOB, pct: 20 })
    const s = stateWith([draftPoint(G, 'peak', 20, 0, 20)], { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -0.5, vMaxMm: 0.5, depthMinMm: 19.5, depthMaxMm: 20.5, displayGainDb: 0 })
    const r = R.regionPeakOf(s.draft, () => ({ group: G, volume: weak }), T).reading
    const out = build({ draft: s.draft, peak: r, form: form0({ heightMethod: 'unmeasurable' }) })
    expect(out.record.signal.exceedsEvaluationLevel).toBe(false)
    expect(out.warnings.join(' ')).toContain('기준 미만')
  })
})

describe('길이 점 · 사각형', () => {
  it('길이를 정한 뒤 최대 진폭 점을 옮기면 저장할 때 길이 점도 그 자리로 (옛 V·깊이가 파생 위치에 남지 않음)', () => {
    let s = stateWith([draftPoint(G, 'peak', 20, 0, 20)])
    s = ST.labelReducer(s, { type: 'setPoints', points: R.lengthPointsFor(G, s.draft, { groupId: 0, scanMm: 16, beam: 19 }, 24, T, () => null, 0) })
    s = ST.labelReducer(s, { type: 'addPoint', point: draftPoint(G, 'peak', 20, 1.5, 21.5) })
    const out = build({ draft: s.draft, form: form0({ heightMethod: 'unmeasurable', kind: 'geometric-echo' }) })
    expect(out.problems).toEqual([])
    const d = out.record.derived
    expect(d.vMinMm).toBeCloseTo(1.5, 6)
    expect(d.vMaxMm).toBeCloseTo(1.5, 6)
    expect(d.depthTopMm).toBeCloseTo(24 - 21.5, 6)
    expect(d.depthBottomMm).toBeCloseTo(24 - 21.5, 6)
    expect(d.scanStartMm).toBe(16)
  })

  it('레그 경계를 넘는 사각형은 최대 진폭 점의 레그 안으로 자른다 (펼친 10~14 → 실제 10~12)', () => {
    const rect = { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -1, vMaxMm: 1, depthMinMm: 10, depthMaxMm: 14, displayGainDb: 0 }
    const ra = CV.rectAnchors(rect, G, T, ['p1', 'p2'], 1, 1)
    expect(ra.clippedToLeg).toBe(1)
    const depths = ra.points.map((p: { mm: { depthMm: number } }) => p.mm.depthMm).sort((a: number, b: number) => a - b)
    expect(depths[0]).toBeCloseTo(10, 6)
    expect(depths[1]).toBeCloseTo(12, 3)
    expect(ra.points.every((p: { leg: number }) => p.leg === 1)).toBe(true)
    // 두께를 모르면 자르지 않는다
    expect(CV.clipRectToLeg(rect, null).leg).toBeNull()
  })

  it('에코 범위 자동: 최대 진폭 칸에서 평가 기준 이상으로 이어진 칸 덩어리의 범위', () => {
    const pk = draftPoint(G, 'peak', 20, 0, 20)
    const lv = groupLevelsOf(G, T)!
    const r = R.echoRangeRect(G, VOL, 20, { beam: pk.beam, sample: pk.sample }, lv.evaluationPct, T, 0)
    expect(r.reason).toBeNull()
    expect(r.cells).toBeGreaterThan(1)
    expect(r.rect.vMinMm).toBeLessThan(0)
    expect(r.rect.vMaxMm).toBeGreaterThan(0)
    expect(r.rect.depthMinMm).toBeLessThan(20)
    expect(r.rect.depthMaxMm).toBeGreaterThan(20)
    expect(r.rect.depthMaxMm - r.rect.depthMinMm).toBeLessThan(4)
    // 반사체가 없는 칸은 이유
    expect(R.echoRangeRect(G, VOL, 5, { beam: pk.beam, sample: pk.sample }, lv.evaluationPct, T, 0).rect).toBeNull()
  })
})

describe('속성 필수 · 엑셀 기록 · 번호 · 제안 기준', () => {
  it('존재 확신도·형상 불완전 세부는 미리 채우지 않는다 — 고르지 않으면 저장을 막는다. 결함은 에코 범위 필수', () => {
    expect(R.defaultForm('blind')).toMatchObject({ existenceConfidence: null, imperfectionKind: null, lengthThresholdPct: null })
    const rect = { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -0.5, vMaxMm: 0.5, depthMinMm: 19.5, depthMaxMm: 20.5, displayGainDb: 0 }
    const s = stateWith([draftPoint(G, 'peak', 20, 0, 20)], rect)
    const noConf = build({ draft: s.draft, form: { ...R.defaultForm('blind'), heightMethod: 'unmeasurable' } })
    expect(noConf.problems.join(' ')).toContain('존재 확신도')
    const imp = build({ draft: s.draft, form: form0({ kind: 'geometric-imperfection' }) })
    expect(imp.problems.join(' ')).toContain('형상 불완전 세부')
    const noRect = build({ draft: stateWith([draftPoint(G, 'peak', 20, 0, 20)]).draft, form: form0({ heightMethod: 'unmeasurable' }) })
    expect(noRect.problems.join(' ')).toContain('에코 범위')
    // 다음 양식은 존재 확신도를 이어받지 않는다
    expect(R.nextForm(form0({ heightMethod: 'tip-surface' }), 'blind')).toMatchObject({ existenceConfidence: null, heightMethod: 'tip-surface' })
  })

  it('엑셀 기록에 점을 찍어 앵커 기록으로 바꿀 때 다시 재지 않은 길이·높이는 그대로 두고 알린다', () => {
    const imported = newIndicationRecord({
      uuid: uuid(5),
      sha256: SHA,
      labelerId: 'kim-l2',
      guidelineVersion: 'v1',
      derived: { scanStartMm: 15, scanEndMm: 25, vMinMm: -1, vMaxMm: 1, depthTopMm: 3, depthBottomMm: 5 },
      length: { valueMm: 10, method: 'eval-level' },
      height: { method: 'tip-tip', valueMm: 2 },
      externalRef: '3'
    })
    const s = stateWith([draftPoint(G, 'peak', 20, 0, 20)], { groupId: 0, scanIndex: 20, scanMm: 20, vMinMm: -0.5, vMaxMm: 0.5, depthMinMm: 19.5, depthMaxMm: 20.5, displayGainDb: 0 })
    const out = build({ base: imported, draft: s.draft, form: { ...R.formFromRecord(imported), heightMethod: 'tip-tip' } })
    expect(out.problems).toEqual([])
    expect(out.record.coordSource).toBe('app-anchor')
    expect(out.record.length.valueMm).toBe(10)
    expect(out.record.height.valueMm).toBe(2)
    expect(out.warnings.join(' ')).toContain('엑셀 길이 10 mm')
    expect(out.warnings.join(' ')).toContain('엑셀 높이 2 mm')
  })

  it('고정 지시 번호: 블라인드 A1…, 대조 단계에서 더한 것은 C1…, 지운 번호도 다시 쓰지 않음', () => {
    const rs = [{ externalRef: 'A1' }, { externalRef: 'A4' }, { externalRef: '7' }, { externalRef: null }, { externalRef: 'C2' }]
    expect(R.nextExternalRef(rs, 'blind')).toBe('A5')
    expect(R.nextExternalRef(rs, 'reconciled')).toBe('C3')
    expect(R.nextExternalRef([], 'blind')).toBe('A1')
  })

  it('제안 기록의 길이 줄은 기록 길이(곡률 보정 뒤)와 같은 기준으로 비교한다', () => {
    const sug = { available: true, rule: '6db-curvature', ruleDb: -6, lengthMm: 9, scanStartMm: 10, scanEndMm: 20 }
    const rows = R.suggestionRecords(sug, { groupId: 0, startMm: 10, endMm: 20, beam: 19, lengthMm: 10 }, 9.5)
    expect(rows[0]).toMatchObject({ target: 'length', suggestedMm: 9, finalMm: 9.5, correctionMm: 0.5 })
  })
})

describe('읽기값 · 칸', () => {
  it('칸 읽기값(cellReading)은 그 칸 원값, 영역 최대는 데이터 없음 칸을 뺀다', () => {
    const [, nb, nt] = G.shape
    const pk = draftPoint(G, 'peak', 20, 0, 20)
    const b = Math.round(pk.beam)
    const s = Math.round(pk.sample)
    const r = RD.cellReading(G, VOL, 20, b, s, T)
    expect(r.amplitudePct).toBeCloseTo(rawToPercent(VOL.amplitude[(20 * nb + b) * nt + s]!, G.ampScale), 6)
    expect(r.nearestBeam).toBe(b)
    const status = new Uint8Array(G.shape[0] * nb).fill(1)
    for (let bb = 0; bb < nb; bb++) status[20 * nb + bb] = 0
    expect(RD.regionPeakReading(G, { amplitude: VOL.amplitude, status }, { k0: 20, k1: 20, b0: 0, b1: nb - 1, d0: 0, d1: 40 }, T)).toBeNull()
  })
})

/**
 * 2026-10-07 빌드 전 검토 반영 (renderer — 순수):
 *  - 초안 경고(draftWarnings): LabelPanel 렌더 안에 있던 계산을 옮긴 것 — 최대 진폭 빔·대조 전·OPD(스캔 동기 모름·추정 눈금·스큐 270·두께 확인)
 *  - 지시 표에서 고를 때 갈 곳(gotoTargetOf): 그룹·최대 진폭 스캔이 빈 엑셀 기록은 지금 그룹 · 스캔 구간 가운데 (groupGuessed)
 *  - 기록 화면 스냅샷의 불러온 색표 칸(paletteFile{name, sha256}) — 색표가 없으면 칸이 없다(스냅샷 바이트 그대로), 동기 SHA-256 은 node:crypto 와 같음
 */
const { createHash } = await import('node:crypto')
const SHA_MOD = '../../src/renderer/src/lib/sha256'
const SH = (await import(/* @vite-ignore */ SHA_MOD)) as { sha256Hex: (t: string) => string }

describe('초안 경고 · 갈 곳 · 스냅샷 색표 (2026-10-07)', () => {
  const NDE_INFO = { formatFamily: 'nde-4', specimen: { thicknessMm: T } }
  const OPD_INFO = { formatFamily: 'opd', scanSync: 'unknown', specimen: { thicknessMm: 9 } }
  const opdGroup = (skew: 90 | 270): ViewerGroup => {
    const g = levelGroup(skew, 0, NS)
    return { ...g, verified: false, name: `OPD ${skew}`, ampScale: { ...g.ampScale, estimated: true }, selfCheck: { thicknessMismatch: true } } as unknown as ViewerGroup
  }
  const pk = draftPoint(G, 'peak', 20, 0, 20)

  it('NDE 대조한 그룹·빈 초안: 경고 없음, 길이 빔이 최대 진폭 빔과 다르면 지침서 6.2 경고와 peakBeam', () => {
    expect(R.draftWarnings({ draft: { points: [], rect: null }, groups: GROUPS, info: NDE_INFO, length: null, peak: null })).toEqual({ warnings: [], peakBeam: null, ampEstimated: false })
    const g = { ...G, verified: true } as ViewerGroup
    const len = { groupId: 0, startMm: 10, endMm: 20, beam: 3, lengthMm: 10 }
    const w = R.draftWarnings({ draft: { points: [pk], rect: null }, groups: new Map([[0, g]]), info: NDE_INFO, length: len, peak: { groupId: 0, nearestBeam: 7 } })
    expect(w.peakBeam).toBe(7)
    expect(w.warnings).toHaveLength(1)
    expect(w.warnings[0]).toContain('지침서 6.2')
    expect(w.warnings[0]).toContain(R.beamTextOf(g, 3))
    // 같은 빔이면 경고 없음
    expect(R.draftWarnings({ draft: { points: [pk], rect: null }, groups: new Map([[0, g]]), info: NDE_INFO, length: len, peak: { groupId: 0, nearestBeam: 3 } }).warnings).toEqual([])
  })

  it('OPD: 대조 전(OPD)·스캔 동기 모름·추정 눈금(스큐 270 이면 V 부호)·두께 확인 — 사각형만 찍어도 같은 경고', () => {
    for (const skew of [90, 270] as const) {
      const g = opdGroup(skew)
      const groups = new Map([[0, g]])
      const w = R.draftWarnings({ draft: { points: [{ ...pk, groupId: 0 }], rect: null }, groups, info: OPD_INFO, length: null, peak: null })
      expect(w.ampEstimated).toBe(true)
      expect(w.warnings).toHaveLength(4)
      expect(w.warnings[0]).toBe(`OPD ${skew} 그룹은 OmniPC 대조 전입니다(OPD). 라벨은 되지만 자동 변환·학습 내보내기에서 막힙니다.`)
      expect(w.warnings[1]).toContain('스캔 축 동기 방식을 몰라')
      expect(w.warnings[2]).toContain(skew === 270 ? '·V(스큐 270 출사점 부호)' : 'OPD 최대 진폭 %는 추정 값')
      expect(w.warnings[3]).toContain('두께 칸(9 mm)')
      const r = R.draftWarnings({ draft: { points: [], rect: { groupId: 0 } }, groups, info: OPD_INFO, length: null, peak: null })
      expect(r.warnings).toEqual(w.warnings)
    }
    // 점이 없으면 OPD 라도 경고 없음 (그룹이 정해지지 않음)
    expect(R.draftWarnings({ draft: { points: [], rect: null }, groups: new Map([[0, opdGroup(90)]]), info: OPD_INFO, length: null, peak: null }).warnings).toEqual([])
  })

  it('시간 동기 위치는 명목값으로 경고하고 엔코더 동기에 같은 경고를 붙이지 않는다', () => {
    const query = { draft: { points: [pk], rect: null }, groups: GROUPS, length: null, peak: null }
    const timed = R.draftWarnings({ ...query, info: { ...OPD_INFO, scanSync: 'time' } }).warnings
    expect(timed.some((s: string) => s.includes('시간 동기') && s.includes('엔코더 실측 위치가 아니므로'))).toBe(true)
    const encoded = R.draftWarnings({ ...query, info: { ...OPD_INFO, scanSync: 'encoder' } }).warnings
    expect(encoded.some((s: string) => s.includes('명목값'))).toBe(false)
  })

  it('갈 곳: 최대 진폭 → 스냅샷 커서 → 그룹 모르는 엑셀 기록은 지금 그룹·스캔 구간 가운데 (groupGuessed)', () => {
    const base = newIndicationRecord({ uuid: uuid(9), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', readingStage: 'blind', kind: 'defect' }) as IndicationRecord
    const excel: IndicationRecord = { ...base, derived: { ...base.derived, scanStartMm: 150, scanEndMm: 171 } }
    expect(R.gotoOf(excel)).toBeNull()
    expect(R.gotoTargetOf(excel, 2)).toEqual({ groupId: 2, scanMm: 160.5, groupGuessed: true })
    const snap = R.snapshotOf({ ...defaultPostOf(), palette: { minPct: 0, maxPct: 100 } }, [0], { groupId: 1, scanMm: 40, beam: 5 })
    expect(R.gotoTargetOf({ ...excel, viewSnapshot: snap }, 2)).toEqual({ groupId: 1, scanMm: 40, beam: 5 })
    const withPeak: IndicationRecord = { ...excel, signal: { ...excel.signal, peak: { groupId: 0, scanMm: 155, beam: 4 } as IndicationRecord['signal']['peak'] } }
    expect(R.gotoTargetOf(withPeak, 2)).toEqual({ groupId: 0, scanMm: 155, beam: 4 })
  })

  it('스냅샷 색표 칸: 불러온 색표가 있을 때만 {name, sha256}, SHA-256 은 node:crypto 와 같음', () => {
    const post = defaultPostOf()
    const plain = R.snapshotOf(post, [0], { groupId: 0, scanMm: 1, beam: 2 })
    expect('paletteFile' in plain).toBe(false)
    const colors = Array.from({ length: 256 }, (_, i) => (i * 65793).toString(16).padStart(6, '0').slice(-6))
    const withPal = R.snapshotOf({ ...post, paletteFile: { name: 'EVDNT_AmplitudeCut', palette: colors, specialColors: ['000000', 'ffffff', '808080'] } }, [0], { groupId: 0, scanMm: 1, beam: 2 })
    const want = createHash('sha256').update(colors.join(',')).digest('hex')
    expect(withPal.paletteFile).toEqual({ name: 'EVDNT_AmplitudeCut', sha256: want })
    // 색표 칸을 빼면 나머지는 같은 스냅샷
    const { paletteFile: _p, ...rest } = withPal
    expect(JSON.stringify(rest)).toBe(JSON.stringify(plain))
    for (const t of ['', 'abc', '가나다 · ✓', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)]) {
      expect(SH.sha256Hex(t)).toBe(createHash('sha256').update(t, 'utf8').digest('hex'))
    }
  })
})

function defaultPostOf() {
  return { version: 1, rulesVersion: 1, fileSha256: SHA, sscanDepthMm: null, scanRangeMm: null, cscanReversed: null, palette: { minPct: 0, maxPct: 100 }, groups: {} } as const
}
