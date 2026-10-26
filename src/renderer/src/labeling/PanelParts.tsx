/**
 * 라벨 패널 작은 부품 (288 px 열 안): 묶음 머리·키값 줄·고르기 칸·읽기값·문제 목록·한 줄 버튼 묶음.
 * 글자는 표 13 px·캡션 12 px (PAUT_DESIGN.md 3절), 파란 버튼은 패널에 하나(저장)만 — 여기 부품은 파랑을 쓰지 않는다.
 */
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { num } from '../lib/format'
import type { PointReading } from './reading'

export function Section(props: { title: ReactNode; aside?: ReactNode; children?: ReactNode; label?: string }) {
  return (
    <section className="label-panel__section" aria-label={props.label ?? (typeof props.title === 'string' ? props.title : undefined)}>
      <div className="label-panel__headrow">
        <h3 className="label-panel__heading">{props.title}</h3>
        {props.aside ? <span className="label-panel__aside">{props.aside}</span> : null}
      </div>
      {props.children}
    </section>
  )
}

/** dl 안의 키값 한 줄 */
export function Row(props: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="label-panel__row" title={props.title}>
      <dt>{props.label}</dt>
      <dd className="num">{props.children}</dd>
    </div>
  )
}

/** 고르기 칸 (라벨 + select). allowEmpty 면 맨 앞 '—' = null */
export function SelectField<T extends string>(props: {
  label: string
  value: T | null
  options: ReadonlyArray<{ id: T; name: string }>
  onChange: (v: T | null) => void
  allowEmpty?: string
  disabled?: boolean
  title?: string
}) {
  const id = useId()
  return (
    <div className="label-field" title={props.title}>
      <label htmlFor={id}>{props.label}</label>
      <span className="select">
        <select id={id} value={props.value ?? ''} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value === '' ? null : (e.target.value as T))}>
          {props.allowEmpty !== undefined ? <option value="">{props.allowEmpty}</option> : null}
          {props.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </span>
    </div>
  )
}

/** 예 / 아니오 / 모름 (null) */
export function TriField(props: { label: string; value: boolean | null; onChange: (v: boolean | null) => void; title?: string }) {
  return (
    <SelectField<'yes' | 'no'>
      label={props.label}
      title={props.title}
      value={props.value === null ? null : props.value ? 'yes' : 'no'}
      allowEmpty="모름"
      options={[
        { id: 'yes', name: '예' },
        { id: 'no', name: '아니오' }
      ]}
      onChange={(v) => props.onChange(v === null ? null : v === 'yes')}
    />
  )
}

/** 숫자 입력 칸 (mm). 비우면 null */
export function NumberField(props: { label: string; value: number | null; onChange: (v: number | null) => void; unit?: string; step?: number; title?: string }) {
  const id = useId()
  return (
    <div className="label-field" title={props.title}>
      <label htmlFor={id}>{props.label}</label>
      <span className="label-field__num">
        <input
          id={id}
          className="input input--num"
          type="number"
          step={props.step ?? 0.1}
          value={props.value === null ? '' : String(props.value)}
          onChange={(e) => {
            const v = e.target.value.trim()
            const n = Number(v)
            props.onChange(v === '' || !Number.isFinite(n) ? null : n)
          }}
        />
        {props.unit ? <span className="unit">{props.unit}</span> : null}
      </span>
    </div>
  )
}

