/**
 * OPD → 이미지 보기 (OPD_조사/판단.md 7절 6·7단계). 읽기 전용, Electron 비의존.
 *
 *   readOpdViewerInfo   : 구조 읽기(readOpdFile) + 자체 점검(selfCheckOpd) → ViewerFileInfo (NDE 와 같은 모양, 그리기 코드는 그대로 씀)
 *   readOpdViewerChunk  : 래스터 조각 uint8 → Int16Array [스캔, 빔, 샘플] + 상태 [스캔, 빔] (모두 0 인 프레임 = 0, 그 밖 1)
 *   readStoredViewerInfo·readStoredViewerChunk : 저장된 사본 경로로 형식을 골라 읽는다(.opd → OPD, 그 밖 → NDE). 서비스·학습 내보내기 공용
 *
 * 값을 옮기는 규칙 (근거: 1_파서실험.md 5절·3_화면대조.md, 이 폴더 README.md 위치표):
 *   - 빔 출사점 V = 인덱스 오프셋 + 출사점 X (스큐 90, OmniPC 화면 2장과 0.2 mm 안) / 인덱스 오프셋 − 출사점 X (스큐 270, 대칭으로 추정).
 *     첫·끝 빔 사이를 보간하지 않고 빔 기록 값 그대로. U = GroupUT 초기 스캔 위치 (못 읽으면 0 근사)
 *   - t0 = 빔 기록 A-scan 시작(웨지 지연을 뺀 출사점 왕복 시간), 샘플 간격 = 범위 / 320, 음속 = 그룹 음속(A−0x3E0)
 *   - 게이트 I·A·B: 파일은 깊이 시간 → 빔마다 ÷ cos θ 로 빔 시간. geometry 'TrueDepth', sync 'Pulse'. 문턱은 typed Context→Gate 참조에서 읽고 미해독 파일만 null('문턱 모름')
 *   - 진폭 눈금 rawMax 255 · unitMax 250 (추정 — estimated). 이득·기준 진폭은 파일 값, 기준 이득 0(PCN)은 null('Ref 모름')
 *   - 색표: 파일 진폭 색표는 OmniPC 기본 색표를 약 0.94배로 누른 모양이라 쓰지 않고 앱 내장 색표(paletteSource 'default')
 *   - 스캔 mm = Patch 시작 위치 + 프레임 번호 × 간격. scanSync 는 Axis 동기 코드(0 = 시간, 1 = 엔코더 — scan.ts), 못 읽으면 'unknown'
 *   - 화면 상태(레이아웃·현재 빔)는 파일에서 못 찾아 기본값. C-scan 은 OmniPC 캡처 2장처럼 첫 빔(작은 각도)을 아래로(cscanReversed)
 * 대조: VERIFIED 의 OPD 표는 비어 있어(core/nde/viewer/meta.ts) 모든 OPD 그룹이 verified = false 다.
 *   그룹마다 blockReasons(대조 전·진폭 눈금 추정·형상 모름/추정·자체 점검·두께 불일치·센 신호·손상 의심)를 붙여
 *   derive·학습 내보내기가 이유와 함께 막는다. 라벨 기록은 막지 않는다.
 *   자체 점검에서 설명할 수 없는 게이트 A 어긋남이 10 % 를 넘으면 래스터 배치를 믿을 수 없어 그리지 않는다(보류(해석 실패)).
 */
import { AppError } from '@shared/errors'
import { DEG, skewSign } from '@shared/imaging/coords'
import {
  composeBlockReason,
  type AmplitudeScale,
  type ViewerBeam,
  type ViewerBlockReason,
  type ViewerFileInfo,
  type ViewerGate,
  type ViewerGroup,
  type ViewerSelfCheck,
  type ViewerTechnique,
  type ViewerWeld,
  type ViewerVolumeChunk
} from '@shared/imaging/types'
import { scansPerChunk } from '@shared/imaging/volume'
import { initNde } from '../nde'
import { readViewerChunk, readViewerInfo } from '../nde/viewer'
import { defaultDisplay } from '../nde/viewer/display'
import { VIEWER_MAX_GROUP_BYTES, beamOrderProblem, isVerifiedKind } from '../nde/viewer/meta'
import { isOpdFileName, OPD_FAIL_PREFIX, readOpdAmplitude, readOpdFile, selfCheckOpd, type OpdSource } from './index'
import { SELF_CHECK_LIMITS } from './selfcheck'
import { OPD_AMPLITUDE_SCALE, OPD_READER, type OpdFile, type OpdSelfCheck } from './types'

