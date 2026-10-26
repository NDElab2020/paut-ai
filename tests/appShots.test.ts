/**
 * 실제 앱이 그린 캔버스(tests/app/viewer-steps.js 의 'canvases-scan39-54deg' 단계, 단일 Skew90, 스캔 39·54°)를
 * OmniPC 6.6 화면과 대조한다. shared/imaging 의 계산뿐 아니라 앱 화면 쪽(범위·배율·캔버스 크기)까지 확인하는 것이 목적.
 * PAUT_APP_SHOTS=<폴더> (결과.json 과 shots/ 가 있는 폴더) 를 주면 돈다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readViewerInfo } from '@core/nde/viewer'
import { samplePoint, sscanExtent, type ViewerGroup } from '@shared/imaging'
import { readPng, type Rgba } from './helpers/png'
import { TOOL_ROOT, X3_FILES } from './paths'

const DIR = process.env['PAUT_APP_SHOTS']
const FIX = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/omnipc/X3_12T-SV-01.json'), 'utf8')) as {
  screenshot: string
  sscan: { pxPerMmV: number; pxPerMmDepth: number; panels: Array<{ group: number; crop: [number, number, number, number]; vAtLeftMm: number; depthAtTopMm: number }> }
}
const SHOT = resolve(TOOL_ROOT, '..', FIX.screenshot)

interface Step {
  name: string
  ok: boolean
  result: { sscan: { width: number; height: number }; readout: Record<string, string> }
  canvases: Record<string, string>
}

/** NdeViewer 와 같은 범위 규칙 (단일 그룹: 그 그룹 범위에 2 % 여백) */
function appViewport(g: ViewerGroup): { vMin: number; vMax: number; dMin: number; dMax: number } {
  const e = sscanExtent(g)
  const vPad = (e.vMaxMm - e.vMinMm) * 0.02
  const dPad = (e.depthMaxMm - e.depthMinMm) * 0.02
  return { vMin: e.vMinMm - vPad, vMax: e.vMaxMm + vPad, dMin: Math.max(0, e.depthMinMm - dPad), dMax: e.depthMaxMm + dPad }
}

type Sampler = (vMm: number, dMm: number) => [number, number, number, number] | null

function samplerOf(img: Rgba, toPx: (v: number, d: number) => [number, number]): Sampler {
  return (v, d) => {
    const [x, y] = toPx(v, d)
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return null
    const i = (yi * img.width + xi) * 4
    return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
  }
}

type Px = [number, number, number, number]
const lum = (p: Px): number => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
/** 색표의 노랑 띠(결함 중심) — 게이트 빨간 점선·파란 빔 선·회색 덮개선은 걸리지 않는다 */
const isYellow = (p: Px): boolean => p[0] > 200 && p[1] > 160 && p[2] < 120
/**
 * 영상 위 덮개선 (두 화면 공통 규칙): 무채색이면서 흰색이 아닌 것(스킵·개선·축 점선), 빨간 선(게이트), 초록(CL), 진한 파랑 선(현재 빔).
 * 색표 색은 채도가 있어 걸리지 않고, 0 % 근처 흰색(f6fafd 등)은 밝아서 걸리지 않는다
 */
