/**
 * 전문가용 엑셀 양식의 칸 정의 (단일 출처, 런타임 의존성 없음).
 *
 * 0단계에서 전문가가 OmniPC 로 X3 12T-SV 4개 파일을 판독해 이 양식에 적는다.
 * 칸은 앱 기록 스키마(types.ts)와 같아서, 1a 단계에서 엑셀을 그대로 가져와 앱 기록과 mm 로 비교한다.
 * 엑셀에서 온 지시 기록은 앵커 없이 mm 만 있다(coordSource = 'imported-mm').
 *
 * 칸마다: key(시트 안에서 유일), 시트, 한국어 머리글(단위 포함), 형식, 열거값(표시 이름 ↔ 코드),
 * 필수 여부, 도움말 한 줄, 스키마 칸 경로(target), 값 범위(rule), 조건부 필수(requiredWhen).
 *
 * 필수 규칙(테스트로 묶음): target 이 바로 이어지는 칸은
 *   필수 ⇔ 스키마에서 늘 값이 있어야 하는 칸 && 빈 칸 기본값(emptyValue)이 없음 && 앱이 채우는 칸(appFilled)이 아님.
 * via 가 있는 칸은 가져올 때 바꿔 넣는다(파일명 → sha256, 그룹 → 그룹 번호, 판독자 시트 → 모든 줄, 시각 → 작업 이벤트 등).
 *
 * 가져오기 규칙 (1a 단계에서 구현):
 * - '판독자' 시트 한 줄이 이 파일의 모든 지시·검토구간·작업시간 줄에 붙는다(라벨 세트 키 = sha256 · 라벨러 · 지침서 버전 · 판독 단계).
 *   라벨러 ID·판독 단계가 비면 가져오기를 막는다. 파일 이름으로 라벨러를 가르지 않는다.
 * - 판독 단계가 '설계값 대조'·'확정'이면 모든 줄을 '설계값 봤음'(knowledge.designValueSeen = true)으로 가져온다.
 * - requiredWhen 칸이 조건에서 비었으면: fallback 이 있으면 그 값 + 경고, 없으면 빈 값 그대로 두고 스키마 검사(validate.ts)가 판정한다.
 * - 'Ref 대비 (dB, 앱 계산)' 칸은 앱이 levels.ts 로 채운다(대조 전, refDbVerified = false). 엑셀 값은 쓰지 않는다.
 */
import { BOOL_LABEL, LABEL_CODE_TABLES, codesOf, codeFromCell, normalizeCell, type LabelCodeTableName } from './codes'
import type { LabelEntity } from './validate'

export type LabelSheetId = 'reader' | 'file' | 'indication' | 'review' | 'physical' | 'worktime'

export interface LabelSheet {
  id: LabelSheetId
  /** 엑셀 시트 이름 */
  name: string
  help: string
  /** 적을 수 있는 줄 수 상한 (없으면 제한 없음). 판독자 시트는 한 줄 */
  maxRows?: number
}

/** 시트 순서 = 엑셀 탭 순서 */
export const LABEL_SHEETS: readonly LabelSheet[] = [
  { id: 'reader', name: '판독자', help: '이 파일을 누가 어느 단계로 적었는지. 한 줄만 적습니다(파일의 모든 줄에 붙음).', maxRows: 1 },
  { id: 'file', name: '파일', help: '파일마다 한 줄. 기준점·방향·두께를 적습니다.' },
  { id: 'indication', name: '지시', help: '지시마다 한 줄. OmniPC 에서 읽은 값을 적습니다. 결함이 아닌 형상 에코도 적습니다.' },
  { id: 'review', name: '검토구간', help: '검토를 마친 구간, 품질 불량 구간, 기준 미만 지시를 적습니다.' },
  { id: 'physical', name: '물리결함', help: '시편 설계·인증값. 결함마다 한 줄 (설계값을 아는 사람만 적습니다).' },
  { id: 'worktime', name: '작업시간', help: '파일마다 판독 시작·끝, 보고서·라벨 추가 작업 시간. 판독시간 기준선이 됩니다.' }
]

export type ColumnFormat = 'number' | 'text' | 'enum' | 'bool' | 'time'

/**
 * 가져올 때 바꿔 넣는 방법
 * - file-name: 파일명 → 그 파일의 sha256 ('파일' 시트나 catalog 에서 찾음)
 * - scan-group: '섹토리얼 Skew 90' 같은 기법 × 스큐 → 그 파일에서 기법·스큐가 같은 그룹의 번호 (둘 이상이면 확인을 물음)
 * - signed-unit: '+1' / '-1' → 숫자 1 / −1
 * - sheet-meta: '판독자' 시트 한 줄 → 그 파일의 모든 지시 기록·검토 구간·작업 이벤트의 같은 칸
 * - event-*: 작업시간 시트 한 줄 → 작업 이벤트 여러 개 (파일 열기·닫기·보고서·라벨 추가 작업·유휴), 메모는 세부에
 */
export type ColumnVia =
  | 'file-name'
  | 'scan-group'
  | 'signed-unit'
  | 'sheet-meta'
  | 'event-file-open'
  | 'event-file-close'
  | 'event-report-minutes'
  | 'event-label-extra-minutes'
  | 'event-idle-minutes'
  | 'event-tool'
  | 'event-note'

export interface ColumnTarget {
  entity: LabelEntity
  /** 칸 경로 ('derived.scanStartMm'). 목록 칸은 원소 칸 이름으로 바로 이어 적는다 */
  path: string
  via?: ColumnVia
}

export interface EnumValue {
  code: string
  label: string
}

