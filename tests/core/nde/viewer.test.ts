/** 이미지 보기용 NDE 읽기 — 실데이터(X3)와 공식 예제 11개 */
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildViewerInfo, defaultDisplay, parseModelSetup, readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import { DEFAULT_AMPLITUDE_PALETTE } from '@shared/imaging'
import { AppError } from '@shared/errors'
import { EX, HAS_EXAMPLES, HAS_X3, X3_FILES } from './fixtures'

describe('ModelSetup 화면 상태 읽기', () => {
  const colors = (n: number): string => Array.from({ length: n }, (_, i) => `<string>${(i * 65793).toString(16).padStart(6, '0')}</string>`).join('')

  it('색표·그룹별 빔·레이아웃·C-scan 방향', () => {
    const xml = `<ModelSetup><GroupSetups><GroupSetupList>
      <GroupSetup><ID>0</ID><X><ID>9</ID></X><UserName>Skew90</UserName><CurrentContextID>14</CurrentContextID>
        <PaletteZoomSetups><PaletteZoomSetup><PaletteType>Amplitude</PaletteType><Zoom>1</Zoom><Pan>0.5</Pan></PaletteZoomSetup></PaletteZoomSetups></GroupSetup>
      <GroupSetup><ID>1</ID><CurrentContextID>15</CurrentContextID></GroupSetup>
      </GroupSetupList><CurrentGroupID>1</CurrentGroupID></GroupSetups>
      <PalettesSetup><AmplitudePalettes><MainColors>${colors(256)}</MainColors><SpecialColors><string>000000</string><string>FFFFFF</string><string>808080</string></SpecialColors></AmplitudePalettes></PalettesSetup>
      <CurrentLayout>MultiACS</CurrentLayout><LayoutGroupMode>Multiple</LayoutGroupMode><IsCScanReversed>true</IsCScanReversed></ModelSetup>`
    const p = parseModelSetup(xml)
    expect(p.display.paletteSource).toBe('file')
    expect(p.display.palette[1]).toBe('010101')
    expect(p.display.specialColors).toEqual(['000000', 'ffffff', '808080'])
    expect(p.groupSetups).toEqual([
      { mxuId: 0, userName: 'Skew90', contextId: 14 },
      { mxuId: 1, userName: null, contextId: 15 }
    ])
    // CurrentGroupID 는 MXU 화면 그룹 번호 → 셋업 그룹 id 로 바꾸는 건 buildViewerInfo
    expect(p.currentMxuGroupId).toBe(1)
    expect(p.display).toMatchObject({ layout: 'MultiACS', layoutGroupMode: 'Multiple', currentGroupId: null, cscanReversed: true })
    expect(p.warnings).toEqual([])
  })

  it('없거나 이상하면 기본값 + 경고', () => {
    expect(parseModelSetup(null).display.paletteSource).toBe('default')
    const bad = parseModelSetup(`<Amplitude><MainColors>${colors(10)}</MainColors></Amplitude>
      <GroupSetup><ID>0</ID><PaletteType>Amplitude</PaletteType><Zoom>2</Zoom><Pan>0.3</Pan></GroupSetup>`)
    expect(bad.display.paletteSource).toBe('default')
    expect(bad.display.palette).toEqual(DEFAULT_AMPLITUDE_PALETTE)
    expect(bad.warnings.join(' ')).toMatch(/256색이 아니어서/)
    expect(bad.warnings.join(' ')).toMatch(/색표 확대/)
    expect(bad.display.cscanReversed).toBe(false)
  })
})

