/** ZIP 읽기 (core/labels/xlsx/zip.ts): 저장·deflate·데이터 설명자, zip64·손상·지원하지 않는 형식은 오류 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { XlsxError, crc32, openZip } from '@core/labels/xlsx'
import { buildZip, fixture } from './xlsxKit'

function reasonOf(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof XlsxError) return e.reason
    throw e
  }
  return 'no-error'
}

describe('ZIP 읽기', () => {
  it('CRC-32 알려진 값', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })

  it('저장·deflate·데이터 설명자 항목과 끝 주석을 읽는다', () => {
    const big = '가나다 abc '.repeat(5000)
    const zip = buildZip(
      [
        { name: 'a.txt', data: 'hello', method: 0 },
        { name: 'dir/b.xml', data: big },
        { name: 'c.bin', data: Buffer.from([0, 1, 2, 255]), descriptor: true },
        { name: '한글.txt', data: '값', method: 8, descriptor: true }
      ],
      { comment: 'zip comment' }
    )
    const z = openZip(zip)
    expect(z.names()).toEqual(['a.txt', 'dir/b.xml', 'c.bin', '한글.txt'])
    expect(z.readText('a.txt')).toBe('hello')
    expect(z.readText('dir/b.xml')).toBe(big)
    expect([...z.read('c.bin')!]).toEqual([0, 1, 2, 255])
    expect(z.readText('한글.txt')).toBe('값')
    expect(z.read('없음')).toBeNull()
    expect(z.entry('dir/b.xml')?.method).toBe(8)
  })

  it('UTF-8 BOM 을 뗀다', () => {
    const z = openZip(buildZip([{ name: 'x.xml', data: '﻿<a/>' }]))
    expect(z.readText('x.xml')).toBe('<a/>')
  })

  it('openpyxl 이 만든 양식 픽스처 (deflate 36개 항목)', () => {
    const z = openZip(readFileSync(fixture('x3_blind_kim.xlsx')))
    expect(z.has('xl/workbook.xml')).toBe(true)
    expect(z.readText('xl/workbook.xml')).toContain('<sheets>')
  })

  it('zip64 는 오류 (zip64 끝 위치 표시, 0xFFFF 항목 수)', () => {
    expect(reasonOf(() => openZip(buildZip([{ name: 'a', data: 'x' }], { zip64Locator: true })))).toBe('zip64')
    const z = buildZip([{ name: 'a', data: 'x' }])
    const eocd = z.length - 22
    const m = Buffer.from(z)
    m.writeUInt16LE(0xffff, eocd + 8)
    m.writeUInt16LE(0xffff, eocd + 10)
    expect(reasonOf(() => openZip(m))).toBe('zip64')
    const m2 = Buffer.from(z)
    m2.writeUInt32LE(0xffffffff, eocd + 16)
    expect(reasonOf(() => openZip(m2))).toBe('zip64')
  })

  it('손상: 잘린 파일, 중앙 디렉터리 위치 틀림, CRC 틀림, 압축 데이터 깨짐', () => {
    const z = buildZip([
      { name: 'a.xml', data: '<a>'.repeat(1000) },
      { name: 'b.xml', data: 'b' }
    ])
    // 끝을 자르면 EOCD 가 없다 (PK 로 시작 → 손상)
    expect(reasonOf(() => openZip(z.subarray(0, z.length - 30)))).toBe('corrupt')
    // 중앙 디렉터리 위치가 파일 밖
    const m = Buffer.from(z)
    m.writeUInt32LE(z.length, z.length - 22 + 16)
    expect(reasonOf(() => openZip(m))).toBe('corrupt')
    // 압축 데이터 한 바이트를 바꾸면 inflate 실패 또는 CRC 틀림
    const m2 = Buffer.from(z)
    m2[40] = m2[40]! ^ 0xff
    expect(reasonOf(() => openZip(m2).read('a.xml'))).toBe('corrupt')
    // 저장 방식 항목의 내용을 바꾸면 CRC 틀림
    const s = buildZip([{ name: 'a', data: 'hello', method: 0 }])
    const m3 = Buffer.from(s)
    m3[30 + 1] = 'X'.charCodeAt(0)
    expect(reasonOf(() => openZip(m3).read('a'))).toBe('corrupt')
    // 로컬 머리 위치가 틀림
    const m4 = Buffer.from(s)
    m4.writeUInt32LE(0, 0)
    expect(reasonOf(() => openZip(m4).read('a'))).toBe('corrupt')
  })

  it('ZIP 이 아니거나 옛 엑셀(.xls)이면 오류', () => {
    expect(reasonOf(() => openZip(Buffer.from('hello')))).toBe('not-zip')
    expect(reasonOf(() => openZip(Buffer.alloc(100, 7)))).toBe('not-zip')
    const xls = Buffer.alloc(512)
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(xls)
    expect(reasonOf(() => openZip(xls))).toBe('not-xlsx')
  })

  it('지원하지 않는 압축 방식·암호는 오류', () => {
    const z = Buffer.from(buildZip([{ name: 'a', data: 'hello', method: 0 }]))
    const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    const m = Buffer.from(z)
    m.writeUInt16LE(12, cd + 10) // bzip2
    expect(reasonOf(() => openZip(m).read('a'))).toBe('unsupported')
    const e = Buffer.from(z)
    e.writeUInt16LE(e.readUInt16LE(cd + 8) | 1, cd + 8)
    expect(reasonOf(() => openZip(e).read('a'))).toBe('unsupported')
  })

  it('선언한 크기보다 크게 풀리면 손상 (압축 폭탄 막기)', () => {
    const z = Buffer.from(buildZip([{ name: 'a', data: 'x'.repeat(10000) }]))
    const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    z.writeUInt32LE(10, cd + 24) // 풀린 크기를 10 바이트로 속임
    expect(reasonOf(() => openZip(z).read('a'))).toBe('corrupt')
  })

  it('같은 이름 항목이 둘이면 손상', () => {
    expect(reasonOf(() => openZip(buildZip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }])))).toBe('corrupt')
  })
})
