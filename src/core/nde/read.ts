/** 파일 열기 → 버전 판별, 셋업 JSON, 파일 메타. 진폭 데이터는 읽지 않는다. */
import type { DeviceInfo, NdeFileMeta, NdeFormatVersion } from '@shared/types'
import { NdeError } from './errors'
import { childKeys, readStringDataset, rootAttrs, withH5File, type H5File } from './h5'
import { isObj, obj, objs, str, type Json } from './json'

export type NdeLayout = '3.x' | '4.x'

export interface RawNde {
  version: NdeFormatVersion
  /** HDF5 루트 키 */
  rootKeys: string[]
  /** 셋업 JSON 파싱 결과 (3.x /Domain/Setup, 4.x /Public/Setup) */
  setup: unknown
  /** 셋업 JSON 원문 (카탈로그 file_setups 보관용) */
  setupText: string
  meta: NdeFileMeta
  /** 메타 해석 중 생긴 경고 (한국어) */
  warnings: string[]
}

export interface OpenedNde extends RawNde {
  path: string
  /** 열기~닫기 소요 시간 */
  elapsedMs: number
}

const VERSION_RE = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/

/** '3.3.0' / '4.0.0-Dev' → NdeFormatVersion. 3.x·4.x 가 아니면 NdeError('unsupported-version') */
export function parseNdeVersion(raw: string): NdeFormatVersion {
  const m = VERSION_RE.exec(raw.trim())
  if (!m) throw new NdeError('unsupported-version', `version='${raw}'`, `(버전 표기: ${raw})`)
  const major = Number(m[1])
  if (major !== 3 && major !== 4) throw new NdeError('unsupported-version', `version='${raw}'`, `(버전 ${raw})`)
  return {
    raw: raw.trim(),
    family: major === 3 ? '3.x' : '4.x',
    major,
    minor: Number(m[2]),
    patch: m[3] === undefined ? 0 : Number(m[3]),
    preRelease: m[4] ?? null
  }
}

const TZ_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/

/** '2024-09-03T10:32:26+0900' → '2024-09-03T10:32:26+09:00'. 해석 불가면 null */
export function normalizeNdeDate(raw: unknown): string | null {
  const s = str(raw)?.trim()
  if (!s) return null
  const m = TZ_RE.exec(s)
  if (!m) return null
  const tz = m[2]
  if (!tz) return m[1]!
  if (tz === 'Z') return `${m[1]}Z`
  const digits = tz.replace(':', '')
  return `${m[1]}${digits.slice(0, 3)}:${digits.slice(3)}`
}

function detectLayout(rootKeys: string[], file: H5File): NdeLayout {
  if (rootKeys.includes('Domain') && childKeys(file, 'Domain').includes('Setup')) return '3.x'
  if (rootKeys.includes('Public') && childKeys(file, 'Public').includes('Setup')) return '4.x'
  if (rootKeys.includes('Domain') || rootKeys.includes('Public')) throw new NdeError('no-setup', rootKeys.join(','))
  throw new NdeError('unknown-layout', `root keys: ${rootKeys.join(',') || '(없음)'}`)
}

