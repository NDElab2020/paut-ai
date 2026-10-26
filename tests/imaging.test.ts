/** 이미지 계산 (shared/imaging) — 가짜 그룹으로 위치를 아는 반사체를 심어 확인 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AMPLITUDE_PALETTE,
  DEG,
  beamAxisValue,
  beamLabel,
  beamNumber,
  buildSscanMap,
  chunkRanges,
  createGateCscan,
  cscanBeamAtY,
  cscanBeamAxis,
  cscanXForScan,
  cscanYForBeam,
  fillGateCscan,
  foldDepth,
  gatePeakAt,
  gateSampleWindow,
  paletteRgb,
  percentToIndex,
  rawIndexFactor,
  rawToIndex,
  renderCscan,
  renderSscan,
  sampleAtDepth,
  samplePoint,
  scanIndexAt,
  skewSign,
  sscanExtent,
  viewportPixel,
  type GateCscan,
  type SscanViewport,
  type ViewerGate,
  type ViewerGroup
} from '@shared/imaging'

const NB = 31
const NT = 808

/** X3 12T-SV 와 비슷한 가짜 그룹 (40~70°, 출사점이 각도에 따라 움직임) */
function synthGroup(skewDeg = 90): ViewerGroup {
  const s = skewDeg === 90 ? 1 : -1
  return {
    id: 0,
    name: 'synth',
    technique: 'pa-sectorial',
    supported: true,
    reason: null,
    verified: false,
    amplitudePath: null,
    statusPath: null,
    shape: [5, NB, NT],
    bytes: 5 * NB * NT * 2,
    ampScale: { rawMax: 32767, unitMax: 200 },
    scan: { offsetMm: 0, resolutionMm: 1, count: 5 },
    ultrasound: { resolutionUs: 0.04, count: NT },
    beams: Array.from({ length: NB }, (_, b) => ({
      index: b,
      angleDeg: 40 + b,
      skewDeg,
      velocityMps: 3240,
      uOffsetMm: 0,
      vOffsetMm: s * (-38.3 + b * 0.33),
      t0Us: 8.05
    })),
    gates: [],
    cscanGateId: null,
    initialBeam: 15,
    gainDb: null,
    referenceGainDb: null,
    referenceAmplitudePct: null
  }
}

function viewportFor(g: ViewerGroup, width = 400, height = 300): SscanViewport {
  const e = sscanExtent(g)
  return { vMinMm: e.vMinMm - 1, vMaxMm: e.vMaxMm + 1, depthMinMm: Math.max(0, e.depthMinMm - 1), depthMaxMm: e.depthMaxMm + 1, width, height }
}

const PAL = paletteRgb(DEFAULT_AMPLITUDE_PALETTE)
/** 시험용 색표: R = 색 번호, G·B = 0 → 그린 픽셀의 R 로 색 번호를 바로 읽는다 */
const ID = new Uint8Array(256 * 3)
for (let i = 0; i < 256; i++) ID[i * 3] = i
const GRAY = [128, 128, 128] as const
const SCALE = { rawMax: 32767, unitMax: 200 }
const FACTOR = rawIndexFactor(SCALE)
/** %FSH → raw (정수) */
const rawOf = (pct: number): number => Math.round((pct / SCALE.unitMax) * SCALE.rawMax)

/** R 이 가장 큰 픽셀들의 중심 (alpha 0 은 건너뜀) */
function brightest(out: Uint8Array, width: number, height: number): { r: number; x: number; y: number } {
  let r = -1
  let sx = 0
  let sy = 0
  let n = 0
  for (let p = 0; p < width * height; p++) {
    if (out[p * 4 + 3] === 0) continue
    const v = out[p * 4]!
    if (v < r) continue
    if (v > r) {
      r = v
      sx = 0
      sy = 0
      n = 0
    }
    sx += p % width
    sy += Math.floor(p / width)
    n++
  }
  return { r, x: sx / n, y: sy / n }
}

/** 칸 전부 데이터 있음(peakSample 0)인 빈 C-scan */
function blankCscan(scanCount: number, beamCount: number): GateCscan {
  const cs = createGateCscan({ shape: [scanCount, beamCount, 10] }, 1)
  cs.peakSample.fill(0)
  return cs
}

function drawCscan(cs: GateCscan, width: number, height: number, reversed: boolean, palette: Uint8Array = ID): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  renderCscan({ cscan: cs, width, height, reversed, indexFactor: FACTOR, palette, noData: GRAY, out })
  return out
}

const px4 = (o: Uint8Array, width: number, x: number, y: number): number[] => [...o.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)]

