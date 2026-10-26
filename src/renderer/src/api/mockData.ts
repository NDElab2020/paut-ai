/** 브라우저 mock 용 가짜 데이터. X3 실데이터(12T-SV, 4개 파일)와 비슷하게 만든다. */
import { planNameFrom, uniquePlanName } from '@shared/planName'
import type {
  AcquisitionSummary,
  BeamGroupSpec,
  FileRecord,
  GroupAcquisitionSummary,
  ImportHistoryEntry,
  NdeFileMeta,
  ScanPlan,
  GroupProbeSpec,
  ProbeKind,
  ScanPlanSpec,
  Specimen,
  SpecimenShape
} from '@shared/types'

function x3Group(skewDeg: number, vOffsetMm: number): BeamGroupSpec {
  return {
    technique: 'PA',
    formation: 'sectorial',
    firstElement: 32,
    aperture: 32,
    elementStep: null,
    refractedAngle: { startDeg: 40, stopDeg: 70, stepDeg: 1 },
    focusing: { mode: 'TrueDepth', distanceMm: 23 },
    waveMode: 'TransversalVertical',
    probes: [
      {
        role: 'pulseEcho',
        probe: { model: '5L64-A32', kind: 'phasedArrayLinear', centralFrequencyMHz: 5, elementCount: 64, pitchMm: 0.5 },
        orientation: 'Normal',
        wedge: { model: 'SA32-N55S', kind: 'angleBeam', wedgeAngleDeg: 36.1 },
        position: { uOffsetMm: 0, vOffsetMm: vOffsetMm, skewDeg, surface: 'Top' }
      }
    ],
    techniqueParams: {}
  }
}

export const X3_SPEC: ScanPlanSpec = {
  specVersion: 2,
  specimen: {
    shape: 'plate',
    thicknessMm: 12,
    outerRadiusMm: null,
    angularOpeningDeg: null,
    materialName: 'Steel_Mild',
    weld: {
      bevelShape: 'V',
      symmetry: 'Symmetric',
      weldAngleDeg: 0,
      upperCap: { widthMm: 25, heightMm: 2 },
      lowerCap: { widthMm: 6, heightMm: 2 },
      hotPass: { angleDeg: 30, heightMm: 10 },
      land: { heightMm: 2 },
      root: { angleDeg: 0, heightMm: 0 },
      fills: [{ angleDeg: 0, heightMm: 0 }],
      materialName: 'Steel_Mild'
    }
  },
  groups: [x3Group(270, 15), x3Group(90, -15)]
}

