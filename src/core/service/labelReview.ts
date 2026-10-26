/**
 * 3단계 검수의 Electron 비의존 부분 — IPC 'labels:reviewSources · compareSets · previewFinal · saveFinal · saveReviewCsv'.
 * core/service/labels.ts 가 작업 잠금(op)·설정·버전 칸을 맞춘 뒤 이 함수들을 부른다. 계산은 모두 shared/labels/review.
 *
 * - 불러오기: 파일(sha256)마다 세트 키(라벨러·판독 단계·지침서 버전)로 기록(지움 표시 제외)과 검토 구간(풀린 것 포함 —
 *   매칭이 스스로 뺀다)을 읽고, 파일 정렬·두께(파일 정렬 → 스캔플랜)·파일 이름을 붙여 compareLabelSets 를 돌린다.
 * - 행 지문(rowsKey): 행 ID 마다 두 쪽 기록의 UUID·revision. 확정 미리보기·저장·CSV 는 비교를 다시 돌리고 지문이 다르면
 *   CONFLICT 다(그사이 다른 화면·PC 에서 기록이 바뀌어 'P003' 이 다른 짝을 가리키게 되는 것을 막음).
 * - 확정: buildFinalSet(원래 두 세트는 고치지 않음). 확정 세트 = (sha256, 지금 라벨러, 지침서, 'final').
 *   이전 확정 기록·검토 구간(지움 표시 포함)을 previous 로 넘겨 버전 칸을 이어 받는다 → 같은 결정을 다시 저장하면 '그대로'.
 *   저장은 한 트랜잭션: 기록 저장(검토 구간 자동 풀기 끔 — 이번 결정으로 검토 구간도 함께 새로 쓰므로) → 빠진 이전 기록 지움 표시
 *   → 검토 구간 저장 → 빠진 이전 구간 지움 표시 → 그룹 짓기 다시 매기기.
 * - 잠긴 시험 세트: 시험 세트가 잠겨 있고 그 시편이 test 인데 이미 확정 세트가 있으면, 확정 세트를 바꾸는 것은 시험 정답을
 *   바꾸는 일이라 확인과 이유를 받고 분할 기록(label_meta 'train-split' log)에 'locked-change'(test → test)로 남긴다.
 * - Level III: 지금 라벨러의 자격 글자가 Level III 가 아니면 confirmNotLevel3 없이 저장하지 않는다(CONFLICT).
 */
import { createHash } from 'node:crypto'
import { sameLabelContent, type Catalog, type LabelWriteContext } from '@core/catalog'
import { deleteLabelRecord, recomputeGrouping, saveLabelRecord, thicknessForFile } from '@core/labels'
import { readSplitState, splitOf, writeSplitState, type SplitState } from '@core/labels/export'
import {
  isLevel3Qualification,
  type ReviewCompareOptions,
  type ReviewCompareRequest,
  type ReviewComparison,
  type ReviewCsvKind,
  type ReviewCsvRequest,
  type ReviewFileInfo,
  type ReviewFinalOptions,
  type ReviewFinalPreview,
  type ReviewFinalRequest,
  type ReviewFinalSaveOptions,
  type ReviewFinalSaveResult,
  type ReviewSaveCounts,
  type ReviewSetInfo,
  type ReviewSideKey,
  type ReviewSourceFile,
  type ReviewSources
} from '@shared/api'
import { AppError } from '@shared/errors'
import type { TruthTier } from '@shared/labels/codes'
import { labelSetId } from '@shared/labels/factory'
import { PROVISIONAL_DEPTH_DIFF_MM, PROVISIONAL_SCAN_GAP_MM } from '@shared/labels/match'
import { PROVISIONAL_GRADING_UNIT_MM } from '@shared/labels/metrics'
import {
  MERGE_FIELDS,
  buildEvaluationReport,
  buildFinalSet,
  compareLabelSets,
  comparisonRowsCsv,
  designCheckCsv,
  evaluationReportCsv,
  hasAdjudication,
  sensitivityGrid,
  type AdjudicationChoice,
  type AdjudicationDecision,
  type AdjudicationResult,
  type CompareResult,
  type DesignAddition,
  type MergeField,
  type ReportHeaderInput
} from '@shared/labels/review'
import type { FileAlignment, IndicationRecord, LabelSetKey, LabelerInfo, ObservationRow, PhysicalDefect, ReadingStage, ReviewInterval } from '@shared/labels/types'
import type { FileRecord } from '@shared/types'
import { invalid, isObj } from './guards'

const SHA256 = /^[0-9a-f]{64}$/
const STAGES: readonly ReadingStage[] = ['blind', 'reconciled', 'final']
const PURPOSES = ['inter-reader', 'accuracy', 'agency'] as const
const CHOICES: readonly AdjudicationChoice[] = ['a', 'b', 'merge', 'neither', 'defer']
const TIERS: readonly (TruthTier | 'any')[] = ['certified', 'consensus', 'single', 'any']
const MAX_FILES = 5000
const NOTE_MAX = 500

/** 2인 독립 모드에서 검수를 막는 이유 (화면·오류 공용) */
export const REVIEW_BLIND_REASON =
  '2인 독립 모드라 검수를 할 수 없습니다. 검수(두 사람 기록 비교·Level III 확정)는 두 블라인드 판독을 마친 뒤 Level III 가 합니다 — ' +
  '라벨러 줄에서 2인 모드를 끄고 Level III 라벨러를 고르세요.'

function text(v: unknown, what: string, max: number): string {
  const s = typeof v === 'string' ? v.normalize('NFC').trim() : ''
  if (s === '') invalid(`${what} 이(가) 비어 있습니다.`)
  if (s.length > max) invalid(`${what} 이(가) 너무 깁니다 (${max}자까지).`)
  return s
}

