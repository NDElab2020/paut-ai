/**
 * 지시 매칭 v1 (순수 함수, 런타임 의존성 없음).
 * 문서: 계획_라벨링/평가_정의_v1.md 3·4절. 규격: 계획_라벨링/규격_초안.md 5.3절.
 *
 * 두 지시 목록(정답 ↔ AI, 라벨러 A ↔ B, 우리 ↔ 전문기관)을 같은 규칙으로 짝짓는다.
 * 2인 일치도, AI 평가, 전문기관 비교가 모두 이 함수 하나를 쓴다. 지표 계산은 metrics.ts.
 *
 * 좌표: 기록의 파생 mm(IndicationRecord.derived)만 쓴다. 앵커가 없는 엑셀 기록도 그대로 된다.
 *   - 'file' 틀: 같은 sha256 끼리만 비교. 스캔 위치 = 파일 U (mm).
 *   - 'weld' 틀: 파일 정렬(FileAlignment)로 시편 좌표 s = 방향 × (U − 기준점 U) 로 바꾼 뒤
 *     같은 (시편 ID, 용접부 ID) 끼리 비교. 물리 결함 설계값(이미 시편 좌표)과도 이 틀에서 비교한다.
 *     시편·용접부 ID 는 앞뒤 공백을 떼고 대문자로 맞춘다. 한쪽만 용접부 ID 가 비었고 다른 쪽에 그 시편의
 *     용접부가 하나뿐이면 그 용접부로 본다(확인 사항을 남김). 가설 정렬(alignmentAssumed)로 낸 좌표에도 확인 사항을 남긴다.
 *     관(외경 있음)의 원주를 한 바퀴로 감는 처리는 아직 없다(v1, 0단계는 평판) — 확인 사항으로 알린다.
 *
 * 같은 지시로 보는 조건 (모두 만족):
 *   1. 같은 틀 키 (같은 파일, 또는 같은 용접부)
 *   2. 같은 측: 둘 다 L/R 을 알면 같아야 한다. 하나라도 모르면 unknownSide 규칙('pass' = 통과)
 *   3. 스캔 구간이 겹치거나 간격 ≤ X (scanGapMm). 맞닿음(간격 0)은 겹침으로 본다
 *   4. 깊이 중심 차 ≤ Y (depthDiffMm). 깊이 중심 = (깊이 위 + 아래)/2, 둘 다 없으면 최대 진폭 깊이(signal.peak.depthMm).
 *      하나라도 모르면 unknownDepth 규칙
 *   경계값은 같다(≤)를 포함한다. 부동소수 오차 때문에 1e-9 mm 여유를 둔다.
 *
 * 1:1 짝짓기 방법 (탐욕, 두 차례):
 *   - 조건을 만족하는 모든 (a, b) 후보에 비용을 매긴다.
 *       비용 = |스캔 중심 차| / (X + 두 구간 반길이 합) + |깊이 중심 차| / Y
 *     두 항 모두 0(완전히 같음) ~ 1(허용 한계)이다. 스캔 항의 분모는 '간격 ≤ X' 조건이 허용하는
 *     최대 중심 거리라서(간격 = max(0, |중심 차| − 반길이 합)), 긴 지시와 짧은 지시를 같은 잣대로 본다.
 *     깊이를 모르면 깊이 항은 1(허용 한계)로 둔다 — 깊이까지 맞는 쌍을 먼저 고르게.
 *   - 비용이 작은 쌍부터 차례로, 두 쪽 모두 아직 짝이 없으면 짝짓는다. 같은 비용이면 a 의 id, b 의 id,
 *     입력 순서로 정한다(같은 입력 → 같은 결과).
 *   - 1차: 셈하는 단위끼리만 짝짓는다. 2차: 남은 단위와 참고 단위(불확실·기록 기준 미만·낮은 정답 계층)를 짝짓는다.
 *     참고 단위가 셈하는 단위의 짝을 빼앗지 않게 하려는 것이다.
 *   - 탐욕은 짝 수를 최대로 만든다는 보장이 없다(예: a1 이 b1·b2 둘 다, a2 는 b1 만 맞을 때 a1–b1 이 가장
 *     싸면 a2 는 짝을 잃는다). 허용치가 결함 간격보다 충분히 작으면 드물다. 짝을 잃은 단위는
 *     hadCandidate = true 로 표시해 보고서에서 따로 볼 수 있게 한다.
 *
 * 비교 단위: unit = 'grouping' 이면 같은 groupingId 기록을 한 단위로 합친다(그룹 짓기 후 비교, 기본).
 *   groupingId 는 grouping.ts computeGrouping(시방서 그림 5·6)이 채운다. 저장소는 recomputeGrouping 으로 기록에 넣고,
 *   검수 비교(review/compare.ts compareLabelSets)는 비교할 때 다시 묶을 수도 있다. groupingId 가 비면 'record' 와 같게 돈다.
 *   합친 단위의 길이는 grouping.ts groupLengthMm 와 같은 계산(Σ 잰 길이 + Σ 간격, 겹치면 합집합)이다.
 * 2인 비교·확정(Level III)·설계값 대조·보고서는 review/ 가 이 함수들 위에 얹는다.
 * 참고 구역: 상대 쪽 검토 구간 중 '기준 미만 지시'·'품질 불량' 구간에 걸친 짝 없는 단위는 zone 을 붙인다.
 *   metrics.ts 는 정답 쪽 구역에 든 예측을 오검출에서 뺀다.
 * 검토 범위: coverage 규칙('truth' = 정답 쪽 검토 완료 구간, 'both' = 두 쪽 검토 완료의 교집합)으로 정한 범위 밖의
 *   짝 없는 단위에는 outsideCoverage 를 붙인다. metrics.ts 는 이것을 오검출·미검출에서 빼고 따로 센다.
 */
import type {
  Confidence,
  FileAlignment,
  IndicationRecord,
  JudgmentCharacter,
  MetallurgicalType,
  PhysicalDefect,
  RecordKind,
  ReviewInterval,
  ReviewIntervalKind,
  WeldSide
} from './types'
import { TRUTH_TIER_RANK, defaultCharacterOf, truthTierOfSource, type TruthTier } from './codes'
import { groupLengthMm } from './grouping'
import { intersectCoverage, intervalGap, mergeSpans, touchesCoverage, type Span } from './spans'

