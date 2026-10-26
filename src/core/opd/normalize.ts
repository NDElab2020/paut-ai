/**
 * OPD 구조 읽기 결과(OpdFile) → 스캔플랜 스펙·지문·기록용 수집 요약 (판단.md 7절 4단계).
 *
 * 원칙: 파일에서 읽은 값만 지문에 넣고, 파일에서 찾지 못한 칸(Fill 각도·HAZ·캡·파 모드 코드 2·스캔면·집속 방식 등)은 null 로 두고
 * 경고를 남긴다. 추정값(모델 이름의 소자 수, '횡파' 등)으로 메우지 않는다.
 * 파일 코드에서 이름을 정했지만 다른 값 표본이 없는 칸(시편 모양 0 = 판재, 재질 30 = STEEL, MILD, 개선 틀 6 = V-Offset)은
 * 값을 넣고 specimen.estimatedFields 에 적어 화면에 '추정'을 붙인다(코드 원값도 지문에 있으므로 묶음을 가르지 않음).
 * 예외: 공유 스펙 타입에서 null 이 될 수 없는 두 칸(탐촉자 종류 'phasedArrayLinear'·장착 방향 'Normal')은 OPD 플랜 모두 같은
 * 상수로 넣는다(지문을 가르지 않음). 파일 칸이 아니라 추정이므로 OPD_ASSUMED_FIELDS 로 경고하고 플랜 화면에 '추정'을 붙인다.
 * 대신 OPD 플랜이 NDE 플랜과 섞이지 않도록 techniqueParams 에 dataFormat 'opd' 를 넣고,
 * 용접 Hot Pass·Land·Root의 높이·각도·오프셋은 별도 형상 값으로 저장한다. 미해독 템플릿·대칭은 null로 보존한다.
 * 단위·반올림은 .nde 정규화와 같다(길이 0.1 mm, 각도 0.1°, 주파수 0.01 MHz).
 */
import {
  OPD_DATA_FORMAT,
  SPEC_VERSION,
  type AcquisitionSummary,
  type BeamGroupSpec,
  type GateSummary,
  type GroupProbeSpec,
  type NormalizedSetup,
  type ScanPlanSpec,
  type SpecimenEstimatedField,
  type WeldGeometrySpec
} from '@shared/types'
import { fingerprint } from '../nde/fingerprint'
import { summarizeSpec } from '../nde/naming'
import { FINGERPRINT_TOLERANCE, quantize, wrapDeg } from '../nde/units'
import type { OpdFile } from './types'

/**
 * OPD → 스펙 규칙 버전 (techniqueParams.opdSpecRule, 지문에 들어감).
 * 이 파일의 규칙이나 읽기 규칙(OPD_READER)이 바뀌어 스펙 값이 달라지면 올린다 →
 * 저장소를 열 때 이 값이 다른 OPD 플랜을 저장소 사본에서 다시 읽어 스펙·지문을 고친다(core/service/maintenance).
 * 읽기 규칙만 올리고 이 값을 잊지 않도록 OPD_SPEC_RULE_FOR_READER 표와 실데이터 지문 스냅샷 시험(normalize.realdata)이 함께 막는다.
 */
export const OPD_SPEC_RULE = 3

/**
 * 읽기 규칙 버전 → 그 규칙에서 쓰는 스펙 규칙 (OPD_READER.version 을 올리면 여기에 한 줄을 더한다 — 시험이 확인).
 * reader 2 (일반 정보 따라 읽기·위치 수 교차 확인) 는 162개 스펙 값이 그대로라 스펙 규칙 1 그대로다.
 * reader 3 → 스펙 규칙 2: Hot Pass·Land·Root·개선 각·Land 오프셋·판재·재질·소자 수를 스펙에 넣음.
 * reader 4 → 스펙 규칙 3: 개선 틀 코드 6 = V-Offset(bevelShape 'V', 이름 추정)·추정 칸 표시(estimatedFields). 162개 플랜 묶음(35개)은 그대로
 */
export const OPD_SPEC_RULE_FOR_READER: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 3 }

/** 요약 끝에 붙는 형식 표시 */
export const OPD_SUMMARY_SUFFIX = ' · OPD'

