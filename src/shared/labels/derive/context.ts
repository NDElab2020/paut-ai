/**
 * 변환 입력과 준비 (런타임 의존성 없음).
 *
 * 입력 = 파일 하나: 그룹(ViewerGroup + 진폭 읽기), 두께·외경·개선 형상, 라벨 세트 하나의 기록·검토 구간,
 * 전문가가 확인한 관측 행(있으면 그 상태를 쓴다), 규칙 매개변수.
 * 막는 그룹(규격 2절): 대조 전(verified = false), U 격자 오프셋 ≠ 0, 부르는 쪽이 준 이유(AnalysisScan/IndexOffset 등),
 *   두께를 모름, Ref 를 추정할 수 없음(표 13 범위 밖 포함), 진폭 모양이 다름, 그릴 수 없는 그룹.
 * 앵커 기록의 좌표 규칙 버전이 지금과 다르면 앵커에서 다시 계산하고 '재확인 필요'를 붙인다(anchors.ts).
 * 기록마다 '전문가가 그린 그룹·레그'(drawn)를 둔다: 엑셀 기록 = 최대 진폭·길이 잰 그룹(모든 레그), 앱 기록 = 앵커의 그룹·레그.
 *   그린 곳은 영역 그대로 보고(옮겨 찾지 않음), 관측 출처가 'record' 다.
 * 길이를 모르는 기록은 기록 기준 고르기에서 ℓ ≤ t (높은 문턱)로 본다(rules.ts recordingPctFor).
 * 전문가 확인 관측 행이 같은 키로 여럿이면 revision 이 큰 것(같으면 versions 글자 순서가 뒤인 것)을 쓴다.
 */
import { findGate } from '../../imaging/gates'
import type { ViewerGate, ViewerGroup, ViewerWeld } from '../../imaging/types'
import { sameLabelSet } from '../factory'
import type { IndicationRecord, LabelSetKey, ObservationRow, ReviewInterval, Sha256Hex } from '../types'
import type { GroupAmplitude } from './amplitude'
import { recomputeFromAnchors } from './anchors'
import { buildCellGeometry, echoZoneSection, regionOf, type CrossSection, type GroupCellGeometry, type PhysicalRegion } from './geometry'
import {
  groupLevelsOf,
  recordCapOf,
  resolveDeriveRules,
  type DeriveRules,
  type DeriveRulesInput,
  type GroupLevels,
  type KindPolicy,
  type RecordCap
} from './rules'

export interface DeriveGroupInput {
  group: ViewerGroup
  amplitude: GroupAmplitude
  /** 대조 전으로 막을 추가 이유 (예: 'AnalysisScan/IndexOffset 이 있는 파일'). 없으면 null */
  blockReason?: string | null
  /** Ref(%FSH)를 파일 셋업 추정 대신 이 값으로 (전문가 확인 값 등) */
  refPctOverride?: number | null
}

export interface DeriveFileInput {
  sha256: Sha256Hex
  /** 두께 (파일 정렬 값 → 없으면 셋업 시편 두께) */
  thicknessMm: number | null
  /** 관 외경 (판은 null) */
  outerDiameterMm?: number | null
  /** 개선 형상 (ViewerFileInfo.specimen.weld) */
  weld?: ViewerWeld | null
  groups: readonly DeriveGroupInput[]
  /** 라벨 세트. 주면 그 세트의 기록·검토 구간만 쓴다. 없으면 sha256 이 같은 것 모두 (세트가 섞이면 경고) */
  labelSet?: LabelSetKey | null
  records?: readonly IndicationRecord[]
  reviewIntervals?: readonly ReviewInterval[]
  /** 전문가가 확인한 관측 행 (expertConfirmed = true 인 행의 상태를 쓴다) */
  observations?: readonly ObservationRow[]
  rules?: DeriveRulesInput | null
}

export type DeriveIssueLevel = 'error' | 'warning' | 'info'

export interface DeriveIssue {
  level: DeriveIssueLevel
  code: string
  message: string
  groupId: number | null
  recordUuid: string | null
}

