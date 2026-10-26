/**
 * PAUT 데이터 관리 — 공유 데이터 계약.
 * main / preload / renderer / core 모두 이 타입만 주고받는다. (런타임 의존성 없음)
 *
 * 단위 규약: NDE 파일은 SI(m, s, Hz)지만 계약 타입은 사람이 읽는 단위로 정규화한다.
 *   길이 = mm, 각도 = deg(°), 주파수 = MHz, 음속 = m/s, 게인 = dB, 시간 = µs.
 *   필드 이름 끝에 단위를 붙인다 (thicknessMm, skewDeg, centralFrequencyMHz ...).
 * 날짜 규약: ISO 8601 문자열, 시간대 포함, 콜론 있는 형식 ("2024-09-03T10:32:26+09:00").
 * 경로 규약: storeRoot 기준 상대경로는 항상 '/' 구분자(POSIX)로 저장한다. 절대경로는 OS 원래 형식.
 */

// ───────────────────────────── 식별자 ─────────────────────────────

/** 스캔플랜 ID. 'SP' + 3자리 이상 숫자 (SP001, SP002, ..., SP1000). 한 번 정해지면 변하지 않으며 폴더명으로 쓴다. */
export type PlanId = string
/** 시편 ID. 폴더명으로 쓰이므로 파일시스템 안전 문자만 (sanitizeSpecimenId 참고). 예: 'PL23833' */
export type SpecimenId = string
/** 카탈로그 파일 레코드 ID (SQLite rowid). */
export type FileId = number
/** 가져오기 배치 ID. 'IMP-20261002-153012-ab12' 형식 문자열. */
export type ImportBatchId = string
/** 스캔플랜 지문. 'fp2:' + sha256 hex (정규화 스펙의 정준 JSON 해시). 'fp2' 는 정규화 규칙 버전(SPEC_VERSION). */
export type Fingerprint = string

export const PLAN_ID_PATTERN = /^SP\d{3,}$/

// ───────────────────────────── NDE 포맷 ─────────────────────────────

/**
 * '3.x'·'4.x' = Evident .nde(HDF5). 'opd' = OmniScan MX2/SX 의 .opd (공개되지 않은 형식을 파일 구조를 따라 읽음 — core/opd).
 * 이미지 보기 계약(shared/imaging/types.ts)의 formatFamily 는 따로 정한다.
 */
export type NdeFormatFamily = '3.x' | '4.x' | 'opd'

export interface NdeFormatVersion {
  /**
   * 파일에 적힌 그대로. 예: '3.3.0', '4.2.0', '4.0.0-Dev'.
   * OPD 는 'OPD · MXU - 4.4R5' (장비 앱 이름 그대로, major·minor·patch = 4.4.5)
   */
  raw: string
  family: NdeFormatFamily
  major: number
  minor: number
  patch: number
  /** '-Dev' 같은 사전공개 꼬리표. 없으면 null */
  preRelease: string | null
}

/** 장비(수집 유닛) 정보. 3.x/4.x 모두 setup.acquisitionUnits[0] 에서 온다. */
export interface DeviceInfo {
  /** 'OmniScanX3', 'OmniScanX4' ... */
  platform: string | null
  /** 'Freedom_32x128' ... */
  model: string | null
  serialNumber: string | null
  /** 수집 유닛 이름 ('MXU' 등) */
  name: string | null
}

/** NDE 파일 자체에서 읽을 수 있는 메타데이터 (해시·크기·경로 제외). NDE 코어가 채운다. */
export interface NdeFileMeta {
  ndeVersion: NdeFormatVersion
  /** 장비가 저장할 때 쓴 원래 파일명. 3.x = /Applications/MXU/ModelSetup <SaveFileName>. 없으면 null */
  deviceFileName: string | null
  device: DeviceInfo
  /** 파일 생성 시각 (3.x 루트 속성 'Date created', 4.x Properties file.creationDate) */
  createdAt: string | null
  modifiedAt: string | null
  /** 생성 앱 (3.x 'Application name'/'Application version', 4.x Properties) */
  application: { name: string | null; version: string | null }
  /** setup.scenario ('General Weld' 등) */
  scenario: string | null
  /**
   * 우리가 만든 읽기 규칙으로 읽은 형식만: 규칙 이름·버전 (OPD = { name: 'opd-structure', version: 1 }).
   * .nde 는 없음. meta_json 안에만 들어가므로 DB 마이그레이션이 필요 없다
   */
  reader?: { name: string; version: number }
}

