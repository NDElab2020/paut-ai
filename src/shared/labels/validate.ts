/**
 * 라벨 기록 검사 — JSON 가져오기와 레코드별 검사 (런타임 의존성 없음).
 *
 * 결과는 { ok, value, errors, warnings } 이고 문구는 모두 한국어다.
 * - 오류: 형식이 틀려 쓸 수 없는 값 (UUID·sha256·유한수·열거값, 서로 모순되는 칸).
 * - 경고: 쓸 수는 있지만 확인할 것 (빈 종류, 좌표 규칙 버전 차이, 모르는 칸 보존 등).
 *
 * 모르는 칸은 버리지 않고 value 에 그대로 남긴다(새 버전 앱이 더한 칸이 왕복해도 사라지지 않게).
 * 선택 칸(null 가능)이 아예 빠져 있으면 null 로 채우고 경고한다. 필수 칸이 빠지면 오류다.
 * schemaVersion 이 이 앱보다 새 것이면 다른 칸은 보지 않고 오류로 끝낸다.
 *
 * 칸 정의(*_FIELDS)는 types.ts 인터페이스와 typecheck 로 묶여 있다: 칸이 빠지거나 남거나,
 * null 가능 여부·열거값 표가 다르면 컴파일이 깨진다. 엑셀 양식(columns.ts) 검사도 이 정의를 쓴다.
 */
import {
  GEOMETRIC_IMPERFECTION_ISO,
  ISO_6520_1,
  LABEL_CODE_TABLES,
  METALLURGICAL_TYPE_INFO,
  defaultCharacterOf,
  isVolumetricType,
  type LabelCodeTableName
} from './codes'
import { versionTotal } from './versions'
import {
  LABEL_COORD_RULES_VERSION,
  LABEL_EXPORT_FORMAT,
  LABEL_SCHEMA_VERSION,
  type FileAlignment,
  type IndicationRecord,
  type LabelExportFile,
  type ObservationRow,
  type PhysicalDefect,
  type ReviewInterval,
  type VersionEntry,
  type WorkEvent
} from './types'

// ───────────────────────────── 결과 ─────────────────────────────

export interface LabelCheckResult<T> {
  ok: boolean
  /** ok 일 때만 값. 모르는 칸은 보존, 빠진 선택 칸은 null 로 채운 사본 */
  value: T | null
  errors: string[]
  warnings: string[]
}

/** 한 번에 보여 줄 문구 수 상한 (넘으면 '… n건 더') */
export const MAX_MESSAGES = 200

// ───────────────────────────── 칸 정의 언어 ─────────────────────────────

export interface NumberCheck {
  t: 'number'
  int?: boolean
  min?: number
  max?: number
  /** true 면 min 을 넘어야 함 (같으면 안 됨) */
  exclusiveMin?: boolean
}
export interface StringCheck {
  t: 'string'
  /** 빈 글자 금지 */
  nonEmpty?: boolean
}
export interface FormatCheck {
  t: 'uuid' | 'sha256' | 'iso-datetime' | 'iso6520'
}
export interface EnumCheck<V extends string> {
  t: 'enum'
  table: LabelCodeTableName
  codes: readonly V[]
}
export interface OneOfCheck<V extends number> {
  t: 'one-of'
  values: readonly V[]
}
export interface BoolCheck {
  t: 'bool'
}
export interface ArrayCheck<E> {
  t: 'array'
  of: Check<E>
}
export interface ObjectCheck<V> {
  t: 'object'
  fields: Fields<V>
}
/** 불투명 JSON (화면 스냅샷·이벤트 세부) */
export interface JsonCheck {
  t: 'json'
}

/** 값의 타입에 맞는 검사 (튜플 감싸기로 유니언 분배를 막음) */
export type Check<V> = [V] extends [string]
  ? string extends V
    ? StringCheck | FormatCheck
    : EnumCheck<V>
  : [V] extends [number]
    ? number extends V
      ? NumberCheck
      : OneOfCheck<V>
    : [V] extends [boolean]
      ? BoolCheck
      : [V] extends [readonly (infer E)[]]
        ? ArrayCheck<E>
        : [V] extends [object]
          ? ObjectCheck<V>
          : JsonCheck

/** 칸 하나: 한국어 이름, 검사, null 가능 여부 (타입에 null 이 있으면 nullable: true 가 꼭 있어야 함) */
export type Field<V> = { label: string; check: Check<Exclude<V, null>> } & (null extends V
  ? { nullable: true }
  : { nullable?: false })

/** 인터페이스의 모든 칸 (빠지거나 남으면 컴파일 오류) */
export type Fields<T> = { [K in keyof T]-?: Field<T[K]> }

/** 실행 중에 쓰는 느슨한 형태 */
export type AnyCheck =
  | NumberCheck
  | StringCheck
  | FormatCheck
  | { t: 'enum'; table: LabelCodeTableName; codes: readonly string[] }
  | { t: 'one-of'; values: readonly number[] }
  | BoolCheck
  | { t: 'array'; of: AnyCheck }
  | { t: 'object'; fields: AnyFields }
  | JsonCheck
export interface AnyField {
  label: string
  check: AnyCheck
  nullable?: boolean
}
export type AnyFields = Readonly<Record<string, AnyField>>

// 자주 쓰는 검사
const NUM: NumberCheck = { t: 'number' }
const NON_NEG: NumberCheck = { t: 'number', min: 0 }
const POSITIVE: NumberCheck = { t: 'number', min: 0, exclusiveMin: true }
const INT_ID: NumberCheck = { t: 'number', int: true, min: 0 }
const LEG: NumberCheck = { t: 'number', int: true, min: 1 }
const REVISION: NumberCheck = { t: 'number', int: true, min: 1 }
const ANGLE: NumberCheck = { t: 'number', min: -90, max: 90 }
const TEXT: StringCheck = { t: 'string' }
const NON_EMPTY: StringCheck = { t: 'string', nonEmpty: true }
const UUID: FormatCheck = { t: 'uuid' }
const SHA256: FormatCheck = { t: 'sha256' }
const ISO_TIME: FormatCheck = { t: 'iso-datetime' }
const BOOL: BoolCheck = { t: 'bool' }
const JSON_ANY: JsonCheck = { t: 'json' }

const VERSION_ENTRY_FIELDS: Fields<VersionEntry> = {
  pcId: { label: 'PC ID', check: NON_EMPTY },
  edits: { label: '고친 횟수', check: { t: 'number', int: true, min: 1 } }
}
/** PC 마다 고친 횟수 (versions.ts) */
const VERSIONS: Field<VersionEntry[]> = { label: '버전 목록', check: { t: 'array', of: { t: 'object', fields: VERSION_ENTRY_FIELDS } } }

/** 표 이름의 코드들 */
type CodesOfTable<N extends LabelCodeTableName> = Extract<keyof (typeof LABEL_CODE_TABLES)[N], string>

/** 열거값 검사 — codes.ts 의 표 이름 하나로 정한다 (이름과 코드가 어긋날 수 없게) */
function en<N extends LabelCodeTableName>(table: N): EnumCheck<CodesOfTable<N>> {
  return { t: 'enum', table, codes: Object.keys(LABEL_CODE_TABLES[table]) as CodesOfTable<N>[] }
}

// ───────────────────────────── 칸 정의 (types.ts 와 같은 순서) ─────────────────────────────

