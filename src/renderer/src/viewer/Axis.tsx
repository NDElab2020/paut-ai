/**
 * 영상 옆 눈금 (SVG). 값 범위 [from, to] 를 길이 length(px)에 펼친다. from > to 면 뒤집힌 축.
 * 후처리 조작면(계획_후처리.md 0절 '눈금자가 조작면'): 영상 위에는 아무것도 덮지 않고 눈금자 안에서만
 *   - 다이아몬드(게이트 시작·끝·문턱) 끌기: OmniPC 처럼 눈금자 위 빨간 다이아몬드. 잡는 범위 ±6 px 안 가장 가까운 것, 범위 끌기보다 우선.
 *     시작·끝이 겹치면(거리 차 1 px 미만 — 폭이 좁음) 첫 움직임 방향으로: 값이 커지는 쪽 = 끝(폭), 작아지는 쪽 = 시작(옮김) — S-scan 점선과 같은 규칙
 *   - 눈금자 끌기 = 그 구간으로 확대 (6 px 미만은 클릭으로 무시), 더블클릭 = 그 축 초기화, Esc = 끌기 취소, 끄는 동안 Ctrl/Cmd+Z 는 무시
 *   - 커서: 다이아몬드 ±6 px 위 = ns/ew-resize, 확대가 있는 눈금자의 나머지 = row/col-resize, 다이아몬드뿐인 눈금자(S-scan 깊이)의 나머지 = 기본
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { gateEdgeByMove, gateEdgeGrab } from '@shared/imaging'
import { blockUndoWhileDragging } from './canvas'

const STEPS = [1, 2, 5]

/** 눈금 간격: 최소 minPx 픽셀 이상 떨어지는 1·2·5×10ⁿ */
export function niceStep(span: number, length: number, minPx: number): number {
  if (!(span > 0) || !(length > 0)) return 1
  const raw = (span * minPx) / length
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const s of STEPS) if (s * p >= raw) return s * p
  return 10 * p
}

export function ticks(from: number, to: number, length: number, minPx: number): number[] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const step = niceStep(hi - lo, length, minPx)
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step)
  return out
}

/** 눈금 숫자: 음수는 앱 전체처럼 '−'(U+2212) */
export function label(v: number): string {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r).replace('-', '−')
}

/** 단위 붙이기: mm 는 한 칸 띄우고 °·% 는 붙인다 (lib/format 과 같은 규칙). 단위가 없으면(빔 번호 축) 숫자만 */
export function withUnit(text: string, unit: string): string {
  if (!unit) return text
  return unit === '°' || unit === '%' ? `${text}${unit}` : `${text} ${unit}`
}

/** 왼쪽 축(48 px, app.css `.vplot` 첫 열과 같아야 함)에 단위까지 넣을 수 있는 글자 수 (12 px 숫자 기준 '10 mm' ≈ 38.5 px) */
const LEFT_UNIT_MAX_CHARS = 5
export const AXIS_LEFT_WIDTH = 48
export const AXIS_BOTTOM_HEIGHT = 20
export const AXIS_MIN_PX_LEFT = 28
export const AXIS_MIN_PX_BOTTOM = 56
/** 다이아몬드 반지름(px)·잡는 범위(px)·끌기로 인정하는 최소 거리(px) */
const MARKER_R = 4
const MARKER_HIT = 6
const DRAG_MIN = 6

export type AxisMarkerKind = 'gate-start' | 'gate-end' | 'threshold'

export interface AxisMarker {
  id: string
  kind: AxisMarkerKind
  value: number
  title?: string
  /** 누르는 순간 (예: 그 S-scan 의 그룹을 활성으로) — 움직이지 않은 클릭에도 부른다 */
  onGrab?: () => void
  /** 끌기 중 (값은 축 단위) */
  onDrag?: (value: number) => void
  /** 손을 뗄 때 (마지막 값). 움직이지 않은 클릭에는 부르지 않는다 */
  onDragEnd?: (value: number) => void
  /** Esc 로 끌기를 취소할 때 — 끌기 중 보여 준 값을 버린다 */
  onDragCancel?: () => void
}