/** 늘 붙는 첫 경고(parse.ts) — 미리보기에서는 'OPD · 자체 해석 · 대조 전' 표시와 '정확도 대조 전' 줄로 대신한다 */
export const OPD_FORMAT_NOTE = 'OPD 는 공개되지 않은 형식이라 파일 구조를 따라 읽었습니다(OmniPC 대조 전).'

/** 파일에서 찾지 못해 null 로 둔 스펙 칸 (경고 문구 — 파일마다 해당하는 것만) */
export const OPD_UNKNOWN_FIELDS = ['시편 형상', '재질', '개선 템플릿·대칭', 'Fill·HAZ·Upper/Lower Cap', '탐촉자 소자 수', '파 모드', '스캔면', '스캔 오프셋', '집속 방식'] as const

/** 파일 칸이 없어 상수로 넣은 스펙 칸 (공유 타입이 null 을 받지 않음 — 모든 OPD 플랜에 같은 값이라 지문을 가르지 않음) */
export const OPD_ASSUMED_FIELDS = ['탐촉자 종류(선형 위상배열)', '장착 방향(정방향)'] as const

const lengthMm = (v: number): number => quantize(v, FINGERPRINT_TOLERANCE.lengthMm)
const angleDeg = (v: number): number => quantize(v, FINGERPRINT_TOLERANCE.angleDeg)
const frequencyMHz = (v: number): number => quantize(v, FINGERPRINT_TOLERANCE.frequencyMHz)
/** 기록용 (지문 제외) 반올림 */
const rec = (v: number, step: number): number | null => (Number.isFinite(v) ? quantize(v, step) : null)

/** 읽은 용접 숫자 → 스캔플랜 형상. 미해독 값은 0이 아니라 null로 둔다. */
export function opdWeldSpec(file: OpdFile): WeldGeometrySpec | null {
  const w = file.setup.weld
  if (!w) return null
  const layer = (v: { heightMm: number; angleDeg: number }): { heightMm: number; angleDeg: number } => ({
    heightMm: lengthMm(v.heightMm), angleDeg: angleDeg(v.angleDeg)
  })
  const cap = (v: { heightMm: number; widthMm: number } | null): { heightMm: number; widthMm: number } | null =>
    v ? { heightMm: lengthMm(v.heightMm), widthMm: lengthMm(v.widthMm) } : null
  return {
    bevelShape: w.bevelShape,
    symmetry: w.symmetryName,
    template: w.templateName,
    templateCode: w.templateCode,
    symmetryCode: w.symmetryCode,
    offsetMm: lengthMm(w.land.offsetMm),
    hazWidthMm: w.hazWidthMm === null ? null : lengthMm(w.hazWidthMm),
    derivedFillHeightMm: lengthMm(w.derivedFillHeightMm),
    weldAngleDeg: null,
    upperCap: cap(w.upperCap),
    lowerCap: cap(w.lowerCap),
    hotPass: layer(w.hotPass),
    land: { heightMm: lengthMm(w.land.heightMm) },
    root: layer(w.root),
    fills: w.fill ? [layer(w.fill)] : w.derivedFillHeightMm > 0.05 ? [{ heightMm: lengthMm(w.derivedFillHeightMm), angleDeg: null }] : [],
    materialName: null
  }
}

