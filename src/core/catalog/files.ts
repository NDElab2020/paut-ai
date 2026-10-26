import type { FileAnnotationPatch, FileListPage, FileQuery, FileSort } from '@shared/api'
import { AppError } from '@shared/errors'
import type { AcquisitionSummary, FileId, FileMeta, FileRecord, NdeFileMeta } from '@shared/types'
import type { Db, Params, Row } from './db'
import { getSpecimenRow } from './specimens'
import {
  cleanRound,
  cleanSha256,
  cleanTags,
  cleanText,
  likePattern,
  nfc,
  num,
  numOrNull,
  optionalText,
  parseJson,
  requireText,
  str,
  strOrNull
} from './values'

/** 새 파일 레코드 (id 는 DB 가 배정) */
export type NewFileRecord = Omit<FileRecord, 'id'>

export const DEFAULT_FILE_LIMIT = 200
export const MAX_FILE_LIMIT = 1000

const EMPTY_ACQ: AcquisitionSummary = { groups: [], encoder: null, scanPattern: null }

function toFile(r: Row): FileRecord {
  const meta = parseJson<FileMeta>(r.meta_json, {} as FileMeta)
  return {
    id: num(r.id),
    planId: str(r.plan_id),
    specimenId: str(r.specimen_id),
    storedRelPath: str(r.stored_rel_path),
    storedFileName: str(r.stored_file_name),
    meta: { ...meta, sha256: str(r.sha256), sizeBytes: num(r.size_bytes) },
    stateTag: strOrNull(r.state_tag),
    tags: parseJson<string[]>(r.tags_json, []),
    round: numOrNull(r.round),
    memo: str(r.memo),
    acquisition: parseJson<AcquisitionSummary>(r.acquisition_json, EMPTY_ACQ),
    importBatchId: str(r.import_batch_id),
    importedAt: str(r.imported_at)
  }
}

export function getFile(db: Db, id: FileId): FileRecord | null {
  const r = db.get('SELECT * FROM files WHERE id = $id', { id })
  return r ? toFile(r) : null
}

export function findFileBySha256(db: Db, sha256: string): FileRecord | null {
  const r = db.get('SELECT * FROM files WHERE sha256 = $sha', { sha: sha256.toLowerCase() })
  return r ? toFile(r) : null
}

function cleanRelPath(v: unknown): string {
  const p = requireText(v, '저장 경로', 1000)
  const segs = p.split('/')
  if (p.includes('\\') || p.startsWith('/') || segs.some((s) => s === '' || s === '.' || s === '..')) {
    throw new AppError('INVALID_ARGUMENT', `저장 경로가 올바르지 않습니다: ${p}`)
  }
  return p
}

export function insertFile(db: Db, input: NewFileRecord, setupJson?: string): FileRecord {
  const sha = cleanSha256(input.meta?.sha256)
  const relPath = cleanRelPath(input.storedRelPath)
  const meta = input.meta
  if (!Number.isSafeInteger(meta.sizeBytes) || meta.sizeBytes < 0) throw new AppError('INVALID_ARGUMENT', '파일 크기 값이 올바르지 않습니다.')
  if (typeof meta.sourcePath !== 'string' || typeof meta.sourceFileName !== 'string') {
    throw new AppError('INVALID_ARGUMENT', '원본 경로 값이 올바르지 않습니다.')
  }
  return db.transaction(() => {
    const dup = findFileBySha256(db, sha)
    if (dup) throw new AppError('CONFLICT', `같은 내용(SHA-256)의 파일이 이미 있습니다: ${dup.storedRelPath}`)
    const specimen = getSpecimenRow(db, input.specimenId)
    if (!specimen) throw new AppError('NOT_FOUND', `시편 ${input.specimenId} 이(가) 카탈로그에 없습니다.`)
    if (!db.get('SELECT 1 AS x FROM plans WHERE id = $id', { id: input.planId })) {
      throw new AppError('NOT_FOUND', `스캔플랜 ${input.planId} 이(가) 카탈로그에 없습니다.`)
    }
    const params: Params = {
      sha,
      size: meta.sizeBytes,
      plan: input.planId,
      specimen: specimen.id,
      rel: relPath,
      stored: nfc(input.storedFileName),
      srcPath: meta.sourcePath,
      srcName: nfc(meta.sourceFileName),
      device: typeof meta.deviceFileName === 'string' ? nfc(meta.deviceFileName) : null,
      ver: meta.ndeVersion?.raw ?? '',
      platform: meta.device?.platform ?? null,
      model: meta.device?.model ?? null,
      serial: meta.device?.serialNumber ?? null,
      created: meta.createdAt ?? null,
      modified: meta.modifiedAt ?? null,
      meta: JSON.stringify({ ...meta, sha256: sha }),
      acq: JSON.stringify(input.acquisition ?? EMPTY_ACQ),
      tag: optionalText(input.stateTag, '상태 태그'),
      round: cleanRound(input.round),
      memo: cleanText(input.memo ?? '', '메모'),
      tags: JSON.stringify(cleanTags(input.tags ?? [])),
      batch: requireText(input.importBatchId, '가져오기 배치 ID'),
      at: requireText(input.importedAt, '가져온 시각')
    }
    const { lastInsertRowid } = db.run(
      `INSERT INTO files(sha256, size_bytes, plan_id, specimen_id, stored_rel_path, stored_file_name, source_path,
         source_file_name, device_file_name, nde_version, platform, model, serial, created_at_file, modified_at_file,
         meta_json, acquisition_json, state_tag, round, memo, tags_json, import_batch_id, imported_at)
       VALUES ($sha, $size, $plan, $specimen, $rel, $stored, $srcPath, $srcName, $device, $ver, $platform, $model,
         $serial, $created, $modified, $meta, $acq, $tag, $round, $memo, $tags, $batch, $at)`,
      params
    )
    if (setupJson !== undefined) {
      db.run('INSERT INTO file_setups(file_id, setup_json) VALUES ($id, $json)', { id: lastInsertRowid, json: setupJson })
    }
    return getFile(db, lastInsertRowid)!
  })
}