/** 이미지 보기 그룹의 진폭 위치 표시 이름 (HDF5 경로 자리) */
export const OPD_AMPLITUDE_PATH = 'opd-raster'
/** 상태 비트 표시 이름: 파일에 상태 칸이 없어 '모두 0 인 프레임 = 데이터 없음'으로 만든다 */
export const OPD_STATUS_PATH = 'opd-empty-frames'
/** 그룹 id (162개 모두 그룹 1개) */
export const OPD_GROUP_ID = 0
/** 게이트 id·이름 (FblUT_Gate_GROUP 순서 I·A·B) */
const OPD_GATES = [
  { id: 0, key: 'I', name: 'Gate I' },
  { id: 1, key: 'A', name: 'Gate A' },
  { id: 2, key: 'B', name: 'Gate B' }
] as const
const GATE_A_ID = 1

/** 진폭 눈금 (추정 — 화면 세 점 raw × 0.98, 255 = 250 %). 캡처 O1·O2 로 확정 전 */
export const OPD_VIEWER_AMP_SCALE: AmplitudeScale = { rawMax: OPD_AMPLITUDE_SCALE.rawMax, unitMax: OPD_AMPLITUDE_SCALE.unitMax, estimated: true }

const TECHNIQUE_KO: Partial<Record<ViewerTechnique, string>> = { 'pa-sectorial': '섹토리얼', 'pa-linear': '리니어' }

/** 이미지 보기가 늘 붙이는 OPD 주의 (구조 읽기 경고 다음) */
export const OPD_VIEWER_NOTES = {
  amplitude: '진폭 % 는 추정 눈금(raw 255 = 250 %)입니다. OmniPC 캡처로 확정하기 전이라 읽기값에 \'추정 눈금\'을 붙입니다.',
  threshold: '게이트 문턱 % 를 파일에서 찾지 못해 \'문턱 모름\'으로 둡니다. DA^·ViA^ 의 ND 판정을 하려면 조정 패널에서 문턱을 넣으세요.',
  palette: '파일의 진폭 색표는 OmniPC 화면 색과 달라 앱 내장 색표를 씁니다(색표: 내장).',
  scanSync: '스캔 축 동기 방식(엔코더/시간)을 파일에서 알 수 없습니다. 스캔 mm 는 칸 번호 × 간격(명목값)입니다.',
  specimen: '시편 형상은 모름(형상 미상)입니다. 판재로 근사하고, 용접 덮개는 파일의 Hot Pass·Land·Root 숫자로 근사합니다(개선 템플릿·대칭 대조 전).',
  templateEstimated: '개선 틀 코드 6 을 한면 V(V-Offset)로 보고 덮개를 그립니다. 모양은 OmniPC 덮개·SetupBuilder 스캔플랜과 맞췄지만 메뉴 이름은 추정이라 덮개에 \'추정\'을 붙입니다.',
  skew270: '스큐 270 의 출사점 V 는 인덱스 오프셋 − 출사점 X 로 둔 부호 추정입니다(TP14-ROOT-R 캡처로 확인 전). V·ViA^·S-scan 가로 위치가 바뀔 수 있습니다.'
} as const

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100)
}

/**
 * 빔 출사점 V (CL 기준 mm). 스큐 90 = 인덱스 오프셋 + 출사점 X [확인], 스큐 270 = 인덱스 오프셋 − 출사점 X [추정 — 대칭].
 * 그 밖의 스큐는 null.
 */
export function opdExitVMm(indexOffsetMm: number, exitXMm: number, skewDeg: number): number | null {
  const s = skewSign(skewDeg)
  return s === null ? null : indexOffsetMm + s * exitXMm
}

/** 대조 전 이름: 'OPD 섹토리얼 · 스큐 90' */
export function opdKindLabel(technique: ViewerTechnique, skewDeg: number | null): string {
  const t = TECHNIQUE_KO[technique] ?? technique
  return skewDeg === null ? `OPD ${t}` : `OPD ${t} · 스큐 ${Math.round(skewDeg)}`
}

