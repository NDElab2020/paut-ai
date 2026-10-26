/**
 * 원자료 앵커 ↔ mm (런타임 의존성 없음).
 *
 * 앵커 = (그룹, 스캔 칸 k, 빔 b, 샘플 i) 실수. 빔·샘플은 S-scan 조회표(buildSscanMap)와 같은 규칙으로 정한다:
 *   화면 점 P 를 감싸는 이웃 두 빔 (b0, b1) 과 섞음 비율 w (φ 부호가 바뀌는 곳), 두 빔 각자의 샘플 s0·s1 (같은 음로 |P − E_b|)
 *   → 빔 = b0 + w·(b1 − b0), 샘플 = s0 + w·(s1 − s0).  (b0·b1 이 번호로 이웃이 아니면 가까운 쪽 빔 하나)
 * 앵커 → 점은 그 역이다(뉴턴 반복, 왕복 오차 1e-6 mm 안). 1b 화면은 pointToAnchor 로 앵커를 만들면 된다.
 *
 * 좌표 규칙이 바뀌면(LABEL_COORD_RULES_VERSION) 앵커가 있는 기록은 버리지 않고 앵커에서 mm 를 다시 계산하고
 * '재확인 필요'를 붙인다(계획 6절 결정, types.ts 머리 주석). 엑셀 기록(imported-mm)은 mm 가 원본이라 그대로 둔다.
 * 엑셀 기록의 앵커는 '추정'만 한다(estimateAnchors) — 기록에 써 넣지 않는다.
 */
import { DEG, foldDepth, mmPerUs, samplePoint, scanPositionMm, skewSign } from '../../imaging/coords'
import { sscanBeamOrder } from '../../imaging/sscan'
import type { ViewerGroup } from '../../imaging/types'
import { LABEL_COORD_RULES_VERSION } from '../types'
import type { Anchor, AnchorPoint, AnchorRole, DerivedPosition, IndicationRecord, PointMm } from '../types'
import { rangesBounds, sectionRanges, type GroupCellGeometry, type PhysicalRegion } from './geometry'

type GroupGeom = Pick<ViewerGroup, 'beams' | 'ultrasound' | 'scan'>

/** 앵커 한 점의 위치: 검사 좌표 + 펼친 깊이·레그 */
export interface AnchorPosition extends PointMm {
  /** 펼친 깊이 (S-scan 세로) */
  unfoldedDepthMm: number
  leg: number | null
}

/** 실제 깊이 d 를 레그 L 의 펼친 깊이로 (레그 1 = d, 2 = 2t − d, 3 = 2t + d, 4 = 4t − d …) */
export function unfoldDepth(depthMm: number, leg: number, thicknessMm: number): number {
  const n = leg - 1
  return n % 2 === 0 ? n * thicknessMm + depthMm : (n + 1) * thicknessMm - depthMm
}

interface BeamGeom {
  th: number
  vb: number
  sg: number
  vel: number
  t0: number
}

function beamGeom(group: GroupGeom, b: number): BeamGeom {
  const beam = group.beams[b]!
  return { th: beam.angleDeg * DEG, vb: beam.vOffsetMm, sg: skewSign(beam.skewDeg) ?? 1, vel: mmPerUs(beam.velocityMps), t0: beam.t0Us }
}

/** 고정한 두 빔 (b0, b1) 에서 점 P 의 (w, 샘플) — 조회표와 같은 식 */
function pairCoords(g0: BeamGeom, g1: BeamGeom, res: number, x: number, z: number): { w: number; s0: number; s1: number; f0: number; f1: number } {
  const f0 = Math.atan2(g0.sg * (x - g0.vb), z) - g0.th
  const f1 = Math.atan2(g1.sg * (x - g1.vb), z) - g1.th
  const w = f0 - f1 !== 0 ? f0 / (f0 - f1) : 0
  const s0 = ((2 * Math.hypot(x - g0.vb, z)) / g0.vel - g0.t0) / res
  const s1 = ((2 * Math.hypot(x - g1.vb, z)) / g1.vel - g1.t0) / res
  return { w, s0, s1, f0, f1 }
}

/**
 * 검사 좌표 점 → 앵커 (스캔 칸·빔·샘플 실수). 부채꼴 밖이거나 샘플 범위 밖이면 null.
 * unfoldedDepthMm 은 펼친 깊이(S-scan 세로) — 실제 깊이와 레그가 있으면 unfoldDepth 로 바꿔 넘긴다.
 */
