/**
 * 렌더러 볼륨 저장소: 그룹 진폭(int16)·상태·게이트 C-scan 을 화면 상태와 떼어 들고 있는다.
 * 키 = viewer:open 의 key('storeRoot|fileId|sha256') + 그룹 id → 저장소가 바뀌면 같은 fileId 여도 새로 읽는다.
 * 합계가 상한을 넘으면 오래 안 쓴 것부터 버린다 (방금 넣은 파일의 다른 그룹은 남긴다).
 * 읽는 중인 그룹은 구독자(화면)마다 진행률을 알리고, 구독자가 모두 떠나면 다음 조각 전에 멈춘다.
 */
import type { PautApi } from '@shared/api'
import { chunkRanges, createGateCscan, fillGateCscan, findGate, type GateCscan, type ViewerGroup } from '@shared/imaging'
import { ApiCallError, unwrap } from '../api'

export const VOLUME_CACHE_BYTES = 256 * 1024 * 1024

export interface GroupVolume {
  group: ViewerGroup
  /** [스캔, 빔, 샘플] */
  amplitude: Int16Array
  /** [스캔, 빔] 상태 비트, 없으면 null */
  status: Uint8Array | null
  /** C-scan 게이트(보통 A) 최대값. 게이트가 없거나 지원하지 않으면 null */
  cscan: GateCscan | null
  bytes: number
}

export type VolumeProgress = (done: number, total: number) => void

/** loadVolume 결과: promise 와 구독 해제(화면을 떠날 때 부른다) */
export interface VolumeLoad {
  promise: Promise<GroupVolume>
  release: () => void
}

interface Pending {
  promise: Promise<GroupVolume>
  listeners: Set<VolumeProgress>
  /** 마지막 진행률 (늦게 붙은 구독자에게 바로 알린다) */
  last: [number, number] | null
  refs: number
  settled: boolean
  ctrl: AbortController
}

/** 구독자가 모두 떠나 멈춘 읽기. 화면에는 오류로 띄우지 않는다 */
export class VolumeLoadAborted extends Error {
  constructor() {
    super('진폭 읽기를 멈췄습니다.')
    this.name = 'VolumeLoadAborted'
  }
}

export function isVolumeLoadAborted(e: unknown): boolean {
  return e instanceof VolumeLoadAborted
}

const cache = new Map<string, GroupVolume>()
const pending = new Map<string, Pending>()
/** clearVolumes 마다 올린다: 그 전에 시작한 읽기 결과는 캐시에 넣지 않는다 */
let generation = 0

function evict(keepPrefix: string): void {
  let total = 0
  for (const v of cache.values()) total += v.bytes
  for (const [k, v] of cache) {
    if (total <= VOLUME_CACHE_BYTES) break
    // 같은 파일의 그룹끼리 서로 밀어내면 다시 열 때마다 번갈아 읽게 된다
    if (k.startsWith(keepPrefix)) continue
    cache.delete(k)
    total -= v.bytes
  }
}

