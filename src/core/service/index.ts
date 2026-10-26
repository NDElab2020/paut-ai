/**
 * 앱 서비스 — IPC 계약의 Electron 비의존 부분 (설정·카탈로그·가져오기·작업 잠금·취소).
 * main 의 핸들러는 이 서비스에 위임하고 대화상자·탐색기 열기만 직접 한다. vitest 로 그대로 E2E 검증한다.
 */
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import type {
  FileAnnotationPatch,
  FileListPage,
  FileQuery,
  SpecimenPatch,
  ViewerCscanExportRequest,
  ViewerCscanExportResult,
  ViewerOpenResult
} from '@shared/api'
import { AppError } from '@shared/errors'
import { cscanToOmniTxt, omniCscanIndexAxis, omniCscanTxtFileName, omniCscanUnconfirmed } from '@shared/imaging/cscanExport'
import { applyGateOverride, createGateCscan, fillGateCscan, findGate, type GateOverrideLike } from '@shared/imaging/gates'
import { PAL_MAX_BYTES, parsePal } from '@shared/imaging/palette'
import type { ViewerFileInfo, ViewerGroup, ViewerPaletteFile, ViewerVolumeChunk } from '@shared/imaging/types'
import { chunkRanges } from '@shared/imaging/volume'
import type {
  AppSettings,
  FileId,
  FileRecord,
  ImportCommitRequest,
  ImportHistoryEntry,
  ImportPreview,
  ImportResult,
  PlanId,
  ProgressEvent,
  ScanPlan,
  Specimen,
  SpecimenId,
  SpecimenSummary,
  StoreMaintenanceReport
} from '@shared/types'
import { openCatalog, type Catalog } from '../catalog'
import { analyzeImport, commitImport, createPreviewStore, newBatchId, newPreviewId, type PreviewStore } from '../import'
import { initNde } from '../nde'
import { readStoredViewerChunk, readStoredViewerInfo } from '../opd/viewer'
import { cleanPcId, loadSettings, updateSettings, type SettingsPatch } from '../settings'
import { containsSourceData, ensureStoreRoot, resolveStoreLayout, toAbsolutePath } from '../storage'
import { assertExportTarget } from './exportTarget'
import { createLabelService, type LabelService } from './labels'
import { maintainStore } from './maintenance'

export { maintainStore, upgradePlanSpecs, isNoteworthy, isStaleOpdSpec, renormalizeOpdPlan } from './maintenance'
export { createLabelService, workbookGroupsOf, type LabelService, type LabelServiceDeps } from './labels'
export { applyWorkbook, isWorkbookUuid, type WorkbookApplyResult } from './labelWorkbook'

export interface ServiceOptions {
  settingsPath: string
  onProgress?: (ev: ProgressEvent) => void
  /** 테스트용 시계 */
  now?: () => Date
  previewTtlMs?: number
}

export interface AppService {
  getSettings(): Promise<AppSettings>
  /** storeRoot 를 바꾸면 폴더를 검증하고 카탈로그를 다시 연다 */
  updateSettings(patch: SettingsPatch): Promise<AppSettings>
  setStoreRoot(dir: string): Promise<string>
  catalogPath(): Promise<string | null>

