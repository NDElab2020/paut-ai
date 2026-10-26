/** 한국어 문구·검색 도우미 (렌더러·mock·core 공용, 런타임 의존성 없음) */

type JosaPair = '이/가' | '은/는' | '을/를' | '과/와' | '으로/로'

/** 숫자를 읽은 소리 기준 받침: 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 */
const DIGIT_BATCHIM: Record<string, 'none' | 'rieul' | 'other'> = {
  '0': 'other',
  '1': 'rieul',
  '2': 'none',
  '3': 'other',
  '4': 'none',
  '5': 'none',
  '6': 'other',
  '7': 'rieul',
  '8': 'rieul',
  '9': 'none'
}
/** 영문자 이름 읽기 기준 받침: L 엘, M 엠, N 엔, R 알 */
const LETTER_BATCHIM: Record<string, 'rieul' | 'other'> = { l: 'rieul', m: 'other', n: 'other', r: 'rieul' }

/** 단위 기호는 읽는 소리로: ° 도, mm 밀리미터, % 퍼센트, MHz 메가헤르츠 */
const UNIT_SUFFIX = /(°|mm|%|MHz)$/

function finalSound(word: string): 'none' | 'rieul' | 'other' {
  if (UNIT_SUFFIX.test(word.trim())) return 'none'
  const ch = [...word.trim()].reverse().find((c) => /[\p{L}\p{N}]/u.test(c))
  if (!ch) return 'none'
  const code = ch.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28
    return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'other'
  }
  if (/[0-9]/.test(ch)) return DIGIT_BATCHIM[ch]!
  return LETTER_BATCHIM[ch.toLowerCase()] ?? 'none'
}

/** word 뒤에 올 조사만: particle('SP003', '으로/로') → '으로' */
export function particle(word: string, pair: JosaPair): string {
  const [withB, withoutB] = pair.split('/') as [string, string]
  const s = finalSound(word)
  if (pair === '으로/로') return s === 'other' ? withB : withoutB
  return s === 'none' ? withoutB : withB
}

/** 받침에 맞는 조사를 붙인다: josa('SP003', '으로/로') → 'SP003으로', josa('SP001', '과/와') → 'SP001과' */
export function josa(word: string, pair: JosaPair): string {
  return word + particle(word, pair)
}

/** 검색용 정규화: NFC + 소문자 */
export function normalizeForSearch(s: string): string {
  return s.normalize('NFC').toLowerCase()
}

/** 공백으로 나눈 검색 낱말 (카탈로그 검색과 같은 규칙) */
export function searchTerms(query: string): string[] {
  return normalizeForSearch(query)
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * 카탈로그 검색과 같은 규칙: 모든 낱말이 (어느 필드든) 들어 있으면 일치.
 * 낱말마다 다른 필드에 있어도 된다. 낱말이 없으면 true.
 */
export function matchesAllTerms(fields: Array<string | null | undefined>, query: string): boolean {
  const terms = searchTerms(query)
  if (terms.length === 0) return true
  const hay = fields.filter((f): f is string => typeof f === 'string' && f.length > 0).map(normalizeForSearch)
  return terms.every((t) => hay.some((h) => h.includes(t)))
}
