import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NdeError, initNde, isNdeFileName, normalizeNdeDate, openNde, parseNdeVersion, readNdeFile } from '@core/nde'
import { toApiError } from '@shared/errors'
import { EX, HAS_EXAMPLES, HAS_X3, X3_FILES, listExampleFiles } from './fixtures'

describe('버전·날짜 해석', () => {
  it('parseNdeVersion', () => {
    expect(parseNdeVersion('3.3.0')).toEqual({ raw: '3.3.0', family: '3.x', major: 3, minor: 3, patch: 0, preRelease: null })
    expect(parseNdeVersion('4.0.0-Dev')).toMatchObject({ family: '4.x', major: 4, minor: 0, preRelease: 'Dev' })
    expect(parseNdeVersion('4.2.0').family).toBe('4.x')
    expect(() => parseNdeVersion('5.0.0')).toThrow(NdeError)
    expect(() => parseNdeVersion('abc')).toThrow(NdeError)
  })

  it('콜론 없는 시간대도 ISO 로', () => {
    expect(normalizeNdeDate('2024-09-03T10:32:26+0900')).toBe('2024-09-03T10:32:26+09:00')
    expect(normalizeNdeDate('2024-09-26T11:24:44-0930')).toBe('2024-09-26T11:24:44-09:30')
    expect(normalizeNdeDate('2026-02-23T12:17:51-05:00')).toBe('2026-02-23T12:17:51-05:00')
    expect(normalizeNdeDate('2026-02-23T12:17:51Z')).toBe('2026-02-23T12:17:51Z')
    expect(normalizeNdeDate('어제')).toBeNull()
    expect(normalizeNdeDate(undefined)).toBeNull()
  })

  it('isNdeFileName', () => {
    expect(isNdeFileName('a.NDE')).toBe(true)
    expect(isNdeFileName('a.opd')).toBe(false)
  })
})

describe.skipIf(!HAS_X3)('X3 실데이터 메타', () => {
  const before = X3_FILES.map((p) => statSync(p))

  it('3.3.0, 장비 원본 파일명, 장비 정보, 시간대 포함 날짜', async () => {
    const expected = ['12T-SV-PL23833-i15-CAP20', '12T-SV-PL23840-i15-CAP20', '12T-SV-PL23841-i15-CAP OFF', '12T-SV-PL23831-i15-CAP20']
    for (const [i, p] of X3_FILES.entries()) {
      const raw = await openNde(p)
      expect(raw.version.raw).toBe('3.3.0')
      expect(raw.version.family).toBe('3.x')
      expect(raw.rootKeys).toEqual(expect.arrayContaining(['Applications', 'Domain']))
      expect(raw.meta.deviceFileName).toBe(expected[i])
      expect(raw.meta.device).toEqual({ platform: 'OmniScanX3', model: 'Freedom_32x128', serialNumber: 'QC-0018282', name: 'MXU' })
      expect(raw.meta.createdAt).toMatch(/^2024-09-03T\d{2}:\d{2}:\d{2}\+09:00$/)
      expect(raw.meta.application).toEqual({ name: 'MXU', version: '5.18.1.0' })
      expect(raw.meta.scenario).toBe('General Weld')
      expect(raw.warnings).toEqual([])
    }
  })

  it('원본 파일은 바뀌지 않는다 (크기·수정시각)', async () => {
    for (const p of X3_FILES) await readNdeFile(p)
    X3_FILES.forEach((p, i) => {
      const now = statSync(p)
      expect(now.size).toBe(before[i]!.size)
      expect(now.mtimeMs).toBe(before[i]!.mtimeMs)
    })
  })
})

describe.skipIf(!HAS_EXAMPLES)('공식 예제 11개', () => {
  it('모두 열리고 버전 판별이 폴더와 맞다', async () => {
    const files = listExampleFiles()
    expect(files.length).toBe(11)
    for (const p of files) {
      const dir = p.split('/').at(-2)!
      const r = await readNdeFile(p)
      const v = r.meta.ndeVersion
      expect(`${v.major}.${v.minor}`, p).toBe(dir)
      expect(v.family, p).toBe(dir.startsWith('3') ? '3.x' : '4.x')
      expect(r.meta.createdAt, p).toMatch(/[+-]\d{2}:\d{2}$|Z$/)
      expect(r.meta.deviceFileName, p).toBeTruthy()
      expect(r.meta.device.serialNumber, p).toMatch(/^QC-/)
    }
  })

  it('4.0 사전공개판과 4.x 메타 (Properties)', async () => {
    const r40 = await openNde(EX.manualPa40)
    expect(r40.version).toMatchObject({ raw: '4.0.0-Dev', family: '4.x', preRelease: 'Dev' })
    expect(r40.rootKeys).toEqual(expect.arrayContaining(['Private', 'Properties', 'Public']))
    expect(r40.meta.createdAt).toBe('2024-04-26T13:48:56-04:00')
    expect(r40.meta.modifiedAt).toBe('2024-10-01T09:43:59-04:00')
    // 4.x 도 /Private/MXU/ModelSetup 에 SaveFileName 이 있다
    expect(r40.meta.deviceFileName).toBe('ManualWeldPA (2)')
    const r42 = await openNde(EX.sect42)
    expect(r42.meta.deviceFileName).toBe('Weld_Plate_PA-Sect_sk90-4.2')
    expect(r42.meta.device.platform).toBe('OmniScan X4')
    expect(r42.meta.application).toEqual({ name: 'MXU', version: '6.4.0.416' })
  })
})

