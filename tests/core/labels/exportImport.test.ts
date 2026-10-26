import { describe, expect, it } from 'vitest'
import type { Catalog } from '@core/catalog'
import { exportLabels, exportLabelsJson, importLabels, resolveLabelConflict, type LabelExportOptions } from '@core/labels'
import { AppError } from '@shared/errors'
import { newIndicationRecord } from '@shared/labels/factory'
import { LABEL_COORD_RULES_VERSION, LABEL_SCHEMA_VERSION, type IndicationRecord, type LabelExportFile } from '@shared/labels/types'
import { parseLabelExportJson, serializeLabelExport } from '@shared/labels/validate'
import { SHA_A, SHA_B, alignment, defect, event, memCatalog, obs, rec, review, uuid } from './labelFixtures'

const A = { pcId: 'pc-a' }
const B = { pcId: 'pc-b' }
const HEAD = (pcId: string): LabelExportOptions => ({ appVersion: '0.1.0', pcId, exportedAt: '2026-10-06T18:00:00+09:00' })

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof AppError ? err.code : `not AppError: ${String(err)}`
  }
  return undefined
}

/** 앱에서 찍은(앵커) 결함 기록 */
function anchored(n: number): IndicationRecord {
  return newIndicationRecord({
    uuid: uuid(n),
    sha256: SHA_A,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    defectType: 'crack-sidewall',
    character: { value: 'planar' },
    physicalDefectId: 'D1',
    anchors: [
      {
        id: 'p1',
        role: 'tip-top',
        anchor: { groupId: 0, scanIndex: 135.4, beam: 12.25, sample: 410.5, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: true },
        leg: 2,
        displayGainDb: 0,
        mm: { scanMm: 135.4, vMm: -3.2, depthMm: 6.1 }
      },
      {
        id: 'p2',
        role: 'tip-bottom',
        anchor: { groupId: 0, scanIndex: 135.4, beam: 14.5, sample: 470, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: true },
        leg: 2,
        displayGainDb: 0,
        mm: { scanMm: 135.4, vMm: -2.4, depthMm: 8.9 }
      }
    ],
    derived: { scanStartMm: 120, scanEndMm: 148, vMinMm: -4, vMaxMm: -1, depthTopMm: 6.1, depthBottomMm: 8.9 },
    length: { valueMm: 28, method: 'eval-level', groupId: 0, beam: 13, thresholdPct: 32 },
    height: { method: 'tip-tip', valueMm: 2.8, pointIds: ['p1', 'p2'] },
    viewSnapshot: { gainDb: 0, gate: { startMm: 7, widthMm: 21 } }
  })
}

/** 모든 저장 단위를 담은 PC A 카탈로그 */
function populated(): Catalog {
  const c = memCatalog()
  c.labels.registerLabeler({ id: 'kim', name: '김판독', qualification: 'UT Level II', organization: null })
  c.labels.registerLabeler({ id: 'lee', name: '이판독', qualification: null, organization: '한난' })
  c.labels.savePhysicalDefect(defect('D1', { design: { type: 'crack-sidewall', startMm: 120, endMm: 148, lengthMm: 28 } }), A)
  c.labels.savePhysicalDefect(defect('D2'), A)
  c.labels.saveFileAlignment(alignment(), A)
  c.labels.saveRecord(anchored(1), A)
  c.labels.saveRecord(rec(2), A)
  c.labels.saveRecord(
    rec(3, { kind: 'geometric-echo', defectType: null, character: { value: null }, geometricEcho: { kind: 'root', fromSuggestion: true } }),
    A
  )
  c.labels.saveRecord(rec(4), A)
  c.labels.deleteRecord(uuid(4), A)
  c.labels.saveRecord(rec(5, { sha256: SHA_B, labelerId: 'lee' }), A)
  c.labels.saveObservation(obs(1, 0, 2, { status: 'visible', expertConfirmed: true }), A)
  c.labels.saveObservation(obs(1, 1, 1, { status: 'weak' }), A)
  c.labels.saveReviewInterval(review(1, { scanStartMm: 0, scanEndMm: 300 }), A)
  c.labels.saveReviewInterval(review(2, { kind: 'below-threshold', gate: null, scanStartMm: 200, scanEndMm: 205, groupId: 1 }), A)
  c.labels.appendWorkEvent(event(1, { sha256: null, kind: 'session-start' }))
  c.labels.appendWorkEvent(event(2))
  c.labels.appendWorkEvent(event(3, { sessionId: 's9', labelerId: 'lee', sha256: SHA_B }))
  return c
}

