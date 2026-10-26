/**
 * NDE 이미지 보기 — 계산 계약 (main · renderer · 테스트 공용, 런타임 의존성 없음).
 *
 * 단위: 길이 mm, 시간 µs, 각도 °, 음속 m/s, 진폭 %FSH(0~unitMax — NDE 200, OPD 250 추정).
 * 형식: NDE 3.x·4.x(HDF5) 와 OPD(OmniScan MX2 .opd, core/opd/viewer.ts 가 같은 모양으로 채움). OPD 만 쓰는 칸은 모두 선택 칸이라
 * NDE 결과(값·JSON)는 그대로다: ViewerFileInfo.reader·scanSync, ViewerGroup.amplitudeSource·selfCheck·blockReason·blockReasons, AmplitudeScale.estimated.
 * OmniPC 설정 읽기(2026-10-07, OmniPC_조사/조사_보고.md 6절 X2·X7·L1·L4~L7)로 더한 칸도 모두 선택 칸이고 기존 칸 값은 바꾸지 않는다:
 * ViewerGate.enabled·detection·event, ViewerWeld.template, ViewerGroup.refBasis·refPct·softGainDb·positioning,
 * ViewerDisplay.readings, ViewerFileInfo.source. 근거는 우리 데이터 파일 값과 공개 설명서뿐(OmniPC 설치본은 보지 않음).
 * 검사 좌표 (OmniPC 화면과 같은 기준):
 *   U  = 스캔축 위치 mm (데이터 격자 offset + 칸 × 간격)
 *   V  = 용접 중심선(CL)이 0 인 가로 위치 mm. 탐촉자 위치 `vCoordinateOffset` 과 같은 축
 *   깊이 = 표면에서 아래로 mm, 스킵을 펴서 0..∞ 로 이어지는 '펼친 깊이'(TrueDepth). 두께 안으로 접은 값은 `foldDepth`
 *   시간 = 빔마다 자기 출사점 기준 왕복 시간 (파일의 `ultrasoundOffset`, 게이트 start 와 같은 기준. beamDelay 는 더하지 않음)
 */

export type ViewerTechnique = 'pa-sectorial' | 'pa-linear' | 'pa-compound' | 'ut' | 'tofd' | 'tfm' | 'other'

export interface ViewerBeam {
  /** 빔 번호 (진폭 배열 둘째 축) */
  index: number
  /** 굴절각 */
  angleDeg: number
  /** 빔 진행 방향 (90 = +V 쪽, 270 = -V 쪽) */
  skewDeg: number
  velocityMps: number
  /** 출사점 U (mm) */
  uOffsetMm: number
  /** 출사점 V (mm) */
  vOffsetMm: number
  /** 첫 샘플 시각 (µs) */
  t0Us: number
}

export interface ViewerGate {
  id: number
  /** 'Gate A' 등 파일 이름 그대로 */
  name: string
  /** 'TrueDepth' | 'SoundPath' ... */
  geometry: string
  /** 동기 모드 'Pulse' 등 */
  sync: string
  /** 빔별 시작·길이 (µs, 빔 시간 기준). SoundPath 처럼 하나뿐이면 모든 빔에 같은 값 */
  startUs: number[]
  lengthUs: number[]
  thresholdPct: number | null
  /** 지금 계산할 수 있는 게이트인가 (동기 모드 Pulse 만) */
  supported: boolean
  /** 파일이 C-scan 소스로 쓰는 게이트인가 (3.x produceCscanData, 4.x CScan 출력의 gateId). 켜짐/꺼짐(IsEnabled)과는 다르다 */
  producesCscan: boolean
  /**
   * 장비에서 켠 게이트인가 (L5). 3.x 셋업 JSON 은 꺼진 게이트도 담고 켜짐 표시가 없어 비공개 BusinessSetup 첫 빔의
   * `GateSetup/IsEnabled` 로 정한다. 4.x JSON 은 켜진 게이트만 담는다(XML 이 있으면 그것과 맞춤). 모르면 null. 없으면(옛 결과·OPD) 모름
   */
  enabled?: boolean | null
  /** 게이트 안 봉우리 고르기: 'max' = 가장 큰 봉우리(Max Peak), 'first' = 첫 봉우리(First Peak, 측정값 끝에 '1'). 모르면 null */
  detection?: 'max' | 'first' | null
  /** 위치 측정 기준: 'peak' = 봉우리(측정값 '^'), 'edge' = 문턱을 처음 넘는 점(측정값 '/'). 모르면 null */
  event?: 'peak' | 'edge' | null
}

