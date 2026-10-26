/**
 * 검토 구간 (규격_초안.md 1.5, 지침서 11절) — 순수.
 *   검토 완료: (그룹, 스캔 구간) + 그때 본 C-scan 게이트의 펼친 깊이·레그 범위 ('결함 없음'은 이 범위 안에서만 뽑는다)
 *   품질 불량: 사유(커플링·누락·포화·잡음·시간 범위·감도)가 꼭 있어야 한다
 *   기준 미만 지시: 보이지만 평가 기준에 못 미치는 응답 (U 범위·그룹만)
 * 게이트 범위는 지금 화면의 유효 게이트(파일 게이트 + 후처리 편집)로 낸다. 음로(SoundPath) 게이트는 빔 각도로 깊이로 바꿔 모든 빔을 덮는 범위.
 */
import { applyGateOverride, findGate, gateDisplayValues, groupPostOf, DEG, type PostProcess, type ViewerGroup } from '@shared/imaging'
import { newReviewInterval, type LabelSetKey, type ReviewGateRange, type ReviewInterval } from '@shared/labels'
import type { ReviewForm } from './panelState'
import type { LabelReviewDraft } from './state'

/** 그룹들의 지금 C-scan 게이트 → 펼친 깊이·레그 범위 (게이트가 없거나 두께를 모르면 null) */
export function reviewGateRange(groups: readonly ViewerGroup[], post: PostProcess, thicknessMm: number | null): ReviewGateRange | null {
  let top = Infinity
  let bottom = -Infinity
  for (const g of groups) {
    const file = findGate(g, g.cscanGateId)
    if (!file || !file.supported) continue
    const eff = applyGateOverride(file, g, groupPostOf(post, g.id).gates[file.id])
    const v = gateDisplayValues(eff, g)
    if (v.geometry === 'TrueDepth') {
      top = Math.min(top, v.startMm)
      bottom = Math.max(bottom, v.startMm + v.lengthMm)
    } else {
      // 음로 → 깊이: 빔마다 cosθ — 모든 빔을 덮는 범위
      for (const b of g.beams) {
        const c = Math.cos(b.angleDeg * DEG)
        top = Math.min(top, v.startMm * c)
        bottom = Math.max(bottom, (v.startMm + v.lengthMm) * c)
      }
    }
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null
  const r = (x: number): number => Math.round(x * 100) / 100
  if (thicknessMm === null || !(thicknessMm > 0)) return null
  const legMin = Math.max(1, Math.floor(top / thicknessMm) + 1)
  const legMax = Math.max(legMin, Math.ceil(bottom / thicknessMm - 1e-9))
  return { depthTopMm: r(top), depthBottomMm: r(bottom), legMin, legMax }
}

export interface ReviewBuild {
  interval: ReviewInterval | null
  problems: string[]
}

/** 초안 구간 + 종류 → 검토 구간 (저장 전). 품질 불량은 사유가 없으면 막는다 */
export function reviewIntervalOf(key: LabelSetKey, uuid: string, draft: LabelReviewDraft | null, form: ReviewForm, gate: ReviewGateRange | null): ReviewBuild {
  const problems: string[] = []
  if (!draft) problems.push('검토 구간 도구(4)로 C-scan 이나 B-scan 을 끌어 스캔 구간을 정하세요.')
  else if (!(draft.scanEndMm > draft.scanStartMm)) problems.push('스캔 구간의 끝이 시작보다 커야 합니다.')
  if (form.kind === 'quality-bad' && !form.reason) problems.push('품질 불량은 사유를 골라야 합니다 (지침서 11.2).')
  if (form.kind === 'reviewed' && !gate) problems.push('지금 C-scan 게이트 범위를 정할 수 없습니다 (게이트·두께 확인).')
  if (problems.length || !draft) return { interval: null, problems }
  return {
    interval: newReviewInterval({
      uuid,
      sha256: key.sha256,
      labelerId: key.labelerId,
      guidelineVersion: key.guidelineVersion,
      readingStage: key.readingStage,
      kind: form.kind,
      groupId: draft.groupId,
      scanStartMm: Math.round(draft.scanStartMm * 1e4) / 1e4,
      scanEndMm: Math.round(draft.scanEndMm * 1e4) / 1e4,
      gate: form.kind === 'reviewed' ? gate : null,
      reason: form.kind === 'quality-bad' ? form.reason : null,
      note: form.note.trim()
    }),
    problems: []
  }
}

/** 그룹 전체 스캔 범위 (mm) — '전체 구간으로' */
export function fullScanRange(groups: readonly Pick<ViewerGroup, 'scan'>[]): [number, number] | null {
  if (groups.length === 0) return null
  let lo = Infinity
  let hi = -Infinity
  for (const g of groups) {
    const a = g.scan.offsetMm
    const b = g.scan.offsetMm + (g.scan.count - 1) * g.scan.resolutionMm
    lo = Math.min(lo, a, b)
    hi = Math.max(hi, a, b)
  }
  return Number.isFinite(lo) && hi > lo ? [lo, hi] : null
}
