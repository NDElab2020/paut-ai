/** A-scan: 한 칸(스캔 k, 빔 b)의 진폭(%)과 깊이축 */
import { samplePoint } from './coords'
import { rawToPercent } from './palette'
import type { ViewerGroup } from './types'

/** 진폭 조각 안에서 (조각 안 스캔 s, 빔 b) A-scan 의 시작 위치 */
export function ascanOffset(shape: readonly [number, number, number], s: number, b: number): number {
  return (s * shape[1] + b) * shape[2]
}

/** A-scan 을 %FSH 로 */
export function ascanPercent(amplitude: Int16Array, offset: number, group: Pick<ViewerGroup, 'ultrasound' | 'ampScale'>): Float32Array {
  const nt = group.ultrasound.count
  const out = new Float32Array(nt)
  for (let i = 0; i < nt; i++) out[i] = rawToPercent(amplitude[offset + i] ?? 0, group.ampScale)
  return out
}

/** 빔 b 의 A-scan 깊이축: 첫·끝 샘플의 펼친 깊이 (mm) */
export function ascanDepthRange(group: Pick<ViewerGroup, 'beams' | 'ultrasound'>, b: number): { startMm: number; endMm: number } {
  const beam = group.beams[b]
  if (!beam) return { startMm: 0, endMm: 1 }
  return {
    startMm: samplePoint(beam, 0, group.ultrasound).depthMm,
    endMm: samplePoint(beam, group.ultrasound.count - 1, group.ultrasound).depthMm
  }
}

/** 구간 [i0, i1) 의 최대값 */
export function ascanPeak(values: ArrayLike<number>, i0 = 0, i1 = values.length): { value: number; sample: number } {
  let m = -Infinity
  let mi = -1
  for (let i = Math.max(0, i0); i < Math.min(values.length, i1); i++) {
    const v = values[i]!
    if (v > m) {
      m = v
      mi = i
    }
  }
  return { value: mi < 0 ? 0 : m, sample: mi }
}
