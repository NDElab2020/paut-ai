/**
 * 학습용 S-scan 그림 (펼친 S-scan, 고정 mm/px, 고정 내장 색표, 소프트 이득 0 dB) · 가림 그림 · COCO · YOLO.
 *
 * 그림 좌표: 가로 = V (mm, 용접 중심 0, 왼쪽이 작은 값 — 스큐와 무관하게 파일 V 그대로), 세로 = 펼친 깊이 (mm, 위가 0).
 *   화소 (x, y) 의 중심 = (vMinMm + (x + 0.5)·mmPerPx, depthMinMm + (y + 0.5)·mmPerPx). 범위는 mmPerPx 의 배수로 맞춘다.
 *   깊이 범위 = 0 ~ min(부채꼴 끝, 다루는 레그(rules.maxLeg) × 두께). 그 안의 레그가 모두 그려진다(레그 범위).
 * 칠하기는 이미지 보기와 같은 S-scan 규칙(shared/imaging/sscan.ts buildSscanMap·renderSscan)과
 *   내장 색표(DEFAULT_AMPLITUDE_PALETTE, OmniScan X3 MainColors)를 쓴다. 파일 색표는 쓰지 않는다(파일마다 같은 색).
 *   부채꼴 밖·데이터 없음 = 회색 808080. 그림(images/)은 가리지 않은 원본이다.
 *
 * 장면 고르기 (학습 상태 trainState·trainStatus 기준, 규격 3.1):
 *   - 품질 불량·데이터 없음·기준 미만 지시 구간 장면은 내지 않는다(장면 전체가 무시).
 *   - 검토하지 않은 장면은 결함 양성 상자가 있을 때만 낸다(coco 에 reviewed = false, YOLO 목록에는 넣지 않음 — 상자 밖이 음성이라는 보장이 없음).
 *   - 가림 (가림 그림 masks/ — 0 = 그대로, 1 = 검토 게이트 밖, 2 = 라벨 가림):
 *     라벨 가림 = 학습 상태가 무시인 객체(끝 여유·약함 레그·약한 양성(weakAs = ignore)·불확실 …)의 탐색 창 칸 +
 *       결함 양성 객체의 탐색 창에서 덩어리(상자 칸) 밖 칸 (A-scan ascanLabelAt 과 같은 규칙 — 결함 에코의 꼬리를 배경으로 두지 않게).
 *     검토 게이트 밖 = 검토한 장면의 negativeRegion(펼친 깊이·레그) 밖 — 음성은 게이트 안에서만 성립한다.
 *     양성 상자의 칸 덩어리는 가리지 않는다.
 *     maskMode 'blackout' = 학습(train) 분할에만 검게 칠한 판(masked/images/)을 더 낸다(YOLO 는 무시 구역이 없음 — yolo_train.txt 가 그 판을 가리킴).
 *       val·test 는 늘 가리지 않은 그림(평가 입력에 라벨 정보가 새지 않게). 'separate' = 검게 칠한 판을 내지 않음.
 *       'exclude' = 평가 기준 이상 신호가 있는 무시 객체('안 보임' 레그는 셈하지 않음)가 있는 장면을 그림에서 뺀다.
 *     COCO 에는 무시 객체 창을 무시 영역(iscrowd = 1, attributes.ignore = true)으로 넣는다.
 * 상자: 학습 상태가 양성인 객체의 장면 상자(절대 문턱 칸 덩어리). 결함 = 분류 0(COCO 1), 형상 에코 = 분류 1(COCO 2).
 *   화소 상자 = 가장 가까운 칸이 그 덩어리에 드는 화소를 모두 감싸는 사각형(그림은 칸 사이를 보간해 칠하므로 칸 중심보다 넓다),
 *   최소 MIN_BOX_PX 화소. mm 값은 attributes 에 그대로. 규칙이 바뀌면 TRAIN_IMAGE_RULES_VERSION 을 올린다.
 */
