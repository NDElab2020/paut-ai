/**
 * 전문가 엑셀(기록양식 v1) 확정 규칙 — parseLabelWorkbook 결과를 카탈로그에 맞춘다.
 * 미리보기는 dryRun 으로 같은 함수를 불러 '확정하면 일어날 일'만 센다(쓰지 않음).
 *
 * 엑셀이 그 줄의 원본이다(0단계: 전문가가 OmniPC 로 판독해 엑셀에 적고, 고칠 때도 엑셀을 고쳐 다시 가져온다).
 * 파서는 늘 같은 UUID(결정적 UUID v5)와 versions = [{ 이 PC 칸, 1 }] 을 낸다. 그래서 버전 벡터만으로는 '엑셀을 고친 것'과
 * '앱·다른 PC 에서 고친 것'을 가를 수 없다. 이 PC 는 줄마다 '지난번에 가져온 엑셀 줄의 지문과 그때의 versions'
 * (label_import_marks)를 기억해 세 갈래로 비교한다(3-way).
 *
 * - 라벨러: 없으면 등록. 있으면 이 PC 의 정보를 그대로 두고, 다르면 경고.
 * - 지시 기록 (라벨 세트 = sha256·라벨러·지침서·단계 의 것):
 *   없음 → 새로. 내용이 같음 → 그대로(앱이 계산한 groupingId 는 비교에서 뺌).
 *   앱에서 다시 찍은 기록(coordSource = 'app-anchor') → 그대로 둠(kept, 엑셀 값으로 덮지 않음).
 *   지움 표시된 기록: 엑셀이 지운 것(지난 가져오기에서 빠져 지움)이고 그 뒤 손대지 않았으면 → 되살림(update).
 *     이 PC 에서(앱·JSON 으로) 지운 것은 그대로 둠(kept).
 *   내용이 다름:
 *     엑셀 줄이 지난번과 같음 → 앱·다른 PC 에서 고친 것이라 그대로 둠(kept).
 *     엑셀만 바뀜(저장본은 지난 가져오기 뒤 그대로) → 엑셀 값으로 고침(update, versions 에 이 PC +1).
 *       단, 스캔 범위가 겹치지 않거나 기록 구분이 바뀌면 '지시 번호가 다른 지시를 가리킴'으로 보고 충돌로 둔다.
 *     둘 다 바뀜(또는 가져온 기준이 없음) → 충돌로 둘 다 보관. 전에 '내 것'으로 고른 같은 값이면 그대로 둠.
 *   고칠 때는 저장본에 엑셀이 아는 칸만 덮는다 → 새 버전 앱이 보낸 '모르는 칸'은 지켜진다.
 *   엑셀에 없는 줄 → 범위 안 라벨 세트의 '엑셀에서 온 기록'(imported-mm + UUID v5) 가운데 지난 가져오기 뒤 손대지 않은 것만
 *     지움 표시(remove, 그 관측 행도). 앱·다른 PC 에서 고친 것은 그대로 두고 경고한다.
 *   범위 = 지시·검토구간·작업시간 줄이 있는 파일 + '파일' 시트에 줄이 있는 파일 (이 판독자·지침서·단계).
 *   한 파일의 줄을 엑셀 두 개로 나눠 적으면 서로 지울 수 있다(미리보기 경고에 건수가 나옴).
 * - 검토 구간: 지시 기록과 같다(자동 풀림 released 는 비교에서 뺌, app-anchor·번호 바뀜 검사는 없음).
 *   앱에서 만든 기록·구간은 무작위 UUID v4 라 건드리지 않는다.
 * - 파일 정렬(키 sha256, 라벨러마다가 아님): 없음 → 새로. 값이 같음(적은 사람·메모·근거·파일 이름은 뺌) → 그대로.
 *   같은 사람(enteredBy)이 적은 것 → 엑셀 값으로 고침. 다른 사람 → 충돌로 둘 다 보관(충돌 목록에서 고름).
 * - 물리 결함(키 시편·ID): 없음 → 새로. 같음 → 그대로. 다름 → 충돌로 둘 다 보관.
 * - 작업 이벤트(추가 전용): 없음 → 새로. 같음 → 그대로. 다름 → 고칠 수 없어 그대로 둠(kept, 경고).
 * 충돌 사본은 updatedAt 을 비워 넣는다 — 같은 엑셀을 다시 확정해도 같은 충돌을 두 번 만들지 않게. 출처 이름은 엑셀 파일 이름.
 * 같은 들어온 값을 전에 '내 것'으로 풀었으면 다시 묻지 않는다(kept).
 * 확정은 한 트랜잭션이다. 같은 엑셀을 다시 확정하면 모두 '그대로'다(멱등).
 *
 * 묶어 둔 세트(frozen — 서비스가 정함: 제출(잠금)한 블라인드 세트, 검수 확정 세트가 있는 파일의 확정 단계, 잠긴 시험 파일의 확정 단계):
 *   그 세트의 지시 기록·검토 구간은 새로·고침·지움 표시·충돌 없이 모두 '그대로 둠'(kept, 이유 표시)이다. 앱 저장(guardSet)과 같은 보호.
 * 앱에서 만든 같은 지시(무작위 UUID — '설계값 대조 시작' 사본 등)가 그 세트에 이미 있으면 엑셀 줄을 새로 만들지 않는다(kept):
 *   지시 기록은 같은 지시 번호, 검토 구간은 같은 구분·그룹·스캔 범위로 본다(같은 지시가 둘이 되지 않게).
 */
