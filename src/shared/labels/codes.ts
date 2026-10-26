/**
 * 라벨 열거값의 코드와 한국어 표시 이름 (단일 출처).
 * 표마다 Record<코드, 이름> 이라, types.ts 에 값이 늘면 여기서 typecheck 가 깨진다(빠뜨림 방지).
 * 엑셀 양식(columns.ts)·검사(validate.ts)·화면이 모두 이 표를 쓴다.
 *
 * ISO 6520-1 코드는 표준 원문을 아직 보지 못했다. 모든 코드가 verified: false('원문 대조 전')이고,
 * basis 로 근거 수준을 적는다: 'secondary' = 2차 출처에서 봄(계획_라벨링/조사_원자료/6 2절),
 * 'unsourced' = 출처를 확인하지 못함(기억에 기댄 값 — 원문으로 꼭 다시 볼 것).
 */
import type {
  AnchorRole,
  Confidence,
  ConfirmationLevel,
  CoordSource,
  DataOrigin,
  DatumKind,
  DesignSource,
  GeometricEchoKind,
  GeometricImperfectionKind,
  HeightMethod,
  JudgmentCharacter,
  LengthMethod,
  MetallurgicalType,
  ObservationStatus,
  QualityBadReason,
  ReaderSource,
  ReadingStage,
  RecordKind,
  ReviewIntervalKind,
  Skew90Side,
  SuggestionTarget,
  SurfaceClass,
  WeldSide,
  WeldZone,
  WorkEventKind,
  WorkTool
} from './types'

/** 코드 → 한국어 표시 이름 */
export type CodeTable<T extends string> = Readonly<Record<T, string>>

// ───────────────────────────── 표 ─────────────────────────────

export const EXPORT_FORMAT: CodeTable<'paut-labels'> = { 'paut-labels': 'PAUT 라벨 파일' }

export const DATA_ORIGIN: CodeTable<DataOrigin> = {
  measured: '실측',
  simulated: '시뮬레이션',
  synthetic: '합성 삽입'
}

export const DESIGN_SOURCE: CodeTable<DesignSource> = {
  'manufacturer-report': '제작사 결함 보고서',
  'design-drawing': '설계도',
  'pcn-sheet': 'PCN 시트 (1인 판독)',
  none: '없음'
}

export const CONFIRMATION_LEVEL: CodeTable<ConfirmationLevel> = {
  unknown: '미확인',
  'design-only': '설계만',
  'fabrication-record': '제작 기록',
  rt: 'RT',
  sectioning: '절단'
}

export const READER_SOURCE: CodeTable<ReaderSource> = {
  expert: '우리 전문가',
  agency: '전문기관',
  ai: 'AI'
}

export const READING_STAGE: CodeTable<ReadingStage> = {
  blind: '블라인드 (설계값 안 봄)',
  reconciled: '설계값 대조',
  final: '확정 (Level III)'
}

export const RECORD_KIND: CodeTable<RecordKind> = {
  defect: '결함',
  'geometric-echo': '형상 에코',
  'geometric-imperfection': '형상 불완전'
}

export const ANCHOR_ROLE: CodeTable<AnchorRole> = {
  peak: '최대 진폭',
  'tip-top': '위 팁',
  'tip-bottom': '아래 팁',
  tip: '팁',
  surface: '표면 (윗면·뒷면)',
  'drop-top': '−6 dB 위 끝',
  'drop-bottom': '−6 dB 아래 끝',
  'length-start': '길이 시작',
  'length-end': '길이 끝',
  'rect-a': '사각형 모서리 1',
  'rect-b': '사각형 모서리 2',
  other: '기타 점'
}

export const COORD_SOURCE: CodeTable<CoordSource> = {
  'app-anchor': '앱에서 찍음 (앵커)',
  'imported-mm': '가져온 mm (앵커 없음)'
}

export const CONFIDENCE: CodeTable<Confidence> = {
  certain: '확실',
  probable: '보통',
  uncertain: '불확실'
}

