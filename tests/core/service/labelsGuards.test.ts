/**
 * 라벨 세트 보호 시험 (2026-10-07 빌드 전 검증 지적 반영) — core 서비스만, X3 실데이터 4개를 임시 저장소에 가져와서(원본은 읽기만):
 *   - 2인 독립 모드: 다른 라벨러 엑셀은 미리보기·확정 모두 막음. JSON 기본 파일 이름의 라벨러 ID 는 파일 이름에 맞게 바꿈
 *   - 제출(잠금)한 세트: 바꾼 엑셀을 다시 가져와도 '그대로 둠'(저장값 그대로), 충돌의 '들어온 것'·'둘 다'는 CONFLICT
 *   - 다른 PC 의 JSON 이 제출한 세트를 바꾸면 경고
 *   - 검수 확정(saveFinal)은 원본 기록의 전문가 관측 확인을 확정 기록으로 옮김
 *   - 확정 단계 엑셀: 검수 확정 세트가 있는 파일·잠긴 시험 파일에는 넣지 않음
 *   - '설계값 대조 시작' 사본 + 대조용 엑셀: 같은 지시 번호를 새로 만들지 않음
 *   - 내보내기 경로: 저장소 안·측정 원본 폴더 거절 (JSON·CSV·학습 데이터)
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAppService, type AppService } from '@core/service'
import { assertExportTarget } from '@core/service/exportTarget'
import { DEFAULT_TRAINING_SET_RULE, type ReviewComparison, type ReviewFinalRequest } from '@shared/api'
import { LABEL_SHEETS, columnsOf, sheetHeaders, type LabelSheetId } from '@shared/labels'
import type { AdjudicationDecision } from '@shared/labels/review'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { X3_FILES } from '../../paths'
import { buildXlsx, fixture, type KitCell } from '../labels/xlsxKit'

const hasData = X3_FILES.every((f) => existsSync(f))
const work = mkdtempSync(join(tmpdir(), 'paut-label-guards-'))
const store = join(work, '저장소')
let s: AppService

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
    LABEL_SHEETS.map((sh) => {
      const keys = columnsOf(sh.id).map((c) => c.key)
      return { name: sh.name, rows: [sheetHeaders(sh.id) as KitCell[], ...(rows[sh.id] ?? []).map((r) => keys.map((k) => r[k] ?? null))] }
    })
  )
  const path = join(work, name)
  writeFileSync(path, buf)
  return path
}

const F1 = '12T-SV-01-Cap on.nde'
const F2 = '12T-SV-02-Cap on.nde'
const F3 = '12T-SV-03-Cap off.nde'
const F4 = '12T-SV-04-Cap on.nde'
const S90 = '섹토리얼 Skew 90'
const S270 = '섹토리얼 Skew 270'

/** lee-l2 블라인드 (labelsReview.test.ts 와 같은 값). end4·end5 = F4 L4·L5 스캔 끝 */
function leeRows(end4 = 226, end5 = 110): Rows {
  return {
    reader: [{ labelerId: 'lee-l2', readingStage: '블라인드 (설계값 안 봄)', qualification: 'UT Level II' }],
    indication: [
      { fileName: F1, externalRef: 'L1', kind: '결함', group: S90, scanStartMm: 33, scanEndMm: 47, depthTopMm: 0.8, depthBottomMm: 3.4, maxAmplitudePct: 90, defectType: '균열 (토우)', existenceConfidence: '확실' },
      { fileName: F2, externalRef: 'L3', kind: '결함', group: S90, scanStartMm: 149, scanEndMm: 170, depthTopMm: 9.5, depthBottomMm: 12, maxAmplitudePct: 120, defectType: '균열 (루트)', existenceConfidence: '확실' },
      { fileName: F4, externalRef: 'L4', kind: '결함', group: S90, scanStartMm: 214, scanEndMm: end4, depthTopMm: 6, depthBottomMm: 8, maxAmplitudePct: 45, defectType: '슬래그', existenceConfidence: '보통' },
      { fileName: F4, externalRef: 'L5', kind: '결함', group: S270, scanStartMm: 100, scanEndMm: end5, depthTopMm: 7, depthBottomMm: 9, maxAmplitudePct: 70, defectType: '균열 (중앙)', existenceConfidence: '보통' }
    ],
    review: [F1, F2, F3, F4].map((fileName) => ({ fileName, kind: '검토 완료', scanStartMm: 0, scanEndMm: 300 }))
  }
}

