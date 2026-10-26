/**
 * 전문가용 엑셀 기록 양식의 입력 검사 (칸 정의 단일 출처 = src/shared/labels/columns.ts).
 *
 * - 늘: 엑셀에서 쓸 수 있는 시트 이름·머리글인지, 드롭다운 값으로 코드를 되찾는지, 미리 채울 값(prefill_x3.json)이
 *   칸 정의·스키마 검사를 통과하는지 본다.
 * - 환경변수 PAUT_LABEL_COLUMNS_OUT=<json 경로> 가 있으면 칸 정의를 그 경로에 JSON 으로 쓴다.
 *   양식 생성기 scripts/label-template/make_template.py 가 이 JSON 을 읽는다 (scripts/label-template/README.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BOOL_LABEL,
  LABEL_COLUMNS,
  LABEL_SCHEMA_VERSION,
  LABEL_SHEETS,
  boolFromCell,
  columnId,
  columnsOf,
  enumCodeFromCell,
  findColumnByHeader,
  findSheetByName,
  newFileAlignment,
  newPhysicalDefect,
  normalizeCell,
  validateFileAlignment,
  validatePhysicalDefect,
  type LabelColumn,
  type LabelSheetId
} from '@shared/labels'
import { APP_ROOT } from '../paths'

// ───────────────────────────── JSON (생성기 입력) ─────────────────────────────

const COLUMNS_JSON_FORMAT = 'paut-label-columns'
/** 2: 칸마다 rule(입력 검사)·requiredWhen(조건부 필수), 시트마다 maxRows 를 더함 */
const COLUMNS_JSON_VERSION = 2

interface ColumnJson {
  /** 전체에서 유일 ('indication.scanStartMm') */
  id: string
  key: string
  header: string
  format: LabelColumn['format']
  required: boolean
  help: string
  enumTable: string | null
  enumValues: Array<{ code: string; label: string }>
  target: { entity: string; path: string; via: string | null } | null
  emptyValue: string | number | boolean | null
  appFilled: boolean
  rule: { min: number | null; max: number | null; int: boolean; atLeastKey: string | null; maxThicknessTimes: number | null } | null
  requiredWhen: { key: string; codes: string[]; fallback: string | null } | null
}

interface SheetJson {
  id: LabelSheetId
  name: string
  help: string
  maxRows: number | null
  columns: ColumnJson[]
}

interface ColumnsJson {
  format: typeof COLUMNS_JSON_FORMAT
  formatVersion: number
  labelSchemaVersion: number
  source: string
  boolLabels: { true: string; false: string }
  sheets: SheetJson[]
}

function columnJson(c: LabelColumn): ColumnJson {
  return {
    id: columnId(c),
    key: c.key,
    header: c.header,
    format: c.format,
    required: c.required,
    help: c.help,
    enumTable: c.enumTable,
    enumValues: c.enumValues.map((v) => ({ code: v.code, label: v.label })),
    target: c.target ? { entity: c.target.entity, path: c.target.path, via: c.target.via ?? null } : null,
    emptyValue: c.emptyValue ?? null,
    appFilled: c.appFilled ?? false,
    rule: c.rule
      ? {
          min: c.rule.min ?? null,
          max: c.rule.max ?? null,
          int: c.rule.int ?? false,
          atLeastKey: c.rule.atLeastKey ?? null,
          maxThicknessTimes: c.rule.maxThicknessTimes ?? null
        }
      : null,
    requiredWhen: c.requiredWhen
      ? { key: c.requiredWhen.key, codes: [...c.requiredWhen.codes], fallback: c.requiredWhen.fallback ?? null }
      : null
  }
}

