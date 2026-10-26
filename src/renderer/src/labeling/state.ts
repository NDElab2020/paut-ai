/**
 * 라벨 모드 상태 — 순수 리듀서 (React·DOM 없음, tests/labeling 에서 직접 검사). shared/imaging/postReducer 와 같은 패턴:
 *   - 변화 없는 액션은 같은 상태(참조 동일)를 돌려줘 다시 그리지도, 이력을 남기지도 않는다
 *   - 초안(draft: 점·사각형·기준 커서 R·검토 구간)을 바꾸는 액션만 되돌리기 이력(LABEL_UNDO_DEPTH 단계)에 남긴다
 *   - 모드·도구·점 역할·선택·시간 커서·패널 접기는 이력에 넣지 않는다 (커서와 같은 '보는 상태')
 * 초안은 전문가가 지금 찍는 것이고, 기록(IndicationRecord) 만들기는 record.ts, 저장은 패널(LabelPanel.tsx)이 한다 — toAnchorPoint 참고.
 * 좌표는 검사 좌표(mm)와 원자료 앵커(스캔 칸·빔·샘플 실수)를 함께 둔다. 화면 px 는 두지 않는다 (규격_초안.md 1.3).
 *
 * 되돌리기(Ctrl/Cmd+Z)는 후처리(postReducer)와 라벨 초안 두 이력이 있어 NdeViewer 가 고친 순서(UndoSource 목록)를 기록하고
 * pickUndo 로 고른다. 보통 모드는 후처리만 (지금과 같음), 라벨 모드는 마지막에 고친 쪽부터.
 */
import { withGroupPost, type PostProcess } from '@shared/imaging'
import type { AnchorRole } from '@shared/labels'

/** 라벨 모드 도구: 조작을 이 상태로 갈라 보통 모드 조작과 겹치지 않게 한다 (labelGestures) */
export type LabelTool = 'point' | 'rect' | 'length' | 'review'

export const LABEL_TOOLS: ReadonlyArray<{ id: LabelTool; name: string; short: string; key: string; title: string }> = [
  { id: 'point', name: '점', short: '점', key: '1', title: 'S-scan 클릭 = 점 찍기(깊이 포함), 끌기 = 사각형 (1)' },
  { id: 'rect', name: '사각형', short: '사각', key: '2', title: 'S-scan 끌기 = 사각형, 클릭 = 빔 고르기 (2)' },
  { id: 'length', name: '길이', short: '길이', key: '3', title: 'C/B-scan 끌기 = 기준 커서 R(누른 곳) + 현재 커서(놓은 곳), 길이 S(m−r) (3). R 키 = 지금 커서를 R 로' },
  { id: 'review', name: '검토 구간', short: '구간', key: '4', title: 'C/B-scan 끌기 = 검토 구간(스캔 범위) (4)' }
]

/** 되돌리기 이력 단계 수 (후처리와 같음) */
export const LABEL_UNDO_DEPTH = 10

/** 한 기록에 하나만 두는 점 역할 — 같은 역할을 다시 찍으면 그 점을 옮긴다(id 유지 → 높이 칸의 점 참조가 그대로) */
export const SINGLE_ROLES: ReadonlySet<AnchorRole> = new Set<AnchorRole>([
  'peak',
  'tip-top',
  'tip-bottom',
  'surface',
  'drop-top',
  'drop-bottom',
  'length-start',
  'length-end',
  'rect-a',
  'rect-b'
])

/** 찍은 점 하나 (S-scan 클릭 또는 N 키). 기록의 AnchorPoint 로 그대로 바뀐다 (toAnchorPoint) */
export interface LabelDraftPoint {
  /** 'p1', 'p2' … (기록 안에서 유일, AnchorPoint.id) */
  id: string
  role: AnchorRole
  groupId: number
  /** 찍을 때 커서 스캔 칸 (정수) */
  scanIndex: number
  scanMm: number
  /** 용접 중심선(CL) 기준 V (mm) */
  vMm: number
  /** 펼친 깊이 (S-scan 세로, mm) */
  unfoldedDepthMm: number
  /** 앵커 빔·샘플 (실수, S-scan 조회표 규칙 — shared/imaging sscanLookupBeamSample) */
  beam: number
  sample: number
  /** 찍을 때 화면 소프트 이득 Δ (dB, 참고) */
  displayGainDb: number
  /**
   * 길이 시작·끝 점만: 길이를 잰 빔 (C-scan 한 행, 정수). 그 점의 앵커 빔·샘플은 단면 기준점과 같게 둔다(record.ts lengthPointsFor) —
   * 파생 위치의 V·깊이가 단면 밖으로 끌려가지 않게. 기록에서는 length.beam 이 된다
   */
  measuredBeam?: number
}

