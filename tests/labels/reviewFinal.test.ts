/**
 * 3단계 검수 — Level III 확정(buildFinalSet), 확정 검토 구간, 설계값 대조(checkAgainstDesign), 보고서.
 * 확정 기록은 validate.ts 를 통과해야 하고(모르는 칸 'adjudication' 보존), UUID 는 입력 UUID 에서 결정적이다.
 */
import { describe, expect, it } from 'vitest'
import { newFileAlignment, newIndicationRecord, newLabelExport, newPhysicalDefect, newReviewInterval } from '@shared/labels/factory'
import { LABEL_COORD_RULES_VERSION, type AnchorPoint, type FileAlignment, type IndicationRecord, type MetallurgicalType, type ReviewInterval } from '@shared/labels/types'
import { parseLabelExport, validateIndicationRecord, validateReviewInterval } from '@shared/labels/validate'
import {
  adjudicationUuid,
  buildEvaluationReport,
  buildFinalSet,
  checkAgainstDesign,
  compareLabelSets,
  designCheckCsv,
  evaluationReportCsv,
  finalReviewIntervals,
  reviewedLengthMm,
  sensitivityGrid,
  type AdjudicationDecision,
  type AdjudicationInput,
  type CompareResult,
  type FinalRecord
} from '@shared/labels/review'

