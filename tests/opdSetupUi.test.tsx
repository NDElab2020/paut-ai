import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AcquisitionSummary, ScanPlan, ScanPlanSpec, SpecimenSummary } from '@shared/types'
import { matchesAllTerms } from '@shared/text'
import { SetupPanels } from '../src/renderer/src/components/SetupPanels'
import { SetupDiagram } from '../src/renderer/src/components/SetupDiagram'
import { setupWeldGeometry } from '../src/renderer/src/components/setupWeldGeometry'
import { FileAcquisitionRows } from '../src/renderer/src/modules/plans/FileDetail'
import { SpecimenPlanSummary, specimenSearchFields } from '../src/renderer/src/modules/specimens'

const spec: ScanPlanSpec = {
  specVersion: 2,
  specimen: {
    shape: 'unknown', thicknessMm: 25, outerRadiusMm: null, angularOpeningDeg: null, materialName: null,
    weld: {
      bevelShape: null, template: null, symmetry: null, templateCode: 123, symmetryCode: 456, weldAngleDeg: null,
      hotPass: { heightMm: 11.5, angleDeg: 30 }, land: { heightMm: 2 }, offsetMm: 1,
      root: { heightMm: 11.5, angleDeg: 30 }, derivedFillHeightMm: 0, fills: [], upperCap: null, lowerCap: null, hazWidthMm: null, materialName: null
    }
  },
  groups: [{
    technique: 'PA', formation: 'sectorial', firstElement: 1, aperture: 16, elementStep: null,
    refractedAngle: { startDeg: 45, stopDeg: 70, stepDeg: 1 }, focusing: { mode: null, distanceMm: 25 }, waveMode: null,
    probes: [{
      role: 'pulseEcho', orientation: 'Normal',
      probe: { model: '5L64-A32', kind: 'phasedArrayLinear', centralFrequencyMHz: 5, elementCount: null, pitchMm: 0.6 },
      wedge: { model: 'SA32-N55S', kind: 'angleBeam', wedgeAngleDeg: 36.1 },
      position: { uOffsetMm: null, vOffsetMm: -18, skewDeg: 90, surface: null }
    }],
    techniqueParams: { dataFormat: 'opd', opdSpecRule: 2, weldTemplateCode: 123, weldSymmetryCode: 456 }
  }]
}

const acquisition: AcquisitionSummary = {
  encoder: null, scanPattern: null,
  groups: [{
    groupName: 'PA 1', specGroupIndex: 0, gainDb: 32, referenceGainDb: null, velocityMps: 3240, beamCount: 26,
    digitizingFrequencyMHz: null, tcgEnabled: false, scanQuantity: 300, scanResolutionMm: 1, indexQuantity: null,
    indexResolutionMm: null, calibrations: [], gates: [{ name: 'Gate A', startUs: 6.2, lengthUs: 10.4, thresholdPercent: null, geometry: 'TrueDepth' }]
  }]
}

