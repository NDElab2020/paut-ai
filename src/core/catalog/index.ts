/**
 * 카탈로그 — <storeRoot>/catalog.db (node:sqlite DatabaseSync).
 * Electron 비의존 순수 Node. 동기 API 이므로 짧은 트랜잭션으로 쓴다.
 */
import type { FileAnnotationPatch, FileListPage, FileQuery, SpecimenPatch } from '@shared/api'
import { AppError } from '@shared/errors'
import type {
  FileId,
  FileRecord,
  Fingerprint,
  ImportBatchId,
  ImportHistoryEntry,
  PlanId,
  ScanPlan,
  Specimen,
  SpecimenId,
  SpecimenSummary
} from '@shared/types'
import { Db } from './db'
import * as files from './files'
import * as imports from './imports'
import { createLabelStore, type LabelStore } from './labels'
import * as maintenance from './maintenance'
import * as plans from './plans'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { LATEST_SCHEMA_VERSION, currentSchemaVersion, migrate, pendingMigrations } from './schema'
import * as specimens from './specimens'
import { localIso } from './time'

export type { NewPlanInput } from './plans'
export type { SpecimenInput } from './specimens'
export type { NewFileRecord } from './files'
export type { BatchStartInput, BatchFinishInput, ImportItemRecord } from './imports'
export type { PlanSpecUpdate } from './maintenance'
export {
  LABEL_ENTITY_NAME,
  identicalLabel,
  labelContentHash,
  labelEntityKey,
  observationKey,
  physicalDefectKey,
  sameLabelContent,
  slotOf,
  specimenKey,
  type LabelImportMark,
  type LabelReplica,
  type ConflictQuery,
  type LabelConflict,
  type LabelConflictResolution,
  type LabelEntityMap,
  type LabelListOptions,
  type LabelRecordQuery,
  type LabelSaveResult,
  type LabelSetQuery,
  type LabelSetSummary,
  type LabelStore,
  type LabelStoreEntity,
  type LabelWriteContext,
  type NewConflictInput,
  type ObservationQuery,
  type ReviewIntervalQuery,
  type VersionedLabelEntity,
  type WorkEventQuery
} from './labels'
export { MIGRATIONS, LATEST_SCHEMA_VERSION, assertMigrationOrder, type Migration } from './schema'
export { canonicalJson } from './values'
export { localIso } from './time'

export const CATALOG_SCHEMA_VERSION = LATEST_SCHEMA_VERSION

export interface Catalog {
  readonly dbPath: string
  readonly schemaVersion: number
  close(): void
  /** fn 안의 모든 쓰기를 한 트랜잭션으로 (예외 시 롤백, 중첩 가능) */
  transaction<T>(fn: () => T): T

  listPlans(): ScanPlan[]
  getPlan(id: PlanId): ScanPlan | null
  findPlanByFingerprint(fingerprint: Fingerprint): ScanPlan | null
  /** 다음에 배정될 플랜 ID 미리보기 (배정하지 않음). count 개 연속 */
  peekNextPlanIds(count: number): PlanId[]
  /** 새 플랜 ID 배정(SP + 3자리, 삭제돼도 재사용 안 함) 후 생성. 같은 지문이 있으면 AppError('CONFLICT') */
  createPlan(input: plans.NewPlanInput): ScanPlan
  renamePlan(id: PlanId, name: string): ScanPlan
  setPlanNote(id: PlanId, note: string): ScanPlan

  listSpecimens(planId?: PlanId): SpecimenSummary[]
  getSpecimen(id: SpecimenId): SpecimenSummary | null
  /** 없으면 만들고 있으면 그대로 반환 (displayName 덮어쓰지 않음). 대소문자만 다른 ID 는 같은 시편 */
  ensureSpecimen(input: specimens.SpecimenInput): Specimen
  updateSpecimen(id: SpecimenId, patch: SpecimenPatch): Specimen

  findFileBySha256(sha256: string): FileRecord | null
  /** setupJson: 원본 셋업 JSON 전체 (file_setups 에 함께 저장) */
  insertFile(input: files.NewFileRecord, setupJson?: string): FileRecord
  getFile(id: FileId): FileRecord | null
  getFileSetupJson(id: FileId): string | null
  refreshOpdFileSetup(id: FileId, meta: import('@shared/types').NdeFileMeta, acquisition: import('@shared/types').AcquisitionSummary, setupJson: string): void
  listFiles(query: FileQuery): FileListPage
  updateFile(id: FileId, patch: FileAnnotationPatch): FileRecord

  beginImportBatch(input: imports.BatchStartInput): void
  finishImportBatch(input: imports.BatchFinishInput): void
  recordImportItem(batchId: ImportBatchId, item: imports.ImportItemRecord): void
  listImportItems(batchId: ImportBatchId): imports.ImportItemRecord[]
  listImportHistory(): ImportHistoryEntry[]

  /** 정규화 규칙 갱신: 플랜 스펙·지문 교체 (다른 플랜과 지문이 겹치면 CONFLICT) */
  updatePlanSpec(id: PlanId, input: maintenance.PlanSpecUpdate): void
  /** 셋업 원문이 보관된 플랜의 첫 파일 */
  firstFileIdOfPlan(planId: PlanId): FileId | null
  listStoredRelPaths(): string[]
  setFileStoredPath(id: FileId, relPath: string, storedFileName: string): void
  /** 끝나지 않은 배치를 '중단됨'으로 닫고 그 수를 돌려준다 */
  closeInterruptedBatches(): number

