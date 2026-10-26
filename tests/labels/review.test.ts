/**
 * 3단계 검수 계산 — 두 라벨 세트 비교(compareLabelSets), CSV, 결정적 UUID.
 * 손으로 만든 두 세트(일치·한쪽만·종류 다름·경계값)로 행·요약 수치를 손계산과 견준다.
 */
import { describe, expect, it } from 'vitest'
import { LABEL_XLSX_UUID_NAMESPACE, stableUuid, uuidKey } from '@core/labels/xlsx'
import { newIndicationRecord, newReviewInterval } from '@shared/labels/factory'
import type { HeightMethod, IndicationRecord, MetallurgicalType, ReviewInterval, WeldSide } from '@shared/labels/types'
import {
  COMPARISON_CSV_HEADER,
  REVIEW_RULES_VERSION,
  compareLabelSets,
  comparisonRowsCsv,
  csvCell,
  formatNumber,
  reviewRowById,
  reviewUuidKey,
  sha1,
  toCsv,
  utf8Bytes,
  uuidV5,
  type CompareResult,
  type ReviewRow
} from '@shared/labels/review'

// ───────────────────────────── 시료 ─────────────────────────────

const S1 = 'a1'.repeat(32)
const S2 = 'b2'.repeat(32)
let seq = 0
const uuid = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`

interface RecOpts {
  sha?: string
  scan: [number, number]
  depth?: [number, number] | null
  type?: MetallurgicalType | null
  side?: WeldSide | null
  length?: number | null
  height?: number | null
  heightMethod?: HeightMethod | null
  uncertain?: boolean
  typeUncertain?: boolean
  labeler: string
  ref?: string
}

function rec(o: RecOpts): IndicationRecord {
  return newIndicationRecord({
    uuid: uuid(),
    sha256: o.sha ?? S1,
    labelerId: o.labeler,
    guidelineVersion: 'v1',
    externalRef: o.ref ?? null,
    existenceConfidence: o.uncertain ? 'uncertain' : 'certain',
    defectType: o.type === undefined ? 'lof-sidewall' : o.type,
    typeConfidence: o.typeUncertain ? 'uncertain' : null,
    derived: {
      scanStartMm: o.scan[0],
      scanEndMm: o.scan[1],
      depthTopMm: o.depth?.[0] ?? null,
      depthBottomMm: o.depth?.[1] ?? null
    },
    location: { side: o.side ?? null },
    length: { valueMm: o.length ?? null, method: o.length != null ? 'eval-level' : null },
    height: { valueMm: o.height ?? null, method: o.heightMethod ?? (o.height != null ? 'tip-tip' : null) }
  })
}

function reviewed(labeler: string, s: number, e: number, sha = S1, extra: Partial<ReviewInterval> = {}): ReviewInterval {
  return newReviewInterval({
    uuid: uuid(),
    sha256: sha,
    labelerId: labeler,
    guidelineVersion: 'v1',
    kind: 'reviewed',
    scanStartMm: s,
    scanEndMm: e,
    gate: { depthTopMm: 7, depthBottomMm: 28, legMin: 1, legMax: 3 },
    ...extra
  })
}

/** 손계산 시료: 짝 4, A 만 1, B 만 2(오검출) + 참고 1 */
function handSets() {
  const a1 = rec({ labeler: 'kim', ref: '1', scan: [10, 20], depth: [2, 4], type: 'crack-toe', side: 'L', length: 10, height: 2 })
  const a2 = rec({ labeler: 'kim', ref: '2', scan: [50, 60], depth: [5, 7], type: 'lof-sidewall', side: 'R', length: 10, height: 1.5, heightMethod: '6db' })
  const a3 = rec({ labeler: 'kim', ref: '3', scan: [100, 110], depth: [3, 5], type: 'slag', length: 10 })
  const a4 = rec({ labeler: 'kim', ref: '4', scan: [150, 160], depth: [8, 10], type: 'crack-root' })
  const a5 = rec({ labeler: 'kim', ref: '5', scan: [200, 210], depth: [4, 6], type: 'porosity-single', typeUncertain: true })
  const b1 = rec({ labeler: 'lee', ref: '1', scan: [10, 20], depth: [2, 4], type: 'crack-toe', side: 'L', length: 10, height: 2.5 })
  // a2 와 간격이 정확히 X(10 mm) — 경계값은 짝
  const b2 = rec({ labeler: 'lee', ref: '2', scan: [70, 80], depth: [5, 7], type: 'lof-root', side: 'R', length: 10, height: 2 })
  // a3 와 깊이 중심 차가 정확히 Y(5 mm) — 경계값은 짝, 2단 종류만 다름(슬래그 / 기공, 둘 다 체적)
  const b3 = rec({ labeler: 'lee', ref: '3', scan: [100, 110], depth: [9, 9], type: 'porosity-single' })
  // a4 와 간격 10.02 mm — X 를 넘어 짝이 안 됨
  const b8 = rec({ labeler: 'lee', ref: '8', scan: [170.02, 175], depth: [8, 10], type: 'crack-root' })
  const b5 = rec({ labeler: 'lee', ref: '5', scan: [200, 210], depth: [4, 6], type: 'crack-center' })
  const b6 = rec({ labeler: 'lee', ref: '6', scan: [250, 260], depth: [1, 2], type: 'lof-sidewall' })
  const b7 = rec({ labeler: 'lee', ref: '7', scan: [270, 280], depth: [1, 2], uncertain: true })
  const A = [a1, a2, a3, a4, a5]
  const B = [b1, b2, b3, b8, b5, b6, b7]
  return { A, B, a: { a1, a2, a3, a4, a5 }, b: { b1, b2, b3, b5, b6, b7, b8 } }
}

function handCompare(): { r: CompareResult; s: ReturnType<typeof handSets> } {
  const s = handSets()
  const r = compareLabelSets(
    { records: s.A, intervals: [reviewed('kim', 0, 300)] },
    { records: s.B, intervals: [reviewed('lee', 0, 300)] },
    { unit: 'record' }
  )
  return { r, s }
}

const row = (r: CompareResult, id: string): ReviewRow => {
  const x = reviewRowById(r, id)
  if (!x) throw new Error(`행 없음 ${id}`)
  return x
}

// ───────────────────────────── 결정적 UUID ─────────────────────────────

describe('SHA-1 · UUID v5 (순수 구현)', () => {
  const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

  it('SHA-1 표준 시험값 (FIPS 180 예제)', () => {
    expect(hex(sha1(utf8Bytes('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(hex(sha1(utf8Bytes('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(hex(sha1(utf8Bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
    // 64 바이트 경계 (채움이 블록 하나를 더 만듦)
    expect(hex(sha1(utf8Bytes('a'.repeat(64))))).toBe('0098ba824b5c16427bd7a1122a5a442a25ec644d')
  })

  it('UUID v5 표준 예 (DNS 이름공간, python.org)', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })

  it('core 의 stableUuid(node:crypto)와 같은 값 — 한글·대리 쌍 포함', () => {
    for (const parts of [['a', 'b'], ['kim-l2', 'v1', 'blind', '지시 1'], ['파일명.nde', 3, null], ['😀', 'é', 'é']] as const) {
      expect(reviewUuidKey(parts)).toBe(uuidKey(parts))
      expect(uuidV5(LABEL_XLSX_UUID_NAMESPACE, reviewUuidKey(parts))).toBe(stableUuid(uuidKey(parts)))
    }
  })

  it('이름공간이 UUID 가 아니면 오류', () => {
    expect(() => uuidV5('nope', 'x')).toThrow(RangeError)
  })
})

// ───────────────────────────── 비교 ─────────────────────────────

describe('compareLabelSets — 손계산 시료 (2인, 기록 단위)', () => {
  const { r, s } = handCompare()

  it('목적·이름·규칙 버전·검토 범위 규칙', () => {
    expect(r.purpose).toBe('inter-reader')
    expect(r.name).toBe('사람 간 일치도')
    expect(r.reviewRulesVersion).toBe(REVIEW_RULES_VERSION)
    expect(r.context.params.coverage).toBe('both')
    expect([r.context.params.scanGapMm, r.context.params.depthDiffMm]).toEqual([10, 5])
    expect(r.labelers).toEqual({ a: 'kim', b: 'lee' })
    expect(r.context.unit).toBe('record')
    expect(r.groupingRulesVersion).toBeNull()
  })

  it('행: 틀 → 스캔 시작 순서로 P001… , 짝·A 만·B 만과 판정', () => {
    expect(r.rows.map((x) => [x.id, x.kind, x.outcome, x.a?.refs.join() ?? null, x.b?.refs.join() ?? null])).toEqual([
      ['P001', 'pair', 'match', '1', '1'],
      ['P002', 'pair', 'match', '2', '2'],
      ['P003', 'pair', 'match', '3', '3'],
      ['P004', 'only-a', 'a-only', '4', null],
      ['P005', 'only-b', 'b-only', null, '8'],
      ['P006', 'pair', 'match', '5', '5'],
      ['P007', 'only-b', 'b-only', null, '6'],
      ['P008', 'only-b', 'reference', null, '7']
    ])
    // 같은 지시 조건을 만족하는 상대가 없었음
    expect(row(r, 'P004').hadCandidate).toBe(false)
    expect(row(r, 'P005').hadCandidate).toBe(false)
  })

  it('경계값: 간격 = X, 깊이 중심 차 = Y 는 짝, 간격 X + 0.02 는 짝이 아님', () => {
    expect(row(r, 'P002').geometry?.scanGapMm).toBe(10)
    expect(row(r, 'P003').geometry?.depthCenterDiffMm).toBe(5)
    expect(row(r, 'P005').b?.item.scanStartMm).toBeCloseTo(170.02, 9)
  })

  it('행 차이는 b − a', () => {
    expect(row(r, 'P001').diff).toEqual({ scanCenter: 0, scanStart: 0, scanEnd: 0, depthCenter: 0, length: 0, height: 0.5 })
    expect(row(r, 'P002').diff).toMatchObject({ scanCenter: 20, scanStart: 20, scanEnd: 20, length: 0, height: 0.5 })
    expect(row(r, 'P003').diff).toMatchObject({ scanCenter: 0, depthCenter: 5, height: null })
    expect(row(r, 'P004').diff.scanCenter).toBeNull()
  })

  it('종류 1단·2단 일치와 확신도', () => {
    expect(row(r, 'P002').agreement).toMatchObject({
      character: { a: 'planar', b: 'planar', agree: true },
      proposalClass: { a: 'lof', b: 'lof', agree: true },
      type: { a: 'lof-sidewall', b: 'lof-root', agree: false },
      typeUncertain: false
    })
    expect(row(r, 'P003').agreement).toMatchObject({
      character: { agree: true },
      proposalClass: { a: 'slag', b: 'porosity', agree: false }
    })
    expect(row(r, 'P006').agreement?.typeUncertain).toBe(true)
    expect(row(r, 'P006').a?.item.typeConfidence).toBe('uncertain')
    expect(row(r, 'P008').b?.existenceConfidence).toBe('uncertain')
    expect(row(r, 'P001').a?.existenceConfidence).toBe('certain')
    expect(row(r, 'P002').a?.heightMethod).toBe('6db')
    expect(row(r, 'P002').b?.heightMethod).toBe('tip-tip')
  })

  it('지시 매칭: 재현율 4/5, 정밀도 4/6, F1 = 8/11 (Wilson 95 %)', () => {
    const d = r.summary.detection
    expect([d.hits, d.truthCounted, d.misses, d.predCounted, d.falsePositives]).toEqual([4, 5, 1, 6, 2])
    expect(d.recall.p).toBeCloseTo(0.8, 12)
    expect(d.precision.p).toBeCloseTo(4 / 6, 12)
    expect(d.f1).toBeCloseTo(8 / 11, 12)
    // Wilson 4/5: 37.6 % ~ 96.4 %
    expect(d.recall.lower).toBeCloseTo(0.3755, 3)
    expect(d.recall.upper).toBeCloseTo(0.9638, 3)
  })

  it('위치·길이·높이 오차: MAE·치우침·95 % 분위 (셈하는 쌍)', () => {
    const e = r.summary.errors
    expect(e.scanCenter).toMatchObject({ n: 4, mae: 5, bias: 5, maxAbs: 20 })
    expect(e.scanCenter.p95Abs).toBeCloseTo(17, 12) // [0,0,0,20] type 7: 0 + 0.85 × 20
    expect(e.depthCenter).toMatchObject({ n: 4, mae: 1.25, bias: 1.25 })
    expect(e.length).toMatchObject({ n: 4, mae: 0, bias: 0 })
    expect(e.height).toMatchObject({ n: 2, mae: 0.5, bias: 0.5 })
    // 높이는 방법별로도: 시방서 방법끼리 1쌍(P001), −6 dB 가 낀 쌍 1쌍(P002)
    expect(e.heightSpec).toMatchObject({ n: 1, mae: 0.5 })
    expect(e.heightRef6db).toMatchObject({ n: 1, mae: 0.5 })
  })

  it('1단 kappa = 1 (3쌍, 종류 확신도 불확실 1쌍은 뺌), 2단 일치율 2/3', () => {
    const c = r.summary.character
    expect(c.matrix).toEqual([
      [2, 0],
      [0, 1]
    ])
    expect([c.total, c.typeUncertain, c.agreement, c.kappa.kappa]).toEqual([3, 1, 1, 1])
    expect(r.summary.proposalClass.agreement).toBeCloseTo(2 / 3, 12)
    expect(r.summary.type.agreement).toBeCloseTo(1 / 3, 12)
  })

  it('구간 단위 일치도: 20 mm × 15칸, 참고만 걸린 칸 1개 뺌, κ = 24/94', () => {
    const g = r.summary.grading
    expect(g).not.toBeNull()
    expect(g?.agreement.units).toBe(15)
    expect(g?.agreement.excludedReference).toBe(1)
    expect(g?.agreement.table).toEqual([
      [3, 2],
      [3, 6]
    ])
    expect(g?.agreement.kappa.kappa).toBeCloseTo(24 / 94, 12)
    expect(g?.accuracy).toBeCloseTo(9 / 14, 12)
    expect(r.summary.coverage).toMatchObject({ rule: 'both', known: true, lengthMm: 300, frames: [`file:${S1}`] })
  })

  it('요약 수 · 검토 범위 밖 없음 · 같은 입력 → 같은 결과 · JSON 왕복', () => {
    expect(r.summary.counts).toEqual({ unitsA: 5, unitsB: 7, pairs: 4, countedPairs: 4, onlyA: 1, onlyB: 3, excludedA: 0, excludedB: 0 })
    expect(r.summary.outside).toEqual({ aOnly: 0, bOnly: 0, rowIds: [] })
    const again = compareLabelSets({ records: s.A, intervals: r.intervalsA }, { records: s.B, intervals: r.intervalsB }, { unit: 'record' })
    expect(JSON.stringify(again)).toBe(JSON.stringify(r))
    expect(JSON.parse(JSON.stringify(r)).rows.length).toBe(8)
  })

  it('입력 순서를 바꿔도 행 ID 와 요약이 같다', () => {
    const shuffled = compareLabelSets(
      { records: [...s.A].reverse(), intervals: r.intervalsA },
      { records: [...s.B].reverse(), intervals: r.intervalsB },
      { unit: 'record' }
    )
    expect(shuffled.rows.map((x) => [x.id, x.a?.item.id ?? null, x.b?.item.id ?? null])).toEqual(r.rows.map((x) => [x.id, x.a?.item.id ?? null, x.b?.item.id ?? null]))
    expect(shuffled.summary.detection).toEqual(r.summary.detection)
  })
})

describe('compareLabelSets — 검토 범위·참고 구역·목적', () => {
  it("2인('both'): 한쪽만 검토한 구간의 짝 없는 지시는 검토 범위 밖으로 따로 센다", () => {
    const a = [rec({ labeler: 'kim', scan: [10, 20], depth: [2, 4] }), rec({ labeler: 'kim', scan: [260, 270], depth: [2, 4] })]
    const b = [rec({ labeler: 'lee', scan: [10, 20], depth: [2, 4] }), rec({ labeler: 'lee', scan: [220, 230], depth: [2, 4] })]
    const r = compareLabelSets({ records: a, intervals: [reviewed('kim', 0, 300)] }, { records: b, intervals: [reviewed('lee', 0, 200)] })
    expect(r.summary.coverage.lengthMm).toBe(200)
    expect(r.rows.map((x) => [x.kind, x.outcome])).toEqual([
      ['pair', 'match'],
      ['only-b', 'outside-coverage'],
      ['only-a', 'outside-coverage']
    ])
    expect(r.summary.outside).toEqual({ aOnly: 1, bOnly: 1, rowIds: ['P002', 'P003'] })
    expect([r.summary.detection.misses, r.summary.detection.falsePositives]).toEqual([0, 0])
    expect(r.summary.grading?.agreement.units).toBe(10)
  })

  it('B 만인 지시가 A 의 기준 미만 구간에 걸치면 참고 구역 (오검출 아님)', () => {
    const below = newReviewInterval({ uuid: uuid(), sha256: S1, labelerId: 'kim', guidelineVersion: 'v1', kind: 'below-threshold', scanStartMm: 120, scanEndMm: 125 })
    const r = compareLabelSets(
      { records: [], intervals: [reviewed('kim', 0, 300), below] },
      { records: [rec({ labeler: 'lee', scan: [121, 124], depth: [2, 3] })], intervals: [reviewed('lee', 0, 300)] }
    )
    expect(r.rows[0]).toMatchObject({ kind: 'only-b', outcome: 'zone', zone: 'below-threshold' })
    expect(r.summary.detection.falsePositives).toBe(0)
    expect(r.summary.detection.predInZone).toBe(1)
  })

  it("목적 'accuracy' = 정답 쪽 검토 범위, 이름 '정확도'. 검토 구간이 없으면 범위를 모른다고 알림", () => {
    const a = [rec({ labeler: 'final', scan: [10, 20], depth: [2, 4] })]
    const b = [rec({ labeler: 'ai', scan: [12, 22], depth: [2, 4] })]
    const r = compareLabelSets({ records: a, intervals: [reviewed('final', 0, 100)] }, { records: b }, { purpose: 'accuracy' })
    expect([r.name, r.context.params.coverage, r.summary.coverage.known]).toEqual(['정확도', 'truth', true])
    const r2 = compareLabelSets({ records: a }, { records: b }, { purpose: 'agency' })
    expect(r2.name).toBe('전문기관 대비 일치도')
    expect(r2.summary.grading).toBeNull()
    expect(r2.warnings.some((w) => w.includes('검토 범위를 모릅니다'))).toBe(true)
  })

  it("용접부 틀: 반대 방향으로 스캔한 두 파일(A 는 파일 1, B 는 파일 2)을 시편 좌표로 맞춰 짝짓는다", () => {
    const base = {
      specimenId: 'SP9',
      weldId: 'W1',
      datumKind: null,
      datumDescription: null,
      skew90Side: null,
      alignmentAssumed: false,
      thicknessMm: 12,
      outerDiameterMm: null,
      overlapStartMm: null,
      overlapEndMm: null,
      probeClSkew90Mm: null,
      probeClSkew270Mm: null,
      trackDeviationMaxMm: null,
      evidence: null,
      enteredBy: null,
      revision: 1,
      versions: [],
      deleted: false,
      pcId: null,
      updatedAt: null,
      note: ''
    }
    const alignments = [
      { ...base, sha256: S1, fileName: '정방향.nde', datumUMm: 0, direction: 1 as const },
      { ...base, sha256: S2, fileName: '역방향.nde', datumUMm: 300, direction: -1 as const }
    ]
    const a = [rec({ labeler: 'kim', sha: S1, scan: [40, 60], depth: [3, 5] })]
    // 파일 2 의 U 240~258 = 시편 42~60
    const b = [rec({ labeler: 'lee', sha: S2, scan: [240, 258], depth: [3, 5] })]
    const r = compareLabelSets(
      { records: a, intervals: [reviewed('kim', 0, 300, S1)] },
      { records: b, intervals: [reviewed('lee', 0, 300, S2)] },
      { params: { frame: 'weld' }, alignments }
    )
    expect(r.rows.map((x) => [x.kind, x.frameKey])).toEqual([['pair', 'weld:SP9|W1']])
    expect(r.rows[0]?.b?.item).toMatchObject({ scanStartMm: 42, scanEndMm: 60 })
    expect(r.rows[0]?.diff.scanCenter).toBe(1)
    expect([r.rows[0]?.a?.fileNames, r.rows[0]?.b?.fileNames]).toEqual([['정방향.nde'], ['역방향.nde']])
    expect(r.summary.coverage).toMatchObject({ known: true, lengthMm: 300, frames: ['weld:SP9|W1'] })
  })

  it('매칭 인자를 넘기면 덮어쓴다 (X = 5 면 경계 쌍이 깨짐)', () => {
    const s = handSets()
    const r = compareLabelSets(
      { records: s.A, intervals: [reviewed('kim', 0, 300)] },
      { records: s.B, intervals: [reviewed('lee', 0, 300)] },
      { unit: 'record', params: { scanGapMm: 5 } }
    )
    expect(r.summary.detection.hits).toBe(3)
    expect(r.context.params.scanGapMm).toBe(5)
  })
})

describe('그룹 짓기 후 단위 비교 (평가 정의 3절)', () => {
  // A 는 한 줄(100~118, 길이 18), B 는 두 조각으로 나눠 적음 (100~106 길이 6, 110~118 길이 8)
  const mk = () => ({
    a: [rec({ labeler: 'kim', scan: [100, 118], depth: [5, 8], length: 18 })],
    b: [rec({ labeler: 'lee', scan: [100, 106], depth: [5, 8], length: 6 }), rec({ labeler: 'lee', scan: [110, 118], depth: [5, 8], length: 8 })]
  })

  it("'compute': 두께로 다시 묶어 한 단위, 길이 = 6 + 8 + 4 = 18 (groupLengthMm 와 같음)", () => {
    const { a, b } = mk()
    const r = compareLabelSets({ records: a, intervals: [reviewed('kim', 0, 300)] }, { records: b, intervals: [reviewed('lee', 0, 300)] }, { thicknessMm: 12 })
    expect(r.rows.map((x) => x.outcome)).toEqual(['match'])
    const bu = r.rows[0]?.b
    expect(bu?.item.source).toBe('group')
    expect(bu?.records.map((x) => x.derived.scanStartMm)).toEqual([100, 110])
    expect(bu?.item.lengthMm).toBe(18)
    expect(r.rows[0]?.diff.length).toBe(0)
    expect(r.summary.detection.f1).toBe(1)
  })

  it("'record': 조각마다 한 단위 — 나누기 차이가 오검출로 나옴", () => {
    const { a, b } = mk()
    const r = compareLabelSets({ records: a, intervals: [reviewed('kim', 0, 300)] }, { records: b, intervals: [reviewed('lee', 0, 300)] }, { unit: 'record' })
    expect(r.rows.map((x) => [x.kind, x.outcome])).toEqual([
      ['pair', 'match'],
      ['only-b', 'b-only']
    ])
    expect(r.summary.detection.falsePositives).toBe(1)
    expect(r.warnings.some((w) => w.includes('비교 단위 = 기록 하나'))).toBe(true)
  })

  it("기본 'chain' 묶기는 촘촘한 지시를 이어 묶는다 (손계산 시료 B 7건 → 1단위, 불확실 기록도 묶임)", () => {
    const s = handSets()
    const r = compareLabelSets({ records: s.A }, { records: s.B }, { thicknessMm: 12 })
    expect(r.summary.counts.unitsB).toBe(1)
    expect(r.rows.find((x) => x.b)?.b?.records).toHaveLength(7)
  })

  it("'stored': 기록의 groupingId 를 그대로 (비어 있으면 기록 단위와 같음). 두께를 모르면 'compute' 도 묶지 않고 알림", () => {
    const { a, b } = mk()
    const stored = compareLabelSets({ records: a }, { records: b }, { grouping: 'stored' })
    expect(stored.summary.counts.unitsB).toBe(2)
    expect(stored.groupingRulesVersion).toBeNull()
    const noT = compareLabelSets({ records: a }, { records: b })
    expect(noT.summary.counts.unitsB).toBe(2)
    expect(noT.warnings.some((w) => w.startsWith('그룹 짓기(B): 두께를 몰라'))).toBe(true)
  })

  it('두께는 파일 정렬에서도 찾는다 (파일 이름도)', () => {
    const { a, b } = mk()
    const al = { sha256: S1, fileName: '시편1.nde', thicknessMm: 12 }
    const r = compareLabelSets({ records: a }, { records: b }, {
      alignments: [
        {
          ...al,
          specimenId: null,
          weldId: null,
          datumKind: null,
          datumDescription: null,
          datumUMm: null,
          direction: null,
          skew90Side: null,
          alignmentAssumed: false,
          outerDiameterMm: null,
          overlapStartMm: null,
          overlapEndMm: null,
          probeClSkew90Mm: null,
          probeClSkew270Mm: null,
          trackDeviationMaxMm: null,
          evidence: null,
          enteredBy: null,
          revision: 1,
          versions: [],
          deleted: false,
          pcId: null,
          updatedAt: null,
          note: ''
        }
      ]
    })
    expect(r.context.thicknessBySha[S1]).toBe(12)
    expect(r.summary.counts.unitsB).toBe(1)
    expect(r.rows[0]?.a?.fileNames).toEqual(['시편1.nde'])
  })
})

// ───────────────────────────── CSV ─────────────────────────────

describe('CSV', () => {
  it('칸 규칙: 숫자 반올림·−0·참거짓·빈칸·따옴표·수식 막기', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(-0.0001)).toBe('0')
    expect(formatNumber(12)).toBe('12')
    expect(formatNumber(1.23456)).toBe('1.235')
    expect(formatNumber(Number.NaN)).toBe('')
    expect([csvCell(true), csvCell(false), csvCell(null), csvCell(undefined)]).toEqual(['예', '아니오', '', ''])
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('그가 "같음"')).toBe('"그가 ""같음"""')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('-3')).toBe("'-3")
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell('줄\n바꿈')).toBe('"줄\n바꿈"')
  })

  it('BOM + CRLF (기본), 끄기', () => {
    expect(toCsv([['가', 1], ['나', null]])).toBe('﻿가,1\r\n나,\r\n')
    expect(toCsv([['가']], { bom: false, eol: '\n' })).toBe('가\n')
  })

  it('비교 행 CSV = 부록 A 쌍 판정 표 (머리 + 행마다 한 줄, Level III 두 칸은 빈칸)', () => {
    const { r } = handCompare()
    const text = comparisonRowsCsv(r, { bom: false })
    const lines = text.trimEnd().split('\r\n')
    expect(lines).toHaveLength(1 + r.rows.length)
    expect(lines[0]).toBe(COMPARISON_CSV_HEADER.join(','))
    const cells = (i: number): string[] => (lines[i] ?? '').split(',')
    const col = (name: string): number => COMPARISON_CSV_HEADER.indexOf(name)
    expect(cells(1)[0]).toBe('P001')
    expect(cells(1)[col('구분')]).toBe('짝')
    expect(cells(1)[col('A 지시 번호')]).toBe('1')
    expect(cells(1)[col('높이 차 (mm)')]).toBe('0.5')
    expect(cells(2)[col('스캔 간격 (mm)')]).toBe('10')
    expect(cells(2)[col('2단 일치 (제안서 5종)')]).toBe('예')
    expect(cells(2)[col('종류 그대로 일치')]).toBe('아니오')
    expect(cells(3)[col('A 종류')]).toBe('슬래그')
    expect(cells(4)[col('구분')]).toBe('A 만')
    expect(cells(4)[col('B 라벨러')]).toBe('')
    expect(cells(4)[col('후보 있었음')]).toBe('아니오')
    expect(cells(8)[col('B 존재 확신도')]).toBe('불확실')
    expect(cells(1).slice(-2)).toEqual(['', ''])
  })
})
