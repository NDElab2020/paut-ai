/**
 * 평가 지표 v1 (순수 함수, 런타임 의존성 없음).
 * 문서: 계획_라벨링/평가_정의_v1.md 5~7절. 매칭은 match.ts.
 *
 * 약속
 * - a = 정답 쪽(또는 라벨러 A), b = 예측 쪽(또는 라벨러 B). 오차는 늘 b − a.
 * - 주 재현율은 물리 결함 단위(physicalDefectRecall: 같은 물리 결함이 여러 파일·반복 스캔에 나와도 한 번)다.
 *   detectionSummary 의 재현율은 비교 단위(그룹 짓기 후 지시) 단위 — '지시 단위 재현율'로 이름을 나눠 보고한다.
 *   장면·A-scan 수로 세지 않는다.
 * - 참고 단위(불확실·기록 기준 미만·낮은 정답 계층)는 재현율·오검출에 셈하지 않고 따로 센다.
 *   정답 쪽 참고 단위와 맞은 예측, 정답 쪽 참고 구역(기준 미만 지시·품질 불량)에 든 예측은 오검출이 아니다.
 *   셈하는 정답이 예측 쪽 참고 단위하고만 맞으면 미검출이다(예측이 확정하지 않았으므로).
 * - 검토 범위 밖(outsideCoverage)의 짝 없는 예측·정답은 오검출·미검출에서 빼고 따로 센다
 *   (m 당 오검출의 분모가 검토 완료 길이라 분자도 그 범위 안이어야 한다).
 * - 값이 정의되지 않으면(분모 0 등) null 이다. NaN 을 내지 않는다.
 */
import type { JudgmentCharacter, MetallurgicalType } from './types'
import type { ProposalDefectClass } from './codes'
import { JUDGMENT_CHARACTER, METALLURGICAL_TYPE, METALLURGICAL_TYPE_INFO, PROPOSAL_DEFECT_CLASS, codesOf } from './codes'
import type { MatchItem, MatchPair, MatchResult } from './match'
import { intervalGap, mergeSpans, type Span } from './spans'

/** 양쪽 95 % 정규 분위수 */
export const Z95 = 1.959963984540054

/** 시험 세트에서 '불확실' 정답이 차지할 수 있는 몫의 상한 (평가_정의_v1.md 6절, 한난과 합의) */
export const UNCERTAIN_SHARE_CAP = 0.1

/** 구간 단위(grading unit) 잠정 길이 (mm). 0단계 결과로 정한다 (평가_정의_v1.md 5.4절) */
export const PROVISIONAL_GRADING_UNIT_MM = 20

// ───────────────────────────── 비율 · 신뢰 구간 ─────────────────────────────

export interface ProportionCI {
  x: number
  n: number
  /** x / n. n = 0 이면 null */
  p: number | null
  lower: number | null
  upper: number | null
}

/**
 * Wilson 점수 구간 (연속성 보정 없음).
 *   중심 = (p̂ + z²/2n) / (1 + z²/n), 반폭 = z·√(p̂(1−p̂)/n + z²/4n²) / (1 + z²/n)
 * 표본이 작거나 p̂ 가 0·1 에 가까워도 [0, 1] 안에 머문다(정규 근사 Wald 구간과 다름).
 */