/**
 * 엑셀 입력 검사 (양식 생성기가 데이터 유효성으로 건다). 숫자·시각 칸만.
 * 범위는 스키마 검사(validate.ts)보다 좁게 잡아 흔한 실수를 막는다(테스트: 스키마 범위 안인지).
 */
export interface ColumnRule {
  min?: number
  max?: number
  /** 정수만 */
  int?: boolean
  /** 같은 줄의 이 칸(key) 값 이상이어야 함 (끝 ≥ 시작) */
  atLeastKey?: string
  /** '파일' 시트에 적은 그 파일 두께 × 이 배수 이하 (실제 깊이 ≤ t, 펼친 깊이 ≤ 4t). 두께가 비면 max 로 본다 */
  maxThicknessTimes?: number
}

/** 다른 칸 값이 codes 중 하나일 때 꼭 적어야 하는 칸 */
export interface RequiredWhen {
  /** 같은 시트의 칸 key */
  key: string
  codes: readonly string[]
  /** 비었을 때 가져오기가 넣는 코드 (경고와 함께). 없으면 빈 값 그대로 */
  fallback?: string
}

export interface LabelColumn {
  sheet: LabelSheetId
  key: string
  /** 한국어 머리글 (단위 포함) */
  header: string
  format: ColumnFormat
  /** format = 'enum' 일 때 codes.ts 표 이름 */
  enumTable: LabelCodeTableName | null
  /** format = 'enum' 일 때 표시 이름 ↔ 코드 (표 순서) */
  enumValues: readonly EnumValue[]
  required: boolean
  help: string
  /** 스키마 칸. null = 스키마 밖 보조 칸 */
  target: ColumnTarget | null
  /** 빈 칸일 때 넣는 값 (없으면 null) */
  emptyValue?: string | number | boolean
  /** 앱이 가져올 때 채우는 칸 (전문가가 비워도 됨) */
  appFilled?: boolean
  /** 숫자·시각 칸의 입력 검사 */
  rule?: ColumnRule
  /** 조건부 필수 */
  requiredWhen?: RequiredWhen
}

type ColumnSpec = Omit<LabelColumn, 'sheet' | 'enumValues' | 'enumTable' | 'required'> & {
  enumTable?: LabelCodeTableName
  required?: boolean
}

function enumValuesOf(table: LabelCodeTableName): EnumValue[] {
  const t = LABEL_CODE_TABLES[table] as Readonly<Record<string, string>>
  return codesOf(t).map((code) => ({ code, label: t[code] ?? code }))
}

function sheet(id: LabelSheetId, specs: readonly ColumnSpec[]): LabelColumn[] {
  return specs.map((s) => ({
    ...s,
    sheet: id,
    required: s.required ?? false,
    enumTable: s.enumTable ?? null,
    enumValues: s.enumTable ? enumValuesOf(s.enumTable) : []
  }))
}

const FA = 'FileAlignment' as const
const IR = 'IndicationRecord' as const
const RI = 'ReviewInterval' as const
const PD = 'PhysicalDefect' as const
const WE = 'WorkEvent' as const

// 자주 쓰는 범위
const SCAN: ColumnRule = { min: -1000, max: 10000 }
const V_RANGE: ColumnRule = { min: -100, max: 100 }
const DEPTH_T: ColumnRule = { min: 0, max: 40, maxThicknessTimes: 1 }
const AMP: ColumnRule = { min: 0, max: 800 }
const ANGLE_DEG: ColumnRule = { min: 0, max: 90 }
const LEN: ColumnRule = { min: 0, max: 10000 }
const MINUTES: ColumnRule = { min: 0, max: 1440 }

const IS_DEFECT: RequiredWhen = { key: 'kind', codes: ['defect'] }
const IS_REVIEWED: RequiredWhen = { key: 'kind', codes: ['reviewed'] }

// ───────────────────────────── 판독자 ─────────────────────────────

const READER_COLUMNS = sheet('reader', [
  {
    key: 'labelerId',
    header: '라벨러 ID',
    format: 'text',
    required: true,
    help: '판독자의 짧은 ID (예: kim-l2). 두 사람이 같은 파일을 보면 서로 다른 ID 를 씁니다. 이 파일의 모든 줄에 붙습니다.',
    target: { entity: IR, path: 'labelerId', via: 'sheet-meta' }
  },
  {
    key: 'readingStage',
    header: '판독 단계',
    format: 'enum',
    enumTable: 'READING_STAGE',
    required: true,
    help: '블라인드 = 설계값·결함정보를 보지 않고 판독 / 설계값 대조 = 설계값을 보고 고치거나 더함 / 확정 = Level III 조정 결과.',
    target: { entity: IR, path: 'readingStage', via: 'sheet-meta' }
  },
  {
    key: 'guidelineVersion',
    header: '지침서 버전',
    format: 'text',
    help: '따른 지침서 판. 비우면 v1.',
    target: { entity: IR, path: 'guidelineVersion', via: 'sheet-meta' },
    emptyValue: 'v1'
  },
  {
    key: 'readerSource',
    header: '판독 출처',
    format: 'enum',
    enumTable: 'READER_SOURCE',
    help: '우리 전문가 / 전문기관 / AI. 비우면 우리 전문가. 전문기관 판독을 이 양식으로 받으면 전문기관.',
    target: { entity: IR, path: 'readerSource', via: 'sheet-meta' },
    emptyValue: 'expert'
  },
  {
    key: 'organization',
    header: '기관',
    format: 'text',
    help: '전문기관 판독이면 기관 이름. 우리 전문가면 비웁니다.',
    target: { entity: IR, path: 'readerDetail.organization', via: 'sheet-meta' },
    requiredWhen: { key: 'readerSource', codes: ['agency'] }
  },
  {
    key: 'qualification',
    header: '자격',
    format: 'text',
    help: '예: UT Level II, PAUT Level II.',
    target: { entity: IR, path: 'readerDetail.qualification', via: 'sheet-meta' }
  }
])

