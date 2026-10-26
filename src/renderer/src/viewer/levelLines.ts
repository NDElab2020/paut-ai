/**
 * A-scan 진폭 축의 기준선 (OmniPC 조사 X3 — OmniPC_조사/조사_보고.md 6.3절). 순수 계산·그리기 (React 없음, tests/viewerLevels.test.ts).
 *
 *   Ref  = 파일 셋업으로 추정한 기준 감도 %FSH (shared/labels/levels.ts refPctFromSetup — 기준 진폭 × 10^((이득 − 기준 이득)/20), X3 159.6 %)
 *   기록·평가 기준 = 시방서 표 13 (levels.ts amplitudeLevels): 8 ≤ t ≤ 15 → 기록 Ref −8 dB(ℓ ≤ t)·평가 Ref −14 dB(ℓ > t 면 기록도 −14),
 *                   3.2 ≤ t < 8 → 평가·기록 Ref −12 dB. 두께가 표 밖이면 Ref 선만.
 *   화면 소프트 이득 Δ 만큼 옮긴다 (gainedScale 과 같은 규칙: 화면 % = 파일 % × 10^(Δ/20)).
 *
 * OmniPC 의 빨간 TCG 선(80 %)·회색 −6 dB 선(40 %)과는 다른 선이다 — OmniPC 는 Gain 6 dB 화면에서도 기준 이득 높이에 그리므로(TF 캡처 실측)
 * 그 선에 닿은 신호는 Ref −6 dB 다. 여기 선은 '파일 이득 화면' 기준이라 이름을 OmniPC 선과 섞지 않는다. Ref 는 OmniPC 대조 전(캡처 46).
 * 그래서 'Ref' 라는 이름의 선(파일 이득 기준 X3 159.6 %)은 그리지 않는다(2026-10-07 검토 — 조사_보고 6.3절 X3 '무엇' 은 평가·기록 선만):
 * 진폭 축을 200 % 로 넓히거나 Δ 를 내리면 OmniPC 의 'Ref.'(80 % 빨간 선)와 다른 높이에 'Ref' 가 하나 더 보여 대조하는 판독자가 헷갈린다.
 * Ref 값은 조정 패널 툴팁(legend)에만 숫자로 둔다.
 *
 * 켜고 끄기: 조정 패널 색표 탭. 라벨 모드 기본 켬, 보통 모드 기본 끔 — 끄면 A-scan 에 캔버스를 만들지 않아 보통 모드 그림은 바이트 그대로.
 * 켜고 끈 값은 이 세션 동안 모드마다 기억한다(파일을 바꿔도 이어짐, 앱을 다시 열면 기본값).
 */
import { amplitudeLevels, amplitudeTableOf, refPctFromSetup, type AmplitudeTable } from '@shared/labels'
import type { RefBasis, ViewerGroup } from '@shared/imaging'

/** 그리는 선: 기록 기준·평가 기준 (Ref 선 자체는 그리지 않는다 — 머리 주석) */
export type AscanLevelId = 'recording' | 'evaluation'

export interface AscanLevelLine {
  id: AscanLevelId
  /** 화면 진폭 % (소프트 이득 Δ 반영) */
  pct: number
  /** Ref 대비 dB (음수) */
  db: number
  /** 캔버스 글자 (짧게, 12 px) */
  label: string
}

export interface AscanLevels {
  lines: AscanLevelLine[]
  /** 파일 이득(Δ = 0)에서의 Ref %FSH */
  refPct: number
  table: AmplitudeTable | null
  refBasis: RefBasis | null
  /** 사람이 읽을 한 줄 (조정 패널 툴팁): 'Ref(파일 이득 추정, 선 없음) 159.6 % · 기록 −8 dB 63.5 % · 평가 −14 dB 31.8 % …' */
  legend: string
  /** Ref 근거가 약할 때 한 마디 (X2 — 없으면 null) */
  basisNote: string | null
}

/** 숫자 한 자리 + 빼기 글자 '−' */
function f1(v: number): string {
  return v.toFixed(1).replace('-', '−')
}

/** Ref 근거 단계 → 판독자에게 보일 한 마디 (X2). 'tcg'·모름은 null */
export function refBasisNote(basis: RefBasis | null | undefined): string | null {
  if (basis === 'single-depth') return 'Ref 근거 약함(TCG 없음 — 기준 진폭이 한 깊이에서만 맞음)'
  if (basis === 'none') return 'Ref 없음(기준 이득 0)'
  return null
}

