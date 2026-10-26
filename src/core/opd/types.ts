import type { OpdScanSetup } from './scan'

/**
 * OPD(OmniScan MX2 .opd) 구조 읽기 결과.
 * 단위: 길이 mm, 시간 µs, 각도 °, 음속 m/s, 주파수 MHz, 이득 dB (파일은 SI — m·s·Hz).
 * 표시: [확인] = 우리 파일·r01·OmniPC 화면으로 맞춰 봄, [추정] = 근거가 약함 (README.md 위치표 참고).
 */

/**
 * 이 읽기 규칙의 이름·버전. 위치표나 점검이 바뀌면 version 을 올린다.
 * 2 (2026-10-07 검토 반영): 일반 정보 값 칸을 차례로 따라 읽고 앵커 = 그룹 이름 끝 + 0x328 로 계산,
 *   1축 위치 수 ≈ 스캔 길이 ÷ 간격(±1)·2축 줄 수 = 인덱스 칸 줄 수·빔마다 A-scan 시작·범위 같음을 해석 실패 점검으로 올림
 * 3 (2026-10-07): Hot Pass·Land·Root/각도·Land 오프셋, typed 설정의 코드·소자 수·문턱을 읽음.
 *   Fill 높이는 두께에서 알려진 층 높이를 뺀 계산값으로 구별하고, 양의 잔여 높이만 있으면 두께 판정을 보류.
 * 4 (2026-10-07): 개선 틀 코드 6 = V-Offset(한면 V, 이름 추정)·코드 5 = Double V-Offset(양면 V, X)로 개선 모양을 정하고,
 *   시편 모양·재질 코드 이름에 '추정' 표시를 붙임(OPD_조사/4_용접형상.md). 숫자 칸·구조 점검은 3 과 같다.
 *   Patch 시작·위치 수와 Axis 동기 코드를 읽고 실제 래스터 수와 교차 확인한다.
 */
export const OPD_READER = { name: 'opd-structure', version: 4 } as const

/** 샘플 수 [확인: 162개 모두 위치 수 공식이 나누어떨어짐]. 파일 안에 이 수를 적은 칸은 찾지 못했다 */
export const OPD_SAMPLES = 320
/** 게이트 결과 기록: 12 B × 게이트 3(I·A·B) × 빔 × 위치. 바이트 8 = 그 게이트 최대 진폭 [확인] */
export const OPD_GATE_RECORD_BYTES = 12
export const OPD_GATE_COUNT = 3
/** 게이트 결과 뒤 고정 블록 [확인: 162개 같은 길이, 뜻 미해독] */
export const OPD_FIXED_BLOCK_BYTES = 4928
/** 진폭 % 환산 [추정: 화면 세 점 raw × 0.98 ≈ 255 = 250 %] — 8단계 캡처 대조로 확정 */
export const OPD_AMPLITUDE_SCALE = { rawMax: 255, unitMax: 250 } as const

export interface OpdTailEntry {
  /** 뜻 미해독 (162개 모두 같은 8종) */
  kind: number
  count: number
  offset: number
  extra: number
}

export interface OpdContainer {
  /** 머리 0x08 (big-endian). 162개 모두 3 */
  version: number
  fileSize: number
  /** 꼬리 색인 위치 (16 B × count, 파일 끝까지) */
  indexOffset: number
  entries: OpdTailEntry[]
}

export interface OpdHeader {
  /** 장비 모듈 'OMNISX-PA1664PR' (일반 정보 0x2A22, 꼬리 장비 정보와 같아야 함) */
  module: string
  /** 장비 시리얼 'QC-006952' (꼬리 장비 정보에 두 번 적힘 — 둘 다 serials 에) */
  serialNumber: string | null
  serials: string[]
  /** 'MXU - 4.4R5' */
  mxuVersion: string
  mxu: { major: number; minor: number; revision: number } | null
  /** 저장 시각 (OLE DATE, 시간대 없음) 'YYYY-MM-DDTHH:mm:ss'. 읽을 수 없으면 null */
  savedAt: string | null
  /** 0x2A1A OLE DATE 원값 (날 수) */
  savedAtOle: number
  /** 장비 저장 이름 'TP14-ROOT-L-##' (파일 이름과 다를 수 있음) */
  deviceFileName: string
  /** 그룹 이름 'PA 1' (162개 모두 그룹 1개) */
  groupName: string
  /** 집속법칙 파일 표시 '&#&NO_LAW_FILE_LOAD&#&' 등 (원문 그대로) */
  lawFile: string
  /**
   * 일반 정보(보고서) 칸 값 — 'Contractor' 등 칸 이름 다음 문자열. 162개 모두 기본값 'Name' 이다.
   * 기본값이 아닌 파일은 아직 본 적이 없어 경고를 붙인다
   */
  reportInfo: Array<{ label: string; value: string }>
  /** 셋업 앵커 A (그룹 이름 끝 + 0x328). 162개 모두 0x30F4 */
  anchorOffset: number
}

