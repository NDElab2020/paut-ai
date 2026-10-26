import { randomBytes } from 'node:crypto'
import type { ImportBatchId } from '@shared/types'

const pad = (n: number): string => String(n).padStart(2, '0')

function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 'IMP-YYYYMMDD-HHmmss-xxxx' (로컬 시각) */
export function newBatchId(now: Date = new Date()): ImportBatchId {
  return `IMP-${stamp(now)}-${randomBytes(2).toString('hex')}`
}

/** 'PV-YYYYMMDD-HHmmss-xxxxxx' */
export function newPreviewId(now: Date = new Date()): string {
  return `PV-${stamp(now)}-${randomBytes(3).toString('hex')}`
}

/** 미리보기 항목 ID 'i0001' */
export function itemIdOf(index: number): string {
  return `i${String(index + 1).padStart(4, '0')}`
}