export const PIPE_SPEC: ScanPlanSpec = {
  specVersion: 2,
  specimen: {
    shape: 'pipe',
    thicknessMm: 25.4,
    outerRadiusMm: 304.8,
    angularOpeningDeg: 360,
    materialName: 'Steel_Carbon',
    weld: {
      bevelShape: 'J',
      symmetry: 'Symmetric',
      weldAngleDeg: 10,
      upperCap: { widthMm: 22, heightMm: 2 },
      lowerCap: { widthMm: 8, heightMm: 1.5 },
      hotPass: null,
      land: { heightMm: 1.6 },
      root: { angleDeg: 0, heightMm: 3 },
      fills: [],
      materialName: 'Steel_Carbon'
    }
  },
  groups: [
    {
      technique: 'PA',
      formation: 'linear',
      firstElement: 1,
      aperture: 16,
      elementStep: 1,
      refractedAngle: { startDeg: 60, stopDeg: 60, stepDeg: null },
      focusing: { mode: 'HalfPath', distanceMm: 40 },
      waveMode: 'TransversalVertical',
      probes: [
        {
          role: 'pulseEcho',
          probe: { model: '7.5L64-A2', kind: 'phasedArrayLinear', centralFrequencyMHz: 7.5, elementCount: 64, pitchMm: 0.6 },
          orientation: 'Normal',
          wedge: { model: 'SA2-N55S', kind: 'angleBeam', wedgeAngleDeg: 36 },
          position: { uOffsetMm: 0, vOffsetMm: -20, skewDeg: 90, surface: 'Outside' }
        }
      ],
      techniqueParams: {}
    },
    {
      technique: 'ToFD',
      formation: 'none',
      firstElement: null,
      aperture: null,
      elementStep: null,
      refractedAngle: { startDeg: 60, stopDeg: 60, stepDeg: null },
      focusing: { mode: null, distanceMm: null },
      waveMode: 'Longitudinal',
      probes: [
        {
          role: 'pulser',
          probe: { model: 'C543-SM', kind: 'conventionalRound', centralFrequencyMHz: 5, elementCount: 1, pitchMm: null },
          orientation: 'Normal',
          wedge: { model: 'ST1-60L', kind: 'angleBeam', wedgeAngleDeg: 31.4 },
          position: { uOffsetMm: 0, vOffsetMm: -45, skewDeg: 90, surface: 'Outside' }
        },
        {
          role: 'receiver',
          probe: { model: 'C543-SM', kind: 'conventionalRound', centralFrequencyMHz: 5, elementCount: 1, pitchMm: null },
          orientation: 'Normal',
          wedge: { model: 'ST1-60L', kind: 'angleBeam', wedgeAngleDeg: 31.4 },
          position: { uOffsetMm: 0, vOffsetMm: 45, skewDeg: 270, surface: 'Outside' }
        }
      ],
      techniqueParams: { pcsMm: 90 }
    }
  ]
}

function x3Acq(groupName: string, idx: number, gain: number, velocity: number): GroupAcquisitionSummary {
  return {
    groupName,
    specGroupIndex: idx,
    gainDb: gain,
    referenceGainDb: 18.7,
    velocityMps: velocity,
    beamCount: 31,
    digitizingFrequencyMHz: 100,
    tcgEnabled: true,
    gates: [
      { name: 'Gate I', startUs: 4.44, lengthUs: 8.86, thresholdPercent: 20, geometry: 'SoundPath' },
      { name: 'Gate A', startUs: 5.63, lengthUs: 16.91, thresholdPercent: 20, geometry: 'TrueDepth' },
      { name: 'Gate B', startUs: 5.63, lengthUs: 16.91, thresholdPercent: 20, geometry: 'TrueDepth' }
    ],
    scanQuantity: 301,
    scanResolutionMm: 1,
    indexQuantity: null,
    indexResolutionMm: null,
    calibrations: ['sensitivityCalibration', 'tcgCalibration']
  }
}

export const X3_ACQ: AcquisitionSummary = {
  groups: [x3Acq('Skew270', 0, 20.4, 3242.1), x3Acq('Skew90', 1, 24.7, 3242.8)],
  encoder: { mode: 'Quadrature', stepResolutionPerMm: 80 },
  scanPattern: 'OneLineScan'
}

export const X3_SUMMARY = '판재 12 mm · V 개선 · 5L64-A32 ×2 · ±15 mm · PA 섹터 40–70°'
const PIPE_SUMMARY = '배관 OD 609.6 mm · 25.4 mm · J 개선 · 7.5L64-A2 PA 선형 60° + ToFD'

const T0 = '2026-09-28T10:12:00+09:00'

export function seedPlans(): ScanPlan[] {
  return [
    {
      id: 'SP001',
      name: '12T · 5MHz · SK90/270',
      note: '',
      fingerprint: 'fp2:mock-x3-12t-sv',
      spec: X3_SPEC,
      summary: X3_SUMMARY,
      createdAt: T0,
      updatedAt: T0,
      fileCount: 4,
      specimenCount: 4,
      totalBytes: 4 * 48_123_456,
      lastImportedAt: T0
    },
    {
      id: 'SP002',
      name: '25.4T · 7.5/5MHz · SK90/270',
      note: '공식 예제 기반 가짜 데이터',
      fingerprint: 'fp2:mock-pipe-pa-tofd',
      spec: PIPE_SPEC,
      summary: PIPE_SUMMARY,
      createdAt: '2026-09-29T14:00:00+09:00',
      updatedAt: '2026-09-29T14:00:00+09:00',
      fileCount: 1,
      specimenCount: 1,
      totalBytes: 21_004_800,
      lastImportedAt: '2026-09-29T14:00:00+09:00'
    }
  ]
}

