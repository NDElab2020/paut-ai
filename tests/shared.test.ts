import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { uniquePlanName } from '@shared/planName'
import { josa, matchesAllTerms, particle } from '@shared/text'
import { APP_ROOT, TOOL_ROOT } from './paths'

describe('플랜 이름 겹침', () => {
  it('겹치면 (2), (3) 을 붙이고 대소문자·공백 차이도 같은 이름으로 본다', () => {
    expect(uniquePlanName('12T · 5MHz · SK90', [])).toBe('12T · 5MHz · SK90')
    expect(uniquePlanName('12T · 5MHz · SK90', ['12t ·  5MHz · SK90'])).toBe('12T · 5MHz · SK90 (2)')
    expect(uniquePlanName('12T · 5MHz · SK90', ['12T · 5MHz · SK90', '12T · 5MHz · SK90 (2)'])).toBe('12T · 5MHz · SK90 (3)')
  })
})

describe('조사', () => {
  it('받침(숫자·영문은 읽는 소리) 기준', () => {
    expect(josa('SP001', '과/와')).toBe('SP001과') // 일
    expect(josa('SP002', '과/와')).toBe('SP002와') // 이
    expect(josa('SP003', '으로/로')).toBe('SP003으로') // 삼
    expect(josa('SP001', '으로/로')).toBe('SP001로') // 일(ㄹ)
    expect(josa('SP002', '으로/로')).toBe('SP002로')
    expect(josa('저장소', '으로/로')).toBe('저장소로')
    expect(josa('플랜', '이/가')).toBe('플랜이')
    expect(josa('a.nde', '과/와')).toBe('a.nde와')
    expect(particle('D:/PAUT_저장소', '으로/로')).toBe('로')
    expect(particle('40–70°', '과/와')).toBe('와')
  })
})

describe('검색 규칙 (카탈로그와 같음)', () => {
  it('낱말이 모두 어느 필드엔가 있으면 일치, NFD 입력도', () => {
    const fields = ['12T-SV-03-Cap off.nde', 'PL23841', 'Cap off', null]
    expect(matchesAllTerms(fields, 'PL23841 cap')).toBe(true)
    expect(matchesAllTerms(fields, 'PL23841 on')).toBe(false)
    expect(matchesAllTerms(['시편 메모'], '메모'.normalize('NFD'))).toBe(true)
    expect(matchesAllTerms(fields, '   ')).toBe(true)
  })
})

describe('디자인 CSS 사본', () => {
  it('렌더러의 tokens.css·components.css 는 design/ 원본과 같다', () => {
    for (const f of ['tokens.css', 'components.css']) {
      const a = readFileSync(resolve(TOOL_ROOT, 'design', f), 'utf8')
      const b = readFileSync(resolve(APP_ROOT, 'src/renderer/src/styles', f), 'utf8')
      expect(b, f).toBe(a)
    }
  })
})
