/**
 * 두 라벨 세트 비교 — 2인 일치도·AI 평가·전문기관 비교 (3단계 검수, 순수 함수, 런타임 의존성 없음).
 * 문서: 계획_라벨링/평가_정의_v1.md 3~5절·10절·부록 A. 매칭은 match.ts, 지표는 metrics.ts, 그룹 짓기는 grouping.ts 를 그대로 쓴다.
 *
 * compareLabelSets(A, B, 문맥)
 *   1. (선택) 그룹 짓기 후 단위: unit = 'grouping' 이고 grouping = 'compute'(기본)면 두 세트를 각각 computeGrouping 으로
 *      다시 묶는다(두께 = 문맥 thicknessFor → 파일 정렬 두께 → 문맥 thicknessMm). 'stored' 는 기록의 groupingId 그대로.
 *      unit = 'record' 는 기록 하나가 한 단위다(0단계 비교 조건, 평가 정의 4.5절 1번).
 *   2. matchIndications 로 짝짓는다(같은 함수 — 2인·AI·전문기관 모두). 검토 구간은 참고 구역·검토 범위로 쓴다.
 *   3. 행 목록: 짝 / A 만 / B 만. 행 ID 는 P001… (틀 키 → 스캔 시작 순서, 같은 입력이면 같은 ID). 부록 A 쌍 판정 표가 이 행이다.
 *      행마다 차이(b − a: 스캔 중심·시작·끝, 깊이 중심, 길이, 높이), 종류 1단(면상/체적)·2단(제안서 5종·금속학적 종류) 일치,
 *      확신도(존재·종류), 짝 없는 단위의 판정(outcome)을 단다.
 *   4. 요약: 지시 매칭 재현율·정밀도(Wilson 95 %)·F1, 위치·길이·높이 오차(MAE·치우침·95 % 분위·RMSE),
 *      높이는 시방서 방법끼리('heightSpec')와 −6 dB 참고값이 낀 쌍('heightRef6db')을 따로도 낸다(평가 정의 5.2절),
 *      1단·2단 혼동표와 kappa, 구간 단위 일치도(검토 범위를 칸으로 잘라 kappa), 검토 범위 밖 짝 없는 단위는 따로 센다.
 *
 * 목적(purpose)으로 기본 검토 범위 규칙과 보고 이름(평가 정의 5.5절)을 정한다.
 *   'inter-reader' (기본) = 2인 블라인드: 범위 'both'(두 사람 검토 완료의 교집합), 이름 '사람 간 일치도'.
 *   'accuracy' = 실험실 시험 세트 확정 정답 대비 AI: 범위 'truth', 이름 '정확도'.
 *   'agency'   = 현장 전문기관 판독 대비: 범위 'truth', 이름 '전문기관 대비 일치도'.
 *   인자의 coverage 를 직접 주면 그것이 앞선다.
 *
 * 차이는 늘 b − a 다(2인 비교는 B − A). 값이 정의되지 않으면 null 이다(NaN 을 내지 않음).
 * 결과는 함수가 없는 데이터라 IPC·JSON 으로 그대로 보낼 수 있다(두께는 파일별 값으로 풀어 둔다).
 */
import { HEIGHT_METHOD_IN_SPEC, METALLURGICAL_TYPE_INFO, type ProposalDefectClass } from '../codes'
import { GROUPING_RULES_VERSION, applyGrouping, computeGrouping, groupingParams, type GroupingParams } from '../grouping'
import {
  MATCH_RULES_VERSION,
  matchIndications,
  matchParams,
  reviewSpans,
  reviewedCoverage,
  type CoverageRule,
  type FrameSpan,
  type MatchItem,
  type MatchParams,
  type MatchResult,
  type PairGeometry
} from '../match'
import {
  ERROR_FIELDS,
  PROVISIONAL_GRADING_UNIT_MM,
  characterConfusion,
  detectionSummary,
  errorStats,
  gradingUnitAgreement,
  makeGradingUnits,
  pairDiffs,
  physicalDefectRecall,
  proposalClassConfusion,
  typeConfusion,
  uncertainTruthShare,
  type ConfusionTable,
  type DefectRecall,
  type DetectionSummary,
  type ErrorField,
  type ErrorStats,
  type UnitAgreement
} from '../metrics'
import { intersectCoverage, mergeSpans, type Span } from '../spans'
import type {
  Confidence,
  FileAlignment,
  HeightMethod,
  IndicationRecord,
  JudgmentCharacter,
  MetallurgicalType,
  ReviewInterval,
  ReviewIntervalKind
} from '../types'

