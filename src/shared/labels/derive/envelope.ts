/**
 * 스캔축 포락선 — 측정 제안(길이)과 학습용 에코 범위가 같은 함수를 쓴다 (규격 4절 '포락선 함수 하나', 런타임 의존성 없음).
 *
 * 포락선 e(k) = 스캔 칸 k 에서, 정한 칸들(빔마다 샘플 구간 = 영역·탐색 창, 빔 제한 가능) 안 진폭의 최대 (%FSH).
 *   - 길이 제안: 최대 진폭 빔 하나(C-scan 한 행)로 제한, 그 빔의 지시 깊이 구간만 (게이트를 지시 깊이에 맞춘 것과 같음)
 *   - 학습 라벨: 그룹·레그 탐색 창 전체
 * measureEnvelope 가 최대 · 문턱 · 이어지는 구간 · 바탕값 · 동적 범위를 한 번에 낸다.
 *   문턱 규칙: 절대(%FSH) 또는 최대에서 N dB 강하.
 *   이어지는 구간: 최대 칸에서 양쪽으로, 문턱 아래 골이 bridge 칸 이하면 잇는다 (지침서 9.1 나누기 규칙).
 *   바탕값: 구간 앞뒤 ± 창 안 포락선의 중앙값(구간 자리는 뺌). 지침서 6.2·8.2 '띠 바탕값'과 같은 정의.
 *   동적 범위 = 20·log10(최대 / 바탕값).
 */
import { scanPositionMm } from '../../imaging/coords'
import type { ViewerGroup } from '../../imaging/types'
import type { LengthMethod } from '../types'
import { isSaturatedPct, rangeMax, type GroupAmplitude } from './amplitude'
import { emptyRanges, type BeamRanges, type GroupCellGeometry } from './geometry'
import { bridgeCells, type DeriveRules, type GroupLevels } from './rules'

export interface Envelope {
  /** 첫 스캔 칸 */
  scanFrom: number
  /** 칸마다 최대 %FSH (NaN = 칸이 없거나 데이터 없음) */
  values: Float64Array
  /** 그 최대의 빔·샘플 (-1 = 없음) */
  beam: Int32Array
  sample: Int32Array
}

/** 스캔 [scanFrom, scanTo] 의 포락선. beams 를 주면 그 빔만 본다. 같은 값이면 앞 빔·앞 샘플 */
export function scanEnvelope(amp: GroupAmplitude, ranges: BeamRanges, scanFrom: number, scanTo: number, beams?: readonly number[] | null): Envelope {
  const ns = amp.shape[0]
  const k0 = Math.max(0, Math.min(scanFrom, scanTo))
  const k1 = Math.min(ns - 1, Math.max(scanFrom, scanTo))
  const n = Math.max(0, k1 - k0 + 1)
  const values = new Float64Array(n).fill(NaN)
  const beam = new Int32Array(n).fill(-1)
  const sample = new Int32Array(n).fill(-1)
  const list = beams ?? Array.from({ length: ranges.lo.length }, (_, b) => b)
  for (let j = 0; j < n; j++) {
    const k = k0 + j
    let m = -Infinity
    for (const b of list) {
      const lo = ranges.lo[b]
      const hi = ranges.hi[b]
      if (lo === undefined || hi === undefined || hi < lo) continue
      const r = rangeMax(amp, k, b, lo, hi)
      if (r && r.pct > m) {
        m = r.pct
        beam[j] = b
        sample[j] = r.sample
      }
    }
    if (m > -Infinity) values[j] = m
  }
  return { scanFrom: k0, values, beam, sample }
}

/** 포락선 값 (범위 밖·없음 = NaN) */
export function envelopeAt(env: Envelope, k: number): number {
  const j = k - env.scanFrom
  return j >= 0 && j < env.values.length ? env.values[j]! : NaN
}

export interface EnvelopePeak {
  scan: number
  pct: number
  beam: number
  sample: number
}

