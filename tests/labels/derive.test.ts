/**
 * 기록 → 학습 라벨 계산 (shared/labels/derive) — 합성 볼륨 시험.
 * X3 12T-SV-01 의 셋업(빔·시간축·게이트·개선 형상)만 빌려 좌표를 쓰고, 진폭은 위치를 아는 반사체로 합성한다.
 *   (a) 알려진 반사체 → 투영 칸·장면 상자가 그 칸을 포함
 *   (c) 포화 기록 → 길이 '제안 불가', 동적 범위 부족 → '제안 불가'
 *   (d) 같은 입력 두 번(기록 순서를 섞어도) → 같은 출력 (JSON 비교)
 *   그 밖: 앵커 왕복, U → 스캔 칸, 약한 양성·불확실·품질 불량·기준 미만, 형상 에코 후보와 결함 우선, 앵커 기록 재계산
 */
import { existsSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { readViewerInfo } from '@core/nde/viewer'
import { samplePoint, type ViewerFileInfo, type ViewerGroup } from '@shared/imaging'
import { LABEL_COORD_RULES_VERSION, newIndicationRecord, newObservationRow, newReviewInterval, type IndicationRecord, type ReviewInterval } from '@shared/labels'
import {
  LABEL_DERIVE_RULES_VERSION,
  amplitudeFromChunks,
  amplitudeFromFunction,
  amplitudeFromVolume,
  anchorToPoint,
  ascanLabelAt,
  bscanBoxesForBeam,
  buildCellGeometry,
  deriveFileLabels,
  echoCandidateRecordFields,
  estimateAnchors,
  groupLevelsOf,
  pointToAnchor,
  prepareDerive,
  regionOf,
  resolveDeriveRules,
  runDerive,
  scanRangeForU,
  sectionRanges,
  suggestGeometricEchoes,
  suggestLength,
  unfoldDepth,
  windowRanges,
  type DeriveFileInput,
  type GroupCellGeometry
} from '@shared/labels/derive'
import { X3_FILES } from '../paths'

const FILE = X3_FILES[0]!
const HAS = existsSync(FILE)
const NS = 61
const SHA = 'a'.repeat(64)
const T = 12

let info: ViewerFileInfo
let G0: ViewerGroup
let G1: ViewerGroup
let geo0: GroupCellGeometry
let geo1: GroupCellGeometry

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** X3 그룹을 스캔 NS 칸짜리로 (좌표·게이트는 그대로) */
function shortGroup(g: ViewerGroup): ViewerGroup {
  return { ...g, shape: [NS, g.shape[1], g.shape[2]], scan: { offsetMm: 0, resolutionMm: 1, count: NS }, bytes: NS * g.shape[1] * g.shape[2] * 2 }
}

interface Reflector {
  /** 스캔 중심·반길이 (mm) — 반길이 안은 같은 세기(평탄), 밖은 0 */
  u0: number
  halfLen: number
  vMm: number
  /** 실제 깊이와 맺히는 레그 */
  depthMm: number
  leg: number
  pct: number
  sigmaMm: number
  /** 이 그룹에만 (없으면 모든 그룹) */
  groupId?: number
}

/** 합성 int16 볼륨: 바탕 noisePct + 반사체들 (펼친 좌표 (V, 펼친 깊이) 가우시안, 최대값끼리 겹침) */
function synthVolume(g: ViewerGroup, geom: GroupCellGeometry, refl: readonly Reflector[], noisePct = 2): Int16Array {
  const [ns, nb, nt] = g.shape
  const out = new Int16Array(ns * nb * nt)
  const rawOf = (pct: number): number => Math.min(32767, Math.round((pct / 200) * 32767))
  for (let k = 0; k < ns; k++) {
    const active = refl.filter((r) => (r.groupId === undefined || r.groupId === g.id) && Math.abs(k - r.u0) <= r.halfLen)
    for (let c = 0; c < nb * nt; c++) {
      let v = noisePct
      for (const r of active) {
        const dv = geom.vMm[c]! - r.vMm
        const dd = geom.unfoldedMm[c]! - unfoldDepth(r.depthMm, r.leg, T)
        const a = r.pct * Math.exp(-(dv * dv + dd * dd) / (2 * r.sigmaMm * r.sigmaMm))
        if (a > v) v = a
      }
      out[k * nb * nt + c] = rawOf(v)
    }
  }
  return out
}

function input(refl: readonly Reflector[], records: IndicationRecord[], extra: Partial<DeriveFileInput> = {}): DeriveFileInput {
  return {
    sha256: SHA,
    thicknessMm: T,
    outerDiameterMm: null,
    weld: info.specimen.weld,
    groups: [G0, G1].map((g, j) => ({ group: g, amplitude: amplitudeFromVolume(g, synthVolume(g, j === 0 ? geo0 : geo1, refl), null) })),
    records,
    reviewIntervals: [],
    ...extra
  }
}

function rec(n: number, init: Partial<Parameters<typeof newIndicationRecord>[0]>): IndicationRecord {
  return newIndicationRecord({ uuid: uuid(n), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', ...init })
}

function reviewed(n: number, s0: number, s1: number, extra: Partial<ReviewInterval> = {}): ReviewInterval {
  return newReviewInterval({ uuid: uuid(900 + n), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', kind: 'reviewed', scanStartMm: s0, scanEndMm: s1, ...extra })
}

/** 반사체 중심이 맺힌 칸 (그룹 g, 레그 L 에서 가장 가까운 칸) */
function nearestCell(geom: GroupCellGeometry, vMm: number, unfolded: number): { b: number; i: number; d: number } {
  let best = { b: -1, i: -1, d: Infinity }
  for (let b = 0; b < geom.nb; b++) {
    for (let i = 0; i < geom.nt; i++) {
      const c = b * geom.nt + i
      const d = Math.hypot(geom.vMm[c]! - vMm, geom.unfoldedMm[c]! - unfolded)
      if (d < best.d) best = { b, i, d }
    }
  }
  return best
}

describe.skipIf(!HAS)('기록 → 학습 라벨 (합성 볼륨)', () => {
  beforeAll(async () => {
    info = await readViewerInfo(FILE)
    G0 = shortGroup(info.groups[0]!)
    G1 = shortGroup(info.groups[1]!)
    geo0 = buildCellGeometry(G0, T, 4)
    geo1 = buildCellGeometry(G1, T, 4)
  })

  it('칸 기하: X3 한 그룹 31 × 808 칸, 레그 1~4, samplePoint 와 같은 값', () => {
    expect(geo0.nb * geo0.nt).toBe(31 * 808)
    expect(geo0.legs).toEqual([1, 2, 3, 4])
    const p = samplePoint(G0.beams[17]!, 400, G0.ultrasound)
    expect(geo0.vMm[17 * 808 + 400]).toBe(p.vMm)
    expect(geo0.unfoldedMm[17 * 808 + 400]).toBe(p.depthMm)
  })

  it('U → 스캔 칸: mm 로 겹침을 보고 floor/ceil, 축 밖은 null (끝 칸에 붙이지 않음)', () => {
    const ax = { offsetMm: 0, resolutionMm: 1, count: 301 }
    expect(scanRangeForU(ax, 120, 148)).toEqual([120, 148])
    expect(scanRangeForU(ax, 120.5, 148.5)).toEqual([121, 148])
    expect(scanRangeForU(ax, 120.2, 120.3)).toEqual([120, 120])
    expect(scanRangeForU(ax, 310, 320)).toBeNull()
    expect(scanRangeForU(ax, -20, -5)).toBeNull()
    expect(scanRangeForU(ax, -20, 2)).toEqual([0, 2])
    expect(scanRangeForU(ax, 299, 400)).toEqual([299, 300])
  })

  it('앵커 왕복: 점 → 앵커 → 점 오차 1e-6 mm 안, 정수 빔 앵커는 samplePoint 그대로', () => {
    let worst = 0
    let n = 0
    for (const [v, d] of [
      [0, 10],
      [2.3, 15.7],
      [-4.1, 6.2],
      [6.5, 20.1],
      [-1.2, 26.4],
      [3.3, 33.3]
    ] as const) {
      for (const g of [G0, G1]) {
        const a = pointToAnchor(g, 30, v, d)
        if (!a) continue
        const p = anchorToPoint(g, a, T)!
        worst = Math.max(worst, Math.hypot(p.vMm - v, p.unfoldedDepthMm - d), Math.abs(p.scanMm - 30))
        n++
      }
    }
    expect(n).toBeGreaterThanOrEqual(6)
    expect(worst).toBeLessThan(1e-6)
    const q = anchorToPoint(G0, { scanIndex: 5, beam: 12, sample: 333 }, T)!
    const s = samplePoint(G0.beams[12]!, 333, G0.ultrasound)
    expect(q.vMm).toBe(s.vMm)
    expect(q.unfoldedDepthMm).toBe(s.depthMm)
    expect(q.scanMm).toBe(5)
    expect(pointToAnchor(G0, 0, -80, 5)).toBeNull()
  })

  it('(a) 알려진 반사체: 투영 칸이 반사체 칸을 포함, 관측 = 그 레그만 보임, 양성 장면 상자가 반사체를 포함', () => {
    const R: Reflector = { u0: 30, halfLen: 4, vMm: 2, depthMm: 6, leg: 2, pct: 100, sigmaMm: 0.7, groupId: 0 }
    const r = rec(1, { derived: { scanStartMm: 26, scanEndMm: 34, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 }, defectType: 'slag' })
    const run = runDerive(input([R], [r], { reviewIntervals: [reviewed(1, 0, 60)] }))
    const out = run.result
    expect(out.rulesVersion).toBe(LABEL_DERIVE_RULES_VERSION)
    // 반사체 칸
    const D0 = unfoldDepth(R.depthMm, R.leg, T)
    const cell = nearestCell(geo0, R.vMm, D0)
    expect(cell.d).toBeLessThan(0.6)
    // 투영 범위 (그룹 0, 레그 2) 가 그 칸을 포함
    const row = out.observations.find((o) => o.groupId === 0 && o.leg === 2)!
    expect(row.projected).not.toBeNull()
    expect(cell.b).toBeGreaterThanOrEqual(row.projected!.beamMin)
    expect(cell.b).toBeLessThanOrEqual(row.projected!.beamMax)
    expect(cell.i).toBeGreaterThanOrEqual(row.projected!.sampleMin)
    expect(cell.i).toBeLessThanOrEqual(row.projected!.sampleMax)
    // 관측: 그룹 0 레그 2 만 보임, 나머지 안 보임 (반사체는 그룹 0 레그 2 에만 심음)
    for (const o of out.observations) expect(o.status, `g${o.groupId} L${o.leg}`).toBe(o.groupId === 0 && o.leg === 2 ? 'visible' : 'not-visible')
    // 칸이 반사체 중심에서 빔 간격만큼 떨어질 수 있어(σ 0.7 mm 가우시안) 100 % 보다 조금 낮다
    expect(row.search!.maxAmplitudePct).toBeGreaterThan(80)
    expect(row.search!.scanStartMm).toBe(26)
    expect(row.search!.scanEndMm).toBe(34)
    expect(row.saturated).toBe(false)
    // 장면: 26~34 양성, 상자가 반사체 중심을 포함
    const g0 = out.scenes.filter((s) => s.groupId === 0)
    for (let k = 26; k <= 34; k++) {
      const s = g0[k]!
      expect(s.state, `scan ${k}`).toBe('positive')
      const o = s.objects.find((x) => x.leg === 2 && x.status === 'positive')!
      expect(o.box).not.toBeNull()
      const b = o.box!
      expect(R.vMm).toBeGreaterThanOrEqual(b.vMinMm - 0.3)
      expect(R.vMm).toBeLessThanOrEqual(b.vMaxMm + 0.3)
      expect(D0).toBeGreaterThanOrEqual(b.depthMinMm - 0.3)
      expect(D0).toBeLessThanOrEqual(b.depthMaxMm + 0.3)
      expect(cell.b).toBeGreaterThanOrEqual(b.beamMin)
      expect(cell.b).toBeLessThanOrEqual(b.beamMax)
      // 기록 기준(63.5 %) 윤곽: 가우시안 σ 0.7 mm → 반폭 √(2 ln(100/63.5))·0.7 ≈ 0.67 mm 안팎
      expect(b.vMaxMm - b.vMinMm).toBeLessThan(3)
    }
    // 끝 여유: 바탕이 평평(2 %)하므로 고정 5 mm → 21~25, 35~39 무시, 그 밖 검토 완료 → 음성
    for (const k of [21, 25, 35, 39]) expect(g0[k]!.state, `scan ${k}`).toBe('ignore')
    for (const k of [0, 20, 40, 60]) expect(g0[k]!.state, `scan ${k}`).toBe('negative')
    // 그룹 1: 반사체가 보이지 않음 → 결함 자리는 무시(안 보임), 그 밖 음성
    const g1 = out.scenes.filter((s) => s.groupId === 1)
    expect(g1[30]!.state).toBe('ignore')
    expect(g1[30]!.objects.every((o) => o.reason === 'not-visible')).toBe(true)
    expect(g1[10]!.state).toBe('negative')
    // 음성 범위 = 파일 게이트 A (펼친 7~28 mm 부근, 레그 1~3)
    expect(g0[0]!.negativeRegion!.legMin).toBe(1)
    expect(g0[0]!.negativeRegion!.legMax).toBe(3)
    // A-scan 구간: 스캔 30 에서 반사체 빔에 양성 구간, 그 샘플 포함
    const sp = out.ascanSpans.filter((x) => x.groupId === 0 && x.scanIndex === 30 && x.beam === cell.b)
    expect(sp.length).toBeGreaterThan(0)
    expect(sp.some((x) => x.sampleStart <= cell.i && x.sampleEnd >= cell.i && x.leg === 2 && x.status === 'positive')).toBe(true)
    expect(sp[0]!.insideWeld).toBe(true) // V 2 mm, 깊이 6 mm → 개선면 안
    const al = ascanLabelAt(run, 0, 30, cell.b)
    expect(al.state).toBe('positive')
    expect(al.strongest!.recordUuid).toBe(r.uuid)
    expect(ascanLabelAt(run, 0, 10, cell.b).state).toBe('negative')
    // 결함 창을 지나지만 그 기록의 구간이 없는 빔 → 가림(무시). 안 보이는 그룹 1 의 창을 지나는 빔 → 무시
    const w0 = run.windows.get(`${r.uuid}|0|L2`)!
    const crossing = Array.from({ length: geo0.nb }, (_, b) => b).filter(
      (b) => w0.hi[b]! >= w0.lo[b]! && !out.ascanSpans.some((x) => x.groupId === 0 && x.scanIndex === 30 && x.beam === b)
    )
    expect(crossing.length).toBeGreaterThan(0)
    for (const b of crossing) expect(ascanLabelAt(run, 0, 30, b).state, `beam ${b}`).toBe('ignore')
    const w1 = run.windows.get(`${r.uuid}|1|L2`)!
    const b1 = Array.from({ length: geo1.nb }, (_, b) => b).find((b) => w1.hi[b]! >= w1.lo[b]!)!
    const al1 = ascanLabelAt(run, 1, 30, b1)
    expect(al1.state).toBe('ignore')
    expect(al1.ignoreRanges[0]).toEqual([w1.lo[b1], w1.hi[b1]])
    // C-scan 상자 (게이트 A 7~28 mm 가 레그 2 를 덮음)
    const cb = out.records[0]!.cscanBoxes.filter((b) => b.groupId === 0 && b.legs.includes(2) && b.status === "positive")
    expect(cb).toHaveLength(1)
    expect(cb[0]!.scanStartMm).toBe(26)
    expect(cb[0]!.scanEndMm).toBe(34)
    expect(cell.b).toBeGreaterThanOrEqual(cb[0]!.beamMin)
    expect(cell.b).toBeLessThanOrEqual(cb[0]!.beamMax)
    // B-scan 상자 (지금 빔 = 반사체 빔)
    const bb = bscanBoxesForBeam(run, r.uuid, 0, cell.b)
    expect(bb.find((b) => b.leg === 2 && b.status === 'positive')).toMatchObject({ scanStartMm: 26, scanEndMm: 34 })
    // 길이 제안: 평가 기준 초과 구간 = 26~34 (평탄 반사체), 길이 8
    const ls = out.records[0]!.lengthSuggestion!
    expect(ls.available).toBe(true)
    expect(ls.method).toBe('eval-level')
    expect([ls.scanStartMm, ls.scanEndMm, ls.lengthMm]).toEqual([26, 34, 8])
    expect(ls.ruleDb).toBe(-14)
    // 앵커 추정 (엑셀 기록): 그룹 0 레그 2 중심 → mm 로 돌리면 영역 중심
    const ae = out.records[0]!.anchorEstimates.find((e) => e.groupId === 0 && e.leg === 2)!
    expect(ae.centerMm!.vMm).toBeCloseTo(2, 3)
    expect(ae.centerMm!.depthMm).toBeCloseTo(6, 3)
    expect(ae.centerMm!.leg).toBe(2)
    expect(ae.center.coordRulesVersion).toBe(LABEL_COORD_RULES_VERSION)
  })

  it('영역 칸 = 정방향 계산으로 영역에 드는 칸 (빔마다 이어진 샘플 구간)', () => {
    const region = regionOf({ scanStartMm: 0, scanEndMm: 1, vMinMm: -3, vMaxMm: 3, depthTopMm: 4, depthBottomMm: 8 }, T)
    const ranges = sectionRanges(geo0, region, 2, 0)
    let n = 0
    for (let b = 0; b < geo0.nb; b++) {
      for (let i = 0; i < geo0.nt; i++) {
        const c = b * geo0.nt + i
        const inside = geo0.leg[c] === 2 && geo0.vMm[c]! >= -3 && geo0.vMm[c]! <= 3 && geo0.depthMm[c]! >= 4 && geo0.depthMm[c]! <= 8
        expect(i >= ranges.lo[b]! && i <= ranges.hi[b]!).toBe(inside)
        if (inside) n++
      }
    }
    expect(n).toBeGreaterThan(100)
    // 탐색 창은 영역을 품는다
    const w = windowRanges(geo0, region, 2, resolveDeriveRules())
    for (let b = 0; b < geo0.nb; b++) if (ranges.hi[b]! >= ranges.lo[b]!) expect(w.lo[b]! <= ranges.lo[b]! && w.hi[b]! >= ranges.hi[b]!).toBe(true)
  })

  it('약한 양성: 전문가가 기록 기준 미만으로 적은 기록(평가 초과 = 예, 기록 초과 = 아니오) → weak, 기본 학습에서는 무시', () => {
    const R: Reflector = { u0: 30, halfLen: 3, vMm: 2, depthMm: 6, leg: 2, pct: 45, sigmaMm: 0.7, groupId: 0 }
    const signal = { maxAmplitudePct: 45, exceedsEvaluationLevel: true, exceedsRecordingLevel: false }
    const r = rec(2, { derived: { scanStartMm: 27, scanEndMm: 33, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 }, signal })
    const out = deriveFileLabels(input([R], [r], { reviewIntervals: [reviewed(1, 0, 60)] }))
    const lv = groupLevelsOf(G0, T)!
    expect(lv.evaluationPct).toBeCloseTo(31.8, 1)
    expect(lv.recordingShortPct).toBeCloseTo(63.5, 1)
    expect(out.records[0]!.cap).toBe('weak')
    // 이 기록의 '보임' 문턱은 평가 기준 — 관측은 보임, 객체는 최대 약한 양성
    expect(out.observations.find((o) => o.groupId === 0 && o.leg === 2)!.status).toBe('visible')
    const s = out.scenes.find((x) => x.groupId === 0 && x.scanIndex === 30)!
    expect(s.state).toBe('weak')
    expect(s.trainState).toBe('ignore')
    const o = s.objects.find((x) => x.leg === 2)!
    expect(o.box!.thresholdPct).toBeCloseTo(lv.evaluationPct, 2)
    expect(o.trainStatus).toBe('ignore')
    expect(out.stats.scenes.weak).toBe(7)
    expect(out.stats.scenes.positive).toBe(0)
    // weakAs = 'positive' 로 바꾸면 학습 상태만 바뀐다
    const out2 = deriveFileLabels(input([R], [r], { reviewIntervals: [reviewed(1, 0, 60)], rules: { weakAs: 'positive' } }))
    expect(out2.scenes.find((x) => x.groupId === 0 && x.scanIndex === 30)!.trainState).toBe('positive')
    // 약한 양성 객체의 창은 기본 학습에서 A-scan 가림이 된다 (weakAs = 'ignore')
    const run = runDerive(input([R], [r], { reviewIntervals: [reviewed(1, 0, 60)] }))
    const cell = nearestCell(geo0, R.vMm, unfoldDepth(R.depthMm, R.leg, T))
    const al = ascanLabelAt(run, 0, 30, cell.b)
    expect(al.state).toBe('weak')
    expect(al.ignoreRanges.length).toBeGreaterThan(0)
  })

  it("관측 '약함' 레그는 약한 양성이 아니라 무시다 (규격 3.1) — 기록 등급을 적지 않은 기록의 신호가 기록 기준 미만", () => {
    const R: Reflector = { u0: 30, halfLen: 3, vMm: 2, depthMm: 6, leg: 2, pct: 45, sigmaMm: 0.7, groupId: 0 }
    const r = rec(12, { derived: { scanStartMm: 27, scanEndMm: 33, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 } })
    const out = deriveFileLabels(input([R], [r], { reviewIntervals: [reviewed(1, 0, 60)] }))
    expect(out.observations.find((o) => o.groupId === 0 && o.leg === 2)!.status).toBe('weak')
    const s = out.scenes.find((x) => x.groupId === 0 && x.scanIndex === 30)!
    expect(s.state).toBe('ignore')
    expect(s.objects.find((o) => o.leg === 2)).toMatchObject({ status: 'ignore', reason: 'weak-leg', box: null })
    expect(out.stats.scenes.weak).toBe(0)
    // 평가 기준도 못 넘는다고 적은 기록은 모두 무시
    const below = rec(13, { derived: r.derived, signal: { maxAmplitudePct: 20, exceedsEvaluationLevel: false, exceedsRecordingLevel: false } })
    const out3 = deriveFileLabels(input([R], [below], { reviewIntervals: [reviewed(1, 0, 60)] }))
    expect(out3.scenes.find((x) => x.groupId === 0 && x.scanIndex === 30)!.objects.every((o) => o.reason === 'record-below-evaluation')).toBe(true)
  })

  it('긴 지시(ℓ > t)는 기록 기준 = 평가 기준이라 약한 양성이 없다', () => {
    const R: Reflector = { u0: 30, halfLen: 10, vMm: 2, depthMm: 6, leg: 2, pct: 45, sigmaMm: 0.7, groupId: 0 }
    const r = rec(3, { derived: { scanStartMm: 20, scanEndMm: 40, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 }, length: { valueMm: 20 } })
    const out = deriveFileLabels(input([R], [r]))
    expect(out.observations.find((o) => o.groupId === 0 && o.leg === 2)!.status).toBe('visible')
    expect(out.scenes.find((x) => x.groupId === 0 && x.scanIndex === 30)!.state).toBe('positive')
  })

  it('존재 불확실 → 무시, 품질 불량 → 무시, 기준 미만 지시 → 양끝 5 mm 까지 무시, 검토 안 함 → 모름', () => {
    const R: Reflector = { u0: 30, halfLen: 3, vMm: 2, depthMm: 6, leg: 2, pct: 100, sigmaMm: 0.7, groupId: 0 }
    const r = rec(4, { existenceConfidence: 'uncertain', derived: { scanStartMm: 27, scanEndMm: 33, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 } })
    const iv = [
      reviewed(1, 0, 50),
      newReviewInterval({ uuid: uuid(950), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', kind: 'quality-bad', reason: 'coupling', scanStartMm: 5, scanEndMm: 8 }),
      newReviewInterval({ uuid: uuid(951), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', kind: 'below-threshold', groupId: 1, scanStartMm: 45, scanEndMm: 46 })
    ]
    const out = deriveFileLabels(input([R], [r], { reviewIntervals: iv }))
    const g0 = out.scenes.filter((s) => s.groupId === 0)
    const g1 = out.scenes.filter((s) => s.groupId === 1)
    expect(g0[30]!.state).toBe('ignore')
    expect(g0[30]!.objects.every((o) => o.status === 'ignore' && o.reason === 'uncertain')).toBe(true)
    expect(g0[6]!.state).toBe('ignore')
    expect(g0[6]!.reasons).toEqual(['quality-bad'])
    expect(g0[12]!.state).toBe('negative')
    expect(g1[40]!.state).toBe('ignore')
    expect(g1[51]!.state).toBe('ignore') // 46 + 5 → 51 까지, 검토 범위 밖이어도 무시
    expect(g1[52]!.state).toBe('unknown')
    expect(g0[45]!.state).toBe('negative') // 기준 미만 지시는 그룹 1 만
    expect(g0[55]!.state).toBe('unknown')
  })

  it('(c) 포화 기록 → 길이 제안 불가(이유: 포화), 동적 범위 < 6 dB → 제안 불가', () => {
    const sat: Reflector = { u0: 30, halfLen: 5, vMm: 2, depthMm: 6, leg: 2, pct: 400, sigmaMm: 0.7, groupId: 0 }
    const r = rec(5, { derived: { scanStartMm: 25, scanEndMm: 35, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 } })
    const out = deriveFileLabels(input([sat], [r]))
    const ls = out.records[0]!.lengthSuggestion!
    expect(ls.available).toBe(false)
    expect(ls.reason).toBe('saturated')
    expect(ls.message).toContain('포화')
    expect(ls.saturated).toBe(true)
    expect(ls.peakPct).toBe(200)
    // 관측은 포화를 표시하고 절대 문턱이라 그대로 보임
    const row = out.observations.find((o) => o.groupId === 0 && o.leg === 2)!
    expect(row.saturated).toBe(true)
    expect(row.status).toBe('visible')
    expect(out.scenes.find((s) => s.groupId === 0 && s.scanIndex === 30)!.state).toBe('positive')
    // 포화여도 제안하도록 바꾸면 평가 기준 방식은 제안
    const out2 = deriveFileLabels(input([sat], [r], { rules: { suggestionBlockOnSaturation: false } }))
    expect(out2.records[0]!.lengthSuggestion!.available).toBe(true)
    expect(out2.records[0]!.lengthSuggestion!.lengthMm).toBe(10)
    // 띠(40 %, 모든 스캔) 위의 약한 지시(55 %): 동적 범위 20·log10(55/40) ≈ 2.8 dB < 6 → 제안 불가
    const band: Reflector = { u0: 30, halfLen: 100, vMm: 2, depthMm: 6, leg: 2, pct: 40, sigmaMm: 1.5, groupId: 0 }
    const bump: Reflector = { ...band, halfLen: 3, pct: 55, sigmaMm: 0.7 }
    const out3 = deriveFileLabels(input([band, bump], [r]))
    const l3 = out3.records[0]!.lengthSuggestion!
    expect(l3.available).toBe(false)
    expect(l3.reason).toBe('dynamic-range')
    expect(l3.dynamicRangeDb!).toBeLessThan(6)
  })

  it('6 dB 강하 + 곡률 보정 (t < 8 방식): l_c = l_s × (OD − 2d) / OD', () => {
    const R: Reflector = { u0: 30, halfLen: 5, vMm: 2, depthMm: 6, leg: 2, pct: 100, sigmaMm: 0.7, groupId: 0 }
    const amp = amplitudeFromVolume(G0, synthVolume(G0, geo0, [R]), null)
    const region = regionOf({ scanStartMm: 25, scanEndMm: 35, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 }, T)
    const rules = resolveDeriveRules()
    const s = suggestLength({
      amp,
      group: G0,
      geom: geo0,
      windows: [2].map((leg) => ({ leg, ranges: windowRanges(geo0, region, leg, rules) })),
      searchScan: [22, 38],
      runLimit: [0, NS - 1],
      preferScan: 30,
      levels: groupLevelsOf(G0, T)!,
      thicknessMm: T,
      outerDiameterMm: 139.8,
      rules,
      method: '6db-curvature'
    })
    expect(s.available).toBe(true)
    expect(s.rule).toBe('6db-drop')
    expect(s.uncorrectedMm).toBe(10)
    expect(s.lengthMm!).toBeCloseTo((10 * (139.8 - 2 * s.peakDepthMm!)) / 139.8, 9)
    expect(s.peakDepthMm!).toBeGreaterThan(5)
    expect(s.peakDepthMm!).toBeLessThan(7)
  })

  it('형상 에코 후보: 루트 자리 띠(높은 각도 빔 피복률 ≥ 0.4) → 후보, 결함 U 범위는 잘라냄, 승인 뒤 장면은 음성 + 에코 상자', () => {
    // 루트 덧살 자리 띠: V 0.5, 실제 깊이 11 (레그 2 = 펼친 13), 모든 스캔 50 %
    const band: Reflector = { u0: 30, halfLen: 100, vMm: 0.5, depthMm: 11, leg: 2, pct: 50, sigmaMm: 0.5 }
    const defect: Reflector = { u0: 40, halfLen: 3, vMm: -4, depthMm: 5, leg: 2, pct: 150, sigmaMm: 0.7, groupId: 1 }
    const d = rec(10, { derived: { scanStartMm: 37, scanEndMm: 43, vMinMm: -5, vMaxMm: -3, depthTopMm: 4, depthBottomMm: 6 } })
    const ctx = prepareDerive(input([band, defect], [d]))
    const sug = suggestGeometricEchoes(ctx)
    const root = sug.candidates.filter((c) => c.zone === 'root')
    expect(root.length).toBeGreaterThan(0)
    for (const c of root) expect(c.kind).toBe('other') // 지침서 8.1 기본값
    // 그룹마다 결함 U 범위 37~43 을 빼고 두 조각
    for (const gid of [0, 1]) {
      const pieces = root.filter((c) => c.groupId === gid && c.leg === 2)
      expect(pieces.map((c) => [c.scanStartMm, c.scanEndMm]), `group ${gid}`).toEqual([
        [0, 36],
        [44, 60]
      ])
      expect(pieces.every((c) => c.cutByDefect)).toBe(true)
    }
    const cov = sug.coverage.find((c) => c.groupId === 0 && c.zone === 'root' && c.leg === 2)!
    expect(Math.max(...cov.beams.map((b) => b.coverage))).toBe(1)
    // 승인 → 형상 에코 기록, 장면: 에코 자리 = 음성 + 에코 객체, 결함 자리 = 결함 우선
    const echoes = root
      .filter((c) => c.leg === 2)
      .map((c, j) => rec(20 + j, { ...echoCandidateRecordFields(c) }))
    expect(echoes[0]!.kind).toBe('geometric-echo')
    expect(echoes[0]!.geometricEcho).toEqual({ kind: 'other', fromSuggestion: true })
    const out = deriveFileLabels(input([band, defect], [d, ...echoes], { reviewIntervals: [reviewed(1, 0, 60)] }))
    const s10 = out.scenes.find((s) => s.groupId === 0 && s.scanIndex === 10)!
    expect(s10.state).toBe('negative')
    expect(s10.objects.some((o) => o.kind === 'geometric-echo' && o.status === 'positive' && o.box !== null)).toBe(true)
    const s40 = out.scenes.find((s) => s.groupId === 1 && s.scanIndex === 40)!
    expect(s40.state).toBe('positive')
    expect(s40.objects.some((o) => o.kind === 'geometric-echo')).toBe(false) // 결함 핵심 구간 → 에코 객체 버림
    // 결함 끝 여유(5 mm)는 무시 — 에코가 있어도
    const s46 = out.scenes.find((s) => s.groupId === 1 && s.scanIndex === 46)!
    expect(s46.state).toBe('ignore')
    // 에코 A-scan 구간도 같은 방식으로 나온다
    expect(out.ascanSpans.some((x) => x.kind === 'geometric-echo' && x.scanIndex === 10)).toBe(true)
  })

  it('형상 에코 승인 메모: 블라인드(hideCues)면 띠 위 결함 단서를 빼고 자리·레그·각도는 남긴다', () => {
    const band: Reflector = { u0: 30, halfLen: 100, vMm: 0.5, depthMm: 11, leg: 2, pct: 50, sigmaMm: 0.5 }
    const c0 = suggestGeometricEchoes(prepareDerive(input([band], []))).candidates.find((c) => c.zone === 'root')!
    const c = { ...c0, strongRanges: [{ scanStartMm: 10, scanEndMm: 12, peakPct: 90 }], needsCheck: true }
    const base = `앱 제안: 루트 자리 · 레그 ${c.leg} · 형상 빔 ${c.angleMinDeg}~${c.angleMaxDeg}°`
    expect(echoCandidateRecordFields(c).note).toBe(`${base} · 기록 기준 초과 구간 있음 · 띠보다 센 곳 있음(확인 필요)`)
    expect(echoCandidateRecordFields(c, { hideCues: false }).note).toBe(echoCandidateRecordFields(c).note)
    const hidden = echoCandidateRecordFields(c, { hideCues: true })
    expect(hidden.note).toBe(base)
    // 메모만 바뀌고 나머지 칸은 같다
    expect({ ...hidden, note: '' }).toEqual({ ...echoCandidateRecordFields(c), note: '' })
  })

  it('전문가가 확인한 관측 상태를 쓴다 (계산값은 따로)', () => {
    const R: Reflector = { u0: 30, halfLen: 3, vMm: 2, depthMm: 6, leg: 2, pct: 100, sigmaMm: 0.7, groupId: 0 }
    const r = rec(6, { derived: { scanStartMm: 27, scanEndMm: 33, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 } })
    // 화면은 계산한 행(투영 위치 포함)을 전문가가 확인해 저장한다
    const computed = deriveFileLabels(input([R], [r])).observations.find((o) => o.groupId === 0 && o.leg === 2)!
    const exp = newObservationRow({ ...computed, status: 'not-visible', expertConfirmed: true })
    const out = deriveFileLabels(input([R], [r], { observations: [exp] }))
    const row = out.observations.find((o) => o.groupId === 0 && o.leg === 2)!
    expect(row.status).toBe('not-visible')
    expect(row.expertConfirmed).toBe(true)
    const leg = out.records[0]!.groups.find((g) => g.groupId === 0)!.legs.find((l) => l.leg === 2)!
    expect(leg).toMatchObject({ computedStatus: 'visible', observation: 'expert' })
    expect(out.scenes.find((s) => s.groupId === 0 && s.scanIndex === 30)!.state).toBe('ignore')

    // 기록 위치가 바뀌면(엑셀 번호가 다른 지시로 바뀐 경우 등) 그 확인은 낡아 쓰지 않는다
    const moved = rec(6, { derived: { scanStartMm: 27, scanEndMm: 33, vMinMm: 1.5, vMaxMm: 3.5, depthTopMm: 5, depthBottomMm: 7 } })
    const out2 = deriveFileLabels(input([R], [moved], { observations: [exp] }))
    expect(out2.observations.find((o) => o.groupId === 0 && o.leg === 2)).toMatchObject({ status: 'visible', expertConfirmed: false })
    expect(out2.issues.some((i) => i.code === 'observation-stale' && i.recordUuid === moved.uuid)).toBe(true)
    // 같은 키의 행이 여럿이면 입력 순서와 관계없이 revision 이 큰 것
    const newer = { ...exp, status: 'weak' as const, revision: 2, versions: [{ pcId: 'pc-b', edits: 1 }, { pcId: 'pc-a', edits: 1 }] }
    for (const rows of [
      [exp, newer],
      [newer, exp]
    ]) {
      expect(deriveFileLabels(input([R], [r], { observations: rows })).observations.find((o) => o.groupId === 0 && o.leg === 2)!.status).toBe('weak')
    }
  })

  it('앵커 기록: 좌표 규칙 버전이 다르면 앵커에서 다시 계산하고 재확인 필요', () => {
    const a = pointToAnchor(G0, 30, 2, unfoldDepth(6, 2, T))!
    const p = anchorToPoint(G0, a, T)!
    const anchor = { groupId: 0, ...a, coordRulesVersion: LABEL_COORD_RULES_VERSION - 1, groupVerified: true }
    const r = rec(7, {
      anchors: [
        { id: 'p1', role: 'peak', anchor, leg: 2, displayGainDb: 0, mm: { scanMm: 30, vMm: 2.2, depthMm: 6 } },
        { id: 'p2', role: 'length-start', anchor: { ...anchor, scanIndex: 27 }, leg: 2, displayGainDb: 0, mm: null },
        { id: 'p3', role: 'length-end', anchor: { ...anchor, scanIndex: 33 }, leg: 2, displayGainDb: 0, mm: null }
      ],
      derived: { scanStartMm: 27, scanEndMm: 33, vMinMm: 2, vMaxMm: 2, depthTopMm: 6, depthBottomMm: 6, coordRulesVersion: LABEL_COORD_RULES_VERSION - 1 }
    })
    const ctx = prepareDerive(input([], [r]))
    const pr = ctx.records[0]!
    expect(pr.recomputed).toBe(true)
    expect(pr.recheckNeeded).toBe(true)
    expect(pr.record.recheckNeeded).toBe(true)
    expect(pr.maxShiftMm!).toBeCloseTo(0.2, 6)
    expect(pr.record.derived.coordRulesVersion).toBe(LABEL_COORD_RULES_VERSION)
    expect(pr.record.anchors.every((x) => x.anchor.coordRulesVersion === LABEL_COORD_RULES_VERSION && x.mm !== null)).toBe(true)
    expect(pr.region.scanStartMm).toBe(27)
    expect(pr.region.scanEndMm).toBe(33)
    expect(pr.region.vMinMm!).toBeCloseTo(p.vMm, 9)
    expect(ctx.issues.some((i) => i.code === 'recheck-needed')).toBe(true)
    // 버전이 같으면 그대로
    const same = rec(8, { ...r, uuid: uuid(8), recheckNeeded: false, anchors: pr.record.anchors, derived: pr.record.derived })
    const ctx2 = prepareDerive(input([], [same]))
    expect(ctx2.records[0]!.recomputed).toBe(false)
    expect(ctx2.records[0]!.recheckNeeded).toBe(false)
  })

  it('대조 전 그룹은 막는다 (장면·관측 없음, 이유 표시)', () => {
    const R: Reflector = { u0: 30, halfLen: 3, vMm: 2, depthMm: 6, leg: 2, pct: 100, sigmaMm: 0.7, groupId: 0 }
    const r = rec(9, { derived: { scanStartMm: 27, scanEndMm: 33, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 } })
    const inp = input([R], [r])
    const unverified = { ...inp, groups: inp.groups.map((g, j) => (j === 1 ? { ...g, group: { ...g.group, verified: false } } : g)) }
    const out = deriveFileLabels(unverified)
    expect(out.groups[1]!.blocked).toContain('대조 전')
    expect(out.scenes.every((s) => s.groupId === 0)).toBe(true)
    expect(out.observations.every((o) => o.groupId === 0)).toBe(true)
    const extra = { ...inp, groups: inp.groups.map((g, j) => (j === 0 ? { ...g, blockReason: 'AnalysisScan/IndexOffset 이 있는 파일' } : g)) }
    expect(deriveFileLabels(extra).groups[0]!.blocked).toBe('AnalysisScan/IndexOffset 이 있는 파일')
  })

  it('(d) 같은 입력 두 번(기록·검토 구간 순서를 섞어도) → 같은 출력', () => {
    const refl: Reflector[] = [
      { u0: 15, halfLen: 3, vMm: 2, depthMm: 6, leg: 2, pct: 100, sigmaMm: 0.7, groupId: 0 },
      { u0: 40, halfLen: 6, vMm: -4, depthMm: 4, leg: 2, pct: 45, sigmaMm: 0.8 },
      { u0: 30, halfLen: 100, vMm: 0.5, depthMm: 11, leg: 2, pct: 50, sigmaMm: 0.5 }
    ]
    const recs = [
      rec(31, { derived: { scanStartMm: 12, scanEndMm: 18, vMinMm: 1, vMaxMm: 3, depthTopMm: 5, depthBottomMm: 7 } }),
      rec(32, { derived: { scanStartMm: 34, scanEndMm: 46, vMinMm: -5, vMaxMm: -3, depthTopMm: 3, depthBottomMm: 5 } }),
      rec(33, { existenceConfidence: 'uncertain', derived: { scanStartMm: 50, scanEndMm: 52, vMinMm: null, vMaxMm: null, depthTopMm: null, depthBottomMm: null } })
    ]
    const ivs = [reviewed(1, 0, 30), reviewed(2, 25, 60)]
    const base = input(refl, recs, { reviewIntervals: ivs })
    const a = JSON.stringify(deriveFileLabels(base))
    const b = JSON.stringify(deriveFileLabels({ ...base, records: [...recs].reverse(), reviewIntervals: [...ivs].reverse() }))
    expect(b).toBe(a)
    expect(a.length).toBeGreaterThan(10_000)
    // 함수 진폭(같은 값)으로 넣어도 같은 결과 — 진폭 읽기 경로가 결과를 바꾸지 않음
    const fnGroups = base.groups.map((g) => {
      const vol = g.amplitude
      return { group: g.group, amplitude: amplitudeFromFunction(vol.shape, (k, bb, i) => vol.get(k, bb, i), 200) }
    })
    const c = JSON.stringify(deriveFileLabels({ ...base, groups: fnGroups }))
    expect(c).toBe(a)
  })

  it('진폭 읽기: 조각 둘(readViewerChunk 모양) = 볼륨 하나, 상태 비트 0 = 데이터 없음', () => {
    const R: Reflector = { u0: 30, halfLen: 3, vMm: 2, depthMm: 6, leg: 2, pct: 100, sigmaMm: 0.7, groupId: 0 }
    const vol = synthVolume(G0, geo0, [R])
    const [ns, nb, nt] = G0.shape
    const status = new Uint8Array(ns * nb).fill(1)
    status[31 * nb + 5] = 0
    const whole = amplitudeFromVolume(G0, vol, status)
    const cut = 30 * nb * nt
    const parts = amplitudeFromChunks(G0, [
      { groupId: 0, scanStart: 30, scanCount: ns - 30, amplitude: vol.subarray(cut), status: status.subarray(30 * nb) },
      { groupId: 0, scanStart: 0, scanCount: 30, amplitude: vol.subarray(0, cut), status: status.subarray(0, 30 * nb) }
    ])
    for (const [k, b, i] of [
      [0, 0, 0],
      [29, 17, 400],
      [30, 17, 401],
      [31, 5, 10],
      [60, 30, 807]
    ] as const) {
      expect(parts.get(k, b, i)).toBe(whole.get(k, b, i))
      expect(parts.hasData(k, b)).toBe(whole.hasData(k, b))
      expect(parts.maxInRange!(k, b, 0, nt - 1)).toEqual(whole.maxInRange!(k, b, 0, nt - 1))
    }
    expect(whole.hasData(31, 5)).toBe(false)
    expect(whole.maxInRange!(31, 5, 0, nt - 1)).toBeNull()
    expect(whole.hasData(ns, 0)).toBe(false)
    expect(whole.saturationPct).toBe(200)
  })

  it('데이터가 하나도 없는 스캔 칸(상태 비트 0) → 무시(no-data), 음성으로 쓰지 않음', () => {
    const inp = input([], [], { reviewIntervals: [reviewed(1, 0, 60)] })
    const [ns, nb] = G0.shape
    const status = new Uint8Array(ns * nb).fill(1)
    for (let b = 0; b < nb; b++) status[12 * nb + b] = 0
    status[13 * nb + 4] = 0
    const g0 = { group: G0, amplitude: amplitudeFromVolume(G0, synthVolume(G0, geo0, []), status) }
    const run = runDerive({ ...inp, groups: [g0, inp.groups[1]!] })
    const s12 = run.result.scenes.find((x) => x.groupId === 0 && x.scanIndex === 12)!
    expect(s12.state).toBe('ignore')
    expect(s12.reasons).toEqual(['no-data'])
    expect(run.result.scenes.find((x) => x.groupId === 0 && x.scanIndex === 13)!.state).toBe('negative')
    expect(ascanLabelAt(run, 0, 13, 4).state).toBe('ignore')
    expect(ascanLabelAt(run, 0, 13, 5).state).toBe('negative')
  })

  it('같은 스캔에 게이트가 떨어진 검토 완료 구간 둘 → 그룹마다 경고 한 번 (reviewed-gates-disjoint), 이어진 게이트면 경고 없음', () => {
    const root = { depthTopMm: 9, depthBottomMm: 12, legMin: 1, legMax: 1 }
    const cap = { depthTopMm: 0, depthBottomMm: 3, legMin: 1, legMax: 1 }
    const apart = runDerive(input([], [], { reviewIntervals: [reviewed(1, 0, 60, { groupId: 0, gate: root }), reviewed(2, 0, 60, { groupId: 0, gate: cap })] }))
    const hits = apart.result.issues.filter((i) => i.code === 'reviewed-gates-disjoint')
    expect(hits.map((i) => [i.level, i.groupId])).toEqual([['warning', 0]])
    const joined = runDerive(input([], [], { reviewIntervals: [reviewed(1, 0, 60, { groupId: 0, gate: root }), reviewed(2, 0, 60, { groupId: 0, gate: { ...cap, depthBottomMm: 9 } })] }))
    expect(joined.result.issues.some((i) => i.code === 'reviewed-gates-disjoint')).toBe(false)
    // 규칙 버전을 올리기 전이라 음성 범위는 지금처럼 두 게이트를 감싸는 상자 하나 (경고만 더해짐)
    const sc = apart.result.scenes.find((x) => x.groupId === 0 && x.reviewed)!
    expect(sc.negativeRegion).toMatchObject({ depthTopMm: 0, depthBottomMm: 12, legMin: 1, legMax: 1 })
  })

  it('엑셀 기록의 앵커 추정: 레그마다 영역 칸과 중심 앵커', () => {
    const region = regionOf({ scanStartMm: 100, scanEndMm: 120, vMinMm: -6.77, vMaxMm: 6.77, depthTopMm: 0, depthBottomMm: 12 }, T)
    const est = estimateAnchors(G0, geo0, region, 0.5)
    expect(est.map((e) => e.leg)).toEqual([1, 2, 3, 4])
    for (const e of est) {
      expect(e.cells).toBeGreaterThan(0)
      expect(e.scanIndexStart).toBe(100)
      expect(e.scanIndexEnd).toBe(120)
      expect(e.centerMm!.leg).toBe(e.leg)
    }
    // 영역 중심(V 0, 실제 깊이 6)이 부채꼴 안에 맺히는 레그(2: 펼친 18, 3: 펼친 30)는 중심 앵커가 그 점 그대로.
    // 레그 1(펼친 6)은 Skew 90 부채꼴 밖이라 칸 무게중심으로 대신한다
    for (const L of [2, 3]) {
      const e = est.find((x) => x.leg === L)!
      expect(e.centerMm!.vMm).toBeCloseTo(0, 6)
      expect(e.centerMm!.depthMm).toBeCloseTo(6, 6)
      expect(e.center.scanIndex).toBe(110)
    }
    expect(pointToAnchor(G0, 110, 0, 6)).toBeNull()
  })
})
