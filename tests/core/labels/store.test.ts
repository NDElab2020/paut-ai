import { describe, expect, it } from 'vitest'
import { saveLabelRecord, deleteLabelRecord, recomputeGrouping, thicknessForFile } from '@core/labels'
import { sameLabelContent } from '@core/catalog'
import { AppError } from '@shared/errors'
import { labelSetId } from '@shared/labels/factory'
import type { IndicationRecord, LabelSetKey } from '@shared/labels/types'
import { makeFile, makePlan } from '../catalog/fixtures'
import { SHA_A, SHA_B, alignment, defect, event, memCatalog, obs, rec, review, uuid } from './labelFixtures'

const A = { pcId: 'pc-a' }
const B = { pcId: 'pc-b' }

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof AppError ? err.code : `not AppError: ${String(err)}`
  }
  return undefined
}

const setOf = (r: IndicationRecord): LabelSetKey => ({
  sha256: r.sha256,
  labelerId: r.labelerId,
  guidelineVersion: r.guidelineVersion,
  readingStage: r.readingStage
})

describe('지시 기록 저장', () => {
  it('새로 만들면 이 PC 횟수 1, revision 1, 시각(기록용)이 채워진다', () => {
    const c = memCatalog()
    const r = c.labels.saveRecord(rec(1), A)
    expect(r.changed).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.value.versions).toEqual([{ pcId: 'pc-a', edits: 1 }])
    expect(r.value.revision).toBe(1)
    expect(r.value.pcId).toBe('pc-a')
    expect(r.value.createdAt).toMatch(/\+09:00$/)
    expect(r.value.updatedAt).toBe(r.value.createdAt)
    expect(c.labels.getRecord(uuid(1))).toEqual(r.value)
  })

  it('고치면 자기 PC 횟수를 1 올리고, 다른 PC 에서 고치면 그 PC 칸이 생긴다', () => {
    const c = memCatalog()
    const v1 = c.labels.saveRecord(rec(1), A).value
    const v2 = c.labels.saveRecord({ ...v1, note: '고침' }, A).value
    expect(v2.versions).toEqual([{ pcId: 'pc-a', edits: 2 }])
    expect(v2.revision).toBe(2)
    expect(v2.createdAt).toBe(v1.createdAt)
    expect(v2.updatedAt).not.toBe(v1.updatedAt)
    const v3 = c.labels.saveRecord({ ...v2, note: 'B 가 고침' }, B).value
    expect(v3.versions).toEqual([
      { pcId: 'pc-a', edits: 2 },
      { pcId: 'pc-b', edits: 1 }
    ])
    expect(v3.revision).toBe(3)
    expect(v3.pcId).toBe('pc-b')
  })

  it('내용이 그대로면 횟수를 올리지 않는다', () => {
    const c = memCatalog()
    const v1 = c.labels.saveRecord(rec(1), A).value
    const again = c.labels.saveRecord({ ...v1 }, A)
    expect(again.changed).toBe(false)
    expect(again.value.versions).toEqual(v1.versions)
  })

  it('그사이 다른 곳에서 바뀐 사본(옛 versions)으로 저장하면 CONFLICT', () => {
    const c = memCatalog()
    const v1 = c.labels.saveRecord(rec(1), A).value
    c.labels.saveRecord({ ...v1, note: '먼저 고침' }, A)
    expect(code(() => c.labels.saveRecord({ ...v1, note: '옛 사본에서 고침' }, A))).toBe('CONFLICT')
    // 같은 UUID 로 새로 만들기(빈 versions)도 막는다
    expect(code(() => c.labels.saveRecord(rec(1), A))).toBe('CONFLICT')
  })

  it('파일·라벨러·지침서·단계는 바꿀 수 없다', () => {
    const c = memCatalog()
    const v1 = c.labels.saveRecord(rec(1), A).value
    expect(code(() => c.labels.saveRecord({ ...v1, readingStage: 'reconciled' }, A))).toBe('INVALID_ARGUMENT')
    expect(code(() => c.labels.saveRecord({ ...v1, sha256: SHA_B }, A))).toBe('INVALID_ARGUMENT')
  })

  it('검사 오류는 INVALID_ARGUMENT, PC ID 가 없으면 INVALID_ARGUMENT', () => {
    const c = memCatalog()
    expect(code(() => c.labels.saveRecord({ ...rec(1), sha256: 'XYZ' }, A))).toBe('INVALID_ARGUMENT')
    expect(code(() => c.labels.saveRecord({ ...rec(1), kind: 'geometric-echo' }, A))).toBe('INVALID_ARGUMENT')
    expect(code(() => c.labels.saveRecord(rec(1), { pcId: ' ' }))).toBe('INVALID_ARGUMENT')
    expect(c.labels.listRecords()).toEqual([])
  })

  it('모르는 칸(새 버전 앱이 더한 칸)을 보존한다', () => {
    const c = memCatalog()
    const withExtra = { ...rec(1), futureField: { a: [1, 2] }, signal: { ...rec(1).signal, futureNested: 'x' } } as IndicationRecord
    const v = c.labels.saveRecord(withExtra, A).value as IndicationRecord & { futureField?: unknown }
    expect(v.futureField).toEqual({ a: [1, 2] })
    const back = c.labels.getRecord(uuid(1)) as IndicationRecord & { futureField?: unknown; signal: { futureNested?: string } }
    expect(back.futureField).toEqual({ a: [1, 2] })
    expect(back.signal.futureNested).toBe('x')
  })

  it('삭제 표시: 지우지 않고 deleted = true 로 남긴다. 목록 기본값에서는 빠진다', () => {
    const c = memCatalog()
    c.labels.saveRecord(rec(1), A)
    c.labels.saveRecord(rec(2), A)
    const d = c.labels.deleteRecord(uuid(1), A)
    expect(d.value.deleted).toBe(true)
    expect(d.value.versions).toEqual([{ pcId: 'pc-a', edits: 2 }])
    expect(c.labels.deleteRecord(uuid(1), A).changed).toBe(false)
    expect(c.labels.listRecords({ sha256: SHA_A }).map((r) => r.uuid)).toEqual([uuid(2)])
    expect(c.labels.listRecords({ sha256: SHA_A, includeDeleted: true }).map((r) => r.uuid)).toEqual([uuid(1), uuid(2)])
    expect(code(() => c.labels.deleteRecord(uuid(99), A))).toBe('NOT_FOUND')
    // 되살리기는 deleted = false 로 저장
    const back = c.labels.saveRecord({ ...d.value, deleted: false }, A).value
    expect(back.deleted).toBe(false)
    expect(back.revision).toBe(3)
  })
})

