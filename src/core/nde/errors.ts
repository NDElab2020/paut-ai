import { AppError, type ApiErrorCode } from '@shared/errors'

/** NDE 읽기 실패 세부 사유 (ApiErrorCode 보다 자세한 분류) */
export type NdeErrorReason =
  | 'not-found'
  | 'not-a-file'
  | 'empty-file'
  | 'not-hdf5'
  | 'truncated'
  | 'hdf5-open-failed'
  | 'corrupt'
  | 'no-setup'
  | 'bad-setup-json'
  | 'unknown-layout'
  | 'unsupported-version'

const CODE: Record<NdeErrorReason, ApiErrorCode> = {
  'not-found': 'NOT_FOUND',
  'not-a-file': 'NDE_READ_ERROR',
  'empty-file': 'NDE_READ_ERROR',
  'not-hdf5': 'NDE_READ_ERROR',
  truncated: 'NDE_READ_ERROR',
  'hdf5-open-failed': 'NDE_READ_ERROR',
  corrupt: 'NDE_READ_ERROR',
  'no-setup': 'NDE_UNSUPPORTED',
  'bad-setup-json': 'NDE_READ_ERROR',
  'unknown-layout': 'NDE_UNSUPPORTED',
  'unsupported-version': 'NDE_UNSUPPORTED'
}

const MESSAGE: Record<NdeErrorReason, string> = {
  'not-found': '파일을 찾을 수 없습니다.',
  'not-a-file': '일반 파일이 아닙니다.',
  'empty-file': '빈 파일입니다.',
  'not-hdf5': 'NDE(HDF5) 파일이 아닙니다.',
  truncated: '파일이 잘려 있습니다(복사·전송이 끝나지 않았거나 손상됨).',
  'hdf5-open-failed': 'NDE 파일을 열 수 없습니다(손상 가능).',
  corrupt: 'NDE 파일 내부 구조가 손상되어 읽을 수 없습니다.',
  'no-setup': 'NDE 셋업 정보(Setup)가 없습니다.',
  'bad-setup-json': 'NDE 셋업 정보를 해석할 수 없습니다(손상 가능).',
  'unknown-layout': '알 수 없는 NDE 구조입니다.',
  'unsupported-version': '지원하지 않는 NDE 버전입니다.'
}

export class NdeError extends AppError {
  readonly reason: NdeErrorReason

  constructor(reason: NdeErrorReason, detail?: string, extraMessage?: string) {
    super(CODE[reason], extraMessage ? `${MESSAGE[reason]} ${extraMessage}` : MESSAGE[reason], detail ? `${reason}: ${detail}` : reason)
    this.name = 'NdeError'
    this.reason = reason
  }
}
