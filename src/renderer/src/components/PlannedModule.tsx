import { getModule, type ModuleId, type ModuleProps } from '@shared/modules'
import { EmptyState } from './EmptyState'

/** 등록만 되어 있고 아직 화면이 없는 모듈 (enabled: false 로 메뉴에는 숨김) */
export function PlannedModule({ id, navigate }: { id: ModuleId; navigate: ModuleProps['navigate'] }) {
  const m = getModule(id)
  return (
    <EmptyState
      title={`${m.title} 화면은 다음 단계에서 추가됩니다`}
      desc={m.description}
      action={
        <button type="button" className="btn btn--secondary" onClick={() => navigate('plans')}>
          스캔플랜별 데이터로
        </button>
      }
    />
  )
}
