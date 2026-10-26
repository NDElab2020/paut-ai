import { describe, expect, it } from 'vitest'
import { newIndicationRecord, type NewRecordInit } from '@shared/labels/factory'
import {
  GROUPING_RULES_VERSION,
  applyGrouping,
  computeGrouping,
  cumulativeLimit,
  cumulativeVerdict,
  groupLengthMm,
  groupingParams,
  maxCumulativeLength,
  maxPointLikeCount,
  pointLikeLimit,
  type GroupingParams
} from '@shared/labels/grouping'
import type { HeightMethod, IndicationRecord } from '@shared/labels/types'

const SHA_A = 'a3f1'.repeat(16)
const SHA_B = '0b9e'.repeat(16)
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

interface Spec {
  x: [number, number]
  len?: number
  v?: [number | null, number | null]
  z?: [number | null, number | null]
  peakZ?: number
  h?: number
  hm?: HeightMethod
  point?: boolean
  over?: Partial<NewRecordInit>
}

function r(n: number, s: Spec): IndicationRecord {
  return newIndicationRecord({
    uuid: uuid(n),
    sha256: SHA_A,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    defectType: 'slag',
    pointLike: s.point ?? false,
    derived: {
      scanStartMm: s.x[0],
      scanEndMm: s.x[1],
      vMinMm: s.v?.[0] ?? null,
      vMaxMm: s.v?.[1] ?? null,
      depthTopMm: s.z?.[0] ?? null,
      depthBottomMm: s.z?.[1] ?? null
    },
    length: { valueMm: s.len ?? null, method: s.len !== undefined ? 'eval-level' : null },
    height: { valueMm: s.h ?? null, method: s.h !== undefined ? (s.hm ?? 'tip-tip') : null },
    signal: s.peakZ !== undefined ? { peak: { groupId: 0, beam: 1, angleDeg: 55, scanMm: s.x[0], depthMm: s.peakZ } } : {},
    ...s.over
  } as NewRecordInit)
}

const Z: [number, number] = [4, 5]
const V: [number, number] = [0, 1]

function groupsOf(records: IndicationRecord[], p: Partial<GroupingParams> = {}): string[][] {
  const res = computeGrouping(records, groupingParams(p))
  return res.groups.map((g) => g.recordUuids.map((u) => String(parseInt(u.slice(-12), 16))))
}

describe('그룹 길이 l12 = l1 + l2 + dx', () => {
  it('간격이 있으면 잰 길이 합 + 간격, 맞닿으면 간격 0', () => {
    expect(groupLengthMm([])).toBe(0)
    expect(groupLengthMm([{ scanStartMm: 0, scanEndMm: 10, lengthMm: 8 }, { scanStartMm: 12, scanEndMm: 20, lengthMm: null }])).toBe(8 + 8 + 2)
    expect(groupLengthMm([{ scanStartMm: 0, scanEndMm: 10, lengthMm: null }, { scanStartMm: 10, scanEndMm: 15, lengthMm: null }])).toBe(15)
    // 순서와 무관
    expect(groupLengthMm([{ scanStartMm: 30, scanEndMm: 35, lengthMm: null }, { scanStartMm: 0, scanEndMm: 10, lengthMm: null }])).toBe(35)
  })

  it('스캔 범위가 겹치면 합집합 길이 (안에 든 것도 겹침으로 본다)', () => {
    expect(groupLengthMm([{ scanStartMm: 0, scanEndMm: 10, lengthMm: 12 }, { scanStartMm: 5, scanEndMm: 20, lengthMm: 15 }])).toBe(20)
    expect(
      groupLengthMm([
        { scanStartMm: 0, scanEndMm: 20, lengthMm: null },
        { scanStartMm: 5, scanEndMm: 8, lengthMm: null },
        { scanStartMm: 9, scanEndMm: 12, lengthMm: null }
      ])
    ).toBe(20)
  })
})

