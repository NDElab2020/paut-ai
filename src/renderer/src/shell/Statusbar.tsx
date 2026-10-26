import { PHASE_LABEL } from '../lib/format'
import { useApp } from '../state/AppContext'

/** 하단 상태줄: 저장소 · 전체 개수 · 진행 중 작업 · 네트워크 미사용 */
export function Statusbar() {
  const { settings, totals, progress, info } = useApp()
  return (
    <footer className="statusbar">
      <span className="mono truncate statusbar__path" title={settings?.storeRoot ?? undefined}>
        {settings?.storeRoot ?? '저장소 미설정'}
      </span>
      {totals ? (
        <span className="num">
          플랜 {totals.plans} · 시편 {totals.specimens} · 파일 {totals.files}
        </span>
      ) : null}
      <span className="statusbar__spacer" />
      {progress ? (
        <span className="num" aria-live="polite">
          {progress.operation === 'analyze' ? '분석' : '가져오기'} · {PHASE_LABEL[progress.phase]}
          {progress.total > 0 ? ` ${Math.min(progress.current + 1, progress.total)} / ${progress.total}` : ''}
        </span>
      ) : null}
      <span>{info?.mock ? '브라우저 미리보기 · 가짜 데이터' : '네트워크 사용 안 함'}</span>
    </footer>
  )
}