describe('색표·진폭', () => {
  it('기본 색표 256색, 0% 흰색, 100% 암적색', () => {
    expect(DEFAULT_AMPLITUDE_PALETTE).toHaveLength(256)
    expect(DEFAULT_AMPLITUDE_PALETTE[0]).toBe('ffffff')
    expect(DEFAULT_AMPLITUDE_PALETTE[255]).toBe('8c031d')
    expect([...PAL.subarray(255 * 3)]).toEqual([0x8c, 0x03, 0x1d])
  })
  it('색 번호: round(% × 2.55), 100% 이상은 마지막 색', () => {
    expect(percentToIndex(0)).toBe(0)
    expect(percentToIndex(-3)).toBe(0)
    expect(percentToIndex(1.6)).toBe(4)
    expect(percentToIndex(40)).toBe(102)
    expect(percentToIndex(100)).toBe(255)
    expect(percentToIndex(180)).toBe(255)
    expect(rawIndexFactor({ rawMax: 32767, unitMax: 200 }) * 16383.5).toBeCloseTo(255, 6)
  })
  it('그리기와 같은 경로 rawToIndex(raw, rawIndexFactor) 경계값', () => {
    expect(rawToIndex(rawOf(0), FACTOR)).toBe(0)
    expect(rawToIndex(rawOf(1.6), FACTOR)).toBe(4)
    expect(rawToIndex(rawOf(40), FACTOR)).toBe(102)
    expect(rawToIndex(rawOf(100), FACTOR)).toBe(255)
    expect(rawToIndex(rawOf(100) + 1, FACTOR)).toBe(255)
    expect(rawToIndex(32767, FACTOR)).toBe(255)
    expect(rawToIndex(-500, FACTOR)).toBe(0)
    // 반올림 경계 3.5: raw 224 → 3.486 → 3, raw 225 → 3.502 → 4
    expect(rawToIndex(224, FACTOR)).toBe(3)
    expect(rawToIndex(225, FACTOR)).toBe(4)
    // percentToIndex 도 같은 규칙
    for (const pct of [0, 1.4, 1.6, 40, 99.9, 100, 150]) expect(percentToIndex(pct)).toBe(rawToIndex(pct, 2.55))
  })
  it('그린 색이 반올림 규칙을 따른다 (1.6 % → 색표 4번, raw 224/225 → 3번/4번)', () => {
    const g = synthGroup()
    const vp = viewportFor(g, 60, 40)
    const map = buildSscanMap(g, vp)
    const inside = [...map.beam0].findIndex((b) => b >= 0)
    const cases: Array<[number, number]> = [
      [rawOf(1.6), 4],
      [224, 3],
      [225, 4]
    ]
    for (const [raw, want] of cases) {
      const entry = [...PAL.subarray(want * 3, want * 3 + 3)]
      const amp = new Int16Array(NB * NT).fill(raw)
      const out = new Uint8Array(vp.width * vp.height * 4)
      renderSscan({ map, amplitude: amp, offset: 0, indexFactor: FACTOR, palette: PAL, noData: GRAY, background: [0, 0, 0, 0], out })
      expect([...out.subarray(inside * 4, inside * 4 + 3)]).toEqual(entry)
      const cs = blankCscan(5, 4)
      cs.peakRaw.fill(raw)
      const co = drawCscan(cs, 13, 9, false, PAL)
      expect(px4(co, 13, 0, 0)).toEqual(entry)
      expect(px4(co, 13, 7, 5)).toEqual(entry)
    }
    expect([...PAL.subarray(4 * 3, 4 * 3 + 3)]).toEqual([0xee, 0xf5, 0xfc])
  })
  it('색 개수가 틀리면 기본 색표', () => {
    expect([...paletteRgb(['ff0000'])]).toEqual([...PAL])
  })
})

