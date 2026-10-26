/** 서비스 공용 입력 검사 도우미 (labels.ts · labelReview.ts) */
import { AppError } from '@shared/errors'

/** INVALID_ARGUMENT 로 던진다 */
export function invalid(message: string): never {
  throw new AppError('INVALID_ARGUMENT', message)
}

/** 배열이 아닌 객체인가 */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
