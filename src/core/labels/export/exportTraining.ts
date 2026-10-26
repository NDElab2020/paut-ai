/**
 * 학습 데이터 일괄 내보내기 (2b, 규격_초안.md 3.5절). main 프로세스(또는 테스트)에서 돈다. Electron 비의존.
 *
 * 파일마다: 저장된 사본에서 그룹 진폭을 조각으로 읽고(readViewerChunk) → amplitudeFromChunks → runDerive(고른 라벨 세트 하나)
 *   → files/<sha256 앞 16자>/ 에 meta.json · labels.json · scenes.json · ascan.json (+ amplitude_g<id>.npy · status_g<id>.npy)
 *   (+ images/g<id>/s<스캔>.png(가리지 않은 원본) · masks/g<id>/s<스캔>.png(가림 값 0·1·2) · labels/g<id>/s<스캔>.txt(YOLO) · coco.json,
 *    maskMode 'blackout' 이면 train 분할만 masked/images·masked/labels — 검게 칠한 판과 같은 YOLO 글자).
 * 맨 위: manifest.json, checksums.sha256(manifest 를 뺀 모든 파일), 그림을 내면 data.yaml · yolo_<분할>.txt · coco_<분할>.json.
 *   YOLO 목록에는 검토한 장면만 넣는다(검토 안 한 양성 장면은 COCO 에만 reviewed = false).
 * 경고: 검토 구간 안에 승인하지 않은 형상 에코 후보(분류 1 이 그 자리에서 배경이 됨), derive 의 경고급 확인 사항, test 분할의 확정 아닌 세트.
 * manifest: 분할 전체 표와 그 해시, 데이터셋 ID(= checksums.sha256 의 SHA-256), 그림 규칙 버전·팔레트 해시 (재현·감사).
 *
 * 막기: 대조 전 그룹·U 격자 오프셋 ≠ 0 그룹·그릴 수 없는 그룹·두께를 모르는 파일 등은 derive 가 막고(groups[].blocked),
 *   그 그룹은 내보내지 않고 manifest blockedGroups 에 이유를 적는다. 모든 그룹이 막히면 그 파일은 건너뛴다(skipped).
 *   막힐 그룹(그릴 수 없음·대조 전·U 오프셋·형식이 붙인 blockReason)은 진폭을 읽지 않는다(크기만 맞춘 빈 진폭).
 *   OPD(구조를 따라 읽은 형식)는 그룹의 blockReason(대조 전·진폭 눈금 추정·형상 모름·자체 점검·두께 불일치 등)을 derive 에 넘기고,
 *   막힌 이유 뒤에 붙여 적는다(derive 이유가 '대조 전'이면 형식 이유의 '대조 전' 항목은 빼고). 파일 정렬에 실측 두께가 있으면 '두께 칸 의심'은 뺀다.
 *   meta.json nde 칸·manifest files[] 에 OPD 만 읽기 규칙(reader)·스캔축 동기('unknown')·진폭 눈금(추정)을 더한다(NDE 는 바이트 그대로).
 * 결정성: 파일은 (이름, sha256) 순서, 그룹은 번호, 장면은 스캔 순. JSON 은 키 정렬(stableJson), PNG 는 필터·deflate 수준 고정.
 *   같은 입력·같은 규칙 버전 → 같은 바이트. 시각은 manifest.exportedAt 한 칸뿐이다(fixedExportedAt 으로 고정 가능).
 * 쓰기: '<폴더>.partial' 에 쓰고 끝나면 이름을 바꾼다. 취소(CANCELLED)·실패면 방금 만든 .partial 폴더만 지운다.
 */
import { createHash } from 'node:crypto'
import { hashFile } from '@core/storage'
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  TrainSplit,
  TrainSplitOrNone,
  TrainingExportFileResult,
  TrainingExportOptions,
  TrainingExportProgress,
  TrainingExportResult,
  TrainingSetRule
} from '@shared/api'
import { AppError } from '@shared/errors'
import { chunkRanges } from '@shared/imaging/volume'
import {
  composeBlockReason,
  type ViewerFileInfo,
  type ViewerGate,
  type ViewerGroup,
  type ViewerSpecimen,
  type ViewerVolumeChunk
} from '@shared/imaging/types'
import {
  DERIVED_LABELS_FORMAT,
  LABEL_DERIVE_RULES_VERSION,
  amplitudeFromChunks,
  amplitudeFromFunction,
  resolveDeriveRules,
  runDerive,
  suggestGeometricEchoes,
  type DeriveGroupInput,
  type DeriveRun,
  type SceneState
} from '@shared/labels/derive'
import { LABEL_COORD_RULES_VERSION, LABEL_EXPORT_FORMAT, LABEL_SCHEMA_VERSION } from '@shared/labels/types'
import type {
  FileAlignment,
  IndicationRecord,
  LabelSetKey,
  LabelerInfo,
  ObservationRow,
  PhysicalDefect,
  ReviewInterval
} from '@shared/labels/types'
import { ascanLabels, ASCAN_STATE_CODE } from './ascan'
import { encodePngAsync, int16LeBytes, npyHeader, stableJson } from './encode'
import {
  IMAGE_PALETTE_NAME,
  TRAIN_CLASSES,
  TRAIN_IMAGE_RULES_VERSION,
  blackout,
  classOf,
  decideSceneImage,
  groupImageKit,
  objectBoxPixels,
  renderSceneImage,
  viewportMeta,
  windowBoxPixels,
  yoloLine
} from './images'
import { DEFAULT_AMPLITUDE_PALETTE } from '@shared/imaging/palette'

export const TRAINING_EXPORT_FORMAT = 'paut-train-export'
/** 2 = 원본 그림 + masks/ + train 만 masked/, ascan.json trainStates, manifest 분할 표·데이터셋 ID·그림 규칙 버전 */
export const TRAINING_EXPORT_VERSION = 2

/** 내보낼 파일 하나 (서비스가 카탈로그·라벨 저장소에서 모은 값) */
export interface TrainingSourceFile {
  sha256: string
  fileName: string
  specimenId: string | null
  weldId: string | null
  split: TrainSplit | null
  /** 저장된 사본 경로 (읽기만). null = 이 PC 에 사본 없음 → 건너뜀 */
  path: string | null
  /** 세트 고르기 결과 */
  selection: { candidates: string[]; chosen: string | null; reason: string }
  /** 고른 세트 (null → 건너뜀) */
  labelSet: LabelSetKey | null
  labeler: LabelerInfo | null
  /** 고른 세트의 기록·검토 구간(지움 표시 제외)·그 기록의 관측 행 */
  records: IndicationRecord[]
  reviewIntervals: ReviewInterval[]
  observations: ObservationRow[]
  alignment: FileAlignment | null
  physicalDefects: PhysicalDefect[]
  /** 이 세트에 걸린 풀지 않은 충돌 수 (경고) */
  pendingConflicts: number
}

