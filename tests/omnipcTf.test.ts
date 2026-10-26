/**
 * OmniPC 6.6 화면 대조: OmniScan X4 NDE 4.2 컴파운드(TF_01_C_L_0001 GR-1)·리니어(TF_01_L_0001 GR-2).
 * tests/fixtures/omnipc/TF_*.json 에는 화면에서 읽은 값(눈금 [값, 픽셀]·선과 경계 픽셀·패널 숫자)만 둔다.
 * 픽셀 → mm·°·빔 번호는 같은 화면 눈금의 직선 회귀로 바꾼다 (눈금 잔차 0.3 px 이하). 우리 계산값은 아래 '회귀 스냅샷' 에 따로.
 * 캡처 PNG 가 있으면 C-scan 무늬 상관·S-scan 경계(톱니) 픽셀 대조도 한다.
 * PAUT_VIEWER_SHOTS=<폴더> 를 주면 캡처와 우리 그림을 위아래로 붙인 그림·반투명 겹친 그림·경계 차이 그림을 저장한다.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPath, withH5File } from '@core/nde/h5'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import {
  DEG,
  VIEWER_NO_DATA_SPECIAL_INDEX,
  ascanDepthRange,
  beamLabel,
  beamNumber,
  buildSscanMap,
  createGateCscan,
  cscanBeamAxis,
  fillGateCscan,
  findGate,
  gatePeakAt,
  gateSampleWindow,
  hexToRgb,
  paletteRgb,
  rawIndexFactor,
  rawToPercent,
  renderCscan,
  renderSscan,
  scanIndexAt,
  scanPositionMm,
  soundPathMm,
  sscanExtent,
  type GateCscan,
  type SscanViewport,
  type ViewerFileInfo,
  type ViewerGroup,
  type ViewerVolumeChunk
} from '@shared/imaging'
import { blend, crop, readPng, stack, writePng, type Rgba } from './helpers/png'
import { TOOL_ROOT, X4_TF_COMPOUND, X4_TF_LINEAR } from './paths'

type Pt = [number, number]
type Box = [number, number, number, number]

interface Fixture {
  screenshot: string
  file: string
  group: string
  technique: string
  layout: string
  groupMode: string
  cursor: { scanMm: number; beam: number; angleDeg?: number }
  readings: { aPercent: number; gainDb: number; refGainDb: number; autoPct: number }
  ascan: { depthTicksPx: Pt[]; imageXPx: [number, number] }
  sscan: { imageBoxPx: Box; vTicksPx: Pt[]; depthTicksPx: Pt[]; firstBeamLinePx: Pt[]; lastBeamEdgePx: Pt[]; gateLinesYPx: [number, number] }
  cscan: { imageBoxPx: Box; axis: 'angle' | 'beam'; beamTicksPx: Pt[]; firstBeamAtBottom: boolean; scanTicksPx: Pt[]; cursorYPx: number }
}

const fixture = (name: string): Fixture => JSON.parse(readFileSync(resolve(import.meta.dirname, `fixtures/omnipc/${name}.json`), 'utf8')) as Fixture

const CASES = [
  { path: X4_TF_COMPOUND, fix: fixture('TF_01_C_L_0001') },
  { path: X4_TF_LINEAR, fix: fixture('TF_01_L_0001') }
]

const POS_TOL = 0.5 // mm (계획 결정 6)
const PCT_TOL = 0.1 // %p
const AXIS_TOL = 0.1 // ° 또는 빔 번호 (컴파운드 38 px/°, 리니어 16.4 px/빔 → 1.6~3.8 px)

/** 눈금 [값, 픽셀] 직선 회귀 → 픽셀 ↔ 값 */
interface Ruler {
  toValue: (px: number) => number
  toPx: (v: number) => number
  pxPerUnit: number
}
function ruler(ticks: Pt[]): Ruler {
  const n = ticks.length
  const mv = ticks.reduce((s, t) => s + t[0], 0) / n
  const mp = ticks.reduce((s, t) => s + t[1], 0) / n
  let svp = 0
  let svv = 0
  for (const [v, p] of ticks) {
    svp += (v - mv) * (p - mp)
    svv += (v - mv) ** 2
  }
  const b = svp / svv
  const a = mp - b * mv
  return { toValue: (px) => (px - a) / b, toPx: (v) => a + b * v, pxPerUnit: b }
}

