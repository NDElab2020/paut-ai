import { useState } from 'react'
import type { SpecimenRegroupResult } from '@shared/api'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { ErrorNotice } from '../../components/ErrorNotice'
import { useAsync } from '../../lib/useAsync'
import { useApp } from '../../state/AppContext'

/**
 * 시편 다시 묶기 (core/service/specimenRegroup.ts). 파일명을 임시 시편 ID 로 받은 파일 가운데
 * 지금 패턴(PL·TP·TF 번호)으로 시편 번호가 나오는 것이 있으면 알리고, 미리보기에서 확인한 뒤 옮긴다.
 * 파일 사본은 그대로 두고 카탈로그의 시편만 바꾼다.
 */
export function RegroupNotice({ storeRoot }: { storeRoot: string }) {
  const api = getApi()
  const { dataVersion, bumpData } = useApp()
  const preview = useAsync(() => unwrap(api.specimens.regroupPreview()), [storeRoot, dataVersion])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UiError | null>(null)
  const [done, setDone] = useState<SpecimenRegroupResult | null>(null)
  const items = preview.data?.items ?? []
  const movable = items.filter((i) => i.blocked === null)

  if (done && !open) {
    return (
      <div className="notice notice--accent" role="status">
        <div className="notice__body">
          <p className="notice__title">시편을 다시 묶었습니다</p>
          <p>
            파일 {done.moved}개를 옮겼습니다{done.skipped ? ` (건너뜀 ${done.skipped}개)` : ''}. 새 시편 {done.createdSpecimens.length}개
            {done.createdSpecimens.length ? `(${done.createdSpecimens.join(', ')})` : ''}, 비어서 지운 시편 {done.removedSpecimens.length}개. 저장된 파일 위치는 그대로입니다.
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDone(null)}>
          닫기
        </button>
      </div>
    )
  }
  if (preview.error) return <ErrorNotice title="시편 다시 묶기 제안을 계산하지 못했습니다" error={preview.error} onRetry={preview.reload} />
  if (!items.length) return null
  const targets = [...new Set(items.map((i) => i.toSpecimenId))]

  async function apply(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await unwrap(api.specimens.regroupApply(movable.map((i) => i.fileId)))
      setDone(r)
      setOpen(false)
      bumpData()
    } catch (e) {
      setError(toUiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notice notice--accent" role="region" aria-label="시편 다시 묶기">
      <div className="notice__body">
        <p className="notice__title">파일 이름의 시편 번호로 다시 묶을 수 있는 파일이 {items.length}개 있습니다</p>
        <p>
          지금은 파일마다 파일 이름이 시편 ID 입니다. 시편 번호(PL·TP·TF)로 묶으면 시편 {targets.length}개({targets.slice(0, 6).join(', ')}
          {targets.length > 6 ? ' …' : ''})가 되고, 학습 분할과 물리 결함 연결이 시편 단위로 맞습니다. 파일 위치는 바뀌지 않습니다.
        </p>
        {open ? (
          <div className="table-wrap">
            <table className="table" aria-label="시편 다시 묶기 미리보기">
              <thead>
                <tr>
                  <th>파일</th>
                  <th>플랜</th>
                  <th>지금 시편</th>
                  <th>새 시편</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.fileId}>
                    <td className="is-wrap mono">{i.fileName}</td>
                    <td className="mono">{i.planId}</td>
                    <td className="mono">{i.fromSpecimenId}</td>
                    <td className="mono">{i.toSpecimenId}</td>
                    <td className="is-wrap">{i.blocked ?? '옮김'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {error ? <ErrorNotice title="시편을 다시 묶지 못했습니다" error={error} /> : null}
      </div>
      {open ? (
        <div className="row">
          <button type="button" className="btn btn--primary btn--sm" disabled={busy || movable.length === 0} onClick={() => void apply()}>
            {busy ? '묶는 중…' : `${movable.length}개 다시 묶기`}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>
          미리보기
        </button>
      )}
    </div>
  )
}
