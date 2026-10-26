/** 진폭 조각 나누기: main → renderer 로 한 번에 보내는 크기 상한 (계획 5절, IPC 메시지 크기 안전 범위) */
import type { ViewerGroup } from './types'

export const VIEWER_CHUNK_BYTES = 32 * 1024 * 1024

/** 조각 하나에 담는 스캔 칸 수 (int16 [스캔, 빔, 샘플], 최소 1). main readViewerChunk 와 renderer chunkRanges 가 같이 쓴다 */
export function scansPerChunk(shape: ViewerGroup['shape'], maxBytes = VIEWER_CHUNK_BYTES): number {
  const [, nb, nt] = shape
  return Math.max(1, Math.floor(maxBytes / Math.max(1, nb * nt * 2)))
}

/** 그룹 진폭을 스캔 방향으로 나눈 [시작, 칸 수] 목록 (조각마다 VIEWER_CHUNK_BYTES 이하) */
export function chunkRanges(shape: ViewerGroup['shape'], maxBytes = VIEWER_CHUNK_BYTES): Array<[number, number]> {
  const ns = shape[0]
  const step = scansPerChunk(shape, maxBytes)
  const out: Array<[number, number]> = []
  for (let s = 0; s < ns; s += step) out.push([s, Math.min(step, ns - s)])
  return out
}
