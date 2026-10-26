/**
 * S-scan 데이터 경계 외곽선 (shared/imaging sscanOutline) — 라이트 테마 외곽선·개선 덮개 클립이 조회표(buildSscanMap)가 칠하는 영역과
 * 같은 경계(컴파운드·리니어 톱니 포함)를 따르는지. 예전 외곽선(빔 첫·끝 샘플 점을 곧게 이은 다각형)은 톱니 홈을 가로질러
 * 컴파운드 600×400 px 에서 데이터의 2.0 %, 최대 10.3 px 를 '데이터 안'으로 감쌌다 (조사_기록.md C절 4).
 * PAUT_VIEWER_SHOTS=<폴더> 면 라이트 테마처럼 그린 그림(데이터 + 외곽선, 아래는 톱니 확대 옛/새)을 '외곽선_<파일>.png' 로 저장한다.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import {
  VIEWER_NO_DATA_SPECIAL_INDEX,
  buildSscanMap,
  createGateCscan,
  fillGateCscan,
  findGate,
  hexToRgb,
  paletteRgb,
  rawIndexFactor,
  renderSscan,
  samplePoint,
  sscanExtent,
  sscanOutline,
  viewportPixel,
  type SscanViewport,
  type ViewerBeam,
  type ViewerFileInfo,
  type ViewerGroup,
  type ViewerVolumeChunk
} from '@shared/imaging'
import { stack, writePng, type Rgba } from './helpers/png'
import { EXAMPLES_DIR, X3_FILES, X4_TF_COMPOUND, X4_TF_LINEAR, listExampleFiles } from './paths'

type Pt = { vMm: number; depthMm: number }
type XY = { x: number; y: number }
type OutlineGroup = Pick<ViewerGroup, 'beams' | 'ultrasound'>

const US = { resolutionUs: 0.04, count: 808 }
const beam = (index: number, angleDeg: number, vOffsetMm: number, skewDeg = 90, t0Us = 8.05, velocityMps = 3240): ViewerBeam => ({
  index,
  angleDeg,
  skewDeg,
  velocityMps,
  uOffsetMm: 0,
  vOffsetMm,
  t0Us
})
/** 가짜 그룹: 섹토리얼(X3 비슷, 출사점이 빔마다 0.33 mm) · 리니어(TF_01_L GR-2 비슷) · 컴파운드(TF_01_C_L 비슷), skew 270 은 V 부호를 뒤집음 */
function synth(kind: 'sectorial' | 'linear' | 'compound', skewDeg = 90, opts: { reversed?: boolean; t0Us?: number } = {}): OutlineGroup {
  const s = skewDeg === 90 ? 1 : -1
  const n = kind === 'sectorial' ? 31 : kind === 'linear' ? 24 : 19
  const beams = Array.from({ length: n }, (_, k) =>
    kind === 'sectorial'
      ? beam(k, 40 + k, s * (-38.3 + k * 0.33), skewDeg, opts.t0Us)
      : kind === 'linear'
        ? beam(k, 60, s * (-52.8 + k * 0.64), skewDeg, opts.t0Us)
        : beam(k, 50 + k, s * (-45.15 + k * 1.26), skewDeg, opts.t0Us)
  )
  return { beams: opts.reversed ? beams.reverse().map((b, i) => ({ ...b, index: i })) : beams, ultrasound: US }
}

/** 조회표로 한 점 판정: 그 점이 픽셀 중심인 1×1 뷰포트 (buildSscanMap 의 규칙 그대로) */
function drawnAt(g: OutlineGroup, vMm: number, depthMm: number): boolean {
  const h = 1e-7
  return buildSscanMap(g, { vMinMm: vMm - h, vMaxMm: vMm + h, depthMinMm: depthMm - h, depthMaxMm: depthMm + h, width: 1, height: 1 }).beam0[0]! >= 0
}

