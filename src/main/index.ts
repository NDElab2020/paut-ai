import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { initNde } from '@core/nde'
import { createAppService, type AppService } from '@core/service'
import { createHandlers } from './handlers'
import { registerIpcHandlers } from './ipc'
import { broadcastProgress } from './progress'
import { installContentsGuard, installNetworkGuard } from './security'
import { runSmoke } from './smoke'
import { createMainWindow, installAppMenu } from './window'

/** 스모크·테스트용 경로는 개발 실행에서만 (설치본 점검이 필요하면 PAUT_ALLOW_SMOKE=1) */
const devHooks = !app.isPackaged || process.env.PAUT_ALLOW_SMOKE === '1'
const isSmoke = devHooks && process.argv.includes('--smoke')
let mainWindow: BrowserWindow | null = null
let service: AppService | null = null

// 테스트·스모크용: 사용자 데이터 위치를 바꿔 실제 프로필을 건드리지 않는다
const userDataOverride = devHooks ? process.env.PAUT_USER_DATA_DIR : undefined
if (userDataOverride) app.setPath('userData', userDataOverride)
if (isSmoke) app.disableHardwareAcceleration()

if (!isSmoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  installContentsGuard()

  void app.whenReady().then(async () => {
    installNetworkGuard()
    installAppMenu()
    service = createAppService({
      settingsPath: join(app.getPath('userData'), 'settings.json'),
      onProgress: broadcastProgress
    })
    registerIpcHandlers(createHandlers({ service, getWindow: () => mainWindow }))
    // h5wasm 초기화(약 60ms)를 첫 가져오기 전에 미리 해 둔다
    void initNde().catch((err: unknown) => console.error('[nde] 초기화 실패', err))
    if (isSmoke) {
      await runSmoke(() => (mainWindow = createMainWindow({ show: false, smoke: true })))
      return
    }
    mainWindow = createMainWindow({ show: true })
    mainWindow.on('closed', () => (mainWindow = null))
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow({ show: true })
    })
  })

  app.on('will-quit', () => service?.close())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || isSmoke) app.quit()
  })
}
