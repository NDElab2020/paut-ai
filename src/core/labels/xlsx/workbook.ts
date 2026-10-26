/**
 * xlsx 통합 문서 읽기 (의존성 없음): 시트 목록, 셀 값, 문서 속성.
 *
 * - 부품 위치는 관계 파일(_rels)로 찾는다. 대상 경로는 절대('/xl/…', openpyxl)·상대('worksheets/…', 엑셀) 둘 다 받는다.
 * - 셀 형식: 숫자(n), 공유 문자열(s), 수식 결과 문자열(str), 인라인 문자열(inlineStr), 참거짓(b), 오류(e), ISO 날짜(d).
 *   수식은 저장된 결과값(v)만 쓴다. 값이 없는 셀(서식만 있는 칸)은 빈 칸이다.
 * - 셀 서식이 날짜·시각인지(dateFormat)를 styles.xml 로 판정한다. 날짜 일련번호 → 시각 변환은 time.ts.
 * - 병합 셀은 무시한다(병합 범위의 첫 칸에만 값이 있고 나머지는 빈 칸).
 * - 시트 XML 은 그 시트를 처음 요청할 때 읽는다.
 */
import { XlsxError } from './errors'
import { attr, childElements, firstChild, parseXml, textContent, type XmlElement } from './xml'
import { openZip, type ZipArchive } from './zip'

export type XlsxCellType = 'number' | 'string' | 'bool' | 'error' | 'date-iso'

export interface XlsxCell {
  type: XlsxCellType
  /** 원문. 숫자는 XML 에 저장된 글자 그대로('12.5'), 참거짓은 '1'/'0', 오류는 '#N/A' 등 */
  text: string
  /** type = 'number' 일 때 */
  number: number | null
  /** type = 'bool' 일 때 */
  bool: boolean | null
  /** 셀 서식이 날짜·시각 서식인지 */
  dateFormat: boolean
}

export interface XlsxRow {
  /** 엑셀 행 번호 (1부터) */
  row: number
  /** 열 번호(1부터) → 셀. 값이 있는 셀만 */
  cells: Map<number, XlsxCell>
}

export interface XlsxSheet {
  name: string
  state: 'visible' | 'hidden' | 'veryHidden'
  /** 값이 있는 행만, 행 번호 순서 */
  rows: XlsxRow[]
}

export interface XlsxWorkbook {
  /** 시트 이름 (탭 순서) */
  sheetNames: string[]
  /** 1904 날짜 체계 (옛 맥 엑셀) */
  date1904: boolean
  /** 사용자 지정 문서 속성 (docProps/custom.xml) */
  customProperties: Readonly<Record<string, string>>
  /** 시트 읽기. 없는 이름이면 null */
  sheet(name: string): XlsxSheet | null
}

const REL_OFFICE_DOCUMENT = /\/officeDocument$/
const REL_CUSTOM_PROPS = /\/custom-properties$/
const REL_WORKSHEET = /\/worksheet$/
const REL_SHARED_STRINGS = /\/sharedStrings$/
const REL_STYLES = /\/styles$/

