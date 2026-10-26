/**
 * 검사 좌표 변환 (OmniPC X3 화면과 대조해 맞춘 규칙 — 계획_이미지보기/조사_기록.md 2절).
 *
 *   t_i   = t0 + i·Δt                      빔 출사점 기준 왕복 시간 (µs)
 *   r     = v · t / 2                      음로 (mm)
 *   깊이  = r · cosθ                       펼친 깊이
 *   V     = vOffset + s · r · sinθ         s = +1 (skew 90), −1 (skew 270)
 *   U(k)  = offset + k · Δu
 */
import type { ViewerBeam, ViewerGroup, ViewerScanAxis, ViewerUltrasoundAxis } from './types'

export const DEG = Math.PI / 180

/** m/s → mm/µs */
export function mmPerUs(velocityMps: number): number {
  return velocityMps * 1e-3
}

/** 빔 진행 방향의 V 부호. skew 90 → +1, 270 → −1, 그 밖(0·180 등 V 축과 나란하지 않음)은 null */
export function skewSign(skewDeg: number): 1 | -1 | null {
  const s = ((Math.round(skewDeg) % 360) + 360) % 360
  if (s === 90) return 1
  if (s === 270) return -1
  return null
}

/** 샘플 i 의 시각 (µs) */
export function sampleTimeUs(beam: ViewerBeam, i: number, us: ViewerUltrasoundAxis): number {
  return beam.t0Us + i * us.resolutionUs
}

/** 시각 → 음로 (mm) */
export function soundPathMm(beam: ViewerBeam, tUs: number): number {
  return (mmPerUs(beam.velocityMps) * tUs) / 2
}

/** 음로 → 시각 (µs) */
export function timeForSoundPathUs(beam: ViewerBeam, rMm: number): number {
  return (2 * rMm) / mmPerUs(beam.velocityMps)
}

/** 시각 → 샘플 번호 (실수) */
export function sampleAt(beam: ViewerBeam, tUs: number, us: ViewerUltrasoundAxis): number {
  return (tUs - beam.t0Us) / us.resolutionUs
}

/** 음로 r 지점의 검사 좌표 (V, 펼친 깊이) */
export function beamPoint(beam: ViewerBeam, rMm: number): { vMm: number; depthMm: number } {
  const s = skewSign(beam.skewDeg) ?? 1
  const th = beam.angleDeg * DEG
  return { vMm: beam.vOffsetMm + s * rMm * Math.sin(th), depthMm: rMm * Math.cos(th) }
}

/** 샘플 i 의 검사 좌표 */
export function samplePoint(beam: ViewerBeam, i: number, us: ViewerUltrasoundAxis): { vMm: number; depthMm: number } {
  return beamPoint(beam, soundPathMm(beam, sampleTimeUs(beam, i, us)))
}

/** 펼친 깊이 → 깊이(mm) 에 해당하는 샘플 번호 (실수) */
export function sampleAtDepth(beam: ViewerBeam, depthMm: number, us: ViewerUltrasoundAxis): number {
  const r = depthMm / Math.cos(beam.angleDeg * DEG)
  return sampleAt(beam, timeForSoundPathUs(beam, r), us)
}

/** 스캔 칸 k 의 위치 (mm) */
export function scanPositionMm(k: number, axis: ViewerScanAxis): number {
  return axis.offsetMm + k * axis.resolutionMm
}

/** 위치(mm) → 가장 가까운 스캔 칸 (반올림, 범위로 자름). OmniPC 38.93 mm → 39번째 칸 */
export function scanIndexAt(uMm: number, axis: ViewerScanAxis): number {
  const k = Math.round((uMm - axis.offsetMm) / axis.resolutionMm)
  return Math.min(axis.count - 1, Math.max(0, k))
}

/**
 * 펼친 깊이를 두께 안으로 접는다. leg 1 = 표면→바닥(첫 레그), 2 = 바닥→표면 ...
 * 두께를 모르면 그대로 돌려준다 (leg null).
 */
export function foldDepth(depthMm: number, thicknessMm: number | null): { depthMm: number; leg: number | null } {
  if (!thicknessMm || !(thicknessMm > 0)) return { depthMm, leg: null }
  const n = Math.max(0, Math.floor(depthMm / thicknessMm))
  const within = depthMm - n * thicknessMm
  return { depthMm: n % 2 === 0 ? within : thicknessMm - within, leg: n + 1 }
}

/** 그룹 S-scan 부채꼴이 차지하는 범위 (모든 빔의 첫·끝 샘플 점) */
export function sscanExtent(group: Pick<ViewerGroup, 'beams' | 'ultrasound' | 'spatialAxis'>): {
  vMinMm: number
  vMaxMm: number
  depthMinMm: number
  depthMaxMm: number
} {
  let vMin = Infinity
  let vMax = -Infinity
  let dMin = Infinity
  let dMax = -Infinity
  const last = Math.max(0, group.ultrasound.count - 1)
  for (const b of group.beams) {
    for (const i of [0, last]) {
      const p = samplePoint(b, i, group.ultrasound)
      vMin = Math.min(vMin, p.vMm)
      vMax = Math.max(vMax, p.vMm)
      dMin = Math.min(dMin, p.depthMm)
      dMax = Math.max(dMax, p.depthMm)
    }
  }
  if (group.spatialAxis) {
    vMin = group.spatialAxis.offsetMm - group.spatialAxis.resolutionMm / 2
    vMax = group.spatialAxis.offsetMm + (group.spatialAxis.count - 0.5) * group.spatialAxis.resolutionMm
  }
  if (!Number.isFinite(vMin)) return { vMinMm: 0, vMaxMm: 1, depthMinMm: 0, depthMaxMm: 1 }
  return { vMinMm: vMin, vMaxMm: vMax, depthMinMm: dMin, depthMaxMm: dMax }
}
