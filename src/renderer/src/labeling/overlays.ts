/**
 * 라벨 초안(state.ts) → 뷰별 덮개 (viewer/overlay.ts ViewOverlay, 뷰 축 단위) — 순수.
 *   S-scan (그룹마다, 그 스캔 칸): 찍은 점 · 사각형 · 시간 커서 점. 다른 스캔 칸에서 찍은 것은 흐린 점선(ghost)
 *   C-scan (그룹마다): 점(스캔 × 빔) · 기준 커서 R(세로 점선 = 모든 그룹, 가로 점선 = R 의 그룹) · 검토 구간 초안
 *   B-scan (활성 그룹·현재 빔): 점(스캔 × 펼친 깊이, 다른 빔은 흐리게) · R · 검토 구간 · 시간 커서
 *   A-scan (활성 그룹·현재 빔): 시간 커서 · 이 칸·빔에 찍은 점의 깊이
 * 패널이 만든 덮개(저장한 기록·형상 에코·검토 구간 등)는 LabelViewOverlays 로 따로 오고 NdeViewer 가 mergeOverlays 로 합친다.
 */
import type { AnchorRole } from '@shared/labels'
import type { OverlayLine, OverlayPoint, OverlayRect, ViewOverlay } from '../viewer/overlay'
import type { LabelDraftPoint, LabelState } from './state'

/** 점 역할 → 영상 위 짧은 글자 (12 px) */
export const ROLE_SHORT: Readonly<Record<AnchorRole, string>> = {
  peak: '최대',
  'tip-top': '위 팁',
  'tip-bottom': '아래 팁',
  tip: '팁',
  surface: '표면',
  'drop-top': '−6 위',
  'drop-bottom': '−6 아래',
  'length-start': '시작',
  'length-end': '끝',
  'rect-a': 'A',
  'rect-b': 'B',
  other: '점'
}

function isLengthRole(role: AnchorRole): boolean {
  return role === 'length-start' || role === 'length-end'
}

function shapeOf(role: AnchorRole): OverlayPoint['shape'] {
  if (role === 'peak') return 'circle'
  if (role === 'tip-top' || role === 'tip-bottom' || role === 'tip') return 'diamond'
  return 'cross'
}

/** 덮개를 만들 때 필요한 뷰 상태 */
export interface DraftOverlayContext {
  /** 보이는 그룹 */
  groupIds: readonly number[]
  activeGroupId: number
  /** 그룹 id → 지금 스캔 칸·빔 */
  scanIndexOf: (groupId: number) => number
  beamOf: (groupId: number) => number
  /** 그룹 id → 빔 b 의 펼친 깊이 d 점 (V, 깊이). 시간 커서를 S-scan 에 찍을 때 */
  beamPointOf: (groupId: number, beam: number, depthMm: number) => { vMm: number; depthMm: number } | null
}

export interface DraftOverlays {
  sscan: Record<number, ViewOverlay>
  cscan: Record<number, ViewOverlay>
  bscan: ViewOverlay
  ascan: ViewOverlay
}

function tone(s: LabelState, p: LabelDraftPoint, here: boolean): OverlayPoint['tone'] {
  if (!here) return 'ghost'
  return s.ui.selectedId === p.id ? 'selected' : 'draft'
}