const loaded = new Map<string, Promise<{ info: ViewerFileInfo; g: ViewerGroup; chunk: ViewerVolumeChunk }>>()
function load(c: (typeof CASES)[number]): Promise<{ info: ViewerFileInfo; g: ViewerGroup; chunk: ViewerVolumeChunk }> {
  let p = loaded.get(c.path)
  if (!p) {
    p = (async () => {
      const info = await readViewerInfo(c.path)
      const g = info.groups.find((x) => x.name === c.fix.group)!
      const chunk = await readViewerChunk(c.path, g, 0, g.shape[0])
      return { info, g, chunk }
    })()
    loaded.set(c.path, p)
  }
  return p
}

function gateCscanOf(g: ViewerGroup, chunk: ViewerVolumeChunk): GateCscan {
  const gate = findGate(g, g.cscanGateId)!
  const cs = createGateCscan(g, gate.id)
  fillGateCscan(cs, g, gate, chunk)
  return cs
}

/** 캡처 S-scan 영상 상자를 그대로 덮는 뷰포트 (픽셀 경계 → mm) */
function sscanViewport(f: Fixture): SscanViewport {
  const v = ruler(f.sscan.vTicksPx)
  const d = ruler(f.sscan.depthTicksPx)
  const [x0, y0, x1, y1] = f.sscan.imageBoxPx
  return { vMinMm: v.toValue(x0), vMaxMm: v.toValue(x1), depthMinMm: d.toValue(y0), depthMaxMm: d.toValue(y1), width: x1 - x0, height: y1 - y0 }
}

/**
 * 캡처 S-scan 픽셀 분류: 1 = 데이터, 0 = 바탕(검정), -1 = 모름.
 * 모름 = 덮개선(회색 점선·개선선, 빨간 게이트선, 초록 CL, 파란 빔선)과 경계 흐림. 0 % 근처 흰색은 밝아서 데이터로 남는다.
 */
function sscanPixelClass(r: number, g: number, b: number): -1 | 0 | 1 {
  const s = r + g + b
  if (s < 45) return 0
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  if (mx - mn < 25 && lum < 235) return -1
  if (r > 150 && g < 120 && b < 120) return -1
  if (g > 140 && r < 80 && b < 120) return -1
  if (b > 200 && r < 90 && g < 90) return -1
  return s > 150 ? 1 : -1
}

function correlation(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb)
    saa += (a[i]! - ma) ** 2
    sbb += (b[i]! - mb) ** 2
  }
  return sab / Math.sqrt(saa * sbb)
}

/** RGB → 가장 가까운 색표 번호 (색표에 없는 색 = 커서선 등은 -1) */
function paletteIndexer(pal: Uint8Array): (r: number, g: number, b: number) => number {
  const cache = new Map<number, number>()
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b
    let v = cache.get(key)
    if (v !== undefined) return v
    let best = Infinity
    v = -1
    for (let i = 0; i < 256; i++) {
      const e = (pal[i * 3]! - r) ** 2 + (pal[i * 3 + 1]! - g) ** 2 + (pal[i * 3 + 2]! - b) ** 2
      if (e < best) {
        best = e
        v = i
      }
    }
    if (best > 300) v = -1
    cache.set(key, v)
    return v
  }
}

const screens = new Map<string, Rgba>()
function screenOf(f: Fixture): Rgba {
  let s = screens.get(f.screenshot)
  if (!s) {
    s = readPng(resolve(TOOL_ROOT, f.screenshot))
    screens.set(f.screenshot, s)
  }
  return s
}

