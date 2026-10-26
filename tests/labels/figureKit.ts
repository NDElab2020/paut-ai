/**
 * 지침서 그림용 작은 그리기 도구 (테스트 전용, 의존성 없음).
 * RGBA 바탕에 점·선(점선)·사각형·다른 그림 붙이기·글자(5×7 영문·숫자 비트맵)를 그린다.
 * 한글 글꼴은 없어서 그림 안 글자는 영문·숫자만 쓰고, 한국어 설명은 지침서 본문에 적는다.
 */
import type { Rgba } from '../helpers/png'

export type Rgb = readonly [number, number, number]

export const COLOR = {
  bg: [30, 30, 30],
  panel: [18, 18, 18],
  text: [235, 235, 235],
  dim: [150, 150, 150],
  black: [0, 0, 0],
  white: [255, 255, 255],
  magenta: [255, 0, 255],
  red: [255, 40, 40],
  green: [46, 224, 90],
  gray: [120, 120, 120],
  bevel: [70, 70, 70],
  noRange: [60, 60, 60]
} as const satisfies Record<string, Rgb>

// 5×7 글꼴. 한 줄 = 5비트 문자열, 1 = 칠함. 소문자는 대문자로 그린다.
// prettier-ignore
const GLYPHS: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '10001', '01010', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '%': ['11000', '11001', '00010', '00100', '01000', '10011', '00011'],
  '/': ['00000', '00001', '00010', '00100', '01000', '10000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  '°': ['01100', '10010', '10010', '01100', '00000', '00000', '00000'],
  '±': ['00100', '00100', '11111', '00100', '00100', '00000', '11111'],
  '~': ['00000', '00000', '01000', '10101', '00010', '00000', '00000'],
  '>': ['10000', '01000', '00100', '00010', '00100', '01000', '10000'],
  '<': ['00001', '00010', '00100', '01000', '00100', '00010', '00001'],
  '|': ['00100', '00100', '00100', '00100', '00100', '00100', '00100']
}

/** 글자 한 칸 너비 (간격 포함, 배율 1) */
export const GLYPH_W = 6
export const GLYPH_H = 7

export function textWidth(s: string, scale = 1): number {
  return s.length * GLYPH_W * scale
}

export class Canvas implements Rgba {
  readonly data: Uint8Array
  constructor(
    readonly width: number,
    readonly height: number,
    bg: Rgb = COLOR.bg
  ) {
    this.data = new Uint8Array(width * height * 4)
    this.fillRect(0, 0, width, height, bg)
  }

  set(x: number, y: number, c: Rgb): void {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return
    const i = (yi * this.width + xi) * 4
    this.data[i] = c[0]
    this.data[i + 1] = c[1]
    this.data[i + 2] = c[2]
    this.data[i + 3] = 255
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    const x0 = Math.max(0, Math.round(x))
    const y0 = Math.max(0, Math.round(y))
    const x1 = Math.min(this.width, Math.round(x + w))
    const y1 = Math.min(this.height, Math.round(y + h))
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c)
  }

  strokeRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    this.line(x, y, x + w - 1, y, c)
    this.line(x, y + h - 1, x + w - 1, y + h - 1, c)
    this.line(x, y, x, y + h - 1, c)
    this.line(x + w - 1, y, x + w - 1, y + h - 1, c)
  }

  /**
   * 선. dash = [칠함, 비움] 픽셀 수 (없으면 실선). alt 를 주면 비움 자리를 그 색으로 칠한다(밝은·어두운 바탕 모두에서 보이게).
   * 굵기 thick 은 선과 수직 방향으로 늘린다.
   */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb, opt: { dash?: readonly [number, number]; alt?: Rgb; thick?: number } = {}): void {
    const dx = x1 - x0
    const dy = y1 - y0
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))))
    const thick = opt.thick ?? 1
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    for (let i = 0; i <= n; i++) {
      let col: Rgb | null = c
      if (opt.dash) {
        const period = opt.dash[0] + opt.dash[1]
        if (i % period >= opt.dash[0]) col = opt.alt ?? null
      }
      if (!col) continue
      const x = x0 + (dx * i) / n
      const y = y0 + (dy * i) / n
      for (let t = 0; t < thick; t++) {
        const o = t - (thick - 1) / 2
        this.set(x + nx * o, y + ny * o, col)
      }
    }
  }

  polyline(pts: ReadonlyArray<readonly [number, number]>, c: Rgb, opt: { dash?: readonly [number, number]; alt?: Rgb; thick?: number } = {}): void {
    for (let i = 1; i < pts.length; i++) this.line(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], c, opt)
  }

  /** 십자 표시 (가운데 비움) */
  cross(x: number, y: number, r: number, c: Rgb, thick = 2): void {
    this.line(x - r, y, x - 3, y, c, { thick })
    this.line(x + 3, y, x + r, y, c, { thick })
    this.line(x, y - r, x, y - 3, c, { thick })
    this.line(x, y + 3, x, y + r, c, { thick })
  }

  /** 아래를 가리키는 작은 삼각형 (꼭짓점이 (x, y)) */
  triangleDown(x: number, y: number, size: number, c: Rgb): void {
    for (let r = 0; r < size; r++) this.line(x - (size - r), y - size + r, x + (size - r), y - size + r, c)
  }

  /** 오른쪽을 가리키는 작은 삼각형 (꼭짓점이 (x, y)) */
  triangleRight(x: number, y: number, size: number, c: Rgb): void {
    for (let r = 0; r < size; r++) this.line(x - size + r, y - (size - r), x - size + r, y + (size - r), c)
  }

  blit(img: Rgba, x: number, y: number): void {
    for (let yy = 0; yy < img.height; yy++) {
      const ty = y + yy
      if (ty < 0 || ty >= this.height) continue
      for (let xx = 0; xx < img.width; xx++) {
        const tx = x + xx
        if (tx < 0 || tx >= this.width) continue
        const i = (yy * img.width + xx) * 4
        const j = (ty * this.width + tx) * 4
        this.data[j] = img.data[i]!
        this.data[j + 1] = img.data[i + 1]!
        this.data[j + 2] = img.data[i + 2]!
        this.data[j + 3] = 255
      }
    }
  }

  /** 글자 (왼쪽 위 = (x, y)). 모르는 글자는 '#' */
  text(x: number, y: number, s: string, c: Rgb = COLOR.text, scale = 1): void {
    let cx = x
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS['#']!
      for (let r = 0; r < GLYPH_H; r++) {
        const row = g[r]!
        for (let q = 0; q < 5; q++) {
          if (row[q] === '1') this.fillRect(cx + q * scale, y + r * scale, scale, scale, c)
        }
      }
      cx += GLYPH_W * scale
    }
  }
}

/** 빈 RGBA */
export function blank(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) }
}
