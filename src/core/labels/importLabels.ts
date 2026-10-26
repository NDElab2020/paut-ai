/**
 * 라벨 JSON 가져오기·병합 — 다른 PC 에서 내보낸 LabelExportFile 을 이 PC 카탈로그에 합친다.
 *
 * 순서
 * 1. parseLabelExport(validate.ts)로 검사한다. 오류가 하나라도 있으면 아무것도 쓰지 않는다.
 *    더 새 schemaVersion 은 여기서 거부된다. 모르는 칸은 보존된 채 그대로 저장된다.
 * 2. 한 트랜잭션 안에서 저장 단위마다 같은 키(UUID 등)의 내 것과 견준다(versions.ts compareVersions).
 *    - 내 것이 없음 → 새로 넣음 (새로)
 *    - 들어온 것이 내 것을 포함 → 덮어씀 (갱신)
 *    - 내 것이 들어온 것을 포함, 또는 완전히 같음 → 그대로
 *    - 어느 쪽도 포함하지 않음(양쪽에서 따로 고침), 또는 횟수는 같은데 내용이 다름 → 충돌.
 *      내 것은 그대로 두고 들어온 것을 충돌 테이블에 둘 다 보관한다.
 *      단, 버전만 갈리고 내용(기록용 칸 제외)이 같으면 버전 벡터만 합친다(자동 합침, 갱신으로 셈).
 * 3. 같은 파일을 두 번 가져와도 결과가 같다(멱등): 두 번째에는 모두 '그대로'다. 이미 보관한 충돌 사본도 다시 만들지 않는다.
 *
 * 작업 이벤트는 추가 전용이다(버전 없음): 없으면 넣고, 같으면 그대로, 내용이 다르면 충돌로 보관한다.
 * 라벨러 정보는 버전이 없다: 없으면 넣고, 다르면 내 것을 두고 경고한다.
 * 좌표 규칙이 다른 파일은 경고만 낸다(앵커에서 다시 계산하고 '재확인 필요'를 붙이는 일은 1b 화면 단계).
 *
 * 충돌 해결(resolveLabelConflict): 내 것 / 들어온 것 / 둘 다 남기기. 어느 쪽이든 두 버전 벡터를 합친 뒤
 * 이 PC 횟수를 1 올려 저장한다 — 그래서 같은 파일을 다시 가져와도 같은 충돌이 되살아나지 않고, 다른 PC 로 퍼진다.
 * 버전이 없는 작업 이벤트는 '내 것'·'둘 다'로 푼 들어온 사본을 기억해 다시 묻지 않는다(addConflict).
 * '둘 다'는 들어온 쪽에 새 UUID 를 준다(지시 기록·검토 구간·작업 이벤트만).
 *
 * 바꿀 수 없는 칸: 같은 UUID 의 기록·검토 구간인데 파일·라벨러·지침서·단계(라벨 세트 키)가 다르면 가져오기 전체를 막는다
 * (직접 저장의 setKeyChanged 와 같은 규칙. 조용히 다른 라벨러 세트로 옮겨지지 않게).
 */
import {
  LABEL_ENTITY_NAME,
  identicalLabel,
  labelEntityKey,
  sameLabelContent,
  type Catalog,
  type LabelConflict,
  type LabelConflictResolution,
  type LabelEntityMap,
  type LabelStoreEntity,
  type LabelWriteContext
} from '@core/catalog'
import { AppError } from '@shared/errors'
import type { LabelExportFile, VersionEntry } from '@shared/labels/types'
import { parseLabelExport, parseLabelExportJson, validateIndicationRecord, validateReviewInterval, validateWorkEvent } from '@shared/labels/validate'
import { sameLabelSet } from '@shared/labels/factory'
import { bumpVersions, compareVersions, mergeVersions, versionTotal } from '@shared/labels/versions'
import { slotOf } from '@core/catalog'
import { newLabelUuid } from './store'

export type LabelImportEntity = 'labeler' | LabelStoreEntity

export interface LabelImportCounts {
  /** 새로 넣음 */
  created: number
  /** 들어온 것이 새것이라 덮어씀 (자동 합침 포함) */
  updated: number
  /** 바뀐 것 없음 (내 것이 새것이거나 같음, 이미 보관한 충돌 사본) */
  unchanged: number
  /** 새로 보관한 충돌 */
  conflicts: number
}