export function wilsonInterval(x: number, n: number, z: number = Z95): ProportionCI {
  if (!Number.isInteger(x) || !Number.isInteger(n) || x < 0 || n < 0 || x > n) {
    throw new RangeError(`비율은 0 ≤ x ≤ n 인 정수여야 합니다: x=${x}, n=${n}`)
  }
  if (n === 0) return { x, n, p: null, lower: null, upper: null }
  const p = x / n
  const z2 = z * z
  const d = 1 + z2 / n
  const c = (p + z2 / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d
  return { x, n, p, lower: x === 0 ? 0 : Math.max(0, c - h), upper: x === n ? 1 : Math.min(1, c + h) }
}

// ───────────────────────────── 검출 ─────────────────────────────

export interface DetectionSummary {
  /** 셈하는 정답 단위 수 (재현율 분모). 검토 범위 밖의 짝 없는 정답은 뺀다 */
  truthCounted: number
  /** 셈하는 쌍 수 (참 검출) */
  hits: number
  /** truthCounted − hits */
  misses: number
  /** 미검출 중 예측 쪽 참고 단위(불확실·기준 미만)하고만 맞은 수 */
  missesMatchedToReference: number
  /** 미검출 중 예측 쪽 참고 구역에 든 수 (2인 비교에서 B 가 '기준 미만'으로 본 것) */
  missesInZone: number
  /** 미검출 중 1:1 경쟁에서 짝을 잃은 수 */
  missesLostCompetition: number
  /** 검토 범위 밖이라 미검출에서 뺀 셈하는 정답 (따로 보고) */
  missesOutsideCoverage: number
  /** 셈하는 예측 단위 수 */
  predCounted: number
  /** 오검출 = predCounted − hits − predMatchedToReference − predInZone − predOutsideCoverage */
  falsePositives: number
  /** 정답 쪽 참고 단위와 맞아 오검출에서 뺀 예측 */
  predMatchedToReference: number
  /** 정답 쪽 참고 구역에 들어 오검출에서 뺀 예측 */
  predInZone: number
  /** 검토 범위 밖이라 오검출에서 뺀 예측 (참고 구역이 아닌 것) */
  predOutsideCoverage: number
  /** 정답 쪽 참고 단위 수 (별도 범주) */
  truthReference: number
  /** 정답 쪽 참고 단위 중 셈하는 예측과 맞은 수 */
  truthReferenceDetected: number
  /** 지시 단위 재현율 = hits / truthCounted, Wilson 95 % (주 재현율은 physicalDefectRecall) */
  recall: ProportionCI
  /** 정밀도 = hits / (hits + falsePositives), Wilson 95 % */
  precision: ProportionCI
  /** F1 = 2·hits / (2·hits + misses + falsePositives). 2인 일치도의 지시 매칭 F1 */
  f1: number | null
}

export function detectionSummary(r: Pick<MatchResult, 'pairs' | 'onlyA' | 'onlyB'>, z: number = Z95): DetectionSummary {
  const hits = r.pairs.filter((p) => p.counted).length
  const missA = r.onlyA.filter((u) => u.item.counted && !u.outsideCoverage)
  const missesOutsideCoverage = r.onlyA.filter((u) => u.item.counted && u.outsideCoverage).length
  const truthCounted = r.pairs.filter((p) => p.a.counted).length + missA.length
  const predCounted = r.pairs.filter((p) => p.b.counted).length + r.onlyB.filter((u) => u.item.counted).length
  const missesMatchedToReference = r.pairs.filter((p) => p.a.counted && !p.b.counted).length
  const missesInZone = missA.filter((u) => u.zone !== null).length
  const missesLostCompetition = missA.filter((u) => u.hadCandidate).length
  const predMatchedToReference = r.pairs.filter((p) => p.b.counted && !p.a.counted).length
  const predInZone = r.onlyB.filter((u) => u.item.counted && u.zone !== null).length
  const predOutsideCoverage = r.onlyB.filter((u) => u.item.counted && u.zone === null && u.outsideCoverage).length
  const falsePositives = predCounted - hits - predMatchedToReference - predInZone - predOutsideCoverage
  const truthReference = r.pairs.filter((p) => !p.a.counted).length + r.onlyA.filter((u) => !u.item.counted).length
  const truthReferenceDetected = r.pairs.filter((p) => !p.a.counted && p.b.counted).length
  const misses = truthCounted - hits
  const denomF1 = 2 * hits + misses + falsePositives
  return {
    truthCounted,
    hits,
    misses,
    missesMatchedToReference,
    missesInZone,
    missesLostCompetition,
    missesOutsideCoverage,
    predCounted,
    falsePositives,
    predMatchedToReference,
    predInZone,
    predOutsideCoverage,
    truthReference,
    truthReferenceDetected,
    recall: wilsonInterval(hits, truthCounted, z),
    precision: wilsonInterval(hits, hits + falsePositives, z),
    f1: denomF1 > 0 ? (2 * hits) / denomF1 : null
  }
}

export interface FalsePositiveRate {
  falsePositives: number
  welds: number
  inspectedLengthMm: number
  /** 용접부당 오검출. welds = 0 이면 null */
  perWeld: number | null
  /** m 당 오검출. 검사 길이 0 이면 null */
  perMeter: number | null
}

/**
 * 오검출 비율. welds = 평가한 용접부 수, inspectedLengthMm = 평가한 용접 길이 합(검토 완료 구간 합, mm).
 * 그룹(스큐)마다 따로 세지 않는다 — 같은 용접 길이를 두 스큐로 봐도 길이는 한 번.
 */
export function falsePositiveRate(
  s: Pick<DetectionSummary, 'falsePositives'>,
  scope: { welds: number; inspectedLengthMm: number }
): FalsePositiveRate {
  return {
    falsePositives: s.falsePositives,
    welds: scope.welds,
    inspectedLengthMm: scope.inspectedLengthMm,
    perWeld: scope.welds > 0 ? s.falsePositives / scope.welds : null,
    perMeter: scope.inspectedLengthMm > 0 ? s.falsePositives / (scope.inspectedLengthMm / 1000) : null
  }
}

/**
 * 정답 쪽 '불확실' 몫. 시험 세트에서 상한(UNCERTAIN_SHARE_CAP)을 넘으면 Level III 확정을 더 해야 한다.
 * 분모 = 정답 쪽 전체 단위(셈함 + 참고 + '불확실'이라 뺀 기록). uncertain 규칙이 'exclude' 여도 excludedA 로 센다.
 * (뺀 기록은 그룹 짓기 전 기록 단위로 세므로, 그룹 짓기를 쓰면 몫이 조금 커질 수 있다 — 보수적)
 */
export function uncertainTruthShare(r: Pick<MatchResult, 'pairs' | 'onlyA'> & Partial<Pick<MatchResult, 'excludedA'>>): {
  uncertain: number
  total: number
  share: number | null
  exceedsCap: boolean
} {
  const truths = [...r.pairs.map((p) => p.a), ...r.onlyA.map((u) => u.item)]
  const excludedUncertain = (r.excludedA ?? []).filter((e) => e.reason === 'uncertain').length
  const uncertain = truths.filter((t) => t.referenceReasons.includes('uncertain')).length + excludedUncertain
  const total = truths.length + excludedUncertain
  const share = total > 0 ? uncertain / total : null
  return { uncertain, total, share, exceedsCap: share !== null && share > UNCERTAIN_SHARE_CAP }
}

export interface DefectRecall {
  /** 셈하는 정답 가운데 물리 결함 키가 있는 결함 수 (여러 결과·파일에 나와도 한 번) */
  defects: number
  /** 그 가운데 어느 결과에서든 셈하는 예측과 짝지어진 결함 수 */
  hits: number
  /** 물리 결함 단위 재현율 = hits / defects, Wilson 95 % (주 재현율) */
  recall: ProportionCI
  /** 물리 결함 키가 없어 이 셈에서 뺀 셈하는 정답 단위 수 (따로 보고) */
  unkeyedTruthUnits: number
}

/**
 * 물리 결함 단위 재현율 (평가_정의_v1.md 5.1 주 지표). 결과 여럿(파일·반복 스캔마다)을 받아
 * 같은 물리 결함 키(MatchItem.physicalDefectKey)를 한 번만 센다. 한 결과에서라도 맞으면 검출.
 * 검토 범위 밖의 짝 없는 정답은 뺀다.
 */
export function physicalDefectRecall(results: readonly Pick<MatchResult, 'pairs' | 'onlyA'>[], z: number = Z95): DefectRecall {
  const seen = new Set<string>()
  const hit = new Set<string>()
  let unkeyed = 0
  for (const r of results) {
    for (const p of r.pairs) {
      if (!p.a.counted) continue
      const k = p.a.physicalDefectKey
      if (k === null) {
        unkeyed++
        continue
      }
      seen.add(k)
      if (p.counted) hit.add(k)
    }
    for (const u of r.onlyA) {
      if (!u.item.counted || u.outsideCoverage) continue
      const k = u.item.physicalDefectKey
      if (k === null) unkeyed++
      else seen.add(k)
    }
  }
  return { defects: seen.size, hits: hit.size, recall: wilsonInterval(hit.size, seen.size, z), unkeyedTruthUnits: unkeyed }
}

// ───────────────────────────── 위치 · 크기 오차 ─────────────────────────────

/** 오차를 볼 칸 */
export type ErrorField = 'scanCenter' | 'scanStart' | 'scanEnd' | 'depthCenter' | 'length' | 'height'
export const ERROR_FIELDS: readonly ErrorField[] = ['scanCenter', 'scanStart', 'scanEnd', 'depthCenter', 'length', 'height']

function fieldValue(item: MatchItem, f: ErrorField): number | null {
  switch (f) {
    case 'scanCenter':
      return (item.scanStartMm + item.scanEndMm) / 2
    case 'scanStart':
      return item.scanStartMm
    case 'scanEnd':
      return item.scanEndMm
    case 'depthCenter':
      return item.depthCenterMm
    case 'length':
      return item.lengthMm
    case 'height':
      return item.heightMm
  }
}

/** 셈하는 쌍(기본)의 b − a. 한쪽이라도 값이 없으면 그 쌍은 뺀다 */
export function pairDiffs(pairs: readonly MatchPair[], field: ErrorField, opts: { countedOnly?: boolean } = {}): number[] {
  const out: number[] = []
  for (const p of pairs) {
    if ((opts.countedOnly ?? true) && !p.counted) continue
    const va = fieldValue(p.a, field)
    const vb = fieldValue(p.b, field)
    if (va === null || vb === null) continue
    out.push(vb - va)
  }
  return out
}

/**
 * 분위수, 선형 보간(R type 7, numpy 기본과 같음): 정렬한 값 x[0..n−1] 에서 h = (n−1)·q,
 * x[⌊h⌋] + (h − ⌊h⌋)·(x[⌊h⌋+1] − x[⌊h⌋]). 값이 없으면 null.
 */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null
  if (!(q >= 0 && q <= 1)) throw new RangeError(`분위는 0~1 이어야 합니다: ${q}`)
  const s = [...values].sort((x, y) => x - y)
  const h = (s.length - 1) * q
  const lo = Math.floor(h)
  const a = s[lo] as number
  const b = s[Math.min(lo + 1, s.length - 1)] as number
  return a + (h - lo) * (b - a)
}

