import type { ImportItemPreview, ImportPreview, ScanPlan } from '@shared/types'
import { formatBytes, sanitizeSpecimenId } from '@shared/ids'
import { josa } from '@shared/text'
import { Status } from '../../components/Status'
import { DASH, SOURCE_LABEL, VERDICT } from '../../lib/format'
import { FormatNote, FormatTag } from './FormatTag'
import { editAll, editItem, isImportable, type Edits } from './store'

const STATE_TAGS = ['Cap on', 'Cap off']

function reason(i: ImportItemPreview, p: ImportPreview): { text: string; danger?: boolean } {
  switch (i.verdict) {
    case 'match-existing':
      return { text: `셋업이 ${josa(i.matchedPlanId ?? '기존 플랜', '과/와')} 같습니다` }
    case 'new-plan': {
      const n = i.nearestPlan
      if (!n) return { text: '같은 셋업의 플랜이 없습니다' }
      if (n.withinTolerance) return { text: `${josa(n.planId, '과/와')} 반올림 경계의 작은 차이만 있습니다 — 같은 플랜인지 확인하세요` }
      return { text: `${josa(n.planId, '과/와')} ${n.differences.length}가지 다릅니다` }
    }
    case 'missing-copy':
      return { text: `저장소에서 사본이 사라져 같은 자리로 다시 복사합니다 · ${i.duplicateOf?.storedRelPath ?? ''}` }
    case 'duplicate': {
      const d = i.duplicateOf
      if (d?.storedRelPath) return { text: `이미 저장소에 있습니다 · ${d.storedRelPath}` }
      const first = p.items.find((x) => x.itemId === d?.inBatchItemId)
      return { text: `이 목록의 ${josa(first?.fileName ?? '앞선 파일', '과/와')} 같은 파일입니다 (그 파일을 제외하면 이 파일도 저장되지 않습니다)` }
    }
    case 'unsupported':
      return { text: i.unsupportedReason ?? '지원하지 않는 형식입니다.' }
    case 'error':
      // 판정 칸이 이미 '오류' — 사유 앞의 OPD '보류(해석 실패): ' 머리는 떼어 한 실패를 한 이름으로 부른다 (원래 글은 툴팁·결과 기록에 그대로)
      return { text: (i.errorMessage ?? '파일을 읽지 못했습니다.').replace(/^보류\(해석 실패\):\s*/, ''), danger: true }
  }
}

function planCell(i: ImportItemPreview, p: ImportPreview, plans: Map<string, ScanPlan>) {
  if (i.verdict === 'match-existing' && i.matchedPlanId) {
    return (
      <span className="is-primary" title={plans.get(i.matchedPlanId)?.name}>
        {i.matchedPlanId}
      </span>
    )
  }
  if (i.verdict === 'new-plan') {
    const np = p.newPlans.find((n) => n.key === i.newPlanKey)
    return <span className="text-accent">{np ? `${np.provisionalPlanId} 예정` : '새 플랜'}</span>
  }
  if ((i.verdict === 'duplicate' || i.verdict === 'missing-copy') && i.duplicateOf?.planId) {
    return <span className="text-subtle">{i.duplicateOf.planId}</span>
  }
  return <span className="text-faint">{DASH}</span>
}

/** 시편 ID 아래 캡션: 출처, 폴더 이름으로 바뀌는 값, 쓸 수 없는 값 안내 */
function SpecimenCaption({ value, source, bad }: { value: string; source: keyof typeof SOURCE_LABEL; bad: boolean }) {
  if (bad) {
    return <span className="field__error">{value.trim() ? '폴더 이름으로 쓸 수 없는 값입니다' : '시편 ID 를 입력하세요'}</span>
  }
  const folder = sanitizeSpecimenId(value)
  const changed = folder !== value.trim().normalize('NFC')
  return (
    <>
      {source === 'filename' ? <Status tone="attention">{SOURCE_LABEL.filename}</Status> : <span className="t-caption">{SOURCE_LABEL[source]}</span>}
      {changed ? <span className="t-caption">폴더: <span className="mono">{folder}</span></span> : null}
    </>
  )
}

