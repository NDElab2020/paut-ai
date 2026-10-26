/**
 * 2026-10-07 빌드 전 최적화 (renderBscan 행 우선·renderCscan 클로저 없앰·buildSscanMap φ 다시 쓰기·화소 Uint32 쓰기) 가
 * 그림 바이트를 바꾸지 않는지 — 예전 함수(tests/helpers/imagingRef.ts, 글자 그대로 옮긴 것)와 바이트 대조.
 *  - 합성: 상태 비트 구멍·창(정수·정수 아님·범위 밖)·깊이 창·축소(묶음)·reversed·out 종류(Uint8Array·Uint8ClampedArray)·
 *    4바이트 경계가 아닌 out·짧은 out·짧은 색표·소수 noData·비정상 이득 계수(NaN·음수)
 *  - 실데이터(있으면): X3·X4 TF·공식 예제·OPD 그룹마다 조회표 7개 배열·S/C/B-scan 그림
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import { readOpdViewerChunk, readOpdViewerInfo } from '@core/opd/viewer'
import {
  VIEWER_NO_DATA_SPECIAL_INDEX,
  buildSscanMap,
  createGateCscan,
  fillGateCscan,
  findGate,
  hexToRgb,
  paletteRgb,
  rawIndexFactor,
  renderBscan,
  renderBscanGeneric,
  renderCscan,
  renderSscan,
  sscanExtent,
  type BscanRenderInput,
  type CscanRenderInput,
  type GateCscan,
  type SscanMap,
  type SscanRenderInput,
  type SscanViewport,
  type ViewerFileInfo,
  type ViewerGroup
} from '@shared/imaging'
import { buildSscanMapRef, renderBscanRef, renderCscanRef, renderSscanRef } from './helpers/imagingRef'
import { EXAMPLES_DIR, OPD_FILES, X3_FILES, X4_TF_COMPOUND, X4_TF_LINEAR, listExampleFiles, opdPath } from './paths'

type Bytes = Uint8Array | Uint8ClampedArray

const sha = (a: ArrayBufferView): string => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex')
const mapSha = (m: SscanMap): string => {
  const h = createHash('sha256')
  for (const a of [m.beam0, m.beam1, m.at0, m.at1, m.frac0, m.frac1, m.weight]) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
  return h.digest('hex')
}

/** 결정적 의사 난수 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 같은 입력을 새 함수·예전 함수에 넣어 out 전체(앞뒤 여분 포함) 바이트가 같은가 */
function sameBytes(make: () => Bytes, draw: (out: Bytes) => void, ref: (out: Bytes) => void): boolean {
  const a = make()
  const b = make()
  draw(a)
  ref(b)
  return a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0
}

/** out 종류: 보통 · 클램프 · 4바이트 경계 아님(1바이트 밀린 보기) · 짧음(앞 3/4) — 미리 채운 값이 같아야 쓰지 않은 바이트도 대조된다 */
function outKinds(n: number): Array<{ name: string; make: () => Bytes }> {
  const fill = (a: Bytes): Bytes => {
    for (let i = 0; i < a.length; i++) a[i] = (i * 37) & 255
    return a
  }
  return [
    { name: 'u8', make: () => fill(new Uint8Array(n * 4)) },
    { name: 'clamped', make: () => fill(new Uint8ClampedArray(n * 4)) },
    { name: 'offset1', make: () => fill(new Uint8Array(new ArrayBuffer(n * 4 + 8), 1, n * 4)) },
    { name: 'clampedOffset2', make: () => fill(new Uint8ClampedArray(new ArrayBuffer(n * 4 + 8), 2, n * 4)) },
    { name: 'short', make: () => fill(new Uint8Array(Math.floor((n * 4 * 3) / 4))) }
  ]
}

function synthPalette(len = 768): Uint8Array {
  const p = new Uint8Array(len)
  for (let i = 0; i < len; i++) p[i] = (i * 7 + 3) & 255
  return p
}

interface Synth {
  shape: [number, number, number]
  amplitude: Int16Array
  status: Uint8Array | null
}

function synthVolume(seed: number, ns: number, nb: number, nt: number, holes: boolean): Synth {
  const r = rng(seed)
  const amplitude = new Int16Array(ns * nb * nt)
  for (let i = 0; i < amplitude.length; i++) amplitude[i] = Math.floor((r() - 0.15) * 32767)
  let status: Uint8Array | null = null
  if (holes) {
    status = new Uint8Array(ns * nb)
    for (let i = 0; i < status.length; i++) status[i] = r() < 0.12 ? 0 : 1 | (r() < 0.5 ? 2 : 0)
  }
  return { shape: [ns, nb, nt], amplitude, status }
}