describe('그림 5 (진폭 평가, t = 6)', () => {
  const t = { thicknessMm: 6 }

  it('x 간격 < 긴 지시 길이 × 2: 경계값(같음)은 묶지 않는다', () => {
    const a = r(1, { x: [0, 10], v: V, z: Z })
    expect(groupsOf([a, r(2, { x: [29.99, 34.99], v: V, z: Z })], t)).toEqual([['1', '2']])
    expect(groupsOf([a, r(2, { x: [30, 35], v: V, z: Z })], t)).toEqual([['1'], ['2']])
  })

  it('긴 지시는 둘 중 긴 쪽이고, 잰 길이가 있으면 그것을 쓴다', () => {
    // 짧은 쪽(4) 기준이면 8 미만이어야 하지만 긴 쪽(10) 기준 20 미만이면 묶는다
    expect(groupsOf([r(1, { x: [0, 4], v: V, z: Z }), r(2, { x: [10, 20], v: V, z: Z })], t)).toEqual([['1', '2']])
    // 스캔 범위는 2 mm 지만 잰 길이 10 → 2 × 10 = 20
    expect(groupsOf([r(1, { x: [0, 2], len: 10, v: V, z: Z }), r(2, { x: [21, 22], v: V, z: Z })], t)).toEqual([['1', '2']])
    expect(groupsOf([r(1, { x: [0, 2], v: V, z: Z }), r(2, { x: [21, 22], v: V, z: Z })], t)).toEqual([['1'], ['2']])
  })

  it('y(V) 간격 < t/2: 2.99 묶음, 3 은 안 묶음', () => {
    const a = r(1, { x: [0, 10], v: [0, 1], z: Z })
    expect(groupsOf([a, r(2, { x: [12, 20], v: [3.99, 5], z: Z })], t)).toEqual([['1', '2']])
    expect(groupsOf([a, r(2, { x: [12, 20], v: [4, 5], z: Z })], t)).toEqual([['1'], ['2']])
  })

  it('z(깊이) 간격 < t/2: 경계값은 안 묶음. 깊이 범위가 없으면 최대 진폭 깊이', () => {
    const a = r(1, { x: [0, 10], v: V, z: [1, 2] })
    expect(groupsOf([a, r(2, { x: [12, 20], v: V, z: [4.99, 5.5] })], t)).toEqual([['1', '2']])
    expect(groupsOf([a, r(2, { x: [12, 20], v: V, z: [5, 5.5] })], t)).toEqual([['1'], ['2']])
    expect(groupsOf([a, r(2, { x: [12, 20], v: V, peakZ: 4.9 })], t)).toEqual([['1', '2']])
    expect(groupsOf([a, r(2, { x: [12, 20], v: V, peakZ: 5 })], t)).toEqual([['1'], ['2']])
  })

  it("V·깊이를 모르면 기본은 통과로 보고 확인 사항을 남긴다. 'fail' 이면 묶지 않는다", () => {
    const recs = [r(1, { x: [0, 10] }), r(2, { x: [12, 20] })]
    const pass = computeGrouping(recs, groupingParams(t))
    expect(pass.groups.length).toBe(1)
    expect(pass.notes.join()).toContain('V(가로) 위치를 몰라')
    expect(pass.notes.join()).toContain('깊이를 몰라')
    expect(groupsOf(recs, { ...t, unknownDistance: 'fail' })).toEqual([['1'], ['2']])
  })

  it('t < 8 이면 점 같은 지시도 그림 5 로 묶는다', () => {
    expect(groupsOf([r(1, { x: [0, 10], v: V, z: Z }), r(2, { x: [12, 12], v: V, z: Z, point: true })], t)).toEqual([['1', '2']])
  })
})