/** OPD → 스캔플랜 스펙 (그룹은 162개 모두 1개) */
export function opdPlanSpec(file: OpdFile): ScanPlanSpec {
  const s = file.setup
  const probe: GroupProbeSpec = {
    role: 'pulseEcho',
    probe: {
      model: s.probe.model || null,
      // [추정 — 파일 칸 없음] 소자 번호가 한 줄로 이어지는 위상배열(빔마다 16소자 지연). 매트릭스·듀얼 표시는 파일에 없다
      kind: 'phasedArrayLinear',
      centralFrequencyMHz: frequencyMHz(s.probe.centralFrequencyMHz),
      elementCount: s.probe.elementCount,
      pitchMm: lengthMm(s.probe.pitchMm)
    },
    // [추정 — 파일 칸 없음] 출사점 ↔ 스넬 대조가 정방향 장착으로 맞았다(1_파서실험 5.1)
    orientation: 'Normal',
    wedge: { model: s.wedge.model || null, kind: 'angleBeam', wedgeAngleDeg: angleDeg(s.wedge.angleDeg) },
    position: { uOffsetMm: s.scanOffsetMm === null ? null : lengthMm(s.scanOffsetMm), vOffsetMm: lengthMm(s.indexOffsetMm), skewDeg: wrapDeg(s.skewDeg), surface: null }
  }
  const sectorial = s.formation === 'sectorial'
  const estimated = estimatedFieldsOf(file)
  const group: BeamGroupSpec = {
    technique: 'PA',
    formation: s.formation,
    firstElement: s.firstElement,
    aperture: s.aperture,
    elementStep: s.elementStep === null ? null : quantize(s.elementStep, 0.01),
    refractedAngle: sectorial
      ? { startDeg: angleDeg(s.angle.startDeg), stopDeg: angleDeg(s.angle.stopDeg), stepDeg: angleDeg(s.angle.stepDeg) }
      : { startDeg: angleDeg(s.angle.startDeg), stopDeg: angleDeg(s.angle.startDeg), stepDeg: null },
    focusing: { mode: null, distanceMm: lengthMm(s.focusDepthMm) },
    waveMode: s.waveMode,
    probes: [probe],
    techniqueParams: {
      dataFormat: OPD_DATA_FORMAT,
      opdSpecRule: OPD_SPEC_RULE,
      opdShapeCode: s.specimen.shapeCode,
      opdMaterialCode: s.specimen.materialCode,
      opdWaveModeCode: s.waveModeCode
    }
  }
  return {
    specVersion: SPEC_VERSION,
    specimen: {
      shape: s.specimen.shape ?? 'unknown',
      thicknessMm: lengthMm(s.thicknessMm),
      outerRadiusMm: null,
      angularOpeningDeg: null,
      materialName: s.specimen.materialName,
      weld: opdWeldSpec(file),
      ...(estimated.length ? { estimatedFields: estimated } : {})
    },
    groups: [group]
  }
}

/** 값은 넣었지만 '추정'인 시편 칸 (코드 이름을 다른 값 표본 없이 정함 — weld.ts 코드 표) */
export function estimatedFieldsOf(file: OpdFile): SpecimenEstimatedField[] {
  const s = file.setup
  const out: SpecimenEstimatedField[] = []
  if (s.specimen.shape !== null && s.specimen.shapeEstimated) out.push('shape')
  if (s.specimen.materialName !== null && s.specimen.materialEstimated) out.push('materialName')
  if (s.weld?.templateName && s.weld.templateEstimated) out.push('weld.template')
  return out
}

/** 추정 칸 → 경고 글 조각: '시편 형상(판재)' */
function estimatedLabels(file: OpdFile): string[] {
  const s = file.setup
  const label: Record<SpecimenEstimatedField, string> = {
    shape: `시편 형상(${s.specimen.shape === 'plate' ? '판재' : s.specimen.shape} — 코드 ${s.specimen.shapeCode})`,
    materialName: `재질(${s.specimen.materialName} — 코드 ${s.specimen.materialCode})`,
    'weld.template': `개선 템플릿(${s.weld?.templateName === 'VOffset' ? 'V-Offset' : s.weld?.templateName} — 코드 ${s.weld?.templateCode})`
  }
  return estimatedFieldsOf(file).map((f) => label[f])
}

/** 기준 이득 0 (PCN) 은 '모름' — 그대로 두면 Ref 계산이 수천 %가 된다(판단.md 2절 이득) */
export function opdReferenceGainDb(file: OpdFile): number | null {
  const v = file.setup.referenceGainDb
  return Number.isFinite(v) && v !== 0 ? v : null
}

function gatesOf(file: OpdFile): GateSummary[] {
  const b = file.beams[0]
  if (!b) return []
  return b.gates.map((g) => ({
    name: `Gate ${g.name}`,
    // 게이트 시작·폭은 깊이 시간(깊이 × 2 / 음속)이다 — 첫 빔 값
    startUs: rec(g.startDepthUs, 0.001),
    lengthUs: rec(g.widthDepthUs, 0.001),
    thresholdPercent: file.beams.every((beam) => beam.gates.find((v) => v.name === g.name)?.thresholdPct === g.thresholdPct) ? g.thresholdPct : null,
    geometry: 'TrueDepth'
  }))
}

