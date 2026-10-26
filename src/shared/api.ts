/**
 * 렌더러 ↔ main IPC 계약.
 * - IpcContract: 채널 이름 → (인자, 결과) 타입. main 핸들러와 preload 가 이 표 하나로 타입을 맞춘다.
 * - PautApi: 렌더러가 쓰는 API (window.pautApi). preload 와 브라우저 mock 이 같은 인터페이스를 구현한다.
 * - 모든 호출 결과는 Promise<ApiResult<T>> — 예외를 던지지 않는다.
 */
import type { ApiResult } from './errors'
import type { GateOverrideLike } from './imaging/gates'
import type { ViewerFileInfo, ViewerPaletteFile, ViewerVolumeChunk } from './imaging/types'
import type { ScanGroupCode, TruthTier } from './labels/codes'
import type { MatchFrame } from './labels/match'
import type {
  AdjudicationDecision,
  AdjudicationResult,
  CompareResult,
  CompareUnit,
  ComparisonPurpose,
  DesignAddition,
  DesignDepthMeaning,
  ReportHeaderInput
} from './labels/review'
import type {
  FileAlignment,
  IndicationRecord,
  LabelSetKey,
  LabelerInfo,
  ObservationRow,
  PhysicalDefect,
  ReaderSource,
  ReadingStage,
  RecordKind,
  ReviewInterval,
  ReviewIntervalKind,
  WorkEvent
} from './labels/types'
import type {
  AppInfo,
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
} from './types'

// ───────────────────────────── 요청 · 응답 보조 타입 ─────────────────────────────

export type FileSort = 'importedAt-desc' | 'importedAt-asc' | 'fileName-asc' | 'createdAt-desc'

export interface FileQuery {
  planId?: PlanId
  specimenId?: SpecimenId
  /** 검색어: 원본 파일명·장비 원본 파일명·시편 ID·상태 태그·메모·플랜 이름에서 부분일치 (대소문자 무시) */
  text?: string
  stateTag?: string
  sort?: FileSort
  /** 기본 0 */
  offset?: number
  /** 기본 200, 최대 1000 */
  limit?: number
}

export interface FileListPage {
  items: FileRecord[]
  total: number
  offset: number
  limit: number
}

export interface FileAnnotationPatch {
  stateTag?: string | null
  round?: number | null
  memo?: string
  tags?: string[]
}

export interface SpecimenPatch {
  displayName?: string
  note?: string
}

/**
 * 시편 다시 묶기 제안 한 줄 (core/service/specimenRegroup.ts). 파일명을 임시 시편 ID 로 받은 파일을
 * 지금 패턴(PL·TP·TF 번호)으로 다시 본 결과. 파일 사본은 옮기지 않고 카탈로그의 시편만 바꾼다.
 */
export interface SpecimenRegroupItem {
  fileId: FileId
  fileName: string
  planId: PlanId
  fromSpecimenId: SpecimenId
  toSpecimenId: SpecimenId
  /** 근거 ('시편 ID 'TF_01' 를 현재 파일명 …에서 찾았습니다.') */
  note: string
  /** 옮기지 않는 이유 (null = 옮길 수 있음) */
  blocked: string | null
}

export interface SpecimenRegroupPreview {
  items: SpecimenRegroupItem[]
}

export interface SpecimenRegroupResult {
  moved: number
  /** 옮기지 않은 줄 (그사이 막힘·사라짐) */
  skipped: number
  createdSpecimens: SpecimenId[]
  removedSpecimens: SpecimenId[]
}

export type ChoosePathsMode = 'files' | 'folder'

/** 이미지 보기: 파일 열기 결과 (그룹·축·빔·게이트·색표 등 수 KB) */
export interface ViewerOpenResult {
  file: FileRecord
  /** 렌더러 볼륨 캐시 키 'storeRoot|fileId|sha256' — 저장소가 바뀌면 달라진다. viewer:chunk 에 그대로 넘긴다 */
  key: string
  info: ViewerFileInfo
}

/**
 * 이미지 보기: C-scan 을 OmniPC 'Export C-scan' 꼴 .txt 로 내보내기 (X8, shared/imaging/cscanExport.ts).
 * main 이 저장된 사본에서 그 그룹의 게이트 C-scan 을 다시 계산해 쓴다(렌더러가 글자를 넘기지 않음). 진폭은 파일 값(소프트 이득 Δ 는 넣지 않음)
 */
export interface ViewerCscanExportRequest {
  fileId: FileId
  /** viewer:open 의 ViewerOpenResult.key (그사이 저장소·파일이 바뀌었으면 CONFLICT) */
  key: string
  groupId: number
  /** 조정 패널에서 바꾼 C-scan 게이트(보통 A) 값 — mm·% (없으면 파일 값). OPD 처럼 문턱을 모르는 파일은 화면 문턱을 넣어 준다 */
  gate?: GateOverrideLike
}

export interface ViewerCscanExportResult {
  /** 쓴 파일 (사용자가 대화상자에서 고른 경로) */
  path: string
  bytes: number
  /** 스캔 칸 수 (열) */
  scanCount: number
  /** 인덱스 칸 수 (줄 = 빔) */
  indexCount: number
  /** 인덱스 칸 꼴이 OmniPC 내보내기로 확인된 기법인가 (섹토리얼만 — 리니어·컴파운드는 캡처 14 덧붙임 대조 전) */
  indexConfirmed: boolean
  /** OmniPC 내보내기 파일로 아직 확인하지 못한 칸 (화면 '대조 전' — shared/imaging/cscanExport.ts omniCscanUnconfirmed) */
  unconfirmed: string[]
}

// ───────────────────────────── 결함 라벨 (1a 저장·합치기) ─────────────────────────────
// 기록 형식은 shared/labels/types.ts. 저장은 catalog.labels, 규칙은 core/labels, 서비스는 core/service/labels.ts.

/** 저장 단위 이름 (core/catalog LabelStoreEntity 와 같은 글자) */
export type LabelEntityKind = 'physical-defect' | 'file-alignment' | 'record' | 'observation' | 'review-interval' | 'work-event'

export const LABEL_ENTITY_KINDS: readonly LabelEntityKind[] = [
  'physical-defect',
  'file-alignment',
  'record',
  'observation',
  'review-interval',
  'work-event'
]

/** 저장 단위 한국어 이름 (화면 문구) */
export const LABEL_ENTITY_LABEL: Readonly<Record<LabelEntityKind | 'labeler', string>> = {
  labeler: '라벨러',
  'physical-defect': '물리 결함',
  'file-alignment': '파일 정렬',
  record: '지시 기록',
  observation: '관측 표',
  'review-interval': '검토 구간',
  'work-event': '작업 이벤트'
}

export type LabelEntityValue = PhysicalDefect | FileAlignment | IndicationRecord | ObservationRow | ReviewInterval | WorkEvent

/** 충돌 해결: 내 것 / 들어온 것 / 둘 다 남기기 */
export type LabelConflictChoice = 'mine' | 'theirs' | 'both'

/** 저장 단위마다 고를 수 있는 해결 (작업 이벤트는 고칠 수 없어 '들어온 것' 불가, '둘 다'는 UUID 키인 단위만) */
export const LABEL_CONFLICT_CHOICES: Readonly<Record<LabelEntityKind, readonly LabelConflictChoice[]>> = {
  'physical-defect': ['mine', 'theirs'],
  'file-alignment': ['mine', 'theirs'],
  record: ['mine', 'theirs', 'both'],
  observation: ['mine', 'theirs'],
  'review-interval': ['mine', 'theirs', 'both'],
  'work-event': ['mine', 'both']
}

/** 이 PC 의 라벨 작업 상태 */
export interface LabelSession {
  /** 이 PC 의 ID. 처음 부를 때 자동으로 만든다 */
  pcId: string
  /**
   * 버전 벡터 칸 = 'PC ID:복제본 ID'. 복제본 ID 는 이 저장소(DB 파일 위치)마다 앱이 만든다.
   * 저장소를 백업에서 되돌린 것을 알아채면 새 칸으로 바꾼다(notice 에 알림)
   */
  versionSlot: string
  /** 알릴 것 (백업에서 되돌린 저장소를 알아채 버전 칸을 바꿈 등). 없으면 빈 목록 */
  notices: string[]
  /** 지금 라벨러 (등록되지 않은 ID 면 labeler = null) */
  labelerId: string | null
  labeler: LabelerInfo | null
  /** 2인 독립 라벨 모드 (지금 라벨러의 세트만 보임) */
  blindMode: boolean
  /** 등록된 라벨러 (ID 순) */
  labelers: LabelerInfo[]
}