/**
 * 자체 점검 → 이미지 보기용 요약. 판정(passed)과 메모는 core 자체 점검(selfcheck.ts) 그대로다 — 뷰어가 따로 판정하지 않는다.
 * 게이트 A: 저장 구간 안 칸 ≥ 95 % · 전체 칸 ≥ 95 % · 설명할 수 없는 어긋남 ≤ 10 %. 저장 구간 안 칸이 없으면 null(판정 못 함 → 대조 전)
 */
export function viewerSelfCheckOf(check: OpdSelfCheck): ViewerSelfCheck {
  return {
    gateAAgreement: check.gateA.insideRate,
    gateAAgreementAll: check.gateA.rate,
    gateAUnexplained: check.gateA.unexplainedRate,
    gateAStrongAgreement: check.gateA.strongRate,
    suspectFrames: check.suspectFrames,
    snellMaxDiffMm: check.snell?.maxDiffMm ?? null,
    thicknessMismatch: check.thickness?.mismatch ?? null,
    emptyFrames: check.emptyFrames,
    passed: { ...check.passed },
    notes: [...check.notes]
  }
}

/** 자체 점검이 통과인가 (판정 못 한 점검은 통과로 보지 않는다 — 대조 전으로 둠). 손상 의심 프레임이 있어도 통과가 아니다 */
export function opdSelfCheckPassed(sc: ViewerSelfCheck): boolean {
  return sc.passed.gateA === true && sc.passed.snell === true && sc.passed.thickness !== false && sc.suspectFrames === 0
}

const pct1 = (x: number): string => `${(x * 100).toFixed(1)} %`

/** 자동 변환·학습 내보내기를 막는 이유 항목 (없으면 빈 목록) */
function blockReasonsOf(file: OpdFile, technique: ViewerTechnique, skewDeg: number | null, sc: ViewerSelfCheck | null, verifiedKind: boolean, amp: AmplitudeScale): ViewerBlockReason[] {
  const out: ViewerBlockReason[] = []
  if (!verifiedKind) out.push({ code: 'unverified-kind', text: `OmniPC 대조 전(${opdKindLabel(technique, skewDeg)})` })
  if (amp.estimated) out.push({ code: 'amp-scale', text: `진폭 눈금 추정(raw ${amp.rawMax} = ${amp.unitMax} %, 캡처 O1·O2 대조 전)` })
  // 형상 코드를 못 읽으면 판재 근사. 읽었어도 코드 이름이 '추정'(162개 모두 코드 0 = 판재, 다른 값 표본 없음)이고
  // SEC(200A Sch20)·S36('450A') 은 실제로 배관일 수 있어 판재 규칙(시방서 표 13 등)을 그대로 쓰면 안 된다 — 막는 이유로 남긴다
  const sp = file.setup.specimen
  if (sp.shape === null) out.push({ code: 'specimen-shape', text: '시편 형상 모름(판재로 근사)' })
  else if (sp.shapeEstimated) out.push({ code: 'specimen-shape', text: `시편 형상 추정(파일 코드 ${sp.shapeCode} → ${sp.shape === 'plate' ? '판재' : sp.shape}, 다른 값 표본 없음)` })
  if (!sc) {
    out.push({ code: 'self-check', text: '자체 점검을 하지 못함' })
    return out
  }
  if (sc.thicknessMismatch) {
    const s = file.setup
    const w = s.weld
    const height = w ? w.hotPass.heightMm + w.land.heightMm + w.root.heightMm : 0
    out.push({ code: 'thickness', text: `두께 칸 ${fmt(s.thicknessMm)} mm 가 Hot Pass + Land + Root ${fmt(height)} mm 와 다름` })
  }
  if (sc.passed.thickness === null && file.setup.weld) out.push({ code: 'self-check', text: 'Fill 높이는 계산값이며 각도 미해독으로 용접 높이의 두께 점검을 판정하지 못함' })
  if (sc.passed.gateA === false) {
    const parts = [sc.gateAAgreement === null ? null : `저장 구간 안 ${pct1(sc.gateAAgreement)}`, `전체 ${pct1(sc.gateAAgreementAll)}`].filter(Boolean)
    out.push({ code: 'gate-a', text: `게이트 A 재계산 일치율 ${parts.join(' · ')} (기준 95 %)` })
  } else if (sc.passed.gateA === null) {
    out.push({ code: 'gate-a', text: `게이트 A 일치율을 판정하지 못함(저장 구간 안 칸 없음, 전체 ${pct1(sc.gateAAgreementAll)})` })
  }
  if (sc.gateAStrongAgreement !== null && sc.gateAStrongAgreement < SELF_CHECK_LIMITS.strongRate) {
    out.push({ code: 'strong-signal', text: `센 신호(raw ≥ ${SELF_CHECK_LIMITS.strongRaw}) 칸 일치 ${pct1(sc.gateAStrongAgreement)}` })
  }
  if (sc.suspectFrames > 0) out.push({ code: 'suspect-frames', text: `손상 의심 프레임 ${sc.suspectFrames}개(래스터 0 · 장비 게이트 값 있음)` })
  if (sc.passed.snell === false) {
    out.push({ code: 'snell', text: `출사점이 스넬 계산과 ${sc.snellMaxDiffMm === null || !Number.isFinite(sc.snellMaxDiffMm) ? '∞' : sc.snellMaxDiffMm.toFixed(3)} mm 다름` })
  } else if (sc.passed.snell === null) out.push({ code: 'snell', text: '출사점 스넬 점검을 하지 못함' })
  return out
}

