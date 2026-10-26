/**
 * 빔(집속법칙) 기록.
 *
 * 탐촉자·웨지 문자열 뒤에 '빔 이름 목록'(그룹 이름 10개 묶음 × (빔 수 − 1))이 오고, 그 뒤 빔 기록이 빔 수만큼 이어진다.
 *   빔 기록 = 앞 블록 0x38 B + 이름 'A:45.00 Sk:090 L:001'(UTF-16, 0 끝) + 본문
 *   본문(R = 이름 끝):
 *     R+0x00 굴절각 · +0x10 집속 · +0x18 출사점 X · +0x28 법칙 음속 · +0x30 웨지 지연 · +0x38 이득 보정(?)
 *     R+0x40 + 0x40·k 소자 칸 (u16 번호 · +0x08 송신 지연 · +0x18 u32 1 · +0x20 u16 번호 · +0x28 수신 지연 · +0x30 펄스 폭)
 *     R+0x768 A-scan 시작 · +0x770 범위
 *     R+0x798 'FblUT_TCGPoint_GROUP' × n → TCG 점 (n+1) × (시각, dB) → 0x60 B → 게이트 I·A·B × (시작, 폭)
 * 알려진 배치는 n = 3 (TCG 4점, 본문 0x8E6 B)과 n = 0 (TCG 없음, 0x838 B) 둘뿐이다. 다른 배치는 해석 실패로 둔다.
 */
import type { ByteView } from './bytes'
import { structureFail } from './errors'
import { expectUtf16zSeq, hasUtf16z, readUtf16z } from './strings'
import { OPD_SAMPLES, type OpdBeam, type OpdGateSetting, type OpdTcgPoint } from './types'

/** 빔 이름 목록 한 묶음 (FblUT_* 그룹 이름) */
export const BEAM_POOL_NAMES = [
  'FblUT_Context_GROUP',
  'FblUT_Beam_GROUP',
  'FblUT_Ascan_GROUP',
  'FblUT_TCG_GROUP',
  'FblUT_TCGPoint_GROUP',
  'DGSCalibration_Group',
  'DGS_Group',
  'FblUT_Gate_GROUP',
  'FblUT_Gate_GROUP',
  'FblUT_Gate_GROUP'
] as const

/** 빔 이름 앞 블록 길이 (빔 이름 목록 끝 → 첫 이름, 게이트 끝 → 다음 이름) */
export const BEAM_PRE_BYTES = 0x38
const TCG_POINT_NAME = 'FblUT_TCGPoint_GROUP'
/** 알려진 TCG 이름 개수 (= 점 수 − 1) → 본문 길이(이름 끝 → 게이트 끝) */
export const KNOWN_TCG_LAYOUTS: ReadonlyMap<number, number> = new Map([
  [3, 0x8e6],
  [0, 0x838]
])
const NAME_RE = /^A:(-?\d+\.\d{2}) Sk:(\d{3}) L:(\d{3})$/
const MAX_BEAMS = 1024
/** 소자 칸 최대 수 (R+0x40 ~ R+0x740) [추정 — 162개 모두 16칸만 씀, 나머지는 0] */
const MAX_ELEMENT_SLOTS = 28
const ELEMENT_SLOT = 0x40

const R = {
  angle: 0x00,
  focus: 0x10,
  exitX: 0x18,
  lawVelocity: 0x28,
  wedgeDelay: 0x30,
  gainOffset: 0x38,
  elements: 0x40,
  t0: 0x768,
  range: 0x770,
  tcg: 0x798
} as const
const TCG_TO_GATES = 0x60
const GATE_NAMES = ['I', 'A', 'B'] as const

export interface BeamPool {
  blocks: number
  end: number
}

/** 빔 이름 목록 묶음 수 (빔 수 − 1 이어야 한다) */
export function readBeamPool(view: ByteView, start: number): BeamPool {
  let p = start
  let blocks = 0
  while (hasUtf16z(view, p, BEAM_POOL_NAMES[0])) {
    p = expectUtf16zSeq(view, p, BEAM_POOL_NAMES, 'beam-pool', '빔 이름 목록')
    blocks++
    if (blocks > MAX_BEAMS) structureFail('beam-pool', '빔 이름 목록이 너무 깁니다.')
  }
  return { blocks, end: p }
}

