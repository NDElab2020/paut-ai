import { PLAN_ID_PATTERN, type PlanId } from './types'

export function formatPlanId(n: number): PlanId {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid plan number: ${n}`)
  return `SP${String(n).padStart(3, '0')}`
}

export function parsePlanNumber(id: PlanId): number | null {
  return PLAN_ID_PATTERN.test(id) ? Number(id.slice(2)) : null
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && PLAN_ID_PATTERN.test(v)
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i
const MAX_SEGMENT = 80

function trimEnd(s: string): string {
  return s.replace(/[. ]+$/g, '')
}

/**
 * 폴더/파일 이름 한 칸으로 안전한 문자열 (Windows 기준). 시편 ID 등에 쓴다.
 * 금지 문자 <>:"/\|?* 와 제어문자는 '_' 로, 앞뒤 공백·끝의 '.' 제거, 맨 앞 '.'(숨김)은 '_.' 로,
 * 예약어('CON', 'CON.1' 처럼 점 앞부분이 예약어인 경우 포함)는 그 부분 뒤에 '_' 를 붙인다.
 * 한 번 정리한 값을 다시 넣어도 그대로다(멱등). 결과가 비면 '' (호출 쪽에서 오류 처리).
 */
export function sanitizePathSegment(raw: string): string {
  let s = trimEnd(raw.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim())
  if (s === '' || s === '.' || s === '..') return ''
  s = s.replace(/^\./, '_.')
  const dot = s.indexOf('.')
  const head = dot < 0 ? s : s.slice(0, dot)
  if (WINDOWS_RESERVED.test(head)) s = `${head}_${s.slice(head.length)}`
  return trimEnd(s.slice(0, MAX_SEGMENT))
}

export const sanitizeSpecimenId = sanitizePathSegment

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}
