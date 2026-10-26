/**
 * 그룹 짓기와 누적 길이 — 시방서 16.2 그림 5, 16.3 그림 6 (순수 함수, 런타임 의존성 없음).
 * 근거: 04_조사·보고/한난_PAUT시방서_핵심정리.md 16절, 계획_라벨링/평가_정의_v1.md 3절, 지침서_v1.md(판독자는 낱개로 적고 앱이 묶음).
 *
 * 같은 파일·같은 라벨 세트의 결함 기록끼리만 묶는다. 결과는 기록마다 groupingId 다.
 *
 * 그림 5 (진폭 평가: t < 8, 또는 t ≥ 8 인데 높이를 재지 못한 지시) — 셋 모두 만족하면 한 지시로 본다
 *   - 길이 방향(x, 스캔) 간격 < 긴 지시 길이 × 2
 *   - 가로 방향(y, V) 간격 < t/2
 *   - 두께 방향(z, 깊이) 간격 < t/2
 * 그림 6 (높이 평가: t ≥ 8, 두 지시 모두 시방서 15절 방법으로 높이를 잼) — 둘 다 만족하면 한 지시로 본다
 *   - 길이 방향 거리 < 긴 지시 길이
 *   - 두께 방향 거리 < 높은 지시 높이
 *   - 점 같은 지시(pointLike = true)는 묶지 않는다(누적 길이에서 빼고 150 mm 당 개수로 따로 셈).
 * 그룹 길이 l12 = l1 + l2 + dx (groupLengthMm). 경계값(같음)은 '미만'이 아니라 묶지 않는다(1e-9 mm 여유).
 *
 * 한 번 쓴 지시 재사용 금지: 지시 하나는 그룹 하나에만 들어간다. 묶은 뒤에는 그 묶음을 한 지시(길이 l12,
 * 범위 합집합)로 보고 다음 지시와 견준다('chain', 기본). 'pair' 는 둘씩만 묶고 이미 묶인 지시는 다시 쓰지 않는다.
 * 어느 해석이 시방서 뜻인지는 전문가 확인 전이라 인자로 둔다.
 *
 * 묶는 순서(같은 입력 → 같은 결과): 조건을 만족하는 모든 쌍 가운데 x 간격이 가장 작은 쌍부터 합친다
 * (같으면 스캔 순서). 합친 뒤 다시 모든 쌍을 본다. 더 합칠 쌍이 없으면 끝.
 *
 * 'auto' 규칙: t < 8 → 그림 5. t ≥ 8 → 두 지시 모두 높이(시방서 방법)가 있으면 그림 6, 하나라도 없으면 그림 5
 *   (시방서 15절: 높이 측정 곤란 시 길이 + 진폭). 두께를 모르면 'auto'·그림 5 는 묶지 않는다.
 *   점 같은 지시를 묶지 않는 것은 그림 6(16.3, 누적 길이에서 빼고 개수로 셈)뿐이다. 그림 5(16.2)에는 그런 조항이 없어 묶는다.
 * 대상: 결함 기록. 평가 기준을 못 넘은 기록(excludeBelowEvaluation)과 기록 기준을 못 넘은 기록(excludeBelowRecording, 시방서 17절
 *   기록 대상 아님 · 새 기본값 '약한 양성'과 같은 취급)은 기본으로 뺀다. 모름(null)은 넣는다.
 * 값을 모를 때(V·깊이 없음)는 unknownDistance 규칙('pass' = 조건 통과, 기본). 엑셀(OmniPC) 기록은 V 가 비는 일이 많다.
 */
import { HEIGHT_METHOD_IN_SPEC } from './codes'
import { labelSetId } from './factory'
import { intervalGap } from './spans'
import type { IndicationRecord } from './types'

/** 그룹 짓기 규칙 버전. 조건·순서가 바뀌면 올린다 */
export const GROUPING_RULES_VERSION = 2

