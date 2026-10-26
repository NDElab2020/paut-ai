/** 두 스캔플랜 스펙의 차이 (한국어 라벨) */
import type { BeamGroupSpec, ScanPlanSpec, SpecCategory, SpecDifference } from '@shared/types'
import { canonicalJson } from './fingerprint'
import { SHAPE_LABEL, formatMultiset, formatOffsets, physicalProbes, techniqueText } from './naming'
import { FINGERPRINT_TOLERANCE, fmtNum } from './units'

type Val = SpecDifference['existing']

const SPECIMEN_FIELDS: Array<[path: string, label: string]> = [
  ['shape', '시편 형상'],
  ['thicknessMm', '두께'],
  ['outerRadiusMm', '외반경'],
  ['angularOpeningDeg', '원주 범위'],
  ['materialName', '재질'],
  ['weld.bevelShape', '개선 형상'],
  ['weld.symmetry', '개선 대칭'],
  ['weld.template', '개선 템플릿'],
  ['weld.templateCode', '개선 템플릿 코드'],
  ['weld.symmetryCode', '개선 대칭 코드'],
  ['weld.offsetMm', '랜드 오프셋'],
  ['weld.hazWidthMm', '열영향부 폭'],
  ['weld.derivedFillHeightMm', '채움 높이 계산값'],
  ['weld.weldAngleDeg', '용접 각도'],
  ['weld.upperCap.widthMm', '상부 캡 폭'],
  ['weld.upperCap.heightMm', '상부 캡 높이'],
  ['weld.lowerCap.widthMm', '하부 캡 폭'],
  ['weld.lowerCap.heightMm', '하부 캡 높이'],
  ['weld.hotPass.angleDeg', '핫패스 각도'],
  ['weld.hotPass.heightMm', '핫패스 높이'],
  ['weld.land.heightMm', '랜드 높이'],
  ['weld.root.angleDeg', '루트 각도'],
  ['weld.root.heightMm', '루트 높이'],
  ['weld.materialName', '용접부 재질']
]

const BEAM_FIELDS: Array<[path: string, label: string]> = [
  ['technique', '기법'],
  ['formation', '빔 형성'],
  ['firstElement', '첫 소자'],
  ['aperture', '어퍼처(소자 수)'],
  ['elementStep', '소자 스텝'],
  ['refractedAngle.startDeg', '굴절각 시작'],
  ['refractedAngle.stopDeg', '굴절각 끝'],
  ['refractedAngle.stepDeg', '굴절각 간격'],
  ['focusing.mode', '집속 방식'],
  ['focusing.distanceMm', '집속 거리'],
  ['waveMode', '파 모드']
]

const ORIENTATION_LABEL: Record<string, string> = { Normal: '정방향', Reverse: '역방향' }
const WEDGE_KIND_LABEL: Record<string, string> = { angleBeam: '경사 웨지', fluidColumn: '액주', other: '기타' }

const PARAM_LABEL: Record<string, string> = {
  mode: '송수신 방식',
  pcsMm: 'PCS',
  pathName: 'TFM 경로',
  pulsings: 'TFM 송신 파',
  receivings: 'TFM 수신 파',
  capture: '캡처 방식',
  lastElement: '마지막 소자',
  zoneYMinMm: 'TFM 영역 Y 시작',
  zoneYMaxMm: 'TFM 영역 Y 끝',
  zoneZMinMm: 'TFM 영역 깊이 시작',
  zoneZMaxMm: 'TFM 영역 깊이 끝',
  receiverCount: '수신 소자 수',
  focusAngleDeg: '집속 각도',
  pulserFirstElement: '송신 첫 소자',
  pulserAperture: '송신 어퍼처',
  pulserAngleDeg: '송신 굴절각',
  pulserFocusUs: '송신 집속',
  receiverFirstElement: '수신 첫 소자',
  receiverAperture: '수신 어퍼처',
  receiverAngleDeg: '수신 굴절각',
  receiverFocusUs: '수신 집속',
  angleCount: '평면파 각도 수',
  waveLocation: '평면파 위치',
  unsupported: '미지원 기법'
}

