import type { ImportPreview } from '@shared/types'

/** 미리보기 보관 (main 프로세스 메모리, TTL 만료 시 get 이 null → 호출 쪽이 PREVIEW_EXPIRED) */
export interface PreviewStore {
  put(preview: ImportPreview): void
  get(previewId: string): ImportPreview | null
  delete(previewId: string): void
  clear(): void
}

export const DEFAULT_PREVIEW_TTL_MS = 6 * 60 * 60 * 1000
const MAX_PREVIEWS = 8

export function createPreviewStore(ttlMs: number = DEFAULT_PREVIEW_TTL_MS, clock: () => number = Date.now): PreviewStore {
  const map = new Map<string, { preview: ImportPreview; at: number }>()
  const prune = (): void => {
    const t = clock()
    for (const [k, v] of map) if (t - v.at > ttlMs) map.delete(k)
    while (map.size > MAX_PREVIEWS) map.delete(map.keys().next().value as string)
  }
  return {
    put(preview) {
      map.delete(preview.previewId)
      map.set(preview.previewId, { preview, at: clock() })
      prune()
    },
    get(previewId) {
      prune()
      return map.get(previewId)?.preview ?? null
    },
    delete: (previewId) => void map.delete(previewId),
    clear: () => map.clear()
  }
}
