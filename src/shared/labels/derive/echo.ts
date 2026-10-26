/**
 * 형상 에코 후보 제안 (규격 3.2, 지침서 8절, 런타임 의존성 없음).
 *
 * 그룹 · 자리(루트 / 캡) · 레그마다:
 *   1. 자리 = 용접 형상으로 정한 물리 단면 (geometry.ts echoZoneSection):
 *      루트 = |V| ≤ max(루트 반 간격, 아래 덧살 반폭) + 3 mm, 실제 깊이 t − 3 ~ t (V ≈ 0 · 두께 깊이)
 *      캡   = |V| ≤ 캡 반폭 + 3 mm, 실제 깊이 0 ~ 3 (캡·토우)
 *   2. 빔 피복률 = 그 자리 칸 안 진폭이 평가 기준 이상인 스캔 칸 비율. coverageMin(0.40) 이상인 빔 = 형상 빔.
 *      근거: 8/7 실험 형상 빔 56~89 %, 결함 빔 1~23 % (sizing.py MAX_COV 0.40).
 *      용접선 흔들림으로 띠가 이웃 빔으로 옮겨 다니므로 이웃 빔 ±coverageBeamSpan(기본 1)까지 함께 센다.
 *   3. 형상 빔 포락선이 평가 기준 이상인 U 구간 (골 ≤ bridgeMm 10 mm 는 잇는다 — 끝 여유가 어차피 덮는 길이) = 조각.
 *   4. 결함 기록의 U 범위와 겹치는 곳은 잘라낸다(결함 우선). 끝 여유는 장면 변환에서 무시가 된다.
 *   5. 조각마다: 기록 기준(ℓ ≤ t) 이상 구간(지침서 8.3 '기록 기준 초과'), 띠 바탕값(±40 mm 중앙값)보다 6 dB 이상 센 곳
 *      ('확인 필요' — 띠 위 결함일 수 있음, 지침서 8.2).
 * 전문가는 승인·수정만 한다. 승인된 후보는 기록 구분 '형상 에코' 기록이 된다(echoCandidateRecordFields).
 */
import { scanPositionMm } from '../../imaging/coords'
import type { DerivedPosition, GeometricEchoKind, IndicationRecord, SignalInfo } from '../types'
import { rangeMax } from './amplitude'
import { issue, type DeriveContext, type DeriveIssue, type PreparedGroup } from './context'
import { median } from './envelope'
import { cellsForMm, echoZoneSection, scanRangeForU, sectionRanges, type CrossSection } from './geometry'
import { r3, r4 } from './observation'
import { bridgeCells, type EchoZone } from './rules'

export interface BeamCoverage {
  beam: number
  angleDeg: number
  /** 평가 기준 이상인 스캔 칸 비율 (0~1) */
  coverage: number
}

export interface EchoRange {
  scanStartMm: number
  scanEndMm: number
  peakPct: number
}

export interface EchoCandidate {
  /** 같은 입력이면 같은 값: 그룹:자리:레그:시작 칸 */
  id: string
  groupId: number
  leg: number
  zone: EchoZone
  /** 제안 세부 (rules.echo.kindByZone, 기본 '기타') */
  kind: GeometricEchoKind
  scanStartMm: number
  scanEndMm: number
  lengthMm: number
  /** 형상 빔 */
  beams: number[]
  angleMinDeg: number
  angleMaxDeg: number
  maxPct: number
  /** 조각 안 포락선 중앙값 (띠 세기) */
  medianPct: number
  saturated: boolean
  /** 최대 칸 */
  peakScanMm: number
  peakBeam: number
  peakAngleDeg: number
  peakSample: number
  peakDepthMm: number
  /** 기록 기준(ℓ ≤ t) 이상 구간 */
  strongRanges: EchoRange[]
  /** 띠 바탕값보다 anomalyDb 이상 센 곳 */
  checkRanges: Array<EchoRange & { contrastDb: number }>
  needsCheck: boolean
  /** 결함 기록에 잘린 조각인지 */
  cutByDefect: boolean
  /** 자리 단면 (물리 좌표) */
  section: CrossSection
}

