/**
 * 학습 데이터 파일 쓰기 도우미 — 같은 값이면 같은 바이트 (새 의존성 없음, node:zlib 만).
 *   stableJson  키를 사전순으로 정렬한 JSON + 줄바꿈 (객체를 만든 순서와 무관)
 *   encodePngRgb  8비트 RGB PNG (행마다 Sub 필터, deflate 수준 고정). 읽기는 tests/helpers/png.ts readPng
 *   encodePngAsync 같은 바이트, deflate 만 zlib 비동기(libuv 스레드풀) — 필터는 부를 때 끝내므로 넘긴 배열을 바로 다시 써도 된다.
 *                 학습 내보내기가 다음 장면을 그리는 동안 앞 장면을 압축한다(main 이벤트 루프를 덜 막음).
 *   npyHeader   NumPy .npy v1.0 머리 (descr '<i2' · '|u1', C 순서). 머리 + 원자료 = .npy 파일
 */
import { endianness } from 'node:os'
import { promisify } from 'node:util'
import { crc32, deflate, deflateSync } from 'node:zlib'

const deflateAsync = promisify(deflate)

// ───────────────────────────── JSON ─────────────────────────────

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) {
      const x = o[k]
      if (x !== undefined) out[k] = sortKeys(x)
    }
    return out
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return null
  return v
}

/** 키 정렬 JSON (끝에 줄바꿈). pretty = 2칸 들여쓰기 (작은 파일만) */
export function stableJson(value: unknown, pretty = false): string {
  return `${JSON.stringify(sortKeys(value), null, pretty ? 2 : undefined)}\n`
}

// ───────────────────────────── PNG ─────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** deflate 수준 (고정 — 바꾸면 그림 바이트가 바뀐다) */
export const PNG_DEFLATE_LEVEL = 6

function pngChunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0)
  return Buffer.concat([head, body, crc])
}

/** PNG 머리(IHDR)와 Sub 필터를 건 원자료 (channels = 3 RGB · 1 회색조) */
function pngRaw(width: number, height: number, px: Uint8Array, channels: 1 | 3): { ihdr: Buffer; raw: Buffer } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`PNG 크기 ${width}×${height}`)
  if (px.length !== width * height * channels) {
    throw new Error(channels === 3 ? `PNG 바이트 수 ${px.length} ≠ ${width}×${height}×3` : `PNG 바이트 수 ${px.length} ≠ ${width}×${height}`)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 비트 깊이
  ihdr[9] = channels === 3 ? 2 : 0 // RGB · 회색조
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0 // 비인터레이스
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1)
    const s = y * stride
    raw[o] = 1 // Sub: 왼쪽 화소와의 차
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = (px[s + x]! - (x >= channels ? px[s + x - channels]! : 0)) & 255
  }
  return { ihdr, raw }
}

function pngFile(ihdr: Buffer, idat: Buffer): Buffer {
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

/** RGB 바이트 (width × height × 3, 위에서 아래로) → PNG */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Buffer {
  const { ihdr, raw } = pngRaw(width, height, rgb, 3)
  return pngFile(ihdr, deflateSync(raw, { level: PNG_DEFLATE_LEVEL }))
}

/** 회색조 8비트 (width × height, 위에서 아래로) → PNG — 가림 그림(masks/) */
export function encodePngGray(width: number, height: number, gray: Uint8Array): Buffer {
  const { ihdr, raw } = pngRaw(width, height, gray, 1)
  return pngFile(ihdr, deflateSync(raw, { level: PNG_DEFLATE_LEVEL }))
}

/**
 * encodePngRgb(channels 3)·encodePngGray(channels 1) 와 같은 바이트 (같은 zlib·같은 수준 — 같은 런타임 안에서 시험이 대조).
 * 필터는 이 함수를 부를 때 끝내고(넘긴 px 를 바로 다시 써도 됨), deflate 만 libuv 스레드풀에서 한다.
 */
export function encodePngAsync(width: number, height: number, px: Uint8Array, channels: 1 | 3): Promise<Buffer> {
  let parts: { ihdr: Buffer; raw: Buffer }
  try {
    parts = pngRaw(width, height, px, channels)
  } catch (e) {
    return Promise.reject(e)
  }
  return deflateAsync(parts.raw, { level: PNG_DEFLATE_LEVEL }).then((idat) => pngFile(parts.ihdr, idat))
}

// ───────────────────────────── NPY ─────────────────────────────

export type NpyDescr = '<i2' | '|u1'

/** .npy v1.0 머리 (매직 · 버전 · 머리 길이 · 사전 글자). 전체 머리 길이는 64 의 배수 */
export function npyHeader(descr: NpyDescr, shape: readonly number[]): Buffer {
  if (shape.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error(`npy 모양 ${shape.join('×')}`)
  const tuple = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`
  const dict = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${tuple}, }`
  const pre = 10 // 매직 6 + 버전 2 + 길이 2
  const total = Math.ceil((pre + dict.length + 1) / 64) * 64
  if (total - pre > 0xffff) throw new Error('npy 머리가 너무 깁니다')
  const text = dict.padEnd(total - pre - 1, ' ') + '\n'
  const out = Buffer.alloc(total)
  out.write('\x93NUMPY', 0, 'latin1')
  out[6] = 1
  out[7] = 0
  out.writeUInt16LE(total - pre, 8)
  out.write(text, pre, 'latin1')
  return out
}

/** int16 배열의 little-endian 바이트 (이 기계가 big-endian 이면 바꿔서 복사) */
export function int16LeBytes(a: Int16Array): Buffer {
  const view = Buffer.from(a.buffer, a.byteOffset, a.byteLength)
  if (endianness() === 'LE') return view
  const copy = Buffer.from(view)
  copy.swap16()
  return copy
}
