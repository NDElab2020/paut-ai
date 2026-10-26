import { describe, expect, it } from 'vitest'
import { canonicalJson, computeFingerprint, fingerprint, normalizeSetup, parseNdeVersion, summarizeAcquisition } from '@core/nde'
import { EX, HAS_EXAMPLES, HAS_X3, X3_FILES, clone, listExampleFiles, load } from './fixtures'

type AnyJson = Record<string, any>

const V33 = parseNdeVersion('3.3.0')
const V42 = parseNdeVersion('4.2.0')

describe.skipIf(!HAS_X3)('X3 4개 → 한 플랜', () => {
  it('지문이 모두 같다 (게이트 길이 미세 차이·게인·음속 무시)', async () => {
    const all = await Promise.all(X3_FILES.map(load))
    const fps = new Set(all.map((l) => l.norm.fingerprint))
    expect(fps.size).toBe(1)
    expect([...fps][0]).toMatch(/^fp2:[0-9a-f]{64}$/)
  })

  it('정규화 스펙 내용', async () => {
    const { norm } = await load(X3_FILES[0]!)
    const { spec } = norm
    expect(spec.specimen).toMatchObject({ shape: 'plate', thicknessMm: 12, materialName: 'Steel_Mild', outerRadiusMm: null })
    expect(spec.specimen.weld).toMatchObject({ bevelShape: 'V', symmetry: 'Symmetric', upperCap: { widthMm: 25, heightMm: 2 }, hotPass: { angleDeg: 30, heightMm: 10 } })
    expect(spec.groups).toHaveLength(2)
    for (const g of spec.groups) {
      expect(g).toMatchObject({
        technique: 'PA',
        formation: 'sectorial',
        firstElement: 32,
        aperture: 32,
        refractedAngle: { startDeg: 40, stopDeg: 70, stepDeg: 1 },
        focusing: { mode: 'TrueDepth', distanceMm: 23 },
        waveMode: 'TransversalVertical'
      })
      expect(g.probes).toHaveLength(1)
      expect(g.probes[0]!.probe).toEqual({ model: '5L64-A32', kind: 'phasedArrayLinear', centralFrequencyMHz: 5, elementCount: 64, pitchMm: 0.5 })
      expect(g.probes[0]!.wedge).toEqual({ model: 'SA32-N55S', kind: 'angleBeam', wedgeAngleDeg: 36.1 })
      expect(g.probes[0]!.orientation).toBe('Normal')
    }
    expect(spec.groups.map((g) => g.probes[0]!.position)).toEqual(
      expect.arrayContaining([
        { uOffsetMm: 0, vOffsetMm: -15, skewDeg: 90, surface: 'Top' },
        { uOffsetMm: 0, vOffsetMm: 15, skewDeg: 270, surface: 'Top' }
      ])
    )
    expect(norm.summary).toBe('판재 12 mm · V 개선 · 5L64-A32 ×2 · ±15 mm · PA 섹터 40–70°')
    expect(norm.warnings).toEqual([])
  })

  it('수집 요약에 게인·음속·게이트·TCG 를 기록 (지문 제외 항목)', async () => {
    const { norm } = await load(X3_FILES[0]!)
    const acq = norm.acquisition
    const byName = Object.fromEntries(acq.groups.map((g) => [g.groupName, g]))
    expect(byName['Skew90']).toMatchObject({ gainDb: 24.7, velocityMps: 3242.8, beamCount: 31, tcgEnabled: true, scanQuantity: 301, scanResolutionMm: 1 })
    expect(byName['Skew270']).toMatchObject({ gainDb: 20.4, velocityMps: 3242.1 })
    expect(byName['Skew90']!.gates.map((g) => g.name)).toEqual(['Gate I', 'Gate A', 'Gate B'])
    expect(byName['Skew90']!.calibrations).toContain('tcgCalibration')
    expect(acq.encoder).toEqual({ mode: 'Quadrature', stepResolutionPerMm: 80 })
    expect(acq.scanPattern).toBe('OneLineScan')
    // specGroupIndex 는 정준 순서를 가리킨다
    for (const g of acq.groups) {
      const specGroup = norm.spec.groups[g.specGroupIndex]!
      expect(specGroup.probes[0]!.position!.skewDeg).toBe(g.groupName === 'Skew90' ? 90 : 270)
    }
  })
})