/** 초안 → 뷰별 덮개. 라벨 모드가 꺼져 있으면 빈 덮개 (그리지 않음) */
export function draftOverlays(s: LabelState, ctx: DraftOverlayContext): DraftOverlays {
  const out: DraftOverlays = { sscan: {}, cscan: {}, bscan: {}, ascan: {} }
  if (!s.ui.on) return out
  const { draft } = s
  const tc = s.ui.timeCursor

  for (const g of ctx.groupIds) {
    const k = ctx.scanIndexOf(g)
    // S-scan
    const sPoints: OverlayPoint[] = []
    const sRects: OverlayRect[] = []
    for (const p of draft.points) {
      // 길이 시작·끝은 C/B-scan 표시 (S-scan 에서는 단면 기준점과 같은 자리라 겹친다)
      if (p.groupId !== g || isLengthRole(p.role)) continue
      sPoints.push({ id: p.id, tone: tone(s, p, p.scanIndex === k), x: p.vMm, y: p.unfoldedDepthMm, shape: shapeOf(p.role), label: ROLE_SHORT[p.role] })
    }
    const r = draft.rect
    if (r && r.groupId === g) {
      const here = r.scanIndex === k
      sRects.push({ id: 'rect', tone: here ? (s.ui.selectedId === 'rect' ? 'selected' : 'draft') : 'ghost', x0: r.vMinMm, x1: r.vMaxMm, y0: r.depthMinMm, y1: r.depthMaxMm })
    }
    if (tc && tc.groupId === g) {
      const p = ctx.beamPointOf(g, tc.beam, tc.depthMm)
      if (p) sPoints.push({ id: 'time', tone: 'time', x: p.vMm, y: p.depthMm, shape: 'diamond' })
    }
    out.sscan[g] = { rects: sRects, points: sPoints }

    // C-scan
    const cPoints: OverlayPoint[] = []
    const cRects: OverlayRect[] = []
    const cV: OverlayLine[] = []
    const cH: OverlayLine[] = []
    for (const p of draft.points) {
      if (p.groupId !== g) continue
      // 길이 점은 잰 빔(C-scan 한 행)에 (앵커 빔은 단면 기준점과 같음 — record.ts)
      cPoints.push({ id: p.id, tone: s.ui.selectedId === p.id ? 'selected' : 'draft', x: p.scanMm, y: p.measuredBeam ?? p.beam, shape: shapeOf(p.role) })
    }
    if (draft.ref) {
      cV.push({ id: 'ref', tone: 'reference', value: draft.ref.scanMm, label: 'R' })
      if (draft.ref.groupId === g) cH.push({ id: 'ref-beam', tone: 'reference', value: draft.ref.beam })
    }
    const rv = draft.review
    if (rv && (rv.groupId === null || rv.groupId === g)) cRects.push({ id: 'review', tone: 'draft', x0: rv.scanStartMm, x1: rv.scanEndMm, y0: null, y1: null })
    out.cscan[g] = { rects: cRects, points: cPoints, vlines: cV, hlines: cH }
  }

  // B-scan · A-scan (활성 그룹·현재 빔)
  const a = ctx.activeGroupId
  const b = ctx.beamOf(a)
  const k = ctx.scanIndexOf(a)
  const bPoints: OverlayPoint[] = []
  const bV: OverlayLine[] = []
  const bH: OverlayLine[] = []
  const bRects: OverlayRect[] = []
  const aH: OverlayLine[] = []
  for (const p of draft.points) {
    if (p.groupId !== a) continue
    const onBeam = Math.round(p.measuredBeam ?? p.beam) === b
    bPoints.push({ id: p.id, tone: onBeam ? (s.ui.selectedId === p.id ? 'selected' : 'draft') : 'ghost', x: p.scanMm, y: p.unfoldedDepthMm, shape: shapeOf(p.role) })
    if (onBeam && p.scanIndex === k && !isLengthRole(p.role)) aH.push({ id: p.id, tone: s.ui.selectedId === p.id ? 'selected' : 'draft', value: p.unfoldedDepthMm, label: ROLE_SHORT[p.role] })
  }
  if (draft.ref) bV.push({ id: 'ref', tone: 'reference', value: draft.ref.scanMm, label: 'R' })
  const rv = draft.review
  if (rv && (rv.groupId === null || rv.groupId === a)) bRects.push({ id: 'review', tone: 'draft', x0: rv.scanStartMm, x1: rv.scanEndMm, y0: null, y1: null })
  if (tc && tc.groupId === a && tc.beam === b) {
    bH.push({ id: 'time', tone: 'time', value: tc.depthMm })
    aH.push({ id: 'time', tone: 'time', value: tc.depthMm })
  }
  out.bscan = { rects: bRects, points: bPoints, vlines: bV, hlines: bH }
  out.ascan = { hlines: aH }
  return out
}