import { DEFAULT_AMPLITUDE_PALETTE, EXPORT_OUTSIDE_SPECIAL_INDEX, DEFAULT_SPECIAL_COLORS, hexToRgb, paletteRgb, rawIndexFactor } from '@shared/imaging/palette'
import { buildSscanMap, renderSscan, type SscanMap, type SscanViewport } from '@shared/imaging/sscan'
import { sscanExtent } from '@shared/imaging/coords'
import type { ViewerGroup, ViewerVolumeChunk } from '@shared/imaging/types'
import { componentKey, type DeriveRun, type SceneLabel, type SceneObject } from '@shared/labels/derive'
import type { GroupCellGeometry } from '@shared/labels/derive/geometry'

export const IMAGE_PALETTE_NAME = 'OmniScan X3 MainColors 256 (앱 내장, 파일 색표 아님)'
/**
 * 그림 바깥(데이터 없음) 색 = 808080. 뷰어의 데이터 없음 색(VIEWER_NO_DATA_SPECIAL_INDEX)과 따로 고정한다(X11 ①):
 * 뷰어 색을 검정으로 바꿔도 이 값이 MASK_RGB(검정)와 섞이지 않게. 바꾸려면 TRAIN_IMAGE_RULES_VERSION 을 올린다.
 */
export const OUTSIDE_RGB: readonly [number, number, number] = hexToRgb(DEFAULT_SPECIAL_COLORS[EXPORT_OUTSIDE_SPECIAL_INDEX]!)
export const MASK_RGB: readonly [number, number, number] = [0, 0, 0]

/**
 * 그림·상자·가림 규칙 버전 (manifest versions.imageRules). 1 = 칸 중심 상자·무시 창만 가림·그림에 검게 박음,
 * 2 = 화소 덩어리 상자(최소 3 px)·결함 창의 덩어리 밖도 가림·원본 그림 + 가림 그림·train 만 검게 칠한 판·COCO 무시 영역
 */
export const TRAIN_IMAGE_RULES_VERSION = 2

/** 화소 상자 최소 한 변 (px) — 2 px 이하 상자는 학습 증강(box_candidates)에서 버려진다 */
export const MIN_BOX_PX = 3

/** 가림 그림 값 */
export const MASK_VALUE = { keep: 0, gate: 1, label: 2 } as const

/** 분류 (YOLO 번호 = id, COCO category_id = id + 1) */
export const TRAIN_CLASSES = [
  { id: 0, name: 'defect', ko: '결함' },
  { id: 1, name: 'geometric-echo', ko: '형상 에코 (결함 아님)' }
] as const

export interface ImageViewport extends SscanViewport {
  mmPerPx: number
  /** 화소 단위 원점: vMinMm = x0 · mmPerPx */
  x0: number
  /** 그린 레그 (1 ~ 이 값) */
  maxLeg: number
}

function r4(x: number): number {
  return Math.round(x * 1e4) / 1e4
}

/** 그룹의 그림 범위 (mmPerPx 배수로 맞춤) */
export function imageViewport(group: Pick<ViewerGroup, 'beams' | 'ultrasound'>, geom: GroupCellGeometry, mmPerPx: number): ImageViewport {
  const ext = sscanExtent(group)
  const t = geom.thicknessMm
  const maxLeg = Math.max(1, ...geom.legs)
  const depthMax = Math.min(ext.depthMaxMm, maxLeg * t)
  const x0 = Math.floor(ext.vMinMm / mmPerPx + 1e-9)
  const x1 = Math.ceil(ext.vMaxMm / mmPerPx - 1e-9)
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, Math.ceil(depthMax / mmPerPx - 1e-9))
  return { vMinMm: x0 * mmPerPx, vMaxMm: x1 * mmPerPx, depthMinMm: 0, depthMaxMm: height * mmPerPx, width, height, mmPerPx, x0, maxLeg }
}

