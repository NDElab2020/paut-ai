import { describe, expect, it } from 'vitest'
import { formatPlanId } from '@shared/ids'
import { groupPlans, planGroupPath, plansInGroupOrder, type ThicknessGroup } from '@shared/planGroups'
import { frequencyLabel, planNameFrom, skewLabel, thicknessBucket, thicknessLabel } from '@shared/planName'
import type { ScanPlanSpec } from '@shared/types'
import { seedManyPlans } from '../src/renderer/src/api/mockData'
import { HAS_EXAMPLES, HAS_X3, X3_FILES, listExampleFiles, load } from './core/nde/fixtures'

/** 두께·주파수·스큐만 정한 최소 스펙 (탐촉자 1개 = [주파수, 스큐] 1쌍) */
function spec(thicknessMm: number | null, probes: Array<[number | null, number | null]>): ScanPlanSpec {
  return {
    specVersion: 2,
    specimen: { shape: 'plate', thicknessMm, outerRadiusMm: null, angularOpeningDeg: null, materialName: null, weld: null },
    groups: probes.map(([mhz, skew]) => ({
      technique: 'PA',
      formation: 'sectorial',
      firstElement: null,
      aperture: null,
      elementStep: null,
      refractedAngle: null,
      focusing: { mode: null, distanceMm: null },
      waveMode: null,
      probes: [
        {
          role: 'pulseEcho',
          probe: { model: null, kind: 'phasedArrayLinear', centralFrequencyMHz: mhz, elementCount: null, pitchMm: null },
          orientation: 'Normal',
          wedge: null,
          position: { uOffsetMm: null, vOffsetMm: null, skewDeg: skew, surface: null }
        }
      ],
      techniqueParams: {}
    }))
  }
}

/** 묶음 결과를 'T>F>S>ID,ID' 줄로 펼친다 */
function flatten(groups: ThicknessGroup[]): string[] {
  return groups.flatMap((t) => t.freqs.flatMap((f) => f.skews.map((s) => `${t.label}>${f.label}>${s.label}>${s.plans.map((p) => p.id).join(',')}`)))
}

/** 사용자 실제 저장소(X3 4개 + 공식 예제 11개 → 플랜 9개)의 묶음 */
const EXPECTED_REAL = [
  '0~10T>10/5MHz>SK90/270>SP006',
  '10~20T>2.25MHz>SK90>SP005',
  '10~20T>5MHz>SK90>SP004,SP007',
  '10~20T>5MHz>SK90/270>SP001',
  '10~20T>10MHz>SK90/270>SP009',
  '20~30T>2.25MHz>SK270>SP002',
  '20~30T>3.5MHz>SK90>SP003',
  '20~30T>5MHz>SK90>SP008'
]

describe('두께 구간 (10mm, 아래 끝 포함·위 끝 미포함)', () => {
  const label = (t: number | null): string | undefined => thicknessBucket(spec(t, []))?.label
  it('경계', () => {
    expect(label(0)).toBe('0~10T')
    expect(label(6.2)).toBe('0~10T')
    expect(label(9.99)).toBe('0~10T')
    expect(label(10)).toBe('10~20T')
    expect(label(12.5)).toBe('10~20T')
    expect(label(19.99)).toBe('10~20T')
    expect(label(20)).toBe('20~30T')
    expect(label(26)).toBe('20~30T')
    expect(label(30)).toBe('30~40T')
    expect(label(100)).toBe('100~110T')
    expect(label(null)).toBeUndefined()
  })
  it('미상은 "두께 미상" 구간', () => {
    expect(groupPlans([{ id: 'SP001', spec: spec(null, [[5, 90]]) }])[0]?.label).toBe('두께 미상')
  })
})

describe('라벨은 플랜 이름 규칙과 같다', () => {
  it('주파수: 고유값 큰 순, 스큐: 고유값 작은 순, 두께: 0.1 자리', () => {
    const s = spec(12.04, [[5, 270], [10, 90], [5, 90.04]])
    expect(frequencyLabel(s)).toBe('10/5MHz')
    expect(skewLabel(s)).toBe('SK90/270')
    expect(thicknessLabel(s)).toBe('12T')
    expect(planNameFrom(s)).toBe('12T · 10/5MHz · SK90/270')
    expect(frequencyLabel(spec(10, [[2.25, 90]]))).toBe('2.25MHz')
    expect(planNameFrom(spec(null, [[null, null]]))).toBe('이름 없는 스캔플랜')
    expect(planNameFrom(spec(6.2, [[null, 0]]))).toBe('6.2T · SK0')
  })
  it('미상 라벨', () => {
    const g = groupPlans([{ id: 'SP001', spec: spec(12, [[null, null]]) }])
    expect(flatten(g)).toEqual(['10~20T>주파수 미상>스큐 미상>SP001'])
  })
})

