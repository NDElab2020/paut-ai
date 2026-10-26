/**
 * E2E (Electron 없이 core 서비스만, 실데이터가 있는 PC 에서만): OPD 가져오기 (판단.md 7절 5단계 확인 방법).
 * - PCN교육 폴더(108개)를 임시 저장소로 분석·확정 → 다시 분석하면 모두 중복
 * - 저장소를 다시 열 때 이전 규칙의 OPD 플랜은 사본을 다시 읽어 지문을 고친다
 * - 확정 중 원본이 바뀌면 그 항목만 HASH_MISMATCH
 * - 2축(부식) 파일은 보관만(경고와 함께 저장), 해석 실패 파일은 오류로 격리
 * 원본은 읽기만 한다(앞뒤 크기·수정 시각 비교). 바꾼 파일은 임시 폴더의 사본으로 만든다.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openCatalog } from '@core/catalog'
import { readOpdFile } from '@core/opd'
import { normalizeOpd } from '@core/opd/normalize'
import { createAppService, type AppService } from '@core/service'
import { hashFile, scanInputPaths } from '@core/storage'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { OPD_FILES, RAW_DATA_DIR, opdPath } from '../paths'

const PCN = opdPath('02_라벨완료/PCN교육')
const CORROSION = opdPath(OPD_FILES.corrosionC10)
const TP14 = opdPath(OPD_FILES.tp14RootL)
const HAS = existsSync(RAW_DATA_DIR) && existsSync(PCN) && existsSync(CORROSION) && existsSync(TP14)

const work = mkdtempSync(join(tmpdir(), 'paut-opd-e2e-'))
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

/** 원본 사본에서 래스터 바이트 하나를 바꿔 (구조·셋업은 같고 해시만 다른) 새 파일을 만든다 */
async function variant(from: string, to: string, flip: number): Promise<void> {
  const bytes = readFileSync(from)
  const f = await readOpdFile(from)
  const at = f.raster.offset + flip
  bytes[at] = bytes[at]! ^ 0x5a
  writeFileSync(to, bytes)
}

beforeAll(async () => {
  service = createAppService({ settingsPath })
  await service.setStoreRoot(storeRoot)
})

