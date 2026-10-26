/**
 * S-scan 한 점 (V, 펼친 깊이) 의 조회 — buildSscanMap 이 그 점에서 고르는 이웃 두 빔·두 샘플 위치·섞음 비율을 조회표 없이 낸다
 * (라벨 모드 점 찍기·읽기값용, 순수). buildSscanMap 은 조회표 바이트가 고정(SHA-256 대조)이라 고치지 않고 같은 식을 여기 따로 둔다 —
 * 픽셀 중심에서 조회표와 같은 값인지 tests/labeling/sscanPoint.test.ts 가 확인한다.
 *   1) 빔 순서(sscanBeamOrder)에서 φ_b = atan2(s·(V − V_b), z) − θ_b 의 부호가 바뀌는 이웃 쌍 (b0, b1), w = φ0 / (φ0 − φ1)
 *   2) 두 빔 각자의 샘플 위치 s = (2·|P − E_b| / v − t0) / Δt (같은 음로)
 * 부채꼴 밖(φ 부호가 안 바뀜)·샘플 범위 밖·깊이 ≤ 0 이면 null — 조회표에서 그 픽셀이 칠해지지 않는 경우와 같다.
 */
import { DEG, mmPerUs, skewSign } from './coords'
import { sscanBeamOrder } from './sscan'
import { spatialLookupAt } from './spatial'
import type { ViewerGroup } from './types'

export interface SscanPointLookup {
  /** 이웃 두 빔 (파일 빔 번호, 조회표 beam0·beam1) */
  beam0: number
  beam1: number
  /** beam1 쪽 섞음 비율 (조회표 weight, 0..1) */
  weight: number
  /** 두 빔 각자의 샘플 위치 (실수, 0..nt−1) */
  sample0: number
  sample1: number
}

/** 점 (vMm, 펼친 깊이) 의 조회 — buildSscanMap 의 한 픽셀 계산과 같은 식·같은 순서 */
export function sscanLookupAt(group: Pick<ViewerGroup, 'beams' | 'ultrasound' | 'spatialAxis'>, vMm: number, depthMm: number): SscanPointLookup | null {
  if (group.spatialAxis) return spatialLookupAt(group, vMm, depthMm)
  const nb = group.beams.length
  const nt = group.ultrasound.count
  if (nb < 2 || nt < 2) return null
  const z = depthMm
  const x = vMm
  if (!(z > 0) || !Number.isFinite(x)) return null
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
  const phi = (k: number): number => Math.atan2(sg[k]! * (x - vb[k]!), z) - th[k]!
  let lo = 0
  let hi = nb
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (phi(mid) >= 0) lo = mid + 1
    else hi = mid
  }
  if (lo < 1 || lo > nb - 1) return null
  const k0 = lo - 1
  const k1 = lo
  const f0 = phi(k0)
  const f1 = phi(k1)
  const w = f0 - f1 > 0 ? f0 / (f0 - f1) : 0
  const i0 = (2 * Math.hypot(x - vb[k0]!, z)) / vel[k0]! - t0[k0]!
  const i1 = (2 * Math.hypot(x - vb[k1]!, z)) / vel[k1]! - t0[k1]!
  const s0 = i0 / res
  const s1 = i1 / res
  if (!(s0 >= 0 && s0 <= nt - 1 && s1 >= 0 && s1 <= nt - 1)) return null
  return { beam0: order[k0]!, beam1: order[k1]!, weight: w, sample0: s0, sample1: s1 }
}

/**
 * 조회 → 원자료 앵커의 빔·샘플 (실수). 이웃 빔 번호가 붙어 있으면 b0 + w·(b1 − b0)·s0 + w·(s1 − s0),
 * 아니면 가까운 쪽 빔 하나 (shared/labels derive pointToAnchor 와 같은 규칙)
 */
export function sscanLookupBeamSample(l: SscanPointLookup): { beam: number; sample: number } {
  if (Math.abs(l.beam1 - l.beam0) === 1) return { beam: l.beam0 + l.weight * (l.beam1 - l.beam0), sample: l.sample0 + l.weight * (l.sample1 - l.sample0) }
  return l.weight < 0.5 ? { beam: l.beam0, sample: l.sample0 } : { beam: l.beam1, sample: l.sample1 }
}

/**
 * 조회한 점의 진폭 raw (보간한 실수) — renderSscan 이 그 픽셀을 칠할 때와 같은 식(샘플 사이 선형, 두 빔 섞음, 조회표의 Float32 비율).
 * amplitude 는 [스캔, 빔, 샘플] 볼륨, scanIndex 는 그 안의 스캔 칸. 두 빔 중 하나라도 데이터 없음(상태 비트 1 = 0)이면 null
 */
export function sscanRawAt(
  l: SscanPointLookup,
  volume: { amplitude: Int16Array; status: Uint8Array | null },
  shape: readonly [number, number, number],
  scanIndex: number
): number | null {
  const [ns, nb, nt] = shape
  if (!(scanIndex >= 0 && scanIndex < ns)) return null
  const st = volume.status
  if (st && (!(st[scanIndex * nb + l.beam0]! & 1) || !(st[scanIndex * nb + l.beam1]! & 1))) return null
  const A = volume.amplitude
  const o = scanIndex * nb * nt
  const j0 = Math.min(nt - 2, Math.floor(l.sample0))
  const j1 = Math.min(nt - 2, Math.floor(l.sample1))
  const a0 = o + l.beam0 * nt + j0
  const a1 = o + l.beam1 * nt + j1
  if (a0 + 1 >= A.length || a1 + 1 >= A.length) return null
  // 조회표는 비율·가중치를 Float32 로 든다 — 같은 값으로 맞춘다
  const f0 = Math.fround(l.sample0 - j0)
  const f1 = Math.fround(l.sample1 - j1)
  const w = Math.fround(l.weight)
  const v0 = A[a0]! + (A[a0 + 1]! - A[a0]!) * f0
  const v1 = A[a1]! + (A[a1 + 1]! - A[a1]!) * f1
  return v0 + (v1 - v0) * w
}

/** 조회한 점의 굴절각 (두 빔 사이 섞음 비율로 선형) */
export function sscanLookupAngleDeg(group: Pick<ViewerGroup, 'beams'>, l: SscanPointLookup): number {
  const a0 = group.beams[l.beam0]?.angleDeg ?? 0
  const a1 = group.beams[l.beam1]?.angleDeg ?? a0
  return a0 + (a1 - a0) * l.weight
}
