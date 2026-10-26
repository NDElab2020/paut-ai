/**
 * 내보내기(쓰기) 경로 규칙 — C-scan .txt·라벨 JSON 백업·검수 CSV·학습 데이터 폴더가 같은 규칙을 쓴다.
 * 원시데이터는 읽기만: 저장소 폴더 안, 가져올 때의 원본 폴더(그 아래 포함), 측정 원본(.nde·.opd·.oud·.wkb)이 바로 든 폴더에는 쓰지 않는다.
 * 대화상자로 고른 경로만 오지만(main handlers), 사용자가 실수로 원본 폴더를 고른 경우를 막는다.
 */
import { readdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { AppError } from '@shared/errors'
import { SUPPORTED_EXTENSIONS, UNSUPPORTED_EXTENSIONS } from '@shared/types'

const SOURCE_DATA_EXTENSIONS = new Set<string>([...SUPPORTED_EXTENSIONS, ...Object.keys(UNSUPPORTED_EXTENSIONS)])

/** 측정 원본(.nde·.opd·.oud·.wkb)이 바로 들어 있는 폴더인가 (한 단계만 본다 — 원시데이터 폴더에는 쓰지 않는다) */
export async function holdsSourceData(dir: string): Promise<boolean> {
  const names = await readdir(dir).catch(() => [] as string[])
  return names.some((n) => !n.startsWith('.') && SOURCE_DATA_EXTENSIONS.has(extname(n).toLowerCase()))
}

/** a 가 dir 안(같은 폴더 포함)에 있나 — NFC 로 맞춰 비교 */
export function isInside(a: string, dir: string): boolean {
  const rel = relative(resolve(dir).normalize('NFC'), resolve(a).normalize('NFC'))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export const STORE_TARGET_MESSAGE = '저장소 폴더 안에는 내보낼 수 없습니다. 다른 폴더를 고르세요.'
export const SOURCE_TARGET_MESSAGE = '원본 데이터 폴더에는 내보낼 수 없습니다(원시데이터는 읽기만). 다른 폴더를 고르세요.'

export interface ExportTargetRules {
  /** 저장소 폴더 */
  storeRoot: string
  /** 가져올 때의 원본 폴더들 (그 아래 포함 거절) */
  sourceDirs: Iterable<string>
}

/**
 * 쓰려는 곳 검사. target = 새로 쓸 파일 경로(kind 'file' — 그 파일이 든 폴더를 본다) 또는
 * 그 안에 새 폴더를 만들 폴더(kind 'dir' — 그 폴더 자체를 본다). 어기면 INVALID_ARGUMENT (C-scan 내보내기와 같은 글자).
 */
export async function assertExportTarget(target: string, kind: 'file' | 'dir', rules: ExportTargetRules): Promise<void> {
  if (isInside(target, rules.storeRoot)) throw new AppError('INVALID_ARGUMENT', STORE_TARGET_MESSAGE, target)
  for (const d of rules.sourceDirs) {
    if (d && isInside(target, d)) throw new AppError('INVALID_ARGUMENT', SOURCE_TARGET_MESSAGE, target)
  }
  if (await holdsSourceData(kind === 'file' ? dirname(target) : target)) throw new AppError('INVALID_ARGUMENT', SOURCE_TARGET_MESSAGE, target)
}