/** 기록용 수집 요약 (지문 제외) */
export function opdAcquisition(file: OpdFile): AcquisitionSummary {
  const s = file.setup
  const two = file.raster.twoAxis
  return {
    groups: [
      {
        groupName: file.header.groupName || 'PA 1',
        specGroupIndex: 0,
        gainDb: rec(s.gainDb, 0.1),
        referenceGainDb: (() => {
          const r = opdReferenceGainDb(file)
          return r === null ? null : rec(r, 0.1)
        })(),
        velocityMps: rec(s.velocityMps, 0.1),
        beamCount: file.beams.length,
        // 장비 디지타이저 주파수는 파일에서 찾지 못했다(샘플 간격은 압축 뒤 값이라 같은 뜻이 아님)
        digitizingFrequencyMHz: null,
        tcgEnabled: file.beams.some((b) => b.tcg.length > 1),
        gates: gatesOf(file),
        scanQuantity: two ? two.scanCount : file.raster.positions,
        scanResolutionMm: rec(s.scan.resolutionMm, 0.001),
        ...(s.scanAxes ? { scanStartMm: s.scanAxes.scan.startMm, scanLastPointMm: s.scanAxes.scan.lastPointMm } : {}),
        indexQuantity: two ? two.indexLines : null,
        indexResolutionMm: two && s.scanAxes?.index.rangeMatchesQuantity ? s.scanAxes.index.resolutionMm : null,
        calibrations: []
      }
    ],
    encoder: s.scanAxes?.scanSync === 'time' ? { mode: 'Time', stepResolutionPerMm: null }
      : s.scanAxes?.scanSync === 'encoder' ? { mode: 'Encoder', stepResolutionPerMm: s.scanAxes.encoder?.resolutionStepsPerMm ?? null } : null,
    scanPattern: null
  }
}

/** 정규화 중 남기는 경고 (한국어). 구조 읽기 경고 + 비워 둔 칸 */
export function opdSetupWarnings(file: OpdFile): string[] {
  const out = [...file.warnings]
  const s = file.setup
  const unknown = OPD_UNKNOWN_FIELDS.filter((field) => {
    if (field === '시편 형상') return s.specimen.shape === null
    if (field === '재질') return s.specimen.materialName === null
    if (field === '탐촉자 소자 수') return s.probe.elementCount === null
    if (field === '파 모드') return s.waveMode === null
    if (field === '스캔 오프셋') return s.scanOffsetMm === null
    if (field === '개선 템플릿·대칭') return !!s.weld && (s.weld.templateName === null || s.weld.symmetryName === null)
    if (field === 'Fill·HAZ·Upper/Lower Cap') return s.weld !== null
    return true
  })
  out.push(`파일에서 찾지 못해 비워 둔 칸: ${unknown.join(', ')}. 추정값으로 채우지 않았습니다.`)
  const estimated = estimatedLabels(file)
  if (estimated.length) out.push(`파일 코드로 정했지만 다른 값 표본이 없어 '추정'으로 둔 칸: ${estimated.join(', ')}.`)
  out.push(`파일 칸이 없어 모든 OPD 플랜에 같은 값으로 둔 칸(추정): ${OPD_ASSUMED_FIELDS.join(', ')}.`)
  if (s.weld) {
    out.push('Hot Pass·Land·Root의 높이·각도와 Land 오프셋은 파일에서 읽었습니다. Fill·HAZ·Cap 값은 미해독입니다.')
    if (s.weld.templateCode !== null && s.weld.templateName === null) out.push(`개선 템플릿 코드 ${s.weld.templateCode}의 이름을 아직 대조하지 못했습니다. 원래 코드를 보존합니다.`)
  }
  if (opdReferenceGainDb(file) === null) out.push(`기준 이득(Ref)이 ${file.setup.referenceGainDb} dB 라 '모름'으로 둡니다.`)
  // 동기 칸(Axis 0x743D0)은 scan.ts 가 읽는다: 0 = 시간(35개), 1 = 엔코더(127개) — SEC20 r01 36/36 대조
  const sync = s.scanAxes?.scanSync ?? 'unknown'
  if (sync === 'unknown') out.push('스캔 축 동기 방식(엔코더/시간)을 파일에서 찾지 못했습니다. 스캔 위치(mm)는 칸 번호 × 간격의 명목값입니다.')
  else if (sync === 'time') out.push('스캔 축이 시간 동기입니다. 스캔 위치(mm)는 시작 위치 + 칸 번호 × 간격으로 계산한 명목값입니다(엔코더 실측 아님).')
  return out
}