export function pointToAnchor(
  group: GroupGeom,
  scanMm: number,
  vMm: number,
  unfoldedDepthMm: number
): { scanIndex: number; beam: number; sample: number } | null {
  const nb = group.beams.length
  const nt = group.ultrasound.count
  const res = group.ultrasound.resolutionUs
  if (nb < 2 || nt < 2 || !(unfoldedDepthMm > 0) || !Number.isFinite(vMm) || !Number.isFinite(scanMm)) return null
  const order = sscanBeamOrder(group)
  const geo = order.map((b) => beamGeom(group, b))
  const phi = (k: number): number => Math.atan2(geo[k]!.sg * (vMm - geo[k]!.vb), unfoldedDepthMm) - geo[k]!.th
  let lo = 0
  let hi = nb
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (phi(mid) >= 0) lo = mid + 1
    else hi = mid
  }
  // 첫 빔 선 위(φ = 0)는 lo = 1, 끝 빔 선 위는 lo = nb − 1 로 잡힌다 (조회표와 같은 판정: lo ∈ [1, nb − 1])
  if (lo < 1 || lo > nb - 1) return null
  const k0 = lo - 1
  const k1 = lo
  const c = pairCoords(geo[k0]!, geo[k1]!, res, vMm, unfoldedDepthMm)
  if (!(c.s0 >= 0 && c.s0 <= nt - 1 && c.s1 >= 0 && c.s1 <= nt - 1)) return null
  const b0 = order[k0]!
  const b1 = order[k1]!
  const beam = Math.abs(b1 - b0) === 1 ? b0 + c.w * (b1 - b0) : c.w < 0.5 ? b0 : b1
  const sample = Math.abs(b1 - b0) === 1 ? c.s0 + c.w * (c.s1 - c.s0) : c.w < 0.5 ? c.s0 : c.s1
  return { scanIndex: (scanMm - group.scan.offsetMm) / group.scan.resolutionMm, beam, sample }
}

/**
 * 앵커 → 검사 좌표. 빔 실수 = b0 + w (b1 = b0 + 1). w = 0 이면 빔 b0 의 샘플 점 그대로,
 * 아니면 pointToAnchor 의 역을 뉴턴 반복으로 푼다(첫 값 = 두 빔 같은 샘플 점의 선형 보간).
 */
export function anchorToPoint(
  group: GroupGeom,
  anchor: Pick<Anchor, 'scanIndex' | 'beam' | 'sample'>,
  thicknessMm: number | null
): AnchorPosition | null {
  const nb = group.beams.length
  const us = group.ultrasound
  if (nb < 1 || !Number.isFinite(anchor.beam) || !Number.isFinite(anchor.sample) || !Number.isFinite(anchor.scanIndex)) return null
  const bf = Math.min(nb - 1, Math.max(0, anchor.beam))
  const b0 = Math.floor(bf)
  const b1 = Math.min(nb - 1, b0 + 1)
  const w = bf - b0
  const p0 = samplePoint(group.beams[b0]!, anchor.sample, us)
  let x = p0.vMm
  let z = p0.depthMm
  if (w > 0 && b1 !== b0) {
    const p1 = samplePoint(group.beams[b1]!, anchor.sample, us)
    x = p0.vMm + (p1.vMm - p0.vMm) * w
    z = p0.depthMm + (p1.depthMm - p0.depthMm) * w
    const g0 = beamGeom(group, b0)
    const g1 = beamGeom(group, b1)
    const res = us.resolutionUs
    const target = (px: number, pz: number): [number, number] => {
      const c = pairCoords(g0, g1, res, px, pz)
      return [c.w - w, c.s0 + c.w * (c.s1 - c.s0) - anchor.sample]
    }
    const h = 1e-4
    for (let it = 0; it < 8; it++) {
      const [e0, e1] = target(x, z)
      if (Math.abs(e0) < 1e-12 && Math.abs(e1) < 1e-9) break
      const [ax, bx] = target(x + h, z)
      const [az, bz] = target(x, z + h)
      const j00 = (ax - e0) / h
      const j10 = (bx - e1) / h
      const j01 = (az - e0) / h
      const j11 = (bz - e1) / h
      const det = j00 * j11 - j01 * j10
      if (!(Math.abs(det) > 1e-15)) break
      const dx = (e0 * j11 - e1 * j01) / det
      const dz = (j00 * e1 - j10 * e0) / det
      x -= dx
      z -= dz
      if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) break
    }
  }
  const f = foldDepth(z, thicknessMm)
  return { scanMm: scanPositionMm(anchor.scanIndex, group.scan), vMm: x, depthMm: f.depthMm, unfoldedDepthMm: z, leg: f.leg }
}

