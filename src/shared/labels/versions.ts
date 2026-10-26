/**
 * 병합 순서 판단 — 버전 벡터 (런타임 의존성 없음).
 *
 * 고칠 수 있는 단위(물리 결함·파일 정렬·지시 기록·관측 행·검토 구간)마다 versions = [{ pcId, edits }] 를 둔다.
 * 어느 PC 에서 고치면 그 PC 의 edits 를 1 올린다(bumpVersions). revision 은 edits 의 합(표시용)이다.
 *
 * 같은 UUID 의 두 사본 A·B 를 견줄 때 (compareVersions):
 *   - 모든 PC 에서 A.edits ≥ B.edits 이고 한 곳 이상에서 크면 → A 가 B 를 포함 ('a-newer'). A 를 남긴다.
 *   - 반대면 'b-newer'.
 *   - 모든 PC 에서 같으면 'same' (내용이 다르면 같은 PC ID 를 두 곳에서 쓴 것 — 부르는 쪽이 충돌로 다룬다).
 *   - 어느 쪽도 다른 쪽을 포함하지 않으면 'conflict' (양쪽에서 따로 고침). 덮어쓰지 않고 둘 다 남긴다.
 * 시각은 쓰지 않는다(폐쇄망 PC 시계가 어긋날 수 있음).
 */
import type { VersionEntry } from './types'

export type VersionOrder = 'same' | 'a-newer' | 'b-newer' | 'conflict'

function asMap(v: readonly VersionEntry[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of v) m.set(e.pcId, (m.get(e.pcId) ?? 0) + e.edits)
  return m
}

/** 두 버전 벡터의 순서 */
export function compareVersions(a: readonly VersionEntry[], b: readonly VersionEntry[]): VersionOrder {
  const ma = asMap(a)
  const mb = asMap(b)
  let aGreater = false
  let bGreater = false
  for (const pc of new Set([...ma.keys(), ...mb.keys()])) {
    const x = ma.get(pc) ?? 0
    const y = mb.get(pc) ?? 0
    if (x > y) aGreater = true
    else if (y > x) bGreater = true
  }
  if (aGreater && bGreater) return 'conflict'
  if (aGreater) return 'a-newer'
  if (bGreater) return 'b-newer'
  return 'same'
}

/** pcId 에서 한 번 고친 뒤의 버전 벡터 (pcId 순서로 정렬, 새 배열) */
export function bumpVersions(v: readonly VersionEntry[], pcId: string): VersionEntry[] {
  const m = asMap(v)
  m.set(pcId, (m.get(pcId) ?? 0) + 1)
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([id, edits]) => ({ pcId: id, edits }))
}

/** 고친 횟수 합 (= revision) */
export function versionTotal(v: readonly VersionEntry[]): number {
  return v.reduce((s, e) => s + e.edits, 0)
}

/** 두 사본을 합친 버전 벡터 (PC 마다 큰 쪽). 충돌을 사람이 풀고 새 사본을 만들 때 그 위에 bumpVersions 한다 */
export function mergeVersions(a: readonly VersionEntry[], b: readonly VersionEntry[]): VersionEntry[] {
  const ma = asMap(a)
  for (const [pc, n] of asMap(b)) ma.set(pc, Math.max(ma.get(pc) ?? 0, n))
  return [...ma.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([id, edits]) => ({ pcId: id, edits }))
}