export interface LabelSessionPatch {
  /** 등록된 라벨러 ID 또는 null(고르지 않음) */
  labelerId?: string | null
  blindMode?: boolean
  /** 이 PC 의 ID 바꾸기 (PC_ID_PATTERN). 이 저장소의 기록에 다른 PC 이름으로 이미 나오면 거부(CONFLICT) */
  pcId?: string
}

/** 라벨러 등록 옵션 */
export interface LabelerRegisterOptions {
  /** 이미 있는 ID 면 이름·자격·기관을 바꾼다. 없으면(기본) 이미 있는 ID 는 CONFLICT */
  overwrite?: boolean
}

/** 라벨 세트 한 줄 (core/catalog LabelSetSummary + 종류별 수·라벨러 이름) */
export interface LabelSetInfo extends LabelSetKey {
  /** 'sha256|라벨러|지침서|단계' */
  setId: string
  /** 삭제 표시를 뺀 지시 기록 수 */
  recordCount: number
  /** 결함 기록 수 */
  defectCount: number
  /** 형상 에코 기록 수 */
  echoCount: number
  /** 형상 불완전 기록 수 */
  imperfectionCount: number
  deletedRecordCount: number
  /** 삭제 표시를 뺀 검토 구간 수 (세 종류 모두) */
  reviewIntervalCount: number
  /** 검토 완료(풀리지 않은) 스캔 구간 합집합 길이 (mm, 그룹 무관) */
  reviewedLengthMm: number
  qualityBadLengthMm: number
  belowThresholdLengthMm: number
  /** 이 PC 에 마지막으로 쓴 시각 (기록용) */
  lastStoredAt: string | null
  /** 이 PC 카탈로그의 그 파일 (없으면 null — 기록은 그래도 보관) */
  fileId: FileId | null
  fileName: string | null
  /** 이 세트에 걸린 풀지 않은 충돌 수 */
  pendingConflicts: number
  /** 등록된 라벨러 이름 (모르면 null) */
  labelerName: string | null
  /** 제출(잠금)한 시각 — 제출한 세트는 앱에서 고칠 수 없다 (블라인드 기준선 보호). 제출 전이면 null */
  submittedAt?: string | null
  /** '블라인드에서 설계값 대조 시작'으로 복사해 온 원본 세트 (setId, 없으면 null) */
  copiedFrom?: string | null
}

/** 세트 제출·풀기·대조 시작 기록 한 줄 (이 저장소 label_meta 'set-locks') */
export interface LabelSetLogEntry {
  at: string
  pcId: string
  labelerId: string | null
  action: 'submit' | 'unsubmit' | 'reconcile'
  setId: string
  reason: string | null
}

/** 세트 제출(잠금)·풀기 옵션 — 풀 때는 이유가 있어야 한다 */
export interface LabelSetSubmitOptions {
  reason?: string
}

/** 세트 제출 상태 */
export interface LabelSetSubmitResult {
  setId: string
  submittedAt: string | null
}

/** '블라인드에서 설계값 대조 시작' 결과: 새 대조 세트와 복사한 수 (블라인드 세트는 제출됨) */
export interface LabelReconcileResult {
  set: LabelSetKey
  setId: string
  records: number
  reviewIntervals: number
  observations: number
  /** 원본 블라인드 세트를 이번에 제출(잠금)했나 */
  submittedSource: boolean
}

/** 파일별 라벨 현황 한 줄 */
export interface LabelFileStatus {
  sha256: string
  /** 이 PC 저장소의 파일. null = 파일은 없고 라벨만 있음 (다른 PC 에서 가져옴) */
  fileId: FileId | null
  /** 저장된 파일 이름 (파일이 없으면 파일 정렬의 이름, 그것도 없으면 sha256 앞 12자) */
  fileName: string
  planId: PlanId | null
  planName: string | null
  specimenId: SpecimenId | null
  stateTag: string | null
  /** 보이는 라벨 세트 (라벨러·단계 순) */
  sets: LabelSetInfo[]
  /** 이 파일에 걸린 풀지 않은 충돌 수 (보이는 것만) */
  pendingConflicts: number
}

export interface LabelOverview {
  session: LabelSession
  /** 저장소의 모든 파일(플랜·파일 이름 순) 뒤에 라벨만 있는 파일 */
  files: LabelFileStatus[]
  /** 보이는 라벨 세트 수 */
  setCount: number
  /** 2인 독립 모드에서 숨긴 다른 라벨러 세트 수 */
  hiddenSetCount: number
  /** 풀지 않은 충돌 수 (보이는 것만) */
  pendingConflicts: number
}

/** 파일은 fileId 또는 sha256 으로 고른다 (둘 다 없으면 전체) */
export interface LabelRecordListQuery {
  fileId?: FileId
  sha256?: string
  set?: LabelSetKey
  kind?: RecordKind
  includeDeleted?: boolean
}

export interface LabelReviewListQuery {
  fileId?: FileId
  sha256?: string
  set?: LabelSetKey
  kind?: ReviewIntervalKind
  includeDeleted?: boolean
  /** 자동으로 풀린 검토 완료 구간도 (기본 true) */
  includeReleased?: boolean
}

export interface LabelObservationListQuery {
  recordUuids?: string[]
  fileId?: FileId
  sha256?: string
  includeDeleted?: boolean
}

export interface LabelSaveOutcome<T> {
  /** 저장된 값 (versions·revision·pcId·updatedAt 이 채워짐) */
  value: T
  /** 검사 경고 */
  warnings: string[]
  /** 내용이 바뀌어 실제로 썼는지 */
  changed: boolean
}

export interface LabelRecordSaveOutcome extends LabelSaveOutcome<IndicationRecord> {
  /** 이번 저장으로 자동으로 풀린 검토 완료 구간 */
  releasedReviews: ReviewInterval[]
}

/** 작업 이벤트 추가: uuid·pcId·at·labelerId 는 비우면 채운다(새 UUID, 이 PC, 지금 시각, 지금 라벨러). readingStage·sha256·detail 은 넘긴 값(없으면 null — 서비스가 채우지 않음), tool 은 없으면 'app' */
export type WorkEventInput = Partial<WorkEvent> & Pick<WorkEvent, 'kind' | 'sessionId'>

// ── 엑셀(전문가 기록양식 v1) 가져오기: 미리보기 → 확정 ──

export interface LabelWorkbookOptions {
  /** 같은 기법·스큐 그룹이 둘 이상인 파일의 답: 물음 key ('sha256|sect-90') → 그룹 id */
  groupChoices?: Record<string, number>
  /** 엑셀 파일명이 저장소 파일 둘 이상과 맞을 때의 답: 물음 key (정리한 파일명) → sha256 */
  fileChoices?: Record<string, string>
}

/** 확정하면 고침·지움 표시·충돌·그대로 둠이 되는 한 줄 (확정 전에 보여 준다) */
export interface LabelWorkbookChange {
  action: 'update' | 'remove' | 'conflict' | 'kept'
  entity: LabelEntityKind
  sha256: string | null
  /** '12T-SV-01-Cap on.nde 지시 3' */
  name: string
  /** 한국어 이유 */
  reason: string
}

/** 확정하면 일어날 일 (저장 단위마다) */
export interface LabelPlanCounts {
  /** 새로 넣음 */
  create: number
  /** 엑셀 값으로 고침 (지시 기록·검토 구간: 엑셀이 그 줄의 원본) 또는 들어온 것이 새것 */
  update: number
  /** 바뀐 것 없음 */
  unchanged: number
  /** 이 PC 값을 그대로 둠 (앱에서 다시 찍은 기록, 이 PC 에서 더 고친 값, 고칠 수 없는 작업 이벤트) — 경고에 이유 */
  kept: number
  /** 양쪽 값이 달라 둘 다 보관 (파일 정렬·물리 결함) — 충돌 목록에서 고름 */
  conflict: number
  /** 엑셀에서 빠져 지움 표시 (같은 라벨 세트의 엑셀에서 온 지시 기록·검토 구간만) */
  remove: number
}

export interface LabelWorkbookSheetCount {
  sheet: 'reader' | 'file' | 'indication' | 'review' | 'physical' | 'worktime'
  /** 엑셀 시트 이름 ('지시') */
  name: string
  /** 머리글 아래 값이 있는 줄 수 (시트가 없으면 null) */
  rows: number | null
}

