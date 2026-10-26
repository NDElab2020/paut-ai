/**
 * 저장한 기록·검토 구간·형상 에코 후보·장면 미리보기 → 뷰별 덮개 (LabelViewOverlays, 뷰 축 단위) — 순수.
 * 초안 덮개(overlays.ts)는 뷰어가 따로 그리고 이것과 합친다.
 *   S-scan (그룹마다, 지금 스캔 칸): 기록 영역(V × 실제 깊이)을 펼친 그림의 레그마다 사각형 — 그 그룹에 찍은 점의 레그는 기록 색,
 *     점이 없는 레그(엑셀 기록·다른 그룹에서 찍은 기록)는 흐린 점선(1·2레그). 그 칸에서 찍은 점(팁·최대 진폭).
 *     형상 에코 후보(펼쳤을 때)는 자리 단면을 그 레그에, 장면 미리보기는 그 장면 객체 상자(양성·약한 양성).
 *   C-scan (그룹마다): 기록 = 스캔 범위 × 찍은 빔 범위(점이 없으면 모든 빔), 번호 글자. 검토 구간 = 끝 빔 두 줄 띠(종류별 색 — 영상 전체를 칠하지 않음).
 *     형상 에코 후보 = 스캔 범위 × 형상 빔. 장면 미리보기 = 첫 빔 줄에 장면 상태 띠 + C-scan 상자.
 *   B-scan (활성 그룹·현재 빔): 기록 = 스캔 범위 × 펼친 깊이(레그마다), 검토 구간 시작·끝 세로선.
 * 같은 입력이면 같은 내용 — 패널이 useMemo 로 객체를 고정한다.
 */
import type { ViewerGroup } from '@shared/imaging'
import { unfoldDepth, type DerivedFileLabels, type EchoCandidate, type IndicationRecord, type ReviewInterval, type SceneState } from '@shared/labels'
import type { OverlayLine, OverlayPoint, OverlayRect, OverlayTone, ViewOverlay } from '../viewer/overlay'
import type { LabelViewOverlays } from './types'

export interface RecordOverlayInput {
  records: readonly IndicationRecord[]
  reviews: readonly ReviewInterval[]
  /** 지시 번호 (record.ts recordNumbers — 고정 번호 또는 순서 번호) */
  numbers: ReadonlyMap<string, string>
  selectedUuid: string | null
  /** 고치는 기록은 초안이 대신 보이므로 그리지 않는다 */
  editingUuid: string | null
  /** 보이는 그룹 */
  groups: readonly ViewerGroup[]
  activeGroupId: number
  scanIndexOf: (groupId: number) => number
  beamOf: (groupId: number) => number
  thicknessMm: number | null
  /** 펼쳤을 때만 */
  echoCandidates?: readonly EchoCandidate[] | null
  /** 켰을 때만 */
  preview?: DerivedFileLabels | null
}

const MAX_LEG = 4

/** 검토 구간 종류 → 덮개 색 */
const REVIEW_TONE: Record<ReviewInterval['kind'], OverlayTone> = { reviewed: 'reviewed', 'quality-bad': 'quality', 'below-threshold': 'below' }
const REVIEW_SHORT: Record<ReviewInterval['kind'], string> = { reviewed: '검토', 'quality-bad': '품질', 'below-threshold': '기준 미만' }
/** 장면 상태 → 덮개 색 (음성 = 검토 완료 띠 색) */
const SCENE_TONE: Partial<Record<SceneState, OverlayTone>> = { positive: 'positive', weak: 'weak', ignore: 'ignore', negative: 'reviewed' }

function recordTone(r: IndicationRecord, selected: boolean): OverlayTone {
  if (selected) return 'selected'
  return r.kind === 'geometric-echo' ? 'echo' : 'record'
}

/** 기록이 그 그룹에 찍은 점의 레그 (없으면 빈 목록) */
function drawnLegs(r: IndicationRecord, groupId: number): number[] {
  const s = new Set<number>()
  for (const p of r.anchors) if (p.anchor.groupId === groupId && p.leg !== null && p.role !== 'length-start' && p.role !== 'length-end') s.add(p.leg)
  return [...s].sort((a, b) => a - b)
}

