/** 캔버스 공용: 요소 크기 추적, 픽셀 배율, 영상 안 선 색 (테마별 — 영상 안에서만 쓴다, 계획 결정 2) */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { wheelTicks } from '@shared/imaging'
import type { Theme } from '../state/AppContext'

export interface Size {
  width: number
  height: number
}

/** 요소의 CSS 크기 (ResizeObserver). 처음엔 0 */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const r = el.getBoundingClientRect()
      const width = Math.floor(r.width)
      const height = Math.floor(r.height)
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/** 캔버스 내부 해상도 배율: 화면 배율(125/150%)을 따르되 그림 계산량을 위해 픽셀 수를 제한 */
export function pixelRatio(cssW: number, cssH: number, maxPixels = 1_600_000): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const area = Math.max(1, cssW * cssH)
  return Math.max(0.5, Math.min(dpr, Math.sqrt(maxPixels / area)))
}

/** 캔버스 크기를 맞추고 2D 컨텍스트를 돌려준다 (크기가 같으면 지우지 않음) */
export function prepareCanvas(canvas: HTMLCanvasElement, pw: number, ph: number): CanvasRenderingContext2D | null {
  if (canvas.width !== pw) canvas.width = pw
  if (canvas.height !== ph) canvas.height = ph
  return canvas.getContext('2d')
}

/** 영상 안 선 색 한 벌 (의미는 OmniPC 화면과 같음: 게이트 빨강(A-scan 실선, S·B-scan 점선), CL 초록, 현재 빔·스캔 커서 파랑, 스킵선 점선) */
export interface OverlayColors {
  cursor: string
  gate: string
  gateLabel: string
  cl: string
  /** 개선·열영향부 선: 부채꼴 안 / 밖 */
  weld: string
  weldOutside: string
  skip: string
  /** A-scan 신호 */
  ascan: string
  /** A-scan 10 % 격자 */
  grid: string
  /** A-scan 기준선(기록·평가 기준 — Ref 선은 그리지 않음, levelLines.ts) 점선·글자 — 켤 때만 그린다 */
  level: string
  /** 부채꼴 외곽선 — 바탕이 밝아 0 % 흰색과 구분이 안 될 때만 (없으면 null) */
  fanOutline: string | null
}

/**
 * 다크: OmniPC 와 같은 검정 바탕 위 색. 라이트(사용자 결정 2026-10-06 — 라이트에서 영상만 어두우면 보기 불편): 앱과 같은 밝은
 * 바탕(Cloud Gray) 위에서 같은 의미의 색이 읽히게 — 노란 신호 대신 Graphite, 밝은 초록 대신 진한 초록, 회색 점선은 Pewter.
 * 색표(진폭 색)는 두 테마가 같다.
 */
export function overlayColors(theme: Theme): OverlayColors {
  if (theme === 'dark') {
    return {
      cursor: '#2f5bff',
      gate: '#e03030',
      gateLabel: '#ff6b6b',
      cl: '#2ee05a',
      weld: '#141414',
      weldOutside: '#8e8e8e',
      skip: '#9a9a9a',
      ascan: '#f2e530',
      grid: 'rgba(255,255,255,0.08)',
      // Pale Silver (팔레트 색) — 스킵선 회색(9a9a9a)보다 밝게, 게이트 빨강·신호 노랑과 겹치지 않게
      level: '#d0d1d2',
      fanOutline: null
    }
  }
  // 점선(스킵·개선)은 밝은 바탕에서 진하면 영상을 가리므로 연하게 (사용자 피드백 2026-10-06): 안쪽 Silver Fog, 바깥 Mist Dim
  return {
    cursor: '#2f5bff',
    gate: '#e03030',
    gateLabel: '#c0392b',
    cl: '#1a9a3c',
    weld: '#8e8e8e',
    weldOutside: '#b0b2b5',
    skip: '#9a9a9a',
    ascan: '#393c41',
    grid: 'rgba(0,0,0,0.08)',
    // Pewter (팔레트 색, 보조 글자) — 밝은 바탕에서 읽히게
    level: '#5c5e62',
    fanOutline: '#8e8e8e'
  }
}

/**
 * 라벨 모드 덮개 색 (영상 위 상자·점·선 — 라벨 모드에서만, 계획_라벨링/계획.md 6절 결정 6 (가)). 덮개 종류(tone)마다 선·채움.
 * 색표(흰·파랑·초록·노랑·주황·빨강)에 없는 자홍을 기록·초안에(초안 = 점선, 기록 = 실선), 청록을 형상 에코에 쓴다. 기준 커서·시간 커서는 현재 커서와 같은 파랑의 점선
 * (계획_후처리.md 4단계 '새 색 없음'). 빨강(게이트)·노랑(A-scan 신호)과 겹치지 않게 고른다. 디자인 문서 예외 줄의 기준은 이 함수.
 */
export interface LabelToneStyle {
  stroke: string
  /** 채움 (띠·구간). null = 채우지 않음 */
  fill: string | null
  dashed: boolean
}

export type LabelTone = 'draft' | 'ghost' | 'record' | 'selected' | 'positive' | 'weak' | 'ignore' | 'echo' | 'reviewed' | 'quality' | 'below' | 'reference' | 'time' | 'compare'