const isOverlay = (p: Px): boolean => {
  const mx = Math.max(p[0], p[1], p[2])
  const mn = Math.min(p[0], p[1], p[2])
  const neutral = mx - mn < 20 && lum(p) < 245
  const redLine = p[0] > 180 && p[1] < 120 && Math.abs(p[1] - p[2]) < 15
  // CL: 다크 2ee05a(46,224,90) · 라이트 1a9a3c(26,154,60). 색표 초록(47a47e 등)은 R ≥ 61 이라 걸리지 않는다
  const green = p[1] > 140 && p[0] < 60
  const cursor = p[2] > 230 && p[0] < 120
  return neutral || redLine || green || cursor
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

describe.skipIf(!DIR || !existsSync(resolve(DIR!, '결과.json')) || !existsSync(SHOT) || !existsSync(X3_FILES[0]!))('실제 앱 캔버스 ↔ OmniPC 화면 (S-scan, 스캔 39·54°)', () => {
  const report = DIR ? (JSON.parse(readFileSync(resolve(DIR, '결과.json'), 'utf8')) as { steps: Step[] }) : { steps: [] }
  const step = report.steps.find((s) => s.name === 'canvases-scan39-54deg')

  it('캔버스 저장 단계가 있고 커서가 OmniPC 와 같다', () => {
    expect(step, 'canvases-scan39-54deg 단계').toBeDefined()
    expect(step!.ok).toBe(true)
    expect(step!.result.readout['스캔']).toBe('39.0 mm')
    expect(step!.result.readout['각도']).toBe('54.0°')
    expect(step!.result.readout['A%']).toBe('1.6')
  })

  it('부채꼴 외곽이 계산 범위와 맞음 (시작 모서리 ±0.5 mm, 톱니 쪽 ±1 mm)', async () => {
    const info = await readViewerInfo(X3_FILES[0]!)
    const g = info.groups[0]!
    const vp = appViewport(g)
    const img = readPng(step!.canvases['sscan']!)
    expect([img.width, img.height]).toEqual([step!.result.sscan.width, step!.result.sscan.height])
    // 부채꼴 안 픽셀(불투명이고 덮개선이 아닌 것)의 mm 범위 ↔ 빔 첫·끝 샘플 점으로 계산한 범위.
    // 스킵선·게이트선은 캔버스 전체 너비에 그려지므로 알파만으로는 부채꼴을 못 잡는다.
    // 부채꼴 칠은 불투명(알파 255)이다 — 부채꼴 밖으로 이어지는 연회색 점선의 안티에일리어싱(알파 12, max−min 21 이라
    // isOverlay 의 무채색 조건에 걸리지 않음)을 부채꼴로 세지 않도록 알파 255 만 본다(2026-10-07 검증: 깊이 차가 2 % 여백을 재고 있었음)
    let xMin = Infinity
    let xMax = -Infinity
    let yMin = Infinity
    let yMax = -Infinity
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4
        const p: Px = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
        if (p[3] < 255 || isOverlay(p)) continue
        xMin = Math.min(xMin, x)
        xMax = Math.max(xMax, x)
        yMin = Math.min(yMin, y)
        yMax = Math.max(yMax, y)
      }
    }
    const toV = (x: number): number => vp.vMin + (x / img.width) * (vp.vMax - vp.vMin)
    const toD = (y: number): number => vp.dMin + (y / img.height) * (vp.dMax - vp.dMin)
    const e = sscanExtent(g)
    const diffs = { vMin: toV(xMin) - e.vMinMm, vMax: toV(xMax + 1) - e.vMaxMm, dMin: toD(yMin) - e.depthMinMm, dMax: toD(yMax + 1) - e.depthMaxMm }
    console.log(`부채꼴 외곽 차이 mm: ${JSON.stringify(Object.fromEntries(Object.entries(diffs).map(([k, v]) => [k, +v.toFixed(2)])))}`)
    // 시작 쪽 모서리(첫 빔·첫 샘플)는 정확히 그 점. 끝 호와 만나는 모서리는 이웃 빔 둘 다 샘플 범위 안이어야 칠하므로
    // (바깥 호의 톱니 — OmniPC 도 같음) 한 빔 간격 안쪽까지 허용. 배율 자체는 결함 중심 ±0.5 mm 로 따로 확인한다
    expect(Math.abs(diffs.vMin)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(diffs.vMax)).toBeLessThanOrEqual(1.0)
    expect(Math.abs(diffs.dMin)).toBeLessThanOrEqual(1.0)
    expect(Math.abs(diffs.dMax)).toBeLessThanOrEqual(1.0)
  })

  it('결함(노랑 중심) 위치가 OmniPC 와 ±0.5 mm, 1 mm 칸 평균 밝기 상관 ≥ 0.85', async () => {
    const info = await readViewerInfo(X3_FILES[0]!)
    const g = info.groups[0]!
    const vp = appViewport(g)
    const app = readPng(step!.canvases['sscan']!)
    const shot = readPng(SHOT)
    const panel = FIX.sscan.panels[0]!
    const [cx0, cy0, cx1, cy1] = panel.crop
    const appAt = samplerOf(app, (v, d) => [((v - vp.vMin) / (vp.vMax - vp.vMin)) * app.width, ((d - vp.dMin) / (vp.dMax - vp.dMin)) * app.height])
    const omniAt = samplerOf(shot, (v, d) => [cx0 + (v - panel.vAtLeftMm) * FIX.sscan.pxPerMmV, cy0 + (d - panel.depthAtTopMm) * FIX.sscan.pxPerMmDepth])
    const omniVMax = panel.vAtLeftMm + (cx1 - cx0) / FIX.sscan.pxPerMmV
    const omniDMax = panel.depthAtTopMm + (cy1 - cy0) / FIX.sscan.pxPerMmDepth
    // 두 화면이 모두 보여 주는 mm 영역을 0.25 mm 격자로
    const v0 = Math.max(vp.vMin, panel.vAtLeftMm)
    const v1 = Math.min(vp.vMax, omniVMax)
    const d0 = Math.max(vp.dMin, panel.depthAtTopMm)
    const d1 = Math.min(vp.dMax, omniDMax)
    const STEP = 0.25
    const a: number[] = []
    const b: number[] = []
    const yA = { v: 0, d: 0, n: 0 }
    const yO = { v: 0, d: 0, n: 0 }
    // 1 mm 칸 평균 (speckle 같은 잔무늬는 두 프로그램의 보간 차이로 어긋나므로 구조만 비교)
    const cells = new Map<string, { a: number; b: number; n: number }>()
    for (let d = d0; d < d1; d += STEP) {
      for (let v = v0; v < v1; v += STEP) {
        const pa = appAt(v, d)
        const po = omniAt(v, d)
        if (!pa || !po || pa[3] === 0) continue // 부채꼴 밖
        if (lum(po) < 5) continue // OmniPC 바탕(검정)
        if (isYellow(pa)) {
          yA.v += v
          yA.d += d
          yA.n++
        }
        if (isYellow(po)) {
          yO.v += v
          yO.d += d
          yO.n++
        }
        if (isOverlay(po) || isOverlay(pa)) continue
        a.push(lum(pa))
        b.push(lum(po))
        const key = `${Math.floor(v)}|${Math.floor(d)}`
        const c = cells.get(key) ?? { a: 0, b: 0, n: 0 }
        c.a += lum(pa)
        c.b += lum(po)
        c.n++
        cells.set(key, c)
      }
    }
    expect(yA.n, '앱 노랑 픽셀').toBeGreaterThan(5)
    expect(yO.n, 'OmniPC 노랑 픽셀').toBeGreaterThan(5)
    const ca = { v: yA.v / yA.n, d: yA.d / yA.n }
    const co = { v: yO.v / yO.n, d: yO.d / yO.n }
    const fine = correlation(a, b)
    const full = [...cells.values()].filter((c) => c.n >= 8)
    const coarse = correlation(full.map((c) => c.a / c.n), full.map((c) => c.b / c.n))
    console.log(
      `결함 중심 앱 (${ca.v.toFixed(2)}, ${ca.d.toFixed(2)}) ↔ OmniPC (${co.v.toFixed(2)}, ${co.d.toFixed(2)}) mm · 밝기 상관 0.25 mm ${fine.toFixed(3)} (${a.length} 점) · 1 mm 칸 ${coarse.toFixed(3)} (${full.length} 칸)`
    )
    expect(Math.abs(ca.v - co.v)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(ca.d - co.d)).toBeLessThanOrEqual(0.5)
    expect(coarse).toBeGreaterThanOrEqual(0.85)
  })

  it('A-scan 신호와 게이트가 그려졌다 (캔버스가 비어 있지 않음)', () => {
    const img = readPng(step!.canvases['ascan']!)
    let trace = 0
    let red = 0
    for (let i = 0; i < img.data.length; i += 4) {
      const p: Px = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
      if (p[3] === 0) continue
      // 신호: 다크 노랑(f2e530) 또는 라이트 Graphite(393c41 — 스킵선 Pewter 5c5e62 보다 어둡다)
      const mx = Math.max(p[0], p[1], p[2])
      const mn = Math.min(p[0], p[1], p[2])
      if (isYellow(p) || (mx - mn < 20 && lum(p) < 75)) trace++
      else if (p[0] > 180 && p[1] < 90 && p[2] < 90) red++
    }
    expect(trace, 'A-scan 신호').toBeGreaterThan(50)
    expect(red, '게이트(빨강)').toBeGreaterThan(20)
  })
})
