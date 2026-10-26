/** 셋업 JSON 을 타입 안전하게 읽는 작은 도우미들 (스키마 검증 대신 관대한 읽기). */

export type Json = Record<string, unknown>

export function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function obj(v: unknown): Json | null {
  return isObj(v) ? v : null
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function objs(v: unknown): Json[] {
  return arr(v).filter(isObj)
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function int(v: unknown): number | null {
  const n = num(v)
  return n !== null && Number.isInteger(n) ? n : null
}

/** id 로 배열 항목 찾기 */
export function byId(items: unknown, id: number | null): Json | null {
  if (id === null) return null
  return objs(items).find((o) => o['id'] === id) ?? null
}

/** 객체에서 처음 나오는 알려진 키 (판별 공용체 대응) */
export function firstKey<K extends string>(o: Json | null, keys: readonly K[]): K | null {
  if (!o) return null
  for (const k of keys) if (isObj(o[k]) || Array.isArray(o[k])) return k
  return null
}
