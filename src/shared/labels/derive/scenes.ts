/**
 * 세 상태 장면 라벨 · 장면 상자 · C-scan 상자 · A-scan 구간 (규격 3.1·3.3·3.4, 런타임 의존성 없음).
 *
 * 장면 = (그룹, 스캔 칸) 의 S-scan 한 장. 장면마다 '객체'(기록 × 레그)를 붙이고 장면 상태를 정한다.
 *
 * 객체 (기록 × 그룹 × 레그). 장면 신호 = 그 레그 상자 범위(영역 ± boxMarginMm, observation.ts) 안 최대:
 *   결함 기록 — 핵심 구간(기록 스캔 범위 ∪ 상자 범위에서 양성인 칸) 안에서
 *     관측 '보임' 레그: 신호 ≥ 양성 문턱 → 양성, ≥ 약한 양성 문턱 → 약한 양성, 그 아래 → 무시(below-level, 띠 수준이면 band-level)
 *       (문턱은 레그마다 띠를 반영한 값. 기록 기준 미만으로 적은 기록은 양성 없이 약한 양성까지)
 *     관측 '약함' 레그 → 무시(weak-leg). 규격 3.1: 관측 '약함'은 약한 양성과 다르다
 *     관측 '안 보임' 레그 → 무시(not-visible) — 결함 자리라 '결함 없음'으로 쓰지 않는다
 *   끝 여유(핵심 구간 밖): 포락선이 잡음 + 6 dB 아래로 떨어질 때까지 또는 고정 5 mm 중 큰 쪽(최대 20 mm) → 무시(end-margin).
 *     그 끝에서도 신호가 평가 기준(띠 반영) 이상으로 이어지면 maxRunBeyondWindowMm 까지 더 무시로 두고,
 *     거기서도 이어지면 issue 'margin-signal-continues'.
 *   존재 확신도 '불확실' → 모두 무시(uncertain). 형상 불완전(처리 'ignore') → 모두 무시(kind-ignored).
 *   평가 기준도 못 넘는다고 적은 기록 → 모두 무시(record-below-evaluation).
 *   형상 에코(결함 아님) — '보임' 레그에서 평가 기준 이상인 칸만 양성(에코 라벨), 끝 여유는 가림(장면 상태는 바꾸지 않음).
 *     결함 기록의 익스텐트(핵심 구간 + 끝 여유)와 U 가 겹치는 칸의 에코 객체는 버린다(결함 우선)
 *
 * 장면 상태 (결함 기준):
 *   품질 불량 구간 · 데이터가 하나도 없는 스캔 칸 → ignore
 *   결함 객체 중 양성이 있으면 → positive (다른 객체의 무시 구역은 가림 상자로 함께 냄)
 *   약한 양성이 있으면 → weak (새 기본값: 따로 내보내고 기본 학습·평가에서는 무시, rules.weakAs)
 *   결함·형상 불완전 기록의 무시 객체가 있거나 '기준 미만 지시' 구간(± 5 mm)이면 → ignore
 *   검토 완료 구간이면 → negative (형상 에코 객체는 '결함 아님' 상자·가림으로 붙어 있을 수 있음). 음성의 범위는 검토 게이트(negativeRegion)
 *   그 밖 → unknown (검토 안 한 곳)
 * 학습 상태(trainState)는 객체마다의 학습 상태(trainStatus: 약한 양성 → weakAs, 계산만 한 관측 → unconfirmedObservation)로 같은 규칙을 다시 적용한 것.
 *
 * 장면 상자: 펼친 S-scan 좌표(V, 펼친 깊이), 레그별. 그 장면 그 레그 상자 범위 안에서 문턱을 넘는 칸 중
 *   최대 칸과 이어진(8-이웃, 빔 × 샘플 격자) 덩어리의 범위. 문턱을 넘는 칸이 없으면 상자를 만들지 않는다(상태가 무시로 감).
 *   A-scan 구간·C-scan 상자·B-scan 상자도 이 덩어리 칸으로 만든다(형식마다 같은 칸). 창의 나머지 칸은 가림이다.
 *   접기 처리: 상자 범위는 그 레그에 맺힌 칸만 담으므로, 스킵선(펼친 깊이 = t 의 배수)에 걸친 에코(루트 결함 등)는 레그마다 따로 상자가 된다.
 *   장면 상자의 높이는 크기 정답이 아니다(규격 3.3).
 * C-scan 상자: (기록, 그룹)마다 하나. 그 C-scan 게이트 창이 투영 칸의 gateCoverFraction 이상을 덮는 레그의 덩어리 칸 가운데
 *   게이트 안 칸의 범위. 상태는 가장 높은 것(양성 > 약한 양성).
 * A-scan 구간: 덩어리 칸을 빔마다 이어진 샘플 구간으로. 레그·용접 경계까지 거리·경계 안/밖을 붙인다.
 */
