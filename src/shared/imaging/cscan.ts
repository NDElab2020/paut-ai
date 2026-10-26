/**
 * C-scan 그리기: 가로 = 스캔, 세로 = 빔(굴절각). 칸 값(게이트 최대 raw)을 화면 크기로 '값'에서 쌍선형 보간한 뒤 색을 칠한다
 * (색을 보간하면 OmniPC 의 진한 파란 테두리가 흐려진다).
 * reversed = true 면 첫 빔(작은 각도)이 아래 (파일 ModelSetup IsCScanReversed, X3 화면과 일치).
 * 칸이 픽셀보다 많은 축(축소)은 픽셀이 덮는 칸들의 최대를 칠한다 (좁은 지시가 빠지지 않게).
 */
import type { GateCscan } from './gates'
import { rawToIndex } from './palette'
import { packPalette, packRgba, rgba32Target } from './rgba32'

export interface CscanRenderInput {
  cscan: GateCscan
  /** 그릴 스캔 범위 [scanFrom, scanTo) — 기본 전체 */
  scanFrom?: number
  scanTo?: number
  width: number
  height: number
  reversed: boolean
  indexFactor: number
  palette: Uint8Array
  noData: readonly [number, number, number]
  out: Uint8ClampedArray | Uint8Array
}

/** 화면 세로 위치 y(픽셀 중심) → 빔 좌표(실수, 0..nb-1) */
export function cscanBeamAtY(y: number, height: number, beamCount: number, reversed: boolean): number {
  const r = ((y + 0.5) * beamCount) / height - 0.5
  return reversed ? beamCount - 1 - r : r
}

/** 빔 좌표 → 화면 세로 위치 (그 빔 칸의 중심) */
export function cscanYForBeam(b: number, height: number, beamCount: number, reversed: boolean): number {
  const r = reversed ? beamCount - 1 - b : b
  return ((r + 0.5) * height) / beamCount
}

/** 화면 가로 위치 → 스캔 좌표(실수) */
export function cscanScanAtX(x: number, width: number, scanFrom: number, scanTo: number): number {
  return scanFrom + ((x + 0.5) * (scanTo - scanFrom)) / width - 0.5
}

export function cscanXForScan(k: number, width: number, scanFrom: number, scanTo: number): number {
  return ((k - scanFrom + 0.5) * width) / (scanTo - scanFrom)
}

/** 그릴 칸 격자 — 원본 C-scan 이거나, 화면보다 칸이 많은 축을 픽셀 단위 최대로 줄인 것 */
interface CscanGrid {
  raw: Int16Array
  /** < 0 = 데이터 없음 */
  has: Int32Array
  /** 열(스캔) 하나에 든 행(빔) 수 */
  rows: number
}

/**
 * 화면보다 칸이 많은 축은 픽셀 하나가 덮는 칸들 [floor(x·칸/픽셀), ceil((x+1)·칸/픽셀)) 의 최대로 줄인다.
 * 데이터 있는 칸만 보고, 범위 안 칸이 모두 데이터 없음일 때만 데이터 없음. 줄이지 않는 축은 칸 그대로 (열 0 = scanFrom).
 * 픽셀 중심 한 점만 읽으면 사이 칸이 빠져 한 스캔짜리 좁은 지시가 사라진다.
 */
function reduceCscan(cscan: GateCscan, from: number, to: number, width: number, height: number, reversed: boolean): CscanGrid {
  const nb = cscan.beamCount
  const ns = to - from
  const sDec = ns > width
  const bDec = nb > height
  const cols = sDec ? width : ns
  const rows = bDec ? height : nb
  // 열마다 스캔 범위, 행마다 빔 범위 (정수 곱셈 뒤 나누기라 경계가 정확하다)
  const sLo = new Int32Array(cols)
  const sHi = new Int32Array(cols)
  for (let c = 0; c < cols; c++) {
    sLo[c] = sDec ? from + Math.floor((c * ns) / width) : from + c
    sHi[c] = sDec ? Math.min(to, from + Math.ceil(((c + 1) * ns) / width)) : from + c + 1
  }
  const bLo = new Int32Array(rows)
  const bHi = new Int32Array(rows)
  for (let r = 0; r < rows; r++) {
    if (!bDec) {
      bLo[r] = r
      bHi[r] = r + 1
      continue
    }
    // 화면 행 r 이 덮는 '화면 순서' 빔 [lo, hi) → reversed 면 빔 번호 nb−1−(…)
    const lo = Math.floor((r * nb) / height)
    const hi = Math.min(nb, Math.ceil(((r + 1) * nb) / height))
    bLo[r] = reversed ? nb - hi : lo
    bHi[r] = reversed ? nb - lo : hi
  }
  const raw = new Int16Array(cols * rows)
  const has = new Int32Array(cols * rows).fill(-1)
  const R = cscan.peakRaw
  const H = cscan.peakSample
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let m = 0
      let any = false
      for (let s = sLo[c]!; s < sHi[c]!; s++) {
        for (let b = bLo[r]!; b < bHi[r]!; b++) {
          const cell = s * nb + b
          if (H[cell]! < 0) continue
          if (!any || R[cell]! > m) m = R[cell]!
          any = true
        }
      }
      if (any) {
        raw[c * rows + r] = m
        has[c * rows + r] = 0
      }
    }
  }
  return { raw, has, rows }
}

