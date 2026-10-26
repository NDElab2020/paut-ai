/**
 * 저장소를 열 때 한 번: (1) 끝나지 않은 배치 닫기 (2) .partial·미등록 사본 정리 (3) 정규화 규칙이 바뀐 플랜의 스펙·지문 갱신.
 * 어느 단계가 실패해도 저장소 열기는 계속한다 (결과 보고에 남긴다).
 * (3) .nde 플랜은 보관된 셋업 원문(file_setups)으로, OPD 플랜은 저장소 사본을 다시 읽어 계산한다
 *     (OPD 는 읽기 규칙이 바뀌면 새 칸이 생길 수 있어 보관한 구조 JSON 을 믿지 않는다 — 판단.md 4절).
 */
import { AppError, toApiError } from '@shared/errors'
import { SPEC_VERSION, isOpdSpec, type NdeFormatVersion, type NormalizedSetup, type PlanId, type ScanPlanSpec, type StoreMaintenanceReport } from '@shared/types'
import { localIso, type Catalog } from '../catalog'
import { initNde, normalizeSetup, parseNdeVersion } from '../nde'
import { readOpdFile, type OpdFile } from '../opd'
import { opdFileMeta, opdSetupText } from '../opd/meta'
import { normalizeOpd, OPD_SPEC_RULE } from '../opd/normalize'
import { OPD_READER } from '../opd/types'
import { hashFile, recoverStore, toAbsolutePath } from '../storage'

/** OPD 플랜을 다시 계산해야 하는지: 공통 규칙 버전이나 OPD 스펙 규칙(techniqueParams.opdSpecRule)이 지금과 다름 */
export function isStaleOpdSpec(spec: ScanPlanSpec): boolean {
  if ((spec.specVersion ?? 0) < SPEC_VERSION) return true
  return spec.groups.some((g) => g.techniqueParams?.['opdSpecRule'] !== OPD_SPEC_RULE)
}

/** 수집 메타데이터만 늘어난 읽기 규칙도 모든 사본을 갱신한다. */
function hasStaleOpdReader(catalog: Catalog, planId: PlanId): boolean {
  for (let offset = 0; ; ) {
    const page = catalog.listFiles({ planId, limit: 1000, offset })
    if (page.items.some((f) => f.meta.reader?.name !== OPD_READER.name || f.meta.reader.version !== OPD_READER.version)) return true
    offset += page.items.length
    if (!page.items.length || offset >= page.total) return false
  }
}

/**
 * OPD 플랜의 저장소 사본을 다시 읽어 정규화한다. 가져온 순서로 첫 번째로 읽히는 사본을 기준으로 삼고,
 * 다른 사본의 지문이 그와 다르면 notes 에 남긴다(파일은 옮기지 않는다).
 */
export async function renormalizeOpdPlan(catalog: Catalog, root: string, planId: PlanId): Promise<{ setup: NormalizedSetup; notes: string[]; fileUpdates: Array<{ id: number; file: OpdFile; setup: NormalizedSetup }> }> {
  // 한 쪽 상한(1000)을 넘는 플랜도 모든 사본을 본다 (쪽을 넘겨 읽음)
  const files: ReturnType<Catalog['listFiles']>['items'] = []
  for (let offset = 0; ; ) {
    const page = catalog.listFiles({ planId, limit: 1000, offset, sort: 'importedAt-asc' })
    files.push(...page.items)
    offset += page.items.length
    if (page.items.length === 0 || offset >= page.total) break
  }
  let base: NormalizedSetup | null = null
  const failed: string[] = []
  let differ = 0
  const fileUpdates: Array<{ id: number; file: OpdFile; setup: NormalizedSetup }> = []
  for (const f of files) {
    try {
      const path = toAbsolutePath(root, f.storedRelPath)
      if (await hashFile(path) !== f.meta.sha256) throw new AppError('HASH_MISMATCH', '저장소 사본의 내용이 가져올 때와 다릅니다.')
      const parsed = await readOpdFile(path)
      const norm = normalizeOpd(parsed)
      fileUpdates.push({ id: f.id, file: parsed, setup: norm })
      if (!base) base = norm
      else if (norm.fingerprint !== base.fingerprint) differ++
    } catch (err) {
      failed.push(`${f.storedFileName}(${toApiError(err).message})`)
    }
  }
  if (!base) {
    throw new AppError('NOT_FOUND', `저장소의 OPD 사본을 읽지 못해 지문을 다시 계산하지 못했습니다${failed.length ? `: ${failed.slice(0, 3).join(', ')}` : '(파일 없음)'}.`)
  }
  const notes: string[] = []
  if (differ > 0) notes.push(`${planId}: 사본 ${differ}개는 새 규칙으로 계산한 셋업이 이 플랜과 다릅니다. 파일을 다시 확인하세요.`)
  if (failed.length > 0) notes.push(`${planId}: 사본 ${failed.length}개를 읽지 못했습니다: ${failed.slice(0, 3).join(', ')}`)
  return { setup: base, notes, fileUpdates }
}

/**
 * 새 규칙으로 다시 계산한 OPD 플랜 지문이 다른 플랜과 같아 바꾸지 못한(CONFLICT) 플랜 — 같은 실행 동안 다시 시도하지 않는다
 * (열 때마다 모든 사본을 다시 읽지 않게). 열쇠 = 저장소|플랜|스펙 규칙|파일 수. 규칙이 바뀌거나 파일이 늘면 다시 시도한다
 */
const opdMergeNeeded = new Map<string, string>()

