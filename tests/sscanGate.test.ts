/** S-scan 영상 위 게이트 점선 끌기 (shared/imaging/sscanGate) — 선 좌표·잡기 판정·포인터 → 게이트 값 */
import { describe, expect, it } from 'vitest'
import {
  DEG,
  GATE_EDGE_TIE_PX,
  GATE_MIN_LENGTH_MM,
  SSCAN_GATE_DRAG_MIN_PX,
  SSCAN_GATE_HIT_PX,
  applyGateOverride,
  applyPostAction,
  beamPoint,
  beamsAtPoint,
  defaultPost,
  distanceToPolyline,
  gateDisplayValues,
  gateEdgeByMove,
  gateWindowSignature,
  hitSscanGate,
  hitSscanGateDetail,
  isDefaultPost,
  postReducer,
  soundPathMm,
  sscanGateDragPatch,
  sscanGateDragPatchAt,
  sscanGateEdgeValue,
  sscanGateLine,
  sscanGateValueAt,
  sscanPointAtCss,
  timeForSoundPathUs,
  type SscanGatePointer,
  type ViewerBeam,
  type ViewerGate
} from '@shared/imaging'

const US = { resolutionUs: 0.04, count: 808 }
const beam = (index: number, angleDeg: number, vOffsetMm: number, skewDeg = 90, velocityMps = 3242.8, t0Us = 8.052): ViewerBeam => ({
  index,
  angleDeg,
  skewDeg,
  velocityMps,
  uOffsetMm: 0,
  vOffsetMm,
  t0Us
})
/** 섹토리얼 40~70° (X3 비슷, 출사점이 빔마다 0.3 mm 씩) */
const SECTORIAL = { beams: Array.from({ length: 31 }, (_, b) => beam(b, 40 + b, -38 + b * 0.3)), ultrasound: US }
/** 리니어 (TF_01_L GR-2): 60° 빔 44개가 평행, 출사점 V −52.79 부터 0.6383 mm 간격 */
const LINEAR = { beams: Array.from({ length: 44 }, (_, b) => beam(b, 60, -52.79 + b * 0.6383, 90, 3241.5, 12.34)), ultrasound: US }
/** 컴파운드 (TF_01_C_L GR-1): 50→68°, 출사점이 각도와 함께 −45.15 → −22.51 mm */
const COMPOUND = { beams: Array.from({ length: 19 }, (_, b) => beam(b, 50 + b, -45.15 + (b * (45.15 - 22.51)) / 18, 90, 3231, 6.74)), ultrasound: US }

type Group = { beams: ViewerBeam[] }
/** 깊이 창 d0..d1 을 빔별 시간으로 (파일이 TrueDepth 게이트를 저장하는 방식) */
const depthGate = (g: Group, d0: number, d1: number): ViewerGate => {
  const startUs = g.beams.map((b) => timeForSoundPathUs(b, d0 / Math.cos(b.angleDeg * DEG)))
  const endUs = g.beams.map((b) => timeForSoundPathUs(b, d1 / Math.cos(b.angleDeg * DEG)))
  return { id: 1, name: 'Gate A', geometry: 'TrueDepth', sync: 'Pulse', startUs, lengthUs: endUs.map((e, i) => e - startUs[i]!), thresholdPct: 20, supported: true, producesCscan: true }
}
/** 음로 r0..r1 (시간 하나로 저장된 SoundPath 게이트) */
const pathGate = (g: Group, r0: number, r1: number): ViewerGate => {
  const b0 = g.beams[0]!
  const st = timeForSoundPathUs(b0, r0)
  return { id: 1, name: 'Gate A', geometry: 'SoundPath', sync: 'Pulse', startUs: [st], lengthUs: [timeForSoundPathUs(b0, r1) - st], thresholdPct: 20, supported: true, producesCscan: true }
}

/** 영상 mm 창 V −50..50, 깊이 0..50 을 CSS 500×250 에 (1 mm = 가로 5 px, 세로 5 px) */
const VIEW = { vMinMm: -50, vMaxMm: 50, depthMinMm: 0, depthMaxMm: 50 }
const CSS = { cssWidth: 500, cssHeight: 250 }
const px = (vMm: number, depthMm: number): { x: number; y: number } => ({ x: (vMm + 50) * 5, y: depthMm * 5 })
const ptr = (group: Group, gate: ViewerGate, beamNo: number, x: number, y: number, ratio = 1): SscanGatePointer => ({
  group,
  gate,
  beam: beamNo,
  // SscanView 는 캔버스 px 뷰포트(배율 적용)를 그대로 넘긴다 — 잡기·값은 CSS 크기만 써야 한다
  view: { ...VIEW, width: Math.round(CSS.cssWidth * ratio), height: Math.round(CSS.cssHeight * ratio) } as typeof VIEW,
  ...CSS,
  x,
  y
})

