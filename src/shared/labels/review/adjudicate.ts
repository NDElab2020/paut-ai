/**
 * 확정(Level III) 도우미 — 비교 행마다의 결정과 설계값 대조로 새 확정 세트를 만든다 (순수 함수, 런타임 의존성 없음).
 * 문서: 계획_라벨링/평가_정의_v1.md 2절(시험 세트 ③ 확정), 6절(불확실), 지침서_v1.md 13절(원래 두 기록은 고치지 않음).
 *
 * buildFinalSet(입력) → 새 기록 목록 (저장은 하지 않는다. 화면·서비스가 저장소에 넣는다)
 *   행 결정 (비교 행 ID 마다 하나):
 *     'a' A 채택 / 'b' B 채택: 그 쪽 단위의 기록을 모두 베낀다(묶음이면 구성 기록마다 하나).
 *     'merge' 합침: 칸 묶음마다 A·B 를 고른다(position·type·existence·length·height·signal·note). 위치(position)를 고른 쪽이
 *        기록의 뼈대(파일·앵커·파생 위치·화면 스냅샷)가 된다. 두 쪽이 모두 기록 하나일 때만 모든 칸을 고를 수 있고,
 *        묶음(그룹)이 끼면 종류·존재 확신도·메모만 다른 쪽에서 가져온다(나머지는 확인 사항을 남기고 위치 쪽 값).
 *     'neither' 둘 다 아님 = 결함 아님: 기록을 만들지 않는다.
 *     'defer' 보류: 기본(deferAs = 'uncertain')은 위치 쪽(A, 없으면 B) 기록을 존재 확신도 '불확실'로 남긴다
 *        (평가 정의 6절: 확정하지 못한 것만 '불확실' 범주로 남겨 따로 셈). 'omit' 이면 만들지 않는다.
 *     결정이 없는 행은 'undecided' 로 돌려주고 complete = false 다.
 *   새 기록: 판독 단계 'final', 라벨러 = Level III, 판독 출처 '우리 전문가', 설계값 봤음 = 예, 그룹 짓기 ID 비움(저장소가 다시 계산),
 *     제안 기록(suggestions) 비움(원래 라벨러의 것), 지시 번호 비움.
 *   출처 기록: 스키마에 맞는 칸이 없어 모르는 칸 보존 규칙(validate.ts)을 써서 'adjudication' 객체로 둔다.
 *     validate 가 '모르는 칸을 그대로 보존합니다: adjudication' 경고를 내지만 통과한다(저장소도 그대로 둔다).
 *   UUID: 입력 UUID 에서 만든 결정적 UUID v5 = (Level III, 지침서 버전, sha256, 원본 기록 UUID).
 *     같은 결정을 다시 돌리면 같은 UUID 라 그 자리에서 고쳐진다. 'a' ↔ '합침(위치 = a)' ↔ '보류(a)' 는 같은 UUID,
 *     'a' → 'b' 처럼 원본이 바뀌면 새 UUID 다. previous(이전 확정 기록)를 주면 versions·revision·createdAt 을 이어 받고,
 *     이번에 나오지 않은 이전 UUID 를 removed 로 돌려준다(화면이 지움 표시).
 *   설계값: design 을 주면 확정 기록을 설계값과 대조하고(design.ts), link = true(기본)면 짝지어진 결함의 ID 를
 *     물리 결함 ID 가 빈 기록에 채운다. 결정에서 physicalDefectId 를 직접 주면 그것이 앞선다.
 *     designAdditions 로 아무도 적지 않았지만 Level III 가 신호에서 확인한 설계 결함을 새 기록으로 더한다(위치 = 설계값을
 *     파일 정렬로 파일 U 로 되돌림, 측정값은 비움 — 신호에서 다시 잼).
 *   검토 구간: reviews = 'intersection'(기본)이면 검토 완료 = 두 사람 검토 완료의 교집합(그룹별, 모든 그룹 구간 포함),
 *     품질 불량·기준 미만 = 두 쪽 합집합(같은 구간은 하나). 'a'·'b' 는 그 쪽을 베끼고, 'none' 은 만들지 않는다.
 *   비결함 기록(형상 에코·형상 불완전)은 비교에서 빠지므로 carryNonDefect('a'·'b')로 한쪽 것을 베낄 수 있다(기본 'none').
 */
import { normalizeId, physicalDefectItems } from '../match'
import { newIndicationRecord } from '../factory'
import type { TruthTier } from '../codes'
import { intersectCoverage, mergeSpans, type Span } from '../spans'
import type {
  AnchorPoint,
  Confidence,
  FileAlignment,
  IndicationRecord,
  LabelSetKey,
  PhysicalDefect,
  ReviewGateRange,
  ReviewInterval
} from '../types'
import { REVIEW_RULES_VERSION, type CompareResult, type ReviewRow, type ReviewUnit } from './compare'
import { checkAgainstDesign, type DesignCheckResult, type DesignDepthMeaning } from './design'
import { adjudicationUuid } from './uuid'

// ───────────────────────────── 입력 ─────────────────────────────

