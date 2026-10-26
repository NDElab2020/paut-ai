/**
 * core/labels/export — 학습 데이터 일괄 내보내기·분할 (2b). 설명: README.md (같은 폴더).
 *   exportTraining.ts  파일마다 진폭 읽기 → runDerive → meta·labels·scenes·ascan JSON, .npy, PNG·COCO·YOLO, manifest
 *   images.ts          펼친 S-scan 그림(고정 mm/px·내장 색표·0 dB)·가림·상자 → 화소
 *   ascan.ts           A-scan 하나하나의 세 상태 (ascanLabelAt 규칙)
 *   selectSets.ts      파일마다 라벨 세트 고르기 (확정 > 대조 > 지정 라벨러 블라인드)
 *   split.ts           시편 단위 train·val·test, 시험 세트 잠금 (catalog.db label_meta 한 칸)
 *   setLocks.ts        라벨 세트 제출(잠금)·블라인드 → 설계값 대조 복사 기록 (label_meta 'set-locks')
 *   encode.ts          키 정렬 JSON · PNG · .npy 머리 (node:zlib 만)
 */
export {
  TRAINING_EXPORT_FORMAT,
  TRAINING_EXPORT_VERSION,
  cleanTrainingOptions,
  runTrainingExport,
  type TrainingExportJob,
  type TrainingReader,
  type TrainingSourceFile
} from './exportTraining'
export {
  TRAIN_CLASSES,
  TRAIN_IMAGE_RULES_VERSION,
  IMAGE_PALETTE_NAME,
  MASK_RGB,
  MASK_VALUE,
  MIN_BOX_PX,
  OUTSIDE_RGB,
  blackout,
  boxPixels,
  decideSceneImage,
  imageViewport,
  objectBoxPixels,
  windowBoxPixels,
  type ImageViewport,
  type MaskMode,
  type SceneImage
} from './images'
export { ASCAN_STATE_CODE, ascanLabels, ascanTrainState, type AscanLabels } from './ascan'
export { STAGE_NAME, cleanSetRule, pickLabelSet, type SetCandidate, type SetPick } from './selectSets'
export {
  SPLIT_META_KEY,
  applySplitChanges,
  applyTestLock,
  emptySplitState,
  parseSplitState,
  readLabelMeta,
  readSplitState,
  splitKey,
  splitOf,
  writeLabelMeta,
  writeSplitState,
  type SplitContext,
  type SplitState
} from './split'
export { encodePngGray, encodePngRgb, npyHeader, stableJson, PNG_DEFLATE_LEVEL } from './encode'
export {
  SET_LOCK_META_KEY,
  emptySetLockState,
  parseSetLockState,
  readSetLockState,
  setCopiedFrom,
  setSubmittedAt,
  writeSetLockState,
  type SetCopyEntry,
  type SetLockEntry,
  type SetLockState
} from './setLocks'
