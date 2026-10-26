/**
 * 라벨 서비스 — IPC 'labels:*' 의 Electron 비의존 부분 (core/service/index.ts 가 만들어 AppService.labels 로 둔다).
 *
 * - 저장소는 catalog.labels(core/catalog/labels.ts), 규칙은 core/labels(저장·JSON 합치기·충돌 해결), 엑셀 읽기는 core/labels/xlsx.
 * - 이 PC 의 ID 는 설정의 pcId. 없으면 처음 부를 때 만든다(core/settings ensurePcId).
 * - 지금 라벨러·2인 독립 모드도 설정에 둔다. 2인 모드면 지금 라벨러 세트만 보이고 다른 라벨러 기록은 고칠 수 없다.
 *   기록·구간·작업 이벤트를 쓰는 라벨러는 등록돼 있어야 한다(내보낸 파일에 라벨러 정보가 함께 가도록).
 * - 가져오기(NDE) 작업 잠금(BUSY)과 무관하게 동작한다. 카탈로그 쓰기는 동기 트랜잭션이라 섞이지 않는다.
 *   다만 라벨 작업 중에는 저장소를 바꿀 수 없고(busy), 저장소를 바꾸는 중에는 라벨 작업을 받지 않는다(BUSY).
 * - 엑셀은 미리보기(읽기·맞추기·세기) → 확정(저장) 두 단계. 미리보기는 메모리에 잠깐 보관한다(previewId).
 *   파일 이름은 카탈로그의 원본 파일명·장비 원본 파일명·저장 파일명으로 찾고, 그룹(기법·스큐·이득)은
 *   엑셀이 가리킨 파일만 이미지 보기와 같은 readViewerInfo 캐시로 읽는다. 확정 규칙은 labelWorkbook.ts.
 * - 버전 벡터 칸 = 'PC ID:복제본 ID' (catalog.labels.replica). 이 PC 가 마지막으로 본 저장소의 라벨 쓰기 횟수를
 *   userData/label-replicas.json 에 적어 두고, 저장소의 횟수가 그보다 작으면(백업에서 되돌림·복사) 새 칸으로 바꾼다.
 * - 2인 독립 모드는 실수 막기용이다(보안 장치가 아님): 목록·쓰기·충돌 해결·라벨러 정보 고치기를 지금 라벨러로 막고,
 *   JSON 내보내기도 지금 라벨러의 세트만 담는다. 파일을 직접 열거나 라벨러를 바꾸면 다른 기록을 볼 수 있다.
 * - 학습 데이터(2b, core/labels/export): 분할(시편 단위 train·val·test, 시험 세트 잠금)은 이 저장소 catalog.db 의 label_meta 한 칸.
 *   내보내기는 한 번에 하나. 진행률은 trainingStatus()(렌더러가 짧게 되묻는다), 취소는 cancelTraining(operationId).
 *   출력은 main 대화상자로 고른 폴더 안에 새 폴더를 만들어 쓴다(덮어쓰지 않음). 2인 모드면 지금 라벨러 세트만 고른다.
 * - 3단계 검수(labelReview.ts): 두 세트 비교 → Level III 결정·설계값 대조 미리보기 → 확정 세트 저장(한 트랜잭션, 라벨러 = 지금 라벨러)
 *   → CSV(쌍 판정 표·설계값 대조·평가 보고서). 2인 독립 모드에서는 모두 막는다(검수는 Level III 몫).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  localIso,
  sameLabelContent,
  type Catalog,
  type LabelConflict,
  type LabelSetSummary
} from '@core/catalog'
import {
  deleteLabelRecord,
  exportLabels,
  importLabels,
  resolveLabelConflict,
  saveLabelRecord,
  type LabelExportScope
} from '@core/labels'
import type { LabelWriteContext } from '@core/catalog'
import {
  applySplitChanges,
  applyTestLock,
  cleanSetRule,
  cleanTrainingOptions,
  pickLabelSet,
  readSetLockState,
  readSplitState,
  runTrainingExport,
  setCopiedFrom,
  setSubmittedAt,
  writeSetLockState,
  splitKey,
  splitOf,
  writeSplitState,
  type SplitState,
  type TrainingSourceFile
} from '@core/labels/export'
import { initNde } from '@core/nde'
import { readStoredViewerChunk, readStoredViewerInfo } from '@core/opd/viewer'
import { toAbsolutePath } from '@core/storage'
import {
  makeFileFinder,
  parseLabelWorkbook,
  readXlsx,
  type FileFinderEntry,
  type LabelWorkbookFile,
  type LabelWorkbookGroup,
  type LabelWorkbookImport
} from '@core/labels/xlsx'
import {
  LABEL_CONFLICT_CHOICES,
  type LabelConflictChoice,
  type LabelConflictInfo,
  type LabelConflictListQuery,
  type LabelConflictResolveResult,
  type LabelEntityKind,
  type LabelEntityValue,
  type LabelExportRequest,
  type LabelExportResult,
  type LabelFileStatus,
  type LabelJsonImportResult,
  type LabelObservationListQuery,
  type LabelOverview,
  type LabelRecordListQuery,
  type LabelRecordSaveOutcome,
  type LabelReviewListQuery,
  type LabelSaveOutcome,
  type LabelSession,
  type LabelSessionPatch,
  type LabelReconcileResult,
  type LabelSetInfo,
  type LabelSetSubmitOptions,
  type LabelSetSubmitResult,
  type LabelWorkbookCommitResult,
  type LabelWorkbookFileMatch,
  type LabelWorkbookOptions,
  type LabelWorkbookPreview,
  type LabelWorkbookSheetCount,
  type LabelerRegisterOptions,
  type ReviewCompareRequest,
  type ReviewComparison,
  type ReviewCsvRequest,
  type ReviewCsvResult,
  type ReviewFinalPreview,
  type ReviewFinalRequest,
  type ReviewFinalSaveOptions,
  type ReviewFinalSaveResult,
  type ReviewSources,
  type TrainSplitOrNone,
  type TrainingCandidates,
  type TrainingExportProgress,
  type TrainingExportRequest,
  type TrainingExportResult,
  type TrainingSetChoice,
  type TrainingSetRule,
  type TrainingSplitChange,
  type TrainingSplitOptions,
  type TrainingSplitSpecimen,
  type TrainingSplitView,
  type WorkEventInput
} from '@shared/api'
import { AppError } from '@shared/errors'
import type { ViewerFileInfo } from '@shared/imaging/types'
import { LABEL_SHEETS } from '@shared/labels/columns'
import { newWorkEvent } from '@shared/labels/factory'
import { labelSetId } from '@shared/labels/factory'
import type { IndicationRecord, LabelSetKey, LabelerInfo, ObservationRow, PhysicalDefect, RecordKind, ReviewInterval, WorkEvent } from '@shared/labels/types'
import { hasAdjudication } from '@shared/labels/review'
import { serializeLabelExport } from '@shared/labels/validate'
import type { AppSettings, FileId, FileRecord } from '@shared/types'
import { cleanPcId, ensurePcId, loadReplicaMarks, loadSettings, markReplicaWrites, updateSettings } from '../settings'
import { assertExportTarget, type ExportTargetRules } from './exportTarget'
import { invalid, isObj } from './guards'
import { applyWorkbook, type WorkbookApplyResult } from './labelWorkbook'
import {
  REVIEW_BLIND_REASON,
  cleanCompareRequest,
  cleanCsvRequest,
  cleanFinalRequest,
  planFinal,
  reviewCsvFileName,
  reviewCsvText,
  reviewSourcesOf,
  runCompare,
  safeName,
  saveFinal as saveFinalSet
} from './labelReview'

export interface LabelServiceDeps {
  settingsPath: string
  now?: () => Date
  /** 미리보기 보관 시간 (기본 6시간) */
  previewTtlMs?: number
  /** 지금 저장소 (없으면 NO_STORE_ROOT 등을 던짐) */
  current(): Promise<{ root: string; catalog: Catalog }>
  /** 저장된 사본의 이미지 보기 메타 (이미지 보기와 같은 캐시). 사본이 없으면 던짐 */
  viewerInfoOf(file: FileRecord): Promise<ViewerFileInfo>
  /** 저장소를 바꾸는 중이면 true */
  switching(): boolean
}

export interface LabelService {
  session(): Promise<LabelSession>
  setSession(patch: LabelSessionPatch): Promise<LabelSession>
  /** 이미 있는 ID 는 overwrite 일 때만 고친다(아니면 CONFLICT). 2인 모드에서는 다른 라벨러 정보를 고칠 수 없다 */
  registerLabeler(info: LabelerInfo, options?: LabelerRegisterOptions): Promise<LabelerInfo>
  overview(): Promise<LabelOverview>
  listSets(query?: { fileId?: FileId; sha256?: string }): Promise<LabelSetInfo[]>
  listRecords(query?: LabelRecordListQuery): Promise<IndicationRecord[]>
  saveRecord(record: IndicationRecord): Promise<LabelRecordSaveOutcome>
  deleteRecord(uuid: string): Promise<LabelRecordSaveOutcome>
  listObservations(query?: LabelObservationListQuery): Promise<ObservationRow[]>
  saveObservation(row: ObservationRow): Promise<LabelSaveOutcome<ObservationRow>>
  deleteObservation(recordUuid: string, groupId: number, leg: number): Promise<LabelSaveOutcome<ObservationRow>>
  listReviews(query?: LabelReviewListQuery): Promise<ReviewInterval[]>
  saveReview(v: ReviewInterval): Promise<LabelSaveOutcome<ReviewInterval>>
  deleteReview(uuid: string): Promise<LabelSaveOutcome<ReviewInterval>>
  appendWorkEvent(input: WorkEventInput): Promise<WorkEvent>
  /** 엑셀 읽기 → 미리보기 (저장하지 않음) */
  previewWorkbook(path: string, options?: LabelWorkbookOptions): Promise<LabelWorkbookPreview>
  commitWorkbook(previewId: string): Promise<LabelWorkbookCommitResult>
  /** 저장 대화상자 기본 이름: '라벨_전체_20261006-1530_pc-1a2b3c4d.json' */
  exportFileName(request: LabelExportRequest): Promise<string>
  exportJsonFile(request: LabelExportRequest, path: string, appVersion: string): Promise<LabelExportResult>
  importJsonFile(path: string): Promise<LabelJsonImportResult>
  listConflicts(query?: LabelConflictListQuery): Promise<LabelConflictInfo[]>
  resolveConflict(id: number, choice: LabelConflictChoice): Promise<LabelConflictResolveResult>
  /** 학습 데이터 분할 (시편별 train·val·test, 시험 세트 잠금, 바꾼 기록) */
  trainingSplits(): Promise<TrainingSplitView>
  /** 분할 바꾸기. 잠긴 시험 세트를 건드리면 confirmLocked + reason (없으면 CONFLICT) */
  setTrainingSplits(changes: TrainingSplitChange[], options?: TrainingSplitOptions): Promise<TrainingSplitView>
  /** 시험 세트 잠그기·풀기 (풀 때 confirmLocked + reason) */
  lockTrainingTest(lock: boolean, options?: TrainingSplitOptions): Promise<TrainingSplitView>
  /** 파일마다 세트 고르기 미리보기 (라벨 세트가 있는 파일만) */
  trainingCandidates(rule: TrainingSetRule): Promise<TrainingCandidates>
  /** parentDir 안에 새 폴더를 만들어 학습 데이터를 쓴다 (한 번에 하나, 진행률 trainingStatus, 취소 cancelTraining) */
  exportTraining(request: TrainingExportRequest, parentDir: string, appVersion: string): Promise<TrainingExportResult>
  trainingStatus(): TrainingExportProgress | null
  cancelTraining(operationId: string): boolean
  /** 검수 탭 목록 (라벨 세트가 있는 파일·세트·분할, 지금 라벨러). 2인 모드면 blocked 에 이유, 목록은 비움 */
  reviewSources(): Promise<ReviewSources>
  /** 두 세트 비교 (2인 모드면 INVALID_ARGUMENT) */
  compareSets(request: ReviewCompareRequest): Promise<ReviewComparison>
  /** Level III 결정 → 확정 세트·설계값 대조 미리보기 (저장하지 않음) */
  previewFinal(request: ReviewFinalRequest): Promise<ReviewFinalPreview>
  /** 확정 세트 저장 (판독 단계 final, 라벨러 = 지금 라벨러, 한 트랜잭션) */
  saveFinal(request: ReviewFinalRequest, options?: ReviewFinalSaveOptions): Promise<ReviewFinalSaveResult>
  /** CSV 저장 대화상자 기본 이름 */
  reviewCsvFileName(request: ReviewCsvRequest): Promise<string>
  /** CSV 쓰기 (내용은 저장소에서 다시 계산) */
  saveReviewCsv(request: ReviewCsvRequest, path: string): Promise<ReviewCsvResult>
  /** 라벨 세트 제출(잠금)·풀기 (풀 때 이유 필요). 지금 라벨러 세트만, 확정 세트는 받지 않음 */
  submitSet(set: LabelSetKey, submit: boolean, options?: LabelSetSubmitOptions): Promise<LabelSetSubmitResult>
  /** 블라인드 세트 → 설계값 대조 세트 복사 + 블라인드 제출 (한 트랜잭션) */
  startReconcile(from: LabelSetKey): Promise<LabelReconcileResult>
  /** 그 파일 시편의 물리 결함 (설계값 대조 단계). 2인 독립 모드면 막음 */
  physicalDefects(query: { sha256: string }): Promise<PhysicalDefect[]>
  /** 진행 중인 라벨 작업이 있는지 (저장소 바꾸기를 막는다) */
  busy(): boolean
  /** 저장소를 닫을 때: 미리보기·그룹 캐시를 비운다 */
  clear(): void
}

