/**
 * 결함 라벨 기록 스키마 v1 — 공유 계약 (main · renderer · 테스트 공용, 런타임 의존성 없음).
 * 근거: 계획_라벨링/규격_초안.md 1·2절, 계획_라벨링/계획.md 6절(2026-10-06 추천안 확정).
 * 검토 반영(2026-10-06): 판독 단계·버전 목록(병합 충돌 판정)·높이 '노정 시간'·표면/점 지시 분리 등.
 *
 * 원칙
 * - 원본 라벨은 mm 결함 기록이다. 학습용 박스·세 상태(양성·무시·음성) 라벨은 이 기록에서 앱이 만든다(여기 없음).
 * - 앱에서 찍은 점은 원자료 앵커(그룹·스캔 칸·빔·샘플)로도 남긴다. 좌표 규칙이 바뀌면 기록을 버리지 않고
 *   앵커에서 다시 계산한 뒤 '재확인 필요'를 붙인다(후처리 설정의 '규칙이 다르면 폐기'와 다름).
 * - 엑셀(OmniPC 판독)에서 온 기록은 앵커 없이 mm 만 있다(coordSource = 'imported-mm').
 * - 파일과는 sha256 문자열로만 잇는다(FK 없음). 로컬에 없는 파일의 기록도 보관한다.
 * - 라벨 세트 = (sha256, 라벨러 ID, 지침서 버전, 판독 단계). 같은 사람의 블라인드 기록과 대조 기록은 다른 세트다.
 *   2인 독립 라벨 중에는 다른 라벨러 세트를 숨긴다.
 *
 * 단위 규약: 길이 mm, 각도 °, 진폭 %FSH(파일 이득 그대로 = 소프트 이득 0 dB), 이득 dB, 시간 µs.
 * 필드 이름 끝에 단위를 붙인다(scanStartMm, angleDeg, maxAmplitudePct …).
 *
 * 병합 순서 (versions.ts)
 * - 시각(ISO 8601, 시간대 포함)은 기록용이다. 폐쇄망 PC 는 시계가 어긋날 수 있어 병합·충돌 판단에 쓰지 않는다.
 * - 고칠 수 있는 단위마다 versions(PC 마다 그 PC 에서 고친 횟수 목록, '버전 벡터')를 둔다. 고칠 때 자기 PC 의 횟수를 1 올린다.
 * - 같은 UUID 의 두 사본 A·B: 모든 PC 에서 A 의 횟수 ≥ B 의 횟수이면 A 가 B 를 포함한다(A 가 새것).
 *   어느 쪽도 다른 쪽을 포함하지 않으면 양쪽에서 따로 고친 것이라 '충돌'로 둘 다 남긴다.
 *   횟수가 모두 같은데 내용이 다르면 그것도 충돌이다(같은 PC ID 를 두 곳에서 쓴 경우).
 * - revision 은 고친 횟수의 합(표시용)이다. 순서 판단은 versions 로만 한다.
 *
 * 모든 칸은 늘 들어 있다. 값이 없으면 null(선택 칸) 또는 빈 목록이다.
 * 이 파일에 없는 칸(새 버전 앱이 더한 칸)은 가져올 때 버리지 않고 그대로 보존한다(validate.ts).
 */
import { POST_RULES_VERSION } from '../imaging/postprocess'

// ───────────────────────────── 버전 ─────────────────────────────

/** 기록 스키마 버전. 칸의 뜻이나 필수 여부가 바뀌면 올린다. 더 새 버전 파일은 가져오지 않는다 */
export const LABEL_SCHEMA_VERSION = 1

/** 내보내기 파일 머리의 형식 이름 */
export const LABEL_EXPORT_FORMAT = 'paut-labels'

/**
 * 좌표 규칙 버전 (앵커 → mm 계산 규칙).
 * shared/imaging/postprocess.ts 의 POST_RULES_VERSION 이 곧 좌표 규칙(coords.ts 2절)의 버전이라 그대로 쓴다.
 * 두 쪽이 같은 좌표 함수를 쓰므로 버전 번호도 하나로 둔다. 다만 규칙이 바뀌었을 때의 처리는 다르다:
 * 후처리 보기 설정은 버리고, 라벨 기록은 앵커에서 다시 계산한 뒤 '재확인 필요'를 붙인다.
 * 주의: 후처리 형식만 바뀌어 POST_RULES_VERSION 이 오르면 좌표가 같아도 모든 앵커 기록에 '재확인 필요'가 붙는다.
 * 뷰어 작업이 끝나면 coords.ts 에 좌표 전용 버전을 두고 두 상수가 그것을 쓰게 나눌 것(조정 세션).
 */