/** 눈금자 조작 묶음: 없으면 눈금만 그린다 */
export interface AxisInteraction {
  markers?: AxisMarker[]
  /** 끌어서 고른 구간 (작은 값, 큰 값) */
  onRange?: (lo: number, hi: number) => void
  /** 더블클릭 */
  onReset?: () => void
}

type Drag =
  | {
      kind: 'marker'
      marker: AxisMarker
      /** 겹친 게이트 끝 다이아몬드: 첫 움직임이 값이 커지는 쪽이면 이것으로 바꾼다 (그때까지 marker = 시작) */
      tieEnd: AxisMarker | null
      last: number
      startPx: number
      moved: boolean
    }
  | { kind: 'range'; startPx: number; curPx: number }

/**
 * 누른 자리(px)에서 잡을 다이아몬드: 잡는 범위 안 후보 중 가장 가까운 것. 게이트 시작·끝이 둘 다 안이면 shared/imaging gateEdgeGrab
 * (S-scan 점선과 같은 규칙) — 거리 차가 1 px 미만이면 tieEnd 를 두고 첫 움직임으로 정한다. 후보가 없으면 null
 */
export function pickAxisMarker(markers: readonly AxisMarker[], posOf: (value: number) => number, px: number, hitPx = MARKER_HIT): { marker: AxisMarker; tieEnd: AxisMarker | null } | null {
  const near = markers.filter((m) => (m.onDrag || m.onDragEnd) && Math.abs(posOf(m.value) - px) <= hitPx)
  if (near.length === 0) return null
  const dist = (m: AxisMarker): number => Math.abs(posOf(m.value) - px)
  const start = near.find((m) => m.kind === 'gate-start')
  const end = near.find((m) => m.kind === 'gate-end')
  if (start && end) {
    const g = gateEdgeGrab(dist(start), dist(end), hitPx)!
    if (g.tie) return { marker: start, tieEnd: end }
    return { marker: g.edge === 'start' ? start : end, tieEnd: null }
  }
  return { marker: near.reduce((a, m) => (dist(m) < dist(a) ? m : a)), tieEnd: null }
}

