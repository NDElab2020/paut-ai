/** 앱 전역 상태: 설정·테마·앱 정보·검색어·데이터 갱신 신호·진행 중 작업. 가벼운 React 컨텍스트 하나로 둔다. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { AppInfo, AppSettings, ProgressEvent, StoreMaintenanceReport } from '@shared/types'
import { getApi, toUiError, unwrap, type UiError } from '../api'

export type Theme = 'light' | 'dark'

export interface Totals {
  plans: number
  specimens: number
  files: number
}

interface AppState {
  settings: AppSettings | null
  settingsError: UiError | null
  info: AppInfo | null
  theme: Theme
  setTheme: (t: Theme) => void
  updateSettings: (s: AppSettings) => void
  reloadSettings: () => void
  /** 검색어 (상단바) */
  query: string
  setQuery: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  /** 가져오기·이름 바꾸기 뒤 화면들이 다시 읽도록 올리는 값 */
  dataVersion: number
  bumpData: () => void
  totals: Totals | null
  progress: ProgressEvent | null
  /** 저장소를 열 때 한 점검·복구 결과 */
  maintenance: StoreMaintenanceReport | null
}

const Ctx = createContext<AppState | null>(null)

/** 기본은 라이트. OS 설정은 따르지 않는다 (PAUT_DESIGN.md 9절) — 'system' 은 라이트로 본다 */
export function themeOf(s: AppSettings | null): Theme {
  return s?.theme === 'dark' ? 'dark' : 'light'
}

function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t
}

export function AppProvider({ children }: { children: ReactNode }) {
  const api = getApi()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsError, setSettingsError] = useState<UiError | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [query, setQuery] = useState('')
  const [dataVersion, setDataVersion] = useState(0)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [maintenance, setMaintenance] = useState<StoreMaintenanceReport | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const reloadSettings = useCallback(() => {
    unwrap(api.settings.get()).then(
      (s) => {
        setSettings(s)
        setSettingsError(null)
        applyTheme(themeOf(s))
      },
      (e: unknown) => setSettingsError(toUiError(e))
    )
  }, [api])

  useEffect(() => {
    reloadSettings()
    unwrap(api.app.info()).then(setInfo, () => setInfo(null))
  }, [api, reloadSettings])

  useEffect(() => {
    return api.onProgress((ev) => setProgress(ev.phase === 'done' ? null : ev))
  }, [api])

  const storeRoot = settings?.storeRoot ?? null
  // 저장소가 바뀌면 렌더러 진폭 캐시·후처리 설정 캐시·라벨 세션(초안·패널 상태)을 비운다 (계획 §5 — 키에 storeRoot 가 있어 틀린 그림·
  // 남의 초안은 안 나오지만 옛 저장소의 것을 앱을 끌 때까지 들고 있지 않게 메모리를 놓는다). 불러온 색표(세션 전체)는 저장소와 무관해 그대로.
  // 이미지 보기 묶음은 따로 불러오므로 동적 import, 처음 정해질 때(빈 캐시)는 건너뛴다
  const prevStoreRoot = useRef(storeRoot)
  useEffect(() => {
    const prev = prevStoreRoot.current
    prevStoreRoot.current = storeRoot
    if (prev === null || prev === storeRoot) return
    void import('../viewer/volumeStore').then((m) => m.clearVolumes())
    void import('../viewer/postState').then((m) => m.clearPostState())
    void import('../labeling/session').then((m) => m.clearLabelSession())
  }, [storeRoot])

  useEffect(() => {
    if (!storeRoot) {
      setTotals(null)
      return
    }
    let alive = true
    Promise.all([unwrap(api.plans.list()), unwrap(api.specimens.list())]).then(
      ([plans, specimens]) => {
        if (!alive) return
        setTotals({ plans: plans.length, specimens: specimens.length, files: plans.reduce((s, p) => s + p.fileCount, 0) })
      },
      () => alive && setTotals(null)
    )
    return () => {
      alive = false
    }
  }, [api, storeRoot, dataVersion])

  useEffect(() => {
    if (!storeRoot) {
      setMaintenance(null)
      return
    }
    let alive = true
    unwrap(api.store.maintenance()).then(
      (r) => alive && setMaintenance(r),
      () => alive && setMaintenance(null)
    )
    return () => {
      alive = false
    }
  }, [api, storeRoot])

  const updateSettings = useCallback((s: AppSettings) => {
    setSettings(s)
    applyTheme(themeOf(s))
  }, [])

  const setTheme = useCallback(
    (t: Theme) => {
      applyTheme(t)
      setSettings((s) => (s ? { ...s, theme: t } : s))
      void unwrap(api.settings.set({ theme: t })).then(updateSettings, () => undefined)
    },
    [api, updateSettings]
  )

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), [])

  const value = useMemo<AppState>(
    () => ({
      settings,
      settingsError,
      info,
      theme: themeOf(settings),
      setTheme,
      updateSettings,
      reloadSettings,
      query,
      setQuery,
      searchRef,
      dataVersion,
      bumpData,
      totals,
      progress,
      maintenance
    }),
    [settings, settingsError, info, setTheme, updateSettings, reloadSettings, query, dataVersion, bumpData, totals, progress, maintenance]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppProvider 밖에서 useApp 호출')
  return v
}