/** 칸 정의 → 생성기 입력 JSON. 빠진 선택 칸은 null/false 로 채워 JSON 왕복에서 값이 사라지지 않게 한다 */
function buildColumnsJson(): ColumnsJson {
  return {
    format: COLUMNS_JSON_FORMAT,
    formatVersion: COLUMNS_JSON_VERSION,
    labelSchemaVersion: LABEL_SCHEMA_VERSION,
    source: 'app/src/shared/labels/columns.ts',
    boolLabels: { true: BOOL_LABEL.true, false: BOOL_LABEL.false },
    sheets: LABEL_SHEETS.map((s) => ({ id: s.id, name: s.name, help: s.help, maxRows: s.maxRows ?? null, columns: columnsOf(s.id).map(columnJson) }))
  }
}

// ───────────────────────────── 엑셀 제약 ─────────────────────────────

/** 생성기가 따로 만드는 시트 — 데이터 시트 이름과 겹치면 안 된다 */
const GENERATOR_SHEETS = ['안내', '목록']
/** 엑셀 시트 이름 상한·금지 문자 */
const SHEET_NAME_MAX = 31
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/
/** 머리글·드롭다운 값 글자 수 상한 (엑셀 목록 항목 255자) */
const CELL_TEXT_MAX = 255
/** 첫 열 = 다른 시트와 행을 잇는 열쇠 칸. 생성기는 첫 열을 고정한다 */
const FIRST_COLUMN: Record<LabelSheetId, string> = {
  reader: 'labelerId',
  file: 'fileName',
  indication: 'fileName',
  review: 'fileName',
  physical: 'specimenId',
  worktime: 'fileName'
}

describe('엑셀 기록 양식 칸 (columns.ts → 양식 생성기)', () => {
  it('데이터 시트 이름은 엑셀에서 쓸 수 있고, 생성기 시트(안내·목록)와 겹치지 않는다', () => {
    const names = LABEL_SHEETS.map((s) => s.name)
    for (const n of names) {
      expect(n.length, n).toBeGreaterThan(0)
      expect(n.length, n).toBeLessThanOrEqual(SHEET_NAME_MAX)
      expect(SHEET_NAME_FORBIDDEN.test(n), n).toBe(false)
      expect(n.startsWith("'") || n.endsWith("'"), n).toBe(false)
      expect(findSheetByName(n)?.name).toBe(n)
    }
    const all = [...names, ...GENERATOR_SHEETS].map(normalizeCell)
    expect(new Set(all).size).toBe(all.length)
  })

  it('시트마다 칸이 있고, 첫 열은 행을 잇는 열쇠 칸이며 필수다', () => {
    for (const s of LABEL_SHEETS) {
      const cols = columnsOf(s.id)
      expect(cols.length, s.name).toBeGreaterThan(0)
      expect(cols[0]?.key, s.name).toBe(FIRST_COLUMN[s.id])
      expect(cols[0]?.required, s.name).toBe(true)
    }
  })

  it('머리글은 한 줄 글자이고, 머리글(공백 차이 포함)로 같은 칸을 다시 찾는다', () => {
    for (const c of LABEL_COLUMNS) {
      const id = columnId(c)
      expect(c.header.trim(), id).toBe(c.header)
      expect(c.header.length, id).toBeLessThanOrEqual(CELL_TEXT_MAX)
      expect(/[\r\n\t]/.test(c.header), id).toBe(false)
      // = + - @ 로 시작하면 엑셀이 수식으로 읽는다
      expect(/^[=+\-@]/.test(c.header), id).toBe(false)
      expect(findColumnByHeader(c.sheet, c.header)?.key, id).toBe(c.key)
      expect(findColumnByHeader(c.sheet, ` ${c.header.replace(/ /g, '  ')} `)?.key, id).toBe(c.key)
    }
  })

  it('드롭다운 값(표시 이름)과 코드 모두로 같은 코드를 되찾는다', () => {
    const enums = LABEL_COLUMNS.filter((c) => c.format === 'enum')
    expect(enums.length).toBeGreaterThan(0)
    for (const c of enums) {
      const id = columnId(c)
      expect(c.enumTable, id).not.toBeNull()
      expect(c.enumValues.length, id).toBeGreaterThan(0)
      const labels = c.enumValues.map((v) => normalizeCell(v.label))
      expect(new Set(labels).size, id).toBe(labels.length)
      for (const v of c.enumValues) {
        expect(v.label.trim(), `${id} ${v.code}`).toBe(v.label)
        expect(v.label.length, `${id} ${v.code}`).toBeLessThanOrEqual(CELL_TEXT_MAX)
        expect(/^[=+\-@]/.test(v.label), `${id} ${v.label}`).toBe(false)
        expect(enumCodeFromCell(c, v.label), `${id} ${v.label}`).toBe(v.code)
        expect(enumCodeFromCell(c, v.code), `${id} ${v.code}`).toBe(v.code)
      }
    }
  })

  it('참/거짓 칸의 드롭다운 값(예·아니오)을 되찾는다', () => {
    expect(LABEL_COLUMNS.some((c) => c.format === 'bool')).toBe(true)
    expect(boolFromCell(BOOL_LABEL.true)).toBe(true)
    expect(boolFromCell(BOOL_LABEL.false)).toBe(false)
  })

  it('JSON 으로 바꿔도 값이 빠지지 않는다 (생성기 입력)', () => {
    const json = buildColumnsJson()
    expect(JSON.parse(JSON.stringify(json))).toEqual(json)
    expect(json.sheets.map((s) => s.name)).toEqual(LABEL_SHEETS.map((s) => s.name))
    expect(json.sheets.flatMap((s) => s.columns).map((c) => c.id)).toEqual(LABEL_COLUMNS.map(columnId))
    for (const s of json.sheets) {
      for (const c of s.columns) {
        const src = LABEL_COLUMNS.find((x) => columnId(x) === c.id)!
        expect(c.enumValues, c.id).toEqual(src.enumValues)
        expect(c.required, c.id).toBe(src.required)
        expect(c.rule?.atLeastKey ?? undefined, c.id).toBe(src.rule?.atLeastKey)
        expect(c.requiredWhen?.key ?? undefined, c.id).toBe(src.requiredWhen?.key)
      }
    }
  })

  it.runIf(Boolean(process.env['PAUT_LABEL_COLUMNS_OUT']))('PAUT_LABEL_COLUMNS_OUT 경로에 칸 정의 JSON 을 쓴다', () => {
    const out = resolve(process.env['PAUT_LABEL_COLUMNS_OUT']!)
    const json = buildColumnsJson()
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(json)
  })
})

