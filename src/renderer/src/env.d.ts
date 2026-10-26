/// <reference types="vite/client" />

/** 브라우저 미리보기(vite.web.config.ts) = true 면 mock API 를 불러온다. 운영(electron.vite.config.ts) = false 라 mock 이 묶음에서 빠진다 */
declare const __PAUT_MOCK__: boolean
