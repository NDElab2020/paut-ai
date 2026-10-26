import type { ViewerWeld } from '@shared/imaging'
import { isEstimatedSpecimenField, isOpdSpec, type AngleHeightSpec, type CapSpec, type ScanPlanSpec } from '@shared/types'

const layer = (s: AngleHeightSpec | null): ViewerWeld['hotPass'] =>
  s && s.angleDeg !== null && s.heightMm !== null ? { angleDeg: s.angleDeg, heightMm: s.heightMm } : null

const cap = (s: CapSpec | null): ViewerWeld['upperCap'] =>
  s && s.widthMm !== null && s.heightMm !== null ? { widthMm: s.widthMm, heightMm: s.heightMm } : null

export function setupWeldTemplateLabel(value: string | null | undefined): string {
  if (!value) return '모름'
  return ({ DoubleVOffset: 'Double V-Offset', VOffset: 'V-Offset' } as Record<string, string>)[value] ?? value
}

/** 같은 용접 폭 계산을 셋업 단면과 이미지 덮개에 사용한다. 미해독 템플릿은 참고 단면임을 표시한다. */
export function setupWeldGeometry(spec: ScanPlanSpec): ViewerWeld | null {
  const w = spec.specimen.weld
  if (!w) return null
  const opd = isOpdSpec(spec)
  const shape = w.bevelShape ?? (w.template === 'DoubleVOffset' ? 'X' : w.template === 'VOffset' ? 'V' : null)
  const estimated = opd && (!shape || !w.symmetry || w.offsetMm == null || w.land?.heightMm == null)
  const hotPass = layer(w.hotPass)
  const root = layer(w.root)
  if (estimated && !hotPass && !root) return null
  return {
    bevelShape: shape ?? (estimated ? (root && root.heightMm > 0 ? 'X' : 'V') : ''),
    symmetry: w.symmetry,
    offsetMm: w.offsetMm ?? (opd ? 0 : 0.8),
    landHeightMm: w.land?.heightMm ?? 0,
    hotPass,
    root,
    fills: w.fills.map(layer).filter((s): s is NonNullable<typeof s> => s !== null),
    upperCap: cap(w.upperCap),
    lowerCap: cap(w.lowerCap),
    hazWidthMm: w.hazWidthMm ?? null,
    weldAngleDeg: w.weldAngleDeg ?? hotPass?.angleDeg ?? root?.angleDeg ?? 0,
    ...(w.template !== undefined ? { template: w.template } : {}),
    ...(w.templateCode !== undefined ? { templateCode: w.templateCode } : {}),
    ...(w.symmetryCode !== undefined ? { symmetryCode: w.symmetryCode } : {}),
    ...(opd ? { templateEstimated: isEstimatedSpecimenField(spec.specimen, 'weld.template') } : {}),
    ...(estimated ? { geometryEstimated: true } : {})
  }
}
