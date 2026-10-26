/**
 * core/opd — OmniScan MX2 .opd 구조 읽기 (읽기 전용, Electron 비의존).
 *
 * 근거는 우리 데이터 파일 바이트·SEC20 r01·OmniPC 화면 캡처와 `OPD_조사/1_파서실험.md`·`3_화면대조.md` 뿐이다(README.md 'clean-room').
 * 원본은 'r' 로만 열고 필요한 구간만 읽는다(머리 0x20 B, 꼬리 색인, 앞부분 셋업 — 래스터는 요청한 조각만).
 */
import { open, type FileHandle } from 'node:fs/promises'
import { AppError } from '@shared/errors'
import { ByteView } from './bytes'
import { OPD_HEADER_BYTES, parseContainerHeader, parseTailIndex } from './container'
import { NeedMoreBytes, OpdError, structureFail } from './errors'
import { parseOpdParts } from './parse'
import { gateResultFrameBytes } from './raster'
import { GATE_PEAK_BYTE, SelfCheckAccumulator } from './selfcheck'
import { OPD_GATE_COUNT, OPD_GATE_RECORD_BYTES, type OpdAmplitudeChunk, type OpdFile, type OpdGatePeaks, type OpdSelfCheck } from './types'

export * from './types'
export { OpdError, OPD_FAIL_PREFIX, type OpdCheck, type OpdErrorReason } from './errors'
export { hasOpdMagic } from './container'
export { parseOpdParts } from './parse'
export { gateSampleWindow, snellExitXMm, SELF_CHECK_LIMITS } from './selfcheck'
export { oleDateToIso, parseMxuVersion } from './strings'
export { OPD_ANCHOR } from './setup'
export { OPD_MATERIALS, OPD_SPECIMEN_SHAPES, OPD_WELD_SYMMETRIES, OPD_WELD_TEMPLATE_INFO, OPD_WELD_TEMPLATES } from './weld'

/** 경로 또는 파일 전체 바이트 */
export type OpdSource = string | Uint8Array

/** 셋업을 읽으려고 처음 읽는 앞부분 크기. 모자라면 4배씩 늘린다 */
const FIRST_PREFIX_BYTES = 256 * 1024
/** 앞부분(래스터 시작까지) 최대 크기 — 이보다 길면 OPD 셋업으로 보지 않는다 */
const MAX_PREFIX_BYTES = 32 * 1024 * 1024
/** 자체 점검 때 한 번에 읽는 프레임 수 */
const SELF_CHECK_BLOCK_FRAMES = 128

export function isOpdFileName(name: string): boolean {
  return /\.opd$/i.test(name)
}

/** .opd 구조 읽기 → 머리·셋업·빔·래스터 배치·경고. 진폭은 읽지 않는다 */
export async function readOpdFile(source: OpdSource): Promise<OpdFile> {
  if (typeof source !== 'string') return parseOpdBuffer(source)
  return withHandle(source, (fh, size) => parseFromHandle(fh, size))
}

/** 파일 전체 바이트에서 구조 읽기 (동기) */
export function parseOpdBuffer(bytes: Uint8Array): OpdFile {
  if (bytes.length === 0) throw new OpdError('empty-file', '빈 파일입니다.')
  return parseOpdParts({ prefix: bytes, fileSize: bytes.length, index: null })
}

export interface AmplitudeOptions {
  /** 이미 읽은 구조 (없으면 다시 읽음) */
  file?: OpdFile
  /** 'int16' 이면 Int16Array 로 넓힌다 (이미지 보기 ViewerVolumeChunk 와 같은 형) */
  format?: 'uint8' | 'int16'
}