export const PHYSICAL_DEFECT_FIELDS: Fields<PhysicalDefect> = {
  id: { label: '물리 결함 ID', check: NON_EMPTY },
  specimenId: { label: '시편 ID', check: NON_EMPTY },
  weldId: { label: '용접부 ID', check: TEXT, nullable: true },
  design: {
    label: '설계값',
    check: {
      t: 'object',
      fields: {
        type: { label: '종류', check: en('METALLURGICAL_TYPE'), nullable: true },
        zone: { label: '위치 구분', check: en('WELD_ZONE'), nullable: true },
        side: { label: '좌우', check: en('WELD_SIDE'), nullable: true },
        startMm: { label: '시작 (mm)', check: NUM, nullable: true },
        endMm: { label: '끝 (mm)', check: NUM, nullable: true },
        centerMm: { label: '중심 (mm)', check: NUM, nullable: true },
        depthMm: { label: '깊이 (mm)', check: NON_NEG, nullable: true },
        lengthMm: { label: '길이 (mm)', check: NON_NEG, nullable: true },
        heightMm: { label: '높이 (mm)', check: NON_NEG, nullable: true },
        tiltDeg: { label: '기울기 (°)', check: { t: 'number', min: -180, max: 180 }, nullable: true }
      }
    }
  },
  source: { label: '출처', check: en('DESIGN_SOURCE') },
  confirmation: { label: '확인 수준', check: en('CONFIRMATION_LEVEL') },
  dataOrigin: { label: '데이터 출처', check: en('DATA_ORIGIN') },
  parentId: { label: '부모 결함 ID', check: NON_EMPTY, nullable: true },
  generatorTool: { label: '생성 도구', check: TEXT, nullable: true },
  generatorVersion: { label: '생성 도구 버전', check: TEXT, nullable: true },
  revision: { label: 'revision', check: REVISION },
  versions: VERSIONS,
  deleted: { label: '삭제 표시', check: BOOL },
  pcId: { label: 'PC ID', check: TEXT, nullable: true },
  updatedAt: { label: '고친 시각', check: ISO_TIME, nullable: true },
  note: { label: '메모', check: TEXT }
}

export const FILE_ALIGNMENT_FIELDS: Fields<FileAlignment> = {
  sha256: { label: 'SHA-256', check: SHA256 },
  fileName: { label: '파일명', check: NON_EMPTY },
  specimenId: { label: '시편 ID', check: TEXT, nullable: true },
  weldId: { label: '용접부 ID', check: TEXT, nullable: true },
  datumKind: { label: '기준점 정의', check: en('DATUM_KIND'), nullable: true },
  datumDescription: { label: '기준점 설명', check: TEXT, nullable: true },
  datumUMm: { label: '기준점 위치 U (mm)', check: NUM, nullable: true },
  direction: { label: '스캔 방향', check: { t: 'one-of', values: [1, -1] }, nullable: true },
  skew90Side: { label: 'Skew 90 쪽', check: en('SKEW90_SIDE'), nullable: true },
  alignmentAssumed: { label: '가설 정렬', check: BOOL },
  thicknessMm: { label: '두께 (mm)', check: POSITIVE, nullable: true },
  outerDiameterMm: { label: '외경 (mm)', check: POSITIVE, nullable: true },
  overlapStartMm: { label: '원주 겹침 시작 (mm)', check: NUM, nullable: true },
  overlapEndMm: { label: '원주 겹침 끝 (mm)', check: NUM, nullable: true },
  probeClSkew90Mm: { label: 'Skew 90 탐촉자–CL 거리 (mm)', check: NON_NEG, nullable: true },
  probeClSkew270Mm: { label: 'Skew 270 탐촉자–CL 거리 (mm)', check: NON_NEG, nullable: true },
  trackDeviationMaxMm: { label: '최대 위치 편차 (mm)', check: NON_NEG, nullable: true },
  evidence: { label: '근거', check: TEXT, nullable: true },
  enteredBy: { label: '입력한 라벨러', check: NON_EMPTY, nullable: true },
  revision: { label: 'revision', check: REVISION },
  versions: VERSIONS,
  deleted: { label: '삭제 표시', check: BOOL },
  pcId: { label: 'PC ID', check: TEXT, nullable: true },
  updatedAt: { label: '고친 시각', check: ISO_TIME, nullable: true },
  note: { label: '메모', check: TEXT }
}

export const INDICATION_RECORD_FIELDS: Fields<IndicationRecord> = {
  uuid: { label: '기록 UUID', check: UUID },
  sha256: { label: '원본 SHA-256', check: SHA256 },
  secondaryFingerprint: { label: '보조 지문', check: NON_EMPTY, nullable: true },
  labelerId: { label: '라벨러 ID', check: NON_EMPTY },
  guidelineVersion: { label: '지침서 버전', check: NON_EMPTY },
  readingStage: { label: '판독 단계', check: en('READING_STAGE') },
  revision: { label: 'revision', check: REVISION },
  versions: VERSIONS,
  deleted: { label: '삭제 표시', check: BOOL },
  pcId: { label: 'PC ID', check: TEXT, nullable: true },
  createdAt: { label: '만든 시각', check: ISO_TIME, nullable: true },
  updatedAt: { label: '고친 시각', check: ISO_TIME, nullable: true },
  readerSource: { label: '판독 출처', check: en('READER_SOURCE') },
  readerDetail: {
    label: '판독 출처 세부',
    check: {
      t: 'object',
      fields: {
        organization: { label: '기관', check: TEXT, nullable: true },
        qualification: { label: '자격', check: TEXT, nullable: true },
        modelVersion: { label: 'AI 모델 버전', check: TEXT, nullable: true }
      }
    }
  },
  externalRef: { label: '지시 번호', check: TEXT, nullable: true },
  kind: { label: '기록 구분', check: en('RECORD_KIND') },
  coordSource: { label: '좌표 출처', check: en('COORD_SOURCE') },
  anchors: {
    label: '앵커 점',
    check: {
      t: 'array',
      of: {
        t: 'object',
        fields: {
          id: { label: '점 id', check: NON_EMPTY },
          role: { label: '역할', check: en('ANCHOR_ROLE') },
          anchor: {
            label: '앵커',
            check: {
              t: 'object',
              fields: {
                groupId: { label: '그룹', check: INT_ID },
                scanIndex: { label: '스캔 칸', check: NON_NEG },
                beam: { label: '빔', check: NON_NEG },
                sample: { label: '샘플', check: NON_NEG },
                coordRulesVersion: { label: '좌표 규칙 버전', check: REVISION },
                groupVerified: { label: '그룹 대조 완료', check: BOOL }
              }
            }
          },
          leg: { label: '레그', check: LEG, nullable: true },
          displayGainDb: { label: '화면 이득 (dB)', check: NUM, nullable: true },
          mm: {
            label: '점 mm',
            nullable: true,
            check: {
              t: 'object',
              fields: {
                scanMm: { label: '스캔 (mm)', check: NUM },
                vMm: { label: 'V (mm)', check: NUM },
                depthMm: { label: '실제 깊이 (mm)', check: NUM }
              }
            }
          }
        }
      }
    }
  },
  derived: {
    label: '파생 위치',
    check: {
      t: 'object',
      fields: {
        scanStartMm: { label: '스캔 시작 (mm)', check: NUM },
        scanEndMm: { label: '스캔 끝 (mm)', check: NUM },
        vMinMm: { label: 'V 최소 (mm)', check: NUM, nullable: true },
        vMaxMm: { label: 'V 최대 (mm)', check: NUM, nullable: true },
        depthTopMm: { label: '실제 깊이 위 (mm)', check: NUM, nullable: true },
        depthBottomMm: { label: '실제 깊이 아래 (mm)', check: NUM, nullable: true },
        coordRulesVersion: { label: '좌표 규칙 버전', check: REVISION, nullable: true }
      }
    }
  },
  recheckNeeded: { label: '재확인 필요', check: BOOL },
  existenceConfidence: { label: '존재 확신도', check: en('CONFIDENCE') },
  defectType: { label: '결함 종류', check: en('METALLURGICAL_TYPE'), nullable: true },
  isoCode: { label: 'ISO 6520-1 코드', check: { t: 'iso6520' }, nullable: true },
  typeConfidence: { label: '종류 확신도', check: en('CONFIDENCE'), nullable: true },
  character: {
    label: '판정 특성',
    check: {
      t: 'object',
      fields: {
        value: { label: '면상/체적', check: en('JUDGMENT_CHARACTER'), nullable: true },
        alignedVolumetric: { label: '일렬 체적 전환', check: BOOL },
        expertConfirmed: { label: '전문가 확인', check: BOOL }
      }
    }
  },
  surface: { label: '표면', check: en('SURFACE_CLASS'), nullable: true },
  pointLike: { label: '점 같은 지시', check: BOOL, nullable: true },
  location: {
    label: '위치 구분',
    check: {
      t: 'object',
      fields: {
        zone: { label: '구역', check: en('WELD_ZONE'), nullable: true },
        side: { label: '좌우', check: en('WELD_SIDE'), nullable: true },
        noBevelOverlay: { label: '덮개 없음', check: BOOL }
      }
    }
  },
  length: {
    label: '길이',
    check: {
      t: 'object',
      fields: {
        valueMm: { label: '길이 (mm)', check: NON_NEG, nullable: true },
        method: { label: '측정법', check: en('LENGTH_METHOD'), nullable: true },
        uncorrectedMm: { label: '보정 전 길이 (mm)', check: NON_NEG, nullable: true },
        groupId: { label: '측정 그룹', check: INT_ID, nullable: true },
        beam: { label: '측정 빔', check: NON_NEG, nullable: true },
        angleDeg: { label: '측정 빔 각도 (°)', check: ANGLE, nullable: true },
        thresholdPct: { label: '길이 문턱 (%FSH)', check: NON_NEG, nullable: true }
      }
    }
  },
  height: {
    label: '높이',
    check: {
      t: 'object',
      fields: {
        method: { label: '입력 방식', check: en('HEIGHT_METHOD'), nullable: true },
        valueMm: { label: '높이 (mm)', check: NON_NEG, nullable: true },
        pointIds: { label: '높이 점', check: { t: 'array', of: NON_EMPTY } }
      }
    }
  },
  signal: {
    label: '신호',
    check: {
      t: 'object',
      fields: {
        maxAmplitudePct: { label: '최대 진폭 (%FSH)', check: NON_NEG, nullable: true },
        refDb: { label: 'Ref 대비 (dB)', check: NUM, nullable: true },
        refDbVerified: { label: 'Ref 대비 대조', check: BOOL },
        saturated: { label: '포화', check: BOOL, nullable: true },
        exceedsEvaluationLevel: { label: '평가 기준 초과', check: BOOL, nullable: true },
        exceedsRecordingLevel: { label: '기록 기준 초과', check: BOOL, nullable: true },
        peak: {
          label: '최대 진폭 위치',
          nullable: true,
          check: {
            t: 'object',
            fields: {
              groupId: { label: '그룹', check: INT_ID, nullable: true },
              beam: { label: '빔', check: NON_NEG, nullable: true },
              angleDeg: { label: '각도 (°)', check: ANGLE, nullable: true },
              scanMm: { label: '스캔 (mm)', check: NUM, nullable: true },
              depthMm: { label: '깊이 (mm)', check: NUM, nullable: true }
            }
          }
        }
      }
    }
  },
  suggestions: {
    label: '제안 기록',
    check: {
      t: 'array',
      of: {
        t: 'object',
        fields: {
          target: { label: '대상', check: en('SUGGESTION_TARGET') },
          rule: { label: '규칙', check: NON_EMPTY },
          ruleDb: { label: '규칙 dB', check: NUM, nullable: true },
          suggestedMm: { label: '제안값 (mm)', check: NUM, nullable: true },
          finalMm: { label: '최종값 (mm)', check: NUM, nullable: true },
          acceptedUnchanged: { label: '고치지 않고 수락', check: BOOL },
          correctionMm: { label: '수정량 (mm)', check: NUM, nullable: true },
          shownAfterExpert: { label: '전문가가 먼저 찍은 뒤 보임', check: BOOL }
        }
      }
    }
  },
  knowledge: {
    label: '사전 지식',
    check: {
      t: 'object',
      fields: {
        designValueSeen: { label: '설계값 봄', check: BOOL, nullable: true },
        specimenKnown: { label: '시편 사전 지식', check: BOOL, nullable: true },
        aiDevParticipant: { label: 'AI 개발 참여', check: BOOL, nullable: true }
      }
    }
  },
  physicalDefectId: { label: '물리 결함 ID', check: NON_EMPTY, nullable: true },
  groupingId: { label: '그룹 짓기 ID', check: NON_EMPTY, nullable: true },
  viewSnapshot: { label: '화면 스냅샷', check: JSON_ANY, nullable: true },
  geometricEcho: {
    label: '형상 에코 세부',
    nullable: true,
    check: {
      t: 'object',
      fields: {
        kind: { label: '형상 에코 종류', check: en('GEOMETRIC_ECHO_KIND') },
        fromSuggestion: { label: '앱 제안 승인', check: BOOL }
      }
    }
  },
  geometricImperfection: {
    label: '형상 불완전 세부',
    nullable: true,
    check: {
      t: 'object',
      fields: {
        kind: { label: '형상 불완전 종류', check: en('GEOMETRIC_IMPERFECTION_KIND') }
      }
    }
  },
  note: { label: '메모', check: TEXT }
}