for (const c of CASES) {
  const f = c.fix
  const SHOT = resolve(TOOL_ROOT, f.screenshot)
  describe.skipIf(!existsSync(c.path))(`OmniPC 6.6 화면 대조: ${f.file} ${f.group} (${f.technique})`, () => {
    it(`파일 화면 상태 = 캡처: ${f.layout} ${f.groupMode}, 현재 그룹 ${f.group}, 첫 빔이 아래, 처음 빔 ${f.cursor.beam}`, async () => {
      const { info, g } = await load(c)
      expect(info.formatFamily).toBe('4.x')
      expect(info.display).toMatchObject({ layout: f.layout.replaceAll('-', ''), layoutGroupMode: f.groupMode, currentGroupId: g.id, cscanReversed: f.cscan.firstBeamAtBottom })
      expect(g.technique).toBe(f.technique)
      expect(g.initialBeam).toBe(f.cursor.beam)
      if (f.cursor.angleDeg !== undefined) expect(g.beams[g.initialBeam]!.angleDeg).toBe(f.cursor.angleDeg)
      expect(scanIndexAt(f.cursor.scanMm, g.scan)).toBe(0)
    })

    it('그릴 수 있고 OmniPC 대조 완료(verified)', async () => {
      const { g } = await load(c)
      expect([g.supported, g.reason, g.verified]).toEqual([true, null, true])
    })

    it(`DATA 패널 Gain ${f.readings.gainDb} dB = 파일 gain − referenceGain, Ref ${f.readings.refGainDb} dB, Auto ${f.readings.autoPct} %`, async () => {
      const { g } = await load(c)
      expect(Math.abs(g.gainDb! - g.referenceGainDb! - f.readings.gainDb)).toBeLessThanOrEqual(0.05)
      expect(g.referenceGainDb).toBeCloseTo(f.readings.refGainDb, 6)
      expect(g.referenceAmplitudePct).toBe(f.readings.autoPct)
    })

    it(`A% (스캔 ${f.cursor.scanMm} mm, 빔 ${f.cursor.beam}, 게이트 A) = ${f.readings.aPercent} %`, async () => {
      const { g, chunk } = await load(c)
      const peak = gatePeakAt(gateCscanOf(g, chunk), g, scanIndexAt(f.cursor.scanMm, g.scan), f.cursor.beam)!
      expect(Math.abs(peak.pct - f.readings.aPercent)).toBeLessThanOrEqual(PCT_TOL)
    })

    it('A-scan 깊이축 = 화면 A-scan 가로 범위 ±0.5 mm', async () => {
      const { g } = await load(c)
      const r = ruler(f.ascan.depthTicksPx)
      const range = ascanDepthRange(g, f.cursor.beam)
      expect(Math.abs(r.toValue(f.ascan.imageXPx[0]) - range.startMm)).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(r.toValue(f.ascan.imageXPx[1]) - range.endMm)).toBeLessThanOrEqual(POS_TOL)
    })

    it('S-scan 범위 = 화면 S-scan 영상 범위 ±0.5 mm (OmniPC 기본 확대 = 데이터 범위)', async () => {
      const { g } = await load(c)
      const vp = sscanViewport(f)
      const e = sscanExtent(g)
      expect(Math.abs(vp.vMinMm - e.vMinMm)).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(vp.vMaxMm - e.vMaxMm)).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(vp.depthMinMm - e.depthMinMm)).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(vp.depthMaxMm - e.depthMaxMm)).toBeLessThanOrEqual(POS_TOL)
    })

    it('S-scan 첫 빔 선(파란 현재 빔)·마지막 빔 경계가 빔 직선과 ±0.5 mm (수직 거리)', async () => {
      const { g } = await load(c)
      const v = ruler(f.sscan.vTicksPx)
      const d = ruler(f.sscan.depthTicksPx)
      const nb = g.beams.length
      const pairs: Array<[number, Pt[]]> = [
        [0, f.sscan.firstBeamLinePx],
        [nb - 1, f.sscan.lastBeamEdgePx]
      ]
      for (const [b, pts] of pairs) {
        const beam = g.beams[b]!
        const th = beam.angleDeg * DEG
        for (const [x, y] of pts) {
          const depth = d.toValue(y)
          const vLine = beam.vOffsetMm + depth * Math.tan(th) // skew 90
          expect(Math.abs((v.toValue(x) - vLine) * Math.cos(th)), `빔 ${b} (${x}, ${y})`).toBeLessThanOrEqual(POS_TOL)
        }
      }
    })

    it('게이트 A 빨간 점선 = 모든 빔의 게이트 시작·끝 깊이 ±0.5 mm', async () => {
      const { g } = await load(c)
      const d = ruler(f.sscan.depthTicksPx)
      const [y0, y1] = f.sscan.gateLinesYPx
      const gate = findGate(g, g.cscanGateId)!
      expect(gate.geometry).toBe('TrueDepth')
      g.beams.forEach((beam, b) => {
        const cos = Math.cos(beam.angleDeg * DEG)
        expect(Math.abs(soundPathMm(beam, gate.startUs[b]!) * cos - d.toValue(y0)), `빔 ${b} 시작`).toBeLessThanOrEqual(POS_TOL)
        expect(Math.abs(soundPathMm(beam, gate.startUs[b]! + gate.lengthUs[b]!) * cos - d.toValue(y1)), `빔 ${b} 끝`).toBeLessThanOrEqual(POS_TOL)
      })
    })

    it(`C-scan 세로축(${f.cscan.axis === 'angle' ? '굴절각' : '빔 번호'}): 화면 눈금으로 읽은 영상 위·아래 끝 = cscanBeamAxis ±0.1, 커서 = 처음 빔`, async () => {
      const { info, g } = await load(c)
      const r = ruler(f.cscan.beamTicksPx)
      const [, top, , bottom] = f.cscan.imageBoxPx
      const ax = cscanBeamAxis(g)
      expect(ax.kind).toBe(f.cscan.axis)
      expect(info.display.cscanReversed).toBe(f.cscan.firstBeamAtBottom)
      // 첫 빔이 아래면 아래 끝 = first
      const [atBottom, atTop] = f.cscan.firstBeamAtBottom ? [ax.first, ax.last] : [ax.last, ax.first]
      expect(Math.abs(r.toValue(bottom) - atBottom)).toBeLessThanOrEqual(AXIS_TOL)
      expect(Math.abs(r.toValue(top) - atTop)).toBeLessThanOrEqual(AXIS_TOL)
      // 화면 커서 자리: 각도 축은 그 빔 각도(칸 가운데), 빔 번호 축은 빔 번호(1부터, OmniPC 는 칸 [n, n+1] 의 끝 n 에 그림)
      const cursor = r.toValue(f.cscan.cursorYPx)
      if (ax.kind === 'angle') expect(Math.abs(cursor - g.beams[g.initialBeam]!.angleDeg)).toBeLessThanOrEqual(AXIS_TOL)
      else expect(Math.round(cursor)).toBe(beamNumber(g.initialBeam))
    })

    it('C-scan 스캔축: 화면 눈금 0 mm ~ 끝 = 첫·끝 스캔 칸 위치', async () => {
      const { g } = await load(c)
      const [[v0], [v1]] = [f.cscan.scanTicksPx[0]!, f.cscan.scanTicksPx.at(-1)!]
      expect(scanPositionMm(0, g.scan)).toBe(v0)
      expect(scanPositionMm(g.scan.count - 1, g.scan)).toBe(v1)
    })

    it('빔 이름표', async () => {
      const { g } = await load(c)
      expect(beamLabel(g, 0)).toBe(f.cscan.axis === 'angle' ? `${f.cursor.angleDeg}°` : `빔 1 · ${g.beams[0]!.angleDeg}°`)
    })

    it.skipIf(!existsSync(SHOT))('C-scan 무늬: 캡처 색 → 색표 번호와 우리 C-scan 의 상관 ≥ 0.99, 세로로 반 칸(8 px) 옮기면 낮아진다', async () => {
      const { info, g, chunk } = await load(c)
      const screen = screenOf(f)
      const pal = paletteRgb(info.display.palette)
      const toIdx = paletteIndexer(pal)
      const [bx0, by0, bx1, by1] = f.cscan.imageBoxPx
      const sr = ruler(f.cscan.scanTicksPx)
      const ns = g.shape[0]
      const W = Math.round(ns * sr.pxPerUnit)
      const H = by1 - by0
      const ours = new Uint8Array(W * H * 4)
      renderCscan({ cscan: gateCscanOf(g, chunk), width: W, height: H, reversed: info.display.cscanReversed, indexFactor: rawIndexFactor(g.ampScale), palette: pal, noData: hexToRgb(info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080'), out: ours })
      // 캡처 x 픽셀 가운데 → 스캔 칸 좌표 u → 우리 x (cscanScanAtX 의 역)
      const ourX = (x: number): number => Math.round((sr.toValue(x + 0.5) + 0.5) * (W / ns) - 0.5)
      const corrAt = (dy: number): number => {
        const a: number[] = []
        const b: number[] = []
        for (let y = 0; y < H; y += 2) {
          const yy = y + dy
          if (yy < 0 || yy >= H) continue
          // 왼쪽 끝 몇 칸은 스캔 커서(파란 세로선)·눈금자 테두리라 뺀다
          for (let x = bx0 + 9; x < bx1 - 2; x += 3) {
            const q = ((by0 + y) * screen.width + x) * 4
            const s = toIdx(screen.data[q]!, screen.data[q + 1]!, screen.data[q + 2]!)
            const xo = ourX(x)
            if (s < 0 || xo < 0 || xo >= W) continue
            const o = toIdx(ours[(yy * W + xo) * 4]!, ours[(yy * W + xo) * 4 + 1]!, ours[(yy * W + xo) * 4 + 2]!)
            a.push(s)
            b.push(o)
          }
        }
        return correlation(a, b)
      }
      const r0 = corrAt(0)
      expect(r0).toBeGreaterThanOrEqual(0.99)
      expect(r0).toBeGreaterThan(corrAt(-8))
      expect(r0).toBeGreaterThan(corrAt(8))
    })

    it.skipIf(!existsSync(SHOT))('S-scan 경계(시작·끝 톱니 포함): 캡처와 우리 조회표의 안/밖이 다른 픽셀 < 데이터 픽셀의 1.5 %', async () => {
      const { g } = await load(c)
      const screen = screenOf(f)
      const vp = sscanViewport(f)
      const map = buildSscanMap(g, vp)
      const [x0, y0] = f.sscan.imageBoxPx
      let inside = 0
      let bad = 0
      for (let y = 0; y < vp.height; y++) {
        for (let x = 0; x < vp.width; x++) {
          const q = ((y0 + y) * screen.width + x0 + x) * 4
          const s = sscanPixelClass(screen.data[q]!, screen.data[q + 1]!, screen.data[q + 2]!)
          if (s < 0) continue
          if (s === 1) inside++
          if ((map.beam0[y * vp.width + x]! >= 0 ? 1 : 0) !== s) bad++
        }
      }
      // 2026-10-06 실측: 컴파운드 4433 / 약 38만(1.1 %), 리니어 2805 / 약 34만(0.8 %) — 남은 차이는 경계 1 px 흐림(OmniPC 가 영상 가장자리를 부드럽게 칠함).
      // 경계 규칙을 '가까운 빔 하나의 샘플 범위'로 바꾸면 컴파운드가 약 1만 픽셀(2.7 %)로 늘어난다
      expect(bad / inside).toBeLessThan(0.015)
    })
  })
}

