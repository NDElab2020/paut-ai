/**
 * 스키마 마이그레이션. 새 관리 기능이 테이블·열을 더할 때는 MIGRATIONS 끝에 { version: n+1, ... } 를 추가한다.
 * 이미 배포된 마이그레이션은 절대 고치지 않는다. 각 단계는 트랜잭션 하나로 적용된다.
 */
import { AppError } from '@shared/errors'
import type { Db } from './db'

export interface Migration {
  version: number
  description: string
  up: (db: Db) => void
}

const V1 = `
CREATE TABLE id_counters (
  name TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL
) STRICT;
INSERT INTO id_counters(name, last_value) VALUES ('plan', 0);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL UNIQUE,
  spec_version INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE specimens (
  id TEXT PRIMARY KEY COLLATE NOCASE,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('device-filename', 'filename', 'manual')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT CHECK (status IS NULL OR status IN ('completed', 'partial', 'failed', 'cancelled')),
  input_paths_json TEXT NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  copied_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_plan_ids_json TEXT NOT NULL DEFAULT '[]',
  total_bytes INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  specimen_id TEXT NOT NULL REFERENCES specimens(id),
  stored_rel_path TEXT NOT NULL UNIQUE COLLATE NOCASE,
  stored_file_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_file_name TEXT NOT NULL,
  device_file_name TEXT,
  nde_version TEXT NOT NULL,
  platform TEXT,
  model TEXT,
  serial TEXT,
  created_at_file TEXT,
  modified_at_file TEXT,
  meta_json TEXT NOT NULL,
  acquisition_json TEXT NOT NULL,
  state_tag TEXT,
  round INTEGER,
  memo TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  import_batch_id TEXT NOT NULL,
  imported_at TEXT NOT NULL
) STRICT;
CREATE INDEX files_plan ON files(plan_id);
CREATE INDEX files_specimen ON files(specimen_id);
CREATE INDEX files_batch ON files(import_batch_id);
CREATE INDEX files_imported ON files(imported_at);

CREATE TABLE file_setups (
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  setup_json TEXT NOT NULL
) STRICT;

CREATE TABLE import_items (
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  message TEXT,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  plan_id TEXT,
  specimen_id TEXT,
  stored_rel_path TEXT,
  PRIMARY KEY (batch_id, item_id)
) STRICT;
`

/**
 * v2 결함 라벨 저장소 (계획_라벨링/규격_초안.md 2절, shared/labels/types.ts).
 * - 각 행은 검사(validate.ts)를 통과한 전체 객체 JSON(json, 모르는 칸 포함)을 그대로 둔다. 다른 열은 찾기용 사본이다.
 * - files 와 FK·CASCADE 없음. 파일과는 sha256 문자열로만 잇는다(로컬에 없는 파일의 기록도 보관).
 * - versions_json = 버전 벡터(병합 순서 판단), stored_at = 이 PC 에 쓴 시각(기록용).
 * - 작업 이벤트는 추가 전용(고치기·지우기를 트리거로 막음). 충돌은 label_conflicts 에 둘 다 보관한다.
 * - 시편 ID 는 catalog 시편처럼 대소문자를 가리지 않는다(label_physical_defects.specimen_id COLLATE NOCASE).
 * - label_meta: 이 카탈로그의 버전 칸(복제본 ID, labels.ts replicaSlot)과 쓰기 횟수. 다른 PC 로 건너가지 않는다.
 * - label_import_marks: 엑셀에서 마지막으로 가져온 줄의 내용 지문과 그때의 versions (엑셀 재가져오기의 비교 기준).
 *   이 PC 에만 있는 기록용 표다(내보내지 않음). 엑셀이 지운 줄(deleted_by_import)은 엑셀에 다시 나타나면 되살린다.
 */
