/**
 * OPD 구조 읽기 — 시험용 작은 OPD(synth.ts)로 읽기 규칙·자체 점검·오류 경로를 시험 (실데이터 없이 돈다).
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  OPD_AMPLITUDE_SCALE,
  OPD_FAIL_PREFIX,
  OPD_READER,
  OpdError,
  hasOpdMagic,
  isOpdFileName,
  oleDateToIso,
  parseMxuVersion,
  parseOpdBuffer,
  readOpdAmplitude,
  readOpdFile,
  readOpdGatePeaks,
  selfCheckOpd,
  type OpdCheck
} from '@core/opd'
import { AppError } from '@shared/errors'
import { SYNTH, buildSynthOpd, synthSample } from './synth'

const TMP = mkdtempSync(join(tmpdir(), 'paut-opd-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function failCheck(fn: () => unknown): OpdCheck | null {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(OpdError)
    const err = e as OpdError
    expect(err.code).toBe('NDE_READ_ERROR')
    expect(err.message.startsWith(`${OPD_FAIL_PREFIX}: `)).toBe(true)
    return err.check
  }
  throw new Error('해석 실패가 나야 하는데 읽혔다')
}

function u16le(s: string): Uint8Array {
  const b = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    b[2 * i] = s.charCodeAt(i) & 0xff
    b[2 * i + 1] = s.charCodeAt(i) >> 8
  }
  return b
}

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  return Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).indexOf(Buffer.from(needle), from)
}

describe('도우미', () => {
  it('OLE 날짜 · MXU 버전 · 확장자 · 매직', () => {
    expect(oleDateToIso(46162.5)).toBe('2026-05-20T12:00:00')
    expect(oleDateToIso(Number.NaN)).toBeNull()
    expect(oleDateToIso(0)).toBeNull()
    expect(parseMxuVersion('MXU - 4.4R5')).toEqual({ major: 4, minor: 4, revision: 5 })
    expect(parseMxuVersion('4.4R5')).toBeNull()
    expect(isOpdFileName('a/TP14-ROOT-L-01.OPD')).toBe(true)
    expect(isOpdFileName('x.oud')).toBe(false)
    expect(hasOpdMagic(Uint8Array.from([0x44, 0x33, 0x22, 0x11, 0x53, 0x55, 0x52, 0x44]))).toBe(true)
    expect(hasOpdMagic(Uint8Array.from([0x89, 0x48, 0x44, 0x46]))).toBe(false)
    expect(OPD_READER).toEqual({ name: 'opd-structure', version: 4 })
  })
})

describe('시험용 OPD 읽기', () => {
  it('섹토리얼: 머리·셋업·빔·래스터', () => {
    const s = buildSynthOpd({ beams: 4, positions: 6 })
    const f = parseOpdBuffer(s.bytes)
    expect(f.header).toMatchObject({
      module: 'OMNISX-PA1664PR',
      serialNumber: 'QC-000001',
      mxuVersion: 'MXU - 4.4R5',
      mxu: { major: 4, minor: 4, revision: 5 },
      savedAt: '2026-05-20T12:00:00',
      deviceFileName: 'SYN-01-##',
      groupName: 'PA 1',
      anchorOffset: 0x30f4
    })
    expect(f.header.reportInfo).toEqual(['Contractor', 'Technician', 'Customer', 'Project', 'Site', 'Part Number', 'Procedure'].map((label) => ({ label, value: 'Name' })))
    expect(f.setup.formation).toBe('sectorial')
    expect(f.setup.angle).toEqual({ startDeg: 45, stopDeg: 48, stepDeg: 1 })
    expect(f.setup.thicknessMm).toBeCloseTo(12, 9)
    expect(f.setup.weldFillHeightMm).toBeCloseTo(10, 9)
    expect(f.setup.weldLandHeightMm).toBeCloseTo(2, 9)
    expect(f.setup.indexOffsetMm).toBeCloseTo(-14, 9)
    expect(f.setup.velocityMps).toBe(3240)
    expect(f.setup.aperture).toBe(16)
    expect(f.setup.firstElement).toBe(31)
    expect(f.setup.elementStep).toBeNull()
    expect(f.setup.scan).toEqual({ lengthMm: 6, resolutionMm: 1, nominalCount: 6 })
    expect(f.setup.probe).toMatchObject({ serial: 'R0001', model: '5L64-A32', modelRaw: '5L64-A32 ', elementCountFromModel: 64 })
    expect(f.setup.probe.centralFrequencyMHz).toBeCloseTo(5, 9)
    expect(f.setup.wedge).toMatchObject({ model: 'SA32-N55S', velocityMps: 2330, angleDeg: 36.1 })
    expect(f.setup.wedge.offsetXMm).toBeCloseTo(-55.52, 9)
    expect(f.setup.raw['A-0x510']).toBeCloseTo(0.012, 12)
    expect(f.beams.map((b) => b.name)).toEqual(['A:45.00 Sk:090 L:001', 'A:46.00 Sk:090 L:002', 'A:47.00 Sk:090 L:003', 'A:48.00 Sk:090 L:004'])
    const b = f.beams[2]!
    expect(b.angleDeg).toBe(47)
    expect(b.skewDeg).toBe(90)
    expect(b.t0Us).toBeCloseTo(SYNTH.t0Us, 9)
    expect(b.rangeUs).toBeCloseTo(SYNTH.rangeUs, 9)
    expect(b.sampleIntervalUs).toBeCloseTo(0.1, 12)
    expect(b.tcg).toHaveLength(4)
    expect(b.gates.map((g) => g.name)).toEqual(['I', 'A', 'B'])
    expect(b.gates[1]!.startDepthUs).toBeCloseTo(SYNTH.gateA.startDepthUs, 9)
    expect(b.recordOffset).toBe(s.beamNameOffsets[2]! + 42)
    expect(f.raster).toMatchObject({ offset: s.rasterOffset, positions: 6, beams: 4, samples: 320, bitDepth: 8, frameBytes: 1280, twoAxis: null })
    expect(f.warnings[0]).toMatch(/OPD/)
    expect(f.warnings).toHaveLength(1)
  })

  it('리니어 · TCG 없는 빔 배치(점 1개) · 스큐 270', () => {
    const f = parseOpdBuffer(buildSynthOpd({ formation: 'linear', beams: 5, tcgNames: 0, skewDeg: 270 }).bytes)
    expect(f.setup.formation).toBe('linear')
    expect(f.setup.elementStep).toBe(1)
    expect(f.beams.map((b) => b.firstElement)).toEqual([0, 1, 2, 3, 4])
    expect(f.beams.every((b) => b.tcg.length === 1 && b.skewDeg === 270)).toBe(true)
  })

  it('보고서 칸을 채우거나 그룹 이름이 달라도 문자열을 따라 읽는다 (앵커 = 그룹 이름 끝 + 0x328, 경고)', () => {
    const base = parseOpdBuffer(buildSynthOpd({ beams: 4, positions: 6 }).bytes)
    for (const opts of [{ reportValues: ['KDHC 인천지사', 'Kim', 'Name', 'P-01', '인천', 'PN-1', 'QP-7'] }, { groupName: 'PA 12' }, { reportValues: ['', 'Name'], groupName: 'Group 1 left' }]) {
      const s = buildSynthOpd({ beams: 4, positions: 6, ...opts })
      const f = parseOpdBuffer(s.bytes)
      expect(f.header.anchorOffset).toBe(s.anchor)
      expect(s.anchor).not.toBe(0x30f4)
      expect(f.header.groupName).toBe(opts.groupName ?? 'PA 1')
      expect(f.setup).toEqual({ ...base.setup })
      expect(f.beams.map((b) => ({ ...b, recordOffset: 0 }))).toEqual(base.beams.map((b) => ({ ...b, recordOffset: 0 })))
      expect(f.raster.positions).toBe(6)
      expect(f.warnings.some((w) => w.startsWith('아직 본 적 없는 배치입니다'))).toBe(true)
    }
    const filled = parseOpdBuffer(buildSynthOpd({ reportValues: ['KDHC'] }).bytes)
    expect(filled.header.reportInfo[0]).toEqual({ label: 'Contractor', value: 'KDHC' })
    expect(filled.warnings.find((w) => w.startsWith('아직 본 적 없는 배치'))).toContain('Contractor')
  })

  it('2축: 위치 수 = 스캔 칸 × 인덱스 줄', () => {
    const f = parseOpdBuffer(buildSynthOpd({ positions: 10, indexLines: 2 }).bytes)
    expect(f.raster.twoAxis).toEqual({ indexLines: 2, scanCount: 5 })
    expect(f.warnings.some((w) => w.includes('2축'))).toBe(true)
  })

  it('진폭 조각 · 게이트 결과 · Int16 넓히기 · 범위 밖은 INVALID_ARGUMENT', async () => {
    const s = buildSynthOpd({ beams: 3, positions: 5 })
    const c = await readOpdAmplitude(s.bytes, 2, 2)
    expect(c).toMatchObject({ scanStart: 2, scanCount: 2, beams: 3, samples: 320 })
    expect(c.amplitude).toBeInstanceOf(Uint8Array)
    expect(c.amplitude.length).toBe(2 * 3 * 320)
    expect(c.amplitude[(1 * 3 + 2) * 320 + 7]).toBe(synthSample(3, 2, 7))
    const i16 = await readOpdAmplitude(s.bytes, 2, 2, { format: 'int16' })
    expect(i16.amplitude).toBeInstanceOf(Int16Array)
    expect(Array.from(i16.amplitude)).toEqual(Array.from(c.amplitude))
    const g = await readOpdGatePeaks(s.bytes, 0, 5)
    expect(g.peaks.length).toBe(5 * 3 * 3)
    for (const [start, count] of [
      [-1, 1],
      [0, 0],
      [4, 2],
      [0.5, 1]
    ] as const) {
      await expect(readOpdAmplitude(s.bytes, start, count)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
  })

  it('자체 점검: 게이트 A 전부 일치 · 스넬 0 · 두께 일치', async () => {
    const c = await selfCheckOpd(buildSynthOpd({ beams: 4, positions: 6 }).bytes)
    expect(c.gateA.total).toBe(24)
    expect(c.gateA.matched).toBe(24)
    expect(c.gateA.insideTotal).toBe(24)
    expect(c.gateA.insideRate).toBe(1)
    expect(c.snell!.maxDiffMm).toBeLessThan(1e-9)
    expect(c.thickness).toEqual({ thicknessMm: 12, weldHeightMm: 12, mismatch: false })
    expect(c.passed).toEqual({ gateA: true, snell: true, thickness: true })
    expect(c.emptyFrames).toBe(0)
    expect(c.notes).toEqual([])
  })

  it('자체 점검: 빈 프레임은 게이트 대조에서 빼고, 어긋난 게이트 결과는 일치율을 낮춘다', async () => {
    const s = buildSynthOpd({ beams: 2, positions: 4 })
    const bytes = s.bytes.slice()
    const gr = s.rasterOffset + 4 * 640
    bytes.fill(0, s.rasterOffset + 3 * 640, s.rasterOffset + 4 * 640) // 마지막 프레임 비움 (끝까지 못 간 스캔: 게이트 결과도 0)
    bytes.fill(0, gr + 3 * 72, gr + 4 * 72)
    bytes[gr + ((0 * 2 + 0) * 3 + 1) * 12 + 8] = bytes[gr + ((0 * 2 + 0) * 3 + 1) * 12 + 8]! ^ 0x55
    const c = await selfCheckOpd(bytes)
    expect(c.emptyFrames).toBe(1)
    expect(c.suspectFrames).toBe(0)
    expect(c.gateA.total).toBe(6)
    expect(c.gateA.matched).toBe(5)
    expect(c.passed.gateA).toBe(false)
    expect(c.notes.some((n) => n.includes('게이트 A'))).toBe(true)
    expect(c.notes.some((n) => n.startsWith('빈 프레임(모두 0) 1개'))).toBe(true)
  })

  it('자체 점검: 래스터만 0 으로 지워진 프레임(장비 게이트 값은 남음) = 손상 의심', async () => {
    const s = buildSynthOpd({ beams: 2, positions: 4 })
    const bytes = s.bytes.slice()
    bytes.fill(0, s.rasterOffset + 1 * 640, s.rasterOffset + 3 * 640) // 프레임 1·2 래스터만 지움
    const c = await selfCheckOpd(bytes)
    expect([c.emptyFrames, c.suspectFrames]).toEqual([2, 2])
    expect(c.gateA.total).toBe(4)
    expect(c.passed.gateA).toBe(true)
    expect(c.notes.some((n) => n.includes('사본 손상이 의심'))).toBe(true)
    expect(c.notes.some((n) => n.startsWith('빈 프레임'))).toBe(false)
  })

  it('자체 점검: 장비 값보다 큰 재계산(설명할 수 없는 어긋남) 비율 · 전체 칸 일치율 · 센 신호', async () => {
    const s = buildSynthOpd({ beams: 4, positions: 6 })
    const gr = s.rasterOffset + 6 * 4 * 320
    // 24칸 중 6칸의 장비 값을 낮춤 → 25 % (기준 10 %)
    const low = s.bytes.slice()
    for (let k = 0; k < 6; k++) low[gr + ((k * 4 + 1) * 3 + 1) * 12 + 8] = 0
    const c = await selfCheckOpd(low)
    expect(c.gateA.unexplained).toBe(6)
    expect(c.gateA.unexplainedRate).toBeCloseTo(0.25, 12)
    expect(c.passed.gateA).toBe(false)
    expect(c.notes.some((n) => n.includes('장비 저장 값보다 큰 칸이 25.0 %'))).toBe(true)
    // 장비 값을 높이면(장비가 더 넓게 봄) 설명되는 어긋남 — 일치율만 낮아진다
    const high = s.bytes.slice()
    high[gr + ((0 * 4 + 1) * 3 + 1) * 12 + 8] = 255
    const h = await selfCheckOpd(high)
    expect(h.gateA.unexplained).toBe(0)
    expect(h.gateA.matched).toBe(23)
    // 23/24 = 95.8 % 는 저장 구간 안·전체 모두 기준(95 %) 이상
    expect(h.passed.gateA).toBe(true)
    // 센 신호 칸 (재계산 raw ≥ 224) 은 따로 센다
    expect(h.gateA.strongTotal).toBeGreaterThan(0)
    expect(h.gateA.strongRate).toBe(h.gateA.strongMatched / h.gateA.strongTotal)
  })

  it('경로로 읽기 = 바이트로 읽기, 앞부분이 모자라면 더 읽는다, 원본은 그대로', async () => {
    // 빔 120개 → 셋업 구역이 첫 앞부분(256 KiB)보다 길다
    const s = buildSynthOpd({ formation: 'linear', beams: 120, positions: 2 })
    expect(s.rasterOffset).toBeGreaterThan(256 * 1024)
    const path = join(TMP, 'big.opd')
    writeFileSync(path, s.bytes)
    const before = statSync(path)
    const f = await readOpdFile(path)
    expect(f).toEqual(parseOpdBuffer(s.bytes))
    expect(f.beams).toHaveLength(120)
    const c = await readOpdAmplitude(path, 1, 1, { file: f })
    expect(Array.from(c.amplitude)).toEqual(Array.from(s.bytes.subarray(f.raster.offset + f.raster.frameBytes, f.raster.offset + 2 * f.raster.frameBytes)))
    await selfCheckOpd(path)
    const after = statSync(path)
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs])
  })

  it('파일 접근 오류', async () => {
    await expect(readOpdFile(join(TMP, 'none.opd'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const dir = join(TMP, 'dir.opd')
    mkdirSync(dir)
    await expect(readOpdFile(dir)).rejects.toBeInstanceOf(AppError)
    const empty = join(TMP, 'empty.opd')
    writeFileSync(empty, new Uint8Array(0))
    await expect(readOpdFile(empty)).rejects.toMatchObject({ code: 'NDE_READ_ERROR', reason: 'empty-file' })
    expect(OPD_AMPLITUDE_SCALE).toEqual({ rawMax: 255, unitMax: 250 })
  })
})

describe('시험용 OPD: 잘린·바꾼 파일은 보류(해석 실패)', () => {
  const base = buildSynthOpd({ beams: 4, positions: 6 })
  const mutate = (fn: (b: Uint8Array, dv: DataView) => void): Uint8Array => {
    const b = base.bytes.slice()
    fn(b, new DataView(b.buffer))
    return b
  }

  it('매직·머리 버전·크기·꼬리 색인', () => {
    expect(failCheck(() => parseOpdBuffer(Uint8Array.from([1, 2, 3])))).toBe('file-size')
    expect(failCheck(() => parseOpdBuffer(new Uint8Array(4096)))).toBe('magic')
    expect(failCheck(() => parseOpdBuffer(mutate((b) => (b[4] = 0x58))))).toBe('magic')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setUint32(8, 4, false))))).toBe('container-version')
    expect(failCheck(() => parseOpdBuffer(base.bytes.slice(0, base.bytes.length - 100)))).toBe('file-size')
    const cut = base.bytes.slice(0, base.bytes.length - 64)
    new DataView(cut.buffer).setUint32(0x18, cut.length, true)
    expect(failCheck(() => parseOpdBuffer(cut))).toBe('tail-index')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setUint32(base.indexOffset + 16 * 2 + 8, 0x10, true))))).toBe('tail-index')
  })

  it('셋업: 일반 정보·앵커·값 범위·탐촉자', () => {
    expect(failCheck(() => parseOpdBuffer(mutate((b) => b.set(u16le('Kontractor'), indexOf(b, u16le('Contractor'))))))).toBe('general-info')
    // 그룹 이름 끝 0 을 지우면(뒤는 밀리지 않음) 이름이 길어져 계산한 앵커의 셋업 값이 맞지 않는다 → 안내 문구와 함께 해석 실패
    const longer = mutate((b) => b.set(u16le('PA 12'), indexOf(b, u16le('PA 1\0'))))
    expect(failCheck(() => parseOpdBuffer(longer))).toBe('setup-values')
    expect(() => parseOpdBuffer(longer)).toThrow(/아직 시험하지 못했습니다/)
    // 그룹 이름 문자열이 깨지면 앵커를 정할 수 없다
    expect(failCheck(() => parseOpdBuffer(mutate((b) => b.set([1, 0], indexOf(b, u16le('PA 1\0'))))))).toBe('anchor')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setFloat64(0x30f4 - 0x510, 5, true))))).toBe('setup-values')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setFloat64(0x30f4 - 0x3e0, Number.NaN, true))))).toBe('setup-values')
    const second = (b: Uint8Array): number => indexOf(b, u16le('5L64-A32 '), indexOf(b, u16le('5L64-A32 ')) + 2)
    expect(failCheck(() => parseOpdBuffer(mutate((b) => b.set(u16le('5L64-A33 '), second(b)))))).toBe('probe-strings')
  })

  it('빔: 이름 순서·각도 블록·TCG 배치·소자 칸', () => {
    expect(failCheck(() => parseOpdBuffer(mutate((b) => b.set(u16le('L:005'), base.beamNameOffsets[1]! + 30))))).toBe('beam-records')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setFloat64(0x30f4, 44, true))))).toBe('angle-block')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setFloat64(base.beamNameOffsets[2]! + 42, 47.5, true))))).toBe('beam-values')
    expect(failCheck(() => parseOpdBuffer(buildSynthOpd({ tcgNames: 2 }).bytes))).toBe('beam-layout')
    expect(failCheck(() => parseOpdBuffer(mutate((b) => b.set(u16le('G'), base.beamNameOffsets[0]! + 42 + 0x798))))).toBe('beam-layout')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setUint16(base.beamNameOffsets[0]! + 42 + 0x40 + 0x40 * 3, 99, true))))).toBe('beam-values')
    // 빔 하나의 A-scan 시작(R+0x768)·범위(R+0x770)가 다르면 빔 기록을 잘못 읽은 것으로 본다 (162개 모두 같음)
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setFloat64(base.beamNameOffsets[1]! + 42 + 0x768, (SYNTH.t0Us + 0.3) * 1e-6, true))))).toBe('beam-values')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setFloat64(base.beamNameOffsets[3]! + 42 + 0x770, (SYNTH.rangeUs + 1) * 1e-6, true))))).toBe('beam-values')
  })

  it('꼬리: 경보 구역·색표·위치 수', () => {
    expect(failCheck(() => parseOpdBuffer(mutate((b) => b.fill(0x41, indexOf(b, u16le('Alarm_Output_GROUP')), indexOf(b, u16le('Alarm_Output_GROUP')) + 4))))).toBe('trailer')
    expect(failCheck(() => parseOpdBuffer(mutate((b) => (b[base.rasterOffset - 1024 + 4 * 100] = 101))))).toBe('palette')
    expect(failCheck(() => parseOpdBuffer(mutate((b) => (b[base.rasterOffset - 2048 + 3] = 1))))).toBe('palette')
    expect(failCheck(() => parseOpdBuffer(mutate((_, dv) => dv.setUint32(base.indexOffset + 16 + 8, dv.getUint32(base.indexOffset + 16 + 8, true) + 1, true))))).toBe('positions')
  })

  it('위치 수: 1축은 스캔 길이 ÷ 간격 ±1 안, 2축은 인덱스 칸 줄 수와 같아야 한다 (샘플 수를 잘못 가정해도 나누어떨어지는 경우를 막음)', () => {
    const scanLength = (b: Uint8Array, count: number): void => new DataView(b.buffer).setFloat64(base.anchor - 0x5a8, count * 0.001, true)
    // ±1 은 경고만 (SEC25-2 sr1_04~07 800 대 801)
    const off1 = parseOpdBuffer(mutate((b) => scanLength(b, 7)))
    expect(off1.raster.positions).toBe(6)
    expect(off1.warnings.some((w) => w.includes('위치 수(6)가 스캔 길이 ÷ 간격(7)'))).toBe(true)
    expect(failCheck(() => parseOpdBuffer(mutate((b) => scanLength(b, 8))))).toBe('positions')
    expect(failCheck(() => parseOpdBuffer(mutate((b) => scanLength(b, 4))))).toBe('positions')
    // 샘플 676 개로 저장된 4위치 파일을 320 으로 읽으면 8위치 = 4 × 2줄로 보인다 → 인덱스 칸(1줄)과 달라 해석 실패
    const asIf676 = buildSynthOpd({ beams: 4, positions: 8 })
    const b676 = asIf676.bytes.slice()
    new DataView(b676.buffer).setFloat64(asIf676.anchor - 0x5a8, 4 * 0.001, true)
    expect(failCheck(() => parseOpdBuffer(b676))).toBe('positions')
    // 2축: 인덱스 길이 칸이 3줄인데 구조로는 2줄
    const two = buildSynthOpd({ positions: 10, indexLines: 2 })
    const b2 = two.bytes.slice()
    new DataView(b2.buffer).setFloat64(two.anchor - 0x590, 3 * 0.001, true)
    expect(failCheck(() => parseOpdBuffer(b2))).toBe('positions')
  })
})
