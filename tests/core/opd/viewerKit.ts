/**
 * 이미지 보기·라벨 서비스 시험용: OPD 사본을 가진 임시 저장소를 만든다 (가져오기 파이프라인을 거치지 않고 catalog 에 바로 기록).
 * 원본은 복사만 한다(읽기 전용). 플랜·지문은 시험용 값이다 — 가져오기·지문 규칙과는 무관하게 이미지 보기·라벨 경로만 시험한다.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { openCatalog } from '@core/catalog'
import { SPEC_VERSION, type FileRecord } from '@shared/types'

export interface StoredOpd {
  source: string
  sha256: string
  storedRelPath: string
  specimenId: string
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** store 폴더에 catalog.db 를 만들고 OPD 파일들을 사본으로 넣는다 (store 는 없거나 비어 있어야 한다) */
export function createOpdStore(store: string, sources: readonly string[]): StoredOpd[] {
  mkdirSync(store, { recursive: true })
  const c = openCatalog(join(store, 'catalog.db'))
  const out: StoredOpd[] = []
  try {
    const plan = c.createPlan({
      fingerprint: `fp1:${createHash('sha256').update('opd-viewer-test-plan').digest('hex')}`,
      spec: {
        specVersion: SPEC_VERSION,
        specimen: { shape: 'plate', thicknessMm: null, outerRadiusMm: null, angularOpeningDeg: null, materialName: null, weld: null },
        groups: []
      },
      summary: 'OPD 시험 플랜',
      name: 'OPD 시험'
    })
    for (const [i, src] of sources.entries()) {
      const fileName = basename(src).normalize('NFC')
      const specimenId = fileName.replace(/\.opd$/i, '').replace(/[^0-9A-Za-z_-]/g, '_').slice(0, 40)
      c.ensureSpecimen({ id: specimenId, displayName: specimenId, source: 'manual' })
      const storedRelPath = `스캔플랜/${plan.id}/${specimenId}/${fileName}`
      const dest = join(store, ...storedRelPath.split('/'))
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
      const sha256 = sha256Of(dest)
      const rec: Omit<FileRecord, 'id'> = {
        planId: plan.id,
        specimenId,
        storedRelPath,
        storedFileName: fileName,
        meta: {
          sha256,
          sizeBytes: statSync(dest).size,
          sourcePath: src,
          sourceFileName: fileName,
          ndeVersion: { raw: 'OPD · MXU - 4.4R5', family: 'opd', major: 4, minor: 4, patch: 5, preRelease: null },
          deviceFileName: null,
          device: { platform: 'OmniScanMX2', model: 'OMNISX-PA1664PR', serialNumber: null, name: null },
          createdAt: null,
          modifiedAt: null,
          application: { name: 'MXU', version: '4.4R5' },
          scenario: null,
          reader: { name: 'opd-structure', version: 2 }
        },
        stateTag: null,
        tags: [],
        round: null,
        memo: '',
        acquisition: { groups: [], encoder: null, scanPattern: null },
        importBatchId: 'IMP-OPD-TEST',
        importedAt: `2026-10-07T10:00:0${i % 10}+09:00`
      }
      c.insertFile(rec)
      out.push({ source: src, sha256, storedRelPath, specimenId })
    }
  } finally {
    c.close()
  }
  return out
}
