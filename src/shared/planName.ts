/**
 * 스캔플랜 자동 이름: 두께 · 탐촉자 주파수 · 스큐 — '12T · 5MHz · SK90/270' (플랜 목록 묶음 순서와 같음).
 * 자세한 셋업은 요약 줄(summary)에 있으므로 이름은 짧게 둔다. core 와 화면 mock 이 같은 규칙을 쓴다.
 * 플랜 목록의 묶음(shared/planGroups)도 아래 라벨 함수를 그대로 쓴다 — 이름과 묶음 머리가 늘 같은 글자가 되도록.
 */
import type { ScanPlanSpec } from './types'

/** 소수 자리수만큼 반올림하고 끝의 0 을 뗀다: (2.25, 2) → '2.25', (12, 1) → '12' */
const trim = (v: number, digits: number): string => String(Number(v.toFixed(digits)))
const uniqSorted = (xs: number[], desc = false): number[] => [...new Set(xs)].sort((a, b) => (desc ? b - a : a - b))
const probesOf = (spec: ScanPlanSpec) => spec.groups.flatMap((g) => g.probes)

/** 탐촉자 중심 주파수 고유값, 큰 순 (0.01MHz 반올림). 모르면 빈 배열 */
export function frequenciesMHz(spec: ScanPlanSpec): number[] {
  return uniqSorted(
    probesOf(spec)
      .map((p) => p.probe.centralFrequencyMHz)
      .filter((v): v is number => typeof v === 'number')
      .map((v) => Math.round(v * 100) / 100),
    true
  )
}

/** 탐촉자 스큐 고유값, 작은 순 (0.1° 반올림). 모르면 빈 배열 */
export function skewsDeg(spec: ScanPlanSpec): number[] {
  return uniqSorted(
    probesOf(spec)
      .map((p) => p.position?.skewDeg)
      .filter((v): v is number => typeof v === 'number')
      .map((v) => Math.round(v * 10) / 10)
  )
}

/** '5MHz', '10/5MHz', '2.25MHz'. 모르면 null */
export function frequencyLabel(spec: ScanPlanSpec): string | null {
  const mhz = frequenciesMHz(spec)
  return mhz.length ? `${mhz.map((v) => trim(v, 2)).join('/')}MHz` : null
}

/** '12T', '6.2T'. 모르면 null */
export function thicknessLabel(spec: ScanPlanSpec): string | null {
  const t = spec.specimen.thicknessMm
  return typeof t === 'number' ? `${trim(t, 1)}T` : null
}

/** 'SK90', 'SK90/270'. 모르면 null */
export function skewLabel(spec: ScanPlanSpec): string | null {
  const skews = skewsDeg(spec)
  return skews.length ? `SK${skews.map((v) => trim(v, 1)).join('/')}` : null
}

/** 두께 구간 폭 (mm) */
export const THICKNESS_BUCKET_MM = 10

export interface ThicknessBucket {
  /** 구간 아래 끝 (포함), mm */
  lowMm: number
  /** 구간 위 끝 (미포함), mm */
  highMm: number
  /** '10~20T' */
  label: string
}

/** 10mm 단위 두께 구간 (아래 끝 포함·위 끝 미포함): 6.2T → '0~10T', 10T → '10~20T', 26T → '20~30T'. 모르면 null */
export function thicknessBucket(spec: ScanPlanSpec): ThicknessBucket | null {
  const t = spec.specimen.thicknessMm
  if (typeof t !== 'number' || !Number.isFinite(t)) return null
  const lowMm = Math.floor(t / THICKNESS_BUCKET_MM) * THICKNESS_BUCKET_MM
  const highMm = lowMm + THICKNESS_BUCKET_MM
  return { lowMm, highMm, label: `${lowMm}~${highMm}T` }
}

export function planNameFrom(spec: ScanPlanSpec): string {
  return [thicknessLabel(spec), frequencyLabel(spec), skewLabel(spec)].filter(Boolean).join(' · ') || '이름 없는 스캔플랜'
}

/** 이미 쓰는 이름이면 ' (2)', ' (3)' … 을 붙인다 (대소문자·공백 차이는 같은 이름으로 본다) */
export function uniquePlanName(base: string, taken: Iterable<string>): string {
  const key = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const used = new Set([...taken].map(key))
  if (!used.has(key(base))) return base
  for (let n = 2; ; n++) {
    const name = `${base} (${n})`
    if (!used.has(key(name))) return name
  }
}