function optText(v: unknown, what: string, max: number): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') invalid(`${what} 값이 올바르지 않습니다.`)
  const s = v.normalize('NFC').trim()
  if (s.length > max) invalid(`${what} 이(가) 너무 깁니다 (${max}자까지).`)
  return s === '' ? null : s
}

function optNumber(v: unknown, what: string, min: number, max: number, exclusiveMin = false): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (exclusiveMin && v <= min)) {
    invalid(`${what} 값이 올바르지 않습니다 (${exclusiveMin ? '0 보다 크고' : `${min} 이상`} ${max} 이하).`)
  }
  return v
}

function oneOf<T extends string>(v: unknown, list: readonly T[], what: string): T | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) invalid(`${what} 값이 올바르지 않습니다: ${String(v)}`)
  return v as T
}

// ───────────────────────────── 요청 검사 ─────────────────────────────

function cleanSide(v: unknown, label: 'A' | 'B'): ReviewSideKey {
  if (!isObj(v)) invalid(`${label} 세트가 올바르지 않습니다.`)
  const stage = oneOf(v.readingStage, STAGES, `${label} 판독 단계`)
  if (!stage) invalid(`${label} 판독 단계가 없습니다.`)
  return {
    labelerId: text(v.labelerId, `${label} 라벨러 ID`, 64),
    readingStage: stage,
    guidelineVersion: text(v.guidelineVersion, `${label} 지침서 버전`, 32)
  }
}

/** 비교 요청 검사 + 기본값 채우기 (파일 목록은 소문자·중복 없이 정렬) */
export function cleanCompareRequest(req: unknown): ReviewCompareRequest {
  if (!isObj(req)) invalid('비교 요청이 올바르지 않습니다.')
  if (!Array.isArray(req.sha256s)) invalid('비교할 파일 목록이 올바르지 않습니다.')
  const shas = [...new Set(req.sha256s.map((x) => String(x).trim().toLowerCase()))].sort()
  if (shas.length === 0) invalid('비교할 파일을 고르세요.')
  if (shas.length > MAX_FILES) invalid(`한 번에 비교할 파일은 ${MAX_FILES}개까지입니다.`)
  if (shas.some((s) => !SHA256.test(s))) invalid('SHA-256 값이 올바르지 않습니다.')
  const a = cleanSide(req.a, 'A')
  const b = cleanSide(req.b, 'B')
  if (a.labelerId === b.labelerId && a.readingStage === b.readingStage && a.guidelineVersion === b.guidelineVersion) {
    invalid('A 와 B 가 같은 세트입니다. 다른 라벨러나 다른 판독 단계를 고르세요.')
  }
  const o = req.options === undefined || req.options === null ? {} : req.options
  if (!isObj(o)) invalid('비교 옵션이 올바르지 않습니다.')
  const options: Required<ReviewCompareOptions> = {
    purpose: oneOf(o.purpose, PURPOSES, '비교 목적') ?? 'inter-reader',
    unit: oneOf(o.unit, ['record', 'grouping'] as const, '비교 단위') ?? 'grouping',
    frame: oneOf(o.frame, ['file', 'weld'] as const, '좌표 틀') ?? 'file',
    scanGapMm: optNumber(o.scanGapMm, '매칭 허용치 X (mm)', 0, 1000) ?? PROVISIONAL_SCAN_GAP_MM,
    depthDiffMm: optNumber(o.depthDiffMm, '매칭 허용치 Y (mm)', 0, 200) ?? PROVISIONAL_DEPTH_DIFF_MM,
    gradingUnitMm: optNumber(o.gradingUnitMm, '구간 단위 길이 (mm)', 0, 1000, true) ?? PROVISIONAL_GRADING_UNIT_MM
  }
  return { sha256s: shas, a, b, options }
}

function cleanDecision(v: unknown): AdjudicationDecision {
  if (!isObj(v)) invalid('결정 값이 올바르지 않습니다.')
  const rowId = typeof v.rowId === 'string' && /^P\d{3,}$/.test(v.rowId) ? v.rowId : invalid(`결정의 행 ID 가 올바르지 않습니다: ${String(v.rowId)}`)
  const choice = oneOf(v.choice, CHOICES, `${rowId} 결정`)
  if (!choice) invalid(`${rowId} 결정이 없습니다.`)
  const d: AdjudicationDecision = { rowId, choice }
  if (v.fields !== undefined && v.fields !== null) {
    if (!isObj(v.fields)) invalid(`${rowId} 합칠 칸 값이 올바르지 않습니다.`)
    const fields: Partial<Record<MergeField, 'a' | 'b'>> = {}
    for (const [k, x] of Object.entries(v.fields)) {
      if (!(MERGE_FIELDS as readonly string[]).includes(k)) invalid(`${rowId} 모르는 칸 묶음입니다: ${k}`)
      if (x !== 'a' && x !== 'b') invalid(`${rowId} 칸 묶음 ${k} 의 값은 a 또는 b 여야 합니다.`)
      fields[k as MergeField] = x
    }
    d.fields = fields
  }
  if (v.physicalDefectId !== undefined) d.physicalDefectId = optText(v.physicalDefectId, `${rowId} 물리 결함 ID`, 64)
  const note = optText(v.note, `${rowId} 메모`, NOTE_MAX)
  if (note !== null) d.note = note
  return d
}

