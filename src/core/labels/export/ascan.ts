/**
 * A-scan 라벨 (ascan.json): 구간(spans)과 A-scan 하나하나의 세 상태.
 * 상태는 shared/labels/derive ascanLabelAt 규칙 그대로다. 그 함수가 장면·구간 목록을 처음부터 훑으므로,
 * 스캔 칸마다 그 칸의 장면·구간만 담은 계산 결과 사본을 넘겨 같은 답을 빨리 얻는다.
 *
 * 그룹마다
 *   states                글자 하나가 A-scan 하나 (스캔 순, 그 안에서 빔 순 — 길이 = 스캔 수 × 빔 수)
 *                         P 양성 · W 약한 양성 · I 무시 · N 음성 · U 모름(검토 안 함) — 원래 상태 (ascanLabelAt)
 *   trainStates           같은 자리의 학습 상태: 구간의 trainStatus(약한 양성 → weakAs, 계산만 한 관측 → unconfirmedObservation)로 다시 정한 것.
 *                         그림·COCO·YOLO 와 같은 기준이다 (기본 학습은 이것을 쓴다)
 *   negativeRegions       음성이 성립하는 샘플 구간 [lo[b], hi[b]] — 검토 게이트(펼친 깊이)마다 하나 (ascanLabelAt 의 negativeRange 와 같은 규칙)
 *   sceneNegativeRegion   스캔 칸마다 negativeRegions 번호 (-1 = 검토하지 않음). 음성(N) A-scan 의 음성 구간은 이것으로 찾는다
 * ignore: 가릴 샘플 구간이 있는 A-scan 만 (그룹, 스캔, 빔, [[시작, 끝], …]) — 무시 객체의 창, 결함 객체 창에서 구간을 뺀 나머지
 */
import { ascanLabelAt, type AscanSpan, type DeriveRun, type NegativeRegion, type SceneLabel, type SceneState } from '@shared/labels/derive'

export const ASCAN_STATE_CODE: Readonly<Record<SceneState, string>> = {
  positive: 'P',
  weak: 'W',
  ignore: 'I',
  negative: 'N',
  unknown: 'U'
}

export interface AscanGroupLabels {
  groupId: number
  scanCount: number
  beamCount: number
  sampleCount: number
  states: string
  trainStates: string
  negativeRegions: Array<{ region: NegativeRegion; lo: number[]; hi: number[] }>
  sceneNegativeRegion: number[]
  counts: Record<SceneState, number>
  trainCounts: Record<SceneState, number>
}

/**
 * A-scan 하나의 학습 상태: 원래 상태가 양성·약한 양성이면 그 결함 구간들의 학습 상태(trainStatus)로 다시 정한다
 * (양성 구간이 있으면 양성, 약한 양성만 있으면 약한 양성, 모두 무시로 바뀌었으면 무시). 그 밖의 상태는 그대로.
 */
export function ascanTrainState(state: SceneState, spans: readonly AscanSpan[], isDefect: (s: AscanSpan) => boolean): SceneState {
  if (state !== 'positive' && state !== 'weak') return state
  const own = spans.filter(isDefect)
  if (own.some((s) => s.trainStatus === 'positive')) return 'positive'
  if (own.some((s) => s.trainStatus === 'weak')) return 'weak'
  return 'ignore'
}

export interface AscanIgnore {
  groupId: number
  scanIndex: number
  beam: number
  ranges: Array<[number, number]>
}

export interface AscanLabels {
  groups: AscanGroupLabels[]
  spans: AscanSpan[]
  ignore: AscanIgnore[]
}

function regionKey(r: NegativeRegion): string {
  return `${r.legMin}|${r.legMax}|${r.depthTopMm}|${r.depthBottomMm}`
}

/** 막히지 않은 그룹들의 A-scan 라벨 */
export function ascanLabels(run: DeriveRun, groupIds: readonly number[]): AscanLabels {
  const out: AscanLabels = { groups: [], spans: run.result.ascanSpans.filter((s) => groupIds.includes(s.groupId)), ignore: [] }
  for (const gid of groupIds) {
    const pg = run.ctx.groups.find((g) => g.id === gid)
    if (!pg || !pg.geom || pg.blocked) continue
    const geom = pg.geom
    const [ns, nb] = pg.amp.shape
    const scenes = new Map<number, SceneLabel>()
    for (const s of run.result.scenes) if (s.groupId === gid) scenes.set(s.scanIndex, s)
    const spansAt = new Map<number, AscanSpan[]>()
    for (const s of run.result.ascanSpans) {
      if (s.groupId !== gid) continue
      const list = spansAt.get(s.scanIndex) ?? []
      list.push(s)
      spansAt.set(s.scanIndex, list)
    }
    const counts: Record<SceneState, number> = { positive: 0, weak: 0, ignore: 0, negative: 0, unknown: 0 }
    const trainCounts: Record<SceneState, number> = { positive: 0, weak: 0, ignore: 0, negative: 0, unknown: 0 }
    const isDefect = (sp: AscanSpan): boolean => run.ctx.rules.kindPolicy[sp.kind] === 'defect'
    let trainStates = ''
    const regions: AscanGroupLabels['negativeRegions'] = []
    const regionIndex = new Map<string, number>()
    const sceneRegion: number[] = []
    let states = ''
    for (let k = 0; k < ns; k++) {
      const scene = scenes.get(k)
      const view: DeriveRun = { ...run, result: { ...run.result, scenes: scene ? [scene] : [], ascanSpans: spansAt.get(k) ?? [] } }
      const r = scene?.negativeRegion ?? null
      let ri = -1
      if (r) {
        const key = regionKey(r)
        const hit = regionIndex.get(key)
        if (hit !== undefined) ri = hit
        else {
          // ascanLabelAt 의 negativeRange 와 같은 규칙: 그 빔에서 펼친 깊이가 [위, 아래] 안인 첫·끝 샘플
          const lo: number[] = []
          const hi: number[] = []
          for (let b = 0; b < nb; b++) {
            let a = -1
            let e = -1
            for (let i = 0; i < geom.nt; i++) {
              const d = geom.unfoldedMm[b * geom.nt + i]!
              if (d >= r.depthTopMm && d <= r.depthBottomMm) {
                if (a < 0) a = i
                e = i
              }
            }
            lo.push(a)
            hi.push(e)
          }
          ri = regions.length
          regions.push({ region: r, lo, hi })
          regionIndex.set(key, ri)
        }
      }
      sceneRegion.push(ri)
      for (let b = 0; b < nb; b++) {
        const lab = ascanLabelAt(view, gid, k, b)
        states += ASCAN_STATE_CODE[lab.state]
        counts[lab.state]++
        const ts = ascanTrainState(lab.state, lab.spans, isDefect)
        trainStates += ASCAN_STATE_CODE[ts]
        trainCounts[ts]++
        if (lab.ignoreRanges.length > 0) out.ignore.push({ groupId: gid, scanIndex: k, beam: b, ranges: lab.ignoreRanges.map(([a, e]) => [a, e]) })
      }
    }
    out.groups.push({
      groupId: gid,
      scanCount: ns,
      beamCount: nb,
      sampleCount: geom.nt,
      states,
      trainStates,
      negativeRegions: regions,
      sceneNegativeRegion: sceneRegion,
      counts,
      trainCounts
    })
  }
  return out
}