// ───────────────────────────── 파일 ─────────────────────────────

const FILE_COLUMNS = sheet('file', [
  {
    key: 'fileName',
    header: '파일명',
    format: 'text',
    required: true,
    help: 'OmniPC 에서 연 .nde 파일 이름 (확장자 포함). 다른 시트와 이 이름으로 잇습니다.',
    target: { entity: FA, path: 'fileName' }
  },
  {
    key: 'sha256',
    header: 'SHA-256',
    format: 'text',
    help: '비워 두면 앱이 가져올 때 파일 이름으로 찾아 채웁니다.',
    target: { entity: FA, path: 'sha256' },
    appFilled: true
  },
  { key: 'specimenId', header: '시편 ID', format: 'text', help: '예: PL23833. 모르면 비웁니다.', target: { entity: FA, path: 'specimenId' } },
  {
    key: 'weldId',
    header: '용접부 ID',
    format: 'text',
    help: "시편 안 용접부 이름 (예: W1). 하나뿐이면 비워도 되지만, '물리결함' 시트와 같게 적습니다.",
    target: { entity: FA, path: 'weldId' }
  },
  {
    key: 'datumKind',
    header: '기준점 정의',
    format: 'enum',
    enumTable: 'DATUM_KIND',
    help: '위치를 재는 시작점. 판 끝 / 관 12시 / 기타.',
    target: { entity: FA, path: 'datumKind' }
  },
  {
    key: 'datumDescription',
    header: '기준점 설명',
    format: 'text',
    help: "예: '판 왼쪽 끝 V 표시'. 기타를 골랐으면 꼭 적습니다.",
    target: { entity: FA, path: 'datumDescription' }
  },
  {
    key: 'datumUMm',
    header: '기준점 위치 U (mm)',
    format: 'number',
    help: '기준점이 OmniPC 스캔축 몇 mm 에 오는지.',
    target: { entity: FA, path: 'datumUMm' },
    rule: SCAN
  },
  {
    key: 'direction',
    header: '스캔 방향',
    format: 'enum',
    enumTable: 'SCAN_DIRECTION',
    help: "판: +1 = 스캔축 값이 커지면 기준점에서 멀어짐. 관: +1 = '기준 쪽'(Skew 90 쪽 칸의 상류)에서 용접부를 볼 때 시계 방향.",
    target: { entity: FA, path: 'direction', via: 'signed-unit' }
  },
  {
    key: 'skew90Side',
    header: 'Skew 90 쪽',
    format: 'enum',
    enumTable: 'SKEW90_SIDE',
    help: 'Skew 90 탐촉자가 놓인 쪽 (빔은 반대쪽으로 감). 판: 시편에 표시한 L/R. 관: 상류(기준 쪽)/하류.',
    target: { entity: FA, path: 'skew90Side' }
  },
  {
    key: 'alignmentAssumed',
    header: '가설 정렬',
    format: 'bool',
    help: '기준점·방향을 확인하지 못해 가설로 적었으면 예 (예: X3 스캔 0 mm = 판 끝, +1). 확인하면 아니오로 바꿉니다.',
    target: { entity: FA, path: 'alignmentAssumed' },
    emptyValue: false
  },
  {
    key: 'thicknessMm',
    header: '두께 (mm)',
    format: 'number',
    help: '얇은 쪽 두께. 길이 측정법이 이 값으로 갈리고(8 mm), 다른 시트의 깊이 검사에 쓰입니다.',
    target: { entity: FA, path: 'thicknessMm' },
    rule: { min: 0.1, max: 100 }
  },
  {
    key: 'outerDiameterMm',
    header: '외경 (mm)',
    format: 'number',
    help: '관만 적습니다. 판은 비웁니다.',
    target: { entity: FA, path: 'outerDiameterMm' },
    rule: { min: 1, max: 3000 }
  },
  {
    key: 'overlapStartMm',
    header: '원주 겹침 시작 (mm)',
    format: 'number',
    help: '관을 한 바퀴 넘겨 스캔했을 때 겹친 구간의 시작 (스캔축 mm).',
    target: { entity: FA, path: 'overlapStartMm' },
    rule: SCAN
  },
  {
    key: 'overlapEndMm',
    header: '원주 겹침 끝 (mm)',
    format: 'number',
    help: '겹친 구간의 끝 (스캔축 mm).',
    target: { entity: FA, path: 'overlapEndMm' },
    rule: { ...SCAN, atLeastKey: 'overlapStartMm' }
  },
  {
    key: 'probeClSkew90Mm',
    header: 'Skew 90 탐촉자–CL 거리 (mm)',
    format: 'number',
    help: 'Skew 90 쐐기 앞끝에서 용접 중심선까지 실제로 잰 거리. V 좌표의 근거입니다. 모르면 비웁니다.',
    target: { entity: FA, path: 'probeClSkew90Mm' },
    rule: { min: 0, max: 200 }
  },
  {
    key: 'probeClSkew270Mm',
    header: 'Skew 270 탐촉자–CL 거리 (mm)',
    format: 'number',
    help: 'Skew 270 쐐기 앞끝에서 용접 중심선까지 실제로 잰 거리.',
    target: { entity: FA, path: 'probeClSkew270Mm' },
    rule: { min: 0, max: 200 }
  },
  {
    key: 'trackDeviationMaxMm',
    header: '최대 위치 편차 (mm)',
    format: 'number',
    help: '스캔 중 탐촉자–용접선 위치가 가장 크게 벗어난 값. 시방서 허용 ±1 mm (t<8), ±2 mm (t≥8).',
    target: { entity: FA, path: 'trackDeviationMaxMm' },
    rule: { min: 0, max: 50 }
  },
  { key: 'evidence', header: '근거', format: 'text', help: '시작점 사진 파일 이름 등.', target: { entity: FA, path: 'evidence' } },
  { key: 'note', header: '메모', format: 'text', help: '자유롭게 적습니다.', target: { entity: FA, path: 'note' }, emptyValue: '' }
])

