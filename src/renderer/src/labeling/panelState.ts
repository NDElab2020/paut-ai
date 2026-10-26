/**
 * 라벨 패널 상태 — 순수 리듀서 (React·DOM 없음, tests/labeling 에서 직접 검사).
 * 뷰어 쪽 라벨 상태(state.ts: 모드·도구·초안 점·R·검토 구간 초안, 되돌리기)와 따로, 패널이 들고 있는 것:
 *   세트 고르기 · 기록 속성 양식 · 고치는 기록(고치기 시작할 때의 버전 그대로 — editingBase) · 보여 준 길이 제안(같은 단면이면 고정) ·
 *   첫 점을 찍을 때의 화면 스냅샷 · 지시 표에서 고른 기록 · 검토 구간 종류·사유 · 거절한 형상 에코 후보 · 에코 고침 · 장면 미리보기 켜기 ·
 *   이 상태를 만든 라벨러(owner — 라벨러가 바뀌면 초안·고치기·제안을 버린다, 2인 독립 모드에서 남의 초안을 보지 않게).
 * 뒤로 갔다 다시 열거나 라벨 모드를 껐다 켜도 남게 세션에 보관한다(session.ts panelSessionGet/Set).
 */
import type { GeometricEchoKind, IndicationRecord, LengthSuggestion, QualityBadReason, ReadingStage, ReviewIntervalKind } from '@shared/labels'
import type { LabelSetChoice } from './labelSet'
import { defaultForm, nextForm, type RecordForm } from './record'

/**
 * 보여 준 길이 제안: 전문가가 '이 길이로'를 처음 누른 때 한 번 계산해 고정한다. 같은 단면(sectionKey)이면 다시 눌러도
 * 다시 계산하지 않고 그때 전문가 길이(expertStartMm·expertEndMm = 제안을 보기 전 처음 잰 값)도 덮지 않는다.
 * 단면 점을 바꾸면 그다음 '이 길이로'에서 새로 계산한다.
 */
export interface ShownSuggestion {
  suggestion: LengthSuggestion | null
  /** 낼 수 없는 이유 (그룹 막힘 등) */
  reason: string | null
  /** 제안을 보기 전 전문가가 처음 잰 길이 (mm) */
  expertStartMm: number
  expertEndMm: number
  /** 계산한 때의 단면(점·사각형) 지문 */
  sectionKey: string
}

export interface ReviewForm {
  kind: ReviewIntervalKind
  reason: QualityBadReason | null
  note: string
}

export interface EchoEdit {
  id: string
  startMm: number
  endMm: number
  kind: GeometricEchoKind
}

export interface PanelState {
  /** null = 아직 고르지 않음 (지금 라벨러의 마지막 세트 또는 v1 · 블라인드) */
  setChoice: LabelSetChoice | null
  setOpen: boolean
  form: RecordForm
  /** 고치는 기록 UUID (null = 새 기록) */
  editingUuid: string | null
  /** 고치기 시작할 때의 기록 — 그 버전으로 저장한다(그사이 다른 곳에서 바뀌면 CONFLICT). 다시 읽은 새 버전으로 바꾸지 않는다 */
  editingBase: IndicationRecord | null
  /** 고치기 시작할 때 초안 위치(점·사각형)의 지문 — 같으면 기록의 화면 스냅샷을 그대로 둔다 */
  editDraftKey: string | null
  /** 저장이 CONFLICT 였음 — '다시 열기' 전까지 저장하지 않는다 */
  conflict: boolean
  /** 새 기록: 첫 점(또는 사각형)을 찍을 때의 화면 스냅샷 (저장한 때가 아니라 찍은 때의 화면) */
  snapshot: unknown
  shown: ShownSuggestion | null
  /** 지시 표에서 고른 기록 */
  selectedUuid: string | null
  review: ReviewForm
  rejectedEchoes: string[]
  echoEdit: EchoEdit | null
  /** 장면 세 상태 미리보기 덮개 */
  preview: boolean
  /** 형상 에코 후보 띠 덮개 (후보 목록을 펼쳤을 때) */
  showEchoes: boolean
  /** 이 상태·초안을 만든 라벨러 (null = 아직 모름 — 라벨러를 처음 고르면 그 사람 것으로) */
  owner: string | null
}

