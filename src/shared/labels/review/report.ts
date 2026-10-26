/**
 * 평가 보고서 객체 — 평가_정의_v1.md 10절 보고 양식 (순수 함수, 런타임 의존성 없음). CSV 는 csv.ts.
 *
 * buildEvaluationReport({ comparison, header?, human?, design?, sensitivity? })
 *   머리: 데이터셋 버전 · 시험 세트 잠금 날짜 · 정답 계층 · 매칭 규칙(X, Y, 동결 날짜) · 지침서 · 모델 버전 ·
 *         독립 물리 결함 수(면상/체적) · 시편 수 · 용접부 수 · 검토 길이(m) · '무엇 대비'(5.5절 이름)
 *   검출: 전체·면상·체적·불확실(별도) 줄. 물리 결함 단위 재현율(주)과 지시 단위 재현율, Wilson 95 %.
 *   오검출: 용접부당·m당, 뺀 이유별 수. 분모(검토 길이)는 같은 검토 범위다.
 *   위치·크기: 칸마다 n·MAE·치우침·95 % 분위·RMSE, 같은 칸의 사람 간 MAE(human 비교를 주면).
 *   종류: 1단 혼동표(일치율, κ), 2단(제안서 5종), 종류 불확실로 뺀 수.
 *   구간 단위: 칸 길이, 쓴 칸·뺀 칸, 2 × 2 표, κ, 구간 단위 정확도, 결함 없는 칸 / 결함 칸.
 *   POD: 앱은 곡선을 맞추지 않는다(앱 밖 Python). 찾은 결함 수·한쪽 95 % 하한·90/95 에 필요한 결함 수와
 *        '추정 불가(전부 hit)' 여부만 낸다.
 *   민감도: X·Y 를 바꾼 재현율·오검출 (sensitivityGrid).
 *   놓침·오검출 목록: 단위마다 위치·크기·종류, 원인 칸은 비워 둔다(사람이 채움: SNR·비드 형상 간섭·커플링 불량·모드 변환).
 *
 * 차이는 예측 − 정답(2인 비교는 B − A). 정의되지 않는 값은 null(CSV 빈칸).
 */
import { TRUTH_TIER, type TruthTier } from '../codes'
import { normalizeId, type MatchItem, type MatchResult } from '../match'
import {
  detectionSummary,
  falsePositiveRate,
  physicalDefectRecall,
  podLowerBound,
  requiredDefectsFor9095,
  type ConfusionTable,
  type ErrorStats,
  type FalsePositiveRate,
  type KappaResult,
  type ProportionCI
} from '../metrics'
import type { JudgmentCharacter, MetallurgicalType } from '../types'
import type { ProposalDefectClass } from '../codes'
import {
  REVIEW_ERROR_FIELD_LABEL,
  REVIEW_RULES_VERSION,
  compareResolved,
  type CompareResult,
  type ComparisonPurpose,
  type ReviewErrorField,
  type ReviewRow
} from './compare'
import type { DesignCheckResult } from './design'

// ───────────────────────────── 입력 ─────────────────────────────

/** 머리에 넣을 값 (앱이 모르는 것). 비우면 빈칸 */
export interface ReportHeaderInput {
  datasetVersion?: string | null
  /** 시험 세트 잠금 날짜 */
  testSetLockedAt?: string | null
  /** 정답 계층 (A 쪽이 무엇인지). 2인 비교면 비움 */
  truthTier?: TruthTier | null
  /** 매칭 허용치 X·Y 동결 날짜 (동결 전이면 비움 → '잠정값') */
  matchFrozenAt?: string | null
  guidelineVersion?: string | null
  modelVersion?: string | null
  /** 평가한 용접부 수 (주면 계산값 대신) */
  welds?: number | null
  /** 검토 길이 (mm, 주면 계산값 대신) */
  reviewedLengthMm?: number | null
}

export interface ReportInput {
  comparison: CompareResult
  header?: ReportHeaderInput
  /** 같은 칸의 사람 간 차이 (2인 블라인드 비교 결과) */
  human?: CompareResult | null
  /** 설계값 대조 결과 (요약을 붙임) */
  design?: DesignCheckResult | null
  /** 민감도 표 (sensitivityGrid 결과) */
  sensitivity?: readonly SensitivityRow[] | null
}

// ───────────────────────────── 결과 ─────────────────────────────

