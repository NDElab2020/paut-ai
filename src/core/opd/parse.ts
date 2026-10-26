/**
 * 앞부분 바이트 + 꼬리 색인 → OpdFile (순수 함수, 파일 입출력 없음).
 * 구조 점검이 하나라도 맞지 않으면 '보류(해석 실패)' (OpdError, NDE_READ_ERROR). 추정값으로 메우지 않는다.
 */
import { readBeamPool, readBeamRecords } from './beams'
import { ByteView } from './bytes'
import { parseContainerHeader, parseTailIndex } from './container'
import { structureFail } from './errors'
import { layoutRaster, readTrailer } from './raster'
import { opdExpectedRasterPositions, readOpdScanSetup } from './scan'
import { WEDGE_TO_POOL, checkSetupRanges, fieldLabel, readGeneralInfo, readProbeWedge, readSetupRaw, REPORT_INFO_DEFAULT, SETUP_FIELDS, type SetupField } from './setup'
import { oleDateToIso } from './strings'
import { OPD_READER, type OpdBeam, type OpdFile, type OpdFormation, type OpdSetup } from './types'
import { OPD_MATERIALS, OPD_SPECIMEN_SHAPES, OPD_WELD_SYMMETRIES, OPD_WELD_TEMPLATE_INFO, readOpdSetupTables, type OpdTypedTables } from './weld'

const ANGLE_TOL = 1e-6
/** 빔마다 A-scan 시작·범위가 같아야 하는 허용치 (µs). 162개 실데이터 최대 차 7e-15 µs */
const BEAM_TIME_TOL_US = 1e-9
/** 1축 파일의 위치 수 ↔ 스캔 길이 ÷ 간격 허용 차 (SEC25-2 sr1_04~07: 800 대 801) */
const POSITIONS_TOL = 1

export interface OpdParts {
  /** 파일 앞부분 (래스터 시작까지는 들어 있어야 함 — 모자라면 NeedMoreBytes) */
  prefix: Uint8Array
  fileSize: number
  /** 꼬리 색인 바이트 (prefix 가 파일 전체면 null 로 두고 prefix 에서 읽음) */
  index: Uint8Array | null
  /** 꼬리 typed 설정 구역. 앞부분만 읽는 경로에서 별도로 가져옴. 전체 바이트면 생략 가능. */
  typedTables?: OpdTypedTables | null
}