/** 그룹 하나의 그림 준비물 (조회표·화소별 가장 가까운 칸·깊이) */
export interface GroupImageKit {
  group: ViewerGroup
  geom: GroupCellGeometry
  vp: ImageViewport
  map: SscanMap
  /** 화소 → 가장 가까운 칸 (빔·샘플), 부채꼴 밖 -1 */
  cellOf: Int32Array
  /** 칸마다 그 칸이 가장 가까운 칸인 화소들의 상자 (cellPixelBoxes — 상자 계산을 칸 수에 비례하게) */
  cellBox: CellPixelBoxes
  palette: Uint8Array
  indexFactor: number
  /** 작업 배열 */
  rgba: Uint8Array
  rgb: Uint8Array
}

/** 칸마다 화소 상자 (x0 > x1 이면 그 칸에 든 화소 없음) */
export interface CellPixelBoxes {
  x0: Int32Array
  x1: Int32Array
  y0: Int32Array
  y1: Int32Array
}

/** cellOf(화소 → 칸) 로 칸별 화소 상자 표를 만든다 (그림 한 번 훑음) */
export function cellPixelBoxes(cellOf: Int32Array, width: number, cells: number): CellPixelBoxes {
  const b: CellPixelBoxes = {
    x0: new Int32Array(cells).fill(0x7fffffff),
    x1: new Int32Array(cells).fill(-1),
    y0: new Int32Array(cells).fill(0x7fffffff),
    y1: new Int32Array(cells).fill(-1)
  }
  for (let p = 0; p < cellOf.length; p++) {
    const c = cellOf[p]!
    if (c < 0 || c >= cells) continue
    const x = p % width
    const y = (p - x) / width
    if (x < b.x0[c]!) b.x0[c] = x
    if (x > b.x1[c]!) b.x1[c] = x
    if (y < b.y0[c]!) b.y0[c] = y
    if (y > b.y1[c]!) b.y1[c] = y
  }
  return b
}

export function groupImageKit(group: ViewerGroup, geom: GroupCellGeometry, mmPerPx: number): GroupImageKit {
  const vp = imageViewport(group, geom, mmPerPx)
  const map = buildSscanMap(group, vp)
  const n = vp.width * vp.height
  const nt = map.sampleCount
  const cellOf = new Int32Array(n).fill(-1)
  for (let p = 0; p < n; p++) {
    if (map.beam0[p]! < 0) continue
    const first = map.weight[p]! < 0.5
    const at = first ? map.at0[p]! : map.at1[p]!
    const fr = first ? map.frac0[p]! : map.frac1[p]!
    const b = first ? map.beam0[p]! : map.beam1[p]!
    const i = Math.min(nt - 1, at - b * nt + (fr >= 0.5 ? 1 : 0))
    cellOf[p] = b * nt + i
  }
  return {
    group,
    geom,
    vp,
    map,
    cellOf,
    cellBox: cellPixelBoxes(cellOf, vp.width, group.shape[1] * group.shape[2]),
    palette: paletteRgb(DEFAULT_AMPLITUDE_PALETTE),
    indexFactor: rawIndexFactor(group.ampScale),
    rgba: new Uint8Array(n * 4),
    rgb: new Uint8Array(n * 3)
  }
}

/** 장면을 그림으로 낼지와 그 이유 */
export type SceneImageDecision =
  | { use: true; positives: SceneObject[]; ignores: SceneObject[] }
  | { use: false; why: 'scene-ignore' | 'unreviewed' | 'excluded' }

export type MaskMode = 'blackout' | 'separate' | 'exclude'

/**
 * evaluationPct = 그 그룹 평가 기준 (%FSH). exclude 는 평가 기준 이상 신호가 있는 무시 객체만 센다 —
 * 같은 기록의 '안 보임' 레그 창 같은 빈 무시 객체로 양성 장면 대부분이 빠지지 않게.
 */
