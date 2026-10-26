/**
 * 기록 → 학습 라벨 계산 (파일 하나 · 라벨 세트 하나). 순수 함수, 런타임 의존성 없음.
 * 규칙서: 규격_초안.md 3·4절, 매개변수: rules.ts, 규칙 버전: LABEL_DERIVE_RULES_VERSION.
 *
 * 흐름: prepareDerive(막는 그룹·영역·앵커 재계산) → 기록 × 그룹: 관측 표(observation.ts) → 장면 판정 트랙(scenes.ts)
 *   → 그룹마다 장면 라벨(상자·A-scan 구간) → C-scan 상자 → 길이 제안(envelope.ts).
 * 결정성: 그룹은 번호, 기록·검토 구간은 UUID 순서로 돌고, 같은 값이면 정해진 순서(앞 빔·앞 샘플·가까운 칸)로 고른다.
 *   mm 는 0.0001 mm, %FSH·dB 는 0.001 로 반올림해 낸다. 같은 입력·같은 규칙 → JSON.stringify 결과가 같다.
 * 막힌 그룹(대조 전 등)은 장면·관측을 만들지 않고 groups[].blocked 에 이유를 적는다.
 * 장면 상자·A-scan 구간·C-scan 상자·B-scan 상자는 같은 칸 덩어리(SceneComponent)에서 만든다(scenes.ts).
 * issue: 계산만 한 관측에서 나온 양성(observation-unconfirmed), 끝 여유 밖까지 이어지는 신호(margin-signal-continues),
 *   엑셀 최대 진폭과 상자 범위 최대가 6 dB 넘게 다름(amplitude-mismatch), 낡은 전문가 확인 관측(observation-stale).
 */
import { scanPositionMm } from '../../imaging/coords'
import { LABEL_COORD_RULES_VERSION } from '../types'
import type { LabelSetKey, ObservationRow, ObservationStatus, RecordKind } from '../types'
import { estimateAnchors, type AnchorEstimate } from './anchors'
import { cmpStr, issue, prepareDerive, type DeriveContext, type DeriveFileInput, type DeriveIssue, type PreparedGroup } from './context'
import { suggestLength, type LengthSuggestion } from './envelope'
import { cellsForMm, rangesToArrays, type BeamRanges, type PhysicalRegion, type RangesBox } from './geometry'
import { observeRecordGroup, r3, r4, type LegObservation, type ObservationSource, type RecordGroupObservation } from './observation'
import { DERIVED_LABELS_FORMAT, LABEL_DERIVE_RULES_VERSION, type DeriveRules, type GroupLevels, type KindPolicy, type RecordCap } from './rules'
import {
  CscanAccumulator,
  ascanSpansFromCells,
  buildTrack,
  componentKey,
  gateRegionOf,
  groupIntervals,
  objectTrainStatus,
  sceneStateOf,
  thresholdComponentBox,
  windowIdOf,
  type AscanSpan,
  type CscanBox,
  type NegativeRegion,
  type SceneComponent,
  type SceneLabel,
  type SceneObject,
  type SceneReason,
  type SceneState,
  type Track,
  type TrackCell
} from './scenes'

// ───────────────────────────── 출력 ─────────────────────────────

export interface DerivedGroupInfo {
  groupId: number
  name: string
  verified: boolean
  /** 막은 이유 (null = 변환함) */
  blocked: string | null
  levels: GroupLevels | null
  cscanGateId: number | null
  scanCount: number
  /** 검토 구간에 게이트를 적지 않았을 때 쓰는 음성 범위 (파일 C-scan 게이트) */
  fileGateRegion: NegativeRegion | null
}

export interface DerivedRecordLeg {
  leg: number
  computedStatus: ObservationStatus
  status: ObservationStatus
  expertConfirmed: boolean
  /** 관측 출처 (전문가 확인 / 전문가가 그린 그룹·레그 / 계산만) */
  observation: ObservationSource
  /** 보임을 어디서 찾았나 (영역 / 탐색 창으로 옮겨 찾음) */
  seed: 'region' | 'snap' | null
  /** 띠 위라 올린 문턱의 바닥 (%FSH, 0 = 띠 아님) */
  bandFloorPct: number
}

