/**
 * C-scan 패널: 가로 스캔 × 세로 빔(섹토리얼·컴파운드 = 굴절각, 리니어 = 빔 번호 — beamAxis.ts), 게이트 A 최대. 클릭·끌기로 스캔 위치와 빔을 고른다.
 * 스캔 창(후처리) [k0, k1) 만 그린다 (기본 = 전체). 커서가 창 밖이면 세로 커서선을 그리지 않는다.
 * 휠: 스캔축 포인터 중심 확대, Shift = 이동.
 * 라벨 모드(marking·overlay 가 있을 때만): marking 은 지금 고르기(클릭·끌기 스크럽)에 더해 누름·움직임·놓음을 칸 단위로 알린다
 *   (기준 커서 R·검토 구간 끌기). overlay = 라벨 덮개 (스캔 U mm, 빔 번호 실수 — viewer/overlay.ts) — 영상 위 따로 겹친 캔버스(.vplot__overlay).
 *   onViewport = 보이는 범위 공개.
 */
import { useEffect, useMemo, useRef } from 'react'
import {
  cscanBeamAtY,
  cscanBeamAxis,
  cscanBeamViewAxis,
  cscanScanAtX,
  cscanXForScan,
  cscanYForBeam,
  rawIndexFactor,
  renderCscan,
  scanPositionMm,
  scanViewAxis,
  viewToPx,
  zoomFactorOf,
  type AmplitudeScale,
  type GateCscan,
  type ViewViewport,
  type ViewerGroup
} from '@shared/imaging'
import { Axis, type AxisInteraction } from './Axis'
import { type LabelTone, type LabelToneStyle, type OverlayColors, pixelRatio, prepareCanvas, useElementSize, useWheel } from './canvas'
import { drawOverlay, isEmptyOverlay, type ViewOverlay } from './overlay'
import type { GroupVolume } from './volumeStore'

/** 라벨 모드 C/B-scan 끌기 (칸 단위). 지금 고르기(onPick)는 그대로 일어나고, 이것은 그에 더해 불린다 */
export interface ScanMarking {
  /** 누름 (스캔 칸, 빔) */
  onStart: (scanIndex: number, beam: number) => void
  /** 누른 채 움직임 (4 px 이상 움직인 뒤부터) */
  onMove: (scanIndex: number, beam: number) => void
  /** 놓음. moved = 4 px 이상 움직였는지 */
  onEnd: (scanIndex: number, beam: number, moved: boolean) => void
  /** Esc·포인터 취소 */
  onCancel?: () => void
}

/** 끌기로 보는 최소 움직임 (CSS px) */
export const SCAN_MARK_DRAG_MIN_PX = 4

