import { existsSync, readFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readOpdFile, type OpdFile } from '@core/opd'
import { ByteView } from '@core/opd/bytes'
import { opdExpectedRasterPositions, opdScanSyncFromCode, readOpdScanSetup, type OpdScanSetup } from '@core/opd/scan'
import { opdPath } from '../../paths'
import { loadSurveyJson } from './surveyCsv'

function fixture(opts: { sync?: number; start?: number; stop?: number; step?: number; quantity?: number; indexQuantity?: number; brokenAxisReference?: boolean; encoderCodes?: [number, number] } = {}) {
  const prefix = new Uint8Array(0x10000)
  const pv = new DataView(prefix.buffer)
  const tuples: number[][] = []
  const tableOffset = 0x90000
  let nameOffset = 0x100
  let numberOffset = 0x2000
  const group = (name: string, records: number[][]): number => {
    const start = tableOffset + tuples.length * 16
    const at = nameOffset
    for (const c of `${name}\0`) { pv.setUint16(nameOffset, c.charCodeAt(0), true); nameOffset += 2 }
    tuples.push([0x13eb0, 2 * (name.length + 1), at, 0], ...records)
    return start
  }
  const integer = (tag: number, value: number): number[] => [tag, 1, value, 0]
  const floating = (tag: number, value: number): number[] => {
    const offset = numberOffset
    pv.setFloat64(offset, value, true)
    numberOffset += 8
    return [tag, 1, offset, 0]
  }
  // 채널·축 ID로 선택해야 하므로 파일 내 순서를 뒤집어 만든다.
  const encoder2 = group('Encoder_GROUP', [integer(0x746ce, opts.encoderCodes?.[1] ?? 2), floating(0xb42ce, 12000)])
  const encoder1 = group('Encoder_GROUP', [integer(0x746ce, opts.encoderCodes?.[0] ?? 1), floating(0xb42ce, 13850)])
  const axis1 = group('Axis_GROUP', [integer(0x73ed0, 1), integer(0x743d0, 2)])
  const axis0 = group('Axis_GROUP', [integer(0x73ed0, 0), integer(0x743d0, opts.sync ?? 1)])
  const indexQuantity = opts.indexQuantity ?? 1
  const patch = group('Patch_GROUP', [floating(0xb40cf, opts.start ?? 0), floating(0xb41cf, opts.stop ?? 0.801),
    floating(0xb42cf, opts.step ?? 0.001), integer(0x643cf, opts.quantity ?? 801), floating(0xb44cf, 0),
    floating(0xb45cf, indexQuantity * 0.001), floating(0xb46cf, 0.001), integer(0x647cf, indexQuantity),
    [0x3dd0, 9, axis1, 0], [0x3dd0, 9, opts.brokenAxisReference ? 0xabcdef : axis0, 0]])
  group('Mechanical_GROUP', [[0x3dce, 10, encoder2, 0], [0x3dce, 10, encoder1, 0], [0x3dcf, 36, patch, 0]])
  const bytes = new Uint8Array(tuples.length * 16)
  const tv = new DataView(bytes.buffer)
  tuples.forEach((tuple, i) => tuple.forEach((value, k) => tv.setUint32(i * 16 + k * 4, value!, true)))
  return readOpdScanSetup(new ByteView(prefix), { bytes, offset: tableOffset })
}

describe('OPD typed 스캔 축 추출', () => {
  it('Axis 0·엔코더 채널 1의 명시적 참조를 따르고 제외 상한과 마지막 점을 구별한다', () => {
    const scan = fixture()
    expect(scan.scanSync).toBe('encoder')
    expect(scan.scanSyncCode).toBe(1)
    expect(scan.encoder).toEqual({ channel: 1, resolutionStepsPerMm: 13.85 })
    expect(scan.encoderDefinitions).toEqual([{ channel: 2, resolutionStepsPerMm: 12 }, { channel: 1, resolutionStepsPerMm: 13.85 }])
    expect(scan.scan).toEqual({ startMm: 0, stopExclusiveMm: 801, resolutionMm: 1, quantity: 801,
      lastPointMm: 800, quantityFromRange: 801, rangeMatchesQuantity: true })
    expect(scan.index.quantity).toBe(1)
    expect(opdExpectedRasterPositions(scan)).toBe(801)
    expect(scan.raw['Encoder_GROUP[1]:0xb42ce']).toBe(13850)
    expect(scan.warnings).toEqual([])
  })

  it('시작이 1 mm이면 801 mm 상한까지 800개이며 +1하지 않는다. 2축이면 줄 수를 곱한다', () => {
    const scan = fixture({ start: 0.001, quantity: 800, indexQuantity: 5 })
    expect(scan.scan).toMatchObject({ startMm: 1, stopExclusiveMm: 801, quantity: 800, lastPointMm: 800, quantityFromRange: 800, rangeMatchesQuantity: true })
    expect(opdExpectedRasterPositions(scan)).toBe(4000)
  })

  it('Time 동기는 저장된 엔코더 설정과 활성 여부를 구별하고 다른 코드는 미해독으로 남긴다', () => {
    const time = fixture({ sync: 0 })
    expect(time.scanSync).toBe('time')
    expect(time.encoder).toBeNull()
    expect(time.encoderDefinitions).toHaveLength(2)
    const unknown = fixture({ sync: 2 })
    expect([unknown.scanSync, unknown.scanSyncCode, unknown.encoder]).toEqual(['unknown', 2, null])
    expect(unknown.warnings).toEqual([expect.stringContaining('동기 코드 2')])
    expect(opdScanSyncFromCode(null)).toBe('unknown')
  })

  it('기록된 위치 수가 범위 계산과 다르거나 축 포인터가 손상되면 추측으로 맞추지 않는다', () => {
    const mismatch = fixture({ quantity: 800 })
    expect(mismatch.scan.quantity).toBe(800)
    expect(mismatch.scan.quantityFromRange).toBe(801)
    expect(mismatch.scan.rangeMatchesQuantity).toBe(false)
    expect(mismatch.warnings).toEqual([expect.stringContaining('스캔 위치 수')])
    const broken = fixture({ brokenAxisReference: true })
    expect(broken.scanSync).toBe('unknown')
    expect(broken.scanSyncCode).toBeNull()
    expect(broken.warnings).toEqual([expect.stringContaining('Axis 0')])
  })

  it('typed 설정 표가 없으면 null로 남긴다', () => {
    const scan = readOpdScanSetup(new ByteView(new Uint8Array(32)), null)
    expect(scan.scanSync).toBe('unknown')
    expect(scan.scan.quantity).toBeNull()
    expect(scan.encoder).toBeNull()
    expect(scan.raw).toEqual({})
    expect(opdExpectedRasterPositions(scan)).toBeNull()
  })

  it('엔코더 코드가 중복되면 참조 순서로 추측하지 않고 설정 두 벌을 보존한다', () => {
    const scan = fixture({ encoderCodes: [1, 1] })
    expect(scan.scanSync).toBe('encoder')
    expect(scan.encoder).toEqual({ channel: 1, resolutionStepsPerMm: null })
    expect(scan.encoderDefinitions).toEqual([{ channel: 1, resolutionStepsPerMm: 12 }, { channel: 1, resolutionStepsPerMm: 13.85 }])
    expect(scan.warnings).toEqual([expect.stringContaining('대응을 하나로 확인하지 못해')])
  })
})

