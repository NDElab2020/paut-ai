/**
 * core/labels — 결함 라벨 저장 규칙·JSON 내보내기·가져오기 병합·그룹 짓기 호출 (Electron 비의존 순수 Node).
 * 저장소 자체는 catalog.labels (core/catalog/labels.ts, 스키마 v2). 기록 형식은 shared/labels.
 *   store.ts         기록 저장·삭제 + 검토 완료 구간 자동 풀기, 그룹 짓기 다시 계산, 두께 찾기, 새 UUID
 *   exportLabels.ts  범위(전체 · 파일 · 라벨 세트) → LabelExportFile
 *   importLabels.ts  LabelExportFile → 병합 보고서(새로·갱신·그대로·충돌·오류·경고), 충돌 해결
 */
export {
  deleteLabelRecord,
  newLabelUuid,
  recomputeGrouping,
  saveLabelRecord,
  thicknessForFile,
  type RecordSaveOptions,
  type RecordSaveOutcome,
  type RegroupOutcome
} from './store'
export { exportLabels, exportLabelsJson, type LabelExportOptions, type LabelExportScope } from './exportLabels'
export {
  importLabels,
  resolveLabelConflict,
  type ConflictResolveOptions,
  type ConflictResolveOutcome,
  type LabelConflictChoice,
  type LabelImportCounts,
  type LabelImportEntity,
  type LabelImportOptions,
  type LabelImportReport
} from './importLabels'