export const LABEL_COORD_RULES_VERSION: number = POST_RULES_VERSION

// ───────────────────────────── 식별자 ─────────────────────────────

/** 원본 .nde 파일 전체의 SHA-256. 소문자 16진수 64자 */
export type Sha256Hex = string
/** 기록 UUID. 소문자 8-4-4-4-12 (crypto.randomUUID) */
export type Uuid = string
/** ISO 8601 시각, 시간대 포함 ('2026-10-06T14:05:00+09:00'). 기록용 — 순서 판단에 쓰지 않음 */
export type IsoDateTime = string
/** 라벨러 ID. 설정에 등록한 짧은 이름 ('kim-l2') */
export type LabelerId = string
/** 물리 결함 ID. 시편 안에서 유일 ('D1', 'TP03-1') */
export type PhysicalDefectId = string

/** PC 하나에서 고친 횟수 (버전 벡터의 한 칸). pcId 순서로 정렬해 저장한다 */
export interface VersionEntry {
  pcId: string
  /** 1 이상 */
  edits: number
}

// ───────────────────────────── 열거값 (코드·한국어 이름은 codes.ts) ─────────────────────────────

/** 데이터 출처: 실측 / 시뮬레이션 / 합성 삽입 */
export type DataOrigin = 'measured' | 'simulated' | 'synthetic'
/** 설계값 출처: 제작사 결함 보고서 / 설계도 / PCN 시트(1인 판독) / 없음 */
export type DesignSource = 'manufacturer-report' | 'design-drawing' | 'pcn-sheet' | 'none'
/** 확인 수준: 미확인 / 설계만 / 제작 기록 / RT / 절단. 작성자·근거를 모르는 문서는 '미확인' */
export type ConfirmationLevel = 'unknown' | 'design-only' | 'fabrication-record' | 'rt' | 'sectioning'
/** 판독 출처: 우리 전문가 / 전문기관 / AI. 세 출처가 같은 표를 쓴다 */
export type ReaderSource = 'expert' | 'agency' | 'ai'
/**
 * 판독 단계 (평가_정의_v1.md 2절): 블라인드(설계값 안 봄) / 설계값 대조(설계값을 보고 고치거나 더함, 학습 세트의
 * 공개 판독 포함) / 확정(Level III 조정 결과 — 라벨러 ID = 조정한 Level III).
 */
export type ReadingStage = 'blind' | 'reconciled' | 'final'
/** 기록 구분: 결함 / 형상 에코(정상 기하) / 형상 불완전 */
export type RecordKind = 'defect' | 'geometric-echo' | 'geometric-imperfection'
/** 앵커 점의 역할 */
export type AnchorRole =
  | 'peak'
  | 'tip-top'
  | 'tip-bottom'
  | 'tip'
  | 'surface'
  | 'drop-top'
  | 'drop-bottom'
  | 'length-start'
  | 'length-end'
  | 'rect-a'
  | 'rect-b'
  | 'other'
/** 좌표 출처: 앱에서 찍음(앵커 있음) / 엑셀 등에서 가져온 mm(앵커 없음) */
export type CoordSource = 'app-anchor' | 'imported-mm'
/** 확신도: 확실 / 보통 / 불확실 */
export type Confidence = 'certain' | 'probable' | 'uncertain'
/** 금속학적 종류. 세부를 모르면 '… (세부 미상)', 면상·체적도 모르면 '면상 추정' / '체적 추정' */
export type MetallurgicalType =
  | 'crack-root'
  | 'crack-toe'
  | 'crack-sidewall'
  | 'crack-center'
  | 'crack-unspecified'
  | 'lof-sidewall'
  | 'lof-root'
  | 'lof-interrun'
  | 'lof-unspecified'
  | 'incomplete-penetration'
  | 'slag'
  | 'porosity-single'
  | 'porosity-cluster'
  | 'porosity-unspecified'
  | 'planar-presumed'
  | 'volumetric-presumed'