describe('그림 6 (높이 평가, t = 12)', () => {
  const t = { thicknessMm: 12 }

  it('x 거리 < 긴 지시 길이 (그림 5 의 2배가 아님)', () => {
    const a = r(1, { x: [0, 10], z: [4, 5], h: 1 })
    expect(groupsOf([a, r(2, { x: [19.99, 25], z: [4, 5], h: 1 })], t)).toEqual([['1', '2']])
    expect(groupsOf([a, r(2, { x: [20, 25], z: [4, 5], h: 1 })], t)).toEqual([['1'], ['2']])
  })

  it('두께 방향 거리 < 높은 지시 높이: 경계값은 안 묶음', () => {
    const a = r(1, { x: [0, 10], z: [2, 3], h: 1 })
    expect(groupsOf([a, r(2, { x: [12, 20], z: [5.99, 6.5], h: 3 })], t)).toEqual([['1', '2']])
    expect(groupsOf([a, r(2, { x: [12, 20], z: [6, 6.5], h: 3 })], t)).toEqual([['1'], ['2']])
  })

  it('점 같은 지시는 묶지 않는다 (겹쳐도)', () => {
    expect(groupsOf([r(1, { x: [0, 10], z: Z, h: 1 }), r(2, { x: [5, 5], z: Z, h: 1, point: true })], t)).toEqual([['1'], ['2']])
  })

  it("t ≥ 8 이라도 높이가 없어 그림 5 로 가는 쌍은 점 같은 지시도 묶는다 ('auto' = 'amplitude' 와 같은 결과, 16.2 에는 점 지시 제외가 없음)", () => {
    const pts = [r(1, { x: [0, 2], v: V, z: Z, point: true }), r(2, { x: [3, 5], v: V, z: Z, point: true })]
    expect(groupsOf(pts, t)).toEqual([['1', '2']])
    expect(groupsOf(pts, { ...t, rule: 'amplitude' })).toEqual([['1', '2']])
  })

  it('기록 기준을 못 넘은 기록(약한 양성)은 기본으로 묶지 않고 길이를 늘리지 않는다', () => {
    const weak = r(2, { x: [12, 20], v: V, z: Z, over: { signal: { exceedsEvaluationLevel: true, exceedsRecordingLevel: false } } as never })
    const res = computeGrouping([r(1, { x: [0, 10], v: V, z: Z }), weak], groupingParams(t))
    expect(res.excluded).toEqual([{ uuid: uuid(2), reason: 'below-recording' }])
    expect(res.groups.map((g) => g.lengthMm)).toEqual([10])
    expect(groupsOf([r(1, { x: [0, 10], v: V, z: Z }), weak], { ...t, excludeBelowRecording: false })).toEqual([['1', '2']])
  })

  it("'auto': 높이를 하나라도 못 재면(−6 dB 높이 포함) 그 쌍은 그림 5", () => {
    // x 간격 10: 그림 6 이면 안 묶이고(10 < 10 거짓) 그림 5 면 묶인다(10 < 20)
    const pairWith = (h2: Omit<Spec, 'x'>): string[][] => groupsOf([r(1, { x: [0, 10], v: V, z: Z, h: 1 }), r(2, { x: [20, 25], v: V, z: Z, ...h2 })], t)
    expect(pairWith({ h: 1 })).toEqual([['1'], ['2']])
    expect(pairWith({})).toEqual([['1', '2']])
    expect(pairWith({ h: 1, hm: '6db' })).toEqual([['1', '2']])
    const res = computeGrouping([r(1, { x: [0, 10], v: V, z: Z, h: 1 }), r(2, { x: [20, 25], v: V, z: Z })], groupingParams(t))
    expect(res.groups[0]!.figures).toEqual(['fig5'])
  })

  it("'height' 규칙을 고르면 높이가 없는 쌍은 묶지 않는다. 'amplitude' 면 그림 5", () => {
    const recs = [r(1, { x: [0, 10], v: V, z: Z, h: 1 }), r(2, { x: [15, 20], v: V, z: Z })]
    expect(groupsOf(recs, { ...t, rule: 'height' })).toEqual([['1'], ['2']])
    expect(groupsOf(recs, { ...t, rule: 'amplitude' })).toEqual([['1', '2']])
  })

  it('묶음 높이 hg: 깊이가 떨어져 있으면 h1 + h2 + dz, 겹치면 큰 값', () => {
    const apart = computeGrouping([r(1, { x: [0, 10], z: [2, 3], h: 1 }), r(2, { x: [12, 20], z: [4, 5], h: 1.5 })], groupingParams(t))
    expect(apart.groups[0]).toMatchObject({ figures: ['fig6'], heightMm: 3.5, depthTopMm: 2, depthBottomMm: 5, lengthMm: 20 })
    const overlap = computeGrouping([r(1, { x: [0, 10], z: [2, 4], h: 1 }), r(2, { x: [12, 20], z: [3, 5], h: 1.5 })], groupingParams(t))
    expect(overlap.groups[0]!.heightMm).toBe(1.5)
  })
})