// ───────────────────────────── 미리 채울 값 ─────────────────────────────

const PREFILL_PATH = resolve(APP_ROOT, 'scripts/label-template/prefill_x3.json')

type CellValue = string | number | boolean
interface PrefillFile {
  sheets: Partial<Record<LabelSheetId, Array<Record<string, CellValue | Record<string, unknown>>>>>
}

/** 행의 칸 값 (key 가 '_' 로 시작하면 메타데이터라 뺀다) */
function cellsOf(row: Record<string, unknown>): Array<[string, CellValue]> {
  return Object.entries(row).filter((e): e is [string, CellValue] => !e[0].startsWith('_'))
}

/** 'design.type' 같은 경로에 값 넣기 */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur = obj
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>
  cur[keys.at(-1)!] = value
}

describe('미리 채울 값 (prefill_x3.json)', () => {
  const prefill = JSON.parse(readFileSync(PREFILL_PATH, 'utf8')) as PrefillFile

  it('칸 key 는 그 시트에 있고, 열거 칸 값은 그 칸의 코드다', () => {
    for (const [sheetId, rows] of Object.entries(prefill.sheets) as Array<[LabelSheetId, PrefillFile['sheets'][LabelSheetId]]>) {
      expect(LABEL_SHEETS.some((s) => s.id === sheetId), sheetId).toBe(true)
      for (const row of rows ?? []) {
        for (const [key, value] of cellsOf(row)) {
          const col = columnsOf(sheetId).find((c) => c.key === key)
          expect(col, `${sheetId}.${key}`).toBeDefined()
          if (col?.format === 'enum') expect(col.enumValues.map((v) => v.code), `${sheetId}.${key}`).toContain(value)
          if (col?.format === 'number') expect(typeof value, `${sheetId}.${key}`).toBe('number')
        }
        // '_partial' 줄은 전문가가 채울 필수 칸(라벨러 ID 등)을 비워 둔 줄
        if (row['_partial'] === true) continue
        for (const c of columnsOf(sheetId).filter((x) => x.required)) expect(row[c.key], `${sheetId}.${c.key} (필수)`).toBeDefined()
      }
    }
  })

  it("'파일' 시트 값이 파일 정렬 검사를 통과한다", () => {
    const rows = prefill.sheets.file ?? []
    expect(rows.map((r) => r['fileName'])).toEqual(['12T-SV-01-Cap on.nde', '12T-SV-02-Cap on.nde', '12T-SV-03-Cap off.nde', '12T-SV-04-Cap on.nde'])
    for (const row of rows) {
      const a = newFileAlignment({ sha256: '0'.repeat(64), fileName: String(row['fileName']) }) as unknown as Record<string, unknown>
      for (const [key, value] of cellsOf(row)) {
        const col = columnsOf('file').find((c) => c.key === key)!
        if (col.target && !col.target.via) setPath(a, col.target.path, value)
        if (col.target?.via === 'signed-unit') setPath(a, col.target.path, Number(value))
      }
      const r = validateFileAlignment(a)
      expect(r.errors, String(row['fileName'])).toEqual([])
      expect(r.value?.thicknessMm).toBe(12)
      // X3 기준점은 확인 전 → 계획 7절 가설(스캔 0 = 판 끝, +1)을 '가설 정렬'로 채운다
      expect([r.value?.datumUMm, r.value?.direction, r.value?.alignmentAssumed]).toEqual([0, 1, true])
    }
  })

  it("'판독자' 시트는 지침서 버전만 채운 한 줄 (라벨러 ID·판독 단계는 전문가·생성기가 채움)", () => {
    const rows = prefill.sheets.reader ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.['_partial']).toBe(true)
    expect(rows[0]?.['guidelineVersion']).toBe('v1')
    expect(rows[0]?.['labelerId']).toBeUndefined()
  })

  it("'물리결함' 시트 값이 물리 결함 검사를 통과하고, 시편 ID 는 '파일' 시트에 있다", () => {
    const rows = prefill.sheets.physical ?? []
    expect(rows).toHaveLength(11)
    const specimens = new Set((prefill.sheets.file ?? []).map((r) => r['specimenId']))
    const keys = new Set<string>()
    for (const row of rows) {
      const p = newPhysicalDefect({ id: String(row['physicalDefectId']), specimenId: String(row['specimenId']) }) as unknown as Record<string, unknown>
      for (const [key, value] of cellsOf(row)) {
        const col = columnsOf('physical').find((c) => c.key === key)!
        if (col.target && !col.target.via) setPath(p, col.target.path, value)
      }
      const r = validatePhysicalDefect(p)
      expect(r.errors, String(row['physicalDefectId'])).toEqual([])
      expect(specimens.has(row['specimenId'])).toBe(true)
      keys.add(`${String(row['specimenId'])}|${String(row['physicalDefectId'])}`)
      // 결함정보.docx 는 출처·작성자 미확인 → 정답 계층을 주지 않고, 확인 수준도 '미확인'
      expect(r.value?.source).toBe('none')
      expect(r.value?.confirmation).toBe('unknown')
      expect(r.warnings, String(row['physicalDefectId'])).toEqual([])
      expect(r.value?.design.type, `${String(row['specimenId'])}/${String(row['physicalDefectId'])} 설계 종류`).not.toBeNull()
    }
    expect(keys.size).toBe(rows.length)
  })
})