/** 파일 메타 전체 = NDE 메타 + 파일시스템 정보. */
export interface FileMeta extends NdeFileMeta {
  sha256: string
  sizeBytes: number
  /** 가져오기 당시 원본 절대경로 (원본은 절대 수정하지 않는다) */
  sourcePath: string
  /** 원본 파일명 (확장자 포함) */
  sourceFileName: string
}

// ───────────────────────────── 정규화 셋업 / 스캔플랜 스펙 ─────────────────────────────
// 지문(fingerprint)은 ScanPlanSpec 만으로 계산한다. AcquisitionSummary 는 기록용이며 지문에 들어가지 않는다.

export type SpecimenShape = 'plate' | 'pipe' | 'bar' | 'unspecified' | 'unknown'

export interface CapSpec {
  widthMm: number | null
  heightMm: number | null
}
export interface AngleHeightSpec {
  angleDeg: number | null
  heightMm: number | null
}

/** (a) 용접 형상 */
export interface WeldGeometrySpec {
  /** 'V', 'J', 'U', 'X', 'Square' ... 파일 값 그대로 */
  bevelShape: string | null
  /** 'Symmetric' | 'Left' | 'Right' ... 파일 값 그대로 */
  symmetry: string | null
  weldAngleDeg: number | null
  upperCap: CapSpec | null
  lowerCap: CapSpec | null
  hotPass: AngleHeightSpec | null
  land: { heightMm: number | null } | null
  root: AngleHeightSpec | null
  /** 파일 순서 유지 (층 순서이므로 정렬하지 않음) */
  fills: AngleHeightSpec[]
  materialName: string | null
  /** 파일에서 해석한 덮개 템플릿. 이름을 확인하지 못하면 null (OPD). */
  template?: string | null
  /** 이름 대응을 확인하지 못한 코드도 원값을 보존한다. NDE 에는 없음. */
  templateCode?: number | null
  symmetryCode?: number | null
  /** 용접 중심에서 랜드 면까지의 반 간격 */
  offsetMm?: number | null
  hazWidthMm?: number | null
  /** OPD: 두께에서 핫패스·랜드·루트 높이를 뺀 계산값. 직접 읽은 채움 높이가 아니다. */
  derivedFillHeightMm?: number | null
}

/** (a) 시편·용접 형상 */
export interface SpecimenGeometrySpec {
  shape: SpecimenShape
  thicknessMm: number | null
  /** 배관일 때만 */
  outerRadiusMm: number | null
  /** 배관일 때만. 파일에 값이 없으면 360(전체 원주)으로 본다 */
  angularOpeningDeg: number | null
  materialName: string | null
  weld: WeldGeometrySpec | null
  /**
   * 값은 있지만 '추정'인 칸 (OPD: 파일 코드의 이름을 다른 값 표본 없이 정함). 이 객체 기준 경로 — 'shape' · 'materialName' · 'weld.template'.
   * 화면은 그 값 옆에 '추정'을 붙인다. 파일 코드에서 나온 표시라 지문 묶음을 가르지 않는다. NDE 는 없음(지문 바이트 그대로)
   */
  estimatedFields?: SpecimenEstimatedField[]
}

/** SpecimenGeometrySpec.estimatedFields 칸 이름 */
export type SpecimenEstimatedField = 'shape' | 'materialName' | 'weld.template'

