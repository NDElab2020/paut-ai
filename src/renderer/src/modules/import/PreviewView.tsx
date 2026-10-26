/**
 * 정리 미리보기: "어느 플랜에 어떤 시편이 들어가는지"만 먼저 보여 주고 버튼 하나로 정리한다.
 * 파일별 판정·시편 ID 수정·제외는 '파일별로 보기·고치기'에 접어 둔다.
 */
import { useMemo, useState } from 'react'
import { formatBytes } from '@shared/ids'
import type { ImportPreview, ImportVerdict, ScanPlan } from '@shared/types'
import { getApi, unwrap, type UiError } from '../../api'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import { VERDICT, VERDICT_ORDER } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { PlanDestinations } from './PlanDestinations'
import { PreviewTable } from './PreviewTable'
import { analyze, commit, reset, validate, type Edits } from './store'

type Filter = 'all' | ImportVerdict

const SKIP_LABEL: Partial<Record<ImportVerdict, string>> = {
  duplicate: '이미 저장됨',
  unsupported: '지원 안 함',
  // 판정 칸(VERDICT.error)과 같은 이름 — 한 실패를 세 이름(오류·보류(해석 실패)·읽지 못함)으로 부르지 않게
  error: '오류'
}

export function PreviewView({ preview, edits, error }: { preview: ImportPreview; edits: Edits; error: UiError | null }) {
  const api = getApi()
  const [filter, setFilter] = useState<Filter>('all')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const ref = useAsync(() => unwrap(api.plans.list()), [])
  const plans = useMemo(() => new Map<string, ScanPlan>((ref.data ?? []).map((p) => [p.id, p])), [ref.data])

  const { included, badItems, badPlans } = validate(preview, edits)
  const restores = preview.items.filter((i) => i.verdict === 'missing-copy')
  const excluded = preview.items.filter((i) => (i.verdict === 'match-existing' || i.verdict === 'new-plan') && !edits.items[i.itemId]?.include)
  const skipped = (['duplicate', 'unsupported', 'error'] as const).filter((v) => preview.counts[v] > 0)
  const skippedCount = skipped.reduce((s, v) => s + preview.counts[v], 0) + excluded.length
  const bytes = [...included, ...restores].reduce((s, i) => s + i.sizeBytes, 0)
  const total = included.length + restores.length

  const ordered = useMemo(
    () =>
      preview.items
        .map((item, idx) => ({ item, idx }))
        .sort((a, b) => VERDICT_ORDER.indexOf(a.item.verdict) - VERDICT_ORDER.indexOf(b.item.verdict) || a.idx - b.idx)
        .map((x) => x.item)
        .filter((i) => filter === 'all' || i.verdict === filter),
    [preview.items, filter]
  )

  // 정리할 파일이 없으면(모두 중복 등) 위 안내가 이미 말하므로 막대에는 사유 줄을 두지 않고 버튼만 끈다 (오류가 아니라 빨강도 아님)
  const blockReason =
    total === 0
      ? ''
      : badPlans.size > 0
        ? '새 플랜 이름을 입력하세요.'
        : badItems.size > 0
          ? `시편 ID 가 비었거나 폴더 이름으로 쓸 수 없는 파일이 ${badItems.size}개 있습니다.`
          : null

  return (
    <div className="import-preview">
      <div className="toolbar">
        <h2 className="section__title section__title--inline" tabIndex={-1} data-focus-target>
          이렇게 정리됩니다
        </h2>
        <span className="toolbar__count truncate" title={preview.inputPaths.join('\n')}>
          {preview.inputPaths[0]}
          {preview.inputPaths.length > 1 ? ` 외 ${preview.inputPaths.length - 1}곳` : ''}
        </span>
        <span className="toolbar__spacer" />
        <button type="button" className="btn btn--ghost" onClick={reset}>
          다시 고르기
        </button>
      </div>

      {error ? (
        <ErrorNotice
          title="저장소에 복사하지 못했습니다"
          error={error}
          onRetry={error.code === 'PREVIEW_EXPIRED' ? () => void analyze(preview.inputPaths) : undefined}
        />
      ) : null}

      <PlanDestinations preview={preview} edits={edits} included={included} badPlans={badPlans} plans={plans} />

      {skippedCount > 0 ? (
        <p className="skip-line">
          <span className="text-subtle">건너뛰는 파일 {skippedCount}개</span>
          <span className="t-caption">
            {[...skipped.map((v) => `${SKIP_LABEL[v]} ${preview.counts[v]}`), excluded.length ? `제외함 ${excluded.length}` : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
          <button type="button" className="btn btn--link" onClick={() => setDetailsOpen(true)}>
            이유 보기
          </button>
        </p>
      ) : null}

      <details className="preview-details" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
        <summary>파일별로 보기·고치기 <span className="t-caption">시편 ID·상태 태그 수정, 파일 제외</span></summary>
        {detailsOpen ? (
          <div className="preview-details__body">
            <div className="toolbar">
              <span className="toolbar__count">파일 {preview.items.length}개</span>
              <span className="toolbar__spacer" />
              <span className="select">
                <select aria-label="판정으로 거르기" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                  <option value="all">모든 판정 {preview.items.length}</option>
                  {VERDICT_ORDER.filter((v) => preview.counts[v] > 0).map((v) => (
                    <option key={v} value={v}>
                      {VERDICT[v].label} {preview.counts[v]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <PreviewTable preview={preview} items={ordered} edits={edits} badItems={badItems} plans={plans} />
          </div>
        ) : null}
      </details>

      <div className="commit-bar">
        <div className="commit-bar__text">
          <p className="commit-bar__main num">
            {total > 0 ? `파일 ${total}개 · ${formatBytes(bytes)}` : '정리할 파일 없음'}
          </p>
          <p className="commit-bar__sub" title={preview.storeRoot}>
            {blockReason === '' ? null : blockReason ? (
              <>
                <span className="text-danger">{blockReason}</span>{' '}
                {badItems.size > 0 ? (
                  <button type="button" className="btn btn--link" onClick={() => setDetailsOpen(true)}>
                    고치기
                  </button>
                ) : null}
              </>
            ) : (
              '저장소로 복사합니다. 원본은 그대로 둡니다.'
            )}
          </p>
        </div>
        <button type="button" className="btn btn--primary btn--lg" disabled={blockReason !== null} onClick={() => void commit()}>
          <Icon name="import" />
          정리하기
        </button>
      </div>
    </div>
  )
}