/** 빔 기록 → 이미지 보기 빔 (출사점 V 를 계산할 수 없는 스큐면 V = NaN — 그룹을 막는다) */
function beamsOf(file: OpdFile): ViewerBeam[] {
  const s = file.setup
  return file.beams.map((b) => ({
    index: b.index,
    angleDeg: b.angleDeg,
    skewDeg: b.skewDeg,
    velocityMps: s.velocityMps,
    uOffsetMm: s.scanOffsetMm ?? 0,
    vOffsetMm: opdExitVMm(s.indexOffsetMm, b.exitXMm, b.skewDeg) ?? Number.NaN,
    t0Us: b.t0Us
  }))
}

/** 게이트 I·A·B: 깊이 시간 ÷ cos θ = 빔 시간 (빔마다) */
function gatesOf(file: OpdFile): ViewerGate[] {
  return OPD_GATES.map((def) => {
    const startUs: number[] = []
    const lengthUs: number[] = []
    let ok = true
    const thresholds: Array<number | null> = []
    for (const b of file.beams) {
      const g = b.gates.find((x) => x.name === def.key)
      thresholds.push(g?.thresholdPct ?? null)
      const c = Math.cos(b.angleDeg * DEG)
      if (!g || !(c > 1e-6)) {
        ok = false
        startUs.push(0)
        lengthUs.push(0)
        continue
      }
      startUs.push(g.startDepthUs / c)
      lengthUs.push(g.widthDepthUs / c)
    }
    return {
      id: def.id,
      name: def.name,
      geometry: 'TrueDepth',
      sync: 'Pulse',
      startUs,
      lengthUs,
      thresholdPct: thresholds.length && thresholds.every((x) => x !== null && x === thresholds[0]) ? thresholds[0]! : null,
      supported: ok && startUs.every(Number.isFinite) && lengthUs.every((x) => Number.isFinite(x) && x >= 0),
      producesCscan: def.id === GATE_A_ID
    }
  })
}

/** 그릴 수 없는 이유 (그릴 수 있으면 null) */
function unsupportedReason(file: OpdFile, technique: ViewerTechnique, beams: ViewerBeam[], bytes: number): string | null {
  const r = file.raster
  if (r.twoAxis) return `2축 스캔(부식 맵핑, 인덱스 ${r.twoAxis.indexLines}줄)은 아직 그리지 않습니다.`
  if (beams.length < 2) return '빔이 2개 미만인 그룹은 아직 그리지 않습니다.'
  if (beams.some((b) => skewSign(b.skewDeg) === null)) return '스큐 90°/270° 가 아닌 빔은 아직 그리지 않습니다.'
  if (new Set(beams.map((b) => skewSign(b.skewDeg))).size > 1) return '한 그룹에 스큐 방향이 섞여 있어 아직 그리지 않습니다.'
  if (beams.some((b) => !Number.isFinite(b.vOffsetMm))) return '빔 출사점을 계산할 수 없어 아직 그리지 않습니다.'
  const dt = file.beams[0]!.sampleIntervalUs
  if (!(dt > 0) || file.beams.some((b) => Math.abs(b.sampleIntervalUs - dt) > 1e-9 * Math.max(1, dt))) return '빔마다 샘플 간격이 달라 아직 그리지 않습니다.'
  if (technique !== 'pa-sectorial') {
    const geom = beamOrderProblem(beams)
    if (geom) return geom
  }
  if (bytes > VIEWER_MAX_GROUP_BYTES) {
    const mb = (x: number): string => (x / 1024 / 1024).toFixed(0)
    return `파일이 커서 아직 볼 수 없습니다(그룹 ${mb(bytes)} MB, 한도 ${mb(VIEWER_MAX_GROUP_BYTES)} MB).`
  }
  return null
}

