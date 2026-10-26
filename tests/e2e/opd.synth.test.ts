/**
 * OPD 가져오기 흐름 (Electron 없이 core 서비스만) — 시험용 작은 OPD(tests/core/opd/synth.ts)로 돈다. 실데이터가 없어도 된다.
 * 분석(새 플랜·형식 표시·경고) → 확정(사본·셋업 원문·이름) → 다시 분석(중복) → 저장소 점검(규칙 갱신·미등록 사본)
 * → 확정 중 원본 변경(HASH_MISMATCH) → 2축·해석 실패 격리. 실데이터 전수는 opd.e2e.test.ts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openCatalog } from '@core/catalog'
import { createAppService, type AppService } from '@core/service'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { buildSynthOpd } from '../core/opd/synth'

const work = mkdtempSync(join(tmpdir(), 'paut-opd-synth-'))
const src = join(work, '원본')
const storeRoot = join(work, '저장소')
const settingsPath = join(work, 'settings.json')
let service: AppService

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

/** 시험용 OPD 를 dir 에 쓴다. flip 이면 래스터 바이트 하나를 바꿔 (셋업은 같고 해시만 다른) 다른 파일로 */
function put(dir: string, name: string, opts: Parameters<typeof buildSynthOpd>[0] = {}, flip?: number): string {
  mkdirSync(dir, { recursive: true })
  const s = buildSynthOpd(opts)
  const bytes = s.bytes.slice()
  if (flip !== undefined) bytes[s.rasterOffset + flip] = bytes[s.rasterOffset + flip]! ^ 0x5a
  const p = join(dir, name)
  writeFileSync(p, bytes)
  return p
}

beforeAll(async () => {
  service = createAppService({ settingsPath })
  await service.setStoreRoot(storeRoot)
})

afterAll(() => {
  service?.close()
  rmSync(work, { recursive: true, force: true })
})

