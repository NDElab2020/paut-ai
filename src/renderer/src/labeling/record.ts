/**
 * 초안 + 속성 양식 → 지시 기록 (IndicationRecord) — 순수 (React·DOM 없음, tests/labeling 에서 직접 검사).
 * 규격_초안.md 1.3·4절, 지침서_v1.md 6절. 저장은 패널이 labels:saveRecord 로 한다.
 *
 * 흐름 (전문가가 앱에서 지시 하나를 기록):
 *   ① 단면 — 최대 진폭 장면의 S-scan 에 점을 찍는다. 높이 입력 방식에 따라 필요한 점(HEIGHT_ROLES)이 정해진다:
 *      상하 팁 · 노정 시간 = 위·아래 두 점, 팁 + 표면 = 팁·표면, −6 dB = −6 dB 위·아래, 측정 불가 = 없음(사각형이나 최대 진폭 점 하나로 위치만).
 *      사각형(에코 범위)은 결함 기록에서 필수(지침서 6.4 — 평가 기준을 넘는 에코의 위·아래·좌우): V·실제 깊이 범위(파생 위치)가 사각형이 된다.
 *      echoRangeRect 가 최대 진폭 칸에서 평가 기준 이상으로 이어진 칸 덩어리로 미리 채울 수 있다(전문가가 확인·고침).
 *      레그 경계를 넘는 사각형은 최대 진폭 점의 레그 안으로 자르고, 부채꼴 밖 모서리는 안으로 당긴다(convert.ts rectAnchors).
 *   ② 길이 — 기준 커서 R(시작)과 현재 커서(끝)로 잰 구간을 '길이 시작·끝' 점으로 둔다(lengthPointsFor).
 *      그 점의 앵커 빔·샘플은 단면의 기준점(같은 그룹 최대 진폭 점 → 첫 단면 점 → 그 칸 게이트 최대)과 같게 둔다:
 *      파생 위치(derivedFromPoints)가 '모든 점'으로 V·깊이를 낼 때 길이 점이 단면 밖 V 를 끌어오지 않게. 잰 빔은 measuredBeam → length.beam.
 *      저장 직전(buildRecord)에 지금 단면 기준점으로 다시 맞춘다 — 길이를 정한 뒤 최대 진폭 점을 옮겨도 옛 위치가 남지 않게.
 *   ③ 앱 제안 — 전문가가 길이를 정한 뒤에만 비교값으로 보이고(2인 독립 모드면 숨김), 보인 제안만 제안 기록(SuggestionRecord)으로 남긴다.
 *   ④ 속성 — 종류·판정 특성·표면/점·위치·좌우·확신도 둘·설계값 봤음·메모, 형상 에코/형상 불완전 세부.
 * 파생 위치는 shared/labels derivedFromPoints (좌표 규칙이 바뀌어 다시 계산할 때와 같은 규칙).
 * 신호는 찍은 점 한 픽셀이 아니라 단면 둘레(점·사각형의 빔 ± 2 · 깊이 ± 1.5 mm, 길이 구간 또는 단면 칸 ± 2)의 원값 최대(regionPeakOf, 파일 이득 0 dB)와
 * levels.ts amplitudeLevels(Ref 대비 dB·평가/기록 기준 초과, 대조 전이라 refDbVerified = false). 찍은 최대 진폭 점이 둘레 최대보다 6 dB 넘게 낮으면 경고.
 */
import {
  POST_RULES_VERSION,
  beamLabel,
  beamPoint,
  cscanBeamAxis,
  foldDepth,
  groupPostOf,
  rawToPercent,
  sampleTimeUs,
  sanitizePostProcess,
  scanPositionMm,
  soundPathMm,
  sscanLookupAt,
  sscanLookupBeamSample,
  type PostProcess,
  type ViewerFileInfo,
  type ViewerGroup
} from '@shared/imaging'
import {
  GEOMETRIC_IMPERFECTION_ISO,
  LABEL_COORD_RULES_VERSION,
  METALLURGICAL_TYPE_INFO,
  amplitudeLevels,
  anchorToPoint,
  anchorVersionChanged,
  defaultCharacterOf,
  derivedFromPoints,
  isVolumetricType,
  needsRecheck,
  newIndicationRecord,
  recomputeFromAnchors,
  unfoldDepth,
  validateIndicationRecord,
  type AnchorPoint,
  type AnchorRole,
  type Confidence,
  type GeometricEchoKind,
  type GeometricImperfectionKind,
  type GroupLevels,
  type HeightMeasure,
  type HeightMethod,
  type IndicationRecord,
  type JudgmentCharacter,
  type LabelSetKey,
  type LengthMeasure,
  type LengthMethod,
  type LengthSuggestion,
  type MetallurgicalType,
  type ReadingStage,
  type RecordKind,
  type SignalInfo,
  type SuggestionRecord,
  type SurfaceClass,
  type WeldSide,
  type WeldZone
} from '@shared/labels'
import { num } from '../lib/format'
import { sha256Hex } from '../lib/sha256'
import { rectAnchors, toAnchorPoint } from './convert'
import { regionPeakReading, type PointReading } from './reading'
import { maxPointNumber, type LabelDraft, type LabelDraftPoint, type LabelDraftRect, type LabelRefCursor, type NewDraftPoint } from './state'

// ───────────────────────────── 속성 양식 ─────────────────────────────

export interface RecordForm {
  kind: RecordKind
  defectType: MetallurgicalType | null
  typeConfidence: Confidence | null
  /** null = 아직 고르지 않음 (지침서: 필수 — 기본값을 미리 채우지 않는다) */
  existenceConfidence: Confidence | null
  /** null = 결함 종류 기본값 (균열·융합불량·용입불량 = 면상, 기공·슬래그 = 체적) */
  character: JudgmentCharacter | null
  /** 일렬 체적 → 면상 (시방서 15절) */
  alignedVolumetric: boolean
  surface: SurfaceClass | null
  pointLike: boolean | null
  zone: WeldZone | null
  side: WeldSide | null
  noBevelOverlay: boolean
  echoKind: GeometricEchoKind
  /** null = 아직 고르지 않음 (지침서: 형상 불완전 세부는 꼭 고른다) */
  imperfectionKind: GeometricImperfectionKind | null
  designValueSeen: boolean
  specimenKnown: boolean | null
  aiDevParticipant: boolean | null
  heightMethod: HeightMethod
  /** null = 두께로 (t ≥ 8 평가 기준 초과 구간, t < 8 6 dB 강하 + 곡률 보정) */
  lengthMethod: LengthMethod | null
  /** 길이 측정법 '기타'의 문턱 (%FSH — 띠 위 지시의 '바탕 + 6 dB' 등, 지침서 6.2(나)). 다른 측정법이면 쓰지 않음 */
  lengthThresholdPct: number | null
  /** 관 외경 (mm, 6 dB 강하 + 곡률 보정에 씀). 판은 null */
  outerDiameterMm: number | null
  physicalDefectId: string
  note: string
}

export function defaultForm(stage: ReadingStage = 'blind'): RecordForm {
  return {
    kind: 'defect',
    defectType: null,
    typeConfidence: null,
    existenceConfidence: null,
    character: null,
    alignedVolumetric: false,
    surface: null,
    pointLike: null,
    zone: null,
    side: null,
    noBevelOverlay: false,
    echoKind: 'other',
    imperfectionKind: null,
    designValueSeen: stage !== 'blind',
    specimenKnown: null,
    aiDevParticipant: null,
    heightMethod: 'tip-tip',
    lengthMethod: null,
    lengthThresholdPct: null,
    outerDiameterMm: null,
    physicalDefectId: '',
    note: ''
  }
}

/** 저장 뒤 다음 기록 양식: 습관 칸(높이 방식·길이 측정법과 그 문턱·외경·설계값 봤음)만 남긴다. 존재 확신도·형상 불완전 세부는 이어받지 않는다 */
export function nextForm(prev: RecordForm, stage: ReadingStage): RecordForm {
  return {
    ...defaultForm(stage),
    heightMethod: prev.heightMethod,
    lengthMethod: prev.lengthMethod,
    lengthThresholdPct: prev.lengthThresholdPct,
    outerDiameterMm: prev.outerDiameterMm,
    designValueSeen: stage !== 'blind' || prev.designValueSeen
  }
}

export function formFromRecord(r: IndicationRecord): RecordForm {
  const def = r.defectType ? defaultCharacterOf(r.defectType) : null
  return {
    kind: r.kind,
    defectType: r.defectType,
    typeConfidence: r.typeConfidence,
    existenceConfidence: r.existenceConfidence,
    character: r.character.value !== null && r.character.value !== def ? r.character.value : null,
    alignedVolumetric: r.character.alignedVolumetric,
    surface: r.surface,
    pointLike: r.pointLike,
    zone: r.location.zone,
    side: r.location.side,
    noBevelOverlay: r.location.noBevelOverlay,
    echoKind: r.geometricEcho?.kind ?? 'other',
    imperfectionKind: r.geometricImperfection?.kind ?? null,
    designValueSeen: r.knowledge.designValueSeen === true || r.readingStage !== 'blind',
    specimenKnown: r.knowledge.specimenKnown,
    aiDevParticipant: r.knowledge.aiDevParticipant,
    heightMethod: r.height.method ?? 'unmeasurable',
    lengthMethod: r.length.method,
    lengthThresholdPct: r.length.method === 'other' ? r.length.thresholdPct : null,
    outerDiameterMm: null,
    physicalDefectId: r.physicalDefectId ?? '',
    note: r.note
  }
}

// ───────────────────────────── 단면 점 ─────────────────────────────

