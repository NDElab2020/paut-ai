/** (d) 빔 구성 — AcqGroup 하나 → BeamGroupSpec 하나 */
import type { AngleRangeSpec, BeamFormation, BeamGroupSpec, GroupProbeSpec, ProbeRole } from '@shared/types'
import { canonicalJson } from '../fingerprint'
import { arr, byId, int, num, obj, objs, str, type Json } from '../json'
import { deg, mm, round, us } from '../units'
import type { AcqGroup } from './adapt'
import { groupProbe } from './probes'

type Params = BeamGroupSpec['techniqueParams']

interface Ctx {
  setup: Json
  warnings: string[]
}

const ROLE_ORDER: Record<ProbeRole, number> = { pulseEcho: 0, pulser: 1, receiver: 2 }

/** 역할 → 내용(모델·웨지·위치) 순으로 정렬. 파일 안 id 순서에는 기대지 않는다 */
function probesOf(ctx: Ctx, refs: Array<[ProbeRole, unknown]>): GroupProbeSpec[] {
  return refs
    .map(([role, id]) => groupProbe(ctx.setup, role, int(id), ctx.warnings))
    .map((p) => ({ p, key: canonicalJson(p) }))
    .sort((a, b) => ROLE_ORDER[a.p.role] - ROLE_ORDER[b.p.role] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ p }) => p)
}

function range(o: Json | null): AngleRangeSpec | null {
  if (!o) return null
  return { startDeg: deg(o['start']), stopDeg: deg(o['stop']), stepDeg: deg(o['step']) }
}

function single(angle: unknown): AngleRangeSpec | null {
  const a = deg(angle)
  return a === null ? null : { startDeg: a, stopDeg: a, stepDeg: null }
}

function empty(technique: BeamGroupSpec['technique']): BeamGroupSpec {
  return {
    technique,
    formation: 'none',
    firstElement: null,
    aperture: null,
    elementStep: null,
    refractedAngle: null,
    focusing: { mode: null, distanceMm: null },
    waveMode: null,
    probes: [],
    techniqueParams: {}
  }
}

function focusing(body: Json, params: Params): BeamGroupSpec['focusing'] {
  const f = obj(body['focusing'])
  const mode = str(f?.['mode'])
  if (num(f?.['angle']) !== null) params['focusAngleDeg'] = deg(f?.['angle'])
  return { mode, distanceMm: mode === 'Unfocused' ? null : mm(f?.['distance']) }
}

function paBeam(g: AcqGroup, ctx: Ctx): BeamGroupSpec {
  const b = g.body
  const spec = empty('PA')
  const params: Params = {}
  const tandem = obj(b['tandem'])
  const pe = obj(b['pulseEcho'])
  const pc = obj(b['pitchCatch'])
  if (tandem) {
    params['mode'] = 'tandem'
    spec.probes = probesOf(ctx, [['pulser', tandem['pulserProbeId']], ['receiver', tandem['receiverProbeId']]])
    for (const [side, f] of [['pulser', obj(tandem['pulserFormation'])], ['receiver', obj(tandem['receiverFormation'])]] as const) {
      params[`${side}FirstElement`] = int(f?.['probeFirstElementId'])
      params[`${side}Aperture`] = int(f?.['elementAperture'])
      params[`${side}AngleDeg`] = deg(f?.['beamRefractedAngle'])
      // 스펙상 시간 단위(초) → µs
      if (num(f?.['focusingDistance']) !== null) params[`${side}FocusUs`] = us(f?.['focusingDistance'])
    }
    spec.formation = 'other'
  } else {
    const holder = pe ?? pc ?? {}
    if (pc) params['mode'] = 'pitchCatch'
    spec.probes = pc
      ? probesOf(ctx, [['pulser', pc['pulserProbeId']], ['receiver', pc['receiverProbeId']]])
      : probesOf(ctx, [['pulseEcho', holder['probeId']]])
    applyFormation(spec, holder, params)
  }
  spec.focusing = focusing(b, params)
  spec.waveMode = str(b['waveMode'])
  spec.techniqueParams = params
  return spec
}

function applyFormation(spec: BeamGroupSpec, holder: Json, params: Params): void {
  const sect = obj(holder['sectorialFormation'])
  const lin = obj(holder['linearFormation'])
  const comp = obj(holder['compoundFormation'])
  const f = sect ?? lin ?? comp
  const formation: BeamFormation = sect ? 'sectorial' : lin ? 'linear' : comp ? 'compound' : 'other'
  spec.formation = formation
  if (!f) return
  spec.firstElement = int(f['probeFirstElementId'])
  spec.aperture = int(f['elementAperture'])
  if (lin || comp) params['lastElement'] = int(f['probeLastElementId'])
  if (lin) {
    spec.elementStep = round(f['elementStep'], 0.01)
    spec.refractedAngle = single(f['beamRefractedAngle'])
  } else {
    spec.refractedAngle = range(obj(f['beamRefractedAngles']))
  }
}