/** 숫자 입력 (글자로 들고 있다가 Enter·포커스 이동 때 한 번 반영 — 칠 때마다 되돌리기 이력이 쌓이지 않게) */
function CommitNumber(props: { id?: string; label: string; value: number | null; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = (): void => {
    if (text === null) return
    const n = Number(text.trim())
    if (text.trim() !== '' && Number.isFinite(n)) props.onCommit(n)
    setText(null)
  }
  return (
    <input
      id={props.id}
      aria-label={props.label}
      className="input input--num"
      type="number"
      step={0.1}
      value={text ?? (props.value === null ? '' : String(props.value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setText(null)
      }}
    />
  )
}

/** 스캔 구간 한 줄: 라벨 [시작] – [끝] mm (Enter·포커스 이동 때 반영) */
export function RangeField(props: { label: string; start: number | null; end: number | null; onStart: (v: number) => void; onEnd: (v: number) => void; unit?: string }) {
  const id = useId()
  return (
    <div className="label-field">
      <label htmlFor={id}>{props.label}</label>
      <span className="label-field__num">
        <CommitNumber id={id} label={`${props.label} 시작`} value={props.start} onCommit={props.onStart} />
        <span aria-hidden="true">–</span>
        <CommitNumber label={`${props.label} 끝`} value={props.end} onCommit={props.onEnd} />
        <span className="unit">{props.unit ?? 'mm'}</span>
      </span>
    </div>
  )
}

/** 마우스로 누른 뒤 키보드 위치를 영상(뷰어 본체)으로 돌려준다 — 패널 라디오에 포커스가 남아 ←/→·R·N 이 영상에 가지 않는 일을 막는다 */
export function focusViewer(from: Element | null): void {
  const root = from?.closest<HTMLElement>('.viewer')
  root?.focus({ preventScroll: true })
}

/**
 * 한 줄 버튼 묶음 (라디오) — 뷰어 .seg 와 같은 모양. 화살표 키는 영상(스캔·빔 이동)으로 넘기지 않는다.
 * returnFocus: 마우스로 누르면(키보드 Enter·Space 가 아니면) 포커스를 영상으로 돌려준다 (라벨 도구·작업 고르기).
 */
export function MiniSeg<T extends string>(props: {
  label: string
  value: T | null
  options: ReadonlyArray<{ id: T; name: string; title?: string }>
  onChange: (v: T) => void
  className?: string
  returnFocus?: boolean
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    const n = props.options.length
    const i = Math.max(0, props.options.findIndex((o) => o.id === props.value))
    const j = (i + d + n) % n
    props.onChange(props.options[j]!.id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[j]?.focus()
  }
  return (
    <div className={`seg label-seg ${props.className ?? ''}`} role="radiogroup" aria-label={props.label} onKeyDown={onKeyDown}>
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={props.value === o.id}
          tabIndex={props.value === o.id || (props.value === null && o === props.options[0]) ? 0 : -1}
          className="seg__item"
          title={o.title}
          onClick={(e) => {
            props.onChange(o.id)
            // 마우스 누름(detail > 0)만 — 키보드로 고를 때는 그 자리에 둔다
            if (props.returnFocus && e.detail > 0) focusViewer(e.currentTarget)
          }}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

/** 읽기값 (파일 이득 0 dB): 진폭 · V·실제 깊이·레그 · 펼친 깊이 · 빔·각도 */
export function ReadingRows({ r }: { r: PointReading | null }) {
  if (!r) return <p className="label-panel__empty">—</p>
  return (
    <dl className="label-panel__list">
      <Row label="진폭">
        {r.amplitudePct === null ? '데이터 없음' : `${num(r.amplitudePct)} %FSH`}
        {r.saturated ? ' · 포화' : ''}
      </Row>
      <Row label="V · 깊이">
        {num(r.vMm, 2)} · {num(r.depthMm, 2)} mm{r.leg ? ` · 레그 ${r.leg}` : ''}
      </Row>
      <Row label="펼친 깊이">{num(r.unfoldedDepthMm, 2)} mm</Row>
      <Row label="빔 · 각도">
        {num(r.beam + 1, 2)} · {num(r.angleDeg)}°
      </Row>
    </dl>
  )
}

/** 저장을 막는 문제(빨강 점·글자)와 볼 것(파랑 빈 원) — 색만이 아니라 글자로 */
export function Problems(props: { problems: readonly string[]; warnings?: readonly string[] }) {
  if (!props.problems.length && !props.warnings?.length) return null
  return (
    <ul className="label-problems">
      {props.problems.map((p, i) => (
        <li key={`p${i}`} className="status status--error">
          {p}
        </li>
      ))}
      {(props.warnings ?? []).map((w, i) => (
        <li key={`w${i}`} className="status status--attention">
          {w}
        </li>
      ))}
    </ul>
  )
}

/** 안에서 화살표·Enter 를 쓰는 표: 처리한 키는 영상 키(스캔·빔 이동)로 넘기지 않는다 */
export function stopIfHandled(handler: (e: KeyboardEvent<HTMLElement>) => void): (e: KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    handler(e)
    if (e.defaultPrevented) e.stopPropagation()
  }
}
