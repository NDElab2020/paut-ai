/**
 * 후처리 상태의 세션 캐시와 React 훅 (렌더러). 리듀서는 shared/imaging/postReducer.ts, 모델은 shared/imaging/postprocess.ts.
 *   - 세션 캐시: 뷰어 key('storeRoot|fileId|sha256') → PostProcess. 뒤로 갔다 다시 열어도 유지, 저장소가 바뀌면 clearPostState()
 *   - 파생 C-scan 캐시: 게이트 편집으로 다시 계산한 C-scan (그룹당 3개). 파일 게이트와 창이 같으면 volume.cscan 그대로
 *   - 세션 색표 (L2, 2026-10-07 기본값 (나) — 사용자 확인 대기): 한 파일 보기에서 불러온 OmniPC 색표(.pal)를 앱을 닫을 때까지 모든 파일 보기에 쓴다.
 *     파일을 열 때 그 파일의 후처리에 넣고(되돌리기 이력 없이), 어느 파일에서든 빼면(되돌리기·초기화·파일값으로) 세션에서도 빠진다.
 *     2인 블라인드 판독(settings.labelBlindMode)에서는 쓰지 않는다(두 판독자 화면을 같게 — NdeViewer 가 null 로 넘김). 저장소와 무관해 clearPostState 로 비우지 않는다
 */
import { useEffect, useReducer, type Dispatch } from 'react'
import {
  type PostPaletteFile,
  createGateCscan,
  fillGateCscan,
  findGate,
  gateWindowSignature,
  postReducer,
  sanitizePostProcess,
  type GateCscan,
  type PostAction,
  type PostProcess,
  type PostState,
  type ViewerGate,
  type ViewerGroup
} from '@shared/imaging'
import type { GroupVolume } from './volumeStore'

export type { PostAction, PostState } from '@shared/imaging'

const cache = new Map<string, PostProcess>()
const derived = new Map<string, GateCscan>()
/** 그룹당 파생 C-scan 보관 수 */
export const DERIVED_CSCAN_PER_GROUP = 3

/** 저장소를 바꿀 때 등 모두 버릴 때 (volumeStore.clearVolumes 와 함께 부른다) */
export function clearPostState(): void {
  cache.clear()
  derived.clear()
}

let sessionPalette: PostPaletteFile | null = null

/** 세션 색표 (없으면 null) */
export function sessionPaletteFile(): PostPaletteFile | null {
  return sessionPalette
}

export function setSessionPaletteFile(f: PostPaletteFile | null): void {
  sessionPalette = f
}

/** 후처리에 세션 색표를 맞춘다 (같으면 같은 객체 — 색표가 없으면 칸을 만들지 않아 보통 그림 바이트 그대로) */
export function withSessionPalette(post: PostProcess, palette: PostPaletteFile | null): PostProcess {
  const cur = post.paletteFile ?? null
  if (cur === palette) return post
  if (palette === null) {
    const { paletteFile: _drop, ...rest } = post
    return rest
  }
  if (cur && cur.name === palette.name && cur.palette.join() === palette.palette.join() && cur.specialColors.join() === palette.specialColors.join()) return post
  return { ...post, paletteFile: palette }
}

/** 테스트·점검용: 캐시에 든 파일 수 */
export function postCacheSize(): number {
  return cache.size
}

function sha256Of(key: string): string {
  return key.slice(key.lastIndexOf('|') + 1)
}

/**
 * 파일(뷰어 key)의 후처리 상태. 세션 캐시에 있으면 그것으로 시작하고, 바뀔 때마다 캐시에 둔다.
 * groups 는 검증(없는 그룹·게이트 제거)에만 쓴다.
 */
export function usePostProcess(key: string, groups: ReadonlyArray<ViewerGroup>, palette: PostPaletteFile | null = null): [PostState, Dispatch<PostAction>] {
  const [state, dispatch] = useReducer(postReducer, key, (k): PostState => {
    const cached = cache.get(k)
    const { post } = sanitizePostProcess(cached ?? null, { fileSha256: sha256Of(k), groups })
    // 세션 색표를 이 파일에도 (되돌리기 이력에 넣지 않음)
    return { post: withSessionPalette(post, palette), history: [] }
  })
  useEffect(() => {
    cache.set(key, state.post)
  }, [key, state.post])
  return [state, dispatch]
}

/**
 * 유효 게이트의 C-scan. 파일 게이트와 창(서명)이 같으면 volume.cscan 을 그대로(재계산·메모리 0),
 * 아니면 볼륨 전체로 한 번 계산해 그룹당 DERIVED_CSCAN_PER_GROUP 개까지 보관한다 (5~27 ms/그룹).
 */
export function derivedCscan(viewerKey: string, group: ViewerGroup, volume: GroupVolume, gate: ViewerGate | null): GateCscan | null {
  if (!gate || !gate.supported) return null
  const sig = gateWindowSignature(group, gate)
  const fileGate = findGate(group, group.cscanGateId)
  if (volume.cscan && fileGate && fileGate.id === gate.id && gateWindowSignature(group, fileGate) === sig) return volume.cscan
  const prefix = `${viewerKey}|${group.id}|`
  const k = prefix + sig
  const hit = derived.get(k)
  if (hit) {
    // 최근 사용으로 (Map 삽입 순서 = 오래된 순)
    derived.delete(k)
    derived.set(k, hit)
    return hit
  }
  const cs = createGateCscan(group, gate.id)
  fillGateCscan(cs, group, gate, { scanStart: 0, scanCount: group.shape[0], amplitude: volume.amplitude, status: volume.status })
  derived.set(k, cs)
  let n = 0
  for (const key of [...derived.keys()].reverse()) {
    if (!key.startsWith(prefix)) continue
    n++
    if (n > DERIVED_CSCAN_PER_GROUP) derived.delete(key)
  }
  return cs
}
