/**
 * 엑셀(xlsx) 읽기 오류. 사용자에게 보여 줄 한국어 문구를 담는다.
 * IPC 경계로 새어 나가도 AppError 규약(INVALID_ARGUMENT)을 따른다.
 */
import { AppError } from '@shared/errors'

/** 오류 갈래 (테스트·화면에서 가르기용) */
export type XlsxErrorReason = 'not-zip' | 'zip64' | 'corrupt' | 'unsupported' | 'too-large' | 'not-xlsx' | 'bad-xml'

export class XlsxError extends AppError {
  readonly reason: XlsxErrorReason

  constructor(reason: XlsxErrorReason, message: string, detail?: string) {
    super('INVALID_ARGUMENT', message, detail)
    this.name = 'XlsxError'
    this.reason = reason
  }
}
