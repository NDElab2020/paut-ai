/**
 * --smoke: 창을 띄우지 않고 앱 구성요소를 점검한 뒤 종료 (exit 0 = 성공).
 *   - h5wasm/node 초기화, node:sqlite 메모리 DB
 *   - 숨김 창으로 렌더러 로드 → preload 의 window.pautApi 로 실제 IPC 왕복(설정 읽기, 앱 정보)
 *   - --smoke-nde=<경로> 가 있으면 --smoke-store=<폴더>(기본 userData/smoke-store) 를 저장소로 정하고 그 파일·폴더를 analyze.
 *     --smoke-nde 를 여러 번 주면 모두 한 번에 가져온다 (.nde·.opd 섞어도 됨)
 *   - --smoke-commit 이면 확정까지 하고, 페이지를 다시 읽어 메뉴별 화면 글자를 확인 (--smoke-shots=<폴더> 면 PNG 저장).
 *     기대 글자(플랜 ID·시편 ID·파일 이름)는 확정 결과에서 첫 플랜의 첫 사본으로 정한다 (X3·OPD 어느 쪽이든)
 *   - --smoke-viewer 를 더하면(확정 필요) 첫 파일을 이미지 보기용으로 열어 진폭이 Int16Array 로 오는지·걸린 시간을 재고,
 *     화면에서 '이미지로 보기'를 눌러 S·C·A-scan 화면 글자를 확인한다 (윈도우 설치본 점검: PAUT_ALLOW_SMOKE=1).
 *     가져온 것 중 OPD 가 있으면 첫 OPD 도 같은 IPC 왕복을 하고 '대조 전'(verified false)·막는 이유를 확인한다(viewer.opd)
 *   - --smoke-report=<파일> 이면 결과 JSON 을 파일로도 남긴다 (윈도우 GUI 앱은 콘솔 출력이 안 보일 수 있어서)
 *   - --smoke-steps=<js 파일> 이면 메뉴별 글자 확인 대신 그 파일의 시나리오를 돌린다. 파일은 렌더러에서 실행되어
 *     window.__pautSteps = [{ name, window?: {width,height}, run: async () => any }] 를 정의한다. 단계마다 창 크기를 맞추고,
 *     run() 결과(ok === false 또는 error 면 실패)와 화면 PNG, 결과의 canvases{이름: dataURL}를 PNG 로 남긴다 (tests/app/*.js)
 *     창 크기를 요청한 단계는 실제 적용된 크기(getContentSize·innerWidth/Height)를 window 에 기록하고, 다르면 실패
 *     (작은 화면·배율 때문에 OS 가 창을 줄인 경우 — 레이아웃 문제가 아니라 환경 문제로 보이게)
 *   - 렌더러 콘솔의 error 는 (알려진 무해 메시지 빼고) 어느 단계에서 났든 점검 실패. 단계별 개수는 steps[].consoleErrors
 *   - 결과 머리의 display 에 주 화면 배율(scaleFactor)·크기·작업영역을 남긴다 (125 %/150 % 실행 구분용)
 *   - --smoke-timeout=<ms> 전체 제한 시간 (기본 60000, 시나리오가 있으면 240000)
 */
