/**
 * SEC20 OPD 36개 ↔ 같은 이름의 conv/*.r01 (OmniscanConverter XML 리포트, 첫 빔만 적힘) 대조 (실데이터가 있는 PC 에서만).
 * r01 은 소수 둘째 자리(각도·주파수는 첫째·둘째)까지 찍혀 있으므로 그 자릿수로 반올림해 비교한다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readOpdFile, type OpdFile } from '@core/opd'
import { opdPath } from '../../paths'

const SEC20_DIR = opdPath('03_라벨미확인/인천지사/SEC20')
const CONV_DIR = resolve(SEC20_DIR, 'conv')
const PAIRS = existsSync(CONV_DIR)
  ? readdirSync(SEC20_DIR)
      .filter((n) => n.toLowerCase().endsWith('.opd'))
      .sort()
      .map((n) => ({ opd: resolve(SEC20_DIR, n), r01: resolve(CONV_DIR, n.replace(/\.opd$/i, '.r01')) }))
      .filter((p) => existsSync(p.r01))
  : []

/** r01 XML 에서 이름이 같은 요소 값들 (스키마 정의 xs: 줄은 제외) */
function elements(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([^<]*)</${name}>`, 'g')
  return [...xml.matchAll(re)].map((m) => m[1]!.trim())
}

function num(s: string | undefined): number {
  const m = /-?\d+(?:\.\d+)?/.exec(s ?? '')
  if (!m) throw new Error(`숫자가 아님: ${s}`)
  return Number(m[0])
}

/** r01 에 찍힌 자릿수로 반올림해 같은가 */
function same(actual: number, r01Text: string | undefined): boolean {
  const m = /-?\d+(?:\.(\d+))?/.exec(r01Text ?? '')
  if (!m) return false
  const d = m[1]?.length ?? 0
  return Math.abs(actual - Number(m[0])) <= 0.5 * 10 ** -d + 1e-9
}

describe.skipIf(PAIRS.length === 0)('SEC20 OPD ↔ r01 (실데이터)', () => {
  it(`${PAIRS.length}개 셋업 값이 r01 과 같다`, async () => {
    const problems: string[] = []
    for (const { opd, r01 } of PAIRS) {
      const f: OpdFile = await readOpdFile(opd)
      const xml = readFileSync(r01, 'utf8')
      const first = (n: string): string | undefined => elements(xml, n)[0]
      const b = f.beams[0]!
      const v = f.setup.velocityMps
      const cos = Math.cos((b.angleDeg * Math.PI) / 180)
      const mm = (us: number): number => (us * v) / 2000
      const checks: Array<[string, number, string | undefined]> = [
        ['Part_Thickness', f.setup.thicknessMm, first('Part_Thickness')],
        ['Area_Scan_Length', f.setup.scan.lengthMm - f.setup.scan.resolutionMm, first('Area_Scan_Length')],
        ['Area_Scan_Resolution', f.setup.scan.resolutionMm, first('Area_Scan_Resolution')],
        ['Probe_Frequency', f.setup.probe.centralFrequencyMHz, first('Probe_Frequency')],
        ['Probe_Pitch', f.setup.probe.pitchMm, first('Probe_Pitch')],
        ['Probe_Aperture', f.setup.aperture * f.setup.probe.pitchMm, first('Probe_Aperture')],
        ['Probe_Element_Qty', f.setup.probe.elementCountFromModel ?? -1, first('Probe_Element_Qty')],
        ['Wedge_Angle', f.setup.wedge.angleDeg, first('Wedge_Angle')],
        ['Wedge_Offset_X', f.setup.wedge.offsetXMm, first('Wedge_Offset_X')],
        ['Wedge_Offset_Z', f.setup.wedge.heightMm, first('Wedge_Offset_Z')],
        ['Wedge_Material_Velocity', f.setup.wedge.velocityMps, first('Wedge_Material_Velocity')],
        ['Calc_Element_Qty', f.setup.aperture, first('Calc_Element_Qty')],
        ['Calc_First_Element', f.setup.firstElement, first('Calc_First_Element')],
        ['Calc_Last_Element', f.setup.firstElement + f.setup.aperture - 1, first('Calc_Last_Element')],
        ['Calc_Material_Velocity', v, first('Calc_Material_Velocity')],
        ['Calc_Start_Angle', f.setup.angle.startDeg, first('Calc_Start_Angle')],
        ['Calc_Stop_Angle', f.setup.angle.stopDeg, first('Calc_Stop_Angle')],
        ['Calc_Angle_Resolution', f.setup.angle.stepDeg, first('Calc_Angle_Resolution')],
        ['Calc_Focal_Depth', f.setup.focusDepthMm, first('Calc_Focal_Depth')],
        ['Delay', b.wedgeDelayUs, first('Delay')],
        ['Start', mm(b.t0Us), first('Start')],
        ['Range', mm(b.rangeUs) * cos, first('Range')],
        ['Gain', f.setup.gainDb, first('Gain')],
        ['Pulse_Width', f.setup.pulseWidthNs, first('Pulse_Width')],
        ['Index_Offset', f.setup.indexOffsetMm, first('Index_Offset')],
        ['Skew', f.setup.skewDeg, first('Skew')]
      ]
      // 게이트 I·A·B 폭 = 깊이 시간 × 음속/2 (True Depth)
      const widths = elements(xml, 'Width')
      b.gates.forEach((g, k) => checks.push([`Gate ${g.name} Width`, mm(g.widthDepthUs), widths[k]]))
      // TCG 점 위치(True Depth) = 시각 × 음속/2 × cos(굴절각) — TCG 시각은 음로 시간
      const tcgPos = elements(xml, 'Position')
      const tcgGain = elements(xml, 'Gain').slice(1) // 첫 Gain 은 빔 이득
      b.tcg.forEach((p, k) => {
        checks.push([`TCG ${k + 1} Position`, mm(p.timeUs) * cos, tcgPos[k]])
        checks.push([`TCG ${k + 1} Gain`, p.gainDb, tcgGain[k]])
      })
      for (const [name, actual, r] of checks) {
        if (!same(actual, r)) problems.push(`${basename(opd)} ${name}: ${actual} (r01 ${String(r)})`)
      }
      const text: Array<[string, string, string | undefined]> = [
        ['Beam_Name', b.name, first('Beam_Name')],
        ['Probe_Model', f.setup.probe.model, first('Probe_Model')],
        ['Probe_Tx_Serial_Number', f.setup.probe.serial, first('Probe_Tx_Serial_Number')],
        ['Wedge_Model', f.setup.wedge.model, first('Wedge_Model')],
        ['Data_File_Name', f.header.deviceFileName, first('Data_File_Name')],
        ['Inspection_Software', f.header.mxuVersion, first('Inspection_Software')],
        ['Module_Type', f.header.module, first('Module_Type')],
        ['Inspection_Date', f.header.savedAt?.slice(0, 10).replace(/-/g, ' / ') ?? '', first('Inspection_Date')],
        ['Calc_Law_Configuration', f.setup.formation === 'sectorial' ? 'Sectorial' : 'Linear', first('Calc_Law_Configuration')]
      ]
      for (const [name, actual, r] of text) if (actual !== r) problems.push(`${basename(opd)} ${name}: '${actual}' (r01 '${String(r)}')`)
      expect(elements(xml, 'TCG_ID')).toHaveLength(b.tcg.length)
    }
    expect(problems).toEqual([])
  })
})
