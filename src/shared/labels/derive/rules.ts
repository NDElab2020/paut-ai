/**
 * 기록 → 학습 라벨 변환 규칙서 (규격_초안.md 3·4절). 매개변수와 기본값 (런타임 의존성 없음).
 *
 * 규칙 버전 LABEL_DERIVE_RULES_VERSION: 계산 방법이나 기본값이 바뀌면 올린다.
 * 같은 입력 + 같은 규칙 버전 + 같은 매개변수 → 같은 출력(JSON 바이트까지).
 * 출력에는 실제로 쓴 매개변수 전부를 함께 적는다(resolveDeriveRules).
 *
 * 진폭 문턱은 모두 '절대 문턱'이다 (규격 3.3: 상대 −6 dB 는 포화된 에코에서 틀려 쓰지 않음).
 *   - 평가 기준 · 기록 기준 = 시방서 표 13 (levels.ts) × 파일 Ref 추정(%FSH). X3: 평가 ≈ 31.8 %, 기록(ℓ≤t) ≈ 63.5 %.
 *   - 결함 기록: 양성 = 기록 기준 이상, 약한 양성 = 평가 기준 이상 ~ 기록 기준 미만, 그 아래 = 무시.
 *   - 형상 에코(결함 아님): 평가 기준 이상인 곳만 라벨 (규격 3.2 '평가 기준 이상인 U 구간').
 * 약한 양성(weak)은 2026-10-06 새 기본값이다(사용자 확인 전): 따로 내보내고, 기본 학습·평가에서는 무시로 취급한다(weakAs).
 *   약한 양성은 (1) 관측 '보임' 레그의 장면 신호가 평가 기준 이상 ~ 기록 기준 미만인 칸, (2) 전문가가 지시 전체를
 *   기록 기준 미만으로 적은 기록(signal.exceedsRecordingLevel = false — 이 기록은 '보임' 문턱이 평가 기준, 객체는 최대 약한 양성)이다.
 *   관측 '약함' 레그는 무시다(규격 3.1). 평가 기준도 못 넘는다고 적은 기록(exceedsEvaluationLevel = false)은 모두 무시.
 *
 * 규칙 버전 2 (2026-10-06 검토 반영):
 *   - '보임' 판정·상자 씨앗은 투영 영역(± regionPadMm) 안 최대로 한다. 탐색 창(±3 mm·±2빔) 안으로 옮겨 찾기(snap)는
 *     전문가가 그리지 않은 그룹(엑셀: 기록 그룹이 아닌 그룹, 앱: 앵커가 없는 그룹·레그)에서 영역에 신호가 없을 때만 하고,
 *     기록 영역 밖의 루트·캡 형상 자리 칸은 빼고 찾는다.
 *   - 띠 위의 지시: 문턱을 max(절대 문턱, 상자 범위 포락선 바탕값(± noiseWindowMm 중앙값) + bandRiseDb)로 둔다
 *     (지침서 6.2(나)·8.2(2) '띠보다 6 dB 센 곳'). 바탕이 낮으면 절대 문턱 그대로다. 옮겨 찾은 최대도 그 자리 바탕보다 bandRiseDb 이상 세야 '보임'이다.
 *   - 상자·A-scan 구간·C-scan 상자는 같은 칸 묶음(영역 ± boxMarginMm 안에서 최대 칸과 이어진 덩어리)으로 만든다.
 */
import { amplitudeLevels, amplitudeTableOf, refPctFromSetup, type AmplitudeTable } from '../levels'
import type { GeometricEchoKind, RecordKind } from '../types'
import type { ViewerGroup } from '../../imaging/types'

/** 변환 규칙 버전. 계산 방법·기본값이 바뀌면 올린다 */
export const LABEL_DERIVE_RULES_VERSION = 2

/** 출력 형식 이름 */
export const DERIVED_LABELS_FORMAT = 'paut-derived-labels'

/**
 * 기록 구분별 처리
 * - defect: 세 상태(양성·약한 양성·무시)를 만들고 장면 상태를 정한다
 * - non-defect: '결함 아님' 라벨 (형상 에코). 장면은 음성이 될 수 있고, 에코 상자는 따로 붙는다
 * - ignore: 학습에서 뺀다 (형상 불완전 — 합부 대상인지 아직 정하지 않음, 지침서 8.4)
 */
