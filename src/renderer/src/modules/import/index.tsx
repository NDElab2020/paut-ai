/** 가져오기: 드롭 → 분석 진행률 → 판정 미리보기(편집) → 저장소에 복사 → 결과 요약 */
import { useEffect, useRef } from 'react'
import type { UiError } from '../../api'
import type { ModuleProps } from '@shared/modules'
import { ErrorNotice } from '../../components/ErrorNotice'
import { ProgressBar } from '../../components/ProgressBar'
import { StoreRootEmpty } from '../../components/StoreRootEmpty'
import { PHASE_LABEL } from '../../lib/format'
import { useApp } from '../../state/AppContext'
import { Dropzone } from './Dropzone'
import { PreviewView } from './PreviewView'
import { ResultView } from './ResultView'
import { cancel, useImportState } from './store'

function Working({ title, label, detail, current, total }: { title: string; label: string; detail?: string; current: number; total: number }) {
  return (
    <section className="panel working" aria-live="polite">
      <h2 className="panel__title" tabIndex={-1} data-focus-target>
        {title}
      </h2>
      <ProgressBar label={label} detail={detail} current={current} total={total} />
      <div className="working__actions">
        <button type="button" className="btn btn--secondary" onClick={cancel}>
          취소
        </button>
      </div>
    </section>
  )
}

/** 사용자가 직접 멈춘 것은 오류가 아니다 → 중립 알림(role=status) */
function IdleNotice({ notice }: { notice: UiError }) {
  if (notice.code !== 'CANCELLED') return <ErrorNotice title="파일을 분석하지 못했습니다" error={notice} />
  return (
    <div className="notice" role="status">
      <div className="notice__body">
        <p className="notice__title" tabIndex={-1} data-focus-target>
          분석을 멈췄습니다
        </p>
        <p>다시 고르면 처음부터 분석합니다.</p>
      </div>
    </div>
  )
}

export default function ImportModule({ navigate }: ModuleProps) {
  const { settings, bumpData } = useApp()
  const st = useImportState()
  const lastBatch = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const prevKind = useRef(st.kind)

  // 화면 단계가 바뀌면 누른 버튼이 사라지므로 새 단계의 제목(또는 첫 조작 요소)으로 포커스를 옮긴다
  useEffect(() => {
    if (prevKind.current === st.kind) return
    prevKind.current = st.kind
    const root = rootRef.current
    const target =
      root?.querySelector<HTMLElement>('[data-focus-target]') ?? root?.querySelector<HTMLElement>('.dropzone button, button, [tabindex="0"]')
    target?.focus()
  }, [st.kind])

  useEffect(() => {
    if (st.kind === 'done' && lastBatch.current !== st.result.batchId) {
      lastBatch.current = st.result.batchId
      bumpData()
    }
  }, [st, bumpData])

  if (settings && !settings.storeRoot) return <StoreRootEmpty />

  return (
    <div className="import" ref={rootRef}>
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">가져오기</h1>
          <p className="page-header__desc">원본은 바꾸지 않고 저장소로 복사합니다. 같은 파일(SHA-256)은 한 번만 들어갑니다.</p>
        </div>
      </div>

      {st.kind === 'idle' ? (
        <>
          {st.notice ? <IdleNotice notice={st.notice} /> : null}
          <Dropzone />
        </>
      ) : null}

      {st.kind === 'analyzing' ? (
        <Working
          title={`${st.paths.length}곳에서 NDE·OPD 파일을 분석합니다`}
          label={st.progress ? PHASE_LABEL[st.progress.phase] : '준비 중'}
          detail={st.progress?.fileName ?? st.paths[0]}
          current={st.progress ? Math.min(st.progress.current + 1, st.progress.total) : 0}
          total={st.progress?.total ?? 0}
        />
      ) : null}

      {st.kind === 'preview' ? <PreviewView preview={st.preview} edits={st.edits} error={st.error} /> : null}

      {st.kind === 'committing' ? (
        <Working
          title="저장소에 복사하고 있습니다"
          label={st.progress ? PHASE_LABEL[st.progress.phase] : '준비 중'}
          detail={st.progress?.fileName}
          current={st.progress ? Math.min(st.progress.current + 1, st.progress.total) : 0}
          total={st.progress?.total ?? 0}
        />
      ) : null}

      {st.kind === 'done' ? <ResultView result={st.result} navigate={navigate} /> : null}
    </div>
  )
}
