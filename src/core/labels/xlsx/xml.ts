/**
 * 작은 XML 읽기 (xlsx 부품용, 의존성 없음).
 *
 * - 요소·속성·글자·CDATA 를 읽어 나무로 만든다. 주석·처리 명령(<?…?>)은 건너뛴다.
 * - 요소 이름은 접두사를 뗀 이름(local name)으로 둔다 ('x:c' → 'c'). 속성은 원래 이름 그대로 두고 attr() 이 접두사를 무시해 찾는다.
 * - 엔티티는 XML 기본 다섯 개와 숫자 참조만 푼다. DTD(내부 부분집합)가 있으면 오류로 끝낸다(엔티티 폭탄 막기).
 * - 글자의 줄바꿈 \r\n 은 \n 으로 바꾼다(XML 규칙).
 */
import { XlsxError } from './errors'

export interface XmlElement {
  /** 접두사를 뗀 이름 */
  name: string
  attrs: Readonly<Record<string, string>>
  children: XmlNode[]
}

export type XmlNode = XmlElement | string

const NAMED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function bad(what: string, detail: string): XlsxError {
  return new XlsxError('bad-xml', `엑셀 파일 안의 ${what} 를 읽지 못했습니다 (XML 형식이 맞지 않음).`, detail)
}

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[body] ?? m
  })
}

/** 접두사를 뗀 이름 */
export function localName(qname: string): string {
  const i = qname.indexOf(':')
  return i < 0 ? qname : qname.slice(i + 1)
}

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d
}

/**
 * XML 글자 → 뿌리 요소. what = 오류 문구에 넣을 부품 이름 ('시트 지시').
 */
export function parseXml(text: string, what: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] }
  const stack: XmlElement[] = [root]
  const qnames: string[] = ['#document']
  const n = text.length
  let i = 0
  while (i < n) {
    const lt = text.indexOf('<', i)
    const textEnd = lt < 0 ? n : lt
    if (textEnd > i) {
      const top = stack[stack.length - 1]!
      if (stack.length > 1) top.children.push(decodeEntities(text.slice(i, textEnd).replace(/\r\n?/g, '\n')))
      else if (text.slice(i, textEnd).trim() !== '') throw bad(what, `text outside root @${i}`)
    }
    if (lt < 0) break
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      if (end < 0) throw bad(what, `unclosed comment @${lt}`)
      i = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      if (end < 0) throw bad(what, `unclosed CDATA @${lt}`)
      if (stack.length > 1) stack[stack.length - 1]!.children.push(text.slice(lt + 9, end).replace(/\r\n?/g, '\n'))
      i = end + 3
      continue
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2)
      if (end < 0) throw bad(what, `unclosed PI @${lt}`)
      i = end + 2
      continue
    }
    if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2)
      if (end < 0) throw bad(what, `unclosed declaration @${lt}`)
      if (text.slice(lt, end).includes('[')) throw bad(what, 'DTD internal subset')
      i = end + 1
      continue
    }
    if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt + 2)
      if (end < 0) throw bad(what, `unclosed end tag @${lt}`)
      const qname = text.slice(lt + 2, end).trim()
      if (stack.length <= 1 || qnames[qnames.length - 1] !== qname) throw bad(what, `mismatched </${qname}> @${lt}`)
      stack.pop()
      qnames.pop()
      i = end + 1
      continue
    }
    // 여는 태그: 따옴표 밖의 '>' 까지
    let j = lt + 1
    let quote = 0
    while (j < n) {
      const c = text.charCodeAt(j)
      if (quote) {
        if (c === quote) quote = 0
      } else if (c === 0x22 || c === 0x27) quote = c
      else if (c === 0x3e) break
      j++
    }
    if (j >= n) throw bad(what, `unclosed tag @${lt}`)
    let body = text.slice(lt + 1, j)
    const selfClosing = body.endsWith('/')
    if (selfClosing) body = body.slice(0, -1)
    let k = 0
    while (k < body.length && !isSpace(body.charCodeAt(k))) k++
    const qname = body.slice(0, k)
    if (qname === '') throw bad(what, `empty tag name @${lt}`)
    const attrs: Record<string, string> = {}
    const re = /\s*([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
    re.lastIndex = k
    while (re.lastIndex < body.length) {
      const start = re.lastIndex
      const m = re.exec(body)
      if (!m) {
        if (body.slice(start).trim() === '') break
        throw bad(what, `bad attribute in <${qname}> @${lt}`)
      }
      Object.defineProperty(attrs, m[1]!, { value: decodeEntities(m[2] ?? m[3] ?? ''), enumerable: true, writable: true, configurable: true })
    }
    const el: XmlElement = { name: localName(qname), attrs, children: [] }
    const parent = stack[stack.length - 1]!
    if (stack.length === 1 && parent.children.some((c) => typeof c !== 'string')) throw bad(what, 'two root elements')
    parent.children.push(el)
    if (!selfClosing) {
      stack.push(el)
      qnames.push(qname)
    }
    i = j + 1
  }
  if (stack.length > 1) throw bad(what, `unclosed <${qnames[qnames.length - 1]}>`)
  const top = root.children.find((c): c is XmlElement => typeof c !== 'string')
  if (!top) throw bad(what, 'no root element')
  return top
}

/** 속성 값. 이름이 같으면 그것을, 없으면 접두사를 뗀 이름이 같은 첫 속성을 */
export function attr(el: XmlElement, name: string): string | undefined {
  if (Object.hasOwn(el.attrs, name)) return el.attrs[name]
  for (const [k, v] of Object.entries(el.attrs)) if (localName(k) === name && k.includes(':')) return v
  return undefined
}

/** 자식 요소 (이름을 주면 그 이름만) */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = []
  for (const c of el.children) if (typeof c !== 'string' && (name === undefined || c.name === name)) out.push(c)
  return out
}

export function firstChild(el: XmlElement, name: string): XmlElement | null {
  for (const c of el.children) if (typeof c !== 'string' && c.name === name) return c
  return null
}

/** 모든 자손 글자를 이어 붙인 것 */
export function textContent(el: XmlElement): string {
  let s = ''
  for (const c of el.children) s += typeof c === 'string' ? c : textContent(c)
  return s
}