/** 그릴 수 있는 그룹인지만 (자체 점검을 할지 정할 때) */
export function opdGroupDrawable(file: OpdFile): boolean {
  const technique: ViewerTechnique = file.setup.formation === 'sectorial' ? 'pa-sectorial' : 'pa-linear'
  const r = file.raster
  return unsupportedReason(file, technique, beamsOf(file), r.positions * r.beams * r.samples * 2) === null
}

/** S-scan 개선 덮개 꼬리표 (OPD 덮개는 모두 — 개선 칸을 자체 해석으로 읽었고 OmniPC 대조 전) */
export const OPD_WELD_OVERLAY_NOTE = '덮개 추정'

/**
 * 읽은 개선 숫자를 뷰어로 전달. 개선 모양은 틀 코드로 정한다(5 = X 양면 V [확인], 6 = V 한면 V [이름 추정]).
 * 모르는 코드는 이름을 짐작하지 않고 'unknown' + geometryEstimated(숫자 층으로만 그리는 참고 단면)로 둔다.
 * 덮개에는 늘 '덮개 추정' 꼬리표(overlayNote)를 붙인다.
 */
export function opdViewerWeld(file: OpdFile): ViewerWeld | null {
  const w = file.setup.weld
  if (!w) return null
  return {
    bevelShape: w.bevelShape ?? 'unknown',
    symmetry: w.symmetryName,
    template: w.templateName,
    templateCode: w.templateCode,
    symmetryCode: w.symmetryCode,
    templateEstimated: w.templateEstimated,
    geometryEstimated: w.templateName === null || w.symmetryName === null || w.derivedFillHeightMm > SELF_CHECK_LIMITS.thicknessTolMm,
    offsetMm: w.land.offsetMm,
    landHeightMm: w.land.heightMm,
    hotPass: { ...w.hotPass },
    root: { ...w.root },
    fills: w.fill ? [{ ...w.fill }] : [],
    upperCap: w.upperCap ? { ...w.upperCap } : null,
    lowerCap: w.lowerCap ? { ...w.lowerCap } : null,
    hazWidthMm: w.hazWidthMm,
    weldAngleDeg: 0,
    overlayNote: OPD_WELD_OVERLAY_NOTE
  }
}

/**
 * 구조 읽기 결과 + 자체 점검 → ViewerFileInfo (순수 함수). check 가 null 이면(그릴 수 없는 그룹 등) 자체 점검 없이 막는다.
 */
