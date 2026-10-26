import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { alias, cspPlugin, root } from './build/vite-shared'

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve(root, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: { alias },
    // 운영 렌더러에는 브라우저 미리보기용 mock API(가짜 데이터)를 넣지 않는다 (main.tsx 의 mock 가지가 빠짐 — src/renderer/src/api/index.ts)
    define: { __PAUT_MOCK__: 'false' },
    plugins: [react(), cspPlugin()],
    build: {
      assetsInlineLimit: 0,
      minify: true,
      rollupOptions: { input: { index: resolve(root, 'src/renderer/index.html') } }
    }
  }
})
