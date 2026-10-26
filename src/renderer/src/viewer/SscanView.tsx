/**
 * S-scan 패널: 부채꼴(펼친 깊이) + 덮개(스킵선·개선·CL·게이트 A·현재 빔). 클릭하면 그 빔으로.
 * 라이트 테마 외곽선·개선 덮개 클립은 조회표와 같은 데이터 경계(sscanOutline — 컴파운드·리니어 톱니 포함)를 쓴다.
 * 범위(후처리): 깊이 창은 뷰어 공통, V 창은 그룹별 (props.range 로 합쳐져 들어온다).
 *   조회표(buildSscanMap — 600×450 12 ms, 레티나 상한 1460×1095 약 70 ms, 2026-10-07 측정)는 범위가 멈춘(80 ms) 뒤 한 번만 다시 만들고, 그 사이에는 마지막 정확 프레임을
 *   오프스크린 캔버스에서 잘라 늘려 보여 준다 (덮개 선은 새 범위로 다시 그림).
 * 휠: 깊이(세로) 포인터 중심 확대, 가로 휠·Alt = V 확대, Shift = 깊이 이동.
 * 게이트 점선 끌기(gateEdit 이 있을 때, 계산은 shared/imaging/sscanGate): 선 ±6 CSS px 에서 커서가 바뀌고, 6 px 이상 끌면
 *   다이아몬드와 같은 뜻(시작 = 폭 유지하고 옮김, 끝 = 폭 바꿈)으로 초안만 움직이다 손을 뗄 때 한 번 커밋, Esc = 취소,
 *   끄는 동안 Ctrl/Cmd+Z 는 무시. 6 px 미만이면 클릭 = 지금처럼 빔 고르기. 시작·끝 선이 겹치면(거리 차 1 px 미만) 6 px 를 넘는 순간의
 *   방향으로 정한다 (깊게 = 끝, 얕게 = 시작 — 눈금자 다이아몬드와 같은 규칙).
 * 라벨 모드(marking·overlay 가 있을 때만 — 없으면 지금과 같은 조작·같은 그림):
 *   marking.onPoint 가 있으면 클릭 = 점 찍기 (빔 고르기 대신), marking.onRect 가 있으면 6 px 이상 끌기 = 사각형 (끄는 동안 점선 상자, Esc 취소),
 *   marking.onHover = 올려 둔 점 (읽기값). overlay = 라벨 덮개 (V mm, 펼친 깊이 mm — viewer/overlay.ts) — 영상 위에 겹친 따로 캔버스
 *   (.vplot__overlay, 포인터를 받지 않음)에 그려 덮개만 바뀔 때 S-scan 을 다시 칠하지 않는다.
 *   onViewport = 보이는 범위·요소 크기 공개 (shared/imaging viewport.ts — x = V, y = 펼친 깊이).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  SSCAN_GATE_DRAG_MIN_PX,
  buildSscanMap,
  findGate,
  gateEdgeByMove,
  hitSscanGateDetail,
  rawIndexFactor,
  renderSscan,
  samplePoint,
  sscanGateDragPatchAt,
  sscanGateLine,
  sscanGateValueAt,
  sscanPointAtCss,
  sscanOutline,
  viewToPx,
  viewportPixel,
  weldOverlay,
  zoomFactorOf,
  type AmplitudeScale,
  type GateEdge,
  type GateOverride,
  type InspectionPoint,
  type SscanGatePointer,
  type SscanViewport,
  type ViewViewport,
  type ViewerGate,
  type ViewerGroup,
  type ViewerSpecimen
} from '@shared/imaging'
import { Axis, type AxisInteraction } from './Axis'
import { CANVAS_FONT, CANVAS_FONT_PX, type LabelTone, type LabelToneStyle, type OverlayColors, blockUndoWhileDragging, pixelRatio, prepareCanvas, useElementSize, useWheel } from './canvas'
import { drawOverlay, isEmptyOverlay, type ViewOverlay } from './overlay'
import type { GroupVolume } from './volumeStore'

/** 라벨 모드 S-scan 조작 (없으면 보통 모드: 클릭 = 빔 고르기) */
export interface SscanMarking {
  /** 클릭(6 px 미만) = 점 찍기 (V, 펼친 깊이) */
  onPoint?: (p: InspectionPoint) => void
  /** 끌기(6 px 이상)를 놓을 때 = 사각형 (두 모서리) */
  onRect?: (a: InspectionPoint, b: InspectionPoint) => void
  /** 올려 둔 점 (버튼 없이 움직임). 요소를 벗어나면 null */
  onHover?: (p: InspectionPoint | null) => void
}

