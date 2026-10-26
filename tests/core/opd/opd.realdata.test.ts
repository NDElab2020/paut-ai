/**
 * 대표 OPD (실데이터가 있는 PC 에서만):
 * - TP14-ROOT-L 값 (1_파서실험 3.1절 표)
 * - OmniPC 화면 정답 재현 (3_화면대조 방법, 결정 6 허용치: 위치 ±0.5 mm, A% ±0.1 %p, 각도 같음, 스캔 반 칸 안)
 * - 원본은 읽기만 (크기·수정 시각·SHA-256 그대로)
 * - 잘린·바꾼 사본은 보류(해석 실패)
 * - 성능 기록 (10.5 MB 파일 셋업 읽기·조각 읽기)
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OPD_AMPLITUDE_SCALE,
  OPD_FAIL_PREFIX,
  OpdError,
  gateSampleWindow,
  parseOpdBuffer,
  readOpdAmplitude,
  readOpdFile,
  readOpdGatePeaks,
  selfCheckOpd,
  type OpdFile
} from '@core/opd'
import { OPD_FILES, opdPath } from '../../paths'

const TP14 = opdPath(OPD_FILES.tp14RootL)
const SEC25 = opdPath(OPD_FILES.sec25sr1_01)
const SEC20 = opdPath(OPD_FILES.sec20sr01_01)
const HAS_TP14 = existsSync(TP14)
const HAS_SEC25 = existsSync(SEC25)
const HAS_SEC20 = existsSync(SEC20)
const POS_TOL = 0.5 // mm (결정 6)
const PCT_TOL = 0.1 // %p (결정 6)

interface OmniPcOpdFixture {
  file: string
  sha256Prefix: string
  data: { gainDb: number; refDb?: number }
  cursor: { scanMm: number; angleDeg: number }
  readings: { aPercent: number; daMm: number | null; viaMm: number | null }
  screen: {
    gateADepthMm: [number, number]
    gateAThresholdPct: number
    skipMm?: { B0: number; T1: number }
    beamLine: { startVDepthMm: [number, number]; endVDepthMm: [number, number]; exitVAtDepth0Mm: number }
  }
}

function fixture(name: string): OmniPcOpdFixture {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '../../fixtures/omnipc', name), 'utf8')) as OmniPcOpdFixture
}

const DEG = Math.PI / 180
/** 펼친 깊이를 두께 안으로 접기 */
function fold(depth: number, t: number): number {
  const d = depth % (2 * t)
  return d > t ? 2 * t - d : d
}

