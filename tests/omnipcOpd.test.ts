/**
 * OmniPC 6.6 화면 대조 — OPD (OPD_조사/판단.md 7절 6단계). '대조 전' 상태 그대로 화면 정답 2장을 재현한다.
 *   TP14-ROOT-L-01 278.03 mm · 65° (PCN, 스큐 90, 26빔 140 ns), SEC25-2 sr1_01 114.15 mm · 39° (인천, 스큐 90, 36빔 80 ns)
 * 앱의 이미지 보기 경로 그대로 잰다: readOpdViewerInfo → readOpdViewerChunk(Int16Array) → shared/imaging 의 게이트 C-scan·측정값
 * (NdeViewer 와 같은 함수: gatePeakAt · foldDepth · 문턱 미만이면 ND). 문턱은 typed 설정 레코드에서 읽고 화면 값과 대조한다.
 * 화면 문턱(TP14 10 %, SEC25-2 20 %)으로도 applyGateOverride 결과를 확인한다.
 * 허용치 = 계획 결정 6: 위치 ±0.5 mm, A% ±0.1 %p, 각도 같음, 스캔 반 칸 안, C-scan 무늬 상관 ≥ 0.9.
 * 통과해도 core/nde/viewer/meta.ts VERIFIED 의 OPD 표에 올리지 않는다 — 진폭 눈금(O1·O2)·헤더 값(O9) 캡처 대조 뒤 8단계에서.
 * 정답표: tests/fixtures/omnipc/OPD_*.json (화면에서 읽은 값만, C-scan 상자 픽셀 포함). 실데이터·캡처가 없는 PC 에서는 건너뛴다.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifiedKinds } from '@core/nde/viewer/meta'
import { readOpdViewerChunk, readOpdViewerInfo } from '@core/opd/viewer'
import {
  VIEWER_NO_DATA_SPECIAL_INDEX,
  applyGateOverride,
  createGateCscan,
  fillGateCscan,
  findGate,
  foldDepth,
  gateDisplayValues,
  gatePeakAt,
  hexToRgb,
  paletteRgb,
  rawIndexFactor,
  renderCscan,
  samplePoint,
  scanIndexAt,
  scanPositionMm,
  type GateCscan,
  type ViewerFileInfo,
  type ViewerGroup,
  type ViewerVolumeChunk
} from '@shared/imaging'
import { readPng, type Rgba } from './helpers/png'
import { OPD_FILES, TOOL_ROOT, opdPath } from './paths'

interface Fixture {
  screenshot: string
  file: string
  sha256Prefix: string
  data: { gainDb: number; refDb?: number; autoPct: number }
  cursor: { scanMm: number; angleDeg: number }
  readings: { aPercent: number; daMm: number | null; viaMm: number | null }
  screen: {
    gateADepthMm: [number, number]
    gateAThresholdPct: number
    skipMm?: { B0: number; T1: number }
    beamLine: { startVDepthMm: [number, number]; endVDepthMm: [number, number]; exitVAtDepth0Mm: number; angleDeg: number }
  }
  cscan: { imageBoxPx: [number, number, number, number]; scanCellsMm: [number, number]; firstBeamAtBottom: boolean; cursorPx: [number, number] }
}

const fixture = (name: string): Fixture => JSON.parse(readFileSync(resolve(import.meta.dirname, `fixtures/omnipc/${name}`), 'utf8')) as Fixture

const POS_TOL = 0.5 // mm (결정 6)
const PCT_TOL = 0.1 // %p (결정 6)

const CASES = [
  {
    path: opdPath(OPD_FILES.tp14RootL),
    fix: fixture('OPD_TP14-ROOT-L-01.json'),
    // 우리 계산 회귀값 (구조 읽기 보고와 같음): raw 33 → 32.35 %, DA^ 22.48, ViA^ 2.19, 출사점 V −56.82
    expect: { raw: 33, pct: (33 / 255) * 250, daMm: 22.48, viaMm: 2.19, exitVMm: -56.82 }
  },
  {
    path: opdPath(OPD_FILES.sec25sr1_01),
    fix: fixture('OPD_SEC25-2_sr1_01.json'),
    // raw 5 → 4.90 %, 문턱 20 % 미만 → DA^·ViA^ ND, 출사점 V −28.87 (3_화면대조 보간값 −28.91, 화면 −28.9)
    expect: { raw: 5, pct: (5 / 255) * 250, daMm: null, viaMm: null, exitVMm: -28.87 }
  }
]

interface Loaded {
  info: ViewerFileInfo
  g: ViewerGroup
  chunk: ViewerVolumeChunk
}
const loaded = new Map<string, Promise<Loaded>>()
function load(path: string): Promise<Loaded> {
  let p = loaded.get(path)
  if (!p) {
    p = (async () => {
      const info = await readOpdViewerInfo(path)
      const g = info.groups[0]!
      const chunk = await readOpdViewerChunk(path, g, 0, g.shape[0])
      return { info, g, chunk }
    })()
    loaded.set(path, p)
  }
  return p
}

/** 화면 문턱을 넣은 게이트 A 로 C-scan (문턱만 바꾸면 파일 µs 배열을 그대로 쓴다 — 창이 바뀌지 않음) */
function gateCscanOf(g: ViewerGroup, chunk: ViewerVolumeChunk, thresholdPct: number): { cs: GateCscan; thresholdPct: number | null } {
  const file = findGate(g, g.cscanGateId)!
  const gate = applyGateOverride(file, g, { thresholdPct })
  const cs = createGateCscan(g, gate.id)
  fillGateCscan(cs, g, gate, chunk)
  return { cs, thresholdPct: gate.thresholdPct }
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

for (const c of CASES) {
  const f = c.fix
  const SHOT = resolve(TOOL_ROOT, '..', f.screenshot)
  describe.skipIf(!existsSync(c.path))(`OmniPC 6.6 화면 대조 (OPD, 대조 전): ${f.file} ${f.cursor.scanMm} mm · ${f.cursor.angleDeg}°`, () => {
    it('캡처의 파일과 같은 파일 (SHA-256 앞자리)', () => {
      expect(createHash('sha256').update(readFileSync(c.path)).digest('hex').startsWith(f.sha256Prefix)).toBe(true)
    })

    it('대조 전 상태: 그릴 수 있지만 verified = false, OPD 표는 비어 있고 이유가 붙는다 · 추정 눈금 · 문턱 화면 일치 · 내장 색표 · 동기 모름', async () => {
      const { info, g } = await load(c.path)
      expect(verifiedKinds('opd')).toEqual([])
      expect(info.formatFamily).toBe('opd')
      expect(info.reader).toEqual({ name: 'opd-structure', version: 4 })
      expect(info.scanSync).toBe('encoder')
      expect([g.technique, g.supported, g.reason, g.verified]).toEqual(['pa-sectorial', true, null, false])
      expect(g.blockReason).toContain('OmniPC 대조 전(OPD 섹토리얼 · 스큐 90)')
      expect(g.ampScale).toEqual({ rawMax: 255, unitMax: 250, estimated: true })
      expect(g.gates.map((x) => [x.name, x.geometry, x.sync, x.thresholdPct])).toEqual([
        ['Gate I', 'TrueDepth', 'Pulse', 20],
        ['Gate A', 'TrueDepth', 'Pulse', f.screen.gateAThresholdPct],
        ['Gate B', 'TrueDepth', 'Pulse', 30]
      ])
      expect(info.display.paletteSource).toBe('default')
      expect(info.display.cscanReversed).toBe(f.cscan.firstBeamAtBottom)
      expect(g.selfCheck?.passed.snell).toBe(true)
      // 게이트 A 판정 (판단.md 3.2): TP14-ROOT-L 은 게이트 A 가 모든 빔에서 저장 구간 밖까지 걸쳐 '저장 구간 안 칸'이 없다 →
      // 전체 칸 일치율(97.3 %)이 높아도 판정 못 함(null) = 대조 전. SEC25-2 sr1_01 은 저장 구간 안 98.6 % · 전체 98.0 % 로 통과
      expect(g.selfCheck?.passed.gateA).toBe(g.selfCheck!.gateAAgreement === null ? null : true)
      expect(g.selfCheck!.gateAAgreementAll).toBeGreaterThanOrEqual(0.95)
    })

    it(`DATA 패널 Gain ${f.data.gainDb} dB${f.data.refDb !== undefined ? ` · Ref ${f.data.refDb} dB` : ' (Ref 없음)'} · Auto ${f.data.autoPct} %`, async () => {
      const { g } = await load(c.path)
      expect(Math.abs(g.gainDb! - (g.referenceGainDb ?? 0) - f.data.gainDb)).toBeLessThanOrEqual(0.05)
      if (f.data.refDb === undefined) expect(g.referenceGainDb).toBeNull() // PCN 기준 이득 0 → 'Ref 모름'
      else expect(Math.abs(g.referenceGainDb! - f.data.refDb)).toBeLessThanOrEqual(0.05)
      expect(g.referenceAmplitudePct).toBe(f.data.autoPct)
    })

    it(`커서 ${f.cursor.scanMm} mm → 스캔 칸 반 칸 안 · ${f.cursor.angleDeg}° 빔 · A% ${f.readings.aPercent} (±0.1) · DA^ ${f.readings.daMm ?? 'ND'} · ViA^ ${f.readings.viaMm ?? 'ND'} (±0.5 mm)`, async () => {
      const { info, g, chunk } = await load(c.path)
      const k = scanIndexAt(f.cursor.scanMm, g.scan)
      expect(Math.abs(scanPositionMm(k, g.scan) - f.cursor.scanMm)).toBeLessThanOrEqual(0.5)
      const b = g.beams.findIndex((x) => x.angleDeg === f.cursor.angleDeg)
      expect(b).toBeGreaterThanOrEqual(0)
      const { cs, thresholdPct } = gateCscanOf(g, chunk, f.screen.gateAThresholdPct)
      expect(cs.peakRaw[k * g.shape[1] + b]).toBe(c.expect.raw)
      const peak = gatePeakAt(cs, g, k, b)!
      expect(peak.pct).toBeCloseTo(c.expect.pct, 9)
      expect(Math.abs(peak.pct - f.readings.aPercent)).toBeLessThanOrEqual(PCT_TOL)
      // NdeViewer 와 같은 규칙: 문턱 미만이면 위치값 ND
      const detected = thresholdPct === null || peak.pct >= thresholdPct
      expect(detected).toBe(f.readings.daMm !== null)
      if (f.readings.daMm !== null && f.readings.viaMm !== null) {
        const da = foldDepth(peak.depthMm, info.specimen.thicknessMm).depthMm
        expect(Math.abs(da - f.readings.daMm)).toBeLessThanOrEqual(POS_TOL)
        expect(Math.abs(peak.vMm - f.readings.viaMm)).toBeLessThanOrEqual(POS_TOL)
        expect(da).toBeCloseTo(c.expect.daMm!, 1)
        expect(peak.vMm).toBeCloseTo(c.expect.viaMm!, 1)
      }
    })

    it(`${f.cursor.angleDeg}° 빔 출사점 V ${f.screen.beamLine.exitVAtDepth0Mm} mm · 빔 선 시작·끝 · 게이트 A 깊이 ±0.5 mm`, async () => {
      const { g } = await load(c.path)
      const beam = g.beams.find((x) => x.angleDeg === f.cursor.angleDeg)!
      expect(Math.abs(beam.vOffsetMm - f.screen.beamLine.exitVAtDepth0Mm)).toBeLessThanOrEqual(POS_TOL)
      expect(beam.vOffsetMm).toBeCloseTo(c.expect.exitVMm, 1)
      const p0 = samplePoint(beam, 0, g.ultrasound)
      const p1 = samplePoint(beam, g.ultrasound.count - 1, g.ultrasound)
      expect(Math.abs(p0.vMm - f.screen.beamLine.startVDepthMm[0])).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(p0.depthMm - f.screen.beamLine.startVDepthMm[1])).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(p1.vMm - f.screen.beamLine.endVDepthMm[0])).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(p1.depthMm - f.screen.beamLine.endVDepthMm[1])).toBeLessThanOrEqual(POS_TOL)
      const gv = gateDisplayValues(findGate(g, g.cscanGateId)!, g)
      expect(gv.geometry).toBe('TrueDepth')
      expect(Math.abs(gv.startMm - f.screen.gateADepthMm[0])).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(gv.startMm + gv.lengthMm - f.screen.gateADepthMm[1])).toBeLessThanOrEqual(POS_TOL)
    })

    it.skipIf(!f.screen.skipMm)('두께 = 화면 스킵선 B0 (T1 = 2 × B0)', async () => {
      const { info } = await load(c.path)
      expect(info.specimen.thicknessMm).toBeCloseTo(f.screen.skipMm!.B0, 6)
      expect(2 * info.specimen.thicknessMm!).toBeCloseTo(f.screen.skipMm!.T1, 6)
    })

    it.skipIf(!existsSync(SHOT))('C-scan: 캡처 커서 픽셀 = 같은 칸·같은 빔, 무늬 상관 ≥ 0.9 (색 % 눈금 차이는 상관에 들어가지 않음)', async () => {
      const { info, g, chunk } = await load(c.path)
      const screen: Rgba = readPng(SHOT)
      const [bx0, by0, bx1, by1] = f.cscan.imageBoxPx
      const W = bx1 - bx0
      const H = by1 - by0
      const [ns, nb] = g.shape
      // 상자 가로 = 스캔 칸 [-0.5, ns - 0.5], 세로 = 빔 칸 nb 개 (첫 빔이 아래)
      expect(f.cscan.scanCellsMm).toEqual([scanPositionMm(0, g.scan) - 0.5 * g.scan.resolutionMm, scanPositionMm(ns - 1, g.scan) + 0.5 * g.scan.resolutionMm])
      const [cx, cy] = f.cscan.cursorPx
      const cell = Math.floor(((cx - bx0) / W) * ns)
      const row = Math.floor(((cy - by0) / H) * nb)
      expect(cell).toBe(scanIndexAt(f.cursor.scanMm, g.scan))
      expect(g.beams[info.display.cscanReversed ? nb - 1 - row : row]!.angleDeg).toBe(f.cursor.angleDeg)

      const pal = paletteRgb(info.display.palette)
      const toIdx = paletteIndexer(pal)
      const ours = new Uint8Array(W * H * 4)
      const { cs } = gateCscanOf(g, chunk, f.screen.gateAThresholdPct)
      renderCscan({
        cscan: cs,
        width: W,
        height: H,
        reversed: info.display.cscanReversed,
        indexFactor: rawIndexFactor(g.ampScale),
        palette: pal,
        noData: hexToRgb(info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080'),
        out: ours
      })
      const corrAt = (dx: number): number => {
        const a: number[] = []
        const b: number[] = []
        for (let y = 0; y < H; y += 2) {
          for (let x = 2; x < W - 2; x += 2) {
            const q = ((by0 + y) * screen.width + bx0 + x) * 4
            const s = toIdx(screen.data[q]!, screen.data[q + 1]!, screen.data[q + 2]!)
            const xo = x + dx
            if (s < 0 || xo < 0 || xo >= W) continue
            const o = toIdx(ours[(y * W + xo) * 4]!, ours[(y * W + xo) * 4 + 1]!, ours[(y * W + xo) * 4 + 2]!)
            if (o < 0) continue
            a.push(s)
            b.push(o)
          }
        }
        return correlation(a, b)
      }
      const cell1 = Math.round(W / ns)
      const r0 = corrAt(0)
      expect(r0).toBeGreaterThanOrEqual(0.9)
      // 한 칸(1 mm) 옮기면 낮아진다 — 칸 경계가 같은 자리
      expect(r0).toBeGreaterThan(corrAt(-Math.max(1, cell1)))
      expect(r0).toBeGreaterThan(corrAt(Math.max(1, cell1)))
    })
  })
}