export function renderCscan(input: CscanRenderInput): void {
  const { cscan, width, height, reversed, indexFactor, palette, noData, out } = input
  const nb = cscan.beamCount
  const from = input.scanFrom ?? 0
  const to = input.scanTo ?? cscan.scanCount
  // 축소 축(칸 > 픽셀)은 픽셀마다 줄인 칸 하나를 그대로, 확대 축은 이웃 칸 사이를 값으로 쌍선형 보간 (OmniPC 와 같음)
  const sDec = to - from > width
  const bDec = nb > height
  const reduced = sDec || bDec
  const grid: CscanGrid = reduced
    ? reduceCscan(cscan, from, to, width, height, reversed)
    : { raw: cscan.peakRaw, has: cscan.peakSample, rows: nb }
  const raw = grid.raw
  const has = grid.has
  const rows = grid.rows
  // 줄인 격자는 열 0 이 scanFrom, 원본은 열 = 스캔 번호
  const colBase = reduced ? from : 0
  const clampS = (v: number): number => (v < from ? from : v > to - 1 ? to - 1 : v)
  const clampB = (v: number): number => (v < 0 ? 0 : v > nb - 1 ? nb - 1 : v)

  // 픽셀 열·행마다 이웃 칸과 비율을 미리 구한다
  const c0 = new Int32Array(width)
  const c1 = new Int32Array(width)
  const cw = new Float64Array(width)
  for (let x = 0; x < width; x++) {
    if (sDec) {
      c0[x] = x
      c1[x] = x
      continue
    }
    const sf = clampS(cscanScanAtX(x, width, from, to))
    const s0 = Math.floor(sf)
    c0[x] = s0 - colBase
    c1[x] = Math.min(to - 1, s0 + 1) - colBase
    cw[x] = sf - s0
  }
  const r0 = new Int32Array(height)
  const r1 = new Int32Array(height)
  const rw = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    if (bDec) {
      r0[y] = y
      r1[y] = y
      continue
    }
    const bf = clampB(cscanBeamAtY(y, height, nb, reversed))
    const b0 = Math.floor(bf)
    r0[y] = b0
    r1[y] = Math.min(nb - 1, b0 + 1)
    rw[y] = bf - b0
  }

  // 화소마다 클로저를 만들지 않고 이웃 네 칸을 예전 add() 와 같은 순서·같은 식으로 더하고, Uint32 한 번에 쓴다 (rgba32.ts — 바이트 같음,
  // tests/imagingFast.test.ts 가 예전 함수와 대조. 레티나 2400×400 19 → 9.5 ms)
  const P = packPalette(out, palette)
  const zero = packRgba(out, 0, 0, 0, 255)
  const nd = packRgba(out, noData[0], noData[1], noData[2], 255)
  const { px, done } = rgba32Target(out, Math.max(0, width) * Math.max(0, height))
  for (let y = 0; y < height; y++) {
    const b0 = r0[y]!
    const b1 = r1[y]!
    const wb = rw[y]!
    const nearB = wb < 0.5 ? b0 : b1
    const row = y * width
    for (let x = 0; x < width; x++) {
      const s0 = c0[x]!
      const s1 = c1[x]!
      const ws = cw[x]!
      // 가장 가까운 칸이 데이터 없음이면 그 색, 아니면 데이터 있는 이웃만으로 보간
      if (has[(ws < 0.5 ? s0 : s1) * rows + nearB]! < 0) {
        px[row + x] = nd
        continue
      }
      let acc = 0
      let wsum = 0
      let c = s0 * rows + b0
      let w = (1 - ws) * (1 - wb)
      if (w > 0 && has[c]! >= 0) {
        acc += raw[c]! * w
        wsum += w
      }
      c = s1 * rows + b0
      w = ws * (1 - wb)
      if (w > 0 && has[c]! >= 0) {
        acc += raw[c]! * w
        wsum += w
      }
      c = s0 * rows + b1
      w = (1 - ws) * wb
      if (w > 0 && has[c]! >= 0) {
        acc += raw[c]! * w
        wsum += w
      }
      c = s1 * rows + b1
      w = ws * wb
      if (w > 0 && has[c]! >= 0) {
        acc += raw[c]! * w
        wsum += w
      }
      px[row + x] = P[rawToIndex(wsum > 0 ? acc / wsum : 0, indexFactor)] ?? zero
    }
  }
  done()
}