/** 3_화면대조 방법: 커서 프레임·빔의 게이트 A 최대 → A%·DA^·ViA^ (스큐 90: 출사점 V = 인덱스 오프셋 + 출사점 X) */
async function cursorReadings(path: string, f: OpdFile, scanMm: number, angleDeg: number, thresholdPct: number) {
  const frame = Math.round(scanMm / f.setup.scan.resolutionMm)
  const beamIdx = f.beams.findIndex((b) => Math.abs(b.angleDeg - angleDeg) < 1e-9)
  const b = f.beams[beamIdx]!
  const chunk = await readOpdAmplitude(path, frame, 1, { file: f })
  const S = f.raster.samples
  const w = gateSampleWindow(b, 1, S)
  let raw = -1
  let at = -1
  for (let s = w.lo; s <= w.hi; s++) {
    const v = chunk.amplitude[beamIdx * S + s]!
    if (v > raw) {
      raw = v
      at = s
    }
  }
  const pct = (raw / OPD_AMPLITUDE_SCALE.rawMax) * OPD_AMPLITUDE_SCALE.unitMax
  const v = f.setup.velocityMps
  const pathMm = ((b.t0Us + at * b.sampleIntervalUs) * v) / 2000
  const exitV = f.setup.indexOffsetMm + b.exitXMm
  const detected = pct >= thresholdPct
  const startPath = (b.t0Us * v) / 2000
  const endPath = ((b.t0Us + b.rangeUs) * v) / 2000
  const gate = b.gates[1]!
  return {
    frame,
    scanMm: frame * f.setup.scan.resolutionMm,
    beamIdx,
    angleDeg: b.angleDeg,
    raw,
    pct,
    da: detected ? fold(pathMm * Math.cos(b.angleDeg * DEG), f.setup.thicknessMm) : null,
    via: detected ? exitV + pathMm * Math.sin(b.angleDeg * DEG) : null,
    exitV,
    lineStart: [exitV + startPath * Math.sin(b.angleDeg * DEG), startPath * Math.cos(b.angleDeg * DEG)],
    lineEnd: [exitV + endPath * Math.sin(b.angleDeg * DEG), endPath * Math.cos(b.angleDeg * DEG)],
    gateDepth: [(gate.startDepthUs * v) / 2000, ((gate.startDepthUs + gate.widthDepthUs) * v) / 2000]
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe.skipIf(!HAS_TP14)('TP14-ROOT-L-01 (실데이터)', () => {
  it('머리·셋업·빔 값 (1_파서실험 3.1절)', async () => {
    const f = await readOpdFile(TP14)
    expect(f.header).toMatchObject({
      module: 'OMNISX-PA1664PR',
      serialNumber: 'QC-006952',
      mxuVersion: 'MXU - 4.4R5',
      savedAt: '2026-05-20T11:23:13',
      deviceFileName: 'TP14-ROOT-L-##',
      groupName: 'PA 1',
      lawFile: '&#&NO_LAW_FILE_LOAD&#&'
    })
    const s = f.setup
    expect(s.thicknessMm).toBeCloseTo(25, 9)
    expect(s.weldFillHeightMm).toBeCloseTo(23, 9)
    expect(s.weldLandHeightMm).toBeCloseTo(2, 9)
    expect(s.velocityMps).toBeCloseTo(3244.449, 3)
    expect(s.gainDb).toBeCloseTo(33.573, 3)
    expect(s.referenceGainDb).toBe(0)
    expect(s.referenceAmplitudePct).toBe(80)
    expect(s.pulseWidthNs).toBeCloseTo(100, 6)
    expect(s.indexOffsetMm).toBeCloseTo(-40, 9)
    expect(s.skewDeg).toBe(90)
    expect(s.formation).toBe('sectorial')
    expect(s.angle).toEqual({ startDeg: 45, stopDeg: 70, stepDeg: 1 })
    expect(s.focusDepthMm).toBeCloseTo(25, 9)
    expect(s.aperture).toBe(16)
    expect(s.firstElement).toBe(38)
    expect(s.scan).toEqual({ lengthMm: 301, resolutionMm: 1, nominalCount: 301 })
    expect(s.probe).toMatchObject({ serial: 'R2525', model: '5L64-A32', elementCountFromModel: 64 })
    expect(s.probe.centralFrequencyMHz).toBeCloseTo(5, 9)
    expect(s.probe.pitchMm).toBeCloseTo(0.5, 9)
    expect(s.wedge).toMatchObject({ model: 'SA32-N55S', velocityMps: 2330, angleDeg: 36.1 })
    expect(s.wedge.offsetXMm).toBeCloseTo(-55.52, 9)
    expect(s.wedge.heightMm).toBeCloseTo(11, 9)
    expect(f.beams).toHaveLength(26)
    const b65 = f.beams[20]!
    expect(b65.name).toBe('A:65.00 Sk:090 L:021')
    expect(b65.exitXMm).toBeCloseTo(-16.82, 2)
    expect(b65.t0Us).toBeCloseTo(19.14, 9)
    expect(b65.rangeUs).toBeCloseTo(44.8, 9)
    expect(b65.sampleIntervalUs).toBeCloseTo(0.14, 12)
    // 웨지 지연 첫~끝 빔 28.08~28.23 µs (1_파서실험 3.1절)
    expect(f.beams[0]!.wedgeDelayUs).toBeCloseTo(28.08, 2)
    expect(f.beams[25]!.wedgeDelayUs).toBeCloseTo(28.23, 2)
    expect(b65.firstElement).toBe(37)
    expect(b65.tcg).toHaveLength(4)
    expect(f.raster).toMatchObject({ offset: 88492, positions: 301, beams: 26, samples: 320, twoAxis: null })
    expect(f.raster.gateResultsOffset).toBe(88492 + 301 * 26 * 320)
    expect(f.raster.tailOffset).toBe(88492 + 301 * 26 * 356 + 4928)
    // 게이트 A (깊이 mm) 16.00 ~ 39.00 폭
    const v = s.velocityMps
    expect((b65.gates[1]!.startDepthUs * v) / 2000).toBeCloseTo(16, 2)
    expect((b65.gates[1]!.widthDepthUs * v) / 2000).toBeCloseTo(39, 2)
    // 장비 게이트 결과: 278 mm · 65° 게이트 A 최대 33 (1_파서실험 4.4절)
    const g = await readOpdGatePeaks(TP14, 278, 1, { file: f })
    expect(g.peaks[20 * 3 + 1]).toBe(33)
  })

  it('경로·바이트로 읽은 결과가 같고, 진폭 조각이 파일 바이트 그대로다', async () => {
    const bytes = readFileSync(TP14)
    const a = await readOpdFile(TP14)
    const b = parseOpdBuffer(bytes)
    expect(a).toEqual(b)
    const c = await readOpdAmplitude(TP14, 100, 3, { file: a })
    const off = a.raster.offset + 100 * a.raster.frameBytes
    expect(Buffer.from(c.amplitude as Uint8Array).equals(bytes.subarray(off, off + 3 * a.raster.frameBytes))).toBe(true)
    const all = await readOpdAmplitude(bytes, 0, a.raster.positions, { format: 'int16' })
    expect(all.amplitude).toBeInstanceOf(Int16Array)
    expect(all.amplitude.length).toBe(301 * 26 * 320)
  })
})

describe.skipIf(!HAS_TP14)('OmniPC 화면 정답 재현: TP14-ROOT-L 278.03 mm · 65°', () => {
  const fx = fixture('OPD_TP14-ROOT-L-01.json')

  it('A% · DA^ · ViA^ · 출사점 · 빔 선 · 게이트 · 두께', async () => {
    expect(sha256(TP14).startsWith(fx.sha256Prefix)).toBe(true)
    const f = await readOpdFile(TP14)
    const r = await cursorReadings(TP14, f, fx.cursor.scanMm, fx.cursor.angleDeg, fx.screen.gateAThresholdPct)
    expect(Math.abs(r.scanMm - fx.cursor.scanMm)).toBeLessThanOrEqual(0.5) // 스캔 반 칸 안
    expect(r.angleDeg).toBe(fx.cursor.angleDeg)
    expect(r.raw).toBe(33)
    expect(Math.abs(r.pct - fx.readings.aPercent)).toBeLessThanOrEqual(PCT_TOL)
    expect(Math.abs(r.da! - fx.readings.daMm!)).toBeLessThanOrEqual(POS_TOL)
    expect(Math.abs(r.via! - fx.readings.viaMm!)).toBeLessThanOrEqual(POS_TOL)
    expect(Math.abs(r.exitV - fx.screen.beamLine.exitVAtDepth0Mm)).toBeLessThanOrEqual(POS_TOL)
    for (const [a, e] of [
      [r.lineStart, fx.screen.beamLine.startVDepthMm],
      [r.lineEnd, fx.screen.beamLine.endVDepthMm]
    ] as const) {
      expect(Math.abs(a[0]! - e[0])).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(a[1]! - e[1])).toBeLessThanOrEqual(POS_TOL)
    }
    expect(Math.abs(r.gateDepth[0]! - fx.screen.gateADepthMm[0])).toBeLessThanOrEqual(POS_TOL)
    expect(Math.abs(r.gateDepth[1]! - fx.screen.gateADepthMm[1])).toBeLessThanOrEqual(POS_TOL)
    expect(f.setup.thicknessMm).toBeCloseTo(fx.screen.skipMm!.B0, 6)
    expect(Math.round(f.setup.gainDb * 10) / 10).toBe(fx.data.gainDb)
    console.info(
      `[OPD TP14] 프레임 ${r.frame} · ${r.angleDeg}°: A% ${r.pct.toFixed(2)} (화면 ${fx.readings.aPercent}), DA^ ${r.da!.toFixed(2)} (${fx.readings.daMm}), ` +
        `ViA^ ${r.via!.toFixed(2)} (${fx.readings.viaMm}), 출사점 V ${r.exitV.toFixed(2)} (${fx.screen.beamLine.exitVAtDepth0Mm})`
    )
  })
})

describe.skipIf(!HAS_SEC25)('OmniPC 화면 정답 재현: SEC25-2 sr1_01 114.15 mm · 39°', () => {
  const fx = fixture('OPD_SEC25-2_sr1_01.json')

  it('A% · DA^/ViA^ ND · 출사점 · 빔 선 · Gain/Ref', async () => {
    expect(sha256(SEC25).startsWith(fx.sha256Prefix)).toBe(true)
    const f = await readOpdFile(SEC25)
    const r = await cursorReadings(SEC25, f, fx.cursor.scanMm, fx.cursor.angleDeg, fx.screen.gateAThresholdPct)
    expect(Math.abs(r.scanMm - fx.cursor.scanMm)).toBeLessThanOrEqual(0.5)
    expect(r.angleDeg).toBe(fx.cursor.angleDeg)
    expect(r.raw).toBe(5)
    expect(Math.abs(r.pct - fx.readings.aPercent)).toBeLessThanOrEqual(PCT_TOL)
    expect(r.da).toBe(fx.readings.daMm) // ND (문턱 20 % 아래)
    expect(r.via).toBe(fx.readings.viaMm)
    expect(Math.abs(r.exitV - fx.screen.beamLine.exitVAtDepth0Mm)).toBeLessThanOrEqual(POS_TOL)
    for (const [a, e] of [
      [r.lineStart, fx.screen.beamLine.startVDepthMm],
      [r.lineEnd, fx.screen.beamLine.endVDepthMm]
    ] as const) {
      expect(Math.abs(a[0]! - e[0])).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(a[1]! - e[1])).toBeLessThanOrEqual(POS_TOL)
    }
    expect(Math.abs(r.gateDepth[0]! - fx.screen.gateADepthMm[0])).toBeLessThanOrEqual(POS_TOL)
    expect(Math.abs(r.gateDepth[1]! - fx.screen.gateADepthMm[1])).toBeLessThanOrEqual(POS_TOL)
    // 화면 Gain 6.0 dB = 파일 이득 − 기준 이득, Ref 31.5 dB = 기준 이득
    expect(Math.round((f.setup.gainDb - f.setup.referenceGainDb) * 10) / 10).toBe(fx.data.gainDb)
    expect(Math.round(f.setup.referenceGainDb * 10) / 10).toBe(fx.data.refDb)
    console.info(`[OPD SEC25-2] 프레임 ${r.frame} · ${r.angleDeg}°: A% ${r.pct.toFixed(2)} (화면 ${fx.readings.aPercent}), 출사점 V ${r.exitV.toFixed(2)} (${fx.screen.beamLine.exitVAtDepth0Mm})`)
  })
})

