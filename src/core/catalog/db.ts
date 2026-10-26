/**
 * node:sqlite 얇은 래퍼: 오류 변환, 중첩 가능한 트랜잭션, 짧은 쿼리 도우미.
 * run·get·all 은 준비한 문(prepare)을 SQL 글자마다 캐시한다(엑셀 확정·JSON 가져오기처럼 수만 번 부르는 길 — 같은 SQL·같은 매개변수면
 * 같은 결과, node:sqlite 는 부를 때마다 매개변수를 지우고 다시 묶는다). 스키마를 바꾸는 exec(CREATE·ALTER·DROP)·롤백·닫기 때 비운다
 * (node:sqlite 가 'SELECT *' 의 칸 목록을 문에 기억하므로). 동적 SQL(IN 목록 길이 등)이 많아도 STATEMENT_CACHE_MAX 개까지만 둔다.
 */
import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from 'node:sqlite'
import { AppError } from '@shared/errors'

export type Params = Record<string, SQLInputValue>
export type Row = Record<string, SQLOutputValue>

const SQLITE_CONSTRAINT = 19
/** 준비한 문 캐시 크기 (넘치면 가장 먼저 넣은 것부터 버림) */
const STATEMENT_CACHE_MAX = 256
/** 스키마를 바꾸는 SQL (문 캐시를 비운다) */
const DDL = /\b(CREATE|ALTER|DROP)\b/i

interface SqliteError extends Error {
  code?: string
  errcode?: number
  errstr?: string
}

export function isConstraintError(err: unknown): boolean {
  const e = err as SqliteError
  return typeof e?.errcode === 'number' && (e.errcode & 0xff) === SQLITE_CONSTRAINT
}

/** sqlite 예외 → AppError. 이미 AppError 면 그대로 */
export function toDbError(err: unknown, message = '카탈로그 DB 작업에 실패했습니다.'): AppError {
  if (err instanceof AppError) return err
  const e = err as SqliteError
  const detail = e instanceof Error ? `${e.message}${e.errcode !== undefined ? ` (errcode ${e.errcode})` : ''}` : String(err)
  if (isConstraintError(err)) return new AppError('CONFLICT', '이미 같은 항목이 카탈로그에 있습니다.', detail)
  return new AppError('DB_ERROR', message, detail)
}

export class Db {
  private depth = 0
  private readonly stmts = new Map<string, StatementSync>()

  constructor(readonly raw: DatabaseSync) {}

  /** SQL 글자마다 한 번 준비한 문 */
  private stmt(sql: string): StatementSync {
    let st = this.stmts.get(sql)
    if (!st) {
      st = this.raw.prepare(sql)
      if (this.stmts.size >= STATEMENT_CACHE_MAX) this.stmts.delete(this.stmts.keys().next().value as string)
      this.stmts.set(sql, st)
    }
    return st
  }

  static open(path: string): Db {
    try {
      const raw = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5000 })
      raw.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;')
      return new Db(raw)
    } catch (err) {
      throw toDbError(err, `카탈로그 DB 를 열 수 없습니다: ${path}`)
    }
  }

  exec(sql: string): void {
    try {
      this.raw.exec(sql)
    } catch (err) {
      throw toDbError(err)
    } finally {
      if (DDL.test(sql)) this.stmts.clear()
    }
  }

  run(sql: string, params: Params = {}): { changes: number; lastInsertRowid: number } {
    try {
      const r = this.stmt(sql).run(params)
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    } catch (err) {
      throw toDbError(err)
    }
  }

  get(sql: string, params: Params = {}): Row | undefined {
    try {
      return this.stmt(sql).get(params) as Row | undefined
    } catch (err) {
      throw toDbError(err)
    }
  }

  all(sql: string, params: Params = {}): Row[] {
    try {
      return this.stmt(sql).all(params) as Row[]
    } catch (err) {
      throw toDbError(err)
    }
  }

  /** 바깥은 BEGIN IMMEDIATE, 안쪽은 SAVEPOINT. 예외 시 해당 단계만 롤백하고 다시 던진다 */
  transaction<T>(fn: () => T): T {
    const sp = `sp${this.depth}`
    const outer = this.depth === 0
    this.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
    this.depth++
    try {
      const result = fn()
      this.depth--
      this.exec(outer ? 'COMMIT' : `RELEASE ${sp}`)
      return result
    } catch (err) {
      this.depth--
      try {
        this.raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
      } catch {
        /* 롤백 실패는 원래 오류를 가리지 않는다 */
      }
      // 되돌린 트랜잭션 안에서 스키마가 바뀌었을 수 있다
      this.stmts.clear()
      throw toDbError(err)
    }
  }

  close(): void {
    this.stmts.clear()
    if (this.raw.isOpen) this.raw.close()
  }
}
