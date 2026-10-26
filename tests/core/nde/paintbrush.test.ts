import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildViewerInfo, defaultDisplay, readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import { maskPaintbrushAmplitude } from '@core/nde/viewer/paintbrush'
import { obj, objs, type Json } from '@core/nde/json'
import { samplePoint, sampleTimeUs } from '@shared/imaging/coords'
import type { DatasetProbe } from '@core/nde/viewer/meta'

const AMP = '/Public/Groups/0/Datasets/0-AScanAmplitude'
const STATUS = '/Public/Groups/0/Datasets/1-AScanStatus'
const NS = 3, NV = 4, NT = 8, DT = 4e-8, T0 = 2e-6

/** 격자 V 가 이미 설치 위치를 포함함: +41.6 mm 를 다시 더하면 실패한다. */
function fixture(): Json {
  const uv = [
    { axis: 'UCoordinate', offset: 0.005, quantity: NS, resolution: 0.00025, lastCellRewrited: 2 },
    { axis: 'VCoordinate', offset: 0.00175, quantity: NV, resolution: 0.0005 }
  ]
  return {
    version: '4.2.0',
    specimens: [{ id: 0, plateGeometry: { thickness: 0.013 } }],
    probes: [{ id: 0, wedgeAssociation: { wedgeId: 0 } }],
    wedges: [{ id: 0, positioning: { specimenId: 0, surfaceId: 0, skewAngle: 90, vCoordinateOffset: 0.0416 } }],
    dataMappings: [{ id: 0, specimenId: 0, surfaceId: 0, discreteGrid: { dimensions: [
      { axis: 'UCoordinate', offset: 0, quantity: NS, resolution: 0.00025 },
      { axis: 'VCoordinate', offset: 0, quantity: NV, resolution: 0.0005 }
    ] } }],
    groups: [{ id: 0, name: 'GR-1', datasets: [
      { dataClass: 'AScanAmplitude', path: AMP, storageMode: 'Paintbrush', dataValue: { min: 0, max: 32767, unitMax: 200 },
        dimensions: [...structuredClone(uv), { axis: 'Ultrasound', offset: T0, quantity: NT, resolution: DT }] },
      { dataClass: 'AScanStatus', path: STATUS, storageMode: 'Paintbrush', dataValue: { hasData: 1, saturated: 2, noSynchro: 4 }, dimensions: structuredClone(uv) }
    ], processes: [{ id: 0, dataMappingId: 0, ultrasonicPhasedArray: {
      pulseEcho: { probeId: 0, linearFormation: { beamRefractedAngle: 0 } }, waveMode: 'Longitudinal', velocity: 2450,
      rectification: 'Full', ascanSynchroMode: 'Pulse',
      beams: Array.from({ length: NV }, (_, id) => ({ id, refractedAngle: 0, skewAngle: 0, ascanStart: T0, ascanLength: NT * DT, beamDelay: 17.31e-6 })),
      gates: [{ id: 1, name: 'Gate A', geometry: 'TrueDepth', synchronization: { mode: 'Pulse' }, start: 2.1e-6, length: 0.1e-6, threshold: 20 }]
    } }] }]
  }
}

const group = (s: Json): Json => objs(s['groups'])[0]!
const sets = (s: Json): Json[] => objs(group(s)['datasets'])
const body = (s: Json): Json => obj(objs(group(s)['processes'])[0]!['ultrasonicPhasedArray'])!
const statusProbe: DatasetProbe = { shape: [NS, NV], type: 4, size: 1, signed: false }
function info(s = fixture(), status: DatasetProbe | null = statusProbe): ReturnType<typeof buildViewerInfo> {
  return buildViewerInfo({ setup: s, family: '4.x', version: '4.2.0', lookup: (p) =>
    p === AMP ? { shape: [NS, NV, NT], type: 0, size: 2, signed: true } : p === STATUS ? status : null,
  display: defaultDisplay(), groupSetups: [], currentMxuGroupId: null, warnings: [] })
}

