import type { ModuleProps } from '@shared/modules'
import type { ImportResult } from '@shared/types'
import { Status } from '../../components/Status'
import { DASH, ITEM_STATUS, dateTime } from '../../lib/format'
import { reset } from './store'

/** 복사 결과 요약. 결과는 사라지지 않고 가져오기 이력에도 남는다 */
export function ResultView({ result, navigate }: { result: ImportResult; navigate: ModuleProps['navigate'] }) {
  const firstPlan = result.createdPlanIds[0] ?? result.items.find((i) => i.planId)?.planId ?? null
  const failed = result.failedCount > 0
  const cancelled = result.status === 'cancelled'
  const restored = result.items.filter((i) => i.status === 'restored').length
  const title = cancelled
    ? `복사를 멈췄습니다 · ${result.copiedCount}개는 저장소에 들어갔습니다`
    : failed
      ? `${result.failedCount}개 파일을 복사하지 못했습니다`
      : `${result.copiedCount}개 파일을 저장소에 복사했습니다${restored ? ` (사본 복원 ${restored}개 포함)` : ''}`
  const tone = cancelled ? 'notice' : failed ? 'notice notice--error' : 'notice notice--accent'
  return (
    <div className="import-result">
      <div className={tone} role="status">
        <div className="notice__body">
          <p className="notice__title" tabIndex={-1} data-focus-target>
            {cancelled ? <Status tone="muted">{title}</Status> : title}
          </p>
          <p>
            {dateTime(result.finishedAt)} {cancelled ? '중지' : '완료'} · 배치 <span className="mono">{result.batchId}</span> · 이 결과는
            가져오기 이력에도 남습니다.
            {cancelled ? ' 건너뛴 파일은 다시 가져오면 이어서 복사됩니다.' : ''}
          </p>
        </div>
      </div>

      <div className="result-stats">
        <div className="stat">
          <span className="stat__value">{result.copiedCount}</span>
          <span className="stat__label">{restored ? '복사·복원' : '복사·검증됨'}</span>
        </div>
        <div className="stat">
          <span className="stat__value">{result.skippedCount}</span>
          <span className="stat__label">건너뜀</span>
        </div>
        <div className="stat">
          <span className={failed ? 'stat__value text-danger' : 'stat__value'}>{result.failedCount}</span>
          <span className="stat__label">실패</span>
        </div>
        <div className="stat">
          <span className="stat__value">{result.createdPlanIds.length}</span>
          <span className="stat__label">새 플랜</span>
        </div>
        <div className="stat">
          <span className="stat__value">{result.createdSpecimenIds.length}</span>
          <span className="stat__label">새 시편</span>
        </div>
        <span className="toolbar__spacer" />
        <div className="row">
          {firstPlan ? (
            <button type="button" className="btn btn--secondary" onClick={() => navigate('plans', { planId: firstPlan })}>
              {firstPlan} 보기
            </button>
          ) : null}
          <button type="button" className="btn btn--ghost" onClick={reset}>
            다른 파일 가져오기
          </button>
        </div>
      </div>

      {result.createdPlanIds.length > 0 ? (
        <p className="result-plans">
          새 플랜:{' '}
          {result.createdPlanIds.map((id) => (
            <button key={id} type="button" className="btn btn--link" onClick={() => navigate('plans', { planId: id })}>
              {id}
            </button>
          ))}
        </p>
      ) : null}

      <ResultTable result={result} />
    </div>
  )
}

export function ResultTable({ result }: { result: ImportResult }) {
  return (
    <div className="table-wrap">
      <table className="table table--compact" aria-label="파일별 결과">
        <thead>
          <tr>
            <th>파일</th>
            <th>결과</th>
            <th>스캔플랜</th>
            <th>시편</th>
            <th>저장 위치 · 사유</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((i) => {
            const s = ITEM_STATUS[i.status]
            return (
              <tr key={i.itemId}>
                <td className="is-primary truncate result-file" title={i.fileName}>
                  {i.fileName}
                </td>
                <td>
                  <Status tone={s.tone}>{s.label}</Status>
                </td>
                <td>{i.planId ?? <span className="text-faint">{DASH}</span>}</td>
                <td>{i.specimenId ?? <span className="text-faint">{DASH}</span>}</td>
                <td className={i.status === 'failed' ? 'text-danger' : i.errorMessage ? 'text-subtle' : 'mono text-subtle'}>
                  {i.errorMessage ?? i.storedRelPath ?? DASH}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
