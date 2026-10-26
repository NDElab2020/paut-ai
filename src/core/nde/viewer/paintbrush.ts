/**
 * NDE 4.x Paintbrush: [U, V, Ultrasound] 는 이미 시편 표면 좌표로 옮긴 격자다.
 * https://ndeformat.com/4.2/json-metadata/setup/conventions/#storage-mode
 * 탐촉자 설치 오프셋을 다시 더하거나 V 칸 번호를 원래 빔 id 로 간주하지 않는다.
 * FiringSource 없는 파일도 안전하게 그리도록 모든 법칙의 각도·음속·시간축이 같은
 * 판재 0° 리니어 PulseEcho 로 범위를 한정한다. 상태 없는 칸의 잔존 진폭은 버린다.
 */
import type { ViewerBeam, ViewerGroup } from '@shared/imaging/types'
import { skewSign } from '@shared/imaging/coords'
import { byId, int, num, obj, objs, str, type Json } from '../json'
import { findDataMapping, type AcqGroup } from '../normalize/adapt'
import type { DatasetLookup } from './meta'

interface GridAxis {
  offset: number
  resolution: number
  count: number
}

export type PaintbrushMapping =
  | { reason: string }
  | {
      reason: null
      beams: ViewerBeam[]
      scan: ViewerGroup['scan']
      spatialAxis: NonNullable<ViewerGroup['spatialAxis']>
    }

const mm = (m: number): number => Math.round(m * 1e9) / 1e6 || 0
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12

function axis(d: Json | undefined, name: string, minimum: number): GridAxis | null {
  if (d?.['axis'] !== name) return null
  const count = int(d['quantity'])
  const offset = num(d['offset'])
  const resolution = num(d['resolution'])
  return count !== null && count >= minimum && offset !== null && resolution !== null && resolution > 0
    ? { count, offset, resolution }
    : null
}

function sameAxis(a: Json | undefined, b: Json | undefined): boolean {
  return !!a && !!b && a['axis'] === b['axis'] && a['quantity'] === b['quantity'] &&
    num(a['offset']) !== null && num(b['offset']) !== null && near(num(a['offset'])!, num(b['offset'])!) &&
    num(a['resolution']) !== null && num(b['resolution']) !== null && near(num(a['resolution'])!, num(b['resolution'])!)
}