import { app, screen, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { initNde } from '@core/nde'
import { checkViewerControls, openViewerUi, walkUi, type UiCheck } from './smokeUi'

interface RendererReport {
  title: string
  hasApi: boolean
  /** 확정 결과에서 정한 화면 기대 글자: 첫 플랜의 첫 사본 (플랜 ID·시편 ID·파일 이름) */
  expect?: { plan: string; specimen: string; file: string } | null
  settingsOk?: boolean
  infoOk?: boolean
  catalogPath?: string | null
  analyze?: unknown
  commit?: { copied: number; failed: number; plans: string[]; paths: string[] } | { error: string }
  progressEvents?: number
  /** 라벨 IPC 왕복 (확정까지 한 저장소에서): 세션·현황·충돌 목록, 대화상자로 고르지 않은 엑셀 경로는 INVALID_ARGUMENT */
  labels?: { pcId: string; versionSlot: string; files: number; conflicts: number; unapprovedPathCode: string } | { error: string }
  error?: string
}

interface ViewerReport {
  fileId?: number
  fileName?: string
  openMs?: number
  groups?: Array<{ name: string; supported: boolean; reason: string | null; verified?: boolean; blockReason?: string | null }>
  formatFamily?: string
  chunk?: { group: string; ms: number; type: string; length: number; expected: number; bytes: number; statusType: string }
  /** 옛 키로 조각을 달라고 했을 때의 응답 코드 (CONFLICT 여야 함) */
  staleKeyCode?: string
  error?: string
  /** 가져온 것 중 첫 OPD 파일의 같은 왕복 (없으면 null) */
  opd?: ViewerReport | null
}

/**
 * 이미지 보기 IPC 왕복: viewer:open → 첫 그릴 수 있는 그룹의 첫 조각(32 MB 이하), 옛 키는 CONFLICT.
 * 이름순 첫 파일과, 가져온 것 중 첫 OPD 파일(있으면 out.opd)
 */
function viewerScript(): string {
  return `(async () => {
    const api = window.pautApi
    const roundTrip = async (item) => {
      const out = { fileId: item.id, fileName: item.storedFileName }
      try {
        const id = item.id
        let t = performance.now()
        const opened = await api.viewer.open(id)
        out.openMs = Math.round(performance.now() - t)
        if (!opened.ok) throw new Error('viewer.open ' + opened.code + ' ' + opened.message)
        out.formatFamily = opened.data.info.formatFamily
        out.groups = opened.data.info.groups.map((g) => ({ name: g.name, supported: g.supported, reason: g.reason, verified: g.verified, blockReason: g.blockReason === undefined ? undefined : g.blockReason }))
        const g = opened.data.info.groups.find((x) => x.supported)
        if (g) {
          const [ns, nb, nt] = g.shape
          const count = Math.max(1, Math.min(ns, Math.floor((32 * 1024 * 1024) / (nb * nt * 2))))
          t = performance.now()
          const c = await api.viewer.chunk(id, opened.data.key, g.id, 0, count)
          const ms = Math.round(performance.now() - t)
          if (!c.ok) throw new Error('viewer.chunk ' + c.code + ' ' + c.message)
          out.chunk = { group: g.name, ms, type: Object.prototype.toString.call(c.data.amplitude), length: c.data.amplitude.length, expected: c.data.scanCount * nb * nt, bytes: c.data.amplitude.byteLength, statusType: Object.prototype.toString.call(c.data.status) }
          const stale = await api.viewer.chunk(id, opened.data.key + '#old', g.id, 0, 1)
          out.staleKeyCode = stale.ok ? 'ok' : stale.code
        }
      } catch (e) {
        out.error = String(e && e.message || e)
      }
      return out
    }
    try {
      const files = await api.files.list({ limit: 1, sort: 'fileName-asc' })
      if (!files.ok || !files.data.items[0]) throw new Error('파일 없음 ' + (files.ok ? '' : files.code))
      const out = await roundTrip(files.data.items[0])
      const all = await api.files.list({ limit: 1000, sort: 'fileName-asc' })
      const opd = all.ok ? all.data.items.find((f) => f.meta && f.meta.ndeVersion && f.meta.ndeVersion.family === 'opd') : null
      out.opd = opd ? (opd.id === out.fileId ? { ...out } : await roundTrip(opd)) : null
      return out
    } catch (e) {
      return { error: String(e && e.message || e) }
    }
  })()`
}

function checkSqlite(): string {
  const db = new DatabaseSync(':memory:')
  try {
    return String((db.prepare('select sqlite_version() as v').get() as { v: string }).v)
  } finally {
    db.close()
  }
}

const arg = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}

/** --name=값 을 모두 (여러 번 줄 수 있는 옵션) */
const args = (name: string): string[] => process.argv.filter((x) => x.startsWith(`--${name}=`)).map((x) => x.slice(name.length + 3))

