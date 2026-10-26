/**
 * 결함 라벨 저장소 — catalog.db v2 테이블 (schema.ts V2). 규격: 계획_라벨링/규격_초안.md 1·2절, shared/labels/types.ts.
 *
 * 원칙
 * - 행마다 검사(shared/labels/validate.ts)를 통과한 전체 객체 JSON 을 그대로 둔다(모르는 칸 포함). 다른 열은 찾기용 사본.
 * - 파일과는 sha256 문자열로만 잇는다(FK·CASCADE 없음). 로컬에 없는 파일의 기록도 보관한다.
 * - 저장(save*)은 이 PC 의 고침 횟수를 1 올린다(versions.ts bumpVersions). revision = 횟수 합. 시각(updatedAt)은 기록용.
 *   넘긴 versions 가 저장된 것과 다르면(그사이 다른 곳에서 고침) CONFLICT. 내용이 그대로면 횟수를 올리지 않는다.
 * - 지우기는 삭제 표시(tombstone)다. 행은 남겨 다른 PC 에 전한다.
 * - 작업 이벤트는 추가 전용이다(DB 트리거로 고치기·지우기를 막음).
 * - putEntity·addConflict 는 병합(core/labels)용 낮은 단계 함수다: 검사·횟수 올리기 없이 그대로 쓴다.
 * - 쓰기는 짧은 트랜잭션 하나씩. 바깥에서 catalog.transaction 으로 묶으면 그 안의 SAVEPOINT 가 된다.
 * - 버전 벡터의 칸(versionSlot)은 'PC ID:복제본 ID' 다(replicaSlot). 복제본 ID 는 (PC ID, 이 DB 파일 위치)마다
 *   이 카탈로그가 무작위로 만든다. 그래서 한 PC 가 저장소 둘을 쓰거나, DB 를 다른 곳에 복사해 열거나,
 *   PC ID 를 다른 PC 와 같게 바꿔도 두 사본이 같은 칸을 나눠 쓰지 않는다(덮어쓰기 대신 충돌로 보인다).
 *   백업에서 되돌린 DB 는 부르는 쪽(core/service)이 쓰기 횟수(writeCount)로 알아채 rotateReplica 로 새 칸을 받는다.
 * - groupingId 는 앱이 계산하는 칸이라 내용 비교(sameLabelContent)에서 빼고, 횟수를 올리지 않고 쓴다(setRecordGrouping).
 */
import { createHash, randomBytes } from 'node:crypto'
import { AppError } from '@shared/errors'
import { labelSetId } from '@shared/labels/factory'
import { mergeSpans } from '@shared/labels/spans'
import type {
  FileAlignment,
  IndicationRecord,
  LabelSetKey,
  LabelerInfo,
  ObservationRow,
  PhysicalDefect,
  ReadingStage,
  RecordKind,
  ReviewInterval,
  ReviewIntervalKind,
  VersionEntry,
  WorkEvent
} from '@shared/labels/types'
import {
  validateFileAlignment,
  validateIndicationRecord,
  validateObservationRow,
  validatePhysicalDefect,
  validateReviewInterval,
  validateWorkEvent,
  type LabelCheckResult
} from '@shared/labels/validate'
import { bumpVersions, compareVersions, versionTotal } from '@shared/labels/versions'
import type { Db, Params, Row } from './db'
import { canonicalJson, num, numOrNull, str, strOrNull } from './values'

// ───────────────────────────── 공개 타입 ─────────────────────────────

/** 버전 벡터가 있는 저장 단위 + 작업 이벤트 */
export type LabelStoreEntity = 'physical-defect' | 'file-alignment' | 'record' | 'observation' | 'review-interval' | 'work-event'
export type VersionedLabelEntity = Exclude<LabelStoreEntity, 'work-event'>

export interface LabelEntityMap {
  'physical-defect': PhysicalDefect
  'file-alignment': FileAlignment
  record: IndicationRecord
  observation: ObservationRow
  'review-interval': ReviewInterval
  'work-event': WorkEvent
}

/** 저장 단위의 한국어 이름 (보고서 문구) */
export const LABEL_ENTITY_NAME: Readonly<Record<LabelStoreEntity | 'labeler', string>> = {
  labeler: '라벨러',
  'physical-defect': '물리 결함',
  'file-alignment': '파일 정렬',
  record: '지시 기록',
  observation: '관측 표',
  'review-interval': '검토 구간',
  'work-event': '작업 이벤트'
}

export interface LabelWriteContext {
  /** 이 PC 의 ID (기록의 '마지막으로 고친 PC'). 설정에 둔 짧은 이름 */
  pcId: string
  /** 버전 벡터의 칸 ('PC ID:복제본 ID', replicaSlot). 없으면 pcId 를 그대로 쓴다(시험·낮은 단계 호출) */
  versionSlot?: string
}

/** 버전 벡터 칸 (versionSlot, 없으면 pcId) */
export function slotOf(ctx: LabelWriteContext): string {
  const s = typeof ctx?.versionSlot === 'string' ? ctx.versionSlot.trim() : ''
  return s !== '' ? s : (typeof ctx?.pcId === 'string' ? ctx.pcId.trim() : '')
}

/** 이 카탈로그의 복제본 (버전 벡터 칸) */
export interface LabelReplica {
  /** 무작위 16진수 8자리 */
  id: string
  pcId: string
  /** 'PC ID:복제본 ID' — 버전 벡터의 칸 */
  slot: string
  /** 이 DB 의 라벨 쓰기 횟수 (백업 복원 알아채기) */
  writes: number
  /** 이번에 새로 만들었는지 */
  created: boolean
}

/** 엑셀에서 마지막으로 가져온 줄 (label_import_marks) */
export interface LabelImportMark {
  /** 그때 엑셀 줄 내용의 지문 (labelContentHash) */
  rowHash: string
  /** 그 가져오기 직후 저장된 versions */
  versions: VersionEntry[]
  /** 엑셀에서 빠져 지움 표시한 것 (엑셀에 다시 나타나면 되살린다) */
  deletedByImport: boolean
  markedAt: string
}

export interface LabelSaveResult<T> {
  /** 저장된 값 (versions·revision·pcId·updatedAt 이 채워짐) */
  value: T
  /** 검사 경고 (쓸 수는 있지만 확인할 것) */
  warnings: string[]
  /** 내용이 바뀌어 실제로 썼는지. 그대로면 false (횟수를 올리지 않음) */
  changed: boolean
}

export interface LabelListOptions {
  /** 삭제 표시도 포함 (기본 false) */
  includeDeleted?: boolean
  /**
   * 2인 독립 라벨 모드: 이 라벨러의 세트만 보인다(다른 라벨러 세트는 숨김).
   * null·undefined = 모두 보임
   */
  visibleLabelerId?: string | null
}

export interface LabelRecordQuery extends LabelListOptions {
  /** 파일별 */
  sha256?: string
  /** 라벨 세트별 (sha256 포함) */
  set?: LabelSetKey
  labelerId?: string
  kind?: RecordKind
}

export interface ReviewIntervalQuery extends LabelListOptions {
  sha256?: string
  set?: LabelSetKey
  labelerId?: string
  kind?: ReviewIntervalKind
  /** 자동으로 풀린(released) 검토 완료 구간도 포함 (기본 true) */
  includeReleased?: boolean
}

export interface ObservationQuery {
  recordUuids?: readonly string[]
  /** 그 파일 기록의 관측 행 (지시 기록 테이블로 찾음) */
  sha256?: string
  includeDeleted?: boolean
}

export interface WorkEventQuery {
  sha256?: string
  labelerId?: string
  sessionId?: string
  readingStage?: ReadingStage
}

