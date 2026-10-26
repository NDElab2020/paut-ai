/**
 * 라벨 상태의 세션 보관 (렌더러 메모리) — 뷰어 key('storeRoot|fileId|sha256')마다. 뒤로 갔다 다시 열어도 라벨 모드·도구·초안·패널(세트·양식)이 그대로.
 * 저장소를 바꾸면 key 가 달라져 섞이지 않는다. 패널 펼침은 이 PC 의 보기 습관이라 localStorage 에 (실패해도 기본값으로 동작).
 */
import type { PanelState } from './panelState'
import { isEmptyDraft, type LabelState } from './state'

const cache = new Map<string, LabelState>()
/** 패널 상태 (세트·양식·고른 기록 등) — 라벨 모드를 껐다 켜도 남게 */
const panelCache = new Map<string, PanelState>()
/**
 * 보관하는 파일 수 상한 (오래된 것부터 버림). 다만 저장하지 않은 초안(점·사각형·R·검토 구간)이나 고치던 기록·찍기 시작한 새 기록이
 * 있는 세션은 버리지 않는다 — 이전·다음 파일([ ])로 빠르게 넘겨도 초안이 말없이 사라지지 않게(2026-10-07 검토).
 * 그런 세션만 LABEL_SESSION_HARD_MAX 를 넘으면 그때는 가장 오래된 것부터 버린다(메모리 상한). 앱을 닫으면 모두 사라진다.
 */
export const LABEL_SESSION_MAX = 16
export const LABEL_SESSION_HARD_MAX = 64

/** 버리면 안 되는 라벨 상태: 저장하지 않은 초안 */
export function isDirtyLabelState(s: LabelState): boolean {
  return !isEmptyDraft(s.draft)
}

/** 버리면 안 되는 패널 상태: 고치던 기록·찍기 시작한 새 기록(스냅샷)·에코 고침 */
export function isDirtyPanelState(s: PanelState): boolean {
  return s.editingUuid !== null || s.snapshot !== null || s.echoEdit !== null
}

/** 상한을 넘으면 깨끗한 것 중 가장 오래된 것부터, 그래도 HARD 상한을 넘으면 가장 오래된 것부터 버린다 */
function trim<T>(m: Map<string, T>, dirty: (v: T) => boolean): void {
  while (m.size > LABEL_SESSION_MAX) {
    let victim: string | null = null
    for (const [k, v] of m) {
      if (!dirty(v)) {
        victim = k
        break
      }
    }
    if (victim === null) {
      if (m.size <= LABEL_SESSION_HARD_MAX) return
      victim = m.keys().next().value as string
    }
    m.delete(victim)
  }
}

export function labelSessionGet(key: string): LabelState | null {
  return cache.get(key) ?? null
}

export function labelSessionSet(key: string, s: LabelState): void {
  cache.delete(key)
  cache.set(key, s)
  trim(cache, isDirtyLabelState)
}

export function clearLabelSession(): void {
  cache.clear()
  panelCache.clear()
}

export function panelSessionGet(key: string): PanelState | null {
  return panelCache.get(key) ?? null
}

export function panelSessionSet(key: string, s: PanelState): void {
  panelCache.delete(key)
  panelCache.set(key, s)
  trim(panelCache, isDirtyPanelState)
}

const PANEL_OPEN_KEY = 'paut.viewer.labelPanelOpen'

export function readLabelPanelOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(PANEL_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeLabelPanelOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(PANEL_OPEN_KEY, open ? '1' : '0')
  } catch {
    // 저장소를 쓸 수 없으면(사생활 모드 등) 이번 세션만
  }
}
