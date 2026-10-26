/**
 * 시편 다시 묶기 (AI 개발 플랜 T4): 파일명을 임시 시편 ID 로 받은 TF 파일을 시편 번호(TF_01)로 묶는다.
 * - 계산(planSpecimenRegroup): 대상·막는 사유(물리 결함·학습 분할·잠긴 시험 세트)
 * - 카탈로그(moveFilesToSpecimen): 시편만 바꾸고 사본 경로는 그대로, 빈 옛 시편 행 지움, 그사이 바뀌면 CONFLICT
 * - 서비스(실데이터 TF_01 두 파일): 옛 방식(파일명 시편)으로 가져온 뒤 다시 묶으면 TF_01 하나
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openCatalog, type Catalog } from '@core/catalog'
import { applySplitChanges, applyTestLock, emptySplitState } from '@core/labels/export/split'
import { createAppService } from '@core/service'
import { planSpecimenRegroup } from '@core/service/specimenRegroup'
import { AppError } from '@shared/errors'
import type { PhysicalDefect } from '@shared/labels/types'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { makeFile, makePlan } from '../catalog/fixtures'
import { X4_TF_COMPOUND, X4_TF_LINEAR } from '../../paths'

const work = mkdtempSync(join(tmpdir(), 'paut-regroup-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))
let seq = 0
const ctx = { at: '2026-10-26T15:00:00+09:00', pcId: 'pc-test', labelerId: null }

/** 옛 방식: 시편 ID = 파일명(출처 filename) */
function seed(): Catalog {
  const c = openCatalog(join(work, `c${++seq}.db`), { now: () => '2026-10-26T15:00:00+09:00' })
  const p1 = c.createPlan(makePlan(12, 'compound L')).id
  const p2 = c.createPlan(makePlan(13, 'linear L')).id
  const add = (planId: string, stem: string, source: 'filename' | 'manual' | 'device-filename' = 'filename', device: string | null = null) => {
    c.ensureSpecimen({ id: stem, displayName: stem, source })
    return c.insertFile(makeFile(stem, planId, stem, { sourceFileName: `${stem}.nde`, deviceFileName: device }))
  }
  add(p1, 'TF_01_C_L_0001')
  add(p2, 'TF_01_L_0001')
  add(p2, 'TF_01_L_0002')
  add(p2, 'TF_02_L_0001')
  add(p2, 'TF_03_L_0001', 'manual') // 사람이 고른 ID 는 건드리지 않음
  add(p2, 'Weld_Plate_UT-sk90-4.2') // 패턴 없음
  return c
}

const inputs = (c: Catalog, over: Partial<Parameters<typeof planSpecimenRegroup>[0]> = {}) => ({
  files: c.listFileIdentities(),
  physicalDefects: [] as PhysicalDefect[],
  split: emptySplitState(),
  ...over
})

describe('시편 다시 묶기 계산', () => {
  it('파일명 시편 중 TF 번호가 나오는 것만, 파일 ID 순서로 제안한다', () => {
    const c = seed()
    const { items } = planSpecimenRegroup(inputs(c))
    expect(items.map((i) => [i.fileName, i.fromSpecimenId, i.toSpecimenId, i.blocked])).toEqual([
      ['TF_01_C_L_0001.nde', 'TF_01_C_L_0001', 'TF_01', null],
      ['TF_01_L_0001.nde', 'TF_01_L_0001', 'TF_01', null],
      ['TF_01_L_0002.nde', 'TF_01_L_0002', 'TF_01', null],
      ['TF_02_L_0001.nde', 'TF_02_L_0001', 'TF_02', null]
    ])
    expect(items.every((i) => i.toSource === 'filename')).toBe(true)
    expect(items[0]!.note).toContain("'TF_01'")
    c.close()
  })

  it('물리 결함·학습 분할이 걸린 옛 시편, 잠긴 시험 세트로 가는 파일은 막고 사유를 보인다', () => {
    const c = seed()
    const defect = { specimenId: 'tf_02_l_0001', id: 'D1', deleted: false } as PhysicalDefect
    const gone = { specimenId: 'TF_01_L_0001', id: 'D9', deleted: true } as PhysicalDefect
    let split = applySplitChanges(emptySplitState(), [{ specimenId: 'TF_01_L_0002', split: 'train' }], ctx).state
    split = applySplitChanges(split, [{ specimenId: 'TF_01', split: 'test' }], ctx).state
    const plain = planSpecimenRegroup(inputs(c, { physicalDefects: [defect, gone], split })).items
    const by = new Map(plain.map((i) => [i.fileName, i.blocked]))
    expect(by.get('TF_02_L_0001.nde')).toContain('물리 결함(설계값) 1개')
    expect(by.get('TF_01_L_0002.nde')).toContain('학습 분할(train)')
    expect(by.get('TF_01_L_0001.nde')).toBeNull() // 지운 물리 결함은 세지 않음, 시험 세트는 잠기지 않음
    const locked = applyTestLock(split, true, { ...ctx, confirmLocked: true, reason: '시험' }).state
    const lockedItems = planSpecimenRegroup(inputs(c, { split: locked })).items
    expect(lockedItems.find((i) => i.fileName === 'TF_01_L_0001.nde')!.blocked).toContain('잠긴 시험 세트')
    c.close()
  })
})

