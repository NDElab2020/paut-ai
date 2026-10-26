/** X3 실데이터(읽기 전용) — 탐색과 사본 복사·해시 검증, 카탈로그 기록까지. 원본은 읽기만 한다. */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openCatalog } from '@core/catalog'
import { copyVerified, ensureStoreRoot, hashFile, plannedRelPath, scanInputPaths, toAbsolutePath, toRelPath } from '@core/storage'
import { X3_DIR, X3_FILES } from '../../paths'
import { makeFile, makePlan } from '../catalog/fixtures'

const hasX3 = existsSync(X3_FILES[0]!)
const dir = mkdtempSync(join(tmpdir(), 'paut-real-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!hasX3)('X3 실데이터', () => {
  it('폴더 탐색: .nde 4개 + 기타 파일, 숨김 .claude 건너뜀', async () => {
    const r = await scanInputPaths([X3_DIR])
    const nde = r.files.filter((f) => f.ext === '.nde').map((f) => f.fileName)
    expect(nde).toEqual(['12T-SV-01-Cap on.nde', '12T-SV-02-Cap on.nde', '12T-SV-03-Cap off.nde', '12T-SV-04-Cap on.nde'])
    expect(r.files.some((f) => f.path.includes('/.claude/'))).toBe(false)
    expect(r.skippedHiddenCount).toBeGreaterThanOrEqual(1)
  })

  it('X3 파일 1개를 임시 저장소로 검증 복사 → 해시 일치, 원본 크기·수정 시각 불변, 카탈로그 기록과 중복 감지', async () => {
    const src = X3_FILES[0]!
    const before = statSync(src)
    const sha = await hashFile(src)
    expect(sha).toMatch(/^[0-9a-f]{64}$/)

    const layout = await ensureStoreRoot(join(dir, '저장소'))
    const rel = plannedRelPath('SP001', 'PL23833', '12T-SV-01-Cap on.nde')
    const r = await copyVerified(src, toAbsolutePath(layout.root, rel), sha)
    expect(r).toMatchObject({ sha256: sha, sizeBytes: before.size, reusedExisting: false })
    expect(toRelPath(layout.root, r.destPath)).toBe('스캔플랜/SP001/PL23833/12T-SV-01-Cap on.nde')
    expect(await hashFile(r.destPath)).toBe(sha)
    expect(statSync(r.destPath).mtimeMs).toBe(before.mtimeMs)

    const after = statSync(src)
    expect(after.size).toBe(before.size)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.mode).toBe(before.mode)

    const cat = openCatalog(layout.catalogPath)
    try {
      const plan = cat.createPlan(makePlan(12, '12T 판재 V개선'))
      cat.ensureSpecimen({ id: 'PL23833', displayName: 'PL23833', source: 'device-filename' })
      const rec = makeFile('x', plan.id, 'PL23833', { sourceFileName: '12T-SV-01-Cap on.nde', stateTag: 'Cap on' })
      rec.meta = { ...rec.meta, sha256: sha, sizeBytes: r.sizeBytes, sourcePath: src }
      rec.storedRelPath = toRelPath(layout.root, r.destPath)
      const saved = cat.insertFile(rec)
      expect(cat.findFileBySha256(sha)?.id).toBe(saved.id)
      expect(cat.listPlans()[0]).toMatchObject({ id: 'SP001', fileCount: 1, specimenCount: 1, totalBytes: before.size })
    } finally {
      cat.close()
    }

    const again = await copyVerified(src, toAbsolutePath(layout.root, rel), sha)
    expect(again).toMatchObject({ destPath: r.destPath, reusedExisting: true })
  })
})
