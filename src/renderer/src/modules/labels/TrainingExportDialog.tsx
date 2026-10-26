/**
 * 학습 데이터 내보내기 대화상자: 대상(고른 파일 또는 분할) → 라벨 세트 고르기 규칙(확정 > 설계값 대조 > 지정 라벨러 블라인드,
 * 파일 줄에서 직접 고를 수 있음) → 옵션(원 진폭·그림·가림·약한 양성) → 폴더 고르기 → 진행률·취소.
 * 저장할 폴더는 main 의 폴더 대화상자로만 고른다. 그 안에 '학습데이터_<시각>_<PC>' 새 폴더를 만든다(덮어쓰지 않음).
 * 진행률은 main 에 짧게 되묻는다(labels:trainingStatus). 2인 독립 모드면 지금 라벨러의 세트만 고른다.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_TRAINING_EXPORT_OPTIONS,
  type LabelSession,
  type TrainSplitOrNone,
  type TrainingExportOptions,
  type TrainingExportProgress,
  type TrainingExportRequest,
  type TrainingExportResult,
  type TrainingSetRule
} from '@shared/api'
import type { ReadingStage } from '@shared/labels/types'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { ErrorNotice } from '../../components/ErrorNotice'
import { ProgressBar } from '../../components/ProgressBar'
import { Status } from '../../components/Status'
import { useAsync } from '../../lib/useAsync'
import { DASH, SPLIT_LABEL, SPLIT_ORDER, STAGE_SHORT, labelerText, setIdText } from './format'

const STAGES: readonly ReadingStage[] = ['final', 'reconciled', 'blind']

const PHASE_LABEL: Record<TrainingExportProgress['phase'], string> = {
  prepare: '준비하는 중',
  read: '진폭 읽는 중',
  derive: '라벨 계산 중',
  write: '파일 쓰는 중',
  images: '그림 만드는 중',
  finish: 'manifest 쓰는 중',
  done: '마무리하는 중'
}

/** 화면을 닫았다 열어도 앱을 끄기 전까지 남기는 옵션 */
let remembered: { options: TrainingExportOptions; stages: ReadingStage[]; blindLabelerId: string | null; splits: TrainSplitOrNone[] } | null = null