export type AdjudicationChoice = 'a' | 'b' | 'merge' | 'neither' | 'defer'

/** 합칠 때 고르는 칸 묶음 */
export type MergeField = 'position' | 'type' | 'existence' | 'length' | 'height' | 'signal' | 'note'
export const MERGE_FIELDS: readonly MergeField[] = ['position', 'type', 'existence', 'length', 'height', 'signal', 'note']
export const MERGE_FIELD_LABEL: Readonly<Record<MergeField, string>> = {
  position: '위치 (파일·스캔·깊이·V·측, 앵커)',
  type: '종류 (종류·ISO 코드·종류 확신도·판정 특성·표면·점 지시·위치 구분)',
  existence: '존재 확신도',
  length: '길이',
  height: '높이',
  signal: '신호 (최대 진폭·포화·기준 초과·최대 진폭 위치)',
  note: '메모'
}
/** 묶음(그룹)이 낀 합침에서도 다른 쪽에서 가져올 수 있는 칸 */
const UNIT_LEVEL_FIELDS: ReadonlySet<MergeField> = new Set(['type', 'existence', 'note'])

export interface AdjudicationDecision {
  /** 비교 행 ID ('P001') */
  rowId: string
  choice: AdjudicationChoice
  /** 'merge' 일 때 칸 묶음마다 'a' / 'b'. 빠진 칸은 position 쪽 (position 이 없으면 A) */
  fields?: Partial<Record<MergeField, 'a' | 'b'>>
  /** 물리 결함 ID 를 직접 정함 (null = 비움). 주지 않으면 원본 값, 설계값 연결(link)이 빈 값을 채움 */
  physicalDefectId?: string | null
  /** Level III 메모 (출처 기록과 기록 메모 끝에 붙음) */
  note?: string
}

/** 아무도 적지 않았지만 Level III 가 신호에서 확인한 설계 결함을 더한다 */
export interface DesignAddition {
  specimenId: string
  defectId: string
  /** 기록을 둘 파일 (그 파일 정렬로 시편 좌표 → 파일 U) */
  sha256: string
  note?: string
}

export interface Adjudicator {
  labelerId: string
  qualification?: string | null
  organization?: string | null
}

export interface AdjudicationInput {
  comparison: CompareResult
  decisions: readonly AdjudicationDecision[]
  adjudicator: Adjudicator
  /** 확정 세트의 지침서 버전. 기본 = 원본 기록에 가장 많은 값 (없으면 'v1') */
  guidelineVersion?: string
  /** 기록의 '마지막으로 고친 PC' (저장소가 저장할 때 다시 씀) */
  pcId?: string | null
  /** 기록 시각 (ISO 8601). 순수 함수라 부르는 쪽이 준다. 없으면 null */
  now?: string | null
  deferAs?: 'uncertain' | 'omit'
  carryNonDefect?: 'a' | 'b' | 'none'
  reviews?: 'intersection' | 'a' | 'b' | 'none'
  design?: {
    defects: readonly PhysicalDefect[]
    minTier?: TruthTier | 'any'
    depthIs?: DesignDepthMeaning
    /** 짝지어진 결함 ID 를 빈 물리 결함 ID 에 채움 (기본 true) */
    link?: boolean
  }
  designAdditions?: readonly DesignAddition[]
  /** 이전에 만든 확정 기록·검토 구간 (같은 UUID 면 versions·revision·createdAt 을 이어 받음) */
  previous?: { records?: readonly IndicationRecord[]; reviewIntervals?: readonly ReviewInterval[] }
}

// ───────────────────────────── 결과 ─────────────────────────────

/** 확정 기록의 출처 (모르는 칸 'adjudication' 으로 보존) */
export interface AdjudicationProvenance {
  format: 'paut-adjudication'
  reviewRulesVersion: number
  /** 비교 행 ID (그 비교 결과 안에서만 뜻이 있음). 설계값으로 더한 기록은 null */
  rowId: string | null
  decision: AdjudicationChoice | 'design-add' | 'carry'
  /** 합침일 때 칸 묶음마다 고른 쪽, 아니면 null */
  fieldSources: Record<MergeField, 'a' | 'b'> | null
  /** 이 기록의 뼈대가 된 원본 기록 UUID (설계값으로 더한 기록은 null) */
  sourceRecord: string | null
  /** 그 행의 두 쪽 원본 기록 UUID */
  sources: { a: string[]; b: string[] }
  labelers: { a: string | null; b: string | null }
  match: { rulesVersion: number; scanGapMm: number; depthDiffMm: number; frame: string; unit: string }
  /** 설계값 대조로 이은 물리 결함 키 '시편/ID' */
  designDefectKey: string | null
  note: string
}

export type FinalRecord = IndicationRecord & { adjudication: AdjudicationProvenance }

/** 확정 기록에 검수 출처(buildFinalSet 이 붙인 모르는 칸 'adjudication')가 있나 — 검수 화면에서 만든 기록 */
export function hasAdjudication(r: IndicationRecord): r is FinalRecord {
  const a = (r as IndicationRecord & { adjudication?: { format?: unknown } }).adjudication
  return typeof a === 'object' && a !== null && a.format === 'paut-adjudication'
}

