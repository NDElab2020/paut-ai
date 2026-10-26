/**
 * OPD → 스캔플랜 스펙·지문·수집 요약·파일 메타·미리보기 경고 (판단.md 7절 4단계).
 * 시험용 작은 OPD(synth.ts)로 돈다 — 실데이터가 없어도 된다. 162개 전수는 normalize.realdata.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { OPD_READER, parseOpdBuffer } from '@core/opd'
import { deviceNameMatchesFile, opdFileMeta, opdFormatVersion, opdImportWarnings, opdSetupText, OPD_FORMAT_LABEL, OPD_SETUP_FORMAT } from '@core/opd/meta'
import { normalizeOpd, opdPlanSpec, opdThicknessSuspect, OPD_FORMAT_NOTE, OPD_SPEC_RULE, OPD_SPEC_RULE_FOR_READER, OPD_SUMMARY_SUFFIX } from '@core/opd/normalize'
import { folderSpecimenNote, suggestForItem, applyNameTemplate, OPD_NAME_SUFFIX } from '@core/import'
import { isStaleOpdSpec } from '../../../src/core/service/maintenance'
import { isOpdMeta, isOpdSpec, SPEC_VERSION, SUPPORTED_EXTENSIONS, UNSUPPORTED_EXTENSIONS } from '@shared/types'
import { buildSynthOpd } from './synth'

function patchF64(bytes: Uint8Array, pos: number, v: number): Uint8Array {
  const b = bytes.slice()
  new DataView(b.buffer).setFloat64(pos, v, true)
  return b
}

const sect = (): ReturnType<typeof parseOpdBuffer> => parseOpdBuffer(buildSynthOpd({ beams: 4, positions: 6 }).bytes)

describe('확장자', () => {
  it('.opd 는 지원 확장자, .oud·.wkb 는 그대로 보류', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(['.nde', '.opd'])
    expect(Object.keys(UNSUPPORTED_EXTENSIONS).sort()).toEqual(['.oud', '.wkb'])
  })
})

describe('OPD → 스캔플랜 스펙', () => {
  it('섹토리얼: 파일에서 읽은 값만, 모르는 칸은 null', () => {
    const spec = opdPlanSpec(sect())
    expect(spec.specVersion).toBe(SPEC_VERSION)
    expect(spec.specimen).toMatchObject({ shape: 'unknown', thicknessMm: 12, outerRadiusMm: null, angularOpeningDeg: null, materialName: null,
      weld: { hotPass: { heightMm: 10, angleDeg: 0 }, land: { heightMm: 2 }, root: { heightMm: 0, angleDeg: 0 },
        offsetMm: 0, template: null, templateCode: null, symmetry: null, symmetryCode: null, hazWidthMm: null, upperCap: null, lowerCap: null, fills: [] }
    })
    expect(spec.groups).toHaveLength(1)
    expect(spec.groups[0]).toEqual({
      technique: 'PA',
      formation: 'sectorial',
      firstElement: 31,
      aperture: 16,
      elementStep: null,
      refractedAngle: { startDeg: 45, stopDeg: 48, stepDeg: 1 },
      focusing: { mode: null, distanceMm: 20 },
      waveMode: null,
      probes: [
        {
          role: 'pulseEcho',
          probe: { model: '5L64-A32', kind: 'phasedArrayLinear', centralFrequencyMHz: 5, elementCount: null, pitchMm: 0.5 },
          orientation: 'Normal',
          wedge: { model: 'SA32-N55S', kind: 'angleBeam', wedgeAngleDeg: 36.1 },
          position: { uOffsetMm: null, vOffsetMm: -14, skewDeg: 90, surface: null }
        }
      ],
      techniqueParams: { dataFormat: 'opd', opdSpecRule: OPD_SPEC_RULE, opdShapeCode: null, opdMaterialCode: null, opdWaveModeCode: null }
    })
    expect(isOpdSpec(spec)).toBe(true)
    expect(isStaleOpdSpec(spec)).toBe(false)
    expect(isStaleOpdSpec({ ...spec, groups: [{ ...spec.groups[0]!, techniqueParams: { ...spec.groups[0]!.techniqueParams, opdSpecRule: 0 } }] })).toBe(true)
    expect(isStaleOpdSpec({ ...spec, specVersion: 1 })).toBe(true)
  })

  it('리니어: 굴절각 하나(간격 없음)·소자 스텝, 스큐 270 은 다른 지문', () => {
    const lin = opdPlanSpec(parseOpdBuffer(buildSynthOpd({ formation: 'linear', beams: 5 }).bytes))
    expect(lin.groups[0]).toMatchObject({ formation: 'linear', firstElement: 1, elementStep: 1, refractedAngle: { startDeg: 60, stopDeg: 60, stepDeg: null } })
    const l = normalizeOpd(sect())
    const r = normalizeOpd(parseOpdBuffer(buildSynthOpd({ beams: 4, positions: 6, skewDeg: 270 }).bytes))
    expect(r.spec.groups[0]!.probes[0]!.position).toEqual({ uOffsetMm: null, vOffsetMm: 14, skewDeg: 270, surface: null })
    expect(r.fingerprint).not.toBe(l.fingerprint)
  })

  it('지문: 같은 셋업이면 위치 수·장비 저장 이름·진폭이 달라도 같고, 다시 읽어도 같다', () => {
    const a = normalizeOpd(sect())
    const b = normalizeOpd(parseOpdBuffer(buildSynthOpd({ beams: 4, positions: 9, deviceFileName: 'OTHER-##' }).bytes))
    expect(a.fingerprint).toMatch(/^fp2:[0-9a-f]{64}$/)
    expect(b.fingerprint).toBe(a.fingerprint)
    expect(normalizeOpd(sect()).fingerprint).toBe(a.fingerprint)
  })

  it('요약·이름: OPD 표시, 형상 미상(설정 레코드 없는 시험 파일), 집속 깊이·개선 높이 (그 값만 다른 플랜이 같은 글자가 되지 않게)', () => {
    const n = normalizeOpd(sect())
    // 설정 레코드 표가 없으면 틀 코드를 몰라 개선 모양 없이 높이만 (Root 0 은 적지 않음)
    expect(n.summary).toBe(`형상 미상 12 mm · 5L64-A32 · -14 mm · PA 섹터 45–48° · 집속 20 mm · 개선 높이 10+2 mm${OPD_SUMMARY_SUFFIX}`)
    expect(applyNameTemplate('{name}', n.spec, n.summary, 'SP001')).toBe(`12T · 5MHz · SK90 · 집속 20 · 개선 10+2${OPD_NAME_SUFFIX}`)
    expect(applyNameTemplate('{id} {summary}', n.spec, n.summary, 'SP007')).toBe(`SP007 ${n.summary}`)
    // 두께 칸 ≠ 채움 + 랜드 (PL2386x 꼴) 면 요약에 '두께 확인 필요'
    const thick = parseOpdBuffer(patchF64(buildSynthOpd({ beams: 4, positions: 6 }).bytes, 0x30f4 - 0x510, 0.005))
    const t = normalizeOpd(thick)
    expect(opdThicknessSuspect(t.spec)).toBe(true)
    expect(opdThicknessSuspect(n.spec)).toBe(false)
    expect(t.summary).toBe(`형상 미상 5 mm · 5L64-A32 · -14 mm · PA 섹터 45–48° · 집속 20 mm · 개선 높이 10+2 mm · 두께 확인 필요${OPD_SUMMARY_SUFFIX}`)
  })

  it('읽기 규칙 버전 ↔ 스펙 규칙: OPD_READER 를 올리면 표에 한 줄을 더해야 한다 (스펙 값이 바뀌면 OPD_SPEC_RULE 도 올림)', () => {
    expect(OPD_SPEC_RULE_FOR_READER[OPD_READER.version]).toBe(OPD_SPEC_RULE)
    expect({ reader: OPD_READER.version, specRule: OPD_SPEC_RULE }).toEqual({ reader: 4, specRule: 3 })
  })

  it('경고: 비워 둔 칸, Ref 0 = 모름, 동기 방식 모름', () => {
    const n = normalizeOpd(sect())
    expect(n.warnings[0]).toBe(OPD_FORMAT_NOTE)
    expect(n.warnings.some((w) => w.includes('재질') && w.includes('개선 템플릿') && w.includes('탐촉자 소자 수') && w.includes('파 모드') && w.includes('스캔면'))).toBe(true)
    expect(n.warnings.some((w) => w.includes("기준 이득(Ref)이 0 dB 라 '모름'"))).toBe(true)
    expect(n.warnings.some((w) => w.includes('동기 방식'))).toBe(true)
  })
})

describe('OPD → 기록용 수집 요약', () => {
  it('이득·음속·빔 수·게이트(깊이 시간)·TCG·스캔 축', () => {
    const a = normalizeOpd(sect()).acquisition
    expect(a.encoder).toBeNull()
    expect(a.scanPattern).toBeNull()
    expect(a.groups).toHaveLength(1)
    expect(a.groups[0]).toMatchObject({
      groupName: 'PA 1',
      specGroupIndex: 0,
      gainDb: 30,
      referenceGainDb: null,
      velocityMps: 3240,
      beamCount: 4,
      digitizingFrequencyMHz: null,
      tcgEnabled: true,
      scanQuantity: 6,
      scanResolutionMm: 1,
      indexQuantity: null,
      indexResolutionMm: null,
      calibrations: []
    })
    expect(a.groups[0]!.gates).toEqual([
      { name: 'Gate I', startUs: 0.2, lengthUs: 6, thresholdPercent: null, geometry: 'TrueDepth' },
      { name: 'Gate A', startUs: 8, lengthUs: 8, thresholdPercent: null, geometry: 'TrueDepth' },
      { name: 'Gate B', startUs: 0.2, lengthUs: 6, thresholdPercent: null, geometry: 'TrueDepth' }
    ])
  })

  it('TCG 없음, 2축은 스캔 칸·인덱스 줄', () => {
    expect(normalizeOpd(parseOpdBuffer(buildSynthOpd({ tcgNames: 0 }).bytes)).acquisition.groups[0]!.tcgEnabled).toBe(false)
    const two = normalizeOpd(parseOpdBuffer(buildSynthOpd({ positions: 10, indexLines: 2 }).bytes)).acquisition.groups[0]!
    expect(two).toMatchObject({ scanQuantity: 5, indexQuantity: 2, indexResolutionMm: null })
  })
})

describe('OPD → 파일 메타·셋업 원문', () => {
  it('형식 opd · 읽기 규칙 버전 · 장비 저장 이름 · 저장 시각 · 모듈·시리얼 · MXU', () => {
    const f = sect()
    const m = opdFileMeta(f)
    expect(m).toEqual({
      ndeVersion: { raw: 'OPD · MXU - 4.4R5', family: 'opd', major: 4, minor: 4, patch: 5, preRelease: null },
      deviceFileName: 'SYN-01-##',
      device: { platform: null, model: 'OMNISX-PA1664PR', serialNumber: 'QC-000001', name: null },
      createdAt: '2026-05-20T12:00:00',
      modifiedAt: null,
      application: { name: 'MXU', version: '4.4R5' },
      scenario: null,
      reader: { name: 'opd-structure', version: 4 }
    })
    expect(isOpdMeta(m)).toBe(true)
    expect(opdFormatVersion(f).raw).toBe('OPD · MXU - 4.4R5')
    expect(OPD_FORMAT_LABEL).toBe('OPD · 자체 해석 · 대조 전')
  })

  it('셋업 원문 = 우리가 읽은 구조 JSON (형식 표시 + 읽기 규칙)', () => {
    const f = sect()
    const j = JSON.parse(opdSetupText(f)) as Record<string, unknown>
    expect(j['format']).toBe(OPD_SETUP_FORMAT)
    expect(j['reader']).toEqual({ name: 'opd-structure', version: 4 })
    expect((j['setup'] as { thicknessMm: number }).thicknessMm).toBeCloseTo(12, 9)
    expect((j['beams'] as unknown[]).length).toBe(4)
  })
})

describe('미리보기 경고·시편 제안', () => {
  it('장비 저장 이름 ↔ 파일 이름', () => {
    const cases: Array<[string, string, boolean]> = [
      ['TP14-ROOT-L-##', 'TP14-ROOT-L-01.opd', true],
      ['TP07-ROOT-L-##', 'tp07-root-l-01.opd', true],
      ['PL23862_BOT_L_##', 'PL23862_BOT_L_01.opd', true],
      ['200_dh_91_029_uh1_S25-2 sr1_##', '200_dh_91_029_uh1_S25-2 sr1_04.opd', true],
      ['C10_##', 'C10_01.opd', true],
      ['450A S36-1R', 'S36-1R.opd', true],
      ['PL23865_BOT_R_##', 'PL23865_BOT_L_02.opd', false],
      ['TP14-ROOT-L-##', 'TP14-ROOT-R-01.opd', false],
      ['TP14-ROOT-L-##', 'TP14-ROOT-L-01-copy.opd', false]
    ]
    for (const [dev, file, same] of cases) expect(deviceNameMatchesFile(dev, file), `${dev} ↔ ${file}`).toBe(same)
  })

  it('항목 경고: 이름 불일치, 늘 붙는 형식 경고는 빼고, 2축은 보관만', () => {
    expect(opdImportWarnings(sect(), 'SYN-01-03.opd')).toEqual([])
    const w = opdImportWarnings(sect(), 'OTHER-01.opd')
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('장비 저장 이름(SYN-01-##)이 파일 이름과 다릅니다')
    const two = opdImportWarnings(parseOpdBuffer(buildSynthOpd({ positions: 10, indexLines: 2 }).bytes), 'SYN-01-01.opd')
    expect(two).toEqual(['2축 스캔(인덱스 2줄 × 스캔 5칸)이라 보관만 합니다. 이미지 보기·라벨링은 아직 지원하지 않습니다.'])
    expect(sect().warnings).toEqual([OPD_FORMAT_NOTE])
  })

  it('시편 ID 제안은 기존 규칙(장비 저장 이름의 PL·TP 번호 → 파일 이름 → 파일 이름 그대로)', () => {
    expect(suggestForItem({ deviceFileName: 'TP07-ROOT-L-##' }, 'tp07-root-l-01.opd')).toMatchObject({ specimenId: 'TP07', specimenSource: 'device-filename' })
    expect(suggestForItem({ deviceFileName: 'PL23865_BOT_R_##' }, 'PL23865_BOT_L_02.opd')).toMatchObject({ specimenId: 'PL23865', specimenSource: 'device-filename' })
    expect(suggestForItem({ deviceFileName: '450A S36-1' }, 'S36-1.opd')).toMatchObject({ specimenId: 'S36-1', specimenSource: 'filename' })
    expect(suggestForItem({ deviceFileName: 'TP14-ROOT-R-##' }, 'TP14-ROOT-R-01.opd')).toMatchObject({ specimenId: 'TP14', round: null, stateTag: null })
  })

  it('폴더 이름의 시편 번호가 다르면 안내', () => {
    expect(folderSpecimenNote('/d/PCN교육/TP06/tp07-root-l-01.opd', 'TP07')).toContain('폴더 이름(TP06)')
    expect(folderSpecimenNote('D:\\PCN\\TP07\\TP07-ROOT-L-01.opd', 'TP07')).toBeNull()
    expect(folderSpecimenNote('/d/PL23861/re/PL23861-ROOT-L-01.opd', 'PL23861')).toBeNull()
    expect(folderSpecimenNote('/d/SEC20/200_dh_91_053_uh1_S20_sr01_01.opd', '200_dh_91_053_uh1_S20_sr01_01')).toBeNull()
  })
})
