/**
 * 뷰어 색표 불러오기·되돌리기 (OmniPC 조사 L2 — shared/imaging postprocess.ts paletteFile · postReducer 'setPaletteFile'):
 *  - 불러오면 후처리에 색표 덮어쓰기 칸이 생기고('조정됨' 색표), 되돌리면 칸이 사라져 기본값 JSON·그림이 바이트 그대로
 *  - 불러오지 않았으면 postPaletteOf 가 파일 화면 상태의 같은 배열을 돌려준다 (보통 모드 다시 계산·그림 변화 없음)
 *  - 데이터 없음 칸은 뷰어 상수(VIEWER_NO_DATA_SPECIAL_INDEX)로 칠한다 (학습 내보내기 상수와 따로 — X11, 값은 그대로 2)
 *  - 옛 세션 캐시·기록 스냅샷(paletteFile 없음)은 그대로 읽힌다
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AMPLITUDE_PALETTE,
  DEFAULT_SPECIAL_COLORS,
  EXPORT_OUTSIDE_SPECIAL_INDEX,
  VIEWER_NO_DATA_SPECIAL_INDEX,
  adjustedParts,
  buildSscanMap,
  defaultPost,
  hexToRgb,
  isDefaultPost,
  paletteRgb,
  postPaletteOf,
  postReducer,
  rawIndexFactor,
  renderSscan,
  sanitizePaletteFile,
  sanitizePostProcess,
  sscanExtent,
  type PostState
} from '@shared/imaging'
import { synthGroup, synthVolume } from './labeling/synth'

const SHA = 'abc'
/** 회색 256 단계 + 특수색 (mock 의 '불러온 색표' 와 같은 꼴) */
const GRAY = { name: 'EVDNT_시험', palette: Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0').repeat(3)), specialColors: ['112233', 'ffffff', '445566'] }
const DISPLAY = { palette: [...DEFAULT_AMPLITUDE_PALETTE], specialColors: [...DEFAULT_SPECIAL_COLORS] }
const init = (): PostState => ({ post: defaultPost(SHA), history: [] })

/** 뷰어와 같은 길: 후처리 → 칠할 색표·데이터 없음 색 → S-scan 그림 (데이터 없음 칸이 있는 스캔 1) */
function draw(post: PostState['post']): Uint8Array {
  const g = synthGroup(90)
  const v = synthVolume(g)
  const pal = postPaletteOf(post, DISPLAY)
  const e = sscanExtent(g)
  const out = new Uint8Array(160 * 120 * 4)
  const map = buildSscanMap(g, { vMinMm: e.vMinMm, vMaxMm: e.vMaxMm, depthMinMm: e.depthMinMm, depthMaxMm: e.depthMaxMm, width: 160, height: 120 })
  const [, nb, nt] = g.shape
  renderSscan({
    map,
    amplitude: v.amplitude,
    offset: 1 * nb * nt,
    status: v.status,
    statusOffset: 1 * nb,
    indexFactor: rawIndexFactor(g.ampScale),
    palette: paletteRgb(pal.palette),
    noData: hexToRgb(pal.specialColors[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080'),
    background: [0, 0, 0, 0],
    out
  })
  return out
}

describe('색표 덮어쓰기 (후처리 paletteFile)', () => {
  it('기본값에는 칸이 없다 (JSON·기본 판정 그대로)', () => {
    const p = defaultPost(SHA)
    expect('paletteFile' in p).toBe(false)
    expect(isDefaultPost(p)).toBe(true)
    expect(postPaletteOf(p, DISPLAY)).toBe(DISPLAY)
  })

  it('불러오기 → 조정됨(색표)·그 색표로, 되돌리기(파일 색표로) → 칸이 사라져 기본값과 같은 JSON', () => {
    const a = postReducer(init(), { type: 'setPaletteFile', file: GRAY })
    expect(a.post.paletteFile?.name).toBe('EVDNT_시험')
    expect(isDefaultPost(a.post)).toBe(false)
    expect(adjustedParts(a.post)).toEqual(['색표'])
    expect(postPaletteOf(a.post, DISPLAY).palette).toEqual(GRAY.palette)
    expect(a.history.length).toBe(1)
    const b = postReducer(a, { type: 'setPaletteFile', file: null })
    expect('paletteFile' in b.post).toBe(false)
    expect(JSON.stringify(b.post)).toBe(JSON.stringify(defaultPost(SHA)))
    expect(isDefaultPost(b.post)).toBe(true)
    expect(postPaletteOf(b.post, DISPLAY)).toBe(DISPLAY)
    // 없는 것을 되돌리기는 변화 없음 (같은 상태, 이력 없음)
    expect(postReducer(init(), { type: 'setPaletteFile', file: null })).toEqual(init())
  })

  it('그림: 불러오면 바뀌고, 되돌리면 처음과 바이트 단위로 같다 (데이터 없음 칸 포함)', () => {
    const base = draw(defaultPost(SHA))
    const loaded = postReducer(init(), { type: 'setPaletteFile', file: GRAY })
    const shown = draw(loaded.post)
    expect(Buffer.from(shown).equals(Buffer.from(base))).toBe(false)
    // 데이터 없음 칸(빔 3)은 불러온 색표의 [2] 특수색으로
    const ns = hexToRgb('445566')
    let noDataPx = 0
    for (let i = 0; i < shown.length; i += 4) if (shown[i] === ns[0] && shown[i + 1] === ns[1] && shown[i + 2] === ns[2] && shown[i + 3] === 255) noDataPx++
    expect(noDataPx).toBeGreaterThan(0)
    const back = postReducer(loaded, { type: 'setPaletteFile', file: null })
    expect(Buffer.from(draw(back.post)).equals(Buffer.from(base))).toBe(true)
    // 되돌리기(Ctrl+Z)도 같다
    const undone = postReducer(loaded, { type: 'undo' })
    expect(Buffer.from(draw(undone.post)).equals(Buffer.from(base))).toBe(true)
  })

  it('색표 탭 초기화·파일값으로(전부)도 불러온 색표를 뺀다, 색 범위는 따로 그대로', () => {
    let s = postReducer(init(), { type: 'setPalette', minPct: 10, maxPct: 80 })
    s = postReducer(s, { type: 'setPaletteFile', file: GRAY })
    expect(s.post.palette).toEqual({ minPct: 10, maxPct: 80 })
    const reverted = postReducer(s, { type: 'setPaletteFile', file: null })
    expect(reverted.post.palette).toEqual({ minPct: 10, maxPct: 80 })
    const reset = postReducer(s, { type: 'resetPalette', groupId: 0 })
    expect('paletteFile' in reset.post).toBe(false)
    expect(isDefaultPost(reset.post)).toBe(true)
    const all = postReducer(s, { type: 'resetAll' })
    expect(JSON.stringify(all.post)).toBe(JSON.stringify(defaultPost(SHA)))
  })

  it('틀린 색표(255색·특수색 2개·hex 아님)는 받지 않는다 (같은 상태)', () => {
    const s0 = init()
    for (const bad of [
      { ...GRAY, palette: GRAY.palette.slice(1) },
      { ...GRAY, specialColors: ['000000', 'ffffff'] },
      { ...GRAY, palette: [...GRAY.palette.slice(1), 'zzzzzz'] }
    ]) {
      expect(postReducer(s0, { type: 'setPaletteFile', file: bad })).toBe(s0)
      expect(sanitizePaletteFile(bad)).toBeNull()
    }
    expect(sanitizePaletteFile({ ...GRAY, palette: GRAY.palette.map((c) => c.toUpperCase()) })!.palette[255]).toBe('ffffff')
  })

  it('세션 캐시 검증: 맞는 색표는 남기고 틀린 것·없는 것은 칸을 만들지 않는다 (옛 캐시 그대로)', () => {
    const ctx = { fileSha256: SHA, groups: [] }
    const kept = sanitizePostProcess({ ...defaultPost(SHA), paletteFile: GRAY }, ctx).post
    expect(kept.paletteFile?.palette.length).toBe(256)
    const dropped = sanitizePostProcess({ ...defaultPost(SHA), paletteFile: { name: 'x', palette: [], specialColors: [] } }, ctx).post
    expect('paletteFile' in dropped).toBe(false)
    const old = sanitizePostProcess(defaultPost(SHA), ctx).post
    expect(JSON.stringify(old)).toBe(JSON.stringify(defaultPost(SHA)))
  })
})

describe('특수색 상수 (X11 — 값은 그대로, 이름만 나눔)', () => {
  it('뷰어 데이터 없음 = [2](회색, 임시), 학습 내보내기 바깥 = [2] 고정 (서로 별칭이 아닌 따로 된 상수)', () => {
    expect(VIEWER_NO_DATA_SPECIAL_INDEX).toBe(2)
    expect(EXPORT_OUTSIDE_SPECIAL_INDEX).toBe(2)
    expect(DEFAULT_SPECIAL_COLORS[VIEWER_NO_DATA_SPECIAL_INDEX]).toBe('808080')
  })
})

/**
 * 세션 색표 (2026-10-07 기본값 (나), renderer/src/viewer/postState.ts): 한 파일에서 불러온 색표를 다른 파일을 열 때 그 후처리에 넣는다(이력 없이).
 * 세션 색표가 없으면 후처리 객체를 그대로 돌려줘 보통 그림·기본값 판정이 바이트 그대로다.
 */
const POST_STATE = '../src/renderer/src/viewer/postState'
const PS = (await import(/* @vite-ignore */ POST_STATE)) as {
  withSessionPalette: (p: PostState['post'], f: unknown) => PostState['post']
  sessionPaletteFile: () => unknown
  setSessionPaletteFile: (f: unknown) => void
  clearPostState: () => void
}

describe('세션 색표 (모든 파일 보기)', () => {
  const pal = sanitizePaletteFile({ name: 'EVDNT_AmplitudeCut', palette: [...DEFAULT_AMPLITUDE_PALETTE].reverse(), specialColors: [...DEFAULT_SPECIAL_COLORS] })!

  it('세션 색표가 없으면 같은 객체(기본값 그대로), 있으면 넣고, 같은 색표면 다시 만들지 않는다', () => {
    const p0 = defaultPost('a'.repeat(64))
    expect(PS.withSessionPalette(p0, null)).toBe(p0)
    expect(isDefaultPost(PS.withSessionPalette(p0, null))).toBe(true)
    const p1 = PS.withSessionPalette(p0, pal)
    expect(p1.paletteFile).toEqual(pal)
    expect(isDefaultPost(p1)).toBe(false)
    expect(PS.withSessionPalette(p1, pal)).toBe(p1)
    expect(PS.withSessionPalette({ ...p1, paletteFile: { ...pal } }, pal).paletteFile).toEqual(pal)
    // 세션에서 빼면 칸이 사라져 기본값 JSON 과 같다
    const p2 = PS.withSessionPalette(p1, null)
    expect('paletteFile' in p2).toBe(false)
    expect(JSON.stringify(p2)).toBe(JSON.stringify(p0))
  })

  it('세션 보관: 넣고 빼기 (저장소를 바꿔도 남음 — clearPostState 와 무관)', () => {
    expect(PS.sessionPaletteFile()).toBeNull()
    PS.setSessionPaletteFile(pal)
    PS.clearPostState()
    expect(PS.sessionPaletteFile()).toBe(pal)
    PS.setSessionPaletteFile(null)
    expect(PS.sessionPaletteFile()).toBeNull()
  })
})
