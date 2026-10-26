/**
 * 이미지 보기 조작 규칙 (렌더러 viewer/Axis·canvas 의 순수 부분):
 *  - 끌기 중 Ctrl/Cmd+Z 막기 — 잡을 때의 게이트 기준 계산이 되돌리기로 어긋나지 않게 (window 캡처 단계에서 삼킴)
 *  - 눈금자 다이아몬드 고르기 — 잡는 범위 안 가장 가까운 것, 겹친 게이트 시작·끝은 첫 움직임 방향으로 (S-scan 점선과 같은 규칙)
 */
import { describe, expect, it } from 'vitest'
import { gateEdgeByMove, gateEdgeGrab } from '@shared/imaging'

// 렌더러 모듈은 tsconfig.node.json 범위 밖(TSX)이라 정적 import 를 못 쓴다. vitest 는 경로 문자열로도 읽는다 (skipLabel.test.ts 와 같음)
const CANVAS = '../src/renderer/src/viewer/canvas'
const AXIS = '../src/renderer/src/viewer/Axis'
type KeyLike = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string }
const { isUndoShortcut, blockUndoWhileDragging } = (await import(CANVAS)) as {
  isUndoShortcut: (e: KeyLike) => boolean
  blockUndoWhileDragging: (target?: EventTarget) => () => void
}
type Marker = { id: string; kind: 'gate-start' | 'gate-end' | 'threshold'; value: number; onDrag?: (v: number) => void; onDragEnd?: (v: number) => void }
const { pickAxisMarker } = (await import(AXIS)) as {
  pickAxisMarker: (markers: Marker[], posOf: (v: number) => number, px: number, hitPx?: number) => { marker: Marker; tieEnd: Marker | null } | null
}

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, code, ...mods })