describe('좌표', () => {
  it('스큐 방향', () => {
    expect(skewSign(90)).toBe(1)
    expect(skewSign(270)).toBe(-1)
    expect(skewSign(-90)).toBe(-1)
    expect(skewSign(0)).toBeNull()
  })
  it('스캔 칸은 반올림 (OmniPC 38.93 mm → 39번째 칸), 범위로 자름', () => {
    const axis = { offsetMm: 0, resolutionMm: 1, count: 301 }
    expect(scanIndexAt(38.93, axis)).toBe(39)
    expect(scanIndexAt(38.4, axis)).toBe(38)
    expect(scanIndexAt(-5, axis)).toBe(0)
    expect(scanIndexAt(999, axis)).toBe(300)
    expect(scanIndexAt(42.6, { offsetMm: 42, resolutionMm: 1, count: 45 })).toBe(1)
  })
  it('펼친 깊이를 두께 안으로 접고 레그 번호를 붙인다', () => {
    expect(foldDepth(5, 12)).toEqual({ depthMm: 5, leg: 1 })
    expect(foldDepth(15, 12)).toEqual({ depthMm: 9, leg: 2 })
    expect(foldDepth(26, 12)).toEqual({ depthMm: 2, leg: 3 })
    expect(foldDepth(12, 12)).toEqual({ depthMm: 12, leg: 2 })
    expect(foldDepth(7, null)).toEqual({ depthMm: 7, leg: null })
  })
  it('샘플 ↔ 깊이 왕복', () => {
    const g = synthGroup()
    const b = g.beams[10]!
    const p = samplePoint(b, 400, g.ultrasound)
    expect(sampleAtDepth(b, p.depthMm, g.ultrasound)).toBeCloseTo(400, 9)
    // 깊이 = r cosθ, V = vOff + r sinθ
    const r = (3240e-3 * (8.05 + 400 * 0.04)) / 2
    expect(p.depthMm).toBeCloseTo(r * Math.cos(50 * DEG), 9)
    expect(p.vMm).toBeCloseTo(b.vOffsetMm + r * Math.sin(50 * DEG), 9)
  })
})

/** render2.py 방식 그대로 (모든 빔의 φ 부호 세기) — 이분 탐색 결과와 같아야 한다 */
function bruteBeam0(g: ViewerGroup, vp: SscanViewport, px: number, py: number): number {
  const x = vp.vMinMm + ((px + 0.5) * (vp.vMaxMm - vp.vMinMm)) / vp.width
  const z = vp.depthMinMm + ((py + 0.5) * (vp.depthMaxMm - vp.depthMinMm)) / vp.height
  let pos = 0
  for (const b of g.beams) {
    const s = skewSign(b.skewDeg)!
    if (Math.atan2(s * (x - b.vOffsetMm), z) - b.angleDeg * DEG >= 0) pos++
  }
  return pos >= 1 && pos <= g.beams.length - 1 ? pos - 1 : -1
}