describe('OPD 가져오기 (시험용 OPD)', () => {
  it('분석: OPD 형식·새 플랜 후보(L/R 따로), 시편 ID 는 장비 저장 이름의 TP 번호, 이름이 다르면 경고', async () => {
    put(join(src, 'TP90'), 'TP90-ROOT-L-01.opd', { deviceFileName: 'TP90-ROOT-L-##' })
    put(join(src, 'TP90'), 'TP90-ROOT-R-01.opd', { deviceFileName: 'TP90-ROOT-R-##', skewDeg: 270 })
    put(join(src, 'TP91'), 'TP91-ROOT-L-01.opd', { deviceFileName: 'TP91-ROOT-R-##' }, 7)
    const p = await service.analyze([src])
    expect(p.items.map((i) => [i.fileName, i.verdict])).toEqual([
      ['TP90-ROOT-L-01.opd', 'new-plan'],
      ['TP90-ROOT-R-01.opd', 'new-plan'],
      ['TP91-ROOT-L-01.opd', 'new-plan']
    ])
    expect(p.newPlans).toHaveLength(2)
    expect(p.newPlans.map((n) => n.suggestedName)).toEqual(['12T · 5MHz · SK90 · 집속 20 · 개선 10+2 · OPD', '12T · 5MHz · SK270 · 집속 20 · 개선 10+2 · OPD'])
    const [l, r, other] = p.items
    expect(l!.newPlanKey).toBe(other!.newPlanKey)
    expect(l!.newPlanKey).not.toBe(r!.newPlanKey)
    expect(l!.meta).toMatchObject({ ndeVersion: { raw: 'OPD · MXU - 4.4R5', family: 'opd' }, deviceFileName: 'TP90-ROOT-L-##', reader: { name: 'opd-structure', version: 4 } })
    expect(p.items.map((i) => i.suggestedSpecimenId)).toEqual(['TP90', 'TP90', 'TP91'])
    expect(l!.warnings).toEqual([])
    expect(other!.warnings).toEqual(['장비 저장 이름(TP91-ROOT-R-##)이 파일 이름과 다릅니다. 시편 ID·좌우(L/R)를 확인하세요.'])
  })

  it('확정 → 사본·셋업 원문(구조 JSON)·OPD 플랜, 다시 분석하면 모두 중복', async () => {
    const r = await service.commit(acceptAll(await service.analyze([src])))
    expect(r).toMatchObject({ status: 'completed', copiedCount: 3, failedCount: 0, createdPlanIds: ['SP001', 'SP002'] })
    expect(r.items.find((i) => i.fileName === 'TP90-ROOT-L-01.opd')?.storedRelPath).toBe('스캔플랜/SP001/TP90/TP90-ROOT-L-01.opd')
    const plans = await service.listPlans()
    expect(plans.map((x) => x.summary)).toEqual([
      '형상 미상 12 mm · 5L64-A32 · -14 mm · PA 섹터 45–48° · 집속 20 mm · 개선 높이 10+2 mm · OPD',
      '형상 미상 12 mm · 5L64-A32 · +14 mm · PA 섹터 45–48° · 집속 20 mm · 개선 높이 10+2 mm · OPD'
    ])
    const files = await service.listFiles({ limit: 10, sort: 'fileName-asc' })
    const cat = openCatalog(join(storeRoot, 'catalog.db'))
    try {
      for (const f of files.items) expect(JSON.parse(cat.getFileSetupJson(f.id)!).format).toBe('opd-structure')
    } finally {
      cat.close()
    }
    const again = await service.analyze([src])
    expect(again.items.every((i) => i.verdict === 'duplicate')).toBe(true)
  })

  it('저장소 점검: 이전 규칙의 OPD 플랜은 사본을 다시 읽어 고치고, 미등록 .opd 사본은 미등록_파일로', async () => {
    const plan = (await service.listPlans())[0]!
    service.close()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(storeRoot, 'catalog.db'))
    db.prepare('UPDATE plans SET fingerprint = ?, spec_version = 1, spec_json = ? WHERE id = ?').run(
      'fp1:old-opd',
      JSON.stringify({ ...plan.spec, specVersion: 1 }),
      plan.id
    )
    db.close()
    put(join(storeRoot, '스캔플랜', 'SP009', 'TP99'), 'orphan.opd')
    service = createAppService({ settingsPath })
    const report = (await service.maintenanceReport())!
    expect(report.upgradedPlanIds).toEqual([plan.id])
    expect(report.upgradeProblems).toEqual([])
    expect(report.quarantined.map((q) => q.from)).toEqual(['스캔플랜/SP009/TP99/orphan.opd'])
    expect((await service.getPlan(plan.id)).fingerprint).toBe(plan.fingerprint)
  })

  it('저장소 점검: 새 규칙으로 다시 계산한 OPD 플랜이 다른 플랜과 같은 셋업이면 스펙은 그대로 두고 \'플랜 합치기 필요\'로 알린다', async () => {
    const [p1, p2] = await service.listPlans()
    service.close()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(storeRoot, 'catalog.db'))
    const stale = { ...p2!.spec, groups: p2!.spec.groups.map((g) => ({ ...g, techniqueParams: { ...g.techniqueParams, opdSpecRule: 0 } })) }
    db.prepare('UPDATE plans SET fingerprint = ?, spec_json = ? WHERE id = ?').run('fp2:old-rule-r', JSON.stringify(stale), p2!.id)
    // 다른 플랜(p1)이 p2 의 새 지문을 이미 갖고 있는 상황 (규칙이 바뀌어 두 플랜이 같은 셋업이 된 경우)
    db.prepare('UPDATE plans SET fingerprint = ? WHERE id = ?').run(p2!.fingerprint, p1!.id)
    db.close()
    service = createAppService({ settingsPath })
    const report = (await service.maintenanceReport())!
    expect(report.upgradedPlanIds).toEqual([])
    expect(report.upgradeProblems).toEqual([expect.stringMatching(new RegExp(`^${p2!.id}: 플랜 합치기 필요 — 새 규칙으로 다시 계산하니 다른 플랜과 같은 셋업입니다`))])
    expect((await service.getPlan(p2!.id)).fingerprint).toBe('fp2:old-rule-r')
    // 같은 실행에서 다시 열어도 같은 알림 (사본을 다시 읽지 않음)
    service.close()
    service = createAppService({ settingsPath })
    expect((await service.maintenanceReport())!.upgradeProblems).toEqual(report.upgradeProblems)
    // 원래대로 되돌린다 (다음 시험이 SP001 = L 플랜을 씀)
    service.close()
    const db2 = new DatabaseSync(join(storeRoot, 'catalog.db'))
    db2.prepare('UPDATE plans SET fingerprint = ? WHERE id = ?').run(p1!.fingerprint, p1!.id)
    db2.prepare('UPDATE plans SET fingerprint = ?, spec_json = ? WHERE id = ?').run(p2!.fingerprint, JSON.stringify(p2!.spec), p2!.id)
    db2.close()
    service = createAppService({ settingsPath })
    expect((await service.maintenanceReport())!.upgradeProblems).toEqual([])
  })

  it('확정 중 원본이 바뀌면 그 항목만 HASH_MISMATCH', async () => {
    const dir = join(work, '바뀜')
    const a = put(dir, 'TP90-ROOT-L-02.opd', { deviceFileName: 'TP90-ROOT-L-##' }, 11)
    put(dir, 'TP90-ROOT-L-03.opd', { deviceFileName: 'TP90-ROOT-L-##' }, 13)
    const p = await service.analyze([dir])
    expect(p.items.map((i) => i.verdict)).toEqual(['match-existing', 'match-existing'])
    const bytes = readFileSync(a)
    bytes[bytes.length - 200] = bytes[bytes.length - 200]! ^ 1
    writeFileSync(a, bytes)
    const r = await service.commit(acceptAll(p))
    expect(r.items.map((i) => [i.fileName, i.status])).toEqual([
      ['TP90-ROOT-L-02.opd', 'failed'],
      ['TP90-ROOT-L-03.opd', 'copied']
    ])
    expect(r.items[0]!.errorMessage).toContain('분석 때와 다릅니다')
    expect((await service.listFiles({ text: 'TP90-ROOT-L-02' })).total).toBe(0)
  })

  it('2축은 경고와 함께 보관, 잘린 파일·매직이 다른 파일은 해석 실패 오류로 격리', async () => {
    const dir = join(work, '섞임')
    put(dir, 'CS90_01.opd', { deviceFileName: 'CS90_##', positions: 10, indexLines: 2 })
    const whole = buildSynthOpd().bytes
    writeFileSync(join(dir, 'cut.opd'), whole.subarray(0, whole.length - 100))
    const bad = whole.slice()
    bad[4] = 0x58
    writeFileSync(join(dir, 'magic.opd'), bad)
    writeFileSync(join(dir, 'empty.opd'), new Uint8Array(0))
    const p = await service.analyze([dir])
    const by = (n: string) => p.items.find((i) => i.fileName === n)!
    // 2축 여부는 .nde 처럼 지문에 넣지 않는다(기록용 scanQuantity·indexQuantity) → 셋업이 같은 TP90 L 플랜에 들어간다
    expect(by('CS90_01.opd')).toMatchObject({ verdict: 'match-existing', matchedPlanId: 'SP001' })
    expect(by('CS90_01.opd').setup!.acquisition.groups[0]).toMatchObject({ scanQuantity: 5, indexQuantity: 2 })
    expect(by('CS90_01.opd').warnings).toEqual(['2축 스캔(인덱스 2줄 × 스캔 5칸)이라 보관만 합니다. 이미지 보기·라벨링은 아직 지원하지 않습니다.'])
    for (const n of ['cut.opd', 'magic.opd']) {
      expect(by(n)).toMatchObject({ verdict: 'error', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
      expect(by(n).errorMessage).toMatch(/^보류\(해석 실패\): /)
    }
    expect(by('empty.opd')).toMatchObject({ verdict: 'error', errorMessage: '빈 파일입니다.' })
    const r = await service.commit(acceptAll(p))
    expect(r).toMatchObject({ status: 'partial', copiedCount: 1, failedCount: 3 })
    expect(r.items.find((i) => i.fileName === 'cut.opd')?.errorMessage).toMatch(/^분석 실패: 보류\(해석 실패\)/)
  })
})