export const METALLURGICAL_TYPE: CodeTable<MetallurgicalType> = {
  'crack-root': '균열 (루트)',
  'crack-toe': '균열 (토우)',
  'crack-sidewall': '균열 (측벽)',
  'crack-center': '균열 (중앙)',
  'crack-unspecified': '균열 (세부 미상)',
  'lof-sidewall': '융합불량 (측벽)',
  'lof-root': '융합불량 (루트)',
  'lof-interrun': '융합불량 (층간)',
  'lof-unspecified': '융합불량 (세부 미상)',
  'incomplete-penetration': '용입불량',
  slag: '슬래그',
  'porosity-single': '기공 (단독)',
  'porosity-cluster': '기공 (군집)',
  'porosity-unspecified': '기공 (단독·군집 미상)',
  'planar-presumed': '면상 추정',
  'volumetric-presumed': '체적 추정'
}

export const JUDGMENT_CHARACTER: CodeTable<JudgmentCharacter> = {
  planar: '면상',
  volumetric: '체적'
}

/** 시방서 16.3 표 14 의 h3(표면 열림)·h2(내재). '점 같은 지시'는 따로 참/거짓 칸(pointLike) */
export const SURFACE_CLASS: CodeTable<SurfaceClass> = {
  'surface-breaking': '표면 열림',
  embedded: '내재'
}

export const WELD_ZONE: CodeTable<WeldZone> = {
  root: '루트',
  sidewall: '측벽',
  cap: '캡',
  body: '몸체',
  'toe-haz': '토우·HAZ'
}

export const WELD_SIDE: CodeTable<WeldSide> = {
  L: '왼쪽 (L)',
  R: '오른쪽 (R)'
}

export const LENGTH_METHOD: CodeTable<LengthMethod> = {
  'eval-level': '평가 기준 초과 구간 (t≥8)',
  '6db-curvature': '6 dB 강하 + 곡률 보정 (t<8)',
  other: '기타'
}

export const HEIGHT_METHOD: CodeTable<HeightMethod> = {
  'tip-tip': '상하 팁',
  'tip-surface': '팁 + 표면',
  'transit-time': '노정 시간 (반사·모드 변환)',
  '6db': '−6 dB 높이 (참고, 시방서 외)',
  unmeasurable: '측정 불가'
}

/**
 * 높이 방식이 시방서 15절 높이 결정법인지. 표 14(길이 + 높이) 판정은 true 인 방식의 높이만 쓴다.
 * 그 밖(−6 dB 높이·측정 불가)은 '높이 측정 곤란'으로 보아 표 13(길이 + 최대 진폭)으로 판정한다.
 * −6 dB 높이는 2~3 mm 결함에서 빔 폭에 좌우되고 포화되면 잴 수 없어, 학습 참고값으로만 남긴다.
 */
export const HEIGHT_METHOD_IN_SPEC: Readonly<Record<HeightMethod, boolean>> = {
  'tip-tip': true,
  'tip-surface': true,
  'transit-time': true,
  '6db': false,
  unmeasurable: false
}

export const GEOMETRIC_ECHO_KIND: CodeTable<GeometricEchoKind> = {
  root: '루트',
  cap: '캡',
  'mode-conversion': '모드 변환',
  other: '기타'
}

export const GEOMETRIC_IMPERFECTION_KIND: CodeTable<GeometricImperfectionKind> = {
  misalignment: '단차',
  'excess-penetration': '과다용입',
  'root-concavity': '루트 오목',
  undercut: '언더컷'
}

export const OBSERVATION_STATUS: CodeTable<ObservationStatus> = {
  visible: '보임',
  weak: '약함',
  'not-visible': '안 보임'
}

export const REVIEW_KIND: CodeTable<ReviewIntervalKind> = {
  reviewed: '검토 완료',
  'quality-bad': '품질 불량',
  'below-threshold': '기준 미만 지시'
}

/** 시방서 15절 품질 평가 6항목 (연결 장치, 시간 범위, 감도, SNR, 포화 지시, 데이터 획득) */
export const QUALITY_BAD_REASON: CodeTable<QualityBadReason> = {
  coupling: '커플링',
  missing: '누락',
  saturation: '포화',
  noise: '잡음',
  'time-range': '시간 범위',
  sensitivity: '감도'
}

