/**
 * 엑셀 미리보기(시트별 줄 수 · 맞춘 파일 · 오류·경고 · 고를 것 · 확정하면 일어날 일)와 확정 버튼.
 * - 그룹·파일 물음에서 난 오류는 '고를 것'으로 따로 보인다(엑셀을 고치지 않고 여기서 고르면 풀린다).
 *   같은 그룹 코드·같은 후보 이름의 그룹 물음은 한 줄로 묶어 한 번에 답한다.
 * - 고침·지움 표시·충돌은 확정 바에 늘 보이고, 있으면 목록을 펼쳐 보이고 '확인했습니다'를 고른 뒤에 확정한다.
 */
import { useMemo, useState } from 'react'
import type { LabelPlanCounts, LabelWorkbookChange, LabelWorkbookGroupQuestion, LabelWorkbookOptions, LabelWorkbookPreview } from '@shared/api'
import { READING_STAGE, READER_SOURCE } from '@shared/labels/codes'
import { Icon } from '../../components/Icon'
import { Status } from '../../components/Status'
import { DASH } from '../../lib/format'
import { ENTITY_LABEL, PLAN_LABEL, PLAN_ORDER, labelerText } from './format'

const MAX_SHOWN = 30

export function PlanStats({ totals }: { totals: LabelPlanCounts }) {
  const shown = PLAN_ORDER.filter((k) => k === 'create' || totals[k] > 0)
  return (
    <div className="labels-stats">
      {shown.map((k) => (
        <div className="stat" key={k}>
          <span className={k === 'conflict' || k === 'remove' ? 'stat__value text-accent' : 'stat__value'}>{totals[k]}</span>
          <span className="stat__label">{PLAN_LABEL[k]}</span>
        </div>
      ))}
    </div>
  )
}

export function MessageList({ items, tone }: { items: readonly string[]; tone: 'error' | 'plain' }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, MAX_SHOWN)
  return (
    <>
      <ul className={tone === 'error' ? 'labels-msgs labels-msgs--error' : 'labels-msgs'}>
        {shown.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
      {items.length > MAX_SHOWN && !all ? (
        <button type="button" className="btn btn--link" onClick={() => setAll(true)}>
          {items.length - MAX_SHOWN}건 더 보기
        </button>
      ) : null}
    </>
  )
}

const CHANGE_LABEL: Record<LabelWorkbookChange['action'], string> = {
  update: '고침',
  remove: '지움 표시',
  conflict: '충돌',
  kept: '이 PC 값 남김'
}