/** 셋업·속성 JSON 문자열 파싱 (없거나 깨지면 NdeError) */
function parseSetupJson(text: string | null, what: string): unknown {
  if (text === null) throw new NdeError('no-setup', what)
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new NdeError('bad-setup-json', `${what}: ${(e as Error).message}`)
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 비공개 영역의 장비 앱 ModelSetup XML (3.x /Applications/<앱>, 4.x /Private/<앱>) 중 처음 나오는 비지 않은 것 */
export function readModelSetupXml(file: H5File, layout: NdeLayout): string | null {
  const privateRoot = layout === '3.x' ? 'Applications' : 'Private'
  for (const app of childKeys(file, privateRoot)) {
    if (!childKeys(file, `${privateRoot}/${app}`).includes('ModelSetup')) continue
    const xml = readStringDataset(file, `${privateRoot}/${app}/ModelSetup`)
    if (xml) return xml
  }
  return null
}

/** 장비가 저장할 때 쓴 원래 파일명: ModelSetup XML 의 <SaveFileName> */
function readDeviceFileName(xml: string | null): string | null {
  const m = xml ? /<SaveFileName>([^<]*)<\/SaveFileName>/.exec(xml) : null
  const name = m ? decodeXml(m[1]!).trim() : ''
  return name ? name.normalize('NFC') : null
}

function readDevice(setup: Json | null): DeviceInfo {
  const unit = objs(setup?.['acquisitionUnits'])[0] ?? null
  return {
    platform: str(unit?.['platform']),
    model: str(unit?.['model']),
    serialNumber: str(unit?.['serialNumber']),
    name: str(unit?.['name'])
  }
}

export interface FileProps {
  versionRaw: string | null
  createdRaw: unknown
  modifiedRaw: unknown
  appName: string | null
  appVersion: string | null
  /** 만든 앱 (3.x 루트 속성 'Application name/version', 4.x Properties createdByApp*) — 파일 출처(L6)용 */
  createdApp?: { name: string | null; version: string | null } | null
  /** 마지막으로 고친 앱 (4.x Properties modifiedByApp*. 3.x 는 null) */
  modifiedApp?: { name: string | null; version: string | null } | null
}

function stamp(name: string | null, version: string | null): { name: string | null; version: string | null } | null {
  return name === null && version === null ? null : { name, version }
}

function props3(attrs: Record<string, unknown>): FileProps {
  return {
    versionRaw: str(attrs['Format version']),
    createdRaw: attrs['Date created'],
    modifiedRaw: attrs['Date modified'],
    appName: str(attrs['Application name']),
    appVersion: str(attrs['Application version']),
    createdApp: stamp(str(attrs['Application name']), str(attrs['Application version'])),
    modifiedApp: null
  }
}

function props4(properties: Json | null): FileProps {
  const f = obj(properties?.['file'])
  return {
    versionRaw: str(f?.['formatVersion']),
    createdRaw: f?.['creationDate'],
    modifiedRaw: f?.['modificationDate'],
    appName: str(f?.['modifiedByAppName']) ?? str(f?.['createdByAppName']),
    appVersion: str(f?.['modifiedByAppVersion']) ?? str(f?.['createdByAppVersion']),
    createdApp: stamp(str(f?.['createdByAppName']), str(f?.['createdByAppVersion'])),
    modifiedApp: stamp(str(f?.['modifiedByAppName']), str(f?.['modifiedByAppVersion']))
  }
}

/** 마지막으로 저장한 장비 앱: 비공개 ModelSetup `SoftwareInformation/{ApplicationId, FullSoftwareVersion}` (없으면 null) */
export function readSavedApplication(modelSetupXml: string | null): { name: string | null; version: string | null } | null {
  const block = modelSetupXml ? /<SoftwareInformation>([\s\S]*?)<\/SoftwareInformation>/.exec(modelSetupXml)?.[1] : undefined
  if (block === undefined) return null
  const pick = (t: string): string | null => {
    const v = new RegExp(`<${t}>([^<]*)</${t}>`).exec(block)?.[1]?.trim()
    return v ? decodeXml(v) : null
  }
  return stamp(pick('ApplicationId'), pick('FullSoftwareVersion'))
}

/**
 * 파일 메타의 저장 앱 보충 (L6 — 출처만): Properties 에 고친 앱 이름이 빠졌으면(4.0 공식 예제: modifiedByAppVersion 만 있음)
 * 판은 Properties 것을 두고 이름만 ModelSetup 저장 앱으로, 둘 다 없으면 ModelSetup 저장 앱으로 채운다. 그 밖에는 그대로.
 */
export function supplementApplication(props: FileProps, saved: { name: string | null; version: string | null } | null): NdeFileMeta['application'] {
  const base = { name: props.appName, version: props.appVersion }
  if (!saved?.name) return base
  if (base.name === null && base.version === null) return { name: saved.name, version: saved.version }
  const mod = props.modifiedApp
  if (mod && mod.name === null && mod.version !== null) return { name: saved.name, version: mod.version }
  return base
}

/** 셋업 읽기 결과 (카탈로그 열기·이미지 보기 공용) */
export interface NdeSetup {
  layout: NdeLayout
  rootKeys: string[]
  setup: Json
  setupText: string
  version: NdeFormatVersion
  props: FileProps
  /** Properties 를 못 읽은 경우 등 (한국어) */
  warnings: string[]
}

/** 구조 판별 → 셋업 JSON → 파일 속성 → 버전. 4.x 는 셋업에 version 이 없으면 Properties 의 formatVersion 을 쓴다 */
export function readSetup(file: H5File): NdeSetup {
  const warnings: string[] = []
  const rootKeys = file.keys()
  const layout = detectLayout(rootKeys, file)
  const setupText = readStringDataset(file, layout === '3.x' ? 'Domain/Setup' : 'Public/Setup')
  const setup = parseSetupJson(setupText, 'Setup')
  if (!isObj(setup)) throw new NdeError('bad-setup-json', 'Setup 이 객체가 아님')

  let props: FileProps
  if (layout === '3.x') {
    props = props3(rootAttrs(file))
  } else {
    let properties: Json | null = null
    try {
      properties = obj(parseSetupJson(readStringDataset(file, 'Properties'), 'Properties'))
    } catch {
      warnings.push('파일 속성(Properties)을 읽지 못해 생성일 등을 비워 둡니다.')
    }
    props = props4(properties)
  }

  const versionRaw = str(setup['version']) ?? props.versionRaw
  if (!versionRaw) throw new NdeError('unsupported-version', 'version 없음', '(버전 정보 없음)')
  const version = parseNdeVersion(versionRaw)
  if (version.family !== layout) {
    throw new NdeError('unsupported-version', `layout=${layout} version=${versionRaw}`, `(구조 ${layout} 와 버전 ${versionRaw} 불일치)`)
  }
  return { layout, rootKeys, setup, setupText: setupText ?? '', version, props, warnings }
}

function extract(file: H5File): RawNde {
  const { layout, rootKeys, setup, setupText, version, props, warnings } = readSetup(file)
  const createdAt = normalizeNdeDate(props.createdRaw)
  const modifiedAt = normalizeNdeDate(props.modifiedRaw)
  if (props.createdRaw != null && createdAt === null) warnings.push(`생성일 형식을 해석하지 못했습니다: ${String(props.createdRaw)}`)

  const modelXml = readModelSetupXml(file, layout)
  const meta: NdeFileMeta = {
    ndeVersion: version,
    deviceFileName: readDeviceFileName(modelXml),
    device: readDevice(setup),
    createdAt,
    modifiedAt,
    application: supplementApplication(props, readSavedApplication(modelXml)),
    scenario: str(setup['scenario'])
  }
  return { version, rootKeys, setup, setupText, meta, warnings }
}

/** NDE 파일 열기 (읽기 전용). 셋업·메타만 읽고 반드시 닫는다. */
export async function openNde(path: string): Promise<OpenedNde> {
  const t0 = performance.now()
  const raw = await withH5File(path, extract)
  return { ...raw, path, elapsedMs: performance.now() - t0 }
}
