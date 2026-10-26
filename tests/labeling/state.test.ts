/**
 * 라벨 모드 상태 리듀서 (renderer/src/labeling/state.ts — 순수, postReducer 패턴):
 *  - 모드·도구·역할·선택·시간 커서는 이력에 넣지 않고, 초안(점·사각형·R·검토 구간)만 되돌리기 이력 10단계
 *  - 변화 없는 액션은 같은 상태(참조 동일)
 *  - 하나만 두는 역할은 다시 찍으면 그 점을 옮김(id 유지)
 *  - 조작 갈래(labelGestures): 보통 모드는 지금 조작 그대로, 도구마다 겹치지 않음
 *  - 되돌리기 순서(pickUndo·isHistoryEdit): 보통 모드는 후처리만, 라벨 모드는 마지막에 고친 쪽부터
 *  - 보통 모드 후처리에서 S-scan 확대를 뺌(postWithoutSscanZoom) — '조정됨'·'파일값으로' 가 지금과 같게
 */
import { describe, expect, it } from 'vitest'
import { defaultPost, isDefaultPost, postReducer, withGroupPost, type PostProcess, type PostState } from '@shared/imaging'

// 렌더러 모듈은 tsconfig.node.json 범위 밖이라 정적 import 를 못 쓴다 (viewerInput.test.ts 와 같은 방식). 타입은 여기 최소로 적는다
const STATE = '../../src/renderer/src/labeling/state'
type Role = 'peak' | 'tip-top' | 'tip-bottom' | 'tip' | 'other' | 'rect-a'
type Tool = 'point' | 'rect' | 'length' | 'review'
interface Point {
  id: string
  role: Role
  groupId: number
  scanIndex: number
  scanMm: number
  vMm: number
  unfoldedDepthMm: number
  beam: number
  sample: number
  displayGainDb: number
}
interface Draft {
  points: Point[]
  rect: { groupId: number; scanIndex: number; scanMm: number; vMinMm: number; vMaxMm: number; depthMinMm: number; depthMaxMm: number; displayGainDb: number } | null
  ref: { groupId: number; scanMm: number; beam: number } | null
  review: { groupId: number | null; scanStartMm: number; scanEndMm: number } | null
}
interface Ui {
  on: boolean
  tool: Tool
  pointRole: Role
  panelOpen: boolean
  selectedId: string | null
  timeCursor: { groupId: number; beam: number; depthMm: number } | null
  pointSeq: number
}
interface State {
  ui: Ui
  draft: Draft
  history: Draft[]
}
type Action = { type: string; [k: string]: unknown }
type Src = 'post' | 'label'
const M = (await import(STATE)) as {
  initialLabelState: (panelOpen?: boolean) => State
  labelReducer: (s: State, a: Action) => State
  labelGestures: (ui: Pick<Ui, 'on' | 'tool'>) => Record<string, boolean>
  lengthFromRef: (ref: Draft['ref'], cursorMm: number) => number | null
  nextPointNumber: (points: Pick<Point, 'id'>[], seq: number) => number
  isEmptyDraft: (d: Draft) => boolean
  pickUndo: (order: Src[], can: Record<Src, boolean>, labelOn: boolean) => { source: Src | null; order: Src[] }
  pushUndoSource: (order: Src[], s: Src) => Src[]
  isHistoryEdit: <T>(prev: { history: readonly T[] }, prevValue: T, next: { history: readonly T[] }, nextValue: T) => boolean
  postWithoutSscanZoom: (p: PostProcess) => PostProcess
  LABEL_UNDO_DEPTH: number
  UNDO_ORDER_MAX: number
  LABEL_TOOLS: ReadonlyArray<{ id: Tool; key: string }>
}
const { labelReducer: R } = M

