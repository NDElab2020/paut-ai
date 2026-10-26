/**
 * 틀 좌표(파일 U 또는 시편 좌표 s)의 구간 계산 — 매칭(match.ts)과 지표(metrics.ts)가 같이 쓴다 (런타임 의존성 없음).
 */

/** 틀 좌표의 구간 (검토 범위, 구간 단위 등) */
export interface Span {
  frameKey: string
  startMm: number
  endMm: number
}

/** 두 구간의 겹침(≥ 0)과 간격(≥ 0). 맞닿으면 둘 다 0 */
export function intervalGap(aStart: number, aEnd: number, bStart: number, bEnd: number): { overlapMm: number; gapMm: number } {
  const o = Math.min(aEnd, bEnd) - Math.max(aStart, bStart)
  return { overlapMm: Math.max(0, o), gapMm: Math.max(0, -o) }
}

/** 틀 키마다 겹치거나 맞닿은 구간을 합친다. 키·시작 순서로 정렬해 돌려준다 (길이 0 구간은 뺀다) */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.endMm > s.startMm)
    .map((s) => ({ frameKey: s.frameKey, startMm: s.startMm, endMm: s.endMm }))
    .sort((x, y) => (x.frameKey < y.frameKey ? -1 : x.frameKey > y.frameKey ? 1 : x.startMm - y.startMm))
  const out: Span[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && last.frameKey === s.frameKey && s.startMm <= last.endMm) last.endMm = Math.max(last.endMm, s.endMm)
    else out.push(s)
  }
  return out
}

/** 두 쪽이 모두 덮은 범위 (교집합). 2인 비교의 검토 범위·구간 단위 일치도는 이 안에서만 잰다 */
export function intersectCoverage(a: readonly Span[], b: readonly Span[]): Span[] {
  const ma = mergeSpans(a)
  const mb = mergeSpans(b)
  const out: Span[] = []
  for (const x of ma) {
    for (const y of mb) {
      if (x.frameKey !== y.frameKey) continue
      const s = Math.max(x.startMm, y.startMm)
      const e = Math.min(x.endMm, y.endMm)
      if (e > s) out.push({ frameKey: x.frameKey, startMm: s, endMm: e })
    }
  }
  return mergeSpans(out)
}

/** 구간 [start, end] 가 범위 안에 걸치는지 (같은 틀 키, 겹치거나 한 점이면 그 점이 범위 안) */
export function touchesCoverage(frameKey: string, startMm: number, endMm: number, coverage: readonly Span[]): boolean {
  for (const c of coverage) {
    if (c.frameKey !== frameKey) continue
    if (endMm === startMm) {
      if (startMm >= c.startMm && startMm <= c.endMm) return true
    } else if (startMm < c.endMm && endMm > c.startMm) return true
  }
  return false
}
