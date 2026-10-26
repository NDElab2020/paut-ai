/**
 * OPD → 이미지 보기 (core/opd/viewer.ts) — 실데이터 없이 시험용 OPD(synth.ts)로:
 *   ViewerFileInfo 채우기(출사점 V 부호·t0·샘플 간격·음속·게이트 빔 시간·추정 눈금·문턱 모름·기준 이득 0 → null·내장 색표·동기 모름),
 *   대조 표(VERIFIED)를 (형식·기법·스큐)로 넓혀도 NDE 결과는 그대로이고 OPD 표는 비어 있음,
 *   blockReason(대조 전·진폭 눈금 추정·형상 모름·자체 점검 실패·두께 불일치·손상 의심), 설명할 수 없는 게이트 A 어긋남 > 10 % 는 그리지 않음, 2축은 그리지 않음,
 *   조각 = uint8 → Int16Array + 상태(모두 0 인 프레임 = 0), 범위 오류·구조가 바뀌면 CONFLICT, 경로 확장자로 형식 고르기.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isVerifiedKind, verifiedKinds } from '@core/nde/viewer/meta'
import { parseOpdBuffer, selfCheckOpd, snellExitXMm } from '@core/opd'
import {
  OPD_AMPLITUDE_PATH,
  OPD_STATUS_PATH,
  OPD_VIEWER_NOTES,
  buildOpdViewerInfo,
  isOpdViewerGroup,
  opdExitVMm,
  opdKindLabel,
  opdSelfCheckPassed,
  viewerSelfCheckOf,
  readOpdViewerChunk,
  readOpdViewerInfo,
  readStoredViewerChunk,
  readStoredViewerInfo
} from '@core/opd/viewer'
import { DEG, composeBlockReason, gateSampleWindow as appGateWindow, rawToPercent } from '@shared/imaging'
import { withAlignmentThickness } from '../../../src/core/labels/export/exportTraining'
import { buildSynthOpd, SYNTH, synthSample } from './synth'

const work = mkdtempSync(join(tmpdir(), 'paut-opd-viewer-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const ANCHOR = 0x30f4

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'OK'
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

/** f64 칸 하나 바꾼 사본 */
function patchF64(bytes: Uint8Array, pos: number, v: number): Uint8Array {
  const out = bytes.slice()
  new DataView(out.buffer).setFloat64(pos, v, true)
  return out
}

describe('대조 표 (형식·기법·스큐): NDE 는 그대로, OPD 는 빈 표', () => {
  it('NDE 3.x 섹토리얼 · 4.x 컴파운드·리니어는 스큐와 무관하게 대조 완료, 4.x 섹토리얼은 대조 전', () => {
    expect(verifiedKinds('3.x')).toEqual(['pa-sectorial:*'])
    expect(verifiedKinds('4.x')).toEqual(['pa-compound:*', 'pa-linear:*'])
    for (const skew of [90, 270, 0, null]) {
      expect(isVerifiedKind('3.x', 'pa-sectorial', skew)).toBe(true)
      expect(isVerifiedKind('4.x', 'pa-compound', skew)).toBe(true)
      expect(isVerifiedKind('4.x', 'pa-linear', skew)).toBe(true)
      expect(isVerifiedKind('4.x', 'pa-sectorial', skew)).toBe(false)
      expect(isVerifiedKind('3.x', 'pa-linear', skew)).toBe(false)
    }
  })

  it('OPD 는 아직 아무 조합도 대조하지 않았다 (8단계 캡처 대조 뒤 스큐마다 올림)', () => {
    expect(verifiedKinds('opd')).toEqual([])
    for (const t of ['pa-sectorial', 'pa-linear'] as const) for (const s of [90, 270]) expect(isVerifiedKind('opd', t, s)).toBe(false)
  })
})