/** 2인 모드에서 라벨러를 고르지 않았을 때 쓰는, 어떤 라벨러와도 같지 않은 값 */
const NO_LABELER = '\u0000'
const PREVIEW_TTL_MS = 6 * 60 * 60 * 1000
const MAX_PREVIEWS = 4
const MAX_WORKBOOK_BYTES = 64 * 1024 * 1024
/** JSON 가져오기 상한. V8 문자열 최대(약 512 MB)보다 한참 작게 — 큰 파일은 main 을 오래 멈추게도 한다 */
const MAX_JSON_BYTES = 128 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/

interface StoredPreview {
  previewId: string
  root: string
  pcId: string
  versionSlot: string
  path: string
  parsed: LabelWorkbookImport
  at: number
}

/** 쓰기 문맥 + 복제본 ID (쓴 뒤 쓰기 횟수를 적는다) */
type Writer = Required<LabelWriteContext> & { replicaId: string }

type ReadySettings = AppSettings & { pcId: string }

/** 'YYYYMMDD-HHmm' (로컬 시각) */
function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 엑셀 그룹 칸과 견줄 그룹 정보 (이미지 보기 메타에서) */
export function workbookGroupsOf(info: ViewerFileInfo): LabelWorkbookGroup[] {
  return info.groups.map((g) => {
    const skews = [...new Set(g.beams.map((b) => b.skewDeg))]
    return {
      id: g.id,
      name: g.name,
      technique: g.technique,
      skewDeg: skews.length === 1 ? skews[0]! : null,
      gainDb: g.gainDb,
      referenceGainDb: g.referenceGainDb,
      referenceAmplitudePct: g.referenceAmplitudePct
    }
  })
}

/** 저장소의 모든 파일 (1000개씩 나눠 읽음) */
function allFiles(catalog: Catalog): FileRecord[] {
  const out: FileRecord[] = []
  for (let offset = 0; ; ) {
    const page = catalog.listFiles({ offset, limit: 1000, sort: 'fileName-asc' })
    out.push(...page.items)
    offset += page.items.length
    if (page.items.length === 0 || offset >= page.total) break
  }
  return out
}

/** 엑셀 시트마다 머리글 아래 값이 있는 줄 수 */
function sheetCounts(data: Uint8Array): LabelWorkbookSheetCount[] {
  let wb: ReturnType<typeof readXlsx> | null = null
  try {
    wb = readXlsx(data)
  } catch {
    wb = null
  }
  return LABEL_SHEETS.map((s) => {
    const ws = wb?.sheet(s.name) ?? null
    return { sheet: s.id, name: s.name, rows: ws ? ws.rows.filter((r) => r.row > 1 && r.cells.size > 0).length : null }
  })
}

function kindCounts(records: readonly IndicationRecord[]): Map<string, Record<RecordKind, number>> {
  const m = new Map<string, Record<RecordKind, number>>()
  for (const r of records) {
    if (r.deleted) continue
    const id = `${r.sha256}|${r.labelerId}|${r.guidelineVersion}|${r.readingStage}`
    const c = m.get(id) ?? { defect: 0, 'geometric-echo': 0, 'geometric-imperfection': 0 }
    c[r.kind]++
    m.set(id, c)
  }
  return m
}

/** 위치 칸 (검토 완료 구간을 풀지 정할 때 비교) — 구분·파생 위치·앵커·길이 */
function positionOf(r: IndicationRecord): unknown {
  return {
    kind: r.kind,
    deleted: r.deleted,
    derived: { s: r.derived.scanStartMm, e: r.derived.scanEndMm, v0: r.derived.vMinMm, v1: r.derived.vMaxMm, d0: r.derived.depthTopMm, d1: r.derived.depthBottomMm },
    anchors: r.anchors.map((p) => ({ role: p.role, anchor: p.anchor, mm: p.mm })),
    length: { v: r.length.valueMm, g: r.length.groupId, b: r.length.beam }
  }
}

/**
 * 이 저장으로 겹치는 '검토 완료' 구간을 풀어야 하나: 위치·길이·구분이 바뀔 때만 (메모·속성·화면 스냅샷만 고친 것은 풀지 않음).
 * 새 기록: 결함이면 풀고(검토한 구간에 놓친 지시가 있었다는 뜻), 형상 에코·형상 불완전(앱 제안 승인 등)은 풀지 않는다.
 */
export function releasesReviews(before: IndicationRecord | null, after: IndicationRecord): boolean {
  if (!before || before.deleted) return after.kind === 'defect' && !after.deleted
  return !sameLabelContent(positionOf(before), positionOf(after))
}

/**
 * 앱 밖 경로(엑셀 다시 가져오기·충돌 해결)로도 바꾸지 않는 세트 — 앱 저장의 guardSet 과 같은 보호.
 *   submitted   제출(잠금)한 세트 (블라인드 기준선, 지침서 2.4·15절)
 *   adjudicated 검수 화면(saveFinal)에서 만든 확정 세트가 있는 파일의 확정 단계 세트 (확정 세트는 검수 화면에서만)
 *   test-locked 시험 세트가 잠긴 시험 파일의 확정 단계 세트 (시험 정답은 검수 화면에서 이유·확인과 함께만)
 */
export type FrozenSet = { kind: 'submitted'; at: string } | { kind: 'adjudicated' } | { kind: 'test-locked' }

/** 엑셀 미리보기 '그대로 둠' 줄의 이유 (kind 별) */
const FROZEN_WORKBOOK_REASON: Readonly<Record<FrozenSet['kind'], string>> = {
  submitted: '제출(잠금)한 세트라 엑셀 값으로 바꾸지 않음',
  adjudicated: '검수 화면에서 만든 확정 세트가 있는 파일이라 확정 단계 엑셀 줄을 넣지 않음',
  'test-locked': '시험 세트가 잠긴 시험 파일이라 확정 단계 엑셀 줄을 넣지 않음'
}

/** 엑셀 미리보기에 한 번 붙이는 안내 (kind 별) */
const FROZEN_WORKBOOK_HELP: Readonly<Record<FrozenSet['kind'], string>> = {
  submitted:
    "제출(잠금)한 블라인드 세트는 엑셀로도 고치지 않습니다(블라인드 기준선 보호). 설계값을 본 뒤 고칠 것은 '설계값 대조 시작' 사본에서 고치고, 꼭 고쳐야 하면 라벨 관리의 세트 줄에서 제출을 푸세요(이유 필요).",
  adjudicated: "확정 세트는 '라벨 관리 → 검수 → Level III 확정'에서만 만들고 고칩니다. 그 파일의 확정 단계 엑셀 줄은 넣지 않았습니다.",
  'test-locked':
    '시험 세트가 잠겨 있어 시험 파일의 확정 단계 엑셀 줄을 넣지 않았습니다. 시험 정답은 검수 화면에서 이유와 함께 바꾸거나, 분할 화면에서 잠금을 푼 뒤 가져오세요.'
}

/** 세트 보호 판정기 (요청 하나 안에서 쓰고 버린다 — 잠금·분할은 부를 때 한 번 읽음) */
export function frozenSetJudge(catalog: Catalog): (set: LabelSetKey) => FrozenSet | null {
  const locks = readSetLockState(catalog.dbPath)
  let split: SplitState | null = null
  const adjudicated = new Map<string, boolean>()
  return (set) => {
    const at = setSubmittedAt(locks, labelSetId(set))
    if (at) return { kind: 'submitted', at }
    if (set.readingStage !== 'final') return null
    let adj = adjudicated.get(set.sha256)
    if (adj === undefined) {
      adj = catalog.labels
        .listLabelSets({ sha256: set.sha256 })
        .some((x) => x.readingStage === 'final' && catalog.labels.listRecords({ set: x, includeDeleted: true }).some((r) => hasAdjudication(r)))
      adjudicated.set(set.sha256, adj)
    }
    if (adj) return { kind: 'adjudicated' }
    split ??= readSplitState(catalog.dbPath)
    if (split.testLock.locked) {
      const specimenId = catalog.findFileBySha256(set.sha256)?.specimenId ?? catalog.labels.getFileAlignment(set.sha256)?.specimenId ?? null
      if (splitOf(split, specimenId) === 'test') return { kind: 'test-locked' }
    }
    return null
  }
}

/** 충돌 해결('들어온 것'·'둘 다')을 막을 때의 글자 (kind 별) */
const FROZEN_CONFLICT_MESSAGE: Readonly<Record<FrozenSet['kind'], string>> = {
  submitted:
    "제출(잠금)한 세트라 '들어온 것'·'둘 다'로 바꾸지 않습니다(블라인드 기준선 보호). '내 것'을 고르거나, 꼭 바꿔야 하면 세트 줄에서 제출을 푼 뒤(이유 필요) 다시 고르세요.",
  adjudicated: "검수 확정 세트라 '들어온 것'·'둘 다'로 바꾸지 않습니다. '내 것'을 고르거나 검수 화면(Level III 확정)에서 다시 확정하세요.",
  'test-locked': "시험 세트가 잠긴 시험 파일의 확정 세트라 '들어온 것'·'둘 다'로 바꾸지 않습니다. '내 것'을 고르거나 검수 화면에서 이유와 함께 다시 확정하세요."
}

