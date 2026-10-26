/**
 * C-scan 을 OmniPC 'Export C-scan' 과 같은 꼴의 .txt 로 (X8). 런타임 의존성 없음.
 *
 * 근거 (허용 근거만): 사용자 폴더 문서/Evident/OmniPC/Export 의 TP14 내보내기 파일(OmniPC 6.6 이 보통 사용으로 만든 것, 읽기만)과
 * MXU 5.6·5.8 설명서 표 51·53(내보내기 머리말 칸)·'열 = 스캔, 행 = 인덱스(맨 위가 Index End)'.
 *   - ASCII 글자, 줄 끝 CRLF(마지막 줄 포함), 칸 구분 탭
 *   - 머리말 21줄 `이름 = 값` (아래 순서·글자 그대로) → `Deg / mm` 줄(스캔 위치) → 인덱스 끝에서 0 으로 내려가는 줄(첫 칸 = 각도)
 *   - 값 = 게이트 안 최대 진폭 %FSH 소수 둘째 자리 (게이트 문턱 아래 값도 그대로 — TP14 파일에 문턱 10 % 아래 값이 있음)
 * 확인 전 (캡처 14 덧붙임 내보내기 파일을 받은 뒤 정함 — 결과의 unconfirmed 목록으로 화면에 '대조 전'):
 *   - `Ampl. End (%)`: 설명서는 '800 또는 200'(High Amplitude 모드). OPD 는 그 모드 칸을 읽지 못해, 유일한 근거인 TP14 OmniPC 내보내기(800)를
 *     따른다(다른 OPD 확인 전). NDE 는 파일 진폭 상한(200 % 모드 = 200)으로 둔다(확인 전)
 *   - 리니어·컴파운드의 인덱스 칸(값·단위 글자). 섹토리얼은 각도(TP14 + 설명서 'IndexStart = 첫 각도').
 *     리니어의 'VPA'(빔 번호)는 근거 없는 추정 글자다(OmniScan 의 VPA 이름을 빌림)
 *   - NDE 의 `Inspection Date`(파일 생성일로 둠 — OPD 는 TP14 대로 0001-01-01)
 *   - `Min/Max Thickness (mm)`: TP14 값 0.05 / 50.00 을 기본으로 둔다(진폭 C-scan 에서도 찍히는 칸)
 *   - 데이터 없음 칸: TP14 에 없어 빈 칸으로 둔다
 *   - 분석 중 바꾼 Gain 이 들어가는지: 지금은 넣지 않는다(파일 값)
 */
import { cscanBeamAxis } from './beamAxis'
import { scanPositionMm } from './coords'
import { gateDisplayValues, type GateCscan } from './gates'
import { rawToPercent } from './palette'
import type { ViewerGate, ViewerGroup } from './types'

const CRLF = '\r\n'

/** TP14 내보내기 파일의 머리말 칸 이름 (순서 그대로) */
export const OMNI_CSCAN_HEADER_KEYS = [
  'Data File',
  'Inspection Date',
  'Group',
  'Focal Law',
  'Gate',
  'Type',
  'ScanStart (mm)',
  'Scan Qty.(sample)',
  'Scan Resol. (mm)',
  'IndexStart ({u})',
  'Index Qty. (sample)',
  'Index Resol. ({u})',
  'Gate Start (mm)',
  'Gate Length (mm)',
  'Gate Level (%)',
  'Bit Depth',
  'Ampl. Start (%)',
  'Ampl. End (%)',
  'Ampl. Resol (%)',
  'Min Thickness (mm)',
  'Max Thickness (mm)'
] as const

/** 빈 날짜 자리 (TP14 .opd 내보내기의 Inspection Date) */
export const OMNI_EMPTY_DATE = '0001-01-01'
/** TP14 내보내기의 두께 칸 (진폭 C-scan 에서도 찍힘) — NDE 값은 확인 전 */
export const OMNI_DEFAULT_THICKNESS_MM: readonly [number, number] = [0.05, 50]

export interface OmniCscanTxtMeta {
  /** 'Data File' = 자료 파일 이름 (확장자 뺀 것, 예 'TP14-ROOT-L-01') */
  dataFile: string
  /** 'Inspection Date' (YYYY-MM-DD). 없으면 0001-01-01 */
  inspectionDate?: string | null
  /** 'Group' (기본 = 그룹 이름) */
  groupLabel?: string
  /** 'Ampl. End (%)' (기본 omniAmplEndPct) */
  amplEndPct?: number
  /** 'Min/Max Thickness (mm)' (기본 0.05 / 50) */
  thicknessRangeMm?: readonly [number, number]
}

/** 인덱스 칸 (행) */
export interface OmniCscanIndexAxis {
  /** 머리말 단위 글자 ('Deg' = 굴절각, 'VPA' = 빔 번호) */
  unit: string
  /** 빔 b 의 인덱스 값 (b = 0..nb−1) */
  values: number[]
  start: number
  resolution: number
  /** 이 꼴이 OmniPC 내보내기로 확인됐나 (섹토리얼만 TP14 로 확인) */
  confirmed: boolean
}