export type AdjudicationRowStatus = 'final' | 'rejected' | 'deferred' | 'undecided' | 'invalid'

export interface AdjudicationRowResult {
  rowId: string
  choice: AdjudicationChoice | null
  status: AdjudicationRowStatus
  /** 이 행에서 나온 확정 기록 UUID */
  recordUuids: string[]
  messages: string[]
}

export interface AdjudicationResult {
  reviewRulesVersion: number
  /** 만든 확정 라벨 세트 (파일마다 하나) */
  labelSets: LabelSetKey[]
  records: FinalRecord[]
  reviewIntervals: ReviewInterval[]
  /** 이전 확정 단위 가운데 이번에 나오지 않은 UUID (지움 표시 대상) */
  removed: { records: string[]; reviewIntervals: string[] }
  rows: AdjudicationRowResult[]
  undecided: string[]
  /** 모든 행에 올바른 결정이 있음 */
  complete: boolean
  /** design 을 줬을 때 확정 기록 대 설계값 */
  designCheck: DesignCheckResult | null
  warnings: string[]
}

// ───────────────────────────── 도움 함수 ─────────────────────────────

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function mostCommon(values: readonly string[], fallback: string): string {
  const n = new Map<string, number>()
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [v, c] of [...n].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    if (c > bestN) {
      best = v
      bestN = c
    }
  }
  return best ?? fallback
}

function defectKeyOf(specimenId: string, id: string): string {
  return `${normalizeId(specimenId)}/${id.trim()}`
}

function sideUnit(row: ReviewRow, side: 'a' | 'b'): ReviewUnit | null {
  return side === 'a' ? row.a : row.b
}

/** 이 결정이 이 행에 맞는지. 맞으면 null, 아니면 이유 */
function invalidReason(row: ReviewRow, d: AdjudicationDecision): string | null {
  if (d.choice === 'a' && !row.a) return 'A 쪽 지시가 없는 행에 A 채택을 골랐습니다'
  if (d.choice === 'b' && !row.b) return 'B 쪽 지시가 없는 행에 B 채택을 골랐습니다'
  if (d.choice === 'merge') {
    if (row.kind !== 'pair') return '합침은 짝 행에서만 고를 수 있습니다'
    for (const [k, v] of Object.entries(d.fields ?? {})) {
      if (!(MERGE_FIELDS as readonly string[]).includes(k)) return `모르는 칸 묶음입니다: ${k}`
      if (v !== 'a' && v !== 'b') return `칸 묶음 ${k} 의 값은 a 또는 b 여야 합니다`
    }
  }
  return null
}

/** 기록 메모에 Level III 메모를 붙인다 */
function withNote(base: string, note: string | undefined): string {
  const n = (note ?? '').trim()
  if (n === '') return base
  return base.trim() === '' ? `Level III: ${n}` : `${base} · Level III: ${n}`
}

// ───────────────────────────── 본체 ─────────────────────────────

/**
 * 확정 세트를 만든다. 원래 두 세트는 고치지 않는다(지침서 13절). 같은 입력 → 같은 결과.
 */