function cleanFinalOptions(o: Record<string, unknown>, shas: readonly string[]): ReviewFinalOptions {
  const out: ReviewFinalOptions = {}
  const deferAs = oneOf(o.deferAs, ['uncertain', 'omit'] as const, '보류 처리')
  if (deferAs) out.deferAs = deferAs
  const carry = oneOf(o.carryNonDefect, ['a', 'b', 'none'] as const, '비결함 기록 베끼기')
  if (carry) out.carryNonDefect = carry
  const reviews = oneOf(o.reviews, ['intersection', 'a', 'b', 'none'] as const, '확정 검토 구간')
  if (reviews) out.reviews = reviews
  if (o.design !== undefined && o.design !== null) {
    if (!isObj(o.design)) invalid('설계값 대조 옵션이 올바르지 않습니다.')
    const minTier = oneOf(o.design.minTier, TIERS, '정답 계층 하한')
    const depthIs = oneOf(o.design.depthIs, ['top', 'center', 'unknown'] as const, '설계 깊이의 뜻')
    if (o.design.link !== undefined && typeof o.design.link !== 'boolean') invalid('물리 결함 ID 채우기 값이 올바르지 않습니다.')
    out.design = {
      ...(minTier ? { minTier } : {}),
      ...(depthIs ? { depthIs } : {}),
      ...(typeof o.design.link === 'boolean' ? { link: o.design.link } : {})
    }
  }
  if (o.designAdditions !== undefined && o.designAdditions !== null) {
    if (!Array.isArray(o.designAdditions)) invalid('설계값으로 더할 결함 목록이 올바르지 않습니다.')
    out.designAdditions = o.designAdditions.map((x): DesignAddition => {
      if (!isObj(x)) invalid('설계값으로 더할 결함 값이 올바르지 않습니다.')
      const sha = String(x.sha256 ?? '').trim().toLowerCase()
      if (!shas.includes(sha)) invalid('설계값으로 더할 결함의 파일이 비교한 파일에 없습니다.')
      const note = optText(x.note, '메모', NOTE_MAX)
      return { specimenId: text(x.specimenId, '시편 ID', 64), defectId: text(x.defectId, '물리 결함 ID', 64), sha256: sha, ...(note ? { note } : {}) }
    })
  }
  return out
}

/** 확정 요청 검사 */
export function cleanFinalRequest(req: unknown): ReviewFinalRequest {
  if (!isObj(req)) invalid('확정 요청이 올바르지 않습니다.')
  const compare = cleanCompareRequest(req.compare)
  if (typeof req.rowsKey !== 'string' || req.rowsKey === '') invalid('비교 결과 지문(rowsKey)이 없습니다. 먼저 비교하세요.')
  if (!Array.isArray(req.decisions)) invalid('결정 목록이 올바르지 않습니다.')
  if (req.decisions.length > 100_000) invalid('결정이 너무 많습니다.')
  return { compare, rowsKey: req.rowsKey, decisions: req.decisions.map(cleanDecision), ...cleanFinalOptions(req, compare.sha256s) }
}

function cleanHeader(v: unknown): ReportHeaderInput {
  if (v === undefined || v === null) return {}
  if (!isObj(v)) invalid('보고서 머리 값이 올바르지 않습니다.')
  const h: ReportHeaderInput = {}
  for (const k of ['datasetVersion', 'testSetLockedAt', 'matchFrozenAt', 'guidelineVersion', 'modelVersion'] as const) {
    const s = optText(v[k], '보고서 머리', 100)
    if (s !== null) h[k] = s
  }
  const tier = oneOf(v.truthTier, ['certified', 'consensus', 'single'] as const, '정답 계층')
  if (tier) h.truthTier = tier
  const welds = optNumber(v.welds, '용접부 수', 0, 1_000_000)
  if (welds !== undefined) h.welds = Math.round(welds)
  const len = optNumber(v.reviewedLengthMm, '검토 길이 (mm)', 0, 1e9)
  if (len !== undefined) h.reviewedLengthMm = len
  return h
}

/** CSV 요청 검사 */
export function cleanCsvRequest(req: unknown): ReviewCsvRequest {
  if (!isObj(req)) invalid('CSV 요청이 올바르지 않습니다.')
  const kind = oneOf(req.kind, ['comparison', 'design', 'report'] as const, 'CSV 종류')
  if (!kind) invalid('CSV 종류가 없습니다.')
  const compare = cleanCompareRequest(req.compare)
  const out: ReviewCsvRequest = { kind, compare, header: cleanHeader(req.header), sensitivity: req.sensitivity !== false }
  if (req.final !== undefined && req.final !== null) {
    const f = cleanFinalRequest({ ...(isObj(req.final) ? req.final : {}), compare })
    const rest: Omit<ReviewFinalRequest, 'compare'> = { ...f }
    delete (rest as Partial<ReviewFinalRequest>).compare
    out.final = rest
  }
  if (kind === 'design' && !out.final) invalid('설계값 대조 표는 Level III 결정(확정 미리보기)이 있어야 만듭니다.')
  return out
}

// ───────────────────────────── 불러오기 · 비교 ─────────────────────────────

interface Loaded {
  a: { records: IndicationRecord[]; intervals: ReviewInterval[] }
  b: { records: IndicationRecord[]; intervals: ReviewInterval[] }
  alignments: FileAlignment[]
  files: ReviewFileInfo[]
  thickness: Map<string, number | null>
  fileNames: Record<string, string>
  split: SplitState
}

function setKey(sha256: string, side: ReviewSideKey): LabelSetKey {
  return { sha256, labelerId: side.labelerId, guidelineVersion: side.guidelineVersion, readingStage: side.readingStage }
}

