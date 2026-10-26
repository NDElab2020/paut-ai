import { AppError } from '@shared/errors'
import { formatPlanId } from '@shared/ids'
import type { Fingerprint, PlanId, ScanPlan, ScanPlanSpec } from '@shared/types'
import type { Db, Row } from './db'
import { canonicalJson, cleanText, num, parseJson, requireText, str, strOrNull } from './values'

export interface NewPlanInput {
  fingerprint: Fingerprint
  spec: ScanPlanSpec
  summary: string
  name: string
  note?: string
}

const PLAN_SELECT = `
SELECT p.id, p.name, p.note, p.fingerprint, p.spec_json, p.summary, p.created_at, p.updated_at,
       coalesce(a.file_count, 0) AS file_count,
       coalesce(a.specimen_count, 0) AS specimen_count,
       coalesce(a.total_bytes, 0) AS total_bytes,
       a.last_imported_at
FROM plans p
LEFT JOIN (
  SELECT plan_id, count(*) AS file_count, count(DISTINCT specimen_id) AS specimen_count,
         sum(size_bytes) AS total_bytes, max(imported_at) AS last_imported_at
  FROM files GROUP BY plan_id
) a ON a.plan_id = p.id`

function toPlan(r: Row): ScanPlan {
  return {
    id: str(r.id),
    name: str(r.name),
    note: str(r.note),
    fingerprint: str(r.fingerprint),
    spec: parseJson<ScanPlanSpec>(r.spec_json, { specVersion: 1, specimen: emptySpecimen(), groups: [] }),
    summary: str(r.summary),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    fileCount: num(r.file_count),
    specimenCount: num(r.specimen_count),
    totalBytes: num(r.total_bytes),
    lastImportedAt: strOrNull(r.last_imported_at)
  }
}

function emptySpecimen(): ScanPlanSpec['specimen'] {
  return { shape: 'unknown', thicknessMm: null, outerRadiusMm: null, angularOpeningDeg: null, materialName: null, weld: null }
}

export function listPlans(db: Db): ScanPlan[] {
  return db.all(`${PLAN_SELECT} ORDER BY p.seq`).map(toPlan)
}

export function getPlan(db: Db, id: PlanId): ScanPlan | null {
  const r = db.get(`${PLAN_SELECT} WHERE p.id = $id`, { id })
  return r ? toPlan(r) : null
}

export function requirePlan(db: Db, id: PlanId): ScanPlan {
  const p = getPlan(db, id)
  if (!p) throw new AppError('NOT_FOUND', `스캔플랜 ${id} 을(를) 찾을 수 없습니다.`)
  return p
}

export function findPlanByFingerprint(db: Db, fingerprint: Fingerprint): ScanPlan | null {
  const r = db.get(`${PLAN_SELECT} WHERE p.fingerprint = $fp`, { fp: fingerprint })
  return r ? toPlan(r) : null
}

function lastPlanSeq(db: Db): number {
  return num(db.get(`SELECT last_value FROM id_counters WHERE name = 'plan'`)?.last_value)
}

export function peekNextPlanIds(db: Db, count: number): PlanId[] {
  const n = Math.max(0, Math.trunc(count))
  const last = lastPlanSeq(db)
  return Array.from({ length: n }, (_, i) => formatPlanId(last + i + 1))
}

export function createPlan(db: Db, input: NewPlanInput, now: string): ScanPlan {
  const fingerprint = requireText(input.fingerprint, '지문', 200)
  if (!input.spec || typeof input.spec !== 'object') throw new AppError('INVALID_ARGUMENT', '스캔플랜 스펙이 없습니다.')
  const summary = cleanText(input.summary ?? '', '요약')
  const note = cleanText(input.note ?? '', '메모')
  return db.transaction(() => {
    const existing = findPlanByFingerprint(db, fingerprint)
    if (existing) throw new AppError('CONFLICT', `같은 셋업의 스캔플랜이 이미 있습니다(${existing.id}).`)
    const seq = lastPlanSeq(db) + 1
    const id = formatPlanId(seq)
    const name = cleanText(input.name ?? '', '플랜 이름') || summary || id
    db.run(`UPDATE id_counters SET last_value = $seq WHERE name = 'plan'`, { seq })
    db.run(
      `INSERT INTO plans(id, seq, name, note, fingerprint, spec_version, spec_json, summary, created_at, updated_at)
       VALUES ($id, $seq, $name, $note, $fp, $sv, $spec, $summary, $now, $now)`,
      { id, seq, name, note, fp: fingerprint, sv: input.spec.specVersion ?? 0, spec: canonicalJson(input.spec), summary, now }
    )
    return requirePlan(db, id)
  })
}

export function renamePlan(db: Db, id: PlanId, name: string, now: string): ScanPlan {
  const clean = requireText(name, '플랜 이름')
  const r = db.run('UPDATE plans SET name = $name, updated_at = $now WHERE id = $id', { id, name: clean, now })
  if (r.changes === 0) throw new AppError('NOT_FOUND', `스캔플랜 ${id} 을(를) 찾을 수 없습니다.`)
  return requirePlan(db, id)
}

export function setPlanNote(db: Db, id: PlanId, note: string, now: string): ScanPlan {
  const clean = cleanText(note, '메모')
  const r = db.run('UPDATE plans SET note = $note, updated_at = $now WHERE id = $id', { id, note: clean, now })
  if (r.changes === 0) throw new AppError('NOT_FOUND', `스캔플랜 ${id} 을(를) 찾을 수 없습니다.`)
  return requirePlan(db, id)
}
