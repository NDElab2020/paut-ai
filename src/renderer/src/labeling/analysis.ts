/**
 * 패널이 쓰는 변환 계산 (shared/labels derive, 순수) — 렌더러 볼륨(amplitudeFromVolume, 파일 이득 0 dB)으로:
 *   - 길이 제안 (규격 4절): 초안 기록 하나로 derive 와 같은 규칙(관측 → 상자 범위 안 최대 그룹·레그 → suggestLength). 전문가가 먼저 잰 뒤에만 부른다.
 *   - 관측 표 (규격 1.4): 저장한 기록 × 그룹 × 레그. 전문가가 확인한 행이 있으면 그 상태 (낡은 확인은 계산값 + 재확인 필요).
 *   - 형상 에코 후보 (규격 3.2): 이 세트의 결함 기록 U 범위를 잘라낸 루트·캡 띠 조각.
 *   - 장면 세 상태 미리보기 (규격 3.1): runDerive 전체 (켜야만, 패널이 늦춰 부른다).
 * 막힌 그룹(대조 전·U 오프셋·두께·Ref 모름·형식 이유 blockReason)은 derive 와 같이 계산하지 않고 이유를 돌려준다.
 */
import type { ViewerGroup, ViewerWeld } from '@shared/imaging'
import {
  observeRecordGroup,
  prepareDerive,
  r3,
  r4,
  runDerive,
  suggestGeometricEchoes,
  suggestLength,
  cellsForMm,
  type DeriveFileInput,
  type DerivedFileLabels,
  type EchoCandidate,
  type GroupAmplitude,
  type IndicationRecord,
  type LabelSetKey,
  type LengthMethod,
  type LengthSuggestion,
  type ObservationRow,
  type ObservationSource,
  type ObservationStatus,
  type ReviewInterval
} from '@shared/labels'

/** 계산에 쓰는 파일 (볼륨을 읽은 그룹만 amplitude 가 있다) */
export interface AnalysisFile {
  sha256: string
  thicknessMm: number | null
  weld: ViewerWeld | null
  groups: ReadonlyArray<{ group: ViewerGroup; amplitude: GroupAmplitude | null }>
}

function inputOf(
  file: AnalysisFile,
  set: LabelSetKey,
  records: readonly IndicationRecord[],
  reviews: readonly ReviewInterval[] = [],
  observations: readonly ObservationRow[] = [],
  outerDiameterMm: number | null = null
): DeriveFileInput | null {
  // 형식이 붙인 막는 이유(OPD 대조 전·자체 점검·두께)는 학습 내보내기와 같이 넘긴다 (NDE 는 없음 → 지금과 같음)
  const groups = file.groups
    .filter((g): g is { group: ViewerGroup; amplitude: GroupAmplitude } => g.amplitude !== null)
    .map((g) => ({ group: g.group, amplitude: g.amplitude, ...(g.group.blockReason ? { blockReason: g.group.blockReason } : {}) }))
  if (groups.length === 0) return null
  return {
    sha256: file.sha256,
    thicknessMm: file.thicknessMm,
    outerDiameterMm,
    weld: file.weld,
    groups,
    labelSet: set,
    records: [...records],
    reviewIntervals: [...reviews],
    observations: [...observations]
  }
}

/** 진폭을 아직 읽지 않았을 때 */
export const NO_VOLUME_TEXT = '진폭 데이터를 아직 읽는 중이라 계산하지 않았습니다.'

// ───────────────────────────── 길이 제안 ─────────────────────────────

export interface SuggestionResult {
  suggestion: LengthSuggestion | null
  /** 제안을 낼 수 없는 이유 (그룹 막힘·진폭 없음 등). suggestion.available = false 의 이유는 suggestion.message */
  reason: string | null
}

/** 길이 제안을 기록과 같은 기준으로: 전문가가 고른 측정법('기타'면 두께 기본)·양식의 관 외경 (곡률 보정) */
export interface SuggestionBasis {
  method?: LengthMethod | null
  outerDiameterMm?: number | null
}

/**
 * 초안 기록 하나의 길이 제안 — derive.ts 와 같은 고르기: 기록 그룹들의 관측 레그 가운데 영역(옮겨 찾지 않은) 최대가 가장 센 곳,
 * 그 상자 범위에서 suggestLength (포화·동적 범위 < 6 dB 면 '제안 불가'). 결함 기록만.
 * basis = 기록과 같은 측정법·외경 (t < 8 곡률 보정이 기록 length.valueMm 과 같은 기준이 되게).
 */
