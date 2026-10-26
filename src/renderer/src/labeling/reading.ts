/**
 * 임의 점의 읽기값 (순수): 진폭 %FSH(파일 이득 그대로 = 소프트 이득 0 dB), 빔·각도·V·펼친/실제 깊이·레그.
 *   S-scan 점: shared/imaging sscanLookupAt (조회표와 같은 이웃 두 빔·샘플·섞음) + sscanRawAt (renderSscan 과 같은 보간)
 *   A-scan 시간 커서: 그 빔 한 줄에서 펼친 깊이 → 샘플 (sampleAtDepth), 샘플 사이 선형
 * 진폭은 화면 이득과 무관하게 파일값으로 낸다 — 기록·변환이 쓰는 값과 같게 (규격_초안.md 1.3 '신호').
 * 포화 = 파일 상한(unitMax, 보통 200 %)에 닿음 — shared/labels derive 규칙(rules.saturationTolPct)과 같은 허용값을 쓴다
 *   (기록의 saturated 와 제안 '포화 불가' 판정이 갈리지 않게).
 * 정수 빔 점(N 키·국소 최대로 붙인 점)은 조회표 끝 빔 선 위에서 sscanLookupAt 이 null 일 수 있어 pointReading 이 그 빔 A-scan 으로 읽는다.
 */
import {
  beamPoint,
  foldDepth,
  rawToPercent,
  sampleAtDepth,
  sampleTimeUs,
  soundPathMm,
  sscanLookupAngleDeg,
  sscanLookupAt,
  sscanLookupBeamSample,
  sscanRawAt,
  type ViewerGroup
} from '@shared/imaging'
import { DEFAULT_DERIVE_RULES } from '@shared/labels'

/** 포화로 보는 여유 (%FSH) — derive 규칙과 같은 값 (shared/labels DEFAULT_DERIVE_RULES.saturationTolPct) */
export const SATURATION_TOL_PCT = DEFAULT_DERIVE_RULES.saturationTolPct

export interface PointReading {
  groupId: number
  /** 그 S-scan·A-scan 의 스캔 칸과 위치 */
  scanIndex: number
  scanMm: number
  /** 용접 중심선(CL) 기준 V (mm) */
  vMm: number
  /** 펼친 깊이 (S-scan 세로) */
  unfoldedDepthMm: number
  /** 실제 깊이 (두께 안으로 접음). 두께를 모르면 펼친 깊이 */
  depthMm: number
  /** 레그 (1부터). 두께를 모르면 null */
  leg: number | null
  /** 빔 (실수, 조회표 규칙)·가장 가까운 빔·굴절각 */
  beam: number
  nearestBeam: number
  angleDeg: number
  /** 샘플 (실수) */
  sample: number
  /** 음로 (mm) — 빔 b 출사점에서 */
  soundPathMm: number
  /** 진폭 %FSH (파일 이득 그대로). 볼륨이 없거나 그 칸이 데이터 없음이면 null */
  amplitudePct: number | null
  /** 파일 상한에 닿음 (포화) */
  saturated: boolean
}

type Volume = { amplitude: Int16Array; status: Uint8Array | null }
type Group = Pick<ViewerGroup, 'id' | 'beams' | 'ultrasound' | 'shape' | 'scan' | 'ampScale'>

function pctOf(raw: number | null, group: Group): { pct: number | null; saturated: boolean } {
  if (raw === null) return { pct: null, saturated: false }
  const pct = rawToPercent(raw, group.ampScale)
  return { pct, saturated: pct >= group.ampScale.unitMax - SATURATION_TOL_PCT }
}

/** S-scan 위 점 (V, 펼친 깊이) 의 읽기값. 부채꼴 밖이면 null */
export function sscanPointReading(group: Group, volume: Volume | null, scanIndex: number, vMm: number, unfoldedDepthMm: number, thicknessMm: number | null): PointReading | null {
  const l = sscanLookupAt(group, vMm, unfoldedDepthMm)
  if (!l) return null
  const { beam, sample } = sscanLookupBeamSample(l)
  const nearest = Math.min(group.beams.length - 1, Math.max(0, Math.round(beam)))
  const amp = pctOf(volume ? sscanRawAt(l, volume, group.shape, scanIndex) : null, group)
  const f = foldDepth(unfoldedDepthMm, thicknessMm)
  const b = group.beams[nearest]!
  return {
    groupId: group.id,
    scanIndex,
    scanMm: group.scan.offsetMm + scanIndex * group.scan.resolutionMm,
    vMm,
    unfoldedDepthMm,
    depthMm: f.depthMm,
    leg: f.leg,
    beam,
    nearestBeam: nearest,
    angleDeg: sscanLookupAngleDeg(group, l),
    sample,
    soundPathMm: Math.hypot(vMm - b.vOffsetMm, unfoldedDepthMm),
    amplitudePct: amp.pct,
    saturated: amp.saturated
  }
}

/**
 * 칸 하나 (스캔 k, 빔 b, 샘플 s — 정수) 의 읽기값. 칸 중심의 V·펼친 깊이 (빔 b 출사점에서 그 샘플 음로).
 * 범위 밖이면 null. 진폭은 그 칸 원값 (보간 없음)
 */
