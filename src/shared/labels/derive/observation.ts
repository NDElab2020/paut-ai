/**
 * 관측 표 — 기록 × 그룹 × 레그 (규격 1.4·3.3, 런타임 의존성 없음).
 *
 * 그룹·레그마다:
 *   투영 위치 = 기록 영역(V × 실제 깊이, ± regionPadMm)이 그 레그에 맺힌 칸 (빔·샘플 범위) + 기록 스캔 범위
 *   상자 범위(bound) = 영역 ± boxMarginMm 의 칸. 장면 신호·상자·A-scan 구간·C-scan 상자는 이 안에서만 만든다
 *   탐색 창 = 영역 ± searchMarginMm(스캔 U·V·깊이) 의 칸을 ± searchMarginBeams 빔 넓힌 것 (가림 구역)
 *
 * '보임' 판정 (규칙 버전 2):
 *   1) 투영 영역 안 최대(탐색 스캔 범위)가 '보임' 문턱 이상이면 보임 (출처 = 영역).
 *   2) 아니고 전문가가 그리지 않은 그룹·레그면 탐색 창 안으로 옮겨 찾는다(snap, 규격 3.3: 반대 그룹·그리지 않은 레그).
 *      투영 영역 밖의 루트·캡 형상 자리(± boxMarginMm) 칸은 빼고 찾는다. 찾은 최대는 (가) 기록 스캔 범위 안이고
 *      (나) 그 칸의 V·실제 깊이가 영역 ± (searchMarginMm + regionPadMm) 안이어야 하며(빔 넓히기로 들어온 먼 칸은 아님),
 *      (다) 그 자리 바탕(±1빔·±3샘플 포락선의 중앙값)보다 bandRiseDb 이상 세야 하고,
 *      (라) 그 둘레에서 문턱 이상으로 이어지는 스캔 길이가 기록 스캔 범위의 snapMinRunFraction 이상이어야 보임이다
 *      (같은 지시를 반대쪽에서 본 것이면 지시 길이를 따라 이어진다. 띠·다른 반사체의 짧은 조각을 결함으로 잡지 않게).
 *      상자 범위는 그 창(형상 자리 제외)이 된다. 틀린 '보임'은 띠 위 양성 상자를 만들고, 틀린 '안 보임'은 무시라 해가 작아 보수적으로 둔다.
 *   3) 아니면 약함(평가 기준 이상) 또는 안 보임.
 *   띠 위의 지시: 그 레그의 문턱을 max(절대 문턱, 상자 범위 포락선의 바탕값 + bandRiseDb)로 둔다(바탕이 낮으면 그대로).
 *   형상 에코(결함 아님) 기록은 띠 자체가 라벨이라 올리지 않는다.
 *   문턱 (rules.ts thresholdsFor): 결함 = 기록 기준, 형상 에코 = 평가 기준, 기록 기준 미만으로 적은 기록 = 평가 기준(최대 약한 양성).
 * 전문가가 확인한 행(expertConfirmed)이 있으면 그 상태를 쓰고 계산값은 computedStatus 로 따로 둔다.
 *   단, 그 행의 투영 위치·좌표 규칙 버전이 지금 기록으로 계산한 것과 다르면(기록 위치가 바뀜, 엑셀 번호가 다른 지시로 바뀜)
 *   확인이 낡았다고 보고 쓰지 않는다(issue 'observation-stale', 재확인 필요).
 */
import { scanPositionMm } from '../../imaging/coords'
import { LABEL_COORD_RULES_VERSION } from '../types'
import type { ObservationRow, ObservationStatus, ProjectedRange } from '../types'
import { isSaturatedPct } from './amplitude'
import { isDrawn, issue, obsKey, type DeriveContext, type DeriveIssue, type PreparedGroup, type PreparedRecord } from './context'
import { envelopeBackground, envelopePeak, envelopeRun, scanEnvelope, type Envelope, type EnvelopePeak } from './envelope'
import {
  cellsForMm,
  emptyRanges,
  expandSection,
  rangesBounds,
  rangesBox,
  rangesCellCount,
  rangesHas,
  scanRangeForU,
  sectionRanges,
  windowRanges,
  type BeamRanges,
  type GroupCellGeometry,
  type RangesBox
} from './geometry'
import { bandFloorPct, bridgeCells, raiseThresholds, thresholdsFor, type KindThresholds } from './rules'

