import type { ModuleId } from '@shared/modules'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

/**
 * 흰 상단바: 워드마크 · 검색 · 주 행동(파일 가져오기) · 테마. 파란 버튼은 이것 하나.
 * 검색어는 '스캔플랜별 데이터'와 '라벨 관리'가 함께 쓴다(라벨 관리에서는 화면을 옮기지 않고 그 표를 거른다).
 * 가져오기·라벨 관리 화면에는 자기 주 버튼(확정)이 있어 상단바의 파란 버튼을 숨긴다(PAUT_DESIGN 4절: 한 화면에 하나).
 */
export function Topbar({ current, navigate }: { current: ModuleId; navigate: (id: ModuleId) => void }) {
  const { query, setQuery, searchRef, theme, setTheme, settings } = useApp()
  const noStore = settings !== null && !settings.storeRoot
  const onSearch = (v: string): void => {
    setQuery(v)
    if (v && current !== 'plans' && current !== 'specimens' && current !== 'labels') navigate('plans')
  }
  return (
    <header className="topbar">
      <span className="wordmark" aria-label="PAUT 데이터">
        <span className="wordmark__mark">PAUT</span>
        <span className="wordmark__name">데이터</span>
      </span>
      <span className="topbar__spacer" />
      <label className="search topbar__search">
        <Icon name="search" />
        <span className="visually-hidden">플랜·시편·파일 찾기</span>
        <input
          ref={searchRef}
          className="input"
          type="search"
          placeholder="플랜·시편·파일 이름으로 찾기"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
          }}
        />
        <kbd className="kbd topbar__kbd" aria-hidden="true">
          Ctrl F
        </kbd>
      </label>
      {current === 'import' || current === 'labels' ? null : (
        <button
          type="button"
          className="btn btn--primary"
          disabled={noStore}
          onClick={() => navigate('import')}
          title={noStore ? '저장소 위치를 먼저 정하세요' : '파일 가져오기 (Ctrl+I)'}
        >
          <Icon name="import" />
          파일 가져오기
        </button>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        aria-label={theme === 'dark' ? '라이트 테마로 바꾸기' : '다크 테마로 바꾸기'}
        title={theme === 'dark' ? '라이트 테마로 바꾸기' : '다크 테마로 바꾸기'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        <Icon name="theme" />
      </button>
    </header>
  )
}