export const WORK_EVENT_KIND: CodeTable<WorkEventKind> = {
  'session-start': '세션 시작',
  'session-end': '세션 끝',
  'file-open': '파일 열기',
  'file-close': '파일 닫기',
  'record-create': '기록 생성',
  'record-update': '기록 수정',
  'record-delete': '기록 삭제',
  'review-complete': '검토 완료',
  idle: '유휴',
  'ai-display': 'AI 표시',
  report: '보고서 작성',
  'label-extra': '라벨 추가 작업'
}

export const WORK_TOOL: CodeTable<WorkTool> = {
  app: '우리 앱',
  omnipc: 'OmniPC',
  other: '기타'
}

export const DATUM_KIND: CodeTable<DatumKind> = {
  'plate-edge': '판 끝',
  'pipe-12-oclock': '관 12시',
  other: '기타'
}

/** Skew 90 탐촉자가 놓인 쪽 (types.ts Skew90Side). 관은 시편의 '기준 쪽'을 상류로 적는다 */
export const SKEW90_SIDE: CodeTable<Skew90Side> = {
  L: '왼쪽 (L)',
  R: '오른쪽 (R)',
  upstream: '상류 (기준 쪽)',
  downstream: '하류'
}

/** 스캔 방향 부호. 저장 값은 숫자 1 / −1 (FileAlignment.direction). 관은 '기준 쪽'에서 용접부를 볼 때의 회전 방향 */
export const SCAN_DIRECTION: CodeTable<'+1' | '-1'> = {
  '+1': '같은 방향 +1 (판: 기준점에서 멀어짐 · 관: 시계 방향)',
  '-1': '반대 방향 −1 (판: 기준점 쪽으로 · 관: 반시계 방향)'
}

/** 엑셀 '그룹' 칸의 값: 기법 × 스큐. 가져올 때 그 파일에서 기법·스큐가 같은 그룹의 번호로 바꾼다 */
export type ScanGroupCode = 'sect-90' | 'sect-270' | 'lin-90' | 'lin-270'

/**
 * 엑셀 '그룹' 칸. X3 12T-SV 는 섹토리얼 Skew 90·270 두 그룹. t ≥ 8 은 시방서상 S + E 스캔이라 리니어 두 그룹이 더 생긴다.
 * 그 파일에 같은 기법·스큐 그룹이 둘 이상이면 가져올 때 확인을 묻는다(그룹 이름 규칙: 취득_규약_v1.md 3절).
 */
export const SCAN_GROUP: CodeTable<ScanGroupCode> = {
  'sect-90': '섹토리얼 Skew 90',
  'sect-270': '섹토리얼 Skew 270',
  'lin-90': '리니어 Skew 90',
  'lin-270': '리니어 Skew 270'
}

export const SUGGESTION_TARGET: CodeTable<SuggestionTarget> = {
  length: '길이',
  'length-start': '길이 시작',
  'length-end': '길이 끝',
  height: '높이',
  'depth-top': '깊이 위',
  'depth-bottom': '깊이 아래'
}

/** 엑셀 참/거짓 칸 */
export const BOOL_LABEL: Readonly<Record<'true' | 'false', string>> = { true: '예', false: '아니오' }

// ───────────────────────────── 정답 계층 ─────────────────────────────

/** 정답 계층 (규격_초안.md 5.1): 인증·설계값 > 2인 합의 + Level III > 전문가 1인 */
export type TruthTier = 'certified' | 'consensus' | 'single'

export const TRUTH_TIER: CodeTable<TruthTier> = {
  certified: '인증·설계값',
  consensus: '2인 합의 + Level III',
  single: '전문가 1인'
}

/** 높을수록 먼저 쓴다 */
export const TRUTH_TIER_RANK: Readonly<Record<TruthTier, number>> = { certified: 3, consensus: 2, single: 1 }

/** 물리 결함 출처의 정답 계층. PCN 시트는 1인 판독(6 dB 강하, 기준점 미정)이라 'single'. 없음 = null */
export function truthTierOfSource(source: DesignSource): TruthTier | null {
  switch (source) {
    case 'manufacturer-report':
    case 'design-drawing':
      return 'certified'
    case 'pcn-sheet':
      return 'single'
    case 'none':
      return null
  }
}

