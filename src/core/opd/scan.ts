/**
 * OPD typed 설정의 Mechanical→Patch→Axis / Mechanical→Encoder 참조를 읽는다.
 * 근거: OPD_조사/4_용접형상.md 4절, SEC20 r01 동기 36/36, 위치 수 162/162.
 * Patch stop은 제외되는 상한이다. quantity=(stopExclusive-start)/resolution이며 +1하지 않는다.
 * 독립 추출 함수: 기존 OpdSetup/뷰어/정규화 계약을 바꾸지 않는다.
 */
import { ByteView } from './bytes'
import { structureFail } from './errors'
import { readUtf16z } from './strings'
import type { OpdTypedTables } from './weld'

export type OpdScanSync = 'time' | 'encoder' | 'unknown'

export interface OpdScanRange {
  startMm: number | null
  /** 장비 파일의 제외되는 상한. 실제 마지막 점이 아니다. */
  stopExclusiveMm: number | null
  resolutionMm: number | null
  /** Patch 정수 칸에서 읽은 위치 수. */
  quantity: number | null
  /** stopExclusiveMm-resolutionMm 계산값. */
  lastPointMm: number | null
  /** (stopExclusive-start)/resolution 계산값. 정수에 가까우면 정수로 정리. */
  quantityFromRange: number | null
  rangeMatchesQuantity: boolean | null
}

export interface OpdScanEncoder {
  /** Encoder 0x746CE 원 코드. 중복될 수 있어 설정의 고유 ID로 단정하지 않는다. */
  channel: number | null
  /** 파일의 step/m 값을 step/mm로 환산. */
  resolutionStepsPerMm: number | null
}

export interface OpdScanSetup {
  scanSync: OpdScanSync
  scanSyncCode: number | null
  scan: OpdScanRange
  index: OpdScanRange
  /** 현재 스캔 축이 사용하는 엔코더. Time/미해독 코드이면 null. */
  encoder: OpdScanEncoder | null
  /** 활성 여부와 별도로 파일에 저장된 엔코더 설정. */
  encoderDefinitions: OpdScanEncoder[]
  /** typed 숫자 원값. double은 SI, 코드·위치 수는 정수 그대로. */
  raw: Record<string, number>
  warnings: string[]
}

interface Group {
  name: string
  offset: number
  values: Record<string, number>
  children: Record<string, number[]>
}

const GROUP_TAG = 0x13eb0
const GROUP_NAMES = new Set(['Mechanical_GROUP', 'Patch_GROUP', 'Axis_GROUP', 'Encoder_GROUP'])
const INTEGER_TOLERANCE = 1e-6

/** 0=Time, 1=Encoder channel 1만 대조됨. 다른 코드는 추측하지 않는다. */
export function opdScanSyncFromCode(code: number | null): OpdScanSync {
  return code === 0 ? 'time' : code === 1 ? 'encoder' : 'unknown'
}

function readGroups(prefix: ByteView, tables: OpdTypedTables | null): Group[] {
  if (!tables) return []
  const view = new ByteView(tables.bytes)
  const groups: Group[] = []
  let current: Group | null = null
  for (let p = 0; p + 16 <= tables.bytes.length; p += 16) {
    const tag = view.u32(p)
    const count = view.u32(p + 4)
    const value = view.u32(p + 8)
    if (tag === GROUP_TAG) {
      current = null
      if (view.u32(p + 12) !== 0 || count < 2 || count > 512 || value >= prefix.bytes.length) continue
      const name = readUtf16z(prefix, value, 'setup-values', '스캔 설정 그룹').text
      if (count !== (name.length + 1) * 2) structureFail('setup-values', '스캔 설정 그룹 이름 길이가 다릅니다.', name)
      if (!GROUP_NAMES.has(name)) continue
      current = { name, offset: tables.offset + p, values: {}, children: {} }
      groups.push(current)
      continue
    }
    if (!current) continue
    const key = `0x${tag.toString(16)}`
    if (tag >>> 16 === 0 && (tag === 0x3dce || tag === 0x3dcf || tag === 0x3dd0)) {
      const references = current.children[key] ?? []
      references.push(value)
      current.children[key] = references
    }
    if (count !== 1) continue
    if (tag >>> 16 === 0xb) {
      const decoded = prefix.f64(value)
      if (!Number.isFinite(decoded)) structureFail('setup-values', '스캔 설정 숫자가 유한하지 않습니다.', `${current.name} ${key}`)
      current.values[key] = decoded
    } else if (tag >>> 16 === 0x6 || tag >>> 16 === 0x7) current.values[key] = value
  }
  return groups
}

function unique(groups: Group[]): Group | null {
  return groups.length === 1 ? groups[0]! : null
}

function numberOf(group: Group | null, tag: string): number | null {
  return group?.values[tag] ?? null
}

