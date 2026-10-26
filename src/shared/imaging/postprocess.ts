/**
 * 후처리(OmniPC 분석 모드) 상태 — 순수 모델과 범위 계산 (main · renderer · 테스트 공용, 런타임 의존성 없음).
 * 계획: 계획_이미지보기/계획_후처리.md 5.1·5.2.
 *
 * 저장 단위는 검사 좌표(mm)·%·dB 뿐이다. 화면 px·샘플 번호·µs 는 저장하지 않는다.
 * 기본값(null·0·빈 객체)은 곧 파일값·지금 화면이라, 조정이 하나도 없으면 그림이 바이트 단위로 같아야 한다.
 */
import { scanIndexAt, scanPositionMm } from './coords'
import type { ViewerGroup, ViewerScanAxis } from './types'

/** 좌표 규칙(coords.ts 2절) 버전. 바뀌면 저장된 후처리 설정을 통째로 버린다 */
export const POST_RULES_VERSION = 1

/** [최소, 최대] (mm) */
export type MmRange = [number, number]

export interface GateOverride {
  /** 없으면 파일 형상 */
  geometry?: 'TrueDepth' | 'SoundPath'
  /** TrueDepth: 깊이 mm, SoundPath: 음로 mm */
  startMm?: number
  lengthMm?: number
  /** 표시 % (파일 JSON 단위, unitMax 기준) */
  thresholdPct?: number
}

export interface GroupPost {
  /** S-scan 가로(V) 창 — 그룹별. null = 그 그룹 부채꼴 + 2 % */
  sscanV: MmRange | null
  /** A-scan 깊이 창. null = 현재 빔 첫~끝 샘플 (지금 규칙) */
  ascan: MmRange | null
  /** B-scan 깊이 창. null = A-scan 과 같은 규칙 */
  bscan: MmRange | null
  /** A-scan 진폭 축·컬러바 상한 */
  ampAxisMaxPct: 100 | 200
  /** 소프트 이득 Δ (dB), 그룹별. 0 = 파일 그대로 */
  gainDb: number
  /** null = 파일 cscanGateId */
  cscanGateId: number | null
  /** 게이트 id → override (빈 객체 = 파일값) */
  gates: Record<number, GateOverride>
  /** 기준 커서 (2차) */
  refCursor: { scanMm: number; beam: number } | null
}

export interface PostProcess {
  version: 1
  rulesVersion: number
  /** 다른 파일의 설정이 섞이지 않게 (뷰어 key 의 sha 와 대조) */
  fileSha256: string
  /** S-scan 깊이 창 — 뷰어 공통(단일·'모두' 하나). null = 보이는 그룹 부채꼴 합집합 + 2 % */
  sscanDepthMm: MmRange | null
  /** C·B-scan 스캔 창 (그룹 공통, mm). null = 전체 */
  scanRangeMm: MmRange | null
  /** null = 파일값 (ModelSetup IsCScanReversed) */
  cscanReversed: boolean | null
  /** 색표 범위 % (뷰어 공통 — OmniPC 는 그룹별이지만 1차는 단순화) */
  palette: { minPct: number; maxPct: number }
  groups: Record<number, GroupPost>
  /**
   * 사용자가 불러온 OmniPC 색표(.pal, L2) — 파일 색표 대신 칠한다. 없거나 null = 파일 색표(지금과 같음).
   * 선택 칸이라 기본값(defaultPost)·옛 세션 캐시·기록 스냅샷의 JSON 은 바뀌지 않는다. 색표 범위(palette)는 이 색표 위에 그대로 적용된다
   */
  paletteFile?: PostPaletteFile | null
}

/** 불러온 색표 (사용자 폴더의 .pal 을 main 이 읽은 것 — 앱에 묶어 두지 않고 세션 동안만 쓴다) */
export interface PostPaletteFile {
  /** 파일 이름 (확장자 뺀 것, 예 'EVDNT_AmplitudeCut') */
  name: string
  /** 256색 'rrggbb' */
  palette: string[]
  /** 특수색 3개 ([0] 수집 안 됨 · [1] 게이트 A 미검출 · [2] 게이트 I 미검출 — palette.ts SPECIAL_*) */
  specialColors: string[]
}

