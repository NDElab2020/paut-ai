/**
 * 결정적 UUID (RFC 4122 v5: 이름공간 + SHA-1) — 런타임 의존성 없는 순수 구현.
 * core/labels/xlsx/uuid.ts(stableUuid, node:crypto)와 같은 계산이다. shared 는 renderer 에서도 돌아서
 * node:crypto 를 쓰지 못해 SHA-1 과 UTF-8 바꾸기를 직접 둔다. 테스트가 두 구현의 결과를 견준다.
 *
 * 확정 세트(Level III)의 새 기록 UUID 는 입력 UUID 들에서 만든다(adjudicate.ts finalRecordUuid).
 * 같은 판정을 다시 돌리면 같은 UUID 라서 저장소에 새로 쌓이지 않고 그 자리에서 고쳐진다.
 */

/** 확정 세트 전용 이름공간 (임의로 정한 고정값 — 바꾸면 모든 확정 기록의 UUID 가 바뀐다) */
export const ADJUDICATION_UUID_NAMESPACE = '8c2f6d14-3a7b-4e95-b1c0-5d9e7a2f4b68'

/** 열쇠 조각 구분자 (core 의 uuidKey 와 같은 단위 구분 문자) */
const SEP = '\u001f'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 글자 → UTF-8 바이트 (NFC 로 맞춘 뒤). 짝 없는 대리 문자는 U+FFFD */
export function utf8Bytes(text: string): Uint8Array {
  const s = text.normalize('NFC')
  const out: number[] = []
  for (const ch of s) {
    let cp = ch.codePointAt(0) ?? 0xfffd
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return Uint8Array.from(out)
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

/** SHA-1 (FIPS 180-4). 보안용이 아니라 UUID v5 계산용이다 */
export function sha1(bytes: Uint8Array): Uint8Array {
  const len = bytes.length
  const padded = Math.ceil((len + 9) / 64) * 64
  const buf = new Uint8Array(padded)
  buf.set(bytes)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  const bits = len * 8
  view.setUint32(padded - 8, Math.floor(bits / 0x100000000))
  view.setUint32(padded - 4, bits >>> 0)
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + 4 * i)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1)
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = t
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const ov = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h))
  return out
}

function hex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** UUID v5 (이름공간 UUID + 이름 글자). 결과는 소문자 8-4-4-4-12 */
export function uuidV5(namespace: string, name: string): string {
  if (!UUID_RE.test(namespace)) throw new RangeError(`이름공간이 UUID 가 아닙니다: ${namespace}`)
  const ns = namespace.replace(/-/g, '')
  const nsBytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) nsBytes[i] = parseInt(ns.slice(2 * i, 2 * i + 2), 16)
  const nameBytes = utf8Bytes(name)
  const all = new Uint8Array(16 + nameBytes.length)
  all.set(nsBytes)
  all.set(nameBytes, 16)
  const h = sha1(all)
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const x = hex(h.subarray(0, 16))
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/** 조각들을 이어 열쇠 글자로 (core 의 uuidKey 와 같음) */
export function reviewUuidKey(parts: ReadonlyArray<string | number | null>): string {
  return parts.map((p) => (p === null ? '' : String(p).normalize('NFC'))).join(SEP)
}

/** 확정 세트 이름공간의 UUID */
export function adjudicationUuid(parts: ReadonlyArray<string | number | null>): string {
  return uuidV5(ADJUDICATION_UUID_NAMESPACE, reviewUuidKey(parts))
}