/** 관측 출처: 전문가 확인 행 / 전문가가 그린 그룹·레그(기록) / 계산만 */
export type ObservationSource = 'expert' | 'record' | 'computed'

export interface LegObservation {
  leg: number
  /** 영역 칸 (투영). 비었을 수 있음 */
  projected: BeamRanges
  /** 탐색 창 (가림 구역) */
  window: BeamRanges
  windowBox: RangesBox
  /** 상자·구간이 퍼질 수 있는 칸 (영역 ± boxMarginMm, 옮겨 찾았으면 탐색 창) */
  bound: BeamRanges
  /** bound 안에서 뺄 칸 (옮겨 찾을 때 형상 자리). null = 없음 */
  exclude: Uint8Array | null
  /** 상자 범위 포락선 (envFrom ~ envTo) */
  env: Envelope
  peak: EnvelopePeak | null
  /** 보임을 어디서 찾았나 (보임이 아니면 null) */
  seed: 'region' | 'snap' | null
  /** 상자 범위 포락선의 바탕값 (%FSH) */
  backgroundPct: number | null
  /** 띠 위라 올린 문턱의 바닥 (%FSH, 0 = 띠 아님) */
  bandFloorPct: number
  /** 이 레그의 문턱 (띠 반영) */
  thresholds: KindThresholds
  saturated: boolean | null
  /** 평가 기준 이상으로 이어지는 스캔 칸 범위 */
  run: [number, number] | null
  computedStatus: ObservationStatus
  /** 쓰는 상태 (전문가 확인 행이 있으면 그 상태) */
  status: ObservationStatus
  expertConfirmed: boolean
  observation: ObservationSource
  /** 전문가 확인 행이 있었지만 기록이 바뀌어 쓰지 않음 */
  stale: boolean
  row: ObservationRow
}

export interface RecordGroupObservation {
  recordUuid: string
  groupId: number
  /** 기록 U 범위의 스캔 칸 (축 밖이면 null) */
  recScan: [number, number] | null
  /** 탐색 스캔 칸 (기록 U ± searchMarginMm) */
  searchScan: [number, number]
  /** 포락선을 계산한 스캔 칸 범위 */
  envFrom: number
  envTo: number
  /** 기록 범위 중심 칸 (같은 최대가 여럿이면 여기에 가까운 쪽) */
  preferScan: number
  /** 띠를 반영하기 전 문턱 */
  thresholds: KindThresholds
  evaluationPct: number
  legs: LegObservation[]
  issues: DeriveIssue[]
}

/** mm 반올림 (출력 바이트 고정) */
export function r4(x: number): number {
  return Math.round(x * 1e4) / 1e4
}

/** %FSH·dB 반올림 */
export function r3(x: number): number {
  return Math.round(x * 1e3) / 1e3
}

/** 빈 범위가 아닌 빔이 모두 [0, nt) 안인가 (maskedMax 빠른 길 조건) */
function rangesWithin(r: BeamRanges, nt: number): boolean {
  for (let b = 0; b < r.lo.length; b++) {
    const lo = r.lo[b]!
    const hi = r.hi[b]!
    if (hi >= lo && (lo < 0 || hi >= nt)) return false
  }
  return true
}

