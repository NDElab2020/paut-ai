/**
 * 진폭 색표. 기본값은 OmniScan X3(MXU 5.18) 파일의 ModelSetup `AmplitudePalettes/MainColors` 256색을 그대로 옮긴 것이다
 * (X3 4개 · 공식 예제에서 같은 값 확인). 파일에 색표가 있으면 그것을 쓴다.
 */
import type { AmplitudeScale } from './types'

// prettier-ignore
export const DEFAULT_AMPLITUDE_PALETTE: readonly string[] = `
  ffffff fafcfe f6fafd f2f7fd eef5fc eaf2fb e6f0fb e1edfa ddebf9 d9e8f9 d5e6f8 d1e3f7 cde1f7 c8def6 c4dcf6 c0d9f5
  bcd7f4 b8d4f4 b4d2f3 afd0f2 abcdf2 a7cbf1 a3c8f0 9fc6f0 9bc3ef 96c1ef 92beee 8ebced 8ab9ed 86b7ec 82b4eb 7db2eb
  79afea 75ade9 71aae9 6da8e8 69a6e8 66a1e5 639de2 6099df 5d95dc 5a91da 588dd7 5589d4 5285d1 4f81cf 4c7dcc 4979c9
  4775c6 4471c3 416dc1 3e69be 3b65bb 3861b8 365db6 3359b3 3055b0 2d51ad 2a4daa 2749a8 2545a5 2241a2 1f3d9f 1c399d
  19359a 163197 142d94 112991 0e258f 0b218c 081d89 051986 031584 041883 061c83 082083 0a2483 0c2883 0e2c83 103082
  123482 143882 153c82 174082 194482 1b4881 1d4c81 1f5081 215481 235881 255c81 266080 286480 2a6880 2c6c80 2e7080
  307480 32787f 347c7f 36807f 37847f 39887f 3b8c7f 3d907e 3f947e 41987e 439c7e 45a07e 47a47e 4ca67b 51a878 56aa75
  5bac72 60ae6f 65b06c 6ab269 6fb467 74b764 79b961 7ebb5e 83bd5b 88bf58 8dc155 92c353 97c550 9cc74d a1ca4a a6cc47
  abce44 b0d041 b5d23f bad43c bfd639 c4d836 c9da33 cedd30 d3df2d d8e12b dde328 e2e525 e7e722 ece91f f1eb1c f6ed19
  fcf017 faec19 f9e91b f8e61d f7e31f f6df22 f5dc24 f4d926 f2d628 f1d32b f0cf2d efcc2f eec931 edc633 ecc236 eabf38
  e9bc3a e8b93c e7b63f e6b241 e5af43 e4ac45 e2a947 e1a54a e0a24c df9f4e de9c50 dd9953 dc9555 da9257 d98f59 d88c5b
  d7885e d68560 d58262 d47f64 d37c67 d27b64 d27b62 d27b60 d27a5e d17a5b d17a59 d17957 d17955 d07953 d07850 d0784e
  d0784c cf774a cf7747 cf7745 cf7643 ce7641 ce763f ce753c ce753a cd7538 cd7436 cd7433 cd7431 cc732f cc732d cc732b
  cc7228 cb7226 cb7224 cb7122 cb711f ca711d ca701b ca7019 ca7017 c86d17 c66a17 c56717 c36417 c26217 c05f18 be5c18
  bd5918 bb5718 ba5418 b85118 b74e19 b54b19 b34919 b24619 b04319 af4019 ad3e1a ab3b1a aa381a a8351a a7321a a5301a
  a42d1b a22a1b a0271b 9f251b 9d221b 9c1f1b 9a1c1c 98191c 97171c 95141c 94111c 920e1c 910c1d 8f091d 8e061d 8c031d
`.trim().split(/\s+/)

/** OmniPC 특수색: [0] 000000, [1] ffffff, [2] 808080 (사용자 폴더 EVDNT_Amplitude.pal 의 특수색과 같음) */
export const DEFAULT_SPECIAL_COLORS: readonly string[] = ['000000', 'ffffff', '808080']