describe('라벨 세트 · 2인 독립 모드', () => {
  function twoLabelers() {
    const c = memCatalog()
    c.labels.saveRecord(rec(1), A)
    c.labels.saveRecord(rec(2), A)
    c.labels.saveRecord(rec(3, { labelerId: 'lee' }), A)
    c.labels.saveRecord(rec(4, { readingStage: 'reconciled', knowledge: { designValueSeen: true } }), A)
    c.labels.saveRecord(rec(5, { sha256: SHA_B }), A)
    return c
  }

  it('파일별·세트별 목록. 같은 사람의 블라인드와 대조는 다른 세트', () => {
    const c = twoLabelers()
    // 세트(라벨러 · 지침서 · 단계) 순서, 그 안에서 스캔 위치 순서
    expect(c.labels.listRecords({ sha256: SHA_A }).map((r) => r.uuid)).toEqual([uuid(1), uuid(2), uuid(4), uuid(3)])
    const blind: LabelSetKey = { sha256: SHA_A, labelerId: 'kim', guidelineVersion: 'v1', readingStage: 'blind' }
    expect(c.labels.listRecords({ set: blind }).map((r) => r.uuid)).toEqual([uuid(1), uuid(2)])
    expect(c.labels.listRecords({ set: { ...blind, readingStage: 'reconciled' } }).map((r) => r.uuid)).toEqual([uuid(4)])
  })

  it('다른 라벨러 숨김: visibleLabelerId 가 있으면 그 라벨러 세트만', () => {
    const c = twoLabelers()
    expect(c.labels.listRecords({ sha256: SHA_A, visibleLabelerId: 'lee' }).map((r) => r.uuid)).toEqual([uuid(3)])
    const kimSet: LabelSetKey = { sha256: SHA_A, labelerId: 'kim', guidelineVersion: 'v1', readingStage: 'blind' }
    expect(c.labels.listRecords({ set: kimSet, visibleLabelerId: 'lee' })).toEqual([])
    expect(c.labels.listRecords({ set: kimSet, visibleLabelerId: null }).length).toBe(2)
    expect(c.labels.listLabelSets({ visibleLabelerId: 'lee' }).map((s) => s.labelerId)).toEqual(['lee'])
  })

  it('라벨 세트 목록: 개수·삭제 수·검토 구간 길이(합집합)·파일 연결', () => {
    const c = twoLabelers()
    const plan = c.createPlan(makePlan(12))
    c.ensureSpecimen({ id: 'TP01', displayName: 'TP01', source: 'manual' })
    const f = c.insertFile(makeFile('labels-file', plan.id, 'TP01'))
    const shaFile = f.meta.sha256
    c.labels.saveRecord(rec(10, { sha256: shaFile }), A)
    c.labels.saveRecord(rec(11, { sha256: shaFile, kind: 'geometric-echo', defectType: null, character: { value: null }, geometricEcho: { kind: 'root', fromSuggestion: true } }), A)
    c.labels.deleteRecord(uuid(10), A)
    c.labels.saveReviewInterval(review(1, { sha256: shaFile, scanStartMm: 0, scanEndMm: 50 }), A)
    c.labels.saveReviewInterval(review(2, { sha256: shaFile, scanStartMm: 40, scanEndMm: 80, groupId: 1 }), A)
    c.labels.saveReviewInterval(review(3, { sha256: shaFile, scanStartMm: 200, scanEndMm: 210, released: true }), A)
    c.labels.saveReviewInterval(review(4, { sha256: shaFile, kind: 'quality-bad', reason: 'coupling', gate: null, scanStartMm: 90, scanEndMm: 95 }), A)
    const s = c.labels.listLabelSets({ sha256: shaFile })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({
      sha256: shaFile,
      labelerId: 'kim',
      guidelineVersion: 'v1',
      readingStage: 'blind',
      recordCount: 1,
      defectCount: 0,
      deletedRecordCount: 1,
      reviewIntervalCount: 4,
      reviewedLengthMm: 80,
      qualityBadLengthMm: 5,
      belowThresholdLengthMm: 0,
      fileId: f.id,
      fileName: f.storedFileName,
      pendingConflicts: 0
    })
    expect(s[0]!.setId).toBe(labelSetId(s[0]!))
    // 모든 세트
    const all = c.labels.listLabelSets()
    expect(all.map((x) => `${x.sha256.slice(0, 4)}/${x.labelerId}/${x.readingStage}/${x.recordCount}`)).toEqual(
      expect.arrayContaining(['a3f1/kim/blind/2', 'a3f1/lee/blind/1', 'a3f1/kim/reconciled/1', '0b9e/kim/blind/1'])
    )
  })

  it('모든 기록을 지운 세트는 기본 목록에서 빠지고 includeDeleted 면 보인다', () => {
    const c = memCatalog()
    c.labels.saveRecord(rec(1), A)
    c.labels.deleteRecord(uuid(1), A)
    expect(c.labels.listLabelSets()).toEqual([])
    expect(c.labels.listLabelSets({ includeDeleted: true })[0]).toMatchObject({ recordCount: 0, deletedRecordCount: 1 })
  })
})

