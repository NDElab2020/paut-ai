/**
 * A-scan 패널 (OmniPC X3 화면처럼 세로): 세로 = 펼친 깊이, 가로 = 진폭 0~100 %.
 * C-scan 게이트(보통 A)만 문턱 높이의 세로 선(시작~끝 깊이)으로, 스킵선은 두께 배수 가로 점선(B0·T1·B2…).
 * 아래 진폭 축 바로 위에 색표 띠를 깔아 축의 % 눈금이 색표 눈금을 겸한다.
 * 깊이 창(후처리)이 있으면 그 구간만 보인다 (기본 = 현재 빔 첫~끝 샘플). 휠: 깊이 확대, Shift = 이동.
 * 라벨 모드(onTimeCursor·overlay 가 있을 때만): 클릭·끌기 = 시간(깊이) 커서 (펼친 깊이를 알림), overlay = 라벨 덮개
 *   (진폭 %, 펼친 깊이 mm — 게이트·스킵 선과 같은 Y()), onViewport = 보이는 범위 공개 (shared/imaging viewport depthToY 와 같은 식).
 * 기준선(levels — 기록·평가 기준 세로 점선, levelLines.ts. 'Ref' 선은 그리지 않음): 켤 때만 영상 위에 따로 겹친 캔버스(.vplot__levels, 포인터 안 받음)에 그린다.
 *   끄면(보통 모드 기본) 캔버스 자체가 없어 영상 캔버스는 바이트 그대로다.
 */
import { useEffect, useRef } from 'react'
import {
  ascanDepthRange,
  ascanOffset,
  axisToPx,
  beamPoint,
  findGate,
  rawToPercent,
  samplePoint,
  soundPathMm,
  yToDepth,
  zoomFactorOf,
  type AmplitudeScale,
  type MmRange,
  type ViewViewport,
  type ViewerGate,
  type ViewerGroup
} from '@shared/imaging'
import { Axis, type AxisInteraction } from './Axis'
import { CANVAS_FONT, CANVAS_FONT_PX, type LabelTone, type LabelToneStyle, type OverlayColors, pixelRatio, prepareCanvas, useElementSize, useWheel } from './canvas'
import { LEVEL_TAG, drawLevelLines, type AscanLevelLine } from './levelLines'
import { drawOverlay, isEmptyOverlay, type ViewOverlay } from './overlay'
import type { GroupVolume } from './volumeStore'

/** 두께 n 배 깊이의 스킵 표시 (OmniPC 글자 그대로): 홀수 레그 끝 = 바닥 B, 짝수 = 표면 T, 번호 = n − 1 → 1 → B0, 2 → T1, 3 → B2 … */
export function skipLabel(n: number): string {
  return `${n % 2 === 1 ? 'B' : 'T'}${n - 1}`
}

