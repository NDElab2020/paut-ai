import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAppService } from '@core/service'
import { readOpdFile } from '@core/opd'
import { OPD_READER } from '@core/opd/types'
import { OPD_SPEC_RULE } from '@core/opd/normalize'
import { openCatalog } from '@core/catalog'
import { hashFile } from '@core/storage'
import { OPD_FILES, opdPath } from '../../paths'

const source = opdPath(OPD_FILES.pl23861RootL)

/** 옛 규칙 플랜을 흉내 낸 저장소: rule = 옛 스펙 규칙(techniqueParams.opdSpecRule), summary = 옛 요약 줄 */
async function setup(rule = 1, oldSummary?: string) {
  const work = mkdtempSync(join(tmpdir(), 'paut-opd-upgrade-'))
  const root = join(work, 'store')
  const settingsPath = join(work, 'settings.json')
  const service = createAppService({ settingsPath })
  await service.setStoreRoot(root)
  const preview = await service.analyze([source])
  await service.commit({
    previewId: preview.previewId,
    newPlans: preview.newPlans.map((p) => ({ key: p.key, name: p.suggestedName })),
    items: preview.items.map((f) => ({ itemId: f.itemId, include: true, specimenId: f.suggestedSpecimenId!, specimenSource: f.suggestedSpecimenSource!, memo: '사용자 메모', round: 7, stateTag: '재스캔' }))
  })
  const file = (await service.listFiles({ limit: 1 })).items[0]!
  const plan = await service.getPlan(file.planId)
  service.close()
  const db = new DatabaseSync(join(root, 'catalog.db'))
  const oldSpec = { ...plan.spec, specimen: { ...plan.spec.specimen, shape: 'unknown', materialName: null, weld: null },
    groups: plan.spec.groups.map((g) => ({ ...g, techniqueParams: { ...g.techniqueParams, opdSpecRule: rule } })) }
  const oldMeta = { ...file.meta, reader: { name: 'opd-structure', version: 2 } }
  db.prepare('UPDATE plans SET spec_json = ?, fingerprint = ?, summary = ? WHERE id = ?').run(JSON.stringify(oldSpec), 'fp2:old-metadata', oldSummary ?? plan.summary, plan.id)
  db.prepare('UPDATE files SET meta_json = ?, acquisition_json = ? WHERE id = ?').run(JSON.stringify(oldMeta), JSON.stringify({ ...file.acquisition, groups: [] }), file.id)
  db.prepare('UPDATE file_setups SET setup_json = ? WHERE file_id = ?').run(JSON.stringify({ format: 'opd-structure', reader: oldMeta.reader }), file.id)
  db.close()
  return { work, root, settingsPath, file, plan }
}

