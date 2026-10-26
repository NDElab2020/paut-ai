/**
 * 라벨링 지침서 v1 예시 그림 (계획_라벨링/지침서_v1_부록_X3예시.md, 출력 계획_라벨링/지침서_그림/).
 * 부록·그림에는 X3 결함 위치가 나오므로 블라인드 판독자에게는 주지 않는다(지침서 본문 16절).
 *
 * X3 12T-SV 4개 파일의 00_결함정보.docx 위치 11건(07_프로토타입/05_YOLO실험_paut-ai_2026-08-07/labels.py 와 같은 목록)마다
 *   - docx 위치 ±12 mm 안에서 게이트 A 최대(두 그룹, 모든 빔)가 가장 큰 스캔 위치를 고르고
 *     (같은 값이 여럿이면 docx 위치에 가까운 쪽, 그다음 그룹 번호가 작은 쪽)
 *   - 그 위치의 S-scan(두 그룹, 펼친 깊이, 앱과 같은 그림)과 C-scan(docx 위치 ±40 mm, 두 그룹)을 한 장으로 그린다.
 * 고른 칸의 게이트 A 최대가 같은 빔 바탕값보다 12 dB 도 크지 않으면(스캔 방향으로 이어진 띠 — 형상 에코로 보이는 것에 끌림)
 * '_보조' 그림을 하나 더 만든다: 같은 창 안에서 '같은 빔 바탕값 대비 dB' 가 가장 큰 칸의 S-scan·C-scan.
 * 파일마다 전체 C-scan 에 docx 위치를 표시한 개요 그림도 하나씩 만든다. 수치는 그림_목록.json 에 적는다.
 *
 * PAUT_GUIDE_FIGS=<출력 폴더> 가 있을 때만 그림을 쓴다(없으면 건너뜀). 데이터 읽기·그리기는 기존 공개 함수
 * (@core/nde/viewer 읽기, @shared/imaging 계산)만 쓰고, 원시데이터는 읽기만 한다.
 * 그림은 '결함정보 docx 위치 기준 예시'다. 고른 위치는 게이트 A 최대일 뿐 결함 경계가 아니며, 형상 에코에 끌려갈 수 있다.
 *
 * 실행: PAUT_GUIDE_FIGS="$(pwd)/../계획_라벨링/지침서_그림" npx vitest run tests/labels/guideFigures.test.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import {
  VIEWER_NO_DATA_SPECIAL_INDEX,
  buildSscanMap,
  createGateCscan,
  cscanYForBeam,
  fillGateCscan,
  findGate,
  foldDepth,
  gateDisplayValues,
  gatePeakAt,
  hexToRgb,
  paletteRgb,
  rawIndexFactor,
  rawToPercent,
  renderCscan,
  renderSscan,
  samplePoint,
  scanIndexAt,
  scanPositionMm,
  sscanExtent,
  viewportPixel,
  weldOverlay,
  type GateCscan,
  type SscanViewport,
  type ViewerFileInfo,
  type ViewerGroup,
  type ViewerVolumeChunk
} from '@shared/imaging'
import { writePng } from '../helpers/png'
import { X3_DIR, X3_FILES } from '../paths'
import { COLOR, Canvas, blank, textWidth } from './figureKit'

// ───────────────────────────── docx 목록 ─────────────────────────────

export interface DocxEntry {
  /** .nde 파일 이름 */
  file: string
  /** docx 의 '위치' (mm). 결함 중심으로 추정하지만 정의는 확인 전 */
  uMm: number
  /** docx 에 적힌 종류 그대로 */
  docxType: string
  /** 한국어 이름 (지침서 표용) */
  ko: string
}

/** 00_결함정보.docx 의 11건 (labels.py LABELS 와 같은 순서·값) */
export const DOCX_ENTRIES: readonly DocxEntry[] = [
  { file: '12T-SV-01-Cap on.nde', uMm: 38, docxType: 'Toe Crack', ko: '토우 균열' },
  { file: '12T-SV-01-Cap on.nde', uMm: 135, docxType: 'Lack of fusion', ko: '융합불량' },
  { file: '12T-SV-01-Cap on.nde', uMm: 200, docxType: 'Side wall crack', ko: '측벽 균열' },
  { file: '12T-SV-01-Cap on.nde', uMm: 240, docxType: 'Slag', ko: '슬래그' },
  { file: '12T-SV-02-Cap on.nde', uMm: 160, docxType: 'Root crack', ko: '루트 균열' },
  { file: '12T-SV-02-Cap on.nde', uMm: 220, docxType: 'Lack of fusion', ko: '융합불량' },
  { file: '12T-SV-03-Cap off.nde', uMm: 65, docxType: 'Side Wall Crack', ko: '측벽 균열' },
  { file: '12T-SV-03-Cap off.nde', uMm: 150, docxType: 'IP', ko: '용입불량' },
  { file: '12T-SV-03-Cap off.nde', uMm: 250, docxType: 'Lack of fusion', ko: '융합불량' },
  { file: '12T-SV-04-Cap on.nde', uMm: 160, docxType: 'Root Crack', ko: '루트 균열' },
  { file: '12T-SV-04-Cap on.nde', uMm: 220, docxType: 'Porosity', ko: '기공' }
]

