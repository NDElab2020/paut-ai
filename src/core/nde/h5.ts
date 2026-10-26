/**
 * h5wasm 접근 계층. 'h5wasm/node' 는 ESM 전용이라 동적 import 한다.
 * h5wasm 은 열기 실패 시 예외 대신 file_id -1 을 돌려주고 HDF5 오류 스택을 stderr 로 찍으므로,
 * 흔한 실패(비-HDF5, 잘린 파일)는 열기 전에 슈퍼블록을 직접 읽어 걸러낸다.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { AppError } from '@shared/errors'
import { NdeError } from './errors'

type H5Lib = (typeof import('h5wasm/node'))['default']
export type H5File = InstanceType<H5Lib['File']>
export type H5Group = InstanceType<H5Lib['Group']>

let libPromise: Promise<H5Lib> | null = null

export function loadH5(): Promise<H5Lib> {
  if (!libPromise) {
    libPromise = import('h5wasm/node').then(async (mod) => {
      const lib = (mod as { default?: H5Lib }).default ?? (mod as unknown as H5Lib)
      await lib.ready
      return lib
    })
    libPromise.catch(() => {
      libPromise = null
    })
  }
  return libPromise
}

const SIGNATURE = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_SIGNATURE_OFFSET = 1 << 20

function readAt(fd: number, offset: number, length: number): Buffer {
  const buf = Buffer.alloc(length)
  const n = readSync(fd, buf, 0, length, offset)
  return buf.subarray(0, n)
}

function readAddr(buf: Buffer, at: number, size: number): number | null {
  if (at + size > buf.length) return null
  let v = 0n
  for (let i = size - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[at + i]!)
  if (v === (1n << BigInt(size * 8)) - 1n) return null // undefined address
  return Number(v)
}

/** HDF5 슈퍼블록이 적은 파일 끝 주소 (절대값). 판별 불가면 null */
function storedEof(sb: Buffer): number | null {
  const version = sb[8]
  if (version === 0 || version === 1) {
    const sizeOfOffsets = sb[13] ?? 8
    const baseAt = version === 0 ? 24 : 28
    const base = readAddr(sb, baseAt, sizeOfOffsets) ?? 0
    const eof = readAddr(sb, baseAt + 2 * sizeOfOffsets, sizeOfOffsets)
    return eof === null ? null : base + eof
  }
  if (version === 2 || version === 3) {
    const sizeOfOffsets = sb[9] ?? 8
    const base = readAddr(sb, 12, sizeOfOffsets) ?? 0
    const eof = readAddr(sb, 12 + 2 * sizeOfOffsets, sizeOfOffsets)
    return eof === null ? null : base + eof
  }
  return null
}

/** 열기 전 점검: 존재·크기·HDF5 서명·잘림. 실패 시 NdeError */
export function precheckHdf5(path: string): { sizeBytes: number } {
  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) throw new NdeError('not-a-file', path)
    size = st.size
  } catch (e) {
    if (e instanceof NdeError) throw e
    throw new NdeError('not-found', String((e as Error).message))
  }
  if (size === 0) throw new NdeError('empty-file', path)
  const fd = openSync(path, 'r')
  try {
    for (let off = 0; off < size && off <= MAX_SIGNATURE_OFFSET; off = off === 0 ? 512 : off * 2) {
      const sb = readAt(fd, off, 64)
      if (sb.length >= 8 && sb.subarray(0, 8).equals(SIGNATURE)) {
        const eof = storedEof(sb)
        if (eof !== null && eof > size) throw new NdeError('truncated', `size=${size} storedEof=${eof}`)
        return { sizeBytes: size }
      }
    }
  } finally {
    closeSync(fd)
  }
  throw new NdeError('not-hdf5', path)
}

/**
 * h5wasm(NODERAWFS)은 경로를 '/' 로 나눠 조각마다 255자로 자른다. 윈도우 경로는 '\\' 만 쓰므로 통째로 한 조각이 되어
 * 255자를 넘으면 잘린 경로를 연다 → '/' 로 바꿔 넘긴다 (윈도우 Node fs 는 '/' 경로를 받는다).
 */
export function h5PathFor(path: string, platform: string = process.platform): string {
  return platform === 'win32' ? path.replace(/\\/g, '/') : path
}

/** 읽기 전용으로 열고 fn 실행 후 반드시 닫는다 */
export async function withH5File<T>(path: string, fn: (f: H5File) => T): Promise<T> {
  precheckHdf5(path)
  const lib = await loadH5()
  let file: H5File
  try {
    file = new lib.File(h5PathFor(path), 'r')
  } catch (e) {
    throw new NdeError('hdf5-open-failed', String((e as Error)?.message ?? e))
  }
  if (file.file_id < 0n) throw new NdeError('hdf5-open-failed', path)
  try {
    return fn(file)
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new NdeError('corrupt', String((e as Error)?.message ?? e))
  } finally {
    try {
      file.close()
    } catch {
      // 닫기 실패는 결과에 영향 없음
    }
  }
}

/** 경로 'A/B/C' 가 있으면 그 엔터티, 없으면 null (없는 경로를 get 하면 HDF5 가 stderr 에 찍으므로 keys 로 먼저 확인) */
export function getPath(file: H5File, path: string): ReturnType<H5File['get']> {
  const parts = path.split('/').filter(Boolean)
  let cur: H5Group = file
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (!cur.keys().includes(part)) return null
    const next = cur.get(part)
    if (i === parts.length - 1) return next
    if (!next || !('keys' in next)) return null
    cur = next as H5Group
  }
  return cur
}

/** 문자열 데이터셋 값 (Setup, Properties, ModelSetup) */
export function readStringDataset(file: H5File, path: string): string | null {
  const ent = getPath(file, path)
  if (!ent || !('value' in ent)) return null
  const v = (ent as { value: unknown }).value
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
}

/** 그룹의 하위 키 (그룹이 아니면 빈 배열) */
export function childKeys(file: H5File, path: string): string[] {
  const ent = getPath(file, path)
  return ent && 'keys' in ent ? (ent as H5Group).keys() : []
}

/** 루트 속성을 평범한 값으로 */
export function rootAttrs(file: H5File): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const attrs = file.attrs
  for (const k of Object.keys(attrs)) {
    try {
      out[k] = attrs[k]!.value
    } catch {
      out[k] = null
    }
  }
  return out
}
