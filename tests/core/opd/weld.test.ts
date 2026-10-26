import { describe, expect, it } from 'vitest'
import { parseOpdParts } from '@core/opd'
import { normalizeOpd, opdNameParts, opdThicknessSuspect } from '@core/opd/normalize'
import { buildOpdViewerInfo, OPD_VIEWER_NOTES } from '@core/opd/viewer'
import { bevelHalfWidth, isDrawableWeld } from '@shared/imaging/weld'
import { SelfCheckAccumulator } from '@core/opd/selfcheck'
import { buildSynthOpd } from './synth'

/** 실제 tail typed 레코드의 문법으로 설정을 만든다. 이름 count는 바이트 길이이고 자식 수가 아니다. */
function withTables(opts: {
  template?: number; symmetry?: number; shape?: number; material?: number; probeCounts?: [number, number]; thicknessMm?: number
  /** 용접 숫자 (m·°) — 기본은 PL2386x 양면 V: Hot Pass 0.0115 / Root 0.0115 / Root 각 30 */
  weld?: { hotPass?: number; root?: number; rootAngle?: number }
} = {}) {
  const syn = buildSynthOpd()
  const prefix = syn.bytes.slice()
  const dv = new DataView(prefix.buffer)
  const tuples: number[][] = []
  let namePos = 0x300
  const group = (name: string, fields: number[][]): number => {
    const tableOffset = tuples.length * 16
    const at = namePos
    for (const c of `${name}\0`) { dv.setUint16(namePos, c.charCodeAt(0), true); namePos += 2 }
    tuples.push([0x13eb0, 2 * (name.length + 1), at, 0], ...fields)
    return tableOffset
  }
  const scalar = (tag: number, value: number): number[] => [tag, 1, value, 0]
  const w = { hotPass: 0.0115, root: 0.0115, rootAngle: 30, ...opts.weld }
  for (const [rel, value] of [[-0x510, (opts.thicknessMm ?? 25) / 1000], [-0x4d8, w.hotPass], [-0x4d0, 0.002], [-0x4c8, w.root], [-0x4c0, 30], [-0x4b8, w.rootAngle], [-0x508, 0.001]] as const) {
    dv.setFloat64(syn.anchor + rel, value, true)
  }
  group('Weld_GROUP', [scalar(0xb3ebf, syn.anchor - 0x510), scalar(0xb3fbf, syn.anchor - 0x508),
    scalar(0xb47bf, syn.anchor - 0x4d8), scalar(0xb48bf, syn.anchor - 0x4d0), scalar(0xb49bf, syn.anchor - 0x4c8),
    scalar(0xb4abf, syn.anchor - 0x4c0), scalar(0xb4bbf, syn.anchor - 0x4b8), scalar(0x74cbf, opts.template ?? 5), scalar(0x74dbf, opts.symmetry ?? 0)])
  group('SpecimenInformation_GROUP', [scalar(0x740dd, opts.shape ?? 0), scalar(0x742dd, opts.material ?? 30)])
  // 0x742E2는 파 모드로 확정되지 않은 코드. 코드 2를 Shear라고 추측하면 안 된다.
  group('GroupUT_GROUP', [scalar(0xb3ee2, syn.anchor - 0x3f8), scalar(0x742e2, 2)])
  for (const n of opts.probeCounts ?? [64, 64]) group('ProbeUT_Container_GROUP', [scalar(0x641b6, n)])
  for (let b = 0; b < syn.options.beams; b++) {
    const offsets = [20, 10, 30].map((v) => group('FblUT_Gate_GROUP', [scalar(0x240bb, 0x12345600 + v)]))
    const name = `A:${(45 + b).toFixed(2)} Sk:090 L:${String(b + 1).padStart(3, '0')}`
    const at = namePos
    for (const c of `${name}\0`) { dv.setUint16(namePos, c.charCodeAt(0), true); namePos += 2 }
    group('FblUT_Context_GROUP', [[0x149b9, 2 * (name.length + 1), at, 0], ...offsets.map((o) => [0x3dbb, 16, o, 0])])
  }
  const bytes = new Uint8Array(tuples.length * 16)
  const tdv = new DataView(bytes.buffer)
  tuples.forEach((tuple, i) => tuple.forEach((v, k) => tdv.setUint32(i * 16 + k * 4, v!, true)))
  return parseOpdParts({ prefix, fileSize: prefix.length, index: null, typedTables: { bytes, offset: 0 } })
}