/** 스캔축 (U) */
export interface ViewerScanAxis {
  offsetMm: number
  resolutionMm: number
  count: number
}

/** 초음파 시간축 */
export interface ViewerUltrasoundAxis {
  resolutionUs: number
  count: number
}

/** 진폭 변환: %FSH = raw / rawMax × unitMax */
export interface AmplitudeScale {
  rawMax: number
  unitMax: number
  /**
   * true = 파일에 적힌 눈금이 아니라 추정한 눈금 (OPD: 화면 세 점으로 255 = 250 % 로 둠, OmniPC 캡처 대조 전).
   * 화면은 진폭 읽기값에 '추정 눈금'을 붙인다. NDE 는 이 칸이 없다
   */
  estimated?: boolean
}

export interface ViewerWeldCap {
  widthMm: number
  heightMm: number
}

/** 용접 개선 형상 (덮개 그리기용, 파일 weldGeometry 그대로 mm·°로) */
export interface ViewerWeld {
  bevelShape: string
  symmetry: string | null
  /** 루트 반 간격 (CL 에서 개선 면 바닥까지) */
  offsetMm: number
  landHeightMm: number
  hotPass: { angleDeg: number; heightMm: number } | null
  fills: Array<{ angleDeg: number; heightMm: number }>
  root: { angleDeg: number; heightMm: number } | null
  upperCap: ViewerWeldCap | null
  lowerCap: ViewerWeldCap | null
  hazWidthMm: number | null
  weldAngleDeg: number
  /**
   * 덮개 종류 (비공개 ModelSetup `Specimen/{Plate|Pipe}/Weld/WeldTemplateType` 그대로 — 'VOffset', 'Erw' …, L7).
   * 공개 JSON 은 ERW 배관 이음매도 bevelShape 'V' 로 적어서 이 칸으로만 가른다. 'Erw' 면 덮개는 개선면 대신 이음매 선(weld.ts).
   * 파일에 없으면 없음(옛 결과·OPD)
   */
  template?: string | null
  /** OPD 파일의 템플릿·대칭 코드 (이름 해석 전에도 보존) */
  templateCode?: number | null
  symmetryCode?: number | null
  /** OPD 템플릿 메뉴 이름의 추정 여부. 치수로 계산한 기하의 근사 여부와 구별한다. */
  templateEstimated?: boolean
  /** 숫자 층 치수만으로 그리는 단면 근사. 파일 템플릿/대칭 이름을 확정한 것은 아니다. */
  geometryEstimated?: boolean
  /**
   * S-scan 개선 덮개 옆에 붙이는 짧은 꼬리표 (OPD: '덮개 추정' — 개선 칸을 자체 해석으로 읽음, OmniPC 대조 전).
   * NDE 는 없음 → 그림 바이트 그대로
   */
  overlayNote?: string
}

export interface ViewerSpecimen {
  shape: 'plate' | 'pipe' | 'bar' | 'unspecified'
  /** OPD 시편 모양 코드의 이름 대응이 추정인 경우 */
  shapeEstimated?: boolean
  thicknessMm: number | null
  weld: ViewerWeld | null
}

/**
 * 진폭이 HDF5 데이터셋이 아니라 파일 바이트 구역에 있을 때 그 위치 (OPD: 회색조 색표 끝부터 [위치][빔][샘플] uint8).
 * 이때 amplitudePath·statusPath 는 표시용 이름('opd-raster' 등)이다
 */