export const OBSERVATION_ROW_FIELDS: Fields<ObservationRow> = {
  recordUuid: { label: '기록 UUID', check: UUID },
  groupId: { label: '그룹', check: INT_ID },
  leg: { label: '레그', check: LEG },
  projected: {
    label: '투영 위치',
    nullable: true,
    check: {
      t: 'object',
      fields: {
        scanStartMm: { label: '스캔 시작 (mm)', check: NUM },
        scanEndMm: { label: '스캔 끝 (mm)', check: NUM },
        beamMin: { label: '빔 최소', check: NON_NEG },
        beamMax: { label: '빔 최대', check: NON_NEG },
        sampleMin: { label: '샘플 최소', check: NON_NEG },
        sampleMax: { label: '샘플 최대', check: NON_NEG }
      }
    }
  },
  search: {
    label: '탐색 창 결과',
    nullable: true,
    check: {
      t: 'object',
      fields: {
        maxAmplitudePct: { label: '최대 진폭 (%FSH)', check: NON_NEG },
        beam: { label: '빔', check: NON_NEG },
        scanMm: { label: '스캔 (mm)', check: NUM },
        scanStartMm: { label: '스캔 범위 시작 (mm)', check: NUM, nullable: true },
        scanEndMm: { label: '스캔 범위 끝 (mm)', check: NUM, nullable: true }
      }
    }
  },
  saturated: { label: '포화', check: BOOL, nullable: true },
  status: { label: '상태', check: en('OBSERVATION_STATUS') },
  expertConfirmed: { label: '전문가 확인', check: BOOL },
  coordRulesVersion: { label: '좌표 규칙 버전', check: REVISION },
  revision: { label: 'revision', check: REVISION },
  versions: VERSIONS,
  deleted: { label: '삭제 표시', check: BOOL },
  pcId: { label: 'PC ID', check: TEXT, nullable: true }
}

export const REVIEW_INTERVAL_FIELDS: Fields<ReviewInterval> = {
  uuid: { label: '구간 UUID', check: UUID },
  sha256: { label: '원본 SHA-256', check: SHA256 },
  labelerId: { label: '라벨러 ID', check: NON_EMPTY },
  guidelineVersion: { label: '지침서 버전', check: NON_EMPTY },
  readingStage: { label: '판독 단계', check: en('READING_STAGE') },
  revision: { label: 'revision', check: REVISION },
  versions: VERSIONS,
  deleted: { label: '삭제 표시', check: BOOL },
  released: { label: '자동 풀림', check: BOOL },
  pcId: { label: 'PC ID', check: TEXT, nullable: true },
  createdAt: { label: '만든 시각', check: ISO_TIME, nullable: true },
  updatedAt: { label: '고친 시각', check: ISO_TIME, nullable: true },
  kind: { label: '구간 종류', check: en('REVIEW_KIND') },
  groupId: { label: '그룹', check: INT_ID, nullable: true },
  scanStartMm: { label: '스캔 시작 (mm)', check: NUM },
  scanEndMm: { label: '스캔 끝 (mm)', check: NUM },
  gate: {
    label: '게이트 범위',
    nullable: true,
    check: {
      t: 'object',
      fields: {
        depthTopMm: { label: '게이트 깊이 위 (mm, 펼친 깊이)', check: NON_NEG },
        depthBottomMm: { label: '게이트 깊이 아래 (mm, 펼친 깊이)', check: NON_NEG },
        legMin: { label: '레그 최소', check: LEG },
        legMax: { label: '레그 최대', check: LEG }
      }
    }
  },
  reason: { label: '품질 불량 사유', check: en('QUALITY_BAD_REASON'), nullable: true },
  note: { label: '메모', check: TEXT }
}

