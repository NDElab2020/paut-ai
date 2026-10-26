import { createHash } from 'node:crypto'
import type { NewFileRecord, NewPlanInput } from '@core/catalog'
import type { ScanPlanSpec } from '@shared/types'

export function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export function makeSpec(thicknessMm: number): ScanPlanSpec {
  return {
    specVersion: 1,
    specimen: {
      shape: 'plate',
      thicknessMm,
      outerRadiusMm: null,
      angularOpeningDeg: null,
      materialName: 'Steel',
      weld: null
    },
    groups: []
  }
}

export function makePlan(thicknessMm: number, name = ''): NewPlanInput {
  return { fingerprint: `fp1:${sha(`plan-${thicknessMm}`)}`, spec: makeSpec(thicknessMm), summary: `판 ${thicknessMm} mm`, name }
}

export function makeFile(
  key: string,
  planId: string,
  specimenId: string,
  over: Partial<NewFileRecord> & { sourceFileName?: string; deviceFileName?: string | null } = {}
): NewFileRecord {
  const fileName = over.sourceFileName ?? `${key}.nde`
  return {
    planId,
    specimenId,
    storedRelPath: over.storedRelPath ?? `스캔플랜/${planId}/${specimenId}/${fileName}`,
    storedFileName: over.storedFileName ?? fileName,
    meta: {
      sha256: sha(key),
      sizeBytes: 1000,
      sourcePath: `/src/${fileName}`,
      sourceFileName: fileName,
      ndeVersion: { raw: '3.3.0', family: '3.x', major: 3, minor: 3, patch: 0, preRelease: null },
      deviceFileName: over.deviceFileName === undefined ? null : over.deviceFileName,
      device: { platform: 'OmniScanX3', model: 'Freedom_32x128', serialNumber: 'QC-1', name: 'MXU' },
      createdAt: '2024-09-03T10:32:26+09:00',
      modifiedAt: null,
      application: { name: 'OmniScan', version: '5.x' },
      scenario: 'General Weld'
    },
    stateTag: over.stateTag ?? null,
    tags: over.tags ?? [],
    round: over.round ?? null,
    memo: over.memo ?? '',
    acquisition: { groups: [], encoder: null, scanPattern: null },
    importBatchId: over.importBatchId ?? 'IMP-1',
    importedAt: over.importedAt ?? '2026-10-02T10:00:00+09:00'
  }
}