/** 그 그룹이 기록과 관계있나 (찍은 점·최대 진폭·길이 그룹, 엑셀 기록은 모든 그룹) */
function touches(r: IndicationRecord, groupId: number): boolean {
  if (r.anchors.some((p) => p.anchor.groupId === groupId)) return true
  if (r.signal.peak?.groupId === groupId || r.length.groupId === groupId) return true
  return r.anchors.length === 0 && r.signal.peak?.groupId == null
}

/** 스캔 칸 k 가 기록 범위 안인가 (칸 반 폭 여유) */
function inScan(r: Pick<IndicationRecord, 'derived'>, g: ViewerGroup, k: number): boolean {
  const u = g.scan.offsetMm + k * g.scan.resolutionMm
  const h = Math.abs(g.scan.resolutionMm) / 2
  return u >= Math.min(r.derived.scanStartMm, r.derived.scanEndMm) - h && u <= Math.max(r.derived.scanStartMm, r.derived.scanEndMm) + h
}

/** 영역(실제 깊이 위·아래)을 레그 L 의 펼친 깊이 범위로 */
function legRange(top: number, bottom: number, L: number, t: number): [number, number] {
  const a = unfoldDepth(top, L, t)
  const b = unfoldDepth(bottom, L, t)
  return [Math.min(a, b), Math.max(a, b)]
}

/** 스캔 범위 (폭이 0 이면 칸 반 폭씩 넓힌다) */
function scanSpan(a: number, b: number, g: ViewerGroup): [number, number] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const h = Math.abs(g.scan.resolutionMm) / 2
  return hi - lo < 1e-9 ? [lo - h, hi + h] : [lo, hi]
}

