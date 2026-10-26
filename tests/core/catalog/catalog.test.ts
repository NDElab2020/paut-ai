import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, MIGRATIONS, openCatalog, type Catalog } from '@core/catalog'
import { Db } from '@core/catalog/db'
import { migrate } from '@core/catalog/schema'
import { AppError } from '@shared/errors'
import { makeFile, makePlan, sha } from './fixtures'

const dir = mkdtempSync(join(tmpdir(), 'paut-catalog-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let seq = 0
function freshPath(): string {
  return join(dir, `catalog-${++seq}.db`)
}

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof AppError ? err.code : `not AppError: ${String(err)}`
  }
  return undefined
}

const fixedNow = () => '2026-10-02T12:00:00+09:00'

describe('스키마 · 마이그레이션', () => {
  it('새 DB 를 만들고 스키마 버전을 기록한다. 다시 열어도 다시 적용하지 않는다', () => {
    const p = freshPath()
    const c = openCatalog(p, { now: fixedNow })
    expect(c.schemaVersion).toBe(MIGRATIONS.at(-1)!.version)
    c.close()
    const c2 = openCatalog(p)
    expect(c2.listPlans()).toEqual([])
    c2.close()
    const raw = new DatabaseSync(p)
    const rows = raw.prepare('SELECT version, applied_at FROM schema_version').all()
    raw.close()
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version, applied_at: '2026-10-02T12:00:00+09:00' })))
  })

  it('다음 버전 마이그레이션을 끝에 붙이면 기존 데이터를 유지한 채 적용된다', () => {
    const p = freshPath()
    const c = openCatalog(p)
    c.createPlan(makePlan(12))
    c.close()
    const db = Db.open(p)
    const next = LATEST_SCHEMA_VERSION + 1
    const vn = { version: next, description: '다음 테이블', up: (d: Db) => d.exec('CREATE TABLE next_table (id INTEGER PRIMARY KEY, file_id INTEGER) STRICT') }
    expect(migrate(db, fixedNow, [...MIGRATIONS, vn])).toBe(next)
    expect(db.get('SELECT count(*) AS n FROM plans')?.n).toBe(1)
    expect(db.get(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'next_table'`)?.n).toBe(1)
    expect(db.all('SELECT version FROM schema_version ORDER BY version').map((r) => r.version)).toEqual([...MIGRATIONS.map((m) => m.version), next])
    db.close()
  })

  it('마이그레이션 번호는 1 부터 1 씩 늘어야 한다 (같은 번호를 두 번 붙이면 조용히 건너뛰지 않고 거부)', () => {
    const db = Db.open(freshPath())
    const dup = { version: LATEST_SCHEMA_VERSION, description: '같은 번호', up: (d: Db) => d.exec('CREATE TABLE never (a TEXT)') }
    expect(code(() => migrate(db, fixedNow, [...MIGRATIONS, dup]))).toBe('DB_ERROR')
    const gap = { version: LATEST_SCHEMA_VERSION + 2, description: '건너뜀', up: (d: Db) => d.exec('CREATE TABLE never (a TEXT)') }
    expect(code(() => migrate(db, fixedNow, [...MIGRATIONS, gap]))).toBe('DB_ERROR')
    db.close()
  })

  it('있던 DB 를 새 스키마로 올리기 전에 백업을 남긴다', () => {
    const p = freshPath()
    const db = Db.open(p)
    migrate(db, fixedNow, MIGRATIONS.slice(0, 1))
    db.run(`INSERT INTO specimens(id, display_name, source, created_at, updated_at) VALUES ('PL1', 'PL1', 'manual', 't', 't')`)
    db.close()
    const c = openCatalog(p, { now: fixedNow })
    expect(c.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    c.close()
    const base = p.split('/').pop()!.replace(/\.db$/, '')
    const baks = readdirSync(dir).filter((f) => f.startsWith(`${base}.v1-`) && f.endsWith('.bak'))
    expect(baks).toEqual([`${base}.v1-20261002-120000.bak`])
    const raw = new DatabaseSync(join(dir, baks[0]!))
    expect(raw.prepare('SELECT max(version) AS v FROM schema_version').get()).toEqual({ v: 1 })
    expect(raw.prepare('SELECT id FROM specimens').all()).toEqual([{ id: 'PL1' }])
    raw.close()
    // 이미 최신이면 백업하지 않는다
    openCatalog(p, { now: fixedNow }).close()
    expect(readdirSync(dir).filter((f) => f.startsWith(`${base}.`) && f.endsWith('.bak'))).toHaveLength(1)
  })

  it('실패한 마이그레이션은 롤백되고 버전이 오르지 않는다', () => {
    const p = freshPath()
    openCatalog(p).close()
    const db = Db.open(p)
    const bad = {
      version: LATEST_SCHEMA_VERSION + 1,
      description: '실패',
      up: (d: Db) => {
        d.exec('CREATE TABLE half (a TEXT)')
        d.exec('THIS IS NOT SQL')
      }
    }
    expect(() => migrate(db, fixedNow, [...MIGRATIONS, bad])).toThrow(AppError)
    expect(db.get(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'half'`)?.n).toBe(0)
    expect(db.get('SELECT max(version) AS v FROM schema_version')?.v).toBe(LATEST_SCHEMA_VERSION)
    db.close()
  })

  it('앱보다 새 스키마의 DB 는 열지 않는다 (DB_ERROR)', () => {
    const p = freshPath()
    openCatalog(p).close()
    const raw = new DatabaseSync(p)
    raw.exec(`INSERT INTO schema_version VALUES (99, 'future', 'x')`)
    raw.close()
    expect(code(() => openCatalog(p))).toBe('DB_ERROR')
  })

  it('열 수 없는 경로는 DB_ERROR', () => {
    expect(code(() => openCatalog(join(dir, '없는폴더', 'x', 'catalog.db')))).toBe('DB_ERROR')
  })
})

