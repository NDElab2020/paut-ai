/**
 * 칸 기하 — 그룹의 빔 × 샘플 칸 전부를 정방향으로 계산해 (V, 펼친 깊이, 실제 깊이, 레그)를 둔다 (런타임 의존성 없음).
 * 계산은 shared/imaging/coords.ts 의 samplePoint + foldDepth 그대로다 (뷰어 S-scan 과 같은 좌표 규칙).
 * X3 한 그룹 31 × 808 ≈ 2.5만 칸, 수 ms (규격 3.3).
 *
 * 영역(물리 좌표: V 범위 × 실제 깊이 범위)이 레그 L 에서 차지하는 칸은 '그 레그에 맺힌 칸 중 (V, 실제 깊이)가 영역 안인 칸'이다.
 * 펼친 그림에서 빔은 곧은 반직선이고 레그 하나 안의 영역은 볼록(사각형)이라, 빔마다 그 칸들은 이어진 샘플 구간 하나다
 * → 빔마다 [lo, hi] 로 적는다(BeamRanges).
 *
 * 스캔 U → 칸: 칸 k 는 [U(k) − Δu/2, U(k) + Δu/2] 를 덮는다. mm 로 겹침을 먼저 보고 floor/ceil 한다(규격 3.3).
 * scanIndexAt(반올림 + 끝 칸 자르기)를 쓰면 범위 밖 기록이 끝 칸에 붙어 가짜 상자가 생긴다.
 */
import { foldDepth, samplePoint } from '../../imaging/coords'
import type { ViewerGroup, ViewerScanAxis, ViewerWeld } from '../../imaging/types'
import { bevelHalfWidth, isDrawableWeld } from '../../imaging/weld'
import type { EchoRules, EchoZone } from './rules'

// ───────────────────────────── 물리 영역 ─────────────────────────────

/** V 범위 × 실제 깊이 범위 (mm). V 가 null 이면 그쪽 끝을 막지 않는다 */
export interface CrossSection {
  vMinMm: number | null
  vMaxMm: number | null
  /** 실제 깊이 (접은 깊이, 표면에서) */
  depthTopMm: number
  depthBottomMm: number
}

/** 기록 영역 = 스캔 U 범위 × 단면 */
export interface PhysicalRegion extends CrossSection {
  scanStartMm: number
  scanEndMm: number
}

function finite(x: number | null | undefined): number | null {
  return x !== null && x !== undefined && Number.isFinite(x) ? x : null
}

/**
 * 기록 파생 위치(derived) → 영역. 빈 깊이는 0 ~ t, 거꾸로 적힌 범위는 바로잡고, 깊이는 [0, t] 로 자른다.
 * fill 이 있으면 빈 V·깊이를 그 단면으로 채운다(형상 에코 기록의 자리 등).
 */
export function regionOf(
  d: { scanStartMm: number; scanEndMm: number; vMinMm: number | null; vMaxMm: number | null; depthTopMm: number | null; depthBottomMm: number | null },
  thicknessMm: number,
  fill?: CrossSection | null
): PhysicalRegion {
  const s0 = Math.min(d.scanStartMm, d.scanEndMm)
  const s1 = Math.max(d.scanStartMm, d.scanEndMm)
  let v0 = finite(d.vMinMm)
  let v1 = finite(d.vMaxMm)
  if (v0 === null && v1 === null && fill) {
    v0 = fill.vMinMm
    v1 = fill.vMaxMm
  }
  if (v0 !== null && v1 !== null && v0 > v1) [v0, v1] = [v1, v0]
  let t0 = finite(d.depthTopMm)
  let t1 = finite(d.depthBottomMm)
  if (t0 === null && t1 === null && fill) {
    t0 = fill.depthTopMm
    t1 = fill.depthBottomMm
  }
  let top = t0 ?? 0
  let bottom = t1 ?? thicknessMm
  if (top > bottom) [top, bottom] = [bottom, top]
  top = Math.min(thicknessMm, Math.max(0, top))
  bottom = Math.min(thicknessMm, Math.max(0, bottom))
  return { scanStartMm: s0, scanEndMm: s1, vMinMm: v0, vMaxMm: v1, depthTopMm: top, depthBottomMm: bottom }
}

