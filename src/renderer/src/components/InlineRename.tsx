import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/** 제목 자리에서 바로 이름 바꾸기. Enter 저장, Esc 취소 */
export function InlineRename(props: {
  value: string
  placeholder: string
  hint: string
  onSave: (name: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editing) setDraft(props.value)
  }, [props.value, editing])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const close = (): void => {
    setEditing(false)
    setError(null)
    requestAnimationFrame(() => editBtnRef.current?.focus())
  }

  const save = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) {
      setError('이름을 입력하세요.')
      return
    }
    if (name === props.value) return close()
    setSaving(true)
    try {
      await props.onSave(name)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="rename">
        <h2 className={props.value ? 'rename__title' : 'rename__title text-faint'}>{props.value || props.placeholder}</h2>
        <button ref={editBtnRef} type="button" className="btn btn--ghost" onClick={() => setEditing(true)}>
          <Icon name="edit" />
          이름 바꾸기
        </button>
      </div>
    )
  }
  return (
    <div className="field rename rename--editing">
      <div className="row">
        <label className="visually-hidden" htmlFor="rename-input">
          플랜 이름
        </label>
        <input
          id="rename-input"
          ref={inputRef}
          className="input rename__input"
          value={draft}
          maxLength={120}
          aria-invalid={error ? true : undefined}
          aria-describedby="rename-hint"
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') close()
          }}
        />
        <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => void save()}>
          저장
        </button>
        <button type="button" className="btn btn--ghost" disabled={saving} onClick={close}>
          취소
        </button>
      </div>
      {error ? <p className="field__error">{error}</p> : <p className="field__hint" id="rename-hint">{props.hint}</p>}
    </div>
  )
}
