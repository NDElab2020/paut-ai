/** 라벨 관리 화면 표시용 글자 (코드 → 한국어, 기록 요약, 충돌 칸 비교). 순수 함수. */
import { LABEL_ENTITY_LABEL, type LabelConflictChoice, type LabelEntityKind, type LabelPlanCounts, type TrainSplitOrNone } from '@shared/api'
import {
  CONFIDENCE,
  GEOMETRIC_ECHO_KIND,
  GEOMETRIC_IMPERFECTION_KIND,
  METALLURGICAL_TYPE,
  READER_SOURCE,
  RECORD_KIND,
  REVIEW_KIND
} from '@shared/labels/codes'
import type { IndicationRecord, ReadingStage, ReviewInterval } from '@shared/labels/types'
import { DASH, num } from '../../lib/format'

export { CONFIDENCE, READER_SOURCE, RECORD_KIND, REVIEW_KIND }

/** 판독 단계 짧은 이름 (표 안) */
export const STAGE_SHORT: Record<ReadingStage, string> = {
  blind: '블라인드',
  reconciled: '설계값 대조',
  final: '확정'
}

export const ENTITY_LABEL: Record<LabelEntityKind, string> = LABEL_ENTITY_LABEL

export const CHOICE_LABEL: Record<LabelConflictChoice, string> = {
  mine: '내 것 남기기',
  theirs: '들어온 것으로',
  both: '둘 다 남기기'
}

export const CHOICE_HINT: Record<LabelConflictChoice, string> = {
  mine: '이 PC 의 값을 남깁니다. 들어온 값은 버립니다.',
  theirs: '들어온 값으로 바꿉니다.',
  both: '이 PC 의 값을 남기고, 들어온 값은 새 기록으로 따로 둡니다.'
}

/** 확정하면 일어날 일 (미리보기 숫자 줄) */
export const PLAN_LABEL: Record<keyof LabelPlanCounts, string> = {
  create: '새로',
  update: '고침',
  unchanged: '그대로',
  kept: '이 PC 값 남김',
  conflict: '충돌',
  remove: '지움 표시'
}

export const PLAN_ORDER: readonly (keyof LabelPlanCounts)[] = ['create', 'update', 'remove', 'conflict', 'kept', 'unchanged']

/** '30.0–46.0' (mm 단위는 머리에) */
export function mmRange(a: number | null | undefined, b: number | null | undefined): string {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return DASH
  return `${num(a)}–${num(b)}`
}

/** 기록 세부: 결함 종류 · 형상 에코 세부 · 형상 불완전 세부 */
export function recordDetail(r: IndicationRecord): string {
  if (r.kind === 'defect') return r.defectType ? METALLURGICAL_TYPE[r.defectType] : '종류 미정'
  if (r.kind === 'geometric-echo') return r.geometricEcho ? GEOMETRIC_ECHO_KIND[r.geometricEcho.kind] : DASH
  return r.geometricImperfection ? GEOMETRIC_IMPERFECTION_KIND[r.geometricImperfection.kind] : DASH
}

/** 기록 한 줄 요약 (충돌 목록) */
export function recordSummary(r: IndicationRecord): string {
  const ref = r.externalRef ? `지시 ${r.externalRef} · ` : ''
  return `${ref}${RECORD_KIND[r.kind]} · ${recordDetail(r)} · 스캔 ${mmRange(r.derived.scanStartMm, r.derived.scanEndMm)} mm`
}

export function reviewSummary(v: ReviewInterval): string {
  return `${REVIEW_KIND[v.kind]} · 스캔 ${mmRange(v.scanStartMm, v.scanEndMm)} mm${v.groupId === null ? ' · 모든 그룹' : ` · 그룹 ${v.groupId}`}`
}

