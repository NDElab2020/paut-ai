/**
 * 기준표 준비: survey.json 이 조사 CSV 와 같은지 (CSV 가 있는 PC 에서만).
 * PAUT_WRITE_OPD_SURVEY=1 이면 CSV 로 survey.json 을 다시 만든다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OPD_FILES, OPD_SURVEY_CSV } from '../../paths'
import { SURVEY_JSON_PATH, formatSurveyJson, loadSurveyJson, surveyFromCsv } from './surveyCsv'

const HAS_CSV = existsSync(OPD_SURVEY_CSV)

describe('OPD 기준표 (survey.json)', () => {
  it.skipIf(!HAS_CSV || process.env.PAUT_WRITE_OPD_SURVEY !== '1')('CSV 로 survey.json 다시 만들기', () => {
    const json = surveyFromCsv(readFileSync(OPD_SURVEY_CSV, 'utf8'))
    writeFileSync(SURVEY_JSON_PATH, formatSurveyJson(json))
  })

  it.skipIf(!HAS_CSV)('조사 CSV 와 같다', () => {
    const expected = surveyFromCsv(readFileSync(OPD_SURVEY_CSV, 'utf8'))
    expect(loadSurveyJson()).toEqual(expected)
  })

  it('162행, 묶음별 개수와 경로가 맞다', () => {
    const s = loadSurveyJson()
    expect(s.rows).toHaveLength(162)
    const count = (b: string): number => s.rows.filter((r) => r.bundle === b).length
    expect([count('PCN'), count('SEC20'), count('SEC25-2'), count('6.4T'), count('부식시험')]).toEqual([108, 36, 7, 4, 7])
    expect(new Set(s.rows.map((r) => r.path)).size).toBe(162)
    for (const r of s.rows) expect(String(r.path)).toMatch(/\.opd$/)
    // tests/paths.ts 의 대표 파일은 모두 기준표에 있다
    const paths = new Set(s.rows.map((r) => r.path))
    for (const rel of Object.values(OPD_FILES)) expect(paths.has(rel), rel).toBe(true)
    // 부식 2축 7개만 게이트 대조 값이 비어 있다
    expect(s.rows.filter((r) => r.gateATotal === null).map((r) => r.bundle)).toEqual(Array(7).fill('부식시험'))
  })
})
