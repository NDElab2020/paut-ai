/**
 * 라벨 세트 고르기 (순수) — 세트 = (파일 sha256, 라벨러, 지침서 버전, 판독 단계) (규격_초안.md 2절).
 *   - 세트의 라벨러는 늘 '지금 라벨러'(labels:session)다. 다른 사람 이름으로 기록하지 않게, 라벨러를 바꾸려면 지금 라벨러를 바꾼다.
 *   - 2인 독립 모드(settings.labelBlindMode)면 남의 세트는 서비스가 숨기고, 여기서도 지금 라벨러 세트만 고른다.
 *   - 처음 열 때: 이 파일에 지금 라벨러 세트가 있으면 마지막으로 쓴 것, 없으면 새 세트(지침서 v1 · 블라인드).
 * 측정 제안 보이기 규칙(계획 6절 결정 4 (가)): 전문가가 먼저 잰 뒤 비교값으로만. 2인 독립 모드면 숨긴다.
 */
import type { LabelSession, LabelSetInfo } from '@shared/api'
import { READING_STAGE, type LabelSetKey, type ReadingStage } from '@shared/labels'

/** 지침서 기본 버전 (지침서_v1.md) */
export const DEFAULT_GUIDELINE = 'v1'

export const STAGES: readonly ReadingStage[] = ['blind', 'reconciled', 'final']

/** 판독 단계 짧은 이름 (패널 한 줄) */
export const STAGE_SHORT: Readonly<Record<ReadingStage, string>> = { blind: '블라인드', reconciled: '설계값 대조', final: '확정' }

export { READING_STAGE }

/** 세트 고른 값 (라벨러는 지금 라벨러) */
export interface LabelSetChoice {
  guidelineVersion: string
  readingStage: ReadingStage
}

/** 패널이 쓰는 세트 상태: 라벨러가 없으면 null 과 이유 */
export type SetReady =
  | { ok: true; key: LabelSetKey; labelerName: string; isNew: boolean }
  | { ok: false; reason: 'no-labeler' | 'unregistered' | 'no-labelers' }

/** 지침서 버전 정리: 앞뒤 공백을 빼고, 비면 기본 */
export function cleanGuideline(v: string): string {
  const s = v.normalize('NFC').trim()
  return s === '' ? DEFAULT_GUIDELINE : s.slice(0, 32)
}

/** 이 파일에서 지금 라벨러의 세트 (마지막으로 쓴 것부터) */
export function setsOfLabeler(sets: readonly LabelSetInfo[], sha256: string, labelerId: string | null): LabelSetInfo[] {
  if (!labelerId) return []
  return sets
    .filter((s) => s.sha256 === sha256 && s.labelerId === labelerId)
    .sort((a, b) => (b.lastStoredAt ?? '').localeCompare(a.lastStoredAt ?? '') || a.setId.localeCompare(b.setId))
}

/** 처음 고를 세트: 지금 라벨러의 마지막 세트, 없으면 v1 · 블라인드 */
export function defaultSetChoice(sets: readonly LabelSetInfo[], sha256: string, labelerId: string | null): LabelSetChoice {
  const mine = setsOfLabeler(sets, sha256, labelerId)
  const s = mine[0]
  return s ? { guidelineVersion: s.guidelineVersion, readingStage: s.readingStage } : { guidelineVersion: DEFAULT_GUIDELINE, readingStage: 'blind' }
}

/** 세션·고른 값 → 쓸 세트. 라벨러가 없거나 등록되지 않았으면 이유 */
export function resolveSet(session: LabelSession | null, sha256: string, choice: LabelSetChoice, sets: readonly LabelSetInfo[]): SetReady {
  if (!session || session.labelers.length === 0) return { ok: false, reason: 'no-labelers' }
  if (!session.labelerId) return { ok: false, reason: 'no-labeler' }
  if (!session.labeler) return { ok: false, reason: 'unregistered' }
  const key: LabelSetKey = { sha256, labelerId: session.labelerId, guidelineVersion: cleanGuideline(choice.guidelineVersion), readingStage: choice.readingStage }
  const isNew = !sets.some((s) => s.sha256 === sha256 && s.labelerId === key.labelerId && s.guidelineVersion === key.guidelineVersion && s.readingStage === key.readingStage)
  return { ok: true, key, labelerName: session.labeler.name, isNew }
}

/** 세트가 없을 때 안내 */
export const SET_REASON_TEXT: Readonly<Record<Exclude<SetReady, { ok: true }>['reason'], string>> = {
  'no-labelers': "등록된 라벨러가 없습니다. 왼쪽 메뉴 '라벨 관리'에서 라벨러를 추가하고 지금 라벨러로 고르세요. 찍은 점은 그대로 남습니다.",
  'no-labeler': "지금 라벨러를 고르지 않았습니다. 아래 '라벨러'에서 고르세요(라벨 관리에서도 됩니다). 찍은 점은 그대로 남습니다.",
  unregistered: "지금 라벨러가 등록되어 있지 않습니다. '라벨 관리'에서 라벨러를 다시 고르세요."
}

/** 세트 한 줄 이름: '김 판독 · v1 · 블라인드' */
export function setLabel(name: string, key: Pick<LabelSetKey, 'guidelineVersion' | 'readingStage'>): string {
  return `${name} · ${key.guidelineVersion} · ${STAGE_SHORT[key.readingStage]}`
}

/** 설계값을 본 단계인가 (대조·확정은 늘 '봤음' — 규격 2절, validate 경고와 같은 규칙) */
export function designSeenForced(stage: ReadingStage): boolean {
  return stage !== 'blind'
}

// ───────────────────────────── 측정 제안 보이기 ─────────────────────────────

export type SuggestionVisibility =
  /** 보여 준다 (전문가가 먼저 잰 뒤) */
  | 'show'
  /** 아직 숨김 — 전문가가 먼저 길이를 정해야 한다 */
  | 'wait-expert'
  /** 2인 독립 모드라 숨김 (2인 일치도·시험 작업) */
  | 'hidden-blind'

/**
 * 앱 길이 제안을 보여 줄지 (규격 4절, 계획 6절 결정 4 (가)):
 * 2인 독립 모드면 늘 숨기고, 아니면 전문가가 길이를 정한 뒤에만 비교값으로 보여 준다.
 */
export function suggestionVisibility(blindMode: boolean, expertMeasured: boolean): SuggestionVisibility {
  if (blindMode) return 'hidden-blind'
  return expertMeasured ? 'show' : 'wait-expert'
}

export const SUGGESTION_VISIBILITY_TEXT: Readonly<Record<SuggestionVisibility, string>> = {
  show: '',
  'wait-expert': '길이를 먼저 정하면 앱 제안을 비교값으로 보여 줍니다.',
  'hidden-blind': '2인 독립 모드라 앱 제안을 숨깁니다 (2인 일치도·시험 작업).'
}
