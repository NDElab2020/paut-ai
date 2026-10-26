/** 시편 ID·상태 태그·회차 제안. 규칙은 nde/specimenGuess 에 있고, 여기서는 가져오기 정책(대체 ID)만 더한다. */
import { sanitizeSpecimenId } from '@shared/ids'
import type { NdeFileMeta, SpecimenIdSource } from '@shared/types'
import { matchRound, matchSpecimenId, matchStateTag, suggestSpecimen } from '../nde'

export interface SpecimenSuggestion {
  id: string
  source: SpecimenIdSource
}

export interface ItemSuggestion {
  specimenId: string | null
  specimenSource: SpecimenIdSource | null
  stateTag: string | null
  round: number | null
  tags: string[]
  notes: string[]
}

const stem = (fileName: string): string => (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]+$/, '').normalize('NFC')

/** 시편 ID 제안: 장비 원본 파일명의 PL·TP·TF 번호 → 현재 파일명 → 없으면 null */
export function suggestSpecimenId(deviceFileName: string | null, sourceFileName: string): SpecimenSuggestion | null {
  const g = suggestSpecimen({ deviceFileName }, sourceFileName)
  return g.specimenId && g.source ? { id: g.specimenId, source: g.source } : null
}

/** 주어진 이름 순서대로 처음 찾은 상태 태그 ('Cap on' / 'Cap off') */
export function suggestStateTag(...names: Array<string | null>): string | null {
  for (const n of names) {
    const m = n ? matchStateTag(n) : null
    if (m) return m.tag
  }
  return null
}

/** 주어진 이름 순서대로 처음 찾은 회차 번호 */
export function suggestRound(...names: Array<string | null>): number | null {
  for (const n of names) {
    const r = n ? matchRound(n).round : null
    if (r !== null) return r
  }
  return null
}

/**
 * 가져오기 항목 제안. 시편 ID 패턴(PL·TP·TF)이 없으면 현재 파일명(확장자 제외)을 폴더에 쓸 수 있게 정리해
 * 대체 ID 로 제안한다(출처 'filename'). 사용자는 미리보기에서 고칠 수 있다.
 */
export function suggestForItem(meta: Pick<NdeFileMeta, 'deviceFileName'> | null, fileName: string): ItemSuggestion {
  const g = suggestSpecimen(meta, fileName)
  let specimenId = g.specimenId
  let specimenSource = g.source
  const notes = [...g.notes]
  if (!specimenId) {
    const fallback = sanitizeSpecimenId(stem(fileName))
    if (fallback) {
      specimenId = fallback
      specimenSource = 'filename'
      notes.push(`파일명 '${fallback}' 을(를) 시편 ID 로 임시 제안합니다.`)
    }
  }
  return { specimenId, specimenSource, stateTag: g.stateTag, round: g.round, tags: g.tags, notes }
}

/**
 * 바로 위 폴더 이름의 시편 번호(PL·TP)가 제안한 시편 ID 와 다르면 안내 문구 (같거나 폴더에 번호가 없으면 null).
 * 예: 'PCN교육/TP06/tp07-root-l-01.opd' — 장비 저장 이름·파일 이름은 TP07 인데 TP06 폴더에 들어 있다.
 */
export function folderSpecimenNote(sourcePath: string, specimenId: string | null): string | null {
  if (!specimenId) return null
  const parts = sourcePath.split(/[\\/]/).filter(Boolean)
  const folder = parts.length >= 2 ? parts[parts.length - 2]!.normalize('NFC') : ''
  const fromFolder = folder ? matchSpecimenId(folder) : null
  if (!fromFolder || fromFolder.toUpperCase() === specimenId.toUpperCase()) return null
  return `폴더 이름(${folder})의 시편 번호와 제안한 시편 ID(${specimenId})가 다릅니다. 어느 시편인지 확인하세요.`
}