/** 열 글자 → 번호 ('A' → 1, 'AB' → 28) */
export function columnNumber(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/** 열 번호 → 글자 (1 → 'A') */
export function columnLetter(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const r = (x - 1) % 26
    s = String.fromCharCode(65 + r) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

/** OOXML 글자의 '_xHHHH_' 이스케이프를 푼다 ('_x000D_' → '\r') */
export function decodeOoxmlEscapes(s: string): string {
  if (s.indexOf('_x') < 0) return s
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/** 경로 합치기 ('xl/' + '../docProps/x.xml') */
function joinPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (baseDir ? `${baseDir}/${target}` : target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

interface Relationship {
  id: string
  type: string
  target: string
}

/** 부품의 관계 목록 ('xl/workbook.xml' → 'xl/_rels/workbook.xml.rels'). 없으면 빈 목록 */
function relationships(zip: ZipArchive, partPath: string): Relationship[] {
  const dir = dirOf(partPath)
  const base = partPath.slice(dir.length ? dir.length + 1 : 0)
  const relsPath = `${dir ? dir + '/' : ''}_rels/${base}.rels`
  const text = zip.readText(relsPath)
  if (text === null) return []
  const root = parseXml(text, '관계 목록')
  const out: Relationship[] = []
  for (const r of childElements(root, 'Relationship')) {
    if (attr(r, 'TargetMode') === 'External') continue
    const id = attr(r, 'Id')
    const type = attr(r, 'Type')
    const target = attr(r, 'Target')
    if (id && type && target) out.push({ id, type, target: joinPath(dir, target) })
  }
  return out
}

/** 공유 문자열: si 마다 t + r/t (rPh 발음 표시는 뺌) */
function readSharedStrings(zip: ZipArchive, path: string | null): string[] {
  if (path === null) return []
  const text = zip.readText(path)
  if (text === null) return []
  const root = parseXml(text, '공유 문자열')
  return childElements(root, 'si').map(stringItem)
}

/** 문자열 항목(si 또는 is): 바로 아래 t 와 r 안의 t 를 잇는다 */
function stringItem(el: XmlElement): string {
  let s = ''
  for (const c of childElements(el)) {
    if (c.name === 't') s += textContent(c)
    else if (c.name === 'r') {
      const t = firstChild(c, 't')
      if (t) s += textContent(t)
    }
  }
  return decodeOoxmlEscapes(s)
}

/** 엑셀 내장 날짜·시각 서식 번호 (ECMA-376 18.8.30 + 동아시아 판) */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

/** 사용자 서식 글자가 날짜·시각인지: 따옴표·이스케이프·[색] 을 빼고 y m d h s 가 있는지 */
export function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '')
    .split(';')[0]!
  return /[ymdhs]/i.test(stripped) && !/^[#0.,%\s]*$/.test(stripped)
}

/** 셀 서식 번호(s) → 날짜 서식인지 */
function readDateStyles(zip: ZipArchive, path: string | null): boolean[] {
  if (path === null) return []
  const text = zip.readText(path)
  if (text === null) return []
  const root = parseXml(text, '서식')
  const custom = new Map<number, string>()
  const numFmts = firstChild(root, 'numFmts')
  if (numFmts) {
    for (const f of childElements(numFmts, 'numFmt')) {
      const id = Number(attr(f, 'numFmtId'))
      if (Number.isInteger(id)) custom.set(id, attr(f, 'formatCode') ?? '')
    }
  }
  const xfs = firstChild(root, 'cellXfs')
  if (!xfs) return []
  return childElements(xfs, 'xf').map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? '0')
    const code = custom.get(id)
    return code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE_FORMATS.has(id)
  })
}

function readCustomProperties(zip: ZipArchive, path: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (path === null) return out
  const text = zip.readText(path)
  if (text === null) return out
  const root = parseXml(text, '문서 속성')
  for (const p of childElements(root, 'property')) {
    const name = attr(p, 'name')
    const v = childElements(p)[0]
    if (name && v) Object.defineProperty(out, name, { value: textContent(v), enumerable: true, writable: true, configurable: true })
  }
  return out
}

const CELL_REF = /^([A-Za-z]{1,3})(\d+)$/

function readSheetRows(zip: ZipArchive, path: string, sheetName: string, shared: readonly string[], dateStyles: readonly boolean[]): XlsxRow[] {
  const text = zip.readText(path)
  if (text === null) throw new XlsxError('not-xlsx', `엑셀 파일 안에 '${sheetName}' 시트 내용이 없습니다.`, path)
  const root = parseXml(text, `'${sheetName}' 시트`)
  const data = firstChild(root, 'sheetData')
  if (!data) return []
  const rows: XlsxRow[] = []
  let lastRow = 0
  for (const r of childElements(data, 'row')) {
    const rAttr = attr(r, 'r')
    const rowNo = rAttr !== undefined && /^\d+$/.test(rAttr) ? Number(rAttr) : lastRow + 1
    lastRow = rowNo
    const cells = new Map<number, XlsxCell>()
    let lastCol = 0
    for (const c of childElements(r, 'c')) {
      const ref = attr(c, 'r')
      const m = ref !== undefined ? CELL_REF.exec(ref) : null
      const col = m ? columnNumber(m[1]!) : lastCol + 1
      lastCol = col
      const cell = readCell(c, shared, dateStyles, sheetName)
      if (cell) cells.set(col, cell)
    }
    if (cells.size > 0) rows.push({ row: rowNo, cells })
  }
  rows.sort((a, b) => a.row - b.row)
  return rows
}