/**
 * 특수색 번호의 뜻 — MXU 4.4 설명서 7.5.1(.pal 형식, 인쇄 191쪽): 1번째 = 수집 안 됨(no-data), 2번째 = 게이트 A 를 넘은 신호 없음
 * (no-detection), 3번째 = 게이트 I 를 넘은 신호 없음(no-synchro). OmniPC 6.6 이 이 순서로 칠하는지는 캡처 10·11 대조 전.
 */
export const SPECIAL_NO_DATA = 0
export const SPECIAL_NO_DETECTION = 1
export const SPECIAL_NO_SYNCHRO = 2

/**
 * 뷰어가 데이터 없음(상태 hasData = 0) 칸을 칠하는 특수색 번호 — 지금 [2](회색 808080, 임시).
 * 설명서 순서로는 SPECIAL_NO_DATA(검정)가 맞을 수 있으나 6.6 화면(캡처 10·11)을 본 뒤에 바꾼다(제안 X11 ②).
 */
export const VIEWER_NO_DATA_SPECIAL_INDEX = 2

/**
 * 학습 그림 내보내기(core/labels/export/images.ts OUTSIDE_RGB)의 바깥 색 특수색 번호 — 808080 으로 고정.
 * 검정(0)으로 바꾸면 가림 색 MASK_RGB(검정)와 구별되지 않고 학습 그림 규칙(TRAIN_IMAGE_RULES_VERSION)이 바뀐다.
 * 뷰어 색(VIEWER_NO_DATA_SPECIAL_INDEX)을 바꿀 때도 이 값은 그대로 둔다(제안 X11 ①).
 */
export const EXPORT_OUTSIDE_SPECIAL_INDEX = 2

// 옛 이름 NO_DATA_SPECIAL_INDEX 는 지웠다(2026-10-07 검토): 뷰어는 VIEWER_NO_DATA_SPECIAL_INDEX, 학습 내보내기는 EXPORT_OUTSIDE_SPECIAL_INDEX.
// 하나가 다른 하나의 별칭이면 뷰어 색을 바꿀 때 학습 그림 바깥 색도 조용히 따라 바뀐다.

const HEX6 = /^[0-9a-f]{6}$/i

export function isHexColor(s: string): boolean {
  return HEX6.test(s)
}

/** 'rrggbb' → [r, g, b] */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 256색 → RGB 바이트 [r0,g0,b0, r1,...] (색이 모자라거나 형식이 틀리면 기본 색표) */
export function paletteRgb(palette: readonly string[]): Uint8Array {
  const src = palette.length === 256 && palette.every(isHexColor) ? palette : DEFAULT_AMPLITUDE_PALETTE
  const out = new Uint8Array(256 * 3)
  src.forEach((hex, i) => out.set(hexToRgb(hex), i * 3))
  return out
}

/** raw 진폭 → %FSH */
export function rawToPercent(raw: number, scale: AmplitudeScale): number {
  return (raw / scale.rawMax) * scale.unitMax
}

/** %FSH → 색 번호 0..255 (0% → 0, 100% 이상 → 255). 규칙은 rawToIndex 하나 */
export function percentToIndex(pct: number): number {
  return rawToIndex(pct, 2.55)
}

/** raw(보간된 실수 포함) × 이 값 = 색 번호 (rawToIndex 에 넘긴다) */
export function rawIndexFactor(scale: AmplitudeScale): number {
  return (scale.unitMax * 2.55) / scale.rawMax
}

/**
 * raw → 색 번호 0..255: round(raw × factor), 0 이하 → 0, 255 넘으면 255.
 * S-scan·C-scan 그리기와 percentToIndex 가 모두 이 규칙을 쓴다 (OmniPC 색 경계 반올림 규칙은 화면 대조 전 임시).
 */
export function rawToIndex(raw: number, factor: number): number {
  if (!(raw > 0)) return 0
  const i = Math.round(raw * factor)
  return i > 255 ? 255 : i
}

// ──────────────────────────────── 후처리: 소프트 이득·색표 범위 ────────────────────────────────