// ───────────────────────────── 지시 ─────────────────────────────

const INDICATION_COLUMNS = sheet('indication', [
  {
    key: 'fileName',
    header: '파일명',
    format: 'text',
    required: true,
    help: "'파일' 시트의 파일명과 같게 적습니다.",
    target: { entity: IR, path: 'sha256', via: 'file-name' }
  },
  {
    key: 'externalRef',
    header: '지시 번호',
    format: 'text',
    help: '파일 안에서 지시를 가르는 번호 (1, 2, 3 …). 대조 단계에서 새로 더한 지시는 C1, C2 … 로 적습니다.',
    target: { entity: IR, path: 'externalRef' }
  },
  {
    key: 'kind',
    header: '기록 구분',
    format: 'enum',
    enumTable: 'RECORD_KIND',
    required: true,
    help: '결함 / 형상 에코(루트·캡처럼 정상 형상) / 형상 불완전(단차·언더컷 등).',
    target: { entity: IR, path: 'kind' }
  },
  {
    key: 'group',
    header: '그룹 (기법·Skew)',
    format: 'enum',
    enumTable: 'SCAN_GROUP',
    help: '가장 잘 보인(최대 진폭) 그룹. 앱이 그 파일에서 기법·스큐가 같은 그룹 번호로 바꿉니다.',
    target: { entity: IR, path: 'signal.peak.groupId', via: 'scan-group' }
  },
  {
    key: 'scanStartMm',
    header: '스캔 시작 (mm)',
    format: 'number',
    required: true,
    help: 'OmniPC 스캔축 값 그대로. 길이를 잰 구간의 시작. 기준점 변환은 앱이 합니다.',
    target: { entity: IR, path: 'derived.scanStartMm' },
    rule: SCAN
  },
  {
    key: 'scanEndMm',
    header: '스캔 끝 (mm)',
    format: 'number',
    required: true,
    help: '시작보다 크거나 같아야 합니다.',
    target: { entity: IR, path: 'derived.scanEndMm' },
    rule: { ...SCAN, atLeastKey: 'scanStartMm' }
  },
  {
    key: 'peakScanMm',
    header: '최대 진폭 위치 스캔 (mm)',
    format: 'number',
    help: '최대 진폭이 나온 스캔축 위치.',
    target: { entity: IR, path: 'signal.peak.scanMm' },
    rule: SCAN
  },
  {
    key: 'peakAngleDeg',
    header: '최대 진폭 각도 (°)',
    format: 'number',
    help: '최대 진폭이 나온 빔의 굴절각.',
    target: { entity: IR, path: 'signal.peak.angleDeg' },
    rule: ANGLE_DEG
  },
  {
    key: 'peakDepthMm',
    header: '최대 진폭 깊이 (mm)',
    format: 'number',
    help: '최대 진폭 위치의 실제 깊이 (표면에서, 레그를 접은 값). 두께보다 클 수 없습니다.',
    target: { entity: IR, path: 'signal.peak.depthMm' },
    rule: DEPTH_T
  },
  {
    key: 'vMinMm',
    header: 'V 최소 (mm, CL 기준)',
    format: 'number',
    help: '용접 중심선(CL)에서 잰 가로 위치의 작은 쪽.',
    target: { entity: IR, path: 'derived.vMinMm' },
    rule: V_RANGE
  },
  {
    key: 'vMaxMm',
    header: 'V 최대 (mm, CL 기준)',
    format: 'number',
    help: '가로 위치의 큰 쪽.',
    target: { entity: IR, path: 'derived.vMaxMm' },
    rule: { ...V_RANGE, atLeastKey: 'vMinMm' }
  },
  {
    key: 'depthTopMm',
    header: '실제 깊이 위 (mm)',
    format: 'number',
    help: '결함 줄은 꼭 적습니다: 최대 진폭 단면 S-scan 에서 평가 기준을 넘는 에코의 윗끝 실제 깊이 (높이용 팁 깊이와 다를 수 있음).',
    target: { entity: IR, path: 'derived.depthTopMm' },
    rule: DEPTH_T,
    requiredWhen: IS_DEFECT
  },
  {
    key: 'depthBottomMm',
    header: '실제 깊이 아래 (mm)',
    format: 'number',
    help: '결함 줄은 꼭 적습니다: 같은 에코의 아랫끝 실제 깊이. 위보다 크거나 같아야 합니다.',
    target: { entity: IR, path: 'derived.depthBottomMm' },
    rule: { ...DEPTH_T, atLeastKey: 'depthTopMm' },
    requiredWhen: IS_DEFECT
  },
  {
    key: 'maxAmplitudePct',
    header: '최대 진폭 (%FSH)',
    format: 'number',
    help: '소프트 이득 0 dB(파일 이득 그대로)에서 읽은 값.',
    target: { entity: IR, path: 'signal.maxAmplitudePct' },
    rule: AMP
  },
  {
    key: 'refDb',
    header: 'Ref 대비 (dB, 앱 계산)',
    format: 'number',
    help: '비워 둡니다. 앱이 최대 진폭과 파일 Ref 추정으로 계산합니다(대조 전). OmniPC 의 AdBA 같은 읽기값은 Ref 기준이 아닐 수 있어 적지 않습니다.',
    target: { entity: IR, path: 'signal.refDb' },
    appFilled: true,
    rule: { min: -60, max: 40 }
  },
  { key: 'saturated', header: '포화', format: 'bool', help: '최대 진폭이 200 % 이상이면 예.', target: { entity: IR, path: 'signal.saturated' } },
  {
    key: 'defectType',
    header: '결함 종류',
    format: 'enum',
    enumTable: 'METALLURGICAL_TYPE',
    help: "기록 구분이 결함이면 고릅니다. 세부를 모르면 '… (세부 미상)', 면상·체적도 모르면 '면상 추정'·'체적 추정'.",
    target: { entity: IR, path: 'defectType' },
    requiredWhen: IS_DEFECT
  },
  {
    key: 'geometricEchoKind',
    header: '형상 에코 세부',
    format: 'enum',
    enumTable: 'GEOMETRIC_ECHO_KIND',
    help: "기록 구분이 형상 에코이면 꼭 고릅니다 (비우면 앱이 '기타'로 가져오고 경고).",
    target: { entity: IR, path: 'geometricEcho.kind' },
    requiredWhen: { key: 'kind', codes: ['geometric-echo'], fallback: 'other' }
  },
  {
    key: 'geometricImperfectionKind',
    header: '형상 불완전 세부',
    format: 'enum',
    enumTable: 'GEOMETRIC_IMPERFECTION_KIND',
    help: '기록 구분이 형상 불완전이면 꼭 고릅니다 (비우면 그 줄은 가져오지 못함).',
    target: { entity: IR, path: 'geometricImperfection.kind' },
    requiredWhen: { key: 'kind', codes: ['geometric-imperfection'] }
  },
  {
    key: 'character',
    header: '판정 특성',
    format: 'enum',
    enumTable: 'JUDGMENT_CHARACTER',
    help: '면상(균열·융합불량·용입불량) / 체적(기공·슬래그).',
    target: { entity: IR, path: 'character.value' }
  },
  {
    key: 'alignedVolumetric',
    header: '일렬 체적 (면상 취급)',
    format: 'bool',
    help: '체적 지시가 일렬로 늘어서 면상으로 본 경우 예 (시방서 15절).',
    target: { entity: IR, path: 'character.alignedVolumetric' },
    emptyValue: false
  },
  {
    key: 'surface',
    header: '표면',
    format: 'enum',
    enumTable: 'SURFACE_CLASS',
    help: '표면 열림(윗면·바닥에 이어짐) / 내재. 시방서 표 14 의 h3·h2 를 가릅니다.',
    target: { entity: IR, path: 'surface' }
  },
  {
    key: 'pointLike',
    header: '점 같은 지시',
    format: 'bool',
    help: '길이가 아주 짧은 점 모양이면 예 (시방서 16.3: 누적 길이에서 빼고 150 mm 당 개수로 셈). 표면 칸과 따로 고릅니다.',
    target: { entity: IR, path: 'pointLike' }
  },
  {
    key: 'zone',
    header: '위치 구분',
    format: 'enum',
    enumTable: 'WELD_ZONE',
    help: '루트 / 측벽 / 캡 / 몸체 / 토우·HAZ.',
    target: { entity: IR, path: 'location.zone' }
  },
  {
    key: 'side',
    header: '좌우',
    format: 'enum',
    enumTable: 'WELD_SIDE',
    help: '시편에 표시한 왼쪽·오른쪽 (파일 V 부호가 아님). 가운데이거나 시편 표시를 모르면 비웁니다.',
    target: { entity: IR, path: 'location.side' }
  },
  {
    key: 'lengthMm',
    header: '길이 (mm)',
    format: 'number',
    help: '측정법에 따른 최종 길이 (t<8 은 곡률 보정 뒤 l_c).',
    target: { entity: IR, path: 'length.valueMm' },
    rule: LEN
  },
  {
    key: 'lengthMethod',
    header: '길이 측정법',
    format: 'enum',
    enumTable: 'LENGTH_METHOD',
    help: "t≥8 은 평가 기준 초과 구간, t<8 은 6 dB 강하 + 곡률 보정. 형상 띠 위 지시를 바탕 대비로 쟀으면 '기타'.",
    target: { entity: IR, path: 'length.method' }
  },
  {
    key: 'lengthUncorrectedMm',
    header: '보정 전 길이 (mm)',
    format: 'number',
    help: '6 dB 강하 + 곡률 보정일 때 꼭 적습니다: 보정 전 표면 길이 l_s.',
    target: { entity: IR, path: 'length.uncorrectedMm' },
    rule: LEN,
    requiredWhen: { key: 'lengthMethod', codes: ['6db-curvature'] }
  },
  {
    key: 'lengthGroup',
    header: '길이 잰 그룹',
    format: 'enum',
    enumTable: 'SCAN_GROUP',
    help: '길이를 잰 그룹. 최대 진폭 그룹과 같으면 비워도 됩니다.',
    target: { entity: IR, path: 'length.groupId', via: 'scan-group' }
  },
  {
    key: 'lengthAngleDeg',
    header: '길이 잰 각도 (°)',
    format: 'number',
    help: '길이를 잰 빔의 굴절각. 포화 빔이 여럿이면 어느 빔으로 쟀는지 꼭 적습니다.',
    target: { entity: IR, path: 'length.angleDeg' },
    rule: ANGLE_DEG
  },
  {
    key: 'lengthThresholdPct',
    header: '길이 문턱 (%FSH)',
    format: 'number',
    help: '길이를 잰 진폭 문턱 (예: X3 평가 기준 추정 32). 띠 바탕 대비로 쟀으면 그 문턱.',
    target: { entity: IR, path: 'length.thresholdPct' },
    rule: AMP
  },
  {
    key: 'heightMethod',
    header: '높이 입력 방식',
    format: 'enum',
    enumTable: 'HEIGHT_METHOD',
    help: '상하 팁 / 팁 + 표면 / 노정 시간 / −6 dB 높이(참고, 시방서 외) / 측정 불가. 위에서부터 차례로 고릅니다.',
    target: { entity: IR, path: 'height.method' }
  },
  {
    key: 'heightMm',
    header: '높이 (mm)',
    format: 'number',
    help: "'측정 불가'면 비웁니다. 두께보다 클 수 없습니다.",
    target: { entity: IR, path: 'height.valueMm' },
    rule: DEPTH_T
  },
  {
    key: 'existenceConfidence',
    header: '존재 확신도',
    format: 'enum',
    enumTable: 'CONFIDENCE',
    required: true,
    help: '지시가 실제로 있는지: 확실 / 보통 / 불확실 (불확실은 학습에서 뺌).',
    target: { entity: IR, path: 'existenceConfidence' }
  },
  {
    key: 'typeConfidence',
    header: '종류 확신도',
    format: 'enum',
    enumTable: 'CONFIDENCE',
    help: '결함 종류가 맞는지: 확실 / 보통 / 불확실.',
    target: { entity: IR, path: 'typeConfidence' }
  },
  {
    key: 'designValueSeen',
    header: '설계값 봤는지',
    format: 'bool',
    help: "블라인드 단계에서 판독 전에 설계값·결함정보를 봤으면 예. '설계값 대조'·'확정' 단계 파일은 앱이 모든 줄을 예로 봅니다.",
    target: { entity: IR, path: 'knowledge.designValueSeen' }
  },
  {
    key: 'physicalDefectId',
    header: '물리 결함 ID',
    format: 'text',
    help: "대조 단계에서만: '물리결함' 시트의 ID (D1, D2 …). 같은 결함이면 같은 ID.",
    target: { entity: IR, path: 'physicalDefectId' }
  },
  { key: 'note', header: '메모', format: 'text', help: '판단 근거, 헷갈린 점.', target: { entity: IR, path: 'note' }, emptyValue: '' }
])