/** 외곽선 변의 가운데에서 변에 수직으로 ±δ: 안쪽은 칠해지고 바깥은 비어야 한다. 틀린 점 수와 검사한 변 수 */
function probeEdges(g: OutlineGroup, outline: Pt[], delta = 0.005): { bad: string[]; checked: number } {
  // 신발끈 넓이 부호로 안쪽 방향(왼쪽/오른쪽 법선)을 정한다
  let area = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    area += a.vMm * b.depthMm - b.vMm * a.depthMm
  }
  const sgn = area > 0 ? 1 : -1
  const bad: string[] = []
  let checked = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    const dv = b.vMm - a.vMm
    const dd = b.depthMm - a.depthMm
    const len = Math.hypot(dv, dd)
    if (len < 4 * delta) continue
    const nv = (-dd / len) * sgn
    const nd = (dv / len) * sgn
    const mv = (a.vMm + b.vMm) / 2
    const md = (a.depthMm + b.depthMm) / 2
    checked++
    if (!drawnAt(g, mv + nv * delta, md + nd * delta)) bad.push(`변 ${i} 안쪽 (${mv.toFixed(3)}, ${md.toFixed(3)}) 이 비어 있음`)
    if (drawnAt(g, mv - nv * delta, md - nd * delta)) bad.push(`변 ${i} 바깥 (${mv.toFixed(3)}, ${md.toFixed(3)}) 이 칠해짐`)
  }
  return { bad, checked }
}

/** 픽셀 중심이 다각형 안인가 (짝홀 규칙, 캔버스 fill 과 같은 판정) */
function insideMask(poly: XY[], W: number, H: number): Uint8Array {
  const m = new Uint8Array(W * H)
  for (let py = 0; py < H; py++) {
    const y = py + 0.5
    const xs: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      if (a.y <= y !== b.y <= y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
    }
    xs.sort((p, q) => p - q)
    for (let j = 0; j + 1 < xs.length; j += 2) for (let px = Math.max(0, Math.ceil(xs[j]! - 0.5)); px < W && px + 0.5 < xs[j + 1]!; px++) m[py * W + px] = 1
  }
  return m
}

function distanceToPolygon(poly: XY[], x: number, y: number): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy))
  }
  return best
}

/** 외곽선 안/밖과 조회표(칠함/비움)가 다른 픽셀: 수(데이터 대비 %)와 외곽선까지 최대 거리(px) */
function compareWithMap(g: OutlineGroup, vp: SscanViewport, outline: Pt[]): { data: number; mismatch: number; pct: number; maxPx: number } {
  const map = buildSscanMap(g, vp)
  const poly = outline.map((p) => viewportPixel(vp, p.vMm, p.depthMm))
  const ins = insideMask(poly, vp.width, vp.height)
  let data = 0
  let mismatch = 0
  let maxPx = 0
  for (let p = 0; p < ins.length; p++) {
    const d = map.beam0[p]! >= 0
    if (d) data++
    if (!!ins[p] === d) continue
    mismatch++
    maxPx = Math.max(maxPx, distanceToPolygon(poly, (p % vp.width) + 0.5, Math.floor(p / vp.width) + 0.5))
  }
  return { data, mismatch, pct: (100 * mismatch) / Math.max(1, data), maxPx }
}

/** 예전 외곽선 (빔 첫 샘플 → 끝 샘플 거꾸로, 파일 빔 순서) — 비교용 */
function oldFan(g: OutlineGroup): Pt[] {
  const last = g.ultrasound.count - 1
  return [...g.beams.map((b) => samplePoint(b, 0, g.ultrasound)), ...g.beams.map((b) => samplePoint(b, last, g.ultrasound)).reverse()]
}

/** 앱 기본 창 (NdeViewer: 그룹 범위 + 2 % 여백, 깊이는 0 아래로 자름) */
function appViewport(g: OutlineGroup, width = 600, height = 400): SscanViewport {
  const e = sscanExtent(g)
  const vPad = (e.vMaxMm - e.vMinMm) * 0.02
  const dPad = (e.depthMaxMm - e.depthMinMm) * 0.02
  return { vMinMm: e.vMinMm - vPad, vMaxMm: e.vMaxMm + vPad, depthMinMm: Math.max(0, e.depthMinMm - dPad), depthMaxMm: e.depthMaxMm + dPad, width, height }
}