function counts(f: LabelExportFile): Record<string, number> {
  return {
    labelers: f.labelers.length,
    physicalDefects: f.physicalDefects.length,
    fileAlignments: f.fileAlignments.length,
    records: f.records.length,
    observations: f.observations.length,
    reviewIntervals: f.reviewIntervals.length,
    workEvents: f.workEvents.length
  }
}

describe('내보내기', () => {
  it('전체 내보내기는 parseLabelExport 로 다시 읽어도 같은 내용이다 (경고 없음)', () => {
    const a = populated()
    const exp = exportLabels(a, { kind: 'all' }, HEAD('pc-a'))
    expect(exp).toMatchObject({ format: 'paut-labels', schemaVersion: LABEL_SCHEMA_VERSION, rulesVersion: LABEL_COORD_RULES_VERSION, pcId: 'pc-a' })
    expect(counts(exp)).toEqual({ labelers: 2, physicalDefects: 2, fileAlignments: 1, records: 5, observations: 2, reviewIntervals: 2, workEvents: 3 })
    expect(exp.records.find((r) => r.uuid === uuid(4))?.deleted).toBe(true)
    const back = parseLabelExportJson(serializeLabelExport(exp))
    expect(back.errors).toEqual([])
    expect(back.warnings).toEqual([])
    expect(back.value).toEqual(exp)
    expect(exportLabelsJson(a, { kind: 'all' }, HEAD('pc-a'))).toBe(serializeLabelExport(exp))
  })

  it('파일 범위: 그 파일의 기록·정렬·시편 물리 결함·세션 이벤트만', () => {
    const a = populated()
    const exp = exportLabels(a, { kind: 'files', sha256s: [SHA_A.toUpperCase()] }, HEAD('pc-a'))
    // 세트 안에서 스캔 위치 순서 (기록 1 은 120 mm)
    expect(exp.records.map((r) => r.uuid)).toEqual([uuid(2), uuid(3), uuid(4), uuid(1)])
    expect(exp.fileAlignments.map((x) => x.sha256)).toEqual([SHA_A])
    expect(exp.physicalDefects.map((p) => p.id)).toEqual(['D1', 'D2'])
    expect(exp.workEvents.map((e) => e.uuid)).toEqual([uuid(5001), uuid(5002)])
    expect(exp.labelers.map((l) => l.id)).toEqual(['kim'])
    expect(exp.observations.length).toBe(2)
  })

  it('라벨 세트 범위: 다른 라벨러·다른 단계는 빠진다. 삭제 표시는 includeDeleted = false 면 빠진다', () => {
    const a = populated()
    a.labels.saveRecord(rec(6, { readingStage: 'reconciled', knowledge: { designValueSeen: true } }), A)
    const set = { sha256: SHA_A, labelerId: 'kim', guidelineVersion: 'v1', readingStage: 'blind' as const }
    const exp = exportLabels(a, { kind: 'sets', sets: [set] }, HEAD('pc-a'))
    expect(exp.records.map((r) => r.uuid)).toEqual([uuid(2), uuid(3), uuid(4), uuid(1)])
    const noDel = exportLabels(a, { kind: 'sets', sets: [set] }, { ...HEAD('pc-a'), includeDeleted: false })
    expect(noDel.records.map((r) => r.uuid)).toEqual([uuid(2), uuid(3), uuid(1)])
    const lee = exportLabels(a, { kind: 'sets', sets: [{ ...set, sha256: SHA_B, labelerId: 'lee' }] }, HEAD('pc-a'))
    expect(lee.records.map((r) => r.uuid)).toEqual([uuid(5)])
    expect(lee.workEvents.map((e) => e.uuid)).toEqual([uuid(5003)])
    expect(lee.labelers.map((l) => l.id)).toEqual(['lee'])
  })

  it('PC ID·앱 버전이 없으면 INVALID_ARGUMENT', () => {
    const a = populated()
    expect(code(() => exportLabels(a, { kind: 'all' }, { appVersion: '0.1.0', pcId: '' }))).toBe('INVALID_ARGUMENT')
    expect(code(() => exportLabels(a, { kind: 'all' }, { appVersion: ' ', pcId: 'x' }))).toBe('INVALID_ARGUMENT')
  })
})

