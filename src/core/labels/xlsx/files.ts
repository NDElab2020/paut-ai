/**
 * 엑셀 파일명 → 앱 파일 찾기 도우미, 그룹 기법 읽기.
 */
import type { GroupTechnique, LabelWorkbookFile } from './types'

/**
 * 파일명 비교 열쇠: NFC, 앞뒤 공백 제거, 폴더 경로 제거, 소문자, 끝의 '.nde'·'.opd'(앱이 가져오는 확장자) 제거.
 * '12T-SV-01-Cap on.nde' 와 '12t-sv-01-cap on' 은 같은 열쇠, 'TP14-ROOT-L-01.opd' 와 'TP14-ROOT-L-01' 도 같은 열쇠.
 * 같은 이름의 .nde 와 .opd 가 둘 다 저장소에 있으면 한 열쇠에 두 파일이 걸려 미리보기가 어느 파일인지 고르게 한다.
 */
export function fileNameKey(name: string): string {
  const base = name.normalize('NFC').trim().split(/[\\/]/).pop() ?? ''
  return base
    .trim()
    .toLowerCase()
    .replace(/\.(nde|opd)$/, '')
    .trim()
}

export interface FileFinderEntry {
  /** 이 파일을 가리킬 수 있는 이름들: 저장된 원본 파일명, 장비 원본 파일명(SaveFileName) 등. null 은 건너뜀 */
  names: ReadonlyArray<string | null | undefined>
  file: LabelWorkbookFile
}

/** 이름 목록으로 findFiles·findFileBySha256 만들기. 같은 sha256 은 한 번만 돌려준다 */
export function makeFileFinder(entries: readonly FileFinderEntry[]): {
  findFiles(name: string): LabelWorkbookFile[]
  findFileBySha256(sha256: string): LabelWorkbookFile | null
} {
  const byName = new Map<string, LabelWorkbookFile[]>()
  const bySha = new Map<string, LabelWorkbookFile>()
  for (const e of entries) {
    bySha.set(e.file.sha256.toLowerCase(), e.file)
    for (const n of e.names) {
      if (!n) continue
      const k = fileNameKey(n)
      if (k === '') continue
      const list = byName.get(k) ?? []
      if (!list.some((f) => f.sha256 === e.file.sha256)) list.push(e.file)
      byName.set(k, list)
    }
  }
  return {
    findFiles: (name) => [...(byName.get(fileNameKey(name)) ?? [])],
    findFileBySha256: (sha) => bySha.get(sha.trim().toLowerCase()) ?? null
  }
}

/** 기법 글자 → 엑셀 그룹 칸의 기법 ('pa-sectorial'·'sectorial'·'Sectorial' → 'sectorial') */
export function groupTechniqueOf(technique: string): GroupTechnique {
  const n = technique.toLowerCase()
  if (n.includes('sector')) return 'sectorial'
  if (n.includes('compound')) return 'compound'
  if (n.includes('linear')) return 'linear'
  return 'other'
}

/** 스큐를 0 이상 360 미만으로 */
export function normalizeSkew(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** 두 스큐가 같은 방향인지 (±0.5°) */
export function sameSkew(a: number | null, b: number): boolean {
  if (a === null || !Number.isFinite(a)) return false
  const d = Math.abs(normalizeSkew(a) - normalizeSkew(b))
  return Math.min(d, 360 - d) <= 0.5
}
