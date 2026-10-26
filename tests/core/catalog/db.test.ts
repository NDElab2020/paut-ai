/**
 * Db 문 캐시 (2026-10-07 최적화): 같은 SQL 은 한 번 준비한 문을 다시 쓰되, 결과는 부를 때마다 준비한 것과 같아야 한다.
 *   - 빠진 매개변수는 null (앞 호출 값이 남지 않음)
 *   - 스키마를 바꾸면(ALTER) 'SELECT *' 가 새 칸을 본다 (node:sqlite 는 문에 칸 목록을 기억하므로 캐시를 비움)
 *   - 롤백 뒤·오류 뒤에도 같은 문을 다시 쓸 수 있다, 캐시는 상한까지만
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Db } from '@core/catalog/db'

const dir = mkdtempSync(join(tmpdir(), 'paut-db-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('Db 문 캐시', () => {
  it('매개변수·스키마 변경·롤백·제약 오류', () => {
    const db = Db.open(join(dir, 'a.db'))
    try {
      expect({ ...db.get('SELECT $a AS a, $b AS b', { a: 1, b: 2 }) }).toEqual({ a: 1, b: 2 })
      expect({ ...db.get('SELECT $a AS a, $b AS b', { a: 3 }) }).toEqual({ a: 3, b: null })
      db.exec('CREATE TABLE t (x INTEGER PRIMARY KEY)')
      db.run('INSERT INTO t (x) VALUES ($x)', { x: 1 })
      expect(db.all('SELECT * FROM t').map((r) => ({ ...r }))).toEqual([{ x: 1 }])
      db.exec('ALTER TABLE t ADD COLUMN y INTEGER DEFAULT 5')
      expect(db.all('SELECT * FROM t').map((r) => ({ ...r }))).toEqual([{ x: 1, y: 5 }])
      // 제약 오류 뒤에도 같은 문을 쓴다
      expect(() => db.run('INSERT INTO t (x) VALUES ($x)', { x: 1 })).toThrow()
      expect(db.run('INSERT INTO t (x) VALUES ($x)', { x: 2 }).changes).toBe(1)
      // 트랜잭션 안에서 바꾼 스키마를 되돌리면 그 뒤 문도 옛 스키마를 본다
      expect(() =>
        db.transaction(() => {
          db.exec('ALTER TABLE t ADD COLUMN z INTEGER DEFAULT 7')
          expect(db.all('SELECT * FROM t WHERE x = $x', { x: 1 }).map((r) => ({ ...r }))).toEqual([{ x: 1, y: 5, z: 7 }])
          throw new Error('되돌림')
        })
      ).toThrow()
      expect(db.all('SELECT * FROM t WHERE x = $x', { x: 1 }).map((r) => ({ ...r }))).toEqual([{ x: 1, y: 5 }])
      // 동적 SQL 이 많아도 그대로 동작 (캐시 상한)
      for (let n = 1; n <= 300; n++) {
        const names = Array.from({ length: n }, (_, i) => `$v${i}`)
        const p = Object.fromEntries(names.map((k, i) => [k.slice(1), i]))
        expect(db.get(`SELECT ${names.join(' + ')} AS s`, p)!['s']).toBe((n * (n - 1)) / 2)
      }
    } finally {
      db.close()
    }
  })
})