export function AscanView(props: {
  group: ViewerGroup
  volume: GroupVolume | null
  scanIndex: number
  beam: number
  thicknessMm: number | null
  /** 깊이 창 (mm) — 없으면 현재 빔 첫~끝 샘플 */
  depthWindow?: MmRange | null
  /** 진폭 변환(소프트 이득 반영). 생략하면 파일값 */
  ampScale?: AmplitudeScale
  /** 진폭 축 상한 (100 또는 200 %). 기본 100 */
  ampAxisMaxPct?: number
  /** 색표 CSS 그라디언트 (진폭 축 폭 기준), 없으면 띠를 그리지 않는다 */
  colorbar?: string
  colors: OverlayColors
  /** 그릴 게이트(유효 게이트, 편집 반영). 생략하면 파일의 C-scan 게이트 */
  gate?: ViewerGate | null
  onZoomDepth?: (anchorFrac: number, factor: number) => void
  onPanDepth?: (deltaMm: number) => void
  /** 깊이 눈금자(구간 확대·게이트 시작·끝 다이아몬드)·진폭 눈금자(문턱 다이아몬드) 조작 */
  depthAxis?: AxisInteraction
  ampAxis?: AxisInteraction
  /** 라벨 모드: 클릭·끌기 = 시간(깊이) 커서 — 펼친 깊이(mm)를 알린다. 없으면 보통 모드(클릭 없음) */
  onTimeCursor?: (depthMm: number) => void
  /** 라벨 덮개 (진폭 %, 펼친 깊이 mm). 없거나 비면 그리지 않는다 */
  overlay?: ViewOverlay
  overlayStyles?: Record<LabelTone, LabelToneStyle>
  /** 보이는 범위가 바뀔 때 (x = 진폭 %, y = 펼친 깊이) */
  onViewport?: (vp: ViewViewport) => void
  /** 기준선 (화면 % — Δ 반영). 없거나 비면 캔버스를 만들지 않는다 */
  levels?: readonly AscanLevelLine[] | null
  /** 기준선 꼬리표 (왼쪽 위, 기본 'Ref 대조 전') */
  levelTag?: string
}) {
  const { group, volume, colors, gate: gateProp, overlay, overlayStyles } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(boxRef)
  const ratio = pixelRatio(size.width, size.height, 400_000)
  const pw = Math.round(size.width * ratio)
  const ph = Math.round(size.height * ratio)
  const full = ascanDepthRange(group, props.beam)
  const win = props.depthWindow ?? null
  const range = win ? { startMm: win[0], endMm: win[1] } : full
  const scale = props.ampScale ?? group.ampScale
  const ampMax = props.ampAxisMaxPct ?? 100

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || pw < 1 || ph < 1) return
    const ctx = prepareCanvas(canvas, pw, ph)
    if (!ctx) return
    ctx.clearRect(0, 0, pw, ph)
    const beam = group.beams[props.beam]
    if (!beam) return
    const nt = group.ultrasound.count
    const span = range.endMm - range.startMm || 1
    const Y = (depth: number): number => ((depth - range.startMm) / span) * ph
    const X = (pct: number): number => (Math.max(0, Math.min(ampMax, pct)) / ampMax) * pw
    const lw = Math.max(1, ratio)

    // 격자 (10 % 마다)
    ctx.strokeStyle = colors.grid
    ctx.lineWidth = lw
    ctx.beginPath()
    for (let p = 10; p < ampMax; p += 10) {
      ctx.moveTo(Math.round(X(p)) + 0.5, 0)
      ctx.lineTo(Math.round(X(p)) + 0.5, ph)
    }
    ctx.stroke()

    // 스킵선 (라벨은 오른쪽 끝: 신호는 대개 0 % 근처라 왼쪽에 두면 겹친다)
    const t = props.thicknessMm
    ctx.font = `${CANVAS_FONT_PX * ratio}px ${CANVAS_FONT}`
    if (t && t > 0) {
      ctx.strokeStyle = colors.skip
      ctx.fillStyle = colors.skip
      ctx.setLineDash([4 * lw, 4 * lw])
      ctx.textAlign = 'right'
      for (let n = 1; n * t < range.endMm; n++) {
        const y = Y(n * t)
        if (y < 0) continue
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(pw, y)
        ctx.stroke()
        ctx.fillText(skipLabel(n), pw - 3 * ratio, y - 3 * ratio)
      }
      ctx.textAlign = 'left'
    }

    // 게이트: C-scan 게이트(보통 A)만 문턱 % 위치의 세로 선 — S·B-scan 과 같은 규칙. OmniPC 캡처에도 다른 게이트(I·B) 선은 없다
    ctx.setLineDash([])
    ctx.strokeStyle = colors.gate
    ctx.fillStyle = colors.gateLabel
    ctx.lineWidth = lw * 1.5
    const gate = gateProp !== undefined ? gateProp : findGate(group, group.cscanGateId)
    if (gate && gate.supported && gate.thresholdPct !== null) {
      const st = gate.startUs[props.beam] ?? gate.startUs[0] ?? 0
      const ln = gate.lengthUs[props.beam] ?? gate.lengthUs[0] ?? 0
      const d0 = beamPoint(beam, soundPathMm(beam, st)).depthMm
      const d1 = beamPoint(beam, soundPathMm(beam, st + ln)).depthMm
      // 보이는 깊이 범위와 겹칠 때만 그린다. 라벨은 (잘린) 시작점 바로 아래
      if (d1 >= range.startMm && d0 <= range.endMm) {
        const x = Math.round(X(gate.thresholdPct)) + 0.5
        const y0 = Math.max(0, Y(d0))
        ctx.beginPath()
        ctx.moveTo(x, y0)
        ctx.lineTo(x, Math.min(ph, Y(d1)))
        ctx.stroke()
        const short = /gate\s*(\w)/i.exec(gate.name)?.[1]?.toUpperCase() ?? gate.name
        ctx.fillText(short, x + 3 * ratio, y0 + CANVAS_FONT_PX * ratio)
      }
    }

    // 신호
    const drawSignal = (): void => {
      if (!volume) return
      const off = ascanOffset(group.shape, props.scanIndex, props.beam)
      if (volume.status && !(volume.status[props.scanIndex * group.shape[1] + props.beam]! & 1)) return
      ctx.strokeStyle = colors.ascan
      ctx.lineWidth = lw
      ctx.beginPath()
      for (let i = 0; i < nt; i++) {
        const x = X(rawToPercent(volume.amplitude[off + i] ?? 0, scale))
        const y = Y(samplePoint(beam, i, group.ultrasound).depthMm)
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      }
      ctx.stroke()
    }
    drawSignal()
  }, [pw, ph, ratio, group, gateProp, volume, props.scanIndex, props.beam, props.thicknessMm, range.startMm, range.endMm, scale, ampMax, colors])

  // 라벨 덮개: 신호 위에 따로 겹친 캔버스 (라벨 모드에서만 생김 — 시간 커서를 끌 때 A-scan 을 다시 칠하지 않는다)
  const ovRef = useRef<HTMLCanvasElement>(null)
  const showOverlay = !!overlayStyles
  useEffect(() => {
    const canvas = ovRef.current
    if (!canvas || pw < 1 || ph < 1) return
    const ctx = prepareCanvas(canvas, pw, ph)
    if (!ctx) return
    ctx.clearRect(0, 0, pw, ph)
    if (!overlayStyles || isEmptyOverlay(overlay)) return
    const span = range.endMm - range.startMm || 1
    drawOverlay(ctx, overlay, { x: (p) => axisToPx({ from: 0, to: ampMax }, p, pw), y: (d) => ((d - range.startMm) / span) * ph, width: pw, height: ph }, overlayStyles, ratio)
  }, [pw, ph, ratio, range.startMm, range.endMm, ampMax, overlay, overlayStyles, showOverlay])

  // 기준선: 신호 위 따로 겹친 캔버스 (켤 때만 생김 — 이득·축만 바뀌면 이것만 다시 그린다)
  const lvRef = useRef<HTMLCanvasElement>(null)
  const levels = props.levels ?? null
  const showLevels = !!levels && levels.length > 0
  useEffect(() => {
    const canvas = lvRef.current
    if (!canvas || !levels || pw < 1 || ph < 1) return
    const ctx = prepareCanvas(canvas, pw, ph)
    if (!ctx) return
    ctx.clearRect(0, 0, pw, ph)
    drawLevelLines(ctx, levels, { ampMaxPct: ampMax, width: pw, height: ph }, { stroke: colors.level, font: CANVAS_FONT, fontPx: CANVAS_FONT_PX }, ratio, props.levelTag ?? LEVEL_TAG)
  }, [pw, ph, ratio, ampMax, levels, colors, showLevels, props.levelTag])

  // 보이는 범위 공개 (shared/imaging viewport: x = 진폭 %, y = 펼친 깊이)
  const { onViewport, onTimeCursor } = props
  useEffect(() => {
    if (!onViewport || size.width < 1 || size.height < 1) return
    onViewport({
      kind: 'ascan',
      groupId: group.id,
      beam: props.beam,
      scanWindow: [props.scanIndex, props.scanIndex + 1],
      cssWidth: size.width,
      cssHeight: size.height,
      x: { from: 0, to: ampMax },
      y: { from: range.startMm, to: range.endMm }
    })
  }, [onViewport, group.id, props.beam, props.scanIndex, size.width, size.height, ampMax, range.startMm, range.endMm])
  /** 라벨 모드 시간 커서: 포인터 세로 위치 → 펼친 깊이 (요소 밖은 끝으로 자름) */
  const timeAt = (e: React.PointerEvent<HTMLCanvasElement>): number | null => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!(r.height > 0)) return null
    const y = Math.max(0, Math.min(r.height, e.clientY - r.top))
    return yToDepth(range, y, r.height)
  }

  const { onZoomDepth, onPanDepth } = props
  useWheel(
    canvasRef,
    onZoomDepth
      ? (g) => {
          if (g.shift) onPanDepth?.(g.ticks * 0.1 * (range.endMm - range.startMm))
          else onZoomDepth(g.fy, zoomFactorOf(g.ticks))
        }
      : undefined
  )

  return (
    <div className="vplot vplot--ascan">
      <Axis orientation="left" from={range.startMm} to={range.endMm} length={size.height} title="A-scan 깊이" interaction={props.depthAxis} markerColor={colors.gate} />
      <div className="vplot__box" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="vplot__canvas"
          aria-label={`${group.name} A-scan${onTimeCursor ? ' — 라벨 모드: 클릭·끌기로 시간(깊이) 커서' : ''}`}
          onPointerDown={
            onTimeCursor
              ? (e) => {
                  if (e.button !== 0) return
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId)
                  } catch {
                    // 합성 이벤트(점검 스크립트)에서는 던진다
                  }
                  const d = timeAt(e)
                  if (d !== null) onTimeCursor(d)
                }
              : undefined
          }
          onPointerMove={
            onTimeCursor
              ? (e) => {
                  if (!(e.buttons & 1)) return
                  const d = timeAt(e)
                  if (d !== null) onTimeCursor(d)
                }
              : undefined
          }
        />
        {showLevels ? <canvas ref={lvRef} className="vplot__canvas vplot__overlay vplot__levels" aria-hidden="true" /> : null}
        {showOverlay ? <canvas ref={ovRef} className="vplot__canvas vplot__overlay" aria-hidden="true" /> : null}
      </div>
      {props.colorbar ? (
        <>
          <span />
          <span className="colorbar" style={{ background: props.colorbar }} aria-hidden="true" />
        </>
      ) : null}
      <span />
      <Axis orientation="bottom" from={0} to={ampMax} length={size.width} unit="%" title="진폭" interaction={props.ampAxis} markerColor={colors.gate} />
    </div>
  )
}
