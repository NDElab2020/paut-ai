/** 저장소 위치 검사: 측정 원본이 든 폴더를 저장소로 고르면 원본 폴더에 쓰기가 생기므로 막는다 */
import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { SUPPORTED_EXTENSIONS, UNSUPPORTED_EXTENSIONS } from '@shared/types'
import { isHiddenName } from './scan'

const DATA_EXTENSIONS = new Set([...SUPPORTED_EXTENSIONS, ...Object.keys(UNSUPPORTED_EXTENSIONS)])

export interface SourceDataProbe {
  /** 처음 찾은 측정 파일 경로 (없으면 null) */
  found: string | null
  /** 항목이 너무 많아 끝까지 보지 못함 */
  truncated: boolean
}

/** dir 아래(숨김 제외)에 .nde/.opd/.oud/.wkb 가 있는지 최대 maxEntries 개까지 본다 */
export async function containsSourceData(dir: string, maxEntries = 20_000): Promise<SourceDataProbe> {
  let seen = 0
  const queue = [dir]
  while (queue.length) {
    const cur = queue.shift()!
    let entries: Dirent[]
    try {
      entries = await readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (++seen > maxEntries) return { found: null, truncated: true }
      if (isHiddenName(e.name)) continue
      const p = join(cur, e.name)
      if (e.isDirectory()) queue.push(p)
      else if (e.isFile() && DATA_EXTENSIONS.has(extname(e.name).toLowerCase())) return { found: p, truncated: false }
    }
  }
  return { found: null, truncated: false }
}
