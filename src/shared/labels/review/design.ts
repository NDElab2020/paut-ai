/**
 * 설계값 대조 — 물리 결함 표(설계·인증값)와 라벨 세트(보통 확정 세트)를 짝짓는다 (순수 함수, 런타임 의존성 없음).
 * 문서: 계획_라벨링/평가_정의_v1.md 1·2절(정답 계층, 시험 세트 ② 설계값 대조), 3절(용접부 틀), 7절(POD 는 계층 1).
 *
 * checkAgainstDesign(기록, 물리 결함, 문맥)
 *   - 늘 용접부 틀이다(설계값은 시편 좌표). 파일 정렬(기준점·방향)이 없는 파일의 기록은 빠지고 확인 사항이 남는다.
 *   - 같은 매칭 함수(match.ts matchItems)를 쓴다. A = 설계값(물리 결함), B = 기록 단위.
 *   - 비교 단위는 compareLabelSets 와 같은 규칙(기본: 그룹 짓기를 다시 해서 묶은 단위).
 *   - 정답 계층: 기본 minTier = 'certified'(인증·설계값). 계층이 낮거나 없는 결함은 참고 단위다.
 *     X3 결함정보처럼 출처가 없는 표로 0단계 참고 비교를 할 때만 'any' 를 쓰고 결과에 그 사실을 적는다.
 *   - 깊이: 설계 깊이가 윗끝인지 중심인지 정해지기 전(depthIs = 'unknown', 기본)에는 깊이를 비교하지 않는다.
 *   - 검토 범위: 기록 세트의 검토 완료 구간을 주면, 그 밖에 있는 미검출은 따로 센다(범위 밖 설계 결함은 아무도 보지 않음).
 *
 * 결과 표 (행 ID D001…):
 *   matched = 짝지어짐, missed = 미검출(설계에만 있음), extra = 추가 발견(설계에 없던 지시).
 *   종류 불일치 = 짝인데 1단(면상/체적) 또는 2단(제안서 5종)이 둘 다 알려져 있고 다름.
 *   ID 불일치 = 기록에 적힌 물리 결함 ID 가 위치로 맞춘 결함과 다름(또는 짝이 없는데 ID 가 있음).
 */
import { TRUTH_TIER, type ProposalDefectClass, type TruthTier } from '../codes'
import type { GroupingParams } from '../grouping'
import {
  matchItems,
  matchParams,
  normalizeId,
  physicalDefectItems,
  prepareMatchItems,
  reviewSpans,
  reviewedCoverage,
  type MatchItem,
  type MatchParams,
  type MatchResult
} from '../match'
import {
  characterConfusion,
  detectionSummary,
  physicalDefectRecall,
  proposalClassConfusion,
  type ConfusionTable,
  type DefectRecall,
  type DetectionSummary
} from '../metrics'
import type { FileAlignment, IndicationRecord, JudgmentCharacter, PhysicalDefect, ReviewInterval, ReviewIntervalKind } from '../types'
import {
  recordsForUnit,
  resolveCompareContext,
  reviewUnitOf,
  rowAgreement,
  type CompareGrouping,
  type CompareUnit,
  type ReviewUnit,
  type RowAgreement,
  type RowOutcome
} from './compare'

export type DesignDepthMeaning = 'top' | 'center' | 'unknown'

export interface DesignCheckContext {
  /** 파일 정렬 (기준점·방향·시편 ID). 용접부 틀이라 꼭 있어야 한다 */
  alignments: readonly FileAlignment[]
  /** 매칭 인자 (X·Y 등). 틀은 늘 'weld' */
  params?: Partial<MatchParams>
  /** 셈하는 정답 계층의 하한. 기본 'certified' */
  minTier?: TruthTier | 'any'
  /** 설계 깊이의 뜻. 기본 'unknown' (깊이 비교 안 함) */
  depthIs?: DesignDepthMeaning
  /** 기록 세트의 검토 구간 (검토 완료 = 범위, 기준 미만·품질 불량 = 참고 구역) */
  intervals?: readonly ReviewInterval[]
  unit?: CompareUnit
  grouping?: CompareGrouping
  groupingParams?: Partial<GroupingParams>
  thicknessMm?: number | null
  thicknessFor?: (sha256: string) => number | null
  fileNames?: Readonly<Record<string, string>>
}