/** 경계값 비교 여유 (mm) */
export const GROUPING_EPS_MM = 1e-9

/** 그림 5 = 진폭 평가, 그림 6 = 높이 평가 */
export type GroupingFigure = 'fig5' | 'fig6'
export type GroupingRule = 'auto' | 'amplitude' | 'height'
export type GroupingCombine = 'chain' | 'pair'
export type GroupingExcludeReason = 'deleted' | 'kind' | 'below-evaluation' | 'below-recording'

export interface GroupingParams {
  /** 판 두께 t (mm). 파일마다 다르면 computeGrouping 의 thicknessFor 로 준다 */
  thicknessMm: number | null
  rule: GroupingRule
  combine: GroupingCombine
  /** V·깊이를 모를 때: 'pass' = 그 조건을 통과로 봄 (기본), 'fail' = 묶지 않음 */
  unknownDistance: 'pass' | 'fail'
  /** 평가 기준을 못 넘은 기록(signal.exceedsEvaluationLevel = false)은 빼기 (기본 true). 모름(null)은 넣는다 */
  excludeBelowEvaluation: boolean
  /** 기록 기준을 못 넘은 기록(signal.exceedsRecordingLevel = false)은 빼기 (기본 true, 시방서 17절 기록 대상 아님). 모름(null)은 넣는다 */
  excludeBelowRecording: boolean
}

export function groupingParams(over: Partial<GroupingParams> = {}): GroupingParams {
  return { thicknessMm: null, rule: 'auto', combine: 'chain', unknownDistance: 'pass', excludeBelowEvaluation: true, excludeBelowRecording: true, ...over }
}

/** 묶음 하나 (낱개도 묶음 하나로 낸다) */
export interface GroupingGroup {
  groupingId: string
  sha256: string
  /** labelSetId 형식 ('sha256|라벨러|지침서|단계') */
  setId: string
  /** 스캔 순서 */
  recordUuids: string[]
  /** 묶을 때 쓴 그림 (낱개는 빈 목록) */
  figures: GroupingFigure[]
  scanStartMm: number
  scanEndMm: number
  /** 그룹 길이 (낱개는 잰 길이, 없으면 스캔 범위) */
  lengthMm: number
  /** 그룹 높이 hg. 구성원 모두 높이가 있을 때만 (깊이가 떨어져 있으면 h1 + h2 + dz, 겹치면 큰 값) */
  heightMm: number | null
  depthTopMm: number | null
  depthBottomMm: number | null
  /** 낱개이고 점 같은 지시 */
  pointLike: boolean
}

export interface GroupingResult {
  rulesVersion: number
  params: GroupingParams
  /** 기록 UUID → groupingId. 대상 밖(삭제·형상 에코·평가 기준 미만)은 null */
  assignments: Record<string, string | null>
  groups: GroupingGroup[]
  excluded: { uuid: string; reason: GroupingExcludeReason }[]
  /** 확인 사항 (두께 모름, 값 모름을 통과로 본 수 등) */
  notes: string[]
}

// ───────────────────────────── 그룹 길이 ─────────────────────────────

export interface LengthSpan {
  scanStartMm: number
  scanEndMm: number
  /** 잰 길이. null 이면 스캔 범위 길이 */
  lengthMm: number | null
}

/**
 * 그룹 길이 = Σ 길이 + Σ 간격 (l12 = l1 + l2 + dx 를 여럿으로 늘린 것).
 * 스캔 범위가 서로 겹치면 간격을 정할 수 없어 합집합 범위 길이를 쓴다(평가_정의_v1.md 3절).
 */