describe.skipIf(!existsSync(source))('OPD 저장소 읽기 규칙 갱신', () => {
  it('지문 규칙이 같아도 옛 reader의 파일 수집 설정을 다시 읽는다', async () => {
    const s = await setup(OPD_SPEC_RULE)
    const db = new DatabaseSync(join(s.root, 'catalog.db'))
    db.prepare('UPDATE plans SET spec_json = ?, fingerprint = ? WHERE id = ?').run(JSON.stringify(s.plan.spec), s.plan.fingerprint, s.plan.id)
    db.close()
    const service = createAppService({ settingsPath: s.settingsPath })
    try {
      expect((await service.maintenanceReport())!.upgradedPlanIds).toEqual([s.plan.id])
      expect((await service.getPlan(s.plan.id)).fingerprint).toBe(s.plan.fingerprint)
      const file = (await service.listFiles({ limit: 1 })).items[0]!
      expect(file.meta.reader).toEqual(OPD_READER)
      expect(file.acquisition.groups).toHaveLength(1)
      expect(file.memo).toBe('사용자 메모')
    } finally { service.close(); rmSync(s.work, { recursive: true, force: true }) }
  })
  it('플랜과 파일 설정을 함께 갱신하고 파일 ID·시편·해시·사용자 입력을 유지한다', async () => {
    const sourceHash = await hashFile(source)
    const s = await setup()
    const service = createAppService({ settingsPath: s.settingsPath })
    try {
      const report = await service.maintenanceReport()
      expect(report!.upgradedPlanIds).toEqual([s.plan.id])
      expect(report!.upgradeProblems).toEqual([])
      const plan = await service.getPlan(s.plan.id)
      expect(plan.fingerprint).toBe(s.plan.fingerprint)
      expect(plan.spec.groups[0]!.techniqueParams['opdSpecRule']).toBe(OPD_SPEC_RULE)
      expect(plan.spec.specimen.weld!.root!.heightMm).toBe(11.5)
      const file = (await service.listFiles({ limit: 1 })).items[0]!
      expect(file).toMatchObject({ id: s.file.id, planId: s.file.planId, specimenId: s.file.specimenId, storedRelPath: s.file.storedRelPath,
        memo: '사용자 메모', round: 7, stateTag: '재스캔', meta: { sha256: sourceHash, reader: OPD_READER } })
      expect(file.acquisition.groups).toHaveLength(1)
      const catalog = openCatalog(join(s.root, 'catalog.db'))
      try {
        const raw = JSON.parse(catalog.getFileSetupJson(file.id)!)
        expect(raw.reader).toEqual(OPD_READER)
        expect(raw.setup.weld.root.heightMm).toBeCloseTo(11.5, 9)
      } finally { catalog.close() }
      expect(await hashFile(source)).toBe(sourceHash)
    } finally { service.close(); rmSync(s.work, { recursive: true, force: true }) }
  })

  it('스펙 규칙 2 플랜(PL2386x 양면 V, 옛 요약 \'형상 미상 · 두께 확인 필요\') → 새 지문·요약, 이름은 그대로', async () => {
    const s = await setup(2, '형상 미상 25 mm · 5L64-A32 · -18 mm · PA 섹터 45–70° · 집속 25 mm · 채움 11.5+2 mm · 두께 확인 필요 · OPD')
    const service = createAppService({ settingsPath: s.settingsPath })
    try {
      const report = await service.maintenanceReport()
      expect(report!.upgradedPlanIds).toEqual([s.plan.id])
      expect(report!.upgradeProblems).toEqual([])
      const plan = await service.getPlan(s.plan.id)
      expect(plan.fingerprint).toBe(s.plan.fingerprint)
      expect(plan.name).toBe(s.plan.name)
      expect(plan.summary).toBe('판재 25 mm · X 개선 · 5L64-A32 · -18 mm · PA 섹터 45–70° · 집속 25 mm · 개선 높이 11.5+2+11.5 mm · OPD')
      expect(plan.spec.specimen).toMatchObject({ shape: 'plate', materialName: 'STEEL, MILD', estimatedFields: ['shape', 'materialName'],
        weld: { bevelShape: 'X', template: 'DoubleVOffset', symmetry: 'Symmetric', hotPass: { heightMm: 11.5 }, land: { heightMm: 2 }, root: { heightMm: 11.5 } } })
    } finally { service.close() }
    // 한 번 고친 뒤 다시 열면 할 일이 없다
    const again = createAppService({ settingsPath: s.settingsPath })
    try {
      expect((await again.maintenanceReport())!.upgradedPlanIds).toEqual([])
    } finally { again.close(); rmSync(s.work, { recursive: true, force: true }) }
  })

  it('내용이 바뀐 저장소 사본에서 스펙을 갱신하지 않는다', async () => {
    const s = await setup()
    const path = join(s.root, ...s.file.storedRelPath.split('/'))
    const f = await readOpdFile(path)
    const bytes = readFileSync(path)
    bytes[f.raster.offset + 23] = bytes[f.raster.offset + 23]! ^ 0x5a
    writeFileSync(path, bytes)
    const service = createAppService({ settingsPath: s.settingsPath })
    try {
      const report = await service.maintenanceReport()
      expect(report!.upgradedPlanIds).toEqual([])
      expect(report!.upgradeProblems.join(' ')).toContain('가져올 때와 다릅니다')
      expect((await service.getPlan(s.plan.id)).fingerprint).toBe('fp2:old-metadata')
      expect((await service.listFiles({ limit: 1 })).items[0]!.meta.reader!.version).toBe(2)
    } finally { service.close(); rmSync(s.work, { recursive: true, force: true }) }
  })
})