export interface ViewerAmplitudeSource {
  kind: 'opd-raster'
  /** 래스터 시작 바이트 위치 */
  offset: number
  /** 한 스캔 칸(프레임) 바이트 = 빔 × 샘플 */
  frameBytes: number
  /** 저장 비트 수 (OPD 8 → 읽을 때 int16 으로 넓힘) */
  bitDepth: 8
}

/**
 * 공개되지 않은 형식을 구조로 읽었을 때 파일마다 한 자체 점검 (OPD). NDE 는 없다.
 * 판단 기준: 게이트 A 재계산 ↔ 장비 저장 값 ≥ 95 %, 출사점 ↔ 스넬 계산 ≤ 0.05 mm, 두께 칸 ↔ Hot Pass + Land + Root
 */
export interface ViewerSelfCheck {
  /** 게이트 A 일치율 (0~1): 게이트가 저장 구간 안에 다 들어오는 빔의 칸. 그런 빔이 없으면 null */
  gateAAgreement: number | null
  /** 게이트 A 일치율 (0~1): 빈 프레임을 뺀 모든 칸 (게이트가 저장 구간 밖까지 걸친 빔 포함) — 이것도 ≥ 95 % 여야 통과 */
  gateAAgreementAll: number
  /** 장비 저장 값 < 재계산 칸 비율 (0~1, 설명할 수 없는 어긋남). 10 % 를 넘으면 래스터 배치를 믿을 수 없어 그리지 않는다 */
  gateAUnexplained: number
  /** 센 신호(재계산 raw ≥ 224) 칸 일치율 (0~1). 그런 칸이 없으면 null */
  gateAStrongAgreement: number | null
  /** 래스터는 모두 0 인데 장비 게이트 결과가 남아 있는 프레임 수 (사본 손상 의심) */
  suspectFrames: number
  /** 출사점 ↔ 스넬 계산 최대 차 (mm). 계산하지 않았으면 null */
  snellMaxDiffMm: number | null
  /** 두께 칸이 용접 층 높이 합(Hot Pass + Land + Root)보다 작으면 true. 용접 칸이 없으면 null */
  thicknessMismatch: boolean | null
  /** 모두 0 인 프레임 수 (상태 비트 0 으로 넘긴다) */
  emptyFrames: number
  /** 점검마다 통과 여부 (null = 판정 못 함) */
  passed: { gateA: boolean | null; snell: boolean | null; thickness: boolean | null }
  /** 사용자에게 보일 한국어 메모 */
  notes: string[]
}