describe('가져오기 왕복 · 멱등', () => {
  it('빈 PC 로 가져오면 모두 새로 들어가고, 다시 내보내면 같은 파일이다', () => {
    const a = populated()
    const exp = exportLabels(a, { kind: 'all' }, HEAD('pc-a'))
    const b = memCatalog()
    const r = importLabels(b, serializeLabelExport(exp))
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.created).toBe(17)
    expect([r.updated, r.unchanged, r.conflicts]).toEqual([0, 0, 0])
    expect(r.byEntity.record).toEqual({ created: 5, updated: 0, unchanged: 0, conflicts: 0 })
    expect(r.source).toMatchObject({ pcId: 'pc-a', appVersion: '0.1.0' })
    expect(exportLabels(b, { kind: 'all' }, HEAD('pc-a'))).toEqual(exp)
  })

  it('같은 파일을 두 번 가져와도 결과가 같다 (두 번째는 모두 그대로)', () => {
    const a = populated()
    const text = exportLabelsJson(a, { kind: 'all' }, HEAD('pc-a'))
    const b = memCatalog()
    importLabels(b, text)
    const snap = exportLabels(b, { kind: 'all' }, HEAD('x'))
    const again = importLabels(b, text)
    expect(again.ok).toBe(true)
    expect([again.created, again.updated, again.conflicts, again.unchanged]).toEqual([0, 0, 0, 17])
    expect(exportLabels(b, { kind: 'all' }, HEAD('x'))).toEqual(snap)
    // 내보낸 PC 자신에게 다시 가져와도 그대로
    const self = importLabels(a, text)
    expect([self.created, self.updated, self.conflicts]).toEqual([0, 0, 0])
  })

  it('모르는 칸(새 버전 앱이 더한 칸)을 저장·재내보내기까지 보존한다', () => {
    const a = populated()
    const exp = exportLabels(a, { kind: 'all' }, HEAD('pc-a')) as unknown as Record<string, unknown> & LabelExportFile
    const records = exp.records.map((r) =>
      r.uuid === uuid(2) ? { ...r, futureField: { k: [1, 'a'] }, derived: { ...r.derived, futureNested: 7 } } : r
    )
    const raw = { ...exp, records, futureTop: 'top' }
    const b = memCatalog()
    const rep = importLabels(b, JSON.stringify(raw))
    expect(rep.ok).toBe(true)
    expect(rep.warnings.some((w) => w.includes('모르는 칸을 그대로 보존합니다'))).toBe(true)
    const got = b.labels.getRecord(uuid(2)) as unknown as { futureField: unknown; derived: { futureNested: number } }
    expect(got.futureField).toEqual({ k: [1, 'a'] })
    expect(got.derived.futureNested).toBe(7)
    const again = exportLabels(b, { kind: 'all' }, HEAD('pc-b'))
    const r2 = again.records.find((r) => r.uuid === uuid(2)) as unknown as { futureField: unknown }
    expect(r2.futureField).toEqual({ k: [1, 'a'] })
    // 모르는 칸이 있는 기록을 이 PC 에서 고쳐도 남는다
    const edited = b.labels.saveRecord({ ...(b.labels.getRecord(uuid(2)) as IndicationRecord), note: '고침' }, B).value as unknown as {
      futureField: unknown
    }
    expect(edited.futureField).toEqual({ k: [1, 'a'] })
  })

  it('더 새 schemaVersion 은 거부하고 아무것도 쓰지 않는다', () => {
    const a = populated()
    const exp = exportLabels(a, { kind: 'all' }, HEAD('pc-a'))
    const b = memCatalog()
    const r = importLabels(b, { ...exp, schemaVersion: LABEL_SCHEMA_VERSION + 1 })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain(`v${LABEL_SCHEMA_VERSION + 1}`)
    expect(b.labels.listRecords({ includeDeleted: true })).toEqual([])
    expect(b.labels.listLabelers()).toEqual([])
  })

  it('검사 오류가 하나라도 있으면 나머지도 쓰지 않는다', () => {
    const a = populated()
    const exp = exportLabels(a, { kind: 'all' }, HEAD('pc-a'))
    const bad = { ...exp, records: [...exp.records, { ...exp.records[1]!, uuid: 'not-a-uuid' }] }
    const b = memCatalog()
    const r = importLabels(b, bad)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
    expect(b.labels.listRecords({ includeDeleted: true })).toEqual([])
    expect(importLabels(b, '{ 깨진 JSON').errors[0]).toContain('JSON')
  })
})

