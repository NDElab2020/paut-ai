/**
 * 3.x / 4.x 그룹 구조를 공통 중간형(AcqGroup)으로 옮긴다.
 *
 * 매핑 근거 (공식 스펙 site/docs/versioning/version-4.0/transitioning-3.3-4.0/upgrade-json-setup.md):
 *  - 3.x group.paut  → 4.x processes[].ultrasonicPhasedArray   (같은 객체가 이름만 바뀌어 process 안으로)
 *  - 3.x group.ut    → 4.x processes[].ultrasonicConventional  (ut.refractedAngle·ascanStart 는 beams[0] 으로 이동)
 *  - 3.x group.fmc(+tfmDescriptions[]) → 4.x ultrasonicMatrixCapture 그룹 1개 + totalFocusingMethod 그룹 N개
 *    (TFM 그룹의 inputs[].groupId 가 캡처 그룹을 가리킴). 그래서 3.x tfmDescriptions 항목 하나 = 4.x TFM 그룹 하나로 맞춘다.
 *  - 3.x planeWaveCapture → 4.x ultrasonicMatrixCapture(acquisitionPattern 'PWI')
 *  - 3.x paut/ut.softwareProcess → 4.x thickness / tfmBoxGates 등 software process (지문 무관)
 *  - 3.x dataEncodings[].discreteGrid.specimenId → 4.x dataMappings[].specimenId (한 단계 위로)
 */
import type { ProbeRole } from '@shared/types'
import { arr, byId, firstKey, int, isObj, obj, objs, str, type Json } from '../json'

export type AcqKind = 'pa' | 'ut' | 'tfm' | 'capture' | 'other'

export interface AcqGroup {
  /** 파일 안 그룹 id (3.x TFM 은 fmc 그룹 id) */
  groupId: number | null
  name: string | null
  kind: AcqKind
  /** paut / ultrasonicPhasedArray / ut / ultrasonicConventional / tfmDescription / totalFocusingMethod / 캡처 객체 */
  body: Json
  /** UT 단일 굴절각 (3.x ut.refractedAngle, 4.x beams[0].refractedAngle) */
  utRefractedAngle: number | null
  /** TFM/캡처: 'FMC' | 'PWI' ... */
  capturePattern: string | null
  /** TFM/캡처: 캡처 객체 (3.x fmc / 4.x ultrasonicMatrixCapture) */
  capture: Json | null
  /** 캡처에서 쓰는 탐촉자 (역할, id). 송신만 = pulser, 수신만 = receiver, 둘 다 = pulseEcho */
  captureProbes: Array<[ProbeRole, number]>
  dataMappingId: number | null
  /** 4.x software process (ultrasonicGates, ultrasonicTcg, tfmBoxGates, thickness, gain ...) / 3.x softwareProcess */
  extraProcesses: Json[]
  /** 지원하지 않는 기법 키 (예: 'eddyCurrent'). 지원이면 null */
  unsupportedKey: string | null
}

function base(g: Json, kind: AcqKind, body: Json): AcqGroup {
  return {
    groupId: int(g['id']),
    name: str(g['name']),
    kind,
    body,
    utRefractedAngle: null,
    capturePattern: null,
    capture: null,
    captureProbes: [],
    dataMappingId: null,
    extraProcesses: [],
    unsupportedKey: null
  }
}

const GROUP_META_KEYS = new Set(['id', 'name', 'usage', 'dataset', 'datasets', 'processes'])

// ───────────── 3.x ─────────────

function softwareProcesses3(body: Json): Json[] {
  const sp = obj(body['softwareProcess'])
  return sp ? [sp] : []
}

function tfmFromCapture3(g: Json, capture: Json, pattern: string): AcqGroup[] {
  const probeId = int(capture['probeId'])
  const descs = objs(capture['tfmDescriptions'])
  const mk = (kind: AcqKind, body: Json, name: string | null): AcqGroup => ({
    ...base(g, kind, body),
    name: name ?? str(g['name']),
    capturePattern: pattern,
    capture,
    captureProbes: probeId === null ? [] : [['pulseEcho', probeId]],
    dataMappingId: int(capture['dataEncodingId']),
    extraProcesses: kind === 'tfm' ? softwareProcesses3(body) : []
  })
  if (descs.length === 0) return [mk('capture', capture, null)]
  return descs.map((d) => mk('tfm', d, str(d['name'])))
}

export function adaptGroups3(setup: Json): AcqGroup[] {
  const out: AcqGroup[] = []
  for (const g of objs(setup['groups'])) {
    const paut = obj(g['paut'])
    const ut = obj(g['ut'])
    const fmc = obj(g['fmc'])
    const pwc = obj(g['planeWaveCapture'])
    if (paut) {
      out.push({ ...base(g, 'pa', paut), dataMappingId: int(paut['dataEncodingId']), extraProcesses: softwareProcesses3(paut) })
    } else if (ut) {
      out.push({
        ...base(g, 'ut', ut),
        utRefractedAngle: typeof ut['refractedAngle'] === 'number' ? ut['refractedAngle'] : null,
        dataMappingId: int(ut['dataEncodingId']),
        extraProcesses: softwareProcesses3(ut)
      })
    } else if (fmc) {
      out.push(...tfmFromCapture3(g, fmc, 'FMC'))
    } else if (pwc) {
      out.push(...tfmFromCapture3(g, pwc, 'PWI'))
    } else {
      const key = Object.keys(g).find((k) => !GROUP_META_KEYS.has(k)) ?? 'datasetOnly'
      out.push({ ...base(g, 'other', {}), unsupportedKey: key })
    }
  }
  return out
}

