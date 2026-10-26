/**
 * 전문가 엑셀(기록양식 v1) → 라벨 기록. 저장은 하지 않는다(부르는 쪽이 ok 일 때 저장).
 *
 * 칸의 뜻은 columns.ts(target·via·requiredWhen·rule·appFilled·emptyValue)를 단일 출처로 쓴다.
 * columns.ts 머리 주석의 '1a 가져오기 규칙':
 * - sheet-meta: '판독자' 시트 한 줄이 이 엑셀의 모든 지시·검토구간·작업시간 줄에 붙는다. 라벨러 ID·판독 단계가 비면 막는다.
 * - scan-group: '섹토리얼 Skew 90' → 그 파일에서 기법·스큐가 같은 그룹 id. 없으면 오류, 둘 이상이면 물음(groupQuestions) + 오류.
 * - requiredWhen: 조건에서 비면 fallback 이 있으면 그 값 + 경고, 없으면 경고만 하고 스키마 검사(validate.ts)가 판정한다.
 * - 'Ref 대비 (dB, 앱 계산)'·평가/기록 기준 초과는 levels.ts 로 앱이 계산한다(대조 전: refDbVerified = false). 엑셀 값은 쓰지 않는다.
 * - 판독 단계가 대조·확정이면 knowledge.designValueSeen = true.
 * - 작업시간 한 줄 → 작업 이벤트(파일 열기·닫기, 보고서·라벨 추가 작업·쉰 시간). 시각은 한국 시간 '+09:00'.
 * - UUID 는 (파일 sha256, 라벨러, 지침서 버전, 판독 단계, 지시 번호 …) 에서 만든 결정적 UUID 라 같은 엑셀을 다시 가져와도 같다.
 *   versions = [{ pcId, edits: 1 }], revision = 1.
 * 그 밖에:
 * - 시트 이름·머리글이 양식(columns.ts)과 다르면 오류(칸 위치를 믿을 수 없음). 문서 속성의 칸 지문이 다르면 경고.
 * - 빈 행은 건너뛴다. 오류·경고에는 시트·행·칸 위치를 붙인다. 오류가 난 줄은 결과에 넣지 않는다.
 * - 결과 기록은 모두 validate.ts 검사를 통과한 값이다.
 */
import {
  GEOMETRIC_IMPERFECTION_ISO,
  LABEL_SCHEMA_VERSION,
  LABEL_SHEETS,
  METALLURGICAL_TYPE_INFO,
  READING_STAGE,
  SCAN_GROUP,
  amplitudeLevels,
  columnsOf,
  fieldAt,
  labelOf,
  labelSetId,
  newFileAlignment,
  newIndicationRecord,
  newLabelExport,
  newPhysicalDefect,
  newReviewInterval,
  newWorkEvent,
  normalizeCell,
  parseLabelExport,
  refPctFromSetup,
  validateFileAlignment,
  validateIndicationRecord,
  validatePhysicalDefect,
  validateReviewInterval,
  validateWorkEvent,
  type ColumnVia,
  type FileAlignment,
  type IndicationRecord,
  type LabelCheckResult,
  type LabelColumn,
  type LabelEntity,
  type LabelSetKey,
  type LabelSheet,
  type LabelSheetId,
  type PhysicalDefect,
  type ReaderSource,
  type ReadingStage,
  type ReviewInterval,
  type ScanGroupCode,
  type VersionEntry,
  type WorkEvent,
  type WorkEventKind,
  type WorkTool
} from '@shared/labels'
import { readCellAs, type CellValue } from './cells'
import { XlsxError } from './errors'
import { fileNameKey, groupTechniqueOf, sameSkew } from './files'
import { labelColumnsFingerprint } from './fingerprint'
import { minutesBetween, toKstIso } from './time'
import type { FileQuestion, GroupQuestion, ImportedReader, LabelFormInfo, LabelWorkbookContext, LabelWorkbookFile, LabelWorkbookImport } from './types'
import { stableUuid, uuidKey } from './uuid'
import { columnLetter, readXlsx, type XlsxRow, type XlsxSheet, type XlsxWorkbook } from './workbook'

// ───────────────────────────── 위치·문구 ─────────────────────────────

/** 시트 정의 */
function sheetDef(id: LabelSheetId): LabelSheet {
  return LABEL_SHEETS.find((s) => s.id === id)!
}

function colOf(sheetId: LabelSheetId, key: string): LabelColumn {
  const c = columnsOf(sheetId).find((x) => x.key === key)
  if (!c) throw new Error(`columns.ts 에 '${sheetId}.${key}' 칸이 없습니다 (가져오기 코드와 칸 정의를 함께 고쳐야 함)`)
  return c
}

/** via 로 칸 찾기 (작업시간 시트) */
function colByVia(sheetId: LabelSheetId, via: ColumnVia): LabelColumn {
  const c = columnsOf(sheetId).find((x) => x.target?.via === via)
  if (!c) throw new Error(`columns.ts '${sheetId}' 시트에 via '${via}' 칸이 없습니다`)
  return c
}

function whereText(sheet: LabelSheet, row?: number, col?: LabelColumn): string {
  let s = `'${sheet.name}' 시트`
  if (row !== undefined) s += ` ${row}행`
  if (col) s += ` ${columnLetter(columnsOf(sheet.id).indexOf(col) + 1)}열 '${col.header}'`
  return s
}

/** 한 줄의 오류·경고. 오류가 있으면 그 줄의 경고는 버린다(줄을 가져오지 않으므로) */
class RowCtx {
  readonly errs: string[] = []
  readonly warns: string[] = []
  constructor(
    readonly sheet: LabelSheet,
    readonly row: number
  ) {}
  where(col?: LabelColumn): string {
    return whereText(this.sheet, this.row, col)
  }
  error(msg: string, col?: LabelColumn): void {
    this.errs.push(`${this.where(col)}: ${msg}`)
  }
  warn(msg: string, col?: LabelColumn): void {
    this.warns.push(`${this.where(col)}: ${msg}`)
  }
  get failed(): boolean {
    return this.errs.length > 0
  }
}

class Out {
  readonly errors: string[] = []
  readonly warnings: string[] = []
  /** errors 가운데 물음(그룹·파일)에서 난 것 */
  questionErrors = 0
  finish(rc: RowCtx): boolean {
    if (rc.failed) {
      this.errors.push(...rc.errs)
      return false
    }
    this.warnings.push(...rc.warns)
    return true
  }
}