/** 끌기 사각형 (라벨 모드) */
type RectDrag = { pointerId: number; startX: number; startY: number; moved: boolean; a: InspectionPoint; b: InspectionPoint }

export interface SscanRange {
  vMinMm: number
  vMaxMm: number
  depthMinMm: number
  depthMaxMm: number
}

export type SscanAxisKind = 'depth' | 'v'

/** 범위가 멈춘 뒤 조회표를 다시 만들기까지 (ms) */
export const SSCAN_SETTLE_MS = 80

function sameRange(a: SscanRange, b: SscanRange): boolean {
  return a.vMinMm === b.vMinMm && a.vMaxMm === b.vMaxMm && a.depthMinMm === b.depthMinMm && a.depthMaxMm === b.depthMaxMm
}

/** 영상 위 게이트 점선 끌기 (C-scan 게이트). 패치는 GateOverride 단위(mm) — 리듀서 setGate 그대로 */
export interface SscanGateEdit {
  /** 선 위에 올렸을 때 툴팁 (무엇을 끄는지) */
  titles: Record<GateEdge, string>
  /** 선을 누르는 순간 (이 그룹을 활성으로) */
  onGrab?: () => void
  /** 끌기 중 — 선·A-scan 만 움직이는 초안 */
  onDrag: (patch: GateOverride) => void
  /** 손을 뗄 때 한 번 (C-scan 재계산 1회·되돌리기 한 단계) */
  onDragEnd: (patch: GateOverride) => void
  /** Esc·포인터 취소·움직이지 않은 클릭 — 초안을 버린다 */
  onDragCancel: () => void
}

type GateDrag = {
  edge: GateEdge
  /** 시작·끝 선이 겹쳐(거리 차 1 px 미만) 누른 자리로 정하지 않음 — 6 px 를 넘는 순간의 방향으로 edge 를 정한다 */
  tie: boolean
  pointerId: number
  /** 잡을 때의 게이트·현재 빔 (끄는 동안 초안이 바뀌어도 기준은 그대로) */
  gate: ViewerGate
  beam: number
  startX: number
  startY: number
  moved: boolean
  last: GateOverride | null
}

