/** 폐쇄망 보안: 외부 네트워크 차단, 창 열기·이동·다운로드 차단, 맞춤법 사전 다운로드 차단, 신뢰 페이지는 앱 index.html 하나. */
import { app, session, type WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTrustedUrlFor } from './trust'

/** 개발 서버(electron-vite dev)만 예외로 허용. 설치본(app.isPackaged)에서는 환경변수를 무시한다 */
export function devRendererUrl(): string | null {
  if (app.isPackaged) return null
  const url = process.env.ELECTRON_RENDERER_URL
  if (!url) return null
  try {
    const u = new URL(url)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? u.href : null
  } catch {
    return null
  }
}

function devOrigin(): string | null {
  const url = devRendererUrl()
  return url ? new URL(url).origin : null
}

/** 앱 렌더러 index.html 의 file URL 경로 (빌드 결과 out/renderer/index.html) */
export function appIndexPath(): string {
  return join(import.meta.dirname, '../renderer/index.html')
}

/**
 * 신뢰하는 페이지: 앱의 index.html 하나(해시·쿼리 무시)와 개발 서버.
 * 다른 로컬 HTML·폴더·UNC(file://서버/…)로 옮겨 가면 신뢰하지 않으므로 그 페이지는 IPC 를 쓸 수 없다.
 */
export function isTrustedUrl(url: string): boolean {
  return isTrustedUrlFor(url, appIndexPath(), devOrigin())
}

/** 앱 리소스(같은 컴퓨터의 file://) 요청인지. 호스트가 있는 file URL(UNC 공유)은 네트워크로 나가므로 막는다 */
function isLocalFileRequest(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'file:' && u.host === ''
  } catch {
    return false
  }
}

export function installNetworkGuard(): void {
  const ses = session.defaultSession
  ses.setSpellCheckerEnabled(false)
  // onBeforeRequest 는 세션당 리스너 하나라서 한 번에 등록한다
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] }, (details, cb) => {
    const allowed = details.url.startsWith('file:') ? isLocalFileRequest(details.url) : isTrustedUrl(details.url)
    if (!allowed) console.warn(`[network-guard] 차단: ${details.url}`)
    cb({ cancel: !allowed })
  })
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (e, item) => {
    e.preventDefault()
    item.cancel()
  })
}

function guardContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // 앱 페이지 안에서의 이동만 허용 (파일을 창에 떨어뜨렸을 때의 file:// 이동 등은 막는다)
  contents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault()
  })
  contents.on('will-redirect', (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault()
  })
  contents.on('will-attach-webview', (e) => e.preventDefault())
}

export function installContentsGuard(): void {
  app.on('web-contents-created', (_e, contents) => guardContents(contents))
}

/** 테스트용: 현재 앱 index.html 의 file URL */
export function appIndexUrl(): string {
  return pathToFileURL(appIndexPath()).href
}