// ───────────────────────────── 규칙 버전 · 잠정값 ─────────────────────────────

/** 매칭 규칙 버전. 조건이나 짝짓기 방법이 바뀌면 올린다. X·Y 값은 버전이 아니라 MatchParams 로 기록한다 */
export const MATCH_RULES_VERSION = 1

/**
 * 잠정 X (스캔 간격 허용, mm). 0단계 2인 라벨 차이 분포로 정하고 시험 전에 동결하기 전까지만 쓴다.
 * 근거: PCN TP03 수정 위치 약 10 mm, 국내 라운드로빈 길이 RMSE 5.65 mm 의 약 2배 (평가_정의_v1.md 4.4절)
 */
export const PROVISIONAL_SCAN_GAP_MM = 10
/**
 * 잠정 Y (깊이 중심 차 허용, mm). 근거: 국내 라운드로빈 높이 RMSE 1.69 mm 로 어림한 두 사람 차이의 95 % 폭
 * 1.69 × √2 × 1.96 ≈ 4.7 mm 를 올림. 12 mm 판의 t/2 = 6 mm(시방서 그룹 짓기 두께 방향 기준)보다 작다
 */
export const PROVISIONAL_DEPTH_DIFF_MM = 5

/** 경계값 비교 여유 (mm). 100.3 − 100.0 = 0.29999… 같은 부동소수 오차를 흡수한다 */
export const MATCH_EPS_MM = 1e-9

// ───────────────────────────── 인자 ─────────────────────────────

/** 기록을 어떻게 다루나: 셈함 / 참고(짝은 짓되 셈하지 않음) / 뺌 */
export type ItemPolicy = 'count' | 'reference' | 'exclude'
/** 비교 좌표 틀 */
export type MatchFrame = 'file' | 'weld'
/** 비교 단위: 기록 하나 / 그룹 짓기 후 */
export type MatchUnit = 'record' | 'grouping'
/** 값을 모를 때: 조건 통과 / 짝 안 됨 */
export type UnknownRule = 'pass' | 'fail'
/** 검토 범위: 정답 쪽 검토 완료 / 두 쪽 검토 완료의 교집합(2인 비교) / 범위를 보지 않음 */
export type CoverageRule = 'truth' | 'both' | 'none'
/** 참고 단위가 된 이유. low-tier = 물리 결함 설계값의 정답 계층이 기준(minTier)보다 낮음 */
export type ReferenceReason = 'uncertain' | 'below-recording' | 'low-tier'
/** 비교에서 뺀 이유. released = 검토 뒤 기록을 고쳐 자동으로 풀린 검토 완료 구간 */
export type ExcludeReason = 'deleted' | 'released' | 'kind' | 'uncertain' | 'below-recording' | 'no-alignment' | 'bad-coords'
/** 깊이 중심을 무엇에서 냈나: 깊이 위·아래 / 최대 진폭 깊이 / 설계값 */
export type DepthSource = 'range' | 'peak' | 'design'

export interface MatchParams {
  /** X: 스캔 구간 간격 허용 (mm, ≥ 0). 겹치면 간격 0 */
  scanGapMm: number
  /** Y: 깊이 중심 차 허용 (mm, ≥ 0) */
  depthDiffMm: number
  frame: MatchFrame
  /** sha256 → 시편 좌표 변환 ('weld' 틀). 'file' 틀에서도 주면 물리 결함 키(시편 ID)를 찾는 데 쓴다 */
  alignments: readonly FileAlignment[]
  unit: MatchUnit
  /** 비교할 기록 구분. 기본 ['defect'] — 형상 에코·형상 불완전은 결함 평가에서 뺀다 */
  kinds: readonly RecordKind[]
  /** 존재 확신도 '불확실' 기록. 기본 'reference' (시험은 별도 범주, 평가_정의_v1.md 6절) */
  uncertain: ItemPolicy
  /** 기록 기준 미만(signal.exceedsRecordingLevel === false) 기록. 기본 'reference' */
  belowRecording: ItemPolicy
  /** 삭제 표시 기록도 넣을지. 기본 false (삭제 표시는 지시가 아님) */
  includeDeleted: boolean
  /** 측(L/R)을 하나라도 모를 때. 기본 'pass' (가운데 루트 지시는 측이 없음) */
  unknownSide: UnknownRule
  /** 깊이를 하나라도 모를 때. 기본 'pass' (X3 결함정보처럼 위치만 있는 정답) */
  unknownDepth: UnknownRule
  /** 참고 구역으로 볼 검토 구간 종류. 기본 ['below-threshold', 'quality-bad'] */
  zoneKinds: readonly ReviewIntervalKind[]
  /** 검토 범위 규칙. 기본 'truth'. 2인 비교는 'both' */
  coverage: CoverageRule
}

/** 기본 인자 (잠정 X·Y). 넘긴 값만 덮어쓴다 */
export function matchParams(over: Partial<MatchParams> = {}): MatchParams {
  return {
    scanGapMm: PROVISIONAL_SCAN_GAP_MM,
    depthDiffMm: PROVISIONAL_DEPTH_DIFF_MM,
    frame: 'file',
    alignments: [],
    unit: 'grouping',
    kinds: ['defect'],
    uncertain: 'reference',
    belowRecording: 'reference',
    includeDeleted: false,
    unknownSide: 'pass',
    unknownDepth: 'pass',
    zoneKinds: ['below-threshold', 'quality-bad'],
    coverage: 'truth',
    ...over
  }
}

function checkParams(p: MatchParams): void {
  if (!Number.isFinite(p.scanGapMm) || p.scanGapMm < 0) {
    throw new RangeError(`매칭 허용치 X(스캔 간격)는 0 이상의 숫자여야 합니다: ${String(p.scanGapMm)}`)
  }
  if (!Number.isFinite(p.depthDiffMm) || p.depthDiffMm < 0) {
    throw new RangeError(`매칭 허용치 Y(깊이 중심 차)는 0 이상의 숫자여야 합니다: ${String(p.depthDiffMm)}`)
  }
}