/** 판정 특성(시방서 15절): 면상(균열성) / 체적 */
export type JudgmentCharacter = 'planar' | 'volumetric'
/** 표면(시방서 16.3 표 14 의 h3/h2): 표면 열림 / 내재. '점 같은 지시'는 따로(pointLike) */
export type SurfaceClass = 'surface-breaking' | 'embedded'
/** 위치 구분: 루트 / 측벽 / 캡 / 몸체 / 토우·HAZ */
export type WeldZone = 'root' | 'sidewall' | 'cap' | 'body' | 'toe-haz'
/** 좌우: 왼쪽 / 오른쪽 (가운데이거나 정할 수 없으면 null). 시편에 표시한 L/R 기준 — 파일 V 부호가 아님 */
export type WeldSide = 'L' | 'R'
/** 길이 측정법: 평가 기준 초과 구간(t≥8) / 6 dB 강하 + 곡률 보정(t<8) / 기타 */
export type LengthMethod = 'eval-level' | '6db-curvature' | 'other'
/**
 * 높이 입력 방식. 시방서 15절 방법: 상하 팁 / 팁 + 표면(루트 연결은 두께 + 팁) / 노정 시간(반사·모드 변환).
 * '−6 dB 높이'는 시방서 밖 참고값(학습 참고용)이라 표 14(길이 + 높이) 판정에 쓰지 않는다. 측정 불가.
 */
export type HeightMethod = 'tip-tip' | 'tip-surface' | 'transit-time' | '6db' | 'unmeasurable'
/** 형상 에코 세부: 루트 / 캡 / 모드 변환 / 기타 */
export type GeometricEchoKind = 'root' | 'cap' | 'mode-conversion' | 'other'
/** 형상 불완전 세부: 단차 / 과다용입 / 루트 오목 / 언더컷 */
export type GeometricImperfectionKind = 'misalignment' | 'excess-penetration' | 'root-concavity' | 'undercut'
/** 관측 상태: 보임 / 약함 / 안 보임 */
export type ObservationStatus = 'visible' | 'weak' | 'not-visible'
/** 검토 구간 종류: 검토 완료 / 품질 불량 / 기준 미만 지시 */
export type ReviewIntervalKind = 'reviewed' | 'quality-bad' | 'below-threshold'
/** 품질 불량 사유 (시방서 15절 품질 평가 6항목: 연결 장치·시간 범위·감도·SNR·포화 지시·데이터 획득) */
export type QualityBadReason = 'coupling' | 'missing' | 'saturation' | 'noise' | 'time-range' | 'sensitivity'
/** 작업 이벤트 종류 (판독시간 기준선의 근거) */
export type WorkEventKind =
  | 'session-start'
  | 'session-end'
  | 'file-open'
  | 'file-close'
  | 'record-create'
  | 'record-update'
  | 'record-delete'
  | 'review-complete'
  | 'idle'
  | 'ai-display'
  | 'report'
  | 'label-extra'
/** 작업 도구: 우리 앱 / OmniPC / 기타 */
export type WorkTool = 'app' | 'omnipc' | 'other'
/** 기준점 정의: 판 끝 / 관 12시 / 기타 */
export type DatumKind = 'plate-edge' | 'pipe-12-oclock' | 'other'
/**
 * Skew 90 탐촉자가 놓인 쪽 (빔은 반대쪽, 곧 +V 쪽으로 나아간다). 판: 시편에 표시한 L/R.
 * 관: 상류/하류 — 유동 방향을 모르면 시편에 표시한 '기준 쪽'(예: 도면 시점 쪽)을 상류로 적는다.
 */
export type Skew90Side = 'L' | 'R' | 'upstream' | 'downstream'
/**
 * 스캔 방향 부호: +1 = 파일 U 가 커지면 시편 좌표 s 가 커짐, −1 = 작아짐.
 * 판: s = 기준점(판 끝)에서 잰 거리 → +1 = U 가 커지면 기준점에서 멀어짐.
 * 관: s = 12시에서 시작해 시편의 '기준 쪽'(Skew90Side 의 상류)에서 용접부를 바라볼 때 시계 방향으로 잰 원주 거리
 *     → +1 = U 가 커지면 그 시계 방향으로 감. (관에서 '기준점에서 멀어짐'은 양쪽 다 해당해 쓰지 않는다)
 */
export type ScanDirection = 1 | -1
/** 앱 제안의 대상 */
export type SuggestionTarget = 'length' | 'length-start' | 'length-end' | 'height' | 'depth-top' | 'depth-bottom'