/**
 * 그룹의 A-scan 기준선(기록·평가). Ref 를 추정할 수 없으면(기준 이득 0·없음, 이득 모름) null.
 * 두께가 표 13 밖이면 lines 는 빈 배열(Ref 숫자는 legend 에만).
 * displayGainDb = 화면 소프트 이득 Δ (그 그룹).
 */
export function ascanLevelsOf(
  group: Pick<ViewerGroup, 'gainDb' | 'referenceGainDb' | 'referenceAmplitudePct' | 'refBasis'>,
  thicknessMm: number | null,
  displayGainDb: number
): AscanLevels | null {
  // 기준 이득 0 은 Ref 를 표시하지 않는다 (뷰어·derive groupLevelsOf 와 같은 규칙)
  const refGain = group.referenceGainDb !== null && group.referenceGainDb !== 0 ? group.referenceGainDb : null
  const refPct = refPctFromSetup(group.gainDb, refGain, group.referenceAmplitudePct)
  if (refPct === null || !(refPct > 0)) return null
  const k = displayGainDb ? 10 ** (displayGainDb / 20) : 1
  const at = (db: number): number => refPct * 10 ** (db / 20) * k
  const table = amplitudeTableOf(thicknessMm)
  const lines: AscanLevelLine[] = []
  const parts = [`Ref(파일 이득 추정 — 선은 그리지 않음) ${f1(refPct * k)} %`]
  if (table !== null && thicknessMm !== null) {
    const short = amplitudeLevels({ maxAmplitudePct: null, refPct, lengthMm: 0, thicknessMm })
    const long = amplitudeLevels({ maxAmplitudePct: null, refPct, lengthMm: thicknessMm + 1, thicknessMm })
    const ev = short.evaluationLevelDb
    const recS = short.recordingLevelDb
    const recL = long.recordingLevelDb
    if (ev !== null && recS !== null && recL !== null) {
      if (recS !== ev) {
        lines.push({ id: 'recording', pct: at(recS), db: recS, label: `기록 ${f1(recS).replace('.0', '')}` })
        parts.push(`기록 ${f1(recS)} dB ${f1(at(recS))} %(ℓ ≤ t)`)
      }
      const both = recS === ev || recL === ev
      lines.push({ id: 'evaluation', pct: at(ev), db: ev, label: `${recS === ev ? '평가·기록' : '평가'} ${f1(ev).replace('.0', '')}` })
      parts.push(`${recS === ev ? '평가·기록' : '평가'} ${f1(ev)} dB ${f1(at(ev))} %${both && recS !== ev ? '(ℓ > t 면 기록도)' : ''}`)
    }
  } else {
    parts.push('두께가 시방서 표 13 범위 밖이라 평가·기록 기준선은 없음')
  }
  const tail = [
    displayGainDb ? `화면 이득 Δ ${displayGainDb > 0 ? '+' : ''}${f1(displayGainDb)} dB 반영` : '파일 이득 그대로(Δ 0 dB)',
    'Ref 는 파일 이득·기준 이득으로 추정한 값 — OmniPC 대조 전',
    'OmniPC 의 빨간 TCG 선(80 %)과 다른 선'
  ]
  const basisNote = refBasisNote(group.refBasis)
  if (basisNote) tail.unshift(basisNote)
  return { lines, refPct, table, refBasis: group.refBasis ?? null, legend: `${parts.join(' · ')} (${tail.join(' · ')})`, basisNote }
}

// ──────────────────────────────── 켜고 끄기 (세션, 모드마다) ────────────────────────────────

export interface LevelLinePrefs {
  /** 보통 모드 (기본 끔 — 그림 바이트 그대로) */
  normal: boolean
  /** 라벨 모드 (기본 켬) */
  label: boolean
}

export const DEFAULT_LEVEL_LINE_PREFS: Readonly<LevelLinePrefs> = { normal: false, label: true }

let prefs: LevelLinePrefs = { ...DEFAULT_LEVEL_LINE_PREFS }

export function levelLinePrefs(): LevelLinePrefs {
  return { ...prefs }
}

/** 지금 모드의 켜짐 */
export function levelLinesOn(p: LevelLinePrefs, labelOn: boolean): boolean {
  return labelOn ? p.label : p.normal
}