// ───────────────────────────── 비교 단위 ─────────────────────────────

/** 비교 단위 하나. 좌표는 틀(파일 U 또는 시편 좌표)의 mm */
export interface MatchItem {
  /** 기록 하나면 그 UUID, 그룹이면 'group:<groupingId>', 물리 결함이면 'defect:<시편 ID>/<결함 ID>' */
  id: string
  source: 'record' | 'group' | 'physical-defect'
  /** 이 단위를 이룬 기록 UUID (물리 결함은 빈 목록) */
  recordUuids: string[]
  sha256s: string[]
  /** 'file:<sha256>' 또는 'weld:<시편 ID>|<용접부 ID>' (ID 는 공백을 떼고 대문자) */
  frameKey: string
  side: WeldSide | null
  /** scanStartMm ≤ scanEndMm 로 정리됨. 한 점만 알면 둘이 같다 */
  scanStartMm: number
  scanEndMm: number
  depthTopMm: number | null
  depthBottomMm: number | null
  depthCenterMm: number | null
  /** 깊이 중심을 낸 곳. null = 깊이 모름 */
  depthSource: DepthSource | null
  /** 잰 길이 (mm). 기록의 length.valueMm, 없으면 스캔 범위 길이(0 이면 null). 그룹은 Σ 길이 + Σ 간격 */
  lengthMm: number | null
  /** 잰 높이 (mm). 기록의 height.valueMm 만 쓴다 — 화면 상자 높이는 크기 정답이 아님. 그룹은 구성원 잰 높이의 최댓값 */
  heightMm: number | null
  kind: RecordKind
  defectType: MetallurgicalType | null
  /** 종류 확신도. '불확실'이면 종류 혼동표에서 뺀다(검출 평가에는 넣음) */
  typeConfidence: Confidence | null
  /** 판정 특성. 비어 있으면 종류의 기본값 */
  character: JudgmentCharacter | null
  /** false = 참고 단위 (짝은 짓되 재현율·오검출에 셈하지 않음) */
  counted: boolean
  referenceReasons: ReferenceReason[]
  /** 물리 결함 키 '<시편 ID>/<결함 ID>' (대문자 시편 ID). 모르면 null. 물리 결함 단위 재현율에 쓴다 */
  physicalDefectKey: string | null
  /** 물리 결함 설계값의 정답 계층 (기록은 null) */
  truthTier: TruthTier | null
  /** 가설 정렬(alignmentAssumed)로 낸 시편 좌표인지 */
  alignmentAssumed: boolean
}

/** 비교에서 뺀 기록 */
export interface ExcludedRecord {
  uuid: string
  reason: ExcludeReason
}

export interface PreparedItems {
  items: MatchItem[]
  excluded: ExcludedRecord[]
  /** 한국어 확인 사항 (같은 UUID 둘 이상 등) */
  warnings: string[]
}

/** 검토 구간을 틀 좌표로 옮긴 것 */
export interface FrameSpan {
  frameKey: string
  startMm: number
  endMm: number
  kind: ReviewIntervalKind
  /** null = 모든 그룹 */
  groupId: number | null
  uuid: string
  sha256: string
}

/** 시편·용접부 ID 맞추기: 앞뒤 공백을 떼고 대문자 */
export function normalizeId(id: string | null): string {
  return (id ?? '').trim().toUpperCase()
}

function fileKey(sha256: string): string {
  return `file:${sha256}`
}

function weldKey(specimenId: string, weldId: string | null): string {
  return `weld:${normalizeId(specimenId)}|${normalizeId(weldId)}`
}

function defectKey(specimenId: string, id: string): string {
  return `${normalizeId(specimenId)}/${id.trim()}`
}

/** sha256 → 정렬. 같은 파일 정렬이 둘 이상이면 revision 이 큰 쪽. 삭제 표시는 뺀다 */
function alignmentMap(alignments: readonly FileAlignment[], warnings: string[]): Map<string, FileAlignment> {
  const m = new Map<string, FileAlignment>()
  for (const al of alignments) {
    if (al.deleted) continue
    const prev = m.get(al.sha256)
    if (prev) {
      warnings.push(`파일 정렬이 둘 이상입니다(${al.fileName}). revision 이 큰 쪽을 씁니다.`)
      if (al.revision <= prev.revision) continue
    }
    m.set(al.sha256, al)
  }
  return m
}

type Placed = { frameKey: string; start: number; end: number; assumed: boolean; pipe: boolean } | null

/** 파일 U 구간 → 틀 좌표. 정렬이 없으면 null */
function place(
  sha256: string,
  u0: number,
  u1: number,
  frame: MatchFrame,
  aligns: Map<string, FileAlignment>
): Placed {
  if (frame === 'file') return { frameKey: fileKey(sha256), start: Math.min(u0, u1), end: Math.max(u0, u1), assumed: false, pipe: false }
  const al = aligns.get(sha256)
  if (!al || al.specimenId === null || normalizeId(al.specimenId) === '' || al.datumUMm === null || al.direction === null) return null
  const s0 = al.direction * (u0 - al.datumUMm)
  const s1 = al.direction * (u1 - al.datumUMm)
  return {
    frameKey: weldKey(al.specimenId, al.weldId),
    start: Math.min(s0, s1),
    end: Math.max(s0, s1),
    assumed: al.alignmentAssumed,
    pipe: al.outerDiameterMm !== null
  }
}

function depthCenter(top: number | null, bottom: number | null): number | null {
  if (top !== null && bottom !== null) return (top + bottom) / 2
  return top ?? bottom
}

function finiteOrNull(v: number | null | undefined): number | null {
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null
}

/**
 * 기록 → 비교 단위. 인자의 규칙으로 빼거나 참고로 돌린 뒤, unit = 'grouping' 이면 같은 groupingId 를 합친다.
 * 그룹 안에 셈하는 기록이 하나라도 있으면 그룹은 셈한다.
 */