/** [kLo, kHi] 안 최대. 같은 값(포화 평탄역 등)이면 preferScan 에 가까운 칸, 그다음 앞 칸 */
export function envelopePeak(env: Envelope, kLo: number, kHi: number, preferScan: number): EnvelopePeak | null {
  let best: EnvelopePeak | null = null
  for (let k = Math.max(kLo, env.scanFrom); k <= Math.min(kHi, env.scanFrom + env.values.length - 1); k++) {
    const j = k - env.scanFrom
    const v = env.values[j]!
    if (!Number.isFinite(v)) continue
    if (!best || v > best.pct || (v === best.pct && Math.abs(k - preferScan) < Math.abs(best.scan - preferScan))) {
      best = { scan: k, pct: v, beam: env.beam[j]!, sample: env.sample[j]! }
    }
  }
  return best
}

/** 칸 k 를 포함하고 문턱 이상인 구간 [a, b]. 문턱 아래(또는 데이터 없음) 골이 bridge 칸 이하면 잇는다. [kMin, kMax] 밖으로 가지 않는다 */
export function envelopeRun(env: Envelope, k: number, thresholdPct: number, bridge: number, kMin: number, kMax: number): [number, number] {
  const lo = Math.max(kMin, env.scanFrom)
  const hi = Math.min(kMax, env.scanFrom + env.values.length - 1)
  const ends: number[] = []
  for (const step of [-1, 1]) {
    let edge = k
    let gap = 0
    let i = k
    while (i + step >= lo && i + step <= hi) {
      i += step
      const v = envelopeAt(env, i)
      if (v >= thresholdPct) {
        edge = i
        gap = 0
      } else {
        gap++
        if (gap > bridge) break
      }
    }
    ends.push(edge)
  }
  return [ends[0]!, ends[1]!]
}

/** 중앙값 (빈 목록이면 null) */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** 바탕값: [a − half, b + half] 안, [a, b] 밖 포락선의 중앙값 */
export function envelopeBackground(env: Envelope, a: number, b: number, half: number): number | null {
  const xs: number[] = []
  for (let k = a - half; k <= b + half; k++) {
    if (k >= a && k <= b) continue
    const v = envelopeAt(env, k)
    if (Number.isFinite(v)) xs.push(v)
  }
  return median(xs)
}

/** 바탕값이 0 일 때 동적 범위 계산에 쓰는 바닥 (%FSH) */
export const BACKGROUND_FLOOR_PCT = 0.01

export type EnvelopeRule = { kind: 'absolute'; thresholdPct: number } | { kind: 'drop'; dropDb: number }

export interface EnvelopeOptions {
  /** 최대를 찾는 스캔 범위 */
  peakFrom: number
  peakTo: number
  /** 이어지는 구간이 갈 수 있는 범위 */
  runFrom: number
  runTo: number
  rule: EnvelopeRule
  /** 문턱 아래 골을 이을 칸 수 */
  bridge: number
  /** 바탕값 창 반폭 (스캔 칸) */
  backgroundHalfCells: number
  /** 같은 최대가 여럿이면 이 칸에 가까운 쪽 */
  preferScan: number
  saturationTolPct: number
  beams?: readonly number[] | null
  /** 미리 계산한 포락선 (필요한 범위를 덮어야 함) */
  envelope?: Envelope
}

export interface EnvelopeMeasure {
  peakScan: number
  peakPct: number
  peakBeam: number
  peakSample: number
  saturated: boolean
  thresholdPct: number
  /** 문턱 이상으로 이어지는 구간 (최대가 문턱 아래면 null) */
  startScan: number | null
  endScan: number | null
  /** 바탕값 (%FSH) */
  backgroundPct: number | null
  /** 20·log10(최대 / 바탕값) */
  dynamicRangeDb: number | null
  /** 구간이 허용 범위 끝(runFrom·runTo)에 닿았는지 */
  reachedEdge: boolean
  envelope: Envelope
}

