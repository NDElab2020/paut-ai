/**
 * 검토 완료 구간을 풀지 정하는 규칙 (core/service/labels.ts releasesReviews):
 * 위치·길이·구분이 바뀔 때만 푼다 — 메모·속성·화면 스냅샷만 고친 것, 형상 에코 승인(새 형상 에코 기록)은 풀지 않는다. 새 결함 기록은 푼다.
 */
import { describe, expect, it } from 'vitest'
import { releasesReviews } from '@core/service/labels'
import { newIndicationRecord } from '@shared/labels/factory'

const base = newIndicationRecord({
  uuid: '00000000-0000-4000-8000-000000000001',
  sha256: 'a'.repeat(64),
  labelerId: 'kim-l2',
  guidelineVersion: 'v1',
  defectType: 'slag',
  derived: { scanStartMm: 10, scanEndMm: 20, vMinMm: -1, vMaxMm: 1, depthTopMm: 3, depthBottomMm: 5 },
  length: { valueMm: 10, method: 'eval-level' }
})

describe('검토 완료 구간 풀기 규칙', () => {
  it('새 기록: 결함이면 풀고 형상 에코·형상 불완전은 풀지 않는다', () => {
    expect(releasesReviews(null, base)).toBe(true)
    expect(releasesReviews(null, { ...base, kind: 'geometric-echo', defectType: null, geometricEcho: { kind: 'root', fromSuggestion: true } })).toBe(false)
    expect(releasesReviews(null, { ...base, kind: 'geometric-imperfection', defectType: null })).toBe(false)
  })

  it('고치기: 메모·속성·스냅샷만 바꾸면 풀지 않고, 위치·길이·구분이 바뀌면 푼다', () => {
    expect(releasesReviews(base, { ...base, note: '메모', existenceConfidence: 'uncertain', viewSnapshot: { x: 1 }, defectType: 'porosity-single' })).toBe(false)
    expect(releasesReviews(base, { ...base, derived: { ...base.derived, scanEndMm: 25 } })).toBe(true)
    expect(releasesReviews(base, { ...base, length: { ...base.length, valueMm: 12 } })).toBe(true)
    expect(releasesReviews(base, { ...base, kind: 'geometric-echo' })).toBe(true)
    expect(releasesReviews(base, { ...base, deleted: true })).toBe(true)
  })
})