export const GAIN_DB_MIN = -40
export const GAIN_DB_MAX = 40
export const GAIN_DB_STEP = 0.1
export const PALETTE_MIN_SPAN_PCT = 5
/** 범위 최소 폭 (mm) — 깊이·V */
export const MIN_DEPTH_SPAN_MM = 2
export const MIN_V_SPAN_MM = 2
/** 스캔 창 최소 칸 수 */
export const MIN_SCAN_CELLS = 10
/** 휠 한 칸 = ×1.25 */
export const WHEEL_ZOOM_FACTOR = 1.25
/** 휠 누적 임계 (px): 마우스 한 노치(보통 100 px) = 1틱, 트랙패드는 쌓아서 */
export const WHEEL_PX_PER_TICK = 100

export function defaultGroupPost(): GroupPost {
  return { sscanV: null, ascan: null, bscan: null, ampAxisMaxPct: 100, gainDb: 0, cscanGateId: null, gates: {}, refCursor: null }
}

export function defaultPost(fileSha256: string): PostProcess {
  return {
    version: 1,
    rulesVersion: POST_RULES_VERSION,
    fileSha256,
    sscanDepthMm: null,
    scanRangeMm: null,
    cscanReversed: null,
    palette: { minPct: 0, maxPct: 100 },
    groups: {}
  }
}

const DEFAULT_GROUP = defaultGroupPost()

/** 그룹 설정 (없으면 기본값 — 공유 객체, 바꾸지 말 것) */
export function groupPostOf(p: PostProcess, groupId: number): GroupPost {
  return p.groups[groupId] ?? DEFAULT_GROUP
}

export function isDefaultGroupPost(g: GroupPost): boolean {
  return (
    g.sscanV === null &&
    g.ascan === null &&
    g.bscan === null &&
    g.ampAxisMaxPct === 100 &&
    g.gainDb === 0 &&
    g.cscanGateId === null &&
    Object.keys(g.gates).length === 0 &&
    g.refCursor === null
  )
}

export function isDefaultPost(p: PostProcess): boolean {
  return (
    p.sscanDepthMm === null &&
    p.scanRangeMm === null &&
    p.cscanReversed === null &&
    p.palette.minPct === 0 &&
    p.palette.maxPct === 100 &&
    !p.paletteFile &&
    Object.values(p.groups).every(isDefaultGroupPost)
  )
}

/**
 * 화면에 칠할 색표·특수색: 불러온 색표(L2)가 있으면 그것, 없으면 파일 화면 상태의 것 — 같은 배열 객체 그대로(불러오지 않았으면
 * 지금 그림과 바이트 단위로 같게, 다시 계산도 하지 않게)
 */
export function postPaletteOf(p: Pick<PostProcess, 'paletteFile'>, display: { palette: string[]; specialColors: string[] }): { palette: string[]; specialColors: string[] } {
  return p.paletteFile ? { palette: p.paletteFile.palette, specialColors: p.paletteFile.specialColors } : display
}

/** 어떤 조정이 있는지 (Status '조정됨' 툴팁용, 한국어 낱말) */
export function adjustedParts(p: PostProcess): string[] {
  const out: string[] = []
  const groups = Object.values(p.groups)
  if (p.sscanDepthMm || p.scanRangeMm || groups.some((g) => g.sscanV || g.ascan || g.bscan)) out.push('범위')
  // 기법과 무관한 이름: 이 값 하나가 모든 그룹 C-scan 세로축(섹토리얼·컴파운드 = 굴절각, 리니어 = 빔 번호)을 함께 뒤집는다
  if (p.cscanReversed !== null) out.push('C-scan 방향')
  if (groups.some((g) => Object.keys(g.gates).length > 0 || g.cscanGateId !== null)) out.push('게이트')
  if (groups.some((g) => g.gainDb !== 0)) out.push('이득')
  if (p.palette.minPct !== 0 || p.palette.maxPct !== 100 || groups.some((g) => g.ampAxisMaxPct !== 100) || p.paletteFile) out.push('색표')
  if (groups.some((g) => g.refCursor)) out.push('기준 커서')
  return out
}