/** 엑셀이 가리킨 파일 하나 */
export interface LabelWorkbookFileMatch {
  sha256: string
  /** 이 PC 저장소의 파일 (null = SHA-256 칸으로만 이음) */
  fileId: FileId | null
  fileName: string
  planId: PlanId | null
  specimenId: SpecimenId | null
  records: number
  reviews: number
  events: number
  alignment: boolean
  /** 어떻게 맞췄나: 'SHA-256' 칸 / 이름 하나뿐 / 미리보기에서 고름 (이름만으로 맞춘 파일은 확인할 것) */
  matchedBy: 'sha256' | 'name' | 'choice' | null
  /** 확정하면 이 파일에서 지움 표시되는 기록·구간 수 */
  removes: number
}

/** '판독자' 시트 한 줄 */
export interface LabelWorkbookReader extends LabelerInfo {
  readingStage: ReadingStage
  guidelineVersion: string
  readerSource: ReaderSource
  /** 이 PC 에 이미 등록된 라벨러인지 (아니면 확정 때 등록) */
  registered: boolean
  /** 등록된 정보(이름·자격·기관)와 다른지 — 다르면 등록된 정보를 그대로 둔다 */
  differsFromRegistered: boolean
}

export interface LabelWorkbookGroupQuestion {
  /** LabelWorkbookOptions.groupChoices 의 열쇠 */
  key: string
  sha256: string
  fileName: string
  code: ScanGroupCode
  /** '섹토리얼 Skew 90' */
  label: string
  candidates: Array<{ id: number; name: string }>
  /** 이 물음이 걸린 곳 ("'지시' 시트 5행 D열" …) */
  where: string[]
}

/** 엑셀 파일명이 저장소 파일 둘 이상과 맞아 물어야 하는 것 */
export interface LabelWorkbookFileQuestion {
  /** LabelWorkbookOptions.fileChoices 의 열쇠 */
  key: string
  /** 엑셀에 적힌 파일명 */
  fileName: string
  candidates: Array<{ sha256: string; fileName: string | null; label: string | null }>
  where: string[]
}

export interface LabelWorkbookPreview {
  /** 확정할 때 넘기는 ID (TTL 동안 main 메모리에 보관) */
  previewId: string
  path: string
  fileName: string
  createdAt: string
  /** 오류 없음 → 확정할 수 있음 */
  ok: boolean
  reader: LabelWorkbookReader | null
  form: {
    labelForm: string | null
    schemaVersion: string | null
    fingerprint: string | null
    appFingerprint: string
    blind: boolean | null
    templateStage: string | null
  }
  sheets: LabelWorkbookSheetCount[]
  files: LabelWorkbookFileMatch[]
  labelSets: LabelSetKey[]
  /** 지금 저장소 기준으로 확정하면 일어날 일 */
  plan: Record<LabelEntityKind, LabelPlanCounts>
  totals: LabelPlanCounts
  /** 이 미리보기에 쓴 답 (다시 읽기·다시 시도 때 그대로 넘긴다) */
  options: LabelWorkbookOptions
  groupQuestions: LabelWorkbookGroupQuestion[]
  fileQuestions: LabelWorkbookFileQuestion[]
  /** errors 가운데 물음(그룹·파일)에서 난 것 — 화면에서 고르면 풀린다 */
  questionErrors: number
  /** 고침·지움 표시·충돌·그대로 둠 (최대 500줄) */
  changes: LabelWorkbookChange[]
  /** 시트·행·칸 위치가 붙은 한국어 */
  errors: string[]
  warnings: string[]
}

export interface LabelWorkbookCommitResult {
  path: string
  fileName: string
  committedAt: string
  plan: Record<LabelEntityKind, LabelPlanCounts>
  totals: LabelPlanCounts
  /** 이번에 새로 등록한 라벨러 ID */
  registeredLabelerId: string | null
  labelSets: LabelSetKey[]
  /** 새로 보관한 충돌 ID */
  conflictIds: number[]
  /** 확정 뒤 DB 전체의 풀지 않은 충돌 수 */
  pendingConflicts: number
  changes: LabelWorkbookChange[]
  warnings: string[]
}

// ── JSON 내보내기 · 가져오기 (여러 PC 합치기) ──

export type LabelExportRequest = { kind: 'all' } | { kind: 'files'; sha256s: string[] }

export interface LabelExportCounts {
  labelers: number
  physicalDefects: number
  fileAlignments: number
  records: number
  observations: number
  reviewIntervals: number
  workEvents: number
}

export interface LabelExportResult {
  path: string
  fileName: string
  bytes: number
  exportedAt: string
  pcId: string
  /** 2인 독립 모드라 이 라벨러의 세트만 담았으면 그 ID, 아니면 null */
  onlyLabelerId: string | null
  counts: LabelExportCounts
}

export interface LabelMergeCounts {
  created: number
  updated: number
  unchanged: number
  conflicts: number
}

/** JSON 가져오기 보고서 (core/labels LabelImportReport + 파일 경로) */
export interface LabelJsonImportResult extends LabelMergeCounts {
  path: string
  fileName: string
  /** 오류 없이 반영했는지. false 면 아무것도 바꾸지 않았다 */
  ok: boolean
  /** 버전만 갈리고 내용이 같아 버전만 합친 수 (updated 에 포함) */
  autoMerged: number
  byEntity: Record<LabelEntityKind | 'labeler', LabelMergeCounts>
  conflictItems: Array<{ entity: LabelEntityKind; key: string; conflictId: number }>
  errors: string[]
  warnings: string[]
  pendingConflicts: number
  source: { pcId: string; appVersion: string; exportedAt: string; schemaVersion: number; rulesVersion: number } | null
}

// ── 충돌 ──

export interface LabelConflictListQuery {
  /** 풀지 않은 것만 (기본 true) */
  pendingOnly?: boolean
  fileId?: FileId
  sha256?: string
}

export interface LabelConflictInfo {
  id: number
  entity: LabelEntityKind
  /** 저장 단위 키 (UUID, sha256, JSON 배열 글자) */
  key: string
  sha256: string | null
  labelerId: string | null
  /** 이 PC 의 그 파일 */
  fileId: FileId | null
  fileName: string | null
  /** 지금 내 것 (없어졌으면 null) */
  mine: LabelEntityValue | null
  /** 충돌을 찾았을 때의 내 것 */
  mineAtDetection: LabelEntityValue
  /** 들어온 것 */
  theirs: LabelEntityValue
  sourcePcId: string | null
  /** 출처 이름 (엑셀 확정에서 생긴 충돌은 엑셀 파일 이름, JSON 은 null) */
  sourceName: string | null
  sourceExportedAt: string | null
  detectedAt: string
  resolvedAt: string | null
  resolution: LabelConflictChoice | 'superseded' | null
  resolvedNewKey: string | null
  /** 고를 수 있는 해결 */
  choices: LabelConflictChoice[]
}

export interface LabelConflictResolveResult {
  conflict: LabelConflictInfo
  /** '둘 다'로 새로 만든 사본의 키 */
  newKey: string | null
  pendingConflicts: number
}

// ── 학습 데이터 분할 · 내보내기 (2b) ──
// 계산·쓰기는 core/labels/export, 서비스는 core/service/labels.ts. 분할은 이 저장소 catalog.db 의 label_meta 한 칸(다른 PC 로 가지 않음).

/** 학습 데이터 분할 (시편 단위 — 같은 시편의 모든 파일·재스캔·양쪽 스큐가 같은 쪽) */
export type TrainSplit = 'train' | 'val' | 'test'
/** 분할을 정하지 않은 시편 */
export type TrainSplitOrNone = TrainSplit | 'unassigned'

export const TRAIN_SPLITS: readonly TrainSplit[] = ['train', 'val', 'test']

export interface TrainingSplitChange {
  specimenId: string
  /** null = 분할 지우기 (정하지 않음) */
  split: TrainSplit | null
}

export interface TrainingSplitOptions {
  /** 시험 세트가 잠겨 있을 때 test 로 넣거나 test 에서 빼려면 true + reason (기록에 남는다) */
  confirmLocked?: boolean
  reason?: string
}

export interface TrainingSplitLogEntry {
  /** 기록용 시각 */
  at: string
  pcId: string
  labelerId: string | null
  /** assign = 분할 바꿈, locked-change = 잠긴 시험 세트를 확인받고 바꿈, lock·unlock = 시험 세트 잠금·풀기 */
  action: 'assign' | 'locked-change' | 'lock' | 'unlock'
  specimenId: string | null
  from: TrainSplit | null
  to: TrainSplit | null
  reason: string | null
}