function rangeOf(patch: Group | null, tags: readonly [string, string, string, string]): OpdScanRange {
  const [startTag, stopTag, resolutionTag, quantityTag] = tags
  const start = numberOf(patch, startTag)
  const stop = numberOf(patch, stopTag)
  const step = numberOf(patch, resolutionTag)
  const quantity = numberOf(patch, quantityTag)
  const ratio = start !== null && stop !== null && step !== null && step > 0 ? (stop - start) / step : null
  const quantityFromRange = ratio !== null && Math.abs(ratio - Math.round(ratio)) <= INTEGER_TOLERANCE ? Math.round(ratio) : ratio
  return {
    startMm: start === null ? null : start * 1000,
    stopExclusiveMm: stop === null ? null : stop * 1000,
    resolutionMm: step === null ? null : step * 1000,
    quantity,
    lastPointMm: stop !== null && step !== null && step > 0 && quantity !== null && quantity > 0 ? (stop - step) * 1000 : null,
    quantityFromRange,
    rangeMatchesQuantity: ratio !== null && quantity !== null ? Math.abs(ratio - quantity) <= INTEGER_TOLERANCE : null
  }
}

/** typed 설정 표를 별도 구간에서 읽으므로 prefix는 파일 절대 위치를 읽는 ByteView를 받는다. */
export function readOpdScanSetup(prefix: ByteView, tables: OpdTypedTables | null): OpdScanSetup {
  const groups = readGroups(prefix, tables)
  const byName = (name: string): Group[] => groups.filter((g) => g.name === name)
  const byOffset = new Map(groups.map((g) => [g.offset, g]))
  const mechanical = unique(byName('Mechanical_GROUP'))
  const linked = (from: Group | null, tag: string, expectedName: string): Group[] =>
    (from?.children[tag] ?? []).map((offset) => byOffset.get(offset)).filter((g): g is Group => g?.name === expectedName)
  const patchLinks = linked(mechanical, '0x3dcf', 'Patch_GROUP')
  const patch = mechanical?.children['0x3dcf']?.length ? unique(patchLinks) : unique(byName('Patch_GROUP'))
  const axisLinks = linked(patch, '0x3dd0', 'Axis_GROUP')
  const axes = patch?.children['0x3dd0']?.length ? axisLinks : byName('Axis_GROUP')
  const scanAxis = unique(axes.filter((g) => g.values['0x73ed0'] === 0))
  const scanSyncCode = numberOf(scanAxis, '0x743d0')
  const scanSync = opdScanSyncFromCode(scanSyncCode)
  const encoderLinks = linked(mechanical, '0x3dce', 'Encoder_GROUP')
  const encoderGroups = mechanical?.children['0x3dce']?.length ? encoderLinks : byName('Encoder_GROUP')
  const encoderDefinitions = encoderGroups.map((g) => {
    const rawResolution = numberOf(g, '0xb42ce')
    return { channel: numberOf(g, '0x746ce'), resolutionStepsPerMm: rawResolution === null ? null : rawResolution / 1000 }
  })
  const activeEncoders = encoderDefinitions.filter((e) => e.channel === scanSyncCode)
  const encoder = scanSync === 'encoder'
    ? activeEncoders.length === 1 ? activeEncoders[0]! : { channel: scanSyncCode, resolutionStepsPerMm: null }
    : null
  const scan = rangeOf(patch, ['0xb40cf', '0xb41cf', '0xb42cf', '0x643cf'])
  const index = rangeOf(patch, ['0xb44cf', '0xb45cf', '0xb46cf', '0x647cf'])
  const raw: Record<string, number> = {}
  const seen = new Map<string, number>()
  for (const g of groups) {
    const i = seen.get(g.name) ?? 0
    seen.set(g.name, i + 1)
    for (const [tag, value] of Object.entries(g.values)) raw[`${g.name}[${i}]:${tag}`] = value
  }
  const warnings: string[] = []
  if (mechanical?.children['0x3dcf']?.length && !patch) warnings.push('Mechanical 설정의 Patch 참조를 하나로 확인하지 못했습니다.')
  if (patch?.children['0x3dd0']?.length && !scanAxis) warnings.push('Patch 설정의 스캔 축(Axis 0) 참조를 하나로 확인하지 못했습니다.')
  if (scanSyncCode !== null && scanSync === 'unknown') warnings.push(`스캔 축 동기 코드 ${scanSyncCode}의 이름은 아직 대조하지 못했습니다.`)
  if (scan.rangeMatchesQuantity === false) warnings.push('Patch 스캔 위치 수가 (제외 상한−시작)/간격과 다릅니다.')
  if (index.rangeMatchesQuantity === false) warnings.push('Patch 인덱스 줄 수가 (제외 상한−시작)/간격과 다릅니다.')
  if (scanSync === 'encoder' && activeEncoders.length !== 1) warnings.push('스캔 축과 엔코더 설정의 대응을 하나로 확인하지 못해 분해능은 미해독으로 둡니다.')
  return { scanSync, scanSyncCode, scan, index, encoder, encoderDefinitions, raw, warnings }
}

/** 정수 칸의 스캔 위치 수×인덱스 줄 수. 래스터 위치 수와 비교할 값이며 범위에서 추측하지 않는다. */
export function opdExpectedRasterPositions(setup: OpdScanSetup): number | null {
  const scan = setup.scan.quantity
  const index = setup.index.quantity
  if (scan === null || index === null || !Number.isInteger(scan) || !Number.isInteger(index) || scan < 1 || index < 1) return null
  const total = scan * index
  return Number.isSafeInteger(total) ? total : null
}