export interface OpdProbe {
  serial: string
  /** 앞뒤 공백 정리한 모델 '5L64-A32' */
  model: string
  /** 파일 원문 '5L64-A32 ' */
  modelRaw: string
  /** A+0x78 [확인] */
  centralFrequencyMHz: number
  /** A+0x88 [확인] */
  pitchMm: number
  /** 모델 이름의 소자 수 (5L64 → 64) [추정 — 칸을 못 찾음]. 모양이 다르면 null */
  elementCountFromModel: number | null
  /** ProbeUT_Container_GROUP 숫자 칸 0x641B6. 송·수신 두 벌이 같을 때만. */
  elementCount: number | null
}

export interface OpdWedge {
  /** 첫 번째 웨지 모델 문자열 (앞뒤 공백 정리) */
  model: string
  /** 웨지 모델 문자열 네 벌 (부식 파일은 'SA32-0L*'/'SA32-0L' 처럼 다를 수 있음) */
  modelStrings: string[]
  /** 두 번째 탐촉자 모델 끝 + 0xF0 [확인] */
  velocityMps: number
  /** 웨지 앞면 → 첫 소자(번호 0) 중심, 뒤쪽이 음수 (+0x100) [확인] */
  offsetXMm: number
  /** 첫 소자 중심 높이 (+0x118) [확인] */
  heightMm: number
  /** 웨지 각 (+0x120) [확인] */
  angleDeg: number
}

export type OpdFormation = 'sectorial' | 'linear'

/** 숫자 칸은 화면·전수 높이 합으로 확인. 코드·나머지 칸은 위치를 확정하지 못해 null. */
export interface OpdWeld {
  templateCode: number | null
  symmetryCode: number | null
  /** 개선 틀 이름 (weld.ts OPD_WELD_TEMPLATE_INFO — 5 'DoubleVOffset' [확인], 6 'VOffset' [추정]). 모르는 코드는 null */
  templateName: string | null
  /** true = 이름을 메뉴 화면으로 맞춰 보지 못함(코드 6). 화면에 '추정' */
  templateEstimated: boolean
  /** 개선 모양: 'X' = 양면 V(코드 5), 'V' = 한면 V(코드 6). 모르는 코드는 null */
  bevelShape: 'V' | 'X' | null
  symmetryName: string | null
  hotPass: { heightMm: number; angleDeg: number }
  land: { heightMm: number; offsetMm: number }
  root: { heightMm: number; angleDeg: number }
  fill: { heightMm: number; angleDeg: number } | null
  /** 두께−Hot Pass−Land−Root 계산값. 파일의 Fill 숫자 칸을 직접 읽은 값이 아니다. */
  derivedFillHeightMm: number
  hazWidthMm: number | null
  upperCap: { heightMm: number; widthMm: number } | null
  lowerCap: { heightMm: number; widthMm: number } | null
}