export interface TrainingSplitSpecimen {
  specimenId: string
  split: TrainSplit | null
  /** 이 저장소의 파일 수 · 라벨 세트가 있는 파일 수 */
  fileCount: number
  labeledFileCount: number
  /** 결함 기록 수 (파일마다 결함이 가장 많은 세트 하나만 셈 — 두 라벨러를 겹쳐 세지 않게) */
  defectCount: number
  /** 이 시편의 물리 결함(설계·인증값) 수 */
  physicalDefectCount: number
  planIds: string[]
  /** 분할을 마지막으로 정한 시각 (기록용) */
  assignedAt: string | null
}

export interface TrainingSplitView {
  unit: 'specimen'
  testLocked: boolean
  testLockedAt: string | null
  testLockedBy: string | null
  /** 시편 ID 순 (저장소의 시편 + 분할만 남은 시편) */
  specimens: TrainingSplitSpecimen[]
  counts: Record<TrainSplitOrNone, number>
  /** 바꾼 기록 (최근 것이 앞, 최대 100줄) */
  log: TrainingSplitLogEntry[]
}

/**
 * 파일마다 라벨 세트 하나를 고르는 규칙. 기본: 확정 > 설계값 대조 > 지정 라벨러의 블라인드.
 * 같은 단계에 세트가 둘 이상이면 고르지 않고 이유를 남긴다(화면에서 overrides 로 고른다).
 */
export interface TrainingSetRule {
  /** 우선순위 순서. 빠진 단계는 쓰지 않는다 */
  stages: ReadingStage[]
  /** 블라인드 단계는 이 라벨러 세트만 (null = 블라인드 세트는 쓰지 않음) */
  blindLabelerId: string | null
  /** 파일별로 직접 고른 세트: sha256 → setId('sha256|라벨러|지침서|단계') */
  overrides?: Record<string, string>
  /**
   * 시험(test) 분할 파일은 확정 세트만 (기본 true — 평가_정의 1·2절: AI 평가는 확정 정답으로만, 블라인드는 사람 기준선).
   * 확정 세트가 없으면 그 파일은 고르지 않고 이유를 남긴다. false 면 다른 분할과 같은 단계 순서(manifest 에 경고)
   */
  testFinalOnly?: boolean
}

export const DEFAULT_TRAINING_SET_RULE: TrainingSetRule = { stages: ['final', 'reconciled', 'blind'], blindLabelerId: null, testFinalOnly: true }

export interface TrainingExportOptions {
  /** 원 진폭 amplitude_g<id>.npy (int16 [스캔, 빔, 샘플], 파일 이득 그대로 = 소프트 이득 0 dB) + status_g<id>.npy */
  amplitude: boolean
  /** 펼친 S-scan 그림(PNG) + coco.json + YOLO txt */
  images: boolean
  /** 그림 한 화소 크기 (mm, 기본 0.1) */
  mmPerPx: number
  /**
   * 무시 구역 (그림은 늘 가리지 않은 원본 images/ + 가림 그림 masks/ + COCO 무시 영역 iscrowd = 1):
   *   blackout = 학습(train) 분할에만 검게 가린 판 images_masked/ 를 더 내고 yolo_train.txt 가 그것을 가리킴(기본 — YOLO 는 무시 구역이 없음).
   *              val·test 는 늘 가리지 않은 그림 (평가 입력에 라벨 정보가 새지 않게)
   *   separate = 검게 가린 판을 내지 않음 (가림은 masks/·COCO 로만)
   *   exclude = 평가 기준 이상 신호가 있는 무시 객체('안 보임' 레그 제외)가 있는 장면을 그림에서 뺌
   */
  maskMode: 'blackout' | 'separate' | 'exclude'
  /** 약한 양성을 기본 학습에서 어떻게 볼지 (기본 'ignore' — 사용자 확인 전 새 기본값) */
  weakAs: 'ignore' | 'positive'
  /** 계산만 한 관측(전문가가 그리거나 확인하지 않음)에서 나온 양성 (기본 'keep') */
  unconfirmedObservation: 'keep' | 'ignore'
  /** manifest 의 내보낸 시각을 이 값으로 고정 (같은 바이트 확인용). 없으면 지금 */
  fixedExportedAt?: string | null
}

export const DEFAULT_TRAINING_EXPORT_OPTIONS: TrainingExportOptions = {
  amplitude: true,
  images: true,
  mmPerPx: 0.1,
  maskMode: 'blackout',
  weakAs: 'ignore',
  unconfirmedObservation: 'keep'
}

/** 내보낼 대상: 파일(sha256) 또는 분할. 둘 다 주면 둘 다 맞는 파일 */
export interface TrainingExportRequest {
  sha256s?: string[]
  splits?: TrainSplitOrNone[]
  setRule: TrainingSetRule
  options: TrainingExportOptions
}

/** 파일 하나의 세트 고르기 결과 (대화상자 미리보기 · manifest) */
export interface TrainingSetChoice {
  sha256: string
  fileId: FileId | null
  fileName: string
  specimenId: string | null
  split: TrainSplit | null
  /** 고를 수 있는 세트 (setId) — 보이는 것만 (2인 모드면 지금 라벨러 세트) */
  candidates: Array<{ setId: string; labelerId: string; readingStage: ReadingStage; guidelineVersion: string; defectCount: number; pendingConflicts: number }>
  /** 고른 세트 (null = 고르지 못함 → 내보내지 않음) */
  chosen: string | null
  /** 한국어 이유 ('확정 세트', '확정 세트가 2개라 고를 수 없음' …) */
  reason: string
  /** 이 PC 에 저장된 사본이 있는지 */
  hasFile: boolean
}

export interface TrainingCandidates {
  files: TrainingSetChoice[]
  /** 2인 독립 모드면 지금 라벨러 (그 사람 세트만 고름) */
  blindModeLabelerId: string | null
}

export type TrainingExportPhase = 'prepare' | 'read' | 'derive' | 'write' | 'images' | 'finish' | 'done'

/** 진행률 (labels:trainingStatus 로 읽는다) */
export interface TrainingExportProgress {
  operationId: string
  phase: TrainingExportPhase
  /** 끝낸 파일 수 / 전체 */
  current: number
  total: number
  fileName: string | null
  /** 지금 파일의 그림 수 (그림 단계) */
  imagesDone: number
  imagesTotal: number
  cancelling: boolean
}

export interface TrainingExportFileResult {
  sha256: string
  fileName: string
  specimenId: string | null
  split: TrainSplit | null
  /** 'files/<sha256 앞 16자>' (건너뛴 파일은 null) */
  folder: string | null
  setId: string | null
  status: 'exported' | 'skipped'
  /** 건너뛴 이유 (한국어) */
  reason: string | null
  groups: Array<{ groupId: number; name: string; blocked: string | null }>
  scenes: number
  trainScenes: Record<'positive' | 'weak' | 'ignore' | 'negative' | 'unknown', number>
  boxes: number
  ascanSpans: number
  images: number
  annotations: number
  /** 검토 완료 구간 안에서 승인하지 않은 형상 에코 후보 길이 (mm, 없으면 빠짐) — 그 자리 분류 1 이 배경이 됨 */
  unapprovedEchoMm?: number
  issues: number
}

export interface TrainingExportResult {
  operationId: string
  /** 만든 폴더 (전체 경로) */
  path: string
  folderName: string
  exportedAt: string
  files: TrainingExportFileResult[]
  totals: {
    files: number
    exported: number
    skipped: number
    blockedGroups: number
    scenes: number
    images: number
    annotations: number
    ascanSpans: number
    bytes: number
  }
  warnings: string[]
}

// ── 3단계 검수: 두 세트 비교 · Level III 확정 · 보고서 ──
// 계산은 shared/labels/review(순수 함수), 불러오기·저장은 core/service/labelReview.ts. 화면은 라벨 관리의 '검수' 탭.
// 2인 독립 모드에서는 모두 막는다(검수는 Level III 몫 — 블라인드 판독이 서로의 기록을 보지 않게).

/** 자격 글자가 Level III 인지 ('UT Level III', 'PAUT Level 3', 'L3', 'UT3', '3급' …). 모르면 false */
export function isLevel3Qualification(q: string | null | undefined): boolean {
  if (!q) return false
  const s = q.normalize('NFKC').toLowerCase()
  return (
    /level\s*-?\s*(iii|3)(?![0-9i])/.test(s) ||
    /(^|[^a-z0-9])(l|lv|lvl)\s*\.?\s*-?\s*(iii|3)(?![0-9i])/.test(s) ||
    /(^|[^a-z])(ut|pa|paut)\s*-?\s*(iii|3)(?![0-9i])/.test(s) ||
    /(^|[^0-9])3\s*급/.test(s)
  )
}

