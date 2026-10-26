/**
 * 진폭 기준 계산 — 시방서 16.2 표 13 (런타임 의존성 없음).
 *
 * 엑셀(OmniPC) 기록은 최대 진폭(%FSH)만 있다. 이 모듈이 파일 Ref 추정과 길이·두께로
 * Ref 대비 dB, 평가 기준 초과, 기록 기준 초과를 채운다(signal.refDb · exceedsEvaluationLevel · exceedsRecordingLevel).
 *
 * Ref 추정 (대조 전): 기준 이득(referenceGain)에서 대비 반사체가 기준 진폭(80 %FSH)이었고, 파일 이득과의 차만큼 커졌다고 본다.
 *   Ref %FSH = 기준 진폭 × 10^((이득 − 기준 이득) / 20). X3: 80 × 10^(6/20) ≈ 159.6 %FSH.
 *   대비 반사체 종류·TCG 기준 진폭이 OmniPC 와 대조되기 전이라 결과는 refDbVerified = false(참고값)로 둔다.
 *
 * 표 13 (경계값은 '이상'을 초과로 본다 — 시방서 문구 '초과'와 같은지 원문 대조 전):
 *   3.2 ≤ t < 8 (ISO 4761 L2): 평가 기준 Ref −12 dB, 기록 기준 Ref −12 dB
 *   8 ≤ t ≤ 15 (ISO 19285 L2): 평가 기준 Ref −14 dB, 기록 기준 ℓ ≤ t 이면 Ref −8 dB, ℓ > t 이면 Ref −14 dB
 *   그 밖의 두께는 시방서 범위 밖 → 판정하지 않음(null)
 * 포화(≥ 200 %FSH)된 진폭은 실제 값의 하한이다. 하한이 기준 이상이면 초과, 아니면 모름(null).
 *
 * OmniPC 측정값과의 대응 (OmniPC_조사/조사_보고.md 5.1절, 허용 근거 = MXU 설명서 4.4·5.6·5.8 + 캡처):
 *   AdBA = 게이트 A 문턱 대비 dB 다(Ref 대비 아님 — 설명서 3판 + TP14 캡처 10.18 dB 일치). 그래서 refDb 칸에 넣지 않고 메모·대조용으로만 쓴다.
 *   Ref 대비에 해당하는 값은 AdBr(기준 진폭 대비)와 TCG 파일의 AdBCurve(sizing curve 대비)다. 이 모듈의 Ref 대비 dB 와 같은 식인지
 *   (Gain Δ 를 빼는지, 기준이 80 % 인지)는 추정이고, AdBA 가 Gain Δ 를 빼는지(식 ①)와 함께 캡처 46 전이다.
 */

/** 표 13 의 줄 */
export type AmplitudeTable = '4761-L2' | '19285-L2'

export interface AmplitudeLevels {
  /** 적용한 표 13 의 줄. 두께가 시방서 범위 밖이거나 모르면 null */
  table: AmplitudeTable | null
  /** Ref 대비 dB = 20·log10(최대 진폭 / Ref). 진폭·Ref 를 모르면 null. 포화면 하한 */
  refDb: number | null
  /** 평가 기준 (Ref 대비 dB) */
  evaluationLevelDb: number | null
  /** 기록 기준 (Ref 대비 dB). t ≥ 8 에서 길이를 모르면 null */
  recordingLevelDb: number | null
  exceedsEvaluationLevel: boolean | null
  exceedsRecordingLevel: boolean | null
}

/** 파일 셋업으로 Ref(%FSH) 추정. 값이 모자라면 null (대조 전) */
export function refPctFromSetup(gainDb: number | null, referenceGainDb: number | null, referenceAmplitudePct: number | null): number | null {
  if (gainDb === null || referenceGainDb === null || referenceAmplitudePct === null) return null
  if (!Number.isFinite(gainDb) || !Number.isFinite(referenceGainDb) || !(referenceAmplitudePct > 0)) return null
  return referenceAmplitudePct * 10 ** ((gainDb - referenceGainDb) / 20)
}

/** 두께에 맞는 표 13 의 줄 */
export function amplitudeTableOf(thicknessMm: number | null): AmplitudeTable | null {
  if (thicknessMm === null || !Number.isFinite(thicknessMm)) return null
  if (thicknessMm >= 3.2 && thicknessMm < 8) return '4761-L2'
  if (thicknessMm >= 8 && thicknessMm <= 15) return '19285-L2'
  return null
}

/** 하한(포화) 진폭이면 '이상'일 때만 참, 아니면 모름 */
function exceeds(refDb: number | null, levelDb: number | null, saturated: boolean): boolean | null {
  if (refDb === null || levelDb === null) return null
  if (refDb >= levelDb) return true
  return saturated ? null : false
}

export function amplitudeLevels(input: {
  maxAmplitudePct: number | null
  refPct: number | null
  lengthMm: number | null
  thicknessMm: number | null
  saturated?: boolean | null
}): AmplitudeLevels {
  const table = amplitudeTableOf(input.thicknessMm)
  const amp = input.maxAmplitudePct
  const ref = input.refPct
  const refDb = amp !== null && ref !== null && amp > 0 && ref > 0 ? 20 * Math.log10(amp / ref) : null
  const saturated = input.saturated === true
  if (table === null) {
    return { table, refDb, evaluationLevelDb: null, recordingLevelDb: null, exceedsEvaluationLevel: null, exceedsRecordingLevel: null }
  }
  if (table === '4761-L2') {
    const e = exceeds(refDb, -12, saturated)
    return { table, refDb, evaluationLevelDb: -12, recordingLevelDb: -12, exceedsEvaluationLevel: e, exceedsRecordingLevel: e }
  }
  const t = input.thicknessMm as number
  const len = input.lengthMm
  const recordingLevelDb = len === null ? null : len <= t ? -8 : -14
  let exceedsRecordingLevel = exceeds(refDb, recordingLevelDb, saturated)
  if (recordingLevelDb === null && refDb !== null) {
    // 길이를 몰라도 두 기준(−8·−14 dB) 모두 넘거나 모두 못 넘으면 정해진다
    if (refDb >= -8) exceedsRecordingLevel = true
    else if (refDb < -14 && !saturated) exceedsRecordingLevel = false
  }
  return {
    table,
    refDb,
    evaluationLevelDb: -14,
    recordingLevelDb,
    exceedsEvaluationLevel: exceeds(refDb, -14, saturated),
    exceedsRecordingLevel
  }
}
