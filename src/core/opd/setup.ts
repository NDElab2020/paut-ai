/**
 * 일반 정보(저장 시각·모듈·MXU·보고서 칸)와 그룹 셋업(앵커 A 기준 칸)·탐촉자·웨지.
 * 앞쪽은 문자열을 차례로 따라 읽는다: 모듈 → MXU → 보고서 칸 이름·값 7쌍 → 고정 0x270 B → 집속법칙 파일 → 그룹 이름.
 * 앵커 A = 그룹 이름 끝 + 0x328 (162개 모두 절대 0x30F4 — 보고서 값이 모두 기본값 'Name' 이고 그룹 이름이 'PA 1').
 * 보고서 값이나 그룹 이름 길이가 다른 파일은 아직 보지 못했다. 그런 파일도 같은 규칙으로 따라 읽되 경고를 붙이고,
 * 계산한 앵커를 그대로 믿지 않고 셋업 값 범위·탐촉자 문자열 두 벌·빔 이름 목록·각도 블록 ↔ 빔 이름(parse.ts)으로 확인한다.
 * 탐촉자·웨지는 문자열 길이에 따라 뒤가 밀리므로 문자열 끝을 기준으로 따라간다.
 * 근거: 우리 파일 162개 바이트(보고서 칸 이름 순서·0x270 간격·그룹 이름 끝 ↔ 앵커 간격이 모두 같음 — 2026-10-07 전수 확인)
 */
import type { ByteView } from './bytes'
import { structureFail } from './errors'
import { parseMxuVersion, readUtf16z } from './strings'
import type { OpdProbe, OpdWedge } from './types'

/** 기본 앵커 [확인: 162개 모두 절대 0x30F4]. 실제 읽기는 그룹 이름 끝 + 0x328 로 계산한 값을 쓴다 */
export const OPD_ANCHOR = 0x30f4
/** 저장 시각 OLE DATE [확인] */
const SAVED_AT = 0x2a1a
/** 장비 모듈 문자열 (바로 뒤 MXU 버전) [확인] */
const MODULE_STRING = 0x2a22
/** 일반 정보(보고서) 칸 이름 — 이름 다음 문자열이 그 값(162개 모두 기본값 'Name') */
export const REPORT_INFO_LABELS = ['Contractor', 'Technician', 'Customer', 'Project', 'Site', 'Part Number', 'Procedure'] as const
/** 보고서 값 기본값 */
export const REPORT_INFO_DEFAULT = 'Name'
/** 보고서 칸 끝 → 집속법칙 파일 문자열 [확인 162/162] */
const REPORT_TO_LAW = 0x270
/** 그룹 이름 끝 → 앵커 [확인 162/162] */
const GROUP_NAME_TO_ANCHOR = 0x328
/** 계산한 앵커가 이 범위 밖이면 셋업으로 보지 않는다 (넓게) */
const ANCHOR_MIN = 0x2c00
const ANCHOR_MAX = 0x40000
/** 탐촉자 블록 = 앵커 + 0xB8 (첫 탐촉자 시리얼 문자열) */
const PROBE_BLOCK = 0xb8
/** 탐촉자 모델 문자열 끝 → 문자열 두 개('Undefined') 시작 */
const MODEL_TO_STRINGS = 0xc8
/** 첫 탐촉자 블록 문자열 두 개 끝 → 두 번째 탐촉자 시리얼 */
const BLOCK1_TAIL = 0x40
/** 웨지 값 (두 번째 블록 문자열 두 개 끝 기준) — 모델 끝 기준으로는 +0xF0/+0x100/+0x118/+0x120 */
const WEDGE_VELOCITY = 0x00
const WEDGE_OFFSET_X = 0x10
const WEDGE_HEIGHT = 0x28
const WEDGE_ANGLE = 0x30
const WEDGE_MODEL = 0x38
/** 웨지 모델 두 벌 끝 → 다음 두 벌 */
const WEDGE_PAIR_GAP = 0x40
/** 웨지 모델 네 번째 끝 → 빔 이름 목록(beam pool) */
export const WEDGE_TO_POOL = 0x08

/** 확인하지 못한 배치(보고서 칸이 채워졌거나 그룹 이름이 기본값이 아님)일 때 오류 문구 뒤에 붙이는 안내 */
export const UNTESTED_LAYOUT_HINT = '보고서 정보 칸(Contractor 등)을 채웠거나 그룹 이름·집속법칙 파일을 바꿔 저장한 OPD 는 아직 시험하지 못했습니다.'

/** 셋업 칸 (앵커 기준 바이트, SI double) */
export const SETUP_FIELDS = {
  angleStart: 0x00,
  angleStop: 0x08,
  angleStep: 0x10,
  focusDepth: 0x18,
  filterLow: 0x68,
  filterHigh: 0x70,
  frequency: 0x78,
  pitch: 0x88,
  scanLength: -0x5a8,
  scanResolution: -0x30,
  indexResolution: -0x10,
  indexLength: -0x590,
  indexStep: -0x588,
  thickness: -0x510,
  weldLandOffset: -0x508,
  weldHotPass: -0x4d8,
  weldLand: -0x4d0,
  weldRoot: -0x4c8,
  weldHotPassAngle: -0x4c0,
  weldRootAngle: -0x4b8,
  indexOffset: -0x3f0,
  skew: -0x3e8,
  velocity: -0x3e0,
  gain: -0x3c8,
  referenceAmplitude: -0x3c0,
  referenceGain: -0x3b8,
  pulseWidth: -0x378,
  cursorScan: -0x320
} as const

