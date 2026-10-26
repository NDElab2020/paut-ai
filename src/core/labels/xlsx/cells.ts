/**
 * 셀 → 칸 형식(columns.ts format)에 맞는 값.
 *   text   → 글자 (NFC, 앞뒤 공백 제거. 숫자 셀은 가장 짧은 숫자 글자 '1', '12.5')
 *   number → 숫자 (글자 셀의 숫자도 받음. 날짜 서식 숫자는 오류 — 엑셀이 날짜로 바꾼 값)
 *   enum   → 코드 (표시 이름·코드 둘 다 받음 — codes.ts codeFromCell)
 *   bool   → 참/거짓 ('예'·'아니오'·참거짓 셀·1/0)
 *   time   → 한국 시간 ISO ('+09:00'). 날짜 일련번호(1904 체계 포함)·글자 시각 둘 다 받음
 * 빈 칸(값 없음·공백뿐)은 null.
 */
import { BOOL_LABEL, boolFromCell, enumCodeFromCell, type LabelColumn } from '@shared/labels'
import { excelSerialToDateText, excelSerialToKstIso, parseTimeText } from './time'
import type { XlsxCell } from './workbook'

export type CellValue = string | number | boolean

export interface CellRead {
  value: CellValue | null
  error?: string
  warning?: string
}

function nfcTrim(s: string): string {
  return s.normalize('NFC').trim()
}

/** 숫자 → 가장 짧은 글자 (부동소수 꼬리 '1.1000000000000001' → '1.1') */
export function numberText(n: number): string {
  return String(n)
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/** 글자 → 숫자. 유니코드 빼기(−)·앞 '+' 는 받고, 쉼표·단위는 받지 않는다 */
export function parseNumberText(text: string): number | null {
  const t = text.normalize('NFC').trim().replace(/^[−–]/, '-')
  if (!NUMBER_RE.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function shown(s: string): string {
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/** 날짜 서식 숫자를 사람이 읽는 글자로 ('2026-01-02' 또는 '2026-01-02 14:05') */
function dateShown(serial: number, date1904: boolean): string {
  if (Number.isInteger(serial)) return excelSerialToDateText(serial, date1904)
  return excelSerialToKstIso(serial, date1904).slice(0, 16).replace('T', ' ')
}

/** 셀 하나를 칸 형식으로 읽기 */
export function readCellAs(col: LabelColumn, cell: XlsxCell | undefined, date1904: boolean): CellRead {
  if (!cell) return { value: null }
  if (cell.type === 'error') return { value: null, error: `엑셀 오류 값입니다 (${cell.text}). 값을 다시 적습니다` }
  if (cell.type === 'string' && nfcTrim(cell.text) === '') return { value: null }
  switch (col.format) {
    case 'text': {
      if (cell.type === 'string' || cell.type === 'date-iso') return { value: nfcTrim(cell.text) }
      if (cell.type === 'bool') return { value: cell.bool ? BOOL_LABEL.true : BOOL_LABEL.false }
      const n = cell.number as number
      if (cell.dateFormat) {
        const d = dateShown(n, date1904)
        return { value: d, warning: `엑셀이 날짜로 바꾼 값입니다 (${d}). 원래 적은 글자인지 확인합니다` }
      }
      return { value: numberText(n) }
    }
    case 'number': {
      if (cell.type === 'number') {
        const n = cell.number as number
        if (cell.dateFormat) return { value: null, error: `엑셀이 날짜로 바꾼 값입니다 (${dateShown(n, date1904)}). 숫자로 다시 적습니다` }
        return { value: n }
      }
      if (cell.type === 'string') {
        const n = parseNumberText(cell.text)
        if (n === null) return { value: null, error: `숫자가 아닙니다 (받은 값: '${shown(nfcTrim(cell.text))}'). 단위는 빼고 숫자만 적습니다` }
        return { value: n }
      }
      return { value: null, error: `숫자가 아닙니다 (받은 값: ${shown(cell.text)})` }
    }
    case 'enum': {
      let text: string
      if (cell.type === 'bool') text = cell.bool ? BOOL_LABEL.true : BOOL_LABEL.false
      else if (cell.type === 'number') text = numberText(cell.number as number)
      else text = nfcTrim(cell.text)
      let code = enumCodeFromCell(col, text)
      // '+1' 을 숫자로 적으면 엑셀이 1 로 저장한다
      if (code === null && col.enumTable === 'SCAN_DIRECTION' && cell.type === 'number') {
        if (cell.number === 1) code = '+1'
        else if (cell.number === -1) code = '-1'
      }
      if (code === null) {
        return {
          value: null,
          error: `목록에 없는 값입니다 (받은 값: '${shown(text)}'. 고를 수 있는 값: ${col.enumValues.map((v) => v.label).join(' / ')})`
        }
      }
      return { value: code }
    }
    case 'bool': {
      if (cell.type === 'bool') return { value: cell.bool === true }
      if (cell.type === 'number' && !cell.dateFormat && (cell.number === 1 || cell.number === 0)) return { value: cell.number === 1 }
      const b = boolFromCell(cell.text)
      if (b === null) return { value: null, error: `'${BOOL_LABEL.true}' 또는 '${BOOL_LABEL.false}'를 적습니다 (받은 값: '${shown(nfcTrim(cell.text))}')` }
      return { value: b }
    }
    case 'time': {
      if (cell.type === 'number') {
        const n = cell.number as number
        if (n < 1) return { value: null, error: '날짜 없이 시각만 있습니다 (예: 2026-10-20 14:05 처럼 날짜와 함께 적습니다)' }
        return { value: excelSerialToKstIso(n, date1904) }
      }
      if (cell.type === 'string' || cell.type === 'date-iso') {
        const r = parseTimeText(cell.text)
        return r.ok ? { value: r.iso } : { value: null, error: `${r.reason} (받은 값: '${shown(nfcTrim(cell.text))}')` }
      }
      return { value: null, error: `날짜·시각이 아닙니다 (받은 값: ${shown(cell.text)})` }
    }
  }
}
