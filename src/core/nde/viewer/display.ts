/**
 * 파일에 저장된 장비 화면 상태 (비공개 MXU ModelSetup XML) 중 이미지 보기에 쓰는 값만 골라 읽는다.
 * 문서 없는 형식이라 모두 선택 사항: 못 읽으면 기본값을 쓰고 경고만 남긴다. 새 의존성 없이 정규식으로 읽는다(read.ts SaveFileName 과 같은 방식).
 *   - 진폭 색표: 3.x `PalettesSetup/AmplitudePalettes/MainColors`, 4.x `PalettesSetup/Amplitude/MainColors` (256색) + SpecialColors
 *   - 그룹별 현재 빔: `GroupSetup` 의 `ID`·`UserName`·`CurrentContextID`
 *   - `CurrentLayout`, `LayoutGroupMode`, `CurrentGroupID`, `IsCScanReversed`
 *   - (2026-10-07, OmniPC 설정 읽기) 그룹별 측정값 목록 `ReadingSetup`(L1), 덮개 종류 `Specimen/{Plate|Pipe}/Weld/WeldTemplateType`(L7),
 *     저장 앱 `SoftwareInformation`·장비 `HardwareInformation/PlatformId`(L6)
 * `GroupSetup/ID`·`CurrentGroupID` 는 셋업 그룹 id 가 아니라 MXU 화면 그룹 번호(0부터, 데이터 없는 캡처 그룹은 빠짐)다.
 * 셋업 그룹과의 대응은 meta.ts buildViewerInfo 가 이름 → 순서로 맞춘다.
 *
 * 비공개 BusinessSetup XML(장비 설정 원본)도 같은 방식으로 몇 칸만 읽는다(parseBusinessSetup): 그룹별 SoftGain(L4)·기준 이득 켜짐(X2)·
 * 첫 빔 게이트 켜짐·피크 방식(L5), 탐촉자별 Scan/Index·분석 오프셋(X7). 칸 뜻은 OmniPC_조사/4_NDE설정.md 5절(우리 데이터 파일 값)과
 * 공개 설명서로만 정했다. XML 진폭 값(문턱·기준 진폭)은 JSON 의 100/PercentageMode 배라 읽지 않는다(JSON 값을 쓴다).
 */
import { DEFAULT_AMPLITUDE_PALETTE, DEFAULT_SPECIAL_COLORS, isHexColor } from '@shared/imaging/palette'
import type { ViewerDisplay, ViewerProbePositioning } from '@shared/imaging/types'

/** ModelSetup 의 GroupSetup 하나 (MXU 화면 그룹) */
export interface GroupSetupRef {
  /** MXU 화면 그룹 번호 (`GroupSetup/ID`) — 셋업 그룹 id 아님 */
  mxuId: number | null
  /** 화면 그룹 이름 (`UserName`) — 보통 셋업 그룹 이름과 같다 */
  userName: string | null
  /** 처음 보일 빔 번호 (`CurrentContextID`) */
  contextId: number | null
}

/** GroupSetup 하나의 덧붙임 (groupSetups 와 같은 순서) */
export interface GroupSetupExtra {
  /** 저장된 측정값 키 (목록 ① + 목록 ② 순서). ReadingSetup 이 없으면 null */
  readings: string[] | null
  /** `ReadingListId` */
  readingListId: number | null
}

/** 파일 단위 ModelSetup 값 (L6·L7) */
export interface ModelSetupFileRef {
  /** `Specimen/{Plate|Pipe|…}/Weld/WeldTemplateType` ('VOffset', 'Erw' …) */
  weldTemplate: string | null
  /** 마지막으로 저장한 장비 앱 `SoftwareInformation/{ApplicationId, FullSoftwareVersion}` */
  software: { applicationId: string | null; version: string | null } | null
  /** `HardwareInformation/PlatformId` ('MX3', 'X4') */
  platformId: string | null
}

export interface ParsedDisplay {
  /** currentGroupId 는 여기서 채우지 않는다 (셋업 그룹과 맞춘 뒤 buildViewerInfo 가 채움) */
  display: ViewerDisplay
  groupSetups: GroupSetupRef[]
  /** `CurrentGroupID` 원래 값 (MXU 화면 그룹 번호) */
  currentMxuGroupId: number | null
  warnings: string[]
  /** groupSetups 와 같은 순서의 측정값 목록 등 (L1) */
  groupExtras: GroupSetupExtra[]
  /** 덮개 종류·저장 앱·장비 (L6·L7) */
  file: ModelSetupFileRef
}

export function defaultDisplay(): ViewerDisplay {
  return {
    palette: [...DEFAULT_AMPLITUDE_PALETTE],
    specialColors: [...DEFAULT_SPECIAL_COLORS],
    paletteSource: 'default',
    layout: null,
    layoutGroupMode: null,
    currentGroupId: null,
    cscanReversed: false
  }
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)
  return m ? m[1]!.trim() : null
}

function intTag(xml: string, name: string): number | null {
  const v = tag(xml, name)
  return v !== null && /^-?\d+$/.test(v) ? Number(v) : null
}

