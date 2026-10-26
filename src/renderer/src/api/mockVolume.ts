/**
 * 브라우저 mock 용 가짜 볼륨 — X3 12T-SV 와 같은 모양(스큐 90/270, 40~70°, 12 mm 판재 V 개선)에
 * 위치를 아는 반사체를 심는다. 화면 확인용이며 값은 실측이 아니다.
 */
import { DEG, DEFAULT_AMPLITUDE_PALETTE, DEFAULT_SPECIAL_COLORS, mmPerUs } from '@shared/imaging'
import { composeBlockReason, type ViewerBlockReason, type ViewerFileInfo, type ViewerGate, type ViewerGroup, type ViewerVolumeChunk } from '@shared/imaging/types'

const NS = 160
const NB = 31
const NT = 808
const RES_US = 0.04
const T0_US = 8.05
const VEL = 3242

/** 심은 반사체: 스캔 위치(mm)·V(mm, CL 기준)·펼친 깊이(mm)·최대 %FSH */
export const MOCK_REFLECTORS: ReadonlyArray<{ scanMm: number; vMm: number; depthMm: number; pct: number }> = [
  { scanMm: 40, vMm: 1, depthMm: 11, pct: 90 }, // 루트 근처
  { scanMm: 95, vMm: -4, depthMm: 18, pct: 60 }, // 개선면 (2레그)
  { scanMm: 130, vMm: 5, depthMm: 6, pct: 40 } // 캡 근처
]

function gates(nb: number, beams: ViewerGroup['beams']): ViewerGate[] {
  const depthWindow = (d0: number, d1: number): { startUs: number[]; lengthUs: number[] } => {
    const startUs = beams.map((b) => (2 * (d0 / Math.cos(b.angleDeg * DEG))) / mmPerUs(b.velocityMps))
    const endUs = beams.map((b) => (2 * (d1 / Math.cos(b.angleDeg * DEG))) / mmPerUs(b.velocityMps))
    return { startUs, lengthUs: endUs.map((e, i) => e - startUs[i]!) }
  }
  const a = depthWindow(7, 28)
  return [
    { id: 0, name: 'Gate I', geometry: 'SoundPath', sync: 'Pulse', startUs: [4.44], lengthUs: [8.86], thresholdPct: 20, supported: true, producesCscan: false },
    { id: 1, name: 'Gate A', geometry: 'TrueDepth', sync: 'Pulse', ...a, thresholdPct: 20, supported: nb > 0, producesCscan: true },
    { id: 2, name: 'Gate B', geometry: 'SoundPath', sync: 'Pulse', startUs: [24.67], lengthUs: [12.34], thresholdPct: 10, supported: true, producesCscan: false }
  ]
}

function group(id: number, name: string, skewDeg: 90 | 270): ViewerGroup {
  const s = skewDeg === 90 ? 1 : -1
  const beams = Array.from({ length: NB }, (_, b) => ({
    index: b,
    angleDeg: 40 + b,
    skewDeg,
    velocityMps: VEL,
    uOffsetMm: 0,
    vOffsetMm: s * (-38.3 + b * 0.33),
    t0Us: T0_US
  }))
  return {
    id,
    name,
    technique: 'pa-sectorial',
    supported: true,
    reason: null,
    verified: true,
    amplitudePath: `/mock/${id}`,
    statusPath: `/mock/${id}/status`,
    shape: [NS, NB, NT],
    bytes: NS * NB * NT * 2,
    ampScale: { rawMax: 32767, unitMax: 200 },
    scan: { offsetMm: 0, resolutionMm: 1, count: NS },
    ultrasound: { resolutionUs: RES_US, count: NT },
    beams,
    gates: gates(NB, beams),
    cscanGateId: 1,
    initialBeam: 14 + id,
    gainDb: id === 0 ? 24.7 : 20.4,
    referenceGainDb: id === 0 ? 18.7 : 14.4,
    referenceAmplitudePct: 80
  }
}