/** S-scan 끌기 사각형 (한 장면: 그룹·스캔 칸). 모서리 두 점은 기록에서 rect-a·rect-b 점이 된다 */
export interface LabelDraftRect {
  groupId: number
  scanIndex: number
  scanMm: number
  vMinMm: number
  vMaxMm: number
  /** 펼친 깊이 */
  depthMinMm: number
  depthMaxMm: number
  displayGainDb: number
}

/** 기준 커서 R (OmniPC 관례: R = 시작, 현재 커서 = 끝, S(m−r) = 길이 — OmniPC 측정값의 S 는 스캔축, U 는 초음파축) */
export interface LabelRefCursor {
  groupId: number
  scanMm: number
  beam: number
}

/** 검토 구간 초안 (스캔 범위). 종류(검토 완료·품질 불량·기준 미만)는 패널이 고른다. groupId null = 모든 그룹 */
export interface LabelReviewDraft {
  groupId: number | null
  scanStartMm: number
  scanEndMm: number
}

/** A-scan 시간(깊이) 커서 — 그 빔의 펼친 깊이 */
export interface LabelTimeCursor {
  groupId: number
  beam: number
  depthMm: number
}

export interface LabelDraft {
  points: LabelDraftPoint[]
  rect: LabelDraftRect | null
  ref: LabelRefCursor | null
  review: LabelReviewDraft | null
}

export interface LabelUi {
  /** 라벨 모드 (끄면 덮개·S-scan 확대·라벨 조작이 모두 꺼지고 그림은 보통 모드와 바이트 단위로 같다) */
  on: boolean
  tool: LabelTool
  /** 다음 점의 역할 */
  pointRole: AnchorRole
  /** 오른쪽 라벨 패널 펼침 (접으면 좁은 띠만) */
  panelOpen: boolean
  /** 고른 점·초안 ('p1' · 'rect' · 'ref' · 'review') 또는 패널이 정한 기록 id */
  selectedId: string | null
  timeCursor: LabelTimeCursor | null
  /** 이 세션에서 쓴 가장 큰 점 번호 — 지우거나 되돌린 점의 id 를 다시 쓰지 않게 (이력에 넣지 않음) */
  pointSeq: number
}

export interface LabelState {
  ui: LabelUi
  draft: LabelDraft
  history: LabelDraft[]
}

export type NewDraftPoint = Omit<LabelDraftPoint, 'id'>

export type LabelAction =
  | { type: 'setMode'; on: boolean }
  | { type: 'toggleMode' }
  | { type: 'setTool'; tool: LabelTool }
  | { type: 'setPointRole'; role: AnchorRole }
  | { type: 'setPanelOpen'; open: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'setTimeCursor'; cursor: LabelTimeCursor | null }
  /** 점 찍기. 하나만 두는 역할(SINGLE_ROLES)이 이미 있으면 그 점을 옮긴다 */
  | { type: 'addPoint'; point: NewDraftPoint }
  /** 점 여럿을 한 번에 (길이 시작·끝 등) — 되돌리기 한 단계. 규칙은 addPoint 와 같다 */
  | { type: 'setPoints'; points: NewDraftPoint[] }
  /** 그 역할의 점을 모두 지운다 (길이 지우기 등) */
  | { type: 'removeRoles'; roles: AnchorRole[] }
  | { type: 'updatePoint'; id: string; patch: Partial<NewDraftPoint> }
  | { type: 'removePoint'; id: string }
  | { type: 'setRect'; rect: LabelDraftRect | null }
  | { type: 'setRef'; ref: LabelRefCursor | null }
  | { type: 'setReview'; review: LabelReviewDraft | null }
  | { type: 'clearDraft' }
  /** 패널이 저장한 기록을 다시 고치려고 불러올 때 (이력 비움) */
  | { type: 'loadDraft'; draft: LabelDraft }
  | { type: 'undo' }