/** 진폭 조각 [scanCount, 빔, 샘플] — scanStart 부터 scanCount 위치 */
export async function readOpdAmplitude(source: OpdSource, scanStart: number, scanCount: number, opts: AmplitudeOptions = {}): Promise<OpdAmplitudeChunk> {
  const run = async (file: OpdFile, read: Reader): Promise<OpdAmplitudeChunk> => {
    checkRange(file, scanStart, scanCount)
    const { frameBytes, beams, samples, offset } = file.raster
    const u8 = await read(offset + scanStart * frameBytes, scanCount * frameBytes)
    // 바이트 원본에서 읽었으면 복사해 돌려준다 (호출자 버퍼와 메모리를 나누지 않게)
    const amplitude = opts.format === 'int16' ? Int16Array.from(u8) : typeof source === 'string' ? u8 : u8.slice()
    return { scanStart, scanCount, beams, samples, amplitude }
  }
  return withSource(source, opts.file, run)
}

/** 장비가 저장한 게이트 결과의 최대 진폭 [scanCount, 빔, 게이트 I·A·B] */
export async function readOpdGatePeaks(source: OpdSource, scanStart: number, scanCount: number, opts: { file?: OpdFile } = {}): Promise<OpdGatePeaks> {
  const run = async (file: OpdFile, read: Reader): Promise<OpdGatePeaks> => {
    checkRange(file, scanStart, scanCount)
    const per = gateResultFrameBytes(file.raster.beams)
    const rec = await read(file.raster.gateResultsOffset + scanStart * per, scanCount * per)
    const n = scanCount * file.raster.beams * OPD_GATE_COUNT
    const peaks = new Uint8Array(n)
    for (let i = 0; i < n; i++) peaks[i] = rec[i * OPD_GATE_RECORD_BYTES + GATE_PEAK_BYTE]!
    return { scanStart, scanCount, beams: file.raster.beams, peaks }
  }
  return withSource(source, opts.file, run)
}

/** 자체 점검: 게이트 A 재계산 일치율 · 스넬 차 · 두께 불일치 · 빈 프레임 (래스터 전체를 묶음으로 읽음) */
export async function selfCheckOpd(source: OpdSource, opts: { file?: OpdFile } = {}): Promise<OpdSelfCheck> {
  const t = performance.now()
  const run = async (file: OpdFile, read: Reader): Promise<OpdSelfCheck> => {
    const acc = new SelfCheckAccumulator(file)
    const { positions, frameBytes, offset, gateResultsOffset } = file.raster
    const per = gateResultFrameBytes(file.raster.beams)
    for (let p = 0; p < positions; p += SELF_CHECK_BLOCK_FRAMES) {
      const n = Math.min(SELF_CHECK_BLOCK_FRAMES, positions - p)
      const raster = await read(offset + p * frameBytes, n * frameBytes)
      const gates = await read(gateResultsOffset + p * per, n * per)
      acc.addFrames(raster, gates, n)
    }
    return acc.finish(performance.now() - t)
  }
  return withSource(source, opts.file, run)
}

// ───────────────────────────── 입출력 ─────────────────────────────

type Reader = (offset: number, length: number) => Promise<Uint8Array>

function checkRange(file: OpdFile, scanStart: number, scanCount: number): void {
  const { positions } = file.raster
  if (!Number.isInteger(scanStart) || !Number.isInteger(scanCount) || scanStart < 0 || scanCount < 1 || scanStart + scanCount > positions) {
    throw new AppError('INVALID_ARGUMENT', `스캔 범위가 파일 밖입니다(0~${positions - 1}).`, `scanStart=${scanStart} scanCount=${scanCount}`)
  }
}

async function withSource<T>(source: OpdSource, file: OpdFile | undefined, run: (file: OpdFile, read: Reader) => Promise<T>): Promise<T> {
  if (typeof source !== 'string') {
    const f = file ?? parseOpdBuffer(source)
    if (f.container.fileSize !== source.length) {
      throw new AppError('CONFLICT', '읽은 구조와 파일 크기가 다릅니다(파일이 바뀜).', `${f.container.fileSize} vs ${source.length}`)
    }
    return run(f, async (offset, length) => {
      if (offset < 0 || offset + length > source.length) structureFail('bounds', '파일이 예상보다 짧습니다(잘렸거나 손상됨).')
      return source.subarray(offset, offset + length)
    })
  }
  return withHandle(source, async (fh, size) => {
    const f = file ?? (await parseFromHandle(fh, size))
    if (f.container.fileSize !== size) {
      throw new AppError('CONFLICT', '읽은 구조와 파일 크기가 다릅니다(파일이 바뀜).', `${f.container.fileSize} vs ${size}`)
    }
    return run(f, (offset, length) => readExact(fh, offset, length, size))
  })
}