/** 그룹 설정을 바꾼 새 PostProcess (기본값이 되면 그룹 항목을 지운다) */
export function withGroupPost(p: PostProcess, groupId: number, patch: Partial<GroupPost>): PostProcess {
  const next: GroupPost = { ...groupPostOf(p, groupId), ...patch }
  const groups = { ...p.groups }
  if (isDefaultGroupPost(next)) delete groups[groupId]
  else groups[groupId] = next
  return { ...p, groups }
}

// ──────────────────────────────── 범위 계산 ────────────────────────────────

export interface RangeLimits {
  /** 기본(전체) 창 — 이 밖으로는 못 나간다 */
  full: MmRange
  /** 최소 폭 (mm) */
  minWidth: number
}

const EPS = 1e-9

export function rangeEquals(a: MmRange | null, b: MmRange | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

/** 창을 기본 창 안·최소 폭 이상으로 맞춘다. 폭이 기본 창 이상이면 기본 창 그대로 */
export function clampRange(r: MmRange, lim: RangeLimits): MmRange {
  let [a, b] = r[0] <= r[1] ? r : [r[1], r[0]]
  const [fa, fb] = lim.full
  const fullW = fb - fa
  const minW = Math.min(Math.max(0, lim.minWidth), fullW)
  let w = b - a
  if (w < minW) {
    const c = (a + b) / 2
    a = c - minW / 2
    b = c + minW / 2
    w = minW
  }
  if (w >= fullW - EPS) return [fa, fb]
  if (a < fa) {
    b += fa - a
    a = fa
  }
  if (b > fb) {
    a -= b - fb
    b = fb
  }
  return [a, b]
}

/** 창과 기본 창이 같으면 null (= 기본값) */
export function normalizeRange(r: MmRange | null, full: MmRange): MmRange | null {
  return r === null || rangeEquals(r, full) ? null : r
}

/**
 * 포인터 중심 확대·축소. anchorFrac = 창 안에서 포인터 위치(0..1), factor > 1 이면 확대(폭 / factor).
 * 포인터가 가리키던 값이 같은 화면 위치에 남는다.
 */
export function zoomRange(r: MmRange, anchorFrac: number, factor: number, lim: RangeLimits): MmRange {
  const w = r[1] - r[0]
  const f = Math.max(0, Math.min(1, anchorFrac))
  const nw = w / factor
  const anchor = r[0] + f * w
  const a = anchor - f * nw
  return clampRange([a, a + nw], lim)
}

export function panRange(r: MmRange, deltaMm: number, lim: RangeLimits): MmRange {
  return clampRange([r[0] + deltaMm, r[1] + deltaMm], lim)
}

/**
 * 공통 스캔 창(mm) → 그룹의 칸 범위 [k0, k1) (k1 미포함).
 *   null 창 → 전체. 그룹 격자와 전혀 겹치지 않으면 null (= 전체를 그리고 '스캔 범위 밖' 표시).
 *   최소 minCells 칸을 보장한다 (끝 칸을 늘리고 count 에서 자름).
 * scanIndexAt 은 [0, count−1] 로 자르므로 겹침은 반드시 mm 로 먼저 본다.
 */
export function scanWindowOf(range: MmRange | null, axis: ViewerScanAxis, minCells = MIN_SCAN_CELLS): [number, number] | null {
  if (axis.count < 1) return null
  if (range === null) return [0, axis.count]
  const first = scanPositionMm(0, axis)
  const last = scanPositionMm(axis.count - 1, axis)
  const lo = Math.min(first, last)
  const hi = Math.max(first, last)
  if (range[1] < lo - EPS || range[0] > hi + EPS) return null
  let k0 = scanIndexAt(Math.max(range[0], lo), axis)
  let k1 = scanIndexAt(Math.min(range[1], hi), axis) + 1
  if (k1 < k0) [k0, k1] = [k1 - 1, k0 + 1]
  const min = Math.min(Math.max(1, minCells), axis.count)
  if (k1 - k0 < min) {
    k1 = Math.min(axis.count, k0 + min)
    k0 = Math.max(0, k1 - min)
  }
  return [k0, k1]
}

/** 스캔축 전체 범위 (mm, 첫 칸·끝 칸의 중심) */
export function scanAxisFull(axis: ViewerScanAxis): MmRange {
  const a = scanPositionMm(0, axis)
  const b = scanPositionMm(Math.max(0, axis.count - 1), axis)
  return a <= b ? [a, b] : [b, a]
}

/** 커서가 창 밖이면 창을 같은 폭으로 밀어 커서를 포함 (←/→ 이동에서만 쓴다) */
export function ensureScanVisible(range: MmRange | null, cursorMm: number, full: MmRange): MmRange | null {
  if (range === null) return null
  if (cursorMm >= range[0] - EPS && cursorMm <= range[1] + EPS) return range
  const w = range[1] - range[0]
  const shifted: MmRange = cursorMm < range[0] ? [cursorMm, cursorMm + w] : [cursorMm - w, cursorMm]
  return normalizeRange(clampRange(shifted, { full, minWidth: 0 }), full)
}

/**
 * 휠 입력 정규화: deltaMode(0 px, 1 줄, 2 페이지)를 px 로 바꿔 누적하고 WHEEL_PX_PER_TICK 마다 1틱.
 * 돌려주는 ticks 는 ±3 으로 자른다 (트랙패드 폭주 방지). 양수 = 아래로(축소).
 */
export function wheelTicks(deltaY: number, deltaMode: number, acc: number): { ticks: number; acc: number } {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  if (!Number.isFinite(px)) return { ticks: 0, acc }
  let a = acc + px
  let ticks = Math.trunc(a / WHEEL_PX_PER_TICK)
  a -= ticks * WHEEL_PX_PER_TICK
  if (ticks > 3) {
    ticks = 3
    a = 0
  } else if (ticks < -3) {
    ticks = -3
    a = 0
  }
  return { ticks, acc: a }
}

/** 틱 수 → 확대 배율 (음수 틱 = 확대, 양수 = 축소) */
export function zoomFactorOf(ticks: number): number {
  return WHEEL_ZOOM_FACTOR ** -ticks
}

// ──────────────────────────────── 검증·정리 ────────────────────────────────

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function rangeOf(v: unknown): MmRange | null {
  if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1]) || !(v[1] > v[0])) return null
  return [v[0], v[1]]
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function clampGainDb(v: number): number {
  const c = Math.max(GAIN_DB_MIN, Math.min(GAIN_DB_MAX, v))
  return Math.round(c / GAIN_DB_STEP) * GAIN_DB_STEP
}