export function SscanView(props: {
  group: ViewerGroup
  volume: GroupVolume | null
  scanIndex: number
  beam: number
  range: SscanRange
  palette: Uint8Array
  noData: readonly [number, number, number]
  specimen: ViewerSpecimen
  active: boolean
  colors: OverlayColors
  onPickBeam: (beam: number) => void
  /** 그릴 게이트(유효 게이트, 편집 반영). 생략하면 파일의 C-scan 게이트 */
  gate?: ViewerGate | null
  /** 진폭 변환(소프트 이득 반영). 생략하면 파일값 */
  ampScale?: AmplitudeScale
  /** 눈금자 조작(구간 끌기 확대·더블클릭 초기화·게이트 다이아몬드) */
  depthAxis?: AxisInteraction
  vAxis?: AxisInteraction
  /** 영상 위 게이트 점선 끌기 — 없으면 끌 수 없다 (클릭은 빔 고르기만) */
  gateEdit?: SscanGateEdit
  /** 휠 확대 (axis, 포인터 위치 비율, 배율) — 없으면 휠을 받지 않는다 */
  onZoom?: (axis: SscanAxisKind, anchorFrac: number, factor: number) => void
  /** Shift+휠 이동 (mm) */
  onPan?: (axis: SscanAxisKind, deltaMm: number) => void
  /** 라벨 모드 조작 — 없으면 보통 모드 */
  marking?: SscanMarking
  /** 라벨 덮개 (V mm, 펼친 깊이 mm). 없거나 비면 그리지 않는다 */
  overlay?: ViewOverlay
  /** 덮개 색 (canvas.ts labelOverlayColors) — overlay·끌기 사각형이 있을 때만 쓴다 */
  overlayStyles?: Record<LabelTone, LabelToneStyle>
  /** 보이는 범위가 바뀔 때 (요소 CSS 크기·V·펼친 깊이 창) */
  onViewport?: (vp: ViewViewport) => void
}) {
  const { group, volume, range, specimen, colors, gate: gateProp, overlay, overlayStyles } = props
  // 라벨 모드 끌기 사각형 (끄는 동안의 점선 상자)
  const [rubber, setRubber] = useState<{ a: InspectionPoint; b: InspectionPoint } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(boxRef)
  const ratio = pixelRatio(size.width, size.height)
  const pw = Math.round(size.width * ratio)
  const ph = Math.round(size.height * ratio)

  // 멈춘 범위: 조회표는 이것으로 만든다. props.range 가 바뀌면 80 ms 뒤에 따라간다
  const [settled, setSettled] = useState<SscanRange>(range)
  useEffect(() => {
    if (sameRange(settled, range)) return
    const t = setTimeout(() => setSettled(range), SSCAN_SETTLE_MS)
    return () => clearTimeout(t)
  }, [range, settled])
  const pending = !sameRange(settled, range)

  // 조회표 뷰포트(멈춘 범위) — deps 는 빔·시간축만 (group 객체가 바뀌어도 기하가 같으면 다시 만들지 않는다)
  const beams = group.beams
  const ultrasound = group.ultrasound
  const mapVp: SscanViewport | null = useMemo(
    () => (pw > 0 && ph > 0 ? { ...settled, width: pw, height: ph } : null),
    [settled.vMinMm, settled.vMaxMm, settled.depthMinMm, settled.depthMaxMm, pw, ph]
  )
  const map = useMemo(() => (mapVp ? buildSscanMap({ beams, ultrasound }, mapVp) : null), [beams, ultrasound, mapVp])
  const image = useMemo(() => (mapVp ? new ImageData(mapVp.width, mapVp.height) : null), [mapVp])
  // 그리기 뷰포트(지금 범위) — 덮개와 근사 확대는 이것으로
  const vp: SscanViewport | null = useMemo(() => (pw > 0 && ph > 0 ? { ...range, width: pw, height: ph } : null), [range.vMinMm, range.vMaxMm, range.depthMinMm, range.depthMaxMm, pw, ph])
  const weld = useMemo(() => weldOverlay(specimen.weld, specimen.thicknessMm, range.depthMaxMm), [specimen, range.depthMaxMm])
  /** 데이터 경계 (조회표가 칠하는 영역의 외곽 — 톱니까지 같음, shared/imaging sscanOutline). 라이트 외곽선·개선 덮개 클립 */
  const fan = useMemo(() => sscanOutline({ beams, ultrasound }), [beams, ultrasound])
  /** 마지막 정확 프레임 (근사 확대용) */
  const lastExact = useRef<{ image: ImageData; vp: SscanViewport } | null>(null)
  const offscreen = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !vp) return
    const ctx = prepareCanvas(canvas, vp.width, vp.height)
    if (!ctx) return
    ctx.clearRect(0, 0, vp.width, vp.height)
    if (volume) {
      if (!pending && map && image && mapVp) {
        const [, nb, nt] = group.shape
        renderSscan({
          map,
          amplitude: volume.amplitude,
          offset: props.scanIndex * nb * nt,
          status: volume.status,
          statusOffset: props.scanIndex * nb,
          indexFactor: rawIndexFactor(props.ampScale ?? group.ampScale),
          palette: props.palette,
          noData: props.noData,
          background: [0, 0, 0, 0],
          out: image.data
        })
        ctx.putImageData(image, 0, 0)
        lastExact.current = { image, vp: mapVp }
      } else if (lastExact.current) {
        // 범위를 바꾸는 중: 마지막 정확 프레임을 새 범위에 맞게 잘라 늘린다 (drawImage 는 ImageData 를 직접 받지 않는다)
        const { image: img, vp: ov } = lastExact.current
        const off = (offscreen.current ??= document.createElement('canvas'))
        if (off.width !== img.width) off.width = img.width
        if (off.height !== img.height) off.height = img.height
        off.getContext('2d')?.putImageData(img, 0, 0)
        const sx = ((vp.vMinMm - ov.vMinMm) / (ov.vMaxMm - ov.vMinMm)) * ov.width
        const sw = ((vp.vMaxMm - vp.vMinMm) / (ov.vMaxMm - ov.vMinMm)) * ov.width
        const sy = ((vp.depthMinMm - ov.depthMinMm) / (ov.depthMaxMm - ov.depthMinMm)) * ov.height
        const sh = ((vp.depthMaxMm - vp.depthMinMm) / (ov.depthMaxMm - ov.depthMinMm)) * ov.height
        // 원본 밖은 투명으로 남는다 (부채꼴 밖 바탕과 같음)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(off, sx, sy, sw, sh, 0, 0, vp.width, vp.height)
      }
    }
    const P = (v: number, d: number): [number, number] => {
      const p = viewportPixel(vp, v, d)
      return [p.x, p.y]
    }
    const line = (pts: Array<[number, number]>): void => {
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
    const lw = Math.max(1, ratio)
    ctx.lineWidth = lw

    // 밝은 바탕에서는 0 % 흰색이 바탕과 섞이므로 데이터 경계(부채꼴 외곽)를 가는 선으로
    if (colors.fanOutline) {
      ctx.setLineDash([])
      ctx.strokeStyle = colors.fanOutline
      ctx.beginPath()
      fan.forEach((p, i) => {
        const [x, y] = P(p.vMm, p.depthMm)
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
      ctx.closePath()
      ctx.stroke()
    }

    // 스킵선 (두께의 배수)
    const t = specimen.thicknessMm
    if (t && t > 0) {
      ctx.strokeStyle = colors.skip
      ctx.setLineDash([4 * lw, 4 * lw])
      for (let d = t; d < vp.depthMaxMm; d += t) if (d > vp.depthMinMm) line([P(vp.vMinMm, d), P(vp.vMaxMm, d)])
    }

    // 개선·열영향부: 데이터 안은 진하게, 밖은 회색 (클립 = 데이터 경계와 같은 외곽)
    if (weld) {
      const fanPath = new Path2D()
      fan.forEach((p, i) => {
        const [x, y] = P(p.vMm, p.depthMm)
        if (i) fanPath.lineTo(x, y)
        else fanPath.moveTo(x, y)
      })
      fanPath.closePath()
      const drawWeld = (bevelColor: string, hazColor: string): void => {
        ctx.setLineDash([5 * lw, 3 * lw])
        ctx.strokeStyle = bevelColor
        for (const pl of weld.bevel) line(pl.map(([v, d]) => P(v, d)))
        ctx.strokeStyle = hazColor
        ctx.setLineDash([3 * lw, 4 * lw])
        for (const pl of weld.haz) line(pl.map(([v, d]) => P(v, d)))
      }
      ctx.save()
      const outside = new Path2D()
      outside.rect(0, 0, vp.width, vp.height)
      outside.addPath(fanPath)
      ctx.clip(outside, 'evenodd')
      drawWeld(colors.weldOutside, colors.weldOutside)
      ctx.restore()
      ctx.save()
      ctx.clip(fanPath)
      drawWeld(colors.weld, colors.weld)
      ctx.restore()
      // 꼬리표 (OPD: '덮개 추정') — 오른쪽 개선면 위 끝 옆, 'C L' 글자 줄 아래. NDE 는 꼬리표가 없어 그림이 그대로다
      const note = specimen.weld?.overlayNote
      const head = weld.bevel[0]?.[0]
      if (note && head) {
        const [hx, hy] = P(head[0], head[1])
        ctx.setLineDash([])
        ctx.fillStyle = colors.weld
        ctx.font = `${CANVAS_FONT_PX * ratio}px ${CANVAS_FONT}`
        ctx.textAlign = 'left'
        const x = Math.min(Math.max(0, hx + 4 * ratio), vp.width - ctx.measureText(note).width - 2 * ratio)
        ctx.fillText(note, x, Math.max(hy, 0) + (CANVAS_FONT_PX + 1) * 2 * ratio)
      }
    }

    // CL
    ctx.setLineDash([6 * lw, 4 * lw])
    ctx.strokeStyle = colors.cl
    if (!group.spatialAxis && vp.vMinMm < 0 && vp.vMaxMm > 0) {
      const [x] = P(0, vp.depthMinMm)
      line([
        [x, 0],
        [x, vp.height]
      ])
      ctx.fillStyle = colors.cl
      ctx.font = `${CANVAS_FONT_PX * ratio}px ${CANVAS_FONT}`
      ctx.textAlign = 'center'
      ctx.fillText('C L', x, (CANVAS_FONT_PX + 1) * ratio)
      ctx.textAlign = 'left'
    }

    // 게이트 A (TrueDepth 면 현재 빔 깊이의 수평선, 그 밖에는 빔을 잇는 선) — 끌기 잡기 판정과 같은 선(sscanGateLine)
    const gate = gateProp !== undefined ? gateProp : findGate(group, group.cscanGateId)
    if (gate) {
      ctx.strokeStyle = colors.gate
      ctx.setLineDash([2 * lw, 3 * lw])
      for (const edge of ['start', 'end'] as const) {
        const pts = sscanGateLine(group, gate, edge, props.beam, [vp.vMinMm, vp.vMaxMm])
        if (pts.length) line(pts.map((p) => P(p.vMm, p.depthMm)))
      }
    }

    // 현재 빔
    const beam = group.beams[props.beam]
    if (beam) {
      ctx.setLineDash([])
      ctx.strokeStyle = colors.cursor
      ctx.lineWidth = lw * 1.5
      const a = samplePoint(beam, 0, group.ultrasound)
      const b = samplePoint(beam, group.ultrasound.count - 1, group.ultrasound)
      line([P(a.vMm, a.depthMm), P(b.vMm, b.depthMm)])
    }

  }, [vp, mapVp, map, image, pending, volume, props.scanIndex, props.beam, props.palette, props.noData, props.ampScale, group, gateProp, specimen, weld, fan, ratio, colors])

  // 라벨 덮개는 영상 위 따로 겹친 캔버스에 (라벨 모드에서만 생긴다 — 덮개·끌기 사각형만 바뀌면 S-scan 은 다시 칠하지 않는다.
  // 보통 모드에는 이 캔버스가 없어 영상 캔버스는 지금과 바이트 단위로 같다)
  const ovRef = useRef<HTMLCanvasElement>(null)
  const showOverlay = !!overlayStyles
  useEffect(() => {
    const canvas = ovRef.current
    if (!canvas || !vp) return
    const ctx = prepareCanvas(canvas, vp.width, vp.height)
    if (!ctx) return
    ctx.clearRect(0, 0, vp.width, vp.height)
    if (!overlayStyles || (isEmptyOverlay(overlay) && !rubber)) return
    const axes = { x: { from: vp.vMinMm, to: vp.vMaxMm }, y: { from: vp.depthMinMm, to: vp.depthMaxMm } }
    const ovMap = {
      x: (v: number) => viewToPx(axes, v, 0, vp.width, vp.height).x,
      y: (d: number) => viewToPx(axes, 0, d, vp.width, vp.height).y,
      width: vp.width,
      height: vp.height
    }
    drawOverlay(ctx, overlay, ovMap, overlayStyles, ratio)
    if (rubber) {
      drawOverlay(ctx, { rects: [{ id: 'rubber', tone: 'draft', x0: rubber.a.vMm, x1: rubber.b.vMm, y0: rubber.a.depthMm, y1: rubber.b.depthMm }] }, ovMap, overlayStyles, ratio)
    }
  }, [vp, overlay, overlayStyles, rubber, ratio, showOverlay])

  // 보이는 범위 공개 (라벨 모드 점 찍기·덮개 — shared/imaging viewport: x = V, y = 펼친 깊이)
  const { onViewport } = props
  useEffect(() => {
    if (!onViewport || size.width < 1 || size.height < 1) return
    onViewport({
      kind: 'sscan',
      groupId: group.id,
      beam: props.beam,
      scanWindow: [props.scanIndex, props.scanIndex + 1],
      cssWidth: size.width,
      cssHeight: size.height,
      x: { from: range.vMinMm, to: range.vMaxMm },
      y: { from: range.depthMinMm, to: range.depthMaxMm }
    })
  }, [onViewport, group.id, props.beam, props.scanIndex, size.width, size.height, range.vMinMm, range.vMaxMm, range.depthMinMm, range.depthMaxMm])

  const pick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!map || !mapVp) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * mapVp.width)
    const y = Math.floor(((e.clientY - r.top) / r.height) * mapVp.height)
    const p = y * mapVp.width + x
    const b0 = map.beam0[p] ?? -1
    if (b0 < 0) return
    props.onPickBeam(map.weight[p]! < 0.5 ? b0 : map.beam1[p]!)
  }

  // ── 게이트 점선 끌기 (영상 위 보조 수단 — 숫자 입력·눈금자 다이아몬드와 같은 값) ──
  const { gateEdit } = props
  const shownGate = gateProp !== undefined ? gateProp : findGate(group, group.cscanGateId)
  /** 올려 둔 선 ('tie' = 시작·끝이 겹쳐 끄는 방향으로 정함) */
  const [hover, setHover] = useState<GateEdge | 'tie' | null>(null)
  const [dragEdge, setDragEdge] = useState<GateEdge | null>(null)
  // 끌기 상태의 기준은 ref (같은 틱에 연달아 오는 포인터 이벤트가 렌더 전에도 보이게 — Axis 와 같음). state 는 커서용
  const gateDrag = useRef<GateDrag | null>(null)
  /** 끌기·Esc 취소 뒤 따라오는 click 은 빔 고르기가 아니다 */
  const swallowClick = useRef(false)
  // 끝·취소는 그때의 최신 콜백으로 (끄는 동안 다시 그려져도). 끄는 도중 gateEdit 가 사라지면(L·1·2 키로 라벨 도구가 바뀜)
  // 마지막으로 받은 콜백으로 취소한다 — 뷰어의 게이트 초안이 남아 A-scan 선·ND 판정이 어긋나지 않게
  const editRef = useRef(gateEdit)
  editRef.current = gateEdit
  const lastEdit = useRef(gateEdit)
  if (gateEdit) lastEdit.current = gateEdit

  const pointerOf = (e: { clientX: number; clientY: number }, gate: ViewerGate, beam: number): SscanGatePointer | null => {
    const canvas = canvasRef.current
    if (!canvas || !vp) return null
    const r = canvas.getBoundingClientRect()
    return { group, gate, beam, view: vp, cssWidth: r.width, cssHeight: r.height, x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const endGateDrag = (): GateDrag | null => {
    const d = gateDrag.current
    gateDrag.current = null
    setDragEdge(null)
    return d
  }
  // ── 라벨 모드: 점 찍기·사각형 끌기·올려 둔 점 ──
  const { marking } = props
  const markingRef = useRef(marking)
  markingRef.current = marking
  const rectDrag = useRef<RectDrag | null>(null)
  /** 요소 안 CSS px → 검사 좌표 (지금 그리는 창) */
  const pointAt = (e: { clientX: number; clientY: number }, clamp = false): InspectionPoint | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    if (!(r.width > 0) || !(r.height > 0)) return null
    let x = e.clientX - r.left
    let y = e.clientY - r.top
    if (clamp) {
      x = Math.max(0, Math.min(r.width, x))
      y = Math.max(0, Math.min(r.height, y))
    } else if (x < 0 || y < 0 || x > r.width || y > r.height) return null
    return sscanPointAtCss(range, r.width, r.height, x, y)
  }
  const endRectDrag = (): RectDrag | null => {
    const d = rectDrag.current
    rectDrag.current = null
    setRubber(null)
    return d
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    swallowClick.current = false
    if (e.button === 0 && marking?.onRect && !(gateEdit && shownGate)) {
      // 라벨 모드 사각형: 누른 곳부터 (6 px 미만이면 클릭 — 점 찍기 또는 빔 고르기)
      const p = pointAt(e)
      if (!p) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // 합성 이벤트(점검 스크립트)에서는 던진다 — 끌기에 영향 없음
      }
      rectDrag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, a: p, b: p }
      return
    }
    if (e.button !== 0 || !gateEdit || !shownGate) return
    const q = pointerOf(e, shownGate, props.beam)
    const hit = q ? hitSscanGateDetail(q) : null
    // 선 밖이면 아무것도 하지 않는다 → 아래 click 이 빔을 고른다
    if (!q || !hit) return
    const { edge, tie } = hit
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 합성 이벤트(점검 스크립트)에서는 던진다 — 끌기에 영향 없음
    }
    gateDrag.current = { edge, tie, pointerId: e.pointerId, gate: shownGate, beam: props.beam, startX: q.x, startY: q.y, moved: false, last: null }
    setDragEdge(edge)
    gateEdit.onGrab?.()
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rd = rectDrag.current
    if (rd) {
      if (e.pointerId !== rd.pointerId) return
      if (!rd.moved && Math.hypot(e.clientX - rd.startX, e.clientY - rd.startY) < SSCAN_GATE_DRAG_MIN_PX) return
      const p = pointAt(e, true)
      if (!p) return
      rd.moved = true
      rd.b = p
      setRubber({ a: rd.a, b: p })
      return
    }
    if (marking?.onHover && e.buttons === 0) marking.onHover(pointAt(e))
    const d = gateDrag.current
    if (d) {
      if (e.pointerId !== d.pointerId) return
      const q = pointerOf(e, d.gate, d.beam)
      if (!q) return
      // 6 px 미만은 클릭(빔 고르기)으로 남겨 둔다
      if (!d.moved && Math.hypot(q.x - d.startX, q.y - d.startY) < SSCAN_GATE_DRAG_MIN_PX) return
      if (!d.moved && d.tie) {
        // 겹친 시작·끝: 끌기가 시작되는 순간의 방향 (포인터 값이 커지면 = 깊게 끝, 아니면 시작)
        const at = (x: number, y: number): number => sscanGateValueAt(q.group, q.gate, sscanPointAtCss(q.view, q.cssWidth, q.cssHeight, x, y))
        d.edge = gateEdgeByMove(at(d.startX, d.startY), at(q.x, q.y))
        d.tie = false
        setDragEdge(d.edge)
      }
      d.moved = true
      d.last = sscanGateDragPatchAt(q, d.edge)
      editRef.current?.onDrag(d.last)
      return
    }
    // 올려 두기: 선 근처면 커서·툴팁 (버튼을 누른 채 지나갈 때는 판정하지 않음). 바뀔 때만 state
    let h: GateEdge | 'tie' | null = null
    if (e.buttons === 0 && gateEdit && shownGate) {
      const q = pointerOf(e, shownGate, props.beam)
      const hit = q ? hitSscanGateDetail(q) : null
      h = hit ? (hit.tie ? 'tie' : hit.edge) : null
    }
    if (h !== hover) setHover(h)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rd = rectDrag.current
    if (rd && e.pointerId === rd.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // 캡처가 없으면 무시
      }
      endRectDrag()
      if (rd.moved) {
        // 끌기 뒤 따라오는 click 은 점 찍기·빔 고르기가 아니다
        swallowClick.current = true
        const b = pointAt(e, true) ?? rd.b
        markingRef.current?.onRect?.(rd.a, b)
      }
      return
    }
    if (!gateDrag.current || e.pointerId !== gateDrag.current.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 캡처가 없으면 무시
    }
    const d = endGateDrag()
    if (d?.moved && d.last) {
      swallowClick.current = true
      editRef.current?.onDragEnd(d.last)
    } else editRef.current?.onDragCancel() // 움직이지 않은 클릭: 게이트는 그대로, 뒤따르는 click 이 빔을 고른다
  }
  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (rectDrag.current && e.pointerId === rectDrag.current.pointerId) {
      endRectDrag()
      swallowClick.current = true
      return
    }
    if (!gateDrag.current || e.pointerId !== gateDrag.current.pointerId) return
    endGateDrag()
    swallowClick.current = true
    editRef.current?.onDragCancel()
  }
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    // 라벨 모드 점 찍기 (깊이 포함). 부채꼴 밖이어도 좌표는 넘긴다 — 앵커를 못 만들면 받는 쪽이 거른다
    if (marking?.onPoint) {
      const p = pointAt(e)
      if (p) marking.onPoint(p)
      return
    }
    pick(e)
  }
  // 라벨 모드 사각형 끌기: Esc = 취소 (뒤따르는 click 도 무시)
  const rectDragging = rubber !== null
  useEffect(() => {
    if (!rectDragging) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !rectDrag.current) return
      endRectDrag()
      swallowClick.current = true
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rectDragging])
  // 라벨 모드를 끄면(조작이 사라지면) 끌던 사각형·올려 둔 점을 남기지 않는다
  const hasRect = !!marking?.onRect
  useEffect(() => {
    if (!hasRect && rectDrag.current) endRectDrag()
  }, [hasRect])
  // Esc = 끌기 취소 (초안 버림, 손을 떼도 빔을 고르지 않음). 끄는 동안 Ctrl/Cmd+Z 는 삼킨다 — 끝 패치는 잡을 때의 게이트 시작 값 기준이라
  // 도중 되돌리기면 끝 선이 포인터에서 떨어진 채 커밋된다 (blockUndoWhileDragging, window 캡처 단계 = NdeViewer onKeyDown 보다 먼저)
  const dragging = dragEdge !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !gateDrag.current) return
      endGateDrag()
      swallowClick.current = true
      editRef.current?.onDragCancel()
    }
    window.addEventListener('keydown', onKey)
    const unblock = blockUndoWhileDragging()
    return () => {
      window.removeEventListener('keydown', onKey)
      unblock()
    }
  }, [dragging])
  const hasGateEdit = !!gateEdit
  useEffect(() => {
    if (hasGateEdit || !gateDrag.current) return
    endGateDrag()
    swallowClick.current = true
    lastEdit.current?.onDragCancel()
  }, [hasGateEdit])
  // 끌던 중 패널이 사라지면(레이아웃·그룹 전환) 초안을 남기지 않는다
  useEffect(
    () => () => {
      if (!gateDrag.current) return
      gateDrag.current = null
      editRef.current?.onDragCancel()
    },
    []
  )
  const canDragGate = !!gateEdit && !!shownGate
  const cursor = dragEdge ? 'ns-resize' : canDragGate && hover ? 'row-resize' : undefined
  const tip =
    !dragEdge && hover && gateEdit && shownGate
      ? hover === 'tie'
        ? `${gateEdit.titles.start}\n${gateEdit.titles.end}\n(시작·끝이 겹침: 깊게 끌면 끝 = 폭, 얕게 끌면 시작 = 옮김)`
        : gateEdit.titles[hover]
      : undefined

  const { onZoom, onPan } = props
  useWheel(
    canvasRef,
    onZoom
      ? (g) => {
          if (g.shift) {
            onPan?.('depth', g.ticks * 0.1 * (range.depthMaxMm - range.depthMinMm))
            return
          }
          if (g.alt || g.horizontal) onZoom('v', g.fx, zoomFactorOf(g.ticks))
          else onZoom('depth', g.fy, zoomFactorOf(g.ticks))
        }
      : undefined
  )

  return (
    <div className={`vplot vplot--sscan${props.active ? ' is-active' : ''}`}>
      <Axis orientation="left" from={range.depthMinMm} to={range.depthMaxMm} length={size.height} title="깊이" interaction={props.depthAxis} markerColor={colors.gate} />
      <div className="vplot__box" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="vplot__canvas"
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={() => {
            if (hover) setHover(null)
            marking?.onHover?.(null)
          }}
          style={cursor ? { cursor } : undefined}
          title={tip}
          aria-label={`${group.name} S-scan${
            marking?.onPoint ? ' — 라벨 모드: 클릭으로 점 찍기, 끌어서 사각형' : marking?.onRect ? ` — 라벨 모드: 끌어서 사각형, 클릭으로 ${group.spatialAxis ? 'Index' : '빔'} 선택` : canDragGate ? ` — 클릭으로 ${group.spatialAxis ? 'Index' : '빔'} 선택, 빨간 게이트 점선은 끌어서 시작·끝 조정` : ''
          }`}
        />
        {showOverlay ? <canvas ref={ovRef} className="vplot__canvas vplot__overlay" aria-hidden="true" /> : null}
      </div>
      <span />
      <Axis orientation="bottom" from={range.vMinMm} to={range.vMaxMm} length={size.width} title={group.spatialAxis ? 'Index 위치' : '용접 중심선 기준 위치'} interaction={props.vAxis} />
    </div>
  )
}