async function withHandle<T>(path: string, fn: (fh: FileHandle, size: number) => Promise<T>): Promise<T> {
  let fh: FileHandle
  try {
    fh = await open(path, 'r')
  } catch (e) {
    throw openError(e, path)
  }
  try {
    const st = await fh.stat()
    if (!st.isFile()) throw new OpdError('not-a-file', '일반 파일이 아닙니다.', path)
    if (st.size === 0) throw new OpdError('empty-file', '빈 파일입니다.', path)
    return await fn(fh, st.size)
  } finally {
    await fh.close()
  }
}

function openError(e: unknown, path: string): AppError {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return new OpdError('not-found', '파일을 찾을 수 없습니다.', path)
  if (code === 'EISDIR') return new OpdError('not-a-file', '일반 파일이 아닙니다.', path)
  return new OpdError('io', '파일을 열 수 없습니다.', `${path}: ${(e as Error).message}`)
}

async function readExact(fh: FileHandle, offset: number, length: number, size: number): Promise<Uint8Array> {
  if (offset < 0 || offset + length > size) structureFail('bounds', '파일이 예상보다 짧습니다(잘렸거나 손상됨).', `need ${offset + length} > ${size}`)
  const buf = new Uint8Array(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, offset + done)
    if (bytesRead === 0) structureFail('bounds', '파일을 끝까지 읽지 못했습니다(잘렸거나 손상됨).', `at ${offset + done}`)
    done += bytesRead
  }
  return buf
}

/** 머리 → 꼬리 색인 → 앞부분(모자라면 4배씩 늘려 다시) */
async function parseFromHandle(fh: FileHandle, size: number): Promise<OpdFile> {
  const head = await readExact(fh, 0, Math.min(OPD_HEADER_BYTES, size), size)
  const c = parseContainerHeader(new ByteView(head, size))
  const index = await readExact(fh, c.indexOffset, 16 * c.indexCount, size)
  const entries = parseTailIndex(new ByteView(index), 0, c.indexCount, c.indexOffset)
  const tableStart = entries[2]?.offset
  const tableEnd = entries[3]?.offset
  // typed 설정 구역은 래스터와 분리해서 읽는다. 길이를 제한해 잘못된 색인으로 대용량을 읽지 않는다.
  const tableSize = tableStart !== undefined && tableEnd !== undefined ? tableEnd - tableStart : 0
  if (tableSize > MAX_PREFIX_BYTES) structureFail('setup-values', '꼬리 설정 레코드 구역이 너무 큽니다.', `bytes=${tableSize}`)
  const typedTables = tableStart !== undefined && tableSize > 0
    ? { offset: tableStart, bytes: await readExact(fh, tableStart, tableSize, size) } : null
  let len = Math.min(size, FIRST_PREFIX_BYTES)
  for (;;) {
    const prefix = await readExact(fh, 0, len, size)
    try {
      return parseOpdParts({ prefix, fileSize: size, index, typedTables })
    } catch (e) {
      if (!(e instanceof NeedMoreBytes)) throw e
      if (len >= size) structureFail('bounds', '파일이 예상보다 짧습니다(잘렸거나 손상됨).')
      const next = Math.min(size, Math.max(e.needed, len * 4))
      if (next > MAX_PREFIX_BYTES) structureFail('bounds', '셋업 구역이 너무 깁니다(OPD 셋업으로 볼 수 없음).', `need ${e.needed}`)
      len = next
    }
  }
}
