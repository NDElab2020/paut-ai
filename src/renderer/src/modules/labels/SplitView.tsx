/**
 * 학습 데이터 분할: 시편마다 train · val · test 를 정하고 시험 세트를 잠근다.
 * 시편 단위라 같은 시편의 모든 파일(재스캔·양쪽 스큐)이 같은 쪽에 간다. 이 저장소에만 저장된다(JSON 백업에는 없음).
 * 시험 세트가 잠겨 있으면 test 로 넣거나 빼는 변경과 잠금 풀기는 이유를 적고 한 번 더 확인한다(바꾼 기록에 남음).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { TrainSplit, TrainSplitOrNone, TrainingSplitChange, TrainingSplitView } from '@shared/api'
import { josa, matchesAllTerms } from '@shared/text'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Status, Tag } from '../../components/Status'
import { dateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { DASH, SPLIT_LABEL, SPLIT_ORDER } from './format'

type Ask =
  | { kind: 'changes'; changes: TrainingSplitChange[]; what: string }
  | { kind: 'unlock' }

/** 이유를 적고 확인하는 대화상자 (잠긴 시험 세트 바꾸기 · 잠금 풀기) */
/** 잠긴 시험 세트 확인 문장의 앞부분 ('… 바꾸면 시험 세트가 달라집니다'): 받침에 맞는 조사(josa), 분할 이름 뒤는 '쪽으로' */
function splitChangeText(target: string, split: TrainSplitOrNone): string {
  return split === 'unassigned' ? `${target}의 분할을 풀어 '${SPLIT_LABEL.unassigned}'으로` : `${josa(target, '을/를')} ${SPLIT_LABEL[split]} 쪽으로`
}

function ReasonDialog(props: { title: string; body: string; action: string; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [reason, setReason] = useState('')
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
    return () => d?.close?.()
  }, [])
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault()
        props.onCancel()
      }}
    >
      <h2 className="dialog__title" id={`${id}-t`}>
        {props.title}
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim()) props.onConfirm(reason.trim())
        }}
      >
        <div className="dialog__body">
          <p>{props.body}</p>
          <label className="field">
            <span className="field__label">이유 (바꾼 기록에 남습니다)</span>
            <textarea className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onCancel}>
            취소
          </button>
          <button type="submit" className="btn btn--primary" disabled={props.busy || reason.trim() === ''}>
            {props.action}
          </button>
        </div>
      </form>
    </dialog>
  )
}

const LOG_ACTION: Record<TrainingSplitView['log'][number]['action'], string> = {
  assign: '분할 바꿈',
  'locked-change': '잠긴 시험 세트 바꿈',
  lock: '시험 세트 잠금',
  unlock: '잠금 풀기'
}

const splitText = (s: TrainSplit | null): string => SPLIT_LABEL[s ?? 'unassigned']

