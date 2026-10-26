/**
 * 렌더러 API 어댑터: Electron 이면 preload 의 window.pautApi, 브라우저 미리보기(npm run dev:web)면 main.tsx 가 먼저 넣어 둔 mock.
 * 화면은 이 파일만 거쳐 API 를 부른다. mock(가짜 X3 데이터 포함)은 여기서 가져오지 않는다 — 운영 묶음(electron-vite)에서는
 * __PAUT_MOCK__ = false 라 main.tsx 의 mock 불러오기가 통째로 빠지고, preload 를 못 읽으면 가짜 데이터로 조용히 돌지 않고 오류 화면이 뜬다.
 */
import type { PautApi } from '@shared/api'
import type { ApiErrorCode, ApiResult } from '@shared/errors'

let cached: PautApi | null = null

export function isMockApi(): boolean {
  return typeof window === 'undefined' || !window.pautApi
}

/** 브라우저 미리보기에서 mock 을 넣는다 (main.tsx, __PAUT_MOCK__ 일 때만) */
export function installApi(api: PautApi): void {
  cached = api
}

export const PRELOAD_MISSING = '앱 연결(preload)을 읽지 못했습니다. 앱을 다시 시작하고, 그래도 같으면 다시 설치하세요.'

export function getApi(): PautApi {
  if (!cached) {
    if (!window.pautApi) throw new Error(PRELOAD_MISSING)
    cached = window.pautApi
  }
  return cached
}

export interface UiError {
  code: ApiErrorCode | 'UNKNOWN'
  message: string
  detail?: string
}

export class ApiCallError extends Error implements UiError {
  readonly code: ApiErrorCode
  readonly detail: string | undefined
  constructor(code: ApiErrorCode, message: string, detail?: string) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

/** ApiResult 를 풀어 값만 받거나 ApiCallError 를 던진다 */
export async function unwrap<T>(p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p
  if (r.ok) return r.data
  throw new ApiCallError(r.code, r.message, r.detail)
}

export function toUiError(e: unknown): UiError {
  if (e instanceof ApiCallError) return e.detail === undefined ? { code: e.code, message: e.message } : { code: e.code, message: e.message, detail: e.detail }
  if (e instanceof Error) return { code: 'UNKNOWN', message: e.message, detail: e.stack ?? '' }
  return { code: 'UNKNOWN', message: String(e) }
}