describe('GroupSetup ↔ 셋업 그룹 (MXU 화면 그룹 번호는 셋업 id 와 다름)', () => {
  const NB = 16
  const ampPath = '/Public/Groups/1/Datasets/0-AScanAmplitude'
  /** 4.x: 그룹 0 = 데이터 없는 캡처(그룹 2 TFM 의 입력이라 빠짐), 그룹 1 = PA 섹토리얼, 그룹 2 = TFM */
  const setup = {
    version: '4.2.0',
    groups: [
      { id: 0, processes: [{ id: 0, ultrasonicMatrixCapture: { acquisitionPattern: 'FMC', beams: [] } }] },
      {
        id: 1,
        name: 'PA',
        datasets: [
          {
            dataClass: 'AScanAmplitude',
            path: ampPath,
            dataValue: { min: 0, max: 32767, unitMax: 200 },
            dimensions: [
              { axis: 'UCoordinate', quantity: 10, resolution: 0.001 },
              { axis: 'Beam', beams: Array.from({ length: NB }, (_, i) => ({ refractedAngle: 40 + i, skewAngle: 90, velocity: 3240 })) },
              { axis: 'Ultrasound', quantity: 100, resolution: 1e-8 }
            ]
          }
        ],
        processes: [{ id: 0, ultrasonicPhasedArray: { pulseEcho: { sectorialFormation: {} }, gates: [] } }]
      },
      { id: 2, name: 'TFM', datasets: [], processes: [{ id: 0, inputs: [{ groupId: 0, processId: 0 }], totalFocusingMethod: {} }] }
    ]
  }
  const info = (xml: string): ReturnType<typeof buildViewerInfo> => {
    const p = parseModelSetup(`<ModelSetup>${xml}</ModelSetup>`)
    return buildViewerInfo({
      setup,
      family: '4.x',
      version: '4.2.0',
      lookup: (path) => (path === ampPath ? { shape: [10, NB, 100], type: 0, size: 2, signed: true } : null),
      display: p.display,
      groupSetups: p.groupSetups,
      currentMxuGroupId: p.currentMxuGroupId,
      warnings: p.warnings
    })
  }
  const gs = (id: number, name: string | null, ctx: number): string =>
    `<GroupSetup><ID>${id}</ID>${name === null ? '' : `<UserName>${name}</UserName>`}<CurrentContextID>${ctx}</CurrentContextID></GroupSetup>`

  it.each([
    ['이름으로', gs(0, 'PA', 7) + gs(1, 'TFM', 0) + '<CurrentGroupID>0</CurrentGroupID>'],
    ['이름 없으면 순서로', gs(0, null, 7) + gs(1, null, 0) + '<CurrentGroupID>0</CurrentGroupID>'],
    ['이름이 순서보다 먼저', gs(0, 'TFM', 0) + gs(1, 'PA', 7) + '<CurrentGroupID>1</CurrentGroupID>']
  ])('캡처 그룹 뒤 PA 그룹이 자기 CurrentContextID 를 쓴다 (%s)', (_, xml) => {
    const r = info(xml)
    expect(r.groups.map((g) => [g.id, g.name, g.technique])).toEqual([
      [1, 'PA', 'pa-sectorial'],
      [2, 'TFM', 'tfm']
    ])
    expect(r.groups[0]!.supported).toBe(true)
    expect(r.groups[0]!.initialBeam).toBe(7)
    expect(r.display.currentGroupId).toBe(1)
  })

  it('맞는 GroupSetup 이 없으면 가운데 빔, 현재 그룹 null', () => {
    const r = info(gs(5, 'X', 3) + '<CurrentGroupID>5</CurrentGroupID>')
    expect(r.groups[0]!.initialBeam).toBe(NB / 2)
    expect(r.display.currentGroupId).toBeNull()
  })
})

