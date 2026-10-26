/** 정리 미리보기의 핵심: 파일이 어느 플랜으로 가는지(기존/새 플랜)와 그 안의 시편만 보여 준다 */
import { useState } from 'react'
import type { ImportItemPreview, ImportPreview, NewPlanCandidate, ScanPlan, SpecDifference } from '@shared/types'
import { sanitizeSpecimenId } from '@shared/ids'
import { josa } from '@shared/text'
import { Status } from '../../components/Status'
import { CATEGORY_LABEL, DASH } from '../../lib/format'
import { editName, type Edits } from './store'

function show(v: SpecDifference['existing'], path = ''): string {
  if (v === null || v === undefined) return DASH
  if (path.endsWith('angularOpeningDeg') && v === 360) return '360 (전체 원주)'
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('-', '−')
  if (v === 'Normal') return '정방향'
  if (v === 'Reverse') return '역방향'
  return v
}

/** 시편 ID 별 파일 수 (화면에 보이는 그대로의 폴더 이름 기준) */
function specimensOf(items: ImportItemPreview[], edits: Edits): { id: string; n: number; guessed: boolean }[] {
  const map = new Map<string, { id: string; n: number; guessed: boolean }>()
  for (const i of items) {
    const e = edits.items[i.itemId]
    const id = sanitizeSpecimenId(e?.specimenId ?? i.duplicateOf?.specimenId ?? '') || '시편 ID 없음'
    const cur = map.get(id) ?? { id, n: 0, guessed: false }
    cur.n++
    cur.guessed ||= e?.source === 'filename'
    map.set(id, cur)
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id, 'ko', { numeric: true }))
}

function Specimens({ items, edits }: { items: ImportItemPreview[]; edits: Edits }) {
  const list = specimensOf(items, edits)
  const guessed = list.some((s) => s.guessed)
  return (
    <div className="plan-dest__specimens">
      <span className="t-caption">시편</span>
      {list.map((s) => (
        <span key={s.id} className="tag" title={s.guessed ? '파일명에서 추정한 시편 ID' : undefined}>
          {s.id}
          {s.n > 1 ? <span className="text-subtle">&nbsp;×{s.n}</span> : null}
          {s.guessed ? <span className="text-subtle">&nbsp;추정</span> : null}
        </span>
      ))}
      {guessed ? <span className="t-caption">추정한 시편 ID 는 아래 '파일별로 보기·고치기'에서 바꿀 수 있습니다</span> : null}
    </div>
  )
}

function NewName({ plan, name, invalid }: { plan: NewPlanCandidate; name: string; invalid: boolean }) {
  const [editing, setEditing] = useState(invalid)
  const id = `np-${plan.key}`
  if (!editing && !invalid) {
    return (
      <span className="plan-dest__name">
        {name}
        <button type="button" className="btn btn--link plan-dest__rename" onClick={() => setEditing(true)}>
          이름 바꾸기
        </button>
      </span>
    )
  }
  return (
    <span className="plan-dest__name plan-dest__name--edit">
      <label className="visually-hidden" htmlFor={id}>
        새 플랜 {plan.provisionalPlanId} 이름
      </label>
      <input
        id={id}
        className="input"
        value={name}
        maxLength={120}
        autoFocus={!invalid}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => editName(plan.key, e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === 'Escape') && name.trim()) setEditing(false)
        }}
        onBlur={() => name.trim() && setEditing(false)}
      />
      {invalid ? <span className="field__error">플랜 이름을 입력하세요.</span> : null}
    </span>
  )
}

function Differences({ plan }: { plan: NewPlanCandidate }) {
  const n = plan.nearestPlan
  if (!n) return <p className="t-caption">저장소의 첫 스캔플랜이 됩니다.</p>
  return (
    <details className="plan-dest__diff">
      <summary>
        {josa(n.planId, '과/와')} 다른 점 <span className="num">{n.differences.length}</span>가지
        {n.withinTolerance ? <span className="text-accent"> · 반올림 차이뿐이라 같은 플랜일 수 있습니다</span> : null}
      </summary>
      <div className="table-wrap">
        <table className="table table--compact">
          <thead>
            <tr>
              <th>범주</th>
              <th>항목</th>
              <th className="num">기존 {n.planId}</th>
              <th className="num">이번 파일</th>
            </tr>
          </thead>
          <tbody>
            {n.differences.map((d) => (
              <tr key={d.path} title={d.path}>
                <td className="text-subtle">{CATEGORY_LABEL[d.category]}</td>
                <td>{d.label}</td>
                <td className="num">{show(d.existing, d.path)}</td>
                <td className="num is-primary">{show(d.incoming, d.path)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export function PlanDestinations(props: {
  preview: ImportPreview
  edits: Edits
  included: ImportItemPreview[]
  badPlans: ReadonlySet<string>
  plans: Map<string, ScanPlan>
}) {
  const { preview, edits, included, plans } = props
  const restores = preview.items.filter((i) => i.verdict === 'missing-copy')

  const existingIds = [
    ...new Set([
      ...included.filter((i) => i.verdict === 'match-existing').map((i) => i.matchedPlanId!),
      ...restores.map((i) => i.duplicateOf?.planId).filter((x): x is string => !!x)
    ])
  ].sort()
  const newPlans = preview.newPlans.filter((n) => included.some((i) => i.newPlanKey === n.key))

  if (existingIds.length + newPlans.length === 0) {
    return <p className="text-subtle">정리할 파일이 없습니다. 아래에서 건너뛴 이유를 확인하세요.</p>
  }

  return (
    <div className="plan-dests">
      {newPlans.map((n) => {
        const items = included.filter((i) => i.newPlanKey === n.key)
        return (
          <section key={n.key} className="plan-dest" aria-label={`새 플랜 ${n.provisionalPlanId}`}>
            <div className="plan-dest__head">
              <Status tone="new">새 플랜</Status>
              <span className="plan-dest__id">{n.provisionalPlanId}</span>
              <NewName plan={n} name={edits.names[n.key] ?? ''} invalid={props.badPlans.has(n.key)} />
              <span className="toolbar__spacer" />
              <span className="plan-dest__count num">파일 {items.length}개</span>
            </div>
            <Specimens items={items} edits={edits} />
            <Differences plan={n} />
          </section>
        )
      })}
      {existingIds.map((id) => {
        const items = included.filter((i) => i.verdict === 'match-existing' && i.matchedPlanId === id)
        const back = restores.filter((i) => i.duplicateOf?.planId === id)
        return (
          <section key={id} className="plan-dest" aria-label={`기존 플랜 ${id}`}>
            <div className="plan-dest__head">
              <span className="plan-dest__id">{id}</span>
              <span className="plan-dest__name">{plans.get(id)?.name ?? ''}</span>
              <span className="toolbar__spacer" />
              <span className="plan-dest__count num">
                {items.length > 0 ? `기존 플랜에 ${items.length}개 추가` : ''}
                {items.length > 0 && back.length > 0 ? ' · ' : ''}
                {back.length > 0 ? `사본 ${back.length}개 복원` : ''}
              </span>
            </div>
            <Specimens items={[...items, ...back]} edits={edits} />
          </section>
        )
      })}
    </div>
  )
}
