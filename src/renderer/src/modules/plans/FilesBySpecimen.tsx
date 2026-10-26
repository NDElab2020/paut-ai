import { Fragment, useEffect, useMemo, useRef } from 'react'
import type { FileRecord, SpecimenSummary } from '@shared/types'
import { formatBytes } from '@shared/ids'
import { Icon } from '../../components/Icon'
import { Tag } from '../../components/Status'
import { DASH, SOURCE_ID_LABEL, date, num } from '../../lib/format'
import { rowKeyHandler } from '../../lib/rowNav'
import { FileDetail } from './FileDetail'

const COLS = 6

const byName = (a: { groupName: string }, b: { groupName: string }): number =>
  a.groupName.localeCompare(b.groupName, 'ko', { numeric: true })

/** 그룹 이름 순 (셋업 요약 면과 같은 순서) */
function gains(f: FileRecord): { text: string; title: string } {
  const gs = f.acquisition.groups.slice().sort(byName)
  if (gs.length === 0) return { text: DASH, title: '' }
  return {
    text: gs.map((g) => num(g.gainDb)).join(' · '),
    title: gs.map((g) => `${g.groupName}: ${num(g.gainDb)} dB`).join('\n')
  }
}

/** 시편별로 묶은 파일 표. 행을 고르면 바로 아래에 상세가 펼쳐지고, 행 끝 버튼으로 바로 이미지 보기로 간다 */
export function FilesBySpecimen(props: {
  files: FileRecord[]
  specimens: SpecimenSummary[]
  selectedId: number | null
  onSelect: (id: number | null) => void
  onOpenImage: (fileId: number) => void
}) {
  const groups = useMemo(() => {
    const by = new Map<string, FileRecord[]>()
    for (const f of props.files) by.set(f.specimenId, [...(by.get(f.specimenId) ?? []), f])
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  }, [props.files])
  const specById = useMemo(() => new Map(props.specimens.map((s) => [s.id, s])), [props.specimens])
  const shownSelected = props.files.some((f) => f.id === props.selectedId) ? props.selectedId : null
  const tabStop = shownSelected ?? groups[0]?.[1][0]?.id ?? null
  const toggle = (id: number): void => props.onSelect(props.selectedId === id ? null : id)
  const gainOrder = (props.files[0]?.acquisition.groups ?? []).slice().sort(byName).map((g) => g.groupName)
  // 이미지 보기에서 돌아오면 펼쳐 둔 행을 화면 가운데로 (처음 한 번만).
  // 마운트할 때 이미 펼친 행이 있을 때만 건다. 그 뒤 사용자가 고른 행으로는 화면을 옮기지 않는다
  const tableRef = useRef<HTMLTableElement>(null)
  const scrolled = useRef(shownSelected === null)
  useEffect(() => {
    if (scrolled.current || shownSelected === null) return
    scrolled.current = true
    tableRef.current?.querySelector(`[data-row="${shownSelected}"]`)?.scrollIntoView({ block: 'center' })
  }, [shownSelected])

  return (
    <div className="table-wrap">
      <table ref={tableRef} className="table files-table" role="grid" aria-label="시편별 파일">
        <thead>
          <tr>
            <th>파일 · 장비 원본 파일명</th>
            <th>태그</th>
            <th className="num" title="그룹별 게인 (기록용, 지문 제외)">
              게인 dB
              {gainOrder.length > 1 ? <span className="th-sub">{gainOrder.join(' · ')}</span> : null}
            </th>
            <th className="num">크기</th>
            <th className="col-opt">가져온 날</th>
            <th className="col-action">
              <span className="visually-hidden">이미지로 보기</span>
            </th>
          </tr>
        </thead>
        <tbody
          onKeyDown={rowKeyHandler({
            onSelect: (k) => props.onSelect(Number(k)),
            onActivate: (k) => toggle(Number(k))
          })}
        >
          {groups.map(([specId, files]) => {
            const s = specById.get(specId)
            return (
              <Fragment key={specId}>
                <tr className="group-row">
                  <td colSpan={COLS}>
                    <span className="group-row__id">{specId}</span>
                    <span className="group-row__meta">
                      파일 {files.length}개
                      {s ? ` · ${SOURCE_ID_LABEL[s.source]}` : ''}
                    </span>
                    {s?.stateTags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </td>
                </tr>
                {files.map((f) => {
                  const g = gains(f)
                  const selected = f.id === props.selectedId
                  return (
                    <Fragment key={f.id}>
                      <tr
                        data-row={f.id}
                        tabIndex={f.id === tabStop ? 0 : -1}
                        aria-selected={selected}
                        aria-expanded={selected}
                        onClick={() => toggle(f.id)}
                      >
                        <td className="file-cell">
                          <span className="file-cell__name truncate" title={f.storedFileName}>
                            {f.storedFileName}
                          </span>
                          <span className="file-cell__device mono truncate" title={f.meta.deviceFileName ?? undefined}>
                            {f.meta.deviceFileName ?? '장비 원본 이름 없음'}
                          </span>
                        </td>
                        <td>
                          <span className="row tag-row">
                            {f.stateTag ? <Tag>{f.stateTag}</Tag> : null}
                            {f.tags.map((t) => (
                              <Tag key={t}>{t}</Tag>
                            ))}
                            {!f.stateTag && f.tags.length === 0 ? <span className="text-faint">{DASH}</span> : null}
                          </span>
                        </td>
                        <td className="num" title={g.title}>
                          {g.text}
                        </td>
                        <td className="num">{formatBytes(f.meta.sizeBytes)}</td>
                        <td className="num col-opt">{date(f.importedAt)}</td>
                        <td className="col-action">
                          {/* 행을 펼치지 않고 바로 이미지 보기로 (사용자 요청). 행 클릭(펼침)과 섞이지 않게 전파를 막는다 */}
                          <button
                            type="button"
                            className="btn btn--ghost btn--icon row-open"
                            title="이미지로 보기"
                            aria-label={`${f.storedFileName} 이미지로 보기`}
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onOpenImage(f.id)
                            }}
                          >
                            <Icon name="image" />
                          </button>
                        </td>
                      </tr>
                      {selected ? (
                        <tr className="detail-row">
                          <td colSpan={COLS}>
                            <FileDetail file={f} onOpenImage={props.onOpenImage} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
