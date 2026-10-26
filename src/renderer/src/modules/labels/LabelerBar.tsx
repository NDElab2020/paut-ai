/**
 * 지금 라벨러 고르기·추가, 2인 독립 모드, 이 PC 의 ID (세부는 접어 둔다).
 * 2인 모드는 실수 막기용이다: 모드를 끄거나 라벨러를 바꾸면 다른 사람의 라벨이 보이므로 한 번 더 묻는다.
 * 라벨러 추가에서 이미 있는 ID 면 덮지 않고 '고치기'를 따로 묻는다. 자격은 엑셀 '판독자' 시트처럼 자유 글자(제안 목록 있음).
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { LabelSession } from '@shared/api'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import { labelerText } from './format'

const QUALIFICATION_HINTS = ['UT Level II', 'UT Level III', 'PAUT Level II', 'PAUT Level III']

/** actions = 줄 오른쪽 고스트 단추 (라벨 관리 화면의 JSON 가져오기·백업 내보내기 — 다른 PC 와 합치기라 '이 PC' 옆에. 페이지 머리 단추는 둘까지, 디자인 5절) */
export function LabelerBar({ session, onChanged, actions }: { session: LabelSession; onChanged: (s: LabelSession) => void; actions?: ReactNode }) {
  const api = getApi()
  const ids = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; error: UiError } | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', qualification: 'UT Level II' })
  const [pcDraft, setPcDraft] = useState<string | null>(null)
  /** 이미 있는 ID 라 고칠지 묻는 중 */
  const [overwriteAsk, setOverwriteAsk] = useState(false)
  /** 2인 모드에서 라벨러 바꾸기·모드 끄기를 확인하는 중 */
  const [pending, setPending] = useState<{ kind: 'labeler'; labelerId: string } | { kind: 'blind-off' } | null>(null)

  const run = async (title: string, fn: () => Promise<LabelSession>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      onChanged(await fn())
      return true
    } catch (e) {
      setError({ title, error: toUiError(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const doSelect = (labelerId: string): void =>
    void run('라벨러를 고르지 못했습니다', () => unwrap(api.labels.setSession({ labelerId: labelerId === '' ? null : labelerId })))
  const select = (labelerId: string): void => {
    if (session.blindMode && labelerId !== (session.labelerId ?? '')) setPending({ kind: 'labeler', labelerId })
    else doSelect(labelerId)
  }
  const setBlind = (on: boolean): void => {
    if (!on) setPending({ kind: 'blind-off' })
    else void run('2인 모드를 바꾸지 못했습니다', () => unwrap(api.labels.setSession({ blindMode: true })))
  }

  const add = async (e: FormEvent | null, overwrite = false): Promise<void> => {
    e?.preventDefault()
    const id = form.id.trim()
    if (!overwrite && session.labelers.some((l) => l.id === id)) {
      setOverwriteAsk(true)
      return
    }
    const ok = await run('라벨러를 추가하지 못했습니다', async () => {
      const l = await unwrap(
        api.labels.registerLabeler(
          { id, name: form.name.trim() || id, qualification: form.qualification.trim() || null, organization: null },
          overwrite ? { overwrite: true } : undefined
        )
      )
      return unwrap(api.labels.setSession({ labelerId: l.id }))
    })
    if (ok) {
      setAdding(false)
      setOverwriteAsk(false)
      setForm({ id: '', name: '', qualification: 'UT Level II' })
    }
  }

  const savePc = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (pcDraft === null) return
    if (await run('PC ID 를 바꾸지 못했습니다', () => unwrap(api.labels.setSession({ pcId: pcDraft.trim() })))) setPcDraft(null)
  }

  const current = session.labeler

  return (
    <section className="panel labels-bar" aria-labelledby={`${ids}-title`}>
      <div className="labels-bar__row">
        <h2 className="labels-bar__title" id={`${ids}-title`}>
          지금 라벨러
        </h2>
        <span className="select">
          <select
            aria-labelledby={`${ids}-title`}
            value={session.labelerId ?? ''}
            disabled={busy}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">고르지 않음</option>
            {session.labelers.map((l) => (
              <option key={l.id} value={l.id}>
                {labelerText(l.id, l.name, l.qualification)}
              </option>
            ))}
            {session.labelerId && !current ? <option value={session.labelerId}>{session.labelerId} (등록 안 됨)</option> : null}
          </select>
        </span>
        <button type="button" className="btn btn--ghost" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          <Icon name="plus" />
          라벨러 추가
        </button>
        <label className="check labels-bar__blind" title="2인 독립 라벨: 다른 라벨러의 라벨 세트를 숨기고 고칠 수 없게 합니다">
          <input
            type="checkbox"
            checked={session.blindMode}
            disabled={busy}
            onChange={(e) => setBlind(e.target.checked)}
          />
          <span>2인 독립 모드</span>
        </label>
        <span className="toolbar__spacer" />
        <span className="t-caption labels-bar__pc" title="라벨을 여러 PC 에서 합칠 때 이 PC 를 가리키는 이름">
          이 PC <span className="mono">{session.pcId}</span>{' '}
          {pcDraft === null ? (
            <button type="button" className="btn btn--link" onClick={() => setPcDraft(session.pcId)}>
              바꾸기
            </button>
          ) : null}
        </span>
        {actions}
      </div>

      {session.blindMode ? (
        <p className="t-caption labels-bar__note">
          {current ? `${current.name} 의 라벨 세트만 보입니다.` : '라벨러를 고르면 그 사람의 라벨 세트만 보입니다.'} 다른 라벨러 기록은 숨기고 고칠 수
          없으며, JSON 내보내기도 지금 라벨러의 세트만 담습니다. 실수를 막는 장치이고 보안 장치는 아닙니다.
        </p>
      ) : null}

      {pending ? (
        <div className="notice notice--accent" role="alert">
          <div className="notice__body">
            <p className="notice__title">
              {pending.kind === 'blind-off'
                ? '2인 독립 모드를 끄면 다른 라벨러의 라벨 세트가 모두 보입니다. 끌까요?'
                : '라벨러를 바꾸면 그 라벨러의 라벨 세트가 보입니다. 지금 PC 앞에 있는 사람이 맞나요?'}
            </p>
            <div className="labels-form__actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy}
                onClick={() => {
                  const p = pending
                  setPending(null)
                  if (p.kind === 'blind-off') void run('2인 모드를 바꾸지 못했습니다', () => unwrap(api.labels.setSession({ blindMode: false })))
                  else doSelect(p.labelerId)
                }}
              >
                {pending.kind === 'blind-off' ? '모드 끄기' : '라벨러 바꾸기'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setPending(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {session.notices.length > 0 ? (
        <div className="notice notice--accent" role="status">
          <div className="notice__body">
            {session.notices.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
        </div>
      ) : null}

      {adding ? (
        <form className="labels-form" onSubmit={(e) => void add(e)}>
          <label className="field">
            <span className="field__label">ID</span>
            <input
              className="input"
              required
              maxLength={64}
              placeholder="kim-l2"
              value={form.id}
              onChange={(e) => {
              setForm({ ...form, id: e.target.value })
              setOverwriteAsk(false)
            }}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field__label">이름</span>
            <input className="input" placeholder="김 판독" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">자격</span>
            <input
              className="input"
              list={`${ids}-quals`}
              placeholder="UT Level II"
              value={form.qualification}
              onChange={(e) => setForm({ ...form, qualification: e.target.value })}
            />
            <datalist id={`${ids}-quals`}>
              {QUALIFICATION_HINTS.map((q) => (
                <option key={q} value={q} />
              ))}
            </datalist>
          </label>
          <div className="labels-form__actions">
            {overwriteAsk ? (
              <>
                <span className="text-accent labels-form__ask">이미 있는 라벨러입니다 ({form.id.trim()}). 이름·자격을 고칠까요?</span>
                <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void add(null, true)}>
                  고치고 고르기
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setOverwriteAsk(false)}>
                  취소
                </button>
              </>
            ) : (
              <>
                <button type="submit" className="btn btn--secondary" disabled={busy || form.id.trim() === ''}>
                  추가하고 고르기
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
                  취소
                </button>
              </>
            )}
          </div>
          <p className="t-caption labels-form__hint">ID 는 엑셀 '판독자' 시트의 라벨러 ID 와 같게 적습니다. 엑셀을 가져오면 그 라벨러는 자동으로 등록됩니다.</p>
        </form>
      ) : null}

      {pcDraft !== null ? (
        <form className="labels-form" onSubmit={(e) => void savePc(e)}>
          <label className="field">
            <span className="field__label">이 PC 의 ID</span>
            <input className="input input--mono" maxLength={32} value={pcDraft} onChange={(e) => setPcDraft(e.target.value)} autoFocus />
          </label>
          <div className="labels-form__actions">
            <button type="submit" className="btn btn--secondary" disabled={busy || pcDraft.trim() === ''}>
              PC ID 저장
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setPcDraft(null)}>
              취소
            </button>
          </div>
          <p className="t-caption labels-form__hint">
            다른 PC 와 겹치지 않는 이름으로 적습니다(글자·숫자·'.'·'_'·'-', 32자까지). 이 저장소에 다른 PC 이름으로 이미 나오는 ID 는 받지 않습니다. 버전 칸 {session.versionSlot}
          </p>
        </form>
      ) : null}

      {error ? <ErrorNotice title={error.title} error={error.error} /> : null}
    </section>
  )
}