const X3_FILES: Array<[string, string, string, string]> = [
  ['12T-SV-01-Cap on.nde', '12T-SV-PL23833-i15-CAP20', 'PL23833', 'Cap on'],
  ['12T-SV-02-Cap on.nde', '12T-SV-PL23840-i15-CAP20', 'PL23840', 'Cap on'],
  ['12T-SV-03-Cap off.nde', '12T-SV-PL23841-i15-CAP OFF', 'PL23841', 'Cap off'],
  ['12T-SV-04-Cap on.nde', '12T-SV-PL23831-i15-CAP20', 'PL23831', 'Cap on']
]

export const MOCK_SOURCE_DIR = 'D:/PAUT/원시데이터/X3_12T-SV'

export function seedSpecimens(): Specimen[] {
  const fromX3 = X3_FILES.map(([, , id]) => ({
    id,
    displayName: id,
    source: 'device-filename' as const,
    note: '',
    createdAt: T0
  }))
  return [...fromX3, { id: 'COD-24-001', displayName: 'COD-24-001', source: 'filename', note: '', createdAt: '2026-09-29T14:00:00+09:00' }]
}

export function seedFiles(): FileRecord[] {
  const x3 = X3_FILES.map(([fileName, deviceFileName, specimenId, stateTag], i): FileRecord => ({
    id: i + 1,
    planId: 'SP001',
    specimenId,
    storedRelPath: `스캔플랜/SP001/${specimenId}/${fileName}`,
    storedFileName: fileName,
    meta: {
      ndeVersion: { raw: '3.3.0', family: '3.x', major: 3, minor: 3, patch: 0, preRelease: null },
      deviceFileName,
      device: { platform: 'OmniScanX3', model: 'Freedom_32x128', serialNumber: 'QC-0018282', name: 'MXU' },
      createdAt: `2024-09-03T10:${String(32 + i * 7).padStart(2, '0')}:26+09:00`,
      modifiedAt: `2024-09-03T10:${String(33 + i * 7).padStart(2, '0')}:02+09:00`,
      application: { name: 'OmniScan X3', version: '5.12.0' },
      scenario: 'General Weld',
      sha256: `${'ab'.repeat(30)}${String(i).padStart(4, '0')}`,
      sizeBytes: 48_123_456,
      sourcePath: `${MOCK_SOURCE_DIR}/${fileName}`,
      sourceFileName: fileName
    },
    stateTag,
    tags: [],
    round: null,
    memo: '',
    acquisition: X3_ACQ,
    importBatchId: 'IMP-20260928-101200-a1b2',
    importedAt: T0
  }))
  const pipe: FileRecord = {
    ...x3[0]!,
    id: 5,
    planId: 'SP002',
    specimenId: 'COD-24-001',
    storedRelPath: '스캔플랜/SP002/COD-24-001/Weld_COD_2PA-ToFD-4.2.nde',
    storedFileName: 'Weld_COD_2PA-ToFD-4.2.nde',
    meta: {
      ...x3[0]!.meta,
      ndeVersion: { raw: '4.2.0', family: '4.x', major: 4, minor: 2, patch: 0, preRelease: null },
      deviceFileName: null,
      device: { platform: 'OmniScanX4', model: 'X4_64x128', serialNumber: 'QC-0099001', name: 'MXU' },
      sha256: 'cd'.repeat(32),
      sizeBytes: 21_004_800,
      sourcePath: 'D:/PAUT/예제/Weld_COD_2PA-ToFD-4.2.nde',
      sourceFileName: 'Weld_COD_2PA-ToFD-4.2.nde',
      createdAt: '2025-03-11T09:20:00+09:00',
      modifiedAt: '2025-03-11T09:20:00+09:00'
    },
    stateTag: null,
    importBatchId: 'IMP-20260929-140000-c3d4',
    importedAt: '2026-09-29T14:00:00+09:00'
  }
  return [...x3, pipe]
}