/** null = 기존 Beam 저장 방식. reason 을 반환하면 Paintbrush 를 추측해서 열지 않는다. */
export function paintbrushMapping(setup: Json, raw: Json, acq: AcqGroup, lookup: DatasetLookup): PaintbrushMapping | null {
  const sets = objs(raw['datasets'])
  const amp = sets.find((d) => d['dataClass'] === 'AScanAmplitude')
  const dims = objs(amp?.['dimensions'])
  if (amp?.['storageMode'] !== 'Paintbrush' && dims[1]?.['axis'] !== 'VCoordinate') return null
  const fail = (reason: string): PaintbrushMapping => ({ reason: `Paintbrush: ${reason}` })
  if (amp?.['storageMode'] !== 'Paintbrush') return fail('공간 격자의 저장 방식이 확인되지 않습니다.')
  const u = axis(dims[0], 'UCoordinate', 1)
  const v = axis(dims[1], 'VCoordinate', 2)
  const t = axis(dims[2], 'Ultrasound', 2)
  if (dims.length !== 3 || !u || !v || !t) return fail('U·V·초음파 격자의 축·범위·간격이 올바르지 않습니다.')

  const body = acq.body
  const pe = obj(body['pulseEcho'])
  const linear = obj(pe?.['linearFormation'])
  if (acq.kind !== 'pa' || !linear || num(linear['beamRefractedAngle']) !== 0 ||
      str(body['waveMode']) !== 'Longitudinal' || str(body['ascanSynchroMode']) !== 'Pulse') {
    return fail('현재는 종파 0° 리니어 PulseEcho만 지원합니다.')
  }
  const velocity = num(body['velocity'])
  const laws = objs(body['beams'])
  if (velocity === null || velocity <= 0 || laws.length !== v.count || laws.some((b) => num(b['refractedAngle']) !== 0)) {
    return fail('공간 칸 수와 정상입사 법칙·음속을 확인할 수 없습니다.')
  }
  // 저장 격자의 Ultrasound.offset/resolution 이 유일한 시간축이다. beamDelay 를 다시 더하지 않는다.
  const delay = num(laws[0]?.['beamDelay'])
  if (delay === null || laws.some((b) => {
    const start = num(b['ascanStart'])
    const length = num(b['ascanLength'])
    const bd = num(b['beamDelay'])
    return start === null || length === null || bd === null || !near(start, t.offset) ||
      !near(length, t.count * t.resolution) || !near(bd, delay)
  })) return fail('법칙마다 시간축이나 지연이 달라 공간 칸의 음로를 확정할 수 없습니다.')
  for (const g of objs(body['gates'])) {
    for (const key of ['starts', 'lengths']) {
      const values = g[key]
      if (!Array.isArray(values)) continue
      if (values.length !== 1 && values.length !== laws.length) return fail('게이트의 공간 칸 대응이 확인되지 않습니다.')
      const first = num(values[0])
      if (first === null || values.some((x) => num(x) === null || !near(num(x)!, first))) {
        return fail('법칙별 게이트가 달라 공간 칸의 게이트를 확정할 수 없습니다.')
      }
    }
  }
  const mapping = findDataMapping(setup, acq.dataMappingId)
  const specimen = byId(setup['specimens'], int(mapping?.['specimenId']))
  if (!obj(specimen?.['plateGeometry'])) return fail('현재는 판재 표면의 공간 격자만 지원합니다.')
  const probe = byId(setup['probes'], int(pe?.['probeId']))
  const wedge = byId(setup['wedges'], int(obj(probe?.['wedgeAssociation'])?.['wedgeId']))
  const positioning = obj(wedge?.['positioning'])
  const skew = num(positioning?.['skewAngle'])
  if (int(mapping?.['surfaceId']) === null || skew === null || skewSign(skew) === null || positioning?.['specimenId'] !== mapping?.['specimenId'] ||
      positioning?.['surfaceId'] !== mapping?.['surfaceId']) return fail('시편 표면과 탐촉자 스큐 90°/270° 대응이 확인되지 않습니다.')

  const st = sets.find((d) => d['dataClass'] === 'AScanStatus')
  const sd = objs(st?.['dimensions'])
  const flags = obj(st?.['dataValue'])
  const path = str(st?.['path'])
  const storage = path ? lookup(path) : null
  if (st?.['storageMode'] !== 'Paintbrush' || sd.length !== 2 || !sameAxis(dims[0], sd[0]) || !sameAxis(dims[1], sd[1]) ||
      flags?.['hasData'] !== 1 || flags?.['saturated'] !== 2 || flags?.['noSynchro'] !== 4 ||
      !storage || storage.shape.join() !== [u.count, v.count].join() || storage.size !== 1 || storage.signed ||
      (storage.type !== 0 && storage.type !== 4)) {
    return fail('유효 칸을 구별할 8비트 상태 격자가 없거나 진폭 격자와 맞지 않습니다.')
  }
  return {
    reason: null,
    scan: { offsetMm: mm(u.offset), resolutionMm: mm(u.resolution), count: u.count },
    spatialAxis: { kind: 'index', offsetMm: mm(v.offset), resolutionMm: mm(v.resolution), count: v.count },
    beams: Array.from({ length: v.count }, (_, index) => ({
      index, angleDeg: 0, skewDeg: skew, velocityMps: velocity,
      uOffsetMm: 0, vOffsetMm: mm(v.offset + index * v.resolution), t0Us: t.offset * 1e6
    }))
  }
}

/** 상태와 진폭은 같은 [U,V] 칸 순서. 출력만 지우며 파일은 변경하지 않는다. */
export function maskPaintbrushAmplitude(amplitude: Int16Array, status: Uint8Array, samples: number): boolean {
  if (!Number.isInteger(samples) || samples < 2 || amplitude.length !== status.length * samples || status.some((s) => (s & ~7) !== 0)) return false
  for (let cell = 0; cell < status.length; cell++) {
    if (!(status[cell]! & 1)) amplitude.fill(0, cell * samples, (cell + 1) * samples)
  }
  return true
}