describe('게이트 선 (sscanGateLine)', () => {
  it('규칙 상수: 잡기 6 px, 끌기 6 px, 폭 0.1 mm (다이아몬드·리듀서와 같음)', () => {
    expect(SSCAN_GATE_HIT_PX).toBe(6)
    expect(SSCAN_GATE_DRAG_MIN_PX).toBe(6)
    expect(GATE_MIN_LENGTH_MM).toBe(0.1)
  })
  it('TrueDepth: 현재 빔 깊이의 수평선 — 이전 그리기 식과 같은 수 (그림 바이트 불변)', () => {
    const gate = depthGate(SECTORIAL, 7, 28)
    for (const b of [0, 14, 30]) {
      const bm = SECTORIAL.beams[b]!
      const st = gate.startUs[b]!
      const ln = gate.lengthUs[b]!
      const s = sscanGateLine(SECTORIAL, gate, 'start', b, [-40, 30])
      const e = sscanGateLine(SECTORIAL, gate, 'end', b, [-40, 30])
      expect(s).toEqual([
        { vMm: -40, depthMm: beamPoint(bm, soundPathMm(bm, st)).depthMm },
        { vMm: 30, depthMm: beamPoint(bm, soundPathMm(bm, st)).depthMm }
      ])
      expect(e[0]!.depthMm).toBe(beamPoint(bm, soundPathMm(bm, st + ln)).depthMm)
      expect(s[0]!.depthMm).toBeCloseTo(7, 9)
      expect(e[0]!.depthMm).toBeCloseTo(28, 9)
    }
    expect(sscanGateLine(SECTORIAL, gate, 'start', 99, [-40, 30])).toEqual([])
  })
  it('SoundPath: 빔마다 같은 음로 점을 빔 순서로 (섹토리얼 = 호, 리니어 = 평행 빔이라 수평선)', () => {
    const sec = sscanGateLine(SECTORIAL, pathGate(SECTORIAL, 10, 40), 'end', 0, [-50, 50])
    expect(sec).toHaveLength(31)
    sec.forEach((p, b) => {
      const bm = SECTORIAL.beams[b]!
      expect(Math.hypot(p.vMm - bm.vOffsetMm, p.depthMm)).toBeCloseTo(40, 9)
    })
    const lin = sscanGateLine(LINEAR, pathGate(LINEAR, 15, 45), 'start', 0, [-50, 50])
    expect(lin).toHaveLength(44)
    for (const p of lin) expect(p.depthMm).toBeCloseTo(15 * Math.cos(60 * DEG), 9)
  })
  it('distanceToPolyline: 선분 안·끝점 밖·점 하나·빈 선', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ]
    expect(distanceToPolyline(pts, 5, 3)).toBe(3)
    expect(distanceToPolyline(pts, 13, 5)).toBe(3)
    expect(distanceToPolyline(pts, -3, -4)).toBe(5)
    expect(distanceToPolyline([{ x: 1, y: 1 }], 4, 5)).toBe(5)
    expect(distanceToPolyline([], 0, 0)).toBe(Infinity)
  })
})