import { scanPositionMm } from '../../imaging/coords'
import { gateSampleWindow } from '../../imaging/gates'
import type { Confidence, MetallurgicalType, RecordKind } from '../types'
import type { DeriveContext, PreparedGroup, PreparedRecord } from './context'
import { envelopeAt, envelopeBackground, measureEnvelope, type Envelope } from './envelope'
import { bevelDistanceMm, cellsForMm, rangesCellCount, rangesHas, scanRangeForU, type BeamRanges, type GroupCellGeometry } from './geometry'
import { r3, r4, type LegObservation, type ObservationSource, type RecordGroupObservation } from './observation'
import { bridgeCells, type DeriveRules, type KindPolicy } from './rules'

export type ObjectStatus = 'positive' | 'weak' | 'ignore'
export type ObjectReason =
  | 'end-margin'
  | 'below-level'
  | 'band-level'
  | 'weak-leg'
  | 'not-visible'
  | 'uncertain'
  | 'kind-ignored'
  | 'record-below-evaluation'
export type SceneState = 'positive' | 'weak' | 'ignore' | 'negative' | 'unknown'
/** 장면 전체를 무시로 두는 이유: 품질 불량 구간 / 기준 미만 지시 구간(± 5 mm) / 그 스캔 칸에 데이터가 하나도 없음(상태 비트 0) */
export type SceneReason = 'quality-bad' | 'below-threshold-interval' | 'no-data'

/** 펼친 S-scan 상자 (칸 중심 기준 범위) */
export interface SceneBox {
  leg: number
  vMinMm: number
  vMaxMm: number
  /** 펼친 깊이 */
  depthMinMm: number
  depthMaxMm: number
  beamMin: number
  beamMax: number
  sampleMin: number
  sampleMax: number
  cells: number
  thresholdPct: number
  peakPct: number
  peakBeam: number
  peakSample: number
}

export interface SceneObject {
  recordUuid: string
  kind: RecordKind
  defectType: MetallurgicalType | null
  /** 종류 확신도 (지침서 10절 '종류 학습만 끔'에 씀) */
  typeConfidence: Confidence | null
  policy: KindPolicy
  leg: number
  status: ObjectStatus
  /** 기본 학습·평가에서 쓰는 상태 (약한 양성 → weakAs, 계산만 한 관측 → unconfirmedObservation) */
  trainStatus: ObjectStatus
  reason: ObjectReason | null
  /** 이 레그 관측의 출처 (전문가 확인 / 전문가가 그린 그룹·레그 / 계산만) */
  observation: ObservationSource
  /** 그 장면 그 레그 상자 범위 안 최대 (%FSH, 데이터 없으면 null) */
  signalPct: number | null
  /** 양성·약한 양성: 절대 문턱 윤곽 상자 */
  box: SceneBox | null
  /** 이 객체의 레그가 검토 게이트 레그 안인지 (검토하지 않은 장면이면 null) */
  inReviewedGate: boolean | null
  /** 가릴 구역 = 그 레그 탐색 창 (windows 의 id) */
  windowId: string
}

/** 음성의 범위: 검토 게이트 (펼친 깊이, 레그) */
export interface NegativeRegion {
  legMin: number
  legMax: number
  depthTopMm: number
  depthBottomMm: number
}

export interface SceneLabel {
  groupId: number
  scanIndex: number
  scanMm: number
  state: SceneState
  /** 기본 학습·평가에서 쓰는 상태 (객체의 trainStatus 로 다시 정한 것) */
  trainState: SceneState
  reasons: SceneReason[]
  reviewed: boolean
  negativeRegion: NegativeRegion | null
  objects: SceneObject[]
}