describe('NDE Paintbrush 정상입사 공간 격자', () => {
  it('저장 U/V 좌표와 시간축을 직접 사용하고 기존 PA 검증표를 적용하지 않는다', () => {
    const r = info(), g = r.groups[0]!
    expect(g).toMatchObject({ technique: 'pa-linear', supported: true, verified: false, storageMode: 'Paintbrush', shape: [NS, NV, NT] })
    expect(g.scan).toEqual({ offsetMm: 5, resolutionMm: 0.25, count: NS })
    expect(g.spatialAxis).toEqual({ kind: 'index', offsetMm: 1.75, resolutionMm: 0.5, count: NV })
    expect(g.beams.map((b) => b.vOffsetMm)).toEqual([1.75, 2.25, 2.75, 3.25])
    expect(g.beams.every((b) => b.angleDeg === 0 && b.skewDeg === 90 && b.t0Us === 2)).toBe(true)
    expect(sampleTimeUs(g.beams[0]!, NT - 1, g.ultrasound)).toBeCloseTo(2.28, 12)
    expect(samplePoint(g.beams[0]!, 0, g.ultrasound)).toEqual({ vMm: 1.75, depthMm: 2.45 })
    expect(g.gates[0]).toMatchObject({ thresholdPct: 20, supported: true })
    expect(g.gates[0]!.startUs[0]).toBeCloseTo(2.1, 12)
    expect(g.gates[0]!.lengthUs[0]).toBeCloseTo(0.1, 12)
    expect(r.warnings.join(' ')).toMatch(/Paintbrush.*OmniPC 대조 전.*엔코더 실측/)
  })

  it.each([
    ['상태 없음', null],
    ['상태 모양 오류', { ...statusProbe, shape: [NS, NV - 1] }],
    ['상태 정수 폭 오류', { ...statusProbe, size: 2 }],
    ['상태 부호 오류', { ...statusProbe, signed: true }],
    ['상태 자료형 오류', { ...statusProbe, type: 1 }]
  ])('%s 이면 미취득 진폭을 그리지 않도록 차단한다', (_, probe) => {
    expect(info(fixture(), probe).groups[0]).toMatchObject({ supported: false, verified: false })
    expect(info(fixture(), probe).groups[0]!.reason).toMatch(/8비트 상태 격자/)
  })

  it.each([
    ['저장 방식 누락', (s: Json) => { delete sets(s)[0]!['storageMode'] }, /저장 방식/],
    ['상태 비트 정의 다름', (s: Json) => { obj(sets(s)[1]!['dataValue'])!['hasData'] = 2 }, /상태 격자/],
    ['상태 좌표 다름', (s: Json) => { objs(sets(s)[1]!['dimensions'])[1]!['offset'] = 0.002 }, /상태 격자/],
    ['V 간격 없음', (s: Json) => { delete objs(sets(s)[0]!['dimensions'])[1]!['resolution'] }, /축·범위·간격/],
    ['비정수 칸 수', (s: Json) => { objs(sets(s)[0]!['dimensions'])[1]!['quantity'] = 3.5 }, /축·범위·간격/],
    ['법칙 수 다름', (s: Json) => { body(s)['beams'] = objs(body(s)['beams']).slice(1) }, /공간 칸 수/],
    ['경사 법칙', (s: Json) => { objs(body(s)['beams'])[1]!['refractedAngle'] = 1 }, /정상입사/],
    ['법칙 지연 다름', (s: Json) => { objs(body(s)['beams'])[1]!['beamDelay'] = 18e-6 }, /시간축이나 지연/],
    ['법칙 시간축 다름', (s: Json) => { objs(body(s)['beams'])[1]!['ascanStart'] = 0 }, /시간축이나 지연/],
    ['법칙별 게이트 다름', (s: Json) => { objs(body(s)['gates'])[0]!['starts'] = [1e-6, 2e-6, 3e-6, 4e-6] }, /법칙별 게이트/],
    ['스큐 미확인', (s: Json) => { obj(objs(s['wedges'])[0]!['positioning'])!['skewAngle'] = 0 }, /스큐/],
    ['시편 표면 다름', (s: Json) => { obj(objs(s['wedges'])[0]!['positioning'])!['surfaceId'] = 1 }, /시편 표면/],
    ['시편 표면 미확인', (s: Json) => { delete objs(s['dataMappings'])[0]!['surfaceId']; delete obj(objs(s['wedges'])[0]!['positioning'])!['surfaceId'] }, /시편 표면/],
    ['종파 외 기법', (s: Json) => { body(s)['waveMode'] = 'Shear' }, /종파 0°/]
  ])('%s 이면 명시적인 이유로 차단한다', (_, change, reason) => {
    const s = fixture(); change(s)
    expect(info(s).groups[0]!.supported).toBe(false)
    expect(info(s).groups[0]!.reason).toMatch(reason)
  })

  it('상태 0 칸의 잔존 진폭만 지우고 취득·포화 상태와 진폭은 보존한다', () => {
    const a = new Int16Array([10, 20, 30, 40, 91, 92, 93, 94, 32767, 32767, 100, 50])
    const st = new Uint8Array([1, 0, 3])
    expect(maskPaintbrushAmplitude(a, st, 4)).toBe(true)
    expect([...a]).toEqual([10, 20, 30, 40, 0, 0, 0, 0, 32767, 32767, 100, 50])
    expect([...st]).toEqual([1, 0, 3])
    expect(maskPaintbrushAmplitude(new Int16Array(8), new Uint8Array([1]), 4)).toBe(false)
    expect(maskPaintbrushAmplitude(new Int16Array(4), new Uint8Array([8]), 4)).toBe(false)
  })
})

