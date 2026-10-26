/**
 * 라벨 세트 제출(잠금)과 '블라인드에서 설계값 대조 시작' 기록 (지침서 2.4·15절, 평가_정의 2절 시험 세트 3단계).
 *
 * 규칙
 *   - 블라인드 세트를 제출하면 그 세트의 기록·검토 구간·관측 행은 앱에서 고칠 수 없다(서비스가 CONFLICT) — 사람 기준선(블라인드)이
 *     설계값을 본 뒤 고쳐져 오염되지 않게. 제출을 풀 때는 이유가 있어야 하고 기록(log)에 남는다.
 *   - 설계값 대조는 블라인드 세트를 새 UUID 로 복사한 '대조' 세트에서 한다. 복사하면 블라인드 세트는 자동으로 제출된다.
 *     어느 원본 기록에서 왔는지(새 UUID → 원본 UUID)는 copies 에 남긴다(스키마 칸을 늘리지 않음).
 *   - 확정(final) 세트는 여기서 다루지 않는다 — 검수 화면 saveFinal 로만 만든다.
 *
 * 저장: 이 저장소 catalog.db 의 label_meta 한 칸('set-locks', JSON — split.ts 와 같은 두 번째 연결). 다른 PC 로 건너가지 않는다.
 */
import type { LabelSetLogEntry } from '@shared/api'
import { readLabelMeta, writeLabelMeta } from './split'

export const SET_LOCK_META_KEY = 'set-locks'
export const SET_LOCK_FORMAT = 'paut-set-locks'
const LOG_MAX = 1000
const COPY_MAX = 2000

export interface SetLockEntry {
  setId: string
  at: string
  pcId: string
  labelerId: string | null
}

export interface SetCopyEntry {
  /** 원본(블라인드) 세트 */
  from: string
  /** 새(설계값 대조) 세트 */
  to: string
  at: string
  pcId: string
  labelerId: string | null
  /** 새 기록 UUID → 원본 기록 UUID */
  records: Record<string, string>
  /** 새 검토 구간 UUID → 원본 UUID */
  reviews: Record<string, string>
}

export interface SetLockState {
  format: typeof SET_LOCK_FORMAT
  version: 1
  /** 키 = setId */
  locks: Record<string, SetLockEntry>
  copies: SetCopyEntry[]
  log: LabelSetLogEntry[]
}

export function emptySetLockState(): SetLockState {
  return { format: SET_LOCK_FORMAT, version: 1, locks: {}, copies: [], log: [] }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 저장된 글자 → 상태 (깨진 값은 버리고 빈 상태부터) */
export function parseSetLockState(raw: string | null): SetLockState {
  const s = emptySetLockState()
  if (!raw) return s
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return s
  }
  if (!isObj(v)) return s
  if (isObj(v['locks'])) {
    for (const [k, e] of Object.entries(v['locks'])) {
      if (isObj(e) && typeof e['at'] === 'string' && typeof e['pcId'] === 'string') {
        s.locks[k] = { setId: k, at: e['at'], pcId: e['pcId'], labelerId: typeof e['labelerId'] === 'string' ? e['labelerId'] : null }
      }
    }
  }
  if (Array.isArray(v['copies'])) {
    for (const c of v['copies']) {
      if (!isObj(c) || typeof c['from'] !== 'string' || typeof c['to'] !== 'string') continue
      const strMap = (m: unknown): Record<string, string> =>
        isObj(m) ? Object.fromEntries(Object.entries(m).filter((x): x is [string, string] => typeof x[1] === 'string')) : {}
      s.copies.push({
        from: c['from'],
        to: c['to'],
        at: typeof c['at'] === 'string' ? c['at'] : '',
        pcId: typeof c['pcId'] === 'string' ? c['pcId'] : '',
        labelerId: typeof c['labelerId'] === 'string' ? c['labelerId'] : null,
        records: strMap(c['records']),
        reviews: strMap(c['reviews'])
      })
    }
  }
  if (Array.isArray(v['log'])) {
    for (const e of v['log']) {
      if (!isObj(e) || typeof e['at'] !== 'string' || typeof e['setId'] !== 'string') continue
      const action = e['action']
      if (action !== 'submit' && action !== 'unsubmit' && action !== 'reconcile') continue
      s.log.push({
        at: e['at'],
        pcId: typeof e['pcId'] === 'string' ? e['pcId'] : '',
        labelerId: typeof e['labelerId'] === 'string' ? e['labelerId'] : null,
        action,
        setId: e['setId'],
        reason: typeof e['reason'] === 'string' ? e['reason'] : null
      })
    }
  }
  return s
}

export function readSetLockState(dbPath: string): SetLockState {
  return parseSetLockState(readLabelMeta(dbPath, SET_LOCK_META_KEY))
}

export function writeSetLockState(dbPath: string, st: SetLockState): void {
  if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX)
  if (st.copies.length > COPY_MAX) st.copies.splice(0, st.copies.length - COPY_MAX)
  writeLabelMeta(dbPath, SET_LOCK_META_KEY, JSON.stringify(st))
}

/** 그 세트가 제출(잠금)됐나 — 제출 시각 (아니면 null) */
export function setSubmittedAt(st: SetLockState, setId: string): string | null {
  return st.locks[setId]?.at ?? null
}

/** 그 세트가 어느 세트에서 복사됐나 (원본 setId, 없으면 null) */
export function setCopiedFrom(st: SetLockState, setId: string): string | null {
  for (let i = st.copies.length - 1; i >= 0; i--) if (st.copies[i]!.to === setId) return st.copies[i]!.from
  return null
}
