/**
 * 라벨 기록 기본값 만들기 (런타임 의존성 없음).
 * UUID·시각은 부르는 쪽이 넣는다(crypto.randomUUID 등) — 이 모듈은 순수 함수만 둔다.
 * 묶음 칸(derived·signal 등)은 넘긴 값만 덮어쓴다(얕은 병합).
 * versions 를 넘기지 않으면 빈 목록이다(아직 어느 PC 에서도 저장 전). 저장할 때 versions.ts bumpVersions 로 올린다.
 * 판독 단계를 넘기지 않으면 'blind' 다.
 */
import { LABEL_COORD_RULES_VERSION, LABEL_EXPORT_FORMAT, LABEL_SCHEMA_VERSION } from './types'
import type {
  FileAlignment,
  IndicationRecord,
  LabelExportFile,
  LabelSetKey,
  ObservationRow,
  PhysicalDefect,
  ReviewInterval,
  WorkEvent
} from './types'

/** 늘 있는 묶음 칸 — 일부만 넘기면 기본값에 덮어쓴다 */
type RecordGroups = 'readerDetail' | 'derived' | 'character' | 'location' | 'length' | 'height' | 'signal' | 'knowledge'

export type NewRecordInit = Partial<Omit<IndicationRecord, RecordGroups>> & {
  [K in RecordGroups]?: Partial<IndicationRecord[K]>
} & Pick<IndicationRecord, 'uuid' | 'sha256' | 'labelerId' | 'guidelineVersion'>

export function newIndicationRecord(init: NewRecordInit): IndicationRecord {
  const anchors = init.anchors ?? []
  const coordSource = init.coordSource ?? (anchors.length > 0 ? 'app-anchor' : 'imported-mm')
  const base: IndicationRecord = {
    uuid: init.uuid,
    sha256: init.sha256,
    secondaryFingerprint: null,
    labelerId: init.labelerId,
    guidelineVersion: init.guidelineVersion,
    readingStage: 'blind',
    revision: 1,
    versions: [],
    deleted: false,
    pcId: null,
    createdAt: null,
    updatedAt: null,
    readerSource: 'expert',
    readerDetail: { organization: null, qualification: null, modelVersion: null },
    externalRef: null,
    kind: 'defect',
    coordSource,
    anchors,
    derived: {
      scanStartMm: 0,
      scanEndMm: 0,
      vMinMm: null,
      vMaxMm: null,
      depthTopMm: null,
      depthBottomMm: null,
      coordRulesVersion: coordSource === 'app-anchor' ? LABEL_COORD_RULES_VERSION : null
    },
    recheckNeeded: false,
    existenceConfidence: 'certain',
    defectType: null,
    isoCode: null,
    typeConfidence: null,
    character: { value: null, alignedVolumetric: false, expertConfirmed: false },
    surface: null,
    pointLike: null,
    location: { zone: null, side: null, noBevelOverlay: false },
    length: { valueMm: null, method: null, uncorrectedMm: null, groupId: null, beam: null, angleDeg: null, thresholdPct: null },
    height: { method: null, valueMm: null, pointIds: [] },
    signal: {
      maxAmplitudePct: null,
      refDb: null,
      refDbVerified: false,
      saturated: null,
      exceedsEvaluationLevel: null,
      exceedsRecordingLevel: null,
      peak: null
    },
    suggestions: [],
    knowledge: { designValueSeen: null, specimenKnown: null, aiDevParticipant: null },
    physicalDefectId: null,
    groupingId: null,
    viewSnapshot: null,
    geometricEcho: null,
    geometricImperfection: null,
    note: ''
  }
  const { readerDetail, derived, character, location, length, height, signal, knowledge, ...rest } = init
  return {
    ...base,
    ...rest,
    coordSource,
    anchors,
    readerDetail: { ...base.readerDetail, ...readerDetail },
    derived: { ...base.derived, ...derived },
    character: { ...base.character, ...character },
    location: { ...base.location, ...location },
    length: { ...base.length, ...length },
    height: { ...base.height, ...height },
    signal: { ...base.signal, ...signal },
    knowledge: { ...base.knowledge, ...knowledge }
  }
}