const S1 = 'c3'.repeat(32)
let seq = 0
const uuid = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`
const L3 = { labelerId: 'park-l3', qualification: 'UT Level III', organization: '한난' }
const NOW = '2026-10-30T10:00:00+09:00'

function rec(labeler: string, scan: [number, number], depth: [number, number] | null, type: MetallurgicalType | null, over: Partial<IndicationRecord> = {}): IndicationRecord {
  return newIndicationRecord({
    uuid: uuid(),
    sha256: S1,
    labelerId: labeler,
    guidelineVersion: 'v1',
    defectType: type,
    derived: { scanStartMm: scan[0], scanEndMm: scan[1], depthTopMm: depth?.[0] ?? null, depthBottomMm: depth?.[1] ?? null },
    ...over
  })
}

function reviewed(labeler: string, s: number, e: number, groupId: number | null = null, gate = { depthTopMm: 7, depthBottomMm: 28, legMin: 1, legMax: 3 }): ReviewInterval {
  return newReviewInterval({ uuid: uuid(), sha256: S1, labelerId: labeler, guidelineVersion: 'v1', kind: 'reviewed', scanStartMm: s, scanEndMm: e, groupId, gate })
}

function anchor(id: string, role: AnchorPoint['role'], depthMm: number): AnchorPoint {
  return {
    id,
    role,
    anchor: { groupId: 0, scanIndex: 100, beam: 10, sample: 200, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: true },
    leg: 1,
    displayGainDb: null,
    mm: { scanMm: 100, vMm: -5, depthMm }
  }
}

/** 행 5개: P001 짝(종류 다름), P002 짝, P003 A 만, P004 B 만, P005 B 만(불확실) */
function sets() {
  const a1 = rec('kim', [10, 20], [2, 4], 'crack-toe', { length: { valueMm: 10, method: 'eval-level' }, height: { valueMm: 2, method: 'tip-tip' }, note: 'A 메모' } as Partial<IndicationRecord>)
  const a2 = rec('kim', [100, 120], [5, 7], 'slag', { externalRef: '2' })
  const a3 = rec('kim', [150, 160], [8, 10], 'crack-root')
  const b1 = rec('lee', [12, 22], [2.5, 4.5], 'lof-sidewall', { length: { valueMm: 12, method: 'eval-level' }, height: { valueMm: 3, method: 'tip-surface' }, note: 'B 메모' } as Partial<IndicationRecord>)
  const b2 = rec('lee', [101, 119], [5, 7], 'slag')
  const b4 = rec('lee', [250, 260], [1, 2], 'lof-root')
  const b5 = rec('lee', [270, 275], [1, 2], 'crack-toe', { existenceConfidence: 'uncertain' })
  const echo = newIndicationRecord({
    uuid: uuid(),
    sha256: S1,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    kind: 'geometric-echo',
    geometricEcho: { kind: 'root', fromSuggestion: false },
    derived: { scanStartMm: 0, scanEndMm: 300 }
  })
  return { a1, a2, a3, b1, b2, b4, b5, echo }
}

function compare(): { c: CompareResult; s: ReturnType<typeof sets> } {
  const s = sets()
  const c = compareLabelSets(
    { records: [s.a1, s.a2, s.a3, s.echo], intervals: [reviewed('kim', 0, 300, 0), reviewed('kim', 0, 300, 1)] },
    { records: [s.b1, s.b2, s.b4, s.b5], intervals: [reviewed('lee', 0, 280, null, { depthTopMm: 5, depthBottomMm: 20, legMin: 1, legMax: 2 })] },
    { unit: 'record' }
  )
  return { c, s }
}

const DECISIONS: AdjudicationDecision[] = [
  { rowId: 'P001', choice: 'merge', fields: { position: 'a', type: 'b', height: 'b' }, note: '종류는 B 가 맞음' },
  { rowId: 'P002', choice: 'b' },
  { rowId: 'P003', choice: 'defer' },
  { rowId: 'P004', choice: 'neither', note: '형상 에코' },
  { rowId: 'P005', choice: 'b' }
]

/** 한 번 만든 비교 (UUID 가 같아야 결정적 UUID 를 견줄 수 있음) */
const BASE = compare()

function input(over: Partial<AdjudicationInput> = {}): AdjudicationInput {
  return { comparison: BASE.c, decisions: DECISIONS, adjudicator: L3, now: NOW, pcId: 'pc-l3', ...over }
}

const byRow = (records: readonly FinalRecord[], rowId: string): FinalRecord[] => records.filter((r) => r.adjudication.rowId === rowId)

describe('buildFinalSet — Level III 확정', () => {
  const { c, s } = BASE
  const out = buildFinalSet(input())

  it('비교 행 확인 (P001~P005)', () => {
    expect(c.rows.map((r) => [r.id, r.kind])).toEqual([
      ['P001', 'pair'],
      ['P002', 'pair'],
      ['P003', 'only-a'],
      ['P004', 'only-b'],
      ['P005', 'only-b']
    ])
  })

  it('행 결과: 확정·결함 아님·보류, 모두 결정했으니 complete', () => {
    expect(out.rows.map((r) => [r.rowId, r.status, r.recordUuids.length])).toEqual([
      ['P001', 'final', 1],
      ['P002', 'final', 1],
      ['P003', 'deferred', 1],
      ['P004', 'rejected', 0],
      ['P005', 'final', 1]
    ])
    expect(out.complete).toBe(true)
    expect(out.undecided).toEqual([])
    expect(out.records).toHaveLength(4)
    expect(out.labelSets).toEqual([{ sha256: S1, labelerId: 'park-l3', guidelineVersion: 'v1', readingStage: 'final' }])
  })

  it('확정 기록 칸: 판독 단계 확정, 라벨러 = Level III, 설계값 봄, 그룹·제안·지시 번호 비움', () => {
    for (const r of out.records) {
      expect(r).toMatchObject({
        labelerId: 'park-l3',
        readingStage: 'final',
        guidelineVersion: 'v1',
        revision: 1,
        versions: [],
        deleted: false,
        pcId: 'pc-l3',
        createdAt: NOW,
        updatedAt: NOW,
        readerSource: 'expert',
        readerDetail: { organization: '한난', qualification: 'UT Level III', modelVersion: null },
        externalRef: null,
        groupingId: null,
        suggestions: [],
        knowledge: { designValueSeen: true, specimenKnown: null, aiDevParticipant: null }
      })
      expect(r.adjudication.format).toBe('paut-adjudication')
    }
  })

  it('합침: 위치는 A, 종류·높이는 B, 나머지(길이·신호·메모)는 위치 쪽. Level III 메모는 끝에 붙음', () => {
    const [m] = byRow(out.records, 'P001')
    expect(m?.derived).toMatchObject({ scanStartMm: 10, scanEndMm: 20, depthTopMm: 2, depthBottomMm: 4 })
    expect(m?.defectType).toBe('lof-sidewall')
    expect(m?.height).toMatchObject({ valueMm: 3, method: 'tip-surface' })
    expect(m?.length.valueMm).toBe(10)
    expect(m?.note).toBe('A 메모 · Level III: 종류는 B 가 맞음')
    expect(m?.adjudication).toMatchObject({
      decision: 'merge',
      sourceRecord: s.a1.uuid,
      sources: { a: [s.a1.uuid], b: [s.b1.uuid] },
      labelers: { a: 'kim', b: 'lee' },
      fieldSources: { position: 'a', type: 'b', existence: 'a', length: 'a', height: 'b', signal: 'a', note: 'a' },
      match: { rulesVersion: 1, scanGapMm: 10, depthDiffMm: 5, frame: 'file', unit: 'record' },
      note: '종류는 B 가 맞음'
    })
  })

  it('보류는 존재 확신도 불확실로 남김 (시험에서 불확실 범주), 결함 아님은 기록 없음', () => {
    const [d] = byRow(out.records, 'P003')
    expect(d?.existenceConfidence).toBe('uncertain')
    expect(d?.adjudication.decision).toBe('defer')
    expect(byRow(out.records, 'P004')).toEqual([])
    const omit = buildFinalSet(input({ deferAs: 'omit' }))
    expect(byRow(omit.records, 'P003')).toEqual([])
    expect(omit.rows.find((r) => r.rowId === 'P003')?.status).toBe('deferred')
  })

  it('모든 확정 기록이 validate 를 통과하고 adjudication 칸이 보존된다 (내보내기 파일 검사도)', () => {
    for (const r of out.records) {
      const v = validateIndicationRecord(JSON.parse(JSON.stringify(r)))
      expect(v.errors).toEqual([])
      expect(v.ok).toBe(true)
      expect(v.warnings).toContain('모르는 칸을 그대로 보존합니다: adjudication (1곳)')
      expect((v.value as unknown as FinalRecord).adjudication).toEqual(r.adjudication)
    }
    for (const iv of out.reviewIntervals) expect(validateReviewInterval(iv).errors).toEqual([])
    const file = newLabelExport({ appVersion: 'test', exportedAt: NOW, pcId: 'pc-l3' }, { records: out.records, reviewIntervals: out.reviewIntervals })
    const parsed = parseLabelExport(JSON.parse(JSON.stringify(file)))
    expect(parsed.errors).toEqual([])
    expect(parsed.ok).toBe(true)
  })

  it('결정적 UUID: (Level III, 지침서, sha256, 원본 UUID) — 다시 돌리면 같고, a ↔ 합침(위치 = a) ↔ 보류는 같은 UUID', () => {
    const [m] = byRow(out.records, 'P001')
    expect(m?.uuid).toBe(adjudicationUuid(['park-l3', 'v1', 'final', S1, 'record', s.a1.uuid]))
    expect(m?.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const again = buildFinalSet({ comparison: c, decisions: DECISIONS, adjudicator: L3, now: NOW, pcId: 'pc-l3' })
    expect(JSON.stringify(again)).toBe(JSON.stringify(out))
    const asA = buildFinalSet(input({ decisions: [{ rowId: 'P001', choice: 'a' }] }))
    const asDefer = buildFinalSet(input({ decisions: [{ rowId: 'P001', choice: 'defer' }] }))
    expect(byRow(asA.records, 'P001')[0]?.uuid).toBe(m?.uuid)
    expect(byRow(asDefer.records, 'P001')[0]?.uuid).toBe(m?.uuid)
    const asB = buildFinalSet(input({ decisions: [{ rowId: 'P001', choice: 'b' }] }))
    expect(byRow(asB.records, 'P001')[0]?.uuid).toBe(adjudicationUuid(['park-l3', 'v1', 'final', S1, 'record', s.b1.uuid]))
    // 다른 Level III 는 다른 UUID
    const other = buildFinalSet(input({ adjudicator: { labelerId: 'choi-l3' } }))
    expect(byRow(other.records, 'P001')[0]?.uuid).not.toBe(m?.uuid)
  })

  it('이전 확정 기록: 같은 UUID 는 versions·revision·createdAt 을 이어 받고, 나오지 않은 UUID 는 removed', () => {
    const prev = out.records.map((r) => ({ ...r, versions: [{ pcId: 'pc-l3:r1', edits: 2 }], revision: 2, createdAt: '2026-10-29T09:00:00+09:00' }))
    const changed = DECISIONS.map((d) => (d.rowId === 'P002' ? { rowId: 'P002', choice: 'a' as const } : d))
    const next = buildFinalSet(input({ decisions: changed, previous: { records: prev, reviewIntervals: out.reviewIntervals } }))
    const [m] = byRow(next.records, 'P001')
    expect([m?.revision, m?.versions, m?.createdAt, m?.updatedAt]).toEqual([2, [{ pcId: 'pc-l3:r1', edits: 2 }], '2026-10-29T09:00:00+09:00', NOW])
    const oldP2 = byRow(out.records, 'P002')[0]?.uuid
    const newP2 = byRow(next.records, 'P002')[0]
    expect(next.removed.records).toEqual([oldP2])
    expect(newP2?.adjudication.sourceRecord).toBe(s.a2.uuid)
    expect(newP2?.revision).toBe(1)
    expect(next.removed.reviewIntervals).toEqual([])
  })

  it('결정하지 않은 행·잘못된 결정·모르는 행 ID', () => {
    const r = buildFinalSet(
      input({
        decisions: [
          { rowId: 'P001', choice: 'a' },
          { rowId: 'P003', choice: 'b' },
          { rowId: 'P004', choice: 'merge' },
          { rowId: 'P999', choice: 'a' },
          { rowId: 'P002', choice: 'merge', fields: { length: 'c' as 'a' } }
        ]
      })
    )
    expect(r.rows.map((x) => [x.rowId, x.status])).toEqual([
      ['P001', 'final'],
      ['P002', 'invalid'],
      ['P003', 'invalid'],
      ['P004', 'invalid'],
      ['P005', 'undecided']
    ])
    expect(r.complete).toBe(false)
    expect(r.undecided).toEqual(['P005'])
    expect(r.warnings.some((w) => w.includes('P999'))).toBe(true)
  })

  it("비결함 기록: 기본은 넣지 않고 알림, carryNonDefect = 'a' 면 A 의 형상 에코를 베낌", () => {
    expect(out.warnings.some((w) => w.includes('비결함 기록(형상 에코 등) A 1건'))).toBe(true)
    const carried = buildFinalSet(input({ carryNonDefect: 'a' }))
    const echo = carried.records.find((r) => r.kind === 'geometric-echo')
    expect(echo?.adjudication).toMatchObject({ decision: 'carry', sourceRecord: s.echo.uuid, rowId: null })
    expect(validateIndicationRecord(echo).ok).toBe(true)
  })

  it('원래 두 세트는 고치지 않는다', () => {
    expect(c.recordsA.every((r) => r.readingStage === 'blind' && r.labelerId === 'kim')).toBe(true)
    expect(s.a1.note).toBe('A 메모')
  })
})

describe('합침 — 앵커 기록의 높이 점', () => {
  const mk = (labeler: string, depth: [number, number], h: number) =>
    rec(labeler, [10, 20], depth, 'crack-toe', {
      coordSource: 'app-anchor',
      anchors: [anchor('p1', 'tip-top', depth[0]), anchor('p2', 'tip-bottom', depth[1])],
      derived: { scanStartMm: 10, scanEndMm: 20, vMinMm: null, vMaxMm: null, depthTopMm: depth[0], depthBottomMm: depth[1], coordRulesVersion: LABEL_COORD_RULES_VERSION },
      height: { method: 'tip-tip', valueMm: h, pointIds: ['p1', 'p2'] }
    })

  it('위치 쪽이 앵커 기록이면 다른 쪽 높이 점을 새 id 로 옮겨 붙인다 (validate 통과)', () => {
    const a = mk('kim', [2, 4], 2)
    const b = mk('lee', [2.2, 4.6], 2.4)
    const c = compareLabelSets({ records: [a] }, { records: [b] }, { unit: 'record' })
    const out = buildFinalSet({ comparison: c, decisions: [{ rowId: 'P001', choice: 'merge', fields: { position: 'a', height: 'b' } }], adjudicator: L3 })
    const r = out.records[0]
    expect(r?.anchors.map((p) => p.id)).toEqual(['p1', 'p2', 'b-p1', 'b-p2'])
    expect(r?.height).toEqual({ method: 'tip-tip', valueMm: 2.4, pointIds: ['b-p1', 'b-p2'] })
    expect(r?.anchors[2]?.mm?.depthMm).toBe(2.2)
    const v = validateIndicationRecord(r)
    expect(v.errors).toEqual([])
    expect(v.warnings.some((w) => w.includes('높이'))).toBe(false)
  })

  it('위치 쪽이 엑셀 기록(앵커 없음)이면 높이 점 목록을 비우고 알림', () => {
    const a = rec('kim', [10, 20], [2, 4], 'crack-toe')
    const b = mk('lee', [2.2, 4.6], 2.4)
    const c = compareLabelSets({ records: [a] }, { records: [b] }, { unit: 'record' })
    const out = buildFinalSet({ comparison: c, decisions: [{ rowId: 'P001', choice: 'merge', fields: { position: 'a', height: 'b' } }], adjudicator: L3 })
    expect(out.records[0]?.height).toEqual({ method: 'tip-tip', valueMm: 2.4, pointIds: [] })
    expect(out.records[0]?.anchors).toEqual([])
    expect(out.rows[0]?.messages[0]).toContain('높이 점 목록을 비웠습니다')
    expect(validateIndicationRecord(out.records[0]).ok).toBe(true)
  })

  it('묶음(그룹)이 낀 합침은 종류·존재·메모만 다른 쪽에서, 나머지는 위치 쪽 값 + 알림', () => {
    const a = rec('kim', [100, 118], [5, 8], 'slag', { length: { valueMm: 18, method: 'eval-level' } } as Partial<IndicationRecord>)
    const b1 = rec('lee', [100, 106], [5, 8], 'lof-sidewall', { length: { valueMm: 6, method: 'eval-level' } } as Partial<IndicationRecord>)
    const b2 = rec('lee', [110, 118], [5, 8], 'lof-sidewall', { length: { valueMm: 8, method: 'eval-level' } } as Partial<IndicationRecord>)
    const c = compareLabelSets({ records: [a] }, { records: [b1, b2] }, { thicknessMm: 12 })
    expect(c.rows[0]?.b?.records).toHaveLength(2)
    const out = buildFinalSet({ comparison: c, decisions: [{ rowId: 'P001', choice: 'merge', fields: { position: 'b', type: 'a', length: 'a' } }], adjudicator: L3 })
    expect(out.records.map((r) => [r.derived.scanStartMm, r.defectType, r.length.valueMm])).toEqual([
      [100, 'slag', 6],
      [110, 'slag', 8]
    ])
    expect(out.rows[0]?.messages.some((m) => m.includes('칸별로 합칠 수 없어'))).toBe(true)
    expect(out.records[0]?.adjudication.fieldSources?.length).toBe('b')
    // 'b' 채택은 구성 기록마다 하나씩
    const asB = buildFinalSet({ comparison: c, decisions: [{ rowId: 'P001', choice: 'b' }], adjudicator: L3 })
    expect(asB.records.map((r) => r.adjudication.sourceRecord)).toEqual([b1.uuid, b2.uuid])
  })
})

describe('확정 검토 구간', () => {
  it('교집합: 그룹별(빈 그룹 = 모든 그룹), 게이트도 교집합. 품질 불량·기준 미만은 합집합(같은 것은 하나)', () => {
    const qa = newReviewInterval({ uuid: uuid(), sha256: S1, labelerId: 'kim', guidelineVersion: 'v1', kind: 'quality-bad', scanStartMm: 280, scanEndMm: 300, reason: 'coupling' })
    const qb = newReviewInterval({ uuid: uuid(), sha256: S1, labelerId: 'lee', guidelineVersion: 'v1', kind: 'quality-bad', scanStartMm: 280, scanEndMm: 300, reason: 'coupling' })
    const bt = newReviewInterval({ uuid: uuid(), sha256: S1, labelerId: 'lee', guidelineVersion: 'v1', kind: 'below-threshold', scanStartMm: 40, scanEndMm: 44 })
    const gone = { ...reviewed('lee', 0, 300), released: true }
    const out = finalReviewIntervals(
      [reviewed('kim', 0, 300, 0), reviewed('kim', 0, 300, 1), qa],
      [reviewed('lee', 0, 250, null, { depthTopMm: 5, depthBottomMm: 20, legMin: 1, legMax: 2 }), qb, bt, gone],
      { mode: 'intersection', adjudicator: L3, guidelineVersion: 'v1', now: NOW }
    )
    expect(out.map((x) => [x.kind, x.groupId, x.scanStartMm, x.scanEndMm])).toEqual([
      ['reviewed', 0, 0, 250],
      ['reviewed', 1, 0, 250],
      ['quality-bad', null, 280, 300],
      ['below-threshold', null, 40, 44]
    ])
    expect(out[0]?.gate).toEqual({ depthTopMm: 7, depthBottomMm: 20, legMin: 1, legMax: 2 })
    expect(out.every((x) => x.readingStage === 'final' && x.labelerId === 'park-l3')).toBe(true)
    for (const x of out) expect(validateReviewInterval(x).errors).toEqual([])
    expect(reviewedLengthMm(out)).toBe(250)
    const again = finalReviewIntervals([reviewed('kim', 0, 300, 0), reviewed('kim', 0, 300, 1), qa], [reviewed('lee', 0, 250), qb, bt], {
      mode: 'intersection',
      adjudicator: L3,
      guidelineVersion: 'v1'
    })
    expect(again.map((x) => x.uuid).slice(0, 2)).toEqual(out.map((x) => x.uuid).slice(0, 2))
  })

  it("'a' 는 A 를 베끼고, 'none' 은 없음. 한쪽에만 검토 완료가 있는 파일은 교집합이 없음", () => {
    const a = [reviewed('kim', 0, 300)]
    expect(finalReviewIntervals(a, [], { mode: 'a', adjudicator: L3, guidelineVersion: 'v1' })).toHaveLength(1)
    expect(finalReviewIntervals(a, [], { mode: 'none', adjudicator: L3, guidelineVersion: 'v1' })).toEqual([])
    expect(finalReviewIntervals(a, [], { mode: 'intersection', adjudicator: L3, guidelineVersion: 'v1' })).toEqual([])
  })
})

// ───────────────────────────── 설계값 대조 ─────────────────────────────

function alignment(over: Partial<FileAlignment> = {}): FileAlignment {
  return newFileAlignment({ sha256: S1, fileName: 'SP1.nde', specimenId: 'SP1', weldId: 'W1', datumUMm: 0, direction: 1, thicknessMm: 12, ...over })
}

const DEFECTS = [
  newPhysicalDefect({ id: 'D1', specimenId: 'sp1', weldId: 'w1', source: 'manufacturer-report', confirmation: 'fabrication-record', design: { type: 'crack-toe', startMm: 12, endMm: 18 } }),
  newPhysicalDefect({ id: 'D2', specimenId: 'SP1', weldId: 'W1', source: 'manufacturer-report', confirmation: 'fabrication-record', design: { type: 'porosity-single', centerMm: 110, lengthMm: 10 } }),
  newPhysicalDefect({ id: 'D3', specimenId: 'SP1', weldId: 'W1', source: 'design-drawing', confirmation: 'design-only', design: { type: 'lof-sidewall', startMm: 40, endMm: 60, side: 'R' } }),
  newPhysicalDefect({ id: 'D4', specimenId: 'SP1', weldId: 'W1', source: 'pcn-sheet', confirmation: 'unknown', design: { type: 'slag', centerMm: 200 } })
]

describe('checkAgainstDesign — 미검출·추가 발견·종류 불일치', () => {
  const records = [
    rec('park-l3', [10, 20], [2, 4], 'crack-toe', { readingStage: 'final', physicalDefectId: 'D1' }),
    rec('park-l3', [100, 120], [5, 7], 'slag', { readingStage: 'final' }),
    rec('park-l3', [250, 260], [1, 2], 'lof-root', { readingStage: 'final', physicalDefectId: 'D3' })
  ]
  const d = checkAgainstDesign(records, DEFECTS, { alignments: [alignment()], intervals: [reviewed('park-l3', 0, 300)], unit: 'record' })

  it('행: 짝(D1·D2), 미검출(D3, D4 는 1인 계층이라 참고), 추가 발견(250~260)', () => {
    expect(d.rows.map((r) => [r.id, r.status, r.defectKey, r.counted, r.outcome])).toEqual([
      ['D001', 'matched', 'SP1/D1', true, 'match'],
      ['D002', 'missed', 'SP1/D3', true, 'a-only'],
      ['D003', 'matched', 'SP1/D2', true, 'match'],
      ['D004', 'missed', 'SP1/D4', false, 'reference'],
      ['D005', 'extra', null, true, 'b-only']
    ])
    expect(d.minTierLabel).toBe('인증·설계값')
  })

  it('종류 불일치: D2 기공 ↔ 슬래그 (1단은 둘 다 체적, 2단이 다름)', () => {
    const r = d.rows.find((x) => x.defectKey === 'SP1/D2')
    expect(r?.typeMismatch).toBe(true)
    expect(r?.agreement?.character.agree).toBe(true)
    expect(r?.agreement?.proposalClass).toEqual({ a: 'porosity', b: 'slag', agree: false })
    expect(r?.scanCenterDiffMm).toBe(0)
    expect(r?.lengthDiffMm).toBe(10)
  })

  it('ID 불일치: 추가 발견인데 기록에 D3 가 적혀 있음. 짝 D1 은 ID 가 맞음', () => {
    expect(d.rows.find((x) => x.status === 'extra')).toMatchObject({ recordDefectKeys: ['SP1/D3'], idMismatch: true })
    expect(d.rows[0]).toMatchObject({ recordDefectKeys: ['SP1/D1'], idMismatch: false })
    expect(d.summary).toMatchObject({ defects: 4, countedDefects: 3, referenceDefects: 1, matched: 2, missed: 2, extra: 1, typeMismatches: 1, idMismatches: 1 })
    expect(d.summary.recall.recall).toMatchObject({ x: 2, n: 3 })
  })

  it("minTier = 'any' 면 1인 계층도 셈하고 알림. 검토 구간이 없으면 범위를 모른다고 알림", () => {
    const any = checkAgainstDesign(records, DEFECTS, { alignments: [alignment()], minTier: 'any', unit: 'record' })
    expect(any.summary.countedDefects).toBe(4)
    expect(any.warnings.some((w) => w.includes('정답 계층과 무관하게'))).toBe(true)
    expect(any.warnings.some((w) => w.includes('검토 범위를 모릅니다'))).toBe(true)
  })

  it('파일 정렬이 없으면 기록이 빠지고 알림', () => {
    const none = checkAgainstDesign(records, DEFECTS, { alignments: [], unit: 'record' })
    expect(none.summary.matched).toBe(0)
    expect(none.warnings.some((w) => w.includes('견주지 못한 기록 3건'))).toBe(true)
  })

  it('CSV: 행마다 한 줄', () => {
    const lines = designCheckCsv(d, { bom: false }).trimEnd().split('\r\n')
    expect(lines).toHaveLength(6)
    expect(lines[2]?.startsWith('D002,미검출 (설계에만 있음),A 만 (미검출),SP1/D3,융합불량 (측벽),40,60,20,예')).toBe(true)
  })
})

describe('확정 + 설계값: 물리 결함 ID 채우기, 설계값으로 더하기', () => {
  it('짝지어진 결함 ID 를 빈 칸에 채우고, 직접 준 ID 는 덮지 않는다', () => {
    const { c } = compare()
    const withAlign = compareLabelSets(
      { records: c.recordsA, intervals: c.intervalsA },
      { records: c.recordsB, intervals: c.intervalsB },
      { unit: 'record', alignments: [alignment()] }
    )
    const out = buildFinalSet({
      comparison: withAlign,
      decisions: [...DECISIONS.filter((d) => d.rowId !== 'P002'), { rowId: 'P002', choice: 'a', physicalDefectId: 'X9' }],
      adjudicator: L3,
      design: { defects: DEFECTS }
    })
    const p1 = byRow(out.records, 'P001')[0]
    expect(p1?.physicalDefectId).toBe('D1')
    expect(p1?.adjudication.designDefectKey).toBe('SP1/D1')
    expect(byRow(out.records, 'P002')[0]?.physicalDefectId).toBe('X9')
    expect(out.designCheck?.summary.idMismatches).toBeGreaterThan(0)
    for (const r of out.records) expect(validateIndicationRecord(r).ok).toBe(true)
  })

  it('설계값으로 더하기: 시편 좌표 → 파일 U (방향 −1), 측정값은 비우고 물리 결함 ID 를 넣음', () => {
    const { c } = compare()
    const al = alignment({ datumUMm: 300, direction: -1 })
    const cc = compareLabelSets({ records: c.recordsA, intervals: c.intervalsA }, { records: c.recordsB, intervals: c.intervalsB }, { unit: 'record', alignments: [al] })
    const out = buildFinalSet({
      comparison: cc,
      decisions: DECISIONS,
      adjudicator: L3,
      design: { defects: DEFECTS },
      designAdditions: [
        { specimenId: 'SP1', defectId: 'D3', sha256: S1, note: '신호 다시 보니 있음' },
        { specimenId: 'SP1', defectId: 'D9', sha256: S1 }
      ]
    })
    const added = out.records.find((r) => r.adjudication.decision === 'design-add')
    expect(added?.derived).toMatchObject({ scanStartMm: 240, scanEndMm: 260, depthTopMm: null })
    expect(added).toMatchObject({ defectType: 'lof-sidewall', physicalDefectId: 'D3', readingStage: 'final', length: { valueMm: null }, height: { valueMm: null } })
    expect(added?.location.side).toBe('R')
    expect(added?.adjudication.designDefectKey).toBe('SP1/D3')
    expect(added?.uuid).toBe(adjudicationUuid(['park-l3', 'v1', 'final', S1, 'design', 'SP1/D3']))
    expect(validateIndicationRecord(added).ok).toBe(true)
    expect(out.warnings.some((w) => w.includes('SP1/D9'))).toBe(true)
  })
})

describe('보고서 (평가 정의 10절)', () => {
  it('확정 세트 대 AI: 머리·검출·오검출·오차·종류·구간 단위·POD·민감도·목록', () => {
    const al = alignment()
    const truth = [
      rec('park-l3', [10, 20], [2, 4], 'crack-toe', { readingStage: 'final', physicalDefectId: 'D1' }),
      rec('park-l3', [105, 115], [5, 7], 'porosity-single', { readingStage: 'final', physicalDefectId: 'D2' }),
      rec('park-l3', [40, 60], [6, 8], 'lof-sidewall', { readingStage: 'final', physicalDefectId: 'D3' })
    ]
    const ai = [
      rec('ai-v1', [11, 21], [2, 4], 'crack-toe', { readerSource: 'ai', readerDetail: { organization: null, qualification: null, modelVersion: 'm1' } }),
      rec('ai-v1', [180, 190], [3, 4], 'slag', { readerSource: 'ai', readerDetail: { organization: null, qualification: null, modelVersion: 'm1' } })
    ]
    const human = compareLabelSets({ records: [truth[0]!] }, { records: [rec('lee', [12, 22], [2, 4], 'crack-toe')] }, { unit: 'record', alignments: [al] })
    const c = compareLabelSets(
      { records: truth, intervals: [reviewed('park-l3', 0, 300)] },
      { records: ai },
      { purpose: 'accuracy', unit: 'record', alignments: [al] }
    )
    const rep = buildEvaluationReport({ comparison: c, header: { datasetVersion: 'ds-0.1', truthTier: 'consensus', modelVersion: 'm1' }, human, sensitivity: sensitivityGrid(c) })
    expect(rep.header).toMatchObject({
      name: '정확도',
      truthTierLabel: '2인 합의 + Level III',
      scanGapMm: 10,
      depthDiffMm: 5,
      matchFrozenAt: null,
      physicalDefects: { total: 3, planar: 2, volumetric: 1, unknown: 0 },
      specimens: 1,
      welds: 1,
      reviewedLengthM: 0.3
    })
    expect(rep.detection.map((d) => [d.category, d.physicalDefects, d.foundDefects, d.indicationRecall?.x, d.indicationRecall?.n])).toEqual([
      ['all', 3, 1, 1, 3],
      ['planar', 2, 1, 1, 2],
      ['volumetric', 1, 0, 0, 1],
      ['uncertain', null, null, undefined, undefined]
    ])
    expect(rep.falsePositives).toMatchObject({ falsePositives: 1, welds: 1, perWeld: 1, inspectedLengthMm: 300 })
    expect(rep.falsePositives.perMeter).toBeCloseTo(1 / 0.3, 12)
    const sc = rep.errors.find((e) => e.field === 'scanCenter')
    expect(sc?.stats).toMatchObject({ n: 1, mae: 1, bias: 1 })
    expect(sc?.humanMae).toBe(2)
    expect(rep.pod).toMatchObject({ defects: 3, hits: 1, misses: 2, allHit: false, requiredFor9095: 61 })
    expect(rep.sensitivity?.map((s) => [s.scanGapMm, s.depthDiffMm])).toEqual([
      [5, 3],
      [5, 5],
      [10, 3],
      [10, 5],
      [15, 3],
      [15, 5]
    ])
    expect(rep.list.map((l) => [l.kind, l.scanStartMm])).toEqual([
      ['miss', 40],
      ['miss', 105],
      ['false-positive', 180]
    ])
    expect(rep.grading?.units).toBe(15)
    expect(rep.warnings.some((w) => w.includes('동결 전 잠정값'))).toBe(true)

    const csv = evaluationReportCsv(rep, { bom: false })
    expect(csv.startsWith('[머리]\r\n항목,값\r\n무엇 대비,정확도\r\n')).toBe(true)
    for (const title of ['[검출]', '[오검출]', '[위치·크기] 예측 − 정답 (mm)', '[종류 1단] 면상 / 체적', '[종류 2단] 제안서 5종', '[구간 단위]', '[POD] (길이 기준)', '[민감도] X·Y 를 바꾼 결과', '[놓침·오검출 목록]', '[확인 사항]']) {
      expect(csv).toContain(`\r\n${title}\r\n`)
    }
    expect(csv).toContain('\r\n전체,3,1,33.3,6.1~79.2,1,3,33.3,6.1~79.2,')
    expect(csv).toContain('\r\nX·Y 동결 날짜,잠정값 (동결 전)\r\n')
  })
})
