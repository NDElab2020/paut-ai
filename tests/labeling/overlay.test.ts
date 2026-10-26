/**
 * 라벨 덮개 그리기 (renderer/src/viewer/overlay.ts · canvas.ts labelOverlayColors · labeling/overlays.ts):
 *  - 덮개가 없거나 비면 캔버스를 전혀 건드리지 않는다 → 보통 모드 그림 바이트 동일 (뷰는 overlayStyles·overlay 가 없으면 부르지도 않음)
 *  - mm → px 위치 ±1 px: S-scan (V, 펼친 깊이) · C-scan (스캔 mm, 빔) · A/B-scan (깊이) — 지금 그리기 식과 같은 자리
 *  - 초안 → 뷰별 덮개: 지금 칸은 초안 색, 다른 칸은 흐리게, R 은 모든 C-scan 세로선 + 그 그룹 가로선, 검토 구간은 모든 빔 띠, 시간 커서
 *  - 읽기값(파일 이득 0 dB)·초안 → 기록 칸 변환
 */
import { describe, expect, it } from 'vitest'
import {
  cscanBeamViewAxis,
  cscanXForScan,
  cscanYForBeam,
  depthToY,
  foldDepth,
  rawToPercent,
  samplePoint,
  scanPositionMm,
  scanViewAxis,
  sscanLookupAt,
  sscanRawAt,
  viewToPx,
  viewportPixel,
  type SscanViewport,
  type ViewerGroup
} from '@shared/imaging'
import { LABEL_COORD_RULES_VERSION } from '@shared/labels'
import { synthGroup, synthVolume } from './synth'

// 렌더러 모듈 (tsconfig.node.json 범위 밖 — 경로 문자열로 읽는다, viewerInput.test.ts 와 같음)
const OVERLAY = '../../src/renderer/src/viewer/overlay'
const CANVAS = '../../src/renderer/src/viewer/canvas'
const DRAFT = '../../src/renderer/src/labeling/overlays'
const STATE = '../../src/renderer/src/labeling/state'
const READING = '../../src/renderer/src/labeling/reading'
const CONVERT = '../../src/renderer/src/labeling/convert'

type Tone = string
interface Rect {
  id: string
  tone: Tone
  x0: number | null
  x1: number | null
  y0: number | null
  y1: number | null
  label?: string
}
interface Pt {
  id: string
  tone: Tone
  x: number
  y: number
  shape?: 'cross' | 'diamond' | 'circle'
  label?: string
}
interface Line {
  id: string
  tone: Tone
  value: number
  from?: number
  to?: number
  label?: string
}
interface Overlay {
  rects?: Rect[]
  points?: Pt[]
  vlines?: Line[]
  hlines?: Line[]
}
type Map2 = { x: (v: number) => number; y: (v: number) => number; width: number; height: number }
type Style = { stroke: string; fill: string | null; dashed: boolean }
const O = (await import(OVERLAY)) as {
  drawOverlay: (ctx: unknown, o: Overlay | null | undefined, map: Map2, styles: Record<Tone, Style>, ratio: number) => void
  mergeOverlays: (...o: Array<Overlay | null | undefined>) => Overlay | undefined
  isEmptyOverlay: (o: Overlay | null | undefined) => boolean
  OVERLAY_POINT_R: number
}
const C = (await import(CANVAS)) as { labelOverlayColors: (theme: 'light' | 'dark') => Record<Tone, Style> }
const D = (await import(DRAFT)) as {
  draftOverlays: (s: unknown, ctx: unknown) => { sscan: Record<number, Overlay>; cscan: Record<number, Overlay>; bscan: Overlay; ascan: Overlay }
}
const S = (await import(STATE)) as { initialLabelState: () => { ui: Record<string, unknown> }; labelReducer: (s: unknown, a: unknown) => any }
const RD = (await import(READING)) as {
  sscanPointReading: (g: ViewerGroup, v: unknown, k: number, vMm: number, d: number, t: number | null) => any
  ascanDepthReading: (g: ViewerGroup, v: unknown, k: number, b: number, d: number, t: number | null) => any
}
const CV = (await import(CONVERT)) as {
  toAnchorPoint: (p: unknown, g: { verified: boolean }, t: number | null) => any
  rectToAnchorPoints: (r: unknown, g: ViewerGroup, t: number | null, ids: [string, string]) => any[]
  reviewSpanOf: (r: unknown) => unknown
}