// ───────────────────────────── 1.1 물리 결함 (시편마다 한 번) ─────────────────────────────

/** 설계·인증값. 위치는 시편 기준점에서 잰 값 (시편 좌표 s) */
export interface DesignValues {
  type: MetallurgicalType | null
  zone: WeldZone | null
  side: WeldSide | null
  /** 시작 (mm, 기준점에서) */
  startMm: number | null
  /** 끝 (mm, 기준점에서) */
  endMm: number | null
  /** 중심 (mm). 시작·끝을 모르고 한 점만 알 때 (예: 00_결함정보.docx '위치 160' — 중심 추정) */
  centerMm: number | null
  /** 깊이 (mm, 표면에서). 윗끝인지 중심인지는 출처 문서를 따른다 — 0단계에서 확정 */
  depthMm: number | null
  lengthMm: number | null
  heightMm: number | null
  /** 기울기 (°) */
  tiltDeg: number | null
}

export interface PhysicalDefect {
  /** 시편 안에서 유일. 키 = (specimenId, id) */
  id: PhysicalDefectId
  /** catalog files.specimen_id 재사용 */
  specimenId: string
  weldId: string | null
  design: DesignValues
  source: DesignSource
  confirmation: ConfirmationLevel
  dataOrigin: DataOrigin
  /** 시뮬레이션·합성 삽입의 바탕이 된 결함 */
  parentId: PhysicalDefectId | null
  /** 시뮬레이션·합성 도구 이름·버전 */
  generatorTool: string | null
  generatorVersion: string | null
  /** 고친 횟수 합 (표시용, 1부터) */
  revision: number
  /** PC 마다 고친 횟수 — 병합 순서 판단 (versions.ts) */
  versions: VersionEntry[]
  /** 삭제 표시(tombstone). 지우지 않고 남겨 다른 PC 에 전한다 */
  deleted: boolean
  /** 마지막으로 고친 PC */
  pcId: string | null
  updatedAt: IsoDateTime | null
  note: string
}

// ───────────────────────────── 1.2 파일 정렬 (파일마다 한 번) ─────────────────────────────

/** 파일 U(엔코더) → 시편 좌표. 평가용 정답표는 이 변환을 거친 시편 좌표로 낸다 */
export interface FileAlignment {
  /** 키 */
  sha256: Sha256Hex
  /** 파일 이름 (기록용, 확장자 포함) */
  fileName: string
  specimenId: string | null
  weldId: string | null
  datumKind: DatumKind | null
  /** 기준점 설명 ('판 왼쪽 끝', '관 12시 표시') */
  datumDescription: string | null
  /** 기준점이 파일 스캔축 몇 mm 에 있는지 (U, mm) */
  datumUMm: number | null
  direction: ScanDirection | null
  skew90Side: Skew90Side | null
  /**
   * 기준점·방향을 확인하지 못해 가설로 채웠는지 (예: X3 '스캔 0 mm = 판 끝, +1', 계획 7절 가설).
   * 가설 정렬로 낸 시편 좌표 비교에는 매칭 결과에 확인 사항이 붙는다.
   */
  alignmentAssumed: boolean
  thicknessMm: number | null
  /** 관 외경 (mm). 판은 null */
  outerDiameterMm: number | null
  /** 원주 겹침 구간 (U, mm). 한 바퀴를 넘겨 스캔한 구간 */
  overlapStartMm: number | null
  overlapEndMm: number | null
  /** Skew 90 / 270 탐촉자 앞면(쐐기 앞끝)에서 용접 중심선(CL)까지 잰 거리 (mm, 실측). V 좌표의 근거 */
  probeClSkew90Mm: number | null
  probeClSkew270Mm: number | null
  /** 스캔 중 탐촉자–용접선 위치의 최대 편차 (mm). 시방서 6절 허용 ±1 (t<8) / ±2 (t≥8) */
  trackDeviationMaxMm: number | null
  /** 근거 (시작점 사진 파일 이름 등) */
  evidence: string | null
  enteredBy: LabelerId | null
  revision: number
  versions: VersionEntry[]
  /** 삭제 표시(tombstone) */
  deleted: boolean
  pcId: string | null
  updatedAt: IsoDateTime | null
  note: string
}

// ───────────────────────────── 1.3 지시 기록 (라벨러마다) ─────────────────────────────

