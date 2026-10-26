import { describe, expect, it } from 'vitest'
import { beamAxisValue, beamLabel, buildSscanMap, createGateCscan, cscanBeamAxis, fillGateCscan,
  renderBscan, renderCscan, renderSscan, sscanExtent, sscanLookupAt, sscanOutline, sscanRawAt, type ViewerGroup } from '@shared/imaging'
import { omniCscanIndexAxis } from '@shared/imaging/cscanExport'

const group: ViewerGroup = {
  id: 0, name: 'mapping', technique: 'pa-linear', supported: true, reason: null, verified: false,
  storageMode: 'Paintbrush', spatialAxis: { kind: 'index', offsetMm: 1.75, resolutionMm: 0.5, count: 4 },
  amplitudePath: 'amplitude', statusPath: 'status', shape: [2, 4, 6], bytes: 96,
  ampScale: { rawMax: 32767, unitMax: 200 }, scan: { offsetMm: 0, resolutionMm: 0.25, count: 2 },
  ultrasound: { resolutionUs: 1, count: 6 },
  beams: Array.from({ length: 4 }, (_, index) => ({ index, angleDeg: 0, skewDeg: 90, velocityMps: 2000, uOffsetMm: 0, vOffsetMm: 1.75 + 0.5 * index, t0Us: 1 })),
  gates: [{ id: 1, name: 'Gate A', geometry: 'TrueDepth', sync: 'Pulse', startUs: [1], lengthUs: [5], thresholdPct: 0, supported: true, producesCscan: true }],
  cscanGateId: 1, initialBeam: 0, gainDb: 0, referenceGainDb: null, referenceAmplitudePct: null
}
const amplitude = new Int16Array(48)
for (let b = 0; b < 4; b++) for (let i = 0; i < 6; i++) amplitude[b * 6 + i] = 100 * b + 10 * i
// 미취득 행에도 큰 원시 진폭이 남아 있는 실제 Paintbrush 사례를 재현한다.
amplitude.fill(32767, 24)
const status = Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0])
const palette = new Uint8Array(256 * 3)
for (let i = 0; i < 256; i++) palette[i * 3] = i
const noData = [128, 129, 130] as const

describe('Paintbrush 공간 격자 표시와 미취득 마스크', () => {
  it('C-scan 축과 내보내기 값은 인덱스 mm이며 채널 중앙 좌표가 일치한다', () => {
    expect(cscanBeamAxis(group)).toEqual({ kind: 'index', first: 1.5, last: 3.5, unit: 'mm', title: '인덱스 위치' })
    expect([0, 1, 2, 3].map((b) => beamAxisValue(group, b))).toEqual([1.75, 2.25, 2.75, 3.25])
    expect(beamLabel(group, 2)).toBe('인덱스 2.75 mm')
    expect(omniCscanIndexAxis(group)).toEqual({ unit: 'mm', values: [1.75, 2.25, 2.75, 3.25], start: 1.75, resolution: 0.5, confirmed: false })
  })

  it('0° 단면은 같은 깊이의 샘플을 보간하며 옆 채널까지의 사선 음로를 사용하지 않는다', () => {
    const lookup = sscanLookupAt(group, 2.5, 3)!
    expect(lookup).toEqual({ beam0: 1, beam1: 2, weight: 0.5, sample0: 2, sample1: 2 })
    expect(sscanRawAt(lookup, { amplitude, status }, group.shape, 0)).toBe(170)
    expect(sscanExtent(group)).toEqual({ vMinMm: 1.5, vMaxMm: 3.5, depthMinMm: 1, depthMaxMm: 6 })
    expect(sscanOutline(group)).toEqual([{ vMm: 1.5, depthMm: 1 }, { vMm: 3.5, depthMm: 1 }, { vMm: 3.5, depthMm: 6 }, { vMm: 1.5, depthMm: 6 }])
    expect(sscanLookupAt(group, 1.499, 3)).toBeNull()
    expect(sscanLookupAt(group, 2.5, 6.001)).toBeNull()
  })

  it('한 점 조회와 화면 조회표가 같고 정확한 채널 중앙에서는 이웃 상태에 의존하지 않는다', () => {
    const vp = { vMinMm: 1.5, vMaxMm: 3.5, depthMinMm: 1, depthMaxMm: 6, width: 4, height: 5 }
    const map = buildSscanMap(group, vp)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
      const p = y * 4 + x
      expect(map.beam0[p]).toBe(x); expect(map.beam1[p]).toBe(x)
      expect(map.frac0[p]).toBe(0.5); expect(map.weight[p]).toBe(0)
    }
    const partial = status.slice(); partial[1] = 0
    expect(sscanRawAt(sscanLookupAt(group, 1.75, 3)!, { amplitude, status: partial }, group.shape, 0)).toBe(20)
    expect(sscanRawAt(sscanLookupAt(group, 2, 3)!, { amplitude, status: partial }, group.shape, 0)).toBeNull()
  })

  it('미취득 셀에 32767이 남아 있어도 C/B/S-scan 및 읽기값에 신호를 만들지 않는다', () => {
    const cs = createGateCscan(group, 1)
    fillGateCscan(cs, group, group.gates[0]!, { amplitude, status, scanStart: 0, scanCount: 2 })
    expect(cs.peakSample.slice(0, 4).every((v) => v >= 0)).toBe(true)
    expect(cs.peakRaw[3]).toBe(350)
    expect(Array.from(cs.peakSample.slice(4))).toEqual([-1, -1, -1, -1])
    expect(sscanRawAt(sscanLookupAt(group, 2.5, 3)!, { amplitude, status }, group.shape, 1)).toBeNull()
    const map = buildSscanMap(group, { vMinMm: 1.5, vMaxMm: 3.5, depthMinMm: 1, depthMaxMm: 6, width: 4, height: 5 })
    const s = new Uint8ClampedArray(4 * 5 * 4)
    renderSscan({ map, amplitude, offset: 24, status, statusOffset: 4, indexFactor: 255 / 32767, palette, noData, background: [0, 0, 0, 0], out: s })
    for (let p = 0; p < 20; p++) expect(Array.from(s.slice(p * 4, p * 4 + 3))).toEqual(noData)
    const c = new Uint8ClampedArray(2 * 4 * 4)
    renderCscan({ cscan: cs, width: 2, height: 4, reversed: false, indexFactor: 255 / 32767, palette, noData, out: c })
    for (let y = 0; y < 4; y++) expect(Array.from(c.slice((y * 2 + 1) * 4, (y * 2 + 1) * 4 + 3))).toEqual(noData)
    const b = new Uint8ClampedArray(2 * 5 * 4)
    renderBscan({ group, amplitude, status, beam: 0, width: 2, height: 5, indexFactor: 255 / 32767, palette, noData, out: b })
    for (let y = 0; y < 5; y++) expect(Array.from(b.slice((y * 2 + 1) * 4, (y * 2 + 1) * 4 + 3))).toEqual(noData)
  })
})