export interface DerivedRecordGroup {
  groupId: number
  /** 양성 문턱 (결함 = 기록 기준, 형상 에코 = 평가 기준, 기록 기준 미만 기록 = null) · 약한 양성 문턱 (%FSH). 띠 반영 전 */
  positivePct: number | null
  weakPct: number | null
  /** 핵심 구간 · 끝 여유까지 (mm, 스캔 칸 중심). 장면을 만들지 않았으면 null */
  coreStartMm: number | null
  coreEndMm: number | null
  /** 학습용 에코 범위 (보임 레그 포락선이 양성 문턱 이상으로 이어지는 구간, 길이 제안과 같은 포락선 함수) */
  echoRunStartMm: number | null
  echoRunEndMm: number | null
  extentStartMm: number | null
  extentEndMm: number | null
  /** 잡음(바탕값) %FSH */
  noisePct: number | null
  legs: DerivedRecordLeg[]
}

export interface DerivedRecord {
  uuid: string
  kind: RecordKind
  policy: KindPolicy
  uncertain: boolean
  /** 쓴 영역 (실제 깊이) */
  region: PhysicalRegion
  /** 기록 기준 고르기에 쓴 길이 (모르면 null → ℓ ≤ t) */
  lengthMm: number | null
  /** 전문가가 적은 신호 등급의 상한 (none / weak = 기록 기준 미만 / ignore = 평가 기준 미만) */
  cap: RecordCap
  recomputed: boolean
  recheckNeeded: boolean
  maxShiftMm: number | null
  /** 엑셀 기록(imported-mm)의 그룹·레그별 앵커 추정 */
  anchorEstimates: AnchorEstimate[]
  groups: DerivedRecordGroup[]
  /** 결함 기록만: 최대 진폭 그룹의 길이 제안 */
  lengthSuggestion: LengthSuggestion | null
  cscanBoxes: CscanBox[]
}

/** 탐색 창 (A-scan 가림 구역·B-scan 계산에 씀) */
export interface WindowEntry {
  id: string
  recordUuid: string
  groupId: number
  leg: number
  box: RangesBox
  lo: number[]
  hi: number[]
}

export interface DerivedFileLabels {
  format: typeof DERIVED_LABELS_FORMAT
  rulesVersion: number
  coordRulesVersion: number
  sha256: string
  labelSet: LabelSetKey | null
  thicknessMm: number | null
  rules: DeriveRules
  groups: DerivedGroupInfo[]
  records: DerivedRecord[]
  observations: ObservationRow[]
  windows: WindowEntry[]
  scenes: SceneLabel[]
  ascanSpans: AscanSpan[]
  stats: {
    scenes: Record<SceneState, number>
    trainScenes: Record<SceneState, number>
    objects: number
    boxes: number
    ascanSpans: number
  }
  issues: DeriveIssue[]
}

/** 계산 결과 + B-scan·A-scan 질의에 쓰는 내부 값 */
export interface DeriveRun {
  ctx: DeriveContext
  result: DerivedFileLabels
  /** 키 `${recordUuid}|${groupId}` */
  observations: Map<string, RecordGroupObservation>
  tracks: Track[]
  windows: Map<string, BeamRanges>
  /** 장면 상자의 칸 덩어리. 키 componentKey(스캔, 기록, 그룹, 레그) */
  components: Map<string, SceneComponent>
}

function roundRegion(r: PhysicalRegion): PhysicalRegion {
  return {
    scanStartMm: r4(r.scanStartMm),
    scanEndMm: r4(r.scanEndMm),
    vMinMm: r.vMinMm === null ? null : r4(r.vMinMm),
    vMaxMm: r.vMaxMm === null ? null : r4(r.vMaxMm),
    depthTopMm: r4(r.depthTopMm),
    depthBottomMm: r4(r.depthBottomMm)
  }
}

function roundBox(b: RangesBox): RangesBox {
  return { ...b, vMinMm: r4(b.vMinMm), vMaxMm: r4(b.vMaxMm), depthMinMm: r4(b.depthMinMm), depthMaxMm: r4(b.depthMaxMm) }
}

function roundLevels(l: GroupLevels | null): GroupLevels | null {
  if (!l) return null
  return { ...l, refPct: r3(l.refPct), evaluationPct: r3(l.evaluationPct), recordingShortPct: r3(l.recordingShortPct), recordingLongPct: r3(l.recordingLongPct) }
}

function roundSuggestion(s: LengthSuggestion): LengthSuggestion {
  const n = (x: number | null, f: (v: number) => number): number | null => (x === null ? null : f(x))
  return {
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
  }
}

function emptyCounts(): Record<SceneState, number> {
  return { positive: 0, weak: 0, ignore: 0, negative: 0, unknown: 0 }
}

// ───────────────────────────── 계산 ─────────────────────────────

