/**
 * 게이트 창과 게이트 안 최대값 (A%, C-scan).
 * 게이트 시각은 빔 시간(출사점 기준)과 같은 기준이다. 창 = [round((start−t0)/Δt), round((start+len−t0)/Δt)] (양 끝 포함).
 * 이 규칙으로 X3 12T-SV-01 스캔 39칸·54°의 게이트 A 최대가 1.60 % 로 OmniPC A% 1.6 과 같다.
 */
import { DEG, samplePoint, soundPathMm, sampleTimeUs, timeForSoundPathUs } from './coords'
import { rawToPercent } from './palette'
import type { ViewerGate, ViewerGroup } from './types'

type GroupGeom = Pick<ViewerGroup, 'beams' | 'ultrasound'>

/** 빔 b 에서 게이트가 덮는 샘플 [start, end) — 비어 있으면 start === end */
export function gateSampleWindow(group: GroupGeom, gate: ViewerGate, b: number): [number, number] {
  const beam = group.beams[b]
  const st = gate.startUs[b] ?? gate.startUs[0]
  const ln = gate.lengthUs[b] ?? gate.lengthUs[0]
  if (!beam || st === undefined || ln === undefined) return [0, 0]
  const res = group.ultrasound.resolutionUs
  const i0 = Math.max(0, Math.round((st - beam.t0Us) / res))
  const i1 = Math.min(group.ultrasound.count, Math.round((st + ln - beam.t0Us) / res) + 1)
  return i1 > i0 ? [i0, i1] : [i0, i0]
}

export function findGate(group: Pick<ViewerGroup, 'gates'>, id: number | null): ViewerGate | null {
  if (id === null) return null
  return group.gates.find((g) => g.id === id) ?? null
}

/** 게이트 C-scan: 스캔×빔 칸마다 게이트 안 최대 raw 와 그 샘플 번호 (-1 = 데이터 없음 또는 빈 창) */
export interface GateCscan {
  gateId: number
  scanCount: number
  beamCount: number
  peakRaw: Int16Array
  peakSample: Int32Array
}

export function createGateCscan(group: Pick<ViewerGroup, 'shape'>, gateId: number): GateCscan {
  const [ns, nb] = group.shape
  return { gateId, scanCount: ns, beamCount: nb, peakRaw: new Int16Array(ns * nb), peakSample: new Int32Array(ns * nb).fill(-1) }
}

/**
 * 진폭 조각(스캔 scanStart 부터 scanCount 칸)으로 C-scan 칸을 채운다.
 * 상태 hasData(비트 1)가 0 인 칸은 데이터 없음으로 둔다.
 */
export function fillGateCscan(
  cs: GateCscan,
  group: GroupGeom & Pick<ViewerGroup, 'shape'>,
  gate: ViewerGate,
  chunk: { scanStart: number; scanCount: number; amplitude: Int16Array; status: Uint8Array | null }
): void {
  const [, nb, nt] = group.shape
  const win: Array<[number, number]> = []
  for (let b = 0; b < nb; b++) win.push(gateSampleWindow(group, gate, b))
  const A = chunk.amplitude
  for (let s = 0; s < chunk.scanCount; s++) {
    const k = chunk.scanStart + s
    if (k < 0 || k >= cs.scanCount) continue
    for (let b = 0; b < nb; b++) {
      const cell = k * nb + b
      const st = chunk.status ? chunk.status[s * nb + b]! : 1
      const [i0, i1] = win[b]!
      if (!(st & 1) || i1 <= i0) {
        cs.peakRaw[cell] = 0
        cs.peakSample[cell] = -1
        continue
      }
      const base = (s * nb + b) * nt
      let m = -32768
      let mi = -1
      for (let i = i0; i < i1; i++) {
        const v = A[base + i]!
        if (v > m) {
          m = v
          mi = i
        }
      }
      cs.peakRaw[cell] = mi < 0 ? 0 : m
      cs.peakSample[cell] = mi
    }
  }
}

export interface GatePeak {
  pct: number
  sample: number
  soundPathMm: number
  /** 펼친 깊이 */
  depthMm: number
  vMm: number
}

/** 칸 (k, b) 의 게이트 최대값 → 측정값 (데이터 없으면 null) */
export function gatePeakAt(cs: GateCscan, group: GroupGeom & Pick<ViewerGroup, 'ampScale'>, k: number, b: number): GatePeak | null {
  if (k < 0 || k >= cs.scanCount || b < 0 || b >= cs.beamCount) return null
  const cell = k * cs.beamCount + b
  const sample = cs.peakSample[cell]!
  const beam = group.beams[b]
  if (sample < 0 || !beam) return null
  const p = samplePoint(beam, sample, group.ultrasound)
  return {
    pct: rawToPercent(cs.peakRaw[cell]!, group.ampScale),
    sample,
    soundPathMm: soundPathMm(beam, sampleTimeUs(beam, sample, group.ultrasound)),
    depthMm: p.depthMm,
    vMm: p.vMm
  }
}

// ──────────────────────────────── 게이트 편집 (후처리) ────────────────────────────────

/** 게이트를 사용자 단위로: TrueDepth 는 깊이 mm(시작·폭), SoundPath 는 음로 mm. 빔 0 기준 역산 */
export interface GateDisplayValues {
  geometry: 'TrueDepth' | 'SoundPath'
  startMm: number
  lengthMm: number
}

