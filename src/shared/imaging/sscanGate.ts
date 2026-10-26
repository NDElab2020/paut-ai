/**
 * S-scan 영상 위 게이트 선(C-scan 게이트 A 의 시작·끝 점선) 끌기 — 순수 계산 (계획_후처리.md 2b 의 영상 쪽 보조 수단).
 *   선: TrueDepth = 현재 빔 깊이의 수평선(V 창 전체), 그 밖(SoundPath) = 빔마다 같은 음로 점을 빔 번호 순서로 이은 선.
 *       SscanView 가 그리는 선과 잡기 판정이 같은 함수(sscanGateLine)를 쓴다.
 *   잡기: 포인터에서 선까지 CSS px 거리 ≤ 6 (눈금자 다이아몬드와 같은 감각). 캔버스 버퍼는 요소 전체로 늘어나 보이므로
 *         mm 창과 요소의 CSS 크기만 쓴다 — devicePixelRatio·pixelRatio 와 무관.
 *   값: TrueDepth = 포인터 깊이, SoundPath = 포인터 아래 빔(이웃 두 빔 보간)의 출사점 E_b 에서 r = |P − E_b|.
 *   뜻(다이아몬드와 같음): 시작 = 폭 유지하고 옮김(startMm 만), 끝 = 폭 바꿈(lengthMm 만). 시작 ≥ 0, 폭 ≥ 0.1 mm (리듀서 setGate 와 같은 규칙).
 */
import { DEG, beamPoint, skewSign, soundPathMm } from './coords'
import type { GateOverride } from './postprocess'
import { viewportPixel, type SscanViewport } from './sscan'
import type { ViewerGate, ViewerGroup } from './types'

/** 선을 잡는 반경 (CSS px) — Axis 다이아몬드와 같다 */
export const SSCAN_GATE_HIT_PX = 6
/** 이만큼(CSS px) 움직여야 끌기, 그보다 짧으면 클릭(빔 고르기) */
export const SSCAN_GATE_DRAG_MIN_PX = 6
/** 게이트 폭 최소 (mm) — 리듀서 setGate 와 같은 값 */
export const GATE_MIN_LENGTH_MM = 0.1
/**
 * 시작·끝(점선·눈금자 다이아몬드)이 둘 다 잡는 범위 안이고 포인터에서 두 선까지 거리 차가 이보다 작으면(CSS px — 폭이 좁아 겹침)
 * 누른 자리로 정하지 않고 첫 움직임 방향으로 정한다 (gateEdgeByMove). 폭 0.1 mm 는 S-scan 눈금자에서 1 px 도 안 된다
 */
export const GATE_EDGE_TIE_PX = 1

export type GateEdge = 'start' | 'end'

export interface InspectionPoint {
  vMm: number
  depthMm: number
}

type Beams = Pick<ViewerGroup, 'beams'>
type GateGeom = Pick<ViewerGate, 'geometry' | 'startUs' | 'lengthUs'>
/** 지금 그리는 mm 창 (SscanViewport 의 width·height 는 쓰지 않는다) */
type MmView = Pick<SscanViewport, 'vMinMm' | 'vMaxMm' | 'depthMinMm' | 'depthMaxMm'>

/** TrueDepth 면 깊이 단위, 그 밖은 음로 단위 (gateDisplayValues 와 같은 구분) */
export function isDepthGate(gate: Pick<ViewerGate, 'geometry'>): boolean {
  return gate.geometry === 'TrueDepth'
}

/** 빔 b 의 게이트 시작·끝 시각 (µs). 배열이 짧으면(시간 하나로 저장된 게이트) 첫 값 */
function edgeTimeUs(gate: GateGeom, b: number, edge: GateEdge): number {
  const st = gate.startUs[b] ?? gate.startUs[0] ?? 0
  const ln = gate.lengthUs[b] ?? gate.lengthUs[0] ?? 0
  return edge === 'start' ? st : st + ln
}