describe('한 번 쓴 지시 재사용 금지 · 묶는 순서', () => {
  const t = { thicknessMm: 6 }
  // A–B 간격 5, B–C 간격 5, A–C 간격 20 (= 2 × 10 이라 직접은 안 묶임)
  const abc = (): IndicationRecord[] => [
    r(1, { x: [0, 10], v: V, z: Z }),
    r(2, { x: [15, 25], v: V, z: Z }),
    r(3, { x: [30, 40], v: V, z: Z })
  ]

  it("'chain'(기본): 묶음을 한 지시(길이 l12)로 보고 다음 지시와 견준다", () => {
    expect(groupsOf(abc(), t)).toEqual([['1', '2', '3']])
    const g = computeGrouping(abc(), groupingParams(t)).groups[0]!
    expect(g.lengthMm).toBe(40)
    expect(g.groupingId).toBe(`g-${uuid(1)}`)
  })

  it("'pair': 둘씩만 묶고 이미 묶인 지시는 다시 쓰지 않는다", () => {
    expect(groupsOf(abc(), { ...t, combine: 'pair' })).toEqual([['1', '2'], ['3']])
  })

  it('지시 하나는 그룹 하나에만 들어가고, 입력 순서와 무관하게 같은 결과', () => {
    // 묶음 1–3 의 길이 40 → 2 × 40 = 80 보다 멀리 둔다 (가까우면 'chain' 이 묶음 길이로 더 끌어들임)
    const recs = [...abc(), r(4, { x: [200, 201], v: V, z: Z }), r(5, { x: [202, 203], v: V, z: Z })]
    const a = computeGrouping(recs, groupingParams(t))
    const b = computeGrouping([...recs].reverse(), groupingParams(t))
    expect(b.assignments).toEqual(a.assignments)
    const ids = Object.values(a.assignments)
    expect(ids.filter((x) => x === `g-${uuid(1)}`).length).toBe(3)
    expect(ids.filter((x) => x === `g-${uuid(4)}`).length).toBe(2)
    const members = a.groups.flatMap((g) => g.recordUuids)
    expect(new Set(members).size).toBe(members.length)
  })

  it('가장 가까운 쌍부터 묶는다 (깊이가 달라 이웃이 아닌 지시와도)', () => {
    // 1·3 은 같은 깊이(간격 2), 2 는 깊이가 멀어 따로
    const recs = [
      r(1, { x: [0, 10], v: V, z: [1, 1.5] }),
      r(2, { x: [5, 15], v: V, z: [5.5, 6] }),
      r(3, { x: [12, 20], v: V, z: [1, 1.5] })
    ]
    expect(groupsOf(recs, t)).toEqual([['1', '3'], ['2']])
  })
})

