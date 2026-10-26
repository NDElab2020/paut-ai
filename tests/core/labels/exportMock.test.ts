/**
 * 브라우저 mock 의 학습 데이터 API (dev:web 화면 확인용) 가 실제 서비스와 같은 계약·오류 코드를 지키는지.
 * 분할·잠금(확인·이유) · 세트 고르기 · 내보내기 진행률 · 취소 · 동시 실행 BUSY.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRAINING_SET_RULE, type TrainingExportRequest } from '@shared/api'
import type { ApiResult } from '@shared/errors'
import { createMockApi } from '../../../src/renderer/src/api/mock'

async function data<T>(p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.data
}
async function code(p: Promise<ApiResult<unknown>>): Promise<string> {
  const r = await p
  return r.ok ? 'OK' : r.code
}

describe('브라우저 mock 학습 데이터 API', () => {
  it('분할 · 시험 세트 잠금', async () => {
    const api = createMockApi()
    const v0 = await data(api.labels.trainingSplits())
    expect(v0.specimens.length).toBe(5)
    expect(v0.counts.unassigned).toBe(5)
    await data(api.labels.setTrainingSplits([{ specimenId: 'PL23833', split: 'train' }, { specimenId: 'pl23840', split: 'test' }]))
    const v1 = await data(api.labels.lockTrainingTest(true))
    expect(v1.testLocked).toBe(true)
    expect(v1.specimens.find((r) => r.specimenId === 'PL23840')!.split).toBe('test')
    expect(await code(api.labels.setTrainingSplits([{ specimenId: 'PL23840', split: 'val' }]))).toBe('CONFLICT')
    const v2 = await data(api.labels.setTrainingSplits([{ specimenId: 'PL23840', split: 'val' }], { confirmLocked: true, reason: '교체' }))
    expect(v2.log[0]).toMatchObject({ action: 'locked-change', reason: '교체', from: 'test', to: 'val' })
    expect(await code(api.labels.lockTrainingTest(false))).toBe('CONFLICT')
    expect((await data(api.labels.lockTrainingTest(false, { confirmLocked: true, reason: '다시' }))).testLocked).toBe(false)
  }, 20_000)

  it('세트 고르기 · 내보내기 · 진행률 · 취소 · BUSY', async () => {
    const api = createMockApi()
    const c0 = await data(api.labels.trainingCandidates(DEFAULT_TRAINING_SET_RULE))
    expect(c0.files).toHaveLength(2)
    expect(c0.files.every((f) => f.chosen === null)).toBe(true) // 블라인드 라벨러를 지정하지 않음
    const rule = { ...DEFAULT_TRAINING_SET_RULE, blindLabelerId: 'kim-l2' }
    const c1 = await data(api.labels.trainingCandidates(rule))
    expect(c1.files.every((f) => f.chosen?.includes('|kim-l2|'))).toBe(true)
    expect(await data(api.labels.chooseTrainingDir())).toBe('D:/PAUT/학습데이터')
    const req: TrainingExportRequest = { splits: ['unassigned'], setRule: rule, options: { amplitude: true, images: true, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep' } }
    expect(await code(api.labels.exportTraining({ ...req, splits: [] }, 'D:/x'))).toBe('INVALID_ARGUMENT')
    const p = api.labels.exportTraining(req, 'D:/x')
    await new Promise((r) => setTimeout(r, 150))
    expect(await code(api.labels.exportTraining(req, 'D:/x'))).toBe('BUSY')
    const st = await data(api.labels.trainingStatus())
    expect(st?.operationId).toMatch(/^TX-mock-/)
    expect(await data(api.labels.cancelTraining(st!.operationId))).toBe(true)
    expect(await code(p)).toBe('CANCELLED')
    expect(await data(api.labels.trainingStatus())).toBeNull()
    const r = await data(api.labels.exportTraining({ ...req, options: { ...req.options, images: false } }, 'D:/x'))
    expect(r.totals).toMatchObject({ files: 2, exported: 2 })
    expect(r.path.startsWith('D:/x/학습데이터_')).toBe(true)
  }, 20_000)
})
