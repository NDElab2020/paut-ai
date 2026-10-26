/**
 * 빔 기록 뒤 → 장비 저장 이름 → 장비 정보 → 색표 3개 → A-scan 래스터 → 게이트 결과 → 고정 블록 → 꼬리 구역.
 *
 *   'Alarm_Output_GROUP' × 3 끝 + 0x88 = 장비 저장 이름('TP14-ROOT-L-##'), 바로 뒤 문자열 5개('File####')와 집속법칙 파일 문자열
 *   … 장비 모듈 · 시리얼 · 시리얼 · MXU 버전(0 끝 문자열이 이어짐) 바로 뒤 색표 3 × 1024 B (RGB0 × 256)
 *   세 번째 색표 = 회색조 (i, i, i, 0). 그 끝이 래스터 시작 [확인]
 *   래스터 [위치][빔][320] uint8, 프레임 사이 머리 없음
 *   게이트 결과 [위치][빔][게이트 I·A·B] × 12 B (바이트 8 = 최대 진폭)
 *   고정 블록 4,928 B, 그 끝 = 꼬리 색인이 가리키는 첫 꼬리 구역
 */
import type { ByteView } from './bytes'
import { structureFail } from './errors'
import { findBytes, findUtf16z, hasUtf16z, readUtf16z } from './strings'
import {
  OPD_FIXED_BLOCK_BYTES,
  OPD_GATE_COUNT,
  OPD_GATE_RECORD_BYTES,
  OPD_SAMPLES,
  type OpdRaster,
  type OpdTailEntry
} from './types'

const ALARM_OUTPUT = 'Alarm_Output_GROUP'
/** 마지막 빔 끝에서 'Alarm_Output_GROUP' 을 찾는 범위 */
const ALARM_SEARCH_BYTES = 0x1000
/** 'Alarm_Output_GROUP' × 3 끝 → 장비 저장 이름 [확인 162/162] */
const ALARM_TO_DEVICE_NAME = 0x88
/** 장비 저장 이름 뒤 파일 이름 틀 문자열 수 ('File####') */
const FILE_TEMPLATE_COUNT = 5
/** 장비 저장 이름 뒤에서 회색조 색표를 찾는 범위 */
const PALETTE_SEARCH_BYTES = 0x2000
const PALETTE_BYTES = 1024

const GRAY_PALETTE: Uint8Array = (() => {
  const g = new Uint8Array(PALETTE_BYTES)
  for (let i = 0; i < 256; i++) {
    g[4 * i] = i
    g[4 * i + 1] = i
    g[4 * i + 2] = i
  }
  return g
})()

export interface Trailer {
  deviceFileName: string
  fileTemplates: string[]
  lawFile: string
  serials: string[]
  paletteOffsets: [number, number, number]
  rasterOffset: number
}

/**
 * beamsEnd 부터 장비 저장 이름과 색표를 찾는다.
 * header 의 모듈·MXU 버전·집속법칙 파일 문자열이 꼬리 쪽에도 같은 모양으로 있어야 한다.
 */
export function readTrailer(view: ByteView, beamsEnd: number, header: { module: string; mxuVersion: string; lawFile: string }): Trailer {
  const firstAlarm = findUtf16z(view, ALARM_OUTPUT, beamsEnd, beamsEnd + ALARM_SEARCH_BYTES)
  if (firstAlarm < 0) structureFail('trailer', '빔 기록 뒤 경보 설정 구역을 찾지 못했습니다.', `from 0x${beamsEnd.toString(16)}`)
  let p = firstAlarm
  for (let k = 0; k < 3; k++) {
    if (!hasUtf16z(view, p, ALARM_OUTPUT)) structureFail('trailer', '경보 설정 구역 구조가 예상과 다릅니다.', `at 0x${p.toString(16)}`)
    p += (ALARM_OUTPUT.length + 1) * 2
  }
  const device = readUtf16z(view, p + ALARM_TO_DEVICE_NAME, 'trailer', '장비 저장 이름', 256)
  if (!device.text.trim()) structureFail('trailer', '장비 저장 이름이 비어 있습니다.')
  const fileTemplates: string[] = []
  let q = device.end
  for (let k = 0; k < FILE_TEMPLATE_COUNT; k++) {
    const s = readUtf16z(view, q, 'trailer', '파일 이름 틀', 256)
    fileTemplates.push(s.text)
    q = s.end
  }
  const law = readUtf16z(view, q, 'trailer', '집속법칙 파일', 256)
  if (law.text !== header.lawFile) {
    structureFail('trailer', '장비 저장 이름 뒤 구조가 예상과 다릅니다.', `law '${law.text}' vs '${header.lawFile}'`)
  }

  const gray = findBytes(view, GRAY_PALETTE, law.end, law.end + PALETTE_SEARCH_BYTES)
  if (gray < 0) structureFail('palette', '회색조 색표를 찾지 못했습니다.', `from 0x${law.end.toString(16)}`)
  const p1 = gray - 2 * PALETTE_BYTES
  const p2 = gray - PALETTE_BYTES
  for (const base of [p1, p2]) {
    for (let i = 0; i < 256; i++) {
      if (view.u8(base + 4 * i + 3) !== 0) structureFail('palette', '색표 모양이 예상과 다릅니다.', `palette at 0x${base.toString(16)}`)
    }
  }
  // 색표 바로 앞: [모듈][시리얼][시리얼][MXU 버전] (0 끝 문자열이 이어짐)
  const versionStart = p1 - (header.mxuVersion.length + 1) * 2
  if (!hasUtf16z(view, versionStart, header.mxuVersion)) {
    structureFail('palette', '색표 앞 장비 정보(MXU 버전)가 맞지 않습니다.', `at 0x${versionStart.toString(16)}`)
  }
  const serial2 = readBackwardString(view, versionStart)
  const serial1 = readBackwardString(view, serial2.start)
  const moduleStart = serial1.start - (header.module.length + 1) * 2
  if (!hasUtf16z(view, moduleStart, header.module) || !serial1.text.trim() || !serial2.text.trim()) {
    structureFail('palette', '색표 앞 장비 정보(모듈·시리얼)가 맞지 않습니다.', `serials '${serial1.text}'/'${serial2.text}'`)
  }
  return {
    deviceFileName: device.text,
    fileTemplates,
    lawFile: law.text,
    serials: [serial1.text, serial2.text],
    paletteOffsets: [p1, p2, gray],
    rasterOffset: gray + PALETTE_BYTES
  }
}

