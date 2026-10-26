import { randomBytes } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AppError } from '@shared/errors'
import { isPlanId } from '@shared/ids'
import { STORE_LAYOUT, type PlanId, type SpecimenId } from '@shared/types'
import { safeDirName, safeFileName } from './names'

export interface StoreLayout {
  /** 저장소 루트 절대경로 */
  root: string
  /** <root>/스캔플랜 */
  plansDir: string
  /** <root>/catalog.db */
  catalogPath: string
}

export function resolveStoreLayout(storeRoot: string): StoreLayout {
  if (typeof storeRoot !== 'string' || storeRoot.trim().length === 0) {
    throw new AppError('NO_STORE_ROOT', '저장소 폴더가 정해지지 않았습니다.')
  }
  const root = resolve(storeRoot)
  return { root, plansDir: join(root, STORE_LAYOUT.plansDir), catalogPath: join(root, STORE_LAYOUT.catalogFile) }
}

/** 폴더 생성·쓰기 가능 확인. 실패 시 AppError('STORE_ROOT_INVALID') */
export async function ensureStoreRoot(storeRoot: string): Promise<StoreLayout> {
  const layout = resolveStoreLayout(storeRoot)
  try {
    const st = await stat(layout.root).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (st && !st.isDirectory()) throw new Error('not a directory')
    await mkdir(layout.plansDir, { recursive: true })
    const probe = join(layout.root, `.write-test-${randomBytes(4).toString('hex')}`)
    await writeFile(probe, 'ok', { flag: 'wx' })
    await rm(probe, { force: true })
  } catch (err) {
    throw new AppError('STORE_ROOT_INVALID', `저장소 폴더를 만들거나 쓸 수 없습니다: ${layout.root}`, String(err))
  }
  return layout
}

/** 저장 상대경로 (POSIX): '스캔플랜/<planId>/<specimenId>/<fileName>'. 이름은 안전 문자로 치환·NFC */
export function plannedRelPath(planId: PlanId, specimenId: SpecimenId, fileName: string): string {
  if (!isPlanId(planId)) throw new AppError('INVALID_ARGUMENT', `플랜 ID 형식이 올바르지 않습니다: ${planId}`)
  return [STORE_LAYOUT.plansDir, planId, safeDirName(specimenId), safeFileName(fileName)].join('/')
}

/** POSIX 상대경로 → OS 절대경로 (root 밖으로 나가면 AppError('INVALID_ARGUMENT')) */
export function toAbsolutePath(storeRoot: string, relPath: string): string {
  const root = resolve(storeRoot)
  const segs = relPath.split('/')
  const bad =
    relPath.length === 0 ||
    relPath.includes('\\') ||
    isAbsolute(relPath) ||
    /^[a-zA-Z]:/.test(relPath) ||
    segs.some((s) => s === '' || s === '.' || s === '..')
  if (bad) throw new AppError('INVALID_ARGUMENT', `저장 경로가 올바르지 않습니다: ${relPath}`)
  const abs = join(root, ...segs)
  const rel = relative(root, abs)
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new AppError('INVALID_ARGUMENT', `저장소 밖의 경로입니다: ${relPath}`)
  }
  return abs
}

/** 절대경로 → storeRoot 기준 POSIX 상대경로 (밖이면 AppError('INVALID_ARGUMENT')) */
export function toRelPath(storeRoot: string, absPath: string): string {
  const rel = relative(resolve(storeRoot), resolve(absPath))
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AppError('INVALID_ARGUMENT', `저장소 밖의 경로입니다: ${absPath}`)
  }
  return rel.split(sep).join('/').normalize('NFC')
}
