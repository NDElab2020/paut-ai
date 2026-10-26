/**
 * 계층 종류 · 근거 등급 · 정답 판정 · 겹침 (AI 개발 플랜 v0.3 4장·D3, T2 — 2026-10-26).
 *
 * 기록 스키마(types.ts)를 바꾸지 않고 저장된 칸에서 계산한다. 그래서 스키마 버전(1)·엑셀 양식·0.2.3 앱과의
 * JSON 왕복이 그대로이고, 같은 규칙을 Python(paut_ai labels/schema.py)이 그대로 옮겨 쓸 수 있다.
 * 규칙 문서: 10_데이터관리툴/계획_AI개발/T2_계층종류_근거등급_규칙.md (이 파일과 같은 내용, 바꾸면 둘 다).
 *
 * 계층 종류
 *   L0 결함 / 비결함: kind = defect → 결함, 형상 에코·형상 불완전 → 비결함.
 *      노이즈·커플링 손실은 기록이 아니라 검토 구간(품질 불량 사유 noise·coupling, 기준 미만 지시)으로 남긴다.
 *   L1 면상 / 체적: 판정 특성 칸(character.value), 비었으면 종류의 기본값(METALLURGICAL_TYPE_INFO.defaultCharacter).
 *   L2 5종(기공·슬래그·균열·융합불량·용입불량): 종류의 제안서 5종 대응(proposalClass). 면상·체적 추정 = 5종 미정(null).
 *
 * 정답 판정 (D3: 판독 종류와 데이터시트 종류를 둘 다 기록, 일치하면 확정·불일치하면 미확정)
 *   판독 종류 = 기록의 defectType. 데이터시트 종류 = 기록이 가리키는 물리 결함(physicalDefectId)의 설계값 종류.
 *   비교는 L2(5종)에서 한다. 세부(루트 균열 ↔ 토우 균열)가 달라도 5종이 같으면 일치.
 *   근거 등급 (물리 결함의 확인 수준·출처로 정함)
 *     A 단면·CT     confirmation = sectioning (CT 도 '절단'으로 적는다). 정답 = 설계값 종류(판독과 달라도)
 *     B RT와 UT 일치 confirmation = rt, 5종 일치
 *     C 데이터시트와 판독 일치  출처 = 제작사 결함 보고서(Sonaspection 데이터시트)·설계도, 5종 일치
 *     D 판독만      물리 결함 없음·설계값 종류 없음·출처가 PCN 시트(다른 1인 판독)·없음
 *   B·C 에서 5종이 다르면 '미확정' — 종류 정답이 없다(grade = null). 검출 지표에는 넣고 분류 지표에서는 뺀다.
 *   판독이 5종 미정(면상·체적 추정)이고 설계값이 5종이면: L1 이 같으면 L1 만 확정(L2 미확정), 다르면 미확정.
 *
 * 겹침: 같은 라벨 세트에서 지우지 않은 두 기록의 상자(스캔 × V × 실제 깊이)가 겹치면 서로 겹침.
 *   스캔은 길이가 0 보다 크게 겹쳐야 한다. V·깊이는 한쪽이라도 모르면(엑셀 기록) 그 축은 겹친 것으로 본다.
 */
import { JUDGMENT_CHARACTER, METALLURGICAL_TYPE_INFO, PROPOSAL_DEFECT_CLASS, type ProposalDefectClass } from './codes'
import type { IndicationRecord, JudgmentCharacter, MetallurgicalType, PhysicalDefect } from './types'

/** 규칙 버전. 판정이 바뀌면 올린다 (Python 쪽과 맞추는 열쇠) */
export const TAXONOMY_RULES_VERSION = 1

export type HierarchyL0 = 'defect' | 'non-defect'
export type EvidenceGrade = 'A' | 'B' | 'C' | 'D'
/** 확정 / 미확정(판독·근거 불일치) / 판독만(근거 없음) / 해당 없음(비결함) */
export type TruthStatus = 'confirmed' | 'undetermined' | 'reading-only' | 'not-applicable'

