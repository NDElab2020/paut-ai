/**
 * 3단계 검수 — X3 블라인드 픽스처(tests/fixtures/labels/x3_blind_kim.xlsx)를 core 엑셀 파서로 읽고,
 * 두 번째 판독자(lee-l2)가 조금 다르게 적은 것처럼 바꿔 비교·확정·설계값 대조 수치를 손계산과 견준다.
 * 설계값은 대조용 픽스처(x3_reconciled_kim.xlsx)의 물리 결함 11건(X3 결함정보, 출처 '없음' → minTier 'any').
 *
 * A (kim-l2, 블라인드) 결함 6건: F1 30~46 토우 균열 · F1 126~144 측벽 융합불량 · F2 149~170 루트 균열 ·
 *   F3 140~160 용입불량 · F4 215~226 기공(판정 특성 '면상'으로 적힘) · F3 245~255 슬래그(기록 기준 미만 = 참고).
 * B (lee-l2) 바꾼 것: F1 토우 균열 33~47(깊이 +0.35, 길이 14, 높이 3.0) · F1 측벽을 두 조각 126~132·136~144 로 나누고
 *   종류를 측벽 균열로 · F2 길이 23·높이 3.5 · F3 두 건 없음 · F4 214~226 슬래그(깊이 6~8) · F4 100~110 중앙 균열 추가 ·
 *   F1 250~260 불확실 추가 · 검토 완료는 F4 만 0~250.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLabelWorkbook, stableUuid } from '@core/labels/xlsx'
import type { IndicationRecord, ReviewInterval } from '@shared/labels/types'
import { validateIndicationRecord, validateReviewInterval } from '@shared/labels/validate'
import {
  buildEvaluationReport,
  buildFinalSet,
  compareLabelSets,
  comparisonRowsCsv,
  evaluationReportCsv,
  sensitivityGrid,
  type AdjudicationDecision,
  type CompareResult
} from '@shared/labels/review'
import { X3, fixture, x3Context } from '../core/labels/xlsxKit'

const [F1, F2, F3, F4] = X3.map((x) => x.sha256) as [string, string, string, string]
const blind = parseLabelWorkbook(readFileSync(fixture('x3_blind_kim.xlsx')), x3Context())
const reconciled = parseLabelWorkbook(readFileSync(fixture('x3_reconciled_kim.xlsx')), x3Context())

const find = (sha: string, ref: string | null): IndicationRecord => {
  const r = blind.records.find((x) => x.sha256 === sha && x.externalRef === ref)
  if (!r) throw new Error(`픽스처 기록 없음 ${sha.slice(0, 2)} ${ref}`)
  return r
}

/** 두 번째 판독자 기록 (A 기록을 베껴 바꿈) */
function lee(base: IndicationRecord, ref: string, over: Partial<IndicationRecord>): IndicationRecord {
  return {
    ...JSON.parse(JSON.stringify(base)),
    uuid: stableUuid(`lee-l2|${base.sha256}|${ref}`),
    labelerId: 'lee-l2',
    externalRef: ref,
    ...over
  } as IndicationRecord
}