export interface BeamRecords {
  beams: OpdBeam[]
  /** 마지막 빔 게이트 끝 */
  end: number
  /** 빔 이름 위치 (이름 → 다음 이름 간격 = 빔 기록 길이) */
  namePositions: number[]
}

/** 빔 기록을 차례로 읽는다. 이름의 L 번호가 1부터 이어지는 동안 */
export function readBeamRecords(view: ByteView, poolEnd: number, groupSkewDeg: number): BeamRecords {
  const beams: OpdBeam[] = []
  const namePositions: number[] = []
  let pre = poolEnd
  for (let k = 0; k < MAX_BEAMS; k++) {
    const namePos = pre + BEAM_PRE_BYTES
    const name = peekBeamName(view, namePos, k + 1)
    if (!name) break
    const beam = readBeamBody(view, k, name.text, name.end, Number(name.angle), Number(name.skew))
    if (Math.abs(Number(name.skew) - groupSkewDeg) > 0.5) {
      structureFail('beam-records', '빔 이름의 스큐가 그룹 스큐와 다릅니다.', `${name.text} vs ${groupSkewDeg}`)
    }
    namePositions.push(namePos)
    beams.push(beam.beam)
    pre = beam.end
  }
  if (beams.length === 0) structureFail('beam-records', '빔 기록을 찾지 못했습니다.', `expected 'A:… L:001' at 0x${(poolEnd + BEAM_PRE_BYTES).toString(16)}`)
  return { beams, end: pre, namePositions }
}

interface PeekName {
  text: string
  end: number
  angle: string
  skew: string
}

/** namePos 에 L 번호가 expectedL 인 빔 이름이 있으면 돌려준다. 'A:' 로 시작하지 않으면 null (빔 끝) */
function peekBeamName(view: ByteView, namePos: number, expectedL: number): PeekName | null {
  if (namePos + 4 > view.fileSize) return null
  if (view.u16(namePos) !== 0x41 || view.u16(namePos + 2) !== 0x3a) return null // 'A:'
  const s = readUtf16z(view, namePos, 'beam-records', '빔 이름', 64)
  const m = NAME_RE.exec(s.text)
  if (!m) structureFail('beam-records', '빔 이름 모양이 예상과 다릅니다.', `'${s.text}' at 0x${namePos.toString(16)}`)
  if (Number(m[3]) !== expectedL) structureFail('beam-records', '빔 이름 순서가 맞지 않습니다.', `'${s.text}' expected L:${expectedL}`)
  return { text: s.text, end: s.end, angle: m[1]!, skew: m[2]! }
}