export const HIERARCHY_L0: Readonly<Record<HierarchyL0, string>> = { defect: '결함', 'non-defect': '비결함' }
export const EVIDENCE_GRADE: Readonly<Record<EvidenceGrade, string>> = {
  A: 'A 단면·CT',
  B: 'B RT·UT 일치',
  C: 'C 데이터시트·판독 일치',
  D: 'D 판독만'
}
export const TRUTH_STATUS: Readonly<Record<TruthStatus, string>> = {
  confirmed: '확정',
  undetermined: '미확정',
  'reading-only': '판독만',
  'not-applicable': '해당 없음'
}

export interface TypeLevels {
  l1: JudgmentCharacter | null
  l2: ProposalDefectClass | null
}

export interface RecordTaxonomy {
  rulesVersion: number
  l0: HierarchyL0
  /** 판독 기준 L1·L2 (결함만, 비결함은 null) */
  reading: TypeLevels
  /** 연결된 물리 결함의 설계값 종류 (없으면 null) */
  datasheet: (TypeLevels & { type: MetallurgicalType }) | null
  /** 학습·분류 지표에 쓸 종류. 미확정이면 비거나 L1 만 */
  truth: TypeLevels
  status: TruthStatus
  /** 종류 정답의 근거 등급. 미확정·비결함은 null */
  grade: EvidenceGrade | null
  /** 한국어 한 줄 근거 */
  reason: string
}

/** 종류 → 5종 (면상·체적 추정은 null) */
export function l2Of(type: MetallurgicalType | null): ProposalDefectClass | null {
  return type ? METALLURGICAL_TYPE_INFO[type].proposalClass : null
}

/** 판정 특성 칸이 있으면 그것, 없으면 종류의 기본값 */
export function l1Of(type: MetallurgicalType | null, character: JudgmentCharacter | null = null): JudgmentCharacter | null {
  return character ?? (type ? METALLURGICAL_TYPE_INFO[type].defaultCharacter : null)
}

const typeName = (t: TypeLevels): string => (t.l2 ? PROPOSAL_DEFECT_CLASS[t.l2] : t.l1 ? `${JUDGMENT_CHARACTER[t.l1]}(5종 미정)` : '종류 없음')

/** 기록이 가리키는 물리 결함 (같은 시편 목록에서 ID 로, 지운 것 제외) */
export function linkedDefect(r: Pick<IndicationRecord, 'physicalDefectId'>, defects: readonly PhysicalDefect[]): PhysicalDefect | null {
  if (!r.physicalDefectId) return null
  return defects.find((d) => !d.deleted && d.id === r.physicalDefectId) ?? null
}

/**
 * 기록 하나의 계층 종류·정답 판정. defects 는 그 파일 시편의 물리 결함 목록(블라인드에서는 빈 목록 — 판독만으로 나옴).
 */
