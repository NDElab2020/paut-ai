/**
 * 학습 데이터 분할 (시편 단위 train · val · test) 과 시험 세트 잠금.
 *
 * 규칙 (계획.md 4절 '데이터 나누기', 평가_정의_v1.md 2절)
 *   - 분할 단위는 시편이다. 같은 시편의 모든 파일·재스캔·양쪽 스큐·다른 이득 파일이 자동으로 같은 쪽에 간다.
 *     시편 ID 는 catalog 시편처럼 ASCII 대소문자를 가리지 않는다(specimenKey).
 *   - 시험 세트를 잠그면 test 로 넣거나 test 에서 빼는 변경은 확인(confirmLocked)과 이유가 있어야 하고 기록에 남는다.
 *     train ↔ val 변경은 잠금과 무관하다(그래도 기록에 남김). 잠금을 풀 때도 확인과 이유가 필요하다.
 *   - 바꾼 기록(log)은 최근 1000줄까지 둔다.
 *
 * 저장: 이 저장소 catalog.db 의 label_meta 한 칸('train-split', JSON). 마이그레이션을 늘리지 않는다.
 *   catalog 가 label_meta 를 읽고 쓰는 함수를 내보내지 않아, 같은 DB 파일에 짧은 두 번째 연결을 열어 읽고 쓴다
 *   (node:sqlite 동기 호출이라 앱의 연결과 섞이지 않음). 다른 PC 로 건너가지 않는다(JSON 내보내기에 없음).
 */
import { DatabaseSync } from 'node:sqlite'
import type { TrainSplit, TrainingSplitChange, TrainingSplitLogEntry } from '@shared/api'
import { AppError } from '@shared/errors'

export const SPLIT_META_KEY = 'train-split'
export const SPLIT_FORMAT = 'paut-train-split'
const LOG_MAX = 1000

export interface SplitAssignment {
  /** 처음 정할 때 적은 시편 ID (표시용) */
  specimenId: string
  split: TrainSplit
  at: string
  pcId: string
}

export interface SplitState {
  format: typeof SPLIT_FORMAT
  version: 1
  unit: 'specimen'
  /** 키 = specimenKey(시편 ID) */
  assignments: Record<string, SplitAssignment>
  testLock: { locked: boolean; at: string | null; pcId: string | null; labelerId: string | null }
  log: TrainingSplitLogEntry[]
}

export interface SplitContext {
  at: string
  pcId: string
  labelerId: string | null
  confirmLocked?: boolean
  reason?: string | null
}

/** 시편 ID 를 ASCII 대소문자 구분 없이 (core/catalog specimenKey 와 같은 규칙) */
export function splitKey(specimenId: string): string {
  return specimenId.normalize('NFC').trim().replace(/[A-Z]/g, (c) => c.toLowerCase())
}

export function emptySplitState(): SplitState {
  return {
    format: SPLIT_FORMAT,
    version: 1,
    unit: 'specimen',
    assignments: {},
    testLock: { locked: false, at: null, pcId: null, labelerId: null },
    log: []
  }
}

const SPLITS: readonly TrainSplit[] = ['train', 'val', 'test']

/** 저장된 글자 → 상태 (모르는 값·깨진 줄은 버리고 빈 상태부터) */
export function parseSplitState(raw: string | null): SplitState {
  const s = emptySplitState()
  if (!raw) return s
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return s
  }
  if (!v || typeof v !== 'object') return s
  const o = v as Partial<SplitState>
  if (o.assignments && typeof o.assignments === 'object') {
    for (const [k, a] of Object.entries(o.assignments)) {
      if (a && typeof a === 'object' && SPLITS.includes(a.split) && typeof a.specimenId === 'string') {
        s.assignments[k] = { specimenId: a.specimenId, split: a.split, at: String(a.at ?? ''), pcId: String(a.pcId ?? '') }
      }
    }
  }
  const l = o.testLock
  if (l && typeof l === 'object') {
    s.testLock = {
      locked: l.locked === true,
      at: typeof l.at === 'string' ? l.at : null,
      pcId: typeof l.pcId === 'string' ? l.pcId : null,
      labelerId: typeof l.labelerId === 'string' ? l.labelerId : null
    }
  }
  if (Array.isArray(o.log)) s.log = o.log.filter((e) => e && typeof e === 'object' && typeof e.action === 'string').slice(-LOG_MAX)
  return s
}

function pushLog(s: SplitState, e: TrainingSplitLogEntry): void {
  s.log.push(e)
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX)
}

function lockedReason(ctx: SplitContext): string {
  const reason = typeof ctx.reason === 'string' ? ctx.reason.normalize('NFC').trim() : ''
  if (ctx.confirmLocked !== true || reason === '') {
    throw new AppError('CONFLICT', '시험 세트가 잠겨 있습니다. test 로 넣거나 test 에서 빼려면 이유를 적고 한 번 더 확인하세요(바꾼 기록에 남습니다).')
  }
  return reason.slice(0, 500)
}

/**
 * 분할 바꾸기 (새 상태를 돌려준다. 넘긴 상태는 그대로). 바뀐 줄 수도 돌려준다.
 * 잠긴 시험 세트를 건드리는 변경이 하나라도 있으면 확인·이유가 없을 때 아무것도 바꾸지 않고 CONFLICT.
 */