/**
 * 소프트 이득 Δ(dB) 를 반영한 진폭 변환. rawMax 를 10^(−dB/20) 배로 줄이면
 * rawToPercent·rawIndexFactor 가 그만큼 커지고 rawToIndex 가 255(= 100 %)에서 포화한다 (그리기 코드 수정 없음).
 * dB 가 0 이면 같은 객체를 돌려준다 (기본값 불변).
 */
export function gainedScale(scale: AmplitudeScale, dB: number): AmplitudeScale {
  if (!dB) return scale
  return { rawMax: scale.rawMax * 10 ** (-dB / 20), unitMax: scale.unitMax }
}

/** 이득 반영 %FSH 를 파일 상한(unitMax, 보통 200 %)에서 자른 표시값 */
export function saturatedPercent(pct: number, scale: AmplitudeScale): number {
  return Math.min(scale.unitMax, pct)
}

/** Auto 80 %: 현재 최대(포화 전 %)를 목표 % 로 맞추는 Δ(dB). 최대가 0 이하면 null */
export function autoGainDb(peakPct: number, targetPct: number): number | null {
  if (!(peakPct > 0) || !(targetPct > 0)) return null
  return 20 * Math.log10(targetPct / peakPct)
}

/**
 * 색표 범위(Zoom Palette): 색 번호 i(= % × 2.55) 가 [minPct, maxPct] 구간을 0~255 로 쓰도록 256 색을 다시 뽑는다.
 *   new[i] = old[clamp(round(((i/2.55) − min) / (max − min) × 255))]
 * (0, 100) 이면 바이트 동일한 새 배열. 100 % 초과(번호 255 클램프)는 max 색.
 */
export function remapPalette(rgb: Uint8Array, minPct: number, maxPct: number): Uint8Array {
  const out = new Uint8Array(256 * 3)
  const span = maxPct - minPct
  for (let i = 0; i < 256; i++) {
    const pct = i / 2.55
    let j = span > 0 ? Math.round(((pct - minPct) / span) * 255) : i
    if (j < 0) j = 0
    else if (j > 255) j = 255
    out[i * 3] = rgb[j * 3]!
    out[i * 3 + 1] = rgb[j * 3 + 1]!
    out[i * 3 + 2] = rgb[j * 3 + 2]!
  }
  return out
}

/** 색표(hex 256개)를 범위에 맞춰 다시 뽑은 hex 목록 (CSS 컬러바용, remapPalette 와 같은 규칙) */
export function remapPaletteHex(palette: readonly string[], minPct: number, maxPct: number): string[] {
  const src = palette.length === 256 && palette.every(isHexColor) ? palette : DEFAULT_AMPLITUDE_PALETTE
  const span = maxPct - minPct
  return Array.from({ length: 256 }, (_, i) => {
    const pct = i / 2.55
    let j = span > 0 ? Math.round(((pct - minPct) / span) * 255) : i
    if (j < 0) j = 0
    else if (j > 255) j = 255
    return src[j]!
  })
}

// ──────────────────────────────── 사용자 OmniPC 색표 파일 (.pal) 읽기 (L2) ────────────────────────────────
// 근거: 사용자 폴더 문서/Evident/OmniPC/Palette 의 .pal 29개(28개 XML 판 2.0, 1개 머리말 없는 줄 형식)와 MXU 4.4 설명서 7.5.1.
// Evident 색표 파일은 앱에 묶지 않는다 — 사용자가 고른 파일을 그때 읽기만 한다.

/** .pal 주 색 수 */
export const PAL_MAIN_COLORS = 256
/** .pal 파일 크기 상한 (사용자 색표 29개는 3~15 KB) */
export const PAL_MAX_BYTES = 1024 * 1024

export type PalParseResult =
  | { ok: true; palette: string[]; specialColors: string[]; specialFromFile: boolean; format: 'xml' | 'lines' }
  | { ok: false; error: string }

const byteHex = (n: number): string => n.toString(16).padStart(2, '0')

