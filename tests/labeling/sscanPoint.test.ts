/**
 * 라벨 모드 좌표 (shared/imaging sscanPoint·viewport — 순수):
 *  - S-scan 한 점 조회(sscanLookupAt)가 픽셀 중심에서 조회표(buildSscanMap)와 같은 값 (섹토리얼·리니어·컴파운드·스큐 270·거꾸로 저장, 실데이터 X3)
 *  - 점의 진폭(sscanRawAt)이 renderSscan 이 그 픽셀에 칠한 색 번호와 같음
 *  - 조회 → 앵커 빔·샘플이 shared/labels derive pointToAnchor 와 같고, anchorToPoint 로 되돌리면 같은 점 (왕복)
 *  - 뷰 화면 ↔ 검사 좌표 (S·C·B·A-scan 축) 왕복, 지금 그리기 함수(cscanXForScan·cscanYForBeam·viewportPixel)와 같은 자리
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import {
  axisToPx,
  buildSscanMap,
  cscanBeamAtY,
  cscanBeamViewAxis,
  cscanScanAtX,
  cscanXForScan,
  cscanYForBeam,
  cssToView,
  depthToY,
  pxToAxis,
  rawIndexFactor,
  rawToIndex,
  renderSscan,
  scanIndexAtMm,
  scanPositionMm,
  scanViewAxis,
  sscanExtent,
  sscanLookupAt,
  sscanLookupBeamSample,
  sscanRawAt,
  viewToCss,
  viewToPx,
  viewportPixel,
  yToDepth,
  type SscanViewport,
  type ViewViewport,
  type ViewerGroup
} from '@shared/imaging'
import { anchorToPoint, pointToAnchor } from '@shared/labels'
import { X3_FILES } from '../paths'
import { synthGroup, synthPa, synthVolume } from './synth'

function viewportFor(g: Pick<ViewerGroup, 'beams' | 'ultrasound'>, width = 160, height = 120): SscanViewport {
  const e = sscanExtent(g)
  return { vMinMm: e.vMinMm - 1, vMaxMm: e.vMaxMm + 1, depthMinMm: Math.max(0, e.depthMinMm - 1), depthMaxMm: e.depthMaxMm + 1, width, height }
}

/** 조회표 픽셀 중심 — buildSscanMap 과 같은 식 */
function pixelCenter(vp: SscanViewport, px: number, py: number): { v: number; d: number } {
  const dv = (vp.vMaxMm - vp.vMinMm) / vp.width
  const dd = (vp.depthMaxMm - vp.depthMinMm) / vp.height
  return { v: vp.vMinMm + (px + 0.5) * dv, d: vp.depthMinMm + (py + 0.5) * dd }
}

/** 모든 픽셀에서 조회 = 조회표 (같은 빔·같은 샘플 칸·같은 Float32 비율). 칠한 픽셀 수를 돌려준다 */
function compareWithMap(g: Pick<ViewerGroup, 'beams' | 'ultrasound'>, vp: SscanViewport): number {
  const map = buildSscanMap(g, vp)
  const nt = g.ultrasound.count
  let inside = 0
  for (let py = 0; py < vp.height; py++) {
    for (let px = 0; px < vp.width; px++) {
      const p = py * vp.width + px
      const { v, d } = pixelCenter(vp, px, py)
      const l = sscanLookupAt(g, v, d)
      if (map.beam0[p]! < 0) {
        expect(l, `(${px}, ${py}) 조회표 밖`).toBeNull()
        continue
      }
      inside++
      expect(l, `(${px}, ${py}) 조회표 안`).not.toBeNull()
      const j0 = Math.min(nt - 2, Math.floor(l!.sample0))
      const j1 = Math.min(nt - 2, Math.floor(l!.sample1))
      expect(l!.beam0).toBe(map.beam0[p])
      expect(l!.beam1).toBe(map.beam1[p])
      expect(l!.beam0 * nt + j0).toBe(map.at0[p])
      expect(l!.beam1 * nt + j1).toBe(map.at1[p])
      expect(Math.fround(l!.sample0 - j0)).toBe(map.frac0[p])
      expect(Math.fround(l!.sample1 - j1)).toBe(map.frac1[p])
      expect(Math.fround(l!.weight)).toBe(map.weight[p])
    }
  }
  return inside
}