export function seedHistory(): ImportHistoryEntry[] {
  return [
    {
      batchId: 'IMP-20260929-140000-c3d4',
      startedAt: '2026-09-29T14:00:00+09:00',
      finishedAt: '2026-09-29T14:00:04+09:00',
      status: 'completed',
      inputPaths: ['D:/PAUT/예제/Weld_COD_2PA-ToFD-4.2.nde'],
      totalItems: 1,
      copiedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      createdPlanIds: ['SP002'],
      totalBytes: 21_004_800
    },
    {
      batchId: 'IMP-20260928-101200-a1b2',
      startedAt: T0,
      finishedAt: '2026-09-28T10:12:09+09:00',
      status: 'completed',
      inputPaths: [MOCK_SOURCE_DIR],
      totalItems: 4,
      copiedCount: 4,
      skippedCount: 0,
      failedCount: 0,
      createdPlanIds: ['SP001'],
      totalBytes: 4 * 48_123_456
    }
  ]
}

/** 새 플랜 예시: Evident 공식 예제 Weld_Plate_PA-Sect_sk90-4.2.nde 의 셋업 값 (판 26 mm, 스테인리스, 그룹 1개) */
export const PLATE42_SPEC: ScanPlanSpec = {
  specVersion: 2,
  specimen: {
    shape: 'plate',
    thicknessMm: 26,
    outerRadiusMm: null,
    angularOpeningDeg: null,
    materialName: 'Steel_Stainless',
    weld: {
      bevelShape: 'V',
      symmetry: 'Symmetric',
      weldAngleDeg: 0,
      upperCap: { widthMm: 33.7, heightMm: 1 },
      lowerCap: { widthMm: 9.2, heightMm: 1.5 },
      hotPass: { angleDeg: 30, heightMm: 24 },
      land: { heightMm: 2 },
      root: { angleDeg: 0, heightMm: 0 },
      fills: [{ angleDeg: 0, heightMm: 0 }],
      materialName: 'Steel_Stainless'
    }
  },
  groups: [
    {
      ...x3Group(90, -26),
      firstElement: 0,
      focusing: { mode: 'TrueDepth', distanceMm: 26 }
    }
  ]
}

export const PLATE42_SUMMARY = '판재 26 mm · V 개선 · 5L64-A32 · −26 mm · PA 섹터 40–70°'

export const PLATE42_ACQ: AcquisitionSummary = {
  groups: [
    {
      groupName: 'GR-1',
      specGroupIndex: 0,
      gainDb: null,
      referenceGainDb: null,
      velocityMps: 3100,
      beamCount: 31,
      digitizingFrequencyMHz: 100,
      tcgEnabled: false,
      gates: [],
      scanQuantity: null,
      scanResolutionMm: null,
      indexQuantity: null,
      indexResolutionMm: null,
      calibrations: []
    }
  ],
  encoder: null,
  scanPattern: null
}

// ── OPD 예시: PCN교육 TP14-ROOT-L-01.opd 의 셋업 값 (core/opd/normalize 결과와 같은 모양) ──

/** 'OPD · MXU - 4.4R5' 파일 메타 (해시·크기·경로는 쓰는 쪽에서) */
export const OPD_META: NdeFileMeta = {
  ndeVersion: { raw: 'OPD · MXU - 4.4R5', family: 'opd', major: 4, minor: 4, patch: 5, preRelease: null },
  deviceFileName: 'TP14-ROOT-L-##',
  device: { platform: null, model: 'OMNISX-PA1664PR', serialNumber: 'QC-006952', name: null },
  createdAt: '2026-05-20T11:23:13',
  modifiedAt: null,
  application: { name: 'MXU', version: '4.4R5' },
  scenario: null,
  reader: { name: 'opd-structure', version: 4 }
}