export interface ReportHeader {
  purpose: ComparisonPurpose
  /** '무엇 대비' (5.5절 이름) */
  name: string
  labelers: { a: string | null; b: string | null }
  datasetVersion: string | null
  testSetLockedAt: string | null
  truthTier: TruthTier | null
  truthTierLabel: string | null
  matchRulesVersion: number
  reviewRulesVersion: number
  scanGapMm: number
  depthDiffMm: number
  /** 동결 날짜. null = 잠정값 */
  matchFrozenAt: string | null
  frame: string
  unit: string
  coverageRule: string
  gradingUnitMm: number
  guidelineVersion: string | null
  modelVersion: string | null
  /** 독립 물리 결함 수 (A 쪽 물리 결함 키 기준) */
  physicalDefects: { total: number; planar: number; volumetric: number; unknown: number }
  specimens: number | null
  welds: number
  reviewedLengthM: number | null
  /** 가설 정렬(기준점·방향 확인 전)로 낸 좌표가 섞였는지 */
  alignmentAssumed: boolean
}

export type DetectionCategory = 'all' | 'planar' | 'volumetric' | 'uncertain'
export const DETECTION_CATEGORY_LABEL: Readonly<Record<DetectionCategory, string>> = {
  all: '전체',
  planar: '면상',
  volumetric: '체적',
  uncertain: '불확실 (별도)'
}

export interface DetectionRow {
  category: DetectionCategory
  label: string
  /** 물리 결함 수 (물리 결함 키가 있는 셈하는 정답) */
  physicalDefects: number | null
  foundDefects: number | null
  defectRecall: ProportionCI | null
  indicationRecall: ProportionCI | null
  missesMatchedToReference: number | null
  missesLostCompetition: number | null
  truthOutsideCoverage: number | null
  /** 불확실 줄: 불확실 정답 수와 그 가운데 예측이 낸 수 */
  uncertainTruths: number | null
  uncertainEmitted: number | null
}

export interface FalsePositiveSection extends FalsePositiveRate {
  predMatchedToReference: number
  predInZone: number
  predOutsideCoverage: number
}

export interface ErrorRow {
  field: ReviewErrorField
  label: string
  stats: ErrorStats
  /** 같은 칸의 사람 간 MAE (human 을 줬을 때) */
  humanMae: number | null
}

export interface TypeSection {
  character: ConfusionTable<JudgmentCharacter>
  proposalClass: ConfusionTable<ProposalDefectClass>
  type: ConfusionTable<MetallurgicalType>
  /** 한쪽이라도 종류 확신도 '불확실'이라 혼동표에서 뺀 쌍 */
  typeUncertainExcluded: number
}

export interface GradingSection {
  unitMm: number
  units: number
  used: number
  excludedReference: number
  excludedQuality: number
  table: [[number, number], [number, number]]
  kappa: KappaResult
  /** 구간 단위 정확도 (p_o) */
  accuracy: number | null
  negativesPerPositive: number | null
}

export interface PodSection {
  defects: number
  hits: number
  misses: number
  /** 전부 찾음 → POD 곡선 추정 불가 */
  allHit: boolean
  /** POD 한쪽 95 % 하한 (Clopper–Pearson) */
  lowerBound95: number | null
  /** 지금 미검출 수로 90/95 를 보이는 데 필요한 결함 수 */
  requiredFor9095: number
  note: string
}

export interface SensitivityRow {
  scanGapMm: number
  depthDiffMm: number
  indicationRecall: ProportionCI
  defectRecall: ProportionCI
  falsePositives: number
  f1: number | null
}

export type ListKind = 'miss' | 'false-positive'
export const LIST_KIND_LABEL: Readonly<Record<ListKind, string>> = { miss: '미검출', 'false-positive': '오검출' }

export interface ListRow {
  rowId: string
  kind: ListKind
  /** 미검출이 예측 쪽 참고 단위하고만 맞았는지 */
  matchedToReference: boolean
  fileNames: string[]
  frameKey: string
  scanStartMm: number
  scanEndMm: number
  depthCenterMm: number | null
  lengthMm: number | null
  heightMm: number | null
  defectType: MetallurgicalType | null
  character: JudgmentCharacter | null
  /** 원인 (사람이 채움) */
  cause: string
}

export interface DesignSection {
  minTierLabel: string
  defects: number
  countedDefects: number
  matched: number
  missed: number
  missedOutsideCoverage: number
  extra: number
  typeMismatches: number
  idMismatches: number
  recall: ProportionCI
}