/** 충돌이 걸린 라벨 세트: 지시 기록·검토 구간은 그 값, 관측 행은 그 기록의 세트. 세트가 없는 것(정렬·물리 결함·작업 이벤트)은 null */
function conflictSetOf(catalog: Catalog, c: LabelConflict): LabelSetKey | null {
  if (c.entity === 'record' || c.entity === 'review-interval') {
    const v = (catalog.labels.getEntity(c.entity, c.key) ?? c.theirs) as LabelSetKey | null
    return v && typeof v.sha256 === 'string' ? { sha256: v.sha256, labelerId: v.labelerId, guidelineVersion: v.guidelineVersion, readingStage: v.readingStage } : null
  }
  if (c.entity === 'observation') {
    const o = c.theirs as ObservationRow | null
    const r = o && typeof o.recordUuid === 'string' ? catalog.labels.getRecord(o.recordUuid) : null
    return r ? { sha256: r.sha256, labelerId: r.labelerId, guidelineVersion: r.guidelineVersion, readingStage: r.readingStage } : null
  }
  return null
}

/** 미리보기 옵션 검사 (그룹·파일 답) */
function cleanWorkbookOptions(o: LabelWorkbookOptions | undefined): LabelWorkbookOptions {
  if (o === undefined || o === null) return {}
  if (!isObj(o)) invalid('가져오기 옵션이 올바르지 않습니다.')
  const out: LabelWorkbookOptions = {}
  if (o.groupChoices !== undefined) {
    if (!isObj(o.groupChoices) || Object.values(o.groupChoices).some((v) => !Number.isSafeInteger(v))) invalid('그룹 답이 올바르지 않습니다.')
    out.groupChoices = { ...(o.groupChoices as Record<string, number>) }
  }
  if (o.fileChoices !== undefined) {
    if (!isObj(o.fileChoices) || Object.values(o.fileChoices).some((v) => typeof v !== 'string' || !SHA256.test(v))) invalid('파일 답이 올바르지 않습니다.')
    out.fileChoices = { ...(o.fileChoices as Record<string, string>) }
  }
  return out
}