/** 높이 입력 방식마다 찍을 점 (지침서 6.3절 표) */
export const HEIGHT_ROLES: Readonly<Record<HeightMethod, readonly AnchorRole[]>> = {
  'tip-tip': ['tip-top', 'tip-bottom'],
  'tip-surface': ['tip', 'surface'],
  'transit-time': ['tip-top', 'tip-bottom'],
  '6db': ['drop-top', 'drop-bottom'],
  unmeasurable: []
}

/** 높이 방식에 따른 점 이름 (노정 시간은 팁이 아니라 반사·모드 변환 신호의 위·아래 끝) */
export function roleName(role: AnchorRole, method: HeightMethod): string {
  if (method === 'transit-time' && role === 'tip-top') return '위 끝 (노정)'
  if (method === 'transit-time' && role === 'tip-bottom') return '아래 끝 (노정)'
  return ROLE_NAME[role]
}

export const ROLE_NAME: Readonly<Record<AnchorRole, string>> = {
  peak: '최대 진폭',
  'tip-top': '위 팁',
  'tip-bottom': '아래 팁',
  tip: '팁',
  surface: '표면',
  'drop-top': '−6 dB 위',
  'drop-bottom': '−6 dB 아래',
  'length-start': '길이 시작',
  'length-end': '길이 끝',
  'rect-a': '사각형 1',
  'rect-b': '사각형 2',
  other: '기타 점'
}

const LENGTH_ROLES: ReadonlySet<AnchorRole> = new Set<AnchorRole>(['length-start', 'length-end'])

/** 단면 점 (길이 점 빼고) */
export function sectionPoints(draft: Pick<LabelDraft, 'points'>): LabelDraftPoint[] {
  return draft.points.filter((p) => !LENGTH_ROLES.has(p.role))
}

/** 단면 체크 목록 한 칸: 점 역할 또는 사각형 */
export interface SectionItem {
  id: AnchorRole | 'rect'
  name: string
  done: boolean
  /** 꼭 있어야 저장할 수 있나 */
  required: boolean
}

/**
 * 단면 체크 목록: 최대 진폭(권장) → 높이 방식의 점들(필수) → 에코 범위 사각형(결함이면 필수 — 지침서 6.4, 아니면 선택).
 * 결함이 아닌 기록(형상 에코·형상 불완전)은 높이 점이 필요 없다.
 */
export function sectionChecklist(form: Pick<RecordForm, 'kind' | 'heightMethod'>, draft: Pick<LabelDraft, 'points' | 'rect'>): SectionItem[] {
  const has = (r: AnchorRole): boolean => draft.points.some((p) => p.role === r)
  const method = form.kind === 'defect' ? form.heightMethod : 'unmeasurable'
  const items: SectionItem[] = [{ id: 'peak', name: ROLE_NAME.peak, done: has('peak'), required: false }]
  for (const r of HEIGHT_ROLES[method]) items.push({ id: r, name: roleName(r, method), done: has(r), required: true })
  items.push({ id: 'rect', name: '에코 범위 (사각형)', done: draft.rect !== null, required: form.kind === 'defect' })
  return items
}

/** 처음 찍을 점 역할: 목록 순서(최대 진폭 → 높이 점)에서 아직 안 찍은 첫 점 (초안을 비운 뒤) */
export function firstRole(items: readonly SectionItem[]): AnchorRole | null {
  const it = items.find((i) => i.id !== 'rect' && !i.done)
  return it ? (it.id as AnchorRole) : null
}

/** 다음에 찍을 점 역할 (체크 목록에서 아직 안 찍은 필수 점 → 그 밖의 점, 없으면 null) */
export function nextRole(items: readonly SectionItem[]): AnchorRole | null {
  const it = items.find((i) => i.id !== 'rect' && !i.done && i.required) ?? items.find((i) => i.id !== 'rect' && !i.done)
  return it ? (it.id as AnchorRole) : null
}

// ───────────────────────────── 길이 (기준 커서 R → 현재 커서) ─────────────────────────────

/** 그 칸·빔의 게이트 최대 샘플 (없으면 null) — 패널이 볼륨의 C-scan 으로 넘긴다 */
export type GatePeakSample = (groupId: number, scanIndex: number, beam: number) => number | null

type GroupGeom = Pick<ViewerGroup, 'id' | 'beams' | 'ultrasound' | 'scan' | 'verified'>

/** 길이 점의 앵커 기준점: 같은 그룹의 최대 진폭 점 → 첫 단면 점 → R 칸·빔의 게이트 최대 */
export function lengthReference(
  group: GroupGeom,
  draft: Pick<LabelDraft, 'points'>,
  ref: LabelRefCursor,
  thicknessMm: number | null,
  gatePeak: GatePeakSample
): Pick<LabelDraftPoint, 'vMm' | 'unfoldedDepthMm' | 'beam' | 'sample'> | null {
  const sec = sectionPoints(draft).filter((p) => p.groupId === group.id)
  const p = sec.find((x) => x.role === 'peak') ?? sec[0]
  if (p) return { vMm: p.vMm, unfoldedDepthMm: p.unfoldedDepthMm, beam: p.beam, sample: p.sample }
  const k = Math.min(group.scan.count - 1, Math.max(0, Math.round((ref.scanMm - group.scan.offsetMm) / group.scan.resolutionMm)))
  const s = gatePeak(group.id, k, ref.beam)
  if (s === null || s < 0) return null
  const pos = anchorToPoint(group, { scanIndex: k, beam: ref.beam, sample: s }, thicknessMm)
  return pos ? { vMm: pos.vMm, unfoldedDepthMm: pos.unfoldedDepthMm, beam: ref.beam, sample: s } : null
}

/**
 * R(시작)·현재 커서(끝) → 길이 시작·끝 점 두 개 (스캔 순서로 시작 ≤ 끝). 기준점을 못 정하면 null.
 * endScanIndex = R 그룹 축에서 현재 커서 칸.
 */
export function lengthPointsFor(
  group: GroupGeom,
  draft: Pick<LabelDraft, 'points'>,
  ref: LabelRefCursor,
  endScanIndex: number,
  thicknessMm: number | null,
  gatePeak: GatePeakSample,
  displayGainDb: number
): [NewDraftPoint, NewDraftPoint] | null {
  const base = lengthReference(group, draft, ref, thicknessMm, gatePeak)
  if (!base) return null
  const kR = Math.min(group.scan.count - 1, Math.max(0, Math.round((ref.scanMm - group.scan.offsetMm) / group.scan.resolutionMm)))
  const kE = Math.min(group.scan.count - 1, Math.max(0, endScanIndex))
  const [k0, k1] = kR <= kE ? [kR, kE] : [kE, kR]
  const mk = (role: 'length-start' | 'length-end', k: number): NewDraftPoint => ({
    role,
    groupId: group.id,
    scanIndex: k,
    scanMm: scanPositionMm(k, group.scan),
    ...base,
    displayGainDb,
    measuredBeam: ref.beam
  })
  return [mk('length-start', k0), mk('length-end', k1)]
}

/** 초안의 길이 (시작·끝 점이 둘 다 있을 때) */
export interface DraftLength {
  groupId: number
  startMm: number
  endMm: number
  /** 잰 빔 (C-scan 한 행) */
  beam: number
  lengthMm: number
}

export function draftLength(draft: Pick<LabelDraft, 'points'>): DraftLength | null {
  const a = draft.points.find((p) => p.role === 'length-start')
  const b = draft.points.find((p) => p.role === 'length-end')
  if (!a || !b) return null
  const s = Math.min(a.scanMm, b.scanMm)
  const e = Math.max(a.scanMm, b.scanMm)
  return { groupId: a.groupId, startMm: s, endMm: e, beam: a.measuredBeam ?? Math.round(a.beam), lengthMm: e - s }
}

/** 두께로 정한 길이 측정법 (시방서 15절) */
export function lengthMethodFor(thicknessMm: number | null, chosen: LengthMethod | null): LengthMethod {
  if (chosen) return chosen
  return thicknessMm !== null && thicknessMm < 8 ? '6db-curvature' : 'eval-level'
}

function r3(x: number): number {
  return Math.round(x * 1000) / 1000
}
function r4(x: number): number {
  return Math.round(x * 1e4) / 1e4
}

/**
 * 길이 칸: 값 = 끝 − 시작. 6 dB 강하 + 곡률 보정이면 l_c = l_s × (OD − 2d) / OD (외경을 모르면 보정하지 않고 l_s).
 * 문턱: 평가 기준 방식 = 평가 기준 %FSH, 6 dB 강하 = 최대 진폭 − 6 dB, 기타 = 전문가가 적은 문턱(otherThresholdPct — 띠 위 '바탕 + 6 dB' 등).
 */
export function lengthMeasureOf(
  len: DraftLength,
  method: LengthMethod,
  group: Pick<ViewerGroup, 'beams'> | null,
  levels: GroupLevels | null,
  peakPct: number | null,
  peakDepthMm: number | null,
  outerDiameterMm: number | null,
  otherThresholdPct: number | null = null
): LengthMeasure {
  const ls = len.lengthMm
  let value = ls
  let uncorrected: number | null = null
  if (method === '6db-curvature') {
    uncorrected = r4(ls)
    if (outerDiameterMm !== null && outerDiameterMm > 0 && peakDepthMm !== null) value = (ls * (outerDiameterMm - 2 * peakDepthMm)) / outerDiameterMm
  }
  const threshold =
    method === 'eval-level'
      ? (levels?.evaluationPct ?? null)
      : method === '6db-curvature' && peakPct !== null
        ? peakPct * 10 ** (-6 / 20)
        : method === 'other' && otherThresholdPct !== null && otherThresholdPct > 0
          ? otherThresholdPct
          : null
  return {
    valueMm: r4(value),
    method,
    uncorrectedMm: uncorrected,
    groupId: len.groupId,
    beam: len.beam,
    angleDeg: group?.beams[len.beam]?.angleDeg ?? null,
    thresholdPct: threshold === null ? null : r3(threshold)
  }
}

