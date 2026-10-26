/** 새 플랜 후보 만들기: 같은 지문끼리 묶고, 예정 ID·이름 제안·가장 가까운 기존 플랜과의 차이를 붙인다. */
import { uniquePlanName } from '@shared/planName'
import { isOpdSpec, type ImportItemPreview, type NearestPlanDiff, type NewPlanCandidate, type PlanId, type ScanPlan, type ScanPlanSpec } from '@shared/types'
import { diffSpecs, specDistance, suggestPlanName, withinTolerance } from '../nde'
import { opdNameParts } from '../opd/normalize'
import type { ImportContext } from './context'

export const DEFAULT_NAME_TEMPLATE = '{name}'

/**
 * OPD 플랜 짧은 이름 끝 표시 ('25T · 5MHz · SK90 · 집속 24 · V개선 23+2 · OPD') — 같은 두께·주파수·스큐의 NDE 플랜과 이름으로도 구별되게.
 * 집속 깊이·개선 모양과 층 높이(Hot Pass+Land(+Root))를 넣어 ROOT/TOP·TP/PL TOP 처럼 그 값만 다른 OPD 플랜도 이름이 갈린다
 */
export const OPD_NAME_SUFFIX = ' · OPD'

/** {name} 짧은 이름, {summary} 요약, {id} 예정 ID. 결과가 비면 짧은 이름 */
export function applyNameTemplate(template: string | undefined, spec: ScanPlanSpec, summary: string, id: PlanId): string {
  const name = isOpdSpec(spec) ? [suggestPlanName(spec), ...opdNameParts(spec)].join(' · ') + OPD_NAME_SUFFIX : suggestPlanName(spec)
  const out = (template ?? DEFAULT_NAME_TEMPLATE)
    .replaceAll('{name}', name)
    .replaceAll('{summary}', summary)
    .replaceAll('{id}', id)
    .replace(/\s+/g, ' ')
    .trim()
  return out || name
}

export function nearestPlan(spec: ScanPlanSpec, plans: ScanPlan[]): NearestPlanDiff | null {
  let best: { plan: ScanPlan; dist: number } | null = null
  for (const plan of plans) {
    const dist = specDistance(plan.spec, spec)
    if (!best || dist < best.dist) best = { plan, dist }
  }
  if (!best) return null
  return {
    planId: best.plan.id,
    planName: best.plan.name,
    differences: diffSpecs(best.plan.spec, spec),
    withinTolerance: withinTolerance(best.plan.spec, spec)
  }
}

export function buildNewPlans(items: ImportItemPreview[], ctx: ImportContext): NewPlanCandidate[] {
  const groups = new Map<string, ImportItemPreview[]>()
  for (const it of items) {
    if (it.verdict !== 'new-plan' || !it.newPlanKey || !it.setup) continue
    const list = groups.get(it.newPlanKey) ?? []
    list.push(it)
    groups.set(it.newPlanKey, list)
  }
  if (groups.size === 0) return []
  const ids = ctx.catalog.peekNextPlanIds(groups.size)
  const plans = ctx.catalog.listPlans()
  // 짧은 이름은 겹치기 쉬우므로 기존 플랜·앞선 후보와 겹치면 ' (2)' 를 붙인다
  const taken = plans.map((p) => p.name)
  return [...groups.entries()].map(([key, list], i) => {
    const setup = list[0]!.setup!
    const id = ids[i]!
    const suggestedName = uniquePlanName(applyNameTemplate(ctx.newPlanNameTemplate, setup.spec, setup.summary, id), taken)
    taken.push(suggestedName)
    return {
      key,
      fingerprint: setup.fingerprint,
      spec: setup.spec,
      summary: setup.summary,
      provisionalPlanId: id,
      suggestedName,
      itemIds: list.map((x) => x.itemId),
      nearestPlan: nearestPlan(setup.spec, plans)
    }
  })
}
