/**
 * A-scan 기준선 (OmniPC 조사 X3 — renderer/src/viewer/levelLines.ts):
 *  - 값: levels.ts 와 같은 Ref·기록·평가 기준 (X3: Ref 159.6 %, 기록 −8 dB 63.5 %, 평가 −14 dB 31.8 %), 화면 이득 Δ 만큼 옮김
 *  - 'Ref' 라는 이름의 선은 그리지 않는다 (OmniPC 의 'Ref.' 80 % 빨간 선과 섞이지 않게 — 2026-10-07 검토). Ref 값은 툴팁 글자에만
 *  - 위치: % → px 가 A-scan 그리기(AscanView X() + 0.5)와 ±1 px, 축 밖 선은 그리지 않음
 *  - 끄면(선 없음) 캔버스를 건드리지 않음 → 보통 모드 그림 바이트 그대로. 켜짐 기본값: 보통 끔·라벨 켬(모드마다 기억)
 *  - Ref 근거(X2): TCG 없음이면 '근거 약함'
 */
import { describe, expect, it } from 'vitest'
import { amplitudeLevels, refPctFromSetup } from '@shared/labels'

const LEVELS = '../src/renderer/src/viewer/levelLines'
type RefBasis = 'tcg' | 'single-depth' | 'none'
interface Line {
  id: 'recording' | 'evaluation'
  pct: number
  db: number
  label: string
}
interface Levels {
  lines: Line[]
  refPct: number
  table: string | null
  refBasis: RefBasis | null
  legend: string
  basisNote: string | null
}
interface Prefs {
  normal: boolean
  label: boolean
}
const L = (await import(LEVELS)) as {
  ascanLevelsOf: (g: { gainDb: number | null; referenceGainDb: number | null; referenceAmplitudePct: number | null; refBasis?: RefBasis }, t: number | null, dB: number) => Levels | null
  refBasisNote: (b: RefBasis | null | undefined) => string | null
  levelLineX: (pct: number, ampMax: number, width: number) => number | null
  drawLevelLines: (ctx: unknown, lines: Line[], map: { ampMaxPct: number; width: number; height: number }, style: { stroke: string; font: string; fontPx: number }, ratio: number, tag?: string | null) => number
  LEVEL_TAG: string
  DEFAULT_LEVEL_LINE_PREFS: Prefs
  levelLinePrefs: () => Prefs
  levelLinesOn: (p: Prefs, labelOn: boolean) => boolean
  setLevelLinesOn: (labelOn: boolean, on: boolean) => Prefs
  resetLevelLinePrefs: () => void
}

/** X3 12T-SV: 파일 이득 24.7 dB, 기준 이득 18.7 dB(Δ 6.0), 기준 진폭 80 %, 두께 12 mm */
const X3 = { gainDb: 24.7, referenceGainDb: 18.7, referenceAmplitudePct: 80, refBasis: 'tcg' as const }

/** 그리기 호출을 적어 두는 가짜 캔버스 (글자 폭 = 글자 수 × 7) */
function recorder() {
  const calls: Array<[string, ...Array<number | string>]> = []
  const ctx: Record<string, unknown> = { strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: 'left' }
  for (const m of ['beginPath', 'stroke']) ctx[m] = () => calls.push([m])
  for (const m of ['moveTo', 'lineTo']) ctx[m] = (...a: number[]) => calls.push([m, ...a])
  ctx['setLineDash'] = (seg: number[]) => calls.push(['setLineDash', seg.length])
  ctx['fillText'] = (t: string, x: number, y: number) => calls.push(['fillText', t, x, y])
  ctx['measureText'] = (t: string) => ({ width: t.length * 7 })
  const proxy = new Proxy(ctx, {
    set(t, k, v) {
      calls.push(['set:' + String(k)])
      t[k as string] = v
      return true
    }
  })
  return { ctx: proxy, calls }
}