const pt = (role: Role, over: Partial<Point> = {}): Omit<Point, 'id'> => ({
  role,
  groupId: 0,
  scanIndex: 39,
  scanMm: 39,
  vMm: 1.2,
  unfoldedDepthMm: 10.5,
  beam: 14.3,
  sample: 401.2,
  displayGainDb: 0,
  ...over
})
const run = (s: State, ...as: Action[]): State => as.reduce(R, s)

describe('라벨 모드 리듀서', () => {
  it('처음: 꺼짐 · 점 도구 · 최대 진폭 역할 · 빈 초안 · 이력 없음', () => {
    const s = M.initialLabelState()
    expect(s.ui).toEqual({ on: false, tool: 'point', pointRole: 'peak', panelOpen: true, selectedId: null, timeCursor: null, pointSeq: 0 })
    expect(M.isEmptyDraft(s.draft)).toBe(true)
    expect(s.history).toEqual([])
    expect(M.initialLabelState(false).ui.panelOpen).toBe(false)
  })

  it('모드·도구·역할·패널·선택·시간 커서는 이력에 남지 않고, 같은 값이면 같은 상태', () => {
    const s0 = M.initialLabelState()
    const s1 = run(s0, { type: 'toggleMode' }, { type: 'setTool', tool: 'length' }, { type: 'setPointRole', role: 'tip-top' }, { type: 'setPanelOpen', open: false })
    expect(s1.ui).toMatchObject({ on: true, tool: 'length', pointRole: 'tip-top', panelOpen: false })
    expect(s1.history).toEqual([])
    expect(s1.draft).toBe(s0.draft)
    expect(R(s1, { type: 'setTool', tool: 'length' })).toBe(s1)
    expect(R(s1, { type: 'setMode', on: true })).toBe(s1)
    const s2 = R(s1, { type: 'setTimeCursor', cursor: { groupId: 0, beam: 14, depthMm: 12.5 } })
    expect(s2.ui.timeCursor).toEqual({ groupId: 0, beam: 14, depthMm: 12.5 })
    expect(s2.history).toEqual([])
    expect(R(s2, { type: 'setTimeCursor', cursor: { groupId: 0, beam: 14, depthMm: 12.5 } })).toBe(s2)
    expect(R(s2, { type: 'undo' })).toBe(s2) // 이력이 없으면 그대로
  })

  it('점 찍기: p1, p2 … (지우거나 되돌린 점의 id 는 다시 쓰지 않음), 고른 점이 새 점, 한 단계씩 되돌리기', () => {
    let s = run(M.initialLabelState(), { type: 'setMode', on: true })
    s = R(s, { type: 'addPoint', point: pt('tip') })
    s = R(s, { type: 'addPoint', point: pt('tip', { vMm: 2 }) })
    expect(s.draft.points.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.ui.selectedId).toBe('p2')
    s = R(s, { type: 'removePoint', id: 'p2' })
    expect(s.ui.selectedId).toBeNull()
    s = R(s, { type: 'addPoint', point: pt('other') })
    expect(s.draft.points.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(s.history.length).toBe(4)
    s = R(s, { type: 'undo' })
    expect(s.draft.points.map((p) => p.id)).toEqual(['p1'])
    s = R(s, { type: 'undo' })
    expect(s.draft.points.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.history.length).toBe(2)
    // 되돌린 뒤 새 점도 쓴 적 없는 번호
    s = R(s, { type: 'addPoint', point: pt('tip', { vMm: 9 }) })
    expect(s.draft.points.map((p) => p.id)).toEqual(['p1', 'p2', 'p4'])
    expect(M.nextPointNumber([{ id: 'p7' }], 2)).toBe(8)
    expect(M.nextPointNumber([{ id: 'x' }], 0)).toBe(1)
    // 불러온 초안의 번호보다 크게
    const loaded = R(M.initialLabelState(), { type: 'loadDraft', draft: { points: [{ ...pt('tip'), id: 'p12' }], rect: null, ref: null, review: null } })
    expect(R(loaded, { type: 'addPoint', point: pt('other') }).draft.points.map((p) => p.id)).toEqual(['p12', 'p13'])
  })

  it('하나만 두는 역할(최대 진폭·위 팁 …)은 다시 찍으면 그 점을 옮긴다 (id 유지 → 높이 칸 참조 그대로)', () => {
    let s = R(M.initialLabelState(), { type: 'addPoint', point: pt('peak', { vMm: 1 }) })
    s = R(s, { type: 'addPoint', point: pt('tip-top', { vMm: 1.5 }) })
    s = R(s, { type: 'addPoint', point: pt('peak', { vMm: 3, scanIndex: 40 }) })
    expect(s.draft.points.map((p) => [p.id, p.role, p.vMm])).toEqual([
      ['p1', 'peak', 3],
      ['p2', 'tip-top', 1.5]
    ])
    expect(s.ui.selectedId).toBe('p1')
    // 같은 자리에 같은 점이면 변화 없음
    expect(R(s, { type: 'addPoint', point: pt('peak', { vMm: 3, scanIndex: 40 }) })).toBe(s)
    // 팁·기타는 여럿
    s = R(s, { type: 'addPoint', point: pt('tip') })
    s = R(s, { type: 'addPoint', point: pt('tip') })
    expect(s.draft.points.filter((p) => p.role === 'tip').length).toBe(2)
  })

  it('고치기·없는 점은 그대로, 사각형·검토 구간은 작은 값부터, 초안 지우기·불러오기', () => {
    let s = R(M.initialLabelState(), { type: 'addPoint', point: pt('tip') })
    expect(R(s, { type: 'updatePoint', id: 'p9', patch: { vMm: 5 } })).toBe(s)
    expect(R(s, { type: 'removePoint', id: 'p9' })).toBe(s)
    s = R(s, { type: 'updatePoint', id: 'p1', patch: { vMm: 5, id: 'zz' } })
    expect(s.draft.points[0]).toMatchObject({ id: 'p1', vMm: 5 })
    s = R(s, { type: 'setRect', rect: { groupId: 0, scanIndex: 39, scanMm: 39, vMinMm: 4, vMaxMm: -2, depthMinMm: 20, depthMaxMm: 12, displayGainDb: 0 } })
    expect(s.draft.rect).toMatchObject({ vMinMm: -2, vMaxMm: 4, depthMinMm: 12, depthMaxMm: 20 })
    expect(s.ui.selectedId).toBe('rect')
    s = R(s, { type: 'setReview', review: { groupId: null, scanStartMm: 90, scanEndMm: 60 } })
    expect(s.draft.review).toEqual({ groupId: null, scanStartMm: 60, scanEndMm: 90 })
    s = R(s, { type: 'setRef', ref: { groupId: 1, scanMm: 30, beam: 12 } })
    const before = s.history.length
    s = R(s, { type: 'clearDraft' })
    expect(M.isEmptyDraft(s.draft)).toBe(true)
    expect(s.history.length).toBe(before + 1)
    expect(R(s, { type: 'clearDraft' })).toBe(s)
    s = R(s, { type: 'undo' })
    expect(s.draft.ref).toEqual({ groupId: 1, scanMm: 30, beam: 12 })
    const loaded = R(s, { type: 'loadDraft', draft: { points: [], rect: null, ref: null, review: { groupId: 0, scanStartMm: 1, scanEndMm: 2 } } })
    expect(loaded.history).toEqual([])
    expect(loaded.draft.review).toEqual({ groupId: 0, scanStartMm: 1, scanEndMm: 2 })
  })

  it(`되돌리기 이력은 최근 ${10} 단계까지`, () => {
    let s = M.initialLabelState()
    for (let i = 0; i < 15; i++) s = R(s, { type: 'setRef', ref: { groupId: 0, scanMm: i, beam: 0 } })
    expect(M.LABEL_UNDO_DEPTH).toBe(10)
    expect(s.history.length).toBe(10)
    for (let i = 0; i < 12; i++) s = R(s, { type: 'undo' })
    expect(s.draft.ref).toEqual({ groupId: 0, scanMm: 4, beam: 0 })
  })
})

describe('조작 갈래 (보통 모드 조작과 겹치지 않게)', () => {
  it('보통 모드: 지금 그대로 (S-scan 클릭 = 빔 고르기, 게이트 점선 끌기만 켜짐, 확대·덮개 없음)', () => {
    for (const tool of ['point', 'rect', 'length', 'review'] as const) {
      expect(M.labelGestures({ on: false, tool })).toEqual({
        sscanClickPoint: false,
        sscanDragRect: false,
        sscanGateDrag: true,
        sscanZoom: false,
        scanDragLength: false,
        scanDragReview: false,
        ascanTimeCursor: false,
        overlays: false
      })
    }
  })

  it('라벨 모드: 도구마다 하나의 뜻, S-scan 끌기(사각형)와 게이트 점선 끌기는 같이 켜지지 않는다', () => {
    const g = (tool: Tool) => M.labelGestures({ on: true, tool })
    expect(g('point')).toMatchObject({ sscanClickPoint: true, sscanDragRect: true, sscanGateDrag: false, scanDragLength: false, scanDragReview: false })
    expect(g('rect')).toMatchObject({ sscanClickPoint: false, sscanDragRect: true, sscanGateDrag: false })
    expect(g('length')).toMatchObject({ sscanClickPoint: false, sscanDragRect: false, sscanGateDrag: true, scanDragLength: true, scanDragReview: false })
    expect(g('review')).toMatchObject({ sscanDragRect: false, sscanGateDrag: true, scanDragLength: false, scanDragReview: true })
    for (const tool of ['point', 'rect', 'length', 'review'] as const) {
      const x = g(tool)
      expect(x.sscanZoom && x.ascanTimeCursor && x.overlays).toBe(true)
      expect(x.sscanDragRect && x.sscanGateDrag).toBe(false)
      expect(x.scanDragLength && x.scanDragReview).toBe(false)
    }
  })

  it('도구 키는 1~4 (지금 쓰는 키 화살표·G·Z·=·−·0·A 와 겹치지 않음)', () => {
    expect(M.LABEL_TOOLS.map((t) => t.key)).toEqual(['1', '2', '3', '4'])
  })

  it('길이 S(m−r) = 현재 커서 − 기준 커서 R (OmniPC 측정값의 S = 스캔축)', () => {
    expect(M.lengthFromRef(null, 50)).toBeNull()
    expect(M.lengthFromRef({ groupId: 0, scanMm: 30, beam: 3 }, 50)).toBe(20)
    expect(M.lengthFromRef({ groupId: 0, scanMm: 30, beam: 3 }, 10)).toBe(-20)
  })
})

describe('되돌리기 순서 (후처리 · 라벨 초안)', () => {
  const post0: PostState = { post: defaultPost('sha'), history: [] }
  const lim = { full: [0, 100] as [number, number], minWidth: 1 }

  it('고침 판정: 이력에 남는 고침만 (되돌리기·커서 따라가기·불러오기는 아님)', () => {
    const p1 = postReducer(post0, { type: 'setScanRange', range: [10, 20], limits: lim })
    expect(M.isHistoryEdit(post0, post0.post, p1, p1.post)).toBe(true)
    const p2 = postReducer(p1, { type: 'undo' })
    expect(M.isHistoryEdit(p1, p1.post, p2, p2.post)).toBe(false)
    const p3 = postReducer(p1, { type: 'ensureScanVisible', cursorMm: 50, full: [0, 100] })
    expect(p3.post).not.toBe(p1.post)
    expect(M.isHistoryEdit(p1, p1.post, p3, p3.post)).toBe(false)
    const p4 = postReducer(p1, { type: 'load', post: defaultPost('sha') })
    expect(M.isHistoryEdit(p1, p1.post, p4, p4.post)).toBe(false)
    // 이력이 가득 찬 뒤의 고침도 고침
    let p = post0
    for (let i = 0; i < 12; i++) p = postReducer(p, { type: 'setScanRange', range: [i, i + 20], limits: lim })
    const q = postReducer(p, { type: 'setScanRange', range: [40, 60], limits: lim })
    expect(q.history.length).toBe(10)
    expect(M.isHistoryEdit(p, p.post, q, q.post)).toBe(true)
    // 라벨 초안
    const l0 = M.initialLabelState()
    const l1 = R(l0, { type: 'setRef', ref: { groupId: 0, scanMm: 3, beam: 1 } })
    expect(M.isHistoryEdit(l0, l0.draft, l1, l1.draft)).toBe(true)
    const l2 = R(l1, { type: 'setTool', tool: 'rect' })
    expect(M.isHistoryEdit(l1, l1.draft, l2, l2.draft)).toBe(false)
  })

  it('보통 모드: 후처리만 (라벨 표시는 남겨 둠) — 지금과 같다', () => {
    const r = M.pickUndo(['label', 'post', 'label'], { post: true, label: true }, false)
    expect(r.source).toBe('post')
    expect(r.order).toEqual(['label', 'label'])
    expect(M.pickUndo([], { post: false, label: true }, false).source).toBeNull()
    expect(M.pickUndo([], { post: true, label: false }, false).source).toBe('post')
  })

  it('라벨 모드: 마지막에 고친 쪽부터, 되돌릴 이력이 없는 표시는 건너뜀, 표시가 없으면 후처리 → 라벨', () => {
    let order: Src[] = []
    for (const s of ['post', 'label', 'label', 'post'] as Src[]) order = M.pushUndoSource(order, s)
    let r = M.pickUndo(order, { post: true, label: true }, true)
    expect(r).toEqual({ source: 'post', order: ['post', 'label', 'label'] })
    r = M.pickUndo(r.order, { post: true, label: true }, true)
    expect(r.source).toBe('label')
    r = M.pickUndo(['post', 'label'], { post: true, label: false }, true)
    expect(r).toEqual({ source: 'post', order: [] })
    expect(M.pickUndo([], { post: false, label: true }, true).source).toBe('label')
    expect(M.pickUndo([], { post: false, label: false }, true).source).toBeNull()
    let long: Src[] = []
    for (let i = 0; i < 50; i++) long = M.pushUndoSource(long, i % 2 ? 'post' : 'label')
    expect(long.length).toBe(M.UNDO_ORDER_MAX)
  })
})

describe('보통 모드의 후처리 = S-scan 확대를 뺀 것', () => {
  it('확대가 없으면 같은 객체, 있으면 빼고 나머지 조정은 그대로', () => {
    const base = defaultPost('sha')
    expect(M.postWithoutSscanZoom(base)).toBe(base)
    const gained = withGroupPost(base, 0, { gainDb: 6 })
    expect(M.postWithoutSscanZoom(gained)).toBe(gained)
    const zoomOnly = withGroupPost({ ...base, sscanDepthMm: [5, 30] }, 1, { sscanV: [-10, 10] })
    expect(isDefaultPost(zoomOnly)).toBe(false)
    const stripped = M.postWithoutSscanZoom(zoomOnly)
    expect(isDefaultPost(stripped)).toBe(true)
    expect(stripped.groups).toEqual({})
    const mixed = withGroupPost(zoomOnly, 1, { gainDb: 3 })
    const s2 = M.postWithoutSscanZoom(mixed)
    expect(s2.sscanDepthMm).toBeNull()
    expect(s2.groups[1]).toMatchObject({ sscanV: null, gainDb: 3 })
    // 원래 객체는 그대로 (라벨 모드로 돌아오면 확대가 남아 있다)
    expect(mixed.sscanDepthMm).toEqual([5, 30])
  })
})