export const EMPTY_DRAFT: LabelDraft = { points: [], rect: null, ref: null, review: null }

export function initialLabelState(panelOpen = true): LabelState {
  return { ui: { on: false, tool: 'point', pointRole: 'peak', panelOpen, selectedId: null, timeCursor: null, pointSeq: 0 }, draft: EMPTY_DRAFT, history: [] }
}

export function isEmptyDraft(d: LabelDraft): boolean {
  return d.points.length === 0 && d.rect === null && d.ref === null && d.review === null
}

/** 점 id 'p<n>' 의 번호 가운데 가장 큰 것 (없으면 0) */
export function maxPointNumber(points: readonly Pick<LabelDraftPoint, 'id'>[]): number {
  let n = 0
  for (const p of points) {
    const m = /^p(\d+)$/.exec(p.id)
    if (m) n = Math.max(n, Number(m[1]))
  }
  return n
}

/** 다음 점 번호: 이 세션에서 쓴 번호(seq)와 남은 점 번호 가운데 큰 것 + 1 — 지우거나 되돌린 점의 id 를 다시 쓰지 않는다 */
export function nextPointNumber(points: readonly Pick<LabelDraftPoint, 'id'>[], seq: number): number {
  return Math.max(seq, maxPointNumber(points)) + 1
}

