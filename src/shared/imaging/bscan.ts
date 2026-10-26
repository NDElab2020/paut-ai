/**
 * B-scan: 가로 = 스캔, 세로 = 현재 빔의 펼친 깊이(첫 샘플 → 끝 샘플, 한 빔 안에서는 시간에 비례).
 * OmniPC A-B-C-S 의 왼쪽 아래 (TP14 .opd 화면 기준). .nde B-scan 은 OmniPC 화면과 아직 대조 전.
 * 확대(스캔 수 ≤ 가로 픽셀)는 값 쌍선형 보간, 축소는 덮는 스캔들의 최대값 (좁은 지시가 사라지지 않게).
 */
import { rawToIndex } from './palette'
import { packPalette, packRgba, rgba32Target } from './rgba32'
import type { ViewerGroup } from './types'

export interface BscanRenderInput {
  group: Pick<ViewerGroup, 'shape'>
  amplitude: Int16Array
  status: Uint8Array | null
  beam: number
  width: number
  height: number
  scanFrom?: number
  scanTo?: number
  /**
   * 세로 창: 캔버스 위 끝·아래 끝의 샘플 좌표(실수). 생략하면 [−0.5, nt−0.5] (샘플 nt 개를 칸으로 채움 — 지금 규칙).
   * 깊이 창은 한 빔 안에서 샘플에 비례하므로 sampleAtDepth 로 바꿔 넘긴다.
   */
  sampleFrom?: number
  sampleTo?: number
  indexFactor: number
  palette: Uint8Array
  noData: readonly [number, number, number]
  out: Uint8ClampedArray | Uint8Array
}

/** 화면 세로 위치 → 샘플 좌표 (실수). 창 [from, to] 는 캔버스 위·아래 끝의 샘플 좌표 */
export function bscanSampleAtYIn(y: number, height: number, from: number, to: number): number {
  return from + ((y + 0.5) * (to - from)) / height
}

export function bscanYForSampleIn(i: number, height: number, from: number, to: number): number {
  return ((i - from) * height) / (to - from)
}

/** 화면 세로 위치 → 샘플 좌표 (실수), 전체 샘플을 칸으로 채운 기본 창 */
export function bscanSampleAtY(y: number, height: number, sampleCount: number): number {
  return bscanSampleAtYIn(y, height, -0.5, sampleCount - 0.5)
}

export function bscanYForSample(i: number, height: number, sampleCount: number): number {
  return bscanYForSampleIn(i, height, -0.5, sampleCount - 0.5)
}

/**
 * B-scan 을 RGBA 로 칠한다. 행(깊이) 우선으로 돌며 행마다 샘플 위치·비율과 스캔 칸별 샘플 값을, 열마다 스캔 범위·비율을, 스캔마다
 * 데이터 있음·A-scan 시작을 한 번만 구하고 화소는 Uint32 한 번에 쓴다(rgba32.ts). 식·순서는 renderBscanGeneric(예전 열 우선 그대로)과 같아 바이트가 같다
 * (tests/imagingFast.test.ts — 창·깊이 창·묶음·상태 비트·4바이트 경계 아닌 out 까지 예전 함수와 바이트 대조, 레티나 2400×600 51 → 12 ms).
 * 스캔 창·캔버스 크기가 정수가 아니면(앱은 늘 정수) 예전 함수로 그린다.
 */
