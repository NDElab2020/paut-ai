/** 후처리 모델·범위 계산 (shared/imaging/postprocess) 과 리듀서 (renderer viewer/postState) */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AMPLITUDE_PALETTE,
  DEG,
  MIN_SCAN_CELLS,
  POST_RULES_VERSION,
  WHEEL_PX_PER_TICK,
  adjustedParts,
  applyGateOverride,
  autoGainDb,
  bscanSampleAtY,
  bscanSampleAtYIn,
  bscanYForSample,
  bscanYForSampleIn,
  clampRange,
  convertGateGeometry,
  defaultPost,
  ensureScanVisible,
  gainedScale,
  gateDisplayValues,
  gateWindowSignature,
  isDefaultPost,
  normalizeRange,
  paletteRgb,
  panRange,
  rawIndexFactor,
  rawToIndex,
  rawToPercent,
  remapPalette,
  remapPaletteHex,
  renderBscan,
  saturatedPercent,
  sanitizePostProcess,
  scanAxisFull,
  scanWindowOf,
  soundPathMm,
  timeForSoundPathUs,
  wheelTicks,
  withGroupPost,
  zoomFactorOf,
  zoomRange,
  type MmRange,
  type RangeLimits,
  type ViewerGate,
  type ViewerGroup
} from '@shared/imaging'
import { applyPostAction, postReducer, type PostState } from '@shared/imaging'

const LIM: RangeLimits = { full: [0, 50], minWidth: 2 }
const AXIS = { offsetMm: 0, resolutionMm: 1, count: 301 }

describe('범위 계산', () => {
  it('clampRange: 기본 창 안, 최소 폭, 폭이 전체면 전체', () => {
    expect(clampRange([-5, 20], LIM)).toEqual([0, 25])
    expect(clampRange([40, 60], LIM)).toEqual([30, 50])
    expect(clampRange([10, 10.5], LIM)).toEqual([9.25, 11.25])
    expect(clampRange([-10, 70], LIM)).toEqual([0, 50])
    expect(clampRange([30, 10], LIM)).toEqual([10, 30])
  })
  it('zoomRange: 포인터가 가리키던 값이 같은 화면 위치에 남는다', () => {
    const r: MmRange = [10, 30]
    const z = zoomRange(r, 0.25, 1.25, LIM)
    expect(z[1] - z[0]).toBeCloseTo(16, 9)
    // anchor = 10 + 0.25·20 = 15 → 새 창에서도 25 % 위치
    expect(z[0] + 0.25 * (z[1] - z[0])).toBeCloseTo(15, 9)
    // 축소는 전체를 넘지 못한다
    expect(zoomRange([0, 50], 0.5, 1 / 1.25, LIM)).toEqual([0, 50])
    // 최소 폭에서 멈춘다
    expect(zoomRange([10, 12], 0.5, 1.25, LIM)[1] - zoomRange([10, 12], 0.5, 1.25, LIM)[0]).toBeCloseTo(2, 9)
  })
  it('panRange 와 normalizeRange', () => {
    expect(panRange([10, 30], 5, LIM)).toEqual([15, 35])
    expect(panRange([10, 30], 100, LIM)).toEqual([30, 50])
    expect(normalizeRange([0, 50], LIM.full)).toBeNull()
    expect(normalizeRange([0, 49.9], LIM.full)).toEqual([0, 49.9])
  })
  it('scanWindowOf: 100~200 mm → [100, 201), 격자 밖은 null, 최소 10칸', () => {
    expect(scanWindowOf(null, AXIS)).toEqual([0, 301])
    expect(scanWindowOf([100, 200], AXIS)).toEqual([100, 201])
    expect(scanWindowOf([150, 200], { offsetMm: 0, resolutionMm: 1, count: 101 })).toBeNull()
    expect(scanWindowOf([-50, -10], AXIS)).toBeNull()
    expect(scanWindowOf([99.6, 100.4], AXIS)).toEqual([100, 110])
    expect(scanWindowOf([295, 310], AXIS)).toEqual([291, 301])
    // 4.2 Comp 처럼 오프셋이 있는 격자 (42 mm 부터 45칸)
    const off = { offsetMm: 42, resolutionMm: 1, count: 45 }
    expect(scanWindowOf([50, 60], off)).toEqual([8, 19])
    expect(scanWindowOf([0, 10], off)).toBeNull()
    expect(scanAxisFull(off)).toEqual([42, 86])
    expect(MIN_SCAN_CELLS).toBe(10)
  })
  it('ensureScanVisible: 창 밖이면 같은 폭으로 밀고, 안이면 그대로, 전체면 null', () => {
    const full: MmRange = [0, 300]
    expect(ensureScanVisible([100, 200], 150, full)).toEqual([100, 200])
    expect(ensureScanVisible([100, 200], 250, full)).toEqual([150, 250])
    expect(ensureScanVisible([100, 200], 20, full)).toEqual([20, 120])
    expect(ensureScanVisible([100, 200], 300, full)).toEqual([200, 300])
    expect(ensureScanVisible(null, 250, full)).toBeNull()
  })
  it('wheelTicks: 마우스 한 노치(100 px) = 1틱, 트랙패드는 누적, ±3 으로 자름', () => {
    expect(wheelTicks(100, 0, 0)).toEqual({ ticks: 1, acc: 0 })
    expect(wheelTicks(-100, 0, 0)).toEqual({ ticks: -1, acc: 0 })
    let acc = 0
    let ticks = 0
    for (let i = 0; i < 10; i++) {
      const w = wheelTicks(15, 0, acc)
      acc = w.acc
      ticks += w.ticks
    }
    expect(ticks).toBe(1)
    expect(acc).toBeCloseTo(50, 9)
    expect(wheelTicks(3, 1, 0)).toEqual({ ticks: 0, acc: 48 })
    expect(wheelTicks(5000, 0, 0)).toEqual({ ticks: 3, acc: 0 })
    expect(WHEEL_PX_PER_TICK).toBe(100)
    expect(zoomFactorOf(-1)).toBeCloseTo(1.25, 9)
    expect(zoomFactorOf(2)).toBeCloseTo(1 / 1.5625, 9)
  })
})