export function CscanView(props: {
  group: ViewerGroup
  volume: GroupVolume | null
  scanIndex: number
  beam: number
  reversed: boolean
  /** 그릴 C-scan(유효 게이트로 계산한 것). 생략하면 volume.cscan(파일 게이트) */
  cscan?: GateCscan | null
  /** 그릴 스캔 칸 범위 [k0, k1) — 없으면 전체 */
  scanWindow?: [number, number]
  /** 진폭 변환(소프트 이득 반영). 생략하면 파일값 */
  ampScale?: AmplitudeScale
  palette: Uint8Array
  noData: readonly [number, number, number]
  active: boolean
  showScanAxis: boolean
  colors: OverlayColors
  onPick: (scanIndex: number, beam: number) => void
  onZoomScan?: (anchorFrac: number, factor: number) => void
  onPanScan?: (deltaMm: number) => void
  /** 스캔 눈금자 조작 (구간 끌기 확대·더블클릭 초기화) */
  scanAxis?: AxisInteraction
  /** 라벨 모드 끌기 (기준 커서 R·검토 구간) — 없으면 보통 모드 */
  marking?: ScanMarking
  /** 라벨 덮개 (스캔 U mm, 빔 번호 실수). 없거나 비면 그리지 않는다 */
  overlay?: ViewOverlay
  overlayStyles?: Record<LabelTone, LabelToneStyle>
  /** 보이는 범위가 바뀔 때 (x = 스캔 U mm, y = 빔 번호) */
  onViewport?: (vp: ViewViewport) => void
}) {
  const { group, volume, reversed, colors, overlay, overlayStyles } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(boxRef)
  const ratio = pixelRatio(size.width, size.height, 900_000)
  const pw = Math.round(size.width * ratio)
  const ph = Math.round(size.height * ratio)
  const [ns, nb] = group.shape
  const cscan = props.cscan !== undefined ? props.cscan : (volume?.cscan ?? null)
  const k0 = props.scanWindow?.[0] ?? 0
  const k1 = props.scanWindow?.[1] ?? ns

  // 바탕 그림은 크기·데이터·창이 바뀔 때만 다시 칠한다 (커서 이동은 선만)
  const base = useMemo(() => {
    if (!cscan || pw < 1 || ph < 1 || k1 <= k0) return null
    const img = new ImageData(pw, ph)
    const scale = props.ampScale ?? group.ampScale
    renderCscan({ cscan, scanFrom: k0, scanTo: k1, width: pw, height: ph, reversed, indexFactor: rawIndexFactor(scale), palette: props.palette, noData: props.noData, out: img.data })
    return img
  }, [cscan, pw, ph, k0, k1, reversed, group.ampScale, props.ampScale, props.palette, props.noData])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || pw < 1 || ph < 1) return
    const ctx = prepareCanvas(canvas, pw, ph)
    if (!ctx) return
    ctx.clearRect(0, 0, pw, ph)
    if (base) ctx.putImageData(base, 0, 0)
    const lw = Math.max(1, ratio)
    ctx.strokeStyle = colors.cursor
    ctx.lineWidth = lw
    const y = Math.round(cscanYForBeam(props.beam, ph, nb, reversed)) + 0.5
    ctx.beginPath()
    if (props.scanIndex >= k0 && props.scanIndex < k1) {
      const x = Math.round(cscanXForScan(props.scanIndex, pw, k0, k1)) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, ph)
    }
    ctx.moveTo(0, y)
    ctx.lineTo(pw, y)
    ctx.stroke()
  }, [base, pw, ph, props.scanIndex, props.beam, k0, k1, nb, reversed, ratio, colors])

  // 라벨 덮개: 영상 위 따로 겹친 캔버스 (라벨 모드에서만 생김 — 덮개만 바뀔 때 C-scan 을 다시 칠하지 않는다)
  const ovRef = useRef<HTMLCanvasElement>(null)
  const showOverlay = !!overlayStyles
  useEffect(() => {
    const canvas = ovRef.current
    if (!canvas || pw < 1 || ph < 1) return
    const ctx = prepareCanvas(canvas, pw, ph)
    if (!ctx) return
    ctx.clearRect(0, 0, pw, ph)
    if (!overlayStyles || isEmptyOverlay(overlay) || k1 <= k0) return
    const axes = { x: scanViewAxis(group.scan, k0, k1), y: cscanBeamViewAxis(nb, reversed) }
    drawOverlay(ctx, overlay, { x: (v) => viewToPx(axes, v, 0, pw, ph).x, y: (b) => viewToPx(axes, 0, b, pw, ph).y, width: pw, height: ph }, overlayStyles, ratio)
  }, [pw, ph, k0, k1, nb, reversed, ratio, overlay, overlayStyles, group.scan, showOverlay])

  // 보이는 범위 공개 (shared/imaging viewport: x = 스캔 U mm, y = 빔 번호)
  const { onViewport } = props
  useEffect(() => {
    if (!onViewport || size.width < 1 || size.height < 1 || k1 <= k0) return
    onViewport({
      kind: 'cscan',
      groupId: group.id,
      beam: props.beam,
      scanWindow: [k0, k1],
      cssWidth: size.width,
      cssHeight: size.height,
      x: scanViewAxis(group.scan, k0, k1),
      y: cscanBeamViewAxis(nb, reversed)
    })
  }, [onViewport, group.id, group.scan, props.beam, k0, k1, nb, reversed, size.width, size.height])

  /** 포인터 → 칸 (스캔, 빔). 요소가 없거나 창이 비면 null */
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || k1 <= k0) return null
    const k = Math.round(cscanScanAtX(((e.clientX - r.left) / r.width) * pw - 0.5, pw, k0, k1))
    const b = Math.round(cscanBeamAtY(((e.clientY - r.top) / r.height) * ph - 0.5, ph, nb, reversed))
    return [Math.min(k1 - 1, Math.max(k0, k)), Math.min(nb - 1, Math.max(0, b))]
  }
  const pickAt = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const c = cellAt(e)
    if (c) props.onPick(c[0], c[1])
  }
  // 라벨 모드 끌기 (누른 자리·움직였는지). 지금 고르기는 그대로 일어난다
  const { marking } = props
  const markRef = useRef(marking)
  markRef.current = marking
  const mark = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  useEffect(() => {
    if (!marking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !mark.current) return
      mark.current = null
      markRef.current?.onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [marking])

  const { onZoomScan, onPanScan } = props
  const windowMm = (k1 - k0) * group.scan.resolutionMm
  useWheel(
    canvasRef,
    onZoomScan
      ? (g) => {
          if (g.shift || g.horizontal) onPanScan?.(g.ticks * 0.1 * windowMm)
          else onZoomScan(g.fx, zoomFactorOf(g.ticks))
        }
      : undefined
  )

  // 빔 축: 섹토리얼·컴파운드는 굴절각 ± 반 칸(빔 줄이 칸 가운데 (r+0.5)/nb 에 그려지므로), 리니어는 빔 번호 1 ~ nb+1 (OmniPC 와 같은 축)
  const beamAxis = cscanBeamAxis(group)
  const lo = beamAxis.first
  const hi = beamAxis.last
  const res = group.scan.resolutionMm
  return (
    <div className={`vplot vplot--cscan${props.active ? ' is-active' : ''}`}>
      <Axis orientation="left" from={reversed ? hi : lo} to={reversed ? lo : hi} length={size.height} unit={beamAxis.unit} title={beamAxis.title} />
      <div className="vplot__box" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="vplot__canvas"
          aria-label={`${group.name} C-scan`}
          onPointerDown={(e) => {
            // 끌기 중 캔버스 밖으로 나가도 계속 받게. 합성 이벤트(점검 스크립트)에서는 던지므로 무시
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              // 포인터 캡처 실패는 선택에 영향 없음
            }
            pickAt(e)
            if (marking && e.button === 0) {
              const c = cellAt(e)
              if (c) {
                mark.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
                marking.onStart(c[0], c[1])
              }
            }
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) pickAt(e)
            const m = mark.current
            if (m && e.pointerId === m.pointerId && e.buttons & 1) {
              if (!m.moved && Math.hypot(e.clientX - m.x, e.clientY - m.y) < SCAN_MARK_DRAG_MIN_PX) return
              m.moved = true
              const c = cellAt(e)
              if (c) markRef.current?.onMove(c[0], c[1])
            }
          }}
          onPointerUp={(e) => {
            const m = mark.current
            if (!m || e.pointerId !== m.pointerId) return
            mark.current = null
            const c = cellAt(e)
            if (c) markRef.current?.onEnd(c[0], c[1], m.moved)
            else markRef.current?.onCancel?.()
          }}
          onPointerCancel={(e) => {
            if (!mark.current || e.pointerId !== mark.current.pointerId) return
            mark.current = null
            markRef.current?.onCancel?.()
          }}
        />
        {showOverlay ? <canvas ref={ovRef} className="vplot__canvas vplot__overlay" aria-hidden="true" /> : null}
        {!cscan && volume ? <p className="vplot__empty">C-scan 을 만들 게이트가 없습니다</p> : null}
      </div>
      {props.showScanAxis ? (
        <>
          <span />
          <Axis orientation="bottom" from={scanPositionMm(k0, group.scan) - res / 2} to={scanPositionMm(k1 - 1, group.scan) + res / 2} length={size.width} title="스캔 위치" interaction={props.scanAxis} />
        </>
      ) : null}
    </div>
  )
}
