/**
 * 검수 비교 행 표: 짝 · A 만 · B 만 (부록 A 쌍 판정 표와 같은 행 ID). 펼치면 두 쪽 기록 세부·매칭 계산값·영상으로 보기.
 * 확정 모드(decide)에서는 행마다 Level III 결정을 고르고, 합침이면 칸 묶음마다 A·B 를 고른다.
 */
import { Fragment, useState } from 'react'
import type { ReviewComparison } from '@shared/api'
import { CONFIDENCE, HEIGHT_METHOD, JUDGMENT_CHARACTER, LENGTH_METHOD } from '@shared/labels/codes'
import {
  MERGE_FIELDS,
  MERGE_FIELD_LABEL,
  type AdjudicationDecision,
  type AdjudicationRowResult,
  type ReviewRow,
  type ReviewUnit
} from '@shared/labels/review'
import type { IndicationRecord } from '@shared/labels/types'
import { Icon } from '../../components/Icon'
import { Status, Tag } from '../../components/Status'
import { DASH } from '../../lib/format'
import {
  CHOICE_SHORT,
  choicesFor,
  fixed,
  outcomeShort,
  outcomeTone,
  signed,
  typeAgreeText,
  typeName,
  unitLine,
  type RowFilter
} from './reviewFormat'

const ROW_STATUS_TEXT: Record<AdjudicationRowResult['status'], string> = {
  final: '확정',
  rejected: '결함 아님',
  deferred: '보류',
  undecided: '결정 안 함',
  invalid: '맞지 않음'
}

export function rowMatchesFilter(r: ReviewRow, f: RowFilter, decided: boolean): boolean {
  if (f === 'all') return true
  if (f === 'pair' || f === 'only-a' || f === 'only-b') return r.kind === f
  if (f === 'differ') return typeAgreeText(r).differ
  return !decided
}

