import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, openCatalog } from '@core/catalog'
import { Db } from '@core/catalog/db'
import * as files from '@core/catalog/files'
import * as plans from '@core/catalog/plans'
import { migrate } from '@core/catalog/schema'
import * as specimens from '@core/catalog/specimens'
import { makeFile, makePlan } from '../catalog/fixtures'
import { rec } from './labelFixtures'

const dir = mkdtempSync(join(tmpdir(), 'paut-labels-mig-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const now = () => '2026-10-06T12:00:00+09:00'

const LABEL_TABLES = [
  'label_labelers',
  'label_records',
  'label_observations',
  'label_review_intervals',
  'label_file_alignments',
  'label_physical_defects',
  'label_work_events',
  'label_conflicts',
  'label_meta',
  'label_import_marks'
]

/** v1 까지만 적용한 DB 에 플랜·시편·파일 1개 */
function makeV1(path: string): { sha256: string } {
  const db = Db.open(path)
  expect(migrate(db, now, MIGRATIONS.filter((m) => m.version === 1))).toBe(1)
  const plan = plans.createPlan(db, makePlan(12, '12T V'), now())
  specimens.ensureSpecimen(db, { id: 'TP01', displayName: 'TP01', source: 'manual' }, now())
  const f = files.insertFile(db, makeFile('x3-01', plan.id, 'TP01', { memo: '메모 그대로' }), '{"setup":1}')
  db.close()
  return { sha256: f.meta.sha256 }
}

describe('스키마 v2 (라벨 저장소)', () => {
  it('마이그레이션 번호는 1, 2 순서이고 v2 는 라벨 저장소다', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2])
    expect(MIGRATIONS[1]!.description).toBe('결함 라벨 저장소')
  })

  it('v1 DB 를 열면 v2 가 적용되고 기존 데이터는 그대로다', () => {
    const p = join(dir, 'v1.db')
    const { sha256 } = makeV1(p)
    const c = openCatalog(p, { now })
    expect(c.schemaVersion).toBe(2)
    expect(c.listPlans().map((x) => [x.id, x.name, x.fileCount])).toEqual([['SP001', '12T V', 1]])
    const f = c.findFileBySha256(sha256)
    expect(f?.memo).toBe('메모 그대로')
    expect(c.getFileSetupJson(f!.id)).toBe('{"setup":1}')
    expect(c.getSpecimen('TP01')?.fileCount).toBe(1)
    // 새 테이블에 쓰고 읽기
    c.labels.saveRecord(rec(1, { sha256 }), { pcId: 'pc-a' })
    expect(c.labels.listRecords({ sha256 }).length).toBe(1)
    c.close()

    const db = Db.open(p)
    expect(db.all('SELECT version FROM schema_version ORDER BY version').map((r) => r.version)).toEqual([1, 2])
    const names = db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'label_%'`).map((r) => r.name)
    expect([...names].sort()).toEqual([...LABEL_TABLES].sort())
    db.close()
  })

  it('라벨 테이블은 STRICT 이고 files 로 가는 FK 가 없다', () => {
    const c = openCatalog(join(dir, 'fresh.db'), { now })
    c.close()
    const db = Db.open(join(dir, 'fresh.db'))
    for (const t of LABEL_TABLES) {
      const info = db.get(`SELECT strict FROM pragma_table_list WHERE name = $t`, { t })
      expect(info?.strict, t).toBe(1)
      expect(db.all(`SELECT * FROM pragma_foreign_key_list($t)`, { t }), t).toEqual([])
    }
    const idx = db.all(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'label_records'`).map((r) => String(r.name))
    expect(idx).toContain('label_records_set')
    db.close()
  })

  it('작업 이벤트는 추가 전용이다 (고치기·지우기를 DB 가 막음)', () => {
    const p = join(dir, 'events.db')
    const c = openCatalog(p, { now })
    c.labels.appendWorkEvent({
      uuid: '00000000-0000-4000-8000-000000000001',
      sessionId: 's',
      labelerId: 'kim',
      readingStage: null,
      pcId: null,
      sha256: null,
      kind: 'session-start',
      tool: 'app',
      at: '2026-10-06T09:00:00+09:00',
      detail: null
    })
    c.close()
    const db = Db.open(p)
    expect(() => db.run(`UPDATE label_work_events SET kind = 'idle'`)).toThrow()
    expect(() => db.run(`DELETE FROM label_work_events`)).toThrow()
    expect(db.get('SELECT count(*) AS n FROM label_work_events')?.n).toBe(1)
    db.close()
  })

  it('파일을 지워도 라벨 기록은 남는다 (sha256 문자열로만 이음)', () => {
    const p = join(dir, 'orphan.db')
    const { sha256 } = makeV1(p)
    const c = openCatalog(p, { now })
    c.labels.saveRecord(rec(2, { sha256 }), { pcId: 'pc-a' })
    c.close()
    const db = Db.open(p)
    db.exec('DELETE FROM file_setups; DELETE FROM files;')
    db.close()
    const c2 = openCatalog(p, { now })
    expect(c2.labels.listRecords({ sha256 }).length).toBe(1)
    const set = c2.labels.listLabelSets()[0]!
    expect(set).toMatchObject({ sha256, fileId: null, fileName: null, recordCount: 1 })
    c2.close()
  })
})
