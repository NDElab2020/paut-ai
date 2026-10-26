/**
 * 앱 설정 저장 (JSON 파일, 원자적 쓰기). 위치는 main 이 정한다 (userData/settings.json).
 * 라벨 기능용 칸: pcId(이 PC 의 ID, 처음 쓸 때 ensurePcId 가 만든다), labelerId(지금 라벨러), labelBlindMode(2인 독립 모드).
 * 쓰기는 파일마다 한 줄로 세운다(읽고-고치고-쓰기가 겹치면 한쪽 변경이 사라지므로). 임시 파일 이름은 쓰기마다 다르다.
 * 같은 폴더의 label-replicas.json 은 저장소 복제본마다 마지막으로 본 라벨 쓰기 횟수다(백업 복원 알아채기, core/service/labels.ts).
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '@shared/errors'
import { DEFAULT_SETTINGS, PC_ID_PATTERN, type AppSettings, type ThemePreference } from '@shared/types'

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark']

export type SettingsPatch = Partial<Omit<AppSettings, 'settingsVersion'>>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** PC ID 로 쓸 수 있는 글자인지 (NFC·앞뒤 공백 제거 뒤 PC_ID_PATTERN) */
export function cleanPcId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.normalize('NFC').trim()
  return PC_ID_PATTERN.test(s) ? s : null
}

/** 라벨러 ID 칸 (NFC·앞뒤 공백 제거, 64자 이하). 아니면 null */
export function cleanLabelerId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.normalize('NFC').trim()
  return s.length > 0 && s.length <= 64 ? s : null
}

/**
 * 새 PC ID: 'pc-' + 16진수 8자리 (무작위). 컴퓨터 이름은 넣지 않는다(내보낸 라벨 파일이 다른 PC 로 건너가므로).
 * 사람이 알아보기 쉬운 이름(예: '현장PC-1')은 라벨 관리 화면에서 바꾼다.
 */
export function generatePcId(): string {
  return `pc-${randomBytes(4).toString('hex')}`
}

/** 알 수 없는/깨진 값은 기본값으로 */
export function sanitizeSettings(raw: unknown): AppSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const theme = THEMES.includes(o.theme as ThemePreference) ? (o.theme as ThemePreference) : DEFAULT_SETTINGS.theme
  return {
    settingsVersion: 1,
    storeRoot: str(o.storeRoot),
    theme,
    lastImportDir: str(o.lastImportDir),
    newPlanNameTemplate: str(o.newPlanNameTemplate) ?? DEFAULT_SETTINGS.newPlanNameTemplate,
    pcId: cleanPcId(o.pcId),
    labelerId: cleanLabelerId(o.labelerId),
    labelBlindMode: o.labelBlindMode === true,
    lastLabelDir: str(o.lastLabelDir)
  }
}

export async function loadSettings(filePath: string): Promise<AppSettings> {
  try {
    return sanitizeSettings(JSON.parse(await readFile(filePath, 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** 파일마다 쓰기 줄 (앞 작업이 끝난 뒤 다음 작업) */
const queues = new Map<string, Promise<unknown>>()

function serialized<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(filePath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tail = next.catch(() => undefined)
  queues.set(filePath, tail)
  void tail.then(() => {
    if (queues.get(filePath) === tail) queues.delete(filePath)
  })
  return next
}

async function writeAtomic(filePath: string, text: string): Promise<void> {
  const tmp = `${filePath}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, filePath)
  } catch (e) {
    await unlink(tmp).catch(() => undefined)
    throw new AppError('IO_ERROR', '설정 파일에 쓰지 못했습니다.', `${filePath}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function saveSettings(filePath: string, settings: AppSettings): Promise<void> {
  await serialized(filePath, () => writeAtomic(filePath, JSON.stringify(settings, null, 2)))
}

export async function updateSettings(filePath: string, patch: SettingsPatch): Promise<AppSettings> {
  return serialized(filePath, async () => {
    const next = sanitizeSettings({ ...(await loadSettings(filePath)), ...patch })
    await writeAtomic(filePath, JSON.stringify(next, null, 2))
    return next
  })
}

/** pcId 가 없으면 새로 만들어 저장한다. 있으면 그대로 (파일을 쓰지 않음). 읽고 쓰기를 한 줄 안에서 한다 */
export async function ensurePcId(filePath: string, make: () => string = generatePcId): Promise<AppSettings> {
  return serialized(filePath, async () => {
    const s = await loadSettings(filePath)
    if (s.pcId) return s
    const next = sanitizeSettings({ ...s, pcId: make() })
    await writeAtomic(filePath, JSON.stringify(next, null, 2))
    return next
  })
}

// ───────────────────────────── 저장소 복제본 쓰기 횟수 (label-replicas.json) ─────────────────────────────

function replicaMarksPath(settingsPath: string): string {
  return join(dirname(settingsPath), 'label-replicas.json')
}

/** 복제본 ID → 이 PC 가 마지막으로 본 그 저장소의 라벨 쓰기 횟수 */
export async function loadReplicaMarks(settingsPath: string): Promise<Record<string, number>> {
  try {
    const raw = JSON.parse(await readFile(replicaMarksPath(settingsPath), 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<
      string,
      number
    >
  } catch {
    return {}
  }
}

/** 복제본의 쓰기 횟수를 적는다 (더 큰 값만) */
export async function markReplicaWrites(settingsPath: string, replicaId: string, writes: number): Promise<void> {
  const path = replicaMarksPath(settingsPath)
  await serialized(path, async () => {
    const marks = await loadReplicaMarks(settingsPath)
    if ((marks[replicaId] ?? -1) >= writes) return
    marks[replicaId] = writes
    await writeAtomic(path, JSON.stringify(marks, null, 2))
  })
}
