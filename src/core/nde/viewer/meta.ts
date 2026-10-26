/**
 * 셋업 JSON → 이미지 보기용 그룹 정보 (진폭 위치·축·빔·게이트·시편).
 * 3.x 와 4.x 를 같은 모양(ViewerGroup)으로 옮긴다. Beam 저장 방식의 빔 축 값은 진폭 차원(dimensions[1].beams)의 것을 쓴다
 * (3.x paut.beams[].skewAngle 은 0 으로 저장되어 쓰면 안 됨 — 조사_기록.md 1절).
 * Paintbrush 의 0° 리니어 격자는 paintbrush.ts 에서 저장 U/V 좌표를 직접 읽는다.
 */
import type {
  AmplitudeScale,
  RefBasis,
  ViewerAppStamp,
  ViewerProbePositioning,
  ViewerBeam,
  ViewerDisplay,
  ViewerFileInfo,
  ViewerFileSource,
  ViewerFormatFamily,
  ViewerGate,
  ViewerGroup,
  ViewerReadingSetup,
  ViewerSpecimen,
  ViewerTechnique,
  ViewerWeld
} from '@shared/imaging/types'
import { skewSign } from '@shared/imaging/coords'
import { refPctFromSetup } from '@shared/labels/levels'
import { byId, int, num, obj, objs, str, type Json } from '../json'
import { adaptGroups3, adaptGroups4, findDataMapping, mappingSpecimenId, type AcqGroup } from '../normalize/adapt'
import { pickSpecimen, SHAPES } from '../normalize/specimen'
import type { FileProps } from '../read'
import type { BusinessAssemblyRef, BusinessGroupRef, GroupSetupExtra, GroupSetupRef, ModelSetupFileRef, ParsedBusiness } from './display'
import { paintbrushMapping } from './paintbrush'

/** 그룹 하나의 진폭이 이보다 크면 아직 열지 않는다 (계획 결정 8) */
export const VIEWER_MAX_GROUP_BYTES = 200 * 1024 * 1024

/** 파일에서 확인한 데이터셋 모양 (없으면 null) */
export interface DatasetProbe {
  shape: number[]
  /** h5wasm metadata: type 0 = 정수 */
  type: number
  size: number
  signed: boolean
}

export type DatasetLookup = (path: string) => DatasetProbe | null

const M = 1000 // m → mm
const US = 1e6 // s → µs

/** m → mm, 부동소수 꼬리 정리 (0.026 m → 26.000000000000004 방지) */
function mm(m: number): number {
  return Math.round(m * M * 1e6) / 1e6
}

/** 그리는 PA 기법 — 셋 다 같은 S-scan 규칙(빔마다 자기 출사점에서 같은 음로, 이웃 두 빔을 각도차 φ 로 섞음) */
type DrawnTechnique = 'pa-sectorial' | 'pa-linear' | 'pa-compound'

function isDrawn(t: ViewerTechnique): t is DrawnTechnique {
  return t === 'pa-sectorial' || t === 'pa-linear' || t === 'pa-compound'
}

/**
 * 기하를 검증한 (형식, 기법, 스큐) — 이것만 verified. 열쇠 = '기법:스큐' ('기법:*' = 스큐와 무관).
 * 근거는 OmniPC 6.6 화면 대조가 기본이고, 4.x 섹토리얼 스큐 90 만 '검증 그룹 교차 대조'다(아래).
 *   - 3.x 섹토리얼: X3 12T-SV-01 (tests/omnipc.test.ts)
 *   - 4.x 컴파운드·리니어: OmniScan X4 TF_01_C_L_0001 GR-1 · TF_01_L_0001 GR-2 (tests/omnipcTf.test.ts, 2026-10-06).
 *     허용오차 ±0.5 mm 안에서 실측: S-scan 첫·끝 빔 경계 수직 거리 ≤ 0.13 mm, S-scan 범위 ≤ 0.25 mm, 게이트 A 빨간 점선 ≤ 0.07 mm,
 *     A-scan 깊이축 ≤ 0.04 mm, A% (스캔 0·빔 0) 2.61 / 3.27 (화면 2.6 / 3.3), C-scan 축 끝 ≤ 0.04 칸, C-scan 무늬 상관 0.999,
 *     S-scan 시작·끝 톱니 경계 픽셀 차이 1 % 안팎
 *   - 4.x 섹토리얼 스큐 90 (2026-10-26, AI 개발 플랜 T3 — 기본값, 사용자 확인 대기): OmniPC 캡처가 아니라 검증 그룹 교차 대조.
 *     TF_01_L_0001 GR-1(45~70° 26빔): 장비 TrueDepth 게이트 시작 깊이가 26빔 모두 0.01 mm 안, 같은 파일 리니어 60°(GR-2, 대조 완료)와
 *     같은 광선 에코 시각 0.04 µs(음로 0.06 mm)·같은 에코 앱 좌표 ΔV −0.36 / Δ깊이 +0.02 mm (그 가운데 약 0.29 mm 는 그룹 음속 설정 차).
 *     기하 함수(beamsOf·S-scan 조회표)는 대조를 마친 3.x 섹토리얼·4.x 컴파운드와 같다. 근거: 계획_AI개발/T3_섹토리얼_교차검증.md.
 *     스큐 270 은 R 파일로 확인 전이라 올리지 않는다. 실물 기준 반사체(SDH)·OmniPC GR-1 캡처 대조는 남은 일.
 *   - OPD 는 빈 표로 시작한다(OPD_조사/판단.md 3.2). 출사점 V 를 '인덱스 오프셋 ± 출사점 X' 로 계산하는데 스큐 270 의 부호가 추정이라
 *     스큐마다 따로 올린다(예: 'pa-sectorial:90'). 진폭 눈금(캡처 O1·O2)·헤더 값(O9)이 정해지고 tests/omnipcOpd.test.ts 가
 *     통과한 조합만 올린다 — 화면 2장이 맞은 지금도 올리지 않는다(A% 가 화면마다 한 점, C-scan 색 차이가 풀리지 않음).
 */