describe('ViewerFileInfo 채우기 (섹토리얼 · 스큐 90)', () => {
  const syn = buildSynthOpd({ beams: 4, positions: 6 })
  const file = parseOpdBuffer(syn.bytes)

  it('형식·버전·읽기 규칙·동기 모름·시편·화면 상태(내장 색표, 첫 빔 아래)', async () => {
    const info = await readOpdViewerInfo(syn.bytes)
    expect(info.formatFamily).toBe('opd')
    expect(info.version).toBe('OPD · MXU - 4.4R5')
    expect(info.reader).toEqual({ name: 'opd-structure', version: 4 })
    expect(info.scanSync).toBe('unknown')
    expect(info.specimen).toMatchObject({ shape: 'plate', thicknessMm: SYNTH.thicknessMm, weld: {
      hotPass: { heightMm: 10, angleDeg: 0 }, landHeightMm: 2, root: { heightMm: 0, angleDeg: 0 },
      offsetMm: 0, template: null, geometryEstimated: true, hazWidthMm: null, upperCap: null, lowerCap: null
    } })
    expect(info.display).toMatchObject({ paletteSource: 'default', layout: null, layoutGroupMode: null, currentGroupId: 0, cscanReversed: true })
    expect(info.display.palette).toHaveLength(256)
    expect(info.warnings[0]).toContain('공개되지 않은 형식')
    expect(info.warnings).toEqual(expect.arrayContaining([OPD_VIEWER_NOTES.amplitude, OPD_VIEWER_NOTES.threshold, OPD_VIEWER_NOTES.specimen]))
    expect(info.groups).toHaveLength(1)
  })

  it('그룹: 모양·바이트(int16)·추정 눈금·축·이득(기준 이득 0 → null)·진폭 위치', async () => {
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    expect(g).toMatchObject({
      id: 0,
      name: 'PA 1',
      technique: 'pa-sectorial',
      supported: true,
      reason: null,
      verified: false,
      amplitudePath: OPD_AMPLITUDE_PATH,
      statusPath: OPD_STATUS_PATH,
      shape: [6, 4, 320],
      bytes: 6 * 4 * 320 * 2,
      ampScale: { rawMax: 255, unitMax: 250, estimated: true },
      scan: { offsetMm: 0, resolutionMm: 1, count: 6 },
      cscanGateId: 1,
      initialBeam: 2,
      gainDb: 30,
      referenceGainDb: null,
      referenceAmplitudePct: 80,
      amplitudeSource: { kind: 'opd-raster', offset: syn.rasterOffset, frameBytes: 4 * 320, bitDepth: 8 }
    })
    expect(g.ultrasound.count).toBe(320)
    expect(g.ultrasound.resolutionUs).toBeCloseTo(SYNTH.rangeUs / 320, 12)
    expect(rawToPercent(255, g.ampScale)).toBe(250)
    expect(isOpdViewerGroup(g)).toBe(true)
  })

  it('빔: 출사점 V = 인덱스 오프셋 + 출사점 X (스큐 90, 보간 없이 빔 값), U = 0, t0 = A-scan 시작, 음속 = 그룹 음속', async () => {
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    g.beams.forEach((b, i) => {
      const ob = file.beams[i]!
      expect(b).toMatchObject({ index: i, angleDeg: 45 + i, skewDeg: 90, velocityMps: SYNTH.velocity, uOffsetMm: 0, t0Us: SYNTH.t0Us })
      expect(b.vOffsetMm).toBeCloseTo(-14 + ob.exitXMm, 9)
      expect(b.vOffsetMm).toBeCloseTo(-14 + snellExitXMm(file, ob), 9)
    })
  })

  it('게이트 I·A·B: 깊이 시간 ÷ cos θ = 빔 시간 (빔마다), TrueDepth·Pulse, 문턱 모름(null), C-scan 은 A', async () => {
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    expect(g.gates.map((x) => [x.id, x.name, x.geometry, x.sync, x.thresholdPct, x.supported, x.producesCscan])).toEqual([
      [0, 'Gate I', 'TrueDepth', 'Pulse', null, true, false],
      [1, 'Gate A', 'TrueDepth', 'Pulse', null, true, true],
      [2, 'Gate B', 'TrueDepth', 'Pulse', null, true, false]
    ])
    const a = g.gates[1]!
    g.beams.forEach((b, i) => {
      const c = Math.cos(b.angleDeg * DEG)
      expect(a.startUs[i]).toBeCloseTo(SYNTH.gateA.startDepthUs / c, 12)
      expect(a.lengthUs[i]).toBeCloseTo(SYNTH.gateA.widthDepthUs / c, 12)
      expect(g.gates[0]!.startUs[i]).toBeCloseTo(0.2 / c, 12)
      // 앱의 게이트 창(반올림)과 장비 저장 창(올림·내림)은 양 끝에서 한 샘플까지 다를 수 있다
      const [i0, i1] = appGateWindow(g, a, i)
      const lo = Math.ceil((a.startUs[i]! - b.t0Us) / g.ultrasound.resolutionUs - 1e-6)
      const hi = Math.floor((a.startUs[i]! + a.lengthUs[i]! - b.t0Us) / g.ultrasound.resolutionUs + 1e-6)
      expect(Math.abs(i0 - lo)).toBeLessThanOrEqual(1)
      expect(Math.abs(i1 - 1 - hi)).toBeLessThanOrEqual(1)
    })
  })

  it('자체 점검이 통과해도 대조 표가 비어 있어 verified = false, 이유 = 대조 전 · 진폭 눈금 추정 · 형상 모름', async () => {
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    expect(g.selfCheck).toMatchObject({
      gateAAgreement: 1,
      gateAAgreementAll: 1,
      gateAUnexplained: 0,
      suspectFrames: 0,
      thicknessMismatch: false,
      emptyFrames: 0,
      passed: { gateA: true, snell: true, thickness: true }
    })
    expect(g.selfCheck!.snellMaxDiffMm).toBeLessThan(1e-9)
    expect(opdSelfCheckPassed(g.selfCheck!)).toBe(true)
    expect(g.verified).toBe(false)
    expect(g.blockReasons!.map((r) => r.code)).toEqual(['unverified-kind', 'amp-scale', 'specimen-shape'])
    expect(g.blockReason).toBe(
      `OPD 파일이라 자동 변환·학습 내보내기를 막습니다: OmniPC 대조 전(${opdKindLabel('pa-sectorial', 90)}) · 진폭 눈금 추정(raw 255 = 250 %, 캡처 O1·O2 대조 전) · 시편 형상 모름(판재로 근사).`
    )
    expect(g.blockReason).toBe(composeBlockReason(g.blockReasons!))
    expect(opdKindLabel('pa-sectorial', 90)).toBe('OPD 섹토리얼 · 스큐 90')
  })
})