// ───────────────────────────── 엑셀 기록의 앵커 추정 ─────────────────────────────

/** 영역이 그룹·레그 하나에 맺힌 칸과 대표 앵커 (추정, 기록에 써 넣지 않음) */
export interface AnchorEstimate {
  groupId: number
  leg: number
  /** 영역 안 칸 수 (빔 × 샘플) */
  cells: number
  beamMin: number
  beamMax: number
  sampleMin: number
  sampleMax: number
  /** U 범위의 스캔 칸 (실수) */
  scanIndexStart: number
  scanIndexEnd: number
  /** 영역 중심을 이 레그에 펼친 점의 앵커 (부채꼴 밖이면 칸 무게중심) */
  center: Anchor
  centerMm: AnchorPosition | null
}

/**
 * imported-mm 기록 → 그룹·레그별 앵커 추정. 그룹의 빔 × 샘플 칸을 모두 정방향 계산(samplePoint + foldDepth)해
 * 영역(V × 실제 깊이, ± padMm)에 드는 칸을 레그마다 찾는다.
 */
export function estimateAnchors(
  group: GroupGeom & Pick<ViewerGroup, 'id' | 'verified'>,
  geom: GroupCellGeometry,
  region: PhysicalRegion,
  padMm: number,
  coordRulesVersion: number = LABEL_COORD_RULES_VERSION
): AnchorEstimate[] {
  const out: AnchorEstimate[] = []
  const t = geom.thicknessMm
  const scanMid = (region.scanStartMm + region.scanEndMm) / 2
  const k = (u: number): number => (u - group.scan.offsetMm) / group.scan.resolutionMm
  for (const L of geom.legs) {
    const r = sectionRanges(geom, region, L, padMm)
    const bd = rangesBounds(r)
    if (!bd) continue
    let cells = 0
    let sb = 0
    let si = 0
    let sv = 0
    for (let b = bd.beamMin; b <= bd.beamMax; b++) {
      for (let i = r.lo[b]!; i <= r.hi[b]!; i++) {
        cells++
        sb += b
        si += i
        sv += geom.vMm[b * geom.nt + i]!
      }
    }
    const vc = region.vMinMm !== null && region.vMaxMm !== null ? (region.vMinMm + region.vMaxMm) / 2 : sv / cells
    const dc = (region.depthTopMm + region.depthBottomMm) / 2
    const a = pointToAnchor(group, scanMid, vc, unfoldDepth(dc, L, t))
    const center: Anchor = {
      groupId: group.id,
      scanIndex: a?.scanIndex ?? k(scanMid),
      beam: a?.beam ?? sb / cells,
      sample: a?.sample ?? si / cells,
      coordRulesVersion,
      groupVerified: group.verified
    }
    out.push({
      groupId: group.id,
      leg: L,
      cells,
      ...bd,
      scanIndexStart: k(region.scanStartMm),
      scanIndexEnd: k(region.scanEndMm),
      center,
      centerMm: anchorToPoint(group, center, t)
    })
  }
  return out
}

// ───────────────────────────── 앵커 기록 다시 계산 ─────────────────────────────

/** 좌표 규칙이 바뀌어 다시 계산해야 하는지 (앵커 기록만) */
export function anchorVersionChanged(record: Pick<IndicationRecord, 'coordSource' | 'anchors' | 'derived'>, current: number = LABEL_COORD_RULES_VERSION): boolean {
  if (record.coordSource !== 'app-anchor' || record.anchors.length === 0) return false
  if (record.derived.coordRulesVersion !== current) return true
  return record.anchors.some((p) => p.anchor.coordRulesVersion !== current || p.mm === null)
}

/** 재확인 필요: 이미 표시됐거나, 좌표 규칙이 바뀌어 앵커에서 다시 계산해야 함 */
export function needsRecheck(record: Pick<IndicationRecord, 'coordSource' | 'anchors' | 'derived' | 'recheckNeeded'>, current: number = LABEL_COORD_RULES_VERSION): boolean {
  return record.recheckNeeded || anchorVersionChanged(record, current)
}

