/**
 * 계층 종류 · 근거 등급 · 정답 판정 · 겹침 (shared/labels/taxonomy.ts, AI 개발 플랜 T2·D3).
 * 규칙 문서 계획_AI개발/T2_계층종류_근거등급_규칙.md 의 표를 그대로 시험한다 (Python 쪽도 같은 표로 맞춤).
 */
import { describe, expect, it } from 'vitest'
import {
  METALLURGICAL_TYPE,
  boxesOverlap,
  l1Of,
  l2Of,
  newIndicationRecord,
  newPhysicalDefect,
  overlapMap,
  recordTaxonomy,
  type IndicationRecord,
  type MetallurgicalType,
  type PhysicalDefect
} from '@shared/labels'

const SHA = 'a'.repeat(64)
let n = 0
function rec(over: Omit<Partial<IndicationRecord>, 'derived'> & { derived?: Partial<IndicationRecord['derived']> } = {}): IndicationRecord {
  n++
  const { derived, ...rest } = over
  return newIndicationRecord({
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    sha256: SHA,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    kind: 'defect',
    defectType: 'crack-root',
    derived: { scanStartMm: 0, scanEndMm: 10, vMinMm: -2, vMaxMm: 2, depthTopMm: 8, depthBottomMm: 11, coordRulesVersion: 1, ...derived },
    ...rest
  })
}
const pd = (id: string, type: MetallurgicalType | null, source: PhysicalDefect['source'], confirmation: PhysicalDefect['confirmation'], deleted = false) =>
  newPhysicalDefect({ id, specimenId: 'TF_01', design: { type }, source, confirmation, deleted })

describe('계층 종류 L0/L1/L2', () => {
  it('모든 금속학적 종류가 5종·면상/체적으로 간다 (추정 둘만 5종 없음)', () => {
    const got = Object.keys(METALLURGICAL_TYPE).map((t) => [t, l1Of(t as MetallurgicalType), l2Of(t as MetallurgicalType)])
    expect(got).toEqual([
      ['crack-root', 'planar', 'crack'],
      ['crack-toe', 'planar', 'crack'],
      ['crack-sidewall', 'planar', 'crack'],
      ['crack-center', 'planar', 'crack'],
      ['crack-unspecified', 'planar', 'crack'],
      ['lof-sidewall', 'planar', 'lof'],
      ['lof-root', 'planar', 'lof'],
      ['lof-interrun', 'planar', 'lof'],
      ['lof-unspecified', 'planar', 'lof'],
      ['incomplete-penetration', 'planar', 'ip'],
      ['slag', 'volumetric', 'slag'],
      ['porosity-single', 'volumetric', 'porosity'],
      ['porosity-cluster', 'volumetric', 'porosity'],
      ['porosity-unspecified', 'volumetric', 'porosity'],
      ['planar-presumed', 'planar', null],
      ['volumetric-presumed', 'volumetric', null]
    ])
  })

  it('판정 특성 칸이 있으면 L1 은 그 값 (일렬 체적 → 면상 전환)', () => {
    const t = recordTaxonomy(rec({ defectType: 'porosity-cluster', character: { value: 'planar', alignedVolumetric: true, expertConfirmed: true } }))
    expect(t.reading).toEqual({ l1: 'planar', l2: 'porosity' })
  })

  it('형상 에코·형상 불완전은 비결함, 정답 해당 없음', () => {
    for (const kind of ['geometric-echo', 'geometric-imperfection'] as const) {
      const t = recordTaxonomy(rec({ kind, defectType: null }), [pd('D1', 'slag', 'manufacturer-report', 'unknown')])
      expect(t).toMatchObject({ l0: 'non-defect', status: 'not-applicable', grade: null, truth: { l1: null, l2: null } })
    }
  })
})