export type KindPolicy = 'defect' | 'non-defect' | 'ignore'

/** 형상 에코 후보를 찾는 자리 */
export type EchoZone = 'root' | 'cap'

export interface EchoRules {
  /**
   * 빔 피복률 하한: 스캔 방향으로 평가 기준을 넘는 칸 비율이 이 이상인 빔을 형상 빔으로 본다.
   * 근거: 8/7 실험(07_프로토타입/05_YOLO실험 sizing.py MAX_COV) 형상 빔 56~89 %, 결함 빔 1~23 % 사이.
   */
  coverageMin: number
  /**
   * 피복률을 셀 때 이웃 빔 ± 이 수까지 함께 본다 (그 스캔 칸에서 이웃 빔 중 하나라도 평가 기준 이상이면 셈).
   * 용접선이 탐촉자에 대해 ±1~2 mm 흔들리면(시방서 6절 허용 ±2 mm) 띠가 이웃 빔으로 옮겨 다녀 빔 하나의 피복률이 낮게 나온다
   * (X3 12T-SV-01 Skew 270 루트 띠: 빔 하나 0.385, ±1 빔 0.4 이상). 0 = 8/7 실험처럼 빔 하나씩.
   */
  coverageBeamSpan: number
  /** 루트 자리: 실제 깊이 [t − 이 값, t] */
  rootDepthBandMm: number
  /** 루트 자리: |V| ≤ max(루트 반 간격, 아래 덧살 반폭) + 이 값 */
  rootMarginMm: number
  /** 캡 자리: 실제 깊이 [0, 이 값] */
  capDepthBandMm: number
  /** 캡 자리: |V| ≤ 캡 반폭 + 이 값 */
  capMarginMm: number
  /** 이보다 짧은 조각은 버린다 (mm) */
  minSegmentMm: number
  /**
   * 띠가 평가 기준 아래로 잠깐 떨어진 골을 이 길이(mm)까지 이어 한 조각으로 둔다.
   * 조각 끝마다 끝 여유(≥ 5 mm)가 무시가 되므로, 10 mm 이하 골은 이어도 음성이 줄지 않고 조각만 덜 쪼개진다.
   * 이은 골 안 칸은 에코 상자가 없을 뿐 음성이 될 수 있다(희미한 띠 = 결함 아님).
   */
  bridgeMm: number
  /** 띠 바탕값(같은 띠 ±anomalyWindowMm 중앙값)보다 이만큼 센 곳은 '확인 필요' (지침서 8.2, dB) */
  anomalyDb: number
  anomalyWindowMm: number
  /**
   * 자리별 제안 세부. 지침서 8.1: 원인을 확인하기 전에는 '기타'(X3 높은 각도 띠는 루트·캡 어느 쪽인지 모름).
   * 자리(zone)는 후보에 따로 남는다.
   */
  kindByZone: Record<EchoZone, GeometricEchoKind>
}