export interface ViewerGroup {
  /** 파일 안 그룹 id */
  id: number
  name: string
  technique: ViewerTechnique
  /** 그림을 그릴 수 있는가 */
  supported: boolean
  /** 그릴 수 없으면 이유 (한국어 한 문장) */
  reason: string | null
  /** OmniPC 화면과 대조해 확인된 형식인가 (아니면 화면에 '대조 전' 표시) */
  verified: boolean
  /** 진폭 HDF5 경로와 크기 [스캔, 빔, 샘플] */
  amplitudePath: string | null
  statusPath: string | null
  shape: [number, number, number]
  /** 진폭 배열 바이트 수 (int16) */
  bytes: number
  ampScale: AmplitudeScale
  scan: ViewerScanAxis
  /** 공간에 재배열된 Paintbrush 데이터. 배열의 두 번째 축은 빔 순번 대신 인덱스 위치다. */
  storageMode?: 'Paintbrush'
  spatialAxis?: { kind: 'index'; offsetMm: number; resolutionMm: number; count: number }
  ultrasound: ViewerUltrasoundAxis
  beams: ViewerBeam[]
  gates: ViewerGate[]
  /** C-scan 에 쓰는 게이트 (보통 Gate A). 없으면 null */
  cscanGateId: number | null
  /** 처음 보일 빔 (파일에 저장된 화면 상태, 없으면 가운데 빔) */
  initialBeam: number
  /** 파일 이득(dB, 하드웨어에서 이미 적용돼 저장됨). OmniPC DATA 패널 Gain = gainDb − referenceGainDb */
  gainDb: number | null
  /** 기준 이득(dB, OmniPC 'Ref'). 0 이거나 없으면 Ref 를 표시하지 않는다 */
  referenceGainDb: number | null
  /** Auto 80 % 의 목표 진폭 (% — 파일 referenceAmplitude, 없으면 80) */
  referenceAmplitudePct: number | null
  /** 진폭이 파일 바이트 구역에 있는 형식(OPD)의 위치. NDE(HDF5)는 없다 */
  amplitudeSource?: ViewerAmplitudeSource
  /** 파일 자체 점검 결과 (OPD). NDE 는 없다 */
  selfCheck?: ViewerSelfCheck
  /**
   * 자동 변환(derive)·학습 내보내기를 이 파일에서 막는 이유 (한국어 한 문장, OPD: 대조 전·진폭 눈금 추정·형상 모름·자체 점검·두께 불일치).
   * 라벨 기록은 막지 않는다. 없거나 null = 형식 쪽 이유 없음 (대조 여부는 verified 가 따로 막음). NDE 는 없다.
   * blockReasons 를 composeBlockReason 으로 이은 문장과 같다
   */
  blockReason?: string | null
  /** blockReason 의 항목별 목록 (학습 내보내기가 파일 정렬 두께가 있으면 'thickness' 를 빼는 등 항목을 골라 쓴다). NDE 는 없다 */
  blockReasons?: ViewerBlockReason[]
  /**
   * Ref 추정(levels.ts)의 근거 단계 (X2, OmniPC 대조 전 참고값). 4_NDE설정.md 8.3-4 조건:
   *   'tcg'          = 기준 이득 있음 + TCG 보정 참 + 모든 빔에 TCG 점 2개 이상 → 기준 반사체가 모든 깊이에서 기준 진폭으로 맞춰졌다고 볼 수 있음
   *   'single-depth' = 기준 이득은 있으나 TCG 근거가 모자람 → 기준 진폭이 한 깊이에서만 맞는 값(근거 약함)
   *   'none'         = 기준 이득 없음(0·없음) → Ref 를 추정하지 않음
   * 없으면(옛 결과·OPD) 판정 안 함
   */
  refBasis?: RefBasis
  /** 파일 셋업으로 추정한 Ref %FSH (= 기준 진폭 × 10^((이득 − 기준 이득)/20), levels.ts refPctFromSetup). 기준 이득이 없으면 null */
  refPct?: number | null
  /**
   * 파일에 저장된 분석(소프트) 이득 dB (L4) — 3.x·4.x 비공개 BusinessSetup `ContextGroupSetup/SoftGain`, 4.x 셋업 JSON 의
   * Software `gain` process. 저장 진폭에는 들어 있지 않다. 파일에 없으면 null. 그림·측정값·기록은 지금처럼 0 dB(파일 값) 기준
   */
  softGainDb?: number | null
  /** 탐촉자 위치·분석 오프셋 (X7, 4.x 비공개 BusinessSetup). 3.x(MXU 5.x) 파일은 분석 오프셋 칸이 없어 analysis* 가 null */
  positioning?: ViewerProbePositioning | null
}

/** Ref 추정 근거 단계 (ViewerGroup.refBasis) */
export type RefBasis = 'tcg' | 'single-depth' | 'none'

/**
 * 탐촉자(웨지) 위치 오프셋 mm (BusinessSetup `…PositioningSetup/{ScanOffset, IndexOffset, AnalysisScanOffset, AnalysisIndexOffset}`).
 * 셋업 JSON 의 웨지 위치 = 취득 오프셋 + 분석 오프셋이다(공식 예제 2개, 4_NDE설정.md 5.5) — 그래서 그림은 OmniPC 분석 화면과 같다.
 * 지문(c) 를 취득 값(= JSON − 분석)으로 계산할지는 사용자 결정 항목이라 지금 지문 규칙은 바꾸지 않고 값만 둔다.
 */
export interface ViewerProbePositioning {
  scanOffsetMm: number | null
  indexOffsetMm: number | null
  /** 분석 중 바꿔 저장한 오프셋 (4.x). 칸이 없으면 null */
  analysisScanOffsetMm: number | null
  analysisIndexOffsetMm: number | null
  /** 기준점 (4.2 이상 `ProbeOffsetReference`, 예 'WedgeStart'). 없으면 null */
  reference: string | null
}