export interface LabelImportReport extends LabelImportCounts {
  /** 오류 없이 반영했는지 */
  ok: boolean
  /** 버전만 갈리고 내용이 같아 버전 벡터만 합친 수 (updated 에 포함) */
  autoMerged: number
  byEntity: Record<LabelImportEntity, LabelImportCounts>
  /** 새로 보관한 충돌 */
  conflictItems: { entity: LabelStoreEntity; key: string; conflictId: number }[]
  errors: string[]
  warnings: string[]
  /** 가져온 뒤 DB 전체에 남은 풀지 않은 충돌 수 */
  pendingConflicts: number
  /** 파일 머리 (검사를 통과했을 때) */
  source: Pick<LabelExportFile, 'pcId' | 'appVersion' | 'exportedAt' | 'schemaVersion' | 'rulesVersion'> | null
}

const ENTITY_ORDER: readonly LabelImportEntity[] = [
  'labeler',
  'physical-defect',
  'file-alignment',
  'record',
  'observation',
  'review-interval',
  'work-event'
]

function emptyCounts(): LabelImportCounts {
  return { created: 0, updated: 0, unchanged: 0, conflicts: 0 }
}

function emptyReport(): LabelImportReport {
  const byEntity = Object.fromEntries(ENTITY_ORDER.map((e) => [e, emptyCounts()])) as Record<LabelImportEntity, LabelImportCounts>
  return {
    ok: false,
    ...emptyCounts(),
    autoMerged: 0,
    byEntity,
    conflictItems: [],
    errors: [],
    warnings: [],
    pendingConflicts: 0,
    source: null
  }
}

function versionsOf(v: unknown): VersionEntry[] {
  const vs = (v as { versions?: unknown }).versions
  return Array.isArray(vs) ? (vs as VersionEntry[]) : []
}

type Outcome = 'created' | 'updated' | 'unchanged' | 'conflict' | 'auto-merged'

export interface LabelImportOptions {
  /** 새로 넣거나 들어온 값으로 덮은 단위마다 (자동 합침·충돌 보관은 부르지 않음) — 서비스가 제출한 세트가 바뀌었는지 센다 */
  onWrite?: (entity: LabelStoreEntity, value: unknown) => void
}

/** 한 저장 단위 병합 */
function mergeOne<E extends LabelStoreEntity>(
  catalog: Catalog,
  entity: E,
  incoming: LabelEntityMap[E],
  source: LabelExportFile,
  onWrite: LabelImportOptions['onWrite']
): { outcome: Outcome; conflictId?: number } {
  const L = catalog.labels
  const key = labelEntityKey(entity, incoming)
  const mine = L.getEntity(entity, key)
  if (mine === null) {
    L.putEntity(entity, incoming)
    onWrite?.(entity, incoming)
    return { outcome: 'created' }
  }
  if (entity === 'record' || entity === 'review-interval') {
    const a = mine as LabelEntityMap['record' | 'review-interval']
    const b = incoming as LabelEntityMap['record' | 'review-interval']
    if (!sameLabelSet(a, b)) {
      throw new AppError(
        'INVALID_ARGUMENT',
        `${LABEL_ENTITY_NAME[entity]} ${key.slice(0, 8)}… 의 파일·라벨러·지침서·판독 단계가 이 PC 와 다릅니다(이 PC: ${a.labelerId} · ${a.readingStage}, 들어온 것: ${b.labelerId} · ${b.readingStage}). 같은 UUID 를 다른 라벨 세트로 옮길 수 없어 가져오지 않았습니다.`
      )
    }
  }
  const keep = (): { outcome: Outcome; conflictId?: number } => {
    const r = L.addConflict({ entity, mine, theirs: incoming, sourcePcId: source.pcId, sourceExportedAt: source.exportedAt })
    return r.created ? { outcome: 'conflict', conflictId: r.id } : { outcome: 'unchanged' }
  }
  if (entity === 'work-event') return identicalLabel(mine, incoming) ? { outcome: 'unchanged' } : keep()

  const order = compareVersions(versionsOf(incoming), versionsOf(mine))
  if (order === 'a-newer') {
    L.putEntity(entity, incoming)
    onWrite?.(entity, incoming)
    return { outcome: 'updated' }
  }
  if (order === 'b-newer') return { outcome: 'unchanged' }
  if (order === 'same') return sameLabelContent(mine, incoming) ? { outcome: 'unchanged' } : keep()
  // 양쪽에서 따로 고침
  if (sameLabelContent(mine, incoming)) {
    const versions = mergeVersions(versionsOf(mine), versionsOf(incoming))
    L.putEntity(entity, { ...mine, versions, revision: versionTotal(versions) })
    return { outcome: 'auto-merged' }
  }
  return keep()
}

/**
 * 라벨 파일 가져오기. content = JSON 글자 또는 JSON.parse 한 값.
 * 검사 오류가 있거나 쓰다가 실패하면 아무것도 바꾸지 않고 ok = false 로 돌려준다.
 */