// ───────────────────────────── 줄 읽기 ─────────────────────────────

interface ParsedRow {
  row: number
  values: Map<string, CellValue>
  rc: RowCtx
}

/** 시트 머리글 검사 (1행 = columns.ts 머리글, 같은 순서). 다르면 오류를 남기고 false. 뒤에 더 붙은 칸은 경고만 */
function checkHeader(sheet: LabelSheet, xs: XlsxSheet, out: Out): boolean {
  const cols = columnsOf(sheet.id)
  const header = xs.rows.find((r) => r.row === 1)
  if (!header) {
    out.errors.push(`${whereText(sheet, 1)}: 머리글 줄이 없습니다. 양식(기록양식 v1)의 시트를 그대로 씁니다`)
    return false
  }
  let ok = true
  cols.forEach((c, i) => {
    const cell = header.cells.get(i + 1)
    const got = cell ? cell.text.normalize('NFC').trim() : ''
    if (normalizeCell(got) !== normalizeCell(c.header)) {
      ok = false
      out.errors.push(
        `${whereText(sheet, 1)} ${columnLetter(i + 1)}열: 머리글이 양식과 다릅니다 (받은 값: '${got}', 양식: '${c.header}'). 머리글 글자·순서를 바꾸지 않습니다`
      )
    }
  })
  const extra = [...header.cells.entries()]
    .filter(([n, cell]) => n > cols.length && cell.text.trim() !== '')
    .map(([n, cell]) => `${columnLetter(n)}열 '${cell.text.trim()}'`)
  if (extra.length > 0) out.warnings.push(`${whereText(sheet, 1)}: 양식에 없는 칸은 가져오지 않습니다 (${extra.join(', ')})`)
  return ok
}

/** 빈 줄인지 (양식 칸 안에 값이 하나도 없음) */
function isBlank(r: XlsxRow, ncols: number): boolean {
  for (const [n, cell] of r.cells) {
    if (n > ncols) continue
    if (cell.type !== 'string' || cell.text.trim() !== '') return false
  }
  return true
}

/**
 * 데이터 줄 읽기: 칸 형식 변환 → 빈 칸 기본값 → 필수 → 조건부 필수 → 값 범위.
 * thicknessOf: 이 줄의 파일 두께 (maxThicknessTimes 검사). 모르면 null.
 */
function parseRows(
  sheet: LabelSheet,
  xs: XlsxSheet,
  date1904: boolean,
  thicknessOf: (values: Map<string, CellValue>) => number | null
): ParsedRow[] {
  const cols = columnsOf(sheet.id)
  const out: ParsedRow[] = []
  for (const r of xs.rows) {
    if (r.row <= 1 || isBlank(r, cols.length)) continue
    const rc = new RowCtx(sheet, r.row)
    const values = new Map<string, CellValue>()
    cols.forEach((c, i) => {
      const read = readCellAs(c, r.cells.get(i + 1), date1904)
      // 앱이 채우는 칸(Ref 대비 dB 등)은 적은 값을 쓰지 않으므로 읽기 실패도 줄을 막지 않는다
      if (read.error) {
        if (c.appFilled) rc.warn(`${read.error} — 앱이 채우는 칸이라 이 값은 쓰지 않습니다`, c)
        else rc.error(read.error, c)
      }
      if (read.warning) rc.warn(read.warning, c)
      if (read.value !== null) values.set(c.key, read.value)
    })
    for (const c of cols) {
      if (!values.has(c.key) && c.emptyValue !== undefined && !rc.errs.some((e) => e.startsWith(rc.where(c)))) values.set(c.key, c.emptyValue)
    }
    for (const c of cols) {
      if (c.required && !values.has(c.key) && !rc.errs.some((e) => e.startsWith(rc.where(c)))) rc.error('필수 칸이 비어 있습니다', c)
    }
    for (const c of cols) {
      const rw = c.requiredWhen
      if (!rw || values.has(c.key)) continue
      const cond = values.get(rw.key)
      if (typeof cond !== 'string' || !rw.codes.includes(cond)) continue
      const condCol = colOf(sheet.id, rw.key)
      const condLabel = condCol.enumValues.find((v) => v.code === cond)?.label ?? cond
      if (rw.fallback !== undefined) {
        values.set(c.key, rw.fallback)
        const fb = c.enumValues.find((v) => v.code === rw.fallback)?.label ?? rw.fallback
        rc.warn(`'${condCol.header}' 칸이 '${condLabel}' 인데 비어 있어 '${fb}'(으)로 가져옵니다`, c)
      } else {
        rc.warn(`'${condCol.header}' 칸이 '${condLabel}' 이면 적어야 합니다 (비어 있음)`, c)
      }
    }
    checkRules(sheet, values, rc, thicknessOf(values))
    out.push({ row: r.row, values, rc })
  }
  return out
}