describe('되돌리기 키와 끌기 중 막기', () => {
  it('Ctrl+Z·Cmd+Z 만 (Shift·Alt 조합·Z 단독은 아님)', () => {
    expect(isUndoShortcut(key('KeyZ', { ctrlKey: true }))).toBe(true)
    expect(isUndoShortcut(key('KeyZ', { metaKey: true }))).toBe(true)
    expect(isUndoShortcut(key('KeyZ'))).toBe(false)
    expect(isUndoShortcut(key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isUndoShortcut(key('KeyZ', { metaKey: true, altKey: true }))).toBe(false)
    expect(isUndoShortcut(key('KeyY', { ctrlKey: true }))).toBe(false)
  })

  it('끄는 동안: 캡처 단계에서 Ctrl/Cmd+Z 를 삼키고(기본 동작·전파 멈춤) 다른 키는 그대로, 떼면 다시 통과', () => {
    const target = new EventTarget()
    const send = (k: KeyLike): Event => {
      const e = Object.assign(new Event('keydown', { cancelable: true }), k)
      target.dispatchEvent(e)
      return e
    }
    const unblock = blockUndoWhileDragging(target)
    const undo = send(key('KeyZ', { ctrlKey: true }))
    expect(undo.defaultPrevented).toBe(true)
    expect(undo.cancelBubble).toBe(true)
    const esc = send(key('Escape'))
    expect(esc.defaultPrevented).toBe(false)
    expect(esc.cancelBubble).toBe(false)
    const zoomReset = send(key('KeyZ'))
    expect(zoomReset.defaultPrevented).toBe(false)
    unblock()
    const after = send(key('KeyZ', { metaKey: true }))
    expect(after.defaultPrevented).toBe(false)
    expect(after.cancelBubble).toBe(false)
  })
})

describe('눈금자 다이아몬드 고르기 (pickAxisMarker)', () => {
  const drag = { onDrag: () => undefined }
  // 1 mm = 6.25 px (S-scan 깊이 눈금자 0.16 mm/px 와 같음), 위가 0
  const pos = (v: number): number => v * 6.25
  const gate = (start: number, end: number): Marker[] => [
    { id: 'gate-start', kind: 'gate-start', value: start, ...drag },
    { id: 'gate-end', kind: 'gate-end', value: end, ...drag }
  ]

  it('넓은 게이트: 누른 자리에서 가까운 다이아몬드, 6 px 밖은 없음', () => {
    const m = gate(7, 21)
    expect(pickAxisMarker(m, pos, pos(7) + 3)).toEqual({ marker: m[0], tieEnd: null })
    expect(pickAxisMarker(m, pos, pos(21) - 5)).toEqual({ marker: m[1], tieEnd: null })
    expect(pickAxisMarker(m, pos, pos(14))).toBeNull()
  })

  it('폭이 좁아(1 mm 미만) 둘 다 6 px 안: 예전에는 늘 시작이 잡혔다 — 이제 가까운 것, 거리 차 1 px 미만이면 첫 움직임으로', () => {
    // 검토 재현: 시작 7.0 · 끝 7.1 mm (0.63 px 차) → 끝 다이아몬드 한가운데를 눌러도 차 < 1 px → 미정(tieEnd)
    const tight = gate(7, 7.1)
    const at = pickAxisMarker(tight, pos, pos(7.1))!
    expect(at.marker.kind).toBe('gate-start')
    expect(at.tieEnd?.kind).toBe('gate-end')
    // 아래(값이 커지는 쪽)로 끌면 끝 = 폭을 넓힘, 위로 끌면 시작 = 옮김 (Axis onPointerMove 와 같은 판정)
    expect(gateEdgeByMove(7.1, 10.3)).toBe('end')
    expect(gateEdgeByMove(7.1, 5)).toBe('start')
    // 0.5 mm 폭(3.1 px): 끝 한가운데를 누르면 끝 (거리 차 3.1 px ≥ 1)
    const half = gate(7, 7.5)
    expect(pickAxisMarker(half, pos, pos(7.5))).toEqual({ marker: half[1], tieEnd: null })
    expect(pickAxisMarker(half, pos, pos(7))).toEqual({ marker: half[0], tieEnd: null })
    // 가운데 ±0.5 px 는 미정
    expect(pickAxisMarker(half, pos, pos(7.25) + 0.4)!.tieEnd).toBe(half[1])
  })

  it('뒤집힌 축(from > to)에서도 값 공간으로 비교한다', () => {
    const flipped = (v: number): number => (30 - v) * 6.25
    const m = gate(7, 21)
    expect(pickAxisMarker(m, flipped, flipped(21) + 2)!.marker.kind).toBe('gate-end')
    const tight = gate(7, 7.1)
    expect(pickAxisMarker(tight, flipped, flipped(7.05))!.tieEnd?.kind).toBe('gate-end')
  })

  it('끌 수 없는 표시(onDrag·onDragEnd 없음)는 고르지 않는다, 문턱은 혼자 있는 축이라 가까운 것 그대로', () => {
    expect(pickAxisMarker([{ id: 'x', kind: 'gate-start', value: 7 }], pos, pos(7))).toBeNull()
    const thr: Marker[] = [{ id: 'threshold', kind: 'threshold', value: 25, ...drag }]
    expect(pickAxisMarker(thr, pos, pos(25) + 1)).toEqual({ marker: thr[0], tieEnd: null })
  })

  it('gateEdgeGrab: 하나만 범위 안이면 그것, 둘 다면 가까운 것과 거리 차 < 1 px 이면 tie', () => {
    expect(gateEdgeGrab(3, 9, 6)).toEqual({ edge: 'start', tie: false })
    expect(gateEdgeGrab(9, 3, 6)).toEqual({ edge: 'end', tie: false })
    expect(gateEdgeGrab(7, 9, 6)).toBeNull()
    expect(gateEdgeGrab(1, 4, 6)).toEqual({ edge: 'start', tie: false })
    expect(gateEdgeGrab(2.2, 1.6, 6)).toEqual({ edge: 'end', tie: true })
  })
})