describe('잡기 판정 (hitSscanGate)', () => {
  const gate = depthGate(SECTORIAL, 7, 28)
  it('TrueDepth: 선에서 ±6 CSS px 안이면 잡고, 밖이면 아님', () => {
    const y0 = px(0, 7).y
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 250, y0 + 5))).toBe('start')
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 250, y0 - 6))).toBe('start')
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 250, y0 + 7))).toBeNull()
    // 수평선은 V 창 전체 — 부채꼴 밖 가장자리에서도 잡힌다
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 2, px(0, 28).y - 4))).toBe('end')
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 250, px(0, 18).y))).toBeNull()
  })
  it('캔버스 배율 2·0.5 (devicePixelRatio·pixelRatio): 반경은 CSS px 그대로', () => {
    const y0 = px(0, 7).y
    for (const ratio of [2, 0.5]) {
      expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 250, y0 + 5, ratio))).toBe('start')
      expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 250, y0 + 7, ratio))).toBeNull()
    }
  })
  it('경계 밖: 요소 밖 포인터·보이는 창 밖의 선은 잡지 않는다', () => {
    const y0 = px(0, 7).y
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, -1, y0))).toBeNull()
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 501, y0))).toBeNull()
    expect(hitSscanGate(ptr(SECTORIAL, gate, 14, 250, -2))).toBeNull()
    const deep = depthGate(SECTORIAL, 60, 70)
    expect(hitSscanGate(ptr(SECTORIAL, deep, 14, 250, 250))).toBeNull()
    expect(hitSscanGate({ ...ptr(SECTORIAL, gate, 14, 250, y0), cssWidth: 0 })).toBeNull()
  })
  it('폭이 좁아 둘 다 잡히면 두 선 가운데보다 깊은 쪽 = 끝, 얕은 쪽 = 시작 (폭 0 이어도 둘 다 잡힌다)', () => {
    const narrow = depthGate(SECTORIAL, 20, 20.5)
    expect(hitSscanGate(ptr(SECTORIAL, narrow, 14, 250, px(0, 20.4).y))).toBe('end')
    expect(hitSscanGate(ptr(SECTORIAL, narrow, 14, 250, px(0, 20.1).y))).toBe('start')
    const zero = { ...narrow, lengthUs: narrow.lengthUs.map(() => 0) }
    expect(hitSscanGate(ptr(SECTORIAL, zero, 14, 250, px(0, 20).y + 2))).toBe('end')
    expect(hitSscanGate(ptr(SECTORIAL, zero, 14, 250, px(0, 20).y - 2))).toBe('start')
  })
  it('겹친 시작·끝(두 선까지 거리 차 1 px 미만)은 tie — 끌기 시작 방향으로 정한다 (깊게 = 끝 = 폭, 얕게 = 시작 = 옮김; 눈금자 다이아몬드와 같음)', () => {
    expect(GATE_EDGE_TIE_PX).toBe(1)
    // 폭 0.1 mm = 0.5 px: 끝 선 위를 눌러도 미정
    const tight = depthGate(SECTORIAL, 20, 20.1)
    const t = hitSscanGateDetail(ptr(SECTORIAL, tight, 14, 250, px(0, 20.1).y))!
    expect(t.tie).toBe(true)
    const valueAt = (y: number): number => sscanGateValueAt(SECTORIAL, tight, sscanPointAtCss(VIEW, CSS.cssWidth, CSS.cssHeight, 250, y))
    expect(gateEdgeByMove(valueAt(px(0, 20.1).y), valueAt(px(0, 20.1).y + 8))).toBe('end')
    expect(gateEdgeByMove(valueAt(px(0, 20.1).y), valueAt(px(0, 20.1).y - 8))).toBe('start')
    // 폭 0.5 mm = 2.5 px: 끝 선 위면 끝(차 2.5 px), 두 선 가운데 근처만 미정
    const narrow = depthGate(SECTORIAL, 20, 20.5)
    expect(hitSscanGateDetail(ptr(SECTORIAL, narrow, 14, 250, px(0, 20.5).y))).toEqual({ edge: 'end', tie: false })
    expect(hitSscanGateDetail(ptr(SECTORIAL, narrow, 14, 250, px(0, 20).y))).toEqual({ edge: 'start', tie: false })
    expect(hitSscanGateDetail(ptr(SECTORIAL, narrow, 14, 250, px(0, 20.25).y + 0.3))!.tie).toBe(true)
    // 넓은 게이트는 tie 없음, 선 밖은 null
    const wide = depthGate(SECTORIAL, 7, 28)
    expect(hitSscanGateDetail(ptr(SECTORIAL, wide, 14, 250, px(0, 7).y + 2))).toEqual({ edge: 'start', tie: false })
    expect(hitSscanGateDetail(ptr(SECTORIAL, wide, 14, 250, px(0, 15).y))).toBeNull()
  })
  it('SoundPath: 빔 사이 선분 위도 잡힌다 (그린 선까지의 거리), 리니어 선 끝 밖은 아님', () => {
    const sg = pathGate(SECTORIAL, 10, 40)
    const a = beamPoint(SECTORIAL.beams[10]!, 40)
    const b = beamPoint(SECTORIAL.beams[11]!, 40)
    const m = px((a.vMm + b.vMm) / 2, (a.depthMm + b.depthMm) / 2)
    expect(hitSscanGate(ptr(SECTORIAL, sg, 0, m.x, m.y + 3))).toBe('end')
    expect(hitSscanGate(ptr(SECTORIAL, sg, 0, m.x, m.y + 30))).toBeNull()
    const lg = pathGate(LINEAR, 15, 45)
    const d0 = 15 * Math.cos(60 * DEG)
    expect(hitSscanGate(ptr(LINEAR, lg, 0, px(-30, 0).x, px(0, d0).y + 2.5))).toBe('start')
    // 마지막 빔의 선 끝(V ≈ −12.4 mm)보다 한참 오른쪽
    expect(hitSscanGate(ptr(LINEAR, lg, 0, px(10, 0).x, px(0, d0).y))).toBeNull()
  })
})