const KIM = { labelerId: 'kim-l2', readingStage: 'blind' as const, guidelineVersion: 'v1' }
const LEE = { labelerId: 'lee-l2', readingStage: 'blind' as const, guidelineVersion: 'v1' }
const PARK_FINAL = { labelerId: 'park-l3', readingStage: 'final' as const, guidelineVersion: 'v1' }

let shas: Record<string, string> = {}
let specimens: Record<string, string> = {}
let leePath = ''

async function commitPath(path: string): Promise<void> {
  const pv = await s.labels.previewWorkbook(path)
  expect(pv.errors, path).toEqual([])
  await s.labels.commitWorkbook(pv.previewId)
}

function decide(c: ReviewComparison): AdjudicationDecision[] {
  return c.comparison.rows.map((r) => {
    if (r.kind === 'pair') return { rowId: r.id, choice: 'a' }
    if (r.kind === 'only-a') return { rowId: r.id, choice: r.counted ? 'a' : 'defer' }
    return { rowId: r.id, choice: 'neither' }
  })
}

function finalReq(c: ReviewComparison): ReviewFinalRequest {
  return { compare: c.request, rowsKey: c.rowsKey, decisions: decide(c), design: { minTier: 'any' } }
}

beforeAll(async () => {
  if (!hasData) return
  s = createAppService({ settingsPath: join(work, 'ud', 'settings.json') })
  await s.setStoreRoot(store)
  const r = await s.commit(acceptAll(await s.analyze(X3_FILES)))
  expect(r).toMatchObject({ copiedCount: 4, failedCount: 0 })
  const files = (await s.listFiles({ limit: 100 })).items
  shas = Object.fromEntries(files.map((f) => [f.storedFileName, f.meta.sha256]))
  specimens = Object.fromEntries(files.map((f) => [f.storedFileName, f.specimenId]))
  leePath = writeWorkbook('lee_blind.xlsx', leeRows())
  await commitPath(fixture('x3_blind_kim.xlsx'))
  await commitPath(leePath)
  await s.labels.registerLabeler({ id: 'park-l3', name: '박 조정', qualification: 'PAUT Level III', organization: '○○검사' })
}, 180_000)