/** 그리기 호출을 적어 두는 가짜 캔버스 */
function recorder() {
  const calls: Array<[string, ...number[]] | [string, string]> = []
  const ctx: Record<string, unknown> = { strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: 'left' }
  for (const m of ['save', 'restore', 'beginPath', 'closePath', 'stroke', 'fill']) ctx[m] = () => calls.push([m])
  for (const m of ['moveTo', 'lineTo', 'rect', 'arc']) ctx[m] = (...a: number[]) => calls.push([m, ...a])
  ctx['setLineDash'] = (seg: number[]) => calls.push(['setLineDash', seg.length])
  ctx['fillText'] = (t: string) => calls.push(['fillText', t])
  // 속성 설정도 '건드림'으로 센다
  const proxy = new Proxy(ctx, {
    set(t, k, v) {
      calls.push(['set:' + String(k)])
      t[k as string] = v
      return true
    }
  })
  return { ctx: proxy, calls }
}

const STYLES = C.labelOverlayColors('light')

describe('덮개가 없으면 아무것도 그리지 않는다 (보통 모드 바이트 동일)', () => {
  it('undefined·null·빈 덮개 → 캔버스 호출 0', () => {
    for (const o of [undefined, null, {}, { rects: [], points: [], vlines: [], hlines: [] }]) {
      const { ctx, calls } = recorder()
      O.drawOverlay(ctx, o, { x: (v) => v, y: (v) => v, width: 100, height: 100 }, STYLES, 2)
      expect(calls).toEqual([])
      expect(O.isEmptyOverlay(o)).toBe(true)
    }
  })

  it('합치기: 모두 비면 undefined (뷰가 그리지 않게), 하나면 그 객체 그대로, 여럿이면 뒤 것이 위', () => {
    expect(O.mergeOverlays(undefined, {}, { points: [] })).toBeUndefined()
    const a = { points: [{ id: 'a', tone: 'draft', x: 1, y: 2 }] }
    expect(O.mergeOverlays(undefined, a, {})).toBe(a)
    const m = O.mergeOverlays(a, { points: [{ id: 'b', tone: 'record', x: 3, y: 4 }], vlines: [{ id: 'r', tone: 'reference', value: 5 }] })!
    expect(m.points!.map((p) => p.id)).toEqual(['a', 'b'])
    expect(m.vlines!.length).toBe(1)
  })

  it('라벨 덮개 색: 두 테마 모두 모든 종류, 기준·시간 커서는 현재 커서와 같은 파랑 점선, 빨강(게이트) 없음', () => {
    for (const theme of ['light', 'dark'] as const) {
      const c = C.labelOverlayColors(theme)
      for (const t of ['draft', 'ghost', 'record', 'selected', 'positive', 'weak', 'ignore', 'echo', 'reviewed', 'quality', 'below', 'reference', 'time']) {
        expect(c[t], t).toBeTruthy()
        expect(c[t]!.stroke.toLowerCase()).not.toBe('#e03030')
      }
      expect(c['reference']).toEqual({ stroke: '#2f5bff', fill: null, dashed: true })
      expect(c['time']!.stroke).toBe('#2f5bff')
      expect(c['draft']!.dashed).toBe(true)
      expect(c['record']!.dashed).toBe(false)
    }
  })
})

