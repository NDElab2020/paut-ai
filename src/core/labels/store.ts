/**
 * 라벨 저장 규칙 래퍼 — catalog.labels 위에 앱 규칙을 얹는다.
 * - 기록을 만들거나 고치거나 지우면, 같은 라벨 세트의 '검토 완료' 구간 가운데 그 기록과 겹치는 것을 자동으로 푼다(released).
 *   (types.ts ReviewInterval: 검토 뒤 그 구간 기록을 고치면 앱이 이 구간을 풀어 준다)
 * - 기록을 지우면 그 기록의 관측 행도 함께 지움 표시한다(관측 행은 기록 UUID 로만 이어지므로 남으면 다른 지시에 섞일 수 있다).
 * - 그룹 짓기(shared/labels/grouping.ts)를 다시 계산해 groupingId 가 바뀐 기록만 쓴다(검토 구간은 풀지 않음).
 *   groupingId 는 앱 계산 칸이라 버전을 올리지 않는다(catalog.labels.setRecordGrouping). 두 PC 의 두께 출처가 달라
 *   다르게 계산돼도 병합 충돌이 되지 않는다(sameLabelContent 가 이 칸을 뺀다).
 */
import { randomUUID } from 'node:crypto'
import type { Catalog, LabelSaveResult, LabelWriteContext } from '@core/catalog'
import { computeGrouping, groupingParams, type GroupingParams, type GroupingResult } from '@shared/labels/grouping'
import type { IndicationRecord, LabelSetKey, ReviewInterval } from '@shared/labels/types'

/** 새 기록 UUID (소문자 8-4-4-4-12) */
export function newLabelUuid(): string {
  return randomUUID()
}

export interface RecordSaveOptions extends LabelWriteContext {
  /** 겹치는 검토 완료 구간을 풀지 (기본 true) */
  releaseReviews?: boolean
}

export interface RecordSaveOutcome extends LabelSaveResult<IndicationRecord> {
  /** 이번 저장으로 자동으로 풀린 검토 완료 구간 */
  releasedReviews: ReviewInterval[]
}

/** 기록이 걸친 그룹 번호 (앵커·길이·최대 진폭). 모르면 빈 목록 */
function recordGroups(r: IndicationRecord): Set<number> {
  const g = new Set<number>()
  for (const p of r.anchors) g.add(p.anchor.groupId)
  if (r.length.groupId !== null) g.add(r.length.groupId)
  if (r.signal.peak?.groupId !== null && r.signal.peak?.groupId !== undefined) g.add(r.signal.peak.groupId)
  return g
}

function touches(v: ReviewInterval, rs: readonly IndicationRecord[]): boolean {
  for (const r of rs) {
    const s = Math.min(r.derived.scanStartMm, r.derived.scanEndMm)
    const e = Math.max(r.derived.scanStartMm, r.derived.scanEndMm)
    if (s > v.scanEndMm || e < v.scanStartMm) continue
    if (v.groupId === null) return true
    const g = recordGroups(r)
    if (g.size === 0 || g.has(v.groupId)) return true
  }
  return false
}

/** 같은 세트의 검토 완료 구간 가운데 기록(고치기 전·후)과 겹치는 것을 푼다 */
function releaseOverlapping(catalog: Catalog, rs: readonly IndicationRecord[], ctx: LabelWriteContext): ReviewInterval[] {
  const first = rs[0]
  if (!first) return []
  const set: LabelSetKey = first
  const out: ReviewInterval[] = []
  for (const v of catalog.labels.listReviewIntervals({ set, kind: 'reviewed', includeReleased: false })) {
    if (!touches(v, rs)) continue
    out.push(catalog.labels.saveReviewInterval({ ...v, released: true }, ctx).value)
  }
  return out
}

/** 기록 저장(새로 만들기·고치기) + 겹치는 검토 완료 구간 풀기. 한 트랜잭션 */
export function saveLabelRecord(catalog: Catalog, record: IndicationRecord, opts: RecordSaveOptions): RecordSaveOutcome {
  return catalog.transaction(() => {
    const before = catalog.labels.getRecord(record.uuid)
    const saved = catalog.labels.saveRecord(record, opts)
    const releasedReviews =
      saved.changed && opts.releaseReviews !== false ? releaseOverlapping(catalog, before ? [before, saved.value] : [saved.value], opts) : []
    return { ...saved, releasedReviews }
  })
}

/** 그 기록의 살아 있는 관측 행을 지움 표시한다 */
export function tombstoneObservations(catalog: Catalog, recordUuid: string, ctx: LabelWriteContext): number {
  let n = 0
  for (const o of catalog.labels.listObservations({ recordUuids: [recordUuid] })) {
    if (catalog.labels.deleteObservation(o.recordUuid, o.groupId, o.leg, ctx).changed) n++
  }
  return n
}

/** 기록 삭제 표시 + 그 관측 행 지움 표시 + 겹치는 검토 완료 구간 풀기 */
export function deleteLabelRecord(catalog: Catalog, uuid: string, opts: RecordSaveOptions): RecordSaveOutcome {
  return catalog.transaction(() => {
    const saved = catalog.labels.deleteRecord(uuid, opts)
    if (saved.changed) tombstoneObservations(catalog, uuid, opts)
    const releasedReviews = saved.changed && opts.releaseReviews !== false ? releaseOverlapping(catalog, [saved.value], opts) : []
    return { ...saved, releasedReviews }
  })
}

/**
 * 판 두께 t (mm): 파일 정렬의 두께 → 그 파일 스캔플랜의 시편 두께 → 모름(null).
 * 파일 정렬이 실측값이라 앞선다.
 */
export function thicknessForFile(catalog: Catalog, sha256: string): number | null {
  const a = catalog.labels.getFileAlignment(sha256)
  if (a && !a.deleted && a.thicknessMm !== null) return a.thicknessMm
  const f = catalog.findFileBySha256(sha256)
  if (!f) return null
  const t = catalog.getPlan(f.planId)?.spec.specimen.thicknessMm
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null
}

export interface RegroupOutcome {
  result: GroupingResult
  /** groupingId 가 바뀌어 쓴 기록 (버전은 그대로) */
  changed: IndicationRecord[]
  thicknessMm: number | null
}

/**
 * 한 라벨 세트의 그룹 짓기를 다시 계산하고 groupingId 가 바뀐 기록만 저장한다(한 트랜잭션).
 * 삭제 표시된 기록은 건드리지 않는다. 두께는 인자 → 파일 정렬 → 스캔플랜 순서.
 */
export function recomputeGrouping(
  catalog: Catalog,
  set: LabelSetKey,
  opts: { thicknessMm?: number | null; params?: Partial<Omit<GroupingParams, 'thicknessMm'>> } = {}
): RegroupOutcome {
  return catalog.transaction(() => {
    const t = opts.thicknessMm !== undefined && opts.thicknessMm !== null ? opts.thicknessMm : thicknessForFile(catalog, set.sha256)
    const records = catalog.labels.listRecords({ set, includeDeleted: true })
    const result = computeGrouping(records, groupingParams({ ...opts.params, thicknessMm: t }))
    const changed: IndicationRecord[] = []
    for (const r of records) {
      if (r.deleted) continue
      const id = result.assignments[r.uuid] ?? null
      if (r.groupingId === id) continue
      if (catalog.labels.setRecordGrouping(r.uuid, id)) changed.push(catalog.labels.getRecord(r.uuid)!)
    }
    return { result, changed, thicknessMm: t }
  })
}
