/**
 * 양식 칸 지문 — 양식 생성기(scripts/label-template/make_template.py)가 문서 속성 'paut.columnsFingerprint' 에 적는 값과 같은 계산.
 *
 * 생성기 입력 JSON(tests/labels/templateColumns.test.ts 의 buildColumnsJson, 형식 버전 2)을 여기서도 같은 모양으로 만들고,
 * 파이썬 json.dumps(sort_keys=True, ensure_ascii=False, separators=(',', ':')) 와 같은 글자로 줄여 SHA-256 앞 12자를 쓴다.
 * 두 쪽 모양이 어긋나면 모든 양식에 '지문 다름' 경고가 붙는다 → 테스트(xlsxImport.test.ts)가 양식 속성 값과 대조한다.
 */
import { createHash } from 'node:crypto'
import { BOOL_LABEL, LABEL_SCHEMA_VERSION, LABEL_SHEETS, columnId, columnsOf, type LabelColumn } from '@shared/labels'

/** 생성기 입력 JSON 형식 이름·버전 (templateColumns.test.ts 와 같아야 함) */
export const COLUMNS_JSON_FORMAT = 'paut-label-columns'
export const COLUMNS_JSON_VERSION = 2

function columnJson(c: LabelColumn): Record<string, unknown> {
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
    requiredWhen: c.requiredWhen ? { key: c.requiredWhen.key, codes: [...c.requiredWhen.codes], fallback: c.requiredWhen.fallback ?? null } : null
  }
}

/** 생성기 입력 JSON (칸 정의 → 양식) */
export function labelColumnsJson(): Record<string, unknown> {
  return {
    format: COLUMNS_JSON_FORMAT,
    formatVersion: COLUMNS_JSON_VERSION,
    labelSchemaVersion: LABEL_SCHEMA_VERSION,
    source: 'app/src/shared/labels/columns.ts',
    boolLabels: { true: BOOL_LABEL.true, false: BOOL_LABEL.false },
    sheets: LABEL_SHEETS.map((s) => ({ id: s.id, name: s.name, help: s.help, maxRows: s.maxRows ?? null, columns: columnsOf(s.id).map(columnJson) }))
  }
}

/** 파이썬 json.dumps(sort_keys=True, ensure_ascii=False, separators=(',', ':')) 와 같은 글자 */
export function pythonCanonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`JSON 에 쓸 수 없는 숫자: ${v}`)
    return JSON.stringify(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(pythonCanonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${keys.map((k) => `${JSON.stringify(k)}:${pythonCanonicalJson(o[k])}`).join(',')}}`
}

/** 지금 칸 정의의 지문 (12자) */
export function labelColumnsFingerprint(): string {
  return createHash('sha256').update(pythonCanonicalJson(labelColumnsJson()), 'utf8').digest('hex').slice(0, 12)
}
