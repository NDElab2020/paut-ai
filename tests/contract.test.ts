import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { API_CHANNEL_MAP, IPC, type IpcChannel, type PautApi } from '@shared/api'
import { AppError, toApiError } from '@shared/errors'
import { formatBytes, formatPlanId, isPlanId, parsePlanNumber, sanitizePathSegment } from '@shared/ids'
import { MODULE_IDS, MODULES, sortedModules } from '@shared/modules'
import { DEFAULT_SETTINGS } from '@shared/types'
import { loadSettings, updateSettings } from '@core/settings'
import { APP_ROOT, TOOL_ROOT } from './paths'

type InvokeKeys<G> = { [K in keyof G]: K extends 'pathForFile' ? never : K }[keyof G]
type MapCovers = {
  [G in Exclude<keyof PautApi, 'onProgress'>]: InvokeKeys<PautApi[G]> extends keyof (typeof API_CHANNEL_MAP)[G] ? true : false
}
const coverage: MapCovers = { app: true, settings: true, plans: true, specimens: true, files: true, import: true, store: true, viewer: true, labels: true }

describe('IPC 계약', () => {
  it('채널 이름이 고유하고 API 대응표가 모든 채널을 덮는다', () => {
    const channels = Object.values(IPC)
    expect(new Set(channels).size).toBe(channels.length)
    const mapped = Object.values(API_CHANNEL_MAP).flatMap((g) => Object.values(g as Record<string, IpcChannel>))
    expect(new Set(mapped)).toEqual(new Set(channels))
    expect(Object.values(coverage).every(Boolean)).toBe(true)
  })

  it('오류 변환 규약', () => {
    expect(toApiError(new AppError('NO_STORE_ROOT', '저장소 없음'))).toEqual({ ok: false, code: 'NO_STORE_ROOT', message: '저장소 없음' })
    expect(toApiError(new Error('not implemented')).code).toBe('NOT_IMPLEMENTED')
    expect(toApiError('x').code).toBe('INTERNAL')
  })
})

describe('공유 도우미', () => {
  it('플랜 ID', () => {
    expect(formatPlanId(1)).toBe('SP001')
    expect(formatPlanId(1234)).toBe('SP1234')
    expect(parsePlanNumber('SP042')).toBe(42)
    expect(isPlanId('SP01')).toBe(false)
  })
  it('경로 조각 정리', () => {
    expect(sanitizePathSegment(' PL23833 ')).toBe('PL23833')
    expect(sanitizePathSegment('a/b:c*?')).toBe('a_b_c__')
    expect(sanitizePathSegment('CON')).toBe('CON_')
    expect(sanitizePathSegment('..')).toBe('')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })
  it('모듈 등록', () => {
    expect(new Set(MODULES.map((m) => m.id))).toEqual(new Set(MODULE_IDS))
    expect(sortedModules()[0]?.id).toBe('import')
  })
})

describe('윈도우 점검 사본', () => {
  // 윈도우_점검/ 폴더는 앱 소스 없이 윈도우 PC 로 넘어가므로 사본을 두되, 어긋나면 여기서 잡는다
  it('윈도우_점검/viewer-steps.js 는 tests/app/viewer-steps.js 와 같다', () => {
    const copy = readFileSync(join(TOOL_ROOT, '윈도우_점검/viewer-steps.js'), 'utf8')
    const origin = readFileSync(join(APP_ROOT, 'tests/app/viewer-steps.js'), 'utf8')
    expect(copy, '앱의 시나리오를 고쳤으면 윈도우_점검/viewer-steps.js 로 다시 복사').toBe(origin)
  })
})

describe('설정 저장', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paut-settings-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  it('없으면 기본값, 갱신 후 다시 읽기', async () => {
    const file = join(dir, 'settings.json')
    expect(await loadSettings(file)).toEqual(DEFAULT_SETTINGS)
    const next = await updateSettings(file, { storeRoot: 'D:/저장소', theme: 'dark' })
    expect(next.storeRoot).toBe('D:/저장소')
    expect(await loadSettings(file)).toEqual(next)
  })
})
