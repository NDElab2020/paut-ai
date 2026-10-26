/** 라벨 저장소 테스트 시료 */
import { createHash } from 'node:crypto'
import { openCatalog, type Catalog } from '@core/catalog'
import {
  newFileAlignment,
  newIndicationRecord,
  newObservationRow,
  newPhysicalDefect,
  newReviewInterval,
  newWorkEvent,
  type NewRecordInit
} from '@shared/labels/factory'
import type { DesignValues, FileAlignment, IndicationRecord, ObservationRow, PhysicalDefect, ReviewInterval, WorkEvent } from '@shared/labels/types'

export const SHA_A = 'a3f1'.repeat(16)
export const SHA_B = '0b9e'.repeat(16)

export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** 1초씩 가는 고정 시계 */
export function fakeClock(start = '2026-10-06T09:00:00+09:00'): () => string {
  let n = 0
  const base = Date.parse(start)
  return () => {
    const d = new Date(base + n++ * 1000)
    const pad = (x: number): string => String(x).padStart(2, '0')
    // +09:00 고정
    const k = new Date(d.getTime() + 9 * 3600 * 1000)
    return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}T${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:${pad(k.getUTCSeconds())}+09:00`
  }
}

export function memCatalog(): Catalog {
  return openCatalog(':memory:', { now: fakeClock() })
}

/** 엑셀에서 온 결함 기록 (앵커 없음) */
export function rec(n: number, over: Partial<NewRecordInit> = {}): IndicationRecord {
  return newIndicationRecord({
    uuid: uuid(n),
    sha256: SHA_A,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    readingStage: 'blind',
    defectType: 'slag',
    character: { value: 'volumetric' },
    derived: { scanStartMm: 10 * n, scanEndMm: 10 * n + 5, depthTopMm: 4, depthBottomMm: 5 },
    ...over
  } as NewRecordInit)
}

export function review(n: number, over: Partial<ReviewInterval> = {}): ReviewInterval {
  return newReviewInterval({
    uuid: uuid(1000 + n),
    sha256: SHA_A,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    kind: 'reviewed',
    scanStartMm: 0,
    scanEndMm: 100,
    gate: { depthTopMm: 7, depthBottomMm: 28, legMin: 1, legMax: 3 },
    ...over
  })
}

export function obs(recordN: number, groupId: number, leg: number, over: Partial<ObservationRow> = {}): ObservationRow {
  return newObservationRow({ recordUuid: uuid(recordN), groupId, leg, ...over })
}

export function alignment(over: Partial<FileAlignment> = {}): FileAlignment {
  return newFileAlignment({ sha256: SHA_A, fileName: '12T-SV-01.nde', specimenId: 'TP01', thicknessMm: 12, ...over })
}

export function defect(id: string, over: Partial<Omit<PhysicalDefect, 'design'>> & { design?: Partial<DesignValues> } = {}): PhysicalDefect {
  return newPhysicalDefect({ id, specimenId: 'TP01', source: 'design-drawing', confirmation: 'design-only', ...over })
}

export function event(n: number, over: Partial<WorkEvent> = {}): WorkEvent {
  return newWorkEvent({
    uuid: uuid(5000 + n),
    sessionId: 's1',
    labelerId: 'kim',
    kind: 'file-open',
    sha256: SHA_A,
    at: '2026-10-06T10:00:00+09:00',
    ...over
  })
}