// ───────────────────────────── 검토구간 ─────────────────────────────

const REVIEW_COLUMNS = sheet('review', [
  {
    key: 'fileName',
    header: '파일명',
    format: 'text',
    required: true,
    help: "'파일' 시트의 파일명과 같게 적습니다.",
    target: { entity: RI, path: 'sha256', via: 'file-name' }
  },
  {
    key: 'kind',
    header: '구간 종류',
    format: 'enum',
    enumTable: 'REVIEW_KIND',
    required: true,
    help: '검토 완료 / 품질 불량 / 기준 미만 지시.',
    target: { entity: RI, path: 'kind' }
  },
  {
    key: 'group',
    header: '그룹 (기법·Skew)',
    format: 'enum',
    enumTable: 'SCAN_GROUP',
    help: '비우면 모든 그룹.',
    target: { entity: RI, path: 'groupId', via: 'scan-group' }
  },
  {
    key: 'scanStartMm',
    header: '스캔 시작 (mm)',
    format: 'number',
    required: true,
    help: 'OmniPC 스캔축 값.',
    target: { entity: RI, path: 'scanStartMm' },
    rule: SCAN
  },
  {
    key: 'scanEndMm',
    header: '스캔 끝 (mm)',
    format: 'number',
    required: true,
    help: '시작보다 크거나 같아야 합니다.',
    target: { entity: RI, path: 'scanEndMm' },
    rule: { ...SCAN, atLeastKey: 'scanStartMm' }
  },
  {
    key: 'gateDepthTopMm',
    header: '게이트 깊이 위 (mm, 펼친 깊이)',
    format: 'number',
    help: '검토 완료일 때 꼭 적습니다: 본 C-scan 게이트 시작을 OmniPC 에 보이는 그대로(펼친 깊이). 예: X3 게이트 A 7.',
    target: { entity: RI, path: 'gate.depthTopMm' },
    rule: { min: 0, max: 160, maxThicknessTimes: 4 },
    requiredWhen: IS_REVIEWED
  },
  {
    key: 'gateDepthBottomMm',
    header: '게이트 깊이 아래 (mm, 펼친 깊이)',
    format: 'number',
    help: '검토 완료일 때 꼭 적습니다: 게이트 끝(펼친 깊이). 예: X3 게이트 A 28. 위보다 크거나 같아야 합니다.',
    target: { entity: RI, path: 'gate.depthBottomMm' },
    rule: { min: 0, max: 160, maxThicknessTimes: 4, atLeastKey: 'gateDepthTopMm' },
    requiredWhen: IS_REVIEWED
  },
  {
    key: 'legMin',
    header: '레그 최소',
    format: 'number',
    help: '검토 완료일 때: 게이트가 덮는 레그의 시작 (1부터, 정수). 예: X3 게이트 A → 1.',
    target: { entity: RI, path: 'gate.legMin' },
    rule: { min: 1, max: 4, int: true },
    requiredWhen: IS_REVIEWED
  },
  {
    key: 'legMax',
    header: '레그 최대',
    format: 'number',
    help: '검토 완료일 때: 레그 범위의 끝 (정수). 예: X3 게이트 A → 3.',
    target: { entity: RI, path: 'gate.legMax' },
    rule: { min: 1, max: 4, int: true, atLeastKey: 'legMin' },
    requiredWhen: IS_REVIEWED
  },
  {
    key: 'reason',
    header: '품질 불량 사유',
    format: 'enum',
    enumTable: 'QUALITY_BAD_REASON',
    help: '품질 불량이면 꼭 고릅니다 (비우면 그 줄은 가져오지 못함): 커플링 / 누락 / 포화 / 잡음 / 시간 범위 / 감도.',
    target: { entity: RI, path: 'reason' },
    requiredWhen: { key: 'kind', codes: ['quality-bad'] }
  },
  { key: 'note', header: '메모', format: 'text', help: '자유롭게 적습니다.', target: { entity: RI, path: 'note' }, emptyValue: '' }
])