describe('스큐 270 · 리니어 · TCG 없음 · 2축', () => {
  it('스큐 270: 출사점 V = 인덱스 오프셋 − 출사점 X (대칭, 추정) — V 가 + 쪽에서 −V 로 나아감', async () => {
    const syn = buildSynthOpd({ skewDeg: 270 })
    const file = parseOpdBuffer(syn.bytes)
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    expect(g.supported).toBe(true)
    g.beams.forEach((b, i) => {
      expect(b.skewDeg).toBe(270)
      expect(b.vOffsetMm).toBeCloseTo(14 - file.beams[i]!.exitXMm, 9)
    })
    expect(g.blockReason).toContain('OPD 섹토리얼 · 스큐 270')
    expect((await readOpdViewerInfo(syn.bytes)).warnings).toContain(OPD_VIEWER_NOTES.skew270)
    expect((await readOpdViewerInfo(buildSynthOpd().bytes)).warnings).not.toContain(OPD_VIEWER_NOTES.skew270)
    expect(opdExitVMm(14, -20, 270)).toBe(34)
    expect(opdExitVMm(-14, -20, 90)).toBe(-34)
    expect(opdExitVMm(0, 1, 0)).toBeNull()
  })

  it('리니어 60°: pa-linear, 빔 배치 점검 통과(출사점이 한쪽으로 늘어섬)', async () => {
    const g = (await readOpdViewerInfo(buildSynthOpd({ formation: 'linear', beams: 5 }).bytes)).groups[0]!
    expect([g.technique, g.supported, g.reason]).toEqual(['pa-linear', true, null])
    expect(g.beams.every((b) => b.angleDeg === 60)).toBe(true)
    expect(g.blockReason).toContain('OPD 리니어 · 스큐 90')
  })

  it('TCG 없는 빔 기록(6.4T 배치)도 같은 게이트 칸', async () => {
    const g = (await readOpdViewerInfo(buildSynthOpd({ tcgNames: 0 }).bytes)).groups[0]!
    expect(g.supported).toBe(true)
    expect(g.gates[1]!.startUs[0]).toBeCloseTo(SYNTH.gateA.startDepthUs / Math.cos(45 * DEG), 12)
  })

  it('2축(부식 맵핑)은 그리지 않고 자체 점검도 하지 않는다 → 조각 요청은 NDE_UNSUPPORTED', async () => {
    const syn = buildSynthOpd({ formation: 'linear', beams: 3, positions: 8, indexLines: 2 })
    const info = await readOpdViewerInfo(syn.bytes)
    const g = info.groups[0]!
    expect([g.supported, g.verified, g.blockReason]).toEqual([false, false, null])
    expect(g.reason).toBe('2축 스캔(부식 맵핑, 인덱스 2줄)은 아직 그리지 않습니다.')
    expect(g.selfCheck).toBeUndefined()
    expect(info.display.currentGroupId).toBeNull()
    expect(await code(readOpdViewerChunk(syn.bytes, g, 0, 1))).toBe('NDE_UNSUPPORTED')
  })
})

