/**
 * Level III 확정: 확정 옵션(보류·검토 구간·비결함 베끼기·설계값 계층) → 미리보기(행 상태·지움 표시) → 설계값(물리 결함) 대조 표
 * → 확정 세트 저장(라벨러 = 지금 라벨러, 판독 단계 '확정'). Level III 가 아니면 확인, 잠긴 시험 세트의 정답을 바꾸면 이유.
 * 미리보기·저장은 서비스가 저장소에서 다시 계산한다(화면 값은 보기용).
 */
import { useId, useState } from 'react'
import type { ReviewComparison, ReviewFinalOptions, ReviewFinalPreview, ReviewFinalSaveOptions, ReviewFinalSaveResult } from '@shared/api'
import { TRUTH_TIER, type TruthTier } from '@shared/labels/codes'
import { DESIGN_ROW_STATUS_LABEL, type DesignCheckRow } from '@shared/labels/review'
import type { UiError } from '../../api'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Status } from '../../components/Status'
import { DASH } from '../../lib/format'
import { fixed, pct, signed, typeName } from './reviewFormat'

const TIER_OPTIONS: ReadonlyArray<[TruthTier | 'any', string]> = [
  ['certified', `${TRUTH_TIER.certified}만 셈`],
  ['consensus', `${TRUTH_TIER.consensus} 이상`],
  ['single', `${TRUTH_TIER.single} 이상`],
  ['any', '계층 무관 (0단계 참고 비교)']
]

function designTone(r: DesignCheckRow): 'ok' | 'attention' | 'muted' {
  if (!r.counted || r.outsideCoverage) return 'muted'
  return r.status === 'matched' ? 'ok' : 'attention'
}

