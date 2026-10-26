/** 정준 JSON + sha256 지문 */
import { createHash } from 'node:crypto'
import type { Fingerprint, ScanPlanSpec } from '@shared/types'

/** 지문 접두사 = 정규화 규칙 버전 (SPEC_VERSION 과 함께 올린다) */
export const FINGERPRINT_PREFIX = 'fp2:'

function canon(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : null
  if (typeof v === 'string' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map(canon)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      const val = (v as Record<string, unknown>)[k]
      if (val !== undefined) out[k] = canon(val)
    }
    return out
  }
  return null
}

/** 키 정렬·-0/NaN 정리된 정준 JSON 문자열 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canon(value))
}

export interface FingerprintResult {
  fingerprint: Fingerprint
  /** 지문 입력이 된 정준 JSON (차이 비교·디버깅용) */
  canonical: string
}

export function fingerprint(spec: ScanPlanSpec): FingerprintResult {
  const canonical = canonicalJson(spec)
  return { fingerprint: FINGERPRINT_PREFIX + createHash('sha256').update(canonical).digest('hex'), canonical }
}

/** FINGERPRINT_PREFIX + sha256(canonicalJson(spec)) */
export function computeFingerprint(spec: ScanPlanSpec): Fingerprint {
  return fingerprint(spec).fingerprint
}