describe('sscanOutline: 가짜 그룹', () => {
  it('빔 < 2 또는 샘플 < 2 면 빈 배열 (조회표도 비어 있음)', () => {
    const g = synth('linear')
    expect(sscanOutline({ beams: g.beams.slice(0, 1), ultrasound: US })).toEqual([])
    expect(sscanOutline({ beams: g.beams, ultrasound: { resolutionUs: 0.04, count: 1 } })).toEqual([])
  })

  for (const kind of ['sectorial', 'linear', 'compound'] as const) {
    for (const skew of [90, 270]) {
      for (const reversed of [false, true]) {
        it(`${kind} skew ${skew}${reversed ? ' 거꾸로 저장' : ''}: 변 안쪽은 칠해지고 바깥은 비며, 픽셀마다 조회표와 같다`, () => {
          const g = synth(kind, skew, { reversed })
          const ol = sscanOutline(g)
          expect(ol.every((p) => Number.isFinite(p.vMm) && Number.isFinite(p.depthMm) && p.depthMm >= 0)).toBe(true)
          const pr = probeEdges(g, ol)
          expect(pr.bad).toEqual([])
          expect(pr.checked).toBeGreaterThan(g.beams.length * 2)
          const r = compareWithMap(g, appViewport(g, 400, 300), ol)
          expect(r.maxPx, `${r.mismatch}개 어긋남`).toBeLessThan(0.05)
          expect(r.data).toBeGreaterThan(10000)
        })
      }
    }
  }

  it('파일 빔 순서와 상관없다 (거꾸로 저장해도 같은 외곽선)', () => {
    for (const kind of ['sectorial', 'linear', 'compound'] as const) expect(sscanOutline(synth(kind, 90, { reversed: true }))).toEqual(sscanOutline(synth(kind)))
  })

  it('t0 = 0 (첫 샘플 음로 0): 시작 경계는 표면 출사점들, NaN 없음', () => {
    for (const kind of ['sectorial', 'linear', 'compound'] as const) {
      const g = synth(kind, 90, { t0Us: 0 })
      const ol = sscanOutline(g)
      expect(ol.every((p) => Number.isFinite(p.vMm) && Number.isFinite(p.depthMm))).toBe(true)
      expect(Math.min(...ol.map((p) => p.depthMm))).toBeCloseTo(0, 9)
      expect(probeEdges(g, ol).bad).toEqual([])
    }
  })

  it('컴파운드 톱니: 띠마다 시작 경계가 빔 선을 따라 뛴다 (예전 외곽선은 톱니 홈을 가로질러 감쌌다)', () => {
    const g = synth('compound')
    const vp = appViewport(g)
    const now = compareWithMap(g, vp, sscanOutline(g))
    const old = compareWithMap(g, vp, oldFan(g))
    expect(now.maxPx).toBeLessThan(0.05)
    expect(old.maxPx).toBeGreaterThan(3)
  })
})

const REAL = [X3_FILES[0]!, X4_TF_COMPOUND, X4_TF_LINEAR, ...(existsSync(EXAMPLES_DIR) ? listExampleFiles() : [])].filter((p) => existsSync(p))

const loaded = new Map<string, Promise<ViewerFileInfo>>()
const infoOf = (path: string): Promise<ViewerFileInfo> => {
  let p = loaded.get(path)
  if (!p) loaded.set(path, (p = readViewerInfo(path)))
  return p
}

describe.skipIf(REAL.length === 0)('sscanOutline: 실데이터 (X3 섹토리얼·TF 컴파운드·리니어·공식 예제)', () => {
  for (const path of REAL) {
    it(basename(path), async () => {
      const info = await infoOf(path)
      for (const g of info.groups.filter((x) => x.supported)) {
        const ol = sscanOutline(g)
        const pr = probeEdges(g, ol)
        expect(pr.bad, g.name).toEqual([])
        for (const [w, h] of [
          [600, 400],
          [1600, 1000]
        ] as const) {
          const r = compareWithMap(g, appViewport(g, w, h), ol)
          expect(r.maxPx, `${g.name} ${w}×${h}: ${r.mismatch}개 어긋남`).toBeLessThan(0.05)
        }
        // 예전 외곽선은 컴파운드에서 톱니 홈(8 px 넘게)을 감쌌다 — 이 검사가 그 차이를 잡는지
        if (g.technique === 'pa-compound') expect(compareWithMap(g, appViewport(g), oldFan(g)).maxPx, g.name).toBeGreaterThan(5)
      }
    })
  }
})

// ── 그림 회귀: 데이터 픽셀은 그대로, 라이트 테마 외곽선 선만 바뀐다 ──

/** 라이트 테마 (app.css --viewer-canvas Cloud Gray, canvas.ts fanOutline) */
const LIGHT_BG: [number, number, number, number] = [0xee, 0xee, 0xee, 255]
const OUTLINE_RGB: [number, number, number] = [0x8e, 0x8e, 0x8e]