// ───────────────────────────── 높이 ─────────────────────────────

export interface HeightResult {
  height: HeightMeasure
  /** 저장을 막는 문제 (점이 모자람·위아래가 뒤집힘) */
  problem: string | null
  /** 저장은 되지만 볼 것 (레그 경계를 넘음·경계에 붙임) */
  warning: string | null
}

/** 레그 경계(실제 깊이 0 또는 t)에서 이만큼 안이면 경계값으로 붙인다 (mm) */
export const LEG_SNAP_MM = 0.3

/**
 * 높이 = 점의 실제 깊이 차 (지침서 6.3절):
 *   상하 팁 · 노정 시간: 아래 − 위, 팁 + 표면: |팁 − 표면| (표면 점은 가까운 면 0 또는 t 로 붙인다 — 루트 연결 = t − 위 팁, 윗면 연결 = 아래 팁),
 *   −6 dB: 아래 끝 − 위 끝 (참고값), 측정 불가: 값 없음.
 * 위·아래 두 점: 아래 점의 실제 깊이가 위 점보다 얕으면 막는다 (짝수 레그는 화면 위아래가 반대 — 역할을 거꾸로 찍은 것).
 *   두 점의 레그가 다르면: 한쪽이 경계 ± LEG_SNAP_MM 안이면 경계값으로 붙이고, 아니면 경고 (레그 경계를 넘은 두 반사 — 바닥에 이어지면 팁 + 표면).
 */
export function heightOf(method: HeightMethod, anchors: readonly AnchorPoint[], thicknessMm: number | null): HeightResult {
  const find = (...roles: AnchorRole[]): AnchorPoint | undefined => {
    for (let i = anchors.length - 1; i >= 0; i--) if (roles.includes(anchors[i]!.role) && anchors[i]!.mm) return anchors[i]
    return undefined
  }
  const none: HeightMeasure = { method, valueMm: null, pointIds: [] }
  if (method === 'unmeasurable') return { height: none, problem: null, warning: null }
  if (method === 'tip-surface') {
    const tip = find('tip', 'tip-top', 'tip-bottom')
    const s = find('surface')
    if (!tip || !s) return { height: none, problem: "팁 + 표면 높이에는 '팁'·'표면' 점이 있어야 합니다.", warning: null }
    const sd = thicknessMm !== null && thicknessMm > 0 ? (s.mm!.depthMm < thicknessMm / 2 ? 0 : thicknessMm) : s.mm!.depthMm
    return { height: { method, valueMm: r3(Math.abs(tip.mm!.depthMm - sd)), pointIds: [tip.id, s.id] }, problem: null, warning: null }
  }
  const [ra, rb] = method === '6db' ? (['drop-top', 'drop-bottom'] as const) : (['tip-top', 'tip-bottom'] as const)
  const a = find(ra)
  const b = find(rb)
  const what = method === '6db' ? "'−6 dB 위'·'−6 dB 아래'" : method === 'transit-time' ? "'위 끝'·'아래 끝'" : "'위 팁'·'아래 팁'"
  if (!a || !b) return { height: none, problem: `높이에는 ${what} 점이 있어야 합니다.`, warning: null }
  let da = a.mm!.depthMm
  let db = b.mm!.depthMm
  let warning: string | null = null
  const t = thicknessMm !== null && thicknessMm > 0 ? thicknessMm : null
  if (t !== null && a.leg !== null && b.leg !== null && a.leg !== b.leg) {
    const snap = (d: number): number | null => (d <= LEG_SNAP_MM ? 0 : d >= t - LEG_SNAP_MM ? t : null)
    const sa = snap(da)
    const sb = snap(db)
    if (sa !== null || sb !== null) {
      if (sa !== null) da = sa
      if (sb !== null) db = sb
      warning = `두 점이 레그 경계 양쪽(L${a.leg}·L${b.leg})에 있어 경계 ± ${LEG_SNAP_MM} mm 안의 점을 면(${sa ?? sb} mm)으로 붙였습니다.`
    } else {
      warning = `두 점이 서로 다른 레그(L${a.leg}·L${b.leg})에 있습니다 — 레그 경계를 넘은 두 반사입니다. 바닥(루트)이나 윗면에 이어진 지시면 '팁 + 표면'을 고르세요.`
    }
  }
  const height: HeightMeasure = { method, valueMm: r3(Math.abs(db - da)), pointIds: [a.id, b.id] }
  if (db < da - 1e-6) {
    return {
      height,
      problem: `아래 점(실제 깊이 ${r1(db)} mm)이 위 점(${r1(da)} mm)보다 얕습니다. 짝수 레그는 화면 위아래가 반대입니다 — 두 점의 역할을 바꿔 찍으세요.`,
      warning
    }
  }
  return { height, problem: null, warning }
}

function r1(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1)
}

// ───────────────────────────── 신호 ─────────────────────────────

/**
 * 신호 칸 (파일 이득 0 dB): 최대 진폭 %FSH·포화·최대 위치 + Ref 대비 dB·평가/기록 기준 초과(levels.ts, 대조 전 → refDbVerified = false).
 * reading 이 없으면 비운다.
 */
export function signalOf(reading: PointReading | null, group: Pick<ViewerGroup, 'beams'> | null, levels: GroupLevels | null, lengthMm: number | null, thicknessMm: number | null): SignalInfo {
  const empty: SignalInfo = {
    maxAmplitudePct: null,
    refDb: null,
    refDbVerified: false,
    saturated: null,
    exceedsEvaluationLevel: null,
    exceedsRecordingLevel: null,
    peak: null
  }
  if (!reading || reading.amplitudePct === null) return empty
  const lv = amplitudeLevels({ maxAmplitudePct: reading.amplitudePct, refPct: levels?.refPct ?? null, lengthMm, thicknessMm, saturated: reading.saturated })
  return {
    maxAmplitudePct: r3(reading.amplitudePct),
    refDb: lv.refDb === null ? null : r3(lv.refDb),
    refDbVerified: false,
    saturated: reading.saturated,
    exceedsEvaluationLevel: lv.exceedsEvaluationLevel,
    exceedsRecordingLevel: lv.exceedsRecordingLevel,
    peak: {
      groupId: reading.groupId,
      beam: reading.nearestBeam,
      angleDeg: group?.beams[reading.nearestBeam]?.angleDeg ?? r3(reading.angleDeg),
      scanMm: r4(reading.scanMm),
      depthMm: r4(reading.depthMm)
    }
  }
}

// ───────────────────────────── 신호 영역 (단면 둘레 최대) ─────────────────────────────

/** 그룹 하나의 기하·볼륨 (볼륨을 아직 읽지 않았으면 volume = null) */
export type VolumeSource = (groupId: number) => { group: ViewerGroup; volume: { amplitude: Int16Array; status: Uint8Array | null } | null } | null

export interface RegionPeak {
  /** 둘레 최대 칸의 읽기값 (없으면 null) */
  reading: PointReading | null
  /** 그 그룹 진폭을 아직 읽지 않음 */
  volumeMissing: boolean
  groupId: number | null
}

/** 신호를 찾는 둘레: 빔 ± REGION_BEAMS, 펼친 깊이 ± REGION_DEPTH_MM, 단면 스캔 칸 ± REGION_SCANS (길이가 있으면 그 구간) */
export const REGION_BEAMS = 2
export const REGION_DEPTH_MM = 1.5
export const REGION_SCANS = 2

/**
 * 기록 신호의 최대 진폭 (파일 이득 0 dB): 최대 진폭 점(없으면 첫 단면 점·사각형)의 그룹에서
 * 단면 점·사각형 모서리의 빔 ± 2 · 펼친 깊이 ± 1.5 mm, 같은 그룹 길이 구간(없으면 단면 스캔 칸 ± 2) 안의 원값 최대 칸.
 * 찍은 점 한 픽셀(보간값)을 쓰면 0.5 mm 만 비켜도 평가 기준을 못 넘는 기록이 되어 학습·평가에서 빠진다 (검토 지적).
 */
export function regionPeakOf(draft: Pick<LabelDraft, 'points' | 'rect'>, source: VolumeSource, thicknessMm: number | null): RegionPeak {
  const sec = sectionPoints(draft)
  const pk = sec.find((p) => p.role === 'peak')
  const gid = pk?.groupId ?? sec[0]?.groupId ?? draft.rect?.groupId ?? null
  if (gid === null) return { reading: null, volumeMissing: false, groupId: null }
  const src = source(gid)
  if (!src) return { reading: null, volumeMissing: false, groupId: gid }
  if (!src.volume) return { reading: null, volumeMissing: true, groupId: gid }
  const g = src.group
  const pts = sec.filter((p) => p.groupId === gid)
  const beams = pts.map((p) => p.beam)
  const depths = pts.map((p) => p.unfoldedDepthMm)
  const scans = pts.map((p) => p.scanIndex)
  const rc = draft.rect && draft.rect.groupId === gid ? draft.rect : null
  if (rc) {
    depths.push(rc.depthMinMm, rc.depthMaxMm)
    scans.push(rc.scanIndex)
    for (const [v, d] of [
      [rc.vMinMm, rc.depthMinMm],
      [rc.vMinMm, rc.depthMaxMm],
      [rc.vMaxMm, rc.depthMinMm],
      [rc.vMaxMm, rc.depthMaxMm],
      [(rc.vMinMm + rc.vMaxMm) / 2, (rc.depthMinMm + rc.depthMaxMm) / 2]
    ] as const) {
      const l = sscanLookupAt(g, v, d)
      if (l) beams.push(sscanLookupBeamSample(l).beam)
    }
  }
  if (depths.length === 0 || scans.length === 0) return { reading: null, volumeMissing: false, groupId: gid }
  const nb = g.shape[1]
  const b0 = beams.length ? Math.floor(Math.min(...beams)) - REGION_BEAMS : 0
  const b1 = beams.length ? Math.ceil(Math.max(...beams)) + REGION_BEAMS : nb - 1
  const lenPts = draft.points.filter((p) => (p.role === 'length-start' || p.role === 'length-end') && p.groupId === gid)
  const [k0, k1] =
    lenPts.length === 2
      ? [Math.min(...lenPts.map((p) => p.scanIndex)), Math.max(...lenPts.map((p) => p.scanIndex))]
      : [Math.min(...scans) - REGION_SCANS, Math.max(...scans) + REGION_SCANS]
  const reading = regionPeakReading(
    g,
    src.volume,
    { k0, k1, b0, b1, d0: Math.min(...depths) - REGION_DEPTH_MM, d1: Math.max(...depths) + REGION_DEPTH_MM },
    thicknessMm
  )
  return { reading, volumeMissing: false, groupId: gid }
}