// ───────────────────────────── ISO 6520-1 ─────────────────────────────

export interface IsoCodeInfo {
  code: string
  /** 한국어 이름 */
  ko: string
  /** true = ISO 6520-1 원문과 대조함. 지금은 모두 false (원문 대조 전) */
  verified: boolean
  /** 'secondary' = 2차 출처에서 봄, 'unsourced' = 출처 미확인 */
  basis: 'secondary' | 'unsourced'
  note: string | null
}

function iso(code: string, ko: string, basis: IsoCodeInfo['basis'], note: string | null = null): IsoCodeInfo {
  return { code, ko, verified: false, basis, note }
}

/** ISO 6520-1:2007 (융접 결함 분류) 중 우리가 쓰는 코드. 모두 원문 대조 전 */
export const ISO_6520_1: Readonly<Record<string, IsoCodeInfo>> = {
  '100': iso('100', '균열', 'secondary'),
  '1011': iso('1011', '종균열', 'secondary', '2차 출처는 "종균열"까지만 적음. 용착금속 안 종균열로 알려짐'),
  '1012': iso('1012', '종균열 (용접 경계)', 'unsourced'),
  '1013': iso('1013', '종균열 (열영향부)', 'unsourced'),
  '200': iso('200', '공동', 'secondary'),
  '2011': iso('2011', '기공', 'secondary'),
  '2013': iso('2013', '군집 기공', 'unsourced'),
  '300': iso('300', '고체 개재물', 'secondary'),
  '301': iso('301', '슬래그 개재물', 'secondary'),
  '400': iso('400', '융합불량·용입불량', 'secondary'),
  '4011': iso('4011', '측벽 융합불량', 'secondary'),
  '4012': iso('4012', '층간 융합불량', 'secondary'),
  '4013': iso('4013', '루트 융합불량', 'secondary'),
  '4021': iso('4021', '루트 용입불량', 'secondary'),
  '500': iso('500', '형상 불완전', 'secondary', '2차 출처는 "언더컷 등"이라고만 적음'),
  '501': iso('501', '언더컷', 'unsourced'),
  '504': iso('504', '과다용입', 'unsourced'),
  '507': iso('507', '단차 (선형 어긋남)', 'unsourced'),
  '515': iso('515', '루트 오목', 'unsourced'),
  '600': iso('600', '기타', 'secondary')
}

/** 표시용: '4011 측벽 융합불량 (원문 대조 전)' */
export function isoLabel(code: string): string {
  const c = ISO_6520_1[code]
  if (!c) return `${code} (표에 없음)`
  return `${c.code} ${c.ko}${c.verified ? '' : ' (원문 대조 전)'}`
}

// ───────────────────────────── 금속학적 종류의 성질 ─────────────────────────────

/** 제안서 9·23쪽 결함 5종 */
export type ProposalDefectClass = 'porosity' | 'slag' | 'crack' | 'lof' | 'ip'
export const PROPOSAL_DEFECT_CLASS: CodeTable<ProposalDefectClass> = {
  porosity: '기공',
  slag: '슬래그',
  crack: '균열',
  lof: '융합불량',
  ip: '용입불량'
}

/** 제안서의 균열 세분 */
export type ProposalCrackSubtype = 'toe' | 'center' | 'sidewall' | 'root'
export const PROPOSAL_CRACK_SUBTYPE: CodeTable<ProposalCrackSubtype> = {
  toe: '토우',
  center: '중앙',
  sidewall: '측벽',
  root: '루트'
}

/** 제안서 위치 3종 */
export type ProposalLocation = 'cap' | 'center' | 'root'
export const PROPOSAL_LOCATION: CodeTable<ProposalLocation> = {
  cap: 'Cap',
  center: 'Center',
  root: 'Root'
}

export interface MetallurgicalTypeInfo {
  /** ISO 6520-1 코드 (ISO_6520_1 의 키). 면상·체적 추정은 null */
  iso: string | null
  /** 판정 특성 기본값: 균열·융합불량·용입불량 = 면상, 기공·슬래그 = 체적 */
  defaultCharacter: JudgmentCharacter
  /** 제안서 5종 대응. 면상·체적 추정은 대응 없음 */
  proposalClass: ProposalDefectClass | null
  proposalCrackSubtype: ProposalCrackSubtype | null
  /** 코드를 고를 때 확인할 점 */
  isoNote: string | null
}