/** C-scan 상자: 가로 = 스캔, 세로 = 빔(굴절각). (기록, 그룹)마다 하나 */
export interface CscanBox {
  recordUuid: string
  groupId: number
  /** 상자에 든 레그 */
  legs: number[]
  gateId: number
  status: 'positive' | 'weak'
  scanStartMm: number
  scanEndMm: number
  beamMin: number
  beamMax: number
  angleMinDeg: number
  angleMaxDeg: number
  thresholdPct: number
  peakPct: number
  /** 게이트 창이 덮는 투영 칸 비율 (든 레그 가운데 가장 작은 값) */
  gateCoverage: number
}

export interface AscanSpan {
  groupId: number
  scanIndex: number
  scanMm: number
  beam: number
  /** 샘플 구간 (양 끝 포함) */
  sampleStart: number
  sampleEnd: number
  recordUuid: string
  kind: RecordKind
  defectType: MetallurgicalType | null
  status: 'positive' | 'weak'
  trainStatus: ObjectStatus
  leg: number
  thresholdPct: number
  peakPct: number
  peakSample: number
  /** 최대 샘플의 V·실제 깊이 */
  vMm: number
  depthMm: number
  /** 용접 경계(개선면)까지 거리 (mm, + = 경계 밖 모재 쪽). 개선 형상이 없으면 null */
  weldBoundaryDistanceMm: number | null
  /** 경계 안(용착부)인지. 개선 형상이 없으면 null */
  insideWeld: boolean | null
}

/** 객체를 만들기 전 칸마다의 판정 (기록 × 그룹 × 레그 × 스캔) */
export interface TrackCell {
  scan: number
  leg: number
  status: ObjectStatus
  reason: ObjectReason | null
  signalPct: number | null
  thresholdPct: number | null
}

/** 기록 × 그룹의 장면 판정 묶음 */
export interface Track {
  record: PreparedRecord
  groupId: number
  obs: RecordGroupObservation
  /** 핵심 구간 (스캔 칸) = 기록 스캔 범위 ∪ echoRun */
  core: [number, number] | null
  /** 학습용 에코 범위: 보임 레그 포락선이 양성 문턱 이상으로 이어지는 구간 (measureEnvelope) */
  echoRun: [number, number] | null
  /** 끝 여유까지 넣은 구간 */
  extent: [number, number] | null
  marginCells: [number, number]
  /** 끝 여유 끝에서도 신호가 이어짐 (왼쪽, 오른쪽) */
  marginContinues: [boolean, boolean]
  /** 잡음(바탕값) %FSH */
  noisePct: number | null
  cells: TrackCell[]
}

/** 장면 상자의 칸 덩어리 (A-scan·B-scan·C-scan 이 같은 칸을 쓴다) */
export interface SceneComponent {
  status: 'positive' | 'weak'
  thresholdPct: number
  /** 칸 c = 빔 × nt + 샘플 (오름차순) */
  cells: Int32Array
}

export function windowIdOf(recordUuid: string, groupId: number, leg: number): string {
  return `${recordUuid}|${groupId}|L${leg}`
}

export function componentKey(scan: number, recordUuid: string, groupId: number, leg: number): string {
  return `${scan}|${recordUuid}|${groupId}|${leg}`
}

/** 객체 하나의 학습 상태 */
export function objectTrainStatus(
  status: ObjectStatus,
  observation: ObservationSource,
  rules: Pick<DeriveRules, 'weakAs' | 'unconfirmedObservation'>
): ObjectStatus {
  if (status === 'ignore') return 'ignore'
  if (observation === 'computed' && rules.unconfirmedObservation === 'ignore') return 'ignore'
  return status === 'weak' ? rules.weakAs : status
}

// ───────────────────────────── 트랙 (기록 × 그룹) ─────────────────────────────

function combinedEnvelope(legs: readonly LegObservation[], from: number, to: number): Envelope {
  const n = Math.max(0, to - from + 1)
  const values = new Float64Array(n).fill(NaN)
  for (let j = 0; j < n; j++) {
    let m = NaN
    for (const l of legs) {
      const v = envelopeAt(l.env, from + j)
      if (Number.isFinite(v) && !(v <= m)) m = v
    }
    values[j] = m
  }
  return { scanFrom: from, values, beam: new Int32Array(n).fill(-1), sample: new Int32Array(n).fill(-1) }
}