export interface LabelSetQuery extends LabelListOptions {
  sha256?: string
  labelerId?: string
}

/** 라벨 세트 목록의 한 줄 */
export interface LabelSetSummary extends LabelSetKey {
  /** labelSetId ('sha256|라벨러|지침서|단계') */
  setId: string
  /** 삭제 표시를 뺀 지시 기록 수 */
  recordCount: number
  /** 그중 결함 기록 수 (형상 에코·형상 불완전 제외) */
  defectCount: number
  deletedRecordCount: number
  /** 삭제 표시를 뺀 검토 구간 수 (세 종류 모두) */
  reviewIntervalCount: number
  /** 검토 완료(지우거나 풀리지 않은) 스캔 구간의 합집합 길이 (mm, 그룹 무관) */
  reviewedLengthMm: number
  qualityBadLengthMm: number
  belowThresholdLengthMm: number
  /** 이 PC 에 마지막으로 쓴 시각 (기록용) */
  lastStoredAt: string | null
  /** 이 PC 카탈로그의 그 파일 (없으면 null — 기록은 그래도 보관) */
  fileId: number | null
  fileName: string | null
  /** 이 세트에 걸린 풀지 않은 충돌 수 */
  pendingConflicts: number
}

export type LabelConflictResolution = 'mine' | 'theirs' | 'both' | 'superseded'

export interface LabelConflict<E extends LabelStoreEntity = LabelStoreEntity> {
  id: number
  entity: E
  /** labelEntityKey 형식 */
  key: string
  sha256: string | null
  labelerId: string | null
  /** 충돌을 찾았을 때의 내 것 (지금 내 것은 getEntity 로) */
  mineAtDetection: LabelEntityMap[E]
  /** 들어온 것 (내 것과 같은 키, 따로 고친 사본) */
  theirs: LabelEntityMap[E]
  sourcePcId: string | null
  /** 출처 이름 (엑셀 확정에서 생긴 충돌은 '엑셀 파일이름.xlsx', JSON 은 null) */
  sourceName: string | null
  sourceExportedAt: string | null
  detectedAt: string
  resolvedAt: string | null
  resolution: LabelConflictResolution | null
  /** '둘 다 남기기'로 새로 만든 사본의 키 */
  resolvedNewKey: string | null
}

export interface ConflictQuery {
  /** 풀지 않은 것만 (기본 true) */
  pendingOnly?: boolean
  entity?: LabelStoreEntity
  sha256?: string
  key?: string
}

export interface NewConflictInput<E extends LabelStoreEntity = LabelStoreEntity> {
  entity: E
  mine: LabelEntityMap[E]
  theirs: LabelEntityMap[E]
  sourcePcId?: string | null
  sourceName?: string | null
  sourceExportedAt?: string | null
}

export interface LabelStore {
  /** 이 카탈로그의 시계 (기록용 시각) */
  clock(): string

  // 복제본 (버전 벡터 칸)
  /** 이 PC ID 의 복제본 (없거나 DB 위치가 바뀌었으면 새로 만든다) */
  replica(pcId: string): LabelReplica
  /** 새 복제본으로 갈아탄다 (백업 복원·복사를 알아챘을 때) */
  rotateReplica(pcId: string): LabelReplica
  /** 이 카탈로그가 만든 복제본 ID 모두 */
  ownReplicaIds(): string[]
  /** 이 DB 의 라벨 쓰기 횟수 */
  writeCount(): number
  /** 이 PC ID 가 이 카탈로그의 버전·충돌 출처에 다른 복제본(다른 PC)의 이름으로 나오는지 */
  pcIdUsedElsewhere(pcId: string): boolean

  // 라벨러
  /** 없으면 만들고 있으면 이름·자격·기관을 고친다 */
  registerLabeler(info: LabelerInfo): LabelerInfo
  getLabeler(id: string): LabelerInfo | null
  listLabelers(): LabelerInfo[]

  // 지시 기록
  saveRecord(record: IndicationRecord, ctx: LabelWriteContext): LabelSaveResult<IndicationRecord>
  getRecord(uuid: string): IndicationRecord | null
  /** 삭제 표시. 이미 지웠으면 그대로 돌려준다 */
  deleteRecord(uuid: string, ctx: LabelWriteContext): LabelSaveResult<IndicationRecord>
  listRecords(query?: LabelRecordQuery): IndicationRecord[]
  listLabelSets(query?: LabelSetQuery): LabelSetSummary[]
  /** 앱이 계산한 그룹 짓기 ID 만 쓴다 (버전을 올리지 않음 — 계산 칸이라 병합 비교에서도 뺀다). 바뀌었으면 true */
  setRecordGrouping(uuid: string, groupingId: string | null): boolean

  // 관측 표
  saveObservation(row: ObservationRow, ctx: LabelWriteContext): LabelSaveResult<ObservationRow>
  getObservation(recordUuid: string, groupId: number, leg: number): ObservationRow | null
  deleteObservation(recordUuid: string, groupId: number, leg: number, ctx: LabelWriteContext): LabelSaveResult<ObservationRow>
  listObservations(query?: ObservationQuery): ObservationRow[]

  // 검토 구간
  saveReviewInterval(v: ReviewInterval, ctx: LabelWriteContext): LabelSaveResult<ReviewInterval>
  getReviewInterval(uuid: string): ReviewInterval | null
  deleteReviewInterval(uuid: string, ctx: LabelWriteContext): LabelSaveResult<ReviewInterval>
  listReviewIntervals(query?: ReviewIntervalQuery): ReviewInterval[]

  // 파일 정렬
  saveFileAlignment(v: FileAlignment, ctx: LabelWriteContext): LabelSaveResult<FileAlignment>
  getFileAlignment(sha256: string): FileAlignment | null
  deleteFileAlignment(sha256: string, ctx: LabelWriteContext): LabelSaveResult<FileAlignment>
  listFileAlignments(query?: { sha256s?: readonly string[]; specimenId?: string; includeDeleted?: boolean }): FileAlignment[]

  // 물리 결함
  savePhysicalDefect(v: PhysicalDefect, ctx: LabelWriteContext): LabelSaveResult<PhysicalDefect>
  getPhysicalDefect(specimenId: string, id: string): PhysicalDefect | null
  deletePhysicalDefect(specimenId: string, id: string, ctx: LabelWriteContext): LabelSaveResult<PhysicalDefect>
  listPhysicalDefects(query?: { specimenIds?: readonly string[]; includeDeleted?: boolean }): PhysicalDefect[]

  // 작업 이벤트 (추가 전용)
  /** 같은 UUID 가 같은 내용으로 이미 있으면 그대로(changed = false), 내용이 다르면 CONFLICT */
  appendWorkEvent(e: WorkEvent): LabelSaveResult<WorkEvent>
  listWorkEvents(query?: WorkEventQuery): WorkEvent[]

  // 엑셀 가져오기 기준 (이 PC 에만, 내보내지 않음)
  getImportMark(entity: 'record' | 'review-interval', key: string): LabelImportMark | null
  setImportMark(entity: 'record' | 'review-interval', key: string, mark: Omit<LabelImportMark, 'markedAt'>): void

