/**
 * 엑셀 시각 → ISO 8601 (한국 시간 '+09:00').
 * 양식의 시각 칸은 한국 시간 벽시계 값이다(지침서 14절). 엑셀 날짜 일련번호에는 시간대가 없으므로 그 값을 그대로 +09:00 으로 붙인다.
 */

/** 한국 시간 오프셋 (분) */
export const KST_OFFSET_MINUTES = 9 * 60

/** 1900 날짜 체계에서 1970-01-01 의 일련번호 */
const EPOCH_1900 = 25_569
/** 1904 날짜 체계에서 1970-01-01 의 일련번호 */
const EPOCH_1904 = 24_107

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

/** UTC 기준 '벽시계' 밀리초 → 'YYYY-MM-DDTHH:MM:SS+09:00' */
function wallMsToKstIso(wallMs: number): string {
  const d = new Date(wallMs)
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
  )
}

/** 시각(Date) → 한국 시간 ISO */
export function toKstIso(date: Date): string {
  return wallMsToKstIso(date.getTime() + KST_OFFSET_MINUTES * 60_000)
}

/** 'YYYY-MM-DD' (날짜만) */
export function excelSerialToDateText(serial: number, date1904: boolean): string {
  return excelSerialToKstIso(serial, date1904).slice(0, 10)
}

/**
 * 엑셀 날짜 일련번호 → 한국 시간 ISO. 초 단위로 반올림한다(엑셀 부동소수 오차).
 * 1900 체계는 1900-03-01 이후만 맞다(엑셀의 1900-02-29 버그 — 판독 시각에는 상관없음).
 */
export function excelSerialToKstIso(serial: number, date1904: boolean): string {
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900
  const seconds = Math.round((serial - epoch) * 86_400)
  return wallMsToKstIso(seconds * 1000)
}

function realDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export type TimeTextResult = { ok: true; iso: string } | { ok: false; reason: string }

const TIME_RE =
  /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i

/**
 * 글자 시각 → 한국 시간 ISO. '2026-10-20 14:05', '2026/10/20 14:05:30', '2026-10-20T14:05+09:00' 등.
 * 시간대가 없으면 한국 시간으로 본다. 시간대가 있으면 한국 시간으로 바꾼다. 날짜만 있으면 실패.
 */
export function parseTimeText(text: string): TimeTextResult {
  const m = TIME_RE.exec(text.trim())
  if (!m) return { ok: false, reason: '날짜·시각 형식이 아닙니다 (예: 2026-10-20 14:05)' }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!realDate(y, mo, d)) return { ok: false, reason: '없는 날짜입니다' }
  if (m[4] === undefined) return { ok: false, reason: '시각이 없습니다 (날짜와 시각을 함께 적습니다: 2026-10-20 14:05)' }
  const [hh, mm, ss] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]
  if (hh > 23 || mm > 59 || ss > 59) return { ok: false, reason: '없는 시각입니다' }
  let wall = Date.UTC(y, mo - 1, d, hh, mm, ss)
  const tz = m[7]
  if (tz !== undefined) {
    let offsetMin = 0
    if (tz.toUpperCase() !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1
      const digits = tz.slice(1).replace(':', '')
      offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)))
    }
    wall = wall - offsetMin * 60_000 + KST_OFFSET_MINUTES * 60_000
  }
  return { ok: true, iso: wallMsToKstIso(wall) }
}

/** 두 한국 시간 ISO 사이 분 (b − a) */
export function minutesBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / 60_000
}