export interface ErrorStats {
  n: number
  /** 평균 절대 오차 */
  mae: number | null
  /** 평균 오차 (b − a, 치우침) */
  bias: number | null
  /** 제곱 평균 제곱근. 문헌 값(라운드로빈 RMSE 등)과 견줄 때 */
  rmse: number | null
  /** |오차| 의 95 % 분위 (type 7) */
  p95Abs: number | null
  maxAbs: number | null
}

export function errorStats(diffs: readonly number[]): ErrorStats {
  const n = diffs.length
  if (n === 0) return { n, mae: null, bias: null, rmse: null, p95Abs: null, maxAbs: null }
  const abs = diffs.map(Math.abs)
  const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0)
  return {
    n,
    mae: sum(abs) / n,
    bias: sum(diffs) / n,
    rmse: Math.sqrt(sum(diffs.map((d) => d * d)) / n),
    p95Abs: quantile(abs, 0.95),
    maxAbs: Math.max(...abs)
  }
}

/** 칸마다 오차 통계 (셈하는 쌍) */
export function errorReport(r: Pick<MatchResult, 'pairs'>): Record<ErrorField, ErrorStats> {
  const out = {} as Record<ErrorField, ErrorStats>
  for (const f of ERROR_FIELDS) out[f] = errorStats(pairDiffs(r.pairs, f))
  return out
}

