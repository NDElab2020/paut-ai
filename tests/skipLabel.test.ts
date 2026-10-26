/** A·B-scan 스킵선 라벨 (renderer/viewer/AscanView.skipLabel) ↔ OmniPC 화면에서 읽은 글자 (fixtures/omnipc) */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 렌더러 TSX 는 tsconfig.node.json 범위 밖(--jsx 없음)이라 정적 import 를 못 쓴다. vitest 는 경로 문자열로도 읽는다
const ASCAN_VIEW = '../src/renderer/src/viewer/AscanView'
const { skipLabel } = (await import(ASCAN_VIEW)) as { skipLabel: (n: number) => string }

const FIX = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/omnipc/X3_12T-SV-01.json'), 'utf8')) as {
  ascan: { skipLabels: string[] }
}

describe('스킵선 라벨', () => {
  it('X3 12T-SV-01: 12·24·36 mm = B0·T1·B2 (OmniPC 캡처 글자)', () => {
    expect(FIX.ascan.skipLabels.map((_, i) => skipLabel(i + 1))).toEqual(FIX.ascan.skipLabels)
  })

  it('홀수 레그 끝 = 바닥 B, 짝수 = 표면 T, 번호 = 레그 − 1', () => {
    expect([4, 5, 6].map(skipLabel)).toEqual(['T3', 'B4', 'T5'])
  })
})
