/**
 * 라벨 엑셀 가져오기 테스트 도구: X3 문맥(가짜 sha256), ZIP·xlsx 만들기(엑셀처럼 공유 문자열을 쓰는 통합 문서).
 */
import { deflateRawSync } from 'node:zlib'
import { resolve } from 'node:path'
import { crc32, makeFileFinder, type LabelWorkbookContext, type LabelWorkbookFile, type LabelWorkbookGroup } from '@core/labels/xlsx'
import { APP_ROOT } from '../../paths'

export const FIXTURES = resolve(APP_ROOT, 'tests/fixtures/labels')
export const fixture = (name: string): string => resolve(FIXTURES, name)

/** X3 12T-SV 그룹 (실데이터 셋업 값: tests 의 실데이터 대조로 확인) */
export const X3_GROUPS: LabelWorkbookGroup[] = [
  { id: 0, name: 'Skew90', technique: 'pa-sectorial', skewDeg: 90, gainDb: 24.7, referenceGainDb: 18.7, referenceAmplitudePct: 80 },
  { id: 1, name: 'Skew270', technique: 'pa-sectorial', skewDeg: 270, gainDb: 20.4, referenceGainDb: 14.4, referenceAmplitudePct: 80 }
]

export interface X3Entry {
  fileName: string
  deviceFileName: string
  specimenId: string
  sha256: string
}

/** 가짜 sha256 (파일마다 다른 16진수 64자) */
export const X3: X3Entry[] = [
  { fileName: '12T-SV-01-Cap on.nde', deviceFileName: '12T-SV-PL23833-i15-CAP20', specimenId: 'PL23833', sha256: '01'.repeat(32) },
  { fileName: '12T-SV-02-Cap on.nde', deviceFileName: '12T-SV-PL23840-i15-CAP20', specimenId: 'PL23840', sha256: '02'.repeat(32) },
  { fileName: '12T-SV-03-Cap off.nde', deviceFileName: '12T-SV-PL23841-i15-CAP OFF', specimenId: 'PL23841', sha256: '03'.repeat(32) },
  { fileName: '12T-SV-04-Cap on.nde', deviceFileName: '12T-SV-PL23831-i15-CAP20', specimenId: 'PL23831', sha256: '04'.repeat(32) }
]

export const NOW = new Date('2026-10-22T01:00:00Z') // 한국 시간 10:00

export function x3Files(entries: readonly X3Entry[] = X3): Array<{ entry: X3Entry; file: LabelWorkbookFile }> {
  return entries.map((e) => ({
    entry: e,
    file: { sha256: e.sha256, fileName: e.fileName, groups: X3_GROUPS, thicknessMm: 12, specimenId: e.specimenId }
  }))
}

export function x3Context(over: Partial<LabelWorkbookContext> = {}, entries: readonly X3Entry[] = X3): LabelWorkbookContext {
  const finder = makeFileFinder(x3Files(entries).map(({ entry, file }) => ({ names: [entry.fileName, entry.deviceFileName], file })))
  return { findFiles: finder.findFiles, findFileBySha256: finder.findFileBySha256, pcId: 'pc-test', now: NOW, ...over }
}

// ───────────────────────────── ZIP 만들기 ─────────────────────────────

export interface ZipInput {
  name: string
  data: Buffer | string
  /** 0 = 저장, 8 = deflate (기본) */
  method?: 0 | 8
  /** 데이터 설명자(비트 3)를 쓰고 로컬 머리의 크기·CRC 를 0 으로 */
  descriptor?: boolean
}

