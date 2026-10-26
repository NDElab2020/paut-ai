/**
 * 자체 점검 — 읽은 구조가 장비가 남긴 값과 맞는지 파일마다 잰다 (판단.md 3.2).
 *
 * 1. 게이트 A: 래스터에서 게이트 A 구간 최댓값을 다시 계산해 장비가 저장한 게이트 결과(바이트 8)와 정수로 비교.
 *    빈 프레임(래스터가 모두 0 — 스캔을 끝까지 못 간 곳)은 대조에서 뺀다. 다만 그 프레임의 장비 게이트 결과가 0 이 아니면
 *    '손상 의심 프레임'으로 따로 센다(실데이터에는 없음 — 래스터 구간이 0 으로 지워진 사본).
 *    구간 = 게이트 시작·폭(깊이 시간) ÷ cos(굴절각) 을 빔 시간으로, 샘플 i 는 t0 + i·간격.
 *    포함 샘플 = ceil((시작 − t0)/간격 − 1e-6) … floor((끝 − t0)/간격 + 1e-6) (양끝 포함, 1_파서실험 기준값과 같은 규칙).
 *    '저장 구간 안' = 게이트 구간 전체가 샘플 0 … 마지막 샘플 안에 있는 칸.
 *    판정(판단.md 3.2): 저장 구간 안 칸 일치율 ≥ 95 % 이고, 저장 구간 밖까지 포함한 전체 칸 일치율도 ≥ 95 %
 *    (낮은 전체 일치율의 원인을 가르기 전에는 대조 전), 설명할 수 없는 어긋남(장비 값 < 재계산) ≤ 10 %.
 *    저장 구간 안 칸이 없으면 판정하지 못함(null) — 대조 전으로 둔다.
 *    센 신호(재계산 raw ≥ 224) 칸 일치율은 따로 센다(포화 근처는 절반쯤만 맞음 — 원인 모름, 캡처 O2 로 확인할 것).
 * 2. 스넬: 빔 출사점 X ↔ 웨지(각·음속·첫 소자 오프셋·높이)와 어퍼처 가운데 소자 위치, 굴절각으로 계산한 출사점.
 *    가운데 소자 = 첫 소자 + (소자 수 − 1)/2, 경사면을 따라 앞·위로 피치만큼. 법칙 음속(R+0x28)으로 입사각을 구한다.
 * 3. 두께: Hot Pass + Land + Root. 양의 잔여 Fill 높이는 판정 보류하며 알려진 층 합이 두께를 넘을 때 불일치.
 */
import { OPD_GATE_COUNT, OPD_GATE_RECORD_BYTES, type OpdBeam, type OpdFile, type OpdSelfCheck } from './types'

/** 판단.md 3.2 기준 (+ 2026-10-07 검토 반영: 전체 칸 일치율·설명할 수 없는 어긋남·센 신호 따로 셈) */
export const SELF_CHECK_LIMITS = {
  gateAInsideRate: 0.95,
  /** 저장 구간 밖까지 포함한 전체 칸 일치율 (판단.md 3.2 '낮은 전체 일치율은 가르기 전에는 대조 전') */
  gateAAllRate: 0.95,
  /** 장비 값 < 재계산 칸 비율 상한 (실데이터 최대 4.5 %) */
  gateAUnexplainedRate: 0.1,
  /** 센 신호 경계 (raw). 이보다 센 칸은 실데이터에서 절반쯤만 일치한다 */
  strongRaw: 224,
  /** 센 신호 칸 일치율이 이보다 낮으면 메모·막는 이유에 적는다 */
  strongRate: 0.95,
  snellMaxDiffMm: 0.05,
  thicknessTolMm: 0.05
} as const

const DEG = Math.PI / 180
/** 게이트 결과 기록 안 최대 진폭 바이트 */
export const GATE_PEAK_BYTE = 8
const GATE_A = 1
const EPS = 1e-6

export interface GateWindow {
  /** 포함 샘플 (양끝 포함). lo > hi 면 저장 구간 안에 샘플이 없음 */
  lo: number
  hi: number
  /** 게이트 구간 전체가 저장 구간 안 */
  inside: boolean
}

