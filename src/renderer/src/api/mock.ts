/** 브라우저(dev:web)용 PautApi mock. 메모리 안에서만 동작하며 X3 실데이터와 비슷한 가짜 데이터를 쓴다. */
import {
  LABEL_CONFLICT_CHOICES,
  LABEL_ENTITY_KINDS,
  isLevel3Qualification,
  type FileQuery,
  type LabelConflictChoice,
  type LabelConflictInfo,
  type LabelEntityKind,
  type LabelEntityValue,
  type LabelExportRequest,
  type LabelFileStatus,
  type LabelJsonImportResult,
  type LabelMergeCounts,
  type LabelPlanCounts,
  type LabelSession,
  type LabelSetInfo,
  type LabelWorkbookChange,
  type LabelWorkbookPreview,
  type PautApi,
  type ReviewCompareRequest,
  type ReviewComparison,
  type ReviewCsvRequest,
  type ReviewFileInfo,
  type ReviewFinalPreview,
  type ReviewFinalRequest,
  type ReviewFinalSaveOptions,
  type ReviewFinalSaveResult,
  type ReviewSaveCounts,
  type ReviewSetInfo,
  type ReviewSideKey,
  type ReviewSourceFile,
  type ReviewSources,
  type TrainSplit,
  type TrainSplitOrNone,
  type TrainingExportFileResult,
  type TrainingExportProgress,
  type TrainingExportRequest,
  type TrainingExportResult,
  type TrainingSetChoice,
  type TrainingSetRule,
  type TrainingSplitChange,
  type TrainingSplitLogEntry,
  type TrainingSplitOptions,
  type TrainingSplitView
} from '@shared/api'
import { AppError, fail, ok, type ApiResult } from '@shared/errors'
import { cscanToOmniTxt, omniCscanIndexAxis, omniCscanTxtFileName, omniCscanUnconfirmed } from '@shared/imaging/cscanExport'
import { applyGateOverride, createGateCscan, fillGateCscan, findGate } from '@shared/imaging/gates'
import { DEFAULT_SPECIAL_COLORS } from '@shared/imaging/palette'
import type { ViewerFileInfo } from '@shared/imaging/types'
import { refPctFromSetup } from '@shared/labels/levels'
import { formatPlanId, parsePlanNumber, sanitizeSpecimenId } from '@shared/ids'
import { planNameFrom, uniquePlanName } from '@shared/planName'
import {
  labelSetId,
  newFileAlignment,
  newIndicationRecord,
  newLabelExport,
  newPhysicalDefect,
  newReviewInterval,
  newWorkEvent,
  sameLabelSet
} from '@shared/labels/factory'
import { PROVISIONAL_DEPTH_DIFF_MM, PROVISIONAL_SCAN_GAP_MM } from '@shared/labels/match'
import { PROVISIONAL_GRADING_UNIT_MM } from '@shared/labels/metrics'
import {
  buildEvaluationReport,
  buildFinalSet,
  compareLabelSets,
  comparisonRowsCsv,
  designCheckCsv,
  evaluationReportCsv,
  sensitivityGrid,
  type CompareResult
} from '@shared/labels/review'
import type {
  FileAlignment,
  IndicationRecord,
  LabelExportFile,
  LabelSetKey,
  LabelerInfo,
  ObservationRow,
  PhysicalDefect,
  RecordKind,
  ReviewInterval,
  VersionEntry,
  WorkEvent
} from '@shared/labels/types'
import { bumpVersions, compareVersions, mergeVersions, versionTotal } from '@shared/labels/versions'
import { matchesAllTerms } from '@shared/text'
import {
  DEFAULT_SETTINGS,
  PC_ID_PATTERN,
  IMPORT_VERDICTS,
  UNSUPPORTED_EXTENSIONS,
  isOpdMeta,
  type AppSettings,
  type FileRecord,
  type ImportHistoryEntry,
  type ImportItemPreview,
  type ImportPreview,
  type ImportResult,
  type ImportVerdict,
  type NewPlanCandidate,
  type ProgressEvent,
  type ScanPlan,
  type ScanPlanSpec,
  type Specimen,
  type SpecimenSummary,
  type StoreMaintenanceReport
} from '@shared/types'
import {
  MOCK_SOURCE_DIR,
  OPD_ACQ,
  OPD_FP,
  OPD_META,
  OPD_SETUP_WARNINGS,
  OPD_NAME_TAIL,
  OPD_SPEC,
  OPD_SUMMARY,
  PLATE42_ACQ,
  PLATE42_SPEC,
  PLATE42_SUMMARY,
  X3_ACQ,
  X3_SPEC,
  X3_SUMMARY,
  seedFiles,
  seedHistory,
  seedManyFiles,
  seedManyHistory,
  seedManyPlans,
  seedManySpecimens,
  seedPlans,
  seedSpecimens
} from './mockData'
import { mockOpdViewerInfo, mockViewerChunk, mockViewerInfo } from './mockVolume'

const LATENCY_MS = 120
const MOCK_STORE_ROOT = 'D:/PAUT_저장소'
/** C-scan 내보내기 mock 이 '쓴' 것처럼 돌려줄 폴더 (실제로는 쓰지 않음) */
const MOCK_EXPORT_DIR = 'C:/Users/mock/Documents'

/**
 * 화면 검증용 시나리오: default(데이터 있음) / empty(저장소만 있고 데이터 없음) / nostore(저장소 미설정)
 * / recovered(데이터 있음 + 저장소 점검이 강제 종료 흔적을 정리한 상태)
 * / many(사용자 시험 저장소처럼 플랜 9개 — 플랜 목록 묶음 확인용)
 */
export type MockScenario = 'default' | 'empty' | 'nostore' | 'recovered' | 'many'

function maintenanceOf(scenario: MockScenario): StoreMaintenanceReport | null {
  if (scenario === 'nostore') return null
  const base: StoreMaintenanceReport = {
    checkedAt: '2026-10-02T09:15:00+09:00',
    interruptedBatchCount: 0,
    removedPartialCount: 0,
    quarantined: [],
    quarantineDir: null,
    upgradedPlanIds: [],
    upgradeProblems: [],
    problems: []
  }
  if (scenario !== 'recovered') return base
  return {
    ...base,
    interruptedBatchCount: 1,
    removedPartialCount: 1,
    quarantined: [{ from: '스캔플랜/SP003/PL23900/12T-SV-09.nde', to: '미등록_파일/20261002-091500/SP003/PL23900/12T-SV-09.nde' }],
    quarantineDir: '미등록_파일/20261002-091500',
    upgradedPlanIds: ['SP001', 'SP002']
  }
}

function initState(scenario: MockScenario) {
  const seeded = scenario === 'default' || scenario === 'recovered'
  const many = scenario === 'many'
  return {
    maintenance: maintenanceOf(scenario),
    activeCommit: null as string | null,
    cancelRequested: false,
    settings: { ...DEFAULT_SETTINGS, theme: 'light', storeRoot: scenario === 'nostore' ? null : MOCK_STORE_ROOT } as AppSettings,
    plans: many ? seedManyPlans() : seeded ? seedPlans() : [],
    specimens: many ? seedManySpecimens() : seeded ? seedSpecimens() : [],
    files: many ? seedManyFiles() : seeded ? seedFiles() : [],
    history: many ? seedManyHistory() : seeded ? seedHistory() : [],
    previews: new Map<string, ImportPreview>(),
    listeners: new Set<(ev: ProgressEvent) => void>(),
    seq: 0
  }
}

let state = initState('default')

const delay = (ms = LATENCY_MS): Promise<void> => new Promise((r) => setTimeout(r, ms))
const nowIso = (): string => {
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0')
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19)
  return `${local}${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
}

async function respond<T>(fn: () => T): Promise<ApiResult<T>> {
  await delay()
  try {
    return ok(fn())
  } catch (e) {
    // AppError 는 코드를 그대로, 나머지는 NOT_FOUND
    if (e instanceof AppError) return fail(e.code, e.message, e.detail)
    return fail('NOT_FOUND', e instanceof Error ? e.message : String(e))
  }
}

function emit(ev: ProgressEvent): void {
  for (const cb of state.listeners) cb(ev)
}

function recount(): void {
  for (const p of state.plans) {
    const files = state.files.filter((f) => f.planId === p.id)
    p.fileCount = files.length
    p.specimenCount = new Set(files.map((f) => f.specimenId)).size
    p.totalBytes = files.reduce((s, f) => s + f.meta.sizeBytes, 0)
    p.lastImportedAt = files.map((f) => f.importedAt).sort().at(-1) ?? null
  }
}

function summarize(s: Specimen, planId?: string): SpecimenSummary {
  const all = state.files.filter((f) => f.specimenId === s.id)
  const scoped = planId ? all.filter((f) => f.planId === planId) : all
  return {
    ...s,
    planIds: [...new Set(all.map((f) => f.planId))].sort(),
    fileCount: scoped.length,
    stateTags: [...new Set(scoped.map((f) => f.stateTag).filter((t): t is string => !!t))],
    lastImportedAt: scoped.map((f) => f.importedAt).sort().at(-1) ?? null
  }
}

function findPlan(id: string): ScanPlan {
  const p = state.plans.find((x) => x.id === id)
  if (!p) throw new Error(`스캔플랜 ${id} 을(를) 찾을 수 없습니다.`)
  return p
}

function findFile(id: number): FileRecord {
  const f = state.files.find((x) => x.id === id)
  if (!f) throw new Error(`파일 #${id} 을(를) 찾을 수 없습니다.`)
  return f
}

/**
 * mock 이미지 보기 정보에 OmniPC 설정 읽기 칸을 더한다 (core/nde/viewer 가 X3 실파일에서 읽는 값과 같은 모양·값 —
 * Ref 근거 TCG, SoftGain 0, 탐촉자 Index ∓15 mm, 게이트 I·B 꺼짐, 저장 측정값 10칸, 덮개 VOffset, 출처 MXU 5.18.1).
 * 렌더러가 dev:web 에서 새 칸(툴팁·배지·출처)을 그려 볼 수 있게 한다
 */
const MOCK_CUSTOM_READINGS = ['APercent', 'DAPosition', 'PAPosition', 'SAPosition', 'ViAPosition', 'Umr', 'Imr', 'IUmr', 'Im', 'Um']
const MOCK_TOFD_READINGS = ['TOFDmr', 'Smr', 'TOFDr', 'Sr', 'PercentUr', 'TOFDmr', 'Smr', 'TOFDm', 'Sm', 'PercentUm']
function withMockSettings(info: ViewerFileInfo): ViewerFileInfo {
  return {
    ...info,
    groups: info.groups.map((g) =>
      g.supported
        ? {
            ...g,
            refBasis: 'tcg' as const,
            refPct: refPctFromSetup(g.gainDb, g.referenceGainDb, g.referenceAmplitudePct),
            softGainDb: 0,
            positioning: { scanOffsetMm: 0, indexOffsetMm: g.beams[0]?.skewDeg === 270 ? 15 : -15, analysisScanOffsetMm: null, analysisIndexOffsetMm: null, reference: null },
            gates: g.gates.map((x) => ({
              ...x,
              enabled: /gate\s*a\b/i.test(x.name),
              detection: 'max' as const,
              event: /gate\s*i\b/i.test(x.name) ? ('edge' as const) : ('peak' as const)
            }))
          }
        : { ...g, refBasis: 'none' as const, refPct: null, softGainDb: 0, positioning: null }
    ),
    specimen: info.specimen.weld ? { ...info.specimen, weld: { ...info.specimen.weld, template: 'VOffset' } } : info.specimen,
    display: {
      ...info.display,
      readings: info.groups.map((g) => ({ groupId: g.id, groupName: g.name, keys: g.technique === 'tofd' ? MOCK_TOFD_READINGS : MOCK_CUSTOM_READINGS, listId: 0 }))
    },
    source: {
      createdBy: { name: 'MXU', version: '5.18.1.0' },
      modifiedBy: null,
      savedBy: { name: 'MXU', version: '5.18.1-release.0' },
      platform: 'MX3',
      resavedByOmniPC: false,
      mxuVersion: '5.18.1',
      createdMxuVersion: '5.18.1',
      wedgeOffsetCaution: false,
      notes: []
    }
  }
}

/** 실제 서비스와 같은 모양의 이미지 보기 키 '저장소|파일 ID|sha256' (저장소를 바꾸면 달라진다) */
function viewerKey(f: FileRecord): string {
  return `${state.settings.storeRoot ?? 'mock'}|${f.id}|${f.meta.sha256}`
}

function queryFiles(q: FileQuery): { items: FileRecord[]; total: number; offset: number; limit: number } {
  const text = q.text?.trim() ?? ''
  let items = state.files.filter(
    (f) =>
      (!q.planId || f.planId === q.planId) &&
      (!q.specimenId || f.specimenId === q.specimenId) &&
      (!q.stateTag || f.stateTag === q.stateTag)
  )
  if (text) {
    // 카탈로그(core/catalog/files.ts)와 같은 규칙: 공백으로 나눈 낱말이 모두 어느 필드엔가 있어야 한다
    items = items.filter((f) => {
      const planName = state.plans.find((p) => p.id === f.planId)?.name ?? ''
      const specimen = state.specimens.find((x) => x.id === f.specimenId)?.displayName ?? ''
      return matchesAllTerms(
        [f.meta.sourceFileName, f.storedFileName, f.meta.deviceFileName, f.specimenId, specimen, f.stateTag, f.memo, ...f.tags, f.planId, planName],
        text
      )
    })
  }
  const sort = q.sort ?? 'importedAt-desc'
  items = items.slice().sort((a, b) => {
    if (sort === 'fileName-asc') return a.storedFileName.localeCompare(b.storedFileName, 'ko')
    if (sort === 'createdAt-desc') return (b.meta.createdAt ?? '').localeCompare(a.meta.createdAt ?? '')
    const d = a.importedAt.localeCompare(b.importedAt) || a.id - b.id
    return sort === 'importedAt-asc' ? d : -d
  })
  const offset = q.offset ?? 0
  const limit = Math.min(q.limit ?? 200, 1000)
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit }
}

// ── 가져오기 mock ──

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** 폴더(확장자 없는 경로)는 데모용 파일 묶음으로 펼친다 */
function expandMockPaths(paths: string[]): { files: string[]; hidden: number } {
  const files: string[] = []
  let hidden = 0
  for (const p of paths) {
    const name = baseName(p)
    if (name.startsWith('.')) {
      hidden++
      continue
    }
    if (extOf(name)) files.push(p)
    else if (/PCN|OPD/i.test(name)) {
      // OPD 데모 폴더: 같은 셋업 2개(새 플랜 1개) + 장비 저장 이름이 다른 파일 + 잘린 파일(해석 실패)
      files.push(...['TP14-ROOT-L-01.opd', 'TP14-ROOT-L-02.opd', 'TP14-ROOT-L-03.opd', 'TP14-cut.opd'].map((n) => `${p}/${n}`))
      hidden += 1
    } else {
      files.push(
        ...['12T-SV-01-Cap on.nde', '12T-SV-05-Cap on.nde', '12T-SV-06-Cap off.nde', 'Weld_Plate_PA-Sect_sk90-4.2.nde', 'old_scan.oud', 'TP14-cut.opd', 'broken_ERR.nde'].map(
          (n) => `${p}/${n}`
        )
      )
      hidden += 2
    }
  }
  return { files, hidden }
}

const NEW_SPEC: ScanPlanSpec = PLATE42_SPEC
const NEW_FP = 'fp2:mock-4.2-pa-sect-sk90'