/**
 * 회귀 스냅샷 — 우리 계산값을 그대로 고정한다 (OmniPC 정답 아님, 2026-10-06 계산). 정답표 JSON 에는 넣지 않는다.
 * 게이트 창 [i0, i1) 은 gates.ts 규칙 (4.x 에서도 3.x 와 같은 반올림, 이 두 점은 창 끝을 ±1 샘플 바꿔도 최대값이 같아 창 끝 규칙의 판별력은 없음).
 */
const SNAP: Record<string, { raw: number; pct: number; sample: number; window: [number, number]; extent: [number, number, number, number] }> = {
  [X4_TF_COMPOUND]: { raw: 427, pct: 2.606, sample: 340, window: [53, 452], extent: [-36.81, 38.58, 4.08, 42.35] },
  [X4_TF_LINEAR]: { raw: 536, pct: 3.272, sample: 128, window: [31, 587], extent: [-35.47, 35.27, 10.0, 34.99] }
}

for (const c of CASES) {
  const snap = SNAP[c.path]!
  describe.skipIf(!existsSync(c.path))(`회귀 스냅샷 (우리 계산값, 정답 아님): ${c.fix.file} ${c.fix.group}`, () => {
    it(`게이트 A 최대 (스캔 0, 빔 0): raw ${snap.raw} = ${snap.pct} %, 샘플 ${snap.sample}, 창 [${snap.window.join(', ')})`, async () => {
      const { g, chunk } = await load(c)
      const cs = gateCscanOf(g, chunk)
      expect(cs.peakRaw[0]).toBe(snap.raw)
      const peak = gatePeakAt(cs, g, 0, 0)!
      expect(peak.pct).toBeCloseTo(snap.pct, 2)
      expect(peak.sample).toBe(snap.sample)
      expect(gateSampleWindow(g, findGate(g, g.cscanGateId)!, 0)).toEqual(snap.window)
    })

    it('S-scan 데이터 범위 (V, 깊이 mm)', async () => {
      const { g } = await load(c)
      const e = sscanExtent(g)
      const got = [e.vMinMm, e.vMaxMm, e.depthMinMm, e.depthMaxMm]
      got.forEach((v, i) => expect(v).toBeCloseTo(snap.extent[i]!, 2))
    })
  })
}