/** end 바로 앞에서 끝나는 0 끝 문자열(end − 2 가 0 끝). 앞쪽 0 단위까지 거슬러 올라간다 (최대 128자) */
function readBackwardString(view: ByteView, end: number): { text: string; start: number } {
  if (view.u16(end - 2) !== 0) structureFail('palette', '색표 앞 장비 정보 문자열이 맞지 않습니다.', `at 0x${end.toString(16)}`)
  let s = end - 4
  for (let n = 0; n < 128 && s >= 0; n++, s -= 2) {
    if (view.u16(s) === 0) {
      const str = readUtf16z(view, s + 2, 'palette', '장비 정보', 128)
      if (str.end !== end) break
      return { text: str.text, start: s + 2 }
    }
  }
  return structureFail('palette', '색표 앞 장비 정보 문자열을 읽지 못했습니다.', `before 0x${end.toString(16)}`)
}

/**
 * 위치 수 = (첫 꼬리 구역 − 래스터 시작 − 4928) ÷ (빔 × (샘플 + 36)). 나누어떨어지지 않으면 해석 실패.
 * 2축: 위치 수가 스캔 길이 ÷ 간격(nominal)의 2배 이상 정수배면 인덱스 줄 수로 본다.
 * 샘플 수 320 은 파일 칸이 아니라 가정이라 나누어떨어지는 것만으로는 부족하다 → parse.ts 가 이어서
 * 1축이면 위치 수 = nominal ± 1, 2축이면 줄 수 = 인덱스 길이 칸 ÷ 줄 간격 칸인지 확인한다(아니면 해석 실패 'positions').
 */
export function layoutRaster(
  rasterOffset: number,
  beams: number,
  entries: OpdTailEntry[],
  indexOffset: number,
  nominalScanCount: number,
  paletteOffsets: [number, number, number]
): OpdRaster {
  const tail = entries.map((e) => e.offset).filter((o) => o > rasterOffset)
  if (!tail.length) structureFail('positions', '래스터 뒤 꼬리 구역을 찾지 못했습니다.')
  const tailOffset = Math.min(...tail)
  const perPosition = beams * (OPD_SAMPLES + OPD_GATE_COUNT * OPD_GATE_RECORD_BYTES)
  const data = tailOffset - rasterOffset - OPD_FIXED_BLOCK_BYTES
  if (data <= 0 || data % perPosition !== 0 || tailOffset > indexOffset) {
    structureFail('positions', '위치 수가 나누어떨어지지 않습니다(래스터 크기가 맞지 않음).', `data=${data} per=${perPosition}`)
  }
  const positions = data / perPosition
  const frameBytes = beams * OPD_SAMPLES
  let twoAxis: OpdRaster['twoAxis'] = null
  if (nominalScanCount >= 1 && positions > nominalScanCount && positions % nominalScanCount === 0) {
    twoAxis = { indexLines: positions / nominalScanCount, scanCount: nominalScanCount }
  }
  return {
    offset: rasterOffset,
    positions,
    beams,
    samples: OPD_SAMPLES,
    bitDepth: 8,
    frameBytes,
    bytes: positions * frameBytes,
    gateResultsOffset: rasterOffset + positions * frameBytes,
    tailOffset,
    twoAxis,
    paletteOffsets
  }
}

/** 게이트 결과 한 위치(프레임)의 바이트 수 */
export function gateResultFrameBytes(beams: number): number {
  return beams * OPD_GATE_COUNT * OPD_GATE_RECORD_BYTES
}
