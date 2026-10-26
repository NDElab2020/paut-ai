/**
 * OmniPC 정답표 대조 — tests/fixtures/omnipc/*.json 에는 OmniPC 화면에서 읽은 값만 둔다.
 * 우리 계산값은 아래 '회귀 스냅샷' 에 따로 고정하고(정답 아님, 계획 §6.1), 장비 RawCScan 교차 확인은 테스트에서만 한다(계획 §6.4).
 * PAUT_VIEWER_SHOTS=<폴더> 를 주면 OmniPC 화면과 우리 계산을 위아래로 붙인 그림·반투명 겹친 그림을 저장한다.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPath, withH5File } from '@core/nde/h5'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import {
  DEG,
  VIEWER_NO_DATA_SPECIAL_INDEX,
  applyGateOverride,
  ascanDepthRange,
  ascanOffset,
  ascanPeak,
  ascanPercent,
  buildSscanMap,
  createGateCscan,
  fillGateCscan,
  findGate,
  gateDisplayValues,
  gatePeakAt,
  gateWindowSignature,
  hexToRgb,
  paletteRgb,
  rawIndexFactor,
  rawToPercent,
  renderCscan,
  renderSscan,
  samplePoint,
  scanIndexAt,
  scanPositionMm,
  soundPathMm,
  type SscanViewport,
  type ViewerFileInfo,
  type ViewerGroup,
  type ViewerVolumeChunk
} from '@shared/imaging'
import { blend, crop, readPng, stack, writePng, type Rgba } from './helpers/png'
import { TOOL_ROOT, X3_FILES } from './paths'

interface Panel {
  group: number
  crop: [number, number, number, number]
  vAtLeftMm: number
  depthAtTopMm: number
  corners?: Record<'firstBeamStart' | 'firstBeamEnd' | 'lastBeamStart' | 'lastBeamEnd', [number, number]>
}

const FIX = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/omnipc/X3_12T-SV-01.json'), 'utf8')) as {
  screenshot: string
  cursor: { scanMm: number; angleDegGroup0: number; angleDegGroup1: number }
  readings: { aPercent: number }
  ascan: { peakPct: number; peakPctTol: number; peakDepthMm: number; peakDepthTol: number; depthAxisMm: [number, number]; depthAxisTol: number }
  gateA: { depthMm: [number, number]; tol: number }
  scanAxisMm: [number, number]
  cscan: { angleAxisDeg: [number, number]; firstBeamAtBottom: boolean }
  sscan: { pxPerMmV: number; pxPerMmDepth: number; panels: Panel[]; cscanCrop: [number, number, number, number] }
}

const FILE = X3_FILES[0]!
const SHOT = resolve(TOOL_ROOT, '..', FIX.screenshot)
const HAS = existsSync(FILE)
const POS_TOL = 0.5 // mm (계획 결정 6)

async function load(): Promise<{ info: ViewerFileInfo; chunks: ViewerVolumeChunk[] }> {
  const info = await readViewerInfo(FILE)
  const chunks = await Promise.all(info.groups.map((g) => readViewerChunk(FILE, g, 0, g.shape[0])))
  return { info, chunks }
}

function beamIndexOf(g: ViewerGroup, angleDeg: number): number {
  return g.beams.findIndex((b) => Math.abs(b.angleDeg - angleDeg) < 1e-6)
}

function panelViewport(p: Panel): SscanViewport {
  const [x0, y0, x1, y1] = p.crop
  return {
    vMinMm: p.vAtLeftMm,
    vMaxMm: p.vAtLeftMm + (x1 - x0) / FIX.sscan.pxPerMmV,
    depthMinMm: p.depthAtTopMm,
    depthMaxMm: p.depthAtTopMm + (y1 - y0) / FIX.sscan.pxPerMmDepth,
    width: x1 - x0,
    height: y1 - y0
  }
}

describe.skipIf(!HAS)('OmniPC 6.6 화면 대조: X3 12T-SV-01', () => {
  it('커서: 스캔 38.93 mm → 39번째 칸, 처음 빔 54° / 55°', async () => {
    const { info } = await load()
    const [g0, g1] = info.groups
    expect(scanIndexAt(FIX.cursor.scanMm, g0!.scan)).toBe(39)
    expect(Math.abs(scanPositionMm(39, g0!.scan) - FIX.cursor.scanMm)).toBeLessThanOrEqual(g0!.scan.resolutionMm / 2)
    expect(g0!.beams[g0!.initialBeam]!.angleDeg).toBe(FIX.cursor.angleDegGroup0)
    expect(g1!.beams[g1!.initialBeam]!.angleDeg).toBe(FIX.cursor.angleDegGroup1)
  })

  it('A% (게이트 A 최대) = 1.6 %', async () => {
    const { info, chunks } = await load()
    const g = info.groups[0]!
    const gate = findGate(g, g.cscanGateId)!
    const cs = createGateCscan(g, gate.id)
    fillGateCscan(cs, g, gate, chunks[0]!)
    const peak = gatePeakAt(cs, g, scanIndexAt(FIX.cursor.scanMm, g.scan), beamIndexOf(g, FIX.cursor.angleDegGroup0))!
    expect(Math.abs(peak.pct - FIX.readings.aPercent)).toBeLessThanOrEqual(0.1)
  })

  it('A-scan: 최대 약 25 % @ 약 30 mm, 깊이축 약 8~38 mm', async () => {
    const { info, chunks } = await load()
    const g = info.groups[0]!
    const b = beamIndexOf(g, FIX.cursor.angleDegGroup0)
    const k = scanIndexAt(FIX.cursor.scanMm, g.scan)
    const a = ascanPercent(chunks[0]!.amplitude, ascanOffset(g.shape, k, b), g)
    const peak = ascanPeak(a)
    const depth = samplePoint(g.beams[b]!, peak.sample, g.ultrasound).depthMm
    expect(Math.abs(peak.value - FIX.ascan.peakPct)).toBeLessThanOrEqual(FIX.ascan.peakPctTol)
    expect(Math.abs(depth - FIX.ascan.peakDepthMm)).toBeLessThanOrEqual(FIX.ascan.peakDepthTol)
    const range = ascanDepthRange(g, b)
    expect(Math.abs(range.startMm - FIX.ascan.depthAxisMm[0])).toBeLessThanOrEqual(FIX.ascan.depthAxisTol)
    expect(Math.abs(range.endMm - FIX.ascan.depthAxisMm[1])).toBeLessThanOrEqual(FIX.ascan.depthAxisTol)
  })

  it('게이트 A 깊이 7.09 / 28.0 mm (모든 빔)', async () => {
    const { info } = await load()
    for (const g of info.groups) {
      const gate = findGate(g, g.cscanGateId)!
      g.beams.forEach((beam, b) => {
        const cos = Math.cos(beam.angleDeg * DEG)
        const d0 = soundPathMm(beam, gate.startUs[b]!) * cos
        const d1 = soundPathMm(beam, gate.startUs[b]! + gate.lengthUs[b]!) * cos
        expect(Math.abs(d0 - FIX.gateA.depthMm[0])).toBeLessThanOrEqual(FIX.gateA.tol)
        expect(Math.abs(d1 - FIX.gateA.depthMm[1])).toBeLessThanOrEqual(FIX.gateA.tol)
      })
    }
  })

  it('스캔축 0~300 mm, C-scan 각도축 40~70°, 첫 빔이 아래', async () => {
    const { info } = await load()
    for (const g of info.groups) {
      expect(scanPositionMm(0, g.scan)).toBe(FIX.scanAxisMm[0])
      expect(scanPositionMm(g.scan.count - 1, g.scan)).toBe(FIX.scanAxisMm[1])
      expect([g.beams[0]!.angleDeg, g.beams.at(-1)!.angleDeg]).toEqual(FIX.cscan.angleAxisDeg)
    }
    expect(info.display.cscanReversed).toBe(FIX.cscan.firstBeamAtBottom)
  })

  it('S-scan 부채꼴 꼭짓점 4개가 화면과 ±0.5 mm', async () => {
    const { info } = await load()
    const p = FIX.sscan.panels[0]!
    const g = info.groups[p.group]!
    const vp = panelViewport(p)
    const toMm = ([x, y]: [number, number]): { vMm: number; depthMm: number } => ({
      vMm: vp.vMinMm + x / FIX.sscan.pxPerMmV,
      depthMm: vp.depthMinMm + y / FIX.sscan.pxPerMmDepth
    })
    const last = g.ultrasound.count - 1
    const nb = g.beams.length
    const pairs: Array<[[number, number], { vMm: number; depthMm: number }]> = [
      [p.corners!.firstBeamStart, samplePoint(g.beams[0]!, 0, g.ultrasound)],
      [p.corners!.firstBeamEnd, samplePoint(g.beams[0]!, last, g.ultrasound)],
      [p.corners!.lastBeamStart, samplePoint(g.beams[nb - 1]!, 0, g.ultrasound)],
      [p.corners!.lastBeamEnd, samplePoint(g.beams[nb - 1]!, last, g.ultrasound)]
    ]
    for (const [px, ours] of pairs) {
      const screen = toMm(px)
      expect(Math.abs(screen.vMm - ours.vMm)).toBeLessThanOrEqual(POS_TOL)
      expect(Math.abs(screen.depthMm - ours.depthMm)).toBeLessThanOrEqual(POS_TOL)
    }
  })

  const SHOTS = process.env['PAUT_VIEWER_SHOTS']
  it.skipIf(!SHOTS || !existsSync(SHOT))('대조 그림 저장 (PAUT_VIEWER_SHOTS)', async () => {
    const dir = SHOTS!
    mkdirSync(dir, { recursive: true })
    const { info, chunks } = await load()
    const screen = readPng(SHOT)
    const palette = paletteRgb(info.display.palette)
    const noData = hexToRgb(info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080')
    const k = scanIndexAt(FIX.cursor.scanMm, info.groups[0]!.scan)
    const t0 = performance.now()
    for (const p of FIX.sscan.panels) {
      const g = info.groups[p.group]!
      const vp = panelViewport(p)
      const map = buildSscanMap(g, vp)
      const ours: Rgba = { width: vp.width, height: vp.height, data: new Uint8Array(vp.width * vp.height * 4) }
      const nbnt = g.shape[1] * g.shape[2]
      renderSscan({
        map,
        amplitude: chunks[p.group]!.amplitude,
        offset: k * nbnt,
        status: chunks[p.group]!.status,
        statusOffset: k * g.shape[1],
        indexFactor: rawIndexFactor(g.ampScale),
        palette,
        noData,
        background: [0, 0, 0, 255],
        out: ours.data
      })
      const shot = crop(screen, ...p.crop)
      writePng(resolve(dir, `sscan_g${p.group}_대조.png`), stack([shot, ours]))
      writePng(resolve(dir, `sscan_g${p.group}_겹침.png`), blend(shot, ours, 0.5))
    }
    const [cx0, cy0, cx1, cy1] = FIX.sscan.cscanCrop
    const shotC = crop(screen, cx0, cy0, cx1, cy1)
    const width = cx1 - cx0
    const half = Math.floor((cy1 - cy0 - 5) / 2)
    const cParts: Rgba[] = info.groups.map((g, gi) => {
      const gate = findGate(g, g.cscanGateId)!
      const cs = createGateCscan(g, gate.id)
      fillGateCscan(cs, g, gate, chunks[gi]!)
      const img: Rgba = { width, height: half, data: new Uint8Array(width * half * 4) }
      renderCscan({ cscan: cs, width, height: half, reversed: info.display.cscanReversed, indexFactor: rawIndexFactor(g.ampScale), palette, noData, out: img.data })
      return img
    })
    writePng(resolve(dir, 'cscan_대조.png'), stack([shotC, stack(cParts, 5)]))
    console.log(`대조 그림 저장: ${dir} (${(performance.now() - t0).toFixed(0)} ms)`)
  })
})

/**
 * 회귀 스냅샷 — 우리 계산값을 그대로 고정한다 (OmniPC 정답 아님, 2026-10-06 계산).
 * 화면 대조(위)보다 촘촘히 잡아 계산 규칙이 몰래 바뀌면 바로 알 수 있게 한다. 규칙을 일부러 바꾸면 여기 값을 새로 적는다.
 * 정답표 JSON(fixtures/omnipc)에는 넣지 않는다.
 */