function load(catalog: Catalog, req: ReviewCompareRequest): Loaded {
  const split = readSplitState(catalog.dbPath)
  const out: Loaded = {
    a: { records: [], intervals: [] },
    b: { records: [], intervals: [] },
    alignments: catalog.labels.listFileAlignments({ sha256s: req.sha256s }),
    files: [],
    thickness: new Map(),
    fileNames: {},
    split
  }
  const alignBySha = new Map(out.alignments.map((a) => [a.sha256, a] as const))
  for (const sha of req.sha256s) {
    const sides = [
      [req.a, out.a],
      [req.b, out.b]
    ] as const
    const has: boolean[] = []
    for (const [key, into] of sides) {
      const k = setKey(sha, key)
      const recs = catalog.labels.listRecords({ set: k })
      const ivs = catalog.labels.listReviewIntervals({ set: k })
      into.records.push(...recs)
      into.intervals.push(...ivs)
      has.push(recs.length + ivs.length > 0)
    }
    const f: FileRecord | null = catalog.findFileBySha256(sha)
    const al = alignBySha.get(sha)
    const name = f?.storedFileName ?? (al?.fileName || sha.slice(0, 12))
    const specimenId = f?.specimenId ?? al?.specimenId ?? null
    out.fileNames[sha] = name
    out.thickness.set(sha, thicknessForFile(catalog, sha))
    out.files.push({
      sha256: sha,
      fileId: f?.id ?? null,
      planId: f?.planId ?? null,
      fileName: name,
      specimenId,
      split: splitOf(split, specimenId),
      hasA: has[0] === true,
      hasB: has[1] === true
    })
  }
  out.files.sort((x, y) => x.fileName.localeCompare(y.fileName, 'ko') || (x.sha256 < y.sha256 ? -1 : 1))
  return out
}

/** 행 짝 지문: 행 ID 마다 두 쪽 기록의 UUID·revision + 비교 인자 */
export function rowsKeyOf(c: CompareResult): string {
  const rows = c.rows.map((r) => [r.id, r.kind, r.a?.records.map((x) => `${x.uuid}#${x.revision}`) ?? [], r.b?.records.map((x) => `${x.uuid}#${x.revision}`) ?? []])
  const p = c.context.params
  const ctx = [c.purpose, c.context.unit, c.context.grouping, p.frame, p.scanGapMm, p.depthDiffMm, p.coverage, c.context.gradingUnitMm]
  return createHash('sha256').update(JSON.stringify([rows, ctx])).digest('hex').slice(0, 32)
}

function compareLoaded(req: ReviewCompareRequest, d: Loaded): CompareResult {
  const o = req.options ?? {}
  return compareLabelSets(
    { labelerId: req.a.labelerId, records: d.a.records, intervals: d.a.intervals },
    { labelerId: req.b.labelerId, records: d.b.records, intervals: d.b.intervals },
    {
      ...(o.purpose ? { purpose: o.purpose } : {}),
      ...(o.unit ? { unit: o.unit } : {}),
      params: {
        ...(o.frame ? { frame: o.frame } : {}),
        ...(o.scanGapMm !== undefined ? { scanGapMm: o.scanGapMm } : {}),
        ...(o.depthDiffMm !== undefined ? { depthDiffMm: o.depthDiffMm } : {})
      },
      alignments: d.alignments,
      thicknessFor: (sha) => d.thickness.get(sha) ?? null,
      ...(o.gradingUnitMm !== undefined ? { gradingUnitMm: o.gradingUnitMm } : {}),
      fileNames: d.fileNames
    }
  )
}

/** 두 세트 비교 (요청은 cleanCompareRequest 를 거친 것) */
export function runCompare(catalog: Catalog, req: ReviewCompareRequest): ReviewComparison {
  const d = load(catalog, req)
  const noA = d.files.every((f) => !f.hasA)
  const noB = d.files.every((f) => !f.hasB)
  if (noA || noB) {
    const side = noA ? `A (${req.a.labelerId})` : `B (${req.b.labelerId})`
    invalid(`고른 파일에 ${side} 세트가 없습니다. 세트나 파일을 다시 고르세요.`)
  }
  let comparison: CompareResult
  try {
    comparison = compareLoaded(req, d)
  } catch (e) {
    if (e instanceof RangeError) invalid(e.message)
    throw e
  }
  return {
    request: req,
    rowsKey: rowsKeyOf(comparison),
    comparison,
    files: d.files,
    testLocked: d.split.testLock.locked,
    testLockedAt: d.split.testLock.locked ? d.split.testLock.at : null
  }
}

// ───────────────────────────── 검수 탭 목록 ─────────────────────────────

