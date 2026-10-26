/** SI → 계약 단위 변환 + 허용오차 반올림. 지문 안정성의 핵심. */
import { num } from './json'

export const FINGERPRINT_TOLERANCE = {
  lengthMm: 0.1,
  angleDeg: 0.1,
  frequencyMHz: 0.01
} as const

/** 격자보다 몇 자리 더 정밀하게 먼저 고정해 부동소수 노이즈를 지운다 (0.1 격자 → 1e-4 단위) */
const NOISE_DIGITS = 3
/** 이보다 큰 값은 정수 연산 범위를 넘으므로 단순 반올림 */
const MAX_EXACT = 1e9

function decimalsOf(step: number): number | null {
  const d = Math.round(-Math.log10(step))
  return d >= 0 && Math.abs(step * 10 ** d - 1) < 1e-9 ? d : null
}

/**
 * step(10의 거듭제곱) 격자로 반올림. 0 에서 먼 쪽으로 반올림해 ±값이 대칭이다.
 * v / step 을 바로 나누면 6.35 → 63.49999… 처럼 격자 중간값이 노이즈에 따라 갈리므로,
 * 먼저 격자보다 3자리 더 정밀한 10진 문자열로 고정하고(1e-12 m 수준 흔들림 흡수) 정수 연산으로 반올림한다.
 */
export function quantize(v: number, step: number): number {
  if (!Number.isFinite(v)) return v
  const d = decimalsOf(step)
  if (d === null || Math.abs(v) >= MAX_EXACT) {
    const q = Math.round(v / step) * step
    return Object.is(q, -0) ? 0 : q
  }
  const sign = v < 0 ? -1 : 1
  const [whole, frac = ''] = Math.abs(v).toFixed(d + NOISE_DIGITS).split('.')
  const units = Number(whole + frac)
  const scale = 10 ** NOISE_DIGITS
  const q = Math.floor((units + scale / 2) / scale)
  const r = Number(((sign * q) / 10 ** d).toFixed(d))
  return Object.is(r, -0) ? 0 : r
}

/** 각도를 [0, 360) 으로 (0° 와 360° 는 같은 방향) */
export function wrapDeg(v: number | null): number | null {
  if (v === null) return null
  const r = ((v % 360) + 360) % 360
  return quantize(r >= 359.95 ? 0 : r, FINGERPRINT_TOLERANCE.angleDeg)
}

/** m → mm, 0.1 mm 반올림 */
export function mm(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : quantize(n * 1000, FINGERPRINT_TOLERANCE.lengthMm)
}

/** 각도(°) 0.1° 반올림 */
export function deg(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : quantize(n, FINGERPRINT_TOLERANCE.angleDeg)
}

/** Hz → MHz, 0.01 MHz 반올림 */
export function mhz(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : quantize(n / 1e6, FINGERPRINT_TOLERANCE.frequencyMHz)
}

/** 기록용 (지문 제외) 값 반올림 */
export function round(v: unknown, step: number): number | null {
  const n = num(v)
  return n === null ? null : quantize(n, step)
}

/** s → µs (기록용, 0.001 µs) */
export function us(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : quantize(n * 1e6, 0.001)
}

/** 표시용 숫자: 12 → '12', 6.15 → '6.2' (step 기준) */
export function fmtNum(v: number | null, step = 0.1): string {
  if (v === null) return '?'
  return String(quantize(v, step))
}