export function importLabels(catalog: Catalog, content: string | unknown, options: LabelImportOptions = {}): LabelImportReport {
  const report = emptyReport()
  const parsed = typeof content === 'string' ? parseLabelExportJson(content) : parseLabelExport(content)
  report.warnings.push(...parsed.warnings)
  if (!parsed.ok || parsed.value === null) {
    report.errors.push(...parsed.errors)
    report.pendingConflicts = catalog.labels.pendingConflictCount()
    return report
  }
  const file = parsed.value
  report.source = {
    pcId: file.pcId,
    appVersion: file.appVersion,
    exportedAt: file.exportedAt,
    schemaVersion: file.schemaVersion,
    rulesVersion: file.rulesVersion
  }

  const tally = (entity: LabelImportEntity, outcome: Outcome): void => {
    const c = report.byEntity[entity]
    if (outcome === 'auto-merged') {
      c.updated++
      report.autoMerged++
    } else if (outcome === 'conflict') c.conflicts++
    else c[outcome]++
  }

  try {
    catalog.transaction(() => {
      for (const l of file.labelers) {
        const mine = catalog.labels.getLabeler(l.id)
        if (mine === null) {
          catalog.labels.registerLabeler(l)
          tally('labeler', 'created')
        } else {
          if (!identicalLabel(mine, l)) report.warnings.push(`라벨러 '${l.id}' 정보가 이 PC 와 다릅니다. 이 PC 의 정보를 그대로 둡니다.`)
          tally('labeler', 'unchanged')
        }
      }
      const run = <E extends LabelStoreEntity>(entity: E, items: readonly LabelEntityMap[E][]): void => {
        for (const x of items) {
          const r = mergeOne(catalog, entity, x, file, options.onWrite)
          tally(entity, r.outcome)
          if (r.outcome === 'conflict' && r.conflictId !== undefined) {
            report.conflictItems.push({ entity, key: labelEntityKey(entity, x), conflictId: r.conflictId })
          }
        }
      }
      run('physical-defect', file.physicalDefects)
      run('file-alignment', file.fileAlignments)
      run('record', file.records)
      run('observation', file.observations)
      run('review-interval', file.reviewIntervals)
      run('work-event', file.workEvents)
    })
  } catch (err) {
    const failed = emptyReport()
    failed.warnings = report.warnings
    failed.source = report.source
    failed.errors.push(`가져오기 중 오류가 나 아무것도 바꾸지 않았습니다: ${err instanceof Error ? err.message : String(err)}`)
    failed.pendingConflicts = catalog.labels.pendingConflictCount()
    return failed
  }

  for (const c of Object.values(report.byEntity)) {
    report.created += c.created
    report.updated += c.updated
    report.unchanged += c.unchanged
    report.conflicts += c.conflicts
  }
  if (report.conflicts > 0) {
    const parts = ENTITY_ORDER.filter((e) => report.byEntity[e].conflicts > 0).map(
      (e) => `${LABEL_ENTITY_NAME[e]} ${report.byEntity[e].conflicts}건`
    )
    report.warnings.push(`양쪽에서 따로 고친 항목이 있어 둘 다 보관했습니다(${parts.join(', ')}). 이 PC 의 값을 그대로 쓰며, 충돌 목록에서 고르세요.`)
  }
  report.ok = true
  report.pendingConflicts = catalog.labels.pendingConflictCount()
  return report
}

// ───────────────────────────── 충돌 해결 ─────────────────────────────

export type LabelConflictChoice = Exclude<LabelConflictResolution, 'superseded'>

export interface ConflictResolveOptions extends LabelWriteContext {
  /** '둘 다'의 새 UUID 만들기 (기본 crypto.randomUUID) */
  newUuid?: () => string
}

export interface ConflictResolveOutcome {
  conflict: LabelConflict
  /** 해결 뒤 그 키의 내 것 */
  value: LabelEntityMap[LabelStoreEntity]
  /** '둘 다'로 새로 만든 사본 */
  copy: LabelEntityMap[LabelStoreEntity] | null
}

const BOTH_ALLOWED: readonly LabelStoreEntity[] = ['record', 'review-interval', 'work-event']

function stamp<T>(v: T, versions: VersionEntry[], pcId: string, now: string, entity: LabelStoreEntity): T {
  const o: Record<string, unknown> = { ...(v as Record<string, unknown>), versions, revision: versionTotal(versions), pcId }
  if (entity === 'record' || entity === 'review-interval' || entity === 'file-alignment' || entity === 'physical-defect') o.updatedAt = now
  return o as T
}