export function SplitView({ version, query }: { version: number; query: string }) {
  const api = getApi()
  const ids = useId()
  const view = useAsync(() => unwrap(api.labels.trainingSplits()), [version])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; error: UiError } | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [bulk, setBulk] = useState<TrainSplit | ''>('train')
  const [shown, setShown] = useState<TrainingSplitView | null>(null)
  const data = shown ?? view.data

  useEffect(() => setShown(null), [view.data])

  const call = async (title: string, fn: () => Promise<TrainingSplitView>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      setShown(await fn())
      return true
    } catch (e) {
      setError({ title, error: toUiError(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  /** 분할 바꾸기: 잠긴 시험 세트를 건드리면 먼저 이유를 묻는다 */
  const change = (changes: TrainingSplitChange[], what: string): void => {
    if (!data || changes.length === 0) return
    const cur = new Map(data.specimens.map((r) => [r.specimenId, r.split]))
    const touchesTest = changes.some((c) => c.split === 'test' || cur.get(c.specimenId) === 'test')
    if (data.testLocked && touchesTest) setAsk({ kind: 'changes', changes, what })
    else void call('분할을 바꾸지 못했습니다', () => unwrap(api.labels.setTrainingSplits(changes)))
  }

  const q = query.trim().normalize('NFC')
  const rows = useMemo(
    () => (data ? data.specimens.filter((r) => !q || matchesAllTerms([r.specimenId, ...r.planIds, r.split ?? ''], q)) : []),
    [data, q]
  )
  const pickedRows = rows.filter((r) => picked.has(r.specimenId))
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.specimenId))

  if (view.error) return <ErrorNotice title="학습 데이터 분할을 읽지 못했습니다" error={view.error} onRetry={view.reload} />
  if (!data) return <p className="text-subtle loading-line">분할을 읽는 중입니다.</p>

  return (
    <section className="labels-split" aria-labelledby={`${ids}-title`}>
      <div className="toolbar">
        {/* 탭 이름과 같아 글자는 숨기고 화면 읽기 프로그램에만 */}
        <h2 className="visually-hidden" id={`${ids}-title`}>
          학습 데이터 분할
        </h2>
        <span className="toolbar__count">
          {SPLIT_ORDER.map((s) => `${s === 'unassigned' ? '정하지 않음' : s} ${data.counts[s]}`).join(' · ')}
          {q ? ` · 검색 ${rows.length}` : ''}
        </span>
        <span className="toolbar__spacer" />
        {data.testLocked ? (
          <Status tone="ok" title={data.testLockedAt ? `${dateTime(data.testLockedAt)} · ${data.testLockedBy ?? ''}` : undefined}>
            시험 세트 잠김
          </Status>
        ) : (
          <Status tone="muted">시험 세트 잠그지 않음</Status>
        )}
        {data.testLocked ? (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setAsk({ kind: 'unlock' })}>
            잠금 풀기
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || data.counts.test === 0}
            title={data.counts.test === 0 ? 'test 로 정한 시편이 없습니다' : undefined}
            onClick={() => void call('시험 세트를 잠그지 못했습니다', () => unwrap(api.labels.lockTrainingTest(true)))}
          >
            시험 세트 잠그기
          </button>
        )}
      </div>
      <p className="t-caption labels-split__desc">
        시편 단위로 나눕니다. 같은 시편의 모든 파일(재스캔·양쪽 스큐·다른 이득)이 같은 쪽에 갑니다. 시험 세트를 잠그면 test 를 바꿀 때 이유를 적고 기록에
        남깁니다. 분할은 이 저장소에만 저장되고 JSON 백업에는 담기지 않습니다.
      </p>

      {error ? <ErrorNotice title={error.title} error={error.error} /> : null}

      {data.specimens.length === 0 ? (
        <EmptyState title="시편이 없습니다" desc="NDE·OPD 파일을 가져오면 시편마다 분할을 정할 수 있습니다." />
      ) : (
        <>
          <div className="labels-bulk" role="group" aria-label="고른 시편 분할 바꾸기">
            <span>고른 시편 {pickedRows.length}개를</span>
            <span className="select">
              <select aria-label="바꿀 분할" value={bulk} onChange={(e) => setBulk(e.target.value as TrainSplit | '')}>
                <option value="train">{SPLIT_LABEL.train}</option>
                <option value="val">{SPLIT_LABEL.val}</option>
                <option value="test">{SPLIT_LABEL.test}</option>
                <option value="">{SPLIT_LABEL.unassigned}</option>
              </select>
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy || pickedRows.length === 0}
              onClick={() => {
                change(
                  pickedRows.map((r) => ({ specimenId: r.specimenId, split: bulk === '' ? null : bulk })),
                  splitChangeText(`고른 시편 ${pickedRows.length}개`, bulk === '' ? 'unassigned' : bulk)
                )
              }}
            >
              분할 바꾸기
            </button>
            {picked.size > 0 ? (
              <button type="button" className="btn btn--ghost" onClick={() => setPicked(new Set())}>
                고르기 지우기
              </button>
            ) : null}
          </div>
          <div className="table-wrap">
            <table className="table labels-split-table" aria-label="시편별 분할">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="보이는 시편 모두 고르기"
                      checked={allOn}
                      onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.specimenId)))}
                    />
                  </th>
                  <th>시편</th>
                  <th>스캔플랜</th>
                  <th className="num">파일</th>
                  <th className="num">라벨 있는 파일</th>
                  <th className="num">결함 기록</th>
                  <th className="num">물리 결함</th>
                  <th>분할</th>
                  <th>정한 때</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.specimenId} className={picked.has(r.specimenId) ? 'is-selected' : undefined}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        aria-label={`${r.specimenId} 고르기`}
                        checked={picked.has(r.specimenId)}
                        onChange={() => {
                          const n = new Set(picked)
                          if (!n.delete(r.specimenId)) n.add(r.specimenId)
                          setPicked(n)
                        }}
                      />
                    </td>
                    <td className="is-primary">{r.specimenId}</td>
                    <td className="truncate labels-plan" title={r.planIds.join(', ')}>
                      {r.planIds.length ? r.planIds.join(', ') : <span className="text-faint">{DASH}</span>}
                    </td>
                    <td className="num">{r.fileCount}</td>
                    <td className="num">{r.labeledFileCount || <span className="text-subtle">0</span>}</td>
                    <td className="num">{r.defectCount || <span className="text-subtle">0</span>}</td>
                    <td className="num">{r.physicalDefectCount || <span className="text-subtle">0</span>}</td>
                    <td>
                      <span className="select labels-split-select">
                        <select
                          aria-label={`${r.specimenId} 분할`}
                          value={r.split ?? ''}
                          disabled={busy}
                          onChange={(e) => {
                            const v = e.target.value as TrainSplit | ''
                            change([{ specimenId: r.specimenId, split: v === '' ? null : v }], splitChangeText(r.specimenId, v === '' ? 'unassigned' : v))
                          }}
                        >
                          <option value="">{SPLIT_LABEL.unassigned}</option>
                          <option value="train">{SPLIT_LABEL.train}</option>
                          <option value="val">{SPLIT_LABEL.val}</option>
                          <option value="test">{SPLIT_LABEL.test}</option>
                        </select>
                      </span>
                      {r.split === 'test' && data.testLocked ? (
                        <>
                          {' '}
                          <Tag>잠김</Tag>
                        </>
                      ) : null}
                    </td>
                    <td className="text-subtle">{r.assignedAt ? dateTime(r.assignedAt) : <span className="text-faint">{DASH}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.log.length > 0 ? (
        <details className="labels-split-log">
          <summary>바꾼 기록 {data.log.length}줄 (최근 것이 위)</summary>
          <table className="table table--compact labels-mini" aria-label="분할을 바꾼 기록">
            <thead>
              <tr>
                <th>시각</th>
                <th>누가</th>
                <th>무엇</th>
                <th>시편</th>
                <th>바뀜</th>
                <th>이유</th>
              </tr>
            </thead>
            <tbody>
              {data.log.map((e, i) => (
                <tr key={i}>
                  <td className="labels-split-log__at">{dateTime(e.at)}</td>
                  <td>{e.labelerId ?? e.pcId}</td>
                  <td>{LOG_ACTION[e.action]}</td>
                  <td>{e.specimenId ?? <span className="text-faint">{DASH}</span>}</td>
                  <td>{e.specimenId ? `${splitText(e.from)} → ${splitText(e.to)}` : <span className="text-faint">{DASH}</span>}</td>
                  <td className="labels-reason">{e.reason ?? <span className="text-faint">{DASH}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {ask?.kind === 'changes' ? (
        <ReasonDialog
          title="잠긴 시험 세트를 바꿉니다"
          body={`${ask.what} 바꾸면 시험 세트가 달라집니다. 왜 바꾸는지 적으면 바꾼 기록에 남깁니다.`}
          action="바꾸고 기록 남기기"
          busy={busy}
          onCancel={() => setAsk(null)}
          onConfirm={(reason) => {
            const changes = ask.changes
            setAsk(null)
            void call('분할을 바꾸지 못했습니다', () => unwrap(api.labels.setTrainingSplits(changes, { confirmLocked: true, reason })))
          }}
        />
      ) : null}
      {ask?.kind === 'unlock' ? (
        <ReasonDialog
          title="시험 세트 잠금을 풉니다"
          body="잠금을 풀면 test 시편을 확인 없이 바꿀 수 있습니다. 왜 푸는지 적으면 바꾼 기록에 남깁니다."
          action="잠금 풀고 기록 남기기"
          busy={busy}
          onCancel={() => setAsk(null)}
          onConfirm={(reason) => {
            setAsk(null)
            void call('잠금을 풀지 못했습니다', () => unwrap(api.labels.lockTrainingTest(false, { confirmLocked: true, reason })))
          }}
        />
      ) : null}
    </section>
  )
}