describe('병합 판단 (버전 벡터)', () => {
  /** A 에서 기록 2 를 만들어 B 로 옮긴 상태 */
  function pair(): { a: Catalog; b: Catalog } {
    const a = memCatalog()
    const b = memCatalog()
    a.labels.saveRecord(rec(2), A)
    importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    return { a, b }
  }
  const editA = (c: Catalog, note: string, pc = A): IndicationRecord => c.labels.saveRecord({ ...c.labels.getRecord(uuid(2))!, note }, pc).value

  it('들어온 것이 내 것을 포함하면 덮어쓴다', () => {
    const { a, b } = pair()
    const v = editA(a, 'A 가 고침')
    const r = importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    expect(r.byEntity.record).toEqual({ created: 0, updated: 1, unchanged: 0, conflicts: 0 })
    expect(b.labels.getRecord(uuid(2))).toEqual(v)
  })

  it('내 것이 들어온 것을 포함하면 그대로 둔다', () => {
    const { a, b } = pair()
    const old = exportLabels(a, { kind: 'all' }, HEAD('pc-a'))
    const mine = editA(b, 'B 가 고침', B)
    const r = importLabels(b, old)
    expect(r.byEntity.record).toEqual({ created: 0, updated: 0, unchanged: 1, conflicts: 0 })
    expect(b.labels.getRecord(uuid(2))).toEqual(mine)
  })

  it('양쪽에서 따로 고치면 충돌: 내 것을 두고 둘 다 보관한다. 다시 가져와도 충돌이 늘지 않는다', () => {
    const { a, b } = pair()
    const theirs = editA(a, 'A 가 고침')
    const mine = editA(b, 'B 가 고침', B)
    const text = exportLabelsJson(a, { kind: 'all' }, HEAD('pc-a'))
    const r = importLabels(b, text)
    expect(r.byEntity.record).toEqual({ created: 0, updated: 0, unchanged: 0, conflicts: 1 })
    expect(r.pendingConflicts).toBe(1)
    expect(r.warnings.join()).toContain('따로 고친')
    expect(b.labels.getRecord(uuid(2))).toEqual(mine)
    const [c] = b.labels.listConflicts()
    expect(c).toMatchObject({ entity: 'record', key: uuid(2), sha256: SHA_A, labelerId: 'kim', sourcePcId: 'pc-a', resolution: null })
    expect(c!.theirs).toEqual(theirs)
    expect(c!.mineAtDetection).toEqual(mine)
    expect(r.conflictItems).toEqual([{ entity: 'record', key: uuid(2), conflictId: c!.id }])
    expect(b.labels.listLabelSets()[0]!.pendingConflicts).toBe(1)
    const again = importLabels(b, text)
    expect([again.conflicts, again.unchanged, again.pendingConflicts]).toEqual([0, 1, 1])
  })

  it('횟수는 같은데 내용이 다르면(같은 PC ID 를 두 곳에서 씀) 충돌', () => {
    const { a, b } = pair()
    editA(a, '첫째 PC')
    editA(b, '둘째 PC', A)
    const r = importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    expect(r.byEntity.record.conflicts).toBe(1)
  })

  it('버전만 갈리고 내용이 같으면 버전 벡터만 합친다 (자동 합침)', () => {
    const { a, b } = pair()
    editA(a, '같은 고침')
    editA(b, '같은 고침', B)
    const r = importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    expect([r.byEntity.record.updated, r.autoMerged, r.conflicts]).toEqual([1, 1, 0])
    expect(b.labels.getRecord(uuid(2))?.versions).toEqual([
      { pcId: 'pc-a', edits: 2 },
      { pcId: 'pc-b', edits: 1 }
    ])
    expect(b.labels.getRecord(uuid(2))?.revision).toBe(3)
    // 이제 B 것이 A 것을 포함 → A 로 가져가면 덮어씀
    const back = importLabels(a, exportLabels(b, { kind: 'all' }, HEAD('pc-b')))
    expect(back.byEntity.record.updated).toBe(1)
  })

  it('관측 행·검토 구간·파일 정렬·물리 결함도 같은 규칙으로 병합한다', () => {
    const a = memCatalog()
    const b = memCatalog()
    a.labels.saveRecord(rec(2), A)
    a.labels.saveObservation(obs(2, 0, 1), A)
    a.labels.saveReviewInterval(review(1), A)
    a.labels.saveFileAlignment(alignment(), A)
    a.labels.savePhysicalDefect(defect('D1'), A)
    importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    a.labels.saveObservation({ ...a.labels.getObservation(uuid(2), 0, 1)!, status: 'weak' }, A)
    b.labels.saveObservation({ ...b.labels.getObservation(uuid(2), 0, 1)!, status: 'not-visible' }, B)
    a.labels.saveReviewInterval({ ...a.labels.getReviewInterval(uuid(1001))!, scanEndMm: 150 }, A)
    a.labels.saveFileAlignment({ ...a.labels.getFileAlignment(SHA_A)!, datumUMm: 3 }, A)
    b.labels.savePhysicalDefect({ ...b.labels.getPhysicalDefect('TP01', 'D1')!, note: 'B 메모' }, B)
    const r = importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    expect(r.byEntity.observation.conflicts).toBe(1)
    expect(r.byEntity['review-interval'].updated).toBe(1)
    expect(r.byEntity['file-alignment'].updated).toBe(1)
    expect(r.byEntity['physical-defect'].unchanged).toBe(1)
    expect(b.labels.getObservation(uuid(2), 0, 1)?.status).toBe('not-visible')
    expect(b.labels.getReviewInterval(uuid(1001))?.scanEndMm).toBe(150)
    expect(b.labels.listConflicts()[0]).toMatchObject({ entity: 'observation', sha256: SHA_A })
  })

  it('작업 이벤트: 같은 UUID 에 다른 내용이면 충돌로 보관하고 내 것을 둔다', () => {
    const a = memCatalog()
    const b = memCatalog()
    a.labels.appendWorkEvent(event(1))
    b.labels.appendWorkEvent(event(1, { kind: 'file-close' }))
    const r = importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    expect(r.byEntity['work-event'].conflicts).toBe(1)
    expect(b.labels.listWorkEvents()[0]?.kind).toBe('file-close')
  })

  it('라벨러 정보가 다르면 이 PC 것을 두고 경고한다', () => {
    const a = memCatalog()
    const b = memCatalog()
    a.labels.registerLabeler({ id: 'kim', name: '김판독', qualification: 'L2', organization: null })
    b.labels.registerLabeler({ id: 'kim', name: '김판독', qualification: 'L3', organization: null })
    const r = importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    expect(r.byEntity.labeler.unchanged).toBe(1)
    expect(r.warnings.join()).toContain("라벨러 'kim'")
    expect(b.labels.getLabeler('kim')?.qualification).toBe('L3')
  })
})