/** '0'~'255' 정수 글자만 받는다 */
function channel(v: string | undefined): number | null {
  if (v === undefined || !/^\s*\d{1,3}\s*$/.test(v)) return null
  const n = Number(v)
  return n >= 0 && n <= 255 ? n : null
}

/** `<Color R=".." G=".." B=".." F=".."></Color>` 여러 개 → 'rrggbb' (속성 사이 빈칸 수·순서는 따지지 않고 F 는 무시). 틀린 색이 있으면 null */
function xmlColors(block: string): string[] | null {
  const out: string[] = []
  for (const m of block.matchAll(/<Color\b([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {}
    for (const a of m[1]!.matchAll(/\b([A-Za-z]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]!.toUpperCase()] = a[2]!
    const r = channel(attrs['R'])
    const g = channel(attrs['G'])
    const b = channel(attrs['B'])
    if (r === null || g === null || b === null) return null
    out.push(byteHex(r) + byteHex(g) + byteHex(b))
  }
  return out
}

/** 특수색 0개(빈 `<SpecialColors></SpecialColors>`)인 색표는 기본 특수색을 쓴다 */
function palResult(main: string[], special: string[], format: 'xml' | 'lines'): PalParseResult {
  if (main.length !== PAL_MAIN_COLORS) return { ok: false, error: `주 색이 ${PAL_MAIN_COLORS}개가 아닙니다(${main.length}개).` }
  if (special.length !== 0 && special.length !== 3) return { ok: false, error: `특수색은 0개나 3개여야 합니다(${special.length}개).` }
  return {
    ok: true,
    palette: main,
    specialColors: special.length === 3 ? special : [...DEFAULT_SPECIAL_COLORS],
    specialFromFile: special.length === 3,
    format
  }
}

/**
 * OmniPC 색표(.pal) 글자 → 256색 + 특수색 3.
 *   - XML 판 2.0: `<Palette>` → `<Version>2.0</Version>` → `<SpecialColors>` 0 또는 3색 → `<MainColors>` 256색 (4.4 설명서 7.5.1, 사용자 색표 28개)
 *   - 줄 형식: 머리말 없이 `R,G,B[,F]` 256줄 (사용자 폴더 EVDNT_AmplitudeRF.pal)
 * 줄 끝(CRLF·LF), 속성 사이 빈칸 수, F(색 마디 표시로 보임 [추정])는 따지지 않는다. 틀리면 { ok: false, error: 한국어 }.
 */
export function parsePal(text: string): PalParseResult {
  const src = text.replace(/^﻿/, '')
  if (/<Palette\b/.test(src)) {
    const version = /<Version>\s*([^<]*?)\s*<\/Version>/.exec(src)?.[1] ?? null
    if (version !== '2.0') return { ok: false, error: `지원하지 않는 색표 판입니다(${version ?? '판 표시 없음'}). XML 판 2.0 만 읽습니다.` }
    const mainBlock = /<MainColors>([\s\S]*?)<\/MainColors>/.exec(src)?.[1]
    if (mainBlock === undefined) return { ok: false, error: '주 색 목록(MainColors)이 없습니다.' }
    const specialBlock = /<SpecialColors>([\s\S]*?)<\/SpecialColors>/.exec(src)?.[1] ?? ''
    const main = xmlColors(mainBlock)
    const special = xmlColors(specialBlock)
    if (!main || !special) return { ok: false, error: '색 값(R·G·B 0~255)이 올바르지 않은 줄이 있습니다.' }
    return palResult(main, special, 'xml')
  }
  const lines = src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const main: string[] = []
  for (const line of lines) {
    const m = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*-?\d+)?$/.exec(line)
    const r = channel(m?.[1])
    const g = channel(m?.[2])
    const b = channel(m?.[3])
    if (r === null || g === null || b === null) return { ok: false, error: 'OmniPC 색표 형식(XML 판 2.0 또는 R,G,B,F 줄)이 아닙니다.' }
    main.push(byteHex(r) + byteHex(g) + byteHex(b))
  }
  return palResult(main, [], 'lines')
}