/** 이 칸이 '추정'인가 (SpecimenGeometrySpec.estimatedFields) */
export function isEstimatedSpecimenField(specimen: Pick<SpecimenGeometrySpec, 'estimatedFields'> | null | undefined, field: SpecimenEstimatedField): boolean {
  return !!specimen?.estimatedFields?.includes(field)
}

export type ProbeKind =
  | 'phasedArrayLinear'
  | 'phasedArrayMatrix'
  | 'dualLinear'
  | 'conventionalRound'
  | 'conventionalRectangular'
  | 'other'

/** (b) 탐촉자 모델 */
export interface ProbeSpec {
  model: string | null
  kind: ProbeKind
  centralFrequencyMHz: number | null
  /** 주축 소자 수 (primaryAxis.elementQuantity). 단일 소자 UT 면 1 */
  elementCount: number | null
  /** 소자 피치 = elementLength + elementGap (primaryAxis), mm */
  pitchMm: number | null
}

export type WedgeKind = 'angleBeam' | 'fluidColumn' | 'other'

/** (b) 웨지 모델 */
export interface WedgeSpec {
  /** 웨지 모델 (액주 웨지는 model 이 없으면 name) */
  model: string | null
  kind: WedgeKind
  /** angleBeamWedge(또는 fluidColumn).mountingLocations[해당].wedgeAngle, 3.x 액주는 probe.fluidColumn.wedgeAngle */
  wedgeAngleDeg: number | null
}

/** (c) 탐촉자(웨지) 위치 — wedges[].positioning */
export interface ProbePositionSpec {
  uOffsetMm: number | null
  /** 인덱스 오프셋 (vCoordinateOffset) */
  vOffsetMm: number | null
  /** 0 이상 360 미만으로 정규화 (0 과 360 은 같은 방향) */
  skewDeg: number | null
  /** 스캔면 이름 (positioning.surfaceId → 시편 surfaces[].name: 'Top' | 'Bottom' | 'Outside' | 'Inside'). 모르면 null */
  surface: string | null
}

/** 탐촉자 장착 방향 (wedgeAssociation.orientation). Reverse 면 소자 번호가 뒤집혀 같은 첫 소자라도 빔 출사점이 바뀐다 */
export type ProbeOrientation = 'Normal' | 'Reverse'

export type ProbeRole = 'pulseEcho' | 'pulser' | 'receiver'

/** 그룹이 사용하는 탐촉자 1개 (pitch-catch/ToFD 는 pulser+receiver 2개) */
export interface GroupProbeSpec {
  role: ProbeRole
  probe: ProbeSpec
  /** 파일에 없으면 'Normal' */
  orientation: ProbeOrientation
  wedge: WedgeSpec | null
  position: ProbePositionSpec | null
}

export type Technique = 'PA' | 'UT' | 'TFM' | 'FMC' | 'PWI' | 'ToFD' | 'other'
export type BeamFormation = 'sectorial' | 'linear' | 'compound' | 'none' | 'other'

export interface AngleRangeSpec {
  startDeg: number | null
  stopDeg: number | null
  stepDeg: number | null
}

/** (d) 빔 구성 — 그룹 1개 */
export interface BeamGroupSpec {
  technique: Technique
  formation: BeamFormation
  /** 1-based 가 아니라 파일 값 그대로 (probeFirstElementId) */
  firstElement: number | null
  /** elementAperture */
  aperture: number | null
  /** 선형 스캔 소자 스텝 (linearFormation.elementStep). 섹터면 null */
  elementStep: number | null
  /** 굴절각 범위. 단일 각도면 start=stop, step=null */
  refractedAngle: AngleRangeSpec | null
  focusing: { mode: string | null; distanceMm: number | null }
  /** 'Longitudinal' | 'TransversalVertical' ... 파일 값 그대로 */
  waveMode: string | null
  /** 정준 순서: role 순 → probe.model 순 */
  probes: GroupProbeSpec[]
  /**
   * 기법별 형상 파라미터 (지문에 포함). 예: TFM 경로 모드 'TT', ToFD PCS 'pcsMm'.
   * 키는 camelCase + 단위 접미사, 값은 반올림된 수치나 문자열.
   */
  techniqueParams: Record<string, string | number | boolean | null>
}

