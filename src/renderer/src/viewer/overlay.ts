/**
 * 라벨 모드 덮개 — 영상 위 상자·점·선 (라벨 모드에서만 그린다: 계획_라벨링/계획.md 6절 결정 6 (가), 디자인 '영상 위 덮개 금지'의 예외).
 * 좌표는 뷰 축 단위 (shared/imaging viewport.ts):
 *   S-scan (V mm, 펼친 깊이 mm) · C-scan (스캔 U mm, 빔 번호 실수) · B-scan (스캔 U mm, 펼친 깊이 mm) · A-scan (진폭 %, 펼친 깊이 mm)
 * 덮개가 없거나 비면 아무것도 그리지 않는다 (ctx 를 건드리지도 않음) → 보통 모드 그림은 바이트 단위로 같다.
 * 순수 TS (React·DOM 없음): 최소 캔버스 인터페이스(OverlayCanvas)만 써서 tests/labeling 에서 기록용 가짜 ctx 로 위치를 검사한다.
 */
import { CANVAS_FONT, CANVAS_FONT_PX, type LabelTone, type LabelToneStyle } from './canvas'

export type OverlayTone = LabelTone

/** 상자·띠·구간. 축 값이 null 이면 그 방향 전체 (예: C-scan 검토 구간 = 스캔 범위 × 모든 빔) */
export interface OverlayRect {
  id: string
  tone: OverlayTone
  x0: number | null
  x1: number | null
  y0: number | null
  y1: number | null
  /** 상자 왼쪽 위에 쓰는 짧은 글자 (예: 지시 번호) */
  label?: string
}

/** 점 (팁·최대 진폭 점 등) */
export interface OverlayPoint {
  id: string
  tone: OverlayTone
  x: number
  y: number
  /** 기본 'cross' */
  shape?: 'cross' | 'diamond' | 'circle'
  label?: string
}

/** 축에 수직인 선: vline = 가로축 값 value 의 세로선, hline = 세로축 값의 가로선. from·to = 다른 축 방향 범위 (없으면 전체) */
export interface OverlayLine {
  id: string
  tone: OverlayTone
  value: number
  from?: number
  to?: number
  label?: string
}

/** 뷰 하나의 덮개 */
export interface ViewOverlay {
  rects?: readonly OverlayRect[]
  points?: readonly OverlayPoint[]
  vlines?: readonly OverlayLine[]
  hlines?: readonly OverlayLine[]
}

export function isEmptyOverlay(o: ViewOverlay | null | undefined): boolean {
  return !o || (!o.rects?.length && !o.points?.length && !o.vlines?.length && !o.hlines?.length)
}

/** 덮개 합치기 (뒤 것이 위에 그려진다). 모두 비면 undefined — 뷰가 그리지 않게 */
export function mergeOverlays(...list: Array<ViewOverlay | null | undefined>): ViewOverlay | undefined {
  const parts = list.filter((o): o is ViewOverlay => !isEmptyOverlay(o))
  if (parts.length === 0) return undefined
  if (parts.length === 1) return parts[0]
  return {
    rects: parts.flatMap((o) => o.rects ?? []),
    points: parts.flatMap((o) => o.points ?? []),
    vlines: parts.flatMap((o) => o.vlines ?? []),
    hlines: parts.flatMap((o) => o.hlines ?? [])
  }
}

/** 뷰 축 값 → 캔버스 버퍼 px (선형). width·height = 캔버스 버퍼 크기 */
export interface OverlayMap {
  x: (value: number) => number
  y: (value: number) => number
  width: number
  height: number
}