export interface EchoZoneCoverage {
  groupId: number
  zone: EchoZone
  leg: number
  beams: BeamCoverage[]
}

export interface EchoSuggestion {
  candidates: EchoCandidate[]
  coverage: EchoZoneCoverage[]
  issues: DeriveIssue[]
}

/** 문턱 이상 구간들 (골 bridge 칸 이하는 잇는다) [lo, hi] */
export function runsAbove(values: Float64Array, thr: number, bridge: number, from = 0, to = values.length - 1): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = -1
  let last = -1
  for (let k = from; k <= to; k++) {
    const v = values[k]!
    if (v >= thr) {
      if (start < 0) start = k
      else if (k - last - 1 > bridge) {
        out.push([start, last])
        start = k
      }
      last = k
    }
  }
  if (start >= 0) out.push([start, last])
  return out
}

/** [lo, hi] 에서 막는 구간들을 뺀 나머지 */
export function subtractRanges(seg: [number, number], cuts: ReadonlyArray<[number, number]>): { parts: Array<[number, number]>; cut: boolean } {
  let parts: Array<[number, number]> = [seg]
  let cut = false
  for (const [a, b] of cuts) {
    const next: Array<[number, number]> = []
    for (const [p, q] of parts) {
      if (b < p || a > q) {
        next.push([p, q])
        continue
      }
      cut = true
      if (a > p) next.push([p, a - 1])
      if (b < q) next.push([b + 1, q])
    }
    parts = next
  }
  return { parts, cut }
}

