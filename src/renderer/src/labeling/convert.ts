/**
 * 초안(state.ts) → 기록 칸 (shared/labels types). 패널(record.ts buildRecord)이 기록을 만들 때 쓴다 — 순수.
 *   점 → AnchorPoint (앵커 = 그룹·스캔 칸·빔·샘플 실수 + 좌표 규칙 버전 + 그때 대조 여부, mm = 찍은 V·실제 깊이)
 *   사각형 → 모서리 두 점 rect-a·rect-b (레그 경계를 넘으면 한 레그로 자르고, 부채꼴 밖 모서리는 안으로 당긴다 — rectAnchors)
 *   검토 구간 초안 → ReviewInterval 의 칸 (종류·사유·라벨 세트는 패널이 채운다)
 */
import { foldDepth, sscanLookupAt, sscanLookupBeamSample, type ViewerGroup } from '@shared/imaging'
import { LABEL_COORD_RULES_VERSION, type AnchorPoint, type ReviewInterval } from '@shared/labels'
import type { LabelDraftPoint, LabelDraftRect, LabelReviewDraft } from './state'

type GroupGeom = Pick<ViewerGroup, 'id' | 'verified' | 'beams' | 'ultrasound'>

export function toAnchorPoint(p: LabelDraftPoint, group: Pick<ViewerGroup, 'verified'>, thicknessMm: number | null, coordRulesVersion: number = LABEL_COORD_RULES_VERSION): AnchorPoint {
  const f = foldDepth(p.unfoldedDepthMm, thicknessMm)
  return {
    id: p.id,
    role: p.role,
    anchor: { groupId: p.groupId, scanIndex: p.scanIndex, beam: p.beam, sample: p.sample, coordRulesVersion, groupVerified: group.verified },
    leg: f.leg,
    displayGainDb: p.displayGainDb,
    mm: { scanMm: p.scanMm, vMm: p.vMm, depthMm: f.depthMm }
  }
}

/** 사각형을 앵커로 바꾼 결과 */
export interface RectAnchors {
  points: AnchorPoint[]
  /** 레그 경계를 넘어 한 레그 안으로 잘랐는가 (그 레그 번호) */
  clippedToLeg: number | null
  /** 부채꼴 밖 모서리를 부채꼴 안으로 당겨 범위가 줄었는가 */
  shrunk: boolean
}

/**
 * 사각형이 레그 경계(펼친 깊이 = t 의 배수)를 넘으면 한 레그 안으로 자른다 — 모서리 두 점을 각자 접으면 (펼친 10~14, t = 12 → 10·10)
 * 실제 깊이 범위가 무너지기 때문 (짝수 레그는 위아래가 반대). 레그는 preferLeg(최대 진폭 점의 레그)가 사각형 안이면 그것,
 * 아니면 사각형이 더 많이 걸친 레그. 두께를 모르면 그대로.
 */
export function clipRectToLeg(r: LabelDraftRect, thicknessMm: number | null, preferLeg: number | null = null): { rect: LabelDraftRect; leg: number | null } {
  if (thicknessMm === null || !(thicknessMm > 0)) return { rect: r, leg: null }
  const t = thicknessMm
  const legOfDepth = (d: number): number => Math.max(1, Math.floor(d / t) + 1)
  const la = legOfDepth(r.depthMinMm)
  const lb = legOfDepth(Math.max(r.depthMinMm, r.depthMaxMm - 1e-9))
  if (la === lb) return { rect: r, leg: null }
  let leg = preferLeg !== null && preferLeg >= la && preferLeg <= lb ? preferLeg : la
  if (preferLeg === null || preferLeg < la || preferLeg > lb) {
    let best = -1
    for (let L = la; L <= lb; L++) {
      const part = Math.min(r.depthMaxMm, L * t) - Math.max(r.depthMinMm, (L - 1) * t)
      if (part > best) {
        best = part
        leg = L
      }
    }
  }
  return { rect: { ...r, depthMinMm: Math.max(r.depthMinMm, (leg - 1) * t), depthMaxMm: Math.min(r.depthMaxMm, leg * t - 1e-6) }, leg }
}

/**
 * 사각형 모서리 → rect-a·rect-b (파생 위치는 두 점의 V·깊이 범위라 어느 대각선이든 같은 상자).
 *   1) 레그 경계를 넘으면 한 레그 안으로 자른다 (clipRectToLeg).
 *   2) 대각선 (왼쪽 위·오른쪽 아래) → (왼쪽 아래·오른쪽 위) 가운데 두 모서리가 모두 부채꼴 안인 것.
 *   3) 둘 다 아니면 밖 모서리를 사각형 가운데 쪽으로 당겨 부채꼴 안으로 (넓이가 큰 대각선). 그래도 안 되는 모서리는 뺀다.
 * ids = 쓸 점 id 두 개.
 */