function readBeamBody(
  view: ByteView,
  index: number,
  name: string,
  r: number,
  nameAngle: number,
  nameSkew: number
): { beam: OpdBeam; end: number } {
  const angle = view.f64(r + R.angle)
  const focus = view.f64(r + R.focus)
  const exitX = view.f64(r + R.exitX)
  const lawVelocity = view.f64(r + R.lawVelocity)
  const wedgeDelay = view.f64(r + R.wedgeDelay)
  const gainOffset = view.f64(r + R.gainOffset)
  const t0 = view.f64(r + R.t0)
  const range = view.f64(r + R.range)
  const bad: string[] = []
  if (!(Math.abs(angle) <= 90) || Math.abs(angle - nameAngle) > 0.0051) bad.push(`angle=${angle} name=${nameAngle}`)
  if (!(Math.abs(exitX) <= 1)) bad.push(`exitX=${exitX}`)
  if (!(lawVelocity >= 500 && lawVelocity <= 15000)) bad.push(`lawVelocity=${lawVelocity}`)
  if (!(wedgeDelay >= 0 && wedgeDelay < 1e-3)) bad.push(`wedgeDelay=${wedgeDelay}`)
  if (!(Math.abs(t0) < 1e-3)) bad.push(`t0=${t0}`)
  if (!(range > 0 && range < 1e-2)) bad.push(`range=${range}`)
  if (!Number.isFinite(focus) || !Number.isFinite(gainOffset)) bad.push(`focus=${focus} gain=${gainOffset}`)
  if (bad.length) structureFail('beam-values', '빔 기록 값이 범위를 벗어났습니다.', `${name}: ${bad.join(', ')}`)

  const elements = readElementSlots(view, r, name)

  // TCG 이름 개수 → 점 → 게이트
  let p = r + R.tcg
  let n = 0
  while (hasUtf16z(view, p, TCG_POINT_NAME)) {
    p += (TCG_POINT_NAME.length + 1) * 2
    n++
    if (n > 64) break
  }
  const bodyLen = KNOWN_TCG_LAYOUTS.get(n)
  if (bodyLen === undefined) {
    structureFail('beam-layout', `빔 기록 뒤쪽 배치(TCG 이름 ${n}개)가 알려진 형태가 아닙니다.`, `${name} at 0x${r.toString(16)}`)
  }
  const tcg: OpdTcgPoint[] = []
  let prevT = 0
  for (let k = 0; k <= n; k++) {
    const t = view.f64(p + 16 * k)
    const db = view.f64(p + 16 * k + 8)
    // 첫 점은 시각 0, 그 뒤는 늘어나는 시각
    if (!Number.isFinite(t) || !Number.isFinite(db) || (k === 0 ? t !== 0 : t < prevT) || t > 1e-2) {
      structureFail('beam-layout', 'TCG 점 값이 맞지 않습니다.', `${name} point ${k}: t=${t} dB=${db}`)
    }
    prevT = t
    tcg.push({ timeUs: t * 1e6, gainDb: db })
  }
  const g = p + 16 * (n + 1) + TCG_TO_GATES
  if (g + 16 * GATE_NAMES.length - r !== bodyLen) structureFail('beam-layout', '빔 기록 길이가 맞지 않습니다.', `${name}`)
  const gates: OpdGateSetting[] = GATE_NAMES.map((gn, k) => {
    const start = view.f64(g + 16 * k)
    const width = view.f64(g + 16 * k + 8)
    if (!(Math.abs(start) < 1e-2) || !(width >= 0 && width < 1e-2)) {
      structureFail('beam-layout', '게이트 값이 범위를 벗어났습니다.', `${name} gate ${gn}: start=${start} width=${width}`)
    }
    return { name: gn, startDepthUs: start * 1e6, widthDepthUs: width * 1e6, thresholdPct: null }
  })
  const beam: OpdBeam = {
    index,
    name,
    recordOffset: r,
    angleDeg: angle,
    skewDeg: nameSkew,
    focusMm: focus * 1000,
    exitXMm: exitX * 1000,
    lawVelocityMps: lawVelocity,
    wedgeDelayUs: wedgeDelay * 1e6,
    gainOffsetDb: gainOffset,
    firstElement: elements.first,
    elementCount: elements.count,
    t0Us: t0 * 1e6,
    rangeUs: range * 1e6,
    sampleIntervalUs: (range * 1e6) / OPD_SAMPLES,
    tcg,
    gates
  }
  return { beam, end: g + 16 * GATE_NAMES.length }
}

/** 소자 칸: 앞에서부터 이어서 쓰고(u32 +0x18 = 1, 펄스 폭 > 0), 번호가 1씩 늘고, 나머지 칸은 모두 0 */
function readElementSlots(view: ByteView, r: number, name: string): { first: number; count: number } {
  let count = 0
  let first = -1
  for (let k = 0; k < MAX_ELEMENT_SLOTS; k++) {
    const s = r + R.elements + ELEMENT_SLOT * k
    const used = view.u32(s + 0x18) === 1 && view.f64(s + 0x30) > 0
    if (!used) {
      if (!view.isZero(s, ELEMENT_SLOT)) structureFail('beam-values', '소자 칸 구조가 예상과 다릅니다.', `${name} slot ${k}`)
      continue
    }
    if (count !== k) structureFail('beam-values', '소자 칸이 이어져 있지 않습니다.', `${name} slot ${k}`)
    const el = view.u16(s)
    const elRx = view.u16(s + 0x20)
    if (k === 0) first = el
    if (el !== first + k || elRx !== el) structureFail('beam-values', '소자 번호가 이어지지 않습니다.', `${name} slot ${k}: ${el}/${elRx}`)
    count++
  }
  if (count === 0) structureFail('beam-values', '빔 기록에 소자가 없습니다.', name)
  return { first, count }
}
