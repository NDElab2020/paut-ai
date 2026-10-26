/**
 * 뷰 화면 ↔ 검사 좌표 (라벨 모드 덮개·클릭·읽기값용, 순수 — 런타임 의존성 없음).
 * 네 뷰 모두 두 축이 선형이라 '축 값 [from, to] = 요소 왼쪽(위) 끝·오른쪽(아래) 끝의 값' 하나로 나타낸다:
 *   S-scan: x = V (mm, 용접 중심선 CL 기준), y = 펼친 깊이 (mm)        — sscan.ts viewportPixel 과 같은 식
 *   C-scan: x = 스캔 위치 U (mm), y = 빔 번호 (실수, 0부터 · 칸 b = [b − ½, b + ½]) — cscan.ts cscanXForScan·cscanYForBeam 과 같은 식
 *   B-scan: x = 스캔 위치 U (mm), y = 펼친 깊이 (mm, 그 빔)            — BscanView 의 게이트·스킵 선과 같은 식
 *   A-scan: x = 진폭 (%), y = 펼친 깊이 (mm, 그 빔)                    — AscanView 의 X()·Y() 와 같은 식
 * 길이(px)만 바꿔 CSS px(포인터)와 캔버스 버퍼 px(그리기) 모두 같은 함수를 쓴다 — 캔버스는 요소 전체로 늘어나 보이므로 비율이 같다.
 * 기존 그리기 코드는 이 파일을 쓰지 않는다 (보통 모드 그림 불변). 라벨 모드 덮개와 클릭 변환만 쓴다.
 */
import { scanPositionMm } from './coords'
import type { ViewerScanAxis } from './types'

/** 축 값: 요소 시작(왼쪽·위) 끝의 값 from, 끝(오른쪽·아래) 끝의 값 to. from > to 면 뒤집힌 축 */
export interface ViewAxis {
  from: number
  to: number
}

export type ViewKind = 'sscan' | 'cscan' | 'bscan' | 'ascan'

/** 한 뷰가 지금 보이는 범위 (onViewport 로 공개). 요소 CSS 크기와 두 축 */
export interface ViewViewport {
  kind: ViewKind
  groupId: number
  /** S·C-scan = 현재 빔, B·A-scan = 그리는 빔 */
  beam: number
  /** C·B-scan: 그 스캔 창 [k0, k1). S·A-scan 은 그리는 스캔 칸 [k, k + 1) */
  scanWindow: [number, number]
  cssWidth: number
  cssHeight: number
  x: ViewAxis
  y: ViewAxis
}

/** 축 값 → 위치 (0..length) */
export function axisToPx(a: ViewAxis, value: number, length: number): number {
  return ((value - a.from) / (a.to - a.from)) * length
}

/** 위치 (0..length) → 축 값 */
export function pxToAxis(a: ViewAxis, px: number, length: number): number {
  return a.from + (px / length) * (a.to - a.from)
}

/** 검사 좌표(뷰 축 단위) → 요소 안 CSS px */
export function viewToCss(vp: Pick<ViewViewport, 'x' | 'y' | 'cssWidth' | 'cssHeight'>, xv: number, yv: number): { x: number; y: number } {
  return { x: axisToPx(vp.x, xv, vp.cssWidth), y: axisToPx(vp.y, yv, vp.cssHeight) }
}

/** 요소 안 CSS px → 검사 좌표(뷰 축 단위) */
export function cssToView(vp: Pick<ViewViewport, 'x' | 'y' | 'cssWidth' | 'cssHeight'>, x: number, y: number): { x: number; y: number } {
  return { x: pxToAxis(vp.x, x, vp.cssWidth), y: pxToAxis(vp.y, y, vp.cssHeight) }
}

/** 검사 좌표 → 캔버스 버퍼 px (그리기). width·height = 캔버스 버퍼 크기 */
export function viewToPx(vp: Pick<ViewViewport, 'x' | 'y'>, xv: number, yv: number, width: number, height: number): { x: number; y: number } {
  return { x: axisToPx(vp.x, xv, width), y: axisToPx(vp.y, yv, height) }
}

/**
 * C·B-scan 가로축: 스캔 칸 창 [k0, k1) → U(mm). 칸 가운데가 칸 위치, 양 끝은 반 칸씩 (눈금자와 같은 범위:
 * scanPositionMm(k0) − Δu/2 ~ scanPositionMm(k1 − 1) + Δu/2). cscanXForScan 과 같은 자리.
 */
export function scanViewAxis(scan: ViewerScanAxis, k0: number, k1: number): ViewAxis {
  const half = scan.resolutionMm / 2
  return { from: scanPositionMm(k0, scan) - half, to: scanPositionMm(k1, scan) - half }
}

/** U(mm) → 스캔 칸 (실수, 반올림·자르기 없음) */
export function scanIndexAtMm(scan: ViewerScanAxis, mm: number): number {
  return (mm - scan.offsetMm) / scan.resolutionMm
}

/** C-scan 세로축: 빔 번호 (실수). reversed = 첫 빔이 아래 (cscanYForBeam 과 같은 자리) */
export function cscanBeamViewAxis(beamCount: number, reversed: boolean): ViewAxis {
  return reversed ? { from: beamCount - 0.5, to: -0.5 } : { from: -0.5, to: beamCount - 0.5 }
}

/** A·B-scan 깊이 → 세로 위치 (0..height). range = 위 끝·아래 끝 펼친 깊이 (AscanView·BscanView 의 Y() 와 같은 식) */
export function depthToY(range: { startMm: number; endMm: number }, depthMm: number, height: number): number {
  return ((depthMm - range.startMm) / (range.endMm - range.startMm || 1)) * height
}

/** 세로 위치 → 펼친 깊이 (depthToY 의 역) */
export function yToDepth(range: { startMm: number; endMm: number }, y: number, height: number): number {
  return range.startMm + (y / height) * (range.endMm - range.startMm || 1)
}