function RecordDetail(props: { r: IndicationRecord; side: 'A' | 'B'; canView: boolean; onView: () => void }) {
  const r = props.r
  const len = r.length.valueMm !== null ? `${fixed(r.length.valueMm)} mm${r.length.method ? ` · ${LENGTH_METHOD[r.length.method]}` : ''}` : DASH
  const h = r.height.method
    ? `${r.height.valueMm !== null ? `${fixed(r.height.valueMm)} mm · ` : ''}${HEIGHT_METHOD[r.height.method]}`
    : DASH
  const amp = r.signal.maxAmplitudePct !== null ? `${fixed(r.signal.maxAmplitudePct)} %FSH${r.signal.saturated ? ' · 포화' : ''}` : DASH
  return (
    <div className="labels-review__rec">
      <p className="labels-review__rec-head">
        <span className="text-strong">
          {props.side} · 지시 {r.externalRef ?? r.uuid.slice(0, 8)}
        </span>
        <button
          type="button"
          className="btn btn--link"
          disabled={!props.canView}
          title={props.canView ? '이미지 보기로 이 기록 위치를 엽니다' : '이 PC 저장소에 파일이 없어 영상을 열 수 없습니다'}
          onClick={props.onView}
        >
          영상으로 보기
        </button>
      </p>
      <dl className="kv labels-review__kv">
        <dt>스캔 (mm)</dt>
        <dd>
          {fixed(r.derived.scanStartMm)}–{fixed(r.derived.scanEndMm)}
        </dd>
        <dt>깊이 (mm)</dt>
        <dd>{r.derived.depthTopMm !== null || r.derived.depthBottomMm !== null ? `${fixed(r.derived.depthTopMm)}–${fixed(r.derived.depthBottomMm)}` : DASH}</dd>
        <dt>길이</dt>
        <dd>{len}</dd>
        <dt>높이</dt>
        <dd>{h}</dd>
        <dt>종류</dt>
        <dd>
          {typeName(r.defectType)}
          {r.character.value ? ` · ${JUDGMENT_CHARACTER[r.character.value]}` : ''}
        </dd>
        <dt>확신도</dt>
        <dd>
          존재 {CONFIDENCE[r.existenceConfidence]} · 종류 {r.typeConfidence ? CONFIDENCE[r.typeConfidence] : DASH}
        </dd>
        <dt>최대 진폭</dt>
        <dd>{amp}</dd>
        {r.note ? (
          <>
            <dt>메모</dt>
            <dd className="labels-reason">{r.note}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}

function UnitCell({ u }: { u: ReviewUnit | null }) {
  if (!u) return <span className="text-faint">{DASH}</span>
  const line = unitLine(u)
  return (
    <span className="labels-review__unit" title={`${line}${u.labelerId ? `\n라벨러 ${u.labelerId}` : ''}`}>
      {line}
      {!u.item.counted ? (
        <>
          {' '}
          <Tag>참고</Tag>
        </>
      ) : null}
    </span>
  )
}

export function ReviewRows(props: {
  comparison: ReviewComparison
  mode: 'compare' | 'decide'
  filter: RowFilter
  decisions: Readonly<Record<string, AdjudicationDecision>>
  onDecide?: (rowId: string, d: AdjudicationDecision | null) => void
  /** '남은 행 기본값 채우기'로 채운 행 (직접 고르면 빠짐) */
  autoFilled?: ReadonlySet<string>
  rowResults?: ReadonlyMap<string, AdjudicationRowResult>
  disabled?: boolean
  canView: (sha256: string) => boolean
  onView: (r: IndicationRecord) => void
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const c = props.comparison.comparison
  const decide = props.mode === 'decide'
  const multiFile = props.comparison.files.length > 1
  const rows = c.rows.filter((r) => rowMatchesFilter(r, props.filter, props.decisions[r.id] !== undefined))
  // ▸ · 행 · 판정 · A · B · Δ중심 · Δ길이 · (Δ깊이 | 결정) · 종류 · 영상 (+ 파일)
  const cols = 10 + (multiFile ? 1 : 0)
  const toggle = (id: string): void => {
    const n = new Set(open)
    if (!n.delete(id)) n.add(id)
    setOpen(n)
  }
  const firstRecord = (r: ReviewRow): IndicationRecord | null => (r.a ?? r.b)?.records[0] ?? null

  if (rows.length === 0) return <p className="t-caption labels-review__none">이 거르기에 맞는 행이 없습니다.</p>

  return (
    <div className="table-wrap labels-review__table-wrap">
      <table className={`table table--compact labels-review-table${decide ? ' labels-review-table--decide' : ''}${multiFile ? '' : ' labels-review-table--one'}`} aria-label="비교 행 (짝 · A 만 · B 만)">
        <colgroup>
          <col className="labels-review-col--x" />
          <col className="labels-review-col--id" />
          <col className="labels-review-col--outcome" />
          {multiFile ? <col className="labels-review-col--file" /> : null}
          <col />
          <col />
          <col className="labels-review-col--num" />
          <col className="labels-review-col--num" />
          {decide ? null : <col className="labels-review-col--num" />}
          <col className="labels-review-col--type" />
          {decide ? <col className="labels-review-col--decide" /> : null}
          <col className="labels-review-col--view" />
        </colgroup>
        <thead>
          <tr>
            <th className="col-check">
              <span className="visually-hidden">펼치기</span>
            </th>
            <th>행</th>
            <th>판정</th>
            {multiFile ? <th>파일</th> : null}
            <th>A {c.labelers.a ? `(${c.labelers.a})` : ''}</th>
            <th>B {c.labelers.b ? `(${c.labelers.b})` : ''}</th>
            <th className="num" title="B − A, 스캔 위치 중심 (mm)">
              Δ중심
            </th>
            <th className="num" title="B − A, 길이 (mm)">
              Δ길이
            </th>
            {decide ? null : (
              <th className="num" title="B − A, 깊이 중심 (mm)">
                Δ깊이
              </th>
            )}
            <th>종류</th>
            {decide ? <th>결정</th> : null}
            <th>
              <span className="visually-hidden">영상</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.id)
            const d = props.decisions[r.id]
            const res = props.rowResults?.get(r.id)
            const ta = typeAgreeText(r)
            const rec = firstRecord(r)
            const files = [...new Set([...(r.a?.fileNames ?? []), ...(r.b?.fileNames ?? [])])].join(', ')
            return (
              <Fragment key={r.id}>
                <tr className={isOpen ? 'is-selected' : undefined}>
                  <td className="col-check">
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      aria-expanded={isOpen}
                      aria-label={`${r.id} ${isOpen ? '접기' : '펼치기'}`}
                      title={isOpen ? '접기' : '두 쪽 기록 보기'}
                      onClick={() => toggle(r.id)}
                    >
                      <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
                    </button>
                  </td>
                  <td className="mono">{r.id}</td>
                  <td>
                    <Status tone={outcomeTone(r.outcome)}>{outcomeShort(r.outcome, c.purpose)}</Status>
                  </td>
                  {multiFile ? (
                    <td className="truncate" title={files}>
                      {files}
                    </td>
                  ) : null}
                  <td className="truncate">
                    <UnitCell u={r.a} />
                  </td>
                  <td className="truncate">
                    <UnitCell u={r.b} />
                  </td>
                  <td className="num">{signed(r.diff.scanCenter)}</td>
                  <td className="num">{signed(r.diff.length)}</td>
                  {decide ? null : <td className="num">{signed(r.diff.depthCenter)}</td>}
                  <td>{ta.differ ? <Status tone="attention">{ta.text}</Status> : <span className={ta.text === DASH ? 'text-faint' : undefined}>{ta.text}</span>}</td>
                  {decide ? (
                    <td className="labels-review__dec">
                      <span className="select labels-review__choice">
                        <select
                          aria-label={`${r.id} 결정`}
                          value={d?.choice ?? ''}
                          disabled={props.disabled}
                          onChange={(e) => {
                            const v = e.target.value as AdjudicationDecision['choice'] | ''
                            if (v === '') props.onDecide?.(r.id, null)
                            else {
                              props.onDecide?.(r.id, {
                                rowId: r.id,
                                choice: v,
                                ...(v === 'merge' ? { fields: d?.fields ?? {} } : {}),
                                ...(d?.physicalDefectId !== undefined && v !== 'neither' ? { physicalDefectId: d.physicalDefectId } : {}),
                                ...(d?.note ? { note: d.note } : {})
                              })
                              if (v === 'merge' && !isOpen) toggle(r.id)
                            }
                          }}
                        >
                          <option value="">고르지 않음</option>
                          {choicesFor(r).map((ch) => (
                            <option key={ch} value={ch}>
                              {CHOICE_SHORT[ch]}
                            </option>
                          ))}
                        </select>
                      </span>
                      {d && props.autoFilled?.has(r.id) ? (
                        <>
                          {' '}
                          <span className="tag" title="'남은 행 기본값 채우기'로 채운 결정입니다. 직접 고르면 표시가 없어집니다">
                            자동
                          </span>
                        </>
                      ) : null}
                      {res && res.status === 'invalid' ? (
                        <>
                          {' '}
                          <Status tone="error" title={res.messages.join('\n')}>
                            {ROW_STATUS_TEXT[res.status]}
                          </Status>
                        </>
                      ) : null}
                    </td>
                  ) : null}
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      disabled={!rec || !props.canView(rec.sha256)}
                      aria-label={`${r.id} 영상으로 보기`}
                      title={rec && props.canView(rec.sha256) ? '영상으로 보기 (이미지 보기로 이동)' : '이 PC 저장소에 파일이 없습니다'}
                      onClick={() => rec && props.onView(rec)}
                    >
                      <Icon name="image" />
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="detail-row">
                    <td colSpan={cols}>
                      <div className="labels-review__detail">
                        <p className="t-caption">
                          {r.geometry
                            ? `스캔 간격 ${fixed(r.geometry.scanGapMm)} mm · 겹침 ${fixed(r.geometry.scanOverlapMm)} mm · 깊이 중심 차 ${fixed(r.geometry.depthCenterDiffMm)} mm · `
                            : r.hadCandidate
                              ? '조건을 만족하는 상대가 있었지만 1:1 짝짓기에서 짝을 잃었습니다 · '
                              : ''}
                          Δ높이 {signed(r.diff.height)} mm · Δ시작 {signed(r.diff.scanStart)} · Δ끝 {signed(r.diff.scanEnd)}
                          {r.zone ? ` · 상대 쪽 참고 구역` : ''}
                          {r.outsideCoverage ? ' · 검토 범위 밖' : ''}
                        </p>
                        <div className="labels-review__sides">
                          <div>
                            {r.a ? (
                              r.a.records.map((x) => <RecordDetail key={x.uuid} r={x} side="A" canView={props.canView(x.sha256)} onView={() => props.onView(x)} />)
                            ) : (
                              <p className="t-caption">A 에는 이 지시가 없습니다.</p>
                            )}
                          </div>
                          <div>
                            {r.b ? (
                              r.b.records.map((x) => <RecordDetail key={x.uuid} r={x} side="B" canView={props.canView(x.sha256)} onView={() => props.onView(x)} />)
                            ) : (
                              <p className="t-caption">B 에는 이 지시가 없습니다.</p>
                            )}
                          </div>
                        </div>
                        {decide && d ? (
                          <DecisionDetail
                            row={r}
                            d={d}
                            disabled={props.disabled === true}
                            messages={res?.messages ?? []}
                            onChange={(next) => props.onDecide?.(r.id, next)}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 결정 세부: 합침 칸 묶음 · 물리 결함 ID · Level III 메모 */
function DecisionDetail(props: {
  row: ReviewRow
  d: AdjudicationDecision
  disabled: boolean
  messages: string[]
  onChange: (d: AdjudicationDecision) => void
}) {
  const { d } = props
  const posSide = d.fields?.position ?? 'a'
  return (
    <div className="labels-review__decision">
      {d.choice === 'merge' ? (
        <fieldset className="labels-review__merge">
          <legend className="t-caption">합침: 칸 묶음마다 어느 쪽 값을 쓸지 (위치를 고른 쪽이 기록의 뼈대)</legend>
          {MERGE_FIELDS.map((f) => {
            const v = d.fields?.[f] ?? posSide
            return (
              <div key={f} className="labels-review__merge-row" role="radiogroup" aria-label={MERGE_FIELD_LABEL[f]}>
                <span className="labels-review__merge-name" title={MERGE_FIELD_LABEL[f]}>
                  {MERGE_FIELD_LABEL[f]}
                </span>
                {(['a', 'b'] as const).map((side) => (
                  <label key={side} className="check">
                    <input
                      type="radio"
                      name={`${props.row.id}-${f}`}
                      checked={v === side}
                      disabled={props.disabled}
                      onChange={() => props.onChange({ ...d, fields: { ...(d.fields ?? {}), [f]: side } })}
                    />
                    <span>{side.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            )
          })}
        </fieldset>
      ) : null}
      {d.choice !== 'neither' ? (
        <label className="field labels-review__field">
          <span className="field__label" title="비우면 원본 기록의 값을 쓰고, 설계값 대조가 빈 칸을 채웁니다">물리 결함 ID (비우면 원본 값)</span>
          <input
            className="input"
            value={d.physicalDefectId ?? ''}
            maxLength={64}
            disabled={props.disabled}
            onChange={(e) => {
              const v = e.target.value
              const next: AdjudicationDecision = { ...d }
              if (v.trim() === '') delete next.physicalDefectId
              else next.physicalDefectId = v
              props.onChange(next)
            }}
          />
        </label>
      ) : null}
      <label className="field labels-review__field labels-review__field--wide">
        <span className="field__label">Level III 메모 (확정 기록 메모와 출처에 붙음)</span>
        <input
          className="input"
          value={d.note ?? ''}
          maxLength={500}
          disabled={props.disabled}
          onChange={(e) => {
            const next: AdjudicationDecision = { ...d }
            if (e.target.value === '') delete next.note
            else next.note = e.target.value
            props.onChange(next)
          }}
        />
      </label>
      {props.messages.length > 0 ? (
        <ul className="labels-msgs">
          {props.messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
