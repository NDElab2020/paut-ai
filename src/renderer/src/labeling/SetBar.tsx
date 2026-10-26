/**
 * 라벨 세트 머리 (패널 맨 위): 지금 라벨러 · 지침서 버전 · 판독 단계 한 줄과 '바꾸기'.
 * 라벨러는 지금 라벨러(labels:session)다 — 바꾸면 세션의 지금 라벨러가 바뀌고 앞 라벨러의 초안은 버린다
 * (2인 독립 모드면 한 번 더 묻는다, 라벨 관리 화면과 같음). 라벨러가 없으면 라벨 관리로 안내한다(찍은 점은 남는다).
 * 블라인드 세트: '제출(잠금)' — 그 뒤 고치지 않음(블라인드 기준선 보호) · '설계값 대조 시작' — 블라인드를 제출하고 새 UUID 사본(대조 세트)을 만든다
 * (지침서 2.4·15절). 제출을 풀 때는 이유가 필요하다. 확정 세트는 검수 화면에서만 만든다(여기서는 보기만).
 */
import { useEffect, useId, useState } from 'react'
import { dateTime } from '../lib/format'
import type { LabelSession, LabelSetInfo } from '@shared/api'
import type { LabelSetKey, ReadingStage } from '@shared/labels'
import { Status } from '../components/Status'
import { DEFAULT_GUIDELINE, SET_REASON_TEXT, STAGES, STAGE_SHORT, cleanGuideline, setLabel, setsOfLabeler, type LabelSetChoice, type SetReady } from './labelSet'

