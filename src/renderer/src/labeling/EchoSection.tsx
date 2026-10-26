/**
 * 형상 에코 후보 (규격 3.2, 지침서 8절): 앱이 용접 형상(루트·캡 자리)과 빔 피복률로 찾은 띠 조각. 전문가는 승인·고침·거절만 한다.
 *   승인 = 기록 구분 '형상 에코' 기록으로 저장(앱 제안 승인 표시). 고침 = 스캔 구간·세부를 고친 뒤 승인. 거절 = 이 세션에서 목록에서 뺌.
 * 펼친 동안만 계산하고 영상에 후보 띠를 보인다(청록). 결함 기록과 겹치는 구간은 결함이 우선이라 이미 잘려 있다.
 * 블라인드 판독이면 띠 위 결함 단서(띠보다 센 곳·기록 기준 넘는 구간·최대 진폭)를 숨긴다(hideCues).
 */
import type { ViewerGroup } from '@shared/imaging'
import { GEOMETRIC_ECHO_KIND, codesOf, type EchoCandidate, type GeometricEchoKind } from '@shared/labels'
import { num } from '../lib/format'
import type { EchoEdit } from './panelState'
import { RangeField, SelectField } from './PanelParts'

export interface EchoSectionProps {
  open: boolean
  onOpen: (open: boolean) => void
  candidates: readonly EchoCandidate[] | null
  notes: readonly string[]
  groups: ReadonlyMap<number, ViewerGroup>
  edit: EchoEdit | null
  onEdit: (e: EchoEdit | null) => void
  onApprove: (c: EchoCandidate, edit: EchoEdit | null) => void
  onReject: (c: EchoCandidate) => void
  onGoto: (c: EchoCandidate) => void
  busy: boolean
  canSave: boolean
  /**
   * 블라인드 판독(판독 단계 블라인드·2인 독립 모드)이면 '띠보다 센 곳'·'기록 기준 넘는 구간' 단서를 숨긴다 —
   * 루트 띠 위 결함 후보 위치를 앱이 미리 알려 주면 블라인드 기준선이 앱에 끌려간다 (계획 4절, 지침서 13절). 띠 구간만 보인다
   */
  hideCues?: boolean
}

const ZONE: Record<EchoCandidate['zone'], string> = { root: '루트 자리', cap: '캡 자리' }

export function EchoSection(p: EchoSectionProps) {
  return (
    <section className="label-panel__section" aria-label="형상 에코 후보">
      <details className="label-details" open={p.open} onToggle={(e) => p.onOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>형상 에코 후보{p.open && p.candidates ? ` (${p.candidates.length})` : ''}</summary>
        {!p.open ? null : p.candidates === null ? (
          <p className="label-panel__empty">진폭을 읽는 중이거나 계산할 수 없습니다.</p>
        ) : p.candidates.length === 0 ? (
          <p className="label-panel__empty">남은 후보가 없습니다.</p>
        ) : (
          <ul className="label-rows">
            {p.candidates.map((c) => {
              const g = p.groups.get(c.groupId)
              const editing = p.edit?.id === c.id ? p.edit : null
              return (
                <li key={c.id} className="label-rows__item label-rows__item--col">
                  <button type="button" className="label-rows__text label-rows__link num" onClick={() => p.onGoto(c)} title="그 후보의 최대 칸으로 커서를 옮깁니다">
                    {g?.name ?? c.groupId} · {ZONE[c.zone]} · L{c.leg} · {num(c.scanStartMm)}–{num(c.scanEndMm)} mm{p.hideCues ? '' : ` · 최대 ${num(c.maxPct, 0)} %FSH${c.saturated ? ' 포화' : ''}`}
                  </button>
                  {!p.hideCues && c.needsCheck ? <span className="status status--attention">띠보다 센 곳 있음 — 띠 위 결함인지 확인</span> : null}
                  {!p.hideCues && c.strongRanges.length ? <span className="unit">기록 기준 넘는 구간 {c.strongRanges.length}개</span> : null}
                  {editing ? (
                    <div className="label-echo-edit">
                      <RangeField label="스캔 구간" start={editing.startMm} end={editing.endMm} onStart={(v) => p.onEdit({ ...editing, startMm: v })} onEnd={(v) => p.onEdit({ ...editing, endMm: v })} />
                      <SelectField<GeometricEchoKind>
                        label="세부"
                        value={editing.kind}
                        options={codesOf(GEOMETRIC_ECHO_KIND).map((id) => ({ id, name: GEOMETRIC_ECHO_KIND[id] }))}
                        onChange={(v) => v && p.onEdit({ ...editing, kind: v })}
                        title="원인을 확인하기 전에는 '기타' (지침서 8.1)"
                      />
                    </div>
                  ) : null}
                  <div className="label-actions">
                    <button type="button" className="btn btn--secondary" disabled={p.busy || !p.canSave || (editing !== null && !(editing.endMm > editing.startMm))} onClick={() => p.onApprove(c, editing)}>
                      {editing ? '고쳐서 승인' : '승인'}
                    </button>
                    {editing ? (
                      <button type="button" className="btn btn--ghost" onClick={() => p.onEdit(null)}>
                        고치기 그만
                      </button>
                    ) : (
                      <button type="button" className="btn btn--ghost" onClick={() => p.onEdit({ id: c.id, startMm: c.scanStartMm, endMm: c.scanEndMm, kind: c.kind })}>
                        고침
                      </button>
                    )}
                    <button type="button" className="btn btn--ghost" onClick={() => p.onReject(c)}>
                      거절
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {p.open && p.notes.length ? (
          <ul className="label-problems">
            {p.notes.map((n, i) => (
              <li key={i} className="status status--muted">
                {n}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  )
}