function zoneCandidates(
  ctx: DeriveContext,
  pg: PreparedGroup,
  zone: EchoZone,
  section: CrossSection,
  cuts: ReadonlyArray<[number, number]>,
  out: EchoSuggestion
): void {
  const geom = pg.geom!
  const levels = pg.levels!
  const E = ctx.rules.echo
  const axis = pg.group.scan
  const ns = pg.amp.shape[0]
  const evalPct = levels.evaluationPct
  const strongPct = levels.recordingShortPct
  const bridge = cellsForMm(axis, E.bridgeMm)
  const minCells = Math.max(1, cellsForMm(axis, E.minSegmentMm))
  const anomalyHalf = cellsForMm(axis, E.anomalyWindowMm)
  const anomalyFactor = 10 ** (E.anomalyDb / 20)
  for (const L of geom.legs) {
    const ranges = sectionRanges(geom, section, L, 0)
    const perBeam: Array<{ b: number; vals: Float64Array; smp: Int32Array; coverage: number }> = []
    for (let b = 0; b < geom.nb; b++) {
      const lo = ranges.lo[b]!
      const hi = ranges.hi[b]!
      if (hi < lo) continue
      const vals = new Float64Array(ns).fill(NaN)
      const smp = new Int32Array(ns).fill(-1)
      for (let k = 0; k < ns; k++) {
        const m = rangeMax(pg.amp, k, b, lo, hi)
        if (!m) continue
        vals[k] = m.pct
        smp[k] = m.sample
      }
      perBeam.push({ b, vals, smp, coverage: 0 })
    }
    if (perBeam.length === 0) continue
    // 피복률: 데이터가 있는 스캔 칸 중, 이 빔 ± coverageBeamSpan 빔 가운데 하나라도 평가 기준 이상인 칸 비율
    const span = Math.max(0, Math.floor(E.coverageBeamSpan))
    for (const p of perBeam) {
      const near = perBeam.filter((q) => Math.abs(q.b - p.b) <= span)
      let n = 0
      let over = 0
      for (let k = 0; k < ns; k++) {
        if (!Number.isFinite(p.vals[k]!)) continue
        n++
        if (near.some((q) => q.vals[k]! >= evalPct)) over++
      }
      p.coverage = n > 0 ? over / n : 0
    }
    out.coverage.push({
      groupId: pg.id,
      zone,
      leg: L,
      beams: perBeam.map((p) => ({ beam: p.b, angleDeg: pg.group.beams[p.b]!.angleDeg, coverage: r3(p.coverage) }))
    })
    const shape = perBeam.filter((p) => p.coverage >= E.coverageMin)
    if (shape.length === 0) continue
    const env = new Float64Array(ns).fill(NaN)
    const envBeam = new Int32Array(ns).fill(-1)
    const envSample = new Int32Array(ns).fill(-1)
    for (let k = 0; k < ns; k++) {
      for (const p of shape) {
        const v = p.vals[k]!
        if (Number.isFinite(v) && !(v <= env[k]!)) {
          env[k] = v
          envBeam[k] = p.b
          envSample[k] = p.smp[k]!
        }
      }
    }
    const segs = runsAbove(env, evalPct, bridge)
    for (const seg of segs) {
      const { parts, cut } = subtractRanges(seg, cuts)
      for (const [a, z] of parts) {
        // 잘린 뒤 양 끝이 문턱 아래 골이면 다듬는다
        let p = a
        let q = z
        while (p <= q && !(env[p]! >= evalPct)) p++
        while (q >= p && !(env[q]! >= evalPct)) q--
        if (q - p + 1 < minCells) continue
        const xs: number[] = []
        let pk = p
        for (let k = p; k <= q; k++) {
          const v = env[k]!
          if (Number.isFinite(v)) xs.push(v)
          if (v > env[pk]!) pk = k
        }
        const strong = runsAbove(env, strongPct, bridgeCells(ctx.rules), p, q).map(([s, e]) => ({
          scanStartMm: r4(scanPositionMm(s, axis)),
          scanEndMm: r4(scanPositionMm(e, axis)),
          peakPct: r3(Math.max(...Array.from(env.subarray(s, e + 1)).filter(Number.isFinite)))
        }))
        // 띠 바탕값 대비 센 곳
        const flag = new Float64Array(ns).fill(NaN)
        const contrast = new Float64Array(ns).fill(NaN)
        for (let k = p; k <= q; k++) {
          const win: number[] = []
          for (let j = Math.max(0, k - anomalyHalf); j <= Math.min(ns - 1, k + anomalyHalf); j++) {
            const v = env[j]!
            if (Number.isFinite(v)) win.push(v)
          }
          const bg = median(win)
          const v = env[k]!
          if (bg !== null && bg > 0 && Number.isFinite(v)) {
            contrast[k] = 20 * Math.log10(v / bg)
            if (v >= bg * anomalyFactor) flag[k] = 1
          }
        }
        const checks = runsAbove(flag, 1, 0, p, q).map(([s, e]) => {
          let m = s
          for (let k = s; k <= e; k++) if (env[k]! > env[m]!) m = k
          return {
            scanStartMm: r4(scanPositionMm(s, axis)),
            scanEndMm: r4(scanPositionMm(e, axis)),
            peakPct: r3(env[m]!),
            contrastDb: r3(contrast[m]!)
          }
        })
        const beams = shape.map((s) => s.b)
        const angles = beams.map((b) => pg.group.beams[b]!.angleDeg)
        const pb = envBeam[pk]!
        const ps = envSample[pk]!
        const s0 = scanPositionMm(p, axis)
        const s1 = scanPositionMm(q, axis)
        out.candidates.push({
          id: `${pg.id}:${zone}:L${L}:${p}`,
          groupId: pg.id,
          leg: L,
          zone,
          kind: E.kindByZone[zone],
          scanStartMm: r4(Math.min(s0, s1)),
          scanEndMm: r4(Math.max(s0, s1)),
          lengthMm: r4(Math.abs(s1 - s0)),
          beams,
          angleMinDeg: r4(Math.min(...angles)),
          angleMaxDeg: r4(Math.max(...angles)),
          maxPct: r3(env[pk]!),
          medianPct: r3(median(xs) ?? 0),
          saturated: env[pk]! >= pg.amp.saturationPct - ctx.rules.saturationTolPct,
          peakScanMm: r4(scanPositionMm(pk, axis)),
          peakBeam: pb,
          peakAngleDeg: pg.group.beams[pb]!.angleDeg,
          peakSample: ps,
          peakDepthMm: r4(geom.depthMm[pb * geom.nt + ps]!),
          strongRanges: strong,
          checkRanges: checks,
          needsCheck: checks.length > 0,
          cutByDefect: cut,
          section: {
            vMinMm: section.vMinMm === null ? null : r4(section.vMinMm),
            vMaxMm: section.vMaxMm === null ? null : r4(section.vMaxMm),
            depthTopMm: r4(section.depthTopMm),
            depthBottomMm: r4(section.depthBottomMm)
          }
        })
      }
    }
  }
}

