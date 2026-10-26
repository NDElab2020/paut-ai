/**
 * 작은 값 저장소 (구독형) — 포인터를 움직일 때마다 바뀌는 값(올려 둔 점의 읽기값 등)을 뷰어 전체를 다시 그리지 않고
 * 패널만 다시 그리게 넘긴다. 패널은 useSyncExternalStore(store.subscribe, store.get) 로 읽는다.
 */
export interface ValueStore<T> {
  get(): T
  set(value: T): void
  subscribe(listener: () => void): () => void
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(v) {
      if (Object.is(v, value)) return
      value = v
      for (const l of [...listeners]) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    }
  }
}
