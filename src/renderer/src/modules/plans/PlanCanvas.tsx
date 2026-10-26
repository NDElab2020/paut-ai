import { useState } from 'react'
import type { ScanPlanSpec } from '@shared/types'
import { GROUP_DASH, SetupDiagram } from '../../components/SetupDiagram'

/**
 * 단면 도식 + 그룹 선택. 그룹이 여러 개면 처음엔 첫 그룹만 보이고,
 * 체크한 그룹만 그린다 (여러 개 체크하면 선 모양을 달리해 겹쳐 그림).
 * 플랜이나 그룹 이름(파일 목록이 늦게 오면 바뀜)이 바뀌면 key 로 새로 만들어 선택을 초기화한다.
 */
export function PlanCanvas({ spec, groupNames }: { spec: ScanPlanSpec; groupNames: string[] }) {
  const n = spec.groups.length
  const nameOf = (i: number): string => groupNames[i] ?? `그룹 ${i + 1}`
  /** 셋업 요약과 같은 이름 순서 */
  const byName = spec.groups.map((_, i) => i).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ko', { numeric: true }))
  const first = byName.slice(0, 1)
  const [shown, setShown] = useState<number[]>(first)
  const toggle = (i: number): void =>
    setShown((prev) => byName.filter((x) => (x === i ? !prev.includes(i) : prev.includes(x))))
  const allShown = shown.length === n

  return (
    <div className="data-canvas plan-canvas">
      <div className="plan-canvas__head">
        <span className="plan-canvas__title">단면 · 탐촉자 배치</span>
        {n > 1 ? (
          <fieldset className="canvas-groups">
            <legend className="visually-hidden">도식에 표시할 그룹</legend>
            {byName.map((i) => {
              const k = shown.indexOf(i)
              return (
                <label key={i} className="canvas-groups__item">
                  <input type="checkbox" checked={k >= 0} onChange={() => toggle(i)} />
                  <span>{nameOf(i)}</span>
                  {k >= 0 && shown.length > 1 ? (
                    <svg className="canvas-groups__swatch" width="20" height="6" aria-hidden="true">
                      <line x1="0" y1="3" x2="20" y2="3" strokeDasharray={GROUP_DASH[k % GROUP_DASH.length] || undefined} />
                    </svg>
                  ) : null}
                </label>
              )
            })}
            <button
              type="button"
              className="canvas-groups__all"
              onClick={() => setShown(allShown ? first : byName)}
            >
              {allShown ? '첫 그룹만' : '모두 겹쳐 보기'}
            </button>
          </fieldset>
        ) : null}
      </div>
      {n > 1 && shown.length === 0 ? (
        <p className="plan-canvas__empty">도식에 표시할 그룹을 체크하세요</p>
      ) : (
        <SetupDiagram spec={spec} groupNames={groupNames} visibleGroups={shown} />
      )}
      <span className="data-canvas__meta">{n > 1 ? `그룹 ${shown.length}/${n} 표시 · ` : ''}도식 · 축척 근사</span>
    </div>
  )
}