/** 문구용 값: 숫자는 짧게, 시각은 '2026-10-20 14:05' */
function shownValue(v: CellValue): string {
  if (typeof v === 'number') return fmtNum(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace('T', ' ')
  return String(v)
}

function fmtNum(n: number): string {
  return String(Math.round(n * 1e6) / 1e6)
}

/** columns.ts rule: 범위·정수·끝 ≥ 시작·두께 배수 */
function checkRules(sheet: LabelSheet, values: Map<string, CellValue>, rc: RowCtx, thicknessMm: number | null): void {
  for (const c of columnsOf(sheet.id)) {
    const rule = c.rule
    const v = values.get(c.key)
    if (!rule || v === undefined || c.appFilled) continue
    if (typeof v === 'number') {
      if (rule.int && !Number.isInteger(v)) rc.error(`정수로 적습니다 (받은 값: ${fmtNum(v)})`, c)
      if (rule.min !== undefined && v < rule.min) rc.error(`${fmtNum(rule.min)} 이상이어야 합니다 (받은 값: ${fmtNum(v)})`, c)
      const k = rule.maxThicknessTimes
      if (k !== undefined && thicknessMm !== null && thicknessMm > 0) {
        const lim = thicknessMm * k
        if (v > lim + 1e-9) {
          rc.error(
            k === 1
              ? `그 파일 두께(${fmtNum(thicknessMm)} mm)보다 클 수 없습니다 (실제 깊이, 받은 값: ${fmtNum(v)})`
              : `그 파일 두께의 ${fmtNum(k)}배(${fmtNum(lim)} mm)보다 클 수 없습니다 (펼친 깊이, 받은 값: ${fmtNum(v)})`,
            c
          )
        }
      } else if (rule.max !== undefined && v > rule.max) rc.error(`${fmtNum(rule.max)} 이하여야 합니다 (받은 값: ${fmtNum(v)})`, c)
    }
    if (rule.atLeastKey !== undefined) {
      const other = values.get(rule.atLeastKey)
      if (other === undefined) continue
      const oc = colOf(sheet.id, rule.atLeastKey)
      const less =
        typeof v === 'number' && typeof other === 'number'
          ? v < other - 1e-9
          : typeof v === 'string' && typeof other === 'string'
            ? Date.parse(v) < Date.parse(other)
            : false
      if (less) rc.error(`'${oc.header}'(${shownValue(other)})보다 작을 수 없습니다 (받은 값: ${shownValue(v)})`, c)
    }
  }
}

// ───────────────────────────── 칸 경로에 값 넣기 ─────────────────────────────

/** null 인 중간 객체를 만들 때의 기본값 (값을 넣는 칸이 늘 있는 묶음) */
const SKELETONS: Readonly<Record<string, () => Record<string, unknown>>> = {
  'IndicationRecord:signal.peak': () => ({ groupId: null, beam: null, angleDeg: null, scanMm: null, depthMm: null }),
  'IndicationRecord:geometricEcho': () => ({ fromSuggestion: false }),
  'IndicationRecord:geometricImperfection': () => ({}),
  'ReviewInterval:gate': () => ({})
}

function setPath(entity: LabelEntity, obj: object, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur = obj as Record<string, unknown>
  let prefix = ''
  for (const k of keys.slice(0, -1)) {
    prefix = prefix ? `${prefix}.${k}` : k
    let next = cur[k]
    if (next === null || next === undefined) {
      const make = SKELETONS[`${entity}:${prefix}`]
      if (!make) throw new Error(`칸 경로 ${entity}.${path}: 빈 묶음 '${prefix}' 를 만들 규칙이 없습니다`)
      next = make()
      cur[k] = next
    }
    cur = next as Record<string, unknown>
  }
  cur[keys[keys.length - 1]!] = value
}

/** via 가 없는 칸을 그 엔티티의 칸 경로에 넣는다 (앱이 채우는 칸은 뺌) */
function applyPlain(sheetId: LabelSheetId, entity: LabelEntity, obj: object, values: Map<string, CellValue>): void {
  for (const c of columnsOf(sheetId)) {
    if (!c.target || c.target.entity !== entity || c.target.via !== undefined || c.appFilled) continue
    const v = values.get(c.key)
    if (v !== undefined) setPath(entity, obj, c.target.path, v)
  }
}

/** 검사 결과의 문구를 줄 위치로 옮긴다. '[경로]' 가 칸 경로와 같으면 그 칸 위치를 붙인다 */
function absorbCheck<T>(res: LabelCheckResult<T>, rc: RowCtx, entity: LabelEntity): T | null {
  const cols = columnsOf(rc.sheet.id)
  const place = (msg: string): { text: string; col: LabelColumn | undefined } => {
    const m = /^(.*) \[([^\]]+)\]$/.exec(msg)
    if (!m) return { text: msg, col: undefined }
    const raw = m[2]!.replace(/\[\d+\]/g, '')
    const col = cols.find((c) => c.target?.entity === entity && c.target.path === raw)
    const body = m[1]!
    const i = body.indexOf(': ')
    return { text: col && i >= 0 ? body.slice(i + 2) : body, col }
  }
  for (const e of res.errors) {
    const p = place(e)
    rc.error(p.text, p.col)
  }
  for (const w of res.warnings) {
    const p = place(w)
    rc.warn(p.text, p.col)
  }
  return res.ok ? res.value : null
}

// ───────────────────────────── 파일·그룹 ─────────────────────────────

interface ResolvedFile {
  sha256: string
  /** null = 앱에 없는 파일 ('파일' 시트 SHA-256 으로만 이음) */
  info: LabelWorkbookFile | null
  /** 엑셀에 처음 적힌 이름 */
  fileName: string
  /** '파일' 시트 두께, 없으면 셋업 두께 */
  thicknessMm: number | null
}

const SHA_RE = /^[0-9a-f]{64}$/

function dedupeBySha(files: readonly LabelWorkbookFile[]): LabelWorkbookFile[] {
  const seen = new Set<string>()
  return files.filter((f) => (seen.has(f.sha256) ? false : (seen.add(f.sha256), true)))
}

function shaShort(sha: string): string {
  return sha.slice(0, 12)
}

/** 'sect-90' → 기법·스큐 */
function groupSpec(code: ScanGroupCode): { technique: 'sectorial' | 'linear'; skewDeg: number } {
  const [t, s] = code.split('-')
  return { technique: t === 'lin' ? 'linear' : 'sectorial', skewDeg: Number(s) }
}

const TECH_KO: Readonly<Record<string, string>> = { sectorial: '섹토리얼', linear: '리니어', compound: '컴파운드', other: '기타' }

function describeGroups(info: LabelWorkbookFile): string {
  if (info.groups.length === 0) return '그룹 없음'
  return info.groups
    .map((g) => `${g.name}(${g.id}): ${TECH_KO[groupTechniqueOf(g.technique)]} ${g.skewDeg === null ? '스큐 모름' : `${fmtNum(g.skewDeg)}°`}`)
    .join(', ')
}

// ───────────────────────────── 본체 ─────────────────────────────

const EMPTY_FORM = (): LabelFormInfo => ({
  labelForm: null,
  schemaVersion: null,
  fingerprint: null,
  appFingerprint: labelColumnsFingerprint(),
  blind: null,
  templateStage: null
})

function emptyResult(form: LabelFormInfo, out: Out): LabelWorkbookImport {
  return {
    ok: false,
    labeler: null,
    labelSets: [],
    alignments: [],
    records: [],
    reviews: [],
    physicalDefects: [],
    events: [],
    groupQuestions: [],
    fileQuestions: [],
    questionErrors: out.questionErrors,
    form,
    errors: out.errors,
    warnings: out.warnings
  }
}

const round2 = (x: number): number => Math.round(x * 100) / 100

