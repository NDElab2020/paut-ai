/**
 * '검토 구간' (지침서 11절): 검토 구간 도구(4)로 C/B-scan 을 끌어 스캔 구간을 정하고 종류를 고른다.
 *   검토 완료 = 그 구간을 끝까지 봤음 ('결함 없음'으로 쓰임 — 지금 C-scan 게이트의 펼친 깊이·레그 범위를 함께 저장)
 *   품질 불량 = 사유(커플링·누락·포화·잡음·시간 범위·감도)가 꼭 있어야 함 · 기준 미만 지시 = 보이지만 평가 기준 미만
 * 기록의 위치·길이·구분을 고치면(또는 결함 기록을 더하면) 겹치는 검토 완료 구간은 저장소가 자동으로 푼다('자동 풀림' 표시 — 다시 본 뒤 '다시 검토 완료로').
 * 메모·속성만 고친 것과 형상 에코 승인은 풀지 않는다.
 * 저장한 구간 '지우기'는 한 줄 확인을 거친다(검토 완료 구간은 학습에서 '결함 없음' 근거 — 잘못 눌러도 바로 사라지지 않게. 지시 표 '지움 표시'와 같은 방식,
 * 포커스는 '취소'로 갔다가 취소하면 원래 '지우기' 단추로 돌아온다).
 */
import { useRef, useState, type Dispatch } from 'react'
import type { ViewerGroup } from '@shared/imaging'
import { QUALITY_BAD_REASON, REVIEW_KIND, codesOf, type QualityBadReason, type ReviewGateRange, type ReviewInterval, type ReviewIntervalKind } from '@shared/labels'
import { num } from '../lib/format'
import type { ReviewForm } from './panelState'
import { MiniSeg, Problems, RangeField, Row, SelectField } from './PanelParts'
import type { LabelAction, LabelState } from './state'

export interface ReviewSectionProps {
  state: LabelState
  dispatch: Dispatch<LabelAction>
  form: ReviewForm
  onForm: (patch: Partial<ReviewForm>) => void
  groups: readonly ViewerGroup[]
  activeGroupId: number
  fullRange: [number, number] | null
  gate: ReviewGateRange | null
  /** 파일 게이트 (후처리 편집 없이) — 지금 게이트와 다르면 알린다 */
  fileGate?: ReviewGateRange | null
  problems: string[]
  canSave: boolean
  busy: boolean
  onSave: () => void
  reviews: readonly ReviewInterval[]
  onDelete: (v: ReviewInterval) => void
  /** 자동 풀린 검토 완료 구간을 다시 검토 완료로 (다시 본 뒤) */
  onUnrelease?: (v: ReviewInterval) => void
  groupName: (id: number | null) => string
}

const KIND_OPTIONS = codesOf(REVIEW_KIND).map((id) => ({ id, name: REVIEW_KIND[id] }))