const GROUPS = [
  { id: 0, gates: [{ id: 1, supported: true }], ampScale: { rawMax: 32767, unitMax: 200 } },
  { id: 1, gates: [{ id: 1, supported: true }], ampScale: { rawMax: 32767, unitMax: 200 } }
] as never as Parameters<typeof sanitizePostProcess>[1]['groups']

describe('PostProcess 모델', () => {
  it('기본값은 조정 없음이고 그룹 항목이 비어 있다', () => {
    const p = defaultPost('abc')
    expect(isDefaultPost(p)).toBe(true)
    expect(p.rulesVersion).toBe(POST_RULES_VERSION)
    expect(adjustedParts(p)).toEqual([])
  })
  it('withGroupPost: 기본값으로 돌아가면 그룹 항목을 지운다', () => {
    let p = withGroupPost(defaultPost('abc'), 0, { sscanV: [-10, 10] })
    expect(isDefaultPost(p)).toBe(false)
    expect(adjustedParts(p)).toEqual(['범위'])
    p = withGroupPost(p, 0, { sscanV: null })
    expect(p.groups[0]).toBeUndefined()
    expect(isDefaultPost(p)).toBe(true)
  })
  it('sanitize: 다른 파일·규칙·형식은 기본값 + 이유, 값은 클램프, 없는 그룹·게이트는 버림', () => {
    const ok = sanitizePostProcess({ ...defaultPost('abc'), sscanDepthMm: [5, 35], groups: { 0: { gainDb: 99, gates: { 1: { thresholdPct: 500 }, 7: { startMm: 1 } } }, 9: { gainDb: 3 } } }, { fileSha256: 'abc', groups: GROUPS })
    expect(ok.reason).toBeNull()
    expect(ok.post.sscanDepthMm).toEqual([5, 35])
    expect(ok.post.groups[0]!.gainDb).toBe(40)
    expect(ok.post.groups[0]!.gates).toEqual({ 1: { thresholdPct: 200 } })
    expect(ok.post.groups[9]).toBeUndefined()
    expect(sanitizePostProcess({ ...defaultPost('abc') }, { fileSha256: 'zzz', groups: GROUPS }).reason).toMatch(/다른 파일/)
    expect(sanitizePostProcess({ ...defaultPost('abc'), rulesVersion: 99 }, { fileSha256: 'abc', groups: GROUPS }).reason).toMatch(/규칙/)
    expect(sanitizePostProcess('garbage', { fileSha256: 'abc', groups: GROUPS })).toEqual({ post: defaultPost('abc'), reason: null })
    // 뒤집힌 범위·음수 깊이는 버리거나 0 으로
    const bad = sanitizePostProcess({ ...defaultPost('abc'), sscanDepthMm: [30, 5], scanRangeMm: [-3, 10] }, { fileSha256: 'abc', groups: GROUPS })
    expect(bad.post.sscanDepthMm).toBeNull()
    expect(bad.post.scanRangeMm).toEqual([-3, 10])
  })
})