export interface DeriveRules {
  /** 탐색 창: 투영 영역 ± 이 값 (스캔 U·V·실제 깊이, mm). 규격 3.3 '±3 mm' */
  searchMarginMm: number
  /** 탐색 창: 빔 ± 이 값. 규격 3.3 '±2빔' */
  searchMarginBeams: number
  /** 투영 영역 칸 판정 여유 (mm). 칸 간격(빔 사이 0.3~0.9 mm)보다 얇은 영역도 칸을 잡게 */
  regionPadMm: number
  /** 상자·A-scan 구간·C-scan 상자가 퍼질 수 있는 범위: 기록 영역 ± 이 값 (mm). 형상 띠로 넘어가지 않게 */
  boxMarginMm: number
  /** 결함 칸은 그 자리 바탕(띠·잡음)보다 이 값(dB) 이상 세야 한다 — 띠 위에서 문턱을 올린다 (지침서 6.2(나)·8.2(2)) */
  bandRiseDb: number
  /** 옮겨 찾은(snap) 신호가 '보임'이 되려면 문턱 이상으로 이어지는 스캔 길이가 기록 스캔 범위의 이 비율 이상 */
  snapMinRunFraction: number
  /** 다루는 레그 상한 (1부터). 지침서 4.2 접기 표는 4레그까지 */
  maxLeg: number
  /** 끝 여유 최소 (mm). 규격 3.1 '고정 ±5 mm' */
  endMarginMinMm: number
  /** 끝 여유 상한 (mm). 띠를 따라 끝없이 늘지 않게 */
  endMarginMaxMm: number
  /** 잡음(바탕값) 창: 지시 앞뒤 ± 이 값의 포락선 중앙값 (지침서 6.2·8.2 '±40 mm 중앙값') */
  noiseWindowMm: number
  /** 끝 여유: 포락선이 잡음 + 이 값 아래로 떨어질 때까지 (규격 3.1 '잡음+6 dB') */
  noiseRiseDb: number
  /** 지시 나누기: 문턱 아래가 이 칸 수 이상 이어지면 끊는다 → 이보다 짧은 골은 잇는다 (지침서 9.1 '스캔 증분 2칸') */
  splitGapScans: number
  /** 포화 판정: 진폭 ≥ 상한 − 이 값 (%FSH). X3 포화 칸은 정확히 raw 32767 = 200 % */
  saturationTolPct: number
  /** 길이 제안: 포락선 최대와 바탕값의 차가 이보다 작으면 '제안 불가' (규격 4절, dB) */
  minDynamicRangeDb: number
  /** t < 8 길이: 최대에서 이만큼 떨어진 곳 (dB) */
  dropDb: number
  /** 이 두께(mm) 이상은 평가 기준 초과 구간, 미만은 6 dB 강하 + 곡률 보정 (시방서 15절) */
  lengthMethodThicknessMm: number
  /** 길이 제안: 최대가 포화면 '제안 불가' (규격 4절·지침서 290행). false 면 평가 기준 방식은 포화여도 제안 */
  suggestionBlockOnSaturation: boolean
  /** 길이 제안: 동적 범위가 이보다 작거나 구간이 끝에 닿으면 '확인 필요(띠 끌림 가능)' (dB, 부록 C 보조 그림 12 dB) */
  suggestionCheckDynamicRangeDb: number
  /** 신호 구간이 기록 범위(± 탐색 여유) 밖으로 이 거리까지만 따라간다 (mm) */
  maxRunBeyondWindowMm: number
  /** C-scan 상자: 그 게이트 창이 투영 영역 칸의 이 비율 이상을 덮을 때만 만든다 */
  gateCoverFraction: number
  /** '기준 미만 지시' 검토 구간 양끝 고정 여유 (mm) */
  belowThresholdMarginMm: number
  /** 약한 양성을 기본 학습·평가에서 어떻게 볼지 (새 기본값 'ignore', 사용자 확인 전) */
  weakAs: 'ignore' | 'positive'
  /**
   * 전문가가 확인하지도 그리지도 않은(계산만 한) 관측 레그에서 나온 양성을 기본 학습에서 어떻게 볼지.
   * 'keep' = 그대로(객체에 observation = 'computed' 와 issue 를 붙여 2b 내보내기가 거를 수 있게), 'ignore' = 무시
   */
  unconfirmedObservation: 'keep' | 'ignore'
  /** 기록 구분별 처리 */
  kindPolicy: Record<RecordKind, KindPolicy>
  /** 대조 전 그룹도 변환할지 (시험용. 앱은 false — 규격 2절 '자동 변환·학습 내보내기는 막음') */
  allowUnverified: boolean
  echo: EchoRules
}

export const DEFAULT_ECHO_RULES: Readonly<EchoRules> = Object.freeze({
  coverageMin: 0.4,
  coverageBeamSpan: 1,
  rootDepthBandMm: 3,
  rootMarginMm: 3,
  capDepthBandMm: 3,
  capMarginMm: 3,
  minSegmentMm: 2,
  bridgeMm: 10,
  anomalyDb: 6,
  anomalyWindowMm: 40,
  kindByZone: Object.freeze({ root: 'other', cap: 'other' }) as Record<EchoZone, GeometricEchoKind>
})