describe('S-scan', () => {
  for (const skew of [90, 270]) {
    it(`이분 탐색 빔 찾기 = 전수 계산 (skew ${skew})`, () => {
      const g = synthGroup(skew)
      const vp = viewportFor(g, 120, 90)
      const map = buildSscanMap(g, vp)
      let inside = 0
      for (let py = 0; py < vp.height; py++) {
        for (let px = 0; px < vp.width; px++) {
          const want = bruteBeam0(g, vp, px, py)
          const got = map.beam0[py * vp.width + px]!
          // 샘플 범위 밖이면 map 은 -1 (전수 계산은 빔만 봄)
          if (got >= 0) {
            expect(got).toBe(want)
            inside++
          }
        }
      }
      expect(inside).toBeGreaterThan(1000)
    })

    it(`심은 반사체가 그린 그림에서 계산 위치 ±1 px 에 나온다 (skew ${skew})`, () => {
      const g = synthGroup(skew)
      const vp = viewportFor(g)
      const map = buildSscanMap(g, vp)
      const amp = new Int16Array(NB * NT)
      const bHit = 12
      const iHit = 420
      // 최대 15000 raw ≈ 색 번호 233 (255 에 닿지 않게 해서 최대 위치가 한 덩어리로 나오게)
      for (let b = bHit - 1; b <= bHit + 1; b++) {
        for (let i = iHit - 6; i <= iHit + 6; i++) {
          amp[b * NT + i] = Math.round(15000 * Math.exp(-((i - iHit) ** 2) / 8 - (b - bHit) ** 2 / 0.6))
        }
      }
      const out = new Uint8Array(vp.width * vp.height * 4)
      renderSscan({ map, amplitude: amp, offset: 0, indexFactor: rawIndexFactor(g.ampScale), palette: ID, noData: GRAY, background: [0, 0, 0, 0], out })
      // 그린 픽셀의 R(= 색 번호)이 가장 큰 곳
      const top = brightest(out, vp.width, vp.height)
      expect(top.r).toBeGreaterThan(200)
      expect(top.r).toBeLessThan(255)
      const want = samplePoint(g.beams[bHit]!, iHit, g.ultrasound)
      const px = viewportPixel(vp, want.vMm, want.depthMm)
      expect(Math.abs(top.x + 0.5 - px.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(top.y + 0.5 - px.y)).toBeLessThanOrEqual(1)
      // 부채꼴 밖은 배경(투명), 안은 불투명
      expect(out[3]).toBe(0)
    })

    it(`샘플 축 보간: 음로를 따라 오르는 진폭이 깊이 방향으로 끊김 없이 오른다 (skew ${skew})`, () => {
      // 모든 빔 진폭 = 샘플 380~412 에서 0 → 16000 raw (색 번호 ≈ 샘플당 7.8). 샘플 사이 비율이 뒤집히면 톱니가 된다
      const g = synthGroup(skew)
      const amp = new Int16Array(NB * NT)
      for (let b = 0; b < NB; b++) for (let i = 0; i < NT; i++) amp[b * NT + i] = Math.max(0, Math.min(16000, (i - 380) * 500))
      // 빔 15 의 샘플 396 둘레를 크게 확대 (세로 픽셀 하나 ≈ 샘플 0.04 개)
      const c = samplePoint(g.beams[15]!, 396, g.ultrasound)
      const vp: SscanViewport = { vMinMm: c.vMm - 0.1, vMaxMm: c.vMm + 0.1, depthMinMm: c.depthMm - 0.3, depthMaxMm: c.depthMm + 0.3, width: 5, height: 120 }
      const map = buildSscanMap(g, vp)
      const out = new Uint8Array(vp.width * vp.height * 4)
      renderSscan({ map, amplitude: amp, offset: 0, indexFactor: rawIndexFactor(g.ampScale), palette: ID, noData: GRAY, background: [0, 0, 0, 0], out })
      for (let x = 0; x < vp.width; x++) {
        const col: number[] = []
        for (let y = 0; y < vp.height; y++) if (out[(y * vp.width + x) * 4 + 3] === 255) col.push(out[(y * vp.width + x) * 4]!)
        expect(col.length).toBe(vp.height)
        for (let y = 1; y < col.length; y++) expect(col[y]!).toBeGreaterThanOrEqual(col[y - 1]!)
        // 위아래 끝은 램프 안 (포화·0 이 아님) → 실제로 오르는 구간을 본다
        expect(col[0]!).toBeGreaterThan(20)
        expect(col[col.length - 1]!).toBeLessThan(235)
        expect(col[col.length - 1]! - col[0]!).toBeGreaterThan(40)
      }
    })
  }

  it('데이터 없음 빔은 회색', () => {
    const g = synthGroup()
    const vp = viewportFor(g, 60, 40)
    const map = buildSscanMap(g, vp)
    const amp = new Int16Array(NB * NT)
    const status = new Uint8Array(NB) // 전부 hasData 0
    const out = new Uint8Array(vp.width * vp.height * 4)
    renderSscan({ map, amplitude: amp, offset: 0, status, indexFactor: rawIndexFactor(g.ampScale), palette: PAL, noData: [128, 128, 128], background: [0, 0, 0, 255], out })
    const inside = [...map.beam0].findIndex((b) => b >= 0)
    expect([...out.subarray(inside * 4, inside * 4 + 3)]).toEqual([128, 128, 128])
  })
})

/**
 * 리니어·컴파운드 가짜 그룹 (TF_01_L GR-2 · TF_01_C_L GR-1 과 비슷한 배치).
 * 리니어: 모두 60°, 출사점이 빔마다 +0.64 mm. 컴파운드: 50~68° 와 출사점 +1.26 mm 가 함께 움직임.
 * storedReversed 면 파일에 빔이 거꾸로(마지막 개구부터) 저장된 경우.
 */
function synthPa(technique: 'pa-linear' | 'pa-compound', skewDeg = 90, storedReversed = false): ViewerGroup {
  const g = synthGroup(skewDeg)
  const s = skewDeg === 90 ? 1 : -1
  const n = technique === 'pa-linear' ? 24 : 19
  const beams = Array.from({ length: n }, (_, k) => ({
    index: k,
    angleDeg: technique === 'pa-linear' ? 60 : 50 + k,
    skewDeg,
    velocityMps: 3240,
    uOffsetMm: 0,
    vOffsetMm: s * (technique === 'pa-linear' ? -52.8 + k * 0.64 : -45.15 + k * 1.26),
    t0Us: 8.05
  }))
  const ordered = storedReversed ? beams.reverse().map((b, i) => ({ ...b, index: i })) : beams
  return { ...g, technique, shape: [5, n, NT], beams: ordered }
}

/** 전수 계산: (굴절각, s·V) 순서로 놓고 φ ≥ 0 인 빔 수를 센다 → 앞 빔 번호 (파일 번호) */
function bruteBeam0Sorted(g: ViewerGroup, vp: SscanViewport, px: number, py: number): number {
  const x = vp.vMinMm + ((px + 0.5) * (vp.vMaxMm - vp.vMinMm)) / vp.width
  const z = vp.depthMinMm + ((py + 0.5) * (vp.depthMaxMm - vp.depthMinMm)) / vp.height
  const key = (b: ViewerGroup['beams'][number]): [number, number] => [b.angleDeg, skewSign(b.skewDeg)! * b.vOffsetMm]
  const order = [...g.beams].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1])
  let pos = 0
  for (const b of order) {
    const s = skewSign(b.skewDeg)!
    if (Math.atan2(s * (x - b.vOffsetMm), z) - b.angleDeg * DEG >= 0) pos++
  }
  return pos >= 1 && pos <= order.length - 1 ? order[pos - 1]!.index : -1
}