export function reviewSourcesOf(catalog: Catalog, opts: { blindMode: boolean; labelerId: string | null }): ReviewSources {
  const split = readSplitState(catalog.dbPath)
  const adjudicator = opts.labelerId ? catalog.labels.getLabeler(opts.labelerId) : null
  const base: ReviewSources = {
    blocked: null,
    adjudicator,
    adjudicatorIsLevel3: isLevel3Qualification(adjudicator?.qualification),
    testLocked: split.testLock.locked,
    testLockedAt: split.testLock.locked ? split.testLock.at : null,
    files: [],
    physicalDefects: 0
  }
  // 2인 독립 모드: 다른 라벨러 세트가 있다는 것도 보이지 않게 목록을 비운다
  if (opts.blindMode) return { ...base, blocked: REVIEW_BLIND_REASON }
  const labelers = new Map(catalog.labels.listLabelers().map((l) => [l.id, l] as const))
  const bySha = new Map<string, ReviewSetInfo[]>()
  for (const s of catalog.labels.listLabelSets()) {
    const l = labelers.get(s.labelerId)
    const info: ReviewSetInfo = {
      setId: s.setId,
      labelerId: s.labelerId,
      labelerName: l?.name ?? null,
      qualification: l?.qualification ?? null,
      readingStage: s.readingStage,
      guidelineVersion: s.guidelineVersion,
      recordCount: s.recordCount,
      defectCount: s.defectCount,
      reviewedLengthMm: s.reviewedLengthMm,
      pendingConflicts: s.pendingConflicts
    }
    bySha.set(s.sha256, [...(bySha.get(s.sha256) ?? []), info])
  }
  const specimens = new Set<string>()
  const files: ReviewSourceFile[] = []
  for (const [sha, sets] of bySha) {
    const f = catalog.findFileBySha256(sha)
    const al = catalog.labels.getFileAlignment(sha)
    const specimenId = f?.specimenId ?? al?.specimenId ?? null
    if (specimenId) specimens.add(specimenId)
    if (al?.specimenId) specimens.add(al.specimenId)
    files.push({
      sha256: sha,
      fileId: f?.id ?? null,
      planId: f?.planId ?? null,
      fileName: f?.storedFileName ?? (al?.fileName || sha.slice(0, 12)),
      specimenId,
      split: splitOf(split, specimenId),
      sets: [...sets].sort((x, y) => (x.setId < y.setId ? -1 : x.setId > y.setId ? 1 : 0))
    })
  }
  files.sort((x, y) => x.fileName.localeCompare(y.fileName, 'ko') || (x.sha256 < y.sha256 ? -1 : 1))
  const physicalDefects = specimens.size > 0 ? catalog.labels.listPhysicalDefects({ specimenIds: [...specimens] }).length : 0
  return { ...base, files, physicalDefects }
}

// ───────────────────────────── 확정 ─────────────────────────────

export interface FinalPlan {
  preview: ReviewFinalPreview
  comparison: ReviewComparison
  finalSets: LabelSetKey[]
  /** 잠긴 시험 세트 기록에 남길 시편 */
  lockedSpecimens: string[]
}