function get(o: unknown, path: string): Val {
  let cur: unknown = o
  for (const k of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined
  if (cur === undefined || cur === null) return null
  return typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean' ? cur : JSON.stringify(cur)
}

function d(category: SpecCategory, path: string, label: string, existing: Val, incoming: Val): SpecDifference {
  return { category, path, label, existing, incoming }
}

function specimenDiffs(a: ScanPlanSpec, b: ScanPlanSpec): SpecDifference[] {
  const out: SpecDifference[] = []
  for (const [path, label] of SPECIMEN_FIELDS) {
    let x = get(a.specimen, path)
    let y = get(b.specimen, path)
    if (path === 'shape') {
      x = SHAPE_LABEL[a.specimen.shape]
      y = SHAPE_LABEL[b.specimen.shape]
    }
    if (x !== y) out.push(d('specimen', `specimen.${path}`, label, x, y))
  }
  const fills = (s: ScanPlanSpec): string =>
    (s.specimen.weld?.fills ?? []).map((f) => `${fmtNum(f.angleDeg)}°/${fmtNum(f.heightMm)}mm`).join(', ')
  if (fills(a) !== fills(b)) out.push(d('specimen', 'specimen.weld.fills', '충전층', fills(a) || null, fills(b) || null))
  return out
}

function setText(values: Array<number | string | null | undefined>, unit = ''): string | null {
  const list = [...new Set(values.filter((v): v is number | string => v !== null && v !== undefined))]
  list.sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))))
  return list.length ? list.map((v) => (typeof v === 'number' ? fmtNum(v, 0.01) : v)).join(', ') + unit : null
}

function probeDiffs(a: ScanPlanSpec, b: ScanPlanSpec): SpecDifference[] {
  const pa = physicalProbes(a)
  const pb = physicalProbes(b)
  const items: Array<[SpecCategory, string, string, (ps: typeof pa) => string | null]> = [
    ['probe', 'probes.model', '탐촉자 모델', (ps) => formatMultiset(ps.map((p) => p.probe.model ?? '?').sort()) || null],
    ['probe', 'probes.centralFrequencyMHz', '중심 주파수', (ps) => setText(ps.map((p) => p.probe.centralFrequencyMHz), ' MHz')],
    ['probe', 'probes.elementCount', '탐촉자 소자 수', (ps) => setText(ps.map((p) => p.probe.elementCount))],
    ['probe', 'probes.pitchMm', '소자 피치', (ps) => setText(ps.map((p) => p.probe.pitchMm), ' mm')],
    ['probe', 'probes.orientation', '탐촉자 장착 방향', (ps) => setText(ps.map((p) => ORIENTATION_LABEL[p.orientation] ?? p.orientation))],
    ['probe', 'wedges.model', '웨지 모델', (ps) => formatMultiset(ps.map((p) => p.wedge?.model ?? '없음').sort()) || null],
    ['probe', 'wedges.kind', '웨지 종류', (ps) => setText(ps.map((p) => (p.wedge ? WEDGE_KIND_LABEL[p.wedge.kind] : null)))],
    ['probe', 'wedges.wedgeAngleDeg', '웨지 각도', (ps) => setText(ps.map((p) => p.wedge?.wedgeAngleDeg), '°')],
    ['position', 'position.vOffsetMm', '인덱스 오프셋', (ps) => offsets(ps.map((p) => p.position?.vOffsetMm))],
    ['position', 'position.uOffsetMm', '스캔축 오프셋', (ps) => offsets(ps.map((p) => p.position?.uOffsetMm))],
    ['position', 'position.skewDeg', '스큐', (ps) => setText(ps.map((p) => p.position?.skewDeg), '°')],
    ['position', 'position.surface', '스캔면', (ps) => setText(ps.map((p) => p.position?.surface))]
  ]
  const out: SpecDifference[] = []
  for (const [cat, path, label, f] of items) {
    const x = f(pa)
    const y = f(pb)
    if (x !== y) out.push(d(cat, path, label, x, y))
  }
  return out
}