/**
 * 에코 범위 자동 (지침서 6.4): 그 스캔 칸 S-scan 에서 seed(최대 진폭 점) 칸과 8-이웃으로 이어지며 문턱(평가 기준 %FSH) 이상인 칸 덩어리
 * (같은 레그만)의 V·펼친 깊이 범위(칸 중심). seed 가 문턱 미만이면 ± 1 빔·± 3 샘플에서 가장 센 칸에서 시작한다.
 * 전문가가 확인·고치는 초안이다 (사각형 도구로 다시 그릴 수 있음).
 */
export function echoRangeRect(
  group: ViewerGroup,
  volume: { amplitude: Int16Array; status: Uint8Array | null },
  scanIndex: number,
  seed: { beam: number; sample: number },
  thresholdPct: number,
  thicknessMm: number | null,
  displayGainDb: number
): { rect: LabelDraftRect | null; reason: string | null; cells: number } {
  const [ns, nb, nt] = group.shape
  const k = scanIndex
  if (k < 0 || k >= ns) return { rect: null, reason: '스캔 칸이 범위 밖입니다.', cells: 0 }
  const ok = (b: number): boolean => b >= 0 && b < nb && (!volume.status || (volume.status[k * nb + b]! & 1) === 1)
  const pct = (b: number, s: number): number => rawToPercent(volume.amplitude[(k * nb + b) * nt + s]!, group.ampScale)
  let sb = Math.min(nb - 1, Math.max(0, Math.round(seed.beam)))
  let ss = Math.min(nt - 1, Math.max(0, Math.round(seed.sample)))
  if (!ok(sb) || pct(sb, ss) < thresholdPct) {
    let best = -Infinity
    for (let b = sb - 1; b <= sb + 1; b++) {
      if (!ok(b)) continue
      for (let s = Math.max(0, ss - 3); s <= Math.min(nt - 1, ss + 3); s++) {
        const v = pct(b, s)
        if (v > best) {
          best = v
          sb = b
          ss = s
        }
      }
    }
    if (!(best >= thresholdPct)) return { rect: null, reason: `최대 진폭 칸이 평가 기준(${r1(thresholdPct)} %) 미만이라 에코 범위를 정할 수 없습니다.`, cells: 0 }
  }
  const pos = (b: number, s: number): { vMm: number; depthMm: number } => {
    const bm = group.beams[b]!
    return beamPoint(bm, soundPathMm(bm, sampleTimeUs(bm, s, group.ultrasound)))
  }
  const legOf = (d: number): number | null => foldDepth(d, thicknessMm).leg
  const seedLeg = legOf(pos(sb, ss).depthMm)
  const seen = new Uint8Array(nb * nt)
  const stack: number[] = [sb * nt + ss]
  seen[sb * nt + ss] = 1
  let vMin = Infinity
  let vMax = -Infinity
  let dMin = Infinity
  let dMax = -Infinity
  let cells = 0
  const MAX_CELLS = 200_000
  while (stack.length && cells < MAX_CELLS) {
    const c = stack.pop()!
    const b = Math.floor(c / nt)
    const s = c - b * nt
    const p = pos(b, s)
    if (seedLeg !== null && legOf(p.depthMm) !== seedLeg) continue
    cells++
    if (p.vMm < vMin) vMin = p.vMm
    if (p.vMm > vMax) vMax = p.vMm
    if (p.depthMm < dMin) dMin = p.depthMm
    if (p.depthMm > dMax) dMax = p.depthMm
    for (let db = -1; db <= 1; db++) {
      const b2 = b + db
      if (!ok(b2)) continue
      for (let ds = -1; ds <= 1; ds++) {
        const s2 = s + ds
        if ((db === 0 && ds === 0) || s2 < 0 || s2 >= nt) continue
        const c2 = b2 * nt + s2
        if (seen[c2]) continue
        seen[c2] = 1
        if (pct(b2, s2) >= thresholdPct) stack.push(c2)
      }
    }
  }
  if (cells === 0) return { rect: null, reason: '평가 기준 이상 칸을 찾지 못했습니다.', cells: 0 }
  return {
    rect: {
      groupId: group.id,
      scanIndex: k,
      scanMm: scanPositionMm(k, group.scan),
      vMinMm: r4(vMin),
      vMaxMm: r4(vMax),
      depthMinMm: r4(dMin),
      depthMaxMm: r4(dMax),
      displayGainDb
    },
    reason: null,
    cells
  }
}

// ───────────────────────────── 제안 기록 ─────────────────────────────

const SAME_MM = 1e-6

/**
 * 보여 준 길이 제안 + 전문가 최종 길이 → 제안 기록 (길이·시작·끝). 제안 불가였으면 길이 한 줄(suggestedMm = null).
 * 보여 주지 않은 제안(2인 독립 모드·전문가가 재기 전)은 남기지 않는다 — 같은 규칙 버전이면 나중에 같은 값으로 다시 계산된다.
 * finalLengthMm = 기록 length.valueMm (곡률 보정 뒤) — '길이' 줄은 제안 lengthMm(같은 측정법·외경으로 보정)과 같은 기준으로 비교한다.
 */
export function suggestionRecords(shown: LengthSuggestion | null, final: DraftLength | null, finalLengthMm: number | null = null): SuggestionRecord[] {
  if (!shown || !final) return []
  const base = { rule: shown.rule, ruleDb: r3(shown.ruleDb), shownAfterExpert: true }
  const finalLen = finalLengthMm ?? final.lengthMm
  if (!shown.available || shown.lengthMm === null || shown.scanStartMm === null || shown.scanEndMm === null) {
    return [{ ...base, target: 'length', suggestedMm: null, finalMm: r4(finalLen), acceptedUnchanged: false, correctionMm: null }]
  }
  const one = (target: SuggestionRecord['target'], s: number, f: number): SuggestionRecord => {
    const corr = r4(f - s)
    return { ...base, target, suggestedMm: r4(s), finalMm: r4(f), acceptedUnchanged: Math.abs(f - s) < SAME_MM, correctionMm: Math.abs(corr) < SAME_MM ? 0 : corr }
  }
  return [one('length', shown.lengthMm, finalLen), one('length-start', shown.scanStartMm, final.startMm), one('length-end', shown.scanEndMm, final.endMm)]
}

/** 제안을 그대로 받았는지 (시작·끝이 같음) */
export function acceptedSuggestion(shown: LengthSuggestion | null, final: DraftLength | null): boolean {
  if (!shown?.available || !final || shown.scanStartMm === null || shown.scanEndMm === null) return false
  return Math.abs(shown.scanStartMm - final.startMm) < 1e-3 && Math.abs(shown.scanEndMm - final.endMm) < 1e-3
}

// ───────────────────────────── 화면 스냅샷 ─────────────────────────────

/** 기록에 남기는 화면 (이득·게이트·색표·커서) — 불투명 JSON, 지시 표에서 이 화면으로 돌아간다 */
export interface ViewSnapshot {
  format: 'paut-label-view'
  version: 1
  rulesVersion: number
  cursor: { groupId: number; scanMm: number; beam: number }
  palette: { minPct: number; maxPct: number }
  groups: Record<string, { gainDb: number; cscanGateId: number | null; gates: Record<string, unknown> }>
  /**
   * 구조를 따라 읽은 형식(OPD)만: 찍을 때의 읽기 규칙·진폭 눈금·스큐 270 V 부호 추정 여부. 8단계에서 눈금·부호가 바뀌면
   * 이 칸으로 그때 값으로 계산한 기록을 골라 다시 계산하거나 재확인을 붙인다. NDE 기록에는 없다(스냅샷 바이트 그대로)
   */
  formatSource?: SnapshotFormatSource
  /**
   * 찍을 때 불러온 OmniPC 색표(.pal, 조정 → 색표 → 색표 파일)가 있었을 때만: 이름과 256색의 SHA-256(DEFAULT 색표 해시와 같은 규칙 —
   * 'rrggbb' 256개를 ',' 로 이은 글자). 색만 바뀌고 진폭·기록 값은 그대로라 기록 스키마는 바꾸지 않는 불투명 칸이다(2026-10-07 기본값 (나)).
   * 색표를 불러오지 않은 기록에는 없다(스냅샷 바이트 그대로). 색 자체는 담지 않아 '그때 화면으로'는 색표를 되살리지 않는다
   */
  paletteFile?: { name: string; sha256: string }
}

/** 불러온 색표 256색의 SHA-256 (학습 내보내기 manifest 의 색표 해시와 같은 규칙 — 'rrggbb' 를 ',' 로 이음) */
export function paletteSha256(palette: readonly string[]): string {
  return sha256Hex(palette.join(','))
}

