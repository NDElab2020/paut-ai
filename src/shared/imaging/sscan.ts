/**
 * S-scan(섹토리얼·리니어·컴파운드, 펼친 깊이) 그리기.
 *
 * 화면 점 P=(V, 깊이) 마다:
 *  1) 빔마다 자기 출사점 E_b 에서 본 P 의 방향과 빔 굴절각의 차 φ_b = atan2(s·(V−V_b), 깊이) − θ_b 를 구해
 *     부호가 바뀌는 이웃 빔 쌍 (b0, b1) 을 찾는다 ((굴절각, 출사점) 순서로 φ 는 단조).
 *  2) 두 빔 각각에서 같은 음로 r = |P − E_b| 의 샘플을 선형 보간하고, 가중치 w = φ_b0 / (φ_b0 − φ_b1) 로 섞는다.
 * 같은 '깊이'로 보간하면 결함이 가로 줄무늬로 깨져 OmniPC 와 달라진다 (조사_기록.md 2절, 대조그림/cmp2_sscan_*.png).
 * 조회표(SscanMap)는 화면 크기·범위가 바뀔 때만 다시 만들고, 스캔 위치를 옮길 때는 renderSscan 만 부른다.
 * 칠하는 영역의 외곽선(라이트 테마 외곽선·개선 덮개 클립)은 sscanOutline — 같은 규칙에서 해석적으로 낸 경계(톱니 포함).
 */
import { DEG, mmPerUs, samplePoint, skewSign } from './coords'
import { rawToIndex } from './palette'
import { packPalette, packRgba, rgba32Target } from './rgba32'
import type { ViewerGroup } from './types'
import { spatialLookupAt } from './spatial'

export interface SscanViewport {
  vMinMm: number
  vMaxMm: number
  depthMinMm: number
  depthMaxMm: number
  /** 픽셀 크기 */
  width: number
  height: number
}

export interface SscanMap {
  viewport: SscanViewport
  beamCount: number
  sampleCount: number
  /** 픽셀마다 앞 빔 번호, 부채꼴 밖이면 -1 */
  beam0: Int16Array
  beam1: Int16Array
  /** 빔 안 샘플 위치 (b·샘플수 + i0) */
  at0: Int32Array
  at1: Int32Array
  /** 샘플 사이 비율 */
  frac0: Float32Array
  frac1: Float32Array
  /** b1 쪽 가중치 */
  weight: Float32Array
}

/** 검사 좌표 → 픽셀 (실수) */
export function viewportPixel(vp: SscanViewport, vMm: number, depthMm: number): { x: number; y: number } {
  return {
    x: ((vMm - vp.vMinMm) * vp.width) / (vp.vMaxMm - vp.vMinMm),
    y: ((depthMm - vp.depthMinMm) * vp.height) / (vp.depthMaxMm - vp.depthMinMm)
  }
}

/**
 * S-scan 빔 순서 (조회표 이분 탐색·외곽선 공통) = (굴절각, s·출사점 V) 사전식 오름차순. 값은 파일 빔 번호.
 * φ_b = atan2(s·(x − V_b), z) − θ_b 는 θ_b 가 커져도 s·V_b 가 커져도 줄어 이 순서에서 단조 감소한다 → 이분 탐색이 성립한다
 * (리니어·컴파운드는 meta.ts beamOrderProblem 이 이 조건을 확인).
 *  - 섹토리얼: 굴절각이 모두 달라 둘째 기준을 쓰지 않는다 → 굴절각 순서 그대로 (파일이 70→40 으로 저장돼도 같은 규칙, 조회표 바이트 동일)
 *  - 리니어: 굴절각이 모두 같아(TF_01_L GR-2 60°) 출사점 순서. skew 270 이면 s = −1 이라 V 가 큰 빔부터
 *  - 컴파운드: 굴절각과 출사점이 함께 +s 쪽으로 움직인다 (TF_01_C_L 50→68°, V −45.2→−22.5 mm)
 */
