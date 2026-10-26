/** B-scan 그리기·용접 개선 덮개선 (shared/imaging bscan·weld) */
import { describe, expect, it } from 'vitest'
import {
  bevelHalfWidth,
  bscanYForSample,
  cscanXForScan,
  isDrawableWeld,
  rawIndexFactor,
  renderBscan,
  weldOverlay,
  type ViewerWeld
} from '@shared/imaging'

/** 빨강 = 색 번호인 시험용 색표 */
const ID = new Uint8Array(768)
for (let i = 0; i < 256; i++) ID[i * 3] = i
const SCALE = { rawMax: 32767, unitMax: 200 }

/** X3 12T-SV 시편의 V 개선 (파일 weldGeometry 그대로) */
const X3_WELD: ViewerWeld = {
  bevelShape: 'V',
  symmetry: 'Symmetric',
  offsetMm: 1,
  landHeightMm: 2,
  hotPass: { angleDeg: 30, heightMm: 10 },
  fills: [],
  root: { angleDeg: 0, heightMm: 0 },
  upperCap: { widthMm: 25, heightMm: 2 },
  lowerCap: { widthMm: 6, heightMm: 2 },
  hazWidthMm: 10,
  weldAngleDeg: 0
}

describe('용접 개선 덮개', () => {
  it('X3 V 개선: 바닥 반폭 1 mm(루트), 랜드 2 mm 수직, 표면 반폭 1 + 10·tan30° ≈ 6.77 mm (OmniPC ±6.7)', () => {
    expect(bevelHalfWidth(X3_WELD, 12, 12)).toBeCloseTo(1, 9)
    expect(bevelHalfWidth(X3_WELD, 12, 10)).toBeCloseTo(1, 9)
    expect(bevelHalfWidth(X3_WELD, 12, 0)).toBeCloseTo(1 + 10 * Math.tan(Math.PI / 6), 9)
    expect(bevelHalfWidth(X3_WELD, 12, 5)).toBeCloseTo(1 + 5 * Math.tan(Math.PI / 6), 9)
  })

  it('레그마다 뒤집어 잇는다 (24 mm = 2레그 끝 = 표면 반폭)', () => {
    const o = weldOverlay(X3_WELD, 12, 36, 0.5)!
    expect(o.bevel).toHaveLength(2)
    expect(o.haz).toHaveLength(2)
    const right = o.bevel[0]!
    const at = (d: number): number => right.find(([, dd]) => Math.abs(dd - d) < 1e-9)![0]
    expect(at(0)).toBeCloseTo(6.774, 3)
    expect(at(12)).toBeCloseTo(1, 9)
    expect(at(24)).toBeCloseTo(6.774, 3)
    expect(at(30)).toBeCloseTo(at(6), 9)
    // 왼쪽은 부호만 반대, 열영향부는 개선면 + 10 mm
    expect(o.bevel[1]![10]![0]).toBeCloseTo(-right[10]![0], 9)
    expect(o.haz[0]![10]![0]).toBeCloseTo(right[10]![0] + 10, 9)
  })

  it('Double V: 루트·랜드·핫패스 높이로 목 위치를 계산한다 (중간점 가정 없음)', () => {
    const weld: ViewerWeld = { ...X3_WELD, bevelShape: 'X', template: 'DoubleVOffset', hotPass: { heightMm: 8, angleDeg: 30 }, landHeightMm: 2,
      root: { heightMm: 15, angleDeg: 45 }, upperCap: null, lowerCap: null }
    expect(isDrawableWeld(weld, 25)).toBe(true)
    expect(bevelHalfWidth(weld, 25, 0)).toBeCloseTo(1 + 8 * Math.tan(Math.PI / 6), 9)
    expect(bevelHalfWidth(weld, 25, 8)).toBe(1)
    expect(bevelHalfWidth(weld, 25, 10)).toBe(1)
    expect(bevelHalfWidth(weld, 25, 25)).toBeCloseTo(16, 9)
    const outline = weldOverlay(weld, 25, 50, 0.5)!.bevel[0]!
    const at = (d: number) => outline.find(([, depth]) => depth === d)![0]
    expect(at(33)).toBe(at(17))
    expect(at(50)).toBe(at(0))
  })

  it('OPD 캡처의 11.5 + 2 + 11.5 mm: 양 표면 반폭과 랜드 두 경계가 맞는다', () => {
    const weld: ViewerWeld = { ...X3_WELD, bevelShape: 'unknown', symmetry: null, geometryEstimated: true,
      hotPass: { heightMm: 11.5, angleDeg: 30 }, root: { heightMm: 11.5, angleDeg: 30 }, upperCap: null, lowerCap: null }
    expect(isDrawableWeld(weld, 25)).toBe(true)
    expect(bevelHalfWidth(weld, 25, 0)).toBeCloseTo(bevelHalfWidth(weld, 25, 25), 9)
    expect(bevelHalfWidth(weld, 25, 11.5)).toBe(1)
    expect(bevelHalfWidth(weld, 25, 13.5)).toBe(1)
    expect(isDrawableWeld({ ...weld, offsetMm: Number.NaN }, 25)).toBe(false)
    expect(isDrawableWeld(weld, 24)).toBe(false)
  })

  it('V 외 형상·두께 없음은 그리지 않는다', () => {
    expect(isDrawableWeld({ ...X3_WELD, bevelShape: 'J' }, 12)).toBe(false)
    expect(isDrawableWeld({ ...X3_WELD, symmetry: 'Left' }, 12)).toBe(false)
    expect(weldOverlay(X3_WELD, null, 30)).toBeNull()
    expect(weldOverlay(null, 12, 30)).toBeNull()
  })
})

