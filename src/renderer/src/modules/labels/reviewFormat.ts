/** 검수 탭 표시용 글자 (순수 함수). 계산은 shared/labels/review, 여기서는 이름·숫자 모양만. */
import type { ReviewSideKey } from '@shared/api'
import { METALLURGICAL_TYPE } from '@shared/labels/codes'
import type { ProportionCI } from '@shared/labels/metrics'
import type { AdjudicationChoice, ComparisonPurpose, ReviewRow, ReviewUnit, RowOutcome } from '@shared/labels/review'
import type { IndicationRecord, ReadingStage } from '@shared/labels/types'
import { DASH } from '../../lib/format'
import { STAGE_SHORT } from './format'

export const PURPOSE_LABEL: Record<ComparisonPurpose, string> = {
  'inter-reader': '2인 일치도 (사람 간)',
  accuracy: '정확도 (A = 확정 정답)',
  agency: '전문기관 대비 (A = 전문기관 판독)'
}

export const UNIT_LABEL = { grouping: '그룹 짓기 후 (평가 정의 3절)', record: '기록 하나 (그룹 짓기 전)' } as const
export const FRAME_LABEL = { file: '파일 U (mm)', weld: '용접부 (시편 좌표)' } as const

/** 행 판정 짧은 이름. 2인 비교는 'A 만 봄', 정답 대비는 '미검출' */
export function outcomeShort(o: RowOutcome, purpose: ComparisonPurpose): string {
  const truth = purpose !== 'inter-reader'
  switch (o) {
    case 'match':
      return '짝'
    case 'match-b-reference':
      return 'B 참고와 짝'
    case 'match-reference':
      return 'A 참고와 짝'
    case 'a-only':
      return truth ? '미검출' : 'A 만 봄'
    case 'b-only':
      return truth ? '오검출' : 'B 만 봄'
    case 'zone':
      return 'A 참고 구역'
    case 'outside-coverage':
      return '검토 범위 밖'
    case 'reference':
      return '참고 단위'
  }
}

export function outcomeTone(o: RowOutcome): 'ok' | 'attention' | 'muted' {
  if (o === 'match') return 'ok'
  if (o === 'a-only' || o === 'b-only' || o === 'match-b-reference') return 'attention'
  return 'muted'
}

export const CHOICE_SHORT: Record<AdjudicationChoice, string> = {
  a: 'A 채택',
  b: 'B 채택',
  merge: '합침',
  neither: '결함 아님',
  defer: '보류'
}

/** 행에 고를 수 있는 결정 */
export function choicesFor(row: Pick<ReviewRow, 'kind'>): AdjudicationChoice[] {
  if (row.kind === 'pair') return ['a', 'b', 'merge', 'neither', 'defer']
  if (row.kind === 'only-a') return ['a', 'neither', 'defer']
  return ['b', 'neither', 'defer']
}

export type RowFilter = 'all' | 'pair' | 'only-a' | 'only-b' | 'differ' | 'undecided'
export const ROW_FILTER_LABEL: Record<RowFilter, string> = {
  all: '모든 행',
  pair: '짝만',
  'only-a': 'A 만',
  'only-b': 'B 만',
  differ: '종류가 다른 짝',
  undecided: '결정하지 않은 행'
}

export function sideKeyId(k: ReviewSideKey): string {
  return `${k.labelerId}|${k.readingStage}|${k.guidelineVersion}`
}

export function parseSideKey(id: string): ReviewSideKey {
  const [labelerId = '', readingStage = 'blind', guidelineVersion = 'v1'] = id.split('|')
  return { labelerId, readingStage: readingStage as ReadingStage, guidelineVersion }
}

export function sideText(k: ReviewSideKey, name?: string | null): string {
  const who = name && name !== k.labelerId ? `${name} (${k.labelerId})` : k.labelerId
  return `${who} · ${STAGE_SHORT[k.readingStage]} · ${k.guidelineVersion}`
}

/** '+2.0' · '−1.5' · '0.0' · '—' (단위 없음) */
export function signed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const s = Math.abs(v).toFixed(digits)
  if (Number(s) === 0) return (0).toFixed(digits)
  return `${v > 0 ? '+' : '−'}${s}`
}

export function fixed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return v.toFixed(digits).replace('-', '−')
}

/** 0.833 → '83 %' */
export function pct(p: number | null | undefined, digits = 0): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return DASH
  return `${(p * 100).toFixed(digits)} %`
}

/** '5/6 = 83 % (44–97 %)' */
export function ciText(ci: ProportionCI | null | undefined): string {
  if (!ci || ci.n === 0) return DASH
  if (ci.p === null) return `${ci.x}/${ci.n}`
  return `${ci.x}/${ci.n} = ${pct(ci.p)} (${pct(ci.lower)}–${pct(ci.upper)})`
}

export function typeName(t: IndicationRecord['defectType']): string {
  return t ? METALLURGICAL_TYPE[t] : '종류 미정'
}

/** mm 짧게: 정수면 소수점 없이, 아니면 한 자리 */
export function mmShort(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const r = Math.round(v * 10) / 10
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('-', '−')
}

/** 비교 단위 한 줄: '#1 30–46 균열 (토우)' (묶음이면 '#2a+2b') */
export function unitLine(u: ReviewUnit): string {
  const refs = u.refs.length > 0 ? `#${u.refs.join('+')}` : '#'
  return `${refs} ${mmShort(u.item.scanStartMm)}–${mmShort(u.item.scanEndMm)} ${typeName(u.item.defectType)}`
}

/** 기록이 걸친 그룹 (앵커 → 최대 진폭 → 길이 잰 그룹). 모르면 null */
export function recordGroupId(r: IndicationRecord): number | null {
  const a = r.anchors[0]?.anchor.groupId
  if (a !== undefined && a !== null) return a
  if (r.signal.peak?.groupId !== undefined && r.signal.peak.groupId !== null) return r.signal.peak.groupId
  return r.length.groupId ?? null
}

/** 종류 일치 요약: '같음' · '1단 다름' · '2단 다름' · '종류 다름' · '—' */
export function typeAgreeText(row: ReviewRow): { text: string; differ: boolean } {
  const g = row.agreement
  if (!g) return { text: DASH, differ: false }
  if (g.character.agree === false) return { text: '1단 다름', differ: true }
  if (g.proposalClass.agree === false) return { text: '2단 다름', differ: true }
  if (g.type.agree === false) return { text: '세부 다름', differ: true }
  if (g.type.agree === true) return { text: '같음', differ: false }
  return { text: '모름', differ: false }
}