function readCell(c: XmlElement, shared: readonly string[], dateStyles: readonly boolean[], sheetName: string): XlsxCell | null {
  const t = attr(c, 't') ?? 'n'
  const s = Number(attr(c, 's') ?? '0')
  const dateFormat = Number.isInteger(s) && dateStyles[s] === true
  const v = firstChild(c, 'v')
  const vText = v ? textContent(v) : null
  const make = (type: XlsxCellType, text: string, number: number | null = null, bool: boolean | null = null): XlsxCell => ({
    type,
    text,
    number,
    bool,
    dateFormat
  })
  switch (t) {
    case 's': {
      if (vText === null) return null
      const idx = Number(vText.trim())
      const str = Number.isInteger(idx) ? shared[idx] : undefined
      if (str === undefined) throw new XlsxError('corrupt', `'${sheetName}' 시트의 글자 칸이 공유 문자열 목록에 없습니다.`, `index ${vText}`)
      return make('string', str)
    }
    case 'inlineStr': {
      const is = firstChild(c, 'is')
      return is ? make('string', stringItem(is)) : null
    }
    case 'str':
      return vText === null ? null : make('string', decodeOoxmlEscapes(vText))
    case 'b':
      return vText === null ? null : make('bool', vText.trim(), null, vText.trim() === '1' || vText.trim().toLowerCase() === 'true')
    case 'e':
      return vText === null ? null : make('error', vText.trim())
    case 'd':
      return vText === null ? null : make('date-iso', vText.trim())
    default: {
      if (vText === null || vText.trim() === '') return null
      const num = Number(vText.trim())
      if (!Number.isFinite(num)) return make('string', vText)
      return make('number', vText.trim(), num)
    }
  }
}

/** xlsx 읽기. 손상·지원하지 않는 형식이면 XlsxError */
export function readXlsx(data: Uint8Array): XlsxWorkbook {
  const zip = openZip(data)
  const rootRels = relationships(zip, '')
  const wbPath = rootRels.find((r) => REL_OFFICE_DOCUMENT.test(r.type))?.target ?? (zip.has('xl/workbook.xml') ? 'xl/workbook.xml' : null)
  if (wbPath === null || !zip.has(wbPath)) {
    throw new XlsxError('not-xlsx', '엑셀 통합 문서가 아닙니다 (workbook.xml 이 없음). 워드·한글 파일이 아닌지 확인하세요.', zip.names().slice(0, 5).join(', '))
  }
  const wbText = zip.readText(wbPath)!
  const wb = parseXml(wbText, '통합 문서')
  const pr = firstChild(wb, 'workbookPr')
  const d1904 = pr ? attr(pr, 'date1904') : undefined
  const date1904 = d1904 === '1' || d1904 === 'true'
  const wbRels = relationships(zip, wbPath)
  const relById = new Map(wbRels.map((r) => [r.id, r]))
  const sharedPath = wbRels.find((r) => REL_SHARED_STRINGS.test(r.type))?.target ?? null
  const stylesPath = wbRels.find((r) => REL_STYLES.test(r.type))?.target ?? null
  const customPath = rootRels.find((r) => REL_CUSTOM_PROPS.test(r.type))?.target ?? (zip.has('docProps/custom.xml') ? 'docProps/custom.xml' : null)

  const sheetsEl = firstChild(wb, 'sheets')
  const sheetDefs: Array<{ name: string; state: XlsxSheet['state']; path: string | null }> = []
  for (const s of sheetsEl ? childElements(sheetsEl, 'sheet') : []) {
    const name = attr(s, 'name')
    if (name === undefined) continue
    const rid = attr(s, 'id')
    const rel = rid !== undefined ? relById.get(rid) : undefined
    const st = attr(s, 'state')
    const state: XlsxSheet['state'] = st === 'hidden' || st === 'veryHidden' ? st : 'visible'
    // 차트 시트 등 워크시트가 아닌 것은 내용 없이 둔다
    sheetDefs.push({ name, state, path: rel && REL_WORKSHEET.test(rel.type) ? rel.target : null })
  }

  let shared: string[] | null = null
  let dateStyles: boolean[] | null = null
  const cache = new Map<string, XlsxSheet>()
  const customProperties = readCustomProperties(zip, customPath)

  return {
    sheetNames: sheetDefs.map((s) => s.name),
    date1904,
    customProperties,
    sheet(name: string): XlsxSheet | null {
      const hit = cache.get(name)
      if (hit) return hit
      const def = sheetDefs.find((s) => s.name === name)
      if (!def) return null
      shared ??= readSharedStrings(zip, sharedPath)
      dateStyles ??= readDateStyles(zip, stylesPath)
      const rows = def.path === null ? [] : readSheetRows(zip, def.path, def.name, shared, dateStyles)
      const sheet: XlsxSheet = { name: def.name, state: def.state, rows }
      cache.set(name, sheet)
      return sheet
    }
  }
}
