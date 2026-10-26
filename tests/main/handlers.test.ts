/**
 * main IPC 핸들러의 보안 경계 (electron 을 흉내 내고 가짜 서비스로):
 *   (a) 대화상자(choose*)로 받지 않은 경로는 엑셀 미리보기·JSON 가져오기·내보내기·검수 CSV·학습 데이터 폴더 모두 INVALID_ARGUMENT
 *   (b) 고른 뒤에는 그 경로를 그대로 서비스에 넘긴다 (다른 기능의 승인 경로는 받지 않음)
 *   (c) settings:set 은 라벨 작업 칸(pcId·labelerId·labelBlindMode)을 거절
 *   (d) 내보낼 범위(exportRequest)의 잘못된 SHA-256 거절
 *   (e) 2인 독립 모드에서 색표 불러오기를 막음 (대화상자도 열지 않음)
 * 빌드 산출물은 바뀌지 않는다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  open: [] as string[][],
  save: [] as Array<string | null>,
  opened: 0
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/가짜/문서', getVersion: () => '9.9.9', getName: () => 'PAUT 시험' },
  dialog: {
    showOpenDialog: async () => {
      electron.opened++
      const next = electron.open.shift() ?? []
      return { canceled: next.length === 0, filePaths: next }
    },
    showSaveDialog: async () => {
      const next = electron.save.shift() ?? null
      return { canceled: next === null, filePath: next ?? undefined }
    }
  },
  shell: { showItemInFolder: () => undefined }
}))

import { createHandlers } from '../../src/main/handlers'
import type { AppService } from '@core/service'

const SHA = 'a'.repeat(64)

function fake(blind = false): { service: AppService; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = []
  const record =
    (name: string, value: unknown = { ok: true }) =>
    async (...args: unknown[]): Promise<unknown> => {
      calls.push([name, args])
      return value
    }
  const labels = new Proxy(
    {},
    {
      get: (_t, k) => {
        const name = String(k)
        if (name === 'exportFileName') return record(name, '라벨.json')
        if (name === 'reviewCsvFileName') return record(name, '검수.csv')
        return record(name)
      }
    }
  )
  const service = {
    labels,
    getSettings: async () => ({ lastLabelDir: '/가짜/라벨', labelBlindMode: blind }),
    updateSettings: record('updateSettings', {}),
    readPaletteFile: record('readPaletteFile', { name: 'x' })
  } as unknown as AppService
  return { service, calls }
}

async function code(fn: () => unknown): Promise<string> {
  try {
    await fn()
    return 'OK'
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

const req = { kind: 'comparison', compare: { sha256s: [SHA], a: {}, b: {} } }

describe('main 핸들러 경계 (흉내 electron)', () => {
  beforeEach(() => {
    electron.open.length = 0
    electron.save.length = 0
    electron.opened = 0
  })

  it('(a) 대화상자로 고르지 않은 경로는 모두 거절', async () => {
    const { service, calls } = fake()
    const h = createHandlers({ service, getWindow: () => null })
    expect(await code(() => h['labels:previewWorkbook']('/임의/a.xlsx'))).toBe('INVALID_ARGUMENT')
    expect(await code(() => h['labels:importJson']('/임의/a.json'))).toBe('INVALID_ARGUMENT')
    expect(await code(() => h['labels:exportJson']({ kind: 'all' }, '/임의/b.json'))).toBe('INVALID_ARGUMENT')
    expect(await code(() => h['labels:saveReviewCsv'](req as never, '/임의/c.csv'))).toBe('INVALID_ARGUMENT')
    expect(await code(() => h['labels:exportTraining']({} as never, '/임의'))).toBe('INVALID_ARGUMENT')
    expect(calls.filter(([n]) => ['previewWorkbook', 'importJsonFile', 'exportJsonFile', 'saveReviewCsv', 'exportTraining'].includes(n))).toEqual([])
  })

  it('(b) 고른 뒤에는 그 경로를 그대로 넘기고, 다른 기능의 승인 경로는 받지 않는다', async () => {
    const { service, calls } = fake()
    const h = createHandlers({ service, getWindow: () => null })
    electron.open.push(['/고름/전문가.xlsx'])
    expect(await h['labels:chooseWorkbook']()).toBe('/고름/전문가.xlsx')
    await h['labels:previewWorkbook']('/고름/전문가.xlsx', { groupChoices: {} })
    expect(calls.find(([n]) => n === 'previewWorkbook')![1]).toEqual(['/고름/전문가.xlsx', { groupChoices: {} }])

    electron.open.push(['/고름/들어올.json'])
    expect(await h['labels:chooseJson']()).toBe('/고름/들어올.json')
    await h['labels:importJson']('/고름/들어올.json')
    expect(calls.find(([n]) => n === 'importJsonFile')![1]).toEqual(['/고름/들어올.json'])
    // JSON 가져오기로 고른 경로는 내보내기 경로가 아니다
    expect(await code(() => h['labels:exportJson']({ kind: 'all' }, '/고름/들어올.json'))).toBe('INVALID_ARGUMENT')

    electron.save.push('/고름/나갈.json')
    expect(await h['labels:chooseExportPath']({ kind: 'files', sha256s: [SHA] })).toBe('/고름/나갈.json')
    await h['labels:exportJson']({ kind: 'files', sha256s: [SHA] }, '/고름/나갈.json')
    expect(calls.find(([n]) => n === 'exportJsonFile')![1]).toEqual([{ kind: 'files', sha256s: [SHA] }, '/고름/나갈.json', '9.9.9'])

    electron.save.push('/고름/검수.csv')
    expect(await h['labels:chooseReviewCsvPath'](req as never)).toBe('/고름/검수.csv')
    await h['labels:saveReviewCsv'](req as never, '/고름/검수.csv')
    expect(calls.find(([n]) => n === 'saveReviewCsv')![1][1]).toBe('/고름/검수.csv')

    electron.open.push(['/고름/학습'])
    expect(await h['labels:chooseTrainingDir']()).toBe('/고름/학습')
    await h['labels:exportTraining']({ sha256s: [SHA] } as never, '/고름/학습')
    expect(calls.find(([n]) => n === 'exportTraining')![1].slice(1)).toEqual(['/고름/학습', '9.9.9'])
    // 엑셀로 고른 경로는 학습 폴더가 아니다
    expect(await code(() => h['labels:exportTraining']({} as never, '/고름/전문가.xlsx'))).toBe('INVALID_ARGUMENT')
    // 취소하면 null 이고 아무것도 승인하지 않는다
    expect(await h['labels:chooseWorkbook']()).toBeNull()
  })

  it('(c) settings:set 은 라벨 작업 칸을 거절하고 나머지는 넘긴다', async () => {
    const { service, calls } = fake()
    const h = createHandlers({ service, getWindow: () => null })
    for (const patch of [{ pcId: 'x' }, { labelerId: 'kim' }, { labelBlindMode: true }]) {
      expect(await code(() => h['settings:set'](patch as never)), JSON.stringify(patch)).toBe('INVALID_ARGUMENT')
    }
    await h['settings:set']({ lastImportDir: '/가져오기' } as never)
    expect(calls.filter(([n]) => n === 'updateSettings').map(([, a]) => a[0])).toEqual([{ lastImportDir: '/가져오기' }])
  })

  it('(d) 내보낼 범위: 빈 목록·잘못된 SHA-256·모르는 kind 거절', async () => {
    const { service } = fake()
    const h = createHandlers({ service, getWindow: () => null })
    for (const bad of [{ kind: 'files', sha256s: [] }, { kind: 'files', sha256s: ['zz'] }, { kind: 'files', sha256s: [SHA, 1] }, { kind: 'sets' }, null, 'all']) {
      expect(await code(() => h['labels:chooseExportPath'](bad as never)), JSON.stringify(bad)).toBe('INVALID_ARGUMENT')
    }
  })

  it('(e) 2인 독립 모드에서는 색표 불러오기를 막고 대화상자도 열지 않는다', async () => {
    const blind = fake(true)
    const h = createHandlers({ service: blind.service, getWindow: () => null })
    expect(await code(() => h['viewer:openPalette']())).toBe('INVALID_ARGUMENT')
    expect(electron.opened).toBe(0)
    const open = fake(false)
    const h2 = createHandlers({ service: open.service, getWindow: () => null })
    electron.open.push(['/고름/색.pal'])
    expect(await h2['viewer:openPalette']()).toEqual({ name: 'x' })
    expect(open.calls.find(([n]) => n === 'readPaletteFile')![1]).toEqual(['/고름/색.pal'])
  })
})