export interface PreparedGroup {
  id: number
  group: ViewerGroup
  amp: GroupAmplitude
  geom: GroupCellGeometry | null
  levels: GroupLevels | null
  /** 막은 이유 (한국어). null = 변환함 */
  blocked: string | null
  /** C-scan 게이트 (보통 A) */
  cscanGate: ViewerGate | null
}

export interface PreparedRecord {
  /** 앵커에서 다시 계산했으면 그 결과 */
  record: IndicationRecord
  policy: KindPolicy
  /** 존재 확신도 '불확실' → 모든 장면 무시 */
  uncertain: boolean
  region: PhysicalRegion
  /** 기록 기준 고르기에 쓰는 길이 (기록 길이). 모르면 null → ℓ ≤ t (높은 문턱) */
  lengthMm: number | null
  /** 전문가가 적은 신호 등급의 상한 (평가 기준 미만 → 무시, 기록 기준 미만 → 약한 양성) */
  cap: RecordCap
  /** 전문가가 그린 (그룹, 레그). leg = null 이면 그 그룹 모든 레그 */
  drawn: Array<{ groupId: number; leg: number | null }>
  /** 볼 그룹 번호 (형상 에코는 기록 그룹 하나, 결함은 모든 그룹) */
  groupIds: number[]
  /** 이번 계산에서 앵커로 다시 계산했는지 · 재확인 필요 */
  recomputed: boolean
  recheckNeeded: boolean
  /** 다시 계산으로 옮겨진 거리 최대 (mm) */
  maxShiftMm: number | null
}

export interface DeriveContext {
  sha256: Sha256Hex
  rules: DeriveRules
  thicknessMm: number | null
  outerDiameterMm: number | null
  weld: ViewerWeld | null
  labelSet: LabelSetKey | null
  groups: PreparedGroup[]
  records: PreparedRecord[]
  /** 쓰는 검토 구간 (지우지 않음·풀리지 않음) */
  intervals: ReviewInterval[]
  /** 키 `${recordUuid}|${groupId}|${leg}` → 전문가 확인 행 */
  expertRows: Map<string, ObservationRow>
  /** 형상 에코 자리 (루트·캡 단면). 옮겨 찾기(snap)에서 기록 영역 밖의 이 자리 칸은 뺀다 */
  echoZones: CrossSection[]
  issues: DeriveIssue[]
}

/** 이 (그룹, 레그)를 전문가가 그렸는지 */
export function isDrawn(pr: Pick<PreparedRecord, 'drawn'>, groupId: number, leg: number): boolean {
  return pr.drawn.some((d) => d.groupId === groupId && (d.leg === null || d.leg === leg))
}

function drawnOf(r: IndicationRecord): Array<{ groupId: number; leg: number | null }> {
  const out: Array<{ groupId: number; leg: number | null }> = []
  const add = (groupId: number | null | undefined, leg: number | null): void => {
    if (groupId === null || groupId === undefined) return
    if (out.some((d) => d.groupId === groupId && d.leg === leg)) return
    out.push({ groupId, leg })
  }
  if (r.coordSource === 'app-anchor') {
    for (const p of r.anchors) add(p.anchor.groupId, p.leg)
  } else {
    add(r.signal.peak?.groupId, null)
    add(r.length.groupId, null)
  }
  return out.sort((a, b) => a.groupId - b.groupId || (a.leg ?? 0) - (b.leg ?? 0))
}

export function issue(level: DeriveIssueLevel, code: string, message: string, groupId: number | null = null, recordUuid: string | null = null): DeriveIssue {
  return { level, code, message, groupId, recordUuid }
}

export function obsKey(recordUuid: string, groupId: number, leg: number): string {
  return `${recordUuid}|${groupId}|${leg}`
}

/** 문자열 사전순 비교 (localeCompare 는 환경마다 다를 수 있어 쓰지 않는다) */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function versionsKey(r: { versions: ReadonlyArray<{ pcId: string; edits: number }> }): string {
  return r.versions.map((v) => `${v.pcId}:${v.edits}`).join(',')
}