describe('S-scan 한 점 조회 = 조회표 (buildSscanMap 밖으로 꺼낸 역변환)', () => {
  const groups: Array<[string, ViewerGroup]> = [
    ['섹토리얼 스큐 90', synthGroup(90)],
    ['섹토리얼 스큐 270', synthGroup(270)],
    ['리니어', synthPa('pa-linear')],
    ['리니어 거꾸로 저장', synthPa('pa-linear', 90, true)],
    ['컴파운드', synthPa('pa-compound')],
    ['컴파운드 스큐 270', synthPa('pa-compound', 270)]
  ]
  for (const [name, g] of groups) {
    it(`${name}: 모든 픽셀에서 빔·샘플 칸·비율이 같다`, () => {
      const inside = compareWithMap(g, viewportFor(g))
      expect(inside).toBeGreaterThan(1000)
    })
  }

  it('점의 진폭 = renderSscan 이 그 픽셀에 칠한 색 번호 (데이터 없음 빔은 null)', () => {
    const g = synthGroup(90)
    const vol = synthVolume(g)
    const vp = viewportFor(g, 120, 90)
    const map = buildSscanMap(g, vp)
    const [, nb, nt] = g.shape
    const factor = rawIndexFactor(g.ampScale)
    const id = new Uint8Array(256 * 3)
    for (let i = 0; i < 256; i++) id[i * 3] = i
    for (const k of [0, 1, 4]) {
      const out = new Uint8ClampedArray(vp.width * vp.height * 4)
      renderSscan({ map, amplitude: vol.amplitude, offset: k * nb * nt, status: vol.status, statusOffset: k * nb, indexFactor: factor, palette: id, noData: [255, 255, 255], background: [0, 0, 0, 0], out })
      let checked = 0
      let noData = 0
      for (let py = 0; py < vp.height; py++) {
        for (let px = 0; px < vp.width; px++) {
          const p = py * vp.width + px
          if (map.beam0[p]! < 0) continue
          const { v, d } = pixelCenter(vp, px, py)
          const raw = sscanRawAt(sscanLookupAt(g, v, d)!, vol, g.shape, k)
          if (raw === null) {
            noData++
            expect(out[p * 4]).toBe(255) // 데이터 없음 색
            continue
          }
          expect(rawToIndex(raw, factor)).toBe(out[p * 4])
          checked++
        }
      }
      expect(checked).toBeGreaterThan(1000)
      if (k === 1) expect(noData).toBeGreaterThan(0)
      else expect(noData).toBe(0)
    }
  })

  it('부채꼴 밖·깊이 0 이하·샘플 범위 밖은 null', () => {
    const g = synthGroup(90)
    expect(sscanLookupAt(g, 0, 0)).toBeNull()
    expect(sscanLookupAt(g, 0, -3)).toBeNull()
    expect(sscanLookupAt(g, -200, 10)).toBeNull()
    expect(sscanLookupAt(g, 0, 500)).toBeNull()
    expect(sscanLookupAt({ beams: g.beams.slice(0, 1), ultrasound: g.ultrasound }, 0, 10)).toBeNull()
  })

  it('조회 → 앵커 빔·샘플 = derive pointToAnchor, anchorToPoint 로 되돌리면 같은 점 (왕복 1e-6 mm)', () => {
    for (const g of [synthGroup(90), synthGroup(270), synthPa('pa-linear'), synthPa('pa-compound')]) {
      const e = sscanExtent(g)
      let n = 0
      for (let i = 0; i < 400; i++) {
        const v = e.vMinMm + ((i * 37) % 101) / 100 * (e.vMaxMm - e.vMinMm)
        const d = e.depthMinMm + 1 + ((i * 53) % 97) / 96 * (e.depthMaxMm - e.depthMinMm - 2)
        const l = sscanLookupAt(g, v, d)
        const a = pointToAnchor(g, 2, v, d)
        expect(l === null).toBe(a === null)
        if (!l || !a) continue
        n++
        const bs = sscanLookupBeamSample(l)
        expect(bs.beam).toBeCloseTo(a.beam, 9)
        expect(bs.sample).toBeCloseTo(a.sample, 7)
        const back = anchorToPoint(g, { scanIndex: 2, beam: bs.beam, sample: bs.sample }, null)!
        expect(Math.hypot(back.vMm - v, back.unfoldedDepthMm - d)).toBeLessThan(1e-6)
      }
      expect(n).toBeGreaterThan(80)
    }
  })
})