export type DesignRowStatus = 'matched' | 'missed' | 'extra'

export const DESIGN_ROW_STATUS_LABEL: Readonly<Record<DesignRowStatus, string>> = {
  matched: '짝지어짐',
  missed: '미검출 (설계에만 있음)',
  extra: '추가 발견 (설계에 없음)'
}

export interface DesignCheckRow {
  /** 'D001' … */
  id: string
  status: DesignRowStatus
  frameKey: string
  /** 물리 결함 키 '시편/ID' (시편 ID 는 대문자). 추가 발견은 null */
  defectKey: string | null
  defect: PhysicalDefect | null
  /** 설계값 비교 단위 */
  design: MatchItem | null
  /** 기록 쪽 비교 단위 */
  unit: ReviewUnit | null
  /** 짝: 두 쪽 모두 셈함. 미검출: 설계가 셈함. 추가 발견: 기록 단위가 셈함 */
  counted: boolean
  /** compareLabelSets 와 같은 판정 (A = 설계, B = 기록) */
  outcome: RowOutcome
  agreement: RowAgreement | null
  /** 짝인데 1단 또는 2단 종류가 둘 다 알려져 있고 다름 */
  typeMismatch: boolean
  /** 기록 − 설계 (mm). 짝일 때만 */
  scanCenterDiffMm: number | null
  lengthDiffMm: number | null
  /** 기록에 적힌 물리 결함 키 (구성 기록마다, 중복 없이) */
  recordDefectKeys: string[]
  /** 기록에 적힌 물리 결함 ID 가 이 행의 결함과 다름 (추가 발견인데 ID 가 있어도 참) */
  idMismatch: boolean
  hadCandidate: boolean
  zone: ReviewIntervalKind | null
  outsideCoverage: boolean
}

export interface DesignCheckSummary {
  /** 설계 결함 수 (빠진 것 제외) */
  defects: number
  /** 셈하는 설계 결함 (계층이 기준 이상) */
  countedDefects: number
  /** 참고 결함 (계층이 낮거나 없음) */
  referenceDefects: number
  matched: number
  missed: number
  /** 미검출 중 검토 범위 밖 */
  missedOutsideCoverage: number
  extra: number
  extraOutsideCoverage: number
  typeMismatches: number
  characterMismatches: number
  proposalClassMismatches: number
  idMismatches: number
  /** 물리 결함 단위 재현율 (설계 대비) */
  recall: DefectRecall
  detection: DetectionSummary
  character: ConfusionTable<JudgmentCharacter>
  proposalClass: ConfusionTable<ProposalDefectClass>
}

export interface DesignCheckResult {
  minTier: TruthTier | 'any'
  /** 정답 계층 이름 ('any' 면 '계층 무관 (참고 비교)') */
  minTierLabel: string
  depthIs: DesignDepthMeaning
  rows: DesignCheckRow[]
  summary: DesignCheckSummary
  /** A = 설계값, B = 기록 단위 */
  match: MatchResult
  /** 비교에 쓴 기록 (그룹 짓기를 다시 했으면 그 사본) */
  records: IndicationRecord[]
  warnings: string[]
}

function defectKeyOf(specimenId: string, id: string): string {
  return `${normalizeId(specimenId)}/${id.trim()}`
}

function typeMismatchOf(g: RowAgreement): { character: boolean; proposal: boolean } {
  return { character: g.character.agree === false, proposal: g.proposalClass.agree === false }
}

/**
 * 기록 세트를 설계값과 대조한다. 같은 입력 → 같은 결과(행 ID 포함).
 */