export function recordOverlays(x: RecordOverlayInput): LabelViewOverlays | null {
  const t = x.thicknessMm !== null && x.thicknessMm > 0 ? x.thicknessMm : null
  const live = x.records.filter((r) => !r.deleted && r.uuid !== x.editingUuid)
  const reviews = x.reviews.filter((v) => !v.deleted && !v.released)
  const sscan: Record<number, ViewOverlay> = {}
  const cscan: Record<number, ViewOverlay> = {}
  let any = false

  for (const g of x.groups) {
    const k = x.scanIndexOf(g.id)
    const sRects: OverlayRect[] = []
    const sPoints: OverlayPoint[] = []
    const cRects: OverlayRect[] = []
    const cLines: OverlayLine[] = []
    const cHLines: OverlayLine[] = []

    // 검토 구간: C-scan 끝 빔 두 줄 띠 (영상 전체를 칠하면 C-scan 색이 흐려지므로 가장자리 띠만)
    const nb = g.beams.length
    for (const v of reviews) {
      if (v.groupId !== null && v.groupId !== g.id) continue
      cRects.push({ id: `rv-${v.uuid}`, tone: REVIEW_TONE[v.kind], x0: v.scanStartMm, x1: v.scanEndMm, y0: nb - 2.5, y1: nb - 0.5 })
    }

    // 장면 미리보기 (C-scan 첫 빔 줄 띠 + 상자, S-scan 객체 상자)
    if (x.preview) {
      const scenes = x.preview.scenes.filter((s) => s.groupId === g.id)
      let run: { state: SceneState; k0: number; k1: number } | null = null
      const flush = (): void => {
        if (!run) return
        const tone = SCENE_TONE[run.state]
        if (tone) {
          const h = Math.abs(g.scan.resolutionMm) / 2
          const u0 = g.scan.offsetMm + run.k0 * g.scan.resolutionMm
          const u1 = g.scan.offsetMm + run.k1 * g.scan.resolutionMm
          cRects.push({ id: `sc-${run.k0}`, tone, x0: Math.min(u0, u1) - h, x1: Math.max(u0, u1) + h, y0: -0.5, y1: 0.5 })
        }
        run = null
      }
      for (const s of scenes) {
        const st = s.trainState
        if (run && run.state === st && s.scanIndex === run.k1 + 1) run.k1 = s.scanIndex
        else {
          flush()
          run = { state: st, k0: s.scanIndex, k1: s.scanIndex }
        }
      }
      flush()
      for (const rec of x.preview.records) {
        for (const b of rec.cscanBoxes) {
          if (b.groupId !== g.id) continue
          cRects.push({ id: `cb-${b.recordUuid}`, tone: b.status === 'positive' ? 'positive' : 'weak', x0: b.scanStartMm, x1: b.scanEndMm, y0: b.beamMin - 0.5, y1: b.beamMax + 0.5 })
        }
      }
      const here = scenes.find((s) => s.scanIndex === k)
      for (const o of here?.objects ?? []) {
        if (!o.box) continue
        sRects.push({
          id: `sb-${o.recordUuid}-${o.leg}`,
          tone: o.status === 'positive' ? 'positive' : o.status === 'weak' ? 'weak' : 'ignore',
          x0: o.box.vMinMm,
          x1: o.box.vMaxMm,
          y0: o.box.depthMinMm,
          y1: o.box.depthMaxMm,
          label: o.status === 'positive' ? '양성' : o.status === 'weak' ? '약한 양성' : undefined
        })
      }
    }

    // 형상 에코 후보
    for (const c of x.echoCandidates ?? []) {
      if (c.groupId !== g.id) continue
      const beams = c.beams.length ? c.beams : [c.peakBeam]
      cRects.push({ id: `ec-${c.id}`, tone: 'echo', x0: c.scanStartMm, x1: c.scanEndMm, y0: Math.min(...beams) - 0.5, y1: Math.max(...beams) + 0.5, label: '후보' })
      const u = g.scan.offsetMm + k * g.scan.resolutionMm
      if (t !== null && u >= c.scanStartMm - 1e-9 && u <= c.scanEndMm + 1e-9) {
        const [d0, d1] = legRange(c.section.depthTopMm, c.section.depthBottomMm, c.leg, t)
        sRects.push({ id: `es-${c.id}`, tone: 'echo', x0: c.section.vMinMm, x1: c.section.vMaxMm, y0: d0, y1: d1, label: '후보' })
      }
    }

    // 기록
    for (const r of live) {
      if (!touches(r, g.id)) continue
      const sel = r.uuid === x.selectedUuid
      const tone = recordTone(r, sel)
      const n = x.numbers.get(r.uuid)
      const label = n !== undefined ? `#${n}` : undefined
      // C-scan: 스캔 범위 × 찍은 빔 범위 (점이 없으면 모든 빔)
      const beams = r.anchors.filter((p) => p.anchor.groupId === g.id && p.role !== 'length-start' && p.role !== 'length-end').map((p) => p.anchor.beam)
      if (r.length.groupId === g.id && r.length.beam !== null) beams.push(r.length.beam)
      // 앱이 승인한 형상 에코 등 점이 없는 기록: 최대 진폭 빔 ± 2
      if (beams.length === 0 && r.signal.peak?.groupId === g.id && r.signal.peak.beam !== null) beams.push(r.signal.peak.beam - 2, r.signal.peak.beam + 2)
      const [s0, s1] = scanSpan(r.derived.scanStartMm, r.derived.scanEndMm, g)
      if (beams.length) {
        cRects.push({ id: `r-${r.uuid}`, tone, x0: s0, x1: s1, y0: Math.max(-0.5, Math.min(...beams) - 0.5), y1: Math.min(g.beams.length - 0.5, Math.max(...beams) + 0.5), label })
      } else {
        // 빔을 모르는 기록(엑셀): 영상을 칠하지 않고 시작·끝 세로선만
        const lt: OverlayTone = sel ? 'selected' : r.kind === 'geometric-echo' ? 'echo' : 'ghost'
        cLines.push({ id: `r0-${r.uuid}`, tone: lt, value: s0, label }, { id: `r1-${r.uuid}`, tone: lt, value: s1 })
      }
      if (sel && r.length.groupId === g.id && r.length.beam !== null) cHLines.push({ id: `rl-${r.uuid}`, tone: 'selected', value: r.length.beam, from: s0, to: s1 })
      // S-scan: 지금 칸이 기록 범위 안이면 영역 사각형 (레그마다)
      if (t !== null && inScan(r, g, k) && r.derived.depthTopMm !== null && r.derived.depthBottomMm !== null) {
        const legs = drawnLegs(r, g.id)
        const list = legs.length ? legs : [1, 2]
        list.forEach((L, i) => {
          if (L > MAX_LEG) return
          const [d0, d1] = legRange(r.derived.depthTopMm!, r.derived.depthBottomMm!, L, t)
          // 번호 글자는 첫 레그 상자에만 (겹쳐 쓰지 않게)
          sRects.push({ id: `rs-${r.uuid}-${L}`, tone: legs.length ? tone : sel ? 'selected' : 'ghost', x0: r.derived.vMinMm, x1: r.derived.vMaxMm, y0: d0, y1: d1, ...(i === 0 && label ? { label } : {}) })
        })
      }
      // S-scan: 이 칸에서 찍은 점
      for (const p of r.anchors) {
        if (p.anchor.groupId !== g.id || Math.round(p.anchor.scanIndex) !== k || !p.mm || p.role === 'length-start' || p.role === 'length-end' || p.role === 'rect-a' || p.role === 'rect-b') continue
        const y = p.leg !== null && t !== null ? unfoldDepth(p.mm.depthMm, p.leg, t) : p.mm.depthMm
        sPoints.push({ id: `rp-${r.uuid}-${p.id}`, tone, x: p.mm.vMm, y, shape: p.role === 'peak' ? 'circle' : p.role.startsWith('tip') ? 'diamond' : 'cross' })
      }
    }

    if (sRects.length || sPoints.length) {
      sscan[g.id] = { rects: sRects, points: sPoints }
      any = true
    }
    if (cRects.length || cLines.length || cHLines.length) {
      cscan[g.id] = { rects: cRects, vlines: cLines, hlines: cHLines }
      any = true
    }
  }

  // B-scan (활성 그룹·현재 빔)
  const a = x.groups.find((g) => g.id === x.activeGroupId)
  const bRects: OverlayRect[] = []
  const bLines: OverlayLine[] = []
  if (a) {
    // 검토 구간: B-scan 은 시작·끝 세로선만
    for (const v of reviews) {
      if (v.groupId !== null && v.groupId !== a.id) continue
      bLines.push({ id: `rv0-${v.uuid}`, tone: REVIEW_TONE[v.kind], value: v.scanStartMm, label: REVIEW_SHORT[v.kind] }, { id: `rv1-${v.uuid}`, tone: REVIEW_TONE[v.kind], value: v.scanEndMm })
    }
    if (t !== null) {
      for (const r of live) {
        if (!touches(r, a.id) || r.derived.depthTopMm === null || r.derived.depthBottomMm === null) continue
        const sel = r.uuid === x.selectedUuid
        const legs = drawnLegs(r, a.id)
        const [s0, s1] = scanSpan(r.derived.scanStartMm, r.derived.scanEndMm, a)
        const n = x.numbers.get(r.uuid)
        for (const L of legs.length ? legs : [1, 2]) {
          const [d0, d1] = legRange(r.derived.depthTopMm, r.derived.depthBottomMm, L, t)
          bRects.push({ id: `rb-${r.uuid}-${L}`, tone: legs.length ? recordTone(r, sel) : 'ghost', x0: s0, x1: s1, y0: d0, y1: d1, label: n !== undefined ? `#${n}` : undefined })
        }
      }
    }
  }
  const bscan: ViewOverlay | undefined = bRects.length || bLines.length ? { rects: bRects, vlines: bLines } : undefined
  if (bscan) any = true
  if (!any) return null
  return { sscan, cscan, ...(bscan ? { bscan } : {}) }
}
