/**
 * 저장소 점검(앱 시작·저장소 열기 때): 강제 종료 등으로 남은 흔적을 정리한다.
 *  1) 스캔플랜/** 의 '*.partial' (복사 도중 끊긴 임시 파일) 삭제
 *  2) 카탈로그에 없는 측정 사본('*.nde'·'*.opd' — SUPPORTED_EXTENSIONS, 복사는 끝났지만 DB 기록 전에 끊긴 사본)을
 *     '미등록_파일/<시각>/' 으로 옮김
 *     — 그대로 두면 나중에 다른 플랜이 같은 플랜 ID 를 받아 그 폴더에 섞인다
 *  3) 비게 된 시편·플랜 폴더 정리
 * 원본 폴더는 건드리지 않는다. 저장소 안에서만 이동·삭제한다.
 */
import type { Dirent } from 'node:fs'
import { mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { STORE_LAYOUT, SUPPORTED_EXTENSIONS } from '@shared/types'
import { resolveStoreLayout, toRelPath } from './layout'

export const QUARANTINE_DIR = STORE_LAYOUT.quarantineDir

export interface StoreRecoveryResult {
  removedPartialCount: number
  /** 옮긴 미등록 파일: 원래 위치 → 옮긴 위치 (저장소 기준 상대경로) */
  quarantined: Array<{ from: string; to: string }>
  /** 옮긴 파일이 있으면 그 폴더 (저장소 기준 상대경로) */
  quarantineDir: string | null
  /** 읽거나 옮기지 못한 경로 */
  problems: string[]
}

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'
export const relKey = (rel: string): string => {
  const k = rel.normalize('NFC')
  return CASE_INSENSITIVE ? k.toLowerCase() : k
}

async function listTree(dir: string, out: string[], problems: string[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    problems.push(dir)
    return
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await listTree(p, out, problems)
    else if (e.isFile()) out.push(p)
  }
}

function stampOf(d: Date): string {
  const z = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

export async function recoverStore(storeRoot: string, registeredRelPaths: Iterable<string>, now: Date = new Date()): Promise<StoreRecoveryResult> {
  const layout = resolveStoreLayout(storeRoot)
  const result: StoreRecoveryResult = { removedPartialCount: 0, quarantined: [], quarantineDir: null, problems: [] }
  const registered = new Set([...registeredRelPaths].map(relKey))
  const files: string[] = []
  await listTree(layout.plansDir, files, result.problems)

  const touchedDirs = new Set<string>()
  const quarantineRel = `${QUARANTINE_DIR}/${stampOf(now)}`
  for (const abs of files) {
    const name = abs.slice(dirname(abs).length + 1)
    try {
      if (name.endsWith(STORE_LAYOUT.partialSuffix)) {
        await rm(abs, { force: true })
        result.removedPartialCount++
        touchedDirs.add(dirname(abs))
        continue
      }
      const lower = name.toLowerCase()
      if (!SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue
      const rel = toRelPath(layout.root, abs)
      if (registered.has(relKey(rel))) continue
      const to = `${quarantineRel}/${rel.slice(STORE_LAYOUT.plansDir.length + 1)}`
      const dest = join(layout.root, ...to.split('/'))
      await mkdir(dirname(dest), { recursive: true })
      await rename(abs, dest)
      result.quarantined.push({ from: rel, to })
      touchedDirs.add(dirname(abs))
    } catch (err) {
      result.problems.push(`${abs}: ${String(err)}`)
    }
  }
  if (result.quarantined.length) result.quarantineDir = quarantineRel
  for (const dir of touchedDirs) await removeEmptyUpTo(dir, layout.plansDir)
  return result
}

/** dir 부터 위로 올라가며 빈 폴더를 지운다 (stopAt 은 지우지 않는다) */
async function removeEmptyUpTo(dir: string, stopAt: string): Promise<void> {
  let cur = dir
  while (cur.length > stopAt.length && cur.startsWith(stopAt)) {
    if (!(await rmdir(cur).then(() => true, () => false))) return
    cur = dirname(cur)
  }
}