/**
 * 이전 규칙으로 만든 플랜의 스펙·지문을 다시 계산한다.
 * .nde 플랜(specVersion < SPEC_VERSION)은 보관된 셋업 원문으로, OPD 플랜(isStaleOpdSpec)은 저장소(root) 사본을 다시 읽어서.
 * OPD 플랜이 새 규칙에서 다른 플랜과 같은 셋업이 되면(CONFLICT) 스펙은 그대로 두고 '플랜 합치기 필요'로 알린다.
 */
export async function upgradePlanSpecs(catalog: Catalog, root?: string): Promise<{ upgraded: string[]; problems: string[] }> {
  const upgraded: string[] = []
  const problems: string[] = []
  const plans = catalog.listPlans()
  const staleOpd = plans.filter((p) => isOpdSpec(p.spec) && (isStaleOpdSpec(p.spec) || hasStaleOpdReader(catalog, p.id)))
  const stale = plans.filter((p) => !isOpdSpec(p.spec) && (p.spec.specVersion ?? 0) < SPEC_VERSION)
  await upgradeNdePlans(catalog, stale, upgraded, problems)
  for (const plan of staleOpd) {
    if (!root) {
      problems.push(`${plan.id}: 저장소 위치를 몰라 OPD 사본을 다시 읽지 못했습니다.`)
      continue
    }
    const memoKey = `${root}|${plan.id}|${OPD_SPEC_RULE}|${catalog.listFiles({ planId: plan.id, limit: 1 }).total}`
    const known = opdMergeNeeded.get(memoKey)
    if (known) {
      problems.push(known)
      continue
    }
    try {
      const { setup, notes, fileUpdates } = await renormalizeOpdPlan(catalog, root, plan.id)
      try {
        catalog.transaction(() => {
          catalog.updatePlanSpec(plan.id, { fingerprint: setup.fingerprint, spec: setup.spec, summary: setup.summary })
          for (const update of fileUpdates) catalog.refreshOpdFileSetup(update.id, opdFileMeta(update.file), update.setup.acquisition, opdSetupText(update.file))
        })
      } catch (err) {
        const e = toApiError(err)
        if (e.code !== 'CONFLICT') throw err
        const msg = `${plan.id}: 플랜 합치기 필요 — 새 규칙으로 다시 계산하니 다른 플랜과 같은 셋업입니다(${e.message}). 예전 스펙을 그대로 두었습니다.`
        opdMergeNeeded.set(memoKey, msg)
        problems.push(msg, ...notes)
        continue
      }
      upgraded.push(plan.id)
      problems.push(...notes)
    } catch (err) {
      problems.push(`${plan.id}: ${toApiError(err).message}`)
    }
  }
  return { upgraded, problems }
}

/** .nde 플랜: 보관된 셋업 원문으로 다시 정규화 */
async function upgradeNdePlans(catalog: Catalog, stale: ReturnType<Catalog['listPlans']>, upgraded: string[], problems: string[]): Promise<void> {
  if (stale.length === 0) return
  await initNde()
  for (const plan of stale) {
    try {
      const fileId = catalog.firstFileIdOfPlan(plan.id)
      const text = fileId === null ? null : catalog.getFileSetupJson(fileId)
      if (fileId === null || !text) {
        problems.push(`${plan.id}: 보관된 셋업 원문이 없어 지문을 다시 계산하지 못했습니다.`)
        continue
      }
      const file = catalog.getFile(fileId)
      const version: NdeFormatVersion | undefined = file?.meta.ndeVersion?.raw ? parseNdeVersion(file.meta.ndeVersion.raw) : undefined
      const norm = normalizeSetup(JSON.parse(text), version)
      catalog.updatePlanSpec(plan.id, { fingerprint: norm.fingerprint, spec: norm.spec, summary: norm.summary })
      upgraded.push(plan.id)
    } catch (err) {
      problems.push(`${plan.id}: ${toApiError(err).message}`)
    }
  }
}

export async function maintainStore(root: string, catalog: Catalog, now: Date = new Date()): Promise<StoreMaintenanceReport> {
  const report: StoreMaintenanceReport = {
    checkedAt: localIso(now),
    interruptedBatchCount: 0,
    removedPartialCount: 0,
    quarantined: [],
    quarantineDir: null,
    upgradedPlanIds: [],
    upgradeProblems: [],
    problems: []
  }
  try {
    report.interruptedBatchCount = catalog.closeInterruptedBatches()
  } catch (err) {
    report.problems.push(`가져오기 이력 정리: ${toApiError(err).message}`)
  }
  try {
    const r = await recoverStore(root, catalog.listStoredRelPaths(), now)
    report.removedPartialCount = r.removedPartialCount
    report.quarantined = r.quarantined
    report.quarantineDir = r.quarantineDir
    report.problems.push(...r.problems)
  } catch (err) {
    report.problems.push(`저장소 폴더 점검: ${toApiError(err).message}`)
  }
  const up = await upgradePlanSpecs(catalog, root)
  report.upgradedPlanIds = up.upgraded
  report.upgradeProblems = up.problems
  return report
}

/** 화면에 알릴 만한 내용이 있는지 */
export function isNoteworthy(r: StoreMaintenanceReport | null): boolean {
  return (
    !!r &&
    (r.interruptedBatchCount > 0 ||
      r.quarantined.length > 0 ||
      r.upgradedPlanIds.length > 0 ||
      r.upgradeProblems.length > 0 ||
      r.problems.length > 0)
  )
}