/** 스냅샷의 형식 출처 (OPD) */
export interface SnapshotFormatSource {
  formatFamily: string
  reader: { name: string; version: number } | null
  ampScale: { rawMax: number; unitMax: number; estimated: boolean }
  /** 스큐 270 그룹이 있어 V 를 출사점 부호 추정으로 계산했는가 */
  vSignEstimated: boolean
}

/** 파일 정보 → 스냅샷 형식 출처 (구조 읽기 형식이 아니면 null — NDE 는 스냅샷에 칸을 만들지 않는다) */
export function snapshotFormatSourceOf(info: Pick<ViewerFileInfo, 'formatFamily' | 'reader' | 'groups'>): SnapshotFormatSource | null {
  if (!info.reader) return null
  const g = info.groups.find((x) => x.supported) ?? info.groups[0]
  if (!g) return null
  return {
    formatFamily: info.formatFamily,
    reader: { name: info.reader.name, version: info.reader.version },
    ampScale: { rawMax: g.ampScale.rawMax, unitMax: g.ampScale.unitMax, estimated: !!g.ampScale.estimated },
    vSignEstimated: info.groups.some((x) => x.beams.some((b) => Math.round(b.skewDeg) % 360 === 270))
  }
}

export function snapshotOf(post: PostProcess, groupIds: readonly number[], cursor: ViewSnapshot['cursor'], formatSource: SnapshotFormatSource | null = null): ViewSnapshot {
  const groups: ViewSnapshot['groups'] = {}
  for (const id of groupIds) {
    const g = groupPostOf(post, id)
    groups[String(id)] = { gainDb: g.gainDb, cscanGateId: g.cscanGateId, gates: JSON.parse(JSON.stringify(g.gates)) as Record<string, unknown> }
  }
  const snap: ViewSnapshot = { format: 'paut-label-view', version: 1, rulesVersion: POST_RULES_VERSION, cursor: { ...cursor }, palette: { ...post.palette }, groups }
  if (formatSource) snap.formatSource = formatSource
  if (post.paletteFile) snap.paletteFile = { name: post.paletteFile.name, sha256: paletteSha256(post.paletteFile.palette) }
  return snap
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 스냅샷의 커서 (없거나 형식이 다르면 null) */
export function snapshotCursor(snap: unknown): ViewSnapshot['cursor'] | null {
  if (!isObj(snap) || snap['format'] !== 'paut-label-view' || !isObj(snap['cursor'])) return null
  const c = snap['cursor']
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  return ok(c['groupId']) && ok(c['scanMm']) && ok(c['beam']) ? { groupId: c['groupId'], scanMm: c['scanMm'], beam: c['beam'] } : null
}

/**
 * 지금 후처리에 스냅샷의 이득·게이트·색표를 덮은 것 (범위·확대는 지금 그대로). 형식이 다르면 null.
 * 좌표 규칙이 바뀐 스냅샷도 sanitizePostProcess 가 버리는 규칙을 따른다.
 */
export function postWithSnapshot(current: PostProcess, snap: unknown, groups: ReadonlyArray<Pick<ViewerGroup, 'id' | 'gates' | 'ampScale'>>): PostProcess | null {
  if (!isObj(snap) || snap['format'] !== 'paut-label-view' || snap['rulesVersion'] !== POST_RULES_VERSION) return null
  const raw: Record<string, unknown> = JSON.parse(JSON.stringify(current)) as Record<string, unknown>
  if (isObj(snap['palette'])) raw['palette'] = snap['palette']
  const gs = isObj(raw['groups']) ? (raw['groups'] as Record<string, unknown>) : {}
  const sg = isObj(snap['groups']) ? snap['groups'] : {}
  for (const g of groups) {
    const s = sg[String(g.id)]
    if (!isObj(s)) continue
    const cur = isObj(gs[String(g.id)]) ? (gs[String(g.id)] as Record<string, unknown>) : {}
    gs[String(g.id)] = { ...cur, gainDb: s['gainDb'], cscanGateId: s['cscanGateId'], gates: s['gates'] }
  }
  raw['groups'] = gs
  return sanitizePostProcess(raw, { fileSha256: current.fileSha256, groups }).post
}

// ───────────────────────────── 기록 만들기 ─────────────────────────────

export interface BuildRecordInput {
  key: LabelSetKey
  /** 새 기록의 UUID (고칠 때는 base.uuid 를 쓴다) */
  uuid: string
  /** 고치는 기록 (없으면 새 기록) */
  base: IndicationRecord | null
  draft: LabelDraft
  form: RecordForm
  groups: ReadonlyMap<number, ViewerGroup>
  thicknessMm: number | null
  /** 신호 칸에 쓸 최대 진폭 읽기값 — 단면 둘레 최대(regionPeakOf). 없으면 신호 비움(고치기면 고치기 전 신호를 둠) */
  peak: PointReading | null
  /** 전문가가 찍은 최대 진폭 점의 읽기값 (둘레 최대보다 6 dB 넘게 낮으면 경고) */
  clicked?: PointReading | null
  /** 신호 그룹의 진폭을 읽었나 (false = 아직 읽는 중 — 새 결함 기록은 저장을 막는다). 기본 true */
  volumeReady?: boolean
  /** 위치 계산만 (길이 제안 계산용 — 속성·사각형 필수·높이 문제를 보지 않는다) */
  positionOnly?: boolean
  levelsOf: (groupId: number) => GroupLevels | null
  /** 보여 준 길이 제안 (2인 독립 모드·전문가가 재기 전이면 null) */
  shownSuggestion: LengthSuggestion | null
  viewSnapshot: unknown
  /** 라벨러 자격 (새 기록의 판독 출처 세부) */
  qualification?: string | null
}

export interface BuildRecordResult {
  /** 저장할 기록 (문제가 있으면 null) */
  record: IndicationRecord | null
  /** 저장을 막는 문제 (한국어) */
  problems: string[]
  /** 저장은 되지만 볼 것 */
  warnings: string[]
}

/** 단면 점 가운데 신호 칸에 쓸 점: 최대 진폭 점 → 읽기값이 가장 센 점 */
export function peakPointOf(draft: Pick<LabelDraft, 'points'>, readingOf: (p: LabelDraftPoint) => PointReading | null): { point: LabelDraftPoint; reading: PointReading; fromPeak: boolean } | null {
  const sec = sectionPoints(draft)
  const pk = sec.find((p) => p.role === 'peak')
  if (pk) {
    const r = readingOf(pk)
    if (r) return { point: pk, reading: r, fromPeak: true }
  }
  let best: { point: LabelDraftPoint; reading: PointReading; fromPeak: boolean } | null = null
  for (const p of sec) {
    const r = readingOf(p)
    if (r?.amplitudePct == null) continue
    if (!best || r.amplitudePct > (best.reading.amplitudePct ?? -Infinity)) best = { point: p, reading: r, fromPeak: false }
  }
  return best
}

/** 단면 점들이 같은 스캔 칸(최대 진폭 장면)에 있는지 — 그룹마다 */
export function sectionScanMismatch(draft: Pick<LabelDraft, 'points' | 'rect'>): boolean {
  const byGroup = new Map<number, Set<number>>()
  const add = (g: number, k: number): void => {
    const s = byGroup.get(g) ?? new Set<number>()
    s.add(k)
    byGroup.set(g, s)
  }
  for (const p of sectionPoints(draft)) add(p.groupId, p.scanIndex)
  if (draft.rect) add(draft.rect.groupId, draft.rect.scanIndex)
  return [...byGroup.values()].some((s) => s.size > 1)
}

/** 길이 시작·끝 점의 앵커·V·깊이를 지금 단면 기준점(같은 그룹 최대 진폭 점 → 첫 단면 점)으로 다시 맞춘다 — 없으면 그대로 */
export function realignLengthPoints(points: readonly LabelDraftPoint[]): LabelDraftPoint[] {
  const sec = points.filter((p) => !LENGTH_ROLES.has(p.role))
  return points.map((p) => {
    if (!LENGTH_ROLES.has(p.role)) return p
    const same = sec.filter((q) => q.groupId === p.groupId)
    const r = same.find((q) => q.role === 'peak') ?? same[0]
    if (!r) return p
    if (r.vMm === p.vMm && r.unfoldedDepthMm === p.unfoldedDepthMm && r.beam === p.beam && r.sample === p.sample) return p
    return { ...p, vMm: r.vMm, unfoldedDepthMm: r.unfoldedDepthMm, beam: r.beam, sample: r.sample }
  })
}

/** dB 차 (a 가 b 보다 몇 dB 센가). 값이 없거나 0 이하면 null */
function dbOver(a: number | null | undefined, b: number | null | undefined): number | null {
  return a != null && b != null && a > 0 && b > 0 ? 20 * Math.log10(a / b) : null
}

/**
 * 초안 + 양식 → 기록. 고칠 때는 base 의 키·버전·모르는 칸을 그대로 두고 관리하는 칸만 바꾼다(versions 그대로 → 그사이 바뀌었으면 저장이 CONFLICT).
 * 엑셀에서 온 기록(앵커 없음)은 새 점을 찍지 않으면 위치·길이·신호를 그대로 두고 속성만 고친다.
 * 점을 찍어 앵커 기록으로 바꿀 때 다시 재지 않은 엑셀 길이·높이는 그대로 두고 알린다.
 */
export function buildRecord(x: BuildRecordInput): BuildRecordResult {
  const problems: string[] = []
  const warnings: string[] = []
  const { form, base, thicknessMm: t } = x
  const strict = x.positionOnly !== true
  // 길이 점은 저장 직전 지금 단면 기준점으로 (길이를 정한 뒤 최대 진폭 점을 옮겨도 옛 V·깊이가 남지 않게)
  const draft: LabelDraft = { ...x.draft, points: realignLengthPoints(x.draft.points) }
  const groupOf = (id: number): ViewerGroup | null => x.groups.get(id) ?? null

  // 앵커 점 (단면·길이 점 + 사각형 모서리)
  const anchors: AnchorPoint[] = []
  for (const p of draft.points) {
    const g = groupOf(p.groupId)
    anchors.push(toAnchorPoint(p, { verified: g?.verified ?? false }, t))
  }
  const sec = sectionPoints(draft)
  if (draft.rect) {
    const g = groupOf(draft.rect.groupId)
    if (g) {
      const n = maxPointNumber(draft.points)
      const pk = sec.find((p) => p.role === 'peak' && p.groupId === draft.rect!.groupId) ?? sec.find((p) => p.groupId === draft.rect!.groupId)
      const preferLeg = pk ? foldDepth(pk.unfoldedDepthMm, t).leg : null
      const ra = rectAnchors(draft.rect, g, t, [`p${n + 1}`, `p${n + 2}`], LABEL_COORD_RULES_VERSION, preferLeg)
      if (ra.clippedToLeg !== null) warnings.push(`에코 범위 사각형이 레그 경계를 넘어 레그 ${ra.clippedToLeg} 안으로 잘랐습니다 (레그마다 실제 깊이가 접힘).`)
      if (ra.points.length < 2) warnings.push('사각형 모서리가 부채꼴 밖이라 그 모서리는 기록하지 않았습니다.')
      else if (ra.shrunk) warnings.push('사각형 모서리가 부채꼴 밖이라 부채꼴 안으로 당겨 기록했습니다.')
      anchors.push(...ra.points)
    }
  }
  const keepImported = base !== null && base.coordSource === 'imported-mm' && anchors.length === 0
  const fromImported = base !== null && base.coordSource === 'imported-mm' && !keepImported
  if (!keepImported) {
    if (anchors.length === 0) problems.push('S-scan 에 단면 점을 찍으세요 (최대 진폭 점·팁 또는 에코 범위 사각형).')
    else if (sec.length === 0 && !draft.rect) problems.push('단면 점이 없습니다. 최대 진폭 장면의 S-scan 에 점이나 사각형을 찍으세요.')
    if (strict && form.kind === 'defect' && !draft.rect) {
      problems.push("결함 기록은 에코 범위(사각형)가 있어야 합니다 (지침서 6.4 — 평가 기준을 넘는 에코의 위·아래·좌우). '에코 범위 자동'을 누르거나 사각형 도구(2)로 그리세요.")
    }
  }
  if (sectionScanMismatch(draft)) warnings.push('단면 점이 서로 다른 스캔 위치에 있습니다. 높이는 최대 진폭 스캔 위치에서 잽니다.')
  const legs = new Set(sec.map((p) => foldDepth(p.unfoldedDepthMm, t).leg).filter((l): l is number => l !== null))
  if (legs.size > 1) warnings.push(`단면 점이 서로 다른 레그(${[...legs].sort().map((l) => `L${l}`).join('·')})에 있습니다. 한 반사(같은 레그)에서 찍었는지 확인하세요.`)

  const derived = keepImported ? base!.derived : (derivedFromPoints(anchors, LABEL_COORD_RULES_VERSION) ?? null)

  // 길이
  const len = draftLength(draft)
  const peakGroup = x.peak ? groupOf(x.peak.groupId) : null
  let length: LengthMeasure
  if (len) {
    const lg = groupOf(len.groupId)
    const method = lengthMethodFor(t, form.lengthMethod)
    length = lengthMeasureOf(len, method, lg, x.levelsOf(len.groupId), x.peak?.amplitudePct ?? null, x.peak?.depthMm ?? null, form.outerDiameterMm, form.lengthThresholdPct)
    if (method === '6db-curvature' && x.peak?.saturated) warnings.push('최대 진폭이 포화라 6 dB 강하 길이를 정할 수 없습니다 (지침서 6.2). 측정법을 확인하세요.')
    if (method === 'other' && length.thresholdPct === null && strict) warnings.push("길이 측정법 '기타'의 문턱(%FSH)을 적으세요 — 나중에 같은 값으로 다시 잴 수 있게 (지침서 6.2(나)).")
  } else if (keepImported) {
    length = base!.length
  } else if (fromImported && base!.length.valueMm !== null) {
    length = base!.length
    warnings.push(`엑셀 길이 ${base!.length.valueMm} mm 를 그대로 둡니다 (앱에서 다시 재지 않음).`)
  } else {
    length = { valueMm: null, method: null, uncorrectedMm: null, groupId: null, beam: null, angleDeg: null, thresholdPct: null }
    if (form.kind === 'defect' && strict) warnings.push('길이를 재지 않았습니다 (기준 커서 R → 현재 커서 → \'이 길이로\').')
  }

  // 높이 (결함만)
  let height: HeightMeasure
  if (form.kind !== 'defect') height = { method: null, valueMm: null, pointIds: [] }
  else if (keepImported) height = { method: form.heightMethod, valueMm: form.heightMethod === base!.height.method ? base!.height.valueMm : null, pointIds: [] }
  else {
    const h = heightOf(form.heightMethod, anchors, t)
    if (h.problem && fromImported && base!.height.method === form.heightMethod && base!.height.valueMm !== null && h.height.pointIds.length === 0) {
      height = { method: form.heightMethod, valueMm: base!.height.valueMm, pointIds: [] }
      warnings.push(`엑셀 높이 ${base!.height.valueMm} mm 를 그대로 둡니다 (팁을 다시 찍지 않음).`)
    } else {
      if (h.problem && strict) problems.push(h.problem)
      if (h.warning) warnings.push(h.warning)
      height = h.height
    }
    if (form.heightMethod === '6db' && x.peak?.saturated) warnings.push('최대 진폭이 포화라 −6 dB 높이는 쓸 수 없습니다. 측정 불가를 고르세요 (지침서 6.3).')
  }

  // 신호 (단면 둘레 최대, 파일 이득 0 dB)
  const peakOk = x.peak !== null && x.peak.amplitudePct !== null
  let signal: SignalInfo
  if (peakOk) signal = signalOf(x.peak, peakGroup, x.levelsOf(x.peak!.groupId), length.valueMm, t)
  else if (keepImported) signal = base!.signal
  else if (base && base.signal.maxAmplitudePct !== null) {
    signal = base.signal
    warnings.push('진폭을 읽지 못해 신호 칸은 고치기 전 값을 그대로 둡니다 (그룹 진폭을 읽는 중일 수 있음).')
  } else {
    signal = signalOf(null, null, null, null, t)
    if (form.kind === 'defect' && strict) {
      if (x.volumeReady === false) problems.push('그룹 진폭을 아직 읽는 중입니다 — 다 읽은 뒤 저장하세요 (최대 진폭·신호 칸이 비지 않게).')
      else warnings.push('최대 진폭을 읽지 못해 신호 칸을 비웠습니다 (단면 둘레가 데이터 없음 칸).')
    }
  }
  const lowClick = peakOk ? dbOver(x.peak!.amplitudePct, x.clicked?.amplitudePct) : null
  if (lowClick !== null && lowClick > 6) {
    warnings.push(
      `찍은 최대 진폭 점(${r1(x.clicked!.amplitudePct!)} %)이 단면 둘레 최대(${r1(x.peak!.amplitudePct!)} %)보다 ${lowClick.toFixed(1)} dB 낮습니다 — 신호 칸은 둘레 최대로 둡니다. 최대 진폭 칸에 다시 찍거나 N 을 쓰세요.`
    )
  }
  if (form.kind === 'defect' && strict && signal.exceedsEvaluationLevel === false) {
    warnings.push("최대 진폭이 평가 기준 미만입니다 — 결함 기록보다 검토 구간 '기준 미만 지시'로 적습니다 (지침서 5.2).")
  }

  // 제안 기록
  const suggestions = x.shownSuggestion ? suggestionRecords(x.shownSuggestion, len, length.valueMm) : base && len && sameLength(base.length, length) ? base.suggestions : []

  // 속성
  const isDefect = form.kind === 'defect'
  if (strict && form.existenceConfidence === null && form.kind !== 'geometric-echo') problems.push('존재 확신도를 고르세요 (확실 · 보통 · 불확실 — 지침서 필수 칸).')
  if (strict && form.kind === 'geometric-imperfection' && form.imperfectionKind === null) problems.push('형상 불완전 세부(단차·과다 용입·루트 오목·언더컷)를 고르세요.')
  const type = isDefect ? form.defectType : null
  const aligned = isDefect && type !== null && isVolumetricType(type) && form.alignedVolumetric
  const charValue: JudgmentCharacter | null = !isDefect ? null : aligned ? 'planar' : (form.character ?? (type ? defaultCharacterOf(type) : null))
  const imperfection = form.imperfectionKind ?? 'misalignment'
  const isoCode = form.kind === 'defect' ? (type ? METALLURGICAL_TYPE_INFO[type].iso : null) : form.kind === 'geometric-imperfection' ? GEOMETRIC_IMPERFECTION_ISO[imperfection] : null
  const designSeen = x.key.readingStage !== 'blind' ? true : form.designValueSeen

  const managed: Partial<IndicationRecord> = {
    kind: form.kind,
    coordSource: keepImported ? 'imported-mm' : 'app-anchor',
    anchors: keepImported ? [] : anchors,
    derived: derived ?? base?.derived ?? { scanStartMm: 0, scanEndMm: 0, vMinMm: null, vMaxMm: null, depthTopMm: null, depthBottomMm: null, coordRulesVersion: LABEL_COORD_RULES_VERSION },
    recheckNeeded: keepImported ? base!.recheckNeeded : false,
    existenceConfidence: form.existenceConfidence ?? 'certain',
    defectType: type,
    isoCode,
    typeConfidence: isDefect ? form.typeConfidence : null,
    character: { value: charValue, alignedVolumetric: aligned, expertConfirmed: aligned },
    surface: isDefect ? form.surface : null,
    pointLike: isDefect ? form.pointLike : null,
    location: { zone: form.zone, side: form.side, noBevelOverlay: form.noBevelOverlay },
    length,
    height,
    signal,
    suggestions,
    knowledge: { designValueSeen: designSeen, specimenKnown: form.specimenKnown, aiDevParticipant: form.aiDevParticipant },
    physicalDefectId: form.physicalDefectId.trim() === '' ? null : form.physicalDefectId.trim(),
    viewSnapshot: x.viewSnapshot,
    geometricEcho: form.kind === 'geometric-echo' ? { kind: form.echoKind, fromSuggestion: base?.geometricEcho?.fromSuggestion ?? false } : null,
    geometricImperfection: form.kind === 'geometric-imperfection' ? { kind: imperfection } : null,
    note: form.note.trim()
  }
  const record: IndicationRecord = base
    ? { ...base, ...managed }
    : newIndicationRecord({
        uuid: x.uuid,
        sha256: x.key.sha256,
        labelerId: x.key.labelerId,
        guidelineVersion: x.key.guidelineVersion,
        readingStage: x.key.readingStage,
        readerSource: 'expert',
        readerDetail: { qualification: x.qualification ?? null },
        ...managed
      })
  if (problems.length) return { record: null, problems, warnings }
  const v = validateIndicationRecord(record)
  if (!v.ok) return { record: null, problems: v.errors, warnings: [...warnings, ...v.warnings] }
  // 결함 종류 빈 칸 등은 검사(validate) 문구 그대로
  return { record, problems: [], warnings: [...warnings, ...v.warnings] }
}

function sameLength(a: LengthMeasure, b: LengthMeasure): boolean {
  return a.valueMm === b.valueMm && a.groupId === b.groupId && a.beam === b.beam && a.method === b.method
}

// ───────────────────────────── 기록 → 초안 (고치기) ─────────────────────────────

/**
 * 저장한 기록 → 초안 (고치기). 좌표 규칙이 바뀐 앵커 기록은 앵커에서 다시 계산한 위치로 불러온다.
 * 사각형 모서리(rect-a·rect-b)는 사각형으로, 나머지는 점으로. 엑셀 기록(앵커 없음)은 빈 초안.
 */
export function draftFromRecord(record: IndicationRecord, groups: ReadonlyMap<number, ViewerGroup>, thicknessMm: number | null): LabelDraft {
  const r = anchorVersionChanged(record) ? recomputeFromAnchors(record, groups, thicknessMm).record : record
  const points: LabelDraftPoint[] = []
  let rect: LabelDraftRect | null = null
  const ra = r.anchors.find((p) => p.role === 'rect-a')
  const rb = r.anchors.find((p) => p.role === 'rect-b')
  const pos = (p: AnchorPoint): { scanMm: number; vMm: number; unfolded: number } | null => {
    if (p.mm) {
      const unfolded = p.leg !== null && thicknessMm !== null && thicknessMm > 0 ? unfoldDepth(p.mm.depthMm, p.leg, thicknessMm) : p.mm.depthMm
      return { scanMm: p.mm.scanMm, vMm: p.mm.vMm, unfolded }
    }
    const g = groups.get(p.anchor.groupId)
    const a = g ? anchorToPoint(g, p.anchor, thicknessMm) : null
    return a ? { scanMm: a.scanMm, vMm: a.vMm, unfolded: a.unfoldedDepthMm } : null
  }
  if (ra && rb && ra.anchor.groupId === rb.anchor.groupId) {
    const a = pos(ra)
    const b = pos(rb)
    if (a && b) {
      rect = {
        groupId: ra.anchor.groupId,
        scanIndex: Math.round(ra.anchor.scanIndex),
        scanMm: a.scanMm,
        vMinMm: Math.min(a.vMm, b.vMm),
        vMaxMm: Math.max(a.vMm, b.vMm),
        depthMinMm: Math.min(a.unfolded, b.unfolded),
        depthMaxMm: Math.max(a.unfolded, b.unfolded),
        displayGainDb: ra.displayGainDb ?? 0
      }
    }
  }
  for (const p of r.anchors) {
    if (rect && (p.role === 'rect-a' || p.role === 'rect-b')) continue
    const q = pos(p)
    if (!q) continue
    const lengthRole = p.role === 'length-start' || p.role === 'length-end'
    points.push({
      id: p.id,
      role: p.role,
      groupId: p.anchor.groupId,
      scanIndex: Math.round(p.anchor.scanIndex),
      scanMm: q.scanMm,
      vMm: q.vMm,
      unfoldedDepthMm: q.unfolded,
      beam: p.anchor.beam,
      sample: p.anchor.sample,
      displayGainDb: p.displayGainDb ?? 0,
      ...(lengthRole && r.length.beam !== null ? { measuredBeam: r.length.beam } : {})
    })
  }
  return { points, rect, ref: null, review: null }
}

// ───────────────────────────── 기록 표시 ─────────────────────────────

export type RecordFlagCode = 'recheck' | 'coord-rules' | 'unverified' | 'imported' | 'deleted-group' | 'estimated' | 'thickness'

/** 표시에 쓰는 그룹 정보 (OPD 표시는 선택 칸: 진폭 눈금 추정·스큐·두께 칸 의심) */
export type RecordFlagGroup = Pick<ViewerGroup, 'verified' | 'name'> &
  Partial<Pick<ViewerGroup, 'ampScale' | 'beams'>> & { selfCheck?: Pick<NonNullable<ViewerGroup['selfCheck']>, 'thicknessMismatch'> | undefined }

export interface RecordFlag {
  code: RecordFlagCode
  text: string
  title: string
}

/**
 * 지시 표에 붙는 표시 (9): 재확인 필요 / 좌표 규칙 바뀜 / 대조 전 그룹 / 엑셀 기록(앵커 없음).
 * 대조 전은 지금 파일 메타(ViewerGroup.verified)로 다시 판정한다 (앵커의 groupVerified 는 찍을 때 상태 — 기록용).
 * OPD 그룹: 진폭 눈금이 추정(ampScale.estimated)이거나 스큐 270(출사점 V 부호 추정)이면 '추정 값', 두께 칸이 의심스러우면 '두께 확인'
 * (그 값들은 8단계 대조 뒤 바뀔 수 있다 — 앵커가 남아 있어 다시 계산할 수 있음). NDE 그룹에는 붙지 않는다.
 */
export function recordFlags(r: IndicationRecord, groups: ReadonlyMap<number, RecordFlagGroup>): RecordFlag[] {
  const out: RecordFlag[] = []
  if (anchorVersionChanged(r)) out.push({ code: 'coord-rules', text: '좌표 규칙 바뀜', title: `찍을 때의 좌표 규칙과 지금 규칙(v${LABEL_COORD_RULES_VERSION})이 다릅니다. 고치기로 열면 앵커에서 다시 계산한 위치를 봅니다.` })
  if (needsRecheck(r)) out.push({ code: 'recheck', text: '재확인 필요', title: '좌표 규칙이 바뀌어 다시 계산한 기록입니다. 위치를 확인하고 다시 저장하면 표시가 지워집니다.' })
  const ids = new Set<number>(r.anchors.map((p) => p.anchor.groupId))
  if (r.signal.peak?.groupId != null) ids.add(r.signal.peak.groupId)
  if (r.length.groupId != null) ids.add(r.length.groupId)
  const un = [...ids].map((id) => groups.get(id)).filter((g): g is RecordFlagGroup => !!g && !g.verified)
  if (un.length) out.push({ code: 'unverified', text: '대조 전', title: `${un.map((g) => g.name).join(', ')} 그룹은 OmniPC 와 대조 전이라 자동 변환·학습 내보내기에서 막힙니다 (라벨은 됩니다).` })
  const used = [...ids].map((id) => groups.get(id)).filter((g): g is RecordFlagGroup => !!g)
  const est = used.filter((g) => g.ampScale?.estimated || (g.ampScale?.estimated !== undefined && g.beams?.some((b) => Math.round(b.skewDeg) % 360 === 270)))
  if (est.length) {
    const v270 = est.some((g) => g.beams?.some((b) => Math.round(b.skewDeg) % 360 === 270))
    out.push({
      code: 'estimated',
      text: '추정 값',
      title: `OPD: 최대 진폭 %FSH 는 추정 눈금(raw 255 = 250 %)${v270 ? ', 스큐 270 의 V 는 출사점 부호 추정' : ''}으로 계산했습니다. OmniPC 대조(8단계) 뒤 바뀔 수 있습니다 — 앵커(스캔 칸·빔·샘플)가 있어 다시 계산할 수 있습니다.`
    })
  }
  if (used.some((g) => g.selfCheck?.thicknessMismatch === true)) {
    out.push({ code: 'thickness', text: '두께 확인', title: '파일의 두께 칸이 용접 층 높이 합(Hot Pass + Land + Root)과 달라 레그·실제 깊이를 그 두께로 접었습니다. 실측 두께를 확인하세요(파일 정렬 두께를 넣으면 학습 내보내기는 그 값을 씁니다).' })
  }
  const missing = [...ids].filter((id) => !groups.has(id))
  if (missing.length) out.push({ code: 'deleted-group', text: '그룹 없음', title: `그룹 ${missing.join(', ')} 을(를) 이 파일에서 찾지 못했습니다.` })
  if (r.coordSource === 'imported-mm') out.push({ code: 'imported', text: r.geometricEcho?.fromSuggestion ? '앱 제안 승인' : '엑셀', title: r.geometricEcho?.fromSuggestion ? '앱이 제안한 형상 에코를 승인한 기록 (앵커 없이 mm)' : '엑셀(OmniPC 판독)에서 가져온 mm 기록 — 앵커가 없습니다' })
  return out
}

/**
 * 지시 번호 (패널·덮개·검수·CSV 가 같은 이름을 쓰게): 지우지 않은 기록을 스캔 시작 → UUID 순서로 놓고(Map 순서 = 표 순서),
 * 이름은 고정 번호 externalRef(엑셀 '지시 번호' 또는 앱이 처음 저장할 때 매긴 'A1'·대조 단계에서 더한 'C1')가 있으면 그것, 없으면 순서 번호.
 * 고정 번호는 앞쪽에 기록이 생겨도 바뀌지 않는다 (지침서 14절 메모 '지시 3 애매'가 다른 지시를 가리키지 않게).
 */
export function recordNumbers(records: readonly IndicationRecord[]): Map<string, string> {
  const list = records.filter((r) => !r.deleted).sort((a, b) => a.derived.scanStartMm - b.derived.scanStartMm || a.derived.scanEndMm - b.derived.scanEndMm || (a.uuid < b.uuid ? -1 : 1))
  return new Map(list.map((r, i) => [r.uuid, r.externalRef ?? String(i + 1)]))
}

/** 앱이 매기는 고정 지시 번호의 앞 글자: 블라인드·확정 = 'A', 설계값 대조 단계에서 더한 기록 = 'C' */
export function externalRefPrefix(stage: ReadingStage): 'A' | 'C' {
  return stage === 'reconciled' ? 'C' : 'A'
}

/** 다음 고정 지시 번호 ('A1', 'A2' … — 지운 기록 번호도 다시 쓰지 않는다). 엑셀 번호('1', '2')와 겹치지 않게 앞 글자를 붙인다 */
export function nextExternalRef(records: readonly Pick<IndicationRecord, 'externalRef'>[], stage: ReadingStage): string {
  const prefix = externalRefPrefix(stage)
  let n = 0
  for (const r of records) {
    const m = r.externalRef ? new RegExp(`^${prefix}(\\d+)$`).exec(r.externalRef) : null
    if (m) n = Math.max(n, Number(m[1]))
  }
  return `${prefix}${n + 1}`
}

/** 지시 표에서 누를 때 갈 곳: 최대 진폭 위치 → 단면 첫 점 → 기록 범위 가운데 */
export function gotoOf(r: IndicationRecord): { groupId: number; scanMm: number; beam?: number } | null {
  const pk = r.signal.peak
  if (pk && pk.groupId !== null && pk.scanMm !== null) return { groupId: pk.groupId, scanMm: pk.scanMm, ...(pk.beam !== null ? { beam: pk.beam } : {}) }
  const p = r.anchors.find((a) => a.role !== 'length-start' && a.role !== 'length-end') ?? r.anchors[0]
  if (p) return { groupId: p.anchor.groupId, scanMm: p.mm?.scanMm ?? r.derived.scanStartMm, beam: Math.round(p.anchor.beam) }
  const g = r.length.groupId
  if (g !== null) return { groupId: g, scanMm: (r.derived.scanStartMm + r.derived.scanEndMm) / 2, ...(r.length.beam !== null ? { beam: r.length.beam } : {}) }
  return null
}

/**
 * 지시 표 행을 고를 때 실제로 갈 곳: gotoOf → 기록의 화면 스냅샷 커서 → (그룹을 모르는 엑셀 기록 등) 지금 그룹 · 기록 스캔 구간 가운데.
 * 마지막 경우는 groupGuessed = true — 표가 '그룹 모름 — 지금 그룹으로 이동' 을 보인다. 스캔 구간도 없으면 null (커서를 움직이지 않음)
 */
export function gotoTargetOf(r: IndicationRecord, activeGroupId: number): { groupId: number; scanMm: number; beam?: number; groupGuessed?: true } | null {
  const g = gotoOf(r)
  if (g) return g
  const c = snapshotCursor(r.viewSnapshot)
  if (c) return { groupId: c.groupId, scanMm: c.scanMm, beam: c.beam }
  const mid = (r.derived.scanStartMm + r.derived.scanEndMm) / 2
  return Number.isFinite(mid) ? { groupId: activeGroupId, scanMm: mid, groupGuessed: true } : null
}

/** 그룹·빔 이름: 리니어 = '빔 n · 60°', 그 밖 = 굴절각 (그룹이 없으면 '—') */
export function beamTextOf(g: ViewerGroup | undefined, b: number): string {
  return !g ? '—' : cscanBeamAxis(g).kind === 'beam' ? beamLabel(g, b) : `${num(g.beams[b]?.angleDeg)}°`
}

/** draftWarnings 가 보는 파일 정보 */
export type DraftWarningFile = Pick<ViewerFileInfo, 'formatFamily' | 'scanSync'> & { specimen: Pick<ViewerFileInfo['specimen'], 'thicknessMm'> }

/**
 * 새 기록 초안의 경고 (저장은 되지만 확인할 것 — 패널이 미리 보기 경고 앞에 붙인다). 순수 (tests/labeling/recordFix.test.ts):
 *  - 길이를 잰 빔이 단면 둘레 최대 진폭 빔과 다름 (지침서 6.2 — peakBeam 을 돌려 '최대 진폭 빔으로' 단추가 쓴다)
 *  - 대조 전 그룹에서 찍은 점 (OPD 는 '(OPD)')
 *  - OPD: 스캔 축 동기 모름·시간 동기(명목 mm) · 진폭 % 추정 눈금(스큐 270 이면 V 부호 추정도) · 두께 칸이 용접 층 높이 합(Hot Pass + Land + Root)과 다름
 */
export function draftWarnings(x: {
  draft: Pick<LabelDraft, 'points' | 'rect'>
  groups: ReadonlyMap<number, ViewerGroup>
  info: DraftWarningFile
  length: DraftLength | null
  /** 단면 둘레 최대 (regionPeakOf().reading) */
  peak: Pick<PointReading, 'groupId' | 'nearestBeam'> | null
}): { warnings: string[]; peakBeam: number | null; ampEstimated: boolean } {
  const { draft, groups, info, length: len, peak } = x
  const warnings: string[] = []
  // 지침서 6.2: 길이는 최대 진폭 빔(C-scan 한 행)에서 잰다
  const peakBeam = peak && len && peak.groupId === len.groupId && peak.nearestBeam !== len.beam ? peak.nearestBeam : null
  if (len && peakBeam !== null) {
    const g = groups.get(len.groupId)
    warnings.push(`길이를 잰 빔(${beamTextOf(g, len.beam)})이 최대 진폭 빔(${beamTextOf(g, peakBeam)})과 다릅니다. 최대 진폭 빔에서 잽니다 (지침서 6.2).`)
  }
  // 대조 전 그룹에서 찍은 점 (라벨은 되지만 자동 변환·학습 내보내기에서 막힘 — 규격 2절)
  const draftGroupIds = [...draft.points.map((p) => p.groupId), ...(draft.rect ? [draft.rect.groupId] : [])]
  const unverifiedNames = [...new Set(draftGroupIds)]
    .map((id) => groups.get(id))
    .filter((g): g is ViewerGroup => !!g && !g.verified)
    .map((g) => g.name)
  // OPD 는 대조 전 이름에 형식을 붙이고(스큐마다 대조), 스캔 축 동기 방식을 몰라 mm 가 명목값임을 알린다 (앵커 = 스캔 칸 번호는 함께 저장)
  const isOpd = info.formatFamily === 'opd'
  if (unverifiedNames.length) {
    warnings.push(`${unverifiedNames.join(', ')} 그룹은 OmniPC 대조 전입니다${isOpd ? '(OPD)' : ''}. 라벨은 되지만 자동 변환·학습 내보내기에서 막힙니다.`)
  }
  if (info.scanSync === 'unknown' && draftGroupIds.length) {
    warnings.push('스캔 축 동기 방식을 몰라 스캔 mm 는 칸 번호 × 간격(명목값)입니다. 스캔 칸 번호(앵커)를 함께 저장합니다.')
  }
  if (info.scanSync === 'time' && draftGroupIds.length) {
    warnings.push('시간 동기 파일의 스캔 mm 는 설정된 시작 위치와 간격으로 계산한 명목값입니다. 엔코더 실측 위치가 아니므로 스캔 칸 번호(앵커)를 함께 저장합니다.')
  }
  const ampEstimated = draftGroupIds.some((id) => !!groups.get(id)?.ampScale.estimated)
  if (ampEstimated) {
    const v270 = draftGroupIds.some((id) => groups.get(id)?.beams.some((b) => Math.round(b.skewDeg) % 360 === 270))
    warnings.push(`OPD 최대 진폭 %${v270 ? '·V(스큐 270 출사점 부호)' : ''}는 추정 값이라 OmniPC 대조 뒤 바뀔 수 있습니다. 앵커(스캔 칸·빔·샘플)를 함께 저장해 다시 계산할 수 있습니다.`)
  }
  if (draftGroupIds.some((id) => groups.get(id)?.selfCheck?.thicknessMismatch === true)) {
    warnings.push(`두께 칸(${info.specimen.thicknessMm ?? '?'} mm)이 용접 층 높이 합(Hot Pass + Land + Root)과 달라 레그·실제 깊이가 틀릴 수 있습니다. 실측 두께를 확인하세요(두께 확인).`)
  }
  return { warnings, peakBeam, ampEstimated }
}

/** 실제 깊이 → 펼친 깊이 (덮개용, 두께를 모르면 그대로) */
export function unfoldOr(depthMm: number, leg: number, thicknessMm: number | null): number {
  return thicknessMm !== null && thicknessMm > 0 ? unfoldDepth(depthMm, leg, thicknessMm) : depthMm
}

/** 펼친 깊이 → 레그 (두께를 모르면 null) */
export function legOf(unfoldedDepthMm: number, thicknessMm: number | null): number | null {
  return foldDepth(unfoldedDepthMm, thicknessMm).leg
}