/** 비교할 세트 한쪽 = 라벨러 · 판독 단계 · 지침서 버전 (파일은 요청의 sha256s 모두) */
export interface ReviewSideKey {
  labelerId: string
  readingStage: ReadingStage
  guidelineVersion: string
}

export interface ReviewCompareOptions {
  /** 기본 'inter-reader' (2인 일치도). 'accuracy' = A 가 확정 정답, 'agency' = A 가 전문기관 정답 */
  purpose?: ComparisonPurpose
  /** 비교 단위. 기본 'grouping' (그룹 짓기 후, 평가 정의 3절) */
  unit?: CompareUnit
  /** 좌표 틀. 기본 'file' (파일 U). 'weld' = 파일 정렬로 시편 좌표 */
  frame?: MatchFrame
  /** 매칭 허용치 X·Y (mm). 기본 잠정값 10 · 5 */
  scanGapMm?: number
  depthDiffMm?: number
  /** 구간 단위 길이 (mm). 기본 잠정 20 */
  gradingUnitMm?: number
}

export interface ReviewCompareRequest {
  /** 비교할 파일 (같은 세트 키를 파일마다 찾는다) */
  sha256s: string[]
  a: ReviewSideKey
  b: ReviewSideKey
  options?: ReviewCompareOptions
}

/** 검수 탭의 라벨 세트 한 줄 */
export interface ReviewSetInfo {
  setId: string
  labelerId: string
  labelerName: string | null
  qualification: string | null
  readingStage: ReadingStage
  guidelineVersion: string
  recordCount: number
  defectCount: number
  reviewedLengthMm: number
  pendingConflicts: number
}

/** 검수 탭의 파일 한 줄 (라벨 세트가 있는 파일만) */
export interface ReviewSourceFile {
  sha256: string
  /** 이 PC 저장소의 파일 (null = 라벨만 있음 — 영상으로 볼 수 없음) */
  fileId: FileId | null
  planId: PlanId | null
  fileName: string
  specimenId: string | null
  split: TrainSplit | null
  sets: ReviewSetInfo[]
}

export interface ReviewSources {
  /** 검수를 막은 이유 (2인 독립 모드). 막지 않으면 null — 그때 files 는 비어 있다 */
  blocked: string | null
  /** 지금 라벨러 = 확정 세트의 라벨러 (고르지 않았으면 null) */
  adjudicator: LabelerInfo | null
  adjudicatorIsLevel3: boolean
  testLocked: boolean
  testLockedAt: string | null
  files: ReviewSourceFile[]
  /** 이 파일들 시편의 물리 결함(설계값) 수 */
  physicalDefects: number
}

/** 비교한 파일 하나 (분할·잠금 표시, 영상으로 보기) */
export interface ReviewFileInfo {
  sha256: string
  fileId: FileId | null
  planId: PlanId | null
  fileName: string
  specimenId: string | null
  split: TrainSplit | null
  /** A·B 세트가 이 파일에 있는지 */
  hasA: boolean
  hasB: boolean
}

export interface ReviewComparison {
  /** 검사·기본값을 채운 요청 (확정·CSV 요청에 그대로 넘긴다) */
  request: ReviewCompareRequest
  /** 행 짝 지문. 확정 요청에 그대로 넘기면 그사이 기록이 바뀌어 행 번호가 달라졌는지 서비스가 확인한다 */
  rowsKey: string
  comparison: CompareResult
  files: ReviewFileInfo[]
  testLocked: boolean
  testLockedAt: string | null
}

/** Level III 확정 옵션 (buildFinalSet 입력 중 화면이 고르는 것) */
export interface ReviewFinalOptions {
  /** 보류 행: 'uncertain' = 존재 확신도 '불확실' 기록으로 남김(기본), 'omit' = 넣지 않음 */
  deferAs?: 'uncertain' | 'omit'
  /** 비결함 기록(형상 에코 등)을 어느 쪽에서 베낄지 (기본 'none') */
  carryNonDefect?: 'a' | 'b' | 'none'
  /** 확정 검토 구간: 두 사람 검토 완료의 교집합(기본) · A · B · 없음 */
  reviews?: 'intersection' | 'a' | 'b' | 'none'
  /** 설계값 대조: 셈하는 정답 계층 하한(기본 'certified', 0단계 X3 는 'any'), 설계 깊이 뜻, 빈 물리 결함 ID 채우기 */
  design?: { minTier?: TruthTier | 'any'; depthIs?: DesignDepthMeaning; link?: boolean }
  designAdditions?: DesignAddition[]
}

export interface ReviewFinalRequest extends ReviewFinalOptions {
  compare: ReviewCompareRequest
  /** compareSets 결과의 rowsKey (다르면 CONFLICT — 다시 비교) */
  rowsKey: string
  decisions: AdjudicationDecision[]
}

export interface ReviewFinalPreview {
  rowsKey: string
  /** 지금 라벨러 = 확정 라벨러 */
  adjudicator: LabelerInfo | null
  adjudicatorIsLevel3: boolean
  /** 확정 라벨러가 A 또는 B 라벨러와 같음 (자기 판독을 조정 — 경고) */
  adjudicatorIsReader: boolean
  guidelineVersion: string
  result: AdjudicationResult
  /** 이 파일들에 이미 있는 확정 기록 수 (지움 표시 제외) */
  previousRecords: number
  /** 설계값 대조에 쓴 물리 결함 수 */
  designDefects: number
  /** 잠긴 시험 세트이면서 이미 확정 세트가 있는 파일 — 저장하려면 이유와 확인 */
  lockedTestFiles: string[]
  /** 저장할 수 있는지와, 못 하면 이유 */
  canSave: boolean
  blockers: string[]
}

export interface ReviewFinalSaveOptions {
  /** 지금 라벨러 자격이 Level III 가 아니어도 저장 */
  confirmNotLevel3?: boolean
  /** 잠긴 시험 세트의 확정 세트를 바꿈 (이유와 함께 — 분할 기록에 남는다) */
  confirmLockedTest?: boolean
  reason?: string
}

export interface ReviewSaveCounts {
  created: number
  updated: number
  unchanged: number
  /** 지움 표시 (이번 결정에서 나오지 않은 이전 확정 단위) */
  removed: number
}

export interface ReviewFinalSaveResult {
  savedAt: string
  labelSets: LabelSetKey[]
  records: ReviewSaveCounts
  reviewIntervals: ReviewSaveCounts
  /** 원본 기록에서 옮긴 전문가 관측 확인 행 (expertConfirmed — 설계값 대조 시작과 같은 규칙). 옛 결과·mock 에는 없음 */
  observations?: ReviewSaveCounts
  /** 그룹 짓기를 다시 매긴 기록 수 */
  regrouped: number
  /** 잠긴 시험 세트 기록에 남긴 시편 (없으면 빈 목록) */
  lockedLog: string[]
  warnings: string[]
}

export type ReviewCsvKind = 'comparison' | 'design' | 'report'

export interface ReviewCsvRequest {
  /** comparison = 부록 A 쌍 판정 표, design = 설계값 대조 표(확정 결정 필요), report = 10절 보고서 */
  kind: ReviewCsvKind
  compare: ReviewCompareRequest
  /** design·report 의 설계값 대조 = 이 결정으로 만든 확정 세트 대 물리 결함 */
  final?: Omit<ReviewFinalRequest, 'compare'>
  header?: ReportHeaderInput
  /** 보고서에 X·Y 민감도 표 (기본 true) */
  sensitivity?: boolean
}

export interface ReviewCsvResult {
  path: string
  fileName: string
  bytes: number
  /** 머리 줄을 뺀 줄 수 */
  rows: number
}

// ───────────────────────────── IPC 채널 ─────────────────────────────