const SNAP = {
  scanIndex: 39,
  beam54: 14,
  ascan: { peakPct: 25.092, peakDepthMm: 29.937, depthRangeMm: [7.674, 38.438] as const },
  gateA: { raw: 262, pct: 1.599, sample: 486 },
  /** 그룹 0 부채꼴 꼭짓점 (V mm, 깊이 mm) */
  corners: {
    firstBeamStart: [-29.924, 10.001],
    firstBeamEnd: [3.719, 50.095],
    lastBeamStart: [-16.185, 4.465],
    lastBeamEnd: [32.997, 22.366]
  } satisfies Record<keyof NonNullable<Panel['corners']>, [number, number]>
}

describe.skipIf(!HAS)('회귀 스냅샷 (우리 계산값, 정답 아님): X3 12T-SV-01 Skew90', () => {
  it('커서 칸: 스캔 38.93 mm → 39, 54° → 빔 14', async () => {
    const { info } = await load()
    const g = info.groups[0]!
    expect(scanIndexAt(FIX.cursor.scanMm, g.scan)).toBe(SNAP.scanIndex)
    expect(beamIndexOf(g, FIX.cursor.angleDegGroup0)).toBe(SNAP.beam54)
  })

  it('A-scan 54°: 최대 25.09 % @ 29.94 mm, 깊이축 7.67 ~ 38.44 mm', async () => {
    const { info, chunks } = await load()
    const g = info.groups[0]!
    const a = ascanPercent(chunks[0]!.amplitude, ascanOffset(g.shape, SNAP.scanIndex, SNAP.beam54), g)
    const peak = ascanPeak(a)
    expect(peak.value).toBeCloseTo(SNAP.ascan.peakPct, 2)
    expect(samplePoint(g.beams[SNAP.beam54]!, peak.sample, g.ultrasound).depthMm).toBeCloseTo(SNAP.ascan.peakDepthMm, 2)
    const range = ascanDepthRange(g, SNAP.beam54)
    expect(range.startMm).toBeCloseTo(SNAP.ascan.depthRangeMm[0], 2)
    expect(range.endMm).toBeCloseTo(SNAP.ascan.depthRangeMm[1], 2)
  })

  it('게이트 A 최대: raw 262 = 1.60 %, 샘플 486', async () => {
    const { info, chunks } = await load()
    const g = info.groups[0]!
    const gate = findGate(g, g.cscanGateId)!
    const cs = createGateCscan(g, gate.id)
    fillGateCscan(cs, g, gate, chunks[0]!)
    expect(cs.peakRaw[SNAP.scanIndex * g.shape[1] + SNAP.beam54]).toBe(SNAP.gateA.raw)
    const peak = gatePeakAt(cs, g, SNAP.scanIndex, SNAP.beam54)!
    expect(peak.pct).toBeCloseTo(SNAP.gateA.pct, 2)
    expect(peak.sample).toBe(SNAP.gateA.sample)
  })

  it('그룹 0 부채꼴 꼭짓점 4개', async () => {
    const { info } = await load()
    const g = info.groups[0]!
    const last = g.ultrasound.count - 1
    const nb = g.beams.length
    const ours = {
      firstBeamStart: samplePoint(g.beams[0]!, 0, g.ultrasound),
      firstBeamEnd: samplePoint(g.beams[0]!, last, g.ultrasound),
      lastBeamStart: samplePoint(g.beams[nb - 1]!, 0, g.ultrasound),
      lastBeamEnd: samplePoint(g.beams[nb - 1]!, last, g.ultrasound)
    }
    for (const [name, [v, depth]] of Object.entries(SNAP.corners) as Array<[keyof typeof ours, [number, number]]>) {
      expect(ours[name].vMm, name).toBeCloseTo(v, 2)
      expect(ours[name].depthMm, name).toBeCloseTo(depth, 2)
    }
  })
})

