/** 파일별 라벨 현황: 파일 · 플랜 · 시편 · 라벨 세트(라벨러·단계·결함/형상 에코 수·검토 길이). 펼치면 기록 목록 */
import { Fragment, useMemo, useState } from 'react'
import type { LabelFileStatus, LabelSetInfo } from '@shared/api'
import { labelSetId } from '@shared/labels/factory'
import type { IndicationRecord } from '@shared/labels/types'
import { getApi, unwrap } from '../../api'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import { Status, Tag } from '../../components/Status'
import { useAsync } from '../../lib/useAsync'
import { CONFIDENCE, DASH, RECORD_KIND, STAGE_SHORT, mmRange, num, recordDetail } from './format'

const COLS = 7

function SetLine({ s }: { s: LabelSetInfo }) {
  const parts = [`결함 ${s.defectCount}`, `형상 에코 ${s.echoCount}`]
  if (s.imperfectionCount) parts.push(`형상 불완전 ${s.imperfectionCount}`)
  parts.push(`검토 ${num(s.reviewedLengthMm, 0)} mm`)
  if (s.qualityBadLengthMm) parts.push(`품질 불량 ${num(s.qualityBadLengthMm, 0)} mm`)
  return (
    <span className="labels-set">
      <span className="labels-set__who" title={s.labelerName && s.labelerName !== s.labelerId ? s.labelerName : undefined}>
        {s.labelerId}
      </span>
      <Tag>{STAGE_SHORT[s.readingStage]}</Tag>
      <span className="labels-set__counts num">{parts.join(' · ')}</span>
      {s.pendingConflicts ? <Status tone="attention">충돌 {s.pendingConflicts}</Status> : null}
    </span>
  )
}

