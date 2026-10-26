import { describe, expect, it } from 'vitest'
import { diffSpecs, describeDifference, normalizeSetup, parseNdeVersion, withinTolerance } from '@core/nde'
import { EX, HAS_EXAMPLES, HAS_X3, X3_FILES, clone, load } from './fixtures'

type AnyJson = Record<string, any>
const V33 = parseNdeVersion('3.3.0')
const V42 = parseNdeVersion('4.2.0')

describe.skipIf(!HAS_X3)('지문 v2 — 탐촉자 장착 방향·스캔면·스큐', () => {
  const fpOf = (s: AnyJson): string => normalizeSetup(s, V33).fingerprint

  it('장착 방향 Reverse 는 다른 플랜이고 차이에 "탐촉자 장착 방향"으로 나온다', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const s = clone(raw.setup) as AnyJson
    s.probes[0].wedgeAssociation.orientation = 'Reverse'
    const other = normalizeSetup(s, V33)
    expect(other.fingerprint).not.toBe(norm.fingerprint)
    const labels = diffSpecs(norm.spec, other.spec).map(describeDifference)
    expect(labels.some((l) => l.startsWith('탐촉자 장착 방향'))).toBe(true)
  })

  it('orientation 이 없으면 Normal 과 같다', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const s = clone(raw.setup) as AnyJson
    for (const p of s.probes) delete p.wedgeAssociation.orientation
    expect(fpOf(s)).toBe(norm.fingerprint)
  })

  it('스큐 0 = 360, 90 = 450', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const a = clone(raw.setup) as AnyJson
    a.wedges[0].positioning.skewAngle += 360
    expect(fpOf(a)).toBe(norm.fingerprint)
    const b = clone(raw.setup) as AnyJson
    const c = clone(raw.setup) as AnyJson
    b.wedges[0].positioning.skewAngle = 0
    c.wedges[0].positioning.skewAngle = 360
    expect(fpOf(b)).toBe(fpOf(c))
  })

  it('반대 면(Bottom)에서 스캔하면 다른 플랜', async () => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const s = clone(raw.setup) as AnyJson
    const surfaces = s.specimens[0].plateGeometry.surfaces as AnyJson[]
    const top = surfaces[0]!
    const bottomId = top.id + 1
    surfaces.push({ id: bottomId, name: top.name === 'Top' ? 'Bottom' : 'Top' })
    s.wedges[0].positioning.surfaceId = bottomId
    const other = normalizeSetup(s, V33)
    expect(other.fingerprint).not.toBe(norm.fingerprint)
    expect(diffSpecs(norm.spec, other.spec).map((d) => d.label)).toContain('스캔면')
  })

  it('허용오차 경계에 걸린 차이는 withinTolerance', async () => {
    const { raw } = await load(X3_FILES[0]!)
    const a = clone(raw.setup) as AnyJson
    const b = clone(raw.setup) as AnyJson
    for (const g of a.groups) g.paut.focusing.distance = 0.02304
    for (const g of b.groups) g.paut.focusing.distance = 0.02306
    const na = normalizeSetup(a, V33)
    const nb = normalizeSetup(b, V33)
    expect(na.fingerprint).not.toBe(nb.fingerprint)
    expect(withinTolerance(na.spec, nb.spec)).toBe(true)
    const c = clone(raw.setup) as AnyJson
    c.specimens[0].plateGeometry.thickness = 0.025
    expect(withinTolerance(na.spec, normalizeSetup(c, V33).spec)).toBe(false)
  })
})

