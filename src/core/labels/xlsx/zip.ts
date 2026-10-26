/**
 * ZIP 읽기 (xlsx 용, 의존성 없음 — node:zlib inflateRawSync).
 *
 * - 끝의 중앙 디렉터리(EOCD)를 찾아 항목 목록을 읽고, 항목마다 로컬 머리 뒤의 데이터를 푼다.
 *   크기·CRC 는 중앙 디렉터리 값을 믿는다(데이터 설명자 비트 3 이 있어도 됨).
 * - 압축 방식은 저장(0)·deflate(8)만. 암호·여러 디스크·zip64 는 오류로 끝낸다(엑셀 양식은 작아서 zip64 가 필요 없음).
 * - 압축 폭탄 막기: 항목 하나 64 MB, 합계 256 MB, 항목 수 1만 개까지.
 */
import { inflateRawSync } from 'node:zlib'
import { XlsxError } from './errors'

export interface ZipEntry {
  name: string
  /** 0 = 저장, 8 = deflate */
  method: number
  flags: number
  crc32: number
  compressedSize: number
  size: number
  localHeaderOffset: number
}

export const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024
export const ZIP_MAX_TOTAL_BYTES = 256 * 1024 * 1024
export const ZIP_MAX_ENTRIES = 10_000

const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const EOCD_SIZE = 22
const MAX_COMMENT = 0xffff

let crcTable: Uint32Array | null = null

/** CRC-32 (ZIP 과 같은 다항식 0xEDB88320) */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  const t = crcTable
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function corrupt(detail: string): XlsxError {
  return new XlsxError('corrupt', '엑셀 파일이 손상되었습니다 (ZIP 구조가 맞지 않음). 엑셀에서 다시 저장해 보세요.', detail)
}

/** 끝의 중앙 디렉터리 위치. 못 찾으면 -1 */
function findEocd(buf: Buffer): number {
  const last = buf.length - EOCD_SIZE
  const first = Math.max(0, last - MAX_COMMENT)
  for (let i = last; i >= first; i--) {
    if (buf.readUInt32LE(i) !== SIG_EOCD) continue
    const commentLength = buf.readUInt16LE(i + 20)
    if (i + EOCD_SIZE + commentLength <= buf.length) return i
  }
  return -1
}

export class ZipArchive {
  private readonly buf: Buffer
  private readonly byName: ReadonlyMap<string, ZipEntry>
  private inflatedTotal = 0

  constructor(buf: Buffer, entries: ReadonlyMap<string, ZipEntry>) {
    this.buf = buf
    this.byName = entries
  }

