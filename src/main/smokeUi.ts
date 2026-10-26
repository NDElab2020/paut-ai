/** 스모크 보조: 실제 API 로 렌더된 화면을 메뉴별로 열어 글자를 확인하고 PNG 로 저장한다 (--smoke-shots=<폴더>). */
import type { BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface UiCheck {
  menu: string
  found: string[]
  missing: string[]
  shot: string | null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function clickMenu(win: BrowserWindow, title: string): Promise<boolean> {
  return win.webContents.executeJavaScript(`(() => {
    const b = [...document.querySelectorAll('nav.sidebar button.nav-item')].find((x) => x.textContent.includes(${JSON.stringify(title)}))
    if (!b) return false
    b.click()
    return true
  })()`)
}

async function check(win: BrowserWindow, menu: string, expected: string[], shotsDir: string | null, index: number, select?: string): Promise<UiCheck> {
  const clicked = await clickMenu(win, menu)
  await sleep(1200)
  if (select) {
    // 메뉴 안에서 한 항목을 골라 본다 (예: 플랜 목록의 첫 플랜 — 목록은 두께 묶음 순서라 기본 선택이 다를 수 있음)
    const picked: boolean = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(select)})
      if (!el) return false
      el.click()
      return true
    })()`)
    if (picked) await sleep(800)
  }
  const text: string = await win.webContents.executeJavaScript('document.body.innerText')
  const found = expected.filter((t) => text.includes(t))
  let shot: string | null = null
  if (shotsDir) {
    const img = await win.webContents.capturePage()
    if (!img.isEmpty()) {
      shot = join(shotsDir, `${String(index + 1).padStart(2, '0')}-${menu.replace(/\s+/g, '_')}.png`)
      await writeFile(shot, img.toPNG())
    }
  }
  if (shotsDir) {
    const scrolled: boolean = await win.webContents.executeJavaScript(`(() => {
      const els = [...document.querySelectorAll('main *')].filter((e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible')
      els.forEach((e) => (e.scrollTop = e.scrollHeight))
      return els.length > 0
    })()`)
    if (scrolled) {
      await sleep(400)
      const img = await win.webContents.capturePage()
      if (!img.isEmpty()) await writeFile(join(shotsDir, `${String(index + 1).padStart(2, '0')}-${menu.replace(/\s+/g, '_')}-아래.png`), img.toPNG())
    }
  }
  return { menu, found, missing: clicked ? expected.filter((t) => !found.includes(t)) : ['(메뉴 없음)', ...expected], shot }
}

/** 페이지를 다시 읽어 최신 데이터로 그린 뒤 메뉴를 차례로 연다. select[메뉴] = 그 메뉴를 연 뒤 누를 요소(CSS 선택자) */
export async function walkUi(win: BrowserWindow, shotsDir: string | null, expect: Record<string, string[]>, select: Record<string, string> = {}): Promise<UiCheck[]> {
  if (shotsDir) await mkdir(shotsDir, { recursive: true })
  await new Promise<void>((resolve) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.reload()
  })
  await sleep(1000)
  const out: UiCheck[] = []
  for (const [i, [menu, texts]] of Object.entries(expect).entries()) out.push(await check(win, menu, texts, shotsDir, i, select[menu]))
  return out
}

/** '스캔플랜별 데이터' → 첫 파일 행 펼침 → '이미지로 보기' → 영상이 그려질 때까지 기다려 글자 확인·PNG 저장 */
export async function openViewerUi(win: BrowserWindow, shotsDir: string | null, expected: string[], index: number): Promise<UiCheck> {
  const menu = '이미지 보기'
  await clickMenu(win, '스캔플랜별 데이터')
  await sleep(1200)
  const opened: boolean = await win.webContents.executeJavaScript(`(async () => {
    const row = document.querySelector('main tr[data-row]')
    if (!row) return false
    row.click()
    await new Promise((r) => setTimeout(r, 500))
    const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.includes('이미지로 보기'))
    if (!b) return false
    b.click()
    return true
  })()`)
  // 진폭 읽기·C-scan 계산·첫 그림까지 기다린다 (최대 15 s). 오류 알림이 뜨면 바로 멈춘다
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    const loading: boolean = await win.webContents.executeJavaScript(
      `!document.querySelector('.viewer .notice--error') && (!!document.querySelector('.viewer__loading') || !document.querySelector('.viewer__body'))`
    )
    if (!loading) break
  }
  await sleep(500)
  const text: string = await win.webContents.executeJavaScript('document.body.innerText')
  const found = expected.filter((t) => text.includes(t))
  let shot: string | null = null
  if (shotsDir) {
    const img = await win.webContents.capturePage()
    if (!img.isEmpty()) {
      shot = join(shotsDir, `${String(index + 1).padStart(2, '0')}-이미지_보기.png`)
      await writeFile(shot, img.toPNG())
    }
  }
  return { menu, found, missing: opened ? expected.filter((t) => !found.includes(t)) : ['(이미지로 보기 버튼 없음)', ...expected], shot }
}

/**
 * 이미지 보기 조작 점검 (openViewerUi 다음에): 포커스가 뷰어 안에 있는지, → 키로 스캔 위치가 움직이는지,
 * A-B-C-S 로 바꾸면 B-scan 이 나오는지. 마지막 화면을 PNG 로 남긴다.
 */
export async function checkViewerControls(win: BrowserWindow, shotsDir: string | null, index: number): Promise<UiCheck> {
  const menu = '이미지 보기 조작'
  const r: { focusInViewer: boolean; before: string; after: string; abcs: boolean } = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const scanText = () => {
      const dts = [...document.querySelectorAll('.viewer__readout dt')]
      const dt = dts.find((d) => d.textContent.trim() === '스캔')
      return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : ''
    }
    const a = document.activeElement
    const focusInViewer = !!(a && a.closest && a.closest('.viewer'))
    const before = scanText()
    const target = focusInViewer ? a : document.querySelector('.viewer')
    for (let i = 0; i < 3; i++) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }))
      await sleep(80)
    }
    await sleep(300)
    const after = scanText()
    const b = [...document.querySelectorAll('.viewer button')].find((x) => x.textContent.trim() === 'A-B-C-S')
    if (b) b.click()
    await sleep(1500)
    return { focusInViewer, before, after, abcs: document.body.innerText.includes('B-scan') }
  })()`)
  const num = (s: string): number => Number.parseFloat(s.replace('−', '-'))
  const moved = Number.isFinite(num(r.before)) && Math.abs(num(r.after) - num(r.before) - 3) < 1e-6
  const checks: Array<[string, boolean]> = [
    ['포커스가 뷰어 안', r.focusInViewer],
    [`→ 3번에 스캔 +3 mm (${r.before} → ${r.after})`, moved],
    ['A-B-C-S 에 B-scan', r.abcs]
  ]
  let shot: string | null = null
  if (shotsDir) {
    const img = await win.webContents.capturePage()
    if (!img.isEmpty()) {
      shot = join(shotsDir, `${String(index + 1).padStart(2, '0')}-이미지_보기_A-B-C-S.png`)
      await writeFile(shot, img.toPNG())
    }
  }
  return { menu, found: checks.filter(([, ok]) => ok).map(([t]) => t), missing: checks.filter(([, ok]) => !ok).map(([t]) => t), shot }
}