function blockReasonOf(g: DeriveGroupInput, thicknessMm: number | null, rules: DeriveRules, levels: GroupLevels | null): string | null {
  const grp = g.group
  if (!grp.supported) return grp.reason ?? '이 그룹은 아직 그리지 않습니다.'
  const [ns, nb, nt] = g.amplitude.shape
  if (ns !== grp.shape[0] || nb !== grp.shape[1] || nt !== grp.shape[2] || nb !== grp.beams.length || nt !== grp.ultrasound.count) {
    return '진폭 모양이 그룹 정보와 달라 변환하지 않습니다.'
  }
  if (!rules.allowUnverified) {
    if (!grp.verified) return 'OmniPC 와 대조 전인 그룹이라 자동 변환을 막습니다.'
    if (grp.scan.offsetMm !== 0) return 'U 격자 오프셋이 0 이 아닌 파일은 대조 전이라 자동 변환을 막습니다.'
    if (g.blockReason) return g.blockReason
  }
  if (thicknessMm === null || !(thicknessMm > 0)) return '두께를 몰라 레그를 접을 수 없습니다.'
  if (!levels) return '기준 감도(Ref)를 추정할 수 없거나 두께가 시방서 표 13 범위 밖이라 진폭 기준을 정할 수 없습니다.'
  return null
}