/** 꺾은선(닫힘)이 지나는 픽셀 (1 px 선, 0.2 px 간격으로 걸음) */
function strokePixels(poly: XY[], W: number, H: number): Set<number> {
  const out = new Set<number>()
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2))
    for (let s = 0; s <= n; s++) {
      const x = Math.floor(a.x + ((b.x - a.x) * s) / n)
      const y = Math.floor(a.y + ((b.y - a.y) * s) / n)
      if (x >= 0 && y >= 0 && x < W && y < H) out.add(y * W + x)
    }
  }
  return out
}

/** SscanView 처럼: 데이터(renderSscan, 부채꼴 밖 투명) → 테마 바탕 위에, 라이트면 외곽선 */
function compose(data: Uint8Array, vp: SscanViewport, theme: 'light' | 'dark', outline: Pt[]): Uint8Array {
  const out = new Uint8Array(data)
  const bg: [number, number, number, number] = theme === 'light' ? LIGHT_BG : [0x17, 0x1a, 0x20, 255]
  for (let p = 0; p < out.length; p += 4) if (out[p + 3] === 0) out.set(bg, p)
  if (theme === 'light') {
    for (const p of strokePixels(
      outline.map((q) => viewportPixel(vp, q.vMm, q.depthMm)),
      vp.width,
      vp.height
    ))
      out.set([...OUTLINE_RGB, 255], p * 4)
  }
  return out
}

interface Drawn {
  info: ViewerFileInfo
  g: ViewerGroup
  chunk: ViewerVolumeChunk
  k: number
}

async function loadGroup(path: string, groupName?: string): Promise<Drawn> {
  const info = await infoOf(path)
  const g = info.groups.find((x) => x.supported && (!groupName || x.name === groupName))!
  const chunk = await readViewerChunk(path, g, 0, g.shape[0])
  // C-scan 이 가장 센 스캔 (뷰어 첫 화면과 같은 규칙)
  const gate = findGate(g, g.cscanGateId)!
  const cs = createGateCscan(g, gate.id)
  fillGateCscan(cs, g, gate, chunk)
  let best = -1
  let k = 0
  for (let c = 0; c < cs.peakRaw.length; c++) {
    if (cs.peakSample[c]! >= 0 && cs.peakRaw[c]! > best) {
      best = cs.peakRaw[c]!
      k = Math.floor(c / cs.beamCount)
    }
  }
  return { info, g, chunk, k }
}