  listPlans(): Promise<ScanPlan[]>
  getPlan(id: PlanId): Promise<ScanPlan>
  renamePlan(id: PlanId, name: string): Promise<ScanPlan>
  setPlanNote(id: PlanId, note: string): Promise<ScanPlan>
  listSpecimens(planId?: PlanId): Promise<SpecimenSummary[]>
  getSpecimen(id: SpecimenId): Promise<SpecimenSummary>
  updateSpecimen(id: SpecimenId, patch: SpecimenPatch): Promise<Specimen>
  listFiles(query: FileQuery): Promise<FileListPage>
  getFile(id: FileId): Promise<FileRecord>
  updateFile(id: FileId, patch: FileAnnotationPatch): Promise<FileRecord>
  /** 저장된 사본의 절대경로 (없으면 NOT_FOUND) */
  storedFilePath(id: FileId): Promise<string>
  /** 이미지 보기: 저장된 사본의 그룹·축·빔·게이트·화면 상태 (가져오기 잠금과 무관한 읽기 전용) */
  viewerOpen(id: FileId): Promise<ViewerOpenResult>
  /**
   * 이미지 보기: 그룹 진폭 조각. key 는 viewerOpen 이 준 키 — 그사이 저장소를 바꿨거나 사본이 바뀌어
   * 지금 키와 다르면 CONFLICT (다른 저장소의 같은 번호 파일이 옛 키의 캐시에 섞이지 않게)
   */
  viewerChunk(id: FileId, key: string, groupId: number, scanStart: number, scanCount: number): Promise<ViewerVolumeChunk>
  /** C-scan 내보내기 기본 파일 이름 (OmniPC 꼴 `<자료파일>_YYYY_MM_DD HHhMMmSSs.txt`, X8) */
  cscanExportFileName(req: ViewerCscanExportRequest): Promise<string>
  /**
   * 저장된 사본에서 그 그룹의 게이트 C-scan 을 다시 계산해 OmniPC 'Export C-scan' 꼴 .txt 로 쓴다 (X8).
   * path 는 main 대화상자가 고른 경로(.txt 가 아니면 붙인다). 저장소 폴더 안에는 쓰지 않는다. 원본·사본은 읽기만
   */
  exportCscanTxt(req: ViewerCscanExportRequest, path: string): Promise<ViewerCscanExportResult>
  /** 사용자가 고른 OmniPC 색표(.pal) 읽기·검사 (L2). 형식이 틀리면 INVALID_ARGUMENT */
  readPaletteFile(path: string): Promise<ViewerPaletteFile>

  analyze(paths: string[]): Promise<ImportPreview>
  commit(req: ImportCommitRequest): Promise<ImportResult>
  cancel(operationId: string): boolean
  history(): Promise<ImportHistoryEntry[]>
  /** 진행 중 작업이 있으면 그 ID */
  activeOperation(): string | null
  /** 현재 저장소를 열 때 한 점검·복구 결과 (저장소가 없으면 null) */
  maintenanceReport(): Promise<StoreMaintenanceReport | null>
  /**
   * 결함 라벨 (labels.ts). 가져오기 작업 잠금(BUSY)과 무관하게 동작하고,
   * 라벨 작업 중에는 저장소를 바꿀 수 없다(BUSY).
   */
  readonly labels: LabelService
  close(): void
}

interface Open {
  root: string
  catalog: Catalog
  report: StoreMaintenanceReport
}

function notFound(what: string): never {
  throw new AppError('NOT_FOUND', `${what} 을(를) 찾을 수 없습니다.`)
}

/**
 * 측정 원본(.nde 등)이 든 폴더를 새 저장소로 고르면 원본 폴더에 catalog.db·스캔플랜 폴더가 생기고,
 * 다음 분석 때 원본과 사본이 섞인다 → 기존 저장소(catalog.db 있음)가 아니면 거부한다.
 */
async function rejectSourceFolder(root: string, catalogPath: string): Promise<void> {
  if (await stat(catalogPath).then((s) => s.isFile(), () => false)) return
  const probe = await containsSourceData(root)
  if (probe.found) {
    throw new AppError(
      'STORE_ROOT_INVALID',
      '이 폴더에는 측정 원본 파일이 있어 저장소로 쓸 수 없습니다. 빈 폴더나 기존 저장소(catalog.db 가 있는 폴더)를 고르세요.',
      probe.found
    )
  }
  if (probe.truncated) {
    throw new AppError('STORE_ROOT_INVALID', '파일이 너무 많은 폴더는 저장소로 쓸 수 없습니다. 새 빈 폴더를 만들어 고르세요.', root)
  }
}

/** 이미지 보기 메타 캐시 크기 (파일 수) */
const VIEWER_INFO_CACHE = 4

/** 자료 파일 이름 (확장자 뺀 것) — OmniPC 내보내기 'Data File' 칸과 기본 파일 이름 */
function dataFileName(file: FileRecord): string {
  return file.storedFileName.replace(/\.[^.]+$/, '').normalize('NFC')
}

/**
 * 저장된 사본의 한 그룹 → OmniPC C-scan 내보내기 글자 (서비스·시험 공용).
 * 게이트는 파일의 C-scan 게이트에 조정 패널 값(gate)을 덮은 것. 진폭 조각을 차례로 읽어 C-scan 을 채운다(조각 32 MB 이하).
 */