describe('정렬', () => {
  it('두께 오름차순(미상 끝) → 최대 MHz 오름차순(미상 끝) → 스큐 첫 값·개수 → ID', () => {
    const plans = [
      { id: 'SP010', spec: spec(null, [[5, 90]]) },
      { id: 'SP002', spec: spec(25, [[5, 90]]) },
      { id: 'SP003', spec: spec(12, [[null, 90]]) },
      { id: 'SP004', spec: spec(12, [[10, 90]]) },
      { id: 'SP005', spec: spec(12, [[10, 90], [5, 90]]) },
      { id: 'SP006', spec: spec(12, [[2.25, 90], [2.25, 270]]) },
      { id: 'SP007', spec: spec(12, [[2.25, 90]]) },
      { id: 'SP008', spec: spec(12, [[2.25, 0]]) },
      { id: 'SP009', spec: spec(12, [[2.25, null]]) },
      { id: 'SP011', spec: spec(18, [[2.25, 90]]) },
      { id: 'SP001', spec: spec(3, [[5, 90]]) }
    ]
    const g = groupPlans(plans)
    expect(flatten(g)).toEqual([
      '0~10T>5MHz>SK90>SP001',
      '10~20T>2.25MHz>SK0>SP008',
      '10~20T>2.25MHz>SK90>SP007,SP011',
      '10~20T>2.25MHz>SK90/270>SP006',
      '10~20T>2.25MHz>스큐 미상>SP009',
      '10~20T>10MHz>SK90>SP004',
      '10~20T>10/5MHz>SK90>SP005',
      '10~20T>주파수 미상>SK90>SP003',
      '20~30T>5MHz>SK90>SP002',
      '두께 미상>5MHz>SK90>SP010'
    ])
    expect(g.map((t) => t.planCount)).toEqual([1, 8, 1, 1])
    expect(g[1]?.freqs.map((f) => f.planCount)).toEqual([5, 1, 1, 1])
  })
  it('빈 목록·키 고유', () => {
    expect(groupPlans([])).toEqual([])
    const a = planGroupPath(spec(12, [[5, 90]]))
    const b = planGroupPath(spec(22, [[5, 90]]))
    expect(a.frequencyKey).not.toBe(b.frequencyKey)
    expect(a.skewKey).not.toBe(b.skewKey)
  })
})

describe('9개 플랜 구성 (실제 저장소와 같은 묶음)', () => {
  it('브라우저 mock ?mock=many', () => {
    const plans = seedManyPlans()
    expect(plans).toHaveLength(9)
    // 이름은 planNameFrom, 겹치면 실제 가져오기처럼 ' (2)' (SP007)
    for (const p of plans) expect(p.name).toBe(p.id === 'SP007' ? `${planNameFrom(p.spec)} (2)` : planNameFrom(p.spec))
    expect(new Set(plans.map((p) => p.name)).size).toBe(9)
    expect(flatten(groupPlans(plans))).toEqual(EXPECTED_REAL)
    expect(plansInGroupOrder(groupPlans(plans)).map((p) => p.id)).toEqual(['SP006', 'SP005', 'SP004', 'SP007', 'SP001', 'SP009', 'SP002', 'SP003', 'SP008'])
  })

  it.skipIf(!HAS_X3 || !HAS_EXAMPLES)('X3 4개 + 공식 예제 11개 (가져오기 순서대로 플랜 번호)', async () => {
    const byFingerprint = new Map<string, { id: string; spec: ScanPlanSpec }>()
    for (const path of [...X3_FILES, ...listExampleFiles()]) {
      const { norm } = await load(path)
      if (!byFingerprint.has(norm.fingerprint)) byFingerprint.set(norm.fingerprint, { id: formatPlanId(byFingerprint.size + 1), spec: norm.spec })
    }
    const plans = [...byFingerprint.values()]
    expect(plans).toHaveLength(9)
    expect(flatten(groupPlans(plans))).toEqual(EXPECTED_REAL)
    // mock 9개와 실제 9개는 ID 별 두께 구간·주파수·스큐가 같다
    const mock = new Map(seedManyPlans().map((p) => [p.id, planGroupPath(p.spec).skewKey]))
    for (const p of plans) expect(planGroupPath(p.spec).skewKey, p.id).toBe(mock.get(p.id))
  })
})