export function prepareMatchItems(records: readonly IndicationRecord[], params: MatchParams): PreparedItems {
  const warnings: string[] = []
  const excluded: ExcludedRecord[] = []
  const aligns = alignmentMap(params.alignments, warnings)
  const singles: { item: MatchItem; groupingId: string | null }[] = []
  const seen = new Set<string>()
  const dup = new Set<string>()
  let assumed = 0
  let pipe = 0
  let peakDepth = 0

  for (const r of records) {
    if (seen.has(r.uuid)) dup.add(r.uuid)
    seen.add(r.uuid)
    if (r.deleted && !params.includeDeleted) {
      excluded.push({ uuid: r.uuid, reason: 'deleted' })
      continue
    }
    if (!params.kinds.includes(r.kind)) {
      excluded.push({ uuid: r.uuid, reason: 'kind' })
      continue
    }
    const reasons: ReferenceReason[] = []
    let drop: ExcludeReason | null = null
    if (r.existenceConfidence === 'uncertain') {
      if (params.uncertain === 'exclude') drop = 'uncertain'
      else if (params.uncertain === 'reference') reasons.push('uncertain')
    }
    if (drop === null && r.signal.exceedsRecordingLevel === false) {
      if (params.belowRecording === 'exclude') drop = 'below-recording'
      else if (params.belowRecording === 'reference') reasons.push('below-recording')
    }
    if (drop !== null) {
      excluded.push({ uuid: r.uuid, reason: drop })
      continue
    }
    const u0 = r.derived.scanStartMm
    const u1 = r.derived.scanEndMm
    if (!Number.isFinite(u0) || !Number.isFinite(u1)) {
      excluded.push({ uuid: r.uuid, reason: 'bad-coords' })
      continue
    }
    const placed = place(r.sha256, u0, u1, params.frame, aligns)
    if (placed === null) {
      excluded.push({ uuid: r.uuid, reason: 'no-alignment' })
      continue
    }
    if (placed.assumed) assumed++
    if (placed.pipe) pipe++
    const t0 = finiteOrNull(r.derived.depthTopMm)
    const t1 = finiteOrNull(r.derived.depthBottomMm)
    const top = t0 !== null && t1 !== null ? Math.min(t0, t1) : t0
    const bottom = t0 !== null && t1 !== null ? Math.max(t0, t1) : t1
    let center = depthCenter(top, bottom)
    let depthSource: DepthSource | null = center !== null ? 'range' : null
    if (center === null) {
      // 깊이 위·아래가 없으면 최대 진폭 깊이로 깊이 조건을 본다 (평가_정의_v1.md 3절)
      const pk = finiteOrNull(r.signal.peak?.depthMm)
      if (pk !== null) {
        center = pk
        depthSource = 'peak'
        peakDepth++
      }
    }
    const extent = placed.end - placed.start
    const measured = finiteOrNull(r.length.valueMm)
    const height = r.height.method === 'unmeasurable' ? null : finiteOrNull(r.height.valueMm)
    const character = r.character.value ?? (r.defectType !== null ? defaultCharacterOf(r.defectType) : null)
    const sp = aligns.get(r.sha256)?.specimenId ?? null
    singles.push({
      groupingId: params.unit === 'grouping' ? r.groupingId : null,
      item: {
        id: r.uuid,
        source: 'record',
        recordUuids: [r.uuid],
        sha256s: [r.sha256],
        frameKey: placed.frameKey,
        side: r.location.side,
        scanStartMm: placed.start,
        scanEndMm: placed.end,
        depthTopMm: top,
        depthBottomMm: bottom,
        depthCenterMm: center,
        depthSource,
        lengthMm: measured ?? (extent > 0 ? extent : null),
        heightMm: height,
        kind: r.kind,
        defectType: r.defectType,
        typeConfidence: r.typeConfidence,
        character,
        counted: reasons.length === 0,
        referenceReasons: reasons,
        physicalDefectKey: r.physicalDefectId !== null && sp !== null && normalizeId(sp) !== '' ? defectKey(sp, r.physicalDefectId) : null,
        truthTier: null,
        alignmentAssumed: placed.assumed
      }
    })
  }
  if (dup.size > 0) {
    warnings.push(`같은 UUID 기록이 둘 이상입니다(${dup.size}개, 병합 충돌일 수 있음). 매칭 전에 충돌을 정리하십시오.`)
  }
  if (assumed > 0) warnings.push(`가설 정렬(기준점·방향 확인 전)로 시편 좌표를 낸 기록이 ${assumed}건 있습니다. 결과에 '가설 정렬'을 함께 적으십시오.`)
  if (pipe > 0) {
    warnings.push(`관(외경 있음) 파일의 기록 ${pipe}건: 원주를 한 바퀴로 감는 처리가 아직 없어(v1) 기준점(12시) 근처 결함은 짝이 안 될 수 있습니다.`)
  }
  if (peakDepth > 0) warnings.push(`깊이 위·아래가 없어 최대 진폭 깊이로 깊이 조건을 본 기록이 ${peakDepth}건 있습니다.`)

  // 그룹 짓기 후 단위: (틀 키, groupingId) 가 같으면 합친다. 처음 나온 순서를 지킨다
  const items: MatchItem[] = []
  const groups = new Map<string, MatchItem[]>()
  const order: (MatchItem | string)[] = []
  for (const s of singles) {
    if (s.groupingId === null) {
      order.push(s.item)
      continue
    }
    const gk = `${s.item.frameKey}\u0000${s.groupingId}`
    const g = groups.get(gk)
    if (g) g.push(s.item)
    else {
      groups.set(gk, [s.item])
      order.push(gk)
    }
  }
  for (const o of order) {
    if (typeof o !== 'string') {
      items.push(o)
      continue
    }
    const members = groups.get(o) ?? []
    const groupingId = o.slice(o.indexOf('\u0000') + 1)
    items.push(members.length === 1 && members[0] ? members[0] : mergeGroup(groupingId, members))
  }
  return { items, excluded, warnings }
}

function allSame<T>(values: readonly (T | null)[]): T | null {
  let v: T | null = null
  for (const x of values) {
    if (x === null) continue
    if (v === null) v = x
    else if (v !== x) return null
  }
  return v
}

/**
 * 그룹 짓기 길이 (시방서 그림 5: l12 = l1 + l2 + dx). grouping.ts groupLengthMm 와 같은 계산을 쓴다:
 * 구성원의 잰 길이(없으면 스캔 범위)를 더하고, 스캔 범위로 잰 구성원 사이 간격을 더한다.
 * 구성원 스캔 범위가 서로 겹치면 간격을 정할 수 없어 합집합 길이를 쓴다. 0 이하면 null(길이 모름).
 */