// ───────────────────────────── 물리결함 ─────────────────────────────

const PHYSICAL_COLUMNS = sheet('physical', [
  { key: 'specimenId', header: '시편 ID', format: 'text', required: true, help: "'파일' 시트의 시편 ID 와 같게 적습니다.", target: { entity: PD, path: 'specimenId' } },
  { key: 'physicalDefectId', header: '물리 결함 ID', format: 'text', required: true, help: '시편 안에서 겹치지 않게 (D1, D2 …).', target: { entity: PD, path: 'id' } },
  { key: 'weldId', header: '용접부 ID', format: 'text', help: "'파일' 시트의 용접부 ID 와 같게. 하나뿐이면 비워도 됩니다.", target: { entity: PD, path: 'weldId' } },
  { key: 'designType', header: '설계 종류', format: 'enum', enumTable: 'METALLURGICAL_TYPE', help: '설계·인증 문서의 결함 종류.', target: { entity: PD, path: 'design.type' } },
  { key: 'designZone', header: '설계 위치 구분', format: 'enum', enumTable: 'WELD_ZONE', help: '루트 / 측벽 / 캡 / 몸체 / 토우·HAZ.', target: { entity: PD, path: 'design.zone' } },
  { key: 'designSide', header: '설계 좌우', format: 'enum', enumTable: 'WELD_SIDE', help: '시편 표시 기준. 가운데면 비웁니다.', target: { entity: PD, path: 'design.side' } },
  { key: 'startMm', header: '시작 (mm, 기준점에서)', format: 'number', help: '기준점에서 결함 시작까지.', target: { entity: PD, path: 'design.startMm' }, rule: SCAN },
  {
    key: 'endMm',
    header: '끝 (mm, 기준점에서)',
    format: 'number',
    help: '기준점에서 결함 끝까지. 시작보다 크거나 같아야 합니다.',
    target: { entity: PD, path: 'design.endMm' },
    rule: { ...SCAN, atLeastKey: 'startMm' }
  },
  {
    key: 'centerMm',
    header: '중심 (mm, 기준점에서)',
    format: 'number',
    help: '시작·끝을 모르고 한 점만 알 때 (예: 결함정보 문서의 위치 값).',
    target: { entity: PD, path: 'design.centerMm' },
    rule: SCAN
  },
  {
    key: 'depthMm',
    header: '깊이 (mm)',
    format: 'number',
    help: '표면에서. 윗끝인지 중심인지 메모에 적습니다.',
    target: { entity: PD, path: 'design.depthMm' },
    rule: { min: 0, max: 100 }
  },
  { key: 'lengthMm', header: '길이 (mm)', format: 'number', help: '설계 길이.', target: { entity: PD, path: 'design.lengthMm' }, rule: LEN },
  { key: 'heightMm', header: '높이 (mm)', format: 'number', help: '설계 높이 (두께 방향).', target: { entity: PD, path: 'design.heightMm' }, rule: { min: 0, max: 100 } },
  {
    key: 'tiltDeg',
    header: '기울기 (°)',
    format: 'number',
    help: '설계 기울기. 없으면 비웁니다.',
    target: { entity: PD, path: 'design.tiltDeg' },
    rule: { min: -180, max: 180 }
  },
  {
    key: 'source',
    header: '출처',
    format: 'enum',
    enumTable: 'DESIGN_SOURCE',
    required: true,
    help: '제작사 결함 보고서 / 설계도 / PCN 시트(1인 판독) / 없음.',
    target: { entity: PD, path: 'source' }
  },
  {
    key: 'confirmation',
    header: '확인 수준',
    format: 'enum',
    enumTable: 'CONFIRMATION_LEVEL',
    required: true,
    help: "미확인(작성자·근거를 모르는 문서) / 설계만 / 제작 기록 / RT / 절단.",
    target: { entity: PD, path: 'confirmation' }
  },
  {
    key: 'dataOrigin',
    header: '데이터 출처',
    format: 'enum',
    enumTable: 'DATA_ORIGIN',
    help: '비우면 실측.',
    target: { entity: PD, path: 'dataOrigin' },
    emptyValue: 'measured'
  },
  { key: 'parentId', header: '부모 결함 ID', format: 'text', help: '시뮬레이션·합성 삽입의 바탕 결함.', target: { entity: PD, path: 'parentId' } },
  { key: 'generatorTool', header: '생성 도구', format: 'text', help: '시뮬레이션·합성 도구 이름.', target: { entity: PD, path: 'generatorTool' } },
  { key: 'generatorVersion', header: '생성 도구 버전', format: 'text', help: '도구 버전.', target: { entity: PD, path: 'generatorVersion' } },
  { key: 'note', header: '메모', format: 'text', help: '자유롭게 적습니다.', target: { entity: PD, path: 'note' }, emptyValue: '' }
])