export interface TrainingReader {
  info(path: string): Promise<ViewerFileInfo>
  chunk(path: string, group: ViewerGroup, scanStart: number, scanCount: number): Promise<ViewerVolumeChunk>
}

export interface TrainingExportJob {
  operationId: string
  /** 만들 폴더 (없어야 한다). '<이 경로>.partial' 에 쓰고 끝나면 이름을 바꾼다 */
  outDir: string
  files: TrainingSourceFile[]
  options: TrainingExportOptions
  setRule: TrainingSetRule
  /** 2인 독립 모드의 지금 라벨러 (그 사람 세트만 골랐음) */
  blindModeLabelerId: string | null
  split: {
    unit: 'specimen'
    testLocked: boolean
    testLockedAt: string | null
    /** 시편 → 분할 전체 표 (내보내기끼리 분할이 바뀌었는지 견주게 manifest 에 남긴다) */
    assignments?: Record<string, TrainSplit>
    /** 분할을 마지막으로 바꾼 시각 */
    lastChangedAt?: string | null
  }
  /** 사본을 읽기 전에 SHA-256 을 다시 확인한다 (다르면 그 파일을 건너뜀). 서비스는 켠다 */
  verifyCopies?: boolean
  appVersion: string
  pcId: string
  exportedAt: string
  reader: TrainingReader
  signal?: AbortSignal
  onProgress?: (p: TrainingExportProgress) => void
}

type Counts = Record<SceneState, number>
const zero = (): Counts => ({ positive: 0, weak: 0, ignore: 0, negative: 0, unknown: 0 })

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function cancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AppError('CANCELLED', '작업이 취소되었습니다.')
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

/**
 * 그림 단계에서 압축을 겹칠 장면 수. 장면을 그리는 동안 앞 장면 PNG 들을 libuv 스레드풀에서 deflate 한다
 * (같은 바이트 — encodePngAsync). 메모리는 장면당 필터 건 원자료 약 2 MB × 이 값.
 */
const PNG_PIPELINE = 4

/** 압축이 끝나기를 기다리는 장면 하나 (쓰기는 장면 순서대로) */
interface PendingScene {
  /** [그림, 가림 그림 | null, 검게 칠한 판 | null] */
  pngs: Promise<[Buffer, Buffer | null, Buffer | null]>
  imagePath: string
  maskPath: string | null
  maskedPath: string | null
  labelPath: string
  maskedLabelPath: string | null
  txt: string
  lines: number
}

/** 옵션 검사·정리 (모르는 값은 기본값) */
export function cleanTrainingOptions(o: unknown): TrainingExportOptions {
  const x = (o ?? {}) as Partial<TrainingExportOptions>
  const mm = typeof x.mmPerPx === 'number' && Number.isFinite(x.mmPerPx) ? x.mmPerPx : 0.1
  if (!(mm >= 0.02 && mm <= 2)) throw new AppError('INVALID_ARGUMENT', '그림 화소 크기는 0.02 ~ 2 mm 사이로 적습니다.')
  return {
    amplitude: x.amplitude !== false,
    images: x.images !== false,
    mmPerPx: Math.round(mm * 1e6) / 1e6,
    maskMode: x.maskMode === 'exclude' ? 'exclude' : x.maskMode === 'separate' ? 'separate' : 'blackout',
    weakAs: x.weakAs === 'positive' ? 'positive' : 'ignore',
    unconfirmedObservation: x.unconfirmedObservation === 'ignore' ? 'ignore' : 'keep',
    ...(typeof x.fixedExportedAt === 'string' && x.fixedExportedAt ? { fixedExportedAt: x.fixedExportedAt } : {})
  }
}

/** 출력 파일 쓰기 (상대 경로, 해시 기록) */
class OutWriter {
  readonly sums: Array<{ path: string; sha256: string; bytes: number }> = []
  private readonly dirs = new Set<string>()
  bytes = 0

  constructor(readonly root: string) {}

  private async ensureDir(rel: string): Promise<void> {
    const d = dirname(rel)
    if (d === '.' || this.dirs.has(d)) return
    await mkdir(join(this.root, d), { recursive: true })
    this.dirs.add(d)
  }

  async put(rel: string, data: string | Buffer, checksum = true): Promise<void> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    await this.ensureDir(rel)
    await writeFile(join(this.root, rel), buf)
    this.bytes += buf.length
    if (checksum) this.sums.push({ path: rel, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length })
  }

  /** 큰 파일: 머리 + 조각들을 차례로 */
  async putParts(rel: string, parts: readonly Buffer[]): Promise<void> {
    await this.ensureDir(rel)
    const h = createHash('sha256')
    const fh = await open(join(this.root, rel), 'w')
    let n = 0
    try {
      for (const p of parts) {
        await fh.write(p)
        h.update(p)
        n += p.length
      }
    } finally {
      await fh.close()
    }
    this.bytes += n
    this.sums.push({ path: rel, sha256: h.digest('hex'), bytes: n })
  }
}

interface CocoImage {
  id: number
  file_name: string
  width: number
  height: number
  sha256: string
  group_id: number
  scan_index: number
  scan_mm: number
  split: TrainSplitOrNone
  scene_state: SceneState
  train_state: SceneState
  reviewed: boolean
  /** 가린 화소 수 (가림 그림 값 ≠ 0) · 그중 라벨 가림 */
  masked_px: number
  label_masked_px: number
  /** 가림 그림 (값 0 = 그대로, 1 = 검토 게이트 밖, 2 = 라벨 가림). 가린 화소가 없으면 null */
  mask_file_name: string | null
  /** 검게 칠한 판 (maskMode blackout · train 분할만). 없으면 null */
  masked_file_name: string | null
}

interface CocoAnnotation {
  id: number
  image_id: number
  category_id: number
  bbox: [number, number, number, number]
  area: number
  /** 1 = 무시 영역 (평가에서 이 자리의 검출은 세지 않음) */
  iscrowd: 0 | 1
  attributes: Record<string, unknown>
}

