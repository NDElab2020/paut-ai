/** 0° Paintbrush의 직교 인덱스·깊이 격자. 굴절 부채꼴의 이웃 빔 음로 계산과 구별한다. */
import { sampleAtDepth } from './coords'
import type { ViewerGroup } from './types'

type SpatialGroup = Pick<ViewerGroup, 'spatialAxis' | 'beams' | 'ultrasound'>

export function spatialLookupAt(group: SpatialGroup, vMm: number, depthMm: number): {
  beam0: number; beam1: number; weight: number; sample0: number; sample1: number
} | null {
  const axis = group.spatialAxis
  if (!axis || !Number.isFinite(vMm) || !Number.isFinite(depthMm) || depthMm < 0 ||
      !(axis.resolutionMm > 0) || axis.count !== group.beams.length || axis.count < 2) return null
  const cell = (vMm - axis.offsetMm) / axis.resolutionMm
  // 격자 양 끝의 반 칸은 끝 채널로 채우며 격자 밖은 표시하지 않는다.
  if (cell < -0.5 || cell > axis.count - 0.5) return null
  const clamped = Math.max(0, Math.min(axis.count - 1, cell))
  const b0 = Math.floor(clamped)
  const b1 = Math.ceil(clamped)
  const s0 = sampleAtDepth(group.beams[b0]!, depthMm, group.ultrasound)
  const s1 = sampleAtDepth(group.beams[b1]!, depthMm, group.ultrasound)
  const last = group.ultrasound.count - 1
  if (!Number.isFinite(s0) || !Number.isFinite(s1) || s0 < 0 || s0 > last || s1 < 0 || s1 > last) return null
  return { beam0: b0, beam1: b1, weight: clamped - b0, sample0: s0, sample1: s1 }
}
