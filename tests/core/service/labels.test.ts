/**
 * 라벨 서비스 E2E (Electron 없이 core 서비스만, 'labels:*' 계약).
 * 임시 저장소 A·B 에 X3 실데이터 4개를 가져온 뒤(원본은 읽기만):
 *   엑셀 픽스처 미리보기·확정 → 목록 → 같은 엑셀 재확정 멱등 → JSON 내보내기 → 새 저장소에 가져오기(같음)
 *   → 고친 엑셀(고침·빠진 줄) → JSON 충돌·해결 → 2인 독립 모드 → 작업 이벤트 → PC ID.
 * 작업 잠금: NDE 가져오기 중에도 라벨 작업은 되고, 라벨 작업 중에는 저장소를 바꿀 수 없다.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAppService, isWorkbookUuid, type AppService } from '@core/service'
import { LABEL_SHEETS, columnsOf, sheetHeaders, type LabelSheetId } from '@shared/labels'
import type { IndicationRecord } from '@shared/labels/types'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { X3_FILES } from '../../paths'
import { buildXlsx, fixture, type KitCell } from '../labels/xlsxKit'

const hasData = X3_FILES.every((f) => existsSync(f))

const work = mkdtempSync(join(tmpdir(), 'paut-labels-svc-'))
const storeA = join(work, '저장소A')
const storeB = join(work, '저장소B')
let a: AppService
let b: AppService

function acceptAll(p: ImportPreview): ImportCommitRequest {
  return {
    previewId: p.previewId,
    newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
    items: p.items
      .filter((i) => i.verdict === 'match-existing' || i.verdict === 'new-plan')
      .map((i) => ({
        itemId: i.itemId,
        include: true,
        specimenId: i.suggestedSpecimenId ?? 'X',
        specimenSource: i.suggestedSpecimenSource ?? 'manual',
        stateTag: i.suggestedStateTag,
        round: i.suggestedRound,
        memo: ''
      }))
  }
}

async function importX3(s: AppService, store: string): Promise<void> {
  await s.setStoreRoot(store)
  const r = await s.commit(acceptAll(await s.analyze(X3_FILES)))
  expect(r).toMatchObject({ copiedCount: 4, failedCount: 0 })
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'OK'
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

type Rows = Partial<Record<LabelSheetId, Array<Record<string, KitCell>>>>

/** columns.ts 머리글로 양식 모양 엑셀을 만들어 파일로 쓴다 */
function writeWorkbook(name: string, rows: Rows): string {
  const buf = buildXlsx(
    LABEL_SHEETS.map((s) => {
      const keys = columnsOf(s.id).map((c) => c.key)
      return { name: s.name, rows: [sheetHeaders(s.id) as KitCell[], ...(rows[s.id] ?? []).map((r) => keys.map((k) => r[k] ?? null))] }
    })
  )
  const path = join(work, name)
  writeFileSync(path, buf)
  return path
}

const F1 = '12T-SV-01-Cap on.nde'
const PARK = [{ labelerId: 'park-l3', readingStage: '확정 (Level III)', readerSource: '전문기관', organization: '○○검사', qualification: 'PAUT Level III' }]
const parkRow = (ref: number, start: number, end: number): Record<string, KitCell> => ({
  fileName: F1,
  externalRef: ref,
  kind: '결함',
  group: '섹토리얼 Skew 270',
  scanStartMm: start,
  scanEndMm: end,
  maxAmplitudePct: 90,
  defectType: '슬래그',
  existenceConfidence: '보통'
})

beforeAll(() => {
  a = createAppService({ settingsPath: join(work, 'settings-a.json') })
  b = createAppService({ settingsPath: join(work, 'settings-b.json') })
})