/** 빔 하나의 게이트 구간 → 샘플 번호 범위 */
export function gateSampleWindow(beam: OpdBeam, gateIndex: number, samples: number): GateWindow {
  const g = beam.gates[gateIndex]!
  const cos = Math.cos(beam.angleDeg * DEG)
  const a = g.startDepthUs / cos
  const e = (g.startDepthUs + g.widthDepthUs) / cos
  const fa = (a - beam.t0Us) / beam.sampleIntervalUs
  const fe = (e - beam.t0Us) / beam.sampleIntervalUs
  const lo = Math.max(0, Math.ceil(fa - EPS))
  const hi = Math.min(samples - 1, Math.floor(fe + EPS))
  return { lo, hi, inside: fa >= -EPS && fe <= samples - 1 + EPS }
}

/** 스넬 계산 출사점 X (mm, 웨지 앞면 기준). 계산할 수 없으면 NaN */
export function snellExitXMm(file: OpdFile, beam: OpdBeam): number {
  const { wedge, probe } = file.setup
  const a = wedge.angleDeg * DEG
  const center = beam.firstElement + (beam.elementCount - 1) / 2
  const s = center * probe.pitchMm
  const xc = wedge.offsetXMm + s * Math.cos(a)
  const zc = wedge.heightMm + s * Math.sin(a)
  const sinB = (wedge.velocityMps / beam.lawVelocityMps) * Math.sin(beam.angleDeg * DEG)
  if (!(Math.abs(sinB) < 1)) return Number.NaN
  return xc + zc * Math.tan(Math.asin(sinB))
}

/** 프레임 묶음을 차례로 넘겨 받아 누적하는 점검기 */
export class SelfCheckAccumulator {
  private readonly windows: GateWindow[]
  private matched = 0
  private total = 0
  private within1 = 0
  private insideMatched = 0
  private insideTotal = 0
  private unexplained = 0
  private strongMatched = 0
  private strongTotal = 0
  private emptyFrames = 0
  private suspectFrames = 0
  private saturated = 0

  constructor(private readonly file: OpdFile) {
    this.windows = file.beams.map((b) => gateSampleWindow(b, GATE_A, file.raster.samples))
  }

  /** raster = [count, 빔, 샘플], gates = [count, 빔, 게이트 3, 12 B] */
  addFrames(raster: Uint8Array, gates: Uint8Array, count: number): void {
    const { beams, samples } = this.file.raster
    const frame = beams * samples
    const gFrame = beams * OPD_GATE_COUNT * OPD_GATE_RECORD_BYTES
    for (let f = 0; f < count; f++) {
      const base = f * frame
      let any = false
      for (let i = base; i < base + frame; i++) {
        const v = raster[i]!
        if (v !== 0) any = true
        if (v === 255) this.saturated++
      }
      if (!any) {
        this.emptyFrames++
        const g0 = f * gFrame
        for (let i = g0; i < g0 + gFrame; i++) {
          if (gates[i] !== 0) {
            this.suspectFrames++
            break
          }
        }
        continue
      }
      for (let b = 0; b < beams; b++) {
        const w = this.windows[b]!
        let m = -1
        const row = base + b * samples
        for (let s = w.lo; s <= w.hi; s++) {
          const v = raster[row + s]!
          if (v > m) m = v
        }
        const stored = gates[f * gFrame + (b * OPD_GATE_COUNT + GATE_A) * OPD_GATE_RECORD_BYTES + GATE_PEAK_BYTE]!
        this.total++
        if (m === stored) this.matched++
        if (m >= 0 && Math.abs(m - stored) <= 1) this.within1++
        if (stored < m) this.unexplained++
        if (m >= SELF_CHECK_LIMITS.strongRaw) {
          this.strongTotal++
          if (m === stored) this.strongMatched++
        }
        if (w.inside) {
          this.insideTotal++
          if (m === stored) this.insideMatched++
        }
      }
    }
  }