/**
 * 전문가 엑셀(기록양식 v1)을 라벨 기록으로 바꾼다. 저장하지 않는다.
 * 손상된 파일·양식이 아닌 파일도 던지지 않고 errors 에 담아 돌려준다.
 */
export function parseLabelWorkbook(data: Uint8Array, ctx: LabelWorkbookContext): LabelWorkbookImport {
  const out = new Out()
  const form = EMPTY_FORM()
  let wb: XlsxWorkbook
  try {
    wb = readXlsx(data)
  } catch (e) {
    if (e instanceof XlsxError) {
      out.errors.push(`엑셀 파일을 열 수 없습니다: ${e.message}`)
      return emptyResult(form, out)
    }
    throw e
  }
  try {
    return convert(wb, ctx, out, form)
  } catch (e) {
    if (e instanceof XlsxError) {
      out.errors.push(`엑셀 파일을 읽을 수 없습니다: ${e.message}`)
      return emptyResult(form, out)
    }
    throw e
  }
}

function convert(wb: XlsxWorkbook, ctx: LabelWorkbookContext, out: Out, form: LabelFormInfo): LabelWorkbookImport {
  const U = ctx.uuid ?? stableUuid
  const nowIso = toKstIso(ctx.now)
  const slot = ctx.versionSlot?.trim() || ctx.pcId
  const versions = (): VersionEntry[] => [{ pcId: slot, edits: 1 }]

  // 문서 속성 (양식 생성기가 적은 값)
  const props = wb.customProperties
  form.labelForm = props['paut.labelForm'] ?? null
  form.schemaVersion = props['paut.labelSchemaVersion'] ?? null
  form.fingerprint = props['paut.columnsFingerprint'] ?? null
  form.blind = props['paut.blind'] === undefined ? null : props['paut.blind'] === 'true'
  form.templateStage = props['paut.readingStage'] ?? null
  if (form.schemaVersion !== null && Number(form.schemaVersion) > LABEL_SCHEMA_VERSION) {
    out.errors.push(`이 엑셀은 라벨 형식 v${form.schemaVersion} 양식입니다. 이 앱은 v${LABEL_SCHEMA_VERSION} 까지만 읽습니다. 앱을 새 버전으로 올린 뒤 가져옵니다`)
    return emptyResult(form, out)
  }

  // 시트·머리글 (칸 지문)
  const sheets = new Map<LabelSheetId, XlsxSheet>()
  let headersOk = true
  for (const s of LABEL_SHEETS) {
    const name = wb.sheetNames.find((n) => normalizeCell(n) === normalizeCell(s.name))
    const xs = name === undefined ? null : wb.sheet(name)
    if (!xs) {
      headersOk = false
      out.errors.push(`'${s.name}' 시트가 없습니다. 양식(기록양식 v1)의 시트 ${LABEL_SHEETS.map((x) => `'${x.name}'`).join('·')} 를 그대로 씁니다`)
      continue
    }
    if (!checkHeader(s, xs, out)) headersOk = false
    sheets.set(s.id, xs)
  }
  if (!headersOk) return emptyResult(form, out)
  if (form.fingerprint !== null && form.fingerprint !== form.appFingerprint) {
    out.warnings.push(
      `양식을 만든 뒤 앱의 칸 정의가 바뀌었습니다 (양식 지문 ${form.fingerprint}, 앱 ${form.appFingerprint}). 머리글은 같아 가져오지만, 목록 값·검사가 달라졌을 수 있습니다`
    )
  }
  const sheetOf = (id: LabelSheetId): XlsxSheet => sheets.get(id)!
  const noThickness = (): number | null => null

  // ── 판독자 (sheet-meta) ──
  const readerSheet = sheetDef('reader')
  const readerRows = parseRows(readerSheet, sheetOf('reader'), wb.date1904, noThickness)
  if (readerRows.length === 0) {
    out.errors.push(`${whereText(readerSheet, 2)}: 판독자 줄이 없습니다. 라벨러 ID 와 판독 단계를 적어야 가져옵니다`)
    return emptyResult(form, out)
  }
  const maxRows = readerSheet.maxRows ?? Infinity
  readerRows.slice(maxRows).forEach((r) => r.rc.error(`'${readerSheet.name}' 시트는 ${maxRows}줄만 적습니다 (이 파일의 모든 줄에 붙는 값)`))
  const r0 = readerRows[0]!
  for (const r of readerRows) out.finish(r.rc)
  if (readerRows.some((r) => r.rc.failed)) {
    out.errors.push('판독자 시트를 고친 뒤 다시 가져옵니다 (라벨러 ID·판독 단계는 이 파일의 모든 줄에 붙습니다)')
    return emptyResult(form, out)
  }
  const readerMeta: Array<{ path: string; value: CellValue }> = []
  for (const c of columnsOf('reader')) {
    if (c.target?.via !== 'sheet-meta') continue
    const v = r0.values.get(c.key)
    if (v !== undefined) readerMeta.push({ path: c.target.path, value: v })
  }
  const metaValue = (path: string): CellValue | null => readerMeta.find((m) => m.path === path)?.value ?? null
  const labelerId = String(metaValue('labelerId'))
  const readingStage = metaValue('readingStage') as ReadingStage
  const guidelineVersion = String(metaValue('guidelineVersion') ?? 'v1')
  const readerSource = (metaValue('readerSource') ?? 'expert') as ReaderSource
  const labeler: ImportedReader = {
    id: labelerId,
    name: labelerId,
    qualification: (metaValue('readerDetail.qualification') as string | null) ?? null,
    organization: (metaValue('readerDetail.organization') as string | null) ?? null,
    readingStage,
    guidelineVersion,
    readerSource
  }
  /** 판독자 값을 그 엔티티에 있는 칸에만 넣는다 */
  const applyReader = (entity: LabelEntity, obj: object): void => {
    for (const m of readerMeta) if (fieldAt(entity, m.path)) setPath(entity, obj, m.path, m.value)
  }

  // ── 같은 이름 파일이 둘 이상: 답(fileChoices)이 있으면 그 파일, 없으면 물음 + 오류 ──
  const fileQuestions = new Map<string, FileQuestion>()
  /** sha256 → 어떻게 맞췄나 (SHA-256 칸 / 이름 하나 / 화면에서 고름) */
  const fileMatch: Record<string, 'sha256' | 'name' | 'choice'> = {}
  const pickAmbiguous = (name: string, cands: readonly LabelWorkbookFile[], rc: RowCtx, col: LabelColumn): LabelWorkbookFile | null => {
    const key = fileNameKey(name)
    const choice = ctx.fileChoices?.[key]
    const hit = choice !== undefined ? cands.find((f) => f.sha256 === choice) : undefined
    if (hit) {
      fileMatch[hit.sha256] = 'choice'
      return hit
    }
    const q = fileQuestions.get(key) ?? {
      key,
      fileName: name,
      candidates: cands.map((f) => ({ sha256: f.sha256, fileName: f.fileName ?? null, label: f.label ?? null })),
      where: []
    }
    q.where.push(rc.where(col))
    fileQuestions.set(key, q)
    rc.error(
      `같은 이름의 파일이 앱에 ${cands.length}개 있습니다 (${cands.map((f) => shaShort(f.sha256)).join(', ')}…). 미리보기에서 어느 파일인지 고르거나 '파일' 시트 'SHA-256' 칸에 적습니다`,
      col
    )
    out.questionErrors++
    return null
  }

  // ── 파일 ──
  const fileSheet = sheetDef('file')
  const files = new Map<string, ResolvedFile>() // fileNameKey → 파일
  const fileRowOfSha = new Map<string, number>()
  const alignments: FileAlignment[] = []
  const fileSpecimens = new Set<string>()
  for (const pr of parseRows(fileSheet, sheetOf('file'), wb.date1904, noThickness)) {
    const { rc, values } = pr
    const name = values.get('fileName')
    const shaCol = colOf('file', 'sha256')
    let sheetSha = values.get('sha256')
    if (typeof sheetSha === 'string') {
      sheetSha = sheetSha.toLowerCase()
      if (!SHA_RE.test(sheetSha)) rc.error('SHA-256(16진수 64자)이 아닙니다', shaCol)
    }
    let resolved: ResolvedFile | null = null
    if (typeof name === 'string' && !rc.failed) {
      const nameCol = colOf('file', 'fileName')
      const cands = dedupeBySha(ctx.findFiles(name))
      const thickCell = values.get('thicknessMm')
      if (typeof sheetSha === 'string') {
        const hit = cands.find((f) => f.sha256 === sheetSha) ?? ctx.findFileBySha256?.(sheetSha) ?? null
        if (cands.length > 0 && !cands.some((f) => f.sha256 === sheetSha)) {
          rc.error(`SHA-256 이 앱에 있는 같은 이름 파일과 다릅니다 (앱: ${cands.map((f) => shaShort(f.sha256)).join(', ')}…)`, shaCol)
        } else {
          if (!hit) rc.warn('앱 저장소에 없는 파일입니다. SHA-256 으로만 잇고, 그룹 번호 찾기·Ref 계산은 하지 않습니다', nameCol)
          resolved = { sha256: sheetSha, info: hit, fileName: name, thicknessMm: null }
          fileMatch[sheetSha] = 'sha256'
        }
      } else if (cands.length === 0) {
        rc.error("앱에서 이 파일을 찾지 못했습니다. 파일을 먼저 가져오거나 'SHA-256' 칸을 채웁니다", nameCol)
      } else if (cands.length > 1) {
        const pick = pickAmbiguous(name, cands, rc, nameCol)
        if (pick) resolved = { sha256: pick.sha256, info: pick, fileName: name, thicknessMm: null }
      } else {
        resolved = { sha256: cands[0]!.sha256, info: cands[0]!, fileName: name, thicknessMm: null }
        fileMatch[cands[0]!.sha256] = 'name'
      }
      if (resolved) {
        const setupT = resolved.info?.thicknessMm ?? null
        const t = typeof thickCell === 'number' ? thickCell : setupT
        if (typeof thickCell === 'number' && setupT !== null && Math.abs(thickCell - setupT) > 0.05) {
          rc.warn(`파일 셋업 두께(${fmtNum(setupT)} mm)와 다릅니다. 적은 값으로 깊이를 검사합니다`, colOf('file', 'thicknessMm'))
        }
        resolved.thicknessMm = t
        const sp = values.get('specimenId')
        const appSp = resolved.info?.specimenId ?? null
        if (typeof sp === 'string' && appSp && normalizeCell(sp) !== normalizeCell(appSp)) {
          rc.warn(`앱의 시편 ID('${appSp}')와 다릅니다`, colOf('file', 'specimenId'))
        }
        const prevRow = fileRowOfSha.get(resolved.sha256)
        if (prevRow !== undefined) rc.error(`${prevRow}행과 같은 파일(SHA-256 ${shaShort(resolved.sha256)}…)입니다. 파일마다 한 줄만 적습니다`, nameCol)
        const k = fileNameKey(name)
        if (files.has(k) && prevRow === undefined) rc.error('같은 파일명이 위에 이미 있습니다', nameCol)
      }
    }
    if (rc.failed || !resolved) {
      out.finish(rc)
      continue
    }
    fileRowOfSha.set(resolved.sha256, pr.row)
    files.set(fileNameKey(resolved.fileName), resolved)
    const a = newFileAlignment({ sha256: resolved.sha256, fileName: resolved.fileName })
    applyPlain('file', 'FileAlignment', a, values)
    const dir = values.get('direction')
    if (typeof dir === 'string') a.direction = Number(dir) as 1 | -1 // via signed-unit
    a.sha256 = resolved.sha256
    a.enteredBy = labelerId
    a.versions = versions()
    a.revision = 1
    a.pcId = ctx.pcId
    a.updatedAt = nowIso
    const checked = absorbCheck(validateFileAlignment(a), rc, 'FileAlignment')
    if (out.finish(rc) && checked) {
      alignments.push(checked)
      if (checked.specimenId) fileSpecimens.add(normalizeCell(checked.specimenId))
    }
  }

  /** 다른 시트의 파일명 → 파일. '파일' 시트에 없으면 앱에서 찾고 경고 */
  const outsideWarned = new Set<string>()
  const resolveFileRef = (name: CellValue | undefined, rc: RowCtx, col: LabelColumn): ResolvedFile | null => {
    if (typeof name !== 'string') return null
    const k = fileNameKey(name)
    const hit = files.get(k)
    if (hit) return hit
    const cands = dedupeBySha(ctx.findFiles(name))
    const one = cands.length === 1 ? cands[0]! : cands.length > 1 ? pickAmbiguous(name, cands, rc, col) : null
    if (one) {
      const info = one
      const known = [...files.values()].find((f) => f.sha256 === info.sha256)
      if (known) return known
      if (!outsideWarned.has(k)) {
        outsideWarned.add(k)
        rc.warn(`'파일' 시트에 없는 파일명입니다 (앱에서 찾은 파일로 잇습니다. 두께를 몰라 깊이 검사는 셋업 두께로 합니다)`, col)
      }
      const r: ResolvedFile = { sha256: info.sha256, info, fileName: name, thicknessMm: info.thicknessMm ?? null }
      fileMatch[info.sha256] ??= 'name'
      files.set(k, r)
      return r
    }
    if (cands.length > 1) {
      // pickAmbiguous 가 물음·오류를 남겼다
    } else {
      rc.error("이 파일을 '파일' 시트에서도, 앱에서도 찾지 못했습니다. 파일명을 '파일' 시트와 같게 적습니다", col)
    }
    return null
  }
  /** 파일명 칸 값으로 두께 (깊이 검사) — 파일을 못 찾으면 null(범위 max 로 검사) */
  const thicknessByName = (values: Map<string, CellValue>): number | null => {
    const n = values.get('fileName')
    if (typeof n !== 'string') return null
    const f = files.get(fileNameKey(n)) ?? null
    if (f) return f.thicknessMm
    const c = dedupeBySha(ctx.findFiles(n))
    if (c.length === 1) return c[0]!.thicknessMm ?? null
    const choice = ctx.fileChoices?.[fileNameKey(n)]
    return c.find((x) => x.sha256 === choice)?.thicknessMm ?? null
  }

  const questions = new Map<string, GroupQuestion>()
  const resolveGroup = (file: ResolvedFile, code: CellValue | undefined, rc: RowCtx, col: LabelColumn): number | null => {
    if (typeof code !== 'string') return null
    const label = labelOf(SCAN_GROUP, code as ScanGroupCode)
    if (!file.info) {
      rc.error(`앱에 없는 파일이라 '${label}' 그룹 번호를 찾지 못했습니다. 파일을 먼저 앱으로 가져옵니다`, col)
      return null
    }
    if (file.info.groupsError) {
      rc.error(`이 파일의 그룹을 읽지 못해 '${label}' 그룹 번호를 정할 수 없습니다 (${file.info.groupsError}). 엑셀이 아니라 저장소를 확인합니다`, col)
      return null
    }
    const spec = groupSpec(code as ScanGroupCode)
    const cands = file.info.groups.filter((g) => groupTechniqueOf(g.technique) === spec.technique && sameSkew(g.skewDeg, spec.skewDeg))
    if (cands.length === 1) return cands[0]!.id
    if (cands.length === 0) {
      rc.error(`이 파일에 '${label}' 그룹이 없습니다 (파일의 그룹: ${describeGroups(file.info)})`, col)
      return null
    }
    const key = `${file.sha256}|${code}`
    const choice = ctx.groupChoices?.[key]
    if (choice !== undefined && cands.some((g) => g.id === choice)) return choice
    const q = questions.get(key) ?? {
      key,
      sha256: file.sha256,
      fileName: file.fileName,
      code: code as ScanGroupCode,
      label,
      candidates: cands.map((g) => ({ id: g.id, name: g.name })),
      where: []
    }
    q.where.push(rc.where(col))
    questions.set(key, q)
    rc.error(`이 파일에 '${label}' 그룹이 ${cands.length}개 있습니다 (${cands.map((g) => `${g.name}(${g.id})`).join(', ')}). 미리보기에서 어느 그룹인지 고릅니다`, col)
    out.questionErrors++
    return null
  }

  /** 최대 진폭 그룹의 Ref (%FSH). 그룹이 비면 파일의 모든 그룹 Ref 가 같을 때만 */
  const refPctOf = (file: ResolvedFile, groupId: number | null): number | null => {
    if (!file.info) return null
    const ref = (g: LabelWorkbookFile['groups'][number]): number | null => {
      const rg = g.referenceGainDb ?? null
      return refPctFromSetup(g.gainDb ?? null, rg !== null && rg > 0 ? rg : null, g.referenceAmplitudePct ?? 80)
    }
    if (groupId !== null) {
      const g = file.info.groups.find((x) => x.id === groupId)
      return g ? ref(g) : null
    }
    const all = file.info.groups.map(ref)
    const first = all[0]
    if (first === undefined || first === null) return null
    return all.every((x) => x !== null && Math.abs(x - first) < 1e-6) ? first : null
  }

  const setKeys = new Map<string, LabelSetKey>()
  const addSet = (sha256: string): void => {
    const k: LabelSetKey = { sha256, labelerId, guidelineVersion, readingStage }
    setKeys.set(labelSetId(k), k)
  }
  const occurrences = new Map<string, number>()

  // ── 지시 ──
  const indSheet = sheetDef('indication')
  const records: IndicationRecord[] = []
  const refSeen = new Map<string, number>()
  let leveled = 0
  for (const pr of parseRows(indSheet, sheetOf('indication'), wb.date1904, thicknessByName)) {
    const { rc, values } = pr
    const file = resolveFileRef(values.get('fileName'), rc, colOf('indication', 'fileName'))
    const refDbCol = colOf('indication', 'refDb')
    if (values.has('refDb')) rc.warn(`앱이 계산하는 칸이라 적은 값(${String(values.get('refDb'))})은 쓰지 않습니다`, refDbCol)
    if (!file || rc.failed) {
      out.finish(rc)
      continue
    }
    const peakGroup = resolveGroup(file, values.get('group'), rc, colOf('indication', 'group'))
    const lengthGroup = resolveGroup(file, values.get('lengthGroup'), rc, colOf('indication', 'lengthGroup'))
    const ext = values.get('externalRef')
    const extCol = colOf('indication', 'externalRef')
    let idPart: string
    if (typeof ext === 'string') {
      const dk = `${file.sha256}|${ext}`
      const prev = refSeen.get(dk)
      if (prev !== undefined) rc.error(`같은 파일의 지시 번호 '${ext}' 줄이 ${prev}행에도 있습니다. 지시마다 다른 번호를 적습니다`, extCol)
      else refSeen.set(dk, pr.row)
      idPart = `ref:${ext}`
    } else {
      idPart = `row:${pr.row}`
      rc.warn('지시 번호가 비어 행 번호로 기록을 가립니다. 줄 순서를 바꿔 다시 가져오면 다른 기록이 됩니다', extCol)
    }
    if (rc.failed) {
      out.finish(rc)
      continue
    }
    const rec = newIndicationRecord({
      uuid: U(uuidKey(['indication', file.sha256, labelerId, guidelineVersion, readingStage, idPart])),
      sha256: file.sha256,
      labelerId,
      guidelineVersion,
      readingStage,
      secondaryFingerprint: file.info?.secondaryFingerprint ?? null,
      coordSource: 'imported-mm',
      versions: versions(),
      revision: 1,
      pcId: ctx.pcId,
      createdAt: nowIso,
      updatedAt: nowIso
    })
    applyReader('IndicationRecord', rec)
    applyPlain('indication', 'IndicationRecord', rec, values)
    if (peakGroup !== null) setPath('IndicationRecord', rec, colOf('indication', 'group').target!.path, peakGroup)
    if (lengthGroup !== null) setPath('IndicationRecord', rec, colOf('indication', 'lengthGroup').target!.path, lengthGroup)
    // 길이 잰 그룹이 비면 최대 진폭 그룹 (칸 도움말: '같으면 비워도 됩니다')
    if (rec.length.groupId === null && rec.length.valueMm !== null && rec.signal.peak?.groupId != null) rec.length.groupId = rec.signal.peak.groupId
    // ISO 6520-1 코드 (원문 대조 전 표)
    if (rec.kind === 'defect' && rec.defectType !== null) rec.isoCode = METALLURGICAL_TYPE_INFO[rec.defectType].iso
    if (rec.kind === 'geometric-imperfection' && rec.geometricImperfection) rec.isoCode = GEOMETRIC_IMPERFECTION_ISO[rec.geometricImperfection.kind]
    // 엑셀의 일렬 체적 표시는 전문가가 직접 고른 것
    rec.character.expertConfirmed = rec.character.alignedVolumetric
    // 대조·확정 단계 = 설계값 봤음
    if (readingStage !== 'blind') {
      if (rec.knowledge.designValueSeen === false) {
        rc.warn(`판독 단계가 '${labelOf(READING_STAGE, readingStage)}'라 '설계값 봤음'으로 가져옵니다`, colOf('indication', 'designValueSeen'))
      }
      rec.knowledge.designValueSeen = true
    }
    // 신호 기준 (levels.ts, 대조 전)
    const amp = rec.signal.maxAmplitudePct
    rec.signal.refDbVerified = false
    if (amp !== null) {
      const refPct = refPctOf(file, rec.signal.peak?.groupId ?? null)
      const lv = amplitudeLevels({
        maxAmplitudePct: amp,
        refPct,
        lengthMm: rec.length.valueMm,
        thicknessMm: file.thicknessMm,
        saturated: rec.signal.saturated === true || amp >= 200
      })
      rec.signal.refDb = lv.refDb === null ? null : round2(lv.refDb)
      rec.signal.exceedsEvaluationLevel = lv.exceedsEvaluationLevel
      rec.signal.exceedsRecordingLevel = lv.exceedsRecordingLevel
      if (lv.refDb !== null) leveled++
      else if (file.info) {
        rc.warn(
          rec.signal.peak?.groupId == null
            ? "'그룹' 칸이 비어 있고 그룹마다 Ref 가 달라 Ref 대비 dB 를 계산하지 못했습니다"
            : '파일 셋업에 이득 값이 없어 Ref 대비 dB 를 계산하지 못했습니다',
          refDbCol
        )
      }
    }
    const checked = absorbCheck(validateIndicationRecord(rec), rc, 'IndicationRecord')
    if (out.finish(rc) && checked) {
      records.push(checked)
      addSet(file.sha256)
    }
  }
  if (leveled > 0) {
    out.warnings.push(
      `지시 ${leveled}건의 'Ref 대비 (dB)'와 평가·기록 기준 초과는 파일 이득으로 추정한 값입니다 (Ref = 기준 진폭 × 10^((이득 − 기준 이득)/20), OmniPC 대조 전 참고값)`
    )
  }

  // ── 검토구간 ──
  const revSheet = sheetDef('review')
  const reviews: ReviewInterval[] = []
  for (const pr of parseRows(revSheet, sheetOf('review'), wb.date1904, thicknessByName)) {
    const { rc, values } = pr
    const file = resolveFileRef(values.get('fileName'), rc, colOf('review', 'fileName'))
    if (!file || rc.failed) {
      out.finish(rc)
      continue
    }
    const groupId = resolveGroup(file, values.get('group'), rc, colOf('review', 'group'))
    if (rc.failed) {
      out.finish(rc)
      continue
    }
    const kind = values.get('kind') as ReviewInterval['kind']
    const start = values.get('scanStartMm') as number
    const end = values.get('scanEndMm') as number
    const baseKey = uuidKey(['review', file.sha256, labelerId, guidelineVersion, readingStage, kind, groupId ?? 'all', fmtNum(start), fmtNum(end)])
    const n = (occurrences.get(baseKey) ?? 0) + 1
    occurrences.set(baseKey, n)
    const rv = newReviewInterval({
      uuid: U(n === 1 ? baseKey : uuidKey([baseKey, n])),
      sha256: file.sha256,
      labelerId,
      guidelineVersion,
      readingStage,
      kind,
      scanStartMm: start,
      scanEndMm: end,
      versions: versions(),
      revision: 1,
      pcId: ctx.pcId,
      createdAt: nowIso,
      updatedAt: nowIso
    })
    applyReader('ReviewInterval', rv)
    applyPlain('review', 'ReviewInterval', rv, values)
    if (groupId !== null) setPath('ReviewInterval', rv, colOf('review', 'group').target!.path, groupId)
    const checked = absorbCheck(validateReviewInterval(rv), rc, 'ReviewInterval')
    if (out.finish(rc) && checked) {
      reviews.push(checked)
      addSet(file.sha256)
    }
  }

  // ── 물리결함 ──
  const phySheet = sheetDef('physical')
  const physicalDefects: PhysicalDefect[] = []
  const defectRows = new Map<string, number>()
  const phyRows = parseRows(phySheet, sheetOf('physical'), wb.date1904, noThickness)
  if (readingStage === 'blind' && phyRows.length > 0) {
    out.warnings.push(
      `'${phySheet.name}' 시트에 설계값 ${phyRows.length}줄이 있는데 판독 단계가 블라인드입니다. 블라인드 판독이 맞는지 확인합니다 (설계값을 봤으면 '설계값 봤는지' = 예)`
    )
  }
  for (const pr of phyRows) {
    const { rc, values } = pr
    const id = values.get('physicalDefectId')
    const sp = values.get('specimenId')
    if (typeof id === 'string' && typeof sp === 'string') {
      const k = `${normalizeCell(sp)}\u0000${id}`
      const prev = defectRows.get(k)
      if (prev !== undefined) rc.error(`같은 시편의 물리 결함 ID '${id}' 줄이 ${prev}행에도 있습니다`, colOf('physical', 'physicalDefectId'))
      else defectRows.set(k, pr.row)
      if (!fileSpecimens.has(normalizeCell(sp))) rc.warn(`'파일' 시트에 없는 시편 ID 입니다`, colOf('physical', 'specimenId'))
    }
    if (rc.failed || typeof id !== 'string' || typeof sp !== 'string') {
      out.finish(rc)
      continue
    }
    const p = newPhysicalDefect({ id, specimenId: sp })
    applyPlain('physical', 'PhysicalDefect', p, values)
    p.versions = versions()
    p.revision = 1
    p.pcId = ctx.pcId
    p.updatedAt = nowIso
    const checked = absorbCheck(validatePhysicalDefect(p), rc, 'PhysicalDefect')
    if (out.finish(rc) && checked) physicalDefects.push(checked)
  }

  // ── 작업시간 → 작업 이벤트 ──
  const wtSheet = sheetDef('worktime')
  const events: WorkEvent[] = []
  const colOpen = colByVia('worktime', 'event-file-open')
  const colClose = colByVia('worktime', 'event-file-close')
  const colReport = colByVia('worktime', 'event-report-minutes')
  const colExtra = colByVia('worktime', 'event-label-extra-minutes')
  const colIdle = colByVia('worktime', 'event-idle-minutes')
  const colTool = colByVia('worktime', 'event-tool')
  const colNote = colByVia('worktime', 'event-note')
  const sessionRows = new Map<string, number>()
  for (const pr of parseRows(wtSheet, sheetOf('worktime'), wb.date1904, noThickness)) {
    const { rc, values } = pr
    const file = resolveFileRef(values.get('fileName'), rc, colOf('worktime', 'fileName'))
    if (!file || rc.failed) {
      out.finish(rc)
      continue
    }
    const startedAt = values.get(colOpen.key) as string
    const endedAt = values.get(colClose.key) as string
    const sessionKey = uuidKey(['worktime', file.sha256, labelerId, guidelineVersion, readingStage, startedAt])
    const prev = sessionRows.get(sessionKey)
    if (prev !== undefined) rc.error(`같은 파일·같은 시작 시각 줄이 ${prev}행에도 있습니다`, colOpen)
    else sessionRows.set(sessionKey, pr.row)
    const duration = minutesBetween(startedAt, endedAt)
    const extra = values.get(colExtra.key)
    const idle = values.get(colIdle.key)
    const spent = (typeof extra === 'number' ? extra : 0) + (typeof idle === 'number' ? idle : 0)
    if (spent > duration + 1e-9) {
      rc.warn(`라벨 추가 작업 시간 + 쉰 시간(${fmtNum(spent)}분)이 판독 시작~끝(${fmtNum(duration)}분)보다 깁니다`)
    }
    if (rc.failed) {
      out.finish(rc)
      continue
    }
    const sessionId = U(sessionKey)
    const tool = (values.get(colTool.key) ?? 'omnipc') as WorkTool
    const note = values.get(colNote.key)
    const made: WorkEvent[] = []
    const add = (kind: WorkEventKind, at: string, detail: unknown): void => {
      const ev = newWorkEvent({ uuid: U(uuidKey([sessionKey, kind])), sessionId, labelerId, kind, at })
      applyReader('WorkEvent', ev)
      ev.readingStage = readingStage
      ev.pcId = ctx.pcId
      ev.sha256 = file.sha256
      ev.tool = tool
      ev.detail = detail
      made.push(ev)
    }
    add('file-open', startedAt, typeof note === 'string' && note !== '' ? { note } : null)
    add('file-close', endedAt, null)
    const minutes: Array<[LabelColumn, WorkEventKind]> = [
      [colReport, 'report'],
      [colExtra, 'label-extra'],
      [colIdle, 'idle']
    ]
    for (const [c, kind] of minutes) {
      const m = values.get(c.key)
      if (typeof m === 'number') add(kind, endedAt, { minutes: m })
    }
    const checkedAll: WorkEvent[] = []
    for (const ev of made) {
      const checked = absorbCheck(validateWorkEvent(ev), rc, 'WorkEvent')
      if (checked) checkedAll.push(checked)
    }
    if (out.finish(rc)) {
      events.push(...checkedAll)
      addSet(file.sha256)
    }
  }

  // ── 묶음 검사 (서로 가리키는 값) ──
  const bundle = newLabelExport(
    { appVersion: 'xlsx-import', exportedAt: nowIso, pcId: ctx.pcId },
    {
      labelers: [{ id: labeler.id, name: labeler.name, qualification: labeler.qualification, organization: labeler.organization }],
      physicalDefects,
      fileAlignments: alignments,
      records,
      reviewIntervals: reviews,
      workEvents: events
    }
  )
  const whole = parseLabelExport(JSON.parse(JSON.stringify(bundle)))
  for (const e of whole.errors) out.errors.push(`가져온 기록 묶음 검사: ${e}`)
  // 기록마다의 경고는 줄 위치를 붙여 이미 냈다. 묶음 전체에 대한 경고(경로 없는 문구)만 더한다
  for (const w of whole.warnings) if (!/\]$/.test(w)) out.warnings.push(`가져온 기록 묶음: ${w}`)

  return {
    ok: out.errors.length === 0,
    labeler,
    labelSets: [...setKeys.values()],
    alignments,
    records,
    reviews,
    physicalDefects,
    events,
    groupQuestions: [...questions.values()],
    fileQuestions: [...fileQuestions.values()],
    questionErrors: out.questionErrors,
    fileMatch,
    form,
    errors: out.errors,
    warnings: out.warnings
  }
}