function offsets(values: Array<number | null | undefined>): string | null {
  const nums = values.filter((v): v is number => typeof v === 'number')
  return nums.length ? `${formatOffsets(nums)} mm` : null
}

function beamFieldDiffs(x: BeamGroupSpec, y: BeamGroupSpec): Array<[path: string, label: string, Val, Val]> {
  const out: Array<[string, string, Val, Val]> = []
  for (const [path, label] of BEAM_FIELDS) {
    const vx = get(x, path)
    const vy = get(y, path)
    if (vx !== vy) out.push([path, label, vx, vy])
  }
  const keys = [...new Set([...Object.keys(x.techniqueParams), ...Object.keys(y.techniqueParams)])].sort()
  for (const k of keys) {
    const vx = x.techniqueParams[k] ?? null
    const vy = y.techniqueParams[k] ?? null
    if (vx !== vy) out.push([`techniqueParams.${k}`, PARAM_LABEL[k] ?? k, vx, vy])
  }
  return out
}

/** 그룹 수가 같을 때: 가장 비슷한 그룹끼리 짝지어 빔 항목 비교 (모든 짝에서 같은 변화면 하나로 합침) */
function beamDiffs(a: ScanPlanSpec, b: ScanPlanSpec): SpecDifference[] {
  const free = a.groups.map((_, i) => i)
  const pairs: Array<[number, number]> = []
  b.groups.forEach((gb, j) => {
    let best = 0
    let bestCost = Infinity
    free.forEach((i, k) => {
      const cost = beamFieldDiffs(a.groups[i]!, gb).length
      if (cost < bestCost) [best, bestCost] = [k, cost]
    })
    pairs.push([free.splice(best, 1)[0]!, j])
  })
  // 라벨은 기존 플랜 쪽 그룹으로 붙인다 (바뀐 값이 라벨에 섞이지 않게)
  const labels = groupLabels(a.groups)
  const perPair = pairs.map(([i, j]) => ({ i, j, diffs: beamFieldDiffs(a.groups[i]!, b.groups[j]!) }))
  const out: SpecDifference[] = []
  const seen = new Set<string>()
  for (const { i, j, diffs } of perPair) {
    for (const [path, label, vx, vy] of diffs) {
      const everywhere = perPair.every((p) => p.diffs.some(([pp, , px, py]) => pp === path && px === vx && py === vy))
      if (everywhere && perPair.length > 1) {
        if (!seen.has(path)) out.push(d('beam', `groups[*].${path}`, label, vx, vy))
        seen.add(path)
      } else {
        out.push(d('beam', `groups[${j}].${path}`, `${labels[i]} ${label}`, vx, vy))
      }
    }
  }
  return out
}

/**
 * 그룹 표시 이름: 정렬 순번은 내용이 바뀌면 움직이므로 기법·스큐로 부른다. 예: '[PA 섹터 40–70° · 스큐 90°]'.
 * 같은 이름이 둘 이상이면 뒤에 순번을 붙인다.
 */
function groupLabels(groups: BeamGroupSpec[]): string[] {
  const base = groups.map((g) => {
    const skews = [...new Set(g.probes.map((p) => p.position?.skewDeg).filter((v): v is number => v !== null && v !== undefined))]
    return [techniqueText(g), skews.length ? `스큐 ${skews.map((v) => fmtNum(v)).join('/')}°` : ''].filter(Boolean).join(' · ')
  })
  return base.map((name, i) => {
    const same = base.filter((x) => x === name).length
    return same > 1 ? `[${name} #${base.slice(0, i + 1).filter((x) => x === name).length}]` : `[${name}]`
  })
}

function structureDiffs(a: ScanPlanSpec, b: ScanPlanSpec): SpecDifference[] {
  const out: SpecDifference[] = []
  if (a.groups.length !== b.groups.length) out.push(d('structure', 'groups.length', '그룹 수', a.groups.length, b.groups.length))
  const tech = (s: ScanPlanSpec): string => formatMultiset(s.groups.map(techniqueText).sort())
  if (tech(a) !== tech(b)) out.push(d('structure', 'groups.techniques', '빔 구성', tech(a) || null, tech(b) || null))
  return out
}