export function groupLengthMm(members: readonly LengthSpan[]): number {
  if (members.length === 0) return 0
  const sorted = [...members]
    .map((m) => ({ s: Math.min(m.scanStartMm, m.scanEndMm), e: Math.max(m.scanStartMm, m.scanEndMm), l: m.lengthMm }))
    .sort((x, y) => x.s - y.s || x.e - y.e)
  let total = 0
  let maxEnd: number | null = null
  for (const m of sorted) {
    if (maxEnd !== null && m.s < maxEnd - GROUPING_EPS_MM) {
      const start = sorted[0]!.s
      const end = Math.max(...sorted.map((x) => x.e))
      return end - start
    }
    if (maxEnd !== null) total += m.s - maxEnd
    total += m.l ?? m.e - m.s
    maxEnd = maxEnd === null ? m.e : Math.max(maxEnd, m.e)
  }
  return total
}

// ───────────────────────────── 묶기 ─────────────────────────────

interface Range {
  lo: number
  hi: number
}

interface Unit {
  members: Member[]
  xs: number
  xe: number
  lengthMm: number
  v: Range | null
  z: Range | null
  heightMm: number | null
  figures: Set<GroupingFigure>
}

interface Member {
  uuid: string
  xs: number
  xe: number
  measuredLengthMm: number | null
  v: Range | null
  z: Range | null
  heightMm: number | null
  pointLike: boolean
}

function rangeOf(a: number | null, b: number | null): Range | null {
  if (a === null && b === null) return null
  const x = a ?? (b as number)
  const y = b ?? (a as number)
  return { lo: Math.min(x, y), hi: Math.max(x, y) }
}

function unionRange(a: Range | null, b: Range | null): Range | null {
  if (a === null) return b
  if (b === null) return a
  return { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) }
}

function gapOf(a: Range, b: Range): number {
  return intervalGap(a.lo, a.hi, b.lo, b.hi).gapMm
}

function memberOf(r: IndicationRecord): Member {
  const d = r.derived
  const xs = Math.min(d.scanStartMm, d.scanEndMm)
  const xe = Math.max(d.scanStartMm, d.scanEndMm)
  let z = rangeOf(d.depthTopMm, d.depthBottomMm)
  const peak = r.signal.peak?.depthMm ?? null
  if (z === null && peak !== null) z = { lo: peak, hi: peak }
  const h = r.height
  const heightMm = h.valueMm !== null && h.method !== null && HEIGHT_METHOD_IN_SPEC[h.method] ? h.valueMm : null
  return {
    uuid: r.uuid,
    xs,
    xe,
    measuredLengthMm: r.length.valueMm,
    v: rangeOf(d.vMinMm, d.vMaxMm),
    z,
    heightMm,
    pointLike: r.pointLike === true
  }
}

function singleUnit(m: Member): Unit {
  return {
    members: [m],
    xs: m.xs,
    xe: m.xe,
    lengthMm: m.measuredLengthMm ?? m.xe - m.xs,
    v: m.v,
    z: m.z,
    heightMm: m.heightMm,
    figures: new Set()
  }
}

/** 두 묶음의 높이 hg: 둘 다 있을 때만. 깊이가 떨어져 있으면 h1 + h2 + dz, 겹치거나 모르면 큰 값 */
function combinedHeight(a: Unit, b: Unit): number | null {
  if (a.heightMm === null || b.heightMm === null) return null
  if (a.z !== null && b.z !== null) {
    const dz = gapOf(a.z, b.z)
    if (dz > GROUPING_EPS_MM) return a.heightMm + b.heightMm + dz
  }
  return Math.max(a.heightMm, b.heightMm)
}

function mergeUnits(a: Unit, b: Unit, figure: GroupingFigure): Unit {
  const members = [...a.members, ...b.members].sort((x, y) => x.xs - y.xs || x.xe - y.xe || (x.uuid < y.uuid ? -1 : 1))
  return {
    members,
    xs: Math.min(a.xs, b.xs),
    xe: Math.max(a.xe, b.xe),
    lengthMm: groupLengthMm(members.map((m) => ({ scanStartMm: m.xs, scanEndMm: m.xe, lengthMm: m.measuredLengthMm }))),
    v: unionRange(a.v, b.v),
    z: unionRange(a.z, b.z),
    heightMm: combinedHeight(a, b),
    figures: new Set([...a.figures, ...b.figures, figure])
  }
}