export function gateDisplayValues(gate: Pick<ViewerGate, 'geometry' | 'startUs' | 'lengthUs'>, group: GroupGeom): GateDisplayValues {
  const beam = group.beams[0]
  const geometry: GateDisplayValues['geometry'] = gate.geometry === 'TrueDepth' ? 'TrueDepth' : 'SoundPath'
  if (!beam) return { geometry, startMm: 0, lengthMm: 0 }
  const st = gate.startUs[0] ?? 0
  const ln = gate.lengthUs[0] ?? 0
  const r0 = soundPathMm(beam, st)
  const r1 = soundPathMm(beam, st + ln)
  const c = geometry === 'TrueDepth' ? Math.cos(beam.angleDeg * DEG) : 1
  return { geometry, startMm: r0 * c, lengthMm: (r1 - r0) * c }
}

/** 표시값을 다른 형상으로 (빔 0 기준): TrueDepth ↔ SoundPath */
export function convertGateGeometry(v: GateDisplayValues, to: GateDisplayValues['geometry'], group: GroupGeom): GateDisplayValues {
  if (v.geometry === to) return v
  const beam = group.beams[0]
  const c = beam ? Math.cos(beam.angleDeg * DEG) : 1
  const f = to === 'TrueDepth' ? c : 1 / c
  return { geometry: to, startMm: v.startMm * f, lengthMm: v.lengthMm * f }
}

/** 편집에서 받는 값 (shared/imaging/postprocess GateOverride 와 같은 모양) */
export interface GateOverrideLike {
  geometry?: 'TrueDepth' | 'SoundPath'
  startMm?: number
  lengthMm?: number
  thresholdPct?: number
}

/**
 * 게이트에 사용자 override 를 적용한 새 ViewerGate.
 *   - startMm·lengthMm·geometry 가 모두 없으면(문턱만) 파일 startUs/lengthUs 배열을 **참조 그대로** 두고 문턱만 바꾼다
 *     (파일 µs 를 재환산하면 반올림 때문에 창이 한 샘플 밀릴 수 있어 C-scan 이 바뀐다 — 계획 5.2)
 *   - 값 일부만 있으면 빠진 쪽은 파일값을 그 단위로 환산해 채운다
 *   - TrueDepth: 빔마다 r = 깊이 / cosθ_b 로 시간 환산, SoundPath: 음로 그대로. 항상 빔 수만큼의 배열을 내 supported 규칙을 지킨다
 */
export function applyGateOverride(gate: ViewerGate, group: GroupGeom, ov: GateOverrideLike | undefined): ViewerGate {
  if (!ov) return gate
  const fileGeometry: GateDisplayValues['geometry'] = gate.geometry === 'TrueDepth' ? 'TrueDepth' : 'SoundPath'
  const geomChanged = ov.geometry !== undefined && ov.geometry !== fileGeometry
  if (ov.startMm === undefined && ov.lengthMm === undefined && !geomChanged) {
    return ov.thresholdPct === undefined ? gate : { ...gate, thresholdPct: ov.thresholdPct }
  }
  const geometry = ov.geometry ?? fileGeometry
  // 형상을 바꿀 때만 빔 0 기준 표시값을 새 단위로 환산해 모든 빔에 같은 값을 준다 (OmniPC 가 숫자를 다시 해석하는 방식)
  const converted = geomChanged ? convertGateGeometry(gateDisplayValues(gate, group), geometry, group) : null
  const startUs: number[] = []
  const lengthUs: number[] = []
  group.beams.forEach((beam, b) => {
    // 손대지 않은 값은 **그 빔의** 파일 시간에서 (빔 0 기준이 아니라) — 시간 하나로 저장된 게이트(4.x 스칼라)도 다른 빔의 시작이 움직이지 않게
    const st = gate.startUs[b] ?? gate.startUs[0] ?? 0
    const ln = gate.lengthUs[b] ?? gate.lengthUs[0] ?? 0
    const c = geometry === 'TrueDepth' ? Math.cos(beam.angleDeg * DEG) : 1
    const fileR0 = soundPathMm(beam, st)
    const fileR1 = soundPathMm(beam, st + ln)
    const startMm = Math.max(0, ov.startMm ?? converted?.startMm ?? fileR0 * c)
    const lengthMm = Math.max(0, ov.lengthMm ?? converted?.lengthMm ?? (fileR1 - fileR0) * c)
    const r0 = startMm / c
    const r1 = (startMm + lengthMm) / c
    // 시작을 안 바꿨고 형상도 그대로면 파일 시간을 그대로 둔다 (mm → µs 왕복으로 창이 한 샘플 밀리지 않게)
    const t0 = ov.startMm === undefined && !geomChanged ? st : timeForSoundPathUs(beam, r0)
    const t1 = ov.lengthMm === undefined && !geomChanged ? t0 + ln : timeForSoundPathUs(beam, r1)
    startUs.push(t0)
    lengthUs.push(Math.max(0, t1 - t0))
  })
  return { ...gate, geometry, startUs, lengthUs, thresholdPct: ov.thresholdPct ?? gate.thresholdPct }
}

/** 빔별 창 [i0, i1) 을 이어 붙인 문자열 — 같으면 C-scan 이 같다 (문턱은 들어가지 않음). 재계산 캐시 키 */
export function gateWindowSignature(group: GroupGeom, gate: ViewerGate): string {
  const parts: string[] = [String(gate.id)]
  for (let b = 0; b < group.beams.length; b++) {
    const [i0, i1] = gateSampleWindow(group, gate, b)
    parts.push(`${i0}-${i1}`)
  }
  return parts.join('|')
}
