/**
 * 데이터 안전 회귀 테스트 (검토 지적): 강제 종료 흔적 복구, 사라진 사본 복원, 저장소=원본 폴더 거부,
 * 저장소 사본 재수집 방지, 같은 배치 중복의 결과, 취소 결과 상태, 이전 규칙 플랜 갱신.
 * 공식 예제의 작은 파일을 임시 폴더로 복사해서 쓴다 (원본은 읽기만).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openCatalog } from '@core/catalog'
import { createAppService, type AppService } from '@core/service'
import { hashFile } from '@core/storage'
import { h5PathFor } from '../../../src/core/nde/h5'
import { sanitizeSpecimenId } from '@shared/ids'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { EX, HAS_EXAMPLES } from '../nde/fixtures'

let work: string
let src: string
let store: string
let service: AppService

function acceptAll(p: ImportPreview, override: Partial<Record<string, { include?: boolean; specimenId?: string }>> = {}): ImportCommitRequest {
  return {
    previewId: p.previewId,
    newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
    items: p.items
      .filter((i) => i.verdict === 'match-existing' || i.verdict === 'new-plan')
      .map((i) => ({
        itemId: i.itemId,
        include: override[i.fileName]?.include ?? true,
        specimenId: override[i.fileName]?.specimenId ?? i.suggestedSpecimenId ?? 'X',
        specimenSource: i.suggestedSpecimenSource ?? 'manual',
        stateTag: i.suggestedStateTag,
        round: i.suggestedRound,
        memo: ''
      }))
  }
}

function put(dir: string, from: string, name: string): string {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  copyFileSync(from, p)
  return p
}

function newService(): AppService {
  return createAppService({ settingsPath: join(work, 'settings.json') })
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'paut-safety-'))
  src = join(work, '원본')
  store = join(work, '저장소')
  mkdirSync(src)
  service = newService()
})

afterEach(() => {
  service.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!HAS_EXAMPLES)('저장소 위치·탐색 범위', () => {
  it('측정 원본이 든 폴더는 새 저장소로 고를 수 없다 (원본 폴더에 쓰기 없음)', async () => {
    put(src, EX.manualUt33, 'a.nde')
    await expect(service.setStoreRoot(src)).rejects.toMatchObject({ code: 'STORE_ROOT_INVALID' })
    expect(readdirSync(src)).toEqual(['a.nde'])
    await expect(service.setStoreRoot(join(src, '..', '빈폴더'))).resolves.toBeTruthy()
  })

  it('원본 폴더 안에 저장소가 있어도 저장소의 사본은 다시 수집하지 않는다', async () => {
    put(src, EX.manualUt33, 'a.nde')
    await service.setStoreRoot(join(src, 'store'))
    const p1 = await service.analyze([src])
    await service.commit(acceptAll(p1))
    put(src, EX.tofd42, 'b.nde')
    const p2 = await service.analyze([src])
    expect(p2.items.map((i) => `${i.fileName}:${i.verdict}`)).toEqual(['a.nde:duplicate', 'b.nde:new-plan'])
    expect(p2.skippedStoreCount).toBe(1)
    // 저장소 자체를 넣어도 건너뛴다
    await expect(service.analyze([join(src, 'store')])).resolves.toMatchObject({ items: [], skippedStoreCount: 1 })
  })
})

describe.skipIf(!HAS_EXAMPLES)('사라진 사본 복원', () => {
  it('저장소에서 사본을 지우면 duplicate 가 아니라 missing-copy, 확정하면 같은 자리로 복원', async () => {
    put(src, EX.manualUt33, 'ManualWeldUT.nde')
    await service.setStoreRoot(store)
    const r1 = await service.commit(acceptAll(await service.analyze([src])))
    const rel = r1.items[0]!.storedRelPath!
    unlinkSync(join(store, ...rel.split('/')))

    const p = await service.analyze([src])
    expect(p.items[0]).toMatchObject({ verdict: 'missing-copy', duplicateOf: { storedRelPath: rel } })
    expect(p.counts['missing-copy']).toBe(1)
    const r = await service.commit(acceptAll(p))
    expect(r.items[0]).toMatchObject({ status: 'restored', storedRelPath: rel })
    expect(r.copiedCount).toBe(1)
    const f = (await service.listFiles({})).items[0]!
    expect(await hashFile(join(store, ...rel.split('/')))).toBe(f.meta.sha256)
    expect((await service.analyze([src])).items[0]!.verdict).toBe('duplicate')
  })

  it('사본이 바뀌어(크기 다름) 있으면 옆 이름으로 복원하고 레코드 경로를 고친다', async () => {
    put(src, EX.manualUt33, 'ManualWeldUT.nde')
    await service.setStoreRoot(store)
    const r1 = await service.commit(acceptAll(await service.analyze([src])))
    const rel = r1.items[0]!.storedRelPath!
    writeFileSync(join(store, ...rel.split('/')), 'broken')
    const r = await service.commit(acceptAll(await service.analyze([src])))
    expect(r.items[0]!.status).toBe('restored')
    expect(r.items[0]!.storedRelPath).toBe(rel.replace('ManualWeldUT.nde', 'ManualWeldUT (2).nde'))
    expect((await service.listFiles({})).items[0]!.storedRelPath).toBe(r.items[0]!.storedRelPath)
  })
})

describe.skipIf(!HAS_EXAMPLES)('같은 배치 안 중복', () => {
  it('기준 항목을 제외하면 중복 항목도 "제외"로 보고 (저장됐다고 하지 않음)', async () => {
    put(join(src, 'd1'), EX.manualUt33, 'a.nde')
    put(join(src, 'd2'), EX.manualUt33, 'a-copy.nde')
    await service.setStoreRoot(store)
    const p = await service.analyze([src])
    expect(p.items.map((i) => i.verdict)).toEqual(['new-plan', 'duplicate'])
    const r = await service.commit(acceptAll(p, { 'a.nde': { include: false } }))
    expect(r.items.map((i) => i.status)).toEqual(['skipped-excluded', 'skipped-excluded'])
    expect(r.items[1]!.errorMessage).toContain('제외해')
    expect((await service.listFiles({})).total).toBe(0)
  })

  it('기준 항목이 실패하면 중복 항목도 실패로 보고', async () => {
    const a = put(join(src, 'd1'), EX.manualUt33, 'a.nde')
    put(join(src, 'd2'), EX.manualUt33, 'a-copy.nde')
    await service.setStoreRoot(store)
    const p = await service.analyze([src])
    unlinkSync(a)
    const r = await service.commit(acceptAll(p))
    expect(r.items.map((i) => i.status)).toEqual(['failed', 'failed'])
    expect(r.items[1]!.errorMessage).toContain('저장되지 않아')
  })

  it('기준 항목이 저장되면 중복 항목은 그 경로를 가리킨다', async () => {
    put(join(src, 'd1'), EX.manualUt33, 'a.nde')
    put(join(src, 'd2'), EX.manualUt33, 'a-copy.nde')
    await service.setStoreRoot(store)
    const r = await service.commit(acceptAll(await service.analyze([src])))
    expect(r.items.map((i) => i.status)).toEqual(['copied', 'skipped-duplicate'])
    expect(r.items[1]!.storedRelPath).toBe(r.items[0]!.storedRelPath)
  })
})

describe.skipIf(!HAS_EXAMPLES)('강제 종료 흔적 복구 (저장소를 다시 열 때)', () => {
  it('.partial 삭제, 미등록 사본은 미등록_파일 로 옮기고, 끝나지 않은 배치는 interrupted', async () => {
    await service.setStoreRoot(store)
    service.close()
    // 강제 종료를 흉내: 사본은 플랜 폴더에 있지만 DB 기록 없음, 복사 임시 파일, 끝나지 않은 배치
    const orphan = put(join(store, '스캔플랜', 'SP001', 'ManualWeldUT'), EX.manualUt33, 'ManualWeldUT.nde')
    put(join(store, '스캔플랜', 'SP001', 'ManualWeldUT'), EX.manualUt33, 'x.nde.partial')
    const cat = openCatalog(join(store, 'catalog.db'))
    cat.beginImportBatch({ batchId: 'IMP-CRASH', inputPaths: [src], totalItems: 1, startedAt: '2026-10-02T09:00:00+09:00' })
    cat.close()

    service = newService()
    const report = await service.maintenanceReport()
    expect(report).toMatchObject({ interruptedBatchCount: 1, removedPartialCount: 1 })
    expect(report!.quarantined).toHaveLength(1)
    expect(report!.quarantined[0]!.from).toBe('스캔플랜/SP001/ManualWeldUT/ManualWeldUT.nde')
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(join(store, ...report!.quarantined[0]!.to.split('/')))).toBe(true)
    expect(existsSync(join(store, '스캔플랜', 'SP001'))).toBe(false)
    const h = await service.history()
    expect(h[0]).toMatchObject({ batchId: 'IMP-CRASH', status: 'interrupted' })
    expect(h[0]!.finishedAt).not.toBeNull()

    // 다른 플랜(ToFD)이 SP001 을 받아도 그 폴더에 이전 고아가 섞이지 않는다
    put(src, EX.tofd42, 'tofd.nde')
    const r = await service.commit(acceptAll(await service.analyze([src])))
    expect(r.createdPlanIds).toEqual(['SP001'])
    expect(readdirSync(join(store, '스캔플랜', 'SP001'))).toEqual(['tofd'])
  })

  it('이전 규칙(fp1)으로 만든 플랜은 보관된 셋업으로 지문을 다시 계산한다', async () => {
    put(src, EX.manualUt33, 'ManualWeldUT.nde')
    await service.setStoreRoot(store)
    await service.commit(acceptAll(await service.analyze([src])))
    const before = (await service.listPlans())[0]!
    service.close()
    // DB 를 fp1 시절 상태로 되돌린다
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(store, 'catalog.db'))
    const oldSpec = { ...before.spec, specVersion: 1 }
    db.prepare('UPDATE plans SET fingerprint = ?, spec_version = 1, spec_json = ? WHERE id = ?').run('fp1:old', JSON.stringify(oldSpec), before.id)
    db.close()

    service = newService()
    expect((await service.maintenanceReport())!.upgradedPlanIds).toEqual([before.id])
    const after = (await service.listPlans())[0]!
    expect(after.fingerprint).toBe(before.fingerprint)
    expect(after.spec.specVersion).toBe(2)
    expect((await service.analyze([src])).items[0]!.verdict).toBe('duplicate')
  })
})

describe.skipIf(!HAS_EXAMPLES)('결과 상태', () => {
  it('확정 결과에 배치 상태(status)가 들어 있다', async () => {
    put(src, EX.manualUt33, 'a.nde')
    await service.setStoreRoot(store)
    const r = await service.commit(acceptAll(await service.analyze([src])))
    expect(r.status).toBe('completed')
  })
})

describe('이름·경로 규칙', () => {
  it('시편 ID 정리는 멱등이고, 폴더가 겹치는 ID 는 같은 ID 로 모인다', () => {
    expect(sanitizeSpecimenId('CON.1')).toBe('CON_.1')
    expect(sanitizeSpecimenId('CON_.1')).toBe('CON_.1')
    expect(sanitizeSpecimenId('.PL1')).toBe('_.PL1')
    expect(sanitizeSpecimenId('_.PL1')).toBe('_.PL1')
    expect(sanitizeSpecimenId('con')).toBe('con_')
    expect(sanitizeSpecimenId('a/b')).toBe('a_b')
    expect(sanitizeSpecimenId('..')).toBe('')
    for (const s of ['CON.1', '.PL1', 'LPT9.x', 'PL23833', '  a.  ']) expect(sanitizeSpecimenId(sanitizeSpecimenId(s))).toBe(sanitizeSpecimenId(s))
  })

  it('윈도우에서는 h5wasm 에 넘기는 경로의 역슬래시를 / 로 바꾼다', () => {
    expect(h5PathFor('C:\\PAUT저장소\\스캔플랜\\SP001\\a.nde', 'win32')).toBe('C:/PAUT저장소/스캔플랜/SP001/a.nde')
    expect(h5PathFor('\\\\server\\share\\a.nde', 'win32')).toBe('//server/share/a.nde')
    expect(h5PathFor('/Users/a/b.nde', 'darwin')).toBe('/Users/a/b.nde')
  })
})
