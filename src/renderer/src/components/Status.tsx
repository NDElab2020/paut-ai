import type { ReactNode } from 'react'
import type { StatusTone } from '../lib/format'

/** 상태 라벨: 점 모양 + 글자 (색만으로 의미 전달 금지) */
export function Status({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  return (
    <span className={`status status--${tone}`} title={title}>
      {children}
    </span>
  )
}

export function Tag({ children, strong, title }: { children: ReactNode; strong?: boolean; title?: string }) {
  return (
    <span className={strong ? 'tag tag--strong' : 'tag'} title={title}>
      {children}
    </span>
  )
}