/**
 * 인덱스 칸: 섹토리얼·컴파운드 = 굴절각(°, C-scan 세로축과 같은 각도 축), 리니어 = 빔 번호(1부터, OmniScan VPA).
 * 컴파운드·리니어 내보내기 꼴은 캡처 14 덧붙임 대조 전이라 confirmed = false.
 */
export function omniCscanIndexAxis(group: Pick<ViewerGroup, 'technique' | 'beams' | 'spatialAxis'>): OmniCscanIndexAxis {
  const nb = group.beams.length
  const axis = cscanBeamAxis(group)
  if (axis.kind === 'index' && group.spatialAxis) {
    const s = group.spatialAxis
    return { unit: 'mm', values: group.beams.map((_, b) => s.offsetMm + b * s.resolutionMm), start: s.offsetMm, resolution: s.resolutionMm, confirmed: false }
  }
  if (axis.kind === 'beam') {
    const values = group.beams.map((_, b) => b + 1)
    return { unit: 'VPA', values, start: 1, resolution: 1, confirmed: false }
  }
  const values = group.beams.map((b) => b.angleDeg)
  const start = values[0] ?? 0
  const resolution = nb > 1 ? ((values[nb - 1] ?? start) - start) / (nb - 1) : 0
  return { unit: 'Deg', values, start, resolution, confirmed: group.technique === 'pa-sectorial' }
}

/**
 * 내보내기에서 OmniPC 내보내기 파일로 아직 확인하지 못한 칸 (화면 '대조 전' 칩 — 캡처 14 덧붙임 뒤 지움).
 * 근거: TP14(.opd 섹토리얼) 내보내기 한 개뿐이라, 그 꼴과 다른 것은 모두 확인 전이다
 */
export function omniCscanUnconfirmed(group: Pick<ViewerGroup, 'technique' | 'beams' | 'ampScale' | 'spatialAxis'>, formatFamily: '3.x' | '4.x' | 'opd'): string[] {
  const out: string[] = []
  if (!omniCscanIndexAxis(group).confirmed) out.push(group.spatialAxis ? '인덱스 칸 꼴(Paintbrush — mm, 내보내기 대조 전)' : group.technique === 'pa-linear' ? '인덱스 칸 꼴(리니어 — VPA 추정)' : '인덱스 칸 꼴(컴파운드)')
  if (formatFamily === 'opd') {
    if (group.ampScale.estimated) out.push('진폭 눈금(OPD 추정 — 값이 OmniPC 와 소수 자리에서 다름)')
  } else {
    out.push('Ampl. End·Inspection Date·두께 칸(NDE)')
  }
  return out
}

/** 'Focal Law' 글자 (TP14 섹토리얼 = 'Sectorial'. 리니어·컴파운드 글자는 확인 전) */
export function omniFocalLaw(technique: ViewerGroup['technique']): string {
  if (technique === 'pa-sectorial') return 'Sectorial'
  if (technique === 'pa-linear') return 'Linear'
  if (technique === 'pa-compound') return 'Compound'
  return 'Unknown'
}

/**
 * 'Ampl. End (%)' 기본. 설명서는 High Amplitude 모드에 따라 '800 또는 200'.
 * 추정 눈금(OPD — 모드 칸을 못 읽음) = 800: 유일한 근거 TP14 OmniPC 내보내기(다른 OPD 확인 전).
 * NDE = 파일 진폭 상한(200 % 모드 → 200) — 확인 전(캡처 14)
 */
export function omniAmplEndPct(group: Pick<ViewerGroup, 'ampScale'>): number {
  return group.ampScale.estimated ? 800 : group.ampScale.unitMax
}

/** 게이트 이름 → 한 글자 ('Gate A' → 'A') */
export function omniGateLetter(gate: Pick<ViewerGate, 'name' | 'id'>): string {
  const m = /gate\s*([A-Za-z])\b/i.exec(gate.name)
  return m ? m[1]!.toUpperCase() : gate.name
}

const f2 = (v: number): string => (Object.is(Math.round(v * 100) / 100, -0) ? 0 : v).toFixed(2)
/** 정수면 정수 글자, 아니면 소수 둘째 자리까지 (끝의 0 은 뺀다) — TP14 'Gate Level (%) = 10', 'Ampl. End (%) = 800' */
const fnum = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))))

/**
 * 게이트 C-scan → OmniPC C-scan 내보내기 글자. cscan 은 gate 로 채운 것(fillGateCscan), group 은 그 C-scan 의 그룹.
 * 행은 인덱스 끝(마지막 빔)에서 첫 빔으로 내려간다(설명서·TP14 — 화면의 C-scan 방향과 무관).
 */