export interface OpdSetup {
  /** 시편 두께 A−0x510 [확인] */
  thicknessMm: number
  /** @deprecated 기존 조사표 호환 별칭. 실제로는 Hot Pass 높이 A−0x4D8. 새 코드는 weld.hotPass를 사용. */
  weldFillHeightMm: number
  /** @deprecated 기존 조사표 호환 별칭. 새 코드는 weld.land를 사용. */
  weldLandHeightMm: number
  /** Hot Pass·Land·Root. 높이가 전부 0이면 용접 설정 없음(null). */
  weld: OpdWeld | null
  /**
   * 파일에 저장된 시편 설정(weld.ts OPD_SPECIMEN_SHAPES·OPD_MATERIALS). 모르는 코드는 이름 null.
   * shapeEstimated·materialEstimated = 162개가 모두 같은 코드라 다른 값 표본이 없음 → 화면에 '추정'
   */
  specimen: {
    shapeCode: number | null
    shape: 'plate' | null
    shapeEstimated: boolean
    materialCode: number | null
    materialName: string | null
    materialEstimated: boolean
  }
  /** GroupUT_GROUP0x742E2. 코드 1=Shear(r01 36개 대조), 코드 2의 이름은 미해독. */
  waveModeCode: number | null
  waveMode: string | null
  /** GroupUT_GROUP0xB3EE2(앵커 A−0x3F8), 초기 스캔 위치. */
  scanOffsetMm: number | null
  /** 그룹 음속 A−0x3E0 [확인 — OmniPC 측정값은 이 음속] */
  velocityMps: number
  /** 파일 이득 A−0x3C8 [확인] */
  gainDb: number
  /** 기준 이득(Ref) A−0x3B8 [확인]. PCN 처럼 0 이면 0 그대로 (해석은 쓰는 쪽에서) */
  referenceGainDb: number
  /** 기준 진폭 % A−0x3C0 [확인 80 %] */
  referenceAmplitudePct: number
  /** 펄스 폭 A−0x378 [확인] */
  pulseWidthNs: number
  /** 인덱스 오프셋 A−0x3F0 [확인] */
  indexOffsetMm: number
  /** 스큐 A−0x3E8 [확인 — 빔 이름 Sk 와 같아야 함] */
  skewDeg: number
  formation: OpdFormation
  /** 각도 블록 A+0x00/+0x08/+0x10 [확인] (리니어는 시작 = 끝) */
  angle: { startDeg: number; stopDeg: number; stepDeg: number }
  /** 집속 깊이 A+0x18 [확인] */
  focusDepthMm: number
  /** 필터 하한·상한 A+0x68/+0x70 [추정] */
  filter: { lowMHz: number; highMHz: number }
  /** 법칙마다 쓰는 소자 수 (빔 기록 소자 칸 수) [확인 16] */
  aperture: number
  /** 첫 법칙 첫 소자 (1부터, r01 Calc_First_Element 와 같은 기준) [확인] */
  firstElement: number
  /** 리니어 이웃 법칙 첫 소자 차. 섹토리얼은 null */
  elementStep: number | null
  /** 스캔축: 길이 A−0x5A8 [확인], 간격 A−0x30 [확인], nominalCount = 길이 ÷ 간격 */
  scan: { lengthMm: number; resolutionMm: number; nominalCount: number }
  /** typed Mechanical/Patch/Axis 설정. 구버전 저장 구조에는 없을 수 있다. */
  scanAxes?: OpdScanSetup
  /** 인덱스축: 간격 A−0x10 [확인], 길이 A−0x590·간격 A−0x588 [추정 — 부식 2축 파일 줄 수와 맞음] */
  index: { resolutionMm: number; lengthMm: number; stepMm: number }
  probe: OpdProbe
  wedge: OpdWedge
  /** 읽은 날 값 (SI, 파일 그대로) — 칸 이름은 앵커 기준 'A-0x510' 꼴 */
  raw: Record<string, number>
}

export interface OpdGateSetting {
  /**
   * 'I' | 'A' | 'B' — typed Context의 3개 Gate 참조와 r01 문턱 36×3개 대조로 순서 확인.
   */
  name: 'I' | 'A' | 'B'
  /** 깊이 시간(깊이 × 2 / 음속) µs. 빔 시간으로는 ÷ cos(굴절각) [확인] */
  startDepthUs: number
  widthDepthUs: number
  /** typed Context→Gate 참조로 읽은 uint8 문턱 %. 못 읽으면 null. */
  thresholdPct: number | null
}

export interface OpdTcgPoint {
  /** 음로(빔) 시간 µs — 게이트와 달리 깊이 시간이 아니다 [확인: r01 True Depth 위치 = 시각 × 음속/2 × cos θ, SEC20 36/36] */
  timeUs: number
  gainDb: number
}

export interface OpdBeam {
  index: number
  /** 'A:45.00 Sk:090 L:001' */
  name: string
  /** 빔 기록 시작(이름 끝 다음) 파일 위치 R */
  recordOffset: number
  angleDeg: number
  /** 이름의 스큐 */
  skewDeg: number
  /** 집속 거리 R+0x10 */
  focusMm: number
  /** 출사점 X (웨지 앞면 기준, 뒤쪽 음수) R+0x18 [확인] */
  exitXMm: number
  /** 집속법칙 계산 음속 R+0x28 (그룹 음속과 다를 수 있음) */
  lawVelocityMps: number
  /** 웨지 지연 R+0x30 [확인] (래스터는 이미 뺀 시간) */
  wedgeDelayUs: number
  /** 이득 보정(?) R+0x38 [추정] */
  gainOffsetDb: number
  /** 첫 소자 (0부터) */
  firstElement: number
  elementCount: number
  /** A-scan 첫 샘플 시각 R+0x768 (웨지 지연을 뺀 출사점 왕복 시간 = NDE ultrasoundOffset) [확인] */
  t0Us: number
  /** A-scan 범위 R+0x770 [확인] */
  rangeUs: number
  /** 샘플 간격 = 범위 / 샘플 수 */
  sampleIntervalUs: number
  /** TCG 점 (첫 점은 시각 0). TCG 없는 파일은 점 1개 */
  tcg: OpdTcgPoint[]
  gates: OpdGateSetting[]
}