function renderData(d: Drawn, vp: SscanViewport): Uint8Array {
  const [, nb, nt] = d.g.shape
  const out = new Uint8Array(vp.width * vp.height * 4)
  renderSscan({
    map: buildSscanMap(d.g, vp),
    amplitude: d.chunk.amplitude,
    offset: d.k * nb * nt,
    status: d.chunk.status,
    statusOffset: d.k * nb,
    indexFactor: rawIndexFactor(d.g.ampScale),
    palette: paletteRgb(d.info.display.palette),
    noData: hexToRgb(d.info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080'),
    background: [0, 0, 0, 0],
    out
  })
  return out
}

const PICS = [
  { path: X4_TF_COMPOUND, group: 'GR-1' },
  { path: X4_TF_LINEAR, group: 'GR-2' },
  { path: X3_FILES[0]!, group: 'Skew90' }
].filter((c) => existsSync(c.path))
const SHOTS = process.env['PAUT_VIEWER_SHOTS']

describe.skipIf(PICS.length === 0)('그림 회귀 (라이트·다크)', () => {
  for (const c of PICS) {
    it(`${basename(c.path)} ${c.group}: 다크는 데이터 그대로, 라이트는 외곽선 선 픽셀만 바뀌고 그 선은 데이터 경계 위`, async () => {
      const d = await loadGroup(c.path, c.group)
      const vp = appViewport(d.g)
      const data = renderData(d, vp)
      const ol = sscanOutline(d.g)
      const dark = compose(data, vp, 'dark', ol)
      const lightNew = compose(data, vp, 'light', ol)
      const lightOld = compose(data, vp, 'light', oldFan(d.g))
      const strokeNew = strokePixels(ol.map((q) => viewportPixel(vp, q.vMm, q.depthMm)), vp.width, vp.height)
      const strokeOld = strokePixels(oldFan(d.g).map((q) => viewportPixel(vp, q.vMm, q.depthMm)), vp.width, vp.height)
      // 다크(외곽선 없음): 데이터 픽셀이 renderSscan 결과 그대로
      for (let p = 0; p < data.length; p += 4) if (data[p + 3] !== 0) expect(dark.subarray(p, p + 4)).toEqual(data.subarray(p, p + 4))
      // 옛 외곽선 → 새 외곽선: 바뀐 픽셀은 두 선이 지나는 곳뿐 (데이터 픽셀은 그대로)
      let changed = 0
      for (let p = 0; p < data.length / 4; p++) {
        const same = lightNew[p * 4] === lightOld[p * 4] && lightNew[p * 4 + 1] === lightOld[p * 4 + 1] && lightNew[p * 4 + 2] === lightOld[p * 4 + 2]
        if (same) continue
        changed++
        expect(strokeNew.has(p) || strokeOld.has(p), `픽셀 ${p}`).toBe(true)
      }
      expect(changed).toBeGreaterThan(0)
      // 새 선은 데이터 경계 위: 선 픽셀마다 2 px 안에 칠한 픽셀과 빈 픽셀이 모두 있다 (옛 선은 컴파운드 톱니 홈 위로 지나가 그렇지 않다).
      // 1 px 가 아니라 2 px 인 까닭: 리니어 톱니 끝은 폭이 1 px 보다 좁아 끝 픽셀 바로 옆에는 칠한 픽셀 중심이 없을 수 있다
      const map = buildSscanMap(d.g, vp)
      const onBoundary = (p: number): boolean => {
        const x = p % vp.width
        const y = Math.floor(p / vp.width)
        let hasData = false
        let hasEmpty = false
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= vp.width || yy >= vp.height) hasEmpty = true
            else if (map.beam0[yy * vp.width + xx]! >= 0) hasData = true
            else hasEmpty = true
          }
        }
        return hasData && hasEmpty
      }
      const offNew = [...strokeNew].filter((p) => !onBoundary(p)).length
      const offOld = [...strokeOld].filter((p) => !onBoundary(p)).length
      expect(offNew, `새 선이 경계를 벗어난 픽셀 (옛 선 ${offOld})`).toBe(0)
      if (d.g.technique === 'pa-compound') expect(offOld).toBeGreaterThan(50)

      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true })
        writePng(resolve(SHOTS, `외곽선_${basename(c.path, '.nde').replace(/[^\w가-힣.-]+/g, '_')}.png`), outlinePicture(d, ol, lightNew, vp))
      }
    })
  }
})

/** 대조 그림: 위 = 라이트 테마 데이터 + 새 외곽선(앱 기본 창 600×400), 아래 = 예전 외곽선이 가장 크게 어긋난 곳 6배 확대 (왼쪽 옛, 오른쪽 새) */
function outlinePicture(d: Drawn, ol: Pt[], full: Uint8Array, vp: SscanViewport): Rgba {
  // 옛 외곽선 안인데 데이터가 없는 픽셀 중 옛 선에서 가장 먼 곳 (컴파운드 톱니 홈)
  const map = buildSscanMap(d.g, vp)
  const oldPoly = oldFan(d.g).map((q) => viewportPixel(vp, q.vMm, q.depthMm))
  const ins = insideMask(oldPoly, vp.width, vp.height)
  let at = { x: vp.width / 2, y: vp.height / 2 }
  let far = -1
  for (let p = 0; p < ins.length; p++) {
    if (!ins[p] || map.beam0[p]! >= 0) continue
    const x = (p % vp.width) + 0.5
    const y = Math.floor(p / vp.width) + 0.5
    const dd = distanceToPolygon(oldPoly, x, y)
    if (dd > far) {
      far = dd
      at = { x, y }
    }
  }
  const zw = 50
  const zh = 32
  const zoom = 6
  const v0 = vp.vMinMm + ((at.x - zw / 2) / vp.width) * (vp.vMaxMm - vp.vMinMm)
  const v1 = vp.vMinMm + ((at.x + zw / 2) / vp.width) * (vp.vMaxMm - vp.vMinMm)
  const d0 = vp.depthMinMm + ((at.y - zh / 2) / vp.height) * (vp.depthMaxMm - vp.depthMinMm)
  const d1 = vp.depthMinMm + ((at.y + zh / 2) / vp.height) * (vp.depthMaxMm - vp.depthMinMm)
  const zvp: SscanViewport = { vMinMm: v0, vMaxMm: v1, depthMinMm: d0, depthMaxMm: d1, width: zw * zoom, height: zh * zoom }
  const zdata = renderData(d, zvp)
  const left = compose(zdata, zvp, 'light', oldFan(d.g))
  const right = compose(zdata, zvp, 'light', ol)
  const gap = 6
  const row = { width: zvp.width * 2 + gap, height: zvp.height, data: new Uint8Array((zvp.width * 2 + gap) * zvp.height * 4) }
  for (let y = 0; y < zvp.height; y++) {
    row.data.set(left.subarray(y * zvp.width * 4, (y + 1) * zvp.width * 4), y * row.width * 4)
    row.data.set(right.subarray(y * zvp.width * 4, (y + 1) * zvp.width * 4), (y * row.width + zvp.width + gap) * 4)
  }
  const top: Rgba = { width: vp.width, height: vp.height, data: full }
  return stack([top, row], 6)
}