/** 두 스펙 차이 (한국어 라벨 포함). 같으면 빈 배열 */
export function diffSpecs(existing: ScanPlanSpec, incoming: ScanPlanSpec): SpecDifference[] {
  if (canonicalJson(existing) === canonicalJson(incoming)) return []
  const out = [...specimenDiffs(existing, incoming), ...structureDiffs(existing, incoming), ...probeDiffs(existing, incoming)]
  if (existing.groups.length === incoming.groups.length) out.push(...beamDiffs(existing, incoming))
  if (out.length === 0) out.push(d('structure', 'spec', '기타 셋업 세부', '다름', '다름'))
  return out
}

/** 가장 가까운 플랜 고르기용 거리 (같으면 0) */
export function specDistance(a: ScanPlanSpec, b: ScanPlanSpec): number {
  const diffs = diffSpecs(a, b)
  const weight: Record<SpecCategory, number> = { specimen: 3, structure: 4, probe: 2, position: 1, beam: 1 }
  return diffs.reduce((sum, x) => sum + weight[x.category], 0) + 2 * Math.abs(a.groups.length - b.groups.length)
}

function unitOf(path: string): string {
  if (/Mm$/.test(path)) return ' mm'
  if (/Deg$/.test(path)) return '°'
  if (/MHz$/.test(path)) return ' MHz'
  return ''
}

function fmtVal(v: Val, path: string): string {
  if (v === null) return '없음'
  if (path.endsWith('angularOpeningDeg') && v === 360) return '360° (전체 원주)'
  if (typeof v === 'number') return `${fmtNum(v, 0.01)}${unitOf(path)}`
  return String(v)
}

/** '두께 12 mm → 25 mm' */
export function describeDifference(x: SpecDifference): string {
  return `${x.label} ${fmtVal(x.existing, x.path)} → ${fmtVal(x.incoming, x.path)}`
}

const TOLERANCE_BY_SUFFIX: Array<[RegExp, number]> = [
  [/Mm$/, FINGERPRINT_TOLERANCE.lengthMm],
  [/Deg$/, FINGERPRINT_TOLERANCE.angleDeg],
  [/MHz$/, FINGERPRINT_TOLERANCE.frequencyMHz],
  [/Us$/, 0.001]
]

function toleranceOf(key: string): number {
  return TOLERANCE_BY_SUFFIX.find(([re]) => re.test(key))?.[1] ?? 0
}

/** 같은 구조에서 수치만 허용오차 이내로 다르면 차이 개수, 그 밖의 차이가 있으면 -1 */
function nearDiffCount(a: unknown, b: unknown, key: string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return 0
    const tol = toleranceOf(key)
    return tol > 0 && Math.abs(a - b) <= tol * 1.000001 ? 1 : -1
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return -1
    return sumCounts(a.map((x, i) => nearDiffCount(x, b[i], key)))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    if (ka.join('\u0000') !== kb.join('\u0000')) return -1
    return sumCounts(ka.map((k) => nearDiffCount((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], k)))
  }
  return a === b ? 0 : -1
}

function sumCounts(xs: number[]): number {
  return xs.some((x) => x < 0) ? -1 : xs.reduce((s, x) => s + x, 0)
}

/**
 * 반올림 격자 경계(예: 23.04 / 23.06 mm)에 걸려 지문만 갈린 경우: 구조가 같고 수치 차이가 모두
 * 허용오차(0.1 mm · 0.1° · 0.01 MHz) 이내면 true. 같은 플랜일 가능성이 높다는 안내에 쓴다.
 */
export function withinTolerance(existing: ScanPlanSpec, incoming: ScanPlanSpec): boolean {
  const { specVersion: _a, ...x } = JSON.parse(canonicalJson(existing)) as ScanPlanSpec
  const { specVersion: _b, ...y } = JSON.parse(canonicalJson(incoming)) as ScanPlanSpec
  return nearDiffCount(x, y, '') > 0
}