describe.skipIf(!HAS_TP14)('원본은 읽기만 · 잘린·바꾼 사본은 보류(해석 실패)', () => {
  let tmp = ''
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'paut-opd-real-'))
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('읽기 전후 원본의 크기·수정 시각·SHA-256 이 같다', async () => {
    const before = statSync(TP14)
    const hash = sha256(TP14)
    const f = await readOpdFile(TP14)
    await readOpdAmplitude(TP14, 0, 10, { format: 'int16' })
    await readOpdGatePeaks(TP14, 0, 10, { file: f })
    await selfCheckOpd(TP14)
    const after = statSync(TP14)
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs])
    expect(sha256(TP14)).toBe(hash)
  })

  it('잘린 사본(경로)·바꾼 사본(바이트)', async () => {
    const bytes = new Uint8Array(readFileSync(TP14))
    const fail = async (src: string | Uint8Array): Promise<string | null> => {
      try {
        await readOpdFile(src)
      } catch (e) {
        expect(e).toBeInstanceOf(OpdError)
        expect((e as OpdError).code).toBe('NDE_READ_ERROR')
        expect((e as OpdError).message.startsWith(OPD_FAIL_PREFIX)).toBe(true)
        return (e as OpdError).check
      }
      return null
    }
    // 잘린 사본 (복사가 끝나지 않은 파일)
    const cutPath = join(tmp, 'cut.opd')
    writeFileSync(cutPath, bytes.subarray(0, bytes.length - 1_000_000))
    expect(await fail(cutPath)).toBe('file-size')
    // 앞부분만 남은 사본에 크기 칸까지 맞춰 둔 경우
    const head = bytes.slice(0, 200_000)
    new DataView(head.buffer).setUint32(0x18, head.length, true)
    expect(await fail(head)).toBe('tail-index')
    const f = parseOpdBuffer(bytes)
    const mut = (fn: (b: Uint8Array, dv: DataView) => void): Uint8Array => {
      const b = bytes.slice()
      fn(b, new DataView(b.buffer))
      return b
    }
    const nameOf = (k: number): number => f.beams[k]!.recordOffset - 42
    // 빔 이름 L 번호
    expect(await fail(mut((b) => b.set([0x39], nameOf(1) + 38)))).toBe('beam-records')
    // 각도 블록 시작
    expect(await fail(mut((_, dv) => dv.setFloat64(0x30f4, 46, true)))).toBe('angle-block')
    // 회색조 색표 한 칸
    expect(await fail(mut((b) => (b[f.raster.paletteOffsets[2] + 400] = 99)))).toBe('palette')
    // 꼬리 색인 첫 꼬리 구역 위치 + 1
    expect(await fail(mut((_, dv) => dv.setUint32(f.container.indexOffset + 16 + 8, f.raster.tailOffset + 1, true)))).toBe('positions')
    // 빔 기록 안 TCG 이름 하나 (알 수 없는 배치)
    expect(await fail(mut((b) => (b[f.beams[3]!.recordOffset + 0x798 + 42] = 0x47)))).toBe('beam-layout')
    // 두 번째 탐촉자 모델
    expect(await fail(mut((_, dv) => dv.setUint16(0x3308, 0x36, true)))).toBe('probe-strings')
    // 두께 칸을 엉뚱한 값으로
    expect(await fail(mut((_, dv) => dv.setFloat64(0x30f4 - 0x510, -1, true)))).toBe('setup-values')
  })
})