export function labelOverlayColors(theme: Theme): Record<LabelTone, LabelToneStyle> {
  const dark = theme === 'dark'
  const record = dark ? '#ff4df5' : '#c0109f'
  const cursor = '#2f5bff'
  return {
    // 찍는 중·저장 전 = 기록과 같은 자홍의 점선 (색표 0 % 흰색 위와 다크 검정 바탕 위 모두에서 보이게)
    draft: { stroke: record, fill: null, dashed: true },
    ghost: { stroke: dark ? 'rgba(255,77,245,0.55)' : 'rgba(192,16,159,0.5)', fill: null, dashed: true },
    record: { stroke: record, fill: null, dashed: false },
    selected: { stroke: record, fill: dark ? 'rgba(255,77,245,0.12)' : 'rgba(192,16,159,0.10)', dashed: false },
    positive: { stroke: record, fill: null, dashed: false },
    weak: { stroke: record, fill: null, dashed: true },
    ignore: { stroke: dark ? '#9a9a9a' : '#5c5e62', fill: null, dashed: true },
    echo: { stroke: dark ? '#2fe0f0' : '#00788a', fill: dark ? 'rgba(47,224,240,0.14)' : 'rgba(0,120,138,0.12)', dashed: false },
    reviewed: { stroke: dark ? '#9a9a9a' : '#5c5e62', fill: dark ? 'rgba(154,154,154,0.16)' : 'rgba(92,94,98,0.12)', dashed: false },
    quality: { stroke: dark ? '#b98cff' : '#6b2fc0', fill: dark ? 'rgba(185,140,255,0.16)' : 'rgba(107,47,192,0.12)', dashed: true },
    below: { stroke: dark ? '#d8b25a' : '#7a5c00', fill: dark ? 'rgba(216,178,90,0.14)' : 'rgba(122,92,0,0.10)', dashed: true },
    reference: { stroke: cursor, fill: null, dashed: true },
    time: { stroke: cursor, fill: null, dashed: true },
    // 검수 비교 보기의 B 세트 (A = 기록 자홍) — 자홍·청록(형상 에코)·파랑(커서)과 다른 주황
    compare: { stroke: dark ? '#ff9a3c' : '#b4530a', fill: null, dashed: false }
  }
}

/** 되돌리기 키: Ctrl/Cmd+Z (Shift·Alt 없이). NdeViewer 되돌리기와 끌기 중 막기가 같은 판정을 쓴다 */
export function isUndoShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'code'>): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyZ'
}

/**
 * 게이트·눈금자 끌기 중 되돌리기를 막는다 (Esc 와 달리 끌기는 그대로 이어진다). 끌기 계산은 잡을 때의 게이트(시작 값·초안 base)를
 * 기준으로 하므로, 끄는 도중 되돌리기가 post 를 바꾸면 손을 뗄 때 끝 선이 포인터에서 떨어진 채 커밋된다.
 * window 캡처 단계에 달아 React 루트(NdeViewer onKeyDown)보다 먼저 삼킨다. 돌려준 함수로 뗀다
 */
export function blockUndoWhileDragging(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const block = (e: Event): void => {
    if (!isUndoShortcut(e as KeyboardEvent)) return
    e.preventDefault()
    e.stopPropagation()
  }
  // capture 는 객체로 (불리언 true 로 단 것을 Node EventTarget 은 불리언으로 떼지 못한다 — 브라우저는 둘 다 같음)
  target.addEventListener('keydown', block, { capture: true })
  return () => target.removeEventListener('keydown', block, { capture: true })
}

/** 캔버스 글자 크기 (CSS px, 디자인 최소 12 px) */
export const CANVAS_FONT_PX = 12

/** 캔버스 글자 (앱 번들 글꼴) */
export const CANVAS_FONT = 'Inter, Pretendard, "Segoe UI", "Malgun Gothic", sans-serif'

/** 휠 한 묶음: 틱(양수 = 아래/축소), 포인터 위치 비율, 수정키. deltaX 가 더 크면 horizontal */
export interface WheelGesture {
  ticks: number
  fx: number
  fy: number
  shift: boolean
  alt: boolean
  horizontal: boolean
}

/**
 * 캔버스 휠 → 확대·이동. React onWheel 은 passive 라 페이지 스크롤을 못 막으므로 네이티브 리스너를 단다.
 * deltaMode·트랙패드 미세 delta 는 shared/imaging wheelTicks 로 누적해 틱 단위로만 부른다.
 */
export function useWheel(ref: RefObject<HTMLCanvasElement | null>, onWheel: ((g: WheelGesture) => void) | undefined): void {
  const handler = useRef(onWheel)
  handler.current = onWheel
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let accY = 0
    let accX = 0
    const listener = (e: WheelEvent): void => {
      if (!handler.current) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) return
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      const w = wheelTicks(horizontal ? e.deltaX : e.deltaY, e.deltaMode, horizontal ? accX : accY)
      if (horizontal) accX = w.acc
      else accY = w.acc
      if (w.ticks === 0) return
      const r = el.getBoundingClientRect()
      const fx = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5
      const fy = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5
      handler.current({ ticks: w.ticks, fx, fy, shift: e.shiftKey, alt: e.altKey, horizontal })
    }
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
  }, [ref])
}