export const WORK_EVENT_FIELDS: Fields<WorkEvent> = {
  uuid: { label: '이벤트 UUID', check: UUID },
  sessionId: { label: '세션 ID', check: NON_EMPTY },
  labelerId: { label: '라벨러 ID', check: NON_EMPTY },
  readingStage: { label: '판독 단계', check: en('READING_STAGE'), nullable: true },
  pcId: { label: 'PC ID', check: TEXT, nullable: true },
  sha256: { label: '원본 SHA-256', check: SHA256, nullable: true },
  kind: { label: '종류', check: en('WORK_EVENT_KIND') },
  tool: { label: '도구', check: en('WORK_TOOL') },
  at: { label: '시각', check: ISO_TIME },
  detail: { label: '세부', check: JSON_ANY, nullable: true }
}

export const LABEL_EXPORT_FIELDS: Fields<LabelExportFile> = {
  format: { label: '형식', check: en('EXPORT_FORMAT') },
  schemaVersion: { label: '스키마 버전', check: REVISION },
  rulesVersion: { label: '좌표 규칙 버전', check: REVISION },
  appVersion: { label: '앱 버전', check: NON_EMPTY },
  exportedAt: { label: '내보낸 시각', check: ISO_TIME },
  pcId: { label: 'PC ID', check: NON_EMPTY },
  labelers: {
    label: '라벨러',
    check: {
      t: 'array',
      of: {
        t: 'object',
        fields: {
          id: { label: '라벨러 ID', check: NON_EMPTY },
          name: { label: '이름', check: NON_EMPTY },
          qualification: { label: '자격', check: TEXT, nullable: true },
          organization: { label: '기관', check: TEXT, nullable: true }
        }
      }
    }
  },
  physicalDefects: { label: '물리 결함', check: { t: 'array', of: { t: 'object', fields: PHYSICAL_DEFECT_FIELDS } } },
  fileAlignments: { label: '파일 정렬', check: { t: 'array', of: { t: 'object', fields: FILE_ALIGNMENT_FIELDS } } },
  records: { label: '지시 기록', check: { t: 'array', of: { t: 'object', fields: INDICATION_RECORD_FIELDS } } },
  observations: { label: '관측 표', check: { t: 'array', of: { t: 'object', fields: OBSERVATION_ROW_FIELDS } } },
  reviewIntervals: { label: '검토 구간', check: { t: 'array', of: { t: 'object', fields: REVIEW_INTERVAL_FIELDS } } },
  workEvents: { label: '작업 이벤트', check: { t: 'array', of: { t: 'object', fields: WORK_EVENT_FIELDS } } }
}

/** 저장 단위 이름 → 칸 정의 (엑셀 양식이 이 이름으로 칸을 가리킨다) */
export const LABEL_ENTITY_FIELDS = {
  PhysicalDefect: PHYSICAL_DEFECT_FIELDS as unknown as AnyFields,
  FileAlignment: FILE_ALIGNMENT_FIELDS as unknown as AnyFields,
  IndicationRecord: INDICATION_RECORD_FIELDS as unknown as AnyFields,
  ObservationRow: OBSERVATION_ROW_FIELDS as unknown as AnyFields,
  ReviewInterval: REVIEW_INTERVAL_FIELDS as unknown as AnyFields,
  WorkEvent: WORK_EVENT_FIELDS as unknown as AnyFields
} as const

export type LabelEntity = keyof typeof LABEL_ENTITY_FIELDS

/** 'derived.scanStartMm' 같은 경로의 칸 정의. 없으면 null. 'anchors.anchor.beam' 처럼 목록은 건너뛴다 */
export function fieldAt(entity: LabelEntity, path: string): AnyField | null {
  return fieldChain(entity, path)?.at(-1) ?? null
}

/** 경로의 칸을 차례로. 없으면 null */
export function fieldChain(entity: LabelEntity, path: string): AnyField[] | null {
  let fields: AnyFields | null = LABEL_ENTITY_FIELDS[entity]
  const chain: AnyField[] = []
  for (const key of path.split('.')) {
    if (!fields || !Object.hasOwn(fields, key)) return null
    const f: AnyField | undefined = fields[key]
    if (!f) return null
    chain.push(f)
    let c: AnyCheck = f.check
    while (c.t === 'array') c = c.of
    fields = c.t === 'object' ? c.fields : null
  }
  return chain
}

/** 경로의 모든 칸이 null 불가인지 (= 값이 늘 있어야 하는 칸) */
export function isPathRequired(entity: LabelEntity, path: string): boolean {
  const chain = fieldChain(entity, path)
  return chain !== null && chain.every((f) => !f.nullable)
}

// ───────────────────────────── 검사 실행 ─────────────────────────────

type Seg = { key: string; label: string } | { index: number }

class Ctx {
  readonly errors: string[] = []
  readonly warnings: string[] = []
  private errorOverflow = 0
  private warningOverflow = 0
  /** 모르는 칸 경로 → 개수 */
  readonly unknown = new Map<string, number>()
  /** null 로 채운 칸 경로 → 개수 */
  readonly filled = new Map<string, number>()
  /** 오류가 난 최상위 목록 원소 ('records[2]') — 이 원소는 의미 검사를 건너뛴다 */
  readonly badElements = new Set<string>()

  error(segs: readonly Seg[], msg: string): void {
    if (segs.length >= 2 && 'index' in segs[1]!) this.badElements.add(rawPath(segs.slice(0, 2)))
    if (this.errors.length < MAX_MESSAGES) this.errors.push(at(segs, msg))
    else this.errorOverflow++
  }
  warn(segs: readonly Seg[], msg: string): void {
    this.warnText(at(segs, msg))
  }
  /** 경로 없는 경고 (파일 전체에 대한 것) */
  warnText(msg: string): void {
    if (this.warnings.length < MAX_MESSAGES) this.warnings.push(msg)
    else this.warningOverflow++
  }
  count(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  finish(): void {
    // 모아 둔 경고도 상한을 지킨다 (모르는 칸이 수천 가지여도 문구는 MAX_MESSAGES 까지)
    for (const [p, n] of this.unknown) this.warnText(`모르는 칸을 그대로 보존합니다: ${p} (${n}곳)`)
    for (const [p, n] of this.filled) this.warnText(`빠진 선택 칸을 빈 값(null)으로 채웠습니다: ${p} (${n}곳)`)
    if (this.errorOverflow > 0) this.errors.push(`… 오류 ${this.errorOverflow}건 더 있습니다.`)
    if (this.warningOverflow > 0) this.warnings.push(`… 경고 ${this.warningOverflow}건 더 있습니다.`)
  }
}

function koPath(segs: readonly Seg[]): string {
  const parts: string[] = []
  for (const s of segs) {
    if ('index' in s) {
      const last = parts.length - 1
      if (last >= 0) parts[last] = `${parts[last]} ${s.index + 1}번째`
      else parts.push(`${s.index + 1}번째`)
    } else parts.push(s.label)
  }
  return parts.join(' › ')
}

function rawPath(segs: readonly Seg[], generic = false): string {
  let p = ''
  for (const s of segs) {
    if ('index' in s) p += generic ? '[]' : `[${s.index}]`
    else p += p === '' ? s.key : `.${s.key}`
  }
  return p
}

function at(segs: readonly Seg[], msg: string): string {
  if (segs.length === 0) return msg
  return `${koPath(segs)}: ${msg} [${rawPath(segs)}]`
}

function show(v: unknown): string {
  if (v === undefined) return '없음'
  let s: string
  try {
    s = JSON.stringify(v) ?? String(v)
  } catch {
    s = String(v)
  }
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 키를 own 속성으로 넣는다 ('__proto__' 같은 이름도 프로토타입을 건드리지 않게 — 그 이름만 defineProperty, 나머지는 대입: 같은 결과·더 빠름) */
function put(o: Record<string, unknown>, k: string, v: unknown): void {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
  else o[k] = v
}

/** JSON 값 깊은 복사. JSON 으로 저장할 수 없는 값(함수·undefined·NaN·순환)이 있으면 null 대신 오류 */
function cloneJson(v: unknown, segs: readonly Seg[], ctx: Ctx, seen: Set<object> = new Set()): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) ctx.error(segs, `JSON 으로 저장할 수 없는 숫자입니다 (${String(v)})`)
    return v
  }
  if (Array.isArray(v)) {
    if (seen.has(v)) {
      ctx.error(segs, '순환 참조가 있어 JSON 으로 저장할 수 없습니다')
      return null
    }
    seen.add(v)
    const out = v.map((x, i) => cloneJson(x, [...segs, { index: i }], ctx, seen))
    seen.delete(v)
    return out
  }
  if (isPlainObject(v)) {
    if (seen.has(v)) {
      ctx.error(segs, '순환 참조가 있어 JSON 으로 저장할 수 없습니다')
      return null
    }
    seen.add(v)
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) continue
      put(out, k, cloneJson(x, [...segs, { key: k, label: k }], ctx, seen))
    }
    seen.delete(v)
    return out
  }
  ctx.error(segs, `JSON 으로 저장할 수 없는 값입니다 (${typeof v})`)
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA256_RE = /^[0-9a-f]{64}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const ISO6520_RE = /^\d{3,4}$/

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
export function isSha256Hex(v: unknown): v is string {
  return typeof v === 'string' && SHA256_RE.test(v)
}
/** 그 해·달에 있는 날짜인지 (2월 30일 등을 거름) */
function realDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= days
}

