/**
 * 라벨 JSON 내보내기 — 여러 PC 의 기록을 합칠 때 쓰는 LabelExportFile 을 만든다.
 *
 * - 삭제 표시(tombstone)도 넣는다(다른 PC 에 지움을 전함). includeDeleted = false 면 뺀다.
 * - 풀지 않은 충돌의 '들어온 사본'도 넣는다(같은 UUID 가 둘). 내 것을 먼저, 들어온 사본을 뒤에 둬서
 *   빈 PC 로 가져가면 같은 상태(내 것 = 본 행, 들어온 것 = 충돌)가 된다. includeConflicts = false 면 뺀다.
 * - 순서를 정해 두어 같은 DB 면 같은 내용이 나온다(시각 머리 칸 제외).
 * - 결과는 validate.ts parseLabelExport 로 다시 읽어도 같은 내용이다(저장된 값이 이미 검사를 통과한 전체 객체라서).
 */
import { localIso, physicalDefectKey, type Catalog, type LabelConflict, type LabelEntityMap, type LabelStoreEntity } from '@core/catalog'
import { AppError } from '@shared/errors'
import { newLabelExport, sameLabelSet } from '@shared/labels/factory'
import type { LabelExportFile, LabelSetKey, LabelerInfo, WorkEvent } from '@shared/labels/types'
import { serializeLabelExport } from '@shared/labels/validate'

export type LabelExportScope =
  | { kind: 'all' }
  /** 이 파일들의 모든 라벨 세트 */
  | { kind: 'files'; sha256s: readonly string[] }
  /** 이 라벨 세트들만 */
  | { kind: 'sets'; sets: readonly LabelSetKey[] }

export interface LabelExportOptions {
  appVersion: string
  /** 내보내는 PC 의 ID */
  pcId: string
  /** 기록용 시각 (기본: 지금, 로컬 시간대) */
  exportedAt?: string
  /** 삭제 표시도 넣기 (기본 true) */
  includeDeleted?: boolean
  /** 풀지 않은 충돌의 들어온 사본도 넣기 (기본 true) */
  includeConflicts?: boolean
}

function pendingCopies<E extends LabelStoreEntity>(catalog: Catalog, entity: E, keys: ReadonlySet<string>): LabelEntityMap[E][] {
  if (keys.size === 0) return []
  return catalog.labels
    .listConflicts({ entity, pendingOnly: true })
    .filter((c: LabelConflict) => keys.has(c.key))
    .map((c) => c.theirs as LabelEntityMap[E])
}

function keySet<T>(items: readonly T[], keyOf: (x: T) => string): Set<string> {
  return new Set(items.map(keyOf))
}