describe.skipIf(!HAS_EXAMPLES)('성능 (파일당 메타+셋업 추출 < 100ms)', () => {
  it('44MB 예제 포함 전 파일', async () => {
    await initNde()
    const files = [...listExampleFiles(), ...(HAS_X3 ? X3_FILES : [])]
    const times: Array<[string, number]> = []
    for (const p of files) {
      const t0 = performance.now()
      await readNdeFile(p)
      times.push([p.split('/').pop()!, performance.now() - t0])
    }
    const max = Math.max(...times.map(([, t]) => t))
    console.info('[nde 성능] 파일당 ms:', times.map(([n, t]) => `${n}=${t.toFixed(1)}`).join(', '))
    expect(times.find(([n]) => n.startsWith('Weld_COD'))![1]).toBeLessThan(100)
    expect(max).toBeLessThan(100)
  })
})

describe('손상·비-NDE 파일은 명확한 오류', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nde-core-test-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  async function reasonOf(path: string): Promise<{ reason: string; code: string }> {
    try {
      await openNde(path)
    } catch (e) {
      expect(e).toBeInstanceOf(NdeError)
      const err = e as NdeError
      expect(toApiError(err).message).toBe(err.message)
      return { reason: err.reason, code: err.code }
    }
    throw new Error('예외가 나야 함')
  }

  function headOf(src: string, bytes: number, name: string): string {
    const buf = Buffer.alloc(bytes)
    const fd = openSync(src, 'r')
    try {
      readSync(fd, buf, 0, bytes, 0)
    } finally {
      closeSync(fd)
    }
    const out = join(dir, name)
    writeFileSync(out, buf)
    return out
  }

  it('없는 파일 → NOT_FOUND', async () => {
    expect(await reasonOf(join(dir, 'nope.nde'))).toEqual({ reason: 'not-found', code: 'NOT_FOUND' })
  })

  it('빈 파일 / 텍스트 파일 / 폴더', async () => {
    writeFileSync(join(dir, 'empty.nde'), '')
    writeFileSync(join(dir, 'text.nde'), '이것은 NDE 가 아닙니다\n'.repeat(100))
    expect(await reasonOf(join(dir, 'empty.nde'))).toEqual({ reason: 'empty-file', code: 'NDE_READ_ERROR' })
    expect(await reasonOf(join(dir, 'text.nde'))).toEqual({ reason: 'not-hdf5', code: 'NDE_READ_ERROR' })
    expect(await reasonOf(dir)).toEqual({ reason: 'not-a-file', code: 'NDE_READ_ERROR' })
  })

  it.skipIf(!HAS_EXAMPLES)('앞부분만 남은(잘린) 파일 → truncated', async () => {
    for (const [src, bytes] of [
      [EX.ut42, 4096],
      [EX.ut42, 600_000],
      [EX.manualPa33, 1_000_000]
    ] as const) {
      const p = headOf(src, bytes, `cut-${bytes}.nde`)
      expect(await reasonOf(p)).toEqual({ reason: 'truncated', code: 'NDE_READ_ERROR' })
    }
  })

  it.skipIf(!HAS_EXAMPLES)('크기는 맞지만 내부가 손상된 파일도 예외 종류가 명확하다', async () => {
    const src = readFileSync(EX.ut42)
    // 슈퍼블록만 남기고 나머지를 0 으로 (메타데이터 파괴)
    const zeroed = Buffer.from(src)
    zeroed.fill(0, 96)
    writeFileSync(join(dir, 'zeroed.nde'), zeroed)
    // 셋업 JSON 글자 일부를 깨뜨림
    const garbled = Buffer.from(src)
    const at = garbled.indexOf('"version"')
    garbled.fill(0x7b, at, at + 50)
    writeFileSync(join(dir, 'garbled.nde'), garbled)
    for (const name of ['zeroed.nde', 'garbled.nde']) {
      const r = await reasonOf(join(dir, name))
      expect(r.code, name).toBe('NDE_READ_ERROR')
      expect(['hdf5-open-failed', 'corrupt', 'bad-setup-json', 'no-setup', 'unknown-layout'], name).toContain(r.reason)
    }
    expect((await reasonOf(join(dir, 'garbled.nde'))).reason).toBe('bad-setup-json')
  })

  it('HDF5 이지만 NDE 가 아님 / 셋업 JSON 손상 / 모르는 버전', async () => {
    const h5 = (await import('h5wasm/node')).default
    await h5.ready
    const make = (name: string, build: (f: InstanceType<typeof h5.File>) => void): string => {
      const p = join(dir, name)
      const f = new h5.File(p, 'w')
      try {
        build(f)
      } finally {
        f.close()
      }
      return p
    }
    const plain = make('plain.h5', (f) => f.create_dataset({ name: 'x', data: new Float32Array([1, 2]) }))
    const badJson = make('bad-json.nde', (f) => f.create_group('Domain').create_dataset({ name: 'Setup', data: '{"version": "3.3.0", ' }))
    const v5 = make('v5.nde', (f) => f.create_group('Public').create_dataset({ name: 'Setup', data: '{"version": "5.0.0", "groups": []}' }))
    const noSetup = make('no-setup.nde', (f) => f.create_group('Domain').create_group('DataGroups'))
    expect(await reasonOf(plain)).toEqual({ reason: 'unknown-layout', code: 'NDE_UNSUPPORTED' })
    expect(await reasonOf(badJson)).toEqual({ reason: 'bad-setup-json', code: 'NDE_READ_ERROR' })
    expect(await reasonOf(v5)).toEqual({ reason: 'unsupported-version', code: 'NDE_UNSUPPORTED' })
    expect(await reasonOf(noSetup)).toEqual({ reason: 'no-setup', code: 'NDE_UNSUPPORTED' })
  })
})