describe('리니어·컴파운드 읽기 경계 (가짜 4.x 셋업)', () => {
  const ampPath = '/Public/Groups/0/Datasets/0-AScanAmplitude'
  type B = { angle: number; v: number; skew?: number }
  const info = (formation: Record<string, unknown>, beams: B[]): ReturnType<typeof buildViewerInfo> => {
    const nb = beams.length
    const setup = {
      version: '4.2.0',
      groups: [
        {
          id: 0,
          name: 'GR-1',
          datasets: [
            {
              dataClass: 'AScanAmplitude',
              path: ampPath,
              dataValue: { min: 0, max: 32767, unitMax: 200 },
              dimensions: [
                { axis: 'UCoordinate', quantity: 10, resolution: 0.001 },
                { axis: 'Beam', beams: beams.map((b) => ({ refractedAngle: b.angle, skewAngle: b.skew ?? 90, velocity: 3240, vCoordinateOffset: b.v / 1000, ultrasoundOffset: 1e-5 })) },
                { axis: 'Ultrasound', quantity: 100, resolution: 4e-8 }
              ]
            }
          ],
          processes: [{ id: 0, ultrasonicPhasedArray: { pulseEcho: formation, rectification: 'Full', gates: [] } }]
        }
      ]
    }
    return buildViewerInfo({
      setup,
      family: '4.x',
      version: '4.2.0',
      lookup: (path) => (path === ampPath ? { shape: [10, nb, 100], type: 0, size: 2, signed: true } : null),
      display: defaultDisplay(),
      groupSetups: [],
      currentMxuGroupId: null,
      warnings: []
    })
  }
  const linear = (n: number, step = 0.64): B[] => Array.from({ length: n }, (_, i) => ({ angle: 60, v: -50 + i * step }))
  const compound = (dv: number): B[] => Array.from({ length: 19 }, (_, i) => ({ angle: 50 + i, v: -45 + i * dv }))

  it('리니어·컴파운드도 섹토리얼과 같은 경로로 그린다 (4.x 는 OmniPC 대조 완료)', () => {
    const l = info({ linearFormation: {} }, linear(44)).groups[0]!
    expect([l.technique, l.supported, l.reason, l.verified]).toEqual(['pa-linear', true, null, true])
    const c = info({ compoundFormation: {} }, compound(1.26)).groups[0]!
    expect([c.technique, c.supported, c.reason, c.verified]).toEqual(['pa-compound', true, null, true])
    // skew 270 리니어: 출사점이 −V 쪽으로 늘어서도 (s·V 순서) 그린다
    expect(info({ linearFormation: {} }, linear(8).map((b) => ({ ...b, v: -b.v, skew: 270 }))).groups[0]!.supported).toBe(true)
  })

  it('빔 1개·같은 자리 빔·출사점이 각도와 반대로 움직이는 컴파운드·스큐 섞임은 이유와 함께 막는다', () => {
    expect(info({ linearFormation: {} }, linear(1)).groups[0]!.reason).toMatch(/2개 미만/)
    expect(info({ linearFormation: {} }, linear(4, 0)).groups[0]!.reason).toMatch(/겹쳐/)
    expect(info({ compoundFormation: {} }, compound(-1.26)).groups[0]!.reason).toMatch(/반대로/)
    expect(info({ linearFormation: {} }, [{ angle: 60, v: -50 }, { angle: 60, v: -49, skew: 270 }]).groups[0]!.reason).toMatch(/섞여/)
  })
})