export function decideSceneImage(scene: SceneLabel, maskMode: MaskMode, evaluationPct: number | null = null): SceneImageDecision {
  if (scene.reasons.length > 0) return { use: false, why: 'scene-ignore' }
  const positives = scene.objects.filter((o) => o.trainStatus === 'positive' && o.box !== null)
  const ignores = scene.objects.filter((o) => o.trainStatus === 'ignore')
  if (!scene.reviewed && !positives.some((o) => o.policy === 'defect')) return { use: false, why: 'unreviewed' }
  if (maskMode === 'exclude') {
    const strong = ignores.filter((o) => o.reason !== 'not-visible' && (evaluationPct === null || (o.signalPct ?? 0) >= evaluationPct))
    if (strong.length > 0) return { use: false, why: 'excluded' }
  }
  return { use: true, positives, ignores }
}

export interface SceneImage {
  /** 가리지 않은 그림 (RGB) */
  rgb: Uint8Array
  /** 화소마다 가림 값 (MASK_VALUE) */
  mask: Uint8Array
  /** 가린 화소 수 (게이트 밖 + 라벨 가림) · 그중 라벨 가림 */
  maskedPx: number
  labelMaskedPx: number
}

/** 장면 하나의 그림(원본)과 가림 */
export function renderSceneImage(
  kit: GroupImageKit,
  run: DeriveRun,
  scene: SceneLabel,
  chunks: readonly ViewerVolumeChunk[],
  positives: readonly SceneObject[],
  ignores: readonly SceneObject[]
): SceneImage {
  const { group, geom, vp, map, cellOf, rgba, rgb } = kit
  const k = scene.scanIndex
  const [, nb, nt] = group.shape
  const chunk = chunks.find((c) => c.groupId === group.id && k >= c.scanStart && k < c.scanStart + c.scanCount)
  const n = vp.width * vp.height
  const mask = new Uint8Array(n)
  if (!chunk) {
    // 진폭이 없으면 모두 데이터 없음
    for (let p = 0; p < n; p++) rgb.set(OUTSIDE_RGB, p * 3)
    return { rgb, mask, maskedPx: 0, labelMaskedPx: 0 }
  }
  const j = k - chunk.scanStart
  renderSscan({
    map,
    amplitude: chunk.amplitude,
    offset: j * nb * nt,
    status: chunk.status,
    statusOffset: j * nb,
    indexFactor: kit.indexFactor,
    palette: kit.palette,
    noData: OUTSIDE_RGB,
    background: [OUTSIDE_RGB[0], OUTSIDE_RGB[1], OUTSIDE_RGB[2], 255],
    out: rgba
  })
  // 라벨 가림 칸: 무시 객체의 창 + 결함 양성 객체의 창 (덩어리 칸은 아래 keep 으로 풀어 줌)
  const masked = new Uint8Array(nb * nt)
  let anyMask = false
  const addWindow = (o: SceneObject): void => {
    const w = run.windows.get(o.windowId)
    if (!w) return
    for (let b = 0; b < nb; b++) {
      const lo = w.lo[b]!
      const hi = w.hi[b]!
      for (let i = Math.max(0, lo); i <= Math.min(nt - 1, hi); i++) masked[b * nt + i] = 1
      if (hi >= lo) anyMask = true
    }
  }
  for (const o of ignores) addWindow(o)
  for (const o of positives) if (o.policy === 'defect') addWindow(o)
  const keep = new Uint8Array(nb * nt)
  for (const o of positives) {
    const comp = run.components.get(componentKey(k, o.recordUuid, group.id, o.leg))
    if (comp) for (const c of comp.cells) keep[c] = 1
  }
  const region = scene.reviewed ? scene.negativeRegion : null
  const t = geom.thicknessMm
  let maskedPx = 0
  let labelMaskedPx = 0
  for (let p = 0; p < n; p++) {
    let m: number = MASK_VALUE.keep
    const c = cellOf[p]!
    if (c >= 0 && !keep[c]) {
      if (anyMask && masked[c]) m = MASK_VALUE.label
      else if (region) {
        const y = Math.floor(p / vp.width)
        const d = vp.depthMinMm + (y + 0.5) * vp.mmPerPx
        const leg = Math.floor(d / t) + 1
        if (d < region.depthTopMm || d > region.depthBottomMm || leg < region.legMin || leg > region.legMax) m = MASK_VALUE.gate
      }
    }
    mask[p] = m
    if (m !== MASK_VALUE.keep) {
      maskedPx++
      if (m === MASK_VALUE.label) labelMaskedPx++
    }
    const q = p * 3
    rgb[q] = rgba[p * 4]!
    rgb[q + 1] = rgba[p * 4 + 1]!
    rgb[q + 2] = rgba[p * 4 + 2]!
  }
  return { rgb, mask, maskedPx, labelMaskedPx }
}