export interface EvaluationReport {
  header: ReportHeader
  detection: DetectionRow[]
  falsePositives: FalsePositiveSection
  errors: ErrorRow[]
  types: TypeSection
  grading: GradingSection | null
  pod: PodSection
  sensitivity: SensitivityRow[] | null
  list: ListRow[]
  design: DesignSection | null
  warnings: string[]
}

// ───────────────────────────── 계산 ─────────────────────────────

/** 정답 쪽 단위가 조건에 맞는 것만 남긴 매칭 결과 (예측 쪽 짝 없는 단위는 뺌 — 재현율용) */
function subsetByTruth(m: Pick<MatchResult, 'pairs' | 'onlyA'>, pred: (item: MatchItem) => boolean): Pick<MatchResult, 'pairs' | 'onlyA' | 'onlyB'> {
  return { pairs: m.pairs.filter((p) => pred(p.a)), onlyA: m.onlyA.filter((u) => pred(u.item)), onlyB: [] }
}

function detectionRow(category: Exclude<DetectionCategory, 'uncertain'>, m: MatchResult): DetectionRow {
  const sub = category === 'all' ? m : subsetByTruth(m, (it) => it.character === category)
  const det = detectionSummary(sub)
  const rec = physicalDefectRecall([sub])
  return {
    category,
    label: DETECTION_CATEGORY_LABEL[category],
    physicalDefects: rec.defects,
    foundDefects: rec.hits,
    defectRecall: rec.recall,
    indicationRecall: det.recall,
    missesMatchedToReference: det.missesMatchedToReference,
    missesLostCompetition: det.missesLostCompetition,
    truthOutsideCoverage: det.missesOutsideCoverage,
    uncertainTruths: null,
    uncertainEmitted: null
  }
}

function uncertainRow(m: MatchResult): DetectionRow {
  const isU = (it: MatchItem): boolean => it.referenceReasons.includes('uncertain')
  const truths = m.pairs.filter((p) => isU(p.a)).length + m.onlyA.filter((u) => isU(u.item)).length
  const emitted = m.pairs.filter((p) => isU(p.a) && p.b.counted).length
  return {
    category: 'uncertain',
    label: DETECTION_CATEGORY_LABEL.uncertain,
    physicalDefects: null,
    foundDefects: null,
    defectRecall: null,
    indicationRecall: null,
    missesMatchedToReference: null,
    missesLostCompetition: null,
    truthOutsideCoverage: null,
    uncertainTruths: truths,
    uncertainEmitted: emitted
  }
}

/** 시편·용접부 세기 (파일 틀은 파일 정렬의 시편·용접부로 바꿔 셈, 정렬이 없으면 파일 하나 = 용접부 하나) */
function weldAndSpecimenCounts(c: CompareResult): { welds: number; specimens: number | null } {
  const alignBySha = new Map(c.alignments.filter((a) => !a.deleted).map((a) => [a.sha256, a] as const))
  const keyOf = (frameKey: string): { weld: string; specimen: string | null } => {
    if (frameKey.startsWith('weld:')) {
      const body = frameKey.slice(5)
      return { weld: frameKey, specimen: body.slice(0, body.lastIndexOf('|')) }
    }
    const sha = frameKey.startsWith('file:') ? frameKey.slice(5) : frameKey
    const al = alignBySha.get(sha)
    if (al && al.specimenId !== null && normalizeId(al.specimenId) !== '') {
      return { weld: `weld:${normalizeId(al.specimenId)}|${normalizeId(al.weldId)}`, specimen: normalizeId(al.specimenId) }
    }
    return { weld: frameKey, specimen: null }
  }
  const frames = c.summary.coverage.known
    ? c.summary.coverage.frames
    : [...new Set([...c.match.pairs.flatMap((p) => [p.a.frameKey, p.b.frameKey]), ...c.match.onlyA.map((u) => u.item.frameKey), ...c.match.onlyB.map((u) => u.item.frameKey)])]
  const welds = new Set<string>()
  const specimens = new Set<string>()
  for (const f of frames) {
    const k = keyOf(f)
    welds.add(k.weld)
    if (k.specimen !== null) specimens.add(k.specimen)
  }
  return { welds: welds.size, specimens: specimens.size > 0 ? specimens.size : null }
}