/** drawOverlay 가 쓰는 캔버스 기능만 (CanvasRenderingContext2D 의 부분) */
export interface OverlayCanvas {
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
  rect(x: number, y: number, w: number, h: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  setLineDash(segments: number[]): void
  fillText(text: string, x: number, y: number): void
}

/** 점 표시 반지름 (CSS px) */
export const OVERLAY_POINT_R = 5

/**
 * 덮개를 그린다 (뷰의 기존 선 다음, 맨 위). 순서: 띠·상자 채움 → 상자 선 → 선 → 점 → 글자.
 * ratio = 캔버스 버퍼 px / CSS px (선 굵기·점 크기·글자를 CSS px 기준으로 맞춤). 덮개가 비면 ctx 를 건드리지 않는다
 */
export function drawOverlay(ctx: OverlayCanvas, overlay: ViewOverlay | null | undefined, map: OverlayMap, styles: Record<OverlayTone, LabelToneStyle>, ratio: number): void {
  if (!overlay || isEmptyOverlay(overlay)) return
  const lw = Math.max(1, ratio)
  const X = (v: number | null, end: boolean): number => (v === null ? (end ? map.width : 0) : map.x(v))
  const Y = (v: number | null, end: boolean): number => (v === null ? (end ? map.height : 0) : map.y(v))
  const dash = (s: LabelToneStyle): void => ctx.setLineDash(s.dashed ? [5 * lw, 3 * lw] : [])
  const width = (tone: OverlayTone): number => (tone === 'selected' ? 2.5 * lw : 1.5 * lw)
  ctx.save()
  ctx.font = `${CANVAS_FONT_PX * ratio}px ${CANVAS_FONT}`
  ctx.textAlign = 'left'
  const labels: Array<{ text: string; x: number; y: number; color: string }> = []

  const rects = overlay.rects ?? []
  const box = (r: OverlayRect): [number, number, number, number] => {
    const xa = X(r.x0, false)
    const xb = X(r.x1, true)
    const ya = Y(r.y0, false)
    const yb = Y(r.y1, true)
    return [Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya)]
  }
  for (const r of rects) {
    const s = styles[r.tone]
    if (!s.fill) continue
    const [x, y, w, h] = box(r)
    ctx.fillStyle = s.fill
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.fill()
  }
  for (const r of rects) {
    const s = styles[r.tone]
    const [x, y, w, h] = box(r)
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = width(r.tone)
    dash(s)
    ctx.beginPath()
    // 한쪽이 '전체' 인 띠는 열린 쪽(캔버스 끝)에 선을 긋지 않는다
    if (r.y0 === null && r.y1 === null) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, map.height)
      ctx.moveTo(x + w, 0)
      ctx.lineTo(x + w, map.height)
    } else if (r.x0 === null && r.x1 === null) {
      ctx.moveTo(0, y)
      ctx.lineTo(map.width, y)
      ctx.moveTo(0, y + h)
      ctx.lineTo(map.width, y + h)
    } else ctx.rect(x, y, w, h)
    ctx.stroke()
    if (r.label) labels.push({ text: r.label, x: x + 3 * ratio, y: y + (CANVAS_FONT_PX + 1) * ratio, color: s.stroke })
  }

  for (const [list, vertical] of [
    [overlay.vlines ?? [], true],
    [overlay.hlines ?? [], false]
  ] as const) {
    for (const l of list) {
      const s = styles[l.tone]
      ctx.strokeStyle = s.stroke
      ctx.lineWidth = width(l.tone)
      dash(s)
      ctx.beginPath()
      if (vertical) {
        const x = Math.round(map.x(l.value)) + 0.5
        ctx.moveTo(x, l.from === undefined ? 0 : map.y(l.from))
        ctx.lineTo(x, l.to === undefined ? map.height : map.y(l.to))
        if (l.label) labels.push({ text: l.label, x: x + 3 * ratio, y: (CANVAS_FONT_PX + 1) * ratio, color: s.stroke })
      } else {
        const y = Math.round(map.y(l.value)) + 0.5
        ctx.moveTo(l.from === undefined ? 0 : map.x(l.from), y)
        ctx.lineTo(l.to === undefined ? map.width : map.x(l.to), y)
        if (l.label) labels.push({ text: l.label, x: 3 * ratio, y: y - 3 * ratio, color: s.stroke })
      }
      ctx.stroke()
    }
  }

  const pr = OVERLAY_POINT_R * ratio
  for (const p of overlay.points ?? []) {
    const s = styles[p.tone]
    const x = map.x(p.x)
    const y = map.y(p.y)
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = width(p.tone)
    ctx.setLineDash([])
    ctx.beginPath()
    const shape = p.shape ?? 'cross'
    if (shape === 'circle') ctx.arc(x, y, pr, 0, Math.PI * 2)
    else if (shape === 'diamond') {
      ctx.moveTo(x, y - pr)
      ctx.lineTo(x + pr, y)
      ctx.lineTo(x, y + pr)
      ctx.lineTo(x - pr, y)
      ctx.closePath()
    } else {
      ctx.moveTo(x - pr, y)
      ctx.lineTo(x + pr, y)
      ctx.moveTo(x, y - pr)
      ctx.lineTo(x, y + pr)
    }
    ctx.stroke()
    if (p.label) labels.push({ text: p.label, x: x + pr + 2 * ratio, y: y - 2 * ratio, color: s.stroke })
  }

  for (const t of labels) {
    ctx.fillStyle = t.color
    ctx.fillText(t.text, t.x, t.y)
  }
  ctx.restore()
}