afterAll(() => {
  service?.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!HAS)('E2E OPD 가져오기 (임시 저장소)', () => {
  let pcnFiles: string[] = []
  let before = new Map<string, { size: number; mtimeMs: number }>()
  let expectedPlans = 0

  it('PCN교육 폴더 분석 → OPD 108개 모두 새 플랜 후보, 셋업 묶음대로 플랜 후보, 경고는 해당 파일에만', async () => {
    pcnFiles = (await scanInputPaths([PCN])).files.filter((f) => f.ext === '.opd').map((f) => f.path)
    expect(pcnFiles).toHaveLength(108)
    before = new Map(pcnFiles.map((f) => [f, { size: statSync(f).size, mtimeMs: statSync(f).mtimeMs }]))
    const fps = new Set<string>()
    for (const f of pcnFiles) fps.add(normalizeOpd(await readOpdFile(f)).fingerprint)
    expectedPlans = fps.size
    expect(expectedPlans).toBe(31)

    const t0 = performance.now()
    const p = await service.analyze([PCN])
    const ms = Math.round(performance.now() - t0)
    const opd = p.items.filter((i) => i.fileName.toLowerCase().endsWith('.opd'))
    expect(opd).toHaveLength(108)
    expect(p.items).toHaveLength(108) // .npz·.jpg 는 관련 없는 확장자로 무시
    expect(p.ignoredCount).toBeGreaterThan(0)
    expect(opd.every((i) => i.verdict === 'new-plan')).toBe(true)
    expect(opd.every((i) => i.meta?.ndeVersion.family === 'opd' && i.meta.reader?.name === 'opd-structure')).toBe(true)
    expect(opd.every((i) => i.meta?.ndeVersion.raw === 'OPD · MXU - 4.4R5')).toBe(true)
    expect(p.newPlans).toHaveLength(expectedPlans)
    expect(p.newPlans.every((n) => n.suggestedName.includes('OPD') && n.summary.endsWith(' · OPD') && n.nearestPlan === null)).toBe(true)
    expect(p.newPlans.map((n) => n.provisionalPlanId)[0]).toBe('SP001')
    // 시편 ID 는 장비 저장 이름의 TP·PL 번호 (TP06 폴더의 tp07 파일은 TP07)
    expect(opd.every((i) => i.suggestedSpecimenSource === 'device-filename' && /^(TP|PL)\d+$/.test(i.suggestedSpecimenId ?? ''))).toBe(true)
    const by = (name: string) => opd.find((i) => i.fileName === name)!
    expect(by('tp07-root-l-01.opd').suggestedSpecimenId).toBe('TP07')
    // 경고: 두께 불일치 PL2386x 29개 · 장비 저장 이름 1개 · 폴더 1개, 나머지는 없음
    const warned = (pred: (w: string) => boolean): string[] => opd.filter((i) => i.warnings.some(pred)).map((i) => i.fileName)
    const thick = warned((w) => w.startsWith('두께 칸'))
    expect(thick).toEqual([])
    expect(warned((w) => w.startsWith('장비 저장 이름'))).toEqual(['PL23865_BOT_L_02.opd'])
    expect(warned((w) => w.startsWith('폴더 이름'))).toEqual(['tp07-root-l-01.opd'])
    expect(opd.filter((i) => i.warnings.length > 0)).toHaveLength(2)
    expect(ms).toBeLessThan(30_000)
  })

  it('확정 → 108개 복사, 플랜 31개, 사본 해시 일치, 셋업 원문 = 구조 JSON, 원본 불변', async () => {
    const p = await service.analyze([PCN])
    const r = await service.commit(acceptAll(p))
    expect(r).toMatchObject({ status: 'completed', copiedCount: 108, failedCount: 0 })
    expect(r.createdPlanIds).toHaveLength(expectedPlans)
    const plans = await service.listPlans()
    expect(plans).toHaveLength(expectedPlans)
    expect(plans.reduce((s, x) => s + x.fileCount, 0)).toBe(108)
    expect(plans.every((x) => x.summary.endsWith(' · OPD'))).toBe(true)
    const files = await service.listFiles({ limit: 1000 })
    expect(files.total).toBe(108)
    for (const f of files.items) {
      expect(f.meta.ndeVersion.family).toBe('opd')
      expect(f.acquisition.groups[0]!.gates.map((g) => g.name)).toEqual(['Gate I', 'Gate A', 'Gate B'])
      expect(await hashFile(join(storeRoot, ...f.storedRelPath.split('/')))).toBe(f.meta.sha256)
    }
    // 재스캔(re/)은 같은 플랜·시편 폴더에 이름이 겹쳐 ' (2)' 로 저장
    const re = files.items.filter((f) => f.meta.sourcePath.includes(`${join('PL23861', 're')}`))
    expect(re).toHaveLength(4)
    expect(re.every((f) => f.specimenId === 'PL23861' && / \(2\)\.opd$/.test(f.storedFileName))).toBe(true)
    const tp07 = files.items.find((f) => f.meta.sourceFileName === 'tp07-root-l-01.opd')!
    expect(tp07.storedRelPath).toMatch(/^스캔플랜\/SP\d{3}\/TP07\/tp07-root-l-01\.opd$/)
    const cat = openCatalog(join(storeRoot, 'catalog.db'))
    try {
      const j = JSON.parse(cat.getFileSetupJson(files.items[0]!.id)!) as { format: string; reader: { name: string; version: number } }
      expect(j.format).toBe('opd-structure')
      expect(j.reader).toEqual({ name: 'opd-structure', version: 4 })
    } finally {
      cat.close()
    }
    for (const f of pcnFiles) {
      const now = statSync(f)
      expect({ size: now.size, mtimeMs: now.mtimeMs }, f).toEqual(before.get(f))
    }
  }, 120_000)

  it('다시 분석하면 모두 중복', async () => {
    const p = await service.analyze([PCN])
    expect(p.items.map((i) => i.verdict).every((v) => v === 'duplicate')).toBe(true)
    expect(p.counts.duplicate).toBe(108)
    expect(p.newPlans).toHaveLength(0)
  })

  it('저장소를 다시 열 때 이전 규칙의 OPD 플랜은 사본을 다시 읽어 지문을 고친다', async () => {
    const plan = (await service.listPlans())[0]!
    service.close()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(storeRoot, 'catalog.db'))
    const g = plan.spec.groups[0]!
    const oldSpec = { ...plan.spec, groups: [{ ...g, techniqueParams: { ...g.techniqueParams, opdSpecRule: 0 } }] }
    db.prepare('UPDATE plans SET fingerprint = ?, spec_json = ? WHERE id = ?').run('fp2:old-opd', JSON.stringify(oldSpec), plan.id)
    db.close()
    service = createAppService({ settingsPath })
    const report = await service.maintenanceReport()
    expect(report!.upgradedPlanIds).toEqual([plan.id])
    expect(report!.upgradeProblems).toEqual([])
    const after = await service.getPlan(plan.id)
    expect(after.fingerprint).toBe(plan.fingerprint)
    expect(after.spec).toEqual(plan.spec)
  })

  it('확정 중 원본이 바뀌면 그 항목만 HASH_MISMATCH, 사본·DB 기록 없음', async () => {
    const src = join(work, '바뀜')
    mkdirSync(src)
    const a = join(src, 'TP14-ROOT-L-07.opd')
    const b = join(src, 'TP14-ROOT-L-08.opd')
    await variant(TP14, a, 1000)
    await variant(TP14, b, 2000)
    const p = await service.analyze([src])
    expect(p.items.map((i) => i.verdict)).toEqual(['match-existing', 'match-existing'])
    const raw = readFileSync(a)
    const f = await readOpdFile(a)
    raw[f.raster.offset + 3000] = raw[f.raster.offset + 3000]! ^ 0x33
    writeFileSync(a, raw)
    const r = await service.commit(acceptAll(p))
    const byName = new Map(r.items.map((i) => [i.fileName, i]))
    expect(byName.get('TP14-ROOT-L-07.opd')).toMatchObject({ status: 'failed', storedRelPath: null })
    expect(byName.get('TP14-ROOT-L-07.opd')?.errorMessage).toContain('분석 때와 다릅니다')
    expect(byName.get('TP14-ROOT-L-08.opd')).toMatchObject({ status: 'copied' })
    expect((await service.listFiles({ text: 'TP14-ROOT-L-07' })).total).toBe(0)
    expect(r.status).toBe('partial')
  })

  it('2축(부식)은 보관만(경고와 함께 저장), 해석 실패는 오류로 격리', async () => {
    const src = join(work, '섞임')
    mkdirSync(src)
    copyFileSync(CORROSION, join(src, basename(CORROSION)))
    const whole = readFileSync(TP14)
    writeFileSync(join(src, 'TP14-cut.opd'), whole.subarray(0, 1 << 20))
    const bad = Buffer.from(whole)
    bad[4] = 0x58 // 'SURD' 매직
    writeFileSync(join(src, 'TP14-badmagic.opd'), bad)
    await variant(TP14, join(src, 'TP14-ROOT-L-09.opd'), 4000)
    const p = await service.analyze([src])
    const by = (n: string) => p.items.find((i) => i.fileName === n)!
    const c10 = by('C10_01.opd')
    expect(c10.verdict).toBe('new-plan')
    expect(c10.warnings.some((w) => w.startsWith('2축 스캔') && w.includes('보관만'))).toBe(true)
    expect(c10.setup!.acquisition.groups[0]).toMatchObject({ scanQuantity: 201, indexQuantity: 5 })
    for (const n of ['TP14-cut.opd', 'TP14-badmagic.opd']) {
      expect(by(n)).toMatchObject({ verdict: 'error', meta: null, setup: null })
      expect(by(n).errorMessage).toMatch(/^보류\(해석 실패\): /)
    }
    expect(by('TP14-ROOT-L-09.opd').verdict).toBe('match-existing')
    const r = await service.commit(acceptAll(p))
    const byName = new Map(r.items.map((i) => [i.fileName, i]))
    expect(byName.get('C10_01.opd')).toMatchObject({ status: 'copied' })
    expect(byName.get('TP14-ROOT-L-09.opd')).toMatchObject({ status: 'copied' })
    expect(byName.get('TP14-cut.opd')?.status).toBe('failed')
    expect(byName.get('TP14-cut.opd')?.errorMessage).toContain('보류(해석 실패)')
    expect(byName.get('TP14-badmagic.opd')?.status).toBe('failed')
    expect(r).toMatchObject({ status: 'partial', copiedCount: 2, failedCount: 2 })
    const plans = await service.listPlans()
    const corrosionPlan = plans.find((x) => x.id === byName.get('C10_01.opd')!.planId)!
    expect(corrosionPlan.fileCount).toBe(1)
    expect(corrosionPlan.summary).toContain('PA 선형 0°')
  })
})