describe('blockReason: 자체 점검 실패 · 두께 불일치', () => {
  it('두께 칸이 채움 높이 + 랜드와 다르면 이유에 붙고 경고에도 있다', async () => {
    const syn = buildSynthOpd()
    const bytes = patchF64(syn.bytes, ANCHOR - 0x510, 0.005) // 25 mm ≠ 10 + 2
    const info = await readOpdViewerInfo(bytes)
    const g = info.groups[0]!
    expect(g.selfCheck).toMatchObject({ thicknessMismatch: true, passed: { thickness: false } })
    expect(g.blockReason).toContain('두께 칸 5 mm 가 Hot Pass + Land + Root 12 mm 와 다름')
    expect(info.warnings.some((w) => w.includes('두께 칸(5 mm)'))).toBe(true)
    expect(info.specimen.thicknessMm).toBe(5)
  })

  it('학습 내보내기: 파일 정렬에 실측 두께가 있으면 두께 칸 의심 이유만 뺀다 (NDE 정보는 같은 객체 그대로)', async () => {
    const info = await readOpdViewerInfo(patchF64(buildSynthOpd().bytes, ANCHOR - 0x510, 0.005))
    const g = info.groups[0]!
    expect(g.blockReasons!.map((r) => r.code)).toContain('thickness')
    expect(withAlignmentThickness(info, null)).toBe(info)
    expect(withAlignmentThickness(info, 0)).toBe(info)
    const aligned = withAlignmentThickness(info, 13.5)
    const ga = aligned.groups[0]!
    expect(ga.blockReasons!.map((r) => r.code)).toEqual(g.blockReasons!.map((r) => r.code).filter((c) => c !== 'thickness'))
    expect(ga.blockReason).toBe(composeBlockReason(ga.blockReasons!))
    expect(ga.blockReason).not.toContain('두께 칸')
    expect(info.groups[0]!.blockReason).toContain('두께 칸') // 원본은 그대로
    // 두께 이유가 없는 파일은 같은 객체
    const plain = await readOpdViewerInfo(buildSynthOpd().bytes)
    expect(withAlignmentThickness(plain, 13.5)).toBe(plain)
  })

  it('장비 게이트 결과와 맞지 않으면(게이트 A 재계산 일치율 < 95 %) 이유에 붙는다', async () => {
    const syn = buildSynthOpd({ beams: 4, positions: 6 })
    const bytes = syn.bytes.slice()
    const gr = syn.rasterOffset + 6 * 4 * 320
    // 장비 값이 모두 재계산보다 크다(장비가 더 넓게 봤다로 설명은 됨) → 일치율 0 %, 그림은 그림
    for (let p = 0; p < 6; p++) for (let b = 0; b < 4; b++) bytes[gr + ((p * 4 + b) * 3 + 1) * 12 + 8] = 255
    const g = (await readOpdViewerInfo(bytes)).groups[0]!
    expect([g.supported, g.selfCheck!.passed.gateA, g.selfCheck!.gateAUnexplained]).toEqual([true, false, 0])
    expect(g.blockReason).toContain('게이트 A 재계산 일치율 저장 구간 안 0.0 % · 전체 0.0 % (기준 95 %)')
  })

  it('재계산이 장비 값보다 큰 칸이 10 % 를 넘으면 래스터 배치를 믿을 수 없어 그리지 않는다 (보류(해석 실패))', async () => {
    const syn = buildSynthOpd({ beams: 4, positions: 6 })
    const bytes = syn.bytes.slice()
    const gr = syn.rasterOffset + 6 * 4 * 320
    for (let p = 0; p < 6; p++) for (let b = 0; b < 4; b++) bytes[gr + ((p * 4 + b) * 3 + 1) * 12 + 8] = 1
    const info = await readOpdViewerInfo(bytes)
    const g = info.groups[0]!
    expect(g.selfCheck!.gateAUnexplained).toBe(1)
    expect([g.supported, g.verified, g.blockReason]).toEqual([false, false, null])
    expect(g.reason).toMatch(/^보류\(해석 실패\): 래스터에서 다시 계산한 게이트 A 가 장비 저장 값보다 큰 칸이 100.0 %/)
    expect(info.display.currentGroupId).toBeNull()
    expect(await code(readOpdViewerChunk(bytes, g, 0, 1))).toBe('NDE_UNSUPPORTED')
  })

  it('래스터만 0 으로 지워진 프레임(장비 게이트 값은 남음) = 손상 의심 → 통과로 보지 않고 이유에 붙는다', async () => {
    const syn = buildSynthOpd({ beams: 4, positions: 6 })
    const bytes = syn.bytes.slice()
    bytes.fill(0, syn.rasterOffset + 2 * 4 * 320, syn.rasterOffset + 4 * 4 * 320)
    const g = (await readOpdViewerInfo(bytes)).groups[0]!
    expect(g.selfCheck).toMatchObject({ emptyFrames: 2, suspectFrames: 2, passed: { gateA: true } })
    expect(opdSelfCheckPassed(g.selfCheck!)).toBe(false)
    expect(g.blockReasons!.find((r) => r.code === 'suspect-frames')?.text).toBe('손상 의심 프레임 2개(래스터 0 · 장비 게이트 값 있음)')
  })

  it('buildOpdViewerInfo 에 자체 점검 없이 주면(점검을 못 함) 막는다', () => {
    const file = parseOpdBuffer(buildSynthOpd().bytes)
    const g = buildOpdViewerInfo(file, null).groups[0]!
    expect(g.supported).toBe(true)
    expect(g.selfCheck).toBeUndefined()
    expect(g.blockReason).toContain('자체 점검을 하지 못함')
  })

  it('게이트가 저장 구간 밖까지 걸쳐 판정을 못 하면(저장 구간 안 칸 없음) 전체 칸 일치율이 높아도 판정 못 함(null) — 대조 전 (판단.md 3.2)', async () => {
    const syn = buildSynthOpd()
    const file = parseOpdBuffer(syn.bytes)
    const check = await selfCheckOpd(syn.bytes, { file })
    const sc = viewerSelfCheckOf({ ...check, gateA: { ...check.gateA, insideRate: null, insideMatched: 0, insideTotal: 0 }, passed: { ...check.passed, gateA: null } })
    expect(sc).toMatchObject({ gateAAgreement: null, gateAAgreementAll: 1, passed: { gateA: null } })
    expect(opdSelfCheckPassed(sc)).toBe(false)
    const g = buildOpdViewerInfo(file, { ...check, gateA: { ...check.gateA, insideRate: null, insideMatched: 0, insideTotal: 0 }, passed: { ...check.passed, gateA: null } }).groups[0]!
    expect(g.selfCheck!.passed.gateA).toBeNull()
    expect(g.blockReason).toContain('게이트 A 일치율을 판정하지 못함(저장 구간 안 칸 없음, 전체 100.0 %)')
    // 뷰어는 core 판정·메모를 그대로 옮긴다 (따로 '통과로 봄' 같은 말을 더하지 않음)
    expect(g.selfCheck!.notes).toEqual(check.notes)
  })
})