/**
 * 정규화 규칙 버전. 규칙이 바뀌면 올리고 지문 접두사도 바꾼다 (fp1 → fp2).
 * v2: 반올림 노이즈 제거, 배관 원주 범위 기본 360°, 탐촉자 장착 방향·스캔면, 스큐 0~360 정규화, 액주 웨지 각,
 *     선형 소자 스텝 반올림, 탠덤 집속, TFM 다중 탐촉자 송수신 역할.
 * 앱이 열리면 이전 버전으로 만든 플랜의 스펙·지문을 보관된 셋업 원문으로 다시 계산한다(core/service/upgrade).
 */
export const SPEC_VERSION = 2 as const

/**
 * 스캔플랜 스펙 = 지문의 입력.
 * groups 는 그룹 이름이 아닌 내용(정준 JSON 문자열)으로 정렬한다.
 * 모든 수치는 허용오차로 반올림된 값이다 (길이 0.1mm, 각도 0.1°, 주파수 0.01MHz).
 */
export interface ScanPlanSpec {
  /** 이 스펙을 만든 정규화 규칙 버전. 새로 만드는 스펙은 SPEC_VERSION */
  specVersion: number
  specimen: SpecimenGeometrySpec
  groups: BeamGroupSpec[]
}

// ── 기록용 수집 설정 (지문 제외) ──

export interface GateSummary {
  name: string
  /** 대표 시작/길이 (빔별 값이 있으면 첫 빔 기준), µs */
  startUs: number | null
  lengthUs: number | null
  thresholdPercent: number | null
  geometry: string | null
}

export interface GroupAcquisitionSummary {
  /** 파일 안 그룹 이름 ('Skew90') — 기록·표시용 */
  groupName: string
  /** ScanPlanSpec.groups 의 정준 순서에서 이 그룹의 인덱스 */
  specGroupIndex: number
  gainDb: number | null
  referenceGainDb: number | null
  velocityMps: number | null
  beamCount: number | null
  digitizingFrequencyMHz: number | null
  tcgEnabled: boolean | null
  gates: GateSummary[]
  /** 스캔축 (UCoordinate) 데이터 크기 */
  scanQuantity: number | null
  scanResolutionMm: number | null
  /** OPD Patch 시작 위치. 없는 형식에서는 생략. */
  scanStartMm?: number | null
  /** OPD 마지막 측정 점. 제외되는 상한에서 간격을 뺀 계산값. */
  scanLastPointMm?: number | null
  /** 인덱스축 (VCoordinate) — 2축 스캔일 때만 */
  indexQuantity: number | null
  indexResolutionMm: number | null
  /** 'calibrated' 상태 이름 목록 */
  calibrations: string[]
}

export interface AcquisitionSummary {
  groups: GroupAcquisitionSummary[]
  encoder: { mode: string | null; stepResolutionPerMm: number | null } | null
  scanPattern: string | null
}

/** NDE 코어의 셋업 정규화 결과 */
export interface NormalizedSetup {
  spec: ScanPlanSpec
  fingerprint: Fingerprint
  acquisition: AcquisitionSummary
  /** 사람이 읽는 한 줄 요약. 예: '판 12 mm · V 개선 · 5L64-A32 ×2 · PA 섹터 40–70°' */
  summary: string
  /** 정규화 중 무시/추정한 항목 (한국어) */
  warnings: string[]
}

/** NDE 코어의 파일 1개 읽기 결과 */
export interface NdeReadResult {
  meta: NdeFileMeta
  setup: NormalizedSetup
}

/** 두 스펙의 차이 1건 (새 플랜일 때 가장 가까운 기존 플랜과 비교) */
export type SpecCategory = 'specimen' | 'probe' | 'position' | 'beam' | 'structure'

