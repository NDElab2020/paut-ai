/**
 * OmniPC 설정 읽기 (OmniPC_조사/조사_보고.md 6절 X2·X7·L1·L4·L5·L6·L7, 2026-10-07).
 *   - 읽은 값 = OmniPC_조사/4_NDE설정.md 의 파일 값 (우리 데이터 파일 덤프 — 허용 근거 (c))
 *   - 기존 결과 불변: 새 칸을 빼면 새 입력(BusinessSetup·측정값 목록·출처) 없이 만든 결과와 같다 (X3·X4 TF·공식 예제 11개)
 *   - 덮개: ERW 파일만 바뀌고(이음매 선) VOffset 파일의 덮개선은 그대로
 * 원본은 읽기만 한다. 실데이터·예제가 없는 PC 에서는 건너뛴다.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openNde } from '@core/nde'
import { getPath, withH5File } from '@core/nde/h5'
import { readModelSetupXml, readSetup, supplementApplication } from '@core/nde/read'
import { buildViewerInfo, parseBusinessSetup, parseModelSetup, readImportOffsetWarnings, readViewerInfo } from '@core/nde/viewer'
import { createAppService } from '@core/service'
import { gateModes as fileGateModes, parseAppVersion, refBasisOf } from '@core/nde/viewer/meta'
import {
  EXPORT_OUTSIDE_SPECIAL_INDEX,
  SPECIAL_NO_DATA,
  SPECIAL_NO_DETECTION,
  SPECIAL_NO_SYNCHRO,
  VIEWER_NO_DATA_SPECIAL_INDEX,
  isDrawableWeld,
  weldOverlay,
  type ViewerFileInfo,
  type ViewerWeld
} from '@shared/imaging'
import { READINGS, formatReading, gateReadingLabel, readingByKey, readingByLabel, readingLabel, readingTooltip } from '@shared/imaging/readings'
import * as paletteModule from '@shared/imaging/palette'
import { MASK_RGB, OUTSIDE_RGB } from '@core/labels/export/images'
import { EX, HAS_EXAMPLES, HAS_X3 } from './core/nde/fixtures'
import { X3_FILES, X4_TF_COMPOUND, X4_TF_LINEAR, listExampleFiles } from './paths'

const HAS_TF = existsSync(X4_TF_COMPOUND) && existsSync(X4_TF_LINEAR)
/** X3·X4 저장 목록 'Custom' 10칸 (4_NDE설정.md 4.8, X3·TF 캡처와 같은 순서) */
const CUSTOM10 = ['APercent', 'DAPosition', 'PAPosition', 'SAPosition', 'ViAPosition', 'Umr', 'Imr', 'IUmr', 'Im', 'Um']

const infos = new Map<string, Promise<ViewerFileInfo>>()
const info = (p: string): Promise<ViewerFileInfo> => {
  let v = infos.get(p)
  if (!v) {
    v = readViewerInfo(p)
    infos.set(p, v)
  }
  return v
}
const group = (i: ViewerFileInfo, name: string) => i.groups.find((g) => g.name === name)!
const gateModes = (i: ViewerFileInfo, name: string): Array<[string, boolean | null | undefined, string | null | undefined, string | null | undefined]> =>
  group(i, name).gates.map((g) => [g.name, g.enabled, g.detection, g.event])