export const METALLURGICAL_TYPE_INFO: Readonly<Record<MetallurgicalType, MetallurgicalTypeInfo>> = {
  'crack-root': { iso: '1011', defaultCharacter: 'planar', proposalClass: 'crack', proposalCrackSubtype: 'root', isoNote: '루트 위치는 위치 구분 칸으로 나눔' },
  'crack-toe': {
    iso: '1013',
    defaultCharacter: 'planar',
    proposalClass: 'crack',
    proposalCrackSubtype: 'toe',
    isoNote: '토우 균열을 1012(용접 경계)로 볼지 1013(열영향부)로 볼지 원문·전문가 확인'
  },
  'crack-sidewall': { iso: '1012', defaultCharacter: 'planar', proposalClass: 'crack', proposalCrackSubtype: 'sidewall', isoNote: '개선면(용접 경계) 균열로 가정' },
  'crack-center': { iso: '1011', defaultCharacter: 'planar', proposalClass: 'crack', proposalCrackSubtype: 'center', isoNote: null },
  'crack-unspecified': {
    iso: '100',
    defaultCharacter: 'planar',
    proposalClass: 'crack',
    proposalCrackSubtype: null,
    isoNote: '위치 세부를 몰라 군 코드(100)로 둠'
  },
  'lof-sidewall': { iso: '4011', defaultCharacter: 'planar', proposalClass: 'lof', proposalCrackSubtype: null, isoNote: null },
  'lof-root': { iso: '4013', defaultCharacter: 'planar', proposalClass: 'lof', proposalCrackSubtype: null, isoNote: null },
  'lof-interrun': { iso: '4012', defaultCharacter: 'planar', proposalClass: 'lof', proposalCrackSubtype: null, isoNote: null },
  'lof-unspecified': {
    iso: '400',
    defaultCharacter: 'planar',
    proposalClass: 'lof',
    proposalCrackSubtype: null,
    isoNote: '측벽·루트·층간을 몰라 군 코드(400 융합불량·용입불량)로 둠. 원문에 융합불량만의 세 자리 코드가 있는지 원문 대조 전'
  },
  'incomplete-penetration': {
    iso: '4021',
    defaultCharacter: 'planar',
    proposalClass: 'ip',
    proposalCrackSubtype: null,
    isoNote: '단면 V 개선의 용입불량은 루트에 생겨 4021 로 둠'
  },
  slag: { iso: '301', defaultCharacter: 'volumetric', proposalClass: 'slag', proposalCrackSubtype: null, isoNote: null },
  'porosity-single': { iso: '2011', defaultCharacter: 'volumetric', proposalClass: 'porosity', proposalCrackSubtype: null, isoNote: null },
  'porosity-cluster': { iso: '2013', defaultCharacter: 'volumetric', proposalClass: 'porosity', proposalCrackSubtype: null, isoNote: null },
  'porosity-unspecified': {
    iso: '200',
    defaultCharacter: 'volumetric',
    proposalClass: 'porosity',
    proposalCrackSubtype: null,
    isoNote: '단독·군집을 몰라 군 코드(200 공동)로 둠'
  },
  'planar-presumed': { iso: null, defaultCharacter: 'planar', proposalClass: null, proposalCrackSubtype: null, isoNote: null },
  'volumetric-presumed': { iso: null, defaultCharacter: 'volumetric', proposalClass: null, proposalCrackSubtype: null, isoNote: null }
}

/** 형상 불완전의 ISO 6520-1 코드 (모두 출처 미확인, 원문 대조 전) */
export const GEOMETRIC_IMPERFECTION_ISO: Readonly<Record<GeometricImperfectionKind, string>> = {
  misalignment: '507',
  'excess-penetration': '504',
  'root-concavity': '515',
  undercut: '501'
}

/**
 * 위치 구분 → 제안서 위치 3종: 캡 = Cap, 몸체·측벽 = Center, 루트 = Root.
 * 토우·HAZ 는 대응을 정하지 않았다(전문가·한난 확정 전) → null.
 */