/** buildFinalSet 기본값과 같은 규칙: 원본 기록에 가장 많은 지침서 버전 (같으면 글자 순으로 앞, 없으면 'v1') */
function mostCommonGuideline(records: readonly IndicationRecord[], fallback: string): string {
  const n = new Map<string, number>()
  for (const r of records) n.set(r.guidelineVersion, (n.get(r.guidelineVersion) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [v, c] of [...n].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    if (c > bestN) {
      best = v
      bestN = c
    }
  }
  return best ?? fallback
}

/**
 * 확정 미리보기 계산 (저장하지 않음). 비교를 다시 돌려 지문을 확인하고, 이전 확정 단위·물리 결함을 붙여 buildFinalSet.
 */
export function planFinal(catalog: Catalog, req: ReviewFinalRequest, adj: LabelerInfo, ctx: { pcId: string; now: string }): FinalPlan {
  const cmp = runCompare(catalog, req.compare)
  if (cmp.rowsKey !== req.rowsKey) {
    throw new AppError('CONFLICT', '그사이 기록이 바뀌어 비교 결과가 달라졌습니다. 다시 비교한 뒤 결정을 확인하세요.')
  }
  const c = cmp.comparison
  const gv = mostCommonGuideline([...c.recordsA, ...c.recordsB], req.compare.a.guidelineVersion)
  const sameAsFinal = (s: ReviewSideKey): boolean => s.labelerId === adj.id && s.readingStage === 'final' && s.guidelineVersion === gv
  if (sameAsFinal(req.compare.a) || sameAsFinal(req.compare.b)) {
    invalid('비교하는 세트가 만들 확정 세트와 같은 세트입니다(같은 라벨러·확정·지침서). 다른 라벨러로 확정하거나 다른 세트를 비교하세요.')
  }
  const finalSets = req.compare.sha256s.map((sha): LabelSetKey => ({ sha256: sha, labelerId: adj.id, guidelineVersion: gv, readingStage: 'final' }))
  const prevRecords: IndicationRecord[] = []
  const prevIntervals: ReviewInterval[] = []
  for (const k of finalSets) {
    prevRecords.push(...catalog.labels.listRecords({ set: k, includeDeleted: true }))
    prevIntervals.push(...catalog.labels.listReviewIntervals({ set: k, includeDeleted: true }))
  }
  const liveBySha = new Map<string, number>()
  for (const r of prevRecords) if (!r.deleted) liveBySha.set(r.sha256, (liveBySha.get(r.sha256) ?? 0) + 1)
  for (const v of prevIntervals) if (!v.deleted) liveBySha.set(v.sha256, (liveBySha.get(v.sha256) ?? 0) + 1)

  // 물리 결함 (이 파일들 시편)
  const specimens = new Set<string>()
  for (const f of cmp.files) if (f.specimenId) specimens.add(f.specimenId)
  for (const a of c.alignments) if (a.specimenId) specimens.add(a.specimenId)
  const defects: PhysicalDefect[] = specimens.size > 0 ? catalog.labels.listPhysicalDefects({ specimenIds: [...specimens] }) : []
  const useDesign = defects.length > 0

  let result: AdjudicationResult
  try {
    result = buildFinalSet({
      comparison: c,
      decisions: req.decisions,
      adjudicator: { labelerId: adj.id, qualification: adj.qualification, organization: adj.organization },
      guidelineVersion: gv,
      pcId: ctx.pcId,
      now: ctx.now,
      ...(req.deferAs ? { deferAs: req.deferAs } : {}),
      ...(req.carryNonDefect ? { carryNonDefect: req.carryNonDefect } : {}),
      ...(req.reviews ? { reviews: req.reviews } : {}),
      ...(useDesign ? { design: { defects, ...(req.design ?? {}) } } : {}),
      ...(req.designAdditions && req.designAdditions.length > 0 ? { designAdditions: req.designAdditions } : {}),
      previous: { records: prevRecords, reviewIntervals: prevIntervals }
    })
  } catch (e) {
    if (e instanceof RangeError) invalid(e.message)
    throw e
  }
  if (!useDesign) result.warnings.push('이 시편들에 물리 결함(설계값)이 없어 설계값 대조를 하지 않았습니다.')
  // 검수에서 만들지 않은 확정 기록(검수 출처 없음 — 엑셀·다른 경로로 들어온 것)은 이번 결과에 없어도 지움 표시하지 않는다
  const manual = new Set(prevRecords.filter((r) => !r.deleted && !hasAdjudication(r)).map((r) => r.uuid))
  const keptManual = result.removed.records.filter((u) => manual.has(u))
  if (keptManual.length > 0) {
    result = { ...result, removed: { ...result.removed, records: result.removed.records.filter((u) => !manual.has(u)) } }
    result.warnings.push(`확정 세트에 검수에서 만들지 않은 기록 ${keptManual.length}건이 있어 그대로 둡니다 (지우려면 따로 정리하세요).`)
  }
  // 형상 에코(결함 아님) 라벨이 확정 세트에서 빠지면 학습 내보내기(확정 세트 먼저)가 그 파일의 음성 예를 잃는다
  for (const sha of req.compare.sha256s) {
    const srcEcho = [...c.recordsA, ...c.recordsB].some((r) => r.sha256 === sha && !r.deleted && r.kind === 'geometric-echo')
    const outEcho = result.records.some((r) => r.sha256 === sha && r.kind === 'geometric-echo')
    const keptEcho = prevRecords.some((r) => r.sha256 === sha && !r.deleted && manual.has(r.uuid) && r.kind === 'geometric-echo')
    if (srcEcho && !outEcho && !keptEcho) {
      result.warnings.push(
        `'${cmp.files.find((f) => f.sha256 === sha)?.fileName ?? sha.slice(0, 12)}' 확정 세트에 형상 에코 기록이 없습니다 — 학습 데이터 내보내기에서 이 파일의 형상 에코(결함 아님) 라벨이 빠집니다. '형상 에코 등 비결함 기록'을 A 또는 B 로 베끼세요.`
      )
    }
  }
  // 같은 파일에 다른 라벨러의 확정 세트가 있으면 학습 데이터 고르기(확정 > …)가 둘 중 하나를 고르지 못한다
  const others = new Set<string>()
  const liveFinal = new Set<string>()
  for (const sha of req.compare.sha256s) {
    for (const x of catalog.labels.listLabelSets({ sha256: sha })) {
      if (x.readingStage !== 'final') continue
      if (x.recordCount + x.reviewIntervalCount > 0) liveFinal.add(sha)
      if (x.labelerId !== adj.id || x.guidelineVersion !== gv) others.add(`${cmp.files.find((f) => f.sha256 === sha)?.fileName ?? sha.slice(0, 12)} (${x.labelerId} · ${x.guidelineVersion})`)
    }
  }
  if (others.size > 0) {
    result.warnings.push(
      `다른 확정 세트가 이미 있습니다: ${[...others].join(', ')}. 파일마다 확정 세트가 둘이면 학습 데이터 내보내기가 고르지 못하니 한쪽을 지우거나 내보낼 때 직접 고르세요.`
    )
  }

  // 이번 저장으로 실제로 바뀌는 파일 (같은 결정을 다시 저장하면 바뀌는 것이 없다 — 잠금 확인·기록을 건너뜀)
  const prevById = new Map(prevRecords.map((r) => [r.uuid, r] as const))
  const prevIvById = new Map(prevIntervals.map((v) => [v.uuid, v] as const))
  const changedSha = new Set<string>()
  for (const r of result.records) {
    const p = prevById.get(r.uuid)
    if (!p || p.deleted || !sameLabelContent(p, r)) changedSha.add(r.sha256)
  }
  for (const v of result.reviewIntervals) {
    const p = prevIvById.get(v.uuid)
    if (!p || p.deleted || !sameLabelContent(p, v)) changedSha.add(v.sha256)
  }
  for (const u of result.removed.records) {
    const p = prevById.get(u)
    if (p && !p.deleted) changedSha.add(p.sha256)
  }
  // 원본에서 옮길 전문가 관측 확인이 바뀐 것도 정답이 바뀌는 것이다 (observationSync)
  for (const r of result.records) {
    if (!changedSha.has(r.sha256) && observationSync(catalog, r).changed) changedSha.add(r.sha256)
  }
  for (const u of result.removed.reviewIntervals) {
    const p = prevIvById.get(u)
    if (p && !p.deleted) changedSha.add(p.sha256)
  }

  // 잠긴 시험 세트: 그 파일에 살아 있는 확정 세트(누구 것이든)가 있고 이번에 바뀌면 이유·확인이 있어야 한다
  const lockedTestFiles: string[] = []
  const lockedSpecimens = new Set<string>()
  if (cmp.testLocked) {
    for (const f of cmp.files) {
      if (f.split === 'test' && (liveFinal.has(f.sha256) || (liveBySha.get(f.sha256) ?? 0) > 0) && changedSha.has(f.sha256)) {
        lockedTestFiles.push(f.sha256)
        if (f.specimenId) lockedSpecimens.add(f.specimenId)
      }
    }
  }
  const blockers: string[] = []
  if (result.undecided.length > 0) blockers.push(`결정하지 않은 행이 ${result.undecided.length}개 있습니다.`)
  const bad = result.rows.filter((r) => r.status === 'invalid')
  if (bad.length > 0) blockers.push(`행에 맞지 않는 결정이 ${bad.length}개 있습니다: ${bad.map((r) => r.rowId).join(', ')}`)
  const nothing = result.records.length === 0 && result.reviewIntervals.length === 0 && result.removed.records.length === 0 && result.removed.reviewIntervals.length === 0
  if (nothing) blockers.push('저장할 확정 기록·검토 구간이 없습니다.')
  const readers = new Set([req.compare.a.labelerId, req.compare.b.labelerId])
  const preview: ReviewFinalPreview = {
    rowsKey: cmp.rowsKey,
    adjudicator: adj,
    adjudicatorIsLevel3: isLevel3Qualification(adj.qualification),
    adjudicatorIsReader: readers.has(adj.id),
    guidelineVersion: gv,
    result,
    previousRecords: prevRecords.filter((r) => !r.deleted).length,
    designDefects: defects.filter((d) => !d.deleted).length,
    lockedTestFiles,
    canSave: blockers.length === 0,
    blockers
  }
  return { preview, comparison: cmp, finalSets, lockedSpecimens: [...lockedSpecimens].sort() }
}

/**
 * 확정 기록의 관측 행 맞추기: 원본 기록(adjudication.sourceRecord)의 전문가 관측 확인(expertConfirmed) 행을 확정 기록 UUID 로 옮긴다
 * ('설계값 대조 시작'과 같은 규칙 — 그래야 학습 내보내기가 전문가가 바꾼 레그 상태를 쓴다). 확정 세트의 관측 행은 앱에서 고치지 않으므로
 * (guardSet) 저장할 때마다 원본에 맞춘다: 원본에서 확인을 거둔 행은 지움 표시(stale). 위치를 바꾼 합침은 derive 가 투영 차이로 '관측 낡음' 처리한다.
 * rows = 저장할 행(있던 행이면 그 versions 를 이어 받음), changed = 저장하면 실제로 바뀌는 것이 있나.
 */
function observationSync(catalog: Catalog, rec: IndicationRecord): { rows: ObservationRow[]; stale: ObservationRow[]; changed: boolean } {
  const src = hasAdjudication(rec) ? rec.adjudication.sourceRecord : null
  const want = src ? catalog.labels.listObservations({ recordUuids: [src] }).filter((o) => o.expertConfirmed) : []
  const have = new Map<string, ObservationRow>(catalog.labels.listObservations({ recordUuids: [rec.uuid], includeDeleted: true }).map((o) => [`${o.groupId}|${o.leg}`, o]))
  const rows: ObservationRow[] = []
  const wanted = new Set<string>()
  let changed = false
  for (const o of want) {
    const k = `${o.groupId}|${o.leg}`
    wanted.add(k)
    const prev = have.get(k)
    const row: ObservationRow = {
      ...(JSON.parse(JSON.stringify(o)) as ObservationRow),
      recordUuid: rec.uuid,
      revision: prev?.revision ?? 1,
      versions: prev ? prev.versions : [],
      deleted: false,
      pcId: prev?.pcId ?? null
    }
    if (!prev || !sameLabelContent(prev, row)) changed = true
    rows.push(row)
  }
  const stale = [...have.entries()].filter(([k, o]) => !o.deleted && !wanted.has(k)).map(([, o]) => o)
  if (stale.length > 0) changed = true
  return { rows, stale, changed }
}

function emptyCounts(): ReviewSaveCounts {
  return { created: 0, updated: 0, unchanged: 0, removed: 0 }
}

/** 지금 라벨러 정보로 확인 사항(Level III·잠긴 시험 세트)을 보고 저장한다. 한 트랜잭션 */
export function saveFinal(
  catalog: Catalog,
  plan: FinalPlan,
  ctx: LabelWriteContext & { pcId: string; versionSlot: string; now: string },
  options: ReviewFinalSaveOptions = {}
): ReviewFinalSaveResult {
  const p = plan.preview
  if (!p.canSave) invalid(`확정 세트를 저장할 수 없습니다: ${p.blockers.join(' ')}`)
  const adj = p.adjudicator!
  if (!p.adjudicatorIsLevel3 && options.confirmNotLevel3 !== true) {
    throw new AppError(
      'CONFLICT',
      `지금 라벨러 ${adj.name} (${adj.id}) 의 자격(${adj.qualification ?? '적지 않음'})이 Level III 가 아닙니다. 확정은 Level III 몫입니다 — 그래도 저장하려면 확인하세요.`
    )
  }
  const reason = typeof options.reason === 'string' ? options.reason.normalize('NFC').trim().slice(0, NOTE_MAX) : ''
  if (p.lockedTestFiles.length > 0 && (options.confirmLockedTest !== true || reason === '')) {
    throw new AppError(
      'CONFLICT',
      `시험 세트가 잠겨 있고 이 파일 ${p.lockedTestFiles.length}개에는 이미 확정 세트(시험 정답)가 있습니다. 바꾸려면 이유를 적고 한 번 더 확인하세요(분할 기록에 남습니다).`
    )
  }
  const r = p.result
  const records = emptyCounts()
  const intervals = emptyCounts()
  const observations = emptyCounts()
  const warnings = new Set<string>()
  const note = (ws: readonly string[]): void => {
    for (const w of ws) if (!w.includes('adjudication')) warnings.add(w)
  }
  const write: LabelWriteContext = { pcId: ctx.pcId, versionSlot: ctx.versionSlot }
  let regrouped = 0
  catalog.transaction(() => {
    for (const rec of r.records) {
      const before = catalog.labels.getRecord(rec.uuid)
      const out = saveLabelRecord(catalog, rec, { ...write, releaseReviews: false })
      note(out.warnings)
      if (!out.changed) records.unchanged++
      else if (before) records.updated++
      else records.created++
    }
    // 원본 기록의 전문가 관측 확인을 확정 기록으로 옮긴다 (observationSync)
    for (const rec of r.records) {
      const sync = observationSync(catalog, rec)
      for (const row of sync.rows) {
        const out = catalog.labels.saveObservation(row, write)
        if (!out.changed) observations.unchanged++
        else if (row.versions.length > 0) observations.updated++
        else observations.created++
      }
      for (const o of sync.stale) {
        if (catalog.labels.deleteObservation(o.recordUuid, o.groupId, o.leg, write).changed) observations.removed++
      }
    }
    for (const uuid of r.removed.records) {
      if (deleteLabelRecord(catalog, uuid, { ...write, releaseReviews: false }).changed) records.removed++
    }
    for (const v of r.reviewIntervals) {
      const before = catalog.labels.getReviewInterval(v.uuid)
      const out = catalog.labels.saveReviewInterval(v, write)
      note(out.warnings)
      if (!out.changed) intervals.unchanged++
      else if (before) intervals.updated++
      else intervals.created++
    }
    for (const uuid of r.removed.reviewIntervals) {
      if (catalog.labels.deleteReviewInterval(uuid, write).changed) intervals.removed++
    }
    const seen = new Set<string>()
    for (const k of [...r.labelSets, ...plan.finalSets]) {
      const id = labelSetId(k)
      if (seen.has(id)) continue
      seen.add(id)
      regrouped += recomputeGrouping(catalog, k).changed.length
    }
  })

  // 잠긴 시험 세트의 정답을 바꿨으면 분할 기록에 남긴다 (DB 트랜잭션 뒤 — 분할은 label_meta 한 칸)
  const lockedLog: string[] = []
  if (plan.lockedSpecimens.length > 0) {
    const st = readSplitState(catalog.dbPath)
    for (const sp of plan.lockedSpecimens) {
      st.log.push({
        at: ctx.now,
        pcId: ctx.pcId,
        labelerId: adj.id,
        action: 'locked-change',
        specimenId: sp,
        from: 'test',
        to: 'test',
        reason: `확정 세트(시험 정답)를 다시 저장 — ${reason}`
      })
      lockedLog.push(sp)
    }
    if (st.log.length > 1000) st.log.splice(0, st.log.length - 1000)
    writeSplitState(catalog.dbPath, st)
  }
  for (const w of r.warnings) warnings.add(w)
  return {
    savedAt: ctx.now,
    labelSets: r.labelSets,
    records,
    reviewIntervals: intervals,
    observations,
    regrouped,
    lockedLog,
    warnings: [...warnings]
  }
}

// ───────────────────────────── CSV ─────────────────────────────

const CSV_KIND_NAME: Readonly<Record<ReviewCsvKind, string>> = {
  comparison: '쌍판정표',
  design: '설계값대조',
  report: '평가보고서'
}

/** 파일 이름 조각 (윈도우·맥에서 쓸 수 없는 글자·공백 → '_', 40자까지) — 라벨러 ID 를 기본 파일 이름에 넣을 때 */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)
}

