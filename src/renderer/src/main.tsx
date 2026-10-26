import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/components.css'
import './styles/app.css'
import { App } from './App'
import { PRELOAD_MISSING, installApi } from './api'

// 드롭 영역 밖에 파일·폴더를 떨어뜨려도 Chromium 기본 동작(그 파일로 창 이동)이 일어나지 않게 한다.
// 드롭 영역은 React 핸들러에서 먼저 preventDefault 하므로 그대로 동작한다.
window.addEventListener('dragover', (e) => {
  if (e.defaultPrevented) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
})
window.addEventListener('drop', (e) => e.preventDefault())

const el = document.getElementById('root')
if (!el) throw new Error('#root 없음')
const root = createRoot(el)

/** 브라우저 mock 시나리오: 주소 뒤 ?mock=empty / nostore / recovered / many */
function mockScenario(): 'default' | 'empty' | 'nostore' | 'recovered' | 'many' {
  const v = new URLSearchParams(window.location.search).get('mock')
  return v === 'empty' || v === 'nostore' || v === 'recovered' || v === 'many' ? v : 'default'
}

async function boot(): Promise<void> {
  if (!window.pautApi) {
    // 브라우저 미리보기(vite.web.config.ts, __PAUT_MOCK__ = true)에서만 mock 을 따로 불러온다. 운영 묶음에서는 이 가지가 빠진다
    if (__PAUT_MOCK__) {
      const { createMockApi } = await import('./api/mock')
      installApi(createMockApi(mockScenario()))
    } else {
      root.render(
        <div className="app-fatal" role="alert">
          <p>{PRELOAD_MISSING}</p>
        </div>
      )
      return
    }
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void boot()
