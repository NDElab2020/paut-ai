/**
 * 신규 취득 규약(계획_라벨링/취득_규약_v1.md) 7절의 파일 이름 예시가 앱의 시편 ID·캡·회차 제안 규칙
 * (src/core/nde/specimenGuess.ts)과 맞는지 확인한다. 문서의 표를 그대로 읽으므로, 규칙이나 문서 한쪽만 바뀌면 깨진다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { suggestSpecimen } from '@core/nde'
import { TOOL_ROOT } from '../paths'

const DOC = resolve(TOOL_ROOT, '계획_라벨링/취득_규약_v1.md')

interface NameRow {
  fileName: string
  specimenId: string | null
  stateTag: string | null
  round: number | null
}

/** <!-- tag:시작 --> … <!-- tag:끝 --> 사이 표의 데이터 줄 */
function tableRows(md: string, tag: string): NameRow[] {
  const start = md.indexOf(`<!-- ${tag}:시작 -->`)
  const end = md.indexOf(`<!-- ${tag}:끝 -->`)
  if (start < 0 || end < start) throw new Error(`문서에 '${tag}' 표 표시가 없습니다`)
  const lines = md
    .slice(start, end)
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .slice(2) // 머리글·구분 줄
  const dash = (s: string): string | null => (s === '–' || s === '-' || s === '' ? null : s)
  return lines.map((l) => {
    const cells = l.split('|').slice(1, -1).map((c) => c.trim())
    const [name, id, cap, round] = cells
    const r = dash(round ?? '')
    return {
      fileName: (name ?? '').replace(/`/g, ''),
      specimenId: dash(id ?? ''),
      stateTag: dash(cap ?? ''),
      round: r === null ? null : Number(r)
    }
  })
}

const md = readFileSync(DOC, 'utf8')

describe('취득 규약 파일 이름 ↔ 앱 시편 ID 제안 규칙', () => {
  for (const tag of ['이름예시', '피할이름']) {
    const rows = tableRows(md, tag)

    it(`'${tag}' 표가 있다`, () => {
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) expect(r.fileName, JSON.stringify(r)).toMatch(/\.nde$/)
    })

    for (const r of rows) {
      it(`${tag}: ${r.fileName}`, () => {
        const stem = r.fileName.replace(/\.nde$/i, '')
        // 장비에서 이 이름으로 저장한 경우(장비 원본 파일명 = 이름)와, 장비 이름 없이 파일 이름만 있는 경우가 같아야 한다
        for (const meta of [{ deviceFileName: stem }, null]) {
          const g = suggestSpecimen(meta, r.fileName)
          expect(g.specimenId, `${r.fileName} 시편 ID`).toBe(r.specimenId)
          expect(g.stateTag, `${r.fileName} 캡`).toBe(r.stateTag)
          expect(g.round, `${r.fileName} 회차`).toBe(r.round)
        }
      })
    }
  }
})