describe('스캔플랜', () => {
  let c: Catalog
  beforeEach(() => {
    c = openCatalog(':memory:', { now: fixedNow })
  })

  it('ID 를 SP001, SP002 순서로 발급하고 미리보기는 배정하지 않는다', () => {
    expect(c.peekNextPlanIds(2)).toEqual(['SP001', 'SP002'])
    const a = c.createPlan(makePlan(12, '12T V개선'))
    const b = c.createPlan(makePlan(20))
    expect([a.id, b.id]).toEqual(['SP001', 'SP002'])
    expect(a.name).toBe('12T V개선')
    expect(b.name).toBe('판 20 mm')
    expect(c.peekNextPlanIds(1)).toEqual(['SP003'])
    expect(c.peekNextPlanIds(0)).toEqual([])
    expect(c.listPlans().map((p) => p.id)).toEqual(['SP001', 'SP002'])
    expect(a.spec.specimen.thicknessMm).toBe(12)
    expect(a).toMatchObject({ fileCount: 0, specimenCount: 0, totalBytes: 0, lastImportedAt: null, createdAt: fixedNow() })
  })

  it('같은 지문은 CONFLICT, 지문으로 찾기', () => {
    const a = c.createPlan(makePlan(12))
    expect(code(() => c.createPlan(makePlan(12, '다른 이름')))).toBe('CONFLICT')
    expect(c.findPlanByFingerprint(a.fingerprint)?.id).toBe('SP001')
    expect(c.findPlanByFingerprint('fp1:none')).toBeNull()
    expect(c.peekNextPlanIds(1)).toEqual(['SP002'])
  })

  it('삭제된 플랜 ID 는 재사용하지 않는다', () => {
    const p = freshPath()
    const c1 = openCatalog(p)
    c1.createPlan(makePlan(1))
    c1.createPlan(makePlan(2))
    c1.close()
    const raw = new DatabaseSync(p)
    raw.exec(`DELETE FROM plans WHERE id = 'SP002'`)
    raw.close()
    const c2 = openCatalog(p)
    expect(c2.createPlan(makePlan(3)).id).toBe('SP003')
    c2.close()
  })

  it('이름 변경·메모 (폴더와 무관), 없는 플랜은 NOT_FOUND, 빈 이름은 INVALID_ARGUMENT', () => {
    c.createPlan(makePlan(12))
    expect(c.renamePlan('SP001', '  12T 판재 V  ').name).toBe('12T 판재 V')
    expect(c.setPlanNote('SP001', '메모').note).toBe('메모')
    expect(code(() => c.renamePlan('SP009', 'x'))).toBe('NOT_FOUND')
    expect(code(() => c.renamePlan('SP001', '   '))).toBe('INVALID_ARGUMENT')
    expect(c.getPlan('SP009')).toBeNull()
  })

  it('트랜잭션 안에서 예외가 나면 플랜 생성과 ID 발급이 함께 롤백된다', () => {
    expect(() =>
      c.transaction(() => {
        c.createPlan(makePlan(12))
        throw new Error('중단')
      })
    ).toThrow()
    expect(c.listPlans()).toEqual([])
    expect(c.peekNextPlanIds(1)).toEqual(['SP001'])
  })
})