import {
  LABEL_ENTITY_NAME,
  labelContentHash,
  labelEntityKey,
  sameLabelContent,
  type Catalog,
  type LabelEntityMap,
  type LabelImportMark,
  type LabelStoreEntity
} from '@core/catalog'
import type { LabelWorkbookImport } from '@core/labels/xlsx'
import type { LabelEntityKind, LabelPlanCounts, LabelWorkbookChange } from '@shared/api'
import { LABEL_ENTITY_KINDS } from '@shared/api'
import { AppError } from '@shared/errors'
import { labelSetId, sameLabelSet } from '@shared/labels/factory'
import type { FileAlignment, IndicationRecord, LabelSetKey, PhysicalDefect, ReviewInterval, VersionEntry, WorkEvent } from '@shared/labels/types'
import {
  validateFileAlignment,
  validateIndicationRecord,
  validatePhysicalDefect,
  validateReviewInterval,
  type LabelCheckResult
} from '@shared/labels/validate'
import { bumpVersions, compareVersions, versionTotal } from '@shared/labels/versions'

export type WorkbookAction = keyof LabelPlanCounts

export interface WorkbookApplyOptions {
  /** 이 PC 의 ID ('마지막으로 고친 PC') */
  pcId: string
  /** 버전 벡터 칸 ('PC ID:복제본 ID'). 없으면 pcId */
  versionSlot?: string
  /** 기록용 시각 (updatedAt) */
  now: string
  /** true 면 쓰지 않고 세기만 */
  dryRun: boolean
  /** 충돌 출처 이름 (엑셀 파일 이름) */
  sourceName?: string | null
  /**
   * 엑셀로 바꾸지 않을 라벨 세트면 그 이유(미리보기 '그대로 둠' 줄의 이유 글자), 아니면 null.
   * 그 세트의 지시 기록·검토 구간은 새로·고침·지움 표시·충돌 없이 모두 '그대로 둠'이 된다.
   */
  frozen?: (set: LabelSetKey) => string | null
}

export interface WorkbookApplyResult {
  plan: Record<LabelEntityKind, LabelPlanCounts>
  totals: LabelPlanCounts
  /** 이번에 새로 등록한(dryRun 이면 등록할) 라벨러 */
  registeredLabelerId: string | null
  /** 새로 보관한 충돌 (dryRun 이면 빈 목록) */
  conflictIds: number[]
  warnings: string[]
  /** 고침·지움 표시·충돌·그대로 둠 항목 (미리보기에서 확정 전에 보여 준다) */
  changes: LabelWorkbookChange[]
  /** 묶어 둔 세트(opts.frozen) 때문에 그대로 둔 것이 있으면 그 이유들 (중복 없이) */
  frozen: string[]
}

type MarkEntity = 'record' | 'review-interval'

interface Step<E extends LabelStoreEntity> {
  entity: E
  action: WorkbookAction
  /** create·update·remove 에 쓸 값, conflict 의 들어온 사본 */
  value: LabelEntityMap[E] | null
  /** conflict 의 내 것 */
  stored: LabelEntityMap[E] | null
  /** 확정할 때 남길 엑셀 가져오기 기준 */
  mark?: Omit<LabelImportMark, 'markedAt'> | null
  /** 지움 표시할 때 그 기록의 관측 행도 */
  tombstoneObservations?: boolean
}