function leeSet(): { records: IndicationRecord[]; intervals: ReviewInterval[] } {
  const a1 = find(F1, '1')
  const a2 = find(F1, '2')
  const a3 = find(F2, '1')
  const a5 = find(F4, '1')
  const records: IndicationRecord[] = [
    lee(a1, '1', {
      derived: { ...a1.derived, scanStartMm: 33, scanEndMm: 47, depthTopMm: 0.8, depthBottomMm: 3.4 },
      length: { ...a1.length, valueMm: 14 },
      height: { ...a1.height, valueMm: 3 }
    }),
    lee(a2, '2a', {
      derived: { ...a2.derived, scanStartMm: 126, scanEndMm: 132 },
      defectType: 'crack-sidewall',
      isoCode: '1012',
      length: { ...a2.length, valueMm: 6 }
    }),
    lee(a2, '2b', {
      derived: { ...a2.derived, scanStartMm: 136, scanEndMm: 144 },
      defectType: 'crack-sidewall',
      isoCode: '1012',
      length: { ...a2.length, valueMm: 8 }
    }),
    lee(a3, '1', { length: { ...a3.length, valueMm: 23 }, height: { ...a3.height, valueMm: 3.5 } }),
    lee(a5, '1', {
      derived: { ...a5.derived, scanStartMm: 214, scanEndMm: 226, depthTopMm: 6, depthBottomMm: 8 },
      defectType: 'slag',
      isoCode: '301',
      character: { value: null, alignedVolumetric: false, expertConfirmed: false }
    }),
    lee(a5, '9', {
      derived: { ...a5.derived, scanStartMm: 100, scanEndMm: 110, depthTopMm: 3, depthBottomMm: 4 },
      defectType: 'crack-center',
      isoCode: '1011',
      existenceConfidence: 'certain',
      character: { value: null, alignedVolumetric: false, expertConfirmed: false },
      length: { ...a5.length, valueMm: 10, method: 'eval-level' }
    }),
    lee(a2, 'U', {
      derived: { ...a2.derived, scanStartMm: 250, scanEndMm: 260, depthTopMm: 4, depthBottomMm: 5 },
      defectType: 'lof-root',
      isoCode: '4013',
      existenceConfidence: 'uncertain',
      location: { ...a2.location, side: null }
    })
  ]
  // 비결함 기록도 함께 (비교에서는 빠짐)
  for (const x of blind.records.filter((r) => r.kind !== 'defect')) records.push(lee(x, `n${x.externalRef ?? ''}`, {}))
  const intervals = blind.reviews.map((v) => ({
    ...v,
    uuid: stableUuid(`lee-l2|${v.uuid}`),
    labelerId: 'lee-l2',
    ...(v.sha256 === F4 && v.kind === 'reviewed' ? { scanEndMm: 250 } : {})
  }))
  return { records, intervals }
}

function x3Compare(unit: 'grouping' | 'record' = 'grouping'): CompareResult {
  const b = leeSet()
  return compareLabelSets({ records: blind.records, intervals: blind.reviews }, b, { alignments: blind.alignments, unit })
}