describe.skipIf(!HAS_X3)('지문 규칙 (X3 셋업 변형)', () => {
  const fpOf = (setup: AnyJson): string => normalizeSetup(setup, V33).fingerprint

  it('제외 항목(게인·게이트·TCG·보정·빔 지연·음속·그룹 이름·장비 시리얼)은 지문을 바꾸지 않는다', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const s = clone(raw.setup) as AnyJson
    for (const g of s.groups) {
      g.name = `바뀐 이름 ${g.id}`
      g.paut.gain += 6
      g.paut.velocity += 30
      g.paut.referenceGain = 0
      g.paut.gates = []
      g.paut.calibrationStates = []
      for (const b of g.paut.beams) {
        b.beamDelay *= 1.1
        b.ascanStart = 0
        b.tcg = { enabled: false, points: [] }
      }
    }
    s.acquisitionUnits[0].serialNumber = 'QC-0000000'
    s.motionDevices[0].encoder.stepResolution = 12
    expect(fpOf(s)).toBe(norm.fingerprint)
  })

  it('그룹 순서가 바뀌어도 같은 지문 (이름이 아닌 내용으로 정렬)', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const s = clone(raw.setup) as AnyJson
    s.groups.reverse()
    expect(fpOf(s)).toBe(norm.fingerprint)
  })

  it('허용오차 안의 수치 흔들림(1e-8 m)은 같은 지문', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const s = clone(raw.setup) as AnyJson
    s.specimens[0].plateGeometry.thickness += 1e-8
    s.wedges[0].positioning.vCoordinateOffset += 1e-8
    s.groups[0].paut.focusing.distance -= 1e-8
    expect(fpOf(s)).toBe(norm.fingerprint)
  })

  it('포함 항목이 바뀌면 다른 지문', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const mutate = (f: (s: AnyJson) => void): string => {
      const s = clone(raw.setup) as AnyJson
      f(s)
      return fpOf(s)
    }
    const variants = [
      mutate((s) => (s.specimens[0].plateGeometry.thickness = 0.025)),
      mutate((s) => (s.specimens[0].weldGeometry.bevelShape = 'X')),
      mutate((s) => (s.wedges[0].positioning.vCoordinateOffset = -0.014)),
      mutate((s) => (s.wedges[1].positioning.skewAngle = 180)),
      mutate((s) => (s.probes[0].model = '5L32-A31')),
      mutate((s) => (s.probes[0].phasedArrayLinear.centralFrequency = 2.25e6)),
      mutate((s) => (s.wedges[0].angleBeamWedge.mountingLocations[0].wedgeAngle = 30)),
      mutate((s) => (s.groups[0].paut.pulseEcho.sectorialFormation.beamRefractedAngles.stop = 65)),
      mutate((s) => (s.groups[0].paut.pulseEcho.sectorialFormation.elementAperture = 16)),
      mutate((s) => (s.groups[0].paut.focusing.distance = 0.03)),
      mutate((s) => (s.groups[0].paut.waveMode = 'Longitudinal')),
      mutate((s) => s.groups.pop())
    ]
    for (const v of variants) expect(v).not.toBe(norm.fingerprint)
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('지문 정준 JSON 을 함께 돌려준다', async () => {
    const { norm } = await load(X3_FILES[0]!)
    const r = fingerprint(norm.spec)
    expect(r.fingerprint).toBe(norm.fingerprint)
    expect(r.fingerprint).toBe(computeFingerprint(norm.spec))
    expect(r.canonical).toBe(canonicalJson(norm.spec))
    expect(r.canonical).not.toMatch(/gain|velocity|Skew90/i)
    expect(JSON.parse(r.canonical).specVersion).toBe(2)
  })
})

describe('정준 JSON', () => {
  it('키 정렬, -0/NaN 정리', () => {
    expect(canonicalJson({ b: 1, a: [-0, { d: NaN, c: 'x' }], u: undefined })).toBe('{"a":[0,{"c":"x","d":null}],"b":1}')
  })
})