export function buildOpdViewerInfo(file: OpdFile, check: OpdSelfCheck | null): ViewerFileInfo {
  const s = file.setup
  const r = file.raster
  const technique: ViewerTechnique = s.formation === 'sectorial' ? 'pa-sectorial' : 'pa-linear'
  const beams = beamsOf(file)
  const nb = beams.length
  const shape: [number, number, number] = [r.positions, nb, r.samples]
  const bytes = r.positions * nb * r.samples * 2
  const skew = beams.length && beams.every((b) => b.skewDeg === beams[0]!.skewDeg) ? beams[0]!.skewDeg : null
  const sc = check ? viewerSelfCheckOf(check) : null
  let reason = unsupportedReason(file, technique, beams, bytes)
  if (reason === null && sc && sc.gateAUnexplained > SELF_CHECK_LIMITS.gateAUnexplainedRate) {
    // 장비 값보다 큰 재계산이 많다 = 샘플 수·래스터 시작 등 배치를 잘못 읽었을 가능성 → 엉뚱한 그림을 그리지 않는다
    reason = `${OPD_FAIL_PREFIX}: 래스터에서 다시 계산한 게이트 A 가 장비 저장 값보다 큰 칸이 ${pct1(sc.gateAUnexplained)} 입니다(기준 10 %). 래스터 배치를 확인할 수 없어 그리지 않습니다.`
  }
  const verifiedKind = isVerifiedKind('opd', technique, skew)
  const supported = reason === null
  const gates = gatesOf(file)
  const ampScale: AmplitudeScale = { ...OPD_VIEWER_AMP_SCALE }
  const blockReasons = supported ? blockReasonsOf(file, technique, skew, sc, verifiedKind, ampScale) : []
  const group: ViewerGroup = {
    id: OPD_GROUP_ID,
    name: file.header.groupName,
    technique,
    supported,
    reason,
    verified: supported && verifiedKind && sc !== null && opdSelfCheckPassed(sc) && (!s.weld || sc.passed.thickness === true),
    amplitudePath: OPD_AMPLITUDE_PATH,
    statusPath: OPD_STATUS_PATH,
    shape,
    bytes,
    ampScale,
    scan: { offsetMm: s.scanAxes?.scan.startMm ?? 0, resolutionMm: round6(s.scan.resolutionMm), count: r.positions },
    ultrasound: { resolutionUs: file.beams[0]?.sampleIntervalUs ?? 1, count: r.samples },
    beams,
    gates,
    cscanGateId: gates.find((g) => g.id === GATE_A_ID && g.supported)?.id ?? null,
    initialBeam: Math.floor(nb / 2),
    gainDb: s.gainDb,
    // 기준 이득 0 (PCN) 은 'Ref 모름' — 그대로 두면 Ref 를 80 × 10^(이득/20) 로 계산하게 된다 (판단.md 2절 함정)
    referenceGainDb: s.referenceGainDb === 0 ? null : s.referenceGainDb,
    referenceAmplitudePct: s.referenceAmplitudePct,
    amplitudeSource: { kind: 'opd-raster', offset: r.offset, frameBytes: r.frameBytes, bitDepth: 8 },
    ...(sc ? { selfCheck: sc } : {}),
    blockReason: composeBlockReason(blockReasons),
    blockReasons
  }
  if (group.cscanGateId === null && supported) {
    group.supported = false
    group.reason = '게이트 A 를 빔 시간으로 바꿀 수 없어 아직 그리지 않습니다.'
    group.blockReason = null
    group.blockReasons = []
  }
  const display = defaultDisplay()
  display.currentGroupId = group.supported ? group.id : null
  // C-scan 세로축 방향: 파일에서 칸을 찾지 못했다. OmniPC 6.6 캡처 2장(TP14-ROOT-L·SEC25-2) 모두 첫 빔(작은 각도)이 아래라 그것을 따른다
  display.cscanReversed = true
  const warnings = [...file.warnings]
  if (supported) warnings.push(OPD_VIEWER_NOTES.amplitude)
  if (supported && gates.some((g) => g.thresholdPct === null)) warnings.push(OPD_VIEWER_NOTES.threshold)
  if (supported && skewSign(skew ?? 0) === -1) warnings.push(OPD_VIEWER_NOTES.skew270)
  if (s.specimen.shape === null) warnings.push(OPD_VIEWER_NOTES.specimen)
  else if (s.weld && s.weld.templateName === null) warnings.push(`파일의 판재 설정을 사용합니다. 개선 템플릿 코드 ${s.weld.templateCode ?? '모름'}은 대조 전이며 Hot Pass·Land·Root 숫자로 덮개를 근사합니다.`)
  else if (s.weld?.templateEstimated) warnings.push(OPD_VIEWER_NOTES.templateEstimated)
  return {
    formatFamily: 'opd',
    version: `OPD · ${file.header.mxuVersion}`,
    reader: { name: OPD_READER.name, version: OPD_READER.version },
    scanSync: s.scanAxes?.scanSync ?? 'unknown',
    groups: [group],
    specimen: { shape: s.specimen.shape ?? 'plate', shapeEstimated: s.specimen.shapeEstimated, thicknessMm: s.thicknessMm, weld: opdViewerWeld(file) },
    display,
    warnings
  }
}