const VERIFIED: Readonly<Record<ViewerFormatFamily, ReadonlySet<string>>> = {
  '3.x': new Set(['pa-sectorial:*']),
  '4.x': new Set(['pa-compound:*', 'pa-linear:*', 'pa-sectorial:90']),
  opd: new Set<string>()
}

/** 대조 표에 올라 있는 열쇠 (테스트·문서용) */
export function verifiedKinds(family: ViewerFormatFamily): string[] {
  return [...VERIFIED[family]].sort()
}

/** (형식, 기법, 스큐)가 OmniPC 화면과 대조를 마친 조합인지. skewDeg 는 그룹 빔의 스큐(한 그룹은 한 방향) */
export function isVerifiedKind(family: ViewerFormatFamily, technique: ViewerTechnique, skewDeg: number | null): boolean {
  const table = VERIFIED[family]
  if (table.has(`${technique}:*`)) return true
  return skewDeg !== null && Number.isFinite(skewDeg) && table.has(`${technique}:${Math.round(skewDeg)}`)
}

const REASON: Record<Exclude<ViewerTechnique, DrawnTechnique>, string> = {
  ut: '단일 UT 그룹은 아직 그리지 않습니다.',
  tofd: 'ToFD 그룹은 아직 그리지 않습니다.',
  tfm: 'TFM 그룹은 아직 그리지 않습니다.',
  other: '이 기법은 아직 그리지 않습니다.'
}

function technique(g: AcqGroup): ViewerTechnique {
  if (g.kind === 'pa') {
    const pe = obj(g.body['pulseEcho'])
    if (!pe) return 'other'
    if (obj(pe['sectorialFormation'])) return 'pa-sectorial'
    if (obj(pe['linearFormation'])) return 'pa-linear'
    if (obj(pe['compoundFormation'])) return 'pa-compound'
    return 'other'
  }
  if (g.kind === 'ut') return obj(g.body['tofd']) ? 'tofd' : 'ut'
  if (g.kind === 'tfm' || g.kind === 'capture') return 'tfm'
  return 'other'
}

interface AmpDescriptor {
  path: string | null
  statusPath: string | null
  dims: Json[]
  scale: AmplitudeScale
  rawMin: number
}

function ampDescriptor(raw: Json, family: '3.x' | '4.x'): AmpDescriptor | null {
  if (family === '3.x') {
    const ascan = obj(obj(raw['dataset'])?.['ascan'])
    const amp = obj(ascan?.['amplitude'])
    if (!amp) return null
    const sampling = obj(amp['dataSampling'])
    const value = obj(amp['dataValue'])
    return {
      path: str(amp['path']),
      statusPath: str(obj(ascan?.['status'])?.['path']),
      dims: objs(amp['dimensions']),
      scale: { rawMax: num(sampling?.['max']) ?? 32767, unitMax: num(value?.['max']) ?? 200 },
      rawMin: num(sampling?.['min']) ?? 0
    }
  }
  const sets = objs(raw['datasets'])
  const amp = sets.find((d) => d['dataClass'] === 'AScanAmplitude')
  if (!amp) return null
  const value = obj(amp['dataValue'])
  return {
    path: str(amp['path']),
    statusPath: str(sets.find((d) => d['dataClass'] === 'AScanStatus')?.['path']),
    dims: objs(amp['dimensions']),
    scale: { rawMax: num(value?.['max']) ?? 32767, unitMax: num(value?.['unitMax']) ?? 200 },
    rawMin: num(value?.['min']) ?? 0
  }
}

function beamsOf(dim: Json | undefined): ViewerBeam[] {
  return objs(dim?.['beams']).map((b, index) => ({
    index,
    angleDeg: num(b['refractedAngle']) ?? 0,
    skewDeg: num(b['skewAngle']) ?? 0,
    velocityMps: num(b['velocity']) ?? 0,
    uOffsetMm: (num(b['uCoordinateOffset']) ?? 0) * M,
    vOffsetMm: (num(b['vCoordinateOffset']) ?? 0) * M,
    t0Us: (num(b['ultrasoundOffset']) ?? 0) * US
  }))
}