/**
 * 섹토리얼 X3 (와 TF 컴파운드·리니어) 의 S-scan 조회표·데이터 픽셀이 외곽선 작업 전(2026-10-06, sscanBeamOrder 로 빼기 전)과
 * 바이트 단위로 같은지 — 조회표 7개 배열과 renderSscan 결과(스캔 1, 파일 색표, 무데이터 회색 128)의 SHA-256
 */
const LOCK: Array<{ path: string; group: string; map: string; img: string }> = [
  { path: X3_FILES[0]!, group: 'Skew90', map: 'd688c1a7d8f7af5f81f7c1e94ca9d7eb233544e0b7e34e8faf5b3c7a69e62ffc', img: 'b36ccfaa2b991151b7f6abbc83e2899b464904c8ca9e1d991a2b0cf18bd2b1d1' },
  { path: X3_FILES[0]!, group: 'Skew270', map: '04b4a6a2d0404ce0a5f05faf64b9953e8bd9f2e09ec4bc8fee9979050ff9af82', img: '8a91b9240bae8bb3fd8ea149448b6aee1085e549bcf4026dcae549631c46ccf0' },
  { path: X4_TF_COMPOUND, group: 'GR-1', map: '1eafa165a8f6317bcf81647b99e115a46276b3c34db4c928b63daf499c29b4ec', img: '1f9c9aff81102f4fc69ec92fb8f88d88997b39654595cd62178b1aac7667ab8a' },
  { path: X4_TF_LINEAR, group: 'GR-1', map: 'c75330611600f433695d6fbfc7e03ca2b92d863ec930da547a64aa089b0c5772', img: '3ff717a412004fd820bfad65826f5c1bc5940e563f11c733a2f5848f7542377d' },
  { path: X4_TF_LINEAR, group: 'GR-2', map: '9e585d09eeb330e19e5b61c444a0223ec2eeb45892c6ea8798c4bc256aa1e422', img: '95ff2b6995a8809671ebf4fbf4e18d23936c143211025fc41f0adcd95f76e77c' }
].filter((c) => existsSync(c.path))

describe.skipIf(LOCK.length === 0)('조회표·데이터 픽셀 바이트 동일 (SHA-256 고정)', () => {
  for (const c of LOCK) {
    it(`${basename(c.path)} ${c.group}`, async () => {
      const info = await infoOf(c.path)
      const g = info.groups.find((x) => x.name === c.group)!
      const chunk = await readViewerChunk(c.path, g, 0, Math.min(3, g.shape[0]))
      const e = sscanExtent(g)
      const span = e.vMaxMm - e.vMinMm
      const vp: SscanViewport = { vMinMm: e.vMinMm - span * 0.02, vMaxMm: e.vMaxMm + span * 0.02, depthMinMm: Math.max(0, e.depthMinMm - 1), depthMaxMm: e.depthMaxMm + 1, width: 600, height: 400 }
      const m = buildSscanMap(g, vp)
      const h = createHash('sha256')
      for (const a of [m.beam0, m.beam1, m.at0, m.at1, m.frac0, m.frac1, m.weight]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
      expect(h.digest('hex')).toBe(c.map)
      const [, nb, nt] = g.shape
      const img = new Uint8Array(vp.width * vp.height * 4)
      renderSscan({ map: m, amplitude: chunk.amplitude, offset: nb * nt, status: chunk.status, statusOffset: nb, indexFactor: rawIndexFactor(g.ampScale), palette: paletteRgb(info.display.palette), noData: [128, 128, 128], background: [0, 0, 0, 0], out: img })
      expect(createHash('sha256').update(img).digest('hex')).toBe(c.img)
    })
  }
})