/** 원자료 앵커. 이 값과 좌표 규칙으로 mm 를 다시 계산한다 */
export interface Anchor {
  groupId: number
  /** 스캔 칸 k (실수). U = offset + k·Δu */
  scanIndex: number
  /** 빔 번호 (실수, S-scan 조회표의 beam0/beam1/weight 에서) */
  beam: number
  /** 샘플 번호 (실수) */
  sample: number
  /** 이 점을 찍을 때의 좌표 규칙 버전 */
  coordRulesVersion: number
  /**
   * 찍을 때 그 그룹이 OmniPC 대조를 마쳤는지 (core/nde/viewer/meta.ts VERIFIED) — 기록용.
   * 자동 변환·학습 내보내기를 막을지는 그때 파일 메타(VERIFIED)로 다시 판정한다.
   * 엑셀 기록(imported-mm)은 앵커가 없으므로 같은 판정을 파일 메타로만 한다.
   */
  groupVerified: boolean
}

/** 앵커에서 계산한 점의 mm (검사 좌표) */
export interface PointMm {
  scanMm: number
  /** 용접 중심(CL) 기준 V */
  vMm: number
  /** 실제 깊이 (레그를 접은 깊이, 표면에서) */
  depthMm: number
}

/** 전문가가 찍은 점 하나 */
export interface AnchorPoint {
  /** 기록 안에서 유일 ('p1', 'p2' …). 높이 칸이 이 id 로 점을 가리킨다 */
  id: string
  role: AnchorRole
  anchor: Anchor
  /** 이 점이 맺힌 레그 (1부터). 앱이 계산 */
  leg: number | null
  /** 찍을 때 화면 소프트 이득 Δ (dB). 진폭은 늘 파일 이득 기준으로 저장하고 이 값은 참고로만 둔다 */
  displayGainDb: number | null
  /** 앵커에서 계산한 mm. 계산 규칙 버전 = anchor.coordRulesVersion */
  mm: PointMm | null
}

/** 파생 위치 (mm). app-anchor 는 앵커에서 계산, imported-mm 은 가져온 값 그대로 */
export interface DerivedPosition {
  scanStartMm: number
  scanEndMm: number
  /** 용접 중심(CL) 기준 V 범위 */
  vMinMm: number | null
  vMaxMm: number | null
  /**
   * 지시 영역의 위·아래 실제 깊이 (접은 깊이, 표면에서). 위치를 나타내는 값이지 크기 정답이 아니다.
   * 엑셀: 최대 진폭 단면 S-scan 에서 평가 기준을 넘는 에코의 위·아래 끝. 높이용 팁 깊이와 다를 수 있다.
   */
  depthTopMm: number | null
  depthBottomMm: number | null
  /** 이 값을 계산한 좌표 규칙 버전. imported-mm 은 null */
  coordRulesVersion: number | null
}

/** 판독 출처 세부 */
export interface ReaderDetail {
  /** 전문기관 이름 */
  organization: string | null
  /** 자격 ('UT Level II') */
  qualification: string | null
  /** AI 모델 버전 */
  modelVersion: string | null
}

/** 판정 특성 */
export interface CharacterInfo {
  value: JudgmentCharacter | null
  /** 일렬 체적 → 면상 자동 전환을 적용했는지 (시방서 15절) */
  alignedVolumetric: boolean
  /** 그 전환을 전문가가 확인했는지 */
  expertConfirmed: boolean
}

export interface WeldLocation {
  zone: WeldZone | null
  /** 시편에 표시한 L/R (도면·시편 기준). 파일 V 부호와는 FileAlignment.skew90Side 로 잇는다 */
  side: WeldSide | null
  /** 개선 덮개가 그려지지 않는 파일에서 고른 위치 ('덮개 없음') */
  noBevelOverlay: boolean
}

export interface LengthMeasure {
  /** 최종 길이 (mm). 6db-curvature 면 곡률 보정 뒤 l_c */
  valueMm: number | null
  method: LengthMethod | null
  /** 보정 전 표면 길이 l_s (mm). 6db-curvature 일 때만 */
  uncorrectedMm: number | null
  /** 길이를 잰 그룹·빔 */
  groupId: number | null
  beam: number | null
  /** 길이를 잰 빔의 굴절각 (°). 엑셀(OmniPC)에서는 빔 번호 대신 이 값을 적는다 */
  angleDeg: number | null
  /** 길이를 잰 문턱 (%FSH). 평가 기준 추정이 대조 전이라, 나중에 다른 문턱으로 다시 계산할 수 있게 남긴다 */
  thresholdPct: number | null
}

