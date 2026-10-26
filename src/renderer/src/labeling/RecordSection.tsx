/**
 * '새 기록' (또는 저장한 기록 고치기) — 지침서 순서대로 세 단계 + 저장:
 *   ① 단면: 높이 입력 방식을 고르면 찍을 점 목록이 정해진다. 목록 칸을 누르면 그 점을 찍을 차례(도구 1 점·역할), 사각형 = 에코 범위(도구 2,
 *      결함이면 필수 — '에코 범위 자동'은 최대 진폭 칸에서 평가 기준 이상 칸 덩어리로 채운다). 찍으면 다음 빈 칸으로 넘어간다.
 *      찍은 점 목록(.label-panel__item)은 'V · 깊이 (레그) · %FSH'. A-scan 시간 커서 깊이를 지금 점으로(T).
 *   ② 길이: 기준 커서 R(시작) → 현재 커서(끝), '이 길이로'. 그 뒤에만 앱 제안을 비교값으로 (2인 독립 모드면 숨김, 포화·동적 범위 부족이면 '제안 불가'와 이유).
 *   ③ 속성: 기록 구분 · 결함 종류 · 존재 확신도 · 메모. 나머지 칸은 '세부 칸'에 접어 둔다.
 *   저장: 파란 버튼 하나(패널에서 이것만, 패널 아래에 붙어 늘 보임 · Ctrl/Cmd+Enter). 막는 문제는 빨강 글자, 볼 것은 파랑 빈 원.
 *   평가 기준 미만이면 '기준 미만 지시로 바꾸기'(검토 구간 초안으로, 지침서 5.2). 존재 확신도·형상 불완전 세부는 미리 채우지 않는다(꼭 고름).
 * 읽기값(올려 둔 점·시간 커서)은 맨 아래 — 파일 이득 0 dB.
 */
import { useSyncExternalStore, type Dispatch } from 'react'
import {
  CONFIDENCE,
  GEOMETRIC_ECHO_KIND,
  GEOMETRIC_IMPERFECTION_KIND,
  HEIGHT_METHOD,
  HEIGHT_METHOD_IN_SPEC,
  JUDGMENT_CHARACTER,
  LENGTH_METHOD,
  METALLURGICAL_TYPE,
  RECORD_KIND,
  SURFACE_CLASS,
  WELD_SIDE,
  WELD_ZONE,
  codesOf,
  isVolumetricType,
  type AnchorRole,
  type Confidence,
  type HeightMethod,
  type LengthMethod,
  type MetallurgicalType,
  type ReadingStage,
  type PhysicalDefect,
  type RecordKind,
  type SignalInfo
} from '@shared/labels'
import type { RefBasis } from '@shared/imaging'
import { num } from '../lib/format'
import { signalText } from './recordText'
import { ROLE_SHORT } from './overlays'
import type { ShownSuggestion } from './panelState'
import { NumberField, Problems, ReadingRows, Row, SelectField, TriField } from './PanelParts'
import type { PointReading } from './reading'
import { lengthMethodFor, roleName, sectionChecklist, type BuildRecordResult, type DraftLength, type RecordForm } from './record'
import { SUGGESTION_VISIBILITY_TEXT, type SuggestionVisibility } from './labelSet'
import type { LabelAction, LabelDraftPoint, LabelState } from './state'
import type { ValueStore } from './store'

const KIND_OPTIONS = codesOf(RECORD_KIND).map((id) => ({ id, name: RECORD_KIND[id] }))
const TYPE_OPTIONS = codesOf(METALLURGICAL_TYPE).map((id) => ({ id, name: METALLURGICAL_TYPE[id] }))
const CONF_OPTIONS = codesOf(CONFIDENCE).map((id) => ({ id, name: CONFIDENCE[id] }))
const HEIGHT_OPTIONS = codesOf(HEIGHT_METHOD).map((id) => ({ id, name: HEIGHT_METHOD[id] }))