function DesignTable({ preview }: { preview: ReviewFinalPreview }) {
  const dc = preview.result.designCheck
  if (!dc) return <p className="t-caption">이 시편들에 물리 결함(설계값)이 없어 대조 표가 없습니다.</p>
  const s = dc.summary
  return (
    <div className="stack labels-review__design">
      <p className="t-caption">
        정답 계층 {dc.minTierLabel} · 설계 결함 {s.defects}개(셈함 {s.countedDefects}) · 짝 {s.matched} · 미검출 {s.missed}
        {s.missedOutsideCoverage ? ` (검토 범위 밖 ${s.missedOutsideCoverage})` : ''} · 추가 발견 {s.extra} · 종류 불일치 {s.typeMismatches} · ID 불일치{' '}
        {s.idMismatches} · 물리 결함 재현율 {s.recall.recall.p !== null ? `${s.recall.hits}/${s.recall.defects} = ${pct(s.recall.recall.p)}` : DASH}
      </p>
      <div className="table-wrap">
        <table className="table table--compact labels-review-design" aria-label="설계값 대조 표">
          <thead>
            <tr>
              <th>행</th>
              <th>상태</th>
              <th>물리 결함</th>
              <th>설계 (시편 mm · 종류)</th>
              <th>확정 기록</th>
              <th className="num">Δ중심</th>
              <th className="num">Δ길이</th>
              <th>확인</th>
            </tr>
          </thead>
          <tbody>
            {dc.rows.map((r) => {
              const checks = [r.typeMismatch ? '종류 다름' : null, r.idMismatch ? 'ID 다름' : null, r.outsideCoverage ? '검토 범위 밖' : null, !r.counted ? '참고' : null].filter(
                (x): x is string => x !== null
              )
              return (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>
                    <Status tone={designTone(r)}>{DESIGN_ROW_STATUS_LABEL[r.status].replace(/ \(.*\)$/, '')}</Status>
                  </td>
                  <td>{r.defectKey ?? <span className="text-faint">{DASH}</span>}</td>
                  <td className="truncate">
                    {r.design ? `${fixed(r.design.scanStartMm)}–${fixed(r.design.scanEndMm)} · ${typeName(r.design.defectType)}` : <span className="text-faint">{DASH}</span>}
                  </td>
                  <td className="truncate" title={r.unit ? r.unit.fileNames.join(', ') : undefined}>
                    {r.unit ? `${fixed(r.unit.item.scanStartMm)}–${fixed(r.unit.item.scanEndMm)} · ${typeName(r.unit.item.defectType)}` : <span className="text-faint">{DASH}</span>}
                  </td>
                  <td className="num">{signed(r.scanCenterDiffMm)}</td>
                  <td className="num">{signed(r.lengthDiffMm)}</td>
                  <td>{checks.length ? checks.join(' · ') : <span className="text-faint">{DASH}</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {dc.warnings.length > 0 ? (
        <details>
          <summary className="t-caption">대조 확인 사항 {dc.warnings.length}건</summary>
          <ul className="labels-msgs">
            {dc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

export function ReviewFinalOptionsBar(props: { options: ReviewFinalOptions; disabled: boolean; onChange: (o: ReviewFinalOptions) => void }) {
  const o = props.options
  const set = (patch: Partial<ReviewFinalOptions>): void => props.onChange({ ...o, ...patch })
  return (
    <div className="labels-review__opts" role="group" aria-label="확정 옵션">
      <label className="labels-review__opt">
        <span>보류 행</span>
        <span className="select">
          <select value={o.deferAs ?? 'uncertain'} disabled={props.disabled} onChange={(e) => set({ deferAs: e.target.value as 'uncertain' | 'omit' })}>
            <option value="uncertain">존재 '불확실'로 남김</option>
            <option value="omit">넣지 않음</option>
          </select>
        </span>
      </label>
      <label className="labels-review__opt">
        <span>확정 검토 구간</span>
        <span className="select">
          <select value={o.reviews ?? 'intersection'} disabled={props.disabled} onChange={(e) => set({ reviews: e.target.value as ReviewFinalOptions['reviews'] })}>
            <option value="intersection">두 사람 검토 완료의 교집합</option>
            <option value="a">A 의 검토 구간</option>
            <option value="b">B 의 검토 구간</option>
            <option value="none">만들지 않음</option>
          </select>
        </span>
      </label>
      <label className="labels-review__opt">
        <span>형상 에코 등 비결함 기록</span>
        <span className="select">
          <select value={o.carryNonDefect ?? 'a'} disabled={props.disabled} onChange={(e) => set({ carryNonDefect: e.target.value as 'a' | 'b' | 'none' })}>
            <option value="a">A 것을 베낌</option>
            <option value="b">B 것을 베낌</option>
            <option value="none">베끼지 않음 (형상 에코 라벨이 빠짐)</option>
          </select>
        </span>
      </label>
      <label className="labels-review__opt">
        <span>설계값 계층</span>
        <span className="select">
          <select
            value={o.design?.minTier ?? 'certified'}
            disabled={props.disabled}
            onChange={(e) => set({ design: { ...(o.design ?? {}), minTier: e.target.value as TruthTier | 'any' } })}
          >
            {TIER_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="labels-review__opt">
        <span>설계 깊이</span>
        <span className="select">
          <select
            value={o.design?.depthIs ?? 'unknown'}
            disabled={props.disabled}
            onChange={(e) => set({ design: { ...(o.design ?? {}), depthIs: e.target.value as 'top' | 'center' | 'unknown' } })}
          >
            <option value="unknown">뜻 모름 (깊이 비교 안 함)</option>
            <option value="top">윗끝</option>
            <option value="center">중심</option>
          </select>
        </span>
      </label>
    </div>
  )
}

export function ReviewFinalPanel(props: {
  comparison: ReviewComparison
  preview: ReviewFinalPreview | null
  previewing: boolean
  previewError: UiError | null
  onRetry: () => void
  noAdjudicator: boolean
  saving: boolean
  saved: ReviewFinalSaveResult | null
  saveError: UiError | null
  onSave: (o: ReviewFinalSaveOptions) => void
  /** '남은 행 기본값 채우기'로 채우고 직접 고르지 않은 행 수 */
  autoFilled?: number
  onDesignCsv: () => void
  busy: boolean
}) {
  const id = useId()
  const [confirmNotL3, setConfirmNotL3] = useState(false)
  const [confirmAuto, setConfirmAuto] = useState(false)
  const auto = props.autoFilled ?? 0
  const [reason, setReason] = useState('')
  const p = props.preview
  const r = p?.result
  if (props.noAdjudicator) {
    return (
      <div className="notice notice--accent" role="status">
        <div className="notice__body">
          <p className="notice__title">확정 라벨러를 먼저 고르세요</p>
          <p>확정 세트의 라벨러는 지금 라벨러입니다. 위 라벨러 줄에서 Level III 라벨러를 고르면 미리보기와 저장을 할 수 있습니다.</p>
        </div>
      </div>
    )
  }
  const counts = r
    ? {
        final: r.rows.filter((x) => x.status === 'final').length,
        rejected: r.rows.filter((x) => x.status === 'rejected').length,
        deferred: r.rows.filter((x) => x.status === 'deferred').length,
        undecided: r.undecided.length
      }
    : null
  const locked = (p?.lockedTestFiles.length ?? 0) > 0
  const ready = !!p && p.canSave && (p.adjudicatorIsLevel3 || confirmNotL3) && (!locked || reason.trim() !== '') && (auto === 0 || confirmAuto)
  return (
    <section className="labels-review__final" aria-labelledby={`${id}-t`}>
      <h3 className="labels-subtitle" id={`${id}-t`}>
        확정 세트 미리보기
        {props.previewing ? <span className="t-caption"> · 계산하는 중…</span> : null}
      </h3>
      {props.previewError ? <ErrorNotice title="확정 미리보기를 만들지 못했습니다" error={props.previewError} onRetry={props.onRetry} /> : null}
      {p && r && counts ? (
        <>
          <p className="labels-review__counts">
            확정 기록 <span className="text-strong num">{r.records.length}</span>건 · 확정 검토 구간 <span className="num">{r.reviewIntervals.length}</span>개 · 행: 확정{' '}
            {counts.final} · 결함 아님 {counts.rejected} · 보류 {counts.deferred} · 결정 안 함 {counts.undecided}
            {p.previousRecords > 0 ? ` · 이전 확정 기록 ${p.previousRecords}건 중 빠지는 ${r.removed.records.length}건 지움 표시` : ''}
          </p>
          <DesignTable preview={p} />
          {r.warnings.length > 0 ? (
            <details>
              <summary className="t-caption">확정 확인 사항 {r.warnings.length}건</summary>
              <ul className="labels-msgs">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="labels-review__save">
            <p>
              확정 라벨러 <span className="text-strong">{p.adjudicator ? `${p.adjudicator.name} (${p.adjudicator.id})` : DASH}</span>
              {p.adjudicator?.qualification ? ` · ${p.adjudicator.qualification}` : ''}{' '}
              {p.adjudicatorIsLevel3 ? <Status tone="ok">Level III</Status> : <Status tone="attention">Level III 아님</Status>}
              <span className="t-caption"> · 판독 단계 '확정' · 지침서 {p.guidelineVersion} · 원래 두 세트는 고치지 않고 한 번에 저장합니다</span>
            </p>
            {p.adjudicatorIsReader ? (
              <p className="t-caption">확정 라벨러가 비교한 두 사람 가운데 한 명입니다. 자기 판독을 조정하는 것이라 다른 Level III 가 맡는 것이 좋습니다.</p>
            ) : null}
            {!p.adjudicatorIsLevel3 ? (
              <label className="check labels-ack">
                <input type="checkbox" checked={confirmNotL3} onChange={(e) => setConfirmNotL3(e.target.checked)} />
                <span>지금 라벨러의 자격이 Level III 가 아닌 것을 알고 저장합니다 (확정은 Level III 몫)</span>
              </label>
            ) : null}
            {auto > 0 ? (
              <label className="check labels-ack">
                <input type="checkbox" checked={confirmAuto} onChange={(e) => setConfirmAuto(e.target.checked)} />
                <span>자동으로 채운 {auto}행을 하나하나 보지 않은 것을 알고 저장합니다 (시험 정답이 됩니다)</span>
              </label>
            ) : null}
            {locked ? (
              <label className="field labels-review__reason">
                <span className="field__label">
                  시험 세트가 잠겨 있고 이 파일 {p.lockedTestFiles.length}개의 확정 세트(시험 정답)가 바뀝니다. 바꾸는 이유 (분할 기록에 남습니다)
                </span>
                <textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            ) : null}
            {p.blockers.length > 0 ? (
              <ul className="labels-msgs">
                {p.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            <div className="labels-review__save-actions">
              <button type="button" className="btn btn--secondary" disabled={props.busy || !p.result.designCheck} onClick={props.onDesignCsv}>
                설계값 대조 표 CSV 저장
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={props.busy || props.saving || props.previewing || !ready}
                onClick={() => props.onSave({ ...(confirmNotL3 ? { confirmNotLevel3: true } : {}), ...(locked ? { confirmLockedTest: true, reason: reason.trim() } : {}) })}
              >
                {props.saving ? '저장하는 중…' : '확정 세트 저장'}
              </button>
            </div>
          </div>
        </>
      ) : !props.previewError ? (
        <p className="t-caption">결정을 고르면 확정 세트와 설계값 대조를 미리 계산합니다.</p>
      ) : null}
      {props.saveError ? <ErrorNotice title="확정 세트를 저장하지 못했습니다" error={props.saveError} /> : null}
      {props.saved ? (
        <div className="notice notice--accent" role="status">
          <div className="notice__body">
            <p className="notice__title" data-focus-target tabIndex={-1}>
              확정 세트를 저장했습니다
            </p>
            <p>
              확정 기록: 새로 {props.saved.records.created} · 고침 {props.saved.records.updated} · 그대로 {props.saved.records.unchanged} · 지움 표시{' '}
              {props.saved.records.removed} / 검토 구간: 새로 {props.saved.reviewIntervals.created} · 고침 {props.saved.reviewIntervals.updated} · 지움 표시{' '}
              {props.saved.reviewIntervals.removed}
              {props.saved.lockedLog.length > 0 ? ` · 잠긴 시험 세트 기록에 남김: ${props.saved.lockedLog.join(', ')}` : ''}
            </p>
            <p className="t-caption">학습 데이터 내보내기는 이 파일들에서 확정 세트를 먼저 고릅니다(확정 &gt; 설계값 대조 &gt; 블라인드).</p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