// ───────────── 4.x ─────────────

const ACQ_KEYS = ['ultrasonicPhasedArray', 'ultrasonicConventional', 'totalFocusingMethod', 'ultrasonicMatrixCapture'] as const
const PROCESS_META_KEYS = new Set(['id', 'inputs', 'outputs', 'dataMappingId', 'implementation'])

function processKey(p: Json): string | null {
  return Object.keys(p).find((k) => !PROCESS_META_KEYS.has(k) && (isObj(p[k]) || Array.isArray(p[k]))) ?? null
}

function captureProbes4(capture: Json): Array<[ProbeRole, number]> {
  const sends = new Set<number>()
  const receives = new Set<number>()
  for (const b of objs(capture['beams'])) {
    for (const el of objs(b['pulsers'])) {
      const id = int(el['probeId'])
      if (id !== null) sends.add(id)
    }
    for (const el of objs(b['receivers'])) {
      const id = int(el['probeId'])
      if (id !== null) receives.add(id)
    }
  }
  const ids = [...new Set([...sends, ...receives])].sort((a, b) => a - b)
  return ids.map((id): [ProbeRole, number] => [sends.has(id) && receives.has(id) ? 'pulseEcho' : sends.has(id) ? 'pulser' : 'receiver', id])
}

/** TFM process 의 입력 캡처 (다른 그룹 또는 같은 그룹의 process) */
function findCapture4(groups: Json[], g: Json, tfmProcess: Json): Json | null {
  for (const input of objs(tfmProcess['inputs'])) {
    const srcGroup = int(input['groupId']) === null ? g : byId(groups, int(input['groupId']))
    const src = byId(srcGroup?.['processes'], int(input['processId']))
    const cap = obj(src?.['ultrasonicMatrixCapture'])
    if (cap) return cap
  }
  return null
}

/** 다른 그룹의 TFM 이 입력으로 쓰는 그룹 id (자체 데이터셋이 없으면 묶음에서 뺀다) */
function consumedGroupIds(groups: Json[]): Set<number> {
  const ids = new Set<number>()
  for (const g of groups) {
    for (const p of objs(g['processes'])) {
      for (const input of objs(p['inputs'])) {
        const gid = int(input['groupId'])
        if (gid !== null && gid !== int(g['id'])) ids.add(gid)
      }
    }
  }
  return ids
}

export function adaptGroups4(setup: Json): AcqGroup[] {
  const groups = objs(setup['groups'])
  const consumed = consumedGroupIds(groups)
  const out: AcqGroup[] = []
  for (const g of groups) {
    const processes = objs(g['processes'])
    const acq = processes.find((p) => firstKey(p, ACQ_KEYS) !== null) ?? null
    const key = acq ? firstKey(acq, ACQ_KEYS) : null
    const extras = processes.filter((p) => p !== acq)
    if (!acq || !key) {
      const first = processes[0]
      out.push({ ...base(g, 'other', {}), unsupportedKey: (first && processKey(first)) ?? 'unknown' })
      continue
    }
    const body = obj(acq[key])!
    const common = { dataMappingId: int(acq['dataMappingId']), extraProcesses: extras }
    if (key === 'ultrasonicPhasedArray') {
      out.push({ ...base(g, 'pa', body), ...common })
    } else if (key === 'ultrasonicConventional') {
      const beam0 = objs(body['beams'])[0]
      const angle = beam0?.['refractedAngle']
      out.push({ ...base(g, 'ut', body), ...common, utRefractedAngle: typeof angle === 'number' ? angle : null })
    } else if (key === 'totalFocusingMethod') {
      const capture = findCapture4(groups, g, acq)
      out.push({
        ...base(g, 'tfm', body),
        ...common,
        capture,
        capturePattern: str(capture?.['acquisitionPattern']) ?? 'FMC',
        captureProbes: capture ? captureProbes4(capture) : []
      })
    } else {
      const gid = int(g['id'])
      const hasOwnData = arr(g['datasets']).length > 0
      if (gid !== null && consumed.has(gid) && !hasOwnData) continue
      out.push({
        ...base(g, 'capture', body),
        ...common,
        capture: body,
        capturePattern: str(body['acquisitionPattern']) ?? 'FMC',
        captureProbes: captureProbes4(body)
      })
    }
  }
  return out
}

/** 그룹 묶음이 쓰는 dataMapping(3.x dataEncoding) */
export function findDataMapping(setup: Json, id: number | null): Json | null {
  const list = setup['dataMappings'] ?? setup['dataEncodings']
  return byId(list, id) ?? objs(list)[0] ?? null
}

/** dataMapping 의 discreteGrid (3.x 는 specimenId 가 discreteGrid 안, 4.x 는 한 단계 위) */
export function mappingSpecimenId(mapping: Json | null): number | null {
  if (!mapping) return null
  return int(mapping['specimenId']) ?? int(obj(mapping['discreteGrid'])?.['specimenId'])
}
