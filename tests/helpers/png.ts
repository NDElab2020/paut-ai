/** 테스트용 최소 PNG 읽기·쓰기 (8비트 RGB/RGBA, 비인터레이스). 대조 그림 저장에만 쓴다 — 의존성 추가 없이 node:zlib 로. */
import { readFileSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync, inflateSync } from 'node:zlib'

export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function readPng(path: string): Rgba {
  const buf = readFileSync(path)
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('PNG 아님')
  let off = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('8비트 비인터레이스만 지원')
      colorType = body[9]!
      if (colorType !== 2 && colorType !== 6) throw new Error(`색 형식 ${colorType} 미지원`)
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const px = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp]! : 0
      const b = y > 0 ? px[row - stride + x]! : 0
      const c = x >= bpp && y > 0 ? px[row - stride + x - bpp]! : 0
      const v = raw[src + x]!
      px[row + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255
    }
  }
  if (bpp === 4) return { width, height, data: px }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
    data[j] = px[i]!
    data[j + 1] = px[i + 1]!
    data[j + 2] = px[i + 2]!
    data[j + 3] = 255
  }
  return { width, height, data }
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0)
  return Buffer.concat([head, body, crc])
}

export function writePng(path: string, img: Rgba): void {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  writeFileSync(path, Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

export function crop(img: Rgba, x0: number, y0: number, x1: number, y1: number): Rgba {
  const w = x1 - x0
  const h = y1 - y0
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x1) * 4), y * w * 4)
  return { width: w, height: h, data }
}

/** 위아래로 붙이기 (너비가 다르면 왼쪽 정렬, 빈 곳은 검정) */
export function stack(parts: Rgba[], gap = 4): Rgba {
  const width = Math.max(...parts.map((p) => p.width))
  const height = parts.reduce((s, p) => s + p.height, 0) + gap * (parts.length - 1)
  const data = new Uint8Array(width * height * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  let y = 0
  for (const p of parts) {
    for (let r = 0; r < p.height; r++) data.set(p.data.subarray(r * p.width * 4, (r + 1) * p.width * 4), ((y + r) * width) * 4)
    y += p.height + gap
  }
  return { width, height, data }
}

/** 반투명 겹치기: a 위에 b 를 alpha 로 */
export function blend(a: Rgba, b: Rgba, alpha = 0.5): Rgba {
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * a.width + x) * 4
      const j = (y * b.width + x) * 4
      const k = (y * width + x) * 4
      for (let c = 0; c < 3; c++) data[k + c] = Math.round(a.data[i + c]! * (1 - alpha) + b.data[j + c]! * alpha)
      data[k + 3] = 255
    }
  }
  return { width, height, data }
}