describe('조각: uint8 → Int16Array, 상태 = 빈 프레임 0', () => {
  const syn = buildSynthOpd({ beams: 4, positions: 6 })

  it('값은 래스터 바이트 그대로, 상태는 모두 1', async () => {
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    const c = await readOpdViewerChunk(syn.bytes, g, 1, 3)
    expect(c.amplitude).toBeInstanceOf(Int16Array)
    expect([c.groupId, c.scanStart, c.scanCount]).toEqual([0, 1, 3])
    expect(c.amplitude.length).toBe(3 * 4 * 320)
    for (let k = 0; k < 3; k++) for (let b = 0; b < 4; b++) for (const s of [0, 7, 319]) expect(c.amplitude[(k * 4 + b) * 320 + s]).toBe(synthSample(1 + k, b, s))
    expect(Array.from(c.status!)).toEqual(new Array(12).fill(1))
  })

  it('모두 0 인 프레임은 상태 0 (그 프레임의 모든 빔)', async () => {
    const bytes = syn.bytes.slice()
    bytes.fill(0, syn.rasterOffset + 2 * 4 * 320, syn.rasterOffset + 3 * 4 * 320)
    // 장비 게이트 결과도 0 (끝까지 못 간 스캔과 같은 모양 — 손상 의심이 아님)
    bytes.fill(0, syn.rasterOffset + 6 * 4 * 320 + 2 * 4 * 36, syn.rasterOffset + 6 * 4 * 320 + 3 * 4 * 36)
    const g = (await readOpdViewerInfo(bytes)).groups[0]!
    expect(g.selfCheck!.emptyFrames).toBe(1)
    expect(g.selfCheck!.suspectFrames).toBe(0)
    const c = await readOpdViewerChunk(bytes, g, 0, 6)
    expect(Array.from(c.status!)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('끝을 넘는 칸 수는 그룹 끝에서 자르고, 범위 밖은 INVALID_ARGUMENT', async () => {
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    expect((await readOpdViewerChunk(syn.bytes, g, 4, 100)).scanCount).toBe(2)
    for (const [s, n] of [[-1, 1], [6, 1], [0, 0], [0.5, 1]] as const) expect(await code(readOpdViewerChunk(syn.bytes, g, s, n))).toBe('INVALID_ARGUMENT')
  })

  it('열 때와 래스터 위치·모양이 다르면 CONFLICT (다른 파일을 같은 그룹으로 읽지 않음)', async () => {
    const g = (await readOpdViewerInfo(syn.bytes)).groups[0]!
    expect(await code(readOpdViewerChunk(syn.bytes, { ...g, amplitudeSource: { ...g.amplitudeSource!, offset: g.amplitudeSource!.offset + 2 } }, 0, 1))).toBe('CONFLICT')
    const other = buildSynthOpd({ beams: 4, positions: 7 })
    expect(await code(readOpdViewerChunk(other.bytes, g, 0, 1))).toBe('CONFLICT')
    expect(await code(readOpdViewerChunk(syn.bytes, { ...g, amplitudeSource: undefined }, 0, 1))).toBe('NDE_UNSUPPORTED')
  })
})

describe('형식 고르기: 저장된 사본 경로 (.opd → OPD)', () => {
  it('readStoredViewerInfo·readStoredViewerChunk 가 .opd 사본을 OPD 로 읽는다', async () => {
    const syn = buildSynthOpd({ beams: 4, positions: 6 })
    const path = join(work, 'SYN-01.OPD')
    writeFileSync(path, syn.bytes)
    const info = await readStoredViewerInfo(path)
    expect(info.formatFamily).toBe('opd')
    expect(info).toEqual(await readOpdViewerInfo(syn.bytes))
    const c = await readStoredViewerChunk(path, info.groups[0]!, 0, 6)
    expect(c.amplitude).toBeInstanceOf(Int16Array)
    expect(Array.from(c.amplitude)).toEqual(Array.from((await readOpdViewerChunk(syn.bytes, info.groups[0]!, 0, 6)).amplitude))
  })

  it('.opd 가 아닌 경로는 NDE 로 읽는다 (OPD 바이트를 .nde 로 두면 NDE 읽기 오류)', async () => {
    const path = join(work, 'SYN-01.nde')
    writeFileSync(path, buildSynthOpd().bytes)
    const c = await code(readStoredViewerInfo(path))
    expect(c).not.toBe('OK')
    expect(c).not.toBe('INTERNAL')
  })
})