describe('충돌 보관 사본의 전달과 해결', () => {
  /** A·B 가 기록 2 를 따로 고쳐 B 에 충돌 하나 */
  function conflicted(): { a: Catalog; b: Catalog; text: string; conflictId: number } {
    const a = memCatalog()
    const b = memCatalog()
    a.labels.saveRecord(rec(2), A)
    importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    a.labels.saveRecord({ ...a.labels.getRecord(uuid(2))!, note: 'A 판단', existenceConfidence: 'probable' }, A)
    b.labels.saveRecord({ ...b.labels.getRecord(uuid(2))!, note: 'B 판단' }, B)
    const text = exportLabelsJson(a, { kind: 'all' }, HEAD('pc-a'))
    const r = importLabels(b, text)
    return { a, b, text, conflictId: r.conflictItems[0]!.conflictId }
  }

  it('내보내기에 풀지 않은 충돌 사본이 들어가고(내 것 먼저), 빈 PC 로 가져가면 같은 상태가 된다', () => {
    const { b } = conflicted()
    const exp = exportLabels(b, { kind: 'all' }, HEAD('pc-b'))
    expect(exp.records.map((r) => [r.uuid, r.note])).toEqual([
      [uuid(2), 'B 판단'],
      [uuid(2), 'A 판단']
    ])
    expect(parseLabelExportJson(serializeLabelExport(exp)).warnings.join()).toContain('같은 UUID')
    expect(exportLabels(b, { kind: 'all' }, { ...HEAD('pc-b'), includeConflicts: false }).records.length).toBe(1)
    const c = memCatalog()
    const r = importLabels(c, exp)
    expect([r.byEntity.record.created, r.byEntity.record.conflicts]).toEqual([1, 1])
    expect(c.labels.getRecord(uuid(2))?.note).toBe('B 판단')
    expect((c.labels.listConflicts()[0]!.theirs as IndicationRecord).note).toBe('A 판단')
    expect(exportLabels(c, { kind: 'all' }, HEAD('pc-b'))).toEqual(exp)
  })

  it("'내 것': 내 것을 두고 버전을 합쳐 1 올린다. 다시 가져와도 충돌이 되살아나지 않고, A 로 가져가면 A 가 바뀐다", () => {
    const { a, b, text, conflictId } = conflicted()
    const out = resolveLabelConflict(b, conflictId, 'mine', B)
    expect(out.conflict).toMatchObject({ resolution: 'mine' })
    expect(out.conflict.resolvedAt).not.toBeNull()
    const v = b.labels.getRecord(uuid(2))!
    expect(v.note).toBe('B 판단')
    expect(v.versions).toEqual([
      { pcId: 'pc-a', edits: 2 },
      { pcId: 'pc-b', edits: 2 }
    ])
    expect(v.revision).toBe(4)
    expect(b.labels.pendingConflictCount()).toBe(0)
    const again = importLabels(b, text)
    expect([again.conflicts, again.pendingConflicts]).toEqual([0, 0])
    const toA = importLabels(a, exportLabels(b, { kind: 'all' }, HEAD('pc-b')))
    expect(toA.byEntity.record.updated).toBe(1)
    expect(a.labels.getRecord(uuid(2))?.note).toBe('B 판단')
    expect(code(() => resolveLabelConflict(b, conflictId, 'mine', B))).toBe('CONFLICT')
  })

  it("'들어온 것': 들어온 내용으로 바꾸고 버전을 합쳐 1 올린다", () => {
    const { b, text, conflictId } = conflicted()
    resolveLabelConflict(b, conflictId, 'theirs', B)
    const v = b.labels.getRecord(uuid(2))!
    expect([v.note, v.existenceConfidence, v.pcId]).toEqual(['A 판단', 'probable', 'pc-b'])
    expect(v.versions).toEqual([
      { pcId: 'pc-a', edits: 2 },
      { pcId: 'pc-b', edits: 2 }
    ])
    expect(importLabels(b, text).conflicts).toBe(0)
  })

  it("'둘 다': 내 것을 두고 들어온 것은 새 UUID 의 새 기록으로 넣는다", () => {
    const { b, text, conflictId } = conflicted()
    const out = resolveLabelConflict(b, conflictId, 'both', { ...B, newUuid: () => uuid(777) })
    expect(out.conflict).toMatchObject({ resolution: 'both', resolvedNewKey: uuid(777) })
    expect(b.labels.getRecord(uuid(2))?.note).toBe('B 판단')
    const copy = b.labels.getRecord(uuid(777))!
    expect([copy.note, copy.revision, copy.pcId]).toEqual(['A 판단', 1, 'pc-b'])
    expect(copy.versions).toEqual([{ pcId: 'pc-b', edits: 1 }])
    expect(b.labels.listRecords({ sha256: SHA_A }).length).toBe(2)
    const again = importLabels(b, text)
    expect([again.conflicts, again.created]).toEqual([0, 0])
  })

  it('해결 제한: 파일 정렬은 둘 다 못 남기고, 작업 이벤트는 들어온 것을 고를 수 없다', () => {
    const a = memCatalog()
    const b = memCatalog()
    a.labels.saveFileAlignment(alignment(), A)
    importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    a.labels.saveFileAlignment({ ...a.labels.getFileAlignment(SHA_A)!, datumUMm: 1 }, A)
    b.labels.saveFileAlignment({ ...b.labels.getFileAlignment(SHA_A)!, datumUMm: 2 }, B)
    a.labels.appendWorkEvent(event(1))
    b.labels.appendWorkEvent(event(1, { kind: 'file-close' }))
    const r = importLabels(b, exportLabels(a, { kind: 'all' }, HEAD('pc-a')))
    const align = r.conflictItems.find((x) => x.entity === 'file-alignment')!
    const ev = r.conflictItems.find((x) => x.entity === 'work-event')!
    expect(code(() => resolveLabelConflict(b, align.conflictId, 'both', B))).toBe('INVALID_ARGUMENT')
    expect(code(() => resolveLabelConflict(b, ev.conflictId, 'theirs', B))).toBe('INVALID_ARGUMENT')
    resolveLabelConflict(b, align.conflictId, 'theirs', B)
    expect(b.labels.getFileAlignment(SHA_A)?.datumUMm).toBe(1)
    resolveLabelConflict(b, ev.conflictId, 'both', { ...B, newUuid: () => uuid(888) })
    expect(b.labels.listWorkEvents().map((e) => [e.uuid, e.kind])).toEqual([
      [uuid(5001), 'file-close'],
      [uuid(888), 'file-open']
    ])
    expect(code(() => resolveLabelConflict(b, 9999, 'mine', B))).toBe('NOT_FOUND')
  })

  it('다른 PC 가 푼 결과가 들어오면 남은 충돌이 저절로 닫힌다(superseded)', () => {
    const { b } = conflicted()
    // C 는 B 의 충돌 상태를 그대로 받음
    const c = memCatalog()
    importLabels(c, exportLabels(b, { kind: 'all' }, HEAD('pc-b')))
    expect(c.labels.pendingConflictCount()).toBe(1)
    // B 가 '내 것'으로 풀고 내보냄 → C 로
    resolveLabelConflict(b, b.labels.listConflicts()[0]!.id, 'mine', B)
    const r = importLabels(c, exportLabels(b, { kind: 'all' }, HEAD('pc-b')))
    expect(r.byEntity.record.updated).toBe(1)
    expect(r.pendingConflicts).toBe(0)
    expect(c.labels.listConflicts({ pendingOnly: false })[0]).toMatchObject({ resolution: 'superseded' })
    expect(c.labels.getRecord(uuid(2))?.note).toBe('B 판단')
  })
})

