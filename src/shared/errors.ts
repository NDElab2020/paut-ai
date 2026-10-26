/** 오류 규약: 모든 API 응답은 ApiResult. 실패 = { ok:false, code, message }. message 는 사용자에게 보여줄 한국어. */

export type ApiErrorCode =
  | 'NO_STORE_ROOT'
  | 'STORE_ROOT_INVALID'
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'PREVIEW_EXPIRED'
  | 'BUSY'
  | 'CANCELLED'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'HASH_MISMATCH'
  | 'NDE_READ_ERROR'
  | 'NDE_UNSUPPORTED'
  | 'DB_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL'

export interface ApiError {
  ok: false
  code: ApiErrorCode
  message: string
  /** 개발자용 상세 (스택 등). UI 는 접어서 보여준다 */
  detail?: string
}

export interface ApiOk<T> {
  ok: true
  data: T
}

export type ApiResult<T> = ApiOk<T> | ApiError

/** core/main 에서 던지는 오류. IPC 경계에서 ApiError 로 바뀐다. */
export class AppError extends Error {
  readonly code: ApiErrorCode
  readonly detail: string | undefined

  constructor(code: ApiErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.detail = detail
  }
}

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data }
}

export function fail(code: ApiErrorCode, message: string, detail?: string): ApiError {
  return detail === undefined ? { ok: false, code, message } : { ok: false, code, message, detail }
}

/** 어떤 예외든 ApiError 로 변환 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof AppError) return fail(err.code, err.message, err.detail)
  if (err instanceof Error) {
    if (err.message === 'not implemented') return fail('NOT_IMPLEMENTED', '아직 구현되지 않은 기능입니다.', err.stack)
    return fail('INTERNAL', '알 수 없는 오류가 발생했습니다.', err.stack ?? err.message)
  }
  return fail('INTERNAL', '알 수 없는 오류가 발생했습니다.', String(err))
}

export function isApiResult(v: unknown): v is ApiResult<unknown> {
  return typeof v === 'object' && v !== null && 'ok' in v && typeof (v as { ok: unknown }).ok === 'boolean'
}
