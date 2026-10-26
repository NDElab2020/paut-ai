/**
 * B-scan 패널: 가로 스캔 × 세로 현재 빔 깊이. 게이트 A·스킵선·스캔 커서. 클릭·끌기로 스캔 위치 이동.
 * 스캔 창(C-scan 과 공유)·깊이 창(후처리, 없으면 빔 첫~끝 샘플) 을 받는다.
 * 휠: 스캔축 확대, Alt = 깊이 확대, Shift = 스캔 이동.
 * 라벨 모드(marking·overlay 가 있을 때만): marking = C-scan 과 같은 끌기 알림(빔 = 그리는 빔), overlay = 라벨 덮개
 *   (스캔 U mm, 펼친 깊이 mm — 게이트·스킵 선과 같은 세로 식), onViewport = 보이는 범위 공개.
 */
import { useEffect, useMemo, useRef } from 'react'
import {
  ascanDepthRange,
  axisToPx,
  beamPoint,
  cscanScanAtX,
  cscanXForScan,
  findGate,
  rawIndexFactor,
  renderBscan,
  sampleAtDepth,
  scanPositionMm,
  scanViewAxis,
  soundPathMm,
  zoomFactorOf,
  type AmplitudeScale,
  type MmRange,
  type ViewViewport,
  type ViewerGate,
  type ViewerGroup
} from '@shared/imaging'
import { skipLabel } from './AscanView'
import { Axis, type AxisInteraction } from './Axis'
import { CANVAS_FONT, CANVAS_FONT_PX, type LabelTone, type LabelToneStyle, type OverlayColors, pixelRatio, prepareCanvas, useElementSize, useWheel } from './canvas'
import { SCAN_MARK_DRAG_MIN_PX, type ScanMarking } from './CscanView'
import { drawOverlay, isEmptyOverlay, type ViewOverlay } from './overlay'
import type { GroupVolume } from './volumeStore'