/** 포락선 하나로 최대·문턱·구간·바탕값·동적 범위를 낸다. 칸이 없으면 null */
export function measureEnvelope(amp: GroupAmplitude, ranges: BeamRanges, o: EnvelopeOptions): EnvelopeMeasure | null {
  const from = Math.min(o.runFrom, o.peakFrom) - o.backgroundHalfCells
  const to = Math.max(o.runTo, o.peakTo) + o.backgroundHalfCells
  const env = o.envelope ?? scanEnvelope(amp, ranges, from, to, o.beams)
  const pk = envelopePeak(env, o.peakFrom, o.peakTo, o.preferScan)
  if (!pk) return null
  const thr = o.rule.kind === 'absolute' ? o.rule.thresholdPct : pk.pct * 10 ** (-o.rule.dropDb / 20)
  let start: number | null = null
  let end: number | null = null
  let reachedEdge = false
  if (pk.pct >= thr) {
    const [a, b] = envelopeRun(env, pk.scan, thr, o.bridge, o.runFrom, o.runTo)
    start = a
    end = b
    reachedEdge = a <= Math.max(0, o.runFrom) || b >= Math.min(amp.shape[0] - 1, o.runTo)
  }
  const bg = envelopeBackground(env, start ?? pk.scan, end ?? pk.scan, o.backgroundHalfCells)
  const dr = bg === null ? null : 20 * Math.log10(pk.pct / Math.max(BACKGROUND_FLOOR_PCT, bg))
  return {
    peakScan: pk.scan,
    peakPct: pk.pct,
    peakBeam: pk.beam,
    peakSample: pk.sample,
    saturated: isSaturatedPct(pk.pct, amp.saturationPct, o.saturationTolPct),
    thresholdPct: thr,
    startScan: start,
    endScan: end,
    backgroundPct: bg,
    dynamicRangeDb: dr,
    reachedEdge,
    envelope: env
  }
}

// ───────────────────────────── 길이 제안 (규격 4절) ─────────────────────────────

/** 제안 불가 이유 */
export type SuggestionUnavailable = 'no-signal' | 'below-threshold' | 'saturated' | 'dynamic-range'

export const SUGGESTION_UNAVAILABLE_TEXT: Readonly<Record<SuggestionUnavailable, string>> = {
  'no-signal': '탐색 창에 데이터가 없어 제안할 수 없습니다.',
  'below-threshold': '최대 진폭이 평가 기준보다 낮아 제안할 수 없습니다.',
  saturated: '최대 진폭이 포화(기록 상한)라 제안하지 않습니다.',
  'dynamic-range': '최대 진폭과 바탕값의 차가 작아(동적 범위 부족) 제안할 수 없습니다.'
}

export interface LengthSuggestion {
  available: boolean
  /** 제안 불가 이유 (available 이면 null) */
  reason: SuggestionUnavailable | null
  message: string | null
  method: Exclude<LengthMethod, 'other'>
  /** SuggestionRecord.rule 에 넣는 규칙 이름 */
  rule: 'eval-level' | '6db-drop'
  /** SuggestionRecord.ruleDb: 평가 기준이면 Ref 대비 dB, 6 dB 강하면 −dropDb */
  ruleDb: number
  groupId: number
  leg: number | null
  beam: number | null
  angleDeg: number | null
  thresholdPct: number | null
  peakPct: number | null
  peakScanMm: number | null
  /** 최대 진폭 칸의 실제 깊이 (곡률 보정의 d) */
  peakDepthMm: number | null
  saturated: boolean | null
  scanStartMm: number | null
  scanEndMm: number | null
  /** 보정 전 길이 l_s (6 dB 강하) — 평가 기준 방식은 null */
  uncorrectedMm: number | null
  /** 제안 길이 (끝 − 시작, 6 dB 강하는 곡률 보정 뒤 l_c) */
  lengthMm: number | null
  backgroundPct: number | null
  dynamicRangeDb: number | null
  /** 구간이 따라갈 수 있는 끝에 닿음 (형상 띠와 이어졌을 수 있음 — 다른 빔으로 재 볼 것) */
  reachedEdge: boolean
  /**
   * 확인 필요: 동적 범위 < suggestionCheckDynamicRangeDb(12 dB, 부록 C 보조 그림) 또는 끝에 닿음 — 띠에 끌린 길이일 수 있음.
   * 제안은 하되 화면이 확인을 묻는다
   */
  needsCheck: boolean
  checkReason: string | null
}