function suggestSpecimen(name: string): { id: string; source: 'device-filename' | 'filename' } {
  const m = /PL\d{4,}/i.exec(name)
  return m ? { id: m[0].toUpperCase(), source: 'device-filename' } : { id: sanitizeSpecimenId(name.replace(/\.[^.]+$/, '')), source: 'filename' }
}

function suggestTag(name: string): string | null {
  if (/cap\s*off/i.test(name)) return 'Cap off'
  if (/cap\s*(on|\d+)/i.test(name)) return 'Cap on'
  return null
}

function previewItem(path: string, i: number, seenNames: Map<string, string>): ImportItemPreview {
  const fileName = baseName(path)
  const ext = extOf(fileName)
  const itemId = `i${String(i + 1).padStart(4, '0')}`
  const base: ImportItemPreview = {
    itemId,
    sourcePath: path,
    fileName,
    sizeBytes: 48_000_000 + i * 1024,
    sha256: null,
    verdict: 'error',
    meta: null,
    setup: null,
    matchedPlanId: null,
    newPlanKey: null,
    nearestPlan: null,
    duplicateOf: null,
    suggestedSpecimenId: null,
    suggestedSpecimenSource: null,
    suggestedStateTag: null,
    suggestedRound: null,
    unsupportedReason: null,
    errorMessage: null,
    warnings: []
  }
  if (ext === '.opd') return opdPreviewItem(base, seenNames)
  if (ext !== '.nde') {
    return { ...base, verdict: 'unsupported', unsupportedReason: UNSUPPORTED_EXTENSIONS[ext] ?? '지원하지 않는 형식입니다.' }
  }
  if (/ERR/.test(fileName)) return { ...base, verdict: 'error', errorMessage: 'HDF5 파일을 열 수 없습니다 (손상되었거나 NDE 가 아님).' }
  const sha256 = `mock${fileName}`.padEnd(64, '0').slice(0, 64)
  const deviceFileName = fileName.startsWith('12T') ? `12T-SV-PL2${3850 + i}-i15-CAP${/off/i.test(fileName) ? ' OFF' : '20'}` : null
  const sug = suggestSpecimen(deviceFileName ?? fileName)
  const common = {
    ...base,
    sha256,
    suggestedSpecimenId: sug.id,
    suggestedSpecimenSource: sug.source,
    suggestedStateTag: suggestTag(fileName)
  }
  const dupFile = state.files.find((f) => f.meta.sourceFileName === fileName)
  if (dupFile) {
    return {
      ...common,
      verdict: 'duplicate',
      duplicateOf: { fileId: dupFile.id, planId: dupFile.planId, specimenId: dupFile.specimenId, storedRelPath: dupFile.storedRelPath }
    }
  }
  const prev = seenNames.get(fileName)
  if (prev) return { ...common, verdict: 'duplicate', duplicateOf: { inBatchItemId: prev } }
  seenNames.set(fileName, itemId)
  const isX3 = fileName.startsWith('12T')
  const spec = isX3 ? X3_SPEC : NEW_SPEC
  const meta = {
    ndeVersion: isX3
      ? { raw: '3.3.0', family: '3.x' as const, major: 3, minor: 3, patch: 0, preRelease: null }
      : { raw: '4.2.0', family: '4.x' as const, major: 4, minor: 2, patch: 0, preRelease: null },
    deviceFileName,
    device: isX3
      ? { platform: 'OmniScanX3', model: 'Freedom_32x128', serialNumber: 'QC-0018282', name: 'MXU' }
      : { platform: 'OmniScanX4', model: null, serialNumber: null, name: 'MXU' },
    createdAt: isX3 ? '2026-10-01T09:00:00+09:00' : '2024-09-26T11:24:44-09:30',
    modifiedAt: isX3 ? '2026-10-01T09:00:00+09:00' : '2026-02-23T12:17:51-05:00',
    application: isX3 ? { name: 'OmniScan X3', version: '5.12.0' } : { name: 'MXU', version: '6.4.0.416' },
    scenario: 'General Weld',
    sha256,
    sizeBytes: common.sizeBytes,
    sourcePath: path,
    sourceFileName: fileName
  }
  const setup = {
    spec,
    fingerprint: isX3 ? 'fp2:mock-x3-12t-sv' : NEW_FP,
    acquisition: isX3 ? X3_ACQ : PLATE42_ACQ,
    summary: isX3 ? X3_SUMMARY : PLATE42_SUMMARY,
    warnings: []
  }
  if (isX3) return { ...common, verdict: 'match-existing', meta, setup, matchedPlanId: 'SP001' }
  return {
    ...common,
    verdict: 'new-plan',
    meta,
    setup,
    newPlanKey: 'n1',
    nearestPlan: {
      planId: 'SP001',
      planName: state.plans[0]?.name ?? 'SP001',
      differences: [
        { category: 'specimen', path: 'specimen.thicknessMm', label: '두께 (mm)', existing: 12, incoming: 26 },
        { category: 'specimen', path: 'specimen.materialName', label: '재질', existing: 'Steel_Mild', incoming: 'Steel_Stainless' },
        { category: 'specimen', path: 'specimen.weld.upperCap.widthMm', label: '상부 캡 폭 (mm)', existing: 25, incoming: 33.7 },
        { category: 'specimen', path: 'specimen.weld.hotPass.heightMm', label: '핫패스 높이 (mm)', existing: 10, incoming: 24 },
        { category: 'structure', path: 'groups.length', label: '그룹 수', existing: 2, incoming: 1 },
        { category: 'position', path: 'groups[0].probes[0].position.vOffsetMm', label: '인덱스 오프셋 (mm)', existing: -15, incoming: -26 },
        { category: 'beam', path: 'groups[0].firstElement', label: '첫 소자', existing: 32, incoming: 0 },
        { category: 'beam', path: 'groups[0].focusing.distanceMm', label: '집속 거리 (mm)', existing: 23, incoming: 26 }
      ],
      withinTolerance: false
    }
  }
}

/** OPD 미리보기 항목 (core/import 의 OPD 판정을 흉내): 잘린 파일은 해석 실패, 나머지는 TP14-ROOT-L 셋업 */
function opdPreviewItem(base: ImportItemPreview, seenNames: Map<string, string>): ImportItemPreview {
  const { fileName } = base
  if (/cut|ERR/i.test(fileName)) {
    return {
      ...base,
      sizeBytes: 1_048_576,
      sha256: `mock${fileName}`.padEnd(64, '0').slice(0, 64),
      verdict: 'error',
      errorMessage: '보류(해석 실패): 파일이 예상보다 짧습니다(잘렸거나 손상됨).'
    }
  }
  const sha256 = `mock${fileName}`.padEnd(64, '0').slice(0, 64)
  // 데모: -03 은 장비 저장 이름이 오른쪽(R)으로 적힌 파일
  const deviceFileName = /-03\.opd$/i.test(fileName) ? 'TP14-ROOT-R-##' : 'TP14-ROOT-L-##'
  const common: ImportItemPreview = {
    ...base,
    sizeBytes: 2_965_506,
    sha256,
    suggestedSpecimenId: 'TP14',
    suggestedSpecimenSource: 'device-filename',
    warnings: deviceFileName.includes('-R-') ? [`장비 저장 이름(${deviceFileName})이 파일 이름과 다릅니다. 시편 ID·좌우(L/R)를 확인하세요.`] : []
  }
  const dupFile = state.files.find((f) => f.meta.sha256 === sha256)
  if (dupFile) {
    return {
      ...common,
      verdict: 'duplicate',
      duplicateOf: { fileId: dupFile.id, planId: dupFile.planId, specimenId: dupFile.specimenId, storedRelPath: dupFile.storedRelPath }
    }
  }
  const prev = seenNames.get(fileName)
  if (prev) return { ...common, verdict: 'duplicate', duplicateOf: { inBatchItemId: prev } }
  seenNames.set(fileName, base.itemId)
  const meta = { ...OPD_META, deviceFileName, sha256, sizeBytes: common.sizeBytes, sourcePath: base.sourcePath, sourceFileName: fileName }
  const setup = { spec: OPD_SPEC, fingerprint: OPD_FP, acquisition: OPD_ACQ, summary: OPD_SUMMARY, warnings: [...OPD_SETUP_WARNINGS] }
  const existing = state.plans.find((p) => p.fingerprint === OPD_FP)
  if (existing) return { ...common, verdict: 'match-existing', meta, setup, matchedPlanId: existing.id }
  return { ...common, verdict: 'new-plan', meta, setup, newPlanKey: 'opd1', nearestPlan: null }
}

function nextPlanIds(count: number): string[] {
  const max = Math.max(0, ...state.plans.map((p) => parsePlanNumber(p.id) ?? 0))
  return Array.from({ length: count }, (_, i) => formatPlanId(max + 1 + i))
}

async function analyze(paths: string[]): Promise<ApiResult<ImportPreview>> {
  if (!state.settings.storeRoot) return fail('NO_STORE_ROOT', '저장소 위치를 먼저 정하세요.')
  const t0 = performance.now()
  const previewId = `pv-${++state.seq}`
  emit({ operation: 'analyze', operationId: previewId, phase: 'scan', current: 0, total: 0 })
  await delay(300)
  const { files, hidden } = expandMockPaths(paths)
  const seen = new Map<string, string>()
  const items: ImportItemPreview[] = []
  for (const [i, p] of files.entries()) {
    emit({ operation: 'analyze', operationId: previewId, phase: 'read', current: i, total: files.length, fileName: baseName(p) })
    await delay(80)
    items.push(previewItem(p, i, seen))
  }
  emit({ operation: 'analyze', operationId: previewId, phase: 'done', current: files.length, total: files.length })
  // 새 플랜 후보: 'n1' = 4.2 예제 셋업, 'opd1' = OPD 셋업 (같은 key 끼리 한 플랜)
  const keys = [...new Set(items.filter((x) => x.verdict === 'new-plan').map((x) => x.newPlanKey ?? 'n1'))]
  const provisional = nextPlanIds(keys.length)
  const taken = state.plans.map((p) => p.name)
  const newPlans: NewPlanCandidate[] = keys.map((key, k) => {
    const newItems = items.filter((x) => x.verdict === 'new-plan' && (x.newPlanKey ?? 'n1') === key)
    const opd = key === 'opd1'
    const spec = opd ? OPD_SPEC : NEW_SPEC
    const suggestedName = uniquePlanName(planNameFrom(spec) + (opd ? OPD_NAME_TAIL : ''), taken)
    taken.push(suggestedName)
    return {
      key,
      fingerprint: opd ? OPD_FP : NEW_FP,
      spec,
      summary: newItems[0]!.setup!.summary,
      provisionalPlanId: provisional[k]!,
      suggestedName,
      itemIds: newItems.map((x) => x.itemId),
      nearestPlan: newItems[0]!.nearestPlan
    }
  })
  const counts = Object.fromEntries(IMPORT_VERDICTS.map((v) => [v, items.filter((x) => x.verdict === v).length])) as Record<
    ImportVerdict,
    number
  >
  const preview: ImportPreview = {
    previewId,
    createdAt: nowIso(),
    storeRoot: state.settings.storeRoot ?? '',
    inputPaths: paths,
    items,
    newPlans,
    counts,
    skippedHiddenCount: hidden,
    ignoredCount: 0,
    skippedStoreCount: 0,
    unreadablePaths: [],
    elapsedMs: Math.round(performance.now() - t0)
  }
  state.previews.set(previewId, preview)
  return ok(preview)
}

async function commit(req: Parameters<PautApi['import']['commit']>[0]): Promise<ApiResult<ImportResult>> {
  const preview = state.previews.get(req.previewId)
  if (!preview) return fail('PREVIEW_EXPIRED', '미리보기가 만료되었습니다. 다시 분석하세요.')
  const startedAt = nowIso()
  const batchId = `IMP-mock-${++state.seq}`
  const planByKey = new Map<string, string>()
  const createdPlanIds: string[] = []
  for (const np of req.newPlans) {
    const cand = preview.newPlans.find((c) => c.key === np.key)
    if (!cand) continue
    const [id] = nextPlanIds(1)
    state.plans.push({
      id: id!,
      name: np.name,
      note: np.note ?? '',
      fingerprint: cand.fingerprint,
      spec: cand.spec,
      summary: cand.summary,
      createdAt: startedAt,
      updatedAt: startedAt,
      fileCount: 0,
      specimenCount: 0,
      totalBytes: 0,
      lastImportedAt: null
    })
    planByKey.set(np.key, id!)
    createdPlanIds.push(id!)
  }
  const result: ImportResult = {
    batchId,
    status: 'completed',
    startedAt,
    finishedAt: startedAt,
    createdPlanIds,
    createdSpecimenIds: [],
    copiedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    items: []
  }
  state.activeCommit = batchId
  state.cancelRequested = false
  for (const [i, ci] of req.items.entries()) {
    const item = preview.items.find((x) => x.itemId === ci.itemId)
    if (!item) continue
    if (state.cancelRequested) {
      result.status = 'cancelled'
      result.skippedCount++
      result.items.push({ itemId: item.itemId, fileName: item.fileName, status: 'skipped-excluded', fileId: null, planId: null, specimenId: null, storedRelPath: null, errorMessage: '가져오기를 취소해 건너뛰었습니다.' })
      continue
    }
    emit({ operation: 'commit', operationId: batchId, phase: 'copy', current: i, total: req.items.length, fileName: item.fileName })
    await delay(400)
    emit({ operation: 'commit', operationId: batchId, phase: 'verify', current: i, total: req.items.length, fileName: item.fileName })
    await delay(60)
    const planId = item.matchedPlanId ?? (item.newPlanKey ? planByKey.get(item.newPlanKey) : undefined) ?? null
    const skip = (status: 'skipped-excluded' | 'skipped-duplicate' | 'skipped-unsupported'): void => {
      result.skippedCount++
      result.items.push({ itemId: item.itemId, fileName: item.fileName, status, fileId: null, planId: null, specimenId: null, storedRelPath: null, errorMessage: null })
    }
    if (!ci.include) skip('skipped-excluded')
    else if (item.verdict === 'duplicate') skip('skipped-duplicate')
    else if (!planId || !item.meta || !item.setup) skip('skipped-unsupported')
    else {
      const specimenId = sanitizeSpecimenId(ci.specimenId)
      if (!state.specimens.some((s) => s.id === specimenId)) {
        state.specimens.push({ id: specimenId, displayName: ci.specimenDisplayName ?? specimenId, source: ci.specimenSource, note: '', createdAt: startedAt })
        result.createdSpecimenIds.push(specimenId)
      }
      const id = Math.max(0, ...state.files.map((f) => f.id)) + 1
      const storedRelPath = `스캔플랜/${planId}/${specimenId}/${item.fileName}`
      state.files.push({
        id,
        planId,
        specimenId,
        storedRelPath,
        storedFileName: item.fileName,
        meta: item.meta,
        stateTag: ci.stateTag,
        tags: ci.tags ?? [],
        round: ci.round,
        memo: ci.memo,
        acquisition: item.setup.acquisition,
        importBatchId: batchId,
        importedAt: startedAt
      })
      result.copiedCount++
      result.items.push({ itemId: item.itemId, fileName: item.fileName, status: 'copied', fileId: id, planId, specimenId, storedRelPath, errorMessage: null })
    }
  }
  state.activeCommit = null
  emit({ operation: 'commit', operationId: batchId, phase: 'done', current: req.items.length, total: req.items.length })
  result.finishedAt = nowIso()
  recount()
  const entry: ImportHistoryEntry = {
    batchId,
    startedAt,
    finishedAt: result.finishedAt,
    status: result.status === 'cancelled' ? 'cancelled' : result.failedCount > 0 ? 'partial' : 'completed',
    inputPaths: preview.inputPaths,
    totalItems: preview.items.length,
    copiedCount: result.copiedCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    createdPlanIds,
    totalBytes: result.items.reduce((s, r) => s + (r.status === 'copied' ? (preview.items.find((x) => x.itemId === r.itemId)?.sizeBytes ?? 0) : 0), 0)
  }
  state.history.unshift(entry)
  state.previews.delete(req.previewId)
  return ok(result)
}

