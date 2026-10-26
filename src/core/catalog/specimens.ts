import type { SpecimenPatch } from '@shared/api'
import { AppError } from '@shared/errors'
import { sanitizePathSegment } from '@shared/ids'
import type { PlanId, Specimen, SpecimenId, SpecimenIdSource, SpecimenSummary } from '@shared/types'
import type { Db, Row } from './db'
import { cleanText, koCollator, num, requireText, str, strOrNull } from './values'

export interface SpecimenInput {
  id: SpecimenId
  displayName: string
  source: SpecimenIdSource
}

const SOURCES: readonly SpecimenIdSource[] = ['device-filename', 'filename', 'manual']

/** 시편 ID 는 폴더명으로 쓰이므로 이미 안전한 값이어야 한다 (대소문자만 다른 ID 는 같은 시편) */
export function validateSpecimenId(raw: unknown): SpecimenId {
  const id = requireText(raw, '시편 ID', 80)
  if (sanitizePathSegment(id) !== id) {
    throw new AppError('INVALID_ARGUMENT', `시편 ID '${id}' 에 폴더 이름으로 쓸 수 없는 문자가 있습니다.`)
  }
  return id
}

function toSpecimen(r: Row): Specimen {
  return {
    id: str(r.id),
    displayName: str(r.display_name),
    source: str(r.source) as SpecimenIdSource,
    note: str(r.note),
    createdAt: str(r.created_at)
  }
}

export function getSpecimenRow(db: Db, id: SpecimenId): Specimen | null {
  const r = db.get('SELECT * FROM specimens WHERE id = $id', { id: id.normalize('NFC').trim() })
  return r ? toSpecimen(r) : null
}

export function ensureSpecimen(db: Db, input: SpecimenInput, now: string): Specimen {
  const id = validateSpecimenId(input.id)
  if (!SOURCES.includes(input.source)) throw new AppError('INVALID_ARGUMENT', '시편 ID 출처 값이 올바르지 않습니다.')
  const displayName = cleanText(input.displayName ?? '', '시편 이름') || id
  return db.transaction(() => {
    const found = getSpecimenRow(db, id)
    if (found) return found
    db.run(
      `INSERT INTO specimens(id, display_name, source, note, created_at, updated_at)
       VALUES ($id, $name, $source, '', $now, $now)`,
      { id, name: displayName, source: input.source, now }
    )
    return getSpecimenRow(db, id)!
  })
}

export function updateSpecimen(db: Db, id: SpecimenId, patch: SpecimenPatch, now: string): Specimen {
  const current = getSpecimenRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', `시편 ${id} 을(를) 찾을 수 없습니다.`)
  const displayName = patch.displayName === undefined ? current.displayName : requireText(patch.displayName, '시편 이름')
  const note = patch.note === undefined ? current.note : cleanText(patch.note, '메모')
  db.run('UPDATE specimens SET display_name = $n, note = $note, updated_at = $now WHERE id = $id', {
    id: current.id,
    n: displayName,
    note,
    now
  })
  return getSpecimenRow(db, current.id)!
}

