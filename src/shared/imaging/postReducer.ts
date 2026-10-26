/**
 * 후처리 상태의 리듀서 (순수, main · renderer · 테스트 공용). 모델·범위 계산은 ./postprocess.ts.
 *   - 범위 클램프 기준(limits)은 액션에 실어 보낸다 (기본 창은 화면 쪽이 안다)
 *   - 이력 UNDO_DEPTH 단계 (Ctrl+Z). 변화 없는 액션은 같은 상태(참조 동일)를 돌려줘 이력을 남기지 않는다
 * 현재 커서(스캔 mm·빔)·레이아웃·그룹 모드는 여기 두지 않는다 (계획 결정 9).
 */
import {
  clampGainDb,
  clampRange,
  defaultPost,
  ensureScanVisible,
  groupPostOf,
  normalizeRange,
  panRange,
  rangeEquals,
  sanitizePaletteFile,
  withGroupPost,
  zoomRange,
  type GateOverride,
  type MmRange,
  type PostPaletteFile,
  type PostProcess,
  type RangeLimits
} from './postprocess'

export const UNDO_DEPTH = 10

export type PostAction =
  | { type: 'setSscanDepth'; range: MmRange | null; limits: RangeLimits }
  | { type: 'setSscanV'; groupId: number; range: MmRange | null; limits: RangeLimits }
  | { type: 'zoomSscan'; axis: 'depth' | 'v'; groupId: number; anchorFrac: number; factor: number; limits: RangeLimits }
  | { type: 'panSscan'; axis: 'depth' | 'v'; groupId: number; deltaMm: number; limits: RangeLimits }
  | { type: 'setScanRange'; range: MmRange | null; limits: RangeLimits }
  | { type: 'zoomScan'; anchorFrac: number; factor: number; limits: RangeLimits }
  | { type: 'panScan'; deltaMm: number; limits: RangeLimits }
  | { type: 'ensureScanVisible'; cursorMm: number; full: MmRange }
  | { type: 'setCscanReversed'; value: boolean | null; fileValue?: boolean }
  | { type: 'resetScan' }
  | { type: 'resetPalette'; groupId: number }
  | { type: 'setAscanRange'; groupId: number; range: MmRange | null; limits: RangeLimits }
  | { type: 'zoomAscan'; groupId: number; anchorFrac: number; factor: number; limits: RangeLimits }
  | { type: 'panAscan'; groupId: number; deltaMm: number; limits: RangeLimits }
  | { type: 'setBscanRange'; groupId: number; range: MmRange | null; limits: RangeLimits }
  | { type: 'zoomBscan'; groupId: number; anchorFrac: number; factor: number; limits: RangeLimits }
  | { type: 'panBscan'; groupId: number; deltaMm: number; limits: RangeLimits }
  | { type: 'setGate'; groupId: number; gateId: number; patch: GateOverride; unitMax: number }
  | { type: 'resetGate'; groupId: number; gateId: number }
  | { type: 'setGain'; groupId: number; dB: number }
  | { type: 'nudgeGain'; groupId: number; dB: number }
  | { type: 'setPalette'; minPct: number; maxPct: number }
  | { type: 'setAmpAxis'; groupId: number; maxPct: 100 | 200 }
  /** 불러온 OmniPC 색표(.pal, L2)로 칠하기. null = 파일 색표로 되돌리기 (색표 범위·진폭 축은 그대로) */
  | { type: 'setPaletteFile'; file: PostPaletteFile | null }
  | { type: 'resetRanges'; groupId: number | 'all' }
  | { type: 'resetAll' }
  | { type: 'undo' }
  | { type: 'load'; post: PostProcess }

export interface PostState {
  post: PostProcess
  history: PostProcess[]
}

/** 불러온 색표 칸을 뺀 것 (칸 자체를 지워 기본값 JSON 과 같게). 칸이 없으면 같은 객체 */
function withoutPaletteFile(p: PostProcess): PostProcess {
  if (!('paletteFile' in p)) return p
  const { paletteFile: _drop, ...rest } = p
  return rest
}

/** 창 액션 공통: 현재 창(없으면 기본 창)에 함수를 적용하고 기본 창과 같으면 null */
function applyRange(cur: MmRange | null, limits: RangeLimits, fn: (r: MmRange) => MmRange): MmRange | null {
  return normalizeRange(fn(cur ?? limits.full), limits.full)
}

function setRange(range: MmRange | null, limits: RangeLimits): MmRange | null {
  return range === null ? null : normalizeRange(clampRange(range, limits), limits.full)
}