export function renderBscan(input: BscanRenderInput): void {
  const [ns, nb, nt] = input.group.shape
  const from = input.scanFrom ?? 0
  const to = input.scanTo ?? ns
  const { amplitude: A, status, beam: b, width, height, indexFactor, palette, noData, out } = input
  if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(width) || !Number.isInteger(height)) return renderBscanGeneric(input)
  if (width <= 0 || height <= 0) return
  const sFrom = input.sampleFrom ?? -0.5
  const sTo = input.sampleTo ?? nt - 0.5
  const span = Math.max(1, to - from)
  const perPx = span / width
  const pool = perPx > 1
  // 열마다 쓰는 스캔: 축소면 덮는 범위 전부(최대값), 확대면 이웃 두 칸(보간) — 예전과 같은 식
  const K0 = new Float64Array(width)
  const K1 = new Float64Array(width)
  const WK = new Float64Array(width)
  let kLo = Infinity
  let kHi = -Infinity
  for (let x = 0; x < width; x++) {
    let k0: number
    let k1: number
    if (pool) {
      k0 = from + Math.floor(x * perPx)
      k1 = Math.min(to, from + Math.ceil((x + 1) * perPx)) - 1
    } else {
      const kf = Math.min(to - 1, Math.max(from, from + (x + 0.5) * perPx - 0.5))
      k0 = Math.floor(kf)
      k1 = Math.min(to - 1, k0 + 1)
      WK[x] = kf - k0
    }
    K0[x] = k0
    K1[x] = k1
    if (k0 < kLo) kLo = k0
    if (k1 > kHi) kHi = k1
  }
  // 스캔마다 데이터 있음 · 이 빔 A-scan 시작 (범위 밖 칸도 예전 식 그대로 — 상태가 없으면 '있음', 진폭은 읽어 NaN)
  const nk = kHi >= kLo ? kHi - kLo + 1 : 0
  const HAS = new Uint8Array(nk)
  const BASE = new Float64Array(nk)
  for (let j = 0; j < nk; j++) {
    const k = kLo + j
    HAS[j] = !status || (status[k * nb + b]! & 1) === 1 ? 1 : 0
    BASE[j] = (k * nb + b) * nt
  }
  const P = packPalette(out, palette)
  const zero = packRgba(out, 0, 0, 0, 255)
  const nd = packRgba(out, noData[0], noData[1], noData[2], 255)
  const { px, done } = rgba32Target(out, width * height)
  // 행마다 스캔 칸별 샘플 값 (같은 행에서 같은 스캔을 쓰는 열이 여럿이어도 한 번만 — 예전 sample(k) 와 같은 식이라 같은 값)
  const S = new Float64Array(nk)
  for (let y = 0; y < height; y++) {
    const sf = Math.min(nt - 1, Math.max(0, bscanSampleAtYIn(y, height, sFrom, sTo)))
    const i0 = Math.min(nt - 2, Math.floor(sf))
    const fi = sf - i0
    for (let j = 0; j < nk; j++) {
      if (!HAS[j]) continue
      const a = BASE[j]! + i0
      S[j] = A[a]! + (A[a + 1]! - A[a]!) * fi
    }
    const row = y * width
    for (let x = 0; x < width; x++) {
      const j0 = K0[x]! - kLo
      const j1 = K1[x]! - kLo
      let v = 0
      let any = false
      if (pool) {
        for (let j = j0; j <= j1; j++) {
          if (!HAS[j]) continue
          const s = S[j]!
          if (!any || s > v) v = s
          any = true
        }
      } else {
        const wk = WK[x]!
        if (HAS[wk < 0.5 ? j0 : j1]) {
          any = true
          const h0 = HAS[j0]
          const h1 = HAS[j1]
          if (h0 && h1) {
            const s0 = S[j0]!
            v = s0 + (S[j1]! - s0) * wk
          } else v = S[h0 ? j0 : j1]!
        }
      }
      px[row + x] = any ? (P[rawToIndex(v, indexFactor)] ?? zero) : nd
    }
  }
  done()
}

/** 예전 그리기 (열 우선, 화소마다 샘플 위치 계산) — 스캔 창·크기가 정수가 아닐 때만, 그리고 시험의 바이트 기준 */
export function renderBscanGeneric(input: BscanRenderInput): void {
  const { amplitude: A, status, beam: b, width, height, indexFactor, palette, noData, out } = input
  const [ns, nb, nt] = input.group.shape
  const from = input.scanFrom ?? 0
  const to = input.scanTo ?? ns
  const sFrom = input.sampleFrom ?? -0.5
  const sTo = input.sampleTo ?? nt - 0.5
  const span = Math.max(1, to - from)
  const perPx = span / width
  const has = (k: number): boolean => !status || (status[k * nb + b]! & 1) === 1
  const at = (k: number, i: number): number => A[(k * nb + b) * nt + i]!

  for (let x = 0; x < width; x++) {
    // 이 열이 쓰는 스캔: 축소면 덮는 범위 전부(최대값), 확대면 이웃 두 칸(보간)
    let k0: number
    let k1: number
    let wk = 0
    const pool = perPx > 1
    if (pool) {
      k0 = from + Math.floor(x * perPx)
      k1 = Math.min(to, from + Math.ceil((x + 1) * perPx)) - 1
    } else {
      const kf = Math.min(to - 1, Math.max(from, from + (x + 0.5) * perPx - 0.5))
      k0 = Math.floor(kf)
      k1 = Math.min(to - 1, k0 + 1)
      wk = kf - k0
    }
    for (let y = 0; y < height; y++) {
      const q = (y * width + x) * 4
      out[q + 3] = 255
      const sf = Math.min(nt - 1, Math.max(0, bscanSampleAtYIn(y, height, sFrom, sTo)))
      const i0 = Math.min(nt - 2, Math.floor(sf))
      const fi = sf - i0
      const sample = (k: number): number => at(k, i0) + (at(k, i0 + 1) - at(k, i0)) * fi
      let v = 0
      let any = false
      if (pool) {
        for (let k = k0; k <= k1; k++) {
          if (!has(k)) continue
          const s = sample(k)
          if (!any || s > v) v = s
          any = true
        }
      } else {
        const near = wk < 0.5 ? k0 : k1
        if (has(near)) {
          any = true
          const h0 = has(k0)
          const h1 = has(k1)
          v = h0 && h1 ? sample(k0) + (sample(k1) - sample(k0)) * wk : sample(h0 ? k0 : k1)
        }
      }
      if (!any) {
        out[q] = noData[0]
        out[q + 1] = noData[1]
        out[q + 2] = noData[2]
        continue
      }
      const ci = rawToIndex(v, indexFactor)
      out[q] = palette[ci * 3]!
      out[q + 1] = palette[ci * 3 + 1]!
      out[q + 2] = palette[ci * 3 + 2]!
    }
  }
}