export interface RecordSectionProps {
  state: LabelState
  dispatch: Dispatch<LabelAction>
  form: RecordForm
  onForm: (patch: Partial<RecordForm>) => void
  stage: ReadingStage | null
  thicknessMm: number | null
  /** 고치는 기록 (지시 번호) */
  editing: { uuid: string; number: string | null } | null
  onCancelEdit: () => void
  readingOf: (p: LabelDraftPoint) => PointReading | null
  groupName: (id: number) => string
  /** 지금 R → 커서 길이 S(m−r) (스캔축 — OmniPC 의 U(m−r) 은 초음파축 차라 길이가 아님) */
  refLengthMm: number | null
  refText: string | null
  length: DraftLength | null
  lengthBeamText: string | null
  onCommitLength: () => void
  onClearLength: () => void
  lengthNote: string | null
  /** 길이를 잰 빔이 최대 진폭 빔과 다를 때: R 의 빔을 최대 진폭 빔으로 (없으면 null) */
  onPeakBeam: (() => void) | null
  visibility: SuggestionVisibility
  shown: ShownSuggestion | null
  accepted: boolean
  onAccept: () => void
  /** 에코 범위 자동 (최대 진폭 칸에서 평가 기준 이상 칸 덩어리) */
  onAutoRect: () => void
  echoNote: string | null
  /** 평가 기준 미만일 때: 검토 구간 '기준 미만 지시' 초안으로 (없으면 null) */
  onBelowThreshold: (() => void) | null
  /** 미리 본 기록 (저장 전 문제·경고) */
  build: BuildRecordResult
  /** 미리 본 신호·높이 */
  signal: SignalInfo | null
  /** 신호 그룹의 진폭 눈금이 추정값인가 (OPD raw 255 = 250 %) — '추정 눈금' 표시 */
  ampEstimated?: boolean
  /** 신호 그룹의 Ref 근거 단계 (X2, core 가 파일 셋업으로 정함). 'single-depth' 면 'Ref 근거 약함(TCG 없음)' 을 붙인다. 없으면 표시 없음 */
  refBasis?: RefBasis | null
  heightMm: number | null
  canSave: boolean
  busy: boolean
  onSave: () => void
  hover: ValueStore<PointReading | null>
  timeReading: PointReading | null
  /** 시간 커서 깊이를 지금 찍을 점으로 (T) */
  onTimePoint: () => void
  /** 설계값 대조 단계: 이 파일 시편의 물리 결함 (ID 고르기) */
  physicalDefects: readonly PhysicalDefect[]
  /** 2인 독립 모드 */
  blind: boolean
}

function levelText(s: SignalInfo | null): string {
  if (!s || s.maxAmplitudePct === null) return '—'
  const t = (v: boolean | null, yes: string, no: string): string => (v === null ? '모름' : v ? yes : no)
  return `평가 기준 ${t(s.exceedsEvaluationLevel, '넘음', '못 넘음')} · 기록 기준 ${t(s.exceedsRecordingLevel, '넘음', '못 넘음')}`
}