// ───────────────────────────── 일치도 (kappa) ─────────────────────────────

export interface KappaResult {
  n: number
  /** 관측 일치율 */
  po: number | null
  /** 우연 일치율 (두 쪽 주변 비율의 곱의 합) */
  pe: number | null
  /** (po − pe) / (1 − pe). n = 0 이거나 pe = 1(두 쪽이 한 범주만 씀)이면 정의되지 않아 null */
  kappa: number | null
}

/** Cohen kappa. matrix[i][j] = a 가 범주 i, b 가 범주 j 인 수 (정사각) */
export function cohenKappa(matrix: readonly (readonly number[])[]): KappaResult {
  const k = matrix.length
  let n = 0
  let agree = 0
  const rows = new Array<number>(k).fill(0)
  const cols = new Array<number>(k).fill(0)
  matrix.forEach((row, i) => {
    if (row.length !== k) throw new RangeError('kappa 표는 정사각이어야 합니다')
    row.forEach((v, j) => {
      n += v
      rows[i] = (rows[i] ?? 0) + v
      cols[j] = (cols[j] ?? 0) + v
      if (i === j) agree += v
    })
  })
  if (n === 0) return { n, po: null, pe: null, kappa: null }
  const po = agree / n
  let pe = 0
  for (let i = 0; i < k; i++) pe += ((rows[i] ?? 0) / n) * ((cols[i] ?? 0) / n)
  const kappa = 1 - pe > 1e-12 ? (po - pe) / (1 - pe) : null
  return { n, po, pe, kappa }
}