export function TrainingExportDialog(props: {
  selectedShas: string[]
  session: LabelSession
  onClose: () => void
  onDone: (r: TrainingExportResult) => void
}) {
  const api = getApi()
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const blindMode = props.session.blindMode
  const [target, setTarget] = useState<'files' | 'splits'>(props.selectedShas.length > 0 ? 'files' : 'splits')
  const [splits, setSplits] = useState<ReadonlySet<TrainSplitOrNone>>(new Set(remembered?.splits ?? ['train', 'val', 'test']))
  const [stages, setStages] = useState<ReadingStage[]>(remembered?.stages ?? ['final', 'reconciled', 'blind'])
  const [blindLabelerId, setBlindLabelerId] = useState<string | null>(
    blindMode ? props.session.labelerId : (remembered?.blindLabelerId ?? props.session.labelerId ?? null)
  )
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [options, setOptions] = useState<TrainingExportOptions>(remembered?.options ?? DEFAULT_TRAINING_EXPORT_OPTIONS)
  const [mmText, setMmText] = useState(String(options.mmPerPx))
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<TrainingExportProgress | null>(null)
  const [error, setError] = useState<{ title: string; error: UiError } | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
    return () => d?.close?.()
  }, [])

  // 시험(test) 분할은 확정 세트만 (평가 정의 1·2절) — 끄면 다른 분할과 같은 단계 순서 (결과에 경고)
  const [testFinalOnly, setTestFinalOnly] = useState(true)
  const rule: TrainingSetRule = useMemo(
    () => ({ stages, blindLabelerId: stages.includes('blind') ? blindLabelerId : null, overrides, testFinalOnly }),
    [stages, blindLabelerId, overrides, testFinalOnly]
  )
  const cands = useAsync(() => unwrap(api.labels.trainingCandidates(rule)), [JSON.stringify(rule)])

  const picked = new Set(props.selectedShas)
  const rows = (cands.data?.files ?? []).filter((f) => (target === 'files' ? picked.has(f.sha256) : splits.has(f.split ?? 'unassigned')))
  const ready = rows.filter((f) => f.chosen !== null && f.hasFile)
  const mm = Number(mmText.replace(',', '.'))
  const mmBad = options.images && !(mm >= 0.02 && mm <= 2)

  // 진행률: 내보내는 동안 0.3초마다 되묻는다
  useEffect(() => {
    if (!running) return
    let alive = true
    const t = setInterval(() => {
      void api.labels.trainingStatus().then((r) => {
        if (alive && r.ok && r.data) setProgress(r.data)
      })
    }, 300)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [running])

  const start = async (): Promise<void> => {
    setError(null)
    setNote(null)
    let dir: string | null
    try {
      dir = await unwrap(api.labels.chooseTrainingDir())
    } catch (e) {
      setError({ title: '폴더를 고르지 못했습니다', error: toUiError(e) })
      return
    }
    if (!dir) return
    const opts: TrainingExportOptions = { ...options, mmPerPx: options.images ? mm : options.mmPerPx }
    remembered = { options: opts, stages, blindLabelerId, splits: [...splits] }
    const req: TrainingExportRequest =
      target === 'files' ? { sha256s: [...picked], setRule: rule, options: opts } : { splits: [...splits], setRule: rule, options: opts }
    setRunning(true)
    setProgress(null)
    try {
      const r = await unwrap(api.labels.exportTraining(req, dir))
      props.onDone(r)
    } catch (e) {
      const ui = toUiError(e)
      if (ui.code === 'CANCELLED') setNote('내보내기를 취소했습니다. 만들던 폴더는 지웠습니다.')
      else setError({ title: '학습 데이터를 내보내지 못했습니다', error: ui })
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const cancel = (): void => {
    if (progress) void api.labels.cancelTraining(progress.operationId)
  }

  const toggleStage = (s: ReadingStage): void => setStages((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : STAGES.filter((x) => x === s || cur.includes(x))))
  const opt = <K extends keyof TrainingExportOptions>(k: K, v: TrainingExportOptions[K]): void => setOptions((o) => ({ ...o, [k]: v }))

  return (
    <dialog
      ref={ref}
      className="dialog dialog--wide labels-train"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault()
        if (!running) props.onClose()
      }}
    >
      <h2 className="dialog__title" id={`${id}-t`}>
        학습 데이터를 내보냅니다
      </h2>
      <div className="dialog__body">
        <p className="t-caption">
          고른 라벨 세트로 장면·A-scan 라벨과 상자를 계산해 파일마다 폴더로 씁니다(원 진폭 .npy, S-scan 그림 PNG, COCO·YOLO, manifest). 대조 전 그룹과 U
          오프셋이 0 이 아닌 그룹은 내보내지 않고 이유를 manifest 에 적습니다.
        </p>

        <fieldset className="labels-train__group" disabled={running}>
          <legend className="labels-subtitle">대상</legend>
          <div className="labels-train__row" role="radiogroup" aria-label="대상">
            <label className="check">
              <input type="radio" name={`${id}-target`} checked={target === 'files'} disabled={props.selectedShas.length === 0} onChange={() => setTarget('files')} />
              <span>
                고른 파일 <span className="t-caption">{props.selectedShas.length > 0 ? `${props.selectedShas.length}개` : '파일별 현황 표에서 먼저 고르세요'}</span>
              </span>
            </label>
            <label className="check">
              <input type="radio" name={`${id}-target`} checked={target === 'splits'} onChange={() => setTarget('splits')} />
              <span>분할로 고르기</span>
            </label>
            {target === 'splits'
              ? SPLIT_ORDER.map((s) => (
                  <label key={s} className="check">
                    <input
                      type="checkbox"
                      checked={splits.has(s)}
                      onChange={() => {
                        const n = new Set(splits)
                        if (!n.delete(s)) n.add(s)
                        setSplits(n)
                      }}
                    />
                    <span>{SPLIT_LABEL[s]}</span>
                  </label>
                ))
              : null}
          </div>
        </fieldset>

        <fieldset className="labels-train__group" disabled={running}>
          <legend className="labels-subtitle">라벨 세트 고르기</legend>
          <div className="labels-train__row">
            <span className="t-caption">우선순위</span>
            {STAGES.map((s, i) => (
              <label key={s} className="check">
                <input type="checkbox" checked={stages.includes(s)} onChange={() => toggleStage(s)} />
                <span>
                  {STAGE_SHORT[s]}
                  {i < STAGES.length - 1 ? <span className="text-faint"> ›</span> : null}
                </span>
              </label>
            ))}
            <label className="labels-train__inline">
              <span className="t-caption">블라인드 라벨러</span>
              <span className="select">
                <select
                  value={blindLabelerId ?? ''}
                  disabled={!stages.includes('blind') || blindMode}
                  onChange={(e) => setBlindLabelerId(e.target.value || null)}
                >
                  <option value="">지정하지 않음</option>
                  {props.session.labelers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {labelerText(l.id, l.name)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          {blindMode ? (
            <p className="t-caption text-accent">2인 독립 모드라 지금 라벨러({props.session.labelerId ?? '고르지 않음'})의 세트만 고릅니다.</p>
          ) : null}
          {cands.error ? <ErrorNotice title="세트 고르기를 계산하지 못했습니다" error={cands.error} onRetry={cands.reload} /> : null}
          <div className="table-wrap labels-train__files">
            <table className="table table--compact labels-mini" aria-label="파일마다 고른 라벨 세트">
              <thead>
                <tr>
                  <th>파일</th>
                  <th>시편</th>
                  <th>분할</th>
                  <th>세트</th>
                  <th>고른 이유</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-subtle">
                      {!cands.data
                        ? '계산하는 중입니다.'
                        : target === 'splits' && !splits.has('unassigned') && cands.data.files.some((f) => f.split === null)
                          ? `고른 분할에 라벨 있는 파일이 없습니다. 분할을 정하지 않은 시편의 파일 ${cands.data.files.filter((f) => f.split === null).length}개는 '정하지 않음'을 고르면 들어갑니다.`
                          : '대상에 라벨 있는 파일이 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((f) => (
                    <tr key={f.sha256}>
                      <td className="truncate labels-train__file" title={`${f.fileName}\nSHA-256 ${f.sha256}`}>
                        {f.fileName}
                        {!f.hasFile ? (
                          <>
                            {' '}
                            <Status tone="muted">파일 없음</Status>
                          </>
                        ) : null}
                      </td>
                      <td>{f.specimenId ?? <span className="text-faint">{DASH}</span>}</td>
                      <td>{f.split ?? <span className="text-faint">미정</span>}</td>
                      <td>
                        <span className="select labels-train__set">
                          <select
                            aria-label={`${f.fileName} 라벨 세트`}
                            value={overrides[f.sha256] ?? ''}
                            onChange={(e) => {
                              const n = { ...overrides }
                              if (e.target.value) n[f.sha256] = e.target.value
                              else delete n[f.sha256]
                              setOverrides(n)
                            }}
                          >
                            <option value="">규칙대로</option>
                            {f.candidates.map((c) => (
                              <option key={c.setId} value={c.setId}>
                                {setIdText(c.setId)} · 결함 {c.defectCount}
                                {c.pendingConflicts ? ` · 충돌 ${c.pendingConflicts}` : ''}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                      <td className="labels-reason">
                        {f.chosen ? (
                          <span className="text-subtle">{overrides[f.sha256] ? `직접 고름 (${setIdText(f.chosen)})` : f.reason}</span>
                        ) : (
                          <Status tone="attention">{f.reason}</Status>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="t-caption">
            내보낼 파일 {ready.length}개{rows.length > ready.length ? ` · 세트를 고르지 못했거나 사본이 없어 건너뛸 파일 ${rows.length - ready.length}개` : ''}
          </p>
        </fieldset>

        <fieldset className="labels-train__group" disabled={running}>
          <legend className="labels-subtitle">옵션</legend>
          <div className="labels-train__row">
            <label className="check">
              <input type="checkbox" checked={options.amplitude} onChange={(e) => opt('amplitude', e.target.checked)} />
              <span>원 진폭 (.npy, 파일 이득 그대로)</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={options.images} onChange={(e) => opt('images', e.target.checked)} />
              <span>S-scan 그림 + COCO·YOLO</span>
            </label>
            <label className="labels-train__inline">
              <input
                className="input input--num"
                inputMode="decimal"
                aria-label="그림 화소 크기 (mm)"
                aria-invalid={mmBad}
                disabled={!options.images}
                value={mmText}
                onChange={(e) => setMmText(e.target.value)}
              />
              <span className="t-caption">mm/px</span>
            </label>
          </div>
          {mmBad ? <p className="field__error">화소 크기는 0.02 ~ 2 mm 사이로 적습니다.</p> : null}
          <div className="labels-train__row" role="radiogroup" aria-label="무시 구역">
            <span className="t-caption">무시 구역</span>
            <label className="check" title="그림은 늘 원본 + 가림 그림(masks/) + COCO 무시 영역. 학습(train) 분할에만 검게 칠한 판을 더 내고 YOLO 목록이 그것을 씀 (val·test 는 원본)">
              <input type="radio" name={`${id}-mask`} checked={options.maskMode === 'blackout'} disabled={!options.images} onChange={() => opt('maskMode', 'blackout')} />
              <span>train 만 검게 가림</span>
            </label>
            <label className="check" title="검게 칠한 판을 내지 않음 — 가림은 masks/·COCO 무시 영역으로만">
              <input type="radio" name={`${id}-mask`} checked={options.maskMode === 'separate'} disabled={!options.images} onChange={() => opt('maskMode', 'separate')} />
              <span>가림 그림만 따로</span>
            </label>
            <label className="check" title="평가 기준 이상 신호가 있는 무시 객체('안 보임' 레그 제외)가 있는 장면을 그림에서 뺌">
              <input type="radio" name={`${id}-mask`} checked={options.maskMode === 'exclude'} disabled={!options.images} onChange={() => opt('maskMode', 'exclude')} />
              <span>그 장면을 그림에서 뺌</span>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={testFinalOnly} onChange={(e) => setTestFinalOnly(e.target.checked)} />
            <span>시험(test) 분할은 확정 세트만 (AI 평가 정답 — 끄면 블라인드·대조 세트도 고르고 경고를 남김)</span>
          </label>
          <div className="labels-train__row" role="radiogroup" aria-label="약한 양성">
            <span className="t-caption">약한 양성</span>
            <label className="check">
              <input type="radio" name={`${id}-weak`} checked={options.weakAs === 'ignore'} onChange={() => opt('weakAs', 'ignore')} />
              <span>무시 (기본, 확인 대기)</span>
            </label>
            <label className="check">
              <input type="radio" name={`${id}-weak`} checked={options.weakAs === 'positive'} onChange={() => opt('weakAs', 'positive')} />
              <span>양성</span>
            </label>
          </div>
          <div className="labels-train__row" role="radiogroup" aria-label="계산만 한 관측의 양성">
            <span className="t-caption">계산만 한 관측의 양성</span>
            <label className="check">
              <input
                type="radio"
                name={`${id}-obs`}
                checked={options.unconfirmedObservation === 'keep'}
                onChange={() => opt('unconfirmedObservation', 'keep')}
              />
              <span>그대로 (표시만)</span>
            </label>
            <label className="check">
              <input
                type="radio"
                name={`${id}-obs`}
                checked={options.unconfirmedObservation === 'ignore'}
                onChange={() => opt('unconfirmedObservation', 'ignore')}
              />
              <span>무시</span>
            </label>
          </div>
        </fieldset>

        {running ? (
          <ProgressBar
            label={progress ? PHASE_LABEL[progress.phase] : '시작하는 중'}
            detail={
              progress?.fileName
                ? `${progress.fileName}${progress.imagesTotal ? ` · 그림 ${progress.imagesDone} / ${progress.imagesTotal}` : ''}${progress.cancelling ? ' · 취소하는 중' : ''}`
                : undefined
            }
            current={progress?.current ?? 0}
            total={progress?.total ?? 0}
          />
        ) : null}
        {note ? (
          <p className="text-accent" role="status">
            {note}
          </p>
        ) : null}
        {error ? <ErrorNotice title={error.title} error={error.error} /> : null}
      </div>
      <div className="dialog__actions">
        {running ? (
          <button type="button" className="btn btn--secondary" disabled={!progress || progress.cancelling} onClick={cancel}>
            내보내기 취소
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--secondary" onClick={props.onClose}>
              닫기
            </button>
            <button type="button" className="btn btn--primary" disabled={ready.length === 0 || mmBad || stages.length === 0} onClick={() => void start()}>
              폴더 고르고 내보내기
            </button>
          </>
        )}
      </div>
    </dialog>
  )
}