describe('B-scan', () => {
  const NS = 40
  const NB = 3
  const NT = 100
  const group = { shape: [NS, NB, NT] as [number, number, number] }
  const plant = (k: number, b: number, i: number, raw = 15000): Int16Array => {
    const a = new Int16Array(NS * NB * NT)
    a[(k * NB + b) * NT + i] = raw
    return a
  }
  const draw = (amp: Int16Array, width: number, height: number, status: Uint8Array | null = null, beam = 1): Uint8Array => {
    const out = new Uint8Array(width * height * 4)
    renderBscan({ group, amplitude: amp, status, beam, width, height, indexFactor: rawIndexFactor(SCALE), palette: ID, noData: [7, 7, 7], out })
    return out
  }
  const brightest = (out: Uint8Array, width: number): { x: number; y: number; v: number } => {
    let best = { x: -1, y: -1, v: -1 }
    for (let p = 0; p < out.length / 4; p++) if (out[p * 4]! > best.v) best = { x: p % width, y: Math.floor(p / width), v: out[p * 4]! }
    return best
  }

  it('확대: 심은 점이 (스캔, 샘플) 위치 ±1 px', () => {
    const W = 160
    const H = 300
    const out = draw(plant(25, 1, 60), W, H)
    const b = brightest(out, W)
    expect(b.v).toBeGreaterThan(200)
    expect(Math.abs(b.x + 0.5 - cscanXForScan(25, W, 0, NS))).toBeLessThanOrEqual(1)
    expect(Math.abs(b.y + 0.5 - bscanYForSample(60, H, NT))).toBeLessThanOrEqual(1)
  })

  it('다른 빔의 신호는 안 보인다', () => {
    const out = draw(plant(25, 2, 60), 160, 300, null, 1)
    expect(brightest(out, 160).v).toBe(0)
  })

  it('축소: 한 스캔짜리 지시도 빠지지 않는다 (덮는 스캔의 최대)', () => {
    for (const k of [20, 21, 22]) {
      const out = draw(plant(k, 1, 60, 32767), 13, NT)
      expect(brightest(out, 13).v).toBe(255)
    }
  })

  it('데이터 없음 스캔은 noData 색', () => {
    const status = new Uint8Array(NS * NB).fill(1)
    for (let b = 0; b < NB; b++) status[10 * NB + b] = 0
    const W = NS
    const out = draw(new Int16Array(NS * NB * NT), W, 50, status)
    expect([...out.subarray(10 * 4, 10 * 4 + 3)]).toEqual([7, 7, 7])
    expect([...out.subarray(11 * 4, 11 * 4 + 3)]).toEqual([0, 0, 0])
  })
})