export function isIsoDateTime(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = ISO_RE.exec(v)
  if (!m) return false
  const [y, mo, d] = v.slice(0, 10).split('-').map(Number) as [number, number, number]
  const [hh, mm] = v.slice(11, 16).split(':').map(Number) as [number, number]
  const ss = v.length > 17 && v[16] === ':' ? Number(v.slice(17, 19)) : 0
  if (!realDate(y, mo, d) || hh > 23 || mm > 59 || ss > 59) return false
  return !Number.isNaN(Date.parse(v))
}

function checkValue(v: unknown, check: AnyCheck, segs: readonly Seg[], ctx: Ctx): unknown {
  switch (check.t) {
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        ctx.error(segs, `유한한 숫자여야 합니다 (받은 값: ${show(v)})`)
        return v
      }
      if (check.int && !Number.isInteger(v)) ctx.error(segs, `정수여야 합니다 (받은 값: ${v})`)
      if (check.min !== undefined) {
        if (check.exclusiveMin ? v <= check.min : v < check.min) {
          ctx.error(segs, `${check.min}${check.exclusiveMin ? '보다 커야' : ' 이상이어야'} 합니다 (받은 값: ${v})`)
        }
      }
      if (check.max !== undefined && v > check.max) ctx.error(segs, `${check.max} 이하여야 합니다 (받은 값: ${v})`)
      return v
    }
    case 'string':
      if (typeof v !== 'string') ctx.error(segs, `글자여야 합니다 (받은 값: ${show(v)})`)
      else if (check.nonEmpty && v.trim() === '') ctx.error(segs, '비어 있으면 안 됩니다')
      return v
    case 'uuid':
      if (!isUuid(v)) ctx.error(segs, `UUID 형식(소문자 8-4-4-4-12)이 아닙니다 (받은 값: ${show(v)})`)
      return v
    case 'sha256':
      if (!isSha256Hex(v)) ctx.error(segs, `SHA-256(소문자 16진수 64자)이 아닙니다 (받은 값: ${show(v)})`)
      return v
    case 'iso-datetime':
      if (!isIsoDateTime(v)) ctx.error(segs, `시각은 시간대가 붙은 ISO 8601 이어야 합니다 (예: 2026-10-06T14:05:00+09:00, 받은 값: ${show(v)})`)
      return v
    case 'iso6520':
      if (typeof v !== 'string' || !ISO6520_RE.test(v)) ctx.error(segs, `ISO 6520-1 코드(숫자 3~4자리)가 아닙니다 (받은 값: ${show(v)})`)
      return v
    case 'enum':
      if (typeof v !== 'string' || !check.codes.includes(v)) {
        ctx.error(segs, `정해진 값이 아닙니다 (받은 값: ${show(v)}, 쓸 수 있는 값: ${check.codes.join(', ')})`)
      }
      return v
    case 'one-of':
      if (typeof v !== 'number' || !check.values.includes(v)) {
        ctx.error(segs, `${check.values.join(' 또는 ')} 이어야 합니다 (받은 값: ${show(v)})`)
      }
      return v
    case 'bool':
      if (typeof v !== 'boolean') ctx.error(segs, `참/거짓(true/false)이어야 합니다 (받은 값: ${show(v)})`)
      return v
    case 'array':
      if (!Array.isArray(v)) {
        ctx.error(segs, `목록이어야 합니다 (받은 값: ${show(v)})`)
        return v
      }
      return v.map((x, i) => checkElement(x, check.of, [...segs, { index: i }], ctx))
    case 'object':
      if (!isPlainObject(v)) {
        ctx.error(segs, `객체여야 합니다 (받은 값: ${show(v)})`)
        return v
      }
      return checkFields(v, check.fields, segs, ctx)
    case 'json':
      return cloneJson(v, segs, ctx)
  }
}

/** 목록 칸의 원소 (원소는 null 불가) */
function checkElement(v: unknown, check: AnyCheck, segs: readonly Seg[], ctx: Ctx): unknown {
  if (v === null || v === undefined) {
    ctx.error(segs, '비어 있으면 안 됩니다')
    return v
  }
  return checkValue(v, check, segs, ctx)
}

function checkFields(input: Record<string, unknown>, fields: AnyFields, segs: readonly Seg[], ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // 입력 순서를 지키고, 모르는 칸은 그대로 보존
  for (const [k, v] of Object.entries(input)) {
    const f = Object.hasOwn(fields, k) ? fields[k] : undefined
    const seg: Seg = { key: k, label: f?.label ?? k }
    const here = [...segs, seg]
    if (!f) {
      if (v === undefined) continue // JSON 에 없는 값 — 내보낼 때도 빠진다
      ctx.count(ctx.unknown, rawPath(here, true))
      put(out, k, cloneJson(v, here, ctx))
      continue
    }
    if (v === null || v === undefined) {
      if (f.nullable) {
        put(out, k, null)
        if (v === undefined) ctx.count(ctx.filled, rawPath(here, true))
      } else ctx.error(here, '비어 있으면 안 됩니다')
      continue
    }
    put(out, k, checkValue(v, f.check, here, ctx))
  }
  // 빠진 칸
  for (const [k, f] of Object.entries(fields)) {
    if (Object.hasOwn(input, k)) continue
    const here = [...segs, { key: k, label: f.label }]
    if (f.nullable) {
      put(out, k, null)
      ctx.count(ctx.filled, rawPath(here, true))
    } else ctx.error(here, '칸이 없습니다')
  }
  return out
}

function result<T>(value: unknown, ctx: Ctx): LabelCheckResult<T> {
  ctx.finish()
  const ok = ctx.errors.length === 0
  return { ok, value: ok ? (value as T) : null, errors: ctx.errors, warnings: ctx.warnings }
}

// ───────────────────────────── 레코드 의미 검사 ─────────────────────────────
// 구조 검사를 통과한 레코드에만 돈다 (값의 타입을 믿고 읽는다).

const EPS = 1e-6

function key(k: string, label: string): Seg {
  return { key: k, label }
}

function rangeOrder(
  a: number | null,
  b: number | null,
  segs: readonly Seg[],
  ctx: Ctx,
  what: string,
  pairMissing: 'warn' | 'ignore' = 'warn'
): void {
  if (a !== null && b !== null) {
    if (a > b + EPS) ctx.error(segs, `${what}: 시작(${a})이 끝(${b})보다 큽니다`)
  } else if ((a === null) !== (b === null) && pairMissing === 'warn') {
    ctx.warn(segs, `${what}: 한쪽 값만 있습니다`)
  }
}

/** 버전 목록: 같은 PC 가 두 번 나오면 오류, 합이 revision 과 다르면 경고 */
function checkVersions(versions: readonly VersionEntry[], revision: number, segs: readonly Seg[], ctx: Ctx): void {
  const vs = [...segs, key('versions', '버전 목록')]
  const seen = new Set<string>()
  for (const v of versions) {
    if (seen.has(v.pcId)) ctx.error(vs, `PC '${v.pcId}' 가 두 번 나옵니다`)
    seen.add(v.pcId)
  }
  if (versions.length > 0 && versionTotal(versions) !== revision) {
    ctx.warn(vs, `고친 횟수 합(${versionTotal(versions)})이 revision(${revision})과 다릅니다`)
  }
}

