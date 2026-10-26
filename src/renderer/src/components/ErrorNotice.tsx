import type { UiError } from '../api'

/** 오류 알림 줄: 무엇이 안 됐는지 + 서버 메시지 + 다시 시도. 개발자용 상세는 접어 둔다. */
export function ErrorNotice({ title, error, onRetry }: { title: string; error: UiError; onRetry?: () => void }) {
  return (
    <div className="notice notice--error" role="alert">
      <div className="notice__body">
        <p className="notice__title">{title}</p>
        <p>{error.message}</p>
        {error.detail ? (
          <details className="notice__detail">
            <summary>자세한 내용 ({error.code})</summary>
            <pre className="mono">{error.detail}</pre>
          </details>
        ) : null}
      </div>
      {onRetry ? (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          다시 시도
        </button>
      ) : null}
    </div>
  )
}