export function Axis(props: {
  orientation: 'left' | 'bottom'
  from: number
  to: number
  length: number
  unit?: string
  /** 축 이름 (화면 읽기용) */
  title: string
  interaction?: AxisInteraction
  /** 다이아몬드 색 (영상 안 게이트 색과 같게) */
  markerColor?: string
}) {
  const { orientation, from, to, length, interaction } = props
  const ref = useRef<SVGSVGElement>(null)
  // 끌기 상태의 기준은 ref (같은 틱에 연달아 오는 pointerdown/move/up 이 렌더 전에도 보이게). state 는 그리기용
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null): void => {
    dragRef.current = d
    setDragState(d)
  }
  /** 끌기 없이 포인터가 다이아몬드 잡는 범위 안에 있는가 (커서) */
  const [overMarker, setOverMarker] = useState(false)
  const horizontal = orientation === 'bottom'
  const pos = (v: number): number => ((v - from) / (to - from)) * length
  const valueAt = (px: number): number => from + (px / length) * (to - from)

  const pointerPx = (e: ReactPointerEvent<SVGSVGElement> | PointerEvent): number => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return 0
    return horizontal ? e.clientX - r.left : e.clientY - r.top
  }

  // Esc 로 끌기 취소: 범위 선택은 버리고, 다이아몬드는 onDragCancel 로 보여 주던 값을 되돌린다.
  // 끄는 동안 Ctrl/Cmd+Z 는 삼킨다 (다이아몬드 onDrag 는 잡을 때의 게이트 시작 값·base 로 계산 — 도중 되돌리기면 끝이 포인터에서 떨어짐)
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const d = dragRef.current
      setDrag(null)
      if (d?.kind === 'marker') d.marker.onDragCancel?.()
    }
    window.addEventListener('keydown', onKey)
    const unblock = blockUndoWhileDragging()
    return () => {
      window.removeEventListener('keydown', onKey)
      unblock()
    }
  }, [dragging])
  // 끄는 중에 눈금자가 사라지면(레이아웃·그룹 전환) 다이아몬드 초안을 남기지 않는다
  useEffect(
    () => () => {
      const d = dragRef.current
      dragRef.current = null
      if (d?.kind === 'marker') d.marker.onDragCancel?.()
    },
    []
  )

  if (!(length > 0) || from === to) return <div className={`vaxis vaxis--${orientation}`} />
  const ts = ticks(from, to, length, horizontal ? AXIS_MIN_PX_BOTTOM : AXIS_MIN_PX_LEFT)
  const unit = props.unit ?? 'mm'
  const markers = interaction?.markers ?? []
  /** 구간 끌기 확대·더블클릭 초기화가 있는 눈금자 (S-scan 깊이 눈금자는 다이아몬드뿐) */
  const zoomable = !!interaction && (!!interaction.onRange || !!interaction.onReset)
  const interactive = zoomable || markers.length > 0

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!interactive || e.button !== 0) return
    const px = pointerPx(e)
    const hit = pickAxisMarker(markers, pos, px)
    // 다이아몬드도 확대도 없는 자리(다이아몬드뿐인 눈금자의 빈 곳): 아무것도 하지 않는다 (포인터 캡처·기본 동작 막기 없이)
    if (!hit && !interaction?.onRange) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 합성 이벤트(점검 스크립트)에서는 던진다 — 끌기에 영향 없음
    }
    e.preventDefault()
    if (hit) {
      setDrag({ kind: 'marker', marker: hit.marker, tieEnd: hit.tieEnd, last: hit.marker.value, startPx: px, moved: false })
      hit.marker.onGrab?.()
    } else setDrag({ kind: 'range', startPx: px, curPx: px })
  }
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    const px = pointerPx(e)
    if (!d) {
      // 올려 두기: 다이아몬드 잡는 범위 안이면 끄는 커서 (바뀔 때만 state)
      const over = e.buttons === 0 && pickAxisMarker(markers, pos, px) !== null
      if (over !== overMarker) setOverMarker(over)
      return
    }
    if (d.kind === 'marker') {
      // 1 px 도 안 움직인 떨림은 클릭으로 본다
      if (!d.moved && Math.abs(px - d.startPx) < 1) return
      // 겹친 시작·끝: 첫 움직임에서 정한다 (값이 커지면 끝 = 폭을 넓힘, 작아지면 시작 = 옮김)
      const marker = d.tieEnd && gateEdgeByMove(valueAt(d.startPx), valueAt(px)) === 'end' ? d.tieEnd : d.marker
      const v = valueAt(Math.max(0, Math.min(length, px)))
      marker.onDrag?.(v)
      setDrag({ ...d, marker, tieEnd: null, last: v, moved: true })
    } else setDrag({ ...d, curPx: px })
  }
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    if (!d) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 캡처가 없으면 무시
    }
    setDrag(null)
    if (d.kind === 'marker') {
      // 움직이지 않은 클릭은 아무것도 바꾸지 않는다 (파일 게이트가 '조정됨' 이 되지 않게)
      if (d.moved) d.marker.onDragEnd?.(d.last)
      else d.marker.onDragCancel?.()
      return
    }
    const a = Math.max(0, Math.min(length, d.startPx))
    const b = Math.max(0, Math.min(length, pointerPx(e)))
    if (Math.abs(b - a) < DRAG_MIN) return
    const v0 = valueAt(a)
    const v1 = valueAt(b)
    interaction?.onRange?.(Math.min(v0, v1), Math.max(v0, v1))
  }
  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    // 다이아몬드 위에서의 더블클릭은 축 초기화가 아니다
    const px = pointerPx(e as unknown as PointerEvent)
    if (markers.some((m) => Math.abs(pos(m.value) - px) <= MARKER_HIT)) return
    interaction?.onReset?.()
  }

  const markerCursor = horizontal ? 'ew-resize' : 'ns-resize'
  const cursor = drag
    ? drag.kind === 'marker'
      ? markerCursor
      : 'crosshair'
    : overMarker
      ? markerCursor
      : zoomable
        ? horizontal
          ? 'col-resize'
          : 'row-resize'
        : undefined
  const markerColor = props.markerColor ?? '#e03030'
  const band =
    drag && drag.kind === 'range' && Math.abs(drag.curPx - drag.startPx) >= DRAG_MIN
      ? { lo: Math.max(0, Math.min(length, Math.min(drag.startPx, drag.curPx))), hi: Math.max(0, Math.min(length, Math.max(drag.startPx, drag.curPx))) }
      : null
  const diamond = (m: AxisMarker): string => {
    const p = pos(m.value)
    if (p < -MARKER_R || p > length + MARKER_R) return ''
    const c = horizontal ? AXIS_BOTTOM_HEIGHT / 2 : AXIS_LEFT_WIDTH - MARKER_R - 2
    const [x, y] = horizontal ? [p, c] : [c, p]
    return `${x},${y - MARKER_R} ${x + MARKER_R},${y} ${x},${y + MARKER_R} ${x - MARKER_R},${y}`
  }
  const onPointerLeave = (): void => {
    if (overMarker) setOverMarker(false)
  }
  const handlers = interactive ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onPointerLeave, onDoubleClick } : {}
  // 화면 읽기 안내는 이 눈금자에 있는 조작만 (S-scan 깊이 눈금자는 다이아몬드뿐)
  const hints = [interaction?.onRange ? '끌어서 확대' : '', interaction?.onReset ? '더블클릭으로 초기화' : '', markers.length ? '빨간 표시를 끌어 게이트 조정' : ''].filter(Boolean)
  const aria = `${props.title} ${label(from)}~${withUnit(label(to), unit)}${hints.length ? ` (${hints.join(', ')})` : ''}`

  if (orientation === 'left') {
    return (
      <svg ref={ref} className={`vaxis vaxis--left${interactive ? ' is-interactive' : ''}`} width={AXIS_LEFT_WIDTH} height={length} role="img" aria-label={aria} style={cursor ? { cursor } : undefined} {...handlers}>
        {band ? <rect className="vaxis__band" x={0} y={band.lo} width={AXIS_LEFT_WIDTH} height={band.hi - band.lo} /> : null}
        {ts.map((v, i) => {
          // 첫 눈금에만 단위. 길어서 칸을 넘으면 숫자만 (단위는 화면 읽기 이름과 측정값 줄에 있다)
          const t = i === 0 ? withUnit(label(v), unit) : label(v)
          return (
            <g key={v} transform={`translate(0 ${pos(v)})`}>
              <line x1="42" x2="48" y1="0" y2="0" />
              <text x="39" y="0" dy="0.35em" textAnchor="end">
                {t.length <= LEFT_UNIT_MAX_CHARS ? t : label(v)}
              </text>
            </g>
          )
        })}
        {markers.map((m) => (
          <polygon key={m.id} className="vaxis__marker" points={diamond(m)} fill={markerColor} data-kind={m.kind}>
            {m.title ? <title>{m.title}</title> : null}
          </polygon>
        ))}
      </svg>
    )
  }
  return (
    <svg ref={ref} className={`vaxis vaxis--bottom${interactive ? ' is-interactive' : ''}`} width={length} height={AXIS_BOTTOM_HEIGHT} role="img" aria-label={aria} style={cursor ? { cursor } : undefined} {...handlers}>
      {band ? <rect className="vaxis__band" x={band.lo} y={0} width={band.hi - band.lo} height={AXIS_BOTTOM_HEIGHT} /> : null}
      {ts.map((v, i) => (
        <g key={v} transform={`translate(${pos(v)} 0)`}>
          <line x1="0" x2="0" y1="0" y2="5" />
          <text x="0" y="17" textAnchor={i === 0 && pos(v) < 24 ? 'start' : 'middle'}>
            {i === 0 ? withUnit(label(v), unit) : label(v)}
          </text>
        </g>
      ))}
      {markers.map((m) => (
        <polygon key={m.id} className="vaxis__marker" points={diamond(m)} fill={markerColor} data-kind={m.kind}>
          {m.title ? <title>{m.title}</title> : null}
        </polygon>
      ))}
    </svg>
  )
}
