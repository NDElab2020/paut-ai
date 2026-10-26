/**
 * 라벨 세션 보관 (renderer/src/labeling/session.ts) — 이전·다음 파일(X9, [ ])로 빠르게 넘겨도 저장하지 않은 초안이 사라지지 않는지:
 *  - 깨끗한 세션은 16개를 넘으면 오래된 것부터 버린다 (예전과 같음)
 *  - 초안(점·사각형·R·검토 구간)이 있는 세션, 고치던 기록·찍기 시작한 새 기록이 있는 패널은 16개를 넘어도 남는다
 *  - 그런 세션만 64개를 넘으면 그때 오래된 것부터 (메모리 상한)
 */
import { afterEach, describe, expect, it } from 'vitest'

// 렌더러 모듈은 tsconfig.node.json 범위 밖이라 정적 import 를 못 쓴다 (state.test.ts 와 같은 방식)
interface LabelStateLike {
  ui: Record<string, unknown>
  draft: { points: unknown[]; rect: unknown; ref: unknown; review: unknown }
  history: unknown[]
}
interface PanelStateLike {
  editingUuid: string | null
  snapshot: unknown
  echoEdit: unknown
  [k: string]: unknown
}
const SESSION = '../../src/renderer/src/labeling/session'
const STATE = '../../src/renderer/src/labeling/state'
const PANEL = '../../src/renderer/src/labeling/panelState'
const S = (await import(SESSION)) as {
  LABEL_SESSION_MAX: number
  LABEL_SESSION_HARD_MAX: number
  labelSessionGet: (k: string) => LabelStateLike | null
  labelSessionSet: (k: string, s: LabelStateLike) => void
  panelSessionGet: (k: string) => PanelStateLike | null
  panelSessionSet: (k: string, s: PanelStateLike) => void
  clearLabelSession: () => void
  isDirtyLabelState: (s: LabelStateLike) => boolean
  isDirtyPanelState: (s: PanelStateLike) => boolean
}
const ST = (await import(STATE)) as { initialLabelState: (open?: boolean) => LabelStateLike }
const PS = (await import(PANEL)) as { initialPanelState: () => PanelStateLike }

const clean = (): LabelStateLike => ST.initialLabelState()
const dirty = (): LabelStateLike => {
  const s = ST.initialLabelState()
  return { ...s, draft: { ...s.draft, points: [{ id: 'p1' }] } }
}

afterEach(() => S.clearLabelSession())

describe('라벨 세션 보관 (X9 — 초안을 말없이 버리지 않음)', () => {
  it('깨끗한 세션은 16개를 넘으면 가장 오래된 것부터 버린다', () => {
    for (let i = 0; i < S.LABEL_SESSION_MAX + 2; i++) S.labelSessionSet(`k${i}`, clean())
    expect(S.labelSessionGet('k0')).toBeNull()
    expect(S.labelSessionGet('k1')).toBeNull()
    expect(S.labelSessionGet('k2')).not.toBeNull()
  })

  it('초안이 있는 세션은 뒤에 17개 넘게 열어도 남는다 (깨끗한 것을 먼저 버림)', () => {
    S.labelSessionSet('draft', dirty())
    for (let i = 0; i < S.LABEL_SESSION_MAX + 5; i++) S.labelSessionSet(`k${i}`, clean())
    expect(S.labelSessionGet('draft')!.draft.points).toHaveLength(1)
    expect(S.labelSessionGet('k0')).toBeNull()
  })

  it('초안 있는 세션만 64개를 넘으면 그때 가장 오래된 것부터', () => {
    for (let i = 0; i < S.LABEL_SESSION_HARD_MAX + 1; i++) S.labelSessionSet(`d${i}`, dirty())
    expect(S.labelSessionGet('d0')).toBeNull()
    expect(S.labelSessionGet('d1')).not.toBeNull()
    expect(S.labelSessionGet(`d${S.LABEL_SESSION_HARD_MAX}`)).not.toBeNull()
  })

  it('패널: 고치던 기록·찍기 시작한 새 기록(스냅샷)은 남고, 기본 패널은 버린다', () => {
    const base = PS.initialPanelState()
    expect(S.isDirtyPanelState(base)).toBe(false)
    S.panelSessionSet('edit', { ...base, editingUuid: 'u1' })
    S.panelSessionSet('snap', { ...base, snapshot: { format: 'paut-label-view' } })
    for (let i = 0; i < S.LABEL_SESSION_MAX + 3; i++) S.panelSessionSet(`p${i}`, base)
    expect(S.panelSessionGet('edit')!.editingUuid).toBe('u1')
    expect(S.panelSessionGet('snap')!.snapshot).not.toBeNull()
    expect(S.panelSessionGet('p0')).toBeNull()
  })

  it('isDirtyLabelState = 저장하지 않은 초안이 있음', () => {
    expect(S.isDirtyLabelState(clean())).toBe(false)
    expect(S.isDirtyLabelState(dirty())).toBe(true)
  })
})
