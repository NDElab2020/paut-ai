/**
 * RGBA 화소를 4바이트씩 한 번에 쓰는 도우미 (C·B·S-scan 그리기 공용, 2026-10-07 빌드 전 최적화).
 * 그림 바이트를 바꾸지 않는 것이 조건이다:
 *  - 색(r, g, b, a)을 out 과 같은 종류의 바이트 배열(Uint8ClampedArray 면 클램프·반올림, Uint8Array 면 자름)에 먼저 써서
 *    그 메모리 4바이트를 Uint32 로 읽어 둔다 → 화소마다 그 Uint32 를 쓰면 바이트별로 쓴 것과 같은 바이트 (엔디언과 무관).
 *  - out 이 4바이트 경계에서 시작하지 않거나 화소 수보다 짧으면 임시 배열에 쓴 뒤 바이트로 옮긴다 (쓰는 범위도 out 길이까지로 같음).
 */

type Bytes = Uint8ClampedArray | Uint8Array

function bytesLike(out: Bytes, n: number): Bytes {
  return out instanceof Uint8ClampedArray ? new Uint8ClampedArray(n) : new Uint8Array(n)
}

/** 한 색 (각 값은 out[i] = 값 으로 쓴 것과 같은 바이트가 된다 — undefined·NaN 은 0) */
export function packRgba(out: Bytes, r: number, g: number, b: number, a: number): number {
  const t = bytesLike(out, 4)
  t[0] = r
  t[1] = g
  t[2] = b
  t[3] = a
  return new Uint32Array(t.buffer)[0]!
}

/**
 * 색표 256색 (paletteRgb 꼴 256×3) → 색 번호마다 불투명 RGBA 한 화소. 색표가 짧아 없는 칸은 out[i] = undefined 와 같이 0.
 * 색 번호가 0..255 밖(이득 계수가 NaN·음수 같은 비정상 값)이면 표에 없으므로 쓰는 쪽이 `?? packRgba(out, 0, 0, 0, 255)` 로 받는다
 */
export function packPalette(out: Bytes, palette: Uint8Array): Uint32Array {
  const t = bytesLike(out, 256 * 4)
  for (let i = 0; i < 256; i++) {
    t[i * 4] = palette[i * 3]!
    t[i * 4 + 1] = palette[i * 3 + 1]!
    t[i * 4 + 2] = palette[i * 3 + 2]!
    t[i * 4 + 3] = 255
  }
  return new Uint32Array(t.buffer)
}

/** 화소 n 개를 쓸 Uint32 배열과, 다 쓴 뒤 부를 마무리 (out 을 바로 쓸 수 있으면 아무것도 하지 않음) */
export function rgba32Target(out: Bytes, n: number): { px: Uint32Array; done: () => void } {
  if (out.byteOffset % 4 === 0 && out.length >= n * 4) return { px: new Uint32Array(out.buffer, out.byteOffset, n), done: () => undefined }
  const px = new Uint32Array(n)
  return { px, done: () => out.set(new Uint8Array(px.buffer, 0, Math.min(out.length, n * 4))) }
}