export function recordTaxonomy(r: Pick<IndicationRecord, 'kind' | 'defectType' | 'character' | 'physicalDefectId'>, defects: readonly PhysicalDefect[] = []): RecordTaxonomy {
  const base = { rulesVersion: TAXONOMY_RULES_VERSION }
  if (r.kind !== 'defect') {
    const none = { l1: null, l2: null }
    return { ...base, l0: 'non-defect', reading: none, datasheet: null, truth: none, status: 'not-applicable', grade: null, reason: '비결함 기록' }
  }
  const reading: TypeLevels = { l1: l1Of(r.defectType, r.character.value), l2: l2Of(r.defectType) }
  const pd = linkedDefect(r, defects)
  const dt = pd?.design.type ?? null
  if (!pd || !dt) {
    return { ...base, l0: 'defect', reading, datasheet: null, truth: reading, status: 'reading-only', grade: 'D', reason: pd ? `물리 결함 ${pd.id} 에 설계값 종류가 없음 — 판독만` : '연결된 물리 결함 없음 — 판독만' }
  }
  const datasheet = { type: dt, l1: l1Of(dt), l2: l2Of(dt) }
  if (pd.confirmation === 'sectioning') {
    return { ...base, l0: 'defect', reading, datasheet, truth: { l1: datasheet.l1, l2: datasheet.l2 }, status: 'confirmed', grade: 'A', reason: `절단 확인 ${pd.id}: ${typeName(datasheet)}` }
  }
  const certified = pd.source === 'manufacturer-report' || pd.source === 'design-drawing'
  if (pd.confirmation !== 'rt' && !certified) {
    return { ...base, l0: 'defect', reading, datasheet, truth: reading, status: 'reading-only', grade: 'D', reason: `물리 결함 ${pd.id} 의 출처가 판독 기록이라 근거가 아님 — 판독만` }
  }
  const grade: EvidenceGrade = pd.confirmation === 'rt' ? 'B' : 'C'
  const what = grade === 'B' ? 'RT' : '데이터시트'
  if (reading.l2 && datasheet.l2) {
    if (reading.l2 === datasheet.l2) return { ...base, l0: 'defect', reading, datasheet, truth: { l1: datasheet.l1, l2: datasheet.l2 }, status: 'confirmed', grade, reason: `판독 ${typeName(reading)} = ${what} ${typeName(datasheet)}` }
    return { ...base, l0: 'defect', reading, datasheet, truth: { l1: null, l2: null }, status: 'undetermined', grade: null, reason: `판독 ${typeName(reading)} ≠ ${what} ${typeName(datasheet)}` }
  }
  const l1Agree = reading.l1 !== null && reading.l1 === datasheet.l1
  return {
    ...base,
    l0: 'defect',
    reading,
    datasheet,
    truth: { l1: l1Agree ? datasheet.l1 : null, l2: null },
    status: 'undetermined',
    grade: null,
    reason: `판독 ${typeName(reading)} · ${what} ${typeName(datasheet)} — 5종 비교 불가${l1Agree ? ' (면상·체적만 일치)' : ''}`
  }
}

type BoxRec = Pick<IndicationRecord, 'uuid' | 'deleted' | 'derived'>

function axisOverlap(a0: number | null, a1: number | null, b0: number | null, b1: number | null, strict: boolean): boolean {
  if (a0 === null || a1 === null || b0 === null || b1 === null) return true
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1))
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1))
  return strict ? hi > lo : hi >= lo
}

/** 두 기록의 상자가 겹치는지 (스캔은 길이 > 0, V·깊이는 모르면 겹친 것으로) */
export function boxesOverlap(a: BoxRec, b: BoxRec): boolean {
  const A = a.derived
  const B = b.derived
  return (
    axisOverlap(A.scanStartMm, A.scanEndMm, B.scanStartMm, B.scanEndMm, true) &&
    axisOverlap(A.vMinMm, A.vMaxMm, B.vMinMm, B.vMaxMm, false) &&
    axisOverlap(A.depthTopMm, A.depthBottomMm, B.depthTopMm, B.depthBottomMm, false)
  )
}

/**
 * 같은 라벨 세트 기록들의 겹침: uuid → 겹치는 기록 uuid 목록 (지운 기록 제외, 겹침 없는 기록은 키 없음).
 * 호출 쪽이 한 세트의 기록만 넘긴다.
 */
export function overlapMap(records: readonly BoxRec[]): Map<string, string[]> {
  const lo = (r: BoxRec): number => Math.min(r.derived.scanStartMm, r.derived.scanEndMm)
  const live = records.filter((r) => !r.deleted).slice().sort((a, b) => lo(a) - lo(b) || (a.uuid < b.uuid ? -1 : 1))
  const out = new Map<string, string[]>()
  for (let i = 0; i < live.length; i++) {
    const a = live[i]!
    const aEnd = Math.max(a.derived.scanStartMm, a.derived.scanEndMm)
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j]!
      if (lo(b) >= aEnd) break
      if (!boxesOverlap(a, b)) continue
      out.set(a.uuid, [...(out.get(a.uuid) ?? []), b.uuid])
      out.set(b.uuid, [...(out.get(b.uuid) ?? []), a.uuid])
    }
  }
  return out
}