describe('OPD typed 설정 · 개선 화면 대조', () => {
  it('Double V-Offset 화면의 Hot Pass/Land/Root를 각각 읽어 25 mm를 만들고 뷰어·지문에 전달한다', () => {
    const file = withTables()
    expect(file.setup.weld).toMatchObject({ templateCode: 5, templateName: 'DoubleVOffset', symmetryCode: 0, symmetryName: 'Symmetric',
      hotPass: { heightMm: 11.5, angleDeg: 30 }, land: { heightMm: 2, offsetMm: 1 }, root: { heightMm: 11.5, angleDeg: 30 } })
    expect(file.setup.specimen).toEqual({ shapeCode: 0, shape: 'plate', shapeEstimated: true, materialCode: 30, materialName: 'STEEL, MILD', materialEstimated: true })
    expect(file.setup.weld).toMatchObject({ bevelShape: 'X', templateEstimated: false })
    expect(file.setup.probe.elementCount).toBe(64)
    expect(file.setup.waveMode).toBeNull()
    expect(file.setup.weld?.derivedFillHeightMm).toBeCloseTo(0, 9)
    expect(file.beams.every((b) => b.gates.map((g) => g.thresholdPct).join(',') === '20,10,30')).toBe(true)
    expect(file.setup.raw['Weld_GROUP[0]:0xb49bf']).toBe(0.0115)
    const norm = normalizeOpd(file)
    expect(opdThicknessSuspect(norm.spec)).toBe(false)
    // 양면 V: 두께 25 = 위 11.5 + Land 2 + 아래 11.5 → '두께 확인 필요' 없음, 요약에 'X 개선'
    expect(norm.summary).toContain('판재 25 mm · X 개선 · ')
    expect(norm.summary).toContain('개선 높이 11.5+2+11.5 mm')
    expect(norm.summary).not.toContain('두께 확인')
    expect(norm.spec.specimen.weld).toMatchObject({ bevelShape: 'X', template: 'DoubleVOffset', offsetMm: 1, hotPass: { angleDeg: 30, heightMm: 11.5 } })
    // 판재·재질은 코드 이름이 추정, Double V-Offset 은 같은 파일 화면으로 확인
    expect(norm.spec.specimen.estimatedFields).toEqual(['shape', 'materialName'])
    expect(norm.warnings.some((w) => w.includes("'추정'으로 둔 칸: 시편 형상(판재 — 코드 0), 재질(STEEL, MILD — 코드 30)."))).toBe(true)
    expect(buildOpdViewerInfo(file, null).specimen.weld).toMatchObject({ bevelShape: 'X', template: 'DoubleVOffset', geometryEstimated: false, root: { heightMm: 11.5 }, overlayNote: '덮개 추정' })
    expect(buildOpdViewerInfo(file, null).groups[0]!.gates.map((g) => g.thresholdPct)).toEqual([20, 10, 30])
    expect(file.warnings.some((w) => w.startsWith('두께 칸'))).toBe(false)
  })

  it('미해독 코드와 Cap/HAZ/Fill을 숫자 0이나 이름으로 꾸미지 않고 원값·지문 차이를 보존한다', () => {
    const file = withTables({ template: 7, symmetry: 9, shape: 4, material: 999 })
    const norm = normalizeOpd(file)
    expect(file.setup.weld).toMatchObject({ templateCode: 7, templateName: null, templateEstimated: false, bevelShape: null, symmetryCode: 9, symmetryName: null, upperCap: null, lowerCap: null, hazWidthMm: null, fill: null })
    expect(norm.spec.specimen).toMatchObject({ shape: 'unknown', materialName: null, weld: { bevelShape: null, symmetry: null, template: null, templateCode: 7, symmetryCode: 9 } })
    expect(norm.spec.specimen.estimatedFields).toBeUndefined()
    expect(norm.spec.groups[0]!.techniqueParams).toMatchObject({ opdShapeCode: 4, opdMaterialCode: 999, opdWaveModeCode: 2 })
    expect(norm.fingerprint).not.toBe(normalizeOpd(withTables({ template: 999, symmetry: 9, shape: 4, material: 999 })).fingerprint)
    expect(buildOpdViewerInfo(file, null).specimen.weld).toMatchObject({ bevelShape: 'unknown', geometryEstimated: true })
  })

  it('틀 코드 6 = 한면 V(V-Offset): 모양 V 로 요약·이름·덮개에 보이고 템플릿 이름에는 추정 표시', () => {
    // TP01~TP10 꼴 (12t SV): 두께 12 = Hot Pass 10 + Land 2, Root 0
    const file = withTables({ template: 6, thicknessMm: 12, weld: { hotPass: 0.01, root: 0, rootAngle: 0 } })
    expect(file.setup.weld).toMatchObject({ templateCode: 6, templateName: 'VOffset', templateEstimated: true, bevelShape: 'V', symmetryName: 'Symmetric' })
    const norm = normalizeOpd(file)
    expect(norm.spec.specimen.weld).toMatchObject({ bevelShape: 'V', template: 'VOffset', templateCode: 6, symmetry: 'Symmetric', root: { heightMm: 0 } })
    expect(norm.spec.specimen.estimatedFields).toEqual(['shape', 'materialName', 'weld.template'])
    expect(norm.summary).toBe('판재 12 mm · V 개선 · 5L64-A32 · -14 mm · PA 섹터 45–48° · 집속 20 mm · 개선 높이 10+2 mm · OPD')
    expect(opdNameParts(norm.spec)).toEqual(['집속 20', 'V개선 10+2'])
    expect(norm.warnings.some((w) => w.includes('개선 템플릿(V-Offset — 코드 6)'))).toBe(true)
    expect(norm.warnings.some((w) => w.includes('이름을 아직 대조하지 못했습니다'))).toBe(false)
    const info = buildOpdViewerInfo(file, null)
    expect(info.specimen.weld).toMatchObject({ bevelShape: 'V', template: 'VOffset', geometryEstimated: false, overlayNote: '덮개 추정' })
    expect(info.warnings).toContain(OPD_VIEWER_NOTES.templateEstimated)
    // 그릴 수 있는 V 덮개 (기존 V 계산 — 루트 0 이라 Land 위 Hot Pass 만)
    const weld = info.specimen.weld!
    expect(isDrawableWeld(weld, 12)).toBe(true)
    expect(bevelHalfWidth(weld, 12, 12)).toBeCloseTo(1, 9)
    expect(bevelHalfWidth(weld, 12, 0)).toBeCloseTo(1 + 10 * Math.tan(Math.PI / 6), 9)
    // 같은 숫자에 틀 코드만 5 ↔ 6 이면 지문이 다르다 (X·V 를 섞지 않음)
    expect(normalizeOpd(withTables({ template: 5, thicknessMm: 12, weld: { hotPass: 0.01, root: 0, rootAngle: 0 } })).fingerprint).not.toBe(norm.fingerprint)
  })

  it('양면 V 덮개: 바닥 → Root → Land → Hot Pass 순으로 반폭을 잰다 (PL2386x 꼴)', () => {
    const weld = buildOpdViewerInfo(withTables(), null).specimen.weld!
    const tan30 = Math.tan(Math.PI / 6)
    expect(isDrawableWeld(weld, 25)).toBe(true)
    expect(bevelHalfWidth(weld, 25, 25)).toBeCloseTo(1 + 11.5 * tan30, 9) // 바닥면: 아래쪽 개선이 가장 넓음
    expect(bevelHalfWidth(weld, 25, 13.5)).toBeCloseTo(1, 9) // Land 아래 끝
    expect(bevelHalfWidth(weld, 25, 11.5)).toBeCloseTo(1, 9) // Land 위 끝
    expect(bevelHalfWidth(weld, 25, 0)).toBeCloseTo(1 + 11.5 * tan30, 9) // 겉면
  })

  it('송·수신 탐촉자 소자 수가 다르면 모델명으로 메우지 않는다', () => {
    const file = withTables({ probeCounts: [64, 32] })
    expect(file.setup.probe.elementCountFromModel).toBe(64)
    expect(file.setup.probe.elementCount).toBeNull()
    expect(normalizeOpd(file).spec.groups[0]!.probes[0]!.probe.elementCount).toBeNull()
  })

  it('양의 Fill 잔여 높이는 계산값으로 남기고 두께 불일치로 단정하지 않는다', () => {
    const file = withTables({ thicknessMm: 30 })
    const norm = normalizeOpd(file)
    expect(file.setup.weld?.derivedFillHeightMm).toBeCloseTo(5, 9)
    expect(norm.spec.specimen.weld).toMatchObject({ derivedFillHeightMm: 5, fills: [{ heightMm: 5, angleDeg: null }] })
    expect(opdThicknessSuspect(norm.spec)).toBe(false)
    expect(file.warnings.some((w) => w.startsWith('두께 칸'))).toBe(false)
    const check = new SelfCheckAccumulator(file).finish(0)
    expect(check.passed.thickness).toBeNull()
    expect(check.notes.some((n) => n.includes('Fill 높이 계산값'))).toBe(true)
    expect(buildOpdViewerInfo(file, check).specimen.weld?.geometryEstimated).toBe(true)
  })
})
