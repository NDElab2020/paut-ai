/**
 * 지시 표 고른 기록 아래 '분류'·'정답'·'겹침' 줄 (AI 개발 플랜 T2). 서버 렌더로 글자만 본다.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { newIndicationRecord, newPhysicalDefect, recordTaxonomy, type IndicationRecord } from '@shared/labels'
import { IndicationTable, hierarchyText, truthText, type IndicationTableProps } from '../../src/renderer/src/labeling/IndicationTable'

const SHA = 'b'.repeat(64)
const rec = (i: number, over: Partial<IndicationRecord>): IndicationRecord =>
  newIndicationRecord({
    uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    sha256: SHA,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    readingStage: 'reconciled',
    kind: 'defect',
    defectType: 'crack-root',
    externalRef: `C${i}`,
    derived: { scanStartMm: 50 + i, scanEndMm: 80, vMinMm: -2, vMaxMm: 1, depthTopMm: 9, depthBottomMm: 12, coordRulesVersion: 1 },
    ...over
  })

function render(p: Partial<IndicationTableProps>, records: IndicationRecord[]): string {
  const props: IndicationTableProps = {
    records,
    numbers: new Map(records.map((r) => [r.uuid, r.externalRef ?? '?'])),
    selectedUuid: records[0]!.uuid,
    editingUuid: null,
    groups: new Map(),
    groupName: () => 'GR-1',
    onSelect: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onSnapshot: () => undefined,
    hasSnapshot: () => false,
    observations: null,
    observationNote: null,
    onObserve: () => undefined,
    onConfirmGroup: () => undefined,
    busy: false,
    loading: false,
    ...p
  }
  return renderToStaticMarkup(createElement(IndicationTable, props)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

describe('지시 표 분류·정답·겹침 줄', () => {
  const a = rec(1, { physicalDefectId: 'D1' })
  const b = rec(2, { kind: 'geometric-echo', defectType: null, geometricEcho: { kind: 'root', fromSuggestion: false } })

  it('물리 결함(데이터시트)이 같으면 근거 C 확정, 겹치는 기록 번호', () => {
    const d1 = newPhysicalDefect({ id: 'D1', specimenId: 'TF_01', design: { type: 'crack-toe' }, source: 'manufacturer-report' })
    const t = render({ physicalDefects: [d1] }, [a, b])
    expect(t).toContain('분류 결함 › 면상 › 균열')
    expect(t).toContain('정답 근거 C 데이터시트·판독 일치 · 확정 — 판독 균열 = 데이터시트 균열')
    expect(t).toContain('겹침 #C2')
  })

  it('블라인드처럼 물리 결함이 없으면 판독만 D, 다르면 미확정', () => {
    expect(render({}, [a])).toContain('정답 근거 D 판독만 · 판독만')
    const slag = newPhysicalDefect({ id: 'D1', specimenId: 'TF_01', design: { type: 'slag' }, source: 'manufacturer-report' })
    expect(render({ physicalDefects: [slag] }, [a])).toContain('정답 미확정 — 판독 균열 ≠ 데이터시트 슬래그')
    expect(render({}, [a])).not.toContain('겹침')
  })

  it('비결함 기록은 분류만 (정답 줄 없음)', () => {
    const t = render({ selectedUuid: b.uuid }, [a, b])
    expect(t).toContain('분류 비결함')
    expect(t).not.toContain('정답')
    expect(hierarchyText(recordTaxonomy(rec(3, { defectType: 'volumetric-presumed' })))).toBe('결함 › 체적 › 5종 미정')
    expect(truthText(recordTaxonomy(b))).toBe('해당 없음 — 비결함 기록')
  })
})
