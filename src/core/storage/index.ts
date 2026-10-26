/**
 * 저장소 — 파일시스템 작업: 입력 경로 탐색, SHA-256, 검증 복사, 저장 경로 규칙.
 * Electron 비의존 순수 Node. 원본은 절대 수정·이동·삭제하지 않는다(읽기 전용으로만 연다).
 */
export { resolveStoreLayout, ensureStoreRoot, plannedRelPath, toAbsolutePath, toRelPath, type StoreLayout } from './layout'
export { scanInputPaths, isHiddenName, type InputFile, type ScanInputsResult, type ScanOptions } from './scan'
export { recoverStore, relKey, QUARANTINE_DIR, type StoreRecoveryResult } from './recovery'
export { containsSourceData } from './guard'
export { hashFile, type ByteProgressOptions } from './hash'
export { copyVerified, withFsRetry, type CopyOptions, type CopyResult } from './copy'
export { safeDirName, safeFileName, splitExt, withCounter } from './names'