/** 빔 b 에서 게이트 선이 지나는 점 (검사 좌표). 빔이 없으면 null */
export function gateEdgePoint(group: Beams, gate: GateGeom, b: number, edge: GateEdge): InspectionPoint | null {
  const beam = group.beams[b]
  if (!beam) return null
  return beamPoint(beam, soundPathMm(beam, edgeTimeUs(gate, b, edge)))
}

/**
 * S-scan 위 게이트 선 (검사 좌표 꺾은선). TrueDepth = 빔 beam(현재 빔) 깊이의 수평선 [vRange 왼쪽 끝, 오른쪽 끝],
 * 그 밖 = 모든 빔의 같은 시각 점을 빔 번호 순서로 이은 선. 빔이 없으면 빈 배열
 */
export function sscanGateLine(group: Beams, gate: GateGeom, edge: GateEdge, beam: number, vRange: readonly [number, number]): InspectionPoint[] {
  if (isDepthGate(gate)) {
    const p = gateEdgePoint(group, gate, beam, edge)
    return p
      ? [
          { vMm: vRange[0], depthMm: p.depthMm },
          { vMm: vRange[1], depthMm: p.depthMm }
        ]
      : []
  }
  const out: InspectionPoint[] = []
  for (let b = 0; b < group.beams.length; b++) out.push(gateEdgePoint(group, gate, b, edge)!)
  return out
}

/** 캔버스 요소 안 CSS px → 검사 좌표 (요소 왼쪽 위 = (vMin, depthMin), 선형) */
export function sscanPointAtCss(view: MmView, cssWidth: number, cssHeight: number, x: number, y: number): InspectionPoint {
  return {
    vMm: view.vMinMm + (x / cssWidth) * (view.vMaxMm - view.vMinMm),
    depthMm: view.depthMinMm + (y / cssHeight) * (view.depthMaxMm - view.depthMinMm)
  }
}

/** 점 (x, y) 에서 꺾은선까지 거리 (같은 단위). 점이 하나면 그 점까지, 없으면 ∞ */
export function distanceToPolyline(pts: ReadonlyArray<{ x: number; y: number }>, x: number, y: number): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(x - pts[0]!.x, y - pts[0]!.y)
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)))
  }
  return best
}

/**
 * 검사 좌표 P 의 '포인터 아래 빔': 빔 축에서 P 의 옆 거리(부호, 빔 방향에 수직)가 바뀌는 이웃 빔 쌍 (b0, b1) 과 b1 쪽 가중치 w.
 * 빔 번호 순서로 옆 거리가 단조인 섹토리얼(부채꼴)·리니어(평행)·컴파운드 모두 같은 식이다.
 * 어느 쌍도 부호가 바뀌지 않으면(부채꼴 밖) 옆 거리가 가장 작은 빔 하나 (b0 = b1, w = 0). 빔이 없으면 null
 */
export function beamsAtPoint(group: Beams, p: InspectionPoint): { b0: number; b1: number; w: number } | null {
  const nb = group.beams.length
  if (nb === 0) return null
  const side = new Float64Array(nb)
  for (let b = 0; b < nb; b++) {
    const beam = group.beams[b]!
    const s = skewSign(beam.skewDeg) ?? 1
    const th = beam.angleDeg * DEG
    // 빔 방향 (V, 깊이) = (s·sinθ, cosθ), 출사점 E = (V_b, 0). 옆 거리 = (P − E) × 방향
    side[b] = (p.vMm - beam.vOffsetMm) * Math.cos(th) - p.depthMm * s * Math.sin(th)
  }
  let best: { b0: number; b1: number; w: number } | null = null
  let bestScore = Infinity
  for (let b = 0; b + 1 < nb; b++) {
    const a = side[b]!
    const c = side[b + 1]!
    if ((a <= 0 && c >= 0) || (a >= 0 && c <= 0)) {
      // 빔이 엇갈리는 이상한 배치에서 쌍이 여럿이면 축에 가장 가까운 쌍
      const score = Math.min(Math.abs(a), Math.abs(c))
      if (score < bestScore) {
        bestScore = score
        best = { b0: b, b1: b + 1, w: a === c ? 0 : a / (a - c) }
      }
    }
  }
  if (best) return best
  let bi = 0
  for (let b = 1; b < nb; b++) if (Math.abs(side[b]!) < Math.abs(side[bi]!)) bi = b
  return { b0: bi, b1: bi, w: 0 }
}

