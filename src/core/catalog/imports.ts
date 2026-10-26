import { AppError } from '@shared/errors'
import type { ImportBatchId, ImportBatchStatus, ImportHistoryEntry, ImportItemResult, ImportItemStatus, PlanId } from '@shared/types'
import type { Db, Row } from './db'
import { num, numOrNull, parseJson, requireText, str, strOrNull } from './values'

export interface BatchStartInput {
  batchId: ImportBatchId
  inputPaths: string[]
  totalItems: number
  startedAt: string
}

export interface BatchFinishInput {
  batchId: ImportBatchId
  finishedAt: string
  status: ImportBatchStatus
  copiedCount: number
  skippedCount: number
  failedCount: number
  createdPlanIds: PlanId[]
  totalBytes: number
}

/** 가져오기 항목 1건 기록 (원본 경로 포함) */
export interface ImportItemRecord extends ImportItemResult {
  sourcePath: string
}

const STATUSES: readonly ImportBatchStatus[] = ['completed', 'partial', 'failed', 'cancelled']

const count = (v: number): number => (Number.isSafeInteger(v) && v >= 0 ? v : 0)

export function beginImportBatch(db: Db, input: BatchStartInput): void {
  db.run(
    `INSERT INTO import_batches(id, started_at, input_paths_json, total_items)
     VALUES ($id, $at, $paths, $total)`,
    {
      id: requireText(input.batchId, '배치 ID'),
      at: requireText(input.startedAt, '시작 시각'),
      paths: JSON.stringify(input.inputPaths ?? []),
      total: count(input.totalItems)
    }
  )
}

export function finishImportBatch(db: Db, input: BatchFinishInput): void {
  if (!STATUSES.includes(input.status)) throw new AppError('INVALID_ARGUMENT', '가져오기 상태 값이 올바르지 않습니다.')
  const r = db.run(
    `UPDATE import_batches SET finished_at = $at, status = $status, copied_count = $copied, skipped_count = $skipped,
       failed_count = $failed, created_plan_ids_json = $plans, total_bytes = $bytes
     WHERE id = $id`,
    {
      id: input.batchId,
      at: requireText(input.finishedAt, '종료 시각'),
      status: input.status,
      copied: count(input.copiedCount),
      skipped: count(input.skippedCount),
      failed: count(input.failedCount),
      plans: JSON.stringify(input.createdPlanIds ?? []),
      bytes: count(input.totalBytes)
    }
  )
  if (r.changes === 0) throw new AppError('NOT_FOUND', `가져오기 배치 ${input.batchId} 을(를) 찾을 수 없습니다.`)
}

export function recordImportItem(db: Db, batchId: ImportBatchId, item: ImportItemRecord): void {
  db.run(
    `INSERT OR REPLACE INTO import_items(batch_id, item_id, source_path, file_name, outcome, message, file_id, plan_id,
       specimen_id, stored_rel_path)
     VALUES ($batch, $item, $src, $name, $outcome, $msg, $file, $plan, $specimen, $rel)`,
    {
      batch: batchId,
      item: item.itemId,
      src: item.sourcePath,
      name: item.fileName,
      outcome: item.status,
      msg: item.errorMessage,
      file: item.fileId,
      plan: item.planId,
      specimen: item.specimenId,
      rel: item.storedRelPath
    }
  )
}

export function listImportItems(db: Db, batchId: ImportBatchId): ImportItemRecord[] {
  return db.all('SELECT * FROM import_items WHERE batch_id = $b ORDER BY item_id', { b: batchId }).map((r) => ({
    itemId: str(r.item_id),
    sourcePath: str(r.source_path),
    fileName: str(r.file_name),
    status: str(r.outcome) as ImportItemStatus,
    fileId: numOrNull(r.file_id),
    planId: strOrNull(r.plan_id),
    specimenId: strOrNull(r.specimen_id),
    storedRelPath: strOrNull(r.stored_rel_path),
    errorMessage: strOrNull(r.message)
  }))
}

/**
 * status 가 NULL 인 배치는 끝나지 않았거나(finishedAt null: 진행 중 또는 강제 종료) 복구 때 닫힌 것이다 → 'interrupted'.
 * 진행 중인지는 화면이 현재 작업 ID 와 비교해 정한다.
 */
function toHistory(r: Row): ImportHistoryEntry {
  return {
    batchId: str(r.id),
    startedAt: str(r.started_at),
    finishedAt: strOrNull(r.finished_at),
    status: (strOrNull(r.status) ?? 'interrupted') as ImportBatchStatus,
    inputPaths: parseJson<string[]>(r.input_paths_json, []),
    totalItems: num(r.total_items),
    copiedCount: num(r.copied_count),
    skippedCount: num(r.skipped_count),
    failedCount: num(r.failed_count),
    createdPlanIds: parseJson<PlanId[]>(r.created_plan_ids_json, []),
    totalBytes: num(r.total_bytes)
  }
}

export function listImportHistory(db: Db): ImportHistoryEntry[] {
  return db.all('SELECT * FROM import_batches ORDER BY started_at DESC, rowid DESC').map(toHistory)
}