describe('postReducer', () => {
  const init = (): PostState => ({ post: defaultPost('abc'), history: [] })
  it('줌 → 되돌리기 → 기본값, 이력 10단계', () => {
    let s = init()
    s = postReducer(s, { type: 'zoomSscan', axis: 'depth', groupId: 0, anchorFrac: 0.5, factor: 1.25, limits: LIM })
    expect(s.post.sscanDepthMm).toEqual([5, 45])
    s = postReducer(s, { type: 'undo' })
    expect(s.post.sscanDepthMm).toBeNull()
    expect(s.history).toHaveLength(0)
    // 전체 창을 미는 것은 변화가 없다(이력 없음). 창을 잡은 뒤 15번 밀면 이력은 10개까지만
    s = postReducer(s, { type: 'panScan', deltaMm: 1, limits: { full: [0, 300], minWidth: 10 } })
    expect(s.history).toHaveLength(0)
    s = postReducer(s, { type: 'setScanRange', range: [100, 200], limits: { full: [0, 300], minWidth: 10 } })
    for (let i = 0; i < 15; i++) s = postReducer(s, { type: 'panScan', deltaMm: 1, limits: { full: [0, 300], minWidth: 10 } })
    expect(s.post.scanRangeMm).toEqual([115, 215])
    expect(s.history).toHaveLength(10)
    expect(postReducer(s, { type: 'undo' }).history).toHaveLength(9)
  })
  it('변화 없는 액션은 같은 상태(참조 동일)를 돌려준다', () => {
    const s = init()
    expect(postReducer(s, { type: 'ensureScanVisible', cursorMm: 10, full: [0, 300] })).toBe(s)
    expect(postReducer(s, { type: 'setSscanDepth', range: [0, 50], limits: LIM })).toBe(s)
  })
  it('V 창은 그룹별, 깊이 창은 공통', () => {
    let p = defaultPost('abc')
    p = applyPostAction(p, { type: 'zoomSscan', axis: 'v', groupId: 1, anchorFrac: 0, factor: 2, limits: { full: [-30, 30], minWidth: 2 } })
    expect(p.groups[1]!.sscanV).toEqual([-30, 0])
    expect(p.groups[0]).toBeUndefined()
    p = applyPostAction(p, { type: 'setSscanDepth', range: [5, 35], limits: LIM })
    expect(p.sscanDepthMm).toEqual([5, 35])
    p = applyPostAction(p, { type: 'resetRanges', groupId: 0 })
    expect(p.sscanDepthMm).toBeNull()
    expect(p.groups[1]!.sscanV).toEqual([-30, 0])
    p = applyPostAction(p, { type: 'resetRanges', groupId: 'all' })
    expect(isDefaultPost(p)).toBe(true)
  })
  it('스캔 창: 커서 따라가기는 창이 있을 때만, C-scan 방향(세로축 뒤집기) 토글은 파일값 override', () => {
    let p = applyPostAction(defaultPost('abc'), { type: 'setScanRange', range: [100, 200], limits: { full: [0, 300], minWidth: 10 } })
    p = applyPostAction(p, { type: 'ensureScanVisible', cursorMm: 250, full: [0, 300] })
    expect(p.scanRangeMm).toEqual([150, 250])
    p = applyPostAction(p, { type: 'setCscanReversed', value: false })
    // 리니어(세로축 = 빔 번호)에도 맞게 기법과 무관한 이름
    expect(adjustedParts(p)).toEqual(['범위', 'C-scan 방향'])
    expect(isDefaultPost(applyPostAction(p, { type: 'resetAll' }))).toBe(true)
  })
  it('각도축 토글: 파일값과 같은 값으로 돌아오면 null (조정 아님)', () => {
    let p = applyPostAction(defaultPost('abc'), { type: 'setCscanReversed', value: false, fileValue: true })
    expect(p.cscanReversed).toBe(false)
    p = applyPostAction(p, { type: 'setCscanReversed', value: true, fileValue: true })
    expect(p.cscanReversed).toBeNull()
    expect(isDefaultPost(p)).toBe(true)
  })
  it('커서 따라가기(ensureScanVisible)는 되돌리기 이력에 들어가지 않는다', () => {
    let s = init()
    s = postReducer(s, { type: 'setScanRange', range: [100, 200], limits: { full: [0, 300], minWidth: 10 } })
    expect(s.history).toHaveLength(1)
    s = postReducer(s, { type: 'ensureScanVisible', cursorMm: 250, full: [0, 300] })
    expect(s.post.scanRangeMm).toEqual([150, 250])
    expect(s.history).toHaveLength(1)
    // 되돌리면 창을 잡기 전(전체)으로
    expect(postReducer(s, { type: 'undo' }).post.scanRangeMm).toBeNull()
  })
  it('resetScan · resetPalette 는 한 액션 = 되돌리기 한 단계', () => {
    let s = init()
    s = postReducer(s, { type: 'setScanRange', range: [100, 200], limits: { full: [0, 300], minWidth: 10 } })
    s = postReducer(s, { type: 'setCscanReversed', value: false, fileValue: true })
    s = postReducer(s, { type: 'setPalette', minPct: 20, maxPct: 80 })
    s = postReducer(s, { type: 'setAmpAxis', groupId: 0, maxPct: 200 })
    expect(s.history).toHaveLength(4)
    s = postReducer(s, { type: 'resetScan' })
    expect(s.post.scanRangeMm).toBeNull()
    expect(s.post.cscanReversed).toBeNull()
    expect(s.history).toHaveLength(5)
    s = postReducer(s, { type: 'resetPalette', groupId: 0 })
    expect(isDefaultPost(s.post)).toBe(true)
    expect(s.history).toHaveLength(6)
    s = postReducer(s, { type: 'undo' })
    expect(s.post.palette).toEqual({ minPct: 20, maxPct: 80 })
    expect(s.post.groups[0]!.ampAxisMaxPct).toBe(200)
    // 이미 기본값이면 변화 없음 → 같은 상태
    const d = init()
    expect(postReducer(d, { type: 'resetScan' })).toBe(d)
    expect(postReducer(d, { type: 'resetPalette', groupId: 0 })).toBe(d)
  })
  it('범위 밖 값으로 클램프돼 결과가 같으면 이력이 늘지 않는다', () => {
    let s = init()
    s = postReducer(s, { type: 'setGain', groupId: 0, dB: 40 })
    const before = s
    expect(postReducer(s, { type: 'setGain', groupId: 0, dB: 99 })).toBe(before)
    expect(postReducer(s, { type: 'nudgeGain', groupId: 0, dB: 5 })).toBe(before)
  })
})

