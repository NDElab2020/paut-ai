import { useMemo, useState } from 'react'
import { OPD_FORMAT_LABEL, isOpdSpec, type FileRecord, type ScanPlan } from '@shared/types'
import { formatBytes } from '@shared/ids'
import { getApi, unwrap } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { InlineRename } from '../../components/InlineRename'
import { SetupPanels } from '../../components/SetupPanels'
import { Status, Tag } from '../../components/Status'
import { dateTime, shortHash } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { useApp } from '../../state/AppContext'
import { FilesBySpecimen } from './FilesBySpecimen'
import { PlanCanvas } from './PlanCanvas'

/** 파일 기록에서 그룹 이름(정준 순서 인덱스 → 이름)을 얻는다 */
function groupNamesOf(files: FileRecord[]): string[] {
  const names: string[] = []
  for (const g of files[0]?.acquisition.groups ?? []) names[g.specGroupIndex] = g.groupName
  return names
}

/**
 * hitIds: 상단 검색어로 카탈로그가 찾은 파일 ID (목록의 '검색 일치' 개수와 같은 결과). 검색어가 없으면 null.
 * 화면에서 따로 문자열을 비교하지 않아 목록과 상세의 결과가 어긋나지 않는다.
 */
export function PlanDetail(props: {
  plan: ScanPlan
  isNew: boolean
  query: string
  hitIds: ReadonlySet<number> | null
  onRenamed: (p: ScanPlan) => void
  /** 이미지 보기에서 돌아올 때 다시 펼칠 파일 */
  initialFileId?: number | null
  onOpenImage: (fileId: number) => void
}) {
  const { plan } = props
  const api = getApi()
  const { dataVersion } = useApp()
  const [selectedFile, setSelectedFile] = useState<number | null>(props.initialFileId ?? null)
  const data = useAsync(
    () =>
      Promise.all([unwrap(api.files.list({ planId: plan.id, limit: 1000, sort: 'fileName-asc' })), unwrap(api.specimens.list(plan.id))]),
    [plan.id, dataVersion]
  )
  const files = useMemo(() => data.data?.[0].items ?? [], [data.data])
  const specimens = data.data?.[1] ?? []
  const q = props.query.trim()
  const { hitIds } = props
  const hits = useMemo(() => (q && hitIds ? files.filter((f) => hitIds.has(f.id)) : []), [files, q, hitIds])
  const shown = q && hits.length > 0 ? hits : files
  const names = groupNamesOf(files)

  const rename = async (name: string): Promise<void> => props.onRenamed(await unwrap(api.plans.rename(plan.id, name)))

  return (
    <article className="plan-detail" aria-labelledby="plan-id">
      <header className="plan-head">
        <div className="row">
          <span className="t-display" id="plan-id">
            {plan.id}
          </span>
          {props.isNew ? <Status tone="new">새 플랜</Status> : null}
          {isOpdSpec(plan.spec) ? <Tag title="공개되지 않은 OPD 형식을 파일 구조를 따라 읽은 셋업입니다(OmniPC 대조 전 — 자동 변환·학습 내보내기 막힘).">{OPD_FORMAT_LABEL}</Tag> : null}
        </div>
        <InlineRename
          value={plan.name}
          placeholder="이름 없음"
          hint={`이름은 화면에서만 쓰입니다. 저장소 폴더(${plan.id})는 그대로입니다.`}
          onSave={rename}
        />
        <p className="plan-head__summary">{plan.summary}</p>
        <p className="plan-head__meta">
          지문{' '}
          <span className="mono" title={plan.fingerprint}>
            {shortHash(plan.fingerprint)}
          </span>{' '}
          · 만든 시각 <span className="num">{dateTime(plan.createdAt)}</span> · 최근 가져옴{' '}
          <span className="num">{dateTime(plan.lastImportedAt)}</span>
        </p>
        <div className="plan-head__stats">
          <div className="stat">
            <span className="stat__value">{plan.specimenCount}</span>
            <span className="stat__label">시편</span>
          </div>
          <div className="stat">
            <span className="stat__value">{plan.fileCount}</span>
            <span className="stat__label">파일</span>
          </div>
          <div className="stat">
            <span className="stat__value">{plan.spec.groups.length}</span>
            <span className="stat__label">그룹</span>
          </div>
          <div className="stat">
            <span className="stat__value">{formatBytes(plan.totalBytes)}</span>
            <span className="stat__label">용량</span>
          </div>
        </div>
      </header>

      <PlanCanvas key={`${plan.id}|${names.join('|')}`} spec={plan.spec} groupNames={names} />

      <section className="section" aria-labelledby="files-title">
        <div className="toolbar">
          <h3 className="section__title section__title--inline" id="files-title">
            시편별 파일
          </h3>
          <span className="toolbar__count">
            시편 {specimens.length} · 파일 {files.length}
          </span>
          <span className="toolbar__spacer" />
          {q && hitIds ? (
            <span className="toolbar__count">
              {hits.length > 0 ? `검색어 '${q}' 일치 ${hits.length}개만 표시` : `이 플랜의 파일 중 '${q}'에 맞는 것이 없어 전체를 표시합니다`}
            </span>
          ) : null}
        </div>
        {data.error ? (
          <ErrorNotice title="이 플랜의 파일 목록을 읽지 못했습니다" error={data.error} onRetry={data.reload} />
        ) : data.loading && !data.data ? (
          <p className="text-subtle loading-line">파일 목록을 읽는 중입니다.</p>
        ) : files.length === 0 ? (
          <EmptyState title="이 플랜에 파일이 없습니다" desc="같은 셋업의 측정 파일(.nde·.opd)을 가져오면 시편별로 여기에 쌓입니다." />
        ) : (
          <FilesBySpecimen files={shown} specimens={specimens} selectedId={selectedFile} onSelect={setSelectedFile} onOpenImage={props.onOpenImage} />
        )}
      </section>

      <section className="section" aria-labelledby="setup-title">
        <h3 className="section__title" id="setup-title">
          셋업 요약 <span className="t-caption">이 네 범주가 같은 파일끼리 한 플랜으로 묶입니다</span>
        </h3>
        <SetupPanels spec={plan.spec} groupNames={names} />
      </section>
    </article>
  )
}