/**
 * 충돌 해결.
 * - 'mine': 내 것을 남긴다. 버전 벡터 = 둘을 합친 것 + 이 PC 1회.
 * - 'theirs': 들어온 것으로 바꾼다. 버전 벡터는 위와 같다. 작업 이벤트는 고칠 수 없어 쓸 수 없다.
 * - 'both': 내 것을 남기고(버전 합침 + 1회), 들어온 것은 새 UUID 의 새 항목으로 넣는다(버전은 이 PC 1회부터).
 *   지시 기록·검토 구간·작업 이벤트만. 새 기록의 관측 표는 옮기지 않는다(앱이 다시 계산).
 * 같은 키의 다른 풀지 않은 충돌 가운데 새 값이 포함하는 것은 저절로 닫힌다('superseded').
 */
export function resolveLabelConflict(
  catalog: Catalog,
  conflictId: number,
  choice: LabelConflictChoice,
  opts: ConflictResolveOptions
): ConflictResolveOutcome {
  const pcId = typeof opts.pcId === 'string' ? opts.pcId.trim() : ''
  if (pcId === '') throw new AppError('INVALID_ARGUMENT', 'PC ID 가 없습니다. 설정에서 이 PC 의 ID 를 정하세요.')
  const slot = slotOf(opts)
  if (!['mine', 'theirs', 'both'].includes(choice)) throw new AppError('INVALID_ARGUMENT', `해결 방법이 올바르지 않습니다: ${String(choice)}`)
  const L = catalog.labels
  return catalog.transaction(() => {
    const c = L.getConflict(conflictId)
    if (!c) throw new AppError('NOT_FOUND', '충돌을 찾을 수 없습니다.')
    if (c.resolvedAt !== null) throw new AppError('CONFLICT', '이미 해결된 충돌입니다.')
    const entity = c.entity
    if (choice === 'theirs' && entity === 'work-event') {
      throw new AppError('INVALID_ARGUMENT', "작업 이벤트는 고칠 수 없어 '들어온 것'을 고를 수 없습니다. '내 것' 또는 '둘 다'를 고르세요.")
    }
    if (choice === 'both' && !BOTH_ALLOWED.includes(entity)) {
      throw new AppError('INVALID_ARGUMENT', `'둘 다 남기기'는 지시 기록·검토 구간·작업 이벤트에만 됩니다 (${LABEL_ENTITY_NAME[entity]}은 키가 하나뿐).`)
    }
    const mine = L.getEntity(entity, c.key)
    if (mine === null) throw new AppError('NOT_FOUND', `${LABEL_ENTITY_NAME[entity]}을(를) 찾을 수 없습니다.`)
    if (choice === 'theirs' && (entity === 'record' || entity === 'review-interval')) {
      if (!sameLabelSet(mine as LabelEntityMap['record'], c.theirs as LabelEntityMap['record'])) {
        throw new AppError('INVALID_ARGUMENT', "들어온 것의 파일·라벨러·지침서·판독 단계가 달라 '들어온 것'을 고를 수 없습니다. '둘 다'를 고르세요.")
      }
    }
    const now = L.clock()

    let copy: LabelEntityMap[LabelStoreEntity] | null = null
    let newKey: string | null = null
    if (choice === 'both') {
      const uuid = (opts.newUuid ?? newLabelUuid)()
      if (entity === 'work-event') {
        copy = { ...(c.theirs as LabelEntityMap['work-event']), uuid }
        const r = validateWorkEvent(copy)
        if (!r.ok) throw new AppError('INVALID_ARGUMENT', `새 사본을 만들 수 없습니다: ${r.errors.join(' / ')}`)
      } else {
        const base = { ...(c.theirs as unknown as Record<string, unknown>), uuid, createdAt: now }
        copy = stamp(base, bumpVersions([], slot), pcId, now, entity) as unknown as LabelEntityMap[LabelStoreEntity]
        const r = entity === 'record' ? validateIndicationRecord(copy) : validateReviewInterval(copy)
        if (!r.ok) throw new AppError('INVALID_ARGUMENT', `새 사본을 만들 수 없습니다: ${r.errors.join(' / ')}`)
      }
      if (L.getEntity(entity, uuid) !== null) throw new AppError('CONFLICT', `새 UUID 가 이미 있습니다: ${uuid}`)
      newKey = uuid
    }

    // 이 충돌을 먼저 닫고(아래 쓰기가 'superseded' 로 덮지 않게) 값을 쓴다
    L.markConflictResolved(c.id, choice, newKey)
    let value: LabelEntityMap[LabelStoreEntity] = mine
    if (entity !== 'work-event') {
      const versions = bumpVersions(mergeVersions(versionsOf(mine), versionsOf(c.theirs)), slot)
      const next = stamp(choice === 'theirs' ? c.theirs : mine, versions, pcId, now, entity)
      L.putEntity(entity, next as LabelEntityMap[typeof entity])
      value = next
    }
    if (copy !== null) L.putEntity(entity, copy)
    const after = L.getConflict(c.id)
    return { conflict: after ?? c, value, copy }
  })
}
