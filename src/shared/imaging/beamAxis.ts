/**
 * 빔 축 (C-scan 세로축) 과 빔 이름표 — 기법마다 OmniPC 6.6 화면과 같은 축.
 *
 *   섹토리얼·컴파운드 = 굴절각(°). 빔 칸 가운데가 그 각도이고 양 끝은 반 칸씩 넓힌다 (스캔 축의 ±해상도/2 와 같은 이유).
 *     근거: X3 12T-SV-01 40~70°, TF_01_C_L_0001 컴파운드 50~68° → 축 49.5~68.5° (캡처 C-scan 눈금 50·55·60·65 의 픽셀 위치를
 *     영상 위·아래 끝 y 1371/2093 과 회귀: 38.06 px/°, 아래 끝 49.51°, 위 끝 68.48°).
 *   리니어 = 빔 번호(1부터, OmniScan 의 VPA = 개구 순번 — 개구 첫 소자 번호 아님). 굴절각이 모두 같아(60°) 각도 축이 될 수 없다.
 *     축 = [1, 빔 수 + 1], 빔 n(1부터) 의 C-scan 칸 = [n, n+1].
 *     근거: TF_01_L_0001 GR-2 (44빔, 개구 첫 소자 5~48) 캡처 눈금 10·20·30·40 = y 1945.5·1781.5·1617·1452.5 → 16.433 px/빔,
 *     아래 끝(y 2093) 1.02, 위 끝(y 1371) 44.96. 빔 번호 0부터·가운데 정렬이면 −0.5~43.5, 1부터 가운데 정렬이면 0.5~44.5,
 *     개구 첫 소자(5~48)면 4.5~48.5 로 모두 8 px 이상 어긋난다. 캡처 C-scan 무늬와 우리 C-scan(빔 b 칸 = 높이의 [b, b+1]/nb)의
 *     상관이 세로 이동 0 px 에서 최대(0.9987, ±8 px 이동하면 0.994·0.997)라 칸 위치도 이 축과 맞는다.
 *   C-scan 칸 배치(cscan.ts: 빔 b 칸 가운데 = (b + 0.5)/nb)는 기법과 무관하게 같고, 축 숫자만 기법별로 다르다.
 */
import type { ViewerGroup } from './types'

type BeamAxisGroup = Pick<ViewerGroup, 'technique' | 'beams' | 'spatialAxis'>

export interface BeamAxis {
  /** 'angle' = 굴절각(°), 'beam' = 빔 번호(1부터) */
  kind: 'angle' | 'beam' | 'index'
  /** 첫 빔(빔 0) 칸 바깥 끝의 축 값 */
  first: number
  /** 끝 빔(빔 nb−1) 칸 바깥 끝의 축 값 */
  last: number
  /** Axis 단위 ('°' 또는 '' — 빔 번호는 단위 없음) */
  unit: string
  /** 축 제목 (화면 낭독용) */
  title: string
}

/** 이 그룹의 빔 축이 굴절각이 아니라 빔 번호인가 (리니어, 또는 각도가 모두 같아 각도 축이 될 수 없는 그룹) */
function usesBeamNumber(group: BeamAxisGroup): boolean {
  if (group.technique === 'pa-linear') return true
  const nb = group.beams.length
  return nb > 1 && group.beams.every((b) => b.angleDeg === group.beams[0]!.angleDeg)
}

/**
 * C-scan 세로축. CscanView 는 reversed(첫 빔이 아래)면 위 끝 = last, 아래 끝 = first 로 그린다.
 * 섹토리얼은 지금까지와 같은 값 (첫·끝 빔 각도 ± 반 칸, 각도 간격 = (끝 − 첫)/(nb − 1)).
 */
export function cscanBeamAxis(group: BeamAxisGroup): BeamAxis {
  const nb = group.beams.length
  const spatial = group.spatialAxis
  if (spatial) return { kind: 'index', first: spatial.offsetMm - spatial.resolutionMm / 2,
    last: spatial.offsetMm + (spatial.count - 0.5) * spatial.resolutionMm, unit: 'mm', title: '인덱스 위치' }
  if (usesBeamNumber(group)) return { kind: 'beam', first: 1, last: Math.max(1, nb) + 1, unit: '', title: '빔 번호' }
  const a0 = group.beams[0]?.angleDeg ?? 0
  const a1 = group.beams[nb - 1]?.angleDeg ?? 0
  const half = nb > 1 ? (a1 - a0) / (nb - 1) / 2 : 0
  return { kind: 'angle', first: a0 - half, last: a1 + half, unit: '°', title: '굴절각' }
}

/**
 * 빔 b 칸 가운데의 축 값 (C-scan 커서가 그려지는 자리, cscanYForBeam 과 같은 위치).
 * 각도 간격이 고르면 그 빔의 굴절각과 같고, 빔 번호 축은 b + 1.5 (칸 [b+1, b+2] 의 가운데).
 * OmniPC 리니어 커서는 칸 가운데가 아니라 칸 끝(값 b + 1)에 그린다 (TF_01_L 빔 0 커서 y 2093 = 아래 끝).
 */
export function beamAxisValue(group: BeamAxisGroup, b: number): number {
  const ax = cscanBeamAxis(group)
  const nb = Math.max(1, group.beams.length)
  return ax.first + ((b + 0.5) * (ax.last - ax.first)) / nb
}

/** 1부터 세는 빔 번호 (OmniPC 리니어 C-scan 축·VPA 와 같은 번호) */
export function beamNumber(b: number): number {
  return b + 1
}

/** 각도 글자: 소수 한 자리까지, 끝의 0 은 뺀다 ('54°', '54.5°'), 음수는 '−'(U+2212) */
function degText(v: number): string {
  const r = Math.round(v * 10) / 10
  return `${Object.is(r, -0) ? 0 : r}`.replace('-', '−') + '°'
}

/**
 * 빔 이름표 (측정값 줄·패널 제목용). 섹토리얼·컴파운드 = '54°', 리니어 = '빔 12 · 60°'.
 * 리니어는 각도가 모두 같아 각도만으로는 빔을 구별할 수 없으므로 번호를 앞에 둔다.
 */
export function beamLabel(group: BeamAxisGroup, b: number): string {
  if (group.spatialAxis) return `인덱스 ${Number((group.spatialAxis.offsetMm + b * group.spatialAxis.resolutionMm).toFixed(3))} mm`
  const angle = group.beams[b]?.angleDeg
  const deg = angle === undefined ? '' : degText(angle)
  if (!usesBeamNumber(group)) return deg
  return deg ? `빔 ${beamNumber(b)} · ${deg}` : `빔 ${beamNumber(b)}`
}