const COCO_CATEGORIES = TRAIN_CLASSES.map((c) => ({ id: c.id + 1, name: c.name, supercategory: 'paut' }))

function cocoDoc(images: CocoImage[], annotations: CocoAnnotation[]): Record<string, unknown> {
  return {
    info: {
      description: 'PAUT 학습 데이터 — 펼친 S-scan 장면 상자 (앱이 mm 기록에서 계산, 사람이 그린 상자 아님)',
      version: `${TRAINING_EXPORT_FORMAT} ${TRAINING_EXPORT_VERSION}`
    },
    images,
    annotations,
    categories: COCO_CATEGORIES
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function splitName(s: TrainSplit | null): TrainSplitOrNone {
  return s ?? 'unassigned'
}

/** 고른 세트의 저장 단위 사본 (정렬) — labels.json */
function labelsDoc(f: TrainingSourceFile): Record<string, unknown> {
  return {
    format: 'paut-train-labels',
    version: TRAINING_EXPORT_VERSION,
    labelFormat: LABEL_EXPORT_FORMAT,
    schemaVersion: LABEL_SCHEMA_VERSION,
    coordRulesVersion: LABEL_COORD_RULES_VERSION,
    sha256: f.sha256,
    labelSet: f.labelSet,
    labeler: f.labeler,
    pendingConflicts: f.pendingConflicts,
    records: [...f.records].sort((a, b) => cmpStr(a.uuid, b.uuid)),
    reviewIntervals: [...f.reviewIntervals].sort((a, b) => cmpStr(a.uuid, b.uuid)),
    observations: [...f.observations].sort((a, b) => cmpStr(a.recordUuid, b.recordUuid) || a.groupId - b.groupId || a.leg - b.leg),
    fileAlignment: f.alignment,
    physicalDefects: [...f.physicalDefects].sort((a, b) => cmpStr(a.specimenId, b.specimenId) || cmpStr(a.id, b.id))
  }
}

/**
 * 형식 쪽 메타 (OPD 처럼 구조를 따라 읽은 형식만): 읽기 규칙 이름·버전, 스캔축 동기, 진폭 눈금(추정 여부 포함).
 * NDE 는 빈 객체 — meta.json·manifest 바이트가 바뀌지 않게
 */
function formatExtras(info: ViewerFileInfo): Record<string, unknown> {
  if (!info.reader && !info.scanSync) return {}
  const scales = info.groups.map((g) => g.ampScale)
  return {
    ...(info.reader ? { reader: info.reader } : {}),
    ...(info.scanSync ? { scanSync: info.scanSync } : {}),
    ampScale: scales[0] ?? null
  }
}

/**
 * 파일 정렬에 실측 두께가 있으면 형식 이유 중 '두께 칸 의심'(thickness)을 뺀다 — 내보내기는 정렬 두께를 쓰므로.
 * 형식 이유 항목(blockReasons)이 없는 그룹(NDE)은 그대로 둔다(같은 객체).
 */
export function withAlignmentThickness(info: ViewerFileInfo, alignmentThicknessMm: number | null | undefined): ViewerFileInfo {
  if (!(typeof alignmentThicknessMm === 'number' && alignmentThicknessMm > 0)) return info
  if (!info.groups.some((g) => g.blockReasons?.some((r) => r.code === 'thickness'))) return info
  return {
    ...info,
    groups: info.groups.map((g) => {
      if (!g.blockReasons?.some((r) => r.code === 'thickness')) return g
      const blockReasons = g.blockReasons.filter((r) => r.code !== 'thickness')
      return { ...g, blockReasons, blockReason: composeBlockReason(blockReasons) }
    })
  }
}

/**
 * derive 가 막은 이유 + 형식이 붙인 이유 (같거나 없으면 derive 이유 그대로).
 * derive 이유가 이미 '대조 전'이면 형식 이유에서 '대조 전' 항목을 빼고 붙인다(같은 말이 두 번 나오지 않게)
 */
function blockedText(derived: string | null, group: ViewerGroup | undefined): string | null {
  let extra = group?.blockReason ?? null
  if (derived && group?.blockReasons && derived.includes('대조 전')) {
    extra = composeBlockReason(group.blockReasons.filter((r) => r.code !== 'unverified-kind'))
  }
  if (!derived || !extra || derived === extra || derived.includes(extra)) return derived
  return `${derived} ${extra}`
}

/**
 * meta.json 의 게이트 — 형식 2 가 처음부터 담던 칸만 골라 담는다.
 * OmniPC 조사(2026-10-07)로 ViewerGate 에 더한 선택 칸(L5 enabled·detection·event)은 넣지 않는다:
 * 같은 입력·같은 규칙 버전이면 같은 바이트여야 하므로(NDE 바이트 그대로). 새 칸을 내보내려면 TRAINING_EXPORT_VERSION 을 올린다.
 */
export function gateMeta(g: ViewerGate): Record<string, unknown> {
  return {
    id: g.id,
    name: g.name,
    geometry: g.geometry,
    sync: g.sync,
    startUs: g.startUs,
    lengthUs: g.lengthUs,
    thresholdPct: g.thresholdPct,
    supported: g.supported,
    producesCscan: g.producesCscan
  }
}

/** meta.json 의 시편 — 개선 형상에서 L7 덮개 종류(weld.template)는 뺀다(gateMeta 와 같은 이유) */
export function specimenMeta(s: ViewerSpecimen): Record<string, unknown> {
  if (!s.weld) return { shape: s.shape, thicknessMm: s.thicknessMm, weld: null }
  const w = s.weld
  return {
    shape: s.shape,
    thicknessMm: s.thicknessMm,
    weld: {
      bevelShape: w.bevelShape,
      symmetry: w.symmetry,
      offsetMm: w.offsetMm,
      landHeightMm: w.landHeightMm,
      hotPass: w.hotPass,
      fills: w.fills,
      root: w.root,
      upperCap: w.upperCap,
      lowerCap: w.lowerCap,
      hazWidthMm: w.hazWidthMm,
      weldAngleDeg: w.weldAngleDeg
    }
  }
}

/** meta.json (축·빔·게이트·두께·정렬·mm 메타) */
function metaDoc(
  f: TrainingSourceFile,
  info: ViewerFileInfo,
  run: DeriveRun,
  thickness: { mm: number | null; source: 'alignment' | 'setup' | null },
  outputs: Map<number, { amplitude: string | null; status: string | null; image: Record<string, unknown> | null }>
): Record<string, unknown> {
  return {
    format: 'paut-train-file-meta',
    version: TRAINING_EXPORT_VERSION,
    sha256: f.sha256,
    fileName: f.fileName,
    specimenId: f.specimenId,
    weldId: f.weldId,
    split: splitName(f.split),
    nde: { formatFamily: info.formatFamily, version: info.version, ...formatExtras(info) },
    thicknessMm: thickness.mm,
    thicknessSource: thickness.source,
    outerDiameterMm: f.alignment?.outerDiameterMm ?? null,
    specimen: specimenMeta(info.specimen),
    alignment: f.alignment,
    labelSet: f.labelSet,
    units: {
      U: '스캔축 mm = scan.offsetMm + 칸 번호 × scan.resolutionMm',
      V: '용접 중심선(CL) 0 인 가로 위치 mm',
      depth: '펼친 깊이 mm (표면 0, 스킵을 펴서 이어짐). 레그 L = floor(깊이 / 두께) + 1',
      time: '빔마다 자기 출사점 기준 왕복 시간 µs = t0Us + 샘플 × ultrasound.resolutionUs',
      amplitude: '%FSH = raw / ampScale.rawMax × ampScale.unitMax (파일 이득 그대로 = 소프트 이득 0 dB)',
      status: 'status_g<id>.npy 는 파일 상태 비트 그대로: status & 1 = 데이터 있음 (나머지 비트는 파일 원값 — 1 과 같다고 비교하지 않음)'
    },
    groups: info.groups
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((g) => {
        const d = run.result.groups.find((x) => x.groupId === g.id)
        const pg = run.ctx.groups.find((x) => x.id === g.id)
        const o = outputs.get(g.id)
        return {
          id: g.id,
          name: g.name,
          technique: g.technique,
          supported: g.supported,
          verified: g.verified,
          blocked: d ? d.blocked : '변환하지 않았습니다.',
          shape: g.shape,
          ampScale: g.ampScale,
          scan: g.scan,
          ultrasound: g.ultrasound,
          beams: g.beams,
          gates: g.gates.map(gateMeta),
          cscanGateId: g.cscanGateId,
          gainDb: g.gainDb,
          referenceGainDb: g.referenceGainDb,
          referenceAmplitudePct: g.referenceAmplitudePct,
          levels: d?.levels ?? null,
          legs: pg?.geom?.legs ?? [],
          amplitudeFile: o?.amplitude ?? null,
          statusFile: o?.status ?? null,
          amplitudeLayout: o?.amplitude ? { dtype: '<i2', order: 'C', axes: ['scan', 'beam', 'sample'], shape: g.shape } : null,
          image: o?.image ?? null,
          // OPD 등 형식 쪽 값 (NDE 는 없음 → 칸을 만들지 않는다)
          ...(g.selfCheck ? { selfCheck: g.selfCheck } : {}),
          ...(g.blockReason !== undefined ? { formatBlockReason: g.blockReason } : {}),
          ...(g.blockReasons !== undefined ? { formatBlockReasons: g.blockReasons } : {})
        }
      })
  }
}

function progressOf(job: TrainingExportJob, phase: TrainingExportProgress['phase'], current: number, fileName: string | null, imagesDone = 0, imagesTotal = 0): TrainingExportProgress {
  return { operationId: job.operationId, phase, current, total: job.files.length, fileName, imagesDone, imagesTotal, cancelling: false }
}

/** 학습 데이터 내보내기. 취소면 AppError('CANCELLED') */
export async function runTrainingExport(job: TrainingExportJob): Promise<TrainingExportResult> {
  const opts = job.options
  const report = (p: TrainingExportProgress): void => job.onProgress?.(p)
  report(progressOf(job, 'prepare', 0, null))
  if (await stat(job.outDir).then(() => true, () => false)) throw new AppError('CONFLICT', `같은 이름의 폴더가 이미 있습니다: ${job.outDir}`)
  const tmp = `${job.outDir}.partial`
  try {
    await mkdir(tmp)
  } catch (e) {
    throw new AppError('IO_ERROR', `학습 데이터 폴더를 만들지 못했습니다: ${tmp}`, e instanceof Error ? e.message : String(e))
  }
  const out = new OutWriter(tmp)
  const rules = resolveDeriveRules({ weakAs: opts.weakAs, unconfirmedObservation: opts.unconfirmedObservation })
  const files = [...job.files].sort((a, b) => cmpStr(a.fileName, b.fileName) || cmpStr(a.sha256, b.sha256))
  const results: TrainingExportFileResult[] = []
  const blockedGroups: Array<{ sha256: string; fileName: string; groupId: number; name: string; reason: string }> = []
  const warnings: string[] = []
  /** 형식 쪽 메타 (OPD 만 — manifest files[].format) */
  const formatOf = new Map<string, Record<string, unknown>>()
  const yolo = new Map<TrainSplitOrNone, string[]>()
  const coco = new Map<TrainSplitOrNone, { images: CocoImage[]; annotations: CocoAnnotation[] }>()

  try {
    for (const [fi, f] of files.entries()) {
      cancelled(job.signal)
      report(progressOf(job, 'read', fi, f.fileName))
      const fr: TrainingExportFileResult = {
        sha256: f.sha256,
        fileName: f.fileName,
        specimenId: f.specimenId,
        split: f.split,
        folder: null,
        setId: f.selection.chosen,
        status: 'skipped',
        reason: null,
        groups: [],
        scenes: 0,
        trainScenes: zero(),
        boxes: 0,
        ascanSpans: 0,
        images: 0,
        annotations: 0,
        issues: 0
      }
      results.push(fr)
      if (!f.labelSet) {
        fr.reason = f.selection.reason
        continue
      }
      if (!f.path) {
        fr.reason = '이 PC 저장소에 사본이 없습니다.'
        continue
      }
      if (f.pendingConflicts > 0) warnings.push(`'${f.fileName}': 고른 세트에 풀지 않은 충돌이 ${f.pendingConflicts}건 있습니다(지금 값으로 내보냄).`)
      if (f.split === 'test' && f.labelSet.readingStage !== 'final') {
        warnings.push(`'${f.fileName}': 시험(test) 분할인데 확정 세트가 아닌 ${f.labelSet.readingStage} 세트로 내보냈습니다 — AI 평가 정답은 확정 세트여야 합니다(평가 정의 1·2절).`)
      }

      // 0) 사본이 그 파일인지 (저장 뒤 사본이 바뀌었으면 manifest 의 sha256 이 거짓이 된다)
      if (job.verifyCopies) {
        cancelled(job.signal)
        const got = await hashFile(f.path, job.signal ? { signal: job.signal } : {}).catch((e: unknown) => (e instanceof AppError && e.code === 'CANCELLED' ? Promise.reject(e) : null))
        if (got !== f.sha256) {
          fr.reason = got === null ? '사본을 읽지 못했습니다(해시).' : `사본의 SHA-256 이 기록과 다릅니다(${got.slice(0, 12)}… ≠ ${f.sha256.slice(0, 12)}…). 사본이 바뀌었습니다.`
          continue
        }
      }

      // 1) 진폭 읽기 (막힐 그룹은 읽지 않음). 사본을 읽지 못하면 그 파일만 건너뛴다
      const path = f.path
      let info: ViewerFileInfo
      const chunks: ViewerVolumeChunk[] = []
      const inputs: DeriveGroupInput[] = []
      try {
        // 파일 정렬 두께가 있으면 형식 이유의 '두께 칸 의심'은 빼고 판정한다 (아래 thickness 도 정렬 두께를 먼저 씀)
        info = withAlignmentThickness(await job.reader.info(path), f.alignment?.thicknessMm)
        for (const g of [...info.groups].sort((a, b) => a.id - b.id)) {
          cancelled(job.signal)
          // 형식이 붙인 이유(OPD 대조 전·자체 점검 실패 등)도 derive 에 넘긴다 (NDE 는 없음 → 지금과 같음)
          const blockReason = g.blockReason ?? null
          const willBlock = !g.supported || !g.amplitudePath || !g.verified || g.scan.offsetMm !== 0 || blockReason !== null
          if (willBlock) {
            inputs.push({ group: g, amplitude: amplitudeFromFunction(g.shape, () => 0, g.ampScale.unitMax, () => false), ...(blockReason ? { blockReason } : {}) })
            continue
          }
          const mine: ViewerVolumeChunk[] = []
          for (const [s, n] of chunkRanges(g.shape)) {
            cancelled(job.signal)
            mine.push(await job.reader.chunk(path, g, s, n))
            await tick()
          }
          chunks.push(...mine)
          inputs.push({ group: g, amplitude: amplitudeFromChunks(g, mine), ...(blockReason ? { blockReason } : {}) })
        }
      } catch (e) {
        if (e instanceof AppError && e.code === 'CANCELLED') throw e
        fr.reason = `사본을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
        continue
      }
      const groups = [...info.groups].sort((a, b) => a.id - b.id)

      // 2) 계산
      cancelled(job.signal)
      report(progressOf(job, 'derive', fi, f.fileName))
      const thickness =
        f.alignment?.thicknessMm !== null && f.alignment?.thicknessMm !== undefined && f.alignment.thicknessMm > 0
          ? { mm: f.alignment.thicknessMm, source: 'alignment' as const }
          : info.specimen.thicknessMm !== null
            ? { mm: info.specimen.thicknessMm, source: 'setup' as const }
            : { mm: null, source: null }
      const run = runDerive({
        sha256: f.sha256,
        thicknessMm: thickness.mm,
        outerDiameterMm: f.alignment?.outerDiameterMm ?? null,
        weld: info.specimen.weld,
        groups: inputs,
        labelSet: f.labelSet,
        records: f.records,
        reviewIntervals: f.reviewIntervals,
        observations: f.observations,
        rules
      })
      await tick()
      const res = run.result
      // derive 의 경고급 확인 사항 (scenes.json 에만 두지 않고 결과·manifest 경고로 올린다)
      const warnIssues = res.issues.filter((i) => i.level === 'warning' || i.level === 'error')
      if (warnIssues.length > 0) {
        const byCode = new Map<string, number>()
        for (const i of warnIssues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1)
        warnings.push(`'${f.fileName}': 변환 확인 사항 ${[...byCode].map(([c, n]) => `${c} ${n}건`).join(' · ')} (scenes.json issues)`)
      }
      // 검토 구간 안에 승인하지 않은 형상 에코 후보: 그 자리 형상 에코(분류 1)가 상자도 가림도 없이 배경(음성)이 된다
      try {
        const echo = suggestGeometricEchoes(run.ctx)
        const approved = f.records.filter((r) => !r.deleted && r.kind === 'geometric-echo')
        const reviewed = f.reviewIntervals.filter((v) => !v.deleted && v.kind === 'reviewed' && !v.released)
        let openMm = 0
        for (const c of echo.candidates) {
          const groupOk = (g: number | null): boolean => g === null || g === c.groupId
          const covered = approved.some((r) => {
            const g = r.signal.peak?.groupId ?? r.anchors[0]?.anchor.groupId ?? null
            return groupOk(g) && r.derived.scanStartMm <= c.scanEndMm && r.derived.scanEndMm >= c.scanStartMm
          })
          if (covered) continue
          for (const v of reviewed) {
            if (!groupOk(v.groupId)) continue
            const o = Math.min(v.scanEndMm, c.scanEndMm) - Math.max(v.scanStartMm, c.scanStartMm)
            if (o > 0) openMm += o
          }
        }
        if (openMm > 0) {
          fr.unapprovedEchoMm = Math.round(openMm * 10) / 10
          warnings.push(
            `'${f.fileName}': 검토 완료 구간 안에 승인하지 않은 형상 에코 후보 ${fr.unapprovedEchoMm} mm 가 있습니다 — 그 자리 형상 에코(분류 1)가 상자 없이 배경이 됩니다. 라벨 패널에서 승인·거절하세요.`
          )
        }
      } catch {
        // 후보 계산이 실패해도 내보내기는 이어 간다
      }
      const groupOf = (id: number): ViewerGroup | undefined => groups.find((x) => x.id === id)
      fr.groups = res.groups.map((g) => ({ groupId: g.groupId, name: g.name, blocked: blockedText(g.blocked, groupOf(g.groupId)) }))
      for (const g of fr.groups) {
        if (g.blocked) blockedGroups.push({ sha256: f.sha256, fileName: f.fileName, groupId: g.groupId, name: g.name, reason: g.blocked })
      }
      const live = res.groups.filter((g) => !g.blocked).map((g) => g.groupId)
      if (live.length === 0) {
        const why = [...new Set(fr.groups.map((g) => g.blocked ?? ''))].filter(Boolean).join(' / ')
        fr.reason = `모든 그룹이 막혔습니다: ${why || '그룹 없음'}`
        continue
      }

      // 3) 파일 폴더
      report(progressOf(job, 'write', fi, f.fileName))
      const folder = `files/${f.sha256.slice(0, 16)}`
      fr.folder = folder
      fr.status = 'exported'
      const extras = formatExtras(info)
      if (Object.keys(extras).length > 0) formatOf.set(f.sha256, { formatFamily: info.formatFamily, version: info.version, ...extras })
      fr.scenes = res.scenes.length
      fr.trainScenes = { ...res.stats.trainScenes }
      fr.boxes = res.stats.boxes
      fr.ascanSpans = res.stats.ascanSpans
      fr.issues = res.issues.length
      const split = splitName(f.split)
      const outputs = new Map<number, { amplitude: string | null; status: string | null; image: Record<string, unknown> | null }>()
      for (const gid of live) outputs.set(gid, { amplitude: null, status: null, image: null })

      // 원 진폭 (.npy)
      if (opts.amplitude) {
        for (const gid of live) {
          cancelled(job.signal)
          const g = groups.find((x) => x.id === gid)!
          const mine = chunks.filter((c) => c.groupId === gid).sort((a, b) => a.scanStart - b.scanStart)
          const [ns, nb, nt] = g.shape
          const ampName = `amplitude_g${gid}.npy`
          await out.putParts(`${folder}/${ampName}`, [npyHeader('<i2', [ns, nb, nt]), ...mine.map((c) => int16LeBytes(c.amplitude))])
          const o = outputs.get(gid)!
          o.amplitude = ampName
          if (mine.length > 0 && mine.every((c) => c.status !== null)) {
            const stName = `status_g${gid}.npy`
            await out.putParts(`${folder}/${stName}`, [npyHeader('|u1', [ns, nb]), ...mine.map((c) => Buffer.from(c.status!.buffer, c.status!.byteOffset, c.status!.byteLength))])
            o.status = stName
          }
          await tick()
        }
      }

      // 그림 · COCO · YOLO
      if (opts.images) {
        const fileImages: CocoImage[] = []
        const fileAnns: CocoAnnotation[] = []
        const splitCoco = coco.get(split) ?? { images: [], annotations: [] }
        coco.set(split, splitCoco)
        const splitYolo = yolo.get(split) ?? []
        yolo.set(split, splitYolo)
        // 검게 칠한 판은 학습(train) 분할에만 (val·test 는 가리지 않은 그림 — 평가 입력에 라벨 정보가 새지 않게)
        const blackTrain = opts.maskMode === 'blackout' && split === 'train'
        for (const gid of live) {
          const g = groups.find((x) => x.id === gid)!
          const pg = run.ctx.groups.find((x) => x.id === gid)!
          if (!pg.geom) continue
          const kit = groupImageKit(g, pg.geom, opts.mmPerPx)
          const evalPct = res.groups.find((x) => x.groupId === gid)?.levels?.evaluationPct ?? null
          outputs.get(gid)!.image = { folder: `images/g${gid}`, masks: `masks/g${gid}`, ...viewportMeta(kit.vp), maskMode: opts.maskMode, ...(blackTrain ? { masked: `masked/images/g${gid}` } : {}) }
          const scenes = res.scenes.filter((s) => s.groupId === gid).sort((a, b) => a.scanIndex - b.scanIndex)
          const width = Math.max(4, String(g.shape[0] - 1).length)
          const picks = scenes.map((s) => ({ s, d: decideSceneImage(s, opts.maskMode, evalPct) }))
          const total = picks.filter((p) => p.d.use).length
          let done = 0
          // 압축이 끝난 장면부터 차례로 쓴다 (쓰기·해시 순서 = 장면 순서)
          const pending: PendingScene[] = []
          const flush = async (keep: number): Promise<void> => {
            while (pending.length > keep) {
              const p = pending.shift()!
              const [image, mask, masked] = await p.pngs
              await out.put(p.imagePath, image)
              if (p.maskPath && mask) await out.put(p.maskPath, mask)
              if (p.maskedPath && masked) await out.put(p.maskedPath, masked)
              await out.put(p.labelPath, p.txt)
              if (p.maskedLabelPath) await out.put(p.maskedLabelPath, p.txt)
              done++
              fr.images++
              fr.annotations += p.lines
              report(progressOf(job, 'images', fi, f.fileName, done, total))
            }
          }
          try {
            for (const { s, d } of picks) {
              if (!d.use) continue
              cancelled(job.signal)
              const img = renderSceneImage(kit, run, s, chunks, d.positives, d.ignores)
              const stem = `g${gid}/s${pad(s.scanIndex, width)}`
              const maskName = img.maskedPx > 0 ? `masks/${stem}.png` : null
              const maskedName = blackTrain && img.maskedPx > 0 ? `masked/images/${stem}.png` : null
              // 필터는 여기서 끝난다 — kit.rgb 를 다음 장면이 다시 써도 된다
              const pngs = Promise.all([
                encodePngAsync(kit.vp.width, kit.vp.height, img.rgb, 3),
                maskName ? encodePngAsync(kit.vp.width, kit.vp.height, img.mask, 1) : null,
                maskedName ? encodePngAsync(kit.vp.width, kit.vp.height, blackout(img.rgb, img.mask), 3) : null
              ])
              pngs.catch(() => undefined) // 앞에서 실패해 기다리지 않게 되어도 처리하지 않은 거부로 남기지 않음
              const base = {
                width: kit.vp.width,
                height: kit.vp.height,
                sha256: f.sha256,
                group_id: gid,
                scan_index: s.scanIndex,
                scan_mm: s.scanMm,
                split,
                scene_state: s.state,
                train_state: s.trainState,
                reviewed: s.reviewed,
                masked_px: img.maskedPx,
                label_masked_px: img.labelMaskedPx
              }
              const imgLocal: CocoImage = { id: fileImages.length + 1, file_name: `images/${stem}.png`, ...base, mask_file_name: maskName, masked_file_name: maskedName }
              const imgGlobal: CocoImage = {
                id: splitCoco.images.length + 1,
                file_name: `${folder}/images/${stem}.png`,
                ...base,
                mask_file_name: maskName ? `${folder}/${maskName}` : null,
                masked_file_name: maskedName ? `${folder}/${maskedName}` : null
              }
              fileImages.push(imgLocal)
              splitCoco.images.push(imgGlobal)
              const lines: string[] = []
              const push = (cls: number, px: [number, number, number, number], iscrowd: 0 | 1, attributes: Record<string, unknown>): void => {
                const ann = (id: number, imageId: number): CocoAnnotation => ({ id, image_id: imageId, category_id: cls + 1, bbox: px, area: px[2] * px[3], iscrowd, attributes })
                fileAnns.push(ann(fileAnns.length + 1, imgLocal.id))
                splitCoco.annotations.push(ann(splitCoco.annotations.length + 1, imgGlobal.id))
              }
              for (const o of d.positives) {
                const px = objectBoxPixels(kit, run, s, o)
                const cls = classOf(o)
                lines.push(yoloLine(cls, kit.vp, px))
                push(cls, px, 0, {
                  recordUuid: o.recordUuid,
                  kind: o.kind,
                  defectType: o.defectType,
                  typeConfidence: o.typeConfidence,
                  leg: o.leg,
                  status: o.status,
                  trainStatus: o.trainStatus,
                  observation: o.observation,
                  signalPct: o.signalPct,
                  box: o.box
                })
              }
              // 무시 영역 (iscrowd = 1): 무시 객체의 탐색 창 — 평가에서 그 자리 검출은 맞음·틀림으로 세지 않는다
              for (const o of d.ignores) {
                const px = windowBoxPixels(kit, run, o)
                if (!px) continue
                push(classOf(o), px, 1, { ignore: true, recordUuid: o.recordUuid, kind: o.kind, leg: o.leg, reason: o.reason, status: o.status, trainStatus: o.trainStatus, signalPct: o.signalPct })
              }
              const txt = lines.length > 0 ? `${lines.join('\n')}\n` : ''
              // YOLO 목록: 검토한 장면만 (검토 안 한 장면은 상자 밖이 음성이라는 보장이 없어 COCO 에만)
              if (s.reviewed) splitYolo.push(`./${folder}/${maskedName ?? `images/${stem}.png`}`)
              pending.push({
                pngs,
                imagePath: `${folder}/images/${stem}.png`,
                maskPath: maskName ? `${folder}/${maskName}` : null,
                maskedPath: maskedName ? `${folder}/${maskedName}` : null,
                labelPath: `${folder}/labels/${stem}.txt`,
                maskedLabelPath: maskedName ? `${folder}/masked/labels/${stem}.txt` : null,
                txt,
                lines: lines.length
              })
              await flush(PNG_PIPELINE - 1)
              await tick()
            }
            await flush(0)
          } catch (e) {
            // 진행 중인 압축이 끝난 뒤 .partial 을 지우게 (바깥 catch)
            await Promise.allSettled(pending.map((p) => p.pngs))
            throw e
          }
        }
        await out.put(`${folder}/coco.json`, stableJson(cocoDoc(fileImages, fileAnns)))
      }

      // JSON 넷
      const scenesDoc: Record<string, unknown> = { ...res, ascanSpans: undefined, exportFormat: TRAINING_EXPORT_FORMAT, ascanFile: 'ascan.json' }
      await out.put(`${folder}/meta.json`, stableJson(metaDoc(f, info, run, thickness, outputs), true))
      await out.put(`${folder}/labels.json`, stableJson(labelsDoc(f)))
      await out.put(`${folder}/scenes.json`, stableJson(scenesDoc))
      const asc = ascanLabels(run, live)
      await out.put(
        `${folder}/ascan.json`,
        stableJson({
          format: 'paut-train-ascan',
          version: TRAINING_EXPORT_VERSION,
          derivedFormat: DERIVED_LABELS_FORMAT,
          rulesVersion: LABEL_DERIVE_RULES_VERSION,
          sha256: f.sha256,
          labelSet: f.labelSet,
          weakAs: rules.weakAs,
          unconfirmedObservation: rules.unconfirmedObservation,
          stateCodes: Object.fromEntries(Object.entries(ASCAN_STATE_CODE).map(([k, v]) => [v, k])),
          states: '원래 상태 (약한 양성·계산만 한 관측을 바꾸기 전)',
          trainStates: '학습 상태 (weakAs · unconfirmedObservation 을 반영 — 그림·COCO·YOLO 와 같은 기준, 기본 학습은 이것)',
          ...asc
        })
      )
      await tick()
    }

    // 4) 맨 위
    cancelled(job.signal)
    report(progressOf(job, 'finish', files.length, null))
    const splitsUsed = [...new Set(results.filter((r) => r.status === 'exported').map((r) => splitName(r.split)))].sort()
    if (opts.images) {
      for (const s of splitsUsed) {
        const c = coco.get(s) ?? { images: [], annotations: [] }
        await out.put(`coco_${s}.json`, stableJson(cocoDoc(c.images, c.annotations)))
        const list = yolo.get(s) ?? []
        await out.put(`yolo_${s}.txt`, list.length > 0 ? `${list.join('\n')}\n` : '')
      }
      const yaml = [
        '# PAUT 학습 데이터 (YOLO). 상자 = 펼친 S-scan 장면 상자 (앱이 mm 기록에서 계산). 0 = 결함, 1 = 형상 에코(결함 아님)',
        '# 분할을 정하지 않은 시편의 그림 목록은 yolo_unassigned.txt (여기에는 넣지 않음). 목록에는 검토한 장면만 (검토 안 한 장면은 COCO 에만)',
        '# Ultralytics 에는 이 파일을 절대 경로로 넘깁니다 (상대 경로로 넘기면 기본 datasets 폴더 기준으로 찾음). 목록 안 경로는 이 파일 폴더 기준',
        '# train 의 그림은 maskMode blackout 이면 무시 구역을 검게 칠한 판(masked/images), val·test 는 늘 원본 그림',
        ...(['train', 'val', 'test'] as const).filter((s) => splitsUsed.includes(s)).map((s) => `${s}: yolo_${s}.txt`),
        'names:',
        ...TRAIN_CLASSES.map((c) => `  ${c.id}: ${c.name}`),
        ''
      ].join('\n')
      await out.put('data.yaml', yaml)
    }
    const exported = results.filter((r) => r.status === 'exported')
    // 분할별 판독 단계 (test 는 확정이어야 함)
    const splitStages: Record<string, Record<string, number>> = {}
    for (const r of exported) {
      const f = files.find((x) => x.sha256 === r.sha256)!
      const sp = splitName(r.split)
      const st = f.labelSet?.readingStage ?? 'none'
      splitStages[sp] = { ...(splitStages[sp] ?? {}), [st]: (splitStages[sp]?.[st] ?? 0) + 1 }
    }
    const assignments = job.split.assignments ?? {}
    const assignmentsJson = stableJson(assignments)
    const paletteHash = createHash('sha256').update(DEFAULT_AMPLITUDE_PALETTE.join(',')).digest('hex')
    // checksums 는 manifest 를 빼고 (시각이 바뀌어도 그대로) — 경로 순. 데이터셋 ID = 그 글자의 SHA-256
    out.sums.sort((a, b) => cmpStr(a.path, b.path))
    const checksumsText = out.sums.map((x) => `${x.sha256}  ${x.path}`).join('\n') + '\n'
    const datasetId = createHash('sha256').update(checksumsText).digest('hex')
    const manifest = {
      format: TRAINING_EXPORT_FORMAT,
      formatVersion: TRAINING_EXPORT_VERSION,
      appVersion: job.appVersion,
      exportedAt: job.exportedAt,
      pcId: job.pcId,
      datasetId,
      versions: {
        labelSchema: LABEL_SCHEMA_VERSION,
        coordRules: LABEL_COORD_RULES_VERSION,
        deriveRules: LABEL_DERIVE_RULES_VERSION,
        derivedFormat: DERIVED_LABELS_FORMAT,
        imageRules: TRAIN_IMAGE_RULES_VERSION,
        exporter: TRAINING_EXPORT_VERSION,
        palette: { name: IMAGE_PALETTE_NAME, sha256: paletteHash }
      },
      guidelineVersions: [...new Set(files.filter((f) => f.labelSet).map((f) => f.labelSet!.guidelineVersion))].sort(),
      options: { ...opts, fixedExportedAt: undefined },
      rules,
      setRule: job.setRule,
      blindModeLabelerId: job.blindModeLabelerId,
      split: {
        unit: job.split.unit,
        testLocked: job.split.testLocked,
        testLockedAt: job.split.testLockedAt,
        lastChangedAt: job.split.lastChangedAt ?? null,
        assignments,
        assignmentsSha256: createHash('sha256').update(assignmentsJson).digest('hex'),
        stages: splitStages
      },
      classes: TRAIN_CLASSES.map((c) => ({ yolo: c.id, coco: c.id + 1, name: c.name, ko: c.ko })),
      sceneStates: {
        positive: '양성',
        weak: '약한 양성 (기본 학습에서는 weakAs 로 바꿈)',
        ignore: '무시 (가림)',
        negative: '음성 (검토 게이트 안)',
        unknown: '모름 (검토 안 함 — 음성으로 쓰지 않음)'
      },
      files: exported.map((r) => {
        const f = files.find((x) => x.sha256 === r.sha256)!
        return {
          folder: r.folder,
          sha256: r.sha256,
          fileName: r.fileName,
          specimenId: r.specimenId,
          weldId: f.weldId,
          split: splitName(r.split),
          labelSet: f.labelSet,
          setId: r.setId,
          labelerId: f.labelSet?.labelerId ?? null,
          readingStage: f.labelSet?.readingStage ?? null,
          guidelineVersion: f.labelSet?.guidelineVersion ?? null,
          pendingConflicts: f.pendingConflicts,
          groups: r.groups,
          scenes: r.scenes,
          trainScenes: r.trainScenes,
          boxes: r.boxes,
          ascanSpans: r.ascanSpans,
          images: r.images,
          annotations: r.annotations,
          issues: r.issues,
          unapprovedEchoMm: r.unapprovedEchoMm ?? 0,
          ...(formatOf.has(r.sha256) ? { format: formatOf.get(r.sha256) } : {})
        }
      }),
      skipped: results
        .filter((r) => r.status === 'skipped')
        .map((r) => ({ sha256: r.sha256, fileName: r.fileName, specimenId: r.specimenId, split: splitName(r.split), reason: r.reason })),
      blockedGroups,
      setSelection: files.map((f) => ({
        sha256: f.sha256,
        fileName: f.fileName,
        candidates: [...f.selection.candidates].sort(),
        chosen: f.selection.chosen,
        reason: f.selection.reason
      })),
      totals: {
        files: files.length,
        exported: exported.length,
        skipped: results.length - exported.length,
        blockedGroups: blockedGroups.length,
        scenes: exported.reduce((s, r) => s + r.scenes, 0),
        trainScenes: exported.reduce((acc, r) => {
          for (const k of Object.keys(acc) as SceneState[]) acc[k] += r.trainScenes[k]
          return acc
        }, zero()),
        boxes: exported.reduce((s, r) => s + r.boxes, 0),
        ascanSpans: exported.reduce((s, r) => s + r.ascanSpans, 0),
        images: exported.reduce((s, r) => s + r.images, 0),
        annotations: exported.reduce((s, r) => s + r.annotations, 0)
      },
      warnings,
      checksums: 'checksums.sha256 (manifest.json 을 뺀 모든 파일)'
    }
    await out.put('checksums.sha256', checksumsText, false)
    await out.put('manifest.json', stableJson(manifest, true), false)

    cancelled(job.signal)
    try {
      await rename(tmp, job.outDir)
    } catch (e) {
      throw new AppError('IO_ERROR', `학습 데이터 폴더 이름을 바꾸지 못했습니다: ${job.outDir}`, e instanceof Error ? e.message : String(e))
    }
    report(progressOf(job, 'done', files.length, null))
    return {
      operationId: job.operationId,
      path: job.outDir,
      folderName: basename(job.outDir),
      exportedAt: job.exportedAt,
      files: results,
      totals: {
        files: files.length,
        exported: exported.length,
        skipped: results.length - exported.length,
        blockedGroups: blockedGroups.length,
        scenes: manifest.totals.scenes,
        images: manifest.totals.images,
        annotations: manifest.totals.annotations,
        ascanSpans: manifest.totals.ascanSpans,
        bytes: out.bytes
      },
      warnings
    }
  } catch (e) {
    // 방금 만든 .partial 폴더만 지운다 (원본·다른 폴더는 건드리지 않음)
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    if (e instanceof AppError) throw e
    throw new AppError('IO_ERROR', '학습 데이터를 내보내지 못했습니다.', e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
}
