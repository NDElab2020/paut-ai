/**
 * 브라우저 mock 의 라벨 API 가 실제 서비스와 같은 계약을 지키는지 (메모리 저장).
 * 같은 흐름: 세션 → 엑셀 미리보기·확정 → 현황 → 기록 → JSON 내보내기·가져오기 → 충돌 해결 → 2인 모드 → 오류 코드.
 */
import { describe, expect, it } from 'vitest'
import { API_CHANNEL_MAP, type PautApi } from '@shared/api'
import type { ApiResult } from '@shared/errors'
import type { IndicationRecord } from '@shared/labels/types'
import { createMockApi } from '../src/renderer/src/api/mock'

async function data<T>(p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.data
}

async function code(p: Promise<ApiResult<unknown>>): Promise<string> {
  const r = await p
  return r.ok ? 'OK' : r.code
}

describe('브라우저 mock 라벨 API', () => {
  it('API 대응표의 모든 라벨 메서드가 있다', () => {
    const api = createMockApi()
    for (const k of Object.keys(API_CHANNEL_MAP.labels)) {
      expect(typeof (api.labels as Record<string, unknown>)[k], k).toBe('function')
    }
  })

  it('데모 데이터: 라벨러 1명, 파일 2개에 라벨, 충돌 1건', async () => {
    const api = createMockApi()
    const s = await data(api.labels.session())
    expect(s).toMatchObject({ pcId: 'pc-mock01', labelerId: 'kim-l2', blindMode: false })
    const ov = await data(api.labels.overview())
    expect(ov.files).toHaveLength(5)
    expect(ov.files.filter((f) => f.sets.length > 0)).toHaveLength(2)
    expect(ov.pendingConflicts).toBe(1)
    const empty = createMockApi('empty')
    expect((await data(empty.labels.overview())).setCount).toBe(0)
  }, 20_000)

  it('엑셀 미리보기 → 확정 → 다시 미리보기는 모두 그대로', async () => {
    const api: PautApi = createMockApi()
    const path = await data(api.labels.chooseWorkbook())
    expect(path).toMatch(/\.xlsx$/)
    const pv = await data(api.labels.previewWorkbook(path!))
    expect(pv.ok).toBe(true)
    expect(pv.reader).toMatchObject({ id: 'kim-l2', registered: true })
    expect(pv.files).toHaveLength(4)
    expect(pv.totals.create).toBeGreaterThan(0)
    const r = await data(api.labels.commitWorkbook(pv.previewId))
    expect(r.totals.create).toBe(pv.totals.create)
    expect(await code(api.labels.commitWorkbook(pv.previewId))).toBe('PREVIEW_EXPIRED')
    const ov = await data(api.labels.overview())
    expect(ov.files.filter((f) => f.sets.length > 0)).toHaveLength(4)
    const again = await data(api.labels.previewWorkbook(path!))
    expect(again.totals.create + again.totals.update).toBe(0)

    const bad = await data(api.labels.previewWorkbook('D:/PAUT/라벨/기록양식_error.xlsx'))
    expect(bad.ok).toBe(false)
    expect(bad.errors.length).toBeGreaterThan(0)
    expect(bad.questionErrors).toBe(0)
    expect(await code(api.labels.commitWorkbook(bad.previewId))).toBe('INVALID_ARGUMENT')

    // 그룹 물음: 오류는 물음에서만 났고, 답을 넣어 다시 읽으면 풀린다. 쓴 답은 미리보기에 남는다
    const g = await data(api.labels.previewWorkbook('D:/PAUT/라벨/기록양식_group.xlsx'))
    expect(g.ok).toBe(false)
    expect(g.groupQuestions.length).toBeGreaterThan(0)
    expect(g.questionErrors).toBe(g.errors.length)
    const choices = Object.fromEntries(g.groupQuestions.map((q) => [q.key, q.candidates[0]!.id]))
    const g2 = await data(api.labels.previewWorkbook(g.path, { groupChoices: choices }))
    expect(g2).toMatchObject({ ok: true, groupQuestions: [], options: { groupChoices: choices } })
    // '엑셀 가져오기'는 누를 때마다 보통 → 그룹 물음 → 오류 엑셀
    const picks = [await data(api.labels.chooseWorkbook()), await data(api.labels.chooseWorkbook())]
    expect(picks[0]).toMatch(/group/)
    expect(picks[1]).toMatch(/오류/)
  }, 20_000)

  it('기록 저장: 옛 versions 면 CONFLICT, 같은 내용이면 changed = false, 지우기는 표시', async () => {
    const api = createMockApi()
    const [rec] = await data(api.labels.listRecords({ fileId: 1 }))
    const r = rec as IndicationRecord
    const same = await data(api.labels.saveRecord(r))
    expect(same.changed).toBe(false)
    const saved = await data(api.labels.saveRecord({ ...r, note: '고침' }))
    expect(saved).toMatchObject({ changed: true, value: { note: '고침', revision: 2 } })
    expect(await code(api.labels.saveRecord({ ...r, note: '옛 값' }))).toBe('CONFLICT')
    const del = await data(api.labels.deleteRecord(r.uuid))
    expect(del.value.deleted).toBe(true)
    expect((await data(api.labels.listRecords({ fileId: 1 }))).some((x) => x.uuid === r.uuid)).toBe(false)
    expect(await code(api.labels.deleteRecord('없는-uuid'))).toBe('NOT_FOUND')
  }, 20_000)

  it('JSON 내보내기 → 가져오기는 모두 그대로, 충돌을 들어온 것으로 풀기', async () => {
    const api = createMockApi()
    const out = (await data(api.labels.chooseExportPath({ kind: 'all' })))!
    const ex = await data(api.labels.exportJson({ kind: 'all' }, out))
    expect(ex).toMatchObject({ pcId: 'pc-mock01', onlyLabelerId: null, counts: { labelers: 1 } })
    expect(ex.fileName).toMatch(/^라벨_전체_\d{8}-\d{4}_pc-mock01\.json$/)
    const src = (await data(api.labels.chooseJson()))!
    const imp = await data(api.labels.importJson(src))
    expect(imp).toMatchObject({ ok: true, created: 0, conflicts: 0 })
    expect(imp.unchanged).toBeGreaterThan(0)
    expect(await code(api.labels.exportJson({ kind: 'files', sha256s: [] }, out))).toBe('INVALID_ARGUMENT')

    const [c] = await data(api.labels.listConflicts())
    expect(c).toMatchObject({ entity: 'record', choices: ['mine', 'theirs', 'both'], sourcePcId: 'pc-field2' })
    const res = await data(api.labels.resolveConflict(c!.id, 'theirs'))
    expect(res).toMatchObject({ pendingConflicts: 0, conflict: { resolution: 'theirs' } })
    const rec = (await data(api.labels.listRecords())).find((r) => r.uuid === c!.key)!
    expect(rec.derived.scanEndMm).toBe((c!.theirs as IndicationRecord).derived.scanEndMm)
    expect(await code(api.labels.resolveConflict(c!.id, 'mine'))).toBe('CONFLICT')
  }, 20_000)

  it('라벨러·2인 모드·PC ID 검사', async () => {
    const api = createMockApi()
    expect(await code(api.labels.registerLabeler({ id: ' ', name: 'x', qualification: null, organization: null }))).toBe('INVALID_ARGUMENT')
    await data(api.labels.registerLabeler({ id: 'lee-l2', name: '이 판독', qualification: 'Level II', organization: null }))
    // 이미 있는 ID 는 고치기를 골라야 덮는다
    expect(await code(api.labels.registerLabeler({ id: 'lee-l2', name: '이름 바꿈', qualification: null, organization: null }))).toBe('CONFLICT')
    await data(api.labels.registerLabeler({ id: 'lee-l2', name: '이 판독', qualification: 'UT Level II', organization: null }, { overwrite: true }))
    const s = await data(api.labels.setSession({ labelerId: 'lee-l2', blindMode: true }))
    expect(s).toMatchObject({ labelerId: 'lee-l2', blindMode: true, labeler: { name: '이 판독' } })
    const ov = await data(api.labels.overview())
    expect(ov.setCount).toBe(0)
    expect(ov.hiddenSetCount).toBe(2)
    expect(await code(api.labels.setSession({ labelerId: '없는' }))).toBe('INVALID_ARGUMENT')
    expect(await code(api.labels.setSession({ pcId: '공백 있음' }))).toBe('INVALID_ARGUMENT')
    expect((await data(api.labels.setSession({ pcId: '현장PC-1' }))).pcId).toBe('현장PC-1')
    const e = await data(api.labels.appendWorkEvent({ kind: 'file-open', sessionId: 's1' }))
    expect(e).toMatchObject({ labelerId: 'lee-l2', pcId: '현장PC-1', tool: 'app' })
  }, 20_000)
})
