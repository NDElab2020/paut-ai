/**
 * OPD → 이미지 보기 162개 전수 (실데이터가 있는 PC 에서만, 원시데이터는 읽기만):
 *   - 모두 예외 없이 ViewerFileInfo 가 된다. 2축(부식) 7개만 그리지 않고, 나머지 155개는 그릴 수 있다
 *   - 모두 verified = false (OPD 대조 표가 빔) · 그릴 수 있는 파일엔 blockReason('대조 전' + 자체 점검·두께 이유)
 *   - 두께 불일치(PL2386x 29개)는 blockReason 에 두께 이유 · 기준 이득 0 은 null
 *   - 게이트 A 판정 표 고정 (판단.md 3.2: 저장 구간 안 ≥ 95 % · 전체 ≥ 95 % · 설명할 수 없는 어긋남 ≤ 10 %, 안쪽 칸 없으면 판정 못 함):
 *     통과 88 · 실패 31 · 판정 못 함 36. 전체 일치율이 낮은 12t PCN ROOT/TOP 20개 등은 VERIFIED 를 올려도 계속 막힌다
 *   - 빔 출사점 V = 인덱스 오프셋 ± 출사점 X, t0·샘플 간격 = 기준표, 게이트 빔 시간이 유한
 *   - 대표 파일: 조각(Int16Array) = 구조 읽기 진폭, 상태 0 프레임 수 = 자체 점검 빈 프레임 수(SEC20 sr02_01 691개)
 *   - 원본 크기·수정 시각이 그대로, 열기 시간 기록
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readOpdAmplitude, readOpdFile } from '@core/opd'
import { opdSelfCheckPassed, readOpdViewerChunk, readOpdViewerInfo } from '@core/opd/viewer'
import { chunkRanges } from '@shared/imaging'
import type { ViewerFileInfo } from '@shared/imaging/types'
import { OPD_FILES, RAW_DATA_DIR, opdPath } from '../../paths'
import { loadSurveyJson } from './surveyCsv'

function walk(dir: string, out: string[]): string[] {
  for (const n of readdirSync(dir).sort()) {
    if (n.startsWith('.')) continue
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.opd$/i.test(n)) out.push(p)
  }
  return out
}

const HAS = existsSync(RAW_DATA_DIR)
const FILES = HAS ? walk(RAW_DATA_DIR, []) : []
const SURVEY = new Map(loadSurveyJson().rows.map((r) => [String(r.path), r]))
const rel = (p: string): string => relative(RAW_DATA_DIR, p).split('\\').join('/').normalize('NFC')

describe.skipIf(!HAS || FILES.length === 0)('OPD → 이미지 보기 전수 (실데이터)', () => {
  const infos = new Map<string, ViewerFileInfo>()
  const before = new Map<string, { size: number; mtimeMs: number }>()

  it(`${FILES.length}개 모두 ViewerFileInfo 가 된다 (2축만 그리지 않음, 모두 대조 전)`, async () => {
    expect(FILES.length).toBe(162)
    const times: number[] = []
    for (const p of FILES) {
      const st = statSync(p)
      before.set(p, { size: st.size, mtimeMs: st.mtimeMs })
      const t = performance.now()
      const info = await readOpdViewerInfo(p)
      times.push(performance.now() - t)
      infos.set(p, info)
      const g = info.groups[0]!
      const r = SURVEY.get(rel(p))
      expect(r, rel(p)).toBeTruthy()
      expect(info.formatFamily).toBe('opd')
      expect(g.verified).toBe(false)
      expect(g.shape).toEqual([r!.positions, r!.beams, 320])
      const twoAxis = String(rel(p)).startsWith('04_부식시험/')
      if (twoAxis) {
        expect([g.supported, g.blockReason], rel(p)).toEqual([false, null])
        expect(g.reason).toMatch(/^2축 스캔/)
        continue
      }
      expect([g.supported, g.reason], rel(p)).toEqual([true, null])
      expect(g.blockReason, rel(p)).toMatch(/^OPD 파일이라 자동 변환·학습 내보내기를 막습니다: OmniPC 대조 전\(OPD (섹토리얼|리니어) · 스큐 (90|270)\)/)
      expect(g.selfCheck?.passed.snell, rel(p)).toBe(true)
    }
    const supported = [...infos.values()].filter((i) => i.groups[0]!.supported)
    expect(supported).toHaveLength(155)
    // 열기(구조 읽기 + 자체 점검) 시간 — 기록용 (디스크 캐시 상태에 따라 다름)
    const sorted = [...times].sort((a, b) => a - b)
    console.info(`[OPD 이미지 보기 열기] ${FILES.length}개 중앙값 ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} ms, 최대 ${sorted.at(-1)!.toFixed(1)} ms`)
  })

  it('빔·축·이득은 구조 읽기 값 그대로 (출사점 V = 인덱스 오프셋 ± 출사점 X, 기준 이득 0 → null)', async () => {
    for (const p of FILES) {
      const info = infos.get(p) ?? (await readOpdViewerInfo(p))
      const g = info.groups[0]!
      if (!g.supported) continue
      const f = await readOpdFile(p)
      const r = SURVEY.get(rel(p))!
      const sign = f.setup.skewDeg === 90 ? 1 : -1
      g.beams.forEach((b, i) => {
        expect(b.vOffsetMm).toBeCloseTo(f.setup.indexOffsetMm + sign * f.beams[i]!.exitXMm, 9)
        expect(b.t0Us).toBeCloseTo(Number(r.ascanStartUs), 6)
        expect(b.velocityMps).toBe(f.setup.velocityMps)
      })
      expect(g.ultrasound.resolutionUs * 1000).toBeCloseTo(Number(r.sampleIntervalNs), 6)
      expect(g.referenceGainDb).toBe(Number(r.referenceGainDb) === 0 ? null : f.setup.referenceGainDb)
      expect(info.specimen.thicknessMm).toBe(f.setup.thicknessMm)
      for (const gate of g.gates) {
        expect(gate.startUs).toHaveLength(g.beams.length)
        expect(gate.startUs.every(Number.isFinite) && gate.lengthUs.every((x) => Number.isFinite(x) && x >= 0)).toBe(true)
      }
    }
  })

  it('Root를 포함하면 PL2386x를 비롯한 전수 파일에 잘못된 두께 불일치 이유가 없다', () => {
    const thick = [...infos.entries()].filter(([, i]) => i.groups[0]!.blockReason?.includes('두께 칸')).map(([p]) => rel(p))
    expect(thick).toEqual([])
  })

  it('게이트 A 판정 표 — 통과 88 · 실패 31 · 판정 못 함 36, 낮은 전체 일치율·안쪽 칸 없음은 대조 표를 올려도 막힘', async () => {
    const rows: Array<{ p: string; sc: NonNullable<ViewerFileInfo['groups'][0]['selfCheck']> }> = []
    for (const p of FILES) {
      const info = infos.get(p) ?? (await readOpdViewerInfo(p))
      const sc = info.groups[0]!.selfCheck
      if (sc) rows.push({ p: rel(p), sc })
    }
    expect(rows).toHaveLength(155)
    const pass = rows.filter((r) => r.sc.passed.gateA === true)
    const fail = rows.filter((r) => r.sc.passed.gateA === false)
    const none = rows.filter((r) => r.sc.passed.gateA === null)
    expect([pass.length, fail.length, none.length]).toEqual([88, 31, 36])
    // 안쪽 칸 없음 36개: PL ROOT 6 · 6.4T 4 · TP SW 18 · TP11~14 ROOT 8 (전체 일치율이 95 % 넘어도 판정 못 함 — 22개)
    expect(none.every((r) => r.sc.gateAAgreement === null)).toBe(true)
    expect(none.filter((r) => r.sc.gateAAgreementAll >= 0.95)).toHaveLength(22)
    // 안쪽은 통과인데 전체 일치율 < 95 %: PL BOT 8 · 12t PCN ROOT/TOP 20 (TP01·02·04·07·tp07·08) · SEC20 sr04_16
    const lowAll = rows.filter((r) => r.sc.gateAAgreement !== null && r.sc.gateAAgreement >= 0.95 && r.sc.gateAAgreementAll < 0.95).map((r) => r.p)
    expect(lowAll).toHaveLength(29)
    expect(lowAll.filter((p) => /PL2386\d\/PL2386\d_BOT_/.test(p))).toHaveLength(8)
    expect(lowAll.filter((p) => /\/(TP0[1247]|tp07|TP08)-(ROOT|TOP)-/i.test(p))).toHaveLength(20)
    expect(lowAll.filter((p) => p.endsWith('S20_sr04_16.opd'))).toHaveLength(1)
    // VERIFIED 에 (기법·스큐)를 올려도 이 파일들은 자체 점검에서 막힌다 (verified = 대조 표 && opdSelfCheckPassed)
    for (const r of [...none, ...fail]) expect(opdSelfCheckPassed(r.sc), r.p).toBe(false)
    // 설명할 수 없는 어긋남(장비 값 < 재계산)은 실데이터 최대 4.5 % (기준 10 %) · 손상 의심 프레임 0
    const maxUnexplained = Math.max(...rows.map((r) => r.sc.gateAUnexplained))
    expect(maxUnexplained).toBeLessThan(0.05)
    expect(rows.every((r) => r.sc.suspectFrames === 0)).toBe(true)
    // 센 신호(raw ≥ 224) 칸은 절반쯤만 맞는다 — 막는 이유에 따로 적힌다
    const strong = rows.filter((r) => r.sc.gateAStrongAgreement !== null && r.sc.gateAStrongAgreement < 0.95)
    for (const r of strong) expect(infos.get(opdPath(r.p))?.groups[0]!.blockReasons?.some((x) => x.code === 'strong-signal'), r.p).toBe(true)
    console.info(`[OPD 게이트 A 판정] 통과 ${pass.length} · 실패 ${fail.length} · 판정 못 함 ${none.length}, 설명할 수 없는 어긋남 최대 ${(maxUnexplained * 100).toFixed(2)} %, 센 신호 칸 일치 < 95 % 파일 ${strong.length}개`)
  })

  it('대표 파일: 조각 = 구조 읽기 진폭(Int16Array), 상태 0 프레임 수 = 빈 프레임 수', async () => {
    for (const key of ['tp14RootL', 'tp01SwL', 'sec20sr02_01', 'sec25sr1_04', 's36_1'] as const) {
      const p = opdPath(OPD_FILES[key])
      if (!existsSync(p)) continue
      const info = infos.get(p) ?? (await readOpdViewerInfo(p))
      const g = info.groups[0]!
      const ref = await readOpdAmplitude(p, 0, g.shape[0], { format: 'int16' })
      let zeroFrames = 0
      let at = 0
      for (const [s, n] of chunkRanges(g.shape)) {
        const c = await readOpdViewerChunk(p, g, s, n)
        expect(c.amplitude).toBeInstanceOf(Int16Array)
        expect(c.scanCount).toBe(n)
        for (let i = 0; i < c.amplitude.length; i++) if (c.amplitude[i] !== ref.amplitude[at + i]) throw new Error(`${key} 진폭 다름 @${at + i}`)
        at += c.amplitude.length
        for (let k = 0; k < n; k++) if (c.status![k * g.shape[1]] === 0) zeroFrames++
      }
      expect(at).toBe(ref.amplitude.length)
      expect(zeroFrames, key).toBe(g.selfCheck!.emptyFrames)
      if (key === 'sec20sr02_01') expect(zeroFrames).toBe(691)
    }
  })

  it('원본은 읽기만 (크기·수정 시각 그대로)', () => {
    for (const [p, b] of before) {
      const st = statSync(p)
      expect({ size: st.size, mtimeMs: st.mtimeMs }, rel(p)).toEqual(b)
    }
  })
})
