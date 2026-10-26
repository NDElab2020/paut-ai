/**
 * 라벨 엑셀 가져오기의 입력 문맥·결과 타입.
 */
import type {
  FileAlignment,
  IndicationRecord,
  LabelSetKey,
  LabelerInfo,
  PhysicalDefect,
  ReaderSource,
  ReadingStage,
  ReviewInterval,
  ScanGroupCode,
  WorkEvent
} from '@shared/labels'

/** 그룹 기법 (엑셀 '그룹' 칸의 기법 부분과 견줌) */
export type GroupTechnique = 'sectorial' | 'linear' | 'compound' | 'other'

/** 앱이 아는 파일의 그룹 하나 */
export interface LabelWorkbookGroup {
  /** 파일 안 그룹 id (기록의 groupId) */
  id: number
  /** 파일 안 그룹 이름 ('Skew90') — 문구용 */
  name: string
  /**
   * 기법. 'sectorial' | 'linear' | 'compound' 또는 ViewerTechnique('pa-sectorial' …)·BeamFormation 글자 그대로.
   * groupTechniqueOf() 로 읽는다.
   */
  technique: string
  /** 빔 진행 스큐 (°, 90 = +V 쪽 · 270 = −V 쪽). 모르면 null (그 그룹은 엑셀 그룹과 짝짓지 않음) */
  skewDeg: number | null
  /** 파일 이득 (dB). Ref 추정용 (levels.ts refPctFromSetup) */
  gainDb?: number | null
  /** 기준 이득 (dB, OmniPC 'Ref'). 0 이하이면 모름으로 본다(뷰어와 같음) */
  referenceGainDb?: number | null
  /** 기준 진폭 (%FSH). 없으면 80 */
  referenceAmplitudePct?: number | null
}

/** 앱이 아는 파일 (catalog 의 파일 기록 또는 .nde 를 읽은 결과) */
export interface LabelWorkbookFile {
  sha256: string
  /** 앱에 저장된 파일 이름 — 문구용 */
  fileName?: string | null
  groups: readonly LabelWorkbookGroup[]
  /** 셋업의 시편 두께 (mm). '파일' 시트 두께가 비었을 때 쓰고, 다르면 경고 */
  thicknessMm?: number | null
  /** catalog 시편 ID. '파일' 시트 시편 ID 와 다르면 경고 */
  specimenId?: string | null
  /** 보조 지문 (진폭 데이터 해시 등). 있으면 지시 기록에 넣는다 */
  secondaryFingerprint?: string | null
  /**
   * 그룹을 읽지 못한 이유 (저장된 사본이 없음 등). 있으면 이 파일의 '그룹' 칸 줄은 '그룹이 없음' 대신 이 이유로 오류가 된다
   * (사용자가 엑셀의 그룹 칸이 틀렸다고 오해하지 않게)
   */
  groupsError?: string | null
  /** 같은 이름 파일이 둘 이상일 때 고르기 쉽게 보여 줄 설명 ('SP001 · PL23833 · 2026-10-02 가져옴') */
  label?: string | null
}