/** 단면을 m 만큼 넓힌다 (V 양쪽, 깊이는 [0, t] 안으로 자름) */
export function expandSection<T extends CrossSection>(r: T, m: number, thicknessMm: number): T {
  return {
    ...r,
    vMinMm: r.vMinMm === null ? null : r.vMinMm - m,
    vMaxMm: r.vMaxMm === null ? null : r.vMaxMm + m,
    depthTopMm: Math.max(0, r.depthTopMm - m),
    depthBottomMm: Math.min(thicknessMm, r.depthBottomMm + m)
  }
}

// ───────────────────────────── 칸 기하 ─────────────────────────────

export interface GroupCellGeometry {
  groupId: number
  /** 빔 수 · 샘플 수 */
  nb: number
  nt: number
  thicknessMm: number
  maxLeg: number
  /** 칸 c = b·nt + i 의 V (mm) */
  vMm: Float64Array
  /** 펼친 깊이 (mm) */
  unfoldedMm: Float64Array
  /** 실제 깊이 (mm) */
  depthMm: Float64Array
  /** 레그 (1부터, maxLeg 보다 크면 0 — 다루지 않음) */
  leg: Int16Array
  /** 빔 b 에서 레그 L 의 샘플 구간: legLo/legHi[b·(maxLeg+1) + L] (hi < lo = 없음) */
  legLo: Int32Array
  legHi: Int32Array
  /** 칸이 하나라도 있는 레그 (오름차순) */
  legs: number[]
}

export function buildCellGeometry(group: Pick<ViewerGroup, 'id' | 'beams' | 'ultrasound'>, thicknessMm: number, maxLeg: number): GroupCellGeometry {
  const nb = group.beams.length
  const nt = group.ultrasound.count
  const n = nb * nt
  const vMm = new Float64Array(n)
  const unfoldedMm = new Float64Array(n)
  const depthMm = new Float64Array(n)
  const leg = new Int16Array(n)
  const stride = maxLeg + 1
  const legLo = new Int32Array(nb * stride).fill(nt)
  const legHi = new Int32Array(nb * stride).fill(-1)
  const present = new Set<number>()
  for (let b = 0; b < nb; b++) {
    const beam = group.beams[b]!
    for (let i = 0; i < nt; i++) {
      const c = b * nt + i
      const p = samplePoint(beam, i, group.ultrasound)
      const f = foldDepth(p.depthMm, thicknessMm)
      vMm[c] = p.vMm
      unfoldedMm[c] = p.depthMm
      depthMm[c] = f.depthMm
      const L = f.leg !== null && f.leg >= 1 && f.leg <= maxLeg && p.depthMm >= 0 ? f.leg : 0
      leg[c] = L
      if (L > 0) {
        const j = b * stride + L
        if (i < legLo[j]!) legLo[j] = i
        if (i > legHi[j]!) legHi[j] = i
        present.add(L)
      }
    }
  }
  return { groupId: group.id, nb, nt, thicknessMm, maxLeg, vMm, unfoldedMm, depthMm, leg, legLo, legHi, legs: [...present].sort((a, b) => a - b) }
}

/** 빔 b 에서 레그 L 의 샘플 구간 [lo, hi] (없으면 hi < lo) */
export function legSampleRange(geom: GroupCellGeometry, b: number, L: number): [number, number] {
  if (L < 1 || L > geom.maxLeg || b < 0 || b >= geom.nb) return [0, -1]
  const j = b * (geom.maxLeg + 1) + L
  return [geom.legLo[j]!, geom.legHi[j]!]
}

// ───────────────────────────── 빔별 샘플 구간 ─────────────────────────────

/** 빔마다 샘플 구간 [lo, hi] (양 끝 포함, hi < lo = 빈 빔) */
export interface BeamRanges {
  lo: Int32Array
  hi: Int32Array
}

export function emptyRanges(nb: number): BeamRanges {
  return { lo: new Int32Array(nb).fill(0), hi: new Int32Array(nb).fill(-1) }
}

export function rangesCellCount(r: BeamRanges): number {
  let n = 0
  for (let b = 0; b < r.lo.length; b++) if (r.hi[b]! >= r.lo[b]!) n += r.hi[b]! - r.lo[b]! + 1
  return n
}

export function rangesHas(r: BeamRanges, b: number, i: number): boolean {
  return b >= 0 && b < r.lo.length && i >= r.lo[b]! && i <= r.hi[b]!
}