describe('OPD 셋업 상세 표시', () => {
  it('핫패스·랜드·루트를 각각 보이고 미해독 이름을 확정하지 않는다', () => {
    const html = renderToStaticMarkup(createElement(SetupPanels, { spec, groupNames: ['PA 1'] }))
    expect(html).toContain('핫패스 · 높이 / 각도')
    expect(html).toContain('랜드 · 높이 / 오프셋')
    expect(html).toContain('루트 · 높이 / 각도')
    expect(html.match(/11\.5/g)).toHaveLength(2)
    expect(html).toContain('<dt>개선 템플릿</dt><dd>모름</dd>')
    expect(html).toContain('<dt>대칭 방식</dt><dd>모름</dd>')
    expect(html).not.toContain('Double V')
    expect(html).not.toContain('weldTemplateCode')
    expect(html).not.toContain('채움 높이·랜드는 뜻을 확정하지 못한')
    expect(html).toContain('(층 높이에서 계산)')
    expect(html).toContain('<dt>채움 각도</dt><dd>모름</dd>')
    expect(html).toContain('<dt>열영향부 폭</dt><dd>모름</dd>')
  })

  it('숫자 치수로 그린 대칭 단면을 근사로 밝히고 시편 형상을 판재로 단정하지 않는다', () => {
    const weld = setupWeldGeometry(spec)!
    expect(weld.geometryEstimated).toBe(true)
    expect(weld.symmetry).toBeNull()
    expect(weld.template).toBeNull()
    expect(weld.offsetMm).toBe(1)
    expect(weld.root).toEqual({ heightMm: 11.5, angleDeg: 30 })
    const html = renderToStaticMarkup(createElement(SetupDiagram, { spec, groupNames: ['PA 1'] }))
    expect(html).toContain('class="diagram__weld"')
    expect(html).toContain('대칭으로 그린 참고 단면')
    expect(html).toContain('시편 형상 모름 · 펼친 단면')
    expect(html).not.toContain('판재')
  })

  it('원본 게이트 수치·대표 시간·수집 범위를 보이고 모르는 문턱과 동기는 모름으로 보인다', () => {
    const html = renderToStaticMarkup(createElement(FileAcquisitionRows, { acquisition, opd: true }))
    expect(html).toContain('6.200')
    expect(html).toContain('10.400')
    expect(html).toContain('깊이 기준')
    expect(html).toContain('문턱 모름')
    expect(html).toContain('동기 방식 모름')
    expect(html).toContain('300칸')
    expect(html).toContain('299.0')
    expect(html).toContain('26빔')
    expect(html).toContain('시작·마지막 측정 위치 모름')
    expect(html).not.toContain('마지막 측정 위치 299.0')
    expect(html).not.toContain('명목값')
  })

  it('OPD 엔코더 동기와 실제 첫·마지막 측정 위치를 보이고 스캔 상한을 마지막 측정점으로 착각하지 않는다', () => {
    const encoded: AcquisitionSummary = {
      ...acquisition, encoder: { mode: 'Encoder', stepResolutionPerMm: 33.2 },
      groups: [{ ...acquisition.groups[0]!, scanQuantity: 800, scanResolutionMm: 1, scanStartMm: 1, scanLastPointMm: 800 }]
    }
    const html = renderToStaticMarkup(createElement(FileAcquisitionRows, { acquisition: encoded, opd: true }))
    expect(html).toContain('엔코더 동기')
    expect(html).toContain('33.200')
    expect(html).toMatch(/시작 1\.0 <span class="unit">mm<\/span>/)
    expect(html).toMatch(/마지막 측정 위치 800\.0 <span class="unit">mm<\/span>/)
    expect(html).not.toContain('마지막 측정 위치 801')
    expect(html).not.toContain('명목값')
    // 기존 NDE의 동기 값과 범위 표시는 유지한다.
    const nde = renderToStaticMarkup(createElement(FileAcquisitionRows, { acquisition: encoded, opd: false }))
    expect(nde).toContain('Encoder')
    expect(nde).not.toContain('엔코더 동기')
    expect(nde).not.toContain('마지막 측정 위치')
  })

  it('OPD 시간 동기의 위치는 명목값이라고 보이고 엔코더 측정값으로 설명하지 않는다', () => {
    const timed: AcquisitionSummary = {
      ...acquisition, encoder: { mode: 'Time', stepResolutionPerMm: null },
      groups: [{ ...acquisition.groups[0]!, scanStartMm: 0, scanLastPointMm: 299 }]
    }
    const html = renderToStaticMarkup(createElement(FileAcquisitionRows, { acquisition: timed, opd: true }))
    expect(html).toContain('시간 동기')
    expect(html).toContain('명목값')
    expect(html).toContain('엔코더로 측정한 위치가 아닙니다')
    expect(html).toMatch(/시작 0\.0 <span class="unit">mm<\/span>/)
    expect(html).toMatch(/마지막 측정 위치 299\.0 <span class="unit">mm<\/span>/)
    expect(html).not.toContain('엔코더 동기')
    expect(html).not.toContain('step/mm')
  })

  it('확인된 Double V-Offset는 템플릿 이름으로 보이고 치수가 안 맞으면 참고 단면을 그리지 않는다', () => {
    const confirmed: ScanPlanSpec = { ...spec, specimen: { ...spec.specimen, shape: 'plate', weld: { ...spec.specimen.weld!, template: 'DoubleVOffset', symmetry: 'Symmetric' } } }
    expect(setupWeldGeometry(confirmed)?.geometryEstimated).toBeUndefined()
    const confirmedHtml = renderToStaticMarkup(createElement(SetupDiagram, { spec: confirmed, groupNames: ['PA 1'] }))
    expect(confirmedHtml).toContain('Double V-Offset 개선')
    expect(confirmedHtml).not.toContain('참고 단면')
    const mismatch: ScanPlanSpec = { ...spec, specimen: { ...spec.specimen, thicknessMm: 26 } }
    const mismatchHtml = renderToStaticMarkup(createElement(SetupDiagram, { spec: mismatch, groupNames: ['PA 1'] }))
    expect(mismatchHtml).not.toContain('class="diagram__weld"')
    expect(mismatchHtml).toContain('용접 치수 확인 필요 · 참고 단면 없음')
  })

  it('틀 코드 6 = 한면 V: 개선 모양 V 를 보이고 판재·재질·템플릿 이름에 (추정)을 붙인다 — 도식도 V 단면', () => {
    const v: ScanPlanSpec = {
      ...spec,
      specimen: {
        ...spec.specimen, shape: 'plate', thicknessMm: 25, materialName: 'STEEL, MILD', estimatedFields: ['shape', 'materialName', 'weld.template'],
        weld: { ...spec.specimen.weld!, bevelShape: 'V', template: 'VOffset', templateCode: 6, symmetry: 'Symmetric', symmetryCode: 0,
          hotPass: { heightMm: 23, angleDeg: 30 }, root: { heightMm: 0, angleDeg: 0 } }
      }
    }
    const html = renderToStaticMarkup(createElement(SetupPanels, { spec: v, groupNames: ['PA 1'] }))
    expect(html).toMatch(/<dt>형상<\/dt><dd>판재<span class="text-subtle"[^>]*> \(추정\)<\/span><\/dd>/)
    expect(html).toMatch(/<dt>재질<\/dt><dd>STEEL, MILD<span class="text-subtle"[^>]*> \(추정\)<\/span><\/dd>/)
    expect(html).toContain('<dt>개선</dt><dd>V · 한면 개선</dd>')
    expect(html).toMatch(/<dt>개선 템플릿<\/dt><dd>V-Offset<span class="text-subtle"[^>]*> \(추정\)<\/span><\/dd>/)
    expect(html).toContain('<dt>대칭 방식</dt><dd>대칭</dd>')
    expect(html).toContain('형상·재질·개선 템플릿 이름은 파일 코드로 정했지만 다른 값을 가진 파일이 없어 추정입니다.')
    const diagram = renderToStaticMarkup(createElement(SetupDiagram, { spec: v, groupNames: ['PA 1'] }))
    expect(diagram).toContain('class="diagram__weld"')
    expect(diagram).toContain('판재 (추정) · V-Offset 개선 (추정)')
    expect(setupWeldGeometry(v)).toMatchObject({ bevelShape: 'V', template: 'VOffset', templateEstimated: true })
    expect(setupWeldGeometry(v)?.geometryEstimated).toBeUndefined()
    // 양면 V(코드 5, 같은 파일 화면으로 확인)는 템플릿에 (추정)이 없다
    const x: ScanPlanSpec = { ...spec, specimen: { ...spec.specimen, shape: 'plate', estimatedFields: ['shape'], weld: { ...spec.specimen.weld!, bevelShape: 'X', template: 'DoubleVOffset', templateCode: 5, symmetry: 'Symmetric' } } }
    const xHtml = renderToStaticMarkup(createElement(SetupPanels, { spec: x, groupNames: ['PA 1'] }))
    expect(xHtml).toContain('<dt>개선</dt><dd>X · 양면 V 개선</dd>')
    expect(xHtml).toContain('<dt>개선 템플릿</dt><dd>Double V-Offset</dd>')
    expect(renderToStaticMarkup(createElement(SetupDiagram, { spec: x, groupNames: ['PA 1'] }))).toContain('판재 (추정) · Double V-Offset 개선')
    const specimen: SpecimenSummary = { id: 'TP14', displayName: '', source: 'device-filename', note: '', createdAt: '', planIds: ['SP001'], fileCount: 1, stateTags: [], lastImportedAt: null }
    const plan: ScanPlan = { id: 'SP001', name: 'V 검사', note: '', fingerprint: 'fp2:test', spec: v, summary: '', createdAt: '', updatedAt: '', fileCount: 1, specimenCount: 1, totalBytes: 1, lastImportedAt: null }
    const summary = renderToStaticMarkup(createElement(SpecimenPlanSummary, { specimen, plans: [plan], navigate: () => undefined }))
    expect(summary).toContain('판재 (추정)')
    expect(summary).toContain('STEEL, MILD (추정)')
    expect(summary).toContain('V-Offset (추정)')
  })

  it('한 시편의 다른 플랜 치수를 각각 보이고 시편·태그·셋업으로 찾는다', () => {
    const specimen: SpecimenSummary = {
      id: 'PL23861', displayName: 'PL23861', source: 'device-filename', note: '', createdAt: '2026-10-07T00:00:00Z',
      planIds: ['SP001', 'SP002'], fileCount: 4, stateTags: ['Cap on'], lastImportedAt: null
    }
    const makePlan = (id: string, thicknessMm: number): ScanPlan => ({
      id, name: `${thicknessMm}T 검사`, note: '', fingerprint: `fp2:${id}`, spec: { ...spec, specimen: { ...spec.specimen, thicknessMm } },
      summary: `${thicknessMm}T · 5MHz`, createdAt: '', updatedAt: '', fileCount: 2, specimenCount: 1, totalBytes: 100, lastImportedAt: null
    })
    const plans = [makePlan('SP001', 25), makePlan('SP002', 30)]
    const html = renderToStaticMarkup(createElement(SpecimenPlanSummary, { specimen, plans, navigate: () => undefined }))
    expect(html).toContain('25.0 mm')
    expect(html).toContain('30.0 mm')
    expect(html.match(/<tr>/g)).toHaveLength(3) // 머리 + 플랜 2개
    expect(matchesAllTerms(specimenSearchFields(specimen, plans), 'PL23861 Cap')).toBe(true)
    expect(matchesAllTerms(specimenSearchFields(specimen, plans), '5L64-A32 30T')).toBe(true)
    expect(matchesAllTerms(specimenSearchFields(specimen, plans), 'PL23862')).toBe(false)
  })
})