const HEX6 = /^[0-9a-f]{6}$/i
/** 불러온 색표 이름 길이 상한 (글자) */
export const PALETTE_FILE_NAME_MAX = 200

/** 불러온 색표 검증: 이름 + 256색 + 특수색 3개 ('rrggbb', 소문자로). 틀리면 null */
export function sanitizePaletteFile(raw: unknown): PostPaletteFile | null {
  const o = obj(raw)
  if (!o) return null
  const name = typeof o['name'] === 'string' ? o['name'].slice(0, PALETTE_FILE_NAME_MAX) : ''
  const colors = (v: unknown, n: number): string[] | null =>
    Array.isArray(v) && v.length === n && v.every((c) => typeof c === 'string' && HEX6.test(c)) ? (v as string[]).map((c) => c.toLowerCase()) : null
  const palette = colors(o['palette'], 256)
  const specialColors = colors(o['specialColors'], 3)
  return palette && specialColors ? { name, palette, specialColors } : null
}

function sanitizeGate(raw: unknown, unitMax: number): GateOverride | null {
  const o = obj(raw)
  if (!o) return null
  const g: GateOverride = {}
  if (o['geometry'] === 'TrueDepth' || o['geometry'] === 'SoundPath') g.geometry = o['geometry']
  if (isNum(o['startMm']) && o['startMm'] >= 0) g.startMm = o['startMm']
  if (isNum(o['lengthMm']) && o['lengthMm'] > 0) g.lengthMm = o['lengthMm']
  if (isNum(o['thresholdPct'])) g.thresholdPct = Math.max(0.1, Math.min(unitMax, o['thresholdPct']))
  return Object.keys(g).length ? g : null
}

