import type { BigIntStats, Dirent } from 'node:fs'
import { lstat as lstatAny, readdir } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path'
import { AppError } from '@shared/errors'

export interface InputFile {
  path: string
  /** NFC 정규화된 파일명 */
  fileName: string
  /** 소문자 확장자 ('.nde') */
  ext: string
  sizeBytes: number
}

export interface ScanInputsResult {
  files: InputFile[]
  /** 숨김 폴더·파일(이름이 '.' 으로 시작, Thumbs.db, desktop.ini, $RECYCLE.BIN, System Volume Information)로 건너뛴 수 */
  skippedHiddenCount: number
  /** 심볼릭 링크·특수 파일로 건너뛴 수 */
  skippedLinkCount: number
  /** 읽을 수 없어 건너뛴 하위 폴더 경로 */
  unreadablePaths: string[]
  /** excludeDirs(저장소 폴더 등) 안이라 건너뛴 경로 수 */
  skippedExcludedCount: number
}

export interface ScanOptions {
  signal?: AbortSignal
  /** 이 폴더(와 그 아래)는 탐색하지 않는다 — 저장소 폴더가 원본 폴더 안에 있을 때 사본을 다시 수집하지 않도록 */
  excludeDirs?: string[]
}

const HIDDEN_NAMES = new Set(['thumbs.db', 'desktop.ini', '$recycle.bin', 'system volume information', '__macosx'])

export function isHiddenName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || HIDDEN_NAMES.has(name.toLowerCase())
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError('CANCELLED', '작업이 취소되었습니다.')
}

/** bigint 로 받아야 윈도우 NTFS 64비트 FileId 가 2^53 을 넘어도 서로 다른 파일이 같은 키가 되지 않는다 */
const lstat = (p: string): Promise<BigIntStats> => lstatAny(p, { bigint: true })

/** 같은 파일을 두 번 넣지 않도록 (dev, ino) 로 식별. ino 가 없으면 정규화한 경로 */
function identity(path: string, st: BigIntStats): string {
  return st.ino ? `${st.dev}:${st.ino}` : resolve(path).normalize('NFC').toLowerCase()
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 윈도우·맥 파일시스템은 대소문자를 구분하지 않으므로 비교 키도 소문자로 */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'
const pathKey = (p: string): string => {
  const k = resolve(p).normalize('NFC')
  return CASE_INSENSITIVE ? k.toLowerCase() : k
}

/**
 * 파일·폴더 경로들을 재귀 탐색. 사용자가 직접 고른 경로는 그대로 쓰고, 그 아래의 숨김 항목은 건너뛴다.
 * 심볼릭 링크는 따라가지 않는다. 결과는 경로 기준 정렬, 중복 제거. 고른 경로가 없으면 AppError('NOT_FOUND').
 */
export async function scanInputPaths(paths: string[], options: ScanOptions | AbortSignal = {}): Promise<ScanInputsResult> {
  const opts: ScanOptions = options instanceof AbortSignal ? { signal: options } : options
  const { signal } = opts
  const excluded = (opts.excludeDirs ?? []).map(pathKey)
  const isExcluded = (p: string): boolean => excluded.some((dir) => isInside(pathKey(p), dir))
  const result: ScanInputsResult = { files: [], skippedHiddenCount: 0, skippedLinkCount: 0, unreadablePaths: [], skippedExcludedCount: 0 }
  // 폴더 순환 방지와 파일 중복 제거를 따로 둔다 (키가 겹쳐도 파일이 폴더 때문에 빠지지 않게)
  const seenDirs = new Set<string>()
  const seenFiles = new Set<string>()

  const addFile = (path: string, st: BigIntStats): void => {
    const id = identity(path, st)
    if (seenFiles.has(id)) return
    seenFiles.add(id)
    const fileName = basename(path).normalize('NFC')
    result.files.push({ path, fileName, ext: extname(fileName).toLowerCase(), sizeBytes: Number(st.size) })
  }

  const walk = async (dir: string, st: BigIntStats): Promise<void> => {
    checkAbort(signal)
    if (isExcluded(dir)) {
      result.skippedExcludedCount++
      return
    }
    const id = identity(dir, st)
    if (seenDirs.has(id)) return
    seenDirs.add(id)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      result.unreadablePaths.push(dir)
      return
    }
    for (const e of entries) {
      if (isHiddenName(e.name)) {
        result.skippedHiddenCount++
        continue
      }
      const p = join(dir, e.name)
      if (!e.isDirectory() && !e.isFile()) {
        result.skippedLinkCount++
        continue
      }
      let child: BigIntStats
      try {
        child = await lstat(p)
      } catch {
        result.unreadablePaths.push(p)
        continue
      }
      if (child.isDirectory()) await walk(p, child)
      else if (child.isFile()) addFile(p, child)
      else result.skippedLinkCount++
    }
  }

  for (const raw of paths) {
    checkAbort(signal)
    const p = resolve(raw)
    let st: BigIntStats
    try {
      st = await lstat(p)
    } catch (err) {
      throw new AppError('NOT_FOUND', `경로를 찾을 수 없습니다: ${raw}`, String(err))
    }
    if (isExcluded(p)) result.skippedExcludedCount++
    else if (st.isDirectory()) await walk(p, st)
    else if (st.isFile()) addFile(p, st)
    else result.skippedLinkCount++
  }

  const key = (f: InputFile): string => f.path.normalize('NFC')
  result.files.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  return result
}