/** 4.x: 그룹 processes[].outputs[] 중 C-scan 출력(dataClass 'CScan…')이 가리키는 게이트 id */
function cscanOutputGateIds4(raw: Json): Set<number> {
  const out = new Set<number>()
  for (const p of objs(raw['processes'])) {
    for (const o of objs(p['outputs'])) {
      if (!/^CScan/i.test(str(o['dataClass']) ?? '')) continue
      const gid = int(obj(o['parameters'])?.['gateId'])
      if (gid !== null) out.add(gid)
    }
  }
  return out
}

function gatesOf(body: Json, nb: number, cscanIds4: Set<number>): ViewerGate[] {
  return objs(body['gates']).map((g, i) => {
    const starts = Array.isArray(g['starts']) ? (g['starts'] as unknown[]) : [g['start']]
    const lengths = Array.isArray(g['lengths']) ? (g['lengths'] as unknown[]) : [g['length']]
    const toUs = (v: unknown): number => (num(v) ?? 0) * US
    const sync = str(obj(g['synchronization'])?.['mode']) ?? 'Pulse'
    const startUs = starts.map(toUs)
    const lengthUs = lengths.map(toUs)
    const perBeamOk = (a: number[]): boolean => a.length === 1 || a.length === nb
    const id = int(g['id']) ?? i
    return {
      id,
      name: str(g['name']) ?? `Gate ${i}`,
      geometry: str(g['geometry']) ?? 'SoundPath',
      sync,
      startUs,
      lengthUs,
      thresholdPct: num(g['threshold']),
      supported: sync === 'Pulse' && startUs.length > 0 && perBeamOk(startUs) && perBeamOk(lengthUs),
      producesCscan: g['produceCscanData'] === true || cscanIds4.has(id)
    }
  })
}

function cscanGate(gates: ViewerGate[], body: Json): number | null {
  const ok = gates.filter((g) => g.supported)
  const byName = ok.find((g) => /gate\s*a\b/i.test(g.name))
  if (byName) return byName.id
  const produce = objs(body['gates']).find((g) => g['produceCscanData'] === true)
  const pid = int(produce?.['id'])
  if (pid !== null && ok.some((g) => g.id === pid)) return pid
  return ok.find((g) => g.id === 1)?.id ?? null
}

function cap(v: unknown): ViewerWeld['upperCap'] {
  const o = obj(v)
  const w = num(o?.['width'])
  const h = num(o?.['height'])
  return o && w !== null && h !== null && (w > 0 || h > 0) ? { widthMm: mm(w), heightMm: mm(h) } : null
}

function angled(v: unknown): { angleDeg: number; heightMm: number } | null {
  const o = obj(v)
  if (!o) return null
  return { angleDeg: num(o['angle']) ?? 0, heightMm: mm(num(o['height']) ?? 0) }
}

function specimenOf(setup: Json, specimenId: number | null): ViewerSpecimen {
  const sp = pickSpecimen(setup, specimenId)
  const found = sp ? SHAPES.find(([k]) => obj(sp[k]) !== null) : undefined
  const key = found?.[1]
  const shape: ViewerSpecimen['shape'] = key === undefined || key === 'unknown' ? 'unspecified' : key
  // 두께는 판·배관·봉 형상에서만 읽는다
  const t = found && shape !== 'unspecified' ? num(obj(sp?.[found[0]])?.['thickness']) : null
  const w = obj(sp?.['weldGeometry'])
  const weld: ViewerWeld | null = w
    ? {
        bevelShape: str(w['bevelShape']) ?? 'Unknown',
        symmetry: str(w['symmetry']),
        offsetMm: mm(num(w['offset']) ?? 0),
        landHeightMm: mm(num(obj(w['land'])?.['height']) ?? 0),
        hotPass: angled(w['hotPass']),
        fills: objs(w['fills'])
          .map((f) => angled(f))
          .filter((f): f is { angleDeg: number; heightMm: number } => f !== null && f.heightMm > 0),
        root: angled(w['root']),
        upperCap: cap(w['upperCap']),
        lowerCap: cap(w['lowerCap']),
        hazWidthMm: num(w['heatAffectedZoneWidth']) === null ? null : mm(num(w['heatAffectedZoneWidth'])!),
        weldAngleDeg: num(w['weldAngle']) ?? 0
      }
    : null
  return {
    shape,
    thicknessMm: t === null ? null : mm(t),
    weld
  }
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0)
}

/**
 * 리니어·컴파운드 빔 배치 점검. S-scan 조회표(sscan.ts)는 빔을 (굴절각, s·출사점 V) 순서로 놓고 그 순서에서
 * φ_b = atan2(s·(V − V_b), 깊이) − θ_b 가 단조 감소한다고 보고 이분 탐색한다. 굴절각이 커지는데 출사점이 반대(−s)로 물러나면
 * 표면 가까이에서 φ 순서가 뒤집혀 빔 쌍을 잘못 고를 수 있어 막는다. 같은 각도·같은 출사점 빔이 둘이면 사이를 섞을 수 없다.
 * 섹토리얼은 기존 그림(OmniPC 대조 완료)을 그대로 두려고 이 점검을 하지 않는다.
 */