export interface OpdRaster {
  /** 래스터 시작 = 세 번째(회색조) 색표 끝 [확인] */
  offset: number
  /** 위치(프레임) 수 = (첫 꼬리 구역 − 래스터 시작 − 4928) ÷ (빔 × (샘플 + 36)) [확인] */
  positions: number
  beams: number
  samples: number
  bitDepth: 8
  /** 한 프레임 바이트 = 빔 × 샘플 */
  frameBytes: number
  /** 래스터 전체 바이트 */
  bytes: number
  /** 게이트 결과 시작 (래스터 바로 뒤) */
  gateResultsOffset: number
  /** 첫 꼬리 구역 위치 (게이트 결과 + 4928) */
  tailOffset: number
  /** 2축 스캔(부식 맵핑)이면 인덱스 줄 수 ≥ 2, 아니면 null [구조로 판별] */
  twoAxis: { indexLines: number; scanCount: number } | null
  /** 세 색표 시작 (진폭·두 번째·회색조) */
  paletteOffsets: [number, number, number]
}

export interface OpdFile {
  reader: typeof OPD_READER
  container: OpdContainer
  header: OpdHeader
  setup: OpdSetup
  beams: OpdBeam[]
  raster: OpdRaster
  /** 사용자에게 보일 한국어 경고 */
  warnings: string[]
}

/** 진폭 조각 [scanCount, 빔, 샘플] */
export interface OpdAmplitudeChunk {
  scanStart: number
  scanCount: number
  beams: number
  samples: number
  amplitude: Uint8Array | Int16Array
}

/** 장비가 저장한 게이트 결과 조각 [scanCount, 빔, 게이트 3] 의 최대 진폭(바이트 8) */
export interface OpdGatePeaks {
  scanStart: number
  scanCount: number
  beams: number
  peaks: Uint8Array
}

export interface OpdSelfCheck {
  /** 게이트 A 최대 진폭 재계산 ↔ 장비 저장 게이트 결과 (빈 프레임 제외, 칸 = 위치 × 빔) */
  gateA: {
    matched: number
    total: number
    rate: number
    /** ±1 안 */
    within1: number
    /** 게이트 A 가 저장 A-scan 구간 안에 다 들어오는 칸만 */
    insideMatched: number
    insideTotal: number
    /** insideTotal 이 0 이면 null (판정 불가) */
    insideRate: number | null
    /**
     * 장비 저장 값 < 재계산 최댓값인 칸 수·비율. '장비가 저장 구간보다 넓게 봤다'로는 설명할 수 없는 어긋남이다
     * (실데이터 최대 4.5 %, 샘플 수를 바꿔 잘못 읽힌 파일은 48~64 %)
     */
    unexplained: number
    unexplainedRate: number
    /** 재계산 최댓값이 센 신호(raw ≥ SELF_CHECK_LIMITS.strongRaw)인 칸만 — 포화 근처 진폭의 근거 */
    strongMatched: number
    strongTotal: number
    /** strongTotal 이 0 이면 null */
    strongRate: number | null
  }
  /** 출사점 ↔ 스넬 계산 (웨지 기하·소자 위치·굴절각). 2축 파일은 기준이 달라 null */
  snell: { maxDiffMm: number; perBeamDiffMm: number[] } | null
  /** 두께 ↔ Hot Pass + Land + Root. 양의 잔여 Fill 높이는 판정 보류, 층 합이 두께를 넘으면 불일치. */
  thickness: { thicknessMm: number; weldHeightMm: number; mismatch: boolean } | null
  /** 모두 0 인 프레임 수 (끝까지 못 간 스캔 등) */
  emptyFrames: number
  /**
   * 래스터는 모두 0 인데 그 프레임의 장비 게이트 결과(36 B × 빔)에 0 이 아닌 바이트가 있는 프레임 수.
   * 실데이터 162개에는 한 번도 없다 → 사본 손상(래스터 구간이 0 으로 지워짐) 의심
   */
  suspectFrames: number
  /** raw 255 샘플 수 */
  saturatedSamples: number
  /**
   * 판단.md 3.2 기준. 게이트 A = 저장 구간 안 칸 ≥ 95 % 이고 전체 칸 ≥ 95 % 이고 설명할 수 없는 어긋남 ≤ 10 %
   * (저장 구간 안 칸이 없으면 null = 판정 못 함 → 대조 전). 스넬 ≤ 0.05 mm, 두께 일치
   */
  passed: { gateA: boolean | null; snell: boolean | null; thickness: boolean | null }
  /** 사용자에게 보일 한국어 메모 */
  notes: string[]
  elapsedMs: number
}