type AnyStep = { [E in LabelStoreEntity]: Step<E> }[LabelStoreEntity]

const MAX_CHANGES = 500

export function emptyPlanCounts(): LabelPlanCounts {
  return { create: 0, update: 0, unchanged: 0, kept: 0, conflict: 0, remove: 0 }
}

export function emptyPlan(): Record<LabelEntityKind, LabelPlanCounts> {
  return Object.fromEntries(LABEL_ENTITY_KINDS.map((k) => [k, emptyPlanCounts()])) as Record<LabelEntityKind, LabelPlanCounts>
}

/** 결정적 UUID v5 (엑셀 가져오기가 만든 것). 앱에서 만든 것은 무작위 v4 */
export function isWorkbookUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)
}

function checked<T>(r: LabelCheckResult<T>, what: string): T {
  if (!r.ok || r.value === null) throw new AppError('INVALID_ARGUMENT', `${what} 값을 만들지 못했습니다: ${r.errors.slice(0, 3).join(' / ')}`)
  return r.value
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 저장본에 엑셀 값을 덮는다(엑셀이 내는 칸만). 저장본에만 있는 칸(새 버전 앱의 모르는 칸 등)은 그대로 남는다.
 * 객체 칸은 안쪽까지 같은 규칙, 목록·값 칸은 엑셀 값.
 */
export function mergeKnown<T>(stored: T, incoming: T): T {
  const out: Record<string, unknown> = { ...(stored as Record<string, unknown>) }
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    const old = out[k]
    out[k] = isPlain(old) && isPlain(v) ? mergeKnown(old, v) : v
  }
  return out as T
}

/** 파일 정렬의 '값' 비교에서 뺄 칸 (적은 사람·메모·근거·파일 이름) */
function alignmentCore(a: FileAlignment): Record<string, unknown> {
  const { enteredBy: _e, note: _n, evidence: _v, fileName: _f, ...rest } = a
  return rest
}

/** 같은 지시인지 의심: 스캔 범위가 겹치지 않거나(맞닿음은 겹침) 기록 구분이 바뀜 */
function identityChanged(a: IndicationRecord, b: IndicationRecord): boolean {
  const a0 = Math.min(a.derived.scanStartMm, a.derived.scanEndMm)
  const a1 = Math.max(a.derived.scanStartMm, a.derived.scanEndMm)
  const b0 = Math.min(b.derived.scanStartMm, b.derived.scanEndMm)
  const b1 = Math.max(b.derived.scanStartMm, b.derived.scanEndMm)
  return Math.min(a1, b1) < Math.max(a0, b0) || a.kind !== b.kind
}

/** 같은 검토 구간인지 (앱에서 만든 사본과 엑셀 줄): 구분·그룹·스캔 범위가 같음 */
function sameReviewSpan(a: ReviewInterval, b: ReviewInterval): boolean {
  return a.kind === b.kind && a.groupId === b.groupId && a.scanStartMm === b.scanStartMm && a.scanEndMm === b.scanEndMm
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100)
}

class Messages {
  private readonly groups = new Map<string, string[]>()
  add(reason: string, item: string): void {
    const list = this.groups.get(reason) ?? []
    list.push(item)
    this.groups.set(reason, list)
  }
  lines(): string[] {
    return [...this.groups.entries()].map(([reason, items]) => {
      const shown = items.slice(0, 5).join(', ')
      return `${reason} ${items.length}건: ${shown}${items.length > 5 ? ` 외 ${items.length - 5}건` : ''}`
    })
  }
}

/**
 * 엑셀 결과를 카탈로그에 맞춘다 (dryRun 이면 세기만).
 * parsed.ok 가 거짓이어도 세기는 하지만, 쓰기(dryRun = false)는 부르는 쪽이 막는다.
 */