export function buildFinalSet(input: AdjudicationInput): AdjudicationResult {
  const cmp = input.comparison
  const adj = input.adjudicator
  if (adj.labelerId.trim() === '') throw new RangeError('Level III 라벨러 ID 가 비어 있습니다')
  const warnings: string[] = []
  const gv = input.guidelineVersion ?? mostCommon([...cmp.recordsA, ...cmp.recordsB].map((r) => r.guidelineVersion), 'v1')
  const deferAs = input.deferAs ?? 'uncertain'
  const now = input.now ?? null
  const prevRecords = new Map((input.previous?.records ?? []).map((r) => [r.uuid, r] as const))
  const prevIntervals = new Map((input.previous?.reviewIntervals ?? []).map((r) => [r.uuid, r] as const))
  const params = cmp.context.params
  const matchInfo = {
    rulesVersion: cmp.matchRulesVersion,
    scanGapMm: params.scanGapMm,
    depthDiffMm: params.depthDiffMm,
    frame: params.frame,
    unit: cmp.context.unit
  }

  const recordUuid = (sha256: string, sourceUuid: string): string =>
    adjudicationUuid([adj.labelerId, gv, 'final', sha256, 'record', sourceUuid])

  /** 원본 기록을 확정 기록 뼈대로 (판독 단계·라벨러·버전 칸을 확정 세트에 맞춤) */
  const skeleton = (src: IndicationRecord, uuid: string): IndicationRecord => {
    const c = clone(src) as IndicationRecord & { adjudication?: unknown }
    delete c.adjudication
    const prev = prevRecords.get(uuid)
    return {
      ...c,
      uuid,
      labelerId: adj.labelerId,
      guidelineVersion: gv,
      readingStage: 'final',
      revision: prev?.revision ?? 1,
      versions: prev ? clone(prev.versions) : [],
      deleted: false,
      pcId: input.pcId ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      readerSource: 'expert',
      readerDetail: { organization: adj.organization ?? null, qualification: adj.qualification ?? null, modelVersion: null },
      externalRef: null,
      suggestions: [],
      knowledge: { designValueSeen: true, specimenKnown: null, aiDevParticipant: null },
      groupingId: null
    }
  }

  const records: FinalRecord[] = []
  const explicitId = new Set<string>()
  const rowResults: AdjudicationRowResult[] = []
  const decisionOf = new Map<string, AdjudicationDecision>()
  const rowIds = new Set(cmp.rows.map((r) => r.id))
  for (const d of input.decisions) {
    if (!rowIds.has(d.rowId)) {
      warnings.push(`비교 결과에 없는 행의 결정은 무시했습니다: ${d.rowId}`)
      continue
    }
    if (decisionOf.has(d.rowId)) warnings.push(`같은 행(${d.rowId})에 결정이 둘 이상이라 마지막 것을 썼습니다.`)
    decisionOf.set(d.rowId, d)
  }

  const push = (rec: IndicationRecord, prov: AdjudicationProvenance, d: AdjudicationDecision | null): FinalRecord => {
    if (d && d.physicalDefectId !== undefined) {
      rec.physicalDefectId = d.physicalDefectId
      explicitId.add(rec.uuid)
    }
    const fr: FinalRecord = { ...rec, adjudication: prov }
    if (records.some((x) => x.uuid === fr.uuid)) {
      warnings.push(`같은 원본 기록에서 확정 기록이 두 번 나와 뒤의 것을 버렸습니다(${fr.uuid}).`)
      return fr
    }
    records.push(fr)
    return fr
  }

  for (const row of cmp.rows) {
    const d = decisionOf.get(row.id) ?? null
    if (!d) {
      rowResults.push({ rowId: row.id, choice: null, status: 'undecided', recordUuids: [], messages: [] })
      continue
    }
    const bad = invalidReason(row, d)
    if (bad) {
      rowResults.push({ rowId: row.id, choice: d.choice, status: 'invalid', recordUuids: [], messages: [bad] })
      warnings.push(`${row.id}: ${bad}`)
      continue
    }
    const sources = { a: row.a?.records.map((r) => r.uuid) ?? [], b: row.b?.records.map((r) => r.uuid) ?? [] }
    const prov = (decision: AdjudicationChoice, sourceRecord: string | null, fieldSources: Record<MergeField, 'a' | 'b'> | null): AdjudicationProvenance => ({
      format: 'paut-adjudication',
      reviewRulesVersion: REVIEW_RULES_VERSION,
      rowId: row.id,
      decision,
      fieldSources,
      sourceRecord,
      sources,
      labelers: { a: row.a?.labelerId ?? null, b: row.b?.labelerId ?? null },
      match: matchInfo,
      designDefectKey: null,
      note: (d.note ?? '').trim()
    })
    const messages: string[] = []
    const made: string[] = []

    if (d.choice === 'neither') {
      rowResults.push({ rowId: row.id, choice: d.choice, status: 'rejected', recordUuids: [], messages })
      continue
    }
    if (d.choice === 'a' || d.choice === 'b' || d.choice === 'defer') {
      const side: 'a' | 'b' = d.choice === 'defer' ? (row.a ? 'a' : 'b') : d.choice
      const unit = sideUnit(row, side)
      if (d.choice === 'defer' && deferAs === 'omit') {
        rowResults.push({ rowId: row.id, choice: d.choice, status: 'deferred', recordUuids: [], messages })
        continue
      }
      for (const src of unit?.records ?? []) {
        const rec = skeleton(src, recordUuid(src.sha256, src.uuid))
        if (d.choice === 'defer') rec.existenceConfidence = 'uncertain'
        rec.note = withNote(rec.note, d.note)
        made.push(push(rec, prov(d.choice, src.uuid, null), d).uuid)
      }
      rowResults.push({ rowId: row.id, choice: d.choice, status: d.choice === 'defer' ? 'deferred' : 'final', recordUuids: made, messages })
      continue
    }

    // 합침
    const pick = d.fields ?? {}
    const posSide: 'a' | 'b' = pick.position ?? 'a'
    const fields = {} as Record<MergeField, 'a' | 'b'>
    for (const f of MERGE_FIELDS) fields[f] = pick[f] ?? posSide
    const pos = sideUnit(row, posSide)
    const other = sideUnit(row, posSide === 'a' ? 'b' : 'a')
    if (!pos || !other) {
      rowResults.push({ rowId: row.id, choice: d.choice, status: 'invalid', recordUuids: [], messages: ['합침에 두 쪽 단위가 필요합니다'] })
      continue
    }
    const singles = pos.records.length === 1 && other.records.length === 1
    if (!singles) {
      for (const f of MERGE_FIELDS) {
        if (fields[f] !== posSide && !UNIT_LEVEL_FIELDS.has(f)) {
          messages.push(`묶음(그룹)이 낀 행이라 '${MERGE_FIELD_LABEL[f]}'는 칸별로 합칠 수 없어 위치 쪽 값을 썼습니다.`)
          fields[f] = posSide
        }
      }
    }
    const otherRec = other.records[0] ?? null
    for (const src of pos.records) {
      const rec = skeleton(src, recordUuid(src.sha256, src.uuid))
      const from = (f: MergeField): IndicationRecord | null => (fields[f] === posSide ? null : otherRec)
      const typeSrc = from('type')
      if (typeSrc) {
        if (!singles && other.item.defectType === null) {
          messages.push('다른 쪽 묶음의 종류가 하나로 모이지 않아 위치 쪽 종류를 썼습니다.')
          fields.type = posSide
        } else {
          const t = singles ? typeSrc : (other.records.find((r) => r.defectType === other.item.defectType) ?? typeSrc)
          rec.defectType = t.defectType
          rec.isoCode = t.isoCode
          rec.typeConfidence = t.typeConfidence
          rec.character = clone(t.character)
          rec.surface = t.surface
          rec.pointLike = t.pointLike
          rec.location = { ...rec.location, zone: t.location.zone }
        }
      }
      if (from('existence')) {
        const e: Confidence | null = singles ? (otherRec?.existenceConfidence ?? null) : other.existenceConfidence
        if (e !== null) rec.existenceConfidence = e
      }
      const lenSrc = from('length')
      if (lenSrc) rec.length = clone(lenSrc.length)
      const sigSrc = from('signal')
      if (sigSrc) rec.signal = clone(sigSrc.signal)
      const hSrc = from('height')
      if (hSrc) {
        rec.height = clone(hSrc.height)
        if (rec.height.pointIds.length > 0) {
          if (rec.coordSource === 'app-anchor') {
            const taken = new Set(rec.anchors.map((p) => p.id))
            const ids: string[] = []
            for (const pid of rec.height.pointIds) {
              const p = hSrc.anchors.find((x) => x.id === pid)
              if (!p) continue
              let id = `${fields.height}-${pid}`
              for (let k = 2; taken.has(id); k++) id = `${fields.height}-${pid}-${k}`
              taken.add(id)
              const copy: AnchorPoint = { ...clone(p), id }
              rec.anchors = [...rec.anchors, copy]
              ids.push(id)
            }
            rec.height.pointIds = ids
          } else {
            rec.height.pointIds = []
            messages.push('위치 쪽 기록에 앵커가 없어(엑셀 기록) 다른 쪽 높이 점 목록을 비웠습니다.')
          }
        }
      }
      const noteSrc = from('note')
      if (noteSrc) rec.note = singles ? noteSrc.note : other.records.map((r) => r.note).filter((n) => n.trim() !== '').join(' · ')
      rec.note = withNote(rec.note, d.note)
      made.push(push(rec, prov('merge', src.uuid, { ...fields }), d).uuid)
    }
    for (const msg of messages) warnings.push(`${row.id}: ${msg}`)
    rowResults.push({ rowId: row.id, choice: d.choice, status: 'final', recordUuids: made, messages })
  }

  // 비교에서 빠진 기록 (비결함 등)
  const excludedNote = (side: 'a' | 'b'): void => {
    const ex = side === 'a' ? cmp.match.excludedA : cmp.match.excludedB
    const recs = side === 'a' ? cmp.recordsA : cmp.recordsB
    const lost = ex.filter((e) => e.reason !== 'deleted' && e.reason !== 'kind').length
    if (lost > 0) warnings.push(`${side.toUpperCase()} 의 결함 기록 ${lost}건은 비교에서 빠져(정렬 없음·좌표 오류·인자로 뺌) 확정 세트에 들어가지 않았습니다.`)
    const kindIds = new Set(ex.filter((e) => e.reason === 'kind').map((e) => e.uuid))
    if (kindIds.size === 0) return
    if (input.carryNonDefect === side) {
      for (const src of recs) {
        if (!kindIds.has(src.uuid) || src.deleted) continue
        const rec = skeleton(src, recordUuid(src.sha256, src.uuid))
        const p: AdjudicationProvenance = {
          format: 'paut-adjudication',
          reviewRulesVersion: REVIEW_RULES_VERSION,
          rowId: null,
          decision: 'carry',
          fieldSources: null,
          sourceRecord: src.uuid,
          sources: side === 'a' ? { a: [src.uuid], b: [] } : { a: [], b: [src.uuid] },
          labelers: side === 'a' ? { a: src.labelerId, b: null } : { a: null, b: src.labelerId },
          match: matchInfo,
          designDefectKey: null,
          note: ''
        }
        push(rec, p, null)
      }
    } else if (input.carryNonDefect === undefined || input.carryNonDefect === 'none') {
      if (side === 'a') warnings.push(`비결함 기록(형상 에코 등) A ${kindIds.size}건은 확정 세트에 넣지 않았습니다(carryNonDefect 로 한쪽을 베낄 수 있음).`)
    }
  }
  excludedNote('a')
  excludedNote('b')

  // 설계값으로 더한 기록
  const alignBySha = new Map<string, FileAlignment>()
  for (const al of cmp.alignments) {
    if (al.deleted) continue
    const prev = alignBySha.get(al.sha256)
    if (!prev || al.revision > prev.revision) alignBySha.set(al.sha256, al)
  }
  const defects = input.design?.defects ?? []
  for (const add of input.designAdditions ?? []) {
    const key = defectKeyOf(add.specimenId, add.defectId)
    const defect = defects.find((x) => !x.deleted && defectKeyOf(x.specimenId, x.id) === key)
    const al = alignBySha.get(add.sha256)
    if (!defect) {
      warnings.push(`설계값으로 더하려는 물리 결함이 없습니다: ${key}`)
      continue
    }
    if (!al || al.specimenId === null || normalizeId(al.specimenId) !== normalizeId(defect.specimenId) || al.datumUMm === null || al.direction === null) {
      warnings.push(`설계 결함 ${key} 를 파일 U 로 되돌릴 파일 정렬(같은 시편·기준점·방향)이 없어 더하지 못했습니다.`)
      continue
    }
    const item = physicalDefectItems([defect], { minTier: 'any', depthIs: input.design?.depthIs ?? 'unknown', includeDeleted: false }).items[0]
    if (!item) {
      warnings.push(`설계 결함 ${key} 에 위치가 없어 더하지 못했습니다.`)
      continue
    }
    const u0 = al.datumUMm + al.direction * item.scanStartMm
    const u1 = al.datumUMm + al.direction * item.scanEndMm
    const uuid = adjudicationUuid([adj.labelerId, gv, 'final', add.sha256, 'design', key])
    const prev = prevRecords.get(uuid)
    const rec = newIndicationRecord({
      uuid,
      sha256: add.sha256,
      labelerId: adj.labelerId,
      guidelineVersion: gv,
      readingStage: 'final',
      revision: prev?.revision ?? 1,
      versions: prev ? clone(prev.versions) : [],
      pcId: input.pcId ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      readerDetail: { organization: adj.organization ?? null, qualification: adj.qualification ?? null },
      kind: 'defect',
      coordSource: 'imported-mm',
      derived: {
        scanStartMm: Math.min(u0, u1),
        scanEndMm: Math.max(u0, u1),
        depthTopMm: item.depthTopMm,
        depthBottomMm: item.depthBottomMm
      },
      existenceConfidence: 'certain',
      defectType: defect.design.type,
      location: { zone: defect.design.zone, side: defect.design.side },
      knowledge: { designValueSeen: true },
      physicalDefectId: defect.id,
      note: withNote('설계값에서 만든 기록 — 길이·높이는 신호에서 다시 잴 것', add.note)
    })
    const p: AdjudicationProvenance = {
      format: 'paut-adjudication',
      reviewRulesVersion: REVIEW_RULES_VERSION,
      rowId: null,
      decision: 'design-add',
      fieldSources: null,
      sourceRecord: null,
      sources: { a: [], b: [] },
      labelers: { a: null, b: null },
      match: matchInfo,
      designDefectKey: key,
      note: (add.note ?? '').trim()
    }
    explicitId.add(uuid)
    push(rec, p, null)
  }

  // 검토 구간
  const reviewIntervals = finalReviewIntervals(cmp.intervalsA, cmp.intervalsB, {
    mode: input.reviews ?? 'intersection',
    adjudicator: adj,
    guidelineVersion: gv,
    pcId: input.pcId ?? null,
    now,
    previous: prevIntervals
  })
  if ((input.reviews ?? 'intersection') === 'intersection') {
    const covered = new Set(reviewIntervals.filter((v) => v.kind === 'reviewed').map((v) => v.sha256))
    const bare = [...new Set(records.map((r) => r.sha256))].filter((sha) => !covered.has(sha))
    if (bare.length > 0) {
      warnings.push(
        `확정 기록이 있는 파일 ${bare.length}개에 두 사람 검토 완료의 교집합이 없습니다. 두 사람이 다른 파일을 봤으면(용접부 틀) reviews 를 'a' 또는 'b' 로 고르십시오.`
      )
    }
  }

  // 설계값 대조 (+ 빈 물리 결함 ID 채우기)
  let designCheck: DesignCheckResult | null = null
  if (input.design) {
    const dctx = {
      alignments: cmp.alignments,
      params: { scanGapMm: params.scanGapMm, depthDiffMm: params.depthDiffMm, unknownSide: params.unknownSide, unknownDepth: params.unknownDepth },
      minTier: input.design.minTier,
      depthIs: input.design.depthIs,
      intervals: reviewIntervals,
      unit: cmp.context.unit,
      grouping: cmp.context.grouping ?? undefined,
      groupingParams: cmp.context.groupingParams ?? undefined,
      thicknessFor: (s: string) => cmp.context.thicknessBySha[s] ?? null,
      fileNames: cmp.context.fileNames
    }
    designCheck = checkAgainstDesign(records, input.design.defects, dctx)
    if (input.design.link !== false) {
      const byUuid = new Map(records.map((r) => [r.uuid, r] as const))
      let linked = 0
      for (const row of designCheck.rows) {
        if (row.status !== 'matched' || !row.defect || !row.unit) continue
        for (const r of row.unit.records) {
          const fr = byUuid.get(r.uuid)
          if (!fr || explicitId.has(fr.uuid)) continue
          if (fr.physicalDefectId === null) {
            fr.physicalDefectId = row.defect.id
            linked++
          }
          if (fr.physicalDefectId === row.defect.id) fr.adjudication.designDefectKey = row.defectKey
        }
      }
      if (linked > 0) designCheck = checkAgainstDesign(records, input.design.defects, dctx)
    }
    for (const fr of records) {
      if (fr.adjudication.designDefectKey === null && fr.physicalDefectId !== null) {
        const sp = alignBySha.get(fr.sha256)?.specimenId ?? null
        if (sp !== null) fr.adjudication.designDefectKey = defectKeyOf(sp, fr.physicalDefectId)
      }
    }
  } else if ((input.designAdditions ?? []).length > 0) {
    warnings.push('설계값(design)을 주지 않아 설계값으로 더하기를 할 수 없습니다.')
  }

  // 정리
  records.sort((x, y) => (x.sha256 < y.sha256 ? -1 : x.sha256 > y.sha256 ? 1 : 0) || x.derived.scanStartMm - y.derived.scanStartMm || (x.uuid < y.uuid ? -1 : 1))
  const outRecordIds = new Set(records.map((r) => r.uuid))
  const outReviewIds = new Set(reviewIntervals.map((r) => r.uuid))
  const removed = {
    records: [...prevRecords.values()].filter((r) => !r.deleted && !outRecordIds.has(r.uuid)).map((r) => r.uuid).sort(),
    reviewIntervals: [...prevIntervals.values()].filter((r) => !r.deleted && !outReviewIds.has(r.uuid)).map((r) => r.uuid).sort()
  }
  const sets = new Map<string, LabelSetKey>()
  for (const x of [...records, ...reviewIntervals]) {
    const k: LabelSetKey = { sha256: x.sha256, labelerId: adj.labelerId, guidelineVersion: gv, readingStage: 'final' }
    sets.set(x.sha256, k)
  }
  const undecided = rowResults.filter((r) => r.status === 'undecided').map((r) => r.rowId)
  const invalid = rowResults.filter((r) => r.status === 'invalid').length
  if (undecided.length > 0) warnings.push(`결정하지 않은 행이 ${undecided.length}개 있습니다: ${undecided.slice(0, 10).join(', ')}${undecided.length > 10 ? ' …' : ''}`)
  return {
    reviewRulesVersion: REVIEW_RULES_VERSION,
    labelSets: [...sets.values()].sort((x, y) => (x.sha256 < y.sha256 ? -1 : 1)),
    records,
    reviewIntervals,
    removed,
    rows: rowResults,
    undecided,
    complete: undecided.length === 0 && invalid === 0,
    designCheck,
    warnings
  }
}