export function lengthSuggestionFor(file: AnalysisFile, set: LabelSetKey, record: IndicationRecord, basis: SuggestionBasis = {}): SuggestionResult {
  if (record.kind !== 'defect') return { suggestion: null, reason: '결함 기록만 길이를 제안합니다.' }
  const input = inputOf(file, set, [record], [], [], basis.outerDiameterMm ?? null)
  if (!input) return { suggestion: null, reason: NO_VOLUME_TEXT }
  const ctx = prepareDerive(input)
  const pr = ctx.records[0]
  if (!pr || ctx.thicknessMm === null) return { suggestion: null, reason: '두께를 몰라 제안할 수 없습니다.' }
  const R = ctx.rules
  const blocked: string[] = []
  let best: { pg: (typeof ctx.groups)[number]; obs: NonNullable<ReturnType<typeof observeRecordGroup>>; pct: number } | null = null
  for (const gid of pr.groupIds) {
    const pg = ctx.groups.find((g) => g.id === gid)
    if (!pg) continue
    if (pg.blocked) {
      blocked.push(`${pg.group.name}: ${pg.blocked}`)
      continue
    }
    const obs = observeRecordGroup(ctx, pr, pg)
    if (!obs) continue
    for (const l of obs.legs) {
      const p = l.seed === 'region' || l.seed === null ? (l.peak?.pct ?? -Infinity) : -Infinity
      if (!best || p > best.pct) best = { pg, obs, pct: p }
    }
  }
  if (!best || !best.pg.geom || !best.pg.levels) {
    return { suggestion: null, reason: blocked.length ? `제안하지 않습니다 — ${blocked.join(' · ')}` : '기록 영역이 어느 빔에도 맺히지 않아 제안할 수 없습니다.' }
  }
  const ax = best.pg.group.scan
  const beyond = cellsForMm(ax, R.maxRunBeyondWindowMm)
  const s = suggestLength({
    amp: best.pg.amp,
    group: best.pg.group,
    geom: best.pg.geom,
    windows: best.obs.legs.filter((l) => l.seed !== 'snap').map((l) => ({ leg: l.leg, ranges: l.bound })),
    searchScan: best.obs.searchScan,
    runLimit: [Math.max(0, best.obs.searchScan[0] - beyond), Math.min(best.pg.amp.shape[0] - 1, best.obs.searchScan[1] + beyond)],
    preferScan: best.obs.preferScan,
    levels: best.pg.levels,
    thicknessMm: ctx.thicknessMm,
    outerDiameterMm: ctx.outerDiameterMm,
    ...(basis.method && basis.method !== 'other' ? { method: basis.method } : {}),
    rules: R
  })
  const n = (x: number | null, f: (v: number) => number): number | null => (x === null ? null : f(x))
  return {
    suggestion: {
      ...s,
      ruleDb: r3(s.ruleDb),
      angleDeg: n(s.angleDeg, r4),
      thresholdPct: n(s.thresholdPct, r3),
      peakPct: n(s.peakPct, r3),
      peakScanMm: n(s.peakScanMm, r4),
      peakDepthMm: n(s.peakDepthMm, r4),
      scanStartMm: n(s.scanStartMm, r4),
      scanEndMm: n(s.scanEndMm, r4),
      uncorrectedMm: n(s.uncorrectedMm, r4),
      lengthMm: n(s.lengthMm, r4),
      backgroundPct: n(s.backgroundPct, r3),
      dynamicRangeDb: n(s.dynamicRangeDb, r3)
    },
    reason: null
  }
}

// ───────────────────────────── 관측 표 ─────────────────────────────

export interface ObservationLegView {
  leg: number
  computedStatus: ObservationStatus
  /** 쓰는 상태 (전문가 확인이 있으면 그것) */
  status: ObservationStatus
  expertConfirmed: boolean
  observation: ObservationSource
  /** 전문가 확인이 있었지만 기록이 바뀌어 쓰지 않음 (재확인 필요) */
  stale: boolean
  peakPct: number | null
  saturated: boolean | null
  /** 저장할 행의 바탕 (계산값). 확인할 때 상태·확인·버전만 바꾼다 */
  row: ObservationRow
}

export interface ObservationGroupView {
  groupId: number
  name: string
  /** 막은 이유 (대조 전 등). 그때 legs 는 빈 목록 */
  blocked: string | null
  legs: ObservationLegView[]
}

