const pad = (n: number, w = 2): string => String(Math.trunc(Math.abs(n))).padStart(w, '0')

/** 로컬 시간대 ISO 8601 (콜론 있는 오프셋). 예: 2026-10-02T17:30:12+09:00 */
export function localIso(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  )
}
