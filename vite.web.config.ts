import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { alias, cspPlugin, root, WEB_DEV_PORT } from './build/vite-shared'

// 렌더러만 브라우저에서 띄우는 UI 검증용 설정. window.pautApi 가 없으므로 mock API 가 쓰인다.
export default defineConfig({
  root: resolve(root, 'src/renderer'),
  resolve: { alias },
  // 이 설정에서만 mock API 를 불러온다 (main.tsx). 운영 설정(electron.vite.config.ts)은 false
  define: { __PAUT_MOCK__: 'true' },
  plugins: [react(), cspPlugin()],
  server: { port: WEB_DEV_PORT, strictPort: true, host: 'localhost' },
  build: { outDir: resolve(root, 'out/web'), emptyOutDir: true, assetsInlineLimit: 0 }
})
