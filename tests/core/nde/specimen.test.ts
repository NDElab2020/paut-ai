import { describe, expect, it } from 'vitest'
import { matchRound, matchSpecimenId, matchStateTag, suggestSpecimen } from '@core/nde'
import { HAS_X3, X3_FILES, load } from './fixtures'

describe.skipIf(!HAS_X3)('X3 시편 제안', () => {
  it('장비 원본 파일명에서 PL 번호, 현재 파일명에서 Cap on/off', async () => {
    const got = []
    for (const p of X3_FILES) {
      const { raw, fileName } = await load(p)
      const g = suggestSpecimen(raw.meta, fileName)
      got.push([g.specimenId, g.source, g.stateTag])
    }
    expect(got).toEqual([
      ['PL23833', 'device-filename', 'Cap on'],
      ['PL23840', 'device-filename', 'Cap on'],
      ['PL23841', 'device-filename', 'Cap off'],
      ['PL23831', 'device-filename', 'Cap on']
    ])
  })

  it('CAP20 은 시편 ID 가 아니라 태그', async () => {
    const { raw, fileName } = await load(X3_FILES[0]!)
    const g = suggestSpecimen(raw.meta, fileName)
    expect(g.tags).toEqual(['CAP20'])
    expect(g.specimenId).not.toMatch(/CAP/i)
    expect(g.notes[0]).toContain('장비 원본 파일명')
  })
})

describe('파일명 규칙', () => {
  it('장비 원본 파일명 우선, 없으면 현재 파일명', () => {
    expect(suggestSpecimen({ deviceFileName: 'X-PL111-a' }, 'PL222.nde')).toMatchObject({ specimenId: 'PL111', source: 'device-filename' })
    expect(suggestSpecimen({ deviceFileName: null }, 'tp03_R2.nde')).toMatchObject({ specimenId: 'TP03', source: 'filename', round: 2 })
    expect(suggestSpecimen(null, 'Weld_Plate_UT-sk90-4.2.nde')).toMatchObject({ specimenId: null, source: null, stateTag: null })
  })

  it('시편 ID 패턴', () => {
    expect(matchSpecimenId('12T-SV-PL23833-i15-CAP20')).toBe('PL23833')
    expect(matchSpecimenId('pl-1234_scan')).toBe('PL1234')
    expect(matchSpecimenId('TP 07')).toBe('TP07')
    expect(matchSpecimenId('APL23833')).toBeNull()
    expect(matchSpecimenId('12T-SV-01-Cap on')).toBeNull()
  })

  it('상태 태그', () => {
    expect(matchStateTag('Cap on')).toEqual({ tag: 'Cap on', token: null })
    expect(matchStateTag('CAP OFF')).toEqual({ tag: 'Cap off', token: null })
    expect(matchStateTag('cap_off')).toEqual({ tag: 'Cap off', token: null })
    expect(matchStateTag('x-CAP20')).toEqual({ tag: 'Cap on', token: 'CAP20' })
    expect(matchStateTag('capture')).toBeNull()
  })

  it('파일명과 장비명 캡 상태가 다르면 현재 파일명을 따르고 알린다', () => {
    const g = suggestSpecimen({ deviceFileName: 'PL1-CAP OFF' }, 'PL1 Cap on.nde')
    expect(g.stateTag).toBe('Cap on')
    expect(g.stateTagSource).toBe('filename')
    expect(g.notes.join(' ')).toContain('현재 파일명을 따랐습니다')
  })

  it('회차·재스캔', () => {
    expect(matchRound('PL1_R3')).toEqual({ round: 3, rescan: true })
    expect(matchRound('PL1 2회차')).toEqual({ round: 2, rescan: true })
    expect(matchRound('PL1 rescan')).toEqual({ round: null, rescan: true })
    expect(matchRound('12T-SV-PL23841-i15-CAP OFF')).toEqual({ round: null, rescan: false })
    expect(suggestSpecimen(null, 'PL5 재스캔.nde').tags).toEqual(['재스캔'])
  })
})
