/**
 * 그릴 수 있는 모든 그룹(X3 + 공식 예제)을 S·C·B-scan 으로 실제로 그려 본다 — OmniPC 대조 전 형식(4.x 등)의 기본 점검.
 * PAUT_VIEWER_SHOTS=<폴더> 면 파일·그룹마다 그림을 저장한다 (OmniPC 캡처가 오면 나란히 대조할 용도).
 */
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
  renderBscan,
  renderCscan,
  renderSscan,
  sscanExtent,
  type GateCscan,
  type ViewerFileInfo,
  type ViewerGroup
} from '@shared/imaging'
import { stack, writePng, type Rgba } from './helpers/png'
import { EXAMPLES_DIR, X3_FILES, listExampleFiles } from './paths'

const FILES = [X3_FILES[0]!, X3_FILES[2]!, ...(existsSync(EXAMPLES_DIR) ? listExampleFiles() : [])].filter((p) => existsSync(p))
const SHOTS = process.env['PAUT_VIEWER_SHOTS']

function img(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

/** C-scan 이 가장 센 스캔 칸 (뷰어 첫 화면과 같은 규칙) */
function strongestScan(cs: GateCscan | null): number {
  if (!cs) return 0
  let best = -1
  let at = 0
  for (let c = 0; c < cs.peakRaw.length; c++) {
    if (cs.peakSample[c]! >= 0 && cs.peakRaw[c]! > best) {
      best = cs.peakRaw[c]!
      at = Math.floor(c / cs.beamCount)
    }
  }
  return at
}

function drawGroup(info: ViewerFileInfo, g: ViewerGroup, amplitude: Int16Array, status: Uint8Array | null) {
  const palette = paletteRgb(info.display.palette)
  const noData = hexToRgb(info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080')
  const factor = rawIndexFactor(g.ampScale)
  const [ns, nb, nt] = g.shape
  const gate = findGate(g, g.cscanGateId)
  let cs: GateCscan | null = null
  if (gate?.supported) {
    cs = createGateCscan(g, gate.id)
    fillGateCscan(cs, g, gate, { scanStart: 0, scanCount: ns, amplitude, status })
  }
  const k = strongestScan(cs)
  const e = sscanExtent(g)
  const s = img(560, 400)
  const map = buildSscanMap(g, { vMinMm: e.vMinMm - 1, vMaxMm: e.vMaxMm + 1, depthMinMm: Math.max(0, e.depthMinMm - 1), depthMaxMm: e.depthMaxMm + 1, width: s.width, height: s.height })
  renderSscan({ map, amplitude, offset: k * nb * nt, status, statusOffset: k * nb, indexFactor: factor, palette, noData, background: [0, 0, 0, 255], out: s.data })
  const c = img(900, 160)
  if (cs) renderCscan({ cscan: cs, width: c.width, height: c.height, reversed: info.display.cscanReversed, indexFactor: factor, palette, noData, out: c.data })
  const b = img(900, 240)
  renderBscan({ group: g, amplitude, status, beam: g.initialBeam, width: b.width, height: b.height, indexFactor: factor, palette, noData, out: b.data })
  return { k, s, c, b, cs, mapInside: map.beam0.filter((x) => x >= 0).length }
}

describe.skipIf(FILES.length === 0)('그릴 수 있는 그룹 전부 그려 보기', () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  for (const path of FILES) {
    it(basename(path), async () => {
      const info = await readViewerInfo(path)
      for (const g of info.groups.filter((x) => x.supported)) {
        const chunk = await readViewerChunk(path, g, 0, g.shape[0])
        expect(chunk.scanCount).toBe(g.shape[0])
        const r = drawGroup(info, g, chunk.amplitude, chunk.status)
        // 부채꼴이 화면의 상당 부분을 채우고, 게이트 C-scan 이 계산된다
        expect(r.mapInside, `${g.name} 부채꼴 픽셀`).toBeGreaterThan(560 * 400 * 0.15)
        expect(r.cs, `${g.name} C-scan`).not.toBeNull()
        expect(r.cs!.peakSample.some((x) => x >= 0), `${g.name} C-scan 데이터`).toBe(true)
        // 그림이 한 색이 아니다 (데이터가 실제로 칠해짐)
        const colors = new Set<number>()
        for (let p = 0; p < r.s.data.length; p += 4 * 97) colors.add((r.s.data[p]! << 16) | (r.s.data[p + 1]! << 8) | r.s.data[p + 2]!)
        expect(colors.size, `${g.name} S-scan 색 수`).toBeGreaterThan(5)
        if (SHOTS) {
          const name = `${basename(path, '.nde')}_${g.name}`.replace(/[^\w가-힣.-]+/g, '_')
          writePng(resolve(SHOTS, `${name}.png`), stack([r.s, r.c, r.b], 6))
        }
      }
    })
  }
})
