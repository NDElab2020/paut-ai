/** 신뢰 페이지 판정 (Electron 비의존, 테스트 가능) */
import { fileURLToPath } from 'node:url'

const samePath = (a: string, b: string, platform: string): boolean =>
  platform === 'win32' || platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b

/**
 * 앱 index.html 하나(해시·쿼리 무시)와 개발 서버 origin 만 신뢰한다.
 * 호스트가 있는 file URL(UNC 공유)·다른 로컬 파일·폴더는 신뢰하지 않는다.
 */
export function isTrustedUrlFor(url: string, indexPath: string, devOrigin: string | null, platform: string = process.platform): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'file:') {
    if (u.host !== '') return false
    try {
      return samePath(fileURLToPath(u), indexPath, platform)
    } catch {
      return false
    }
  }
  if (!devOrigin) return false
  const origin = u.protocol === 'ws:' ? `http://${u.host}` : u.origin
  return origin === devOrigin
}