describe.skipIf(!HAS_EXAMPLES)('지문 v2 — 공식 예제 변형', () => {
  it('배관 angularOpening 이 없으면 360(전체 원주)과 같은 지문', async () => {
    const { raw, norm } = await load(EX.cod42)
    const s = clone(raw.setup) as AnyJson
    const pipe = s.specimens.find((x: AnyJson) => x.pipeGeometry).pipeGeometry
    expect(pipe.angularOpening).toBe(360)
    delete pipe.angularOpening
    const other = normalizeSetup(s, V42)
    expect(other.spec.specimen.angularOpeningDeg).toBe(360)
    expect(other.fingerprint).toBe(norm.fingerprint)
    expect((await load(EX.tofd42)).norm.spec.specimen.angularOpeningDeg).toBe(360)
  })

  it('COD 두께 표현(0.006150000000000006)과 0.00615 는 같은 지문', async () => {
    const { raw, norm } = await load(EX.cod42)
    const s = clone(raw.setup) as AnyJson
    const pipe = s.specimens.find((x: AnyJson) => x.pipeGeometry).pipeGeometry
    pipe.thickness = 0.00615 - 1e-12
    expect(normalizeSetup(s, V42).fingerprint).toBe(norm.fingerprint)
  })

  it('4.x 액주 웨지의 웨지 각은 지문에 들어간다', async () => {
    const { raw } = await load(EX.sect42)
    const toFluid = (angle: number): AnyJson => {
      const s = clone(raw.setup) as AnyJson
      const w = s.wedges[0]
      const loc = w.angleBeamWedge.mountingLocations[0]
      w.fluidColumn = { nominalHeight: 0.01, longitudinalVelocity: 1480, mountingLocations: [{ ...loc, wedgeAngle: angle }] }
      delete w.angleBeamWedge
      return s
    }
    const a = normalizeSetup(toFluid(10), V42)
    const b = normalizeSetup(toFluid(25), V42)
    expect(a.spec.groups[0]!.probes[0]!.wedge).toMatchObject({ kind: 'fluidColumn', wedgeAngleDeg: 10 })
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('3.x 액주 탐촉자(probes[].fluidColumn)도 웨지 각을 읽는다', () => {
    const setup = (angle: number): AnyJson => ({
      version: '3.3.0',
      specimens: [{ id: 0, plateGeometry: { thickness: 0.02, material: { name: 'Steel' }, surfaces: [{ id: 0, name: 'Top' }] } }],
      probes: [
        {
          id: 0,
          model: 'C-IMM',
          conventionalRound: { centralFrequency: 5e6, diameter: 0.006 },
          fluidColumn: {
            name: 'Water',
            longitudinalVelocity: 1480,
            wedgeAngle: angle,
            primaryOffset: 0,
            secondaryOffset: 0,
            tertiaryOffset: 0,
            positioning: { specimenId: 0, surfaceId: 0, uCoordinateOffset: 0, vCoordinateOffset: -0.01, skewAngle: 90 }
          }
        }
      ],
      groups: [{ id: 0, name: 'UT', ut: { pulseEcho: { probeId: 0 }, refractedAngle: 45, waveMode: 'Longitudinal' } }]
    })
    const a = normalizeSetup(setup(10), V33)
    const b = normalizeSetup(setup(25), V33)
    expect(a.spec.groups[0]!.probes[0]!.wedge).toEqual({ model: 'Water', kind: 'fluidColumn', wedgeAngleDeg: 10 })
    expect(a.spec.groups[0]!.probes[0]!.position).toMatchObject({ vOffsetMm: -10, skewDeg: 90, surface: 'Top' })
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('TFM 다중 탐촉자: 송신/수신 역할을 지키고 id 를 바꿔도 같은 플랜, 좌우 반전은 다른 플랜', async () => {
    const { raw } = await load(EX.tfm42)
    const base = raw.setup as AnyJson
    const capIdx = base.groups.findIndex((g: AnyJson) => g.processes?.some((p: AnyJson) => p.ultrasonicMatrixCapture))
    expect(capIdx).toBeGreaterThanOrEqual(0)
    // 탐촉자·웨지를 2개로: 0 = 송신(-10 mm), 1 = 수신(+10 mm)
    const make = (sendOffset: number, recvOffset: number, swapIds: boolean): AnyJson => {
      const s = clone(base) as AnyJson
      const p0 = s.probes[0]
      const w0 = s.wedges[0]
      const sendId = swapIds ? 1 : 0
      const recvId = swapIds ? 0 : 1
      const probe = (id: number): AnyJson => ({ ...clone(p0), id, wedgeAssociation: { ...p0.wedgeAssociation, wedgeId: id } })
      const wedge = (id: number, off: number): AnyJson => ({ ...clone(w0), id, positioning: { ...w0.positioning, vCoordinateOffset: off } })
      s.probes = [probe(0), probe(1)]
      s.wedges = [wedge(sendId, sendOffset), wedge(recvId, recvOffset)].sort((a, b) => a.id - b.id)
      const cap = s.groups[capIdx].processes.find((p: AnyJson) => p.ultrasonicMatrixCapture).ultrasonicMatrixCapture
      for (const b of cap.beams) {
        for (const el of b.pulsers) el.probeId = sendId
        for (const el of b.receivers) el.probeId = recvId
      }
      return s
    }
    const a = normalizeSetup(make(-0.01, 0.01, false), V42)
    const b = normalizeSetup(make(-0.01, 0.01, true), V42)
    const c = normalizeSetup(make(0.01, -0.01, false), V42)
    const roles = a.spec.groups[0]!.probes.map((p) => [p.role, p.position?.vOffsetMm])
    expect(roles).toEqual([
      ['pulser', -10],
      ['receiver', 10]
    ])
    expect(b.fingerprint).toBe(a.fingerprint)
    expect(c.fingerprint).not.toBe(a.fingerprint)
  })
})