describe('그리기 최적화 — 예전 함수와 바이트 같음 (합성)', () => {
  const palettes: Array<[string, Uint8Array]> = [
    ['256색', synthPalette()],
    ['짧은 색표', synthPalette(300)]
  ]
  const factors = [rawIndexFactor({ rawMax: 32767, unitMax: 100 }), rawIndexFactor({ rawMax: 16000, unitMax: 200 }), NaN, -0.01]

  it('renderBscan: 확대·축소·창·깊이 창·상태 구멍·out 종류', () => {
    let cases = 0
    const diffs: string[] = []
    for (const [ns, nb, nt, holes] of [
      [40, 3, 50, true],
      [300, 2, 120, false],
      [7, 1, 2, true]
    ] as const) {
      const v = synthVolume(ns * 31 + nb, ns, nb, nt, holes)
      const windows: Array<Partial<BscanRenderInput>> = [
        {},
        { scanFrom: 5, scanTo: Math.max(6, ns - 3), sampleFrom: nt * 0.2, sampleTo: nt * 0.7 },
        { scanFrom: -3, scanTo: ns + 4 },
        { scanFrom: 2, scanTo: 2 },
        { scanFrom: 1.5, scanTo: ns - 0.25 },
        { sampleFrom: nt - 0.5, sampleTo: -0.5 }
      ]
      for (const win of windows) {
        for (const [w, h] of [
          [97, 31],
          [Math.max(2, Math.floor(ns / 3)), 17],
          [ns * 3, 8]
        ] as const) {
          for (const [pn, palette] of palettes) {
            for (const factor of factors) {
              for (const beam of [0, nb - 1]) {
                for (const o of outKinds(w * h)) {
                  const inp = (out: Bytes): BscanRenderInput => ({ group: { shape: v.shape }, amplitude: v.amplitude, status: v.status, beam, width: w, height: h, ...win, indexFactor: factor, palette, noData: [7.6, 300, -2], out })
                  cases++
                  if (!sameBytes(o.make, (out) => renderBscan(inp(out)), (out) => renderBscanRef(inp(out)))) diffs.push(`${ns}x${nb}x${nt} ${JSON.stringify(win)} ${w}x${h} ${pn} f=${factor} b=${beam} ${o.name}`)
                }
              }
            }
          }
        }
      }
    }
    expect(diffs).toEqual([])
    expect(cases).toBeGreaterThan(2000)
    // 예전 함수는 renderBscanGeneric 으로도 남아 있다 (정수가 아닌 창일 때 그 길)
    const v = synthVolume(5, 20, 2, 30, true)
    const inp = (out: Bytes): BscanRenderInput => ({ group: { shape: v.shape }, amplitude: v.amplitude, status: v.status, beam: 1, width: 33, height: 9, indexFactor: factors[0]!, palette: palettes[0]![1], noData: [1, 2, 3], out })
    expect(sameBytes(() => new Uint8Array(33 * 9 * 4), (out) => renderBscanGeneric(inp(out)), (out) => renderBscanRef(inp(out)))).toBe(true)
  })

  it('renderCscan: 확대·축소(스캔·빔 축)·창·reversed·데이터 없음 칸·out 종류', () => {
    let cases = 0
    const diffs: string[] = []
    for (const [ns, nb] of [
      [60, 11],
      [900, 64],
      [3, 2]
    ] as const) {
      const r = rng(ns + nb)
      const cs: GateCscan = { gateId: 0, scanCount: ns, beamCount: nb, peakRaw: new Int16Array(ns * nb), peakSample: new Int32Array(ns * nb) }
      for (let i = 0; i < ns * nb; i++) {
        cs.peakRaw[i] = Math.floor((r() - 0.1) * 32767)
        cs.peakSample[i] = r() < 0.1 ? -1 : Math.floor(r() * 500)
      }
      for (const win of [{}, { scanFrom: 3, scanTo: Math.max(4, ns - 5) }, { scanFrom: 0, scanTo: 1 }]) {
        for (const [w, h] of [
          [123, 40],
          [Math.max(2, Math.floor(ns / 4)), Math.max(1, Math.floor(nb / 3))],
          [17, 200]
        ] as const) {
          for (const reversed of [false, true]) {
            for (const [pn, palette] of palettes) {
              for (const factor of factors) {
                for (const o of outKinds(w * h)) {
                  const inp = (out: Bytes): CscanRenderInput => ({ cscan: cs, width: w, height: h, reversed, ...win, indexFactor: factor, palette, noData: [9, 8.5, 7], out })
                  cases++
                  if (!sameBytes(o.make, (out) => renderCscan(inp(out)), (out) => renderCscanRef(inp(out)))) diffs.push(`${ns}x${nb} ${JSON.stringify(win)} ${w}x${h} rev=${reversed} ${pn} f=${factor} ${o.name}`)
                }
              }
            }
          }
        }
      }
    }
    expect(diffs).toEqual([])
    expect(cases).toBeGreaterThan(1000)
  })

  it('buildSscanMap·renderSscan: 섹토리얼·리니어·컴파운드·스큐 270·확대 뷰포트', () => {
    const beamsOf = (kind: 'sect' | 'lin' | 'comp' | 'mixed', skew: number) =>
      Array.from({ length: 24 }, (_, i) => ({
        angleDeg: kind === 'lin' ? 60 : kind === 'sect' ? 35 + i * 1.5 : kind === 'comp' ? 50 + i * 0.75 : 40 + ((i * 7) % 24),
        vOffsetMm: kind === 'sect' ? -10 - i * 0.05 : kind === 'lin' ? -40 + i * 1.2 : kind === 'comp' ? -45 + i : -20 + ((i * 5) % 9),
        skewDeg: skew,
        velocityMps: 3240,
        t0Us: 4 + i * 0.02
      }))
    const diffs: string[] = []
    let cases = 0
    for (const kind of ['sect', 'lin', 'comp', 'mixed'] as const) {
      for (const skew of [90, 270]) {
        const group = { beams: beamsOf(kind, skew), ultrasound: { count: 400, resolutionUs: 0.05 } } as unknown as ViewerGroup
        const e = sscanExtent(group)
        for (const vp of [
          { vMinMm: e.vMinMm - 1, vMaxMm: e.vMaxMm + 1, depthMinMm: Math.max(0, e.depthMinMm - 1), depthMaxMm: e.depthMaxMm + 1, width: 160, height: 120 },
          { vMinMm: e.vMinMm * 0.5, vMaxMm: e.vMaxMm * 0.5, depthMinMm: -3, depthMaxMm: e.depthMaxMm * 0.6, width: 97, height: 61 }
        ] satisfies SscanViewport[]) {
          const m = buildSscanMap(group, vp)
          const ref = buildSscanMapRef(group, vp)
          cases++
          if (mapSha(m) !== mapSha(ref)) diffs.push(`map ${kind} ${skew} ${vp.width}`)
          const v = synthVolume(cases, 3, 24, 400, cases % 2 === 0)
          for (const [pn, palette] of palettes) {
            for (const factor of factors) {
              for (const bg of [
                [0, 0, 0, 0],
                [128, 64.5, 300, 255]
              ] as const) {
                for (const o of outKinds(vp.width * vp.height)) {
                  const inp = (out: Bytes): SscanRenderInput => ({ map: ref, amplitude: v.amplitude, offset: 24 * 400, status: v.status, statusOffset: 24, indexFactor: factor, palette, noData: [5, 6, 7], background: bg, out })
                  cases++
                  if (!sameBytes(o.make, (out) => renderSscan(inp(out)), (out) => renderSscanRef(inp(out)))) diffs.push(`render ${kind} ${skew} ${pn} f=${factor} ${o.name}`)
                }
              }
            }
          }
        }
      }
    }
    expect(diffs).toEqual([])
    expect(cases).toBeGreaterThan(500)
  })
})