/** 탐색 창 반폭 (mm): docx 위치 ±12 */
const HALF_SEARCH_MM = 12
/** C-scan 그림 반폭 (mm): docx 위치 ±40 */
const HALF_CSCAN_MM = 40
/** S-scan 배율 (px/mm, 가로·세로 같음) */
const S_PX_PER_MM = 7
/** C-scan 배율: 스캔 1칸 = 12 px, 빔 1개 = 6 px */
const C_PX_PER_SCAN = 12
const C_PX_PER_BEAM = 6
/** 전체 C-scan 개요 배율 */
const O_PX_PER_SCAN = 3
const O_PX_PER_BEAM = 4

const OUT = process.env['PAUT_GUIDE_FIGS']

function pad3(n: number): string {
  return String(Math.round(n)).padStart(3, '0')
}

/** 그림 파일 이름: 번호_파일_위치_종류.png ('01_12T-SV-01_038mm_ToeCrack.png') */
export function figureName(no: number, e: DocxEntry): string {
  const file = basename(e.file, '.nde').replace(/-Cap (on|off)$/i, '')
  const type = e.docxType
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
  return `${String(no).padStart(2, '0')}_${file}_${pad3(e.uMm)}mm_${type}.png`
}

// ───────────────────────────── 계산 ─────────────────────────────

interface Loaded {
  info: ViewerFileInfo
  groups: ViewerGroup[]
  chunks: ViewerVolumeChunk[]
  cscans: GateCscan[]
}

async function loadFile(path: string): Promise<Loaded> {
  const info = await readViewerInfo(path)
  const groups = info.groups.filter((g) => g.supported && findGate(g, g.cscanGateId)?.supported)
  const chunks: ViewerVolumeChunk[] = []
  const cscans: GateCscan[] = []
  for (const g of groups) {
    const chunk = await readViewerChunk(path, g, 0, g.shape[0])
    expect(chunk.scanCount, `${g.name} 한 조각으로 다 읽힘`).toBe(g.shape[0])
    const gate = findGate(g, g.cscanGateId)!
    const cs = createGateCscan(g, gate.id)
    fillGateCscan(cs, g, gate, chunk)
    chunks.push(chunk)
    cscans.push(cs)
  }
  return { info, groups, chunks, cscans }
}

/** 칸 (k, b) 의 게이트 A 최대 %FSH. 데이터 없으면 null */
function cellPct(cs: GateCscan, g: ViewerGroup, k: number, b: number): number | null {
  const cell = k * cs.beamCount + b
  if (cs.peakSample[cell]! < 0) return null
  return rawToPercent(cs.peakRaw[cell]!, g.ampScale)
}

