import { useEffect, useMemo, useState } from 'react'
import type { ModuleProps } from '@shared/modules'
import { matchesAllTerms } from '@shared/text'
import { isEstimatedSpecimenField, isOpdSpec, type ScanPlan, type SpecimenSummary } from '@shared/types'
import { getApi, unwrap } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { StoreRootEmpty } from '../../components/StoreRootEmpty'
import { Tag } from '../../components/Status'
import { setupWeldTemplateLabel } from '../../components/setupWeldGeometry'
import { SHAPE_LABEL, SOURCE_ID_LABEL, dateTime, num } from '../../lib/format'
import { rowKeyHandler } from '../../lib/rowNav'
import { useAsync } from '../../lib/useAsync'
import { useApp } from '../../state/AppContext'
import { FilesBySpecimen } from '../plans/FilesBySpecimen'

/** 시편 이름·태그와 연결된 각 플랜 셋업으로 검색한다. 플랜의 치수를 시편 공통 치수로 합치지 않는다. */
export function specimenSearchFields(s: SpecimenSummary, plans: ScanPlan[]): Array<string | null | undefined> {
  return [s.id, s.displayName, s.note, ...s.stateTags, ...plans.filter((p) => s.planIds.includes(p.id)).flatMap((p) => [
    p.id, p.name, p.summary, SHAPE_LABEL[p.spec.specimen.shape], p.spec.specimen.materialName, p.spec.specimen.weld?.template,
    p.spec.specimen.weld?.bevelShape, ...p.spec.groups.flatMap((g) => g.probes.flatMap((x) => [x.probe.model, x.wedge?.model]))
  ])]
}

export default function SpecimensModule({ route, navigate }: ModuleProps) {
  const api = getApi()
  const { settings, dataVersion, query, setQuery } = useApp()
  const storeRoot = settings?.storeRoot ?? null
  const [selected, setSelected] = useState<string | null>(route.params.specimenId ?? null)
  const lists = useAsync(() => storeRoot ? Promise.all([unwrap(api.specimens.list()), unwrap(api.plans.list())]) : Promise.resolve(null), [storeRoot, dataVersion])
  const specimens = lists.data?.[0] ?? []
  const plans = lists.data?.[1] ?? []
  const q = query.trim().normalize('NFC')
  const visible = useMemo(() => (q ? specimens.filter((s) => matchesAllTerms(specimenSearchFields(s, plans), q)) : specimens).slice().sort((a, b) => a.id.localeCompare(b.id, 'ko', { numeric: true })), [specimens, plans, q])
  const current = visible.find((s) => s.id === selected) ?? visible[0] ?? null
  useEffect(() => {
    if (route.params.specimenId) setSelected(route.params.specimenId)
  }, [route.params.specimenId])

  const header = <div className="page-header"><div className="page-header__text"><h1 className="page-header__title">시편별 데이터</h1><p className="page-header__desc">시편에 연결된 스캔플랜·용접 설정과 측정 파일을 봅니다. 상단 검색창에서 시편·태그·셋업을 찾을 수 있습니다.</p></div></div>
  if (settings && !storeRoot) return <StoreRootEmpty />
  if (lists.error) return <div>{header}<ErrorNotice title="시편 목록을 읽지 못했습니다" error={lists.error} onRetry={lists.reload} /></div>
  if (!lists.data) return <div>{header}<p className="loading-line text-subtle">시편 목록을 읽는 중입니다.</p></div>
  if (!specimens.length) return <div>{header}<EmptyState title="아직 시편이 없습니다" desc="NDE·OPD 파일을 가져오면 파일에서 읽은 시편 ID를 기준으로 정리합니다." action={<button type="button" className="btn btn--secondary" onClick={() => navigate('import')}>가져오기 화면으로</button>} /></div>

  return (
    <div className="module-fill">
      {header}
      <div className="plans">
        <div className="plans__list">
          <div className="toolbar plans__list-head"><span className="toolbar__count">{q ? `시편 ${visible.length} / ${specimens.length}` : `시편 ${specimens.length}`}</span></div>
          {visible.length ? (
            <div className="list" role="listbox" aria-label="시편 목록" onKeyDown={rowKeyHandler({ onSelect: setSelected })}>
              {visible.map((s) => <div key={s.id} className="list-item" role="option" aria-selected={s.id === current?.id} tabIndex={s.id === current?.id ? 0 : -1} data-row={s.id} onClick={() => setSelected(s.id)}>
                <span className="list-item__title truncate">{s.displayName || s.id}</span><span className="plan-item__id">{s.id}</span>
                <span className="list-item__meta">플랜 {s.planIds.length} · 파일 {s.fileCount}</span>
                <span className="list-item__meta truncate">{s.stateTags.join(' · ') || '상태 태그 없음'}</span>
              </div>)}
            </div>
          ) : <EmptyState icon="search" title="찾는 시편이 없습니다" desc={`'${query.trim()}'에 맞는 시편·태그·셋업이 없습니다.`} action={<button type="button" className="btn btn--secondary" onClick={() => setQuery('')}>검색 지우기</button>} />}
        </div>
        <div className="plans__detail">{current ? <SpecimenDetail key={`${storeRoot}|${current.id}`} specimen={current} plans={plans} navigate={navigate} /> : null}</div>
      </div>
    </div>
  )
}

