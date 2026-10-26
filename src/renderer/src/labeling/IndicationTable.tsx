/**
 * 지시 표 (후처리 2차 6단계 흡수): 이 세트의 기록 목록. 행을 누르면 그 기록의 최대 진폭 스캔·빔으로 커서가 가고 영상에 '고른 기록'이 진하게 보인다.
 * 고른 기록 아래: 요약·표시(재확인 필요·좌표 규칙 바뀜·대조 전·엑셀)·고치기·지움 표시·화면 스냅샷 불러오기, 관측 표(그룹 × 레그)를 확인·수정.
 * 관측 표: 앱이 계산한 상태(보임·약함·안 보임)를 전문가가 누르면 그 상태로 '확인' 저장. 확인이 낡았으면(기록 위치가 바뀜) 재확인 필요.
 *   '이 그룹 확인'은 그룹마다 따로 누른다(전체를 한 번에 확인하는 버튼은 두지 않음 — 확인이 형식적인 클릭이 되지 않게).
 * 행 포커스에서 Delete 는 뷰어의 '초안 점 지우기'로 가지 않는다(NdeViewer 가 .label-side 안 키는 라벨 키로 받지 않음).
 */
import { useRef, useState } from 'react'
import { CONFIDENCE, HEIGHT_METHOD, OBSERVATION_STATUS, RECORD_KIND, type IndicationRecord, type ObservationStatus } from '@shared/labels'
import { num } from '../lib/format'
import { rowKeyHandler } from '../lib/rowNav'
import type { ObservationGroupView, ObservationLegView } from './analysis'
import { MiniSeg, stopIfHandled } from './PanelParts'
import { recordFlags, type RecordFlag, type RecordFlagGroup } from './record'
import { recordDetail } from './recordText'

export interface IndicationTableProps {
  records: readonly IndicationRecord[]
  /** 지시 번호 (Map 순서 = 표 순서, record.ts recordNumbers) */
  numbers: ReadonlyMap<string, string>
  selectedUuid: string | null
  editingUuid: string | null
  groups: ReadonlyMap<number, RecordFlagGroup>
  groupName: (id: number | null) => string
  onSelect: (r: IndicationRecord) => void
  onEdit: (r: IndicationRecord) => void
  onDelete: (r: IndicationRecord) => void
  onSnapshot: (r: IndicationRecord) => void
  hasSnapshot: (r: IndicationRecord) => boolean
  /** 고른 기록으로 갈 때의 알림 (그룹을 모르는 엑셀 기록 → '그룹 모름 — 지금 그룹으로 이동'). 없으면 null */
  gotoNote?: (r: IndicationRecord) => string | null
  observations: ObservationGroupView[] | null
  observationNote: string | null
  onObserve: (leg: ObservationLegView, status: ObservationStatus) => void
  /** 한 그룹의 계산 상태를 그대로 확인 (그룹마다 — 모든 그룹을 한 번에 확인하지 않게) */
  onConfirmGroup: (groupId: number) => void
  busy: boolean
  /** 보기만 (확정·제출한 세트) — 고치기·지움 표시·관측 확인을 끈다 */
  readOnly?: boolean
  /** 2인 독립 모드: 기록에 남은 앱 제안도 숨긴다 */
  hideSuggestions?: boolean
  loading: boolean
}

const STATUS_OPTIONS: Array<{ id: ObservationStatus; name: string }> = [
  { id: 'visible', name: OBSERVATION_STATUS.visible },
  { id: 'weak', name: OBSERVATION_STATUS.weak },
  { id: 'not-visible', name: OBSERVATION_STATUS['not-visible'] }
]

function Flags({ flags }: { flags: RecordFlag[] }) {
  if (!flags.length) return null
  return (
    <span className="label-flags">
      {flags.map((f) => (
        <span key={f.code} className={f.code === 'recheck' || f.code === 'coord-rules' || f.code === 'thickness' ? 'status status--attention' : 'tag'} title={f.title}>
          {f.text}
        </span>
      ))}
    </span>
  )
}