function FileRecords({ file, version }: { file: LabelFileStatus; version: number }) {
  const recs = useAsync(() => unwrap(getApi().labels.listRecords({ sha256: file.sha256 })), [file.sha256, version])
  if (recs.error) return <ErrorNotice title="기록을 읽지 못했습니다" error={recs.error} onRetry={recs.reload} />
  if (!recs.data) return <p className="text-subtle loading-line">기록을 읽는 중입니다.</p>
  const bySet = new Map<string, IndicationRecord[]>()
  for (const r of recs.data) bySet.set(labelSetId(r), [...(bySet.get(labelSetId(r)) ?? []), r])
  return (
    <div className="stack labels-records">
      {file.sets.map((s) => {
        const list = bySet.get(s.setId) ?? []
        return (
          <div key={s.setId}>
            <p className="labels-records__head">
              <span className="text-strong">{s.labelerName && s.labelerName !== s.labelerId ? `${s.labelerName} (${s.labelerId})` : s.labelerId}</span> ·{' '}
              {STAGE_SHORT[s.readingStage]} · 지침서 {s.guidelineVersion}
              <span className="t-caption"> · 검토 구간 {s.reviewIntervalCount}개 · 기준 미만 {num(s.belowThresholdLengthMm, 0)} mm</span>
            </p>
            {list.length > 0 ? (
              <table className="table table--compact labels-mini" aria-label={`${s.labelerId} 기록`}>
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>구분</th>
                    <th>종류·세부</th>
                    <th className="num">스캔 (mm)</th>
                    <th className="num">깊이 (mm)</th>
                    <th className="num">길이 (mm)</th>
                    <th>확신도</th>
                    <th>출처</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.uuid}>
                      <td className="num">{r.externalRef ?? <span className="text-faint">{DASH}</span>}</td>
                      <td>{RECORD_KIND[r.kind]}</td>
                      <td>{recordDetail(r)}</td>
                      <td className="num">{mmRange(r.derived.scanStartMm, r.derived.scanEndMm)}</td>
                      <td className="num">{mmRange(r.derived.depthTopMm, r.derived.depthBottomMm)}</td>
                      <td className="num">{num(r.length.valueMm)}</td>
                      <td>{CONFIDENCE[r.existenceConfidence]}</td>
                      <td className="text-subtle">
                        {r.coordSource === 'imported-mm' ? '엑셀' : '앱'}
                        {r.recheckNeeded ? (
                          <>
                            {' '}
                            <Status tone="attention">재확인 필요</Status>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="t-caption">지시 기록 없음 (검토 구간만 있음)</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function FileStatusTable(props: {
  files: LabelFileStatus[]
  selected: ReadonlySet<string>
  onSelect: (next: ReadonlySet<string>) => void
  version: number
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const labeled = useMemo(() => props.files.filter((f) => f.sets.length > 0).map((f) => f.sha256), [props.files])
  const allOn = labeled.length > 0 && labeled.every((s) => props.selected.has(s))
  const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
    const n = new Set(set)
    if (!n.delete(key)) n.add(key)
    return n
  }

  return (
    <div className="table-wrap">
      <table className="table labels-table" aria-label="파일별 라벨 현황">
        <thead>
          <tr>
            <th className="col-check">
              <input
                type="checkbox"
                aria-label="라벨 있는 파일 모두 고르기"
                checked={allOn}
                disabled={labeled.length === 0}
                onChange={() => props.onSelect(allOn ? new Set() : new Set(labeled))}
              />
            </th>
            <th className="col-check">
              <span className="visually-hidden">펼치기</span>
            </th>
            <th>파일</th>
            <th>스캔플랜</th>
            <th>시편</th>
            <th>라벨 세트</th>
            <th className="num">충돌</th>
          </tr>
        </thead>
        <tbody>
          {props.files.map((f) => {
            const isOpen = open.has(f.sha256)
            const has = f.sets.length > 0
            return (
              <Fragment key={f.sha256}>
                <tr className={isOpen ? 'is-selected' : undefined}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      aria-label={`${f.fileName} 고르기`}
                      checked={props.selected.has(f.sha256)}
                      disabled={!has}
                      onChange={() => props.onSelect(toggle(props.selected, f.sha256))}
                    />
                  </td>
                  <td className="col-check">
                    {has ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon btn--sm"
                        aria-expanded={isOpen}
                        aria-label={`${f.fileName} 기록 ${isOpen ? '접기' : '펼치기'}`}
                        title={isOpen ? '접기' : '기록 보기'}
                        onClick={() => setOpen(toggle(open, f.sha256))}
                      >
                        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
                      </button>
                    ) : null}
                  </td>
                  <td className="is-primary truncate labels-file" title={`${f.fileName}\nSHA-256 ${f.sha256}`}>
                    {f.fileName}
                    {f.fileId === null ? (
                      <>
                        {' '}
                        <Status tone="muted" title="이 PC 저장소에 파일이 없고 라벨만 있습니다">
                          파일 없음
                        </Status>
                      </>
                    ) : null}
                  </td>
                  <td className="truncate labels-plan" title={f.planName ?? undefined}>
                    {f.planId ?? <span className="text-faint">{DASH}</span>}
                  </td>
                  <td>
                    {f.specimenId ?? <span className="text-faint">{DASH}</span>}
                    {f.stateTag ? (
                      <>
                        {' '}
                        <Tag>{f.stateTag}</Tag>
                      </>
                    ) : null}
                  </td>
                  <td className="labels-sets-cell">
                    {has ? (
                      <span className="labels-sets">
                        {f.sets.map((s) => (
                          <SetLine key={s.setId} s={s} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-faint">라벨 없음</span>
                    )}
                  </td>
                  <td className="num">{f.pendingConflicts ? <span className="text-accent">{f.pendingConflicts}</span> : <span className="text-subtle">0</span>}</td>
                </tr>
                {isOpen ? (
                  <tr className="detail-row">
                    <td colSpan={COLS}>
                      <FileRecords file={f} version={props.version} />
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
