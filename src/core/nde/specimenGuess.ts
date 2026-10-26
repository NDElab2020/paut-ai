/**
 * 파일명 → 시편 ID·상태 태그·회차 제안.
 * 장비 원본 파일명(ModelSetup SaveFileName)을 먼저 보고, 없으면 현재 파일명을 본다.
 * 'Cap on/off', 'CAP20', 'R2', '재스캔' 은 시편 ID 가 아니라 태그/회차다.
 */
import type { NdeFileMeta, SpecimenIdSource } from '@shared/types'

export interface SpecimenPattern {
  /** 표시용 이름 */
  name: string
  /** 첫 캡처 그룹 = 접두사, 둘째 = 번호 */
  re: RegExp
}

/** 시편 ID 패턴 (위에서부터 우선). 대문자 접두사 + 숫자로 정규화한다 */
export const DEFAULT_SPECIMEN_PATTERNS: readonly SpecimenPattern[] = [
  { name: 'PL 번호', re: /(?<![A-Za-z0-9])(PL)[-_ ]?(\d{2,})(?![0-9])/i },
  { name: 'TP 번호', re: /(?<![A-Za-z0-9])(TP)[-_ ]?(\d{2,})(?![0-9])/i }
]

export type StateTag = 'Cap on' | 'Cap off'

export interface SpecimenGuess {
  specimenId: string | null
  source: SpecimenIdSource | null
  stateTag: StateTag | null
  stateTagSource: SpecimenIdSource | null
  round: number | null
  /** 그 밖의 태그 (원문 토큰): 'CAP20', '재스캔' */
  tags: string[]
  /** 판단 근거 (한국어) */
  notes: string[]
}

type NameSource = { text: string; source: SpecimenIdSource }

function stem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.(nde|opd)$/i, '').normalize('NFC')
}

export function matchSpecimenId(text: string, patterns: readonly SpecimenPattern[] = DEFAULT_SPECIMEN_PATTERNS): string | null {
  for (const p of patterns) {
    const m = p.re.exec(text)
    if (m) return `${m[1]!.toUpperCase()}${m[2]}`
  }
  return null
}

export function matchStateTag(text: string): { tag: StateTag; token: string | null } | null {
  if (/cap[\s_-]*off|no[\s_-]*cap|캡\s*(없음|제거)/i.test(text)) return { tag: 'Cap off', token: null }
  if (/cap[\s_-]*on|캡\s*있음/i.test(text)) return { tag: 'Cap on', token: null }
  const m = /(?<![A-Za-z])(cap)[-_ ]?(\d+)(?![0-9])/i.exec(text)
  if (m) return { tag: 'Cap on', token: `CAP${m[2]}` }
  return null
}

/** 회차: 'R2', '2회', '회차2', 'rescan2'. 숫자 없는 재스캔은 태그만 */
export function matchRound(text: string): { round: number | null; rescan: boolean } {
  const patterns = [
    /(?<![A-Za-z0-9])R(\d{1,2})(?![0-9A-Za-z])/i,
    /(?<![0-9])(\d{1,2})\s*회차?(?![0-9])/,
    /회차\s*(\d{1,2})/,
    /re-?scan[-_ ]?(\d{1,2})/i,
    /재스캔[-_ ]?(\d{1,2})/
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return { round: Number(m[1]), rescan: true }
  }
  return { round: null, rescan: /re-?scan|재스캔/i.test(text) }
}

/** 시편 ID·상태 태그·회차 제안. meta 는 deviceFileName 만 쓴다 */
export function suggestSpecimen(
  meta: Pick<NdeFileMeta, 'deviceFileName'> | null,
  currentFileName: string,
  patterns: readonly SpecimenPattern[] = DEFAULT_SPECIMEN_PATTERNS
): SpecimenGuess {
  const sources: NameSource[] = []
  if (meta?.deviceFileName) sources.push({ text: meta.deviceFileName.normalize('NFC'), source: 'device-filename' })
  sources.push({ text: stem(currentFileName), source: 'filename' })
  const guess: SpecimenGuess = { specimenId: null, source: null, stateTag: null, stateTagSource: null, round: null, tags: [], notes: [] }
  const label = (s: SpecimenIdSource): string => (s === 'device-filename' ? '장비 원본 파일명' : '현재 파일명')

  for (const s of sources) {
    const id = matchSpecimenId(s.text, patterns)
    if (id) {
      Object.assign(guess, { specimenId: id, source: s.source })
      guess.notes.push(`시편 ID '${id}' 를 ${label(s.source)} '${s.text}' 에서 찾았습니다.`)
      break
    }
  }
  if (!guess.specimenId) guess.notes.push('파일명에서 시편 ID 패턴(PL·TP 번호)을 찾지 못했습니다.')

  // 상태 태그는 사람이 붙인 현재 파일명('Cap on')을 우선, 없으면 장비 파일명('CAP20')
  const states = sources.map((s) => ({ s, m: matchStateTag(s.text) })).filter((x) => x.m)
  const preferred = states.find((x) => x.s.source === 'filename') ?? states[0]
  if (preferred?.m) {
    guess.stateTag = preferred.m.tag
    guess.stateTagSource = preferred.s.source
    if (new Set(states.map((x) => x.m!.tag)).size > 1) guess.notes.push('장비 파일명과 현재 파일명의 캡 상태가 달라 현재 파일명을 따랐습니다.')
  }
  for (const x of states) if (x.m?.token && !guess.tags.includes(x.m.token)) guess.tags.push(x.m.token)

  for (const s of sources) {
    const r = matchRound(s.text)
    if (r.round !== null && guess.round === null) guess.round = r.round
    if (r.rescan && !guess.tags.includes('재스캔')) guess.tags.push('재스캔')
  }
  return guess
}
