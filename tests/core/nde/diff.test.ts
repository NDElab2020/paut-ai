import { describe, expect, it } from 'vitest'
import { describeDifference, diffSpecs, normalizeSetup, parseNdeVersion, specDistance, suggestPlanName, summarizeSpec } from '@core/nde'
import { EX, HAS_EXAMPLES, HAS_X3, X3_FILES, clone, load } from './fixtures'

type AnyJson = Record<string, any>
const V33 = parseNdeVersion('3.3.0')

describe.skipIf(!HAS_X3)('diffSpecs — X3 변형', () => {
  const variant = async (f: (s: AnyJson) => void) => {
    const { raw, norm } = await load(X3_FILES[0]!)
    const s = clone(raw.setup) as AnyJson
    f(s)
    return { base: norm.spec, next: normalizeSetup(s, V33).spec }
  }

  it('같으면 빈 배열, 거리 0', async () => {
    const a = (await load(X3_FILES[0]!)).norm.spec
    const b = (await load(X3_FILES[2]!)).norm.spec
    expect(diffSpecs(a, b)).toEqual([])
    expect(specDistance(a, b)).toBe(0)
  })

  it('두께만 바뀜', async () => {
    const { base, next } = await variant((s) => (s.specimens[0].plateGeometry.thickness = 0.025))
    const diffs = diffSpecs(base, next)
    expect(diffs).toEqual([{ category: 'specimen', path: 'specimen.thicknessMm', label: '두께', existing: 12, incoming: 25 }])
    expect(diffs.map(describeDifference)).toEqual(['두께 12 mm → 25 mm'])
    expect(specDistance(base, next)).toBeGreaterThan(0)
  })

  it('인덱스 오프셋 ±15 → ±14 는 한 항목으로', async () => {
    const { base, next } = await variant((s) => {
      s.wedges[0].positioning.vCoordinateOffset = -0.014
      s.wedges[1].positioning.vCoordinateOffset = 0.014
    })
    const text = diffSpecs(base, next).map(describeDifference)
    expect(text).toEqual(['인덱스 오프셋 ±15 mm → ±14 mm'])
  })

  it('모든 그룹에 같은 변화(집속 거리)는 groups[*] 하나로 합친다', async () => {
    const { base, next } = await variant((s) => {
      for (const g of s.groups) g.paut.focusing.distance = 0.026
    })
    const diffs = diffSpecs(base, next)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ category: 'beam', path: 'groups[*].focusing.distanceMm', existing: 23, incoming: 26 })
    expect(describeDifference(diffs[0]!)).toBe('집속 거리 23 mm → 26 mm')
  })

  it('한 그룹만 바뀌면 그룹 번호를 붙인다', async () => {
    const { base, next } = await variant((s) => (s.groups[1].paut.pulseEcho.sectorialFormation.beamRefractedAngles.stop = 65))
    const diffs = diffSpecs(base, next)
    expect(diffs.some((d) => d.path === 'groups.techniques')).toBe(true)
    const beam = diffs.find((d) => d.category === 'beam')!
    expect(beam.path).toMatch(/^groups\[\d\]\.refractedAngle\.stopDeg$/)
    expect(describeDifference(beam)).toMatch(/^\[PA 섹터 40–70° · 스큐 (90|270)°\] 굴절각 끝 70° → 65°$/)
  })
})

describe.skipIf(!HAS_X3 || !HAS_EXAMPLES)('diffSpecs — 4.2 PA 섹터 sk90 vs X3', () => {
  it('다른 플랜이고 차이가 의미 있게 나온다', async () => {
    const x3 = (await load(X3_FILES[0]!)).norm
    const sect = (await load(EX.sect42)).norm
    expect(sect.fingerprint).not.toBe(x3.fingerprint)
    const diffs = diffSpecs(x3.spec, sect.spec)
    const text = diffs.map(describeDifference)
    expect(text).toEqual(
      expect.arrayContaining([
        '두께 12 mm → 26 mm',
        '재질 Steel_Mild → Steel_Stainless',
        '그룹 수 2 → 1',
        '탐촉자 모델 5L64-A32 ×2 → 5L64-A32',
        '인덱스 오프셋 ±15 mm → -26 mm',
        '스큐 90, 270° → 90°'
      ])
    )
    expect(diffs.every((d) => d.label.length > 0)).toBe(true)
    expect(new Set(diffs.map((d) => d.category))).toEqual(new Set(['specimen', 'structure', 'probe', 'position']))
    console.info('[diff X3 → 4.2 PA-Sect]\n  ' + text.join('\n  '))
  })

  it('specDistance: 더 비슷한 플랜이 더 가깝다', async () => {
    const x3 = (await load(X3_FILES[0]!)).norm.spec
    const sect = (await load(EX.sect42)).norm.spec
    const tofd = (await load(EX.tofd42)).norm.spec
    expect(specDistance(x3, sect)).toBeLessThan(specDistance(x3, tofd))
  })
})

describe.skipIf(!HAS_X3 || !HAS_EXAMPLES)('요약·이름 제안', () => {
  it('X3', async () => {
    const { spec } = (await load(X3_FILES[0]!)).norm
    expect(summarizeSpec(spec)).toBe('판재 12 mm · V 개선 · 5L64-A32 ×2 · ±15 mm · PA 섹터 40–70°')
    expect(suggestPlanName(spec)).toBe('12T · 5MHz · SK90/270')
  })

  it('공식 예제', async () => {
    expect(suggestPlanName((await load(EX.cod42)).norm.spec)).toBe('6.2T · 10/5MHz · SK90/270')
    expect(suggestPlanName((await load(EX.tfm42)).norm.spec)).toBe('12.5T · 5MHz · SK90')
    expect(suggestPlanName((await load(EX.manualUt33)).norm.spec)).toBe('26T · 3.5MHz · SK90')
    expect(summarizeSpec((await load(EX.manualPa33)).norm.spec)).toBe('판재 26 mm · V 개선 · 2.25L16-A10 · +16 mm · PA 섹터 30–70°')
  })
})