/** 검수 계산 규칙 버전 (행 만들기·요약·확정 규칙이 바뀌면 올린다). 매칭 규칙은 MATCH_RULES_VERSION 따로 */
export const REVIEW_RULES_VERSION = 1

/** 비교 목적 (평가 정의 5.5절의 이름과 기본 검토 범위를 정한다) */
export type ComparisonPurpose = 'inter-reader' | 'accuracy' | 'agency'

/** 보고서 '무엇 대비' 이름 (평가 정의 5.5절) */
export const COMPARISON_NAME: Readonly<Record<ComparisonPurpose, string>> = {
  'inter-reader': '사람 간 일치도',
  accuracy: '정확도',
  agency: '전문기관 대비 일치도'
}

const DEFAULT_COVERAGE: Readonly<Record<ComparisonPurpose, CoverageRule>> = {
  'inter-reader': 'both',
  accuracy: 'truth',
  agency: 'truth'
}

// ───────────────────────────── 입력 ─────────────────────────────

/** 비교할 라벨 세트 한쪽 (여러 파일의 기록을 함께 넣어도 된다) */
export interface LabelSetSide {
  /** 표시용 라벨러 ID. 없으면 기록의 labelerId (여럿이면 쉼표로 이음) */
  labelerId?: string | null
  records: readonly IndicationRecord[]
  /** 검토 구간 (검토 완료 = 검토 범위, 품질 불량·기준 미만 = 참고 구역) */
  intervals?: readonly ReviewInterval[]
}

export type CompareUnit = 'record' | 'grouping'
export type CompareGrouping = 'compute' | 'stored'

export interface CompareContext {
  /** 목적. 기본 'inter-reader' */
  purpose?: ComparisonPurpose
  /** 매칭 인자 (넘긴 값만 덮어씀). 기본 = matchParams() + 목적의 검토 범위 규칙 */
  params?: Partial<MatchParams>
  /** 파일 정렬 (용접부 틀·두께·파일 이름). 주면 params.alignments 보다 앞선다 */
  alignments?: readonly FileAlignment[]
  /** 판 두께 (mm): 파일별 함수 → 파일 정렬 두께 → 이 값 순서로 찾는다 */
  thicknessMm?: number | null
  thicknessFor?: (sha256: string) => number | null
  /** 비교 단위 (평가 정의 3절). 기본 'grouping' */
  unit?: CompareUnit
  /** unit = 'grouping' 일 때 그룹 짓기 ID 를 어디서: 'compute' = 이 함수가 다시 묶음 (기본), 'stored' = 기록 그대로 */
  grouping?: CompareGrouping
  /** 'compute' 일 때 그룹 짓기 인자 (두께는 위에서 찾음) */
  groupingParams?: Partial<GroupingParams>
  /** 구간 단위 길이 (mm). 기본 잠정 20 mm */
  gradingUnitMm?: number
  /** sha256 → 파일 이름 (없으면 파일 정렬의 이름, 그것도 없으면 sha256 앞 12자) */
  fileNames?: Readonly<Record<string, string>>
}

/** 결과에 남기는 문맥 (함수 없이 값만) */
export interface ResolvedCompareContext {
  purpose: ComparisonPurpose
  params: MatchParams
  unit: CompareUnit
  grouping: CompareGrouping | null
  groupingParams: GroupingParams | null
  gradingUnitMm: number
  /** sha256 → 두께 (mm, 모르면 null). 비교에 나온 파일만 */
  thicknessBySha: Record<string, number | null>
  fileNames: Record<string, string>
}

// ───────────────────────────── 결과 ─────────────────────────────