export type SetupField = keyof typeof SETUP_FIELDS

/** 'A-0x510' 꼴 칸 이름 */
export function fieldLabel(rel: number): string {
  return rel < 0 ? `A-0x${(-rel).toString(16)}` : `A+0x${rel.toString(16)}`
}

export interface GeneralInfo {
  savedAtOle: number
  module: string
  mxuVersion: string
  mxu: ReturnType<typeof parseMxuVersion>
  lawFile: string
  groupName: string
  reportInfo: Array<{ label: string; value: string }>
  /** 계산한 앵커 A (그룹 이름 끝 + 0x328) */
  anchor: number
  /** 162개와 다른 배치인가 (보고서 값이 기본값이 아님·앵커가 0x30F4 가 아님) — 경고·오류 안내용 */
  untested: boolean
}

export function readGeneralInfo(view: ByteView): GeneralInfo {
  const savedAtOle = view.f64(SAVED_AT)
  const module = readUtf16z(view, MODULE_STRING, 'general-info', '장비 모듈')
  const mxu = readUtf16z(view, module.end, 'general-info', 'MXU 버전')
  if (!module.text.trim() || !/^MXU\b/.test(mxu.text)) {
    structureFail('general-info', '장비 모듈·MXU 버전 문자열 위치가 예상과 다릅니다.', `module='${module.text}' mxu='${mxu.text}'`)
  }
  // 바로 뒤 보고서 칸: 이름(Contractor …) 다음 값 문자열. 이름은 정해진 순서여야 하고, 값은 무엇이든 받는다
  let p = mxu.end
  const reportInfo: Array<{ label: string; value: string }> = []
  for (const label of REPORT_INFO_LABELS) {
    const name = readUtf16z(view, p, 'general-info', '보고서 정보 칸 이름')
    if (name.text !== label) {
      structureFail('general-info', '일반 정보(보고서 칸) 구조가 예상과 다릅니다.', `expected '${label}' got '${name.text}' at 0x${p.toString(16)}`)
    }
    const value = readUtf16z(view, name.end, 'general-info', '보고서 정보 값', 256)
    reportInfo.push({ label, value: value.text })
    p = value.end
  }
  const filled = reportInfo.some((r) => r.value !== REPORT_INFO_DEFAULT)
  const hint = filled ? ` ${UNTESTED_LAYOUT_HINT}` : ''
  const law = readUtf16z(view, p + REPORT_TO_LAW, 'anchor', '집속법칙 파일')
  const group = readUtf16z(view, law.end, 'anchor', '그룹 이름', 128)
  const anchor = group.end + GROUP_NAME_TO_ANCHOR
  if (!group.text.trim() || anchor < ANCHOR_MIN || anchor > ANCHOR_MAX) {
    structureFail('anchor', `셋업 위치(그룹 이름)가 예상과 다릅니다.${hint}`, `group='${group.text}' end=0x${group.end.toString(16)}`)
  }
  return {
    savedAtOle,
    module: module.text,
    mxuVersion: mxu.text,
    mxu: parseMxuVersion(mxu.text),
    lawFile: law.text,
    groupName: group.text,
    reportInfo,
    anchor,
    untested: filled || anchor !== OPD_ANCHOR
  }
}

/** 앵커 기준 셋업 칸 전부 (SI 날 값) */
export function readSetupRaw(view: ByteView, anchor: number): Record<SetupField, number> {
  const out = {} as Record<SetupField, number>
  for (const [k, rel] of Object.entries(SETUP_FIELDS) as Array<[SetupField, number]>) {
    const v = view.f64(anchor + rel)
    if (!Number.isFinite(v)) structureFail('setup-values', '셋업 값을 읽지 못했습니다.', `${k} ${fieldLabel(rel)} = ${v}`)
    out[k] = v
  }
  return out
}