/** 그룹 진폭을 조각으로 받아 하나로 잇고 C-scan 을 계산한다. emit(받은 칸, 전체 칸) */
async function fetchVolume(api: PautApi, key: string, fileId: number, group: ViewerGroup, emit: VolumeProgress, signal: AbortSignal): Promise<GroupVolume> {
  const [ns, nb, nt] = group.shape
  const ranges = chunkRanges(group.shape)
  let amplitude: Int16Array | null = null
  let status: Uint8Array | null = null
  let done = 0
  for (const [start, count] of ranges) {
    if (signal.aborted) throw new VolumeLoadAborted()
    // key 를 함께 보내 main 이 그사이 저장소·파일이 바뀌었으면 CONFLICT 로 거절하게 한다
    const chunk = await unwrap(api.viewer.chunk(fileId, key, group.id, start, count))
    if (signal.aborted) throw new VolumeLoadAborted()
    // main 이 조각을 더 작게 자르면(조각 크기 계산 불일치) 빈칸이 0 으로 남으므로 바로 오류로 알린다
    if (chunk.scanStart !== start || chunk.scanCount !== count) {
      throw new ApiCallError('INTERNAL', '진폭 데이터를 끝까지 받지 못했습니다.', `group ${group.id}: 요청 [${start}, ${count}] ≠ 받음 [${chunk.scanStart}, ${chunk.scanCount}]`)
    }
    // 길이가 모양과 다르면(다른 파일의 조각 등) 잇지 않는다
    if (chunk.amplitude.length !== count * nb * nt || (chunk.status && chunk.status.length !== count * nb)) {
      throw new ApiCallError(
        'INTERNAL',
        '진폭 데이터 크기가 파일 정보와 맞지 않습니다.',
        `group ${group.id} [${start}, ${count}]: 진폭 ${chunk.amplitude.length} ≠ ${count * nb * nt}, 상태 ${chunk.status?.length ?? '-'} ≠ ${count * nb}`
      )
    }
    if (ranges.length === 1 && chunk.scanCount === ns) {
      amplitude = chunk.amplitude
      status = chunk.status
    } else {
      amplitude ??= new Int16Array(ns * nb * nt)
      amplitude.set(chunk.amplitude, chunk.scanStart * nb * nt)
      if (chunk.status) {
        status ??= new Uint8Array(ns * nb)
        status.set(chunk.status, chunk.scanStart * nb)
      }
    }
    done += chunk.scanCount
    emit(done, ns)
  }
  const amp = amplitude ?? new Int16Array(ns * nb * nt)
  const gate = findGate(group, group.cscanGateId)
  let cscan: GateCscan | null = null
  if (gate?.supported) {
    cscan = createGateCscan(group, gate.id)
    fillGateCscan(cscan, group, gate, { scanStart: 0, scanCount: ns, amplitude: amp, status })
  }
  return { group, amplitude: amp, status, cscan, bytes: amp.byteLength + (status?.byteLength ?? 0) }
}

export function cachedVolume(key: string, groupId: number): GroupVolume | null {
  const k = `${key}#${groupId}`
  const v = cache.get(k)
  if (!v) return null
  cache.delete(k)
  cache.set(k, v)
  return v
}

/**
 * 그룹 볼륨을 읽는다. 같은 그룹을 이미 읽는 중이면 그 읽기에 붙어 진행률을 함께 받는다.
 * 다 쓰면 release() — 마지막 구독자가 떠나면 다음 조각 전에 멈추고 받던 버퍼를 버린다.
 */
export function loadVolume(api: PautApi, key: string, fileId: number, group: ViewerGroup, onProgress?: VolumeProgress): VolumeLoad {
  const k = `${key}#${group.id}`
  const hit = cachedVolume(key, group.id)
  if (hit) return { promise: Promise.resolve(hit), release: () => undefined }
  let entry = pending.get(k)
  if (!entry) {
    const ctrl = new AbortController()
    const gen = generation
    const s: Omit<Pending, 'promise'> = { listeners: new Set(), last: null, refs: 0, settled: false, ctrl }
    const emit: VolumeProgress = (done, total) => {
      s.last = [done, total]
      for (const l of s.listeners) l(done, total)
    }
    const promise = fetchVolume(api, key, fileId, group, emit, ctrl.signal).then(
      (v) => {
        s.settled = true
        if (pending.get(k) === s) pending.delete(k)
        if (gen === generation) {
          cache.set(k, v)
          evict(`${key}#`)
        }
        return v
      },
      (err: unknown) => {
        s.settled = true
        if (pending.get(k) === s) pending.delete(k)
        throw err
      }
    )
    entry = Object.assign(s, { promise })
    pending.set(k, entry)
  }
  const e = entry
  e.refs++
  if (onProgress) {
    e.listeners.add(onProgress)
    if (e.last) onProgress(e.last[0], e.last[1])
  }
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    if (onProgress) e.listeners.delete(onProgress)
    e.refs--
    // effect 를 다시 돌릴 때(해제 → 바로 다시 구독)는 멈추지 않도록 한 박자 늦춰 본다
    setTimeout(() => {
      if (e.refs > 0 || e.settled) return
      e.ctrl.abort()
      if (pending.get(k) === e) pending.delete(k)
    }, 0)
  }
  return { promise: e.promise, release }
}

/** 저장소를 바꾸는 등 모두 버릴 때. 읽는 중인 것은 끝나도 캐시에 넣지 않는다 */
export function clearVolumes(): void {
  generation++
  cache.clear()
  pending.clear()
}