export interface LengthSuggestionInput {
  amp: GroupAmplitude
  group: Pick<ViewerGroup, 'id' | 'beams' | 'scan'>
  geom: GroupCellGeometry
  /** 레그별 탐색 창 */
  windows: ReadonlyArray<{ leg: number; ranges: BeamRanges }>
  /** 최대를 찾을 스캔 칸 범위 (기록 U ± 탐색 여유) */
  searchScan: readonly [number, number]
  /** 구간이 갈 수 있는 스캔 칸 범위 */
  runLimit: readonly [number, number]
  preferScan: number
  levels: GroupLevels
  thicknessMm: number
  /** 관 외경 (판은 null — 곡률 보정 없음) */
  outerDiameterMm: number | null
  rules: DeriveRules
  /** 측정법 (주지 않으면 두께로: t ≥ 8 평가 기준 초과 구간, t < 8 6 dB 강하 + 곡률 보정) */
  method?: Exclude<LengthMethod, 'other'>
}

/**
 * 길이 제안 (규격 4절): ① 탐색 창에서 최대 진폭 칸(그룹·레그·빔)을 찾고 ② 그 빔 한 줄(지시 깊이 구간)의 스캔 포락선에서
 * ③ t ≥ 8 = 평가 기준 초과 구간, t < 8 = 최대 −6 dB 구간 + l_c = l_s × (OD − 2d) / OD 로 끝점을 낸다.
 * 최대가 포화(suggestionBlockOnSaturation)이거나 동적 범위 < minDynamicRangeDb 면 '제안 불가'와 이유.
 * 동적 범위 < suggestionCheckDynamicRangeDb 이거나 끝에 닿으면 제안하되 '확인 필요'(needsCheck)를 붙인다.
 * 최대 칸은 부르는 쪽이 준 창에서 찾는다 — derive 는 상자 범위(영역 ± boxMarginMm)를 넘겨 형상 띠에서 재지 않게 한다.
 */
