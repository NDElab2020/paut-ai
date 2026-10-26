/** 저장소 폴더·파일 이름 규칙 (Windows 기준으로 안전하게, 유니코드 NFC) */
import { AppError } from '@shared/errors'
import { sanitizePathSegment } from '@shared/ids'

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i
const MAX_FILE_NAME = 150

/** 'CON.nde' 처럼 점 앞부분이 예약어여도 Windows 에서 문제가 되므로 그 부분에 '_' 를 붙인다 */
function guardReserved(name: string): string {
  const dot = name.indexOf('.')
  const head = dot < 0 ? name : name.slice(0, dot)
  return RESERVED.test(head) ? `${head}_${name.slice(head.length)}` : name
}

/** 폴더 이름 한 칸 (시편 ID 등). 비면 AppError('INVALID_ARGUMENT') */
export function safeDirName(raw: string): string {
  const s = guardReserved(sanitizePathSegment(raw).replace(/^\./, '_.'))
  if (s.length === 0) throw new AppError('INVALID_ARGUMENT', `폴더 이름으로 쓸 수 없는 값입니다: '${raw}'`)
  return s
}

/** 확장자 분리 ('a.b.nde' → ['a.b', '.nde'], '.nde' 단독은 확장자 없음) */
export function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return [name, '']
  return [name.slice(0, dot), name.slice(dot)]
}

/** 파일 이름 (확장자 보존, 길면 본문만 자름). 비면 AppError('INVALID_ARGUMENT') */
export function safeFileName(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .replace(/^\./, '_.')
  const [rawStem, ext] = splitExt(cleaned)
  const stem = rawStem.replace(/[. ]+$/g, '').slice(0, Math.max(1, MAX_FILE_NAME - ext.length))
  const name = guardReserved(stem.length > 0 ? `${stem}${ext}` : '')
  if (name.length === 0 || name === '.' || name === '..') {
    throw new AppError('INVALID_ARGUMENT', `파일 이름으로 쓸 수 없는 값입니다: '${raw}'`)
  }
  return name
}

/** 'a.nde' → 'a (2).nde' */
export function withCounter(fileName: string, n: number): string {
  if (n <= 1) return fileName
  const [stem, ext] = splitExt(fileName)
  return `${stem} (${n})${ext}`
}