export function checkAgainstDesign(
  records: readonly IndicationRecord[],
  defects: readonly PhysicalDefect[],
  ctx: DesignCheckContext
): DesignCheckResult {
  const warnings: string[] = []
  const minTier = ctx.minTier ?? 'certified'
  const depthIs = ctx.depthIs ?? 'unknown'
  const intervals = ctx.intervals ?? []
  const coverageRule = intervals.length > 0 ? 'truth' : 'none'
  const rc = resolveCompareContext(
    { records, intervals },
    { records: [] },
    {
      purpose: 'accuracy',
      params: { ...ctx.params, frame: 'weld', coverage: coverageRule },
      alignments: ctx.alignments,
      unit: ctx.unit,
      grouping: ctx.grouping,
      groupingParams: ctx.groupingParams,
      thicknessMm: ctx.thicknessMm,
      thicknessFor: ctx.thicknessFor,
      fileNames: ctx.fileNames
    }
  )
  const params = matchParams({ ...rc.params, frame: 'weld', coverage: coverageRule })
  const recs = recordsForUnit(records, rc, '기록', warnings)
  const prepared = prepareMatchItems(recs, params)
  warnings.push(...prepared.warnings)
  const noAlign = prepared.excluded.filter((e) => e.reason === 'no-alignment').length
  if (noAlign > 0) warnings.push(`파일 정렬(시편 ID·기준점·방향)이 없어 설계값과 견주지 못한 기록 ${noAlign}건이 있습니다.`)
  const design = physicalDefectItems(defects, { minTier, depthIs })
  warnings.push(...design.warnings)
  if (minTier === 'any') warnings.push('정답 계층과 무관하게 모든 물리 결함을 셌습니다(0단계 참고 비교). 결과에 이 사실을 적으십시오.')
  if (depthIs === 'unknown') warnings.push('설계 깊이의 뜻(윗끝/중심)을 정하지 않아 깊이는 비교하지 않았습니다.')

  // 검토 범위·참고 구역 (기록 세트 쪽)
  const spans = reviewSpans(intervals, params).spans
  const cov = reviewedCoverage(spans)
  const zones = { b: spans, ...(coverageRule === 'truth' && cov.length > 0 ? { coverage: cov } : {}) }
  if (coverageRule === 'none') warnings.push('기록 세트의 검토 구간을 주지 않아 검토 범위를 모릅니다. 미검출을 모두 셉니다.')
  const m = matchItems(design.items, prepared.items, { ...params, coverage: coverageRule === 'truth' && cov.length > 0 ? 'truth' : 'none' }, zones)
  warnings.push(...m.warnings)
  const match = { ...m, excludedA: design.excluded, excludedB: prepared.excluded }

  // 표
  const defectByKey = new Map<string, PhysicalDefect>()
  for (const d of defects) if (!d.deleted && !defectByKey.has(defectKeyOf(d.specimenId, d.id))) defectByKey.set(defectKeyOf(d.specimenId, d.id), d)
  const specimenOf = new Map<string, string | null>()
  for (const al of ctx.alignments) if (!al.deleted) specimenOf.set(al.sha256, al.specimenId)
  const byUuid = new Map<string, IndicationRecord>()
  for (const r of recs) if (!byUuid.has(r.uuid)) byUuid.set(r.uuid, r)
  const keysOf = (u: ReviewUnit): string[] => {
    const out = new Set<string>()
    for (const r of u.records) {
      if (r.physicalDefectId === null) continue
      const sp = specimenOf.get(r.sha256) ?? null
      if (sp !== null && normalizeId(sp) !== '') out.add(defectKeyOf(sp, r.physicalDefectId))
    }
    return [...out].sort()
  }
  const keyOfDesign = (item: MatchItem): string | null => item.physicalDefectKey

  type Draft = Omit<DesignCheckRow, 'id'>
  const drafts: Draft[] = []
  for (const p of m.pairs) {
    const unit = reviewUnitOf(p.b, byUuid, rc.fileNames)
    const g = rowAgreement(p.a, p.b)
    const tm = typeMismatchOf(g)
    const key = keyOfDesign(p.a)
    const rk = keysOf(unit)
    const center = (x: MatchItem): number => (x.scanStartMm + x.scanEndMm) / 2
    drafts.push({
      status: 'matched',
      frameKey: p.a.frameKey,
      defectKey: key,
      defect: key !== null ? (defectByKey.get(key) ?? null) : null,
      design: p.a,
      unit,
      counted: p.counted,
      outcome: p.a.counted && p.b.counted ? 'match' : p.a.counted ? 'match-b-reference' : 'match-reference',
      agreement: g,
      typeMismatch: tm.character || tm.proposal,
      scanCenterDiffMm: center(p.b) - center(p.a),
      lengthDiffMm: p.a.lengthMm !== null && p.b.lengthMm !== null ? p.b.lengthMm - p.a.lengthMm : null,
      recordDefectKeys: rk,
      idMismatch: rk.some((k) => k !== key),
      hadCandidate: true,
      zone: null,
      outsideCoverage: false
    })
  }
  for (const u of m.onlyA) {
    const key = keyOfDesign(u.item)
    drafts.push({
      status: 'missed',
      frameKey: u.item.frameKey,
      defectKey: key,
      defect: key !== null ? (defectByKey.get(key) ?? null) : null,
      design: u.item,
      unit: null,
      counted: u.item.counted,
      outcome: !u.item.counted ? 'reference' : u.outsideCoverage ? 'outside-coverage' : 'a-only',
      agreement: null,
      typeMismatch: false,
      scanCenterDiffMm: null,
      lengthDiffMm: null,
      recordDefectKeys: [],
      idMismatch: false,
      hadCandidate: u.hadCandidate,
      zone: u.zone,
      outsideCoverage: u.outsideCoverage
    })
  }
  for (const u of m.onlyB) {
    const unit = reviewUnitOf(u.item, byUuid, rc.fileNames)
    const rk = keysOf(unit)
    drafts.push({
      status: 'extra',
      frameKey: u.item.frameKey,
      defectKey: null,
      defect: null,
      design: null,
      unit,
      counted: u.item.counted,
      outcome: !u.item.counted ? 'reference' : u.zone !== null ? 'zone' : u.outsideCoverage ? 'outside-coverage' : 'b-only',
      agreement: null,
      typeMismatch: false,
      scanCenterDiffMm: null,
      lengthDiffMm: null,
      recordDefectKeys: rk,
      idMismatch: rk.length > 0,
      hadCandidate: u.hadCandidate,
      zone: u.zone,
      outsideCoverage: u.outsideCoverage
    })
  }
  const order: Record<DesignRowStatus, number> = { matched: 0, missed: 1, extra: 2 }
  const startOf = (d: Draft): number => Math.min(d.design?.scanStartMm ?? Infinity, d.unit?.item.scanStartMm ?? Infinity)
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)
  drafts.sort(
    (x, y) =>
      cmp(x.frameKey, y.frameKey) ||
      startOf(x) - startOf(y) ||
      order[x.status] - order[y.status] ||
      cmp(x.defectKey ?? '', y.defectKey ?? '') ||
      cmp(x.unit?.item.id ?? '', y.unit?.item.id ?? '')
  )
  const width = Math.max(3, String(drafts.length).length)
  const rows: DesignCheckRow[] = drafts.map((d, i) => ({ id: `D${String(i + 1).padStart(width, '0')}`, ...d }))

  const matchedRows = rows.filter((r) => r.status === 'matched')
  const missedRows = rows.filter((r) => r.status === 'missed')
  const extraRows = rows.filter((r) => r.status === 'extra')
  const summary: DesignCheckSummary = {
    defects: design.items.length,
    countedDefects: design.items.filter((x) => x.counted).length,
    referenceDefects: design.items.filter((x) => !x.counted).length,
    matched: matchedRows.length,
    missed: missedRows.length,
    missedOutsideCoverage: missedRows.filter((r) => r.outsideCoverage).length,
    extra: extraRows.length,
    extraOutsideCoverage: extraRows.filter((r) => r.outsideCoverage).length,
    typeMismatches: matchedRows.filter((r) => r.typeMismatch).length,
    characterMismatches: matchedRows.filter((r) => r.agreement?.character.agree === false).length,
    proposalClassMismatches: matchedRows.filter((r) => r.agreement?.proposalClass.agree === false).length,
    idMismatches: rows.filter((r) => r.idMismatch).length,
    recall: physicalDefectRecall([m]),
    detection: detectionSummary(m),
    character: characterConfusion(m),
    proposalClass: proposalClassConfusion(m)
  }
  if (summary.idMismatches > 0) {
    warnings.push(`기록에 적힌 물리 결함 ID 가 위치로 맞춘 결함과 다른 행이 ${summary.idMismatches}개 있습니다. Level III 가 확인하십시오.`)
  }
  return {
    minTier,
    minTierLabel: minTier === 'any' ? '계층 무관 (참고 비교)' : TRUTH_TIER[minTier],
    depthIs,
    rows,
    summary,
    match,
    records: recs,
    warnings
  }
}