function strings(block: string): string[] {
  return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]!.trim().toLowerCase())
}

const EMPTY_FILE_REF: ModelSetupFileRef = { weldTemplate: null, software: null, platformId: null }

/** `<ReadingSetup>` 안 `ArrayOfReadingType` 묶음들을 이어 붙인 키 목록 (없으면 null) */
function readingKeys(block: string): { keys: string[] | null; listId: number | null } {
  const rs = /<ReadingSetup>([\s\S]*?)<\/ReadingSetup>/.exec(block)?.[1]
  if (rs === undefined) return { keys: null, listId: null }
  const keys = [...rs.matchAll(/<ReadingType>([^<]*)<\/ReadingType>/g)].map((m) => m[1]!.trim()).filter((k) => k.length > 0)
  return { keys, listId: intTag(rs, 'ReadingListId') }
}

function modelSetupFileRef(xml: string): ModelSetupFileRef {
  const sw = /<SoftwareInformation>([\s\S]*?)<\/SoftwareInformation>/.exec(xml)?.[1]
  const specimen = /<Specimen>([\s\S]*?)<\/Specimen>/.exec(xml)?.[1]
  const weld = specimen === undefined ? undefined : /<Weld>([\s\S]*?)<\/Weld>/.exec(specimen)?.[1]
  return {
    weldTemplate: weld === undefined ? null : tag(weld, 'WeldTemplateType') || null,
    software: sw === undefined ? null : { applicationId: tag(sw, 'ApplicationId') || null, version: tag(sw, 'FullSoftwareVersion') || null },
    platformId: tag(/<HardwareInformation>([\s\S]*?)<\/HardwareInformation>/.exec(xml)?.[1] ?? '', 'PlatformId') || null
  }
}

export function parseModelSetup(xml: string | null): ParsedDisplay {
  const display = defaultDisplay()
  const groupSetups: GroupSetupRef[] = []
  const groupExtras: GroupSetupExtra[] = []
  const warnings: string[] = []
  if (!xml) return { display, groupSetups, currentMxuGroupId: null, warnings, groupExtras, file: { ...EMPTY_FILE_REF } }

  const pal = /<(?:AmplitudePalettes|Amplitude)>\s*<MainColors>([\s\S]*?)<\/MainColors>\s*(?:<SpecialColors>([\s\S]*?)<\/SpecialColors>)?/.exec(xml)
  if (pal) {
    const main = strings(pal[1]!)
    const special = pal[2] ? strings(pal[2]) : []
    if (main.length === 256 && main.every(isHexColor)) {
      display.palette = main
      display.paletteSource = 'file'
      if (special.length >= 3 && special.every(isHexColor)) display.specialColors = special
    } else {
      warnings.push(`파일의 진폭 색표가 256색이 아니어서(${main.length}색) 기본 색표를 씁니다.`)
    }
  }

  for (const m of xml.matchAll(/<GroupSetup>([\s\S]*?)<\/GroupSetup>/g)) {
    const block = m[1]!
    const ref: GroupSetupRef = { mxuId: intTag(block, 'ID'), userName: tag(block, 'UserName'), contextId: intTag(block, 'CurrentContextID') }
    groupSetups.push(ref)
    const r = readingKeys(block)
    groupExtras.push({ readings: r.keys, readingListId: r.listId })
    const zoom = /<PaletteType>Amplitude<\/PaletteType>\s*<Zoom>([^<]*)<\/Zoom>\s*<Pan>([^<]*)<\/Pan>/.exec(block)
    if (zoom && (Number(zoom[1]) !== 1 || Number(zoom[2]) !== 0.5)) {
      warnings.push(`그룹 ${ref.userName ?? ref.mxuId ?? '?'} 의 색표 확대 설정(Zoom ${zoom[1]}, Pan ${zoom[2]})은 아직 반영하지 않습니다.`)
    }
  }

  display.layout = tag(xml, 'CurrentLayout')
  display.layoutGroupMode = tag(xml, 'LayoutGroupMode')
  display.cscanReversed = tag(xml, 'IsCScanReversed') === 'true'
  return { display, groupSetups, currentMxuGroupId: intTag(xml, 'CurrentGroupID'), warnings, groupExtras, file: modelSetupFileRef(xml) }
}

// ──────────────────────────────── BusinessSetup (장비 설정 원본) ────────────────────────────────

/** 첫 빔(ContextSetup)의 GateSetup 하나 */
export interface BusinessGateRef {
  /** 게이트 번호 (0 = I, 1 = A, 2 = B — 셋업 JSON gates[].id 와 같은 번호) */
  id: number | null
  /** `IsEnabled` */
  enabled: boolean | null
  /** `EventType` ('Peak' | 'Crossing') */
  eventType: string | null
  /** `PeakType` ('Highest' …) */
  peakType: string | null
}