  // 병합용 낮은 단계 (core/labels)
  getEntity<E extends LabelStoreEntity>(entity: E, key: string): LabelEntityMap[E] | null
  /**
   * 검사·횟수 올리기 없이 그대로 쓴다(가져오기에서 들어온 것이 새것일 때, 충돌 해결 결과).
   * 값은 이미 검사를 통과한 것이어야 한다. 쓴 뒤 그 키의 풀지 않은 충돌 가운데 새 값이 포함하는 것은 'superseded' 로 닫는다.
   */
  putEntity<E extends LabelStoreEntity>(entity: E, value: LabelEntityMap[E]): void
  /**
   * 충돌 보관. 같은 들어온 사본이 이미 풀지 않은 채 있거나, 전에 '내 것'·'둘 다'로 푼 것과 같으면
   * 새로 만들지 않는다(created = false). 버전이 없는 작업 이벤트가 같은 JSON 을 다시 가져올 때마다 되살아나지 않게.
   */
  addConflict<E extends LabelStoreEntity>(input: NewConflictInput<E>): { id: number; created: boolean }
  getConflict(id: number): LabelConflict | null
  listConflicts(query?: ConflictQuery): LabelConflict[]
  /** 충돌을 해결됨으로 표시 (값 쓰기는 부르는 쪽이 putEntity 로) */
  markConflictResolved(id: number, resolution: LabelConflictResolution, newKey?: string | null): void
  pendingConflictCount(): number
}

// ───────────────────────────── 키 ─────────────────────────────

/** 저장 단위의 키 글자. 단일 키는 그대로, 복합 키는 JSON 배열 글자 */
export function labelEntityKey<E extends LabelStoreEntity>(entity: E, v: LabelEntityMap[E]): string {
  switch (entity) {
    case 'physical-defect': {
      const p = v as PhysicalDefect
      return physicalDefectKey(p.specimenId, p.id)
    }
    case 'file-alignment':
      return (v as FileAlignment).sha256
    case 'observation': {
      const o = v as ObservationRow
      return JSON.stringify([o.recordUuid, o.groupId, o.leg])
    }
    default:
      return (v as IndicationRecord | ReviewInterval | WorkEvent).uuid
  }
}

/** 시편 ID 를 ASCII 대소문자 구분 없이 (catalog 시편 COLLATE NOCASE 와 같은 규칙) */
export function specimenKey(specimenId: string): string {
  return specimenId.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

export function physicalDefectKey(specimenId: string, id: string): string {
  return JSON.stringify([specimenKey(specimenId), id])
}

export function observationKey(recordUuid: string, groupId: number, leg: number): string {
  return JSON.stringify([recordUuid, groupId, leg])
}

function parseCompositeKey(key: string, n: number): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(key)
  } catch {
    parsed = null
  }
  if (!Array.isArray(parsed) || parsed.length !== n) throw new AppError('INVALID_ARGUMENT', `키 형식이 올바르지 않습니다: ${key}`)
  return parsed
}

// ───────────────────────────── 테이블 정의 ─────────────────────────────

interface TableSpec<T> {
  table: string
  /** 키 조건 (WHERE 절) — $k0, $k1, $k2 */
  keyWhere: string
  keyParams(key: string): Params
  /** 찾기용 열 (json·stored_at 제외) */
  columns(v: T): Params
  validate(v: unknown): LabelCheckResult<T>
  /** 저장할 때 바꿀 수 없는 칸 (같은 키인데 이 칸이 다르면 INVALID_ARGUMENT) */
  immutable?: (old: T, next: T) => string | null
  /** 저장할 때 쓰는 기록용 칸 채우기 */
  stamp(v: T, ctx: { pcId: string; now: string; old: T | null; versions: VersionEntry[] }): T
}

const b = (v: boolean): number => (v ? 1 : 0)

function setKeyChanged(old: LabelSetKey, next: LabelSetKey): string | null {
  if (old.sha256 !== next.sha256 || old.labelerId !== next.labelerId || old.guidelineVersion !== next.guidelineVersion || old.readingStage !== next.readingStage) {
    return '기록의 파일·라벨러·지침서 버전·판독 단계는 바꿀 수 없습니다. 새 기록으로 만드세요.'
  }
  return null
}

const RECORD: TableSpec<IndicationRecord> = {
  table: 'label_records',
  keyWhere: 'uuid = $k0',
  keyParams: (key) => ({ k0: key }),
  columns: (r) => ({
    uuid: r.uuid,
    sha256: r.sha256,
    labeler_id: r.labelerId,
    guideline_version: r.guidelineVersion,
    reading_stage: r.readingStage,
    kind: r.kind,
    deleted: b(r.deleted),
    scan_start_mm: r.derived.scanStartMm,
    scan_end_mm: r.derived.scanEndMm,
    grouping_id: r.groupingId,
    physical_defect_id: r.physicalDefectId,
    revision: r.revision,
    versions_json: JSON.stringify(r.versions),
    created_at: r.createdAt,
    updated_at: r.updatedAt
  }),
  validate: validateIndicationRecord,
  immutable: setKeyChanged,
  stamp: (v, c) => ({
    ...v,
    versions: c.versions,
    revision: versionTotal(c.versions),
    pcId: c.pcId,
    createdAt: c.old?.createdAt ?? v.createdAt ?? c.now,
    updatedAt: c.now
  })
}

const OBSERVATION: TableSpec<ObservationRow> = {
  table: 'label_observations',
  keyWhere: 'record_uuid = $k0 AND group_id = $k1 AND leg = $k2',
  keyParams: (key) => {
    const [u, g, l] = parseCompositeKey(key, 3)
    return { k0: String(u), k1: Number(g), k2: Number(l) }
  },
  columns: (o) => ({
    record_uuid: o.recordUuid,
    group_id: o.groupId,
    leg: o.leg,
    status: o.status,
    deleted: b(o.deleted),
    revision: o.revision,
    versions_json: JSON.stringify(o.versions)
  }),
  validate: validateObservationRow,
  stamp: (v, c) => ({ ...v, versions: c.versions, revision: versionTotal(c.versions), pcId: c.pcId })
}

const REVIEW: TableSpec<ReviewInterval> = {
  table: 'label_review_intervals',
  keyWhere: 'uuid = $k0',
  keyParams: (key) => ({ k0: key }),
  columns: (v) => ({
    uuid: v.uuid,
    sha256: v.sha256,
    labeler_id: v.labelerId,
    guideline_version: v.guidelineVersion,
    reading_stage: v.readingStage,
    kind: v.kind,
    deleted: b(v.deleted),
    released: b(v.released),
    group_id: v.groupId,
    scan_start_mm: v.scanStartMm,
    scan_end_mm: v.scanEndMm,
    revision: v.revision,
    versions_json: JSON.stringify(v.versions),
    created_at: v.createdAt,
    updated_at: v.updatedAt
  }),
  validate: validateReviewInterval,
  immutable: setKeyChanged,
  stamp: (v, c) => ({
    ...v,
    versions: c.versions,
    revision: versionTotal(c.versions),
    pcId: c.pcId,
    createdAt: c.old?.createdAt ?? v.createdAt ?? c.now,
    updatedAt: c.now
  })
}

const ALIGNMENT: TableSpec<FileAlignment> = {
  table: 'label_file_alignments',
  keyWhere: 'sha256 = $k0',
  keyParams: (key) => ({ k0: key }),
  columns: (a) => ({
    sha256: a.sha256,
    specimen_id: a.specimenId,
    weld_id: a.weldId,
    deleted: b(a.deleted),
    revision: a.revision,
    versions_json: JSON.stringify(a.versions)
  }),
  validate: validateFileAlignment,
  stamp: (v, c) => ({ ...v, versions: c.versions, revision: versionTotal(c.versions), pcId: c.pcId, updatedAt: c.now })
}

