/**
 * 꼬리의 typed 설정 레코드에서 Weld_GROUP를 읽는다.
 * 레코드 = u32LE(tag, count, value 또는 파일 절대 위치, extra), 16 B.
 * 숫자 타입 0xB는 앞부분 double을 가리키고 0x7은 정수 값을 레코드에 직접 보관한다.
 * 그룹 이름은 파일 앞부분 문자열 풀을 가리킨다. 모르는 태그도 원값을 남긴다.
 */
import { ByteView } from './bytes'
import { structureFail } from './errors'
import { readUtf16z } from './strings'

export interface OpdTypedTables {
  bytes: Uint8Array
  offset: number
}

export interface OpdSetupTables {
  /** 그룹 이름 → 동일 이름 그룹 목록 (탐촉자 송·수신 2개 등). */
  groups: Record<string, Array<Record<string, number>>>
  /** group[index]:tag → 파일 원값. */
  raw: Record<string, number>
  /** 그룹 테이블 절대 위치. Context→Gate 포인터를 연결할 때 사용. */
  locations: Record<string, number[]>
  beamContexts: Array<{ name: string | null; gateOffsets: number[] }>
}

const GROUP = 0x13eb0
const KNOWN_GROUPS = new Set(['Weld_GROUP', 'SpecimenInformation_GROUP', 'GroupUT_GROUP', 'ProbeUT_Container_GROUP', 'FblUT_Context_GROUP', 'FblUT_Gate_GROUP'])

/** 값 포인터는 앞부분을 가리킨다. 그룹 header의 count는 이름 바이트 수이며 자식 수가 아니다. */
export function readOpdSetupTables(prefix: ByteView, tables: OpdTypedTables | null): OpdSetupTables {
  const groups: OpdSetupTables['groups'] = {}
  const raw: Record<string, number> = {}
  const locations: OpdSetupTables['locations'] = {}
  const beamContexts: OpdSetupTables['beamContexts'] = []
  if (!tables) return { groups, raw, locations, beamContexts }
  const view = new ByteView(tables.bytes)
  let current: Record<string, number> | null = null
  let currentName = ''
  let currentIndex = 0
  let context: OpdSetupTables['beamContexts'][number] | null = null
  for (let p = 0; p + 16 <= tables.bytes.length; p += 16) {
    const tag = view.u32(p)
    const n = view.u32(p + 4)
    const value = view.u32(p + 8)
    if (tag === GROUP) {
      current = null
      context = null
      if (view.u32(p + 12) !== 0 || n < 2 || n > 512 || value >= prefix.bytes.length) continue
      const name = readUtf16z(prefix, value, 'setup-values', '설정 레코드 그룹')
      if (n !== 2 * (name.text.length + 1)) structureFail('setup-values', '설정 레코드 그룹 이름 길이가 다릅니다.', name.text)
      if (!KNOWN_GROUPS.has(name.text)) continue
      currentName = name.text
      const list = groups[currentName] ?? []
      currentIndex = list.length
      current = {}
      list.push(current)
      groups[currentName] = list
      const positions = locations[currentName] ?? []
      positions.push(tables.offset + p)
      locations[currentName] = positions
      if (currentName === 'FblUT_Context_GROUP') {
        context = { name: null, gateOffsets: [] }
        beamContexts.push(context)
      }
      continue
    }
    if (context && tag === 0x149b9) context.name = readUtf16z(prefix, value, 'setup-values', '빔 설정 이름').text
    if (context && tag === 0x3dbb && n === 16) context.gateOffsets.push(value)
    if (!current || n !== 1) continue
    const key = `0x${tag.toString(16)}`
    let decoded: number | null = null
    if (tag >>> 16 === 0xb) {
      decoded = prefix.f64(value)
      if (!Number.isFinite(decoded)) structureFail('setup-values', '설정 숫자 레코드를 읽지 못했습니다.', `${key}=${decoded}`)
    } else if (tag >>> 16 === 0x6 || tag >>> 16 === 0x7) decoded = value
    // uint8 inline. 잔여 3바이트는 다른 값이므로 u32로 해석하지 않는다.
    else if (currentName === 'FblUT_Gate_GROUP' && tag === 0x240bb) decoded = view.u8(p + 8)
    if (decoded !== null) {
      current[key] = decoded
      raw[`${currentName}[${currentIndex}]:${key}`] = decoded
    }
  }
  return { groups, raw, locations, beamContexts }
}

/**
 * 개선 틀 코드(Weld_GROUP 0x74CBF) → 이름·개선 모양. estimated = 이름을 메뉴 화면으로 맞춰 보지 못함('추정').
 * - 5 = Double V-Offset (양면 V, X): PL23861-ROOT-L-01 OmniPC Weld 설정 화면과 같은 파일로 대조 [확인]
 * - 6 = V-Offset (한면 V): 모양은 확인 — Root 0·Land offset > 0, 사용자 SetupBuilder 12t_SV·25t_SV.wkb 값이 바이트 그대로 같음,
 *   OmniPC 화면 덮개 2장(TP14-ROOT-L·SEC25-2)이 파일 칸 계산과 0.1 mm 안. 이름 'V-Offset' 은 같은 12t SV 설계 X3 .nde 의
 *   ModelSetup WeldTemplateType = VOffset 으로 짐작한 것이라 [추정] (메뉴 캡처 O9 전) — OPD_조사/4_용접형상.md 3.1
 * - 0 = 용접 없음(부식 7개, 용접 칸 모두 0) → weld = null. 그 밖의 코드는 이름을 짐작하지 않는다(null, 원코드 보존).
 */
export const OPD_WELD_TEMPLATE_INFO: Readonly<Record<number, { name: string; bevelShape: 'V' | 'X'; estimated: boolean }>> = {
  5: { name: 'DoubleVOffset', bevelShape: 'X', estimated: false },
  6: { name: 'VOffset', bevelShape: 'V', estimated: true }
}
/** 코드 → 이름 (호환용 표 — OPD_WELD_TEMPLATE_INFO 에서 만든다) */
export const OPD_WELD_TEMPLATES: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(OPD_WELD_TEMPLATE_INFO).map(([code, info]) => [code, info.name])
)
/** PL2386x 화면 Symmetric과 코드 0를 대조. */
export const OPD_WELD_SYMMETRIES: Readonly<Record<number, string>> = { 0: 'Symmetric' }
/**
 * 시편 모양 코드(SpecimenInformation 0x740DD)·재질 코드(0x742DD) → 이름. 162개가 모두 0·30 이라 다른 값 표본이 없어 [추정].
 * 근거: SEC20 r01 Part_Geometry Plate·Part_Material STEEL, MILD 36/36, 사용자 SetupBuilder .wkb 3/3(PlateGeometry, STEEL, MILD)
 */
export const OPD_SPECIMEN_SHAPES: Readonly<Record<number, { name: 'plate'; estimated: boolean }>> = { 0: { name: 'plate', estimated: true } }
export const OPD_MATERIALS: Readonly<Record<number, { name: string; estimated: boolean }>> = { 30: { name: 'STEEL, MILD', estimated: true } }