/** 같은 대상에 두 쪽이 붙인 범주 목록에서 kappa. classes 에 없는 값이 있으면 오류 */
export function cohenKappaFromLabels<T extends string>(a: readonly T[], b: readonly T[], classes: readonly T[]): KappaResult {
  if (a.length !== b.length) throw new RangeError('두 목록의 길이가 다릅니다')
  const idx = new Map(classes.map((c, i) => [c, i] as const))
  const m = classes.map(() => new Array<number>(classes.length).fill(0))
  a.forEach((x, t) => {
    const i = idx.get(x)
    const j = idx.get(b[t] as T)
    if (i === undefined || j === undefined) throw new RangeError(`범주 표에 없는 값입니다: ${x} / ${String(b[t])}`)
    const row = m[i] as number[]
    row[j] = (row[j] ?? 0) + 1
  })
  return cohenKappa(m)
}

// ───────────────────────────── 종류 혼동표 ─────────────────────────────

export interface ConfusionTable<T extends string> {
  classes: readonly T[]
  /** matrix[i][j] = a 가 classes[i], b 가 classes[j] */
  matrix: number[][]
  /** 표에 넣은 쌍 수 */
  total: number
  /** a 쪽 범주를 몰라 뺀 쌍 */
  unknownA: number
  /** b 쪽 범주를 몰라 뺀 쌍 */
  unknownB: number
  /** 한쪽이라도 종류 확신도가 '불확실'이라 뺀 쌍 (includeTypeUncertain = false 일 때) */
  typeUncertain: number
  /** 대각 / total */
  agreement: number | null
  kappa: KappaResult
}

/**
 * 셈하는 쌍의 혼동표. 한쪽이라도 범주가 null 이면 표에서 빼고 unknownA/B 로 센다.
 * 한쪽이라도 종류 확신도가 '불확실'이면 기본으로 뺀다(계획 6절: 종류만 불확실하면 종류 학습·평가만 끈다).
 */
export function confusionMatrix<T extends string>(
  pairs: readonly MatchPair[],
  classOf: (item: MatchItem) => T | null,
  classes: readonly T[],
  opts: { includeTypeUncertain?: boolean } = {}
): ConfusionTable<T> {
  const idx = new Map(classes.map((c, i) => [c, i] as const))
  const matrix = classes.map(() => new Array<number>(classes.length).fill(0))
  let total = 0
  let diag = 0
  let unknownA = 0
  let unknownB = 0
  let typeUncertain = 0
  for (const p of pairs) {
    if (!p.counted) continue
    if (!opts.includeTypeUncertain && (p.a.typeConfidence === 'uncertain' || p.b.typeConfidence === 'uncertain')) {
      typeUncertain++
      continue
    }
    const ca = classOf(p.a)
    const cb = classOf(p.b)
    const i = ca === null ? undefined : idx.get(ca)
    const j = cb === null ? undefined : idx.get(cb)
    if (i === undefined) unknownA++
    if (j === undefined) unknownB++
    if (i === undefined || j === undefined) continue
    const row = matrix[i] as number[]
    row[j] = (row[j] ?? 0) + 1
    total++
    if (i === j) diag++
  }
  return { classes, matrix, total, unknownA, unknownB, typeUncertain, agreement: total > 0 ? diag / total : null, kappa: cohenKappa(matrix) }
}

/** 1단 혼동표: 면상 / 체적 (주 지표) */
export function characterConfusion(r: Pick<MatchResult, 'pairs'>): ConfusionTable<JudgmentCharacter> {
  return confusionMatrix(r.pairs, (i) => i.character, codesOf(JUDGMENT_CHARACTER))
}