export const WELD_ZONE_TO_PROPOSAL: Readonly<Record<WeldZone, ProposalLocation | null>> = {
  cap: 'cap',
  body: 'center',
  sidewall: 'center',
  root: 'root',
  'toe-haz': null
}

/** 판정 특성 기본값 */
export function defaultCharacterOf(type: MetallurgicalType): JudgmentCharacter {
  return METALLURGICAL_TYPE_INFO[type].defaultCharacter
}

/** 종류의 ISO 6520-1 코드 정보. 면상·체적 추정은 null */
export function isoCodeOf(type: MetallurgicalType): IsoCodeInfo | null {
  const code = METALLURGICAL_TYPE_INFO[type].iso
  return code === null ? null : (ISO_6520_1[code] ?? null)
}

/** 체적 쪽 종류 (일렬로 늘어서면 면상으로 바꾸는 대상) */
export function isVolumetricType(type: MetallurgicalType): boolean {
  return defaultCharacterOf(type) === 'volumetric'
}

// ───────────────────────────── 표 묶음 · 도우미 ─────────────────────────────

/** 이름으로 찾는 표 묶음 (엑셀 칸이 이 이름으로 표를 가리킨다) */
export const LABEL_CODE_TABLES = {
  EXPORT_FORMAT,
  DATA_ORIGIN,
  DESIGN_SOURCE,
  CONFIRMATION_LEVEL,
  READER_SOURCE,
  READING_STAGE,
  RECORD_KIND,
  ANCHOR_ROLE,
  COORD_SOURCE,
  CONFIDENCE,
  METALLURGICAL_TYPE,
  JUDGMENT_CHARACTER,
  SURFACE_CLASS,
  WELD_ZONE,
  WELD_SIDE,
  LENGTH_METHOD,
  HEIGHT_METHOD,
  GEOMETRIC_ECHO_KIND,
  GEOMETRIC_IMPERFECTION_KIND,
  OBSERVATION_STATUS,
  REVIEW_KIND,
  QUALITY_BAD_REASON,
  WORK_EVENT_KIND,
  WORK_TOOL,
  DATUM_KIND,
  SKEW90_SIDE,
  SCAN_DIRECTION,
  SCAN_GROUP,
  SUGGESTION_TARGET,
  TRUTH_TIER,
  PROPOSAL_DEFECT_CLASS,
  PROPOSAL_CRACK_SUBTYPE,
  PROPOSAL_LOCATION
} as const

export type LabelCodeTableName = keyof typeof LABEL_CODE_TABLES

/** 표의 코드 목록 (적은 순서) */
export function codesOf<T extends string>(table: CodeTable<T>): T[] {
  return Object.keys(table) as T[]
}

/** 코드 → 표시 이름 (없으면 코드 그대로) */
export function labelOf<T extends string>(table: CodeTable<T>, code: T): string {
  return table[code] ?? code
}

/** 엑셀 칸 비교용: NFC, 대시류 → '-', 공백 제거, 소문자 */
export function normalizeCell(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 표시 이름 끝의 괄호 설명을 뗀 것 ('왼쪽 (L)' → '왼쪽') */
function stripHint(label: string): string {
  return label.replace(/\s*\([^()]*\)\s*$/, '')
}

/**
 * 엑셀 칸 글자 → 코드. 표시 이름('면상')이나 코드('planar') 둘 다 받는다.
 * 공백·대소문자·대시 모양(− – -) 차이는 무시한다.
 * 끝의 괄호 설명을 뺀 이름('왼쪽')도 받되, 그 이름이 표에서 하나로 정해질 때만이다('균열'은 넷이라 안 됨).
 * 못 찾으면 null.
 */
export function codeFromCell<T extends string>(table: CodeTable<T>, cell: string): T | null {
  const n = normalizeCell(cell)
  if (n === '') return null
  const codes = codesOf(table)
  for (const code of codes) {
    if (normalizeCell(code) === n || normalizeCell(table[code]) === n) return code
  }
  const hits = codes.filter((code) => normalizeCell(stripHint(table[code])) === n)
  return hits.length === 1 ? (hits[0] ?? null) : null
}