/** 파일 하나의 학습 라벨 (출력만) */
export function deriveFileLabels(input: DeriveFileInput): DerivedFileLabels {
  return runDerive(input).result
}

/** 게이트 범위들 가운데 서로 떨어진 짝이 있나 (깊이가 겹치지 않거나 레그가 이어지지 않음 — 맞닿으면 이어진 것) */
function reviewedGatesDisjoint(rs: readonly NegativeRegion[]): boolean {
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]!
      const b = rs[j]!
      if (a.depthBottomMm < b.depthTopMm || b.depthBottomMm < a.depthTopMm || a.legMax + 1 < b.legMin || b.legMax + 1 < a.legMin) return true
    }
  }
  return false
}

/** 파일 하나의 학습 라벨 + 내부 값 (B-scan 상자·A-scan 라벨 질의용) */
export function runDerive(input: DeriveFileInput): DeriveRun {
  const ctx = prepareDerive(input)
  const R = ctx.rules
  const issues: DeriveIssue[] = [...ctx.issues]
  const groupsById = new Map(ctx.groups.map((g) => [g.id, g] as const))
  const observations = new Map<string, RecordGroupObservation>()
  const windows = new Map<string, BeamRanges>()
  const windowEntries: WindowEntry[] = []
  const tracks: Track[] = []

  // 1) 기록 × 그룹: 관측 · 트랙
  for (const pr of ctx.records) {
    let anyObs = false
    for (const gid of pr.groupIds) {
      const pg = groupsById.get(gid)
      if (!pg || pg.blocked) continue
      const obs = observeRecordGroup(ctx, pr, pg)
      if (!obs) {
        issues.push(issue('warning', 'record-outside-scan', '기록 스캔 범위가 이 그룹 스캔 축 밖입니다.', gid, pr.record.uuid))
        continue
      }
      issues.push(...obs.issues)
      anyObs = anyObs || obs.legs.length > 0
      observations.set(`${pr.record.uuid}|${gid}`, obs)
      for (const l of obs.legs) {
        const id = windowIdOf(pr.record.uuid, gid, l.leg)
        windows.set(id, l.window)
        windowEntries.push({ id, recordUuid: pr.record.uuid, groupId: gid, leg: l.leg, box: roundBox(l.windowBox), ...rangesToArrays(l.window) })
      }
      const tr = buildTrack(ctx, pr, pg, obs)
      tracks.push(tr)
      if (tr.marginContinues[0] || tr.marginContinues[1]) {
        issues.push(
          issue(
            'warning',
            'margin-signal-continues',
            '끝 여유 밖까지 결함 신호(평가 기준 이상)가 이어집니다. 기록 스캔 범위가 짧거나 다른 지시가 붙어 있을 수 있어 확인이 필요합니다.',
            gid,
            pr.record.uuid
          )
        )
      }
    }
    if (!anyObs && pr.groupIds.some((g) => !groupsById.get(g)?.blocked)) {
      issues.push(issue('warning', 'record-no-cells', '기록 영역이 어느 그룹·레그의 빔에도 맺히지 않습니다.', null, pr.record.uuid))
    }
  }

  // 결함 우선: 결함 기록의 익스텐트(핵심 구간 + 끝 여유) (mm, 그룹 축 칸 중심)
  const defectExtents: Array<[number, number]> = []
  for (const tr of tracks) {
    if (tr.record.record.kind !== 'defect' || !tr.extent) continue
    const ax = groupsById.get(tr.groupId)!.group.scan
    const a = scanPositionMm(tr.extent[0], ax)
    const b = scanPositionMm(tr.extent[1], ax)
    defectExtents.push([Math.min(a, b), Math.max(a, b)])
  }
  const inDefectExtent = (u: number): boolean => defectExtents.some(([a, b]) => u >= a - 1e-9 && u <= b + 1e-9)

  // 2) 그룹마다 장면
  const scenes: SceneLabel[] = []
  const spans: AscanSpan[] = []
  const components = new Map<string, SceneComponent>()
  /** 키 `${recordUuid}|${groupId}` → C-scan 상자 그릇 */
  const cscans = new Map<string, CscanAccumulator>()
  /** 계산만 한 관측에서 양성·약한 양성이 나온 기록 */
  const unconfirmed = new Map<string, Set<string>>()
  let objectCount = 0
  let boxCount = 0
  const groupInfos: DerivedGroupInfo[] = []
  for (const pg of ctx.groups) {
    const geom = pg.geom
    groupInfos.push({
      groupId: pg.id,
      name: pg.group.name,
      verified: pg.group.verified,
      blocked: pg.blocked,
      levels: roundLevels(pg.levels),
      cscanGateId: pg.cscanGate?.id ?? null,
      scanCount: pg.amp.shape[0],
      fileGateRegion: geom ? gateRegionOf(pg, geom) : null
    })
    if (pg.blocked || !geom) continue
    const ns = pg.amp.shape[0]
    const axis = pg.group.scan
    const iv = groupIntervals(ctx, pg, geom)
    const bucket: Array<Array<{ tr: Track; cell: TrackCell }>> = Array.from({ length: ns }, () => [])
    for (const tr of tracks) {
      if (tr.groupId !== pg.id) continue
      for (const cell of tr.cells) if (cell.scan >= 0 && cell.scan < ns) bucket[cell.scan]!.push({ tr, cell })
    }
    const visited = new Uint8Array(geom.nb * geom.nt)
    let gatesDisjoint = false
    for (let k = 0; k < ns; k++) {
      const u = scanPositionMm(k, axis)
      const rv = iv.reviewed.filter((q) => k >= q.lo && k <= q.hi)
      // 같은 스캔에 검토 완료 구간이 둘 이상이고 게이트가 서로 떨어져 있으면 아래 상자 하나로 합칠 때 그 사이(검토하지 않은 깊이·레그)도
      // 음성이 된다. 규칙(상자 하나)은 규칙 버전을 올릴 때 바꾸고, 지금은 그룹마다 한 번 경고만 낸다(바이트는 이 경우에만 이 경고 한 줄이 더해짐)
      if (!gatesDisjoint && rv.length > 1 && reviewedGatesDisjoint(rv.map((q) => q.region))) {
        gatesDisjoint = true
        issues.push(
          issue(
            'warning',
            'reviewed-gates-disjoint',
            `스캔 ${r4(u)} mm 부근에 검토 완료 구간이 둘 이상 겹치는데 게이트(깊이·레그)가 서로 떨어져 있습니다. 음성 범위를 두 게이트를 감싸는 상자 하나로 합쳐 그 사이(검토하지 않은 깊이)도 음성이 됩니다 — 게이트를 이어서 다시 검토하거나 구간을 나누세요.`,
            pg.id
          )
        )
      }
      const negativeRegion: NegativeRegion | null =
        rv.length === 0
          ? null
          : {
              legMin: Math.min(...rv.map((q) => q.region.legMin)),
              legMax: Math.max(...rv.map((q) => q.region.legMax)),
              depthTopMm: Math.min(...rv.map((q) => q.region.depthTopMm)),
              depthBottomMm: Math.max(...rv.map((q) => q.region.depthBottomMm))
            }
      const objects: SceneObject[] = []
      for (const { tr, cell } of bucket[k]!) {
        const pr = tr.record
        if (pr.policy === 'non-defect' && inDefectExtent(u)) continue
        const leg = tr.obs.legs.find((l) => l.leg === cell.leg)!
        let status = cell.status
        let reason = cell.reason
        let box = null
        let comp: SceneComponent | null = null
        if ((status === 'positive' || status === 'weak') && cell.thresholdPct !== null) {
          const j = k - leg.env.scanFrom
          const sb = leg.env.beam[j] ?? -1
          const ss = leg.env.sample[j] ?? -1
          const hit = sb >= 0 ? thresholdComponentBox(pg, geom, leg.bound, leg.exclude, k, sb, ss, cell.thresholdPct, cell.leg, visited) : null
          if (hit) {
            box = hit.box
            comp = { status, thresholdPct: cell.thresholdPct, cells: hit.cells }
          } else {
            status = 'ignore'
            reason = 'below-level'
          }
        }
        const trainStatus = objectTrainStatus(status, leg.observation, R)
        const obj: SceneObject = {
          recordUuid: pr.record.uuid,
          kind: pr.record.kind,
          defectType: pr.record.defectType,
          typeConfidence: pr.record.typeConfidence,
          policy: pr.policy,
          leg: cell.leg,
          status,
          trainStatus,
          reason,
          observation: leg.observation,
          signalPct: cell.signalPct === null ? null : r3(cell.signalPct),
          box,
          inReviewedGate: negativeRegion ? cell.leg >= negativeRegion.legMin && cell.leg <= negativeRegion.legMax : null,
          windowId: windowIdOf(pr.record.uuid, pg.id, cell.leg)
        }
        objects.push(obj)
        if (box && comp) {
          boxCount++
          const st = status as 'positive' | 'weak'
          components.set(componentKey(k, pr.record.uuid, pg.id, cell.leg), comp)
          spans.push(...ascanSpansFromCells(ctx, pg, geom, k, comp.cells, { ...obj, status: st }, cell.thresholdPct!))
          const ck = `${pr.record.uuid}|${pg.id}`
          let acc = cscans.get(ck)
          if (!acc) {
            acc = new CscanAccumulator(pg, geom, pr.record.uuid, R.gateCoverFraction)
            cscans.set(ck, acc)
          }
          acc.add(k, leg, comp)
          if (pr.policy === 'defect' && leg.observation === 'computed') {
            const set = unconfirmed.get(pr.record.uuid) ?? new Set<string>()
            set.add(`그룹 ${pg.id} 레그 ${cell.leg}`)
            unconfirmed.set(pr.record.uuid, set)
          }
        }
      }
      objects.sort((a, b) => cmpStr(a.recordUuid, b.recordUuid) || a.leg - b.leg)
      objectCount += objects.length
      const reasons: SceneReason[] = []
      if (iv.qualityBad.some((q) => k >= q.lo && k <= q.hi)) reasons.push('quality-bad')
      if (iv.belowThreshold.some((q) => k >= q.lo && k <= q.hi)) reasons.push('below-threshold-interval')
      let any = false
      for (let b = 0; b < geom.nb && !any; b++) any = pg.amp.hasData(k, b)
      if (!any) reasons.push('no-data')
      const state = sceneStateOf(objects, rv.length > 0, reasons)
      scenes.push({
        groupId: pg.id,
        scanIndex: k,
        scanMm: r4(u),
        state,
        trainState: sceneStateOf(objects, rv.length > 0, reasons, 'trainStatus'),
        reasons,
        reviewed: rv.length > 0,
        negativeRegion,
        objects
      })
    }
  }
  for (const [uuid, where] of [...unconfirmed.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    issues.push(
      issue(
        'warning',
        'observation-unconfirmed',
        `${[...where].sort().join(', ')} 의 양성은 계산만 한 관측에서 나왔습니다(전문가가 그리거나 확인하지 않음). 관측 표 확인 전에는 학습에서 거를 수 있습니다(observation = 'computed').`,
        null,
        uuid
      )
    )
  }

  // 3) 기록 요약 · C-scan 상자 · 길이 제안 · 관측 행
  const records: DerivedRecord[] = []
  const obsRows: ObservationRow[] = []
  for (const pr of ctx.records) {
    const uuid = pr.record.uuid
    const groups: DerivedRecordGroup[] = []
    const cscanBoxes: CscanBox[] = []
    let best: { pg: PreparedGroup; obs: RecordGroupObservation; pct: number } | null = null
    for (const gid of pr.groupIds) {
      const pg = groupsById.get(gid)
      const obs = observations.get(`${uuid}|${gid}`)
      if (!pg || !obs) continue
      const tr = tracks.find((t) => t.record === pr && t.groupId === gid)
      const ax = pg.group.scan
      const mm = (k: number | undefined): number | null => (k === undefined ? null : r4(scanPositionMm(k, ax)))
      const finite = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : r3(x))
      groups.push({
        groupId: gid,
        positivePct: finite(obs.thresholds.positivePct),
        weakPct: finite(obs.thresholds.weakPct),
        coreStartMm: mm(tr?.core?.[0]),
        coreEndMm: mm(tr?.core?.[1]),
        echoRunStartMm: mm(tr?.echoRun?.[0]),
        echoRunEndMm: mm(tr?.echoRun?.[1]),
        extentStartMm: mm(tr?.extent?.[0]),
        extentEndMm: mm(tr?.extent?.[1]),
        noisePct: tr?.noisePct === null || tr?.noisePct === undefined ? null : r3(tr.noisePct),
        legs: obs.legs.map((l) => ({
          leg: l.leg,
          computedStatus: l.computedStatus,
          status: l.status,
          expertConfirmed: l.expertConfirmed,
          observation: l.observation,
          seed: l.seed,
          bandFloorPct: r3(l.bandFloorPct)
        }))
      })
      const box = cscans.get(`${uuid}|${gid}`)?.box() ?? null
      if (box) cscanBoxes.push(box)
      for (const l of obs.legs) {
        obsRows.push(l.row)
        const p = l.seed === 'region' || l.seed === null ? (l.peak?.pct ?? -Infinity) : -Infinity
        if (!best || p > best.pct) best = { pg, obs, pct: p }
      }
    }
    // 엑셀 최대 진폭과 그 그룹의 상자 범위 최대가 6 dB 넘게 다르면 확인 (기록 위치·그룹이 틀렸을 수 있음)
    const recAmp = pr.record.signal.maxAmplitudePct
    const recGroup = pr.record.signal.peak?.groupId ?? null
    if (recAmp !== null && recAmp > 0 && recGroup !== null) {
      const o = observations.get(`${uuid}|${recGroup}`)
      const seen = o ? Math.max(...o.legs.map((l) => (l.seed === 'region' || l.seed === null ? (l.peak?.pct ?? 0) : 0)), 0) : 0
      if (o && seen > 0 && Math.abs(20 * Math.log10(seen / recAmp)) > 6) {
        issues.push(
          issue(
            'warning',
            'amplitude-mismatch',
            `기록의 최대 진폭(${r3(recAmp)} %)과 그 그룹 영역 안 최대(${r3(seen)} %)가 6 dB 넘게 다릅니다. 기록 위치나 그룹을 확인하세요.`,
            recGroup,
            uuid
          )
        )
      }
    }
    let lengthSuggestion: LengthSuggestion | null = null
    if (pr.record.kind === 'defect' && best && best.pg.geom && best.pg.levels && ctx.thicknessMm !== null) {
      const ax = best.pg.group.scan
      const beyond = cellsForMm(ax, R.maxRunBeyondWindowMm)
      // 제안 빔은 상자 범위(영역 ± boxMarginMm) 안 최대에서 고른다 — 탐색 창의 형상 띠에서 재지 않게
      lengthSuggestion = roundSuggestion(
        suggestLength({
          amp: best.pg.amp,
          group: best.pg.group,
          geom: best.pg.geom,
          windows: best.obs.legs.filter((l: LegObservation) => l.seed !== 'snap').map((l: LegObservation) => ({ leg: l.leg, ranges: l.bound })),
          searchScan: best.obs.searchScan,
          runLimit: [Math.max(0, best.obs.searchScan[0] - beyond), Math.min(best.pg.amp.shape[0] - 1, best.obs.searchScan[1] + beyond)],
          preferScan: best.obs.preferScan,
          levels: best.pg.levels,
          thicknessMm: ctx.thicknessMm,
          outerDiameterMm: ctx.outerDiameterMm,
          rules: R
        })
      )
    }
    const anchorEstimates: AnchorEstimate[] = []
    if (pr.record.coordSource === 'imported-mm') {
      for (const gid of pr.groupIds) {
        const pg = groupsById.get(gid)
        if (!pg || pg.blocked || !pg.geom) continue
        for (const e of estimateAnchors(pg.group, pg.geom, pr.region, R.regionPadMm)) {
          anchorEstimates.push({
            ...e,
            scanIndexStart: r4(e.scanIndexStart),
            scanIndexEnd: r4(e.scanIndexEnd),
            center: { ...e.center, scanIndex: r4(e.center.scanIndex), beam: r4(e.center.beam), sample: r4(e.center.sample) },
            centerMm: e.centerMm
              ? {
                  scanMm: r4(e.centerMm.scanMm),
                  vMm: r4(e.centerMm.vMm),
                  depthMm: r4(e.centerMm.depthMm),
                  unfoldedDepthMm: r4(e.centerMm.unfoldedDepthMm),
                  leg: e.centerMm.leg
                }
              : null
          })
        }
      }
    }
    records.push({
      uuid,
      kind: pr.record.kind,
      policy: pr.policy,
      uncertain: pr.uncertain,
      region: roundRegion(pr.region),
      lengthMm: pr.lengthMm === null ? null : r4(pr.lengthMm),
      cap: pr.cap,
      recomputed: pr.recomputed,
      recheckNeeded: pr.recheckNeeded,
      maxShiftMm: pr.maxShiftMm === null ? null : r4(pr.maxShiftMm),
      anchorEstimates,
      groups,
      lengthSuggestion,
      cscanBoxes
    })
  }
  obsRows.sort((a, b) => cmpStr(a.recordUuid, b.recordUuid) || a.groupId - b.groupId || a.leg - b.leg)
  windowEntries.sort((a, b) => cmpStr(a.recordUuid, b.recordUuid) || a.groupId - b.groupId || a.leg - b.leg)
  spans.sort(
    (a, b) =>
      a.groupId - b.groupId ||
      a.scanIndex - b.scanIndex ||
      a.beam - b.beam ||
      a.sampleStart - b.sampleStart ||
      cmpStr(a.recordUuid, b.recordUuid) ||
      a.leg - b.leg
  )

  const counts = emptyCounts()
  const trainCounts = emptyCounts()
  for (const s of scenes) {
    counts[s.state]++
    trainCounts[s.trainState]++
  }
  const result: DerivedFileLabels = {
    format: DERIVED_LABELS_FORMAT,
    rulesVersion: LABEL_DERIVE_RULES_VERSION,
    coordRulesVersion: LABEL_COORD_RULES_VERSION,
    sha256: ctx.sha256,
    labelSet: ctx.labelSet,
    thicknessMm: ctx.thicknessMm,
    rules: R,
    groups: groupInfos,
    records,
    observations: obsRows,
    windows: windowEntries,
    scenes,
    ascanSpans: spans,
    stats: { scenes: counts, trainScenes: trainCounts, objects: objectCount, boxes: boxCount, ascanSpans: spans.length },
    issues
  }
  return { ctx, result, observations, tracks, windows, components }
}