export function beamOrderProblem(beams: ViewerBeam[]): string | null {
  const key = beams.map((b) => ({ th: b.angleDeg, sv: (skewSign(b.skewDeg) ?? 1) * b.vOffsetMm }))
  const order = key.map((_, i) => i).sort((a, b) => key[a]!.th - key[b]!.th || key[a]!.sv - key[b]!.sv)
  for (let k = 1; k < order.length; k++) {
    const p = key[order[k - 1]!]!
    const q = key[order[k]!]!
    if (q.th === p.th && Math.abs(q.sv - p.sv) < 1e-6) return '같은 굴절각·같은 출사점의 빔이 겹쳐 있어 아직 그리지 않습니다.'
    if (q.sv < p.sv - 1e-6) return '굴절각이 커질 때 출사점이 반대로 움직이는 빔 배치는 아직 그리지 않습니다.'
  }
  return null
}

/** 빈 축 (그릴 수 없는 그룹용) */
const EMPTY_SCALE: AmplitudeScale = { rawMax: 32767, unitMax: 200 }

function buildGroup(
  setup: Json,
  family: '3.x' | '4.x',
  acq: AcqGroup,
  lookup: DatasetLookup,
  /** 파일 화면 상태의 현재 빔 (CurrentContextID), 없으면 null */
  currentContextId: number | null
): ViewerGroup {
  const id = acq.groupId ?? 0
  const raw = byId(setup['groups'], acq.groupId) ?? {}
  const tech = technique(acq)
  const base: ViewerGroup = {
    id,
    name: acq.name ?? `GR-${id + 1}`,
    technique: tech,
    supported: false,
    reason: null,
    verified: false,
    amplitudePath: null,
    statusPath: null,
    shape: [0, 0, 0],
    bytes: 0,
    ampScale: EMPTY_SCALE,
    scan: { offsetMm: 0, resolutionMm: 1, count: 0 },
    ultrasound: { resolutionUs: 1, count: 0 },
    beams: [],
    gates: [],
    cscanGateId: null,
    initialBeam: 0,
    gainDb: num(acq.body['gain']),
    referenceGainDb: num(acq.body['referenceGain']),
    referenceAmplitudePct: num(acq.body['referenceAmplitude'])
  }
  const fail = (reason: string): ViewerGroup => ({ ...base, reason })
  if (!isDrawn(tech)) return fail(REASON[tech])

  const desc = ampDescriptor(raw, family)
  if (!desc?.path) return fail('진폭 데이터가 없습니다.')
  const [du, dbeam, dus] = desc.dims
  const spatial = family === '4.x' ? paintbrushMapping(setup, raw, acq, lookup) : null
  if (spatial?.reason) return fail(spatial.reason)
  const paintbrush = spatial?.reason === null ? spatial : null
  const beams = paintbrush?.beams ?? beamsOf(dbeam)
  const ns = num(du?.['quantity']) ?? 0
  const nt = num(dus?.['quantity']) ?? 0
  const nb = beams.length
  const mapping = findDataMapping(setup, acq.dataMappingId)
  const gridU = objs(obj(mapping?.['discreteGrid'])?.['dimensions']).find((d) => d['axis'] === 'UCoordinate')
  const scanRes = num(du?.['resolution']) ?? num(gridU?.['resolution']) ?? 0.001
  const g: ViewerGroup = {
    ...base,
    amplitudePath: desc.path,
    statusPath: desc.statusPath,
    shape: [ns, nb, nt],
    bytes: ns * nb * nt * 2,
    ampScale: desc.scale,
    scan: paintbrush?.scan ?? { offsetMm: mm(num(gridU?.['offset']) ?? 0), resolutionMm: mm(scanRes), count: ns },
    ultrasound: { resolutionUs: (num(dus?.['resolution']) ?? 0) * US, count: nt },
    beams,
    gates: gatesOf(acq.body, nb, family === '4.x' ? cscanOutputGateIds4(raw) : new Set())
  }
  if (paintbrush) {
    g.storageMode = 'Paintbrush'
    g.spatialAxis = paintbrush.spatialAxis
  }
  g.cscanGateId = cscanGate(g.gates, acq.body)
  const ctx = currentContextId
  g.initialBeam = ctx !== null && ctx >= 0 && ctx < nb ? ctx : Math.floor(nb / 2)

  const fails = (reason: string): ViewerGroup => ({ ...g, reason })
  if (du?.['axis'] !== 'UCoordinate' || dus?.['axis'] !== 'Ultrasound' || ns < 1 || nt < 2 || !(g.ultrasound.resolutionUs > 0)) {
    return fails('진폭 데이터의 축 구성이 예상과 다릅니다.')
  }
  // S-scan 은 이웃 두 빔 사이를 섞어 그리므로 빔이 둘 이상이어야 한다 (리니어 개구 1개·컴파운드 각도 1개도 여기서 막힘)
  if (nb < 2) return fails('빔이 2개 미만인 그룹은 아직 그리지 않습니다.')
  if (beams.some((b) => skewSign(b.skewDeg) === null)) return fails('스큐 90°/270° 가 아닌 빔은 아직 그리지 않습니다.')
  if (new Set(beams.map((b) => skewSign(b.skewDeg))).size > 1) return fails('한 그룹에 스큐 방향이 섞여 있어 아직 그리지 않습니다.')
  if (beams.some((b) => !(b.velocityMps > 0))) return fails('빔 음속 정보가 없습니다.')
  if (tech !== 'pa-sectorial') {
    const geom = beamOrderProblem(beams)
    if (geom) return fails(geom)
  }
  if (desc.rawMin < 0 || str(acq.body['rectification']) === 'None') return fails('RF(정류하지 않은) 데이터는 아직 그리지 않습니다.')
  const probe = lookup(desc.path)
  if (!probe) return fails('진폭 데이터셋을 파일에서 찾을 수 없습니다.')
  if (probe.type !== 0 || probe.size !== 2 || !probe.signed || probe.shape.join() !== [ns, nb, nt].join()) {
    return fails('진폭 데이터 형식이 예상과 다릅니다(16비트 정수 [스캔, 빔, 샘플] 아님).')
  }
  if (g.bytes > VIEWER_MAX_GROUP_BYTES) return fails(`파일이 커서 아직 볼 수 없습니다(그룹 ${mb(g.bytes)} MB, 한도 ${mb(VIEWER_MAX_GROUP_BYTES)} MB).`)
  const status = desc.statusPath ? lookup(desc.statusPath) : null
  if (status && status.shape.join() !== [ns, nb].join()) g.statusPath = null
  return { ...g, statusPath: status ? g.statusPath : null, supported: true, verified: !paintbrush && isVerifiedKind(family, tech, beams[0]?.skewDeg ?? null) }
}