describe('대상 · 나누기 · 결과', () => {
  const t = { thicknessMm: 6 }

  it('삭제 표시·형상 에코·평가 기준 미만은 대상 밖(null)', () => {
    const recs = [
      r(1, { x: [0, 10], v: V, z: Z }),
      r(2, { x: [12, 20], v: V, z: Z, over: { deleted: true } }),
      r(3, { x: [12, 20], v: V, z: Z, over: { kind: 'geometric-echo', defectType: null, geometricEcho: { kind: 'root', fromSuggestion: true } } }),
      r(4, { x: [12, 20], v: V, z: Z, over: { signal: { exceedsEvaluationLevel: false } } as Partial<NewRecordInit> }),
      r(5, { x: [40, 45], v: V, z: Z, over: { signal: { exceedsEvaluationLevel: null } } as Partial<NewRecordInit> })
    ]
    const res = computeGrouping(recs, groupingParams(t))
    expect(res.excluded).toEqual([
      { uuid: uuid(2), reason: 'deleted' },
      { uuid: uuid(3), reason: 'kind' },
      { uuid: uuid(4), reason: 'below-evaluation' }
    ])
    expect([res.assignments[uuid(2)], res.assignments[uuid(3)], res.assignments[uuid(4)]]).toEqual([null, null, null])
    expect(res.assignments[uuid(5)]).toBe(`g-${uuid(5)}`)
    expect(res.rulesVersion).toBe(GROUPING_RULES_VERSION)
    // 평가 기준 미만도 넣기
    const all = computeGrouping(recs, groupingParams({ ...t, excludeBelowEvaluation: false }))
    expect(all.assignments[uuid(4)]).toBe(`g-${uuid(1)}`)
  })

  it('다른 라벨 세트·다른 파일끼리는 묶지 않는다', () => {
    const recs = [
      r(1, { x: [0, 10], v: V, z: Z }),
      r(2, { x: [12, 20], v: V, z: Z, over: { labelerId: 'lee' } }),
      r(3, { x: [12, 20], v: V, z: Z, over: { readingStage: 'reconciled' } }),
      r(4, { x: [12, 20], v: V, z: Z, over: { sha256: SHA_B } })
    ]
    expect(groupsOf(recs, t).length).toBe(4)
  })

  it('두께를 모르면 묶지 않고 확인 사항을 남긴다. 파일마다 두께를 줄 수 있다', () => {
    const recs = [r(1, { x: [0, 10], v: V, z: Z }), r(2, { x: [12, 20], v: V, z: Z })]
    const none = computeGrouping(recs, groupingParams())
    expect(none.groups.length).toBe(2)
    expect(none.notes.join()).toContain('두께를 몰라')
    const perFile = computeGrouping(recs, groupingParams(), (sha) => (sha === SHA_A ? 6 : null))
    expect(perFile.groups.length).toBe(1)
    expect(computeGrouping(recs, groupingParams({ thicknessMm: 20 })).notes.join()).toContain('시방서 범위')
  })

  it('applyGrouping: 바뀐 기록만 새 객체', () => {
    const recs = [r(1, { x: [0, 10], v: V, z: Z }), r(2, { x: [12, 20], v: V, z: Z }), r(3, { x: [0, 1], over: { deleted: true } })]
    const res = computeGrouping(recs, groupingParams(t))
    const out = applyGrouping(recs, res)
    expect(out.map((x) => x.groupingId)).toEqual([`g-${uuid(1)}`, `g-${uuid(1)}`, null])
    expect(out[2]).toBe(recs[2])
    expect(applyGrouping(out, res)[0]).toBe(out[0])
  })
})