export interface SpecDifference {
  category: SpecCategory
  /** 스펙 경로. 예: 'specimen.thicknessMm', 'groups[1].refractedAngle.stopDeg', 'groups.length' */
  path: string
  /** 한국어 라벨. 예: '두께', '굴절각 끝', '그룹 수' */
  label: string
  existing: string | number | boolean | null
  incoming: string | number | boolean | null
}

// ───────────────────────────── 카탈로그 엔터티 ─────────────────────────────

export interface ScanPlan {
  id: PlanId
  /** 사람이 붙이는 이름 (DB에만 저장, 폴더명과 무관) */
  name: string
  note: string
  fingerprint: Fingerprint
  spec: ScanPlanSpec
  summary: string
  createdAt: string
  updatedAt: string
  fileCount: number
  specimenCount: number
  /** 이 플랜 파일 총 크기 */
  totalBytes: number
  lastImportedAt: string | null
}

export type SpecimenIdSource = 'device-filename' | 'filename' | 'manual'

/** 시편은 전역 엔터티. 같은 시편이 여러 플랜으로 스캔될 수 있으므로 플랜 소속은 파일을 통해 정해진다. */
export interface Specimen {
  id: SpecimenId
  displayName: string
  source: SpecimenIdSource
  note: string
  createdAt: string
}

/** 목록 표시용 시편 (집계 포함). specimens.list(planId) 이면 개수는 그 플랜 안에서만 센다. */
export interface SpecimenSummary extends Specimen {
  planIds: PlanId[]
  fileCount: number
  /** 이 시편 파일들의 상태 태그 모음 (중복 제거) */
  stateTags: string[]
  lastImportedAt: string | null
}

export interface FileRecord {
  id: FileId
  planId: PlanId
  specimenId: SpecimenId
  /** storeRoot 기준 POSIX 상대경로: '스캔플랜/SP001/PL23833/12T-SV-01-Cap on.nde' */
  storedRelPath: string
  storedFileName: string
  meta: FileMeta
  /** 시편 상태 태그 ('Cap on', 'Cap off'). 플랜·시편 ID와 무관 */
  stateTag: string | null
  /** 자유 태그 */
  tags: string[]
  /** 회차 (같은 시편 반복 스캔 번호). 모르면 null */
  round: number | null
  memo: string
  /** 기록용 수집 설정 요약 (게인 등) */
  acquisition: AcquisitionSummary
  importBatchId: ImportBatchId
  importedAt: string
}

// ───────────────────────────── 가져오기 ─────────────────────────────

/**
 * missing-copy = 카탈로그에는 같은 SHA-256 파일이 있는데 저장소의 사본이 없거나 크기가 다름 → 확정 때 같은 자리로 다시 복사(복원)
 */
export type ImportVerdict = 'match-existing' | 'new-plan' | 'duplicate' | 'missing-copy' | 'unsupported' | 'error'

export const IMPORT_VERDICTS: readonly ImportVerdict[] = [
  'match-existing',
  'new-plan',
  'duplicate',
  'missing-copy',
  'unsupported',
  'error'
]

/** 저장 경로(절대)가 이 길이를 넘으면 경고 (윈도우 MAX_PATH 260자, 탐색기·외부 프로그램 기준) */
export const STORE_PATH_WARN_LENGTH = 240

/** 가져올 수 있는 확장자 (소문자). .opd 는 공개되지 않은 형식을 파일 구조를 따라 읽는다(core/opd) */
export const SUPPORTED_EXTENSIONS: readonly string[] = ['.nde', '.opd']
/** 목록에 '보류(미지원)'으로 표시만 하는 확장자. 그 외 확장자는 조용히 무시(ignoredCount) */
export const UNSUPPORTED_EXTENSIONS: Readonly<Record<string, string>> = {
  '.oud': 'MX .oud 형식은 보류(미지원)입니다.',
  '.wkb': '스캔플랜 설계 파일(.wkb)은 추후 매칭 기능에서 지원합니다.'
}