/**
 * 셋업 그룹(acq 순서) ↔ MXU GroupSetup. GroupSetup/ID 는 MXU 화면 그룹 번호라 셋업 그룹 id 와 다를 수 있다
 * (공식 4.x TFM 예제: 데이터 없는 캡처 그룹 0 이 빠져 셋업 1 'TT' = GroupSetup 0).
 * 1) 이름(UserName)이 양쪽에서 하나씩만 맞으면 그것, 2) 아니면 순서 (mxuId === acq 순번, 이름으로 이미 짝지은 것 제외).
 */
function matchGroupSetups(acq: AcqGroup[], setups: GroupSetupRef[]): Array<GroupSetupRef | null> {
  const byName = acq.map((g) => {
    if (g.name === null || acq.filter((a) => a.name === g.name).length !== 1) return null
    const named = setups.filter((s) => s.userName === g.name)
    return named.length === 1 ? named[0]! : null
  })
  const claimed = new Set(byName.filter((s): s is GroupSetupRef => s !== null))
  return byName.map((s, i) => s ?? setups.find((x) => x.mxuId === i && !claimed.has(x)) ?? null)
}

export function buildViewerInfo(input: {
  setup: Json
  family: '3.x' | '4.x'
  version: string
  lookup: DatasetLookup
  /** parseModelSetup 결과 (currentGroupId 는 여기서 셋업 그룹 id 로 채운다) */
  display: ViewerDisplay
  groupSetups: GroupSetupRef[]
  currentMxuGroupId: number | null
  warnings: string[]
  /** parseModelSetup 의 그룹별 측정값 목록 (groupSetups 와 같은 순서, L1). 없으면 display.readings 를 싣지 않는다 */
  groupExtras?: GroupSetupExtra[]
  /** parseModelSetup 의 파일 단위 값 (덮개 종류 L7·저장 앱 L6) */
  modelFile?: ModelSetupFileRef
  /** parseBusinessSetup 결과 (게이트 켜짐 L5·SoftGain L4·분석 오프셋 X7). 없으면 셋업 JSON 으로 아는 것만 채운다 */
  business?: ParsedBusiness
  /** 파일 속성 (read.ts readSetup) — 있으면 출처(L6)를 채운다 */
  props?: FileProps
}): ViewerFileInfo {
  const { setup, family } = input
  const acq = family === '3.x' ? adaptGroups3(setup) : adaptGroups4(setup)
  const refs = matchGroupSetups(acq, input.groupSetups)
  const business = input.business ?? { groups: [], assemblies: [] }
  const extraWarnings: string[] = []
  const groups = acq.map((g, i) => {
    const built = buildGroup(setup, family, g, input.lookup, refs[i]?.contextId ?? null)
    const bg = businessGroupOf(business, refs[i]?.mxuId ?? null, i, acq.length)
    const asm = bg === null ? null : (business.assemblies.find((a) => a.id !== null && a.id === bg.connectorId) ?? null)
    const withSettings = settingsOf(built, g, byId(setup['groups'], g.groupId) ?? {}, family, bg, asm)
    extraWarnings.push(...groupWarnings(withSettings))
    return withSettings
  })
  extraWarnings.push(...offsetWarnings(business.assemblies))
  const cur = input.currentMxuGroupId === null ? -1 : refs.findIndex((r) => r?.mxuId === input.currentMxuGroupId)
  const display: ViewerDisplay = { ...input.display, currentGroupId: cur >= 0 ? groups[cur]!.id : null }
  const readings = readingsOf(input.groupSetups, input.groupExtras, refs, groups)
  if (readings) display.readings = readings
  const first = acq.find((g) => g.kind === 'pa') ?? acq[0] ?? null
  const specimen = specimenOf(setup, mappingSpecimenId(findDataMapping(setup, first?.dataMappingId ?? null)))
  const template = input.modelFile?.weldTemplate ?? null
  if (specimen.weld && template !== null) specimen.weld = { ...specimen.weld, template }
  const warnings = extraWarnings.length ? [...input.warnings, ...extraWarnings] : input.warnings
  const info: ViewerFileInfo = { formatFamily: family, version: input.version, groups, specimen, display, warnings }
  if (input.props) info.source = fileSourceOf(input.props, input.modelFile ?? null, setup)
  return info
}