// ───────────────────────────── B-scan 상자 · A-scan 라벨 ─────────────────────────────

/** B-scan 상자 (가로 = 스캔, 세로 = 그 빔의 샘플·펼친 깊이). B-scan 화면은 OmniPC 대조 전이다 */
export interface BscanBox {
  recordUuid: string
  groupId: number
  leg: number
  beam: number
  status: 'positive' | 'weak'
  scanStartMm: number
  scanEndMm: number
  sampleStart: number
  sampleEnd: number
  /** 펼친 깊이 */
  depthMinMm: number
  depthMaxMm: number
  thresholdPct: number
  peakPct: number
  /** B-scan 은 OmniPC 화면 대조 전 (규격 2절) */
  viewVerified: false
}

/**
 * 지금 빔 b 기준 B-scan 상자: 그 기록·그룹의 양성(또는 약한 양성) 장면 상자 덩어리 칸 가운데 빔 b 의 칸 범위.
 * 레그·상태마다 하나. 빔 b 에 칸이 없으면 빈 목록.
 */
export function bscanBoxesForBeam(run: DeriveRun, recordUuid: string, groupId: number, beam: number): BscanBox[] {
  const pg = run.ctx.groups.find((g) => g.id === groupId)
  if (!pg || !pg.geom) return []
  const geom = pg.geom
  const nt = geom.nt
  const parts = new Map<string, { leg: number; st: 'positive' | 'weak'; k0: number; k1: number; i0: number; i1: number; pk: number; thr: number }>()
  for (const s of run.result.scenes) {
    if (s.groupId !== groupId) continue
    for (const o of s.objects) {
      if (o.recordUuid !== recordUuid || !o.box) continue
      const comp = run.components.get(componentKey(s.scanIndex, recordUuid, groupId, o.leg))
      if (!comp) continue
      for (const c of comp.cells) {
        const b = Math.floor(c / nt)
        if (b !== beam) continue
        const i = c - b * nt
        const key = `${o.leg}|${comp.status}`
        const p = parts.get(key) ?? { leg: o.leg, st: comp.status, k0: Infinity, k1: -Infinity, i0: Infinity, i1: -Infinity, pk: -Infinity, thr: comp.thresholdPct }
        p.k0 = Math.min(p.k0, s.scanIndex)
        p.k1 = Math.max(p.k1, s.scanIndex)
        p.i0 = Math.min(p.i0, i)
        p.i1 = Math.max(p.i1, i)
        p.pk = Math.max(p.pk, pg.amp.get(s.scanIndex, b, i))
        p.thr = Math.min(p.thr, comp.thresholdPct)
        parts.set(key, p)
      }
    }
  }
  return [...parts.values()]
    .sort((a, b) => a.leg - b.leg || (a.st === b.st ? 0 : a.st === 'positive' ? -1 : 1))
    .map((p) => ({
      recordUuid,
      groupId,
      leg: p.leg,
      beam,
      status: p.st,
      scanStartMm: r4(scanPositionMm(p.k0, pg.group.scan)),
      scanEndMm: r4(scanPositionMm(p.k1, pg.group.scan)),
      sampleStart: p.i0,
      sampleEnd: p.i1,
      depthMinMm: r4(geom.unfoldedMm[beam * nt + p.i0]!),
      depthMaxMm: r4(geom.unfoldedMm[beam * nt + p.i1]!),
      thresholdPct: r3(p.thr),
      peakPct: r3(p.pk),
      viewVerified: false as const
    }))
}

