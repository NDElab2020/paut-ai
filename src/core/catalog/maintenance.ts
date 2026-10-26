/** 저장소 점검·복구·규칙 갱신에 쓰는 카탈로그 쓰기 (가져오기 흐름 밖) */
import { AppError } from '@shared/errors'
import type { FileId, Fingerprint, PlanId, ScanPlanSpec } from '@shared/types'
import type { Db } from './db'
import { canonicalJson, cleanText, num, requireText, str } from './values'

export interface PlanSpecUpdate {
  fingerprint: Fingerprint
  spec: ScanPlanSpec
  summary: string
}

/** 정규화 규칙이 바뀐 뒤 플랜의 스펙·지문을 다시 계산한 값으로 바꾼다 (이름·메모·ID 는 그대로) */
export function updatePlanSpec(db: Db, id: PlanId, input: PlanSpecUpdate, now: string): void {
  const fp = requireText(input.fingerprint, '지문', 200)
  db.transaction(() => {
    const other = db.get('SELECT id FROM plans WHERE fingerprint = $fp AND id <> $id', { fp, id })
    if (other) throw new AppError('CONFLICT', `같은 셋업의 스캔플랜이 이미 있습니다(${str(other.id)}).`)
    const r = db.run(
      `UPDATE plans SET fingerprint = $fp, spec_version = $sv, spec_json = $spec, summary = $summary, updated_at = $now
       WHERE id = $id`,
      { id, fp, sv: input.spec.specVersion, spec: canonicalJson(input.spec), summary: cleanText(input.summary ?? '', '요약'), now }
    )
    if (r.changes === 0) throw new AppError('NOT_FOUND', `스캔플랜 ${id} 을(를) 찾을 수 없습니다.`)
  })
}

/** 플랜의 첫 파일 (규칙 갱신 때 셋업 원문을 읽을 대표 파일) */
export function firstFileIdOfPlan(db: Db, planId: PlanId): FileId | null {
  const r = db.get(
    `SELECT f.id FROM files f JOIN file_setups s ON s.file_id = f.id WHERE f.plan_id = $p ORDER BY f.id LIMIT 1`,
    { p: planId }
  )
  return r ? num(r.id) : null
}

/** 카탈로그에 등록된 저장 상대경로 전체 */
export function listStoredRelPaths(db: Db): string[] {
  return db.all('SELECT stored_rel_path FROM files').map((r) => str(r.stored_rel_path))
}

/** 사라진 사본을 다시 복사한 뒤 레코드의 저장 경로를 고친다 */
export function setFileStoredPath(db: Db, id: FileId, relPath: string, storedFileName: string): void {
  const r = db.run('UPDATE files SET stored_rel_path = $rel, stored_file_name = $name WHERE id = $id', {
    id,
    rel: requireText(relPath, '저장 경로', 1000),
    name: requireText(storedFileName, '파일 이름', 300)
  })
  if (r.changes === 0) throw new AppError('NOT_FOUND', `파일 #${id} 을(를) 찾을 수 없습니다.`)
}

/**
 * 끝나지 않은 가져오기 배치(앱 강제 종료 등)를 '중단됨'으로 닫는다.
 * status 는 NULL 로 두고 finished_at 을 채운다 → 이력에서 'interrupted'. 복사 수·용량은 실제 기록된 파일로 다시 센다.
 */
export function closeInterruptedBatches(db: Db, now: string): number {
  return db.transaction(() => {
    const open = db.all('SELECT id FROM import_batches WHERE finished_at IS NULL').map((r) => str(r.id))
    for (const id of open) {
      const agg = db.get('SELECT count(*) AS n, coalesce(sum(size_bytes), 0) AS bytes FROM files WHERE import_batch_id = $id', { id })
      db.run(
        `UPDATE import_batches SET finished_at = $now, status = NULL, copied_count = $n, total_bytes = $bytes WHERE id = $id`,
        { id, now, n: num(agg?.n), bytes: num(agg?.bytes) }
      )
    }
    return open.length
  })
}