export const DEFAULT_DERIVE_RULES: Readonly<DeriveRules> = Object.freeze({
  searchMarginMm: 3,
  searchMarginBeams: 2,
  regionPadMm: 0.5,
  boxMarginMm: 1,
  bandRiseDb: 6,
  snapMinRunFraction: 0.3,
  maxLeg: 4,
  endMarginMinMm: 5,
  endMarginMaxMm: 20,
  noiseWindowMm: 40,
  noiseRiseDb: 6,
  splitGapScans: 2,
  saturationTolPct: 0.01,
  minDynamicRangeDb: 6,
  dropDb: 6,
  lengthMethodThicknessMm: 8,
  suggestionBlockOnSaturation: true,
  suggestionCheckDynamicRangeDb: 12,
  maxRunBeyondWindowMm: 20,
  gateCoverFraction: 0.5,
  belowThresholdMarginMm: 5,
  weakAs: 'ignore',
  unconfirmedObservation: 'keep',
  kindPolicy: Object.freeze({ defect: 'defect', 'geometric-echo': 'non-defect', 'geometric-imperfection': 'ignore' }) as Record<
    RecordKind,
    KindPolicy
  >,
  allowUnverified: false,
  echo: DEFAULT_ECHO_RULES as EchoRules
})

export type DeriveRulesInput = Partial<Omit<DeriveRules, 'echo' | 'kindPolicy'>> & {
  echo?: Partial<EchoRules>
  kindPolicy?: Partial<Record<RecordKind, KindPolicy>>
}

/** 기본값에 넘긴 값만 덮어쓴 규칙 (새 객체, 키 순서 고정 — 출력 JSON 이 같게) */
export function resolveDeriveRules(input?: DeriveRulesInput | null): DeriveRules {
  const d = DEFAULT_DERIVE_RULES
  const i = input ?? {}
  const echo: EchoRules = {
    coverageMin: i.echo?.coverageMin ?? d.echo.coverageMin,
    coverageBeamSpan: i.echo?.coverageBeamSpan ?? d.echo.coverageBeamSpan,
    rootDepthBandMm: i.echo?.rootDepthBandMm ?? d.echo.rootDepthBandMm,
    rootMarginMm: i.echo?.rootMarginMm ?? d.echo.rootMarginMm,
    capDepthBandMm: i.echo?.capDepthBandMm ?? d.echo.capDepthBandMm,
    capMarginMm: i.echo?.capMarginMm ?? d.echo.capMarginMm,
    minSegmentMm: i.echo?.minSegmentMm ?? d.echo.minSegmentMm,
    bridgeMm: i.echo?.bridgeMm ?? d.echo.bridgeMm,
    anomalyDb: i.echo?.anomalyDb ?? d.echo.anomalyDb,
    anomalyWindowMm: i.echo?.anomalyWindowMm ?? d.echo.anomalyWindowMm,
    kindByZone: {
      root: i.echo?.kindByZone?.root ?? d.echo.kindByZone.root,
      cap: i.echo?.kindByZone?.cap ?? d.echo.kindByZone.cap
    }
  }
  return {
    searchMarginMm: i.searchMarginMm ?? d.searchMarginMm,
    searchMarginBeams: i.searchMarginBeams ?? d.searchMarginBeams,
    regionPadMm: i.regionPadMm ?? d.regionPadMm,
    boxMarginMm: i.boxMarginMm ?? d.boxMarginMm,
    bandRiseDb: i.bandRiseDb ?? d.bandRiseDb,
    snapMinRunFraction: i.snapMinRunFraction ?? d.snapMinRunFraction,
    maxLeg: i.maxLeg ?? d.maxLeg,
    endMarginMinMm: i.endMarginMinMm ?? d.endMarginMinMm,
    endMarginMaxMm: i.endMarginMaxMm ?? d.endMarginMaxMm,
    noiseWindowMm: i.noiseWindowMm ?? d.noiseWindowMm,
    noiseRiseDb: i.noiseRiseDb ?? d.noiseRiseDb,
    splitGapScans: i.splitGapScans ?? d.splitGapScans,
    saturationTolPct: i.saturationTolPct ?? d.saturationTolPct,
    minDynamicRangeDb: i.minDynamicRangeDb ?? d.minDynamicRangeDb,
    dropDb: i.dropDb ?? d.dropDb,
    lengthMethodThicknessMm: i.lengthMethodThicknessMm ?? d.lengthMethodThicknessMm,
    suggestionBlockOnSaturation: i.suggestionBlockOnSaturation ?? d.suggestionBlockOnSaturation,
    suggestionCheckDynamicRangeDb: i.suggestionCheckDynamicRangeDb ?? d.suggestionCheckDynamicRangeDb,
    maxRunBeyondWindowMm: i.maxRunBeyondWindowMm ?? d.maxRunBeyondWindowMm,
    gateCoverFraction: i.gateCoverFraction ?? d.gateCoverFraction,
    belowThresholdMarginMm: i.belowThresholdMarginMm ?? d.belowThresholdMarginMm,
    weakAs: i.weakAs ?? d.weakAs,
    unconfirmedObservation: i.unconfirmedObservation ?? d.unconfirmedObservation,
    kindPolicy: {
      defect: i.kindPolicy?.defect ?? d.kindPolicy.defect,
      'geometric-echo': i.kindPolicy?.['geometric-echo'] ?? d.kindPolicy['geometric-echo'],
      'geometric-imperfection': i.kindPolicy?.['geometric-imperfection'] ?? d.kindPolicy['geometric-imperfection']
    },
    allowUnverified: i.allowUnverified ?? d.allowUnverified,
    echo
  }
}