/**
 * OPD 플랜 표시: BeamGroupSpec.techniqueParams.dataFormat 값. 지문에 들어가므로 OPD 플랜은 NDE 플랜과 섞이지 않는다.
 * (OPD 는 재질·개선 모양 등을 몰라 null 로 두므로, 이 표시가 없으면 우연히 같은 값의 NDE 플랜과 묶일 수 있다)
 */
export const OPD_DATA_FORMAT = 'opd'

/**
 * 미리보기·파일 상세에서 OPD 를 가리키는 짧은 표시: 공개되지 않은 데이터 파일 형식을 우리가 파일 구조를 따라 해석했고(자체 해석),
 * OmniPC 화면과 정확도 대조를 마치기 전(대조 전)이라는 뜻. 화면 글자에 '역설계'는 쓰지 않는다(사용자·법률 검토 전)
 */
export const OPD_FORMAT_LABEL = 'OPD · 자체 해석 · 대조 전'

/** 플랜 목록·상세의 OPD 태그 */
export const OPD_PLAN_TAG = 'OPD · 대조 전'

/** 미리보기 항목에 보이는 한 줄 (툴팁이 아니라 글자로) */
export const OPD_ACCURACY_NOTE = '정확도 대조 전 — 자동 변환·학습 내보내기 막힘 (라벨은 됨)'

/** OPD 에서 만든 스캔플랜 스펙인지 (그룹 중 하나라도 dataFormat 'opd') */
export function isOpdSpec(spec: Pick<ScanPlanSpec, 'groups'> | null | undefined): boolean {
  return !!spec?.groups?.some((g) => g.techniqueParams?.['dataFormat'] === OPD_DATA_FORMAT)
}

/** OPD 파일 메타인지 */
export function isOpdMeta(meta: Pick<NdeFileMeta, 'ndeVersion'> | null | undefined): boolean {
  return meta?.ndeVersion?.family === 'opd'
}

export interface DuplicateRef {
  /** 이미 카탈로그에 있는 파일 */
  fileId?: FileId
  planId?: PlanId
  specimenId?: SpecimenId
  storedRelPath?: string
  /** 같은 배치 안 앞선 항목과 동일한 경우 */
  inBatchItemId?: string
}

export interface NearestPlanDiff {
  planId: PlanId
  planName: string
  differences: SpecDifference[]
  /** 차이가 모두 반올림 허용오차(0.1 mm · 0.1° · 0.01 MHz) 이내 → 같은 플랜일 가능성이 높음 */
  withinTolerance: boolean
}

/** 파일 1개 판정 */
export interface ImportItemPreview {
  /** 미리보기 안에서 고유 ('i0001'...). commit 요청에서 이 값으로 참조 */
  itemId: string
  sourcePath: string
  fileName: string
  sizeBytes: number
  /** unsupported/일부 error 면 null */
  sha256: string | null
  verdict: ImportVerdict
  meta: FileMeta | null
  setup: NormalizedSetup | null
  /** verdict = match-existing */
  matchedPlanId: PlanId | null
  /** verdict = new-plan: 같은 배치에서 지문이 같은 항목은 같은 key → 새 플랜 1개 */
  newPlanKey: string | null
  /** verdict = new-plan 이고 기존 플랜이 1개 이상일 때 */
  nearestPlan: NearestPlanDiff | null
  /** verdict = duplicate / missing-copy (missing-copy 는 복원할 기존 레코드) */
  duplicateOf: DuplicateRef | null
  suggestedSpecimenId: string | null
  suggestedSpecimenSource: SpecimenIdSource | null
  /** 파일명에서 찾은 상태 태그 ('Cap on' / 'Cap off') */
  suggestedStateTag: string | null
  /** 파일명에서 찾은 회차 */
  suggestedRound: number | null
  /** verdict = unsupported */
  unsupportedReason: string | null
  /** verdict = error (한국어) */
  errorMessage: string | null
  /** 판정과 별개인 주의 사항 (예: 저장 경로가 너무 김) */
  warnings: string[]
}