/** 입력 → 준비 (그룹 칸 기하·진폭 기준·막는 이유, 기록 영역·처리, 검토 구간) */
export function prepareDerive(input: DeriveFileInput): DeriveContext {
  const rules = resolveDeriveRules(input.rules)
  const issues: DeriveIssue[] = []
  const t = input.thicknessMm !== null && input.thicknessMm > 0 ? input.thicknessMm : null
  const weld = input.weld ?? null

  const groups: PreparedGroup[] = [...input.groups]
    .sort((a, b) => a.group.id - b.group.id)
    .map((g) => {
      const levels = groupLevelsOf(g.group, t, g.refPctOverride)
      const blocked = blockReasonOf(g, t, rules, levels)
      if (blocked) issues.push(issue('warning', 'group-blocked', blocked, g.group.id))
      const geom = !blocked && t !== null ? buildCellGeometry(g.group, t, rules.maxLeg) : null
      const gate = findGate(g.group, g.group.cscanGateId)
      return { id: g.group.id, group: g.group, amp: g.amplitude, geom, levels, blocked, cscanGate: gate && gate.supported ? gate : null }
    })
  const groupGeoms = new Map(groups.map((g) => [g.id, g.group] as const))

  // 라벨 세트 거르기
  const inSet = (x: { sha256: string; labelerId: string; guidelineVersion: string; readingStage: LabelSetKey['readingStage'] }): boolean =>
    input.labelSet ? sameLabelSet(x, input.labelSet) : x.sha256 === input.sha256
  const recs = (input.records ?? []).filter((r) => !r.deleted && inSet(r))
  const skipped = (input.records ?? []).filter((r) => !r.deleted && !inSet(r)).length
  if (skipped > 0) issues.push(issue('info', 'records-other-set', `다른 파일·라벨 세트의 기록 ${skipped}건은 쓰지 않았습니다.`))
  if (!input.labelSet) {
    const sets = new Set(
      [...recs, ...(input.reviewIntervals ?? []).filter((v) => !v.deleted && v.sha256 === input.sha256)].map(
        (r) => `${r.labelerId}|${r.guidelineVersion}|${r.readingStage}`
      )
    )
    if (sets.size > 1) {
      issues.push(
        issue('warning', 'mixed-label-sets', `라벨 세트 ${sets.size}개의 기록·검토 구간이 섞여 있습니다(다른 라벨러의 검토 완료 구간이 음성이 될 수 있음). 세트 하나씩 변환하세요.`)
      )
    }
  }
  recs.sort((a, b) => cmpStr(a.uuid, b.uuid) || a.revision - b.revision || cmpStr(versionsKey(a), versionsKey(b)))
  for (let i = 1; i < recs.length; i++) {
    if (recs[i]!.uuid === recs[i - 1]!.uuid) {
      issues.push(issue('warning', 'conflict-copies', '같은 기록의 충돌 사본이 둘 이상 있습니다. 둘 다 반영했습니다(무시 구역이 넓어짐).', null, recs[i]!.uuid))
    }
  }

  const records: PreparedRecord[] = []
  for (const r0 of recs) {
    const rc = recomputeFromAnchors(r0, groupGeoms, t)
    if (rc.missingGroups.length > 0) {
      issues.push(issue('warning', 'anchor-group-missing', `앵커 그룹 ${rc.missingGroups.join(', ')} 을 파일에서 찾지 못해 그 점은 옛 mm 를 썼습니다.`, null, r0.uuid))
    }
    const r = rc.record
    if (t === null) continue
    const policy = rules.kindPolicy[r.kind]
    let fill: CrossSection | null = null
    if (r.kind === 'geometric-echo') {
      const k = r.geometricEcho?.kind
      if (k === 'root' || k === 'cap') fill = echoZoneSection(k, weld, t, rules.echo)
    }
    const region = regionOf(r.derived, t, fill)
    const pg = r.signal.peak?.groupId ?? null
    let groupIds = groups.map((g) => g.id)
    if (policy === 'non-defect' && pg !== null) {
      if (groupIds.includes(pg)) groupIds = [pg]
      else issues.push(issue('warning', 'record-group-missing', `기록의 그룹 ${pg} 이 파일에 없어 모든 그룹에서 봅니다.`, null, r.uuid))
    }
    const len = r.length.valueMm !== null && Number.isFinite(r.length.valueMm) ? r.length.valueMm : null
    records.push({
      record: r,
      policy,
      uncertain: r.existenceConfidence === 'uncertain',
      region,
      lengthMm: len,
      cap: policy === 'non-defect' ? 'none' : recordCapOf(r.signal),
      drawn: drawnOf(r),
      groupIds,
      recomputed: rc.recomputed,
      recheckNeeded: rc.recheckNeeded,
      maxShiftMm: rc.maxShiftMm
    })
    if (rc.recomputed) {
      issues.push(issue('warning', 'recheck-needed', '좌표 규칙이 바뀌어 앵커에서 mm 를 다시 계산했습니다. 재확인이 필요합니다.', null, r.uuid))
    }
    if (policy === 'defect' && region.vMinMm === null && region.vMaxMm === null) {
      issues.push(
        issue(
          'info',
          'region-unbounded',
          'V 범위가 비어 단면 전체 폭에서 신호를 찾습니다. 형상 띠가 섞일 수 있으니 엑셀·화면에서 V 를 적으세요.',
          null,
          r.uuid
        )
      )
    }
  }

  const intervals = (input.reviewIntervals ?? [])
    .filter((v) => !v.deleted && !v.released && inSet(v))
    .sort((a, b) => cmpStr(a.uuid, b.uuid) || a.revision - b.revision)

  // 전문가 확인 행: 같은 키가 여럿이면 revision 이 큰 것, 같으면 versions 글자 순서가 뒤인 것 (입력 순서와 무관)
  const expertRows = new Map<string, ObservationRow>()
  const recordUuids = new Set(records.map((p) => p.record.uuid))
  let foreignRows = 0
  const rows = [...(input.observations ?? [])]
    .filter((o) => !o.deleted && o.expertConfirmed)
    .sort((a, b) => cmpStr(a.recordUuid, b.recordUuid) || a.groupId - b.groupId || a.leg - b.leg || a.revision - b.revision || cmpStr(versionsKey(a), versionsKey(b)))
  for (const o of rows) {
    if (!recordUuids.has(o.recordUuid)) {
      foreignRows++
      continue
    }
    expertRows.set(obsKey(o.recordUuid, o.groupId, o.leg), o)
  }
  if (foreignRows > 0) issues.push(issue('info', 'observations-other-set', `이 파일·라벨 세트의 기록이 아닌 관측 행 ${foreignRows}개는 쓰지 않았습니다.`))
  const echoZones = t === null ? [] : (['root', 'cap'] as const).map((z) => echoZoneSection(z, weld, t, rules.echo)).filter((z): z is CrossSection => z !== null)

  return {
    sha256: input.sha256,
    rules,
    thicknessMm: t,
    outerDiameterMm: input.outerDiameterMm ?? null,
    weld,
    labelSet: input.labelSet ?? null,
    groups,
    records,
    intervals,
    expertRows,
    echoZones,
    issues
  }
}
