/** 사람이 읽는 요약·이름 제안 */
import { planNameFrom } from '@shared/planName'
import type { BeamGroupSpec, ScanPlanSpec, SpecimenShape } from '@shared/types'
import { fmtNum } from './units'

export const SHAPE_LABEL: Record<SpecimenShape, string> = {
  plate: '판재',
  pipe: '배관',
  bar: '봉재',
  unspecified: '형상 미지정',
  unknown: '형상 미상'
}

const FORMATION_LABEL: Record<string, string> = { sectorial: '섹터', linear: '선형', compound: '복합' }

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

/** 모델 다중집합: ['A','A','B'] → 'A ×2 + B' */
export function formatMultiset(items: string[]): string {
  const counts = new Map<string, number>()
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(' + ')
}

/** 오프셋 집합: [-15, 15] → '±15', [-3, 9] → '-3, +9' (단위 없음) */
export function formatOffsets(values: number[]): string {
  const set = uniq(values).sort((a, b) => a - b)
  if (set.length === 0) return ''
  const paired = set.every((v) => v !== 0 && set.includes(-v))
  if (paired) return uniq(set.map(Math.abs)).map((v) => `±${fmtNum(v)}`).join('/')
  return set.map((v) => (v > 0 ? `+${fmtNum(v)}` : fmtNum(v))).join(', ')
}

export function angleRangeText(g: BeamGroupSpec): string {
  const r = g.refractedAngle
  if (!r || r.startDeg === null) return ''
  if (r.stopDeg === null || r.stopDeg === r.startDeg) return `${fmtNum(r.startDeg)}°`
  return `${fmtNum(r.startDeg)}–${fmtNum(r.stopDeg)}°`
}

/** 그룹 한 개 기법 설명: 'PA 섹터 40–70°', 'UT 45°', 'ToFD', 'TFM T-T' */
export function techniqueText(g: BeamGroupSpec): string {
  const angle = angleRangeText(g)
  switch (g.technique) {
    case 'PA':
      return ['PA', FORMATION_LABEL[g.formation] ?? '', angle].filter(Boolean).join(' ')
    case 'UT':
      return ['UT', angle].filter(Boolean).join(' ')
    case 'TFM':
      return ['TFM', String(g.techniqueParams['pathName'] ?? '')].filter(Boolean).join(' ')
    case 'other':
      return `미지원(${String(g.techniqueParams['unsupported'] ?? '?')})`
    default:
      return g.technique
  }
}

function techniquesText(groups: BeamGroupSpec[]): string {
  const tfm = groups.filter((g) => g.technique === 'TFM')
  const rest = uniq(groups.filter((g) => g.technique !== 'TFM').map(techniqueText))
  if (tfm.length) rest.push(`TFM ${uniq(tfm.map((g) => String(g.techniqueParams['pathName'] ?? '?'))).join('/')}`)
  return rest.join(' + ')
}

export function allProbes(spec: ScanPlanSpec): BeamGroupSpec['probes'] {
  return spec.groups.flatMap((g) => g.probes)
}

/** 그룹들이 같은 탐촉자를 공유할 수 있으므로 (모델, 위치) 단위로 한 번만 센다 */
export function physicalProbes(spec: ScanPlanSpec): BeamGroupSpec['probes'] {
  const seen = new Set<string>()
  return allProbes(spec).filter((p) => {
    const key = JSON.stringify([p.probe.model, p.wedge?.model, p.orientation, p.position])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function vOffsets(spec: ScanPlanSpec): number[] {
  return physicalProbes(spec)
    .map((p) => p.position?.vOffsetMm)
    .filter((v): v is number => typeof v === 'number')
}

/** 한 줄 요약: '판재 12 mm · V 개선 · 5L64-A32 ×2 · ±15 mm · PA 섹터 40–70°' */
export function summarizeSpec(spec: ScanPlanSpec): string {
  const s = spec.specimen
  const parts: string[] = []
  if (s.shape === 'pipe' && s.outerRadiusMm !== null) parts.push(`배관 OD ${fmtNum(s.outerRadiusMm * 2)} mm`)
  else parts.push(SHAPE_LABEL[s.shape])
  if (s.thicknessMm !== null) parts.push(s.shape === 'pipe' ? `${fmtNum(s.thicknessMm)} mm` : `${parts.pop()} ${fmtNum(s.thicknessMm)} mm`)
  if (s.weld?.bevelShape) parts.push(`${s.weld.bevelShape} 개선`)
  const models = physicalProbes(spec).map((p) => p.probe.model ?? '?')
  if (models.length) parts.push(formatMultiset(models))
  const off = formatOffsets(vOffsets(spec))
  if (off) parts.push(`${off} mm`)
  const tech = techniquesText(spec.groups)
  if (tech) parts.push(tech)
  return parts.join(' · ')
}

/** 플랜 이름 제안: 두께 · 주파수 · 스큐 '12T · 5MHz · SK90/270' (규칙은 shared/planName) */
export function suggestPlanName(spec: ScanPlanSpec): string {
  return planNameFrom(spec)
}