const PHYSICAL: TableSpec<PhysicalDefect> = {
  table: 'label_physical_defects',
  keyWhere: 'specimen_id = $k0 AND defect_id = $k1',
  keyParams: (key) => {
    const [s, i] = parseCompositeKey(key, 2)
    return { k0: String(s), k1: String(i) }
  },
  columns: (p) => ({
    specimen_id: p.specimenId,
    defect_id: p.id,
    deleted: b(p.deleted),
    revision: p.revision,
    versions_json: JSON.stringify(p.versions)
  }),
  validate: validatePhysicalDefect,
  stamp: (v, c) => ({ ...v, versions: c.versions, revision: versionTotal(c.versions), pcId: c.pcId, updatedAt: c.now })
}

const WORK_EVENT: TableSpec<WorkEvent> = {
  table: 'label_work_events',
  keyWhere: 'uuid = $k0',
  keyParams: (key) => ({ k0: key }),
  columns: (e) => ({
    uuid: e.uuid,
    session_id: e.sessionId,
    labeler_id: e.labelerId,
    reading_stage: e.readingStage,
    sha256: e.sha256,
    kind: e.kind,
    at: e.at
  }),
  validate: validateWorkEvent,
  stamp: (v) => v
}

const SPECS: { [E in LabelStoreEntity]: TableSpec<LabelEntityMap[E]> } = {
  'physical-defect': PHYSICAL,
  'file-alignment': ALIGNMENT,
  record: RECORD,
  observation: OBSERVATION,
  'review-interval': REVIEW,
  'work-event': WORK_EVENT
}

const ENTITIES = Object.keys(SPECS) as LabelStoreEntity[]

function isEntity(v: string): v is LabelStoreEntity {
  return (ENTITIES as string[]).includes(v)
}

// ───────────────────────────── 내용 비교 ─────────────────────────────

/** 기록용 칸 (내용 비교에서 뺀다) */
const BOOKKEEPING = ['versions', 'revision', 'pcId', 'updatedAt', 'createdAt'] as const
/** 앱이 계산하는 칸 (내용 비교에서 뺀다. 두 PC 의 두께 출처가 달라 다르게 계산돼도 충돌이 아니다) */
const DERIVED_FIELDS = ['groupingId'] as const

function stripBookkeeping(v: unknown): unknown {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
  const o: Record<string, unknown> = { ...(v as Record<string, unknown>) }
  for (const k of BOOKKEEPING) delete o[k]
  for (const k of DERIVED_FIELDS) delete o[k]
  return o
}

/** 기록용 칸(버전·고친 PC·시각)과 앱 계산 칸(groupingId)을 뺀 내용이 같은지 */
export function sameLabelContent(a: unknown, c: unknown): boolean {
  return canonicalJson(stripBookkeeping(a)) === canonicalJson(stripBookkeeping(c))
}

/** sameLabelContent 와 같은 기준의 내용 지문 (sha256 16진수) */
export function labelContentHash(v: unknown): string {
  return createHash('sha256').update(canonicalJson(stripBookkeeping(v))).digest('hex')
}

/** 기록용 칸까지 모두 같은지 */
export function identicalLabel(a: unknown, c: unknown): boolean {
  return canonicalJson(a) === canonicalJson(c)
}

function hashJson(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex')
}

function versionsOf(v: unknown): VersionEntry[] {
  const vs = (v as { versions?: unknown }).versions
  return Array.isArray(vs) ? (vs as VersionEntry[]) : []
}

// ───────────────────────────── 낮은 단계 읽기·쓰기 ─────────────────────────────

function parseRow<T>(r: Row | undefined): T | null {
  if (!r || typeof r.json !== 'string') return null
  try {
    return JSON.parse(r.json) as T
  } catch {
    throw new AppError('DB_ERROR', '라벨 기록을 읽지 못했습니다(저장된 JSON 이 깨짐).')
  }
}

function getRaw<E extends LabelStoreEntity>(db: Db, entity: E, key: string): LabelEntityMap[E] | null {
  const spec = SPECS[entity] as TableSpec<LabelEntityMap[E]>
  return parseRow<LabelEntityMap[E]>(db.get(`SELECT json FROM ${spec.table} WHERE ${spec.keyWhere}`, spec.keyParams(key)))
}