export interface AscanLabel {
  state: SceneState
  /** 이 A-scan 의 구간 (양성·약한 양성) */
  spans: AscanSpan[]
  /** 가릴 샘플 구간 (무시 객체의 창) */
  ignoreRanges: Array<[number, number]>
  /** 음성이 성립하는 샘플 구간 (검토 게이트), 음성이 아니면 null */
  negativeRange: [number, number] | null
  /** A-scan 하나에 클래스 하나가 필요할 때: 가장 센 구간 (없으면 null) */
  strongest: AscanSpan | null
}

/** [lo, hi] 에서 구간들을 뺀 조각 */
function subtractSpans(lo: number, hi: number, cuts: ReadonlyArray<{ sampleStart: number; sampleEnd: number }>): Array<[number, number]> {
  let parts: Array<[number, number]> = [[lo, hi]]
  for (const c of cuts) {
    const next: Array<[number, number]> = []
    for (const [a, b] of parts) {
      if (c.sampleEnd < a || c.sampleStart > b) next.push([a, b])
      else {
        if (c.sampleStart > a) next.push([a, c.sampleStart - 1])
        if (c.sampleEnd < b) next.push([c.sampleEnd + 1, b])
      }
    }
    parts = next
  }
  return parts
}

/**
 * A-scan (그룹, 스캔, 빔) 하나의 세 상태 라벨.
 * 가릴 구간: 무시 객체의 창, 결함 객체(양성·약한 양성) 창에서 그 객체 구간(장면 상자와 같은 덩어리 칸)을 뺀 나머지,
 * 그리고 기본 학습에서 무시하는 약한 양성(weakAs = 'ignore')의 창 전체. 형상 에코 창은 문턱 아래면 그대로 둔다(희미한 띠 = 결함 아님).
 */