/** 비교 단위 하나와 그 근거 */
export interface ReviewUnit {
  item: MatchItem
  /** 이 단위를 이룬 기록 (스캔 순서) */
  records: IndicationRecord[]
  /** 기록의 라벨러 ID (여럿이면 쉼표로 이음) */
  labelerId: string | null
  /** 지시 번호 (엑셀 externalRef). 없으면 UUID 앞 8자 */
  refs: string[]
  fileNames: string[]
  /** 존재 확신도. 묶음이면 가장 높은 것 (구성원 하나라도 셈하면 단위도 셈하는 것과 같은 뜻) */
  existenceConfidence: Confidence | null
  /** 단위 높이(item.heightMm)를 낸 기록의 입력 방식 */
  heightMethod: HeightMethod | null
}

export type ReviewRowKind = 'pair' | 'only-a' | 'only-b'

/**
 * 행 판정 (detectionSummary 와 같은 규칙)
 * - match: 셈하는 단위끼리 짝 (참 검출)
 * - match-b-reference: A 는 셈하는데 B 참고 단위하고만 짝 (미검출로 셈)
 * - match-reference: A 가 참고 단위 (셈하지 않음, '불확실 정답 n건 중 m건 냄'으로 따로)
 * - a-only: A 만, 검토 범위 안 (미검출. 2인 비교에서는 'A 만 봄')
 * - b-only: B 만, 검토 범위 안, 참고 구역 밖 (오검출. 2인 비교에서는 'B 만 봄')
 * - zone: B 만인데 A 의 참고 구역(기준 미만 지시·품질 불량)에 걸침 (오검출 아님)
 * - outside-coverage: 짝 없는 셈하는 단위가 검토 범위 밖 (따로 셈)
 * - reference: 짝 없는 참고 단위
 */
export type RowOutcome = 'match' | 'match-b-reference' | 'match-reference' | 'a-only' | 'b-only' | 'zone' | 'outside-coverage' | 'reference'

export interface Agreement<T extends string> {
  a: T | null
  b: T | null
  /** 둘 다 알 때만 참/거짓, 하나라도 모르면 null */
  agree: boolean | null
}

export interface RowAgreement {
  /** 1단: 면상 / 체적 */
  character: Agreement<JudgmentCharacter>
  /** 2단: 제안서 5종 */
  proposalClass: Agreement<ProposalDefectClass>
  /** 2단: 금속학적 종류 그대로 */
  type: Agreement<MetallurgicalType>
  /** 한쪽이라도 종류 확신도 '불확실' — 혼동표에서는 뺀다 (평가 정의 5.3절) */
  typeUncertain: boolean
}

export interface ReviewRow {
  /** 'P001' … (부록 A 쌍 ID) */
  id: string
  kind: ReviewRowKind
  frameKey: string
  a: ReviewUnit | null
  b: ReviewUnit | null
  /** 짝: 두 쪽 모두 셈함. 짝 없음: 그 단위가 셈함 */
  counted: boolean
  outcome: RowOutcome
  /** 짝의 매칭 계산값 (스캔 간격·깊이 중심 차·비용) */
  geometry: PairGeometry | null
  /** b − a (mm). 짝이 아니거나 한쪽 값이 없으면 null */
  diff: Readonly<Record<ErrorField, number | null>>
  /** 짝일 때 종류 일치 */
  agreement: RowAgreement | null
  /** 짝 없는 단위: 조건을 만족하는 상대가 있었지만 1:1 경쟁에서 짝을 잃음 */
  hadCandidate: boolean
  /** 짝 없는 단위: 상대 쪽 참고 구역 */
  zone: ReviewIntervalKind | null
  /** 짝 없는 단위: 검토 범위 밖 */
  outsideCoverage: boolean
}

/** 오차 칸: metrics 의 칸 + 높이를 방법별로 나눈 두 칸 */
export type ReviewErrorField = ErrorField | 'heightSpec' | 'heightRef6db'
export const REVIEW_ERROR_FIELD_LABEL: Readonly<Record<ReviewErrorField, string>> = {
  scanCenter: '스캔 위치 중심',
  scanStart: '스캔 시작',
  scanEnd: '스캔 끝',
  depthCenter: '깊이 중심',
  length: '길이',
  height: '높이',
  heightSpec: '높이 (시방서 방법끼리)',
  heightRef6db: '높이 (−6 dB 참고값이 낀 쌍)'
}