describe('카탈로그 시편 옮기기', () => {
  it('시편만 바꾸고 저장 경로는 그대로, 빈 옛 시편은 지운다', () => {
    const c = seed()
    const items = planSpecimenRegroup(inputs(c)).items.filter((i) => i.toSpecimenId === 'TF_01')
    const before = new Map(c.listFiles({ limit: 100 }).items.map((f) => [f.id, f.storedRelPath]))
    const r = c.moveFilesToSpecimen(
      items.map((i) => ({ fileId: i.fileId, fromSpecimenId: i.fromSpecimenId, toSpecimenId: i.toSpecimenId, toSource: i.toSource })),
      items.map((i) => i.fromSpecimenId)
    )
    expect(r).toEqual({ moved: 3, createdSpecimens: ['TF_01'], removedSpecimens: ['TF_01_C_L_0001', 'TF_01_L_0001', 'TF_01_L_0002'] })
    const tf01 = c.getSpecimen('TF_01')!
    expect(tf01).toMatchObject({ fileCount: 3, source: 'filename' })
    expect(tf01.planIds.length).toBe(2)
    for (const f of c.listFiles({ specimenId: 'TF_01', limit: 10 }).items) expect(f.storedRelPath).toBe(before.get(f.id))
    expect(c.getSpecimen('TF_01_L_0001')).toBeNull()
    expect(c.getSpecimen('TF_02_L_0001')).not.toBeNull()
    // 다시 계산하면 TF_02 만 남는다
    expect(planSpecimenRegroup(inputs(c)).items.map((i) => i.toSpecimenId)).toEqual(['TF_02'])
    c.close()
  })

  it('있는 시편(대소문자 다름)에 합치고, 그사이 시편이 바뀌었으면 아무것도 쓰지 않는다', () => {
    const c = seed()
    c.ensureSpecimen({ id: 'tf_01', displayName: 'TF 01', source: 'manual' })
    const ids = c.listFileIdentities()
    const a = ids.find((f) => f.storedFileName === 'TF_01_L_0001.nde')!
    const b = ids.find((f) => f.storedFileName === 'TF_01_L_0002.nde')!
    const bad = () =>
      c.moveFilesToSpecimen(
        [
          { fileId: a.id, fromSpecimenId: a.specimenId, toSpecimenId: 'TF_01', toSource: 'filename' },
          { fileId: b.id, fromSpecimenId: 'NOT_THIS', toSpecimenId: 'TF_01', toSource: 'filename' }
        ],
        [a.specimenId]
      )
    expect(bad).toThrow(AppError)
    expect(c.getFile(a.id)!.specimenId).toBe('TF_01_L_0001') // 트랜잭션 전체 되돌림
    const r = c.moveFilesToSpecimen([{ fileId: a.id, fromSpecimenId: a.specimenId, toSpecimenId: 'TF_01', toSource: 'filename' }], [a.specimenId])
    expect(r.createdSpecimens).toEqual([])
    expect(c.getFile(a.id)!.specimenId).toBe('tf_01')
    expect(c.getSpecimen('tf_01')).toMatchObject({ displayName: 'TF 01', source: 'manual', fileCount: 1 })
    c.close()
  })
})

const hasTf = existsSync(X4_TF_COMPOUND) && existsSync(X4_TF_LINEAR)

describe.skipIf(!hasTf)('서비스 · 실데이터 TF_01 (compound L + sectorial/linear L)', () => {
  it('새 규칙으로 가져오면 처음부터 TF_01, 옛 방식으로 가져온 것은 다시 묶어 TF_01 하나', async () => {
    const service = createAppService({ settingsPath: join(work, 'settings.json') })
    const accept = (p: ImportPreview, old: boolean): ImportCommitRequest => ({
      previewId: p.previewId,
      newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
      items: p.items
        .filter((i) => i.verdict === 'match-existing' || i.verdict === 'new-plan')
        .map((i) => ({
          itemId: i.itemId,
          include: true,
          specimenId: old ? i.fileName.replace(/\.nde$/i, '') : i.suggestedSpecimenId ?? 'X',
          specimenSource: old ? 'filename' : i.suggestedSpecimenSource ?? 'manual',
          stateTag: i.suggestedStateTag,
          round: i.suggestedRound,
          memo: ''
        }))
    })
    // 새 규칙
    await service.setStoreRoot(join(work, '저장소_새규칙'))
    const p1 = await service.analyze([X4_TF_COMPOUND, X4_TF_LINEAR])
    expect(p1.items.map((i) => i.suggestedSpecimenId)).toEqual(['TF_01', 'TF_01'])
    await service.commit(accept(p1, false))
    expect((await service.listSpecimens()).map((s) => [s.id, s.fileCount])).toEqual([['TF_01', 2]])
    expect((await service.previewSpecimenRegroup()).items).toEqual([])
    // 옛 방식 → 다시 묶기
    await service.setStoreRoot(join(work, '저장소_옛방식'))
    await service.commit(accept(await service.analyze([X4_TF_COMPOUND, X4_TF_LINEAR]), true))
    expect((await service.listSpecimens()).map((s) => s.id)).toEqual(['TF_01_C_L_0001', 'TF_01_L_0001'])
    const pv = await service.previewSpecimenRegroup()
    expect(pv.items.map((i) => [i.fromSpecimenId, i.toSpecimenId, i.blocked])).toEqual([
      ['TF_01_C_L_0001', 'TF_01', null],
      ['TF_01_L_0001', 'TF_01', null]
    ])
    const r = await service.applySpecimenRegroup(pv.items.map((i) => i.fileId))
    expect(r).toMatchObject({ moved: 2, skipped: 0, createdSpecimens: ['TF_01'] })
    const after = await service.listSpecimens()
    expect(after.map((s) => [s.id, s.fileCount, s.planIds.length])).toEqual([['TF_01', 2, 2]])
    // 사본은 그대로 열린다
    const files = await service.listFiles({ specimenId: 'TF_01', limit: 10 })
    for (const f of files.items) expect(existsSync(await service.storedFilePath(f.id))).toBe(true)
    service.close()
  }, 120_000)
})