export interface HeightMeasure {
  method: HeightMethod | null
  valueMm: number | null
  /** 높이를 정한 점 (anchors 의 id). 점마다 그룹·레그·빔·스캔·이득이 앵커에 있다 */
  pointIds: string[]
}

/** 최대 진폭 위치 */
export interface PeakLocation {
  groupId: number | null
  beam: number | null
  angleDeg: number | null
  scanMm: number | null
  /** 실제 깊이 (mm) */
  depthMm: number | null
}

export interface SignalInfo {
  /** 최대 진폭 %FSH — 파일 이득 그대로(소프트 이득 0 dB) */
  maxAmplitudePct: number | null
  /**
   * Ref(기준 감도, 대비 반사체 80 %FSH 이득 + 탐상 감도 차) 대비 dB. 앱이 최대 진폭과 파일 Ref 추정으로 계산한다
   * (levels.ts). OmniPC 의 AdBA 는 Ref 기준이 아니다(게이트 A 문턱 대비 dB — MXU 설명서 4.4·5.6·5.8)라 이 칸에 넣지 않는다.
   * Ref 대비에 해당하는 OmniPC 값은 AdBr(기준 진폭 대비)·AdBCurve(TCG sizing curve 대비)이고, 이 칸과 같은 식인지는 캡처 46 전(조사_보고 5.1절).
   */
  refDb: number | null
  /**
   * true = 그 값의 Ref 정의(대비 반사체·TCG 기준 진폭·읽기값 정의)가 OmniPC 문서·캡처로 확인됨.
   * 엑셀에서 가져온 값과 대조 전 앱 계산값은 false (진폭 조건이 든 합부는 참고값).
   */
  refDbVerified: boolean
  /** 포화 (≥ 200 %FSH). null = 모름 */
  saturated: boolean | null
  /** 평가 기준 초과 (표 13: Ref −14 dB 등) */
  exceedsEvaluationLevel: boolean | null
  /** 기록 기준 초과. 기록 기준 ≥ 평가 기준이라 이것이 참이면 평가 기준 초과도 참이어야 한다 */
  exceedsRecordingLevel: boolean | null
  peak: PeakLocation | null
}

/** 앱 제안과 전문가 최종값 (측정 보조를 얼마나 그대로 받았는지 본다) */
export interface SuggestionRecord {
  target: SuggestionTarget
  /** 제안 규칙 이름 ('eval-level', '6db-drop' …) */
  rule: string
  /** 규칙의 dB 인자 */
  ruleDb: number | null
  /** 제안값 (mm). null = 제안 불가 (포화·동적 범위 부족) */
  suggestedMm: number | null
  /** 전문가 최종값 (mm) */
  finalMm: number | null
  /** 고치지 않고 수락했는지 */
  acceptedUnchanged: boolean
  /** 수정량 = 최종 − 제안 (mm) */
  correctionMm: number | null
  /** 전문가가 먼저 찍은 뒤 비교용으로 보여 줬는지 */
  shownAfterExpert: boolean
}

/** 라벨할 때의 사전 지식 */
export interface PriorKnowledge {
  /** 설계값을 보고 라벨했는지. 판독 단계가 '설계값 대조'·'확정'이면 늘 참으로 본다 */
  designValueSeen: boolean | null
  /** 시편을 미리 알았는지 */
  specimenKnown: boolean | null
  /** AI 개발에 참여했는지 */
  aiDevParticipant: boolean | null
}

export interface GeometricEchoDetail {
  kind: GeometricEchoKind
  /** 앱이 낸 형상 에코 후보를 승인한 것인지 */
  fromSuggestion: boolean
}

export interface GeometricImperfectionDetail {
  kind: GeometricImperfectionKind
}