function pairOf(points: readonly AnchorPoint[], a: AnchorRole, b: AnchorRole): [PointMm, PointMm] | null {
  const pa = points.find((p) => p.role === a && p.mm)
  const pb = points.find((p) => p.role === b && p.mm)
  return pa?.mm && pb?.mm ? [pa.mm, pb.mm] : null
}

/**
 * 앵커 점들 → 파생 위치 (규칙):
 *   스캔: length-start·length-end 가 둘 다 있으면 그 둘, 아니면 모든 점의 최소·최대
 *   V: rect-a·rect-b 가 둘 다 있으면 그 둘, 아니면 모든 점
 *   깊이: drop-top·drop-bottom → rect-a·rect-b → 모든 점 순서
 * mm 가 없는 점은 뺀다. 점이 하나도 없으면 null.
 */
export function derivedFromPoints(points: readonly AnchorPoint[], coordRulesVersion: number): DerivedPosition | null {
  const all = points.map((p) => p.mm).filter((m): m is PointMm => m !== null)
  if (all.length === 0) return null
  const span = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)]
  const ls = pairOf(points, 'length-start', 'length-end')
  const rect = pairOf(points, 'rect-a', 'rect-b')
  const drop = pairOf(points, 'drop-top', 'drop-bottom')
  const [s0, s1] = span((ls ?? all).map((m) => m.scanMm))
  const [v0, v1] = span((rect ?? all).map((m) => m.vMm))
  const [d0, d1] = span((drop ?? rect ?? all).map((m) => m.depthMm))
  return { scanStartMm: s0, scanEndMm: s1, vMinMm: v0, vMaxMm: v1, depthTopMm: d0, depthBottomMm: d1, coordRulesVersion }
}

export interface AnchorRecompute {
  /** 다시 계산한 기록 (바뀌지 않았으면 들어온 기록 그대로) */
  record: IndicationRecord
  /** 좌표 규칙 버전이 달라 다시 계산했는지 */
  recomputed: boolean
  /** '재확인 필요'를 붙였는지 */
  recheckNeeded: boolean
  /** 점이 옮겨진 거리의 최대 (mm, 옛 mm 가 있던 점만). 없으면 null */
  maxShiftMm: number | null
  /** 앵커 그룹을 파일에서 못 찾은 점의 그룹 번호 (그 점은 옛 mm 를 둔다) */
  missingGroups: number[]
}

/**
 * 좌표 규칙이 바뀐 앵커 기록을 앵커에서 다시 계산한다 (버리지 않음). 규칙 버전이 같으면 그대로 돌려준다.
 * 다시 계산하면 점마다 anchor.coordRulesVersion = 지금 버전, mm·레그 갱신, derived 를 derivedFromPoints 로 갱신,
 * recheckNeeded = true (전문가가 확인하면 1b 화면이 끈다). 옛 값과 같아도 붙인다(결정: 규칙이 바뀌면 재확인).
 */
export function recomputeFromAnchors(
  record: IndicationRecord,
  groups: ReadonlyMap<number, GroupGeom>,
  thicknessMm: number | null,
  current: number = LABEL_COORD_RULES_VERSION
): AnchorRecompute {
  if (!anchorVersionChanged(record, current)) {
    return { record, recomputed: false, recheckNeeded: record.recheckNeeded, maxShiftMm: null, missingGroups: [] }
  }
  let maxShift: number | null = null
  const missing = new Set<number>()
  const anchors: AnchorPoint[] = record.anchors.map((p) => {
    const g = groups.get(p.anchor.groupId)
    const pos = g ? anchorToPoint(g, p.anchor, thicknessMm) : null
    if (!pos) {
      missing.add(p.anchor.groupId)
      return p
    }
    const mm: PointMm = { scanMm: pos.scanMm, vMm: pos.vMm, depthMm: pos.depthMm }
    if (p.mm) {
      const d = Math.hypot(mm.scanMm - p.mm.scanMm, mm.vMm - p.mm.vMm, mm.depthMm - p.mm.depthMm)
      maxShift = maxShift === null ? d : Math.max(maxShift, d)
    }
    return { ...p, anchor: { ...p.anchor, coordRulesVersion: current }, leg: pos.leg, mm }
  })
  const derived = derivedFromPoints(anchors, current) ?? { ...record.derived, coordRulesVersion: current }
  return {
    record: { ...record, anchors, derived, recheckNeeded: true },
    recomputed: true,
    recheckNeeded: true,
    maxShiftMm: maxShift,
    missingGroups: [...missing].sort((a, b) => a - b)
  }
}