  /**
   * 결함 라벨 저장소 (labels.ts, 스키마 v2). 지시 기록·관측 표·검토 구간·파일 정렬·물리 결함·작업 이벤트·라벨러·충돌.
   * 저장은 버전 벡터를 올리고, 지우기는 삭제 표시다. 파일과는 sha256 으로만 잇는다.
   */
  readonly labels: LabelStore
}

export interface OpenCatalogOptions {
  /** 시각 주입 (테스트용). 기본은 로컬 시간대 ISO */
  now?: () => string
}

/** 'YYYYMMDD-HHmmss' (백업 파일 이름) */
function backupStamp(iso: string): string {
  return iso.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

/**
 * 스키마를 올리기 전 백업: 있던 DB(스키마 ≥ 1)에 적용할 마이그레이션이 있으면 같은 폴더에
 * 'catalog.v<지금>-<시각>.bak' 을 만든다(VACUUM INTO, 한 시점의 일관된 사본). 만들지 못하면 올리지 않는다.
 * 옛 앱은 더 새 스키마를 열지 않으므로(migrate), 이 사본이 있으면 옛 앱으로 돌아갈 수 있다.
 */
export function backupBeforeMigrate(db: Db, dbPath: string, nowIso: string): string | null {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return null
  const current = currentSchemaVersion(db)
  if (current < 1 || pendingMigrations(db).length === 0) return null
  const base = basename(dbPath).replace(/\.db$/i, '')
  let target = join(dirname(dbPath), `${base}.v${current}-${backupStamp(nowIso)}.bak`)
  for (let n = 2; existsSync(target); n++) target = join(dirname(dbPath), `${base}.v${current}-${backupStamp(nowIso)}-${n}.bak`)
  try {
    db.raw.prepare('VACUUM INTO $p').run({ p: target })
  } catch (err) {
    throw new AppError(
      'DB_ERROR',
      '카탈로그를 새 버전으로 올리기 전에 백업을 만들지 못해 열지 않았습니다. 저장소 폴더에 쓸 수 있는지 확인하세요.',
      `${target}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  return target
}

/** DB 열기(없으면 생성 + 스키마 마이그레이션, 있던 DB 를 올릴 때는 먼저 백업). 실패 시 AppError('DB_ERROR'). ':memory:' 가능 */
export function openCatalog(dbPath: string, options: OpenCatalogOptions = {}): Catalog {
  const now = options.now ?? (() => localIso())
  const db = Db.open(dbPath)
  let schemaVersion: number
  try {
    backupBeforeMigrate(db, dbPath, now())
    schemaVersion = migrate(db, now)
  } catch (err) {
    db.close()
    throw err instanceof AppError ? err : new AppError('DB_ERROR', '카탈로그 스키마를 준비하지 못했습니다.', String(err))
  }
  return {
    dbPath,
    schemaVersion,
    close: () => db.close(),
    transaction: (fn) => db.transaction(fn),

    listPlans: () => plans.listPlans(db),
    getPlan: (id) => plans.getPlan(db, id),
    findPlanByFingerprint: (fp) => plans.findPlanByFingerprint(db, fp),
    peekNextPlanIds: (n) => plans.peekNextPlanIds(db, n),
    createPlan: (input) => plans.createPlan(db, input, now()),
    renamePlan: (id, name) => plans.renamePlan(db, id, name, now()),
    setPlanNote: (id, note) => plans.setPlanNote(db, id, note, now()),

    listSpecimens: (planId) => specimens.listSpecimens(db, planId),
    getSpecimen: (id) => specimens.listSpecimens(db, undefined, id)[0] ?? null,
    ensureSpecimen: (input) => specimens.ensureSpecimen(db, input, now()),
    updateSpecimen: (id, patch) => specimens.updateSpecimen(db, id, patch, now()),

    findFileBySha256: (sha) => files.findFileBySha256(db, sha),
    insertFile: (input, setupJson) => files.insertFile(db, input, setupJson),
    getFile: (id) => files.getFile(db, id),
    getFileSetupJson: (id) => files.getFileSetupJson(db, id),
    refreshOpdFileSetup: (id, meta, acquisition, setupJson) => files.refreshOpdFileSetup(db, id, meta, acquisition, setupJson),
    listFiles: (query) => files.listFiles(db, query),
    updateFile: (id, patch) => files.updateFile(db, id, patch),

    beginImportBatch: (input) => imports.beginImportBatch(db, input),
    finishImportBatch: (input) => imports.finishImportBatch(db, input),
    recordImportItem: (batchId, item) => imports.recordImportItem(db, batchId, item),
    listImportItems: (batchId) => imports.listImportItems(db, batchId),
    listImportHistory: () => imports.listImportHistory(db),

    updatePlanSpec: (id, input) => maintenance.updatePlanSpec(db, id, input, now()),
    firstFileIdOfPlan: (planId) => maintenance.firstFileIdOfPlan(db, planId),
    listStoredRelPaths: () => maintenance.listStoredRelPaths(db),
    setFileStoredPath: (id, rel, name) => maintenance.setFileStoredPath(db, id, rel, name),
    closeInterruptedBatches: () => maintenance.closeInterruptedBatches(db, now()),

    labels: createLabelStore(db, now, dbPath)
  }
}