/** 아주 단순한 ZIP 쓰기 (테스트용) */
export function buildZip(items: readonly ZipInput[], opts: { comment?: string; zip64Locator?: boolean } = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const it of items) {
    const raw = typeof it.data === 'string' ? Buffer.from(it.data, 'utf8') : it.data
    const method = it.method ?? 8
    const comp = method === 8 ? deflateRawSync(raw) : raw
    const crc = crc32(raw)
    const name = Buffer.from(it.name, 'utf8')
    const flags = 0x0800 | (it.descriptor ? 0x0008 : 0)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(it.descriptor ? 0 : crc, 14)
    lh.writeUInt32LE(it.descriptor ? 0 : comp.length, 18)
    lh.writeUInt32LE(it.descriptor ? 0 : raw.length, 22)
    lh.writeUInt16LE(name.length, 26)
    const parts = [lh, name, comp]
    if (it.descriptor) {
      const dd = Buffer.alloc(16)
      dd.writeUInt32LE(0x08074b50, 0)
      dd.writeUInt32LE(crc, 4)
      dd.writeUInt32LE(comp.length, 8)
      dd.writeUInt32LE(raw.length, 12)
      parts.push(dd)
    }
    const local = Buffer.concat(parts)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(raw.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([ch, name]))
    locals.push(local)
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const comment = Buffer.from(opts.comment ?? '', 'utf8')
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(items.length, 8)
  eocd.writeUInt16LE(items.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(comment.length, 20)
  const extra: Buffer[] = []
  if (opts.zip64Locator) {
    const loc = Buffer.alloc(20)
    loc.writeUInt32LE(0x07064b50, 0)
    extra.push(loc)
  }
  return Buffer.concat([...locals, cd, ...extra, eocd, comment])
}

// ───────────────────────────── xlsx 만들기 (엑셀 방식: 공유 문자열·상대 경로) ─────────────────────────────

export type KitCell =
  | string
  | number
  | boolean
  | null
  | { date: number; fmt?: 'date' | 'datetime' }
  | { error: string }
  | { inline: string }
  | { formula: string; cached: string | number }

export interface KitSheet {
  name: string
  rows: KitCell[][]
  state?: 'hidden'
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '_x000D_')

const colLetters = (n: number): string => {
  let s = ''
  let x = n
  while (x > 0) {
    const r = (x - 1) % 26
    s = String.fromCharCode(65 + r) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

/**
 * 엑셀이 저장하는 모양의 xlsx: 공유 문자열(sharedStrings.xml), 상대 경로 관계, 날짜 서식(styles.xml numFmt 164 = yyyy-mm-dd hh:mm),
 * 접두사 붙은 요소 이름(x:)을 옵션으로.
 */
export function buildXlsx(sheets: readonly KitSheet[], opts: { date1904?: boolean; prefix?: boolean; customProps?: Record<string, string>; rich?: boolean } = {}): Buffer {
  const shared: string[] = []
  const sharedIdx = new Map<string, number>()
  const sst = (s: string): number => {
    let i = sharedIdx.get(s)
    if (i === undefined) {
      i = shared.length
      shared.push(s)
      sharedIdx.set(s, i)
    }
    return i
  }
  const p = opts.prefix ? 'x:' : ''
  const ns = opts.prefix ? 'xmlns:x' : 'xmlns'
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows
      .map((row, ri) => {
        const cells = row
          .map((v, ci) => {
            const ref = `${colLetters(ci + 1)}${ri + 1}`
            if (v === null) return ''
            if (typeof v === 'string') return `<${p}c r="${ref}" t="s"><${p}v>${sst(v)}</${p}v></${p}c>`
            if (typeof v === 'number') return `<${p}c r="${ref}"><${p}v>${v}</${p}v></${p}c>`
            if (typeof v === 'boolean') return `<${p}c r="${ref}" t="b"><${p}v>${v ? 1 : 0}</${p}v></${p}c>`
            if ('date' in v) return `<${p}c r="${ref}" s="${v.fmt === 'date' ? 2 : 1}"><${p}v>${v.date}</${p}v></${p}c>`
            if ('error' in v) return `<${p}c r="${ref}" t="e"><${p}v>${esc(v.error)}</${p}v></${p}c>`
            if ('inline' in v) return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${esc(v.inline)}</${p}t></${p}is></${p}c>`
            const t = typeof v.cached === 'string' ? ' t="str"' : ''
            return `<${p}c r="${ref}"${t}><${p}f>${esc(v.formula)}</${p}f><${p}v>${esc(String(v.cached))}</${p}v></${p}c>`
          })
          .join('')
        return `<${p}row r="${ri + 1}">${cells}</${p}row>`
      })
      .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<${p}worksheet ${ns}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${p}sheetData>${rows}</${p}sheetData><${p}mergeCells count="1"><${p}mergeCell ref="A1:B1"/></${p}mergeCells></${p}worksheet>`
  })
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><workbookPr${opts.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`
  const n = sheets.length
  const wbRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}<Relationship Id="rId${n + 1}" Type="${R}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${n + 2}" Type="${R}/styles" Target="styles.xml"/></Relationships>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/>${
    opts.customProps ? `<Relationship Id="rId2" Type="${R}/custom-properties" Target="docProps/custom.xml"/>` : ''
  }</Relationships>`
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`
  const sharedXml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map((s) => {
      if (opts.rich && s.length > 1) {
        const h = Math.floor(s.length / 2)
        return `<si><r><t xml:space="preserve">${esc(s.slice(0, h))}</t></r><r><rPr><b/></rPr><t xml:space="preserve">${esc(s.slice(h))}</t></r><rPh sb="0" eb="1"><t>ふりがな</t></rPh></si>`
      }
      return `<si><t xml:space="preserve">${esc(s)}</t></si>`
    })
    .join('')}</sst>`
  const items: ZipInput[] = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: styles, method: 0 },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x, descriptor: i % 2 === 1 })),
    { name: 'xl/sharedStrings.xml', data: sharedXml }
  ]
  if (opts.customProps) {
    const props = Object.entries(opts.customProps)
      .map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(k)}"><vt:lpwstr>${esc(v)}</vt:lpwstr></property>`)
      .join('')
    items.push({
      name: 'docProps/custom.xml',
      data: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${props}</Properties>`
    })
  }
  return buildZip(items)
}

/** 엑셀 날짜 일련번호 (1900 체계) — 한국 시간 벽시계 값 그대로 */
export function serial(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return (Date.UTC(y, mo - 1, d, h, mi) / 86_400_000) + 25_569
}