/** OPD 플랜 스펙 (읽기 규칙 4 · 스펙 규칙 3): 파일에서 읽은 시편·용접 치수, 이름이 '추정'인 칸은 estimatedFields */
export const OPD_SPEC: ScanPlanSpec = {
  specVersion: 2,
  specimen: {
    shape: 'plate', thicknessMm: 25, outerRadiusMm: null, angularOpeningDeg: null, materialName: 'STEEL, MILD',
    weld: {
      bevelShape: 'V', template: 'VOffset', templateCode: 6, symmetry: 'Symmetric', symmetryCode: 0,
      offsetMm: 1, hazWidthMm: null, weldAngleDeg: null, derivedFillHeightMm: 0,
      hotPass: { heightMm: 23, angleDeg: 30 }, land: { heightMm: 2 }, root: { heightMm: 0, angleDeg: 0 },
      fills: [], upperCap: null, lowerCap: null, materialName: null
    },
    estimatedFields: ['shape', 'materialName', 'weld.template']
  },
  groups: [
    {
      technique: 'PA',
      formation: 'sectorial',
      firstElement: 38,
      aperture: 16,
      elementStep: null,
      refractedAngle: { startDeg: 45, stopDeg: 70, stepDeg: 1 },
      focusing: { mode: null, distanceMm: 25 },
      waveMode: null,
      probes: [
        {
          role: 'pulseEcho',
          probe: { model: '5L64-A32', kind: 'phasedArrayLinear', centralFrequencyMHz: 5, elementCount: 64, pitchMm: 0.5 },
          orientation: 'Normal',
          wedge: { model: 'SA32-N55S', kind: 'angleBeam', wedgeAngleDeg: 36.1 },
          position: { uOffsetMm: 0, vOffsetMm: -40, skewDeg: 90, surface: null }
        }
      ],
      techniqueParams: { dataFormat: 'opd', opdSpecRule: 3, opdShapeCode: 0, opdMaterialCode: 30, opdWaveModeCode: 2 }
    }
  ]
}

export const OPD_FP = 'fp2:mock-opd-tp14-root-l'

export const OPD_SUMMARY = '판재 25 mm · V 개선 · 5L64-A32 · -40 mm · PA 섹터 45–70° · 집속 25 mm · 개선 높이 23+2 mm · OPD'

/** OPD 플랜 이름 끝 (core/import planning: 집속 깊이·개선 모양+핫패스+랜드(+루트, 0 이 아닐 때) + ' · OPD') */
export const OPD_NAME_TAIL = ' · 집속 25 · V개선 23+2 · OPD'

export const OPD_ACQ: AcquisitionSummary = {
  groups: [
    {
      groupName: 'PA 1',
      specGroupIndex: 0,
      gainDb: 33.6,
      referenceGainDb: null,
      velocityMps: 3244.4,
      beamCount: 26,
      digitizingFrequencyMHz: null,
      tcgEnabled: true,
      gates: [
        { name: 'Gate I', startUs: 0.22, lengthUs: 6.78, thresholdPercent: 20, geometry: 'TrueDepth' },
        { name: 'Gate A', startUs: 9.864, lengthUs: 24.042, thresholdPercent: 10, geometry: 'TrueDepth' },
        { name: 'Gate B', startUs: 0.22, lengthUs: 6.78, thresholdPercent: 30, geometry: 'TrueDepth' }
      ],
      scanQuantity: 301,
      scanResolutionMm: 1,
      indexQuantity: null,
      indexResolutionMm: null,
      calibrations: []
    }
  ],
  encoder: { mode: 'Encoder', stepResolutionPerMm: 13.85 },
  scanPattern: null
}

