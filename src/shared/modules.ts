/**
 * 관리 기능 모듈 등록 규약.
 *
 * 새 기능 추가 절차 (3단계):
 *  1. 아래 MODULE_IDS 에 id 추가 + MODULES 에 정의 추가 (제목·아이콘·순서·구역).
 *  2. src/renderer/src/modules/<id>/index.tsx 에 `export default function Module(props: ModuleProps)` 작성.
 *  3. src/renderer/src/modules/registry.ts 의 MODULE_LOADERS 에 `<id>: () => import('./<id>')` 한 줄 추가.
 *     (Record<ModuleId, ...> 타입이라 빠뜨리면 typecheck 가 실패한다)
 *  필요한 main 기능은 shared/api.ts 의 IpcContract 에 채널을 추가하고 main/ipc 핸들러를 구현한다.
 */

export const MODULE_IDS = ['import', 'plans', 'specimens', 'files', 'history', 'settings', 'viewer', 'labels'] as const
export type ModuleId = (typeof MODULE_IDS)[number]

/** 사이드바 구역. 'labeling' = 결함 라벨 기능 (라벨 관리, 이후 라벨 모드) */
export type ModuleSection = 'data' | 'labeling' | 'system'

export const MODULE_SECTIONS: Readonly<Record<ModuleSection, { title: string; order: number }>> = {
  data: { title: '데이터 관리', order: 10 },
  labeling: { title: '라벨링', order: 20 },
  system: { title: '시스템', order: 90 }
}

/** 렌더러 Icon 컴포넌트가 지원하는 아이콘 이름 (로컬 인라인 SVG, 외부 아이콘 폰트 금지) */
export type IconName =
  | 'import'
  | 'layers'
  | 'specimen'
  | 'file'
  | 'search'
  | 'history'
  | 'settings'
  | 'tag'
  | 'folder'
  | 'check'
  | 'warning'
  | 'error'
  | 'chevron-right'
  | 'close'
  | 'image'

export interface ModuleDefinition {
  id: ModuleId
  /** 사이드바·헤더 제목 (한국어) */
  title: string
  /** 한 줄 설명 (빈 화면·툴팁) */
  description: string
  icon: IconName
  section: ModuleSection
  /** 구역 안 정렬 (작을수록 위) */
  order: number
  /** false 면 숨김 (개발 중 기능) */
  enabled: boolean
  /** 렌더러 컴포넌트 위치 (문서용; 실제 로딩은 renderer/modules/registry.ts) */
  componentPath: string
  /** 메뉴에 없이 다른 화면에서 들어가는 화면이면, 사이드바에서 대신 표시할 부모 메뉴 */
  parent?: ModuleId
  /** true 면 이 화면에 있는 동안 사이드바를 접는다 (넓은 영상 화면) */
  wide?: boolean
}

export const MODULES: readonly ModuleDefinition[] = [
  {
    id: 'import',
    title: '가져오기',
    description: 'NDE·OPD 파일·폴더를 넣으면 스캔플랜별로 정리합니다.',
    icon: 'import',
    section: 'data',
    order: 10,
    enabled: true,
    componentPath: 'src/renderer/src/modules/import'
  },
  {
    id: 'plans',
    title: '스캔플랜별 데이터',
    description: '스캔플랜 목록과 플랜별 셋업·시편·파일을 봅니다.',
    icon: 'layers',
    section: 'data',
    order: 20,
    enabled: true,
    componentPath: 'src/renderer/src/modules/plans'
  },
  {
    id: 'specimens',
    title: '시편',
    description: '시편별로 스캔 파일과 상태 태그를 관리합니다.',
    icon: 'specimen',
    section: 'data',
    order: 30,
    enabled: true,
    componentPath: 'src/renderer/src/modules/specimens'
  },
  {
    id: 'files',
    title: '파일 검색',
    description: '파일명·시편·태그·메모로 파일을 찾습니다.',
    icon: 'search',
    section: 'data',
    order: 40,
    // 1차: 검색은 상단바 검색창 → '스캔플랜별 데이터' 필터로 처리. 독립 화면은 다음 단계
    enabled: false,
    componentPath: 'src/renderer/src/modules/files'
  },
  {
    id: 'history',
    title: '가져오기 이력',
    description: '언제 무엇을 가져왔는지 기록을 봅니다.',
    icon: 'history',
    section: 'data',
    order: 50,
    enabled: true,
    componentPath: 'src/renderer/src/modules/history'
  },
  {
    id: 'settings',
    title: '설정',
    description: '저장소 위치와 화면 설정을 바꿉니다.',
    icon: 'settings',
    section: 'system',
    order: 90,
    enabled: true,
    componentPath: 'src/renderer/src/modules/settings'
  },
  {
    id: 'viewer',
    title: '이미지 보기',
    description: 'NDE·OPD 파일을 OmniPC 처럼 S·C·A-scan 으로 봅니다.',
    icon: 'image',
    section: 'data',
    order: 25,
    // 메뉴에는 없고 '스캔플랜별 데이터' 파일 상세의 '이미지로 보기'로 들어온다
    enabled: false,
    componentPath: 'src/renderer/src/modules/viewer',
    parent: 'plans',
    wide: true
  },
  {
    id: 'labels',
    title: '라벨 관리',
    description: '전문가 엑셀·다른 PC 의 라벨을 합치고 파일별 라벨 현황을 봅니다.',
    icon: 'tag',
    section: 'labeling',
    order: 10,
    enabled: true,
    componentPath: 'src/renderer/src/modules/labels'
  }
]

/** 모듈 안 화면 이동 정보. params 예: { planId: 'SP001' }, { specimenId: 'PL23833' } */
export interface ModuleRoute {
  moduleId: ModuleId
  params: Readonly<Record<string, string>>
}

/** 모든 모듈 컴포넌트가 받는 props */
export interface ModuleProps {
  route: ModuleRoute
  navigate: (moduleId: ModuleId, params?: Record<string, string>) => void
}

export const DEFAULT_MODULE: ModuleId = 'plans'

export function sortedModules(mods: readonly ModuleDefinition[] = MODULES): ModuleDefinition[] {
  return mods
    .filter((m) => m.enabled)
    .slice()
    .sort((a, b) => MODULE_SECTIONS[a.section].order - MODULE_SECTIONS[b.section].order || a.order - b.order)
}

export function getModule(id: ModuleId): ModuleDefinition {
  const m = MODULES.find((x) => x.id === id)
  if (!m) throw new Error(`unknown module: ${id}`)
  return m
}