/**
 * 장비 C-scan 교차 확인 (계획 §6.4, 테스트에서만 읽음 — 앱은 문서 없는 이 형식을 쓰지 않는다).
 * `/Applications/MXU/RawCScan` [스캔 301, 빔 62(그룹 0의 31 + 그룹 1의 31), 게이트 3(I·A·B)], 칸마다 24바이트:
 *   바이트 4..7 = 게이트 안 최대 raw (uint32 LE). 나머지 바이트는 모름.
 * `CscanDescriptor` [186 = 62×3] 는 같은 순서로 44바이트씩: int32 빔, int32 게이트 칸, float32 시작·끝 시각(초, 빔 지연 포함), int32 임계 raw.
 * 해석 근거 (2026-10-06 실측): 게이트 A 칸의 raw 가 우리 계산과 정수로 같은 칸이 그룹 0 9185/9331, 그룹 1 9086/9331.
 *   다른 칸은 장비 값이 조금 작다 (게이트 창 끝 처리 차이로 보임, 화면 대조 대상 아님).
 */
const RAWC = {
  recordsPath: 'Applications/MXU/RawCScan',
  descriptorsPath: 'Applications/MXU/CscanDescriptor',
  gateSlots: 3,
  recordBytes: 24,
  peakRawAt: 4,
  descriptorBytes: 44,
  /** 게이트 칸 순서 I·A·B 중 A */
  gateSlotA: 1,
  /** [스캔 39, 빔 14(54°), 게이트 A] 장비 원값 (조사 기록: 262 = 1.60 %) */
  raw: 262,
  pct: 1.6
}