describe('시편 · 파일 · 검색 · 집계', () => {
  let c: Catalog
  beforeEach(() => {
    c = openCatalog(':memory:', { now: fixedNow })
    c.createPlan(makePlan(12, '12T 판재 V개선'))
    c.createPlan(makePlan(20, '배관 PA'))
    for (const id of ['PL23833', 'PL23840', 'PL23841']) c.ensureSpecimen({ id, displayName: id, source: 'device-filename' })
    c.insertFile(
      makeFile('a', 'SP001', 'PL23833', {
        sourceFileName: '12T-SV-01-Cap on.nde',
        deviceFileName: '12T-SV-PL23833-i15-CAP20',
        stateTag: 'Cap on',
        importedAt: '2026-10-02T10:00:00+09:00'
      }),
      '{"version":"3.3.0"}'
    )
    c.insertFile(
      makeFile('b', 'SP001', 'PL23840', { sourceFileName: '12T-SV-02-Cap on.nde', stateTag: 'Cap on', importedAt: '2026-10-02T10:00:01+09:00' })
    )
    c.insertFile(
      makeFile('c', 'SP001', 'PL23841', {
        sourceFileName: '12T-SV-03-Cap off.nde',
        stateTag: 'Cap off',
        memo: '표면 연마 후',
        tags: ['재검사'],
        importedAt: '2026-10-02T10:00:02+09:00'
      })
    )
    c.insertFile(makeFile('d', 'SP002', 'PL23833', { sourceFileName: 'pipe.nde', importedAt: '2026-10-02T10:00:03+09:00' }))
  })

  it('시편 ensure 는 멱등이고 대소문자만 다른 ID 는 같은 시편, 폴더 금지문자 ID 는 거부', () => {
    const again = c.ensureSpecimen({ id: 'pl23833', displayName: '다른 이름', source: 'manual' })
    expect(again).toMatchObject({ id: 'PL23833', displayName: 'PL23833', source: 'device-filename' })
    expect(code(() => c.ensureSpecimen({ id: 'A:B', displayName: '', source: 'manual' }))).toBe('INVALID_ARGUMENT')
    expect(code(() => c.ensureSpecimen({ id: ' ', displayName: '', source: 'manual' }))).toBe('INVALID_ARGUMENT')
    expect(code(() => c.ensureSpecimen({ id: 'X', displayName: '', source: 'bogus' as 'manual' }))).toBe('INVALID_ARGUMENT')
    const nfd = '시편'.normalize('NFD')
    expect(c.ensureSpecimen({ id: nfd, displayName: '', source: 'manual' }).id).toBe('시편'.normalize('NFC'))
    expect(c.getSpecimen('시편')?.id).toBe('시편')
  })

  it('시편 수정', () => {
    expect(c.updateSpecimen('PL23833', { displayName: '시편 33', note: '두께 실측 12.1' })).toMatchObject({
      displayName: '시편 33',
      note: '두께 실측 12.1'
    })
    expect(code(() => c.updateSpecimen('NOPE', { note: 'x' }))).toBe('NOT_FOUND')
  })

  it('플랜별 파일·시편 수·크기·최근 가져오기 집계', () => {
    const [p1, p2] = c.listPlans()
    expect(p1).toMatchObject({ id: 'SP001', fileCount: 3, specimenCount: 3, totalBytes: 3000, lastImportedAt: '2026-10-02T10:00:02+09:00' })
    expect(p2).toMatchObject({ id: 'SP002', fileCount: 1, specimenCount: 1, totalBytes: 1000 })
  })

  it('시편 목록: 전체 / 플랜 기준 (개수·상태 태그는 그 플랜 안에서, planIds 는 전체)', () => {
    const all = c.listSpecimens()
    expect(all.map((s) => s.id)).toEqual(['PL23833', 'PL23840', 'PL23841'])
    expect(all[0]).toMatchObject({ planIds: ['SP001', 'SP002'], fileCount: 2, stateTags: ['Cap on'] })
    const inP2 = c.listSpecimens('SP002')
    expect(inP2.map((s) => s.id)).toEqual(['PL23833'])
    expect(inP2[0]).toMatchObject({ fileCount: 1, stateTags: [], planIds: ['SP001', 'SP002'] })
    expect(c.listSpecimens('SP001').find((s) => s.id === 'PL23841')?.stateTags).toEqual(['Cap off'])
    expect(c.getSpecimen('PL23840')).toMatchObject({ fileCount: 1, planIds: ['SP001'] })
    expect(c.getSpecimen('없음')).toBeNull()
  })

  it('같은 SHA-256 은 CONFLICT, 없는 플랜·시편은 NOT_FOUND, 잘못된 해시는 INVALID_ARGUMENT', () => {
    expect(c.findFileBySha256(sha('a'))?.specimenId).toBe('PL23833')
    expect(c.findFileBySha256(sha('a').toUpperCase())?.id).toBeDefined()
    expect(code(() => c.insertFile(makeFile('a', 'SP001', 'PL23840', { sourceFileName: 'other.nde' })))).toBe('CONFLICT')
    expect(code(() => c.insertFile(makeFile('z', 'SP009', 'PL23840')))).toBe('NOT_FOUND')
    expect(code(() => c.insertFile(makeFile('z', 'SP001', 'NOPE')))).toBe('NOT_FOUND')
    const bad = makeFile('z', 'SP001', 'PL23840')
    bad.meta.sha256 = 'xyz'
    expect(code(() => c.insertFile(bad))).toBe('INVALID_ARGUMENT')
    expect(code(() => c.insertFile(makeFile('y', 'SP001', 'PL23840', { storedRelPath: '../밖/x.nde' })))).toBe('INVALID_ARGUMENT')
  })

  it('파일 레코드 왕복과 원본 셋업 JSON 보관', () => {
    const f = c.findFileBySha256(sha('a'))!
    expect(c.getFile(f.id)).toEqual(f)
    expect(f).toMatchObject({
      planId: 'SP001',
      specimenId: 'PL23833',
      storedRelPath: '스캔플랜/SP001/PL23833/12T-SV-01-Cap on.nde',
      stateTag: 'Cap on',
      round: null,
      tags: []
    })
    expect(f.meta.deviceFileName).toBe('12T-SV-PL23833-i15-CAP20')
    expect(f.meta.ndeVersion.raw).toBe('3.3.0')
    expect(c.getFileSetupJson(f.id)).toBe('{"version":"3.3.0"}')
    expect(c.getFileSetupJson(c.findFileBySha256(sha('b'))!.id)).toBeNull()
  })

  it('검색: 파일명·장비 원본 파일명·시편·상태 태그·메모·태그·플랜 이름, 대소문자 무시, 여러 낱말은 AND', () => {
    const names = (text: string, extra = {}) => c.listFiles({ text, sort: 'fileName-asc', ...extra }).items.map((f) => f.storedFileName)
    expect(names('cap OFF')).toEqual(['12T-SV-03-Cap off.nde'])
    expect(names('pl23833')).toEqual(['12T-SV-01-Cap on.nde', 'pipe.nde'])
    expect(names('i15-CAP20')).toEqual(['12T-SV-01-Cap on.nde'])
    expect(names('연마')).toEqual(['12T-SV-03-Cap off.nde'])
    expect(names('재검사')).toEqual(['12T-SV-03-Cap off.nde'])
    expect(names('배관')).toEqual(['pipe.nde'])
    expect(names('판재'.normalize('NFD'))).toHaveLength(3)
    expect(names('12T on')).toEqual(['12T-SV-01-Cap on.nde', '12T-SV-02-Cap on.nde'])
    expect(names('100%')).toEqual([])
    expect(names('_')).toEqual([])
    expect(names('')).toHaveLength(4)
  })

  it('필터·정렬·페이지', () => {
    expect(c.listFiles({ planId: 'SP001' }).total).toBe(3)
    expect(c.listFiles({ specimenId: 'pl23833' }).total).toBe(2)
    expect(c.listFiles({ stateTag: 'Cap on' }).total).toBe(2)
    expect(c.listFiles({ planId: 'SP001', stateTag: 'Cap off' }).items[0]?.specimenId).toBe('PL23841')
    const desc = c.listFiles({}).items.map((f) => f.storedFileName)
    expect(desc[0]).toBe('pipe.nde')
    const asc = c.listFiles({ sort: 'importedAt-asc' }).items.map((f) => f.storedFileName)
    expect(asc).toEqual([...desc].reverse())
    const page = c.listFiles({ sort: 'importedAt-asc', offset: 1, limit: 2 })
    expect(page).toMatchObject({ total: 4, offset: 1, limit: 2 })
    expect(page.items.map((f) => f.storedFileName)).toEqual(asc.slice(1, 3))
    expect(c.listFiles({ limit: 99999 }).limit).toBe(1000)
    expect(c.listFiles({ limit: 0 }).limit).toBe(1)
  })

  it('파일 주석 수정 (상태 태그·회차·메모·태그)', () => {
    const id = c.findFileBySha256(sha('b'))!.id
    const f = c.updateFile(id, { stateTag: '  ', round: 2, memo: '메모', tags: ['A', ' A ', '', 'B'] })
    expect(f).toMatchObject({ stateTag: null, round: 2, memo: '메모', tags: ['A', 'B'] })
    expect(c.updateFile(id, { memo: '다시' })).toMatchObject({ round: 2, tags: ['A', 'B'], memo: '다시' })
    expect(code(() => c.updateFile(id, { round: -1 }))).toBe('INVALID_ARGUMENT')
    expect(code(() => c.updateFile(9999, { memo: 'x' }))).toBe('NOT_FOUND')
  })
})