  finish(elapsedMs: number): OpdSelfCheck {
    const { file } = this
    const notes: string[] = []
    const L = SELF_CHECK_LIMITS
    const rate = this.total ? this.matched / this.total : 0
    const insideRate = this.insideTotal ? this.insideMatched / this.insideTotal : null
    const unexplainedRate = this.total ? this.unexplained / this.total : 0
    const strongRate = this.strongTotal ? this.strongMatched / this.strongTotal : null
    const pct = (x: number): string => `${(x * 100).toFixed(1)} %`
    let gateAPass: boolean | null = null
    if (unexplainedRate > L.gateAUnexplainedRate) {
      notes.push(`래스터에서 다시 계산한 게이트 A 가 장비 저장 값보다 큰 칸이 ${pct(unexplainedRate)} 입니다(기준 10 %). 래스터 배치가 맞지 않을 수 있습니다.`)
    }
    if (insideRate === null) {
      notes.push(`게이트 A 가 저장 구간 안에 다 들어오는 칸이 없어 일치율을 판정하지 못했습니다(전체 칸 일치 ${pct(rate)}). 판단.md 3.2 기준이라 대조 전으로 둡니다.`)
    } else {
      const insideOk = insideRate >= L.gateAInsideRate
      const allOk = rate >= L.gateAAllRate
      gateAPass = insideOk && allOk && unexplainedRate <= L.gateAUnexplainedRate
      if (!insideOk) notes.push(`게이트 A 재계산이 장비 저장 값과 ${pct(insideRate)} 만 일치합니다(저장 구간 안 칸, 기준 95 %).`)
      else if (!allOk) {
        notes.push(`저장 구간 밖까지 포함한 게이트 A 전체 칸 일치율이 ${pct(rate)} 입니다(기준 95 %). 원인(게이트가 저장 구간보다 넓음 또는 읽기 문제)을 가르기 전에는 대조 전으로 둡니다.`)
      }
    }
    if (strongRate !== null && strongRate < L.strongRate) {
      notes.push(`센 신호(raw ≥ ${L.strongRaw}) 칸은 ${pct(strongRate)} 만 일치합니다(${this.strongTotal}칸). 포화 근처 진폭은 근거가 약합니다(원인 모름 — 캡처 O2 로 확인).`)
    }
    if (this.suspectFrames > 0) {
      notes.push(`래스터가 모두 0 인데 장비 게이트 결과가 남아 있는 프레임이 ${this.suspectFrames}개 있습니다. 사본 손상이 의심됩니다.`)
    }

    let snell: OpdSelfCheck['snell'] = null
    let snellPass: boolean | null = null
    if (file.raster.twoAxis) {
      notes.push('2축(부식) 파일은 출사점 기준이 달라 스넬 점검을 하지 않았습니다.')
    } else {
      const perBeamDiffMm = file.beams.map((b) => Math.abs(snellExitXMm(file, b) - b.exitXMm))
      const maxDiffMm = perBeamDiffMm.some((d) => !Number.isFinite(d)) ? Number.POSITIVE_INFINITY : Math.max(...perBeamDiffMm)
      snell = { maxDiffMm, perBeamDiffMm }
      snellPass = maxDiffMm <= SELF_CHECK_LIMITS.snellMaxDiffMm
      if (!snellPass) notes.push(`출사점이 스넬 계산과 최대 ${Number.isFinite(maxDiffMm) ? maxDiffMm.toFixed(3) : '∞'} mm 다릅니다(기준 0.05 mm).`)
    }

    let thickness: OpdSelfCheck['thickness'] = null
    let thicknessPass: boolean | null = null
    const s = file.setup
    if (s.weld) {
      const weldHeightMm = s.weld.hotPass.heightMm + s.weld.land.heightMm + s.weld.root.heightMm
      const residual = s.thicknessMm - weldHeightMm
      const mismatch = residual < -SELF_CHECK_LIMITS.thicknessTolMm
      thickness = { thicknessMm: s.thicknessMm, weldHeightMm, mismatch }
      thicknessPass = residual > SELF_CHECK_LIMITS.thicknessTolMm ? null : !mismatch
      if (mismatch) notes.push(`두께 칸(${fmt(s.thicknessMm)} mm)이 Hot Pass + Land + Root(${fmt(weldHeightMm)} mm)와 다릅니다.`)
      else if (thicknessPass === null) notes.push(`남은 높이 ${fmt(residual)} mm는 Fill 높이 계산값입니다. Fill 각도를 해독하지 못해 용접 높이로 두께를 판정하지 않았습니다.`)
    }
    if (this.emptyFrames > this.suspectFrames) {
      notes.push(`빈 프레임(모두 0) ${this.emptyFrames - this.suspectFrames}개가 있습니다(스캔을 끝까지 못 갔을 수 있음).`)
    }

    return {
      gateA: {
        matched: this.matched,
        total: this.total,
        rate,
        within1: this.total ? this.within1 / this.total : 0,
        insideMatched: this.insideMatched,
        insideTotal: this.insideTotal,
        insideRate,
        unexplained: this.unexplained,
        unexplainedRate,
        strongMatched: this.strongMatched,
        strongTotal: this.strongTotal,
        strongRate
      },
      snell,
      thickness,
      emptyFrames: this.emptyFrames,
      suspectFrames: this.suspectFrames,
      saturatedSamples: this.saturated,
      passed: { gateA: gateAPass, snell: snellPass, thickness: thicknessPass },
      notes,
      elapsedMs
    }
  }
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100)
}
