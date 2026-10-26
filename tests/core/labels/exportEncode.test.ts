/**
 * 학습 내보내기 최적화가 바이트를 바꾸지 않는지 (2026-10-07):
 *   - encodePngAsync(비동기 deflate) = encodePngRgb·encodePngGray (같은 런타임의 zlib, 같은 수준)
 *   - cellsPixelBox(칸별 상자 표) = 예전 방식(그림 전체 화소를 훑어 칸 묶음에 든 화소의 상자)
 * 실데이터 전체 대조는 tests/core/labels/exportTraining.test.ts('같은 입력 두 번 → 같은 바이트')와 측정 스크립트(run.sh exportTrain 해시).
 */
import { describe, expect, it } from 'vitest'
import { encodePngAsync, encodePngGray, encodePngRgb } from '@core/labels/export/encode'
import { cellPixelBoxes, cellsPixelBox } from '@core/labels/export/images'

/** 같은 씨앗 → 같은 수열 (xorshift32) */
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

/** 학습 그림 비슷한 바이트: 매끈한 띠 + 잡음 + 회색 바깥 */
function picture(w: number, h: number, ch: 1 | 3, seed: number): Uint8Array {
  const r = rng(seed)
  const px = new Uint8Array(w * h * ch)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const outside = (x - w / 2) ** 2 + (y - h) ** 2 > (h * 0.9) ** 2
      for (let c = 0; c < ch; c++) px[(y * w + x) * ch + c] = outside ? 128 : (x * 3 + y * 5 + c * 40 + Math.floor(r() * 24)) & 255
    }
  }
  return px
}

describe('encodePngAsync = 동기 인코더 (바이트)', () => {
  it('RGB·회색조, 여러 크기 (1×1 · 학습 그림 크기 630×480 포함)', async () => {
    const sizes: Array<[number, number]> = [
      [1, 1],
      [3, 2],
      [17, 9],
      [630, 480],
      [1021, 37]
    ]
    for (const [w, h] of sizes) {
      for (const seed of [1, 7]) {
        const rgb = picture(w, h, 3, seed)
        const gray = picture(w, h, 1, seed + 100)
        expect(Buffer.compare(await encodePngAsync(w, h, rgb, 3), encodePngRgb(w, h, rgb)), `rgb ${w}×${h}`).toBe(0)
        expect(Buffer.compare(await encodePngAsync(w, h, gray, 1), encodePngGray(w, h, gray)), `gray ${w}×${h}`).toBe(0)
      }
    }
  })

  it('필터는 부를 때 끝난다: 돌려받기 전에 배열을 다시 써도 결과는 부른 때의 바이트', async () => {
    const rgb = picture(64, 48, 3, 3)
    const want = encodePngRgb(64, 48, rgb)
    const p = encodePngAsync(64, 48, rgb, 3)
    rgb.fill(0)
    expect(Buffer.compare(await p, want)).toBe(0)
  })

  it('크기가 맞지 않으면 거부', async () => {
    await expect(encodePngAsync(4, 4, new Uint8Array(10), 3)).rejects.toThrow('PNG 바이트 수')
    await expect(encodePngAsync(0, 4, new Uint8Array(0), 1)).rejects.toThrow('PNG 크기')
  })
})

describe('cellsPixelBox (칸별 상자 표) = 그림 전체를 훑는 예전 방식', () => {
  /** 예전 구현 그대로 */
  function bruteBox(cellOf: Int32Array, width: number, cells: number, list: Iterable<number>): [number, number, number, number] | null {
    const member = new Uint8Array(cells)
    let any = false
    for (const c of list) {
      member[c] = 1
      any = true
    }
    if (!any) return null
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let p = 0; p < cellOf.length; p++) {
      const c = cellOf[p]!
      if (c < 0 || !member[c]) continue
      const x = p % width
      const y = (p - x) / width
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    if (!Number.isFinite(x0)) return null
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1]
  }

  it('무작위 칸 지도 · 무작위 칸 묶음 2000개 (빈 묶음·그림에 없는 칸·범위 밖 번호 포함)', () => {
    const r = rng(42)
    for (const [w, h, nb, nt] of [
      [40, 30, 6, 20],
      [120, 90, 16, 64]
    ] as const) {
      const cells = nb * nt
      // 부채꼴 비슷한 지도: 가까운 칸이 이웃 화소에 몰리고 바깥은 -1
      const cellOf = new Int32Array(w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const inside = (x - w / 2) ** 2 + y ** 2 < (h * 0.95) ** 2
          const b = Math.min(nb - 1, Math.floor((x / w) * nb))
          const i = Math.min(nt - 1, Math.floor((y / h) * nt))
          cellOf[y * w + x] = inside ? b * nt + i : -1
        }
      }
      const kit = { cellBox: cellPixelBoxes(cellOf, w, cells) }
      for (let k = 0; k < 1000; k++) {
        const n = Math.floor(r() * 12)
        const list: number[] = []
        for (let j = 0; j < n; j++) list.push(Math.floor(r() * (cells + 4)) - 2)
        expect(cellsPixelBox(kit, list), `${w}×${h} #${k}`).toEqual(bruteBox(cellOf, w, cells, list))
      }
    }
  })
})
