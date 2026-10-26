import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// 설정 파일은 번들되어 다른 위치에서 실행되므로 import.meta 대신 패키지 루트(cwd)를 기준으로 한다 (npm 스크립트는 항상 app/ 에서 실행).
export const root = process.cwd()

export const alias = {
  '@shared': resolve(root, 'src/shared'),
  '@core': resolve(root, 'src/core'),
  '@main': resolve(root, 'src/main'),
  '@renderer': resolve(root, 'src/renderer/src')
}

export const WEB_DEV_PORT = 5199

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

// 개발 서버는 Vite HMR 이 <style> 주입과 ws 연결을 쓰므로 그 둘만 허용한다.
const DEV_CSP = PROD_CSP.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'").replace(
  "connect-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:*"
)

export function cspPlugin(): Plugin {
  let isDev = false
  return {
    name: 'paut-csp',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${isDev ? DEV_CSP : PROD_CSP}" />`
      return html.replace('<!--CSP-->', meta)
    }
  }
}