export function BscanView(props: {
  group: ViewerGroup
  volume: GroupVolume | null
  scanIndex: number
  beam: number
  thicknessMm: number | null
  /** 그릴 스캔 칸 범위 [k0, k1) — 없으면 전체 */
  scanWindow?: [number, number]
  /** 깊이 창 (mm) — 없으면 현재 빔 첫~끝 샘플 */
  depthWindow?: MmRange | null
  /** 진폭 변환(소프트 이득 반영). 생략하면 파일값 */
  ampScale?: AmplitudeScale
  palette: Uint8Array
  noData: readonly [number, number, number]
  colors: OverlayColors
  /** 그릴 게이트(유효 게이트, 편집 반영). 생략하면 파일의 C-scan 게이트 */
  gate?: ViewerGate | null
  onPickScan: (scanIndex: number) => void
  onZoomScan?: (anchorFrac: number, factor: number) => void
  onPanScan?: (deltaMm: number) => void
  onZoomDepth?: (anchorFrac: number, factor: number) => void
  depthAxis?: AxisInteraction
  scanAxis?: AxisInteraction
  /** 라벨 모드 끌기 (기준 커서 R·검토 구간) — 없으면 보통 모드 */
  marking?: ScanMarking
  /** 라벨 덮개 (스캔 U mm, 펼친 깊이 mm). 없거나 비면 그리지 않는다 */
  overlay?: ViewOverlay
  overlayStyles?: Record<LabelTone, LabelToneStyle>
  /** 보이는 범위가 바뀔 때 (x = 스캔 U mm, y = 펼친 깊이) */
  onViewport?: (vp: ViewViewport) => void
}) {
  const { group, volume, colors, gate: gateProp, overlay, overlayStyles } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(boxRef)
  const ratio = pixelRatio(size.width, size.height, 900_000)
  const pw = Math.round(size.width * ratio)
  const ph = Math.round(size.height * ratio)
  const [ns, , nt] = group.shape
  const k0 = props.scanWindow?.[0] ?? 0
  const k1 = props.scanWindow?.[1] ?? ns
  const full = ascanDepthRange(group, props.beam)
  const win = props.depthWindow ?? null
  const range = win ? { startMm: win[0], endMm: win[1] } : full
  const beam = group.beams[props.beam]
  // 깊이 창이 있으면 샘플 좌표로 바꿔 넘긴다 (한 빔 안에서 깊이 ∝ 샘플). 없으면 지금 규칙(전체 샘플을 칸으로)
  const sampleFrom = win && beam ? sampleAtDepth(beam, win[0], group.ultrasound) : undefined
  const sampleTo = win && beam ? sampleAtDepth(beam, win[1], group.ultrasound) : undefined

  // 바탕 그림은 빔·크기·데이터·창이 바뀔 때만
  const base = useMemo(() => {
    if (!volume || pw < 1 || ph < 1 || k1 <= k0) return null
    const img = new ImageData(pw, ph)
    renderBscan({
      group,
      amplitude: volume.amplitude,
      status: volume.status,
      beam: props.beam,
      width: pw,
      height: ph,
      scanFrom: k0,
      scanTo: k1,
      sampleFrom,
      sampleTo,
      indexFactor: rawIndexFactor(props.ampScale ?? group.ampScale),
      palette: props.palette,
      noData: props.noData,
      out: img.data
    })
    return img
  }, [volume, group, props.beam, pw, ph, k0, k1, sampleFrom, sampleTo, props.ampScale, props.palette, props.noData])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || pw < 1 || ph < 1) return
    const ctx = prepareCanvas(canvas, pw, ph)
    if (!ctx) return
    ctx.clearRect(0, 0, pw, ph)
    if (base) ctx.putImageData(base, 0, 0)
    const lw = Math.max(1, ratio)
    const span = range.endMm - range.startMm || 1
    const Y = (d: number): number => ((d - range.startMm) / span) * ph
    const hline = (y: number): void => {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(pw, y)
      ctx.stroke()
    }
    ctx.lineWidth = lw
    ctx.font = `${CANVAS_FONT_PX * ratio}px ${CANVAS_FONT}`
    const t = props.thicknessMm
    if (t && t > 0) {
      ctx.strokeStyle = colors.skip
      ctx.fillStyle = colors.skip
      ctx.setLineDash([4 * lw, 4 * lw])
      for (let n = 1; n * t < range.endMm; n++) {
        if (n * t <= range.startMm) continue
        hline(Y(n * t))
        ctx.fillText(skipLabel(n), 3 * ratio, Y(n * t) - 3 * ratio)
      }
    }
    const gate = gateProp !== undefined ? gateProp : findGate(group, group.cscanGateId)
    if (gate && beam) {
      ctx.strokeStyle = colors.gate
      ctx.setLineDash([2 * lw, 3 * lw])
      const st = gate.startUs[props.beam] ?? gate.startUs[0] ?? 0
      const ln = gate.lengthUs[props.beam] ?? gate.lengthUs[0] ?? 0
      for (const tt of [st, st + ln]) hline(Y(beamPoint(beam, soundPathMm(beam, tt)).depthMm))
    }
    ctx.setLineDash([])
    ctx.strokeStyle = colors.cursor
    if (props.scanIndex >= k0 && props.scanIndex < k1) {
      const x = Math.round(cscanXForScan(props.scanIndex, pw, k0, k1)) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, ph)
      ctx.stroke()
    }
  }, [base, pw, ph, ratio, group, gateProp, beam, props.beam, props.scanIndex, props.thicknessMm, range.startMm, range.endMm, k0, k1, nt, colors])

  // 라벨 덮개: 영상 위 따로 겹친 캔버스 (라벨 모드에서만 생김). 세로는 위 선들과 같은 깊이 → y
  const ovRef = useRef<HTMLCanvasElement>(null)
  const showOverlay = !!overlayStyles
  useEffect(() => {
    const canvas = ovRef.current
    if (!canvas || pw < 1 || ph < 1) return
    const ctx = prepareCanvas(canvas, pw, ph)
    if (!ctx) return
    ctx.clearRect(0, 0, pw, ph)
    if (!overlayStyles || isEmptyOverlay(overlay) || k1 <= k0) return
    const span = range.endMm - range.startMm || 1
    const ax = scanViewAxis(group.scan, k0, k1)
    drawOverlay(ctx, overlay, { x: (v) => axisToPx(ax, v, pw), y: (d) => ((d - range.startMm) / span) * ph, width: pw, height: ph }, overlayStyles, ratio)
  }, [pw, ph, ratio, k0, k1, range.startMm, range.endMm, overlay, overlayStyles, group.scan, showOverlay])

  // 보이는 범위 공개 (shared/imaging viewport: x = 스캔 U mm, y = 펼친 깊이)
  const { onViewport } = props
  useEffect(() => {
    if (!onViewport || size.width < 1 || size.height < 1 || k1 <= k0) return
    onViewport({
      kind: 'bscan',
      groupId: group.id,
      beam: props.beam,
      scanWindow: [k0, k1],
      cssWidth: size.width,
      cssHeight: size.height,
      x: scanViewAxis(group.scan, k0, k1),
      y: { from: range.startMm, to: range.endMm }
    })
  }, [onViewport, group.id, group.scan, props.beam, k0, k1, size.width, size.height, range.startMm, range.endMm])

  const scanAt = (e: React.PointerEvent<HTMLCanvasElement>): number | null => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width < 1 || k1 <= k0) return null
    const k = Math.round(cscanScanAtX(((e.clientX - r.left) / r.width) * pw - 0.5, pw, k0, k1))
    return Math.min(k1 - 1, Math.max(k0, k))
  }
  const pickAt = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const k = scanAt(e)
    if (k !== null) props.onPickScan(k)
  }
  // 라벨 모드 끌기 (CscanView 와 같은 규칙, 빔 = 그리는 빔)
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

  const { onZoomScan, onPanScan, onZoomDepth } = props
  const windowMm = (k1 - k0) * group.scan.resolutionMm
  useWheel(
    canvasRef,
    onZoomScan
      ? (g) => {
          if (g.shift || g.horizontal) onPanScan?.(g.ticks * 0.1 * windowMm)
          else if (g.alt) onZoomDepth?.(g.fy, zoomFactorOf(g.ticks))
          else onZoomScan(g.fx, zoomFactorOf(g.ticks))
        }
      : undefined
  )

  const res = group.scan.resolutionMm
  return (
    <div className="vplot vplot--bscan">
      <Axis orientation="left" from={range.startMm} to={range.endMm} length={size.height} title="깊이" interaction={props.depthAxis} markerColor={colors.gate} />
      <div className="vplot__box" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="vplot__canvas"
          aria-label={`${group.name} B-scan`}
          onPointerDown={(e) => {
            // 끌기 중 캔버스 밖으로 나가도 계속 받게. 합성 이벤트(점검 스크립트)에서는 던지므로 무시
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              // 포인터 캡처 실패는 선택에 영향 없음
            }
            pickAt(e)
            if (marking && e.button === 0) {
              const k = scanAt(e)
              if (k !== null) {
                mark.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
                marking.onStart(k, props.beam)
              }
            }
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) pickAt(e)
            const m = mark.current
            if (m && e.pointerId === m.pointerId && e.buttons & 1) {
              if (!m.moved && Math.hypot(e.clientX - m.x, e.clientY - m.y) < SCAN_MARK_DRAG_MIN_PX) return
              m.moved = true
              const k = scanAt(e)
              if (k !== null) markRef.current?.onMove(k, props.beam)
            }
          }}
          onPointerUp={(e) => {
            const m = mark.current
            if (!m || e.pointerId !== m.pointerId) return
            mark.current = null
            const k = scanAt(e)
            if (k !== null) markRef.current?.onEnd(k, props.beam, m.moved)
            else markRef.current?.onCancel?.()
          }}
          onPointerCancel={(e) => {
            if (!mark.current || e.pointerId !== mark.current.pointerId) return
            mark.current = null
            markRef.current?.onCancel?.()
          }}
        />
        {showOverlay ? <canvas ref={ovRef} className="vplot__canvas vplot__overlay" aria-hidden="true" /> : null}
      </div>
      <span />
      <Axis orientation="bottom" from={scanPositionMm(k0, group.scan) - res / 2} to={scanPositionMm(k1 - 1, group.scan) + res / 2} length={size.width} title="스캔 위치" interaction={props.scanAxis} />
    </div>
  )
}
