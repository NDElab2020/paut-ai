/**
 * OPD 162개 전수 (실데이터가 있는 PC 에서만): 예외 없이 읽고 기준표(survey.json)와 같은 값인지.
 * 정수는 정확히, 실수는 기준표에 찍힌 자릿수로 반올림한 값이 1e-6 안.
 * 자체 점검: 게이트 A 재계산 일치 칸 ≥ 기준표(대조 칸 수 = 기준표), 빈 프레임·255 칸 수 = 기준표.
 * 기준표의 빈 프레임·255 칸은 '스캔 길이 ÷ 간격' 프레임만 센 값이라(2축은 첫 줄만, SEC25-2 sr1_04~07 은 래스터 뒤 1프레임까지)
 * 위치 수 = 스캔 길이 ÷ 간격인 파일만 비교한다.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readOpdFile, selfCheckOpd, type OpdFile, type OpdSelfCheck } from '@core/opd'
import { opdPath, RAW_DATA_DIR } from '../../paths'
import { loadSurveyJson, type SurveyValue } from './surveyCsv'

const SURVEY = loadSurveyJson()
const ROWS = SURVEY.rows.filter((r) => existsSync(opdPath(String(r.path))))
const HAS = existsSync(RAW_DATA_DIR) && ROWS.length > 0
const DECIMALS = new Map(SURVEY.columns.map((c) => [c.key, c.decimals]))

/** 구조 읽기 결과 → 기준표 열 값 */
function actualOf(f: OpdFile, size: number): Record<string, SurveyValue> {
  const b0 = f.beams[0]!
  const bl = f.beams[f.beams.length - 1]!
  const rec = f.beams.length > 1 ? f.beams[1]!.recordOffset - b0.recordOffset : null
  return {
    sizeBytes: size,
    deviceFileName: f.header.deviceFileName,
    savedAt: f.header.savedAt,
    mxu: f.header.mxuVersion,
    probeModel: f.setup.probe.model,
    wedgeModel: f.setup.wedge.model,
    beams: f.beams.length,
    angleStartDeg: f.setup.angle.startDeg,
    angleStopDeg: f.setup.angle.stopDeg,
    angleStepDeg: f.setup.angle.stepDeg,
    positions: f.raster.positions,
    nominalScanCount: f.setup.scan.nominalCount,
    rasterOffset: f.raster.offset,
    beamRecordBytes: rec,
    samples: f.raster.samples,
    sampleIntervalNs: b0.sampleIntervalUs * 1000,
    ascanStartUs: b0.t0Us,
    thicknessMm: f.setup.thicknessMm,
    weldFillHeightMm: f.setup.weldFillHeightMm,
    weldLandHeightMm: f.setup.weldLandHeightMm,
    velocityMps: f.setup.velocityMps,
    gainDb: f.setup.gainDb,
    referenceGainDb: f.setup.referenceGainDb,
    skewDeg: f.setup.skewDeg,
    indexOffsetMm: f.setup.indexOffsetMm,
    wedgeAngleDeg: f.setup.wedge.angleDeg,
    wedgeVelocityMps: f.setup.wedge.velocityMps,
    wedgeOffsetXMm: f.setup.wedge.offsetXMm,
    wedgeHeightMm: f.setup.wedge.heightMm,
    firstBeamExitMm: b0.exitXMm,
    lastBeamExitMm: bl.exitXMm
  }
}

function closeEnough(key: string, actual: SurveyValue, expected: SurveyValue): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const d = DECIMALS.get(key)
    if (d === undefined) return actual === expected
    return Math.abs(actual - expected) <= 0.5 * 10 ** -d + 1e-6
  }
  return actual === expected
}