export interface LabelWorkbookContext {
  /**
   * 엑셀에 적힌 파일명 → 앱이 아는 파일들. 파일명은 저장된 원본 파일명이거나 장비 원본 파일명(ModelSetup SaveFileName)일 수 있다
   * (makeFileFinder 가 둘 다 받게 만든다). 없으면 빈 목록, 같은 이름이 둘 이상이면 모두.
   */
  findFiles(name: string): readonly LabelWorkbookFile[]
  /** '파일' 시트 SHA-256 칸으로 찾기 (선택) */
  findFileBySha256?(sha256: string): LabelWorkbookFile | null
  /** 이 PC 의 ID — 기록의 '마지막으로 고친 PC' */
  pcId: string
  /** 버전 벡터 칸 ('PC ID:복제본 ID') — versions = [{ pcId: 이 값, edits: 1 }]. 없으면 pcId */
  versionSlot?: string
  /** 지금 시각 — createdAt·updatedAt (기록용) */
  now: Date
  /**
   * 결정적 UUID 만들기 (같은 열쇠 → 같은 UUID). 기본은 stableUuid (UUID v5).
   * 무작위 UUID 를 주면 재가져오기 멱등이 깨진다.
   */
  uuid?: (key: string) => string
  /**
   * 같은 기법·스큐 그룹이 한 파일에 둘 이상일 때의 답: GroupQuestion.key → 그룹 id.
   * 답이 없으면 그 줄은 오류이고 groupQuestions 에 물음이 남는다(화면이 묻고 답을 넣어 다시 부른다).
   */
  groupChoices?: Readonly<Record<string, number>>
  /**
   * 엑셀 파일명이 앱의 파일 둘 이상과 맞을 때의 답: FileQuestion.key (fileNameKey) → sha256.
   * 답이 없으면 그 줄은 오류이고 fileQuestions 에 물음이 남는다.
   */
  fileChoices?: Readonly<Record<string, string>>
}

/** 엑셀의 파일명이 앱의 파일 둘 이상과 맞아(SHA-256 칸도 비어) 사람에게 물어야 하는 것 */
export interface FileQuestion {
  /** fileChoices 의 열쇠 = fileNameKey(파일명) */
  key: string
  /** 엑셀에 적힌 파일명 */
  fileName: string
  candidates: Array<{ sha256: string; fileName: string | null; label: string | null }>
  where: string[]
}

/** 같은 기법·스큐 그룹이 둘 이상이라 사람에게 물어야 하는 것 */
export interface GroupQuestion {
  /** groupChoices 의 열쇠 = `${sha256}|${code}` */
  key: string
  sha256: string
  fileName: string
  code: ScanGroupCode
  /** 엑셀에 적힌 값의 표시 이름 ('섹토리얼 Skew 90') */
  label: string
  candidates: Array<{ id: number; name: string }>
  /** 이 물음이 걸린 곳 ('지시' 시트 5행 D열 …) */
  where: string[]
}

/** '판독자' 시트 한 줄 */
export interface ImportedReader extends LabelerInfo {
  readingStage: ReadingStage
  guidelineVersion: string
  readerSource: ReaderSource
}

/** 양식 문서 속성 (생성기가 적은 값) */
export interface LabelFormInfo {
  labelForm: string | null
  schemaVersion: string | null
  /** 양식을 만들 때의 칸 지문 */
  fingerprint: string | null
  /** 지금 앱의 칸 지문 */
  appFingerprint: string
  /** 판독자용(블라인드) 양식에서 나온 파일인지 */
  blind: boolean | null
  /** 양식 종류의 판독 단계 (blind / reconciled) — 실제 단계는 '판독자' 시트 */
  templateStage: string | null
}

export interface LabelWorkbookImport {
  /** 오류가 하나도 없음. false 면 저장하지 않는다(나머지 값은 미리보기용) */
  ok: boolean
  labeler: ImportedReader | null
  /** 이 엑셀이 담은 라벨 세트 ('지시'·'검토구간'·'작업시간' 시트에 줄이 있는 파일마다) */
  labelSets: LabelSetKey[]
  alignments: FileAlignment[]
  records: IndicationRecord[]
  reviews: ReviewInterval[]
  physicalDefects: PhysicalDefect[]
  events: WorkEvent[]
  groupQuestions: GroupQuestion[]
  fileQuestions: FileQuestion[]
  /** errors 가운데 물음(그룹·파일)에서 난 것의 수 — 화면에서 고르면 풀린다 */
  questionErrors: number
  /** 파일(sha256)을 어떻게 맞췄나: SHA-256 칸 / 이름 하나뿐 / 화면에서 고름 (이름만으로 맞춘 파일은 미리보기에서 확인) */
  fileMatch?: Record<string, 'sha256' | 'name' | 'choice'>
  form: LabelFormInfo
  /** 시트·행·칸 위치를 붙인 한국어 */
  errors: string[]
  warnings: string[]
}
