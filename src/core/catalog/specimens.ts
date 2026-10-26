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
