import { describe, expect, it } from 'vitest'
import { newFileAlignment, newIndicationRecord, newPhysicalDefect, newReviewInterval } from '@shared/labels/factory'
import type { IndicationRecord, MetallurgicalType, WeldSide } from '@shared/labels/types'
import {
  MATCH_RULES_VERSION,
  PROVISIONAL_DEPTH_DIFF_MM,
  PROVISIONAL_SCAN_GAP_MM,
  compareItems,
  matchIndications,
  matchItems,
  matchParams,
  physicalDefectItems,
  prepareMatchItems,
  reviewSpans,
  reviewedCoverage,
  type MatchParams
} from '@shared/labels/match'
import { intersectCoverage, intervalGap, mergeSpans } from '@shared/labels/spans'
import {
  binomialCdf,
  characterConfusion,
  cohenKappa,
  cohenKappaFromLabels,
  confusionMatrix,
  detectionSummary,
  errorReport,
  errorStats,
  falsePositiveRate,
  gradingUnitAgreement,
  makeGradingUnits,
  pairDiffs,
  physicalDefectRecall,
  podLowerBound,
  proposalClassConfusion,
  quantile,
  requiredDefectsFor9095,
  requiredDefectsForPod,
  uncertainTruthShare,
  unitLabel,
  wilsonInterval
} from '@shared/labels/metrics'

// ───────────────────────────── 시료 ─────────────────────────────

