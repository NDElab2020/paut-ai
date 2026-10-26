/**
 * 용접 개선 덮개선 (S-scan 위, 펼친 깊이 좌표). 레그마다 위아래를 뒤집어 이어 그린다 (OmniPC 'Show legs' 와 같은 지그재그).
 * 대칭 V·Double V 개선의 층 치수를 따라 그린다. 해석하지 못한 템플릿은 숫자 치수로 만든 참고 단면만 허용한다.
 * 개선면 반폭 = 루트 반 간격(offset) + 바닥에서부터 land(수직) → hotPass(각도·높이) → fills → 나머지는 마지막 각도.
 *
 * ERW(전기저항용접) 배관 이음매 (L7): 비공개 ModelSetup `WeldTemplateType = Erw`(ViewerWeld.template). 공개 JSON 은 이것도
 * bevelShape 'V' 로 적지만 개선면이 없는 맞대기 이음매라, 덮개는 용접 중심선(V = 0)의 이음매 선 하나(+ 열영향부 폭이 있으면 그 경계)만
 * 그린다. 개선면 반폭은 어느 깊이에서나 0 으로 본다. ERW 가 아닌 파일(X3·X4 TF 등 VOffset)은 지금과 바이트 단위로 같은 선을 낸다.
 */
import { DEG, foldDepth } from './coords'
import type { ViewerWeld } from './types'

export type Polyline = Array<[vMm: number, depthMm: number]>

/** ERW 이음매(개선면 없음)인가 — 파일 덮개 종류(ModelSetup WeldTemplateType)로만 가른다 */
export function isSeamWeld(weld: ViewerWeld | null): boolean {
  return !!weld && typeof weld.template === 'string' && weld.template.toLowerCase() === 'erw'
}

export function isDrawableWeld(weld: ViewerWeld | null, thicknessMm: number | null): boolean {
  if (!weld || !thicknessMm || !(thicknessMm > 0)) return false
  if (isSeamWeld(weld)) return true
  if (weld.geometryEstimated) {
    const segments = [weld.hotPass, weld.root, ...weld.fills].filter((s) => s !== null)
    return Number.isFinite(weld.offsetMm) && weld.offsetMm >= 0 && Number.isFinite(weld.landHeightMm) && weld.landHeightMm >= 0 &&
      segments.every((s) => Number.isFinite(s.heightMm) && s.heightMm >= 0 && Number.isFinite(s.angleDeg) && s.angleDeg >= 0 && s.angleDeg < 90) &&
      Math.abs(segments.reduce((n, s) => n + s.heightMm, weld.landHeightMm) - thicknessMm) <= 0.1
  }
  const shape = weld.bevelShape.toUpperCase()
  return (shape === 'V' || (shape === 'X' && (weld.root?.heightMm ?? 0) > 0)) && (weld.symmetry ?? 'Symmetric') === 'Symmetric'
}

/** 실제 깊이 d(0 = 표면, T = 바닥)에서 CL 부터 개선면까지 거리 (ERW 이음매는 0) */
export function bevelHalfWidth(weld: ViewerWeld, thicknessMm: number, depthMm: number): number {
  if (isSeamWeld(weld)) return 0
  let up = Math.max(0, thicknessMm - depthMm) // 바닥에서 위로
  let half = weld.offsetMm
  // Double V: 아래쪽 루트를 먼저 지나고 랜드·핫패스·채움 순으로 위로 올라간다.
  // 루트 높이가 0 인 기존 V 개선의 계산 순서와 숫자는 그대로다.
  const root = weld.root
  const rootHeight = Math.max(0, root?.heightMm ?? 0)
  if (rootHeight > 0) {
    if (up <= rootHeight) return half + (rootHeight - up) * Math.tan((root?.angleDeg ?? 0) * DEG)
    up -= rootHeight
  }
  const land = Math.max(0, weld.landHeightMm)
  if (up <= land) return half
  up -= land
  const segs = [weld.hotPass, ...weld.fills].filter((s): s is { angleDeg: number; heightMm: number } => !!s && s.heightMm > 0)
  let lastAngle = weld.hotPass?.angleDeg ?? (weld.weldAngleDeg || 30)
  for (const s of segs) {
    const h = Math.min(up, s.heightMm)
    half += h * Math.tan(s.angleDeg * DEG)
    lastAngle = s.angleDeg
    up -= h
    if (up <= 0) return half
  }
  return half + up * Math.tan(lastAngle * DEG)
}

/** ERW 이음매: V = 0 세로선(이음매)과 ±열영향부 폭 세로선. 레그를 접어도 같은 V 라 곧은 선이다 */
function seamOverlay(weld: ViewerWeld, depthMaxMm: number): { bevel: Polyline[]; haz: Polyline[] } {
  const line = (v: number): Polyline => [
    [v, 0],
    [v, depthMaxMm]
  ]
  const haz = weld.hazWidthMm && weld.hazWidthMm > 0 ? weld.hazWidthMm : null
  return { bevel: [line(0)], haz: haz === null ? [] : [line(haz), line(-haz)] }
}

/** 개선면(좌·우)과 열영향부 경계(좌·우) 지그재그 선. depthMax 까지 레그를 이어 그린다 (ERW 는 이음매 선) */
export function weldOverlay(
  weld: ViewerWeld | null,
  thicknessMm: number | null,
  depthMaxMm: number,
  stepMm = 0.25
): { bevel: Polyline[]; haz: Polyline[] } | null {
  if (!weld || !isDrawableWeld(weld, thicknessMm)) return null
  if (isSeamWeld(weld)) return seamOverlay(weld, depthMaxMm)
  const t = thicknessMm!
  const n = Math.max(2, Math.ceil(depthMaxMm / stepMm) + 1)
  const side = (sign: 1 | -1, extra: number): Polyline => {
    const pts: Polyline = []
    for (let i = 0; i < n; i++) {
      const d = Math.min(depthMaxMm, i * stepMm)
      const f = foldDepth(d, t).depthMm
      pts.push([sign * (bevelHalfWidth(weld!, t, f) + extra), d])
    }
    return pts
  }
  const haz = weld!.hazWidthMm && weld!.hazWidthMm > 0 ? weld!.hazWidthMm : null
  return {
    bevel: [side(1, 0), side(-1, 0)],
    haz: haz === null ? [] : [side(1, haz), side(-1, haz)]
  }
}