async function readMxuBytes(): Promise<{ records: Uint8Array; descriptors: Uint8Array }> {
  return withH5File(FILE, (f) => {
    const bytes = (path: string): Uint8Array => {
      const ent = getPath(f, path)
      const v = ent && 'value' in ent ? (ent as { value: unknown }).value : null
      if (!(v instanceof Uint8Array)) throw new Error(`${path}: 바이트 배열로 읽히지 않음`)
      return v
    }
    return { records: bytes(RAWC.recordsPath), descriptors: bytes(RAWC.descriptorsPath) }
  })
}

describe.skipIf(!HAS)('장비 RawCScan 교차 확인 (테스트 전용): X3 12T-SV-01', () => {
  it('[스캔 39, 54°, 게이트 A] 장비 raw 262 = 1.60 % = 우리 게이트 A 최대', async () => {
    const { info, chunks } = await load()
    const { records, descriptors } = await readMxuBytes()
    const g = info.groups[0]!
    const gate = findGate(g, g.cscanGateId)!
    const k = scanIndexAt(FIX.cursor.scanMm, g.scan)
    const b = beamIndexOf(g, FIX.cursor.angleDegGroup0)
    const beamsTotal = info.groups.reduce((n, x) => n + x.shape[1], 0)
    expect(records.byteLength).toBe(g.shape[0] * beamsTotal * RAWC.gateSlots * RAWC.recordBytes)
    expect(descriptors.byteLength).toBe(beamsTotal * RAWC.gateSlots * RAWC.descriptorBytes)

    // 설명자로 칸이 (그룹 0 빔 b, 게이트 A)인지 확인: 번호, 길이(µs), 임계(%)
    const slot = b * RAWC.gateSlots + RAWC.gateSlotA
    const dd = new DataView(descriptors.buffer, descriptors.byteOffset + slot * RAWC.descriptorBytes, RAWC.descriptorBytes)
    expect(dd.getInt32(0, true)).toBe(b)
    expect(dd.getInt32(4, true)).toBe(RAWC.gateSlotA)
    const lengthUs = (dd.getFloat32(12, true) - dd.getFloat32(8, true)) * 1e6
    expect(Math.abs(lengthUs - gate.lengthUs[b]!)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(rawToPercent(dd.getInt32(16, true), g.ampScale) - gate.thresholdPct!)).toBeLessThanOrEqual(0.01)

    // 장비 값
    const rec = new DataView(records.buffer, records.byteOffset + ((k * beamsTotal + b) * RAWC.gateSlots + RAWC.gateSlotA) * RAWC.recordBytes, RAWC.recordBytes)
    const raw = rec.getUint32(RAWC.peakRawAt, true)
    expect(raw).toBe(RAWC.raw)
    const devicePct = rawToPercent(raw, g.ampScale)
    expect(Math.abs(devicePct - RAWC.pct)).toBeLessThanOrEqual(0.01)

    // 우리 게이트 A 계산과 비교
    const cs = createGateCscan(g, gate.id)
    fillGateCscan(cs, g, gate, chunks[0]!)
    expect(cs.peakRaw[k * g.shape[1] + b]).toBe(raw)
    expect(Math.abs(gatePeakAt(cs, g, k, b)!.pct - devicePct)).toBeLessThanOrEqual(0.01)
  })
})

