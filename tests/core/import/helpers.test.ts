import { describe, expect, it } from 'vitest'
import {
  applyNameTemplate,
  createPreviewStore,
  newBatchId,
  newPreviewId,
  suggestForItem,
  suggestRound,
  suggestSpecimenId,
  suggestStateTag
} from '@core/import'
import type { ImportPreview, ScanPlanSpec } from '@shared/types'

describe('가져오기 제안', () => {
  it('장비 원본 파일명의 PL 번호를 우선한다', () => {
    expect(suggestSpecimenId('12T-SV-PL23833-i15-CAP20', '12T-SV-01-Cap on.nde')).toEqual({ id: 'PL23833', source: 'device-filename' })
    expect(suggestSpecimenId(null, 'PL-123_scan.nde')).toEqual({ id: 'PL123', source: 'filename' })
    expect(suggestSpecimenId(null, 'ManualWeldPA.nde')).toBeNull()
  })

  it('상태 태그·회차는 주어진 순서대로 처음 찾은 값', () => {
    expect(suggestStateTag('12T-SV-03-Cap off', '12T-SV-PL23841-i15-CAP OFF')).toBe('Cap off')
    expect(suggestStateTag(null, '12T-SV-PL23833-i15-CAP20')).toBe('Cap on')
    expect(suggestStateTag('ManualWeldPA')).toBeNull()
    expect(suggestRound('PL1 R2', 'x')).toBe(2)
    expect(suggestRound('PL1')).toBeNull()
  })

  it('시편 ID 패턴이 없으면 파일명을 폴더에 쓸 수 있게 정리해 임시 제안', () => {
    const s = suggestForItem({ deviceFileName: null }, 'Weld:Plate?UT.nde')
    expect(s).toMatchObject({ specimenId: 'Weld_Plate_UT', specimenSource: 'filename' })
    const x3 = suggestForItem({ deviceFileName: '12T-SV-PL23841-i15-CAP OFF' }, '12T-SV-03-Cap off.nde')
    expect(x3).toMatchObject({ specimenId: 'PL23841', specimenSource: 'device-filename', stateTag: 'Cap off' })
  })
})

describe('ID·이름 규칙', () => {
  it('배치·미리보기 ID 형식', () => {
    const d = new Date(2026, 9, 2, 15, 30, 12)
    expect(newBatchId(d)).toMatch(/^IMP-20261002-153012-[0-9a-f]{4}$/)
    expect(newPreviewId(d)).toMatch(/^PV-20261002-153012-[0-9a-f]{6}$/)
    expect(newBatchId(d)).not.toBe(newBatchId(d))
  })

  it('플랜 이름 규칙', () => {
    const spec: ScanPlanSpec = {
      specVersion: 1,
      specimen: { shape: 'plate', thicknessMm: 12, outerRadiusMm: null, angularOpeningDeg: null, materialName: null, weld: null },
      groups: []
    }
    expect(applyNameTemplate('{id} {summary}', spec, '요약', 'SP007')).toBe('SP007 요약')
    expect(applyNameTemplate('{name}', spec, '요약', 'SP007')).toBe('12T')
    expect(applyNameTemplate('   ', spec, '요약', 'SP007')).toBe('12T')
  })
})

describe('미리보기 보관', () => {
  const pv = (id: string): ImportPreview => ({ previewId: id }) as ImportPreview

  it('TTL 이 지나면 사라진다', () => {
    let t = 0
    const store = createPreviewStore(1000, () => t)
    store.put(pv('a'))
    expect(store.get('a')?.previewId).toBe('a')
    t = 1500
    expect(store.get('a')).toBeNull()
  })

  it('오래된 것부터 8개까지만 보관', () => {
    const store = createPreviewStore()
    for (let i = 0; i < 10; i++) store.put(pv(`p${i}`))
    expect(store.get('p0')).toBeNull()
    expect(store.get('p1')).toBeNull()
    expect(store.get('p9')?.previewId).toBe('p9')
  })
})