describe.skipIf(!HAS_SEC20)('성능 기록: 10.5 MB 파일 (SEC20 sr01_01)', () => {
  it('셋업 읽기 · 조각 읽기 · 자체 점검 시간', async () => {
    const size = statSync(SEC20).size
    const t = (ms: number): string => `${ms.toFixed(1)} ms`
    await readOpdFile(SEC20) // 첫 읽기(디스크 캐시) 제외
    const n = 5
    let t0 = performance.now()
    let f: OpdFile | null = null
    for (let i = 0; i < n; i++) f = await readOpdFile(SEC20)
    const setupMs = (performance.now() - t0) / n
    t0 = performance.now()
    const c64 = await readOpdAmplitude(SEC20, 0, 64, { file: f! })
    const chunk64Ms = performance.now() - t0
    t0 = performance.now()
    const all = await readOpdAmplitude(SEC20, 0, f!.raster.positions, { file: f!, format: 'int16' })
    const allMs = performance.now() - t0
    t0 = performance.now()
    const sc = await selfCheckOpd(SEC20, { file: f! })
    const checkMs = performance.now() - t0
    expect(c64.amplitude.length).toBe(64 * 36 * 320)
    expect(all.amplitude.length).toBe(801 * 36 * 320)
    console.info(
      `[OPD 성능] ${(size / 1e6).toFixed(2)} MB: 셋업 읽기 ${t(setupMs)} (평균 ${n}회), 조각 64위치 ${t(chunk64Ms)}, ` +
        `전체 801위치 int16 ${t(allMs)} (${(all.amplitude.byteLength / 1e6).toFixed(1)} MB), 자체 점검 ${t(checkMs)} (게이트 A ${(sc.gateA.rate * 100).toFixed(1)} %)`
    )
    // 넉넉한 상한 (느린 PC·CI 고려): 셋업 읽기는 HDF5 셋업 읽기처럼 수 ms 수준
    expect(setupMs).toBeLessThan(500)
  })
})
