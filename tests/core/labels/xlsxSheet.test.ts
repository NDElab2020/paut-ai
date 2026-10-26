/** 시트 XML 읽기 (xml.ts · workbook.ts · time.ts · cells.ts): 공유 문자열, 셀 형식, 날짜 일련번호, 빈 칸, 병합 무시 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  XlsxError,
  columnLetter,
  columnNumber,
  excelSerialToKstIso,
  isDateFormatCode,
  parseNumberText,
  parseTimeText,
  parseXml,
  readCellAs,
  readXlsx,
  toKstIso,
  type XlsxCell
} from '@core/labels/xlsx'
import { columnsOf, type LabelColumn } from '@shared/labels'
import { buildXlsx, buildZip, fixture, serial } from './xlsxKit'

const col = (sheet: Parameters<typeof columnsOf>[0], key: string): LabelColumn => columnsOf(sheet).find((c) => c.key === key)!
const num = (n: number, dateFormat = false): XlsxCell => ({ type: 'number', text: String(n), number: n, bool: null, dateFormat })
const str = (s: string): XlsxCell => ({ type: 'string', text: s, number: null, bool: null, dateFormat: false })
const boo = (b: boolean): XlsxCell => ({ type: 'bool', text: b ? '1' : '0', number: null, bool: b, dateFormat: false })

describe('XML 읽기', () => {
  it('요소·속성·엔티티·CDATA·주석·접두사', () => {
    const x = parseXml(
      `<?xml version="1.0"?><!-- 머리 --><x:root xmlns:x="u" a="1 &amp; 2" b='&#x41;&#66;&lt;'><x:t>가 &gt; 나</x:t><![CDATA[<raw>&amp;]]><e/><f g="a>b"/></x:root>`,
      '시험'
    )
    expect(x.name).toBe('root')
    expect(x.attrs['a']).toBe('1 & 2')
    expect(x.attrs['b']).toBe('AB<')
    const kids = x.children.filter((c) => typeof c !== 'string')
    expect(kids.map((k) => (typeof k === 'string' ? '' : k.name))).toEqual(['t', 'e', 'f'])
    expect(x.children).toContain('<raw>&amp;')
    expect(typeof kids[2] !== 'string' && kids[2]!.attrs['g']).toBe('a>b')
  })

  it('\\r\\n 은 \\n 으로', () => {
    const x = parseXml('<a>1\r\n2</a>', '시험')
    expect(x.children).toEqual(['1\n2'])
  })

  it('형식이 틀리거나 DTD 가 있으면 오류', () => {
    for (const bad of ['<a><b></a>', '<a>', '<a/><b/>', 'text', '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', '<a b=1/>']) {
      expect(() => parseXml(bad, '시험'), bad).toThrow(XlsxError)
    }
  })
})

describe('시각', () => {
  it('엑셀 일련번호 → 한국 시간 ISO (초 반올림, 1904 체계)', () => {
    expect(excelSerialToKstIso(serial(2026, 10, 20, 14, 5), false)).toBe('2026-10-20T14:05:00+09:00')
    expect(excelSerialToKstIso(46315.5833333333, false)).toBe('2026-10-20T14:00:00+09:00')
    expect(excelSerialToKstIso(serial(2026, 10, 20, 14, 5) - 1462, true)).toBe('2026-10-20T14:05:00+09:00')
  })

  it('글자 시각', () => {
    expect(parseTimeText('2026-10-20 14:05')).toEqual({ ok: true, iso: '2026-10-20T14:05:00+09:00' })
    expect(parseTimeText(' 2026/10/20 9:05:30 ')).toEqual({ ok: true, iso: '2026-10-20T09:05:30+09:00' })
    expect(parseTimeText('2026-10-20T05:05:00Z')).toEqual({ ok: true, iso: '2026-10-20T14:05:00+09:00' })
    expect(parseTimeText('2026-10-20T14:05+09:00')).toEqual({ ok: true, iso: '2026-10-20T14:05:00+09:00' })
    expect(parseTimeText('2026-10-20').ok).toBe(false)
    expect(parseTimeText('2026-02-30 10:00').ok).toBe(false)
    expect(parseTimeText('2026-10-20 24:00').ok).toBe(false)
    expect(parseTimeText('어제').ok).toBe(false)
  })

  it('지금 시각 → 한국 시간', () => {
    expect(toKstIso(new Date('2026-10-21T16:30:00Z'))).toBe('2026-10-22T01:30:00+09:00')
  })
})

describe('셀 → 칸 형식', () => {
  it('글자 칸: 숫자는 가장 짧게, 날짜 서식 숫자는 경고', () => {
    const c = col('indication', 'externalRef')
    expect(readCellAs(c, num(1), false)).toEqual({ value: '1' })
    expect(readCellAs(c, num(1.1000000000000001), false)).toEqual({ value: '1.1' })
    expect(readCellAs(c, str('  C1 '), false)).toEqual({ value: 'C1' })
    expect(readCellAs(c, str('   '), false)).toEqual({ value: null })
    const d = readCellAs(c, num(serial(2026, 1, 2), true), false)
    expect(d.value).toBe('2026-01-02')
    expect(d.warning).toContain('날짜로 바꾼')
  })

  it('숫자 칸: 글자 숫자·유니코드 빼기 받음, 단위·쉼표·날짜 서식은 오류', () => {
    const c = col('indication', 'vMinMm')
    expect(readCellAs(c, num(-5.5), false)).toEqual({ value: -5.5 })
    expect(readCellAs(c, str('−8'), false)).toEqual({ value: -8 })
    expect(readCellAs(c, str('12.5'), false)).toEqual({ value: 12.5 })
    expect(readCellAs(c, str('12 mm'), false).error).toContain('숫자가 아닙니다')
    expect(readCellAs(c, str('1,5'), false).error).toContain('숫자가 아닙니다')
    expect(readCellAs(c, num(46000, true), false).error).toContain('날짜로 바꾼')
    expect(readCellAs(c, boo(true), false).error).toContain('숫자가 아닙니다')
    expect(parseNumberText('+3e2')).toBe(300)
  })

  it('열거 칸: 표시 이름·코드, +1 을 숫자로 적어도 받음', () => {
    expect(readCellAs(col('indication', 'kind'), str('형상 에코'), false)).toEqual({ value: 'geometric-echo' })
    expect(readCellAs(col('indication', 'kind'), str('defect'), false)).toEqual({ value: 'defect' })
    expect(readCellAs(col('indication', 'side'), str('왼쪽'), false)).toEqual({ value: 'L' })
    expect(readCellAs(col('file', 'direction'), num(1), false)).toEqual({ value: '+1' })
    expect(readCellAs(col('file', 'direction'), num(-1), false)).toEqual({ value: '-1' })
    const bad = readCellAs(col('indication', 'kind'), str('결함임'), false)
    expect(bad.value).toBeNull()
    expect(bad.error).toContain('결함 / 형상 에코 / 형상 불완전')
  })

  it('참거짓 칸', () => {
    const c = col('indication', 'saturated')
    expect(readCellAs(c, str('예'), false)).toEqual({ value: true })
    expect(readCellAs(c, str('아니오'), false)).toEqual({ value: false })
    expect(readCellAs(c, boo(true), false)).toEqual({ value: true })
    expect(readCellAs(c, num(0), false)).toEqual({ value: false })
    expect(readCellAs(c, str('글쎄'), false).error).toContain("'예' 또는 '아니오'")
  })

  it('시각 칸: 일련번호·글자, 시각만 있으면 오류', () => {
    const c = col('worktime', 'startedAt')
    expect(readCellAs(c, num(serial(2026, 10, 20, 14, 5), true), false)).toEqual({ value: '2026-10-20T14:05:00+09:00' })
    expect(readCellAs(c, str('2026-10-20 14:05'), false)).toEqual({ value: '2026-10-20T14:05:00+09:00' })
    expect(readCellAs(c, num(0.5), false).error).toContain('날짜 없이')
    expect(readCellAs(c, str('2026-10-20'), false).error).toContain('시각이 없습니다')
  })

  it('오류 셀은 오류', () => {
    const r = readCellAs(col('indication', 'vMinMm'), { type: 'error', text: '#N/A', number: null, bool: null, dateFormat: false }, false)
    expect(r.error).toContain('#N/A')
  })
})

describe('통합 문서 읽기', () => {
  it('열 글자 ↔ 번호', () => {
    expect(columnNumber('A')).toBe(1)
    expect(columnNumber('AL')).toBe(38)
    expect(columnLetter(38)).toBe('AL')
    expect(columnLetter(703)).toBe('AAA')
  })

  it('날짜 서식 판정', () => {
    expect(isDateFormatCode('yyyy\\-mm\\-dd\\ hh:mm')).toBe(true)
    expect(isDateFormatCode('[$-412]yyyy"년" m"월"')).toBe(true)
    expect(isDateFormatCode('0.00')).toBe(false)
    expect(isDateFormatCode('General')).toBe(false)
    expect(isDateFormatCode('"mm"0.0')).toBe(false)
    expect(isDateFormatCode('@')).toBe(false)
  })

  it('엑셀 방식 (공유 문자열·서식 있는 리치 텍스트·참거짓·오류·수식·날짜·인라인·병합·접두사)', () => {
    const buf = buildXlsx(
      [
        {
          name: '첫 시트',
          rows: [
            ['머리', 'B', null, '셋째'],
            [1.5, true, { error: '#DIV/0!' }, { formula: 'A2*2', cached: 3 }],
            [{ date: serial(2026, 10, 20, 14, 5) }, { date: serial(2026, 1, 2), fmt: 'date' }, { inline: '인라인 & 글자' }, { formula: 'A1', cached: '머리' }],
            [],
            ['줄\r바꿈', '  ', null, null]
          ]
        },
        { name: '숨김', rows: [['x']], state: 'hidden' }
      ],
      { prefix: true, rich: true, customProps: { 'paut.labelForm': 'v1' } }
    )
    const wb = readXlsx(buf)
    expect(wb.sheetNames).toEqual(['첫 시트', '숨김'])
    expect(wb.customProperties).toEqual({ 'paut.labelForm': 'v1' })
    expect(wb.date1904).toBe(false)
    const s = wb.sheet('첫 시트')!
    expect(s.rows.map((r) => r.row)).toEqual([1, 2, 3, 5])
    const r1 = s.rows[0]!.cells
    expect(r1.get(1)?.text).toBe('머리') // 리치 텍스트 두 조각 이음, 발음 표시 뺌
    expect(r1.has(3)).toBe(false) // 병합 범위의 둘째 칸은 빈 칸 그대로
    const r2 = s.rows[1]!.cells
    expect(r2.get(1)).toMatchObject({ type: 'number', number: 1.5, dateFormat: false })
    expect(r2.get(2)).toMatchObject({ type: 'bool', bool: true })
    expect(r2.get(3)).toMatchObject({ type: 'error', text: '#DIV/0!' })
    expect(r2.get(4)).toMatchObject({ type: 'number', number: 3 })
    const r3 = s.rows[2]!.cells
    expect(r3.get(1)).toMatchObject({ type: 'number', dateFormat: true })
    expect(r3.get(2)).toMatchObject({ type: 'number', dateFormat: true })
    expect(r3.get(3)).toMatchObject({ type: 'string', text: '인라인 & 글자' })
    expect(r3.get(4)).toMatchObject({ type: 'string', text: '머리' })
    expect(s.rows[3]!.cells.get(1)?.text).toBe('줄\r바꿈') // _x000D_
    expect(wb.sheet('숨김')?.state).toBe('hidden')
    expect(wb.sheet('없는 시트')).toBeNull()
  })

  it('1904 날짜 체계를 읽는다', () => {
    expect(readXlsx(buildXlsx([{ name: 'a', rows: [[1]] }], { date1904: true })).date1904).toBe(true)
  })

  it('openpyxl 양식 (인라인 문자열, 절대 경로 관계, 서식만 있는 빈 셀)', () => {
    const wb = readXlsx(readFileSync(fixture('x3_blind_kim.xlsx')))
    expect(wb.sheetNames).toEqual(['안내', '판독자', '파일', '지시', '검토구간', '물리결함', '작업시간', '목록'])
    const reader = wb.sheet('판독자')!
    expect(reader.rows.map((r) => r.row)).toEqual([1, 2])
    // E2·F2 는 서식만 있고 값이 없다 → 빈 칸. F2 는 픽스처가 'UT Level II' 를 채움
    expect(reader.rows[1]!.cells.get(1)?.text).toBe('kim-l2')
    expect(reader.rows[1]!.cells.has(5)).toBe(false)
    const wt = wb.sheet('작업시간')!
    const start = wt.rows[1]!.cells.get(2)!
    expect(start).toMatchObject({ type: 'number', dateFormat: true })
  })

  it('통합 문서가 아니면 오류', () => {
    expect(() => readXlsx(buildZip([{ name: 'word/document.xml', data: '<w/>' }]))).toThrow(/통합 문서가 아닙니다/)
  })
})
