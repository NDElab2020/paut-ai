/**
 * OmniPC 색표(.pal) 읽기 (L2, shared/imaging/palette.ts parsePal · 서비스 readPaletteFile).
 * 근거: 사용자 폴더 문서/Evident/OmniPC/Palette 의 .pal 29개(읽기만 — 앱·시험 자료에 복사하지 않는다)와 MXU 4.4 설명서 7.5.1.
 * 사용자 폴더가 없는 PC 에서는 실제 파일 시험을 건너뛴다(가짜 글자 시험은 늘 돈다).
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readViewerInfo } from '@core/nde/viewer'
import { createAppService } from '@core/service'
import { DEFAULT_AMPLITUDE_PALETTE, DEFAULT_SPECIAL_COLORS, PAL_MAIN_COLORS, parsePal } from '@shared/imaging'
import { X3_FILES } from './paths'

const PALETTE_DIR = join(homedir(), 'Documents', 'Evident', 'OmniPC', 'Palette')
const HAS_PAL = existsSync(join(PALETTE_DIR, 'EVDNT_Amplitude.pal'))
const palFiles = (): string[] => (HAS_PAL ? readdirSync(PALETTE_DIR).filter((n) => n.toLowerCase().endsWith('.pal')).sort() : [])

const color = (r: number, g: number, b: number, f = 0, sep = ' '): string => `<Color${sep}R="${r}"${sep}G="${g}"${sep}B="${b}"${sep}F="${f}"></Color>`
const xmlPal = (special: string[], main: string[], version = '2.0'): string =>
  [
    "<?xml version='1.0'?>",
    '<!--This file represents an Omniscan palette colors definition-->',
    '<Palette>',
    `    <Version>${version}</Version>`,
    `    <SpecialColors>${special.join('\r\n')}</SpecialColors>`,
    '    <MainColors>',
    ...main,
    '    </MainColors>',
    '</Palette>',
    ''
  ].join('\r\n')
const ramp = (sep = ' '): string[] => Array.from({ length: 256 }, (_, i) => color(i, 255 - i, i >> 1, i % 51 === 0 ? 1 : 0, sep))

describe('parsePal (가짜 글자)', () => {
  it('XML 판 2.0: 256색 + 특수색 3, 빈칸 수·F 무시, 소문자 rrggbb', () => {
    const r = parsePal(xmlPal([color(0, 0, 0), color(255, 255, 255), color(128, 128, 128)], ramp('   ')))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.format).toBe('xml')
    expect(r.palette).toHaveLength(PAL_MAIN_COLORS)
    expect(r.palette[0]).toBe('00ff00')
    expect(r.palette[255]).toBe('ff007f')
    expect(r.specialColors).toEqual(['000000', 'ffffff', '808080'])
    expect(r.specialFromFile).toBe(true)
  })

  it('특수색 0개면 기본 특수색, BOM·LF 도 읽는다', () => {
    const r = parsePal('﻿' + xmlPal([], ramp()).replace(/\r\n/g, '\n'))
    expect(r).toMatchObject({ ok: true, specialFromFile: false, specialColors: [...DEFAULT_SPECIAL_COLORS] })
  })

  it('줄 형식 R,G,B,F 256줄', () => {
    const text = Array.from({ length: 256 }, (_, i) => `${i},${i},0,${i === 128 ? 1 : 0}`).join('\r\n') + '\r\n'
    const r = parsePal(text)
    expect(r).toMatchObject({ ok: true, format: 'lines', specialFromFile: false })
    if (r.ok) expect(r.palette[128]).toBe('808000')
  })

  it('틀린 색표는 이유와 함께 거절 (색 수·특수색 수·판·색 값·형식)', () => {
    const err = (t: string): string => {
      const r = parsePal(t)
      return r.ok ? '' : r.error
    }
    expect(err(xmlPal([], ramp().slice(0, 255)))).toMatch(/256개가 아닙니다\(255개\)/)
    expect(err(xmlPal([color(0, 0, 0)], ramp()))).toMatch(/특수색은 0개나 3개/)
    expect(err(xmlPal([], ramp(), '1.0'))).toMatch(/판 2\.0 만/)
    expect(err(xmlPal([], [...ramp().slice(0, 255), color(256, 0, 0)]))).toMatch(/색 값/)
    expect(err('hello')).toMatch(/형식/)
    expect(err('<Palette><Version>2.0</Version></Palette>')).toMatch(/MainColors/)
  })
})

describe.skipIf(!HAS_PAL)('사용자 OmniPC 색표 폴더 (읽기만)', () => {
  it('.pal 29개를 모두 읽는다 (XML 28 · 줄 형식 1, 특수색 0 또는 3)', () => {
    const names = palFiles()
    expect(names.length).toBe(29)
    const formats = { xml: 0, lines: 0 }
    for (const n of names) {
      const r = parsePal(readFileSync(join(PALETTE_DIR, n), 'utf8'))
      expect(r.ok, `${n}: ${r.ok ? '' : r.error}`).toBe(true)
      if (!r.ok) continue
      formats[r.format]++
      expect(r.palette).toHaveLength(256)
      expect(r.specialColors).toHaveLength(3)
    }
    expect(formats).toEqual({ xml: 28, lines: 1 })
    const rf = parsePal(readFileSync(join(PALETTE_DIR, 'EVDNT_AmplitudeRF.pal'), 'utf8'))
    expect(rf.ok && rf.format).toBe('lines')
  })

  it('EVDNT_Amplitude = 앱 기본 진폭 색표(256색 차이 0) = X3 파일 색표, 특수색 000000·ffffff·808080', async () => {
    const r = parsePal(readFileSync(join(PALETTE_DIR, 'EVDNT_Amplitude.pal'), 'utf8'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.palette).toEqual([...DEFAULT_AMPLITUDE_PALETTE])
    expect(r.specialColors).toEqual(['000000', 'ffffff', '808080'])
    expect(r.specialFromFile).toBe(true)
    if (existsSync(X3_FILES[0]!)) {
      const info = await readViewerInfo(X3_FILES[0]!)
      expect(info.display.paletteSource).toBe('file')
      expect(r.palette).toEqual(info.display.palette)
      expect(r.specialColors).toEqual(info.display.specialColors)
    }
  })
})

describe('서비스 readPaletteFile (main 대화상자가 고른 경로)', () => {
  const work = mkdtempSync(join(tmpdir(), 'paut-pal-'))
  const service = createAppService({ settingsPath: join(work, 'settings.json') })
  afterAll(() => {
    service.close()
    rmSync(work, { recursive: true, force: true })
  })

  it('가짜 .pal 을 읽고, 틀린 파일·확장자·없는 파일은 거절', async () => {
    const good = join(work, '회색.pal')
    writeFileSync(good, xmlPal([], ramp()))
    expect(await service.readPaletteFile(good)).toMatchObject({ name: '회색', format: 'xml', specialFromFile: false })
    const bad = join(work, 'bad.pal')
    writeFileSync(bad, 'not a palette')
    await expect(service.readPaletteFile(bad)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.readPaletteFile(join(work, 'x.txt'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.readPaletteFile(join(work, 'none.pal'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(service.readPaletteFile('relative.pal')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it.skipIf(!HAS_PAL)('사용자 폴더 EVDNT_Amplitude.pal (원본은 바뀌지 않는다)', async () => {
    const p = join(PALETTE_DIR, 'EVDNT_Amplitude.pal')
    const before = readFileSync(p)
    const r = await service.readPaletteFile(p)
    expect(r).toMatchObject({ name: 'EVDNT_Amplitude', format: 'xml', specialFromFile: true })
    expect(r.palette).toEqual([...DEFAULT_AMPLITUDE_PALETTE])
    expect(readFileSync(p).equals(before)).toBe(true)
  })
})