/** 문턱 아래 골을 이을 칸 수 (splitGapScans − 1, 0 이상) */
export function bridgeCells(rules: Pick<DeriveRules, 'splitGapScans'>): number {
  return Math.max(0, Math.floor(rules.splitGapScans) - 1)
}

// ───────────────────────────── 진폭 기준 (%FSH) ─────────────────────────────

/** 그룹 하나의 진폭 기준 (%FSH, 파일 이득 그대로). 대조 전 추정값 */
export interface GroupLevels {
  /** Ref (기준 감도) %FSH */
  refPct: number
  /** 적용한 표 13 의 줄 */
  table: AmplitudeTable
  /** Ref 를 어디서 얻었나: 파일 셋업 추정 / 부르는 쪽이 넘긴 값 */
  refSource: 'setup' | 'override'
  /** 평가 기준 %FSH */
  evaluationPct: number
  /** 기록 기준 %FSH: 길이 ℓ ≤ t (t ≥ 8 이면 Ref −8 dB, t < 8 이면 −12 dB) */
  recordingShortPct: number
  /** 기록 기준 %FSH: 길이 ℓ > t */
  recordingLongPct: number
}

function pctOf(refPct: number, db: number): number {
  return refPct * 10 ** (db / 20)
}

/**
 * 그룹의 진폭 기준. Ref 를 모르거나 두께가 시방서 표 13 범위 밖이면 null (자동 변환을 막는다).
 * refPctOverride 가 있으면 파일 셋업 추정 대신 쓴다.
 */
export function groupLevelsOf(
  group: Pick<ViewerGroup, 'gainDb' | 'referenceGainDb' | 'referenceAmplitudePct'>,
  thicknessMm: number | null,
  refPctOverride?: number | null
): GroupLevels | null {
  const table = amplitudeTableOf(thicknessMm)
  if (table === null || thicknessMm === null) return null
  const override = refPctOverride !== undefined && refPctOverride !== null && refPctOverride > 0 ? refPctOverride : null
  // 기준 이득이 0 이면 Ref 를 표시하지 않는다(뷰어 규칙) — 추정도 하지 않는다
  const refGain = group.referenceGainDb !== null && group.referenceGainDb !== 0 ? group.referenceGainDb : null
  const refPct = override ?? refPctFromSetup(group.gainDb, refGain, group.referenceAmplitudePct)
  if (refPct === null || !(refPct > 0)) return null
  const shortL = amplitudeLevels({ maxAmplitudePct: null, refPct, lengthMm: 0, thicknessMm })
  const longL = amplitudeLevels({ maxAmplitudePct: null, refPct, lengthMm: thicknessMm + 1, thicknessMm })
  if (shortL.evaluationLevelDb === null || shortL.recordingLevelDb === null || longL.recordingLevelDb === null) return null
  return {
    refPct,
    table,
    refSource: override !== null ? 'override' : 'setup',
    evaluationPct: pctOf(refPct, shortL.evaluationLevelDb),
    recordingShortPct: pctOf(refPct, shortL.recordingLevelDb),
    recordingLongPct: pctOf(refPct, longL.recordingLevelDb)
  }
}

