/**
 * NDE 코어 — Evident .nde(HDF5) 읽기와 셋업 정규화·지문.
 * Electron 비의존 순수 Node. h5wasm 은 'h5wasm/node' 를 동적 import 한다 (ESM 전용 패키지).
 */
import type { NdeReadResult } from '@shared/types'
import { loadH5 } from './h5'
import { normalizeSetup } from './normalize'
import { openNde, type RawNde } from './read'

export { FINGERPRINT_TOLERANCE } from './units'
export { FINGERPRINT_PREFIX, canonicalJson, computeFingerprint, fingerprint, type FingerprintResult } from './fingerprint'
export { NdeError, type NdeErrorReason } from './errors'
export { openNde, parseNdeVersion, normalizeNdeDate, type OpenedNde, type RawNde } from './read'
export { normalizeSetup, summarizeAcquisition } from './normalize'
export { diffSpecs, specDistance, describeDifference, withinTolerance } from './diff'
export { summarizeSpec, suggestPlanName, techniqueText } from './naming'
export {
  suggestSpecimen,
  matchSpecimenId,
  matchStateTag,
  matchRound,
  DEFAULT_SPECIMEN_PATTERNS,
  type SpecimenGuess,
  type SpecimenPattern,
  type StateTag
} from './specimenGuess'

/** h5wasm 준비 (여러 번 불러도 한 번만 초기화) */
export async function initNde(): Promise<void> {
  await loadH5()
}

/** 확장자 기준 판별 (대소문자 무시) */
export function isNdeFileName(fileName: string): boolean {
  return /\.nde$/i.test(fileName.trim())
}

/** 파일 → 메타 + 정규화 셋업. 읽기 실패는 NdeError(AppError: NDE_READ_ERROR/NDE_UNSUPPORTED/NOT_FOUND) */
export async function readNdeFile(path: string): Promise<NdeReadResult> {
  const raw = await openNde(path)
  const setup = normalizeSetup(raw.setup, raw.version)
  return { meta: raw.meta, setup: { ...setup, warnings: [...raw.warnings, ...setup.warnings] } }
}

/** 원시 읽기 결과 (디버그·고급 기능용) */
export async function readRawNde(path: string): Promise<RawNde> {
  const { path: _p, elapsedMs: _e, ...raw } = await openNde(path)
  return raw
}