/** 핵심 구간을 정하는 문턱 (양성 문턱, 양성이 없는 기록이면 약한 양성 문턱) */
function coreThreshold(l: LegObservation): number {
  const t = l.thresholds
  return Number.isFinite(t.positivePct) ? t.positivePct : (t.weakPct ?? t.visiblePct)
}

export function buildTrack(ctx: DeriveContext, pr: PreparedRecord, pg: PreparedGroup, obs: RecordGroupObservation): Track {
  const R = ctx.rules
  const axis = pg.group.scan
  const ns = pg.amp.shape[0]
  const ignoreReason: ObjectReason | null = pr.uncertain
    ? 'uncertain'
    : pr.policy === 'ignore'
      ? 'kind-ignored'
      : pr.cap === 'ignore'
        ? 'record-below-evaluation'
        : null
  const mode: 'defect' | 'non-defect' | 'ignore' = ignoreReason !== null ? 'ignore' : pr.policy === 'non-defect' ? 'non-defect' : 'defect'
  const visible = obs.legs.filter((l) => l.status === 'visible')
  const seen = obs.legs.filter((l) => l.status === 'visible' || l.status === 'weak')
  const empty: Track = {
    record: pr,
    groupId: pg.id,
    obs,
    core: null,
    echoRun: null,
    extent: null,
    marginCells: [0, 0],
    marginContinues: [false, false],
    noisePct: null,
    cells: []
  }
  if (mode === 'non-defect' && visible.length === 0) return empty

  const noiseCells = cellsForMm(axis, R.noiseWindowMm)
  // 핵심 구간 = 기록 스캔 범위 ∪ 학습용 에코 범위.
  // 학습용 에코 범위 = '보임' 레그마다 상자 범위 포락선이 그 레그 문턱(띠 반영) 이상으로 이어지는 구간의 합 (탐색 스캔 범위 안)
  //   — 길이 제안과 같은 measureEnvelope
  let core: [number, number] | null = obs.recScan ? [obs.recScan[0], obs.recScan[1]] : null
  let echoRun: [number, number] | null = null
  if (mode !== 'ignore') {
    for (const l of visible) {
      const m = measureEnvelope(pg.amp, l.bound, {
        envelope: l.env,
        peakFrom: obs.searchScan[0],
        peakTo: obs.searchScan[1],
        runFrom: obs.searchScan[0],
        runTo: obs.searchScan[1],
        rule: { kind: 'absolute', thresholdPct: coreThreshold(l) },
        bridge: bridgeCells(R),
        backgroundHalfCells: noiseCells,
        preferScan: obs.preferScan,
        saturationTolPct: R.saturationTolPct
      })
      if (m && m.startScan !== null && m.endScan !== null) {
        echoRun = echoRun ? [Math.min(echoRun[0], m.startScan), Math.max(echoRun[1], m.endScan)] : [m.startScan, m.endScan]
      }
    }
    if (echoRun) core = core ? [Math.min(core[0], echoRun[0]), Math.max(core[1], echoRun[1])] : [echoRun[0], echoRun[1]]
  } else if (!core) {
    core = [obs.searchScan[0], obs.searchScan[1]]
  }
  if (!core) return empty

  // 끝 여유: max(고정 최소, 잡음 + rise dB 아래로 떨어질 때까지), 상한. 잡음 = 상자 범위 포락선(띠 칸은 빠짐)의 중앙값
  const minCells = cellsForMm(axis, R.endMarginMinMm)
  const maxCells = Math.max(minCells, cellsForMm(axis, R.endMarginMaxMm))
  const extraCells = cellsForMm(axis, R.maxRunBeyondWindowMm)
  const walkLegs = seen.length > 0 ? seen : obs.legs
  const comb = combinedEnvelope(walkLegs, obs.envFrom, obs.envTo)
  const noise = seen.length > 0 ? envelopeBackground(comb, core[0], core[1], noiseCells) : null
  const noiseThr = noise === null ? Infinity : noise * 10 ** (R.noiseRiseDb / 20)
  /** 결함 에코가 아직 센 칸: 어느 '보임·약함' 레그든 평가 기준(띠 반영) 이상 */
  const strongAt = (k: number): boolean =>
    mode === 'defect' && seen.some((l) => envelopeAt(l.env, k) >= Math.max(obs.evaluationPct, l.bandFloorPct))
  const walk = (start: number, step: number): { d: number; continues: boolean } => {
    let d = 0
    let k = start
    while (d < maxCells && k >= 0 && k < ns && envelopeAt(comb, k) >= noiseThr) {
      d++
      k += step
    }
    d = Math.min(maxCells, Math.max(minCells, d))
    k = start + step * d
    let extra = 0
    while (extra < extraCells && k >= 0 && k < ns && strongAt(k)) {
      extra++
      k += step
    }
    return { d: d + extra, continues: k >= 0 && k < ns && strongAt(k) }
  }
  const wl = walk(core[0] - 1, -1)
  const wr = walk(core[1] + 1, 1)
  const extent: [number, number] = [Math.max(0, core[0] - wl.d), Math.min(ns - 1, core[1] + wr.d)]

  const cells: TrackCell[] = []
  for (let k = extent[0]; k <= extent[1]; k++) {
    const inCore = k >= core[0] && k <= core[1]
    for (const l of obs.legs) {
      const v = envelopeAt(l.env, k)
      const sig = Number.isFinite(v) ? v : null
      const th = l.thresholds
      const push = (status: ObjectStatus, reason: ObjectReason | null, thr: number | null): void => {
        cells.push({ scan: k, leg: l.leg, status, reason, signalPct: sig, thresholdPct: thr })
      }
      if (mode === 'ignore') {
        push('ignore', ignoreReason, null)
        continue
      }
      if (mode === 'non-defect') {
        if (l.status !== 'visible') continue
        if (!inCore) push('ignore', 'end-margin', null)
        else if (sig !== null && sig >= th.positivePct) push('positive', null, th.positivePct)
        continue
      }
      if (!inCore) {
        push('ignore', 'end-margin', null)
        continue
      }
      if (l.status === 'visible') {
        if (sig !== null && sig >= th.positivePct) push('positive', null, th.positivePct)
        else if (th.weakPct !== null && sig !== null && sig >= th.weakPct) push('weak', null, th.weakPct)
        else push('ignore', l.bandFloorPct > 0 && sig !== null && sig >= obs.evaluationPct ? 'band-level' : 'below-level', null)
      } else if (l.status === 'weak') {
        push('ignore', 'weak-leg', null)
      } else {
        push('ignore', 'not-visible', null)
      }
    }
  }
  return {
    record: pr,
    groupId: pg.id,
    obs,
    core,
    echoRun,
    extent,
    marginCells: [wl.d, wr.d],
    marginContinues: [wl.continues, wr.continues],
    noisePct: noise,
    cells
  }
}