/** planId 를 주면 그 플랜에 파일이 있는 시편만, 개수·상태 태그도 그 플랜 기준. planIds 는 항상 전체 */
export function listSpecimens(db: Db, planId?: PlanId, onlyId?: SpecimenId): SpecimenSummary[] {
  const planFilter = planId === undefined ? '' : 'WHERE plan_id = $plan'
  const params: Record<string, string> = {}
  if (planId !== undefined) params.plan = planId
  const where: string[] = []
  if (planId !== undefined) where.push('f.specimen_id IS NOT NULL')
  if (onlyId !== undefined) {
    where.push('s.id = $only')
    params.only = onlyId.normalize('NFC').trim()
  }
  const rows = db.all(
    `SELECT s.*, coalesce(f.file_count, 0) AS file_count, f.last_imported_at
     FROM specimens s
     LEFT JOIN (
       SELECT specimen_id, count(*) AS file_count, max(imported_at) AS last_imported_at
       FROM files ${planFilter} GROUP BY specimen_id
     ) f ON f.specimen_id = s.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params
  )
  const planIds = groupBySpecimen(
    db.all('SELECT DISTINCT f.specimen_id AS k, f.plan_id AS v, p.seq FROM files f JOIN plans p ON p.id = f.plan_id ORDER BY p.seq')
  )
  const tags = groupBySpecimen(
    db.all(
      `SELECT DISTINCT specimen_id AS k, state_tag AS v FROM files
       WHERE state_tag IS NOT NULL ${planId === undefined ? '' : 'AND plan_id = $plan'} ORDER BY state_tag`,
      planId === undefined ? {} : { plan: planId }
    )
  )
  return rows
    .map((r) => {
      const s = toSpecimen(r)
      const key = s.id.toLowerCase()
      return {
        ...s,
        planIds: planIds.get(key) ?? [],
        fileCount: num(r.file_count),
        stateTags: tags.get(key) ?? [],
        lastImportedAt: strOrNull(r.last_imported_at)
      }
    })
    .sort((a, b) => koCollator.compare(a.id, b.id))
}

function groupBySpecimen(rows: Row[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of rows) {
    const key = str(r.k).toLowerCase()
    const list = m.get(key) ?? []
    const v = str(r.v)
    if (!list.includes(v)) list.push(v)
    m.set(key, list)
  }
  return m
}

// ───────────────────────────── 시편 다시 묶기 (AI 개발 플랜 T4) ─────────────────────────────

/** 시편 다시 묶기 계획에 쓰는 파일 이름들 */
export interface FileIdentity {
  id: number
  planId: PlanId
  specimenId: SpecimenId
  /** 그 시편 행의 ID 출처 */
  specimenSource: SpecimenIdSource
  storedFileName: string
  sourceFileName: string
  deviceFileName: string | null
}

export function listFileIdentities(db: Db): FileIdentity[] {
  return db
    .all(
      `SELECT f.id, f.plan_id, f.specimen_id, s.source AS specimen_source, f.stored_file_name, f.source_file_name, f.device_file_name
       FROM files f JOIN specimens s ON s.id = f.specimen_id ORDER BY f.id`
    )
    .map((r) => ({
      id: num(r.id),
      planId: str(r.plan_id),
      specimenId: str(r.specimen_id),
      specimenSource: str(r.specimen_source) as SpecimenIdSource,
      storedFileName: str(r.stored_file_name),
      sourceFileName: str(r.source_file_name),
      deviceFileName: strOrNull(r.device_file_name)
    }))
}

export interface SpecimenMove {
  fileId: number
  /** 지금 시편 (다른 곳에서 바뀌었으면 CONFLICT) */
  fromSpecimenId: SpecimenId
  toSpecimenId: SpecimenId
  /** 새 시편 행을 만들 때의 출처 */
  toSource: SpecimenIdSource
}

export interface SpecimenMoveResult {
  moved: number
  createdSpecimens: SpecimenId[]
  removedSpecimens: SpecimenId[]
}

/**
 * 파일의 시편만 바꾼다 (한 트랜잭션). 저장된 사본은 옮기지 않는다 — 저장 경로(stored_rel_path)는 파일마다 따로 있어
 * 시편 폴더 이름이 옛 ID 로 남아도 읽기에 문제가 없다(폴더는 가져올 때만 시편 ID 로 정한다).
 * removeIfEmpty 에 준 시편은 파일이 하나도 남지 않으면 행을 지운다(호출 쪽이 라벨·분할이 걸리지 않은 것만 준다).
 */
export function moveFilesToSpecimen(
  db: Db,
  moves: readonly SpecimenMove[],
  removeIfEmpty: readonly SpecimenId[],
  now: string
): SpecimenMoveResult {
  return db.transaction(() => {
    const created: SpecimenId[] = []
    const touched = new Set<SpecimenId>()
    let moved = 0
    for (const m of moves) {
      const to = validateSpecimenId(m.toSpecimenId)
      if (!SOURCES.includes(m.toSource)) throw new AppError('INVALID_ARGUMENT', '시편 ID 출처 값이 올바르지 않습니다.')
      let target = getSpecimenRow(db, to)
      if (!target) {
        db.run(
          `INSERT INTO specimens(id, display_name, source, note, created_at, updated_at)
           VALUES ($id, $id, $source, '', $now, $now)`,
          { id: to, source: m.toSource, now }
        )
        target = getSpecimenRow(db, to)!
        created.push(target.id)
      }
      const r = db.run('UPDATE files SET specimen_id = $to WHERE id = $id AND specimen_id = $from COLLATE NOCASE', {
        to: target.id,
        id: m.fileId,
        from: m.fromSpecimenId.normalize('NFC').trim()
      })
      if (r.changes !== 1) throw new AppError('CONFLICT', `파일 #${m.fileId} 의 시편이 그사이 바뀌었습니다. 미리보기를 다시 여세요.`)
      touched.add(target.id)
      moved++
    }
    const removed: SpecimenId[] = []
    for (const id of new Set(removeIfEmpty.map((x) => x.normalize('NFC').trim()))) {
      const left = db.get('SELECT count(*) AS n FROM files WHERE specimen_id = $id COLLATE NOCASE', { id })
      if (num(left?.n) > 0) continue
      const row = getSpecimenRow(db, id)
      if (!row) continue
      db.run('DELETE FROM specimens WHERE id = $id', { id: row.id })
      removed.push(row.id)
    }
    for (const id of touched) db.run('UPDATE specimens SET updated_at = $now WHERE id = $id', { id, now })
    return { moved, createdSpecimens: created, removedSpecimens: removed }
  })
}