/** 이 DB 의 라벨 쓰기 횟수 +1 (백업 복원 알아채기, replicaSlot) */
function bumpWrites(db: Db): void {
  db.run(
    `INSERT INTO label_meta(key, value) VALUES ('writes', '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
  )
}

function putRaw<E extends LabelStoreEntity>(db: Db, entity: E, value: LabelEntityMap[E], storedAt: string): void {
  bumpWrites(db)
  const spec = SPECS[entity] as TableSpec<LabelEntityMap[E]>
  const cols: Params = { ...spec.columns(value), json: JSON.stringify(value), stored_at: storedAt }
  const names = Object.keys(cols)
  const insert = `INSERT INTO ${spec.table}(${names.join(', ')}) VALUES (${names.map((n) => `$${n}`).join(', ')})`
  if (entity === 'work-event') {
    db.run(insert, cols)
    return
  }
  const pk = spec.keyWhere.split(' AND ').map((c) => c.split(' = ')[0]!.trim())
  const updates = names.filter((n) => !pk.includes(n)).map((n) => `${n} = excluded.${n}`)
  db.run(`${insert} ON CONFLICT(${pk.join(', ')}) DO UPDATE SET ${updates.join(', ')}`, cols)
}

function toConflict(r: Row): LabelConflict {
  const entity = str(r.entity)
  if (!isEntity(entity)) throw new AppError('DB_ERROR', `알 수 없는 충돌 종류입니다: ${entity}`)
  const res = strOrNull(r.resolution)
  return {
    id: num(r.id),
    entity,
    key: str(r.entity_key),
    sha256: strOrNull(r.sha256),
    labelerId: strOrNull(r.labeler_id),
    mineAtDetection: JSON.parse(str(r.mine_json)) as LabelEntityMap[typeof entity],
    theirs: JSON.parse(str(r.theirs_json)) as LabelEntityMap[typeof entity],
    sourcePcId: strOrNull(r.source_pc_id),
    sourceName: strOrNull(r.source_name),
    sourceExportedAt: strOrNull(r.source_exported_at),
    detectedAt: str(r.detected_at),
    resolvedAt: strOrNull(r.resolved_at),
    resolution: res as LabelConflictResolution | null,
    resolvedNewKey: strOrNull(r.resolved_new_key)
  }
}

/** 새 값이 포함하는(또는 같은) 들어온 사본의 풀지 않은 충돌을 닫는다 */
function closeSuperseded(db: Db, entity: LabelStoreEntity, key: string, mine: unknown, now: string): void {
  const rows = db.all(
    `SELECT id, theirs_json FROM label_conflicts WHERE entity = $e AND entity_key = $k AND resolved_at IS NULL`,
    { e: entity, k: key }
  )
  for (const r of rows) {
    const theirs = JSON.parse(str(r.theirs_json)) as unknown
    let covered: boolean
    if (entity === 'work-event') covered = identicalLabel(mine, theirs)
    else {
      const order = compareVersions(versionsOf(mine), versionsOf(theirs))
      covered = order === 'a-newer' || (order === 'same' && sameLabelContent(mine, theirs))
    }
    if (covered) {
      db.run(`UPDATE label_conflicts SET resolved_at = $t, resolution = 'superseded' WHERE id = $id`, { t: now, id: num(r.id) })
    }
  }
}

function conflictSha256(db: Db, entity: LabelStoreEntity, v: unknown): string | null {
  switch (entity) {
    case 'physical-defect':
      return null
    case 'observation': {
      const r = db.get('SELECT sha256 FROM label_records WHERE uuid = $u', { u: (v as ObservationRow).recordUuid })
      return r ? str(r.sha256) : null
    }
    default:
      return ((v as { sha256?: string | null }).sha256 ?? null) || null
  }
}

/** 충돌의 라벨러: 기록·구간·이벤트는 그 값의 라벨러, 관측 행은 그 기록의 라벨러(2인 모드에서 숨기고 막도록), 나머지는 null */
function conflictLabeler(db: Db, entity: LabelStoreEntity, v: unknown): string | null {
  if (entity === 'record' || entity === 'review-interval' || entity === 'work-event') return (v as { labelerId: string }).labelerId
  if (entity === 'observation') {
    const r = db.get('SELECT labeler_id FROM label_records WHERE uuid = $u', { u: (v as ObservationRow).recordUuid })
    return r ? str(r.labeler_id) : null
  }
  return null
}

// ───────────────────────────── 검사 · 저장 ─────────────────────────────

function requirePcId(ctx: LabelWriteContext): { pcId: string; slot: string } {
  const pc = typeof ctx?.pcId === 'string' ? ctx.pcId.trim() : ''
  if (pc === '') throw new AppError('INVALID_ARGUMENT', 'PC ID 가 없습니다. 설정에서 이 PC 의 ID 를 정하세요.')
  return { pcId: pc, slot: slotOf(ctx) }
}

function checked<T>(r: LabelCheckResult<T>, label: string): T {
  if (!r.ok || r.value === null) {
    const shown = r.errors.slice(0, 5).join(' / ')
    const more = r.errors.length > 5 ? ` 외 ${r.errors.length - 5}건` : ''
    throw new AppError('INVALID_ARGUMENT', `${label} 값이 올바르지 않습니다: ${shown}${more}`, r.errors.join('\n'))
  }
  return r.value
}

function saveVersioned<E extends VersionedLabelEntity>(
  db: Db,
  entity: E,
  input: LabelEntityMap[E],
  ctx: LabelWriteContext,
  now: () => string
): LabelSaveResult<LabelEntityMap[E]> {
  const { pcId, slot } = requirePcId(ctx)
  const spec = SPECS[entity] as TableSpec<LabelEntityMap[E]>
  const r = spec.validate(input)
  const value = checked(r, LABEL_ENTITY_NAME[entity])
  const key = labelEntityKey(entity, value)
  return db.transaction(() => {
    const old = getRaw(db, entity, key)
    if (old) {
      const why = spec.immutable?.(old, value)
      if (why) throw new AppError('INVALID_ARGUMENT', why)
      if (compareVersions(versionsOf(value), versionsOf(old)) !== 'same') {
        throw new AppError(
          'CONFLICT',
          `${LABEL_ENTITY_NAME[entity]}이(가) 그사이 다른 곳에서 바뀌었습니다. 다시 열어 고치세요.`,
          `stored ${JSON.stringify(versionsOf(old))} ≠ given ${JSON.stringify(versionsOf(value))}`
        )
      }
      if (sameLabelContent(old, value)) return { value: old, warnings: r.warnings, changed: false }
    }
    const t = now()
    const versions = bumpVersions(versionsOf(old ?? value), slot)
    // 계산 칸은 저장된 값을 이어 쓴다 (화면이 옛 groupingId 를 들고 와도 되돌리지 않게)
    const base = entity === 'record' && old ? ({ ...value, groupingId: (old as IndicationRecord).groupingId } as LabelEntityMap[E]) : value
    const next = spec.stamp(base, { pcId, now: t, old, versions })
    putRaw(db, entity, next, t)
    closeSuperseded(db, entity, key, next, t)
    return { value: next, warnings: r.warnings, changed: true }
  })
}

function deleteVersioned<E extends VersionedLabelEntity>(
  db: Db,
  entity: E,
  key: string,
  ctx: LabelWriteContext,
  now: () => string
): LabelSaveResult<LabelEntityMap[E]> {
  return db.transaction(() => {
    const old = getRaw(db, entity, key)
    if (!old) throw new AppError('NOT_FOUND', `${LABEL_ENTITY_NAME[entity]}을(를) 찾을 수 없습니다.`)
    if ((old as { deleted: boolean }).deleted) return { value: old, warnings: [], changed: false }
    return saveVersioned(db, entity, { ...old, deleted: true }, ctx, now)
  })
}

// ───────────────────────────── 라벨러 ─────────────────────────────

function checkLabeler(v: unknown): LabelerInfo {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AppError('INVALID_ARGUMENT', '라벨러 정보가 올바르지 않습니다.')
  const o = v as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.normalize('NFC').trim() : ''
  const name = typeof o.name === 'string' ? o.name.normalize('NFC').trim() : ''
  if (id === '') throw new AppError('INVALID_ARGUMENT', '라벨러 ID 를 입력하세요.')
  if (id.length > 64) throw new AppError('INVALID_ARGUMENT', '라벨러 ID 는 64자 이하로 입력하세요.')
  if (name === '') throw new AppError('INVALID_ARGUMENT', '라벨러 이름을 입력하세요.')
  const opt = (x: unknown, label: string): string | null => {
    if (x === null || x === undefined) return null
    if (typeof x !== 'string') throw new AppError('INVALID_ARGUMENT', `${label} 값이 올바르지 않습니다.`)
    const s = x.normalize('NFC').trim()
    return s === '' ? null : s
  }
  // 모르는 칸은 보존한다
  return { ...o, id, name, qualification: opt(o.qualification, '자격'), organization: opt(o.organization, '기관') } as LabelerInfo
}

function registerLabeler(db: Db, info: LabelerInfo, now: string): LabelerInfo {
  const v = checkLabeler(info)
  bumpWrites(db)
  db.run(
    `INSERT INTO label_labelers(id, name, qualification, organization, json, created_at, updated_at)
     VALUES ($id, $name, $q, $o, $json, $t, $t)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, qualification = excluded.qualification,
       organization = excluded.organization, json = excluded.json, updated_at = excluded.updated_at`,
    { id: v.id, name: v.name, q: v.qualification, o: v.organization, json: JSON.stringify(v), t: now }
  )
  return v
}

// ───────────────────────────── 목록 ─────────────────────────────

function hiddenByLabeler(labelerId: string, opts: LabelListOptions): boolean {
  const vis = opts.visibleLabelerId
  return vis !== null && vis !== undefined && vis !== labelerId
}

function setWhere(q: { sha256?: string; set?: LabelSetKey; labelerId?: string } & LabelListOptions, where: string[], p: Params): void {
  if (q.set) {
    where.push('sha256 = $sha AND labeler_id = $lab AND guideline_version = $gv AND reading_stage = $st')
    Object.assign(p, { sha: q.set.sha256, lab: q.set.labelerId, gv: q.set.guidelineVersion, st: q.set.readingStage })
  } else if (q.sha256 !== undefined) {
    where.push('sha256 = $sha')
    p.sha = q.sha256
  }
  if (q.labelerId !== undefined) {
    where.push('labeler_id = $lab2')
    p.lab2 = q.labelerId
  }
  if (q.visibleLabelerId !== null && q.visibleLabelerId !== undefined) {
    where.push('labeler_id = $vis')
    p.vis = q.visibleLabelerId
  }
  if (!q.includeDeleted) where.push('deleted = 0')
}

function listRecords(db: Db, q: LabelRecordQuery): IndicationRecord[] {
  if (q.set && hiddenByLabeler(q.set.labelerId, q)) return []
  const where: string[] = []
  const p: Params = {}
  setWhere(q, where, p)
  if (q.kind !== undefined) {
    where.push('kind = $kind')
    p.kind = q.kind
  }
  const rows = db.all(
    `SELECT json FROM label_records ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY sha256, labeler_id, guideline_version, reading_stage, scan_start_mm, scan_end_mm, uuid`,
    p
  )
  return rows.map((r) => parseRow<IndicationRecord>(r)!)
}

function listReviewIntervals(db: Db, q: ReviewIntervalQuery): ReviewInterval[] {
  if (q.set && hiddenByLabeler(q.set.labelerId, q)) return []
  const where: string[] = []
  const p: Params = {}
  setWhere(q, where, p)
  if (q.kind !== undefined) {
    where.push('kind = $kind')
    p.kind = q.kind
  }
  if (q.includeReleased === false) where.push('released = 0')
  const rows = db.all(
    `SELECT json FROM label_review_intervals ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY sha256, labeler_id, guideline_version, reading_stage, scan_start_mm, scan_end_mm, uuid`,
    p
  )
  return rows.map((r) => parseRow<ReviewInterval>(r)!)
}

function listObservations(db: Db, q: ObservationQuery): ObservationRow[] {
  const where: string[] = []
  const p: Params = {}
  if (q.recordUuids !== undefined) {
    if (q.recordUuids.length === 0) return []
    const names = q.recordUuids.map((u, i) => {
      p[`u${i}`] = u
      return `$u${i}`
    })
    where.push(`record_uuid IN (${names.join(', ')})`)
  }
  if (q.sha256 !== undefined) {
    where.push('record_uuid IN (SELECT uuid FROM label_records WHERE sha256 = $sha)')
    p.sha = q.sha256
  }
  if (!q.includeDeleted) where.push('deleted = 0')
  const rows = db.all(
    `SELECT json FROM label_observations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY record_uuid, group_id, leg`,
    p
  )
  return rows.map((r) => parseRow<ObservationRow>(r)!)
}

function inList(col: string, values: readonly string[], p: Params, prefix: string): string {
  const names = values.map((v, i) => {
    p[`${prefix}${i}`] = v
    return `$${prefix}${i}`
  })
  return `${col} IN (${names.join(', ')})`
}

function listFileAlignments(db: Db, q: { sha256s?: readonly string[]; specimenId?: string; includeDeleted?: boolean }): FileAlignment[] {
  const where: string[] = []
  const p: Params = {}
  if (q.sha256s !== undefined) {
    if (q.sha256s.length === 0) return []
    where.push(inList('sha256', q.sha256s, p, 's'))
  }
  if (q.specimenId !== undefined) {
    where.push('specimen_id = $sp COLLATE NOCASE')
    p.sp = q.specimenId
  }
  if (!q.includeDeleted) where.push('deleted = 0')
  const rows = db.all(`SELECT json FROM label_file_alignments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sha256`, p)
  return rows.map((r) => parseRow<FileAlignment>(r)!)
}

function listPhysicalDefects(db: Db, q: { specimenIds?: readonly string[]; includeDeleted?: boolean }): PhysicalDefect[] {
  const where: string[] = []
  const p: Params = {}
  if (q.specimenIds !== undefined) {
    if (q.specimenIds.length === 0) return []
    // 시편 ID 는 catalog 처럼 대소문자를 가리지 않고 찾는다
    const names = q.specimenIds.map((v, i) => {
      p[`p${i}`] = v
      return `$p${i}`
    })
    where.push(`lower(specimen_id) IN (${names.map((n) => `lower(${n})`).join(', ')})`)
  }
  if (!q.includeDeleted) where.push('deleted = 0')
  const rows = db.all(
    `SELECT json FROM label_physical_defects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY specimen_id, defect_id`,
    p
  )
  return rows.map((r) => parseRow<PhysicalDefect>(r)!)
}

function listWorkEvents(db: Db, q: WorkEventQuery): WorkEvent[] {
  const where: string[] = []
  const p: Params = {}
  if (q.sha256 !== undefined) {
    where.push('sha256 = $sha')
    p.sha = q.sha256
  }
  if (q.labelerId !== undefined) {
    where.push('labeler_id = $lab')
    p.lab = q.labelerId
  }
  if (q.sessionId !== undefined) {
    where.push('session_id = $ses')
    p.ses = q.sessionId
  }
  if (q.readingStage !== undefined) {
    where.push('reading_stage = $st')
    p.st = q.readingStage
  }
  // 추가한 순서(rowid)로 — 시각은 PC 시계가 어긋날 수 있어 순서로 쓰지 않는다
  const rows = db.all(`SELECT json FROM label_work_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY rowid`, p)
  return rows.map((r) => parseRow<WorkEvent>(r)!)
}

function spanLength(spans: { startMm: number; endMm: number }[]): number {
  return mergeSpans(spans.map((s) => ({ frameKey: '', startMm: s.startMm, endMm: s.endMm }))).reduce((a, s) => a + (s.endMm - s.startMm), 0)
}

function listLabelSets(db: Db, q: LabelSetQuery): LabelSetSummary[] {
  const where: string[] = []
  const p: Params = {}
  setWhere({ sha256: q.sha256, labelerId: q.labelerId, visibleLabelerId: q.visibleLabelerId, includeDeleted: true }, where, p)
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const recRows = db.all(
    `SELECT sha256, labeler_id, guideline_version, reading_stage,
       sum(deleted = 0) AS live, sum(deleted = 0 AND kind = 'defect') AS defects, sum(deleted = 1) AS dead, max(stored_at) AS last
     FROM label_records ${w} GROUP BY sha256, labeler_id, guideline_version, reading_stage`,
    p
  )
  const revRows = db.all(
    `SELECT sha256, labeler_id, guideline_version, reading_stage, kind, deleted, released, scan_start_mm, scan_end_mm, stored_at
     FROM label_review_intervals ${w}`,
    p
  )
  const sets = new Map<string, LabelSetSummary & { spans: Record<ReviewIntervalKind, { startMm: number; endMm: number }[]>; live: number }>()
  const ensure = (r: Row): LabelSetSummary & { spans: Record<ReviewIntervalKind, { startMm: number; endMm: number }[]>; live: number } => {
    const key: LabelSetKey = {
      sha256: str(r.sha256),
      labelerId: str(r.labeler_id),
      guidelineVersion: str(r.guideline_version),
      readingStage: str(r.reading_stage) as ReadingStage
    }
    const id = labelSetId(key)
    let s = sets.get(id)
    if (!s) {
      s = {
        ...key,
        setId: id,
        recordCount: 0,
        defectCount: 0,
        deletedRecordCount: 0,
        reviewIntervalCount: 0,
        reviewedLengthMm: 0,
        qualityBadLengthMm: 0,
        belowThresholdLengthMm: 0,
        lastStoredAt: null,
        fileId: null,
        fileName: null,
        pendingConflicts: 0,
        spans: { reviewed: [], 'quality-bad': [], 'below-threshold': [] },
        live: 0
      }
      sets.set(id, s)
    }
    return s
  }
  const later = (a: string | null, c: string | null): string | null => (a === null ? c : c === null ? a : a > c ? a : c)
  for (const r of recRows) {
    const s = ensure(r)
    s.recordCount = num(r.live)
    s.defectCount = num(r.defects)
    s.deletedRecordCount = num(r.dead)
    s.live += num(r.live)
    s.lastStoredAt = later(s.lastStoredAt, strOrNull(r.last))
  }
  for (const r of revRows) {
    const s = ensure(r)
    s.lastStoredAt = later(s.lastStoredAt, strOrNull(r.stored_at))
    if (num(r.deleted) === 1) continue
    s.reviewIntervalCount++
    s.live++
    const kind = str(r.kind) as ReviewIntervalKind
    if (kind === 'reviewed' && num(r.released) === 1) continue
    s.spans[kind]?.push({ startMm: num(r.scan_start_mm), endMm: num(r.scan_end_mm) })
  }
  const fileCache = new Map<string, Row | undefined>()
  const out: LabelSetSummary[] = []
  for (const s of [...sets.values()].sort((a, c) => (a.setId < c.setId ? -1 : a.setId > c.setId ? 1 : 0))) {
    if (!q.includeDeleted && s.live === 0) continue
    if (!fileCache.has(s.sha256)) fileCache.set(s.sha256, db.get('SELECT id, stored_file_name FROM files WHERE sha256 = $s', { s: s.sha256 }))
    const f = fileCache.get(s.sha256)
    const pending = db.get(
      `SELECT count(*) AS n FROM label_conflicts c WHERE c.resolved_at IS NULL AND c.sha256 = $sha AND (
         (c.entity IN ('record', 'review-interval') AND EXISTS (
           SELECT 1 FROM label_records r WHERE r.uuid = c.entity_key AND r.labeler_id = $lab AND r.guideline_version = $gv AND r.reading_stage = $st
           UNION ALL
           SELECT 1 FROM label_review_intervals v WHERE v.uuid = c.entity_key AND v.labeler_id = $lab AND v.guideline_version = $gv AND v.reading_stage = $st))
         OR (c.entity = 'observation' AND EXISTS (
           SELECT 1 FROM label_records r WHERE r.uuid = json_extract(c.entity_key, '$[0]') AND r.labeler_id = $lab AND r.guideline_version = $gv AND r.reading_stage = $st)))`,
      { sha: s.sha256, lab: s.labelerId, gv: s.guidelineVersion, st: s.readingStage }
    )
    const { spans, live: _live, ...summary } = s
    out.push({
      ...summary,
      reviewedLengthMm: spanLength(spans.reviewed),
      qualityBadLengthMm: spanLength(spans['quality-bad']),
      belowThresholdLengthMm: spanLength(spans['below-threshold']),
      fileId: f ? numOrNull(f.id) : null,
      fileName: f ? strOrNull(f.stored_file_name) : null,
      pendingConflicts: num(pending?.n)
    })
  }
  return out
}

// ───────────────────────────── 충돌 ─────────────────────────────

function addConflict(db: Db, input: NewConflictInput, now: string): { id: number; created: boolean } {
  const key = labelEntityKey(input.entity, input.theirs)
  const hash = hashJson(input.theirs)
  // 전에 '내 것'·'둘 다'로 푼 같은 들어온 사본이면 다시 묻지 않는다
  const decided = db.get(
    `SELECT id FROM label_conflicts WHERE entity = $e AND entity_key = $k AND theirs_hash = $h AND resolution IN ('mine', 'both') ORDER BY id LIMIT 1`,
    { e: input.entity, k: key, h: hash }
  )
  if (decided) return { id: num(decided.id), created: false }
  const r = db.run(
    `INSERT OR IGNORE INTO label_conflicts(entity, entity_key, sha256, labeler_id, mine_json, theirs_json, theirs_hash,
       source_pc_id, source_name, source_exported_at, detected_at)
     VALUES ($e, $k, $sha, $lab, $mine, $theirs, $h, $pc, $sn, $at, $t)`,
    {
      e: input.entity,
      k: key,
      sha: conflictSha256(db, input.entity, input.theirs) ?? conflictSha256(db, input.entity, input.mine),
      lab: conflictLabeler(db, input.entity, input.theirs) ?? conflictLabeler(db, input.entity, input.mine),
      mine: JSON.stringify(input.mine),
      theirs: JSON.stringify(input.theirs),
      h: hash,
      pc: input.sourcePcId ?? null,
      sn: input.sourceName ?? null,
      at: input.sourceExportedAt ?? null,
      t: now
    }
  )
  if (r.changes > 0) return { id: r.lastInsertRowid, created: true }
  const existing = db.get(
    `SELECT id FROM label_conflicts WHERE entity = $e AND entity_key = $k AND theirs_hash = $h AND resolved_at IS NULL`,
    { e: input.entity, k: key, h: hash }
  )
  return { id: num(existing?.id), created: false }
}

function listConflicts(db: Db, q: ConflictQuery): LabelConflict[] {
  const where: string[] = []
  const p: Params = {}
  if (q.pendingOnly !== false) where.push('resolved_at IS NULL')
  if (q.entity !== undefined) {
    where.push('entity = $e')
    p.e = q.entity
  }
  if (q.sha256 !== undefined) {
    where.push('sha256 = $sha')
    p.sha = q.sha256
  }
  if (q.key !== undefined) {
    where.push('entity_key = $k')
    p.k = q.key
  }
  return db.all(`SELECT * FROM label_conflicts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`, p).map(toConflict)
}

// ───────────────────────────── 복제본 (버전 벡터 칸) ─────────────────────────────

interface ReplicaRow {
  id: string
  pcId: string
  dbPath: string
  createdAt: string
}

function metaGet(db: Db, key: string): string | null {
  const r = db.get('SELECT value FROM label_meta WHERE key = $k', { k: key })
  return r ? str(r.value) : null
}

function metaSet(db: Db, key: string, value: string): void {
  db.run('INSERT INTO label_meta(key, value) VALUES ($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value', { k: key, v: value })
}

function readReplicas(db: Db): ReplicaRow[] {
  const raw = metaGet(db, 'replicas')
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && typeof (x as ReplicaRow).id === 'string') as ReplicaRow[]) : []
  } catch {
    return []
  }
}

function writeCount(db: Db): number {
  const v = Number(metaGet(db, 'writes') ?? '0')
  return Number.isFinite(v) ? v : 0
}

function newReplica(db: Db, pcId: string, dbPath: string, now: string): LabelReplica {
  const list = readReplicas(db)
  let id = randomBytes(4).toString('hex')
  while (list.some((r) => r.id === id)) id = randomBytes(4).toString('hex')
  list.push({ id, pcId, dbPath, createdAt: now })
  metaSet(db, 'replicas', JSON.stringify(list))
  return { id, pcId, slot: `${pcId}:${id}`, writes: writeCount(db), created: true }
}

function currentReplica(db: Db, pcId: string, dbPath: string, now: string): LabelReplica {
  const hit = [...readReplicas(db)].reverse().find((r) => r.pcId === pcId && r.dbPath === dbPath)
  if (hit) return { id: hit.id, pcId, slot: `${pcId}:${hit.id}`, writes: writeCount(db), created: false }
  return newReplica(db, pcId, dbPath, now)
}

const VERSIONED_TABLES = ['label_records', 'label_observations', 'label_review_intervals', 'label_file_alignments', 'label_physical_defects'] as const

/** LIKE 특수 문자 이스케이프 (ESCAPE '\') */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function pcIdUsedElsewhere(db: Db, pcId: string): boolean {
  const own = new Set(readReplicas(db).map((r) => r.id))
  const pat = `%"pcId":"${likeEscape(pcId)}%`
  for (const t of VERSIONED_TABLES) {
    const rows = db.all(`SELECT versions_json FROM ${t} WHERE versions_json LIKE $p ESCAPE '\\'`, { p: pat })
    for (const r of rows) {
      let vs: VersionEntry[] = []
      try {
        vs = JSON.parse(str(r.versions_json)) as VersionEntry[]
      } catch {
        vs = []
      }
      for (const e of vs) {
        if (e.pcId === pcId) return true
        const i = e.pcId.lastIndexOf(':')
        if (i > 0 && e.pcId.slice(0, i) === pcId && !own.has(e.pcId.slice(i + 1))) return true
      }
    }
  }
  return db.get('SELECT 1 AS x FROM label_conflicts WHERE source_pc_id = $p LIMIT 1', { p: pcId }) !== undefined
}

// ───────────────────────────── 계산 칸 · 엑셀 가져오기 기준 ─────────────────────────────

function setRecordGrouping(db: Db, uuid: string, groupingId: string | null, now: string): boolean {
  const r = getRaw(db, 'record', uuid)
  if (!r) throw new AppError('NOT_FOUND', '지시 기록을 찾을 수 없습니다.')
  if (r.groupingId === groupingId) return false
  const next: IndicationRecord = { ...r, groupingId }
  bumpWrites(db)
  db.run('UPDATE label_records SET grouping_id = $g, json = $j, stored_at = $t WHERE uuid = $u', { g: groupingId, j: JSON.stringify(next), t: now, u: uuid })
  return true
}

function getImportMark(db: Db, entity: string, key: string): LabelImportMark | null {
  const r = db.get('SELECT * FROM label_import_marks WHERE entity = $e AND entity_key = $k', { e: entity, k: key })
  if (!r) return null
  let versions: VersionEntry[] = []
  try {
    versions = JSON.parse(str(r.versions_json)) as VersionEntry[]
  } catch {
    versions = []
  }
  return { rowHash: str(r.row_hash), versions, deletedByImport: num(r.deleted_by_import) === 1, markedAt: str(r.marked_at) }
}

function setImportMark(db: Db, entity: string, key: string, m: Omit<LabelImportMark, 'markedAt'>, now: string): void {
  db.run(
    `INSERT INTO label_import_marks(entity, entity_key, source, row_hash, versions_json, deleted_by_import, marked_at)
     VALUES ($e, $k, 'workbook', $h, $v, $d, $t)
     ON CONFLICT(entity, entity_key) DO UPDATE SET row_hash = excluded.row_hash, versions_json = excluded.versions_json,
       deleted_by_import = excluded.deleted_by_import, marked_at = excluded.marked_at`,
    { e: entity, k: key, h: m.rowHash, v: JSON.stringify(m.versions), d: b(m.deletedByImport), t: now }
  )
}

// ───────────────────────────── 만들기 ─────────────────────────────

export function createLabelStore(db: Db, now: () => string, dbPath = ':memory:'): LabelStore {
  const tx = <T>(fn: () => T): T => db.transaction(fn)
  const needPc = (pcId: string): string => {
    const pc = typeof pcId === 'string' ? pcId.trim() : ''
    if (pc === '') throw new AppError('INVALID_ARGUMENT', 'PC ID 가 없습니다. 설정에서 이 PC 의 ID 를 정하세요.')
    return pc
  }
  return {
    clock: now,

    replica: (pcId) => tx(() => currentReplica(db, needPc(pcId), dbPath, now())),
    rotateReplica: (pcId) => tx(() => newReplica(db, needPc(pcId), dbPath, now())),
    ownReplicaIds: () => readReplicas(db).map((r) => r.id),
    writeCount: () => writeCount(db),
    pcIdUsedElsewhere: (pcId) => pcIdUsedElsewhere(db, needPc(pcId)),

    registerLabeler: (info) => tx(() => registerLabeler(db, info, now())),
    getLabeler: (id) => parseRow<LabelerInfo>(db.get('SELECT json FROM label_labelers WHERE id = $id', { id })),
    listLabelers: () => db.all('SELECT json FROM label_labelers ORDER BY id').map((r) => parseRow<LabelerInfo>(r)!),

    saveRecord: (record, ctx) => saveVersioned(db, 'record', record, ctx, now),
    getRecord: (uuid) => getRaw(db, 'record', uuid),
    deleteRecord: (uuid, ctx) => deleteVersioned(db, 'record', uuid, ctx, now),
    listRecords: (query = {}) => listRecords(db, query),
    listLabelSets: (query = {}) => listLabelSets(db, query),
    setRecordGrouping: (uuid, groupingId) => tx(() => setRecordGrouping(db, uuid, groupingId, now())),

    saveObservation: (row, ctx) => saveVersioned(db, 'observation', row, ctx, now),
    getObservation: (u, g, l) => getRaw(db, 'observation', observationKey(u, g, l)),
    deleteObservation: (u, g, l, ctx) => deleteVersioned(db, 'observation', observationKey(u, g, l), ctx, now),
    listObservations: (query = {}) => listObservations(db, query),

    saveReviewInterval: (v, ctx) => saveVersioned(db, 'review-interval', v, ctx, now),
    getReviewInterval: (uuid) => getRaw(db, 'review-interval', uuid),
    deleteReviewInterval: (uuid, ctx) => deleteVersioned(db, 'review-interval', uuid, ctx, now),
    listReviewIntervals: (query = {}) => listReviewIntervals(db, query),

    saveFileAlignment: (v, ctx) => saveVersioned(db, 'file-alignment', v, ctx, now),
    getFileAlignment: (sha256) => getRaw(db, 'file-alignment', sha256),
    deleteFileAlignment: (sha256, ctx) => deleteVersioned(db, 'file-alignment', sha256, ctx, now),
    listFileAlignments: (query = {}) => listFileAlignments(db, query),

    savePhysicalDefect: (v, ctx) => saveVersioned(db, 'physical-defect', v, ctx, now),
    getPhysicalDefect: (s, id) => getRaw(db, 'physical-defect', physicalDefectKey(s, id)),
    deletePhysicalDefect: (s, id, ctx) => deleteVersioned(db, 'physical-defect', physicalDefectKey(s, id), ctx, now),
    listPhysicalDefects: (query = {}) => listPhysicalDefects(db, query),

    appendWorkEvent: (e) => {
      const r = validateWorkEvent(e)
      const value = checked(r, LABEL_ENTITY_NAME['work-event'])
      return tx(() => {
        const old = getRaw(db, 'work-event', value.uuid)
        if (old) {
          if (identicalLabel(old, value)) return { value: old, warnings: r.warnings, changed: false }
          throw new AppError('CONFLICT', '같은 UUID 의 작업 이벤트가 이미 있습니다(작업 이벤트는 고칠 수 없음).')
        }
        putRaw(db, 'work-event', value, now())
        return { value, warnings: r.warnings, changed: true }
      })
    },
    listWorkEvents: (query = {}) => listWorkEvents(db, query),

    getImportMark: (entity, key) => getImportMark(db, entity, key),
    setImportMark: (entity, key, mark) => tx(() => setImportMark(db, entity, key, mark, now())),

    getEntity: (entity, key) => getRaw(db, entity, key),
    putEntity: (entity, value) =>
      tx(() => {
        const t = now()
        putRaw(db, entity, value, t)
        closeSuperseded(db, entity, labelEntityKey(entity, value), value, t)
      }),
    addConflict: (input) => tx(() => addConflict(db, input, now())),
    getConflict: (id) => {
      const r = db.get('SELECT * FROM label_conflicts WHERE id = $id', { id })
      return r ? toConflict(r) : null
    },
    listConflicts: (query = {}) => listConflicts(db, query),
    markConflictResolved: (id, resolution, newKey = null) =>
      tx(() => {
        const r = db.run(
          `UPDATE label_conflicts SET resolved_at = $t, resolution = $res, resolved_new_key = $nk WHERE id = $id AND resolved_at IS NULL`,
          { t: now(), res: resolution, nk: newKey, id }
        )
        if (r.changes === 0) {
          const exists = db.get('SELECT resolved_at FROM label_conflicts WHERE id = $id', { id })
          if (!exists) throw new AppError('NOT_FOUND', '충돌을 찾을 수 없습니다.')
          throw new AppError('CONFLICT', '이미 해결된 충돌입니다.')
        }
      }),
    pendingConflictCount: () => num(db.get('SELECT count(*) AS n FROM label_conflicts WHERE resolved_at IS NULL')?.n)
  }
}