  /** 항목 이름 (디렉터리 제외, 중앙 디렉터리 순서) */
  names(): string[] {
    return [...this.byName.keys()]
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  entry(name: string): ZipEntry | null {
    return this.byName.get(name) ?? null
  }

  /** 항목 내용. 없으면 null. 손상·지원하지 않는 형식이면 XlsxError */
  read(name: string): Buffer | null {
    const e = this.byName.get(name)
    if (!e) return null
    const buf = this.buf
    if (e.flags & 0x1) throw new XlsxError('unsupported', '암호가 걸린 엑셀 파일은 읽지 못합니다. 암호를 풀고 다시 저장해 주세요.', name)
    if (e.size > ZIP_MAX_ENTRY_BYTES) throw new XlsxError('too-large', '엑셀 파일 안의 항목이 너무 큽니다 (64 MB 초과).', `${name} ${e.size}`)
    if (this.inflatedTotal + e.size > ZIP_MAX_TOTAL_BYTES) throw new XlsxError('too-large', '엑셀 파일을 풀면 너무 큽니다 (256 MB 초과).', name)
    const off = e.localHeaderOffset
    if (off + 30 > buf.length || buf.readUInt32LE(off) !== SIG_LOCAL) throw corrupt(`local header ${name} @${off}`)
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28)
    const end = start + e.compressedSize
    if (end > buf.length) throw corrupt(`data ${name} ${start}+${e.compressedSize} > ${buf.length}`)
    const raw = buf.subarray(start, end)
    let out: Buffer
    if (e.method === 0) {
      out = Buffer.from(raw)
    } else if (e.method === 8) {
      try {
        out = inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(ZIP_MAX_ENTRY_BYTES, e.size + 1)) })
      } catch (err) {
        throw corrupt(`inflate ${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      throw new XlsxError('unsupported', `엑셀 파일의 압축 방식(${e.method})을 읽지 못합니다. 엑셀에서 다시 저장해 주세요.`, name)
    }
    if (out.length !== e.size) throw corrupt(`size ${name} ${out.length} != ${e.size}`)
    if (crc32(out) !== e.crc32) throw corrupt(`crc ${name}`)
    this.inflatedTotal += out.length
    return out
  }

  /** UTF-8 글자로 (BOM 제거). 없으면 null */
  readText(name: string): string | null {
    const b = this.read(name)
    if (b === null) return null
    const s = b.toString('utf8')
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
  }
}

/** ZIP 열기. 중앙 디렉터리만 읽고 내용은 read() 할 때 푼다 */
export function openZip(data: Uint8Array): ZipArchive {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (buf.length < EOCD_SIZE) throw new XlsxError('not-zip', '엑셀(xlsx) 파일이 아닙니다 (파일이 너무 짧음).', `${buf.length} bytes`)
  const eocd = findEocd(buf)
  if (eocd < 0) {
    if (buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0) {
      throw new XlsxError('not-xlsx', '옛 엑셀 형식(.xls)은 읽지 못합니다. 엑셀에서 .xlsx 로 저장해 주세요.')
    }
    if (buf.readUInt32LE(0) === SIG_LOCAL) throw corrupt('EOCD not found (truncated?)')
    throw new XlsxError('not-zip', '엑셀(xlsx) 파일이 아닙니다.', 'EOCD not found')
  }
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) {
    throw new XlsxError('zip64', '아주 큰 ZIP(zip64) 형식이라 읽지 못합니다. 엑셀에서 다시 저장해 주세요.')
  }
  const disk = buf.readUInt16LE(eocd + 4)
  const cdDisk = buf.readUInt16LE(eocd + 6)
  const onDisk = buf.readUInt16LE(eocd + 8)
  const total = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (onDisk === 0xffff || total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new XlsxError('zip64', '아주 큰 ZIP(zip64) 형식이라 읽지 못합니다. 엑셀에서 다시 저장해 주세요.')
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) {
    throw new XlsxError('unsupported', '여러 조각으로 나뉜 ZIP 은 읽지 못합니다.', `disk ${disk}/${cdDisk}`)
  }
  if (total > ZIP_MAX_ENTRIES) throw new XlsxError('too-large', '엑셀 파일 안의 항목이 너무 많습니다.', `${total}`)
  if (cdOffset + cdSize > eocd) throw corrupt(`central directory ${cdOffset}+${cdSize} > ${eocd}`)

  const entries = new Map<string, ZipEntry>()
  let p = cdOffset
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdOffset + cdSize || buf.readUInt32LE(p) !== SIG_CENTRAL) throw corrupt(`central entry ${n} @${p}`)
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLength = buf.readUInt16LE(p + 28)
    const extraLength = buf.readUInt16LE(p + 30)
    const commentLength = buf.readUInt16LE(p + 32)
    const localHeaderOffset = buf.readUInt32LE(p + 42)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new XlsxError('zip64', '아주 큰 ZIP(zip64) 형식이라 읽지 못합니다. 엑셀에서 다시 저장해 주세요.')
    }
    const nameEnd = p + 46 + nameLength
    if (nameEnd > buf.length) throw corrupt(`central name ${n}`)
    const name = buf.subarray(p + 46, nameEnd).toString('utf8')
    p = nameEnd + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (entries.has(name)) throw corrupt(`duplicate entry ${name}`)
    entries.set(name, { name, method, flags, crc32: crc, compressedSize, size, localHeaderOffset })
  }
  return new ZipArchive(buf, entries)
}