describe('가져오기 이력', () => {
  it('배치 시작·항목·종료·이력 조회', () => {
    const c = openCatalog(':memory:')
    c.beginImportBatch({ batchId: 'IMP-A', inputPaths: ['/x'], totalItems: 2, startedAt: '2026-10-02T09:00:00+09:00' })
    expect(c.listImportHistory()[0]).toMatchObject({ batchId: 'IMP-A', finishedAt: null, status: 'interrupted', totalItems: 2 })
    c.recordImportItem('IMP-A', {
      itemId: 'i0001',
      sourcePath: '/x/a.nde',
      fileName: 'a.nde',
      status: 'failed',
      fileId: null,
      planId: null,
      specimenId: null,
      storedRelPath: null,
      errorMessage: '읽기 실패'
    })
    c.finishImportBatch({
      batchId: 'IMP-A',
      finishedAt: '2026-10-02T09:01:00+09:00',
      status: 'failed',
      copiedCount: 0,
      skippedCount: 1,
      failedCount: 1,
      createdPlanIds: [],
      totalBytes: 0
    })
    c.beginImportBatch({ batchId: 'IMP-B', inputPaths: [], totalItems: 0, startedAt: '2026-10-02T10:00:00+09:00' })
    const h = c.listImportHistory()
    expect(h.map((e) => e.batchId)).toEqual(['IMP-B', 'IMP-A'])
    expect(h[1]).toMatchObject({ status: 'failed', failedCount: 1, skippedCount: 1, inputPaths: ['/x'] })
    expect(c.listImportItems('IMP-A')).toEqual([
      expect.objectContaining({ itemId: 'i0001', status: 'failed', errorMessage: '읽기 실패', sourcePath: '/x/a.nde' })
    ])
    expect(code(() => c.beginImportBatch({ batchId: 'IMP-A', inputPaths: [], totalItems: 0, startedAt: 'x' }))).toBe('CONFLICT')
    expect(() =>
      c.finishImportBatch({
        batchId: 'NOPE',
        finishedAt: 'x',
        status: 'completed',
        copiedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        createdPlanIds: [],
        totalBytes: 0
      })
    ).toThrow(/찾을 수 없습니다/)
    c.close()
  })
})