// ───────────────────────────── 작업시간 ─────────────────────────────

const WORKTIME_COLUMNS = sheet('worktime', [
  {
    key: 'fileName',
    header: '파일명',
    format: 'text',
    required: true,
    help: "'파일' 시트의 파일명과 같게 적습니다.",
    target: { entity: WE, path: 'sha256', via: 'file-name' }
  },
  {
    key: 'startedAt',
    header: '판독 시작',
    format: 'time',
    required: true,
    help: '날짜와 시각 (예: 2026-10-20 14:05, 한국 시간). 파일을 열어 판독을 시작한 때.',
    target: { entity: WE, path: 'at', via: 'event-file-open' }
  },
  {
    key: 'endedAt',
    header: '판독 끝',
    format: 'time',
    required: true,
    help: '그 파일의 지시를 다 적은 때. 시작보다 늦어야 합니다.',
    target: { entity: WE, path: 'at', via: 'event-file-close' },
    rule: { atLeastKey: 'startedAt' }
  },
  {
    key: 'reportMinutes',
    header: '보고서 작성 시간 (분)',
    format: 'number',
    help: '판독과 따로 보고서를 쓴 시간.',
    target: { entity: WE, path: 'detail', via: 'event-report-minutes' },
    rule: MINUTES
  },
  {
    key: 'labelExtraMinutes',
    header: '라벨 추가 작업 시간 (분)',
    format: 'number',
    help: '실제 판독에는 없는 라벨 전용 작업(형상 에코 적기, 게이트를 바꿔 다시 보기, 검토구간 적기)에 쓴 시간. 시작~끝 안에 든 시간입니다.',
    target: { entity: WE, path: 'detail', via: 'event-label-extra-minutes' },
    rule: MINUTES
  },
  {
    key: 'idleMinutes',
    header: '쉰 시간 (분)',
    format: 'number',
    help: '시작과 끝 사이에 쉬거나 다른 일을 한 시간.',
    target: { entity: WE, path: 'detail', via: 'event-idle-minutes' },
    rule: MINUTES
  },
  {
    key: 'tool',
    header: '사용 도구',
    format: 'enum',
    enumTable: 'WORK_TOOL',
    help: '비우면 OmniPC.',
    target: { entity: WE, path: 'tool', via: 'event-tool' },
    emptyValue: 'omnipc'
  },
  { key: 'note', header: '메모', format: 'text', help: '끊긴 사정 등.', target: { entity: WE, path: 'detail', via: 'event-note' }, emptyValue: '' }
])

