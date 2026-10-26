/**
 * 시험 기준: 2026-10-07 최적화 전 그리기 함수 그대로 (src/shared/imaging bscan·cscan·sscan 의 예전 본문을 글자 그대로 옮김).
 * tests/imagingFast.test.ts 가 지금 함수와 바이트를 대조한다 — 이 파일은 고치지 않는다.
 */
import {
  DEG,
  cscanBeamAtY,
  cscanScanAtX,
  bscanSampleAtYIn,
  mmPerUs,
  rawToIndex,
  skewSign,
  sscanBeamOrder,
  type BscanRenderInput,
  type CscanRenderInput,
  type GateCscan,
  type SscanMap,
  type SscanRenderInput,
  type SscanViewport,
  type ViewerGroup
} from '@shared/imaging'

interface CscanGrid {
  raw: Int16Array
  has: Int32Array
  rows: number
}

export function renderBscanRef(input: BscanRenderInput): void {
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


export function renderCscanRef(input: CscanRenderInput): void {
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

  for (let y = 0; y < height; y++) {
    const b0 = r0[y]!
    const b1 = r1[y]!
    const wb = rw[y]!
    for (let x = 0; x < width; x++) {
      const s0 = c0[x]!
      const s1 = c1[x]!
      const ws = cw[x]!
      const q = (y * width + x) * 4
      out[q + 3] = 255
      // 가장 가까운 칸이 데이터 없음이면 그 색, 아니면 데이터 있는 이웃만으로 보간
      const near = (ws < 0.5 ? s0 : s1) * rows + (wb < 0.5 ? b0 : b1)
      if (has[near]! < 0) {
        out[q] = noData[0]
        out[q + 1] = noData[1]
        out[q + 2] = noData[2]
        continue
      }
      let acc = 0
      let wsum = 0
      const add = (s: number, b: number, w: number): void => {
        const c = s * rows + b
        if (w > 0 && has[c]! >= 0) {
          acc += raw[c]! * w
          wsum += w
        }
      }
      add(s0, b0, (1 - ws) * (1 - wb))
      add(s1, b0, ws * (1 - wb))
      add(s0, b1, (1 - ws) * wb)
      add(s1, b1, ws * wb)
      const ci = rawToIndex(wsum > 0 ? acc / wsum : 0, indexFactor)
      out[q] = palette[ci * 3]!
      out[q + 1] = palette[ci * 3 + 1]!
      out[q + 2] = palette[ci * 3 + 2]!
    }
  }
}

export function buildSscanMapRef(group: Pick<ViewerGroup, 'beams' | 'ultrasound'>, vp: SscanViewport): SscanMap {
  const nb = group.beams.length
  const nt = group.ultrasound.count
  const n = vp.width * vp.height
  const map: SscanMap = {
    viewport: vp,
    beamCount: nb,
    sampleCount: nt,
    beam0: new Int16Array(n).fill(-1),
    beam1: new Int16Array(n).fill(-1),
    at0: new Int32Array(n),
    at1: new Int32Array(n),
    frac0: new Float32Array(n),
    frac1: new Float32Array(n),
    weight: new Float32Array(n)
  }
  if (nb < 2 || nt < 2) return map

  // 빔 순서는 sscanBeamOrder (φ 가 단조 감소하는 순서 → 아래 이분 탐색)
  const order = sscanBeamOrder(group)
  const th = new Float64Array(nb)
  const vb = new Float64Array(nb)
  const sg = new Float64Array(nb)
  const vel = new Float64Array(nb)
  const t0 = new Float64Array(nb)
  order.forEach((bi, k) => {
    const b = group.beams[bi]!
    th[k] = b.angleDeg * DEG
    vb[k] = b.vOffsetMm
    sg[k] = skewSign(b.skewDeg) ?? 1
    vel[k] = mmPerUs(b.velocityMps)
    t0[k] = b.t0Us
  })
  const res = group.ultrasound.resolutionUs
  const dv = (vp.vMaxMm - vp.vMinMm) / vp.width
  const dd = (vp.depthMaxMm - vp.depthMinMm) / vp.height
  const phi = (k: number, x: number, z: number): number => Math.atan2(sg[k]! * (x - vb[k]!), z) - th[k]!

  for (let py = 0; py < vp.height; py++) {
    const z = vp.depthMinMm + (py + 0.5) * dd
    if (!(z > 0)) continue
    for (let px = 0; px < vp.width; px++) {
      const x = vp.vMinMm + (px + 0.5) * dv
      // φ 는 위 빔 순서로 줄어든다 → φ ≥ 0 인 빔 수 = 첫 φ < 0 위치 (이분 탐색)
      let lo = 0
      let hi = nb
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (phi(mid, x, z) >= 0) lo = mid + 1
        else hi = mid
      }
      if (lo < 1 || lo > nb - 1) continue
      const k0 = lo - 1
      const k1 = lo
      const f0 = phi(k0, x, z)
      const f1 = phi(k1, x, z)
      const w = f0 - f1 > 0 ? f0 / (f0 - f1) : 0
      const i0 = (2 * Math.hypot(x - vb[k0]!, z)) / vel[k0]! - t0[k0]!
      const i1 = (2 * Math.hypot(x - vb[k1]!, z)) / vel[k1]! - t0[k1]!
      const s0 = i0 / res
      const s1 = i1 / res
      if (!(s0 >= 0 && s0 <= nt - 1 && s1 >= 0 && s1 <= nt - 1)) continue
      const p = py * vp.width + px
      const b0 = order[k0]!
      const b1 = order[k1]!
      const j0 = Math.min(nt - 2, Math.floor(s0))
      const j1 = Math.min(nt - 2, Math.floor(s1))
      map.beam0[p] = b0
      map.beam1[p] = b1
      map.at0[p] = b0 * nt + j0
      map.at1[p] = b1 * nt + j1
      map.frac0[p] = s0 - j0
      map.frac1[p] = s1 - j1
      map.weight[p] = w
    }
  }
  return map
}

export function renderSscanRef(input: SscanRenderInput): void {
  const { map, amplitude: A, offset: o, status, indexFactor, palette, noData, background, out } = input
  const so = input.statusOffset ?? 0
  const n = map.viewport.width * map.viewport.height
  for (let p = 0; p < n; p++) {
    const q = p * 4
    const b0 = map.beam0[p]!
    if (b0 < 0) {
      out[q] = background[0]
      out[q + 1] = background[1]
      out[q + 2] = background[2]
      out[q + 3] = background[3]
      continue
    }
    out[q + 3] = 255
    const b1 = map.beam1[p]!
    if (status && (!(status[so + b0]! & 1) || !(status[so + b1]! & 1))) {
      out[q] = noData[0]
      out[q + 1] = noData[1]
      out[q + 2] = noData[2]
      continue
    }
    const a0 = o + map.at0[p]!
    const a1 = o + map.at1[p]!
    const f0 = map.frac0[p]!
    const f1 = map.frac1[p]!
    const w = map.weight[p]!
    const v0 = A[a0]! + (A[a0 + 1]! - A[a0]!) * f0
    const v1 = A[a1]! + (A[a1 + 1]! - A[a1]!) * f1
    const v = v0 + (v1 - v0) * w
    const ci = rawToIndex(v, indexFactor)
    out[q] = palette[ci * 3]!
    out[q + 1] = palette[ci * 3 + 1]!
    out[q + 2] = palette[ci * 3 + 2]!
  }
}