/**
 * 파일 하나의 형상 에코 후보. 결함 기록(기록 구분 '결함', 지우지 않은 것)의 U 범위는 잘라낸다.
 * 막힌 그룹은 건너뛴다. 결과는 (그룹, 자리, 레그, 시작) 순서.
 */
export function suggestGeometricEchoes(ctx: DeriveContext): EchoSuggestion {
  const out: EchoSuggestion = { candidates: [], coverage: [], issues: [] }
  const t = ctx.thicknessMm
  if (t === null) {
    out.issues.push(issue('warning', 'echo-no-thickness', '두께를 몰라 형상 에코 후보를 찾지 않았습니다.'))
    return out
  }
  if (!ctx.weld) out.issues.push(issue('info', 'echo-no-weld', '개선 형상이 없어 루트 자리를 |V| ≤ 3 mm 로 보고, 캡 자리는 찾지 않았습니다.'))
  for (const pg of ctx.groups) {
    if (pg.blocked || !pg.geom || !pg.levels) continue
    const cuts: Array<[number, number]> = []
    for (const pr of ctx.records) {
      if (pr.record.kind !== 'defect') continue
      const r = scanRangeForU(pg.group.scan, pr.region.scanStartMm, pr.region.scanEndMm)
      if (r) cuts.push(r)
    }
    cuts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    for (const zone of ['root', 'cap'] as const) {
      const section = echoZoneSection(zone, ctx.weld, t, ctx.rules.echo)
      if (!section) continue
      zoneCandidates(ctx, pg, zone, section, cuts, out)
    }
  }
  out.candidates.sort((a, b) => a.groupId - b.groupId || (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : 0) || a.leg - b.leg || a.scanStartMm - b.scanStartMm)
  return out
}

/**
 * 승인된 후보 → 형상 에코 기록 칸 (uuid·라벨러 등 키는 부르는 쪽이 newIndicationRecord 로 채운다)
 * hideCues: 블라인드 판독이면 메모에 띠 위 결함 단서(기록 기준 초과·띠보다 센 곳)를 남기지 않는다 — 후보 목록과 같은 기준
 */
export function echoCandidateRecordFields(c: EchoCandidate, opts: { hideCues?: boolean } = {}): {
  kind: 'geometric-echo'
  geometricEcho: NonNullable<IndicationRecord['geometricEcho']>
  existenceConfidence: IndicationRecord['existenceConfidence']
  derived: Partial<DerivedPosition>
  signal: Partial<SignalInfo>
  note: string
} {
  const zoneKo = c.zone === 'root' ? '루트' : '캡'
  const strong = !opts.hideCues && c.strongRanges.length > 0 ? ' · 기록 기준 초과 구간 있음' : ''
  const check = !opts.hideCues && c.needsCheck ? ' · 띠보다 센 곳 있음(확인 필요)' : ''
  return {
    kind: 'geometric-echo',
    geometricEcho: { kind: c.kind, fromSuggestion: true },
    existenceConfidence: 'certain',
    derived: {
      scanStartMm: c.scanStartMm,
      scanEndMm: c.scanEndMm,
      vMinMm: c.section.vMinMm,
      vMaxMm: c.section.vMaxMm,
      depthTopMm: c.section.depthTopMm,
      depthBottomMm: c.section.depthBottomMm,
      coordRulesVersion: null
    },
    signal: {
      maxAmplitudePct: c.maxPct,
      saturated: c.saturated,
      peak: { groupId: c.groupId, beam: c.peakBeam, angleDeg: c.peakAngleDeg, scanMm: c.peakScanMm, depthMm: c.peakDepthMm }
    },
    note: `앱 제안: ${zoneKo} 자리 · 레그 ${c.leg} · 형상 빔 ${c.angleMinDeg}~${c.angleMaxDeg}°${strong}${check}`
  }
}