// ───────────────────────────── 확정 검토 구간 ─────────────────────────────

export interface FinalReviewOptions {
  mode: 'intersection' | 'a' | 'b' | 'none'
  adjudicator: Adjudicator
  guidelineVersion: string
  pcId?: string | null
  now?: string | null
  previous?: ReadonlyMap<string, ReviewInterval>
}

function live(xs: readonly ReviewInterval[]): ReviewInterval[] {
  return xs.filter((x) => !x.deleted && !x.released)
}

/** 두 게이트 범위의 교집합 (비면 한쪽, 둘 다 없으면 null) */
function gateIntersection(a: ReviewGateRange | null, b: ReviewGateRange | null): ReviewGateRange | null {
  if (a && b) {
    const g: ReviewGateRange = {
      depthTopMm: Math.max(a.depthTopMm, b.depthTopMm),
      depthBottomMm: Math.min(a.depthBottomMm, b.depthBottomMm),
      legMin: Math.max(a.legMin, b.legMin),
      legMax: Math.min(a.legMax, b.legMax)
    }
    if (g.depthTopMm <= g.depthBottomMm && g.legMin <= g.legMax) return g
    return a
  }
  return a ?? b ?? null
}

function overlaps(x: ReviewInterval, s: Span): boolean {
  return Math.min(x.scanStartMm, x.scanEndMm) < s.endMm && Math.max(x.scanStartMm, x.scanEndMm) > s.startMm
}