// ───────────────────────────── 장면 상자 (절대 문턱 윤곽) ─────────────────────────────

/**
 * 스캔 k, 상자 범위(bound, exclude 칸 제외) 안에서 문턱 이상인 칸 중 (seedB, seedI) 와 이어진 덩어리의 상자와 칸.
 * 씨앗이 문턱 아래면 null. visited 는 nb·nt 크기 작업 배열 (쓴 칸은 돌려놓는다).
 */
export function thresholdComponentBox(
  pg: PreparedGroup,
  geom: GroupCellGeometry,
  bound: BeamRanges,
  exclude: Uint8Array | null,
  k: number,
  seedB: number,
  seedI: number,
  thresholdPct: number,
  leg: number,
  visited: Uint8Array
): { box: SceneBox; cells: Int32Array } | null {
  const amp = pg.amp
  const nt = geom.nt
  const ok = (b: number, i: number): boolean =>
    rangesHas(bound, b, i) && !(exclude && exclude[b * nt + i]) && amp.hasData(k, b) && amp.get(k, b, i) >= thresholdPct
  if (!ok(seedB, seedI)) return null
  const stack: number[] = [seedB * nt + seedI]
  const touched: number[] = []
  visited[seedB * nt + seedI] = 1
  touched.push(seedB * nt + seedI)
  let b0 = seedB
  let b1 = seedB
  let s0 = seedI
  let s1 = seedI
  let v0 = Infinity
  let v1 = -Infinity
  let d0 = Infinity
  let d1 = -Infinity
  let peak = -Infinity
  let pb = seedB
  let ps = seedI
  while (stack.length > 0) {
    const c = stack.pop()!
    const b = Math.floor(c / nt)
    const i = c - b * nt
    const val = amp.get(k, b, i)
    if (val > peak || (val === peak && (b < pb || (b === pb && i < ps)))) {
      peak = val
      pb = b
      ps = i
    }
    b0 = Math.min(b0, b)
    b1 = Math.max(b1, b)
    s0 = Math.min(s0, i)
    s1 = Math.max(s1, i)
    v0 = Math.min(v0, geom.vMm[c]!)
    v1 = Math.max(v1, geom.vMm[c]!)
    d0 = Math.min(d0, geom.unfoldedMm[c]!)
    d1 = Math.max(d1, geom.unfoldedMm[c]!)
    for (let db = -1; db <= 1; db++) {
      for (let di = -1; di <= 1; di++) {
        if (db === 0 && di === 0) continue
        const nb2 = b + db
        const ni = i + di
        if (nb2 < 0 || nb2 >= geom.nb || ni < 0 || ni >= nt) continue
        const nc = nb2 * nt + ni
        if (visited[nc]) continue
        if (!ok(nb2, ni)) continue
        visited[nc] = 1
        touched.push(nc)
        stack.push(nc)
      }
    }
  }
  for (const c of touched) visited[c] = 0
  const cells = Int32Array.from(touched).sort()
  return {
    box: {
      leg,
      vMinMm: r4(v0),
      vMaxMm: r4(v1),
      depthMinMm: r4(d0),
      depthMaxMm: r4(d1),
      beamMin: b0,
      beamMax: b1,
      sampleMin: s0,
      sampleMax: s1,
      cells: cells.length,
      thresholdPct: r3(thresholdPct),
      peakPct: r3(peak),
      peakBeam: pb,
      peakSample: ps
    },
    cells
  }
}