interface Tally {
  unknownV: number
  unknownZ: number
}

/** 미만 비교 (같으면 거짓) */
function less(value: number, limit: number): boolean {
  return value < limit - GROUPING_EPS_MM
}

/** 거리 조건: 값을 모르면 unknownDistance 규칙 */
function distanceOk(a: Range | null, b: Range | null, limit: number, params: GroupingParams, onUnknown: () => void): boolean {
  if (a === null || b === null) {
    onUnknown()
    return params.unknownDistance === 'pass'
  }
  return less(gapOf(a, b), limit)
}

/** 두 묶음을 묶을 수 있으면 쓴 그림, 아니면 null */
function joinFigure(a: Unit, b: Unit, t: number | null, params: GroupingParams, tally: Tally): GroupingFigure | null {
  if (params.combine === 'pair' && (a.members.length > 1 || b.members.length > 1)) return null
  const pointLike = (a.members.length === 1 && a.members[0]!.pointLike) || (b.members.length === 1 && b.members[0]!.pointLike)
  let figure: GroupingFigure
  if (params.rule === 'amplitude') figure = 'fig5'
  else if (params.rule === 'height') figure = 'fig6'
  else {
    if (t === null) return null
    if (t < 8) figure = 'fig5'
    else figure = a.heightMm !== null && b.heightMm !== null ? 'fig6' : 'fig5'
  }
  const dx = intervalGap(a.xs, a.xe, b.xs, b.xe).gapMm
  const longer = Math.max(a.lengthMm, b.lengthMm)
  if (figure === 'fig5') {
    if (t === null) return null
    if (!less(dx, 2 * longer)) return null
    const half = t / 2
    const seen: Tally = { unknownV: 0, unknownZ: 0 }
    if (!distanceOk(a.v, b.v, half, params, () => seen.unknownV++)) return null
    if (!distanceOk(a.z, b.z, half, params, () => seen.unknownZ++)) return null
    tally.unknownV += seen.unknownV
    tally.unknownZ += seen.unknownZ
    return 'fig5'
  }
  if (pointLike) return null
  if (a.heightMm === null || b.heightMm === null) return null
  if (!less(dx, longer)) return null
  const seen: Tally = { unknownV: 0, unknownZ: 0 }
  if (!distanceOk(a.z, b.z, Math.max(a.heightMm, b.heightMm), params, () => seen.unknownZ++)) return null
  tally.unknownZ += seen.unknownZ
  return 'fig6'
}

/** 한 (파일, 라벨 세트) 안의 묶음 */
function groupOne(members: Member[], t: number | null, params: GroupingParams, tally: Tally): Unit[] {
  const units = members
    .sort((x, y) => x.xs - y.xs || x.xe - y.xe || (x.uuid < y.uuid ? -1 : 1))
    .map(singleUnit)
  for (;;) {
    let best: { i: number; j: number; dx: number; figure: GroupingFigure } | null = null
    let bestTally: Tally = { unknownV: 0, unknownZ: 0 }
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i]!
        const b = units[j]!
        const local: Tally = { unknownV: 0, unknownZ: 0 }
        const figure = joinFigure(a, b, t, params, local)
        if (figure === null) continue
        const dx = intervalGap(a.xs, a.xe, b.xs, b.xe).gapMm
        if (best === null || dx < best.dx - GROUPING_EPS_MM) {
          best = { i, j, dx, figure }
          bestTally = local
        }
      }
    }
    if (best === null) break
    tally.unknownV += bestTally.unknownV
    tally.unknownZ += bestTally.unknownZ
    units[best.i] = mergeUnits(units[best.i]!, units[best.j]!, best.figure)
    units.splice(best.j, 1)
  }
  return units
}