/** 렌더러 안에서 실행할 스크립트 (preload API 만 쓴다) */
function rendererScript(ndePaths: string[], storeRoot: string, commit: boolean): string {
  return `(async () => {
    const out = { title: document.title, hasApi: typeof window.pautApi === 'object' }
    if (!out.hasApi) return out
    try {
      const api = window.pautApi
      let progressEvents = 0
      const off = api.onProgress(() => { progressEvents++ })
      const s = await api.settings.get()
      out.settingsOk = s.ok
      const ndePaths = ${JSON.stringify(ndePaths)}
      if (ndePaths.length) {
        const set = await api.settings.set({ storeRoot: ${JSON.stringify(storeRoot)} })
        if (!set.ok) throw new Error('settings.set ' + set.code + ' ' + set.message)
        const pv = await api.import.analyze(ndePaths)
        out.analyze = pv.ok
          ? { counts: pv.data.counts, items: pv.data.items.map((i) => ({ file: i.fileName, verdict: i.verdict, specimen: i.suggestedSpecimenId, tag: i.suggestedStateTag, fp: i.setup && i.setup.fingerprint.slice(0, 16) })), newPlans: pv.data.newPlans.map((n) => n.provisionalPlanId + ' ' + n.suggestedName), elapsedMs: pv.data.elapsedMs }
          : { error: pv.code + ' ' + pv.message }
        if (${commit} && pv.ok) {
          const p = pv.data
          const req = {
            previewId: p.previewId,
            newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
            items: p.items.filter((i) => i.verdict === 'new-plan' || i.verdict === 'match-existing').map((i) => ({
              itemId: i.itemId, include: true, specimenId: i.suggestedSpecimenId || 'UNKNOWN', specimenSource: i.suggestedSpecimenSource || 'manual',
              stateTag: i.suggestedStateTag, round: i.suggestedRound, memo: '스모크'
            }))
          }
          const r = await api.import.commit(req)
          out.commit = r.ok
            ? { copied: r.data.copiedCount, failed: r.data.failedCount, plans: r.data.createdPlanIds, paths: r.data.items.map((i) => i.storedRelPath || i.status) }
            : { error: r.code + ' ' + r.message }
          // 화면 기대 글자: 가장 앞 플랜(ID 순)의 첫 사본 — '스캔플랜/SP001/PL23833/12T-SV-01-Cap on.nde'
          if (r.ok) {
            const rows = r.data.items.map((i) => i.storedRelPath).filter(Boolean).map((p) => p.split('/')).filter((x) => x.length >= 4)
            rows.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
            out.expect = rows[0] ? { plan: rows[0][1], specimen: rows[0][2], file: rows[0][rows[0].length - 1] } : null
          }
        }
      }
      if (${commit}) {
        const ses = await api.labels.session()
        const ov = await api.labels.overview()
        const cf = await api.labels.listConflicts()
        const bad = await api.labels.previewWorkbook('C:/임의 경로/아무 엑셀.xlsx')
        out.labels = ses.ok && ov.ok && cf.ok
          ? { pcId: ses.data.pcId, versionSlot: ses.data.versionSlot, files: ov.data.files.length, conflicts: cf.data.length, unapprovedPathCode: bad.ok ? 'OK' : bad.code }
          : { error: [ses, ov, cf].filter((x) => !x.ok).map((x) => x.code + ' ' + x.message).join(' / ') }
      }
      const info = await api.app.info()
      out.infoOk = info.ok
      out.catalogPath = info.ok ? info.data.catalogPath : null
      off()
      out.progressEvents = progressEvents
    } catch (e) {
      out.error = String(e && e.message || e)
    }
    return out
  })()`
}

function waitRenderer(win: BrowserWindow, script: string): Promise<RendererReport> {
  return new Promise((resolve, reject) => {
    win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`renderer load failed ${code} ${desc}`)))
    win.webContents.once('did-finish-load', () => {
      win.webContents.executeJavaScript(script).then((r: RendererReport) => resolve(r), reject)
    })
  })
}