function groupLength(members: readonly MatchItem[]): number | null {
  const total = groupLengthMm(members.map((m) => ({ scanStartMm: m.scanStartMm, scanEndMm: m.scanEndMm, lengthMm: m.lengthMm })))
  return total > 0 ? total : null
}

/**
 * 그룹 짓기(시방서 그림 5·6) 결과를 한 단위로.
 * 길이 = Σ 잰 길이 + Σ 간격(groupLength). 높이 = 구성원 잰 높이의 최댓값(없으면 null).
 * 시방서 그림 6 의 hg(개별 + 간격)는 팁 깊이가 있어야 해서 v1 은 최댓값으로 둔다(작게 잡힘).
 */
function mergeGroup(groupingId: string, members: readonly MatchItem[]): MatchItem {
  const first = members[0]
  if (!first) throw new Error('빈 그룹')
  const start = Math.min(...members.map((m) => m.scanStartMm))
  const end = Math.max(...members.map((m) => m.scanEndMm))
  const tops = members.map((m) => m.depthTopMm).filter((v): v is number => v !== null)
  const bottoms = members.map((m) => m.depthBottomMm).filter((v): v is number => v !== null)
  const top = tops.length > 0 ? Math.min(...tops) : null
  const bottom = bottoms.length > 0 ? Math.max(...bottoms) : null
  let center = depthCenter(top, bottom)
  let depthSource: DepthSource | null = center !== null ? 'range' : null
  if (center === null) {
    const cs = members.map((m) => m.depthCenterMm).filter((v): v is number => v !== null)
    if (cs.length > 0) {
      center = (Math.min(...cs) + Math.max(...cs)) / 2
      depthSource = 'peak'
    }
  }
  const heights = members.map((m) => m.heightMm).filter((v): v is number => v !== null)
  const sides = members.map((m) => m.side)
  const knownSides = new Set(sides.filter((s): s is WeldSide => s !== null))
  const chars = members.map((m) => m.character)
  const character: JudgmentCharacter | null = chars.includes('planar')
    ? 'planar'
    : chars.includes('volumetric')
      ? 'volumetric'
      : null
  const counted = members.some((m) => m.counted)
  const reasons = counted ? [] : [...new Set(members.flatMap((m) => m.referenceReasons))]
  return {
    id: `group:${groupingId}`,
    source: 'group',
    recordUuids: members.flatMap((m) => m.recordUuids),
    sha256s: [...new Set(members.flatMap((m) => m.sha256s))],
    frameKey: first.frameKey,
    side: knownSides.size === 1 ? ([...knownSides][0] ?? null) : null,
    scanStartMm: start,
    scanEndMm: end,
    depthTopMm: top,
    depthBottomMm: bottom,
    depthCenterMm: center,
    depthSource,
    lengthMm: groupLength(members),
    heightMm: heights.length > 0 ? Math.max(...heights) : null,
    kind: members.some((m) => m.kind === 'defect') ? 'defect' : first.kind,
    defectType: allSame(members.map((m) => m.defectType)),
    typeConfidence: members.some((m) => m.typeConfidence === 'uncertain')
      ? 'uncertain'
      : allSame(members.map((m) => m.typeConfidence)),
    character,
    counted,
    referenceReasons: reasons,
    physicalDefectKey: allSame(members.map((m) => m.physicalDefectKey)),
    truthTier: null,
    alignmentAssumed: members.some((m) => m.alignmentAssumed)
  }
}

/**
 * 물리 결함 설계값 → 비교 단위 (늘 'weld' 틀). 정답 계층 1(인증·설계값)과 비교할 때 쓴다.
 * 위치: 시작·끝이 있으면 그것, 시작(또는 끝)과 길이가 있으면 그것으로, 중심이 있으면 중심 ± 길이/2, 길이도 없으면 중심 한 점.
 * 깊이: DesignValues.depthMm 이 윗끝인지 중심인지 정해지지 않았다(types.ts 주석, 0단계에서 확정).
 *   depthIs 로 알려 주지 않으면 깊이를 모름으로 둔다(unknownDepth 규칙을 따름).
 * 정답 계층: 출처의 계층(codes.ts truthTierOfSource)이 minTier 보다 낮거나 없으면 참고 단위('low-tier')로 둔다.
 *   기본 minTier = 'certified' (평가_정의_v1.md 7절: POD 크기는 계층 1). X3 결함정보처럼 출처가 없는 표는 'any' 로 넘긴다.
 */
