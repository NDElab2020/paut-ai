import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isTrustedUrlFor } from '../src/main/trust'

const index = '/Applications/PAUT.app/Contents/Resources/app.asar/out/renderer/index.html'
const url = pathToFileURL(index).href

describe('신뢰 페이지 (IPC·이동 허용)', () => {
  it('앱 index.html 만 (해시·쿼리 무시)', () => {
    expect(isTrustedUrlFor(url, index, null, 'darwin')).toBe(true)
    expect(isTrustedUrlFor(`${url}#x?y=1`, index, null, 'darwin')).toBe(true)
    expect(isTrustedUrlFor(pathToFileURL('/Users/eu/evil.html').href, index, null, 'darwin')).toBe(false)
    expect(isTrustedUrlFor(pathToFileURL('/Users/eu/').href, index, null, 'darwin')).toBe(false)
    expect(isTrustedUrlFor('file://server/share/index.html', index, null, 'darwin')).toBe(false)
  })

  it('개발 서버는 origin 이 있을 때만', () => {
    expect(isTrustedUrlFor('http://localhost:5173/', index, null)).toBe(false)
    expect(isTrustedUrlFor('http://localhost:5173/x', index, 'http://localhost:5173')).toBe(true)
    expect(isTrustedUrlFor('ws://localhost:5173/', index, 'http://localhost:5173')).toBe(true)
    expect(isTrustedUrlFor('https://example.com/', index, 'http://localhost:5173')).toBe(false)
  })
})
