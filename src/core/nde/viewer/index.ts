/**
 * 이미지 보기용 NDE 읽기 — 읽기 전용, 요청마다 열고 반드시 닫는다(withH5File).
 *   readViewerInfo  : 그룹·축·빔·게이트·시편·화면 상태 (수 KB)
 *   readViewerChunk : 그룹 진폭 조각 [스캔 범위, 빔, 샘플] int16 + 상태 비트
 */
import { AppError } from '@shared/errors'
import type { ViewerFileInfo, ViewerGroup, ViewerVolumeChunk } from '@shared/imaging/types'
import { scansPerChunk } from '@shared/imaging/volume'
import { NdeError } from '../errors'
import { childKeys, getPath, readStringDataset, withH5File, type H5File } from '../h5'
import { readModelSetupXml, readSetup, type NdeLayout } from '../read'
import { parseBusinessSetup, parseModelSetup } from './display'
import { buildViewerInfo, offsetWarnings, type DatasetProbe } from './meta'
import { maskPaintbrushAmplitude } from './paintbrush'

export { VIEWER_MAX_GROUP_BYTES, beamOrderProblem, buildViewerInfo, fileSourceOf, isVerifiedKind, parseAppVersion, refBasisOf, verifiedKinds } from './meta'
export { parseBusinessSetup, parseModelSetup, defaultDisplay } from './display'
export type { BusinessAssemblyRef, BusinessGateRef, BusinessGroupRef, GroupSetupExtra, ModelSetupFileRef, ParsedBusiness, ParsedDisplay } from './display'

type H5Dataset = { shape: number[] | null; metadata: { type: number; size: number; signed: boolean }; slice: (r: Array<number[]>) => unknown }

function dataset(file: H5File, path: string): H5Dataset | null {
  const e = getPath(file, path)
  return e && 'shape' in e && 'metadata' in e && 'slice' in e ? (e as unknown as H5Dataset) : null
}

function probe(file: H5File, path: string): DatasetProbe | null {
  const d = dataset(file, path)
  if (!d) return null
  return { shape: d.shape ?? [], type: d.metadata.type, size: d.metadata.size, signed: !!d.metadata.signed }
}

/**
 * 비공개 영역의 장비 앱 BusinessSetup XML (3.x /Applications/<앱>, 4.x /Private/<앱>) 중 처음 나오는 비지 않은 것.
 * 장비 설정 원본이라 커서(X3 1.2 MB, 대부분 소자 지연값) 이미지 보기를 열 때만 읽는다. 없으면 null
 */
export function readBusinessSetupXml(file: H5File, layout: NdeLayout): string | null {
  const privateRoot = layout === '3.x' ? 'Applications' : 'Private'
  for (const app of childKeys(file, privateRoot)) {
    if (!childKeys(file, `${privateRoot}/${app}`).includes('BusinessSetup')) continue
    const xml = readStringDataset(file, `${privateRoot}/${app}/BusinessSetup`)
    if (xml) return xml
  }
  return null
}

function extractInfo(file: H5File): ViewerFileInfo {
  // 셋업·버전 판별은 카탈로그 열기(read.ts)와 같은 코드. 그쪽 경고(Properties 생성일 등)는 이미지 보기와 무관해 싣지 않는다
  const { layout, setup, version, props } = readSetup(file)
  const parsed = parseModelSetup(readModelSetupXml(file, layout))
  return buildViewerInfo({
    setup,
    family: layout,
    version: version.raw,
    lookup: (p) => probe(file, p),
    display: parsed.display,
    groupSetups: parsed.groupSetups,
    currentMxuGroupId: parsed.currentMxuGroupId,
    warnings: parsed.warnings,
    groupExtras: parsed.groupExtras,
    modelFile: parsed.file,
    business: parseBusinessSetup(readBusinessSetupXml(file, layout)),
    props
  })
}

export async function readViewerInfo(path: string): Promise<ViewerFileInfo> {
  return withH5File(path, extractInfo)
}

/**
 * 가져오기 미리보기 경고 (X7): 4.x 비공개 BusinessSetup 의 분석 오프셋(AnalysisScan/IndexOffset)이 0 이 아니면 한 줄.
 * 3.x 는 그 칸이 없어 읽지 않는다(BusinessSetup 이 커서). 읽지 못하면 빈 배열 — 가져오기를 막지 않는다
 */
export async function readImportOffsetWarnings(path: string): Promise<string[]> {
  try {
    return await withH5File(path, (file) => {
      const { layout } = readSetup(file)
      if (layout !== '4.x') return []
      return offsetWarnings(parseBusinessSetup(readBusinessSetupXml(file, layout)).assemblies, 'import')
    })
  } catch {
    return []
  }
}

export type ViewerGroupRef = Pick<ViewerGroup, 'id' | 'amplitudePath' | 'statusPath' | 'shape' | 'supported' | 'storageMode'>

/** 그룹 진폭 조각. scanCount 는 조각 상한(scansPerChunk, 렌더러 chunkRanges 와 같은 계산)과 그룹 끝으로 자른다. */
export async function readViewerChunk(path: string, group: ViewerGroupRef, scanStart: number, scanCount: number): Promise<ViewerVolumeChunk> {
  if (!group.supported || !group.amplitudePath) throw new AppError('NDE_UNSUPPORTED', '이 그룹은 이미지로 볼 수 없습니다.', `group ${group.id}`)
  const [ns, nb, nt] = group.shape
  if (!Number.isInteger(scanStart) || !Number.isInteger(scanCount) || scanStart < 0 || scanStart >= ns || scanCount < 1) {
    throw new AppError('INVALID_ARGUMENT', '스캔 범위가 올바르지 않습니다.', `scanStart=${scanStart} scanCount=${scanCount} ns=${ns}`)
  }
  const s0 = scanStart
  const s1 = Math.min(ns, s0 + Math.min(scanCount, scansPerChunk(group.shape)))
  return withH5File(path, (file) => {
    const amp = dataset(file, group.amplitudePath!)
    if (!amp || (amp.shape ?? []).join() !== group.shape.join()) {
      throw new NdeError('corrupt', `amplitude ${group.amplitudePath} shape ${amp?.shape?.join('x')} != ${group.shape.join('x')}`)
    }
    const a = amp.slice([[s0, s1], [], []])
    if (!(a instanceof Int16Array)) throw new NdeError('corrupt', `amplitude dtype ${Object.prototype.toString.call(a)}`)
    let status: Uint8Array | null = null
    if (group.statusPath) {
      const st = dataset(file, group.statusPath)
      const typeOk = group.storageMode !== 'Paintbrush' || !!st && st.metadata.size === 1 && !st.metadata.signed && (st.metadata.type === 0 || st.metadata.type === 4)
      const v = st && typeOk && (st.shape ?? []).join() === [ns, nb].join() ? st.slice([[s0, s1], []]) : null
      if (v instanceof Uint8Array) status = v
    }
    if (group.storageMode === 'Paintbrush' && (!status || !maskPaintbrushAmplitude(a, status, nt))) {
      throw new NdeError('corrupt', 'Paintbrush amplitude requires a matching 8-bit status grid with known validity bits')
    }
    return { groupId: group.id, scanStart: s0, scanCount: s1 - s0, amplitude: a, status }
  })
}