function listRows(rows: readonly ReviewRow[]): ListRow[] {
  const out: ListRow[] = []
  for (const r of rows) {
    let kind: ListKind | null = null
    let unit = null
    if (r.outcome === 'a-only' || r.outcome === 'match-b-reference') {
      kind = 'miss'
      unit = r.a
    } else if (r.outcome === 'b-only') {
      kind = 'false-positive'
      unit = r.b
    }
    if (kind === null || unit === null) continue
    const it = unit.item
    out.push({
      rowId: r.id,
      kind,
      matchedToReference: r.outcome === 'match-b-reference',
      fileNames: unit.fileNames,
      frameKey: r.frameKey,
      scanStartMm: it.scanStartMm,
      scanEndMm: it.scanEndMm,
      depthCenterMm: it.depthCenterMm,
      lengthMm: it.lengthMm,
      heightMm: it.heightMm,
      defectType: it.defectType,
      character: it.character,
      cause: ''
    })
  }
  return out
}

/** 보고서 객체를 만든다 */
export function buildEvaluationReport(input: ReportInput): EvaluationReport {
  const c = input.comparison
  const h = input.header ?? {}
  const s = c.summary
  const m = c.match
  const p = c.context.params
  const warnings = [...c.warnings]

  const all = detectionRow('all', m)
  const planar = detectionRow('planar', m)
  const volumetric = detectionRow('volumetric', m)
  const defectsTotal = all.physicalDefects ?? 0
  const counts = weldAndSpecimenCounts(c)
  const welds = h.welds ?? counts.welds
  const reviewedMm = h.reviewedLengthMm ?? (s.coverage.known ? s.coverage.lengthMm : null)
  if (c.context.params.frame === 'file' && s.coverage.known && h.reviewedLengthMm == null) {
    warnings.push('파일 틀에서는 같은 용접부를 두 파일(양쪽 스캔 등)로 보면 검토 길이를 두 번 셉니다. 용접부 틀이나 직접 준 길이로 m당 오검출을 확인하십시오.')
  }
  const alignmentAssumed = [...m.pairs.flatMap((x) => [x.a, x.b]), ...m.onlyA.map((u) => u.item), ...m.onlyB.map((u) => u.item)].some((x) => x.alignmentAssumed)

  const header: ReportHeader = {
    purpose: c.purpose,
    name: c.name,
    labelers: c.labelers,
    datasetVersion: h.datasetVersion ?? null,
    testSetLockedAt: h.testSetLockedAt ?? null,
    truthTier: h.truthTier ?? null,
    truthTierLabel: h.truthTier ? TRUTH_TIER[h.truthTier] : null,
    matchRulesVersion: c.matchRulesVersion,
    reviewRulesVersion: REVIEW_RULES_VERSION,
    scanGapMm: p.scanGapMm,
    depthDiffMm: p.depthDiffMm,
    matchFrozenAt: h.matchFrozenAt ?? null,
    frame: p.frame === 'weld' ? '용접부' : '파일',
    unit: c.context.unit === 'grouping' ? '그룹 짓기 후' : '기록 하나',
    coverageRule: p.coverage === 'both' ? '두 쪽 검토 완료의 교집합' : p.coverage === 'truth' ? '정답 쪽 검토 완료' : '범위를 보지 않음',
    gradingUnitMm: c.context.gradingUnitMm,
    guidelineVersion: h.guidelineVersion ?? null,
    modelVersion: h.modelVersion ?? null,
    physicalDefects: {
      total: defectsTotal,
      planar: planar.physicalDefects ?? 0,
      volumetric: volumetric.physicalDefects ?? 0,
      unknown: Math.max(0, defectsTotal - (planar.physicalDefects ?? 0) - (volumetric.physicalDefects ?? 0))
    },
    specimens: counts.specimens,
    welds,
    reviewedLengthM: reviewedMm !== null ? reviewedMm / 1000 : null,
    alignmentAssumed
  }
  if (header.matchFrozenAt === null) warnings.push(`매칭 허용치 X = ${p.scanGapMm} mm, Y = ${p.depthDiffMm} mm 는 동결 전 잠정값입니다.`)
  if (alignmentAssumed) warnings.push("가설 정렬(기준점·방향 확인 전)로 낸 좌표가 섞여 있습니다. 결과에 '가설 정렬'을 적으십시오.")

  const det = s.detection
  const fpr = falsePositiveRate(det, { welds, inspectedLengthMm: reviewedMm ?? 0 })
  const falsePositives: FalsePositiveSection = {
    ...fpr,
    predMatchedToReference: det.predMatchedToReference,
    predInZone: det.predInZone,
    predOutsideCoverage: det.predOutsideCoverage
  }

  const shown: ReviewErrorField[] = ['scanCenter', 'depthCenter', 'length', 'height', 'heightSpec', 'heightRef6db', 'scanStart', 'scanEnd']
  const errors: ErrorRow[] = shown.map((f) => ({
    field: f,
    label: REVIEW_ERROR_FIELD_LABEL[f],
    stats: s.errors[f],
    humanMae: input.human ? input.human.summary.errors[f].mae : null
  }))

  const grading: GradingSection | null = s.grading
    ? {
        unitMm: s.grading.unitMm,
        units: s.grading.agreement.units,
        used: s.grading.agreement.used,
        excludedReference: s.grading.agreement.excludedReference,
        excludedQuality: s.grading.agreement.excludedQuality,
        table: s.grading.agreement.table,
        kappa: s.grading.agreement.kappa,
        accuracy: s.grading.accuracy,
        negativesPerPositive: s.grading.agreement.negativesPerPositiveA
      }
    : null

  const podN = all.physicalDefects ?? 0
  const podHits = all.foundDefects ?? 0
  const allHit = podN > 0 && podHits === podN
  const pod: PodSection = {
    defects: podN,
    hits: podHits,
    misses: podN - podHits,
    allHit,
    lowerBound95: podLowerBound(podHits, podN),
    requiredFor9095: requiredDefectsFor9095(podN - podHits),
    note:
      podN === 0
        ? '물리 결함 키가 있는 정답이 없어 POD 를 낼 수 없습니다.'
        : allHit
          ? '추정 불가(전부 hit). POD 곡선(a50·a90·a90/95)은 앱 밖(Python)에서 맞춥니다.'
          : 'POD 곡선(a50·a90·a90/95)은 앱 밖(Python)에서 맞춥니다. 여기 값은 hit/miss 하한입니다.'
  }

  const design: DesignSection | null = input.design
    ? {
        minTierLabel: input.design.minTierLabel,
        defects: input.design.summary.defects,
        countedDefects: input.design.summary.countedDefects,
        matched: input.design.summary.matched,
        missed: input.design.summary.missed,
        missedOutsideCoverage: input.design.summary.missedOutsideCoverage,
        extra: input.design.summary.extra,
        typeMismatches: input.design.summary.typeMismatches,
        idMismatches: input.design.summary.idMismatches,
        recall: input.design.summary.recall.recall
      }
    : null

  return {
    header,
    detection: [all, planar, volumetric, uncertainRow(m)],
    falsePositives,
    errors,
    types: { character: s.character, proposalClass: s.proposalClass, type: s.type, typeUncertainExcluded: s.character.typeUncertain },
    grading,
    pod,
    sensitivity: input.sensitivity ? [...input.sensitivity] : null,
    list: listRows(c.rows),
    design,
    warnings
  }
}

