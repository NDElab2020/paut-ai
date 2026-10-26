/** 진행률: 단계 이름 + 세부 + 수치 + 4px 막대. total 을 모르면 지나가는 막대 */
export function ProgressBar(props: { label: string; detail?: string; current: number; total: number; unit?: string }) {
  const known = props.total > 0
  const pct = known ? Math.min(100, Math.round((props.current / props.total) * 100)) : 0
  return (
    <div className={known ? 'progress' : 'progress progress--indeterminate'}>
      <div className="progress__head">
        <span className="progress__label">{props.label}</span>
        <span className="progress__detail truncate" title={props.detail}>
          {props.detail ?? ''}
        </span>
        {known ? (
          <span className="progress__value">
            {props.current} / {props.total} {props.unit ?? '파일'}
          </span>
        ) : null}
      </div>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={known ? props.total : undefined}
        aria-valuenow={known ? props.current : undefined}
      >
        <div className="progress__bar" style={known ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
  )
}
