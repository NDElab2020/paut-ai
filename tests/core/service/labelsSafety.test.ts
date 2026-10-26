/**
 * 라벨 서비스 — 검토 반영 안전장치 (X3 실데이터 4개를 임시 저장소에 가져온 뒤, 원본은 읽기만).
 *   엑셀 재가져오기 3-way: 앱에서 고친 기록은 덮지 않음 · 엑셀만 고친 줄은 고침 · 둘 다 고치면 충돌 · 번호가 바뀐 지시는 충돌
 *   엑셀이 지운 줄은 다시 나타나면 되살림 · '파일' 시트에만 남은 파일의 줄도 지움 표시 · 모르는 칸은 지킴
 *   버전 칸: 저장소마다 다름 · 다른 PC 이름으로 PC ID 바꾸기 거부 · 백업에서 되돌린 저장소는 새 칸
 *   2인 모드: 내보내기는 지금 라벨러 세트만 · 다른 라벨러 정보 고치기 거부 · 라벨러 덮어쓰기는 overwrite 일 때만
 *   미리보기: PC ID 가 바뀌면 PREVIEW_EXPIRED · 사본을 못 읽으면 원인을 맨 위 오류로
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAppService, type AppService } from '@core/service'
import { LABEL_SHEETS, columnsOf, sheetHeaders, type LabelSheetId } from '@shared/labels'
import type { IndicationRecord, LabelExportFile } from '@shared/labels/types'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { X3_FILES } from '../../paths'
import { buildXlsx, type KitCell } from '../labels/xlsxKit'

const hasData = X3_FILES.every((f) => existsSync(f))
const work = mkdtempSync(join(tmpdir(), 'paut-labels-safe-'))
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
const F2 = '12T-SV-02-Cap on.nde'
const READER = [{ labelerId: 'choi-l2', readingStage: '설계값 대조', readerSource: '우리 전문가', qualification: 'UT Level II' }]
const FILES = [
  { fileName: F1, direction: 1, thicknessMm: 12, alignmentAssumed: false },
  { fileName: F2, direction: 1, thicknessMm: 12, alignmentAssumed: false }
]
const row = (file: string, ref: number, start: number, end: number, extra: Record<string, KitCell> = {}): Record<string, KitCell> => ({
  fileName: file,
  externalRef: ref,
  kind: '결함',
  group: '섹토리얼 Skew 270',
  scanStartMm: start,
  scanEndMm: end,
  maxAmplitudePct: 90,
  defectType: '슬래그',
  existenceConfidence: '보통',
  ...extra
})

async function commitPath(s: AppService, path: string): Promise<Awaited<ReturnType<AppService['labels']['commitWorkbook']>>> {
  const pv = await s.labels.previewWorkbook(path)
  expect(pv.errors).toEqual([])
  return s.labels.commitWorkbook(pv.previewId)
}

const byRef = async (s: AppService, ref: string, includeDeleted = true): Promise<IndicationRecord | undefined> =>
  (await s.labels.listRecords({ includeDeleted })).find((r) => r.labelerId === 'choi-l2' && r.externalRef === ref)

beforeAll(async () => {
  if (!hasData) return
  a = createAppService({ settingsPath: join(work, 'ud-a', 'settings.json') })
  b = createAppService({ settingsPath: join(work, 'ud-b', 'settings.json') })
  await importX3(a, storeA)
  await importX3(b, storeB)
}, 60_000)

afterAll(() => {
  a?.close()
  b?.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!hasData)('엑셀 재가져오기 (3-way)', () => {
  it('앱에서 고친 기록은 같은 엑셀을 다시 확정해도 덮지 않는다', async () => {
    const v1 = writeWorkbook('v1.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 40), row(F1, 2, 120, 130), row(F2, 3, 50, 60)] })
    const c1 = await commitPath(a, v1)
    expect(c1.totals.create).toBeGreaterThan(0)
    await a.labels.setSession({ labelerId: 'choi-l2' })
    const r1 = (await byRef(a, '1'))!
    await a.labels.saveRecord({ ...r1, defectType: 'porosity-single', note: '전문가 대조 뒤 기공으로 고침' })

    const pv = await a.labels.previewWorkbook(v1)
    expect(pv.plan.record).toMatchObject({ update: 0, kept: 1, unchanged: 2 })
    expect(pv.changes).toEqual([
      expect.objectContaining({ action: 'kept', entity: 'record', name: `${F1} 지시 1`, reason: expect.stringContaining('앱·다른 PC 에서 고친 것이라') })
    ])
    await a.labels.commitWorkbook(pv.previewId)
    expect(await byRef(a, '1')).toMatchObject({ defectType: 'porosity-single', note: '전문가 대조 뒤 기공으로 고침' })
  })

  it('엑셀만 고친 줄은 고치고, 엑셀과 앱 둘 다 고친 줄은 충돌로 둘 다 보관한다', async () => {
    const v2 = writeWorkbook('v2.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 44), row(F1, 2, 120, 134), row(F2, 3, 50, 60)] })
    const pv = await a.labels.previewWorkbook(v2)
    expect(pv.plan.record).toMatchObject({ update: 1, conflict: 1, unchanged: 1 })
    expect(pv.changes.filter((c) => c.action !== 'kept').map((c) => [c.action, c.name])).toEqual([
      ['conflict', `${F1} 지시 1`],
      ['update', `${F1} 지시 2`]
    ])
    const r = await a.labels.commitWorkbook(pv.previewId)
    expect(r.conflictIds).toHaveLength(1)
    expect(await byRef(a, '1')).toMatchObject({ defectType: 'porosity-single', derived: { scanEndMm: 40 } })
    expect(await byRef(a, '2')).toMatchObject({ derived: { scanEndMm: 134 } })
    const [c] = (await a.labels.listConflicts()).filter((x) => x.entity === 'record')
    expect(c).toMatchObject({ sourceName: 'v2.xlsx', sourcePcId: null })
    expect((c!.theirs as IndicationRecord).derived.scanEndMm).toBe(44)
    // '내 것'으로 풀면 같은 엑셀을 다시 가져와도 묻지 않는다
    await a.labels.resolveConflict(c!.id, 'mine')
    const again = await a.labels.previewWorkbook(v2)
    expect(again.plan.record).toMatchObject({ conflict: 0, update: 0 })
  })

  it('엑셀에서 지운 줄은 지움 표시, 다시 적으면 되살린다', async () => {
    const v3 = writeWorkbook('v3.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 44), row(F2, 3, 50, 60)] })
    const pv3 = await a.labels.previewWorkbook(v3)
    expect(pv3.plan.record.remove).toBe(1)
    expect(pv3.files.find((f) => f.fileName === F1)?.removes).toBe(1)
    await a.labels.commitWorkbook(pv3.previewId)
    expect((await byRef(a, '2'))?.deleted).toBe(true)

    const v4 = writeWorkbook('v4.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 44), row(F1, 2, 120, 134), row(F2, 3, 50, 60)] })
    const pv4 = await a.labels.previewWorkbook(v4)
    expect(pv4.plan.record.update).toBe(1)
    expect(pv4.changes.some((c) => c.action === 'update' && c.reason.includes('되살릴'))).toBe(true)
    await a.labels.commitWorkbook(pv4.previewId)
    expect(await byRef(a, '2')).toMatchObject({ deleted: false, derived: { scanEndMm: 134 } })
  })

  it("'파일' 시트에만 남은 파일(지시·검토구간 줄을 모두 지움)의 엑셀 줄도 지움 표시한다", async () => {
    const v5 = writeWorkbook('v5.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 44), row(F1, 2, 120, 134)] })
    const pv = await a.labels.previewWorkbook(v5)
    expect(pv.plan.record.remove).toBe(1)
    expect(pv.files.find((f) => f.fileName === F2)).toMatchObject({ records: 0, removes: 1, alignment: true })
    await a.labels.commitWorkbook(pv.previewId)
    expect((await byRef(a, '3'))?.deleted).toBe(true)
  })

  it('지시 번호가 다른 지시를 가리키면(스캔 범위가 겹치지 않음) 고치지 않고 충돌로 둔다', async () => {
    const v6 = writeWorkbook('v6.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 44), row(F1, 2, 220, 230)] })
    const pv = await a.labels.previewWorkbook(v6)
    expect(pv.plan.record).toMatchObject({ update: 0, conflict: 1 })
    expect(pv.changes.find((c) => c.action === 'conflict')?.reason).toContain('다른 지시를 가리키는')
  })
})

describe.skipIf(!hasData)('버전 칸 · PC ID', () => {
  it('저장소마다 다른 버전 칸을 쓰고, 다른 PC 이름이 기록에 있으면 그 ID 로 바꾸지 않는다', async () => {
    const sa = await a.labels.session()
    const sb = await b.labels.session()
    expect(sa.versionSlot.startsWith(`${sa.pcId}:`)).toBe(true)
    expect(sa.versionSlot).not.toBe(sb.versionSlot)
    const out = join(work, 'a.json')
    await a.labels.exportJsonFile({ kind: 'all' }, out, '0.1.0-test')
    const imp = await b.labels.importJsonFile(out)
    expect(imp.ok).toBe(true)
    expect(imp.warnings.some((w) => w.includes('보낸 PC ID 가 이 PC 와 같습니다'))).toBe(false)
    expect(await code(b.labels.setSession({ pcId: sa.pcId }))).toBe('CONFLICT')
    // 자기 파일을 다시 가져오면 같은 PC 라는 경고
    const self = await a.labels.importJsonFile(out)
    expect(self.warnings.some((w) => w.includes('보낸 PC ID 가 이 PC 와 같습니다'))).toBe(true)
  })

  it('미리보기 뒤 PC ID 를 바꾸면 확정은 PREVIEW_EXPIRED', async () => {
    const v = writeWorkbook('pc.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 44), row(F1, 2, 120, 134)] })
    const pv = await a.labels.previewWorkbook(v)
    const old = (await a.labels.session()).pcId
    await a.labels.setSession({ pcId: '현장PC-9' })
    expect(await code(a.labels.commitWorkbook(pv.previewId))).toBe('PREVIEW_EXPIRED')
    await a.labels.setSession({ pcId: old })
  })

  it('백업에서 되돌린 저장소는 알아채고 새 버전 칸으로 바꾼다', async () => {
    const before = await a.labels.session()
    a.close()
    const db = join(storeA, 'catalog.db')
    copyFileSync(db, join(work, 'catalog.backup'))
    // 되돌린 뒤에도 남는 쓰기 (이 PC 가 본 횟수가 오른다)
    const r = (await byRef(a, '1', false))!
    await a.labels.saveRecord({ ...r, note: '백업 뒤 고침' })
    a.close()
    copyFileSync(join(work, 'catalog.backup'), db)
    const after = await a.labels.session()
    expect(after.pcId).toBe(before.pcId)
    expect(after.versionSlot).not.toBe(before.versionSlot)
    expect(after.notices.some((n) => n.includes('백업에서 되돌렸거나'))).toBe(true)
    expect((await byRef(a, '1', false))?.note).not.toBe('백업 뒤 고침')
  })
})

describe.skipIf(!hasData)('2인 모드 · 라벨러', () => {
  it('라벨러 덮어쓰기는 overwrite 일 때만, 2인 모드에서는 다른 라벨러 정보를 바꿀 수 없다', async () => {
    expect(await code(a.labels.registerLabeler({ id: 'choi-l2', name: '바꾼 이름', qualification: null, organization: null }))).toBe('CONFLICT')
    await a.labels.registerLabeler({ id: 'han-l2', name: '한 판독', qualification: 'UT Level II', organization: null })
    await a.labels.setSession({ labelerId: 'han-l2', blindMode: true })
    expect(await code(a.labels.registerLabeler({ id: 'choi-l2', name: '바꾼 이름', qualification: null, organization: null }, { overwrite: true }))).toBe(
      'INVALID_ARGUMENT'
    )
    const me = await a.labels.registerLabeler({ id: 'han-l2', name: '한 판독', qualification: 'PAUT Level II', organization: null }, { overwrite: true })
    expect(me.qualification).toBe('PAUT Level II')
  })

  it('2인 모드의 JSON 내보내기는 지금 라벨러 세트만 담는다 (없으면 거부)', async () => {
    expect(await code(a.labels.exportJsonFile({ kind: 'all' }, join(work, 'han.json'), '0.1.0-test'))).toBe('INVALID_ARGUMENT')
    await a.labels.setSession({ labelerId: 'choi-l2' })
    const ex = await a.labels.exportJsonFile({ kind: 'all' }, join(work, 'choi.json'), '0.1.0-test')
    expect(ex.onlyLabelerId).toBe('choi-l2')
    const f = JSON.parse(readFileSync(ex.path, 'utf8')) as LabelExportFile
    expect(f.records.length).toBeGreaterThan(0)
    expect(f.records.every((r) => r.labelerId === 'choi-l2')).toBe(true)
    expect(await a.labels.exportFileName({ kind: 'all' })).toMatch(/^라벨_전체_choi-l2_/)
    await a.labels.setSession({ blindMode: false })
  })
})

describe.skipIf(!hasData)('미리보기 오류 안내', () => {
  it('저장된 사본을 읽지 못하면 그 원인을 맨 위 오류로 둔다', async () => {
    const files = await a.listFiles({ limit: 10, sort: 'fileName-asc' })
    const f1 = files.items.find((f) => f.storedFileName === F1)!
    const path = await a.storedFilePath(f1.id)
    a.close() // 그룹 캐시를 비운다
    renameSync(path, `${path}.moved`)
    try {
      const v = writeWorkbook('copy.xlsx', { reader: READER, file: FILES, indication: [row(F1, 1, 30, 44)] })
      const pv = await a.labels.previewWorkbook(v)
      expect(pv.ok).toBe(false)
      expect(pv.errors[0]).toContain(`'${F1}': 저장된 사본을 읽지 못했습니다`)
      expect(pv.errors.some((e) => e.includes('그룹을 읽지 못해'))).toBe(true)
      expect(pv.questionErrors).toBe(0)
    } finally {
      renameSync(`${path}.moved`, path)
    }
  })
})