export function cellReading(group: Group, volume: Volume | null, k: number, b: number, s: number, thicknessMm: number | null): PointReading | null {
  const bm = group.beams[b]
  const [ns, nb] = group.shape
  const nt = group.ultrasound.count
  if (!bm || k < 0 || k >= ns || s < 0 || s >= nt) return null
  let raw: number | null = null
  if (volume && (!volume.status || (volume.status[k * nb + b]! & 1) === 1)) raw = volume.amplitude[(k * nb + b) * nt + s] ?? null
  const amp = pctOf(raw, group)
  const r = soundPathMm(bm, sampleTimeUs(bm, s, group.ultrasound))
  const p = beamPoint(bm, r)
  const f = foldDepth(p.depthMm, thicknessMm)
  return {
    groupId: group.id,
    scanIndex: k,
    scanMm: group.scan.offsetMm + k * group.scan.resolutionMm,
    vMm: p.vMm,
    unfoldedDepthMm: p.depthMm,
    depthMm: f.depthMm,
    leg: f.leg,
    beam: b,
    nearestBeam: b,
    angleDeg: bm.angleDeg,
    sample: s,
    soundPathMm: r,
    amplitudePct: amp.pct,
    saturated: amp.saturated
  }
}

/** 찾을 영역: 스캔 칸 [k0, k1] × 빔 [b0, b1] × 펼친 깊이 [d0, d1] (mm) */
export interface CellRegion {
  k0: number
  k1: number
  b0: number
  b1: number
  d0: number
  d1: number
}

/**
 * 영역 안 원값 최대 칸의 읽기값 (데이터 없음 칸은 뺀다). 볼륨이 없거나 칸이 하나도 없으면 null.
 * 기록의 신호 칸(지시의 최대 진폭)은 찍은 점 한 픽셀이 아니라 이 값이다 — 0.5 mm 만 비켜 찍어도 최대의 절반이 되는 일을 막는다.
 */
export function regionPeakReading(group: Group, volume: Volume | null, region: CellRegion, thicknessMm: number | null): PointReading | null {
  if (!volume) return null
  const [ns, nb] = group.shape
  const nt = group.ultrasound.count
  const k0 = Math.max(0, Math.floor(region.k0))
  const k1 = Math.min(ns - 1, Math.ceil(region.k1))
  const b0 = Math.max(0, Math.floor(region.b0))
  const b1 = Math.min(nb - 1, Math.ceil(region.b1))
  let best = -Infinity
  let at: [number, number, number] | null = null
  for (let b = b0; b <= b1; b++) {
    const bm = group.beams[b]
    if (!bm) continue
    const sa = sampleAtDepth(bm, region.d0, group.ultrasound)
    const sb = sampleAtDepth(bm, region.d1, group.ultrasound)
    if (!Number.isFinite(sa) || !Number.isFinite(sb)) continue
    const s0 = Math.max(0, Math.floor(Math.min(sa, sb)))
    const s1 = Math.min(nt - 1, Math.ceil(Math.max(sa, sb)))
    for (let k = k0; k <= k1; k++) {
      if (volume.status && (volume.status[k * nb + b]! & 1) !== 1) continue
      const o = (k * nb + b) * nt
      for (let s = s0; s <= s1; s++) {
        const v = volume.amplitude[o + s]!
        if (v > best) {
          best = v
          at = [k, b, s]
        }
      }
    }
  }
  return at ? cellReading(group, volume, at[0], at[1], at[2], thicknessMm) : null
}

/** A-scan 한 빔의 펼친 깊이 depthMm 에서의 읽기값 (시간 커서). 샘플 범위 밖이면 null */
export function ascanDepthReading(group: Group, volume: Volume | null, scanIndex: number, beam: number, depthMm: number, thicknessMm: number | null): PointReading | null {
  const bm = group.beams[beam]
  const nt = group.ultrasound.count
  if (!bm || nt < 2) return null
  const s = sampleAtDepth(bm, depthMm, group.ultrasound)
  if (!(s >= 0 && s <= nt - 1)) return null
  let raw: number | null = null
  const [ns, nb] = group.shape
  if (volume && scanIndex >= 0 && scanIndex < ns && (!volume.status || (volume.status[scanIndex * nb + beam]! & 1) === 1)) {
    const j = Math.min(nt - 2, Math.floor(s))
    const o = (scanIndex * nb + beam) * nt + j
    const A = volume.amplitude
    if (o + 1 < A.length) raw = A[o]! + (A[o + 1]! - A[o]!) * (s - j)
  }
  const amp = pctOf(raw, group)
  const r = soundPathMm(bm, sampleTimeUs(bm, s, group.ultrasound))
  const p = beamPoint(bm, r)
  const f = foldDepth(p.depthMm, thicknessMm)
  return {
    groupId: group.id,
    scanIndex,
    scanMm: group.scan.offsetMm + scanIndex * group.scan.resolutionMm,
    vMm: p.vMm,
    unfoldedDepthMm: p.depthMm,
    depthMm: f.depthMm,
    leg: f.leg,
    beam,
    nearestBeam: beam,
    angleDeg: bm.angleDeg,
    sample: s,
    soundPathMm: r,
    amplitudePct: amp.pct,
    saturated: amp.saturated
  }
}