/** 자주 보는 칸의 한국어 이름 (충돌 비교) */
const FIELD_LABEL: Record<string, string> = {
  kind: '기록 구분',
  defectType: '결함 종류',
  existenceConfidence: '존재 확신도',
  typeConfidence: '종류 확신도',
  'derived.scanStartMm': '스캔 시작 (mm)',
  'derived.scanEndMm': '스캔 끝 (mm)',
  'derived.vMinMm': 'V 최소 (mm)',
  'derived.vMaxMm': 'V 최대 (mm)',
  'derived.depthTopMm': '깊이 위 (mm)',
  'derived.depthBottomMm': '깊이 아래 (mm)',
  'length.valueMm': '길이 (mm)',
  'length.method': '길이 측정법',
  'height.valueMm': '높이 (mm)',
  'height.method': '높이 입력 방식',
  'signal.maxAmplitudePct': '최대 진폭 (%FSH)',
  'signal.saturated': '포화',
  'location.zone': '위치 구분',
  'location.side': '좌우',
  'character.value': '판정 특성',
  surface: '표면',
  pointLike: '점 같은 지시',
  note: '메모',
  deleted: '지움 표시',
  scanStartMm: '스캔 시작 (mm)',
  scanEndMm: '스캔 끝 (mm)',
  groupId: '그룹',
  reason: '품질 불량 사유',
  status: '관측 상태',
  datumUMm: '기준점 U (mm)',
  direction: '스캔 방향',
  thicknessMm: '두께 (mm)',
  alignmentAssumed: '가설 정렬',
  specimenId: '시편 ID',
  enteredBy: '적은 사람',
  at: '시각',
  detail: '세부'
}

const SKIP = new Set(['versions', 'revision', 'pcId', 'updatedAt', 'createdAt'])

function flatten(v: unknown, prefix: string, out: Map<string, string>): void {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!prefix && SKIP.has(k)) continue
      flatten(x, prefix ? `${prefix}.${k}` : k, out)
    }
    return
  }
  out.set(prefix, v === undefined ? '' : JSON.stringify(v))
}

export interface FieldDiff {
  path: string
  label: string
  mine: string
  theirs: string
}

/** 두 값에서 다른 칸 (기록용 칸 제외). 값은 짧은 글자 */
export function fieldDiffs(mine: unknown, theirs: unknown): FieldDiff[] {
  const a = new Map<string, string>()
  const b = new Map<string, string>()
  flatten(mine ?? {}, '', a)
  flatten(theirs ?? {}, '', b)
  const show = (s: string | undefined): string => {
    if (s === undefined || s === '' || s === 'null') return DASH
    const t = s.startsWith('"') ? (JSON.parse(s) as string) : s
    return t.length > 60 ? `${t.slice(0, 57)}…` : t
  }
  const out: FieldDiff[] = []
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (a.get(path) === b.get(path)) continue
    out.push({ path, label: FIELD_LABEL[path] ?? path, mine: show(a.get(path)), theirs: show(b.get(path)) })
  }
  return out
}

/** 충돌 항목 한 줄 설명 */
export function entitySummary(entity: LabelEntityKind, v: unknown): string {
  if (!v || typeof v !== 'object') return DASH
  if (entity === 'record') return recordSummary(v as IndicationRecord)
  if (entity === 'review-interval') return reviewSummary(v as ReviewInterval)
  const o = v as Record<string, unknown>
  if (entity === 'file-alignment') return `파일 정렬 · ${String(o.fileName ?? '')}`
  if (entity === 'physical-defect') return `물리 결함 ${String(o.specimenId ?? '')} ${String(o.id ?? '')}`
  if (entity === 'observation') return `관측 표 · 그룹 ${String(o.groupId)} · 레그 ${String(o.leg)}`
  return `작업 이벤트 · ${String(o.kind ?? '')} · ${String(o.at ?? '').slice(0, 16).replace('T', ' ')}`
}

/** 'kim-l2 (UT Level II)' */
export function labelerText(id: string, name: string | null, qualification?: string | null): string {
  const shown = name && name !== id ? `${name} (${id})` : id
  return qualification ? `${shown} · ${qualification}` : shown
}

export { DASH, num }

// ── 학습 데이터 (분할 · 내보내기) ──

/** 분할 이름 (표·고르기 상자) */
export const SPLIT_LABEL: Record<TrainSplitOrNone, string> = {
  train: 'train (학습)',
  val: 'val (검증)',
  test: 'test (시험)',
  unassigned: '정하지 않음'
}

export const SPLIT_ORDER: readonly TrainSplitOrNone[] = ['train', 'val', 'test', 'unassigned']

/** 'setId' → '박 조정 · 확정 · v1' 처럼 짧게 (setId = 'sha256|라벨러|지침서|단계') */
export function setIdText(setId: string | null): string {
  if (!setId) return DASH
  const [, labelerId, guideline, stage] = setId.split('|')
  return `${labelerId ?? '?'} · ${STAGE_SHORT[(stage ?? 'blind') as ReadingStage] ?? stage} · ${guideline ?? ''}`
}