describe('포인터 → 게이트 값', () => {
  it('beamsAtPoint: 빔 축 위면 그 빔, 리니어 빔 사이는 옆 거리 비율, 밖은 가까운 끝 빔', () => {
    const p = beamPoint(SECTORIAL.beams[14]!, 25)
    const at = beamsAtPoint(SECTORIAL, p)!
    const near = at.w < 0.5 ? at.b0 : at.b1
    expect(near).toBe(14)
    expect(Math.min(at.w, 1 - at.w)).toBeLessThan(1e-9)
    const q = beamPoint(LINEAR.beams[10]!, 20)
    const lin = beamsAtPoint(LINEAR, { vMm: q.vMm + 0.3, depthMm: q.depthMm })!
    expect([lin.b0, lin.b1]).toEqual([10, 11])
    expect(lin.w).toBeCloseTo(0.3 / 0.6383, 6)
    expect(beamsAtPoint(LINEAR, { vMm: -60, depthMm: 10 })).toEqual({ b0: 0, b1: 0, w: 0 })
    expect(beamsAtPoint(LINEAR, { vMm: 40, depthMm: 10 })).toEqual({ b0: 43, b1: 43, w: 0 })
    expect(beamsAtPoint({ beams: [] }, { vMm: 0, depthMm: 0 })).toBeNull()
    // 컴파운드(각도·출사점이 함께 움직임)·skew 270(V 반대쪽)도 같은 식
    const c = beamPoint(COMPOUND.beams[9]!, 30)
    const ca = beamsAtPoint(COMPOUND, c)!
    expect(ca.w < 0.5 ? ca.b0 : ca.b1).toBe(9)
    const mirrored = { beams: SECTORIAL.beams.map((b) => ({ ...b, skewDeg: 270, vOffsetMm: -b.vOffsetMm })) }
    const mp = beamPoint(mirrored.beams[20]!, 30)
    const ma = beamsAtPoint(mirrored, mp)!
    expect(ma.w < 0.5 ? ma.b0 : ma.b1).toBe(20)
  })
  it('TrueDepth = 포인터 깊이, SoundPath = 포인터 아래 빔 출사점에서 |P − E_b|', () => {
    expect(sscanGateValueAt(SECTORIAL, depthGate(SECTORIAL, 7, 28), { vMm: 3, depthMm: 12.5 })).toBe(12.5)
    const sg = pathGate(SECTORIAL, 10, 40)
    const bm = SECTORIAL.beams[14]!
    const p = beamPoint(bm, 25)
    expect(sscanGateValueAt(SECTORIAL, sg, p)).toBeCloseTo(25, 9)
    // S-scan 깊이 눈금자 다이아몬드와 같은 환산: 현재 빔 위에서 음로 = 깊이 / cosθ
    expect(sscanGateValueAt(SECTORIAL, sg, p)).toBeCloseTo(p.depthMm / Math.cos(bm.angleDeg * DEG), 9)
    // 빔 사이(호의 현 가운데)도 거의 그 음로 (섹토리얼 0.01 mm, 리니어는 1차 오차 없음)
    const a = beamPoint(SECTORIAL.beams[10]!, 25)
    const b = beamPoint(SECTORIAL.beams[11]!, 25)
    expect(Math.abs(sscanGateValueAt(SECTORIAL, sg, { vMm: (a.vMm + b.vMm) / 2, depthMm: (a.depthMm + b.depthMm) / 2 }) - 25)).toBeLessThan(0.01)
    const lg = pathGate(LINEAR, 15, 45)
    const q = beamPoint(LINEAR.beams[10]!, 20)
    expect(Math.abs(sscanGateValueAt(LINEAR, lg, { vMm: q.vMm + 0.3, depthMm: q.depthMm }) - 20)).toBeLessThan(0.005)
    const c = beamPoint(COMPOUND.beams[5]!, 33)
    expect(sscanGateValueAt(COMPOUND, pathGate(COMPOUND, 10, 40), c)).toBeCloseTo(33, 6)
  })
  it('sscanPointAtCss: 요소 왼쪽 위 = 창 시작, 배율과 무관', () => {
    expect(sscanPointAtCss(VIEW, 500, 250, 0, 0)).toEqual({ vMm: -50, depthMm: 0 })
    expect(sscanPointAtCss(VIEW, 500, 250, 250, 125)).toEqual({ vMm: 0, depthMm: 25 })
  })
  it('선의 값: TrueDepth 는 현재 빔 깊이, SoundPath 는 포인터 아래 빔 음로', () => {
    const g = depthGate(SECTORIAL, 7, 28)
    expect(sscanGateEdgeValue(SECTORIAL, g, 'start', 14)).toBeCloseTo(7, 9)
    expect(sscanGateEdgeValue(SECTORIAL, g, 'end', 30)).toBeCloseTo(28, 9)
    const sg = pathGate(SECTORIAL, 10, 40)
    expect(sscanGateEdgeValue(SECTORIAL, sg, 'end', 0, beamPoint(SECTORIAL.beams[20]!, 5))).toBeCloseTo(40, 9)
  })
})