const V2 = `
CREATE TABLE label_labelers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  qualification TEXT,
  organization TEXT,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE label_records (
  uuid TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  labeler_id TEXT NOT NULL,
  guideline_version TEXT NOT NULL,
  reading_stage TEXT NOT NULL,
  kind TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  scan_start_mm REAL NOT NULL,
  scan_end_mm REAL NOT NULL,
  grouping_id TEXT,
  physical_defect_id TEXT,
  revision INTEGER NOT NULL,
  versions_json TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  stored_at TEXT NOT NULL
) STRICT;
CREATE INDEX label_records_set ON label_records(sha256, labeler_id, guideline_version, reading_stage);
CREATE INDEX label_records_labeler ON label_records(labeler_id);

CREATE TABLE label_observations (
  record_uuid TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  leg INTEGER NOT NULL,
  status TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  revision INTEGER NOT NULL,
  versions_json TEXT NOT NULL,
  json TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  PRIMARY KEY (record_uuid, group_id, leg)
) STRICT;

CREATE TABLE label_review_intervals (
  uuid TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  labeler_id TEXT NOT NULL,
  guideline_version TEXT NOT NULL,
  reading_stage TEXT NOT NULL,
  kind TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  released INTEGER NOT NULL CHECK (released IN (0, 1)),
  group_id INTEGER,
  scan_start_mm REAL NOT NULL,
  scan_end_mm REAL NOT NULL,
  revision INTEGER NOT NULL,
  versions_json TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  stored_at TEXT NOT NULL
) STRICT;
CREATE INDEX label_reviews_set ON label_review_intervals(sha256, labeler_id, guideline_version, reading_stage);
CREATE INDEX label_reviews_labeler ON label_review_intervals(labeler_id);

CREATE TABLE label_file_alignments (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  specimen_id TEXT,
  weld_id TEXT,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  revision INTEGER NOT NULL,
  versions_json TEXT NOT NULL,
  json TEXT NOT NULL,
  stored_at TEXT NOT NULL
) STRICT;
CREATE INDEX label_alignments_specimen ON label_file_alignments(specimen_id);

CREATE TABLE label_physical_defects (
  specimen_id TEXT NOT NULL COLLATE NOCASE,
  defect_id TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  revision INTEGER NOT NULL,
  versions_json TEXT NOT NULL,
  json TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  PRIMARY KEY (specimen_id, defect_id)
) STRICT;

CREATE TABLE label_work_events (
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  labeler_id TEXT NOT NULL,
  reading_stage TEXT,
  sha256 TEXT,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  json TEXT NOT NULL,
  stored_at TEXT NOT NULL
) STRICT;
CREATE INDEX label_events_file ON label_work_events(sha256, labeler_id);
CREATE INDEX label_events_session ON label_work_events(labeler_id, session_id);
CREATE TRIGGER label_work_events_no_update BEFORE UPDATE ON label_work_events
BEGIN SELECT RAISE(ABORT, 'label_work_events is append-only'); END;
CREATE TRIGGER label_work_events_no_delete BEFORE DELETE ON label_work_events
BEGIN SELECT RAISE(ABORT, 'label_work_events is append-only'); END;

CREATE TABLE label_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('physical-defect', 'file-alignment', 'record', 'observation', 'review-interval', 'work-event')),
  entity_key TEXT NOT NULL,
  sha256 TEXT,
  labeler_id TEXT,
  mine_json TEXT NOT NULL,
  theirs_json TEXT NOT NULL,
  theirs_hash TEXT NOT NULL,
  source_pc_id TEXT,
  source_name TEXT,
  source_exported_at TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('mine', 'theirs', 'both', 'superseded')),
  resolved_new_key TEXT
) STRICT;
CREATE INDEX label_conflicts_key ON label_conflicts(entity, entity_key);
CREATE INDEX label_conflicts_file ON label_conflicts(sha256);
CREATE UNIQUE INDEX label_conflicts_pending ON label_conflicts(entity, entity_key, theirs_hash) WHERE resolved_at IS NULL;
CREATE INDEX label_conflicts_theirs ON label_conflicts(entity, entity_key, theirs_hash);

CREATE TABLE label_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE label_import_marks (
  entity TEXT NOT NULL CHECK (entity IN ('record', 'review-interval')),
  entity_key TEXT NOT NULL,
  source TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  versions_json TEXT NOT NULL,
  deleted_by_import INTEGER NOT NULL CHECK (deleted_by_import IN (0, 1)),
  marked_at TEXT NOT NULL,
  PRIMARY KEY (entity, entity_key)
) STRICT;
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, description: '초기 스키마', up: (db) => db.exec(V1) },
  { version: 2, description: '결함 라벨 저장소', up: (db) => db.exec(V2) }
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version

export function currentSchemaVersion(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`)
  const row = db.get('SELECT max(version) AS v FROM schema_version')
  return Number(row?.v ?? 0)
}

/** 빠진 마이그레이션을 순서대로 적용. 앱보다 새 DB 면 열지 않는다(오래된 앱이 새 스키마를 망가뜨리지 않게) */
/** 마이그레이션 목록이 1 부터 1 씩 늘어나는지 (같은 번호를 두 번 붙이면 v2 DB 에서 조용히 건너뛰어 테이블이 생기지 않는다) */
export function assertMigrationOrder(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new AppError('DB_ERROR', '카탈로그 스키마 정의가 올바르지 않습니다(프로그램 오류).', `migration[${i}].version = ${m.version}, expected ${i + 1}`)
    }
  })
}

/** 아직 적용하지 않은 마이그레이션이 있는지 (열기 전에 백업할지 정할 때) */
export function pendingMigrations(db: Db, migrations: readonly Migration[] = MIGRATIONS): Migration[] {
  const current = currentSchemaVersion(db)
  return migrations.filter((m) => m.version > current)
}

export function migrate(db: Db, nowIso: () => string, migrations: readonly Migration[] = MIGRATIONS): number {
  assertMigrationOrder(migrations)
  const latest = migrations[migrations.length - 1]?.version ?? 0
  const current = currentSchemaVersion(db)
  if (current > latest) {
    throw new AppError(
      'DB_ERROR',
      `카탈로그가 더 새 버전의 프로그램으로 만들어졌습니다(스키마 ${current}). 프로그램을 업데이트하세요.`,
      `schema ${current} > supported ${latest}`
    )
  }
  for (const m of migrations) {
    if (m.version <= current) continue
    db.transaction(() => {
      m.up(db)
      db.run('INSERT INTO schema_version(version, description, applied_at) VALUES ($v, $d, $t)', {
        v: m.version,
        d: m.description,
        t: nowIso()
      })
    })
  }
  return latest
}