/** ISO 6520-1 코드: 표에 있는지, 종류·구분과 맞는지 (원문 대조 전 표 기준) */
function checkIsoCode(r: IndicationRecord, segs: readonly Seg[], ctx: Ctx): void {
  const code = r.isoCode
  if (code === null) return
  const is = [...segs, key('isoCode', 'ISO 6520-1 코드')]
  if (!Object.hasOwn(ISO_6520_1, code)) ctx.warn(is, `코드 ${code} 가 우리 ISO 6520-1 표에 없습니다`)
  if (r.kind === 'geometric-echo') {
    ctx.warn(is, '형상 에코(정상 형상)에는 ISO 6520-1 결함 코드를 붙이지 않습니다')
  } else if (r.kind === 'geometric-imperfection' && r.geometricImperfection) {
    const want = GEOMETRIC_IMPERFECTION_ISO[r.geometricImperfection.kind]
    if (code !== want) ctx.warn(is, `형상 불완전 세부의 코드(${want})와 다릅니다 (받은 값: ${code})`)
  } else if (r.kind === 'defect' && r.defectType !== null) {
    const want = METALLURGICAL_TYPE_INFO[r.defectType].iso
    if (want !== null && code !== want) ctx.warn(is, `결함 종류의 코드(${want})와 다릅니다 (받은 값: ${code})`)
  }
}

function checkRecordSemantics(r: IndicationRecord, segs: readonly Seg[], ctx: Ctx): void {
  checkVersions(r.versions, r.revision, segs, ctx)
  // 구분별 세부
  if (r.kind === 'defect') {
    if (r.geometricEcho !== null || r.geometricImperfection !== null) {
      ctx.error(segs, '결함 기록에는 형상 에코·형상 불완전 세부를 넣지 않습니다')
    }
    if (r.defectType === null && !r.deleted) ctx.warn(segs, "결함 종류가 비어 있습니다 (모르면 '면상 추정'·'체적 추정')")
  } else {
    if (r.defectType !== null) ctx.error(segs, '형상 에코·형상 불완전 기록에는 결함 종류를 넣지 않습니다')
    if (r.typeConfidence !== null) ctx.warn(segs, '결함이 아닌 기록에 종류 확신도가 있습니다')
    if (r.kind === 'geometric-echo') {
      if (r.geometricEcho === null) ctx.error(segs, '형상 에코 기록에는 형상 에코 세부(루트·캡·모드 변환·기타)가 있어야 합니다')
      if (r.geometricImperfection !== null) ctx.error(segs, '형상 에코 기록에 형상 불완전 세부가 있습니다')
    } else {
      if (r.geometricImperfection === null) ctx.error(segs, '형상 불완전 기록에는 형상 불완전 세부(단차·과다용입·루트 오목·언더컷)가 있어야 합니다')
      if (r.geometricEcho !== null) ctx.error(segs, '형상 불완전 기록에 형상 에코 세부가 있습니다')
    }
  }
  if (r.defectType === null && r.typeConfidence !== null && r.kind === 'defect') ctx.warn(segs, '결함 종류 없이 종류 확신도만 있습니다')
  checkIsoCode(r, segs, ctx)
  if (r.readingStage !== 'blind' && r.knowledge.designValueSeen === false) {
    ctx.warn(segs, "대조·확정 단계 기록인데 '설계값 봤는지'가 아니오입니다 (이 단계는 설계값을 본 것으로 봅니다)")
  }

  // 판정 특성
  const ch = r.character
  const chSegs = [...segs, key('character', '판정 특성')]
  if (r.defectType !== null && ch.value !== null) {
    const def = defaultCharacterOf(r.defectType)
    if (ch.alignedVolumetric) {
      if (!isVolumetricType(r.defectType)) ctx.warn(chSegs, '일렬 체적 전환은 체적 종류(기공·슬래그·체적 추정)에만 씁니다')
      if (ch.value !== 'planar') ctx.warn(chSegs, '일렬 체적 전환을 적용했으면 판정 특성은 면상이어야 합니다')
    } else if (ch.value !== def) {
      ctx.warn(chSegs, `판정 특성이 종류 기본값(${def === 'planar' ? '면상' : '체적'})과 다릅니다`)
    }
  }
  if (ch.expertConfirmed && !ch.alignedVolumetric) ctx.warn(chSegs, '일렬 체적 전환 없이 전환 확인 표시가 있습니다')

  // 판독 출처
  if (r.readerSource === 'ai' && r.readerDetail.modelVersion === null) ctx.warn(segs, 'AI 판독 기록에 모델 버전이 없습니다')
  if (r.readerSource === 'agency' && r.readerDetail.organization === null) ctx.warn(segs, '전문기관 판독 기록에 기관 이름이 없습니다')

  // 앵커
  const ancSegs = [...segs, key('anchors', '앵커 점')]
  if (r.coordSource === 'app-anchor' && r.anchors.length === 0) ctx.error(ancSegs, '앱에서 찍은 기록(app-anchor)에 앵커 점이 없습니다')
  if (r.coordSource === 'imported-mm' && r.anchors.length > 0) ctx.error(ancSegs, "가져온 mm 기록(imported-mm)에는 앵커 점이 없어야 합니다")
  const ids = new Set<string>()
  r.anchors.forEach((p, i) => {
    const ps = [...ancSegs, { index: i }]
    if (ids.has(p.id)) ctx.error(ps, `점 id '${p.id}' 가 겹칩니다`)
    ids.add(p.id)
    const v = p.anchor.coordRulesVersion
    if (v > LABEL_COORD_RULES_VERSION) {
      ctx.warn(ps, `이 앱보다 새 좌표 규칙(v${v})으로 찍은 점입니다 (지금 v${LABEL_COORD_RULES_VERSION})`)
    } else if (v < LABEL_COORD_RULES_VERSION && !r.recheckNeeded) {
      ctx.warn(ps, `옛 좌표 규칙(v${v})으로 찍은 점입니다. 앵커에서 다시 계산하고 '재확인 필요'를 붙여야 합니다`)
    }
  })

  // 파생 위치
  const d = r.derived
  const dSegs = [...segs, key('derived', '파생 위치')]
  rangeOrder(d.scanStartMm, d.scanEndMm, dSegs, ctx, '스캔 범위')
  rangeOrder(d.vMinMm, d.vMaxMm, dSegs, ctx, 'V 범위')
  rangeOrder(d.depthTopMm, d.depthBottomMm, dSegs, ctx, '깊이 범위')
  for (const [v, what] of [
    [d.depthTopMm, '실제 깊이 위'],
    [d.depthBottomMm, '실제 깊이 아래'],
    [r.signal.peak?.depthMm ?? null, '최대 진폭 깊이']
  ] as const) {
    if (v !== null && v < 0) ctx.warn(dSegs, `${what}가 음수입니다 (${v} mm). 실제 깊이는 표면에서 0 이상입니다`)
  }
  if (!r.deleted && d.scanStartMm === 0 && d.scanEndMm === 0) ctx.warn(dSegs, '스캔 범위가 0~0 mm 입니다 (기본값 그대로일 수 있음)')
  if (r.coordSource === 'imported-mm' && d.coordRulesVersion !== null) ctx.warn(dSegs, '가져온 mm 기록인데 좌표 규칙 버전이 있습니다')
  if (r.coordSource === 'app-anchor' && d.coordRulesVersion === null) ctx.warn(dSegs, '앵커에서 계산한 위치에 좌표 규칙 버전이 없습니다')

  // 길이
  const lenSegs = [...segs, key('length', '길이')]
  if (r.length.valueMm !== null && r.length.method === null) ctx.warn(lenSegs, '길이 값은 있는데 측정법이 비어 있습니다')
  if (r.length.method === '6db-curvature' && r.length.uncorrectedMm === null && r.length.valueMm !== null) {
    ctx.warn(lenSegs, '6 dB 강하 + 곡률 보정인데 보정 전 길이가 없습니다')
  }

  // 높이
  const h = r.height
  const hSegs = [...segs, key('height', '높이')]
  if (h.method === 'unmeasurable' && h.valueMm !== null) ctx.error(hSegs, "'측정 불가'인데 높이 값이 있습니다")
  if (h.method === null && h.valueMm !== null) ctx.warn(hSegs, '높이 값은 있는데 입력 방식이 비어 있습니다')
  for (const pid of h.pointIds) {
    if (!ids.has(pid)) ctx.error(hSegs, `높이 점 '${pid}' 가 앵커 점에 없습니다`)
  }
  if (r.coordSource === 'app-anchor' && h.valueMm !== null) {
    const roles = new Set(h.pointIds.map((pid) => r.anchors.find((p) => p.id === pid)?.role))
    if (h.method === 'tip-tip' && !(roles.has('tip-top') && roles.has('tip-bottom'))) ctx.warn(hSegs, "상하 팁 높이에 '위 팁'·'아래 팁' 점이 없습니다")
    if (h.method === 'tip-surface' && !((roles.has('tip') || roles.has('tip-top') || roles.has('tip-bottom')) && roles.has('surface'))) {
      ctx.warn(hSegs, "팁 + 표면 높이에 '팁'·'표면' 점이 없습니다")
    }
    if (h.method === '6db' && !(roles.has('drop-top') && roles.has('drop-bottom'))) ctx.warn(hSegs, "−6 dB 높이에 '−6 dB 위 끝'·'아래 끝' 점이 없습니다")
  }

  // 신호
  const s = r.signal
  const sSegs = [...segs, key('signal', '신호')]
  if (s.maxAmplitudePct !== null && s.maxAmplitudePct >= 200 && s.saturated === false) {
    ctx.warn(sSegs, `최대 진폭 ${s.maxAmplitudePct} %FSH 인데 포화가 아니라고 되어 있습니다 (200 % 이상은 포화)`)
  }
  if (s.exceedsRecordingLevel === true && s.exceedsEvaluationLevel === false) {
    ctx.error(sSegs, '기록 기준을 넘었는데 평가 기준은 못 넘었다고 되어 있습니다 (기록 기준 ≥ 평가 기준)')
  }

  // 제안 기록
  r.suggestions.forEach((g, i) => {
    const gs = [...segs, key('suggestions', '제안 기록'), { index: i }]
    if (g.acceptedUnchanged && g.correctionMm !== null && Math.abs(g.correctionMm) > EPS) {
      ctx.error(gs, `고치지 않고 수락했는데 수정량이 ${g.correctionMm} mm 입니다`)
    }
    if (g.acceptedUnchanged && g.suggestedMm === null) ctx.error(gs, '제안이 없는데(제안 불가) 수락 표시가 있습니다')
    if (g.suggestedMm !== null && g.finalMm !== null && g.correctionMm !== null) {
      if (Math.abs(g.finalMm - g.suggestedMm - g.correctionMm) > 1e-3) ctx.warn(gs, '수정량이 최종값 − 제안값과 다릅니다')
    }
  })
}