/**
 * reviewDemo: 검수 탭 시연 데이터(두 번째 판독자 lee-l2 블라인드 세트·Level III park-l3·물리 결함)를 넣을지.
 * 기본은 브라우저(dev:web)에서만 — node 테스트의 데모 데이터(라벨러 1명)는 그대로 둔다.
 */
export function createMockApi(scenario: MockScenario = 'default', options: { reviewDemo?: boolean } = {}): PautApi {
  state = initState(scenario)
  return {
    app: {
      info: () =>
        respond(() => ({
          appName: 'PAUT 데이터 관리 (mock)',
          version: '0.1.0',
          platform: 'web' as const,
          electron: null,
          node: null,
          catalogPath: state.settings.storeRoot ? `${state.settings.storeRoot}/catalog.db` : null,
          mock: true
        }))
    },
    settings: {
      get: () => respond(() => ({ ...state.settings })),
      set: (patch) => respond(() => (state.settings = { ...state.settings, ...patch })),
      chooseStoreRoot: () => respond(() => (state.settings.storeRoot = MOCK_STORE_ROOT))
    },
    plans: {
      list: () => respond(() => state.plans.map((p) => ({ ...p }))),
      get: (id) => respond(() => ({ ...findPlan(id) })),
      rename: (id, name) =>
        respond(() => {
          if (!name.trim()) throw new Error('플랜 이름을 입력하세요.')
          const p = findPlan(id)
          Object.assign(p, { name: name.trim(), updatedAt: nowIso() })
          return { ...p }
        }),
      setNote: (id, note) =>
        respond(() => {
          const p = findPlan(id)
          Object.assign(p, { note, updatedAt: nowIso() })
          return { ...p }
        })
    },
    specimens: {
      list: (planId) =>
        respond(() =>
          state.specimens
            .map((s) => summarize(s, planId))
            .filter((s) => !planId || s.planIds.includes(planId))
            .sort((a, b) => a.id.localeCompare(b.id))
        ),
      get: (id) =>
        respond(() => {
          const s = state.specimens.find((x) => x.id === id)
          if (!s) throw new Error(`시편 ${id} 을(를) 찾을 수 없습니다.`)
          return summarize(s)
        }),
      update: (id, patch) =>
        respond(() => {
          const s = state.specimens.find((x) => x.id === id)
          if (!s) throw new Error(`시편 ${id} 을(를) 찾을 수 없습니다.`)
          Object.assign(s, patch)
          return { ...s }
        })
    },
    files: {
      list: (q) => respond(() => queryFiles(q)),
      get: (id) => respond(() => ({ ...findFile(id) })),
      update: (id, patch) =>
        respond(() => {
          const f = findFile(id)
          Object.assign(f, patch)
          return { ...f }
        }),
      reveal: (id) =>
        respond(() => {
          console.info('[mock] 탐색기에서 보기:', findFile(id).storedRelPath)
        }),
      pathForFile: (file) => file.name
    },
    import: {
      choosePaths: (mode) => respond(() => (mode === 'folder' ? [MOCK_SOURCE_DIR] : [`${MOCK_SOURCE_DIR}/12T-SV-05-Cap on.nde`])),
      analyze,
      commit,
      cancel: (operationId) =>
        respond(() => {
          if (state.activeCommit !== operationId) return false
          state.cancelRequested = true
          return true
        }),
      history: () => respond(() => state.history.map((h) => ({ ...h })))
    },
    store: {
      maintenance: () => respond(() => state.maintenance)
    },
    viewer: {
      open: (id) =>
        respond(() => {
          const file = findFile(id)
          // OPD 파일은 OPD 모양 정보(대조 전·추정 눈금·문턱 모름·막힘)로 — 진폭은 같은 가짜 볼륨(그룹 0)
          return { file: { ...file }, key: viewerKey(file), info: isOpdMeta(file.meta) ? mockOpdViewerInfo() : withMockSettings(mockViewerInfo()) }
        }),
      chunk: (id, key, groupId, scanStart, scanCount) =>
        respond(() => {
          const cur = viewerKey(findFile(id))
          if (cur !== key) throw new AppError('CONFLICT', '저장소나 파일이 바뀌었습니다. 다시 여세요.', `${key} != ${cur}`)
          return mockViewerChunk(groupId, scanStart, scanCount)
        }),
      // C-scan 내보내기: 실제 서비스처럼 가짜 볼륨으로 C-scan 을 다시 계산해 OmniPC 꼴 글자를 만들고, 쓰지는 않고 결과만 돌려준다
      exportCscan: (req) =>
        respond(() => {
          const file = findFile(req.fileId)
          if (viewerKey(file) !== req.key) throw new AppError('CONFLICT', '저장소나 파일이 바뀌었습니다. 다시 여세요.', `${req.key} != ${viewerKey(file)}`)
          const info = isOpdMeta(file.meta) ? mockOpdViewerInfo() : mockViewerInfo()
          const g = info.groups.find((x) => x.id === req.groupId && x.supported)
          if (!g) throw new AppError('NDE_UNSUPPORTED', '이 그룹은 이미지로 볼 수 없습니다.')
          const fileGate = findGate(g, g.cscanGateId)
          if (!fileGate) throw new AppError('NDE_UNSUPPORTED', '이 그룹에는 C-scan 게이트가 없습니다.')
          const gate = applyGateOverride(fileGate, g, req.gate)
          const cs = createGateCscan(g, gate.id)
          fillGateCscan(cs, g, gate, mockViewerChunk(g.id, 0, g.shape[0]))
          const dataFile = file.storedFileName.replace(/\.[^.]+$/, '')
          const text = cscanToOmniTxt(g, cs, gate, { dataFile, inspectionDate: isOpdMeta(file.meta) ? null : (file.meta.createdAt?.slice(0, 10) ?? null) })
          const name = omniCscanTxtFileName(dataFile, new Date())
          console.info('[mock] C-scan 내보내기:', name, `${text.length}자`)
          return {
            path: `${MOCK_EXPORT_DIR}/${name}`,
            bytes: new TextEncoder().encode(text).length,
            scanCount: g.shape[0],
            indexCount: g.shape[1],
            indexConfirmed: omniCscanIndexAxis(g).confirmed,
            unconfirmed: omniCscanUnconfirmed(g, info.formatFamily)
          }
        }),
      // 색표 불러오기: Evident 색표는 묶지 않으므로 앱이 만든 회색 256단계를 '고른 파일'처럼 돌려준다
      openPalette: () =>
        respond(() => ({
          name: 'mock_회색',
          palette: Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0').repeat(3)),
          specialColors: [...DEFAULT_SPECIAL_COLORS],
          specialFromFile: false,
          format: 'xml' as const
        }))
    },
    labels: createMockLabelApi({
      respond,
      files: () => state.files,
      plans: () => state.plans,
      now: nowIso,
      seeded: scenario === 'default' || scenario === 'recovered',
      reviewDemo: (scenario === 'default' || scenario === 'recovered') && (options.reviewDemo ?? typeof (globalThis as { window?: unknown }).window !== 'undefined')
    }),
    onProgress: (cb) => {
      state.listeners.add(cb)
      return () => {
        state.listeners.delete(cb)
      }
    }
  }
}

// ───────────────────────────── 라벨 API mock ─────────────────────────────

/**
 * 브라우저(dev:web)용 라벨 API mock — 메모리 저장. 실제 서비스(core/service/labels.ts)와 같은 계약·오류 코드를 지킨다.
 * - 저장: versions 가 저장된 것과 다르면 CONFLICT, 내용이 같으면 changed = false, 고치면 이 PC 횟수 +1.
 * - 2인 모드: 지금 라벨러 세트만 보이고 다른 라벨러 기록은 고칠 수 없음.
 * - 엑셀: 경로 이름에 'error'·'오류' 가 있으면 오류가 난 미리보기, 'group'·'그룹' 이 있으면 그룹 물음(답을 넣어 다시 읽으면 풀림),
 *   아니면 X3 비슷한 파일마다 지시 1~2건. '엑셀 가져오기'는 누를 때마다 보통 → 그룹 물음 → 오류 엑셀을 차례로 고른다.
 * - JSON: 내보낸 글자를 메모리에 두고, 가져오기는 그것(없으면 지금 상태)을 버전 벡터로 합친다. 2인 모드면 지금 라벨러 세트만 내보낸다.
 * - 라벨러 추가: 이미 있는 ID 는 overwrite 일 때만 (아니면 CONFLICT).
 * - 검수(3단계): 계산은 실제와 같은 shared/labels/review 함수. 2인 모드면 막고, 행 지문이 다르면 CONFLICT,
 *   Level III 가 아니거나 잠긴 시험 세트의 확정 세트를 바꾸면 확인 없이 CONFLICT. reviewDemo 면 kim-l2 와 견줄
 *   lee-l2 블라인드 세트·park-l3(PAUT Level III)·두 시편의 물리 결함(설계도)을 더 넣는다.
 */
export interface MockLabelContext {
  respond: <T>(fn: () => T) => Promise<ApiResult<T>>
  files: () => readonly FileRecord[]
  plans: () => readonly ScanPlan[]
  /** 로컬 시각 ISO */
  now: () => string
  /** 데모 라벨(라벨러·기록·충돌 1건)을 넣을지 */
  seeded: boolean
  /** 검수 시연 데이터(lee-l2 블라인드 세트·park-l3·물리 결함)를 더 넣을지 (seeded 일 때만) */
  reviewDemo?: boolean
}

interface MockConflict {
  id: number
  entity: LabelEntityKind
  key: string
  sha256: string | null
  labelerId: string | null
  mineAtDetection: LabelEntityValue
  theirs: LabelEntityValue
  sourcePcId: string | null
  sourceName: string | null
  sourceExportedAt: string | null
  detectedAt: string
  resolvedAt: string | null
  resolution: LabelConflictChoice | 'superseded' | null
  resolvedNewKey: string | null
}

interface MockPreview {
  previewId: string
  path: string
  reader: LabelerInfo & { readingStage: IndicationRecord['readingStage']; guidelineVersion: string }
  records: IndicationRecord[]
  reviews: ReviewInterval[]
  alignments: FileAlignment[]
  ok: boolean
  groupQuestions: LabelWorkbookPreview['groupQuestions']
}

const NO_LABELER = '\u0000'
const BOOKKEEPING = new Set(['versions', 'revision', 'pcId', 'updatedAt', 'createdAt'])

/** 키를 정렬한 JSON (내용 비교용) */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(',')}}`
}

function sameContent(a: unknown, b: unknown): boolean {
  const strip = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !BOOKKEEPING.has(k))) : v
  return canon(strip(a)) === canon(strip(b))
}

/** 글자 → 결정적 UUID (v5 모양, mock 전용 해시) */
function mockUuid(key: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  let hex = ''
  for (let round = 0; hex.length < 32; round++) {
    for (let i = 0; i < key.length; i++) {
      h1 = Math.imul(h1 ^ key.charCodeAt(i), 16777619) >>> 0
      h2 = Math.imul(h2 + key.charCodeAt(i) + round, 2246822519) >>> 0
    }
    hex += (h1 ^ h2).toString(16).padStart(8, '0')
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function randomUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID ? c.randomUUID() : mockUuid(`${Date.now()}|${Math.random()}`)
}

function emptyCounts(): LabelPlanCounts {
  return { create: 0, update: 0, unchanged: 0, kept: 0, conflict: 0, remove: 0 }
}

function stampName(iso: string): string {
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}`
}