describe('검토 완료 구간 자동 풀기 (saveLabelRecord)', () => {
  it('검토 뒤 그 구간 기록을 만들면 겹치는 검토 완료 구간이 풀린다. 다른 세트·안 겹침·다른 그룹은 그대로', () => {
    const c = memCatalog()
    c.labels.saveReviewInterval(review(1, { scanStartMm: 0, scanEndMm: 50 }), A) // 겹침
    c.labels.saveReviewInterval(review(2, { scanStartMm: 60, scanEndMm: 90 }), A) // 안 겹침
    c.labels.saveReviewInterval(review(3, { scanStartMm: 0, scanEndMm: 50, groupId: 1 }), A) // 다른 그룹
    c.labels.saveReviewInterval(review(4, { scanStartMm: 0, scanEndMm: 50, labelerId: 'lee' }), A) // 다른 세트
    const r = rec(2, { derived: { scanStartMm: 20, scanEndMm: 25 }, length: { groupId: 0 } })
    const out = saveLabelRecord(c, r, A)
    expect(out.releasedReviews.map((v) => v.uuid)).toEqual([uuid(1001)])
    expect(c.labels.getReviewInterval(uuid(1001))).toMatchObject({ released: true, revision: 2 })
    for (const n of [1002, 1003, 1004]) expect(c.labels.getReviewInterval(uuid(n))?.released).toBe(false)
  })

  it('그룹을 모르는 기록은 모든 그룹의 구간을 푼다. 내용이 그대로면 풀지 않는다', () => {
    const c = memCatalog()
    const saved = c.labels.saveRecord(rec(2), A).value // 20~25
    c.labels.saveReviewInterval(review(1, { scanStartMm: 0, scanEndMm: 50, groupId: 1 }), A)
    expect(saveLabelRecord(c, { ...saved }, A).releasedReviews).toEqual([])
    expect(saveLabelRecord(c, { ...saved, note: '고침' }, A).releasedReviews.map((v) => v.uuid)).toEqual([uuid(1001)])
  })

  it('기록을 옮기면 옛 위치·새 위치 구간 모두 풀린다. 지워도 풀린다', () => {
    const c = memCatalog()
    const saved = c.labels.saveRecord(rec(2), A).value // 20~25
    c.labels.saveReviewInterval(review(1, { scanStartMm: 0, scanEndMm: 30 }), A)
    c.labels.saveReviewInterval(review(2, { scanStartMm: 100, scanEndMm: 130 }), A)
    c.labels.saveReviewInterval(review(3, { scanStartMm: 200, scanEndMm: 230 }), A)
    const moved = saveLabelRecord(c, { ...saved, derived: { ...saved.derived, scanStartMm: 110, scanEndMm: 115 } }, A)
    expect(moved.releasedReviews.map((v) => v.uuid).sort()).toEqual([uuid(1001), uuid(1002)])
    c.labels.saveReviewInterval({ ...c.labels.getReviewInterval(uuid(1003))! }, A)
    const m2 = saveLabelRecord(c, { ...moved.value, derived: { ...moved.value.derived, scanStartMm: 210, scanEndMm: 215 } }, A)
    expect(m2.releasedReviews.map((v) => v.uuid)).toEqual([uuid(1003)])
    c.labels.saveReviewInterval({ ...c.labels.getReviewInterval(uuid(1003))!, released: false }, A)
    expect(deleteLabelRecord(c, uuid(2), A).releasedReviews.map((v) => v.uuid)).toEqual([uuid(1003)])
  })

  it('releaseReviews = false 면 풀지 않는다', () => {
    const c = memCatalog()
    c.labels.saveReviewInterval(review(1), A)
    expect(saveLabelRecord(c, rec(2), { ...A, releaseReviews: false }).releasedReviews).toEqual([])
    expect(c.labels.getReviewInterval(uuid(1001))?.released).toBe(false)
  })
})