/**
 * 장비 RawCScan 교차 확인 (테스트 전용, 조사_보고.md L7 · 4_NDE설정.md 6절): 4.x 도 3.x 와 같은 꼴
 * [스캔, 전체 빔(그룹 차례로 이음), 게이트 I·A·B] 24 B {u32 상태, u32 피크 raw, f32 ×4}. 캡처 A% 2.6 / 3.3 자리의 장비 값이
 * 우리 게이트 A 최대와 정수로 같다.
 */
const RAWC_4X = { path: 'Private/MXU/RawCScan', gateSlots: 3, gateSlotA: 1, recordBytes: 24, peakRawAt: 4 }
const RAWC_POINTS: Record<string, { raw: number; pct: number }> = {
  [X4_TF_COMPOUND]: { raw: 427, pct: 2.606 },
  [X4_TF_LINEAR]: { raw: 536, pct: 3.272 }
}

for (const c of CASES) {
  const point = RAWC_POINTS[c.path]!
  describe.skipIf(!existsSync(c.path))(`장비 RawCScan 교차 확인 (테스트 전용): ${c.fix.file} ${c.fix.group}`, () => {
    it(`[스캔 0, 빔 0, 게이트 A] 장비 raw ${point.raw} = ${point.pct} % = 우리 게이트 A 최대`, async () => {
      const { info, g, chunk } = await load(c)
      const records = await withH5File(c.path, (f) => {
        const ent = getPath(f, RAWC_4X.path)
        const v = ent && 'value' in ent ? (ent as { value: unknown }).value : null
        if (!(v instanceof Uint8Array)) throw new Error(`${RAWC_4X.path}: 바이트 배열로 읽히지 않음`)
        return v
      })
      const beamsTotal = info.groups.reduce((n, x) => n + x.shape[1], 0)
      const beamBase = info.groups.slice(0, info.groups.indexOf(g)).reduce((n, x) => n + x.shape[1], 0)
      expect(records.byteLength).toBe(g.shape[0] * beamsTotal * RAWC_4X.gateSlots * RAWC_4X.recordBytes)
      const rec = new DataView(records.buffer, records.byteOffset + (beamBase * RAWC_4X.gateSlots + RAWC_4X.gateSlotA) * RAWC_4X.recordBytes, RAWC_4X.recordBytes)
      const raw = rec.getUint32(RAWC_4X.peakRawAt, true)
      expect(raw).toBe(point.raw)
      expect(rawToPercent(raw, g.ampScale)).toBeCloseTo(point.pct, 3)
      const cs = gateCscanOf(g, chunk)
      expect(cs.peakRaw[0]).toBe(raw)
      expect(Math.abs(gatePeakAt(cs, g, 0, 0)!.pct - c.fix.readings.aPercent)).toBeLessThanOrEqual(PCT_TOL)
    })
  })
}