/** 형식 쪽 막는 이유 한 항목 */
export interface ViewerBlockReason {
  code: ViewerBlockCode
  /** 짧은 한국어 ('OmniPC 대조 전(OPD 섹토리얼 · 스큐 90)') */
  text: string
}

/**
 * unverified-kind = (형식·기법·스큐) 대조 전 · amp-scale = 진폭 눈금 추정 · specimen-shape = 시편 형상 모름 ·
 * thickness = 두께 칸 의심 · gate-a·snell·self-check = 자체 점검 · strong-signal = 센 신호 칸 일치율 낮음 · suspect-frames = 손상 의심 프레임
 */
export type ViewerBlockCode =
  | 'unverified-kind'
  | 'amp-scale'
  | 'specimen-shape'
  | 'thickness'
  | 'gate-a'
  | 'snell'
  | 'self-check'
  | 'strong-signal'
  | 'suspect-frames'

/** 막는 이유 항목 → 한 문장 (없으면 null) */
export function composeBlockReason(reasons: readonly ViewerBlockReason[]): string | null {
  return reasons.length ? `OPD 파일이라 자동 변환·학습 내보내기를 막습니다: ${reasons.map((r) => r.text).join(' · ')}.` : null
}

/** 파일에 저장된 OmniPC/MXU 화면 상태 (없으면 기본값) */
export interface ViewerDisplay {
  /** 진폭 색표 256색 'rrggbb' */
  palette: string[]
  /**
   * OmniPC 특수색 3개. 순서는 MXU 4.4 설명서 7.5.1(.pal 형식): [0] 수집 안 됨(no-data, 기본 000000) ·
   * [1] 게이트 A 미검출(no-detection, ffffff) · [2] 게이트 I 미검출(no-synchro, 808080).
   * 뷰어는 지금 데이터 없음(hasData = 0)을 [2] 로 칠한다(palette.ts VIEWER_NO_DATA_SPECIAL_INDEX — 임시, 6.6 이 [0] 으로 칠하는지는 캡처 10·11 대조 전).
   * 학습 그림 내보내기 바깥 색은 따로 고정(EXPORT_OUTSIDE_SPECIAL_INDEX)
   */
  specialColors: string[]
  paletteSource: 'file' | 'default'
  layout: string | null
  layoutGroupMode: string | null
  currentGroupId: number | null
  /** true 면 C-scan 세로축의 첫 빔(작은 각도)이 아래 */
  cscanReversed: boolean
  /**
   * 파일에 저장된 측정값 목록 (L1, 비공개 ModelSetup `GroupSetup/ReadingSetup`) — 그룹마다 하나. 키는 파일 글자 그대로
   * (표시 이름·설명은 shared/imaging/readings.ts). 없으면(옛 결과·OPD) 모름
   */
  readings?: ViewerReadingSetup[]
}

/** 한 그룹의 저장된 측정값 목록 */
export interface ViewerReadingSetup {
  /** 셋업 그룹 id (buildViewerInfo 가 GroupSetup 과 맞춘 것). 맞는 그룹이 없으면 null */
  groupId: number | null
  /** 화면 그룹 이름 (`UserName`) */
  groupName: string | null
  /** 측정값 키 (목록 ① 다음 목록 ② 순서, 보통 5 + 5 = 10칸 — OmniPC 오른쪽 'Custom' 패널과 같은 순서) */
  keys: string[]
  /** `ReadingListId` — 두 묶음 중 장비 위쪽 막대에 보이는 것으로 보임 [추정]. 없으면 null */
  listId: number | null
}

/** 앱 이름·판 (파일 출처) */
export interface ViewerAppStamp {
  name: string | null
  version: string | null
}

/**
 * 파일 출처 (L6). 무엇이 이 파일을 만들고 마지막으로 저장했는지 — 검수에서 '장비 원본 그대로인지' 를 보고,
 * MXU 6.3.0 전 X4 파일의 웨지 오프셋 저장 오류(ndeformat MXU 변경 기록)를 알린다.
 */