/**
 * 결함 기록에 그룹 짓기 ID 를 매긴다. 기록은 여러 파일·여러 라벨 세트가 섞여 있어도 된다
 * (같은 sha256 · 같은 라벨 세트끼리만 묶는다). 삭제 표시·형상 에코·형상 불완전 기록은 대상 밖(null).
 * groupingId = 'g-' + 구성원 UUID 가운데 가장 작은 것 (같은 묶음이면 늘 같은 값, 파일이 달라도 겹치지 않음).
 */
export function computeGrouping(
  records: readonly IndicationRecord[],
  params: GroupingParams = groupingParams(),
  thicknessFor?: (sha256: string) => number | null
): GroupingResult {
  const assignments: Record<string, string | null> = {}
  const excluded: GroupingResult['excluded'] = []
  const parts = new Map<string, { sha256: string; setId: string; members: Member[] }>()
  for (const r of records) {
    let reason: GroupingExcludeReason | null = null
    if (r.deleted) reason = 'deleted'
    else if (r.kind !== 'defect') reason = 'kind'
    else if (params.excludeBelowEvaluation && r.signal.exceedsEvaluationLevel === false) reason = 'below-evaluation'
    else if (params.excludeBelowRecording && r.signal.exceedsRecordingLevel === false) reason = 'below-recording'
    if (reason !== null) {
      assignments[r.uuid] = null
      excluded.push({ uuid: r.uuid, reason })
      continue
    }
    const setId = labelSetId(r)
    let part = parts.get(setId)
    if (!part) {
      part = { sha256: r.sha256, setId, members: [] }
      parts.set(setId, part)
    }
    part.members.push(memberOf(r))
  }

  const notes: string[] = []
  const tally: Tally = { unknownV: 0, unknownZ: 0 }
  const groups: GroupingGroup[] = []
  const noThickness = new Set<string>()
  const outOfRange = new Set<string>()
  for (const part of [...parts.values()].sort((a, b) => (a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : 0))) {
    const t = thicknessFor ? thicknessFor(part.sha256) ?? params.thicknessMm : params.thicknessMm
    const tValid = t !== null && Number.isFinite(t) && t > 0 ? t : null
    if (tValid === null && params.rule !== 'height' && part.members.length > 1) noThickness.add(part.sha256)
    if (tValid !== null && (tValid < 3.2 || tValid > 15)) outOfRange.add(part.sha256)
    for (const u of groupOne(part.members, tValid, params, tally)) {
      const ids = u.members.map((m) => m.uuid)
      const groupingId = `g-${[...ids].sort()[0]!}`
      for (const id of ids) assignments[id] = groupingId
      const single = u.members.length === 1
      groups.push({
        groupingId,
        sha256: part.sha256,
        setId: part.setId,
        recordUuids: ids,
        figures: [...u.figures].sort(),
        scanStartMm: u.xs,
        scanEndMm: u.xe,
        lengthMm: u.lengthMm,
        heightMm: u.heightMm,
        depthTopMm: u.z?.lo ?? null,
        depthBottomMm: u.z?.hi ?? null,
        pointLike: single && u.members[0]!.pointLike
      })
    }
  }
  if (noThickness.size > 0) notes.push(`두께를 몰라 묶지 않은 파일 ${noThickness.size}개 (파일 정렬이나 스캔플랜에 두께를 넣으세요)`)
  if (outOfRange.size > 0) notes.push(`두께가 시방서 범위(3.2~15 mm) 밖인 파일 ${outOfRange.size}개 — 그룹 짓기는 참고값입니다`)
  if (tally.unknownV > 0) notes.push(`V(가로) 위치를 몰라 조건을 ${params.unknownDistance === 'pass' ? '통과로' : '실패로'} 본 묶음 ${tally.unknownV}건`)
  if (tally.unknownZ > 0) notes.push(`깊이를 몰라 조건을 ${params.unknownDistance === 'pass' ? '통과로' : '실패로'} 본 묶음 ${tally.unknownZ}건`)
  return { rulesVersion: GROUPING_RULES_VERSION, params, assignments, groups, excluded, notes }
}

