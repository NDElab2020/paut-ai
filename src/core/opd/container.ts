/**
 * SURD 컨테이너 머리(0x20 바이트)와 꼬리 색인.
 *
 *   0x00  44 33 22 11 'SURD'          매직
 *   0x08  u32 big-endian              머리 버전 (162개 모두 3)
 *   0x10  u32                         꼬리 색인 개수 n (162개 모두 8)
 *   0x14  u32                         꼬리 색인 위치 (16 B × n 이 파일 끝까지)
 *   0x18  u32                         파일 크기
 *   색인 항목 16 B = (종류, 개수, 위치, 기타) u32 × 4
 */
import type { ByteView } from './bytes'
import { structureFail } from './errors'
import type { OpdContainer, OpdTailEntry } from './types'

export const OPD_HEADER_BYTES = 0x20
const MAGIC = [0x44, 0x33, 0x22, 0x11, 0x53, 0x55, 0x52, 0x44] as const
const SUPPORTED_VERSIONS = new Set([3])
const MAX_INDEX_ENTRIES = 64

/** 앞 8바이트가 SURD 매직인가 (확장자와 함께 OPD 판별용, 예외 없음) */
export function hasOpdMagic(head: Uint8Array): boolean {
  if (head.length < MAGIC.length) return false
  return MAGIC.every((b, i) => head[i] === b)
}

/** 머리 0x20 바이트 해석. 파일 크기 불일치(잘림)·색인 위치 이상은 해석 실패 */
export function parseContainerHeader(view: ByteView): Omit<OpdContainer, 'entries'> & { indexCount: number } {
  const size = view.fileSize
  if (size < OPD_HEADER_BYTES) structureFail('file-size', '파일이 너무 짧습니다(잘렸거나 손상됨).', `size=${size}`)
  if (!hasOpdMagic(view.slice(0, 8))) structureFail('magic', 'OPD(SURD) 파일 머리가 아닙니다.')
  const version = view.u32be(0x08)
  if (!SUPPORTED_VERSIONS.has(version)) structureFail('container-version', `알 수 없는 OPD 머리 버전입니다(${version}).`)
  const indexCount = view.u32(0x10)
  const indexOffset = view.u32(0x14)
  const declared = view.u32(0x18)
  if (declared !== size) {
    structureFail('file-size', '파일 크기가 머리에 적힌 크기와 다릅니다(잘렸거나 손상됨).', `declared=${declared} actual=${size}`)
  }
  if (indexCount < 2 || indexCount > MAX_INDEX_ENTRIES || indexOffset + 16 * indexCount !== size) {
    structureFail('tail-index', '꼬리 색인 위치가 맞지 않습니다.', `n=${indexCount} at=${indexOffset} size=${size}`)
  }
  return { version, fileSize: size, indexOffset, indexCount }
}

/**
 * 꼬리 색인 항목. 위치는 머리 뒤·색인 앞이어야 하고, 둘째 항목부터 오름차순.
 * view 의 at 위치에서 읽는다 (파일 전체면 at = indexOffset, 색인만 따로 읽었으면 0).
 */
export function parseTailIndex(view: ByteView, at: number, indexCount: number, indexOffset: number): OpdTailEntry[] {
  const entries: OpdTailEntry[] = []
  for (let i = 0; i < indexCount; i++) {
    const p = at + 16 * i
    entries.push({ kind: view.u32(p), count: view.u32(p + 4), offset: view.u32(p + 8), extra: view.u32(p + 12) })
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.offset < OPD_HEADER_BYTES || e.offset >= indexOffset) {
      structureFail('tail-index', '꼬리 색인이 파일 밖을 가리킵니다.', `entry ${i} offset=${e.offset}`)
    }
    if (i >= 2 && e.offset <= entries[i - 1]!.offset) {
      structureFail('tail-index', '꼬리 색인 순서가 맞지 않습니다.', `entry ${i} offset=${e.offset}`)
    }
  }
  return entries
}