/**
 * 게이트 편집 엔진의 회귀 기준 (계획_후처리.md 6절 2·3). RawCScan 레코드에는 게이트 I·A·B 값이 모두 있다.
 *   - 게이트 B(id 2, SoundPath 24.6722 µs / 12.34 µs, Peak)로 계산한 C-scan 과 장비 값이 정수로 같은 칸 수를 **실측 그대로** 고정한다.
 *   - 게이트 I 는 start 4.4422 µs 가 저장 구간 시작(t0 8.052 µs)보다 앞이라 장비가 저장되지 않은 구간까지 본 값 → 전체 대조 제외, 한 점(85)만.
 */
const GATE_SNAP = {
  /** 그룹별 [게이트 B 일치 칸 수, 전체 칸 수] */
  gateB: [
    [9178, 9331],
    [9028, 9331]
  ] as const,
  gateIAt39_54: 85,
  /** 파일 게이트 A 의 표시값 (빔 0 기준 역산) */
  gateAMm: { startMm: 7.0, lengthMm: 21.0 }
}

describe.skipIf(!HAS)('게이트 편집 오라클 (테스트 전용): X3 12T-SV-01', () => {
  it('파일 게이트 A 의 표시값 = 깊이 7.0 mm 시작 · 21.0 mm 폭, 7.0/21.0 을 넣어 재환산하면 ±0.5 샘플 안', async () => {
    const { info } = await load()
    for (const g of info.groups) {
      const gate = findGate(g, g.cscanGateId)!
      const v = gateDisplayValues(gate, g)
      expect(v.geometry).toBe('TrueDepth')
      expect(Math.abs(v.startMm - GATE_SNAP.gateAMm.startMm)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(v.lengthMm - GATE_SNAP.gateAMm.lengthMm)).toBeLessThanOrEqual(0.05)
      const re = applyGateOverride(gate, g, { startMm: 7.0, lengthMm: 21.0 })
      const half = g.ultrasound.resolutionUs / 2
      g.beams.forEach((_, b) => {
        expect(Math.abs(re.startUs[b]! - gate.startUs[b]!), `g${g.id} b${b} start`).toBeLessThanOrEqual(half)
        expect(Math.abs(re.lengthUs[b]! - gate.lengthUs[b]!), `g${g.id} b${b} length`).toBeLessThanOrEqual(half)
      })
      // override 없음·문턱만이면 파일 배열 참조 그대로 (정답표 불변의 근거)
      expect(applyGateOverride(gate, g, undefined)).toBe(gate)
      expect(applyGateOverride(gate, g, { thresholdPct: 40 }).startUs).toBe(gate.startUs)
      expect(gateWindowSignature(g, applyGateOverride(gate, g, { thresholdPct: 40 }))).toBe(gateWindowSignature(g, gate))
    }
  })

  it('게이트 B 로 계산한 C-scan 과 장비 RawCScan 게이트 B 값이 같은 칸 수 (실측 스냅샷)', async () => {
    const { info, chunks } = await load()
    const { records } = await readMxuBytes()
    const beamsTotal = info.groups.reduce((n, x) => n + x.shape[1], 0)
    let beamBase = 0
    info.groups.forEach((g, gi) => {
      const gateB = g.gates.find((x) => /gate\s*b/i.test(x.name))!
      expect(gateB.supported).toBe(true)
      const cs = createGateCscan(g, gateB.id)
      fillGateCscan(cs, g, gateB, chunks[gi]!)
      const [ns, nb] = g.shape
      let same = 0
      for (let k = 0; k < ns; k++) {
        for (let b = 0; b < nb; b++) {
          const rec = new DataView(records.buffer, records.byteOffset + ((k * beamsTotal + beamBase + b) * RAWC.gateSlots + 2) * RAWC.recordBytes, RAWC.recordBytes)
          if (rec.getUint32(RAWC.peakRawAt, true) === cs.peakRaw[k * nb + b]) same++
        }
      }
      expect([same, ns * nb], `그룹 ${g.id}`).toEqual([...GATE_SNAP.gateB[gi]!])
      beamBase += nb
    })
  })

  it('게이트 I (저장 구간 밖에서 시작): 스캔 39·54° 한 점만 장비 값 85 와 같다', async () => {
    const { info, chunks } = await load()
    const g = info.groups[0]!
    const gateI = g.gates.find((x) => /gate\s*i/i.test(x.name))!
    const cs = createGateCscan(g, gateI.id)
    fillGateCscan(cs, g, gateI, chunks[0]!)
    const k = scanIndexAt(FIX.cursor.scanMm, g.scan)
    const b = beamIndexOf(g, FIX.cursor.angleDegGroup0)
    expect(cs.peakRaw[k * g.shape[1] + b]).toBe(GATE_SNAP.gateIAt39_54)
  })
})
