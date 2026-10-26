/** 가져오기 이력: 배치 목록(시각·원본 위치·결과 수). 펼치면 항목별 결과 */
import { Fragment, useState } from 'react'
import type { ModuleProps } from '@shared/modules'
import type { ImportHistoryEntry } from '@shared/types'
import { formatBytes } from '@shared/ids'
import { getApi, unwrap } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import { Status } from '../../components/Status'
import { StoreRootEmpty } from '../../components/StoreRootEmpty'
import { BATCH_STATUS, DASH, dateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { useApp } from '../../state/AppContext'
import { ResultTable } from '../import/ResultView'
import { sessionResults } from '../import/store'

const COLS = 7

function BatchItems({ entry, navigate }: { entry: ImportHistoryEntry; navigate: ModuleProps['navigate'] }) {
  const session = sessionResults.get(entry.batchId)
  const files = useAsync(
    () => (session ? Promise.resolve(null) : unwrap(getApi().files.list({ limit: 1000, sort: 'fileName-asc' }))),
    [entry.batchId]
  )
  if (session) return <ResultTable result={session} />
  if (files.error) return <ErrorNotice title="항목별 결과를 읽지 못했습니다" error={files.error} onRetry={files.reload} />
  if (!files.data) return <p className="text-subtle loading-line">항목을 읽는 중입니다.</p>
  const mine = files.data.items.filter((f) => f.importBatchId === entry.batchId)
  return (
    <div className="stack history-items">
      <div className="table-wrap">
        <table className="table table--compact" aria-label="복사된 파일">
          <thead>
            <tr>
              <th>파일</th>
              <th>결과</th>
              <th>스캔플랜</th>
              <th>시편</th>
              <th>저장 위치</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((f) => (
              <tr key={f.id}>
                <td className="is-primary">{f.storedFileName}</td>
                <td>
                  <Status tone="ok">복사됨</Status>
                </td>
                <td>
                  <button type="button" className="btn btn--link" onClick={() => navigate('plans', { planId: f.planId })}>
                    {f.planId}
                  </button>
                </td>
                <td>{f.specimenId}</td>
                <td className="mono text-subtle">{f.storedRelPath}</td>
              </tr>
            ))}
            {mine.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-subtle">
                  이 배치로 저장소에 남아 있는 파일이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {entry.status === 'interrupted' ? (
        <p className="setup-panel__note">
          앱이 끝나기 전에 멈춘 배치입니다(강제 종료 등). 기록까지 끝난 파일만 저장소에 남았고, 다시 가져오면 나머지를 이어서 복사합니다.
        </p>
      ) : null}
      {entry.skippedCount + entry.failedCount > 0 ? (
        <p className="setup-panel__note">
          건너뜀 {entry.skippedCount}개 · 실패 {entry.failedCount}개는 개수만 기록되어 있습니다. 같은 세션에서 가져온 배치는 항목마다 사유가 보입니다.
        </p>
      ) : null}
    </div>
  )
}

export default function HistoryModule({ navigate }: ModuleProps) {
  const { settings, dataVersion, progress } = useApp()
  const storeRoot = settings?.storeRoot ?? null
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const hist = useAsync(() => (storeRoot ? unwrap(getApi().import.history()) : Promise.resolve(null)), [storeRoot, dataVersion])

  if (settings && !storeRoot) return <StoreRootEmpty />
  const toggle = (id: string): void =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const entries = hist.data ?? []

  return (
    <div>
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">가져오기 이력</h1>
          <p className="page-header__desc">언제 어디서 무엇을 가져왔는지 기록합니다. 줄을 펼치면 파일별 결과가 보입니다.</p>
        </div>
      </div>
      {hist.error ? <ErrorNotice title="가져오기 이력을 읽지 못했습니다" error={hist.error} onRetry={hist.reload} /> : null}
      {hist.data && entries.length === 0 ? (
        <EmptyState icon="empty" title="가져오기 기록이 없습니다" desc="NDE·OPD 파일을 가져오면 배치마다 시각·원본 위치·결과가 여기에 남습니다." />
      ) : null}
      {entries.length > 0 ? (
        <div className="table-wrap">
          <table className="table history-table" aria-label="가져오기 배치">
            <thead>
              <tr>
                <th className="col-check">
                  <span className="visually-hidden">펼치기</span>
                </th>
                <th>시각</th>
                <th>원본 위치</th>
                <th>상태</th>
                <th className="num">복사 · 건너뜀 · 실패</th>
                <th>새 플랜</th>
                <th className="num">용량</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isOpen = open.has(e.batchId)
                const running = e.finishedAt === null && progress?.operation === 'commit' && progress.operationId === e.batchId
                const st = running ? { label: '진행 중', tone: 'attention' as const } : BATCH_STATUS[e.status]
                return (
                  <Fragment key={e.batchId}>
                    <tr className={isOpen ? 'is-selected' : undefined} onClick={() => toggle(e.batchId)}>
                      <td className="col-check">
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon btn--sm"
                          aria-expanded={isOpen}
                          aria-label={`${dateTime(e.startedAt)} 배치 ${isOpen ? '접기' : '펼치기'}`}
                          onClick={(ev) => {
                            ev.stopPropagation()
                            toggle(e.batchId)
                          }}
                        >
                          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
                        </button>
                      </td>
                      <td className="tnum is-primary">{dateTime(e.startedAt)}</td>
                      <td className="mono truncate history-src" title={e.inputPaths.join('\n')}>
                        {e.inputPaths[0] ?? DASH}
                        {e.inputPaths.length > 1 ? ` 외 ${e.inputPaths.length - 1}곳` : ''}
                      </td>
                      <td>
                        <Status tone={st.tone}>{st.label}</Status>
                      </td>
                      <td className="num">
                        {e.copiedCount} · {e.skippedCount} · <span className={e.failedCount ? 'text-danger' : undefined}>{e.failedCount}</span>
                      </td>
                      <td>{e.createdPlanIds.length ? e.createdPlanIds.join(', ') : <span className="text-faint">{DASH}</span>}</td>
                      <td className="num">{formatBytes(e.totalBytes)}</td>
                    </tr>
                    {isOpen ? (
                      <tr className="detail-row">
                        <td colSpan={COLS}>
                          <BatchItems entry={e} navigate={navigate} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