export interface CoverageSummary {
  rule: CoverageRule
  /** 검토 범위를 알았는지 (규칙에 맞는 검토 완료 구간이 있었는지) */
  known: boolean
  /** 검토 범위 (틀 좌표, 합친 구간) */
  spans: Span[]
  /** 검토 범위 길이 합 (mm). 같은 길이를 두 그룹으로 봐도 한 번 */
  lengthMm: number
  /** 범위가 있는 틀 키 */
  frames: string[]
  /** 구간 단위에서 뺄 품질 불량 구간 ('both' 면 두 쪽, 아니면 A 쪽) */
  qualityExclude: Span[]
}

export interface GradingSummary {
  unitMm: number
  units: Span[]
  agreement: UnitAgreement
  /** 구간 단위 정확도 = 관측 일치율 p_o (정답 대비일 때 제안서 '정확도') */
  accuracy: number | null
}

export interface CompareSummary {
  /** 지시 매칭: 재현율(A 기준 B)·정밀도(= B 기준 A 의 재현율)·F1, Wilson 95 % */
  detection: DetectionSummary
  /** 물리 결함 단위 재현율 (A 에 물리 결함 ID 가 있을 때만 뜻이 있음) */
  defectRecall: DefectRecall
  uncertainShare: ReturnType<typeof uncertainTruthShare>
  errors: Record<ReviewErrorField, ErrorStats>
  character: ConfusionTable<JudgmentCharacter>
  proposalClass: ConfusionTable<ProposalDefectClass>
  type: ConfusionTable<MetallurgicalType>
  /** 검토 범위를 모르면 null */
  grading: GradingSummary | null
  coverage: CoverageSummary
  /** 검토 범위 밖이라 미검출·오검출에서 뺀 짝 없는 셈하는 단위 (따로 보고) */
  outside: { aOnly: number; bOnly: number; rowIds: string[] }
  counts: {
    unitsA: number
    unitsB: number
    pairs: number
    countedPairs: number
    onlyA: number
    onlyB: number
    excludedA: number
    excludedB: number
  }
}

export interface CompareResult {
  reviewRulesVersion: number
  matchRulesVersion: number
  /** 그룹 짓기를 다시 했으면 그 규칙 버전 */
  groupingRulesVersion: number | null
  purpose: ComparisonPurpose
  /** '무엇 대비' 이름 (평가 정의 5.5절) */
  name: string
  context: ResolvedCompareContext
  labelers: { a: string | null; b: string | null }
  rows: ReviewRow[]
  summary: CompareSummary
  match: MatchResult
  /** 비교에 쓴 기록 (그룹 짓기를 다시 했으면 groupingId 를 채운 사본) */
  recordsA: IndicationRecord[]
  recordsB: IndicationRecord[]
  intervalsA: ReviewInterval[]
  intervalsB: ReviewInterval[]
  alignments: FileAlignment[]
  /** 확인 사항 (한국어) */
  warnings: string[]
}

// ───────────────────────────── 도움 함수 ─────────────────────────────

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { certain: 3, probable: 2, uncertain: 1 }

/** 라벨러 ID 표시: 넘긴 값 → 기록의 ID (여럿이면 쉼표) → null */
function labelerOf(side: LabelSetSide): string | null {
  if (side.labelerId !== undefined && side.labelerId !== null && side.labelerId !== '') return side.labelerId
  const ids = [...new Set(side.records.map((r) => r.labelerId))].sort()
  return ids.length > 0 ? ids.join(',') : null
}

