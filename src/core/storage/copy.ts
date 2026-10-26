import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, lstat, mkdir, open, rename, rm, stat, unlink, utimes } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { AppError } from '@shared/errors'
import { STORE_LAYOUT } from '@shared/types'
import { hashFile, hashingTap, ioError, READ_CHUNK, type ByteProgressOptions } from './hash'
import { withCounter } from './names'

export interface CopyOptions extends ByteProgressOptions {
  /** 복사 후 사본 재해시(검증) 진행률 */
  onVerifyBytes?: (done: number, total: number) => void
}

export interface CopyResult {
  /** 실제로 쓴 최종 절대경로 (이름 충돌 시 ' (2)' 접미) */
  destPath: string
  sha256: string
  sizeBytes: number
  /** 같은 이름·같은 내용의 파일이 이미 있어(이전 중단된 가져오기의 잔여물) 복사 없이 그 파일을 쓴 경우 true */
  reusedExisting: boolean
}

const MAX_COUNTER = 9999

async function lstatOrNull(p: string) {
  try {
    return await lstat(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function fsyncFile(p: string): Promise<void> {
  const fh = await open(p, 'r+')
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/** POSIX: rename 을 디스크에 확정하려면 상위 폴더도 fsync 한다 (윈도우는 폴더를 열 수 없어 생략) */
async function fsyncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  const fh = await open(dir, 'r').catch(() => null)
  if (!fh) return
  try {
    await fh.sync()
  } catch {
    // 일부 파일시스템(네트워크·exFAT)은 폴더 fsync 를 지원하지 않는다
  } finally {
    await fh.close()
  }
}

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 윈도우에서는 백신·검색 인덱서가 새 파일을 잠깐 붙잡아 EPERM/EBUSY 가 흔하다 → 짧게 늘려 가며 다시 시도 (총 약 2초) */
export async function withFsRetry<T>(fn: () => Promise<T>, platform: string = process.platform): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (platform !== 'win32' || !RETRY_CODES.has(code) || attempt >= 6) throw err
      await sleep(60 * (attempt + 1))
    }
  }
}

/**
 * partial → dest 를 덮어쓰지 않고 확정한다. 하드링크는 대상이 있으면 EEXIST 로 실패하므로 다른 프로세스가
 * 같은 이름을 만들었어도 덮어쓰지 않는다. 링크를 지원하지 않는 파일시스템(FAT/exFAT 등)이면 직전 확인 + rename.
 */
async function placeExclusive(partial: string, dest: string): Promise<'placed' | 'exists'> {
  let linked = false
  try {
    await link(partial, dest)
    linked = true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'exists'
  }
  if (linked) {
    // 남은 .partial 이름은 같은 내용의 두 번째 이름일 뿐이다. 지우지 못하면 다음 저장소 점검이 지운다
    await withFsRetry(() => unlink(partial)).catch(() => undefined)
    return 'placed'
  }
  if (await lstatOrNull(dest)) return 'exists'
  await withFsRetry(() => rename(partial, dest))
  return 'placed'
}

type Slot = { kind: 'free'; path: string } | { kind: 'same'; path: string }

/** 비어 있는 이름을 찾는다. 같은 내용 파일이 그 이름에 있으면 그것을 돌려준다 */
async function findSlot(dir: string, fileName: string, size: number, sha: string, from = 1): Promise<Slot> {
  for (let n = from; n <= MAX_COUNTER; n++) {
    const candidate = join(dir, withCounter(fileName, n))
    const st = await lstatOrNull(candidate)
    if (!st) return { kind: 'free', path: candidate }
    if (st.isFile() && st.size === size && (await hashFile(candidate)) === sha) return { kind: 'same', path: candidate }
  }
  throw new AppError('IO_ERROR', `같은 이름의 파일이 너무 많습니다: ${fileName}`)
}

/**
 * 검증 복사: <dest>.partial 로 복사(원본은 읽기 전용, 읽으면서 해시) → fsync → 사본 재해시 →
 * 둘 다 expectedSha256 과 같으면 rename. 다르면 .partial 삭제 후 AppError('HASH_MISMATCH').
 * 기존 파일은 절대 덮어쓰지 않는다. 사본의 수정 시각은 원본과 같게 맞춘다.
 */
export async function copyVerified(
  src: string,
  destPath: string,
  expectedSha256: string,
  opts: CopyOptions = {}
): Promise<CopyResult> {
  const expected = expectedSha256.toLowerCase()
  const dir = dirname(destPath)
  const fileName = basename(destPath).normalize('NFC')
  let partial: string | null = null
  try {
    if (opts.signal?.aborted) throw new AppError('CANCELLED', '작업이 취소되었습니다.')
    const srcStat = await stat(src)
    if (!srcStat.isFile()) throw new AppError('INVALID_ARGUMENT', `파일이 아닙니다: ${src}`)
    const size = srcStat.size
    await mkdir(dir, { recursive: true })

    let slot = await findSlot(dir, fileName, size, expected)
    if (slot.kind === 'same') return { destPath: slot.path, sha256: expected, sizeBytes: size, reusedExisting: true }

    partial = `${slot.path}${STORE_LAYOUT.partialSuffix}`
    await rm(partial, { force: true })
    const hash = createHash('sha256')
    await pipeline(
      createReadStream(src, { flags: 'r', highWaterMark: READ_CHUNK }),
      hashingTap(hash, size, opts.onBytes),
      createWriteStream(partial, { flags: 'wx' }),
      opts.signal ? { signal: opts.signal } : {}
    )
    const readSha = hash.digest('hex')
    if (readSha !== expected) {
      throw new AppError('HASH_MISMATCH', `원본 파일 내용이 분석 때와 다릅니다: ${basename(src)}`, `${readSha} != ${expected}`)
    }
    await fsyncFile(partial)
    await utimes(partial, srcStat.atime, srcStat.mtime)
    const copySha = await hashFile(partial, { onBytes: opts.onVerifyBytes, signal: opts.signal })
    if (copySha !== expected) {
      throw new AppError('HASH_MISMATCH', `복사본 검증에 실패했습니다: ${basename(src)}`, `${copySha} != ${expected}`)
    }

    // 복사하는 사이 같은 이름이 생겼으면 다음 이름으로
    while ((await placeExclusive(partial, slot.path)) === 'exists') {
      const n = Number(/ \((\d+)\)(\.[^.]*)?$/.exec(basename(slot.path))?.[1] ?? 1)
      slot = await findSlot(dir, fileName, size, expected, n + 1)
      if (slot.kind === 'same') {
        await rm(partial, { force: true })
        return { destPath: slot.path, sha256: expected, sizeBytes: size, reusedExisting: true }
      }
    }
    partial = null
    await fsyncDir(dir)
    return { destPath: slot.path, sha256: expected, sizeBytes: size, reusedExisting: false }
  } catch (err) {
    if (partial) await withFsRetry(() => rm(partial!, { force: true })).catch(() => undefined)
    throw ioError(err, `파일을 복사하지 못했습니다: ${basename(src)}`)
  }
}