export function createMockLabelApi(ctx: MockLabelContext): PautApi['labels'] {
  const st = {
    pcId: 'pc-mock01',
    labelerId: null as string | null,
    blindMode: false,
    labelers: new Map<string, LabelerInfo>(),
    records: new Map<string, IndicationRecord>(),
    observations: new Map<string, ObservationRow>(),
    reviews: new Map<string, ReviewInterval>(),
    alignments: new Map<string, FileAlignment>(),
    physical: new Map<string, PhysicalDefect>(),
    events: new Map<string, WorkEvent>(),
    conflicts: new Map<number, MockConflict>(),
    previews: new Map<string, MockPreview>(),
    lastExport: null as string | null,
    seq: 0,
    chooseCount: 0,
    /** 학습 데이터 분할 (키 = 소문자 시편 ID) */
    splits: new Map<string, { specimenId: string; split: TrainSplit; at: string }>(),
    testLock: { locked: false, at: null as string | null, by: null as string | null },
    splitLog: [] as TrainingSplitLogEntry[],
    training: null as { operationId: string; progress: TrainingExportProgress; cancel: boolean } | null,
    trainingSeq: 0,
    /** 제출(잠금)한 세트: setId → 시각 */
    submitted: new Map<string, string>(),
    /** 설계값 대조로 복사한 세트: 새 setId → 원본 setId */
    copiedFrom: new Map<string, string>()
  }
  const slot = (): string => `${st.pcId}:mock0001`
  const R = ctx.respond
  const fileBySha = (sha: string): FileRecord | null => ctx.files().find((f) => f.meta.sha256 === sha) ?? null
  const visible = (): string | null => (st.blindMode ? (st.labelerId ?? NO_LABELER) : null)
  const shown = (labelerId: string): boolean => {
    const v = visible()
    return v === null || v === labelerId
  }
  const invalid = (m: string): never => {
    throw new AppError('INVALID_ARGUMENT', m)
  }
  const guard = (labelerId: string): void => {
    if (!st.labelers.has(labelerId)) invalid(`등록되지 않은 라벨러입니다: ${labelerId}. 라벨 관리에서 라벨러를 먼저 추가하세요.`)
    if (!shown(labelerId)) invalid('2인 독립 모드에서는 지금 라벨러의 기록만 고칠 수 있습니다.')
  }
  /** 서비스 guardSet 과 같은 규칙: 확정 세트는 검수 화면에서만, 제출한 세트는 고치지 않음 */
  const guardSet = (k: LabelSetKey): void => {
    if (k.readingStage === 'final') invalid("확정 세트는 '라벨 관리 → 검수 → Level III 확정'에서만 저장·지움 표시합니다 (Level III 확인·시험 세트 잠금·검수 출처를 함께 남기려고).")
    const at = st.submitted.get(labelSetId(k))
    if (at) {
      throw new AppError(
        'CONFLICT',
        `제출(잠금)한 세트입니다 (${at}). 블라인드 기준선을 지키려고 고치지 않습니다 — 설계값을 본 뒤에는 '설계값 대조 시작'으로 만든 사본에서 고치세요. 꼭 고쳐야 하면 세트 줄에서 제출을 푸세요(이유 필요).`
      )
    }
  }
  /** 기록이 걸친 그룹 (실제 저장소 store.ts recordGroups 와 같음) */
  const recordGroups = (r: IndicationRecord): Set<number> => {
    const g = new Set<number>()
    for (const p of r.anchors) g.add(p.anchor.groupId)
    if (r.length.groupId !== null) g.add(r.length.groupId)
    if (r.signal.peak?.groupId != null) g.add(r.signal.peak.groupId)
    return g
  }
  /** 같은 세트의 검토 완료 구간 가운데 기록과 겹치는 것을 푼다 (store.ts releaseOverlapping 과 같은 규칙: 그룹이 같거나 모르면) */
  const releaseOverlapping = (rs: readonly IndicationRecord[]): ReviewInterval[] => {
    const out: ReviewInterval[] = []
    const first = rs[0]
    if (!first) return out
    for (const v of [...st.reviews.values()]) {
      if (!sameLabelSet(v, first) || v.kind !== 'reviewed' || v.released || v.deleted) continue
      const hit = rs.some((r) => {
        const a = Math.min(r.derived.scanStartMm, r.derived.scanEndMm)
        const b = Math.max(r.derived.scanStartMm, r.derived.scanEndMm)
        if (a > v.scanEndMm || b < v.scanStartMm) return false
        if (v.groupId === null) return true
        const g = recordGroups(r)
        return g.size === 0 || g.has(v.groupId)
      })
      if (hit) out.push(saveVersioned(st.reviews, v.uuid, { ...v, released: true }, '검토 구간').value)
    }
    return out
  }
  /** 서비스 releasesReviews 와 같은 규칙: 위치·길이·구분이 바뀔 때만 (새 기록은 결함만) */
  const positionKey = (r: IndicationRecord): string =>
    JSON.stringify([r.kind, r.deleted, r.derived.scanStartMm, r.derived.scanEndMm, r.derived.vMinMm, r.derived.vMaxMm, r.derived.depthTopMm, r.derived.depthBottomMm, r.anchors.map((p) => [p.role, p.anchor, p.mm]), r.length.valueMm, r.length.groupId, r.length.beam])
  const releasesReviews = (before: IndicationRecord | undefined, after: IndicationRecord): boolean =>
    !before || before.deleted ? after.kind === 'defect' && !after.deleted : positionKey(before) !== positionKey(after)
  const shaOf = (q?: { fileId?: number; sha256?: string }): string | undefined => {
    if (q?.fileId !== undefined) {
      const f = ctx.files().find((x) => x.id === q.fileId)
      if (!f) throw new AppError('NOT_FOUND', `파일 #${q.fileId} 을(를) 찾을 수 없습니다.`)
      return f.meta.sha256
    }
    return q?.sha256?.toLowerCase()
  }
  const session = (): LabelSession => {
    const labelers = [...st.labelers.values()].sort((a, b) => a.id.localeCompare(b.id))
    return {
      pcId: st.pcId,
      versionSlot: slot(),
      notices: [],
      labelerId: st.labelerId,
      labeler: st.labelerId ? (st.labelers.get(st.labelerId) ?? null) : null,
      blindMode: st.blindMode,
      labelers
    }
  }

  /** 버전이 있는 값 저장 (실제 저장소 saveVersioned 와 같은 규칙) */
  function saveVersioned<T extends { versions: VersionEntry[] }>(map: Map<string, T>, key: string, value: T, what: string): { value: T; changed: boolean } {
    const old = map.get(key)
    if (old) {
      if (compareVersions(value.versions, old.versions) !== 'same') {
        throw new AppError('CONFLICT', `${what}이(가) 그사이 다른 곳에서 바뀌었습니다. 다시 열어 고치세요.`)
      }
      if (sameContent(old, value)) return { value: old, changed: false }
    }
    const versions = bumpVersions(old?.versions ?? value.versions, slot())
    const o: Record<string, unknown> = { ...value, versions, revision: versionTotal(versions), pcId: st.pcId }
    if ('updatedAt' in o) o.updatedAt = ctx.now()
    if ('createdAt' in o) o.createdAt = (old as { createdAt?: string | null } | undefined)?.createdAt ?? (o.createdAt as string | null) ?? ctx.now()
    const next = o as T
    map.set(key, next)
    return { value: next, changed: true }
  }

  function setsOf(sha?: string): LabelSetInfo[] {
    const sets = new Map<string, LabelSetInfo>()
    const ensure = (k: LabelSetKey): LabelSetInfo => {
      const id = labelSetId(k)
      let s = sets.get(id)
      if (!s) {
        const f = fileBySha(k.sha256)
        s = {
          sha256: k.sha256,
          labelerId: k.labelerId,
          guidelineVersion: k.guidelineVersion,
          readingStage: k.readingStage,
          setId: id,
          recordCount: 0,
          defectCount: 0,
          echoCount: 0,
          imperfectionCount: 0,
          deletedRecordCount: 0,
          reviewIntervalCount: 0,
          reviewedLengthMm: 0,
          qualityBadLengthMm: 0,
          belowThresholdLengthMm: 0,
          lastStoredAt: null,
          fileId: f?.id ?? null,
          fileName: f?.storedFileName ?? null,
          pendingConflicts: 0,
          labelerName: st.labelers.get(k.labelerId)?.name ?? null,
          submittedAt: st.submitted.get(id) ?? null,
          copiedFrom: st.copiedFrom.get(id) ?? null
        }
        sets.set(id, s)
      }
      return s
    }
    const KIND: Record<RecordKind, 'defectCount' | 'echoCount' | 'imperfectionCount'> = {
      defect: 'defectCount',
      'geometric-echo': 'echoCount',
      'geometric-imperfection': 'imperfectionCount'
    }
    for (const r of st.records.values()) {
      if ((sha && r.sha256 !== sha) || !shown(r.labelerId)) continue
      const s = ensure(r)
      if (r.deleted) s.deletedRecordCount++
      else {
        s.recordCount++
        s[KIND[r.kind]]++
      }
      if (!s.lastStoredAt || (r.updatedAt ?? '') > s.lastStoredAt) s.lastStoredAt = r.updatedAt
    }
    for (const v of st.reviews.values()) {
      if ((sha && v.sha256 !== sha) || !shown(v.labelerId) || v.deleted) continue
      const s = ensure(v)
      s.reviewIntervalCount++
      const len = v.scanEndMm - v.scanStartMm
      if (v.kind === 'reviewed' && !v.released) s.reviewedLengthMm += len
      if (v.kind === 'quality-bad') s.qualityBadLengthMm += len
      if (v.kind === 'below-threshold') s.belowThresholdLengthMm += len
    }
    for (const c of st.conflicts.values()) {
      if (c.resolvedAt || !c.sha256 || !c.labelerId) continue
      const r = st.records.get(c.key) ?? st.reviews.get(c.key)
      if (r && shown(r.labelerId)) {
        const s = sets.get(labelSetId(r))
        if (s) s.pendingConflicts++
      }
    }
    return [...sets.values()].filter((s) => s.recordCount + s.reviewIntervalCount > 0).sort((a, b) => a.setId.localeCompare(b.setId))
  }

  function pendingConflicts(sha?: string): MockConflict[] {
    return [...st.conflicts.values()].filter(
      (c) => !c.resolvedAt && (sha === undefined || c.sha256 === sha) && (c.labelerId === null || shown(c.labelerId))
    )
  }

  function entityMap(entity: LabelEntityKind): Map<string, LabelEntityValue> {
    const maps: Record<LabelEntityKind, Map<string, LabelEntityValue>> = {
      'physical-defect': st.physical as Map<string, LabelEntityValue>,
      'file-alignment': st.alignments as Map<string, LabelEntityValue>,
      record: st.records as Map<string, LabelEntityValue>,
      observation: st.observations as Map<string, LabelEntityValue>,
      'review-interval': st.reviews as Map<string, LabelEntityValue>,
      'work-event': st.events as Map<string, LabelEntityValue>
    }
    return maps[entity]
  }

  function conflictInfo(c: MockConflict): LabelConflictInfo {
    const f = c.sha256 ? fileBySha(c.sha256) : null
    return {
      ...c,
      sourceName: c.sourceName ?? null,
      fileId: f?.id ?? null,
      fileName: f?.storedFileName ?? null,
      mine: entityMap(c.entity).get(c.key) ?? null,
      choices: [...LABEL_CONFLICT_CHOICES[c.entity]]
    }
  }

  function keyOf(entity: LabelEntityKind, v: LabelEntityValue): string {
    if (entity === 'physical-defect') return JSON.stringify([(v as PhysicalDefect).specimenId, (v as PhysicalDefect).id])
    if (entity === 'file-alignment') return (v as FileAlignment).sha256
    if (entity === 'observation') {
      const o = v as ObservationRow
      return JSON.stringify([o.recordUuid, o.groupId, o.leg])
    }
    return (v as { uuid: string }).uuid
  }

  function exportFile(req: LabelExportRequest): LabelExportFile {
    const keep = (sha: string | null): boolean => req.kind === 'all' || (sha !== null && req.sha256s.includes(sha))
    const records = [...st.records.values()].filter((r) => keep(r.sha256) && shown(r.labelerId))
    return newLabelExport(
      { appVersion: '0.1.0-mock', exportedAt: ctx.now(), pcId: st.pcId },
      {
        labelers: [...st.labelers.values()],
        physicalDefects: req.kind === 'all' ? [...st.physical.values()] : [],
        fileAlignments: [...st.alignments.values()].filter((a) => keep(a.sha256)),
        records,
        observations: [...st.observations.values()].filter((o) => records.some((r) => r.uuid === o.recordUuid)),
        reviewIntervals: [...st.reviews.values()].filter((v) => keep(v.sha256) && shown(v.labelerId)),
        workEvents: [...st.events.values()].filter((e) => keep(e.sha256) && shown(e.labelerId))
      }
    )
  }

  // ── 엑셀 미리보기 (가짜 파서) ──
  function fakeParse(path: string, groupChoices: Record<string, number> = {}): MockPreview {
    const lee = /lee/i.test(path)
    const reader = lee
      ? { id: 'lee-l2', name: 'lee-l2', qualification: 'UT Level II', organization: null, readingStage: 'blind' as const, guidelineVersion: 'v1' }
      : { id: 'kim-l2', name: 'kim-l2', qualification: 'UT Level II', organization: null, readingStage: 'blind' as const, guidelineVersion: 'v1' }
    const now = ctx.now()
    const base = { labelerId: reader.id, guidelineVersion: 'v1', readingStage: reader.readingStage, versions: [{ pcId: slot(), edits: 1 }], pcId: st.pcId, createdAt: now, updatedAt: now }
    const x3 = ctx.files().filter((f) => f.meta.deviceFileName?.startsWith('12T'))
    const records: IndicationRecord[] = []
    const reviews: ReviewInterval[] = []
    const alignments: FileAlignment[] = []
    x3.forEach((f, i) => {
      const sha = f.meta.sha256
      const at = 30 + i * 40 + (lee ? 2 : 0)
      records.push(
        newIndicationRecord({
          ...base,
          uuid: mockUuid(`indication|${sha}|${reader.id}|v1|blind|1`),
          sha256: sha,
          externalRef: '1',
          kind: 'defect',
          derived: { scanStartMm: at, scanEndMm: at + 16, vMinMm: -8, vMaxMm: -5.5, depthTopMm: 0.5, depthBottomMm: 3 },
          defectType: i % 2 ? 'lof-sidewall' : 'crack-toe',
          existenceConfidence: i === 2 ? 'probable' : 'certain',
          length: { valueMm: 16, method: 'eval-level' },
          signal: { maxAmplitudePct: 87.5, saturated: false }
        })
      )
      if (i === 0) {
        records.push(
          newIndicationRecord({
            ...base,
            uuid: mockUuid(`indication|${sha}|${reader.id}|v1|blind|2`),
            sha256: sha,
            externalRef: '2',
            kind: 'geometric-echo',
            derived: { scanStartMm: 0, scanEndMm: 300 },
            geometricEcho: { kind: 'root', fromSuggestion: false }
          })
        )
      }
      reviews.push(
        newReviewInterval({ ...base, uuid: mockUuid(`review|${sha}|${reader.id}|reviewed|0|300`), sha256: sha, kind: 'reviewed', groupId: null, scanStartMm: 0, scanEndMm: 300 })
      )
      alignments.push(
        newFileAlignment({ sha256: sha, fileName: f.storedFileName, specimenId: f.specimenId, datumUMm: 0, direction: 1, alignmentAssumed: true, thicknessMm: 12, enteredBy: reader.id, versions: base.versions, pcId: st.pcId, updatedAt: now })
      )
    })
    // 'group' 경로: 파일마다 'Skew 270' 그룹이 둘이라 묻는다 (답이 있으면 풀림)
    const groupQuestions: MockPreview['groupQuestions'] = /group|그룹/i.test(path)
      ? x3
          .map((f) => ({
            key: `${f.meta.sha256}|sect-270`,
            sha256: f.meta.sha256,
            fileName: f.storedFileName,
            code: 'sect-270' as const,
            label: '섹토리얼 Skew 270',
            candidates: [
              { id: 1, name: 'Skew270' },
              { id: 7, name: 'Skew270 (2)' }
            ],
            where: ["'지시' 시트 2행 D열 '그룹 (기법·Skew)'"]
          }))
          .filter((q) => groupChoices[q.key] === undefined)
      : []
    const ok = !/error|오류/i.test(path) && groupQuestions.length === 0
    return { previewId: `LX-mock-${++st.seq}`, path, reader, records, reviews, alignments, ok, groupQuestions }
  }

  function planOf(p: MockPreview): { plan: Record<LabelEntityKind, LabelPlanCounts>; changes: LabelWorkbookChange[] } {
    const plan = Object.fromEntries(LABEL_ENTITY_KINDS.map((k) => [k, emptyCounts()])) as Record<LabelEntityKind, LabelPlanCounts>
    const changes: LabelWorkbookChange[] = []
    const step = <T>(entity: LabelEntityKind, items: T[], keyOfItem: (x: T) => string, nameOf: (x: T) => string, shaOf: (x: T) => string): void => {
      for (const x of items) {
        const old = entityMap(entity).get(keyOfItem(x))
        const action = !old ? 'create' : sameContent(old, x) ? 'unchanged' : 'update'
        plan[entity][action]++
        if (action === 'update') changes.push({ action: 'update', entity, sha256: shaOf(x), name: nameOf(x), reason: '엑셀 값으로 고칠 항목' })
      }
    }
    const fname = (sha: string): string => fileBySha(sha)?.storedFileName ?? sha.slice(0, 12)
    step('record', p.records, (r) => r.uuid, (r) => `${fname(r.sha256)} 지시 ${r.externalRef ?? ''}`, (r) => r.sha256)
    step('review-interval', p.reviews, (v) => v.uuid, (v) => `${fname(v.sha256)} ${v.scanStartMm}–${v.scanEndMm} mm`, (v) => v.sha256)
    step('file-alignment', p.alignments, (a) => a.sha256, (a) => fname(a.sha256), (a) => a.sha256)
    return { plan, changes }
  }

  const totalsOf = (plan: Record<LabelEntityKind, LabelPlanCounts>): LabelPlanCounts => {
    const t = emptyCounts()
    for (const c of Object.values(plan)) for (const k of Object.keys(t) as (keyof LabelPlanCounts)[]) t[k] += c[k]
    return t
  }

  // ── 학습 데이터 분할 · 내보내기 (실제: core/labels/export, 같은 규칙을 짧게) ──
  const splitKeyOf = (id: string): string => id.normalize('NFC').trim().replace(/[A-Z]/g, (c) => c.toLowerCase())
  const splitOfSpecimen = (id: string | null): TrainSplit | null => (id ? (st.splits.get(splitKeyOf(id))?.split ?? null) : null)

  function splitView(): TrainingSplitView {
    const sets = setsOf()
    const best = new Map<string, number>()
    for (const s of sets) best.set(s.sha256, Math.max(best.get(s.sha256) ?? 0, s.defectCount))
    const rows = new Map<string, TrainingSplitView['specimens'][number]>()
    const row = (specimenId: string): TrainingSplitView['specimens'][number] => {
      const key = splitKeyOf(specimenId)
      let r = rows.get(key)
      if (!r) {
        const a = st.splits.get(key)
        r = { specimenId, split: a?.split ?? null, fileCount: 0, labeledFileCount: 0, defectCount: 0, physicalDefectCount: 0, planIds: [], assignedAt: a?.at ?? null }
        rows.set(key, r)
      }
      return r
    }
    for (const f of ctx.files()) {
      const r = row(f.specimenId)
      r.fileCount++
      if (!r.planIds.includes(f.planId)) r.planIds.push(f.planId)
      if (best.has(f.meta.sha256)) {
        r.labeledFileCount++
        r.defectCount += best.get(f.meta.sha256)!
      }
    }
    for (const a of st.splits.values()) row(a.specimenId)
    for (const d of st.physical.values()) {
      const r = rows.get(splitKeyOf(d.specimenId))
      if (r && !d.deleted) r.physicalDefectCount++
    }
    const specimens = [...rows.values()].sort((a, b) => a.specimenId.localeCompare(b.specimenId, 'ko'))
    const counts: Record<TrainSplitOrNone, number> = { train: 0, val: 0, test: 0, unassigned: 0 }
    for (const r of specimens) counts[r.split ?? 'unassigned']++
    return {
      unit: 'specimen',
      testLocked: st.testLock.locked,
      testLockedAt: st.testLock.at,
      testLockedBy: st.testLock.locked ? st.testLock.by : null,
      specimens,
      counts,
      log: st.splitLog.slice(-100).reverse()
    }
  }

  const lockedReasonOf = (o: TrainingSplitOptions | undefined): string => {
    const reason = (o?.reason ?? '').trim()
    if (o?.confirmLocked !== true || !reason) {
      throw new AppError('CONFLICT', '시험 세트가 잠겨 있습니다. test 로 넣거나 test 에서 빼려면 이유를 적고 한 번 더 확인하세요(바꾼 기록에 남습니다).')
    }
    return reason
  }

  const STAGE_KO = { final: '확정', reconciled: '설계값 대조', blind: '블라인드' } as const

  function candidates(rule: TrainingSetRule): TrainingSetChoice[] {
    const bySha = new Map<string, LabelSetInfo[]>()
    for (const s of setsOf()) bySha.set(s.sha256, [...(bySha.get(s.sha256) ?? []), s])
    const out: TrainingSetChoice[] = []
    for (const [sha, list] of bySha) {
      const f = fileBySha(sha)
      const specimenId = f?.specimenId ?? st.alignments.get(sha)?.specimenId ?? null
      let chosen: string | null = null
      let reason = '규칙에 맞는 세트가 없습니다.'
      const forced = rule.overrides?.[sha]
      // 서비스 selectSets.pickLabelSet 과 같은 규칙: 시험(test) 분할은 확정 세트만
      const testOnly = splitOfSpecimen(specimenId) === 'test' && rule.testFinalOnly !== false
      if (forced !== undefined) {
        const hit = list.find((s) => s.setId === forced)
        chosen = hit && !(testOnly && hit.readingStage !== 'final') ? forced : null
        reason = chosen ? '직접 고름' : hit ? '시험(test) 분할은 확정 세트만 씁니다 — 직접 고른 세트가 확정이 아닙니다.' : '직접 고른 세트를 찾을 수 없습니다. 다시 고르세요.'
      } else if (testOnly && !list.some((s) => s.readingStage === 'final')) {
        reason = '시험(test) 분할은 확정 세트만 씁니다 (평가 정의 1·2절) — 이 파일에는 확정 세트가 없습니다.'
      } else {
        for (const stage of testOnly ? rule.stages.filter((x) => x === 'final') : rule.stages) {
          let pool = list.filter((s) => s.readingStage === stage)
          if (stage === 'blind') {
            if (!rule.blindLabelerId) continue
            pool = pool.filter((s) => s.labelerId === rule.blindLabelerId)
          }
          if (pool.length === 1) {
            chosen = pool[0]!.setId
            reason = `${STAGE_KO[stage]} 세트 (${pool[0]!.labelerId} · 지침서 ${pool[0]!.guidelineVersion})`
            break
          }
          if (pool.length > 1) {
            reason = `${STAGE_KO[stage]} 세트가 ${pool.length}개라 고르지 않았습니다. 파일 줄에서 직접 고르세요.`
            break
          }
        }
      }
      out.push({
        sha256: sha,
        fileId: f?.id ?? null,
        fileName: f?.storedFileName ?? sha.slice(0, 12),
        specimenId,
        split: splitOfSpecimen(specimenId),
        candidates: list.map((s) => ({
          setId: s.setId,
          labelerId: s.labelerId,
          readingStage: s.readingStage,
          guidelineVersion: s.guidelineVersion,
          defectCount: s.defectCount,
          pendingConflicts: s.pendingConflicts
        })),
        chosen,
        reason,
        hasFile: f !== null
      })
    }
    return out.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ko'))
  }

  /** 가짜 내보내기: 파일마다 1.4초쯤 걸리는 척하며 진행률을 올린다 (취소되면 CANCELLED) */
  async function fakeTrainingExport(req: TrainingExportRequest, dir: string): Promise<ApiResult<TrainingExportResult>> {
    await delay(60)
    if (st.training) return fail('BUSY', '학습 데이터를 내보내는 중입니다. 끝난 뒤 다시 시도하세요.')
    const shas = req.sha256s?.length ? new Set(req.sha256s) : null
    const splits = req.splits?.length ? new Set(req.splits) : null
    if (!shas && !splits) return fail('INVALID_ARGUMENT', '내보낼 파일이나 분할을 고르세요.')
    const list = candidates(req.setRule).filter((c) => (!shas || shas.has(c.sha256)) && (!splits || splits.has(c.split ?? 'unassigned')))
    if (list.length === 0) return fail('INVALID_ARGUMENT', '고른 조건에 맞는 라벨 있는 파일이 없습니다.')
    const operationId = `TX-mock-${++st.trainingSeq}`
    const job = {
      operationId,
      cancel: false,
      progress: { operationId, phase: 'prepare', current: 0, total: list.length, fileName: null, imagesDone: 0, imagesTotal: 0, cancelling: false } as TrainingExportProgress
    }
    st.training = job
    try {
      const files: TrainingExportFileResult[] = []
      for (const [i, c] of list.entries()) {
        const imagesTotal = req.options.images ? 120 : 0
        for (const phase of ['read', 'derive', 'write'] as const) {
          if (job.cancel) return fail('CANCELLED', '작업이 취소되었습니다.')
          job.progress = { ...job.progress, phase, current: i, fileName: c.fileName, imagesDone: 0, imagesTotal: 0 }
          await delay(200)
        }
        for (let n = 0; n < imagesTotal; n += 20) {
          if (job.cancel) return fail('CANCELLED', '작업이 취소되었습니다.')
          job.progress = { ...job.progress, phase: 'images', imagesDone: n, imagesTotal }
          await delay(120)
        }
        const good = c.chosen !== null && c.hasFile
        const set = c.candidates.find((s) => s.setId === c.chosen)
        files.push({
          sha256: c.sha256,
          fileName: c.fileName,
          specimenId: c.specimenId,
          split: c.split,
          folder: good ? `files/${c.sha256.slice(0, 16)}` : null,
          setId: c.chosen,
          status: good ? 'exported' : 'skipped',
          reason: good ? null : c.hasFile ? c.reason : '이 PC 저장소에 사본이 없습니다.',
          groups: [
            { groupId: 0, name: 'Skew90', blocked: null },
            { groupId: 1, name: 'Skew270', blocked: null }
          ],
          scenes: good ? 602 : 0,
          trainScenes: good ? { positive: 30 + (set?.defectCount ?? 0) * 12, weak: 0, ignore: 60, negative: 480, unknown: 0 } : { positive: 0, weak: 0, ignore: 0, negative: 0, unknown: 0 },
          boxes: good ? 70 : 0,
          ascanSpans: good ? 1400 : 0,
          images: good ? imagesTotal : 0,
          annotations: good && req.options.images ? 64 : 0,
          issues: good ? 3 : 0
        })
      }
      job.progress = { ...job.progress, phase: 'done', current: list.length, fileName: null }
      const exported = files.filter((f) => f.status === 'exported')
      const name = `학습데이터_${stampName(ctx.now())}_${st.pcId}`
      return ok({
        operationId,
        path: `${dir}/${name}`,
        folderName: name,
        exportedAt: req.options.fixedExportedAt ?? ctx.now(),
        files,
        totals: {
          files: files.length,
          exported: exported.length,
          skipped: files.length - exported.length,
          blockedGroups: 0,
          scenes: exported.reduce((s, f) => s + f.scenes, 0),
          images: exported.reduce((s, f) => s + f.images, 0),
          annotations: exported.reduce((s, f) => s + f.annotations, 0),
          ascanSpans: exported.reduce((s, f) => s + f.ascanSpans, 0),
          bytes: exported.length * (req.options.amplitude ? 31_000_000 : 2_000_000) + exported.reduce((s, f) => s + f.images, 0) * 40_000
        },
        warnings: exported.some((f) => f.split === null) ? ['분할을 정하지 않은 시편의 파일이 있습니다(manifest 의 split = unassigned).'] : []
      })
    } finally {
      if (st.training === job) st.training = null
    }
  }

  // ── 데모 데이터 ──
  if (ctx.seeded) {
    const x3 = ctx.files().filter((f) => f.meta.deviceFileName?.startsWith('12T'))
    if (x3.length >= 2) {
      st.labelers.set('kim-l2', { id: 'kim-l2', name: '김 판독', qualification: 'UT Level II', organization: null })
      st.labelerId = 'kim-l2'
      const p = fakeParse('D:/PAUT/라벨/기록양식_v1_kim.xlsx')
      for (const r of p.records.filter((r) => r.sha256 === x3[0]!.meta.sha256 || r.sha256 === x3[1]!.meta.sha256)) st.records.set(r.uuid, r)
      for (const v of p.reviews.slice(0, 1)) st.reviews.set(v.uuid, v)
      for (const a of p.alignments.slice(0, 2)) st.alignments.set(a.sha256, a)
      const mine = [...st.records.values()].find((r) => r.sha256 === x3[1]!.meta.sha256)!
      const theirs: IndicationRecord = {
        ...mine,
        derived: { ...mine.derived, scanEndMm: mine.derived.scanEndMm + 4 },
        length: { ...mine.length, valueMm: 20 },
        versions: [{ pcId: 'pc-field2', edits: 1 }, { pcId: st.pcId, edits: 1 }],
        revision: 2,
        pcId: 'pc-field2'
      }
      st.conflicts.set(1, {
        id: 1,
        entity: 'record',
        key: mine.uuid,
        sha256: mine.sha256,
        labelerId: mine.labelerId,
        mineAtDetection: mine,
        theirs,
        sourcePcId: 'pc-field2',
        sourceName: null,
        sourceExportedAt: '2026-10-05T17:20:00+09:00',
        detectedAt: '2026-10-06T09:10:00+09:00',
        resolvedAt: null,
        resolution: null,
        resolvedNewKey: null
      })
      st.seq = 1
    }
  }

  // ── 검수 시연 데이터 (reviewDemo: 브라우저 화면 확인용) ──
  if (ctx.seeded && ctx.reviewDemo) {
    const x3 = ctx.files().filter((f) => f.meta.deviceFileName?.startsWith('12T'))
    if (x3.length >= 2) {
      const [f1, f2] = [x3[0]!, x3[1]!]
      const now = ctx.now()
      st.labelers.set('lee-l2', { id: 'lee-l2', name: '이 판독', qualification: 'UT Level II', organization: null })
      st.labelers.set('park-l3', { id: 'park-l3', name: '박 조정', qualification: 'PAUT Level III', organization: '○○검사' })
      const v = [{ pcId: slot(), edits: 1 }]
      const rec = (labelerId: string, sha: string, ref: string, over: Partial<Parameters<typeof newIndicationRecord>[0]>): IndicationRecord =>
        newIndicationRecord({
          labelerId,
          guidelineVersion: 'v1',
          readingStage: 'blind',
          versions: v,
          pcId: st.pcId,
          createdAt: now,
          updatedAt: now,
          ...over,
          uuid: mockUuid(`indication|${sha}|${labelerId}|v1|blind|${ref}`),
          sha256: sha,
          externalRef: ref,
          kind: 'defect'
        })
      const iv = (labelerId: string, sha: string, kind: ReviewInterval['kind'], a: number, b: number, reason: ReviewInterval['reason'] = null): ReviewInterval =>
        newReviewInterval({
          uuid: mockUuid(`review|${sha}|${labelerId}|${kind}|${a}|${b}`),
          sha256: sha,
          labelerId,
          guidelineVersion: 'v1',
          versions: v,
          pcId: st.pcId,
          createdAt: now,
          updatedAt: now,
          kind,
          scanStartMm: a,
          scanEndMm: b,
          reason
        })
      const add = (r: IndicationRecord): void => void st.records.set(r.uuid, r)
      // kim-l2 (데모의 첫 판독자): F2 에 지시 둘과 검토 완료를 더한다
      add(rec('kim-l2', f2.meta.sha256, '3', { derived: { scanStartMm: 150, scanEndMm: 171, depthTopMm: 9.5, depthBottomMm: 12 }, defectType: 'crack-root', length: { valueMm: 21, method: 'eval-level' }, height: { method: 'tip-surface', valueMm: 2.5 }, signal: { maxAmplitudePct: 120, saturated: false } }))
      add(rec('kim-l2', f2.meta.sha256, '4', { derived: { scanStartMm: 250, scanEndMm: 256, depthTopMm: 6, depthBottomMm: 7 }, defectType: 'porosity-single', existenceConfidence: 'probable', length: { valueMm: 6, method: 'eval-level' } }))
      const kimF2 = iv('kim-l2', f2.meta.sha256, 'reviewed', 0, 300)
      st.reviews.set(kimF2.uuid, kimF2)
      // lee-l2 (두 번째 판독자, 블라인드): 같은 두 파일을 조금 다르게
      add(rec('lee-l2', f1.meta.sha256, '1', { derived: { scanStartMm: 32, scanEndMm: 47, vMinMm: -8, vMaxMm: -5.5, depthTopMm: 0.8, depthBottomMm: 3.4 }, defectType: 'crack-toe', length: { valueMm: 15, method: 'eval-level' }, height: { method: 'tip-tip', valueMm: 2.6 }, signal: { maxAmplitudePct: 92, saturated: false } }))
      add(rec('lee-l2', f1.meta.sha256, '2', { derived: { scanStartMm: 210, scanEndMm: 222, depthTopMm: 6, depthBottomMm: 8 }, defectType: 'slag', length: { valueMm: 12, method: 'eval-level' }, signal: { maxAmplitudePct: 64, saturated: false } }))
      add(rec('lee-l2', f2.meta.sha256, '1', { derived: { scanStartMm: 71, scanEndMm: 88, vMinMm: -8, vMaxMm: -5.5, depthTopMm: 0.7, depthBottomMm: 3.2 }, defectType: 'crack-sidewall', length: { valueMm: 17, method: 'eval-level' }, signal: { maxAmplitudePct: 81, saturated: false } }))
      add(rec('lee-l2', f2.meta.sha256, '2', { derived: { scanStartMm: 151, scanEndMm: 170, depthTopMm: 9.8, depthBottomMm: 12 }, defectType: 'crack-root', length: { valueMm: 19, method: 'eval-level' }, height: { method: 'tip-surface', valueMm: 2.2 }, signal: { maxAmplitudePct: 110, saturated: false } }))
      for (const x of [
        iv('lee-l2', f1.meta.sha256, 'reviewed', 0, 300),
        iv('lee-l2', f2.meta.sha256, 'reviewed', 0, 280),
        iv('lee-l2', f2.meta.sha256, 'quality-bad', 280, 300, 'coupling')
      ]) {
        st.reviews.set(x.uuid, x)
      }
      // 물리 결함 (설계도 — 인증·설계값 계층). 위치는 기준점(파일 정렬 U 0, +1)에서
      const pd = (specimenId: string, id: string, type: PhysicalDefect['design']['type'], a: number, b: number, depthMm: number): PhysicalDefect =>
        newPhysicalDefect({ id, specimenId, source: 'design-drawing', confirmation: 'design-only', versions: v, pcId: st.pcId, updatedAt: now, design: { type, startMm: a, endMm: b, lengthMm: b - a, depthMm } })
      for (const d of [
        pd(f1.specimenId, 'D1', 'crack-toe', 31, 45, 1),
        pd(f1.specimenId, 'D2', 'slag', 208, 220, 6.5),
        pd(f2.specimenId, 'D1', 'lof-sidewall', 72, 86, 1),
        pd(f2.specimenId, 'D2', 'crack-root', 150, 170, 10)
      ]) {
        st.physical.set(JSON.stringify([d.specimenId, d.id]), d)
      }
    }
  }

  // ── 3단계 검수 (실제: core/service/labelReview.ts — 계산은 같은 shared/labels/review 함수) ──
  const REVIEW_BLIND =
    '2인 독립 모드라 검수를 할 수 없습니다. 검수(두 사람 기록 비교·Level III 확정)는 두 블라인드 판독을 마친 뒤 Level III 가 합니다 — ' +
    '라벨러 줄에서 2인 모드를 끄고 Level III 라벨러를 고르세요.'
  const blockBlind = (): void => {
    if (st.blindMode) invalid(REVIEW_BLIND)
  }
  const adjudicatorOf = (): LabelerInfo => {
    if (!st.labelerId) return invalid('지금 라벨러를 먼저 고르세요. 확정 세트의 라벨러가 됩니다(Level III).')
    return st.labelers.get(st.labelerId) ?? invalid(`등록되지 않은 라벨러입니다: ${st.labelerId}.`)
  }
  const specimenOfSha = (sha: string): string | null => fileBySha(sha)?.specimenId ?? st.alignments.get(sha)?.specimenId ?? null
  const defectsFor = (specimens: Iterable<string>): PhysicalDefect[] => {
    const keys = new Set([...specimens].map(splitKeyOf))
    return [...st.physical.values()].filter((d) => !d.deleted && keys.has(splitKeyOf(d.specimenId)))
  }
  const thicknessOf = (sha: string): number | null => {
    const a = st.alignments.get(sha)
    if (a && !a.deleted && a.thicknessMm !== null) return a.thicknessMm
    const f = fileBySha(sha)
    const t = f ? ctx.plans().find((p) => p.id === f.planId)?.spec.specimen.thicknessMm : undefined
    return typeof t === 'number' && t > 0 ? t : null
  }
  const keyOfSide = (sha: string, k: ReviewSideKey): LabelSetKey => ({ sha256: sha, labelerId: k.labelerId, guidelineVersion: k.guidelineVersion, readingStage: k.readingStage })

  function cleanCompare(req: ReviewCompareRequest): ReviewCompareRequest {
    if (!req || !Array.isArray(req.sha256s) || req.sha256s.length === 0) invalid('비교할 파일을 고르세요.')
    for (const k of [req.a, req.b]) {
      if (!k || !k.labelerId || !['blind', 'reconciled', 'final'].includes(k.readingStage) || !k.guidelineVersion) invalid('비교할 세트가 올바르지 않습니다.')
    }
    if (req.a.labelerId === req.b.labelerId && req.a.readingStage === req.b.readingStage && req.a.guidelineVersion === req.b.guidelineVersion) {
      invalid('A 와 B 가 같은 세트입니다. 다른 라벨러나 다른 판독 단계를 고르세요.')
    }
    const o = req.options ?? {}
    for (const [v, what] of [
      [o.scanGapMm, '매칭 허용치 X (mm)'],
      [o.depthDiffMm, '매칭 허용치 Y (mm)']
    ] as const) {
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) invalid(`${what} 값이 올바르지 않습니다.`)
    }
    if (o.gradingUnitMm !== undefined && !(Number.isFinite(o.gradingUnitMm) && o.gradingUnitMm > 0)) invalid('구간 단위 길이 (mm) 값이 올바르지 않습니다.')
    return {
      sha256s: [...new Set(req.sha256s.map((x) => x.toLowerCase()))].sort(),
      a: { labelerId: req.a.labelerId, readingStage: req.a.readingStage, guidelineVersion: req.a.guidelineVersion },
      b: { labelerId: req.b.labelerId, readingStage: req.b.readingStage, guidelineVersion: req.b.guidelineVersion },
      options: {
        purpose: o.purpose ?? 'inter-reader',
        unit: o.unit ?? 'grouping',
        frame: o.frame ?? 'file',
        scanGapMm: o.scanGapMm ?? PROVISIONAL_SCAN_GAP_MM,
        depthDiffMm: o.depthDiffMm ?? PROVISIONAL_DEPTH_DIFF_MM,
        gradingUnitMm: o.gradingUnitMm ?? PROVISIONAL_GRADING_UNIT_MM
      }
    }
  }

  function rowsKeyOf(c: CompareResult): string {
    const rows = c.rows.map((r) => [r.id, r.kind, r.a?.records.map((x) => `${x.uuid}#${x.revision}`) ?? [], r.b?.records.map((x) => `${x.uuid}#${x.revision}`) ?? []])
    const p = c.context.params
    return mockUuid(JSON.stringify([rows, [c.purpose, c.context.unit, p.frame, p.scanGapMm, p.depthDiffMm, c.context.gradingUnitMm]])).replace(/-/g, '')
  }

  function runCompare(raw: ReviewCompareRequest): ReviewComparison {
    blockBlind()
    const req = cleanCompare(raw)
    const sides = { a: { records: [] as IndicationRecord[], intervals: [] as ReviewInterval[] }, b: { records: [] as IndicationRecord[], intervals: [] as ReviewInterval[] } }
    const files: ReviewFileInfo[] = []
    const fileNames: Record<string, string> = {}
    for (const sha of req.sha256s) {
      const has = { a: false, b: false }
      for (const side of ['a', 'b'] as const) {
        const k = keyOfSide(sha, req[side])
        const recs = [...st.records.values()].filter((r) => !r.deleted && sameLabelSet(r, k))
        const ivs = [...st.reviews.values()].filter((x) => !x.deleted && sameLabelSet(x, k))
        sides[side].records.push(...recs)
        sides[side].intervals.push(...ivs)
        has[side] = recs.length + ivs.length > 0
      }
      const f = fileBySha(sha)
      const name = f?.storedFileName ?? (st.alignments.get(sha)?.fileName || sha.slice(0, 12))
      fileNames[sha] = name
      const specimenId = specimenOfSha(sha)
      files.push({ sha256: sha, fileId: f?.id ?? null, planId: f?.planId ?? null, fileName: name, specimenId, split: splitOfSpecimen(specimenId), hasA: has.a, hasB: has.b })
    }
    if (files.every((f) => !f.hasA)) invalid(`고른 파일에 A (${req.a.labelerId}) 세트가 없습니다. 세트나 파일을 다시 고르세요.`)
    if (files.every((f) => !f.hasB)) invalid(`고른 파일에 B (${req.b.labelerId}) 세트가 없습니다. 세트나 파일을 다시 고르세요.`)
    const o = req.options!
    const comparison = compareLabelSets(
      { labelerId: req.a.labelerId, ...sides.a },
      { labelerId: req.b.labelerId, ...sides.b },
      {
        purpose: o.purpose!,
        unit: o.unit!,
        params: { frame: o.frame!, scanGapMm: o.scanGapMm!, depthDiffMm: o.depthDiffMm! },
        alignments: [...st.alignments.values()].filter((a) => req.sha256s.includes(a.sha256)),
        thicknessFor: thicknessOf,
        gradingUnitMm: o.gradingUnitMm!,
        fileNames
      }
    )
    files.sort((x, y) => x.fileName.localeCompare(y.fileName, 'ko'))
    return { request: req, rowsKey: rowsKeyOf(comparison), comparison, files, testLocked: st.testLock.locked, testLockedAt: st.testLock.locked ? st.testLock.at : null }
  }

  function planFinal(req: ReviewFinalRequest): { preview: ReviewFinalPreview; comparison: ReviewComparison; lockedSpecimens: string[] } {
    const cmp = runCompare(req.compare)
    if (cmp.rowsKey !== req.rowsKey) throw new AppError('CONFLICT', '그사이 기록이 바뀌어 비교 결과가 달라졌습니다. 다시 비교한 뒤 결정을 확인하세요.')
    const adj = adjudicatorOf()
    const c = cmp.comparison
    const gv = cmp.request.a.guidelineVersion
    const isFinalKey = (k: ReviewSideKey): boolean => k.labelerId === adj.id && k.readingStage === 'final' && k.guidelineVersion === gv
    if (isFinalKey(cmp.request.a) || isFinalKey(cmp.request.b)) invalid('비교하는 세트가 만들 확정 세트와 같은 세트입니다(같은 라벨러·확정·지침서).')
    const finalKeys = cmp.request.sha256s.map((sha): LabelSetKey => ({ sha256: sha, labelerId: adj.id, guidelineVersion: gv, readingStage: 'final' }))
    const prevRecords = [...st.records.values()].filter((r) => finalKeys.some((k) => sameLabelSet(r, k)))
    const prevIntervals = [...st.reviews.values()].filter((x) => finalKeys.some((k) => sameLabelSet(x, k)))
    const specimens = new Set(cmp.files.map((f) => f.specimenId).filter((x): x is string => x !== null))
    const defects = defectsFor(specimens)
    const result = buildFinalSet({
      comparison: c,
      decisions: req.decisions,
      adjudicator: { labelerId: adj.id, qualification: adj.qualification, organization: adj.organization },
      guidelineVersion: gv,
      pcId: st.pcId,
      now: ctx.now(),
      ...(req.deferAs ? { deferAs: req.deferAs } : {}),
      ...(req.carryNonDefect ? { carryNonDefect: req.carryNonDefect } : {}),
      ...(req.reviews ? { reviews: req.reviews } : {}),
      ...(defects.length > 0 ? { design: { defects, ...(req.design ?? {}) } } : {}),
      ...(req.designAdditions?.length ? { designAdditions: req.designAdditions } : {}),
      previous: { records: prevRecords, reviewIntervals: prevIntervals }
    })
    if (defects.length === 0) result.warnings.push('이 시편들에 물리 결함(설계값)이 없어 설계값 대조를 하지 않았습니다.')
    const liveSha = new Set([...prevRecords, ...prevIntervals].filter((x) => !x.deleted).map((x) => x.sha256))
    const lockedTestFiles = cmp.testLocked ? cmp.files.filter((f) => f.split === 'test' && liveSha.has(f.sha256)).map((f) => f.sha256) : []
    const lockedSpecimens = [...new Set(cmp.files.filter((f) => lockedTestFiles.includes(f.sha256) && f.specimenId).map((f) => f.specimenId!))].sort()
    const blockers: string[] = []
    if (result.undecided.length > 0) blockers.push(`결정하지 않은 행이 ${result.undecided.length}개 있습니다.`)
    const bad = result.rows.filter((r) => r.status === 'invalid')
    if (bad.length > 0) blockers.push(`행에 맞지 않는 결정이 ${bad.length}개 있습니다: ${bad.map((r) => r.rowId).join(', ')}`)
    if (result.records.length + result.reviewIntervals.length + result.removed.records.length + result.removed.reviewIntervals.length === 0) {
      blockers.push('저장할 확정 기록·검토 구간이 없습니다.')
    }
    return {
      preview: {
        rowsKey: cmp.rowsKey,
        adjudicator: adj,
        adjudicatorIsLevel3: isLevel3Qualification(adj.qualification),
        adjudicatorIsReader: adj.id === cmp.request.a.labelerId || adj.id === cmp.request.b.labelerId,
        guidelineVersion: gv,
        result,
        previousRecords: prevRecords.filter((r) => !r.deleted).length,
        designDefects: defects.length,
        lockedTestFiles,
        canSave: blockers.length === 0,
        blockers
      },
      comparison: cmp,
      lockedSpecimens
    }
  }

  function saveFinal(req: ReviewFinalRequest, options: ReviewFinalSaveOptions = {}): ReviewFinalSaveResult {
    const plan = planFinal(req)
    const p = plan.preview
    if (!p.canSave) invalid(`확정 세트를 저장할 수 없습니다: ${p.blockers.join(' ')}`)
    const adj = p.adjudicator!
    guard(adj.id)
    if (!p.adjudicatorIsLevel3 && options.confirmNotLevel3 !== true) {
      throw new AppError('CONFLICT', `지금 라벨러 ${adj.name} (${adj.id}) 의 자격(${adj.qualification ?? '적지 않음'})이 Level III 가 아닙니다. 확정은 Level III 몫입니다 — 그래도 저장하려면 확인하세요.`)
    }
    const reason = (options.reason ?? '').trim()
    if (p.lockedTestFiles.length > 0 && (options.confirmLockedTest !== true || !reason)) {
      throw new AppError('CONFLICT', `시험 세트가 잠겨 있고 이 파일 ${p.lockedTestFiles.length}개에는 이미 확정 세트(시험 정답)가 있습니다. 바꾸려면 이유를 적고 한 번 더 확인하세요(분할 기록에 남습니다).`)
    }
    const r = p.result
    const counts = (): ReviewSaveCounts => ({ created: 0, updated: 0, unchanged: 0, removed: 0 })
    const recs = counts()
    const ivs = counts()
    for (const x of r.records) {
      const before = st.records.has(x.uuid)
      const out = saveVersioned(st.records, x.uuid, x as IndicationRecord, '지시 기록')
      if (!out.changed) recs.unchanged++
      else if (before) recs.updated++
      else recs.created++
    }
    for (const uuid of r.removed.records) {
      const old = st.records.get(uuid)
      if (old && !old.deleted) {
        saveVersioned(st.records, uuid, { ...old, deleted: true }, '지시 기록')
        recs.removed++
      }
    }
    for (const x of r.reviewIntervals) {
      const before = st.reviews.has(x.uuid)
      const out = saveVersioned(st.reviews, x.uuid, x, '검토 구간')
      if (!out.changed) ivs.unchanged++
      else if (before) ivs.updated++
      else ivs.created++
    }
    for (const uuid of r.removed.reviewIntervals) {
      const old = st.reviews.get(uuid)
      if (old && !old.deleted) {
        saveVersioned(st.reviews, uuid, { ...old, deleted: true }, '검토 구간')
        ivs.removed++
      }
    }
    const at = ctx.now()
    for (const sp of plan.lockedSpecimens) {
      st.splitLog.push({ at, pcId: st.pcId, labelerId: adj.id, action: 'locked-change', specimenId: sp, from: 'test', to: 'test', reason: `확정 세트(시험 정답)를 다시 저장 — ${reason}` })
    }
    return { savedAt: at, labelSets: r.labelSets, records: recs, reviewIntervals: ivs, regrouped: 0, lockedLog: plan.lockedSpecimens, warnings: r.warnings }
  }

  function reviewCsv(req: ReviewCsvRequest): { text: string; rows: number } {
    if (!req || !['comparison', 'design', 'report'].includes(req.kind)) invalid('CSV 종류가 올바르지 않습니다.')
    if (req.kind === 'design' && !req.final) invalid('설계값 대조 표는 Level III 결정(확정 미리보기)이 있어야 만듭니다.')
    const plan = req.final ? planFinal({ ...req.final, compare: req.compare }) : null
    const cmp = plan?.comparison ?? runCompare(req.compare)
    const c = cmp.comparison
    if (req.kind === 'comparison') return { text: comparisonRowsCsv(c), rows: c.rows.length }
    const design = plan?.preview.result.designCheck ?? null
    if (req.kind === 'design') {
      if (!design) return invalid('이 시편들에 물리 결함(설계값)이 없어 설계값 대조 표를 만들 수 없습니다.')
      return { text: designCheckCsv(design), rows: design.rows.length }
    }
    const h = req.header ?? {}
    const report = buildEvaluationReport({
      comparison: c,
      header: { ...h, testSetLockedAt: h.testSetLockedAt ?? cmp.testLockedAt, guidelineVersion: h.guidelineVersion ?? cmp.request.a.guidelineVersion },
      design,
      sensitivity: req.sensitivity !== false ? sensitivityGrid(c) : null
    })
    const text = evaluationReportCsv(report)
    return { text, rows: text.split(/\r?\n/).filter((x) => x.replace(/^\uFEFF/, '').trim() !== '').length }
  }

  function reviewSources(): ReviewSources {
    const adjudicator = st.labelerId ? (st.labelers.get(st.labelerId) ?? null) : null
    const base: ReviewSources = {
      blocked: null,
      adjudicator,
      adjudicatorIsLevel3: isLevel3Qualification(adjudicator?.qualification),
      testLocked: st.testLock.locked,
      testLockedAt: st.testLock.locked ? st.testLock.at : null,
      files: [],
      physicalDefects: 0
    }
    if (st.blindMode) return { ...base, blocked: REVIEW_BLIND }
    const bySha = new Map<string, ReviewSetInfo[]>()
    for (const s of setsOf()) {
      const l = st.labelers.get(s.labelerId)
      bySha.set(s.sha256, [
        ...(bySha.get(s.sha256) ?? []),
        {
          setId: s.setId,
          labelerId: s.labelerId,
          labelerName: l?.name ?? null,
          qualification: l?.qualification ?? null,
          readingStage: s.readingStage,
          guidelineVersion: s.guidelineVersion,
          recordCount: s.recordCount,
          defectCount: s.defectCount,
          reviewedLengthMm: s.reviewedLengthMm,
          pendingConflicts: s.pendingConflicts
        }
      ])
    }
    const files: ReviewSourceFile[] = [...bySha].map(([sha, sets]) => {
      const f = fileBySha(sha)
      const specimenId = specimenOfSha(sha)
      return { sha256: sha, fileId: f?.id ?? null, planId: f?.planId ?? null, fileName: f?.storedFileName ?? sha.slice(0, 12), specimenId, split: splitOfSpecimen(specimenId), sets }
    })
    files.sort((x, y) => x.fileName.localeCompare(y.fileName, 'ko'))
    const specimens = files.map((f) => f.specimenId).filter((x): x is string => x !== null)
    return { ...base, files, physicalDefects: defectsFor(specimens).length }
  }

  return {
    session: () => R(session),
    setSession: (patch) =>
      R(() => {
        if (patch.pcId !== undefined) {
          const pc = patch.pcId.normalize('NFC').trim()
          if (!PC_ID_PATTERN.test(pc)) invalid("PC ID 는 글자·숫자로 시작하고 글자·숫자·'.'·'_'·'-' 만 써서 32자까지 적습니다.")
          st.pcId = pc
        }
        if (patch.labelerId !== undefined) {
          if (patch.labelerId !== null && !st.labelers.has(patch.labelerId)) invalid(`등록되지 않은 라벨러입니다: ${patch.labelerId}`)
          st.labelerId = patch.labelerId
        }
        if (patch.blindMode !== undefined) st.blindMode = patch.blindMode
        return session()
      }),
    registerLabeler: (info, options) =>
      R(() => {
        const id = (info.id ?? '').normalize('NFC').trim()
        const name = (info.name ?? '').normalize('NFC').trim()
        if (!id) invalid('라벨러 ID 를 입력하세요.')
        if (id.length > 64) invalid('라벨러 ID 는 64자 이하로 입력하세요.')
        if (!name) invalid('라벨러 이름을 입력하세요.')
        const existing = st.labelers.get(id)
        if (existing) {
          if (!shown(id)) invalid('2인 독립 모드에서는 다른 라벨러의 정보를 고칠 수 없습니다.')
          if (options?.overwrite !== true) {
            throw new AppError('CONFLICT', `이미 있는 라벨러입니다: ${existing.name} (${existing.id}). 정보를 바꾸려면 '고치기'를 고르세요.`)
          }
        }
        const v: LabelerInfo = { id, name, qualification: info.qualification?.trim() || null, organization: info.organization?.trim() || null }
        st.labelers.set(id, v)
        return v
      }),
    overview: () =>
      R(() => {
        const sets = setsOf()
        const all = (() => {
          const save = st.blindMode
          st.blindMode = false
          const n = setsOf().length
          st.blindMode = save
          return n
        })()
        const conflicts = pendingConflicts()
        const planName = new Map(ctx.plans().map((p) => [p.id, p.name]))
        const files: LabelFileStatus[] = [...ctx.files()]
          .sort((a, b) => a.planId.localeCompare(b.planId) || a.storedFileName.localeCompare(b.storedFileName, 'ko'))
          .map((f) => ({
            sha256: f.meta.sha256,
            fileId: f.id,
            fileName: f.storedFileName,
            planId: f.planId,
            planName: planName.get(f.planId) ?? null,
            specimenId: f.specimenId,
            stateTag: f.stateTag,
            sets: sets.filter((s) => s.sha256 === f.meta.sha256),
            pendingConflicts: conflicts.filter((c) => c.sha256 === f.meta.sha256).length
          }))
        const local = new Set(files.map((f) => f.sha256))
        for (const sha of [...new Set(sets.map((s) => s.sha256))].filter((s) => !local.has(s)).sort()) {
          files.push({
            sha256: sha,
            fileId: null,
            fileName: st.alignments.get(sha)?.fileName || sha.slice(0, 12),
            planId: null,
            planName: null,
            specimenId: st.alignments.get(sha)?.specimenId ?? null,
            stateTag: null,
            sets: sets.filter((s) => s.sha256 === sha),
            pendingConflicts: conflicts.filter((c) => c.sha256 === sha).length
          })
        }
        return { session: session(), files, setCount: sets.length, hiddenSetCount: all - sets.length, pendingConflicts: conflicts.length }
      }),
    listSets: (q) => R(() => setsOf(shaOf(q))),
    listRecords: (q) =>
      R(() => {
        const sha = shaOf(q)
        return [...st.records.values()]
          .filter(
            (r) =>
              (!sha || r.sha256 === sha) &&
              (!q?.set || sameLabelSet(r, q.set)) &&
              (!q?.kind || r.kind === q.kind) &&
              (q?.includeDeleted || !r.deleted) &&
              shown(r.labelerId)
          )
          .sort((a, b) => a.sha256.localeCompare(b.sha256) || a.derived.scanStartMm - b.derived.scanStartMm || a.uuid.localeCompare(b.uuid))
      }),
    saveRecord: (record) =>
      R(() => {
        guard(record.labelerId)
        const before = st.records.get(record.uuid)
        guardSet(record)
        if (before) guardSet(before)
        if (before && !sameLabelSet(before, record)) invalid('기록의 파일·라벨러·지침서 버전·판독 단계는 바꿀 수 없습니다. 새 기록으로 만드세요.')
        const saved = saveVersioned(st.records, record.uuid, record, '지시 기록')
        const releasedReviews = saved.changed && releasesReviews(before, record) ? releaseOverlapping(before ? [before, saved.value] : [saved.value]) : []
        return { ...saved, warnings: [], releasedReviews }
      }),
    deleteRecord: (uuid) =>
      R(() => {
        const r = st.records.get(uuid)
        if (!r) throw new AppError('NOT_FOUND', '지시 기록을 찾을 수 없습니다.')
        guard(r.labelerId)
        guardSet(r)
        if (r.deleted) return { value: r, warnings: [], changed: false, releasedReviews: [] }
        const saved = saveVersioned(st.records, uuid, { ...r, deleted: true }, '지시 기록')
        // 실제 저장소(store.ts deleteLabelRecord)와 같게: 관측 행 지움 표시 + 겹치는 검토 완료 구간 풀기
        for (const [k, o] of [...st.observations]) if (o.recordUuid === uuid && !o.deleted) saveVersioned(st.observations, k, { ...o, deleted: true }, '관측 표')
        return { ...saved, warnings: [], releasedReviews: releaseOverlapping([saved.value]) }
      }),
    listObservations: (q) =>
      R(() => {
        const sha = shaOf(q)
        return [...st.observations.values()].filter((o) => {
          const r = st.records.get(o.recordUuid)
          return (!q?.recordUuids || q.recordUuids.includes(o.recordUuid)) && (!sha || r?.sha256 === sha) && (q?.includeDeleted || !o.deleted) && (!r || shown(r.labelerId))
        })
      }),
    saveObservation: (row) =>
      R(() => {
        const r = st.records.get(row.recordUuid)
        if (!r) throw new AppError('NOT_FOUND', '관측 표의 지시 기록을 찾을 수 없습니다.')
        guard(r.labelerId)
        guardSet(r)
        return { ...saveVersioned(st.observations, JSON.stringify([row.recordUuid, row.groupId, row.leg]), row, '관측 표'), warnings: [] }
      }),
    deleteObservation: (recordUuid, groupId, leg) =>
      R(() => {
        const key = JSON.stringify([recordUuid, groupId, leg])
        const o = st.observations.get(key)
        const r = st.records.get(recordUuid)
        if (!o || !r) throw new AppError('NOT_FOUND', '관측 표를 찾을 수 없습니다.')
        guard(r.labelerId)
        guardSet(r)
        if (o.deleted) return { value: o, warnings: [], changed: false }
        return { ...saveVersioned(st.observations, key, { ...o, deleted: true }, '관측 표'), warnings: [] }
      }),
    listReviews: (q) =>
      R(() => {
        const sha = shaOf(q)
        return [...st.reviews.values()].filter(
          (v) =>
            (!sha || v.sha256 === sha) &&
            (!q?.set || sameLabelSet(v, q.set)) &&
            (!q?.kind || v.kind === q.kind) &&
            (q?.includeDeleted || !v.deleted) &&
            (q?.includeReleased !== false || !v.released) &&
            shown(v.labelerId)
        )
      }),
    saveReview: (v) =>
      R(() => {
        guard(v.labelerId)
        guardSet(v)
        return { ...saveVersioned(st.reviews, v.uuid, v, '검토 구간'), warnings: [] }
      }),
    deleteReview: (uuid) =>
      R(() => {
        const v = st.reviews.get(uuid)
        if (!v) throw new AppError('NOT_FOUND', '검토 구간을 찾을 수 없습니다.')
        guard(v.labelerId)
        guardSet(v)
        if (v.deleted) return { value: v, warnings: [], changed: false }
        return { ...saveVersioned(st.reviews, uuid, { ...v, deleted: true }, '검토 구간'), warnings: [] }
      }),
    appendWorkEvent: (input) =>
      R(() => {
        const labelerId = input.labelerId ?? st.labelerId
        if (!labelerId) invalid('라벨러를 먼저 고르세요.')
        guard(labelerId!)
        const e = newWorkEvent({ ...input, uuid: input.uuid ?? randomUuid(), labelerId: labelerId!, pcId: input.pcId ?? st.pcId, at: input.at ?? ctx.now() })
        const old = st.events.get(e.uuid)
        if (old && !sameContent(old, e)) throw new AppError('CONFLICT', '같은 UUID 의 작업 이벤트가 이미 있습니다(작업 이벤트는 고칠 수 없음).')
        st.events.set(e.uuid, old ?? e)
        return old ?? e
      }),
    chooseWorkbook: () =>
      R(() => {
        const paths = ['D:/PAUT/라벨/기록양식_v1_kim.xlsx', 'D:/PAUT/라벨/기록양식_v1_kim_group.xlsx', 'D:/PAUT/라벨/기록양식_v1_kim_오류.xlsx']
        return paths[st.chooseCount++ % paths.length]!
      }),
    previewWorkbook: (path, options) =>
      R((): LabelWorkbookPreview => {
        const p = fakeParse(path, options?.groupChoices ?? {})
        st.previews.set(p.previewId, p)
        const { plan, changes } = planOf(p)
        const registered = st.labelers.get(p.reader.id) ?? null
        const errors = /error|오류/i.test(path)
          ? [
              "'지시' 시트 2행 E열 '스캔 시작 (mm)': 필수 칸이 비어 있습니다",
              "'지시' 시트 3행 C열 '기록 구분': 목록에 없는 값입니다 (받은 값: '결함임'. 고를 수 있는 값: 결함 / 형상 에코 / 형상 불완전)"
            ]
          : p.groupQuestions.map((q) => `${q.where[0]}: 이 파일에 '${q.label}' 그룹이 2개 있습니다 (Skew270(1), Skew270 (2)(7)). 미리보기에서 어느 그룹인지 고릅니다`)
        const shas = [...new Set([...p.records, ...p.reviews].map((x) => x.sha256))]
        return {
          previewId: p.previewId,
          path,
          fileName: path.split(/[\\/]/).pop() ?? path,
          createdAt: ctx.now(),
          ok: p.ok,
          reader: { ...p.reader, readerSource: 'expert', registered: registered !== null, differsFromRegistered: registered !== null && registered.name !== p.reader.name },
          form: { labelForm: 'v1', schemaVersion: '1', fingerprint: '17133d5a6a98', appFingerprint: '17133d5a6a98', blind: true, templateStage: 'blind' },
          sheets: [
            { sheet: 'reader', name: '판독자', rows: 1 },
            { sheet: 'file', name: '파일', rows: p.alignments.length },
            { sheet: 'indication', name: '지시', rows: p.records.length + (p.ok ? 0 : 2) },
            { sheet: 'review', name: '검토구간', rows: p.reviews.length },
            { sheet: 'physical', name: '물리결함', rows: 0 },
            { sheet: 'worktime', name: '작업시간', rows: 0 }
          ],
          files: shas.map((sha) => {
            const f = fileBySha(sha)
            return {
              sha256: sha,
              fileId: f?.id ?? null,
              fileName: f?.storedFileName ?? sha.slice(0, 12),
              planId: f?.planId ?? null,
              specimenId: f?.specimenId ?? null,
              records: p.records.filter((r) => r.sha256 === sha).length,
              reviews: p.reviews.filter((v) => v.sha256 === sha).length,
              events: 0,
              alignment: p.alignments.some((a) => a.sha256 === sha),
              matchedBy: 'name' as const,
              removes: 0
            }
          }),
          labelSets: shas.map((sha) => ({ sha256: sha, labelerId: p.reader.id, guidelineVersion: 'v1', readingStage: p.reader.readingStage })),
          plan,
          totals: totalsOf(plan),
          options: options ?? {},
          groupQuestions: p.groupQuestions,
          fileQuestions: [],
          questionErrors: /error|오류/i.test(path) ? 0 : p.groupQuestions.length,
          changes,
          errors,
          warnings: ["'지시' 시트 3행 O열 'Ref 대비 (dB, 앱 계산)': 앱이 계산하는 칸이라 적은 값(3.5)은 쓰지 않습니다"]
        }
      }),
    commitWorkbook: (previewId) =>
      R(() => {
        const p = st.previews.get(previewId)
        if (!p) throw new AppError('PREVIEW_EXPIRED', '미리보기가 만료되었습니다. 엑셀을 다시 고르세요.')
        if (!p.ok) invalid('엑셀에 오류가 있어 확정할 수 없습니다. 엑셀을 고친 뒤 다시 가져오세요.')
        const { plan, changes } = planOf(p)
        const registered = st.labelers.has(p.reader.id) ? null : p.reader.id
        if (registered) st.labelers.set(p.reader.id, { id: p.reader.id, name: p.reader.name, qualification: p.reader.qualification, organization: null })
        const put = <T extends { versions: VersionEntry[] }>(map: Map<string, T>, key: string, v: T): void => {
          const old = map.get(key)
          if (old && sameContent(old, v)) return
          map.set(key, old ? { ...v, versions: bumpVersions(old.versions, slot()) } : v)
        }
        p.records.forEach((r) => put(st.records, r.uuid, r))
        p.reviews.forEach((v) => put(st.reviews, v.uuid, v))
        p.alignments.forEach((a) => put(st.alignments, a.sha256, a))
        st.previews.delete(previewId)
        return {
          path: p.path,
          fileName: p.path.split(/[\\/]/).pop() ?? p.path,
          committedAt: ctx.now(),
          plan,
          totals: totalsOf(plan),
          registeredLabelerId: registered,
          labelSets: [...new Set(p.records.map((r) => r.sha256))].map((sha) => ({ sha256: sha, labelerId: p.reader.id, guidelineVersion: 'v1', readingStage: p.reader.readingStage })),
          conflictIds: [],
          pendingConflicts: pendingConflicts().length,
          changes,
          warnings: []
        }
      }),
    chooseExportPath: (req) =>
      R(() => {
        if (req.kind === 'files' && req.sha256s.length === 0) invalid('내보낼 파일을 고르세요.')
        const what = req.kind === 'all' ? '전체' : `파일${req.sha256s.length}개`
        const who = st.blindMode && st.labelerId ? `_${st.labelerId}` : ''
        return `D:/PAUT/라벨/라벨_${what}${who}_${stampName(ctx.now())}_${st.pcId}.json`
      }),
    exportJson: (req, path) =>
      R(() => {
        if (req.kind === 'files' && req.sha256s.length === 0) invalid('내보낼 파일을 고르세요.')
        if (st.blindMode && !st.labelerId) invalid('2인 독립 모드에서는 지금 라벨러의 라벨 세트만 내보냅니다. 내보낼 세트가 없습니다.')
        const file = exportFile(req)
        const json = `${JSON.stringify(file, null, 2)}\n`
        st.lastExport = json
        const fileName = path.split(/[\\/]/).pop() ?? path
        return {
          path,
          fileName,
          bytes: json.length,
          exportedAt: file.exportedAt,
          pcId: st.pcId,
          onlyLabelerId: st.blindMode ? st.labelerId : null,
          counts: {
            labelers: file.labelers.length,
            physicalDefects: file.physicalDefects.length,
            fileAlignments: file.fileAlignments.length,
            records: file.records.length,
            observations: file.observations.length,
            reviewIntervals: file.reviewIntervals.length,
            workEvents: file.workEvents.length
          }
        }
      }),
    chooseJson: () => R(() => `D:/PAUT/라벨/라벨_전체_${stampName(ctx.now())}_pc-field2.json`),
    importJson: (path) =>
      R((): LabelJsonImportResult => {
        const file = JSON.parse(st.lastExport ?? JSON.stringify(exportFile({ kind: 'all' }))) as LabelExportFile
        const zero = (): LabelMergeCounts => ({ created: 0, updated: 0, unchanged: 0, conflicts: 0 })
        const byEntity = Object.fromEntries(['labeler', ...LABEL_ENTITY_KINDS].map((k) => [k, zero()])) as LabelJsonImportResult['byEntity']
        const conflictItems: LabelJsonImportResult['conflictItems'] = []
        for (const l of file.labelers) {
          if (st.labelers.has(l.id)) byEntity.labeler.unchanged++
          else {
            st.labelers.set(l.id, l)
            byEntity.labeler.created++
          }
        }
        const merge = (entity: LabelEntityKind, items: LabelEntityValue[]): void => {
          const map = entityMap(entity)
          for (const x of items) {
            const key = keyOf(entity, x)
            const mine = map.get(key)
            if (!mine) {
              map.set(key, x)
              byEntity[entity].created++
              continue
            }
            const order = entity === 'work-event' ? 'same' : compareVersions((x as { versions: VersionEntry[] }).versions, (mine as { versions: VersionEntry[] }).versions)
            if (order === 'a-newer') {
              map.set(key, x)
              byEntity[entity].updated++
            } else if (order === 'b-newer' || sameContent(mine, x)) byEntity[entity].unchanged++
            else {
              const id = Math.max(0, ...st.conflicts.keys()) + 1
              st.conflicts.set(id, {
                id,
                entity,
                key,
                sha256: (x as { sha256?: string | null }).sha256 ?? null,
                labelerId: (x as { labelerId?: string }).labelerId ?? null,
                mineAtDetection: mine,
                theirs: x,
                sourcePcId: file.pcId,
                sourceName: null,
                sourceExportedAt: file.exportedAt,
                detectedAt: ctx.now(),
                resolvedAt: null,
                resolution: null,
                resolvedNewKey: null
              })
              byEntity[entity].conflicts++
              conflictItems.push({ entity, key, conflictId: id })
            }
          }
        }
        merge('physical-defect', file.physicalDefects)
        merge('file-alignment', file.fileAlignments)
        merge('record', file.records)
        merge('observation', file.observations)
        merge('review-interval', file.reviewIntervals)
        merge('work-event', file.workEvents)
        const sum = (k: keyof LabelMergeCounts): number => Object.values(byEntity).reduce((s, c) => s + c[k], 0)
        const p = path
        return {
          path: p,
          fileName: p.split(/[\\/]/).pop() ?? p,
          ok: true,
          created: sum('created'),
          updated: sum('updated'),
          unchanged: sum('unchanged'),
          conflicts: sum('conflicts'),
          autoMerged: 0,
          byEntity,
          conflictItems,
          errors: [],
          warnings: [],
          pendingConflicts: pendingConflicts().length,
          source: { pcId: file.pcId, appVersion: file.appVersion, exportedAt: file.exportedAt, schemaVersion: file.schemaVersion, rulesVersion: file.rulesVersion }
        }
      }),
    listConflicts: (q) =>
      R(() => {
        const sha = shaOf(q)
        const list = q?.pendingOnly === false ? [...st.conflicts.values()].filter((c) => !sha || c.sha256 === sha) : pendingConflicts(sha)
        return list.sort((a, b) => a.id - b.id).map(conflictInfo)
      }),
    resolveConflict: (id, choice) =>
      R(() => {
        const c = st.conflicts.get(id)
        if (!c) throw new AppError('NOT_FOUND', '충돌을 찾을 수 없습니다.')
        if (c.resolvedAt) throw new AppError('CONFLICT', '이미 해결된 충돌입니다.')
        if (!LABEL_CONFLICT_CHOICES[c.entity].includes(choice)) invalid('이 저장 단위에는 고를 수 없는 해결 방법입니다.')
        if (c.labelerId && !shown(c.labelerId)) invalid('2인 독립 모드에서는 지금 라벨러의 충돌만 풀 수 있습니다.')
        const map = entityMap(c.entity)
        const mine = map.get(c.key)
        if (!mine) throw new AppError('NOT_FOUND', '충돌한 항목을 찾을 수 없습니다.')
        const vOf = (v: LabelEntityValue): VersionEntry[] => (v as { versions?: VersionEntry[] }).versions ?? []
        const versions = bumpVersions(mergeVersions(vOf(mine), vOf(c.theirs)), slot())
        const stampV = (v: LabelEntityValue, vs: VersionEntry[]): LabelEntityValue =>
          c.entity === 'work-event' ? v : ({ ...v, versions: vs, revision: versionTotal(vs), pcId: st.pcId } as LabelEntityValue)
        let newKey: string | null = null
        if (choice === 'both') {
          newKey = randomUuid()
          map.set(newKey, stampV({ ...(c.theirs as IndicationRecord), uuid: newKey } as LabelEntityValue, bumpVersions([], slot())))
        }
        map.set(c.key, stampV(choice === 'theirs' ? c.theirs : mine, versions))
        Object.assign(c, { resolvedAt: ctx.now(), resolution: choice, resolvedNewKey: newKey })
        return { conflict: conflictInfo(c), newKey, pendingConflicts: pendingConflicts().length }
      }),

    // ── 학습 데이터 분할 · 내보내기 ──
    trainingSplits: () => R(splitView),
    setTrainingSplits: (changes: TrainingSplitChange[], options?: TrainingSplitOptions) =>
      R(() => {
        if (!Array.isArray(changes)) invalid('분할 변경 목록이 올바르지 않습니다.')
        const plan = changes
          .map((c) => {
            const id = (c.specimenId ?? '').normalize('NFC').trim()
            if (!id) invalid('시편 ID 가 비어 있습니다.')
            if (c.split !== null && !['train', 'val', 'test'].includes(c.split)) invalid(`분할 값이 올바르지 않습니다: ${String(c.split)}`)
            const old = st.splits.get(splitKeyOf(id))
            return { id: old?.specimenId ?? id, key: splitKeyOf(id), from: old?.split ?? null, to: c.split }
          })
          .filter((p) => p.from !== p.to)
        const touchesTest = plan.some((p) => p.from === 'test' || p.to === 'test')
        const reason = st.testLock.locked && touchesTest ? lockedReasonOf(options) : null
        const at = ctx.now()
        for (const p of plan) {
          if (p.to === null) st.splits.delete(p.key)
          else st.splits.set(p.key, { specimenId: p.id, split: p.to, at })
          const locked = st.testLock.locked && (p.from === 'test' || p.to === 'test')
          st.splitLog.push({ at, pcId: st.pcId, labelerId: st.labelerId, action: locked ? 'locked-change' : 'assign', specimenId: p.id, from: p.from, to: p.to, reason: locked ? reason : null })
        }
        return splitView()
      }),
    lockTrainingTest: (lock: boolean, options?: TrainingSplitOptions) =>
      R(() => {
        if (st.testLock.locked === lock) return splitView()
        const reason = lock ? (options?.reason?.trim() || null) : lockedReasonOf(options)
        const at = ctx.now()
        st.testLock = lock ? { locked: true, at, by: st.labelerId ?? st.pcId } : { locked: false, at: null, by: null }
        st.splitLog.push({ at, pcId: st.pcId, labelerId: st.labelerId, action: lock ? 'lock' : 'unlock', specimenId: null, from: null, to: null, reason })
        return splitView()
      }),
    trainingCandidates: (rule: TrainingSetRule) => R(() => ({ files: candidates(rule), blindModeLabelerId: st.blindMode ? st.labelerId : null })),
    chooseTrainingDir: () => R(() => 'D:/PAUT/학습데이터'),
    exportTraining: (request: TrainingExportRequest, dir: string) => fakeTrainingExport(request, dir),
    trainingStatus: () => R(() => (st.training ? { ...st.training.progress, cancelling: st.training.cancel } : null)),
    cancelTraining: (operationId: string) =>
      R(() => {
        if (!st.training || st.training.operationId !== operationId || st.training.cancel) return false
        st.training.cancel = true
        return true
      }),

    // ── 3단계 검수 ──
    reviewSources: () => R(reviewSources),
    compareSets: (request: ReviewCompareRequest) => R(() => runCompare(request)),
    previewFinal: (request: ReviewFinalRequest) =>
      R(() => {
        blockBlind()
        return planFinal(request).preview
      }),
    saveFinal: (request: ReviewFinalRequest, options?: ReviewFinalSaveOptions) =>
      R(() => {
        blockBlind()
        return saveFinal(request, options ?? {})
      }),
    chooseReviewCsvPath: (request: ReviewCsvRequest) =>
      R(() => {
        blockBlind()
        if (request.kind === 'design' && !request.final) invalid('설계값 대조 표는 Level III 결정(확정 미리보기)이 있어야 만듭니다.')
        const kind = { comparison: '쌍판정표', design: '설계값대조', report: '평가보고서' }[request.kind]
        return `D:/PAUT/라벨/검수_${kind}_${request.compare.a.labelerId}-vs-${request.compare.b.labelerId}_${stampName(ctx.now())}_${st.pcId}.csv`
      }),
    saveReviewCsv: (request: ReviewCsvRequest, path: string) =>
      R(() => {
        blockBlind()
        if (!path) invalid('저장할 경로가 올바르지 않습니다.')
        const { text, rows } = reviewCsv(request)
        return { path, fileName: path.split(/[\\/]/).pop() ?? path, bytes: new TextEncoder().encode(text).length, rows }
      }),
    submitSet: (set, submit, options) =>
      R(() => {
        if (set.readingStage === 'final') invalid('확정 세트는 제출하지 않습니다 (검수 화면에서만 만듦).')
        guard(set.labelerId)
        if (st.labelerId !== set.labelerId) invalid('지금 라벨러의 세트만 제출하거나 풀 수 있습니다.')
        const id = labelSetId(set)
        if (submit) {
          if (!st.submitted.has(id)) st.submitted.set(id, ctx.now())
        } else if (st.submitted.has(id)) {
          if (!options?.reason?.trim()) throw new AppError('CONFLICT', '제출을 풀려면 이유를 적으세요 (블라인드 기준선을 다시 고치게 됩니다 — 기록에 남습니다).')
          st.submitted.delete(id)
        }
        return { setId: id, submittedAt: st.submitted.get(id) ?? null }
      }),
    startReconcile: (from) =>
      R(() => {
        if (from.readingStage !== 'blind') invalid('설계값 대조는 블라인드 세트에서 시작합니다.')
        guard(from.labelerId)
        if (st.labelerId !== from.labelerId) invalid('지금 라벨러의 블라인드 세트만 대조를 시작할 수 있습니다.')
        const to: LabelSetKey = { ...from, readingStage: 'reconciled' }
        const live = [...st.records.values()].some((r) => sameLabelSet(r, to) && !r.deleted) || [...st.reviews.values()].some((v) => sameLabelSet(v, to) && !v.deleted)
        if (live) throw new AppError('CONFLICT', '이 파일에 이미 설계값 대조 세트가 있습니다. 그 세트를 고르면 이어서 대조합니다.')
        const recs = [...st.records.values()].filter((r) => sameLabelSet(r, from) && !r.deleted)
        const revs = [...st.reviews.values()].filter((v) => sameLabelSet(v, from) && !v.deleted)
        const map = new Map<string, string>()
        for (const r of recs) {
          const uuid = randomUuid()
          map.set(r.uuid, uuid)
          saveVersioned(st.records, uuid, { ...structuredClone(r), uuid, readingStage: 'reconciled', versions: [], revision: 1, groupingId: null, knowledge: { ...r.knowledge, designValueSeen: true } }, '지시 기록')
        }
        for (const v of revs) {
          const uuid = randomUuid()
          saveVersioned(st.reviews, uuid, { ...structuredClone(v), uuid, readingStage: 'reconciled', versions: [], revision: 1 }, '검토 구간')
        }
        let obs = 0
        for (const o of [...st.observations.values()]) {
          const ru = map.get(o.recordUuid)
          if (!ru || o.deleted || !o.expertConfirmed) continue
          saveVersioned(st.observations, JSON.stringify([ru, o.groupId, o.leg]), { ...structuredClone(o), recordUuid: ru, versions: [], revision: 1 }, '관측 표')
          obs++
        }
        const srcId = labelSetId(from)
        const submittedSource = !st.submitted.has(srcId)
        if (submittedSource) st.submitted.set(srcId, ctx.now())
        st.copiedFrom.set(labelSetId(to), srcId)
        return { set: to, setId: labelSetId(to), records: recs.length, reviewIntervals: revs.length, observations: obs, submittedSource }
      }),
    physicalDefects: (q) =>
      R(() => {
        if (st.blindMode) invalid('2인 독립 모드에서는 설계값(물리 결함)을 보이지 않습니다.')
        const sp = specimenOfSha(String(q.sha256 ?? '').toLowerCase())
        return sp ? defectsFor([sp]) : []
      })
  }
}