/** 결과의 groupingId 를 기록에 넣은 사본 (결과에 없는 기록은 그대로) */
export function applyGrouping(records: readonly IndicationRecord[], result: GroupingResult): IndicationRecord[] {
  return records.map((r) => {
    if (!Object.hasOwn(result.assignments, r.uuid)) return r
    const id = result.assignments[r.uuid] ?? null
    return r.groupingId === id ? r : { ...r, groupingId: id }
  })
}

// ───────────────────────────── 누적 길이 ─────────────────────────────

/** 누적 길이 허용 (시방서 16.2·16.3) */
export interface CumulativeLimit {
  table: '4761-L2' | '19285-L2-amplitude' | '19285-L2-height'
  /** 살펴볼 용접부 구간 길이 (mm) */
  windowMm: number
  /** 허용 합 (mm) */
  maxSumMm: number
  /** true = 합 ≤ 허용이면 합격, false = 합 < 허용이어야 합격 */
  inclusive: boolean
  /** 점 같은 지시를 빼고 더하는지 (표 14) */
  excludesPointLike: boolean
}

/**
 * 두께·평가 방법에 맞는 누적 길이 허용. 시방서 범위(3.2~15 mm) 밖이거나 두께를 모르면 null.
 *   3.2 ≤ t < 8 (4761 L2): 12t 구간에서 합 ≤ 4t
 *   8 ≤ t ≤ 15 진폭 평가(그림 5): 단일 설정(S 또는 E) 6t 구간에서 합 < 30 %, S+E 조합은 < 45 %
 *   8 ≤ t ≤ 15 높이 평가(그림 6): 점 같은 지시 빼고 단일 설정 12t 구간에서 합 ≤ 4t, S+E 조합은 1.5배
 */
export function cumulativeLimit(
  thicknessMm: number | null,
  figure: GroupingFigure,
  opts: { combinedSE?: boolean } = {}
): CumulativeLimit | null {
  const t = thicknessMm
  if (t === null || !Number.isFinite(t) || t < 3.2 || t > 15) return null
  if (t < 8) return { table: '4761-L2', windowMm: 12 * t, maxSumMm: 4 * t, inclusive: true, excludesPointLike: false }
  if (figure === 'fig5') {
    const ratio = opts.combinedSE ? 0.45 : 0.3
    return { table: '19285-L2-amplitude', windowMm: 6 * t, maxSumMm: ratio * 6 * t, inclusive: false, excludesPointLike: false }
  }
  return {
    table: '19285-L2-height',
    windowMm: 12 * t,
    maxSumMm: (opts.combinedSE ? 1.5 : 1) * 4 * t,
    inclusive: true,
    excludesPointLike: true
  }
}

/** 누적 길이를 셀 단위 (그룹 짓기 결과 GroupingGroup 을 그대로 넘겨도 된다) */
export interface CumulativeUnit {
  scanStartMm: number
  scanEndMm: number
  lengthMm: number
  pointLike?: boolean
  /** 결과에 돌려줄 이름 (없으면 순서 번호) */
  groupingId?: string
}

export interface CumulativeResult {
  /** 가장 큰 구간 합 (mm) */
  maxSumMm: number
  /** 그 구간 [시작, 시작 + 구간 길이]. 단위가 없으면 null */
  windowStartMm: number | null
  windowEndMm: number | null
  /** 그 구간에 든 단위 */
  unitIds: string[]
}

/**
 * 용접부 어느 구간(길이 windowMm)에서든 지시 길이 합의 최댓값.
 * partial = 'whole'(기본): 구간에 조금이라도 걸치면 길이 전부를 더한다(보수적).
 * partial = 'clip': 걸친 비율(스캔 범위 기준)만큼만 더한다.
 * excludePointLike = true 면 점 같은 지시를 뺀다(표 14).
 */