/** 지금 모드의 값만 바꾼 새 설정 (세션에 기억) */
export function setLevelLinesOn(labelOn: boolean, on: boolean): LevelLinePrefs {
  prefs = labelOn ? { ...prefs, label: on } : { ...prefs, normal: on }
  return { ...prefs }
}

/** 시험용: 기본값으로 */
export function resetLevelLinePrefs(): void {
  prefs = { ...DEFAULT_LEVEL_LINE_PREFS }
}

// ──────────────────────────────── 그리기 ────────────────────────────────

/** 진폭 % → 캔버스 x (A-scan 그리기의 X() 와 같은 식: 0~ampMax 를 폭에). 축 밖이면 null (끝에 붙이지 않는다 — 잘못 읽히지 않게) */
export function levelLineX(pct: number, ampMaxPct: number, width: number): number | null {
  if (!(ampMaxPct > 0) || !Number.isFinite(pct) || pct < 0 || pct > ampMaxPct) return null
  return Math.round((pct / ampMaxPct) * width) + 0.5
}

/** 선마다 점선 무늬 (기록 중간 · 평가 짧은 점선) */
const DASH: Record<AscanLevelId, [number, number]> = { recording: [4, 4], evaluation: [2, 3] }

/** 최소 2D 컨텍스트 (시험의 기록 캔버스도 받게) */
export interface LevelCtx {
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  setLineDash(segments: number[]): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
}

/** 기준선 꼬리표 (캔버스 오른쪽 위 — 머리 글자 칸은 A-scan 열이 좁아 넘치고, 왼쪽 위는 게이트 이름 'A' 자리) */
export const LEVEL_TAG = 'Ref 대조 전'

/** 글자 줄 수 상한 (넘으면 마지막 줄에 겹쳐 쓴다) */
const LABEL_ROWS = 3

/**
 * 기준선을 세로 점선으로 (A-scan 은 세로 = 깊이, 가로 = 진폭). 글자는 위쪽 — 선 오른쪽(오른쪽 끝에 닿으면 선 왼쪽), 다른 글자와 겹치면
 * 다음 줄로(3줄까지). tag(꼬리표)는 보이는 선이 있을 때만 첫 줄 오른쪽 끝에. 선이 없거나 모두 축 밖이면 컨텍스트를 건드리지 않는다.
 * 돌려주는 값 = 그린 선 수.
 */
export function drawLevelLines(
  ctx: LevelCtx,
  lines: readonly AscanLevelLine[],
  map: { ampMaxPct: number; width: number; height: number },
  style: { stroke: string; font: string; fontPx: number },
  ratio: number,
  tag: string | null = LEVEL_TAG
): number {
  const xs = lines.map((l) => ({ l, x: levelLineX(l.pct, map.ampMaxPct, map.width) })).filter((v): v is { l: AscanLevelLine; x: number } => v.x !== null)
  if (!xs.length) return 0
  const lw = Math.max(1, ratio)
  ctx.strokeStyle = style.stroke
  ctx.fillStyle = style.stroke
  ctx.lineWidth = lw
  ctx.font = `${style.fontPx * ratio}px ${style.font}`
  for (const { l, x } of xs) {
    ctx.setLineDash(DASH[l.id].map((d) => d * lw))
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, map.height)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // 글자 자리: 줄마다 차지한 [시작, 끝] 구간을 기억해, 겹치지 않는 첫 줄에
  const pad = 3 * ratio
  const lineH = (style.fontPx + 2) * ratio
  const rows: Array<Array<[number, number]>> = []
  const place = (x0: number, w: number): number => {
    const free = (r: Array<[number, number]>): boolean => r.every(([a, b]) => x0 + w + pad <= a || x0 >= b + pad)
    let row = rows.findIndex(free)
    if (row < 0) row = rows.length < LABEL_ROWS ? rows.length : LABEL_ROWS - 1
    ;(rows[row] ??= []).push([x0, x0 + w])
    return row
  }
  ctx.textAlign = 'left'
  if (tag) {
    const w = ctx.measureText(tag).width
    const x0 = Math.max(pad, map.width - pad - w)
    ctx.fillText(tag, x0, lineH * (place(x0, w) + 1))
  }
  for (const { l, x } of [...xs].sort((a, b) => a.x - b.x)) {
    const w = ctx.measureText(l.label).width
    const x0 = x + pad + w <= map.width ? x + pad : x - pad - w
    ctx.fillText(l.label, x0, lineH * (place(x0, w) + 1))
  }
  return xs.length
}