export function getFileSetupJson(db: Db, id: FileId): string | null {
  return strOrNull(db.get('SELECT setup_json FROM file_setups WHERE file_id = $id', { id })?.setup_json)
}

/** 읽기 규칙 갱신용. 파일의 식별자·경로·시편·메모·라벨 연결을 유지하고 읽은 정보만 바꾼다. */
export function refreshOpdFileSetup(db: Db, id: FileId, meta: NdeFileMeta, acquisition: AcquisitionSummary, setupJson: string): void {
  const current = getFile(db, id)
  if (!current) throw new AppError('NOT_FOUND', `파일 #${id} 을(를) 찾을 수 없습니다.`)
  if (current.meta.ndeVersion.family !== 'opd' || meta.ndeVersion.family !== 'opd') {
    throw new AppError('INVALID_ARGUMENT', 'OPD 읽기 정보 갱신은 OPD 파일에만 적용합니다.')
  }
  db.run('UPDATE files SET meta_json = $meta, acquisition_json = $acq WHERE id = $id', {
    id,
    meta: JSON.stringify({ ...current.meta, ...meta }),
    acq: JSON.stringify(acquisition)
  })
  db.run('INSERT INTO file_setups(file_id, setup_json) VALUES ($id, $json) ON CONFLICT(file_id) DO UPDATE SET setup_json = excluded.setup_json', { id, json: setupJson })
}

export function updateFile(db: Db, id: FileId, patch: FileAnnotationPatch): FileRecord {
  const current = getFile(db, id)
  if (!current) throw new AppError('NOT_FOUND', `파일 #${id} 을(를) 찾을 수 없습니다.`)
  const next = {
    tag: patch.stateTag === undefined ? current.stateTag : optionalText(patch.stateTag, '상태 태그'),
    round: patch.round === undefined ? current.round : cleanRound(patch.round),
    memo: patch.memo === undefined ? current.memo : cleanText(patch.memo, '메모'),
    tags: JSON.stringify(patch.tags === undefined ? current.tags : cleanTags(patch.tags))
  }
  db.run('UPDATE files SET state_tag = $tag, round = $round, memo = $memo, tags_json = $tags WHERE id = $id', { id, ...next })
  return getFile(db, id)!
}

const SORTS: Record<FileSort, string> = {
  'importedAt-desc': 'f.imported_at DESC, f.id DESC',
  'importedAt-asc': 'f.imported_at ASC, f.id ASC',
  'fileName-asc': 'f.stored_file_name COLLATE NOCASE ASC, f.id ASC',
  'createdAt-desc': 'f.created_at_file IS NULL, f.created_at_file DESC, f.id DESC'
}

const SEARCH_COLUMNS = [
  'f.source_file_name',
  'f.stored_file_name',
  'f.device_file_name',
  'f.specimen_id',
  's.display_name',
  'f.state_tag',
  'f.memo',
  'f.tags_json',
  'f.plan_id',
  'p.name'
]

/** 검색어는 공백으로 나눈 낱말이 모두(AND) 어느 열엔가(OR) 부분일치해야 한다 */
export function listFiles(db: Db, query: FileQuery = {}): FileListPage {
  const where: string[] = []
  const params: Params = {}
  if (query.planId !== undefined) {
    where.push('f.plan_id = $plan')
    params.plan = query.planId
  }
  if (query.specimenId !== undefined) {
    where.push('f.specimen_id = $specimen COLLATE NOCASE')
    params.specimen = nfc(query.specimenId).trim()
  }
  if (query.stateTag !== undefined) {
    where.push('f.state_tag = $stateTag')
    params.stateTag = nfc(query.stateTag).trim()
  }
  const terms = nfc(query.text ?? '')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 10)
  terms.forEach((t, i) => {
    where.push(`(${SEARCH_COLUMNS.map((c) => `${c} LIKE $t${i} ESCAPE '\\'`).join(' OR ')})`)
    params[`t${i}`] = likePattern(t)
  })
  const offset = Math.max(0, Math.trunc(query.offset ?? 0))
  const limit = Math.min(MAX_FILE_LIMIT, Math.max(1, Math.trunc(query.limit ?? DEFAULT_FILE_LIMIT)))
  const from = `FROM files f JOIN plans p ON p.id = f.plan_id JOIN specimens s ON s.id = f.specimen_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
  const total = num(db.get(`SELECT count(*) AS n ${from}`, params)?.n)
  const order = SORTS[query.sort ?? 'importedAt-desc'] ?? SORTS['importedAt-desc']
  const rows = db.all(`SELECT f.* ${from} ORDER BY ${order} LIMIT $limit OFFSET $offset`, { ...params, limit, offset })
  return { items: rows.map(toFile), total, offset, limit }
}