describe('S-scan 리니어·컴파운드 (빔 순서 = (굴절각, s·출사점 V))', () => {
  for (const technique of ['pa-linear', 'pa-compound'] as const) {
    for (const skew of [90, 270]) {
      for (const storedReversed of [false, true]) {
        it(`이분 탐색 = 전수 계산 (${technique}, skew ${skew}${storedReversed ? ', 거꾸로 저장' : ''})`, () => {
          const g = synthPa(technique, skew, storedReversed)
          const vp = viewportFor(g, 120, 90)
          const map = buildSscanMap(g, vp)
          let inside = 0
          for (let py = 0; py < vp.height; py++) {
            for (let px = 0; px < vp.width; px++) {
              const got = map.beam0[py * vp.width + px]!
              if (got < 0) continue
              expect(got).toBe(bruteBeam0Sorted(g, vp, px, py))
              inside++
            }
          }
          expect(inside).toBeGreaterThan(1500)
        })
      }
    }

    it(`심은 반사체가 계산 위치 ±1 px, 빔을 거꾸로 저장해도 같은 그림 (${technique})`, () => {
      const g = synthPa(technique)
      const gr = synthPa(technique, 90, true)
      const nb = g.beams.length
      const vp = viewportFor(g)
      const bHit = 9
      const iHit = 420
      const amp = new Int16Array(nb * NT)
      const ampR = new Int16Array(nb * NT)
      for (let b = bHit - 1; b <= bHit + 1; b++) {
        for (let i = iHit - 6; i <= iHit + 6; i++) {
          const v = Math.round(15000 * Math.exp(-((i - iHit) ** 2) / 8 - (b - bHit) ** 2 / 0.6))
          amp[b * NT + i] = v
          ampR[(nb - 1 - b) * NT + i] = v
        }
      }
      const draw = (grp: ViewerGroup, a: Int16Array): Uint8Array => {
        const out = new Uint8Array(vp.width * vp.height * 4)
        renderSscan({ map: buildSscanMap(grp, vp), amplitude: a, offset: 0, indexFactor: rawIndexFactor(grp.ampScale), palette: ID, noData: GRAY, background: [0, 0, 0, 0], out })
        return out
      }
      const out = draw(g, amp)
      const top = brightest(out, vp.width, vp.height)
      expect(top.r).toBeGreaterThan(200)
      const want = samplePoint(g.beams[bHit]!, iHit, g.ultrasound)
      const px = viewportPixel(vp, want.vMm, want.depthMm)
      expect(Math.abs(top.x + 0.5 - px.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(top.y + 0.5 - px.y)).toBeLessThanOrEqual(1)
      expect([...draw(gr, ampR)]).toEqual([...out])
    })
  }

  it('섹토리얼은 굴절각 순서 그대로 (둘째 기준을 쓰지 않음): 거꾸로 저장해도 같은 조회표 (빔 번호만 뒤집힘)', () => {
    const g = synthGroup()
    const gr: ViewerGroup = { ...g, beams: [...g.beams].reverse().map((b, i) => ({ ...b, index: i })) }
    const vp = viewportFor(g, 80, 60)
    const a = buildSscanMap(g, vp)
    const b = buildSscanMap(gr, vp)
    for (let p = 0; p < a.beam0.length; p++) {
      expect(b.beam0[p]).toBe(a.beam0[p]! < 0 ? -1 : NB - 1 - a.beam0[p]!)
      expect(b.weight[p]).toBe(a.weight[p])
    }
  })
})

describe('빔 축 (C-scan 세로축)·빔 이름표', () => {
  it('섹토리얼·컴파운드 = 굴절각 ± 반 칸, 리니어 = 빔 번호 1 ~ nb+1', () => {
    expect(cscanBeamAxis(synthGroup())).toEqual({ kind: 'angle', first: 39.5, last: 70.5, unit: '°', title: '굴절각' })
    expect(cscanBeamAxis(synthPa('pa-compound'))).toEqual({ kind: 'angle', first: 49.5, last: 68.5, unit: '°', title: '굴절각' })
    expect(cscanBeamAxis(synthPa('pa-linear'))).toEqual({ kind: 'beam', first: 1, last: 25, unit: '', title: '빔 번호' })
    // 각도가 모두 같으면 기법과 관계없이 빔 번호 (각도 축이 0 폭이 되지 않게)
    const flat = synthPa('pa-compound')
    expect(cscanBeamAxis({ ...flat, beams: flat.beams.map((b) => ({ ...b, angleDeg: 55 })) }).kind).toBe('beam')
  })

  it('beamAxisValue = C-scan 칸 가운데(cscanYForBeam)의 축 값', () => {
    for (const g of [synthGroup(), synthPa('pa-compound'), synthPa('pa-linear')]) {
      const ax = cscanBeamAxis(g)
      const nb = g.beams.length
      const H = 500
      for (const b of [0, 5, nb - 1]) {
        const y = cscanYForBeam(b, H, nb, false)
        expect(beamAxisValue(g, b)).toBeCloseTo(ax.first + (y / H) * (ax.last - ax.first), 9)
      }
    }
    expect(beamAxisValue(synthPa('pa-compound'), 3)).toBeCloseTo(53, 9)
    expect(beamAxisValue(synthPa('pa-linear'), 0)).toBeCloseTo(1.5, 9)
  })

  it('빔 이름표: 섹토리얼·컴파운드 = 각도, 리니어 = 1부터 빔 번호 + 각도', () => {
    expect(beamLabel(synthGroup(), 14)).toBe('54°')
    expect(beamLabel(synthPa('pa-compound'), 0)).toBe('50°')
    expect(beamLabel(synthPa('pa-linear'), 11)).toBe('빔 12 · 60°')
    expect(beamNumber(0)).toBe(1)
    const half = synthGroup()
    expect(beamLabel({ ...half, beams: half.beams.map((b) => ({ ...b, angleDeg: b.angleDeg + 0.5 })) }, 0)).toBe('40.5°')
  })
})

describe('게이트·C-scan', () => {
  const g = synthGroup()
  // 깊이 10~28 mm (TrueDepth 게이트처럼 빔마다 시작이 다름)
  const startUs = g.beams.map((b) => (2 * (10 / Math.cos(b.angleDeg * DEG))) / 3.24)
  const lengthUs = g.beams.map((b) => (2 * (18 / Math.cos(b.angleDeg * DEG))) / 3.24)
  const gate: ViewerGate = { id: 1, name: 'Gate A', geometry: 'TrueDepth', sync: 'Pulse', startUs, lengthUs, thresholdPct: 20, supported: true, producesCscan: true }

  it('게이트 창 = round((start−t0)/Δt) ~ round((start+len−t0)/Δt) 포함', () => {
    const [i0, i1] = gateSampleWindow(g, gate, 0)
    expect(i0).toBe(Math.round((startUs[0]! - 8.05) / 0.04))
    expect(i1).toBe(Math.round((startUs[0]! + lengthUs[0]! - 8.05) / 0.04) + 1)
    // 창 시작 샘플의 깊이 ≈ 10 mm
    expect(samplePoint(g.beams[0]!, i0, g.ultrasound).depthMm).toBeCloseTo(10, 1)
    // A-scan 시작보다 앞선 게이트는 0 번 샘플부터 (X3 게이트 A 7 mm 가 그렇다)
    const early: ViewerGate = { ...gate, startUs: [1], lengthUs: [10] }
    expect(gateSampleWindow(g, early, 0)[0]).toBe(0)
  })

  it('최대값·위치, 상태 비트, 창 밖 신호 무시', () => {
    const [ns, nb, nt] = g.shape
    const amp = new Int16Array(ns * nb * nt)
    const status = new Uint8Array(ns * nb).fill(3)
    const [w0, w1] = gateSampleWindow(g, gate, 5)
    amp[(2 * nb + 5) * nt + w0 + 10] = 8000 // 창 안
    amp[(2 * nb + 5) * nt + w1 + 50] = 30000 // 창 밖 (무시)
    status[3 * nb + 7] = 0 // 데이터 없음
    const cs = createGateCscan(g, 1)
    fillGateCscan(cs, g, gate, { scanStart: 0, scanCount: ns, amplitude: amp, status })
    const peak = gatePeakAt(cs, g, 2, 5)!
    expect(peak.sample).toBe(w0 + 10)
    expect(peak.pct).toBeCloseTo((8000 / 32767) * 200, 9)
    expect(peak.depthMm).toBeCloseTo(samplePoint(g.beams[5]!, w0 + 10, g.ultrasound).depthMm, 9)
    expect(gatePeakAt(cs, g, 3, 7)).toBeNull()
    expect(gatePeakAt(cs, g, 99, 0)).toBeNull()
  })

  it('조각 단위로 채워도 같은 결과', () => {
    const [ns, nb, nt] = g.shape
    const amp = new Int16Array(ns * nb * nt).map((_, i) => (i * 7919) % 20000)
    const whole = createGateCscan(g, 1)
    fillGateCscan(whole, g, gate, { scanStart: 0, scanCount: ns, amplitude: amp, status: null })
    const parts = createGateCscan(g, 1)
    fillGateCscan(parts, g, gate, { scanStart: 0, scanCount: 2, amplitude: amp.subarray(0, 2 * nb * nt), status: null })
    fillGateCscan(parts, g, gate, { scanStart: 2, scanCount: 3, amplitude: amp.subarray(2 * nb * nt), status: null })
    expect([...parts.peakRaw]).toEqual([...whole.peakRaw])
    expect([...parts.peakSample]).toEqual([...whole.peakSample])
  })

  it('C-scan 방향: reversed 면 첫 빔이 아래', () => {
    expect(cscanBeamAtY(0, 31, 31, false)).toBeCloseTo(0)
    expect(cscanBeamAtY(0, 31, 31, true)).toBeCloseTo(30)
    const cs = createGateCscan({ shape: [4, 3, 10] }, 1)
    cs.peakSample.fill(0)
    for (let k = 0; k < 4; k++) cs.peakRaw[k * 3 + 0] = 32767 // 빔 0 = 200%
    const draw = (reversed: boolean): Uint8Array => {
      const out = new Uint8Array(4 * 3 * 4)
      renderCscan({ cscan: cs, width: 4, height: 3, reversed, indexFactor: rawIndexFactor(g.ampScale), palette: PAL, noData: [128, 128, 128], out })
      return out
    }
    const top = (o: Uint8Array): number[] => [...o.subarray(0, 3)]
    const bottom = (o: Uint8Array): number[] => [...o.subarray(2 * 4 * 4, 2 * 4 * 4 + 3)]
    expect(top(draw(false))).toEqual([0x8c, 0x03, 0x1d])
    expect(bottom(draw(true))).toEqual([0x8c, 0x03, 0x1d])
    expect(top(draw(true))).toEqual([0xff, 0xff, 0xff])
  })

  // 확대 그리기: 스캔 12칸 → 30 px (2.5배), 빔 9칸 → 27 px (3배)
  const S = 12
  const B = 9
  const W = 30
  const H = 27
  for (const reversed of [false, true]) {
    it(`C-scan 한 칸 반사체가 그린 그림에서 칸 중심 ±1 px (reversed ${reversed})`, () => {
      const cs = blankCscan(S, B)
      const k = 7
      const b = 2
      cs.peakRaw[k * B + b] = 15000
      const out = drawCscan(cs, W, H, reversed)
      const top = brightest(out, W, H)
      expect(top.r).toBeGreaterThan(200)
      expect(Math.abs(top.x + 0.5 - cscanXForScan(k, W, 0, S))).toBeLessThanOrEqual(1)
      expect(Math.abs(top.y + 0.5 - cscanYForBeam(b, H, B, reversed))).toBeLessThanOrEqual(1)
    })
  }

  it('C-scan 두 칸 사이 픽셀은 값 보간 (가운데 = 두 값 평균의 색)', () => {
    const cs = blankCscan(S, B)
    cs.peakRaw[2 * B + 4] = 15000
    cs.peakRaw[3 * B + 4] = 5000
    const out = drawCscan(cs, W, H, false)
    // x = 7 → 스캔 2.5, y = 13 → 빔 4.0
    const r = out[(13 * W + 7) * 4]!
    const r2 = out[(13 * W + 6) * 4]! // 스캔 2.1 (칸 2 쪽) = 0.9·15000 + 0.1·5000
    const r3 = out[(13 * W + 8) * 4]! // 스캔 2.9 (칸 3 쪽) = 0.1·15000 + 0.9·5000
    expect(r).toBe(rawToIndex(10000, FACTOR))
    expect(r2).toBe(rawToIndex(14000, FACTOR))
    expect(r3).toBe(rawToIndex(6000, FACTOR))
    expect(rawToIndex(15000, FACTOR)).toBeGreaterThan(r2)
    expect(r3).toBeGreaterThan(rawToIndex(5000, FACTOR))
  })

  it('C-scan 데이터 없음 칸: 가장 가까운 칸이면 회색, 이웃 픽셀은 데이터 있는 칸만으로 보간', () => {
    const cs = blankCscan(S, B)
    cs.peakRaw.fill(15000)
    cs.peakRaw[5 * B + 4] = 0
    cs.peakSample[5 * B + 4] = -1
    const out = drawCscan(cs, W, H, false)
    // 스캔 5 가 가장 가까운 x = 12..14, 빔 4 가 가장 가까운 y = 12..14
    for (let y = 12; y <= 14; y++) for (let x = 12; x <= 14; x++) expect(px4(out, W, x, y)).toEqual([...GRAY])
    const full = rawToIndex(15000, FACTOR)
    // x = 15 (스캔 5.7), x = 11 (스캔 4.1): 이웃에 칸 5 가 있지만 가장 가까운 칸은 데이터 있음 → 데이터 칸 값 그대로
    for (const [x, y] of [
      [15, 13],
      [11, 13],
      [13, 15],
      [13, 11]
    ] as const) {
      expect(px4(out, W, x, y)).toEqual([full, 0, 0])
    }
  })

  for (const k of [1500, 1501, 1502]) {
    it(`C-scan 축소 (3000 스캔 → 1000 px): 한 스캔짜리 100 % 지시가 빠지지 않는다 (스캔 ${k})`, () => {
      const cs = blankCscan(3000, NB)
      cs.peakRaw[k * NB + 15] = 32767
      const out = drawCscan(cs, 1000, NB, false, PAL)
      const red = [0x8c, 0x03, 0x1d]
      const cols: number[] = []
      for (let x = 0; x < 1000; x++) if (px4(out, 1000, x, 15).join() === red.join()) cols.push(x)
      expect(cols.length).toBeGreaterThanOrEqual(1)
      for (const x of cols) expect(Math.abs(x + 0.5 - cscanXForScan(k, 1000, 0, 3000))).toBeLessThanOrEqual(1)
      // 다른 빔 행은 0 % (흰색)
      expect(px4(out, 1000, cols[0]!, 3)).toEqual([0xff, 0xff, 0xff])
    })
  }

  it('C-scan 축소 비율이 정수가 아니어도 (3000 → 997 px, 범위 지정) 지시가 남는다', () => {
    const cs = blankCscan(3000, NB)
    for (const k of [100, 1234, 2999]) cs.peakRaw[k * NB + 0] = 32767
    const out = new Uint8Array(997 * NB * 4)
    renderCscan({ cscan: cs, scanFrom: 50, scanTo: 3000, width: 997, height: NB, reversed: false, indexFactor: FACTOR, palette: ID, noData: GRAY, out })
    for (const k of [100, 1234, 2999]) {
      const x = Math.floor(cscanXForScan(k, 997, 50, 3000))
      const hit = [x - 1, x, x + 1].filter((c) => c >= 0 && c < 997 && out[c * 4] === 255)
      expect(hit.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('C-scan 축소: 픽셀이 덮는 칸이 모두 데이터 없음일 때만 회색', () => {
    const cs = blankCscan(3000, NB)
    for (let b = 0; b < NB; b++) {
      for (const k of [600, 601, 602]) cs.peakSample[k * NB + b] = -1 // 열 200 전부 데이터 없음
      cs.peakSample[900 * NB + b] = -1 // 열 300 은 한 스캔만 데이터 없음
    }
    cs.peakRaw[901 * NB + 10] = 15000
    const out = drawCscan(cs, 1000, NB, false)
    expect(px4(out, 1000, 200, 10)).toEqual([...GRAY])
    expect(px4(out, 1000, 300, 10)).toEqual([rawToIndex(15000, FACTOR), 0, 0])
    expect(px4(out, 1000, 300, 3)).toEqual([0, 0, 0])
  })

  for (const reversed of [false, true]) {
    it(`C-scan 빔 축 축소 (100 빔 → 30 px): 한 빔짜리 지시가 그 행에 남는다 (reversed ${reversed})`, () => {
      const cs = blankCscan(10, 100)
      const b = 37
      cs.peakRaw[5 * 100 + b] = 32767
      const out = drawCscan(cs, 20, 30, reversed, PAL)
      const red = [0x8c, 0x03, 0x1d].join()
      const rows: number[] = []
      for (let y = 0; y < 30; y++) if (px4(out, 20, 10, y).join() === red) rows.push(y)
      expect(rows.length).toBeGreaterThanOrEqual(1)
      for (const y of rows) expect(Math.abs(y + 0.5 - cscanYForBeam(b, 30, 100, reversed))).toBeLessThanOrEqual(1)
      // 줄이지 않는 스캔 축은 그대로 보간 (스캔 5 에서 먼 열은 흰색)
      expect(px4(out, 20, 0, rows[0]!)).toEqual([0xff, 0xff, 0xff])
    })
  }
})

describe('진폭 조각', () => {
  it('32 MB 이하로 나눈다', () => {
    expect(chunkRanges([301, 31, 808])).toEqual([[0, 301]])
    const big = chunkRanges([2000, 64, 1600])
    expect(big.reduce((s, [, n]) => s + n, 0)).toBe(2000)
    for (const [, n] of big) expect(n * 64 * 1600 * 2).toBeLessThanOrEqual(32 * 1024 * 1024)
  })
})
