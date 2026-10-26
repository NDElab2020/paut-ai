import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { toUiError, type UiError } from '../api'

export interface AsyncState<T> {
  data: T | null
  error: UiError | null
  loading: boolean
  reload: () => void
}

/** 비동기 불러오기. deps 가 바뀌거나 reload() 하면 다시 부른다. 늦게 온 이전 응답은 버린다. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<UiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    fn().then(
      (v) => {
        if (id !== seq.current) return
        setData(v)
        setError(null)
        setLoading(false)
      },
      (e: unknown) => {
        if (id !== seq.current) return
        setError(toUiError(e))
        setLoading(false)
      }
    )
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}