/**
 * 저장·캐시에서 온 값을 검증해 PostProcess 로. 모르는 키 제거, 범위 클램프, 없는 그룹·게이트 제거.
 * 버전·규칙·파일 sha 가 다르면 기본값 (+ 이유).
 */
export function sanitizePostProcess(raw: unknown, ctx: { fileSha256: string; groups: ReadonlyArray<Pick<ViewerGroup, 'id' | 'gates' | 'ampScale'>> }): {
  post: PostProcess
  reason: string | null
} {
  const base = defaultPost(ctx.fileSha256)
  const o = obj(raw)
  if (!o) return { post: base, reason: null }
  if (o['version'] !== 1) return { post: base, reason: '보기 설정 형식이 달라 초기화했습니다.' }
  if (o['rulesVersion'] !== POST_RULES_VERSION) return { post: base, reason: '좌표 규칙이 바뀌어 보기 설정을 초기화했습니다.' }
  if (o['fileSha256'] !== ctx.fileSha256) return { post: base, reason: '다른 파일의 보기 설정이라 초기화했습니다.' }
  const post: PostProcess = { ...base }
  post.sscanDepthMm = rangeOf(o['sscanDepthMm'])
  if (post.sscanDepthMm && post.sscanDepthMm[0] < 0) post.sscanDepthMm = [0, post.sscanDepthMm[1]]
  post.scanRangeMm = rangeOf(o['scanRangeMm'])
  post.cscanReversed = typeof o['cscanReversed'] === 'boolean' ? o['cscanReversed'] : null
  const pal = obj(o['palette'])
  if (pal && isNum(pal['minPct']) && isNum(pal['maxPct'])) {
    const min = Math.max(0, Math.min(100 - PALETTE_MIN_SPAN_PCT, pal['minPct']))
    const max = Math.max(min + PALETTE_MIN_SPAN_PCT, Math.min(100, pal['maxPct']))
    post.palette = { minPct: min, maxPct: max }
  }
  // 불러온 색표는 있을 때만 칸을 만든다 (없으면 기본값 JSON 그대로)
  const pf = sanitizePaletteFile(o['paletteFile'])
  if (pf) post.paletteFile = pf
  const groupsRaw = obj(o['groups']) ?? {}
  for (const g of ctx.groups) {
    const gr = obj(groupsRaw[String(g.id)])
    if (!gr) continue
    const gp = defaultGroupPost()
    gp.sscanV = rangeOf(gr['sscanV'])
    gp.ascan = rangeOf(gr['ascan'])
    gp.bscan = rangeOf(gr['bscan'])
    gp.ampAxisMaxPct = gr['ampAxisMaxPct'] === 200 ? 200 : 100
    gp.gainDb = isNum(gr['gainDb']) ? clampGainDb(gr['gainDb']) : 0
    const cg = gr['cscanGateId']
    gp.cscanGateId = isNum(cg) && g.gates.some((x) => x.id === cg && x.supported) ? cg : null
    const gatesRaw = obj(gr['gates']) ?? {}
    for (const gate of g.gates) {
      const ov = sanitizeGate(gatesRaw[String(gate.id)], g.ampScale.unitMax)
      if (ov) gp.gates[gate.id] = ov
    }
    const rc = obj(gr['refCursor'])
    if (rc && isNum(rc['scanMm']) && isNum(rc['beam'])) gp.refCursor = { scanMm: rc['scanMm'], beam: Math.round(rc['beam']) }
    if (!isDefaultGroupPost(gp)) post.groups[g.id] = gp
  }
  return { post, reason: null }
}