describe('mm → px 위치 (±1 px)', () => {
  const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(1)

  it('S-scan: 상자·점이 viewportPixel 자리에 (CSS 446×247 · 버퍼 892×494)', () => {
    const vp: SscanViewport = { vMinMm: -31.2, vMaxMm: 34.3, depthMinMm: 3.55, depthMaxMm: 50.99, width: 892, height: 494 }
    const axes = { x: { from: vp.vMinMm, to: vp.vMaxMm }, y: { from: vp.depthMinMm, to: vp.depthMaxMm } }
    const map: Map2 = { x: (v) => viewToPx(axes, v, 0, vp.width, vp.height).x, y: (d) => viewToPx(axes, 0, d, vp.width, vp.height).y, width: vp.width, height: vp.height }
    const { ctx, calls } = recorder()
    O.drawOverlay(ctx, { rects: [{ id: 'r', tone: 'record', x0: -5, x1: 8.1, y0: 17.8, y1: 27.3 }], points: [{ id: 'p', tone: 'draft', x: 1.2, y: 22.5 }] }, map, STYLES, 2)
    const rect = calls.find((c) => c[0] === 'rect') as [string, number, number, number, number]
    const a = viewportPixel(vp, -5, 17.8)
    const b = viewportPixel(vp, 8.1, 27.3)
    near(rect[1], a.x)
    near(rect[2], a.y)
    near(rect[1] + rect[3], b.x)
    near(rect[2] + rect[4], b.y)
    // 십자 점: 가로선 가운데 y = 점 y, 세로선 가운데 x = 점 x
    const p = viewportPixel(vp, 1.2, 22.5)
    const moves = calls.filter((c) => c[0] === 'moveTo') as Array<[string, number, number]>
    const lines = calls.filter((c) => c[0] === 'lineTo') as Array<[string, number, number]>
    const r = O.OVERLAY_POINT_R * 2
    near(moves[0]![1], p.x - r)
    near(moves[0]![2], p.y)
    near(lines[0]![1], p.x + r)
    near(moves[1]![1], p.x)
    near(moves[1]![2], p.y - r)
    // 상태 저장·복원으로 감싼다 (뒤 그리기에 선 굵기·점선이 새지 않게)
    expect(calls[0]![0]).toBe('save')
    expect(calls[calls.length - 1]![0]).toBe('restore')
  })

  it('C-scan: 기준 커서 R 세로선·빔 가로선·검토 띠가 cscanXForScan·cscanYForBeam 자리 (뒤집힘 포함)', () => {
    const scan = { offsetMm: 0, resolutionMm: 1, count: 301 }
    const [W, H, nb] = [1904, 242, 31]
    for (const reversed of [true, false]) {
      for (const [k0, k1] of [
        [0, 301],
        [100, 201]
      ] as const) {
        const ax = { x: scanViewAxis(scan, k0, k1), y: cscanBeamViewAxis(nb, reversed) }
        const map: Map2 = { x: (v) => viewToPx(ax, v, 0, W, H).x, y: (b) => viewToPx(ax, 0, b, W, H).y, width: W, height: H }
        const { ctx, calls } = recorder()
        O.drawOverlay(
          ctx,
          {
            vlines: [{ id: 'ref', tone: 'reference', value: scanPositionMm(150, scan) }],
            hlines: [{ id: 'ref-beam', tone: 'reference', value: 14 }],
            rects: [{ id: 'review', tone: 'reviewed', x0: scanPositionMm(120, scan), x1: scanPositionMm(130, scan), y0: null, y1: null }]
          },
          map,
          STYLES,
          2
        )
        const moves = calls.filter((c) => c[0] === 'moveTo') as Array<[string, number, number]>
        // 띠: 왼쪽·오른쪽 세로선 (위·아래는 열림)
        near(moves[0]![1], cscanXForScan(120, W, k0, k1))
        near(moves[1]![1], cscanXForScan(130, W, k0, k1))
        expect(moves[0]![2]).toBe(0)
        // R 세로선 (반 픽셀 맞춤), 빔 가로선
        near(moves[2]![1], cscanXForScan(150, W, k0, k1))
        near(moves[3]![2], cscanYForBeam(14, H, nb, reversed))
        // 띠 채움 (reviewed 는 채움 있음) 이 선보다 먼저
        const fillAt = calls.findIndex((c) => c[0] === 'fill')
        const strokeAt = calls.findIndex((c) => c[0] === 'stroke')
        expect(fillAt).toBeGreaterThan(-1)
        expect(fillAt).toBeLessThan(strokeAt)
      }
    }
  })

  it('A-scan 시간 커서 가로선 = AscanView Y() 자리', () => {
    const range = { startMm: 2.83, endMm: 39.6 }
    const map: Map2 = { x: (p) => (p / 100) * 344, y: (d) => depthToY(range, d, 1062), width: 344, height: 1062 }
    const { ctx, calls } = recorder()
    O.drawOverlay(ctx, { hlines: [{ id: 'time', tone: 'time', value: 17.74 }] }, map, STYLES, 2)
    const m = calls.find((c) => c[0] === 'moveTo') as [string, number, number]
    near(m[2], ((17.74 - 2.83) / (39.6 - 2.83)) * 1062)
    expect(m[1]).toBe(0)
    expect((calls.find((c) => c[0] === 'lineTo') as [string, number, number])[1]).toBe(344)
  })
})