describe.skipIf(!HAS_X3)('X3 실데이터', () => {
  const before = X3_FILES.map((p) => statSync(p))

  it('그룹 2개(Skew90/270) 모두 그릴 수 있고 OmniPC 대조 완료(3.x)', async () => {
    for (const p of X3_FILES) {
      const info = await readViewerInfo(p)
      expect(info.formatFamily).toBe('3.x')
      expect(info.version).toBe('3.3.0')
      expect(info.warnings).toEqual([])
      expect(info.groups.map((g) => [g.name, g.technique, g.supported, g.verified])).toEqual([
        ['Skew90', 'pa-sectorial', true, true],
        ['Skew270', 'pa-sectorial', true, true]
      ])
      for (const g of info.groups) {
        expect(g.shape).toEqual([301, 31, 808])
        expect(g.bytes).toBe(301 * 31 * 808 * 2)
        expect(g.ampScale).toEqual({ rawMax: 32767, unitMax: 200 })
        expect(g.scan).toEqual({ offsetMm: 0, resolutionMm: 1, count: 301 })
        expect(g.ultrasound.count).toBe(808)
        expect(g.ultrasound.resolutionUs).toBeCloseTo(0.04, 12)
        expect(g.beams.map((b) => b.angleDeg)).toEqual(Array.from({ length: 31 }, (_, i) => 40 + i))
        expect(g.statusPath).toMatch(/Status$/)
        expect(g.cscanGateId).toBe(1)
        expect(g.gates.map((x) => [x.name, x.geometry, x.supported])).toEqual([
          ['Gate I', 'SoundPath', true],
          ['Gate A', 'TrueDepth', true],
          ['Gate B', 'SoundPath', true]
        ])
      }
      const [g0, g1] = info.groups
      // 빔 축 값은 진폭 차원의 것 (paut.beams 의 skewAngle 0 이 아님)
      expect(g0!.beams.every((b) => b.skewDeg === 90)).toBe(true)
      expect(g1!.beams.every((b) => b.skewDeg === 270)).toBe(true)
      expect(g0!.beams[0]!.t0Us).toBeCloseTo(8.052, 6)
      expect(g0!.beams[0]!.vOffsetMm).toBeCloseTo(-38.3158, 3)
      expect(g1!.beams[0]!.vOffsetMm).toBeCloseTo(38.31, 1) // 음속이 조금 달라(3242.1) 부호만 반대는 아님
      expect(info.specimen.thicknessMm).toBe(12)
      expect(info.specimen.weld).toMatchObject({ bevelShape: 'V', offsetMm: 1, landHeightMm: 2, hotPass: { angleDeg: 30, heightMm: 10 }, hazWidthMm: 10 })
      expect(info.display).toMatchObject({ paletteSource: 'file', layout: 'MultiACS', layoutGroupMode: 'Multiple', cscanReversed: true })
      expect(info.display.palette).toEqual(DEFAULT_AMPLITUDE_PALETTE)
    }
  })

  it('처음 보일 빔 = 파일 화면 상태 (54°, 55°), 현재 그룹 0', async () => {
    const info = await readViewerInfo(X3_FILES[0]!)
    expect(info.groups.map((g) => g.beams[g.initialBeam]!.angleDeg)).toEqual([54, 55])
    expect(info.display.currentGroupId).toBe(0)
  })

  it('진폭 조각: 전체·일부, 상태 비트', async () => {
    const info = await readViewerInfo(X3_FILES[0]!)
    const g = info.groups[0]!
    const all = await readViewerChunk(X3_FILES[0]!, g, 0, 301)
    expect(all.amplitude).toBeInstanceOf(Int16Array)
    expect(all.amplitude.length).toBe(301 * 31 * 808)
    expect(all.amplitude.byteOffset).toBe(0)
    expect(all.amplitude.buffer.byteLength).toBe(all.amplitude.byteLength)
    expect(all.status).toBeInstanceOf(Uint8Array)
    expect(all.status!.length).toBe(301 * 31)
    expect(all.status!.every((s) => (s & 1) === 1)).toBe(true)
    const part = await readViewerChunk(X3_FILES[0]!, g, 100, 5)
    expect(part).toMatchObject({ scanStart: 100, scanCount: 5 })
    expect([...part.amplitude.subarray(0, 50)]).toEqual([...all.amplitude.subarray(100 * 31 * 808, 100 * 31 * 808 + 50)])
    // 끝을 넘으면 그룹 끝까지만
    expect((await readViewerChunk(X3_FILES[0]!, g, 299, 10)).scanCount).toBe(2)
  })

  it('잘못된 범위·그릴 수 없는 그룹은 오류', async () => {
    const info = await readViewerInfo(X3_FILES[0]!)
    const g = info.groups[0]!
    await expect(readViewerChunk(X3_FILES[0]!, g, 301, 1)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(readViewerChunk(X3_FILES[0]!, g, 0, 0)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(readViewerChunk(X3_FILES[0]!, { ...g, supported: false }, 0, 1)).rejects.toBeInstanceOf(AppError)
  })

  it('원본 파일은 바뀌지 않는다 (크기·수정시각)', async () => {
    for (const p of X3_FILES) {
      const info = await readViewerInfo(p)
      await readViewerChunk(p, info.groups[1]!, 0, 301)
    }
    X3_FILES.forEach((p, i) => {
      const now = statSync(p)
      expect(now.size).toBe(before[i]!.size)
      expect(now.mtimeMs).toBe(before[i]!.mtimeMs)
    })
  })
})

describe.skipIf(!HAS_EXAMPLES)('공식 예제 11개', () => {
  /** 파일 → [그룹 이름, 기법, 그릴 수 있음] */
  const expected: Record<string, Array<[string, string, boolean]>> = {
    [EX.manualPa33]: [['GR-1', 'pa-sectorial', true]],
    [EX.manualUt33]: [['GR-1', 'ut', false]],
    [EX.manualPa40]: [['GR-1', 'pa-sectorial', true]],
    [EX.tfm41]: [
      ['TT', 'tfm', false],
      ['3T', 'tfm', false],
      ['4T', 'tfm', false],
      ['5T', 'tfm', false]
    ],
    [EX.ut41]: [['GR-1', 'ut', false]],
    [EX.cod42]: [
      ['S90', 'pa-sectorial', true],
      ['S270', 'pa-sectorial', true],
      ['ToFD', 'tofd', false]
    ],
    [EX.tfm42]: [
      ['TT', 'tfm', false],
      ['3T', 'tfm', false],
      ['4T', 'tfm', false],
      ['5T', 'tfm', false]
    ],
    [EX.comp42]: [
      ['comp8qty', 'pa-compound', true],
      ['comp16qty', 'pa-compound', true]
    ],
    [EX.sect42]: [['GR-1', 'pa-sectorial', true]],
    [EX.tofd42]: [['GR-1', 'tofd', false]],
    [EX.ut42]: [['GR-1', 'ut', false]]
  }

  for (const [path, groups] of Object.entries(expected)) {
    it(basename(path), async () => {
      const info = await readViewerInfo(path)
      expect(info.groups.map((g) => [g.name, g.technique, g.supported])).toEqual(groups)
      for (const g of info.groups) {
        if (g.supported) {
          expect(g.reason).toBeNull()
          // 대조 완료: 3.x 섹토리얼(X3), 4.x 컴파운드·리니어(TF_01 캡처), 4.x 섹토리얼 스큐 90(교차 대조, T3) — meta.ts VERIFIED
          const skew90 = Math.round(g.beams[0]?.skewDeg ?? -1) % 360 === 90
          expect(g.verified).toBe(info.formatFamily === '3.x' ? g.technique === 'pa-sectorial' : g.technique !== 'pa-sectorial' || skew90)
          expect(g.cscanGateId).not.toBeNull()
          const chunk = await readViewerChunk(path, g, 0, 2)
          expect(chunk.amplitude.length).toBe(2 * g.shape[1] * g.shape[2])
        } else {
          expect(g.reason).toMatch(/아직 그리지 않습니다/)
        }
      }
    })
  }

  it('4.1/4.2 TFM: CurrentGroupID 1 (MXU 번호) = 3T = 셋업 그룹 2', async () => {
    for (const path of [EX.tfm41, EX.tfm42]) {
      const info = await readViewerInfo(path)
      expect(info.display.currentGroupId).toBe(2)
      expect(info.groups.find((g) => g.id === info.display.currentGroupId)!.name).toBe('3T')
    }
  })

  it('4.2 Sect: 스캔 시작 42 mm, 시간 0 = ultrasoundOffset 14.21 µs', async () => {
    const g = (await readViewerInfo(EX.sect42)).groups[0]!
    expect(g.scan).toEqual({ offsetMm: 42, resolutionMm: 1, count: 45 })
    expect(g.beams[0]!.t0Us).toBeCloseTo(14.21, 6)
    expect(g.shape).toEqual([45, 31, 1600])
  })

  it('3.3 ManualWeldPA: 스캔 259 이후는 상태 hasData 0', async () => {
    const info = await readViewerInfo(EX.manualPa33)
    const g = info.groups[0]!
    const chunk = await readViewerChunk(EX.manualPa33, g, 255, 10)
    const nb = g.shape[1]
    const has = (s: number): boolean => (chunk.status![s * nb]! & 1) === 1
    expect(has(258 - 255)).toBe(true)
    expect(has(259 - 255)).toBe(false)
  })
})
