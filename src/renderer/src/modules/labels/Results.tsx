/** 엑셀 확정 · JSON 가져오기 · JSON 백업 내보내기 · 학습 데이터 내보내기 결과 알림 (닫기 전까지 남는다) */
import {
  LABEL_ENTITY_KINDS,
  type LabelExportResult,
  type LabelJsonImportResult,
  type LabelWorkbookCommitResult,
  type TrainingExportResult
} from '@shared/api'
import { formatBytes } from '@shared/ids'
import { dateTime } from '../../lib/format'
import { ENTITY_LABEL, PLAN_LABEL, PLAN_ORDER, setIdText } from './format'
import { ChangeList, MessageList } from './WorkbookPreview'

function Close({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="btn btn--ghost" onClick={onClose}>
      닫기
    </button>
  )
}

export function CommitResult({ result: r, onClose }: { result: LabelWorkbookCommitResult; onClose: () => void }) {
  const parts = PLAN_ORDER.filter((k) => r.totals[k] > 0).map((k) => `${PLAN_LABEL[k]} ${r.totals[k]}`)
  return (
    <div className="notice notice--accent" role="status">
      <div className="notice__body">
        <p className="notice__title" tabIndex={-1} data-focus-target>
          엑셀을 확정했습니다 · {parts.join(' · ') || '바뀐 것 없음'}
        </p>
        <p>
          <span className="mono">{r.fileName}</span> · {dateTime(r.committedAt)}
          {r.registeredLabelerId ? ` · 라벨러 ${r.registeredLabelerId} 를 등록했습니다` : ''}
          {r.conflictIds.length > 0 ? ` · 새 충돌 ${r.conflictIds.length}건은 아래 충돌 목록에서 고르세요` : ''}
        </p>
        {r.changes.some((c) => c.action !== 'kept') ? (
          <details className="notice__detail">
            <summary>바뀐 것 {r.changes.filter((c) => c.action !== 'kept').length}건</summary>
            <ChangeList changes={r.changes.filter((c) => c.action !== 'kept')} />
          </details>
        ) : null}
        {r.warnings.length > 0 ? (
          <details className="notice__detail">
            <summary>확인할 것 {r.warnings.length}건</summary>
            <MessageList items={r.warnings} tone="plain" />
          </details>
        ) : null}
      </div>
      <Close onClose={onClose} />
    </div>
  )
}