/** 칸 묶음 + 뺄 칸으로 본 포락선 (뺄 칸이 없으면 scanEnvelope 그대로) */
export function maskedEnvelope(
  pg: PreparedGroup,
  ranges: BeamRanges,
  exclude: Uint8Array | null,
  nt: number,
  from: number,
  to: number
): Envelope {
  if (!exclude) return scanEnvelope(pg.amp, ranges, from, to)
  const amp = pg.amp
  const ns = amp.shape[0]
  const k0 = Math.max(0, Math.min(from, to))
  const k1 = Math.min(ns - 1, Math.max(from, to))
  const n = Math.max(0, k1 - k0 + 1)
  const values = new Float64Array(n).fill(NaN)
  const beam = new Int32Array(n).fill(-1)
  const sample = new Int32Array(n).fill(-1)
  // 빠른 길: 진폭 배열을 raw 로 견주고 마지막에 한 번 % 로 (같은 칸·같은 값 — tests/labels/derive.test.ts 'maskedEnvelope 빠른 길')
  if (amp.maskedMax && nt === amp.shape[2] && rangesWithin(ranges, nt)) {
    const at = new Int32Array(2)
    for (let j = 0; j < n; j++) {
      const v = amp.maskedMax(k0 + j, ranges.lo, ranges.hi, exclude, at)
      if (at[0]! < 0) continue
      values[j] = v
      beam[j] = at[0]!
      sample[j] = at[1]!
    }
    return { scanFrom: k0, values, beam, sample }
  }
  for (let j = 0; j < n; j++) {
    const k = k0 + j
    let m = -Infinity
    for (let b = 0; b < ranges.lo.length; b++) {
      const lo = ranges.lo[b]!
      const hi = ranges.hi[b]!
      if (hi < lo || !amp.hasData(k, b)) continue
      for (let i = lo; i <= hi; i++) {
        if (exclude[b * nt + i]) continue
        const v = amp.get(k, b, i)
        if (v > m) {
          m = v
          beam[j] = b
          sample[j] = i
        }
      }
    }
    if (m > -Infinity) values[j] = m
  }
  return { scanFrom: k0, values, beam, sample }
}

/** 옮겨 찾을 때 뺄 칸: 형상 자리(루트·캡, ± boxMarginMm) 칸 가운데 투영 영역 밖인 것 */
function zoneExclude(geom: GroupCellGeometry, ctx: DeriveContext, L: number, keep: BeamRanges): Uint8Array | null {
  if (ctx.echoZones.length === 0) return null
  const out = new Uint8Array(geom.nb * geom.nt)
  let any = false
  for (const z of ctx.echoZones) {
    const zr = sectionRanges(geom, expandSection(z, ctx.rules.boxMarginMm, geom.thicknessMm), L, 0)
    for (let b = 0; b < geom.nb; b++) {
      for (let i = zr.lo[b]!; i <= zr.hi[b]!; i++) {
        if (rangesHas(keep, b, i)) continue
        out[b * geom.nt + i] = 1
        any = true
      }
    }
  }
  return any ? out : null
}

/** 최대 칸 둘레 (±db 빔 · ±di 샘플, 창 안) */
function neighbourhood(window: BeamRanges, beam: number, sample: number, db: number, di: number): BeamRanges {
  const out = emptyRanges(window.lo.length)
  for (let b = Math.max(0, beam - db); b <= Math.min(window.lo.length - 1, beam + db); b++) {
    const lo = Math.max(window.lo[b]!, sample - di)
    const hi = Math.min(window.hi[b]!, sample + di)
    if (hi >= lo) {
      out.lo[b] = lo
      out.hi[b] = hi
    }
  }
  return out
}

function sameProjection(a: ProjectedRange | null, b: ProjectedRange | null): boolean {
  if (a === null || b === null) return a === b
  return (
    Math.abs(a.scanStartMm - b.scanStartMm) <= 0.01 &&
    Math.abs(a.scanEndMm - b.scanEndMm) <= 0.01 &&
    a.beamMin === b.beamMin &&
    a.beamMax === b.beamMax &&
    a.sampleMin === b.sampleMin &&
    a.sampleMax === b.sampleMax
  )
}