const SHOTS = process.env['PAUT_VIEWER_SHOTS']
describe.skipIf(!SHOTS)('대조 그림 저장 (PAUT_VIEWER_SHOTS)', () => {
  for (const c of CASES) {
    const f = c.fix
    it.skipIf(!existsSync(c.path) || !existsSync(resolve(TOOL_ROOT, f.screenshot)))(f.file, async () => {
      const dir = SHOTS!
      mkdirSync(dir, { recursive: true })
      const { info, g, chunk } = await load(c)
      const screen = screenOf(f)
      const pal = paletteRgb(info.display.palette)
      const noData = hexToRgb(info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080')
      const tag = f.technique === 'pa-compound' ? '컴파운드' : '리니어'
      // S-scan: 캡처 영상 상자와 같은 mm 범위·픽셀 크기로
      const vp = sscanViewport(f)
      const map = buildSscanMap(g, vp)
      const ours: Rgba = { width: vp.width, height: vp.height, data: new Uint8Array(vp.width * vp.height * 4) }
      const k = scanIndexAt(f.cursor.scanMm, g.scan)
      renderSscan({ map, amplitude: chunk.amplitude, offset: k * g.shape[1] * g.shape[2], status: chunk.status, statusOffset: k * g.shape[1], indexFactor: rawIndexFactor(g.ampScale), palette: pal, noData, background: [0, 0, 0, 255], out: ours.data })
      const shot = crop(screen, ...f.sscan.imageBoxPx)
      writePng(resolve(dir, `${tag}_sscan_대조.png`), stack([shot, ours], 6))
      writePng(resolve(dir, `${tag}_sscan_겹침.png`), blend(shot, ours, 0.5))
      // 경계 차이: 회색 = 둘 다 데이터, 빨강 = 캡처에만, 하늘 = 우리만, 검정 = 둘 다 바탕 또는 덮개선
      const diff: Rgba = { width: vp.width, height: vp.height, data: new Uint8Array(vp.width * vp.height * 4) }
      for (let p = 0; p < vp.width * vp.height; p++) {
        const s = sscanPixelClass(shot.data[p * 4]!, shot.data[p * 4 + 1]!, shot.data[p * 4 + 2]!)
        const o = map.beam0[p]! >= 0
        const rgb = s === 1 && o ? [90, 90, 90] : s === 1 ? [255, 0, 0] : s === 0 && o ? [0, 160, 255] : [0, 0, 0]
        diff.data.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], p * 4)
      }
      writePng(resolve(dir, `${tag}_sscan_경계차이.png`), diff)
      // C-scan: 캡처 영상 상자 크기로
      const [cx0, cy0, cx1, cy1] = f.cscan.imageBoxPx
      const cimg: Rgba = { width: cx1 - cx0, height: cy1 - cy0, data: new Uint8Array((cx1 - cx0) * (cy1 - cy0) * 4) }
      renderCscan({ cscan: gateCscanOf(g, chunk), width: cimg.width, height: cimg.height, reversed: info.display.cscanReversed, indexFactor: rawIndexFactor(g.ampScale), palette: pal, noData, out: cimg.data })
      writePng(resolve(dir, `${tag}_cscan_대조.png`), stack([crop(screen, cx0, cy0, cx1, cy1), cimg], 6))
    })
  }
})