describe.skipIf(!HAS_EXAMPLES)('공식 예제 정규화', () => {
  it('11개 모두 예외 없이 정규화되고 기법이 맞게 분류된다', async () => {
    const techniques: Record<string, string[]> = {}
    for (const p of listExampleFiles()) {
      const { norm, fileName } = await load(p)
      expect(norm.spec.groups.length, fileName).toBeGreaterThan(0)
      expect(norm.fingerprint, fileName).toMatch(/^fp2:/)
      techniques[fileName] = norm.spec.groups.map((g) => `${g.technique}/${g.formation}`).sort()
    }
    expect(techniques).toEqual({
      'ManualWeldPA.nde': ['PA/sectorial'],
      'ManualWeldUT.nde': ['UT/none'],
      'ManualWeldPA-4.0.nde': ['PA/sectorial'],
      'Weld_Plate_4TFM_sk90-4.1.nde': ['TFM/none', 'TFM/none', 'TFM/none', 'TFM/none'],
      'Weld_Plate_UT-sk90-4.1.nde': ['UT/none'],
      'Weld_COD_2PA-ToFD-4.2.nde': ['PA/sectorial', 'PA/sectorial', 'ToFD/none'],
      'Weld_Plate_4TFM_sk90-4.2.nde': ['TFM/none', 'TFM/none', 'TFM/none', 'TFM/none'],
      'Weld_Plate_PA-Comp_sk90-2gr-4.2.nde': ['PA/compound', 'PA/compound'],
      'Weld_Plate_PA-Sect_sk90-4.2.nde': ['PA/sectorial'],
      'Weld_Plate_ToFD_Parallel-4.2.nde': ['ToFD/none'],
      'Weld_Plate_UT-sk90-4.2.nde': ['UT/none']
    })
  })

  /**
   * 3.3 ManualWeldPA.nde 와 4.0 ManualWeldPA-4.0.nde 는 같은 측정이다:
   * 장비 시리얼(QC-0015266)·생성 시각(2024-04-26T13:48:56-04:00)·creationFormatVersion '3.3.0'·데이터 크기(401×41×568)가 같고,
   * 4.0 파일은 OmniPC 6.0 으로 3.3 파일을 변환 저장한 것(Properties.file.modifiedByAppVersion 6.0.0.647).
   * 변환 시 바뀐 것 — 게이트 I/B 삭제, encoder stepResolution 12 step/mm → 12000 step/m,
   * uCoordinateOrientation ScanLength → Length, acquisitionUnits.name MXU → OmniPC — 은 모두 지문 제외 항목이라 지문이 같아야 한다.
   */
  it('3.3 ↔ 4.0 같은 측정은 같은 지문 (버전 간 정규화)', async () => {
    const a = await load(EX.manualPa33)
    const b = await load(EX.manualPa40)
    expect(b.raw.meta.createdAt).toBe(a.raw.meta.createdAt)
    expect(b.raw.meta.device.serialNumber).toBe(a.raw.meta.device.serialNumber)
    expect(b.norm.spec).toEqual(a.norm.spec)
    expect(b.norm.fingerprint).toBe(a.norm.fingerprint)
    // 기록용 값도 단위 변환 후 같다
    expect(b.norm.acquisition.encoder).toEqual(a.norm.acquisition.encoder)
    expect(a.norm.acquisition.encoder?.stepResolutionPerMm).toBe(12)
    expect(b.norm.acquisition.groups[0]!.gainDb).toBe(a.norm.acquisition.groups[0]!.gainDb)
    expect(b.norm.acquisition.groups[0]!.gates.length).toBeLessThan(a.norm.acquisition.groups[0]!.gates.length)
  })

  it('4.1 ↔ 4.2 같은 셋업(UT, 4TFM)도 같은 지문', async () => {
    expect((await load(EX.ut41)).norm.fingerprint).toBe((await load(EX.ut42)).norm.fingerprint)
    expect((await load(EX.tfm41)).norm.fingerprint).toBe((await load(EX.tfm42)).norm.fingerprint)
  })

  it('3.3 UT 의 굴절각(ut.refractedAngle)과 4.x UT 의 굴절각(beams[0].refractedAngle)을 같은 자리로', async () => {
    expect((await load(EX.manualUt33)).norm.spec.groups[0]!.refractedAngle).toEqual({ startDeg: 60, stopDeg: 60, stepDeg: null })
    expect((await load(EX.ut42)).norm.spec.groups[0]!.refractedAngle).toEqual({ startDeg: 45, stopDeg: 45, stepDeg: null })
  })

  it('ToFD: 송신/수신 탐촉자와 PCS, 배관 형상', async () => {
    const { norm } = await load(EX.tofd42)
    const g = norm.spec.groups[0]!
    expect(g.technique).toBe('ToFD')
    expect(g.probes.map((p) => p.role)).toEqual(['pulser', 'receiver'])
    expect(g.techniqueParams['pcsMm']).toBe(36.3)
    expect(norm.spec.specimen).toMatchObject({ shape: 'pipe', thicknessMm: 10, outerRadiusMm: 150 })
    expect(norm.acquisition.groups[0]).toMatchObject({ scanQuantity: 51, indexQuantity: null })
  })

  it('COD 2PA+ToFD: 그룹 3개, 탐촉자 4개', async () => {
    const { norm } = await load(EX.cod42)
    expect(norm.spec.specimen).toMatchObject({ shape: 'pipe', outerRadiusMm: 160, angularOpeningDeg: 360, thicknessMm: 6.2 })
    expect(norm.spec.groups.flatMap((g) => g.probes.map((p) => p.probe.model)).sort()).toEqual(['5L32-A31', '5L32-A31', 'C563', 'C563'])
    expect(norm.summary).toContain('PA 섹터 40–70° + ToFD')
  })

  it('TFM: 캡처 그룹(FMC)의 탐촉자를 쓰고, 경로·파 모드를 기법 변수로', async () => {
    const { norm } = await load(EX.tfm42)
    const paths = norm.spec.groups.map((g) => g.techniqueParams['pathName']).sort()
    expect(paths).toEqual(['T-T', 'TT-T', 'TT-TT', 'TT-TTT'])
    for (const g of norm.spec.groups) {
      expect(g).toMatchObject({ technique: 'TFM', firstElement: 0, aperture: 64 })
      expect(g.probes[0]!.probe.model).toBe('5L64-A32')
      expect(g.techniqueParams['capture']).toBe('FMC')
    }
    expect(norm.acquisition.groups.map((g) => g.groupName).sort()).toEqual(['3T', '4T', '5T', 'TT'])
    expect(norm.acquisition.groups.find((g) => g.groupName === '4T')!.gainDb).toBe(20)
  })

  /** 3.x fmc+tfmDescriptions 를 4.x 캡처 그룹+TFM 그룹과 같은 형태로 맞추는지: 4.2 TFM 셋업을 스펙의 3.3 형식으로 되돌려 비교 */
  it('3.x FMC(tfmDescriptions) 와 4.x 캡처+TFM 그룹은 같은 지문', async () => {
    const { raw, norm } = await load(EX.tfm42)
    const s4 = raw.setup as AnyJson
    const capture = s4.groups[0].processes[0].ultrasonicMatrixCapture
    const s3: AnyJson = {
      version: '3.3.0',
      groups: [
        {
          id: 0,
          name: 'FMC',
          fmc: {
            dataEncodingId: 0,
            probeId: 0,
            pulserFrequency: capture.pulserFrequency,
            digitizingFrequency: capture.digitizingFrequency,
            pulsers: capture.beams.map((b: AnyJson) => ({ id: b.id, elementId: b.pulsers[0].elementId })),
            receivers: capture.beams[0].receivers.map((r: AnyJson) => ({ id: r.id, elementId: r.elementId })),
            tfmDescriptions: s4.groups.slice(1).map((g: AnyJson, i: number) => ({ id: i, name: g.name, ...g.processes[0].totalFocusingMethod }))
          }
        }
      ],
      acquisitionUnits: s4.acquisitionUnits,
      motionDevices: s4.motionDevices,
      dataEncodings: s4.dataMappings.map((m: AnyJson) => ({ id: m.id, discreteGrid: { ...m.discreteGrid, specimenId: m.specimenId, surfaceId: m.surfaceId } })),
      specimens: s4.specimens,
      probes: s4.probes,
      wedges: s4.wedges
    }
    const n3 = normalizeSetup(s3, V33)
    expect(n3.spec).toEqual(norm.spec)
    expect(n3.fingerprint).toBe(norm.fingerprint)
  })

  it('지원하지 않는 기법은 예외 없이 other 로 표시', async () => {
    const { raw } = await load(EX.ut42)
    const s = clone(raw.setup) as AnyJson
    s.groups.push({ id: 9, name: 'ET', processes: [{ id: 0, inputs: [], outputs: [], dataMappingId: 0, implementation: 'Hardware', eddyCurrent: { frequency: 100000 } }] })
    const n = normalizeSetup(s, V42)
    const other = n.spec.groups.find((g) => g.technique === 'other')!
    expect(other.techniqueParams['unsupported']).toBe('eddyCurrent')
    expect(n.warnings.join(' ')).toContain('지원하지 않는 기법(eddyCurrent)')
    expect(n.summary).toContain('미지원(eddyCurrent)')

    const s3 = { version: '3.3.0', groups: [{ id: 0, name: 'x', somethingNew: {} }], specimens: [] }
    expect(normalizeSetup(s3, V33).spec.groups[0]!.technique).toBe('other')
  })

  it('summarizeAcquisition 단독 호출 (버전은 셋업에서 판별)', async () => {
    const { raw, norm } = await load(EX.comp42)
    expect(summarizeAcquisition(raw.setup)).toEqual(norm.acquisition)
    expect(norm.acquisition.groups.map((g) => g.gainDb).sort()).toEqual([29.3, 30.5])
    expect(norm.acquisition.encoder?.stepResolutionPerMm).toBe(49.5)
  })
})