/** 창 크기를 요청한 단계의 적용 결과. asked 와 got·inner 가 모두 같아야 applied */
interface StepWindow {
  asked: [number, number]
  got: [number, number]
  inner: [number, number]
  applied: boolean
}

interface StepReport {
  name: string
  ok: boolean
  ms: number
  result: unknown
  shot: string | null
  canvases: Record<string, string>
  /** 이 단계 동안 렌더러 콘솔에 찍힌 error 수 (무해 메시지 제외). 0 이 아니면 실패 */
  consoleErrors: number
  window?: StepWindow
}

/** 알려진 무해한 콘솔 메시지 — 점검 실패로 치지 않는다 */
const BENIGN_CONSOLE: RegExp[] = [/Electron Security Warning/, /Autofill\.(enable|setAddresses)/]
const isConsoleError = (m: string): boolean => m.startsWith('error:') && !BENIGN_CONSOLE.some((re) => re.test(m))

/** 시나리오 파일의 단계를 차례로 실행 (렌더러 안에서). 단계 사이에 창 크기를 바꿀 수 있다.
 *  problems 는 runSmoke 가 모으는 콘솔 메시지 배열 — 단계마다 그동안 늘어난 error 를 센다 */
async function runSteps(win: BrowserWindow, stepsPath: string, shotsDir: string | null, problems: string[]): Promise<StepReport[]> {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  if (shotsDir) mkdirSync(shotsDir, { recursive: true })
  // 가져오기는 API 로 했으므로 화면은 아직 모른다 → 다시 읽어 최신 저장소·데이터로 그린 뒤 시작 (walkUi 와 같음)
  await new Promise<void>((resolve) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.reload()
  })
  await sleep(1000)
  await win.webContents.executeJavaScript(readFileSync(stepsPath, 'utf8'))
  const count: number = await win.webContents.executeJavaScript('Array.isArray(window.__pautSteps) ? window.__pautSteps.length : -1')
  if (count < 0) throw new Error('시나리오 파일이 window.__pautSteps 배열을 정의하지 않음')
  const out: StepReport[] = []
  for (let i = 0; i < count; i++) {
    const meta: { name: string; window: { width: number; height: number } | null } = await win.webContents.executeJavaScript(
      `({ name: String(window.__pautSteps[${i}].name), window: window.__pautSteps[${i}].window || null })`
    )
    let winSize: StepWindow | undefined
    if (meta.window) {
      // 화면(내용 영역) 크기 기준 — 창 테두리·제목줄은 빼고
      const asked: [number, number] = [meta.window.width, meta.window.height]
      win.setContentSize(asked[0], asked[1])
      await sleep(400)
      // 작은 화면·높은 배율에서는 OS 가 창을 작업영역에 맞춰 줄일 수 있다 → 실제 크기를 읽어 확인
      const [gw, gh] = win.getContentSize()
      const inner: [number, number] = await win.webContents.executeJavaScript('[innerWidth, innerHeight]')
      const got: [number, number] = [gw ?? 0, gh ?? 0]
      const applied = got[0] === asked[0] && got[1] === asked[1] && inner[0] === asked[0] && inner[1] === asked[1]
      winSize = { asked, got, inner, applied }
    }
    const before = problems.length
    const t0 = performance.now()
    let result: unknown
    try {
      result = await win.webContents.executeJavaScript(`Promise.resolve(window.__pautSteps[${i}].run()).catch((e) => ({ error: String(e && e.stack || e) }))`)
    } catch (e) {
      result = { error: String((e as Error)?.message ?? e) }
    }
    const ms = Math.round(performance.now() - t0)
    await sleep(400)
    const consoleErrors = problems.slice(before).filter(isConsoleError).length
    const tag = `S${String(i + 1).padStart(2, '0')}-${meta.name.replace(/[^\w가-힣.-]+/g, '_')}`
    let shot: string | null = null
    const canvases: Record<string, string> = {}
    const r = (result ?? {}) as Record<string, unknown>
    if (winSize && !winSize.applied) {
      // 레이아웃 단언이 엉뚱한 이유로 깨지기 전에, 환경 문제라고 이름 붙인다
      const dim = (p: [number, number]): string => `${p[0]}×${p[1]}`
      const msg = `창 크기 적용 안 됨 — 화면 해상도/배율 확인 (요청 ${dim(winSize.asked)}, 창 ${dim(winSize.got)}, 화면 ${dim(winSize.inner)})`
      r['error'] = r['error'] ? `${msg}; ${String(r['error'])}` : msg
    }
    if (shotsDir) {
      const img = await win.webContents.capturePage()
      if (!img.isEmpty()) {
        shot = join(shotsDir, `${tag}.png`)
        writeFileSync(shot, img.toPNG())
      }
      const cv = r['canvases']
      if (cv && typeof cv === 'object') {
        for (const [name, dataUrl] of Object.entries(cv as Record<string, string>)) {
          const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
          if (!m) continue
          const file = join(shotsDir, `${tag}-${name.replace(/[^\w가-힣.-]+/g, '_')}.png`)
          writeFileSync(file, Buffer.from(m[1]!, 'base64'))
          canvases[name] = file
        }
      }
    }
    delete r['canvases']
    const ok = !r['error'] && r['ok'] !== false && consoleErrors === 0
    const step: StepReport = { name: meta.name, ok, ms, result: r, shot, canvases, consoleErrors }
    if (winSize) step.window = winSize
    out.push(step)
    console.log(`[smoke] step ${tag}: ${ok ? 'ok' : 'FAIL'} (${ms} ms${consoleErrors ? `, console error ${consoleErrors}` : ''})`)
  }
  return out
}