describe('X3 블라인드 2인 비교 (그룹 짓기 후 단위, 파일 틀, 검토 범위 = 교집합)', () => {
  it('픽스처 확인: A 9기록(결함 6), B 바꾼 기록이 스키마를 통과', () => {
    expect(blind.ok && reconciled.ok).toBe(true)
    expect(blind.records.filter((r) => r.kind === 'defect')).toHaveLength(6)
    for (const r of leeSet().records) expect(validateIndicationRecord(r).errors).toEqual([])
  })

  const r = x3Compare()

  it('두께(12 mm)는 파일 정렬에서, B 의 나눈 측벽 두 조각은 한 단위(길이 6 + 8 + 4 = 18)', () => {
    expect(r.context.thicknessBySha).toEqual({ [F1]: 12, [F2]: 12, [F3]: 12, [F4]: 12 })
    const p2 = r.rows[1]
    expect(p2?.b?.refs).toEqual(['2a', '2b'])
    expect(p2?.b?.item.lengthMm).toBe(18)
    expect(p2?.diff.length).toBe(0)
    expect(p2?.a?.fileNames).toEqual(['12T-SV-01-Cap on.nde'])
  })

  it('행 8개: 짝 4 · A 만 2(범위 밖 1, 참고 1) · B 만 2(오검출 1, 참고 1)', () => {
    expect(r.rows.map((x) => [x.id, x.frameKey.slice(5, 7), x.kind, x.outcome, x.a?.refs.join() ?? null, x.b?.refs.join() ?? null])).toEqual([
      ['P001', '01', 'pair', 'match', '1', '1'],
      ['P002', '01', 'pair', 'match', '2', '2a,2b'],
      ['P003', '01', 'only-b', 'reference', null, 'U'],
      ['P004', '02', 'pair', 'match', '1', '1'],
      ['P005', '03', 'only-a', 'outside-coverage', '1', null],
      ['P006', '03', 'only-a', 'reference', 'b0ecbed9', null],
      ['P007', '04', 'only-b', 'b-only', null, '9'],
      ['P008', '04', 'pair', 'match', '1', '1']
    ])
    expect(r.summary.counts).toMatchObject({ unitsA: 6, unitsB: 6, pairs: 4, countedPairs: 4, excludedA: 3, excludedB: 3 })
    expect(r.summary.outside).toEqual({ aOnly: 1, bOnly: 0, rowIds: ['P005'] })
  })

  it('지시 매칭: 재현율 4/4, 정밀도 4/5, F1 = 8/9, 검토 범위 밖 정답 1', () => {
    const d = r.summary.detection
    expect([d.hits, d.truthCounted, d.misses, d.missesOutsideCoverage, d.predCounted, d.falsePositives, d.truthReference]).toEqual([4, 4, 0, 1, 5, 1, 1])
    expect(d.f1).toBeCloseTo(8 / 9, 12)
    expect(d.precision.p).toBeCloseTo(0.8, 12)
    expect(r.summary.uncertainShare).toEqual({ uncertain: 0, total: 6, share: 0, exceedsCap: false })
    expect(r.summary.defectRecall.defects).toBe(0)
  })

  it('오차 (B − A): 스캔 중심 MAE 0.625 · 깊이 중심 0.15 · 길이 1.25 · 높이 0.75', () => {
    const e = r.summary.errors
    expect(e.scanCenter).toMatchObject({ n: 4, mae: 0.625, bias: 0.375, maxAbs: 2 })
    expect(e.scanCenter.p95Abs).toBeCloseTo(1.775, 12)
    expect(e.depthCenter.n).toBe(4)
    expect(e.depthCenter.mae).toBeCloseTo(0.15, 12)
    expect(e.length).toMatchObject({ n: 4, mae: 1.25, bias: 0.25 })
    expect(e.height).toMatchObject({ n: 2, mae: 0.75, bias: 0.75 })
    expect(e.heightSpec).toMatchObject({ n: 2, mae: 0.75 })
    expect(e.heightRef6db.n).toBe(0)
  })

  it('종류: 1단 [[3,1],[0,0]] 일치율 0.75 · κ = 0 (A 가 면상만 씀), 2단 일치율 0.5', () => {
    expect(r.summary.character.matrix).toEqual([
      [3, 1],
      [0, 0]
    ])
    expect(r.summary.character.agreement).toBe(0.75)
    expect(r.summary.character.kappa.kappa).toBeCloseTo(0, 12)
    expect(r.summary.proposalClass.agreement).toBe(0.5)
  })

  it('구간 단위: F1 0~300 + F4 0~250 → 15 + 13칸, 불확실만 걸린 칸 1개 뺌, κ = 240/267', () => {
    const g = r.summary.grading
    expect(r.summary.coverage).toMatchObject({ known: true, lengthMm: 550, frames: [`file:${F1}`, `file:${F4}`] })
    expect(g?.agreement).toMatchObject({ units: 28, used: 27, excludedReference: 1, excludedQuality: 0 })
    expect(g?.agreement.table).toEqual([
      [6, 0],
      [1, 20]
    ])
    expect(g?.agreement.kappa.kappa).toBeCloseTo(240 / 267, 12)
    expect(g?.agreement.negativesPerPositiveA).toBe(3.5)
  })

  it('기록 단위로 보면 나눈 조각 하나가 오검출: F1 = 0.8, 측벽 길이 차 −10', () => {
    const rr = x3Compare('record')
    expect(rr.summary.detection).toMatchObject({ hits: 4, falsePositives: 2 })
    expect(rr.summary.detection.f1).toBeCloseTo(0.8, 12)
    const p = rr.rows.find((x) => x.kind === 'pair' && x.a?.refs[0] === '2' && x.frameKey === `file:${F1}`)
    expect(p?.b?.refs).toEqual(['2b'])
    expect(p?.diff.length).toBe(-10)
  })

  it('민감도: X 5~15, Y 3·5 에서 결과가 흔들리지 않음 (짝이 모두 겹치고 깊이 차 < 0.4 mm)', () => {
    const grid = sensitivityGrid(r)
    expect(grid).toHaveLength(6)
    for (const g of grid) expect([g.indicationRecall.x, g.indicationRecall.n, g.falsePositives]).toEqual([4, 4, 1])
  })

  it('쌍 판정 표 CSV (부록 A) 와 보고서 CSV', () => {
    const csv = comparisonRowsCsv(r, { bom: false })
    const lines = csv.trimEnd().split('\r\n')
    expect(lines).toHaveLength(9)
    expect(lines[2]?.startsWith('P002,짝,짝 (셈함),12T-SV-01-Cap on.nde,kim-l2,2,lee-l2,2a · 2b,예,0,18,0,')).toBe(true)
    const rep = buildEvaluationReport({ comparison: r, sensitivity: sensitivityGrid(r) })
    expect(rep.header).toMatchObject({ name: '사람 간 일치도', welds: 2, specimens: 2, reviewedLengthM: 0.55, alignmentAssumed: false, unit: '그룹 짓기 후' })
    expect(rep.list.map((l) => [l.kind, l.rowId])).toEqual([['false-positive', 'P007']])
    const text = evaluationReportCsv(rep)
    expect(text.startsWith('﻿[머리]\r\n')).toBe(true)
    expect(text).toContain('\r\n무엇 대비,사람 간 일치도\r\n')
  })
})