export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChooseStoreRoot: 'settings:chooseStoreRoot',
  plansList: 'plans:list',
  plansGet: 'plans:get',
  plansRename: 'plans:rename',
  plansSetNote: 'plans:setNote',
  specimensList: 'specimens:list',
  specimensGet: 'specimens:get',
  specimensUpdate: 'specimens:update',
  specimensRegroupPreview: 'specimens:regroupPreview',
  specimensRegroupApply: 'specimens:regroupApply',
  filesList: 'files:list',
  filesGet: 'files:get',
  filesUpdate: 'files:update',
  filesReveal: 'files:reveal',
  importChoosePaths: 'import:choosePaths',
  importAnalyze: 'import:analyze',
  importCommit: 'import:commit',
  importCancel: 'import:cancel',
  importHistory: 'import:history',
  storeMaintenance: 'store:maintenance',
  viewerOpen: 'viewer:open',
  viewerChunk: 'viewer:chunk',
  viewerExportCscan: 'viewer:exportCscan',
  viewerOpenPalette: 'viewer:openPalette',
  labelsSession: 'labels:session',
  labelsSetSession: 'labels:setSession',
  labelsRegisterLabeler: 'labels:registerLabeler',
  labelsOverview: 'labels:overview',
  labelsListSets: 'labels:listSets',
  labelsListRecords: 'labels:listRecords',
  labelsSaveRecord: 'labels:saveRecord',
  labelsDeleteRecord: 'labels:deleteRecord',
  labelsListObservations: 'labels:listObservations',
  labelsSaveObservation: 'labels:saveObservation',
  labelsDeleteObservation: 'labels:deleteObservation',
  labelsListReviews: 'labels:listReviews',
  labelsSaveReview: 'labels:saveReview',
  labelsDeleteReview: 'labels:deleteReview',
  labelsAppendWorkEvent: 'labels:appendWorkEvent',
  labelsChooseWorkbook: 'labels:chooseWorkbook',
  labelsPreviewWorkbook: 'labels:previewWorkbook',
  labelsCommitWorkbook: 'labels:commitWorkbook',
  labelsChooseExportPath: 'labels:chooseExportPath',
  labelsExportJson: 'labels:exportJson',
  labelsChooseJson: 'labels:chooseJson',
  labelsImportJson: 'labels:importJson',
  labelsListConflicts: 'labels:listConflicts',
  labelsResolveConflict: 'labels:resolveConflict',
  labelsTrainingSplits: 'labels:trainingSplits',
  labelsSetTrainingSplits: 'labels:setTrainingSplits',
  labelsLockTrainingTest: 'labels:lockTrainingTest',
  labelsTrainingCandidates: 'labels:trainingCandidates',
  labelsChooseTrainingDir: 'labels:chooseTrainingDir',
  labelsExportTraining: 'labels:exportTraining',
  labelsTrainingStatus: 'labels:trainingStatus',
  labelsCancelTraining: 'labels:cancelTraining',
  labelsReviewSources: 'labels:reviewSources',
  labelsCompareSets: 'labels:compareSets',
  labelsPreviewFinal: 'labels:previewFinal',
  labelsSaveFinal: 'labels:saveFinal',
  labelsChooseReviewCsvPath: 'labels:chooseReviewCsvPath',
  labelsSaveReviewCsv: 'labels:saveReviewCsv',
  labelsSubmitSet: 'labels:submitSet',
  labelsStartReconcile: 'labels:startReconcile',
  labelsPhysicalDefects: 'labels:physicalDefects'
} as const