// ──────────────────────────────── OmniPC 설정 읽기 (2026-10-07, 조사_보고.md 6절 X2·X7·L4·L5·L6) ────────────────────────────────
// 모두 선택 칸을 더할 뿐 기존 칸 값·그림은 바꾸지 않는다. 근거는 우리 데이터 파일 값(4_NDE설정.md)과 공개 설명서·ndeformat 변경 기록.

/** 분석 오프셋을 0 이 아니라고 볼 크기 (mm). 파일의 0 은 정확히 0 이고, 1e-18 m 같은 꼬리는 무시 */
const OFFSET_EPS_MM = 0.0005

/**
 * 셋업 그룹 ↔ BusinessSetup ContextGroupSetup. ContextGroupSetup/ID 는 ModelSetup GroupSetup/ID(MXU 화면 그룹 번호)와 같은 번호로 본다.
 * GroupSetup 짝이 없으면 순서로(그룹 수가 같을 때만).
 */
function businessGroupOf(b: ParsedBusiness, mxuId: number | null, order: number, acqCount: number): BusinessGroupRef | null {
  if (mxuId !== null) return b.groups.find((x) => x.id === mxuId) ?? null
  return b.groups.length === acqCount ? (b.groups[order] ?? null) : null
}

/** 3.x JSON peakDetection('Maximum'·'First…') / 4.x gateDetection('MaximumPeak' …) / XML PeakType('Highest' …) → 봉우리 고르기 */
function detectionOf(...v: Array<string | null>): 'max' | 'first' | null {
  for (const s of v) {
    if (!s) continue
    if (/max|highest/i.test(s)) return 'max'
    if (/first/i.test(s)) return 'first'
  }
  return null
}

/** 3.x JSON timeSelection('Peak'·'Crossing') / 4.x gateDetection / XML EventType('Peak'·'Crossing') → 위치 측정 기준 */
function eventOf(...v: Array<string | null>): 'peak' | 'edge' | null {
  for (const s of v) {
    if (!s) continue
    if (/cross|edge/i.test(s)) return 'edge'
    if (/peak/i.test(s)) return 'peak'
  }
  return null
}

/** 4.x: 그룹 processes[].outputs[] 의 gateId → gateDetection */
function gateDetections4(raw: Json): Map<number, string> {
  const out = new Map<number, string>()
  for (const p of objs(raw['processes'])) {
    for (const o of objs(p['outputs'])) {
      const params = obj(o['parameters'])
      const gid = int(params?.['gateId'])
      const det = str(params?.['gateDetection'])
      if (gid !== null && det !== null && !out.has(gid)) out.set(gid, det)
    }
  }
  return out
}

/** 게이트에 켜짐·봉우리 고르기·측정 기준 칸을 더한다 (L5). 다른 칸은 그대로(같은 배열 참조). 시험용으로 내보냄 */
export function gateModes(gates: ViewerGate[], body: Json, raw: Json, family: '3.x' | '4.x', bg: BusinessGroupRef | null): ViewerGate[] {
  const json = new Map(objs(body['gates']).map((g, i) => [int(g['id']) ?? i, g] as const))
  const det4 = family === '4.x' ? gateDetections4(raw) : new Map<number, string>()
  return gates.map((g) => {
    const j = json.get(g.id) ?? null
    const x = bg?.gates.find((v) => v.id === g.id) ?? null
    // 3.x JSON 은 꺼진 게이트도 담아 XML IsEnabled 로만 안다. 4.x JSON 은 켜진 게이트만 담는다(XML 이 있으면 그것)
    const enabled = x?.enabled ?? (family === '4.x' ? true : null)
    // 봉우리 고르기는 4.x gateDetection('MaximumPeak' …)이 그 뜻이라 XML 보다 먼저 본다.
    // 위치 기준은 gateDetection 이 봉우리 고르기 값이라('MaximumPeak' 의 'Peak' 는 위치 기준이 아님) XML EventType 을 먼저 보고 마지막에만 쓴다
    const detection = detectionOf(str(j?.['peakDetection']), det4.get(g.id) ?? null, x?.peakType ?? null)
    const event = eventOf(str(j?.['timeSelection']), x?.eventType ?? null, det4.get(g.id) ?? null)
    return { ...g, enabled, detection, event }
  })
}

