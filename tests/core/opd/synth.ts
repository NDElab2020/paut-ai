/**
 * 시험용 작은 OPD 만들기 (실데이터 없는 PC 에서도 읽기 규칙·점검·오류 경로를 시험하려고).
 * 우리 파일에서 확인한 배치(src/core/opd/README.md 위치표)를 그대로 따른다. 값은 지어낸 것이다.
 * 보고서 칸 값·그룹 이름을 바꾸면 그 뒤가 모두 밀린다(앵커 = 그룹 이름 끝 + 0x328). 기본값이면 앵커는 0x30F4.
 */

export interface SynthOptions {
  beams?: number
  positions?: number
  /** 'sectorial' 이면 각도 45 + k, 'linear' 면 60° 고정·첫 소자 k */
  formation?: 'sectorial' | 'linear'
  /** TCG 이름 개수 (점 수 − 1). 알려진 배치는 3 과 0 */
  tcgNames?: number
  skewDeg?: number
  deviceFileName?: string
  /** 2축이면 스캔 길이를 positions / indexLines 로 적는다 */
  indexLines?: number
  /** 보고서 칸 값 7개 (Contractor·Technician·Customer·Project·Site·Part Number·Procedure). 기본 모두 'Name' */
  reportValues?: string[]
  /** 그룹 이름 (기본 'PA 1') */
  groupName?: string
}

export interface SynthOpd {
  bytes: Uint8Array
  rasterOffset: number
  beamNameOffsets: number[]
  /** 꼬리 색인 위치 */
  indexOffset: number
  /** 셋업 앵커 A */
  anchor: number
  options: Required<SynthOptions>
}

class W {
  buf = new Uint8Array(1 << 20)
  dv = new DataView(this.buf.buffer)
  size = 0
  private grow(end: number): void {
    if (end <= this.buf.length) return
    const n = new Uint8Array(Math.max(end, this.buf.length * 2))
    n.set(this.buf)
    this.buf = n
    this.dv = new DataView(n.buffer)
  }
  f64(p: number, v: number): void {
    this.grow(p + 8)
    this.dv.setFloat64(p, v, true)
    this.size = Math.max(this.size, p + 8)
  }
  u32(p: number, v: number): void {
    this.grow(p + 4)
    this.dv.setUint32(p, v, true)
    this.size = Math.max(this.size, p + 4)
  }
  u16(p: number, v: number): void {
    this.grow(p + 2)
    this.dv.setUint16(p, v, true)
    this.size = Math.max(this.size, p + 2)
  }
  bytes(p: number, b: Uint8Array): number {
    this.grow(p + b.length)
    this.buf.set(b, p)
    this.size = Math.max(this.size, p + b.length)
    return p + b.length
  }
  str(p: number, s: string): number {
    for (let i = 0; i < s.length; i++) this.u16(p + 2 * i, s.charCodeAt(i))
    this.u16(p + 2 * s.length, 0)
    return p + 2 * (s.length + 1)
  }
  strs(p: number, list: readonly string[]): number {
    for (const s of list) p = this.str(p, s)
    return p
  }
}

const POOL = [
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
]
const REPORT_LABELS = ['Contractor', 'Technician', 'Customer', 'Project', 'Site', 'Part Number', 'Procedure']
const reportStrings = (values: readonly string[]): string[] => REPORT_LABELS.flatMap((l, i) => [l, values[i] ?? 'Name'])
const LABELS = reportStrings([])
const MODULE = 'OMNISX-PA1664PR'
const MXU = 'MXU - 4.4R5'
const LAW = '&#&NO_LAW_FILE_LOAD&#&'

/** 게이트·샘플 기하 (시험에서 다시 계산할 때 씀) */
export const SYNTH = {
  t0Us: 10,
  rangeUs: 32,
  velocity: 3240,
  thicknessMm: 12,
  gateA: { startDepthUs: 8, widthDepthUs: 8 },
  pitchMm: 0.5,
  wedge: { velocity: 2330, offsetXMm: -55.52, heightMm: 11, angleDeg: 36.1 }
} as const

/** 진폭 패턴 (위치 p, 빔 b, 샘플 s) — 0 이 아닌 값 */
export function synthSample(p: number, b: number, s: number): number {
  return (p * 7 + b * 13 + s * 3) % 251
}