/** OPD 정규화 경고 (core/opd/normalize opdSetupWarnings 와 같은 문구) */
export const OPD_SETUP_WARNINGS = [
  'OPD 는 공개되지 않은 형식이라 파일 구조를 따라 읽었습니다(OmniPC 대조 전).',
  '파일에서 찾지 못해 비워 둔 칸: Fill·HAZ·Upper/Lower Cap, 파 모드, 스캔면, 집속 방식. 추정값으로 채우지 않았습니다.',
  "파일 코드로 정했지만 다른 값 표본이 없어 '추정'으로 둔 칸: 시편 형상(판재 — 코드 0), 재질(STEEL, MILD — 코드 30), 개선 템플릿(V-Offset — 코드 6).",
  '파일 칸이 없어 모든 OPD 플랜에 같은 값으로 둔 칸(추정): 탐촉자 종류(선형 위상배열), 장착 방향(정방향).',
  'Hot Pass·Land·Root의 높이·각도와 Land 오프셋은 파일에서 읽었습니다. Fill·HAZ·Cap 값은 미해독입니다.',
  "기준 이득(Ref)이 0 dB 라 '모름'으로 둡니다."
]

// ── ?mock=many: 사용자 시험 저장소와 같은 9개 플랜 (X3 4개 + Evident 공식 예제 11개) ──
// 두께·탐촉자 주파수·스큐는 실제 파일에서 읽은 값과 같다. 나머지 셋업은 화면 확인용으로 단순화했다.

interface ManyProbe {
  role?: GroupProbeSpec['role']
  model: string
  kind?: ProbeKind
  mhz: number
  skewDeg: number
  vOffsetMm: number
  wedge: string
}

function manyGroup(technique: BeamGroupSpec['technique'], formation: BeamGroupSpec['formation'], probes: ManyProbe[]): BeamGroupSpec {
  return {
    technique,
    formation,
    firstElement: technique === 'PA' ? 0 : null,
    aperture: technique === 'PA' ? 16 : null,
    elementStep: null,
    refractedAngle: technique === 'TFM' ? null : { startDeg: 40, stopDeg: 70, stepDeg: technique === 'PA' ? 1 : null },
    focusing: { mode: null, distanceMm: null },
    waveMode: technique === 'ToFD' ? 'Longitudinal' : 'TransversalVertical',
    probes: probes.map((p) => ({
      role: p.role ?? 'pulseEcho',
      probe: { model: p.model, kind: p.kind ?? 'phasedArrayLinear', centralFrequencyMHz: p.mhz, elementCount: null, pitchMm: null },
      orientation: 'Normal',
      wedge: { model: p.wedge, kind: 'angleBeam', wedgeAngleDeg: null },
      position: { uOffsetMm: 0, vOffsetMm: p.vOffsetMm, skewDeg: p.skewDeg, surface: null }
    })),
    techniqueParams: {}
  }
}

function manySpec(shape: SpecimenShape, thicknessMm: number, groups: BeamGroupSpec[]): ScanPlanSpec {
  return {
    specVersion: 2,
    specimen: {
      shape,
      thicknessMm,
      outerRadiusMm: shape === 'pipe' ? 160 : null,
      angularOpeningDeg: shape === 'pipe' ? 360 : null,
      materialName: 'Steel_Mild',
      weld: null
    },
    groups
  }
}

const PA = (model: string, mhz: number, skewDeg: number, vOffsetMm: number, wedge: string): ManyProbe => ({ model, mhz, skewDeg, vOffsetMm, wedge })
const UT = (model: string, mhz: number, skewDeg: number, vOffsetMm: number, wedge: string): ManyProbe => ({
  model,
  kind: 'conventionalRound',
  mhz,
  skewDeg,
  vOffsetMm,
  wedge
})
const tofd = (model: string, mhz: number, halfPcsMm: number, wedge: string): ManyProbe[] => [
  { ...UT(model, mhz, 90, -halfPcsMm, wedge), role: 'pulser' },
  { ...UT(model, mhz, 270, halfPcsMm, wedge), role: 'receiver' }
]