export function newPhysicalDefect(
  init: Partial<Omit<PhysicalDefect, 'design'>> & { design?: Partial<PhysicalDefect['design']> } & Pick<PhysicalDefect, 'id' | 'specimenId'>
): PhysicalDefect {
  const base: PhysicalDefect = {
    id: init.id,
    specimenId: init.specimenId,
    weldId: null,
    design: {
      type: null,
      zone: null,
      side: null,
      startMm: null,
      endMm: null,
      centerMm: null,
      depthMm: null,
      lengthMm: null,
      heightMm: null,
      tiltDeg: null
    },
    source: 'none',
    confirmation: 'unknown',
    dataOrigin: 'measured',
    parentId: null,
    generatorTool: null,
    generatorVersion: null,
    revision: 1,
    versions: [],
    deleted: false,
    pcId: null,
    updatedAt: null,
    note: ''
  }
  const { design, ...rest } = init
  return { ...base, ...rest, design: { ...base.design, ...design } }
}

export function newFileAlignment(init: Partial<FileAlignment> & { sha256: string; fileName: string }): FileAlignment {
  return {
    specimenId: null,
    weldId: null,
    datumKind: null,
    datumDescription: null,
    datumUMm: null,
    direction: null,
    skew90Side: null,
    alignmentAssumed: false,
    thicknessMm: null,
    outerDiameterMm: null,
    overlapStartMm: null,
    overlapEndMm: null,
    probeClSkew90Mm: null,
    probeClSkew270Mm: null,
    trackDeviationMaxMm: null,
    evidence: null,
    enteredBy: null,
    revision: 1,
    versions: [],
    deleted: false,
    pcId: null,
    updatedAt: null,
    note: '',
    ...init
  }
}

export function newObservationRow(
  init: Partial<ObservationRow> & { recordUuid: string; groupId: number; leg: number }
): ObservationRow {
  return {
    projected: null,
    search: null,
    saturated: null,
    status: 'visible',
    expertConfirmed: false,
    coordRulesVersion: LABEL_COORD_RULES_VERSION,
    revision: 1,
    versions: [],
    deleted: false,
    pcId: null,
    ...init
  }
}

export function newReviewInterval(
  init: Partial<ReviewInterval> &
    Pick<ReviewInterval, 'uuid' | 'sha256' | 'labelerId' | 'guidelineVersion' | 'kind' | 'scanStartMm' | 'scanEndMm'>
): ReviewInterval {
  return {
    readingStage: 'blind',
    revision: 1,
    versions: [],
    deleted: false,
    released: false,
    pcId: null,
    createdAt: null,
    updatedAt: null,
    groupId: null,
    gate: null,
    reason: null,
    note: '',
    ...init
  }
}

export function newWorkEvent(
  init: Partial<WorkEvent> & Pick<WorkEvent, 'uuid' | 'sessionId' | 'labelerId' | 'kind' | 'at'>
): WorkEvent {
  return { readingStage: null, pcId: null, sha256: null, tool: 'app', detail: null, ...init }
}

export function newLabelExport(
  header: { appVersion: string; exportedAt: string; pcId: string },
  parts: Partial<Omit<LabelExportFile, 'format' | 'schemaVersion' | 'rulesVersion' | 'appVersion' | 'exportedAt' | 'pcId'>> = {}
): LabelExportFile {
  return {
    format: LABEL_EXPORT_FORMAT,
    schemaVersion: LABEL_SCHEMA_VERSION,
    rulesVersion: LABEL_COORD_RULES_VERSION,
    appVersion: header.appVersion,
    exportedAt: header.exportedAt,
    pcId: header.pcId,
    labelers: [],
    physicalDefects: [],
    fileAlignments: [],
    records: [],
    observations: [],
    reviewIntervals: [],
    workEvents: [],
    ...parts
  }
}

/** 라벨 세트를 글자 하나로 ('sha256|labelerId|guidelineVersion|readingStage') — Map 키 등 */
export function labelSetId(x: LabelSetKey): string {
  return `${x.sha256}|${x.labelerId}|${x.guidelineVersion}|${x.readingStage}`
}

/** 같은 라벨 세트인지 */
export function sameLabelSet(a: LabelSetKey, b: LabelSetKey): boolean {
  return (
    a.sha256 === b.sha256 && a.labelerId === b.labelerId && a.guidelineVersion === b.guidelineVersion && a.readingStage === b.readingStage
  )
}
