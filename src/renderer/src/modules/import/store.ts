/**
 * 가져오기 화면 상태 (모듈 단위 작은 store). 다른 메뉴에 다녀와도 분석 결과·편집 내용이 남는다.
 * 흐름: idle → analyzing → preview(편집) → committing → done
 */
import { useSyncExternalStore } from 'react'
import { sanitizeSpecimenId } from '@shared/ids'
import type {
  ImportCommitRequest,
  ImportItemPreview,
  ImportPreview,
  ImportResult,
  ProgressEvent,
  SpecimenIdSource
} from '@shared/types'
import { getApi, toUiError, unwrap, type UiError } from '../../api'

export interface ItemEdit {
  include: boolean
  specimenId: string
  source: SpecimenIdSource
  stateTag: string
  memo: string
}

export interface Edits {
  names: Record<string, string>
  items: Record<string, ItemEdit>
}

export type ImportState =
  | { kind: 'idle'; notice: UiError | null }
  | { kind: 'analyzing'; paths: string[]; progress: ProgressEvent | null }
  | { kind: 'preview'; preview: ImportPreview; edits: Edits; error: UiError | null }
  | { kind: 'committing'; preview: ImportPreview; edits: Edits; progress: ProgressEvent | null }
  | { kind: 'done'; preview: ImportPreview; result: ImportResult }

let state: ImportState = { kind: 'idle', notice: null }
let token = 0
let progressBound = false
const listeners = new Set<() => void>()

/** 이 세션에서 끝난 가져오기 결과 (가져오기 이력 화면이 항목별 결과를 보여줄 때 쓴다) */
export const sessionResults = new Map<string, ImportResult>()

function set(next: ImportState): void {
  state = next
  for (const l of listeners) l()
}

function bindProgress(): void {
  if (progressBound) return
  progressBound = true
  getApi().onProgress((ev) => {
    if (state.kind === 'analyzing' && ev.operation === 'analyze') set({ ...state, progress: ev })
    else if (state.kind === 'committing' && ev.operation === 'commit') set({ ...state, progress: ev })
  })
}

export function useImportState(): ImportState {
  bindProgress()
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

export const isImportable = (i: ImportItemPreview): boolean => i.verdict === 'match-existing' || i.verdict === 'new-plan'

function initialEdits(p: ImportPreview): Edits {
  const items: Record<string, ItemEdit> = {}
  for (const i of p.items.filter(isImportable)) {
    items[i.itemId] = {
      include: true,
      specimenId: i.suggestedSpecimenId ?? '',
      source: i.suggestedSpecimenSource ?? 'manual',
      stateTag: i.suggestedStateTag ?? '',
      memo: ''
    }
  }
  return { names: Object.fromEntries(p.newPlans.map((n) => [n.key, n.suggestedName])), items }
}

export async function analyze(paths: string[]): Promise<void> {
  if (paths.length === 0 || state.kind === 'analyzing' || state.kind === 'committing') return
  const my = ++token
  set({ kind: 'analyzing', paths, progress: null })
  try {
    const preview = await unwrap(getApi().import.analyze(paths))
    if (my !== token) return
    set({ kind: 'preview', preview, edits: initialEdits(preview), error: null })
  } catch (e) {
    if (my !== token) return
    set({ kind: 'idle', notice: toUiError(e) })
  }
}

export function cancel(): void {
  if (state.kind !== 'analyzing' && state.kind !== 'committing') return
  const opId = state.progress?.operationId
  if (opId) void getApi().import.cancel(opId)
}

export function reset(): void {
  if (state.kind === 'analyzing' || state.kind === 'committing') return
  token++
  set({ kind: 'idle', notice: null })
}

export function editItem(itemId: string, patch: Partial<ItemEdit>): void {
  if (state.kind !== 'preview') return
  const cur = state.edits.items[itemId]
  if (!cur) return
  set({ ...state, edits: { ...state.edits, items: { ...state.edits.items, [itemId]: { ...cur, ...patch } } } })
}

export function editAll(include: boolean): void {
  if (state.kind !== 'preview') return
  const items = Object.fromEntries(Object.entries(state.edits.items).map(([k, v]) => [k, { ...v, include }]))
  set({ ...state, edits: { ...state.edits, items } })
}

export function editName(key: string, name: string): void {
  if (state.kind !== 'preview') return
  set({ ...state, edits: { ...state.edits, names: { ...state.edits.names, [key]: name } } })
}

/** 확정 전 점검: 포함된 항목의 시편 ID 와 새 플랜 이름이 비어 있으면 안 된다 */
export function validate(p: ImportPreview, e: Edits): { included: ImportItemPreview[]; badItems: Set<string>; badPlans: Set<string> } {
  const included = p.items.filter((i) => isImportable(i) && e.items[i.itemId]?.include)
  const badItems = new Set(included.filter((i) => !sanitizeSpecimenId(e.items[i.itemId]?.specimenId ?? '')).map((i) => i.itemId))
  const usedKeys = new Set(included.map((i) => i.newPlanKey).filter((k): k is string => !!k))
  const badPlans = new Set([...usedKeys].filter((k) => !(e.names[k] ?? '').trim()))
  return { included, badItems, badPlans }
}

function buildRequest(p: ImportPreview, e: Edits): ImportCommitRequest {
  const { included } = validate(p, e)
  const usedKeys = new Set(included.map((i) => i.newPlanKey).filter((k): k is string => !!k))
  return {
    previewId: p.previewId,
    newPlans: p.newPlans.filter((n) => usedKeys.has(n.key)).map((n) => ({ key: n.key, name: (e.names[n.key] ?? n.suggestedName).trim() })),
    items: p.items.filter(isImportable).map((i) => {
      const ed = e.items[i.itemId]!
      return {
        itemId: i.itemId,
        include: ed.include,
        specimenId: sanitizeSpecimenId(ed.specimenId),
        specimenSource: ed.source,
        stateTag: ed.stateTag.trim() || null,
        round: i.suggestedRound,
        memo: ed.memo.trim()
      }
    })
  }
}

export async function commit(): Promise<void> {
  if (state.kind !== 'preview') return
  const { preview, edits } = state
  const my = ++token
  set({ kind: 'committing', preview, edits, progress: null })
  try {
    const result = await unwrap(getApi().import.commit(buildRequest(preview, edits)))
    sessionResults.set(result.batchId, result)
    if (my === token) set({ kind: 'done', preview, result })
  } catch (e) {
    if (my === token) set({ kind: 'preview', preview, edits, error: toUiError(e) })
  }
}