/** 2단 혼동표 (제안서 5종: 기공·슬래그·균열·융합불량·용입불량). 면상·체적 추정은 범주 없음 */
export function proposalClassConfusion(r: Pick<MatchResult, 'pairs'>): ConfusionTable<ProposalDefectClass> {
  return confusionMatrix(
    r.pairs,
    (i) => (i.defectType !== null ? METALLURGICAL_TYPE_INFO[i.defectType].proposalClass : null),
    codesOf(PROPOSAL_DEFECT_CLASS)
  )
}

/** 2단 혼동표 (금속학적 종류 13가지 그대로) */
export function typeConfusion(r: Pick<MatchResult, 'pairs'>): ConfusionTable<MetallurgicalType> {
  return confusionMatrix(r.pairs, (i) => i.defectType, codesOf(METALLURGICAL_TYPE))
}

// ───────────────────────────── 구간 단위 (grading unit) ─────────────────────────────

/**
 * 검토 범위를 길이 unitMm 의 단위로 나눈다. 범위 시작에서부터 자르고,
 * 끝에 남는 조각이 단위의 절반보다 짧으면 앞 단위에 붙인다(절반 이상이면 따로 단위).
 */
export function makeGradingUnits(coverage: readonly Span[], unitMm: number): Span[] {
  if (!(unitMm > 0)) throw new RangeError(`단위 길이는 0 보다 커야 합니다: ${unitMm}`)
  const out: Span[] = []
  for (const c of mergeSpans(coverage)) {
    const len = c.endMm - c.startMm
    let k = Math.floor(len / unitMm + 1e-9)
    const rest = len - k * unitMm
    if (k === 0 || rest >= unitMm / 2 - 1e-9) k += rest > 1e-9 ? 1 : 0
    for (let i = 0; i < k; i++) {
      const s = c.startMm + i * unitMm
      const e = i === k - 1 ? c.endMm : s + unitMm
      out.push({ frameKey: c.frameKey, startMm: s, endMm: e })
    }
  }
  return out
}

/** 단위에 걸친 것: 셈하는 단위가 있으면 'defect', 참고 단위만 있으면 'reference', 없으면 'none' */
export type UnitLabel = 'defect' | 'none' | 'reference'

function touchesUnit(item: MatchItem, u: Span): boolean {
  if (item.frameKey !== u.frameKey) return false
  if (item.scanEndMm === item.scanStartMm) return item.scanStartMm >= u.startMm && item.scanStartMm < u.endMm
  return item.scanStartMm < u.endMm && item.scanEndMm > u.startMm
}

export function unitLabel(unit: Span, items: readonly MatchItem[]): UnitLabel {
  let ref = false
  for (const it of items) {
    if (!touchesUnit(it, unit)) continue
    if (it.counted) return 'defect'
    ref = true
  }
  return ref ? 'reference' : 'none'
}

export interface UnitAgreement {
  /** 받은 단위 수 */
  units: number
  /** kappa 에 쓴 단위 수 */
  used: number
  /** 한쪽이라도 참고(불확실·기준 미만)만 걸려 뺀 단위 */
  excludedReference: number
  /** 품질 불량 구간에 걸려 뺀 단위 */
  excludedQuality: number
  /** [[A 결함·B 결함, A 결함·B 없음], [A 없음·B 결함, A 없음·B 없음]] */
  table: [[number, number], [number, number]]
  kappa: KappaResult
  /** A 기준 결함 없는 단위 / 결함 단위. 시험 세트는 2 이상 (평가_정의_v1.md 5.4절) */
  negativesPerPositiveA: number | null
}

/**
 * 구간 단위 일치도 (Cohen kappa, 2 × 2). exclude 에 품질 불량 구간을 주면 걸친 단위는 뺀다.
 * 그룹(스큐)은 나누지 않는다 — 한 단위 = (용접부 또는 파일, 스캔 구간).
 */
