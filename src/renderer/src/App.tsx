import { Suspense, useCallback, useEffect, useState } from 'react'
import { DEFAULT_MODULE, getModule, type ModuleId, type ModuleRoute } from '@shared/modules'
import { MaintenanceNotice } from './components/MaintenanceNotice'
import { getModuleComponent } from './modules/registry'
import { Sidebar } from './shell/Sidebar'
import { Statusbar } from './shell/Statusbar'
import { Topbar } from './shell/Topbar'
import { AppProvider, useApp } from './state/AppContext'

function Shell() {
  const [route, setRoute] = useState<ModuleRoute>({ moduleId: DEFAULT_MODULE, params: {} })
  const navigate = useCallback((moduleId: ModuleId, params: Record<string, string> = {}) => setRoute({ moduleId, params }), [])
  const { searchRef } = useApp()
  const Current = getModuleComponent(route.moduleId)

  // 메뉴 이동·Ctrl+I 뒤 키보드 위치를 새 화면 제목으로 (검색창에 입력 중이면 빼앗지 않는다)
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLInputElement && active.closest('.topbar')) return
    let frames = 0
    let raf = 0
    const tryFocus = (): void => {
      const title = document.querySelector<HTMLElement>('#main .page-header__title')
      if (title) {
        if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1')
        title.focus({ preventScroll: true })
      } else if (frames++ < 30) {
        raf = requestAnimationFrame(tryFocus)
      }
    }
    raf = requestAnimationFrame(tryFocus)
    return () => cancelAnimationFrame(raf)
  }, [route])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (k === 'i') {
        e.preventDefault()
        // 검색창에서 눌러도 새 화면 제목으로 포커스가 가도록
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        navigate('import')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, searchRef])

  return (
    <div className={getModule(route.moduleId).wide ? 'app app--wide' : 'app'}>
      <Topbar current={route.moduleId} navigate={navigate} />
      <Sidebar current={route.moduleId} navigate={navigate} />
      <main className="main" id="main">
        <MaintenanceNotice />
        <Suspense fallback={null}>
          <Current route={route} navigate={navigate} />
        </Suspense>
      </main>
      <Statusbar />
    </div>
  )
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