export function maxCumulativeLength(
  units: readonly CumulativeUnit[],
  windowMm: number,
  opts: { partial?: 'whole' | 'clip'; excludePointLike?: boolean } = {}
): CumulativeResult {
  const partial = opts.partial ?? 'whole'
  const list = units
    .map((u, i) => ({
      id: u.groupingId ?? String(i),
      s: Math.min(u.scanStartMm, u.scanEndMm),
      e: Math.max(u.scanStartMm, u.scanEndMm),
      l: u.lengthMm,
      p: u.pointLike === true
    }))
    .filter((u) => !(opts.excludePointLike && u.p))
  if (list.length === 0 || !(windowMm > 0)) return { maxSumMm: 0, windowStartMm: null, windowEndMm: null, unitIds: [] }
  const starts = [...new Set(list.flatMap((u) => [u.s, u.e, u.s - windowMm, u.e - windowMm]))].sort((a, b) => a - b)
  let best: CumulativeResult = { maxSumMm: -1, windowStartMm: null, windowEndMm: null, unitIds: [] }
  for (const ws of starts) {
    const we = ws + windowMm
    let sum = 0
    const ids: string[] = []
    for (const u of list) {
      if (u.s > we + GROUPING_EPS_MM || u.e < ws - GROUPING_EPS_MM) continue
      if (partial === 'whole' || u.e - u.s <= GROUPING_EPS_MM) sum += u.l
      else sum += (u.l * Math.max(0, Math.min(u.e, we) - Math.max(u.s, ws))) / (u.e - u.s)
      ids.push(u.id)
    }
    if (sum > best.maxSumMm + GROUPING_EPS_MM) best = { maxSumMm: sum, windowStartMm: ws, windowEndMm: we, unitIds: ids }
  }
  return best
}

/** 누적 길이 판정. 허용을 정할 수 없으면 exceeds = null */
export function cumulativeVerdict(
  units: readonly CumulativeUnit[],
  thicknessMm: number | null,
  figure: GroupingFigure,
  opts: { combinedSE?: boolean; partial?: 'whole' | 'clip' } = {}
): { limit: CumulativeLimit | null; result: CumulativeResult | null; exceeds: boolean | null } {
  const limit = cumulativeLimit(thicknessMm, figure, opts)
  if (limit === null) return { limit, result: null, exceeds: null }
  const result = maxCumulativeLength(units, limit.windowMm, { partial: opts.partial, excludePointLike: limit.excludesPointLike })
  const exceeds = limit.inclusive
    ? result.maxSumMm > limit.maxSumMm + GROUPING_EPS_MM
    : result.maxSumMm >= limit.maxSumMm - GROUPING_EPS_MM
  return { limit, result, exceeds }
}

/** 점 같은 지시 허용 개수: 용접부 150 mm 당 N = 1.2t (올림, 예 t = 16 → 19.2 → 20) */
export function pointLikeLimit(thicknessMm: number): number {
  return Math.ceil(1.2 * thicknessMm - GROUPING_EPS_MM)
}

/** 용접부 어느 150 mm(windowMm) 구간에서든 점 같은 지시 개수의 최댓값 */
export function maxPointLikeCount(units: readonly CumulativeUnit[], windowMm = 150): { count: number; windowStartMm: number | null } {
  const points = units.filter((u) => u.pointLike === true).map((u) => ({ s: Math.min(u.scanStartMm, u.scanEndMm), e: Math.max(u.scanStartMm, u.scanEndMm) }))
  let best = { count: 0, windowStartMm: null as number | null }
  const starts = [...new Set(points.flatMap((u) => [u.s, u.e, u.s - windowMm, u.e - windowMm]))].sort((a, b) => a - b)
  for (const ws of starts) {
    const we = ws + windowMm
    const n = points.filter((u) => !(u.s > we + GROUPING_EPS_MM || u.e < ws - GROUPING_EPS_MM)).length
    if (n > best.count) best = { count: n, windowStartMm: ws }
  }
  return best
}