/** [ID, 스펙, 요약, 원본 파일들] — ID 는 실제 가져오기 순서(X3 → 3.3 → 4.0 → 4.1 → 4.2)와 같다 */
const MANY: Array<[string, ScanPlanSpec, string, string[]]> = [
  ['SP001', X3_SPEC, X3_SUMMARY, []],
  [
    'SP002',
    manySpec('plate', 26, [manyGroup('PA', 'sectorial', [PA('2.25L16-A10', 2.25, 270, 16, 'SA10-N55S 2.25L16')])]),
    '판재 26 mm · V 개선 · 2.25L16-A10 · +16 mm · PA 섹터 30–70°',
    ['3.3/ManualWeldPA.nde', '4.0/ManualWeldPA-4.0.nde']
  ],
  [
    'SP003',
    manySpec('plate', 26, [manyGroup('UT', 'none', [UT('C550', 3.5, 90, -17, 'SPE2-60S-IHC')])]),
    '판재 26 mm · V 개선 · C550 · -17 mm · UT 60°',
    ['3.3/ManualWeldUT.nde']
  ],
  [
    'SP004',
    manySpec('plate', 12.5, [0, 1, 2, 3].map(() => manyGroup('TFM', 'none', [PA('5L64-A32', 5, 90, -10, 'SA32-N55S')]))),
    '판재 12.5 mm · V 개선 · 5L64-A32 · -10 mm · TFM T-T/TT-T/TT-TT/TT-TTT',
    ['4.1/Weld_Plate_4TFM_sk90-4.1.nde', '4.2/Weld_Plate_4TFM_sk90-4.2.nde']
  ],
  [
    'SP005',
    manySpec('plate', 11, [manyGroup('UT', 'none', [UT('C540', 2.25, 90, -10, 'ABSA-5T-45')])]),
    '판재 11 mm · V 개선 · C540 · -10 mm · UT 45°',
    ['4.1/Weld_Plate_UT-sk90-4.1.nde', '4.2/Weld_Plate_UT-sk90-4.2.nde']
  ],
  [
    'SP006',
    manySpec('pipe', 6.2, [
      manyGroup('PA', 'sectorial', [PA('5L32-A31', 5, 270, 3.9, 'SA31-N55S')]),
      manyGroup('PA', 'sectorial', [PA('5L32-A31', 5, 90, -3.9, 'SA31-N55S')]),
      manyGroup('ToFD', 'none', tofd('C563', 10, 3, 'ST1-70L-IHC'))
    ]),
    '배관 OD 320 mm · 6.2 mm · V 개선 · 5L32-A31 ×2 + C563 ×2 · ±3.9/±3 mm · PA 섹터 40–70° + ToFD',
    ['4.2/Weld_COD_2PA-ToFD-4.2.nde']
  ],
  [
    'SP007',
    manySpec('plate', 12.5, [0, 1].map(() => manyGroup('PA', 'compound', [PA('5L64-A32', 5, 90, -10, 'SA32-N55S')]))),
    '판재 12.5 mm · V 개선 · 5L64-A32 · -10 mm · PA 복합 40–70°',
    ['4.2/Weld_Plate_PA-Comp_sk90-2gr-4.2.nde']
  ],
  ['SP008', PLATE42_SPEC, PLATE42_SUMMARY, ['4.2/Weld_Plate_PA-Sect_sk90-4.2.nde']],
  [
    'SP009',
    manySpec('pipe', 10, [manyGroup('ToFD', 'none', tofd('C563', 10, 9.4, 'ST1-70L'))]),
    '배관 OD 300 mm · 10 mm · V 개선 · C563 ×2 · ±9.4 mm · ToFD',
    ['4.2/Weld_Plate_ToFD_Parallel-4.2.nde']
  ]
]