export async function buildCscanTxt(
  path: string,
  info: ViewerFileInfo,
  groupId: number,
  gate: GateOverrideLike | undefined,
  meta: { dataFile: string; inspectionDate: string | null }
): Promise<{ text: string; group: ViewerGroup; indexConfirmed: boolean; unconfirmed: string[] }> {
  const group = info.groups.find((g) => g.id === groupId)
  if (!group) throw new AppError('NOT_FOUND', `그룹 ${groupId} 을(를) 찾을 수 없습니다.`)
  if (!group.supported) throw new AppError('NDE_UNSUPPORTED', group.reason ?? '이 그룹은 이미지로 볼 수 없습니다.')
  const fileGate = findGate(group, group.cscanGateId)
  if (!fileGate) throw new AppError('NDE_UNSUPPORTED', '이 그룹에는 C-scan 게이트가 없습니다.')
  const effective = applyGateOverride(fileGate, group, gate)
  const cs = createGateCscan(group, effective.id)
  for (const [s0, n] of chunkRanges(group.shape)) fillGateCscan(cs, group, effective, await readStoredViewerChunk(path, group, s0, n))
  const text = cscanToOmniTxt(group, cs, effective, { dataFile: meta.dataFile, inspectionDate: meta.inspectionDate })
  return { text, group, indexConfirmed: omniCscanIndexAxis(group).confirmed, unconfirmed: omniCscanUnconfirmed(group, info.formatFamily) }
}

/** 게이트 바꾼 값 검사 (숫자만, 형상은 TrueDepth·SoundPath) */
function gateOverrideOf(v: unknown): GateOverrideLike | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object' || Array.isArray(v)) throw new AppError('INVALID_ARGUMENT', '게이트 값이 올바르지 않습니다.')
  const o = v as Record<string, unknown>
  const out: GateOverrideLike = {}
  for (const k of ['startMm', 'lengthMm', 'thresholdPct'] as const) {
    if (o[k] === undefined) continue
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k]) || (o[k] as number) < 0) throw new AppError('INVALID_ARGUMENT', '게이트 값이 올바르지 않습니다.')
    out[k] = o[k] as number
  }
  if (o['geometry'] !== undefined) {
    if (o['geometry'] !== 'TrueDepth' && o['geometry'] !== 'SoundPath') throw new AppError('INVALID_ARGUMENT', '게이트 형상 값이 올바르지 않습니다.')
    out.geometry = o['geometry']
  }
  return out
}

/**
 * 내보낼 경로: 절대경로, .txt 로 끝나게(아니면 붙임). 대화상자가 덮어쓰기를 물은 것은 고른 이름 그대로일 때뿐이라,
 * '.txt' 를 붙인 경로가 이미 있으면 묻지 않고 덮지 않게 CONFLICT.
 */
async function txtPath(p: unknown): Promise<string> {
  if (typeof p !== 'string' || p.length === 0 || !isAbsolute(p)) throw new AppError('INVALID_ARGUMENT', '저장 경로가 올바르지 않습니다.')
  if (extname(p).toLowerCase() === '.txt') return p
  const withExt = `${p}.txt`
  if (await stat(withExt).then(() => true, () => false)) {
    throw new AppError('CONFLICT', `같은 이름의 파일이 이미 있습니다: ${basename(withExt)}. 다른 이름을 고르세요.`, withExt)
  }
  return withExt
}