describe('초안 → 뷰별 덮개', () => {
  const g0 = synthGroup(90, 0)
  const g1 = synthGroup(270, 1)
  const ctxOf = (k: Record<number, number>, b: Record<number, number>, active = 0) => ({
    groupIds: [0, 1],
    activeGroupId: active,
    scanIndexOf: (id: number) => k[id] ?? 0,
    beamOf: (id: number) => b[id] ?? 0,
    beamPointOf: (id: number, beam: number, depth: number) => {
      const g = id === 0 ? g0 : g1
      const bm = g.beams[beam]!
      const i = (((2 * (depth / Math.cos((bm.angleDeg * Math.PI) / 180))) / (bm.velocityMps * 1e-3)) - bm.t0Us) / g.ultrasound.resolutionUs
      const p = samplePoint(bm, i, g.ultrasound)
      return { vMm: p.vMm, depthMm: p.depthMm }
    }
  })
  const point = (over: Record<string, unknown> = {}) => ({ role: 'peak', groupId: 0, scanIndex: 2, scanMm: 2, vMm: 1, unfoldedDepthMm: 20, beam: 14.4, sample: 400, displayGainDb: 0, ...over })

  it('라벨 모드가 꺼져 있으면 빈 덮개', () => {
    let s = S.initialLabelState()
    s = S.labelReducer(s, { type: 'addPoint', point: point() })
    const d = D.draftOverlays(s, ctxOf({ 0: 2, 1: 2 }, { 0: 14, 1: 14 }))
    expect(d).toEqual({ sscan: {}, cscan: {}, bscan: {}, ascan: {} })
  })

  it('지금 칸의 점·사각형은 초안(고른 점은 selected), 다른 칸은 흐리게(ghost) · R · 검토 구간 · 시간 커서', () => {
    let s = S.labelReducer(S.initialLabelState(), { type: 'setMode', on: true })
    s = S.labelReducer(s, { type: 'addPoint', point: point() })
    s = S.labelReducer(s, { type: 'addPoint', point: point({ role: 'tip-top', scanIndex: 3, scanMm: 3, unfoldedDepthMm: 18, beam: 14 }) })
    s = S.labelReducer(s, { type: 'setRect', rect: { groupId: 0, scanIndex: 2, scanMm: 2, vMinMm: -1, vMaxMm: 3, depthMinMm: 17, depthMaxMm: 23, displayGainDb: 0 } })
    s = S.labelReducer(s, { type: 'setRef', ref: { groupId: 1, scanMm: 1, beam: 9 } })
    s = S.labelReducer(s, { type: 'setReview', review: { groupId: 0, scanStartMm: 1, scanEndMm: 4 } })
    s = S.labelReducer(s, { type: 'setTimeCursor', cursor: { groupId: 0, beam: 14, depthMm: 21 } })
    s = S.labelReducer(s, { type: 'select', id: 'p1' })
    const d = D.draftOverlays(s, ctxOf({ 0: 2, 1: 2 }, { 0: 14, 1: 10 }))
    // S-scan 그룹 0: p1(지금 칸, 고름) · p2(다른 칸 → ghost) · 시간 커서 점, 사각형(지금 칸, 고르지 않음)
    const sp = d.sscan[0]!.points!
    expect(sp.map((p) => [p.id, p.tone, p.shape])).toEqual([
      ['p1', 'selected', 'circle'],
      ['p2', 'ghost', 'diamond'],
      ['time', 'time', 'diamond']
    ])
    expect(sp[0]).toMatchObject({ x: 1, y: 20, label: '최대' })
    // 시간 커서 점 = 빔 14 위 펼친 깊이 21 mm
    expect(sp[2]!.y).toBeCloseTo(21, 6)
    expect(d.sscan[0]!.rects).toEqual([{ id: 'rect', tone: 'draft', x0: -1, x1: 3, y0: 17, y1: 23 }])
    expect(d.sscan[1]!.points).toEqual([])
    // C-scan: 점(스캔 mm × 빔 실수), R 세로선은 두 그룹 모두, 빔 가로선은 R 의 그룹(1)만, 검토 띠는 그룹 0만
    expect(d.cscan[0]!.points!.map((p) => [p.id, p.x, p.y])).toEqual([
      ['p1', 2, 14.4],
      ['p2', 3, 14]
    ])
    expect(d.cscan[0]!.vlines).toEqual([{ id: 'ref', tone: 'reference', value: 1, label: 'R' }])
    expect(d.cscan[1]!.vlines!.length).toBe(1)
    expect(d.cscan[0]!.hlines).toEqual([])
    expect(d.cscan[1]!.hlines).toEqual([{ id: 'ref-beam', tone: 'reference', value: 9 }])
    expect(d.cscan[0]!.rects).toEqual([{ id: 'review', tone: 'draft', x0: 1, x1: 4, y0: null, y1: null }])
    expect(d.cscan[1]!.rects).toEqual([])
    // B-scan (활성 그룹 0·빔 14): p1(빔 14.4 → 14) 은 초안, p2(빔 14) 도 같은 빔 · R · 검토 · 시간 커서
    expect(d.bscan.points!.map((p) => [p.id, p.tone, p.x, p.y])).toEqual([
      ['p1', 'selected', 2, 20],
      ['p2', 'draft', 3, 18]
    ])
    expect(d.bscan.hlines).toEqual([{ id: 'time', tone: 'time', value: 21 }])
    // A-scan: 이 칸(2)·이 빔(14) 의 점 깊이와 시간 커서
    expect(d.ascan.hlines!.map((l) => [l.id, l.value])).toEqual([
      ['p1', 20],
      ['time', 21]
    ])
    // 다른 빔이면 B-scan 점은 흐리게, 시간 커서는 없음
    const d2 = D.draftOverlays(s, ctxOf({ 0: 2, 1: 2 }, { 0: 20, 1: 10 }))
    expect(d2.bscan.points!.map((p) => p.tone)).toEqual(['ghost', 'ghost'])
    expect(d2.bscan.hlines).toEqual([])
    expect(d2.ascan.hlines).toEqual([])
  })
})