export function RecordSection(p: RecordSectionProps) {
  const { state, dispatch, form } = p
  const { draft, ui } = state
  const hover = useSyncExternalStore(p.hover.subscribe, p.hover.get)
  const items = sectionChecklist(form, draft)
  const isDefect = form.kind === 'defect'
  const pickItem = (id: AnchorRole | 'rect'): void => {
    if (id === 'rect') {
      dispatch({ type: 'setTool', tool: 'rect' })
      return
    }
    dispatch({ type: 'setTool', tool: 'point' })
    dispatch({ type: 'setPointRole', role: id })
  }
  const activeItem = ui.tool === 'rect' ? 'rect' : ui.tool === 'point' ? ui.pointRole : null
  const method = isDefect ? form.heightMethod : 'unmeasurable'
  const sug = p.shown?.suggestion ?? null
  const typeVolumetric = form.defectType !== null && isVolumetricType(form.defectType)

  return (
    <>
      {p.editing ? (
        <div className="notice notice--accent label-edit" role="status">
          <div className="notice__body">
            <p className="notice__title">기록 {p.editing.number !== null ? `#${p.editing.number}` : ''} 고치는 중</p>
            <p>점·길이·속성을 고친 뒤 저장하면 그 기록이 바뀝니다 (재확인 표시도 지워집니다).</p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={p.onCancelEdit}>
            그만두기
          </button>
        </div>
      ) : null}

      {/* ① 단면 */}
      <section className="label-panel__section" aria-label="단면">
        <div className="label-panel__headrow">
          <h3 className="label-panel__heading">① 단면 — 최대 진폭 장면의 S-scan</h3>
        </div>
        {isDefect ? (
          <SelectField<HeightMethod>
            label="높이 입력"
            value={form.heightMethod}
            options={HEIGHT_OPTIONS}
            onChange={(v) => v && p.onForm({ heightMethod: v })}
            title="상하 팁 · 팁 + 표면 · 노정 시간이 시방서 방법입니다. −6 dB 높이는 참고값(표 14 판정에 쓰지 않음)"
          />
        ) : null}
        {isDefect && !HEIGHT_METHOD_IN_SPEC[form.heightMethod] && form.heightMethod !== 'unmeasurable' ? (
          <p className="label-panel__note">−6 dB 높이는 시방서 밖 참고값입니다. 포화되면 쓸 수 없습니다.</p>
        ) : null}
        <div className="label-chips" role="group" aria-label="찍을 점">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="label-chip"
              aria-pressed={activeItem === it.id}
              data-done={it.done}
              title={it.id === 'rect' ? '사각형 도구(2): S-scan 을 끌어 에코 범위(평가 기준을 넘는 위·아래·좌우)를 그립니다' : `${it.name} 점을 찍을 차례로 (점 도구 1)`}
              onClick={() => pickItem(it.id)}
            >
              <span aria-hidden="true">{it.done ? '●' : '○'}</span> {it.name}
              {it.required && !it.done ? <span className="visually-hidden"> (필수)</span> : null}
            </button>
          ))}
        </div>
        {draft.points.length ? (
          <ul className="label-panel__list">
            {draft.points
              .filter((pt) => pt.role !== 'length-start' && pt.role !== 'length-end')
              .map((pt) => {
                const r = p.readingOf(pt)
                return (
                  <li key={pt.id} className="label-panel__item" aria-current={ui.selectedId === pt.id}>
                    <button
                      type="button"
                      title={`${roleName(pt.role, method)} · ${p.groupName(pt.groupId)} · 스캔 ${num(pt.scanMm)} mm`}
                      onClick={() => dispatch({ type: 'select', id: pt.id })}
                    >
                      {ROLE_SHORT[pt.role]} · V {num(r?.vMm, 1)} · 깊이 {num(r?.depthMm, 1)} mm{r?.leg ? ` (L${r.leg})` : ''} · {r?.amplitudePct == null ? '—' : `${num(r.amplitudePct)} %FSH`}
                    </button>
                    <button type="button" className="btn btn--ghost" aria-label={`${roleName(pt.role, method)} 점 지우기`} onClick={() => dispatch({ type: 'removePoint', id: pt.id })}>
                      지우기
                    </button>
                  </li>
                )
              })}
          </ul>
        ) : (
          <p className="label-panel__empty">C-scan 에서 지시를 찾아 최대 진폭 칸에 커서를 두고 N(그 칸 게이트 최대 점) 또는 S-scan 을 누릅니다.</p>
        )}
        {draft.rect ? (
          <dl className="label-panel__list">
            <Row label="에코 범위">
              V {num(draft.rect.vMinMm)}~{num(draft.rect.vMaxMm)} · 펼친 깊이 {num(draft.rect.depthMinMm)}~{num(draft.rect.depthMaxMm)} mm{' '}
              <button type="button" className="btn btn--link" onClick={() => dispatch({ type: 'setRect', rect: null })}>
                지우기
              </button>
            </Row>
          </dl>
        ) : null}
        <div className="label-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={p.onAutoRect}
            title="최대 진폭 점의 칸에서 평가 기준(%FSH) 이상으로 이어진 칸 덩어리의 V·깊이 범위로 에코 범위 사각형을 채웁니다 (지침서 6.4). 영상에서 확인하세요"
          >
            에코 범위 자동
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!p.timeReading}
            onClick={p.onTimePoint}
            title="A-scan 시간 커서(클릭한 깊이)를 지금 찍을 점으로 — 그 빔·스캔에서 정확한 팁 피크 깊이 (T)"
          >
            시간 커서를 점으로 (T)
          </button>
        </div>
        {p.echoNote ? <p className="label-panel__note">{p.echoNote}</p> : null}
      </section>

      {/* ② 길이 */}
      <section className="label-panel__section" aria-label="길이">
        <div className="label-panel__headrow">
          <h3 className="label-panel__heading">② 길이 — 기준 커서 R → 현재 커서</h3>
        </div>
        <dl className="label-panel__list">
          <Row label="R" title="R 키 = 지금 커서를 기준 커서로, 길이 도구(3)로 C/B-scan 을 끌면 누른 곳이 R">
            {p.refText ?? 'R 키 또는 길이 도구(3)로 C-scan 끌기'}
          </Row>
          <Row label="S(m−r)" title="기준 커서 R → 현재 커서의 스캔축 거리 = 길이 (OmniPC S(m−r)). OmniPC 의 U(m−r) 은 초음파축(깊이) 차입니다">
            {p.refLengthMm === null ? '—' : `${num(Math.abs(p.refLengthMm))} mm`}
          </Row>
        </dl>
        <div className="label-actions">
          <button type="button" className="btn btn--secondary" disabled={!draft.ref} onClick={p.onCommitLength} title="R 과 현재 커서 사이를 이 기록의 길이로 (시작·끝 점)">
            이 길이로
          </button>
          {p.length ? (
            <button type="button" className="btn btn--ghost" onClick={p.onClearLength}>
              길이 지우기
            </button>
          ) : null}
        </div>
        {p.lengthNote ? <p className="label-panel__note status status--attention">{p.lengthNote}</p> : null}
        {p.onPeakBeam ? (
          <p className="label-panel__note">
            길이를 잰 빔이 최대 진폭 빔이 아닙니다.{' '}
            <button type="button" className="btn btn--link" onClick={p.onPeakBeam}>
              최대 진폭 빔으로 R 맞추기
            </button>
          </p>
        ) : null}
        {p.length ? (
          <dl className="label-panel__list">
            <Row label="길이">
              {num(p.length.startMm)}–{num(p.length.endMm)} · <span className="text-strong">{num(p.length.lengthMm)} mm</span>
            </Row>
            <Row label="잰 빔">{p.lengthBeamText ?? '—'}</Row>
            <Row label="측정법">{LENGTH_METHOD[lengthMethodFor(p.thicknessMm, form.lengthMethod)]}</Row>
          </dl>
        ) : null}
        {/* 앱 제안: 전문가가 먼저 잰 뒤 비교값으로만 */}
        {p.visibility !== 'show' ? (
          <p className="label-panel__note">{SUGGESTION_VISIBILITY_TEXT[p.visibility]}</p>
        ) : p.shown ? (
          <div className="label-suggest" aria-label="앱 길이 제안 (비교용)">
            <p className="label-suggest__title">앱 제안 (비교용)</p>
            {sug?.available ? (
              <>
                <p className="num">
                  {num(sug.scanStartMm)}–{num(sug.scanEndMm)} · <span className="text-strong">{num(sug.lengthMm)} mm</span>
                  <span className="unit">
                    {' '}
                    · 빔 {num(sug.angleDeg)}° · 문턱 {num(sug.thresholdPct)} %
                  </span>
                </p>
                <p className="num unit">
                  내 길이와 차 {num((p.length?.lengthMm ?? 0) - (sug.lengthMm ?? 0))} mm{p.accepted ? ' · 제안을 그대로 씀' : ''}
                </p>
                {sug.needsCheck && sug.checkReason ? <p className="status status--attention">확인 필요: {sug.checkReason}</p> : null}
                {!p.accepted ? (
                  <button type="button" className="btn btn--ghost" onClick={p.onAccept} title="제안 구간을 이 기록의 길이로 (수락 여부·수정량이 제안 기록에 남습니다)">
                    제안값으로 바꾸기
                  </button>
                ) : null}
              </>
            ) : (
              <p className="status status--muted">제안 불가: {sug?.message ?? p.shown.reason ?? '이유 모름'}</p>
            )}
          </div>
        ) : p.length ? (
          <p className="label-panel__note">'이 길이로'를 누르면 그때 앱 제안을 계산해 비교값으로 보여 줍니다.</p>
        ) : null}
      </section>

      {/* ③ 속성 */}
      <section className="label-panel__section" aria-label="속성">
        <div className="label-panel__headrow">
          <h3 className="label-panel__heading">③ 속성</h3>
        </div>
        <SelectField<RecordKind> label="구분" value={form.kind} options={KIND_OPTIONS} onChange={(v) => v && p.onForm({ kind: v })} />
        {isDefect ? (
          <SelectField<MetallurgicalType>
            label="결함 종류"
            value={form.defectType}
            options={TYPE_OPTIONS}
            allowEmpty="고르지 않음"
            onChange={(v) => p.onForm({ defectType: v, character: null, alignedVolumetric: v !== null && isVolumetricType(v) ? p.form.alignedVolumetric : false })}
          />
        ) : form.kind === 'geometric-echo' ? (
          <SelectField label="형상 에코" value={form.echoKind} options={codesOf(GEOMETRIC_ECHO_KIND).map((id) => ({ id, name: GEOMETRIC_ECHO_KIND[id] }))} onChange={(v) => v && p.onForm({ echoKind: v })} />
        ) : (
          <SelectField
            label="형상 불완전"
            value={form.imperfectionKind}
            options={codesOf(GEOMETRIC_IMPERFECTION_KIND).map((id) => ({ id, name: GEOMETRIC_IMPERFECTION_KIND[id] }))}
            allowEmpty="고르세요"
            onChange={(v) => p.onForm({ imperfectionKind: v })}
          />
        )}
        <SelectField<Confidence>
          label="존재 확신도"
          value={form.existenceConfidence}
          options={CONF_OPTIONS}
          allowEmpty="고르세요"
          onChange={(v) => p.onForm({ existenceConfidence: v })}
          title="확실: 두 가지 이상에서 확인 · 보통: 한 그룹·레그에서만 분명 · 불확실: 잡음·형상 에코와 구분 안 됨 (불확실은 학습에서 뺌)"
        />
        <details className="label-details">
          <summary>세부 칸</summary>
          {isDefect ? (
            <>
              <SelectField<Confidence> label="종류 확신도" value={form.typeConfidence} options={CONF_OPTIONS} allowEmpty="—" onChange={(v) => p.onForm({ typeConfidence: v })} />
              <SelectField
                label="판정 특성"
                value={form.character}
                options={codesOf(JUDGMENT_CHARACTER).map((id) => ({ id, name: JUDGMENT_CHARACTER[id] }))}
                allowEmpty="종류 기본값"
                disabled={form.alignedVolumetric}
                onChange={(v) => p.onForm({ character: v })}
              />
              {typeVolumetric ? (
                <label className="check label-check">
                  <input type="checkbox" checked={form.alignedVolumetric} onChange={(e) => p.onForm({ alignedVolumetric: e.target.checked })} />
                  <span>일렬 체적 → 면상</span>
                </label>
              ) : null}
              <SelectField label="표면" value={form.surface} options={codesOf(SURFACE_CLASS).map((id) => ({ id, name: SURFACE_CLASS[id] }))} allowEmpty="—" onChange={(v) => p.onForm({ surface: v })} />
              <TriField label="점 같은 지시" value={form.pointLike} onChange={(v) => p.onForm({ pointLike: v })} />
            </>
          ) : null}
          <SelectField label="위치 구분" value={form.zone} options={codesOf(WELD_ZONE).map((id) => ({ id, name: WELD_ZONE[id] }))} allowEmpty="—" onChange={(v) => p.onForm({ zone: v })} />
          <SelectField label="좌우 (시편 L/R)" value={form.side} options={codesOf(WELD_SIDE).map((id) => ({ id, name: WELD_SIDE[id] }))} allowEmpty="가운데·모름" onChange={(v) => p.onForm({ side: v })} />
          <label className="check label-check">
            <input type="checkbox" checked={form.noBevelOverlay} onChange={(e) => p.onForm({ noBevelOverlay: e.target.checked })} />
            <span>개선 덮개 없이 고른 위치</span>
          </label>
          {isDefect ? (
            <>
              <SelectField<LengthMethod>
                label="길이 측정법"
                value={form.lengthMethod}
                options={codesOf(LENGTH_METHOD).map((id) => ({ id, name: LENGTH_METHOD[id] }))}
                allowEmpty={`두께로 (${LENGTH_METHOD[lengthMethodFor(p.thicknessMm, null)]})`}
                onChange={(v) => p.onForm({ lengthMethod: v })}
              />
              {lengthMethodFor(p.thicknessMm, form.lengthMethod) === '6db-curvature' ? (
                <NumberField label="관 외경" unit="mm" value={form.outerDiameterMm} onChange={(v) => p.onForm({ outerDiameterMm: v })} title="곡률 보정 l_c = l_s × (OD − 2d) / OD. 판이면 비웁니다" />
              ) : null}
              {form.lengthMethod === 'other' ? (
                <>
                  <NumberField
                    label="길이 문턱"
                    unit="%FSH"
                    value={form.lengthThresholdPct}
                    onChange={(v) => p.onForm({ lengthThresholdPct: v })}
                    title="길이 끝을 정한 진폭 문턱 (파일 이득 0 dB). 띠 위 지시는 '바탕 + 6 dB' (지침서 6.2(나))"
                  />
                  <p className="label-panel__note">측정법 '기타'는 문턱과 근거를 메모에 적습니다 (예: 루트 띠 바탕 + 6 dB).</p>
                </>
              ) : null}
            </>
          ) : null}
          <label className="check label-check" title={p.stage && p.stage !== 'blind' ? '설계값 대조·확정 단계는 늘 봤음으로 저장합니다' : undefined}>
            <input type="checkbox" checked={p.stage !== 'blind' || form.designValueSeen} disabled={p.stage !== null && p.stage !== 'blind'} onChange={(e) => p.onForm({ designValueSeen: e.target.checked })} />
            <span>설계값을 봤음</span>
          </label>
          <TriField label="시편 미리 앎" value={form.specimenKnown} onChange={(v) => p.onForm({ specimenKnown: v })} />
          <TriField label="AI 개발 참여" value={form.aiDevParticipant} onChange={(v) => p.onForm({ aiDevParticipant: v })} />
          {p.stage && p.stage !== 'blind' ? (
            <div className="label-field">
              <label htmlFor="label-pdid">물리 결함 ID</label>
              <input
                id="label-pdid"
                className="input"
                value={form.physicalDefectId}
                placeholder={p.physicalDefects.length ? '목록에서 고르기' : 'D1'}
                maxLength={64}
                list={p.physicalDefects.length ? 'label-pdid-list' : undefined}
                onChange={(e) => p.onForm({ physicalDefectId: e.target.value })}
              />
              {p.physicalDefects.length ? (
                <datalist id="label-pdid-list">
                  {p.physicalDefects.map((d) => (
                    <option key={`${d.specimenId}|${d.id}`} value={d.id}>
                      {d.specimenId} · {d.id}
                    </option>
                  ))}
                </datalist>
              ) : null}
            </div>
          ) : null}
        </details>
        <div className="label-field label-field--wide">
          <label htmlFor="label-note">메모</label>
          <textarea id="label-note" className="textarea label-note" rows={2} value={form.note} placeholder="판단 근거 한 줄" onChange={(e) => p.onForm({ note: e.target.value })} />
        </div>
        <dl className="label-panel__list">
          <Row label="최대 진폭" title="단면 둘레(빔 ± 2 · 깊이 ± 1.5 mm, 길이 구간)의 최대, 파일 이득 0 dB (소프트 이득과 무관). Ref 는 파일 셋업으로 추정한 값 (OmniPC 대조 전)">
            {signalText(p.signal, p.ampEstimated, p.refBasis ?? null)}
          </Row>
          {isDefect ? <Row label="기준">{levelText(p.signal)}</Row> : null}
          {p.onBelowThreshold ? (
            <div className="label-panel__row">
              <dt />
              <dd>
                <button type="button" className="btn btn--link" onClick={p.onBelowThreshold} title="평가 기준 미만 지시는 결함 기록이 아니라 검토 구간 '기준 미만 지시'로 적습니다 (지침서 5.2)">
                  기준 미만 지시로 바꾸기
                </button>
              </dd>
            </div>
          ) : null}
          {isDefect ? <Row label="높이">{form.heightMethod === 'unmeasurable' ? '측정 불가' : p.heightMm === null ? '—' : `${num(p.heightMm, 2)} mm (${HEIGHT_METHOD[form.heightMethod]})`}</Row> : null}
        </dl>
      </section>

      <section className="label-panel__section label-save label-save--sticky" aria-label="저장">
        <Problems problems={p.build.problems} warnings={p.build.warnings} />
        <div className="label-actions">
          <button type="button" className="btn btn--primary" disabled={!p.canSave || p.busy} onClick={p.onSave} title="Ctrl/Cmd+Enter">
            {p.editing ? '고친 내용 저장' : '기록 저장'}
          </button>
          <button type="button" className="btn btn--ghost" disabled={!draft.points.length && !draft.rect && !draft.ref} onClick={() => dispatch({ type: 'clearDraft' })}>
            초안 지우기
          </button>
        </div>
      </section>

      <section className="label-panel__section" aria-label="읽기값">
        <h3 className="label-panel__heading">올려 둔 점 (파일 이득 0 dB)</h3>
        <ReadingRows r={hover} />
        <h3 className="label-panel__heading">시간 커서 (A-scan 클릭)</h3>
        <ReadingRows r={p.timeReading} />
      </section>
    </>
  )
}