/** 칸 값 (metrics.ts fieldValue 와 같은 정의) */
export function unitFieldValue(item: MatchItem, f: ErrorField): number | null {
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

function emptyDiff(): Record<ErrorField, number | null> {
  return { scanCenter: null, scanStart: null, scanEnd: null, depthCenter: null, length: null, height: null }
}

function pairDiff(a: MatchItem, b: MatchItem): Record<ErrorField, number | null> {
  const out = emptyDiff()
  for (const f of ERROR_FIELDS) {
    const va = unitFieldValue(a, f)
    const vb = unitFieldValue(b, f)
    out[f] = va !== null && vb !== null ? vb - va : null
  }
  return out
}

function agreeOf<T extends string>(a: T | null, b: T | null): Agreement<T> {
  return { a, b, agree: a !== null && b !== null ? a === b : null }
}

export function proposalClassOf(item: Pick<MatchItem, 'defectType'>): ProposalDefectClass | null {
  return item.defectType !== null ? METALLURGICAL_TYPE_INFO[item.defectType].proposalClass : null
}

export function rowAgreement(a: MatchItem, b: MatchItem): RowAgreement {
  return {
    character: agreeOf(a.character, b.character),
    proposalClass: agreeOf(proposalClassOf(a), proposalClassOf(b)),
    type: agreeOf(a.defectType, b.defectType),
    typeUncertain: a.typeConfidence === 'uncertain' || b.typeConfidence === 'uncertain'
  }
}

function fileNameOf(sha256: string, fileNames: Readonly<Record<string, string>>): string {
  return fileNames[sha256] ?? sha256.slice(0, 12)
}

/** 비교 단위 + 그 기록 (byUuid 에 없는 UUID 는 건너뜀) */
export function reviewUnitOf(
  item: MatchItem,
  byUuid: ReadonlyMap<string, IndicationRecord>,
  fileNames: Readonly<Record<string, string>>
): ReviewUnit {
  const records = item.recordUuids
    .map((u) => byUuid.get(u))
    .filter((r): r is IndicationRecord => r !== undefined)
    .sort(
      (x, y) =>
        Math.min(x.derived.scanStartMm, x.derived.scanEndMm) - Math.min(y.derived.scanStartMm, y.derived.scanEndMm) ||
        (x.uuid < y.uuid ? -1 : x.uuid > y.uuid ? 1 : 0)
    )
  let existence: Confidence | null = null
  for (const r of records) {
    if (existence === null || CONFIDENCE_RANK[r.existenceConfidence] > CONFIDENCE_RANK[existence]) existence = r.existenceConfidence
  }
  let heightMethod: HeightMethod | null = null
  if (item.heightMm !== null) {
    const src = records.find((r) => r.height.method !== 'unmeasurable' && r.height.valueMm === item.heightMm)
    heightMethod = src?.height.method ?? null
  }
  const labelers = [...new Set(records.map((r) => r.labelerId))].sort()
  return {
    item,
    records,
    labelerId: labelers.length > 0 ? labelers.join(',') : null,
    refs: records.map((r) => r.externalRef ?? r.uuid.slice(0, 8)),
    fileNames: [...new Set(item.sha256s)].map((s) => fileNameOf(s, fileNames)),
    existenceConfidence: existence,
    heightMethod
  }
}

function pairOutcome(a: MatchItem, b: MatchItem): RowOutcome {
  if (a.counted && b.counted) return 'match'
  if (a.counted) return 'match-b-reference'
  return 'match-reference'
}

/** 높이 오차를 방법별로: 'spec' = 두 쪽 모두 시방서 방법, '6db' = 한쪽이라도 −6 dB 참고값 */
function heightDiffs(rows: readonly ReviewRow[], which: 'spec' | '6db'): number[] {
  const out: number[] = []
  for (const r of rows) {
    if (r.kind !== 'pair' || r.outcome !== 'match' || !r.a || !r.b) continue
    const d = r.diff.height
    if (d === null) continue
    const ma = r.a.heightMethod
    const mb = r.b.heightMethod
    if (ma === null || mb === null) continue
    if (which === 'spec' && HEIGHT_METHOD_IN_SPEC[ma] && HEIGHT_METHOD_IN_SPEC[mb]) out.push(d)
    if (which === '6db' && (ma === '6db' || mb === '6db')) out.push(d)
  }
  return out
}

function spanLength(spans: readonly Span[]): number {
  return mergeSpans(spans).reduce((s, x) => s + (x.endMm - x.startMm), 0)
}

function toSpans(spans: readonly FrameSpan[]): Span[] {
  return spans.map((s) => ({ frameKey: s.frameKey, startMm: s.startMm, endMm: s.endMm }))
}

/** 문맥 풀기 (두께·파일 이름을 값으로). 두 쪽 기록·검토 구간에 나온 파일만 푼다 */
export function resolveCompareContext(a: LabelSetSide, b: LabelSetSide, ctx: CompareContext = {}): ResolvedCompareContext {
  const purpose = ctx.purpose ?? 'inter-reader'
  const alignments = ctx.alignments ?? ctx.params?.alignments ?? []
  const unit: CompareUnit = ctx.unit ?? ctx.params?.unit ?? 'grouping'
  const params = matchParams({ coverage: DEFAULT_COVERAGE[purpose], ...ctx.params, alignments, unit })
  const grouping: CompareGrouping | null = unit === 'grouping' ? (ctx.grouping ?? 'compute') : null
  const live = alignments.filter((x) => !x.deleted)
  const alignBySha = new Map<string, FileAlignment>()
  for (const al of live) {
    const prev = alignBySha.get(al.sha256)
    if (!prev || al.revision > prev.revision) alignBySha.set(al.sha256, al)
  }
  const shas = [...new Set([...a.records, ...b.records, ...(a.intervals ?? []), ...(b.intervals ?? [])].map((x) => x.sha256))].sort()
  const thicknessBySha: Record<string, number | null> = {}
  const fileNames: Record<string, string> = {}
  for (const s of shas) {
    const fromFn = ctx.thicknessFor ? ctx.thicknessFor(s) : null
    const t = fromFn ?? alignBySha.get(s)?.thicknessMm ?? ctx.thicknessMm ?? null
    thicknessBySha[s] = t !== null && Number.isFinite(t) && t > 0 ? t : null
    const name = ctx.fileNames?.[s] ?? alignBySha.get(s)?.fileName
    if (name !== undefined) fileNames[s] = name
  }
  const unitMm = ctx.gradingUnitMm ?? PROVISIONAL_GRADING_UNIT_MM
  if (!(unitMm > 0)) throw new RangeError(`구간 단위 길이는 0 보다 커야 합니다: ${unitMm}`)
  return {
    purpose,
    params,
    unit,
    grouping,
    groupingParams: grouping === 'compute' ? groupingParams({ thicknessMm: ctx.thicknessMm ?? null, ...ctx.groupingParams }) : null,
    gradingUnitMm: unitMm,
    thicknessBySha,
    fileNames
  }
}

/**
 * 한 세트를 비교 단위 규칙에 맞게: 기록 단위면 groupingId 를 비우고, 'compute' 면 computeGrouping 으로 다시 묶고,
 * 'stored' 면 그대로. 그룹 짓기 확인 사항은 warnings 에 '그룹 짓기(라벨):' 를 붙여 넣는다.
 */
export function recordsForUnit(
  records: readonly IndicationRecord[],
  opts: Pick<ResolvedCompareContext, 'unit' | 'grouping' | 'groupingParams' | 'thicknessBySha'>,
  label: string,
  warnings: string[]
): IndicationRecord[] {
  if (opts.unit === 'record') return records.map((r) => (r.groupingId === null ? r : { ...r, groupingId: null }))
  if (opts.grouping === 'stored' || opts.groupingParams === null) return [...records]
  const g = computeGrouping(records, opts.groupingParams, (s) => opts.thicknessBySha[s] ?? null)
  for (const n of g.notes) warnings.push(`그룹 짓기(${label}): ${n}`)
  return applyGrouping(records, g)
}

// ───────────────────────────── 본체 ─────────────────────────────

/**
 * 두 라벨 세트를 비교한다. a = 정답 쪽(또는 라벨러 A), b = 예측 쪽(또는 라벨러 B).
 * 같은 입력 → 같은 결과(행 ID 포함).
 */
export function compareLabelSets(a: LabelSetSide, b: LabelSetSide, ctx: CompareContext = {}): CompareResult {
  const rc = resolveCompareContext(a, b, ctx)
  return compareResolved(a, b, rc)
}

/** 풀어 둔 문맥으로 다시 비교 (민감도 표 등) */
export function compareResolved(a: LabelSetSide, b: LabelSetSide, rc: ResolvedCompareContext): CompareResult {
  const warnings: string[] = []
  const recordsA = recordsForUnit(a.records, rc, 'A', warnings)
  const recordsB = recordsForUnit(b.records, rc, 'B', warnings)
  const intervalsA = [...(a.intervals ?? [])]
  const intervalsB = [...(b.intervals ?? [])]
  const params = rc.params
  const match = matchIndications(recordsA, recordsB, params, { a: intervalsA, b: intervalsB })
  warnings.push(...match.warnings)
  if (rc.unit === 'record') {
    warnings.push('비교 단위 = 기록 하나(그룹 짓기 전)입니다. 두 사람이 지시를 나눈 차이가 그대로 불일치로 나옵니다(평가 정의 3절).')
  }

  // 검토 범위 (matchIndications 와 같은 규칙) · 구간 단위에서 뺄 품질 불량 구간
  const spansA = reviewSpans(intervalsA, params).spans
  const spansB = reviewSpans(intervalsB, params).spans
  const covA = reviewedCoverage(spansA)
  const covB = reviewedCoverage(spansB)
  let coverage: Span[] | null = null
  if (params.coverage === 'truth' && covA.length > 0) coverage = covA
  if (params.coverage === 'both' && covA.length > 0 && covB.length > 0) coverage = intersectCoverage(covA, covB)
  const quality = toSpans((params.coverage === 'both' ? [...spansA, ...spansB] : spansA).filter((s) => s.kind === 'quality-bad'))
  const qualityExclude = mergeSpans(quality)
  if (params.coverage !== 'none' && coverage === null) {
    warnings.push('검토 범위 규칙에 맞는 검토 완료 구간이 없어 검토 범위를 모릅니다. 구간 단위 일치도를 내지 않았습니다.')
  }

  // 행
  const byA = new Map<string, IndicationRecord>()
  for (const r of recordsA) if (!byA.has(r.uuid)) byA.set(r.uuid, r)
  const byB = new Map<string, IndicationRecord>()
  for (const r of recordsB) if (!byB.has(r.uuid)) byB.set(r.uuid, r)
  type Draft = Omit<ReviewRow, 'id'>
  const drafts: Draft[] = []
  for (const p of match.pairs) {
    const { a: ia, b: ib, counted, ...geo } = p
    const g: PairGeometry = {
      scanGapMm: geo.scanGapMm,
      scanOverlapMm: geo.scanOverlapMm,
      scanCenterDiffMm: geo.scanCenterDiffMm,
      depthCenterDiffMm: geo.depthCenterDiffMm,
      sideChecked: geo.sideChecked,
      depthChecked: geo.depthChecked,
      cost: geo.cost
    }
    drafts.push({
      kind: 'pair',
      frameKey: ia.frameKey,
      a: reviewUnitOf(ia, byA, rc.fileNames),
      b: reviewUnitOf(ib, byB, rc.fileNames),
      counted,
      outcome: pairOutcome(ia, ib),
      geometry: g,
      diff: pairDiff(ia, ib),
      agreement: rowAgreement(ia, ib),
      hadCandidate: true,
      zone: null,
      outsideCoverage: false
    })
  }
  for (const u of match.onlyA) {
    drafts.push({
      kind: 'only-a',
      frameKey: u.item.frameKey,
      a: reviewUnitOf(u.item, byA, rc.fileNames),
      b: null,
      counted: u.item.counted,
      outcome: !u.item.counted ? 'reference' : u.outsideCoverage ? 'outside-coverage' : 'a-only',
      geometry: null,
      diff: emptyDiff(),
      agreement: null,
      hadCandidate: u.hadCandidate,
      zone: u.zone,
      outsideCoverage: u.outsideCoverage
    })
  }
  for (const u of match.onlyB) {
    drafts.push({
      kind: 'only-b',
      frameKey: u.item.frameKey,
      a: null,
      b: reviewUnitOf(u.item, byB, rc.fileNames),
      counted: u.item.counted,
      outcome: !u.item.counted ? 'reference' : u.zone !== null ? 'zone' : u.outsideCoverage ? 'outside-coverage' : 'b-only',
      geometry: null,
      diff: emptyDiff(),
      agreement: null,
      hadCandidate: u.hadCandidate,
      zone: u.zone,
      outsideCoverage: u.outsideCoverage
    })
  }
  const kindOrder: Record<ReviewRowKind, number> = { pair: 0, 'only-a': 1, 'only-b': 2 }
  const startOf = (d: Draft): number => Math.min(d.a?.item.scanStartMm ?? Infinity, d.b?.item.scanStartMm ?? Infinity)
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)
  drafts.sort(
    (x, y) =>
      cmp(x.frameKey, y.frameKey) ||
      startOf(x) - startOf(y) ||
      kindOrder[x.kind] - kindOrder[y.kind] ||
      cmp(x.a?.item.id ?? '', y.a?.item.id ?? '') ||
      cmp(x.b?.item.id ?? '', y.b?.item.id ?? '')
  )
  const width = Math.max(3, String(drafts.length).length)
  const rows: ReviewRow[] = drafts.map((d, i) => ({ id: `P${String(i + 1).padStart(width, '0')}`, ...d }))

  // 요약
  const itemsA = [...match.pairs.map((p) => p.a), ...match.onlyA.map((u) => u.item)]
  const itemsB = [...match.pairs.map((p) => p.b), ...match.onlyB.map((u) => u.item)]
  const errors = {} as Record<ReviewErrorField, ErrorStats>
  for (const f of ERROR_FIELDS) errors[f] = errorStats(pairDiffs(match.pairs, f))
  errors.heightSpec = errorStats(heightDiffs(rows, 'spec'))
  errors.heightRef6db = errorStats(heightDiffs(rows, '6db'))
  let grading: GradingSummary | null = null
  if (coverage !== null) {
    const units = makeGradingUnits(coverage, rc.gradingUnitMm)
    const agreement = gradingUnitAgreement(units, itemsA, itemsB, qualityExclude)
    grading = { unitMm: rc.gradingUnitMm, units, agreement, accuracy: agreement.kappa.po }
  }
  const covSpans = coverage ?? []
  const outsideRows = rows.filter((r) => r.outcome === 'outside-coverage')
  const summary: CompareSummary = {
    detection: detectionSummary(match),
    defectRecall: physicalDefectRecall([match]),
    uncertainShare: uncertainTruthShare(match),
    errors,
    character: characterConfusion(match),
    proposalClass: proposalClassConfusion(match),
    type: typeConfusion(match),
    grading,
    coverage: {
      rule: params.coverage,
      known: coverage !== null,
      spans: covSpans,
      lengthMm: spanLength(covSpans),
      frames: [...new Set(covSpans.map((s) => s.frameKey))].sort(),
      qualityExclude
    },
    outside: {
      aOnly: outsideRows.filter((r) => r.kind === 'only-a').length,
      bOnly: outsideRows.filter((r) => r.kind === 'only-b').length,
      rowIds: outsideRows.map((r) => r.id)
    },
    counts: {
      unitsA: itemsA.length,
      unitsB: itemsB.length,
      pairs: match.pairs.length,
      countedPairs: match.pairs.filter((p) => p.counted).length,
      onlyA: match.onlyA.length,
      onlyB: match.onlyB.length,
      excludedA: match.excludedA.length,
      excludedB: match.excludedB.length
    }
  }

  return {
    reviewRulesVersion: REVIEW_RULES_VERSION,
    matchRulesVersion: MATCH_RULES_VERSION,
    groupingRulesVersion: rc.grouping === 'compute' ? GROUPING_RULES_VERSION : null,
    purpose: rc.purpose,
    name: COMPARISON_NAME[rc.purpose],
    context: rc,
    labelers: { a: labelerOf(a), b: labelerOf(b) },
    rows,
    summary,
    match,
    recordsA,
    recordsB,
    intervalsA,
    intervalsB,
    alignments: [...params.alignments],
    warnings
  }
}

/** 행을 ID 로 찾기 */
export function reviewRowById(result: Pick<CompareResult, 'rows'>, id: string): ReviewRow | null {
  return result.rows.find((r) => r.id === id) ?? null
}
