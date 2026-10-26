/**
 * 작업 이벤트 세션 (판독시간 — 평가 정의 9절) — 뷰어(NdeViewer)가 들고 있는 훅. 라벨 모드를 껐다 켜도 이어진다.
 *   세트가 정해진 때부터 뷰어를 닫을 때까지 '파일 열기' ~ '파일 닫기' 한 세션. 그 사이 5분 넘게 입력이 없으면 '쉼'.
 *   세트는 뷰어를 열 때 이 라벨러가 이 파일에 이미 세트가 있으면 그것(보통 모드에서 C-scan 을 훑는 시간도 셈),
 *   없으면 라벨 패널이 세트를 정할 때(setKey). 세트(라벨러·지침서·판독 단계)가 바뀌면 새 세션.
 *   열기는 조금 늦게 보낸다 — 바로 닫히면(개발 모드 StrictMode 이중 마운트 등) 열기·닫기 둘 다 보내지 않는다.
 * 라벨 추가 작업(형상 에코 승인·검토 구간 저장·라벨 모드의 게이트 바꾸기)은 'label-extra' 이벤트로 남긴다(패널·뷰어가 emit).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { labelSetId, type LabelSetKey, type WorkEventKind } from '@shared/labels'
import { getApi } from '../api'
import { createIdleTracker, idleEvent, newSessionId, workEvent } from './events'

export interface WorkSession {
  /** 세션의 세트 (null 이면 바꾸지 않는다 — 뷰어를 닫을 때까지 마지막 세트로 이어 간다) */
  setKey: (key: LabelSetKey | null) => void
  /** 세션을 끝낸다 (라벨러를 고르지 않게 됨 등 — 그 뒤 시간은 아무 세트에도 세지 않는다) */
  end: () => void
  emit: (kind: WorkEventKind, detail?: Record<string, unknown>) => void
  /** 작업 이벤트를 남기지 못한 이유 (마지막 것) */
  error: string | null
}

export function useWorkSession(fileName: string): WorkSession {
  const api = getApi()
  const [key, setKeyState] = useState<LabelSetKey | null>(null)
  const ref = useRef<{ sessionId: string; key: LabelSetKey; opened: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setId = key ? labelSetId(key) : null
  const send = useCallback(
    (input: Parameters<typeof api.labels.appendWorkEvent>[0]) => {
      void api.labels.appendWorkEvent(input).then((r) => setError(r.ok ? null : `작업 이벤트를 남기지 못했습니다: ${r.message}`))
    },
    [api]
  )
  useEffect(() => {
    if (!key) return
    const k = key
    const sessionId = newSessionId()
    const startedAt = Date.now()
    const tracker = createIdleTracker(startedAt)
    const cur = { sessionId, key: k, opened: false }
    ref.current = cur
    const openTimer = setTimeout(() => {
      cur.opened = true
      send(workEvent('file-open', sessionId, k, { fileName }))
    }, 300)
    let lastMove = 0
    const onInput = (e: Event): void => {
      const now = Date.now()
      if (e.type === 'pointermove') {
        if (now - lastMove < 1000) return
        lastMove = now
      }
      const span = tracker.input(now)
      if (span && cur.opened) send(idleEvent(span, sessionId, k))
    }
    const opts = { capture: true, passive: true } as const
    for (const t of ['keydown', 'pointerdown', 'wheel', 'pointermove']) window.addEventListener(t, onInput, opts)
    return () => {
      clearTimeout(openTimer)
      for (const t of ['keydown', 'pointerdown', 'wheel', 'pointermove']) window.removeEventListener(t, onInput, opts)
      if (ref.current === cur) ref.current = null
      if (!cur.opened) return
      const now = Date.now()
      const span = tracker.close(now)
      if (span) send(idleEvent(span, sessionId, k))
      send(workEvent('file-close', sessionId, k, { fileName, openSeconds: Math.round((now - startedAt) / 1000) }))
    }
    // 세트(setId)가 바뀔 때만 새 세션
  }, [setId, send, fileName])
  const setKey = useCallback((k: LabelSetKey | null) => {
    if (!k) return
    setKeyState((cur) => (cur && labelSetId(cur) === labelSetId(k) ? cur : k))
  }, [])
  const end = useCallback(() => setKeyState(null), [])
  const emit = useCallback(
    (kind: WorkEventKind, detail?: Record<string, unknown>) => {
      const cur = ref.current
      if (cur) send(workEvent(kind, cur.sessionId, cur.key, detail ?? null))
    },
    [send]
  )
  return { setKey, end, emit, error }
}