afterAll(() => {
  s?.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!hasData)('라벨 세트 보호 (X3 실데이터)', () => {
  it('2인 독립 모드: 다른 라벨러 엑셀은 미리보기·확정 모두 막고, JSON 기본 이름의 라벨러 ID 는 파일 이름에 맞게 바꾼다', async () => {
    await s.labels.setSession({ labelerId: 'kim-l2', blindMode: true })
    expect(await code(s.labels.previewWorkbook(leePath))).toBe('INVALID_ARGUMENT')
    // 지금 라벨러 엑셀은 된다
    expect((await s.labels.previewWorkbook(fixture('x3_blind_kim.xlsx'))).ok).toBe(true)
    // 미리보기 뒤 2인 모드로 바꾸면 확정에서 막는다
    await s.labels.setSession({ blindMode: false })
    const pv = await s.labels.previewWorkbook(leePath)
    await s.labels.setSession({ blindMode: true })
    expect(await code(s.labels.commitWorkbook(pv.previewId))).toBe('INVALID_ARGUMENT')
    // 라벨러 ID 에 '/'·':' 가 있어도 기본 파일 이름은 한 폴더 안의 이름
    await s.labels.registerLabeler({ id: 'kim/l2:a', name: '시험', qualification: null, organization: null })
    await s.labels.setSession({ labelerId: 'kim/l2:a' })
    const name = await s.labels.exportFileName({ kind: 'all' })
    expect(name).toContain('_kim_l2_a_')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    await s.labels.setSession({ labelerId: 'kim-l2', blindMode: false })
  })

  it("제출(잠금)한 세트: 바꾼 엑셀을 다시 가져와도 '그대로 둠'이고, 충돌의 '들어온 것'·'둘 다'는 CONFLICT", async () => {
    await s.labels.setSession({ labelerId: 'lee-l2' })
    const set = { sha256: shas[F4]!, ...LEE }
    const at = (ref: string) => s.labels.listRecords({ set }).then((rs) => rs.find((r) => r.externalRef === ref)!)
    // L5 를 앱에서 고친 뒤 엑셀도 L5 를 바꾸면 충돌 (제출 전)
    await s.labels.saveRecord({ ...(await at('L5')), note: '앱에서 고침' })
    const v2 = writeWorkbook('lee_v2.xlsx', leeRows(226, 112))
    const p2 = await s.labels.previewWorkbook(v2)
    expect(p2.plan.record.conflict).toBe(1)
    await s.labels.commitWorkbook(p2.previewId)
    const l5 = await at('L5')
    const conflict = (await s.labels.listConflicts()).find((c) => c.key === l5.uuid)!
    expect(conflict).toBeDefined()

    // 제출
    expect((await s.labels.submitSet(set, true)).submittedAt).not.toBeNull()
    expect(await code(s.labels.resolveConflict(conflict.id, 'theirs'))).toBe('CONFLICT')
    expect(await code(s.labels.resolveConflict(conflict.id, 'both'))).toBe('CONFLICT')
    expect((await at('L5')).note).toBe('앱에서 고침')

    // 엑셀이 L4 끝을 228 로 바꿈 → 제출한 세트라 그대로 둠
    const v3 = writeWorkbook('lee_v3.xlsx', leeRows(228, 112))
    const p3 = await s.labels.previewWorkbook(v3)
    expect(p3.ok).toBe(true)
    expect(p3.plan.record.update).toBe(0)
    expect(p3.plan.record.conflict).toBe(0)
    expect(p3.changes.some((c) => c.action === 'kept' && c.reason.includes('제출(잠금)한 세트'))).toBe(true)
    expect(p3.warnings.some((w) => w.includes('제출(잠금)한 블라인드 세트는 엑셀로도 고치지 않습니다'))).toBe(true)
    const r3 = await s.labels.commitWorkbook(p3.previewId)
    expect(r3.conflictIds).toEqual([])
    expect((await at('L4')).derived.scanEndMm).toBe(226)
    // 엑셀에서 L4 줄을 빼도 지움 표시하지 않는다
    const rows4 = leeRows(226, 112)
    rows4.indication = rows4.indication!.filter((r) => r['externalRef'] !== 'L4')
    const p4 = await s.labels.previewWorkbook(writeWorkbook('lee_v4.xlsx', rows4))
    expect(p4.plan.record.remove).toBe(0)
    await s.labels.commitWorkbook(p4.previewId)
    expect((await at('L4')).deleted).toBe(false)

    // '내 것'은 된다 (내용은 그대로)
    expect((await s.labels.resolveConflict(conflict.id, 'mine')).conflict.resolution).toBe('mine')
    expect((await at('L5')).note).toBe('앱에서 고침')
  })

  it('다른 PC 의 JSON 이 이 저장소에서 제출한 세트를 바꾸면 경고한다', async () => {
    const aJson = join(work, 'a.json')
    await s.labels.exportJsonFile({ kind: 'all' }, aJson, '0.0.0-test')
    const b = createAppService({ settingsPath: join(work, 'udB', 'settings.json') })
    try {
      await b.setStoreRoot(join(work, '저장소B'))
      expect((await b.labels.importJsonFile(aJson)).ok).toBe(true)
      await b.labels.setSession({ labelerId: 'lee-l2' })
      const rec = (await b.labels.listRecords({ set: { sha256: shas[F4]!, ...LEE } })).find((r) => r.externalRef === 'L4')!
      expect((await b.labels.saveRecord({ ...rec, note: 'B 에서 고침' })).changed).toBe(true)
      const bJson = join(work, 'b.json')
      await b.labels.exportJsonFile({ kind: 'files', sha256s: [shas[F4]!] }, bJson, '0.0.0-test')
      const r = await s.labels.importJsonFile(bJson)
      expect(r.ok).toBe(true)
      expect(r.updated).toBeGreaterThan(0)
      expect(r.warnings.some((w) => w.includes('제출(잠금)한 블라인드 세트 1개가 다른 PC 값으로 바뀌었습니다') && w.includes(F4))).toBe(true)
    } finally {
      b.close()
    }
  })

  it('검수 확정은 원본 기록의 전문가 관측 확인을 확정 기록으로 옮기고, 확정 단계 엑셀은 검수 확정 파일·잠긴 시험 파일에 넣지 않는다', async () => {
    // kim F1 '1'(토우 균열)에 전문가 관측 확인 한 줄
    await s.labels.setSession({ labelerId: 'kim-l2' })
    const kim1 = (await s.labels.listRecords({ set: { sha256: shas[F1]!, ...KIM } })).find((r) => r.externalRef === '1')!
    const obs = {
      recordUuid: kim1.uuid,
      groupId: 0,
      leg: 2,
      projected: null,
      search: null,
      saturated: null,
      status: 'weak' as const,
      expertConfirmed: true,
      coordRulesVersion: 1,
      revision: 1,
      versions: [],
      deleted: false,
      pcId: null
    }
    expect((await s.labels.saveObservation(obs)).changed).toBe(true)
    // 확인하지 않은 행은 옮기지 않는다
    expect((await s.labels.saveObservation({ ...obs, leg: 1, status: 'visible', expertConfirmed: false })).changed).toBe(true)

    await s.labels.setSession({ labelerId: 'park-l3' })
    const cmp = await s.labels.compareSets({ sha256s: [F1, F2, F3].map((n) => shas[n]!), a: KIM, b: LEE })
    const r = await s.labels.saveFinal(finalReq(cmp))
    expect(r.observations).toMatchObject({ created: 1, updated: 0, removed: 0 })
    const finals = await s.labels.listRecords({ set: { sha256: shas[F1]!, ...PARK_FINAL } })
    const fromKim1 = finals.find((x) => (x as unknown as { adjudication: { sourceRecord: string } }).adjudication.sourceRecord === kim1.uuid)!
    expect(fromKim1).toBeDefined()
    const moved = await s.labels.listObservations({ recordUuids: [fromKim1.uuid] })
    expect(moved.map((o) => [o.groupId, o.leg, o.status, o.expertConfirmed])).toEqual([[0, 2, 'weak', true]])
    // 같은 결정을 다시 저장하면 그대로
    const again = await s.labels.saveFinal(finalReq(cmp))
    expect(again.observations).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: 1 })
    // 원본에서 확인을 거두면 다시 저장할 때 확정 쪽도 지움 표시
    await s.labels.setSession({ labelerId: 'kim-l2' })
    const cur = (await s.labels.listObservations({ recordUuids: [kim1.uuid] })).find((o) => o.leg === 2)!
    await s.labels.saveObservation({ ...cur, expertConfirmed: false })
    await s.labels.setSession({ labelerId: 'park-l3' })
    const cmp2 = await s.labels.compareSets({ sha256s: [F1, F2, F3].map((n) => shas[n]!), a: KIM, b: LEE })
    expect((await s.labels.saveFinal(finalReq(cmp2))).observations).toMatchObject({ removed: 1 })
    expect(await s.labels.listObservations({ recordUuids: [fromKim1.uuid] })).toEqual([])

    // F4 를 시험 분할로 잠근다 (F4 에는 검수 확정 세트가 없음)
    await s.labels.setTrainingSplits([{ specimenId: specimens[F4]!, split: 'test' }])
    await s.labels.lockTrainingTest(true)
    const before = finals.length
    const finalXlsx = writeWorkbook('park_final.xlsx', {
      reader: [{ labelerId: 'park-l3', readingStage: '확정 (Level III)', qualification: 'PAUT Level III' }],
      indication: [
        { fileName: F1, externalRef: 'X1', kind: '결함', group: S90, scanStartMm: 60, scanEndMm: 70, depthTopMm: 3, depthBottomMm: 5, maxAmplitudePct: 60, defectType: '슬래그', existenceConfidence: '확실' },
        { fileName: F4, externalRef: 'X2', kind: '결함', group: S90, scanStartMm: 50, scanEndMm: 60, depthTopMm: 3, depthBottomMm: 5, maxAmplitudePct: 60, defectType: '슬래그', existenceConfidence: '확실' }
      ]
    })
    const p = await s.labels.previewWorkbook(finalXlsx)
    expect(p.ok).toBe(true)
    // 두 줄 모두 그대로 둠 (검수 확정 기록은 엑셀에서 빠졌다고 지우지도 않음)
    expect(p.plan.record).toMatchObject({ create: 0, update: 0, conflict: 0, remove: 0 })
    expect(p.plan.record.kept).toBeGreaterThanOrEqual(2)
    expect(p.changes.some((c) => c.reason.includes('검수 화면에서 만든 확정 세트가 있는 파일'))).toBe(true)
    expect(p.changes.some((c) => c.reason.includes('시험 세트가 잠긴 시험 파일'))).toBe(true)
    await s.labels.commitWorkbook(p.previewId)
    expect(await s.labels.listRecords({ set: { sha256: shas[F1]!, ...PARK_FINAL } })).toHaveLength(before)
    expect(await s.labels.listRecords({ set: { sha256: shas[F4]!, ...PARK_FINAL } })).toEqual([])
    // 시험 잠금을 풀면 F4 줄은 들어간다 (F1 은 여전히 검수 확정 파일)
    await s.labels.lockTrainingTest(false, { confirmLocked: true, reason: '시험 끝' })
    const p2 = await s.labels.previewWorkbook(finalXlsx)
    expect(p2.plan.record).toMatchObject({ create: 1, update: 0, conflict: 0, remove: 0 })
    // 고른 확정 세트는 검수 출처 기록만이라 '일부 없음' 표시가 없다
    const c = await s.labels.trainingCandidates(DEFAULT_TRAINING_SET_RULE)
    const f1 = c.files.find((x) => x.sha256 === shas[F1])!
    expect(f1.chosen).toBe(`${shas[F1]}|park-l3|v1|final`)
    expect(f1.reason).not.toContain('일부 없음')
  })

  it("'설계값 대조 시작' 사본에 같은 사람의 대조용 엑셀을 넣어도 같은 번호 지시를 새로 만들지 않는다", async () => {
    await s.labels.setSession({ labelerId: 'kim-l2' })
    const r = await s.labels.startReconcile({ sha256: shas[F1]!, ...KIM })
    const p = await s.labels.previewWorkbook(fixture('x3_reconciled_kim.xlsx'))
    expect(p.ok).toBe(true)
    expect(p.plan.record).toMatchObject({ create: 1, kept: 1 })
    expect(p.changes.some((c) => c.action === 'kept' && c.reason.includes('앱에서 만든 같은 번호 지시'))).toBe(true)
    await s.labels.commitWorkbook(p.previewId)
    const refs = (await s.labels.listRecords({ set: r.set })).map((x) => x.externalRef).sort()
    expect(refs).toEqual(['1', '2', '3', 'C1'])
  })

  it('내보내기 경로: 저장소 안·측정 원본이 든 폴더·가져올 때의 원본 폴더는 거절한다 (JSON·CSV·학습 데이터)', async () => {
    await s.labels.setSession({ labelerId: 'park-l3' })
    const raw = join(work, '원본같은폴더')
    mkdirSync(raw, { recursive: true })
    writeFileSync(join(raw, 'dummy.nde'), 'x')
    expect(await code(s.labels.exportJsonFile({ kind: 'all' }, join(store, '라벨.json'), '0'))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.exportJsonFile({ kind: 'all' }, join(raw, '라벨.json'), '0'))).toBe('INVALID_ARGUMENT')
    const cmpReq = { sha256s: [shas[F1]!], a: KIM, b: LEE }
    expect(await code(s.labels.saveReviewCsv({ kind: 'comparison', compare: cmpReq }, join(store, 'x.csv')))).toBe('INVALID_ARGUMENT')
    const req = {
      sha256s: [shas[F1]!],
      setRule: DEFAULT_TRAINING_SET_RULE,
      options: { images: false, amplitude: false, mmPerPx: 0.1, maskMode: 'blackout' as const, weakAs: 'ignore' as const, unconfirmedObservation: 'keep' as const }
    }
    expect(await code(s.labels.exportTraining(req, store, '0'))).toBe('INVALID_ARGUMENT')
    expect(await code(s.labels.exportTraining(req, raw, '0'))).toBe('INVALID_ARGUMENT')
    expect(readdirSync(raw)).toEqual(['dummy.nde'])
    expect(readdirSync(store).some((n) => n.endsWith('.json') || n.endsWith('.csv') || n.startsWith('학습데이터'))).toBe(false)
    // 원본 폴더 아래 하위 폴더도 거절 (원본을 쓰지 않으려고 규칙만 직접 시험)
    await expect(assertExportTarget(join(raw, '하위', 'x.json'), 'file', { storeRoot: store, sourceDirs: [raw] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(assertExportTarget(join(work, 'ok.json'), 'file', { storeRoot: store, sourceDirs: [raw] })).resolves.toBeUndefined()
    // 다른 폴더에는 된다
    const ok = await s.labels.exportJsonFile({ kind: 'all' }, join(work, '내보내기', '라벨.json'), '0')
    expect(ok.bytes).toBeGreaterThan(0)
    // 검수 확정 기록의 출처 칸(adjudication)은 앱이 만든 칸이라 새 저장소로 되돌릴 때 '모르는 칸' 경고가 없다
    const c = createAppService({ settingsPath: join(work, 'udC', 'settings.json') })
    try {
      await c.setStoreRoot(join(work, '저장소C'))
      const r = await c.labels.importJsonFile(ok.path)
      expect(r.ok).toBe(true)
      expect(r.warnings.some((w) => w.includes('adjudication'))).toBe(false)
    } finally {
      c.close()
    }
  })
})