/** 그룹에 저장된 분석(소프트) 이득 (L4): 4.x JSON Software 'gain' process → XML SoftGain → null */
function softGainOf(acq: AcqGroup, bg: BusinessGroupRef | null): number | null {
  for (const p of acq.extraProcesses) {
    if (str(p['implementation']) === 'Software' && num(p['gain']) !== null) return num(p['gain'])
  }
  return bg?.softGainDb ?? null
}

/** Ref 추정 근거 단계 (X2, 4_NDE설정.md 8.3-4): 기준 이득 있음 + TCG 보정 참 + 모든 빔에 TCG 점 2개 이상 → 'tcg' */
export function refBasisOf(body: Json, hasReferenceGainXml: boolean | null): RefBasis {
  const ref = num(body['referenceGain'])
  if (ref === null || !(ref > 0) || hasReferenceGainXml === false) return 'none'
  const tcgCalibrated = objs(body['calibrationStates']).some((c) => obj(c['tcgCalibration'])?.['calibrated'] === true)
  const beams = objs(body['beams'])
  const allBeamsTcg = beams.length > 0 && beams.every((b) => objs(obj(b['tcg'])?.['points']).length >= 2)
  return tcgCalibrated && allBeamsTcg ? 'tcg' : 'single-depth'
}

function settingsOf(g: ViewerGroup, acq: AcqGroup, raw: Json, family: '3.x' | '4.x', bg: BusinessGroupRef | null, asm: BusinessAssemblyRef | null): ViewerGroup {
  const refBasis = refBasisOf(acq.body, bg?.hasReferenceGain ?? null)
  const refPct = refBasis === 'none' ? null : refPctFromSetup(g.gainDb, g.referenceGainDb, g.referenceAmplitudePct)
  const out: ViewerGroup = { ...g, refBasis, refPct, softGainDb: softGainOf(acq, bg), positioning: asm?.pulser ?? null }
  if (g.gates.length) out.gates = gateModes(g.gates, acq.body, raw, family, bg)
  return out
}

const dbText = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`

/** 그릴 수 있는 그룹의 경고: Ref 추정이 표시 상한을 넘음(X2), 저장된 분석 이득(L4) */
function groupWarnings(g: ViewerGroup): string[] {
  if (!g.supported) return []
  const out: string[] = []
  if (g.storageMode === 'Paintbrush') {
    out.push(`그룹 ${g.name}: Paintbrush 저장 좌표 격자로 표시합니다(OmniPC 대조 전). U축은 저장된 격자 위치이며 엔코더 실측 위치나 취득 시간순 정렬을 확인한 값은 아닙니다.`)
  }
  if (g.refPct !== undefined && g.refPct !== null && g.refPct > g.ampScale.unitMax) {
    out.push(
      `그룹 ${g.name}: 파일 설정으로 추정한 Ref(${g.refPct.toFixed(1)} %FSH)가 진폭 표시 상한 ${g.ampScale.unitMax} % 를 넘습니다. 포화된 지시의 Ref 대비 dB 는 하한으로만 나옵니다(대조 전 참고값).`
    )
  }
  if (g.softGainDb !== undefined && g.softGainDb !== null && Math.abs(g.softGainDb) >= 0.05) {
    out.push(`그룹 ${g.name}: 파일에 OmniPC 분석 이득 ${dbText(g.softGainDb)} dB 가 저장되어 있습니다. 앱의 그림·측정값·기록은 저장 진폭(0 dB) 기준입니다(대조 전).`)
  }
  return out
}

/**
 * 분석 오프셋이 0 이 아닌 탐촉자가 있으면 한 줄 (X7). where = 'import' 면 가져오기 미리보기 글자
 * (지문 (c) 탐촉자 위치가 분석 때 바꾼 값이라 플랜 나누기가 취득 때와 다를 수 있음 — 계산 방법은 사용자 결정, app/README.md)
 */
export function offsetWarnings(assemblies: BusinessAssemblyRef[], where: 'viewer' | 'import' = 'viewer'): string[] {
  const parts: string[] = []
  const text = (p: ViewerProbePositioning | null): string[] => {
    if (!p) return []
    const out: string[] = []
    const i = p.analysisIndexOffsetMm ?? 0
    const s = p.analysisScanOffsetMm ?? 0
    if (Math.abs(i) >= OFFSET_EPS_MM) out.push(`Index ${dbTextMm(i)} mm`)
    if (Math.abs(s) >= OFFSET_EPS_MM) out.push(`Scan ${dbTextMm(s)} mm`)
    return out
  }
  for (const a of assemblies) {
    const tx = text(a.pulser)
    const rx = text(a.receiver)
    // PA 는 송신·수신 칸이 같은 값이라 한 번만, ToFD 처럼 다르면 둘 다
    if (tx.join() === rx.join()) parts.push(...tx)
    else parts.push(...tx.map((t) => `송신 ${t}`), ...rx.map((t) => `수신 ${t}`))
  }
  if (!parts.length) return []
  const what = `분석에서 위치를 바꿔 저장한 파일입니다(분석 오프셋 ${[...new Set(parts)].join(', ')}).`
  if (where === 'import') {
    return [`${what} 스캔플랜 지문의 탐촉자 위치가 바꾼 값으로 계산되어, 같은 셋업으로 취득한 파일과 다른 플랜이 될 수 있습니다.`]
  }
  return [`${what} 그림은 OmniPC 분석 화면과 같은 위치이고, 스캔플랜 지문의 탐촉자 위치도 바꾼 값으로 계산됩니다.`]
}

const dbTextMm = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`

