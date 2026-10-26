/**
 * 브라우저 mock 의 OPD 흐름 (dev:web 화면 확인용 데이터가 core 와 같은 모양인지).
 * 'PCN'·'OPD' 가 들어간 폴더 이름 = OPD 데모 폴더, 그 밖의 폴더 = 기존 데모(+ 잘린 OPD 1개).
 */
import { describe, expect, it } from 'vitest'
import { createMockApi } from '../../src/renderer/src/api/mock'
import { isOpdMeta, isOpdSpec } from '@shared/types'

describe('mock OPD', () => {
  it('OPD 데모 폴더 → 새 OPD 플랜 1개·이름 경고·해석 실패 → 확정 → 다시 분석하면 중복', async () => {
    const api = createMockApi()
    const pv = await api.import.analyze(['D:/데이터/PCN교육'])
    if (!pv.ok) throw new Error(pv.message)
    const p = pv.data
    expect(p.items.map((i) => [i.fileName, i.verdict])).toEqual([
      ['TP14-ROOT-L-01.opd', 'new-plan'],
      ['TP14-ROOT-L-02.opd', 'new-plan'],
      ['TP14-ROOT-L-03.opd', 'new-plan'],
      ['TP14-cut.opd', 'error']
    ])
    expect(p.items[3]!.errorMessage).toMatch(/^보류\(해석 실패\): /)
    expect(p.items[2]!.warnings[0]).toContain('장비 저장 이름')
    expect(p.items.slice(0, 3).every((i) => isOpdMeta(i.meta) && i.suggestedSpecimenId === 'TP14')).toBe(true)
    expect(p.newPlans).toHaveLength(1)
    expect(p.newPlans[0]).toMatchObject({ key: 'opd1', provisionalPlanId: 'SP003', suggestedName: '25T · 5MHz · SK90 · 집속 25 · V개선 23+2 · OPD' })
    expect(isOpdSpec(p.newPlans[0]!.spec)).toBe(true)

    const res = await api.import.commit({
      previewId: p.previewId,
      newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
      items: p.items.map((i) => ({
        itemId: i.itemId,
        include: true,
        specimenId: i.suggestedSpecimenId ?? 'X',
        specimenSource: i.suggestedSpecimenSource ?? 'manual',
        stateTag: null,
        round: null,
        memo: ''
      }))
    })
    expect(res.ok && res.data.createdPlanIds).toEqual(['SP003'])
    expect(res.ok && res.data.copiedCount).toBe(3)
    const files = await api.files.list({ planId: 'SP003' })
    expect(files.ok && files.data.items.every((f) => f.meta.ndeVersion.family === 'opd')).toBe(true)

    const again = await api.import.analyze(['D:/데이터/PCN교육'])
    expect(again.ok && again.data.items.slice(0, 3).map((i) => i.verdict)).toEqual(['duplicate', 'duplicate', 'duplicate'])
  }, 20_000)

  it('이미지 보기 mock: OPD 파일은 OPD 모양 정보(대조 전·추정 눈금·문턱·Ref 모름·내장 색표·엔코더 동기·형상 추정·막힘), NDE 는 그대로', async () => {
    const api = createMockApi()
    const pv = await api.import.analyze(['D:/데이터/PCN교육'])
    if (!pv.ok) throw new Error(pv.message)
    const p = pv.data
    await api.import.commit({
      previewId: p.previewId,
      newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
      items: p.items.filter((i) => i.verdict === 'new-plan').map((i) => ({ itemId: i.itemId, include: true, specimenId: 'TP14', specimenSource: 'manual', stateTag: null, round: null, memo: '' }))
    })
    const list = await api.files.list({ limit: 100 })
    if (!list.ok) throw new Error(list.message)
    const opd = list.data.items.find((f) => isOpdMeta(f.meta))!
    const nde = list.data.items.find((f) => !isOpdMeta(f.meta))!
    const o = await api.viewer.open(opd.id)
    if (!o.ok) throw new Error(o.message)
    const g = o.data.info.groups[0]!
    expect(o.data.info).toMatchObject({ formatFamily: 'opd', reader: { name: 'opd-structure', version: 4 }, scanSync: 'encoder', display: { paletteSource: 'default', cscanReversed: true } })
    expect(g).toMatchObject({ verified: false, ampScale: { unitMax: 250, estimated: true }, referenceGainDb: null, amplitudeSource: { kind: 'opd-raster' } })
    expect(g.gates.map((x) => x.thresholdPct)).toEqual([20, 10, 30])
    expect(g.blockReason).toMatch(/^OPD 파일이라 자동 변환·학습 내보내기를 막습니다: OmniPC 대조 전\(OPD 섹토리얼 · 스큐 90\)/)
    const c = await api.viewer.chunk(opd.id, o.data.key, 0, 0, 4)
    expect(c.ok && c.data.amplitude).toBeInstanceOf(Int16Array)
    const n = await api.viewer.open(nde.id)
    expect(n.ok && n.data.info.formatFamily).toBe('3.x')
    expect(n.ok && n.data.info.groups.every((x) => x.blockReason === undefined && x.ampScale.estimated === undefined)).toBe(true)
  }, 20_000)

  it('기존 데모 폴더: .oud 는 보류, 잘린 .opd 는 해석 실패, 새 플랜은 그대로 1개', async () => {
    const api = createMockApi()
    const pv = await api.import.analyze(['D:/데이터/폴더'])
    if (!pv.ok) throw new Error(pv.message)
    expect(pv.data.items.find((i) => i.fileName === 'old_scan.oud')?.verdict).toBe('unsupported')
    expect(pv.data.items.find((i) => i.fileName === 'TP14-cut.opd')?.verdict).toBe('error')
    expect(pv.data.newPlans.map((n) => n.key)).toEqual(['n1'])
  }, 20_000)
})