function viewerPassed(v: ViewerReport | null): boolean {
  if (!v) return true
  const one = (x: ViewerReport): boolean => {
    const c = x.chunk
    return !x.error && !!c && c.type === '[object Int16Array]' && c.length === c.expected && x.staleKeyCode === 'CONFLICT'
  }
  if (!one(v)) return false
  // OPD: 대조 전(verified false)이고 그릴 수 있는 그룹에 막는 이유가 붙어야 한다 (OPD 표는 비어 있음)
  if (v.opd) {
    const g = v.opd.groups?.find((x) => x.supported)
    if (!one(v.opd) || v.opd.formatFamily !== 'opd' || !g || g.verified !== false || !g.blockReason) return false
  }
  return true
}

function passed(r: RendererReport, wantAnalyze: boolean, problems: string[], ui: UiCheck[]): boolean {
  if (!r.hasApi || r.error || !r.settingsOk || !r.infoOk) return false
  if (ui.some((c) => c.missing.length > 0)) return false
  if (r.commit && 'error' in r.commit) return false
  if (r.labels && ('error' in r.labels || r.labels.unapprovedPathCode !== 'INVALID_ARGUMENT' || !r.labels.versionSlot.startsWith(`${r.labels.pcId}:`))) return false
  // CSP 위반과 렌더러 콘솔 error(무해 목록 제외)는 어디서 났든 실패 — JSON 을 열어 보지 않아도 bat 가 '점검 실패' 를 찍게
  if (problems.some((m) => m.includes('Content Security Policy') || isConsoleError(m))) return false
  if (!wantAnalyze) return true
  const a = r.analyze as { counts?: Record<string, number> } | undefined
  const readable = (a?.counts?.['new-plan'] ?? 0) + (a?.counts?.['match-existing'] ?? 0) + (a?.counts?.['duplicate'] ?? 0)
  return !!a?.counts && readable >= 1 && (a.counts['error'] ?? 0) === 0
}