const ROWS = loadSurveyJson().rows
const HAS_ALL = ROWS.length === 162 && ROWS.every((r) => existsSync(opdPath(String(r.path))))
const cache = new Map<string, { file: OpdFile; scan: OpdScanSetup }>()

/** 래스터 원본을 읽지 않고 앞부분·typed 표만 별도로 읽는다. */
async function fromPath(path: string): Promise<{ file: OpdFile; scan: OpdScanSetup }> {
  const previous = cache.get(path)
  if (previous) return previous
  const file = await readOpdFile(path)
  const start = file.container.entries[2]!.offset
  const end = file.container.entries[3]!.offset
  const fh = await open(path, 'r')
  try {
    const prefix = new Uint8Array(Math.min(file.container.fileSize, 256 * 1024))
    const tables = new Uint8Array(end - start)
    const [p, t] = await Promise.all([fh.read(prefix, 0, prefix.length, 0), fh.read(tables, 0, tables.length, start)])
    expect(p.bytesRead).toBe(prefix.length)
    expect(t.bytesRead).toBe(tables.length)
    const scan = readOpdScanSetup(new ByteView(prefix, file.container.fileSize), { bytes: tables, offset: start })
    const result = { file, scan }
    cache.set(path, result)
    return result
  } finally {
    await fh.close()
  }
}

describe.skipIf(!HAS_ALL)('OPD 스캔 축 162개 전수', () => {
  it('Patch 위치 수×인덱스 줄 수가 실제 래스터 위치 수와 162/162 일치한다', async () => {
    const syncCounts = { time: 0, encoder: 0, unknown: 0 }
    const shifted: string[] = []
    for (const row of ROWS) {
      const rel = String(row.path)
      const { file, scan } = await fromPath(opdPath(rel))
      expect(scan.scan.rangeMatchesQuantity, rel).toBe(true)
      expect(scan.index.rangeMatchesQuantity, rel).toBe(true)
      expect(opdExpectedRasterPositions(scan), rel).toBe(file.raster.positions)
      expect(scan.scan.quantity, rel).toBe(file.raster.twoAxis?.scanCount ?? file.raster.positions)
      expect(scan.index.quantity, rel).toBe(file.raster.twoAxis?.indexLines ?? 1)
      expect(scan.scan.resolutionMm, rel).toBeCloseTo(file.setup.scan.resolutionMm, 9)
      expect(scan.warnings.filter((w) => !w.includes('엔코더 설정의 대응')), rel).toEqual([])
      if (scan.warnings.length) {
        expect(rel.startsWith('04_부식시험/'), rel).toBe(true)
        expect(scan.encoder?.resolutionStepsPerMm, rel).toBeNull()
      }
      if (scan.scan.startMm !== 0) shifted.push(basename(rel))
      syncCounts[scan.scanSync]++
    }
    expect(syncCounts).toEqual({ time: 35, encoder: 127, unknown: 0 })
    expect(shifted).toHaveLength(4)
    expect(shifted.every((p) => /S25-2 sr1_0[4-7]\.opd$/.test(p))).toBe(true)
  })

  it('SEC20 XML 리포트 36개 동기와 맞으며 sr03_01 엔코더 분해능은 33.30 step/mm이다', async () => {
    const sec = ROWS.filter((r) => String(r.path).includes('/SEC20/'))
    expect(sec).toHaveLength(36)
    for (const row of sec) {
      const path = opdPath(String(row.path))
      const report = join(dirname(path), 'conv', basename(path).replace(/\.opd$/i, '.r01'))
      expect(existsSync(report), report).toBe(true)
      const xml = readFileSync(report, 'utf8')
      const source = /<Area_Synchro>([^<]+)<\/Area_Synchro>/.exec(xml)?.[1]
      expect(source, report).toMatch(/^(Time|Encoder)$/)
      const { scan } = await fromPath(path)
      expect(scan.scanSync, report).toBe(source!.toLowerCase())
      if (basename(path).includes('sr03_01')) expect(scan.encoder?.resolutionStepsPerMm).toBeCloseTo(33.3, 9)
    }
  })
})