export function mockViewerInfo(): ViewerFileInfo {
  return {
    formatFamily: '3.x',
    version: '3.3.0',
    groups: [
      group(0, 'Skew90', 90),
      group(1, 'Skew270', 270),
      {
        ...group(2, 'ToFD', 90),
        technique: 'tofd',
        supported: false,
        reason: 'ToFD 그룹은 아직 그리지 않습니다.',
        beams: [],
        gates: [],
        shape: [0, 0, 0],
        bytes: 0,
        cscanGateId: null
      }
    ],
    specimen: {
      shape: 'plate',
      thicknessMm: 12,
      weld: {
        bevelShape: 'V',
        symmetry: 'Symmetric',
        offsetMm: 1,
        landHeightMm: 2,
        hotPass: { angleDeg: 30, heightMm: 10 },
        fills: [],
        root: { angleDeg: 0, heightMm: 0 },
        upperCap: { widthMm: 25, heightMm: 2 },
        lowerCap: { widthMm: 6, heightMm: 2 },
        hazWidthMm: 10,
        weldAngleDeg: 0
      }
    },
    display: {
      palette: [...DEFAULT_AMPLITUDE_PALETTE],
      specialColors: [...DEFAULT_SPECIAL_COLORS],
      paletteSource: 'default',
      layout: 'MultiACS',
      layoutGroupMode: 'Multiple',
      currentGroupId: 0,
      cscanReversed: true
    },
    warnings: []
  }
}

/**
 * OPD 파일의 이미지 보기 mock (core/opd/viewer.ts 가 채우는 모양 — TP14-ROOT-L: 대조 전·추정 눈금·Ref 모름·내장 색표·엔코더 동기·V-Offset 덮개 추정·막힘).
 * 진폭은 위 X3 모양 가짜 볼륨(그룹 0)을 그대로 쓰고 눈금만 OPD 추정(상한 250 %)으로 둔다. 화면 문구 확인용
 */
export function mockOpdViewerInfo(): ViewerFileInfo {
  const base = group(0, 'PA 1', 90)
  const blockReasons: ViewerBlockReason[] = [
    { code: 'unverified-kind', text: 'OmniPC 대조 전(OPD 섹토리얼 · 스큐 90)' },
    { code: 'amp-scale', text: '진폭 눈금 추정(raw 255 = 250 %, 캡처 O1·O2 대조 전)' },
    { code: 'specimen-shape', text: '시편 형상 추정(파일 코드 0 → 판재, 다른 값 표본 없음)' },
    { code: 'gate-a', text: '게이트 A 일치율을 판정하지 못함(저장 구간 안 칸 없음, 전체 97.3 %)' }
  ]
  const g: ViewerGroup = {
    ...base,
    verified: false,
    amplitudePath: 'opd-raster',
    statusPath: 'opd-empty-frames',
    ampScale: { rawMax: 32767, unitMax: 250, estimated: true },
    gates: base.gates.map((x, i) => ({ ...x, geometry: 'TrueDepth', thresholdPct: [20, 10, 30][i] ?? null })),
    gainDb: 33.6,
    referenceGainDb: null,
    amplitudeSource: { kind: 'opd-raster', offset: 0, frameBytes: NB * NT, bitDepth: 8 },
    selfCheck: {
      gateAAgreement: null,
      gateAAgreementAll: 0.973,
      gateAUnexplained: 0.011,
      gateAStrongAgreement: null,
      suspectFrames: 0,
      snellMaxDiffMm: 0.01,
      thicknessMismatch: false,
      emptyFrames: 0,
      passed: { gateA: null, snell: true, thickness: true },
      notes: ['게이트 A 가 저장 구간 안에 다 들어오는 칸이 없어 일치율을 판정하지 못했습니다(전체 칸 일치 97.3 %). 판단.md 3.2 기준이라 대조 전으로 둡니다.']
    },
    blockReason: composeBlockReason(blockReasons),
    blockReasons
  }
  return {
    formatFamily: 'opd',
    version: 'OPD · MXU - 4.4R5',
    reader: { name: 'opd-structure', version: 4 },
    scanSync: 'encoder',
    groups: [g],
    specimen: {
      shape: 'plate', shapeEstimated: true, thicknessMm: 25,
      weld: {
        bevelShape: 'V', template: 'VOffset', templateCode: 6, symmetry: 'Symmetric', symmetryCode: 0, templateEstimated: true, geometryEstimated: false,
        offsetMm: 1, landHeightMm: 2, hotPass: { heightMm: 23, angleDeg: 30 }, root: { heightMm: 0, angleDeg: 0 },
        fills: [], upperCap: null, lowerCap: null, hazWidthMm: null, weldAngleDeg: 0, overlayNote: '덮개 추정'
      }
    },
    display: {
      palette: [...DEFAULT_AMPLITUDE_PALETTE],
      specialColors: [...DEFAULT_SPECIAL_COLORS],
      paletteSource: 'default',
      layout: null,
      layoutGroupMode: null,
      currentGroupId: 0,
      cscanReversed: true
    },
    warnings: [
      'OPD 는 공개되지 않은 형식이라 파일 구조를 따라 읽었습니다(OmniPC 대조 전).',
      "진폭 % 는 추정 눈금(raw 255 = 250 %)입니다. OmniPC 캡처로 확정하기 전이라 읽기값에 '추정 눈금'을 붙입니다.",
      "개선 틀 코드 6 을 한면 V(V-Offset)로 보고 덮개를 그립니다. 모양은 OmniPC 덮개·SetupBuilder 스캔플랜과 맞췄지만 메뉴 이름은 추정이라 덮개에 '추정'을 붙입니다."
    ]
  }
}

