/**
 * 실제 앱 시나리오 (electron . --smoke --smoke-commit --smoke-steps=<이 파일>). 렌더러 안에서 돌며 window.pautApi 만 쓴다.
 * 가져온 파일: X3 12T-SV-01/03, 4.2 Sect·COD·4TFM, 3.3 ManualWeldPA, X4 TF_01_C_L_0001(컴파운드)·TF_01_L_0001(섹토리얼+리니어) (tests/app/README.md).
 * OPD 단계(open-opd-tp14 · opd-tp14-278-65)는 PCN TP14-ROOT-L-01.opd 를 함께 가져왔을 때만 돈다(없으면 건너뜀).
 * 이전·다음 파일 단계(file-nav-prev-next)는 PCN PL23864_TOP_R_01·02.opd(같은 플랜·시편, 플랜 순서에서 이웃)를 함께 가져왔을 때만 돈다(없으면 건너뜀).
 * 각 단계 run() 은 { ok, ... } 를 돌려주고, canvases { 이름: dataURL } 은 main 이 PNG 로 저장한다.
 * 기대값(첫 커서 칸, 데이터 없음 경계)은 뷰어 코드를 거치지 않고 window.pautApi 의 viewer.open/chunk 로 다시 계산해 비교한다.
 */
;(() => {
  const api = window.pautApi
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
  const text = () => document.body.innerText
  const numOf = (s) => Number.parseFloat(String(s).replace('−', '-'))

  async function waitFor(fn, timeoutMs = 20000, every = 150) {
    const t0 = performance.now()
    for (;;) {
      const v = fn()
      if (v) return v
      if (performance.now() - t0 > timeoutMs) throw new Error('waitFor 시간 초과: ' + fn.toString().slice(0, 120))
      await sleep(every)
    }
  }
  const clickText = (sel, t) => {
    const el = $$(sel).find((x) => x.textContent.trim() === t || x.textContent.includes(t))
    if (!el) throw new Error(`'${t}' 요소 없음 (${sel})`)
    el.click()
    return el
  }
  const clickNav = (title) => clickText('nav.sidebar button.nav-item', title)
  const segClick = (name) => clickText('.viewer .seg button', name)

  /** 측정값 줄 → { 그룹, 스캔, 각도, 'A%', ... } (글자 그대로) */
  const readout = () => {
    const out = {}
    for (const d of $$('.viewer__values > div')) {
      const dt = $('dt', d)
      const dd = $('dd', d)
      if (dt && dd) out[dt.textContent.trim()] = dd.textContent.trim().replace(/\s+/g, ' ')
    }
    return out
  }
  /** 'ok' 그림 준비됨 | 'empty' 볼 수 없는 파일 안내 | 'error' | null 아직 */
  const viewerState = () => {
    if ($('.viewer .notice--error')) return 'error'
    if ($('.viewer .empty')) return 'empty'
    if ($('.viewer__body') && !$('.viewer__loading')) return 'ok'
    return null
  }
  const key = (k, opts = {}) => {
    const a = document.activeElement
    const target = a && a.closest && a.closest('.viewer') ? a : $('.viewer')
    if (!target) throw new Error('뷰어 없음')
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true, ...opts }))
  }
  const scanMm = () => numOf(readout()['스캔'])
  /** 다음 프레임까지 → true. 숨김 창 등에서 rAF 가 멈춰 있으면 500 ms 뒤 false (단계가 멎지 않게) */
  const nextFrame = () =>
    new Promise((r) => {
      const tm = setTimeout(() => {
        cancelAnimationFrame(id)
        r(false)
      }, 500)
      const id = requestAnimationFrame(() => {
        clearTimeout(tm)
        r(true)
      })
    })
  // ── 통계 (성능 단계) ──
  const sorted = (xs) => [...xs].sort((a, b) => a - b)
  const median = (xs) => {
    const s = sorted(xs)
    const n = s.length
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN
  }
  const p95 = (xs) => {
    const s = sorted(xs)
    return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : NaN
  }
  const round1 = (v) => Math.round(v * 10) / 10
  /** ←/→ 키로 스캔 위치를 target(mm) 으로 (1 mm 격자 기준) */
  async function setScan(target) {
    for (let guard = 0; guard < 400; guard++) {
      const cur = scanMm()
      const diff = Math.round(target - cur)
      if (diff === 0) return cur
      key(diff > 0 ? 'ArrowRight' : 'ArrowLeft', { shiftKey: Math.abs(diff) >= 10 })
      await sleep(25)
    }
    throw new Error('스캔 이동 실패: ' + scanMm())
  }
  async function setAngle(target) {
    for (let guard = 0; guard < 80; guard++) {
      const cur = numOf(readout()['각도'])
      if (Math.abs(cur - target) < 1e-6) return cur
      // C-scan 이 뒤집힌 파일(첫 빔이 아래)은 ↑ 가 큰 각도. 두 방향을 시도해 가까워지는 쪽으로
      key('ArrowUp')
      await sleep(25)
      const next = numOf(readout()['각도'])
      if (Math.abs(next - target) > Math.abs(cur - target)) {
        key('ArrowDown')
        await sleep(25)
        key('ArrowDown')
        await sleep(25)
      }
    }
    throw new Error('빔 이동 실패')
  }
  const pointerAt = (canvas, fx, fy) => {
    const r = canvas.getBoundingClientRect()
    const ev = new PointerEvent('pointerdown', {
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1
    })
    canvas.dispatchEvent(ev)
  }
  const canvasInfo = (canvas) => {
    const r = canvas.getBoundingClientRect()
    return { width: canvas.width, height: canvas.height, cssWidth: r.width, cssHeight: r.height }
  }
  /** 캔버스 픽셀 읽기 — 화면 캔버스에 직접 getImageData 하면 경고가 나므로 1 px 만 오프스크린에 복사해서 읽는다 */
  const off = document.createElement('canvas')
  off.width = 1
  off.height = 1
  const offCtx = off.getContext('2d', { willReadFrequently: true })
  const pixelAt = (canvas, fx, fy) => {
    offCtx.clearRect(0, 0, 1, 1)
    offCtx.drawImage(canvas, Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1, 0, 0, 1, 1)
    const d = offCtx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }

  // ── 진폭 조각 읽기 (window.pautApi 만으로, 뷰어 코드와 무관하게) ──
  /** 32 MB 조각 범위 — shared/imaging chunkRanges 와 같은 계산. main 도 같은 상한으로 자르므로 한 번에 더 달라고 할 수 없다 */
  const chunkRangesOf = ([ns, nb, nt]) => {
    const step = Math.max(1, Math.floor((32 * 1024 * 1024) / Math.max(1, nb * nt * 2)))
    const out = []
    for (let s = 0; s < ns; s += step) out.push([s, Math.min(step, ns - s)])
    return out
  }
  /** 그룹 진폭·상태를 조각마다 받아 fn(chunk) — 받은 범위가 요청과 다르면 오류 */
  async function eachChunk(fileId, key, g, fn) {
    for (const [start, count] of chunkRangesOf(g.shape)) {
      const r = await api.viewer.chunk(fileId, key, g.id, start, count)
      if (!r.ok) throw new Error('viewer.chunk ' + r.code)
      if (r.data.scanStart !== start || r.data.scanCount !== count) {
        throw new Error(`조각 범위 불일치: 요청 [${start}, ${count}] ≠ 받음 [${r.data.scanStart}, ${r.data.scanCount}]`)
      }
      fn(r.data)
    }
  }
  /** 측정값 줄 '스캔' 과 같은 글자 (renderer lib/format num: 소수 한 자리, 음수 부호 −) */
  const fmtMm = (v) => v.toFixed(1).replace('-', '−') + ' mm'
  /**
   * 첫 커서 기대값 (계획 결정 8: 현재 그룹의 게이트 A C-scan 이 가장 센 스캔 칸) — 뷰어와 따로 api.viewer.open/chunk 로 다시 계산.
   *   현재 그룹 = 파일에 저장된 currentGroupId 의 그룹(볼 수 있을 때), 아니면 첫 번째 볼 수 있는 그룹 (NdeViewer ViewerBody 와 같음)
   *   게이트 창 = [round((start−t0)/Δt), round((start+len−t0)/Δt)+1) (shared/imaging gates.ts gateSampleWindow), 상태 비트 1 이 0 인 칸은 뺌
   *   같은 최대가 여럿이면 앞 칸 (strict >). 게이트가 없거나 계산할 수 없으면 0번 칸.
   *   실데이터: 12T-SV-01 202.0 mm · 12T-SV-03 62.0 mm · 4.2 Sect 50.0 mm (tests/app/README.md)
   */
  async function expectedFirstScan(fileId) {
    const opened = await api.viewer.open(fileId)
    if (!opened.ok) throw new Error('viewer.open ' + opened.code)
    const { info, key } = opened.data
    const supported = info.groups.filter((x) => x.supported)
    const g = supported.find((x) => x.id === info.display.currentGroupId) ?? supported[0]
    if (!g) throw new Error('볼 수 있는 그룹 없음')
    const [, nb, nt] = g.shape
    const gate = g.gates.find((x) => x.id === g.cscanGateId)
    let at = 0
    let best = -1
    if (gate && gate.supported) {
      const res = g.ultrasound.resolutionUs
      const win = g.beams.map((beam, b) => {
        const st = gate.startUs[b] ?? gate.startUs[0]
        const ln = gate.lengthUs[b] ?? gate.lengthUs[0]
        const i0 = Math.max(0, Math.round((st - beam.t0Us) / res))
        const i1 = Math.min(g.ultrasound.count, Math.round((st + ln - beam.t0Us) / res) + 1)
        return i1 > i0 ? [i0, i1] : [i0, i0]
      })
      await eachChunk(fileId, key, g, (ch) => {
        const A = ch.amplitude
        for (let s = 0; s < ch.scanCount; s++) {
          for (let b = 0; b < nb; b++) {
            const st = ch.status ? ch.status[s * nb + b] : 1
            const [i0, i1] = win[b]
            if (!(st & 1) || i1 <= i0) continue
            const base = (s * nb + b) * nt
            let m = -32768
            let mi = -1
            for (let i = i0; i < i1; i++) {
              if (A[base + i] > m) {
                m = A[base + i]
                mi = i
              }
            }
            if (mi >= 0 && m > best) {
              best = m
              at = ch.scanStart + s
            }
          }
        }
      })
    }
    return { group: g.name, scanIndex: at, scanMm: fmtMm(g.scan.offsetMm + at * g.scan.resolutionMm), peakRaw: best }
  }
  /**
   * 그림 준비('ok') 직후의 readout 은 과도 상태일 수 있다 — 첫 커서는 볼륨이 놓인 커밋 다음 effect 에서 놓이므로 그 사이엔 offset(0.0 mm).
   * 기대 스캔 위치와 같아질 때까지 기다린다. 못 맞추면 false (단계가 값을 기록하고 ok 로 판정)
   */
  const waitScan = (expectedMm, timeoutMs = 5000) => waitFor(() => readout()['스캔'] === expectedMm, timeoutMs, 50).then(() => true, () => false)

  /**
   * 스캔플랜별 데이터 → 파일이 든 플랜 → 행 펼침 → 이미지로 보기 → 그림 준비(openMs) → 첫 커서가 기대값에 놓이기까지.
   * firstScan 은 독립 계산한 기대값, firstScanOk 는 readout 이 그 값에 닿았는지 (볼 수 있는 파일일 때만)
   */
  async function openFile(name) {
    clickNav('스캔플랜별 데이터')
    await sleep(500)
    const r = await api.files.list({ text: name, limit: 50 })
    if (!r.ok) throw new Error('files.list ' + r.code)
    const item = r.data.items.find((f) => f.storedFileName === name)
    if (!item) throw new Error('파일 없음: ' + name)
    const planRow = await waitFor(() => $(`.plan-list [data-row="${item.planId}"]`))
    planRow.click()
    const row = await waitFor(() => $(`main tr[data-row="${item.id}"]`))
    if (row.getAttribute('aria-expanded') !== 'true') row.click()
    // 그 행 바로 아래 펼침 칸의 단추만 (같은 플랜의 앞 파일 펼침이 남아 있으면 그 단추를 잡아, 다시 그려진 뒤 떨어진 단추를 누르게 됨)
    const detailButton = () => {
      const cur = $(`main tr[data-row="${item.id}"]`)
      const d = cur && cur.nextElementSibling
      return d && d.classList.contains('detail-row') ? $$('button', d).find((b) => b.isConnected && b.textContent.includes('이미지로 보기')) : null
    }
    const btn = await waitFor(detailButton)
    const t0 = performance.now()
    ;(btn.isConnected ? btn : await waitFor(detailButton)).click()
    const state = await waitFor(viewerState, 30000)
    const openMs = Math.round(performance.now() - t0)
    let firstScan = null
    let firstScanOk = false
    if (state === 'ok') {
      // 기대값 계산(IPC)은 그림 준비 뒤에 — 앱이 읽는 동안 같이 읽으면 openMs 가 흐려진다
      firstScan = await expectedFirstScan(item.id)
      firstScanOk = await waitScan(firstScan.scanMm)
    }
    return { item, state, openMs, firstScan, firstScanOk }
  }

  // ── S-scan 기하 (앱과 같은 식: shared/imaging coords·sscanExtent, NdeViewer ranges 2% 여백) ──
  const DEG = Math.PI / 180
  const samplePoint = (beam, i, us) => {
    const t = beam.t0Us + i * us.resolutionUs
    const rr = (beam.velocityMps * 1e-3 * t) / 2
    const s = Math.round(beam.skewDeg) % 360 === 270 ? -1 : 1
    return { v: beam.vOffsetMm + s * rr * Math.sin(beam.angleDeg * DEG), d: rr * Math.cos(beam.angleDeg * DEG) }
  }
  const extent = (g) => {
    let vMin = Infinity, vMax = -Infinity, dMin = Infinity, dMax = -Infinity
    for (const b of g.beams) for (const i of [0, g.ultrasound.count - 1]) {
      const p = samplePoint(b, i, g.ultrasound)
      vMin = Math.min(vMin, p.v); vMax = Math.max(vMax, p.v); dMin = Math.min(dMin, p.d); dMax = Math.max(dMax, p.d)
    }
    return { vMin, vMax, dMin, dMax }
  }
  const viewportSingle = (g) => {
    const e = extent(g)
    const vPad = (e.vMax - e.vMin) * 0.02
    const dPad = (e.dMax - e.dMin) * 0.02
    return { vMin: e.vMin - vPad, vMax: e.vMax + vPad, dMin: Math.max(0, e.dMin - dPad), dMax: e.dMax + dPad }
  }

  // ── 후처리 단계 보조 ──
  /** 조정 패널 열기/닫기 — 렌더가 끝나 패널이 생기거나 사라질 때까지 기다린다 */
  async function openTools() {
    const b = $('.viewer__bar button[aria-expanded]')
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click()
    await waitFor(() => $('.viewer__tools'), 5000, 50)
  }
  async function closeTools() {
    const b = $('.viewer__bar button[aria-expanded]')
    if (b && b.getAttribute('aria-expanded') === 'true') b.click()
    await waitFor(() => !$('.viewer__tools'), 5000, 50)
  }
  /** 탭·하위 탭 고르기 — 행이 다시 그려질 때까지 한 박자 기다린다 */
  async function toolsTab(name) {
    clickText('.viewer__tools [aria-label="조정 항목"] button', name)
    await sleep(120)
  }
  async function toolsSub(name) {
    await waitFor(() => $('.viewer__tools [aria-label="범위 뷰"]'), 3000, 50)
    clickText('.viewer__tools [aria-label="범위 뷰"] button', name)
    await sleep(120)
  }
  /** 조정 패널 숫자 칸에 값 넣고 Enter (React 가 받도록 네이티브 setter 로) */
  async function setField(ariaLabel, value) {
    const el = await waitFor(() => $(`.viewer__tools input[aria-label="${ariaLabel}"]`), 5000, 50)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, String(value))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    await sleep(150)
  }
  /** '파일값으로'(있으면) 누르고 패널을 닫아 기본 상태로 */
  async function postReset() {
    const b = $$('.viewer__bar button').find((x) => x.textContent.trim() === '파일값으로')
    if (b) b.click()
    await closeTools()
    await sleep(300)
  }
  /** 축 aria-label ('깊이 5~50 mm (…)') 의 범위 글자 */
  const axisLabel = (title) => {
    const svg = $$('.viewer svg.vaxis').find((x) => (x.getAttribute('aria-label') || '').startsWith(title + ' '))
    if (!svg) return ''
    const m = /^(.+?) \(/.exec(svg.getAttribute('aria-label'))
    return (m ? m[1] : svg.getAttribute('aria-label')).slice(title.length + 1)
  }
  const pixelAlphaAt = (canvas, fx, fy) => {
    offCtx.clearRect(0, 0, 1, 1)
    offCtx.drawImage(canvas, Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1, 0, 0, 1, 1)
    return offCtx.getImageData(0, 0, 1, 1).data[3]
  }

  // ── 컴파운드·리니어·S-scan 게이트 끌기 단계 보조 (뷰어 코드와 따로 계산) ──
  /** 그룹 g 의 스캔 s 한 칸 진폭 [1, 빔, 샘플] (조각 1칸 요청) */
  async function scanSlice(fileId, key, g, s) {
    const r = await api.viewer.chunk(fileId, key, g.id, s, 1)
    if (!r.ok) throw new Error('viewer.chunk ' + r.code)
    return r.data
  }
  /**
   * (스캔 s, 빔 b) 의 게이트 A 최대 % — 창 = [round((t0−T0)/Δt), round((t1−T0)/Δt)] 양 끝 포함 (gates.ts gateSampleWindow), % = raw / rawMax × unitMax.
   * startDepthMm 를 주면 TrueDepth 게이트 시작만 그 깊이로 옮기고 그 빔의 파일 폭(깊이)은 그대로 둔다 (applyGateOverride 에 startMm 만 준 경우)
   */
  async function expectedGatePct(fileId, groupName, s, b, startDepthMm = null) {
    const opened = await api.viewer.open(fileId)
    if (!opened.ok) throw new Error('viewer.open ' + opened.code)
    const g = opened.data.info.groups.find((x) => x.name === groupName)
    const gate = g.gates.find((x) => x.id === g.cscanGateId)
    const beam = g.beams[b]
    const nt = g.shape[2]
    const res = g.ultrasound.resolutionUs
    const mmPerUs = beam.velocityMps * 1e-3
    const st = gate.startUs[b] ?? gate.startUs[0]
    const ln = gate.lengthUs[b] ?? gate.lengthUs[0]
    let t0 = st
    let t1 = st + ln
    if (startDepthMm !== null) {
      if (gate.geometry !== 'TrueDepth') throw new Error('TrueDepth 게이트가 아님: ' + gate.geometry)
      const c = Math.cos(beam.angleDeg * DEG)
      const widthDepth = ((mmPerUs * (st + ln)) / 2 - (mmPerUs * st) / 2) * c
      t0 = (2 * (startDepthMm / c)) / mmPerUs
      t1 = (2 * ((startDepthMm + widthDepth) / c)) / mmPerUs
    }
    const i0 = Math.max(0, Math.round((t0 - beam.t0Us) / res))
    const i1 = Math.min(nt, Math.round((t1 - beam.t0Us) / res) + 1)
    const ch = await scanSlice(fileId, opened.data.key, g, s)
    let best = -32768
    for (let i = i0; i < i1; i++) best = Math.max(best, ch.amplitude[b * nt + i])
    return { pct: (best / g.ampScale.rawMax) * g.ampScale.unitMax, raw: best, window: [i0, i1], thresholdPct: gate.thresholdPct }
  }
  /** C-scan 캔버스에서 칸 (스캔 k, 빔 b) 가운데를 누른다 (스캔 창 전체일 때). 뒤집힘(첫 빔이 아래)은 파일 화면 상태 info.display.cscanReversed */
  function clickCscanCell(canvas, ns, nb, k, b, reversed) {
    const fy = (b + 0.5) / nb
    pointerAt(canvas, (k + 0.5) / ns, reversed ? 1 - fy : fy)
  }
  /** C-scan 왼쪽 축 글자 'top~bottom°' → 숫자 (위 끝, 아래 끝) */
  function cscanAxisEnds(title) {
    const m = /^([−\-\d.]+)~([−\-\d.]+)°?$/.exec(axisLabel(title))
    return m ? { top: numOf(m[1]), bottom: numOf(m[2]) } : { top: NaN, bottom: NaN }
  }
  const toolsValue = (ariaLabel) => $(`.viewer__tools input[aria-label="${ariaLabel}"]`)?.value ?? ''

  const TF_COMPOUND = 'TF_01_C_L_0001.nde'
  const TF_LINEAR = 'TF_01_L_0001.nde'
  let tfLinearFileId = null

  const X3 = '12T-SV-01-Cap on.nde'
  /** OPD 대조 파일 (3_화면대조.md) — 함께 가져왔을 때만 OPD 단계를 돈다 */
  const OPD_TP14 = 'TP14-ROOT-L-01.opd'
  let opdFileId = null
  let x3FileId = null
  /** open-x3 에서 계산한 첫 커서 기대값 — 다시 열기(back-restore-reopen)도 같은 값이어야 한다 */
  let x3FirstScan = null

  // ── 라벨 모드 단계 보조 (계획_라벨링 1b: 도구막대 '라벨'·L 키, 오른쪽 라벨 패널, S-scan 확대·점 찍기) ──
  const labelToggle = () => $('.viewer__bar .viewer__toggle')
  const labelIsOn = () => labelToggle()?.getAttribute('aria-pressed') === 'true'
  /** L 키로 라벨 모드를 켜고 끈다 — 패널 열이 생기거나 사라질 때까지 기다린다 */
  async function setLabel(on) {
    if (labelIsOn() !== on) key('KeyL')
    await waitFor(() => labelIsOn() === on && !!$('.label-side') === on, 5000, 50)
    await sleep(400)
  }
  /** 라벨 패널이 접혀 있으면 펼친다 */
  async function openLabelPanel() {
    const b = $('.label-side--collapsed button[aria-label="라벨 패널 펼치기"]')
    if (b) b.click()
    await waitFor(() => $('.label-side') && !$('.label-side--collapsed'), 3000, 50)
    await sleep(300)
  }
  /** 영상 캔버스 그림 (라벨 덮개 캔버스 .vplot__overlay 는 빼고). all = 뷰어 안 모든 영상 캔버스(그룹 둘·B-scan 포함)를 이은 글자 */
  const snapCanvases = () => {
    const shots = $$('.viewer canvas.vplot__canvas:not(.vplot__overlay)').map((c) => c.toDataURL('image/png'))
    return {
      sscan: $('.viewer__sscans canvas').toDataURL('image/png'),
      cscan: $('.viewer__cscans canvas').toDataURL('image/png'),
      ascan: $('.viewer__ascan canvas').toDataURL('image/png'),
      count: shots.length,
      all: shots.join('|')
    }
  }
  /**
   * 한 번 다시 그린 뒤의 영상 캔버스 (→ ← 로 같은 칸을 다시 그림). Electron 에서는 크기가 바뀌어 새로 만든 캔버스의 첫 그림이
   * 다음 그림과 반투명 점선(스킵선)의 안티에일리어싱이 달라(GPU·CPU 래스터 — 같은 상태 같은 코드) 바이트 비교 전에
   * 기준·비교 모두 같은 상태로 한 번 다시 그린다
   */
  async function snapAfterRedraw() {
    $('.viewer').focus({ preventScroll: true })
    key('ArrowRight')
    await sleep(250)
    key('ArrowLeft')
    await sleep(400)
    return snapCanvases()
  }
  /** 영상 위 라벨 덮개 캔버스 (라벨 모드에서만 생김) */
  const overlayOf = (sel) => $(`${sel} canvas.vplot__overlay`)
  /** 파랑(주 행동) 색으로 보이는 버튼 수 — 디자인 규칙: 한 화면에 하나 이하 */
  const blueButtons = () => {
    const probe = document.createElement('span')
    probe.style.background = 'var(--accent)'
    document.body.append(probe)
    const accent = getComputedStyle(probe).backgroundColor
    probe.remove()
    return $$('button').filter((b) => b.offsetParent !== null && getComputedStyle(b).backgroundColor === accent).map((b) => b.textContent.trim())
  }
  /** 축 글자 'a~b' 의 폭 */
  const axisSpan = (label) => {
    const m = /([−\-\d.]+)~([−\-\d.]+)/.exec(label)
    return m ? numOf(m[2]) - numOf(m[1]) : NaN
  }
  /** 자홍(라벨 덮개 — 라이트 #c0109f, 다크 #ff4df5)으로 보이는 픽셀인가 */
  const isMagenta = ([r, g, b]) => r > 120 && b > 90 && r - g > 60 && b - g > 40

  window.__pautSteps = [
    {
      name: 'open-x3',
      window: { width: 1440, height: 900 },
      async run() {
        const o = await openFile(X3)
        x3FileId = o.item.id
        x3FirstScan = o.firstScan
        const ro = readout()
        const panels = $$('.viewer__sscans .vpanel').length
        const focusIn = !!(document.activeElement && document.activeElement.closest('.viewer'))
        // 첫 커서 = 게이트 A C-scan 최대 칸 (결정 8, 12T-SV-01 은 202.0 mm) — 독립 계산값과 같아야 한다
        const firstOk = o.firstScanOk && !!o.firstScan && ro['스캔'] === o.firstScan.scanMm
        return {
          ok: o.state === 'ok' && ro['그룹'] === 'Skew90' && ro['각도'] === '54.0°' && panels === 2 && focusIn && firstOk,
          openMs: o.openMs, readout: ro, firstScan: o.firstScan, firstScanOk: o.firstScanOk, panels, focusIn, dpr: window.devicePixelRatio, inner: [innerWidth, innerHeight]
        }
      }
    },
    {
      name: 'cursor-39-omnipc',
      async run() {
        await setScan(39)
        await sleep(300)
        const ro = readout()
        // OmniPC 화면(스캔 38.93 → 39번째 칸, 54°): A% 1.6, 문턱(20 %) 미만이라 위치값은 ND
        const a = numOf(ro['A%'])
        return { ok: ro['스캔'] === '39.0 mm' && ro['각도'] === '54.0°' && Math.abs(a - 1.6) <= 0.1 && ro['깊이 DA^'] === 'ND' && ro['음로 SA^'] === 'ND', readout: ro }
      }
    },
    {
      name: 'click-cscan-120',
      async run() {
        const c = $$('.viewer__cscans canvas')[0]
        pointerAt(c, (120 + 0.5) / 301, 0.5)
        await sleep(300)
        const ro = readout()
        return { ok: ro['스캔'] === '120.0 mm' && ro['그룹'] === 'Skew90', readout: ro }
      }
    },
    {
      name: 'single-skew90-click-sscan-60deg',
      async run() {
        segClick('Skew90')
        await sleep(500)
        const panels = $$('.viewer__sscans .vpanel').length
        const opened = await api.viewer.open(x3FileId)
        const g = opened.data.info.groups.find((x) => x.name === 'Skew90')
        const vp = viewportSingle(g)
        const beam = g.beams[20] // 60°
        const p = samplePoint(beam, 400, g.ultrasound)
        const fx = (p.v - vp.vMin) / (vp.vMax - vp.vMin)
        const fy = (p.d - vp.dMin) / (vp.dMax - vp.dMin)
        const canvas = $('.viewer__sscans canvas')
        canvas.dispatchEvent(new MouseEvent('click', { clientX: canvas.getBoundingClientRect().left + fx * canvas.getBoundingClientRect().width, clientY: canvas.getBoundingClientRect().top + fy * canvas.getBoundingClientRect().height, bubbles: true }))
        await sleep(300)
        const ro = readout()
        return { ok: panels === 1 && ro['각도'] === '60.0°', panels, clicked: { fx, fy, v: p.v, d: p.d }, readout: ro }
      }
    },
    {
      name: 'canvases-scan39-54deg',
      async run() {
        await setScan(39)
        await setAngle(54)
        await sleep(400)
        const s = $('.viewer__sscans canvas')
        const c = $('.viewer__cscans canvas')
        const a = $('.viewer__ascan canvas')
        return {
          ok: !!s && !!c,
          mode: 'single Skew90',
          readout: readout(),
          sscan: canvasInfo(s),
          cscan: canvasInfo(c),
          ascan: canvasInfo(a),
          canvases: { sscan: s.toDataURL('image/png'), cscan: c.toDataURL('image/png'), ascan: a.toDataURL('image/png') }
        }
      }
    },
    {
      name: 'theme-dark',
      async run() {
        $('.topbar button[aria-label$="테마로 바꾸기"]').click()
        await sleep(600)
        return { ok: document.documentElement.dataset.theme === 'dark', theme: document.documentElement.dataset.theme }
      }
    },
    {
      name: 'layout-abcs-dark',
      async run() {
        segClick('A-B-C-S')
        await sleep(900)
        return { ok: $$('.viewer__bscan canvas').length === 1 && text().includes('B-scan'), readout: readout() }
      }
    },
    {
      name: 'min-window-abcs-dark',
      window: { width: 1280, height: 800 },
      async run() {
        await sleep(600)
        const m = metrics()
        return { ok: m.noHScroll && m.readoutH <= 32 && m.barH <= 48 && m.minBox >= 100, ...m }
      }
    },
    {
      name: 'min-window-abcs-light',
      async run() {
        $('.topbar button[aria-label$="테마로 바꾸기"]').click()
        await sleep(600)
        return { ok: document.documentElement.dataset.theme === 'light', ...metrics() }
      }
    },
    {
      name: 'min-window-acs-all-light',
      async run() {
        segClick('A-C-S')
        await sleep(300)
        segClick('모두')
        await sleep(900)
        const m = metrics()
        return { ok: $$('.viewer__sscans .vpanel').length === 2 && m.noHScroll && m.readoutH <= 32 && m.minBox >= 100, ...m }
      }
    },
    {
      name: 'ui-audit',
      async run() {
        const fonts = new Map(), colors = new Set(), bgs = new Set(), radii = new Set(), families = new Set(), small = []
        for (const el of $$('.viewer *')) {
          if (el.closest('svg') || el.tagName === 'CANVAS') continue
          const cs = getComputedStyle(el)
          const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
          if (hasText) {
            fonts.set(cs.fontSize, (fonts.get(cs.fontSize) || 0) + 1)
            colors.add(cs.color)
            families.add(cs.fontFamily.split(',')[0].trim())
            if (Number.parseFloat(cs.fontSize) < 12) small.push(el.className + ': ' + el.textContent.trim().slice(0, 30))
          }
          if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bgs.add(cs.backgroundColor)
          if (cs.borderRadius !== '0px') radii.add(cs.borderRadius)
        }
        for (const el of $$('.viewer svg text')) {
          const cs = getComputedStyle(el)
          fonts.set('svg ' + cs.fontSize, (fonts.get('svg ' + cs.fontSize) || 0) + 1)
          colors.add('svg ' + cs.fill)
        }
        return { ok: small.length === 0, fonts: Object.fromEntries(fonts), colors: [...colors], backgrounds: [...bgs], radii: [...radii], families: [...families], small }
      }
    },
    {
      name: 'scrub-perf',
      window: { width: 1440, height: 900 },
      async run() {
        await sleep(500)
        const long = []
        let obs = null
        try {
          obs = new PerformanceObserver((list) => list.getEntries().forEach((e) => long.push(Math.round(e.duration))))
          obs.observe({ entryTypes: ['longtask'] })
        } catch {}
        const start = scanMm()
        // 키마다 sleep 없이 잰다 (sleep 을 넣으면 합계가 앱이 아니라 sleep 을 재게 된다).
        //   sync  = keydown → React 동기 렌더·커밋·캔버스 useEffect(putImageData) 끝. discrete 이벤트의 동기 렌더는 마이크로태스크에서
        //           flush 되므로 한 번 양보한 뒤 읽는다
        //   frame = keydown → 다음 프레임 (그리기가 뒤로 미뤄져도 잡힌다)
        const syncs = []
        const frames = []
        let rafTimeouts = 0
        for (let i = 0; i < 40; i++) {
          const t = performance.now()
          key('ArrowRight')
          await Promise.resolve()
          syncs.push(performance.now() - t)
          if (!(await nextFrame())) rafTimeouts++
          frames.push(performance.now() - t)
        }
        if (obs) obs.disconnect()
        const end = scanMm()
        // 기준: 키→다음 프레임 95% 가 50 ms(60 Hz 세 프레임) 이하, 긴 작업(50 ms+) 0회 — 계획.md 2.5단계 '스캔을 넘길 때 끊김 없음'.
        // 계획.md 의 '한 장에 3 ms' 가 syncMedianMs 의 기대값. longMax 는 longtask 정의상 50 이상이라 기준에 넣지 않고 개수만 본다.
        // visibility 는 숨김 창 스로틀링 여부를 나중에(윈도우) 가려 보기 위한 기록
        return {
          ok: Math.abs(end - start - 40) < 1e-6 && p95(frames) <= 50 && long.length === 0,
          start,
          end,
          syncMedianMs: round1(median(syncs)),
          syncP95Ms: round1(p95(syncs)),
          frameMedianMs: round1(median(frames)),
          frameP95Ms: round1(p95(frames)),
          frameMs: frames.map(round1),
          longTasks: long.length,
          longMax: Math.max(0, ...long),
          rafTimeouts,
          visibility: document.visibilityState
        }
      }
    },
    {
      name: 'back-restore-reopen',
      async run() {
        clickText('.viewer button', '스캔플랜별 데이터로')
        await sleep(800)
        const row = $(`main tr[data-row="${x3FileId}"]`)
        const expanded = !!row && row.getAttribute('aria-expanded') === 'true'
        const btn = $$('main button').find((b) => b.textContent.includes('이미지로 보기'))
        const t0 = performance.now()
        if (btn) btn.click()
        const state = await waitFor(viewerState, 30000)
        const reopenMs = Math.round(performance.now() - t0)
        // 다시 열기는 캐시된 볼륨 경로(첫 커밋 뒤 effect)지만 첫 커서 규칙은 같다 → open-x3 와 같은 기대값
        const firstScan = state === 'ok' ? x3FirstScan ?? (await expectedFirstScan(x3FileId)) : null
        const firstScanOk = firstScan ? await waitScan(firstScan.scanMm) : false
        const ro = readout()
        return { ok: expanded && !!btn && state === 'ok' && reopenMs < 3000 && firstScanOk && ro['스캔'] === firstScan.scanMm, expanded, reopenMs, firstScan, firstScanOk, readout: ro }
      }
    },
    {
      name: 'open-4x-sect',
      async run() {
        const o = await openFile('Weld_Plate_PA-Sect_sk90-4.2.nde')
        const ro = readout()
        const t = text()
        // 첫 커서 = 게이트 A C-scan 최대 칸 (Sect GR-1: 50.0 mm). 축 범위(42~86) 검사는 어떤 값이든 통과하므로 쓰지 않는다
        const firstOk = o.firstScanOk && !!o.firstScan && ro['스캔'] === o.firstScan.scanMm
        // 4.x 섹토리얼 스큐 90 은 교차 대조로 검증(T3, 2026-10-26) → 대조 전 표시 없음 (스큐 270 이면 'NDE 4.x 섹토리얼 · 스큐 270')
        return { ok: o.state === 'ok' && !t.includes('NDE 4.x 섹토리얼') && firstOk, openMs: o.openMs, readout: ro, firstScan: o.firstScan, firstScanOk: o.firstScanOk }
      }
    },
    {
      name: 'open-cod-partial',
      async run() {
        const o = await openFile('Weld_COD_2PA-ToFD-4.2.nde')
        const t = text()
        // 파일 레이아웃 'MultiABC' → 여러 그룹을 보여 주는 A-C-S 로 열려야 한다 (S90·S270 두 패널)
        const acs = $$('.viewer .seg button').find((b) => b.textContent.trim() === 'A-C-S')
        return {
          ok: o.state === 'ok' && t.includes('볼 수 없는 그룹 1개') && t.includes('ToFD') && $$('.viewer__sscans .vpanel').length === 2 && acs?.getAttribute('aria-checked') === 'true',
          openMs: o.openMs, panels: $$('.viewer__sscans .vpanel').length, readout: readout(), firstScan: o.firstScan, firstScanOk: o.firstScanOk
        }
      }
    },
    {
      name: 'open-tfm-unsupported',
      async run() {
        const o = await openFile('Weld_Plate_4TFM_sk90-4.2.nde')
        const t = text()
        return { ok: o.state === 'empty' && t.includes('아직 이미지로 볼 수 없습니다') && t.includes('TFM 그룹은 아직'), state: o.state }
      }
    },
    {
      name: 'open-manualpa33-nodata',
      async run() {
        const o = await openFile('ManualWeldPA.nde')
        await setScan(280)
        await sleep(300)
        const ro = readout()
        // 데이터 없음 경계를 상태 비트로 독립 계산: 모든 빔이 hasData(비트 1)=0 인 첫 스캔 칸 k0 (ManualWeldPA GR-1: 259, 부분 스캔 없음)
        const opened = await api.viewer.open(o.item.id)
        if (!opened.ok) throw new Error('viewer.open ' + opened.code)
        const g = opened.data.info.groups.find((x) => x.supported)
        const [ns, nb] = g.shape
        let k0 = -1
        let hasStatus = false
        await eachChunk(o.item.id, opened.data.key, g, (ch) => {
          if (!ch.status) return
          hasStatus = true
          for (let s = 0; s < ch.scanCount && k0 < 0; s++) {
            let any = false
            for (let b = 0; b < nb; b++) {
              if (ch.status[s * nb + b] & 1) {
                any = true
                break
              }
            }
            if (!any) k0 = ch.scanStart + s
          }
        })
        // 기대 회색 = 파일의 특수색 [2] (OmniPC 데이터 없음, 보통 808080) — 숫자 128 을 박아 두지 않는다
        const hex = opened.data.info.display.specialColors[2] ?? '808080'
        const gray = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
        const isGray = (p) => !!p && p.every((v, i) => v === gray[i])
        const c = $('.viewer__cscans canvas')
        const b = $('.viewer__bscan canvas')
        // 칸 k 의 가운데 (x = (k+0.5)/ns). 커서 선은 280 에 있어 표본 칸(k0±3, 100, 290)과 겹치지 않는다
        const cAt = (k) => pixelAt(c, (k + 0.5) / ns, 0.5)
        const bAt = (k) => (b ? pixelAt(b, (k + 0.5) / ns, 0.5) : null)
        // 경계 양쪽 1 mm 씩 기록: [칸, C-scan rgb, B-scan rgb]
        const edge = []
        if (k0 >= 0) for (let k = k0 - 3; k <= k0 + 3; k++) edge.push([k, cAt(k).join(','), bAt(k)?.join(',') ?? null])
        // k0−1 은 색, k0 부터 회색 — C-scan 과 B-scan 모두 (한 칸 어긋나면 실패)
        const boundary = k0 > 0 && !isGray(cAt(k0 - 1)) && isGray(cAt(k0)) && !isGray(bAt(k0 - 1)) && isGray(bAt(k0))
        return {
          ok: o.state === 'ok' && k0 === 259 && boundary && !isGray(cAt(100)) && isGray(cAt(290)) && ro['A%'] === '—',
          k0, hasStatus, gray, boundary, edge, readout: ro, firstScan: o.firstScan, firstScanOk: o.firstScanOk, cscan: canvasInfo(c), bscan: b ? canvasInfo(b) : null
        }
      }
    },
    {
      name: 'open-x3-capoff',
      async run() {
        const o = await openFile('12T-SV-03-Cap off.nde')
        const ro = readout()
        // 첫 커서 = 게이트 A C-scan 최대 칸 (12T-SV-03: 62.0 mm)
        const firstOk = o.firstScanOk && !!o.firstScan && ro['스캔'] === o.firstScan.scanMm
        return { ok: o.state === 'ok' && $$('.viewer__sscans .vpanel').length === 2 && ro['그룹'] === 'Skew90' && firstOk, openMs: o.openMs, readout: ro, firstScan: o.firstScan, firstScanOk: o.firstScanOk }
      }
    }
    ,
    // ── 후처리(계획_후처리.md 1·2a·2b·3단계) — 기존 18단계 뒤에 붙이며, 각 단계는 '파일값으로'(있으면) + 커서 39 mm·54° 에서 시작 ──
    {
      name: 'post-open-x3',
      window: { width: 1440, height: 900 },
      async run() {
        const o = await openFile(X3)
        await postReset()
        await setScan(39)
        await setAngle(54)
        await sleep(300)
        const ro = readout()
        return { ok: o.state === 'ok' && ro['스캔'] === '39.0 mm' && ro['각도'] === '54.0°' && !$('.viewer__tools'), readout: ro }
      }
    },
    {
      // S-scan 범위 잘라 보기는 뺐으므로(사용자 지시 2026-10-06) A-scan 깊이 창으로 확인한다. S-scan 축은 그대로여야 한다
      name: 'zoom-ascan-depth-30',
      async run() {
        await postReset()
        await setAngle(54)
        await openTools()
        await toolsTab('범위')
        await toolsSub('A-scan')
        await sleep(200)
        const before = axisLabel('A-scan 깊이')
        const sBefore = axisLabel('깊이')
        await setField('깊이 끝 (mm)', 30)
        await sleep(400)
        const after = axisLabel('A-scan 깊이')
        const sAfter = axisLabel('깊이')
        const adjusted = text().includes('조정됨')
        await postReset()
        return { ok: /30/.test(after) && !/30/.test(before) && sAfter === sBefore && adjusted, before, after, sBefore, sAfter }
      }
    },
    {
      name: 'zoom-cscan-100-200',
      async run() {
        await postReset()
        await openTools()
        await toolsTab('범위')
        await toolsSub('C-scan')
        await sleep(200)
        await setField('스캔 끝 (mm)', 200)
        await setField('스캔 시작', 100)
        await sleep(400)
        const label = axisLabel('스캔 위치')
        // 축 라벨은 칸 가운데 기준 ±반 칸: 99.5~200.5 mm (창 [100, 201)). 클릭 x=(k−from+0.5)/(to−from), k=150 → 150.0 mm
        const lm = /([−\-\d.]+)~([−\-\d.]+)/.exec(label)
        const axisOk = !!lm && Math.abs(numOf(lm[1]) - 99.5) < 0.01 && Math.abs(numOf(lm[2]) - 200.5) < 0.01
        const c = $$('.viewer__cscans canvas')[0]
        pointerAt(c, (150 - 100 + 0.5) / 101, 0.5)
        await sleep(300)
        const ro = readout()
        await postReset()
        return { ok: ro['스캔'] === '150.0 mm' && axisOk, label, readout: ro }
      }
    },
    {
      name: 'wheel-zoom-cscan',
      async run() {
        await postReset()
        await setScan(39)
        const c = $$('.viewer__cscans canvas')[0]
        const r = c.getBoundingClientRect()
        const before = axisLabel('스캔 위치')
        const sBefore = axisLabel('깊이')
        // 휠 한 노치(100 px) = 1틱 = ×1.25, 포인터 중심. S-scan 범위는 그대로
        c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true, cancelable: true }))
        await sleep(400)
        const after = axisLabel('스캔 위치')
        const sAfter = axisLabel('깊이')
        const span = (l) => {
          const m = /([−\-\d.]+)~([−\-\d.]+)/.exec(l)
          return m ? numOf(m[2]) - numOf(m[1]) : NaN
        }
        const ratio = span(before) / span(after)
        await postReset()
        return { ok: Math.abs(ratio - 1.25) < 0.03 && sAfter === sBefore, before, after, ratio, sBefore, sAfter }
      }
    },
    {
      name: 'cursor-outside-window-follows',
      async run() {
        await postReset()
        await openTools()
        await toolsTab('범위')
        await toolsSub('C-scan')
        await setField('스캔 끝 (mm)', 200)
        await setField('스캔 시작', 100)
        await sleep(300)
        await setScan(200)
        const labelAt200 = axisLabel('스캔 위치')
        key('ArrowRight', { shiftKey: true })
        await sleep(300)
        const ro = readout()
        const labelAt210 = axisLabel('스캔 위치')
        await postReset()
        // 커서가 210 으로 나가면 창이 같은 폭(100 mm)으로 밀려 110~210
        return { ok: ro['스캔'] === '210.0 mm' && /210/.test(labelAt210) && !/210/.test(labelAt200) && !text().includes('커서가 스캔 범위 밖'), labelAt200, labelAt210, readout: ro }
      }
    },
    {
      name: 'cscan-axes-toggle',
      async run() {
        await postReset()
        await setAngle(54)
        await openTools()
        await toolsTab('범위')
        await toolsSub('C-scan')
        await sleep(200)
        const box = $$('.viewer__tools input[type=checkbox]')[0]
        const was = box.checked
        box.click()
        await sleep(300)
        // 토글 뒤 ↑ 는 화면 위쪽 빔: 뒤집힘(첫 빔이 아래)이면 큰 각도, 아니면 작은 각도
        key('ArrowUp')
        await sleep(200)
        const angle = numOf(readout()['각도'])
        const expectUp = !was ? 55 : 53
        await postReset()
        return { ok: angle === expectUp, was, angle }
      }
    },
    {
      name: 'gate-threshold-1',
      async run() {
        await postReset()
        await setScan(39)
        await setAngle(54)
        await openTools()
        await toolsTab('게이트')
        await sleep(200)
        const c = $$('.viewer__cscans canvas')[0]
        const before = c.toDataURL('image/png')
        await setField('문턱 (%)', 1)
        await sleep(300)
        const ro1 = readout()
        const afterThr = c.toDataURL('image/png')
        // 1 % 문턱: A% 1.6 그대로, DA^·SA^ 가 ND 에서 숫자로. C-scan 은 문턱과 무관(재계산 없음)
        const ok1 = Math.abs(numOf(ro1['A%']) - 1.6) <= 0.1 && ro1['깊이 DA^'] !== 'ND' && ro1['음로 SA^'] !== 'ND' && afterThr === before
        // 40 % 문턱 + 첫 커서(C-scan 최대 칸): 그 칸 A% 가 40 미만이면 ND
        await setField('문턱 (%)', 40)
        await setScan(numOf(x3FirstScan.scanMm))
        await sleep(300)
        const ro2 = readout()
        const a2 = numOf(ro2['A%'])
        const ok2 = a2 >= 40 ? ro2['깊이 DA^'] !== 'ND' : ro2['깊이 DA^'] === 'ND'
        await postReset()
        return { ok: ok1 && ok2, readout1: ro1, readout2: ro2 }
      }
    },
    {
      name: 'gate-start-10-width-10',
      async run() {
        await postReset()
        await setScan(39)
        await setAngle(54)
        await openTools()
        await toolsTab('게이트')
        await setField('폭 (mm)', 10)
        await setField('시작 (mm)', 10)
        await sleep(500)
        const ro = readout()
        // 독립 재계산: 깊이 10~20 mm 창을 빔별 시간으로 환산해 (스캔 39, 54°) 의 게이트 최대를 구한다
        const opened = await api.viewer.open(x3FileId)
        const g = opened.data.info.groups.find((x) => x.name === 'Skew90')
        const [, nb, nt] = g.shape
        const b = g.beams.findIndex((x) => Math.abs(x.angleDeg - 54) < 1e-6)
        const beam = g.beams[b]
        const cos = Math.cos(beam.angleDeg * DEG)
        const tOf = (d) => (2 * (d / cos)) / (beam.velocityMps * 1e-3)
        const res = g.ultrasound.resolutionUs
        const i0 = Math.max(0, Math.round((tOf(10) - beam.t0Us) / res))
        const i1 = Math.min(nt, Math.round((tOf(20) - beam.t0Us) / res) + 1)
        let best = -32768
        await eachChunk(x3FileId, opened.data.key, g, (ch) => {
          const s = 39 - ch.scanStart
          if (s < 0 || s >= ch.scanCount) return
          const base = (s * nb + b) * nt
          for (let i = i0; i < i1; i++) if (ch.amplitude[base + i] > best) best = ch.amplitude[base + i]
        })
        const expectPct = (best / 32767) * 200
        const tip = $('.vaxis__marker[data-kind=gate-end] title')?.textContent ?? ''
        await postReset()
        return { ok: Math.abs(numOf(ro['A%']) - expectPct) <= 0.05 && /20\.0 mm/.test(tip), readout: ro, expectPct, window: [i0, i1], tip }
      }
    },
    {
      name: 'ruler-drag-zoom',
      async run() {
        await postReset()
        const before = axisLabel('스캔 위치')
        // 스캔 눈금자(C-scan 마지막 패널 아래)를 끌어 그 구간으로 확대, 더블클릭으로 초기화
        const svg = $$('.viewer__cscans svg.vaxis--bottom').at(-1)
        const r = svg.getBoundingClientRect()
        const drag = (x0, x1) => {
          const ev = (type, x) => new PointerEvent(type, { clientX: r.left + x, clientY: r.top + 10, bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
          svg.dispatchEvent(ev('pointerdown', x0))
          svg.dispatchEvent(ev('pointermove', (x0 + x1) / 2))
          svg.dispatchEvent(ev('pointermove', x1))
          svg.dispatchEvent(ev('pointerup', x1))
        }
        drag(r.width * 0.2, r.width * 0.6)
        await sleep(400)
        const after = axisLabel('스캔 위치')
        svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + 10 }))
        await sleep(400)
        const reset = axisLabel('스캔 위치')
        return { ok: after !== before && reset === before, before, after, reset }
      }
    },
    {
      name: 'diamond-drag-gate',
      async run() {
        await postReset()
        await setAngle(54)
        await openTools()
        await toolsTab('게이트')
        await sleep(200)
        const svg = $$('.viewer__sscans svg.vaxis--left')[0]
        const marker = svg.querySelector('.vaxis__marker[data-kind=gate-end]')
        const mr = marker.getBoundingClientRect()
        const r = svg.getBoundingClientRect()
        const y0 = (mr.top + mr.bottom) / 2 - r.top
        const y1 = y0 - r.height * 0.1
        const ev = (type, y) => new PointerEvent(type, { clientX: r.left + 10, clientY: r.top + y, bubbles: true, cancelable: true, pointerId: 8, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
        svg.dispatchEvent(ev('pointerdown', y0))
        svg.dispatchEvent(ev('pointermove', y1))
        svg.dispatchEvent(ev('pointerup', y1))
        await sleep(400)
        // 끌기 결과 = 숫자 입력과 같은 값: 패널의 '폭' 칸이 줄었고 측정값 줄 '조정됨'
        const width = numOf($('.viewer__tools input[aria-label="폭 (mm)"]').value)
        const widthOk = width < 21 && width > 10
        await setField('폭 (mm)', Math.round(width * 10) / 10)
        await sleep(200)
        const tip = $('.vaxis__marker[data-kind=gate-end] title')?.textContent ?? ''
        await postReset()
        return { ok: widthOk && new RegExp((Math.round((7 + width) * 10) / 10).toFixed(1)).test(tip), width, tip }
      }
    },
    {
      name: 'diamond-esc-cancel-click-undo',
      async run() {
        await postReset()
        await setScan(39)
        await setAngle(54)
        await openTools()
        await toolsTab('게이트')
        await sleep(200)
        const widthBefore = $('.viewer__tools input[aria-label="폭 (mm)"]').value
        const svg = $$('.viewer__sscans svg.vaxis--left')[0]
        const marker = svg.querySelector('.vaxis__marker[data-kind=gate-end]')
        const mr = marker.getBoundingClientRect()
        const r = svg.getBoundingClientRect()
        const y0 = (mr.top + mr.bottom) / 2 - r.top
        const ev = (type, y) => new PointerEvent(type, { clientX: r.left + 10, clientY: r.top + y, bubbles: true, cancelable: true, pointerId: 9, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
        // ① 끌다가 Esc: 선은 제자리로, 조정 없음
        svg.dispatchEvent(ev('pointerdown', y0))
        svg.dispatchEvent(ev('pointermove', y0 - r.height * 0.1))
        await sleep(100)
        const movedWidth = $('.viewer__tools input[aria-label="폭 (mm)"]').value
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
        svg.dispatchEvent(ev('pointerup', y0 - r.height * 0.1))
        await sleep(300)
        const escOk = $('.viewer__tools input[aria-label="폭 (mm)"]').value === widthBefore && !text().includes('조정됨')
        // ② 움직이지 않은 클릭: 조정 없음
        svg.dispatchEvent(ev('pointerdown', y0))
        svg.dispatchEvent(ev('pointerup', y0))
        await sleep(300)
        const clickOk = $('.viewer__tools input[aria-label="폭 (mm)"]').value === widthBefore && !text().includes('조정됨')
        // ③ A-scan 진폭 축(아래 가로 눈금자)의 문턱 다이아몬드 끌기 = 되돌리기 한 단계 (움직임 5번에 적용은 손을 뗄 때 한 번)
        const thrBefore = $('.viewer__tools input[aria-label="문턱 (%)"]').value
        const asvg = $('.viewer__ascan svg.vaxis--bottom')
        const tm = asvg.querySelector('.vaxis__marker[data-kind=threshold]')
        const tr = tm.getBoundingClientRect()
        const ar = asvg.getBoundingClientRect()
        const tx0 = (tr.left + tr.right) / 2 - ar.left
        const tev = (type, x) => new PointerEvent(type, { clientX: ar.left + x, clientY: ar.top + 10, bubbles: true, cancelable: true, pointerId: 10, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
        asvg.dispatchEvent(tev('pointerdown', tx0))
        for (let i = 1; i <= 5; i++) asvg.dispatchEvent(tev('pointermove', tx0 + ar.width * 0.04 * i))
        asvg.dispatchEvent(tev('pointerup', tx0 + ar.width * 0.2))
        await sleep(300)
        const thrAfter = $('.viewer__tools input[aria-label="문턱 (%)"]').value
        const dragged = thrAfter !== thrBefore && text().includes('조정됨')
        key('KeyZ', { ctrlKey: true })
        await sleep(300)
        const undone = $('.viewer__tools input[aria-label="문턱 (%)"]').value === thrBefore && !text().includes('조정됨')
        await postReset()
        return { ok: escOk && clickOk && dragged && undone, widthBefore, movedWidth, escOk, clickOk, thrBefore, thrAfter, dragged, undone }
      }
    },
    {
      name: 'gain-plus-6',
      async run() {
        await postReset()
        await setScan(39)
        await setAngle(54)
        const a0 = numOf(readout()['A%'])
        for (let i = 0; i < 6; i++) key('Equal')
        await sleep(400)
        const ro = readout()
        await openTools()
        await toolsTab('이득')
        await sleep(200)
        const gain = numOf($('.viewer__tools input[aria-label="이득 (dB)"]').value)
        // A% 는 소수 1자리로 반올림된 값이라 ×2 뒤 오차 ≤ 0.15
        const ok = Math.abs(numOf(ro['A%']) - a0 * 10 ** (6 / 20)) <= 0.2 && Math.abs(gain - 12.0) < 0.05 && text().includes('OmniPC 대조 전 (이득)')
        await postReset()
        return { ok, a0, readout: ro, gain }
      }
    },
    {
      name: 'auto-80',
      async run() {
        await postReset()
        await setScan(numOf(x3FirstScan.scanMm))
        await setAngle(54)
        key('KeyA')
        await sleep(400)
        const ro = readout()
        await openTools()
        await toolsTab('이득')
        await sleep(200)
        const gain = numOf($('.viewer__tools input[aria-label="이득 (dB)"]').value)
        // 이득은 0.1 dB 단계로 반올림되므로 80 % 에서 최대 ±0.46 (10^(0.05/20)) 벗어날 수 있다
        const ok = Math.abs(numOf(ro['A%']) - 80) <= 0.55 && Math.abs(gain * 10 - Math.round(gain * 10)) < 1e-6
        await postReset()
        return { ok, readout: ro, gain, firstScan: x3FirstScan }
      }
    },
    {
      name: 'reset-all-restores-defaults',
      async run() {
        // 기준: 파일값 상태의 Skew90 단독 39·54° 그림 → 조정 몇 개 → '파일값으로' → 같은 그림이어야 한다 (단계 안에서 바이트 비교)
        await postReset()
        segClick('Skew90')
        await sleep(500)
        await setScan(39)
        await setAngle(54)
        await sleep(400)
        const snap = () => ({ sscan: $('.viewer__sscans canvas').toDataURL('image/png'), cscan: $('.viewer__cscans canvas').toDataURL('image/png'), ascan: $('.viewer__ascan canvas').toDataURL('image/png') })
        const base = snap()
        segClick('모두')
        await sleep(300)
        await openTools()
        await toolsTab('범위')
        await toolsSub('A-scan')
        await setField('깊이 끝 (mm)', 30)
        for (let i = 0; i < 3; i++) key('Equal')
        await sleep(300)
        await postReset()
        segClick('Skew90')
        await sleep(500)
        await setScan(39)
        await setAngle(54)
        await sleep(400)
        const after = snap()
        segClick('모두')
        await sleep(300)
        const same = { sscan: after.sscan === base.sscan, cscan: after.cscan === base.cscan, ascan: after.ascan === base.ascan }
        return { ok: !text().includes('조정됨') && same.sscan && same.cscan && same.ascan, same, canvases: after }
      }
    },
    {
      name: 'min-window-tools-open',
      window: { width: 1280, height: 800 },
      async run() {
        await sleep(500)
        segClick('A-C-S')
        await sleep(200)
        segClick('모두')
        await sleep(500)
        await openTools()
        await sleep(500)
        const m = metrics()
        await closeTools()
        const closed = metrics()
        return { ok: m.noHScroll && m.readoutH <= 32 && m.barH <= 48 && m.minBox >= 80 && closed.minBox >= 100, open: m, closed }
      }
    }
    ,
    // ── 컴파운드·리니어(OmniScan X4 NDE 4.2, testdata/X4_TF) — OmniPC 캡처 OmniPC_TF_01_C_L_0001_*·OmniPC_TF_01_L_0001_* 의 화면값과 비교 ──
    {
      name: 'open-tf-compound',
      window: { width: 1440, height: 900 },
      async run() {
        const o = await openFile(TF_COMPOUND)
        const firstOk = o.firstScanOk && !!o.firstScan && readout()['스캔'] === o.firstScan.scanMm
        const opened = await api.viewer.open(o.item.id)
        if (!opened.ok) throw new Error('viewer.open ' + opened.code)
        const info = opened.data.info
        const g = info.groups[0]
        const [ns, nb] = g.shape
        // OmniPC 캡처의 커서: 스캔 0 mm · 빔 0 (50°)
        clickCscanCell($$('.viewer__cscans canvas')[0], ns, nb, 0, 0, info.display.cscanReversed)
        await sleep(400)
        const ro = readout()
        const t = text()
        const exp = await expectedGatePct(o.item.id, g.name, 0, 0)
        const a = numOf(ro['A%'])
        const head = $('.viewer__sscans .vpanel__head')?.textContent ?? ''
        // C-scan 세로축 = 굴절각, 캡처 눈금 회귀로 읽은 양 끝 49.51°(아래, 첫 빔) · 68.48°(위) — 축 허용 ±0.1°
        const ends = cscanAxisEnds('굴절각')
        const axisOk = Math.abs(ends.bottom - 49.51) <= 0.1 && Math.abs(ends.top - 68.48) <= 0.1
        const groupOk = g.technique === 'pa-compound' && g.supported && g.verified && info.groups.every((x) => x.supported)
        // 화면: Angle 50.0°, A% 2.6, DA^·SA^ ND (문턱 25 % 미만) — 우리 A% 는 따로 계산한 게이트 최대와 ±0.05
        const readOk = ro['스캔'] === '0.0 mm' && ro['각도'] === '50.0°' && Math.abs(a - exp.pct) <= 0.05 && Math.abs(a - 2.6) <= 0.1 && ro['깊이 DA^'] === 'ND' && ro['음로 SA^'] === 'ND'
        return {
          ok: o.state === 'ok' && groupOk && firstOk && readOk && axisOk && /50\.0°/.test(head) && !t.includes('볼 수 없는 그룹') && !t.includes('OmniPC 대조 전'),
          openMs: o.openMs, readout: ro, expected: exp, axis: axisLabel('굴절각'), ends, head, firstScan: o.firstScan, firstScanOk: o.firstScanOk, technique: g.technique, verified: g.verified
        }
      }
    },
    {
      name: 'open-tf-linear',
      async run() {
        const o = await openFile(TF_LINEAR)
        tfLinearFileId = o.item.id
        const firstOk = o.firstScanOk && !!o.firstScan && readout()['스캔'] === o.firstScan.scanMm
        const opened = await api.viewer.open(o.item.id)
        if (!opened.ok) throw new Error('viewer.open ' + opened.code)
        const info = opened.data.info
        const sect = info.groups.find((x) => x.technique === 'pa-sectorial')
        const lin = info.groups.find((x) => x.technique === 'pa-linear')
        // 섹토리얼 GR-1(스큐 90)은 2026-10-26 교차 대조로 검증(T3) — 두 그룹 모두 verified
        const groupsOk = info.groups.length === 2 && !!sect && !!lin && sect.supported && lin.supported && lin.verified && sect.verified
        // 파일 화면 상태: Single · 현재 그룹 GR-2(리니어) → S-scan 하나, 대조 전 표시 없음
        const single = $$('.viewer__sscans .vpanel').length === 1 && readout()['그룹'] === lin.name && !text().includes('OmniPC 대조 전')
        const [ns, nb] = lin.shape
        clickCscanCell($$('.viewer__cscans canvas')[0], ns, nb, 0, 0, info.display.cscanReversed)
        await sleep(400)
        const ro = readout()
        const exp = await expectedGatePct(o.item.id, lin.name, 0, 0)
        const a = numOf(ro['A%'])
        const head = $('.viewer__sscans .vpanel__head')?.textContent ?? ''
        // 리니어는 굴절각이 모두 60° → 측정값 줄은 '각도' 대신 '빔' (1부터 번호 · 각도), 패널 제목 '빔 1 · 60°'
        const beamOk = ro['빔'] === '1 · 60.0°' && !('각도' in ro) && head.includes('빔 1 · 60°')
        // C-scan 세로축 = 빔 번호, 캡처 눈금 회귀로 읽은 양 끝 1.02(아래) · 44.96(위) → 축 [1, 45]
        const ends = cscanAxisEnds('빔 번호')
        const axisOk = Math.abs(ends.bottom - 1.02) <= 0.1 && Math.abs(ends.top - 44.96) <= 0.1
        // 화면: A% 3.3, DA^ ND (문턱 25 %)
        const readOk = ro['스캔'] === '0.0 mm' && Math.abs(a - exp.pct) <= 0.05 && Math.abs(a - 3.3) <= 0.1 && ro['깊이 DA^'] === 'ND'
        // 모두 보기: 섹토리얼 GR-1 도 그려지고, 4.x 섹토리얼 스큐 90 은 교차 대조로 검증(T3, 2026-10-26)이라 대조 전 표시가 없다
        segClick('모두')
        await sleep(300)
        const allState = await waitFor(viewerState, 30000)
        await sleep(300)
        const panels = $$('.viewer__sscans .vpanel').length
        const t = text()
        const badgeOk = !t.includes('NDE 4.x 섹토리얼') && !t.includes('볼 수 없는 그룹')
        segClick(lin.name)
        await sleep(500)
        return {
          ok: o.state === 'ok' && groupsOk && single && firstOk && beamOk && axisOk && readOk && allState === 'ok' && panels === 2 && badgeOk,
          openMs: o.openMs, readout: ro, expected: exp, axis: axisLabel('빔 번호'), ends, head, panels, badgeOk, firstScan: o.firstScan, firstScanOk: o.firstScanOk
        }
      }
    },
    {
      // S-scan 영상 위 게이트 A 점선 끌기 (TF_01_L GR-2 리니어 단독, 스캔 0 · 빔 0). 좌표는 앱과 같은 식으로 따로 계산한 화면 창(viewportSingle)에서
      name: 'sscan-gate-drag-linear',
      async run() {
        await postReset()
        const opened = await api.viewer.open(tfLinearFileId)
        if (!opened.ok) throw new Error('viewer.open ' + opened.code)
        const info = opened.data.info
        const g = info.groups.find((x) => x.technique === 'pa-linear')
        const gate = g.gates.find((x) => x.id === g.cscanGateId)
        const [ns, nb] = g.shape
        const cs = $$('.viewer__cscans canvas')[0]
        clickCscanCell(cs, ns, nb, 0, 0, info.display.cscanReversed)
        await openTools()
        await toolsTab('게이트')
        await sleep(400)
        const ro0 = readout()
        const startBefore = toolsValue('시작 (mm)')
        const widthBefore = toolsValue('폭 (mm)')
        const cBase = cs.toDataURL('image/png')
        // TrueDepth 게이트 시작선 = 현재 빔(0) 깊이의 수평선: 음로(시작 시각) × cosθ (GR-2: 11.0 mm)
        const th = g.beams[0].angleDeg * DEG
        const d0 = ((g.beams[0].velocityMps * 1e-3 * gate.startUs[0]) / 2) * Math.cos(th)
        const D1 = 15
        const vp = viewportSingle(g)
        const canvas = $('.viewer__sscans canvas')
        const r = canvas.getBoundingClientRect()
        const xOf = (v) => r.left + ((v - vp.vMin) / (vp.vMax - vp.vMin)) * r.width
        const yOf = (d) => r.top + ((d - vp.dMin) / (vp.dMax - vp.dMin)) * r.height
        // 리니어 평행 빔: 빔 b 선 위 깊이 d 의 V = V_b + d·tanθ (skew 90). 빔 20 선 위 15 mm 를 x 로 쓴다 (영상 안, 시작선 위아래 모두 부채꼴 안)
        const B = 20
        const xB = xOf(g.beams[B].vOffsetMm + D1 * Math.tan(g.beams[B].angleDeg * DEG))
        const ev = (type, x, y, id) =>
          canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' || (type === 'pointermove' && id > 0) ? 1 : 0 }))
        const click = (x, y) => canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }))
        const fieldsSame = () => toolsValue('시작 (mm)') === startBefore && toolsValue('폭 (mm)') === widthBefore
        // ① 올려 두기: 선 ±6 px 안이면 커서·툴팁 (버튼 없이 움직임 = pointerId 0)
        ev('pointermove', xB, yOf(d0), 0)
        await sleep(150)
        const hoverTip = canvas.title
        const hoverCursor = canvas.style.cursor
        const hoverOk = /게이트 A 시작/.test(hoverTip) && new RegExp(d0.toFixed(1) + ' mm').test(hoverTip) && hoverCursor === 'row-resize'
        // ② 끌기 11 → 15 mm: 6 px 미만 움직임은 초안 없음, 끄는 동안은 선·A-scan 다이아몬드(초안)만, 손을 떼면 한 번 적용(C-scan 재계산)
        ev('pointerdown', xB, yOf(d0), 21)
        ev('pointermove', xB, yOf(d0) + 3, 21)
        await sleep(100)
        const tipOf = (sel) => $(`${sel} .vaxis__marker[data-kind=gate-start] title`)?.textContent ?? ''
        const smallMoveNoDraft = new RegExp(`${d0.toFixed(1)} mm`).test(tipOf('.viewer__ascan'))
        ev('pointermove', xB, (yOf(d0) + yOf(D1)) / 2, 21)
        ev('pointermove', xB, yOf(D1), 21)
        await sleep(150)
        const draftTip = tipOf('.viewer__ascan')
        const draftOk = /15\.0 mm/.test(draftTip) && fieldsSame() && !text().includes('조정됨') && cs.toDataURL('image/png') === cBase
        ev('pointerup', xB, yOf(D1), 21)
        click(xB, yOf(D1)) // 끌기 뒤 click 은 빔 고르기가 아니다
        await sleep(600)
        const ro1 = readout()
        const exp1 = await expectedGatePct(tfLinearFileId, g.name, 0, 0, D1)
        const cAfter = cs.toDataURL('image/png')
        const dragOk =
          toolsValue('시작 (mm)') === '15.0' && toolsValue('폭 (mm)') === widthBefore && text().includes('조정됨') && cAfter !== cBase &&
          ro1['빔'] === ro0['빔'] && Math.abs(numOf(ro1['A%']) - exp1.pct) <= 0.05 && /15\.0 mm/.test(tipOf('.viewer__sscans'))
        // ③ 끌다가 Esc: 값·C-scan·빔 그대로 (뒤따르는 click 도 무시)
        ev('pointerdown', xB, yOf(D1), 22)
        ev('pointermove', xB, yOf(D1) + 40, 22)
        await sleep(150)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
        ev('pointerup', xB, yOf(D1) + 40, 22)
        click(xB, yOf(D1) + 40)
        await sleep(400)
        const ro2 = readout()
        const escOk = toolsValue('시작 (mm)') === '15.0' && cs.toDataURL('image/png') === cAfter && ro2['빔'] === ro0['빔'] && /15\.0 mm/.test(tipOf('.viewer__ascan'))
        // ④ 선을 누르고 6 px 미만(빔 방향으로 3 px) 움직인 클릭 = 빔 고르기 (빔 20 → 번호 21), 게이트는 그대로
        const sx = r.width / (vp.vMax - vp.vMin)
        const sy = r.height / (vp.dMax - vp.dMin)
        const ux = Math.sin(g.beams[B].angleDeg * DEG) * sx
        const uy = Math.cos(g.beams[B].angleDeg * DEG) * sy
        const k3 = 3 / Math.hypot(ux, uy)
        const [cx, cy] = [xB + ux * k3, yOf(D1) + uy * k3]
        ev('pointerdown', xB, yOf(D1), 23)
        ev('pointermove', cx, cy, 23)
        ev('pointerup', cx, cy, 23)
        click(cx, cy)
        await sleep(400)
        const ro3 = readout()
        const picked = numOf(ro3['빔'])
        const pickOk = Math.abs(picked - (B + 1)) <= 1 && toolsValue('시작 (mm)') === '15.0' && toolsValue('폭 (mm)') === widthBefore
        // ⑤ 빔 0 으로 돌아가 Ctrl+Z: 끌기 한 번 = 되돌리기 한 단계 → 파일값, C-scan 은 처음 그림과 바이트 단위로 같다
        clickCscanCell(cs, ns, nb, 0, 0, info.display.cscanReversed)
        await sleep(300)
        $('.viewer').focus({ preventScroll: true })
        key('KeyZ', { ctrlKey: true })
        await sleep(600)
        const ro4 = readout()
        const undoOk = fieldsSame() && !text().includes('조정됨') && cs.toDataURL('image/png') === cBase && ro4['A%'] === ro0['A%']
        await postReset()
        return {
          ok: hoverOk && smallMoveNoDraft && draftOk && dragOk && escOk && pickOk && undoOk,
          hoverOk, smallMoveNoDraft, draftOk, dragOk, escOk, pickOk, undoOk,
          hoverTip, hoverCursor, draftTip, startBefore, widthBefore, d0, expected: exp1, picked, readout0: ro0, readout1: ro1, readout3: ro3, readout4: ro4
        }
      }
    }
    ,
    // ── 라벨 모드(계획_라벨링 1b) — 보통 모드는 지금과 바이트 단위로 같은 그림, 라벨 모드에서만 덮개·S-scan 확대·점 찍기 ──
    {
      // L 로 켜고 끄기: 켜면 '라벨' 눌림·오른쪽 패널·도구 묶음·키 안내, 끄면 패널이 사라지고 그림이 켜기 전과 바이트 단위로 같다
      name: 'label-mode-toggle-same-canvas',
      window: { width: 1440, height: 900 },
      async run() {
        const o = await openFile(X3)
        x3FileId = o.item.id
        await postReset()
        await setLabel(false)
        segClick('Skew90')
        await sleep(500)
        await setScan(39)
        await setAngle(54)
        await sleep(400)
        const base = await snapAfterRedraw()
        const hintOff = $('.viewer__keys')?.textContent ?? ''
        await setLabel(true)
        await openLabelPanel()
        const sideOk = !!$('.label-side [aria-label="라벨 도구"]') && labelToggle()?.getAttribute('aria-pressed') === 'true'
        const hintOn = $('.viewer__keys')?.textContent ?? ''
        const toolOn = $$('.label-side [aria-label="라벨 도구"] button').find((b) => b.getAttribute('aria-checked') === 'true')?.textContent ?? ''
        // 도구 키 3 = 길이
        key('Digit3')
        await sleep(200)
        const tool3 = $$('.label-side [aria-label="라벨 도구"] button').find((b) => b.getAttribute('aria-checked') === 'true')?.textContent ?? ''
        key('Digit1')
        await sleep(200)
        await setLabel(false)
        await sleep(300)
        const after = await snapAfterRedraw()
        const same = { sscan: after.sscan === base.sscan, cscan: after.cscan === base.cscan, ascan: after.ascan === base.ascan, all: after.all === base.all && after.count === base.count }
        // 끄면 덮개 캔버스도 없다
        const noOverlay = $$('.viewer canvas.vplot__overlay').length === 0
        return {
          ok: o.state === 'ok' && sideOk && hintOn.startsWith('라벨 모드') && hintOff.includes('L 라벨') && toolOn === '점' && tool3 === '길이' && same.sscan && same.cscan && same.ascan && same.all && noOverlay && !$('.label-side') && !text().includes('조정됨'),
          sideOk, hintOn, hintOff, toolOn, tool3, same, count: after.count, noOverlay, readout: readout()
        }
      }
    },
    {
      // S-scan 확대는 라벨 모드에서만: 휠 = 깊이 ×1.25 (포인터 중심), V 눈금자 끌기 = 그 구간, 끄면 보통 창(‘조정됨’ 없음), 다시 켜면 확대 그대로, Z = 초기화
      name: 'label-sscan-zoom',
      async run() {
        await postReset()
        await setLabel(false)
        const normal = axisLabel('깊이')
        const vNormal = axisLabel('용접 중심선 기준 위치')
        // 보통 모드 휠은 S-scan 을 바꾸지 않는다 (지금과 같음)
        const s0 = $('.viewer__sscans canvas')
        const r0 = s0.getBoundingClientRect()
        s0.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: r0.left + r0.width * 0.5, clientY: r0.top + r0.height * 0.5, bubbles: true, cancelable: true }))
        await sleep(300)
        const normalWheel = axisLabel('깊이')
        await setLabel(true)
        const onLabel = axisLabel('깊이')
        const s = $('.viewer__sscans canvas')
        const r = s.getBoundingClientRect()
        s.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true, cancelable: true }))
        await sleep(500)
        const zoomed = axisLabel('깊이')
        const ratio = axisSpan(onLabel) / axisSpan(zoomed)
        // V 눈금자 끌기 (30 % ~ 70 %) = 그 구간으로
        const vsvg = $('.viewer__sscans svg.vaxis--bottom')
        const vr = vsvg.getBoundingClientRect()
        const vev = (type, x) => new PointerEvent(type, { clientX: vr.left + x, clientY: vr.top + 10, bubbles: true, cancelable: true, pointerId: 51, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
        vsvg.dispatchEvent(vev('pointerdown', vr.width * 0.3))
        vsvg.dispatchEvent(vev('pointermove', vr.width * 0.5))
        vsvg.dispatchEvent(vev('pointermove', vr.width * 0.7))
        vsvg.dispatchEvent(vev('pointerup', vr.width * 0.7))
        await sleep(500)
        const vZoomed = axisLabel('용접 중심선 기준 위치')
        const vRatio = axisSpan(vNormal) / axisSpan(vZoomed)
        // 끄면 보통 창, '조정됨'·'파일값으로' 없음
        await setLabel(false)
        const off = axisLabel('깊이')
        const vOff = axisLabel('용접 중심선 기준 위치')
        const offAdjusted = text().includes('조정됨') || $$('.viewer__bar button').some((b) => b.textContent.trim() === '파일값으로')
        // 다시 켜면 확대 그대로
        await setLabel(true)
        const again = axisLabel('깊이')
        const vAgain = axisLabel('용접 중심선 기준 위치')
        // Z = 범위 초기화
        $('.viewer').focus({ preventScroll: true })
        key('KeyZ')
        await sleep(500)
        const reset = axisLabel('깊이')
        const vReset = axisLabel('용접 중심선 기준 위치')
        await setLabel(false)
        return {
          ok:
            normalWheel === normal && onLabel === normal && Math.abs(ratio - 1.25) < 0.03 && vRatio > 2 && off === normal && vOff === vNormal && !offAdjusted &&
            again === zoomed && vAgain === vZoomed && reset === normal && vReset === vNormal,
          normal, normalWheel, onLabel, zoomed, ratio, vNormal, vZoomed, vRatio, off, vOff, offAdjusted, again, reset, vReset
        }
      }
    },
    {
      // 점 도구: S-scan 클릭 = 점 (깊이 포함). 좌표는 앱과 같은 식으로 따로 계산한 화면 창(viewportSingle)에서 빔 20(60°) 샘플 400 자리를 누른다.
      // 패널의 점 = 그 V·실제 깊이·레그, 현재 빔이 60° 로, 영상 위 자홍 점 덮개. A-scan 클릭 = 시간 커서 읽기값. Ctrl+Z = 점 되돌림. 끄면 처음 그림
      name: 'label-point-click',
      async run() {
        await postReset()
        await setLabel(false)
        segClick('Skew90')
        await sleep(400)
        await setScan(39)
        await setAngle(54)
        await sleep(400)
        const base = await snapAfterRedraw()
        await setLabel(true)
        await openLabelPanel()
        $('.viewer').focus({ preventScroll: true })
        key('Digit1')
        await sleep(200)
        // '최대 진폭' 점은 국소 최대로 붙으므로 그대로 찍히는 '위 팁' 차례로 (높이 입력 = 상하 팁)
        const hsel0 = $$('.label-side select').find((x) => x.labels?.[0]?.textContent === '높이 입력')
        if (hsel0 && hsel0.value !== 'tip-tip') {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(hsel0, 'tip-tip')
          hsel0.dispatchEvent(new Event('change', { bubbles: true }))
          await sleep(200)
        }
        clickText('.label-side .label-chip', '위 팁')
        await sleep(200)
        const opened = await api.viewer.open(x3FileId)
        if (!opened.ok) throw new Error('viewer.open ' + opened.code)
        const g = opened.data.info.groups.find((x) => x.name === 'Skew90')
        const t = opened.data.info.specimen.thicknessMm
        const vp = viewportSingle(g)
        const canvas = $('.viewer__sscans canvas')
        const r = canvas.getBoundingClientRect()
        const p = samplePoint(g.beams[20], 400, g.ultrasound)
        // 정수 px 로 눌러(마우스 이벤트 좌표가 정수) 기대값도 그 px 에서 다시 계산한다
        const cx = Math.round(r.left + ((p.v - vp.vMin) / (vp.vMax - vp.vMin)) * r.width)
        const cy = Math.round(r.top + ((p.d - vp.dMin) / (vp.dMax - vp.dMin)) * r.height)
        const v = vp.vMin + ((cx - r.left) / r.width) * (vp.vMax - vp.vMin)
        const d = vp.dMin + ((cy - r.top) / r.height) * (vp.dMax - vp.dMin)
        const n = Math.floor(d / t)
        const within = d - n * t
        const expect = { v, depth: n % 2 === 0 ? within : t - within, leg: n + 1 }
        const ev = (type, id) => canvas.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }))
        ev('pointerdown', 52)
        ev('pointerup', 52)
        canvas.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, bubbles: true, cancelable: true, button: 0 }))
        await sleep(500)
        const items = $$('.label-panel__item')
        const itemText = items[0]?.querySelector('button')?.textContent ?? ''
        const m = /V ([−\-\d.]+) · 깊이 ([−\-\d.]+) mm \(L(\d+)\)/.exec(itemText)
        const got = m ? { v: numOf(m[1]), depth: numOf(m[2]), leg: Number(m[3]) } : null
        const pointOk = items.length === 1 && !!got && Math.abs(got.v - expect.v) <= 0.06 && Math.abs(got.depth - expect.depth) <= 0.06 && got.leg === expect.leg
        const ro = readout()
        // 영상 위 점 덮개: 고른 점 = 자홍 원 (반지름 5 px, 선 2.5 px) — 원 오른쪽 끝 둘레 5 × 3 px 가운데 하나라도 자홍이면
        const fx = (x) => (x - r.left) / r.width
        const fy = (y) => (y - r.top) / r.height
        const ring = []
        const ov = overlayOf('.viewer__sscans')
        for (const dx of [-2, -1, 0, 1, 2]) for (const dy of [-1, 0, 1]) ring.push(ov ? pixelAt(ov, fx(cx + 5 + dx), fy(cy + dy)) : [0, 0, 0])
        const overlayOk = ring.some(isMagenta)
        // A-scan 클릭 = 시간 커서 → 패널에 읽기값(진폭 %)
        const a = $('.viewer__ascan canvas')
        const ar = a.getBoundingClientRect()
        const aev = (type) => a.dispatchEvent(new PointerEvent(type, { clientX: ar.left + ar.width * 0.5, clientY: ar.top + ar.height * 0.5, bubbles: true, cancelable: true, pointerId: 53, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }))
        aev('pointerdown')
        aev('pointerup')
        await sleep(400)
        const sideText = $('.label-side')?.innerText ?? ''
        const timeOk = /시간 커서[^\n]*\n진폭\n[\d.]+ %/.test(sideText)
        // Ctrl+Z: 점을 되돌린다 (시간 커서는 이력에 없다)
        $('.viewer').focus({ preventScroll: true })
        key('KeyZ', { ctrlKey: true })
        await sleep(400)
        const undone = $$('.label-panel__item').length === 0
        await setLabel(false)
        await setAngle(54)
        await sleep(400)
        const after = await snapAfterRedraw()
        const same = { sscan: after.sscan === base.sscan, cscan: after.cscan === base.cscan, ascan: after.ascan === base.ascan, all: after.all === base.all }
        return {
          ok: pointOk && ro['각도'] === '60.0°' && overlayOk && timeOk && undone && same.sscan && same.cscan && same.ascan && same.all,
          pointOk, itemText, expect, got, angle: ro['각도'], overlayOk, ring, timeOk, undone, same
        }
      }
    },
    {
      // 라벨 패널 흐름 (1b 본체, 저장하지 않음): '새 기록' → N = 최대 진폭 점 → 찍을 점 목록이 다음 칸(위 팁)으로 →
      // R → 커서 6칸 → '이 길이로' = 길이 칸 6.0 mm · 잰 빔. 앱 제안은 그 뒤에만(비교용 값 또는 '제안 불가' 이유, 2인 모드면 숨김 글),
      // 그 전에는 '길이를 먼저 정하면' 안내. 세트 줄(라벨러가 없으면 라벨 관리 안내)·지시 표·단축키 표. 초안 지우기 → 끄면 처음 그림
      name: 'label-panel-flow',
      async run() {
        await postReset()
        await setLabel(false)
        segClick('Skew90')
        await sleep(400)
        await setScan(202)
        await sleep(400)
        const base = await snapAfterRedraw()
        await setLabel(true)
        await openLabelPanel()
        clickText('.label-side [aria-label="라벨 작업"] button', '새 기록')
        // 높이 입력 = 상하 팁 (앞 단계·세션에서 바뀌었을 수 있음)
        const hsel = $$('.label-side select').find((x) => x.labels?.[0]?.textContent === '높이 입력')
        if (hsel && hsel.value !== 'tip-tip') {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(hsel, 'tip-tip')
          hsel.dispatchEvent(new Event('change', { bubbles: true }))
        }
        await sleep(200)
        const waitNote = ($('.label-side [aria-label="길이"]')?.innerText ?? '').includes('길이를 먼저 정하면') || ($('.label-side [aria-label="길이"]')?.innerText ?? '').includes('2인 독립 모드')
        const noSuggestBefore = !$('.label-suggest')
        $('.viewer').focus({ preventScroll: true })
        key('KeyN')
        await sleep(500)
        const items = $$('.label-panel__item')
        const itemText = items[0]?.querySelector('button')?.textContent ?? ''
        const pressed = $$('.label-chip').find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent ?? ''
        const peakOk = items.length === 1 && itemText.startsWith('최대') && /mm \(L\d\)/.test(itemText) && pressed.includes('위 팁')
        $('.viewer').focus({ preventScroll: true })
        key('KeyR')
        await sleep(200)
        for (let i = 0; i < 6; i++) {
          key('ArrowRight')
          await sleep(30)
        }
        await sleep(300)
        clickText('.label-side button', '이 길이로')
        await sleep(1200)
        const lenText = $('.label-side [aria-label="길이"]')?.innerText ?? ''
        // N 은 ± 2 칸·± 2 빔의 게이트 최대 칸으로 커서를 옮길 수 있다 — 길이는 그 칸에서 6칸
        const lengthOk = /길이\n[\d.]+–[\d.]+ · 6\.0 mm/.test(lenText) && /잰 빔\nSkew90/.test(lenText)
        const blindNote = lenText.includes('2인 독립 모드라 앱 제안을 숨깁니다')
        const suggestShown = !!$('.label-suggest') && lenText.includes('앱 제안 (비교용)') && (/mm · 빔/.test(lenText) || lenText.includes('제안 불가'))
        const sideText = $('.label-side')?.innerText ?? ''
        const panelOk = sideText.includes('세트') && sideText.includes('지시 표') && !!$('.label-side [aria-label="단축키"]') && !!$('.label-side .btn--primary')
        const primaryCount = $$('.viewer .btn--primary').length
        // 화면 전체에서 파랑으로 보이는 버튼 (상단바 '파일 가져오기'는 라벨 모드에서 보조 모양)
        const blue = blueButtons()
        const topbarBlue = blue.some((t) => t.includes('파일 가져오기'))
        clickText('.label-side button', '초안 지우기')
        await sleep(300)
        const cleared = $$('.label-panel__item').length === 0
        await setLabel(false)
        $('.viewer').focus({ preventScroll: true })
        await setScan(202)
        await sleep(400)
        const after = await snapAfterRedraw()
        const same = { sscan: after.sscan === base.sscan, cscan: after.cscan === base.cscan, ascan: after.ascan === base.ascan }
        return {
          ok: waitNote && noSuggestBefore && peakOk && lengthOk && (blindNote || suggestShown) && panelOk && primaryCount === 1 && blue.length <= 1 && !topbarBlue && cleared && same.sscan && same.cscan && same.ascan,
          waitNote, noSuggestBefore, peakOk, itemText, pressed, lengthOk, lenText, blindNote, suggestShown, panelOk, primaryCount, blue, topbarBlue, cleared, same
        }
      }
    },
    {
      // 1280×800 라벨 모드: 패널 열림·접힘 모두 가로 스크롤 없음, 측정값 줄 한 줄, 영상 칸 최소 크기 (열림 ≥ 80, 접힘 ≥ 100)
      name: 'min-window-label',
      window: { width: 1280, height: 800 },
      async run() {
        await sleep(500)
        segClick('A-C-S')
        await sleep(200)
        segClick('모두')
        await sleep(500)
        await setLabel(true)
        await openLabelPanel()
        const open = metrics()
        $('.label-side button[aria-label="라벨 패널 접기"]').click()
        await waitFor(() => $('.label-side--collapsed'), 3000, 50)
        await sleep(500)
        const collapsed = metrics()
        await openLabelPanel()
        // A-B-C-S + S-scan 확대(‘확대’ 칩, 대조 전 칩) 에서도 가로 스크롤 없음 — 도구막대는 넘치면 줄을 바꾼다
        segClick('A-B-C-S')
        await sleep(500)
        const sz = $('.viewer__sscans canvas')
        const zr = sz.getBoundingClientRect()
        sz.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: zr.left + zr.width * 0.5, clientY: zr.top + zr.height * 0.5, bubbles: true, cancelable: true }))
        await sleep(500)
        const abcsZoom = metrics()
        const zoomChip = text().includes('확대') && !$$('.viewer__bar button').some((b) => b.textContent.trim() === '파일값으로')
        $('.viewer').focus({ preventScroll: true })
        key('KeyZ', { shiftKey: true })
        await sleep(300)
        segClick('A-C-S')
        await sleep(300)
        await setLabel(false)
        const off = metrics()
        const ok = (m, min) => m.noHScroll && m.readoutH <= 32 && m.barH <= 48 && m.minBox >= min
        // 라벨 모드 도구막대는 넘치면 두 줄까지 (높이 ≤ 96)
        const okWrap = (m, min) => m.noHScroll && m.readoutH <= 32 && m.barH <= 96 && m.minBox >= min
        return { ok: ok(open, 80) && ok(collapsed, 100) && okWrap(abcsZoom, 60) && zoomChip && ok(off, 100), open, collapsed, abcsZoom, zoomChip, off }
      }
    },
    {
      // 패널 도구를 마우스로 누른 뒤 → 는 스캔을 옮긴다 (도구가 바뀌지 않음 — 포커스가 영상으로 돌아옴), N·R 이 듣는다.
      // L 로 끄면 포커스가 영상에 남아 ← 가 듣는다
      name: 'label-tool-focus-arrow',
      window: { width: 1440, height: 900 },
      async run() {
        await postReset()
        await setLabel(true)
        await openLabelPanel()
        await setScan(100)
        const btn = $$('.label-side [aria-label="라벨 도구"] button').find((b) => b.textContent.trim() === '길이')
        btn.focus()
        // 사람이 누른 것처럼 (detail = 1 — 키보드 Enter·Space 가 아님)
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, button: 0 }))
        await sleep(200)
        const focusBack = !!document.activeElement?.closest?.('.viewer') && !document.activeElement?.closest?.('[role=radiogroup]')
        key('ArrowRight')
        await sleep(300)
        const tool = $$('.label-side [aria-label="라벨 도구"] button').find((b) => b.getAttribute('aria-checked') === 'true')?.textContent ?? ''
        const moved = Math.round(scanMm()) === 101
        key('KeyR')
        await sleep(200)
        const refOk = ($('.label-side [aria-label="길이"]')?.innerText ?? '').includes('101.0 →')
        key('KeyR', { shiftKey: true })
        key('Digit1')
        await sleep(100)
        // 패널 버튼에 포커스를 둔 채 L 로 끄면 포커스가 body 로 떨어지지 않는다
        $('.label-side button')?.focus()
        await setLabel(false)
        await sleep(200)
        const focusAfterOff = document.activeElement !== document.body && !!document.activeElement?.closest?.('.viewer')
        key('ArrowLeft')
        await sleep(300)
        const movedBack = Math.round(scanMm()) === 100
        return { ok: focusBack && tool === '길이' && moved && refOk && focusAfterOff && movedBack, focusBack, tool, moved, refOk, focusAfterOff, movedBack }
      }
    },
    {
      // 라벨 덮개가 켜진 상태의 스크럽 (기록 초안·R 이 있는 X3, 1440×900): 키 → 다음 프레임 95 % ≤ 50 ms.
      // 덮개는 따로 겹친 캔버스라 시간 커서·덮개만 바뀔 때 영상은 다시 칠하지 않는다
      name: 'label-scrub-perf',
      window: { width: 1440, height: 900 },
      async run() {
        await postReset()
        await setLabel(true)
        await openLabelPanel()
        segClick('모두')
        await sleep(400)
        await setScan(202)
        $('.viewer').focus({ preventScroll: true })
        key('KeyN')
        await sleep(200)
        key('KeyR')
        await sleep(300)
        const times = []
        let frames = 0
        for (let i = 0; i < 40; i++) {
          const t0 = performance.now()
          key(i % 2 ? 'ArrowLeft' : 'ArrowRight')
          if (await nextFrame()) frames++
          times.push(performance.now() - t0)
        }
        const overlays = $$('.viewer canvas.vplot__overlay').length
        clickText('.label-side button', '초안 지우기')
        await sleep(200)
        await setLabel(false)
        const p = round1(p95(times))
        return { ok: overlays > 0 && (frames < 20 || p <= 50), p95: p, median: round1(median(times)), frames, overlays }
      }
    },
    {
      // A-scan 기준선 (OmniPC 조사 X3, viewer/levelLines.ts): 보통 모드 기본 끔 — 기준선 캔버스(.vplot__levels)가 없고 영상 그대로.
      // 조정 패널 '색표' → '색 범위' 의 'A-scan 기준선'을 켜면 기준선 캔버스만 생기고 영상 캔버스는 바이트 그대로, 끄면 사라지고 그대로.
      // X3 Skew90 (t 12 mm, Δ 0): 기록 −8 dB·평가 −14 dB 세로 점선의 x 가 따로 계산한 값(Ref = 기준 진폭 × 10^((이득 − 기준 이득)/20)) ±1 px,
      // 100 % 축에서는 Ref 선(≈ 160 %)이 없다. 라벨 모드는 기본 켬, 끄면 다시 없음
      name: 'level-lines-toggle',
      window: { width: 1440, height: 900 },
      async run() {
        await postReset()
        await setLabel(false)
        segClick('Skew90')
        await sleep(500)
        await setScan(39)
        await setAngle(54)
        await sleep(300)
        // 조정 패널을 먼저 연다 (패널 한 행만큼 영상 크기가 바뀌므로 기준 그림도 패널을 연 채로)
        await openTools()
        await toolsTab('색표')
        clickText('.viewer__tools [aria-label="색표 보기"] button', '색 범위')
        await sleep(300)
        const base = await snapAfterRedraw()
        const noneAtStart = !$('.viewer__ascan canvas.vplot__levels')
        const box = () => $$('.viewer__tools label.check').find((l) => l.textContent.includes('A-scan 기준선'))?.querySelector('input')
        box().click()
        await sleep(500)
        const lv = $('.viewer__ascan canvas.vplot__levels')
        const shown = snapCanvases()
        const sameOn = shown.all === base.all && shown.ascan === base.ascan
        // 따로 계산한 선 위치 (기준선 캔버스 픽셀): 글자 줄(위 3줄) 아래 가로 줄들에서 칠해진 열을 모아 덩어리 가운데
        const opened = await api.viewer.open(x3FileId)
        const g = opened.data.info.groups.find((x) => x.name === 'Skew90')
        const ref = (g.referenceAmplitudePct ?? 80) * 10 ** ((g.gainDb - g.referenceGainDb) / 20)
        const want = [ref * 10 ** (-14 / 20), ref * 10 ** (-8 / 20)]
        let cols = []
        let ratio = 1
        if (lv) {
          const w = lv.width
          const h = lv.height
          ratio = w / lv.getBoundingClientRect().width
          const c2 = document.createElement('canvas')
          c2.width = w
          c2.height = h
          const x2 = c2.getContext('2d', { willReadFrequently: true })
          x2.drawImage(lv, 0, 0)
          const img = x2.getImageData(0, 0, w, h).data
          const hit = new Array(w).fill(false)
          for (let y = Math.ceil(60 * ratio); y < h; y += 2) for (let x = 0; x < w; x++) if (img[(y * w + x) * 4 + 3] > 0) hit[x] = true
          for (let x = 0; x < w; x++) {
            if (!hit[x]) continue
            let e = x
            while (e + 1 < w && hit[e + 1]) e++
            cols.push(((x + e + 1) / 2) / ratio)
            x = e
          }
        }
        const cssW = lv ? lv.getBoundingClientRect().width : 0
        const wantX = want.map((p) => (p / 100) * cssW)
        const posOk = cols.length === 2 && cols.every((c, i) => Math.abs(c - wantX[i]) <= 1)
        const refOff = ref > 100
        box().click()
        await sleep(400)
        const goneOff = !$('.viewer__ascan canvas.vplot__levels')
        const back = await snapAfterRedraw()
        const sameOff = back.all === base.all && back.count === base.count
        await closeTools()
        await setLabel(true)
        const onLabel = !!$('.viewer__ascan canvas.vplot__levels')
        await setLabel(false)
        const goneAfter = !$('.viewer__ascan canvas.vplot__levels')
        return {
          ok: noneAtStart && !!lv && sameOn && posOk && refOff && goneOff && sameOff && onLabel && goneAfter,
          noneAtStart, levels: !!lv, sameOn, cols: cols.map(round1), wantX: wantX.map(round1), ref: round1(ref), posOk, goneOff, sameOff, onLabel, goneAfter
        }
      }
    },
    {
      // OPD (PCN TP14-ROOT-L-01.opd 를 함께 가져왔을 때만 — 없으면 건너뜀). 1280×800 에서 대조 전 칩이 한 줄,
      // 'OPD 읽기 주의'·'색표: 내장'·'엔코더 동기'(Axis 동기 코드 1, 읽기 규칙 4)·'자동 변환·학습 내보내기 막힘'(시편 형상 추정 포함) 줄,
      // 첫 커서 = 게이트 A 최대 칸 (독립 계산)
      name: 'open-opd-tp14',
      window: { width: 1280, height: 800 },
      async run() {
        const has = await api.files.list({ text: OPD_TP14, limit: 5 })
        if (!has.ok || !has.data.items.some((f) => f.storedFileName === OPD_TP14)) return { ok: true, skipped: 'OPD 파일을 가져오지 않음' }
        const o = await openFile(OPD_TP14)
        opdFileId = o.item.id
        const chips = $$('.viewer__bar .status').map((el) => ({ text: el.textContent.trim(), lines: el.getClientRects().length, h: Math.round(el.getBoundingClientRect().height) }))
        const chip = chips.find((c) => c.text.startsWith('OmniPC 대조 전'))
        const t = text()
        const need = ['OPD 읽기 주의', '색표: 내장', '엔코더 동기', '자동 변환·학습 내보내기 막힘', '시편 형상 추정', '읽기 규칙 opd-structure v4']
        const missing = need.filter((x) => !t.includes(x))
        const m = metrics()
        const ok =
          o.state === 'ok' &&
          o.firstScanOk &&
          !!chip &&
          chip.text === 'OmniPC 대조 전 (OPD 섹토리얼 · 스큐 90 · 진폭 눈금)' &&
          chip.lines === 1 &&
          missing.length === 0 &&
          m.noHScroll
        return { ok, openMs: o.openMs, firstScan: o.firstScan, chip, chips, missing, metrics: m, readout: readout() }
      }
    },
    {
      // OmniPC 6.6 캡처(3_화면대조.md): 278.03 mm · 65° 에서 A% 32.3(추정 눈금, ±0.1) · DA^ 22.45(앱 '실제 깊이' = 접은 깊이) · ViA^ 2.21 (±0.5 mm).
      // 게이트 A 문턱은 파일 Gate 레코드에서 읽음(10 % — 화면과 같음) → '문턱 모름' 칸이 없어야 한다
      name: 'opd-tp14-278-65',
      async run() {
        if (opdFileId === null) return { ok: true, skipped: 'OPD 파일을 가져오지 않음' }
        await setScan(278)
        await setAngle(65)
        await sleep(300)
        const ro = readout()
        const a = numOf(ro['A%'])
        const da = numOf(ro['실제 깊이'])
        const via = numOf(ro['CL 기준 ViA^'])
        const ok =
          ro['스캔'] === '278.0 mm' &&
          ro['각도'] === '65.0°' &&
          Math.abs(a - 32.3) <= 0.1 + 1e-9 &&
          String(ro['A%']).includes('추정 눈금') &&
          ro['문턱'] !== '모름' &&
          Math.abs(da - 22.45) <= 0.5 &&
          Math.abs(via - 2.21) <= 0.5
        const c = $('.viewer__cscans canvas')
        const s = $('.viewer__sscans canvas')
        return { ok, readout: ro, canvases: { cscan: c ? c.toDataURL('image/png') : '', sscan: s ? s.toDataURL('image/png') : '' } }
      }
    },
    {
      // 이전·다음 파일 (OmniPC 조사 X9, viewer/fileNav.ts — 같은 플랜 전체를 시편 → 파일 이름 순, 2026-10-07 기본값 (가)).
      // PCN PL23864_TOP_R_01·02.opd(같은 플랜·같은 시편 PL23864, 플랜 순서에서 이웃)를 함께 가져왔을 때만 (없으면 건너뜀).
      // 자리 'n/N' 은 그 플랜의 파일 목록을 앱과 같은 순서로 세어 맞춘다. 1280×800 보통 모드: 도구막대 '◀ n/N ▶' 가 한 줄 안(줄바꿈 없음), 가로 스크롤 없음.
      // 라벨 모드에서 N 으로 초안 점 하나·= 로 이득 +1 dB → ] → 02 가 라벨 모드로·초안 없음·'조정됨' 없음 →
      // 라벨 패널 단추에 포커스를 둔 [ 는 듣지 않음 → 영상에서 [ → 01 이 라벨 모드로, 초안 점·'조정됨' 그대로(파일마다 세션).
      // 끝나면 초안 지우기·파일값으로·라벨 끔
      name: 'file-nav-prev-next',
      window: { width: 1280, height: 800 },
      async run() {
        const NAV1 = 'PL23864_TOP_R_01.opd'
        const NAV2 = 'PL23864_TOP_R_02.opd'
        const has = await api.files.list({ text: 'PL23864_TOP_R', limit: 10 })
        const found = has.ok ? has.data.items : []
        const f1 = found.find((f) => f.storedFileName === NAV1)
        const f2 = found.find((f) => f.storedFileName === NAV2)
        if (!f1 || !f2) return { ok: true, skipped: 'PL23864_TOP_R_01·02.opd 를 가져오지 않음' }
        // 앱과 같은 순서 (viewer/fileNav.ts compareNavFiles: 시편 → 이름 줄기 → 확장자 → ID, 숫자는 값으로·대소문자 무시)
        const coll = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
        const split = (n) => {
          const i = n.lastIndexOf('.')
          return i > 0 ? [n.slice(0, i), n.slice(i)] : [n, '']
        }
        const cmp = (a, b) =>
          coll.compare(a.specimenId, b.specimenId) ||
          coll.compare(split(a.storedFileName)[0], split(b.storedFileName)[0]) ||
          coll.compare(split(a.storedFileName)[1], split(b.storedFileName)[1]) ||
          a.id - b.id
        const planList = await api.files.list({ planId: f1.planId, limit: 1000, sort: 'fileName-asc' })
        const order = planList.ok ? planList.data.items.filter((f) => f.planId === f1.planId).sort(cmp) : []
        const i1 = order.findIndex((f) => f.id === f1.id)
        const i2 = order.findIndex((f) => f.id === f2.id)
        if (i1 < 0 || i2 !== i1 + 1) return { ok: true, skipped: '두 파일이 같은 플랜 순서에서 이웃이 아님', order: order.map((f) => f.storedFileName) }
        const POS1 = `${i1 + 1}/${order.length}`
        const POS2 = `${i2 + 1}/${order.length}`
        const o = await openFile(NAV1)
        if (o.state !== 'ok') return { ok: false, state: o.state }
        await setLabel(false)
        await postReset()
        const titleOf = () => $('.viewer__title')?.textContent ?? ''
        const navPos = () => $('.viewer__filenav-pos')?.textContent ?? ''
        const navBtn = (lbl) => $(`.viewer__filenav button[aria-label="${lbl}"]`)
        const adjustedChip = () => $$('.viewer__bar .status').some((x) => x.textContent.trim() === '조정됨')
        const points = () => $$('.label-panel__item').length
        await waitFor(() => $('.viewer__filenav'), 5000, 50)
        const m0 = metrics()
        const startOk = titleOf() === NAV1 && navPos() === POS1 && navBtn('이전 파일')?.disabled === (i1 === 0) && navBtn('다음 파일')?.disabled === false
        const barOneLine = m0.barH <= 40 && m0.noHScroll
        // 라벨 모드 + 초안 점 + 이득 +1 dB
        await setLabel(true)
        await openLabelPanel()
        $('.viewer').focus({ preventScroll: true })
        key('KeyN')
        await sleep(400)
        key('Equal')
        await sleep(300)
        const before = { points: points(), adjusted: adjustedChip() }
        // ] → 02 (라벨 모드 그대로, 그 파일의 세션은 비어 있음)
        $('.viewer').focus({ preventScroll: true })
        key('BracketRight')
        await waitFor(() => titleOf() === NAV2 && viewerState() === 'ok', 30000, 100)
        await waitFor(() => labelIsOn() && !!$('.label-side'), 5000, 50)
        await sleep(500)
        const at2 = { title: titleOf(), pos: navPos(), label: labelIsOn(), points: points(), adjusted: adjustedChip(), nextDisabled: navBtn('다음 파일')?.disabled === true }
        // 라벨 패널 단추에 포커스가 있으면 [ 는 파일을 넘기지 않는다
        const panelBtn = $$('.label-side button').find((b) => b.offsetParent !== null && !b.disabled)
        let panelIgnored = false
        if (panelBtn) {
          panelBtn.focus()
          key('BracketLeft')
          await sleep(600)
          panelIgnored = titleOf() === NAV2
        }
        // 영상에서 [ → 01 (라벨 모드, 초안 점·이득 그대로)
        $('.viewer').focus({ preventScroll: true })
        key('BracketLeft')
        await waitFor(() => titleOf() === NAV1 && viewerState() === 'ok', 30000, 100)
        await waitFor(() => labelIsOn() && !!$('.label-side'), 5000, 50)
        await sleep(500)
        await openLabelPanel()
        const back = { title: titleOf(), pos: navPos(), label: labelIsOn(), points: points(), adjusted: adjustedChip() }
        // 정리: 초안 지우기 · 파일값으로 · 라벨 끔
        const clearBtn = $$('.label-side button').find((b) => b.textContent.trim() === '초안 지우기')
        if (clearBtn) clearBtn.click()
        await sleep(300)
        await postReset()
        await setLabel(false)
        const cleaned = points() === 0 && !adjustedChip()
        const ok =
          startOk &&
          barOneLine &&
          before.points === 1 &&
          before.adjusted &&
          at2.title === NAV2 &&
          at2.pos === POS2 &&
          at2.label &&
          at2.points === 0 &&
          !at2.adjusted &&
          at2.nextDisabled === (i2 === order.length - 1) &&
          panelIgnored &&
          back.title === NAV1 &&
          back.pos === POS1 &&
          back.label &&
          back.points === 1 &&
          back.adjusted &&
          cleaned
        return { ok, planFiles: order.length, pos: [POS1, POS2], startOk, barH: m0.barH, noHScroll: m0.noHScroll, barOneLine, before, at2, panelIgnored, back, cleaned }
      }
    }
  ]

  /** 창 크기 점검 수치 */
  function metrics() {
    const de = document.documentElement
    const box = $$('.vplot__box').map((b) => b.getBoundingClientRect())
    return {
      noHScroll: de.scrollWidth <= innerWidth + 1,
      inner: [innerWidth, innerHeight],
      readoutH: Math.round($('.viewer__readout')?.getBoundingClientRect().height ?? 0),
      barH: Math.round($('.viewer__bar')?.getBoundingClientRect().height ?? 0),
      bodyH: Math.round($('.viewer__body')?.getBoundingClientRect().height ?? 0),
      minBox: Math.round(Math.min(...box.map((r) => Math.min(r.width, r.height)))),
      boxes: box.map((r) => [Math.round(r.width), Math.round(r.height)])
    }
  }
})()
