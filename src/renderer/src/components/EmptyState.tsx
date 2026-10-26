import type { ReactNode } from 'react'
import { BigIcon } from './Icon'

/** 빈 상태: 아이콘 + 제목 + 무엇을 하면 채워지는지 한 문장 + 버튼 하나 */
export function EmptyState(props: {
  icon?: 'empty' | 'store' | 'search' | 'upload'
  title: string
  desc: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <BigIcon name={props.icon ?? 'empty'} className="empty__icon" />
      <h2 className="empty__title">{props.title}</h2>
      <p className="empty__desc">{props.desc}</p>
      {props.action ? <div className="empty__actions">{props.action}</div> : null}
    </div>
  )
}