export function applyWorkbook(catalog: Catalog, parsed: LabelWorkbookImport, opts: WorkbookApplyOptions): WorkbookApplyResult {
  const L = catalog.labels
  const slot = opts.versionSlot?.trim() || opts.pcId
  const msgs = new Messages()
  const warnings: string[] = []
  const steps: AnyStep[] = []
  const changes: LabelWorkbookChange[] = []

  const fileNames = new Map<string, string>()
  for (const a of parsed.alignments) fileNames.set(a.sha256, a.fileName)
  const fileName = (sha: string): string => {
    const hit = fileNames.get(sha)
    if (hit) return hit
    const name = catalog.findFileBySha256(sha)?.storedFileName ?? L.getFileAlignment(sha)?.fileName ?? sha.slice(0, 12)
    fileNames.set(sha, name)
    return name
  }
  const recName = (r: IndicationRecord): string =>
    `${fileName(r.sha256)} ${r.externalRef ? `지시 ${r.externalRef}` : `스캔 ${fmt(r.derived.scanStartMm)}–${fmt(r.derived.scanEndMm)} mm`}`
  const revName = (v: ReviewInterval): string => `${fileName(v.sha256)} ${fmt(v.scanStartMm)}–${fmt(v.scanEndMm)} mm`
  /** 같은 들어온 값을 전에 '내 것'으로 골랐는지 (그러면 다시 묻지 않는다) */
  const decidedMine = <E extends LabelStoreEntity>(entity: E, theirs: LabelEntityMap[E]): boolean =>
    L.listConflicts({ entity, key: labelEntityKey(entity, theirs), pendingOnly: false }).some(
      (c) => c.resolution === 'mine' && sameLabelContent(c.theirs, theirs)
    )
  const note = (action: LabelWorkbookChange['action'], entity: LabelEntityKind, sha: string | null, name: string, reason: string): void => {
    msgs.add(reason, name)
    if (changes.length < MAX_CHANGES) changes.push({ action, entity, sha256: sha, name, reason })
  }

  /** 묶어 둔 세트의 이유 (세트마다 한 번 묻는다) · 그 때문에 그대로 둔 것이 있는 이유 */
  const frozenCache = new Map<string, string | null>()
  const frozenHit = new Set<string>()
  const frozenOf = (set: LabelSetKey): string | null => {
    if (!opts.frozen) return null
    const id = labelSetId(set)
    let why = frozenCache.get(id)
    if (why === undefined) {
      why = opts.frozen(set)
      frozenCache.set(id, why)
    }
    return why
  }
  /** 앱에서 만든(무작위 UUID) 살아 있는 기록·구간 (세트마다 한 번 읽음) — 엑셀 줄과 같은 지시가 둘이 되지 않게 */
  const appMade = new Map<string, { records: IndicationRecord[]; reviews: ReviewInterval[] }>()
  const appMadeOf = (set: LabelSetKey): { records: IndicationRecord[]; reviews: ReviewInterval[] } => {
    const id = labelSetId(set)
    let hit = appMade.get(id)
    if (!hit) {
      hit = {
        records: L.listRecords({ set }).filter((x) => !x.deleted && !isWorkbookUuid(x.uuid)),
        reviews: L.listReviewIntervals({ set }).filter((x) => !x.deleted && !isWorkbookUuid(x.uuid))
      }
      appMade.set(id, hit)
    }
    return hit
  }

  /** 고친 값의 기록용 칸: 저장된 versions + 이 PC 칸 1회, 처음 만든 시각은 저장된 것 */
  function edited<T extends { versions: VersionEntry[] }>(value: T, stored: T): T {
    const versions = bumpVersions(stored.versions, slot)
    const o: Record<string, unknown> = { ...value, versions, revision: versionTotal(versions), pcId: opts.pcId }
    if ('updatedAt' in o) o.updatedAt = opts.now
    const created = (stored as { createdAt?: unknown }).createdAt
    if ('createdAt' in o && typeof created === 'string') o.createdAt = created
    return o as T
  }
  /** 충돌 사본: 저장본 versions 그대로 (해결할 때 둘을 합친다), updatedAt 비움 (같은 엑셀이면 같은 사본) */
  function theirsCopy<T extends { versions: VersionEntry[] }>(value: T, stored: T): T {
    const o: Record<string, unknown> = { ...value, versions: stored.versions, revision: versionTotal(stored.versions), pcId: opts.pcId }
    if ('updatedAt' in o) o.updatedAt = null
    const created = (stored as { createdAt?: unknown }).createdAt
    if ('createdAt' in o) o.createdAt = typeof created === 'string' ? created : null
    return o as T
  }
  const freshMark = (rowHash: string, versions: VersionEntry[], deletedByImport = false): Omit<LabelImportMark, 'markedAt'> => ({
    rowHash,
    versions,
    deletedByImport
  })

  // ── 라벨러 ──
  let registeredLabelerId: string | null = null
  const reader = parsed.labeler
  if (reader) {
    const mine = L.getLabeler(reader.id)
    if (!mine) registeredLabelerId = reader.id
    else if (mine.name !== reader.name || mine.qualification !== reader.qualification || mine.organization !== reader.organization) {
      warnings.push(`라벨러 '${reader.id}' 정보가 이 PC 에 등록된 것과 다릅니다. 등록된 정보(${mine.name}${mine.qualification ? ` · ${mine.qualification}` : ''})를 그대로 둡니다.`)
    }
  }

  /**
   * 지시 기록·검토 구간 공통: 저장본·엑셀 줄·지난 가져오기 기준을 견준다.
   * prep = 비교용 값 (계산 칸을 저장본 것으로 맞춘 것)
   */
  function reconcile<E extends MarkEntity>(
    entity: E,
    incoming: LabelEntityMap[E],
    stored: LabelEntityMap[E],
    name: string,
    prep: (merged: LabelEntityMap[E]) => LabelEntityMap[E],
    validate: (v: unknown) => LabelCheckResult<LabelEntityMap[E]>,
    identity: ((s: LabelEntityMap[E], m: LabelEntityMap[E]) => boolean) | null
  ): void {
    const key = labelEntityKey(entity, incoming)
    const what = LABEL_ENTITY_NAME[entity]
    const mark = L.getImportMark(entity, key)
    const h = labelContentHash(incoming)
    const merged = prep(mergeKnown(stored, incoming))
    const sha = (incoming as { sha256: string }).sha256
    if (stored.deleted) {
      const byImport = mark?.deletedByImport === true && compareVersions(stored.versions, mark.versions) === 'same'
      if (byImport) {
        const value = checked(validate(edited({ ...merged, deleted: false }, stored)), what)
        steps.push({ entity, action: 'update', value, stored, mark: freshMark(h, value.versions) } as AnyStep)
        note('update', entity, sha, name, `엑셀에 다시 나타나 되살릴 ${what}`)
      } else {
        steps.push({ entity, action: 'kept', value: null, stored } as AnyStep)
        note('kept', entity, sha, name, `이 PC 에서 지운 것이라 되살리지 않은 ${what}`)
      }
      return
    }
    if (sameLabelContent(stored, merged)) {
      const refresh = !mark || mark.rowHash !== h || mark.deletedByImport || compareVersions(mark.versions, stored.versions) !== 'same'
      steps.push({ entity, action: 'unchanged', value: null, stored, mark: refresh ? freshMark(h, stored.versions) : null } as AnyStep)
      return
    }
    const excelChanged = mark ? mark.rowHash !== h : true
    const appEdited = mark ? compareVersions(stored.versions, mark.versions) !== 'same' : true
    if (!excelChanged) {
      steps.push({ entity, action: 'kept', value: null, stored } as AnyStep)
      note('kept', entity, sha, name, `엑셀 줄은 지난번과 같고 앱·다른 PC 에서 고친 것이라 그대로 둔 ${what}`)
      return
    }
    const theirs = checked(validate(theirsCopy(merged, stored)), what)
    if (!appEdited && !(identity && identity(stored, merged))) {
      const value = checked(validate(edited(merged, stored)), what)
      steps.push({ entity, action: 'update', value, stored, mark: freshMark(h, value.versions) } as AnyStep)
      note('update', entity, sha, name, `엑셀 값으로 고칠 ${what}`)
      return
    }
    if (decidedMine(entity, theirs)) {
      steps.push({ entity, action: 'kept', value: null, stored, mark: freshMark(h, stored.versions) } as AnyStep)
      note('kept', entity, sha, name, `전에 '내 것'으로 고른 ${what}이라 그대로 둔 것`)
      return
    }
    steps.push({ entity, action: 'conflict', value: theirs, stored } as AnyStep)
    note(
      'conflict',
      entity,
      sha,
      name,
      !appEdited
        ? `엑셀의 ${what} 번호가 다른 지시를 가리키는 것 같아(스캔 범위가 겹치지 않거나 구분이 바뀜) 충돌로 둔 것`
        : mark
          ? `엑셀과 앱(또는 다른 PC)에서 따로 고쳐 충돌로 둔 ${what}`
          : `이 PC 에서 엑셀로 가져온 적이 없는 ${what}과 내용이 달라 충돌로 둔 것`
    )
  }

  // ── 지시 기록 ──
  const seenRecords = new Set<string>()
  for (const r of parsed.records) {
    seenRecords.add(r.uuid)
    const stored = L.getRecord(r.uuid)
    const frozen = frozenOf(r)
    if (frozen) {
      const same = stored !== null && sameLabelSet(stored, r) && !stored.deleted && sameLabelContent(stored, { ...mergeKnown(stored, r), groupingId: stored.groupingId })
      steps.push({ entity: 'record', action: same ? 'unchanged' : 'kept', value: null, stored })
      if (!same) {
        frozenHit.add(frozen)
        note('kept', 'record', r.sha256, recName(r), `${frozen} — 그대로 둔 지시 기록`)
      }
      continue
    }
    if (!stored) {
      const twin = r.externalRef !== null && r.externalRef !== '' ? appMadeOf(r).records.find((x) => x.externalRef === r.externalRef) : undefined
      if (twin) {
        steps.push({ entity: 'record', action: 'kept', value: null, stored: twin })
        note('kept', 'record', r.sha256, recName(r), "앱에서 만든 같은 번호 지시('설계값 대조 시작' 사본 등)가 이 세트에 있어 새로 만들지 않은 지시 기록 — 고칠 것은 앱에서 고치세요")
        continue
      }
      steps.push({ entity: 'record', action: 'create', value: r, stored: null, mark: freshMark(labelContentHash(r), r.versions) })
      continue
    }
    if (!sameLabelSet(stored, r)) {
      steps.push({ entity: 'record', action: 'kept', value: null, stored })
      note('kept', 'record', r.sha256, recName(r), '다른 라벨 세트에 같은 UUID 가 있어 그대로 둔 지시 기록')
      continue
    }
    if (stored.coordSource === 'app-anchor') {
      steps.push({ entity: 'record', action: 'kept', value: null, stored })
      note('kept', 'record', r.sha256, recName(r), '앱에서 다시 찍은 기록이라 엑셀 값으로 덮지 않은 지시')
      continue
    }
    // 그룹 짓기 ID 는 앱이 계산하는 칸이라 저장본 값을 이어 쓴다
    reconcile('record', r, stored, recName(r), (m) => ({ ...m, groupingId: stored.groupingId }), validateIndicationRecord, identityChanged)
  }

  // ── 검토 구간 ──
  const seenReviews = new Set<string>()
  for (const v of parsed.reviews) {
    seenReviews.add(v.uuid)
    const stored = L.getReviewInterval(v.uuid)
    const frozen = frozenOf(v)
    if (frozen) {
      const same = stored !== null && sameLabelSet(stored, v) && !stored.deleted && sameLabelContent(stored, { ...mergeKnown(stored, v), released: stored.released })
      steps.push({ entity: 'review-interval', action: same ? 'unchanged' : 'kept', value: null, stored })
      if (!same) {
        frozenHit.add(frozen)
        note('kept', 'review-interval', v.sha256, revName(v), `${frozen} — 그대로 둔 검토 구간`)
      }
      continue
    }
    if (!stored) {
      const twin = appMadeOf(v).reviews.find((x) => sameReviewSpan(x, v))
      if (twin) {
        steps.push({ entity: 'review-interval', action: 'kept', value: null, stored: twin })
        note('kept', 'review-interval', v.sha256, revName(v), "앱에서 만든 같은 검토 구간('설계값 대조 시작' 사본 등)이 이 세트에 있어 새로 만들지 않은 검토 구간")
        continue
      }
      steps.push({ entity: 'review-interval', action: 'create', value: v, stored: null, mark: freshMark(labelContentHash(v), v.versions) })
      continue
    }
    if (!sameLabelSet(stored, v)) {
      steps.push({ entity: 'review-interval', action: 'kept', value: null, stored })
      note('kept', 'review-interval', v.sha256, revName(v), '다른 라벨 세트에 같은 UUID 가 있어 그대로 둔 검토 구간')
      continue
    }
    reconcile('review-interval', v, stored, revName(v), (m) => ({ ...m, released: stored.released }), validateReviewInterval, null)
  }

  // ── 엑셀에서 빠진 줄 (범위 안 라벨 세트, 엑셀에서 온 것만) ──
  const scope = new Map<string, LabelSetKey>()
  for (const set of parsed.labelSets) scope.set(labelSetId(set), set)
  if (reader) {
    for (const a of parsed.alignments) {
      const set: LabelSetKey = { sha256: a.sha256, labelerId: reader.id, guidelineVersion: reader.guidelineVersion, readingStage: reader.readingStage }
      scope.set(labelSetId(set), set)
    }
  }
  for (const set of [...scope.values()].sort((x, y) => (labelSetId(x) < labelSetId(y) ? -1 : 1))) {
    const frozen = frozenOf(set)
    for (const s of L.listRecords({ set })) {
      if (seenRecords.has(s.uuid) || s.coordSource !== 'imported-mm' || !isWorkbookUuid(s.uuid)) continue
      if (frozen) {
        frozenHit.add(frozen)
        steps.push({ entity: 'record', action: 'kept', value: null, stored: s })
        note('kept', 'record', s.sha256, recName(s), `${frozen} — 엑셀에서 빠졌지만 지우지 않은 지시 기록`)
        continue
      }
      const mark = L.getImportMark('record', s.uuid)
      if (!mark || compareVersions(s.versions, mark.versions) !== 'same') {
        steps.push({ entity: 'record', action: 'kept', value: null, stored: s })
        note('kept', 'record', s.sha256, recName(s), '엑셀에서 빠졌지만 앱·다른 PC 에서 고친(또는 이 PC 에서 가져온 적 없는) 기록이라 지우지 않은 지시')
        continue
      }
      const value = checked(validateIndicationRecord(edited({ ...s, deleted: true }, s)), LABEL_ENTITY_NAME.record)
      steps.push({ entity: 'record', action: 'remove', value, stored: s, mark: freshMark(mark.rowHash, value.versions, true), tombstoneObservations: true })
      note('remove', 'record', s.sha256, recName(s), '엑셀에서 빠져 지움 표시할 지시 기록')
    }
    for (const s of L.listReviewIntervals({ set })) {
      if (seenReviews.has(s.uuid) || !isWorkbookUuid(s.uuid)) continue
      if (frozen) {
        frozenHit.add(frozen)
        steps.push({ entity: 'review-interval', action: 'kept', value: null, stored: s })
        note('kept', 'review-interval', s.sha256, revName(s), `${frozen} — 엑셀에서 빠졌지만 지우지 않은 검토 구간`)
        continue
      }
      const mark = L.getImportMark('review-interval', s.uuid)
      if (!mark || compareVersions(s.versions, mark.versions) !== 'same') {
        steps.push({ entity: 'review-interval', action: 'kept', value: null, stored: s })
        note('kept', 'review-interval', s.sha256, revName(s), '엑셀에서 빠졌지만 앱·다른 PC 에서 고친(또는 이 PC 에서 가져온 적 없는) 구간이라 지우지 않은 검토 구간')
        continue
      }
      const value = checked(validateReviewInterval(edited({ ...s, deleted: true }, s)), LABEL_ENTITY_NAME['review-interval'])
      steps.push({ entity: 'review-interval', action: 'remove', value, stored: s, mark: freshMark(mark.rowHash, value.versions, true) })
      note('remove', 'review-interval', s.sha256, revName(s), '엑셀에서 빠져 지움 표시할 검토 구간')
    }
  }

  // ── 파일 정렬 ──
  for (const a of parsed.alignments) {
    const stored = L.getFileAlignment(a.sha256)
    if (!stored) {
      steps.push({ entity: 'file-alignment', action: 'create', value: a, stored: null })
      continue
    }
    const merged = mergeKnown(stored, a)
    if (sameLabelContent(alignmentCore(stored), alignmentCore(merged))) {
      steps.push({ entity: 'file-alignment', action: 'unchanged', value: null, stored })
    } else if (stored.enteredBy !== null && stored.enteredBy === a.enteredBy) {
      const value = checked(validateFileAlignment(edited(merged, stored)), LABEL_ENTITY_NAME['file-alignment'])
      steps.push({ entity: 'file-alignment', action: 'update', value, stored })
      note('update', 'file-alignment', a.sha256, fileName(a.sha256), '엑셀 값으로 고칠 파일 정렬')
    } else if (decidedMine('file-alignment', { ...merged, updatedAt: null })) {
      steps.push({ entity: 'file-alignment', action: 'kept', value: null, stored })
      note('kept', 'file-alignment', a.sha256, fileName(a.sha256), "전에 '내 것'으로 고른 파일 정렬이라 그대로 둔 것")
    } else {
      steps.push({ entity: 'file-alignment', action: 'conflict', value: { ...merged, updatedAt: null }, stored })
      note('conflict', 'file-alignment', a.sha256, fileName(a.sha256), `다른 사람(${stored.enteredBy ?? '모름'})이 적은 값과 달라 충돌로 둔 파일 정렬`)
    }
  }

  // ── 물리 결함 ──
  for (const p of parsed.physicalDefects) {
    const stored = L.getPhysicalDefect(p.specimenId, p.id)
    const name = `${p.specimenId} ${p.id}`
    if (!stored) {
      steps.push({ entity: 'physical-defect', action: 'create', value: p, stored: null })
      continue
    }
    const merged = mergeKnown(stored, p)
    if (sameLabelContent(stored, merged)) steps.push({ entity: 'physical-defect', action: 'unchanged', value: null, stored })
    else if (decidedMine('physical-defect', { ...merged, updatedAt: null })) {
      steps.push({ entity: 'physical-defect', action: 'kept', value: null, stored })
      note('kept', 'physical-defect', null, name, "전에 '내 것'으로 고른 물리 결함이라 그대로 둔 것")
    } else {
      steps.push({ entity: 'physical-defect', action: 'conflict', value: { ...merged, updatedAt: null } as PhysicalDefect, stored })
      note('conflict', 'physical-defect', null, name, '이 PC 값과 달라 충돌로 둔 물리 결함')
    }
  }

  // ── 작업 이벤트 (추가 전용) ──
  for (const e of parsed.events) {
    const stored = L.getEntity('work-event', e.uuid)
    if (!stored) steps.push({ entity: 'work-event', action: 'create', value: e, stored: null })
    else if (sameLabelContent(stored, mergeKnown(stored, e))) steps.push({ entity: 'work-event', action: 'unchanged', value: null, stored })
    else {
      steps.push({ entity: 'work-event', action: 'kept', value: null, stored: stored as WorkEvent })
      note('kept', 'work-event', e.sha256, `${fileName(e.sha256 ?? '')} ${e.at.slice(0, 16).replace('T', ' ')}`, '작업 이벤트는 고칠 수 없어 이 PC 값을 그대로 둔 작업시간 줄')
    }
  }

  const plan = emptyPlan()
  for (const s of steps) plan[s.entity][s.action]++
  const totals = emptyPlanCounts()
  for (const c of Object.values(plan)) for (const k of Object.keys(totals) as WorkbookAction[]) totals[k] += c[k]

  const conflictIds: number[] = []
  if (!opts.dryRun) {
    const ctx = { pcId: opts.pcId, versionSlot: slot }
    catalog.transaction(() => {
      if (reader && registeredLabelerId) {
        L.registerLabeler({ id: reader.id, name: reader.name, qualification: reader.qualification, organization: reader.organization })
      }
      for (const s of steps) {
        if (s.action === 'create' || s.action === 'update' || s.action === 'remove') {
          if (s.value === null) continue
          L.putEntity(s.entity, s.value as never)
          if (s.tombstoneObservations && s.entity === 'record') {
            for (const o of L.listObservations({ recordUuids: [(s.value as IndicationRecord).uuid] })) L.deleteObservation(o.recordUuid, o.groupId, o.leg, ctx)
          }
        } else if (s.action === 'conflict' && s.value !== null && s.stored !== null) {
          const r = L.addConflict({
            entity: s.entity,
            mine: s.stored as never,
            theirs: s.value as never,
            sourcePcId: null,
            sourceName: opts.sourceName ?? '엑셀',
            sourceExportedAt: null
          })
          if (r.created) conflictIds.push(r.id)
        }
        if (s.mark && (s.entity === 'record' || s.entity === 'review-interval')) {
          const key = labelEntityKey(s.entity, (s.value ?? s.stored) as never)
          L.setImportMark(s.entity, key, s.mark)
        }
      }
    })
  }

  return { plan, totals, registeredLabelerId, conflictIds, warnings: [...warnings, ...msgs.lines()], changes, frozen: [...frozenHit] }
}
