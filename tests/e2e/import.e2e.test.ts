/**
 * E2E (Electron 없이 core 서비스만): 임시 저장소에 실데이터를 분석·확정한다. 원본은 읽기만 한다.
 * PAUT_E2E_REPORT=<경로> 를 주면 결과 요약을 Markdown 으로 저장한다.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openCatalog } from '@core/catalog'
import { createAppService, type AppService } from '@core/service'
import { hashFile } from '@core/storage'
import { AppError } from '@shared/errors'
import type { ImportCommitRequest, ImportPreview, ProgressEvent } from '@shared/types'
import { EXAMPLES_DIR, TOOL_ROOT, X3_DIR, X3_FILES } from '../paths'
import { buildReport, type E2eReport } from './report'

const OPD = join(TOOL_ROOT, '../06_원시데이터/03_라벨미확인/6.4T_불량/S36-1.opd')
const hasData = X3_FILES.every((f) => existsSync(f)) && existsSync(EXAMPLES_DIR)

const work = mkdtempSync(join(tmpdir(), 'paut-e2e-'))
const storeRoot = join(work, '저장소')
let service: AppService
const events: ProgressEvent[] = []
const report: E2eReport = { startedAt: new Date(), steps: [], storeRoot }

/** 미리보기 그대로 확정 (제안된 시편 ID·태그 사용) */
function acceptAll(p: ImportPreview): ImportCommitRequest {
  return {
    previewId: p.previewId,
    newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
    items: p.items
      .filter((i) => i.verdict === 'match-existing' || i.verdict === 'new-plan')
      .map((i) => ({
        itemId: i.itemId,
        include: true,
        specimenId: i.suggestedSpecimenId ?? '',
        specimenSource: i.suggestedSpecimenSource ?? 'manual',
        stateTag: i.suggestedStateTag,
        round: i.suggestedRound,
        memo: ''
      }))
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

beforeAll(async () => {
  service = createAppService({ settingsPath: join(work, 'settings.json'), onProgress: (ev) => events.push(ev) })
  await service.setStoreRoot(storeRoot)
})

afterAll(() => {
  service?.close()
  const out = process.env.PAUT_E2E_REPORT
  if (out && report.steps.length > 0) writeFileSync(out, buildReport(report), 'utf8')
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!hasData)('E2E 가져오기 (임시 저장소)', () => {
  const originals = X3_FILES.map((f) => ({ f, st: statSync(f) }))

  it('X3 폴더 분석 → 새 플랜 후보 1개, 파일 4개, 시편 4개 제안', async () => {
    const { value: p, ms } = await timed(() => service.analyze([X3_DIR]))
    const nde = p.items.filter((i) => i.fileName.endsWith('.nde'))
    expect(nde.map((i) => i.verdict)).toEqual(['new-plan', 'new-plan', 'new-plan', 'new-plan'])
    expect(p.newPlans).toHaveLength(1)
    expect(p.newPlans[0]).toMatchObject({ provisionalPlanId: 'SP001', suggestedName: '12T · 5MHz · SK90/270', nearestPlan: null })
    expect(p.newPlans[0]!.itemIds).toHaveLength(4)
    expect(nde.map((i) => i.suggestedSpecimenId)).toEqual(['PL23833', 'PL23840', 'PL23841', 'PL23831'])
    expect(nde.map((i) => i.suggestedStateTag)).toEqual(['Cap on', 'Cap on', 'Cap off', 'Cap on'])
    expect(nde.every((i) => i.suggestedSpecimenSource === 'device-filename')).toBe(true)
    expect(p.skippedHiddenCount).toBeGreaterThanOrEqual(1)
    expect(p.ignoredCount).toBe(1)
    expect(events.some((e) => e.operation === 'analyze' && e.operationId === p.previewId && e.phase === 'hash')).toBe(true)
    expect(events.at(-1)).toMatchObject({ operation: 'analyze', phase: 'done' })

    const { value: r, ms: commitMs } = await timed(() => service.commit(acceptAll(p)))
    expect(r).toMatchObject({ copiedCount: 4, failedCount: 0, createdPlanIds: ['SP001'] })
    expect(r.createdSpecimenIds.sort()).toEqual(['PL23831', 'PL23833', 'PL23840', 'PL23841'])
    expect(r.items.find((i) => i.fileName === '12T-SV-01-Cap on.nde')?.storedRelPath).toBe('스캔플랜/SP001/PL23833/12T-SV-01-Cap on.nde')
    report.steps.push({
      title: 'X3 폴더 분석 → 확정',
      preview: p,
      result: r,
      analyzeMs: ms,
      commitMs,
      notes: [
        '4개 파일의 셋업은 게이트 길이 반올림(1e-8 수준) 외에 같아 지문 1개 → 새 플랜 1개(SP001)',
        '시편 ID 는 장비 원본 파일명(SaveFileName, 예: 12T-SV-PL23833-i15-CAP20)의 PL 번호, 상태 태그는 현재 파일명의 Cap on/off',
        '숨김 폴더 .claude 건너뜀, 00_결함정보.docx 는 관련 없는 확장자로 무시'
      ]
    })
  })

  it('DB·저장소 상태: 플랜 1, 시편 4, 파일 4, 해시 일치, 원본 불변', async () => {
    const plans = await service.listPlans()
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ id: 'SP001', fileCount: 4, specimenCount: 4 })
    expect(await service.listSpecimens()).toHaveLength(4)
    const files = await service.listFiles({ limit: 1000, sort: 'fileName-asc' })
    expect(files.total).toBe(4)
    for (const f of files.items) {
      const abs = join(storeRoot, ...f.storedRelPath.split('/'))
      expect(await hashFile(abs)).toBe(f.meta.sha256)
      expect(f.storedRelPath).toBe(`스캔플랜/SP001/${f.specimenId}/${f.storedFileName}`)
    }
    expect(files.items.map((f) => `${f.specimenId}:${f.stateTag}`)).toEqual([
      'PL23833:Cap on',
      'PL23840:Cap on',
      'PL23841:Cap off',
      'PL23831:Cap on'
    ])
    for (const { f, st } of originals) {
      const now = statSync(f)
      expect([now.size, now.mtimeMs, now.mode]).toEqual([st.size, st.mtimeMs, st.mode])
    }
    const cat = openCatalog(join(storeRoot, 'catalog.db'))
    try {
      expect(cat.getFileSetupJson(files.items[0]!.id)).toContain('"groups"')
      expect(cat.listImportItems(cat.listImportHistory()[0]!.batchId).filter((i) => i.status === 'copied')).toHaveLength(4)
    } finally {
      cat.close()
    }
    const hist = await service.history()
    expect(hist[0]).toMatchObject({ status: 'completed', copiedCount: 4, createdPlanIds: ['SP001'] })
  })

  it('같은 4개를 다시 분석 → 모두 duplicate', async () => {
    const { value: p, ms } = await timed(() => service.analyze(X3_FILES))
    expect(p.items.map((i) => i.verdict)).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate'])
    expect(p.items[0]!.duplicateOf).toMatchObject({ planId: 'SP001', specimenId: 'PL23833' })
    report.steps.push({ title: 'X3 4개 다시 분석', preview: p, analyzeMs: ms })
  })

  it('.opd 를 섞으면 OPD 로 분석(NDE 플랜과 섞이지 않는 새 플랜 후보), 같은 배치 안 같은 파일은 duplicate', async () => {
    const inputs = existsSync(OPD) ? [OPD, X3_FILES[0]!] : [X3_FILES[0]!]
    const { value: p, ms } = await timed(() => service.analyze([...inputs, X3_FILES[0]!]))
    if (existsSync(OPD)) {
      const opd = p.items.find((i) => i.fileName === 'S36-1.opd')
      expect(opd).toMatchObject({ verdict: 'new-plan', meta: { ndeVersion: { family: 'opd' } } })
      expect(opd?.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(p.newPlans.find((n) => n.key === opd?.newPlanKey)?.summary).toContain('OPD')
    }
    expect(p.items.filter((i) => i.fileName.endsWith('.nde'))).toHaveLength(1)
    expect(p.items.find((i) => i.fileName.endsWith('.nde'))?.verdict).toBe('duplicate')
    report.steps.push({ title: '.opd 섞어 분석', preview: p, analyzeMs: ms, notes: ['입력: S36-1.opd(읽기만) + X3 파일 1개를 두 번 → .opd 는 OPD 구조 읽기로 새 플랜 후보(확정하지 않음), X3 는 카탈로그 중복, 두 번 넣은 같은 경로는 한 번만 셈'] })
  })

  it('공식 예제 폴더 전체 분석 → 버전별 처리, 같은 측정은 같은 플랜 후보로 묶임 → 확정', async () => {
    const { value: p, ms } = await timed(() => service.analyze([EXAMPLES_DIR]))
    const nde = p.items.filter((i) => i.fileName.endsWith('.nde'))
    expect(nde).toHaveLength(11)
    expect(nde.every((i) => i.verdict === 'new-plan')).toBe(true)
    const keyOf = (name: string): string | null => nde.find((i) => i.fileName === name)?.newPlanKey ?? null
    expect(keyOf('ManualWeldPA.nde')).toBe(keyOf('ManualWeldPA-4.0.nde'))
    expect(keyOf('Weld_Plate_UT-sk90-4.1.nde')).toBe(keyOf('Weld_Plate_UT-sk90-4.2.nde'))
    expect(keyOf('Weld_Plate_4TFM_sk90-4.1.nde')).toBe(keyOf('Weld_Plate_4TFM_sk90-4.2.nde'))
    expect(p.newPlans).toHaveLength(8)
    expect(p.newPlans.map((n) => n.provisionalPlanId)).toEqual(['SP002', 'SP003', 'SP004', 'SP005', 'SP006', 'SP007', 'SP008', 'SP009'])
    expect(p.newPlans.every((n) => n.nearestPlan?.planId === 'SP001' && n.nearestPlan.differences.length > 0)).toBe(true)

    const { value: r, ms: commitMs } = await timed(() => service.commit(acceptAll(p)))
    expect(r).toMatchObject({ copiedCount: 11, failedCount: 0 })
    expect(r.createdPlanIds).toEqual(['SP002', 'SP003', 'SP004', 'SP005', 'SP006', 'SP007', 'SP008', 'SP009'])
    const plans = await service.listPlans()
    expect(plans).toHaveLength(9)
    expect(plans.reduce((s, x) => s + x.fileCount, 0)).toBe(15)
    expect((await service.listFiles({ limit: 1000 })).total).toBe(15)
    report.steps.push({
      title: '공식 예제 11개 분석 → 확정',
      preview: p,
      result: r,
      analyzeMs: ms,
      commitMs,
      plans,
      notes: [
        '11개 → 새 플랜 8개. 같은 측정을 다른 버전으로 저장한 3쌍이 버전 간 정규화 후 같은 지문: ManualWeldPA 3.3 ↔ 4.0.0-Dev, Weld_Plate_UT 4.1 ↔ 4.2, Weld_Plate_4TFM 4.1 ↔ 4.2',
        '나머지는 두께·재질·탐촉자·인덱스 오프셋·기법(섹터/복합/TFM/UT/ToFD)이 서로 달라 각각 별도 플랜',
        '공식 예제는 파일명에 PL·TP 번호가 없어 파일명(확장자 제외)을 시편 ID 로 임시 제안함 → 같은 측정의 버전 변환본도 시편이 따로 생김(실사용에서는 미리보기에서 고쳐 쓰면 됨)',
        '모든 파일 SHA-256 이 서로 달라 중복 없음'
      ]
    })
  })

  it('분석과 확정 사이에 원본이 바뀌면 그 항목만 실패, 사본·DB 기록 없음', async () => {
    const src = join(work, 'src')
    mkdirSync(src)
    const a = join(src, 'PL90001-changed.nde')
    const b = join(src, 'PL90002-same.nde')
    copyFileSync(join(EXAMPLES_DIR, '3.3/ManualWeldUT.nde'), a)
    copyFileSync(join(EXAMPLES_DIR, '4.1/Weld_Plate_UT-sk90-4.1.nde'), b)
    // 공식 예제와 내용이 같으면 duplicate 이므로 끝에 1바이트를 덧붙여 다른 파일로 만든다 (HDF5 는 EOF 뒤 바이트를 무시)
    appendFileSync(a, Buffer.from([1]))
    appendFileSync(b, Buffer.from([2]))
    const p = await service.analyze([src])
    expect(p.items.map((i) => i.verdict)).toEqual(['match-existing', 'match-existing'])
    appendFileSync(a, Buffer.from([3]))
    const r = await service.commit(acceptAll(p))
    const byName = new Map(r.items.map((i) => [i.fileName, i]))
    expect(byName.get('PL90001-changed.nde')).toMatchObject({ status: 'failed', storedRelPath: null })
    expect(byName.get('PL90001-changed.nde')?.errorMessage).toContain('분석 때와 다릅니다')
    expect(byName.get('PL90002-same.nde')).toMatchObject({ status: 'copied' })
    expect((await service.listFiles({ text: 'PL90001' })).total).toBe(0)
    expect(existsSync(join(storeRoot, '스캔플랜', p.items[0]!.matchedPlanId!, 'PL90001'))).toBe(false)
    const hist = await service.history()
    expect(hist[0]).toMatchObject({ status: 'partial', copiedCount: 1, failedCount: 1 })
    report.steps.push({
      title: '원본 변경 감지 (임시 사본으로 시험)',
      preview: p,
      result: r,
      notes: ['공식 예제 2개를 임시 폴더에 복사·1바이트 덧붙여 새 파일로 만든 뒤 분석, 그중 1개를 확정 전에 다시 바꿈 → 그 항목만 실패, 사본·빈 폴더·DB 기록 남지 않음, 배치 상태 partial']
    })
  })

  it('만료된 미리보기, 취소, 동시 작업 잠금', async () => {
    await expect(service.commit({ previewId: 'PV-none', newPlans: [], items: [] })).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' })

    const pending = service.analyze([EXAMPLES_DIR])
    await expect(service.analyze([X3_DIR])).rejects.toMatchObject({ code: 'BUSY' })
    const op = service.activeOperation()
    expect(op).toMatch(/^PV-/)
    expect(service.cancel(op!)).toBe(true)
    await expect(pending).rejects.toBeInstanceOf(AppError)
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(service.activeOperation()).toBeNull()
    expect(service.cancel(op!)).toBe(false)
    report.extra = [...(report.extra ?? []), '만료된 미리보기 확정 → PREVIEW_EXPIRED, 분석 중 두 번째 분석 → BUSY, 분석 취소 → CANCELLED 후 잠금 해제']
  })

  it('저장된 사본 경로와 저장소 밖 경로 차단', async () => {
    const f = (await service.listFiles({ limit: 1 })).items[0]!
    const abs = await service.storedFilePath(f.id)
    expect(relative(storeRoot, abs).startsWith('..')).toBe(false)
    await expect(service.getFile(999999)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
