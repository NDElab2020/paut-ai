import type { KeyboardEvent } from 'react'

/**
 * 표·목록 키보드 이동: 위/아래 화살표, Home/End 로 행 이동(선택), Enter 로 열기, Space 로 선택.
 * 컨테이너(tbody, ul)에 onKeyDown 으로 붙이고, 각 행에는 data-row="키" 와 tabIndex(선택 행만 0) 를 준다.
 */
export function rowKeyHandler(opts: {
  onSelect: (key: string) => void
  onActivate?: (key: string) => void
}): (e: KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    const target = e.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-row]')
    if (!row || row !== target) return
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row]')]
    const i = rows.indexOf(row)
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = rows[i + 1]
    else if (e.key === 'ArrowUp') next = rows[i - 1]
    else if (e.key === 'Home') next = rows[0]
    else if (e.key === 'End') next = rows[rows.length - 1]
    else if (e.key === 'Enter' && opts.onActivate) {
      e.preventDefault()
      opts.onActivate(row.dataset.row ?? '')
      return
    } else if (e.key === ' ') {
      e.preventDefault()
      opts.onSelect(row.dataset.row ?? '')
      return
    } else return
    e.preventDefault()
    if (!next) return
    next.focus()
    opts.onSelect(next.dataset.row ?? '')
  }
}