describe('측정값 표 (L1, shared/imaging/readings.ts)', () => {
  it('저장 목록 10칸은 캡처로 확인된 이름 그대로 (I•U, 빼기 기호)', () => {
    expect(CUSTOM10.map(readingLabel)).toEqual(['A%', 'DA^', 'PA^', 'SA^', 'ViA^', 'U(m−r)', 'I(m−r)', 'I•U(m−r)', 'I(m)', 'U(m)'])
    expect(CUSTOM10.every((k) => readingByKey(k)!.labelBasis === 'capture')).toBe(true)
    expect(CUSTOM10.map((k) => readingByKey(k)!.omnipcLabel)).toEqual(['A%', 'DA^', 'PA^', 'SA^', 'ViA^', 'U(m-r)', 'I(m-r)', 'I•U(m-r)', 'I(m)', 'U(m)'])
  })

  it('길이 = S(m−r)(스캔축), U(m−r) 는 초음파축 — 설명에 적혀 있다', () => {
    expect(readingByKey('Smr')!.label).toBe('S(m−r)')
    expect(readingByKey('Smr')!.description).toMatch(/스캔축.*길이/)
    expect(readingByKey('Umr')!.description).toMatch(/초음파축/)
    expect(readingByKey('Umr')!.description).toMatch(/길이가 아니다/)
    expect(readingByLabel('S(m-r)')).toBe(readingByKey('Smr'))
    expect(readingByKey('AdBA')!.description).toMatch(/문턱/)
    expect(readingByKey('AdBA')!.description).toMatch(/Ref.*아니다/)
  })

  it('소수 자리: 진폭 % 1자리, 위치·거리·dB 2자리 (캡처 표기), 없는 값은 ND', () => {
    expect(formatReading(readingByKey('APercent')!, 32.28)).toBe('32.3 %')
    expect(formatReading(readingByKey('DAPosition')!, 22.448)).toBe('22.45 mm')
    expect(formatReading(readingByKey('AdBA')!, -18.25)).toBe('−18.25 dB')
    expect(formatReading(readingByKey('APercent')!, null)).toBe('ND')
  })

  it('게이트 설정에 맞춘 이름 (L5): 문턱 교차 = /, 첫 봉우리 = 끝에 1, 우리 파일(최대·봉우리)은 그대로', () => {
    expect(gateReadingLabel('DA^', { detection: 'max', event: 'peak' })).toEqual({ label: 'DA^', changed: false })
    expect(gateReadingLabel('DA^', { detection: 'max', event: 'edge' })).toEqual({ label: 'DA/', changed: true })
    expect(gateReadingLabel('DA^', { detection: 'first', event: 'peak' })).toEqual({ label: 'DA^1', changed: true })
    expect(gateReadingLabel('A%', { detection: 'first', event: 'edge' })).toEqual({ label: 'A%1', changed: true })
    expect(gateReadingLabel('U(m−r)', { detection: 'first', event: 'edge' })).toEqual({ label: 'U(m−r)', changed: false })
    expect(gateReadingLabel('DA^', null)).toEqual({ label: 'DA^', changed: false })
  })

  it('4.4 에만 있는 측정값은 4.4 설명서로 표시, 뜻을 모르는 키는 확인 필요', () => {
    expect(readingByLabel('RA^')!.manuals).toEqual(['4.4'])
    expect(readingByLabel('RA^')!.key).toBeNull()
    expect(readingByKey('MaxPercentZ')!.manuals).toEqual([])
    expect(readingTooltip(readingByKey('MaxPercentZ')!)).toMatch(/확인 필요/)
    expect(readingTooltip(readingByKey('APercent')!)).toMatch(/MXU 설명서 4\.4·5\.6·5\.8/)
    // 키는 겹치지 않는다
    const keys = READINGS.map((r) => r.key).filter((k): k is string => k !== null)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('게이트 위치 기준 읽는 순서 (L5 — 2026-10-07 검토)', () => {
  const gate: ViewerFileInfo['groups'][number]['gates'][number] = {
    id: 1,
    name: 'Gate A',
    geometry: 'TrueDepth',
    sync: 'Pulse',
    startUs: [1],
    lengthUs: [2],
    thresholdPct: 20,
    supported: true,
    producesCscan: true
  }
  const raw4 = { processes: [{ outputs: [{ parameters: { gateId: 1, gateDetection: 'MaximumPeak' } }] }] }
  const bg = (eventType: string | null) => ({
    id: 0,
    hasReferenceGain: null,
    softGainDb: null,
    connectorId: null,
    gates: [{ id: 1, enabled: true, eventType, peakType: 'Highest' }]
  })
  it("4.x: 위치 기준은 XML EventType 을 gateDetection('MaximumPeak')보다 먼저 본다 — 'Crossing' 이면 문턱 교차", () => {
    const [g] = fileGateModes([gate], {}, raw4, '4.x', bg('Crossing'))
    expect(g).toMatchObject({ detection: 'max', event: 'edge', enabled: true })
  })
  it('4.x: XML 이 없거나 EventType 이 비면 그때만 gateDetection 으로 정한다', () => {
    expect(fileGateModes([gate], {}, raw4, '4.x', null)[0]).toMatchObject({ detection: 'max', event: 'peak', enabled: true })
    expect(fileGateModes([gate], {}, raw4, '4.x', bg(null))[0]).toMatchObject({ event: 'peak' })
  })
  it('3.x: JSON timeSelection 이 가장 먼저', () => {
    const body = { gates: [{ id: 1, peakDetection: 'First', timeSelection: 'Crossing' }] }
    expect(fileGateModes([gate], body, {}, '3.x', bg('Peak'))[0]).toMatchObject({ detection: 'first', event: 'edge' })
  })
})

describe('특수색 번호 상수 (X11 ① — 값은 그대로 나눔)', () => {
  it('설명서 순서 0·1·2, 뷰어·학습 내보내기 상수는 지금 모두 2(808080)', () => {
    expect([SPECIAL_NO_DATA, SPECIAL_NO_DETECTION, SPECIAL_NO_SYNCHRO]).toEqual([0, 1, 2])
    expect(VIEWER_NO_DATA_SPECIAL_INDEX).toBe(2)
    expect(EXPORT_OUTSIDE_SPECIAL_INDEX).toBe(2)
    // 옛 별칭(뷰어 값을 가리키던 NO_DATA_SPECIAL_INDEX)은 없다 — 뷰어 색을 바꿔도 내보내기 색이 따라가지 않게
    expect('NO_DATA_SPECIAL_INDEX' in paletteModule).toBe(false)
  })

  it('학습 그림 바깥 색은 내보내기 상수로 808080 고정, 가림 색(검정)과 다르다', () => {
    expect([...OUTSIDE_RGB]).toEqual([128, 128, 128])
    expect([...OUTSIDE_RGB]).not.toEqual([...MASK_RGB])
  })
})

describe('파일 출처 보충 (L6, read.ts)', () => {
  it('고친 앱 이름이 빠졌으면 이름만 ModelSetup 저장 앱으로, 아니면 그대로', () => {
    const props = { versionRaw: '4.0.0-Dev', createdRaw: null, modifiedRaw: null, appName: 'MXU', appVersion: '6.0.0.647' }
    expect(supplementApplication({ ...props, modifiedApp: { name: null, version: '6.0.0.647' } }, { name: 'OmniPC', version: '6.0.0-Alpha.647' })).toEqual({
      name: 'OmniPC',
      version: '6.0.0.647'
    })
    expect(supplementApplication({ ...props, modifiedApp: { name: 'MXU', version: '6.4.0.416' } }, { name: 'MXU', version: '6.4.0-release.416' })).toEqual({
      name: 'MXU',
      version: '6.0.0.647'
    })
    expect(supplementApplication({ ...props, appName: null, appVersion: null }, { name: 'MXU', version: '5.18.1-release.0' })).toEqual({ name: 'MXU', version: '5.18.1-release.0' })
    expect(supplementApplication(props, null)).toEqual({ name: 'MXU', version: '6.0.0.647' })
    expect(parseAppVersion('6.4.0-release.416')).toEqual([6, 4, 0])
    expect(parseAppVersion('5.17.1.1')).toEqual([5, 17, 1])
    expect(parseAppVersion(null)).toBeNull()
  })

  it.skipIf(!HAS_EXAMPLES)('4.0 공식 예제(OmniPC 6.0 이 다시 저장): 파일 메타 저장 앱 = OmniPC (그 밖의 예제는 그대로)', async () => {
    expect((await openNde(EX.manualPa40)).meta.application).toEqual({ name: 'OmniPC', version: '6.0.0.647' })
    expect((await openNde(EX.sect42)).meta.application).toEqual({ name: 'MXU', version: '6.4.0.416' })
  })
})

describe('Ref 근거 단계 (X2, 4_NDE설정.md 8.3-4)', () => {
  const beams = (n: number, pts: number) => Array.from({ length: n }, () => ({ tcg: { points: Array.from({ length: pts }, (_, i) => ({ time: i * 1e-6, gain: i })) } }))
  const cal = (v: boolean) => [{ sensitivityCalibration: { calibrated: true } }, { tcgCalibration: { calibrated: v } }]
  it('기준 이득 + TCG 보정 + 모든 빔 TCG 점 2개 이상 = tcg, 하나라도 빠지면 single-depth, 기준 이득 없으면 none', () => {
    expect(refBasisOf({ referenceGain: 18.7, calibrationStates: cal(true), beams: beams(3, 4) }, true)).toBe('tcg')
    expect(refBasisOf({ referenceGain: 18.7, calibrationStates: cal(false), beams: beams(3, 4) }, true)).toBe('single-depth')
    expect(refBasisOf({ referenceGain: 18.7, calibrationStates: cal(true), beams: [...beams(2, 4), ...beams(1, 1)] }, null)).toBe('single-depth')
    expect(refBasisOf({ referenceGain: 0, calibrationStates: cal(true), beams: beams(3, 4) }, null)).toBe('none')
    expect(refBasisOf({ referenceGain: 18.7, calibrationStates: cal(true), beams: beams(3, 4) }, false)).toBe('none')
  })
})

describe('BusinessSetup 읽기 (가짜 XML)', () => {
  it('그룹 SoftGain·기준 이득·첫 빔 게이트, 탐촉자 위치(m → mm), FMC 묶음은 뺀다', () => {
    const gs = (id: number, on: boolean, ev: string) =>
      `<GateSetup><ID>${id}</ID><IsEnabled>${on}</IsEnabled><Start>1</Start><Threshold>10</Threshold><EventType>${ev}</EventType><PeakType>Highest</PeakType></GateSetup>`
    const xml = `<BusinessSetup><DeviceSetups><DeviceSetup>
      <PhasedArrayTechnology><Connectors><PhasedArrayConnectorSetup><PhasedArrayProbeAssemblySetups>
        <PhasedArrayProbeAssemblySetup><Identifier>1009</Identifier><Probe/>
          <PulserPositioningSetup><ScanOffset>0</ScanOffset><IndexOffset>0.026000000000000002</IndexOffset><SkewAngle>90</SkewAngle><AnalysisScanOffset>0</AnalysisScanOffset><AnalysisIndexOffset>-0.052000000000000005</AnalysisIndexOffset></PulserPositioningSetup>
          <ReceiverPositioningSetup><ScanOffset>0</ScanOffset><IndexOffset>0.026</IndexOffset><SkewAngle>270</SkewAngle></ReceiverPositioningSetup>
          <ProbeOffsetReference>WedgeStart</ProbeOffsetReference>
        </PhasedArrayProbeAssemblySetup></PhasedArrayProbeAssemblySetups></PhasedArrayConnectorSetup></Connectors></PhasedArrayTechnology>
      <FullMatrixCaptureTechnology><ContextGroupSetups><ContextGroupSetup><ID>0</ID><SoftGain>99</SoftGain></ContextGroupSetup></ContextGroupSetups></FullMatrixCaptureTechnology>
      <ContextGroupSetups><ContextGroupSetup><ID>0</ID><Gain>24.7</Gain><HasAReferenceGain>true</HasAReferenceGain><ReferenceGain>18.7</ReferenceGain><SoftGain>0</SoftGain>
        <ConnectorIdentifier>1009</ConnectorIdentifier><ContextSetups>
          <ContextSetup><ID>0</ID><GateSetups>${gs(0, false, 'Crossing')}${gs(1, true, 'Peak')}</GateSetups><GainOffset>0.8</GainOffset></ContextSetup>
          <ContextSetup><ID>1</ID><GateSetups>${gs(0, true, 'Peak')}${gs(1, false, 'Crossing')}</GateSetups></ContextSetup>
        </ContextSetups></ContextGroupSetup></ContextGroupSetups>
    </DeviceSetup></DeviceSetups></BusinessSetup>`
    const b = parseBusinessSetup(xml)
    expect(b.groups).toEqual([
      {
        id: 0,
        hasReferenceGain: true,
        softGainDb: 0,
        connectorId: 1009,
        gates: [
          { id: 0, enabled: false, eventType: 'Crossing', peakType: 'Highest' },
          { id: 1, enabled: true, eventType: 'Peak', peakType: 'Highest' }
        ]
      }
    ])
    expect(b.assemblies).toEqual([
      {
        id: 1009,
        pulser: { scanOffsetMm: 0, indexOffsetMm: 26, analysisScanOffsetMm: 0, analysisIndexOffsetMm: -52, reference: 'WedgeStart' },
        receiver: { scanOffsetMm: 0, indexOffsetMm: 26, analysisScanOffsetMm: null, analysisIndexOffsetMm: null, reference: 'WedgeStart' }
      }
    ])
    expect(parseBusinessSetup(null)).toEqual({ groups: [], assemblies: [] })
  })
})

describe.skipIf(!HAS_X3)('X3 12T-SV (3.3, MXU 5.18.1) = 4_NDE설정.md 값', () => {
  it('게이트 켜짐 I 꺼짐·A 켜짐·B 꺼짐, 모두 최대 봉우리, I = 문턱 교차(/)·A·B = 봉우리(^)', async () => {
    for (const p of X3_FILES) {
      const i = await info(p)
      for (const name of ['Skew90', 'Skew270']) {
        expect(gateModes(i, name)).toEqual([
          ['Gate I', false, 'max', 'edge'],
          ['Gate A', true, 'max', 'peak'],
          ['Gate B', false, 'max', 'peak']
        ])
      }
    }
  })

  it('Ref 근거 = TCG(보정 참, 31빔 × 4점), Ref 추정 159.6 %, SoftGain 0, 탐촉자 Index −15 / +15 mm (분석 오프셋 칸 없음)', async () => {
    const i = await info(X3_FILES[0]!)
    for (const g of i.groups) {
      expect(g.refBasis).toBe('tcg')
      expect(g.refPct!).toBeCloseTo(159.6, 1)
      expect(g.softGainDb).toBe(0)
    }
    expect(group(i, 'Skew90').positioning).toEqual({ scanOffsetMm: 0, indexOffsetMm: -15, analysisScanOffsetMm: null, analysisIndexOffsetMm: null, reference: null })
    expect(group(i, 'Skew270').positioning).toMatchObject({ indexOffsetMm: 15, analysisIndexOffsetMm: null })
  })

  it("저장된 측정값 목록 = 'Custom' 10칸 (두 그룹, ReadingListId 0), 덮개 VOffset, 출처 MXU 5.18.1 · MX3, 경고 없음", async () => {
    for (const p of X3_FILES) {
      const i = await info(p)
      expect(i.display.readings).toEqual([
        { groupId: 0, groupName: 'Skew90', keys: CUSTOM10, listId: 0 },
        { groupId: 1, groupName: 'Skew270', keys: CUSTOM10, listId: 0 }
      ])
      expect(i.specimen.weld!.template).toBe('VOffset')
      expect(i.source).toMatchObject({ createdBy: { name: 'MXU' }, platform: 'MX3', resavedByOmniPC: false, mxuVersion: '5.18.1', wedgeOffsetCaution: false, notes: [] })
      expect(i.warnings).toEqual([])
    }
  })
})

describe.skipIf(!HAS_TF)('X4 TF (4.2, MXU 6.6.0) = 4_NDE설정.md·5_보완_정리.md 1절 값', () => {
  it('게이트 A 만 JSON 에 있음(켜짐·MaximumPeak), Ref 근거 TCG·159.6 %, SoftGain 0, 분석 오프셋 0, 기준점 WedgeStart, 경고 없음', async () => {
    for (const p of [X4_TF_COMPOUND, X4_TF_LINEAR]) {
      const i = await info(p)
      for (const g of i.groups) {
        expect(g.gates.map((x) => [x.name, x.enabled, x.detection, x.event])).toEqual([['Gate A', true, 'max', 'peak']])
        expect(g.refBasis).toBe('tcg')
        expect(g.refPct!).toBeCloseTo(159.6, 1)
        expect(g.softGainDb).toBe(0)
        expect(g.positioning).toEqual({ scanOffsetMm: 0, indexOffsetMm: -14, analysisScanOffsetMm: 0, analysisIndexOffsetMm: 0, reference: 'WedgeStart' })
      }
      expect(i.source).toMatchObject({ platform: 'X4', mxuVersion: '6.6.0', resavedByOmniPC: false, wedgeOffsetCaution: false })
      expect(i.warnings).toEqual([])
      expect(i.specimen.weld!.template).toBe('VOffset')
    }
  })

  it('측정값 목록: TF_L GR-2 만 ReadingListId 1', async () => {
    const i = await info(X4_TF_LINEAR)
    expect(i.display.readings!.map((r) => [r.groupName, r.listId, r.keys.join()])).toEqual([
      ['GR-1', 0, CUSTOM10.join()],
      ['GR-2', 1, CUSTOM10.join()]
    ])
  })
})

describe.skipIf(!HAS_EXAMPLES)('공식 예제 = 4_NDE설정.md 값', () => {
  it('3.3·4.0 ManualWeldPA: TCG 없음·보정 안 됨 → Ref 근거 약함(single-depth), Ref 80 %', async () => {
    for (const p of [EX.manualPa33, EX.manualPa40]) {
      const g = (await info(p)).groups[0]!
      expect([g.refBasis, g.refPct]).toEqual(['single-depth', 80])
    }
  })

  it('4.0: OmniPC 6.0 으로 다시 저장 (ModelSetup 저장 앱), 만든 MXU 5.17.1', async () => {
    const s = (await info(EX.manualPa40)).source!
    expect(s).toMatchObject({ resavedByOmniPC: true, savedBy: { name: 'OmniPC', version: '6.0.0-Alpha.647' }, mxuVersion: '5.17.1', platform: 'MX3', wedgeOffsetCaution: false })
    expect(s.notes.join(' ')).toMatch(/OmniPC.*다시 저장/)
  })

  it('4.2 Comp: comp8qty Ref 추정 241.6 % > 표시 상한 200 % → 경고, comp16qty 는 기준 이득 없음(none)', async () => {
    const i = await info(EX.comp42)
    expect(group(i, 'comp8qty').refBasis).toBe('single-depth')
    expect(group(i, 'comp8qty').refPct!).toBeCloseTo(241.6, 1)
    expect([group(i, 'comp16qty').refBasis, group(i, 'comp16qty').refPct]).toEqual(['none', null])
    expect(i.warnings.filter((w) => /표시 상한/.test(w))).toHaveLength(1)
    expect(i.warnings.join(' ')).toMatch(/comp8qty.*241\.6/)
  })

  it('4.2 Sect: 분석 Index 오프셋 −52 mm (취득 +26 mm) → "분석에서 위치를 바꿔 저장한 파일" 경고, Ref 근거 TCG', async () => {
    const i = await info(EX.sect42)
    const g = i.groups[0]!
    expect(g.positioning).toEqual({ scanOffsetMm: 0, indexOffsetMm: 26, analysisScanOffsetMm: 0, analysisIndexOffsetMm: -52, reference: 'WedgeStart' })
    expect(g.refBasis).toBe('tcg')
    expect(i.warnings.filter((w) => /분석에서 위치를 바꿔 저장한 파일/.test(w))).toHaveLength(1)
    expect(i.warnings.join(' ')).toMatch(/Index −52\.00 mm/)
  })

  it('X7 가져오기 미리보기: 4.2 Sect 항목에 분석 오프셋 경고(지문 (c) 가 바뀐 값), 3.x·오프셋 0 파일은 없음 — 원본은 읽기만', async () => {
    const w = await readImportOffsetWarnings(EX.sect42)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/분석에서 위치를 바꿔 저장한 파일입니다\(분석 오프셋 Index −52\.00 mm\).*스캔플랜 지문의 탐촉자 위치/)
    expect(await readImportOffsetWarnings(EX.manualPa33)).toEqual([])
    expect(await readImportOffsetWarnings(EX.ut42)).toEqual([])
    const work = mkdtempSync(join(tmpdir(), 'paut-x7-'))
    const service = createAppService({ settingsPath: join(work, 'settings.json') })
    try {
      await service.setStoreRoot(join(work, '저장소'))
      const p = await service.analyze([EX.sect42, EX.ut42])
      const byName = new Map(p.items.map((it) => [it.fileName, it.warnings]))
      expect(byName.get(basename(EX.sect42))!.join(' ')).toMatch(/분석 오프셋 Index −52\.00 mm/)
      expect(byName.get(basename(EX.ut42))!.join(' ')).not.toMatch(/분석 오프셋/)
    } finally {
      service.close()
      rmSync(work, { recursive: true, force: true })
    }
  })

  it('4.2 ToFD: SoftGain 20 dB(JSON Software gain = XML), 분석 Scan 오프셋 송신 +0.133·수신 −0.133 mm', async () => {
    const i = await info(EX.tofd42)
    const g = i.groups[0]!
    expect(g.softGainDb).toBe(20)
    expect(g.positioning!.analysisScanOffsetMm).toBeCloseTo(0.133351, 6)
    expect(g.positioning!.scanOffsetMm).toBeCloseTo(-9.533351, 6)
    expect(i.warnings.join(' ')).toMatch(/송신 Scan \+0\.13 mm, 수신 Scan −0\.13 mm/)
    // ToFD 그룹은 그리지 않아 분석 이득 경고는 싣지 않는다
    expect(i.warnings.join(' ')).not.toMatch(/분석 이득/)
    expect(i.display.readings![0]!.keys).toEqual(['TOFDmr', 'Smr', 'TOFDr', 'Sr', 'PercentUr', 'TOFDmr', 'Smr', 'TOFDm', 'Sm', 'PercentUm'])
  })

  it('4.1·4.2 TFM: 저장 목록 키(셋업 그룹 id 1~4 와 맞춤), 4.1 은 MXU 6.1.1 X4 → 웨지 오프셋 주의', async () => {
    const i41 = await info(EX.tfm41)
    expect(i41.display.readings!.map((r) => [r.groupId, r.groupName])).toEqual([
      [1, 'TT'],
      [2, '3T'],
      [3, '4T'],
      [4, '5T']
    ])
    expect(i41.display.readings![0]!.keys).toEqual(['APercent', 'AdBr', 'AdBA', 'MaxPercentZ', 'PercentMR', 'Sr', 'Smr', 'Imr', 'Dm', 'Dmr'])
    expect(i41.source).toMatchObject({ mxuVersion: '6.1.1', platform: 'X4', wedgeOffsetCaution: true })
    expect(i41.source!.notes.join(' ')).toMatch(/6\.3\.0 전.*웨지 장착 위치/)
    expect((await info(EX.ut41)).source!.wedgeOffsetCaution).toBe(true)
    // 4.2 예제: MXU 6.0.0 으로 만들고 6.4.0 으로 다시 저장 → 만든 판 기준으로 주의(마지막 판만 보면 놓침 — 2026-10-07 검토)
    const s42 = (await info(EX.tfm42)).source!
    expect(s42).toMatchObject({ mxuVersion: '6.4.0', createdMxuVersion: '6.0.0', wedgeOffsetCaution: true })
    expect(s42.notes.join(' ')).toMatch(/MXU 6\.0\.0\(6\.3\.0 전\)로 만든 X4 파일입니다, 마지막 저장 MXU 6\.4\.0/)
    expect(s42.notes.join(' ')).toMatch(/secondaryOffset/)
  })

  it('파일에 나온 측정값 키는 모두 측정값 표에 있다', async () => {
    const keys = new Set<string>()
    for (const p of listExampleFiles()) for (const r of (await info(p)).display.readings ?? []) r.keys.forEach((k) => keys.add(k))
    expect([...keys].filter((k) => readingByKey(k) === null)).toEqual([])
  })

  it('4.2 COD 배관 = ERW(덮개 종류) → 이음매 선 + 열영향부, 개선면 반폭 0', async () => {
    const i = await info(EX.cod42)
    const weld = i.specimen.weld!
    expect(weld.template).toBe('Erw')
    expect(weld.bevelShape).toBe('V') // 공개 JSON 은 V 로 적는다
    const o = weldOverlay(weld, i.specimen.thicknessMm, 30)!
    expect(o.bevel).toEqual([
      [
        [0, 0],
        [0, 30]
      ]
    ])
    expect(o.haz).toEqual([
      [
        [10, 0],
        [10, 30]
      ],
      [
        [-10, 0],
        [-10, 30]
      ]
    ])
  })
})

describe('덮개선: ERW 만 바뀐다 (L7)', () => {
  const X3_WELD: ViewerWeld = {
    bevelShape: 'V',
    symmetry: 'Symmetric',
    offsetMm: 1,
    landHeightMm: 2,
    hotPass: { angleDeg: 30, heightMm: 10 },
    fills: [],
    root: null,
    upperCap: { widthMm: 25, heightMm: 2 },
    lowerCap: { widthMm: 6, heightMm: 2 },
    hazWidthMm: 10,
    weldAngleDeg: 30
  }
  it('VOffset 덮개 종류가 붙어도 덮개선은 바이트 단위로 같다', () => {
    const before = weldOverlay(X3_WELD, 12, 36)
    expect(weldOverlay({ ...X3_WELD, template: 'VOffset' }, 12, 36)).toEqual(before)
    expect(JSON.stringify(weldOverlay({ ...X3_WELD, template: 'VOffset' }, 12, 36))).toBe(JSON.stringify(before))
  })
  it('ERW 는 J·비대칭 JSON 이어도 이음매로 그리고, 두께를 모르면 그리지 않는다', () => {
    expect(isDrawableWeld({ ...X3_WELD, bevelShape: 'J', template: 'Erw' }, 12)).toBe(true)
    expect(weldOverlay({ ...X3_WELD, template: 'erw', hazWidthMm: null }, 12, 20)).toEqual({
      bevel: [
        [
          [0, 0],
          [0, 20]
        ]
      ],
      haz: []
    })
    expect(weldOverlay({ ...X3_WELD, template: 'Erw' }, null, 20)).toBeNull()
  })
})

/** 새 칸을 지운 사본 (기존 결과와 견주기용) */
function stripNew(i: ViewerFileInfo, legacyWarnings: number): ViewerFileInfo {
  const groups = i.groups.map((g) => {
    const { refBasis: _a, refPct: _b, softGainDb: _c, positioning: _d, ...rest } = g
    return { ...rest, gates: rest.gates.map(({ enabled: _e, detection: _f, event: _g, ...gate }) => gate) }
  })
  const { readings: _r, ...display } = i.display
  const weld = i.specimen.weld ? (({ template: _t, ...w }) => w)(i.specimen.weld) : null
  const { source: _s, ...rest } = i
  return { ...rest, groups, display, specimen: { ...i.specimen, weld }, warnings: i.warnings.slice(0, legacyWarnings) }
}

/**
 * 새 입력(측정값 목록·BusinessSetup·출처) 없이 예전 방식(2026-10-06 viewer/index.ts extractInfo 와 같은 입력)으로 만든 결과.
 * buildViewerInfo 가 셋업 JSON 만으로도 새 칸 일부를 채우므로 견줄 때는 양쪽 모두 새 칸을 지운다
 */
function legacyInfo(path: string): Promise<ViewerFileInfo> {
  return withH5File(path, (file) => {
    const { layout, setup, version } = readSetup(file)
    const parsed = parseModelSetup(readModelSetupXml(file, layout))
    const probe = (p: string) => {
      const e = getPath(file, p) as unknown as { shape?: number[] | null; metadata?: { type: number; size: number; signed: boolean } } | null
      return e && e.metadata ? { shape: e.shape ?? [], type: e.metadata.type, size: e.metadata.size, signed: !!e.metadata.signed } : null
    }
    return buildViewerInfo({
      setup,
      family: layout,
      version: version.raw,
      lookup: probe,
      display: parsed.display,
      groupSetups: parsed.groupSetups,
      currentMxuGroupId: parsed.currentMxuGroupId,
      warnings: parsed.warnings
    })
  })
}

describe('기존 결과 불변: 새 칸을 빼면 예전 입력으로 만든 결과와 같다', () => {
  const files = [...(HAS_X3 ? X3_FILES : []), ...(HAS_TF ? [X4_TF_COMPOUND, X4_TF_LINEAR] : []), ...(HAS_EXAMPLES ? listExampleFiles() : [])]
  it.skipIf(files.length === 0).each(files.map((p) => [basename(p), p]))('%s', async (_, p) => {
    const full = await info(p)
    const legacy = await legacyInfo(p)
    // 그릴 수 있는 그룹은 데이터셋 모양이 같아야 같은 결과 — 그릴 수 없는 그룹은 이유 글자까지 같다
    expect(stripNew(full, legacy.warnings.length)).toEqual(stripNew(legacy, legacy.warnings.length))
    // 경고는 뒤에만 붙는다
    expect(full.warnings.slice(0, legacy.warnings.length)).toEqual(legacy.warnings)
  })
})