const SHA_1 = 'a3f1'.repeat(16)
const SHA_2 = '0b9e'.repeat(16)
let seq = 0
const uuid = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`

interface RecOpts {
  sha?: string
  scan: [number, number]
  depth?: [number | null, number | null]
  side?: WeldSide | null
  type?: MetallurgicalType | null
  uncertain?: boolean
  typeUncertain?: boolean
  belowRecording?: boolean
  deleted?: boolean
  grouping?: string | null
  length?: number | null
  height?: number | null
  heightMethod?: 'tip-tip' | 'unmeasurable'
  labeler?: string
  peakDepth?: number | null
  physicalDefectId?: string | null
}

function rec(o: RecOpts): IndicationRecord {
  return newIndicationRecord({
    uuid: uuid(),
    sha256: o.sha ?? SHA_1,
    labelerId: o.labeler ?? 'kim',
    guidelineVersion: 'v1',
    deleted: o.deleted ?? false,
    existenceConfidence: o.uncertain ? 'uncertain' : 'certain',
    defectType: o.type === undefined ? 'lof-sidewall' : o.type,
    typeConfidence: o.typeUncertain ? 'uncertain' : null,
    groupingId: o.grouping ?? null,
    derived: {
      scanStartMm: o.scan[0],
      scanEndMm: o.scan[1],
      depthTopMm: o.depth?.[0] ?? null,
      depthBottomMm: o.depth?.[1] ?? null
    },
    location: { side: o.side ?? null },
    length: { valueMm: o.length ?? null },
    height: { valueMm: o.height ?? null, method: o.heightMethod ?? (o.height != null ? 'tip-tip' : null) },
    signal: {
      exceedsRecordingLevel: o.belowRecording ? false : null,
      peak: o.peakDepth != null ? { groupId: null, beam: null, angleDeg: null, scanMm: null, depthMm: o.peakDepth } : null
    },
    physicalDefectId: o.physicalDefectId ?? null
  })
}

const P = (over: Partial<MatchParams> = {}): MatchParams => matchParams({ scanGapMm: 10, depthDiffMm: 5, ...over })

/** 한 쌍만 비교해 짝이 되었는지 */
function matches(a: RecOpts, b: RecOpts, over: Partial<MatchParams> = {}): boolean {
  return matchIndications([rec(a)], [rec(b)], P(over)).pairs.length === 1
}

// ───────────────────────────── 매칭 조건 ─────────────────────────────

describe('매칭 조건 — 스캔 구간', () => {
  it('겹치면 맞고, 겹침·간격을 잰다', () => {
    const r = matchIndications([rec({ scan: [100, 120] })], [rec({ scan: [110, 130] })], P())
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0]?.scanOverlapMm).toBe(10)
    expect(r.pairs[0]?.scanGapMm).toBe(0)
    expect(r.pairs[0]?.scanCenterDiffMm).toBe(10)
  })

  it('맞닿음(간격 0)은 겹침으로 본다 — X = 0 이어도 맞음', () => {
    expect(matches({ scan: [100, 120] }, { scan: [120, 140] }, { scanGapMm: 0 })).toBe(true)
    expect(matches({ scan: [100, 120] }, { scan: [120.5, 140] }, { scanGapMm: 0 })).toBe(false)
  })

  it('간격 = X 는 맞고, X 를 넘으면 안 맞음', () => {
    expect(matches({ scan: [100, 120] }, { scan: [130, 140] })).toBe(true) // 간격 10
    expect(matches({ scan: [100, 120] }, { scan: [130.1, 140] })).toBe(false) // 간격 10.1
    expect(matches({ scan: [130, 140] }, { scan: [100, 120] })).toBe(true) // 순서를 바꿔도 같음
  })

  it('경계값이 부동소수 오차로 넘쳐도 맞음 (1.0 − 0.7 = 0.30000000000000004)', () => {
    expect(1.0 - 0.7).toBeGreaterThan(0.3)
    expect(matches({ scan: [0, 0.7] }, { scan: [1.0, 2] }, { scanGapMm: 0.3 })).toBe(true)
  })

  it('한 점(시작 = 끝) 지시도 맞춘다 — 위치만 있는 정답(X3 결함정보)', () => {
    expect(matches({ scan: [160, 160] }, { scan: [149, 170] })).toBe(true) // 안에 듦
    expect(matches({ scan: [160, 160] }, { scan: [170, 180] })).toBe(true) // 간격 10
    expect(matches({ scan: [160, 160] }, { scan: [171, 180] })).toBe(false)
  })

  it('시작·끝이 뒤집힌 기록은 정리해서 본다', () => {
    const r = matchIndications([rec({ scan: [120, 100] })], [rec({ scan: [110, 130] })], P())
    expect(r.pairs[0]?.a.scanStartMm).toBe(100)
    expect(r.pairs[0]?.scanOverlapMm).toBe(10)
  })

  it('intervalGap: 포함·떨어짐', () => {
    expect(intervalGap(0, 100, 40, 60)).toEqual({ overlapMm: 20, gapMm: 0 })
    expect(intervalGap(0, 10, 15, 20)).toEqual({ overlapMm: 0, gapMm: 5 })
  })
})

describe('매칭 조건 — 깊이·측·파일', () => {
  it('깊이 중심 차 = Y 는 맞고, 넘으면 안 맞음', () => {
    // A 중심 9, B 중심 14 / 14.2
    expect(matches({ scan: [100, 120], depth: [8, 10] }, { scan: [100, 120], depth: [13, 15] })).toBe(true)
    expect(matches({ scan: [100, 120], depth: [8, 10] }, { scan: [100, 120], depth: [13.2, 15.2] })).toBe(false)
  })

  it('깊이를 모르면 기본은 통과, unknownDepth = fail 이면 안 맞음', () => {
    expect(matches({ scan: [100, 120], depth: [8, 10] }, { scan: [100, 120] })).toBe(true)
    expect(matches({ scan: [100, 120], depth: [8, 10] }, { scan: [100, 120] }, { unknownDepth: 'fail' })).toBe(false)
    const r = matchIndications([rec({ scan: [100, 120], depth: [8, 10] })], [rec({ scan: [100, 120] })], P())
    expect(r.pairs[0]?.depthChecked).toBe(false)
    expect(r.pairs[0]?.depthCenterDiffMm).toBeNull()
  })

  it('깊이 한쪽 끝만 있으면 그 값을 중심으로 쓴다', () => {
    expect(matches({ scan: [100, 120], depth: [9, null] }, { scan: [100, 120], depth: [null, 14] })).toBe(true)
    expect(matches({ scan: [100, 120], depth: [9, null] }, { scan: [100, 120], depth: [null, 14.5] })).toBe(false)
  })

  it('측이 다르면 안 맞음 — 위치가 완전히 같아도', () => {
    expect(matches({ scan: [100, 120], side: 'L' }, { scan: [100, 120], side: 'R' })).toBe(false)
    expect(matches({ scan: [100, 120], side: 'L' }, { scan: [100, 120], side: 'L' })).toBe(true)
  })

  it('측을 하나라도 모르면 기본은 통과, unknownSide = fail 이면 안 맞음', () => {
    expect(matches({ scan: [100, 120], side: 'L' }, { scan: [100, 120], side: null })).toBe(true)
    expect(matches({ scan: [100, 120], side: 'L' }, { scan: [100, 120], side: null }, { unknownSide: 'fail' })).toBe(false)
  })

  it("'file' 틀에서는 sha256 이 다르면 안 맞음", () => {
    expect(matches({ scan: [100, 120], sha: SHA_1 }, { scan: [100, 120], sha: SHA_2 })).toBe(false)
  })

  it("'weld' 틀: 반대 끝에서 스캔한 파일도 시편 좌표로 맞춘다", () => {
    const alignments = [
      newFileAlignment({ sha256: SHA_1, fileName: '1.nde', specimenId: 'TP03', weldId: 'W1', datumUMm: 0, direction: 1 }),
      // 판 끝(기준점)이 U = 300 mm 에 있고 반대 방향으로 스캔
      newFileAlignment({ sha256: SHA_2, fileName: '2.nde', specimenId: 'TP03', weldId: 'W1', datumUMm: 300, direction: -1 })
    ]
    const r = matchIndications(
      [rec({ sha: SHA_1, scan: [100, 120] })],
      [rec({ sha: SHA_2, scan: [180, 200] })], // 시편 좌표 100~120
      P({ frame: 'weld', alignments })
    )
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0]?.b.scanStartMm).toBe(100)
    expect(r.pairs[0]?.b.scanEndMm).toBe(120)
    expect(r.pairs[0]?.a.frameKey).toBe('weld:TP03|W1')
  })

  it("'weld' 틀: 정렬이 없는 파일의 기록은 'no-alignment' 로 뺀다", () => {
    const alignments = [newFileAlignment({ sha256: SHA_1, fileName: '1.nde', specimenId: 'TP03', datumUMm: 0, direction: 1 })]
    const r = matchIndications([rec({ sha: SHA_1, scan: [0, 10] })], [rec({ sha: SHA_2, scan: [0, 10] })], P({ frame: 'weld', alignments }))
    expect(r.excludedB).toEqual([{ uuid: expect.any(String), reason: 'no-alignment' }])
    expect(r.onlyA).toHaveLength(1)
  })

  it('허용치가 음수·NaN 이면 한국어 오류', () => {
    expect(() => matchIndications([], [], P({ scanGapMm: -1 }))).toThrow(/X\(스캔 간격\)/)
    expect(() => matchIndications([], [], P({ depthDiffMm: Number.NaN }))).toThrow(/Y\(깊이 중심 차\)/)
  })
})

// ───────────────────────────── 1:1 짝짓기 ─────────────────────────────

describe('1:1 짝짓기 (탐욕, 비용 작은 쌍부터)', () => {
  it('정답 하나에 예측 둘이면 더 가까운 쪽과 짝짓고, 나머지는 짝을 잃은 오검출', () => {
    const truth = rec({ scan: [100, 120], depth: [8, 10] })
    const near = rec({ scan: [102, 122], depth: [8, 10] })
    const far = rec({ scan: [112, 132], depth: [8, 10] })
    const r = matchIndications([truth], [far, near], P()) // 입력 순서와 무관
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0]?.b.id).toBe(near.uuid)
    expect(r.onlyB).toEqual([{ item: expect.objectContaining({ id: far.uuid }), hadCandidate: true, zone: null, outsideCoverage: false }])
    const s = detectionSummary(r)
    expect(s.hits).toBe(1)
    expect(s.falsePositives).toBe(1)
  })

  it('스캔이 같으면 깊이가 가까운 쪽', () => {
    const truth = rec({ scan: [100, 120], depth: [8, 10] })
    const d1 = rec({ scan: [100, 120], depth: [11, 13] }) // 차 3
    const d2 = rec({ scan: [100, 120], depth: [9, 11] }) // 차 1
    expect(matchIndications([truth], [d1, d2], P()).pairs[0]?.b.id).toBe(d2.uuid)
  })

  it('비용: 0(같음) ~ 2(두 조건 모두 한계). 깊이를 모르면 깊이 항 = 1', () => {
    const p = P()
    const same = prepareMatchItems([rec({ scan: [100, 120], depth: [8, 10] })], p).items[0]!
    const edge = prepareMatchItems([rec({ scan: [130, 150], depth: [13, 15] })], p).items[0]!
    const noDepth = prepareMatchItems([rec({ scan: [100, 120] })], p).items[0]!
    expect(compareItems(same, same, p)?.cost).toBe(0)
    expect(compareItems(same, edge, p)?.cost).toBeCloseTo(2, 12) // 간격 10 = X, 깊이 차 5 = Y
    expect(compareItems(same, noDepth, p)?.cost).toBe(1)
  })

  it('교차 경쟁: 두 정답·두 예측이 서로 다 맞아도 가까운 짝끼리', () => {
    const a1 = rec({ scan: [100, 110] })
    const a2 = rec({ scan: [112, 122] })
    const b1 = rec({ scan: [113, 123] })
    const b2 = rec({ scan: [101, 111] })
    const r = matchIndications([a1, a2], [b1, b2], P())
    const byA = new Map(r.pairs.map((p) => [p.a.id, p.b.id]))
    expect(byA.get(a1.uuid)).toBe(b2.uuid)
    expect(byA.get(a2.uuid)).toBe(b1.uuid)
  })

  it('탐욕의 한계(문서화된 동작): 가장 싼 쌍이 다른 단위의 유일한 짝을 가져가면 그 단위는 짝을 잃음', () => {
    const a1 = rec({ scan: [100, 110] }) // b1 과 같음(비용 0), b2 와도 맞음
    const a2 = rec({ scan: [85, 90] }) // b1 하고만 맞음 (간격 10)
    const b1 = rec({ scan: [100, 110] })
    const b2 = rec({ scan: [118, 125] }) // a1 과 간격 8, a2 와 간격 28
    const r = matchIndications([a1, a2], [b1, b2], P())
    expect(r.pairs.map((p) => [p.a.id, p.b.id])).toEqual([[a1.uuid, b1.uuid]])
    expect(r.onlyA).toEqual([{ item: expect.objectContaining({ id: a2.uuid }), hadCandidate: true, zone: null, outsideCoverage: false }])
    expect(r.onlyB).toEqual([{ item: expect.objectContaining({ id: b2.uuid }), hadCandidate: true, zone: null, outsideCoverage: false }])
    expect(detectionSummary(r).missesLostCompetition).toBe(1)
  })

  it('같은 입력이면 같은 결과 (비용이 같으면 id 순서)', () => {
    const t = rec({ scan: [100, 120] })
    const x = rec({ scan: [95, 115] })
    const y = rec({ scan: [105, 125] }) // 중심 차가 x 와 같음
    const r1 = matchIndications([t], [x, y], P())
    const r2 = matchIndications([t], [y, x], P())
    expect(r1.pairs[0]?.b.id).toBe(r2.pairs[0]?.b.id)
    expect(r1.pairs[0]?.b.id).toBe(x.uuid < y.uuid ? x.uuid : y.uuid)
  })
})

// ───────────────────────────── 삭제 표시 · 불확실 · 기준 미만 ─────────────────────────────

describe('삭제 표시·불확실·기준 미만 처리', () => {
  it('삭제 표시 기록은 빼고 이유를 남긴다', () => {
    const del = rec({ scan: [100, 120], deleted: true })
    const r = matchIndications([rec({ scan: [100, 120] })], [del], P())
    expect(r.pairs).toHaveLength(0)
    expect(r.excludedB).toEqual([{ uuid: del.uuid, reason: 'deleted' }])
    expect(detectionSummary(r).misses).toBe(1)
    expect(matchIndications([rec({ scan: [100, 120] })], [del], P({ includeDeleted: true })).pairs).toHaveLength(1)
  })

  it('형상 에코는 기본으로 뺀다 (kinds = defect)', () => {
    const echo = { ...rec({ scan: [100, 120], type: null }), kind: 'geometric-echo' as const }
    const r = matchIndications([echo], [rec({ scan: [100, 120] })], P())
    expect(r.excludedA[0]?.reason).toBe('kind')
    expect(detectionSummary(r).falsePositives).toBe(1) // 형상 에코를 결함이라 하면 오검출
  })

  it("정답이 '불확실'(참고)이면 예측이 맞혀도 셈하지 않고, 오검출도 아님", () => {
    const r = matchIndications([rec({ scan: [100, 120], uncertain: true })], [rec({ scan: [100, 120] })], P())
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0]?.counted).toBe(false)
    const s = detectionSummary(r)
    expect([s.truthCounted, s.hits, s.falsePositives, s.predMatchedToReference]).toEqual([0, 0, 0, 1])
    expect([s.truthReference, s.truthReferenceDetected]).toEqual([1, 1])
    expect(s.recall.p).toBeNull()
  })

  it("'불확실' 규칙: exclude 면 빼서 예측이 오검출, count 면 참 검출", () => {
    const a = [rec({ scan: [100, 120], uncertain: true })]
    const b = [rec({ scan: [100, 120] })]
    const ex = matchIndications(a, b, P({ uncertain: 'exclude' }))
    expect(ex.excludedA[0]?.reason).toBe('uncertain')
    expect(detectionSummary(ex).falsePositives).toBe(1)
    expect(detectionSummary(matchIndications(a, b, P({ uncertain: 'count' }))).hits).toBe(1)
  })

  it('예측이 기록 기준 미만(참고)하고만 맞으면 미검출', () => {
    const r = matchIndications([rec({ scan: [100, 120] })], [rec({ scan: [100, 120], belowRecording: true })], P())
    const s = detectionSummary(r)
    expect([s.hits, s.misses, s.missesMatchedToReference, s.falsePositives]).toEqual([0, 1, 1, 0])
  })

  it('1차는 셈하는 단위끼리: 참고 예측이 더 가까워도 셈하는 예측이 짝을 가져간다', () => {
    const truth = rec({ scan: [100, 120] })
    const refPred = rec({ scan: [100, 120], uncertain: true })
    const pred = rec({ scan: [104, 124] })
    const r = matchIndications([truth], [refPred, pred], P())
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0]?.b.id).toBe(pred.uuid)
    expect(r.pairs[0]?.counted).toBe(true)
    expect(detectionSummary(r).falsePositives).toBe(0) // 남은 참고 예측은 오검출 아님
  })

  it('정답 쪽 기준 미만 지시 구간에 든 예측은 오검출에서 뺀다', () => {
    const zone = newReviewInterval({
      uuid: uuid(),
      sha256: SHA_1,
      labelerId: 'kim',
      guidelineVersion: 'v1',
      kind: 'below-threshold',
      scanStartMm: 200,
      scanEndMm: 220
    })
    const r = matchIndications([rec({ scan: [100, 120] })], [rec({ scan: [100, 120] }), rec({ scan: [205, 210] })], P(), { a: [zone] })
    expect(r.onlyB[0]?.zone).toBe('below-threshold')
    const s = detectionSummary(r)
    expect([s.hits, s.falsePositives, s.predInZone]).toEqual([1, 0, 1])
    // 참고 구역 종류에서 빼면 오검출
    expect(detectionSummary(matchIndications([], [rec({ scan: [205, 210] })], P({ zoneKinds: [] }), { a: [zone] })).falsePositives).toBe(1)
  })

  it('같은 UUID 가 둘이면 확인 사항을 남긴다', () => {
    const x = rec({ scan: [100, 120] })
    const r = matchIndications([x, { ...x, revision: 2 }], [], P())
    expect(r.warnings.some((w) => w.includes('같은 UUID'))).toBe(true)
  })
})

// ───────────────────────────── 그룹 짓기 후 단위 · 물리 결함 ─────────────────────────────

describe('그룹 짓기 후 단위', () => {
  it('같은 groupingId 는 한 단위: 길이 = l1 + l2 + dx', () => {
    const a = [rec({ scan: [100, 110], grouping: 'g1', side: 'L' }), rec({ scan: [115, 125], grouping: 'g1', side: 'L' })]
    const b = [rec({ scan: [100, 125] })]
    const grouped = matchIndications(a, b, P())
    expect(grouped.pairs).toHaveLength(1)
    expect(grouped.pairs[0]?.a.id).toBe('group:g1')
    expect(grouped.pairs[0]?.a.lengthMm).toBe(25)
    expect(grouped.pairs[0]?.a.side).toBe('L')
    expect(grouped.pairs[0]?.a.recordUuids).toHaveLength(2)
    expect(detectionSummary(grouped).misses).toBe(0)
    // 기록 단위로 비교하면 하나는 미검출
    expect(detectionSummary(matchIndications(a, b, P({ unit: 'record' }))).misses).toBe(1)
  })

  it('그룹 성질: 면상이 하나라도 있으면 면상, 셈하는 구성원이 있으면 셈함', () => {
    const items = prepareMatchItems(
      [
        rec({ scan: [0, 5], grouping: 'g', type: 'slag' }),
        rec({ scan: [8, 12], grouping: 'g', type: 'lof-sidewall', uncertain: true })
      ],
      P()
    ).items
    expect(items).toHaveLength(1)
    expect(items[0]?.character).toBe('planar')
    expect(items[0]?.defectType).toBeNull() // 종류가 섞이면 없음
    expect(items[0]?.counted).toBe(true)
  })

  it('물리 결함 설계값과 비교 (weld 틀): 시작·끝, 중심 ± 길이/2', () => {
    const defects = [
      newPhysicalDefect({ id: 'D1', specimenId: 'TP03', weldId: 'W1', source: 'manufacturer-report', design: { startMm: 148, endMm: 172, type: 'crack-root' } }),
      newPhysicalDefect({ id: 'D2', specimenId: 'TP03', weldId: 'W1', source: 'design-drawing', design: { centerMm: 220, lengthMm: 10, type: 'porosity-single' } }),
      newPhysicalDefect({ id: 'D3', specimenId: 'TP03', weldId: 'W1', deleted: true, design: { centerMm: 50 } })
    ]
    const truth = physicalDefectItems(defects)
    expect(truth.items.map((i) => [i.id, i.scanStartMm, i.scanEndMm])).toEqual([
      ['defect:TP03/D1', 148, 172],
      ['defect:TP03/D2', 215, 225]
    ])
    expect(truth.excluded).toEqual([{ uuid: 'TP03/D3', reason: 'deleted' }])
    const p = P({
      frame: 'weld',
      alignments: [newFileAlignment({ sha256: SHA_1, fileName: '04.nde', specimenId: 'TP03', weldId: 'W1', datumUMm: 0, direction: 1 })]
    })
    const ai = prepareMatchItems([rec({ scan: [149, 170], type: 'crack-root' })], p)
    const r = matchItems(truth.items, ai.items, p)
    const s = detectionSummary(r)
    expect([s.hits, s.misses, s.falsePositives]).toEqual([1, 1, 0])
    expect(r.pairs[0]?.a.character).toBe('planar')
  })

  it('물리 결함 깊이는 뜻을 알려 줄 때만 쓴다', () => {
    const d = [newPhysicalDefect({ id: 'D1', specimenId: 'S', design: { centerMm: 100, depthMm: 9, heightMm: 2 } })]
    expect(physicalDefectItems(d).items[0]?.depthCenterMm).toBeNull()
    expect(physicalDefectItems(d, { depthIs: 'top' }).items[0]?.depthCenterMm).toBe(10)
    expect(physicalDefectItems(d, { depthIs: 'center' }).items[0]?.depthTopMm).toBe(8)
  })

  it('좌표 틀이 다르면 확인 사항', () => {
    const truth = physicalDefectItems([newPhysicalDefect({ id: 'D1', specimenId: 'S', design: { centerMm: 100 } })]).items
    const pred = prepareMatchItems([rec({ scan: [95, 105] })], P()).items // file 틀
    expect(matchItems(truth, pred, P()).warnings[0]).toMatch(/좌표 틀이 다릅니다/)
  })
})

// ───────────────────────────── 지표 ─────────────────────────────

describe('POD 설계 — 90/95 에 필요한 결함 수', () => {
  it('미검출 0/1/2 개 → 29/46/61 개', () => {
    expect([0, 1, 2].map(requiredDefectsFor9095)).toEqual([29, 46, 61])
    expect(requiredDefectsForPod(0, 0.9, 0.95)).toBe(29)
  })

  it('경계 확인: 0.9^29 ≤ 0.05 < 0.9^28', () => {
    expect(binomialCdf(0, 29, 0.1)).toBeCloseTo(Math.pow(0.9, 29), 14)
    expect(Math.pow(0.9, 29)).toBeLessThanOrEqual(0.05)
    expect(Math.pow(0.9, 28)).toBeGreaterThan(0.05)
    expect(binomialCdf(1, 46, 0.1)).toBeLessThanOrEqual(0.05)
    expect(binomialCdf(1, 45, 0.1)).toBeGreaterThan(0.05)
  })

  it('한쪽 Clopper–Pearson 하한과 맞물림', () => {
    expect(podLowerBound(29, 29)).toBeCloseTo(Math.pow(0.05, 1 / 29), 12) // ≈ 0.9019
    expect(podLowerBound(29, 29)!).toBeGreaterThanOrEqual(0.9)
    expect(podLowerBound(28, 28)!).toBeLessThan(0.9)
    expect(podLowerBound(45, 46)!).toBeGreaterThanOrEqual(0.9)
    expect(podLowerBound(44, 45)!).toBeLessThan(0.9)
    expect(podLowerBound(59, 61)!).toBeGreaterThanOrEqual(0.9)
    expect(podLowerBound(0, 10)).toBe(0)
    expect(podLowerBound(0, 0)).toBeNull()
  })

  it('binomialCdf 끝값', () => {
    expect(binomialCdf(-1, 10, 0.3)).toBe(0)
    expect(binomialCdf(10, 10, 0.3)).toBe(1)
    expect(binomialCdf(0, 10, 0)).toBe(1)
    expect(binomialCdf(3, 10, 1)).toBe(0)
    expect(binomialCdf(2, 5, 0.5)).toBeCloseTo(0.5, 14) // (1 + 5 + 10) / 32
  })
})

describe('Wilson 구간 — 알려진 값 (Newcombe 1998 표)', () => {
  const r4 = (v: number | null): number | null => (v === null ? null : Math.round(v * 1e4) / 1e4)
  it.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [1, 29, 0.0061, 0.1718]
  ])('%i/%i → %f ~ %f', (x, n, lo, hi) => {
    const ci = wilsonInterval(x, n)
    expect([r4(ci.lower), r4(ci.upper)]).toEqual([lo, hi])
  })

  it('11건 중 8건 → 약 43~90 % (검토 원자료 1 의 예)', () => {
    const ci = wilsonInterval(8, 11)
    expect(r4(ci.lower)).toBe(0.4344)
    expect(r4(ci.upper)).toBe(0.9025)
  })

  it('n = 0 은 null, 잘못된 입력은 오류', () => {
    expect(wilsonInterval(0, 0)).toEqual({ x: 0, n: 0, p: null, lower: null, upper: null })
    expect(() => wilsonInterval(3, 2)).toThrow(RangeError)
    expect(wilsonInterval(10, 10).upper).toBe(1)
  })
})

describe('Cohen kappa — 알려진 값', () => {
  it('2 × 2 [[20, 5], [10, 15]] → po 0.7, pe 0.5, κ 0.4', () => {
    const k = cohenKappa([
      [20, 5],
      [10, 15]
    ])
    expect(k.po).toBeCloseTo(0.7, 12)
    expect(k.pe).toBeCloseTo(0.5, 12)
    expect(k.kappa).toBeCloseTo(0.4, 12)
  })

  it('3 × 3 손계산: po 0.79, pe 0.343 → κ = 0.447 / 0.657', () => {
    const k = cohenKappa([
      [25, 2, 3],
      [4, 20, 6],
      [1, 5, 34]
    ])
    expect(k.po).toBeCloseTo(0.79, 12)
    expect(k.pe).toBeCloseTo(0.343, 12)
    expect(k.kappa).toBeCloseTo(0.447 / 0.657, 12)
  })

  it('완전 일치 = 1, 한 범주만 쓰면 정의되지 않음(null), 빈 표 null', () => {
    expect(cohenKappa([[5, 0], [0, 5]]).kappa).toBe(1)
    expect(cohenKappa([[10, 0], [0, 0]]).kappa).toBeNull()
    expect(cohenKappa([[0, 0], [0, 0]]).kappa).toBeNull()
  })

  it('범주 목록에서', () => {
    const a = ['y', 'y', 'n', 'n', 'y'] as const
    const b = ['y', 'n', 'n', 'n', 'y'] as const
    // [[2,1],[0,2]]: po 0.8, pe 0.6·0.4 + 0.4·0.6 = 0.48 → κ = 0.32/0.52
    expect(cohenKappaFromLabels([...a], [...b], ['y', 'n']).kappa).toBeCloseTo(0.32 / 0.52, 12)
  })
})

describe('오차 통계 · 분위수', () => {
  it('quantile type 7 (numpy 기본과 같음)', () => {
    expect(quantile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85, 12)
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5)
    expect(quantile([7], 0.95)).toBe(7)
    expect(quantile([], 0.95)).toBeNull()
  })

  it('MAE·치우침·RMSE·p95', () => {
    const e = errorStats([1, -1, 2, -2])
    expect(e).toEqual({ n: 4, mae: 1.5, bias: 0, rmse: Math.sqrt(2.5), p95Abs: 2, maxAbs: 2 })
    expect(errorStats([]).mae).toBeNull()
  })

  it('짝의 b − a: 스캔 중심·깊이 중심·길이·높이', () => {
    const a = [rec({ scan: [100, 120], depth: [8, 10], length: 20, height: 2 }), rec({ scan: [200, 210], length: 10 })]
    const b = [rec({ scan: [104, 128], depth: [9, 11], length: 24, height: 3 }), rec({ scan: [198, 206], length: 8 })]
    const r = matchIndications(a, b, P())
    expect(pairDiffs(r.pairs, 'scanCenter').sort((x, y) => x - y)).toEqual([-3, 6])
    expect(pairDiffs(r.pairs, 'depthCenter')).toEqual([1]) // 둘째 쌍은 깊이 없음
    const rep = errorReport(r)
    expect(rep.length.mae).toBe(3) // |4|, |−2|
    expect(rep.length.bias).toBe(1)
    expect(rep.height.n).toBe(1)
  })

  it('길이 칸이 비면 스캔 범위 길이, 한 점이면 null', () => {
    const items = prepareMatchItems([rec({ scan: [100, 130] }), rec({ scan: [160, 160] })], P()).items
    expect(items.map((i) => i.lengthMm)).toEqual([30, null])
  })
})

describe('검출 요약 · 오검출 비율 · 혼동표', () => {
  it('재현율(Wilson)·정밀도·F1·용접부당·m당 오검출', () => {
    const a = [rec({ scan: [10, 20] }), rec({ scan: [100, 120] }), rec({ scan: [200, 220] })]
    const b = [rec({ scan: [12, 22] }), rec({ scan: [101, 119] }), rec({ scan: [400, 410] })]
    const s = detectionSummary(matchIndications(a, b, P()))
    expect([s.truthCounted, s.hits, s.misses, s.predCounted, s.falsePositives]).toEqual([3, 2, 1, 3, 1])
    expect(s.recall.p).toBeCloseTo(2 / 3, 12)
    expect(s.recall.lower).toBeCloseTo(wilsonInterval(2, 3).lower!, 12)
    expect(s.precision.p).toBeCloseTo(2 / 3, 12)
    expect(s.f1).toBeCloseTo(2 / 3, 12)
    const fp = falsePositiveRate(s, { welds: 4, inspectedLengthMm: 1200 })
    expect(fp.perWeld).toBe(0.25)
    expect(fp.perMeter).toBeCloseTo(1 / 1.2, 12)
    expect(falsePositiveRate(s, { welds: 0, inspectedLengthMm: 0 }).perWeld).toBeNull()
  })

  it('1단(면상/체적)·제안서 5종 혼동표', () => {
    const a = [
      rec({ scan: [10, 20], type: 'lof-sidewall' }),
      rec({ scan: [100, 110], type: 'slag' }),
      rec({ scan: [200, 210], type: 'porosity-single' }),
      rec({ scan: [300, 310], type: 'planar-presumed' })
    ]
    const b = [
      rec({ scan: [10, 20], type: 'crack-sidewall' }), // 면상 → 면상, 융합불량 → 균열
      rec({ scan: [100, 110], type: 'lof-interrun' }), // 체적 → 면상
      rec({ scan: [200, 210], type: 'porosity-cluster' }), // 체적 → 체적
      rec({ scan: [300, 310], type: 'slag' })
    ]
    const r = matchIndications(a, b, P())
    const c1 = characterConfusion(r)
    expect(c1.classes).toEqual(['planar', 'volumetric'])
    expect(c1.matrix).toEqual([
      [1, 1],
      [1, 1]
    ])
    expect(c1.agreement).toBe(0.5)
    const c2 = proposalClassConfusion(r)
    expect(c2.unknownA).toBe(1) // '면상 추정'은 5종 대응 없음
    expect(c2.total).toBe(3)
    const i = (k: string): number => c2.classes.indexOf(k as never)
    expect(c2.matrix[i('lof')]?.[i('crack')]).toBe(1)
    expect(c2.matrix[i('porosity')]?.[i('porosity')]).toBe(1)
  })

  it('종류만 불확실한 쌍은 검출에는 셈하고 혼동표에서는 뺀다', () => {
    const a = [rec({ scan: [10, 20], type: 'slag', typeUncertain: true }), rec({ scan: [100, 110], type: 'slag' })]
    const b = [rec({ scan: [10, 20], type: 'lof-sidewall' }), rec({ scan: [100, 110], type: 'slag' })]
    const r = matchIndications(a, b, P())
    expect(detectionSummary(r).hits).toBe(2)
    const c = characterConfusion(r)
    expect([c.total, c.typeUncertain, c.agreement]).toEqual([1, 1, 1])
    const all = confusionMatrix(r.pairs, (i) => i.character, ['planar', 'volumetric'] as const, { includeTypeUncertain: true })
    expect([all.total, all.agreement]).toEqual([2, 0.5])
  })

  it("'불확실' 몫과 상한 10 %", () => {
    const a = [rec({ scan: [0, 5], uncertain: true }), ...Array.from({ length: 4 }, (_, k) => rec({ scan: [100 * (k + 1), 100 * (k + 1) + 5] }))]
    const u = uncertainTruthShare(matchIndications(a, [], P()))
    expect(u).toEqual({ uncertain: 1, total: 5, share: 0.2, exceedsCap: true })
  })
})

describe('구간 단위(grading unit) 일치도', () => {
  const S = (startMm: number, endMm: number, frameKey = `file:${SHA_1}`) => ({ frameKey, startMm, endMm })

  it('단위 나누기: 남는 조각이 절반보다 짧으면 앞 단위에 붙임', () => {
    expect(makeGradingUnits([S(0, 100)], 20)).toHaveLength(5)
    const u105 = makeGradingUnits([S(0, 105)], 20)
    expect(u105).toHaveLength(5)
    expect(u105[4]).toEqual(S(80, 105))
    const u115 = makeGradingUnits([S(0, 115)], 20)
    expect(u115).toHaveLength(6)
    expect(u115[5]).toEqual(S(100, 115))
    expect(makeGradingUnits([S(0, 5)], 20)).toEqual([S(0, 5)])
  })

  it('검토 범위 합치기·교집합', () => {
    expect(mergeSpans([S(50, 80), S(0, 30), S(30, 40)])).toEqual([S(0, 40), S(50, 80)])
    expect(intersectCoverage([S(0, 100)], [S(50, 150), S(0, 10)])).toEqual([S(0, 10), S(50, 100)])
  })

  it('검토 완료 구간 → 단위 → 2 × 2 표와 kappa', () => {
    const iv = (kind: 'reviewed' | 'quality-bad', s: number, e: number) =>
      newReviewInterval({ uuid: uuid(), sha256: SHA_1, labelerId: 'kim', guidelineVersion: 'v1', kind, scanStartMm: s, scanEndMm: e })
    const { spans } = reviewSpans([iv('reviewed', 0, 200), iv('quality-bad', 180, 190)], P())
    const units = makeGradingUnits(reviewedCoverage(spans), 20) // 10 단위
    expect(units).toHaveLength(10)
    const p = P()
    const A = prepareMatchItems([rec({ scan: [5, 15] }), rec({ scan: [45, 50] }), rec({ scan: [125, 130], uncertain: true })], p).items
    const B = prepareMatchItems([rec({ scan: [8, 12] }), rec({ scan: [85, 90] })], p).items
    expect(unitLabel(units[0]!, A)).toBe('defect')
    expect(unitLabel(units[6]!, A)).toBe('reference')
    const qualityBad = spans.filter((s) => s.kind === 'quality-bad')
    const g = gradingUnitAgreement(units, A, B, qualityBad)
    // 단위: 0 둘 다 결함, 2 A 만, 4 B 만, 6 참고(뺌), 9 품질 불량(뺌), 나머지 5개 둘 다 없음
    expect(g.excludedReference).toBe(1)
    expect(g.excludedQuality).toBe(1)
    expect(g.table).toEqual([
      [1, 1],
      [1, 5]
    ])
    expect(g.used).toBe(8)
    // po = 6/8, pe = (2/8)(2/8) + (6/8)(6/8) = 0.625 → κ = 0.125/0.375
    expect(g.kappa.kappa).toBeCloseTo(1 / 3, 12)
    expect(g.negativesPerPositiveA).toBe(3)
  })

  it('경계에서 끝나는 지시는 다음 단위에 걸치지 않음', () => {
    const it0 = prepareMatchItems([rec({ scan: [0, 20] })], P()).items
    expect(unitLabel(S(20, 40), it0)).toBe('none')
    const pt = prepareMatchItems([rec({ scan: [20, 20] })], P()).items
    expect(unitLabel(S(20, 40), pt)).toBe('defect')
    expect(unitLabel(S(0, 20), pt)).toBe('none')
  })
})

describe('규칙 버전 · 잠정값', () => {
  it('규칙 v1, 잠정 X = 10 mm, Y = 5 mm, 결과에 인자를 남긴다', () => {
    expect(MATCH_RULES_VERSION).toBe(1)
    expect([PROVISIONAL_SCAN_GAP_MM, PROVISIONAL_DEPTH_DIFF_MM]).toEqual([10, 5])
    const m = matchParams()
    expect([m.scanGapMm, m.depthDiffMm, m.unit, m.uncertain, m.belowRecording]).toEqual([10, 5, 'grouping', 'reference', 'reference'])
    const r = matchIndications([], [], m)
    expect(r.rulesVersion).toBe(1)
    expect(r.params.scanGapMm).toBe(10)
  })
})

// ───────────────────────────── 검토 반영 (2026-10-06) ─────────────────────────────

const reviewed = (sha: string, s: number, e: number, labelerId = 'kim', released = false) =>
  newReviewInterval({ uuid: uuid(), sha256: sha, labelerId, guidelineVersion: 'v1', kind: 'reviewed', scanStartMm: s, scanEndMm: e, released })

describe('검토 범위 — 범위 밖 짝 없는 단위는 오검출·미검출에서 뺀다', () => {
  it("'truth': 정답 쪽이 검토하지 않은 구간의 예측은 오검출이 아니다", () => {
    const r = matchIndications([rec({ scan: [0, 10] })], [rec({ scan: [0, 10] }), rec({ scan: [500, 510] })], P(), {
      a: [reviewed(SHA_1, 0, 100)]
    })
    expect(r.onlyB[0]?.outsideCoverage).toBe(true)
    const s = detectionSummary(r)
    expect([s.hits, s.falsePositives, s.predOutsideCoverage]).toEqual([1, 0, 1])
    expect(r.warnings.some((w) => w.includes('검토 범위'))).toBe(false)
  })

  it('범위 밖의 짝 없는 정답도 미검출에서 빼고 따로 센다', () => {
    const r = matchIndications([rec({ scan: [0, 10] }), rec({ scan: [400, 410] })], [rec({ scan: [0, 10] })], P(), {
      a: [reviewed(SHA_1, 0, 100)]
    })
    const s = detectionSummary(r)
    expect([s.truthCounted, s.hits, s.misses, s.missesOutsideCoverage]).toEqual([1, 1, 0, 1])
  })

  it("'both': 2인 비교는 두 쪽 검토 완료의 교집합 안에서만 센다", () => {
    const a = [rec({ scan: [10, 20] }), rec({ scan: [150, 160] })]
    const b = [rec({ scan: [10, 20] }), rec({ scan: [250, 260] })]
    const r = matchIndications(a, b, P({ coverage: 'both' }), { a: [reviewed(SHA_1, 0, 200)], b: [reviewed(SHA_1, 0, 120, 'lee')] })
    const s = detectionSummary(r)
    // A 의 150~160 은 B 가 보지 않은 곳, B 의 250~260 은 A 가 보지 않은 곳
    expect([s.hits, s.misses, s.falsePositives, s.missesOutsideCoverage, s.predOutsideCoverage]).toEqual([1, 0, 0, 1, 1])
  })

  it('검토 범위를 주지 않으면 확인 사항, coverage = none 이면 없음', () => {
    const r = matchIndications([rec({ scan: [0, 10] })], [rec({ scan: [500, 510] })], P())
    expect(r.warnings.some((w) => w.includes('검토 범위(검토 완료 구간)를 주지 않아'))).toBe(true)
    expect(detectionSummary(r).falsePositives).toBe(1)
    expect(matchIndications([], [], P({ coverage: 'none' })).warnings).toEqual([])
  })

  it('자동으로 풀린 검토 완료 구간은 범위에서 뺀다', () => {
    const { spans, excluded } = reviewSpans([reviewed(SHA_1, 0, 100, 'kim', true)], P())
    expect(spans).toEqual([])
    expect(excluded[0]?.reason).toBe('released')
    expect(reviewedCoverage(spans)).toEqual([])
  })
})

describe('용접부 틀 키 — 서로 다르게 적힌 ID', () => {
  const fa = (specimenId: string, weldId: string | null) =>
    newFileAlignment({ sha256: SHA_1, fileName: '1.nde', specimenId, weldId, datumUMm: 0, direction: 1 })

  it('한쪽만 용접부 ID 가 비고 상대에 그 시편 용접부가 하나뿐이면 그 용접부로 맞추고 알린다', () => {
    const p = P({ frame: 'weld', alignments: [fa('PL23833', 'W1')] })
    const truth = physicalDefectItems([newPhysicalDefect({ id: 'D4', specimenId: 'PL23833', design: { centerMm: 240 } })], { minTier: 'any' })
    const pred = prepareMatchItems([rec({ scan: [230, 250] })], p)
    const r = matchItems(truth.items, pred.items, p, { coverage: [] })
    expect(r.pairs).toHaveLength(1)
    expect(r.warnings.some((w) => w.includes('하나뿐인 용접부로 보고 맞췄습니다'))).toBe(true)
  })

  it('시편 ID 의 대소문자·앞뒤 공백은 맞춘다', () => {
    const p = P({ frame: 'weld', alignments: [fa(' pl23833 ', 'w1')] })
    const truth = physicalDefectItems([newPhysicalDefect({ id: 'D1', specimenId: 'PL23833', weldId: 'W1', design: { centerMm: 100 } })], { minTier: 'any' })
    const pred = prepareMatchItems([rec({ scan: [95, 105] })], p)
    expect(pred.items[0]?.frameKey).toBe('weld:PL23833|W1')
    expect(matchItems(truth.items, pred.items, p, { coverage: [] }).pairs).toHaveLength(1)
  })

  it('공통 키가 하나도 없으면 결과를 쓰지 말라는 확인 사항, 한쪽에만 있는 용접부도 알린다', () => {
    const p = P({ frame: 'weld', alignments: [fa('PL23833', 'W1')] })
    const truth = physicalDefectItems([newPhysicalDefect({ id: 'D1', specimenId: 'PL99999', weldId: 'W1', design: { centerMm: 100 } })], { minTier: 'any' })
    const pred = prepareMatchItems([rec({ scan: [95, 105] })], p)
    const r = matchItems(truth.items, pred.items, p, { coverage: [] })
    expect(r.pairs).toHaveLength(0)
    expect(r.warnings.some((w) => w.includes('같은 좌표 틀 키'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('정답(A) 쪽에만 있는 용접부: PL99999|W1'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('예측(B) 쪽에만 있는 용접부: PL23833|W1'))).toBe(true)
  })

  it('가설 정렬·관(외경) 정렬로 낸 좌표에는 확인 사항', () => {
    const p = P({
      frame: 'weld',
      alignments: [newFileAlignment({ sha256: SHA_1, fileName: '1.nde', specimenId: 'P', datumUMm: 0, direction: 1, alignmentAssumed: true, outerDiameterMm: 559 })]
    })
    const items = prepareMatchItems([rec({ scan: [5, 10] })], p)
    expect(items.items[0]?.alignmentAssumed).toBe(true)
    expect(items.warnings.some((w) => w.includes('가설 정렬'))).toBe(true)
    expect(items.warnings.some((w) => w.includes('원주를 한 바퀴로 감는 처리가 아직 없어'))).toBe(true)
  })
})

describe('깊이 중심 — 위·아래가 없으면 최대 진폭 깊이', () => {
  it('최대 진폭 깊이로 깊이 조건을 본다 (depthSource = peak)', () => {
    const items = prepareMatchItems([rec({ scan: [100, 120], peakDepth: 9 })], P())
    expect(items.items[0]?.depthCenterMm).toBe(9)
    expect(items.items[0]?.depthSource).toBe('peak')
    expect(items.warnings.some((w) => w.includes('최대 진폭 깊이'))).toBe(true)
    expect(matches({ scan: [100, 120], peakDepth: 9 }, { scan: [100, 120], depth: [13, 15] })).toBe(true) // 차 5
    expect(matches({ scan: [100, 120], peakDepth: 3 }, { scan: [100, 120], depth: [13, 15] })).toBe(false) // 차 11
    const r = matchIndications([rec({ scan: [100, 120], peakDepth: 9 })], [rec({ scan: [100, 120], depth: [8, 10] })], P())
    expect(r.pairs[0]?.depthChecked).toBe(true)
  })

  it('위·아래가 있으면 그것이 먼저', () => {
    const items = prepareMatchItems([rec({ scan: [100, 120], depth: [2, 4], peakDepth: 9 })], P())
    expect([items.items[0]?.depthCenterMm, items.items[0]?.depthSource]).toEqual([3, 'range'])
  })
})

describe('그룹 짓기 단위의 높이·길이 — 잰 값만', () => {
  it('높이 = 구성원 잰 높이의 최댓값(측정 불가는 빼고), 길이 = Σ 잰 길이 + 간격', () => {
    const items = prepareMatchItems(
      [
        rec({ scan: [100, 104], depth: [2, 4], height: 1, length: 4, grouping: 'g' }),
        rec({ scan: [110, 120], depth: [6, 9], height: 2.5, heightMethod: 'unmeasurable', length: 3, grouping: 'g' })
      ],
      P()
    ).items
    expect(items).toHaveLength(1)
    expect(items[0]?.heightMm).toBe(1) // 화면 깊이 범위(7 mm)가 아니다
    expect(items[0]?.lengthMm).toBe(4 + 6 + 3) // 합집합 20 mm 가 아니다
  })

  it('잰 높이가 하나도 없으면 null, 구성원 스캔 범위가 겹치면 합집합 길이', () => {
    const items = prepareMatchItems(
      [rec({ scan: [100, 110], grouping: 'h' }), rec({ scan: [105, 118], grouping: 'h' })],
      P()
    ).items
    expect(items[0]?.heightMm).toBeNull()
    expect(items[0]?.lengthMm).toBe(18)
  })
})

describe('물리 결함 표 — 정답 계층과 위치', () => {
  it('기본은 계층 1(인증·설계값)만 셈한다. 출처 없음·PCN 시트는 참고', () => {
    const defects = [
      newPhysicalDefect({ id: 'D1', specimenId: 'S', source: 'manufacturer-report', design: { centerMm: 100 } }),
      newPhysicalDefect({ id: 'D2', specimenId: 'S', source: 'pcn-sheet', design: { centerMm: 200 } }),
      newPhysicalDefect({ id: 'D3', specimenId: 'S', source: 'none', design: { centerMm: 300 } })
    ]
    const p = physicalDefectItems(defects)
    expect(p.items.map((i) => [i.counted, i.truthTier, i.referenceReasons])).toEqual([
      [true, 'certified', []],
      [false, 'single', ['low-tier']],
      [false, null, ['low-tier']]
    ])
    expect(p.warnings[0]).toMatch(/참고 단위/)
    expect(physicalDefectItems(defects, { minTier: 'single' }).items.map((i) => i.counted)).toEqual([true, true, false])
    expect(physicalDefectItems(defects, { minTier: 'any' }).items.every((i) => i.counted)).toBe(true)
  })

  it('시작 + 길이(또는 끝 + 길이)로도 범위를 낸다', () => {
    const p = physicalDefectItems(
      [
        newPhysicalDefect({ id: 'A', specimenId: 'S', design: { startMm: 10, lengthMm: 20 } }),
        newPhysicalDefect({ id: 'B', specimenId: 'S', design: { endMm: 50, lengthMm: 5 } })
      ],
      { minTier: 'any' }
    )
    expect(p.items.map((i) => [i.scanStartMm, i.scanEndMm])).toEqual([
      [10, 30],
      [45, 50]
    ])
    expect(p.excluded).toEqual([])
  })
})

describe('물리 결함 단위 재현율 — 여러 파일에 나와도 한 번', () => {
  it('같은 물리 결함 키는 한 번 세고, 한 결과에서라도 맞으면 검출', () => {
    const al = [
      newFileAlignment({ sha256: SHA_1, fileName: '1.nde', specimenId: 'TP03' }),
      newFileAlignment({ sha256: SHA_2, fileName: '2.nde', specimenId: 'tp03' })
    ]
    const p = P({ alignments: al, coverage: 'none' })
    // 파일 1: D1 맞음, D2 놓침. 파일 2: D1 놓침, D2 놓침
    const r1 = matchIndications(
      [rec({ sha: SHA_1, scan: [100, 120], physicalDefectId: 'D1' }), rec({ sha: SHA_1, scan: [200, 220], physicalDefectId: 'D2' })],
      [rec({ sha: SHA_1, scan: [100, 120] })],
      p
    )
    const r2 = matchIndications(
      [rec({ sha: SHA_2, scan: [180, 200], physicalDefectId: 'D1' }), rec({ sha: SHA_2, scan: [80, 100], physicalDefectId: 'D2' }), rec({ sha: SHA_2, scan: [10, 20] })],
      [],
      p
    )
    const d = physicalDefectRecall([r1, r2])
    expect([d.defects, d.hits, d.unkeyedTruthUnits]).toEqual([2, 1, 1])
    expect(d.recall.p).toBe(0.5)
    // 지시 단위로는 5개 중 1개
    expect(detectionSummary(r1).truthCounted + detectionSummary(r2).truthCounted).toBe(5)
  })
})

describe("'불확실' 몫 — 뺀 규칙에서도 센다", () => {
  it("uncertain = 'exclude' 여도 excludedA 로 몫을 낸다", () => {
    const a = [rec({ scan: [0, 5], uncertain: true }), rec({ scan: [100, 105] }), rec({ scan: [200, 205] })]
    const r = matchIndications(a, [], P({ uncertain: 'exclude' }))
    expect(uncertainTruthShare(r)).toEqual({ uncertain: 1, total: 3, share: 1 / 3, exceedsCap: true })
  })
})