// ───────────────────────────── A-scan 구간 ─────────────────────────────

/** 덩어리 칸을 빔마다 이어진 샘플 구간으로 (장면 상자와 같은 칸) */
export function ascanSpansFromCells(
  ctx: DeriveContext,
  pg: PreparedGroup,
  geom: GroupCellGeometry,
  k: number,
  cells: Int32Array,
  obj: Pick<SceneObject, 'recordUuid' | 'kind' | 'defectType' | 'leg' | 'trainStatus'> & { status: 'positive' | 'weak' },
  thresholdPct: number
): AscanSpan[] {
  const out: AscanSpan[] = []
  const nt = geom.nt
  const t = geom.thicknessMm
  const scanMm = r4(scanPositionMm(k, pg.group.scan))
  let j = 0
  while (j < cells.length) {
    const b = Math.floor(cells[j]! / nt)
    let a = cells[j]! - b * nt
    let prev = a
    let pk = pg.amp.get(k, b, a)
    let pi = a
    j++
    const flush = (end: number): void => {
      const c = b * nt + pi
      const vMm = geom.vMm[c]!
      const depthMm = geom.depthMm[c]!
      const dist = bevelDistanceMm(ctx.weld, t, vMm, depthMm)
      out.push({
        groupId: pg.id,
        scanIndex: k,
        scanMm,
        beam: b,
        sampleStart: a,
        sampleEnd: end,
        recordUuid: obj.recordUuid,
        kind: obj.kind,
        defectType: obj.defectType,
        status: obj.status,
        trainStatus: obj.trainStatus,
        leg: obj.leg,
        thresholdPct: r3(thresholdPct),
        peakPct: r3(pk),
        peakSample: pi,
        vMm: r4(vMm),
        depthMm: r4(depthMm),
        weldBoundaryDistanceMm: dist === null ? null : r4(dist),
        insideWeld: dist === null ? null : dist <= 0
      })
    }
    while (j < cells.length && Math.floor(cells[j]! / nt) === b) {
      const i = cells[j]! - b * nt
      if (i !== prev + 1) {
        flush(prev)
        a = i
        pk = pg.amp.get(k, b, i)
        pi = i
      } else {
        const v = pg.amp.get(k, b, i)
        if (v > pk) {
          pk = v
          pi = i
        }
      }
      prev = i
      j++
    }
    flush(prev)
  }
  return out
}

