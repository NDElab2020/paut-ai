/**
 * 라벨 패널 상태·규칙 (renderer/src/labeling — 순수):
 *  - panelState: 세트를 바꾸면 고치던·고른 기록과 보여 준 제안을 놓음, 저장 뒤 다음 양식(습관 칸 유지), 품질 불량만 사유, 같은 값이면 같은 상태
 *  - labelSet: 세트 = 지금 라벨러 · 지침서 · 단계, 처음엔 마지막으로 쓴 세트(없으면 v1 · 블라인드), 라벨러가 없을 때 이유
 *  - 제안 보이기: 2인 독립 모드면 늘 숨김, 아니면 전문가가 길이를 정한 뒤에만
 *  - 작업 이벤트: 5분 입력 없으면 쉼(다시 입력·닫을 때 그 구간), 이벤트 칸(라벨러·단계·파일·도구·세부), 시간대가 붙은 로컬 시각
 *  - state: 점 여럿 한 번에(되돌리기 한 단계), 역할 지우기
 */
import { describe, expect, it } from 'vitest'
import type { LabelSession, LabelSetInfo } from '@shared/api'
import { newIndicationRecord, validateWorkEvent, newWorkEvent } from '@shared/labels'
import { KEY, SHA, loadRenderer, uuid } from './panelKit'

const P = await loadRenderer('panelState')
const LS = await loadRenderer('labelSet')
const EV = await loadRenderer('events')
const ST = await loadRenderer('state')
const R = await loadRenderer('record')