function checkReviewSemantics(v: ReviewInterval, segs: readonly Seg[], ctx: Ctx): void {
  checkVersions(v.versions, v.revision, segs, ctx)
  rangeOrder(v.scanStartMm, v.scanEndMm, segs, ctx, '스캔 범위')
  if (v.released && v.kind !== 'reviewed') ctx.warn(segs, "'자동 풀림'은 검토 완료 구간에만 씁니다")
  if (v.kind === 'quality-bad' && v.reason === null) ctx.error(segs, '품질 불량 구간에는 사유(커플링·누락·포화·잡음·시간 범위·감도)가 있어야 합니다')
  if (v.kind !== 'quality-bad' && v.reason !== null) ctx.error(segs, '품질 불량 사유는 품질 불량 구간에만 씁니다')
  if (v.kind === 'reviewed' && v.gate === null && !v.deleted) {
    ctx.warn(segs, "검토 완료 구간에 게이트 깊이·레그 범위가 없습니다 ('결함 없음' 예시를 뽑을 범위가 정해지지 않음)")
  }
  if (v.kind !== 'reviewed' && v.gate !== null) ctx.warn(segs, '게이트 범위는 검토 완료 구간에만 씁니다')
  if (v.gate) {
    const gs = [...segs, key('gate', '게이트 범위')]
    rangeOrder(v.gate.depthTopMm, v.gate.depthBottomMm, gs, ctx, '깊이 범위')
    rangeOrder(v.gate.legMin, v.gate.legMax, gs, ctx, '레그 범위')
  }
}

/** 길이와 (끝 − 시작)이 이만큼 넘게 다르면 경고 (mm) */
const LENGTH_SPAN_TOLERANCE_MM = 1

function checkPhysicalSemantics(p: PhysicalDefect, segs: readonly Seg[], ctx: Ctx): void {
  checkVersions(p.versions, p.revision, segs, ctx)
  const ds = [...segs, key('design', '설계값')]
  const v = p.design
  rangeOrder(v.startMm, v.endMm, ds, ctx, '위치 범위', 'ignore')
  if (v.startMm !== null && v.endMm !== null) {
    const lo = Math.min(v.startMm, v.endMm)
    const hi = Math.max(v.startMm, v.endMm)
    if (v.centerMm !== null && (v.centerMm < lo - EPS || v.centerMm > hi + EPS)) {
      ctx.warn(ds, `중심(${v.centerMm})이 시작~끝(${lo}~${hi}) 밖에 있습니다`)
    }
    if (v.lengthMm !== null && Math.abs(v.lengthMm - (hi - lo)) > LENGTH_SPAN_TOLERANCE_MM) {
      ctx.warn(ds, `길이(${v.lengthMm})가 끝 − 시작(${hi - lo})과 ${LENGTH_SPAN_TOLERANCE_MM} mm 넘게 다릅니다`)
    }
  }
  if (p.parentId !== null && p.parentId === p.id) ctx.error(segs, '부모 결함 ID 가 자기 자신입니다')
  if (p.source === 'none' && p.confirmation === 'design-only') {
    ctx.warn(segs, "출처가 '없음'인데 확인 수준이 '설계만'입니다 (근거 문서를 모르면 '미확인')")
  }
}

function checkAlignmentSemantics(a: FileAlignment, segs: readonly Seg[], ctx: Ctx): void {
  checkVersions(a.versions, a.revision, segs, ctx)
  rangeOrder(a.overlapStartMm, a.overlapEndMm, segs, ctx, '원주 겹침 구간')
}

function checkObservationSemantics(o: ObservationRow, segs: readonly Seg[], ctx: Ctx): void {
  checkVersions(o.versions, o.revision, segs, ctx)
  if (o.projected) {
    const ps = [...segs, key('projected', '투영 위치')]
    rangeOrder(o.projected.scanStartMm, o.projected.scanEndMm, ps, ctx, '스캔 범위')
    rangeOrder(o.projected.beamMin, o.projected.beamMax, ps, ctx, '빔 범위')
    rangeOrder(o.projected.sampleMin, o.projected.sampleMax, ps, ctx, '샘플 범위')
  }
  if (o.search) rangeOrder(o.search.scanStartMm, o.search.scanEndMm, [...segs, key('search', '탐색 창 결과')], ctx, '스캔 범위')
}

// ───────────────────────────── 레코드별 검사 (공개) ─────────────────────────────

function validateOne<T>(
  v: unknown,
  fields: AnyFields,
  label: string,
  semantics: (x: T, segs: readonly Seg[], ctx: Ctx) => void
): LabelCheckResult<T> {
  const ctx = new Ctx()
  const segs: Seg[] = []
  if (!isPlainObject(v)) {
    ctx.error(segs, `${label}: 객체가 아닙니다 (받은 값: ${show(v)})`)
    return result<T>(null, ctx)
  }
  const before = ctx.errors.length
  const value = checkFields(v, fields, segs, ctx)
  if (ctx.errors.length === before) semantics(value as T, segs, ctx)
  return result<T>(value, ctx)
}

