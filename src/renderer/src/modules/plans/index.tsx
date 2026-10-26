/** 스캔플랜별 데이터: 왼쪽 플랜 목록 + 오른쪽 플랜 상세(도식 · 시편별 파일 · 셋업 요약). 상단바 검색어로 필터 */
import { useEffect, useMemo, useState } from 'react'
import type { ModuleProps } from '@shared/modules'
import { groupPlans, plansInGroupOrder } from '@shared/planGroups'
import { frequenciesMHz, skewsDeg, thicknessBucket } from '@shared/planName'
import { matchesAllTerms } from '@shared/text'
import type { ScanPlan } from '@shared/types'
import { getApi, unwrap } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { StoreRootEmpty } from '../../components/StoreRootEmpty'
import { useAsync } from '../../lib/useAsync'
import { useApp } from '../../state/AppContext'
import { PlanDetail } from './PlanDetail'
import { PlanList } from './PlanList'

/** 플랜 자체 필드 (ID·이름·요약·탐촉자/웨지 모델). 규칙은 카탈로그 파일 검색과 같다(낱말 모두 포함) */
function planFields(p: ScanPlan): Array<string | null | undefined> {
  const probes = p.spec.groups.flatMap((g) => g.probes.flatMap((x) => [x.probe.model, x.wedge?.model]))
  // 'SK90/270'·'10/5MHz' 처럼 묶인 값도 낱개('SK270'·'10MHz')로, 두께 구간('10~20T')으로도 찾게 한다
  const values = [...skewsDeg(p.spec).map((d) => `SK${d}`), ...frequenciesMHz(p.spec).map((f) => `${f}MHz`), thicknessBucket(p.spec)?.label]
  return [p.id, p.name, p.summary, ...probes, ...values]
}

export default function PlansModule({ route, navigate }: ModuleProps) {
  const api = getApi()
  const { settings, query, setQuery, dataVersion, bumpData } = useApp()
  const storeRoot = settings?.storeRoot ?? null
  const [selected, setSelected] = useState<string | null>(route.params.planId ?? null)
  // 이미지 보기에서 돌아올 때 다시 펼칠 파일. 그 플랜 상세가 처음 그려질 때 한 번만 쓴다
  // (route.params 를 계속 읽으면 플랜을 다시 고를 때마다 펼쳐지고 스크롤된다)
  const [restore, setRestore] = useState<{ planId: string; fileId: number } | null>(() =>
    route.params.planId && route.params.fileId ? { planId: route.params.planId, fileId: Number(route.params.fileId) } : null
  )
  const q = query.trim().normalize('NFC')

  useEffect(() => {
    if (route.params.planId) setSelected(route.params.planId)
  }, [route.params.planId])

  const lists = useAsync(
    () => (storeRoot ? Promise.all([unwrap(api.plans.list()), unwrap(api.import.history())]) : Promise.resolve(null)),
    [storeRoot, dataVersion]
  )
  const hitsReq = useAsync(
    () => (storeRoot && q ? unwrap(api.files.list({ text: q, limit: 1000 })) : Promise.resolve(null)),
    [storeRoot, q, dataVersion]
  )
  const fileHits = useMemo(() => {
    if (!q || !hitsReq.data) return null
    const m = new Map<string, number>()
    for (const f of hitsReq.data.items) m.set(f.planId, (m.get(f.planId) ?? 0) + 1)
    return m
  }, [q, hitsReq.data])
  const hitIds = useMemo(() => (q && hitsReq.data ? new Set(hitsReq.data.items.map((f) => f.id)) : null), [q, hitsReq.data])

  const plans = useMemo(() => lists.data?.[0] ?? [], [lists.data])
  const newIds = useMemo(() => new Set(lists.data?.[1][0]?.createdPlanIds ?? []), [lists.data])
  const visible = useMemo(
    () => (q ? plans.filter((p) => matchesAllTerms(planFields(p), q) || (fileHits?.get(p.id) ?? 0) > 0) : plans),
    [plans, q, fileHits]
  )
  // 두께 구간 → 주파수 → 스큐로 묶은 화면 순서. 선택이 없으면 화면 맨 위 플랜
  const groups = useMemo(() => groupPlans(visible), [visible])
  const current = visible.find((p) => p.id === selected) ?? plansInGroupOrder(groups)[0] ?? null

  // PlanDetail 은 initialFileId 를 처음 마운트할 때만 읽으므로, 그려진 뒤 바로 지운다
  useEffect(() => {
    if (restore && current?.id === restore.planId) setRestore(null)
  }, [restore, current?.id])
  const selectPlan = (id: string): void => {
    setSelected(id)
    setRestore(null)
  }

  if (settings && !storeRoot) return <StoreRootEmpty />

  const header = (
    <div className="page-header">
      <div className="page-header__text">
        <h1 className="page-header__title">스캔플랜별 데이터</h1>
        <p className="page-header__desc">셋업(시편·용접, 탐촉자·웨지, 위치, 빔 구성)이 같은 파일끼리 자동으로 묶입니다.</p>
      </div>
    </div>
  )

  if (lists.error) {
    return (
      <div>
        {header}
        <ErrorNotice title="스캔플랜 목록을 읽지 못했습니다" error={lists.error} onRetry={lists.reload} />
      </div>
    )
  }
  if (!lists.data) return <div>{header}</div>

  if (plans.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          title="아직 스캔플랜이 없습니다"
          desc="NDE·OPD 파일을 가져오면 셋업을 읽어 스캔플랜별로 자동 정리합니다."
          action={
            <button type="button" className="btn btn--secondary btn--lg" onClick={() => navigate('import')}>
              가져오기 화면으로
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="module-fill">
      {header}
      <div className="plans">
        <div className="plans__list">
          <div className="toolbar plans__list-head">
            <span className="toolbar__count">{q ? `플랜 ${visible.length} / ${plans.length}` : `플랜 ${plans.length}`}</span>
          </div>
          {visible.length > 0 ? (
            <PlanList groups={groups} selectedId={current?.id ?? null} newIds={newIds} fileHits={fileHits} onSelect={selectPlan} />
          ) : (
            <EmptyState
              icon="search"
              title="찾는 플랜이 없습니다"
              desc={`'${query.trim()}'에 맞는 플랜·시편·파일이 없습니다.`}
              action={
                <button type="button" className="btn btn--secondary" onClick={() => setQuery('')}>
                  검색 지우기
                </button>
              }
            />
          )}
        </div>
        <div className="plans__detail">
          {current ? (
            <PlanDetail
              key={current.id}
              plan={current}
              initialFileId={restore?.planId === current.id ? restore.fileId : null}
              onOpenImage={(fileId) => navigate('viewer', { fileId: String(fileId), planId: current.id })}
              isNew={newIds.has(current.id)}
              query={query}
              hitIds={hitIds}
              onRenamed={bumpData}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