describe('끌기 → 게이트 override 패치 (다이아몬드와 같은 뜻)', () => {
  const gate = depthGate(SECTORIAL, 7, 28)
  it('TrueDepth 시작: 포인터 깊이로 옮기고 폭 21 mm 유지 — 새 선이 포인터를 지난다', () => {
    const patch = sscanGateDragPatchAt(ptr(SECTORIAL, gate, 14, 300, px(0, 12).y), 'start')
    expect(patch).toEqual({ startMm: 12 })
    const moved = applyGateOverride(gate, SECTORIAL, patch)
    expect(sscanGateLine(SECTORIAL, moved, 'start', 14, [-50, 50])[0]!.depthMm).toBeCloseTo(12, 9)
    expect(sscanGateLine(SECTORIAL, moved, 'end', 14, [-50, 50])[0]!.depthMm).toBeCloseTo(33, 6)
    expect(gateDisplayValues(moved, SECTORIAL).lengthMm).toBeCloseTo(21, 6)
    expect(gateWindowSignature({ ...SECTORIAL, ultrasound: US }, moved)).not.toBe(gateWindowSignature({ ...SECTORIAL, ultrasound: US }, gate))
  })
  it('TrueDepth 끝: 폭 = 포인터 깊이 − 시작 (그 빔에서 끝 선이 포인터를 지난다), 시작 시간은 파일 그대로', () => {
    const patch = sscanGateDragPatchAt(ptr(SECTORIAL, gate, 14, 300, px(0, 30).y), 'end')
    expect(patch.lengthMm).toBeCloseTo(23, 9)
    expect(patch.startMm).toBeUndefined()
    const w = applyGateOverride(gate, SECTORIAL, patch)
    expect(w.startUs).toEqual(gate.startUs)
    expect(sscanGateLine(SECTORIAL, w, 'end', 14, [-50, 50])[0]!.depthMm).toBeCloseTo(30, 6)
  })
  it('최소 폭 0.1 mm·시작 ≥ 0, 요소 밖 포인터는 가장자리로 자른다', () => {
    // 끝을 시작보다 위로
    expect(sscanGateDragPatchAt(ptr(SECTORIAL, gate, 14, 300, px(0, 4).y), 'end')).toEqual({ lengthMm: GATE_MIN_LENGTH_MM })
    // 창이 표면 위(−10 mm)까지 보일 때 맨 위로 끌어도 시작은 0
    const above: SscanGatePointer = { ...ptr(SECTORIAL, gate, 14, 300, -80), view: { ...VIEW, depthMinMm: -10 } }
    expect(sscanGateDragPatchAt(above, 'start')).toEqual({ startMm: 0 })
    // 아래로 요소 밖(캡처 중) = 맨 아래 깊이 50 mm
    expect(sscanGateDragPatchAt(ptr(SECTORIAL, gate, 14, 300, 400), 'start')).toEqual({ startMm: 50 })
    expect(sscanGateDragPatchAt(ptr(SECTORIAL, gate, 14, 900, px(0, 12).y), 'start')).toEqual({ startMm: 12 })
  })
  it('SoundPath(섹토리얼): 시작 = 포인터 아래 빔의 음로, 끝 = 음로 − 시작. 새 선이 포인터 가까이(≤ 0.01 mm)', () => {
    const sg = pathGate(SECTORIAL, 10, 40)
    const a = beamPoint(SECTORIAL.beams[17]!, 22)
    const b = beamPoint(SECTORIAL.beams[18]!, 22)
    const p = { vMm: (a.vMm + b.vMm) / 2, depthMm: (a.depthMm + b.depthMm) / 2 }
    const st = sscanGateDragPatch(SECTORIAL, sg, 'start', 0, p)
    expect(Math.abs(st.startMm! - 22)).toBeLessThan(0.01)
    const moved = applyGateOverride(sg, SECTORIAL, st)
    const line = sscanGateLine(SECTORIAL, moved, 'start', 0, [-50, 50]).map((q) => ({ x: q.vMm, y: q.depthMm }))
    expect(distanceToPolyline(line, p.vMm, p.depthMm)).toBeLessThan(0.01)
    // 폭은 파일 그대로 30 mm
    expect(gateDisplayValues(moved, SECTORIAL).lengthMm).toBeCloseTo(30, 6)
    const en = sscanGateDragPatch(SECTORIAL, sg, 'end', 0, beamPoint(SECTORIAL.beams[5]!, 35))
    expect(en.lengthMm).toBeCloseTo(25, 6)
  })
  it('SoundPath(리니어, 빔 평행): 빔 사이 포인터도 그 깊이의 음로 — 끌면 수평선이 포인터 깊이로', () => {
    const lg = pathGate(LINEAR, 15, 45)
    const q = beamPoint(LINEAR.beams[20]!, 30)
    const st = sscanGateDragPatch(LINEAR, lg, 'start', 0, { vMm: q.vMm + 0.25, depthMm: q.depthMm })
    expect(Math.abs(st.startMm! - 30)).toBeLessThan(0.005)
    const moved = applyGateOverride(lg, { ...LINEAR }, st)
    for (const p of sscanGateLine(LINEAR, moved, 'start', 0, [-50, 50])) expect(Math.abs(p.depthMm - q.depthMm)).toBeLessThan(0.005)
  })
  it('TrueDepth(리니어): 포인터 깊이 그대로', () => {
    const g = depthGate(LINEAR, 11, 29)
    expect(sscanGateDragPatchAt(ptr(LINEAR, g, 0, 100, px(0, 15).y), 'start')).toEqual({ startMm: 15 })
    expect(sscanGateDragPatchAt(ptr(LINEAR, g, 43, 100, px(0, 31).y), 'end').lengthMm).toBeCloseTo(20, 9)
  })
  it('리듀서 setGate 재사용: 손을 뗄 때 한 번 = 되돌리기 한 단계, 끌기 중 초안은 post 에 들어가지 않는다', () => {
    const patch = sscanGateDragPatchAt(ptr(SECTORIAL, gate, 14, 300, px(0, 12).y), 'start')
    const s0 = { post: defaultPost('abc'), history: [] }
    const s1 = postReducer(s0, { type: 'setGate', groupId: 0, gateId: 1, patch, unitMax: 200 })
    expect(s1.history).toHaveLength(1)
    expect(s1.post.groups[0]!.gates[1]).toEqual({ startMm: 12 })
    // 패치의 하한은 리듀서 하한과 같다 (리듀서가 다시 바꾸지 않음)
    const end = sscanGateDragPatchAt(ptr(SECTORIAL, gate, 14, 300, 0), 'end')
    expect(applyPostAction(defaultPost('abc'), { type: 'setGate', groupId: 0, gateId: 1, patch: end, unitMax: 200 }).groups[0]!.gates[1]).toEqual(end)
    expect(isDefaultPost(postReducer(s1, { type: 'undo' }).post)).toBe(true)
  })
})
