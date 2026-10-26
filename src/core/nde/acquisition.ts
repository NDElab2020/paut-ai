/** 기록용 수집 설정 요약 (지문 제외: 게인, 음속, 게이트, TCG, 보정 상태, 스캔 격자) */
import type { AcquisitionSummary, GateSummary, GroupAcquisitionSummary, NdeFormatVersion } from '@shared/types'
import { arr, int, isObj, num, obj, objs, str, type Json } from './json'
import type { AcqGroup } from './normalize/adapt'
import { findDataMapping } from './normalize/adapt'
import { round, us } from './units'

function gate(g: Json, fallbackName: string): GateSummary {
  const starts = arr(g['starts'])
  const lengths = arr(g['lengths'])
  return {
    name: str(g['name']) ?? fallbackName,
    startUs: us(g['start'] ?? starts[0]),
    lengthUs: us(g['length'] ?? lengths[0]),
    thresholdPercent: num(g['threshold']),
    geometry: str(g['geometry'])
  }
}

function boxGate(g: Json): GateSummary {
  return { name: `TFM 박스 게이트 ${int(g['id']) ?? ''}`.trim(), startUs: null, lengthUs: null, thresholdPercent: num(g['threshold']), geometry: 'TfmBox' }
}

function gatesOf(g: AcqGroup): GateSummary[] {
  const out = objs(g.body['gates']).map((x, i) => gate(x, `게이트 ${i + 1}`))
  for (const p of g.extraProcesses) {
    const ug = p['ultrasonicGates']
    const gates = isObj(ug) ? objs(ug['gates']) : objs(ug)
    out.push(...gates.map((x, i) => gate(x, `게이트 ${i + 1}`)))
    out.push(...objs(p['tfmBoxGates']).map(boxGate))
  }
  return out
}

function tcgEnabled(g: AcqGroup): boolean | null {
  if (g.extraProcesses.some((p) => isObj(p['ultrasonicTcg']))) return true
  const beams = objs(g.body['beams'])
  if (beams.length === 0) return g.kind === 'pa' || g.kind === 'ut' ? false : null
  return beams.some((b) => {
    const t = obj(b['tcg'])
    return t !== null && t['enabled'] !== false && arr(t['points']).length > 0
  })
}

function calibrations(body: Json): string[] {
  const names: string[] = []
  for (const s of objs(body['calibrationStates'])) {
    for (const [k, v] of Object.entries(s)) if (obj(v)?.['calibrated'] === true) names.push(k)
  }
  return names
}

function gridDims(setup: Json, g: AcqGroup): { scan: Json | null; index: Json | null } {
  const grid = obj(findDataMapping(setup, g.dataMappingId)?.['discreteGrid'])
  const dims = objs(grid?.['dimensions'])
  const scan = dims.find((d) => d['name'] === 'Scan') ?? dims.find((d) => d['axis'] === 'UCoordinate') ?? null
  const index = dims.find((d) => d !== scan) ?? null
  return { scan, index }
}

function perMega(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : round(n / 1e6, 0.01)
}

/** m → mm (기록용, 0.001 mm) */
function toMm(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : round(n * 1000, 0.001)
}

function beamCount(g: AcqGroup): number | null {
  if (g.kind === 'ut') return 1
  const n = objs(g.body['beams']).length
  return n > 0 ? n : null
}

export function groupAcquisition(setup: Json, g: AcqGroup, specGroupIndex: number): GroupAcquisitionSummary {
  const b = g.body
  const { scan, index } = gridDims(setup, g)
  const softwareGain = g.extraProcesses.map((p) => num(p['gain'])).find((v) => v !== null) ?? null
  return {
    groupName: g.name ?? `그룹 ${g.groupId ?? specGroupIndex + 1}`,
    specGroupIndex,
    gainDb: round(b['gain'], 0.1) ?? softwareGain,
    referenceGainDb: round(b['referenceGain'], 0.1),
    velocityMps: round(b['velocity'], 0.1),
    beamCount: beamCount(g),
    digitizingFrequencyMHz: perMega(b['digitizingFrequency'] ?? g.capture?.['digitizingFrequency']),
    tcgEnabled: tcgEnabled(g),
    gates: gatesOf(g),
    scanQuantity: int(scan?.['quantity']),
    scanResolutionMm: toMm(scan?.['resolution']),
    indexQuantity: int(index?.['quantity']),
    indexResolutionMm: toMm(index?.['resolution']),
    calibrations: calibrations(b)
  }
}

export function encoderAndPattern(setup: Json, version: NdeFormatVersion, firstGroup: AcqGroup | null): Omit<AcquisitionSummary, 'groups'> {
  const mapping = findDataMapping(setup, firstGroup?.dataMappingId ?? null)
  const grid = obj(mapping?.['discreteGrid'])
  const deviceId = int(objs(grid?.['dimensions'])[0]?.['motionDeviceId'])
  const devices = objs(setup['motionDevices'])
  const device = devices.find((d) => int(d['id']) === deviceId) ?? devices[0] ?? null
  const enc = obj(device?.['encoder'])
  const step = num(enc?.['stepResolution'])
  // 3.x: step/mm, 4.x: step/m (스펙 4.0 변경 사항)
  const perMm = step === null ? null : version.family === '4.x' ? step / 1000 : step
  return {
    encoder: enc ? { mode: str(enc['mode']), stepResolutionPerMm: round(perMm, 0.0001) } : null,
    scanPattern: str(grid?.['scanPattern'])
  }
}
