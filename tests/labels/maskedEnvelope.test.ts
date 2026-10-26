/**
 * maskedEnvelope 빠른 길(GroupAmplitude.maskedMax — 진폭을 raw 로 견주고 마지막에 한 번 %)이 get 길과 같은지 (2026-10-07 최적화).
 * 같아야 하는 것: 스캔마다 값(Float64 비트까지)·빔·샘플. 상태 비트(데이터 없음)·뺄 칸·빈 범위·같은 최대(앞 칸)·범위 밖(느린 길로) 포함.
 * 실데이터 대조는 tests/labels/deriveX3.test.ts 와 측정 스크립트(run.sh derive 해시).
 */
import { describe, expect, it } from 'vitest'
import { amplitudeFromChunks, amplitudeFromVolume, maskedEnvelope, type BeamRanges, type GroupAmplitude, type PreparedGroup } from '@shared/labels/derive'
import type { ViewerGroup, ViewerVolumeChunk } from '@shared/imaging/types'

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 0x100000000
  }
}

/** maskedMax 를 뺀 같은 진폭 (예전 get 길) */
function slow(a: GroupAmplitude): GroupAmplitude {
  return { shape: a.shape, saturationPct: a.saturationPct, get: a.get, hasData: a.hasData, ...(a.maxInRange ? { maxInRange: a.maxInRange } : {}) }
}

function same(a: ReturnType<typeof maskedEnvelope>, b: ReturnType<typeof maskedEnvelope>): void {
  expect(a.scanFrom).toBe(b.scanFrom)
  expect(Buffer.compare(Buffer.from(a.values.buffer), Buffer.from(b.values.buffer))).toBe(0)
  expect([...a.beam]).toEqual([...b.beam])
  expect([...a.sample]).toEqual([...b.sample])
}

describe('maskedEnvelope 빠른 길 = get 길', () => {
  it('무작위 볼륨 300개 조합 (상태 비트·뺄 칸·같은 값·rawMax 32767 / 255)', () => {
    const r = rng(9)
    for (const rawMax of [32767, 255]) {
      for (let t = 0; t < 150; t++) {
        const ns = 3 + Math.floor(r() * 20)
        const nb = 1 + Math.floor(r() * 12)
        const nt = 4 + Math.floor(r() * 40)
        const amplitude = new Int16Array(ns * nb * nt)
        // 값을 적게 골라 같은 최대가 자주 나오게
        for (let i = 0; i < amplitude.length; i++) amplitude[i] = Math.floor(r() * 8) * Math.floor(rawMax / 8)
        const status = r() < 0.5 ? null : Uint8Array.from({ length: ns * nb }, () => (r() < 0.8 ? 1 : 0))
        const group = { shape: [ns, nb, nt] as [number, number, number], ampScale: { rawMax, unitMax: 200 } } as unknown as ViewerGroup
        const fast = amplitudeFromVolume(group, amplitude, status)
        expect(fast.maskedMax).toBeTypeOf('function')
        const ranges: BeamRanges = { lo: new Int32Array(nb), hi: new Int32Array(nb) }
        for (let b = 0; b < nb; b++) {
          const a = Math.floor(r() * nt)
          const c = Math.floor(r() * nt)
          ranges.lo[b] = r() < 0.15 ? 1 : Math.min(a, c)
          ranges.hi[b] = r() < 0.15 ? 0 : Math.max(a, c) // 가끔 빈 범위
        }
        const exclude = Uint8Array.from({ length: nb * nt }, () => (r() < 0.3 ? 1 : 0))
        const from = Math.floor(r() * ns) - 2
        const to = from + Math.floor(r() * ns) + 2
        same(maskedEnvelope({ amp: fast } as PreparedGroup, ranges, exclude, nt, from, to), maskedEnvelope({ amp: slow(fast) } as PreparedGroup, ranges, exclude, nt, from, to))
      }
    }
  })

  it('범위가 [0, nt) 밖이거나 조각이 여럿이면 get 길 그대로', () => {
    const ns = 6
    const nb = 3
    const nt = 10
    const amplitude = Int16Array.from({ length: ns * nb * nt }, (_, i) => (i * 37) % 200)
    const group = { id: 0, shape: [ns, nb, nt] as [number, number, number], ampScale: { rawMax: 255, unitMax: 250 } } as unknown as ViewerGroup
    const fast = amplitudeFromVolume(group, amplitude, null)
    const exclude = new Uint8Array(nb * nt)
    const out: BeamRanges = { lo: Int32Array.from([-2, 0, 3]), hi: Int32Array.from([4, 12, 5]) }
    same(maskedEnvelope({ amp: fast } as PreparedGroup, out, exclude, nt, 0, ns - 1), maskedEnvelope({ amp: slow(fast) } as PreparedGroup, out, exclude, nt, 0, ns - 1))
    // 조각 둘 (amplitudeFromChunks 가 maskedMax 없이 감쌈)
    const half = (ns / 2) * nb * nt
    const chunks: ViewerVolumeChunk[] = [
      { groupId: 0, scanStart: 0, scanCount: ns / 2, amplitude: amplitude.slice(0, half), status: null } as unknown as ViewerVolumeChunk,
      { groupId: 0, scanStart: ns / 2, scanCount: ns / 2, amplitude: amplitude.slice(half), status: null } as unknown as ViewerVolumeChunk
    ]
    const two = amplitudeFromChunks(group, chunks)
    expect(two.maskedMax).toBeUndefined()
    const inR: BeamRanges = { lo: Int32Array.from([0, 2, 4]), hi: Int32Array.from([9, 7, 6]) }
    same(maskedEnvelope({ amp: two } as PreparedGroup, inR, exclude, nt, 0, ns - 1), maskedEnvelope({ amp: fast } as PreparedGroup, inR, exclude, nt, 0, ns - 1))
  })
})