export function gradingUnitAgreement(
  units: readonly Span[],
  itemsA: readonly MatchItem[],
  itemsB: readonly MatchItem[],
  exclude: readonly Span[] = []
): UnitAgreement {
  const table: [[number, number], [number, number]] = [
    [0, 0],
    [0, 0]
  ]
  let excludedReference = 0
  let excludedQuality = 0
  for (const u of units) {
    if (exclude.some((x) => x.frameKey === u.frameKey && intervalGap(u.startMm, u.endMm, x.startMm, x.endMm).overlapMm > 0)) {
      excludedQuality++
      continue
    }
    const la = unitLabel(u, itemsA)
    const lb = unitLabel(u, itemsB)
    if (la === 'reference' || lb === 'reference') {
      excludedReference++
      continue
    }
    table[la === 'defect' ? 0 : 1][lb === 'defect' ? 0 : 1]++
  }
  const posA = table[0][0] + table[0][1]
  const negA = table[1][0] + table[1][1]
  return {
    units: units.length,
    used: posA + negA,
    excludedReference,
    excludedQuality,
    table,
    kappa: cohenKappa(table),
    negativesPerPositiveA: posA > 0 ? negA / posA : null
  }
}

// ───────────────────────────── POD 설계 ─────────────────────────────

/** 이항 누적 확률 P(X ≤ k), X ~ Bin(n, p). 로그 공간에서 더해 큰 n 에서도 넘치지 않는다 */
export function binomialCdf(k: number, n: number, p: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n 은 0 이상 정수여야 합니다: ${n}`)
  if (!(p >= 0 && p <= 1)) throw new RangeError(`확률은 0~1 이어야 합니다: ${p}`)
  if (k < 0) return 0
  if (k >= n) return 1
  if (p === 0) return 1
  if (p === 1) return 0
  const lp = Math.log(p)
  const lq = Math.log1p(-p)
  let logC = 0 // log C(n, 0)
  let sum = 0
  for (let i = 0; i <= Math.floor(k); i++) {
    if (i > 0) logC += Math.log((n - i + 1) / i)
    sum += Math.exp(logC + i * lp + (n - i) * lq)
  }
  return Math.min(1, sum)
}

/**
 * hit/miss 로 'POD ≥ pod 를 신뢰수준 confidence 로' 보이는 데 필요한 독립 물리 결함 수.
 * 미검출이 misses 개일 때, P(미검출 ≤ misses | n, 1 − pod) ≤ 1 − confidence 인 가장 작은 n
 * (= 한쪽 Clopper–Pearson 하한이 pod 이상).
 */
export function requiredDefectsForPod(misses: number, pod = 0.9, confidence = 0.95): number {
  if (!Number.isInteger(misses) || misses < 0) throw new RangeError(`미검출 수는 0 이상 정수여야 합니다: ${misses}`)
  if (!(pod > 0 && pod < 1) || !(confidence > 0 && confidence < 1)) throw new RangeError('pod·신뢰수준은 0과 1 사이여야 합니다')
  const alpha = 1 - confidence
  for (let n = misses + 1; n <= 1_000_000; n++) {
    if (binomialCdf(misses, n, 1 - pod) <= alpha) return n
  }
  throw new RangeError('필요한 결함 수가 너무 큽니다')
}

/** 90/95 (POD 90 %, 신뢰 95 %): 미검출 0 → 29, 1 → 46, 2 → 61 */
export function requiredDefectsFor9095(misses: number): number {
  return requiredDefectsForPod(misses, 0.9, 0.95)
}

/**
 * POD 의 한쪽 신뢰 하한 (Clopper–Pearson). hits / n 을 보았을 때 P(X ≥ hits | n, p) = 1 − confidence 인 p.
 * 예: 29/29 → 0.05^(1/29) ≈ 0.902. 이분법(60회, 오차 1e-15 수준)으로 푼다. n = 0 이면 null.
 */
export function podLowerBound(hits: number, n: number, confidence = 0.95): number | null {
  if (!Number.isInteger(hits) || !Number.isInteger(n) || hits < 0 || hits > n) {
    throw new RangeError(`0 ≤ hits ≤ n 인 정수여야 합니다: hits=${hits}, n=${n}`)
  }
  if (n === 0) return null
  if (hits === 0) return 0
  const alpha = 1 - confidence
  if (hits === n) return Math.pow(alpha, 1 / n)
  let lo = 0
  let hi = 1
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2
    const upper = 1 - binomialCdf(hits - 1, n, mid) // P(X ≥ hits)
    if (upper < alpha) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