interface Loaded {
  name: string
  info: ViewerFileInfo
  group: ViewerGroup
  amplitude: Int16Array
  status: Uint8Array | null
}

const NDE = [X3_FILES[0]!, X3_FILES[2]!, X4_TF_COMPOUND, X4_TF_LINEAR, ...(existsSync(EXAMPLES_DIR) ? listExampleFiles() : [])].filter((p) => existsSync(p))
const OPD = [OPD_FILES.tp14RootL, OPD_FILES.tp14RootR, OPD_FILES.pl23861RootL].map(opdPath).filter((p) => existsSync(p))

describe.skipIf(NDE.length + OPD.length === 0)('그리기 최적화 — 실데이터 그룹마다 바이트 같음', () => {
  it(`NDE ${NDE.length}개 · OPD ${OPD.length}개`, async () => {
    const loaded: Loaded[] = []
    for (const p of NDE) {
      const info = await readViewerInfo(p)
      for (const g of info.groups.filter((x) => x.supported)) {
        const c = await readViewerChunk(p, g, 0, g.shape[0])
        loaded.push({ name: `${p.split('/').pop()}#${g.name}`, info, group: g, amplitude: c.amplitude, status: c.status })
      }
    }
    for (const p of OPD) {
      const info = await readOpdViewerInfo(p)
      for (const g of info.groups.filter((x) => x.supported)) {
        const c = await readOpdViewerChunk(p, g, 0, g.shape[0])
        loaded.push({ name: `${p.split('/').pop()}#${g.name}`, info, group: g, amplitude: c.amplitude, status: c.status })
      }
    }
    const diffs: string[] = []
    let cases = 0
    for (const L of loaded) {
      const { info, group: g, amplitude, status } = L
      const palette = paletteRgb(info.display.palette)
      const noData = hexToRgb(info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080')
      const factor = rawIndexFactor(g.ampScale)
      const [ns, nb, nt] = g.shape
      const e = sscanExtent(g)
      for (const vp of [
        { vMinMm: e.vMinMm - 1, vMaxMm: e.vMaxMm + 1, depthMinMm: Math.max(0, e.depthMinMm - 1), depthMaxMm: e.depthMaxMm + 1, width: 300, height: 225 },
        { vMinMm: e.vMinMm * 0.5, vMaxMm: e.vMaxMm * 0.5, depthMinMm: Math.max(0, e.depthMinMm + 2), depthMaxMm: e.depthMaxMm * 0.6, width: 241, height: 180 }
      ]) {
        const m = buildSscanMap(g, vp)
        const ref = buildSscanMapRef(g, vp)
        cases++
        if (mapSha(m) !== mapSha(ref)) diffs.push(`map ${L.name} ${vp.width}`)
        for (const k of [0, Math.floor(ns / 2)]) {
          const a = new Uint8ClampedArray(vp.width * vp.height * 4)
          const b = new Uint8ClampedArray(vp.width * vp.height * 4)
          const inp = (out: Bytes): SscanRenderInput => ({ map: ref, amplitude, offset: k * nb * nt, status, statusOffset: k * nb, indexFactor: factor, palette, noData, background: [0, 0, 0, 0], out })
          renderSscan(inp(a))
          renderSscanRef(inp(b))
          cases++
          if (sha(a) !== sha(b)) diffs.push(`sscan ${L.name} k${k}`)
        }
      }
      const gate = findGate(g, g.cscanGateId)
      if (gate?.supported) {
        const cs = createGateCscan(g, gate.id)
        fillGateCscan(cs, g, gate, { scanStart: 0, scanCount: ns, amplitude, status })
        for (const [w, h] of [
          [600, 100],
          [Math.max(4, Math.floor(ns / 3)), Math.max(2, Math.floor(nb / 2))]
        ] as const) {
          for (const win of [{}, { scanFrom: Math.floor(ns * 0.4), scanTo: Math.max(Math.floor(ns * 0.4) + 2, Math.floor(ns * 0.65)) }]) {
            for (const reversed of [false, true]) {
              const a = new Uint8ClampedArray(w * h * 4)
              const b = new Uint8ClampedArray(w * h * 4)
              const inp = (out: Bytes): CscanRenderInput => ({ cscan: cs, width: w, height: h, reversed, ...win, indexFactor: factor, palette, noData, out })
              renderCscan(inp(a))
              renderCscanRef(inp(b))
              cases++
              if (sha(a) !== sha(b)) diffs.push(`cscan ${L.name} ${w}x${h} ${JSON.stringify(win)} ${reversed}`)
            }
          }
        }
      }
      for (const [w, h] of [
        [600, 150],
        [Math.max(8, Math.floor(ns / 3)), 150]
      ] as const) {
        for (const win of [{}, { scanFrom: Math.floor(ns * 0.4), scanTo: Math.max(Math.floor(ns * 0.4) + 2, Math.floor(ns * 0.6)), sampleFrom: nt * 0.2, sampleTo: nt * 0.7 }]) {
          for (const beam of [g.initialBeam, nb - 1]) {
            const a = new Uint8ClampedArray(w * h * 4)
            const b = new Uint8ClampedArray(w * h * 4)
            const inp = (out: Bytes): BscanRenderInput => ({ group: g, amplitude, status, beam, width: w, height: h, ...win, indexFactor: factor, palette, noData, out })
            renderBscan(inp(a))
            renderBscanRef(inp(b))
            cases++
            if (sha(a) !== sha(b)) diffs.push(`bscan ${L.name} ${w}x${h} ${JSON.stringify(win)} b${beam}`)
          }
        }
      }
    }
    expect(diffs).toEqual([])
    expect(cases).toBeGreaterThan(loaded.length * 10)
  }, 180_000)
})