export function SetBar(props: {
  session: LabelSession | null
  sets: readonly LabelSetInfo[]
  sha256: string
  ready: SetReady
  choice: LabelSetChoice
  open: boolean
  busy: boolean
  onOpen: (open: boolean) => void
  onChoice: (c: LabelSetChoice) => void
  onLabeler: (labelerId: string | null) => void
  /** 이 세트를 제출(잠금)한 시각 (아니면 null) */
  submittedAt: string | null
  /** 블라인드에서 복사해 온 대조 세트면 원본 setId */
  copiedFrom: string | null
  /** 이 세트에 기록·검토 구간이 있나 */
  hasRecords: boolean
  onSubmit: (submit: boolean, reason?: string) => void
  onReconcile: () => void
}) {
  const ids = useId()
  const { session, ready } = props
  const [pendingLabeler, setPendingLabeler] = useState<string | null | undefined>(undefined)
  const [ask, setAsk] = useState<'submit' | 'unsubmit' | 'reconcile' | null>(null)
  const [reason, setReason] = useState('')
  const [guide, setGuide] = useState(props.choice.guidelineVersion)
  // 밖에서 세트가 바뀌면(목록에서 고름·다른 라벨러) 입력 칸도 따라간다
  useEffect(() => setGuide(props.choice.guidelineVersion), [props.choice.guidelineVersion])
  const mine = setsOfLabeler(props.sets, props.sha256, session?.labelerId ?? null)
  const pick = (labelerId: string | null): void => {
    if (session?.blindMode && labelerId !== session.labelerId) setPendingLabeler(labelerId)
    else props.onLabeler(labelerId)
  }
  const choose = (c: LabelSetChoice): void => {
    setGuide(c.guidelineVersion)
    props.onChoice(c)
  }
  const key: LabelSetKey | null = ready.ok ? ready.key : null
  // 이미 설계값 대조 세트가 있으면 '대조 시작' 대신 그 세트로 가는 링크
  const reconciled = key ? (mine.find((s) => s.readingStage === 'reconciled' && s.guidelineVersion === key.guidelineVersion) ?? null) : null

  return (
    <section className="label-panel__section label-set" aria-label="라벨 세트">
      <div className="label-panel__headrow">
        <h3 className="label-panel__heading">세트</h3>
        <span className="label-panel__aside">
          {ready.ok ? (
            <button type="button" className="btn btn--link" aria-expanded={props.open} onClick={() => props.onOpen(!props.open)}>
              {props.open ? '닫기' : '바꾸기'}
            </button>
          ) : null}
        </span>
      </div>
      {ready.ok ? (
        <>
          <p className="label-set__line" title="라벨 세트 = 파일 · 라벨러 · 지침서 버전 · 판독 단계">
            <span className="text-strong">{setLabel(ready.labelerName, ready.key)}</span>
            {ready.isNew ? <span className="tag">새 세트</span> : null}
            {props.submittedAt ? (
              <Status tone="muted" title={`제출 ${dateTime(props.submittedAt)} — 이 세트는 고치지 않습니다`}>
                제출함
              </Status>
            ) : null}
            {props.copiedFrom ? <span className="tag" title="블라인드 세트를 복사해 만든 설계값 대조 세트 (원본은 제출됨)">블라인드 사본</span> : null}
          </p>
          {ready.key.readingStage !== 'final' ? (
            <div className="label-actions label-set__actions">
              {ready.key.readingStage === 'blind' && !props.submittedAt && props.hasRecords ? (
                <button type="button" className="btn btn--ghost" disabled={props.busy} onClick={() => setAsk('submit')} title="블라인드 판독을 마쳤으면 제출(잠금)합니다. 그 뒤 이 세트는 고치지 않습니다">
                  제출(잠금)
                </button>
              ) : null}
              {ready.key.readingStage === 'blind' && props.hasRecords && !reconciled ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={props.busy}
                  onClick={() => setAsk('reconcile')}
                  title="블라인드 세트를 제출하고 새 UUID 로 복사한 '설계값 대조' 세트를 만듭니다. 설계값을 본 뒤에는 그 사본에서 고칩니다"
                >
                  설계값 대조 시작
                </button>
              ) : null}
              {ready.key.readingStage === 'blind' && reconciled ? (
                <button type="button" className="btn btn--link" onClick={() => choose({ guidelineVersion: reconciled.guidelineVersion, readingStage: 'reconciled' })}>
                  설계값 대조 세트로
                </button>
              ) : null}
              {props.submittedAt ? (
                <button type="button" className="btn btn--link" disabled={props.busy} onClick={() => setAsk('unsubmit')}>
                  제출 풀기
                </button>
              ) : null}
            </div>
          ) : null}
          {ask ? (
            <div className="notice notice--accent" role="alert">
              <div className="notice__body">
                <p>
                  {ask === 'submit'
                    ? '이 블라인드 세트를 제출(잠금)합니다. 그 뒤 이 세트의 기록·검토 구간·관측 표는 고치지 않습니다 (사람 기준선).'
                    : ask === 'reconcile'
                      ? '블라인드 세트를 제출(잠금)하고, 같은 기록·검토 구간·확인한 관측을 새 UUID 로 복사한 설계값 대조 세트를 만듭니다. 설계값을 본 뒤에는 그 사본에서만 고칩니다.'
                      : '제출을 풉니다. 블라인드 기준선을 다시 고치게 되니 이유를 적으세요 (기록에 남습니다).'}
                </p>
                {ask === 'unsubmit' ? (
                  <input className="input" value={reason} maxLength={500} placeholder="푸는 이유" aria-label="제출을 푸는 이유" onChange={(e) => setReason(e.target.value)} />
                ) : null}
                <div className="label-actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={props.busy || (ask === 'unsubmit' && reason.trim() === '')}
                    onClick={() => {
                      const a = ask
                      setAsk(null)
                      if (a === 'submit') props.onSubmit(true)
                      else if (a === 'unsubmit') props.onSubmit(false, reason.trim())
                      else props.onReconcile()
                      setReason('')
                    }}
                  >
                    {ask === 'submit' ? '제출하기' : ask === 'reconcile' ? '대조 시작하기' : '제출 풀기'}
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setAsk(null)}>
                    취소
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="notice notice--accent label-set__notice" role="status">
          <div className="notice__body">
            <p>{SET_REASON_TEXT[ready.reason]}</p>
          </div>
        </div>
      )}
      {session?.blindMode ? (
        <p className="label-panel__note">
          <Status tone="attention">2인 독립 모드</Status> 다른 라벨러 세트와 앱 길이 제안을 숨깁니다.
        </p>
      ) : null}

      {props.open || !ready.ok ? (
        <div className="label-set__form">
          <div className="label-field">
            <label htmlFor={`${ids}-lab`}>라벨러</label>
            <span className="select">
              <select id={`${ids}-lab`} value={session?.labelerId ?? ''} disabled={props.busy || !session} onChange={(e) => pick(e.target.value === '' ? null : e.target.value)}>
                <option value="">고르지 않음</option>
                {(session?.labelers ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.id})
                  </option>
                ))}
              </select>
            </span>
          </div>
          {pendingLabeler !== undefined ? (
            <div className="notice notice--accent" role="alert">
              <div className="notice__body">
                <p>2인 독립 모드입니다. 라벨러를 바꾸면 그 라벨러의 세트가 보이고, 지금 찍던 초안(점·사각형·R·검토 구간)은 버립니다. 지금 PC 앞에 있는 사람이 맞나요?</p>
                <div className="label-actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      const v = pendingLabeler
                      setPendingLabeler(undefined)
                      props.onLabeler(v ?? null)
                    }}
                  >
                    라벨러 바꾸기
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setPendingLabeler(undefined)}>
                    취소
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="label-field">
            <label htmlFor={`${ids}-gv`}>지침서</label>
            <input
              id={`${ids}-gv`}
              className="input"
              value={guide}
              maxLength={32}
              placeholder={DEFAULT_GUIDELINE}
              onChange={(e) => setGuide(e.target.value)}
              onBlur={() => choose({ ...props.choice, guidelineVersion: cleanGuideline(guide) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') choose({ ...props.choice, guidelineVersion: cleanGuideline(guide) })
              }}
            />
          </div>
          <div className="label-field">
            <label htmlFor={`${ids}-st`}>판독 단계</label>
            <span className="select">
              <select id={`${ids}-st`} value={props.choice.readingStage} onChange={(e) => choose({ ...props.choice, readingStage: e.target.value as ReadingStage })}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'final' ? `${STAGE_SHORT[s]} (보기만)` : STAGE_SHORT[s]}
                  </option>
                ))}
              </select>
            </span>
          </div>
          {mine.length ? (
            <div className="label-set__list" role="list" aria-label="이 파일의 내 세트">
              {mine.map((s) => {
                const on = key !== null && s.guidelineVersion === key.guidelineVersion && s.readingStage === key.readingStage
                return (
                  <button
                    key={s.setId}
                    type="button"
                    role="listitem"
                    className="label-set__item"
                    aria-current={on}
                    onClick={() => choose({ guidelineVersion: s.guidelineVersion, readingStage: s.readingStage })}
                    title={`기록 ${s.recordCount} · 검토 구간 ${s.reviewIntervalCount}`}
                  >
                    {s.guidelineVersion} · {STAGE_SHORT[s.readingStage]} <span className="unit">기록 {s.recordCount} · 구간 {s.reviewIntervalCount}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
          <p className="label-panel__note">
            블라인드 기록과 설계값 대조 기록은 서로 다른 세트라 덮어쓰지 않습니다. 설계값을 보기 전에 블라인드를 제출하고 &apos;설계값 대조 시작&apos;으로 사본을 만드세요.
            확정 세트는 Level III 가 검수 화면에서만 만듭니다(여기서는 보기만). 라벨러 추가는 &apos;라벨 관리&apos; 에서 합니다.
          </p>
        </div>
      ) : null}
    </section>
  )
}