/** 출사점 E_b 에서 P 까지 거리 (mm) */
function rangeFromExit(group: Beams, b: number, p: InspectionPoint): number {
  const beam = group.beams[b]!
  return Math.hypot(p.vMm - beam.vOffsetMm, p.depthMm)
}

/** 포인터 값 (게이트 사용자 단위 mm): TrueDepth = 깊이, SoundPath = 포인터 아래 빔들의 출사점에서 |P − E_b| (이웃 두 빔 가중 평균) */
export function sscanGateValueAt(group: Beams, gate: Pick<ViewerGate, 'geometry'>, p: InspectionPoint): number {
  if (isDepthGate(gate)) return p.depthMm
  const at = beamsAtPoint(group, p)
  if (!at) return 0
  const r0 = rangeFromExit(group, at.b0, p)
  return at.w === 0 ? r0 : (1 - at.w) * r0 + at.w * rangeFromExit(group, at.b1, p)
}

/**
 * 게이트 선의 값 (사용자 단위 mm): TrueDepth = 빔 beam(현재 빔)에서의 깊이, SoundPath = 포인터 p 아래 빔들의 음로
 * (sscanGateValueAt 과 같은 가중치, p 가 없으면 빔 beam 의 음로)
 */
export function sscanGateEdgeValue(group: Beams, gate: GateGeom, edge: GateEdge, beam: number, p?: InspectionPoint): number {
  if (isDepthGate(gate)) return gateEdgePoint(group, gate, beam, edge)?.depthMm ?? 0
  const r = (b: number): number => {
    const bm = group.beams[b]
    return bm ? soundPathMm(bm, edgeTimeUs(gate, b, edge)) : 0
  }
  const at = p ? beamsAtPoint(group, p) : null
  if (!at) return r(beam)
  return at.w === 0 ? r(at.b0) : (1 - at.w) * r(at.b0) + at.w * r(at.b1)
}

/**
 * 끌기 → 게이트 override 패치 (다이아몬드와 같은 뜻). gate 는 잡을 때의 게이트(초안 전), p 는 포인터 검사 좌표.
 *   시작: startMm = 포인터 값 (폭은 손대지 않음 → applyGateOverride 가 빔마다 폭 유지), ≥ 0
 *   끝:   lengthMm = 포인터 값 − 그 자리의 시작 값 (그 빔에서 끝 선이 포인터를 지나게), ≥ 0.1 mm
 */
export function sscanGateDragPatch(group: Beams, gate: GateGeom, edge: GateEdge, beam: number, p: InspectionPoint): GateOverride {
  const v = sscanGateValueAt(group, gate, p)
  if (edge === 'start') return { startMm: Math.max(0, v) }
  const st = sscanGateEdgeValue(group, gate, 'start', beam, p)
  return { lengthMm: Math.max(GATE_MIN_LENGTH_MM, v - st) }
}

/** S-scan 캔버스 위 포인터 (요소 안 CSS px) 와 그 요소 */
export interface SscanGatePointer {
  group: Beams
  gate: GateGeom
  /** 현재 빔 (TrueDepth 선의 기준) */
  beam: number
  /** 지금 그리는 mm 창 */
  view: MmView
  /** 캔버스 요소의 CSS 크기 (getBoundingClientRect) */
  cssWidth: number
  cssHeight: number
  /** 포인터 (요소 왼쪽 위 기준 CSS px) */
  x: number
  y: number
}