/** .opd 사본 → 이미지 보기 정보 (구조 읽기 + 그릴 수 있으면 자체 점검: 래스터 전체를 한 번 읽음, 10 MB 에 약 20 ms) */
export async function readOpdViewerInfo(source: OpdSource): Promise<ViewerFileInfo> {
  const file = await readOpdFile(source)
  const check = opdGroupDrawable(file) ? await selfCheckOpd(source, { file }) : null
  return buildOpdViewerInfo(file, check)
}

export type OpdViewerGroupRef = Pick<ViewerGroup, 'id' | 'shape' | 'supported' | 'amplitudeSource'>

/**
 * 그룹 진폭 조각: 래스터 uint8 → Int16Array [scanCount, 빔, 샘플] (값 0~255 그대로), 상태 [scanCount, 빔] = 그 프레임이 모두 0 이면 0, 아니면 1.
 * scanCount 는 조각 상한(scansPerChunk, NDE 와 같은 계산)과 그룹 끝으로 자른다. 열 때와 구조(래스터 위치·크기)가 다르면 CONFLICT.
 */
export async function readOpdViewerChunk(source: OpdSource, group: OpdViewerGroupRef, scanStart: number, scanCount: number): Promise<ViewerVolumeChunk> {
  const src = group.amplitudeSource
  if (!group.supported || !src || src.kind !== 'opd-raster') throw new AppError('NDE_UNSUPPORTED', '이 그룹은 이미지로 볼 수 없습니다.', `group ${group.id}`)
  const [ns, nb, nt] = group.shape
  if (!Number.isInteger(scanStart) || !Number.isInteger(scanCount) || scanStart < 0 || scanStart >= ns || scanCount < 1) {
    throw new AppError('INVALID_ARGUMENT', '스캔 범위가 올바르지 않습니다.', `scanStart=${scanStart} scanCount=${scanCount} ns=${ns}`)
  }
  const s0 = scanStart
  const s1 = Math.min(ns, s0 + Math.min(scanCount, scansPerChunk(group.shape)))
  const file = await readOpdFile(source)
  const r = file.raster
  if (r.offset !== src.offset || r.frameBytes !== src.frameBytes || r.positions !== ns || r.beams !== nb || r.samples !== nt) {
    throw new AppError('CONFLICT', '파일 구조가 열 때와 다릅니다. 다시 여세요.', `raster ${r.offset}/${r.positions}x${r.beams}x${r.samples} != ${src.offset}/${group.shape.join('x')}`)
  }
  const chunk = await readOpdAmplitude(source, s0, s1 - s0, { file, format: 'uint8' })
  const u8 = chunk.amplitude
  const n = s1 - s0
  const frame = nb * nt
  const amplitude = new Int16Array(n * frame)
  const status = new Uint8Array(n * nb)
  for (let k = 0; k < n; k++) {
    const base = k * frame
    let any = 0
    for (let i = base; i < base + frame; i++) {
      const v = u8[i]!
      amplitude[i] = v
      any |= v
    }
    if (any !== 0) status.fill(1, k * nb, (k + 1) * nb)
  }
  return { groupId: group.id, scanStart: s0, scanCount: n, amplitude, status }
}

// ───────────────────────────── 형식 고르기 (서비스·학습 내보내기 공용) ─────────────────────────────

/** 이 그룹이 OPD 래스터에서 읽는 그룹인가 */
export function isOpdViewerGroup(group: Pick<ViewerGroup, 'amplitudeSource'>): boolean {
  return group.amplitudeSource?.kind === 'opd-raster'
}

/** 저장된 사본 경로의 형식으로 이미지 보기 정보를 읽는다: .opd → OPD 구조 읽기, 그 밖 → NDE(HDF5, h5wasm 준비 포함) */
export async function readStoredViewerInfo(path: string): Promise<ViewerFileInfo> {
  if (isOpdFileName(path)) return readOpdViewerInfo(path)
  await initNde()
  return readViewerInfo(path)
}

/** 그룹의 진폭 위치로 형식을 골라 조각을 읽는다 (OPD 래스터 → readOpdViewerChunk, 그 밖 → NDE readViewerChunk) */
export async function readStoredViewerChunk(path: string, group: ViewerGroup, scanStart: number, scanCount: number): Promise<ViewerVolumeChunk> {
  if (isOpdViewerGroup(group)) return readOpdViewerChunk(path, group, scanStart, scanCount)
  return readViewerChunk(path, group, scanStart, scanCount)
}
