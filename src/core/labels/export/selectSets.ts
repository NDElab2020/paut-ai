/**
 * 파일마다 학습에 쓸 라벨 세트 하나 고르기 (순수 함수).
 *
 * 기본 규칙 (평가_정의_v1.md 1·2절 정답 계층·시험 세트 3단계): 확정 > 설계값 대조 > 지정 라벨러의 블라인드.
 *   - 단계 순서대로 보고, 그 단계 세트가 하나면 그것을 고른다.
 *   - 같은 단계에 세트가 둘 이상이면(라벨러·지침서 버전이 다름) 고르지 않는다 — 사람이 파일 줄에서 고른다(overrides).
 *   - 블라인드 단계는 지정한 라벨러 세트만 본다(지정하지 않으면 블라인드 세트는 쓰지 않음).
 *   - overrides 에 그 파일 세트가 있으면 단계 규칙보다 먼저 쓴다(없는 세트를 가리키면 고르지 않음).
 *   - 시험(test) 분할 파일은 확정 세트만 (rule.testFinalOnly, 기본 true — AI 평가 정답은 확정 세트, 블라인드는 사람 기준선).
 *     확정 세트가 없으면 고르지 않고 이유를 남긴다(직접 고른 세트도 확정이어야 함).
 */
import type { TrainSplit, TrainingSetRule } from '@shared/api'
import type { LabelSetKey, ReadingStage } from '@shared/labels/types'

export interface SetCandidate extends LabelSetKey {
  setId: string
}

export interface SetPick {
  chosen: string | null
  reason: string
}

export const STAGE_NAME: Readonly<Record<ReadingStage, string>> = {
  final: '확정',
  reconciled: '설계값 대조',
  blind: '블라인드'
}

const STAGES: readonly ReadingStage[] = ['final', 'reconciled', 'blind']

/** 규칙 검사·정리 (모르는 단계·겹친 단계는 뺀다) */
export function cleanSetRule(rule: unknown): TrainingSetRule {
  const r = (rule ?? {}) as Partial<TrainingSetRule>
  const stages: ReadingStage[] = []
  for (const s of Array.isArray(r.stages) ? r.stages : []) if (STAGES.includes(s) && !stages.includes(s)) stages.push(s)
  const blind = typeof r.blindLabelerId === 'string' && r.blindLabelerId.trim() !== '' ? r.blindLabelerId.normalize('NFC').trim() : null
  const overrides: Record<string, string> = {}
  if (r.overrides && typeof r.overrides === 'object' && !Array.isArray(r.overrides)) {
    for (const [k, v] of Object.entries(r.overrides).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(k)) overrides[k] = v
    }
  }
  return { stages, blindLabelerId: blind, ...(Object.keys(overrides).length > 0 ? { overrides } : {}), testFinalOnly: r.testFinalOnly !== false }
}

function who(c: SetCandidate): string {
  return `${c.labelerId} · 지침서 ${c.guidelineVersion}`
}

const TEST_FINAL_ONLY = '시험(test) 분할은 확정 세트만 씁니다 (평가 정의 1·2절 — AI 평가 정답은 확정, 블라인드는 사람 기준선)'

/** 한 파일의 세트 고르기. candidates 는 그 파일의 보이는 세트, split = 그 파일 시편의 분할 */
export function pickLabelSet(sha256: string, candidates: readonly SetCandidate[], rule: TrainingSetRule, split: TrainSplit | null = null): SetPick {
  const list = [...candidates].sort((a, b) => (a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : 0))
  if (list.length === 0) return { chosen: null, reason: '라벨 세트가 없습니다.' }
  const testOnly = split === 'test' && rule.testFinalOnly !== false
  const forced = rule.overrides?.[sha256]
  if (forced !== undefined) {
    const hit = list.find((c) => c.setId === forced)
    if (hit && testOnly && hit.readingStage !== 'final') return { chosen: null, reason: `${TEST_FINAL_ONLY} — 직접 고른 세트가 ${STAGE_NAME[hit.readingStage]} 세트입니다.` }
    return hit
      ? { chosen: hit.setId, reason: `직접 고름 (${STAGE_NAME[hit.readingStage]} · ${who(hit)})` }
      : { chosen: null, reason: '직접 고른 세트를 찾을 수 없습니다(지웠거나 2인 모드에서 숨김). 다시 고르세요.' }
  }
  const skipped: string[] = []
  const stages = testOnly ? rule.stages.filter((x) => x === 'final') : rule.stages
  if (testOnly && !list.some((c) => c.readingStage === 'final')) return { chosen: null, reason: `${TEST_FINAL_ONLY} — 이 파일에는 확정 세트가 없습니다.` }
  for (const stage of stages) {
    let pool = list.filter((c) => c.readingStage === stage)
    if (stage === 'blind') {
      if (rule.blindLabelerId === null) {
        if (pool.length > 0) skipped.push('블라인드 세트는 라벨러를 지정해야 씁니다')
        continue
      }
      pool = pool.filter((c) => c.labelerId === rule.blindLabelerId)
    }
    if (pool.length === 1) return { chosen: pool[0]!.setId, reason: `${STAGE_NAME[stage]} 세트 (${who(pool[0]!)})` }
    if (pool.length > 1) {
      return {
        chosen: null,
        reason: `${STAGE_NAME[stage]} 세트가 ${pool.length}개(${pool.map(who).join(', ')})라 고르지 않았습니다. 파일 줄에서 직접 고르세요.`
      }
    }
  }
  const have = [...new Set(list.map((c) => STAGE_NAME[c.readingStage]))].join('·')
  return { chosen: null, reason: `규칙에 맞는 세트가 없습니다 (있는 세트: ${have})${skipped.length ? ` — ${skipped[0]}` : ''}.` }
}