describe.skipIf(!HAS)('OPD 전수 구조 읽기 (실데이터)', () => {
  const files = new Map<string, OpdFile>()

  it(`${ROWS.length}개 모두 예외 없이 읽고 기준표와 같다`, async () => {
    const problems: string[] = []
    for (const r of ROWS) {
      const path = String(r.path)
      let f: OpdFile
      try {
        f = await readOpdFile(opdPath(path))
      } catch (e) {
        problems.push(`${path}: ${(e as Error).message} [${(e as { detail?: string }).detail ?? ''}]`)
        continue
      }
      files.set(path, f)
      const actual = actualOf(f, f.container.fileSize)
      for (const [k, v] of Object.entries(actual)) {
        if (!closeEnough(k, v, r[k] ?? null)) problems.push(`${path}: ${k} = ${String(v)} (기준 ${String(r[k])})`)
      }
    }
    expect(problems).toEqual([])
    expect(files.size).toBe(ROWS.length)
  })

  it('묶음별 구조: 빔 기록 배치·2축·TCG', () => {
    for (const r of ROWS) {
      const f = files.get(String(r.path))!
      const twoAxis = r.bundle === '부식시험'
      expect(f.raster.twoAxis !== null, String(r.path)).toBe(twoAxis)
      if (twoAxis) expect(f.raster.twoAxis!.indexLines * f.raster.twoAxis!.scanCount).toBe(f.raster.positions)
      const tcgPoints = r.bundle === '6.4T' ? 1 : 4
      for (const b of f.beams) {
        expect(b.tcg).toHaveLength(tcgPoints)
        expect(b.gates.map((g) => g.name)).toEqual(['I', 'A', 'B'])
        expect(b.elementCount).toBe(16)
      }
      expect(f.setup.formation).toBe(f.setup.angle.startDeg === f.setup.angle.stopDeg ? 'linear' : 'sectorial')
      expect(f.header.module).toBe('OMNISX-PA1664PR')
      expect(f.header.serials[0]).toBe(f.header.serials[1])
      expect(f.warnings[0]).toMatch(/OPD/)
    }
  })

  it(
    '자체 점검: 게이트 A 일치 칸 ≥ 기준표, 빈 프레임·255 칸 = 기준표',
    async () => {
      const problems: string[] = []
      const checks = new Map<string, OpdSelfCheck>()
      for (const r of ROWS) {
        const path = String(r.path)
        const f = files.get(path)
        if (!f) continue
        const c = await selfCheckOpd(opdPath(path), { file: f })
        checks.set(path, c)
        if (r.positions === r.nominalScanCount) {
          if (c.emptyFrames !== r.emptyFrames) problems.push(`${path}: 빈 프레임 ${c.emptyFrames} (기준 ${String(r.emptyFrames)})`)
          if (c.saturatedSamples !== r.saturatedSamples) problems.push(`${path}: 255 칸 ${c.saturatedSamples} (기준 ${String(r.saturatedSamples)})`)
        }
        if (r.gateATotal !== null) {
          if (c.gateA.total !== r.gateATotal) problems.push(`${path}: 게이트 A 전체 칸 ${c.gateA.total} (기준 ${String(r.gateATotal)})`)
          if (c.gateA.matched < Number(r.gateAMatched)) problems.push(`${path}: 게이트 A 일치 ${c.gateA.matched} < 기준 ${String(r.gateAMatched)}`)
        }
        if (r.bundle !== '부식시험') {
          expect(c.snell, path).not.toBeNull()
          if (c.snell!.maxDiffMm > 0.05) problems.push(`${path}: 스넬 차 ${c.snell!.maxDiffMm.toFixed(4)} mm`)
        }
      }
      expect(problems).toEqual([])
      // 155개 용접 파일 전체 (1_파서실험 4.3절: 2,540,289 칸 중 2,366,380 칸 = 93.2 %)
      const weld = [...checks.entries()].filter(([p]) => !p.startsWith('04_부식시험'))
      const matched = weld.reduce((s, [, c]) => s + c.gateA.matched, 0)
      const total = weld.reduce((s, [, c]) => s + c.gateA.total, 0)
      if (weld.length === 155) {
        expect(total).toBe(2_540_289)
        expect(matched).toBeGreaterThanOrEqual(2_366_380)
      }
      // Root까지 읽으면 PL2386x를 포함한 155개 모두 두께가 맞는다.
      for (const [p, c] of weld) {
        expect(c.thickness?.mismatch, p).toBe(false)
      }
    },
    600_000
  )
})