/** 민감도 기본 격자 (평가 정의 4.6절) */
export const SENSITIVITY_SCAN_GAPS_MM: readonly number[] = [5, 10, 15]
export const SENSITIVITY_DEPTH_DIFFS_MM: readonly number[] = [3, 5]

/** X·Y 를 바꿔 같은 비교를 다시 돌린 표 (평가 정의 4.6절). 다른 인자·검토 구간·그룹 짓기는 그대로 */
export function sensitivityGrid(
  c: CompareResult,
  scanGapsMm: readonly number[] = SENSITIVITY_SCAN_GAPS_MM,
  depthDiffsMm: readonly number[] = SENSITIVITY_DEPTH_DIFFS_MM
): SensitivityRow[] {
  const out: SensitivityRow[] = []
  for (const x of scanGapsMm) {
    for (const y of depthDiffsMm) {
      const r = compareResolved(
        { labelerId: c.labelers.a, records: c.recordsA, intervals: c.intervalsA },
        { labelerId: c.labelers.b, records: c.recordsB, intervals: c.intervalsB },
        { ...c.context, params: { ...c.context.params, scanGapMm: x, depthDiffMm: y } }
      )
      out.push({
        scanGapMm: x,
        depthDiffMm: y,
        indicationRecall: r.summary.detection.recall,
        defectRecall: r.summary.defectRecall.recall,
        falsePositives: r.summary.detection.falsePositives,
        f1: r.summary.detection.f1
      })
    }
  }
  return out
}