/** 지시 기록. 결함·형상 에코·형상 불완전이 같은 표를 쓴다 */
export interface IndicationRecord {
  // 키
  uuid: Uuid
  sha256: Sha256Hex
  /** 보조 지문 (진폭 데이터셋 해시 등). 파일이 다시 저장돼 sha256 이 바뀌어도 찾기 위함 */
  secondaryFingerprint: string | null
  labelerId: LabelerId
  /** 지침서 버전 ('v1') */
  guidelineVersion: string
  /** 판독 단계. 라벨 세트 키의 일부 */
  readingStage: ReadingStage
  /** 고친 횟수 합 (표시용, 1부터) */
  revision: number
  /** PC 마다 고친 횟수 — 병합 순서 판단 (versions.ts) */
  versions: VersionEntry[]
  /** 삭제 표시(tombstone) */
  deleted: boolean
  /** 마지막으로 고친 PC */
  pcId: string | null
  createdAt: IsoDateTime | null
  updatedAt: IsoDateTime | null

  // 판독 출처
  readerSource: ReaderSource
  readerDetail: ReaderDetail
  /** 가져온 기록의 원래 번호 (엑셀 '지시 번호', 전문기관 지시 번호). 같은 라벨 세트를 다시 가져올 때 같은 기록으로 묶는다 */
  externalRef: string | null

  kind: RecordKind

  // 위치
  coordSource: CoordSource
  /** 찍은 점. imported-mm 은 빈 목록 */
  anchors: AnchorPoint[]
  derived: DerivedPosition
  /** 좌표 규칙이 바뀌어 앵커에서 다시 계산했고 전문가 확인이 필요함 */
  recheckNeeded: boolean

  // 판단
  existenceConfidence: Confidence
  /** 결함일 때만. 형상 에코·형상 불완전은 null */
  defectType: MetallurgicalType | null
  /** ISO 6520-1 코드 ('4011'). 원문 대조 전 — codes.ts */
  isoCode: string | null
  typeConfidence: Confidence | null
  character: CharacterInfo
  surface: SurfaceClass | null
  /** 점 같은 지시인지 (시방서 16.3: 누적 길이에서 빼고, 150 mm 당 개수로 따로 셈). null = 모름 */
  pointLike: boolean | null
  location: WeldLocation

  // 측정
  length: LengthMeasure
  height: HeightMeasure
  signal: SignalInfo
  suggestions: SuggestionRecord[]

  // 사전 지식·묶음
  knowledge: PriorKnowledge
  /** 물리 결함 ID. 키 = (이 파일 정렬(sha256)의 specimenId, physicalDefectId) */
  physicalDefectId: PhysicalDefectId | null
  /** 앱이 계산한 그룹 짓기 ID (시방서 그림 5·6) */
  groupingId: string | null

  /** 화면 스냅샷 (이득·게이트·색표 등, 불투명 JSON). 행을 누르면 이 화면으로 돌아간다 */
  viewSnapshot: unknown

  /** kind = 'geometric-echo' 일 때만 */
  geometricEcho: GeometricEchoDetail | null
  /** kind = 'geometric-imperfection' 일 때만 */
  geometricImperfection: GeometricImperfectionDetail | null

  note: string
}

// ───────────────────────────── 1.4 관측 표 (지시마다, 그룹 × 레그) ─────────────────────────────

/** 기록 영역을 그 그룹·레그의 원자료 칸에 투영한 범위 */
export interface ProjectedRange {
  scanStartMm: number
  scanEndMm: number
  beamMin: number
  beamMax: number
  sampleMin: number
  sampleMax: number
}

/** 탐색 창 안에서 찾은 신호 */
export interface ObservationSearch {
  maxAmplitudePct: number
  beam: number
  scanMm: number
  /** 신호가 이어지는 스캔 범위 */
  scanStartMm: number | null
  scanEndMm: number | null
}

/** 앱이 먼저 계산하고 전문가는 상태만 확인·수정한다. 키 = (recordUuid, groupId, leg) */
export interface ObservationRow {
  recordUuid: Uuid
  groupId: number
  /** 레그 (1부터) */
  leg: number
  projected: ProjectedRange | null
  search: ObservationSearch | null
  saturated: boolean | null
  status: ObservationStatus
  expertConfirmed: boolean
  /** 계산에 쓴 좌표 규칙 버전 */
  coordRulesVersion: number
  revision: number
  versions: VersionEntry[]
  /** 삭제 표시(tombstone) */
  deleted: boolean
  /** 마지막으로 고친 PC */
  pcId: string | null
}

// ───────────────────────────── 1.5 검토 구간 (라벨러마다) ─────────────────────────────

