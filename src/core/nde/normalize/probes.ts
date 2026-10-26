/** (b) 탐촉자·웨지 모델, (c) 탐촉자(웨지) 위치 */
import type {
  GroupProbeSpec,
  ProbeKind,
  ProbeOrientation,
  ProbePositionSpec,
  ProbeRole,
  ProbeSpec,
  WedgeKind,
  WedgeSpec
} from '@shared/types'
import { byId, int, num, obj, objs, str, type Json } from '../json'
import { deg, mhz, mm, wrapDeg } from '../units'
import { SHAPES } from './specimen'

const PROBE_KINDS: readonly ProbeKind[] = [
  'phasedArrayLinear',
  'phasedArrayMatrix',
  'dualLinear',
  'conventionalRound',
  'conventionalRectangular'
]

function probeBody(p: Json): [ProbeKind, Json | null] {
  for (const k of PROBE_KINDS) {
    const b = obj(p[k])
    if (b) return [k, b]
  }
  const other = Object.keys(p).find((k) => obj(p[k]) && k !== 'wedgeAssociation' && k !== 'fluidColumn')
  return ['other', other ? obj(p[other]) : null]
}

export function normalizeProbe(p: Json | null): ProbeSpec {
  if (!p) return { model: null, kind: 'other', centralFrequencyMHz: null, elementCount: null, pitchMm: null }
  const [kind, body] = probeBody(p)
  const axis = obj(body?.['primaryAxis'])
  const isPa = kind === 'phasedArrayLinear' || kind === 'phasedArrayMatrix' || kind === 'dualLinear'
  const length = num(axis?.['elementLength'])
  const gap = num(axis?.['elementGap']) ?? 0
  return {
    model: str(p['model']),
    kind,
    centralFrequencyMHz: mhz(body?.['centralFrequency']),
    elementCount: isPa ? int(axis?.['elementQuantity']) : kind === 'other' ? null : 1,
    pitchMm: isPa && length !== null ? mm(length + gap) : null
  }
}

function mountingLocation(holder: Json | null, id: number | null): Json | null {
  if (!holder) return null
  return byId(holder['mountingLocations'], id) ?? objs(holder['mountingLocations'])[0] ?? null
}

/** 4.x wedges[] 항목 (angleBeamWedge 또는 fluidColumn) */
function normalizeWedge(w: Json | null, mountingLocationId: number | null): WedgeSpec | null {
  if (!w) return null
  const abw = obj(w['angleBeamWedge'])
  const fc = obj(w['fluidColumn'])
  const kind: WedgeKind = abw ? 'angleBeam' : fc ? 'fluidColumn' : 'other'
  const loc = mountingLocation(abw ?? fc, mountingLocationId)
  return { model: str(w['model']) ?? str(w['name']), kind, wedgeAngleDeg: deg(loc?.['wedgeAngle']) }
}

/** 3.x 액주 탐촉자: probes[].fluidColumn 안에 이름·웨지 각·위치가 있다 */
function fluidColumn3(fc: Json): WedgeSpec {
  return { model: str(fc['model']) ?? str(fc['name']), kind: 'fluidColumn', wedgeAngleDeg: deg(fc['wedgeAngle']) }
}

/** positioning.specimenId/surfaceId → 시편 형상의 surfaces[].name */
function surfaceName(setup: Json, pos: Json): string | null {
  const surfaceId = int(pos['surfaceId'])
  if (surfaceId === null) return null
  const specimens = objs(setup['specimens'])
  const sp = byId(specimens, int(pos['specimenId'])) ?? (specimens.length === 1 ? specimens[0]! : null)
  if (!sp) return null
  for (const [key] of SHAPES) {
    const surface = byId(obj(sp[key])?.['surfaces'], surfaceId)
    if (surface) return str(surface['name'])
  }
  return null
}

function normalizePosition(setup: Json, holder: Json | null): ProbePositionSpec | null {
  const pos = obj(holder?.['positioning'])
  if (!pos) return null
  return {
    uOffsetMm: mm(pos['uCoordinateOffset']),
    vOffsetMm: mm(pos['vCoordinateOffset']),
    skewDeg: wrapDeg(deg(pos['skewAngle'])),
    surface: surfaceName(setup, pos)
  }
}

function orientationOf(assoc: Json | null): ProbeOrientation {
  return str(assoc?.['orientation']) === 'Reverse' ? 'Reverse' : 'Normal'
}

/** 그룹이 쓰는 탐촉자 1개 = 모델 + 장착 방향 + 웨지 + 위치 */
export function groupProbe(setup: Json, role: ProbeRole, probeId: number | null, warnings: string[]): GroupProbeSpec {
  const p = byId(setup['probes'], probeId)
  if (!p) warnings.push(`탐촉자 id ${probeId ?? '?'} 를 셋업에서 찾지 못했습니다.`)
  const assoc = obj(p?.['wedgeAssociation'])
  const wedge = byId(setup['wedges'], int(assoc?.['wedgeId']))
  const fc3 = wedge ? null : obj(p?.['fluidColumn'])
  return {
    role,
    probe: normalizeProbe(p),
    orientation: orientationOf(assoc),
    wedge: wedge ? normalizeWedge(wedge, int(assoc?.['mountingLocationId'])) : fc3 ? fluidColumn3(fc3) : null,
    position: normalizePosition(setup, wedge ?? fc3)
  }
}