export function applySplitChanges(state: SplitState, changes: readonly TrainingSplitChange[], ctx: SplitContext): { state: SplitState; changed: number } {
  const next: SplitState = JSON.parse(JSON.stringify(state)) as SplitState
  const seen = new Set<string>()
  const plan: Array<{ key: string; specimenId: string; from: TrainSplit | null; to: TrainSplit | null }> = []
  for (const c of changes) {
    const id = typeof c?.specimenId === 'string' ? c.specimenId.normalize('NFC').trim() : ''
    if (!id) throw new AppError('INVALID_ARGUMENT', '시편 ID 가 비어 있습니다.')
    if (c.split !== null && !SPLITS.includes(c.split)) throw new AppError('INVALID_ARGUMENT', `분할 값이 올바르지 않습니다: ${String(c.split)}`)
    const key = splitKey(id)
    if (seen.has(key)) throw new AppError('INVALID_ARGUMENT', `같은 시편이 두 번 있습니다: ${id}`)
    seen.add(key)
    const from = next.assignments[key]?.split ?? null
    if (from === c.split) continue
    plan.push({ key, specimenId: next.assignments[key]?.specimenId ?? id, from, to: c.split })
  }
  const touchesTest = plan.some((p) => p.from === 'test' || p.to === 'test')
  const reason = next.testLock.locked && touchesTest ? lockedReason(ctx) : null
  for (const p of plan) {
    if (p.to === null) delete next.assignments[p.key]
    else next.assignments[p.key] = { specimenId: p.specimenId, split: p.to, at: ctx.at, pcId: ctx.pcId }
    const locked = next.testLock.locked && (p.from === 'test' || p.to === 'test')
    pushLog(next, {
      at: ctx.at,
      pcId: ctx.pcId,
      labelerId: ctx.labelerId,
      action: locked ? 'locked-change' : 'assign',
      specimenId: p.specimenId,
      from: p.from,
      to: p.to,
      reason: locked ? reason : null
    })
  }
  return { state: next, changed: plan.length }
}

/** 시험 세트 잠그기·풀기. 풀 때는 확인·이유가 있어야 한다. 이미 그 상태면 그대로 */
export function applyTestLock(state: SplitState, lock: boolean, ctx: SplitContext): { state: SplitState; changed: boolean } {
  if (state.testLock.locked === lock) return { state, changed: false }
  const reason = lock ? (typeof ctx.reason === 'string' && ctx.reason.trim() ? ctx.reason.normalize('NFC').trim().slice(0, 500) : null) : lockedReason(ctx)
  const next: SplitState = JSON.parse(JSON.stringify(state)) as SplitState
  next.testLock = lock ? { locked: true, at: ctx.at, pcId: ctx.pcId, labelerId: ctx.labelerId } : { locked: false, at: null, pcId: null, labelerId: null }
  pushLog(next, { at: ctx.at, pcId: ctx.pcId, labelerId: ctx.labelerId, action: lock ? 'lock' : 'unlock', specimenId: null, from: null, to: null, reason })
  return { state: next, changed: true }
}

/** 시편의 분할 (정하지 않았으면 null) */
export function splitOf(state: SplitState, specimenId: string | null): TrainSplit | null {
  if (!specimenId) return null
  return state.assignments[splitKey(specimenId)]?.split ?? null
}

// ───────────────────────────── label_meta 읽기·쓰기 ─────────────────────────────

function openMeta(dbPath: string): DatabaseSync {
  try {
    return new DatabaseSync(dbPath, { timeout: 5000 })
  } catch (e) {
    throw new AppError('DB_ERROR', '카탈로그 DB 를 열 수 없습니다(분할 읽기).', e instanceof Error ? e.message : String(e))
  }
}

/** label_meta 한 칸 읽기 (없으면 null). 분할·세트 제출 상태처럼 이 저장소에만 두는 작은 JSON */
export function readLabelMeta(dbPath: string, key: string): string | null {
  const db = openMeta(dbPath)
  try {
    const r = db.prepare('SELECT value FROM label_meta WHERE key = ?').get(key) as { value?: unknown } | undefined
    return typeof r?.value === 'string' ? r.value : null
  } catch (e) {
    throw new AppError('DB_ERROR', '라벨 저장소 설정 칸을 읽지 못했습니다.', e instanceof Error ? e.message : String(e))
  } finally {
    db.close()
  }
}

/** label_meta 한 칸 쓰기 (한 줄 덮어쓰기) */
export function writeLabelMeta(dbPath: string, key: string, value: string): void {
  const db = openMeta(dbPath)
  try {
    db.prepare('INSERT INTO label_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  } catch (e) {
    throw new AppError('DB_ERROR', '라벨 저장소 설정 칸을 저장하지 못했습니다.', e instanceof Error ? e.message : String(e))
  } finally {
    db.close()
  }
}

/** catalog.db 의 분할 상태 (없으면 빈 상태) */
export function readSplitState(dbPath: string): SplitState {
  try {
    return parseSplitState(readLabelMeta(dbPath, SPLIT_META_KEY))
  } catch (e) {
    if (e instanceof AppError && e.code === 'DB_ERROR') throw new AppError('DB_ERROR', '학습 데이터 분할을 읽지 못했습니다.', e.detail)
    throw e
  }
}

/** 분할 상태 쓰기 (한 줄 덮어쓰기) */
export function writeSplitState(dbPath: string, state: SplitState): void {
  try {
    writeLabelMeta(dbPath, SPLIT_META_KEY, JSON.stringify(state))
  } catch (e) {
    if (e instanceof AppError && e.code === 'DB_ERROR') throw new AppError('DB_ERROR', '학습 데이터 분할을 저장하지 못했습니다.', e.detail)
    throw e
  }
}