/** 파일별 판정 표. 가져올 수 있는 행만 포함·시편 ID·상태 태그를 고칠 수 있다 */
export function PreviewTable(props: {
  preview: ImportPreview
  items: ImportItemPreview[]
  edits: Edits
  badItems: ReadonlySet<string>
  plans: Map<string, ScanPlan>
}) {
  const { preview, edits } = props
  const importable = Object.values(edits.items)
  const allOn = importable.length > 0 && importable.every((e) => e.include)
  const someOn = importable.some((e) => e.include)

  return (
    <div className="table-wrap preview-table">
      <datalist id="state-tags">
        {STATE_TAGS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <table className="table" aria-label="파일별 판정">
        <thead>
          <tr>
            <th className="col-check">
              <label className="check" title="가져올 수 있는 파일 모두 포함/제외">
                <input
                  type="checkbox"
                  checked={allOn}
                  disabled={importable.length === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn && !allOn
                  }}
                  onChange={(e) => editAll(e.target.checked)}
                />
                <span className="visually-hidden">모두 포함</span>
              </label>
            </th>
            <th>파일</th>
            <th>판정</th>
            <th>스캔플랜</th>
            <th>시편 ID</th>
            <th>상태 태그</th>
            <th>사유</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((i) => {
            const ed = edits.items[i.itemId]
            const v = VERDICT[i.verdict]
            const r = reason(i, preview)
            const bad = props.badItems.has(i.itemId)
            const off = ed ? !ed.include : true
            return (
              <tr key={i.itemId} className={off && ed ? 'is-excluded' : undefined}>
                <td className="col-check">
                  {ed ? (
                    <label className="check">
                      <input type="checkbox" checked={ed.include} onChange={(e) => editItem(i.itemId, { include: e.target.checked })} />
                      <span className="visually-hidden">{i.fileName} 포함</span>
                    </label>
                  ) : null}
                </td>
                <td className="file-cell">
                  <span className="file-cell__name truncate" title={i.sourcePath}>
                    {i.fileName}
                  </span>
                  <span className="file-cell__device">
                    {i.meta ? <FormatTag meta={i.meta} /> : null} <span className="num">{formatBytes(i.sizeBytes)}</span>
                  </span>
                  <FormatNote meta={i.meta} />
                </td>
                <td>
                  <Status tone={v.tone}>{v.label}</Status>
                </td>
                <td>{planCell(i, preview, props.plans)}</td>
                <td>
                  {ed ? (
                    <div className="cell-field">
                      <input
                        className="input cell-input"
                        value={ed.specimenId}
                        title={ed.specimenId}
                        disabled={!ed.include}
                        aria-label={`${i.fileName} 시편 ID`}
                        aria-invalid={bad ? true : undefined}
                        onChange={(e) => editItem(i.itemId, { specimenId: e.target.value, source: 'manual' })}
                      />
                      <SpecimenCaption value={ed.specimenId} source={ed.source} bad={bad} />
                    </div>
                  ) : (
                    i.duplicateOf?.specimenId ? (
                      // 값이 있는 칸은 text-subtle (다크 대비 4.5:1 이상) — text-faint 는 값 없음 '—' 에만 (디자인 2절)
                      <span className="text-subtle">{i.duplicateOf.specimenId}</span>
                    ) : (
                      <span className="text-faint">{DASH}</span>
                    )
                  )}
                </td>
                <td>
                  {ed ? (
                    <input
                      className="input cell-input cell-input--tag"
                      list="state-tags"
                      value={ed.stateTag}
                      placeholder="없음"
                      disabled={!ed.include}
                      aria-label={`${i.fileName} 상태 태그`}
                      onChange={(e) => editItem(i.itemId, { stateTag: e.target.value })}
                    />
                  ) : (
                    <span className="text-faint">{DASH}</span>
                  )}
                </td>
                <td className={r.danger ? 'reason text-danger' : 'reason text-subtle'}>
                  <span className="reason__text" title={r.text}>
                    {r.text}
                  </span>
                  {i.warnings.map((w) => (
                    <span key={w} className="reason__warn" title={w}>
                      {w}
                    </span>
                  ))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {props.items.some((i) => !isImportable(i)) ? (
        <p className="setup-panel__note">
          중복·보류·오류 파일은 복사하지 않습니다(원본 위치에 그대로 남습니다). '사본 복원'은 저장소에서 사라진 사본을 같은 자리에 다시 복사합니다.
        </p>
      ) : null}
    </div>
  )
}