describe('누적 길이', () => {
  it('허용: 두께·평가 방법별 구간 길이와 합 (시방서 범위 밖은 null)', () => {
    expect(cumulativeLimit(6, 'fig5')).toEqual({ table: '4761-L2', windowMm: 72, maxSumMm: 24, inclusive: true, excludesPointLike: false })
    expect(cumulativeLimit(3.2, 'fig6')?.table).toBe('4761-L2')
    expect(cumulativeLimit(7.99, 'fig5')?.table).toBe('4761-L2')
    const amp = cumulativeLimit(12, 'fig5')!
    expect([amp.table, amp.windowMm, amp.inclusive]).toEqual(['19285-L2-amplitude', 72, false])
    expect(amp.maxSumMm).toBeCloseTo(21.6, 9)
    expect(cumulativeLimit(12, 'fig5', { combinedSE: true })!.maxSumMm).toBeCloseTo(32.4, 9)
    expect(cumulativeLimit(8, 'fig6')).toEqual({ table: '19285-L2-height', windowMm: 96, maxSumMm: 32, inclusive: true, excludesPointLike: true })
    expect(cumulativeLimit(12, 'fig6', { combinedSE: true })!.maxSumMm).toBe(72)
    expect(cumulativeLimit(15, 'fig6')).not.toBeNull()
    for (const t of [null, 3.1, 15.01, Number.NaN]) expect(cumulativeLimit(t, 'fig5')).toBeNull()
  })

  it("어느 구간에서든 합의 최댓값: 'whole' 은 걸치면 전부, 'clip' 은 걸친 만큼", () => {
    const units = [
      { scanStartMm: 0, scanEndMm: 10, lengthMm: 10, groupingId: 'a' },
      { scanStartMm: 70, scanEndMm: 80, lengthMm: 10, groupingId: 'b' }
    ]
    expect(maxCumulativeLength(units, 72)).toMatchObject({ maxSumMm: 20, unitIds: ['a', 'b'] })
    expect(maxCumulativeLength(units, 72, { partial: 'clip' }).maxSumMm).toBeCloseTo(12, 9)
    expect(maxCumulativeLength(units, 50).maxSumMm).toBe(10)
    expect(maxCumulativeLength([], 72)).toEqual({ maxSumMm: 0, windowStartMm: null, windowEndMm: null, unitIds: [] })
    const withPoint = [...units, { scanStartMm: 5, scanEndMm: 5, lengthMm: 1, pointLike: true, groupingId: 'p' }]
    expect(maxCumulativeLength(withPoint, 72).maxSumMm).toBe(21)
    expect(maxCumulativeLength(withPoint, 72, { excludePointLike: true }).maxSumMm).toBe(20)
  })

  it('판정 경계: ≤ 허용(4761) 은 같으면 합격, < 허용(19285 진폭) 은 같으면 불합격', () => {
    const one = (len: number) => [{ scanStartMm: 0, scanEndMm: len, lengthMm: len }]
    expect(cumulativeVerdict(one(24), 6, 'fig5').exceeds).toBe(false)
    expect(cumulativeVerdict(one(24.01), 6, 'fig5').exceeds).toBe(true)
    expect(cumulativeVerdict(one(21.6), 12, 'fig5').exceeds).toBe(true)
    expect(cumulativeVerdict(one(21.5), 12, 'fig5').exceeds).toBe(false)
    expect(cumulativeVerdict(one(48), 12, 'fig6').exceeds).toBe(false)
    expect(cumulativeVerdict(one(10), 20, 'fig6')).toEqual({ limit: null, result: null, exceeds: null })
  })

  it('그룹 짓기 결과를 그대로 넣을 수 있다', () => {
    const recs = [r(1, { x: [0, 10], v: V, z: Z }), r(2, { x: [12, 20], v: V, z: Z }), r(3, { x: [60, 66], v: V, z: Z })]
    const g = computeGrouping(recs, groupingParams({ thicknessMm: 6 }))
    const v = cumulativeVerdict(g.groups, 6, 'fig5')
    expect(v.result?.maxSumMm).toBe(20 + 6)
    expect(v.exceeds).toBe(true)
  })

  it('점 같은 지시: 150 mm 당 N = 1.2t 올림, 어느 150 mm 에서든 개수의 최댓값', () => {
    expect(pointLikeLimit(10)).toBe(12)
    expect(pointLikeLimit(12)).toBe(15)
    expect(pointLikeLimit(16)).toBe(20)
    const pts = [0, 100, 149, 151, 300].map((x, i) => ({ scanStartMm: x, scanEndMm: x, lengthMm: 1, pointLike: true, groupingId: String(i) }))
    expect(maxPointLikeCount(pts).count).toBe(3)
    expect(maxPointLikeCount([...pts, { scanStartMm: 150, scanEndMm: 150, lengthMm: 1, pointLike: true }]).count).toBe(4)
    expect(maxPointLikeCount([{ scanStartMm: 0, scanEndMm: 1, lengthMm: 1 }]).count).toBe(0)
  })
})