export interface ViewerFileSource {
  /** 만든 앱 (3.x 루트 속성 'Application name/version', 4.x Properties `createdByApp*`) */
  createdBy: ViewerAppStamp | null
  /** 마지막으로 고친 앱 (4.x Properties `modifiedByApp*`. 3.x 는 없음) */
  modifiedBy: ViewerAppStamp | null
  /** 마지막으로 저장한 장비 앱 (비공개 ModelSetup `SoftwareInformation/{ApplicationId, FullSoftwareVersion}`) */
  savedBy: ViewerAppStamp | null
  /** 장비 ('MX3', 'X4' — ModelSetup `HardwareInformation/PlatformId`). 모르면 null */
  platform: string | null
  /** OmniPC 로 다시 저장한 파일 (ModelSetup 저장 앱 또는 Properties 고친 앱이 OmniPC) */
  resavedByOmniPC: boolean
  /** 마지막으로 이 파일을 쓴 MXU 판 ('6.6.0'). MXU 가 아니면 null */
  mxuVersion: string | null
  /** 이 파일을 만든 MXU 판 (만든 앱이 MXU 가 아니면 마지막 MXU 판). 모르면 null */
  createdMxuVersion: string | null
  /**
   * X4 파일인데 만든 MXU 판이 6.3.0 전 → 웨지 오프셋 저장 오류(UT 웨지 장착 위치·PA 사용자 웨지 secondaryOffset 부호)가 있었던 판.
   * 이 파일에 해당하는지는 대조 전
   */
  wedgeOffsetCaution: boolean
  /** 사람에게 보일 한국어 메모 (없으면 빈 배열) */
  notes: string[]
}

/** 이미지 보기 형식: NDE 3.x·4.x(HDF5), OPD(OmniScan MX2, 구조를 따라 읽음) */
export type ViewerFormatFamily = '3.x' | '4.x' | 'opd'

export interface ViewerFileInfo {
  formatFamily: ViewerFormatFamily
  version: string
  /** 공개되지 않은 형식을 구조로 읽은 규칙의 이름·버전 (OPD 'opd-structure'). NDE 는 없다 */
  reader?: { name: string; version: number }
  /**
   * 스캔축 동기 방식. 'unknown' = 파일에서 엔코더/시간 동기를 알 수 없어 mm 가 '칸 번호 × 간격' 명목값일 수 있다(OPD).
   * NDE 는 없다
   */
  scanSync?: 'unknown' | 'encoder' | 'time'
  groups: ViewerGroup[]
  specimen: ViewerSpecimen
  display: ViewerDisplay
  warnings: string[]
  /** 파일 출처 (L6). NDE 만 채운다(OPD 는 없음) */
  source?: ViewerFileSource
}

/** 사용자 OmniPC 색표 파일(.pal)을 읽은 결과 (L2 — 앱에 묶지 않고 사용자 폴더에서 불러온다) */
export interface ViewerPaletteFile {
  /** 파일 이름 (확장자 뺀 것, 예 'EVDNT_Amplitude') */
  name: string
  /** 256색 'rrggbb' (소문자) */
  palette: string[]
  /** 특수색 3개 (파일에 없으면 기본 000000·ffffff·808080) */
  specialColors: string[]
  /** 특수색을 파일에서 읽었나 (0개인 색표는 false) */
  specialFromFile: boolean
  /** 'xml' = XML 판 2.0, 'lines' = 머리말 없는 `R,G,B,F` 256줄 */
  format: 'xml' | 'lines'
}

/** 한 그룹의 진폭 조각 (스캔 scanStart 부터 scanCount 칸) */
export interface ViewerVolumeChunk {
  groupId: number
  scanStart: number
  scanCount: number
  /** [scanCount, 빔, 샘플] int16 */
  amplitude: Int16Array
  /** [scanCount, 빔] 상태 비트 (1 = 데이터 있음). 파일에 없으면 null */
  status: Uint8Array | null
}
