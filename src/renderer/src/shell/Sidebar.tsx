import { useMemo } from 'react'
import { MODULE_SECTIONS, getModule, sortedModules, type ModuleDefinition, type ModuleId, type ModuleSection } from '@shared/modules'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

/** 왼쪽 기능 메뉴: shared/modules.ts 에 등록된 모듈을 구역별로. 새 기능은 등록만 하면 여기 나온다 */
export function Sidebar({ current, navigate }: { current: ModuleId; navigate: (id: ModuleId) => void }) {
  const { totals, settings, info } = useApp()
  const sections = useMemo(() => {
    const map = new Map<ModuleSection, ModuleDefinition[]>()
    for (const s of Object.keys(MODULE_SECTIONS) as ModuleSection[]) map.set(s, [])
    for (const m of sortedModules()) map.get(m.section)?.push(m)
    return [...map.entries()].sort((a, b) => MODULE_SECTIONS[a[0]].order - MODULE_SECTIONS[b[0]].order)
  }, [])
  const countOf = (id: ModuleId): number | null => (id === 'plans' && totals ? totals.plans : null)
  const shownCurrent = getModule(current).parent ?? current

  return (
    <nav className="sidebar" aria-label="기능 메뉴">
      {sections.map(([section, mods]) => (
        <div className="sidebar__group" key={section}>
          <span className="sidebar__label">{MODULE_SECTIONS[section].title}</span>
          {mods.map((m) => (
            <button
              key={m.id}
              type="button"
              className="nav-item"
              aria-current={shownCurrent === m.id ? 'page' : undefined}
              title={m.description}
              onClick={() => navigate(m.id)}
            >
              <Icon name={m.icon} />
              {m.title}
              {countOf(m.id) !== null ? <span className="nav-item__count">{countOf(m.id)}</span> : null}
            </button>
          ))}
          {mods.length === 0 ? (
            <span className="nav-item" aria-disabled="true" title="라벨링 등 관리 기능이 이 자리에 추가됩니다">
              <Icon name="plus" />
              기능 추가 예정
              <span className="nav-item__count">준비 중</span>
            </span>
          ) : null}
        </div>
      ))}
      <div className="sidebar__footer">
        <div className="truncate mono" title={settings?.storeRoot ?? undefined}>
          {settings?.storeRoot ?? '저장소 미설정'}
        </div>
        <div>버전 {info?.version ?? '—'}</div>
      </div>
    </nav>
  )
}
