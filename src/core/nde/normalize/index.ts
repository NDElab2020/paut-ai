/** 셋업 JSON(3.x/4.x) → 버전 무관 ScanPlanSpec + 기록용 수집 요약 */
import { SPEC_VERSION, type AcquisitionSummary, type BeamGroupSpec, type NdeFormatVersion, type NormalizedSetup, type ScanPlanSpec } from '@shared/types'
import { encoderAndPattern, groupAcquisition } from '../acquisition'
import { NdeError } from '../errors'
import { canonicalJson, fingerprint } from '../fingerprint'
import { isObj, objs, str, type Json } from '../json'
import { summarizeSpec } from '../naming'
import { parseNdeVersion } from '../read'
import { adaptGroups3, adaptGroups4, findDataMapping, mappingSpecimenId, type AcqGroup } from './adapt'
import { beamGroupSpec } from './beams'
import { normalizeSpecimen, pickSpecimen } from './specimen'

interface Built {
  spec: ScanPlanSpec
  groups: AcqGroup[]
  /** groups[i] 의 정준 순서 인덱스 */
  order: number[]
  warnings: string[]
}

function asSetup(setup: unknown): Json {
  if (!isObj(setup)) throw new NdeError('bad-setup-json', 'Setup 이 객체가 아님')
  return setup
}

/** 그룹 묶음은 이름이 아닌 내용(정준 JSON)으로 정렬 */
function sortGroups(specs: BeamGroupSpec[]): { sorted: BeamGroupSpec[]; order: number[] } {
  const keyed = specs.map((s, i) => ({ s, i, key: canonicalJson(s) }))
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
  const order = new Array<number>(specs.length)
  keyed.forEach((k, pos) => (order[k.i] = pos))
  return { sorted: keyed.map((k) => k.s), order }
}

function build(setup: Json, version: NdeFormatVersion): Built {
  const warnings: string[] = []
  const groups = version.family === '3.x' ? adaptGroups3(setup) : adaptGroups4(setup)
  if (groups.length === 0) warnings.push('빔 그룹이 없습니다.')
  if (objs(setup['specimens']).length > 1) warnings.push('시편이 여러 개라 첫 그룹이 쓰는 시편만 지문에 넣습니다.')
  const specimenId = mappingSpecimenId(findDataMapping(setup, groups[0]?.dataMappingId ?? null))
  const specimen = normalizeSpecimen(pickSpecimen(setup, specimenId), warnings)
  const { sorted, order } = sortGroups(groups.map((g) => beamGroupSpec(g, setup, warnings)))
  return { spec: { specVersion: SPEC_VERSION, specimen, groups: sorted }, groups, order, warnings }
}

function acquisitionOf(setup: Json, version: NdeFormatVersion, b: Built): AcquisitionSummary {
  return {
    groups: b.groups.map((g, i) => groupAcquisition(setup, g, b.order[i]!)),
    ...encoderAndPattern(setup, version, b.groups[0] ?? null)
  }
}

function versionOf(setup: Json, version?: NdeFormatVersion): NdeFormatVersion {
  return version ?? parseNdeVersion(str(setup['version']) ?? '')
}

/** 셋업 → 정규화 스펙 + 지문 + 수집 요약 */
export function normalizeSetup(setup: unknown, version?: NdeFormatVersion): NormalizedSetup {
  const s = asSetup(setup)
  const v = versionOf(s, version)
  const built = build(s, v)
  return {
    spec: built.spec,
    fingerprint: fingerprint(built.spec).fingerprint,
    acquisition: acquisitionOf(s, v, built),
    summary: summarizeSpec(built.spec),
    warnings: built.warnings
  }
}

/** 지문 제외 수집 설정 요약만 (그룹 인덱스는 정준 순서 기준) */
export function summarizeAcquisition(setup: unknown, version?: NdeFormatVersion): AcquisitionSummary {
  const s = asSetup(setup)
  const v = versionOf(s, version)
  return acquisitionOf(s, v, build(s, v))
}