/** 칸 범위 (빔·샘플 최소·최대). 비었으면 null */
export function rangesBounds(r: BeamRanges): { beamMin: number; beamMax: number; sampleMin: number; sampleMax: number } | null {
  let b0 = -1
  let b1 = -1
  let s0 = Infinity
  let s1 = -Infinity
  for (let b = 0; b < r.lo.length; b++) {
    if (r.hi[b]! < r.lo[b]!) continue
    if (b0 < 0) b0 = b
    b1 = b
    s0 = Math.min(s0, r.lo[b]!)
    s1 = Math.max(s1, r.hi[b]!)
  }
  return b0 < 0 ? null : { beamMin: b0, beamMax: b1, sampleMin: s0, sampleMax: s1 }
}

/** 칸 구간들의 펼친 S-scan 상자 (칸 중심의 V·펼친 깊이 최소·최대) */
export interface RangesBox {
  vMinMm: number
  vMaxMm: number
  /** 펼친 깊이 */
  depthMinMm: number
  depthMaxMm: number
  beamMin: number
  beamMax: number
  sampleMin: number
  sampleMax: number
  cells: number
}

export function rangesBox(geom: GroupCellGeometry, r: BeamRanges): RangesBox | null {
  const bd = rangesBounds(r)
  if (!bd) return null
  let v0 = Infinity
  let v1 = -Infinity
  let d0 = Infinity
  let d1 = -Infinity
  for (let b = bd.beamMin; b <= bd.beamMax; b++) {
    if (r.hi[b]! < r.lo[b]!) continue
    // 한 빔 안에서 V·깊이는 샘플에 단조 → 양 끝 칸만 보면 된다
    for (const i of [r.lo[b]!, r.hi[b]!]) {
      const c = b * geom.nt + i
      v0 = Math.min(v0, geom.vMm[c]!)
      v1 = Math.max(v1, geom.vMm[c]!)
      d0 = Math.min(d0, geom.unfoldedMm[c]!)
      d1 = Math.max(d1, geom.unfoldedMm[c]!)
    }
  }
  return { vMinMm: v0, vMaxMm: v1, depthMinMm: d0, depthMaxMm: d1, ...bd, cells: rangesCellCount(r) }
}

/** 레그 L 에서 단면 안에 드는 칸 (여유 padMm 만큼 넓혀 판정) */
export function sectionRanges(geom: GroupCellGeometry, section: CrossSection, L: number, padMm: number): BeamRanges {
  const out = emptyRanges(geom.nb)
  const vLo = section.vMinMm === null ? -Infinity : section.vMinMm - padMm
  const vHi = section.vMaxMm === null ? Infinity : section.vMaxMm + padMm
  const dLo = section.depthTopMm - padMm
  const dHi = section.depthBottomMm + padMm
  for (let b = 0; b < geom.nb; b++) {
    const [lo, hi] = legSampleRange(geom, b, L)
    let a = -1
    let e = -1
    for (let i = lo; i <= hi; i++) {
      const c = b * geom.nt + i
      const v = geom.vMm[c]!
      const d = geom.depthMm[c]!
      if (v >= vLo && v <= vHi && d >= dLo && d <= dHi) {
        if (a < 0) a = i
        e = i
      }
    }
    if (a >= 0) {
      out.lo[b] = a
      out.hi[b] = e
    }
  }
  return out
}

/** 빔 방향으로 ±n 빔 넓힌다: 빔 b 의 구간 = 이웃(±n) 빔 구간들의 합 ∩ 빔 b 의 레그 L 구간 */
export function dilateBeams(geom: GroupCellGeometry, r: BeamRanges, L: number, n: number): BeamRanges {
  if (n <= 0) return { lo: r.lo.slice(), hi: r.hi.slice() }
  const out = emptyRanges(geom.nb)
  for (let b = 0; b < geom.nb; b++) {
    let lo = Infinity
    let hi = -Infinity
    for (let q = Math.max(0, b - n); q <= Math.min(geom.nb - 1, b + n); q++) {
      if (r.hi[q]! < r.lo[q]!) continue
      lo = Math.min(lo, r.lo[q]!)
      hi = Math.max(hi, r.hi[q]!)
    }
    if (hi < lo) continue
    const [ll, lh] = legSampleRange(geom, b, L)
    const a = Math.max(lo, ll)
    const e = Math.min(hi, lh)
    if (e >= a) {
      out.lo[b] = a
      out.hi[b] = e
    }
  }
  return out
}