/** 기록 하나의 기록 기준 (%FSH): 길이 ℓ 와 두께 t 로 표 13 의 줄을 고른다. 길이를 모르면 ℓ ≤ t 쪽(높은 문턱) */
export function recordingPctFor(levels: GroupLevels, lengthMm: number | null, thicknessMm: number): number {
  if (lengthMm === null || !Number.isFinite(lengthMm)) return levels.recordingShortPct
  return lengthMm <= thicknessMm ? levels.recordingShortPct : levels.recordingLongPct
}

/**
 * 기록 구분별 문턱 (%FSH):
 *   visiblePct  관측 '보임' 문턱 (결함 = 기록 기준, 형상 에코 = 평가 기준, 기록 기준 미만 기록 = 평가 기준)
 *   positivePct 양성 문턱 (기록 기준 미만 기록은 Infinity — 양성 없음)
 *   weakPct     약한 양성 문턱 (없으면 null)
 */
export interface KindThresholds {
  visiblePct: number
  positivePct: number
  weakPct: number | null
}

/** 전문가가 적은 신호 등급으로 기록 객체의 상태 상한: 평가 기준 미만 → 무시, 기록 기준 미만 → 약한 양성 */
export type RecordCap = 'none' | 'weak' | 'ignore'

export function recordCapOf(signal: { exceedsEvaluationLevel: boolean | null; exceedsRecordingLevel: boolean | null } | null | undefined): RecordCap {
  if (signal?.exceedsEvaluationLevel === false) return 'ignore'
  if (signal?.exceedsRecordingLevel === false) return 'weak'
  return 'none'
}

export function thresholdsFor(
  policy: KindPolicy,
  levels: GroupLevels,
  lengthMm: number | null,
  thicknessMm: number,
  cap: RecordCap = 'none'
): KindThresholds {
  if (policy === 'non-defect') return { visiblePct: levels.evaluationPct, positivePct: levels.evaluationPct, weakPct: null }
  if (cap === 'weak') return { visiblePct: levels.evaluationPct, positivePct: Infinity, weakPct: levels.evaluationPct }
  const rec = recordingPctFor(levels, lengthMm, thicknessMm)
  return { visiblePct: rec, positivePct: rec, weakPct: rec > levels.evaluationPct ? levels.evaluationPct : null }
}

/**
 * 바탕 위 문턱 바닥 = 바탕값 + riseDb. 결함 칸은 그 자리 바탕(띠·잡음)보다 riseDb 이상 세야 한다(SNR, 지침서 6.2(나)·8.2(2)).
 * 바탕이 낮으면(잡음 2 %) 바닥이 절대 문턱보다 낮아 아무 영향이 없고, 띠 위에서만 문턱이 오른다.
 * evaluationPct 는 호환용 인자(쓰지 않음): 바탕이 평가 기준 아래인 약한 띠(예: 루트 띠 20~30 %)에서도 문턱이 올라야
 * 띠 칸이 결함 상자로 번지지 않는다(X3 #05 검증).
 */
export function bandFloorPct(backgroundPct: number | null, _evaluationPct: number, riseDb: number): number {
  if (backgroundPct === null || !(backgroundPct > 0)) return 0
  return backgroundPct * 10 ** (riseDb / 20)
}

/** 띠 문턱을 반영한 문턱 */
export function raiseThresholds(th: KindThresholds, floorPct: number): KindThresholds {
  if (!(floorPct > 0)) return th
  const positivePct = Math.max(th.positivePct, floorPct)
  const weak = th.weakPct === null ? null : Math.max(th.weakPct, floorPct)
  return { visiblePct: Math.max(th.visiblePct, floorPct), positivePct, weakPct: weak !== null && weak < positivePct ? weak : null }
}