export function buildSynthOpd(opts: SynthOptions = {}): SynthOpd {
  const o: Required<SynthOptions> = {
    beams: opts.beams ?? 4,
    positions: opts.positions ?? 6,
    formation: opts.formation ?? 'sectorial',
    tcgNames: opts.tcgNames ?? 3,
    skewDeg: opts.skewDeg ?? 90,
    deviceFileName: opts.deviceFileName ?? 'SYN-01-##',
    indexLines: opts.indexLines ?? 1,
    reportValues: opts.reportValues ?? [],
    groupName: opts.groupName ?? 'PA 1'
  }
  const w = new W()
  // 머리
  w.bytes(0, Uint8Array.from([0x44, 0x33, 0x22, 0x11, 0x53, 0x55, 0x52, 0x44]))
  w.dv.setUint32(8, 3, false)
  w.u32(0x10, 8)
  w.u32(0x1c, 4)
  w.str(0x20, 'OMNIFileContent_GROUP')
  // 일반 정보
  w.f64(0x2a1a, 46162.5) // 2026-05-20T12:00:00
  const reportEnd = w.strs(0x2a22, [MODULE, MXU, ...reportStrings(o.reportValues)])
  // 보고서 칸 끝 + 0x270 = 집속법칙 파일 → 그룹 이름, 그룹 이름 끝 + 0x328 = 앵커 (기본값이면 0x30F4)
  const groupEnd = w.str(w.str(reportEnd + 0x270, LAW), o.groupName)
  const ANCHOR = groupEnd + 0x328
  // 셋업 (앵커 기준, SI)
  const angleStart = o.formation === 'sectorial' ? 45 : 60
  const angleStop = o.formation === 'sectorial' ? 45 + (o.beams - 1) : 60
  const scanCount = o.positions / o.indexLines
  const set: Array<[number, number]> = [
    [0x00, angleStart],
    [0x08, angleStop],
    [0x10, 1],
    [0x18, 0.02],
    [0x78, 5e6],
    [0x88, SYNTH.pitchMm / 1000],
    [-0x5a8, scanCount * 0.001],
    [-0x30, 0.001],
    [-0x10, 0.001],
    [-0x590, o.indexLines * 0.001],
    [-0x588, 0.001],
    [-0x510, SYNTH.thicknessMm / 1000],
    [-0x4d8, 0.01],
    [-0x4d0, 0.002],
    [-0x3f0, o.skewDeg === 270 ? 0.014 : -0.014],
    [-0x3e8, o.skewDeg],
    [-0x3e0, SYNTH.velocity],
    [-0x3c8, 30],
    [-0x3c0, 80],
    [-0x3b8, 0],
    [-0x378, 1e-7]
  ]
  for (const [rel, v] of set) w.f64(ANCHOR + rel, v)
  // 탐촉자·웨지
  let p = w.strs(ANCHOR + 0xb8, ['R0001', '5L64-A32 '])
  p = w.strs(p + 0xc8, ['Undefined', 'Undefined'])
  p = w.strs(p + 0x40, ['R0001', '5L64-A32 '])
  p = w.strs(p + 0xc8, ['Undefined', 'Undefined'])
  w.f64(p, SYNTH.wedge.velocity)
  w.f64(p + 0x10, SYNTH.wedge.offsetXMm / 1000)
  w.f64(p + 0x28, SYNTH.wedge.heightMm / 1000)
  w.f64(p + 0x30, SYNTH.wedge.angleDeg)
  p = w.strs(p + 0x38, ['SA32-N55S', 'SA32-N55S'])
  p = w.strs(p + 0x40, ['SA32-N55S', 'SA32-N55S'])
  p += 8
  for (let k = 0; k < o.beams - 1; k++) p = w.strs(p, POOL)
  // 빔 기록
  const beamNameOffsets: number[] = []
  const rad = Math.PI / 180
  for (let k = 0; k < o.beams; k++) {
    const angle = o.formation === 'sectorial' ? 45 + k : 60
    const first = o.formation === 'sectorial' ? 30 : k
    const namePos = p + 0x38
    beamNameOffsets.push(namePos)
    const name = `A:${angle.toFixed(2)} Sk:${String(o.skewDeg).padStart(3, '0')} L:${String(k + 1).padStart(3, '0')}`
    const r = w.str(namePos, name)
    // 출사점 = 스넬 계산값 (자체 점검이 통과하도록)
    const c = first + 7.5
    const s = c * SYNTH.pitchMm
    const a = SYNTH.wedge.angleDeg * rad
    const xc = SYNTH.wedge.offsetXMm + s * Math.cos(a)
    const zc = SYNTH.wedge.heightMm + s * Math.sin(a)
    const sinB = (SYNTH.wedge.velocity / 3240) * Math.sin(angle * rad)
    const exit = xc + zc * Math.tan(Math.asin(sinB))
    w.f64(r, angle)
    w.f64(r + 0x10, 0.02)
    w.f64(r + 0x18, exit / 1000)
    w.f64(r + 0x28, 3240)
    w.f64(r + 0x30, 25e-6)
    w.f64(r + 0x38, 0)
    for (let e = 0; e < 16; e++) {
      const sl = r + 0x40 + 0x40 * e
      w.u16(sl, first + e)
      w.f64(sl + 0x08, 1e-7 * e)
      w.u32(sl + 0x18, 1)
      w.u32(sl + 0x1c, 1)
      w.u16(sl + 0x20, first + e)
      w.f64(sl + 0x28, 1e-7 * e)
      w.f64(sl + 0x30, 1e-7)
      w.u32(sl + 0x38, 1)
    }
    w.f64(r + 0x768, SYNTH.t0Us * 1e-6)
    w.f64(r + 0x770, SYNTH.rangeUs * 1e-6)
    let q = r + 0x798
    for (let n = 0; n < o.tcgNames; n++) q = w.str(q, 'FblUT_TCGPoint_GROUP')
    for (let n = 0; n <= o.tcgNames; n++) {
      w.f64(q + 16 * n, n * 5e-6)
      w.f64(q + 16 * n + 8, n)
    }
    const g = q + 16 * (o.tcgNames + 1) + 0x60
    const gates: Array<[number, number]> = [
      [0.2e-6, 6e-6],
      [SYNTH.gateA.startDepthUs * 1e-6, SYNTH.gateA.widthDepthUs * 1e-6],
      [0.2e-6, 6e-6]
    ]
    gates.forEach(([st, wd], k2) => {
      w.f64(g + 16 * k2, st)
      w.f64(g + 16 * k2 + 8, wd)
    })
    p = g + 0x30
  }
  // 경보 → 장비 저장 이름 → 파일 이름 틀 → 집속법칙 파일
  p = w.strs(p + 0x78, ['Contact', 'Contact'])
  p = w.strs(p + 0x40, ['Alarm_GROUP', 'Alarm_GROUP', 'Alarm_GROUP', 'Alarm_Output_GROUP', 'Alarm_Output_GROUP', 'Alarm_Output_GROUP'])
  p = w.str(p + 0x88, o.deviceFileName)
  p = w.strs(p, ['File####', 'File####', 'File####', 'File####', 'File####', LAW, 'Complete'])
  p = w.strs(p + 0x80, LABELS)
  p = w.strs(p + 0x12, [MODULE, 'QC-000001', 'QC-000001', MXU])
  // 색표 3개 (세 번째 회색조)
  for (let i = 0; i < 256; i++) {
    w.bytes(p + 4 * i, Uint8Array.from([255 - i, i, 128, 0]))
    w.bytes(p + 1024 + 4 * i, Uint8Array.from([i, 0, 0, 0]))
    w.bytes(p + 2048 + 4 * i, Uint8Array.from([i, i, i, 0]))
  }
  const rasterOffset = p + 3072
  // 래스터 + 게이트 결과
  const B = o.beams
  const S = 320
  const raster = new Uint8Array(o.positions * B * S)
  for (let pp = 0; pp < o.positions; pp++) for (let b = 0; b < B; b++) for (let s = 0; s < S; s++) raster[(pp * B + b) * S + s] = synthSample(pp, b, s)
  w.bytes(rasterOffset, raster)
  const gr = rasterOffset + raster.length
  const gates = new Uint8Array(o.positions * B * 3 * 12)
  for (let pp = 0; pp < o.positions; pp++) {
    for (let b = 0; b < B; b++) {
      const angle = o.formation === 'sectorial' ? 45 + b : 60
      const cos = Math.cos(angle * rad)
      const dt = SYNTH.rangeUs / S
      const lo = Math.ceil((SYNTH.gateA.startDepthUs / cos - SYNTH.t0Us) / dt - 1e-6)
      const hi = Math.floor(((SYNTH.gateA.startDepthUs + SYNTH.gateA.widthDepthUs) / cos - SYNTH.t0Us) / dt + 1e-6)
      let m = 0
      for (let s = Math.max(0, lo); s <= Math.min(S - 1, hi); s++) m = Math.max(m, raster[(pp * B + b) * S + s]!)
      gates[((pp * B + b) * 3 + 1) * 12 + 8] = m
      gates[((pp * B + b) * 3 + 1) * 12 + 11] = 0x21
    }
  }
  w.bytes(gr, gates)
  const tail = gr + gates.length + 4928
  // 꼬리 구역 7개 (각 64 B) + 색인 8개
  const offsets = [0x28, ...Array.from({ length: 7 }, (_, i) => tail + 64 * i)]
  const indexOffset = tail + 64 * 7
  offsets.forEach((off, i) => {
    w.u32(indexOffset + 16 * i, 0x3d00 + i)
    w.u32(indexOffset + 16 * i + 4, i + 1)
    w.u32(indexOffset + 16 * i + 8, off)
    w.u32(indexOffset + 16 * i + 12, 0)
  })
  const size = indexOffset + 16 * 8
  w.u32(0x14, indexOffset)
  w.u32(0x18, size)
  return { bytes: w.buf.slice(0, size), rasterOffset, beamNameOffsets, indexOffset, anchor: ANCHOR, options: o }
}