/** ContextGroupSetup 하나 (그룹) */
export interface BusinessGroupRef {
  /** `ContextGroupSetup/ID` — ModelSetup GroupSetup/ID(MXU 화면 그룹 번호)와 같은 번호로 본다 [추정: X3·4.2 COD·X4 TF_L 의 순서·이름이 맞음] */
  id: number | null
  /** `HasAReferenceGain` */
  hasReferenceGain: boolean | null
  /** `SoftGain` (dB) */
  softGainDb: number | null
  /** `ConnectorIdentifier` — 탐촉자 묶음 `Identifier` 와 같은 번호 */
  connectorId: number | null
  /** 첫 빔의 게이트들 (빔마다 같은 켜짐·피크 방식으로 본다) */
  gates: BusinessGateRef[]
}

/** 탐촉자 묶음 하나 (PA `PhasedArrayProbeAssemblySetup` / UT `ConventionalProbeAssemblySetup`) */
export interface BusinessAssemblyRef {
  id: number | null
  /** 송신(Pulser) 쪽 위치 */
  pulser: ViewerProbePositioning | null
  /** 수신(Receiver) 쪽 위치 (ToFD 는 송신과 다름) */
  receiver: ViewerProbePositioning | null
}

export interface ParsedBusiness {
  groups: BusinessGroupRef[]
  assemblies: BusinessAssemblyRef[]
}

function numTag(xml: string, name: string): number | null {
  const v = tag(xml, name)
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function boolTag(xml: string, name: string): boolean | null {
  const v = tag(xml, name)
  return v === 'true' ? true : v === 'false' ? false : null
}

/** m → mm, 부동소수 꼬리 정리 (meta.ts mm() 와 같은 규칙) */
const mmOf = (m: number | null): number | null => (m === null ? null : Math.round(m * 1000 * 1e6) / 1e6)

function positioning(block: string | undefined, reference: string | null): ViewerProbePositioning | null {
  if (block === undefined) return null
  return {
    scanOffsetMm: mmOf(numTag(block, 'ScanOffset')),
    indexOffsetMm: mmOf(numTag(block, 'IndexOffset')),
    analysisScanOffsetMm: mmOf(numTag(block, 'AnalysisScanOffset')),
    analysisIndexOffsetMm: mmOf(numTag(block, 'AnalysisIndexOffset')),
    reference
  }
}

/**
 * 비공개 BusinessSetup XML 에서 이미지 보기에 쓰는 몇 칸만 (없거나 못 읽으면 빈 목록).
 * FMC(TFM) 묶음의 ContextGroupSetup 은 PA·UT 그룹과 번호가 겹칠 수 있어 뺀다.
 */
export function parseBusinessSetup(xml: string | null): ParsedBusiness {
  if (!xml) return { groups: [], assemblies: [] }
  const body = xml.replace(/<FullMatrixCaptureTechnology>[\s\S]*?<\/FullMatrixCaptureTechnology>/g, '')
  const groups: BusinessGroupRef[] = []
  for (const m of body.matchAll(/<ContextGroupSetup>([\s\S]*?)<\/ContextGroupSetup>/g)) {
    const block = m[1]!
    // 그룹 칸(ID·Gain·SoftGain…)은 ContextSetups 앞에 있다 — 빔마다의 같은 이름 칸을 잘못 읽지 않게 앞부분만 본다
    const cut = block.indexOf('<ContextSetups>')
    const head = cut >= 0 ? block.slice(0, cut) : block
    const firstGates = /<GateSetups>([\s\S]*?)<\/GateSetups>/.exec(cut >= 0 ? block.slice(cut) : '')?.[1] ?? ''
    const gates: BusinessGateRef[] = [...firstGates.matchAll(/<GateSetup>([\s\S]*?)<\/GateSetup>/g)].map((g) => ({
      id: intTag(g[1]!, 'ID'),
      enabled: boolTag(g[1]!, 'IsEnabled'),
      eventType: tag(g[1]!, 'EventType') || null,
      peakType: tag(g[1]!, 'PeakType') || null
    }))
    groups.push({
      id: intTag(head, 'ID'),
      hasReferenceGain: boolTag(head, 'HasAReferenceGain'),
      softGainDb: numTag(head, 'SoftGain'),
      connectorId: intTag(head, 'ConnectorIdentifier'),
      gates
    })
  }
  const assemblies: BusinessAssemblyRef[] = []
  for (const m of body.matchAll(/<(PhasedArrayProbeAssemblySetup|ConventionalProbeAssemblySetup)>([\s\S]*?)<\/\1>/g)) {
    const block = m[2]!
    const id = /^\s*<Identifier>(-?\d+)<\/Identifier>/.exec(block)?.[1]
    const reference = tag(block, 'ProbeOffsetReference') || null
    assemblies.push({
      id: id === undefined ? null : Number(id),
      pulser: positioning(/<PulserPositioningSetup>([\s\S]*?)<\/PulserPositioningSetup>/.exec(block)?.[1], reference),
      receiver: positioning(/<ReceiverPositioningSetup>([\s\S]*?)<\/ReceiverPositioningSetup>/.exec(block)?.[1], reference)
    })
  }
  return { groups, assemblies }
}
