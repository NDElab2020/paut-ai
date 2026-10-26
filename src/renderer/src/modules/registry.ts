/** 모듈 id → 렌더러 컴포넌트 lazy 로더. 새 모듈은 shared/modules.ts 와 여기 한 줄을 함께 추가한다. */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { ModuleId, ModuleProps } from '@shared/modules'

type Loader = () => Promise<{ default: ComponentType<ModuleProps> }>

export const MODULE_LOADERS: Record<ModuleId, Loader> = {
  import: () => import('./import'),
  plans: () => import('./plans'),
  specimens: () => import('./specimens'),
  files: () => import('./files'),
  history: () => import('./history'),
  settings: () => import('./settings'),
  viewer: () => import('./viewer'),
  labels: () => import('./labels')
}

const cache = new Map<ModuleId, LazyExoticComponent<ComponentType<ModuleProps>>>()

export function getModuleComponent(id: ModuleId): LazyExoticComponent<ComponentType<ModuleProps>> {
  let c = cache.get(id)
  if (!c) {
    c = lazy(MODULE_LOADERS[id])
    cache.set(id, c)
  }
  return c
}