export function ReviewSection(p: ReviewSectionProps) {
  const rv = p.state.draft.review
  const set = (patch: Partial<NonNullable<typeof rv>>): void => {
    const base = rv ?? { groupId: p.activeGroupId, scanStartMm: p.fullRange?.[0] ?? 0, scanEndMm: p.fullRange?.[1] ?? 0 }
    p.dispatch({ type: 'setReview', review: { ...base, ...patch } })
  }
  const live = p.reviews.filter((v) => !v.deleted).sort((a, b) => (a.groupId ?? -1) - (b.groupId ?? -1) || a.scanStartMm - b.scanStartMm)
  const [askDelete, setAskDelete] = useState<string | null>(null)
  const deleteBtns = useRef(new Map<string, HTMLButtonElement | null>())
  const cancelDelete = (uuid: string): void => {
    setAskDelete(null)
    deleteBtns.current.get(uuid)?.focus()
  }
  return (
    <>
      <section className="label-panel__section" aria-label="검토 구간 정하기">
        <div className="label-panel__headrow">
          <h3 className="label-panel__heading">검토 구간 — C/B-scan 끌기 (도구 4)</h3>
        </div>
        <MiniSeg<ReviewIntervalKind> label="구간 종류" value={p.form.kind} options={KIND_OPTIONS} returnFocus onChange={(v) => p.onForm({ kind: v })} />
        {p.form.kind === 'quality-bad' ? (
          <SelectField<QualityBadReason>
            label="사유"
            value={p.form.reason}
            options={codesOf(QUALITY_BAD_REASON).map((id) => ({ id, name: QUALITY_BAD_REASON[id] }))}
            allowEmpty="고르세요"
            onChange={(v) => p.onForm({ reason: v })}
          />
        ) : null}
        <SelectField<string>
          label="그룹"
          value={rv ? (rv.groupId === null ? 'all' : String(rv.groupId)) : String(p.activeGroupId)}
          options={[...p.groups.map((g) => ({ id: String(g.id), name: g.name })), { id: 'all', name: '모든 그룹' }]}
          onChange={(v) => set({ groupId: v === null || v === 'all' ? null : Number(v) })}
        />
        <RangeField
          label="스캔 구간"
          start={rv ? Math.round(rv.scanStartMm * 10) / 10 : null}
          end={rv ? Math.round(rv.scanEndMm * 10) / 10 : null}
          onStart={(v) => set({ scanStartMm: v })}
          onEnd={(v) => set({ scanEndMm: v })}
        />
        <div className="label-actions">
          <button type="button" className="btn btn--ghost" disabled={!p.fullRange} onClick={() => p.fullRange && set({ scanStartMm: p.fullRange[0], scanEndMm: p.fullRange[1] })}>
            전체 구간으로
          </button>
          {rv ? (
            <button type="button" className="btn btn--ghost" onClick={() => p.dispatch({ type: 'setReview', review: null })}>
              구간 지우기
            </button>
          ) : null}
        </div>
        {p.form.kind === 'reviewed' ? (
          <dl className="label-panel__list">
            <Row label="게이트" title="검토할 때 본 C-scan 게이트 (펼친 깊이, OmniPC 게이트 값 그대로). '결함 없음'은 이 범위 안에서만 씁니다">
              {p.gate ? `펼친 깊이 ${num(p.gate.depthTopMm)}–${num(p.gate.depthBottomMm)} mm · 레그 ${p.gate.legMin}–${p.gate.legMax}` : '—'}
            </Row>
          </dl>
        ) : null}
        {p.form.kind === 'reviewed' && p.gate && p.fileGate && (p.gate.depthTopMm !== p.fileGate.depthTopMm || p.gate.depthBottomMm !== p.fileGate.depthBottomMm) ? (
          <p className="label-panel__note status status--attention">
            지금 게이트가 파일 게이트({num(p.fileGate.depthTopMm)}–{num(p.fileGate.depthBottomMm)} mm)와 다릅니다. '결함 없음'은 저장할 때의 게이트 안에서만 쓰입니다 —
            루트·몸체 게이트로 다시 본 뒤라면 넓은 게이트로 돌리고 저장하세요.
          </p>
        ) : null}
        <div className="label-field label-field--wide">
          <label htmlFor="label-review-note">메모</label>
          <input id="label-review-note" className="input" value={p.form.note} maxLength={500} onChange={(e) => p.onForm({ note: e.target.value })} />
        </div>
        <Problems problems={rv ? p.problems : []} />
        <div className="label-actions">
          <button type="button" className="btn btn--primary" disabled={!p.canSave || p.busy} onClick={p.onSave}>
            구간 저장
          </button>
        </div>
        <p className="label-panel__note">검토 완료로 적은 구간 안에서 아무것도 적지 않은 곳은 '결함 없음'으로 쓰입니다. 꼼꼼히 본 구간만 적습니다.</p>
      </section>

      <section className="label-panel__section" aria-label="저장한 검토 구간">
        <div className="label-panel__headrow">
          <h3 className="label-panel__heading">저장한 구간 ({live.length})</h3>
        </div>
        {live.length ? (
          <ul className="label-rows">
            {live.map((v) => (
              <li key={v.uuid} className="label-rows__item">
                <span className="label-rows__text num" title={v.note || undefined}>
                  {REVIEW_KIND[v.kind]}
                  {v.reason ? ` (${QUALITY_BAD_REASON[v.reason]})` : ''} · {p.groupName(v.groupId)} · {num(v.scanStartMm)}–{num(v.scanEndMm)} mm
                  {v.released ? (
                    <span className="status status--attention label-rows__sub" title="검토 뒤 그 구간 기록을 고쳐 저장소가 자동으로 풀었습니다. 다시 검토하고 새로 표시하세요">
                      자동 풀림
                    </span>
                  ) : null}
                </span>
                {v.released && p.onUnrelease ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={p.busy}
                    title="그 구간을 다시 끝까지 본 뒤 검토 완료로 되돌립니다"
                    onClick={() => p.onUnrelease?.(v)}
                  >
                    다시 검토 완료로
                  </button>
                ) : null}
                <button
                  ref={(el) => {
                    deleteBtns.current.set(v.uuid, el)
                  }}
                  type="button"
                  className="btn btn--ghost"
                  disabled={p.busy}
                  aria-label={`${REVIEW_KIND[v.kind]} ${num(v.scanStartMm)}–${num(v.scanEndMm)} mm 지우기`}
                  aria-expanded={askDelete === v.uuid}
                  onClick={() => setAskDelete(askDelete === v.uuid ? null : v.uuid)}
                >
                  지우기
                </button>
                {askDelete === v.uuid ? (
                  <div className="notice notice--accent label-rows__confirm" role="alert">
                    <div className="notice__body">
                      <p>
                        {REVIEW_KIND[v.kind]} {num(v.scanStartMm)}–{num(v.scanEndMm)} mm 구간({p.groupName(v.groupId)})을 지웁니다.
                        {v.kind === 'reviewed' ? " 이 구간의 '결함 없음' 근거가 없어집니다." : ''}
                      </p>
                      <div className="label-actions">
                        <button
                          type="button"
                          className="btn btn--secondary"
                          disabled={p.busy}
                          onClick={() => {
                            setAskDelete(null)
                            p.onDelete(v)
                          }}
                        >
                          지우기
                        </button>
                        {/* 되돌릴 수 없는 작업이라 포커스는 '취소'에 (Enter 를 한 번 더 눌러도 지워지지 않게) */}
                        <button type="button" className="btn btn--ghost" autoFocus onClick={() => cancelDelete(v.uuid)}>
                          취소
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="label-panel__empty">아직 없습니다.</p>
        )}
      </section>
    </>
  )
}