export function physicalDefectItems(
  defects: readonly PhysicalDefect[],
  opts: { depthIs?: 'top' | 'center' | 'unknown'; includeDeleted?: boolean; minTier?: TruthTier | 'any' } = {}
): PreparedItems {
  const depthIs = opts.depthIs ?? 'unknown'
  const minTier = opts.minTier ?? 'certified'
  const items: MatchItem[] = []
  const excluded: ExcludedRecord[] = []
  let lowTier = 0
  for (const d of defects) {
    const ref = `${d.specimenId}/${d.id}`
    if (d.deleted && !opts.includeDeleted) {
      excluded.push({ uuid: ref, reason: 'deleted' })
      continue
    }
    const v = d.design
    let start: number | null = null
    let end: number | null = null
    if (v.startMm !== null && v.endMm !== null) {
      start = Math.min(v.startMm, v.endMm)
      end = Math.max(v.startMm, v.endMm)
    } else if (v.startMm !== null && v.lengthMm !== null) {
      start = v.startMm
      end = v.startMm + v.lengthMm
    } else if (v.endMm !== null && v.lengthMm !== null) {
      start = v.endMm - v.lengthMm
      end = v.endMm
    } else if (v.centerMm !== null) {
      const half = v.lengthMm !== null ? v.lengthMm / 2 : 0
      start = v.centerMm - half
      end = v.centerMm + half
    }
    if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) {
      excluded.push({ uuid: ref, reason: 'bad-coords' })
      continue
    }
    let top: number | null = null
    let bottom: number | null = null
    let center: number | null = null
    if (v.depthMm !== null && depthIs === 'top') {
      top = v.depthMm
      bottom = v.heightMm !== null ? v.depthMm + v.heightMm : null
      center = bottom !== null ? (top + bottom) / 2 : null
    } else if (v.depthMm !== null && depthIs === 'center') {
      center = v.depthMm
      top = v.heightMm !== null ? v.depthMm - v.heightMm / 2 : null
      bottom = v.heightMm !== null ? v.depthMm + v.heightMm / 2 : null
    }
    const tier = truthTierOfSource(d.source)
    const counted = minTier === 'any' || (tier !== null && TRUTH_TIER_RANK[tier] >= TRUTH_TIER_RANK[minTier])
    if (!counted) lowTier++
    items.push({
      id: `defect:${ref}`,
      source: 'physical-defect',
      recordUuids: [],
      sha256s: [],
      frameKey: weldKey(d.specimenId, d.weldId),
      side: v.side,
      scanStartMm: start,
      scanEndMm: end,
      depthTopMm: top,
      depthBottomMm: bottom,
      depthCenterMm: center,
      depthSource: center !== null ? 'design' : null,
      lengthMm: v.lengthMm ?? (end > start ? end - start : null),
      heightMm: v.heightMm,
      kind: 'defect',
      defectType: v.type,
      typeConfidence: null,
      character: v.type !== null ? defaultCharacterOf(v.type) : null,
      counted,
      referenceReasons: counted ? [] : ['low-tier'],
      physicalDefectKey: defectKey(d.specimenId, d.id),
      truthTier: tier,
      alignmentAssumed: false
    })
  }
  const warnings: string[] = []
  if (lowTier > 0) {
    warnings.push(`정답 계층이 기준(${minTier})보다 낮거나 없는 물리 결함 ${lowTier}건은 참고 단위로 두었습니다(셈하지 않음).`)
  }
  return { items, excluded, warnings }
}

/** 검토 구간 → 틀 좌표 구간 (삭제 표시·자동 풀림은 뺌). 'weld' 틀에서 정렬이 없는 파일의 구간은 excluded */
export function reviewSpans(
  intervals: readonly ReviewInterval[],
  params: Pick<MatchParams, 'frame' | 'alignments'>
): { spans: FrameSpan[]; excluded: ExcludedRecord[] } {
  const aligns = alignmentMap(params.alignments, [])
  const spans: FrameSpan[] = []
  const excluded: ExcludedRecord[] = []
  for (const iv of intervals) {
    if (iv.deleted) {
      excluded.push({ uuid: iv.uuid, reason: 'deleted' })
      continue
    }
    if (iv.released) {
      excluded.push({ uuid: iv.uuid, reason: 'released' })
      continue
    }
    if (!Number.isFinite(iv.scanStartMm) || !Number.isFinite(iv.scanEndMm)) {
      excluded.push({ uuid: iv.uuid, reason: 'bad-coords' })
      continue
    }
    const placed = place(iv.sha256, iv.scanStartMm, iv.scanEndMm, params.frame, aligns)
    if (placed === null) {
      excluded.push({ uuid: iv.uuid, reason: 'no-alignment' })
      continue
    }
    spans.push({
      frameKey: placed.frameKey,
      startMm: placed.start,
      endMm: placed.end,
      kind: iv.kind,
      groupId: iv.groupId,
      uuid: iv.uuid,
      sha256: iv.sha256
    })
  }
  return { spans, excluded }
}

/** 검토 완료 구간만 골라 Span 으로 (그룹은 나누지 않고 합친다) */
export function reviewedCoverage(spans: readonly FrameSpan[]): Span[] {
  return mergeSpans(spans.filter((s) => s.kind === 'reviewed'))
}

// ───────────────────────────── 조건 · 비용 ─────────────────────────────

/** 후보 쌍 하나의 계산값 */
export interface PairGeometry {
  scanGapMm: number
  scanOverlapMm: number
  /** b 중심 − a 중심 (mm) */
  scanCenterDiffMm: number
  /** b − a (mm). 하나라도 모르면 null */
  depthCenterDiffMm: number | null
  /** 두 쪽 측을 다 알아 비교했는지 */
  sideChecked: boolean
  /** 두 쪽 깊이를 다 알아 비교했는지 */
  depthChecked: boolean
  /** 0 ~ 2. 작을수록 가깝다 */
  cost: number
}

/** 두 단위가 같은 지시 조건을 만족하면 계산값, 아니면 null */
export function compareItems(a: MatchItem, b: MatchItem, params: MatchParams): PairGeometry | null {
  if (a.frameKey !== b.frameKey) return null
  const sideChecked = a.side !== null && b.side !== null
  if (sideChecked ? a.side !== b.side : params.unknownSide === 'fail') return null
  const { overlapMm, gapMm } = intervalGap(a.scanStartMm, a.scanEndMm, b.scanStartMm, b.scanEndMm)
  if (gapMm > params.scanGapMm + MATCH_EPS_MM) return null
  const depthChecked = a.depthCenterMm !== null && b.depthCenterMm !== null
  let depthDiff: number | null = null
  if (a.depthCenterMm !== null && b.depthCenterMm !== null) {
    depthDiff = b.depthCenterMm - a.depthCenterMm
    if (Math.abs(depthDiff) > params.depthDiffMm + MATCH_EPS_MM) return null
  } else if (params.unknownDepth === 'fail') return null
  const centerDiff = (b.scanStartMm + b.scanEndMm) / 2 - (a.scanStartMm + a.scanEndMm) / 2
  const reach = params.scanGapMm + (a.scanEndMm - a.scanStartMm) / 2 + (b.scanEndMm - b.scanStartMm) / 2
  const scanTerm = reach > 0 ? Math.min(1, Math.abs(centerDiff) / reach) : 0
  const depthTerm =
    depthDiff === null ? 1 : params.depthDiffMm > 0 ? Math.min(1, Math.abs(depthDiff) / params.depthDiffMm) : 0
  return {
    scanGapMm: gapMm,
    scanOverlapMm: overlapMm,
    scanCenterDiffMm: centerDiff,
    depthCenterDiffMm: depthDiff,
    sideChecked,
    depthChecked,
    cost: scanTerm + depthTerm
  }
}