export function createAppService(opts: ServiceOptions): AppService {
  const previews: PreviewStore = createPreviewStore(opts.previewTtlMs)
  let open: Open | null = null
  let active: { id: string; controller: AbortController } | null = null
  /** 저장소를 바꾸는 중 (라벨 작업을 받지 않음) */
  let switching = false
  /** 'storeRoot|fileId|sha256' → 메타. 저장소를 닫으면 비운다 */
  const viewerInfos = new Map<string, ViewerFileInfo>()
  // closeCatalog 보다 먼저 만들어 두되, 의존 함수는 아래에서 정의된다 (호출 시점에 쓴다)
  const labels: LabelService = createLabelService({
    settingsPath: opts.settingsPath,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.previewTtlMs !== undefined ? { previewTtlMs: opts.previewTtlMs } : {}),
    current: async () => {
      const o = await current()
      return { root: o.root, catalog: o.catalog }
    },
    viewerInfoOf: async (file) => {
      const { path, key } = await storedCopy(file.id)
      return viewerInfo(key, path)
    },
    switching: () => switching
  })

  const closeCatalog = (): void => {
    viewerInfos.clear()
    labels.clear()
    if (!open) return
    try {
      open.catalog.close()
    } catch {
      // 이미 닫혔으면 무시
    }
    open = null
    previews.clear()
  }

  /** create=false 면 폴더가 이미 있어야 한다 (빠진 USB 등에 빈 저장소를 새로 만들지 않게) */
  async function openFor(storeRoot: string, create: boolean): Promise<Open> {
    const layout = resolveStoreLayout(storeRoot)
    if (!create) {
      const st = await stat(layout.root).catch(() => null)
      if (!st?.isDirectory()) throw new AppError('STORE_ROOT_INVALID', `저장소 폴더를 찾을 수 없습니다: ${layout.root}`)
    }
    if (create) await rejectSourceFolder(layout.root, layout.catalogPath)
    await ensureStoreRoot(layout.root)
    const catalog = openCatalog(layout.catalogPath)
    const report = await maintainStore(layout.root, catalog, opts.now?.() ?? new Date())
    if (report.quarantined.length || report.interruptedBatchCount || report.upgradedPlanIds.length) {
      console.info('[store] 저장소 점검:', JSON.stringify(report))
    }
    return { root: layout.root, catalog, report }
  }

  /** 현재 설정의 저장소 카탈로그 (설정이 바뀌었으면 다시 연다) */
  async function current(): Promise<Open> {
    const { storeRoot } = await loadSettings(opts.settingsPath)
    if (!storeRoot) throw new AppError('NO_STORE_ROOT', '저장소 폴더를 먼저 지정하세요.')
    const root = resolve(storeRoot)
    if (open && open.root === root) return open
    closeCatalog()
    open = await openFor(root, false)
    return open
  }
  const cat = async (): Promise<Catalog> => (await current()).catalog

  function lock(id: string): AbortController {
    if (active) throw new AppError('BUSY', '다른 가져오기 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.')
    const controller = new AbortController()
    active = { id, controller }
    return controller
  }
  const unlock = (id: string): void => {
    if (active?.id === id) active = null
  }

  /** 저장소를 바꿀 수 있는지 (가져오기·라벨 작업 중이면 BUSY) */
  function assertCanSwitch(): void {
    if (active) throw new AppError('BUSY', '가져오기 작업 중에는 저장소를 바꿀 수 없습니다.')
    if (labels.busy()) throw new AppError('BUSY', '라벨 작업 중에는 저장소를 바꿀 수 없습니다. 끝난 뒤 다시 시도하세요.')
    if (switching) throw new AppError('BUSY', '저장소를 바꾸는 중입니다.')
  }

  async function setStoreRoot(dir: string): Promise<string> {
    assertCanSwitch()
    switching = true
    try {
      const next = await openFor(dir, true)
      closeCatalog()
      open = next
      await updateSettings(opts.settingsPath, { storeRoot: next.root })
      return next.root
    } finally {
      switching = false
    }
  }

  /** 저장된 사본 (카탈로그 기록·절대경로·캐시 키). 사본이 없으면 NOT_FOUND */
  async function storedCopy(id: FileId): Promise<{ file: FileRecord; path: string; key: string }> {
    const { root, catalog } = await current()
    const file = catalog.getFile(id) ?? notFound(`파일 #${id}`)
    const path = toAbsolutePath(root, file.storedRelPath)
    if (!(await stat(path).catch(() => null))?.isFile()) throw new AppError('NOT_FOUND', `저장된 사본이 없습니다: ${file.storedRelPath}`)
    return { file, path, key: `${root}|${id}|${file.meta.sha256}` }
  }

  async function viewerInfo(key: string, path: string): Promise<ViewerFileInfo> {
    const hit = viewerInfos.get(key)
    if (hit) {
      viewerInfos.delete(key)
      viewerInfos.set(key, hit)
      return hit
    }
    // 형식 분기: .opd 사본은 OPD 구조 읽기(core/opd/viewer), 그 밖은 NDE(HDF5)
    const info = await readStoredViewerInfo(path)
    viewerInfos.set(key, info)
    while (viewerInfos.size > VIEWER_INFO_CACHE) viewerInfos.delete(viewerInfos.keys().next().value!)
    return info
  }

  return {
    getSettings: () => loadSettings(opts.settingsPath),
    async updateSettings(patch) {
      const { storeRoot, ...rest } = patch ?? {}
      // 라벨 칸: PC ID 는 비우거나 형식에 맞지 않으면 거부 (버전 벡터 칸이라 조용히 버리지 않는다)
      if ('pcId' in rest && !cleanPcId(rest.pcId)) {
        throw new AppError('INVALID_ARGUMENT', "PC ID 는 글자·숫자로 시작하고 글자·숫자·'.'·'_'·'-' 만 써서 32자까지 적습니다.")
      }
      if ('labelBlindMode' in rest && typeof rest.labelBlindMode !== 'boolean') {
        throw new AppError('INVALID_ARGUMENT', '2인 모드 값이 올바르지 않습니다.')
      }
      if (typeof storeRoot === 'string') await setStoreRoot(storeRoot)
      else if (storeRoot === null) {
        assertCanSwitch()
        closeCatalog()
        await updateSettings(opts.settingsPath, { storeRoot: null })
      }
      return updateSettings(opts.settingsPath, rest)
    },
    setStoreRoot,
    async catalogPath() {
      const { storeRoot } = await loadSettings(opts.settingsPath)
      return storeRoot ? resolveStoreLayout(storeRoot).catalogPath : null
    },

    listPlans: async () => (await cat()).listPlans(),
    getPlan: async (id) => (await cat()).getPlan(id) ?? notFound(`스캔플랜 ${id}`),
    renamePlan: async (id, name) => (await cat()).renamePlan(id, name),
    setPlanNote: async (id, note) => (await cat()).setPlanNote(id, note),
    listSpecimens: async (planId) => (await cat()).listSpecimens(planId),
    getSpecimen: async (id) => (await cat()).getSpecimen(id) ?? notFound(`시편 ${id}`),
    updateSpecimen: async (id, patch) => (await cat()).updateSpecimen(id, patch),
    listFiles: async (query) => (await cat()).listFiles(query ?? {}),
    getFile: async (id) => (await cat()).getFile(id) ?? notFound(`파일 #${id}`),
    updateFile: async (id, patch) => (await cat()).updateFile(id, patch),
    storedFilePath: async (id) => (await storedCopy(id)).path,

    async viewerOpen(id) {
      const { file, path, key } = await storedCopy(id)
      return { file, key, info: await viewerInfo(key, path) }
    },
    async cscanExportFileName(req) {
      const { file } = await storedCopy(req.fileId)
      return omniCscanTxtFileName(dataFileName(file), opts.now?.() ?? new Date())
    },
    async exportCscanTxt(req, outPath) {
      const target = await txtPath(outPath)
      const gate = gateOverrideOf(req?.gate)
      if (!Number.isSafeInteger(req?.groupId)) throw new AppError('INVALID_ARGUMENT', '그룹 ID 값이 올바르지 않습니다.')
      const { file, path, key } = await storedCopy(req.fileId)
      if (key !== req.key) throw new AppError('CONFLICT', '저장소나 파일이 바뀌었습니다. 다시 여세요.', `${req.key} != ${key}`)
      const { root } = await current()
      // 원시데이터는 읽기만: 저장소 안·가져올 때의 원본 폴더(그 아래 포함)·측정 원본이 바로 든 폴더에는 쓰지 않는다 (exportTarget.ts)
      await assertExportTarget(target, 'file', { storeRoot: root, sourceDirs: file.meta.sourcePath ? [dirname(file.meta.sourcePath)] : [] })
      const info = await viewerInfo(key, path)
      // Inspection Date: OPD 는 OmniPC 내보내기(TP14, 유일한 근거)가 0001-01-01 이라 비운다. NDE 는 파일 생성일 — 확인 전(캡처 14)
      const inspectionDate = info.formatFamily === 'opd' ? null : (file.meta.createdAt?.slice(0, 10) ?? null)
      const built = await buildCscanTxt(path, info, req.groupId, gate, { dataFile: dataFileName(file), inspectionDate })
      try {
        await writeFile(target, built.text, 'utf8')
      } catch (e) {
        throw new AppError('IO_ERROR', 'C-scan 파일을 쓰지 못했습니다.', String((e as Error)?.message ?? e))
      }
      return {
        path: target,
        bytes: Buffer.byteLength(built.text, 'utf8'),
        scanCount: built.group.shape[0],
        indexCount: built.group.shape[1],
        indexConfirmed: built.indexConfirmed,
        unconfirmed: built.unconfirmed
      }
    },
    async readPaletteFile(palPath) {
      if (typeof palPath !== 'string' || !isAbsolute(palPath) || extname(palPath).toLowerCase() !== '.pal') {
        throw new AppError('INVALID_ARGUMENT', 'OmniPC 색표 파일(.pal)을 고르세요.')
      }
      const st = await stat(palPath).catch(() => null)
      if (!st?.isFile()) throw new AppError('NOT_FOUND', `색표 파일을 찾을 수 없습니다: ${palPath}`)
      if (st.size > PAL_MAX_BYTES) throw new AppError('INVALID_ARGUMENT', '색표 파일이 너무 큽니다(1 MB 넘음).')
      const parsed = parsePal(await readFile(palPath, 'utf8'))
      if (!parsed.ok) throw new AppError('INVALID_ARGUMENT', `OmniPC 색표로 읽지 못했습니다: ${parsed.error}`, palPath)
      return {
        name: basename(palPath, extname(palPath)).normalize('NFC'),
        palette: parsed.palette,
        specialColors: parsed.specialColors,
        specialFromFile: parsed.specialFromFile,
        format: parsed.format
      }
    },
    async viewerChunk(id, key, groupId, scanStart, scanCount) {
      const { path, key: cur } = await storedCopy(id)
      if (cur !== key) throw new AppError('CONFLICT', '저장소나 파일이 바뀌었습니다. 다시 여세요.', `${key} != ${cur}`)
      const info = await viewerInfo(cur, path)
      const group = info.groups.find((g) => g.id === groupId)
      if (!group) throw new AppError('NOT_FOUND', `그룹 ${groupId} 을(를) 찾을 수 없습니다.`)
      if (!group.supported) throw new AppError('NDE_UNSUPPORTED', group.reason ?? '이 그룹은 이미지로 볼 수 없습니다.')
      // 형식 분기: OPD 그룹(amplitudeSource 'opd-raster')은 래스터 uint8 → Int16Array, 그 밖은 NDE 데이터셋
      return readStoredViewerChunk(path, group, scanStart, scanCount)
    },

    async analyze(paths) {
      // 잠금은 첫 await 전에 잡는다 (동시에 두 번 불러도 하나만 진행)
      const previewId = newPreviewId(opts.now?.())
      const controller = lock(previewId)
      try {
        const { root, catalog } = await current()
        const settings = await loadSettings(opts.settingsPath)
        await initNde()
        const preview = await analyzeImport(paths, {
          catalog,
          storeRoot: root,
          signal: controller.signal,
          operationId: previewId,
          newPlanNameTemplate: settings.newPlanNameTemplate,
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
          ...(opts.now ? { now: opts.now } : {})
        })
        previews.put(preview)
        return preview
      } finally {
        unlock(previewId)
      }
    },
    async commit(req) {
      const batchId = newBatchId(opts.now?.())
      const controller = lock(batchId)
      try {
        const { root, catalog } = await current()
        const preview = req?.previewId ? previews.get(req.previewId) : null
        if (!preview) throw new AppError('PREVIEW_EXPIRED', '분석 결과가 만료되었습니다. 다시 분석하세요.')
        await initNde()
        const result = await commitImport(preview, req, {
          catalog,
          storeRoot: root,
          signal: controller.signal,
          operationId: batchId,
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
          ...(opts.now ? { now: opts.now } : {})
        })
        previews.delete(preview.previewId)
        return result
      } finally {
        unlock(batchId)
      }
    },
    cancel(operationId) {
      if (!active || active.id !== operationId || active.controller.signal.aborted) return false
      active.controller.abort()
      return true
    },
    history: async () => (await cat()).listImportHistory(),
    activeOperation: () => active?.id ?? null,
    async maintenanceReport() {
      const { storeRoot } = await loadSettings(opts.settingsPath)
      if (!storeRoot) return null
      return (await current()).report
    },
    labels,
    close() {
      active?.controller.abort()
      closeCatalog()
    }
  }
}