/** 저장 대화상자 기본 이름: '검수_쌍판정표_kim-l2-vs-lee-l2_20261006-1530_pc-1a2b3c4d.csv' */
export function reviewCsvFileName(req: ReviewCsvRequest, stamp: string, pcId: string): string {
  return `검수_${CSV_KIND_NAME[req.kind]}_${safeName(req.compare.a.labelerId)}-vs-${safeName(req.compare.b.labelerId)}_${stamp}_${pcId}.csv`
}

/** CSV 글자 만들기 (저장소에서 다시 계산). adj 는 final 이 있을 때만 쓴다 */
export function reviewCsvText(
  catalog: Catalog,
  req: ReviewCsvRequest,
  adj: LabelerInfo | null,
  ctx: { pcId: string; now: string }
): { text: string; rows: number } {
  let comparison: ReviewComparison
  let plan: FinalPlan | null = null
  if (req.final) {
    if (!adj) invalid('지금 라벨러를 먼저 고르세요 (확정 세트의 라벨러가 됩니다).')
    plan = planFinal(catalog, { ...req.final, compare: req.compare }, adj, ctx)
    comparison = plan.comparison
  } else {
    comparison = runCompare(catalog, req.compare)
  }
  const c = comparison.comparison
  if (req.kind === 'comparison') return { text: comparisonRowsCsv(c), rows: c.rows.length }
  const design = plan?.preview.result.designCheck ?? null
  if (req.kind === 'design') {
    if (!design) invalid('이 시편들에 물리 결함(설계값)이 없어 설계값 대조 표를 만들 수 없습니다.')
    return { text: designCheckCsv(design), rows: design.rows.length }
  }
  const h = req.header ?? {}
  const header: ReportHeaderInput = {
    ...h,
    testSetLockedAt: h.testSetLockedAt ?? comparison.testLockedAt,
    guidelineVersion: h.guidelineVersion ?? req.compare.a.guidelineVersion
  }
  const report = buildEvaluationReport({ comparison: c, header, design, sensitivity: req.sensitivity !== false ? sensitivityGrid(c) : null })
  const textOut = evaluationReportCsv(report)
  const lines = textOut.split(/\r?\n/).filter((x) => x.replace(/^﻿/, '').trim() !== '').length
  return { text: textOut, rows: lines }
}