const num = (v: number): string => String(Math.round(v * 10) / 10)

function opdParams(spec: ScanPlanSpec): { focusMm: number | null; hotMm: number | null; landMm: number | null; rootMm: number | null } {
  const g = spec.groups[0]
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const w = spec.specimen.weld
  return { focusMm: n(g?.focusing?.distanceMm), hotMm: n(w?.hotPass?.heightMm), landMm: n(w?.land?.heightMm), rootMm: n(w?.root?.heightMm) }
}

/**
 * 두께 칸 < Hot Pass + Land + Root (층 높이 합이 두께를 넘음 — 맞지 않을 때만 '두께 확인 필요').
 * 양면 V(X)는 Root(아래쪽 개선)까지 더해야 두께가 된다: PL2386x 25 = 11.5 + 2 + 11.5. 남는 높이는 Fill 계산값이라 의심하지 않는다
 */
export function opdThicknessSuspect(spec: ScanPlanSpec): boolean {
  const t = spec.specimen.thicknessMm
  const { hotMm, landMm, rootMm } = opdParams(spec)
  return t !== null && hotMm !== null && landMm !== null && rootMm !== null && hotMm + landMm + rootMm > 0 && hotMm + landMm + rootMm - t > 0.05
}

/** 개선 높이 글자: Hot Pass + Land (+ Root, 0 이 아닐 때 — 양면 V 의 아래쪽) '23+2' · '11.5+2+11.5' */
function weldHeightsText(spec: ScanPlanSpec): string | null {
  const { hotMm, landMm, rootMm } = opdParams(spec)
  if (hotMm === null || landMm === null || rootMm === null) return null
  return [hotMm, landMm, ...(rootMm > 0 ? [rootMm] : [])].map(num).join('+')
}

/**
 * OPD 플랜 짧은 이름 조각: 집속 깊이 · 개선 모양+높이 ('집속 25', 'X개선 11.5+2+11.5').
 * NDE 이름(두께·주파수·스큐)에 더 붙여, 그 값만 다른 ROOT/TOP·TP/PL TOP 플랜이 같은 이름이 되지 않게 한다
 */
export function opdNameParts(spec: ScanPlanSpec): string[] {
  const { focusMm } = opdParams(spec)
  const heights = weldHeightsText(spec)
  const shape = spec.specimen.weld?.bevelShape
  const out: string[] = []
  if (focusMm !== null) out.push(`집속 ${num(focusMm)}`)
  if (heights !== null) out.push(`${shape ? `${shape}개선` : '개선'} ${heights}`)
  return out
}

/** OPD 요약 줄: NDE 요약('판재 25 mm · X 개선 · …') + 집속·개선 높이(·두께 확인 필요) + ' · OPD' */
export function opdSummary(spec: ScanPlanSpec): string {
  const { focusMm } = opdParams(spec)
  const heights = weldHeightsText(spec)
  const parts = [summarizeSpec(spec)]
  if (focusMm !== null) parts.push(`집속 ${num(focusMm)} mm`)
  if (heights !== null) parts.push(`개선 높이 ${heights} mm`)
  if (opdThicknessSuspect(spec)) parts.push('두께 확인 필요')
  return parts.join(' · ') + OPD_SUMMARY_SUFFIX
}

/** OPD → 스펙 + 지문 + 수집 요약 + 요약 줄 + 경고 */
export function normalizeOpd(file: OpdFile): NormalizedSetup {
  const spec = opdPlanSpec(file)
  return {
    spec,
    fingerprint: fingerprint(spec).fingerprint,
    acquisition: opdAcquisition(file),
    summary: opdSummary(spec),
    warnings: opdSetupWarnings(file)
  }
}
