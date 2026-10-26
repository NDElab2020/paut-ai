import { describe, expect, it } from 'vitest'
import { amplitudeLevels, amplitudeTableOf, bumpVersions, compareVersions, mergeVersions, refPctFromSetup, versionTotal } from '@shared/labels'

describe('진폭 기준 (시방서 표 13) — levels.ts', () => {
  const X3_REF = refPctFromSetup(24.7, 18.7, 80)!

  it('X3 셋업으로 Ref ≈ 159.6 %FSH, 평가 기준(−14 dB) ≈ 31.8 %FSH (대조 전 추정)', () => {
    expect(X3_REF).toBeCloseTo(159.6, 1)
    expect(refPctFromSetup(20.4, 14.4, 80)).toBeCloseTo(X3_REF, 12) // Skew 270 도 같은 +6 dB
    expect(X3_REF * 10 ** (-14 / 20)).toBeCloseTo(31.8, 1)
    expect(refPctFromSetup(null, 18.7, 80)).toBeNull()
  })

  it('t ≥ 8: 평가 기준 −14 dB, 기록 기준 ℓ ≤ t 면 −8 dB · ℓ > t 면 −14 dB', () => {
    const at = (pct: number, len: number | null) => amplitudeLevels({ maxAmplitudePct: pct, refPct: X3_REF, lengthMm: len, thicknessMm: 12 })
    const weak = at(47, 10) // 약 −10.6 dB
    expect(weak.table).toBe('19285-L2')
    expect(weak.refDb).toBeCloseTo(20 * Math.log10(47 / X3_REF), 12)
    expect([weak.exceedsEvaluationLevel, weak.exceedsRecordingLevel]).toEqual([true, false]) // ℓ ≤ t → −8 dB 못 넘음
    expect(at(47, 20).exceedsRecordingLevel).toBe(true) // ℓ > t → −14 dB 넘음
    expect(at(25, 20).exceedsEvaluationLevel).toBe(false) // 약 −16.1 dB
    // 길이를 몰라도 두 기준을 다 넘거나 다 못 넘으면 정해진다
    expect(at(90, null).exceedsRecordingLevel).toBe(true)
    expect(at(25, null).exceedsRecordingLevel).toBe(false)
    expect(at(47, null).exceedsRecordingLevel).toBeNull()
  })

  it('3.2 ≤ t < 8: 평가·기록 기준 모두 −12 dB. 범위 밖 두께는 판정하지 않음', () => {
    const thin = amplitudeLevels({ maxAmplitudePct: 50, refPct: 100, lengthMm: 3, thicknessMm: 6.4 })
    expect(thin.table).toBe('4761-L2')
    expect([thin.evaluationLevelDb, thin.recordingLevelDb, thin.exceedsEvaluationLevel, thin.exceedsRecordingLevel]).toEqual([-12, -12, true, true])
    expect(amplitudeTableOf(20)).toBeNull()
    expect(amplitudeTableOf(2)).toBeNull()
    expect(amplitudeLevels({ maxAmplitudePct: 50, refPct: 100, lengthMm: 3, thicknessMm: 20 }).exceedsEvaluationLevel).toBeNull()
  })

  it('포화 진폭은 하한: 기준 이상이면 초과, 아니면 모름', () => {
    const sat = amplitudeLevels({ maxAmplitudePct: 200, refPct: X3_REF, lengthMm: 10, thicknessMm: 12, saturated: true })
    expect(sat.exceedsEvaluationLevel).toBe(true)
    expect(sat.exceedsRecordingLevel).toBe(true)
    const lowRef = amplitudeLevels({ maxAmplitudePct: 200, refPct: 10000, lengthMm: 10, thicknessMm: 12, saturated: true })
    expect(lowRef.exceedsEvaluationLevel).toBeNull()
  })
})

describe('병합 순서 (버전 벡터) — versions.ts', () => {
  it('한쪽이 다른 쪽을 포함하면 새것, 따로 고쳤으면 충돌', () => {
    const base = bumpVersions([], 'pc1') // pc1:1
    const pc1 = bumpVersions(bumpVersions(base, 'pc1'), 'pc1') // pc1:3
    const pc2 = bumpVersions(base, 'pc2') // pc1:1, pc2:1
    expect(compareVersions(pc1, base)).toBe('a-newer')
    expect(compareVersions(base, pc2)).toBe('b-newer')
    // revision 만 보면 pc1(3) 이 이기지만, pc2 의 수정은 pc1 에 없다 → 충돌
    expect(compareVersions(pc1, pc2)).toBe('conflict')
    expect(compareVersions(pc2, [...pc2].reverse())).toBe('same')
    expect(versionTotal(pc1)).toBe(3)
  })

  it('충돌을 풀면 두 벡터를 합친 위에 한 번 더 올린다 — 두 사본 모두를 포함', () => {
    const a = [{ pcId: 'pc1', edits: 3 }]
    const b = [
      { pcId: 'pc1', edits: 1 },
      { pcId: 'pc2', edits: 1 }
    ]
    const resolved = bumpVersions(mergeVersions(a, b), 'pc2')
    expect(resolved).toEqual([
      { pcId: 'pc1', edits: 3 },
      { pcId: 'pc2', edits: 2 }
    ])
    expect(compareVersions(resolved, a)).toBe('a-newer')
    expect(compareVersions(resolved, b)).toBe('a-newer')
  })
})
