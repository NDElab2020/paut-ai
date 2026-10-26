import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { planGroupPath, type ThicknessGroup } from '@shared/planGroups'
import { OPD_PLAN_TAG, isOpdSpec, type ScanPlan } from '@shared/types'
import { Icon } from '../../components/Icon'
import { Status, Tag } from '../../components/Status'
import { rowKeyHandler } from '../../lib/rowNav'

/** 접어 둔 두께·주파수 구간 열쇠. 화면을 떠났다 돌아와도 앱을 닫기 전까지 유지한다(모듈 상태) */
let sessionCollapsed: ReadonlySet<string> = new Set()

/**
 * 왼쪽 플랜 목록 (listbox): 두께 구간 → 탐촉자 주파수 → 스큐 → 플랜.
 * 두께·주파수 머리는 접기/펼치기 버튼. 위/아래 화살표·Home/End 는 보이는 플랜 사이를 구간을 넘어 이동한다.
 * 스크린리더: 구간마다 role="group" 이고, 스큐 묶음 이름은 '10~20T 5MHz SK90' 처럼 세 단계를 모두 읽는다.
 */
export function PlanList(props: {
  groups: ThicknessGroup<ScanPlan>[]
  selectedId: string | null
  newIds: ReadonlySet<string>
  fileHits: ReadonlyMap<string, number> | null
  onSelect: (id: string) => void
}) {
  const { groups, selectedId } = props
  const baseId = useId()
  const [collapsed, setCollapsedState] = useState<ReadonlySet<string>>(sessionCollapsed)
  const setCollapsed = (next: ReadonlySet<string>): void => {
    sessionCollapsed = next
    setCollapsedState(next)
  }
  const listRef = useRef<HTMLDivElement>(null)
  /** 선택된 플랜 줄을 스크롤 영역 안으로 보이게 할 차례인가 (사용자가 머리를 접고 펴면 취소) */
  const pendingScroll = useRef(true)
  const toggle = (key: string): void => {
    pendingScroll.current = false
    const next = new Set(collapsed)
    if (!next.delete(key)) next.add(key)
    setCollapsed(next)
  }

  // 선택된 플랜이 접힌 구간 안에 있으면 그 구간을 펼친다 (다른 화면에서 플랜을 지정해 들어오거나 검색으로 선택이 바뀐 경우).
  // 선택된 플랜의 구간을 사용자가 직접 접으면 선택이 바뀌기 전까지 접힌 채로 둔다.
  const selectedPath = useMemo(() => {
    for (const t of groups) for (const f of t.freqs) for (const s of f.skews) for (const p of s.plans) if (p.id === selectedId) return planGroupPath(p.spec)
    return null
  }, [groups, selectedId])
  const selT = selectedPath?.thicknessKey
  const selF = selectedPath?.frequencyKey
  useEffect(() => {
    if (!selT || !selF || (!sessionCollapsed.has(selT) && !sessionCollapsed.has(selF))) return
    const next = new Set(sessionCollapsed)
    next.delete(selT)
    next.delete(selF)
    sessionCollapsed = next
    setCollapsedState(next)
  }, [selectedId, selT, selF])

  // 렌더마다 확인: 선택 또는 목록(검색 결과)이 바뀌었으면 대기, 선택된 줄이 DOM 에 있으면 가장 가까운 위치로 스크롤.
  // 자동 펼침은 다음 렌더에서 줄을 만들므로 그때까지 대기를 유지한다. 포커스는 옮기지 않는다.
  const seen = useRef<{ sel: string | null; groups: unknown } | null>(null)
  useLayoutEffect(() => {
    if (seen.current?.sel !== selectedId || seen.current?.groups !== groups) {
      seen.current = { sel: selectedId, groups }
      pendingScroll.current = true
    }
    if (!pendingScroll.current || !selectedId) return
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].find((el) => el.dataset.row === selectedId)
    if (!row) return
    pendingScroll.current = false
    row.scrollIntoView?.({ block: 'nearest' })
  })

  /** 화면에 보이는(접히지 않은) 플랜 ID — 키보드 탭 정지 위치 */
  const shownIds = groups.flatMap((t) =>
    collapsed.has(t.key) ? [] : t.freqs.flatMap((f) => (collapsed.has(f.key) ? [] : f.skews.flatMap((s) => s.plans.map((p) => p.id))))
  )
  const tabStop = selectedId && shownIds.includes(selectedId) ? selectedId : shownIds[0]

  return (
    <div ref={listRef} className="list plan-list plan-tree" role="listbox" aria-label="스캔플랜 목록" onKeyDown={rowKeyHandler({ onSelect: props.onSelect })}>
      {groups.map((t, ti) => {
        const tId = `${baseId}t${ti}`
        const tOpen = !collapsed.has(t.key)
        return (
          <div key={t.key} className="plan-tier plan-tier--thickness" role="group" aria-labelledby={`${tId}-label`}>
            <button
              type="button"
              className="plan-tier__toggle plan-tier__toggle--thickness"
              aria-expanded={tOpen}
              aria-controls={`${tId}-body`}
              onClick={() => toggle(t.key)}
            >
              <Icon name={tOpen ? 'chevron-down' : 'chevron-right'} />
              <span id={`${tId}-label`} className="plan-tier__label">
                {t.label}
              </span>
              <span className="plan-tier__count num">플랜 {t.planCount}</span>
            </button>
            <div id={`${tId}-body`} className="plan-tier__body" hidden={!tOpen}>
              {tOpen
                ? t.freqs.map((f, fi) => {
                    const fId = `${tId}f${fi}`
                    const fOpen = !collapsed.has(f.key)
                    return (
                      <div key={f.key} className="plan-tier plan-tier--frequency" role="group" aria-labelledby={`${fId}-label`}>
                        <button
                          type="button"
                          className="plan-tier__toggle plan-tier__toggle--frequency"
                          aria-expanded={fOpen}
                          aria-controls={`${fId}-body`}
                          onClick={() => toggle(f.key)}
                        >
                          <Icon name={fOpen ? 'chevron-down' : 'chevron-right'} />
                          <span id={`${fId}-label`} className="plan-tier__label">
                            {f.label}
                          </span>
                          <span className="plan-tier__count num">플랜 {f.planCount}</span>
                        </button>
                        <div id={`${fId}-body`} className="plan-tier__body" hidden={!fOpen}>
                          {fOpen
                            ? f.skews.map((s, si) => {
                                const sId = `${fId}s${si}`
                                return (
                                  <div
                                    key={s.key}
                                    className="plan-skew"
                                    role="group"
                                    aria-labelledby={`${tId}-label ${fId}-label ${sId}-label`}
                                  >
                                    <div id={`${sId}-label`} className="plan-skew__head">
                                      {s.label}
                                    </div>
                                    {s.plans.map((p) => (
                                      <PlanItem
                                        key={p.id}
                                        plan={p}
                                        selected={p.id === selectedId}
                                        tabStop={p.id === tabStop}
                                        isNew={props.newIds.has(p.id)}
                                        hits={props.fileHits?.get(p.id)}
                                        onSelect={props.onSelect}
                                      />
                                    ))}
                                  </div>
                                )
                              })
                            : null}
                        </div>
                      </div>
                    )
                  })
                : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PlanItem({
  plan: p,
  selected,
  tabStop,
  isNew,
  hits,
  onSelect
}: {
  plan: ScanPlan
  selected: boolean
  tabStop: boolean
  isNew: boolean
  hits: number | undefined
  onSelect: (id: string) => void
}) {
  return (
    <div
      className="list-item plan-item"
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-row={p.id}
      onClick={() => onSelect(p.id)}
    >
      <span className="list-item__title truncate" title={p.name}>
        {p.name || <span className="text-faint">이름 없음</span>}
      </span>
      <span className="plan-item__id">{p.id}</span>
      <span className="list-item__meta truncate" title={p.summary}>
        {p.summary}
      </span>
      <span className="list-item__meta plan-item__counts">
        <span className="num">
          시편 {p.specimenCount} · 파일 {p.fileCount}
        </span>
        {hits ? <span className="num">· 검색 일치 {hits}</span> : null}
        {isNew ? <Status tone="new">새 플랜</Status> : null}
        {!p.name ? <Status tone="attention">이름 필요</Status> : null}
        {isOpdSpec(p.spec) ? <Tag title="OPD 에서 파일 구조를 따라 읽은 셋업 — OmniPC 정확도 대조 전이라 자동 변환·학습 내보내기는 막힙니다">{OPD_PLAN_TAG}</Tag> : null}
      </span>
    </div>
  )
}