export interface NewPlanCandidate {
  key: string
  fingerprint: Fingerprint
  spec: ScanPlanSpec
  summary: string
  /** 다음에 배정될 예정 ID (확정은 commit 시) */
  provisionalPlanId: PlanId
  suggestedName: string
  itemIds: string[]
  nearestPlan: NearestPlanDiff | null
}

export interface ImportPreview {
  previewId: string
  createdAt: string
  storeRoot: string
  /** 사용자가 넣은 경로 (파일·폴더) */
  inputPaths: string[]
  items: ImportItemPreview[]
  newPlans: NewPlanCandidate[]
  counts: Record<ImportVerdict, number>
  /** 숨김 폴더/파일로 건너뛴 수 */
  skippedHiddenCount: number
  /** 관련 없는 확장자로 무시한 수 */
  ignoredCount: number
  /** 저장소 폴더(사본)라서 탐색하지 않은 경로 수 — 원본 폴더 안에 저장소가 있을 때 */
  skippedStoreCount: number
  /** 읽을 수 없어 건너뛴 하위 폴더·파일 */
  unreadablePaths: string[]
  elapsedMs: number
}

export interface CommitNewPlan {
  key: string
  name: string
  note?: string
}

export interface CommitItem {
  itemId: string
  /** false 면 건너뜀 */
  include: boolean
  specimenId: SpecimenId
  specimenSource: SpecimenIdSource
  specimenDisplayName?: string
  stateTag: string | null
  round: number | null
  memo: string
  tags?: string[]
}

/** 사용자가 미리보기 화면에서 확정한 내용 */
export interface ImportCommitRequest {
  previewId: string
  newPlans: CommitNewPlan[]
  /** match-existing / new-plan 항목만 의미 있음. 나머지 판정은 무시된다 */
  items: CommitItem[]
}

export type ImportItemStatus =
  | 'copied'
  /** 사라진 사본을 다시 복사해 기존 레코드에 연결 */
  | 'restored'
  | 'skipped-duplicate'
  | 'skipped-excluded'
  | 'skipped-unsupported'
  | 'failed'

export interface ImportItemResult {
  itemId: string
  fileName: string
  status: ImportItemStatus
  fileId: FileId | null
  planId: PlanId | null
  specimenId: SpecimenId | null
  storedRelPath: string | null
  errorMessage: string | null
}

export interface ImportResult {
  batchId: ImportBatchId
  /** cancelled 면 남은 항목은 건너뛰었고 copiedCount 개만 저장소에 들어갔다 */
  status: ImportBatchStatus
  startedAt: string
  finishedAt: string
  createdPlanIds: PlanId[]
  createdSpecimenIds: SpecimenId[]
  /** 복사(copied) + 복원(restored) */
  copiedCount: number
  skippedCount: number
  failedCount: number
  items: ImportItemResult[]
}

/** interrupted = 앱이 강제 종료되는 등으로 끝나지 않은 배치 (다음 실행 때 복구 단계가 닫는다) */
export type ImportBatchStatus = 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted'

export interface ImportHistoryEntry {
  batchId: ImportBatchId
  startedAt: string
  finishedAt: string | null
  status: ImportBatchStatus
  inputPaths: string[]
  totalItems: number
  copiedCount: number
  skippedCount: number
  failedCount: number
  createdPlanIds: PlanId[]
  /** 복사된 바이트 합계 */
  totalBytes: number
}