// ───────────────────────────── C-scan 상자 ─────────────────────────────

/** 게이트 창이 덮는 칸 비율 (칸 묶음 기준) */
export function gateCoverage(pg: PreparedGroup, ranges: BeamRanges): number {
  const gate = pg.cscanGate
  const total = rangesCellCount(ranges)
  if (!gate || total === 0) return 0
  let inside = 0
  for (let b = 0; b < ranges.lo.length; b++) {
    const lo = ranges.lo[b]!
    const hi = ranges.hi[b]!
    if (hi < lo) continue
    const [g0, g1] = gateSampleWindow(pg.group, gate, b)
    const a = Math.max(lo, g0)
    const e = Math.min(hi, g1 - 1)
    if (e >= a) inside += e - a + 1
  }
  return inside / total
}

/** (기록, 그룹)의 C-scan 상자를 모으는 그릇 */
export class CscanAccumulator {
  private readonly parts = new Map<'positive' | 'weak', { b0: number; b1: number; k0: number; k1: number; peak: number; thr: number; legs: Set<number> }>()
  private cover = Infinity

  constructor(
    readonly pg: PreparedGroup,
    readonly geom: GroupCellGeometry,
    readonly recordUuid: string,
    readonly minCover: number
  ) {}

  /** 레그의 게이트 덮개 (부족하면 그 레그 칸은 넣지 않는다) */
  legCoverage(leg: LegObservation): number {
    const base = rangesCellCount(leg.projected) > 0 ? leg.projected : leg.bound
    return gateCoverage(this.pg, base)
  }

  add(k: number, leg: LegObservation, comp: SceneComponent): void {
    const gate = this.pg.cscanGate
    if (!gate) return
    const cov = this.legCoverage(leg)
    if (cov < this.minCover) return
    const nt = this.geom.nt
    for (const c of comp.cells) {
      const b = Math.floor(c / nt)
      const i = c - b * nt
      const [g0, g1] = gateSampleWindow(this.pg.group, gate, b)
      if (i < g0 || i >= g1) continue
      const v = this.pg.amp.get(k, b, i)
      const p = this.parts.get(comp.status) ?? { b0: Infinity, b1: -Infinity, k0: Infinity, k1: -Infinity, peak: -Infinity, thr: comp.thresholdPct, legs: new Set<number>() }
      p.b0 = Math.min(p.b0, b)
      p.b1 = Math.max(p.b1, b)
      p.k0 = Math.min(p.k0, k)
      p.k1 = Math.max(p.k1, k)
      p.peak = Math.max(p.peak, v)
      p.thr = Math.min(p.thr, comp.thresholdPct)
      p.legs.add(leg.leg)
      this.parts.set(comp.status, p)
      this.cover = Math.min(this.cover, cov)
    }
  }

  /** 가장 높은 상태 하나 (양성 > 약한 양성). 없으면 null */
  box(): CscanBox | null {
    const gate = this.pg.cscanGate
    const st: 'positive' | 'weak' | null = this.parts.has('positive') ? 'positive' : this.parts.has('weak') ? 'weak' : null
    if (!gate || st === null) return null
    const p = this.parts.get(st)!
    const angles = [this.pg.group.beams[p.b0]!.angleDeg, this.pg.group.beams[p.b1]!.angleDeg]
    return {
      recordUuid: this.recordUuid,
      groupId: this.pg.id,
      legs: [...p.legs].sort((a, b) => a - b),
      gateId: gate.id,
      status: st,
      scanStartMm: r4(scanPositionMm(p.k0, this.pg.group.scan)),
      scanEndMm: r4(scanPositionMm(p.k1, this.pg.group.scan)),
      beamMin: p.b0,
      beamMax: p.b1,
      angleMinDeg: r4(Math.min(...angles)),
      angleMaxDeg: r4(Math.max(...angles)),
      thresholdPct: r3(p.thr),
      peakPct: r3(p.peak),
      gateCoverage: r3(this.cover)
    }
  }
}

