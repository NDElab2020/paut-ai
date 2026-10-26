import { createHash, type Hash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AppError } from '@shared/errors'

export interface ByteProgressOptions {
  onBytes?: (done: number, total: number) => void
  signal?: AbortSignal
}

export const READ_CHUNK = 1024 * 1024
const PROGRESS_STEP = 8 * 1024 * 1024

/** 지나가는 바이트를 해시하고 세는 Transform (진행률은 8MB 마다 + 끝에서) */
export function hashingTap(hash: Hash, total: number, onBytes?: (done: number, total: number) => void): Transform {
  let done = 0
  let lastReport = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk)
      done += chunk.length
      if (onBytes && done - lastReport >= PROGRESS_STEP) {
        lastReport = done
        onBytes(done, total)
      }
      cb(null, chunk)
    },
    flush(cb) {
      onBytes?.(done, total)
      cb()
    }
  })
}

export function ioError(err: unknown, message: string): AppError {
  if (err instanceof AppError) return err
  const e = err as NodeJS.ErrnoException
  if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') return new AppError('CANCELLED', '작업이 취소되었습니다.')
  if (e?.code === 'ENOENT') return new AppError('NOT_FOUND', `${message} (파일 없음)`, e.message)
  return new AppError('IO_ERROR', message, e instanceof Error ? e.message : String(err))
}

/** 스트리밍 SHA-256 (hex 소문자). 파일은 읽기 전용으로만 연다 */
export async function hashFile(path: string, opts: ByteProgressOptions = {}): Promise<string> {
  try {
    const total = (await stat(path)).size
    const hash = createHash('sha256')
    const sink = new Writable({ write: (_c, _e, cb) => cb() })
    await pipeline(
      createReadStream(path, { flags: 'r', highWaterMark: READ_CHUNK }),
      hashingTap(hash, total, opts.onBytes),
      sink,
      opts.signal ? { signal: opts.signal } : {}
    )
    return hash.digest('hex')
  } catch (err) {
    throw ioError(err, `파일 해시를 계산하지 못했습니다: ${path}`)
  }
}
