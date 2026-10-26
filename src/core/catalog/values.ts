/** 카탈로그 입력값 정리·검증과 JSON 열 도우미 */
import { AppError } from '@shared/errors'
import type { SQLOutputValue } from 'node:sqlite'

export function nfc(s: string): string {
  return s.normalize('NFC')
}

export function cleanText(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new AppError('INVALID_ARGUMENT', `${field} 값이 올바르지 않습니다.`)
  return nfc(v).trim()
}

export function requireText(v: unknown, field: string, maxLength = 200): string {
  const s = cleanText(v, field)
  if (s.length === 0) throw new AppError('INVALID_ARGUMENT', `${field}을(를) 입력하세요.`)
  if (s.length > maxLength) throw new AppError('INVALID_ARGUMENT', `${field}은(는) ${maxLength}자 이하로 입력하세요.`)
  return s
}

/** 빈 문자열·null → null */
export function optionalText(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null
  const s = cleanText(v, field)
  return s.length > 0 ? s : null
}

export function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) throw new AppError('INVALID_ARGUMENT', '태그 값이 올바르지 않습니다.')
  const out: string[] = []
  for (const t of v) {
    const s = cleanText(t, '태그')
    if (s.length > 0 && !out.includes(s)) out.push(s)
  }
  return out
}

export function cleanRound(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new AppError('INVALID_ARGUMENT', '회차는 0 이상의 정수여야 합니다.')
  }
  return v
}

const SHA256 = /^[0-9a-f]{64}$/

export function cleanSha256(v: unknown): string {
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  if (!SHA256.test(s)) throw new AppError('INVALID_ARGUMENT', 'SHA-256 값이 올바르지 않습니다.')
  return s
}

/** LIKE 부분일치 패턴 (ESCAPE '\') */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** 키를 정렬한 JSON (같은 내용이면 같은 문자열) */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

/** 키를 정렬한 사본 (undefined 칸은 뺌). '__proto__' 같은 이름도 own 칸으로 둔다(Object.fromEntries 와 같은 결과, 중간 배열 없이) */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) {
      const x = o[k]
      if (x === undefined) continue
      if (k === '__proto__') Object.defineProperty(out, k, { value: sortKeys(x), enumerable: true, writable: true, configurable: true })
      else out[k] = sortKeys(x)
    }
    return out
  }
  return v
}

export function str(v: SQLOutputValue | undefined): string {
  return v === null || v === undefined ? '' : String(v)
}

export function strOrNull(v: SQLOutputValue | undefined): string | null {
  return v === null || v === undefined ? null : String(v)
}

export function num(v: SQLOutputValue | undefined): number {
  return v === null || v === undefined ? 0 : Number(v)
}

export function numOrNull(v: SQLOutputValue | undefined): number | null {
  return v === null || v === undefined ? null : Number(v)
}

export function parseJson<T>(v: SQLOutputValue | undefined, fallback: T): T {
  if (typeof v !== 'string') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export const koCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