/** 결정적 잡음 (0..1) */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function mockViewerChunk(groupId: number, scanStart: number, scanCount: number): ViewerVolumeChunk {
  const g = mockViewerInfo().groups.find((x) => x.id === groupId && x.supported)
  if (!g) throw new Error(`그룹 ${groupId} 은(는) 이미지로 볼 수 없습니다.`)
  const s0 = Math.max(0, Math.min(NS - 1, scanStart))
  const n = Math.max(1, Math.min(scanCount, NS - s0))
  const amp = new Int16Array(n * NB * NT)
  const status = new Uint8Array(n * NB).fill(1)
  const sign = g.beams[0]!.skewDeg === 90 ? 1 : -1
  for (let k = 0; k < n; k++) {
    const scanMm = s0 + k
    for (let b = 0; b < NB; b++) {
      const beam = g.beams[b]!
      const th = beam.angleDeg * DEG
      const base = (k * NB + b) * NT
      for (let i = 0; i < NT; i++) amp[base + i] = Math.round(noise(base + i + groupId * 7) * 250)
      for (const r of MOCK_REFLECTORS) {
        const ws = Math.exp(-((scanMm - r.scanMm) ** 2) / (2 * 4 ** 2))
        if (ws < 0.01) continue
        const dx = sign * (r.vMm - beam.vOffsetMm)
        const phi = Math.atan2(dx, r.depthMm) - th
        const wb = Math.exp(-(phi ** 2) / (2 * (2.5 * DEG) ** 2))
        if (wb < 0.01) continue
        const rr = Math.hypot(dx, r.depthMm)
        const ic = ((2 * rr) / mmPerUs(beam.velocityMps) - beam.t0Us) / RES_US
        for (let i = Math.max(0, Math.floor(ic - 15)); i < Math.min(NT, Math.ceil(ic + 15)); i++) {
          const v = (r.pct / 200) * 32767 * ws * wb * Math.exp(-((i - ic) ** 2) / (2 * 3 ** 2))
          amp[base + i] = Math.min(32767, amp[base + i]! + Math.round(v))
        }
      }
    }
  }
  return { groupId, scanStart: s0, scanCount: n, amplitude: amp, status }
}
