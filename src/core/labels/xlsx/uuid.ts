/**
 * 결정적 UUID — 같은 열쇠 글자에서 늘 같은 UUID (RFC 4122 v5: 이름공간 + SHA-1).
 * 엑셀을 다시 가져와도 같은 기록이 같은 UUID 를 받아 재가져오기가 멱등이 된다.
 */
import { createHash } from 'node:crypto'

/** 라벨 엑셀 가져오기 전용 이름공간 (임의로 정한 고정값 — 바꾸면 모든 가져온 기록의 UUID 가 바뀐다) */
export const LABEL_XLSX_UUID_NAMESPACE = '3d6f0a8e-5b2c-4e71-9a14-c07b6d2e8f53'

const NS_BYTES = Buffer.from(LABEL_XLSX_UUID_NAMESPACE.replace(/-/g, ''), 'hex')

/** 열쇠 조각 구분자 (글자 안에 나올 일이 없는 단위 구분 문자) */
const SEP = '\u001f'

/** 열쇠 글자 → UUID v5 (소문자 8-4-4-4-12) */
export function stableUuid(key: string): string {
  const h = createHash('sha1').update(NS_BYTES).update(key, 'utf8').digest()
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/** 조각들을 이어 열쇠 글자로 (NFC) */
export function uuidKey(parts: ReadonlyArray<string | number | null>): string {
  return parts.map((p) => (p === null ? '' : String(p).normalize('NFC'))).join(SEP)
}