/** 원본 그림에 가림을 검게 칠한 판 (새 배열) */
export function blackout(rgb: Uint8Array, mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgb)
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] === MASK_VALUE.keep) continue
    const q = p * 3
    out[q] = MASK_RGB[0]
    out[q + 1] = MASK_RGB[1]
    out[q + 2] = MASK_RGB[2]
  }
  return out
}

/**
 * 칸 묶음(빔 × 샘플 칸 번호) → 그 칸이 가장 가까운 칸인 화소를 감싸는 사각형 [x, y, w, h] (없으면 null).
 * 화소 집합 상자들의 합집합의 상자 = 합집합 화소의 상자이므로 칸별 상자 표(kit.cellBox)로 칸 수에 비례해 구한다
 * (예전: 객체마다 그림 전체 화소를 훑음 — 결과는 같다, tests/core/labels/exportEncode.test.ts).
 */
export function cellsPixelBox(kit: Pick<GroupImageKit, 'cellBox'>, cells: Iterable<number>): [number, number, number, number] | null {
  const b = kit.cellBox
  const n = b.x0.length
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const c of cells) {
    if (c < 0 || c >= n || b.x1[c]! < 0) continue
    if (b.x0[c]! < x0) x0 = b.x0[c]!
    if (b.x1[c]! > x1) x1 = b.x1[c]!
    if (b.y0[c]! < y0) y0 = b.y0[c]!
    if (b.y1[c]! > y1) y1 = b.y1[c]!
  }
  if (!Number.isFinite(x0)) return null
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1]
}

/** 최소 크기로 넓힌다 (가운데를 두고, 그림 안으로) */
function atLeast(vp: ImageViewport, px: [number, number, number, number], min = MIN_BOX_PX): [number, number, number, number] {
  let [x, y, w, h] = px
  if (w < min) {
    const cx = x + w / 2
    w = Math.min(min, vp.width)
    x = Math.max(0, Math.min(vp.width - w, Math.round(cx - w / 2)))
  }
  if (h < min) {
    const cy = y + h / 2
    h = Math.min(min, vp.height)
    y = Math.max(0, Math.min(vp.height - h, Math.round(cy - h / 2)))
  }
  return [x, y, w, h]
}

/**
 * 양성 객체의 화소 상자: 가장 가까운 칸이 그 장면 덩어리(장면 상자와 같은 칸)에 드는 화소를 모두 감싸는 사각형 ∪ 칸 중심 끝점 상자
 * (boxPixels — 칸 중심 화소가 이웃 칸에 더 가까운 경우도 빠지지 않게), 최소 MIN_BOX_PX.
 */
export function objectBoxPixels(kit: GroupImageKit, run: DeriveRun, scene: SceneLabel, o: SceneObject): [number, number, number, number] {
  const comp = run.components.get(componentKey(scene.scanIndex, o.recordUuid, kit.group.id, o.leg))
  const px = comp ? cellsPixelBox(kit, comp.cells) : null
  const centers = boxPixels(kit.vp, o.box!)
  if (!px) return atLeast(kit.vp, centers)
  const x0 = Math.min(px[0], centers[0])
  const y0 = Math.min(px[1], centers[1])
  const x1 = Math.max(px[0] + px[2], centers[0] + centers[2])
  const y1 = Math.max(px[1] + px[3], centers[1] + centers[3])
  return atLeast(kit.vp, [x0, y0, x1 - x0, y1 - y0])
}

