import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { appIndexPath, devRendererUrl } from './security'

/** 개발 도구·새로고침은 개발 실행에서만. 설치본은 최소 메뉴(맥: 앱·편집, 윈도우: 메뉴 없음)로 Ctrl+R·개발자 도구를 뺀다 */
export function installAppMenu(): void {
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }
}

export function createMainWindow(opts: { show: boolean; smoke?: boolean }): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    title: 'PAUT 데이터 관리',
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged && !opts.smoke
    }
  })
  if (opts.show) win.once('ready-to-show', () => win.show())
  const devUrl = devRendererUrl()
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(appIndexPath())
  return win
}