// ───────────────────────────── 묶음 · 도우미 ─────────────────────────────

/** 모든 칸 (시트 순서, 시트 안 칸 순서 = 엑셀 열 순서) */
export const LABEL_COLUMNS: readonly LabelColumn[] = [
  ...READER_COLUMNS,
  ...FILE_COLUMNS,
  ...INDICATION_COLUMNS,
  ...REVIEW_COLUMNS,
  ...PHYSICAL_COLUMNS,
  ...WORKTIME_COLUMNS
]

/** 시트의 칸 (열 순서) */
export function columnsOf(sheetId: LabelSheetId): LabelColumn[] {
  return LABEL_COLUMNS.filter((c) => c.sheet === sheetId)
}

/** 시트의 머리글 줄 */
export function sheetHeaders(sheetId: LabelSheetId): string[] {
  return columnsOf(sheetId).map((c) => c.header)
}

/** 전체에서 유일한 칸 이름 ('indication.scanStartMm') */
export function columnId(c: Pick<LabelColumn, 'sheet' | 'key'>): string {
  return `${c.sheet}.${c.key}`
}

/** 머리글로 칸 찾기 (공백·대소문자·대시 모양 차이 무시). 없으면 null */
export function findColumnByHeader(sheetId: LabelSheetId, header: string): LabelColumn | null {
  const n = normalizeCell(header)
  return columnsOf(sheetId).find((c) => normalizeCell(c.header) === n) ?? null
}

/** 시트 이름으로 시트 찾기 */
export function findSheetByName(name: string): LabelSheet | null {
  const n = normalizeCell(name)
  return LABEL_SHEETS.find((s) => normalizeCell(s.name) === n) ?? null
}

/** 열거 칸 글자 → 코드 (표시 이름·코드 둘 다 받음). 열거 칸이 아니거나 못 찾으면 null */
export function enumCodeFromCell(column: LabelColumn, cell: string): string | null {
  if (column.format !== 'enum' || column.enumTable === null) return null
  return codeFromCell(LABEL_CODE_TABLES[column.enumTable] as Readonly<Record<string, string>>, cell)
}

/** 참/거짓 칸 글자 → 값. '예'·'아니오'·true·false·Y·N·O·X·1·0. 빈 칸·모르는 값은 null */
export function boolFromCell(cell: string): boolean | null {
  const n = normalizeCell(cell)
  if (n === '') return null
  if ([BOOL_LABEL.true, 'true', 'y', 'yes', 'o', '1', '참'].map(normalizeCell).includes(n)) return true
  if ([BOOL_LABEL.false, 'false', 'n', 'no', 'x', '0', '거짓'].map(normalizeCell).includes(n)) return false
  return null
}