export function applyPostAction(p: PostProcess, a: PostAction): PostProcess {
  switch (a.type) {
    case 'setSscanDepth':
      return { ...p, sscanDepthMm: setRange(a.range, a.limits) }
    case 'setSscanV':
      return withGroupPost(p, a.groupId, { sscanV: setRange(a.range, a.limits) })
    case 'zoomSscan': {
      const z = (r: MmRange): MmRange => zoomRange(r, a.anchorFrac, a.factor, a.limits)
      return a.axis === 'depth'
        ? { ...p, sscanDepthMm: applyRange(p.sscanDepthMm, a.limits, z) }
        : withGroupPost(p, a.groupId, { sscanV: applyRange(groupPostOf(p, a.groupId).sscanV, a.limits, z) })
    }
    case 'panSscan': {
      const f = (r: MmRange): MmRange => panRange(r, a.deltaMm, a.limits)
      return a.axis === 'depth'
        ? { ...p, sscanDepthMm: applyRange(p.sscanDepthMm, a.limits, f) }
        : withGroupPost(p, a.groupId, { sscanV: applyRange(groupPostOf(p, a.groupId).sscanV, a.limits, f) })
    }
    case 'setScanRange':
      return { ...p, scanRangeMm: setRange(a.range, a.limits) }
    case 'zoomScan':
      return { ...p, scanRangeMm: applyRange(p.scanRangeMm, a.limits, (r) => zoomRange(r, a.anchorFrac, a.factor, a.limits)) }
    case 'panScan':
      return { ...p, scanRangeMm: applyRange(p.scanRangeMm, a.limits, (r) => panRange(r, a.deltaMm, a.limits)) }
    case 'ensureScanVisible': {
      const next = ensureScanVisible(p.scanRangeMm, a.cursorMm, a.full)
      return rangeEquals(next, p.scanRangeMm) ? p : { ...p, scanRangeMm: next }
    }
    case 'setCscanReversed':
      // 파일값과 같으면 null (= 파일값) — 다른 조정과 같은 '기본값이면 비움' 규칙
      return { ...p, cscanReversed: a.value === null || (a.fileValue !== undefined && a.value === a.fileValue) ? null : a.value }
    case 'resetScan':
      return { ...p, scanRangeMm: null, cscanReversed: null }
    case 'resetPalette':
      // 색표 탭 전체 되돌리기: 불러온 색표도 뺀다 (불러온 적이 없으면 칸을 만들지 않아 지금과 같은 값)
      return withGroupPost({ ...withoutPaletteFile(p), palette: { minPct: 0, maxPct: 100 } }, a.groupId, { ampAxisMaxPct: 100 })
    case 'setPaletteFile': {
      if (a.file === null) return p.paletteFile ? withoutPaletteFile(p) : p
      const f = sanitizePaletteFile(a.file)
      return f ? { ...p, paletteFile: f } : p
    }
    case 'setAscanRange':
      return withGroupPost(p, a.groupId, { ascan: setRange(a.range, a.limits) })
    case 'zoomAscan':
      return withGroupPost(p, a.groupId, { ascan: applyRange(groupPostOf(p, a.groupId).ascan, a.limits, (r) => zoomRange(r, a.anchorFrac, a.factor, a.limits)) })
    case 'panAscan':
      return withGroupPost(p, a.groupId, { ascan: applyRange(groupPostOf(p, a.groupId).ascan, a.limits, (r) => panRange(r, a.deltaMm, a.limits)) })
    case 'setBscanRange':
      return withGroupPost(p, a.groupId, { bscan: setRange(a.range, a.limits) })
    case 'zoomBscan':
      return withGroupPost(p, a.groupId, { bscan: applyRange(groupPostOf(p, a.groupId).bscan, a.limits, (r) => zoomRange(r, a.anchorFrac, a.factor, a.limits)) })
    case 'panBscan':
      return withGroupPost(p, a.groupId, { bscan: applyRange(groupPostOf(p, a.groupId).bscan, a.limits, (r) => panRange(r, a.deltaMm, a.limits)) })
    case 'setGate': {
      const gp = groupPostOf(p, a.groupId)
      const cur = gp.gates[a.gateId] ?? {}
      const next: GateOverride = { ...cur }
      if (a.patch.geometry !== undefined) next.geometry = a.patch.geometry
      if (a.patch.startMm !== undefined) next.startMm = Math.max(0, a.patch.startMm)
      if (a.patch.lengthMm !== undefined) next.lengthMm = Math.max(0.1, a.patch.lengthMm)
      if (a.patch.thresholdPct !== undefined) next.thresholdPct = Math.max(0.1, Math.min(a.unitMax, a.patch.thresholdPct))
      return withGroupPost(p, a.groupId, { gates: { ...gp.gates, [a.gateId]: next } })
    }
    case 'resetGate': {
      const gates = { ...groupPostOf(p, a.groupId).gates }
      delete gates[a.gateId]
      return withGroupPost(p, a.groupId, { gates })
    }
    case 'setGain':
      return withGroupPost(p, a.groupId, { gainDb: clampGainDb(a.dB) })
    case 'nudgeGain':
      return withGroupPost(p, a.groupId, { gainDb: clampGainDb(groupPostOf(p, a.groupId).gainDb + a.dB) })
    case 'setPalette': {
      const min = Math.max(0, Math.min(95, a.minPct))
      const max = Math.max(min + 5, Math.min(100, a.maxPct))
      return { ...p, palette: { minPct: min, maxPct: max } }
    }
    case 'setAmpAxis':
      return withGroupPost(p, a.groupId, { ampAxisMaxPct: a.maxPct })
    case 'resetRanges': {
      let next: PostProcess = { ...p, sscanDepthMm: null, scanRangeMm: null }
      const ids = a.groupId === 'all' ? Object.keys(p.groups).map(Number) : [a.groupId]
      for (const id of ids) next = withGroupPost(next, id, { sscanV: null, ascan: null, bscan: null })
      return next
    }
    case 'resetAll':
      return defaultPost(p.fileSha256)
    case 'undo':
    case 'load':
      return p
  }
}

/** 값이 같은가 (작은 객체라 JSON 비교로 충분) — 변화 없는 액션이 이력을 남기지 않게 */
function samePost(a: PostProcess, b: PostProcess): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function postReducer(s: PostState, a: PostAction): PostState {
  if (a.type === 'undo') {
    const prev = s.history[s.history.length - 1]
    return prev ? { post: prev, history: s.history.slice(0, -1) } : s
  }
  if (a.type === 'load') return { post: a.post, history: [] }
  const post = applyPostAction(s.post, a)
  if (post === s.post || samePost(post, s.post)) return s
  // 커서 따라가기(←/→)는 사용자가 한 '조정' 이 아니므로 되돌리기 이력에 넣지 않는다
  if (a.type === 'ensureScanVisible') return { ...s, post }
  return { post, history: [...s.history.slice(-(UNDO_DEPTH - 1)), s.post] }
}