export function cscanToOmniTxt(
  group: Pick<ViewerGroup, 'name' | 'technique' | 'beams' | 'scan' | 'ampScale' | 'ultrasound' | 'spatialAxis'>,
  cscan: GateCscan,
  gate: ViewerGate,
  meta: OmniCscanTxtMeta
): string {
  const ns = cscan.scanCount
  const nb = cscan.beamCount
  if (nb !== group.beams.length) throw new Error(`C-scan 빔 수(${nb})가 그룹 빔 수(${group.beams.length})와 다릅니다.`)
  const idx = omniCscanIndexAxis(group)
  const gv = gateDisplayValues(gate, group)
  const letter = omniGateLetter(gate)
  const [tMin, tMax] = meta.thicknessRangeMm ?? OMNI_DEFAULT_THICKNESS_MM
  const values: string[] = [
    meta.dataFile,
    meta.inspectionDate || OMNI_EMPTY_DATE,
    meta.groupLabel ?? group.name,
    omniFocalLaw(group.technique),
    letter,
    `C-Scan ${letter} Amplitude`,
    f2(scanPositionMm(0, group.scan)),
    String(ns),
    f2(group.scan.resolutionMm),
    f2(idx.start),
    String(nb),
    f2(idx.resolution),
    f2(gv.startMm),
    f2(gv.lengthMm),
    gate.thresholdPct === null ? '' : fnum(gate.thresholdPct),
    '16',
    '0',
    fnum(meta.amplEndPct ?? omniAmplEndPct(group)),
    '0.01',
    f2(tMin),
    f2(tMax)
  ]
  const lines = OMNI_CSCAN_HEADER_KEYS.map((k, i) => `${k.replace('{u}', idx.unit)} = ${values[i]}`)
  const scanRow = [`${idx.unit} / mm`]
  for (let k = 0; k < ns; k++) scanRow.push(f2(scanPositionMm(k, group.scan)))
  lines.push(scanRow.join('\t'))
  for (let b = nb - 1; b >= 0; b--) {
    const row = [f2(idx.values[b]!)]
    for (let k = 0; k < ns; k++) {
      const cell = k * nb + b
      row.push(cscan.peakSample[cell]! < 0 ? '' : f2(rawToPercent(cscan.peakRaw[cell]!, group.ampScale)))
    }
    lines.push(row.join('\t'))
  }
  return lines.join(CRLF) + CRLF
}

/** OmniPC C-scan 내보내기 글자를 읽은 결과 (비교·시험용) */
export interface OmniCscanTxt {
  /** 머리말 21줄 [이름, 값] (순서 그대로) */
  header: Array<[string, string]>
  /** 인덱스 단위 글자 ('Deg' 등, `Deg / mm` 줄의 앞) */
  indexUnit: string
  /** 스캔 위치 mm */
  scanMm: number[]
  /** 줄마다 인덱스 값과 칸 값 (빈 칸 = null). 파일 순서 그대로(인덱스 끝 → 0) */
  rows: Array<{ index: number; values: Array<number | null> }>
  /** 모든 줄이 CRLF 로 끝나는가 */
  crlf: boolean
}

/** OmniPC C-scan 내보내기(.txt) 읽기 — 꼴이 다르면 Error(한국어) */
export function parseOmniCscanTxt(text: string): OmniCscanTxt {
  const crlf = text.endsWith(CRLF) && !/[^\r]\n/.test(text)
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  if (lines.length < OMNI_CSCAN_HEADER_KEYS.length + 2) throw new Error('C-scan 내보내기 줄 수가 모자랍니다.')
  const header: Array<[string, string]> = []
  for (let i = 0; i < OMNI_CSCAN_HEADER_KEYS.length; i++) {
    const m = /^(.*?) = (.*)$/.exec(lines[i]!)
    if (!m) throw new Error(`머리말 ${i + 1}번째 줄이 '이름 = 값' 꼴이 아닙니다.`)
    header.push([m[1]!, m[2]!])
  }
  const head = lines[OMNI_CSCAN_HEADER_KEYS.length]!.split('\t')
  const hm = /^(.+) \/ mm$/.exec(head[0] ?? '')
  if (!hm) throw new Error("스캔 위치 줄('Deg / mm')이 없습니다.")
  const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s))
  const scanMm = head.slice(1).map((s) => Number(s))
  const rows = lines.slice(OMNI_CSCAN_HEADER_KEYS.length + 1).map((line, i) => {
    const cells = line.split('\t')
    if (cells.length !== scanMm.length + 1) throw new Error(`${i + 1}번째 값 줄의 칸 수(${cells.length})가 스캔 칸 수 + 1 과 다릅니다.`)
    return { index: Number(cells[0]), values: cells.slice(1).map(toNum) }
  })
  return { header, indexUnit: hm[1]!, scanMm, rows, crlf }
}

/** 내보내기 기본 파일 이름 — OmniPC 와 같은 꼴 `<자료파일>_YYYY_MM_DD HHhMMmSSs.txt` (파일 이름에 못 쓰는 글자는 '_') */
export function omniCscanTxtFileName(dataFile: string, at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const safe = dataFile.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'cscan'
  return `${safe}_${at.getFullYear()}_${p(at.getMonth() + 1)}_${p(at.getDate())} ${p(at.getHours())}h${p(at.getMinutes())}m${p(at.getSeconds())}s.txt`
}