// ───────────────────────────── 설정 · 진행률 · 앱 정보 ─────────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  settingsVersion: 1
  /** 저장소 루트 (절대경로). 아직 고르지 않았으면 null */
  storeRoot: string | null
  theme: ThemePreference
  /** 가져오기 대화상자 마지막 위치 */
  lastImportDir: string | null
  /** 새 플랜 이름 제안 규칙: {name} 짧은 이름('12T · 5MHz · SK90/270'), {summary} 요약, {id} 예정 ID */
  newPlanNameTemplate: string
  /**
   * 이 PC 의 ID (라벨 버전 벡터의 칸, 라벨 내보내기 파일 머리). 라벨 기능을 처음 쓸 때 앱이 만든다('pc-' + 16진수 8자리).
   * 글자·숫자·'.'·'_'·'-' 만, 32자 이하(PC_ID_PATTERN). 다른 PC 와 같으면 안 된다. null = 아직 없음
   */
  pcId: string | null
  /** 지금 라벨러 ID (라벨 관리에서 고름, 등록된 라벨러). null = 고르지 않음 */
  labelerId: string | null
  /** 2인 독립 라벨 모드: 켜면 지금 라벨러의 라벨 세트만 보이고 다른 라벨러 기록은 고칠 수 없다 */
  labelBlindMode: boolean
  /** 라벨 엑셀·JSON 대화상자 마지막 위치 */
  lastLabelDir: string | null
}

/** PC ID 형식: 글자·숫자로 시작, 글자·숫자·'.'·'_'·'-', 32자 이하 (파일 이름에도 들어간다) */
export const PC_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,31}$/u

export const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: 1,
  storeRoot: null,
  theme: 'system',
  lastImportDir: null,
  newPlanNameTemplate: '{name}',
  pcId: null,
  labelerId: null,
  labelBlindMode: false,
  lastLabelDir: null
}

export type ProgressOperation = 'analyze' | 'commit'
export type ProgressPhase = 'scan' | 'read' | 'hash' | 'match' | 'copy' | 'verify' | 'catalog' | 'done'

export interface ProgressEvent {
  operation: ProgressOperation
  /** analyze = previewId, commit = batchId */
  operationId: string
  phase: ProgressPhase
  /** 처리한 파일 수 / 전체 (scan 단계는 total 미정이면 0) */
  current: number
  total: number
  /** 복사 중 바이트 진행 (copy 단계) */
  bytesDone?: number
  bytesTotal?: number
  fileName?: string
  message?: string
}

export interface AppInfo {
  appName: string
  version: string
  platform: 'win32' | 'darwin' | 'linux' | 'web'
  electron: string | null
  node: string | null
  /** 카탈로그 DB 경로 (storeRoot 없으면 null) */
  catalogPath: string | null
  /** 브라우저 mock 으로 실행 중이면 true */
  mock: boolean
}

/**
 * 저장소를 열 때 하는 점검·복구 결과. 강제 종료 흔적 정리와 정규화 규칙 갱신.
 * 경로는 저장소 기준 POSIX 상대경로.
 */
export interface StoreMaintenanceReport {
  checkedAt: string
  /** 끝나지 않은 가져오기 배치를 '중단됨'으로 닫은 수 */
  interruptedBatchCount: number
  /** 지운 복사 임시 파일(.partial) 수 */
  removedPartialCount: number
  /** 카탈로그에 없어 '미등록_파일/…' 로 옮긴 사본 */
  quarantined: Array<{ from: string; to: string }>
  quarantineDir: string | null
  /** 새 정규화 규칙으로 스펙·지문을 다시 계산한 플랜 */
  upgradedPlanIds: PlanId[]
  /** 다시 계산하지 못한 플랜과 이유 */
  upgradeProblems: string[]
  /** 읽거나 옮기지 못한 경로 */
  problems: string[]
}

/** 저장소 레이아웃 상수 (폴더명은 한국어 고정) */
export const STORE_LAYOUT = {
  plansDir: '스캔플랜',
  catalogFile: 'catalog.db',
  /** 복사 중 임시 파일 접미사 (검증 후 rename) */
  partialSuffix: '.partial',
  /** 저장소 점검이 카탈로그에 없는 사본을 옮기는 폴더 */
  quarantineDir: '미등록_파일'
} as const