export function JsonImportResult({ result: r, onClose }: { result: LabelJsonImportResult; onClose: () => void }) {
  const title = r.ok
    ? `라벨 JSON 을 합쳤습니다 · 새로 ${r.created} · 갱신 ${r.updated} · 그대로 ${r.unchanged} · 충돌 ${r.conflicts}`
    : '라벨 JSON 을 합치지 못했습니다 · 아무것도 바꾸지 않았습니다'
  return (
    <div className={r.ok ? 'notice notice--accent' : 'notice notice--error'} role={r.ok ? 'status' : 'alert'}>
      <div className="notice__body">
        <p className="notice__title" tabIndex={-1} data-focus-target>
          {title}
        </p>
        <p>
          <span className="mono">{r.fileName}</span>
          {r.source ? ` · 보낸 PC ${r.source.pcId} · ${dateTime(r.source.exportedAt)} 내보냄 · 앱 ${r.source.appVersion}` : ''}
          {r.conflicts > 0 ? ' · 충돌은 아래 목록에서 고르세요' : ''}
        </p>
        {r.errors.length > 0 ? <MessageList items={r.errors} tone="error" /> : null}
        {r.ok ? (
          <details className="notice__detail">
            <summary>저장 단위별{r.warnings.length ? ` · 확인할 것 ${r.warnings.length}건` : ''}</summary>
            <table className="table table--compact labels-mini" aria-label="저장 단위별 합치기 결과">
              <thead>
                <tr>
                  <th>저장 단위</th>
                  <th className="num">새로</th>
                  <th className="num">갱신</th>
                  <th className="num">그대로</th>
                  <th className="num">충돌</th>
                </tr>
              </thead>
              <tbody>
                {(['labeler', ...LABEL_ENTITY_KINDS] as const).map((k) => {
                  const c = r.byEntity[k]
                  return (
                    <tr key={k}>
                      <td>{k === 'labeler' ? '라벨러' : ENTITY_LABEL[k]}</td>
                      <td className="num">{c.created}</td>
                      <td className="num">{c.updated}</td>
                      <td className="num">{c.unchanged}</td>
                      <td className="num">{c.conflicts}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {r.warnings.length > 0 ? <MessageList items={r.warnings} tone="plain" /> : null}
          </details>
        ) : null}
      </div>
      <Close onClose={onClose} />
    </div>
  )
}

export function ExportResult({ result: r, onClose }: { result: LabelExportResult; onClose: () => void }) {
  const c = r.counts
  return (
    <div className="notice notice--accent" role="status">
      <div className="notice__body">
        <p className="notice__title" tabIndex={-1} data-focus-target>
          라벨 JSON 백업을 내보냈습니다 · 지시 {c.records} · 검토 구간 {c.reviewIntervals} · 작업 이벤트 {c.workEvents}
        </p>
        <p className="mono break">{r.path}</p>
        {r.onlyLabelerId ? <p className="text-accent">2인 독립 모드라 {r.onlyLabelerId} 의 라벨 세트만 담았습니다.</p> : null}
        <p className="t-caption">
          {formatBytes(r.bytes)} · 이 PC {r.pcId} · 라벨러 {c.labelers} · 파일 정렬 {c.fileAlignments} · 물리 결함 {c.physicalDefects} · 관측 표{' '}
          {c.observations}. 다른 PC 의 라벨 관리에서 'JSON 가져오기'로 합칩니다.
        </p>
      </div>
      <Close onClose={onClose} />
    </div>
  )
}

export function TrainingResult({ result: r, onClose }: { result: TrainingExportResult; onClose: () => void }) {
  const t = r.totals
  const skipped = r.files.filter((f) => f.status === 'skipped')
  const blocked = r.files.flatMap((f) => f.groups.filter((g) => g.blocked).map((g) => ({ file: f.fileName, ...g })))
  return (
    <div className="notice notice--accent" role="status">
      <div className="notice__body">
        <p className="notice__title" tabIndex={-1} data-focus-target>
          학습 데이터를 내보냈습니다 · 파일 {t.exported}
          {t.skipped ? ` · 건너뜀 ${t.skipped}` : ''} · 장면 {t.scenes} · 그림 {t.images} · 상자 {t.annotations}
        </p>
        <p className="mono break">{r.path}</p>
        <p className="t-caption">
          {formatBytes(t.bytes)} · A-scan 구간 {t.ascanSpans}
          {t.blockedGroups ? ` · 막힌 그룹 ${t.blockedGroups}` : ''} · {dateTime(r.exportedAt)}. 폴더의 manifest.json 에 버전·옵션·세트 고르기·막힌 그룹 이유가
          있습니다.
        </p>
        {skipped.length > 0 || blocked.length > 0 || r.warnings.length > 0 ? (
          <MessageList
            items={[
              ...skipped.map((f) => `건너뜀: ${f.fileName} — ${f.reason ?? ''}`),
              ...blocked.map((b) => `막힌 그룹: ${b.file} 그룹 ${b.groupId} (${b.name}) — ${b.blocked ?? ''}`),
              ...r.warnings
            ]}
            tone="plain"
          />
        ) : null}
        <details className="notice__detail">
          <summary>파일별 {r.files.length}개</summary>
          <table className="table table--compact labels-mini" aria-label="파일별 학습 데이터">
            <thead>
              <tr>
                <th>파일</th>
                <th>분할</th>
                <th>세트</th>
                <th className="num">양성</th>
                <th className="num">음성</th>
                <th className="num">무시</th>
                <th className="num">그림</th>
                <th className="num">상자</th>
              </tr>
            </thead>
            <tbody>
              {r.files.map((f) => (
                <tr key={f.sha256}>
                  <td className="truncate labels-file" title={f.reason ?? f.fileName}>
                    {f.fileName}
                  </td>
                  <td>{f.split ?? '미정'}</td>
                  <td>{f.status === 'exported' ? setIdText(f.setId) : '건너뜀'}</td>
                  <td className="num">{f.trainScenes.positive}</td>
                  <td className="num">{f.trainScenes.negative}</td>
                  <td className="num">{f.trainScenes.ignore}</td>
                  <td className="num">{f.images}</td>
                  <td className="num">{f.annotations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
      <Close onClose={onClose} />
    </div>
  )
}
