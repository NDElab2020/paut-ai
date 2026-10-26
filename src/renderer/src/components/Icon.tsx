/** 로컬 인라인 SVG 선 아이콘 (16px, 선 1.5, currentColor). 아이콘 폰트·CDN 없음. design/preview.html 의 심볼과 같은 모양. */
import type { IconName } from '@shared/modules'

export type AppIconName =
  | IconName
  | 'theme'
  | 'more'
  | 'chevron-down'
  | 'chevron-left'
  | 'edit'
  | 'reveal'
  | 'plus'
  | 'label'

const PATHS: Record<AppIconName, string> = {
  import: 'M8 2v8 M5 7l3 3 3-3 M2 11v3h12v-3',
  layers: 'M8 2l6 3-6 3-6-3z M2 8l6 3 6-3 M2 11l6 3 6-3',
  specimen: 'M2 5h12v7H2z M2 8.5h12 M8 5v7',
  file: 'M4 2h5l3 3v9H4z M9 2v3h3',
  search: 'M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0z M10.5 10.5L14 14',
  history: 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z M8 5v3l2 2',
  settings: 'M2 4h12 M2 8h12 M2 12h12 M6 2.5v3 M10 6.5v3 M5 10.5v3',
  tag: 'M2 2h6l6 6-6 6-6-6z M5.5 5.5h.01',
  label: 'M2 2h6l6 6-6 6-6-6z M5.5 5.5h.01',
  folder: 'M2 4h4l1.5 1.5H14V13H2z',
  check: 'M3 8.5l3 3 7-7',
  warning: 'M8 2l6.5 11.5h-13z M8 6.5v3 M8 11.5h.01',
  error: 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z M8 5v3.5 M8 11h.01',
  'chevron-right': 'M6 3.5L10.5 8 6 12.5',
  'chevron-down': 'M3.5 6L8 10.5 12.5 6',
  'chevron-left': 'M10 3.5L5.5 8 10 12.5',
  image: 'M2 3h12v10H2z M2 11l4-4 3 3 2-2 3 3 M10.5 6h.01',
  close: 'M4 4l8 8 M12 4l-8 8',
  theme: 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z M8 2v12',
  more: 'M4 8h.01 M8 8h.01 M12 8h.01',
  edit: 'M10.5 2.5l3 3L6 13H3v-3z M9 4l3 3',
  reveal: 'M2 4h4l1.5 1.5H14V13H2z M7 9.5h4 M9.5 8l1.5 1.5L9.5 11',
  plus: 'M8 3v10 M3 8h10'
}

export function Icon({ name, className = 'icon', title }: { name: AppIconName; className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
      {name === 'theme' ? <path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" /> : null}
    </svg>
  )
}

/** 드롭존·빈 상태용 큰 아이콘 (24 viewBox) */
export function BigIcon({ name, className }: { name: 'upload' | 'empty' | 'store' | 'search'; className: string }) {
  const d = {
    upload: 'M12 15V4 M8 8l4-4 4 4 M4 14v6h16v-6',
    empty: 'M12 3l9 4.5-9 4.5-9-4.5z M3 12l9 4.5 9-4.5 M3 16.5L12 21l9-4.5',
    store: 'M3 6h6l2 2h10v11H3z M3 11h18',
    search: 'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z M15.5 15.5L21 21'
  }[name]
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