/** 무시 객체 창의 화소 사각형 (COCO 무시 영역). 창이 그림 밖이면 null */
export function windowBoxPixels(kit: GroupImageKit, run: DeriveRun, o: SceneObject): [number, number, number, number] | null {
  const w = run.windows.get(o.windowId)
  if (!w) return null
  const [, nb, nt] = kit.group.shape
  const cells: number[] = []
  for (let b = 0; b < nb; b++) for (let i = Math.max(0, w.lo[b]!); i <= Math.min(nt - 1, w.hi[b]!); i++) cells.push(b * nt + i)
  return cellsPixelBox(kit, cells)
}

/** 상자 (mm) → 화소 사각형 [x, y, w, h] (그림 안으로 자름) */
export function boxPixels(vp: ImageViewport, box: { vMinMm: number; vMaxMm: number; depthMinMm: number; depthMaxMm: number }): [number, number, number, number] {
  const clampX = (x: number): number => Math.min(vp.width - 1, Math.max(0, x))
  const clampY = (y: number): number => Math.min(vp.height - 1, Math.max(0, y))
  const xa = clampX(Math.floor((box.vMinMm - vp.vMinMm) / vp.mmPerPx + 1e-9))
  const xb = clampX(Math.floor((box.vMaxMm - vp.vMinMm) / vp.mmPerPx + 1e-9))
  const ya = clampY(Math.floor((box.depthMinMm - vp.depthMinMm) / vp.mmPerPx + 1e-9))
  const yb = clampY(Math.floor((box.depthMaxMm - vp.depthMinMm) / vp.mmPerPx + 1e-9))
  const x = Math.min(xa, xb)
  const y = Math.min(ya, yb)
  return [x, y, Math.abs(xb - xa) + 1, Math.abs(yb - ya) + 1]
}

/** YOLO 한 줄: 분류 cx cy w h (0~1, 소수 6자리) */
export function yoloLine(cls: number, vp: ImageViewport, px: readonly [number, number, number, number]): string {
  const [x, y, w, h] = px
  const f = (v: number): string => v.toFixed(6)
  return `${cls} ${f((x + w / 2) / vp.width)} ${f((y + h / 2) / vp.height)} ${f(w / vp.width)} ${f(h / vp.height)}`
}

export function classOf(o: Pick<SceneObject, 'policy'>): 0 | 1 {
  return o.policy === 'defect' ? 0 : 1
}

/** meta.json 의 그림 정보 */
export function viewportMeta(vp: ImageViewport): Record<string, unknown> {
  return {
    mmPerPx: vp.mmPerPx,
    width: vp.width,
    height: vp.height,
    vMinMm: r4(vp.vMinMm),
    vMaxMm: r4(vp.vMaxMm),
    depthMinMm: r4(vp.depthMinMm),
    depthMaxMm: r4(vp.depthMaxMm),
    legs: [1, vp.maxLeg],
    palette: IMAGE_PALETTE_NAME,
    softGainDb: 0,
    outsideRgb: [...OUTSIDE_RGB],
    maskRgb: [...MASK_RGB],
    maskValues: { keep: MASK_VALUE.keep, gateOutside: MASK_VALUE.gate, label: MASK_VALUE.label },
    minBoxPx: MIN_BOX_PX,
    imageRulesVersion: TRAIN_IMAGE_RULES_VERSION,
    axes: '가로 = V (mm, 용접 중심 0, 오른쪽이 큰 값), 세로 = 펼친 깊이 (mm, 위가 0). 화소 중심 = 최소값 + (번호 + 0.5) × mmPerPx'
  }
}