/**
 * 검토할 때 본 C-scan 게이트의 깊이·레그 범위. '결함 없음' 예시는 이 범위 안에서만 뽑는다.
 * 깊이는 펼친 깊이(음로 방향 깊이, 0 ~ 레그 수 × t) 그대로다. OmniPC 게이트 값과 같다 (예: X3 게이트 A 7~28 mm → 레그 1~3).
 */
export interface ReviewGateRange {
  /** 펼친 깊이 (mm) */
  depthTopMm: number
  /** 펼친 깊이 (mm) */
  depthBottomMm: number
  legMin: number
  legMax: number
}

/**
 * 검토 완료: (파일, 그룹, 스캔 구간) + 게이트 범위. 검토 뒤 그 구간 기록을 고치면 앱이 이 구간을 풀어 준다(released).
 * 품질 불량: 사유 + 스캔 구간. 음성에서 뺀다.
 * 기준 미만 지시: 보이지만 평가 기준에 못 미치는 응답. 학습에서는 무시, 오검출 집계에서는 뺀다.
 */
export interface ReviewInterval {
  uuid: Uuid
  sha256: Sha256Hex
  labelerId: LabelerId
  guidelineVersion: string
  readingStage: ReadingStage
  revision: number
  versions: VersionEntry[]
  /** 사용자가 지운 것(tombstone) */
  deleted: boolean
  /** 검토 뒤 그 구간 기록을 고쳐 앱이 자동으로 푼 것 (검토 완료에만). 사용자가 지운 것과 구분한다 */
  released: boolean
  pcId: string | null
  createdAt: IsoDateTime | null
  updatedAt: IsoDateTime | null
  kind: ReviewIntervalKind
  /** null = 모든 그룹 */
  groupId: number | null
  scanStartMm: number
  scanEndMm: number
  /** kind = 'reviewed' 일 때 */
  gate: ReviewGateRange | null
  /** kind = 'quality-bad' 일 때만 */
  reason: QualityBadReason | null
  note: string
}

// ───────────────────────────── 작업 이벤트 (판독시간) ─────────────────────────────

export interface WorkEvent {
  uuid: Uuid
  sessionId: string
  labelerId: LabelerId
  /** 이 작업의 판독 단계 (블라인드 시간과 대조 시간을 나눔). 세션 시작 등 단계와 무관하면 null */
  readingStage: ReadingStage | null
  pcId: string | null
  /** 파일과 무관한 이벤트(세션 시작 등)는 null */
  sha256: Sha256Hex | null
  kind: WorkEventKind
  tool: WorkTool
  /** 기록용 시각 — 순서 판단에 쓰지 않음 */
  at: IsoDateTime
  /** 세부 (유휴 길이, 기록 UUID, 보고서 작성 분, 라벨 추가 작업 분 등). 불투명 JSON */
  detail: unknown
}

// ───────────────────────────── 라벨 세트 · 내보내기 파일 ─────────────────────────────

/** 라벨 세트 키. 2인 독립 라벨 중에는 다른 라벨러 세트를 숨긴다 */
export interface LabelSetKey {
  sha256: Sha256Hex
  labelerId: LabelerId
  guidelineVersion: string
  readingStage: ReadingStage
}

export interface LabelerInfo {
  id: LabelerId
  name: string
  /** 자격 ('UT Level II') */
  qualification: string | null
  organization: string | null
}

/**
 * JSON 내보내기·가져오기 파일. 여러 PC 의 기록을 합칠 때 쓴다.
 * 같은 UUID 가 양쪽에서 따로 바뀌었으면(versions 가 서로 포함하지 않음) 덮어쓰지 않고 둘 다 남겨 '충돌'로 표시한다(1a 단계).
 * 그래서 한 파일 안에 같은 UUID 가 둘 이상 있을 수 있다.
 */
export interface LabelExportFile {
  format: typeof LABEL_EXPORT_FORMAT
  schemaVersion: number
  /** 내보낸 앱의 좌표 규칙 버전 (LABEL_COORD_RULES_VERSION) */
  rulesVersion: number
  appVersion: string
  /** 기록용 시각 */
  exportedAt: IsoDateTime
  pcId: string
  labelers: LabelerInfo[]
  physicalDefects: PhysicalDefect[]
  fileAlignments: FileAlignment[]
  records: IndicationRecord[]
  observations: ObservationRow[]
  reviewIntervals: ReviewInterval[]
  workEvents: WorkEvent[]
}