describe('패널 상태 리듀서', () => {
  it('세트를 바꾸면 고치던 기록·고른 기록·보여 준 제안을 놓는다 (같은 세트면 같은 상태)', () => {
    let s = P.initialPanelState()
    const base = newIndicationRecord({ uuid: uuid(1), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', derived: { scanStartMm: 1, scanEndMm: 2 } })
    s = P.panelReducer(s, { type: 'startEdit', base, form: R.defaultForm(), draftKey: '[]' })
    s = P.panelReducer(s, { type: 'setShown', shown: { suggestion: null, reason: 'x', expertStartMm: 1, expertEndMm: 2, sectionKey: '[]' } })
    expect(s.editingUuid).toBe(uuid(1))
    expect(s.editingBase).toBe(base)
    expect(s.selectedUuid).toBe(uuid(1))
    const c = { guidelineVersion: 'v1', readingStage: 'reconciled' }
    const t = P.panelReducer(s, { type: 'setChoice', choice: c })
    expect(t).toMatchObject({ setChoice: c, editingUuid: null, editingBase: null, selectedUuid: null, shown: null })
    expect(P.panelReducer(t, { type: 'setChoice', choice: { ...c } })).toBe(t)
  })

  it('저장 뒤: 고른 기록 = 저장한 것, 양식은 다음 기록 (높이 방식·길이 측정법·외경 유지), 대조 단계는 설계값 봤음', () => {
    let s = P.initialPanelState()
    s = P.panelReducer(s, { type: 'patchForm', patch: { heightMethod: 'tip-surface', defectType: 'slag', note: '메모', outerDiameterMm: 139.8 } })
    const t = P.panelReducer(s, { type: 'saved', uuid: uuid(2), stage: 'reconciled' })
    expect(t.selectedUuid).toBe(uuid(2))
    expect(t.editingUuid).toBeNull()
    expect(t.form).toMatchObject({ heightMethod: 'tip-surface', defectType: null, note: '', outerDiameterMm: 139.8, designValueSeen: true })
    expect(P.panelReducer(t, { type: 'patchForm', patch: { note: '' } })).toBe(t)
  })

  it('라벨러가 바뀌면 고치기·제안·스냅샷을 버리고 owner 를 바꾼다, CONFLICT 표시·떼기', () => {
    let s = P.initialPanelState()
    s = P.panelReducer(s, { type: 'setOwner', owner: 'kim-l2' })
    const base = newIndicationRecord({ uuid: uuid(7), sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', derived: { scanStartMm: 1, scanEndMm: 2 } })
    s = P.panelReducer(s, { type: 'startEdit', base, form: R.defaultForm(), draftKey: 'k' })
    s = P.panelReducer(s, { type: 'setConflict', on: true })
    s = P.panelReducer(s, { type: 'setPreview', on: true })
    expect(s).toMatchObject({ owner: 'kim-l2', editingUuid: uuid(7), conflict: true })
    const t = P.panelReducer(s, { type: 'resetForLabeler', owner: 'lee-l2', stage: 'blind' })
    expect(t).toMatchObject({ owner: 'lee-l2', editingUuid: null, editingBase: null, conflict: false, shown: null, snapshot: null, setChoice: null, preview: true })
    // 고치던 기록과 떼어 새 기록으로 (양식은 그대로)
    const u = P.panelReducer(P.panelReducer(s, { type: 'patchForm', patch: { note: '그대로' } }), { type: 'detachEdit' })
    expect(u).toMatchObject({ editingUuid: null, editingBase: null, conflict: false })
    expect(u.form.note).toBe('그대로')
    // 새 기록 스냅샷은 저장하면 비운다
    const v = P.panelReducer(P.panelReducer(P.initialPanelState(), { type: 'setSnapshot', snapshot: { a: 1 } }), { type: 'saved', uuid: uuid(8), stage: 'blind' })
    expect(v.snapshot).toBeNull()
  })

  it('검토 구간 사유는 품질 불량에만, 지운 기록은 놓는다, 거절한 후보·미리보기·에코 띠', () => {
    let s = P.panelReducer(P.initialPanelState(), { type: 'patchReview', patch: { kind: 'quality-bad', reason: 'coupling' } })
    expect(s.review).toMatchObject({ kind: 'quality-bad', reason: 'coupling' })
    s = P.panelReducer(s, { type: 'patchReview', patch: { kind: 'reviewed' } })
    expect(s.review.reason).toBeNull()
    s = P.panelReducer(s, { type: 'select', uuid: uuid(3) })
    s = P.panelReducer(s, { type: 'forget', uuid: uuid(3) })
    expect(s.selectedUuid).toBeNull()
    s = P.panelReducer(s, { type: 'setEchoEdit', edit: { id: '0:root:L2:0', startMm: 1, endMm: 9, kind: 'other' } })
    s = P.panelReducer(s, { type: 'rejectEcho', id: '0:root:L2:0' })
    expect(s.rejectedEchoes).toEqual(['0:root:L2:0'])
    expect(s.echoEdit).toBeNull()
    expect(P.panelReducer(s, { type: 'rejectEcho', id: '0:root:L2:0' })).toBe(s)
    expect(P.panelReducer(s, { type: 'setPreview', on: true }).preview).toBe(true)
    expect(P.panelReducer(s, { type: 'setShowEchoes', on: false })).toBe(s)
  })
})

function info(over: Partial<LabelSetInfo>): LabelSetInfo {
  return {
    sha256: SHA,
    labelerId: 'kim-l2',
    guidelineVersion: 'v1',
    readingStage: 'blind',
    setId: '',
    recordCount: 1,
    defectCount: 1,
    echoCount: 0,
    imperfectionCount: 0,
    deletedRecordCount: 0,
    reviewIntervalCount: 0,
    reviewedLengthMm: 0,
    qualityBadLengthMm: 0,
    belowThresholdLengthMm: 0,
    lastStoredAt: null,
    fileId: 1,
    fileName: 'a.nde',
    pendingConflicts: 0,
    labelerName: '김',
    ...over
  }
}

function session(over: Partial<LabelSession> = {}): LabelSession {
  const kim = { id: 'kim-l2', name: '김 판독', qualification: 'UT Level II', organization: null }
  return { pcId: 'pc-1', versionSlot: 'pc-1:r', notices: [], labelerId: 'kim-l2', labeler: kim, blindMode: false, labelers: [kim], ...over }
}

describe('라벨 세트 고르기', () => {
  it('처음: 이 파일의 지금 라벨러 세트 가운데 마지막으로 쓴 것, 없으면 v1 · 블라인드 (다른 라벨러 세트는 보지 않음)', () => {
    const sets = [
      info({ readingStage: 'blind', lastStoredAt: '2026-10-05T10:00:00+09:00' }),
      info({ readingStage: 'reconciled', lastStoredAt: '2026-10-06T10:00:00+09:00' }),
      info({ labelerId: 'lee-l2', readingStage: 'final', lastStoredAt: '2026-10-07T10:00:00+09:00' }),
      info({ sha256: 'c'.repeat(64), readingStage: 'final', lastStoredAt: '2026-10-08T10:00:00+09:00' })
    ]
    expect(LS.defaultSetChoice(sets, SHA, 'kim-l2')).toEqual({ guidelineVersion: 'v1', readingStage: 'reconciled' })
    expect(LS.defaultSetChoice(sets, SHA, 'park')).toEqual({ guidelineVersion: 'v1', readingStage: 'blind' })
    expect(LS.setsOfLabeler(sets, SHA, 'kim-l2').map((s: LabelSetInfo) => s.readingStage)).toEqual(['reconciled', 'blind'])
  })

  it('세트 = 지금 라벨러 · 정리한 지침서 버전 · 단계 (새 세트 표시) — 라벨러가 없으면 이유', () => {
    const r = LS.resolveSet(session(), SHA, { guidelineVersion: '  v2 ', readingStage: 'final' }, [info({})])
    expect(r).toEqual({ ok: true, key: { sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v2', readingStage: 'final' }, labelerName: '김 판독', isNew: true })
    expect(LS.resolveSet(session(), SHA, { guidelineVersion: 'v1', readingStage: 'blind' }, [info({})]).isNew).toBe(false)
    expect(LS.resolveSet(session({ labelers: [] }), SHA, { guidelineVersion: 'v1', readingStage: 'blind' }, []).reason).toBe('no-labelers')
    expect(LS.resolveSet(session({ labelerId: null, labeler: null }), SHA, { guidelineVersion: 'v1', readingStage: 'blind' }, []).reason).toBe('no-labeler')
    expect(LS.resolveSet(session({ labeler: null }), SHA, { guidelineVersion: 'v1', readingStage: 'blind' }, []).reason).toBe('unregistered')
    expect(LS.resolveSet(null, SHA, { guidelineVersion: 'v1', readingStage: 'blind' }, []).ok).toBe(false)
    expect(LS.cleanGuideline('')).toBe('v1')
    expect(LS.setLabel('김 판독', KEY)).toBe('김 판독 · v1 · 블라인드')
    expect([LS.designSeenForced('blind'), LS.designSeenForced('reconciled'), LS.designSeenForced('final')]).toEqual([false, true, true])
  })

  it('앱 길이 제안 보이기: 2인 독립 모드면 늘 숨김, 아니면 전문가가 길이를 정한 뒤에만', () => {
    expect(LS.suggestionVisibility(true, true)).toBe('hidden-blind')
    expect(LS.suggestionVisibility(true, false)).toBe('hidden-blind')
    expect(LS.suggestionVisibility(false, false)).toBe('wait-expert')
    expect(LS.suggestionVisibility(false, true)).toBe('show')
    expect(LS.SUGGESTION_VISIBILITY_TEXT['hidden-blind']).toContain('2인 독립')
  })
})

describe('작업 이벤트 · 쉼', () => {
  const MIN = 60 * 1000

  it('5분 넘게 입력이 없다가 다시 입력하면 그 구간 전체가 쉼 (5분 미만은 아님), 닫을 때도, 닫은 뒤는 없음', () => {
    const t = EV.createIdleTracker(0)
    expect(t.input(4 * MIN)).toBeNull()
    expect(t.input(8 * MIN)).toBeNull()
    expect(t.input(8 * MIN + 5 * MIN)).toEqual({ fromMs: 8 * MIN, toMs: 13 * MIN, ms: 5 * MIN })
    expect(t.lastInputMs()).toBe(13 * MIN)
    expect(t.close(13 * MIN + 4 * MIN)).toBeNull()
    const u = EV.createIdleTracker(0)
    u.input(MIN)
    expect(u.close(MIN + 20 * MIN)).toEqual({ fromMs: MIN, toMs: 21 * MIN, ms: 20 * MIN })
    expect(u.close(30 * MIN)).toBeNull()
    expect(u.input(40 * MIN)).toBeNull()
    expect(EV.IDLE_MS).toBe(5 * MIN)
  })

  it('이벤트 칸: 라벨러·판독 단계·파일 = 세트, 도구 = 앱, 세부에 지침서 버전 — 검사 통과', () => {
    const e = EV.workEvent('record-create', 'sess-1', KEY, { recordUuid: uuid(9) })
    expect(e).toEqual({
      kind: 'record-create',
      sessionId: 'sess-1',
      labelerId: 'kim-l2',
      readingStage: 'blind',
      sha256: SHA,
      tool: 'app',
      detail: { guidelineVersion: 'v1', recordUuid: uuid(9) }
    })
    const full = newWorkEvent({ ...e, uuid: uuid(10), at: '2026-10-06T14:05:00+09:00' })
    expect(validateWorkEvent(full).ok).toBe(true)
    const idle = EV.idleEvent({ fromMs: Date.UTC(2026, 9, 6, 5, 0), toMs: Date.UTC(2026, 9, 6, 5, 7), ms: 7 * MIN }, 'sess-1', KEY)
    expect(idle.kind).toBe('idle')
    expect(idle.detail).toMatchObject({ idleSeconds: 420 })
    expect(idle.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/)
    expect(validateWorkEvent(newWorkEvent({ ...idle, uuid: uuid(11), at: idle.at! })).ok).toBe(true)
  })

  it('로컬 시각 ISO: 시간대 포함, 같은 순간이면 같은 시각', () => {
    const ms = Date.UTC(2026, 9, 6, 5, 4, 3)
    const s = EV.localIso(ms)
    expect(s).toMatch(/^2026-10-0[56]T\d\d:04:03[+-]\d\d:\d\d$/)
    expect(new Date(s).getTime()).toBe(ms)
    expect(EV.newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('초안 리듀서 더한 것 (state.ts)', () => {
  const pt = (role: string, scanIndex = 3) => ({ role, groupId: 0, scanIndex, scanMm: scanIndex, vMm: 0, unfoldedDepthMm: 20, beam: 10, sample: 300, displayGainDb: 0 })

  it('점 여럿을 한 번에 = 되돌리기 한 단계, 하나만 두는 역할은 옮김(id 유지)', () => {
    let s = ST.initialLabelState()
    s = ST.labelReducer(s, { type: 'addPoint', point: pt('peak') })
    const h = s.history.length
    s = ST.labelReducer(s, { type: 'setPoints', points: [pt('length-start', 1), pt('length-end', 9)] })
    expect(s.history.length).toBe(h + 1)
    expect(s.draft.points.map((p: { id: string; role: string }) => `${p.id}:${p.role}`)).toEqual(['p1:peak', 'p2:length-start', 'p3:length-end'])
    s = ST.labelReducer(s, { type: 'setPoints', points: [pt('length-start', 2), pt('length-end', 8)] })
    expect(s.draft.points.map((p: { id: string; scanIndex: number }) => `${p.id}:${p.scanIndex}`)).toEqual(['p1:3', 'p2:2', 'p3:8'])
    expect(ST.labelReducer(s, { type: 'setPoints', points: [] })).toBe(s)
    s = ST.labelReducer(s, { type: 'undo' })
    expect(s.draft.points.find((p: { role: string }) => p.role === 'length-start').scanIndex).toBe(1)
  })

  it('역할 지우기 (길이 지우기): 그 역할 점만 빠지고, 없으면 같은 상태', () => {
    let s = ST.initialLabelState()
    s = ST.labelReducer(s, { type: 'setPoints', points: [pt('peak'), pt('length-start', 1), pt('length-end', 9)] })
    const t = ST.labelReducer(s, { type: 'removeRoles', roles: ['length-start', 'length-end'] })
    expect(t.draft.points.map((p: { role: string }) => p.role)).toEqual(['peak'])
    expect(ST.labelReducer(t, { type: 'removeRoles', roles: ['length-start'] })).toBe(t)
  })
})
