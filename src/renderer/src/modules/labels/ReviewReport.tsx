/**
 * 평가 보고서 미리보기 (평가_정의_v1.md 10절). 지금 비교 결과(+ 확정 미리보기의 설계값 대조)로 화면에서 계산하고,
 * 'CSV 저장'은 서비스가 저장소에서 같은 함수로 다시 계산해 쓴다. 머리 칸 가운데 앱이 모르는 값만 여기서 적는다.
 */
import { useId, useMemo } from 'react'
import type { ReviewComparison } from '@shared/api'
import { JUDGMENT_CHARACTER, TRUTH_TIER, type TruthTier } from '@shared/labels/codes'
import {
  LIST_KIND_LABEL,
  buildEvaluationReport,
  sensitivityGrid,
  type DesignCheckResult,
  type ReportHeaderInput
} from '@shared/labels/review'
import type { JudgmentCharacter } from '@shared/labels/types'
import { DASH, dateTime } from '../../lib/format'
import { ciText, fixed, pct, typeName } from './reviewFormat'

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled: boolean }) {
  return (
    <label className="field labels-review__hfield">
      <span className="field__label">{props.label}</span>
      <input className="input" value={props.value} maxLength={100} placeholder={props.placeholder} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  )
}

export function ReviewReport(props: {
  comparison: ReviewComparison
  design: DesignCheckResult | null
  header: ReportHeaderInput
  onHeader: (h: ReportHeaderInput) => void
  onCsv: () => void
  busy: boolean
}) {
  const id = useId()
  const c = props.comparison.comparison
  const sens = useMemo(() => sensitivityGrid(c), [c])
  const h = props.header
  const report = useMemo(
    () =>
      buildEvaluationReport({
        comparison: c,
        header: { ...h, testSetLockedAt: h.testSetLockedAt ?? props.comparison.testLockedAt, guidelineVersion: h.guidelineVersion ?? props.comparison.request.a.guidelineVersion },
        design: props.design,
        sensitivity: sens
      }),
    [c, h, props.design, sens, props.comparison.testLockedAt, props.comparison.request.a.guidelineVersion]
  )
  const hd = report.header
  const set = (k: keyof ReportHeaderInput, v: string): void => {
    const next: ReportHeaderInput = { ...h }
    if (v.trim() === '') delete next[k]
    else (next as Record<string, unknown>)[k] = v
    props.onHeader(next)
  }
  const fp = report.falsePositives
  const ch = report.types.character
  const pc = report.types.proposalClass
  return (
    <section className="labels-review__report stack" aria-labelledby={`${id}-t`}>
      <div className="labels-review__report-head">
        <h3 className="labels-subtitle" id={`${id}-t`}>
          평가 보고서 미리보기 · {hd.name}
        </h3>
        <span className="toolbar__spacer" />
        <button type="button" className="btn btn--secondary" disabled={props.busy} onClick={props.onCsv}>
          보고서 CSV 저장
        </button>
      </div>
      <div className="labels-review__hform" role="group" aria-label="보고서 머리 (앱이 모르는 값)">
        <Field label="데이터셋 버전" value={h.datasetVersion ?? ''} onChange={(v) => set('datasetVersion', v)} placeholder="예: X3-시범" disabled={props.busy} />
        <Field label="모델 버전 (AI 평가일 때)" value={h.modelVersion ?? ''} onChange={(v) => set('modelVersion', v)} disabled={props.busy} />
        <Field label="매칭 X·Y 동결 날짜" value={h.matchFrozenAt ?? ''} onChange={(v) => set('matchFrozenAt', v)} placeholder="비우면 잠정값" disabled={props.busy} />
        <label className="field labels-review__hfield">
          <span className="field__label">정답 계층 (A 쪽)</span>
          <span className="select">
            <select
              value={h.truthTier ?? ''}
              disabled={props.busy}
              onChange={(e) => {
                const next: ReportHeaderInput = { ...h }
                if (e.target.value === '') delete next.truthTier
                else next.truthTier = e.target.value as TruthTier
                props.onHeader(next)
              }}
            >
              <option value="">비움 (2인 비교)</option>
              {(Object.keys(TRUTH_TIER) as TruthTier[]).map((t) => (
                <option key={t} value={t}>
                  {TRUTH_TIER[t]}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <dl className="kv labels-review__report-kv">
        <dt>무엇 대비</dt>
        <dd>
          {hd.name} · A {hd.labelers.a ?? DASH} · B {hd.labelers.b ?? DASH}
        </dd>
        <dt>매칭 규칙</dt>
        <dd>
          v{hd.matchRulesVersion} · X {fixed(hd.scanGapMm)} mm · Y {fixed(hd.depthDiffMm)} mm · {hd.matchFrozenAt ? `동결 ${hd.matchFrozenAt}` : '잠정값 (동결 전)'} · 틀 {hd.frame} · 단위 {hd.unit}
        </dd>
        <dt>검토 범위</dt>
        <dd>
          {hd.coverageRule} · 검토 길이 {hd.reviewedLengthM !== null ? `${fixed(hd.reviewedLengthM, 3)} m` : DASH} · 용접부 {hd.welds} · 시편 {hd.specimens ?? DASH}
        </dd>
        <dt>독립 물리 결함</dt>
        <dd>
          {hd.physicalDefects.total} (면상 {hd.physicalDefects.planar} · 체적 {hd.physicalDefects.volumetric} · 모름 {hd.physicalDefects.unknown})
        </dd>
        <dt>시험 세트 · 정답</dt>
        <dd>
          잠금 {hd.testSetLockedAt ? dateTime(hd.testSetLockedAt) : '안 함'} · 정답 계층 {hd.truthTierLabel ?? DASH} · 지침서 {hd.guidelineVersion ?? DASH} · 데이터셋 {hd.datasetVersion ?? DASH} · 모델{' '}
          {hd.modelVersion ?? DASH}
        </dd>
      </dl>

      <div className="table-wrap">
        <table className="table table--compact labels-mini" aria-label="검출">
          <thead>
            <tr>
              <th>범주</th>
              <th className="num">물리 결함</th>
              <th className="num">찾음</th>
              <th>물리 결함 재현율 (95 %)</th>
              <th>지시 재현율 (95 %)</th>
              <th className="num">참고와만 맞음</th>
              <th className="num">짝 잃음</th>
              <th className="num">범위 밖 정답</th>
            </tr>
          </thead>
          <tbody>
            {report.detection.map((d) => (
              <tr key={d.category}>
                <td>{d.label}</td>
                {d.category === 'uncertain' ? (
                  <td colSpan={7} className="text-subtle">
                    불확실 정답 {d.uncertainTruths ?? 0}건 중 B 가 낸 것 {d.uncertainEmitted ?? 0}건 (따로 셈)
                  </td>
                ) : (
                  <>
                    <td className="num">{d.physicalDefects ?? DASH}</td>
                    <td className="num">{d.foundDefects ?? DASH}</td>
                    <td>{ciText(d.defectRecall)}</td>
                    <td>{ciText(d.indicationRecall)}</td>
                    <td className="num">{d.missesMatchedToReference ?? DASH}</td>
                    <td className="num">{d.missesLostCompetition ?? DASH}</td>
                    <td className="num">{d.truthOutsideCoverage ?? DASH}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="labels-review__line">
        오검출 {fp.falsePositives} · 용접부당 {fixed(fp.perWeld, 2)} · m당 {fixed(fp.perMeter, 2)} · 참고 정답과 맞아 뺌 {fp.predMatchedToReference} · 참고 구역이라 뺌{' '}
        {fp.predInZone} · 검토 범위 밖이라 뺌 {fp.predOutsideCoverage}
      </p>

      <div className="labels-review__report-grid">
        <div className="table-wrap">
          <table className="table table--compact labels-mini" aria-label="위치·크기 오차">
            <thead>
              <tr>
                <th>칸 (B − A, mm)</th>
                <th className="num">n</th>
                <th className="num">MAE</th>
                <th className="num">치우침</th>
                <th className="num">95 %</th>
                <th className="num">RMSE</th>
              </tr>
            </thead>
            <tbody>
              {report.errors.map((e) => (
                <tr key={e.field}>
                  <td>{e.label}</td>
                  <td className="num">{e.stats.n}</td>
                  <td className="num">{fixed(e.stats.mae, 2)}</td>
                  <td className="num">{fixed(e.stats.bias, 2)}</td>
                  <td className="num">{fixed(e.stats.p95Abs, 2)}</td>
                  <td className="num">{fixed(e.stats.rmse, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stack">
          <div className="table-wrap">
            <table className="table table--compact labels-mini" aria-label="종류 1단 혼동표">
              <thead>
                <tr>
                  <th>1단 (A ↓ · B →)</th>
                  {ch.classes.map((k) => (
                    <th key={k} className="num">
                      {JUDGMENT_CHARACTER[k as JudgmentCharacter]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ch.classes.map((k, i) => (
                  <tr key={k}>
                    <td>{JUDGMENT_CHARACTER[k as JudgmentCharacter]}</td>
                    {ch.matrix[i]!.map((v, j) => (
                      <td key={j} className="num">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="labels-review__line">
            1단 일치 {pct(ch.agreement)} · κ {fixed(ch.kappa.kappa, 2)} (n {ch.total}) · 2단(제안서 5종) 일치 {pct(pc.agreement)} · κ {fixed(pc.kappa.kappa, 2)} · 종류
            불확실로 뺀 쌍 {report.types.typeUncertainExcluded}
          </p>
          {report.grading ? (
            <p className="labels-review__line">
              구간 단위 {fixed(report.grading.unitMm, 0)} mm · 칸 {report.grading.units} (씀 {report.grading.used}, 참고 뺌 {report.grading.excludedReference}, 품질 불량 뺌{' '}
              {report.grading.excludedQuality}) · 표 [{report.grading.table[0].join(', ')} / {report.grading.table[1].join(', ')}] · κ {fixed(report.grading.kappa.kappa, 2)} ·
              정확도 {pct(report.grading.accuracy)} · 결함 없는 칸/결함 칸 {fixed(report.grading.negativesPerPositive, 1)}
            </p>
          ) : (
            <p className="t-caption">검토 범위를 몰라 구간 단위 일치도를 내지 않았습니다.</p>
          )}
          <p className="labels-review__line">
            POD: 물리 결함 {report.pod.defects} · 찾음 {report.pod.hits} · 95 % 하한 {pct(report.pod.lowerBound95)} · 90/95 에 필요한 결함 {report.pod.requiredFor9095}개.{' '}
            {report.pod.note}
          </p>
        </div>
      </div>

      {report.sensitivity ? (
        <div className="table-wrap">
          <table className="table table--compact labels-mini" aria-label="X·Y 민감도">
            <thead>
              <tr>
                <th className="num">X (mm)</th>
                <th className="num">Y (mm)</th>
                <th>지시 재현율</th>
                <th>물리 결함 재현율</th>
                <th className="num">오검출</th>
                <th className="num">F1</th>
              </tr>
            </thead>
            <tbody>
              {report.sensitivity.map((r) => (
                <tr key={`${r.scanGapMm}-${r.depthDiffMm}`} className={r.scanGapMm === hd.scanGapMm && r.depthDiffMm === hd.depthDiffMm ? 'is-selected' : undefined}>
                  <td className="num">{r.scanGapMm}</td>
                  <td className="num">{r.depthDiffMm}</td>
                  <td>{ciText(r.indicationRecall)}</td>
                  <td>{ciText(r.defectRecall)}</td>
                  <td className="num">{r.falsePositives}</td>
                  <td className="num">{fixed(r.f1, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {report.list.length > 0 ? (
        <div className="table-wrap">
          <table className="table table--compact labels-mini" aria-label="놓침·오검출 목록">
            <thead>
              <tr>
                <th>행</th>
                <th>구분</th>
                <th>파일</th>
                <th className="num">스캔 (mm)</th>
                <th className="num">깊이 중심</th>
                <th className="num">길이</th>
                <th>종류</th>
                <th>원인 (CSV 에서 사람이 채움)</th>
              </tr>
            </thead>
            <tbody>
              {report.list.map((l) => (
                <tr key={l.rowId}>
                  <td className="mono">{l.rowId}</td>
                  <td>
                    {LIST_KIND_LABEL[l.kind]}
                    {l.matchedToReference ? ' (참고와만 맞음)' : ''}
                  </td>
                  <td className="truncate labels-file">{l.fileNames.join(', ')}</td>
                  <td className="num">
                    {fixed(l.scanStartMm)}–{fixed(l.scanEndMm)}
                  </td>
                  <td className="num">{fixed(l.depthCenterMm)}</td>
                  <td className="num">{fixed(l.lengthMm)}</td>
                  <td>{typeName(l.defectType)}</td>
                  <td className="text-faint">{DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="t-caption">놓침·오검출이 없습니다.</p>
      )}

      {report.design ? (
        <p className="labels-review__line">
          설계값 대조 ({report.design.minTierLabel}): 설계 결함 {report.design.defects} (셈함 {report.design.countedDefects}) · 짝 {report.design.matched} · 미검출{' '}
          {report.design.missed} (범위 밖 {report.design.missedOutsideCoverage}) · 추가 발견 {report.design.extra} · 종류 불일치 {report.design.typeMismatches} · ID 불일치{' '}
          {report.design.idMismatches} · 재현율 {ciText(report.design.recall)}
        </p>
      ) : (
        <p className="t-caption">설계값 대조는 'Level III 확정'에서 결정을 고르면 붙습니다.</p>
      )}

      {report.warnings.length > 0 ? (
        <details>
          <summary className="t-caption">보고서 확인 사항 {report.warnings.length}건</summary>
          <ul className="labels-msgs">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