export function parseOpdParts(parts: OpdParts): OpdFile {
  const view = new ByteView(parts.prefix, parts.fileSize)
  const head = parseContainerHeader(view)
  const entries = parts.index
    ? parseTailIndex(new ByteView(parts.index), 0, head.indexCount, head.indexOffset)
    : parseTailIndex(view, head.indexOffset, head.indexCount, head.indexOffset)

  const general = readGeneralInfo(view)
  const tableEntry = entries[2]
  const tableEnd = entries[3]?.offset
  const tables = parts.typedTables ?? (tableEntry && tableEnd && tableEnd <= parts.prefix.length
    ? { bytes: parts.prefix.subarray(tableEntry.offset, tableEnd), offset: tableEntry.offset } : null)
  const setupTables = readOpdSetupTables(view, tables)
  const scanAxes = readOpdScanSetup(view, tables)
  const weldTable = setupTables.groups.Weld_GROUP?.[0] ?? {}
  const templateCode = weldTable['0x74cbf'] ?? null
  const symmetryCode = weldTable['0x74dbf'] ?? null
  const specimenTable = setupTables.groups.SpecimenInformation_GROUP?.[0] ?? {}
  const shapeCode = specimenTable['0x740dd'] ?? null
  const materialCode = specimenTable['0x742dd'] ?? null
  const groupTable = setupTables.groups.GroupUT_GROUP?.[0] ?? {}
  const waveModeCode = groupTable['0x742e2'] ?? null
  const probeCounts = (setupTables.groups.ProbeUT_Container_GROUP ?? []).map((g) => g['0x641b6']).filter((n): n is number => n !== undefined)
  const elementCount = probeCounts.length === 2 && probeCounts.every((n) => Number.isInteger(n) && n > 0 && n === probeCounts[0]) ? probeCounts[0]! : null
  const raw = readSetupRaw(view, general.anchor)
  checkSetupRanges(raw, general.untested)
  // typed 숫자 포인터와 독립적으로 계산한 앵커 위치가 같은 값을 가리켜야 한다.
  const weldFields: Array<[string, SetupField]> = [
    ['0xb3ebf', 'thickness'], ['0xb3fbf', 'weldLandOffset'], ['0xb47bf', 'weldHotPass'], ['0xb48bf', 'weldLand'],
    ['0xb49bf', 'weldRoot'], ['0xb4abf', 'weldHotPassAngle'], ['0xb4bbf', 'weldRootAngle']
  ]
  for (const [tag, key] of weldFields) {
    const v = weldTable[tag]
    if (v !== undefined && Math.abs(v - raw[key]) > 1e-12) {
      structureFail('setup-values', '용접 숫자 포인터와 셋업 앵커 값이 다릅니다.', `${tag}=${v} ${key}=${raw[key]}`)
    }
  }
  const pw = readProbeWedge(view, general.anchor)
  const pool = readBeamPool(view, pw.end + WEDGE_TO_POOL)
  const recs = readBeamRecords(view, pool.end, raw.skew)
  const beams = recs.beams
  const gateTables = setupTables.groups.FblUT_Gate_GROUP ?? []
  const gateOffsets = setupTables.locations.FblUT_Gate_GROUP ?? []
  if (setupTables.beamContexts.length) {
    const contexts = setupTables.beamContexts
    for (const beam of beams) {
      const matches = contexts.filter((c) => c.name === beam.name)
      if (matches.length !== 1 || matches[0]!.gateOffsets.length !== 3) {
        structureFail('setup-values', '빔 설정의 게이트 참조를 확인할 수 없습니다.', beam.name)
      }
      for (const [i, offset] of matches[0]!.gateOffsets.entries()) {
        const table = gateTables[gateOffsets.indexOf(offset)]
        if (!table) structureFail('setup-values', '빔 설정의 게이트 포인터가 맞지 않습니다.', `${beam.name} gate ${i}`)
        const threshold = table['0x240bb'] ?? null
        if (threshold !== null && (threshold < 0 || threshold > 100)) structureFail('setup-values', '게이트 문턱이 범위를 벗어났습니다.', `${threshold}`)
        const g = beam.gates[i]!
        const start = table['0xb3fbb']
        const width = table['0xb41bb']
        if ((start !== undefined && Math.abs(start * 1e6 - g.startDepthUs) > 1e-9) ||
          (width !== undefined && Math.abs(width * 1e6 - g.widthDepthUs) > 1e-9)) {
          structureFail('setup-values', '게이트 참조와 빔 기록의 시작·폭이 다릅니다.', `${beam.name} gate ${i}`)
        }
        beam.gates[i]!.thresholdPct = threshold
      }
    }
  }
  if (pool.blocks !== beams.length - 1) {
    structureFail('beam-pool', '빔 이름 목록 수와 빔 기록 수가 맞지 않습니다.', `pool=${pool.blocks} beams=${beams.length}`)
  }
  checkBeamTimes(beams)
  const formation = checkAngleBlock(raw, beams)
  const aperture = beams[0]!.elementCount
  if (beams.some((b) => b.elementCount !== aperture)) structureFail('angle-block', '빔마다 소자 수가 다릅니다.')

  const trailer = readTrailer(view, recs.end, general)
  const nominalScanCount = Math.round(raw.scanLength / raw.scanResolution)
  const scanCount = scanAxes.scan.quantity ?? nominalScanCount
  const raster = layoutRaster(trailer.rasterOffset, beams.length, entries, head.indexOffset, scanCount, trailer.paletteOffsets)
  const expectedPositions = opdExpectedRasterPositions(scanAxes)
  if (scanAxes.scan.rangeMatchesQuantity === false || scanAxes.index.rangeMatchesQuantity === false ||
      (expectedPositions !== null && expectedPositions !== raster.positions)) {
    structureFail('positions', 'Patch의 시작·상한·간격·위치 수와 래스터 위치 수가 맞지 않습니다.', `patch=${expectedPositions} raster=${raster.positions}`)
  }
  // 위치 수는 '래스터 크기 ÷ (빔 × (320 + 36))' 로 센다. 샘플 수 칸을 찾지 못해 320 으로 두었으므로,
  // 나누어떨어지는 것만으로는 부족하다(801 = 9 × 89 라 샘플 수가 4의 배수면 나누어떨어짐) → 셋업 칸과 교차 확인
  const linesField = raw.indexStep > 0 ? Math.round(raw.indexLength / raw.indexStep) : 0
  if (raster.twoAxis && expectedPositions === null) {
    if (linesField !== raster.twoAxis.indexLines) {
      structureFail(
        'positions',
        `구조로 센 인덱스 줄 수(${raster.twoAxis.indexLines})가 인덱스 길이 칸으로 센 줄 수(${linesField})와 다릅니다(래스터 배치를 확인할 수 없음).`,
        `positions=${raster.positions} nominal=${nominalScanCount}`
      )
    }
  } else if (!raster.twoAxis && expectedPositions === null && Math.abs(raster.positions - nominalScanCount) > POSITIONS_TOL) {
    structureFail(
      'positions',
      `위치 수(${raster.positions})가 스캔 길이 ÷ 간격(${nominalScanCount})과 맞지 않습니다(래스터 배치를 확인할 수 없음).`,
      `positions=${raster.positions} nominal=${nominalScanCount} beams=${beams.length}`
    )
  }

  const rawLabeled: Record<string, number> = {}
  for (const [k, rel] of Object.entries(SETUP_FIELDS) as Array<[SetupField, number]>) rawLabeled[fieldLabel(rel)] = raw[k]
  Object.assign(rawLabeled, setupTables.raw)
  Object.assign(rawLabeled, scanAxes.raw)

  const template = templateCode === null ? null : OPD_WELD_TEMPLATE_INFO[templateCode] ?? null
  const shapeInfo = shapeCode === null ? null : OPD_SPECIMEN_SHAPES[shapeCode] ?? null
  const materialInfo = materialCode === null ? null : OPD_MATERIALS[materialCode] ?? null
  const setup: OpdSetup = {
    thicknessMm: raw.thickness * 1000,
    weldFillHeightMm: raw.weldHotPass * 1000,
    weldLandHeightMm: raw.weldLand * 1000,
    weld: raw.weldHotPass + raw.weldLand + raw.weldRoot > 0 ? {
      templateCode,
      symmetryCode,
      templateName: template?.name ?? null,
      templateEstimated: template?.estimated ?? false,
      bevelShape: template?.bevelShape ?? null,
      symmetryName: symmetryCode === null ? null : OPD_WELD_SYMMETRIES[symmetryCode] ?? null,
      hotPass: { heightMm: raw.weldHotPass * 1000, angleDeg: raw.weldHotPassAngle },
      land: { heightMm: raw.weldLand * 1000, offsetMm: raw.weldLandOffset * 1000 },
      root: { heightMm: raw.weldRoot * 1000, angleDeg: raw.weldRootAngle },
      fill: null,
      derivedFillHeightMm: (raw.thickness - raw.weldHotPass - raw.weldLand - raw.weldRoot) * 1000,
      hazWidthMm: null,
      upperCap: null,
      lowerCap: null
    } : null,
    specimen: {
      shapeCode,
      shape: shapeInfo?.name ?? null,
      shapeEstimated: shapeInfo?.estimated ?? false,
      materialCode,
      materialName: materialInfo?.name ?? null,
      materialEstimated: materialInfo?.estimated ?? false
    },
    waveModeCode,
    waveMode: waveModeCode === 1 ? 'Shear' : null,
    scanOffsetMm: groupTable['0xb3ee2'] === undefined ? null : groupTable['0xb3ee2'] * 1000,
    velocityMps: raw.velocity,
    gainDb: raw.gain,
    referenceGainDb: raw.referenceGain,
    referenceAmplitudePct: raw.referenceAmplitude,
    pulseWidthNs: raw.pulseWidth * 1e9,
    indexOffsetMm: raw.indexOffset * 1000,
    skewDeg: raw.skew,
    formation,
    angle: { startDeg: raw.angleStart, stopDeg: raw.angleStop, stepDeg: raw.angleStep },
    focusDepthMm: raw.focusDepth * 1000,
    filter: { lowMHz: raw.filterLow / 1e6, highMHz: raw.filterHigh / 1e6 },
    aperture,
    firstElement: beams[0]!.firstElement + 1,
    elementStep: formation === 'linear' && beams.length > 1 ? beams[1]!.firstElement - beams[0]!.firstElement : null,
    scan: { lengthMm: raw.scanLength * 1000, resolutionMm: raw.scanResolution * 1000, nominalCount: nominalScanCount },
    scanAxes,
    index: { resolutionMm: raw.indexResolution * 1000, lengthMm: raw.indexLength * 1000, stepMm: raw.indexStep * 1000 },
    probe: { ...pw.probe, centralFrequencyMHz: raw.frequency / 1e6, pitchMm: raw.pitch * 1000, elementCount },
    wedge: pw.wedge,
    raw: rawLabeled
  }

  const warnings: string[] = ['OPD 는 공개되지 않은 형식이라 파일 구조를 따라 읽었습니다(OmniPC 대조 전).']
  warnings.push(...scanAxes.warnings)
  if (general.untested) {
    const filled = general.reportInfo.filter((r) => r.value !== REPORT_INFO_DEFAULT).map((r) => r.label)
    warnings.push(
      `아직 본 적 없는 배치입니다(${filled.length ? `보고서 칸 ${filled.join('·')} 채움` : `그룹 이름 '${general.groupName}'`}). 같은 규칙으로 따라 읽었으니 값을 확인하세요.`
    )
  }
  if (raster.twoAxis) {
    warnings.push(`2축 스캔(인덱스 ${raster.twoAxis.indexLines}줄 × 스캔 ${raster.twoAxis.scanCount}칸)입니다. 이미지 보기는 아직 지원하지 않습니다.`)
  } else if (expectedPositions === null && raster.positions !== nominalScanCount) {
    warnings.push(`위치 수(${raster.positions})가 스캔 길이 ÷ 간격(${nominalScanCount})과 다릅니다. 구조로 센 위치 수를 씁니다.`)
  }
  const weldHeightMm = setup.weld ? setup.weld.hotPass.heightMm + setup.weld.land.heightMm + setup.weld.root.heightMm : null
  if (weldHeightMm !== null && weldHeightMm - setup.thicknessMm > 0.05) {
    warnings.push(
      `두께 칸(${round2(setup.thicknessMm)} mm)이 Hot Pass + Land + Root(${round2(weldHeightMm)} mm)와 다릅니다. 실제 두께를 확인하세요.`
    )
  }

  return {
    reader: OPD_READER,
    container: { version: head.version, fileSize: head.fileSize, indexOffset: head.indexOffset, entries },
    header: {
      module: general.module,
      serialNumber: trailer.serials[0] ?? null,
      serials: trailer.serials,
      mxuVersion: general.mxuVersion,
      mxu: general.mxu,
      savedAt: oleDateToIso(general.savedAtOle),
      savedAtOle: general.savedAtOle,
      deviceFileName: trailer.deviceFileName,
      groupName: general.groupName,
      lawFile: general.lawFile,
      reportInfo: general.reportInfo,
      anchorOffset: general.anchor
    },
    setup,
    beams,
    raster,
    warnings
  }
}

