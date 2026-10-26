/**
 * 진폭 읽기 계약 — 변환 계산은 진폭을 이 인터페이스로만 읽는다 (런타임 의존성 없음).
 *
 * 그룹마다 [스캔, 빔, 샘플] 칸의 진폭을 %FSH(파일 이득 그대로 = 소프트 이득 0 dB)로 준다.
 *   - core(main·테스트): readViewerChunk 로 읽은 조각들 → amplitudeFromChunks
 *   - renderer: volumeStore 의 GroupVolume(amplitude, status) → amplitudeFromVolume
 *   - 합성 볼륨(테스트): amplitudeFromFunction
 * saturationPct 는 포화 판단 상한(%FSH, 보통 파일 unitMax 200 %)이다. 저장 상한에 닿은 칸은 실제 값의 하한이다.
 */
import { rawToPercent } from '../../imaging/palette'
import type { AmplitudeScale, ViewerGroup, ViewerVolumeChunk } from '../../imaging/types'

export interface RangeMax {
  pct: number
  sample: number
}

export interface GroupAmplitude {
  /** [스캔, 빔, 샘플] */
  readonly shape: readonly [number, number, number]
  /** 포화 판단 상한 (%FSH) */
  readonly saturationPct: number
  /** 칸 (스캔, 빔, 샘플) 의 %FSH. 데이터가 없는 칸은 0 */
  get(scan: number, beam: number, sample: number): number
  /** 그 (스캔, 빔) A-scan 에 데이터가 있는지 (상태 비트 1). 범위 밖이면 false */
  hasData(scan: number, beam: number): boolean
  /**
   * 샘플 [lo, hi] (양 끝 포함) 의 최대와 그 샘플 (같은 값이면 앞 샘플). 데이터가 없거나 빈 범위면 null.
   * 없으면 get 으로 계산한다 (rangeMax). 빠른 길을 주려면 구현한다.
   */
  maxInRange?(scan: number, beam: number, lo: number, hi: number): RangeMax | null
  /**
   * (선택, 빠른 길 — observation.ts maskedEnvelope) 스캔 scan 에서 빔 b = 0 … lo.length − 1 의 샘플 [lo[b], hi[b]] 가운데
   * exclude[b · nt + i] 가 0 인 칸의 최대 %FSH. 빔·샘플 순서로 처음 나온 최대(get 으로 견준 것과 같은 칸 — raw → % 가 증가 함수).
   * 데이터 없는 빔은 건너뛴다. 칸이 하나도 없으면 NaN. at[0] = 빔, at[1] = 샘플 (없으면 -1).
   * 부르는 쪽이 지킬 것: 빈 범위가 아닌 빔은 모두 0 ≤ lo ≤ hi < nt (shape[2]) — 아니면 get 길로.
   */
  maskedMax?(scan: number, lo: Int32Array, hi: Int32Array, exclude: Uint8Array, at: Int32Array): number
}

/** 샘플 [lo, hi] 최대 (maxInRange 가 있으면 그것) */
export function rangeMax(amp: GroupAmplitude, scan: number, beam: number, lo: number, hi: number): RangeMax | null {
  if (amp.maxInRange) return amp.maxInRange(scan, beam, lo, hi)
  if (hi < lo || !amp.hasData(scan, beam)) return null
  const nt = amp.shape[2]
  const a = Math.max(0, lo)
  const b = Math.min(nt - 1, hi)
  if (b < a) return null
  let m = -Infinity
  let mi = -1
  for (let i = a; i <= b; i++) {
    const v = amp.get(scan, beam, i)
    if (v > m) {
      m = v
      mi = i
    }
  }
  return mi < 0 ? null : { pct: m, sample: mi }
}

/** 포화 여부 */
export function isSaturatedPct(pct: number, saturationPct: number, tolPct: number): boolean {
  return pct >= saturationPct - tolPct
}

/**
 * int16 볼륨 (스캔 scanStart 부터 연속, [칸 수, 빔, 샘플]) → GroupAmplitude.
 * 렌더러 volumeStore 의 GroupVolume 은 scanStart = 0 (그룹 전체).
 */