/** 같은 시편이라도 검사 셋업이 다르면 각 플랜의 치수를 따로 보여 준다. */
export function SpecimenPlanSummary({ specimen, plans, navigate }: { specimen: SpecimenSummary; plans: ScanPlan[]; navigate: ModuleProps['navigate'] }) {
  const byId = new Map(plans.map((p) => [p.id, p]))
  return (
    <div className="table-wrap">
      <table className="table" aria-label="시편의 스캔플랜별 형상 설정">
        <thead><tr><th>스캔플랜</th><th>시편 형상 · 두께</th><th>재질</th><th>개선 템플릿 · 대칭</th></tr></thead>
        <tbody>{specimen.planIds.map((id) => {
          const p = byId.get(id)
          const s = p?.spec.specimen
          const w = s?.weld
          return <tr key={id}>
            <td className="is-wrap"><span className="file-cell__name">{p?.name ?? id}</span><span className="file-cell__device mono">{id}{p && isOpdSpec(p.spec) ? ' · OPD' : ''}</span><button type="button" className="btn btn--ghost" onClick={() => navigate('plans', { planId: id })}>셋업 보기</button></td>
            <td>{s ? `${SHAPE_LABEL[s.shape]}${isEstimatedSpecimenField(s, 'shape') ? ' (추정)' : ''} · ${num(s.thicknessMm)} mm` : '셋업 정보 없음'}</td>
            <td className="is-wrap">{s?.materialName ?? w?.materialName ?? '모름'}{isEstimatedSpecimenField(s, 'materialName') ? ' (추정)' : ''}</td>
            <td className="is-wrap">{w ? `${w.template || w.bevelShape ? setupWeldTemplateLabel(w.template ?? w.bevelShape) : '템플릿 모름'}${isEstimatedSpecimenField(s, 'weld.template') ? ' (추정)' : ''} · ${w.symmetry === 'Symmetric' ? '대칭' : w.symmetry ?? '대칭 방식 모름'}` : '용접 정보 없음'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  )
}

function SpecimenDetail({ specimen: s, plans, navigate }: { specimen: SpecimenSummary; plans: ScanPlan[]; navigate: ModuleProps['navigate'] }) {
  const api = getApi()
  const { dataVersion } = useApp()
  const [page, setPage] = useState(0)
  const [selectedFile, setSelectedFile] = useState<number | null>(null)
  const limit = 200
  const files = useAsync(() => unwrap(api.files.list({ specimenId: s.id, limit, offset: page * limit, sort: 'fileName-asc' })), [s.id, page, dataVersion])
  const items = files.data?.items ?? []
  const byPlan = useMemo(() => {
    const ids = [...new Set(items.map((f) => f.planId))]
    return ids.map((id) => ({ id, plan: plans.find((p) => p.id === id), files: items.filter((f) => f.planId === id) }))
  }, [items, plans])
  return (
    <article aria-labelledby="specimen-id">
      <header className="plan-head">
        <div className="row"><h2 className="t-display" id="specimen-id">{s.displayName || s.id}</h2>{s.stateTags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
        <p className="plan-head__meta">시편 ID {s.id} · {SOURCE_ID_LABEL[s.source]} · 최근 가져옴 {dateTime(s.lastImportedAt)}</p>
        <p className="plan-head__summary">스캔플랜 {s.planIds.length}개 · 측정 파일 {s.fileCount}개</p>
        {s.note ? <p>{s.note}</p> : null}
      </header>
      <section className="section"><h3 className="section__title">검사 셋업에 기록된 시편·용접 설정</h3><p className="text-subtle">각 행은 해당 스캔플랜의 설정입니다. 같은 시편의 설정값이 다르면 플랜별로 확인할 수 있습니다.</p><SpecimenPlanSummary specimen={s} plans={plans} navigate={navigate} /></section>
      <section className="section">
        <div className="toolbar"><h3 className="section__title">측정 파일</h3><span className="toolbar__count">{files.data?.total ?? s.fileCount}개</span></div>
        {files.error ? <ErrorNotice title="시편 파일을 읽지 못했습니다" error={files.error} onRetry={files.reload} /> : files.loading && !files.data ? <p className="loading-line text-subtle">측정 파일을 읽는 중입니다.</p> : items.length ? byPlan.map((g) => <section className="section" key={g.id}>
          <div className="toolbar"><h4>{g.plan?.name ?? g.id} <span className="text-subtle">{g.id}</span></h4><button type="button" className="btn btn--ghost" onClick={() => navigate('plans', { planId: g.id })}>플랜 보기</button></div>
          <FilesBySpecimen files={g.files} specimens={[s]} selectedId={selectedFile} onSelect={setSelectedFile} onOpenImage={(fileId) => navigate('viewer', { fileId: String(fileId), planId: g.id })} />
        </section>) : <p className="text-subtle">측정 파일이 없습니다.</p>}
        {files.data && files.data.total > limit ? <div className="toolbar"><button type="button" className="btn btn--secondary" disabled={page === 0 || files.loading} onClick={() => { setPage((p) => p - 1); setSelectedFile(null) }}>이전</button><span className="num">{page + 1} / {Math.ceil(files.data.total / limit)}</span><button type="button" className="btn btn--secondary" disabled={(page + 1) * limit >= files.data.total || files.loading} onClick={() => { setPage((p) => p + 1); setSelectedFile(null) }}>다음</button></div> : null}
      </section>
      <p className="setup-panel__note">{s.source === 'manual' ? '직접 지정한 시편 ID입니다.' : '시편 ID는 파일 이름에서 추출한 값입니다.'} 실제 시편과의 일치는 원본 기록으로 확인할 수 있습니다.</p>
    </article>
  )
}