/** 점들을 차례로 놓는다: 하나만 두는 역할이 이미 있으면 그 점을 옮기고(id 유지), 아니면 새 번호. 마지막 점 id 와 쓴 번호 */
function placePoints(points: readonly LabelDraftPoint[], seq: number, add: readonly NewDraftPoint[]): { points: LabelDraftPoint[]; lastId: string | null; seq: number } {
  let out = [...points]
  let lastId: string | null = null
  let n = seq
  for (const p of add) {
    const same = SINGLE_ROLES.has(p.role) ? out.find((q) => q.role === p.role) : undefined
    if (same) {
      out = out.map((q) => (q.id === same.id ? { ...p, id: same.id } : q))
      lastId = same.id
      continue
    }
    n = nextPointNumber(out, n)
    lastId = `p${n}`
    out = [...out, { ...p, id: lastId }]
  }
  return { points: out, lastId, seq: n }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function withUi(s: LabelState, patch: Partial<LabelUi>): LabelState {
  const ui = { ...s.ui, ...patch }
  return sameJson(ui, s.ui) ? s : { ...s, ui }
}

/** 초안 변경 → 이력 한 단계 (같은 값이면 그대로) */
function withDraft(s: LabelState, draft: LabelDraft, ui?: Partial<LabelUi>): LabelState {
  if (sameJson(draft, s.draft)) return ui ? withUi(s, ui) : s
  return { ui: ui ? { ...s.ui, ...ui } : s.ui, draft, history: [...s.history.slice(-(LABEL_UNDO_DEPTH - 1)), s.draft] }
}

function normRect(r: LabelDraftRect): LabelDraftRect {
  return {
    ...r,
    vMinMm: Math.min(r.vMinMm, r.vMaxMm),
    vMaxMm: Math.max(r.vMinMm, r.vMaxMm),
    depthMinMm: Math.min(r.depthMinMm, r.depthMaxMm),
    depthMaxMm: Math.max(r.depthMinMm, r.depthMaxMm)
  }
}

function normReview(r: LabelReviewDraft): LabelReviewDraft {
  return { ...r, scanStartMm: Math.min(r.scanStartMm, r.scanEndMm), scanEndMm: Math.max(r.scanStartMm, r.scanEndMm) }
}

export function labelReducer(s: LabelState, a: LabelAction): LabelState {
  switch (a.type) {
    case 'setMode':
      return withUi(s, { on: a.on })
    case 'toggleMode':
      return withUi(s, { on: !s.ui.on })
    case 'setTool':
      return withUi(s, { tool: a.tool })
    case 'setPointRole':
      return withUi(s, { pointRole: a.role })
    case 'setPanelOpen':
      return withUi(s, { panelOpen: a.open })
    case 'select':
      return withUi(s, { selectedId: a.id })
    case 'setTimeCursor':
      return withUi(s, { timeCursor: a.cursor })
    case 'addPoint': {
      const r = placePoints(s.draft.points, s.ui.pointSeq, [a.point])
      return withDraft(s, { ...s.draft, points: r.points }, { selectedId: r.lastId, pointSeq: r.seq })
    }
    case 'setPoints': {
      if (a.points.length === 0) return s
      const r = placePoints(s.draft.points, s.ui.pointSeq, a.points)
      return withDraft(s, { ...s.draft, points: r.points }, { selectedId: r.lastId, pointSeq: r.seq })
    }
    case 'removeRoles': {
      const roles = new Set(a.roles)
      if (!s.draft.points.some((p) => roles.has(p.role))) return s
      const points = s.draft.points.filter((p) => !roles.has(p.role))
      const sel = s.ui.selectedId
      return withDraft(s, { ...s.draft, points }, sel && !points.some((p) => p.id === sel) && /^p\d+$/.test(sel) ? { selectedId: null } : undefined)
    }
    case 'updatePoint': {
      if (!s.draft.points.some((p) => p.id === a.id)) return s
      return withDraft(s, { ...s.draft, points: s.draft.points.map((p) => (p.id === a.id ? { ...p, ...a.patch, id: p.id } : p)) })
    }
    case 'removePoint': {
      if (!s.draft.points.some((p) => p.id === a.id)) return s
      return withDraft(s, { ...s.draft, points: s.draft.points.filter((p) => p.id !== a.id) }, s.ui.selectedId === a.id ? { selectedId: null } : undefined)
    }
    case 'setRect':
      return withDraft(s, { ...s.draft, rect: a.rect ? normRect(a.rect) : null }, a.rect ? { selectedId: 'rect' } : undefined)
    case 'setRef':
      return withDraft(s, { ...s.draft, ref: a.ref })
    case 'setReview':
      return withDraft(s, { ...s.draft, review: a.review ? normReview(a.review) : null })
    case 'clearDraft':
      return withDraft(s, EMPTY_DRAFT, { selectedId: null })
    case 'loadDraft':
      return { ...s, draft: a.draft, history: [], ui: { ...s.ui, selectedId: null, pointSeq: Math.max(s.ui.pointSeq, maxPointNumber(a.draft.points)) } }
    case 'undo': {
      const prev = s.history[s.history.length - 1]
      return prev ? { ...s, draft: prev, history: s.history.slice(0, -1) } : s
    }
  }
}

// ──────────────────────────────── 조작 갈래 ────────────────────────────────

/** 라벨 모드 도구 → 뷰 조작. 보통 모드(on = false)는 지금 조작 그대로 (S-scan 클릭 = 빔 고르기, 게이트 점선 끌기) */
export interface LabelGestures {
  /** S-scan 클릭(6 px 미만) = 점 찍기 (false 면 빔 고르기) */
  sscanClickPoint: boolean
  /** S-scan 끌기(6 px 이상) = 사각형 */
  sscanDragRect: boolean
  /** S-scan 영상 위 게이트 점선 끌기 (점·사각형 도구에서는 같은 끌기와 겹쳐 끈다) */
  sscanGateDrag: boolean
  /** S-scan 확대 (휠·눈금자 끌기·더블클릭 초기화, Z 초기화) — 라벨 모드에서만 */
  sscanZoom: boolean
  /** C/B-scan 끌기 = 기준 커서 R(누른 곳) + 현재 커서(놓은 곳) */
  scanDragLength: boolean
  /** C/B-scan 끌기 = 검토 구간 */
  scanDragReview: boolean
  /** A-scan 클릭·끌기 = 시간(깊이) 커서 */
  ascanTimeCursor: boolean
  /** 영상 위 라벨 덮개 */
  overlays: boolean
}

export function labelGestures(ui: Pick<LabelUi, 'on' | 'tool'>): LabelGestures {
  if (!ui.on) {
    return { sscanClickPoint: false, sscanDragRect: false, sscanGateDrag: true, sscanZoom: false, scanDragLength: false, scanDragReview: false, ascanTimeCursor: false, overlays: false }
  }
  const t = ui.tool
  return {
    sscanClickPoint: t === 'point',
    sscanDragRect: t === 'point' || t === 'rect',
    sscanGateDrag: t === 'length' || t === 'review',
    sscanZoom: true,
    scanDragLength: t === 'length',
    scanDragReview: t === 'review',
    ascanTimeCursor: true,
    overlays: true
  }
}

/**
 * 보통 모드에서 보는 후처리: S-scan 확대(sscanDepthMm·그룹별 sscanV)는 라벨 모드에서만 쓰므로 뺀다 — 라벨 모드에서 확대한 채로
 * 끄면 S-scan 은 기본 창으로 돌아가고 '조정됨'·'파일값으로' 도 지금과 같게 (확대만 있으면 기본값). 확대가 없으면 같은 객체
 */
export function postWithoutSscanZoom(p: PostProcess): PostProcess {
  const ids = Object.keys(p.groups)
    .map(Number)
    .filter((id) => p.groups[id]!.sscanV !== null)
  if (p.sscanDepthMm === null && ids.length === 0) return p
  let next: PostProcess = { ...p, sscanDepthMm: null }
  for (const id of ids) next = withGroupPost(next, id, { sscanV: null })
  return next
}

/** 기준 커서 R 과 현재 커서로 잰 길이 S(m−r) (mm, OmniPC 설명서의 m − r 과 같은 부호). R 이 없으면 null */
export function lengthFromRef(ref: LabelRefCursor | null, cursorScanMm: number): number | null {
  return ref ? cursorScanMm - ref.scanMm : null
}

// ──────────────────────────────── 되돌리기 순서 (후처리 · 라벨) ────────────────────────────────

export type UndoSource = 'post' | 'label'

/**
 * 이전·지금 상태로 '이력에 남는 고침'이 있었는지 — 고친 액션은 이전 값을 이력 끝에 넣는다 (postReducer·labelReducer 공통).
 * 되돌리기(이력이 줄어듦)·커서 따라가기(이력 그대로)·불러오기(이력 비움)는 고침이 아니다
 */
export function isHistoryEdit<T>(prev: { history: readonly T[] }, prevValue: T, next: { history: readonly T[] }, nextValue: T): boolean {
  if (nextValue === prevValue) return false
  return next.history.length > 0 && next.history[next.history.length - 1] === prevValue && next.history !== prev.history
}

/** 고친 순서 목록의 최대 길이 (두 이력 합) */
export const UNDO_ORDER_MAX = LABEL_UNDO_DEPTH * 2

export function pushUndoSource(order: readonly UndoSource[], src: UndoSource): UndoSource[] {
  return [...order, src].slice(-UNDO_ORDER_MAX)
}

/**
 * Ctrl/Cmd+Z 가 되돌릴 쪽. 라벨 모드가 아니면 후처리만 (지금과 같음 — 라벨 표시는 남겨 둔다).
 * 라벨 모드면 고친 순서의 끝에서부터, 되돌릴 이력이 없는 표시(이력 단계 수를 넘겨 밀려난 것)는 버리고 고른다.
 * 표시가 없으면(세션 캐시로 연 후처리 등) 후처리 → 라벨 순서로
 */
export function pickUndo(order: readonly UndoSource[], can: Readonly<Record<UndoSource, boolean>>, labelOn: boolean): { source: UndoSource | null; order: UndoSource[] } {
  const rest = [...order]
  if (!labelOn) {
    const i = rest.lastIndexOf('post')
    if (i >= 0) rest.splice(i, 1)
    return { source: can.post ? 'post' : null, order: rest }
  }
  while (rest.length) {
    const s = rest.pop()!
    if (can[s]) return { source: s, order: rest }
  }
  return { source: can.post ? 'post' : can.label ? 'label' : null, order: rest }
}
