/**
 * 플랜 목록 화면 묶음: 두께 구간 → 탐촉자 주파수 → 스큐 → 플랜.
 * 라벨은 플랜 자동 이름(shared/planName)과 같은 함수로 만든다. 저장 폴더·DB·이름은 바꾸지 않는 화면용 묶음이다.
 */
import { frequenciesMHz, frequencyLabel, skewLabel, skewsDeg, thicknessBucket } from './planName'
import type { ScanPlanSpec } from './types'

export const UNKNOWN_THICKNESS = '두께 미상'
export const UNKNOWN_FREQUENCY = '주파수 미상'
export const UNKNOWN_SKEW = '스큐 미상'

export interface GroupablePlan {
  id: string
  spec: ScanPlanSpec
}

export interface SkewGroup<P extends GroupablePlan = GroupablePlan> {
  /** 목록 전체에서 고유: 't:10|f:5MHz|s:SK90' */
  key: string
  /** 'SK90/270' 또는 '스큐 미상' */
  label: string
  plans: P[]
}

export interface FrequencyGroup<P extends GroupablePlan = GroupablePlan> {
  /** 목록 전체에서 고유: 't:10|f:5MHz' */
  key: string
  /** '10/5MHz' 또는 '주파수 미상' */
  label: string
  planCount: number
  skews: SkewGroup<P>[]
}

export interface ThicknessGroup<P extends GroupablePlan = GroupablePlan> {
  /** 't:10' (10~20T), 't:?' (두께 미상) */
  key: string
  /** '10~20T' 또는 '두께 미상' */
  label: string
  planCount: number
  freqs: FrequencyGroup<P>[]
}

/** 플랜 1개가 들어갈 세 단계 열쇠 (화면에서 선택 플랜이 든 구간을 찾을 때도 쓴다) */
export interface PlanGroupPath {
  thicknessKey: string
  frequencyKey: string
  skewKey: string
}

export function planGroupPath(spec: ScanPlanSpec): PlanGroupPath {
  const t = thicknessBucket(spec)
  const thicknessKey = `t:${t ? t.lowMm : '?'}`
  const frequencyKey = `${thicknessKey}|f:${frequencyLabel(spec) ?? '?'}`
  const skewKey = `${frequencyKey}|s:${skewLabel(spec) ?? '?'}`
  return { thicknessKey, frequencyKey, skewKey }
}

/**
 * 수치 목록 비교: 대표값(rep) → 개수 적은 것 → 나머지 값 차례. 빈 목록(미상)은 맨 뒤.
 * 주파수는 [큰 값부터] 목록이라 대표값이 가장 큰 MHz, 스큐는 [작은 값부터] 목록이라 대표값이 첫 값.
 */
function compareValues(a: number[], b: number[]): number {
  if (!a.length || !b.length) return (a.length ? 0 : 1) - (b.length ? 0 : 1)
  if (a[0] !== b[0]) return a[0]! - b[0]!
  if (a.length !== b.length) return a.length - b.length
  for (let i = 1; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

const compareIds = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })

interface Bin<T> {
  key: string
  label: string
  /** 정렬용 수치 */
  sort: number[]
  items: T[]
}

function binBy<T>(items: T[], keyOf: (x: T) => { key: string; label: string; sort: number[] }): Bin<T>[] {
  const bins = new Map<string, Bin<T>>()
  for (const x of items) {
    const k = keyOf(x)
    let bin = bins.get(k.key)
    if (!bin) bins.set(k.key, (bin = { ...k, items: [] }))
    bin.items.push(x)
  }
  return [...bins.values()].sort((a, b) => compareValues(a.sort, b.sort) || a.key.localeCompare(b.key))
}

/**
 * 두께 구간(오름차순, 미상은 끝) → 주파수(가장 큰 MHz 오름차순) → 스큐(첫 값 오름차순, 같으면 개수 적은 것 먼저) → 플랜(ID 순).
 * 빈 구간은 만들지 않는다 (검색으로 걸러진 목록을 넣으면 걸러진 구간만 나온다).
 */
export function groupPlans<P extends GroupablePlan>(plans: readonly P[]): ThicknessGroup<P>[] {
  const rows = plans.map((plan) => ({ plan, path: planGroupPath(plan.spec) }))
  return binBy(rows, ({ plan, path }) => {
    const t = thicknessBucket(plan.spec)
    return { key: path.thicknessKey, label: t ? t.label : UNKNOWN_THICKNESS, sort: t ? [t.lowMm] : [] }
  }).map((tb) => ({
    key: tb.key,
    label: tb.label,
    planCount: tb.items.length,
    freqs: binBy(tb.items, ({ plan, path }) => ({
      key: path.frequencyKey,
      label: frequencyLabel(plan.spec) ?? UNKNOWN_FREQUENCY,
      sort: frequenciesMHz(plan.spec)
    })).map((fb) => ({
      key: fb.key,
      label: fb.label,
      planCount: fb.items.length,
      skews: binBy(fb.items, ({ plan, path }) => ({
        key: path.skewKey,
        label: skewLabel(plan.spec) ?? UNKNOWN_SKEW,
        sort: skewsDeg(plan.spec)
      })).map((sb) => ({
        key: sb.key,
        label: sb.label,
        plans: sb.items.map((r) => r.plan).sort((a, b) => compareIds(a.id, b.id))
      }))
    }))
  }))
}

/** 묶음 순서대로 펼친 플랜 목록 (화면 순서) */
export function plansInGroupOrder<P extends GroupablePlan>(groups: readonly ThicknessGroup<P>[]): P[] {
  return groups.flatMap((t) => t.freqs.flatMap((f) => f.skews.flatMap((s) => s.plans)))
}
