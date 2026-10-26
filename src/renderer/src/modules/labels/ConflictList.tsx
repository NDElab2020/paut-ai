/**
 * 풀지 않은 충돌: 두 곳(다른 PC·엑셀과 이 PC)에서 따로 고친 항목. 줄을 펼치면 다른 칸을 나란히 보고,
 * 내 것 / 들어온 것 / 둘 다 중에서 고른다. '들어온 것으로'는 바뀌는 칸을 한 번 더 보여 주고 확인을 받는다.
 * 같은 출처(엑셀 파일·보낸 PC)의 충돌이 여럿이면 한꺼번에 고를 수 있다. 푼 충돌은 접어서 보여 준다.
 * 확인 줄이 뜨면 포커스는 '취소'(되돌릴 수 없는 작업이라)로 가고, 취소하면 누른 '…들어온 것으로…' 단추로 돌아온다(키보드만으로 이어서 — 디자인 4절).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { LabelConflictChoice, LabelConflictInfo } from '@shared/api'
import { Icon } from '../../components/Icon'
import { DASH, dateTime } from '../../lib/format'
import { CHOICE_HINT, CHOICE_LABEL, ENTITY_LABEL, entitySummary, fieldDiffs } from './format'

const COLS = 6

/** 충돌 출처 글자 (엑셀 파일 이름 또는 보낸 PC) */
export function sourceText(c: Pick<LabelConflictInfo, 'sourceName' | 'sourcePcId'>): string {
  if (c.sourceName) return `엑셀 ${c.sourceName}`
  return c.sourcePcId ? `PC ${c.sourcePcId}` : DASH
}

const RESOLUTION_LABEL: Record<NonNullable<LabelConflictInfo['resolution']>, string> = {
  mine: '내 것 남김',
  theirs: '들어온 것으로',
  both: '둘 다 남김',
  superseded: '새 값이 덮음'
}