export function amplitudeFromVolume(
  group: Pick<ViewerGroup, 'shape' | 'ampScale'>,
  amplitude: Int16Array,
  status: Uint8Array | null,
  scanStart = 0
): GroupAmplitude {
  const [ns, nb, nt] = group.shape
  const count = Math.floor(amplitude.length / Math.max(1, nb * nt))
  const scale: AmplitudeScale = group.ampScale
  const k0 = scanStart
  const k1 = Math.min(ns, scanStart + count)
  const inside = (k: number, b: number): boolean => k >= k0 && k < k1 && b >= 0 && b < nb
  const has = (k: number, b: number): boolean => inside(k, b) && (!status || (status[(k - k0) * nb + b]! & 1) === 1)
  return {
    shape: group.shape,
    saturationPct: scale.unitMax,
    get(k, b, i) {
      if (!inside(k, b) || i < 0 || i >= nt) return 0
      return rawToPercent(amplitude[((k - k0) * nb + b) * nt + i]!, scale)
    },
    hasData: has,
    maxInRange(k, b, lo, hi) {
      if (hi < lo || !has(k, b)) return null
      const a = Math.max(0, lo)
      const e = Math.min(nt - 1, hi)
      if (e < a) return null
      const base = ((k - k0) * nb + b) * nt
      let m = amplitude[base + a]!
      let mi = a
      for (let i = a + 1; i <= e; i++) {
        const v = amplitude[base + i]!
        if (v > m) {
          m = v
          mi = i
        }
      }
      return { pct: rawToPercent(m, scale), sample: mi }
    },
    maskedMax(k, lo, hi, exclude, at) {
      at[0] = -1
      at[1] = -1
      if (k < k0 || k >= k1) return NaN
      const kb = (k - k0) * nb
      const beams = Math.min(lo.length, nb)
      let m = 0
      let found = false
      for (let b = 0; b < beams; b++) {
        const l = lo[b]!
        const h = hi[b]!
        if (h < l || (status && (status[kb + b]! & 1) !== 1)) continue
        const base = (kb + b) * nt
        const eb = b * nt
        for (let i = l; i <= h; i++) {
          if (exclude[eb + i]) continue
          const v = amplitude[base + i]!
          if (!found || v > m) {
            m = v
            found = true
            at[0] = b
            at[1] = i
          }
        }
      }
      return found ? rawToPercent(m, scale) : NaN
    }
  }
}

/**
 * readViewerChunk 로 읽은 조각들 → GroupAmplitude. 조각은 겹치지 않아야 한다(뒤 조각이 이김).
 * 빠진 스캔은 데이터 없음으로 본다. 진폭은 복사하지 않는다.
 */
export function amplitudeFromChunks(group: Pick<ViewerGroup, 'id' | 'shape' | 'ampScale'>, chunks: readonly ViewerVolumeChunk[]): GroupAmplitude {
  const [ns] = group.shape
  const parts = chunks
    .filter((c) => c.groupId === group.id)
    .map((c) => amplitudeFromVolume(group, c.amplitude, c.status, c.scanStart))
  if (parts.length === 1) return parts[0]!
  const owner = new Int32Array(ns).fill(-1)
  chunks
    .filter((c) => c.groupId === group.id)
    .forEach((c, j) => {
      for (let k = c.scanStart; k < Math.min(ns, c.scanStart + c.scanCount); k++) if (k >= 0) owner[k] = j
    })
  const pick = (k: number): GroupAmplitude | null => (k >= 0 && k < ns && owner[k]! >= 0 ? parts[owner[k]!]! : null)
  return {
    shape: group.shape,
    saturationPct: group.ampScale.unitMax,
    get: (k, b, i) => pick(k)?.get(k, b, i) ?? 0,
    hasData: (k, b) => pick(k)?.hasData(k, b) ?? false,
    maxInRange: (k, b, lo, hi) => {
      const p = pick(k)
      return p ? rangeMax(p, k, b, lo, hi) : null
    }
  }
}

/** 함수로 정한 진폭 (합성 볼륨·시험용). fn 은 %FSH, saturationPct 에서 자른다 */
export function amplitudeFromFunction(
  shape: readonly [number, number, number],
  fn: (scan: number, beam: number, sample: number) => number,
  saturationPct = 200,
  hasData?: (scan: number, beam: number) => boolean
): GroupAmplitude {
  const [ns, nb, nt] = shape
  const inside = (k: number, b: number): boolean => k >= 0 && k < ns && b >= 0 && b < nb
  return {
    shape,
    saturationPct,
    get: (k, b, i) => (inside(k, b) && i >= 0 && i < nt ? Math.min(saturationPct, Math.max(0, fn(k, b, i))) : 0),
    hasData: (k, b) => inside(k, b) && (hasData ? hasData(k, b) : true)
  }
}