export function sscanBeamOrder(group: Pick<ViewerGroup, 'beams'>): number[] {
  const key = (i: number): number => (skewSign(group.beams[i]!.skewDeg) ?? 1) * group.beams[i]!.vOffsetMm
  return group.beams.map((_, i) => i).sort((a, b) => group.beams[a]!.angleDeg - group.beams[b]!.angleDeg || key(a) - key(b))
}

export function buildSscanMap(group: Pick<ViewerGroup, 'beams' | 'ultrasound' | 'spatialAxis'>, vp: SscanViewport): SscanMap {
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
  if (group.spatialAxis) {
    for (let y = 0; y < vp.height; y++) {
      const depth = vp.depthMinMm + (y + 0.5) * (vp.depthMaxMm - vp.depthMinMm) / vp.height
      for (let x = 0; x < vp.width; x++) {
        const v = vp.vMinMm + (x + 0.5) * (vp.vMaxMm - vp.vMinMm) / vp.width
        const lookup = spatialLookupAt(group, v, depth)
        if (!lookup) continue
        const p = y * vp.width + x
        const j0 = Math.min(nt - 2, Math.floor(lookup.sample0))
        const j1 = Math.min(nt - 2, Math.floor(lookup.sample1))
        map.beam0[p] = lookup.beam0; map.beam1[p] = lookup.beam1
        map.at0[p] = lookup.beam0 * nt + j0; map.at1[p] = lookup.beam1 * nt + j1
        map.frac0[p] = lookup.sample0 - j0; map.frac1[p] = lookup.sample1 - j1
        map.weight[p] = lookup.weight
      }
    }
    return map
  }

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
  // 열마다 화소 중심 V (예전 화소마다 계산하던 식 그대로)
  const X = new Float64Array(vp.width)
  for (let px = 0; px < vp.width; px++) X[px] = vp.vMinMm + (px + 0.5) * dv

  for (let py = 0; py < vp.height; py++) {
    const z = vp.depthMinMm + (py + 0.5) * dd
    if (!(z > 0)) continue
    for (let px = 0; px < vp.width; px++) {
      const x = X[px]!
      // φ_k = atan2(s·(x − V_k), z) − θ_k 는 위 빔 순서로 줄어든다 → φ ≥ 0 인 빔 수 = 첫 φ < 0 위치 (이분 탐색).
      // 탐색 중 lo 를 올린 마지막 φ = φ(lo−1), hi 를 내린 마지막 φ = φ(hi) 를 남겨 아래 섞음에 그대로 쓴다 — 칠하는 화소(1 ≤ lo ≤ nb−1)는
      // 둘 다 반드시 한 번 계산했고 같은 식이라 값이 같다 (atan2 를 화소마다 2번 덜 — 조회표 바이트 같음, tests/imagingFast.test.ts)
      let lo = 0
      let hi = nb
      let f0 = 0
      let f1 = 0
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const f = Math.atan2(sg[mid]! * (x - vb[mid]!), z) - th[mid]!
        if (f >= 0) {
          lo = mid + 1
          f0 = f
        } else {
          hi = mid
          f1 = f
        }
      }
      if (lo < 1 || lo > nb - 1) continue
      const k0 = lo - 1
      const k1 = lo
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

/** 외곽선에서 이웃 두 빔 사이(띠)의 원호를 나누는 현 수. 띠 폭 2 mm·반지름 10 mm 에서도 현과 호의 거리 ≤ 0.003 mm (TF 컴파운드 실제 ≈ 0.002) */
export const SSCAN_OUTLINE_SUBDIV = 4

/** 외곽선 계산용 빔 (정렬 순서): 출사점 V, 방향 (V, 깊이) 단위 벡터, 첫·끝 샘플의 음로 */
interface OutlineBeam {
  v: number
  dx: number
  dz: number
  rFirst: number
  rLast: number
}

/** 띠 안 사잇선: 출사점·방향을 u 로 섞은 반직선 (u = 0 → 빔 a 선, 1 → 빔 b 선) */
interface SideRay {
  ox: number
  dx: number
  dz: number
}

function sideRay(a: OutlineBeam, b: OutlineBeam, u: number): SideRay {
  const dx = a.dx + (b.dx - a.dx) * u
  const dz = a.dz + (b.dz - a.dz) * u
  const len = Math.hypot(dx, dz) || 1
  return { ox: a.v + (b.v - a.v) * u, dx: dx / len, dz: dz / len }
}

/** 사잇선 P(t) = O + t·D 가 원 (중심 (e, 0), 반지름 R) 과 만나는 t 두 개 (작은 것, 큰 것). 만나지 않으면 null */
function circleRoots(r: SideRay, e: number, R: number): [number, number] | null {
  // |P − E|² = t² + 2·t·dx·(ox − e) + (ox − e)²
  const c = r.ox - e
  const b = r.dx * c
  const disc = b * b - c * c + R * R
  if (disc < 0) return null
  const q = Math.sqrt(disc)
  return [-b - q, -b + q]
}

/**
 * 사잇선 위에서 칠하는 구간의 시작(end = false) 또는 끝(end = true) t 와, 그 경계를 묶는 조건 번호
 * (시작: 0 표면 · 1 빔 a 첫 샘플 원 · 2 빔 b 첫 샘플 원 · 3·4 끝 샘플 원 안쪽 시작, 끝: 0 빔 a 끝 샘플 원 · 1 빔 b).
 * 첫 샘플 원은 바깥이어야 하므로 큰 근, 끝 샘플 원은 안이어야 하므로 [작은 근, 큰 근]. 원과 안 만나면 첫 샘플 조건은 없음, 끝 샘플 조건은 빈 구간
 */
function bandBound(a: OutlineBeam, b: OutlineBeam, u: number, end: boolean): { r: SideRay; t: number; by: number } {
  const r = sideRay(a, b, u)
  const la = circleRoots(r, a.v, a.rLast)
  const lb = circleRoots(r, b.v, b.rLast)
  if (end) {
    const ta = la ? la[1] : -Infinity
    const tb = lb ? lb[1] : -Infinity
    return ta <= tb ? { r, t: ta, by: 0 } : { r, t: tb, by: 1 }
  }
  const outside = (e: number, R: number): number => (R > 0 ? Math.max(0, circleRoots(r, e, R)?.[1] ?? 0) : 0)
  const cands = [0, outside(a.v, a.rFirst), outside(b.v, b.rFirst), la ? la[0] : -Infinity, lb ? lb[0] : -Infinity]
  let by = 0
  for (let i = 1; i < cands.length; i++) if (cands[i]! > cands[by]!) by = i
  return { r, t: cands[by]!, by }
}

/** 띠 (a, b) 의 시작 또는 끝 경계 점 (u 오름차순). 묶는 원이 바뀌는 곳(두 원의 교점)은 이분법으로 찾아 넣는다 */
function bandEdge(a: OutlineBeam, b: OutlineBeam, end: boolean, floor: ((u: number) => number) | null): Array<{ u: number; t: number; r: SideRay }> {
  const at = (u: number): { r: SideRay; t: number; by: number } => {
    const x = bandBound(a, b, u, end)
    // 끝 경계가 시작 경계보다 앞이면(칠할 구간이 빈 사잇선 — 실데이터에는 없음) 시작 경계에 붙여 선이 뒤집히지 않게
    return floor ? { ...x, t: Math.max(x.t, floor(u)) } : x
  }
  const out: Array<{ u: number; t: number; r: SideRay }> = []
  let prev = at(0)
  out.push({ u: 0, t: prev.t, r: prev.r })
  for (let i = 1; i <= SSCAN_OUTLINE_SUBDIV; i++) {
    const u = i / SSCAN_OUTLINE_SUBDIV
    const cur = at(u)
    if (cur.by !== prev.by) {
      // 묶는 조건이 바뀌는 u (한 띠에서 두 원은 z > 0 쪽 한 점에서만 만난다)
      let lo = (i - 1) / SSCAN_OUTLINE_SUBDIV
      let hi = u
      for (let it = 0; it < 48; it++) {
        const mid = (lo + hi) / 2
        if (at(mid).by === prev.by) lo = mid
        else hi = mid
      }
      const c = at(hi)
      out.push({ u: hi, t: c.t, r: c.r })
    }
    out.push({ u, t: cur.t, r: cur.r })
    prev = cur
  }
  return out
}

/**
 * S-scan 데이터 경계 = buildSscanMap 이 칠하는 영역의 외곽선 (검사 좌표 닫힌 꺾은선, 마지막 점 → 첫 점으로 닫음).
 * 라이트 테마 부채꼴 외곽선·개선 덮개 클립이 쓴다 (빔 첫·끝 샘플 점을 곧게 이으면 톱니 홈을 가로질러 컴파운드에서 최대 1.3 mm 어긋남).
 * 칠하는 규칙: 정렬된 이웃 빔 (k, k+1) 사이 띠의 점 P 는 두 빔 각각 자기 출사점 E 에서 r = |P − E| 의 샘플이 [0, nt−1] 안일 때만
 *   → 띠마다 시작 경계 = 두 원 (E_k, r첫_k)·(E_k+1, r첫_k+1) 바깥의 경계(바깥 원호 둘 + 교점),
 *     끝 경계 = 두 원 (E_k, r끝_k)·(E_k+1, r끝_k+1) 안쪽의 경계, 띠 사이는 빔 선을 따라 뛴다(톱니의 빔 방향 변).
 * 띠는 빔 k 선과 k+1 선 사이를 사잇선(출사점·방향을 u 로 섞은 반직선)으로 훑는다 — 섹토리얼(출사점이 거의 같음)·리니어(평행)·
 *   컴파운드(출사점과 각도가 함께 +s 로 움직여 벌어짐) 모두 이웃 빔 선이 z > 0 에서 만나지 않아 사잇선이 띠를 겹치지 않고 채운다.
 *   원호는 띠마다 SSCAN_OUTLINE_SUBDIV 개 현으로 근사한다.
 * 순서: 시작 경계를 첫 빔 → 끝 빔, 끝 빔 선을 따라 끝 경계로, 끝 경계를 끝 빔 → 첫 빔 (첫 빔 선으로 닫힘).
 * 빔 < 2 또는 샘플 < 2 면 빈 배열 (조회표도 비어 있다)
 */
export function sscanOutline(group: Pick<ViewerGroup, 'beams' | 'ultrasound' | 'spatialAxis'>): Array<{ vMm: number; depthMm: number }> {
  if (group.spatialAxis && group.beams.length >= 2) {
    const a = group.spatialAxis
    const first = samplePoint(group.beams[0]!, 0, group.ultrasound).depthMm
    const last = samplePoint(group.beams[0]!, group.ultrasound.count - 1, group.ultrasound).depthMm
    const left = a.offsetMm - a.resolutionMm / 2
    const right = a.offsetMm + (a.count - 0.5) * a.resolutionMm
    return [{ vMm: left, depthMm: first }, { vMm: right, depthMm: first }, { vMm: right, depthMm: last }, { vMm: left, depthMm: last }]
  }
  const nb = group.beams.length
  const nt = group.ultrasound.count
  if (nb < 2 || nt < 2) return []
  const res = group.ultrasound.resolutionUs
  // buildSscanMap 과 같은 식: 샘플 위치 s = (2r/v − t0)/Δt ∈ [0, nt−1] ⇔ r ∈ [v·t0/2, v·(t0 + (nt−1)·Δt)/2]
  const beams: OutlineBeam[] = sscanBeamOrder(group).map((bi) => {
    const b = group.beams[bi]!
    const s = skewSign(b.skewDeg) ?? 1
    const th = b.angleDeg * DEG
    const vel = mmPerUs(b.velocityMps)
    return { v: b.vOffsetMm, dx: s * Math.sin(th), dz: Math.cos(th), rFirst: (vel * b.t0Us) / 2, rLast: (vel * (b.t0Us + (nt - 1) * res)) / 2 }
  })
  const point = (p: { t: number; r: SideRay }): { vMm: number; depthMm: number } => ({ vMm: p.r.ox + p.t * p.r.dx, depthMm: p.t * p.r.dz })
  const starts: Array<{ vMm: number; depthMm: number }> = []
  const ends: Array<Array<{ vMm: number; depthMm: number }>> = []
  for (let k = 0; k + 1 < nb; k++) {
    const a = beams[k]!
    const b = beams[k + 1]!
    for (const p of bandEdge(a, b, false, null)) starts.push(point(p))
    ends.push(bandEdge(a, b, true, (u) => bandBound(a, b, u, false).t).map(point).reverse())
  }
  const out: Array<{ vMm: number; depthMm: number }> = []
  for (const p of [...starts, ...ends.reverse().flat()]) {
    const q = out[out.length - 1]
    // 띠 사이에서 경계가 뛰지 않으면 같은 점이 둘 — 하나만
    if (!q || Math.abs(q.vMm - p.vMm) > 1e-9 || Math.abs(q.depthMm - p.depthMm) > 1e-9) out.push(p)
  }
  return out
}

export interface SscanRenderInput {
  map: SscanMap
  /** 진폭 배열 (여러 스캔이 이어진 볼륨이어도 됨) */
  amplitude: Int16Array
  /** amplitude 안에서 이 스캔 위치(빔×샘플 한 장)가 시작하는 곳 */
  offset: number
  /** 상태 비트 (빔마다, statusOffset 부터). 없으면 모두 데이터 있음 */
  status?: Uint8Array | null
  statusOffset?: number
  /** rawIndexFactor(ampScale) */
  indexFactor: number
  /** paletteRgb() 256×3 */
  palette: Uint8Array
  noData: readonly [number, number, number]
  /** 부채꼴 밖 RGBA */
  background: readonly [number, number, number, number]
  /** 결과 RGBA (width×height×4) */
  out: Uint8ClampedArray | Uint8Array
}

/**
 * 한 스캔 위치의 S-scan 을 RGBA 로 칠한다. 화소는 Uint32 한 번에 쓴다(rgba32.ts — 바이트별로 쓴 예전 그림과 바이트가 같음,
 * tests/imagingFast.test.ts). 스캔 커서를 옮길 때마다 도는 길이고 학습 내보내기 그림도 이 함수다
 */
export function renderSscan(input: SscanRenderInput): void {
  const { map, amplitude: A, offset: o, status, indexFactor, palette, noData, background, out } = input
  const so = input.statusOffset ?? 0
  const n = map.viewport.width * map.viewport.height
  const { beam0, beam1, at0, at1, frac0, frac1, weight } = map
  const P = packPalette(out, palette)
  const zero = packRgba(out, 0, 0, 0, 255)
  const nd = packRgba(out, noData[0], noData[1], noData[2], 255)
  const bg = packRgba(out, background[0], background[1], background[2], background[3])
  const { px, done } = rgba32Target(out, Math.max(0, n))
  for (let p = 0; p < n; p++) {
    const b0 = beam0[p]!
    if (b0 < 0) {
      px[p] = bg
      continue
    }
    const b1 = beam1[p]!
    if (status && (!(status[so + b0]! & 1) || !(status[so + b1]! & 1))) {
      px[p] = nd
      continue
    }
    const a0 = o + at0[p]!
    const a1 = o + at1[p]!
    const v0 = A[a0]! + (A[a0 + 1]! - A[a0]!) * frac0[p]!
    const v1 = A[a1]! + (A[a1 + 1]! - A[a1]!) * frac1[p]!
    const v = v0 + (v1 - v0) * weight[p]!
    px[p] = P[rawToIndex(v, indexFactor)] ?? zero
  }
  done()
}