// ───────────────────────────── 검토 구간 ─────────────────────────────

export interface GroupIntervals {
  reviewed: Array<{ lo: number; hi: number; region: NegativeRegion }>
  qualityBad: Array<{ lo: number; hi: number }>
  belowThreshold: Array<{ lo: number; hi: number }>
}

/** C-scan 게이트가 덮는 펼친 깊이·레그 (게이트가 없으면 칸 전체) */
export function gateRegionOf(pg: PreparedGroup, geom: GroupCellGeometry): NegativeRegion {
  const gate = pg.cscanGate
  let top = Infinity
  let bottom = -Infinity
  for (let b = 0; b < geom.nb; b++) {
    const [i0, i1] = gate ? gateSampleWindow(pg.group, gate, b) : [0, geom.nt]
    if (i1 <= i0) continue
    top = Math.min(top, geom.unfoldedMm[b * geom.nt + i0]!)
    bottom = Math.max(bottom, geom.unfoldedMm[b * geom.nt + i1 - 1]!)
  }
  if (!(bottom >= top)) return { legMin: 1, legMax: geom.maxLeg, depthTopMm: 0, depthBottomMm: geom.thicknessMm * geom.maxLeg }
  const t = geom.thicknessMm
  return {
    legMin: Math.max(1, Math.floor(top / t) + 1),
    legMax: Math.min(geom.maxLeg, Math.floor(bottom / t) + 1),
    depthTopMm: r4(top),
    depthBottomMm: r4(bottom)
  }
}

export function groupIntervals(ctx: DeriveContext, pg: PreparedGroup, geom: GroupCellGeometry): GroupIntervals {
  const axis = pg.group.scan
  const out: GroupIntervals = { reviewed: [], qualityBad: [], belowThreshold: [] }
  const fileGate = gateRegionOf(pg, geom)
  for (const v of ctx.intervals) {
    if (v.groupId !== null && v.groupId !== pg.id) continue
    if (v.kind === 'below-threshold') {
      const m = ctx.rules.belowThresholdMarginMm
      const r = scanRangeForU(axis, v.scanStartMm - m, v.scanEndMm + m)
      if (r) out.belowThreshold.push({ lo: r[0], hi: r[1] })
      continue
    }
    const r = scanRangeForU(axis, v.scanStartMm, v.scanEndMm)
    if (!r) continue
    if (v.kind === 'quality-bad') out.qualityBad.push({ lo: r[0], hi: r[1] })
    else {
      const g = v.gate
      const region: NegativeRegion = g
        ? {
            legMin: Math.min(g.legMin, g.legMax),
            legMax: Math.max(g.legMin, g.legMax),
            depthTopMm: r4(Math.min(g.depthTopMm, g.depthBottomMm)),
            depthBottomMm: r4(Math.max(g.depthTopMm, g.depthBottomMm))
          }
        : fileGate
      out.reviewed.push({ lo: r[0], hi: r[1], region })
    }
  }
  return out
}

/**
 * 장면 상태 (머리 주석 규칙). use = 'trainStatus' 면 객체의 학습 상태로 정한다(trainState).
 * 형상 에코(결함 아님) 기록의 무시 객체(끝 여유)는 그 창만 가리고 장면 상태는 바꾸지 않는다 — 띠 끝 음성을 버리지 않게.
 */
export function sceneStateOf(
  objects: readonly SceneObject[],
  reviewed: boolean,
  reasons: readonly SceneReason[],
  use: 'status' | 'trainStatus' = 'status'
): SceneState {
  const st = (o: SceneObject): ObjectStatus => (use === 'status' ? o.status : o.trainStatus)
  if (reasons.includes('quality-bad') || reasons.includes('no-data')) return 'ignore'
  if (objects.some((o) => o.policy === 'defect' && st(o) === 'positive')) return 'positive'
  if (objects.some((o) => o.policy === 'defect' && st(o) === 'weak')) return 'weak'
  if (objects.some((o) => o.policy !== 'non-defect' && st(o) === 'ignore') || reasons.includes('below-threshold-interval')) return 'ignore'
  return reviewed ? 'negative' : 'unknown'
}
