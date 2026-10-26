import { AppError } from '@shared/errors'
import type { ProgressEvent, ProgressOperation, ProgressPhase } from '@shared/types'
import type { Catalog } from '../catalog'

export interface ImportContext {
  catalog: Catalog
  storeRoot: string
  onProgress?: (ev: ProgressEvent) => void
  signal?: AbortSignal
  /** 테스트용 시계 */
  now?: () => Date
  /**
   * 진행률·취소에 쓰는 작업 ID. analyze = previewId, commit = batchId.
   * 호출 쪽이 미리 정해 두면 작업 도중에도 그 ID 로 취소할 수 있다. 없으면 새로 만든다.
   */
  operationId?: string
  /** 새 플랜 이름 규칙: {name} 짧은 이름, {summary} 요약, {id} 예정 ID */
  newPlanNameTemplate?: string
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError('CANCELLED', '작업이 취소되었습니다.')
}

export function isCancelled(err: unknown): boolean {
  return err instanceof AppError && err.code === 'CANCELLED'
}

/** 이벤트 루프에 한 번 양보 (긴 반복이 main 프로세스를 붙잡지 않게) */
export const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

export type Emit = (phase: ProgressPhase, current: number, total: number, extra?: Partial<ProgressEvent>) => void

export function makeEmitter(ctx: ImportContext, operation: ProgressOperation, operationId: string): Emit {
  return (phase, current, total, extra = {}) => {
    if (!ctx.onProgress) return
    try {
      ctx.onProgress({ operation, operationId, phase, current, total, ...extra })
    } catch {
      // 진행률 구독자의 오류가 작업을 멈추지 않게
    }
  }
}