describe('검토 반영: 병합 안전장치', () => {
  const file = (c: Catalog, pcId = 'pc-a'): LabelExportFile => exportLabels(c, { kind: 'all' }, HEAD(pcId))

  it('같은 UUID 인데 라벨러(라벨 세트)가 다른 기록은 가져오기 전체를 막는다', () => {
    const a = memCatalog()
    a.labels.saveRecord(rec(1), A)
    const b = memCatalog()
    importLabels(b, file(a))
    const moved = { ...rec(1), labelerId: 'lee', versions: [{ pcId: 'pc-a', edits: 1 }, { pcId: 'pc-x', edits: 1 }], revision: 2 }
    const f = { ...file(a), records: [moved] }
    const r = importLabels(b, f)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('다른 라벨 세트로 옮길 수 없어')
    expect(b.labels.getRecord(uuid(1))?.labelerId).toBe('kim')
  })

  it("작업 이벤트 충돌을 '내 것'으로 풀면 같은 JSON 을 다시 가져와도 다시 묻지 않고, '둘 다'는 사본을 한 번만 만든다", () => {
    const a = memCatalog()
    a.labels.appendWorkEvent(event(1))
    const b = memCatalog()
    b.labels.appendWorkEvent({ ...event(1), detail: { note: 'B 에서 다름' } })
    const r1 = importLabels(b, file(a))
    expect(r1.conflicts).toBe(1)
    resolveLabelConflict(b, r1.conflictItems[0]!.conflictId, 'mine', B)
    const again = importLabels(b, file(a))
    expect(again).toMatchObject({ ok: true, conflicts: 0, pendingConflicts: 0 })

    const c = memCatalog()
    c.labels.appendWorkEvent({ ...event(1), detail: { note: 'C 에서 다름' } })
    const first = importLabels(c, file(a))
    resolveLabelConflict(c, first.conflictItems[0]!.conflictId, 'both', B)
    for (let i = 0; i < 3; i++) expect(importLabels(c, file(a)).conflicts).toBe(0)
    expect(c.labels.listWorkEvents()).toHaveLength(2)
  })

  it('관측 행 충돌에도 그 기록의 라벨러가 붙는다 (2인 모드에서 숨기고 막기 위해)', () => {
    const a = memCatalog()
    a.labels.saveRecord(rec(1, { labelerId: 'lee' }), A)
    a.labels.saveObservation(obs(1, 0, 2, { status: 'visible' }), A)
    const b = memCatalog()
    importLabels(b, file(a))
    const ob = b.labels.getObservation(uuid(1), 0, 2)!
    b.labels.saveObservation({ ...ob, status: 'weak' }, B)
    const oa = a.labels.getObservation(uuid(1), 0, 2)!
    a.labels.saveObservation({ ...oa, status: 'not-visible' }, A)
    const r = importLabels(b, file(a))
    expect(r.byEntity.observation.conflicts).toBe(1)
    expect(b.labels.listConflicts()[0]).toMatchObject({ entity: 'observation', labelerId: 'lee', sha256: SHA_A })
  })

  it('물리 결함의 시편 ID 는 대소문자를 가리지 않는다 (TP01 = tp01)', () => {
    const c = memCatalog()
    c.labels.savePhysicalDefect(defect('D1', { specimenId: 'TP01' }), A)
    expect(c.labels.getPhysicalDefect('tp01', 'D1')?.specimenId).toBe('TP01')
    const r = c.labels.savePhysicalDefect({ ...c.labels.getPhysicalDefect('tp01', 'D1')!, specimenId: 'tp01', note: '같은 결함' }, A)
    expect(r.changed).toBe(true)
    expect(c.labels.listPhysicalDefects({ includeDeleted: true })).toHaveLength(1)
  })
})