describe('X3 확정 (Level III) + 설계값 대조 (결함정보 11건, 계층 무관 참고 비교)', () => {
  const cmp = x3Compare()
  const decisions: AdjudicationDecision[] = [
    { rowId: 'P001', choice: 'merge', fields: { position: 'a', length: 'b', height: 'b' } },
    { rowId: 'P002', choice: 'b', note: '두 조각이 맞음' },
    { rowId: 'P003', choice: 'neither' },
    { rowId: 'P004', choice: 'a' },
    { rowId: 'P005', choice: 'defer' },
    { rowId: 'P006', choice: 'a' },
    { rowId: 'P007', choice: 'neither' },
    { rowId: 'P008', choice: 'merge', fields: { position: 'b', type: 'a' } }
  ]
  const out = buildFinalSet({
    comparison: cmp,
    decisions,
    adjudicator: { labelerId: 'park-l3', qualification: 'UT Level III' },
    now: '2026-10-30T10:00:00+09:00',
    design: { defects: reconciled.physicalDefects, minTier: 'any' }
  })

  it('확정 기록 7건 · 검토 구간 5건, 모두 validate 통과, 결정적 UUID', () => {
    expect(out.complete).toBe(true)
    expect(out.records).toHaveLength(7)
    expect(out.records.map((x) => [x.sha256.slice(0, 2), x.derived.scanStartMm, x.adjudication.rowId, x.adjudication.decision])).toEqual([
      ['01', 30, 'P001', 'merge'],
      ['01', 126, 'P002', 'b'],
      ['01', 136, 'P002', 'b'],
      ['02', 149, 'P004', 'a'],
      ['03', 140, 'P005', 'defer'],
      ['03', 245, 'P006', 'a'],
      ['04', 214, 'P008', 'merge']
    ])
    for (const x of out.records) {
      const v = validateIndicationRecord(JSON.parse(JSON.stringify(x)))
      expect(v.errors).toEqual([])
      expect(v.ok).toBe(true)
    }
    expect(out.reviewIntervals.map((v) => [v.sha256.slice(0, 2), v.kind, v.groupId, v.scanStartMm, v.scanEndMm])).toEqual([
      ['01', 'reviewed', 0, 0, 300],
      ['01', 'reviewed', 1, 0, 300],
      ['02', 'quality-bad', null, 280, 300],
      ['03', 'below-threshold', 0, 100, 104],
      ['04', 'reviewed', null, 0, 250]
    ])
    for (const v of out.reviewIntervals) expect(validateReviewInterval(v).errors).toEqual([])
    const again = buildFinalSet({
      comparison: x3Compare(),
      decisions,
      adjudicator: { labelerId: 'park-l3', qualification: 'UT Level III' },
      now: '2026-10-30T10:00:00+09:00',
      design: { defects: reconciled.physicalDefects, minTier: 'any' }
    })
    expect(again.records.map((x) => x.uuid)).toEqual(out.records.map((x) => x.uuid))
    expect(out.labelSets.map((k) => k.sha256)).toEqual([F1, F2, F3, F4])
  })

  it('합침 값: P001 = A 위치 + B 길이·높이, P008 = B 위치 + A 종류(기공, 면상으로 적힌 그대로)', () => {
    const p1 = out.records.find((x) => x.adjudication.rowId === 'P001')
    expect([p1?.derived.scanStartMm, p1?.derived.scanEndMm, p1?.length.valueMm, p1?.height.valueMm, p1?.defectType]).toEqual([30, 46, 14, 3, 'crack-toe'])
    const p8 = out.records.find((x) => x.adjudication.rowId === 'P008')
    expect([p8?.derived.scanStartMm, p8?.derived.depthBottomMm, p8?.defectType, p8?.character.value, p8?.isoCode]).toEqual([214, 8, 'porosity-unspecified', 'planar', '200'])
    expect(out.records.find((x) => x.adjudication.rowId === 'P005')?.existenceConfidence).toBe('uncertain')
  })

  it('설계값 대조: 짝 6 · 미검출 5(범위 밖 2) · 추가 발견 0 · 종류 불일치 3, 물리 결함 단위 재현율 4/9', () => {
    const d = out.designCheck
    expect(d).not.toBeNull()
    expect(d?.summary).toMatchObject({
      defects: 11,
      countedDefects: 11,
      matched: 6,
      missed: 5,
      missedOutsideCoverage: 2,
      extra: 0,
      typeMismatches: 3,
      characterMismatches: 2,
      proposalClassMismatches: 2,
      idMismatches: 0
    })
    expect(d?.summary.recall.recall).toMatchObject({ x: 4, n: 9 })
    // 행은 용접부 틀 키(시편 ID 순) → 위치 순
    expect(d?.rows.filter((x) => x.status === 'missed').map((x) => [x.defectKey, x.outcome])).toEqual([
      ['PL23831/D1', 'a-only'],
      ['PL23833/D3', 'a-only'],
      ['PL23833/D4', 'a-only'],
      ['PL23840/D2', 'outside-coverage'],
      ['PL23841/D1', 'outside-coverage']
    ])
    expect(d?.rows.filter((x) => x.typeMismatch).map((x) => x.defectKey)).toEqual(['PL23831/D2', 'PL23833/D2', 'PL23841/D3'])
    expect(d?.warnings.some((w) => w.includes('정답 계층과 무관하게'))).toBe(true)
  })

  it('짝지어진 설계 결함 ID 를 확정 기록에 채움', () => {
    expect(out.records.map((x) => [x.adjudication.rowId, x.physicalDefectId, x.adjudication.designDefectKey])).toEqual([
      ['P001', 'D1', 'PL23833/D1'],
      ['P002', 'D2', 'PL23833/D2'],
      ['P002', 'D2', 'PL23833/D2'],
      ['P004', 'D1', 'PL23840/D1'],
      ['P005', 'D2', 'PL23841/D2'],
      ['P006', 'D3', 'PL23841/D3'],
      ['P008', 'D2', 'PL23831/D2']
    ])
  })
})