describe('뷰 화면 ↔ 검사 좌표 (shared/imaging viewport)', () => {
  it('축 값 ↔ 위치 왕복, 뒤집힌 축', () => {
    for (const a of [
      { from: 3.5, to: 51 },
      { from: 70.5, to: 39.5 }
    ]) {
      for (const v of [a.from, a.to, (a.from + a.to) / 2, a.from + 0.123]) {
        expect(pxToAxis(a, axisToPx(a, v, 437), 437)).toBeCloseTo(v, 9)
      }
      expect(axisToPx(a, a.from, 437)).toBeCloseTo(0, 9)
      expect(axisToPx(a, a.to, 437)).toBeCloseTo(437, 9)
    }
  })

  it('S-scan: viewToCss = viewportPixel (CSS 크기), cssToView 왕복', () => {
    const vp: ViewViewport = { kind: 'sscan', groupId: 0, beam: 14, scanWindow: [3, 4], cssWidth: 446, cssHeight: 247, x: { from: -31.2, to: 34.3 }, y: { from: 3.55, to: 50.99 } }
    const sv: SscanViewport = { vMinMm: -31.2, vMaxMm: 34.3, depthMinMm: 3.55, depthMaxMm: 50.99, width: 446, height: 247 }
    for (const [v, d] of [
      [0, 12],
      [-20.5, 30.25],
      [33, 4]
    ] as const) {
      const p = viewToCss(vp, v, d)
      const q = viewportPixel(sv, v, d)
      expect(p.x).toBeCloseTo(q.x, 9)
      expect(p.y).toBeCloseTo(q.y, 9)
      const back = cssToView(vp, p.x, p.y)
      expect(back.x).toBeCloseTo(v, 9)
      expect(back.y).toBeCloseTo(d, 9)
      // 캔버스 버퍼(2배)도 같은 비율
      const b = viewToPx(vp, v, d, 892, 494)
      expect(b.x).toBeCloseTo(p.x * 2, 9)
      expect(b.y).toBeCloseTo((p.y * 494) / 247, 9)
    }
  })

  it('C-scan: 스캔 mm·빔 축 = cscanXForScan·cscanYForBeam (창·뒤집힘 모두), 포인터 고르기 식의 역', () => {
    const scan = { offsetMm: -12.5, resolutionMm: 0.5, count: 400 }
    const nb = 31
    const W = 952
    const H = 122
    for (const [k0, k1] of [
      [0, 400],
      [100, 201],
      [37, 47]
    ] as const) {
      for (const reversed of [false, true]) {
        const ax = { x: scanViewAxis(scan, k0, k1), y: cscanBeamViewAxis(nb, reversed) }
        for (const k of [k0, k1 - 1, Math.floor((k0 + k1) / 2)]) {
          for (const b of [0, 7, nb - 1]) {
            const p = viewToPx(ax, scanPositionMm(k, scan), b, W, H)
            expect(p.x).toBeCloseTo(cscanXForScan(k, W, k0, k1), 9)
            expect(p.y).toBeCloseTo(cscanYForBeam(b, H, nb, reversed), 9)
            // CscanView 의 고르기 식: cscanScanAtX(x/W·pw − 0.5) — 칸 가운데를 누르면 그 칸
            expect(Math.round(cscanScanAtX(p.x - 0.5, W, k0, k1))).toBe(k)
            expect(Math.round(cscanBeamAtY(p.y - 0.5, H, nb, reversed))).toBe(b)
            expect(scanIndexAtMm(scan, pxToAxis(ax.x, p.x, W))).toBeCloseTo(k, 9)
          }
        }
      }
    }
  })

  it('A·B-scan 깊이 ↔ 세로 위치 왕복 (AscanView Y() 와 같은 식)', () => {
    const r = { startMm: 2.83, endMm: 39.6 }
    for (const d of [2.83, 10, 24.4, 39.6]) {
      const y = depthToY(r, d, 1062)
      expect(y).toBeCloseTo(((d - r.startMm) / (r.endMm - r.startMm)) * 1062, 9)
      expect(yToDepth(r, y, 1062)).toBeCloseTo(d, 9)
    }
  })
})

describe.skipIf(!existsSync(X3_FILES[0]!))('실데이터 X3 12T-SV-01: 한 점 조회 = 조회표, 점 진폭 = 그린 색', () => {
  it('두 그룹 모두', async () => {
    const info = await readViewerInfo(X3_FILES[0]!)
    for (const g of info.groups.filter((x) => x.supported)) {
      const vp = viewportFor(g, 140, 100)
      expect(compareWithMap(g, vp)).toBeGreaterThan(3000)
      const k = 39
      const ch = await readViewerChunk(X3_FILES[0]!, g, k, 1)
      const map = buildSscanMap(g, vp)
      const factor = rawIndexFactor(g.ampScale)
      const id = new Uint8Array(256 * 3)
      for (let i = 0; i < 256; i++) id[i * 3] = i
      const out = new Uint8ClampedArray(vp.width * vp.height * 4)
      renderSscan({ map, amplitude: ch.amplitude, offset: 0, status: ch.status, statusOffset: 0, indexFactor: factor, palette: id, noData: [255, 255, 255], background: [0, 0, 0, 0], out })
      const one: ViewerGroup = { ...g, shape: [1, g.shape[1], g.shape[2]] }
      let checked = 0
      for (let p = 0; p < vp.width * vp.height; p += 7) {
        if (map.beam0[p]! < 0) continue
        const { v, d } = pixelCenter(vp, p % vp.width, Math.floor(p / vp.width))
        const raw = sscanRawAt(sscanLookupAt(g, v, d)!, ch, one.shape, 0)
        if (raw === null) continue
        expect(rawToIndex(raw, factor)).toBe(out[p * 4])
        checked++
      }
      expect(checked).toBeGreaterThan(300)
    }
  })
})