export type PanelAction =
  | { type: 'setChoice'; choice: LabelSetChoice | null }
  | { type: 'setOpen'; open: boolean }
  | { type: 'patchForm'; patch: Partial<RecordForm> }
  /** 새 기록 시작 (고치기 그만두기 포함) — 양식 기본값 (습관 칸은 남김) */
  | { type: 'newRecord'; stage: ReadingStage }
  | { type: 'startEdit'; base: IndicationRecord; form: RecordForm; draftKey: string }
  /** 고치던 기록과 떼어 새 기록으로 (양식·초안은 그대로) */
  | { type: 'detachEdit' }
  | { type: 'setConflict'; on: boolean }
  | { type: 'setSnapshot'; snapshot: unknown }
  /** 라벨러가 바뀜: 고치기·제안·고른 기록·에코 고침·스냅샷·세트 고르기를 버리고 owner 를 바꾼다 (양식은 새 기록 기본값) */
  | { type: 'resetForLabeler'; owner: string | null; stage: ReadingStage }
  | { type: 'setOwner'; owner: string | null }
  /** 저장 뒤: 고른 기록 = 저장한 것, 양식은 다음 기록으로 */
  | { type: 'saved'; uuid: string; stage: ReadingStage }
  | { type: 'setShown'; shown: ShownSuggestion | null }
  | { type: 'select'; uuid: string | null }
  | { type: 'patchReview'; patch: Partial<ReviewForm> }
  | { type: 'rejectEcho'; id: string }
  | { type: 'setEchoEdit'; edit: EchoEdit | null }
  | { type: 'setPreview'; on: boolean }
  | { type: 'setShowEchoes'; on: boolean }
  /** 지운 기록을 고르거나 고치는 중이면 놓는다 */
  | { type: 'forget'; uuid: string }

export function initialPanelState(stage: ReadingStage = 'blind'): PanelState {
  return {
    setChoice: null,
    setOpen: false,
    form: defaultForm(stage),
    editingUuid: null,
    editingBase: null,
    editDraftKey: null,
    conflict: false,
    snapshot: null,
    shown: null,
    selectedUuid: null,
    review: { kind: 'reviewed', reason: null, note: '' },
    rejectedEchoes: [],
    echoEdit: null,
    preview: false,
    showEchoes: false,
    owner: null
  }
}

const NO_EDIT = { editingUuid: null, editingBase: null, editDraftKey: null, conflict: false } as const

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function panelReducer(s: PanelState, a: PanelAction): PanelState {
  switch (a.type) {
    case 'setChoice':
      // 세트를 바꾸면 고치던 기록·고른 기록·보여 준 제안은 그 세트 것이 아니다
      return same(a.choice, s.setChoice) ? s : { ...s, setChoice: a.choice, ...NO_EDIT, selectedUuid: null, shown: null, echoEdit: null, snapshot: null }
    case 'setOpen':
      return s.setOpen === a.open ? s : { ...s, setOpen: a.open }
    case 'patchForm': {
      const form = { ...s.form, ...a.patch }
      return same(form, s.form) ? s : { ...s, form }
    }
    case 'newRecord':
      return { ...s, form: nextForm(s.form, a.stage), ...NO_EDIT, shown: null, snapshot: null }
    case 'startEdit':
      return { ...s, form: a.form, editingUuid: a.base.uuid, editingBase: a.base, editDraftKey: a.draftKey, conflict: false, selectedUuid: a.base.uuid, shown: null, snapshot: null }
    case 'detachEdit':
      return s.editingUuid === null ? s : { ...s, ...NO_EDIT }
    case 'setConflict':
      return s.conflict === a.on ? s : { ...s, conflict: a.on }
    case 'setSnapshot':
      return same(a.snapshot, s.snapshot) ? s : { ...s, snapshot: a.snapshot }
    case 'resetForLabeler':
      return { ...initialPanelState(a.stage), preview: s.preview, owner: a.owner }
    case 'setOwner':
      return s.owner === a.owner ? s : { ...s, owner: a.owner }
    case 'saved':
      return { ...s, form: nextForm(s.form, a.stage), ...NO_EDIT, selectedUuid: a.uuid, shown: null, snapshot: null }
    case 'setShown':
      return same(a.shown, s.shown) ? s : { ...s, shown: a.shown }
    case 'select':
      return s.selectedUuid === a.uuid ? s : { ...s, selectedUuid: a.uuid }
    case 'patchReview': {
      const review = { ...s.review, ...a.patch }
      // 품질 불량이 아니면 사유를 지운다 (검사: 사유는 품질 불량에만)
      if (review.kind !== 'quality-bad') review.reason = null
      return same(review, s.review) ? s : { ...s, review }
    }
    case 'rejectEcho':
      return s.rejectedEchoes.includes(a.id) ? s : { ...s, rejectedEchoes: [...s.rejectedEchoes, a.id], echoEdit: s.echoEdit?.id === a.id ? null : s.echoEdit }
    case 'setEchoEdit':
      return same(a.edit, s.echoEdit) ? s : { ...s, echoEdit: a.edit }
    case 'setPreview':
      return s.preview === a.on ? s : { ...s, preview: a.on }
    case 'setShowEchoes':
      return s.showEchoes === a.on ? s : { ...s, showEchoes: a.on }
    case 'forget': {
      if (s.selectedUuid !== a.uuid && s.editingUuid !== a.uuid) return s
      const edit = s.editingUuid === a.uuid
      return { ...s, selectedUuid: s.selectedUuid === a.uuid ? null : s.selectedUuid, ...(edit ? NO_EDIT : {}), shown: edit ? null : s.shown }
    }
  }
}