describe('검토 반영: 버전 칸 (복제본)', () => {
  it('저장소마다 다른 칸을 쓰므로, 같은 PC ID 로 두 저장소에서 고친 값은 덮어쓰기가 아니라 충돌이 된다', () => {
    const one = memCatalog()
    const slot1 = one.labels.replica('pc-lab').slot
    one.labels.saveRecord(rec(1), { pcId: 'pc-lab', versionSlot: slot1 })
    const two = memCatalog()
    importLabels(two, exportLabels(one, { kind: 'all' }, HEAD('pc-lab')))
    const slot2 = two.labels.replica('pc-lab').slot
    expect(slot2).not.toBe(slot1)
    expect(slot1).toMatch(/^pc-lab:[0-9a-f]{8}$/)
    const r1 = one.labels.getRecord(uuid(1))!
    one.labels.saveRecord({ ...r1, defectType: 'crack-root', note: '저장소1 판정' }, { pcId: 'pc-lab', versionSlot: slot1 })
    let r2 = two.labels.getRecord(uuid(1))!
    r2 = two.labels.saveRecord({ ...r2, note: '저장소2 메모1' }, { pcId: 'pc-lab', versionSlot: slot2 }).value
    two.labels.saveRecord({ ...r2, note: '저장소2 메모2' }, { pcId: 'pc-lab', versionSlot: slot2 })
    const r = importLabels(one, exportLabels(two, { kind: 'all' }, HEAD('pc-lab')))
    expect(r).toMatchObject({ ok: true, conflicts: 1, updated: 0 })
    expect(one.labels.getRecord(uuid(1))?.defectType).toBe('crack-root')
    // 기록의 '마지막으로 고친 PC' 는 PC ID 그대로
    expect(one.labels.getRecord(uuid(1))?.pcId).toBe('pc-lab')
  })

  it('복제본은 PC ID 마다 이어 쓰고, 바꿔 달라면 새 칸. 다른 PC 이름이 기록에 있으면 알려 준다', () => {
    const c = memCatalog()
    const a1 = c.labels.replica('pc-a')
    expect(c.labels.replica('pc-a')).toMatchObject({ id: a1.id, created: false })
    const a2 = c.labels.rotateReplica('pc-a')
    expect(a2.id).not.toBe(a1.id)
    expect(c.labels.replica('pc-a').id).toBe(a2.id)
    expect(c.labels.ownReplicaIds()).toEqual([a1.id, a2.id])
    const before = c.labels.writeCount()
    c.labels.saveRecord(rec(1), { pcId: 'pc-a', versionSlot: a2.slot })
    expect(c.labels.writeCount()).toBeGreaterThan(before)
    expect(c.labels.pcIdUsedElsewhere('pc-a')).toBe(false)
    const other = memCatalog()
    other.labels.saveRecord(rec(2), { pcId: 'pc-b', versionSlot: other.labels.replica('pc-b').slot })
    importLabels(c, exportLabels(other, { kind: 'all' }, HEAD('pc-b')))
    expect(c.labels.pcIdUsedElsewhere('pc-b')).toBe(true)
    expect(c.labels.pcIdUsedElsewhere('pc-c')).toBe(false)
  })
})
