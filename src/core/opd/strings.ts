/**
 * OPD 안 문자열: UTF-16LE, 끝에 0x0000 하나, 길이 머리 없음.
 * 그룹 이름(`FblUT_Beam_GROUP` 등)·장비 정보·탐촉자 모델·빔 이름·장비 저장 이름이 모두 이 형태다.
 */
import type { ByteView } from './bytes'
import { structureFail, type OpdCheck } from './errors'

export interface Utf16Z {
  text: string
  /** 문자열 첫 바이트 위치 */
  start: number
  /** 끝 0x0000 바로 다음 위치 */
  end: number
}

/** 문자열 최대 길이(글자). 이보다 길면 문자열이 아닌 곳을 읽은 것으로 본다 */
export const MAX_STRING_CHARS = 512

/** 글자로 받아들일 UTF-16 단위: 제어 문자(0x00~0x1F, 0x7F)와 짝 없는 대리 문자는 거른다 */
function isTextUnit(u: number): boolean {
  if (u < 0x20 || u === 0x7f) return false
  if (u >= 0xfffe) return false
  return true
}

/** pos 의 0 끝 UTF-16 문자열. 글자가 아닌 단위가 나오거나 너무 길면 check 이름으로 해석 실패 */
export function readUtf16z(view: ByteView, pos: number, check: OpdCheck, what: string, maxChars = MAX_STRING_CHARS): Utf16Z {
  let p = pos
  const units: number[] = []
  for (;;) {
    const u = view.u16(p)
    p += 2
    if (u === 0) break
    if (!isTextUnit(u) || units.length >= maxChars) {
      structureFail(check, `${what} 문자열을 읽지 못했습니다.`, `pos=0x${pos.toString(16)} unit=0x${u.toString(16)} len=${units.length}`)
    }
    units.push(u)
  }
  // 짝이 맞지 않는 대리 문자가 있으면 문자열이 아니다
  if (!wellFormed(units)) structureFail(check, `${what} 문자열을 읽지 못했습니다.`, `pos=0x${pos.toString(16)} ill-formed`)
  return { text: String.fromCharCode(...units), start: pos, end: p }
}

function wellFormed(units: readonly number[]): boolean {
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!
    if (u >= 0xd800 && u <= 0xdbff) {
      const n = units[i + 1]
      if (n === undefined || n < 0xdc00 || n > 0xdfff) return false
      i++
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      return false
    }
  }
  return true
}

/** pos 에 정확히 expected 문자열(0 끝 포함)이 있는가 (예외 없음) */
export function hasUtf16z(view: ByteView, pos: number, expected: string): boolean {
  const len = (expected.length + 1) * 2
  if (pos < 0 || pos + len > view.fileSize) return false
  view.need(pos, len)
  for (let i = 0; i < expected.length; i++) {
    if (view.u16(pos + 2 * i) !== expected.charCodeAt(i)) return false
  }
  return view.u16(pos + 2 * expected.length) === 0
}

/** expected 문자열을 차례로 읽는다 (구조 점검: 하나라도 다르면 해석 실패). 끝 위치를 돌려준다 */
export function expectUtf16zSeq(view: ByteView, pos: number, expected: readonly string[], check: OpdCheck, what: string): number {
  let p = pos
  for (const e of expected) {
    if (!hasUtf16z(view, p, e)) structureFail(check, `${what} 구조가 예상과 다릅니다.`, `expected '${e}' at 0x${p.toString(16)}`)
    p += (e.length + 1) * 2
  }
  return p
}

/** [from, to) 에서 0 끝 UTF-16 문자열 needle 이 처음 나오는 위치 (2바이트 정렬은 가정하지 않음). 없으면 -1 */
export function findUtf16z(view: ByteView, needle: string, from: number, to: number): number {
  const pat = new Uint8Array((needle.length + 1) * 2)
  for (let i = 0; i < needle.length; i++) {
    const c = needle.charCodeAt(i)
    pat[2 * i] = c & 0xff
    pat[2 * i + 1] = c >> 8
  }
  return findBytes(view, pat, from, to)
}

/** [from, to) 에서 pat 이 처음 나오는 위치. 없으면 -1. to 가 읽은 범위를 넘으면 NeedMoreBytes */
export function findBytes(view: ByteView, pat: Uint8Array, from: number, to: number): number {
  const end = Math.min(to, view.fileSize)
  if (end - from < pat.length) return -1
  view.need(from, end - from)
  const b = view.bytes
  const first = pat[0]!
  for (let i = from; i <= end - pat.length; i++) {
    if (b[i] !== first) continue
    let ok = true
    for (let k = 1; k < pat.length; k++) {
      if (b[i + k] !== pat[k]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

/** OLE 자동화 날짜(1899-12-30 기준 날 수, 시간대 없음) → 'YYYY-MM-DDTHH:mm:ss' (가장 가까운 초). 범위 밖이면 null */
export function oleDateToIso(days: number): string | null {
  if (!Number.isFinite(days) || days < 1 || days > 2_958_465) return null
  const OLE_EPOCH_MS = Date.UTC(1899, 11, 30)
  const ms = OLE_EPOCH_MS + Math.round(days * 86_400) * 1000
  return new Date(ms).toISOString().slice(0, 19)
}

export interface MxuVersion {
  major: number
  minor: number
  /** 'R5' 의 5 */
  revision: number
}

/** 'MXU - 4.4R5' → { 4, 4, 5 }. 모양이 다르면 null */
export function parseMxuVersion(raw: string): MxuVersion | null {
  const m = /^MXU\s*-\s*(\d+)\.(\d+)\s*R(\d+)$/i.exec(raw.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), revision: Number(m[3]) }
}
