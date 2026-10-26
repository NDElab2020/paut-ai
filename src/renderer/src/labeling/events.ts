/**
 * 작업 이벤트 (판독시간 근거, 규격_초안.md 1.5 '작업 이벤트 로그') — 순수.
 *   파일 열기·닫기(라벨 모드에서 세트를 정해 연 때·닫을 때), 기록 생성·수정·삭제, 검토 완료, 쉼(idle).
 *   쉼 = 입력(키·마우스·휠)이 IDLE_MS(5분) 이상 없었던 구간. 다시 입력하거나 파일을 닫을 때 그 구간 전체를 한 이벤트로 남긴다
 *   (판독시간 = 끝 − 시작 − 쉰 시간, 평가_정의_v1.md 9절). 시각은 기록용(이 PC 시계, 시간대 포함).
 * 이벤트는 labels:appendWorkEvent 로 보낸다(추가 전용). 라벨러·판독 단계·파일은 지금 세트로 채운다.
 */
import type { WorkEventInput } from '@shared/api'
import type { LabelSetKey, WorkEventKind } from '@shared/labels'

/** 쉼으로 보는 입력 없는 시간 (5분) */
export const IDLE_MS = 5 * 60 * 1000

export interface IdleSpan {
  /** 마지막 입력 시각 (ms) */
  fromMs: number
  /** 다시 입력한(또는 닫은) 시각 (ms) */
  toMs: number
  ms: number
}

export interface IdleTracker {
  /** 입력이 있었다: 그 전 입력에서 threshold 이상 지났으면 그 구간 */
  input(nowMs: number): IdleSpan | null
  /** 파일을 닫는다: 마지막 입력에서 threshold 이상 지났으면 그 구간 (그 뒤로는 null) */
  close(nowMs: number): IdleSpan | null
  lastInputMs(): number
}

export function createIdleTracker(startMs: number, thresholdMs: number = IDLE_MS): IdleTracker {
  let last = startMs
  let closed = false
  const span = (now: number): IdleSpan | null => (now - last >= thresholdMs ? { fromMs: last, toMs: now, ms: now - last } : null)
  return {
    input(now) {
      if (closed || now < last) return null
      const s = span(now)
      last = now
      return s
    },
    close(now) {
      if (closed) return null
      closed = true
      return now >= last ? span(now) : null
    },
    lastInputMs: () => last
  }
}

/** 로컬 시각 ISO 8601 + 시간대 ('2026-10-06T14:05:00+09:00') */
export function localIso(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(Math.abs(n)).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
}

/** 작업 이벤트 하나 (라벨러·판독 단계·파일 = 세트, 도구 = 우리 앱) */
export function workEvent(kind: WorkEventKind, sessionId: string, key: LabelSetKey, detail: unknown = null, atMs?: number): WorkEventInput {
  return {
    kind,
    sessionId,
    labelerId: key.labelerId,
    readingStage: key.readingStage,
    sha256: key.sha256,
    tool: 'app',
    detail: { guidelineVersion: key.guidelineVersion, ...(detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : {}) },
    ...(atMs !== undefined ? { at: localIso(atMs) } : {})
  }
}

/** 쉼 이벤트 (시각 = 다시 입력한 때, 세부 = 시작·끝·길이) */
export function idleEvent(span: IdleSpan, sessionId: string, key: LabelSetKey): WorkEventInput {
  return workEvent('idle', sessionId, key, { from: localIso(span.fromMs), to: localIso(span.toMs), idleSeconds: Math.round(span.ms / 1000) }, span.toMs)
}

/** 작업 세션 ID (파일을 라벨 모드로 열 때마다 새로) */
export function newSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 기록 UUID (crypto.randomUUID, 소문자 8-4-4-4-12) */
export function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const h = (n: number): string =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16)
        .toString(16)
        .toLowerCase()
    ).join('')
  return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${h(3)}-${h(12)}`
}