/** 스캔 칸 k 에서 그 그룹 게이트 A 최대가 가장 큰 빔 */
function bestBeamAt(cs: GateCscan, g: ViewerGroup, k: number): { beam: number; pct: number } | null {
  let best: { beam: number; pct: number } | null = null
  for (let b = 0; b < cs.beamCount; b++) {
    const p = cellPct(cs, g, k, b)
    if (p !== null && (!best || p > best.pct)) best = { beam: b, pct: p }
  }
  return best
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

interface PointInfo {
  scanMm: number
  beam: number
  angleDeg: number
  pct: number
  saturated: boolean
  /** 펼친 깊이 (화면 세로) */
  unfoldedDepthMm: number
  /** 실제 깊이 (두께 안으로 접은 값) */
  depthMm: number
  leg: number | null
  vMm: number
}

function pointInfo(L: Loaded, gi: number, k: number, b: number): PointInfo | null {
  const g = L.groups[gi]!
  const peak = gatePeakAt(L.cscans[gi]!, g, k, b)
  if (!peak) return null
  const raw = L.cscans[gi]!.peakRaw[k * g.shape[1] + b]!
  const fold = foldDepth(peak.depthMm, L.info.specimen.thicknessMm)
  return {
    scanMm: scanPositionMm(k, g.scan),
    beam: b,
    angleDeg: g.beams[b]!.angleDeg,
    pct: peak.pct,
    saturated: raw >= g.ampScale.rawMax,
    unfoldedDepthMm: peak.depthMm,
    depthMm: fold.depthMm,
    leg: fold.leg,
    vMm: peak.vMm
  }
}

interface ContrastPoint extends PointInfo {
  /** 같은 빔 바탕값 (%FSH) */
  backgroundPct: number
  /** 바탕값 대비 (dB) */
  contrastDb: number
}

interface GroupStat {
  groupId: number
  name: string
  /** 탐색 창(±12 mm) 안 이 그룹의 게이트 A 최대 */
  windowPeak: PointInfo | null
  /** 고른 스캔 위치에서 이 그룹의 게이트 A 최대 */
  atShown: PointInfo | null
  /** windowPeak 빔의 바탕값: 같은 빔, ±40 mm 안이면서 ±12 mm 밖의 중앙값 (%FSH) */
  beamBackgroundPct: number | null
  /** windowPeak / 바탕값 (dB). 스캔 방향으로 이어진 띠(형상 에코로 보이는 것)면 작게 나온다 */
  contrastDb: number | null
  /**
   * 탐색 창 안에서 '같은 빔 바탕값 대비 dB' 가 가장 큰 칸. 기본 그림 선택에는 쓰지 않고,
   * 보조 그림(게이트 A 최대가 띠에 끌린 경우)과 지침서 표에서 띠 밖 국부 응답을 짚는 참고값으로만 쓴다.
   */
  contrastPeak: ContrastPoint | null
  /** 빔마다 바탕값 (%FSH, 없으면 null) */
  backgrounds: Array<number | null>
}

interface ScanPick {
  k: number
  scanMm: number
  groupIndex: number
  beam: number
  pct: number
  window: [number, number]
}

/** docx 위치 ±12 mm 안에서 게이트 A 최대가 가장 큰 스캔 칸 (두 그룹·모든 빔). 같으면 docx 위치에 가까운 칸, 그다음 앞 그룹 */
function pickScan(L: Loaded, uMm: number): ScanPick {
  const axis = L.groups[0]!.scan
  const k0 = scanIndexAt(uMm - HALF_SEARCH_MM, axis)
  const k1 = scanIndexAt(uMm + HALF_SEARCH_MM, axis)
  let best: ScanPick | null = null
  for (let k = k0; k <= k1; k++) {
    for (let gi = 0; gi < L.groups.length; gi++) {
      const bb = bestBeamAt(L.cscans[gi]!, L.groups[gi]!, k)
      if (!bb) continue
      const u = scanPositionMm(k, axis)
      const better = !best || bb.pct > best.pct || (bb.pct === best.pct && Math.abs(u - uMm) < Math.abs(best.scanMm - uMm))
      if (better) best = { k, scanMm: u, groupIndex: gi, beam: bb.beam, pct: bb.pct, window: [k0, k1] }
    }
  }
  if (!best) throw new Error(`${uMm} mm 근처에 게이트 A 데이터가 없습니다.`)
  return best
}

/** 빔마다 바탕값: ±40 mm 안이면서 ±12 mm 밖 칸의 게이트 A 최대 중앙값 */
function beamBackgrounds(L: Loaded, gi: number, uMm: number): Array<number | null> {
  const g = L.groups[gi]!
  const cs = L.cscans[gi]!
  const axis = g.scan
  const k0 = scanIndexAt(uMm - HALF_SEARCH_MM, axis)
  const k1 = scanIndexAt(uMm + HALF_SEARCH_MM, axis)
  const c0 = scanIndexAt(uMm - HALF_CSCAN_MM, axis)
  const c1 = scanIndexAt(uMm + HALF_CSCAN_MM, axis)
  const out: Array<number | null> = []
  for (let b = 0; b < cs.beamCount; b++) {
    const xs: number[] = []
    for (let k = c0; k <= c1; k++) {
      if (k >= k0 && k <= k1) continue
      const p = cellPct(cs, g, k, b)
      if (p !== null) xs.push(p)
    }
    out.push(median(xs))
  }
  return out
}

/** 칸 (k, b) 의 바탕 대비 정보 */
function contrastPoint(L: Loaded, gi: number, k: number, b: number, bg: Array<number | null>): ContrastPoint | null {
  const p = pointInfo(L, gi, k, b)
  const base = bg[b]
  if (!p || base === null || base === undefined || !(base > 0) || !(p.pct > 0)) return null
  return { ...p, backgroundPct: base, contrastDb: 20 * Math.log10(p.pct / base) }
}

/** 스캔 칸 k 에서 바탕 대비가 가장 큰 빔 */
function bestContrastAt(L: Loaded, gi: number, k: number, bg: Array<number | null>): ContrastPoint | null {
  let best: ContrastPoint | null = null
  for (let b = 0; b < L.groups[gi]!.shape[1]; b++) {
    const c = contrastPoint(L, gi, k, b, bg)
    if (c && (!best || c.contrastDb > best.contrastDb)) best = c
  }
  return best
}

function groupStats(L: Loaded, uMm: number, chosenK: number): GroupStat[] {
  const axis = L.groups[0]!.scan
  const k0 = scanIndexAt(uMm - HALF_SEARCH_MM, axis)
  const k1 = scanIndexAt(uMm + HALF_SEARCH_MM, axis)
  return L.groups.map((g, gi) => {
    const cs = L.cscans[gi]!
    const backgrounds = beamBackgrounds(L, gi, uMm)
    let wp: { k: number; beam: number; pct: number } | null = null
    for (let k = k0; k <= k1; k++) {
      const bb = bestBeamAt(cs, g, k)
      if (bb && (!wp || bb.pct > wp.pct || (bb.pct === wp.pct && Math.abs(k - (k0 + k1) / 2) < Math.abs(wp.k - (k0 + k1) / 2)))) {
        wp = { k, beam: bb.beam, pct: bb.pct }
      }
    }
    const windowPeak = wp ? pointInfo(L, gi, wp.k, wp.beam) : null
    const shown = bestBeamAt(cs, g, chosenK)
    const atShown = shown ? pointInfo(L, gi, chosenK, shown.beam) : null
    const wc = wp ? contrastPoint(L, gi, wp.k, wp.beam, backgrounds) : null
    let contrastPeak: ContrastPoint | null = null
    for (let k = k0; k <= k1; k++) {
      const c = bestContrastAt(L, gi, k, backgrounds)
      if (c && (!contrastPeak || c.contrastDb > contrastPeak.contrastDb)) contrastPeak = c
    }
    return {
      groupId: g.id,
      name: g.name,
      windowPeak,
      atShown,
      beamBackgroundPct: wc?.backgroundPct ?? null,
      contrastDb: wc?.contrastDb ?? null,
      contrastPeak,
      backgrounds
    }
  })
}

/** 보조 그림을 만드는 기준: 고른 칸(게이트 A 최대)의 바탕 대비가 이보다 작으면 띠에 끌린 것으로 보고 보조 그림을 더한다 */
const SUPPLEMENT_BELOW_DB = 12

/**
 * 평가 기준(Ref −14 dB)의 %FSH 추정 — 대조 전.
 * 가정: 기준 이득(referenceGain)에서 대비 반사체가 referenceAmplitude(80 %)였고, 파일 이득과의 차만큼 커졌다.
 * X3 는 gain 24.7, referenceGain 18.7, referenceAmplitude 80 → Ref ≈ 160 %FSH, Ref −14 dB ≈ 32 %FSH.
 */
function evalLevelEstimate(g: ViewerGroup): { refPct: number; evalPct: number } | null {
  if (g.gainDb === null || !g.referenceGainDb || g.referenceAmplitudePct === null) return null
  const refPct = g.referenceAmplitudePct * 10 ** ((g.gainDb - g.referenceGainDb) / 20)
  return { refPct, evalPct: refPct * 10 ** (-14 / 20) }
}

// ───────────────────────────── 그리기 ─────────────────────────────

const M = 12 // 바깥 여백
const AXL = 40 // 왼쪽 눈금 자리
const AXB = 18 // 아래 눈금 자리
const LABEL_H = 14 // 패널 제목 줄

/** 두 그룹 S-scan 이 함께 쓰는 화면 범위 (mm, 1 mm 단위로 바깥으로 맞춤) */
function commonViewport(groups: ViewerGroup[]): SscanViewport {
  let vMin = Infinity
  let vMax = -Infinity
  let dMax = -Infinity
  for (const g of groups) {
    const e = sscanExtent(g)
    vMin = Math.min(vMin, e.vMinMm)
    vMax = Math.max(vMax, e.vMaxMm)
    dMax = Math.max(dMax, e.depthMaxMm)
  }
  const v0 = Math.floor(vMin - 1)
  const v1 = Math.ceil(vMax + 1)
  const d1 = Math.ceil(dMax + 1)
  return { vMinMm: v0, vMaxMm: v1, depthMinMm: 0, depthMaxMm: d1, width: (v1 - v0) * S_PX_PER_MM, height: d1 * S_PX_PER_MM }
}

function fmt(n: number, d = 0): string {
  const r = n.toFixed(d)
  return /^-0(\.0+)?$/.test(r) ? r.slice(1) : r
}

function skewLabel(g: ViewerGroup): string {
  const s = g.beams[0]?.skewDeg
  return s === undefined ? g.name : `SKEW ${Math.round(s)}`
}

/** S-scan 한 그룹 (펼친 깊이) + 덮개 + 눈금. 왼쪽 위 = (x, y) */
function drawSscanPanel(c: Canvas, x: number, y: number, L: Loaded, gi: number, k: number, vp: SscanViewport, mark: PointInfo | null): void {
  const g = L.groups[gi]!
  const chunk = L.chunks[gi]!
  const [, nb, nt] = g.shape
  const img = blank(vp.width, vp.height)
  const map = buildSscanMap(g, vp)
  renderSscan({
    map,
    amplitude: chunk.amplitude,
    offset: k * nb * nt,
    status: chunk.status,
    statusOffset: k * nb,
    indexFactor: rawIndexFactor(g.ampScale),
    palette: paletteRgb(L.info.display.palette),
    noData: hexToRgb(L.info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080'),
    background: [...COLOR.panel, 255],
    out: img.data
  })
  const ox = x + AXL
  const oy = y + LABEL_H
  c.blit(img, ox, oy)
  const px = (v: number, d: number): [number, number] => {
    const p = viewportPixel(vp, v, d)
    return [ox + p.x, oy + p.y]
  }
  const t = L.info.specimen.thicknessMm
  // 스킵선 (두께의 배수)
  if (t && t > 0) {
    for (let n = 1; n * t < vp.depthMaxMm; n++) {
      const [x0, yy] = px(vp.vMinMm, n * t)
      const [x1] = px(vp.vMaxMm, n * t)
      c.line(x0, yy, x1, yy, COLOR.gray, { dash: [6, 4] })
    }
  }
  // 개선면·열영향부
  const w = weldOverlay(L.info.specimen.weld, t, vp.depthMaxMm)
  if (w) {
    for (const pl of w.bevel) c.polyline(pl.map(([v, d]) => px(v, d)), COLOR.bevel, { dash: [4, 3] })
    for (const pl of w.haz) c.polyline(pl.map(([v, d]) => px(v, d)), COLOR.bevel, { dash: [1, 4] })
  }
  // CL
  {
    const [cx, y0] = px(0, vp.depthMinMm)
    const [, y1] = px(0, vp.depthMaxMm)
    c.line(cx, y0, cx, y1, COLOR.green, { dash: [8, 4] })
  }
  // 게이트 A (TrueDepth 면 깊이 고정선)
  const gate = findGate(g, g.cscanGateId)!
  const gv = gateDisplayValues(gate, g)
  if (gv.geometry === 'TrueDepth') {
    for (const d of [gv.startMm, gv.startMm + gv.lengthMm]) {
      const [x0, yy] = px(vp.vMinMm, d)
      const [x1] = px(vp.vMaxMm, d)
      c.line(x0, yy, x1, yy, COLOR.red, { dash: [6, 4], thick: 2 })
    }
  }
  // 이 그룹 게이트 A 최대 빔 선과 그 점
  if (mark) {
    const beam = g.beams[mark.beam]!
    const a = samplePoint(beam, 0, g.ultrasound)
    const z = samplePoint(beam, g.ultrasound.count - 1, g.ultrasound)
    const [ax, ay] = px(a.vMm, a.depthMm)
    const [zx, zy] = px(z.vMm, z.depthMm)
    c.line(ax, ay, zx, zy, COLOR.magenta, { dash: [3, 5] })
    const [mx, my] = px(mark.vMm, mark.unfoldedDepthMm)
    c.cross(mx, my, 12, COLOR.magenta, 2)
  }
  c.strokeRect(ox - 1, oy - 1, vp.width + 2, vp.height + 2, COLOR.gray)
  // 눈금: V 10 mm, 깊이 6 mm (숫자는 12 mm 마다)
  for (let v = Math.ceil(vp.vMinMm / 10) * 10; v <= vp.vMaxMm; v += 10) {
    const [tx] = px(v, 0)
    c.line(tx, oy + vp.height + 1, tx, oy + vp.height + 4, COLOR.dim)
    const s = `${v}`
    c.text(tx - textWidth(s) / 2, oy + vp.height + 7, s, COLOR.dim)
  }
  for (let d = 0; d <= vp.depthMaxMm; d += 6) {
    const [, ty] = px(vp.vMinMm, d)
    c.line(ox - 4, ty, ox - 1, ty, COLOR.dim)
    if (d % 12 === 0) {
      const s = `${d}`
      c.text(ox - 6 - textWidth(s), ty - 3, s, COLOR.dim)
    }
  }
  c.text(x, oy + vp.height + 7, 'V MM', COLOR.dim)
  // 제목 줄
  const head = `${skewLabel(g)} (G${g.id})  U=${fmt(scanPositionMm(k, g.scan))} MM`
  c.text(ox, y + 2, head, COLOR.text)
  if (mark) {
    const right = `MAX ${fmt(mark.pct, 1)}%${mark.saturated ? ' SAT' : ''} @${fmt(mark.angleDeg)}° D=${fmt(mark.depthMm, 1)} L${mark.leg ?? '-'} V=${fmt(mark.vMm, 1)}`
    c.text(ox + vp.width - textWidth(right), y + 2, right, COLOR.magenta)
  }
}

/** S-scan 패널 크기 */
function sscanPanelSize(vp: SscanViewport): { w: number; h: number } {
  return { w: AXL + vp.width + 2, h: LABEL_H + vp.height + AXB + 2 }
}

interface CscanMarks {
  /** 화면에 보이는 스캔 칸 범위 (자르기 전, 실수 가능) */
  kA: number
  kB: number
  docxK: number | null
  shownK: number | null
  window: [number, number] | null
  peakBeam: number | null
  /** 번호 붙인 표시 (개요 그림) */
  tags?: Array<{ k: number; label: string }>
  tickEvery: number
  labelEvery: number
}

/** C-scan 한 그룹 + 표시 + 눈금. 왼쪽 위 = (x, y). 화면 범위가 스캔 밖이면 어두운 회색 */
function drawCscanPanel(c: Canvas, x: number, y: number, L: Loaded, gi: number, pxPerScan: number, pxPerBeam: number, m: CscanMarks, title: string): { w: number; h: number } {
  const g = L.groups[gi]!
  const cs = L.cscans[gi]!
  const nb = g.shape[1]
  const ns = g.shape[0]
  const totalW = Math.round((m.kB - m.kA + 1) * pxPerScan)
  const h = nb * pxPerBeam
  const ox = x + AXL
  const oy = y + LABEL_H
  c.fillRect(ox, oy, totalW, h, COLOR.noRange)
  const from = Math.max(0, Math.ceil(m.kA))
  const to = Math.min(ns - 1, Math.floor(m.kB))
  if (to >= from) {
    const w = (to - from + 1) * pxPerScan
    const img = blank(w, h)
    renderCscan({
      cscan: cs,
      scanFrom: from,
      scanTo: to + 1,
      width: w,
      height: h,
      reversed: L.info.display.cscanReversed,
      indexFactor: rawIndexFactor(g.ampScale),
      palette: paletteRgb(L.info.display.palette),
      noData: hexToRgb(L.info.display.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080'),
      out: img.data
    })
    c.blit(img, Math.round(ox + (from - m.kA) * pxPerScan), oy)
  }
  /** 칸 k(실수) 가운데의 x */
  const xk = (k: number): number => ox + (k - m.kA + 0.5) * pxPerScan
  if (m.window) {
    for (const xe of [xk(m.window[0] - 0.5), xk(m.window[1] + 0.5)]) c.line(xe, oy, xe, oy + h - 1, COLOR.black, { dash: [2, 3] })
  }
  if (m.docxK !== null) c.line(xk(m.docxK), oy, xk(m.docxK), oy + h - 1, COLOR.black, { dash: [5, 5], alt: COLOR.white, thick: 2 })
  for (const tag of m.tags ?? []) {
    c.line(xk(tag.k), oy, xk(tag.k), oy + h - 1, COLOR.black, { dash: [5, 5], alt: COLOR.white })
    c.triangleDown(xk(tag.k), oy - 1, 4, COLOR.text)
  }
  if (m.shownK !== null) c.line(xk(m.shownK), oy, xk(m.shownK), oy + h - 1, COLOR.magenta, { thick: 2 })
  if (m.peakBeam !== null) {
    const yb = oy + cscanYForBeam(m.peakBeam, h, nb, L.info.display.cscanReversed)
    c.triangleRight(ox - 2, yb, 5, COLOR.magenta)
    c.triangleRight(ox + totalW + 7, yb, 5, COLOR.magenta)
  }
  c.strokeRect(ox - 1, oy - 1, totalW + 2, h + 2, COLOR.gray)
  // 각도 눈금 (위·아래 끝 빔)
  const rev = L.info.display.cscanReversed
  const topB = rev ? nb - 1 : 0
  const botB = rev ? 0 : nb - 1
  const topS = `${fmt(g.beams[topB]!.angleDeg)}°`
  const botS = `${fmt(g.beams[botB]!.angleDeg)}°`
  c.text(ox - 6 - textWidth(topS), oy, topS, COLOR.dim)
  c.text(ox - 6 - textWidth(botS), oy + h - 7, botS, COLOR.dim)
  // 스캔 눈금
  const axis = g.scan
  const uA = scanPositionMm(m.kA, axis)
  const uB = scanPositionMm(m.kB, axis)
  for (let u = Math.ceil(uA / m.tickEvery) * m.tickEvery; u <= uB; u += m.tickEvery) {
    const kf = (u - axis.offsetMm) / axis.resolutionMm
    const tx = xk(kf)
    c.line(tx, oy + h + 1, tx, oy + h + 4, COLOR.dim)
    if (u % m.labelEvery === 0) {
      const s = `${u}`
      c.text(tx - textWidth(s) / 2, oy + h + 7, s, COLOR.dim)
    }
  }
  c.text(x, oy + h + 7, 'U MM', COLOR.dim)
  for (const tag of m.tags ?? []) c.text(xk(tag.k) + 5, oy - 11, tag.label, COLOR.text)
  c.text(ox, y + 2 - (m.tags ? 10 : 0), title, COLOR.text)
  return { w: AXL + totalW + 14, h: LABEL_H + h + AXB + 2 }
}

const LEGEND = [
  'MAGENTA: SHOWN SCAN U / MARKED BEAM / ITS GATE A PEAK POINT.  BLACK-WHITE DASH: DOCX U.  BLACK DOTS: DOCX +-12 MM.',
  'RED DASH: GATE A (DEPTH).  GREEN DASH: WELD CL (V=0).  GRAY DASH: SKIP LINES (T, 2T, 3T).  DARK DASH: BEVEL, DOTS: HAZ.  D = TRUE DEPTH, L = LEG.',
  'EXAMPLE FROM DOCX POSITION ONLY. GATE A MAX MAY BE A GEOMETRIC ECHO. DEFECT BOUNDARIES ARE NOT EXPERT-CONFIRMED.'
]

interface FigureView {
  k: number
  window: [number, number]
  /** 그룹마다 S-scan 십자·C-scan 빔 표시 */
  marks: Array<PointInfo | null>
  /** 제목 둘째 줄 */
  how: string
  supplement: boolean
}

function drawFigure(no: number, e: DocxEntry, L: Loaded, view: FigureView, stats: GroupStat[], vp: SscanViewport): Canvas {
  const sp = sscanPanelSize(vp)
  const axis = L.groups[0]!.scan
  const kDocx = (e.uMm - axis.offsetMm) / axis.resolutionMm
  const kA = kDocx - HALF_CSCAN_MM / axis.resolutionMm
  const kB = kDocx + HALF_CSCAN_MM / axis.resolutionMm
  const cW = AXL + Math.round((kB - kA + 1) * C_PX_PER_SCAN) + 14
  const cH = LABEL_H + L.groups[0]!.shape[1] * C_PX_PER_BEAM + AXB + 2
  const width = M * 2 + Math.max(sp.w * L.groups.length + 16 * (L.groups.length - 1), cW)
  const titleH = 50
  const legendH = LEGEND.length * 11 + 6
  const height = M + titleH + sp.h + 10 + (cH + 8) * L.groups.length + legendH + M
  const c = new Canvas(width, height)
  // 제목
  const fileName = basename(e.file, '.nde').toUpperCase()
  const tag = `#${String(no).padStart(2, '0')}${view.supplement ? 'B' : ''}`
  c.text(M, M, `${tag}  ${fileName}  DOCX U=${e.uMm} MM  ${e.docxType.toUpperCase()}${view.supplement ? '  (SUPPLEMENT)' : ''}`, COLOR.text, 2)
  c.text(M, M + 22, view.how, COLOR.dim)
  c.text(M, M + 34, 'EXAMPLE FROM DOCX POSITION - NOT EXPERT-CONFIRMED', COLOR.magenta)
  // S-scan 두 그룹
  let x = M
  const yS = M + titleH
  L.groups.forEach((_, gi) => {
    drawSscanPanel(c, x, yS, L, gi, view.k, vp, view.marks[gi] ?? null)
    x += sp.w + 16
  })
  // C-scan 두 그룹
  let y = yS + sp.h + 10
  L.groups.forEach((g, gi) => {
    const st = stats[gi]!
    const wp = st.windowPeak
    const title = `C-SCAN ${skewLabel(g)} (G${g.id})${wp ? `  WINDOW MAX ${fmt(wp.pct, 1)}%${wp.saturated ? ' SAT' : ''} AT U=${fmt(wp.scanMm)} ${fmt(wp.angleDeg)}°, BEAM BACKGROUND ${st.beamBackgroundPct === null ? '-' : fmt(st.beamBackgroundPct, 1)}% (${st.contrastDb === null ? '-' : fmt(st.contrastDb, 1)} DB)` : ''}`
    drawCscanPanel(
      c,
      M,
      y,
      L,
      gi,
      C_PX_PER_SCAN,
      C_PX_PER_BEAM,
      { kA, kB, docxK: kDocx, shownK: view.k, window: view.window, peakBeam: view.marks[gi]?.beam ?? null, tickEvery: 5, labelEvery: 10 },
      title
    )
    y += cH + 8
  })
  LEGEND.forEach((s, i) => c.text(M, y + i * 11, s, COLOR.dim))
  return c
}

/** 기본 그림: 게이트 A 최대 칸 */
function gateMaxView(L: Loaded, pick: ScanPick, stats: GroupStat[]): FigureView {
  const g = L.groups[pick.groupIndex]!
  return {
    k: pick.k,
    window: pick.window,
    marks: stats.map((s) => s.atShown),
    how: `SHOWN U=${fmt(pick.scanMm)} MM: GATE A MAX ${fmt(pick.pct, 1)}% IN DOCX +-${HALF_SEARCH_MM} MM (${skewLabel(g)} ${fmt(g.beams[pick.beam]!.angleDeg)}°). C-SCAN: DOCX +-${HALF_CSCAN_MM} MM, GATE A.`,
    supplement: false
  }
}

/**
 * 보조 그림: 바탕 대비가 가장 큰 칸 (두 그룹 중 더 큰 쪽). 표시는 그 그룹에만 한다
 * (다른 그룹을 바탕 대비로 고르면 바탕이 거의 0 인 빔의 아주 작은 응답이 뽑혀 오해를 부른다).
 */
function contrastView(L: Loaded, pick: ScanPick, stats: GroupStat[]): FigureView | null {
  let gi = -1
  stats.forEach((s, i) => {
    if (s.contrastPeak && (gi < 0 || s.contrastPeak.contrastDb > stats[gi]!.contrastPeak!.contrastDb)) gi = i
  })
  if (gi < 0) return null
  const cp = stats[gi]!.contrastPeak!
  const k = scanIndexAt(cp.scanMm, L.groups[gi]!.scan)
  const marks = stats.map((_, i) => (i === gi ? cp : null))
  return {
    k,
    window: pick.window,
    marks,
    how: `SUPPLEMENT: GATE A MAX WAS ON A CONTINUOUS BAND. SHOWN U=${fmt(cp.scanMm)} MM = HIGHEST ${fmt(cp.contrastDb, 1)} DB OVER SAME-BEAM BACKGROUND (${skewLabel(L.groups[gi]!)} ${fmt(cp.angleDeg)}°, ${fmt(cp.pct, 1)}%).`,
    supplement: true
  }
}

function drawOverview(L: Loaded, fileName: string, entries: Array<{ no: number; e: DocxEntry }>): Canvas {
  const g0 = L.groups[0]!
  const ns = g0.shape[0]
  const panelW = AXL + ns * O_PX_PER_SCAN + 14
  const panelH = LABEL_H + 10 + g0.shape[1] * O_PX_PER_BEAM + AXB + 2
  const width = M * 2 + panelW
  const height = M + 40 + (panelH + 10) * L.groups.length + 30 + M
  const c = new Canvas(width, height)
  c.text(M, M, `${basename(fileName, '.nde').toUpperCase()}  FULL C-SCAN (GATE A, FILE GAIN)`, COLOR.text, 2)
  c.text(M, M + 22, 'TRIANGLE + DASH = DOCX POSITION (#NO). CONTINUOUS BANDS ALONG U ARE USUALLY ROOT/CAP GEOMETRY ECHOES.', COLOR.dim)
  let y = M + 50
  L.groups.forEach((g, gi) => {
    const axis = g.scan
    const tags = entries.map(({ no, e }) => ({ k: (e.uMm - axis.offsetMm) / axis.resolutionMm, label: `#${String(no).padStart(2, '0')}` }))
    drawCscanPanel(
      c,
      M,
      y + 10,
      L,
      gi,
      O_PX_PER_SCAN,
      O_PX_PER_BEAM,
      { kA: 0, kB: g.shape[0] - 1, docxK: null, shownK: null, window: null, peakBeam: null, tags, tickEvery: 10, labelEvery: 50 },
      `${skewLabel(g)} (G${g.id})`
    )
    y += panelH + 10
  })
  c.text(M, y + 4, 'EXAMPLE FROM DOCX POSITION - NOT EXPERT-CONFIRMED', COLOR.magenta)
  return c
}

// ───────────────────────────── 테스트 ─────────────────────────────

describe('지침서 예시 그림 목록', () => {
  it('docx 11건, 파일 4개, 파일 이름이 X3 폴더 파일과 같다', () => {
    expect(DOCX_ENTRIES).toHaveLength(11)
    const files = [...new Set(DOCX_ENTRIES.map((e) => e.file))]
    expect(files).toEqual(X3_FILES.map((p) => basename(p)))
    const names = DOCX_ENTRIES.map((e, i) => figureName(i + 1, e))
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toBe('01_12T-SV-01_038mm_ToeCrack.png')
    expect(names[7]).toBe('08_12T-SV-03_150mm_IP.png')
  })
})

const HAS_DATA = X3_FILES.every((p) => existsSync(p))

describe.skipIf(!OUT || !HAS_DATA)('지침서 예시 그림 만들기 (PAUT_GUIDE_FIGS)', () => {
  it('11건 그림 + 파일별 개요 + 그림_목록.json', async () => {
    const dir = OUT!
    mkdirSync(dir, { recursive: true })
    const summary: unknown[] = []
    let no = 0
    for (const path of X3_FILES) {
      const file = basename(path)
      const L = await loadFile(resolve(X3_DIR, file))
      expect(L.groups.length, `${file} 그룹 수`).toBe(2)
      const vp = commonViewport(L.groups)
      const entries: Array<{ no: number; e: DocxEntry }> = []
      for (const e of DOCX_ENTRIES.filter((x) => x.file === file)) {
        no++
        entries.push({ no, e })
        const pick = pickScan(L, e.uMm)
        expect(Math.abs(pick.scanMm - e.uMm)).toBeLessThanOrEqual(HALF_SEARCH_MM)
        const stats = groupStats(L, e.uMm, pick.k)
        const name = figureName(no, e)
        writePng(resolve(dir, name), drawFigure(no, e, L, gateMaxView(L, pick, stats), stats, vp))
        // 게이트 A 최대가 이어진 띠(바탕 대비 작음)에 있으면 바탕 대비가 가장 큰 칸으로 보조 그림을 더한다
        const pickContrast = stats[pick.groupIndex]!.contrastDb
        let supplement: string | null = null
        if (pickContrast !== null && pickContrast < SUPPLEMENT_BELOW_DB) {
          const cv = contrastView(L, pick, stats)
          if (cv) {
            supplement = name.replace(/\.png$/, '_보조.png')
            writePng(resolve(dir, supplement), drawFigure(no, e, L, cv, stats, vp))
          }
        }
        const ev = evalLevelEstimate(L.groups[0]!)
        summary.push({
          no,
          figure: name,
          supplement,
          file,
          docxUMm: e.uMm,
          docxType: e.docxType,
          ko: e.ko,
          shown: { scanMm: pick.scanMm, group: L.groups[pick.groupIndex]!.name, angleDeg: L.groups[pick.groupIndex]!.beams[pick.beam]!.angleDeg, pct: +pick.pct.toFixed(2) },
          groups: stats.map((s) => ({
            group: s.name,
            windowPeak: s.windowPeak && roundPoint(s.windowPeak),
            atShown: s.atShown && roundPoint(s.atShown),
            beamBackgroundPct: s.beamBackgroundPct === null ? null : +s.beamBackgroundPct.toFixed(2),
            contrastDb: s.contrastDb === null ? null : +s.contrastDb.toFixed(1),
            contrastPeak: s.contrastPeak && {
              ...roundPoint(s.contrastPeak),
              backgroundPct: +s.contrastPeak.backgroundPct.toFixed(2),
              contrastDb: +s.contrastPeak.contrastDb.toFixed(1)
            },
            atShownContrastDb: (() => {
              const c = s.atShown ? s.backgrounds[s.atShown.beam] : null
              return s.atShown && c ? +(20 * Math.log10(s.atShown.pct / c)).toFixed(1) : null
            })()
          })),
          evalLevelEstimatePct: ev ? +ev.evalPct.toFixed(1) : null
        })
        console.log(
          `${name}: U ${pick.scanMm} mm · ` +
            stats
              .map((s) => `${s.name} ${s.windowPeak ? `${s.windowPeak.pct.toFixed(1)}%@${s.windowPeak.scanMm}mm ${s.windowPeak.angleDeg}° d${s.windowPeak.depthMm.toFixed(1)} L${s.windowPeak.leg} V${s.windowPeak.vMm.toFixed(1)} 바탕 ${s.beamBackgroundPct?.toFixed(1)}% ${s.contrastDb?.toFixed(1)} dB` : '-'}`)
              .join(' | ')
        )
      }
      writePng(resolve(dir, `00_개요_${basename(file, '.nde').replace(/-Cap (on|off)$/i, '')}.png`), drawOverview(L, file, entries))
    }
    const info0 = await readViewerInfo(X3_FILES[0]!)
    const g = info0.groups[0]!
    const ev = evalLevelEstimate(g)
    // 그룹마다 이득이 다르다(Skew 90 24.7/18.7, Skew 270 20.4/14.4 dB) — 둘 다 적는다
    const groupSetups = info0.groups.map((gr) => {
      const e = evalLevelEstimate(gr)
      return {
        group: gr.name,
        gainDb: gr.gainDb,
        referenceGainDb: gr.referenceGainDb,
        referenceAmplitudePct: gr.referenceAmplitudePct,
        refPctEstimate: e ? +e.refPct.toFixed(1) : null,
        evalLevelEstimatePct: e ? +e.evalPct.toFixed(1) : null
      }
    })
    writeFileSync(
      resolve(dir, '그림_목록.json'),
      JSON.stringify(
        {
          note: '결함정보 docx 위치 기준 예시. 기본 그림 = docx ±12 mm 안 게이트 A 최대(두 그룹·모든 빔). _보조 그림 = 게이트 A 최대의 같은 빔 바탕 대비가 12 dB 미만일 때, 바탕 대비가 가장 큰 칸. 경계·종류는 전문가 확인 전. 평가 기준 %FSH 는 추정(대조 전).',
          made: 'app/tests/labels/guideFigures.test.ts',
          gate: 'Gate A (파일 값, TrueDepth)',
          setupNote: '아래 gainDb~evalLevelEstimatePct 는 첫 그룹(Skew 90) 값. 그룹별 값은 groupSetups',
          groupSetups,
          gainDb: g.gainDb,
          referenceGainDb: g.referenceGainDb,
          referenceAmplitudePct: g.referenceAmplitudePct,
          refPctEstimate: ev ? +ev.refPct.toFixed(1) : null,
          evalLevelEstimatePct: ev ? +ev.evalPct.toFixed(1) : null,
          thicknessMm: info0.specimen.thicknessMm,
          items: summary
        },
        null,
        2
      ) + '\n'
    )
    expect(no).toBe(DOCX_ENTRIES.length)
  })
})

function roundPoint(p: PointInfo): Record<string, number | boolean | null> {
  return {
    scanMm: p.scanMm,
    angleDeg: p.angleDeg,
    pct: +p.pct.toFixed(2),
    saturated: p.saturated,
    depthMm: +p.depthMm.toFixed(2),
    leg: p.leg,
    vMm: +p.vMm.toFixed(2),
    unfoldedDepthMm: +p.unfoldedDepthMm.toFixed(2)
  }
}