function utBeam(g: AcqGroup, ctx: Ctx): BeamGroupSpec {
  const b = g.body
  const tofd = obj(b['tofd'])
  const pc = obj(b['pitchCatch'])
  const spec = empty(tofd ? 'ToFD' : 'UT')
  if (tofd) {
    spec.probes = probesOf(ctx, [['pulser', tofd['pulserProbeId']], ['receiver', tofd['receiverProbeId']]])
    spec.techniqueParams = { pcsMm: mm(tofd['pcs']) }
  } else if (pc) {
    spec.probes = probesOf(ctx, [['pulser', pc['pulserProbeId']], ['receiver', pc['receiverProbeId']]])
    spec.techniqueParams = { mode: 'pitchCatch' }
  } else {
    spec.probes = probesOf(ctx, [['pulseEcho', obj(b['pulseEcho'])?.['probeId']]])
  }
  spec.refractedAngle = single(g.utRefractedAngle)
  spec.waveMode = str(b['waveMode'])
  return spec
}

/** 캡처 송신(펄서) id → 소자 번호. 4.x: beams[id].pulsers[0].elementId, 3.x: pulsers[id].elementId */
function pulserElements(capture: Json | null, ids: number[] | null): number[] {
  if (!capture) return ids ?? []
  const beams = objs(capture['beams'])
  const pulsers = objs(capture['pulsers'])
  const resolve = (id: number): number | null =>
    beams.length > 0 ? int(objs(byId(beams, id)?.['pulsers'])[0]?.['elementId']) : int(byId(pulsers, id)?.['elementId'])
  const all = ids ?? (beams.length > 0 ? beams : pulsers).map((o) => int(o['id'])).filter((v): v is number => v !== null)
  return all.map((id) => resolve(id) ?? id)
}

function joinWaves(v: unknown): string | null {
  const list = arr(v).filter((x): x is string => typeof x === 'string')
  return list.length ? list.join('+') : null
}

function tfmBeam(g: AcqGroup, ctx: Ctx): BeamGroupSpec {
  const b = g.body
  const spec = empty('TFM')
  spec.probes = probesOf(ctx, g.captureProbes)
  const ids = arr(b['fmcPulserIds']).filter((x): x is number => typeof x === 'number')
  const elements = pulserElements(g.capture, ids.length ? ids : null)
  spec.firstElement = elements.length ? Math.min(...elements) : null
  spec.aperture = elements.length || null
  const grid = obj(b['rectangularGrid'])
  const y = obj(grid?.['yImagingLimits'])
  const z = obj(grid?.['zImagingLimits'])
  const waves = obj(b['waveSet'])
  spec.techniqueParams = {
    capture: g.capturePattern,
    pathName: str(b['pathName']),
    pulsings: joinWaves(waves?.['pulsings']),
    receivings: joinWaves(waves?.['receivings']),
    receiverCount: arr(b['fmcReceiverIds']).length || null,
    zoneYMinMm: mm(y?.['min']),
    zoneYMaxMm: mm(y?.['max']),
    zoneZMinMm: mm(z?.['min']),
    zoneZMaxMm: mm(z?.['max'])
  }
  return spec
}

function captureBeam(g: AcqGroup, ctx: Ctx): BeamGroupSpec {
  const pattern = g.capturePattern ?? 'FMC'
  const spec = empty(pattern === 'PWI' ? 'PWI' : 'FMC')
  spec.probes = probesOf(ctx, g.captureProbes)
  const elements = pulserElements(g.capture, null)
  spec.firstElement = elements.length ? Math.min(...elements) : null
  spec.aperture = elements.length || null
  const pw = obj(g.body['planeWaveImaging']) ?? obj(g.body['pulseBeamsFormation'])
  if (pw) {
    spec.refractedAngle = { startDeg: deg(pw['startAngle']), stopDeg: deg(pw['stopAngle']), stepDeg: null }
    spec.waveMode = str(pw['waveMode'])
    spec.techniqueParams = { angleCount: int(pw['quantityAngle']), waveLocation: str(pw['waveLocation']) }
  }
  spec.techniqueParams = { ...spec.techniqueParams, capture: pattern }
  return spec
}

export function beamGroupSpec(g: AcqGroup, setup: Json, warnings: string[]): BeamGroupSpec {
  const ctx: Ctx = { setup, warnings }
  switch (g.kind) {
    case 'pa':
      return paBeam(g, ctx)
    case 'ut':
      return utBeam(g, ctx)
    case 'tfm':
      return tfmBeam(g, ctx)
    case 'capture':
      return captureBeam(g, ctx)
    default:
      warnings.push(`지원하지 않는 기법(${g.unsupportedKey ?? '알 수 없음'})의 그룹 '${g.name ?? g.groupId ?? '?'}' 은 기법만 기록합니다.`)
      return { ...empty('other'), formation: 'other', techniqueParams: { unsupported: g.unsupportedKey ?? 'unknown' } }
  }
}