/** 기록 하나 × 그룹 하나의 관측. 그룹이 막혔거나 기록이 스캔 축 밖이면 null */
export function observeRecordGroup(ctx: DeriveContext, pr: PreparedRecord, pg: PreparedGroup): RecordGroupObservation | null {
  const geom = pg.geom
  const levels = pg.levels
  const t = ctx.thicknessMm
  if (pg.blocked || !geom || !levels || t === null) return null
  const R = ctx.rules
  const axis = pg.group.scan
  const reg = pr.region
  const recScan = scanRangeForU(axis, reg.scanStartMm, reg.scanEndMm)
  const searchScan = scanRangeForU(axis, reg.scanStartMm - R.searchMarginMm, reg.scanEndMm + R.searchMarginMm)
  if (!searchScan) return null
  const ns = pg.amp.shape[0]
  const noiseCells = cellsForMm(axis, R.noiseWindowMm)
  const reach =
    Math.max(cellsForMm(axis, R.endMarginMaxMm), cellsForMm(axis, R.maxRunBeyondWindowMm)) + cellsForMm(axis, R.maxRunBeyondWindowMm) + noiseCells + 1
  const envFrom = Math.max(0, searchScan[0] - reach)
  const envTo = Math.min(ns - 1, searchScan[1] + reach)
  const preferScan = recScan ? Math.round((recScan[0] + recScan[1]) / 2) : Math.round((searchScan[0] + searchScan[1]) / 2)
  const policy = pr.policy === 'non-defect' ? 'non-defect' : 'defect'
  const th = thresholdsFor(policy, levels, pr.lengthMm, t, pr.cap)
  const beyond = cellsForMm(axis, R.maxRunBeyondWindowMm)
  const ev = levels.evaluationPct
  const issues: DeriveIssue[] = []
  const legs: LegObservation[] = []
  const bgOf = (env: Envelope, at: number | null): number | null => {
    const a = recScan ? recScan[0] : at
    const b = recScan ? recScan[1] : at
    return a === null || b === null ? null : envelopeBackground(env, a, b, noiseCells)
  }
  for (const L of geom.legs) {
    const window = windowRanges(geom, reg, L, R)
    const windowBox = rangesBox(geom, window)
    if (!windowBox) continue
    const projected = sectionRanges(geom, reg, L, R.regionPadMm)
    const regionBound = sectionRanges(geom, expandSection(reg, R.boxMarginMm, t), L, R.regionPadMm)
    const envB = scanEnvelope(pg.amp, regionBound, envFrom, envTo)
    const envP = rangesCellCount(projected) > 0 ? scanEnvelope(pg.amp, projected, envFrom, envTo) : envB
    const peakR = envelopePeak(envP, searchScan[0], searchScan[1], preferScan)
    const bgR = bgOf(envB, peakR?.scan ?? null)
    const floorR = policy === 'non-defect' ? 0 : bandFloorPct(bgR, ev, R.bandRiseDb)
    const thR = raiseThresholds(th, floorR)
    const drawn = isDrawn(pr, pg.id, L)

    let seed: LegObservation['seed'] = null
    let peak: EnvelopePeak | null = peakR
    let bound = regionBound
    let exclude: Uint8Array | null = null
    let env = envB
    let thL = thR
    let floor = floorR
    let bg = bgR
    if (peakR && peakR.pct >= thR.visiblePct) seed = 'region'
    else if (!drawn && policy !== 'non-defect') {
      const ex = zoneExclude(geom, ctx, L, projected)
      const envW = maskedEnvelope(pg, window, ex, geom.nt, envFrom, envTo)
      const pS = envelopePeak(envW, searchScan[0], searchScan[1], preferScan)
      const near = (b: number, i: number): boolean => {
        const c = b * geom.nt + i
        const m = R.searchMarginMm + R.regionPadMm
        const v = geom.vMm[c]!
        const d = geom.depthMm[c]!
        return (reg.vMinMm === null || v >= reg.vMinMm - m) && (reg.vMaxMm === null || v <= reg.vMaxMm + m) && d >= reg.depthTopMm - m && d <= reg.depthBottomMm + m
      }
      const inScan = (k: number): boolean => !recScan || (k >= recScan[0] && k <= recScan[1])
      if (pS && pS.beam >= 0 && inScan(pS.scan) && near(pS.beam, pS.sample)) {
        const local = neighbourhood(window, pS.beam, pS.sample, 1, 3)
        const bgS = bgOf(maskedEnvelope(pg, neighbourhood(window, pS.beam, pS.sample, 1, 3), ex, geom.nt, envFrom, envTo), pS.scan)
        const floorS = bandFloorPct(bgS, ev, R.bandRiseDb)
        const thS = raiseThresholds(th, floorS)
        const localEnv = maskedEnvelope(pg, local, ex, geom.nt, envFrom, envTo)
        const lr = pS.pct >= thS.visiblePct ? envelopeRun(localEnv, pS.scan, thS.visiblePct, bridgeCells(R), searchScan[0], searchScan[1]) : null
        const recLen = recScan ? recScan[1] - recScan[0] + 1 : 1
        const persists = lr !== null && lr[1] - lr[0] + 1 >= Math.max(1, Math.ceil(R.snapMinRunFraction * recLen - 1e-9))
        if (pS.pct >= thS.visiblePct && persists) {
          seed = 'snap'
          peak = pS
          bound = window
          exclude = ex
          env = envW
          thL = thS
          floor = floorS
          bg = bgS
        }
      }
    }
    const pk = peak?.pct ?? null
    const computed: ObservationStatus =
      seed !== null ? 'visible' : pk !== null && policy !== 'non-defect' && pk >= Math.max(ev, floor) ? 'weak' : 'not-visible'

    const pb = rangesBounds(projected)
    const projRow: ProjectedRange | null = pb ? { scanStartMm: r4(reg.scanStartMm), scanEndMm: r4(reg.scanEndMm), ...pb } : null
    const expert0 = ctx.expertRows.get(obsKey(pr.record.uuid, pg.id, L)) ?? null
    const stale = expert0 !== null && (expert0.coordRulesVersion !== LABEL_COORD_RULES_VERSION || !sameProjection(expert0.projected, projRow))
    const expert = stale ? null : expert0
    if (stale) {
      issues.push(
        issue(
          'warning',
          'observation-stale',
          `그룹 ${pg.id} 레그 ${L} 의 전문가 확인 관측은 기록 위치가 바뀌기 전 것이라 쓰지 않았습니다(재확인 필요).`,
          pg.id,
          pr.record.uuid
        )
      )
    }
    const status = expert ? expert.status : computed
    const observation: ObservationSource = expert ? 'expert' : drawn ? 'record' : 'computed'
    const saturated = peak ? isSaturatedPct(peak.pct, pg.amp.saturationPct, R.saturationTolPct) : null
    const runThr = Math.max(ev, floor)
    const run =
      peak && peak.pct >= runThr ? envelopeRun(env, peak.scan, runThr, bridgeCells(R), searchScan[0] - beyond, searchScan[1] + beyond) : null
    const row: ObservationRow = {
      recordUuid: pr.record.uuid,
      groupId: pg.id,
      leg: L,
      projected: projRow,
      search: peak
        ? {
            maxAmplitudePct: r3(peak.pct),
            beam: peak.beam,
            scanMm: r4(scanPositionMm(peak.scan, axis)),
            scanStartMm: run ? r4(scanPositionMm(run[0], axis)) : null,
            scanEndMm: run ? r4(scanPositionMm(run[1], axis)) : null
          }
        : null,
      saturated,
      status,
      expertConfirmed: expert !== null,
      coordRulesVersion: LABEL_COORD_RULES_VERSION,
      revision: expert?.revision ?? 1,
      versions: expert ? expert.versions.map((v) => ({ ...v })) : [],
      deleted: false,
      pcId: expert?.pcId ?? null
    }
    legs.push({
      leg: L,
      projected,
      window,
      windowBox,
      bound,
      exclude,
      env,
      peak,
      seed,
      backgroundPct: bg,
      bandFloorPct: floor,
      thresholds: thL,
      saturated,
      run,
      computedStatus: computed,
      status,
      expertConfirmed: expert !== null,
      observation,
      stale,
      row
    })
  }
  return {
    recordUuid: pr.record.uuid,
    groupId: pg.id,
    recScan,
    searchScan,
    envFrom,
    envTo,
    preferScan,
    thresholds: th,
    evaluationPct: ev,
    legs,
    issues
  }
}