/** 저장한 기록 하나의 관측 표 (그룹 × 레그). 진폭이 없으면 null */
export function observationsFor(file: AnalysisFile, set: LabelSetKey, record: IndicationRecord, stored: readonly ObservationRow[]): ObservationGroupView[] | null {
  const input = inputOf(file, set, [record], [], stored.filter((o) => o.recordUuid === record.uuid))
  if (!input) return null
  const ctx = prepareDerive(input)
  const pr = ctx.records[0]
  if (!pr) return []
  const out: ObservationGroupView[] = []
  for (const gid of pr.groupIds) {
    const pg = ctx.groups.find((g) => g.id === gid)
    if (!pg) continue
    if (pg.blocked) {
      out.push({ groupId: gid, name: pg.group.name, blocked: pg.blocked, legs: [] })
      continue
    }
    const obs = observeRecordGroup(ctx, pr, pg)
    if (!obs) {
      out.push({ groupId: gid, name: pg.group.name, blocked: '기록 스캔 범위가 이 그룹 스캔 축 밖입니다.', legs: [] })
      continue
    }
    out.push({
      groupId: gid,
      name: pg.group.name,
      blocked: null,
      legs: obs.legs.map((l) => ({
        leg: l.leg,
        computedStatus: l.computedStatus,
        status: l.status,
        expertConfirmed: l.expertConfirmed,
        observation: l.observation,
        stale: l.stale,
        peakPct: l.peak ? r3(l.peak.pct) : null,
        saturated: l.saturated,
        row: l.row
      }))
    })
  }
  return out
}

/**
 * 전문가가 확인한 관측 행: 계산 행에 고른 상태·확인 표시를 붙이고, 저장된 같은 키 행의 버전을 이어 받는다
 * (버전이 다르면 저장이 CONFLICT — 그사이 다른 곳에서 고친 것).
 */
export function confirmedRow(computed: ObservationRow, status: ObservationStatus, stored: readonly ObservationRow[]): ObservationRow {
  const old = stored.find((o) => o.recordUuid === computed.recordUuid && o.groupId === computed.groupId && o.leg === computed.leg)
  return {
    ...computed,
    status,
    expertConfirmed: true,
    deleted: false,
    revision: old?.revision ?? 1,
    versions: old ? old.versions.map((v) => ({ ...v })) : [],
    pcId: old?.pcId ?? null
  }
}

// ───────────────────────────── 형상 에코 후보 ─────────────────────────────

export interface EchoResult {
  candidates: EchoCandidate[]
  /** 안내 (개선 형상 없음·막힌 그룹 등) */
  notes: string[]
}

/** 이 세트의 형상 에코 후보 (결함 기록 U 범위는 잘라냄). 진폭이 없으면 null */
export function echoCandidatesFor(file: AnalysisFile, set: LabelSetKey, records: readonly IndicationRecord[]): EchoResult | null {
  const input = inputOf(file, set, records)
  if (!input) return null
  const ctx = prepareDerive(input)
  const s = suggestGeometricEchoes(ctx)
  const notes = [...ctx.groups.filter((g) => g.blocked).map((g) => `${g.group.name}: ${g.blocked}`), ...s.issues.map((i) => i.message)]
  return { candidates: s.candidates, notes }
}

/**
 * 보여 줄 후보: 거절한 것, 같은 그룹의 저장된 형상 에코 기록과 U 가 겹치는 것(이미 승인·고침)은 뺀다.
 */
export function openEchoCandidates(candidates: readonly EchoCandidate[], records: readonly IndicationRecord[], rejected: readonly string[]): EchoCandidate[] {
  const echoes = records.filter((r) => !r.deleted && r.kind === 'geometric-echo')
  return candidates.filter((c) => {
    if (rejected.includes(c.id)) return false
    return !echoes.some((r) => {
      const g = r.signal.peak?.groupId ?? r.anchors[0]?.anchor.groupId ?? null
      return (g === null || g === c.groupId) && r.derived.scanStartMm <= c.scanEndMm && r.derived.scanEndMm >= c.scanStartMm
    })
  })
}

// ───────────────────────────── 장면 미리보기 ─────────────────────────────

/** 세트 전체의 세 상태 장면 (runDerive). 진폭이 없으면 null */
export function scenePreviewFor(
  file: AnalysisFile,
  set: LabelSetKey,
  records: readonly IndicationRecord[],
  reviews: readonly ReviewInterval[],
  observations: readonly ObservationRow[]
): DerivedFileLabels | null {
  const input = inputOf(file, set, records, reviews, observations)
  if (!input) return null
  return runDerive(input).result
}