/** 바뀌는 것 목록 (지시 번호·파일·이유) */
export function ChangeList({ changes }: { changes: readonly LabelWorkbookChange[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? changes : changes.slice(0, MAX_SHOWN)
  return (
    <>
      <table className="table table--compact labels-mini" aria-label="확정하면 바뀌는 것">
        <thead>
          <tr>
            <th>무엇</th>
            <th>저장 단위</th>
            <th>항목</th>
            <th>이유</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c, i) => (
            <tr key={i}>
              <td className={c.action === 'remove' || c.action === 'conflict' ? 'text-accent' : undefined}>{CHANGE_LABEL[c.action]}</td>
              <td>{ENTITY_LABEL[c.entity]}</td>
              <td className="truncate labels-file" title={c.name}>
                {c.name}
              </td>
              <td className="labels-reason">{c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changes.length > MAX_SHOWN && !all ? (
        <button type="button" className="btn btn--link" onClick={() => setAll(true)}>
          {changes.length - MAX_SHOWN}건 더 보기
        </button>
      ) : null}
    </>
  )
}

/** 같은 (그룹 코드, 후보 이름 목록) 물음 묶음 */
interface QuestionBundle {
  id: string
  label: string
  /** 후보 이름이 서로 달라 이름으로 답하는지 (아니면 그룹 id 로) */
  byName: boolean
  questions: LabelWorkbookGroupQuestion[]
}

function bundleQuestions(qs: readonly LabelWorkbookGroupQuestion[]): QuestionBundle[] {
  const map = new Map<string, QuestionBundle>()
  for (const q of qs) {
    const names = q.candidates.map((c) => c.name)
    // 후보 이름이 겹치면 이름으로 답할 수 없어 그 물음만 따로 둔다
    const unique = new Set(names).size === names.length
    const id = unique ? `${q.code}|${names.join('\u0000')}` : q.key
    const b = map.get(id) ?? { id, label: q.label, byName: unique, questions: [] }
    b.questions.push(q)
    map.set(id, b)
  }
  return [...map.values()]
}

export function WorkbookPreview(props: {
  preview: LabelWorkbookPreview
  busy: boolean
  onCommit: () => void
  onReparse: (options: LabelWorkbookOptions) => void
  /** 등록된 라벨러 정보를 엑셀 정보로 바꾸기 */
  onUseReaderInfo: () => void
  onClose: () => void
}) {
  const { preview: pv, busy } = props
  const [groupPick, setGroupPick] = useState<Record<string, string>>({})
  const [filePick, setFilePick] = useState<Record<string, string>>({})
  const [acknowledged, setAcknowledged] = useState(false)
  const r = pv.reader
  const p = pv.plan
  const t = pv.totals
  const bundles = useMemo(() => bundleQuestions(pv.groupQuestions), [pv.groupQuestions])
  const questionCount = bundles.length + pv.fileQuestions.length
  const onlyQuestions = pv.errors.length > 0 && pv.errors.length === pv.questionErrors && questionCount > 0
  const recordCount = pv.files.reduce((s, f) => s + f.records, 0)
  const reviewCount = pv.files.reduce((s, f) => s + f.reviews, 0)
  const eventCount = pv.files.reduce((s, f) => s + f.events, 0)
  const changes = t.create + t.update + t.remove + t.conflict + (r && !r.registered ? 1 : 0)
  const risky = t.update + t.remove + t.conflict
  const visibleChanges = pv.changes.filter((c) => c.action !== 'kept')
  const blockReason = !pv.ok
    ? onlyQuestions
      ? `아래에서 ${questionCount}가지를 고르고 '고른 값으로 다시 읽기'를 누르면 확정할 수 있습니다.`
      : `오류 ${pv.errors.length}건을 엑셀에서 고친 뒤 다시 가져와야 확정할 수 있습니다.`
    : changes === 0
      ? '저장소에 이미 같은 내용이 있어 바뀌는 것이 없습니다.'
      : risky > 0 && !acknowledged
        ? "고침·지움 표시·충돌 목록을 보고 '확인했습니다'를 고르면 확정할 수 있습니다."
        : null
  const answered = bundles.every((b) => groupPick[b.id] !== undefined) && pv.fileQuestions.every((q) => filePick[q.key] !== undefined)

  const reparse = (): void => {
    const groupChoices: Record<string, number> = { ...(pv.options.groupChoices ?? {}) }
    for (const b of bundles) {
      const pick = groupPick[b.id]
      if (pick === undefined) continue
      for (const q of b.questions) {
        // 묶음은 이름으로, 이름이 겹친 물음은 id(문자열)로 고른다
        const c = b.byName ? q.candidates.find((x) => x.name === pick) : q.candidates.find((x) => String(x.id) === pick)
        if (c) groupChoices[q.key] = c.id
      }
    }
    const fileChoices: Record<string, string> = { ...(pv.options.fileChoices ?? {}), ...filePick }
    props.onReparse({
      ...(Object.keys(groupChoices).length ? { groupChoices } : {}),
      ...(Object.keys(fileChoices).length ? { fileChoices } : {})
    })
  }

  return (
    <section className="labels-preview" aria-labelledby="labels-preview-title">
      <div className="toolbar">
        <h2 className="section__title section__title--inline" id="labels-preview-title" tabIndex={-1} data-focus-target>
          엑셀 미리보기
        </h2>
        <span className="toolbar__count truncate mono" title={pv.path}>
          {pv.fileName}
        </span>
        <span className="toolbar__spacer" />
        <button type="button" className="btn btn--ghost" onClick={props.onClose}>
          닫기
        </button>
      </div>

      <dl className="kv labels-preview__kv">
        <dt>라벨러</dt>
        <dd>
          {r ? labelerText(r.id, r.name, r.qualification) : DASH}{' '}
          {r && !r.registered ? <Status tone="new">확정하면 등록</Status> : null}
          {r?.differsFromRegistered ? (
            <>
              <Status tone="attention">등록된 정보와 다름 · 등록된 정보를 둠</Status>{' '}
              <button type="button" className="btn btn--link" disabled={busy} onClick={props.onUseReaderInfo}>
                엑셀 정보로 바꾸기
              </button>
            </>
          ) : null}
        </dd>
        <dt>판독 단계</dt>
        <dd>
          {r ? `${READING_STAGE[r.readingStage]} · 지침서 ${r.guidelineVersion} · ${READER_SOURCE[r.readerSource]}` : DASH}
        </dd>
        <dt>양식</dt>
        <dd>
          {pv.form.labelForm ? `기록양식 ${pv.form.labelForm}` : '양식 정보 없음'}
          {pv.form.blind === null ? '' : pv.form.blind ? ' · 판독자용' : ' · 대조용'}
          {pv.form.fingerprint && pv.form.fingerprint !== pv.form.appFingerprint ? (
            <>
              {' '}
              <Status tone="attention">칸 정의가 앱과 다름</Status>
            </>
          ) : null}
        </dd>
        <dt>시트별 줄 수</dt>
        <dd className="num">{pv.sheets.map((s) => `${s.name} ${s.rows ?? '없음'}`).join(' · ')}</dd>
      </dl>

      {pv.errors.length > 0 && !onlyQuestions ? (
        <div className="notice notice--error" role="alert">
          <div className="notice__body">
            <p className="notice__title">
              오류 {pv.errors.length}건 · 엑셀을 고쳐야 확정할 수 있습니다
              {pv.questionErrors > 0 ? ` (그중 ${pv.questionErrors}건은 아래에서 고르면 풀림)` : ''}
            </p>
            <MessageList items={pv.errors} tone="error" />
          </div>
        </div>
      ) : null}

      {questionCount > 0 ? (
        <div className="notice notice--accent">
          <div className="notice__body">
            <p className="notice__title">고를 것 {questionCount}가지 · 엑셀을 고치지 않고 여기서 고르면 됩니다</p>
            {bundles.map((b) => (
              <div className="labels-question" key={b.id}>
                <span>
                  {b.label} 그룹이 둘 이상 · 파일 {b.questions.length}개
                </span>
                <span className="select">
                  <select
                    aria-label={`${b.label} 그룹 고르기`}
                    value={groupPick[b.id] ?? ''}
                    onChange={(e) => setGroupPick({ ...groupPick, [b.id]: e.target.value })}
                  >
                    <option value="" disabled>
                      그룹 고르기
                    </option>
                    {b.questions[0]!.candidates.map((c) => (
                      <option key={c.id} value={b.byName ? c.name : String(c.id)}>
                        {c.name} (그룹 {c.id})
                      </option>
                    ))}
                  </select>
                </span>
                <span
                  className="t-caption truncate"
                  title={b.questions.map((q) => `${q.fileName}: ${q.where.join(', ')}`).join('\n')}
                >
                  {b.questions.map((q) => q.fileName).join(', ')}
                </span>
              </div>
            ))}
            {pv.fileQuestions.map((q) => (
              <div className="labels-question" key={q.key}>
                <span>
                  '{q.fileName}' 이름의 파일이 {q.candidates.length}개
                </span>
                <span className="select">
                  <select
                    aria-label={`${q.fileName} 파일 고르기`}
                    value={filePick[q.key] ?? ''}
                    onChange={(e) => setFilePick({ ...filePick, [q.key]: e.target.value })}
                  >
                    <option value="" disabled>
                      파일 고르기
                    </option>
                    {q.candidates.map((c) => (
                      <option key={c.sha256} value={c.sha256}>
                        {c.label ?? c.sha256.slice(0, 12)}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="t-caption truncate" title={q.where.join('\n')}>
                  {q.where[0]}
                  {q.where.length > 1 ? ` 외 ${q.where.length - 1}곳` : ''}
                </span>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn--secondary" disabled={busy || !answered} onClick={reparse}>
                고른 값으로 다시 읽기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <h3 className="labels-subtitle">확정하면</h3>
      <PlanStats totals={t} />

      {visibleChanges.length > 0 ? (
        <div className="labels-changes">
          <p className="labels-subtitle">
            바뀌는 것 {visibleChanges.length}건 <span className="t-caption">엑셀이 그 줄의 원본입니다. 앱·다른 PC 에서 고친 것은 덮지 않고 그대로 두거나 충돌로 둡니다.</span>
          </p>
          <ChangeList changes={visibleChanges} />
        </div>
      ) : null}

      <div className="table-wrap labels-preview__files">
        <table className="table table--compact" aria-label="엑셀이 가리킨 파일">
          <thead>
            <tr>
              <th>파일</th>
              <th>스캔플랜</th>
              <th>시편</th>
              <th className="num">지시</th>
              <th className="num">검토 구간</th>
              <th className="num">작업 이벤트</th>
              <th className="num">지움 표시</th>
              <th>파일 정렬</th>
            </tr>
          </thead>
          <tbody>
            {pv.files.map((f) => (
              <tr key={f.sha256}>
                <td className="is-primary truncate labels-file" title={f.sha256}>
                  {f.fileName}
                  {f.fileId === null ? (
                    <>
                      {' '}
                      <Status tone="attention">저장소에 없음</Status>
                    </>
                  ) : f.matchedBy === 'name' ? (
                    <>
                      {' '}
                      <Status tone="attention" title="'파일' 시트의 SHA-256 이 비어 이름으로만 맞췄습니다. 같은 이름의 다른 스캔이 아닌지 확인하세요.">
                        이름으로만 맞춤
                      </Status>
                    </>
                  ) : null}
                </td>
                <td>{f.planId ?? <span className="text-faint">{DASH}</span>}</td>
                <td>{f.specimenId ?? <span className="text-faint">{DASH}</span>}</td>
                <td className="num">{f.records}</td>
                <td className="num">{f.reviews}</td>
                <td className="num">{f.events}</td>
                <td className={f.removes > 0 ? 'num text-accent' : 'num'}>{f.removes}</td>
                <td>{f.alignment ? '있음' : <span className="text-faint">{DASH}</span>}</td>
              </tr>
            ))}
            {pv.files.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-subtle">
                  가져올 줄이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pv.warnings.length > 0 ? (
        <details className="preview-details">
          <summary>
            경고 {pv.warnings.length}건 <span className="t-caption">확정은 되지만 확인할 것</span>
          </summary>
          <div className="preview-details__body">
            <MessageList items={pv.warnings} tone="plain" />
          </div>
        </details>
      ) : null}

      <details className="preview-details">
        <summary>
          저장 단위별 <span className="t-caption">새로 · 고침 · 지움 표시 · 충돌 · 그대로</span>
        </summary>
        <div className="preview-details__body table-wrap">
          <table className="table table--compact" aria-label="저장 단위별 확정 결과">
            <thead>
              <tr>
                <th>저장 단위</th>
                {PLAN_ORDER.map((k) => (
                  <th key={k} className="num">
                    {PLAN_LABEL[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['record', '지시 기록'],
                  ['review-interval', '검토 구간'],
                  ['work-event', '작업 이벤트'],
                  ['file-alignment', '파일 정렬'],
                  ['physical-defect', '물리 결함']
                ] as const
              ).map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  {PLAN_ORDER.map((c) => (
                    <td key={c} className="num">
                      {p[k][c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="commit-bar">
        <div className="commit-bar__text">
          <p className="commit-bar__main num">
            새로 {t.create} · 고침 {t.update} · 지움 표시 {t.remove} · 충돌 {t.conflict}
            <span className="t-caption">
              {' '}
              · 엑셀 지시 {recordCount} · 검토 구간 {reviewCount} · 작업 이벤트 {eventCount} · 파일 {pv.files.length}
            </span>
          </p>
          <p className="commit-bar__sub">
            {blockReason ? (
              <span className={pv.ok || onlyQuestions ? 'text-subtle' : 'text-danger'}>{blockReason}</span>
            ) : (
              '저장소 카탈로그에 저장합니다. 엑셀 파일은 바꾸지 않습니다.'
            )}
          </p>
          {pv.ok && risky > 0 ? (
            <label className="check labels-ack">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              <span>
                고침 {t.update} · 지움 표시 {t.remove} · 충돌 {t.conflict}건을 확인했습니다
              </span>
            </label>
          ) : null}
        </div>
        <button type="button" className="btn btn--primary btn--lg" disabled={busy || !!blockReason} onClick={props.onCommit}>
          <Icon name="check" />
          확정
        </button>
      </div>
    </section>
  )
}