afterAll(() => {
  a?.close()
  b?.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!hasData)('라벨 서비스: 엑셀 · JSON · 충돌 (X3 4개 파일)', () => {
  let file1Id = 0
  let exportA = ''

  it('X3 4개를 가져오고, PC ID 가 처음 부를 때 생긴다', async () => {
    await importX3(a, storeA)
    const s = await a.labels.session()
    expect(s.pcId).toMatch(/^pc-[0-9a-f]{8}$/)
    expect(s).toMatchObject({ labelerId: null, labeler: null, blindMode: false, labelers: [] })
    expect((await a.labels.session()).pcId).toBe(s.pcId)
    expect(JSON.parse(readFileSync(join(work, 'settings-a.json'), 'utf8')).pcId).toBe(s.pcId)
    const files = await a.listFiles({ limit: 10, sort: 'fileName-asc' })
    file1Id = files.items.find((f) => f.storedFileName === F1)!.id
  })

  it('NDE 가져오기 작업 중에도 라벨 작업이 되고, 라벨 작업 중에는 저장소를 바꿀 수 없다', async () => {
    const analyzing = a.analyze(X3_FILES)
    expect(a.activeOperation()).not.toBeNull()
    const ov = await a.labels.overview()
    expect(ov.files).toHaveLength(4)
    await analyzing
    const preview = a.labels.previewWorkbook(fixture('x3_blind_kim.xlsx'))
    expect(a.labels.busy()).toBe(true)
    expect(await code(a.setStoreRoot(storeB))).toBe('BUSY')
    await preview
    expect(a.labels.busy()).toBe(false)
  })

  it('엑셀 미리보기: 시트별 줄 수 · 맞춘 파일(원본·장비 원본 파일명) · 확정하면 일어날 일', async () => {
    const pv = await a.labels.previewWorkbook(fixture('x3_blind_kim.xlsx'))
    expect(pv.errors).toEqual([])
    expect(pv.ok).toBe(true)
    expect(pv.reader).toMatchObject({ id: 'kim-l2', readingStage: 'blind', guidelineVersion: 'v1', registered: false })
    expect(pv.files.map((f) => [f.fileName, f.records, f.reviews, f.alignment, f.fileId !== null])).toEqual([
      ['12T-SV-01-Cap on.nde', 3, 2, true, true],
      ['12T-SV-02-Cap on.nde', 2, 1, true, true],
      ['12T-SV-03-Cap off.nde', 2, 1, true, true],
      ['12T-SV-04-Cap on.nde', 2, 1, true, true]
    ])
    expect(pv.labelSets).toHaveLength(4)
    expect(pv.sheets.find((x) => x.sheet === 'reader')?.rows).toBe(1)
    expect(pv.sheets.find((x) => x.sheet === 'indication')?.rows).toBe(9)
    expect(pv.plan.record).toMatchObject({ create: 9, update: 0, unchanged: 0 })
    expect(pv.plan['review-interval'].create).toBe(5)
    expect(pv.plan['work-event'].create).toBe(10)
    expect(pv.plan['file-alignment'].create).toBe(4)
    expect(pv.totals).toEqual({ create: 28, update: 0, unchanged: 0, kept: 0, conflict: 0, remove: 0 })
    expect(pv.warnings.some((w) => w.includes("'지시' 시트 11행"))).toBe(true)
    // 확정 전에는 아무것도 쓰지 않는다
    expect(await a.labels.listRecords()).toEqual([])
  })

  it('확정 → 라벨러 등록, 파일별 현황, 기록 목록', async () => {
    const pv = await a.labels.previewWorkbook(fixture('x3_blind_kim.xlsx'))
    const r = await a.labels.commitWorkbook(pv.previewId)
    expect(r.totals.create).toBe(28)
    expect(r).toMatchObject({ registeredLabelerId: 'kim-l2', conflictIds: [], pendingConflicts: 0 })
    expect(await code(a.labels.commitWorkbook(pv.previewId))).toBe('PREVIEW_EXPIRED')

    const ov = await a.labels.overview()
    expect(ov.session.labelers.map((l) => l.id)).toEqual(['kim-l2'])
    expect(ov.setCount).toBe(4)
    const f1 = ov.files.find((f) => f.fileId === file1Id)!
    expect(f1).toMatchObject({ planId: 'SP001', specimenId: 'PL23833', stateTag: 'Cap on' })
    expect(f1.sets).toHaveLength(1)
    expect(f1.sets[0]).toMatchObject({
      labelerId: 'kim-l2',
      labelerName: 'kim-l2',
      readingStage: 'blind',
      recordCount: 3,
      defectCount: 2,
      echoCount: 1,
      imperfectionCount: 0,
      reviewIntervalCount: 2,
      reviewedLengthMm: 300
    })
    const recs = await a.labels.listRecords({ fileId: file1Id })
    expect(recs.map((x) => [x.externalRef, x.kind, x.coordSource])).toEqual([
      ['3', 'geometric-echo', 'imported-mm'],
      ['1', 'defect', 'imported-mm'],
      ['2', 'defect', 'imported-mm']
    ])
    expect(recs.every((x) => isWorkbookUuid(x.uuid))).toBe(true)
    expect((await a.labels.listReviews({ fileId: file1Id })).map((v) => v.groupId)).toEqual([0, 1])
    expect(await a.labels.listSets({ fileId: file1Id })).toEqual(f1.sets)
  })

  it('같은 엑셀을 다시 확정해도 바뀌는 것이 없다 (멱등)', async () => {
    const before = await a.labels.listRecords({ includeDeleted: true })
    const pv = await a.labels.previewWorkbook(fixture('x3_blind_kim.xlsx'))
    expect(pv.totals).toEqual({ create: 0, update: 0, unchanged: 28, kept: 0, conflict: 0, remove: 0 })
    expect(pv.reader?.registered).toBe(true)
    const r = await a.labels.commitWorkbook(pv.previewId)
    expect(r.totals.unchanged).toBe(28)
    expect(await a.labels.listRecords({ includeDeleted: true })).toEqual(before)
  })

  it('오류가 있는 엑셀은 미리보기만 되고 확정은 막는다', async () => {
    const pv = await a.labels.previewWorkbook(fixture('x3_errors.xlsx'))
    expect(pv.ok).toBe(false)
    expect(pv.errors.length).toBeGreaterThan(5)
    expect(await code(a.labels.commitWorkbook(pv.previewId))).toBe('INVALID_ARGUMENT')
    expect(await code(a.labels.previewWorkbook(join(work, '없는 파일.xlsx')))).toBe('NOT_FOUND')
  })

  it('JSON 내보내기 → 새 저장소에 가져오기 → 같은 기록, 다시 가져오면 모두 그대로', async () => {
    const name = await a.labels.exportFileName({ kind: 'all' })
    expect(name).toMatch(/^라벨_전체_\d{8}-\d{4}_pc-[0-9a-f]{8}\.json$/)
    expect(await a.labels.exportFileName({ kind: 'files', sha256s: ['ab'.repeat(32)] })).toMatch(/^라벨_파일1개_/)
    exportA = join(work, '내보내기', name)
    const ex = await a.labels.exportJsonFile({ kind: 'all' }, exportA, '0.1.0-test')
    expect(ex.counts).toEqual({ labelers: 1, physicalDefects: 0, fileAlignments: 4, records: 9, observations: 0, reviewIntervals: 5, workEvents: 10 })
    expect(ex.bytes).toBe(readFileSync(exportA).length)

    await importX3(b, storeB)
    const imp = await b.labels.importJsonFile(exportA)
    expect(imp.ok).toBe(true)
    expect(imp.errors).toEqual([])
    expect(imp).toMatchObject({ created: 29, updated: 0, conflicts: 0, pendingConflicts: 0, source: { pcId: ex.pcId, appVersion: '0.1.0-test' } })
    expect(await b.labels.listRecords({ includeDeleted: true })).toEqual(await a.labels.listRecords({ includeDeleted: true }))
    expect(await b.labels.listReviews({ includeDeleted: true })).toEqual(await a.labels.listReviews({ includeDeleted: true }))
    const strip = (o: Awaited<ReturnType<AppService['labels']['overview']>>): unknown =>
      o.files.map((f) => ({ ...f, fileId: null, sets: f.sets.map((x) => ({ ...x, fileId: null, lastStoredAt: null })) }))
    expect(strip(await b.labels.overview())).toEqual(strip(await a.labels.overview()))

    // B 에서 내보낸 기록 = A 에서 내보낸 기록
    const exB = join(work, '내보내기', 'b.json')
    await b.labels.exportJsonFile({ kind: 'all' }, exB, '0.1.0-test')
    const [ja, jb] = [exportA, exB].map((p) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>)
    for (const k of ['records', 'reviewIntervals', 'workEvents', 'fileAlignments', 'labelers']) expect(jb![k], k).toEqual(ja![k])

    const again = await b.labels.importJsonFile(exportA)
    expect(again).toMatchObject({ ok: true, created: 0, updated: 0, conflicts: 0, unchanged: 29 })
    // 파일 하나만 내보내기
    const one = await a.labels.exportJsonFile(
      { kind: 'files', sha256s: [(await a.getFile(file1Id)).meta.sha256] },
      join(work, '내보내기', 'one.json'),
      '0.1.0-test'
    )
    expect(one.counts).toMatchObject({ records: 3, reviewIntervals: 2, fileAlignments: 1 })
  })

  it('고친 엑셀을 다시 확정: 엑셀 값으로 고치고, 빠진 줄은 지움 표시, 다른 사람의 파일 정렬은 충돌', async () => {
    const v1 = writeWorkbook('park_v1.xlsx', {
      reader: PARK,
      file: [{ fileName: F1, direction: 1, thicknessMm: 12, alignmentAssumed: false }],
      indication: [parkRow(7, 30, 40), parkRow(8, 120, 130)]
    })
    const pv1 = await a.labels.previewWorkbook(v1)
    expect(pv1.errors).toEqual([])
    expect(pv1.plan.record.create).toBe(2)
    // kim 이 적은 파일 정렬과 값이 달라 충돌
    expect(pv1.plan['file-alignment']).toMatchObject({ conflict: 1 })
    const c1 = await a.labels.commitWorkbook(pv1.previewId)
    expect(c1.conflictIds).toHaveLength(1)
    expect(c1.registeredLabelerId).toBe('park-l3')
    const set = c1.labelSets[0]!
    expect(set).toMatchObject({ labelerId: 'park-l3', readingStage: 'final' })

    const v2 = writeWorkbook('park_v2.xlsx', {
      reader: PARK,
      file: [{ fileName: F1, direction: 1, thicknessMm: 12, alignmentAssumed: false }],
      indication: [parkRow(7, 30, 44)]
    })
    const pv2 = await a.labels.previewWorkbook(v2)
    expect(pv2.plan.record).toMatchObject({ update: 1, remove: 1, create: 0 })
    // 같은 충돌은 다시 만들지 않는다 (풀지 않은 채 있음)
    expect(pv2.plan['file-alignment'].conflict).toBe(1)
    expect(pv2.warnings.some((w) => w.startsWith('엑셀에서 빠져 지움 표시할 지시 기록 1건'))).toBe(true)
    const c2 = await a.labels.commitWorkbook(pv2.previewId)
    expect(c2.conflictIds).toEqual([])
    const all = await a.labels.listRecords({ set, includeDeleted: true })
    const r7 = all.find((r) => r.externalRef === '7')!
    const r8 = all.find((r) => r.externalRef === '8')!
    const { pcId: pcA, versionSlot: slotA } = await a.labels.session()
    expect(slotA).toMatch(new RegExp(`^${pcA}:[0-9a-f]{8}$`))
    expect(r7).toMatchObject({ deleted: false, derived: { scanStartMm: 30, scanEndMm: 44 }, versions: [{ pcId: slotA, edits: 2 }], revision: 2, pcId: pcA })
    expect(r8).toMatchObject({ deleted: true, versions: [{ pcId: slotA, edits: 2 }] })
    expect(await a.labels.listRecords({ set })).toHaveLength(1)
    // 다시 확정해도 그대로
    const pv3 = await a.labels.previewWorkbook(v2)
    expect(pv3.plan.record).toMatchObject({ unchanged: 1, update: 0, remove: 0 })

    // 파일 정렬 충돌을 '내 것'으로 풀면 같은 엑셀을 다시 가져와도 묻지 않는다
    const conflicts = await a.labels.listConflicts()
    expect(conflicts.map((c) => [c.entity, c.fileName, c.choices])).toEqual([['file-alignment', F1, ['mine', 'theirs']]])
    expect(conflicts[0]!.mine).toMatchObject({ enteredBy: 'kim-l2' })
    expect(conflicts[0]!.theirs).toMatchObject({ enteredBy: 'park-l3' })
    expect(await code(a.labels.resolveConflict(conflicts[0]!.id, 'both'))).toBe('INVALID_ARGUMENT')
    const res = await a.labels.resolveConflict(conflicts[0]!.id, 'mine')
    expect(res).toMatchObject({ pendingConflicts: 0, conflict: { resolution: 'mine' } })
    const pv4 = await a.labels.previewWorkbook(v2)
    expect(pv4.plan['file-alignment']).toMatchObject({ conflict: 0, kept: 1 })
  })

  it('두 PC 에서 따로 고친 기록 → JSON 가져오기 충돌 → 들어온 것으로 해결 → 되돌려 보내면 합쳐진다', async () => {
    await a.labels.setSession({ labelerId: 'kim-l2' })
    const pick = async (s: AppService): Promise<IndicationRecord> => (await s.labels.listRecords({ fileId: file1Id })).find((r) => r.externalRef === '1')!
    const ra = await pick(a)
    const saved = await a.labels.saveRecord({ ...ra, note: 'A 에서 고침' })
    expect(saved.changed).toBe(true)
    // 메모만 고친 것은 검토 완료 구간을 풀지 않는다 (위치·길이·구분이 바뀔 때만)
    expect(saved.releasedReviews).toEqual([])
    // 옛 versions 로 다시 저장하면 CONFLICT
    expect(await code(a.labels.saveRecord({ ...ra, note: '옛 값' }))).toBe('CONFLICT')

    const rb = await pick(b)
    await b.labels.saveRecord({ ...rb, note: 'B 에서 고침' })
    const exB = join(work, '내보내기', 'b2.json')
    await b.labels.exportJsonFile({ kind: 'all' }, exB, '0.1.0-test')
    const imp = await a.labels.importJsonFile(exB)
    expect(imp.ok).toBe(true)
    expect(imp.byEntity.record.conflicts).toBe(1)
    const list = await a.labels.listConflicts({ fileId: file1Id })
    const c = list.find((x) => x.entity === 'record')!
    expect(c).toMatchObject({ labelerId: 'kim-l2', fileId: file1Id, choices: ['mine', 'theirs', 'both'] })
    expect((c.mine as IndicationRecord).note).toBe('A 에서 고침')
    expect((c.theirs as IndicationRecord).note).toBe('B 에서 고침')
    const ov = await a.labels.overview()
    expect(ov.files.find((f) => f.fileId === file1Id)?.pendingConflicts).toBeGreaterThan(0)

    const res = await a.labels.resolveConflict(c.id, 'theirs')
    expect(res.conflict.resolution).toBe('theirs')
    expect((await pick(a)).note).toBe('B 에서 고침')
    expect(await code(a.labels.resolveConflict(c.id, 'mine'))).toBe('CONFLICT')

    const exA = join(work, '내보내기', 'a2.json')
    await a.labels.exportJsonFile({ kind: 'all' }, exA, '0.1.0-test')
    const back = await b.labels.importJsonFile(exA)
    expect(back).toMatchObject({ ok: true, conflicts: 0 })
    expect(await pick(b)).toEqual(await pick(a))
  })

  it('2인 독립 모드: 지금 라벨러 세트만 보이고 다른 라벨러 기록은 고칠 수 없다', async () => {
    const s = await a.labels.setSession({ labelerId: 'kim-l2', blindMode: true })
    expect(s).toMatchObject({ labelerId: 'kim-l2', blindMode: true, labeler: { id: 'kim-l2' } })
    const ov = await a.labels.overview()
    expect(ov.hiddenSetCount).toBe(1)
    expect(ov.files.flatMap((f) => f.sets).every((x) => x.labelerId === 'kim-l2')).toBe(true)
    const visible = await a.labels.listRecords({ includeDeleted: true })
    expect(visible.every((r) => r.labelerId === 'kim-l2')).toBe(true)

    await a.labels.setSession({ blindMode: false })
    const park = (await a.labels.listRecords()).find((r) => r.labelerId === 'park-l3')!
    await a.labels.setSession({ blindMode: true })
    expect(await code(a.labels.saveRecord({ ...park, note: 'x' }))).toBe('INVALID_ARGUMENT')
    expect(await code(a.labels.deleteRecord(park.uuid))).toBe('INVALID_ARGUMENT')
    expect(await code(a.labels.setSession({ labelerId: '없는-라벨러' }))).toBe('INVALID_ARGUMENT')
    // 라벨러를 고르지 않으면 2인 모드에서는 아무 세트도 보이지 않는다
    await a.labels.setSession({ labelerId: null })
    expect((await a.labels.overview()).setCount).toBe(0)
    await a.labels.setSession({ labelerId: 'kim-l2', blindMode: false })
    expect((await a.labels.overview()).hiddenSetCount).toBe(0)
  })

  it('라벨러 등록 · 작업 이벤트 추가 · 관측 표 · 검토 구간 저장', async () => {
    expect(await code(a.labels.registerLabeler({ id: '', name: 'x', qualification: null, organization: null }))).toBe('INVALID_ARGUMENT')
    const lee = await a.labels.registerLabeler({ id: 'lee-l2', name: '이 판독', qualification: 'Level II', organization: null })
    expect(lee).toMatchObject({ id: 'lee-l2', name: '이 판독' })
    const sha = (await a.getFile(file1Id)).meta.sha256
    const e = await a.labels.appendWorkEvent({ kind: 'file-open', sessionId: 's-1', sha256: sha, readingStage: 'blind' })
    const pc = (await a.labels.session()).pcId
    expect(e).toMatchObject({ kind: 'file-open', sessionId: 's-1', labelerId: 'kim-l2', pcId: pc, tool: 'app', sha256: sha })
    expect(e.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(await code(a.labels.appendWorkEvent({ kind: 'file-open', sessionId: 's-1', labelerId: '모르는' }))).toBe('INVALID_ARGUMENT')

    const rec = (await a.labels.listRecords({ fileId: file1Id })).find((r) => r.externalRef === '2')!
    const obs = await a.labels.saveObservation({
      recordUuid: rec.uuid,
      groupId: 0,
      leg: 2,
      projected: null,
      search: null,
      saturated: null,
      status: 'visible',
      expertConfirmed: true,
      coordRulesVersion: 1,
      revision: 1,
      versions: [],
      deleted: false,
      pcId: null
    })
    expect(obs.changed).toBe(true)
    expect(await a.labels.listObservations({ recordUuids: [rec.uuid] })).toEqual([obs.value])
    expect((await a.labels.deleteObservation(rec.uuid, 0, 2)).value.deleted).toBe(true)
    expect(await a.labels.listObservations({ fileId: file1Id })).toEqual([])

    const rv = (await a.labels.listReviews({ fileId: file1Id, kind: 'reviewed' }))[0]!
    const del = await a.labels.deleteReview(rv.uuid)
    expect(del.value.deleted).toBe(true)
    expect((await a.labels.listReviews({ fileId: file1Id, includeDeleted: true })).some((v) => v.uuid === rv.uuid && v.deleted)).toBe(true)
  })

  it('PC ID 바꾸기는 형식을 검사한다', async () => {
    expect(await code(a.updateSettings({ pcId: '' }))).toBe('INVALID_ARGUMENT')
    expect(await code(a.labels.setSession({ pcId: '공백 있음' }))).toBe('INVALID_ARGUMENT')
    const s = await a.labels.setSession({ pcId: '현장PC-1' })
    expect(s.pcId).toBe('현장PC-1')
    expect(await a.labels.exportFileName({ kind: 'all' })).toMatch(/_현장PC-1\.json$/)
  })
})

describe('라벨 서비스: 저장소가 없을 때', () => {
  it('NO_STORE_ROOT', async () => {
    const s = createAppService({ settingsPath: join(work, 'settings-none.json') })
    try {
      expect(await code(s.labels.overview())).toBe('NO_STORE_ROOT')
      expect(s.labels.busy()).toBe(false)
    } finally {
      s.close()
    }
  })
})