describe('B-scan 세로 창', () => {
  it('기본 창은 지금 규칙(샘플을 칸으로)과 같다', () => {
    expect(bscanSampleAtY(0, 100, 808)).toBeCloseTo(bscanSampleAtYIn(0, 100, -0.5, 807.5), 9)
    expect(bscanYForSample(10, 100, 808)).toBeCloseTo(bscanYForSampleIn(10, 100, -0.5, 807.5), 9)
    expect(bscanYForSampleIn(100, 200, 100, 300)).toBe(0)
    expect(bscanYForSampleIn(300, 200, 100, 300)).toBe(200)
  })
  it('창을 주면 그 샘플 구간만 세로로 펼친다', () => {
    const NS = 4
    const NB = 1
    const NT = 100
    const amp = new Int16Array(NS * NB * NT)
    // 포화(255)되지 않게 12000 (≈73 %) — 이웃 보간값과 구분되게
    amp[(2 * NB + 0) * NT + 60] = 12000
    const ID = new Uint8Array(768)
    for (let i = 0; i < 256; i++) ID[i * 3] = i
    const draw = (sampleFrom?: number, sampleTo?: number): number => {
      const H = NT // 기본 창이면 행 = 샘플
      const out = new Uint8Array(NS * H * 4)
      renderBscan({ group: { shape: [NS, NB, NT] }, amplitude: amp, status: null, beam: 0, width: NS, height: H, sampleFrom, sampleTo, indexFactor: rawIndexFactor({ rawMax: 32767, unitMax: 200 }), palette: ID, noData: [7, 7, 7], out })
      let best = -1
      let y = -1
      for (let p = 0; p < NS * H; p++) if (out[p * 4]! > best) {
        best = out[p * 4]!
        y = Math.floor(p / NS)
      }
      return y
    }
    expect(draw()).toBe(60)
    // 창 [50, 70] → 샘플 60 은 가운데(50 px)
    expect(Math.abs(draw(50, 70) - 50)).toBeLessThanOrEqual(1)
    // 창 [0, 50] → 샘플 60 은 밖 (가장 밝은 곳은 끝 샘플 50 에 고정된 값 = 0)
    expect(draw(0, 50)).toBe(0)
  })
})