const MANY_SOURCE_DIR = 'D:/PAUT/예제'
const MANY_BATCH = 'IMP-20261006-090000-e5f6'
const MANY_T = '2026-10-06T09:00:00+09:00'
const MANY_BYTES = 6_300_000

function manyAcq(spec: ScanPlanSpec): AcquisitionSummary {
  return { ...PLATE42_ACQ, groups: spec.groups.map((_, i) => ({ ...PLATE42_ACQ.groups[0]!, groupName: `GR-${i + 1}`, specGroupIndex: i })) }
}

/** 시편 ID: 공식 예제 파일 이름 (확장자·버전 꼬리 제외) */
const manySpecimenId = (rel: string): string => (rel.split('/').pop() ?? rel).replace(/(-\d\.\d)?\.nde$/i, '')

export function seedManyPlans(): ScanPlan[] {
  const files = seedManyFiles()
  // 실제 가져오기(core/import/planning.ts)처럼 같은 이름이면 ' (2)' 를 붙인다 (SP004·SP007)
  const taken: string[] = []
  return MANY.map(([id, spec, summary]) => {
    const own = files.filter((f) => f.planId === id)
    const t = id === 'SP001' ? T0 : MANY_T
    const name = uniquePlanName(planNameFrom(spec), taken)
    taken.push(name)
    return {
      id,
      name,
      note: '',
      fingerprint: `fp2:mock-many-${id}`,
      spec,
      summary,
      createdAt: t,
      updatedAt: t,
      fileCount: own.length,
      specimenCount: new Set(own.map((f) => f.specimenId)).size,
      totalBytes: own.reduce((s, f) => s + f.meta.sizeBytes, 0),
      lastImportedAt: t
    }
  })
}

export function seedManyFiles(): FileRecord[] {
  const x3 = seedFiles().filter((f) => f.planId === 'SP001')
  const template = seedFiles().find((f) => f.planId === 'SP002')!
  const rest = MANY.flatMap(([planId, spec, , rels]) => rels.map((rel) => ({ planId, spec, rel })))
  return [
    ...x3,
    ...rest.map(({ planId, spec, rel }, i): FileRecord => {
      const fileName = rel.split('/').pop() ?? rel
      const specimenId = manySpecimenId(rel)
      return {
        ...template,
        id: x3.length + i + 1,
        planId,
        specimenId,
        storedRelPath: `스캔플랜/${planId}/${specimenId}/${fileName}`,
        storedFileName: fileName,
        meta: {
          ...template.meta,
          sha256: `ef${String(i).padStart(2, '0')}`.repeat(16),
          sizeBytes: MANY_BYTES + i * 1_000_000,
          sourcePath: `${MANY_SOURCE_DIR}/${rel}`,
          sourceFileName: fileName
        },
        acquisition: manyAcq(spec),
        importBatchId: MANY_BATCH,
        importedAt: MANY_T
      }
    })
  ]
}

export function seedManySpecimens(): Specimen[] {
  const x3 = seedSpecimens().filter((s) => s.source === 'device-filename')
  const ids = [...new Set(MANY.flatMap(([, , , rels]) => rels.map(manySpecimenId)))]
  return [...x3, ...ids.map((id) => ({ id, displayName: id, source: 'filename' as const, note: '', createdAt: MANY_T }))]
}

export function seedManyHistory(): ImportHistoryEntry[] {
  const rest = seedManyFiles().filter((f) => f.importBatchId === MANY_BATCH)
  return [
    {
      batchId: MANY_BATCH,
      startedAt: MANY_T,
      finishedAt: '2026-10-06T09:00:12+09:00',
      status: 'completed',
      inputPaths: [MANY_SOURCE_DIR],
      totalItems: rest.length,
      copiedCount: rest.length,
      skippedCount: 0,
      failedCount: 0,
      createdPlanIds: MANY.map(([id]) => id).filter((id) => id !== 'SP001'),
      totalBytes: rest.reduce((s, f) => s + f.meta.sizeBytes, 0)
    },
    seedHistory()[1]!
  ]
}