/** 탐색 창: 단면 ± searchMarginMm 의 칸을 ± searchMarginBeams 빔 넓힌 것 (규격 3.3) */
export function windowRanges(
  geom: GroupCellGeometry,
  section: CrossSection,
  L: number,
  opts: { searchMarginMm: number; searchMarginBeams: number; regionPadMm: number }
): BeamRanges {
  const wide = expandSection(section, opts.searchMarginMm, geom.thicknessMm)
  return dilateBeams(geom, sectionRanges(geom, wide, L, opts.regionPadMm), L, opts.searchMarginBeams)
}

/** JSON 으로 내보낼 모양 (빈 빔은 [0, -1]) */
export function rangesToArrays(r: BeamRanges): { lo: number[]; hi: number[] } {
  return { lo: Array.from(r.lo), hi: Array.from(r.hi) }
}

// ───────────────────────────── 스캔 축 ─────────────────────────────

/**
 * U 범위 [u0, u1] (mm) 와 겹치는 스캔 칸 [k0, k1]. 칸 k 는 [U(k) − Δu/2, U(k) + Δu/2].
 * 축 밖이면 null (끝 칸에 붙이지 않음). 경계에 맞닿기만 하면 겹침이 아니다.
 * 한 점(u0 = u1)이 두 칸 경계에 있으면 반올림한 칸 하나.
 */
export function scanRangeForU(axis: ViewerScanAxis, u0: number, u1: number): [number, number] | null {
  const n = axis.count
  if (n < 1 || !(axis.resolutionMm !== 0) || !Number.isFinite(u0) || !Number.isFinite(u1)) return null
  let a = (Math.min(u0, u1) - axis.offsetMm) / axis.resolutionMm
  let b = (Math.max(u0, u1) - axis.offsetMm) / axis.resolutionMm
  if (a > b) [a, b] = [b, a]
  if (b < -0.5 || a > n - 0.5) return null
  let k0 = Math.floor(a - 0.5) + 1
  let k1 = Math.ceil(b + 0.5) - 1
  if (k0 > k1) {
    const k = Math.round((a + b) / 2)
    k0 = k
    k1 = k
  }
  k0 = Math.max(0, k0)
  k1 = Math.min(n - 1, k1)
  return k1 >= k0 ? [k0, k1] : null
}

/** mm 길이 → 스캔 칸 수 (올림, 0 이상) */
export function cellsForMm(axis: ViewerScanAxis, mm: number): number {
  const r = Math.abs(axis.resolutionMm)
  return r > 0 ? Math.max(0, Math.ceil(mm / r - 1e-9)) : 0
}

// ───────────────────────────── 용접 형상 ─────────────────────────────

/**
 * 형상 에코를 찾는 자리 (물리 단면). 루트 = CL 근처 바닥(실제 깊이 t − band ~ t), 캡 = 윗면 덧살 폭 안 윗면 근처.
 * 개선 형상이 없으면 루트는 |V| ≤ rootMarginMm 로 보고, 캡은 null(찾지 않음).
 */
export function echoZoneSection(zone: EchoZone, weld: ViewerWeld | null, thicknessMm: number, rules: EchoRules): CrossSection | null {
  const t = thicknessMm
  if (zone === 'root') {
    const base = weld ? Math.max(Math.max(0, weld.offsetMm), (weld.lowerCap?.widthMm ?? 0) / 2) : 0
    const half = base + rules.rootMarginMm
    return { vMinMm: -half, vMaxMm: half, depthTopMm: Math.max(0, t - rules.rootDepthBandMm), depthBottomMm: t }
  }
  const cap = weld?.upperCap
  if (!cap || !(cap.widthMm > 0)) return null
  const half = cap.widthMm / 2 + rules.capMarginMm
  return { vMinMm: -half, vMaxMm: half, depthTopMm: 0, depthBottomMm: Math.min(t, rules.capDepthBandMm) }
}

/**
 * 용접 경계(개선면)까지 거리 (mm, + = 개선면 밖 모재 쪽, − = 용착부 안). 개선 형상을 그릴 수 없으면 null.
 * 실제 깊이 d 에서 개선면 반폭 = bevelHalfWidth (weld.ts, 뷰어 덮개와 같은 식).
 */
export function bevelDistanceMm(weld: ViewerWeld | null, thicknessMm: number, vMm: number, depthMm: number): number | null {
  if (!weld || !isDrawableWeld(weld, thicknessMm)) return null
  return Math.abs(vMm) - bevelHalfWidth(weld, thicknessMm, Math.min(thicknessMm, Math.max(0, depthMm)))
}
