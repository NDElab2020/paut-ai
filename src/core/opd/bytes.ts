/**
 * 파일 앞부분(또는 전체) 바이트를 절대 위치로 읽는 도구.
 * 값은 모두 little-endian. 범위를 넘으면 — 파일 끝 안쪽이면 NeedMoreBytes(더 읽어 오라는 신호),
 * 파일 끝 밖이면 '보류(해석 실패)'.
 */
import { NeedMoreBytes, structureFail } from './errors'

export class ByteView {
  readonly bytes: Uint8Array
  /** 파일 전체 크기 (bytes 가 앞부분만일 수 있음) */
  readonly fileSize: number
  private readonly dv: DataView

  constructor(bytes: Uint8Array, fileSize: number = bytes.length) {
    this.bytes = bytes
    this.fileSize = fileSize
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  /** [pos, pos+len) 이 읽을 수 있는지 확인. 아니면 NeedMoreBytes 또는 해석 실패 */
  need(pos: number, len: number): void {
    if (!Number.isInteger(pos) || pos < 0 || len < 0) structureFail('bounds', '파일 안 위치 계산이 맞지 않습니다.', `pos=${pos} len=${len}`)
    const end = pos + len
    if (end <= this.bytes.length) return
    if (end <= this.fileSize) throw new NeedMoreBytes(end)
    structureFail('bounds', '파일이 예상보다 짧습니다(잘렸거나 손상됨).', `need ${end} > size ${this.fileSize}`)
  }

  u8(pos: number): number {
    this.need(pos, 1)
    return this.bytes[pos]!
  }

  u16(pos: number): number {
    this.need(pos, 2)
    return this.dv.getUint16(pos, true)
  }

  u32(pos: number): number {
    this.need(pos, 4)
    return this.dv.getUint32(pos, true)
  }

  u32be(pos: number): number {
    this.need(pos, 4)
    return this.dv.getUint32(pos, false)
  }

  f64(pos: number): number {
    this.need(pos, 8)
    return this.dv.getFloat64(pos, true)
  }

  slice(pos: number, len: number): Uint8Array {
    this.need(pos, len)
    return this.bytes.subarray(pos, pos + len)
  }

  /** pos 부터 len 바이트가 모두 0 인가 */
  isZero(pos: number, len: number): boolean {
    this.need(pos, len)
    for (let i = pos; i < pos + len; i++) if (this.bytes[i] !== 0) return false
    return true
  }
}