/** 저장된 측정값 목록 (L1): GroupSetup 마다, 셋업 그룹과 맞춘 id 를 붙여 */
function readingsOf(
  setups: GroupSetupRef[],
  extras: GroupSetupExtra[] | undefined,
  refs: Array<GroupSetupRef | null>,
  groups: ViewerGroup[]
): ViewerReadingSetup[] | null {
  if (!extras || extras.length !== setups.length) return null
  const out: ViewerReadingSetup[] = []
  setups.forEach((s, j) => {
    const e = extras[j]!
    if (e.readings === null) return
    const i = refs.indexOf(s)
    out.push({ groupId: i >= 0 ? groups[i]!.id : null, groupName: s.userName, keys: e.readings, listId: e.readingListId })
  })
  return out.length ? out : null
}

/** '6.1.1.2' · '6.4.0-release.416' → [6, 1, 1]. 못 읽으면 null */
export function parseAppVersion(v: string | null): [number, number, number] | null {
  const m = v ? /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v.trim()) : null
  return m ? [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])] : null
}

const isApp = (a: ViewerAppStamp | null, name: string): boolean => !!a?.name && a.name.toLowerCase() === name.toLowerCase()
const vText = (v: [number, number, number]): string => v.join('.')

/** 파일 출처 (L6): 만든 앱·고친 앱·마지막 저장 앱(ModelSetup)·장비, OmniPC 재저장, MXU 6.3.0 전 X4 웨지 오프셋 주의 */
export function fileSourceOf(props: FileProps, model: ModelSetupFileRef | null, setup: Json): ViewerFileSource {
  const createdBy: ViewerAppStamp | null = props.createdApp ?? null
  const modifiedBy: ViewerAppStamp | null = props.modifiedApp ?? null
  const savedBy: ViewerAppStamp | null = model?.software ? { name: model.software.applicationId, version: model.software.version } : null
  const unitPlatform = str(objs(setup['acquisitionUnits'])[0]?.['platform'])
  const platform = model?.platformId ?? (unitPlatform && /x4/i.test(unitPlatform) ? 'X4' : unitPlatform)
  const omnipc = [savedBy, modifiedBy].find((a) => isApp(a, 'OmniPC')) ?? null
  const mxuOf = (a: ViewerAppStamp | null): [number, number, number] | null => (isApp(a, 'MXU') ? parseAppVersion(a!.version) : null)
  const lastMxuStamp = [modifiedBy, savedBy, createdBy].find((a) => mxuOf(a) !== null) ?? null
  const mxu = mxuOf(lastMxuStamp)
  // 웨지 오프셋 주의는 '파일을 만든 MXU 판'으로 정한다(3_웹문서.md 5.3 — ndeformat MXU 변경 기록). 만든 앱이 MXU 가 아니면 마지막 MXU 판
  const created = mxuOf(createdBy) ?? mxu
  const isX4 = !!platform && /x4/i.test(platform)
  const before630 = (v: [number, number, number]): boolean => v[0] < 6 || (v[0] === 6 && v[1] < 3)
  const wedgeOffsetCaution = isX4 && created !== null && before630(created)
  const notes: string[] = []
  if (omnipc) notes.push(`OmniPC${omnipc.version ? ` ${omnipc.version}` : ''} 로 다시 저장한 파일입니다(장비 원본이 아님).`)
  if (wedgeOffsetCaution && created) {
    const later = mxu && vText(mxu) !== vText(created) ? `, 마지막 저장 MXU ${vText(mxu)}` : ''
    notes.push(
      `MXU ${vText(created)}(6.3.0 전)로 만든 X4 파일입니다${later}. MXU 6.3.0 은 UT 웨지 장착 위치(primary·tertiaryOffset)와 PA 사용자 웨지 secondaryOffset 부호 저장 오류를 고쳤습니다(공개 NDE 형식 변경 기록) — 이 파일에 해당하는지는 대조 전, 위치 대조 때 확인하세요.`
    )
  }
  return {
    createdBy,
    modifiedBy,
    savedBy,
    platform: platform ?? null,
    resavedByOmniPC: omnipc !== null,
    mxuVersion: mxu ? vText(mxu) : null,
    createdMxuVersion: created ? vText(created) : null,
    wedgeOffsetCaution,
    notes
  }
}