export function createLabelService(deps: LabelServiceDeps): LabelService {
  const now = (): Date => deps.now?.() ?? new Date()
  const previews = new Map<string, StoredPreview>()
  /** 'root|sha256' → 그룹·두께 (이미지 보기 메타에서 뽑은 작은 값). 저장소를 닫으면 비운다 */
  const groupCache = new Map<string, { groups: LabelWorkbookGroup[]; thicknessMm: number | null }>()
  /** 'DB 경로|복제본 ID' — 이번 실행에서 백업 복원 검사를 마친 복제본 */
  const replicaChecked = new Set<string>()
  /** 화면에 알릴 것 (저장소를 닫을 때 비움) */
  const notices: string[] = []
  let running = 0

  /** 라벨 작업 하나: 저장소를 바꾸는 중이면 받지 않고, 끝날 때까지 저장소 바꾸기를 막는다 */
  async function op<T>(fn: () => Promise<T>): Promise<T> {
    if (deps.switching()) throw new AppError('BUSY', '저장소를 바꾸는 중입니다. 잠시 뒤 다시 시도하세요.')
    running++
    try {
      return await fn()
    } finally {
      running--
    }
  }

  /** 설정 (pcId 가 없으면 만들어 저장 — 설정 쓰기는 core/settings 가 한 줄로 세운다) */
  async function settings(): Promise<ReadySettings> {
    const s = await loadSettings(deps.settingsPath)
    if (s.pcId) return s as ReadySettings
    const made = await ensurePcId(deps.settingsPath)
    if (!made.pcId) throw new AppError('IO_ERROR', 'PC ID 를 만들지 못했습니다(설정 파일에 쓰지 못함).')
    return made as ReadySettings
  }

  /**
   * 이 저장소에서 쓸 버전 칸. 처음 쓸 때 한 번, 이 PC 가 전에 본 쓰기 횟수보다 저장소의 횟수가 작으면
   * (백업에서 되돌렸거나 다른 곳에서 복사한 저장소) 새 복제본으로 바꾼다 — 같은 칸을 두 사본이 나눠 쓰지 않게.
   */
  async function writer(catalog: Catalog, s: ReadySettings): Promise<Writer> {
    let rep = catalog.labels.replica(s.pcId)
    const key = `${catalog.dbPath}|${rep.id}`
    if (!replicaChecked.has(key)) {
      const marks = await loadReplicaMarks(deps.settingsPath)
      const seen = marks[rep.id]
      if (seen !== undefined && rep.writes < seen) {
        rep = catalog.labels.rotateReplica(s.pcId)
        notices.push(
          `이 저장소의 라벨 쓰기 횟수(${catalog.labels.writeCount()})가 이 PC 가 전에 본 값(${seen})보다 작습니다. 백업에서 되돌렸거나 복사한 저장소로 보고, 다른 사본과 겹치지 않게 새 버전 칸(${rep.slot})으로 바꿨습니다.`
        )
      }
      replicaChecked.add(`${catalog.dbPath}|${rep.id}`)
    }
    return { pcId: s.pcId, versionSlot: rep.slot, replicaId: rep.id }
  }

  /** 쓴 뒤: 이 복제본의 쓰기 횟수를 적는다 (백업 복원 알아채기) */
  async function wrote(catalog: Catalog, w: Writer): Promise<void> {
    await markReplicaWrites(deps.settingsPath, w.replicaId, catalog.labels.writeCount()).catch(() => undefined)
  }

  const ctxOf = (w: Writer): LabelWriteContext => ({ pcId: w.pcId, versionSlot: w.versionSlot })

  /** 2인 모드면 보이는 라벨러, 아니면 null(모두 보임) */
  const visibleOf = (s: AppSettings): string | null => (s.labelBlindMode ? (s.labelerId ?? NO_LABELER) : null)

  function sessionOf(catalog: Catalog, s: ReadySettings, w: Writer): LabelSession {
    const labelers = catalog.labels.listLabelers()
    return {
      pcId: s.pcId,
      versionSlot: w.versionSlot,
      notices: [...notices],
      labelerId: s.labelerId,
      labeler: s.labelerId ? (labelers.find((l) => l.id === s.labelerId) ?? null) : null,
      blindMode: s.labelBlindMode,
      labelers
    }
  }

  /** 이 라벨러로 쓸 수 있는지: 등록돼 있고, 2인 모드면 지금 라벨러 */
  function guardWriter(catalog: Catalog, s: AppSettings, labelerId: unknown): void {
    if (typeof labelerId !== 'string' || labelerId.trim() === '') invalid('라벨러 ID 가 없습니다.')
    if (!catalog.labels.getLabeler(labelerId)) {
      invalid(`등록되지 않은 라벨러입니다: ${labelerId}. 라벨 관리에서 라벨러를 먼저 추가하세요.`)
    }
    const vis = visibleOf(s)
    if (vis !== null && vis !== labelerId) invalid('2인 독립 모드에서는 지금 라벨러의 기록만 고칠 수 있습니다.')
  }

  /**
   * 그 세트를 앱에서 고칠 수 있나: 확정(final) 세트는 검수 화면 saveFinal 로만(Level III 확인·잠긴 시험 세트 이유·출처),
   * 제출(잠금)한 세트는 고치지 않는다(블라인드 기준선 보호 — 지침서 2.4·15절).
   */
  function guardSet(catalog: Catalog, set: LabelSetKey): void {
    if (set.readingStage === 'final') {
      invalid("확정 세트는 '라벨 관리 → 검수 → Level III 확정'에서만 저장·지움 표시합니다 (Level III 확인·시험 세트 잠금·검수 출처를 함께 남기려고).")
    }
    const at = setSubmittedAt(readSetLockState(catalog.dbPath), labelSetId(set))
    if (at) {
      throw new AppError(
        'CONFLICT',
        `제출(잠금)한 세트입니다 (${at}). 블라인드 기준선을 지키려고 고치지 않습니다 — 설계값을 본 뒤에는 '설계값 대조 시작'으로 만든 사본에서 고치세요. 꼭 고쳐야 하면 세트 줄에서 제출을 푸세요(이유 필요).`
      )
    }
  }

  /** 엑셀 확정 규칙에 넘길 세트 보호 (미리보기 '그대로 둠' 이유 글자) */
  function workbookFrozen(catalog: Catalog): (set: LabelSetKey) => string | null {
    const judge = frozenSetJudge(catalog)
    return (set) => {
      const f = judge(set)
      return f ? FROZEN_WORKBOOK_REASON[f.kind] : null
    }
  }

  /** 세트 보호 때문에 그대로 둔 것이 있으면 그 안내 (kind 마다 한 줄) */
  function frozenHelp(hits: readonly string[]): string[] {
    return (Object.keys(FROZEN_WORKBOOK_REASON) as FrozenSet['kind'][]).filter((k) => hits.includes(FROZEN_WORKBOOK_REASON[k])).map((k) => FROZEN_WORKBOOK_HELP[k])
  }

  /** 2인 독립 모드면 지금 라벨러의 엑셀만 받는다 (패널 저장의 guardWriter 와 같은 막음) */
  function guardWorkbookReader(s: AppSettings, parsed: LabelWorkbookImport): void {
    const vis = visibleOf(s)
    if (vis === null) return
    const readers = new Set<string>()
    if (parsed.labeler) readers.add(parsed.labeler.id)
    for (const x of parsed.labelSets) readers.add(x.labelerId)
    const others = [...readers].filter((id) => id !== vis)
    if (others.length > 0) {
      invalid(
        `2인 독립 모드에서는 지금 라벨러(${s.labelerId ?? '고르지 않음'})의 엑셀만 가져옵니다. 이 엑셀의 판독자: ${others.join(', ')}. 지금 라벨러를 바꾸거나 2인 모드를 끈 뒤 가져오세요.`
      )
    }
  }

  /** 내보내기 쓰기 경로 규칙: 저장소 안·가져올 때의 원본 폴더·측정 원본이 바로 든 폴더 거절 (C-scan 내보내기와 같음) */
  function exportRules(root: string, catalog: Catalog): ExportTargetRules {
    const dirs = new Set<string>()
    for (const f of allFiles(catalog)) if (f.meta.sourcePath) dirs.add(dirname(f.meta.sourcePath))
    return { storeRoot: root, sourceDirs: dirs }
  }

  /** fileId 또는 sha256 → sha256 (둘 다 없으면 undefined = 전체) */
  function shaOf(catalog: Catalog, q: { fileId?: FileId; sha256?: string } | undefined): string | undefined {
    if (q?.fileId !== undefined && q.fileId !== null) {
      if (!Number.isSafeInteger(q.fileId)) invalid('파일 ID 값이 올바르지 않습니다.')
      const f = catalog.getFile(q.fileId)
      if (!f) throw new AppError('NOT_FOUND', `파일 #${q.fileId} 을(를) 찾을 수 없습니다.`)
      return f.meta.sha256
    }
    if (q?.sha256 !== undefined && q.sha256 !== null) {
      const sha = String(q.sha256).trim().toLowerCase()
      if (!SHA256.test(sha)) invalid('SHA-256 값이 올바르지 않습니다.')
      return sha
    }
    return undefined
  }

  function setInfos(catalog: Catalog, sets: readonly LabelSetSummary[], records: readonly IndicationRecord[]): LabelSetInfo[] {
    const kinds = kindCounts(records)
    const names = new Map(catalog.labels.listLabelers().map((l) => [l.id, l.name]))
    const locks = readSetLockState(catalog.dbPath)
    return sets.map((x) => {
      const k = kinds.get(x.setId) ?? { defect: 0, 'geometric-echo': 0, 'geometric-imperfection': 0 }
      return {
        ...x,
        echoCount: k['geometric-echo'],
        imperfectionCount: k['geometric-imperfection'],
        labelerName: names.get(x.labelerId) ?? null,
        submittedAt: setSubmittedAt(locks, x.setId),
        copiedFrom: setCopiedFrom(locks, x.setId)
      }
    })
  }

  function visibleConflicts(catalog: Catalog, vis: string | null, query: { pendingOnly?: boolean; sha256?: string } = {}): LabelConflict[] {
    const list = catalog.labels.listConflicts({
      pendingOnly: query.pendingOnly !== false,
      ...(query.sha256 !== undefined ? { sha256: query.sha256 } : {})
    })
    return vis === null ? list : list.filter((c) => c.labelerId === null || c.labelerId === vis)
  }

  function conflictInfo(catalog: Catalog, c: LabelConflict): LabelConflictInfo {
    const file = c.sha256 ? catalog.findFileBySha256(c.sha256) : null
    const fileName = file?.storedFileName ?? (c.sha256 ? (catalog.labels.getFileAlignment(c.sha256)?.fileName ?? null) : null)
    return {
      id: c.id,
      entity: c.entity as LabelEntityKind,
      key: c.key,
      sha256: c.sha256,
      labelerId: c.labelerId,
      fileId: file?.id ?? null,
      fileName,
      mine: catalog.labels.getEntity(c.entity, c.key) as LabelEntityValue | null,
      mineAtDetection: c.mineAtDetection as LabelEntityValue,
      theirs: c.theirs as LabelEntityValue,
      sourcePcId: c.sourcePcId,
      sourceName: c.sourceName,
      sourceExportedAt: c.sourceExportedAt,
      detectedAt: c.detectedAt,
      resolvedAt: c.resolvedAt,
      resolution: c.resolution,
      resolvedNewKey: c.resolvedNewKey,
      choices: [...LABEL_CONFLICT_CHOICES[c.entity as LabelEntityKind]]
    }
  }

  function prunePreviews(): void {
    const t = Date.now()
    const ttl = deps.previewTtlMs ?? PREVIEW_TTL_MS
    for (const [k, v] of previews) if (t - v.at > ttl) previews.delete(k)
    while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value as string)
  }

  /** 엑셀이 가리킨 파일의 그룹 (이미지 보기 캐시). 읽지 못하면 groupsError 에 이유 (그 파일의 '그룹' 칸 줄이 그 이유로 오류) */
  async function groupsFor(
    root: string,
    file: FileRecord
  ): Promise<{ groups: LabelWorkbookGroup[]; thicknessMm: number | null; groupsError: string | null }> {
    const key = `${root}|${file.meta.sha256}`
    const hit = groupCache.get(key)
    if (hit) return { ...hit, groupsError: null }
    try {
      const info = await deps.viewerInfoOf(file)
      const v = { groups: workbookGroupsOf(info), thicknessMm: info.specimen.thicknessMm }
      groupCache.set(key, v)
      return { ...v, groupsError: null }
    } catch (e) {
      return { groups: [], thicknessMm: null, groupsError: `저장된 사본을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /** 2인 모드에서 보이는 라벨 세트 (내보내기 범위) */
  function visibleSets(catalog: Catalog, vis: string, sha256s: readonly string[] | null): LabelSetKey[] {
    const all = catalog.labels.listLabelSets({ visibleLabelerId: vis, includeDeleted: true })
    const keep = sha256s ? new Set(sha256s) : null
    return all
      .filter((x) => !keep || keep.has(x.sha256))
      .map((x) => ({ sha256: x.sha256, labelerId: x.labelerId, guidelineVersion: x.guidelineVersion, readingStage: x.readingStage }))
  }

  async function readLimited(path: string, max: number, what: string): Promise<Buffer> {
    const st = await stat(path).catch(() => null)
    if (!st?.isFile()) throw new AppError('NOT_FOUND', `${what} 파일을 찾을 수 없습니다: ${path}`)
    if (st.size > max) invalid(`${what} 파일이 너무 큽니다 (${Math.round(st.size / 1024 / 1024)} MB).`)
    try {
      return await readFile(path)
    } catch (e) {
      throw new AppError('IO_ERROR', `${what} 파일을 읽지 못했습니다: ${path}`, e instanceof Error ? e.message : String(e))
    }
  }

  // ── 학습 데이터 (2b) ──

  /** 진행 중인 학습 데이터 내보내기 (한 번에 하나) */
  let training: { operationId: string; controller: AbortController; progress: TrainingExportProgress } | null = null

  /** 분할 화면: 저장소 파일을 시편으로 묶고 분할·결함 수를 붙인다 */
  function splitViewOf(catalog: Catalog, st: SplitState, vis: string | null): TrainingSplitView {
    const files = allFiles(catalog)
    const sets = catalog.labels.listLabelSets(vis === null ? {} : { visibleLabelerId: vis })
    const bestDefects = new Map<string, number>()
    for (const x of sets) bestDefects.set(x.sha256, Math.max(bestDefects.get(x.sha256) ?? 0, x.defectCount))
    const physical = new Map<string, number>()
    for (const d of catalog.labels.listPhysicalDefects()) physical.set(splitKey(d.specimenId), (physical.get(splitKey(d.specimenId)) ?? 0) + 1)
    const rows = new Map<string, TrainingSplitSpecimen>()
    const row = (specimenId: string): TrainingSplitSpecimen => {
      const key = splitKey(specimenId)
      let r = rows.get(key)
      if (!r) {
        const a = st.assignments[key]
        r = {
          specimenId,
          split: a?.split ?? null,
          fileCount: 0,
          labeledFileCount: 0,
          defectCount: 0,
          physicalDefectCount: physical.get(key) ?? 0,
          planIds: [],
          assignedAt: a?.at ?? null
        }
        rows.set(key, r)
      }
      return r
    }
    for (const f of files) {
      const r = row(f.specimenId)
      r.fileCount++
      if (!r.planIds.includes(f.planId)) r.planIds.push(f.planId)
      if (bestDefects.has(f.meta.sha256)) {
        r.labeledFileCount++
        r.defectCount += bestDefects.get(f.meta.sha256)!
      }
    }
    for (const a of Object.values(st.assignments)) row(a.specimenId)
    const specimens = [...rows.values()]
      .map((r) => ({ ...r, planIds: [...r.planIds].sort() }))
      .sort((a, b) => a.specimenId.localeCompare(b.specimenId, 'ko') || (a.specimenId < b.specimenId ? -1 : 1))
    const counts: Record<TrainSplitOrNone, number> = { train: 0, val: 0, test: 0, unassigned: 0 }
    for (const r of specimens) counts[r.split ?? 'unassigned']++
    return {
      unit: 'specimen',
      testLocked: st.testLock.locked,
      testLockedAt: st.testLock.at,
      testLockedBy: st.testLock.locked ? (st.testLock.labelerId ?? st.testLock.pcId) : null,
      specimens,
      counts,
      log: st.log.slice(-100).reverse()
    }
  }

  /** 파일마다 세트 고르기 (라벨 세트가 있는 파일만, 보이는 세트만) */
  function candidatesOf(catalog: Catalog, rule: TrainingSetRule, vis: string | null, st: SplitState): TrainingSetChoice[] {
    const sets = catalog.labels.listLabelSets(vis === null ? {} : { visibleLabelerId: vis })
    const bySha = new Map<string, LabelSetSummary[]>()
    for (const x of sets) bySha.set(x.sha256, [...(bySha.get(x.sha256) ?? []), x])
    const files = allFiles(catalog)
    const fileBySha = new Map(files.map((f) => [f.meta.sha256, f]))
    const out: TrainingSetChoice[] = []
    for (const [sha, all] of bySha) {
      const f = fileBySha.get(sha) ?? null
      const align = catalog.labels.getFileAlignment(sha)
      const specimenId = f?.specimenId ?? align?.specimenId ?? null
      // 검수 출처(adjudication)가 없는 확정 세트(엑셀·옛 앱에서 들어온 것)는 정답 1순위로 저절로 고르지 않는다 — 직접 고르면 쓴다
      const unproven = all.filter(
        (x) => x.readingStage === 'final' && !catalog.labels.listRecords({ set: x }).some((r) => hasAdjudication(r))
      )
      const list = all.filter((x) => !unproven.includes(x) || rule.overrides?.[sha] === x.setId)
      const pick = list.length > 0 ? pickLabelSet(sha, list, rule, splitOf(st, specimenId)) : { chosen: null, reason: '검수 출처가 없는 확정 세트뿐이라 고르지 않았습니다. 파일 줄에서 직접 고르세요.' }
      if (unproven.length > 0 && pick.chosen === null) pick.reason = `${pick.reason} (검수 출처가 없는 확정 세트 ${unproven.length}개는 직접 골라야 씁니다)`
      // 고른 확정 세트에 검수 출처가 없는 기록이 섞였으면(옛 엑셀·다른 경로) 알린다 — 그 기록도 정답으로 나간다
      const chosenSet = pick.chosen ? all.find((x) => x.setId === pick.chosen && x.readingStage === 'final') : undefined
      if (chosenSet) {
        const manual = catalog.labels.listRecords({ set: chosenSet }).filter((r) => !hasAdjudication(r)).length
        if (manual > 0 && !unproven.includes(chosenSet)) pick.reason = `${pick.reason} (검수 출처 일부 없음: 검수에서 만들지 않은 기록 ${manual}건이 섞여 있습니다)`
      }
      out.push({
        sha256: sha,
        fileId: f?.id ?? null,
        fileName: f?.storedFileName ?? (align?.fileName || sha.slice(0, 12)),
        specimenId,
        split: splitOf(st, specimenId),
        candidates: all
          .map((x) => ({
            setId: x.setId,
            labelerId: x.labelerId,
            readingStage: x.readingStage,
            guidelineVersion: x.guidelineVersion,
            defectCount: x.defectCount,
            pendingConflicts: x.pendingConflicts
          }))
          .sort((a, b) => (a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : 0)),
        chosen: pick.chosen,
        reason: pick.reason,
        hasFile: f !== null
      })
    }
    return out.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ko') || (a.sha256 < b.sha256 ? -1 : 1))
  }

  /** 분할 쓰기 문맥 (기록용 시각·PC·지금 라벨러) */
  function splitCtx(s: ReadySettings, o: TrainingSplitOptions | undefined): Parameters<typeof applySplitChanges>[2] {
    if (o !== undefined && o !== null && !isObj(o)) invalid('분할 옵션이 올바르지 않습니다.')
    return {
      at: localIso(now()),
      pcId: s.pcId,
      labelerId: s.labelerId,
      confirmLocked: o?.confirmLocked === true,
      reason: typeof o?.reason === 'string' ? o.reason : null
    }
  }

  /** 새 출력 폴더 (있으면 _2, _3 …) */
  async function freshDir(parent: string, base: string): Promise<string> {
    const exists = async (p: string): Promise<boolean> => stat(p).then(() => true, () => false)
    for (let i = 1; i < 1000; i++) {
      const p = join(parent, i === 1 ? base : `${base}_${i}`)
      if (!(await exists(p)) && !(await exists(`${p}.partial`))) return p
    }
    throw new AppError('CONFLICT', '새 폴더 이름을 정하지 못했습니다. 다른 폴더를 고르세요.')
  }

  function exportScope(req: LabelExportRequest): Extract<LabelExportScope, { kind: 'all' | 'files' }> {
    if (!isObj(req)) invalid('내보낼 범위가 올바르지 않습니다.')
    if (req.kind === 'all') return { kind: 'all' }
    if (req.kind === 'files') {
      const shas = Array.isArray(req.sha256s) ? req.sha256s.map((s) => String(s).trim().toLowerCase()) : []
      if (shas.length === 0) invalid('내보낼 파일을 고르세요.')
      if (shas.some((s) => !SHA256.test(s))) invalid('SHA-256 값이 올바르지 않습니다.')
      return { kind: 'files', sha256s: shas }
    }
    return invalid('내보낼 범위가 올바르지 않습니다.')
  }

  // ── 3단계 검수 ──

  /** 2인 독립 모드면 검수를 막는다 (블라인드 판독이 서로의 기록을 보지 않게) */
  function blockBlind(s: AppSettings): void {
    if (s.labelBlindMode) invalid(REVIEW_BLIND_REASON)
  }

  /** 확정 라벨러 = 지금 라벨러 (등록돼 있어야 함) */
  function adjudicatorOf(catalog: Catalog, s: AppSettings): LabelerInfo {
    if (!s.labelerId) invalid('지금 라벨러를 먼저 고르세요. 확정 세트의 라벨러가 됩니다(Level III).')
    const l = catalog.labels.getLabeler(s.labelerId)
    if (!l) invalid(`등록되지 않은 라벨러입니다: ${s.labelerId}. 라벨 관리에서 라벨러를 먼저 추가하세요.`)
    return l
  }

  return {
    busy: () => running > 0,
    clear() {
      previews.clear()
      groupCache.clear()
      replicaChecked.clear()
      notices.length = 0
    },

    session: () =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        return sessionOf(catalog, s, await writer(catalog, s))
      }),

    setSession: (patch) =>
      op(async () => {
        if (!isObj(patch)) invalid('라벨 작업 설정 값이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const cur = await settings()
        const next: Partial<AppSettings> = {}
        if (patch.pcId !== undefined) {
          const pc = cleanPcId(patch.pcId)
          if (!pc) invalid("PC ID 는 글자·숫자로 시작하고 글자·숫자·'.'·'_'·'-' 만 써서 32자까지 적습니다.")
          if (pc !== cur.pcId && catalog.labels.pcIdUsedElsewhere(pc)) {
            throw new AppError(
              'CONFLICT',
              `'${pc}' 는 이 저장소의 라벨 기록에 다른 PC(또는 다른 저장소)의 이름으로 이미 나옵니다. 겹치지 않는 다른 이름을 적으세요.`
            )
          }
          next.pcId = pc
        }
        if (patch.labelerId !== undefined) {
          if (patch.labelerId === null) next.labelerId = null
          else {
            const id = typeof patch.labelerId === 'string' ? patch.labelerId.normalize('NFC').trim() : ''
            if (!id || !catalog.labels.getLabeler(id)) invalid(`등록되지 않은 라벨러입니다: ${String(patch.labelerId)}`)
            next.labelerId = id
          }
        }
        if (patch.blindMode !== undefined) {
          if (typeof patch.blindMode !== 'boolean') invalid('2인 모드 값이 올바르지 않습니다.')
          next.labelBlindMode = patch.blindMode
        }
        const s = (await updateSettings(deps.settingsPath, next)) as ReadySettings
        return sessionOf(catalog, s, await writer(catalog, s))
      }),

    registerLabeler: (info, options) =>
      op(async () => {
        if (!isObj(info)) invalid('라벨러 정보가 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        const id = typeof info.id === 'string' ? info.id.normalize('NFC').trim() : ''
        const existing = id ? catalog.labels.getLabeler(id) : null
        if (existing) {
          const vis = visibleOf(s)
          if (vis !== null && vis !== id) invalid('2인 독립 모드에서는 다른 라벨러의 정보를 고칠 수 없습니다.')
          if (options?.overwrite !== true) {
            throw new AppError('CONFLICT', `이미 있는 라벨러입니다: ${existing.name} (${existing.id}). 정보를 바꾸려면 '고치기'를 고르세요.`)
          }
        }
        const w = await writer(catalog, s)
        const r = catalog.labels.registerLabeler(info)
        await wrote(catalog, w)
        return r
      }),

    overview: () =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const vis = visibleOf(s)
        const all = catalog.labels.listLabelSets()
        const sets = vis === null ? all : all.filter((x) => x.labelerId === vis)
        const infos = setInfos(catalog, sets, catalog.labels.listRecords(vis === null ? {} : { visibleLabelerId: vis }))
        const bySha = new Map<string, LabelSetInfo[]>()
        for (const x of infos) bySha.set(x.sha256, [...(bySha.get(x.sha256) ?? []), x])
        const conflicts = visibleConflicts(catalog, vis)
        const conflictBySha = new Map<string, number>()
        for (const c of conflicts) if (c.sha256) conflictBySha.set(c.sha256, (conflictBySha.get(c.sha256) ?? 0) + 1)
        const planNames = new Map(catalog.listPlans().map((p) => [p.id, p.name]))
        const files = allFiles(catalog).sort(
          (a, b) => a.planId.localeCompare(b.planId) || a.storedFileName.localeCompare(b.storedFileName, 'ko') || a.id - b.id
        )
        const out: LabelFileStatus[] = files.map((f) => ({
          sha256: f.meta.sha256,
          fileId: f.id,
          fileName: f.storedFileName,
          planId: f.planId,
          planName: planNames.get(f.planId) ?? null,
          specimenId: f.specimenId,
          stateTag: f.stateTag,
          sets: bySha.get(f.meta.sha256) ?? [],
          pendingConflicts: conflictBySha.get(f.meta.sha256) ?? 0
        }))
        const local = new Set(files.map((f) => f.meta.sha256))
        const orphans = [...bySha.keys()].filter((sha) => !local.has(sha)).sort()
        for (const sha of orphans) {
          const a = catalog.labels.getFileAlignment(sha)
          out.push({
            sha256: sha,
            fileId: null,
            fileName: a?.fileName || sha.slice(0, 12),
            planId: null,
            planName: null,
            specimenId: a?.specimenId ?? null,
            stateTag: null,
            sets: bySha.get(sha) ?? [],
            pendingConflicts: conflictBySha.get(sha) ?? 0
          })
        }
        return {
          session: sessionOf(catalog, s, await writer(catalog, s)),
          files: out,
          setCount: sets.length,
          hiddenSetCount: all.length - sets.length,
          pendingConflicts: conflicts.length
        }
      }),

    listSets: (query) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const vis = visibleOf(s)
        const sha = shaOf(catalog, query)
        const opts = { ...(sha !== undefined ? { sha256: sha } : {}), ...(vis !== null ? { visibleLabelerId: vis } : {}) }
        return setInfos(catalog, catalog.labels.listLabelSets(opts), catalog.labels.listRecords(opts))
      }),

    listRecords: (query) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const vis = visibleOf(s)
        const q = query ?? {}
        const sha = shaOf(catalog, q)
        return catalog.labels.listRecords({
          ...(sha !== undefined ? { sha256: sha } : {}),
          ...(q.set ? { set: q.set } : {}),
          ...(q.kind ? { kind: q.kind } : {}),
          includeDeleted: q.includeDeleted === true,
          ...(vis !== null ? { visibleLabelerId: vis } : {})
        })
      }),

    saveRecord: (record) =>
      op(async () => {
        if (!isObj(record)) invalid('지시 기록 값이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        guardWriter(catalog, s, record.labelerId)
        const before = typeof record.uuid === 'string' ? catalog.labels.getRecord(record.uuid) : null
        guardSet(catalog, record)
        if (before) guardSet(catalog, before)
        const w = await writer(catalog, s)
        // 검토 완료 구간은 위치·길이·구분이 바뀔 때만 푼다 (메모·속성·화면 스냅샷만 고친 것, 형상 에코 승인은 풀지 않음)
        const r = saveLabelRecord(catalog, record, { ...ctxOf(w), releaseReviews: releasesReviews(before, record) })
        await wrote(catalog, w)
        return r
      }),

    deleteRecord: (uuid) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const r = catalog.labels.getRecord(String(uuid))
        if (!r) throw new AppError('NOT_FOUND', '지시 기록을 찾을 수 없습니다.')
        guardWriter(catalog, s, r.labelerId)
        guardSet(catalog, r)
        const w = await writer(catalog, s)
        const out = deleteLabelRecord(catalog, r.uuid, ctxOf(w))
        await wrote(catalog, w)
        return out
      }),

    listObservations: (query) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const vis = visibleOf(s)
        const q = query ?? {}
        const sha = shaOf(catalog, q)
        const rows = catalog.labels.listObservations({
          ...(Array.isArray(q.recordUuids) ? { recordUuids: q.recordUuids.map(String) } : {}),
          ...(sha !== undefined ? { sha256: sha } : {}),
          includeDeleted: q.includeDeleted === true
        })
        if (vis === null) return rows
        const allowed = new Set(catalog.labels.listRecords({ visibleLabelerId: vis, includeDeleted: true }).map((r) => r.uuid))
        return rows.filter((o) => allowed.has(o.recordUuid))
      }),

    saveObservation: (row) =>
      op(async () => {
        if (!isObj(row)) invalid('관측 표 값이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        const r = catalog.labels.getRecord(String(row.recordUuid))
        if (!r) throw new AppError('NOT_FOUND', '관측 표의 지시 기록을 찾을 수 없습니다.')
        guardWriter(catalog, s, r.labelerId)
        guardSet(catalog, r)
        const w = await writer(catalog, s)
        const out = catalog.labels.saveObservation(row, ctxOf(w))
        await wrote(catalog, w)
        return out
      }),

    deleteObservation: (recordUuid, groupId, leg) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const r = catalog.labels.getRecord(String(recordUuid))
        if (!r) throw new AppError('NOT_FOUND', '관측 표의 지시 기록을 찾을 수 없습니다.')
        guardWriter(catalog, s, r.labelerId)
        guardSet(catalog, r)
        const w = await writer(catalog, s)
        const out = catalog.labels.deleteObservation(r.uuid, groupId, leg, ctxOf(w))
        await wrote(catalog, w)
        return out
      }),

    listReviews: (query) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const vis = visibleOf(s)
        const q = query ?? {}
        const sha = shaOf(catalog, q)
        return catalog.labels.listReviewIntervals({
          ...(sha !== undefined ? { sha256: sha } : {}),
          ...(q.set ? { set: q.set } : {}),
          ...(q.kind ? { kind: q.kind } : {}),
          includeDeleted: q.includeDeleted === true,
          includeReleased: q.includeReleased !== false,
          ...(vis !== null ? { visibleLabelerId: vis } : {})
        })
      }),

    saveReview: (v) =>
      op(async () => {
        if (!isObj(v)) invalid('검토 구간 값이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        guardWriter(catalog, s, v.labelerId)
        guardSet(catalog, v)
        const w = await writer(catalog, s)
        const out = catalog.labels.saveReviewInterval(v, ctxOf(w))
        await wrote(catalog, w)
        return out
      }),

    deleteReview: (uuid) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const v = catalog.labels.getReviewInterval(String(uuid))
        if (!v) throw new AppError('NOT_FOUND', '검토 구간을 찾을 수 없습니다.')
        guardWriter(catalog, s, v.labelerId)
        guardSet(catalog, v)
        const w = await writer(catalog, s)
        const out = catalog.labels.deleteReviewInterval(v.uuid, ctxOf(w))
        await wrote(catalog, w)
        return out
      }),

    appendWorkEvent: (input) =>
      op(async () => {
        if (!isObj(input)) invalid('작업 이벤트 값이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        // undefined 칸은 빼고 기본값을 채운다
        const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<WorkEvent>
        const labelerId = given.labelerId ?? s.labelerId
        if (!labelerId) invalid('라벨러를 먼저 고르세요.')
        guardWriter(catalog, s, labelerId)
        if (typeof given.sessionId !== 'string' || given.sessionId === '') invalid('작업 세션 ID 가 없습니다.')
        const event = newWorkEvent({
          ...given,
          uuid: given.uuid ?? randomUUID(),
          sessionId: given.sessionId,
          kind: given.kind as WorkEvent['kind'],
          labelerId,
          pcId: given.pcId ?? s.pcId,
          at: given.at ?? localIso(now())
        })
        const w = await writer(catalog, s)
        const out = catalog.labels.appendWorkEvent(event).value
        await wrote(catalog, w)
        return out
      }),

    previewWorkbook: (path, options) =>
      op(async () => {
        if (typeof path !== 'string' || path === '') invalid('엑셀 파일 경로가 올바르지 않습니다.')
        const { root, catalog } = await deps.current()
        const s = await settings()
        const w = await writer(catalog, s)
        const opts = cleanWorkbookOptions(options)
        const data = new Uint8Array(await readLimited(path, MAX_WORKBOOK_BYTES, '엑셀'))
        const files = allFiles(catalog)
        const bySha = new Map(files.map((f) => [f.meta.sha256, f]))
        const planThickness = new Map(catalog.listPlans().map((p) => [p.id, p.spec.specimen.thicknessMm]))
        type GroupRead = { groups: LabelWorkbookGroup[]; thicknessMm: number | null; groupsError: string | null }
        const entry = (f: FileRecord, g: GroupRead | null): FileFinderEntry => ({
          names: [f.meta.sourceFileName, f.meta.deviceFileName, f.storedFileName],
          file: {
            sha256: f.meta.sha256,
            fileName: f.storedFileName,
            groups: g?.groups ?? [],
            thicknessMm: g?.thicknessMm ?? planThickness.get(f.planId) ?? null,
            specimenId: f.specimenId,
            groupsError: g?.groupsError ?? null,
            label: `${f.planId} · ${f.specimenId} · ${f.importedAt.slice(0, 10)} 가져옴 · SHA ${f.meta.sha256.slice(0, 8)}`
          }
        })

        // 1차: 그룹 없이 읽어 엑셀이 가리킨 파일만 모은다 (같은 이름 파일이 여럿이면 후보 모두)
        const first = makeFileFinder(files.map((f) => entry(f, null)))
        const touched = new Set<string>()
        const note = (list: readonly LabelWorkbookFile[]): void => list.forEach((x) => touched.add(x.sha256))
        const firstPass = parseLabelWorkbook(data, {
          findFiles: (name) => {
            const r = first.findFiles(name)
            note(r)
            return r
          },
          findFileBySha256: (sha) => {
            const r = first.findFileBySha256(sha)
            if (r) note([r])
            return r
          },
          pcId: s.pcId,
          versionSlot: w.versionSlot,
          now: now(),
          ...opts
        })
        // 2인 독립 모드: 다른 라벨러 엑셀은 읽기 전에 막는다 (사본을 읽지 않음)
        guardWorkbookReader(s, firstPass)

        // 2차: 가리킨 파일의 그룹(기법·스큐·이득)을 이미지 보기 메타로 채워 다시 읽는다
        const groups = new Map<string, GroupRead>()
        const readFailures: string[] = []
        for (const sha of [...touched].sort()) {
          const f = bySha.get(sha)
          if (!f) continue
          const g = await groupsFor(root, f)
          if (g.groupsError) readFailures.push(`'${f.storedFileName}': ${g.groupsError} — 저장소 위치와 사본을 확인하세요(엑셀의 그룹 칸 문제가 아닙니다).`)
          groups.set(sha, g)
        }
        const second = makeFileFinder(files.map((f) => entry(f, groups.get(f.meta.sha256) ?? null)))
        const parsed = parseLabelWorkbook(data, {
          findFiles: second.findFiles,
          findFileBySha256: second.findFileBySha256,
          pcId: s.pcId,
          versionSlot: w.versionSlot,
          now: now(),
          ...opts
        })

        // 그사이 저장소가 바뀌었으면 옛 카탈로그로 세지 않는다
        const cur = await deps.current()
        if (cur.root !== root) throw new AppError('CONFLICT', '저장소가 바뀌었습니다. 엑셀을 다시 고르세요.')
        guardWorkbookReader(s, parsed)
        const dry = applyWorkbook(catalog, parsed, {
          pcId: s.pcId,
          versionSlot: w.versionSlot,
          now: catalog.labels.clock(),
          dryRun: true,
          sourceName: basename(path),
          frozen: workbookFrozen(catalog)
        })

        const previewId = `LX-${stamp(now())}-${randomBytes(3).toString('hex')}`
        previews.set(previewId, { previewId, root, pcId: s.pcId, versionSlot: w.versionSlot, path, parsed, at: Date.now() })
        prunePreviews()

        const counts = new Map<string, { records: number; reviews: number; events: number; alignment: boolean }>()
        const bump = (sha: string | null, k: 'records' | 'reviews' | 'events' | 'alignment'): void => {
          if (!sha) return
          const c = counts.get(sha) ?? { records: 0, reviews: 0, events: 0, alignment: false }
          if (k === 'alignment') c.alignment = true
          else c[k]++
          counts.set(sha, c)
        }
        parsed.records.forEach((r) => bump(r.sha256, 'records'))
        parsed.reviews.forEach((v) => bump(v.sha256, 'reviews'))
        parsed.events.forEach((e) => bump(e.sha256, 'events'))
        parsed.alignments.forEach((a) => bump(a.sha256, 'alignment'))
        const removes = new Map<string, number>()
        for (const c of dry.changes) if (c.action === 'remove' && c.sha256) removes.set(c.sha256, (removes.get(c.sha256) ?? 0) + 1)
        for (const sha of removes.keys()) if (!counts.has(sha)) counts.set(sha, { records: 0, reviews: 0, events: 0, alignment: false })
        const alignName = new Map(parsed.alignments.map((a) => [a.sha256, a.fileName]))
        const matched: LabelWorkbookFileMatch[] = [...counts.entries()]
          .map(([sha, c]) => {
            const f = bySha.get(sha)
            return {
              sha256: sha,
              fileId: f?.id ?? null,
              fileName: f?.storedFileName ?? alignName.get(sha) ?? sha.slice(0, 12),
              planId: f?.planId ?? null,
              specimenId: f?.specimenId ?? null,
              ...c,
              matchedBy: parsed.fileMatch?.[sha] ?? null,
              removes: removes.get(sha) ?? 0
            }
          })
          .sort((a, b) => a.fileName.localeCompare(b.fileName, 'ko'))

        const reader = parsed.labeler
        const registered = reader ? catalog.labels.getLabeler(reader.id) : null
        // 사본을 읽지 못해 생긴 오류는 원인 한 줄을 맨 위에 둔다
        const errors = parsed.errors.length > 0 && readFailures.length > 0 ? [...readFailures, ...parsed.errors] : parsed.errors
        return {
          previewId,
          path,
          fileName: basename(path),
          createdAt: localIso(now()),
          ok: parsed.ok,
          reader: reader
            ? {
                ...reader,
                registered: registered !== null,
                differsFromRegistered:
                  registered !== null &&
                  (registered.name !== reader.name ||
                    registered.qualification !== reader.qualification ||
                    registered.organization !== reader.organization)
              }
            : null,
          form: { ...parsed.form },
          sheets: sheetCounts(data),
          files: matched,
          labelSets: parsed.labelSets,
          plan: dry.plan,
          totals: dry.totals,
          options: opts,
          groupQuestions: parsed.groupQuestions.map((g) => ({ ...g, candidates: g.candidates.map((c) => ({ ...c })), where: [...g.where] })),
          fileQuestions: parsed.fileQuestions.map((q) => ({ ...q, candidates: q.candidates.map((c) => ({ ...c })), where: [...q.where] })),
          questionErrors: parsed.questionErrors,
          changes: dry.changes,
          errors,
          warnings: [...(errors === parsed.errors ? readFailures : []), ...frozenHelp(dry.frozen), ...parsed.warnings, ...dry.warnings]
        }
      }),

    commitWorkbook: (previewId) =>
      op(async () => {
        prunePreviews()
        const p = previews.get(String(previewId))
        if (!p) throw new AppError('PREVIEW_EXPIRED', '미리보기가 만료되었습니다. 엑셀을 다시 고르세요.')
        const { root, catalog } = await deps.current()
        if (p.root !== root) throw new AppError('PREVIEW_EXPIRED', '저장소가 바뀌었습니다. 엑셀을 다시 고르세요.')
        const s = await settings()
        if (s.pcId !== p.pcId) throw new AppError('PREVIEW_EXPIRED', 'PC ID 가 바뀌었습니다. 엑셀을 다시 고르세요.')
        const w = await writer(catalog, s)
        if (w.versionSlot !== p.versionSlot) throw new AppError('PREVIEW_EXPIRED', '이 저장소의 버전 칸이 바뀌었습니다. 엑셀을 다시 고르세요.')
        if (!p.parsed.ok) invalid('엑셀에 오류가 있어 확정할 수 없습니다. 엑셀을 고친 뒤 다시 가져오세요.')
        // 미리보기 뒤 2인 모드·라벨러를 바꿨거나 세트를 제출했을 수 있어 다시 본다
        guardWorkbookReader(s, p.parsed)
        const r: WorkbookApplyResult = applyWorkbook(catalog, p.parsed, {
          pcId: s.pcId,
          versionSlot: w.versionSlot,
          now: catalog.labels.clock(),
          dryRun: false,
          sourceName: basename(p.path),
          frozen: workbookFrozen(catalog)
        })
        previews.delete(p.previewId)
        await wrote(catalog, w)
        return {
          path: p.path,
          fileName: basename(p.path),
          committedAt: localIso(now()),
          plan: r.plan,
          totals: r.totals,
          registeredLabelerId: r.registeredLabelerId,
          labelSets: p.parsed.labelSets,
          conflictIds: r.conflictIds,
          pendingConflicts: catalog.labels.pendingConflictCount(),
          changes: r.changes,
          warnings: [...frozenHelp(r.frozen), ...r.warnings]
        }
      }),

    exportFileName: (request) =>
      op(async () => {
        const scope = exportScope(request)
        const s = await settings()
        const what = scope.kind === 'all' ? '전체' : `파일${scope.sha256s.length}개`
        // 라벨러 ID 는 길이만 검사하므로 '/'·':' 같은 글자를 파일 이름에 맞게 바꾼다 (검수 CSV 이름과 같은 규칙)
        const who = s.labelBlindMode && s.labelerId ? `_${safeName(s.labelerId)}` : ''
        return `라벨_${what}${who}_${stamp(now())}_${s.pcId}.json`
      }),

    exportJsonFile: (request, path, appVersion) =>
      op(async () => {
        const asked = exportScope(request)
        if (typeof path !== 'string' || path === '') invalid('저장할 경로가 올바르지 않습니다.')
        const { root, catalog } = await deps.current()
        await assertExportTarget(path, 'file', exportRules(root, catalog))
        const s = await settings()
        // 2인 독립 모드: 지금 라벨러의 세트만 (다른 라벨러 기록을 파일로 꺼내지 않게)
        const vis = visibleOf(s)
        let scope: LabelExportScope = asked
        if (vis !== null) {
          const sets = visibleSets(catalog, vis, asked.kind === 'files' ? asked.sha256s : null)
          if (sets.length === 0) invalid('2인 독립 모드에서는 지금 라벨러의 라벨 세트만 내보냅니다. 내보낼 세트가 없습니다.')
          scope = { kind: 'sets', sets }
        }
        const file = exportLabels(catalog, scope, { appVersion: appVersion || '0.0.0', pcId: s.pcId, exportedAt: localIso(now()) })
        const json = serializeLabelExport(file)
        const tmp = `${path}.partial`
        try {
          await mkdir(dirname(path), { recursive: true })
          await writeFile(tmp, json, 'utf8')
          await rename(tmp, path)
        } catch (e) {
          // 방금 만든 임시 파일만 지운다 (원본·저장 파일은 건드리지 않음)
          await unlink(tmp).catch(() => undefined)
          throw new AppError('IO_ERROR', `라벨 파일을 쓰지 못했습니다: ${path}`, e instanceof Error ? e.message : String(e))
        }
        return {
          path,
          fileName: basename(path),
          bytes: Buffer.byteLength(json, 'utf8'),
          exportedAt: file.exportedAt,
          pcId: file.pcId,
          onlyLabelerId: vis !== null ? vis : null,
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

    importJsonFile: (path) =>
      op(async () => {
        if (typeof path !== 'string' || path === '') invalid('라벨 파일 경로가 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        const w = await writer(catalog, s)
        const buf = await readLimited(path, MAX_JSON_BYTES, '라벨')
        let text: string
        try {
          text = buf.toString('utf8')
        } catch {
          invalid(`라벨 파일이 너무 커서 읽지 못했습니다 (${Math.round(buf.length / 1024 / 1024)} MB).`)
        }
        // 제출(잠금)은 이 저장소에만 있어 다른 PC 값이 그대로 들어온다(설계 의도) — 바뀐 제출 세트를 세어 알린다
        const touchedSets = new Map<string, LabelSetKey>()
        const touchedObsRecords = new Set<string>()
        const report = importLabels(catalog, text, {
          onWrite: (entity, value) => {
            if (entity === 'record' || entity === 'review-interval') {
              const v = value as LabelSetKey
              touchedSets.set(labelSetId(v), { sha256: v.sha256, labelerId: v.labelerId, guidelineVersion: v.guidelineVersion, readingStage: v.readingStage })
            } else if (entity === 'observation') touchedObsRecords.add((value as ObservationRow).recordUuid)
          }
        })
        // 검수 확정 기록의 출처 칸(adjudication)은 이 앱이 만든 칸이라 '모르는 칸' 경고에서 뺀다 (saveFinal 과 같음)
        report.warnings = report.warnings.filter((w) => !w.startsWith('모르는 칸을 그대로 보존합니다: records[].adjudication '))
        if (report.ok) {
          for (const u of touchedObsRecords) {
            const r = catalog.labels.getRecord(u)
            if (r) touchedSets.set(labelSetId(r), { sha256: r.sha256, labelerId: r.labelerId, guidelineVersion: r.guidelineVersion, readingStage: r.readingStage })
          }
          const locks = readSetLockState(catalog.dbPath)
          const hit = [...touchedSets.keys()].filter((id) => setSubmittedAt(locks, id) !== null).sort()
          if (hit.length > 0) {
            const name = (id: string): string => {
              const k = touchedSets.get(id)!
              const f = catalog.findFileBySha256(k.sha256)
              return `${f?.storedFileName ?? catalog.labels.getFileAlignment(k.sha256)?.fileName ?? k.sha256.slice(0, 12)} · ${k.labelerId}`
            }
            report.warnings.push(
              `이 저장소에서 제출(잠금)한 블라인드 세트 ${hit.length}개가 다른 PC 값으로 바뀌었습니다: ${hit.slice(0, 5).map(name).join(', ')}${hit.length > 5 ? ` 외 ${hit.length - 5}개` : ''}. 제출 잠금은 이 저장소에만 있어 JSON 으로는 막지 않습니다 — 블라인드 기준선이 맞는지 확인하세요.`
            )
          }
        }
        if (report.source && report.source.pcId === s.pcId) {
          report.warnings.push(
            `보낸 PC ID 가 이 PC 와 같습니다 (${s.pcId}). 이 PC 에서 내보낸 파일이 아니면 두 PC 의 ID 가 겹친 것입니다 — 라벨 관리에서 한쪽 PC ID 를 바꾸세요.`
          )
        }
        await wrote(catalog, w)
        const result: LabelJsonImportResult = { path, fileName: basename(path), ...report }
        return result
      }),

    listConflicts: (query) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const q = query ?? {}
        const sha = shaOf(catalog, q)
        return visibleConflicts(catalog, visibleOf(s), {
          ...(q.pendingOnly === false ? { pendingOnly: false } : {}),
          ...(sha !== undefined ? { sha256: sha } : {})
        }).map((c) => conflictInfo(catalog, c))
      }),

    resolveConflict: (id, choice) =>
      op(async () => {
        if (!Number.isSafeInteger(id)) invalid('충돌 ID 값이 올바르지 않습니다.')
        if (choice !== 'mine' && choice !== 'theirs' && choice !== 'both') invalid(`해결 방법이 올바르지 않습니다: ${String(choice)}`)
        const { catalog } = await deps.current()
        const s = await settings()
        const c = catalog.labels.getConflict(id)
        if (!c) throw new AppError('NOT_FOUND', '충돌을 찾을 수 없습니다.')
        const vis = visibleOf(s)
        if (vis !== null && c.labelerId !== null && c.labelerId !== vis) invalid('2인 독립 모드에서는 지금 라벨러의 충돌만 풀 수 있습니다.')
        // '들어온 것'·'둘 다'는 그 세트를 바꾼다 — 제출한 세트·검수 확정 세트·잠긴 시험 정답은 앱 저장(guardSet)처럼 막는다
        if (choice !== 'mine' && c.resolvedAt === null) {
          const set = conflictSetOf(catalog, c)
          const f = set ? frozenSetJudge(catalog)(set) : null
          if (f) throw new AppError('CONFLICT', FROZEN_CONFLICT_MESSAGE[f.kind])
        }
        const w = await writer(catalog, s)
        const r = resolveLabelConflict(catalog, id, choice, ctxOf(w))
        await wrote(catalog, w)
        return {
          conflict: conflictInfo(catalog, r.conflict),
          newKey: r.conflict.resolvedNewKey,
          pendingConflicts: catalog.labels.pendingConflictCount()
        }
      }),

    // ── 학습 데이터 (2b) ──

    trainingSplits: () =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        return splitViewOf(catalog, readSplitState(catalog.dbPath), visibleOf(s))
      }),

    setTrainingSplits: (changes, options) =>
      op(async () => {
        if (!Array.isArray(changes) || changes.some((c) => !isObj(c))) invalid('분할 변경 목록이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        const r = applySplitChanges(readSplitState(catalog.dbPath), changes, splitCtx(s, options))
        if (r.changed > 0) writeSplitState(catalog.dbPath, r.state)
        return splitViewOf(catalog, r.state, visibleOf(s))
      }),

    lockTrainingTest: (lock, options) =>
      op(async () => {
        if (typeof lock !== 'boolean') invalid('잠금 값이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        const r = applyTestLock(readSplitState(catalog.dbPath), lock, splitCtx(s, options))
        if (r.changed) writeSplitState(catalog.dbPath, r.state)
        return splitViewOf(catalog, r.state, visibleOf(s))
      }),

    trainingCandidates: (rule) =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        const vis = visibleOf(s)
        return { files: candidatesOf(catalog, cleanSetRule(rule), vis, readSplitState(catalog.dbPath)), blindModeLabelerId: vis }
      }),

    exportTraining: (request, parentDir, appVersion) => {
      // 잠금은 첫 await 전에 (동시에 두 번 눌러도 하나만)
      if (training) return Promise.reject(new AppError('BUSY', '학습 데이터를 내보내는 중입니다. 끝난 뒤 다시 시도하세요.'))
      const operationId = `TX-${stamp(now())}-${randomBytes(3).toString('hex')}`
      const controller = new AbortController()
      const mine: { operationId: string; controller: AbortController; progress: TrainingExportProgress } = {
        operationId,
        controller,
        progress: { operationId, phase: 'prepare', current: 0, total: 0, fileName: null, imagesDone: 0, imagesTotal: 0, cancelling: false }
      }
      training = mine
      return op(async () => {
        if (!isObj(request)) invalid('내보낼 범위가 올바르지 않습니다.')
        if (typeof parentDir !== 'string' || parentDir === '') invalid('학습 데이터를 둘 폴더가 올바르지 않습니다.')
        const parentOk = await stat(parentDir).then((x) => x.isDirectory(), () => false)
        if (!parentOk) throw new AppError('NOT_FOUND', `폴더를 찾을 수 없습니다: ${parentDir}`)
        const options = cleanTrainingOptions(request.options)
        const rule = cleanSetRule(request.setRule)
        const shas = request.sha256s === undefined || request.sha256s === null ? null : Array.isArray(request.sha256s) ? request.sha256s.map((x) => String(x).trim().toLowerCase()) : invalid('파일 목록이 올바르지 않습니다.')
        if (shas && shas.some((x) => !SHA256.test(x))) invalid('SHA-256 값이 올바르지 않습니다.')
        const splitNames: readonly TrainSplitOrNone[] = ['train', 'val', 'test', 'unassigned']
        const splits = request.splits === undefined || request.splits === null ? null : Array.isArray(request.splits) ? request.splits : invalid('분할 목록이 올바르지 않습니다.')
        if (splits && splits.some((x) => !splitNames.includes(x))) invalid('분할 값이 올바르지 않습니다.')
        if ((!shas || shas.length === 0) && (!splits || splits.length === 0)) invalid('내보낼 파일이나 분할을 고르세요.')

        const { root, catalog } = await deps.current()
        await assertExportTarget(parentDir, 'dir', exportRules(root, catalog))
        const s = await settings()
        const vis = visibleOf(s)
        const st = readSplitState(catalog.dbPath)
        const keepSha = shas && shas.length > 0 ? new Set(shas) : null
        const keepSplit = splits && splits.length > 0 ? new Set<TrainSplitOrNone>(splits) : null
        const picked = candidatesOf(catalog, rule, vis, st).filter(
          (c) => (!keepSha || keepSha.has(c.sha256)) && (!keepSplit || keepSplit.has((c.split ?? 'unassigned') as TrainSplitOrNone))
        )
        if (picked.length === 0) invalid('고른 조건에 맞는 라벨 있는 파일이 없습니다.')

        const sources: TrainingSourceFile[] = []
        for (const c of picked) {
          const file = c.fileId !== null ? catalog.getFile(c.fileId) : null
          let path: string | null = null
          if (file) {
            const p = toAbsolutePath(root, file.storedRelPath)
            if (await stat(p).then((x) => x.isFile(), () => false)) path = p
          }
          const set = c.chosen ? catalog.labels.listLabelSets({ sha256: c.sha256 }).find((x) => x.setId === c.chosen) ?? null : null
          const key: LabelSetKey | null = set
            ? { sha256: set.sha256, labelerId: set.labelerId, guidelineVersion: set.guidelineVersion, readingStage: set.readingStage }
            : null
          const records = key ? catalog.labels.listRecords({ set: key }) : []
          const align = catalog.labels.getFileAlignment(c.sha256)
          sources.push({
            sha256: c.sha256,
            fileName: c.fileName,
            specimenId: c.specimenId,
            weldId: align?.weldId ?? null,
            split: c.split,
            path,
            selection: { candidates: c.candidates.map((x) => x.setId), chosen: c.chosen, reason: c.reason },
            labelSet: key,
            labeler: key ? catalog.labels.getLabeler(key.labelerId) : null,
            records,
            reviewIntervals: key ? catalog.labels.listReviewIntervals({ set: key }) : [],
            observations: records.length > 0 ? catalog.labels.listObservations({ recordUuids: records.map((r) => r.uuid) }) : [],
            alignment: align,
            physicalDefects: c.specimenId ? catalog.labels.listPhysicalDefects({ specimenIds: [c.specimenId] }) : [],
            pendingConflicts: set?.pendingConflicts ?? 0
          })
        }
        await initNde()
        const outDir = await freshDir(parentDir, `학습데이터_${stamp(now())}_${s.pcId}`)
        // 라벨 작업(op) 중이라 끝날 때까지 저장소를 바꿀 수 없다
        return runTrainingExport({
          operationId,
          outDir,
          files: sources,
          options,
          setRule: rule,
          blindModeLabelerId: vis,
          split: {
            unit: 'specimen',
            testLocked: st.testLock.locked,
            testLockedAt: st.testLock.at,
            assignments: Object.fromEntries(Object.values(st.assignments).map((a) => [a.specimenId, a.split] as const).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))),
            lastChangedAt: st.log.length ? st.log[st.log.length - 1]!.at : null
          },
          verifyCopies: true,
          appVersion: appVersion || '0.0.0',
          pcId: s.pcId,
          exportedAt: options.fixedExportedAt ?? localIso(now()),
          // 형식 분기: .opd 사본은 OPD 구조 읽기, 그 밖은 NDE (core/opd/viewer)
          reader: { info: (p) => readStoredViewerInfo(p), chunk: (p, g, a, n) => readStoredViewerChunk(p, g, a, n) },
          signal: controller.signal,
          onProgress: (p) => {
            mine.progress = { ...p, cancelling: controller.signal.aborted }
          }
        })
      }).finally(() => {
        if (training === mine) training = null
      })
    },

    trainingStatus: () => (training ? { ...training.progress, cancelling: training.controller.signal.aborted } : null),

    cancelTraining: (operationId) => {
      if (!training || training.operationId !== operationId || training.controller.signal.aborted) return false
      training.controller.abort()
      return true
    },

    // ── 3단계 검수 ──

    reviewSources: () =>
      op(async () => {
        const { catalog } = await deps.current()
        const s = await settings()
        return reviewSourcesOf(catalog, { blindMode: s.labelBlindMode, labelerId: s.labelerId })
      }),

    compareSets: (request) =>
      op(async () => {
        const req = cleanCompareRequest(request)
        const { catalog } = await deps.current()
        const s = await settings()
        blockBlind(s)
        return runCompare(catalog, req)
      }),

    previewFinal: (request) =>
      op(async () => {
        const req = cleanFinalRequest(request)
        const { catalog } = await deps.current()
        const s = await settings()
        blockBlind(s)
        const adj = adjudicatorOf(catalog, s)
        return planFinal(catalog, req, adj, { pcId: s.pcId, now: localIso(now()) }).preview
      }),

    saveFinal: (request, options) =>
      op(async () => {
        const req = cleanFinalRequest(request)
        if (options !== undefined && options !== null && !isObj(options)) invalid('저장 옵션이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        blockBlind(s)
        const adj = adjudicatorOf(catalog, s)
        guardWriter(catalog, s, adj.id)
        const w = await writer(catalog, s)
        const at = localIso(now())
        const plan = planFinal(catalog, req, adj, { pcId: s.pcId, now: at })
        const r = saveFinalSet(catalog, plan, { pcId: w.pcId, versionSlot: w.versionSlot, now: at }, options ?? {})
        await wrote(catalog, w)
        return r
      }),

    reviewCsvFileName: (request) =>
      op(async () => {
        const req = cleanCsvRequest(request)
        const s = await settings()
        blockBlind(s)
        return reviewCsvFileName(req, stamp(now()), s.pcId)
      }),

    saveReviewCsv: (request, path) =>
      op(async () => {
        const req = cleanCsvRequest(request)
        if (typeof path !== 'string' || path === '') invalid('저장할 경로가 올바르지 않습니다.')
        const { root, catalog } = await deps.current()
        await assertExportTarget(path, 'file', exportRules(root, catalog))
        const s = await settings()
        blockBlind(s)
        const adj = req.final ? adjudicatorOf(catalog, s) : null
        const { text, rows } = reviewCsvText(catalog, req, adj, { pcId: s.pcId, now: localIso(now()) })
        const tmp = `${path}.partial`
        try {
          await mkdir(dirname(path), { recursive: true })
          await writeFile(tmp, text, 'utf8')
          await rename(tmp, path)
        } catch (e) {
          // 방금 만든 임시 파일만 지운다
          await unlink(tmp).catch(() => undefined)
          throw new AppError('IO_ERROR', `CSV 파일을 쓰지 못했습니다: ${path}`, e instanceof Error ? e.message : String(e))
        }
        return { path, fileName: basename(path), bytes: Buffer.byteLength(text, 'utf8'), rows }
      }),

    // ── 세트 제출(잠금) · 설계값 대조 시작 ──

    submitSet: (set, submit, options) =>
      op(async () => {
        const key = cleanSetKey(set)
        if (key.readingStage === 'final') invalid('확정 세트는 제출하지 않습니다 (검수 화면에서만 만듦).')
        const { catalog } = await deps.current()
        const s = await settings()
        guardWriter(catalog, s, key.labelerId)
        if (s.labelerId !== key.labelerId) invalid('지금 라벨러의 세트만 제출하거나 풀 수 있습니다.')
        const reason = typeof options?.reason === 'string' ? options.reason.normalize('NFC').trim().slice(0, 500) : ''
        const id = labelSetId(key)
        const st = readSetLockState(catalog.dbPath)
        const at = localIso(now())
        if (submit) {
          if (!st.locks[id]) {
            st.locks[id] = { setId: id, at, pcId: s.pcId, labelerId: s.labelerId }
            st.log.push({ at, pcId: s.pcId, labelerId: s.labelerId, action: 'submit', setId: id, reason: reason || null })
            writeSetLockState(catalog.dbPath, st)
          }
        } else if (st.locks[id]) {
          if (!reason) throw new AppError('CONFLICT', '제출을 풀려면 이유를 적으세요 (블라인드 기준선을 다시 고치게 됩니다 — 기록에 남습니다).')
          delete st.locks[id]
          st.log.push({ at, pcId: s.pcId, labelerId: s.labelerId, action: 'unsubmit', setId: id, reason })
          writeSetLockState(catalog.dbPath, st)
        }
        return { setId: id, submittedAt: setSubmittedAt(st, id) }
      }),

    startReconcile: (from) =>
      op(async () => {
        const src = cleanSetKey(from)
        if (src.readingStage !== 'blind') invalid('설계값 대조는 블라인드 세트에서 시작합니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        guardWriter(catalog, s, src.labelerId)
        if (s.labelerId !== src.labelerId) invalid('지금 라벨러의 블라인드 세트만 대조를 시작할 수 있습니다.')
        const to: LabelSetKey = { ...src, readingStage: 'reconciled' }
        const toId = labelSetId(to)
        const liveTo = catalog.labels.listRecords({ set: to }).length + catalog.labels.listReviewIntervals({ set: to, includeReleased: true }).length
        if (liveTo > 0) throw new AppError('CONFLICT', '이 파일에 이미 설계값 대조 세트가 있습니다. 그 세트를 고르면 이어서 대조합니다.')
        const records = catalog.labels.listRecords({ set: src })
        const reviews = catalog.labels.listReviewIntervals({ set: src, includeReleased: true })
        const observations = records.length ? catalog.labels.listObservations({ recordUuids: records.map((r) => r.uuid) }) : []
        const w = await writer(catalog, s)
        const at = localIso(now())
        const recMap: Record<string, string> = {}
        const revMap: Record<string, string> = {}
        let nObs = 0
        catalog.transaction(() => {
          const uuidOf = new Map<string, string>()
          for (const r of records) {
            const uuid = randomUUID()
            uuidOf.set(r.uuid, uuid)
            recMap[uuid] = r.uuid
            const copy: IndicationRecord = {
              ...(JSON.parse(JSON.stringify(r)) as IndicationRecord),
              uuid,
              readingStage: 'reconciled',
              revision: 1,
              versions: [],
              deleted: false,
              pcId: null,
              createdAt: at,
              updatedAt: at,
              groupingId: null,
              knowledge: { ...r.knowledge, designValueSeen: true }
            }
            saveLabelRecord(catalog, copy, { ...ctxOf(w), releaseReviews: false })
          }
          for (const v of reviews) {
            const uuid = randomUUID()
            revMap[uuid] = v.uuid
            catalog.labels.saveReviewInterval(
              { ...(JSON.parse(JSON.stringify(v)) as ReviewInterval), uuid, readingStage: 'reconciled', revision: 1, versions: [], deleted: false, pcId: null },
              ctxOf(w)
            )
          }
          for (const o of observations) {
            const ru = uuidOf.get(o.recordUuid)
            if (!ru || o.deleted || !o.expertConfirmed) continue
            catalog.labels.saveObservation({ ...(JSON.parse(JSON.stringify(o)) as ObservationRow), recordUuid: ru, revision: 1, versions: [], deleted: false, pcId: null }, ctxOf(w))
            nObs++
          }
        })
        await wrote(catalog, w)
        const st = readSetLockState(catalog.dbPath)
        const srcId = labelSetId(src)
        const submittedSource = !st.locks[srcId]
        if (submittedSource) st.locks[srcId] = { setId: srcId, at, pcId: s.pcId, labelerId: s.labelerId }
        st.copies.push({ from: srcId, to: toId, at, pcId: s.pcId, labelerId: s.labelerId, records: recMap, reviews: revMap })
        st.log.push({ at, pcId: s.pcId, labelerId: s.labelerId, action: 'reconcile', setId: srcId, reason: `→ ${toId}` })
        writeSetLockState(catalog.dbPath, st)
        return { set: to, setId: toId, records: records.length, reviewIntervals: reviews.length, observations: nObs, submittedSource }
      }),

    physicalDefects: (query) =>
      op(async () => {
        if (!isObj(query)) invalid('파일 값이 올바르지 않습니다.')
        const { catalog } = await deps.current()
        const s = await settings()
        if (s.labelBlindMode) invalid('2인 독립 모드에서는 설계값(물리 결함)을 보이지 않습니다.')
        const sha = shaOf(catalog, { sha256: String(query.sha256 ?? '') })
        if (!sha) invalid('SHA-256 값이 올바르지 않습니다.')
        const f = catalog.findFileBySha256(sha)
        const al = catalog.labels.getFileAlignment(sha)
        const specimens = [...new Set([f?.specimenId, al?.specimenId].filter((x): x is string => typeof x === 'string' && x !== ''))]
        if (specimens.length === 0) return []
        return catalog.labels.listPhysicalDefects({ specimenIds: specimens }).filter((d) => !d.deleted)
      })
  }
}

/** IPC 로 온 라벨 세트 키 검사 */
function cleanSetKey(v: unknown): LabelSetKey {
  if (!isObj(v)) invalid('라벨 세트 값이 올바르지 않습니다.')
  const sha = typeof v['sha256'] === 'string' ? v['sha256'].trim().toLowerCase() : ''
  if (!SHA256.test(sha)) invalid('SHA-256 값이 올바르지 않습니다.')
  const labelerId = typeof v['labelerId'] === 'string' ? v['labelerId'].normalize('NFC').trim() : ''
  const guidelineVersion = typeof v['guidelineVersion'] === 'string' ? v['guidelineVersion'].normalize('NFC').trim() : ''
  const stage = v['readingStage']
  if (!labelerId || !guidelineVersion) invalid('라벨 세트(라벨러·지침서)가 비었습니다.')
  if (stage !== 'blind' && stage !== 'reconciled' && stage !== 'final') invalid('판독 단계가 올바르지 않습니다.')
  return { sha256: sha, labelerId, guidelineVersion, readingStage: stage }
}