describe('기준선 값 (levels.ts 와 같은 식)', () => {
  it('X3 (t = 12): 선은 기록 −8 dB 63.5 % · 평가 −14 dB 31.8 % 둘뿐, Ref 159.6 % 는 글자(legend)에만', () => {
    const lv = L.ascanLevelsOf(X3, 12, 0)!
    expect(lv.table).toBe('19285-L2')
    expect(lv.lines.map((l) => l.id)).toEqual(['recording', 'evaluation'])
    const [rec, ev] = lv.lines
    expect(lv.refPct).toBeCloseTo(159.62, 1)
    expect(rec!.pct).toBeCloseTo(63.55, 1)
    expect(ev!.pct).toBeCloseTo(31.85, 1)
    expect([rec!.db, ev!.db]).toEqual([-8, -14])
    expect(lv.lines.map((l) => l.label)).toEqual(['기록 −8', '평가 −14'])
    expect(lv.lines.some((l) => /^Ref/.test(l.label))).toBe(false)
    // levels.ts 식 그대로 (Ref 추정 = refPctFromSetup, 기준 dB = amplitudeLevels)
    const refPct = refPctFromSetup(24.7, 18.7, 80)!
    expect(lv.refPct).toBeCloseTo(refPct, 9)
    const a = amplitudeLevels({ maxAmplitudePct: ev!.pct, refPct, lengthMm: 20, thicknessMm: 12 })
    expect(a.refDb!).toBeCloseTo(-14, 9)
    expect(lv.legend).toMatch(/Ref\(파일 이득 추정 — 선은 그리지 않음\) 159\.6 %/)
    expect(lv.legend).toMatch(/ℓ > t 면 기록도/)
    expect(lv.legend).toMatch(/OmniPC 대조 전/)
    expect(lv.basisNote).toBeNull()
  })

  it('화면 이득 Δ +6 dB 면 모든 선이 × 10^(6/20) (gainedScale 과 같은 규칙)', () => {
    const a = L.ascanLevelsOf(X3, 12, 0)!
    const b = L.ascanLevelsOf(X3, 12, 6)!
    a.lines.forEach((l, i) => expect(b.lines[i]!.pct).toBeCloseTo(l.pct * 10 ** (6 / 20), 9))
    expect(b.refPct).toBeCloseTo(a.refPct, 9) // 파일 이득 Ref 는 그대로
    expect(b.legend).toMatch(/화면 이득 Δ \+6\.0 dB 반영/)
  })

  it('t < 8 (4761-L2): 평가·기록 −12 dB 하나, 두께가 표 밖이면 선 없음(글자만), 기준 이득 0 이면 null', () => {
    const t6 = L.ascanLevelsOf(X3, 6, 0)!
    expect(t6.lines.map((l) => [l.id, l.label])).toEqual([['evaluation', '평가·기록 −12']])
    expect(t6.lines[0]!.pct).toBeCloseTo(159.62 * 10 ** (-12 / 20), 1)
    const t20 = L.ascanLevelsOf(X3, 20, 0)!
    expect(t20.lines).toEqual([])
    expect(t20.legend).toMatch(/평가·기록 기준선은 없음/)
    expect(L.ascanLevelsOf(X3, null, 0)!.lines.length).toBe(0)
    expect(L.ascanLevelsOf({ ...X3, referenceGainDb: 0 }, 12, 0)).toBeNull()
    expect(L.ascanLevelsOf({ ...X3, referenceGainDb: null }, 12, 0)).toBeNull()
    expect(L.ascanLevelsOf({ ...X3, gainDb: null }, 12, 0)).toBeNull()
  })

  it('Ref 근거 (X2): TCG 없음 = 근거 약함, 기준 이득 없음 = Ref 없음, TCG·모름 = 표시 없음', () => {
    expect(L.refBasisNote('single-depth')).toMatch(/근거 약함\(TCG 없음/)
    expect(L.refBasisNote('none')).toMatch(/Ref 없음/)
    expect(L.refBasisNote('tcg')).toBeNull()
    expect(L.refBasisNote(undefined)).toBeNull()
    const weak = L.ascanLevelsOf({ ...X3, refBasis: 'single-depth' }, 12, 0)!
    expect(weak.basisNote).toMatch(/근거 약함/)
    expect(weak.legend).toMatch(/근거 약함/)
  })
})

describe('기준선 위치 (% → px ±1, A-scan 그리기와 같은 식)', () => {
  /** AscanView 의 X(): (clamp(pct, 0, ampMax) / ampMax) × 폭, 세로선은 반올림 + 0.5 */
  const ascanX = (pct: number, ampMax: number, w: number): number => Math.round((Math.max(0, Math.min(ampMax, pct)) / ampMax) * w) + 0.5

  it('폭·축 상한 여럿에서 ±1 px, 축 밖은 null (끝에 붙이지 않음)', () => {
    const lv = L.ascanLevelsOf(X3, 12, 0)!
    for (const w of [180, 263, 400, 801]) {
      for (const ampMax of [100, 200, 250]) {
        for (const l of lv.lines) {
          const x = L.levelLineX(l.pct, ampMax, w)
          if (l.pct > ampMax) {
            expect(x).toBeNull()
            continue
          }
          expect(x).not.toBeNull()
          expect(Math.abs(x! - (l.pct / ampMax) * w)).toBeLessThanOrEqual(1)
          expect(x).toBe(ascanX(l.pct, ampMax, w))
        }
      }
    }
    // 100 % 축: Ref(159.6 %) 는 없음, 기록 63.5 %·평가 31.8 %
    expect(L.levelLineX(159.6, 100, 300)).toBeNull()
    expect(L.levelLineX(-1, 100, 300)).toBeNull()
    expect(L.levelLineX(31.85, 100, 300)).toBe(96.5)
  })

  it('그리기: 세로 점선의 x 가 levelLineX 와 같고 높이 전체, 축 밖 선은 빠짐', () => {
    const lv = L.ascanLevelsOf(X3, 12, 0)!
    const { ctx, calls } = recorder()
    const n = L.drawLevelLines(ctx, lv.lines, { ampMaxPct: 100, width: 300, height: 500 }, { stroke: '#5c5e62', font: 'Inter', fontPx: 12 }, 1)
    expect(n).toBe(2)
    const moves = calls.filter((c) => c[0] === 'moveTo').map((c) => c[1])
    const tos = calls.filter((c) => c[0] === 'lineTo')
    expect(moves).toEqual([L.levelLineX(lv.lines[0]!.pct, 100, 300), L.levelLineX(lv.lines[1]!.pct, 100, 300)])
    expect(tos.every((c) => c[2] === 500)).toBe(true)
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    // 꼬리표 'Ref 대조 전' 은 왼쪽 위 첫 줄 (Ref 는 파일 셋업 추정 — OmniPC 대조 전)
    expect(L.LEVEL_TAG).toBe('Ref 대조 전')
    expect(texts[0]).toBe('Ref 대조 전')
    expect(texts.slice(1).sort()).toEqual(['기록 −8', '평가 −14'])
    const noTag = recorder()
    L.drawLevelLines(noTag.ctx, lv.lines, { ampMaxPct: 100, width: 300, height: 500 }, { stroke: '#5c5e62', font: 'Inter', fontPx: 12 }, 1, null)
    expect(noTag.calls.filter((c) => c[0] === 'fillText').map((c) => c[1])).not.toContain('Ref 대조 전')
  })

  it('가까운 선의 글자는 겹치지 않게 다음 줄로, 오른쪽 끝에 닿으면 선 왼쪽에', () => {
    const lines: Line[] = [
      { id: 'evaluation', pct: 30, db: -14, label: '평가 −14' },
      { id: 'recording', pct: 33, db: -8, label: '기록 −8' },
      { id: 'evaluation', pct: 99, db: -1, label: '끝선' }
    ]
    const { ctx, calls } = recorder()
    L.drawLevelLines(ctx, lines, { ampMaxPct: 100, width: 200, height: 100 }, { stroke: '#000', font: 'Inter', fontPx: 12 }, 1)
    const t = Object.fromEntries(calls.filter((c) => c[0] === 'fillText').map((c) => [c[1], { x: c[2] as number, y: c[3] as number }]))
    expect(t['기록 −8']!.y).toBeGreaterThan(t['평가 −14']!.y)
    // 99 % 선(198.5 px) 은 글자가 오른쪽 끝을 넘으므로 선 왼쪽
    expect(t['끝선']!.x + '끝선'.length * 7).toBeLessThanOrEqual(198.5)
  })

  it('선이 없거나 모두 축 밖이면 캔버스를 건드리지 않는다 (보통 모드 바이트 그대로)', () => {
    for (const lines of [[], [{ id: 'recording' as const, pct: 159.6, db: 0, label: '축 밖' }]]) {
      const { ctx, calls } = recorder()
      expect(L.drawLevelLines(ctx, lines, { ampMaxPct: 100, width: 300, height: 500 }, { stroke: '#000', font: 'Inter', fontPx: 12 }, 2)).toBe(0)
      expect(calls).toEqual([])
    }
  })
})

describe('켜고 끄기 (모드마다, 세션 기억)', () => {
  it('기본: 보통 모드 끔(그림 바이트 그대로) · 라벨 모드 켬', () => {
    L.resetLevelLinePrefs()
    expect(L.DEFAULT_LEVEL_LINE_PREFS).toEqual({ normal: false, label: true })
    const p = L.levelLinePrefs()
    expect(L.levelLinesOn(p, false)).toBe(false)
    expect(L.levelLinesOn(p, true)).toBe(true)
  })

  it('한 모드에서 바꿔도 다른 모드 값은 그대로, 다음 파일(새 화면)도 같은 값으로 시작', () => {
    L.resetLevelLinePrefs()
    const a = L.setLevelLinesOn(true, false)
    expect(a).toEqual({ normal: false, label: false })
    const b = L.setLevelLinesOn(false, true)
    expect(b).toEqual({ normal: true, label: false })
    expect(L.levelLinePrefs()).toEqual({ normal: true, label: false })
    L.resetLevelLinePrefs()
    expect(L.levelLinePrefs()).toEqual({ normal: false, label: true })
  })
})