export async function runSmoke(createWindow: () => BrowserWindow): Promise<never> {
  const ndePaths = args('smoke-nde')
  const storeRoot = arg('smoke-store') ?? join(app.getPath('userData'), 'smoke-store')
  const commit = ndePaths.length > 0 && process.argv.includes('--smoke-commit')
  const shots = arg('smoke-shots')
  const wantViewer = commit && process.argv.includes('--smoke-viewer')
  const stepsPath = commit ? arg('smoke-steps') : null
  const timeoutMs = Number(arg('smoke-timeout')) || (stepsPath ? 240_000 : 60_000)
  const timer = setTimeout(() => {
    console.error('[smoke] timeout')
    const reportPath = arg('smoke-report')
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ ok: false, error: `timeout ${timeoutMs} ms` }, null, 2), 'utf8')
    app.exit(2)
  }, timeoutMs)
  try {
    const t0 = performance.now()
    await initNde()
    const h5wasm = `ready (${Math.round(performance.now() - t0)}ms)`
    const sqlite = checkSqlite()
    const win = createWindow()
    const consoleProblems: string[] = []
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') consoleProblems.push(`${e.level}: ${e.message}`)
    })
    const renderer = await waitRenderer(win, rendererScript(ndePaths, storeRoot, commit))
    await new Promise((r) => setTimeout(r, 1000))
    const viewer: ViewerReport | null = wantViewer ? await win.webContents.executeJavaScript(viewerScript()) : null
    // 시나리오가 있으면 메뉴별 글자 확인 대신 시나리오만 (가져온 파일이 여러 개면 첫 화면이 달라지므로)
    // 기대 글자는 확정 결과의 첫 플랜·첫 사본에서 (X3 만이면 'SP001'·'PL23833'·'12T-SV-01-Cap on.nde' 로 예전과 같음)
    const ex = renderer.expect ?? null
    const ui =
      commit && !stepsPath
        ? await walkUi(
            win,
            shots,
            {
              '스캔플랜별 데이터': ex ? [ex.plan, ex.specimen, ex.file] : ['(확정 결과 없음)'],
              '가져오기 이력': ex ? [ex.plan] : ['(확정 결과 없음)'],
              '설정': [storeRoot]
            },
            // 플랜 목록은 두께 묶음 순서라 기본 선택이 첫 플랜(ID)이 아닐 수 있다 → 그 플랜을 눌러 본다
            ex ? { '스캔플랜별 데이터': `.plan-list [data-row="${ex.plan}"]` } : {}
          )
        : []
    if (wantViewer && !stepsPath) {
      ui.push(await openViewerUi(win, shots, ['S-scan', 'C-scan', 'A-scan', 'A%'], ui.length))
      ui.push(await checkViewerControls(win, shots, ui.length))
    }
    const steps = stepsPath ? await runSteps(win, stepsPath, shots, consoleProblems) : []
    const ok = passed(renderer, ndePaths.length > 0, consoleProblems, ui) && viewerPassed(viewer) && steps.every((s) => s.ok)
    // 주 화면 배율·크기 — 윈도우 125 %/150 % 실행인지, 1440×900 창이 들어가는 작업영역인지 구분용 (whenReady 뒤라 screen 사용 가능)
    const primary = screen.getPrimaryDisplay()
    const display = { scaleFactor: primary.scaleFactor, size: primary.size, workAreaSize: primary.workAreaSize }
    const report = { ok, platform: process.platform, electron: process.versions.electron, node: process.versions.node, display, sqlite, h5wasm, renderer, viewer, ui, steps, consoleProblems }
    console.log(`[smoke] renderer console: ${consoleProblems.filter(isConsoleError).length} error(s), ${consoleProblems.length} total`)
    console.log(`[smoke] ${JSON.stringify(report)}`)
    const reportPath = arg('smoke-report')
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    clearTimeout(timer)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    console.error('[smoke] 실패', err)
    const reportPath = arg('smoke-report')
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ ok: false, error: String((err as Error)?.stack ?? err) }, null, 2), 'utf8')
    app.exit(1)
  }
  return new Promise<never>(() => {})
}