/** 범위의 라벨을 내보내기 파일로 */
export function exportLabels(catalog: Catalog, scope: LabelExportScope, opts: LabelExportOptions): LabelExportFile {
  const pcId = opts.pcId?.trim() ?? ''
  if (pcId === '') throw new AppError('INVALID_ARGUMENT', 'PC ID 가 없습니다. 설정에서 이 PC 의 ID 를 정하세요.')
  if (!opts.appVersion?.trim()) throw new AppError('INVALID_ARGUMENT', '앱 버전이 없습니다.')
  const includeDeleted = opts.includeDeleted !== false
  const includeConflicts = opts.includeConflicts !== false
  const L = catalog.labels

  // 범위의 파일
  let sha256s: string[] | null
  if (scope.kind === 'all') sha256s = null
  else if (scope.kind === 'files') sha256s = [...new Set(scope.sha256s.map((s) => s.toLowerCase()))].sort()
  else sha256s = [...new Set(scope.sets.map((s) => s.sha256))].sort()
  const inSets = (x: LabelSetKey): boolean => scope.kind !== 'sets' || scope.sets.some((s) => sameLabelSet(s, x))

  // 지시 기록 · 검토 구간
  const records =
    sha256s === null
      ? L.listRecords({ includeDeleted })
      : sha256s.flatMap((sha) => L.listRecords({ sha256: sha, includeDeleted })).filter(inSets)
  const reviews =
    sha256s === null
      ? L.listReviewIntervals({ includeDeleted })
      : sha256s.flatMap((sha) => L.listReviewIntervals({ sha256: sha, includeDeleted })).filter(inSets)
  const recordKeys = keySet(records, (r) => r.uuid)
  const recordCopies = includeConflicts ? pendingCopies(catalog, 'record', recordKeys) : []
  const reviewCopies = includeConflicts ? pendingCopies(catalog, 'review-interval', keySet(reviews, (r) => r.uuid)) : []

  // 관측 표: 넣은 기록(충돌 사본 포함)의 것
  const recordUuids = [...new Set([...records, ...recordCopies].map((r) => r.uuid))]
  const observations = sha256s === null ? L.listObservations({ includeDeleted }) : L.listObservations({ recordUuids, includeDeleted })
  const observationCopies = includeConflicts
    ? catalog.labels
        .listConflicts({ entity: 'observation', pendingOnly: true })
        .filter((c) => sha256s === null || recordUuids.includes((c.theirs as LabelEntityMap['observation']).recordUuid))
        .map((c) => c.theirs as LabelEntityMap['observation'])
    : []

  // 파일 정렬
  const alignments = L.listFileAlignments(sha256s === null ? { includeDeleted } : { sha256s, includeDeleted })
  const alignmentCopies = includeConflicts ? pendingCopies(catalog, 'file-alignment', keySet(alignments, (a) => a.sha256)) : []

  // 물리 결함: 범위 파일의 시편 (파일 정렬의 시편 ID, 카탈로그 파일의 시편 ID)
  let physicalDefects
  if (sha256s === null) physicalDefects = L.listPhysicalDefects({ includeDeleted })
  else {
    const specimens = new Set<string>()
    for (const a of [...alignments, ...alignmentCopies]) if (a.specimenId) specimens.add(a.specimenId)
    for (const sha of sha256s) {
      const f = catalog.findFileBySha256(sha)
      if (f) specimens.add(f.specimenId)
    }
    physicalDefects = L.listPhysicalDefects({ specimenIds: [...specimens], includeDeleted })
  }
  const physicalCopies = includeConflicts
    ? pendingCopies(catalog, 'physical-defect', keySet(physicalDefects, (p) => physicalDefectKey(p.specimenId, p.id)))
    : []

  // 작업 이벤트: 범위 파일·세트의 이벤트 + 그 세션의 파일 무관 이벤트(세션 시작·끝 등)
  let workEvents: WorkEvent[]
  const allEvents = L.listWorkEvents()
  if (sha256s === null) workEvents = allEvents
  else {
    const fileSet = new Set(sha256s)
    const fileEvents = allEvents.filter((e) => {
      if (e.sha256 === null || !fileSet.has(e.sha256)) return false
      if (scope.kind !== 'sets') return true
      return scope.sets.some((s) => s.sha256 === e.sha256 && s.labelerId === e.labelerId && (e.readingStage === null || e.readingStage === s.readingStage))
    })
    const sessions = new Set(fileEvents.map((e) => `${e.labelerId}\u0000${e.sessionId}`))
    const picked = new Set(fileEvents.map((e) => e.uuid))
    workEvents = allEvents.filter((e) => picked.has(e.uuid) || (e.sha256 === null && sessions.has(`${e.labelerId}\u0000${e.sessionId}`)))
  }
  const eventCopies = includeConflicts ? pendingCopies(catalog, 'work-event', keySet(workEvents, (e) => e.uuid)) : []

  // 라벨러: 전체 범위면 모두, 아니면 쓰인 것만
  const used = new Set<string>()
  for (const x of [...records, ...recordCopies, ...reviews, ...reviewCopies, ...workEvents]) used.add(x.labelerId)
  for (const a of alignments) if (a.enteredBy) used.add(a.enteredBy)
  const labelers: LabelerInfo[] = L.listLabelers().filter((l) => sha256s === null || used.has(l.id))

  return newLabelExport(
    { appVersion: opts.appVersion.trim(), exportedAt: opts.exportedAt ?? localIso(), pcId },
    {
      labelers,
      physicalDefects: [...physicalDefects, ...physicalCopies],
      fileAlignments: [...alignments, ...alignmentCopies],
      records: [...records, ...recordCopies],
      observations: [...observations, ...observationCopies],
      reviewIntervals: [...reviews, ...reviewCopies],
      workEvents: [...workEvents, ...eventCopies]
    }
  )
}

/** 내보내기 글자 (2칸 들여쓰기 JSON, 끝 줄바꿈) */
export function exportLabelsJson(catalog: Catalog, scope: LabelExportScope, opts: LabelExportOptions): string {
  return serializeLabelExport(exportLabels(catalog, scope, opts))
}