const REAL = '/Users/eu/Downloads/small flat Al R_0002.nde'
describe.skipIf(!existsSync(REAL))('Paintbrush 실파일 읽기 전용', () => {
  it('1201×57×348 격자·깊이·게이트를 읽고 14 미취득 행의 진폭을 마스킹한다', async () => {
    const sha = (): string => createHash('sha256').update(readFileSync(REAL)).digest('hex')
    const before = sha()
    const r = await readViewerInfo(REAL), g = r.groups[0]!
    expect(g).toMatchObject({ supported: true, verified: false, shape: [1201, 57, 348], storageMode: 'Paintbrush' })
    expect(g.scan).toEqual({ offsetMm: 0, resolutionMm: 0.25, count: 1201 })
    expect(g.spatialAxis).toEqual({ kind: 'index', offsetMm: 1.75, resolutionMm: 0.5, count: 57 })
    expect(g.beams[0]).toMatchObject({ angleDeg: 0, skewDeg: 90, velocityMps: 2450, vOffsetMm: 1.75, t0Us: 0 })
    expect(g.beams[56]!.vOffsetMm).toBe(29.75)
    expect(samplePoint(g.beams[0]!, 347, g.ultrasound).depthMm).toBeCloseTo(17.003, 10)
    const c = await readViewerChunk(REAL, g, 1186, 15)
    expect(c.status).toBeInstanceOf(Uint8Array)
    expect([...c.status!.slice(0, 57)]).toEqual(Array(57).fill(1))
    expect(c.status!.slice(57).every((v) => v === 0)).toBe(true)
    expect(c.amplitude.slice(0, 57 * 348).some((v) => v > 0)).toBe(true)
    expect(c.amplitude.slice(57 * 348).every((v) => v === 0)).toBe(true)
    await expect(readViewerChunk(REAL, { ...g, statusPath: '/missing' }, 0, 1)).rejects.toMatchObject({ reason: 'corrupt', detail: expect.stringMatching(/matching 8-bit status grid/) })
    await expect(readViewerChunk(REAL, { ...g, statusPath: null }, 0, 1)).rejects.toMatchObject({ reason: 'corrupt', detail: expect.stringMatching(/matching 8-bit status grid/) })
    expect(sha()).toBe(before)
  })
})