/**
 * 확정 세트의 검토 구간.
 * 'intersection': 검토 완료 = 같은 파일·그룹에서 두 사람 검토 완료의 교집합(그룹 칸이 빈 '모든 그룹' 구간은 모든 그룹에 들어감),
 *   품질 불량·기준 미만 = 두 쪽 합집합(같은 파일·종류·그룹·범위·사유는 하나). 'a'·'b' = 그 쪽을 베낌. 'none' = 없음.
 * 지운 것·자동으로 풀린 것은 쓰지 않는다. UUID 는 (Level III, 지침서, sha256, 종류·그룹·범위 또는 원본 UUID)에서 만든다.
 */
export function finalReviewIntervals(
  intervalsA: readonly ReviewInterval[],
  intervalsB: readonly ReviewInterval[],
  opts: FinalReviewOptions
): ReviewInterval[] {
  if (opts.mode === 'none') return []
  const adj = opts.adjudicator
  const gv = opts.guidelineVersion
  const now = opts.now ?? null
  const make = (src: Omit<ReviewInterval, 'uuid' | 'labelerId' | 'guidelineVersion' | 'readingStage' | 'revision' | 'versions' | 'deleted' | 'released' | 'pcId' | 'createdAt' | 'updatedAt'>, uuid: string): ReviewInterval => {
    const prev = opts.previous?.get(uuid)
    return {
      uuid,
      sha256: src.sha256,
      labelerId: adj.labelerId,
      guidelineVersion: gv,
      readingStage: 'final',
      revision: prev?.revision ?? 1,
      versions: prev ? clone(prev.versions) : [],
      deleted: false,
      released: false,
      pcId: opts.pcId ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      kind: src.kind,
      groupId: src.groupId,
      scanStartMm: src.scanStartMm,
      scanEndMm: src.scanEndMm,
      gate: src.gate ? clone(src.gate) : null,
      reason: src.reason,
      note: src.note
    }
  }
  const copyOf = (x: ReviewInterval): ReviewInterval =>
    make(x, adjudicationUuid([adj.labelerId, gv, 'final', x.sha256, 'review', x.uuid]))
  if (opts.mode === 'a') return live(intervalsA).map(copyOf).sort(byPlace)
  if (opts.mode === 'b') return live(intervalsB).map(copyOf).sort(byPlace)

  const out: ReviewInterval[] = []
  const A = live(intervalsA)
  const B = live(intervalsB)
  const shas = [...new Set([...A, ...B].map((x) => x.sha256))].sort()
  for (const sha of shas) {
    const ra = A.filter((x) => x.sha256 === sha && x.kind === 'reviewed')
    const rb = B.filter((x) => x.sha256 === sha && x.kind === 'reviewed')
    if (ra.length === 0 || rb.length === 0) continue
    const explicit = [...new Set([...ra, ...rb].map((x) => x.groupId).filter((g): g is number => g !== null))].sort((x, y) => x - y)
    const keys: (number | null)[] = explicit.length > 0 ? explicit : [null]
    for (const g of keys) {
      const inGroup = (x: ReviewInterval): boolean => (g === null ? x.groupId === null : x.groupId === g || x.groupId === null)
      const sa = ra.filter(inGroup)
      const sb = rb.filter(inGroup)
      const toSpan = (x: ReviewInterval): Span => ({ frameKey: sha, startMm: Math.min(x.scanStartMm, x.scanEndMm), endMm: Math.max(x.scanStartMm, x.scanEndMm) })
      for (const s of intersectCoverage(sa.map(toSpan), sb.map(toSpan))) {
        const ga = sa.find((x) => x.gate !== null && overlaps(x, s))?.gate ?? null
        const gb = sb.find((x) => x.gate !== null && overlaps(x, s))?.gate ?? null
        const uuid = adjudicationUuid([adj.labelerId, gv, 'final', sha, 'review', 'reviewed', g, s.startMm, s.endMm])
        out.push(
          make(
            {
              sha256: sha,
              kind: 'reviewed',
              groupId: g,
              scanStartMm: s.startMm,
              scanEndMm: s.endMm,
              gate: gateIntersection(ga, gb),
              reason: null,
              note: '두 사람 검토 완료의 교집합'
            },
            uuid
          )
        )
      }
    }
  }
  // 품질 불량·기준 미만: 합집합 (같은 칸 값이면 하나)
  const seen = new Set<string>()
  for (const x of [...A, ...B]) {
    if (x.kind === 'reviewed') continue
    const k = [x.sha256, x.kind, x.groupId ?? '', Math.min(x.scanStartMm, x.scanEndMm), Math.max(x.scanStartMm, x.scanEndMm), x.reason ?? ''].join('|')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(copyOf(x))
  }
  return out.sort(byPlace)
}

function byPlace(x: ReviewInterval, y: ReviewInterval): number {
  const kindOrder = { reviewed: 0, 'quality-bad': 1, 'below-threshold': 2 } as const
  return (
    (x.sha256 < y.sha256 ? -1 : x.sha256 > y.sha256 ? 1 : 0) ||
    kindOrder[x.kind] - kindOrder[y.kind] ||
    (x.groupId ?? -1) - (y.groupId ?? -1) ||
    x.scanStartMm - y.scanStartMm ||
    x.scanEndMm - y.scanEndMm ||
    (x.uuid < y.uuid ? -1 : x.uuid > y.uuid ? 1 : 0)
  )
}

/** 확정 검토 구간의 검토 범위 길이 합 (mm, 파일마다 그룹을 합쳐 한 번) */
export function reviewedLengthMm(intervals: readonly ReviewInterval[]): number {
  const spans = live(intervals)
    .filter((x) => x.kind === 'reviewed')
    .map((x) => ({ frameKey: x.sha256, startMm: Math.min(x.scanStartMm, x.scanEndMm), endMm: Math.max(x.scanStartMm, x.scanEndMm) }))
  return mergeSpans(spans).reduce((s, x) => s + (x.endMm - x.startMm), 0)
}