/** 한 파일 안 모든 빔의 A-scan 시작·범위는 같다(162개 확인). 다르면 빔 기록 하나를 잘못 읽은 것으로 본다 */
function checkBeamTimes(beams: OpdBeam[]): void {
  const b0 = beams[0]!
  for (const b of beams) {
    if (Math.abs(b.t0Us - b0.t0Us) > BEAM_TIME_TOL_US || Math.abs(b.rangeUs - b0.rangeUs) > BEAM_TIME_TOL_US) {
      structureFail('beam-values', '빔마다 A-scan 시작·범위가 다릅니다(빔 기록을 잘못 읽었을 수 있음).', `${b.name}: t0=${b.t0Us} range=${b.rangeUs} vs ${b0.t0Us}/${b0.rangeUs}`)
    }
  }
}

/**
 * 각도 블록 ↔ 빔 이름·기록:
 * - 섹토리얼: 시작 < 끝, 빔 수 = (끝 − 시작)/간격 + 1, 빔 k 각도 = 시작 + k·간격, 첫 소자는 모두 같음
 * - 리니어: 시작 = 끝, 모든 빔 각도 = 시작, 첫 소자가 일정한 간격(≥ 1)으로 늘어남
 */
function checkAngleBlock(raw: Record<SetupField, number>, beams: OpdBeam[]): OpdFormation {
  const { angleStart: start, angleStop: stop, angleStep: step } = raw
  const n = beams.length
  if (stop > start + ANGLE_TOL) {
    const span = (stop - start) / step
    if (Math.abs(span - Math.round(span)) > ANGLE_TOL || Math.round(span) + 1 !== n) {
      structureFail('angle-block', '각도 블록의 빔 수가 빔 기록 수와 다릅니다.', `start=${start} stop=${stop} step=${step} beams=${n}`)
    }
    beams.forEach((b, k) => {
      if (Math.abs(b.angleDeg - (start + k * step)) > ANGLE_TOL) {
        structureFail('angle-block', '빔 각도가 각도 블록과 맞지 않습니다.', `${b.name}: ${b.angleDeg} vs ${start + k * step}`)
      }
      if (b.firstElement !== beams[0]!.firstElement) structureFail('angle-block', '섹토리얼인데 빔마다 첫 소자가 다릅니다.', b.name)
    })
    return 'sectorial'
  }
  if (Math.abs(stop - start) <= ANGLE_TOL) {
    const d = n > 1 ? beams[1]!.firstElement - beams[0]!.firstElement : 1
    beams.forEach((b, k) => {
      if (Math.abs(b.angleDeg - start) > ANGLE_TOL) structureFail('angle-block', '리니어인데 빔 각도가 각도 블록과 다릅니다.', `${b.name}: ${b.angleDeg}`)
      if (d < 1 || b.firstElement !== beams[0]!.firstElement + k * d) {
        structureFail('angle-block', '리니어인데 첫 소자가 일정하게 늘지 않습니다.', `${b.name}: ${b.firstElement}`)
      }
    })
    return 'linear'
  }
  return structureFail('angle-block', '각도 블록(시작 > 끝)이 예상과 다릅니다.', `start=${start} stop=${stop}`)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
