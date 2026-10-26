/**
 * 데이터 캔버스의 셋업 도식: 시편 단면 + 용접 개선 + 탐촉자(웨지) 위치 + 빔 부채꼴.
 * 스펙 값(mm, °)으로 그리는 근사 도식이다. 빔은 첫 번째 다리(바닥면까지)만 그린다.
 */
import { bevelHalfWidth, isDrawableWeld } from '@shared/imaging'
import { isEstimatedSpecimenField, type ScanPlanSpec } from '@shared/types'
import { SHAPE_LABEL, angleRange, num } from '../lib/format'
import { setupWeldGeometry, setupWeldTemplateLabel } from './setupWeldGeometry'

const W = 640
const PAD_X = 40
const TOP = 64
/** 웨지는 실제 크기 대신 고정 픽셀로 그린다 (위치만 의미 있음) */
const WEDGE_PX = 64
const WEDGE_H_PX = 24

/** 겹쳐 볼 때 그룹을 구분하는 선 모양 (색은 하나만 쓴다) */
export const GROUP_DASH = ['', '6 4', '2 3', '10 3 2 3']

interface ProbeMark {
  key: string
  gi: number
  x0: number
  dir: -1 | 0 | 1
  start: number | null
  stop: number | null
  label: string
}

function dirOf(skew: number | null): -1 | 0 | 1 {
  if (skew === null) return 0
  const s = ((skew % 360) + 360) % 360
  if (Math.abs(s - 90) < 30) return 1
  if (Math.abs(s - 270) < 30) return -1
  return 0
}

const rad = (d: number): number => (d * Math.PI) / 180

function marks(spec: ScanPlanSpec, groupNames: string[]): ProbeMark[] {
  const out: ProbeMark[] = []
  spec.groups.forEach((g, gi) => {
    g.probes.forEach((p, pi) => {
      const pos = p.position
      out.push({
        key: `${gi}-${pi}`,
        gi,
        x0: pos?.vOffsetMm ?? 0,
        dir: dirOf(pos?.skewDeg ?? null),
        start: g.refractedAngle?.startDeg ?? null,
        stop: g.refractedAngle?.stopDeg ?? g.refractedAngle?.startDeg ?? null,
        label: `${groupNames[gi] ?? `그룹 ${gi + 1}`} · ${angleRange(g.refractedAngle ? { ...g.refractedAngle, stepDeg: null } : null)}`
      })
    })
  })
  return out
}

function beamEnd(m: ProbeMark, a: number, t: number): number {
  return m.x0 + m.dir * t * Math.tan(rad(Math.min(a, 85)))
}

/**
 * visibleGroups: 그릴 그룹 인덱스(이 순서로 선 모양을 정한다). 없으면 전부.
 * 축척은 모든 그룹 기준으로 정해 체크를 바꿔도 도식이 흔들리지 않는다.
 */