describe('정답 판정 (D3) · 근거 등급', () => {
  const cases: Array<[string, MetallurgicalType, PhysicalDefect | null, string, string | null, string | null]> = [
    // 이름, 판독 종류, 물리 결함, 상태, 등급, 정답 5종
    ['물리 결함 없음 → 판독만 D', 'slag', null, 'reading-only', 'D', 'slag'],
    ['설계값 종류 없음 → 판독만 D', 'slag', pd('D1', null, 'manufacturer-report', 'unknown'), 'reading-only', 'D', 'slag'],
    ['데이터시트 일치 → C 확정 (세부 달라도 5종 같으면)', 'crack-toe', pd('D1', 'crack-root', 'manufacturer-report', 'fabrication-record'), 'confirmed', 'C', 'crack'],
    ['설계도 일치 → C', 'lof-sidewall', pd('D1', 'lof-unspecified', 'design-drawing', 'design-only'), 'confirmed', 'C', 'lof'],
    ['데이터시트 불일치 → 미확정', 'crack-root', pd('D1', 'slag', 'manufacturer-report', 'unknown'), 'undetermined', null, null],
    ['RT 일치 → B', 'porosity-single', pd('D1', 'porosity-cluster', 'pcn-sheet', 'rt'), 'confirmed', 'B', 'porosity'],
    ['RT 불일치 → 미확정', 'lof-root', pd('D1', 'incomplete-penetration', 'manufacturer-report', 'rt'), 'undetermined', null, null],
    ['절단 → A, 판독과 달라도 설계값이 정답', 'crack-root', pd('D1', 'slag', 'manufacturer-report', 'sectioning'), 'confirmed', 'A', 'slag'],
    ['PCN 시트(다른 1인 판독)만 → 판독만 D', 'slag', pd('D1', 'crack-root', 'pcn-sheet', 'unknown'), 'reading-only', 'D', 'slag']
  ]
  it.each(cases)('%s', (_name, type, defect, status, grade, truthL2) => {
    const t = recordTaxonomy(rec({ defectType: type, physicalDefectId: defect ? 'D1' : null }), defect ? [defect] : [])
    expect([t.status, t.grade, t.truth.l2]).toEqual([status, grade, truthL2])
    expect(t.reason.length).toBeGreaterThan(0)
  })

  it('판독이 5종 미정이면 5종은 미확정, 면상·체적이 같으면 L1 만 확정', () => {
    const d = pd('D1', 'crack-root', 'manufacturer-report', 'unknown')
    const same = recordTaxonomy(rec({ defectType: 'planar-presumed', physicalDefectId: 'D1' }), [d])
    expect(same).toMatchObject({ status: 'undetermined', grade: null, truth: { l1: 'planar', l2: null } })
    expect(same.reason).toContain('면상·체적만 일치')
    const diff = recordTaxonomy(rec({ defectType: 'volumetric-presumed', physicalDefectId: 'D1' }), [d])
    expect(diff).toMatchObject({ status: 'undetermined', truth: { l1: null, l2: null } })
  })

  it('지운 물리 결함·다른 ID 는 연결하지 않는다', () => {
    const t = recordTaxonomy(rec({ defectType: 'slag', physicalDefectId: 'D1' }), [pd('D1', 'slag', 'manufacturer-report', 'unknown', true), pd('D2', 'slag', 'manufacturer-report', 'unknown')])
    expect(t).toMatchObject({ status: 'reading-only', grade: 'D', datasheet: null })
  })
})

describe('겹침', () => {
  it('스캔은 길이 > 0 으로 겹쳐야 하고, V·깊이는 모르면 겹친 것으로 본다', () => {
    const a = rec({ derived: { scanStartMm: 0, scanEndMm: 10 } })
    const touch = rec({ derived: { scanStartMm: 10, scanEndMm: 20 } })
    const inside = rec({ derived: { scanStartMm: 4, scanEndMm: 6, vMinMm: -1, vMaxMm: 1, depthTopMm: 9, depthBottomMm: 10 } })
    const deeper = rec({ derived: { scanStartMm: 4, scanEndMm: 6, depthTopMm: 11.5, depthBottomMm: 12 } })
    const excel = rec({ derived: { scanStartMm: 5, scanEndMm: 30, vMinMm: null, vMaxMm: null, depthTopMm: null, depthBottomMm: null } })
    expect(boxesOverlap(a, touch)).toBe(false)
    expect(boxesOverlap(a, inside)).toBe(true)
    expect(boxesOverlap(a, deeper)).toBe(false)
    expect(boxesOverlap(a, excel)).toBe(true)
    const gone = rec({ deleted: true, derived: { scanStartMm: 0, scanEndMm: 10 } })
    const m = overlapMap([touch, excel, a, inside, deeper, gone])
    expect(m.get(a.uuid)?.sort()).toEqual([inside.uuid, excel.uuid].sort())
    expect(m.get(touch.uuid)).toEqual([excel.uuid])
    expect(m.has(gone.uuid)).toBe(false)
    expect(m.get(deeper.uuid)).toEqual([excel.uuid])
  })
})
