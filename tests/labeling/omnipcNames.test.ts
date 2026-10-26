/**
 * OmniPC 조사 반영 (라벨 패널 쪽, OmniPC_조사/조사_보고.md 6절):
 *  - N1 길이 이름 = S(m−r) (OmniPC 측정값의 S = 스캔축, U = 초음파축) — 길이 도구 설명·단축키 표에 U(m−r) 가 남지 않는다
 *  - X2 신호 줄: Ref 근거가 'single-depth'(TCG 없음)면 'Ref 근거 약함(TCG 없음)', 기준 이득이 없으면 'Ref 없음' (기록 칸은 그대로)
 *  - X9 단축키 표에 [ · ] (이전·다음 파일)
 */
import { describe, expect, it } from 'vitest'
import type { SignalInfo } from '@shared/labels'

const TEXT = '../../src/renderer/src/labeling/recordText'
const STATE = '../../src/renderer/src/labeling/state'
const KEYS = '../../src/renderer/src/labeling/KeyHelp'
const T = (await import(TEXT)) as { signalText: (s: SignalInfo | null, est?: boolean, basis?: 'tcg' | 'single-depth' | 'none' | null) => string }
const S = (await import(STATE)) as { LABEL_TOOLS: ReadonlyArray<{ id: string; title: string }>; lengthFromRef: (r: { groupId: number; scanMm: number; beam: number } | null, mm: number) => number | null }
const K = (await import(KEYS)) as { LABEL_KEYS: ReadonlyArray<{ keys: string; what: string }> }

const sig = (over: Partial<SignalInfo> = {}): SignalInfo => ({
  maxAmplitudePct: 63.5,
  refDb: -8,
  refDbVerified: false,
  saturated: false,
  exceedsEvaluationLevel: true,
  exceedsRecordingLevel: true,
  peak: null,
  ...over
})

describe('길이 이름 S(m−r) (N1)', () => {
  it('길이 도구 설명·단축키 표는 S(m−r), U(m−r) 는 없다', () => {
    const length = S.LABEL_TOOLS.find((t) => t.id === 'length')!
    expect(length.title).toContain('S(m−r)')
    expect(length.title).not.toContain('U(m−r)')
    const all = K.LABEL_KEYS.map((k) => `${k.keys} ${k.what}`).join('\n')
    expect(all).toContain('S(m−r)')
    expect(all).not.toContain('U(m−r)')
  })

  it('계산은 그대로: S(m−r) = 현재 커서 − 기준 커서 R (OmniPC m − r 과 같은 부호)', () => {
    expect(S.lengthFromRef({ groupId: 0, scanMm: 30, beam: 3 }, 41.5)).toBe(11.5)
  })

  it('단축키 표에 [ · ] 이전·다음 파일 (X9)', () => {
    expect(K.LABEL_KEYS.some((k) => k.keys === '[ · ]' && k.what.includes('이전') && k.what.includes('다음'))).toBe(true)
  })
})

describe('신호 줄의 Ref 근거 (X2)', () => {
  it('TCG 근거면 지금과 같은 글자, TCG 없음이면 근거 약함, 기준 이득 없음이면 Ref 없음', () => {
    expect(T.signalText(sig())).toBe('63.5 %FSH · Ref −8.0 dB (대조 전)')
    expect(T.signalText(sig(), false, 'tcg')).toBe('63.5 %FSH · Ref −8.0 dB (대조 전)')
    expect(T.signalText(sig(), false, 'single-depth')).toBe('63.5 %FSH · Ref −8.0 dB (대조 전) · Ref 근거 약함(TCG 없음)')
    expect(T.signalText(sig({ refDb: null }), false, 'none')).toBe('63.5 %FSH · Ref 없음(기준 이득 0)')
    expect(T.signalText(sig({ saturated: true }), true, 'single-depth')).toBe('63.5 %FSH (추정 눈금) · Ref −8.0 dB (대조 전) · Ref 근거 약함(TCG 없음) · 포화')
    expect(T.signalText(null, false, 'single-depth')).toBe('—')
  })
})