export function rectAnchors(
  r: LabelDraftRect,
  group: GroupGeom,
  thicknessMm: number | null,
  ids: [string, string],
  coordRulesVersion: number = LABEL_COORD_RULES_VERSION,
  preferLeg: number | null = null
): RectAnchors {
  const clip = clipRectToLeg(r, thicknessMm, preferLeg)
  const rc = clip.rect
  const inside = (v: number, d: number): boolean => sscanLookupAt(group, v, d) !== null
  const cv = (rc.vMinMm + rc.vMaxMm) / 2
  const cd = (rc.depthMinMm + rc.depthMaxMm) / 2
  /** 모서리를 안쪽 점(가운데, 가운데가 밖이면 맞은편 모서리) 쪽으로 당겨 부채꼴 안에 드는 가장 바깥 점 (안쪽 점도 밖이면 null) */
  const pull = (v: number, d: number, other: [number, number]): [number, number] | null => {
    if (inside(v, d)) return [v, d]
    const to: [number, number] | null = inside(cv, cd) ? [cv, cd] : inside(other[0], other[1]) ? other : null
    if (!to) return null
    let lo = 0 // 밖
    let hi = 1 // 안
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2
      if (inside(v + (to[0] - v) * m, d + (to[1] - d) * m)) hi = m
      else lo = m
    }
    return [v + (to[0] - v) * hi, d + (to[1] - d) * hi]
  }
  const diagonals: Array<[[number, number], [number, number]]> = [
    [
      [rc.vMinMm, rc.depthMinMm],
      [rc.vMaxMm, rc.depthMaxMm]
    ],
    [
      [rc.vMinMm, rc.depthMaxMm],
      [rc.vMaxMm, rc.depthMinMm]
    ]
  ]
  // 모서리 두 자리 (rect-a, rect-b) — 부채꼴 안으로 못 들인 자리는 null
  let corners: Array<[number, number] | null> = [null, null]
  let shrunk = false
  const whole = diagonals.find(([a, b]) => inside(a[0], a[1]) && inside(b[0], b[1]))
  if (whole) corners = [whole[0], whole[1]]
  else {
    let bestN = -1
    let bestArea = -1
    for (const [a, b] of diagonals) {
      const pa = pull(a[0], a[1], b)
      const pb = pull(b[0], b[1], a)
      const n = (pa ? 1 : 0) + (pb ? 1 : 0)
      const area = pa && pb ? Math.abs(pa[0] - pb[0]) * Math.abs(pa[1] - pb[1]) : 0
      if (n > bestN || (n === bestN && area > bestArea)) {
        corners = [pa, pb]
        bestN = n
        bestArea = area
      }
    }
    shrunk = true
  }
  const roles: AnchorPoint['role'][] = ['rect-a', 'rect-b']
  const points: AnchorPoint[] = []
  corners.forEach((c, i) => {
    if (!c) return
    const [v, d] = c
    const l = sscanLookupAt(group, v, d)
    if (!l) return
    const { beam, sample } = sscanLookupBeamSample(l)
    points.push(
      toAnchorPoint(
        { id: ids[i]!, role: roles[i]!, groupId: rc.groupId, scanIndex: rc.scanIndex, scanMm: rc.scanMm, vMm: v, unfoldedDepthMm: d, beam, sample, displayGainDb: rc.displayGainDb },
        group,
        thicknessMm,
        coordRulesVersion
      )
    )
  })
  return { points, clippedToLeg: clip.leg, shrunk }
}

/** 사각형 모서리 → rect-a·rect-b 점 (rectAnchors 의 점만) */
export function rectToAnchorPoints(
  r: LabelDraftRect,
  group: GroupGeom,
  thicknessMm: number | null,
  ids: [string, string],
  coordRulesVersion: number = LABEL_COORD_RULES_VERSION,
  preferLeg: number | null = null
): AnchorPoint[] {
  return rectAnchors(r, group, thicknessMm, ids, coordRulesVersion, preferLeg).points
}

/** 검토 구간 초안 → ReviewInterval 의 위치 칸 */
export function reviewSpanOf(r: LabelReviewDraft): Pick<ReviewInterval, 'groupId' | 'scanStartMm' | 'scanEndMm'> {
  return { groupId: r.groupId, scanStartMm: Math.min(r.scanStartMm, r.scanEndMm), scanEndMm: Math.max(r.scanStartMm, r.scanEndMm) }
}
