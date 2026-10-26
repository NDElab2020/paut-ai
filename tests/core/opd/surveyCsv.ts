/**
 * OPD 전수 기준표: OPD_조사/1_파서실험_전수결과.csv (162행) ↔ tests/fixtures/opd/survey.json.
 * CSV 열을 영문 키로 바꾸고, 실수 열은 CSV 에 찍힌 자릿수(decimals)를 함께 둔다 — 비교는 그 자릿수로 반올림한 값 기준.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type SurveyValue = string | number | boolean | null

export interface SurveyColumn {
  key: string
  csv: string
  type: 'string' | 'int' | 'float' | 'bool'
}

/** CSV 열 순서 그대로 */
export const SURVEY_COLUMNS: SurveyColumn[] = [
  { key: 'path', csv: '파일', type: 'string' },
  { key: 'bundle', csv: '묶음', type: 'string' },
  { key: 'sizeBytes', csv: '크기(byte)', type: 'int' },
  { key: 'deviceFileName', csv: '장비저장이름', type: 'string' },
  { key: 'savedAt', csv: '저장시각(파일)', type: 'string' },
  { key: 'mxu', csv: 'MXU', type: 'string' },
  { key: 'probeModel', csv: '탐촉자', type: 'string' },
  { key: 'wedgeModel', csv: '웨지', type: 'string' },
  { key: 'beams', csv: '빔수', type: 'int' },
  { key: 'angleStartDeg', csv: '각도시작', type: 'float' },
  { key: 'angleStopDeg', csv: '각도끝', type: 'float' },
  { key: 'angleStepDeg', csv: '각도간격', type: 'float' },
  { key: 'positions', csv: '위치수(구조)', type: 'int' },
  { key: 'nominalScanCount', csv: '위치수(스캔길이/간격)', type: 'int' },
  { key: 'rasterOffset', csv: '팔레트끝=래스터시작', type: 'int' },
  { key: 'beamRecordBytes', csv: '빔기록간격(byte)', type: 'int' },
  { key: 'samples', csv: '샘플수', type: 'int' },
  { key: 'sampleIntervalNs', csv: '샘플간격(ns)', type: 'float' },
  { key: 'ascanStartUs', csv: 'A스캔시작(us)', type: 'float' },
  { key: 'thicknessMm', csv: '두께A-0x510(mm)', type: 'float' },
  { key: 'weldFillHeightMm', csv: '용접채움높이A-0x4D8(mm)', type: 'float' },
  { key: 'weldLandHeightMm', csv: '랜드A-0x4D0(mm)', type: 'float' },
  { key: 'velocityMps', csv: '그룹음속(m/s)', type: 'float' },
  { key: 'gainDb', csv: '이득(dB)', type: 'float' },
  { key: 'referenceGainDb', csv: '기준이득(dB)', type: 'float' },
  { key: 'skewDeg', csv: '스큐', type: 'float' },
  { key: 'indexOffsetMm', csv: '인덱스오프셋(mm)', type: 'float' },
  { key: 'wedgeAngleDeg', csv: '웨지각', type: 'float' },
  { key: 'wedgeVelocityMps', csv: '웨지음속', type: 'float' },
  { key: 'wedgeOffsetXMm', csv: '웨지오프셋X(mm)', type: 'float' },
  { key: 'wedgeHeightMm', csv: '웨지높이(mm)', type: 'float' },
  { key: 'firstBeamExitMm', csv: '첫빔출사점(mm)', type: 'float' },
  { key: 'lastBeamExitMm', csv: '끝빔출사점(mm)', type: 'float' },
  { key: 'emptyFrames', csv: '빈프레임', type: 'int' },
  { key: 'saturatedSamples', csv: '255칸수', type: 'int' },
  { key: 'legacyToolOk', csv: '도구성공', type: 'bool' },
  { key: 'legacyToolShape', csv: '도구배열모양', type: 'string' },
  { key: 'legacyToolStartMinusRaster', csv: '도구시작-래스터시작(byte)', type: 'int' },
  { key: 'legacyToolDroppedFrames', csv: '도구가뺀프레임', type: 'int' },
  { key: 'gateAMatched', csv: '게이트A대조_일치칸', type: 'int' },
  { key: 'gateATotal', csv: '게이트A대조_전체칸', type: 'int' }
]

export interface SurveyJson {
  source: string
  root: string
  note: string
  columns: Array<{ key: string; csv: string; type: SurveyColumn['type']; decimals?: number }>
  rows: Array<Record<string, SurveyValue>>
}

export const SURVEY_JSON_PATH = resolve(import.meta.dirname, '../../fixtures/opd/survey.json')

export function loadSurveyJson(): SurveyJson {
  return JSON.parse(readFileSync(SURVEY_JSON_PATH, 'utf8')) as SurveyJson
}

/** 보기 좋게: 머리·열은 들여쓰기, 행은 한 줄에 하나 */
export function formatSurveyJson(json: SurveyJson): string {
  const { rows, columns, ...head } = json
  const top = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  const cols = columns.map((c) => `    ${JSON.stringify(c)}`).join(',\n')
  const body = rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')
  return `{\n${top.join(',\n')},\n  "columns": [\n${cols}\n  ],\n  "rows": [\n${body}\n  ]\n}\n`
}

function decimalsOf(s: string): number {
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

/** CSV 원문 → survey.json 내용 (빈 칸은 null) */
export function surveyFromCsv(text: string): SurveyJson {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  const head = lines[0]!.split(',')
  if (head.length !== SURVEY_COLUMNS.length || head.some((h, i) => h !== SURVEY_COLUMNS[i]!.csv)) {
    throw new Error(`CSV 열이 예상과 다릅니다: ${head.join(',')}`)
  }
  const cells = lines.slice(1).map((l) => {
    const c = l.split(',')
    if (c.length !== head.length) throw new Error(`열 수가 다른 행: ${l}`)
    return c
  })
  const decimals = SURVEY_COLUMNS.map((col, i) => (col.type === 'float' ? Math.max(0, ...cells.map((c) => (c[i] ? decimalsOf(c[i]!) : 0))) : undefined))
  const rows = cells.map((c) => {
    const row: Record<string, SurveyValue> = {}
    SURVEY_COLUMNS.forEach((col, i) => {
      const v = c[i]!
      if (v === '') row[col.key] = null
      else if (col.type === 'string') row[col.key] = v
      else if (col.type === 'bool') row[col.key] = v === 'True'
      else {
        const n = Number(v)
        if (!Number.isFinite(n) || (col.type === 'int' && !Number.isInteger(n))) throw new Error(`${col.csv} 값이 숫자가 아님: ${v}`)
        row[col.key] = n
      }
    })
    return row
  })
  return {
    source: 'OPD_조사/1_파서실험_전수결과.csv (2026-10-07 조사, 162행)',
    root: '06_원시데이터',
    note:
      '구조 읽기 기준값. 실수는 CSV 에 찍힌 자릿수(decimals)로 반올림된 값이다. legacyTool* 는 기존 Python 도구(opd2npz) 결과로 참고만 한다. ' +
      'gateA* 는 게이트 A 재계산 ↔ 장비 저장 게이트 결과 정수 일치 칸 수(부식 2축 7개는 빈 값).',
    columns: SURVEY_COLUMNS.map((col, i) => (decimals[i] === undefined ? { ...col } : { ...col, decimals: decimals[i] })),
    rows
  }
}