/** main → renderer 단방향 이벤트 채널 */
export const IPC_EVENTS = {
  progress: 'event:progress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** 채널별 인자·결과 타입 표 */
export interface IpcContract {
  'app:info': { args: []; result: AppInfo }
  'settings:get': { args: []; result: AppSettings }
  /** 부분 갱신, 갱신된 전체 설정 반환 */
  'settings:set': { args: [patch: Partial<Omit<AppSettings, 'settingsVersion'>>]; result: AppSettings }
  /** 폴더 선택 대화상자 → 고르면 storeRoot 저장 후 경로 반환, 취소면 null */
  'settings:chooseStoreRoot': { args: []; result: string | null }
  'plans:list': { args: []; result: ScanPlan[] }
  'plans:get': { args: [id: PlanId]; result: ScanPlan }
  'plans:rename': { args: [id: PlanId, name: string]; result: ScanPlan }
  'plans:setNote': { args: [id: PlanId, note: string]; result: ScanPlan }
  /** planId 를 주면 그 플랜에 파일이 있는 시편만, 개수도 그 플랜 기준 */
  'specimens:list': { args: [planId?: PlanId]; result: SpecimenSummary[] }
  'specimens:get': { args: [id: SpecimenId]; result: SpecimenSummary }
  'specimens:update': { args: [id: SpecimenId, patch: SpecimenPatch]; result: Specimen }
  /** 파일명을 임시 시편 ID 로 받은 파일을 지금 패턴으로 다시 묶자는 제안 (쓰지 않음) */
  'specimens:regroupPreview': { args: []; result: SpecimenRegroupPreview }
  /** 고른 파일만 다시 묶는다. 미리보기를 다시 계산해 그사이 막히거나 사라진 줄은 건너뛴다 */
  'specimens:regroupApply': { args: [fileIds: FileId[]]; result: SpecimenRegroupResult }
  'files:list': { args: [query: FileQuery]; result: FileListPage }
  'files:get': { args: [id: FileId]; result: FileRecord }
  'files:update': { args: [id: FileId, patch: FileAnnotationPatch]; result: FileRecord }
  /** 탐색기/Finder 에서 저장된 사본을 선택해 보여준다 */
  'files:reveal': { args: [id: FileId]; result: void }
  /** 가져올 파일/폴더 선택 대화상자. 취소면 빈 배열 */
  'import:choosePaths': { args: [mode: ChoosePathsMode]; result: string[] }
  /** 파일·폴더 경로들 → 판정 미리보기 (진행률: operation 'analyze') */
  'import:analyze': { args: [paths: string[]]; result: ImportPreview }
  /** 확정 → 복사·검증·카탈로그 기록 (진행률: operation 'commit') */
  'import:commit': { args: [req: ImportCommitRequest]; result: ImportResult }
  /** 진행 중 analyze/commit 취소 (operationId = previewId 또는 batchId). 이미 끝났으면 false */
  'import:cancel': { args: [operationId: string]; result: boolean }
  'import:history': { args: []; result: ImportHistoryEntry[] }
  /** 저장소를 열 때 한 점검·복구 결과 (강제 종료 흔적 정리, 정규화 규칙 갱신). 저장소가 없으면 null */
  'store:maintenance': { args: []; result: StoreMaintenanceReport | null }
  /** 저장된 사본을 이미지 보기용으로 연다 (원본·임의 경로는 받지 않음) */
  'viewer:open': { args: [id: FileId]; result: ViewerOpenResult }
  /**
   * 그룹 진폭 조각 [스캔 범위, 빔, 샘플] int16 + 상태 비트. 조각 하나 32 MB 이하 (shared/imaging chunkRanges)
   * key = viewer:open 의 ViewerOpenResult.key. 그사이 저장소·파일이 바뀌어 지금 키와 다르면 CONFLICT
   */
  'viewer:chunk': {
    args: [id: FileId, key: string, groupId: number, scanStart: number, scanCount: number]
    result: ViewerVolumeChunk
  }
  /**
   * C-scan 을 OmniPC 꼴 .txt 로 (X8): main 저장 대화상자(기본 이름 `<자료파일>_YYYY_MM_DD HHhMMmSSs.txt`) → 고른 경로에만 쓴다.
   * 취소면 null. 저장소 폴더 안·원본 데이터 폴더(가져온 원본 폴더 아래, 측정 원본이 바로 든 폴더)에는 쓰지 않는다(INVALID_ARGUMENT).
   * 고른 이름에 '.txt' 를 붙였는데 그 파일이 이미 있으면 덮지 않는다(CONFLICT — 대화상자가 덮어쓰기를 묻지 않은 이름)
   */
  'viewer:exportCscan': { args: [request: ViewerCscanExportRequest]; result: ViewerCscanExportResult | null }
  /**
   * 사용자 OmniPC 색표(.pal) 불러오기 (L2): main 열기 대화상자(기본 위치 문서/Evident/OmniPC/Palette) → 읽어서 검사(XML 판 2.0·줄 형식,
   * 256색 + 특수색 0·3개). 취소면 null, 형식이 틀리면 INVALID_ARGUMENT. 색표 파일은 앱에 묶지 않는다
   */
  'viewer:openPalette': { args: []; result: ViewerPaletteFile | null }

  // ── 결함 라벨 (가져오기 작업 잠금과 무관하게 동작. 라벨 작업 중에는 저장소를 바꿀 수 없음) ──
  /** 이 PC ID(없으면 만듦)·지금 라벨러·2인 모드·등록된 라벨러 */
  'labels:session': { args: []; result: LabelSession }
  /** 지금 라벨러 고르기(등록된 ID 만)·2인 모드·PC ID 바꾸기 */
  'labels:setSession': { args: [patch: LabelSessionPatch]; result: LabelSession }
  /** 라벨러 추가(없으면)·고치기(이름·자격·기관). 지금 라벨러로 고르지는 않는다 */
  'labels:registerLabeler': { args: [info: LabelerInfo, options?: LabelerRegisterOptions]; result: LabelerInfo }
  /** 파일별 라벨 현황 (2인 모드면 지금 라벨러 세트만) */
  'labels:overview': { args: []; result: LabelOverview }
  'labels:listSets': { args: [query?: { fileId?: FileId; sha256?: string }]; result: LabelSetInfo[] }
  'labels:listRecords': { args: [query?: LabelRecordListQuery]; result: IndicationRecord[] }
  /** 새로 만들기·고치기. versions 는 읽은 값 그대로 (그사이 바뀌었으면 CONFLICT). 겹치는 검토 완료 구간은 풀림 */
  'labels:saveRecord': { args: [record: IndicationRecord]; result: LabelRecordSaveOutcome }
  /** 삭제 표시 */
  'labels:deleteRecord': { args: [uuid: string]; result: LabelRecordSaveOutcome }
  'labels:listObservations': { args: [query?: LabelObservationListQuery]; result: ObservationRow[] }
  'labels:saveObservation': { args: [row: ObservationRow]; result: LabelSaveOutcome<ObservationRow> }
  'labels:deleteObservation': { args: [recordUuid: string, groupId: number, leg: number]; result: LabelSaveOutcome<ObservationRow> }
  'labels:listReviews': { args: [query?: LabelReviewListQuery]; result: ReviewInterval[] }
  'labels:saveReview': { args: [interval: ReviewInterval]; result: LabelSaveOutcome<ReviewInterval> }
  'labels:deleteReview': { args: [uuid: string]; result: LabelSaveOutcome<ReviewInterval> }
  /** 작업 이벤트 추가 (추가 전용) */
  'labels:appendWorkEvent': { args: [event: WorkEventInput]; result: WorkEvent }
  /** 엑셀 파일 고르기 대화상자. 취소면 null */
  'labels:chooseWorkbook': { args: []; result: string | null }
  /** 엑셀 읽기 → 미리보기 (저장하지 않음) */
  'labels:previewWorkbook': { args: [path: string, options?: LabelWorkbookOptions]; result: LabelWorkbookPreview }
  /** 미리보기 확정 → 저장 (오류가 있으면 INVALID_ARGUMENT, 만료면 PREVIEW_EXPIRED) */
  'labels:commitWorkbook': { args: [previewId: string]; result: LabelWorkbookCommitResult }
  /** 저장 대화상자(기본 이름에 날짜·PC ID) → 고른 경로, 취소면 null. 이 경로만 exportJson 이 받는다 */
  'labels:chooseExportPath': { args: [request: LabelExportRequest]; result: string | null }
  /** chooseExportPath 로 고른 경로에 JSON 쓰기 */
  'labels:exportJson': { args: [request: LabelExportRequest, path: string]; result: LabelExportResult }
  /** 열기 대화상자 → 고른 경로, 취소면 null. 이 경로만 importJson 이 받는다 */
  'labels:chooseJson': { args: []; result: string | null }
  /** chooseJson 으로 고른 라벨 JSON 합치기 → 보고서 */
  'labels:importJson': { args: [path: string]; result: LabelJsonImportResult }
  'labels:listConflicts': { args: [query?: LabelConflictListQuery]; result: LabelConflictInfo[] }
  'labels:resolveConflict': { args: [id: number, choice: LabelConflictChoice]; result: LabelConflictResolveResult }

  // ── 학습 데이터 분할 · 내보내기 (2b) ──
  /** 시편별 분할(train·val·test)·시험 세트 잠금·바꾼 기록 */
  'labels:trainingSplits': { args: []; result: TrainingSplitView }
  /** 분할 바꾸기. 시험 세트가 잠겨 있으면 test 로 넣거나 빼는 변경은 confirmLocked + reason 이 있어야 한다(없으면 CONFLICT) */
  'labels:setTrainingSplits': { args: [changes: TrainingSplitChange[], options?: TrainingSplitOptions]; result: TrainingSplitView }
  /** 시험 세트 잠그기(lock = true)·풀기. 풀 때는 confirmLocked + reason (없으면 CONFLICT) */
  'labels:lockTrainingTest': { args: [lock: boolean, options?: TrainingSplitOptions]; result: TrainingSplitView }
  /** 파일마다 세트 고르기 미리보기 (내보내기 대화상자) */
  'labels:trainingCandidates': { args: [rule: TrainingSetRule]; result: TrainingCandidates }
  /** 학습 데이터를 둘 폴더 고르기 대화상자. 취소면 null. 이 폴더만 exportTraining 이 받는다 */
  'labels:chooseTrainingDir': { args: []; result: string | null }
  /** 고른 폴더 안에 새 폴더('학습데이터_<시각>_<PC>')를 만들어 내보낸다. 오래 걸린다 — 진행률은 trainingStatus, 취소는 cancelTraining */
  'labels:exportTraining': { args: [request: TrainingExportRequest, dir: string]; result: TrainingExportResult }
  /** 진행 중인 학습 데이터 내보내기 (없으면 null) */
  'labels:trainingStatus': { args: []; result: TrainingExportProgress | null }
  /** 진행 중인 내보내기 취소 (이미 끝났거나 다른 ID 면 false) */
  'labels:cancelTraining': { args: [operationId: string]; result: boolean }

  // ── 3단계 검수 (2인 독립 모드에서는 모두 INVALID_ARGUMENT — 검수는 Level III 몫) ──
  /** 검수 탭: 라벨 세트가 있는 파일·세트·분할, 지금 라벨러(확정 라벨러)와 Level III 여부. 2인 모드면 blocked 에 이유 */
  'labels:reviewSources': { args: []; result: ReviewSources }
  /** 두 세트 비교 (shared/labels/review compareLabelSets). 행 = 짝 · A 만 · B 만 */
  'labels:compareSets': { args: [request: ReviewCompareRequest]; result: ReviewComparison }
  /** Level III 결정 → 확정 세트 미리보기 (설계값 대조 포함, 저장하지 않음) */
  'labels:previewFinal': { args: [request: ReviewFinalRequest]; result: ReviewFinalPreview }
  /**
   * 확정 세트 저장 (판독 단계 final, 라벨러 = 지금 라벨러). 한 트랜잭션. 원래 두 세트는 고치지 않는다.
   * 결정하지 않은 행이 있으면 INVALID_ARGUMENT, 그사이 행이 바뀌었으면 CONFLICT,
   * Level III 가 아닌데 confirmNotLevel3 이 없거나 잠긴 시험 세트의 확정 세트를 이유 없이 바꾸면 CONFLICT
   */
  'labels:saveFinal': { args: [request: ReviewFinalRequest, options?: ReviewFinalSaveOptions]; result: ReviewFinalSaveResult }
  /** CSV 저장 대화상자(기본 이름에 종류·날짜·PC ID) → 고른 경로, 취소면 null. 이 경로만 saveReviewCsv 가 받는다 */
  'labels:chooseReviewCsvPath': { args: [request: ReviewCsvRequest]; result: string | null }
  /** 고른 경로에 CSV (UTF-8 BOM, CRLF). 내용은 서비스가 저장소에서 다시 계산한다 */
  'labels:saveReviewCsv': { args: [request: ReviewCsvRequest, path: string]; result: ReviewCsvResult }
  /**
   * 라벨 세트 제출(잠금, submit = true)·풀기(false, 이유 필요). 제출한 세트의 기록·검토 구간·관측 행은 고칠 수 없다(CONFLICT).
   * 지금 라벨러 세트만, 확정 세트는 받지 않는다(INVALID_ARGUMENT)
   */
  'labels:submitSet': { args: [set: LabelSetKey, submit: boolean, options?: LabelSetSubmitOptions]; result: LabelSetSubmitResult }
  /**
   * 블라인드 세트 → 같은 파일·라벨러·지침서의 '설계값 대조' 세트로 복사(새 UUID, 지시 번호 그대로, 설계값 봤음)하고 블라인드 세트를 제출한다.
   * 대조 세트에 이미 기록·구간이 있으면 CONFLICT. 한 트랜잭션
   */
  'labels:startReconcile': { args: [from: LabelSetKey]; result: LabelReconcileResult }
  /** 그 파일 시편의 물리 결함(설계값) — 설계값 대조 단계의 '물리 결함 ID' 고르기. 2인 독립 모드면 막는다 */
  'labels:physicalDefects': { args: [query: { sha256: string }]; result: PhysicalDefect[] }
}

export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** main 쪽 핸들러 표. 값을 반환하거나 AppError 를 던진다 (ApiResult 포장은 IPC 레이어가 한다). */
export type IpcHandlers = {
  [C in IpcChannel]: (...args: IpcArgs<C>) => Promise<IpcResult<C>> | IpcResult<C>
}

// ───────────────────────────── 렌더러 API ─────────────────────────────

type Call<C extends IpcChannel> = (...args: IpcArgs<C>) => Promise<ApiResult<IpcResult<C>>>

export interface PautApi {
  app: {
    info: Call<'app:info'>
  }
  settings: {
    get: Call<'settings:get'>
    set: Call<'settings:set'>
    chooseStoreRoot: Call<'settings:chooseStoreRoot'>
  }
  plans: {
    list: Call<'plans:list'>
    get: Call<'plans:get'>
    rename: Call<'plans:rename'>
    setNote: Call<'plans:setNote'>
  }
  specimens: {
    list: Call<'specimens:list'>
    get: Call<'specimens:get'>
    update: Call<'specimens:update'>
    regroupPreview: Call<'specimens:regroupPreview'>
    regroupApply: Call<'specimens:regroupApply'>
  }
  files: {
    list: Call<'files:list'>
    get: Call<'files:get'>
    update: Call<'files:update'>
    reveal: Call<'files:reveal'>
    /**
     * 드래그앤드롭된 File 의 절대경로 (preload 의 webUtils.getPathForFile). 동기 호출, IPC 아님.
     * 브라우저 mock 에서는 파일 이름만 돌려준다.
     */
    pathForFile: (file: File) => string
  }
  import: {
    choosePaths: Call<'import:choosePaths'>
    analyze: Call<'import:analyze'>
    commit: Call<'import:commit'>
    cancel: Call<'import:cancel'>
    history: Call<'import:history'>
  }
  store: {
    maintenance: Call<'store:maintenance'>
  }
  viewer: {
    open: Call<'viewer:open'>
    chunk: Call<'viewer:chunk'>
    exportCscan: Call<'viewer:exportCscan'>
    openPalette: Call<'viewer:openPalette'>
  }
  labels: {
    session: Call<'labels:session'>
    setSession: Call<'labels:setSession'>
    registerLabeler: Call<'labels:registerLabeler'>
    overview: Call<'labels:overview'>
    listSets: Call<'labels:listSets'>
    listRecords: Call<'labels:listRecords'>
    saveRecord: Call<'labels:saveRecord'>
    deleteRecord: Call<'labels:deleteRecord'>
    listObservations: Call<'labels:listObservations'>
    saveObservation: Call<'labels:saveObservation'>
    deleteObservation: Call<'labels:deleteObservation'>
    listReviews: Call<'labels:listReviews'>
    saveReview: Call<'labels:saveReview'>
    deleteReview: Call<'labels:deleteReview'>
    appendWorkEvent: Call<'labels:appendWorkEvent'>
    chooseWorkbook: Call<'labels:chooseWorkbook'>
    previewWorkbook: Call<'labels:previewWorkbook'>
    commitWorkbook: Call<'labels:commitWorkbook'>
    chooseExportPath: Call<'labels:chooseExportPath'>
    exportJson: Call<'labels:exportJson'>
    chooseJson: Call<'labels:chooseJson'>
    importJson: Call<'labels:importJson'>
    listConflicts: Call<'labels:listConflicts'>
    resolveConflict: Call<'labels:resolveConflict'>
    trainingSplits: Call<'labels:trainingSplits'>
    setTrainingSplits: Call<'labels:setTrainingSplits'>
    lockTrainingTest: Call<'labels:lockTrainingTest'>
    trainingCandidates: Call<'labels:trainingCandidates'>
    chooseTrainingDir: Call<'labels:chooseTrainingDir'>
    exportTraining: Call<'labels:exportTraining'>
    trainingStatus: Call<'labels:trainingStatus'>
    cancelTraining: Call<'labels:cancelTraining'>
    reviewSources: Call<'labels:reviewSources'>
    compareSets: Call<'labels:compareSets'>
    previewFinal: Call<'labels:previewFinal'>
    saveFinal: Call<'labels:saveFinal'>
    chooseReviewCsvPath: Call<'labels:chooseReviewCsvPath'>
    saveReviewCsv: Call<'labels:saveReviewCsv'>
    submitSet: Call<'labels:submitSet'>
    startReconcile: Call<'labels:startReconcile'>
    physicalDefects: Call<'labels:physicalDefects'>
  }
  /** 진행률 구독. 반환 함수로 해제 */
  onProgress: (cb: (ev: ProgressEvent) => void) => () => void
}

/** PautApi 의 각 메서드 ↔ IPC 채널 대응표 (preload 가 이 표로 API 를 만든다) */
export const API_CHANNEL_MAP = {
  app: { info: IPC.appInfo },
  settings: { get: IPC.settingsGet, set: IPC.settingsSet, chooseStoreRoot: IPC.settingsChooseStoreRoot },
  plans: { list: IPC.plansList, get: IPC.plansGet, rename: IPC.plansRename, setNote: IPC.plansSetNote },
  specimens: {
    list: IPC.specimensList,
    get: IPC.specimensGet,
    update: IPC.specimensUpdate,
    regroupPreview: IPC.specimensRegroupPreview,
    regroupApply: IPC.specimensRegroupApply
  },
  files: { list: IPC.filesList, get: IPC.filesGet, update: IPC.filesUpdate, reveal: IPC.filesReveal },
  import: {
    choosePaths: IPC.importChoosePaths,
    analyze: IPC.importAnalyze,
    commit: IPC.importCommit,
    cancel: IPC.importCancel,
    history: IPC.importHistory
  },
  store: { maintenance: IPC.storeMaintenance },
  viewer: { open: IPC.viewerOpen, chunk: IPC.viewerChunk, exportCscan: IPC.viewerExportCscan, openPalette: IPC.viewerOpenPalette },
  labels: {
    session: IPC.labelsSession,
    setSession: IPC.labelsSetSession,
    registerLabeler: IPC.labelsRegisterLabeler,
    overview: IPC.labelsOverview,
    listSets: IPC.labelsListSets,
    listRecords: IPC.labelsListRecords,
    saveRecord: IPC.labelsSaveRecord,
    deleteRecord: IPC.labelsDeleteRecord,
    listObservations: IPC.labelsListObservations,
    saveObservation: IPC.labelsSaveObservation,
    deleteObservation: IPC.labelsDeleteObservation,
    listReviews: IPC.labelsListReviews,
    saveReview: IPC.labelsSaveReview,
    deleteReview: IPC.labelsDeleteReview,
    appendWorkEvent: IPC.labelsAppendWorkEvent,
    chooseWorkbook: IPC.labelsChooseWorkbook,
    previewWorkbook: IPC.labelsPreviewWorkbook,
    commitWorkbook: IPC.labelsCommitWorkbook,
    chooseExportPath: IPC.labelsChooseExportPath,
    exportJson: IPC.labelsExportJson,
    chooseJson: IPC.labelsChooseJson,
    importJson: IPC.labelsImportJson,
    listConflicts: IPC.labelsListConflicts,
    resolveConflict: IPC.labelsResolveConflict,
    trainingSplits: IPC.labelsTrainingSplits,
    setTrainingSplits: IPC.labelsSetTrainingSplits,
    lockTrainingTest: IPC.labelsLockTrainingTest,
    trainingCandidates: IPC.labelsTrainingCandidates,
    chooseTrainingDir: IPC.labelsChooseTrainingDir,
    exportTraining: IPC.labelsExportTraining,
    trainingStatus: IPC.labelsTrainingStatus,
    cancelTraining: IPC.labelsCancelTraining,
    reviewSources: IPC.labelsReviewSources,
    compareSets: IPC.labelsCompareSets,
    previewFinal: IPC.labelsPreviewFinal,
    saveFinal: IPC.labelsSaveFinal,
    chooseReviewCsvPath: IPC.labelsChooseReviewCsvPath,
    saveReviewCsv: IPC.labelsSaveReviewCsv,
    submitSet: IPC.labelsSubmitSet,
    startReconcile: IPC.labelsStartReconcile,
    physicalDefects: IPC.labelsPhysicalDefects
  }
} as const satisfies { [K in keyof PautApi]?: Record<string, IpcChannel> }

declare global {
  interface Window {
    /** Electron preload 가 노출. 브라우저(dev:web)에서는 없음 → mock 사용 */
    pautApi?: PautApi
  }
}
