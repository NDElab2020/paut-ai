/**
 * 라벨 패널 열 (영상 오른쪽, 라벨 모드에서만). 머리 = 제목·도구(점·사각형·길이·검토 구간)·접기, 몸 = LabelPanel (세트·새 기록·검토 구간·지시 표·형상 에코·단축키).
 * 접으면 40 px 띠에 펼치기와 도구 네 개만 남아 1280×800 에서도 영상이 줄지 않게 한다(패널 몸은 숨겨 두어 상태·덮개가 그대로). 도구는 키 1~4 로도 고른다.
 */
import type { KeyboardEvent, ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { focusViewer } from './PanelParts'
import { LABEL_TOOLS, type LabelTool } from './state'

function ToolSeg(props: { value: LabelTool; onChange: (t: LabelTool) => void; vertical?: boolean }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    // 영상 키(스캔·빔 이동)로 넘기지 않는다
    e.preventDefault()
    e.stopPropagation()
    const n = LABEL_TOOLS.length
    const i = Math.max(0, LABEL_TOOLS.findIndex((t) => t.id === props.value))
    const j = (i + d + n) % n
    props.onChange(LABEL_TOOLS[j]!.id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[j]?.focus()
  }
  return (
    <div className={props.vertical ? 'label-side__mini' : 'seg'} role="radiogroup" aria-label="라벨 도구" onKeyDown={onKeyDown}>
      {LABEL_TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={props.value === t.id}
          tabIndex={props.value === t.id ? 0 : -1}
          className="seg__item"
          title={t.title}
          onClick={(e) => {
            props.onChange(t.id)
            // 마우스로 고르면 키보드 위치를 영상으로 (←/→ 가 도구를 바꾸지 않고 스캔을 옮기게)
            if (e.detail > 0) focusViewer(e.currentTarget)
          }}
        >
          {props.vertical ? t.short : t.name}
        </button>
      ))}
    </div>
  )
}

export function LabelSide(props: { open: boolean; onOpen: (open: boolean) => void; tool: LabelTool; onTool: (t: LabelTool) => void; children: ReactNode }) {
  const { open } = props
  // 접어도 패널 몸(children)은 같은 자리에 숨겨 둔다 — 세트·기록 덮개·작업 이벤트(쉼 재기)가 끊기지 않게 (key 로 같은 요소를 유지)
  return (
    <aside className={open ? 'label-side' : 'label-side label-side--collapsed'} aria-label={open ? '라벨 패널' : '라벨 패널 (접힘)'}>
      {open ? (
        <div key="head" className="label-side__head">
          <h2 className="label-side__title">라벨</h2>
          <span className="toolbar__spacer" />
          <button type="button" className="btn btn--ghost btn--icon" aria-label="라벨 패널 접기" title="라벨 패널 접기 (영상을 넓게)" onClick={() => props.onOpen(false)}>
            <Icon name="chevron-right" />
          </button>
        </div>
      ) : (
        <button key="expand" type="button" className="btn btn--ghost btn--icon" aria-label="라벨 패널 펼치기" title="라벨 패널 펼치기" onClick={() => props.onOpen(true)}>
          <Icon name="chevron-left" />
        </button>
      )}
      {open ? (
        <div key="tools" className="label-side__tools">
          <ToolSeg value={props.tool} onChange={props.onTool} />
        </div>
      ) : (
        <ToolSeg key="mini" value={props.tool} onChange={props.onTool} vertical />
      )}
      <div key="body" className="label-side__body" hidden={!open}>
        {props.children}
      </div>
    </aside>
  )
}