// ───────────────────────────── 짝짓기 ─────────────────────────────

export interface MatchPair extends PairGeometry {
  a: MatchItem
  b: MatchItem
  /** 두 쪽 모두 셈하는 단위 (1차에서 짝지음) */
  counted: boolean
}

export interface UnmatchedItem {
  item: MatchItem
  /** 조건을 만족하는 상대가 있었지만 1:1 경쟁에서 짝을 잃음 */
  hadCandidate: boolean
  /** 상대 쪽 참고 구역(기준 미만 지시·품질 불량)에 걸침. 여럿이면 기준 미만 지시가 먼저 */
  zone: ReviewIntervalKind | null
  /** 검토 범위 밖 (범위를 줬을 때만 참일 수 있음). 오검출·미검출에서 빼고 따로 센다 */
  outsideCoverage: boolean
}

export interface MatchResult {
  rulesVersion: number
  params: MatchParams
  pairs: MatchPair[]
  onlyA: UnmatchedItem[]
  onlyB: UnmatchedItem[]
  excludedA: ExcludedRecord[]
  excludedB: ExcludedRecord[]
  warnings: string[]
}

export interface MatchZones {
  /** A 쪽 검토 구간 (B 의 짝 없는 단위에 붙음) */
  a?: readonly FrameSpan[]
  /** B 쪽 검토 구간 (A 의 짝 없는 단위에 붙음) */
  b?: readonly FrameSpan[]
  /** 평가 범위 (검토 완료 구간). 주면 범위 밖 짝 없는 단위에 outsideCoverage 를 붙인다 */
  coverage?: readonly Span[]
}

interface Candidate {
  i: number
  j: number
  g: PairGeometry
}

function byCost(a: readonly MatchItem[], b: readonly MatchItem[]) {
  return (x: Candidate, y: Candidate): number => {
    if (x.g.cost !== y.g.cost) return x.g.cost - y.g.cost
    const ai = a[x.i]?.id ?? ''
    const aj = a[y.i]?.id ?? ''
    if (ai !== aj) return ai < aj ? -1 : 1
    const bi = b[x.j]?.id ?? ''
    const bj = b[y.j]?.id ?? ''
    if (bi !== bj) return bi < bj ? -1 : 1
    return x.i - y.i || x.j - y.j
  }
}

function zoneOf(item: MatchItem, zones: readonly FrameSpan[] | undefined, params: MatchParams): ReviewIntervalKind | null {
  if (!zones) return null
  let found: ReviewIntervalKind | null = null
  for (const z of zones) {
    if (z.frameKey !== item.frameKey || !params.zoneKinds.includes(z.kind)) continue
    const { gapMm } = intervalGap(item.scanStartMm, item.scanEndMm, z.startMm, z.endMm)
    if (gapMm > params.scanGapMm + MATCH_EPS_MM) continue
    if (z.kind === 'below-threshold') return z.kind
    found = z.kind
  }
  return found
}

/** 'weld:시편|용접부' → [시편, 용접부]. weld 틀이 아니면 null */
function splitWeldKey(k: string): [string, string] | null {
  if (!k.startsWith('weld:')) return null
  const body = k.slice(5)
  const bar = body.lastIndexOf('|')
  return bar < 0 ? null : [body.slice(0, bar), body.slice(bar + 1)]
}

/**
 * 한쪽만 용접부 ID 가 비었을 때 맞추기: 'weld:S|' 이고 상대에 'weld:S|' 가 없으며 상대에 시편 S 의 용접부가 하나뿐이면
 * 그 키로 바꾼다. 바꾼 키 목록을 돌려준다.
 */
function remapEmptyWeld(own: readonly MatchItem[], other: ReadonlySet<string>): Map<string, string> {
  const remap = new Map<string, string>()
  for (const k of new Set(own.map((x) => x.frameKey))) {
    const sw = splitWeldKey(k)
    if (!sw || sw[1] !== '' || other.has(k)) continue
    const cands = [...other].filter((o) => splitWeldKey(o)?.[0] === sw[0])
    if (cands.length === 1 && cands[0]) remap.set(k, cands[0])
  }
  return remap
}

function listKeys(keys: readonly string[]): string {
  const shown = keys.slice(0, 5).map((k) => k.replace(/^weld:/, '').replace(/^file:(.{12}).*$/, '파일 $1…'))
  return keys.length > 5 ? `${shown.join(', ')} 외 ${keys.length - 5}개` : shown.join(', ')
}