describe('게이트 편집 (applyGateOverride)', () => {
  const NB = 31
  const beams: ViewerGroup['beams'] = Array.from({ length: NB }, (_, b) => ({ index: b, angleDeg: 40 + b, skewDeg: 90, velocityMps: 3242.8, uOffsetMm: 0, vOffsetMm: -38 + b * 0.3, t0Us: 8.052 }))
  const us = { resolutionUs: 0.04, count: 808 }
  const group = { beams, ultrasound: us }
  /** 깊이 창 d0..d1 을 빔별 시간으로 (파일이 TrueDepth 게이트를 저장하는 방식) */
  const depthGate = (d0: number, d1: number): ViewerGate => {
    const startUs = beams.map((b) => timeForSoundPathUs(b, d0 / Math.cos(b.angleDeg * DEG)))
    const endUs = beams.map((b) => timeForSoundPathUs(b, d1 / Math.cos(b.angleDeg * DEG)))
    return { id: 1, name: 'Gate A', geometry: 'TrueDepth', sync: 'Pulse', startUs, lengthUs: endUs.map((e, i) => e - startUs[i]!), thresholdPct: 20, supported: true, producesCscan: true }
  }
  const gateA = depthGate(7, 28)

  it('표시값: TrueDepth 는 깊이 7.0/21.0 mm, SoundPath 로 바꾸면 빔 0 의 음로', () => {
    const v = gateDisplayValues(gateA, group)
    expect(v.geometry).toBe('TrueDepth')
    expect(v.startMm).toBeCloseTo(7, 9)
    expect(v.lengthMm).toBeCloseTo(21, 9)
    const sp = convertGateGeometry(v, 'SoundPath', group)
    expect(sp.startMm).toBeCloseTo(7 / Math.cos(40 * DEG), 9)
    expect(convertGateGeometry(sp, 'TrueDepth', group).startMm).toBeCloseTo(7, 9)
  })
  it('override 없음·문턱만: 파일 배열을 참조 그대로 (서명 불변)', () => {
    expect(applyGateOverride(gateA, group, undefined)).toBe(gateA)
    const t = applyGateOverride(gateA, group, { thresholdPct: 5 })
    expect(t.startUs).toBe(gateA.startUs)
    expect(t.lengthUs).toBe(gateA.lengthUs)
    expect(t.thresholdPct).toBe(5)
    expect(gateWindowSignature(group, t)).toBe(gateWindowSignature(group, gateA))
  })
  it('시작 10 mm(폭 21 유지, OmniPC Start·Width): 모든 빔의 창이 같은 깊이 10~31 mm, 서명이 바뀐다', () => {
    const e = applyGateOverride(gateA, group, { startMm: 10 })
    expect(e.startUs).toHaveLength(NB)
    expect(e.supported).toBe(true)
    beams.forEach((beam, b) => {
      const c = Math.cos(beam.angleDeg * DEG)
      expect(soundPathMm(beam, e.startUs[b]!) * c).toBeCloseTo(10, 6)
      expect(soundPathMm(beam, e.startUs[b]! + e.lengthUs[b]!) * c).toBeCloseTo(31, 6)
    })
    expect(gateWindowSignature(group, e)).not.toBe(gateWindowSignature(group, gateA))
    // 파일값과 같은 숫자를 넣으면 창이 그대로 (오차 ≤ 0.5 샘플)
    const same = applyGateOverride(gateA, group, { startMm: 7, lengthMm: 21 })
    for (let b = 0; b < NB; b++) {
      expect(Math.abs(same.startUs[b]! - gateA.startUs[b]!)).toBeLessThanOrEqual(0.02)
      expect(Math.abs(same.lengthUs[b]! - gateA.lengthUs[b]!)).toBeLessThanOrEqual(0.02)
    }
  })
  it('형상 전환: SoundPath 로 바꾸면 빔 0 기준 음로로 환산되고 모든 빔이 같은 시간', () => {
    const sp = applyGateOverride(gateA, group, { geometry: 'SoundPath' })
    expect(sp.geometry).toBe('SoundPath')
    const r0 = 7 / Math.cos(40 * DEG)
    for (let b = 0; b < NB; b++) expect(soundPathMm(beams[b]!, sp.startUs[b]!)).toBeCloseTo(r0, 6)
  })
  it('리듀서 setGate: 문턱 클램프, 패치 병합, 폭 ≥ 0.1 mm, 파일값으로', () => {
    let p = applyPostAction(defaultPost('abc'), { type: 'setGate', groupId: 0, gateId: 1, patch: { thresholdPct: 500 }, unitMax: 200 })
    p = applyPostAction(p, { type: 'setGate', groupId: 0, gateId: 1, patch: { startMm: -3 }, unitMax: 200 })
    expect(p.groups[0]!.gates[1]).toEqual({ thresholdPct: 200, startMm: 0 })
    p = applyPostAction(p, { type: 'setGate', groupId: 0, gateId: 1, patch: { lengthMm: 0 }, unitMax: 200 })
    expect(p.groups[0]!.gates[1]!.lengthMm).toBe(0.1)
    expect(adjustedParts(p)).toEqual(['게이트'])
    p = applyPostAction(p, { type: 'resetGate', groupId: 0, gateId: 1 })
    expect(isDefaultPost(p)).toBe(true)
  })
  it('폭만 바꾸면 각 빔의 시작 시간은 파일 그대로 (시간 하나로 저장된 4.x 게이트도)', () => {
    const w = applyGateOverride(gateA, group, { lengthMm: 10 })
    for (let b = 0; b < NB; b++) {
      expect(w.startUs[b]).toBe(gateA.startUs[b])
      const c = Math.cos(beams[b]!.angleDeg * DEG)
      expect(soundPathMm(beams[b]!, w.startUs[b]! + w.lengthUs[b]!) * c).toBeCloseTo(17, 6)
    }
    // 4.x 처럼 시간이 하나만 있는 게이트: 폭만 바꾸면 모든 빔이 그 하나의 시작을 쓰고, 끝은 빔별 깊이 17 mm
    const scalar: ViewerGate = { ...gateA, startUs: [gateA.startUs[0]!], lengthUs: [gateA.lengthUs[0]!] }
    const ws = applyGateOverride(scalar, group, { lengthMm: 10 })
    expect(ws.startUs).toHaveLength(NB)
    for (let b = 0; b < NB; b++) expect(ws.startUs[b]).toBe(scalar.startUs[0])
    // 시작만 바꾸면 끝은 그 빔의 파일 끝(깊이 28 mm) 이 아니라 '파일 폭 유지' (OmniPC Start·Width)
    const st = applyGateOverride(gateA, group, { startMm: 9 })
    for (let b = 0; b < NB; b++) {
      const c = Math.cos(beams[b]!.angleDeg * DEG)
      expect(soundPathMm(beams[b]!, st.startUs[b]! + st.lengthUs[b]!) * c).toBeCloseTo(30, 6)
    }
  })
})

