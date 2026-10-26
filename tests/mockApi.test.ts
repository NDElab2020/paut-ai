import { describe, expect, it } from 'vitest'
import { createMockApi } from '../src/renderer/src/api/mock'

describe('브라우저 mock API', () => {
  it('X3 유사 데이터: SP001 · 시편 4개', async () => {
    const api = createMockApi()
    const plans = await api.plans.list()
    expect(plans.ok && plans.data.find((p) => p.id === 'SP001')?.specimenCount).toBe(4)
    const specs = await api.specimens.list('SP001')
    expect(specs.ok && specs.data.map((s) => s.id)).toEqual(['PL23831', 'PL23833', 'PL23840', 'PL23841'])
  })

  it('?mock=many: 플랜 9개, 파일·시편 수는 파일 목록과 맞는다', async () => {
    const api = createMockApi('many')
    const plans = await api.plans.list()
    expect(plans.ok && plans.data.map((p) => p.id)).toEqual(['SP001', 'SP002', 'SP003', 'SP004', 'SP005', 'SP006', 'SP007', 'SP008', 'SP009'])
    if (!plans.ok) return
    for (const p of plans.data) {
      const files = await api.files.list({ planId: p.id })
      expect(files.ok && files.data.total, p.id).toBe(p.fileCount)
      expect(p.fileCount, p.id).toBeGreaterThan(0)
    }
    const history = await api.import.history()
    expect(history.ok && history.data[0]?.createdPlanIds).toHaveLength(8)
  })

  it('가져오기 분석 → 확정', async () => {
    const api = createMockApi()
    const events: string[] = []
    const off = api.onProgress((e) => events.push(e.phase))
    const pv = await api.import.analyze(['D:/데이터/폴더'])
    expect(pv.ok).toBe(true)
    if (!pv.ok) return
    expect(pv.data.counts['match-existing']).toBeGreaterThan(0)
    expect(pv.data.counts['new-plan']).toBe(1)
    expect(pv.data.counts.unsupported).toBe(1)
    const res = await api.import.commit({
      previewId: pv.data.previewId,
      newPlans: pv.data.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
      items: pv.data.items.map((i) => ({
        itemId: i.itemId,
        include: true,
        specimenId: i.suggestedSpecimenId ?? 'X',
        specimenSource: i.suggestedSpecimenSource ?? 'manual',
        stateTag: i.suggestedStateTag,
        round: null,
        memo: ''
      }))
    })
    off()
    expect(res.ok && res.data.createdPlanIds).toEqual(['SP003'])
    expect(events).toContain('done')
  }, 20_000)
})
