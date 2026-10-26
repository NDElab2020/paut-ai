/** 지시 표·패널 글자 (순수): 기록 세부 한 마디, 신호 줄 */
import type { RefBasis } from '@shared/imaging'
import { GEOMETRIC_ECHO_KIND, GEOMETRIC_IMPERFECTION_KIND, METALLURGICAL_TYPE, type IndicationRecord, type SignalInfo } from '@shared/labels'
import { num } from '../lib/format'

/** 결함 = 종류(없으면 '결함 · 종류 미정'), 형상 에코 = '형상 에코 · 세부', 형상 불완전 = '형상 불완전 · 세부' */
export function recordDetail(r: Pick<IndicationRecord, 'kind' | 'defectType' | 'geometricEcho' | 'geometricImperfection'>): string {
  if (r.kind === 'defect') return r.defectType ? METALLURGICAL_TYPE[r.defectType] : '결함 · 종류 미정'
  if (r.kind === 'geometric-echo') return `형상 에코${r.geometricEcho ? ` · ${GEOMETRIC_ECHO_KIND[r.geometricEcho.kind]}` : ''}`
  return `형상 불완전${r.geometricImperfection ? ` · ${GEOMETRIC_IMPERFECTION_KIND[r.geometricImperfection.kind]}` : ''}`
}

/**
 * '새 기록' 신호 줄: 최대 진폭 · Ref 대비 dB(대조 전) · Ref 근거(X2 — TCG 없음이면 '근거 약함', 기준 이득 없음이면 'Ref 없음') · 포화.
 * 기록 칸(SignalInfo)은 바꾸지 않고 보이기만 한다 (refBasis 는 core 가 파일 셋업으로 정한 ViewerGroup.refBasis)
 */
export function signalText(s: SignalInfo | null, ampEstimated = false, refBasis: RefBasis | null = null): string {
  if (!s || s.maxAmplitudePct === null) return '—'
  const parts = [`${num(s.maxAmplitudePct)} %FSH${ampEstimated ? ' (추정 눈금)' : ''}`]
  if (s.refDb !== null) parts.push(`Ref ${num(s.refDb)} dB (대조 전)`)
  if (refBasis === 'single-depth') parts.push('Ref 근거 약함(TCG 없음)')
  else if (refBasis === 'none' && s.refDb === null) parts.push('Ref 없음(기준 이득 0)')
  if (s.saturated) parts.push('포화')
  return parts.join(' · ')
}