describe('소프트 이득·색표 범위 (palette.ts)', () => {
  const SCALE = { rawMax: 32767, unitMax: 200 }
  it('gainedScale: 0 dB 는 같은 객체, 6.0206 dB 는 정확히 ×2, raw 262 +6 dB → 3.19 %, −6 dB → 0.80 %', () => {
    expect(gainedScale(SCALE, 0)).toBe(SCALE)
    expect(rawToPercent(16383.5, gainedScale(SCALE, 20 * Math.log10(2)))).toBeCloseTo(200, 6)
    expect(rawToPercent(262, gainedScale(SCALE, 6))).toBeCloseTo(3.19, 2)
    expect(rawToPercent(262, gainedScale(SCALE, -6))).toBeCloseTo(0.8, 2)
    expect(rawToPercent(262, gainedScale(SCALE, 6))).toBeCloseTo(rawToPercent(262, SCALE) * 10 ** (6 / 20), 9)
    // 134.75 % 에서 −6 dB → 67.5 %
    expect(rawToPercent(Math.round((134.75 / 200) * 32767), gainedScale(SCALE, -6))).toBeCloseTo(67.5, 1)
  })
  it('색 번호는 100 % 에서 포화(255), 읽기값은 unitMax 에서 포화', () => {
    const f6 = rawIndexFactor(gainedScale(SCALE, 6))
    expect(rawToIndex(16383, f6)).toBe(255)
    expect(rawToIndex(8300, f6)).toBe(255) // 50.7 % × 1.995 = 101 %
    expect(rawToIndex(8192, f6)).toBe(254) // 50.0 % × 1.995 = 99.76 %
    expect(rawToIndex(4096, f6)).toBe(Math.round(((4096 / 32767) * 200 * 10 ** (6 / 20)) * 2.55))
    expect(saturatedPercent(rawToPercent(32767, gainedScale(SCALE, 6)), SCALE)).toBe(200)
    expect(saturatedPercent(50, SCALE)).toBe(50)
  })
  it('Auto 80 %: 1.6 % → +33.98 dB, 25 % → +10.1 dB, 0 → null, 포화 전 값으로 계산(32767 raw +6 dB → −7.96 dB)', () => {
    expect(autoGainDb(1.6, 80)).toBeCloseTo(33.98, 2)
    expect(autoGainDb(25, 80)).toBeCloseTo(10.1, 1)
    expect(autoGainDb(0, 80)).toBeNull()
    const pct = rawToPercent(32767, gainedScale(SCALE, 6)) // 399 %, 포화 전
    expect(autoGainDb(pct, 80)).toBeCloseTo(-13.96, 2)
    expect(autoGainDb(200, 80)).toBeCloseTo(-7.96, 2)
  })
  it('remapPalette: (0, 100) 바이트 동일, (20, 80) 양 끝 색·단조, hex 판도 같은 규칙', () => {
    const rgb = paletteRgb(DEFAULT_AMPLITUDE_PALETTE)
    expect([...remapPalette(rgb, 0, 100)]).toEqual([...rgb])
    expect(remapPalette(rgb, 0, 100)).not.toBe(rgb)
    const r = remapPalette(rgb, 20, 80)
    // 20 % 이하는 첫 색, 80 % 이상은 마지막 색
    expect([...r.subarray(0, 3)]).toEqual([...rgb.subarray(0, 3)])
    expect([...r.subarray(Math.round(20 * 2.55) * 3, Math.round(20 * 2.55) * 3 + 3)]).toEqual([...rgb.subarray(0, 3)])
    expect([...r.subarray(255 * 3)]).toEqual([...rgb.subarray(255 * 3)])
    expect([...r.subarray(Math.round(80 * 2.55) * 3, Math.round(80 * 2.55) * 3 + 3)]).toEqual([...rgb.subarray(255 * 3)])
    // 색 번호 128(= 50.2 %) → 원래 색표의 (50.2−20)/60 번호 (50 × 2.55 는 부동소수로 127.49… 라 직접 128 을 쓴다)
    const i = 128
    const mid = Math.round(((i / 2.55 - 20) / 60) * 255)
    expect([...r.subarray(i * 3, i * 3 + 3)]).toEqual([...rgb.subarray(mid * 3, mid * 3 + 3)])
    const hex = remapPaletteHex(DEFAULT_AMPLITUDE_PALETTE, 20, 80)
    expect(hex).toHaveLength(256)
    expect(hex[0]).toBe(DEFAULT_AMPLITUDE_PALETTE[0])
    expect(hex[255]).toBe(DEFAULT_AMPLITUDE_PALETTE[255])
    expect(hex[i]).toBe(DEFAULT_AMPLITUDE_PALETTE[mid])
  })
  it('리듀서: 이득 클램프·0.1 단계, 색표 간격 ≥ 5 %, 진폭 축', () => {
    let p = applyPostAction(defaultPost('abc'), { type: 'nudgeGain', groupId: 0, dB: 0.1 })
    p = applyPostAction(p, { type: 'nudgeGain', groupId: 0, dB: 0.2 })
    expect(p.groups[0]!.gainDb).toBeCloseTo(0.3, 9)
    p = applyPostAction(p, { type: 'setGain', groupId: 0, dB: 99 })
    expect(p.groups[0]!.gainDb).toBe(40)
    expect(adjustedParts(p)).toEqual(['이득'])
    p = applyPostAction(p, { type: 'setPalette', minPct: 98, maxPct: 99 })
    expect(p.palette).toEqual({ minPct: 95, maxPct: 100 })
    p = applyPostAction(p, { type: 'setAmpAxis', groupId: 0, maxPct: 200 })
    expect(adjustedParts(p)).toEqual(['이득', '색표'])
    p = applyPostAction(p, { type: 'setGain', groupId: 0, dB: 0 })
    p = applyPostAction(p, { type: 'setPalette', minPct: 0, maxPct: 100 })
    p = applyPostAction(p, { type: 'setAmpAxis', groupId: 0, maxPct: 100 })
    expect(isDefaultPost(p)).toBe(true)
  })
})