export function SetupDiagram({
  spec,
  groupNames,
  visibleGroups
}: {
  spec: ScanPlanSpec
  groupNames: string[]
  visibleGroups?: readonly number[]
}) {
  const sp = spec.specimen
  const t = sp.thicknessMm && sp.thicknessMm > 0 ? sp.thicknessMm : 10
  const weld = setupWeldGeometry(spec)
  const drawable = weld !== null && isDrawableWeld(weld, sp.thicknessMm)
  const all = marks(spec, groupNames)
  const order = visibleGroups ?? spec.groups.map((_, i) => i)
  const ms = all.filter((m) => order.includes(m.gi))
  const dashOf = (m: ProbeMark): string | undefined =>
    order.length > 1 ? GROUP_DASH[order.indexOf(m.gi) % GROUP_DASH.length] || undefined : undefined
  const xs = [0, ...all.flatMap((m) => [m.x0 + 8, m.x0 - 8, ...(m.start !== null && m.stop !== null ? [beamEnd(m, m.start, t), beamEnd(m, m.stop, t)] : [])])]
  const capHalf = Math.max(weld?.upperCap?.widthMm ?? 0, weld?.lowerCap?.widthMm ?? 0) / 2
  xs.push(capHalf + 4, -capHalf - 4)
  if (drawable) {
    for (const depth of [0, t / 2, t]) {
      const half = bevelHalfWidth(weld, t, depth)
      xs.push(half + 4, -half - 4)
    }
  }
  const xMin = Math.min(...xs) - 6
  const xMax = Math.max(...xs) + 6
  const inner = W - PAD_X * 2 - WEDGE_PX * 2
  const scale = Math.min(inner / (xMax - xMin), 150 / t)
  const X = (mm: number): number => PAD_X + WEDGE_PX + (mm - xMin) * scale + (inner - (xMax - xMin) * scale) / 2
  /** 가까운 위치의 라벨은 위로 쌓는다 (같은 탐촉자를 쓰는 그룹 여러 개를 겹칠 때) */
  const levels = (list: ProbeMark[]): number[] =>
    list.map((m, i) => list.slice(0, i).filter((o) => Math.abs(X(o.x0) - X(m.x0)) < 140).length)
  const labelLevel = levels(ms)
  const top = TOP + Math.max(0, ...levels(all).map((l) => l - 1)) * 16
  const Y = (mm: number): number => top + mm * scale
  const H = Y(t) + 78

  const depths = [...new Set([0, t, ...(weld ? [t - (weld.root?.heightMm ?? 0), t - (weld.root?.heightMm ?? 0) - weld.landHeightMm] : []), ...Array.from({ length: 21 }, (_, i) => (t * i) / 20)])].filter((y) => y >= 0 && y <= t).sort((a, b) => a - b)
  const bevel = drawable
    ? depths
        .map((y) => `${X(bevelHalfWidth(weld, t, y))},${Y(y)}`)
        .concat(
          depths.slice().reverse().map((y) => `${X(-bevelHalfWidth(weld, t, y))},${Y(y)}`)
        )
        .join(' ')
    : null
  const upper = weld?.upperCap?.widthMm ? weld.upperCap : null
  const lower = weld?.lowerCap?.widthMm ? weld.lowerCap : null
  const capPath = (half: number, h: number, y: number, sign: -1 | 1): string =>
    `M${X(-half)} ${Y(y)} Q${X(0)} ${Y(y) + sign * Math.min(14, Math.max(4, h * scale * 2))} ${X(half)} ${Y(y)}`

  const bevelUnknown = !drawable
  const unknownGeometry = [!sp.weld?.template && !sp.weld?.bevelShape ? '개선 템플릿' : null, !sp.weld?.symmetry ? '대칭 방식' : null].filter(Boolean)
  const geometryNote = bevelUnknown
    ? weld ? (weld.geometryEstimated ? '용접 치수 확인 필요 · 참고 단면 없음' : `${setupWeldTemplateLabel(weld.template ?? weld.bevelShape)} 단면 도식 미지원`) : '개선 형상 정보 없음'
    : weld?.geometryEstimated
      ? `대칭으로 그린 참고 단면${unknownGeometry.length ? ` · ${unknownGeometry.join('/')} 모름` : ''}`
      : `${setupWeldTemplateLabel(weld?.template ?? weld?.bevelShape)} 개선${isEstimatedSpecimenField(sp, 'weld.template') ? ' (추정)' : ''}`
  // OPD: 파일 코드로 정했지만 다른 값 표본이 없는 칸은 '(추정)' (spec.specimen.estimatedFields)
  const shapeNote = sp.shape === 'unknown' ? '시편 형상 모름 · 펼친 단면' : `${SHAPE_LABEL[sp.shape]}${isEstimatedSpecimenField(sp, 'shape') ? ' (추정)' : ''}`
  const aria = `${shapeNote}, 두께 ${num(sp.thicknessMm)} mm, ${geometryNote}, 그룹 ${order.length}/${spec.groups.length}개 표시, 탐촉자 ${ms.length}개 단면 도식`

  return (
    <svg className="diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
      {ms.map((m) =>
        m.start !== null && m.stop !== null && m.dir !== 0 ? (
          <polygon
            key={`b${m.key}`}
            className="diagram__beam"
            strokeDasharray={dashOf(m)}
            points={`${X(m.x0)},${Y(0)} ${X(beamEnd(m, m.start, t))},${Y(t)} ${X(beamEnd(m, m.stop, t))},${Y(t)}`}
          />
        ) : (
          <line
            key={`b${m.key}`}
            className="diagram__beam"
            strokeDasharray={dashOf(m)}
            x1={X(m.x0)}
            y1={Y(0)}
            x2={X(m.x0)}
            y2={Y(t)}
          />
        )
      )}
      <rect className="diagram__plate" x={PAD_X} y={Y(0)} width={W - PAD_X * 2} height={t * scale} />
      {bevel ? <polygon className="diagram__weld" points={bevel} /> : null}
      {upper ? <path className="diagram__line" d={capPath((upper.widthMm ?? 0) / 2, upper.heightMm ?? 1, 0, -1)} /> : null}
      {lower ? <path className="diagram__line" d={capPath((lower.widthMm ?? 0) / 2, lower.heightMm ?? 1, t, 1)} /> : null}
      {ms.map((m, i) => {
        const d = m.dir || 1
        const back = X(m.x0) - d * WEDGE_PX
        const front = X(m.x0) + d * 10
        const y0 = Y(0)
        const labelY = y0 - WEDGE_H_PX - 12 - labelLevel[i]! * 16
        return (
          <g key={`w${m.key}`}>
            <polygon
              className="diagram__wedge"
              points={`${back},${y0} ${front},${y0} ${front},${y0 - 7} ${back},${y0 - WEDGE_H_PX}`}
            />
            <circle className="diagram__exit" cx={X(m.x0)} cy={y0} r={2.5} />
            <text className="diagram__text" x={(back + front) / 2} y={Math.max(14, labelY)} textAnchor="middle">
              {m.label}
            </text>
          </g>
        )
      })}
      <path className="diagram__dim" d={`M${X(0)} ${Y(0) - 4} V${Y(t) + 26}`} strokeDasharray="3 3" />
      {bevelUnknown ? (
        <text className="diagram__text diagram__text--dim" x={X(0) + 6} y={Y(t / 2) + 4} textAnchor="start">
          개선 단면 없음
        </text>
      ) : null}
      <text className="diagram__text diagram__text--dim" x={X(0)} y={Y(t) + 40} textAnchor="middle">
        용접 중심
      </text>
      <text className="diagram__text diagram__text--dim" x={W / 2} y={Y(t) + 62} textAnchor="middle">
        {shapeNote} · {geometryNote}
      </text>
      {[...new Set(ms.map((m) => m.x0).filter((x) => x !== 0))].map((x) => (
        <text key={`x${x}`} className="diagram__text diagram__text--dim" x={X(x)} y={Y(t) + 22} textAnchor="middle">
          {`${x > 0 ? '+' : '−'}${num(Math.abs(x))}`}
        </text>
      ))}
      <path className="diagram__dim" d={`M${W - 22} ${Y(0)} V${Y(t)} M${W - 28} ${Y(0)} H${W - 16} M${W - 28} ${Y(t)} H${W - 16}`} />
      <text className="diagram__text diagram__text--dim" x={W - 22} y={Y(t) + 18} textAnchor="middle">
        {sp.thicknessMm ? `${num(sp.thicknessMm)}` : '두께 ?'}
      </text>
    </svg>
  )
}