export function suggestLength(x: LengthSuggestionInput): LengthSuggestion {
  const r = x.rules
  const method = x.method ?? (x.thicknessMm >= r.lengthMethodThicknessMm ? 'eval-level' : '6db-curvature')
  const rule = method === 'eval-level' ? 'eval-level' : '6db-drop'
  const ruleDb = method === 'eval-level' ? 20 * Math.log10(x.levels.evaluationPct / x.levels.refPct) : -r.dropDb
  const base: LengthSuggestion = {
    available: false,
    reason: 'no-signal',
    message: SUGGESTION_UNAVAILABLE_TEXT['no-signal'],
    method,
    rule,
    ruleDb,
    groupId: x.group.id,
    leg: null,
    beam: null,
    angleDeg: null,
    thresholdPct: null,
    peakPct: null,
    peakScanMm: null,
    peakDepthMm: null,
    saturated: null,
    scanStartMm: null,
    scanEndMm: null,
    uncorrectedMm: null,
    lengthMm: null,
    backgroundPct: null,
    dynamicRangeDb: null,
    reachedEdge: false,
    needsCheck: false,
    checkReason: null
  }
  // ① 최대 진폭 칸: 레그 오름차순, 같은 값이면 preferScan 에 가까운 쪽, 그다음 앞 레그
  let best: { leg: number; ranges: BeamRanges; scan: number; pct: number; beam: number; sample: number } | null = null
  for (const w of x.windows) {
    const env = scanEnvelope(x.amp, w.ranges, x.searchScan[0], x.searchScan[1])
    const pk = envelopePeak(env, x.searchScan[0], x.searchScan[1], x.preferScan)
    if (!pk) continue
    if (!best || pk.pct > best.pct || (pk.pct === best.pct && Math.abs(pk.scan - x.preferScan) < Math.abs(best.scan - x.preferScan))) {
      best = { leg: w.leg, ranges: w.ranges, ...pk }
    }
  }
  if (!best) return base
  // ② 그 빔 한 줄
  const one = emptyRanges(best.ranges.lo.length)
  one.lo[best.beam] = best.ranges.lo[best.beam]!
  one.hi[best.beam] = best.ranges.hi[best.beam]!
  const half = Math.ceil(r.noiseWindowMm / Math.abs(x.group.scan.resolutionMm || 1))
  const m = measureEnvelope(x.amp, one, {
    peakFrom: x.searchScan[0],
    peakTo: x.searchScan[1],
    runFrom: x.runLimit[0],
    runTo: x.runLimit[1],
    rule: method === 'eval-level' ? { kind: 'absolute', thresholdPct: x.levels.evaluationPct } : { kind: 'drop', dropDb: r.dropDb },
    bridge: bridgeCells(r),
    backgroundHalfCells: half,
    preferScan: x.preferScan,
    saturationTolPct: r.saturationTolPct,
    beams: [best.beam]
  })
  if (!m) return base
  const cell = m.peakBeam * x.geom.nt + m.peakSample
  const filled: LengthSuggestion = {
    ...base,
    leg: best.leg,
    beam: m.peakBeam,
    angleDeg: x.group.beams[m.peakBeam]?.angleDeg ?? null,
    thresholdPct: m.thresholdPct,
    peakPct: m.peakPct,
    peakScanMm: scanPositionMm(m.peakScan, x.group.scan),
    peakDepthMm: m.peakSample >= 0 ? x.geom.depthMm[cell]! : null,
    saturated: m.saturated,
    backgroundPct: m.backgroundPct,
    dynamicRangeDb: m.dynamicRangeDb,
    reachedEdge: m.reachedEdge
  }
  const fail = (reason: SuggestionUnavailable): LengthSuggestion => ({ ...filled, reason, message: SUGGESTION_UNAVAILABLE_TEXT[reason] })
  // ③ 끄는 경우
  if (m.saturated && (r.suggestionBlockOnSaturation || method === '6db-curvature')) return fail('saturated')
  if (m.startScan === null || m.endScan === null) return fail('below-threshold')
  if (m.dynamicRangeDb !== null && m.dynamicRangeDb < r.minDynamicRangeDb) return fail('dynamic-range')
  const s0 = scanPositionMm(m.startScan, x.group.scan)
  const s1 = scanPositionMm(m.endScan, x.group.scan)
  const ls = Math.abs(s1 - s0)
  let length = ls
  let uncorrected: number | null = null
  if (method === '6db-curvature') {
    uncorrected = ls
    const od = x.outerDiameterMm
    const d = filled.peakDepthMm
    if (od !== null && od > 0 && d !== null) length = (ls * (od - 2 * d)) / od
  }
  const lowDr = m.dynamicRangeDb !== null && m.dynamicRangeDb < r.suggestionCheckDynamicRangeDb
  const checkReason = m.reachedEdge
    ? '구간이 따라갈 수 있는 끝에 닿았습니다(형상 띠와 이어졌을 수 있음). 띠와 이어지지 않는 다른 빔으로 다시 재 보세요.'
    : lowDr
      ? `바탕과의 차가 ${Math.round(m.dynamicRangeDb! * 10) / 10} dB 라 ${r.suggestionCheckDynamicRangeDb} dB 보다 작습니다(띠에 끌린 길이일 수 있음). 확인이 필요합니다.`
      : null
  return {
    ...filled,
    available: true,
    reason: null,
    message: null,
    needsCheck: checkReason !== null,
    checkReason,
    scanStartMm: Math.min(s0, s1),
    scanEndMm: Math.max(s0, s1),
    uncorrectedMm: uncorrected,
    lengthMm: length
  }
}
