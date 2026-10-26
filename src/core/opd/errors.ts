import { AppError, type ApiErrorCode } from '@shared/errors'

/**
 * OPD 읽기 오류.
 * - 'structure' = 구조 점검 실패. 메시지는 늘 '보류(해석 실패): …' 로 시작하고, 추정값으로 메우지 않는다.
 * - 나머지는 파일 접근 문제.
 */
export type OpdErrorReason = 'not-found' | 'not-a-file' | 'empty-file' | 'io' | 'structure'

/** 구조 점검 이름 (어느 점검에서 멈췄는지 — 테스트·로그용) */
export type OpdCheck =
  | 'magic'
  | 'container-version'
  | 'file-size'
  | 'tail-index'
  | 'general-info'
  | 'anchor'
  | 'setup-values'
  | 'probe-strings'
  | 'beam-pool'
  | 'beam-records'
  | 'beam-layout'
  | 'beam-values'
  | 'angle-block'
  | 'trailer'
  | 'palette'
  | 'positions'
  | 'bounds'

const CODE: Record<OpdErrorReason, ApiErrorCode> = {
  'not-found': 'NOT_FOUND',
  'not-a-file': 'NDE_READ_ERROR',
  'empty-file': 'NDE_READ_ERROR',
  io: 'IO_ERROR',
  structure: 'NDE_READ_ERROR'
}

export const OPD_FAIL_PREFIX = '보류(해석 실패)'

export class OpdError extends AppError {
  readonly reason: OpdErrorReason
  readonly check: OpdCheck | null

  constructor(reason: OpdErrorReason, message: string, detail?: string, check?: OpdCheck) {
    super(CODE[reason], message, detail)
    this.name = 'OpdError'
    this.reason = reason
    this.check = check ?? null
  }
}

/** 구조 점검 실패. message 는 사용자에게 보일 한국어 한 문장 (접두사 없이) */
export function structureFail(check: OpdCheck, message: string, detail?: string): never {
  throw new OpdError('structure', `${OPD_FAIL_PREFIX}: ${message}`, detail ? `${check}: ${detail}` : check, check)
}

/**
 * 앞부분만 읽은 상태에서 범위를 넘으면 던지는 내부 신호 (사용자에게 가지 않는다).
 * readOpdFile 이 더 길게 다시 읽는다. 파일 끝까지 읽었는데도 넘으면 structureFail('bounds').
 */
export class NeedMoreBytes extends Error {
  constructor(readonly needed: number) {
    super(`need ${needed} bytes`)
    this.name = 'NeedMoreBytes'
  }
}