describe('관측 표 · 검토 구간 · 파일 정렬 · 물리 결함 · 작업 이벤트 · 라벨러', () => {
  it('관측 행은 (기록, 그룹, 레그) 키로 저장하고 파일별로 찾는다', () => {
    const c = memCatalog()
    c.labels.saveRecord(rec(1), A)
    c.labels.saveRecord(rec(2, { sha256: SHA_B }), A)
    c.labels.saveObservation(obs(1, 0, 1), A)
    c.labels.saveObservation(obs(1, 1, 2, { status: 'weak' }), A)
    c.labels.saveObservation(obs(2, 0, 1), A)
    const o = c.labels.saveObservation({ ...c.labels.getObservation(uuid(1), 0, 1)!, status: 'not-visible', expertConfirmed: true }, A)
    expect(o.value).toMatchObject({ status: 'not-visible', revision: 2, versions: [{ pcId: 'pc-a', edits: 2 }] })
    expect(c.labels.listObservations({ sha256: SHA_A }).map((x) => [x.groupId, x.leg])).toEqual([
      [0, 1],
      [1, 2]
    ])
    c.labels.deleteObservation(uuid(1), 1, 2, A)
    expect(c.labels.listObservations({ recordUuids: [uuid(1)] }).length).toBe(1)
    expect(c.labels.listObservations({ recordUuids: [uuid(1)], includeDeleted: true }).length).toBe(2)
  })

  it('검토 구간 저장·풀린 것 빼고 목록·삭제 표시', () => {
    const c = memCatalog()
    c.labels.saveReviewInterval(review(1), A)
    c.labels.saveReviewInterval(review(2, { released: true }), A)
    expect(c.labels.listReviewIntervals({ sha256: SHA_A }).length).toBe(2)
    expect(c.labels.listReviewIntervals({ sha256: SHA_A, includeReleased: false }).map((v) => v.uuid)).toEqual([uuid(1001)])
    c.labels.deleteReviewInterval(uuid(1001), A)
    expect(c.labels.listReviewIntervals({ sha256: SHA_A }).map((v) => v.uuid)).toEqual([uuid(1002)])
    expect(code(() => c.labels.saveReviewInterval(review(9, { kind: 'quality-bad', reason: null, gate: null }), A))).toBe('INVALID_ARGUMENT')
  })

  it('파일 정렬·물리 결함 저장과 시편별 목록 (시편 ID 대소문자 무시)', () => {
    const c = memCatalog()
    c.labels.saveFileAlignment(alignment(), A)
    c.labels.saveFileAlignment(alignment({ sha256: SHA_B, specimenId: 'TP02' }), A)
    expect(c.labels.getFileAlignment(SHA_A)?.thicknessMm).toBe(12)
    expect(c.labels.listFileAlignments({ specimenId: 'tp01' }).map((a) => a.sha256)).toEqual([SHA_A])
    c.labels.savePhysicalDefect(defect('D1'), A)
    c.labels.savePhysicalDefect(defect('D2', { design: { lengthMm: 10 } }), A)
    c.labels.savePhysicalDefect(defect('D1', { specimenId: 'TP02' }), A)
    expect(c.labels.listPhysicalDefects({ specimenIds: ['tp01'] }).map((p) => p.id)).toEqual(['D1', 'D2'])
    expect(c.labels.getPhysicalDefect('TP02', 'D1')?.specimenId).toBe('TP02')
    c.labels.deletePhysicalDefect('TP01', 'D2', A)
    expect(c.labels.listPhysicalDefects().map((p) => `${p.specimenId}/${p.id}`)).toEqual(['TP01/D1', 'TP02/D1'])
    c.labels.deleteFileAlignment(SHA_B, A)
    expect(c.labels.listFileAlignments().map((a) => a.sha256)).toEqual([SHA_A])
  })

  it('작업 이벤트는 추가 전용: 같은 것을 다시 넣으면 그대로, 내용이 다르면 CONFLICT', () => {
    const c = memCatalog()
    expect(c.labels.appendWorkEvent(event(1)).changed).toBe(true)
    expect(c.labels.appendWorkEvent(event(1)).changed).toBe(false)
    expect(code(() => c.labels.appendWorkEvent(event(1, { kind: 'file-close' })))).toBe('CONFLICT')
    c.labels.appendWorkEvent(event(2, { sha256: null, kind: 'session-start' }))
    c.labels.appendWorkEvent(event(3, { labelerId: 'lee', sessionId: 's2' }))
    expect(c.labels.listWorkEvents({ labelerId: 'kim' }).map((e) => e.uuid)).toEqual([uuid(5001), uuid(5002)])
    expect(c.labels.listWorkEvents({ sha256: SHA_A }).length).toBe(2)
  })

  it('라벨러 등록·고치기·목록', () => {
    const c = memCatalog()
    c.labels.registerLabeler({ id: 'kim', name: '김판독', qualification: 'UT Level II', organization: null })
    c.labels.registerLabeler({ id: 'lee', name: '이판독', qualification: null, organization: '한난' })
    c.labels.registerLabeler({ id: 'kim', name: '김판독', qualification: 'PAUT Level III', organization: '우리' })
    expect(c.labels.listLabelers()).toEqual([
      { id: 'kim', name: '김판독', qualification: 'PAUT Level III', organization: '우리' },
      { id: 'lee', name: '이판독', qualification: null, organization: '한난' }
    ])
    expect(code(() => c.labels.registerLabeler({ id: '', name: 'x', qualification: null, organization: null }))).toBe('INVALID_ARGUMENT')
  })
})