export function ascanLabelAt(run: DeriveRun, groupId: number, scan: number, beam: number): AscanLabel {
  const scene = run.result.scenes.find((s) => s.groupId === groupId && s.scanIndex === scan)
  const none: AscanLabel = { state: 'unknown', spans: [], ignoreRanges: [], negativeRange: null, strongest: null }
  if (!scene) return none
  const spans = run.result.ascanSpans.filter((s) => s.groupId === groupId && s.scanIndex === scan && s.beam === beam)
  const ignoreRanges: Array<[number, number]> = []
  for (const o of scene.objects) {
    const w = run.windows.get(o.windowId)
    const lo = w?.lo[beam]
    const hi = w?.hi[beam]
    if (lo === undefined || hi === undefined || hi < lo) continue
    if (o.status === 'ignore' || (o.status === 'weak' && o.trainStatus === 'ignore')) {
      ignoreRanges.push([lo, hi])
      continue
    }
    if (o.policy === 'non-defect') continue
    const own = spans.filter((s) => s.recordUuid === o.recordUuid && s.leg === o.leg).sort((a, b) => a.sampleStart - b.sampleStart)
    ignoreRanges.push(...subtractSpans(lo, hi, own))
  }
  ignoreRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let strongest: AscanSpan | null = null
  for (const s of spans) if (!strongest || s.peakPct > strongest.peakPct) strongest = s
  const pg = run.ctx.groups.find((g) => g.id === groupId)
  let negativeRange: [number, number] | null = null
  if (scene.negativeRegion && pg?.geom) {
    const g = pg.geom
    let a = -1
    let e = -1
    for (let i = 0; i < g.nt; i++) {
      const d = g.unfoldedMm[beam * g.nt + i]!
      if (d >= scene.negativeRegion.depthTopMm && d <= scene.negativeRegion.depthBottomMm) {
        if (a < 0) a = i
        e = i
      }
    }
    if (a >= 0) negativeRange = [a, e]
  }
  let state: SceneState
  const defect = (st: string): boolean => spans.some((s) => s.status === st && run.ctx.rules.kindPolicy[s.kind] === 'defect')
  if (scene.reasons.includes('quality-bad') || scene.reasons.includes('no-data') || !pg?.amp.hasData(scan, beam)) state = 'ignore'
  else if (defect('positive')) state = 'positive'
  else if (defect('weak')) state = 'weak'
  else if (ignoreRanges.length > 0 || scene.reasons.includes('below-threshold-interval')) state = 'ignore'
  else state = scene.reviewed && negativeRange ? 'negative' : 'unknown'
  return { state, spans, ignoreRanges, negativeRange: state === 'negative' ? negativeRange : null, strongest }
}