/**
 * 겹친 시작·끝을 첫 움직임으로 정한다 (눈금자 다이아몬드·S-scan 점선 공통): 게이트 값이 커지는 쪽(깊게) = 끝 = 폭을 넓힘,
 * 작아지는(얕게) 쪽 = 시작 = 폭을 유지하고 옮김. 값은 게이트 사용자 단위(TrueDepth 깊이·SoundPath 음로) 또는 눈금자 값
 */
export function gateEdgeByMove(valueAtPress: number, valueNow: number): GateEdge {
  return valueNow > valueAtPress ? 'end' : 'start'
}

/** 두 손잡이까지 거리(px)로 고르기: 범위 밖이면 null, 하나만 안이면 그것, 둘 다 안이면 가까운 것 + 거리 차 < GATE_EDGE_TIE_PX 면 tie */
export function gateEdgeGrab(distStart: number, distEnd: number, radiusPx: number): { edge: GateEdge; tie: boolean } | null {
  const okStart = distStart <= radiusPx
  const okEnd = distEnd <= radiusPx
  if (!okStart && !okEnd) return null
  if (okStart !== okEnd) return { edge: okStart ? 'start' : 'end', tie: false }
  return { edge: distStart <= distEnd ? 'start' : 'end', tie: Math.abs(distStart - distEnd) < GATE_EDGE_TIE_PX }
}

/**
 * 포인터가 게이트 시작·끝 선을 잡는가 (반경 radiusPx CSS px). 요소 밖이면 null.
 * 둘 다 반경 안이면(폭이 좁음) 포인터 값이 두 선 가운데보다 깊으면(멀면) 끝, 아니면 시작. 두 선까지 거리 차가 GATE_EDGE_TIE_PX 미만이면
 * tie = true — 끌 때(SscanView) 첫 움직임 방향으로 다시 정한다 (gateEdgeByMove: 깊게 = 끝, 얕게 = 시작). 폭이 0 에 가까워도 둘 다 잡을 수 있게
 */
export function hitSscanGateDetail(q: SscanGatePointer, radiusPx = SSCAN_GATE_HIT_PX): { edge: GateEdge; tie: boolean } | null {
  const { cssWidth: W, cssHeight: H, x, y, view } = q
  if (!(W > 0) || !(H > 0) || x < 0 || y < 0 || x > W || y > H) return null
  const vp: SscanViewport = { ...view, width: W, height: H }
  const dist = (edge: GateEdge): number =>
    distanceToPolyline(
      sscanGateLine(q.group, q.gate, edge, q.beam, [view.vMinMm, view.vMaxMm]).map((p) => viewportPixel(vp, p.vMm, p.depthMm)),
      x,
      y
    )
  const ds = dist('start')
  const de = dist('end')
  const g = gateEdgeGrab(ds, de, radiusPx)
  if (!g || !(ds <= radiusPx && de <= radiusPx)) return g
  const p = sscanPointAtCss(view, W, H, x, y)
  const mid = (sscanGateEdgeValue(q.group, q.gate, 'start', q.beam, p) + sscanGateEdgeValue(q.group, q.gate, 'end', q.beam, p)) / 2
  return { edge: sscanGateValueAt(q.group, q.gate, p) > mid ? 'end' : 'start', tie: g.tie }
}

/** hitSscanGateDetail 의 선만 (올려 두기 커서·툴팁) */
export function hitSscanGate(q: SscanGatePointer, radiusPx = SSCAN_GATE_HIT_PX): GateEdge | null {
  return hitSscanGateDetail(q, radiusPx)?.edge ?? null
}

/** 끌기 중 포인터 → 패치. 요소 밖이면 가장자리로 자른다 (눈금자 다이아몬드와 같음 — 보이는 범위 밖으로 날아가지 않게) */
export function sscanGateDragPatchAt(q: SscanGatePointer, edge: GateEdge): GateOverride {
  const x = Math.max(0, Math.min(q.cssWidth, q.x))
  const y = Math.max(0, Math.min(q.cssHeight, q.y))
  return sscanGateDragPatch(q.group, q.gate, edge, q.beam, sscanPointAtCss(q.view, q.cssWidth, q.cssHeight, x, y))
}