describe('읽기값 (파일 이득 0 dB) · 초안 → 기록 칸', () => {
  const g = synthGroup(90, 0)
  const vol = synthVolume(g)

  it('S-scan 점 읽기 = 조회 진폭(파일 ampScale)·접은 깊이·레그, 데이터 없음 칸은 null', () => {
    const v = 2.5
    const d = 20
    const r = RD.sscanPointReading(g, vol, 2, v, d, 12)
    const raw = sscanRawAt(sscanLookupAt(g, v, d)!, vol, g.shape, 2)!
    expect(r.amplitudePct).toBeCloseTo(rawToPercent(raw, g.ampScale), 9)
    expect(r.depthMm).toBeCloseTo(foldDepth(d, 12).depthMm, 9)
    expect(r.leg).toBe(2)
    expect(r.unfoldedDepthMm).toBe(d)
    expect(r.scanMm).toBe(2)
    expect(r.nearestBeam).toBe(Math.round(r.beam))
    expect(r.angleDeg).toBeGreaterThan(40)
    expect(RD.sscanPointReading(g, vol, 2, -300, 20, 12)).toBeNull()
    // 볼륨이 없으면 위치만
    expect(RD.sscanPointReading(g, null, 2, v, d, 12).amplitudePct).toBeNull()
  })

  it('A-scan 시간 커서 읽기: 샘플 자리에서는 그 샘플 진폭, 포화는 파일 상한에서', () => {
    const b = 14
    const i = 300
    const p = samplePoint(g.beams[b]!, i, g.ultrasound)
    const r = RD.ascanDepthReading(g, vol, 0, b, p.depthMm, 12)
    const [, nb, nt] = g.shape
    expect(r.sample).toBeCloseTo(i, 6)
    expect(r.amplitudePct).toBeCloseTo(rawToPercent(vol.amplitude[(0 * nb + b) * nt + i]!, g.ampScale), 3)
    expect(r.vMm).toBeCloseTo(p.vMm, 6)
    // 포화: 상한(32767 → 200 %)
    const sat = { amplitude: new Int16Array(vol.amplitude.length).fill(32767), status: null }
    expect(RD.ascanDepthReading(g, sat, 0, b, p.depthMm, 12).saturated).toBe(true)
    expect(RD.ascanDepthReading(g, vol, 0, b, 1000, 12)).toBeNull()
    // 데이터 없음 칸 (스캔 1, 빔 3)
    expect(RD.ascanDepthReading(g, vol, 1, 3, p.depthMm, 12).amplitudePct).toBeNull()
  })

  it('점 → AnchorPoint (앵커·좌표 규칙 버전·그때 대조 여부·접은 깊이), 사각형 → rect-a·rect-b, 검토 구간 → 칸', () => {
    const ap = CV.toAnchorPoint({ id: 'p3', role: 'tip-top', groupId: 0, scanIndex: 39, scanMm: 39, vMm: 1.5, unfoldedDepthMm: 14, beam: 14.2, sample: 401.5, displayGainDb: 6 }, { verified: false }, 12)
    expect(ap).toEqual({
      id: 'p3',
      role: 'tip-top',
      anchor: { groupId: 0, scanIndex: 39, beam: 14.2, sample: 401.5, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: false },
      leg: 2,
      displayGainDb: 6,
      mm: { scanMm: 39, vMm: 1.5, depthMm: 10 }
    })
    const pts = CV.rectToAnchorPoints({ groupId: 0, scanIndex: 2, scanMm: 2, vMinMm: -2, vMaxMm: 4, depthMinMm: 16, depthMaxMm: 24, displayGainDb: 0 }, g, 12, ['p5', 'p6'])
    expect(pts.map((p) => [p.id, p.role])).toEqual([
      ['p5', 'rect-a'],
      ['p6', 'rect-b']
    ])
    expect(pts[0].mm).toEqual({ scanMm: 2, vMm: -2, depthMm: 8 })
    // 부채꼴 밖 모서리는 부채꼴 안으로 당긴다 (역할·id 는 자리 그대로)
    const far = CV.rectToAnchorPoints({ groupId: 0, scanIndex: 2, scanMm: 2, vMinMm: -300, vMaxMm: 4, depthMinMm: 16, depthMaxMm: 24, displayGainDb: 0 }, g, 12, ['a', 'b'])
    expect(far.map((p) => [p.id, p.role])).toEqual([
      ['a', 'rect-a'],
      ['b', 'rect-b']
    ])
    expect(far[0].mm.vMm).toBeGreaterThan(-300)
    expect(CV.reviewSpanOf({ groupId: null, scanStartMm: 9, scanEndMm: 3 })).toEqual({ groupId: null, scanStartMm: 3, scanEndMm: 9 })
  })
})