/** 이미 만든 비교 단위끼리 짝짓는다 (물리 결함 표와 비교할 때 등) */
export function matchItems(
  aIn: readonly MatchItem[],
  bIn: readonly MatchItem[],
  params: MatchParams,
  zones: MatchZones = {}
): Omit<MatchResult, 'excludedA' | 'excludedB'> {
  checkParams(params)
  const warnings: string[] = []
  const kinds = (xs: readonly MatchItem[]) => new Set(xs.map((x) => x.frameKey.slice(0, x.frameKey.indexOf(':'))))
  const ka = kinds(aIn)
  const kb = kinds(bIn)
  if (aIn.length > 0 && bIn.length > 0 && ![...ka].some((k) => kb.has(k))) {
    warnings.push('두 쪽의 좌표 틀이 다릅니다(파일 / 용접부). 하나도 짝지어지지 않습니다.')
  }

  // 한쪽만 용접부 ID 가 빈 키를 상대의 하나뿐인 용접부로 맞춘다
  const keysA0 = new Set(aIn.map((x) => x.frameKey))
  const keysB0 = new Set(bIn.map((x) => x.frameKey))
  const remapA = remapEmptyWeld(aIn, keysB0)
  const remapB = remapEmptyWeld(bIn, keysA0)
  for (const [from, to] of [...remapA, ...remapB]) {
    warnings.push(`용접부 ID 가 한쪽만 비어 있어 하나뿐인 용접부로 보고 맞췄습니다: ${from.replace(/^weld:/, '')} → ${to.replace(/^weld:/, '')}`)
  }
  const apply = (xs: readonly MatchItem[], m: Map<string, string>): MatchItem[] =>
    m.size === 0 ? [...xs] : xs.map((x) => (m.has(x.frameKey) ? { ...x, frameKey: m.get(x.frameKey)! } : x))
  const a = apply(aIn, remapA)
  const b = apply(bIn, remapB)

  // 한쪽에만 있는 틀 키 (용접부 ID·시편 ID 가 서로 다르게 적힌 경우를 잡는다)
  const keysA = new Set(a.map((x) => x.frameKey))
  const keysB = new Set(b.map((x) => x.frameKey))
  const common = [...keysA].filter((k) => keysB.has(k))
  if (a.length > 0 && b.length > 0 && common.length === 0 && [...ka].some((k) => kb.has(k))) {
    warnings.push('두 쪽에 같은 좌표 틀 키(같은 파일 또는 같은 시편·용접부)가 하나도 없습니다. 짝이 0개이니 이 결과를 쓰지 마십시오(ID 확인).')
  }
  if (b.length > 0) {
    const onlyKeysA = [...keysA].filter((k) => !keysB.has(k) && k.startsWith('weld:'))
    if (onlyKeysA.length > 0) warnings.push(`정답(A) 쪽에만 있는 용접부: ${listKeys(onlyKeysA)} — 이 용접부의 정답은 모두 미검출로 셉니다. ID 를 확인하십시오.`)
  }
  if (a.length > 0) {
    const onlyKeysB = [...keysB].filter((k) => !keysA.has(k) && k.startsWith('weld:'))
    if (onlyKeysB.length > 0) warnings.push(`예측(B) 쪽에만 있는 용접부: ${listKeys(onlyKeysB)} — 이 용접부의 예측은 모두 오검출로 셉니다. ID 를 확인하십시오.`)
  }
  if (params.coverage !== 'none' && zones.coverage === undefined) {
    warnings.push('검토 범위(검토 완료 구간)를 주지 않아, 검토하지 않은 구간의 짝 없는 예측도 오검출로 셉니다.')
  }

  // 같은 틀 키끼리만 후보를 만든다
  const byKey = new Map<string, number[]>()
  b.forEach((it, j) => {
    const l = byKey.get(it.frameKey)
    if (l) l.push(j)
    else byKey.set(it.frameKey, [j])
  })
  const candidates: Candidate[] = []
  a.forEach((ai, i) => {
    for (const j of byKey.get(ai.frameKey) ?? []) {
      const bj = b[j]
      if (!bj) continue
      const g = compareItems(ai, bj, params)
      if (g) candidates.push({ i, j, g })
    }
  })
  candidates.sort(byCost(a, b))

  const takenA = new Map<number, MatchPair>()
  const takenB = new Set<number>()
  const pairs: MatchPair[] = []
  const take = (c: Candidate): void => {
    const ai = a[c.i]
    const bj = b[c.j]
    if (!ai || !bj || takenA.has(c.i) || takenB.has(c.j)) return
    const pair: MatchPair = { a: ai, b: bj, counted: ai.counted && bj.counted, ...c.g }
    takenA.set(c.i, pair)
    takenB.add(c.j)
    pairs.push(pair)
  }
  // 1차: 셈하는 단위끼리
  for (const c of candidates) if (a[c.i]?.counted && b[c.j]?.counted) take(c)
  // 2차: 남은 것과 참고 단위
  for (const c of candidates) if (!(a[c.i]?.counted && b[c.j]?.counted)) take(c)

  const outside = (item: MatchItem): boolean =>
    zones.coverage !== undefined && !touchesCoverage(item.frameKey, item.scanStartMm, item.scanEndMm, zones.coverage)
  const hasCandA = new Set(candidates.map((c) => c.i))
  const hasCandB = new Set(candidates.map((c) => c.j))
  const onlyA: UnmatchedItem[] = []
  a.forEach((item, i) => {
    if (!takenA.has(i)) onlyA.push({ item, hadCandidate: hasCandA.has(i), zone: zoneOf(item, zones.b, params), outsideCoverage: outside(item) })
  })
  const onlyB: UnmatchedItem[] = []
  b.forEach((item, j) => {
    if (!takenB.has(j)) onlyB.push({ item, hadCandidate: hasCandB.has(j), zone: zoneOf(item, zones.a, params), outsideCoverage: outside(item) })
  })
  return { rulesVersion: MATCH_RULES_VERSION, params, pairs, onlyA, onlyB, warnings }
}

/**
 * 지시 기록 두 목록을 짝짓는다. a = 정답 쪽(또는 라벨러 A), b = 예측 쪽(또는 라벨러 B).
 * intervals 를 주면 검토 구간 중 params.zoneKinds 를 참고 구역으로, 검토 완료 구간을 params.coverage 규칙의
 * 평가 범위로 쓴다('truth' = A 의 검토 완료, 'both' = A·B 검토 완료의 교집합).
 */
export function matchIndications(
  a: readonly IndicationRecord[],
  b: readonly IndicationRecord[],
  params: MatchParams,
  intervals: { a?: readonly ReviewInterval[]; b?: readonly ReviewInterval[] } = {}
): MatchResult {
  checkParams(params)
  const pa = prepareMatchItems(a, params)
  const pb = prepareMatchItems(b, params)
  const zones: MatchZones = {}
  if (intervals.a) zones.a = reviewSpans(intervals.a, params).spans
  if (intervals.b) zones.b = reviewSpans(intervals.b, params).spans
  // 검토 완료 구간이 하나도 없으면 범위를 모르는 것으로 본다(빈 범위 = '아무것도 안 봄'으로 보지 않음) — 확인 사항이 붙는다
  const covA = zones.a ? reviewedCoverage(zones.a) : []
  const covB = zones.b ? reviewedCoverage(zones.b) : []
  if (params.coverage === 'truth' && covA.length > 0) zones.coverage = covA
  if (params.coverage === 'both' && covA.length > 0 && covB.length > 0) zones.coverage = intersectCoverage(covA, covB)
  const r = matchItems(pa.items, pb.items, params, zones)
  const warnings = [
    ...pa.warnings.map((w) => `A: ${w}`),
    ...pb.warnings.map((w) => `B: ${w}`),
    ...r.warnings
  ]
  return { ...r, excludedA: pa.excluded, excludedB: pb.excluded, warnings }
}