export function IndicationTable(p: IndicationTableProps) {
  const [askDelete, setAskDelete] = useState<string | null>(null)
  const deleteBtnRef = useRef<HTMLButtonElement>(null)
  const live = new Map(p.records.filter((r) => !r.deleted).map((r) => [r.uuid, r]))
  const list = [...p.numbers.keys()].map((u) => live.get(u)).filter((r): r is IndicationRecord => !!r)
  const sel = list.find((r) => r.uuid === p.selectedUuid) ?? null
  const byId = new Map(list.map((r) => [r.uuid, r]))
  const onKeyDown = stopIfHandled(
    rowKeyHandler({
      onSelect: (k) => {
        const r = byId.get(k)
        if (r) p.onSelect(r)
      },
      onActivate: (k) => {
        const r = byId.get(k)
        if (r) p.onEdit(r)
      }
    })
  )
  return (
    <section className="label-panel__section" aria-label="지시 표">
      <div className="label-panel__headrow">
        <h3 className="label-panel__heading">지시 표 ({list.length})</h3>
        {p.loading ? <span className="label-panel__aside unit">읽는 중</span> : null}
      </div>
      {list.length ? (
        <table className="label-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>구분</th>
              <th className="num">스캔 mm</th>
              <th className="num">길이</th>
            </tr>
          </thead>
          <tbody onKeyDown={onKeyDown}>
            {list.map((r) => {
              const n = p.numbers.get(r.uuid)
              const flags = recordFlags(r, p.groups)
              const warn = flags.some((f) => f.code === 'recheck' || f.code === 'coord-rules' || f.code === 'unverified')
              return (
                <tr
                  key={r.uuid}
                  data-row={r.uuid}
                  tabIndex={r.uuid === p.selectedUuid || (!p.selectedUuid && r === list[0]) ? 0 : -1}
                  aria-selected={r.uuid === p.selectedUuid}
                  className={r.uuid === p.editingUuid ? 'is-editing' : undefined}
                  onClick={() => p.onSelect(r)}
                  onDoubleClick={() => p.onEdit(r)}
                  title={`${RECORD_KIND[r.kind]} · ${recordDetail(r)}${flags.length ? ` · ${flags.map((f) => f.text).join(' · ')}` : ''} — 누르면 그 자리로, 두 번 누르거나 Enter 면 고치기`}
                >
                  <td className="num">
                    {n ?? '—'}
                    {warn ? <span className="label-table__mark" aria-label="표시 있음"> ○</span> : null}
                  </td>
                  <td className="label-table__kind">{recordDetail(r)}</td>
                  <td className="num">
                    {num(r.derived.scanStartMm)}–{num(r.derived.scanEndMm)}
                  </td>
                  <td className="num">{num(r.length.valueMm)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="label-panel__empty">{p.loading ? '읽는 중입니다.' : '이 세트에 기록이 없습니다.'}</p>
      )}

      {sel ? (
        <div className="label-detail" aria-label={`기록 #${p.numbers.get(sel.uuid) ?? ''}`}>
          <p className="label-detail__title">
            #{p.numbers.get(sel.uuid)} {RECORD_KIND[sel.kind]} · {recordDetail(sel)}
          </p>
          <Flags flags={recordFlags(sel, p.groups)} />
          {(() => {
            const note = p.gotoNote?.(sel) ?? null
            return note ? <p className="label-panel__note">{note}</p> : null
          })()}
          <dl className="label-panel__list">
            <div className="label-panel__row">
              <dt>위치</dt>
              <dd className="num">
                V {num(sel.derived.vMinMm)}~{num(sel.derived.vMaxMm)} · 깊이 {num(sel.derived.depthTopMm)}~{num(sel.derived.depthBottomMm)} mm
              </dd>
            </div>
            <div className="label-panel__row">
              <dt>신호</dt>
              <dd className="num">
                {sel.signal.maxAmplitudePct === null ? '—' : `${num(sel.signal.maxAmplitudePct)} %FSH`}
                {sel.signal.saturated ? ' · 포화' : ''}
                {sel.signal.peak?.groupId != null ? ` · ${p.groupName(sel.signal.peak.groupId)}` : ''}
              </dd>
            </div>
            {sel.kind === 'defect' ? (
              <div className="label-panel__row">
                <dt>높이</dt>
                <dd className="num">
                  {sel.height.method ? HEIGHT_METHOD[sel.height.method] : '—'}
                  {sel.height.valueMm !== null ? ` · ${num(sel.height.valueMm, 2)} mm` : ''}
                </dd>
              </div>
            ) : null}
            <div className="label-panel__row">
              <dt>확신도</dt>
              <dd>
                {CONFIDENCE[sel.existenceConfidence]}
                {sel.typeConfidence ? ` · 종류 ${CONFIDENCE[sel.typeConfidence]}` : ''}
              </dd>
            </div>
            {sel.suggestions.length && !p.hideSuggestions ? (
              <div className="label-panel__row">
                <dt>앱 제안</dt>
                <dd className="num">
                  {(() => {
                    const s = sel.suggestions.find((x) => x.target === 'length')
                    if (!s) return '—'
                    return s.suggestedMm === null ? '제안 불가였음' : `${num(s.suggestedMm)} mm · ${s.acceptedUnchanged ? '그대로 받음' : `수정 ${num(s.correctionMm)} mm`}`
                  })()}
                </dd>
              </div>
            ) : null}
            {sel.note ? (
              <div className="label-panel__row">
                <dt>메모</dt>
                <dd>{sel.note}</dd>
              </div>
            ) : null}
          </dl>
          <div className="label-actions">
            {p.readOnly ? null : (
              <button type="button" className="btn btn--secondary" disabled={p.busy || p.editingUuid === sel.uuid} onClick={() => p.onEdit(sel)}>
                고치기
              </button>
            )}
            {p.hasSnapshot(sel) ? (
              <button type="button" className="btn btn--ghost" onClick={() => p.onSnapshot(sel)} title="그 기록을 저장할 때의 이득·게이트·색표로 화면을 바꿉니다 (후처리 되돌리기 이력은 비워짐)">
                그때 화면으로
              </button>
            ) : null}
            {p.readOnly ? null : (
              <button ref={deleteBtnRef} type="button" className="btn btn--ghost" disabled={p.busy} aria-expanded={askDelete === sel.uuid} onClick={() => setAskDelete(sel.uuid)}>
                지움 표시
              </button>
            )}
          </div>
          {askDelete === sel.uuid ? (
            <div className="notice notice--accent" role="alert">
              <div className="notice__body">
                <p>기록 #{p.numbers.get(sel.uuid)} 에 지움 표시를 합니다. 관측 행도 함께 지움 표시되고, 겹치는 검토 완료 구간은 풀립니다. 다른 PC 와 합칠 때도 지운 것으로 전해집니다.</p>
                <div className="label-actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      setAskDelete(null)
                      p.onDelete(sel)
                    }}
                  >
                    지움 표시하기
                  </button>
                  {/* 되돌리기 어려운 작업이라 포커스는 '취소'에, 취소하면 '지움 표시' 단추로 돌아간다 (키보드만으로 이어서 일하게) */}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    autoFocus
                    onClick={() => {
                      setAskDelete(null)
                      deleteBtnRef.current?.focus()
                    }}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="label-panel__headrow">
            <h4 className="label-panel__heading">관측 표 (그룹 × 레그 · 최대 %FSH)</h4>
          </div>
          {p.observationNote ? <p className="label-panel__note">{p.observationNote}</p> : null}
          {p.observations?.length ? (
            <ul className="label-obs">
              {p.observations.map((g) =>
                g.blocked ? (
                  <li key={`b${g.groupId}`} className="label-obs__blocked">
                    {g.name}: {g.blocked}
                  </li>
                ) : (
                  <li key={`g${g.groupId}`} className="label-obs__group">
                    <span className="label-obs__gname">
                      {g.name}
                      {!p.readOnly && g.legs.some((l) => !l.expertConfirmed) ? (
                        <>
                          {' '}
                          <button
                            type="button"
                            className="btn btn--link"
                            disabled={p.busy}
                            onClick={() => p.onConfirmGroup(g.groupId)}
                            title="이 그룹의 레그를 하나씩 영상에서 본 뒤, 계산한 상태 그대로 확인으로 저장합니다"
                          >
                            이 그룹 확인
                          </button>
                        </>
                      ) : null}
                    </span>
                    <ul className="label-obs">
                      {g.legs.map((l) => (
                        <li key={l.leg} className="label-obs__row">
                          <span
                            className="label-obs__name num"
                            title={`레그 ${l.leg} · 계산: ${OBSERVATION_STATUS[l.computedStatus]}${l.peakPct !== null ? ` · 최대 ${num(l.peakPct)} %FSH` : ''}${l.saturated ? ' · 포화' : ''}`}
                          >
                            {/* '최대 %FSH' 는 위 제목에 한 번 — 행은 'L2 60 %' 로 짧게 (좁은 패널에서 값이 잘리지 않게) */}
                            L{l.leg} <span className="unit">{l.peakPct !== null ? `${num(l.peakPct, 0)} %` : '—'}</span>
                          </span>
                          <MiniSeg<ObservationStatus>
                            label={`${g.name} 레그 ${l.leg} 관측 상태`}
                            value={l.status}
                            options={STATUS_OPTIONS}
                            onChange={(v) => {
                              if (!p.readOnly) p.onObserve(l, v)
                            }}
                            className="label-obs__seg"
                          />
                          <span
                            className={l.stale ? 'status status--attention' : l.expertConfirmed ? 'status status--ok' : 'status status--muted'}
                            title={l.stale ? '기록 위치가 바뀌어 전에 확인한 상태를 쓰지 않습니다' : l.expertConfirmed ? '전문가가 확인한 상태' : '앱이 계산한 상태 (아직 확인 안 함)'}
                          >
                            {l.stale ? '재확인' : l.expertConfirmed ? '확인' : '계산'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              )}
            </ul>
          ) : null}
        </div>
      ) : list.length ? (
        <p className="label-panel__note">행을 누르면 그 기록 자리로 가고 관측 표를 봅니다. 두 번 누르면 고칩니다.</p>
      ) : null}
    </section>
  )
}