describe('그룹 짓기 다시 계산 (recomputeGrouping)', () => {
  it('두께: 인자 → 파일 정렬 → 스캔플랜 순서', () => {
    const c = memCatalog()
    const plan = c.createPlan(makePlan(10))
    c.ensureSpecimen({ id: 'TP01', displayName: 'TP01', source: 'manual' })
    const f = c.insertFile(makeFile('g', plan.id, 'TP01'))
    expect(thicknessForFile(c, f.meta.sha256)).toBe(10)
    c.labels.saveFileAlignment(alignment({ sha256: f.meta.sha256, thicknessMm: 11.5 }), A)
    expect(thicknessForFile(c, f.meta.sha256)).toBe(11.5)
    expect(thicknessForFile(c, SHA_B)).toBeNull()
  })

  it('바뀐 groupingId 만 쓰고(버전은 그대로 — 계산 칸), 다시 돌리면 아무것도 바꾸지 않는다', () => {
    const c = memCatalog()
    // t = 6 (그림 5): 1번 [10,15] · 2번 [20,25] 간격 5 < 2×5 → 묶임, 9번 [90,95] 은 따로
    const r1 = c.labels.saveRecord(rec(1), A).value
    c.labels.saveRecord(rec(2), A)
    c.labels.saveRecord(rec(9), A)
    const set = setOf(r1)
    const first = recomputeGrouping(c, set, { ...A, thicknessMm: 6 })
    expect(first.changed.map((r) => r.uuid)).toEqual([uuid(1), uuid(2), uuid(9)])
    expect(c.labels.getRecord(uuid(1))?.groupingId).toBe(`g-${uuid(1)}`)
    expect(c.labels.getRecord(uuid(2))?.groupingId).toBe(`g-${uuid(1)}`)
    expect(c.labels.getRecord(uuid(9))?.groupingId).toBe(`g-${uuid(9)}`)
    // 계산 칸이라 버전을 올리지 않는다 (두 PC 의 두께 출처가 달라도 병합 충돌이 되지 않게)
    expect(c.labels.getRecord(uuid(2))?.revision).toBe(1)
    expect(c.labels.getRecord(uuid(2))?.versions).toEqual([{ pcId: 'pc-a', edits: 1 }])
    const second = recomputeGrouping(c, set, { thicknessMm: 6 })
    expect(second.changed).toEqual([])
    // 화면이 옛 groupingId 를 들고 와 저장해도 계산값을 되돌리지 않고, 내용이 같으면 쓰지 않는다
    const r2 = c.labels.getRecord(uuid(2))!
    expect(c.labels.saveRecord({ ...r2, groupingId: null }, A).changed).toBe(false)
    expect(c.labels.getRecord(uuid(2))?.groupingId).toBe(`g-${uuid(1)}`)
  })

  it('groupingId 만 다른 같은 버전의 사본은 충돌이 아니다 (sameLabelContent 가 계산 칸을 뺀다)', () => {
    const c = memCatalog()
    const r = c.labels.saveRecord(rec(1), A).value
    expect(sameLabelContent(r, { ...r, groupingId: 'g-다른' })).toBe(true)
  })

  it('기록을 지우면 그 관측 행도 지움 표시된다', () => {
    const c = memCatalog()
    c.labels.saveRecord(rec(1), A)
    c.labels.saveObservation(obs(1, 0, 2), A)
    deleteLabelRecord(c, uuid(1), A)
    expect(c.labels.listObservations({ recordUuids: [uuid(1)] })).toEqual([])
    expect(c.labels.listObservations({ recordUuids: [uuid(1)], includeDeleted: true })[0]?.deleted).toBe(true)
  })

  it('그룹 짓기는 검토 완료 구간을 풀지 않는다', () => {
    const c = memCatalog()
    const r1 = c.labels.saveRecord(rec(1), A).value
    c.labels.saveRecord(rec(2), A)
    c.labels.saveReviewInterval(review(1), A)
    recomputeGrouping(c, setOf(r1), { ...A, thicknessMm: 6 })
    expect(c.labels.getReviewInterval(uuid(1001))?.released).toBe(false)
  })
})