export function ConflictList(props: {
  conflicts: LabelConflictInfo[]
  /** 푼 충돌 (최근 것 먼저) */
  resolved: LabelConflictInfo[]
  busy: boolean
  onResolve: (c: LabelConflictInfo, choice: LabelConflictChoice) => void
  onResolveMany: (list: LabelConflictInfo[], choice: 'mine' | 'theirs') => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  /** 확인을 기다리는 '들어온 것으로' (충돌 하나 또는 출처 묶음) */
  const [confirm, setConfirm] = useState<{ kind: 'one'; id: number } | { kind: 'many'; source: string } | null>(null)
  /** 확인 줄을 연 단추 ('one:<id>' · 'many:<출처>') — 취소하면 그 단추로 포커스를 돌린다 (확인 줄이 단추 자리를 바꿔 끼우므로 다시 그린 뒤) */
  const triggers = useRef(new Map<string, HTMLButtonElement | null>())
  const [returnTo, setReturnTo] = useState<string | null>(null)
  useEffect(() => {
    if (returnTo === null) return
    triggers.current.get(returnTo)?.focus()
    setReturnTo(null)
  }, [returnTo])
  const cancel = (key: string): void => {
    setConfirm(null)
    setReturnTo(key)
  }
  const triggerRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) triggers.current.set(key, el)
    else triggers.current.delete(key)
  }
  const fromWorkbook = props.conflicts.every((c) => c.sourceName !== null)
  const groups = useMemo(() => {
    const m = new Map<string, LabelConflictInfo[]>()
    for (const c of props.conflicts) m.set(sourceText(c), [...(m.get(sourceText(c)) ?? []), c])
    return [...m.entries()].filter(([, list]) => list.length > 1)
  }, [props.conflicts])

  return (
    <section className="labels-conflicts" aria-labelledby="labels-conflicts-title">
      <h2 className="section__title" id="labels-conflicts-title">
        충돌 {props.conflicts.length}건
        <span className="t-caption">
          {fromWorkbook
            ? '엑셀 값과 이 PC 값이 서로 다른 항목입니다.'
            : '두 곳(다른 PC·엑셀과 이 PC)에서 따로 고친 항목입니다.'}{' '}
          고르기 전까지 이 PC 의 값을 씁니다. 줄을 펼쳐 고릅니다.
        </span>
      </h2>

      {groups.map(([source, list]) => (
        <div className="labels-bulk" key={source}>
          <span className="text-strong">{source}</span>
          <span className="t-caption">충돌 {list.length}건 한꺼번에</span>
          {confirm?.kind === 'many' && confirm.source === source ? (
            <>
              <span className="text-accent">들어온 값으로 {list.length}건을 바꿉니다. 이 PC 값은 버려집니다.</span>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={props.busy}
                onClick={() => {
                  setConfirm(null)
                  props.onResolveMany(list, 'theirs')
                }}
              >
                바꾸기
              </button>
              <button type="button" className="btn btn--ghost" autoFocus onClick={() => cancel(`many:${source}`)}>
                취소
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" disabled={props.busy} onClick={() => props.onResolveMany(list, 'mine')}>
                모두 내 것 남기기
              </button>
              <button
                ref={triggerRef(`many:${source}`)}
                type="button"
                className="btn btn--ghost"
                disabled={props.busy || list.some((c) => !c.choices.includes('theirs'))}
                onClick={() => setConfirm({ kind: 'many', source })}
              >
                모두 들어온 것으로…
              </button>
            </>
          )}
        </div>
      ))}

      <div className="table-wrap">
        <table className="table table--compact labels-conflict-table" aria-label="풀지 않은 충돌">
          <thead>
            <tr>
              <th className="col-check">
                <span className="visually-hidden">펼치기</span>
              </th>
              <th>종류</th>
              <th>파일</th>
              <th>라벨러</th>
              <th>출처</th>
              <th>다른 칸</th>
            </tr>
          </thead>
          <tbody>
            {props.conflicts.map((c) => {
              const diffs = fieldDiffs(c.mine ?? c.mineAtDetection, c.theirs)
              const isOpen = open === c.id
              return (
                <Fragment key={c.id}>
                  <tr className={isOpen ? 'is-selected' : undefined}>
                    <td className="col-check">
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon"
                        aria-expanded={isOpen}
                        aria-label={`충돌 ${c.id} ${isOpen ? '접기' : '펼쳐서 고르기'}`}
                        title={isOpen ? '접기' : '다른 칸을 보고 고르기'}
                        onClick={() => {
                          setOpen(isOpen ? null : c.id)
                          setConfirm(null)
                        }}
                      >
                        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
                      </button>
                    </td>
                    <td className="is-primary">{ENTITY_LABEL[c.entity]}</td>
                    <td className="truncate labels-file" title={c.fileName ?? c.sha256 ?? undefined}>
                      {c.fileName ?? (c.sha256 ? c.sha256.slice(0, 12) : DASH)}
                    </td>
                    <td>{c.labelerId ?? <span className="text-faint">{DASH}</span>}</td>
                    <td className="truncate labels-source" title={sourceText(c)}>
                      {sourceText(c)}
                    </td>
                    <td className="truncate labels-diff-cell" title={diffs.map((d) => `${d.label}: ${d.mine} → ${d.theirs}`).join('\n')}>
                      {diffs.length === 0 ? '내용 같음' : diffs.slice(0, 2).map((d) => d.label).join(', ') + (diffs.length > 2 ? ` 외 ${diffs.length - 2}` : '')}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="detail-row">
                      <td colSpan={COLS}>
                        <p className="t-caption labels-conflict__meta">
                          이 PC: {entitySummary(c.entity, c.mine ?? c.mineAtDetection)}
                          <br />
                          들어온 것: {entitySummary(c.entity, c.theirs)}
                          <br />
                          {sourceText(c)} · {c.sourceExportedAt ? `${dateTime(c.sourceExportedAt)} 내보낸 파일 · ` : ''}
                          {dateTime(c.detectedAt)} 찾음
                        </p>
                        <table className="table table--compact labels-mini" aria-label="다른 칸">
                          <thead>
                            <tr>
                              <th>칸</th>
                              <th>이 PC</th>
                              <th>들어온 것</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diffs.map((d) => (
                              <tr key={d.path}>
                                <td title={d.path}>{d.label}</td>
                                <td>{d.mine}</td>
                                <td className="text-strong">{d.theirs}</td>
                              </tr>
                            ))}
                            {diffs.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="text-subtle">
                                  내용은 같고 고친 기록(버전)만 다릅니다.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                        <div className="labels-choices">
                          {confirm?.kind === 'one' && confirm.id === c.id ? (
                            <>
                              <span className="text-accent">
                                {diffs.length > 0 ? `${diffs.map((d) => d.label).slice(0, 4).join(', ')}${diffs.length > 4 ? ' …' : ''} 칸이 들어온 값으로 바뀝니다. ` : ''}이 PC 값은 버려집니다.
                              </span>
                              <button
                                type="button"
                                className="btn btn--secondary"
                                disabled={props.busy}
                                onClick={() => {
                                  setConfirm(null)
                                  props.onResolve(c, 'theirs')
                                }}
                              >
                                바꾸기
                              </button>
                              <button type="button" className="btn btn--ghost" autoFocus onClick={() => cancel(`one:${c.id}`)}>
                                취소
                              </button>
                            </>
                          ) : (
                            c.choices.map((ch) => (
                              <button
                                key={ch}
                                ref={ch === 'theirs' ? triggerRef(`one:${c.id}`) : undefined}
                                type="button"
                                className="btn btn--secondary"
                                title={CHOICE_HINT[ch]}
                                disabled={props.busy}
                                onClick={() => (ch === 'theirs' ? setConfirm({ kind: 'one', id: c.id }) : props.onResolve(c, ch))}
                              >
                                {CHOICE_LABEL[ch]}
                                {ch === 'theirs' ? '…' : ''}
                              </button>
                            ))
                          )}
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

      {props.resolved.length > 0 ? <ResolvedList resolved={props.resolved} /> : null}
    </section>
  )
}

/** 푼 충돌 (접어 둠) */
export function ResolvedList({ resolved }: { resolved: LabelConflictInfo[] }) {
  return (
    <details className="preview-details">
      <summary>
        푼 충돌 {resolved.length}건 <span className="t-caption">무엇을 골랐는지</span>
      </summary>
      <div className="preview-details__body table-wrap">
        <table className="table table--compact" aria-label="푼 충돌">
          <thead>
            <tr>
              <th>종류</th>
              <th>파일</th>
              <th>항목</th>
              <th>출처</th>
              <th>고른 것</th>
              <th>푼 시각</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((c) => (
              <tr key={c.id}>
                <td>{ENTITY_LABEL[c.entity]}</td>
                <td className="truncate labels-file">{c.fileName ?? (c.sha256 ? c.sha256.slice(0, 12) : DASH)}</td>
                <td className="truncate labels-diff-cell" title={entitySummary(c.entity, c.theirs)}>
                  {entitySummary(c.entity, c.theirs)}
                </td>
                <td className="truncate labels-source">{sourceText(c)}</td>
                <td>{c.resolution ? RESOLUTION_LABEL[c.resolution] : DASH}</td>
                <td className="num">{c.resolvedAt ? dateTime(c.resolvedAt) : DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