/** 값 범위 점검 (명백히 셋업 칸이 아닌 곳을 읽었을 때 멈추기 위한 넓은 범위). untested 면 오류 문구에 안내를 붙인다 */
export function checkSetupRanges(r: Record<SetupField, number>, untested = false): void {
  const bad: string[] = []
  const inRange = (k: SetupField, lo: number, hi: number): void => {
    const v = r[k]
    if (!(v >= lo && v <= hi)) bad.push(`${k}=${v}`)
  }
  inRange('thickness', 1e-4, 1)
  for (const k of ['weldHotPass', 'weldLand', 'weldRoot'] as const) inRange(k, 0, 1)
  inRange('weldLandOffset', -1, 1)
  inRange('weldHotPassAngle', 0, 90)
  inRange('weldRootAngle', 0, 90)
  inRange('velocity', 500, 15000)
  inRange('scanResolution', 1e-6, 1)
  inRange('scanLength', 1e-6, 100)
  inRange('indexResolution', 1e-6, 1)
  inRange('angleStart', -90, 90)
  inRange('angleStop', -90, 90)
  inRange('angleStep', 1e-3, 90)
  inRange('frequency', 1e4, 1e9)
  inRange('pitch', 1e-6, 0.1)
  inRange('skew', 0, 360)
  inRange('gain', -100, 200)
  inRange('referenceGain', -100, 200)
  inRange('referenceAmplitude', 0, 1000)
  inRange('indexOffset', -10, 10)
  if (bad.length) structureFail('setup-values', `셋업 값이 범위를 벗어났습니다(셋업 위치가 다른 파일).${untested ? ` ${UNTESTED_LAYOUT_HINT}` : ''}`, bad.join(', '))
}

export interface ProbeWedge {
  probe: Omit<OpdProbe, 'centralFrequencyMHz' | 'pitchMm' | 'elementCount'>
  wedge: OpdWedge
  /** 웨지 문자열 네 벌이 끝난 위치 */
  end: number
}

const MODEL_COUNT_RE = /^\d+(?:\.\d+)?L(\d+)\b/i

/**
 * 탐촉자·웨지 블록:
 *   [시리얼][모델] +0xC8 [문자열][문자열] +0x40 [시리얼][모델] +0xC8 [문자열][문자열]
 *   웨지 음속 +0 · 오프셋 X +0x10 · 높이 +0x28 · 각 +0x30 · [웨지 모델][웨지 모델] +0x40 [웨지 모델][웨지 모델]
 * 두 탐촉자 블록의 시리얼·모델은 같아야 한다(펄스에코 1탐촉자).
 */
export function readProbeWedge(view: ByteView, anchor: number): ProbeWedge {
  const s1 = readUtf16z(view, anchor + PROBE_BLOCK, 'probe-strings', '탐촉자 시리얼')
  const m1 = readUtf16z(view, s1.end, 'probe-strings', '탐촉자 모델')
  const u1 = readUtf16z(view, m1.end + MODEL_TO_STRINGS, 'probe-strings', '탐촉자')
  const u2 = readUtf16z(view, u1.end, 'probe-strings', '탐촉자')
  const s2 = readUtf16z(view, u2.end + BLOCK1_TAIL, 'probe-strings', '탐촉자 시리얼')
  const m2 = readUtf16z(view, s2.end, 'probe-strings', '탐촉자 모델')
  if (!s1.text.trim() || !m1.text.trim() || s1.text !== s2.text || m1.text !== m2.text) {
    structureFail('probe-strings', '탐촉자 문자열 두 벌이 예상과 다릅니다.', `'${s1.text}'/'${m1.text}' vs '${s2.text}'/'${m2.text}'`)
  }
  const v1 = readUtf16z(view, m2.end + MODEL_TO_STRINGS, 'probe-strings', '웨지')
  const v2 = readUtf16z(view, v1.end, 'probe-strings', '웨지')
  const w = v2.end
  const wedgeVelocity = view.f64(w + WEDGE_VELOCITY)
  const offsetX = view.f64(w + WEDGE_OFFSET_X)
  const height = view.f64(w + WEDGE_HEIGHT)
  const angle = view.f64(w + WEDGE_ANGLE)
  const wm1 = readUtf16z(view, w + WEDGE_MODEL, 'probe-strings', '웨지 모델')
  const wm2 = readUtf16z(view, wm1.end, 'probe-strings', '웨지 모델')
  const wm3 = readUtf16z(view, wm2.end + WEDGE_PAIR_GAP, 'probe-strings', '웨지 모델')
  const wm4 = readUtf16z(view, wm3.end, 'probe-strings', '웨지 모델')
  const bad: string[] = []
  if (!(wedgeVelocity >= 500 && wedgeVelocity <= 15000)) bad.push(`velocity=${wedgeVelocity}`)
  if (!(Math.abs(offsetX) <= 1)) bad.push(`offsetX=${offsetX}`)
  if (!(height >= 0 && height <= 1)) bad.push(`height=${height}`)
  if (!(angle >= 0 && angle < 90)) bad.push(`angle=${angle}`)
  if (!wm1.text.trim()) bad.push('model empty')
  if (bad.length) structureFail('probe-strings', '웨지 값이 범위를 벗어났습니다(웨지 위치가 다른 파일).', bad.join(', '))
  const count = MODEL_COUNT_RE.exec(m1.text.trim())
  return {
    probe: {
      serial: s1.text,
      model: m1.text.trim(),
      modelRaw: m1.text,
      elementCountFromModel: count ? Number(count[1]) : null
    },
    wedge: {
      model: wm1.text.trim(),
      modelStrings: [wm1.text, wm2.text, wm3.text, wm4.text],
      velocityMps: wedgeVelocity,
      offsetXMm: offsetX * 1000,
      heightMm: height * 1000,
      angleDeg: angle
    },
    end: wm4.end
  }
}
