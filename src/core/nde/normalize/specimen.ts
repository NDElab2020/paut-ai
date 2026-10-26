/** (a) 시편·용접 형상 정규화 */
import type { AngleHeightSpec, CapSpec, SpecimenGeometrySpec, SpecimenShape, WeldGeometrySpec } from '@shared/types'
import { byId, obj, objs, str, type Json } from '../json'
import { deg, mm } from '../units'

export const SHAPES: ReadonlyArray<[key: string, shape: SpecimenShape]> = [
  ['plateGeometry', 'plate'],
  ['pipeGeometry', 'pipe'],
  ['barGeometry', 'bar'],
  ['unspecifiedGeometry', 'unspecified']
]

function cap(v: unknown): CapSpec | null {
  const o = obj(v)
  return o ? { widthMm: mm(o['width']), heightMm: mm(o['height']) } : null
}

function angleHeight(v: unknown): AngleHeightSpec | null {
  const o = obj(v)
  return o ? { angleDeg: deg(o['angle']), heightMm: mm(o['height']) } : null
}

function materialName(v: unknown): string | null {
  return str(obj(v)?.['name'])
}

function weld(v: unknown): WeldGeometrySpec | null {
  const w = obj(v)
  if (!w) return null
  const land = obj(w['land'])
  return {
    bevelShape: str(w['bevelShape']),
    symmetry: str(w['symmetry']),
    weldAngleDeg: deg(w['weldAngle']),
    upperCap: cap(w['upperCap']),
    lowerCap: cap(w['lowerCap']),
    hotPass: angleHeight(w['hotPass']),
    land: land ? { heightMm: mm(land['height']) } : null,
    root: angleHeight(w['root']),
    fills: objs(w['fills']).map((f) => angleHeight(f)!),
    materialName: materialName(w['material'])
  }
}

/** 배관 angularOpening 은 3.3 에서 생긴 선택 필드. 없으면 전체 원주로 본다 (펌웨어·저장 앱에 따라 생략됨) */
export const FULL_CIRCLE_DEG = 360

export const EMPTY_SPECIMEN: SpecimenGeometrySpec = {
  shape: 'unknown',
  thicknessMm: null,
  outerRadiusMm: null,
  angularOpeningDeg: null,
  materialName: null,
  weld: null
}

/** specimenId 로 시편 찾기 (없으면 첫 시편) */
export function pickSpecimen(setup: Json, specimenId: number | null): Json | null {
  return byId(setup['specimens'], specimenId) ?? objs(setup['specimens'])[0] ?? null
}

export function normalizeSpecimen(sp: Json | null, warnings: string[]): SpecimenGeometrySpec {
  if (!sp) {
    warnings.push('시편 형상 정보가 없습니다.')
    return EMPTY_SPECIMEN
  }
  const found = SHAPES.find(([k]) => obj(sp[k]) !== null)
  if (!found) {
    warnings.push('알 수 없는 시편 형상입니다.')
    return { ...EMPTY_SPECIMEN, weld: weld(sp['weldGeometry']) }
  }
  const [key, shape] = found
  const g = obj(sp[key])!
  // 봉(bar)은 두께 대신 지름 → 반지름을 outerRadiusMm 에 둔다
  const outerRadiusMm = shape === 'pipe' ? mm(g['outerRadius']) : shape === 'bar' ? halve(mm(g['diameter'])) : null
  return {
    shape,
    thicknessMm: mm(g['thickness']),
    outerRadiusMm,
    angularOpeningDeg: shape === 'pipe' ? (deg(g['angularOpening']) ?? FULL_CIRCLE_DEG) : null,
    materialName: materialName(g['material']),
    weld: weld(sp['weldGeometry'])
  }
}

function halve(v: number | null): number | null {
  return v === null ? null : mm(v / 2000)
}