export function validateIndicationRecord(v: unknown): LabelCheckResult<IndicationRecord> {
  return validateOne(v, LABEL_ENTITY_FIELDS.IndicationRecord, '지시 기록', checkRecordSemantics)
}
export function validatePhysicalDefect(v: unknown): LabelCheckResult<PhysicalDefect> {
  return validateOne(v, LABEL_ENTITY_FIELDS.PhysicalDefect, '물리 결함', checkPhysicalSemantics)
}
export function validateFileAlignment(v: unknown): LabelCheckResult<FileAlignment> {
  return validateOne(v, LABEL_ENTITY_FIELDS.FileAlignment, '파일 정렬', checkAlignmentSemantics)
}
export function validateObservationRow(v: unknown): LabelCheckResult<ObservationRow> {
  return validateOne(v, LABEL_ENTITY_FIELDS.ObservationRow, '관측 표', checkObservationSemantics)
}
export function validateReviewInterval(v: unknown): LabelCheckResult<ReviewInterval> {
  return validateOne(v, LABEL_ENTITY_FIELDS.ReviewInterval, '검토 구간', checkReviewSemantics)
}
export function validateWorkEvent(v: unknown): LabelCheckResult<WorkEvent> {
  return validateOne(v, LABEL_ENTITY_FIELDS.WorkEvent, '작업 이벤트', () => {})
}

// ───────────────────────────── 내보내기 파일 ─────────────────────────────

/** 같은 키가 둘 이상이면 경고 (충돌로 함께 보관하는 경우가 있어 오류가 아님) */
function warnDuplicates<T>(items: readonly T[], keyOf: (x: T) => string, label: string, ctx: Ctx): void {
  const n = new Map<string, number>()
  for (const x of items) n.set(keyOf(x), (n.get(keyOf(x)) ?? 0) + 1)
  for (const [k, c] of n) {
    if (c > 1) ctx.warnText(`${label} ${k} 가 ${c}개 있습니다 (충돌로 함께 보관)`)
  }
}

/** 배열의 각 원소가 구조 검사를 통과했을 때만 의미 검사 */
function eachValid<T>(
  arr: unknown,
  root: Seg,
  ctx: Ctx,
  bad: Set<string>,
  fn: (x: T, segs: readonly Seg[]) => void
): void {
  if (!Array.isArray(arr)) return
  arr.forEach((x, i) => {
    const segs = [root, { index: i }]
    if (!bad.has(rawPath(segs))) fn(x as T, segs)
  })
}

/**
 * 라벨 내보내기 파일 검사. JSON.parse 한 값을 받는다.
 * 형식 이름이 다르거나 schemaVersion 이 이 앱(LABEL_SCHEMA_VERSION)보다 새 것이면 다른 칸은 보지 않고 오류.
 */
export function parseLabelExport(input: unknown): LabelCheckResult<LabelExportFile> {
  const ctx = new Ctx()
  if (!isPlainObject(input)) {
    ctx.errors.push(`라벨 파일이 JSON 객체가 아닙니다 (받은 값: ${show(input)})`)
    return result(null, ctx)
  }
  if (input['format'] !== LABEL_EXPORT_FORMAT) {
    ctx.errors.push(`PAUT 라벨 파일이 아닙니다 (format: ${show(input['format'])}, 기대값: "${LABEL_EXPORT_FORMAT}")`)
    return result(null, ctx)
  }
  const sv = input['schemaVersion']
  if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 1) {
    ctx.errors.push(`스키마 버전이 올바르지 않습니다 (받은 값: ${show(sv)})`)
    return result(null, ctx)
  }
  if (sv > LABEL_SCHEMA_VERSION) {
    ctx.errors.push(
      `이 파일은 라벨 형식 v${sv} 입니다. 이 앱은 v${LABEL_SCHEMA_VERSION} 까지만 읽습니다. 앱을 새 버전으로 올린 뒤 가져오세요.`
    )
    return result(null, ctx)
  }

  const value = checkFields(input, LABEL_EXPORT_FIELDS as unknown as AnyFields, [], ctx)

  // 구조 오류가 난 원소는 의미 검사를 건너뛴다
  const bad = new Set(ctx.badElements)

  const rv = input['rulesVersion']
  if (typeof rv === 'number' && rv !== LABEL_COORD_RULES_VERSION) {
    ctx.warnText(
      `내보낸 PC 의 좌표 규칙(v${rv})이 이 앱(v${LABEL_COORD_RULES_VERSION})과 다릅니다. 앵커가 있는 기록은 다시 계산하고 '재확인 필요'를 붙입니다.`
    )
  }

  const F = LABEL_EXPORT_FIELDS
  eachValid<IndicationRecord>(value['records'], key('records', F.records.label), ctx, bad, (r, s) => checkRecordSemantics(r, s, ctx))
  eachValid<ReviewInterval>(value['reviewIntervals'], key('reviewIntervals', F.reviewIntervals.label), ctx, bad, (r, s) =>
    checkReviewSemantics(r, s, ctx)
  )
  eachValid<PhysicalDefect>(value['physicalDefects'], key('physicalDefects', F.physicalDefects.label), ctx, bad, (r, s) =>
    checkPhysicalSemantics(r, s, ctx)
  )
  eachValid<FileAlignment>(value['fileAlignments'], key('fileAlignments', F.fileAlignments.label), ctx, bad, (r, s) =>
    checkAlignmentSemantics(r, s, ctx)
  )
  eachValid<ObservationRow>(value['observations'], key('observations', F.observations.label), ctx, bad, (r, s) =>
    checkObservationSemantics(r, s, ctx)
  )

  if (ctx.errors.length === 0) {
    const f = value as unknown as LabelExportFile
    // 서로 가리키는 값
    const recordIds = new Set(f.records.map((r) => r.uuid))
    const orphan = f.observations.filter((o) => !recordIds.has(o.recordUuid)).length
    if (orphan > 0) ctx.warnText(`관측 표 ${orphan}행이 이 파일에 없는 기록을 가리킵니다`)
    if (f.labelers.length > 0) {
      const known = new Set(f.labelers.map((l) => l.id))
      const unknownLabelers = new Set(
        [...f.records, ...f.reviewIntervals, ...f.workEvents].map((x) => x.labelerId).filter((id) => !known.has(id))
      )
      if (unknownLabelers.size > 0) ctx.warnText(`라벨러 목록에 없는 ID: ${[...unknownLabelers].join(', ')}`)
    }
    // 지시 기록의 물리 결함 ID → (그 파일 정렬의 시편 ID, ID) 로 물리 결함을 찾는다
    const specimenOf = new Map(f.fileAlignments.filter((a) => !a.deleted).map((a) => [a.sha256, a.specimenId] as const))
    const defects = new Set(f.physicalDefects.filter((p) => !p.deleted).map((p) => `${p.specimenId}\u0000${p.id}`))
    let noSpecimen = 0
    const missing = new Set<string>()
    for (const r of f.records) {
      if (r.deleted || r.physicalDefectId === null) continue
      const sp = specimenOf.get(r.sha256) ?? null
      if (sp === null) noSpecimen++
      else if (!defects.has(`${sp}\u0000${r.physicalDefectId}`)) missing.add(`${sp}/${r.physicalDefectId}`)
    }
    if (noSpecimen > 0) ctx.warnText(`물리 결함 ID 가 있는 지시 기록 ${noSpecimen}건은 파일 정렬(시편 ID)이 없어 어느 시편의 결함인지 모릅니다`)
    if (missing.size > 0) ctx.warnText(`이 파일에 없는 물리 결함을 가리키는 지시 기록이 있습니다: ${[...missing].join(', ')}`)
    warnDuplicates(f.records, (r) => r.uuid, '같은 UUID 의 지시 기록', ctx)
    warnDuplicates(f.reviewIntervals, (r) => r.uuid, '같은 UUID 의 검토 구간', ctx)
    warnDuplicates(f.physicalDefects, (p) => `${p.specimenId}/${p.id}`, '같은 물리 결함', ctx)
    warnDuplicates(f.fileAlignments, (a) => a.sha256.slice(0, 12), '같은 파일의 정렬', ctx)
    warnDuplicates(f.observations, (o) => `${o.recordUuid.slice(0, 8)}/그룹 ${o.groupId}/레그 ${o.leg}`, '같은 관측 행', ctx)
    warnDuplicates(f.labelers, (l) => l.id, '같은 라벨러', ctx)
  }

  return result(value, ctx)
}

/** JSON 글자를 읽어 검사 */
export function parseLabelExportJson(text: string): LabelCheckResult<LabelExportFile> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, value: null, errors: [`JSON 으로 읽을 수 없습니다: ${e instanceof Error ? e.message : String(e)}`], warnings: [] }
  }
  return parseLabelExport(data)
}

/** 내보내기 글자 (2칸 들여쓰기, 끝에 줄바꿈) */
export function serializeLabelExport(file: LabelExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}
