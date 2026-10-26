/**
 * 조정 패널 (후처리 숫자 입력). 도구막대 아래 한 행(32 px), 기본 접힘 — 영상 위에는 아무것도 덮지 않는다 (디자인 규칙).
 * 탭(범위·게이트·이득·색표·내보내기)마다 한 행만 보이고, '범위' 는 뷰별 하위 탭(C-scan·A-scan·B-scan),
 * '색표' 는 하위 탭(색 범위 — 범위·A-scan 진폭 축·A-scan 기준선 / 색표 파일 — OmniPC .pal 불러오기·되돌리기)으로 나눈다 (1280 폭 한 행).
 * '내보내기' = 활성 그룹 C-scan 을 OmniPC 'Export C-scan' 꼴 .txt 로 (OmniPC 조사 X8).
 * 입력은 Enter·blur 로 적용, Esc 로 되돌림. 한글 조합 중 Enter 는 무시한다.
 */
import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode } from 'react'
import type { GateDisplayValues, MmRange, PostAction, RangeLimits } from '@shared/imaging'
import { Status } from '../components/Status'

export type ToolsTab = 'range' | 'gate' | 'gain' | 'palette' | 'export'
/** 색표 탭 하위 탭: 색 범위(범위·진폭 축·기준선) / 색표 파일(.pal 불러오기) */
export type PaletteView = 'range' | 'file'
/** S-scan 범위(깊이·가로 잘라 보기)는 사용자 지시(2026-10-06 "굳이 없어도 될 것 같다")로 화면에서 뺐다 — 모델·리듀서는 남아 있어 되돌리기 쉽다 */
export type RangeView = 'cscan' | 'ascan' | 'bscan'

export interface RangeTools {
  /** 뷰별 현재 창과 클램프 기준 (활성 그룹 기준) */
  scan: { range: MmRange; limits: RangeLimits; isDefault: boolean }
  ascan: { range: MmRange; limits: RangeLimits; isDefault: boolean }
  bscan: { range: MmRange; limits: RangeLimits; isDefault: boolean }
  reversed: boolean
  /** 첫 빔(빔 0)을 부르는 말 — 체크 칸 글자 '첫 빔(…)이 아래' ('작은 각도', 리니어는 '빔 1') */
  firstBeamName: string
  /** Paintbrush의 두 번째 축은 공간 위치이므로 빔 대신 첫 위치라고 부른다. */
  spatialAxis?: boolean
  /** 파일의 C-scan 뒤집기 값 — 같은 값으로 돌아오면 '조정' 이 아니다 */
  fileReversed: boolean
  reversedIsDefault: boolean
}

/** 게이트 탭 (활성 그룹의 C-scan 게이트) */
export interface GateTools {
  gateId: number
  /** 'Gate A' 등 파일 이름 그대로 */
  name: string
  /** 유효(편집 반영) 값 — 사용자 단위 */
  values: GateDisplayValues
  /** 파일값 (툴팁) */
  file: GateDisplayValues
  thresholdPct: number | null
  /** 유효 게이트의 빔 0 시작·끝 (µs, 툴팁) */
  /** 파일 게이트의 빔 0 시간 (툴팁의 '파일값' 용 — 편집된 시간이 아니다) */
  fileStartUs: number
  fileEndUs: number
  unitMax: number
  /** true = 문턱 % 를 파일에서 못 찾음 (OPD) — '문턱 모름' 표시. 사용자가 넣으면 thresholdPct 가 생겨 사라진다 */
  thresholdUnknown?: boolean
  isDefault: boolean
  /** 1차는 편집하지 않는 다른 게이트 (이름, C-scan 게이트 아님 표시 — 장비에서 끈 게이트는 '(꺼짐)'을 붙여 넘긴다) */
  others: string[]
  /** true = 이 게이트가 장비에서 꺼진 채 저장됨 (L5 — 파일 설정). C-scan·측정값은 파일 게이트 창으로 그대로 계산한다 */
  fileDisabled?: boolean
}

/** 이득 탭 (활성 그룹) */
export interface GainTools {
  /** 소프트 이득 Δ (dB) */
  gainDb: number
  /** 파일 이득 (dB, 없으면 null) */
  fileGainDb: number | null
  /** 기준 이득 (OmniPC Ref, 없으면 null → Gain = 파일 이득 + Δ) */
  referenceGainDb: number | null
  /** Auto 80 % 목표 */
  referenceAmplitudePct: number
  /** true = 기준 이득을 파일에서 알 수 없음 (OPD 의 기준 이득 0) — 'Ref 모름' 표시 */
  refUnknown?: boolean
  /** 읽기값 포화 % (진폭 눈금 상한). 없으면 200 (NDE) — OPD 는 250 (추정) */
  saturatePct?: number
  /** Auto 80 % 가 못 한 이유 (없으면 null) */
  note: string | null
  /**
   * 파일에 저장된 OmniPC 분석(소프트) 이득 dB (L4, 0 이 아닐 때만 — 그 밖은 null). 그림·기록은 늘 저장 진폭(0 dB) 기준이고,
   * '이 값으로' 를 누를 때만 화면 이득 Δ 로 넣는다 (OmniPC 화면과 같은 값인지는 캡처 34 대조 전)
   */
  fileSoftGainDb?: number | null
}

/** 색표 탭 (뷰어 공통 범위 + 활성 그룹 진폭 축 상한 + A-scan 기준선 + 불러온 색표) */
export interface PaletteTools {
  minPct: number
  maxPct: number
  ampAxisMaxPct: 100 | 200
  /** '전체' 축 상한 % (진폭 눈금 상한이 200 보다 큰 형식 — OPD 250). 없으면 200 */
  fullScalePct?: number
  /**
   * A-scan 기준선 (기록·평가 기준 — Ref 선은 그리지 않음, viewer/levelLines.ts — OmniPC 조사 X3). on = 지금 모드(보통·라벨)의 켜짐,
   * available = 활성 그룹에서 Ref 를 추정할 수 있음, legend = 값 한 줄(툴팁), unavailable = 못 그리는 이유
   */
  levelLines: { on: boolean; available: boolean; legend: string | null; unavailable: string | null; labelMode: boolean }
  /** 불러온 OmniPC 색표 이름 (없으면 null = 파일 색표) */
  paletteFileName: string | null
  /** 파일 색표 이름 ('파일 색표' · OPD 는 '앱 내장 색표') */
  fileSourceName: string
  /** 불러오기 중 */
  paletteBusy: boolean
  /** 불러오기 결과 메모·오류 (없으면 null) */
  paletteNote: string | null
  /** 불러오기를 막는 이유 (2인 블라인드 판독 — 두 판독자 화면을 같게). 없으면 null */
  paletteBlocked?: string | null
}

/** 내보내기 탭 (활성 그룹 C-scan → OmniPC 꼴 .txt, X8) */
export interface ExportTools {
  /** C-scan 게이트 값 한 줄 ('게이트 A · 깊이 7.0~28.0 mm · 문턱 20.0 %'). 게이트가 없으면 null */
  gateText: string | null
  /** 조정 패널에서 바꾼 게이트 값이 들어가는가 */
  adjusted: boolean
  /** OPD 처럼 문턱을 모름 → 'Gate Level' 칸이 빈다 */
  thresholdUnknown: boolean
  /** 활성 그룹의 화면 이득 Δ (dB). 0 이 아니면 '진폭은 파일 값(Δ 미포함)' 을 글자로 */
  gainDeltaDb: number
  busy: boolean
  /** 마지막으로 쓴 파일 (그 그룹 이름과 함께). unconfirmed = OmniPC 내보내기로 확인 전인 칸 → '대조 전' 칩 */
  result: { groupName: string; path: string; bytes: number; scanCount: number; indexCount: number; indexConfirmed: boolean; unconfirmed: string[] } | null
  error: string | null
}

function fmt(v: number, digits: number): string {
  return v.toFixed(digits).replace('-', '−')
}

/** 숫자 한 칸: Enter·blur 적용, Esc 되돌림. 값이 바깥에서 바뀌면 글자도 따라간다 */
export function NumField(props: { label: string; value: number; unit: string; digits?: number; title?: string; onCommit: (v: number) => void }) {
  const digits = props.digits ?? 1
  const shown = fmt(props.value, digits)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  // Esc 는 blur 를 부르고 blur 는 적용이므로, Esc 로 떠나는 길엔 적용을 건너뛴다
  const cancelling = useRef(false)
  const commit = (): void => {
    if (cancelling.current) {
      cancelling.current = false
      setText(shown)
      return
    }
    const n = Number.parseFloat(text.replace('−', '-'))
    if (Number.isFinite(n) && fmt(n, digits) !== shown) props.onCommit(n)
    // 적용돼도 글자는 반올림된 값으로 (범위 밖이라 값이 안 바뀌면 입력한 글자가 남지 않게)
    setText(shown)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelling.current = true
      setText(shown)
      // body 가 아니라 영상 화면으로 — 방향키·이득 키가 바로 듣게
      const viewer = e.currentTarget.closest<HTMLElement>('.viewer')
      e.currentTarget.blur()
      viewer?.focus({ preventScroll: true })
    }
  }
  return (
    <label className="viewer__field" title={props.title}>
      <span className="viewer__field-label">{props.label}</span>
      <input
        className="input input--num num"
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={props.unit ? `${props.label} (${props.unit})` : props.label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="unit">{props.unit}</span>
    </label>
  )
}

function Sep() {
  return <span className="viewer__sep" aria-hidden="true" />
}

function RangePair(props: { label: string; range: MmRange; unit: string; onCommit: (r: MmRange) => void }) {
  const [a, b] = props.range
  return (
    <span className="viewer__pair">
      <NumField label={`${props.label} 시작`} value={a} unit="" onCommit={(v) => props.onCommit([v, b])} />
      <span className="unit">~</span>
      <NumField label={`${props.label} 끝`} value={b} unit={props.unit} onCommit={(v) => props.onCommit([a, v])} />
    </span>
  )
}

function SubSeg<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ id: T; name: string }>; onChange: (v: T) => void }) {
  // 라디오 묶음 관례: ←/→ 로 고르고 포커스도 따라간다 (Tab 은 묶음을 하나로 건너뜀)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = props.options.findIndex((o) => o.id === props.value)
    const next = props.options[(i + dir + props.options.length) % props.options.length]
    if (!next) return
    props.onChange(next.id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[(i + dir + props.options.length) % props.options.length]?.focus()
  }
  return (
    <div className="seg seg--sub" role="radiogroup" aria-label={props.label} onKeyDown={onKeyDown}>
      {props.options.map((v) => (
        <button key={v.id} type="button" role="radio" aria-checked={props.value === v.id} tabIndex={props.value === v.id ? 0 : -1} className="seg__item" onClick={() => props.onChange(v.id)}>
          {v.name}
        </button>
      ))}
    </div>
  )
}

export function ToolsPanel(props: {
  groupId: number
  groupName: string
  hasBscan: boolean
  tools: RangeTools
  gate: GateTools | null
  gain: GainTools
  paletteTools: PaletteTools
  onAutoGain: () => void
  dispatch: Dispatch<PostAction>
  tab: ToolsTab
  onTab: (t: ToolsTab) => void
  view: RangeView
  onView: (v: RangeView) => void
  paletteView: PaletteView
  onPaletteView: (v: PaletteView) => void
  /** A-scan 기준선 켜고 끄기 (지금 모드의 값) */
  onLevelLines: (on: boolean) => void
  /** OmniPC 색표(.pal) 불러오기 (main 열기 대화상자) */
  onLoadPalette: () => void
  exportTools: ExportTools
  onExport: () => void
}) {
  const { tools: t, dispatch, groupId } = props
  const tabs: Array<{ id: ToolsTab; name: string }> = [
    { id: 'range', name: '범위' },
    { id: 'gate', name: '게이트' },
    { id: 'gain', name: '이득' },
    { id: 'palette', name: '색표' },
    { id: 'export', name: '내보내기' }
  ]
  const tab = props.tab === 'gate' && !props.gate ? 'range' : props.tab
  let row: ReactNode
  let reset: (() => void) | null = null
  let canReset = false
  let sub: ReactNode = null

  if (tab === 'gain') {
    const g = props.gain
    // OmniPC DATA 패널: Gain = 파일 이득 − 기준 이득 + Δ, Ref = 기준 이득 (기준이 없으면 Gain = 파일 이득 + Δ)
    const shownGain = g.fileGainDb === null ? null : g.fileGainDb - (g.referenceGainDb ?? 0) + g.gainDb
    const title = `파일 이득 ${g.fileGainDb === null ? '—' : fmt(g.fileGainDb, 1) + ' dB'}${g.referenceGainDb !== null ? ` · 기준 ${fmt(g.referenceGainDb, 1)} dB` : ''} · 소프트 이득 Δ ${fmt(g.gainDb, 1)} dB (표시 진폭 × 10^(Δ/20), ${g.saturatePct ?? 200} % 포화)`
    row = (
      <>
        <button type="button" className="btn btn--ghost" aria-label="이득 1 dB 내림" title="−1 dB (Shift 로 0.1 dB)" onClick={(e) => dispatch({ type: 'nudgeGain', groupId, dB: e.shiftKey ? -0.1 : -1 })}>
          −
        </button>
        <NumField label="이득" value={shownGain ?? g.gainDb} unit="dB" digits={1} title={title} onCommit={(v) => dispatch({ type: 'setGain', groupId, dB: g.fileGainDb === null ? v : v - (g.fileGainDb - (g.referenceGainDb ?? 0)) })} />
        <button type="button" className="btn btn--ghost" aria-label="이득 1 dB 올림" title="+1 dB (Shift 로 0.1 dB)" onClick={(e) => dispatch({ type: 'nudgeGain', groupId, dB: e.shiftKey ? 0.1 : 1 })}>
          +
        </button>
        {g.referenceGainDb !== null ? (
          <span className="viewer__tools-group unit" title="기준 이득 (파일 referenceGain, 바꿀 수 없음)">
            Ref {fmt(g.referenceGainDb, 1)} dB
          </span>
        ) : g.refUnknown ? (
          <span className="viewer__tools-group unit" title="파일의 기준 이득이 0 이라 Ref 를 알 수 없습니다 (이득 = 파일 이득 + Δ)">
            Ref 모름
          </span>
        ) : null}
        <span className="viewer__tools-group unit" title="소프트 이득 Δ — 파일에 저장된 진폭에 더해 보여 주는 값">
          Δ {g.gainDb > 0 ? '+' : ''}
          {fmt(g.gainDb, 1)} dB
        </span>
        <Sep />
        <button type="button" className="btn btn--ghost" title={`현재 칸의 게이트 최대를 ${g.referenceAmplitudePct} % 로 맞추는 이득을 더합니다 (A 키)`} onClick={props.onAutoGain}>
          Auto {g.referenceAmplitudePct} %
        </button>
        {g.note ? <span className="viewer__tools-group unit">{g.note}</span> : null}
        {g.fileSoftGainDb ? (
          <>
            <Sep />
            <span
              className="viewer__tools-group unit"
              title="파일에 OmniPC 분석 이득이 저장되어 있습니다. 앱의 그림·측정값·기록은 저장 진폭(0 dB) 기준입니다 — '이 값으로' 는 화면 이득 Δ 로만 넣습니다(OmniPC 화면과 같은지는 대조 전)"
            >
              파일 분석 이득 {g.fileSoftGainDb > 0 ? '+' : ''}
              {fmt(g.fileSoftGainDb, 1)} dB
            </span>
            <button type="button" className="btn btn--ghost" disabled={Math.abs(g.gainDb - g.fileSoftGainDb) < 0.05} onClick={() => dispatch({ type: 'setGain', groupId, dB: g.fileSoftGainDb ?? 0 })}>
              이 값으로
            </button>
          </>
        ) : null}
      </>
    )
    canReset = g.gainDb !== 0
    reset = () => dispatch({ type: 'setGain', groupId, dB: 0 })
  } else if (tab === 'palette') {
    const pl = props.paletteTools
    const views: Array<{ id: PaletteView; name: string }> = [
      { id: 'range', name: '색 범위' },
      { id: 'file', name: '색표 파일' }
    ]
    sub = <SubSeg label="색표 보기" value={props.paletteView} options={views} onChange={props.onPaletteView} />
    const lv = pl.levelLines
    const levelTitle = lv.available
      ? `A-scan 진폭 축에 기록 기준·평가 기준 세로 점선 (파일 이득 화면 기준 — OmniPC 의 빨간 TCG 선(80 %)·'Ref.' 와 다른 선이라 Ref 선은 그리지 않음. ${lv.labelMode ? '라벨 모드 기본 켬' : '보통 모드 기본 끔'}, 모드마다 기억).\n${lv.legend ?? ''}`
      : `기준선을 그릴 수 없습니다: ${lv.unavailable ?? 'Ref 를 추정할 수 없음'}`
    row =
      props.paletteView === 'file' ? (
        <>
          <span
            className="viewer__tools-group unit truncate viewer__palname"
            title={pl.paletteFileName ? `불러온 OmniPC 색표 ${pl.paletteFileName} (앱을 닫을 때까지 모든 파일 보기에 — 파일·앱에 저장하지 않음. 이때 저장하는 기록 화면 스냅샷에 이름·해시가 남음)` : pl.fileSourceName}
          >
            색표: {pl.paletteFileName ?? pl.fileSourceName}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={pl.paletteBusy || !!pl.paletteBlocked}
            title={
              pl.paletteBlocked ??
              'OmniPC 색표 파일(.pal)을 고릅니다 — 기본 위치 문서/Evident/OmniPC/Palette. 앱에 담아 두지 않고 앱을 닫을 때까지 모든 파일 보기에 씁니다(색 범위는 그대로)'
            }
            onClick={props.onLoadPalette}
          >
            색표 불러오기…
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!pl.paletteFileName}
            title="불러온 색표를 빼고 파일 색표로 칠합니다 — 다른 파일 보기에서도 빠집니다 (색 범위·진폭 축은 그대로)"
            onClick={() => dispatch({ type: 'setPaletteFile', file: null })}
          >
            파일 색표로 되돌리기
          </button>
          {pl.paletteBlocked ? <span className="viewer__tools-group unit truncate" title={pl.paletteBlocked}>2인 블라인드 판독 — 색표 불러오기 막음</span> : null}
          {pl.paletteNote ? <span className="viewer__tools-group unit truncate" title={pl.paletteNote}>{pl.paletteNote}</span> : null}
        </>
      ) : (
        <>
          <RangePair label="색 범위" range={[pl.minPct, pl.maxPct]} unit="%" onCommit={(r) => dispatch({ type: 'setPalette', minPct: r[0], maxPct: r[1] })} />
          <Sep />
          <span className="viewer__tools-group unit">A-scan 진폭 축</span>
          <SubSeg
            label="진폭 축 상한"
            value={String(pl.ampAxisMaxPct)}
            options={[
              { id: '100', name: '100 %' },
              { id: '200', name: `${pl.fullScalePct ?? 200} %` }
            ]}
            onChange={(v) => dispatch({ type: 'setAmpAxis', groupId, maxPct: v === '200' ? 200 : 100 })}
          />
          <Sep />
          <label className="check viewer__check" title={levelTitle}>
            <input type="checkbox" checked={lv.on && lv.available} disabled={!lv.available} onChange={(e) => props.onLevelLines(e.target.checked)} />
            <span>A-scan 기준선</span>
          </label>
        </>
      )
    canReset = pl.minPct !== 0 || pl.maxPct !== 100 || pl.ampAxisMaxPct !== 100 || pl.paletteFileName !== null
    reset = () => dispatch({ type: 'resetPalette', groupId })
  } else if (tab === 'export') {
    const ex = props.exportTools
    const r = ex.result
    const base = r ? r.path.split(/[\\/]/).pop() ?? r.path : null
    row = (
      <>
        <span
          className="viewer__tools-group unit"
          title={`게이트 A C-scan 의 최대 진폭 %FSH (소수 둘째 자리). 게이트 값은 ${ex.adjusted ? '조정 패널에서 바꾼 값' : '파일 값'}, 진폭은 파일 값(소프트 이득 Δ 는 넣지 않음)`}
        >
          {ex.gateText ?? '게이트 없음'}
          {ex.adjusted ? ' (조정값)' : ''}
          {ex.thresholdUnknown ? ' · 문턱 모름 — Gate Level 칸이 빔' : ''}
          {Math.abs(ex.gainDeltaDb) >= 0.05 ? ' · 진폭은 파일 값(이득 Δ 미포함)' : ''}
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={ex.busy || !ex.gateText}
          title="OmniPC 'Export C-scan' 과 같은 꼴(.txt — 머리말 21줄·탭·CRLF, 줄 = 인덱스 끝 → 처음)로 저장합니다. 저장 위치를 고르는 창이 열립니다(저장소 폴더 안에는 쓰지 않음)"
          onClick={props.onExport}
        >
          {ex.busy ? '내보내는 중…' : 'C-scan 내보내기 (OmniPC txt)…'}
        </button>
        {r ? (
          <>
            {r.unconfirmed.length ? (
              <Status tone="attention" title={`OmniPC 내보내기 파일로 아직 확인하지 못한 칸: ${r.unconfirmed.join(' · ')} (캡처 14 덧붙임 뒤 지움)`}>
                대조 전
              </Status>
            ) : null}
            <span className="viewer__tools-group unit truncate viewer__export-result" title={`${r.path}${r.unconfirmed.length ? ` — 대조 전: ${r.unconfirmed.join(' · ')}` : ''}`}>
              저장함: {base} · {r.groupName} · 스캔 {r.scanCount} × 인덱스 {r.indexCount}
            </span>
          </>
        ) : ex.error ? (
          <span className="viewer__tools-group truncate status status--error" title={ex.error}>
            {ex.error}
          </span>
        ) : null}
      </>
    )
  } else if (tab === 'gate' && props.gate) {
    const g = props.gate
    const unitLabel = g.values.geometry === 'TrueDepth' ? '깊이' : '음로'
    const fileTip = `파일값: ${unitLabel} 시작 ${fmt(g.file.startMm, 2)} mm · 폭 ${fmt(g.file.lengthMm, 2)} mm · 빔 0 기준 ${fmt(g.fileStartUs, 3)}~${fmt(g.fileEndUs, 3)} µs`
    row = (
      <>
        <span className="viewer__tools-group unit" title={`${g.values.geometry === 'TrueDepth' ? 'True Depth' : 'Sound Path'} 게이트`}>
          {g.name.replace(/^gate\s*/i, '게이트 ')} · {unitLabel}
        </span>
        {g.fileDisabled ? (
          <span className="viewer__tools-group unit" title="파일 설정에서 이 게이트가 장비에서 꺼진 채 저장되어 있습니다. C-scan·측정값은 파일 게이트 창으로 그대로 계산합니다(OmniPC 대조 전)">
            장비에서 꺼짐
          </span>
        ) : null}
        <NumField label="시작" value={g.values.startMm} unit="mm" title={fileTip} onCommit={(v) => dispatch({ type: 'setGate', groupId, gateId: g.gateId, patch: { startMm: v }, unitMax: g.unitMax })} />
        <NumField label="폭" value={g.values.lengthMm} unit="mm" title={fileTip} onCommit={(v) => dispatch({ type: 'setGate', groupId, gateId: g.gateId, patch: { lengthMm: v }, unitMax: g.unitMax })} />
        <NumField
          label="문턱"
          value={g.thresholdPct ?? 0}
          unit="%"
          digits={1}
          title="게이트 안 최대가 이 값 미만이면 위치 읽기값은 ND. 문턱만 바꾸면 C-scan 은 다시 계산하지 않는다"
          onCommit={(v) => dispatch({ type: 'setGate', groupId, gateId: g.gateId, patch: { thresholdPct: v }, unitMax: g.unitMax })}
        />
        {g.thresholdUnknown ? (
          <span className="viewer__tools-group unit" title="게이트 문턱 % 를 파일에서 찾지 못했습니다. 값을 넣기 전에는 ND 판정을 하지 않습니다">
            문턱 모름
          </span>
        ) : null}
        {g.others.length ? (
          <>
            <Sep />
            <span className="viewer__tools-group unit" title="1차에서는 C-scan 게이트(A)만 편집합니다. '(꺼짐)' = 파일 설정에서 장비에서 끈 게이트">
              {g.others.join(' · ')}: C-scan 게이트 아님
            </span>
          </>
        ) : null}
      </>
    )
    canReset = !g.isDefault
    reset = () => dispatch({ type: 'resetGate', groupId, gateId: g.gateId })
  } else {
    const views: Array<{ id: RangeView; name: string }> = [
      { id: 'cscan', name: 'C-scan' },
      { id: 'ascan', name: 'A-scan' },
      ...(props.hasBscan ? [{ id: 'bscan' as const, name: 'B-scan' }] : [])
    ]
    const view = views.some((v) => v.id === props.view) ? props.view : 'cscan'
    sub = <SubSeg label="범위 뷰" value={view} options={views} onChange={props.onView} />
    if (view === 'cscan') {
      row = (
        <>
          <RangePair label="스캔" range={t.scan.range} unit="mm" onCommit={(r) => dispatch({ type: 'setScanRange', range: r, limits: t.scan.limits })} />
          <Sep />
          <label className="check viewer__check">
            <input type="checkbox" checked={t.reversed} onChange={(e) => dispatch({ type: 'setCscanReversed', value: e.target.checked, fileValue: t.fileReversed })} />
            <span>첫 {t.spatialAxis ? '위치' : '빔'}({t.firstBeamName})이 아래</span>
          </label>
        </>
      )
      canReset = !t.scan.isDefault || !t.reversedIsDefault
      reset = () => dispatch({ type: 'resetScan' })
    } else if (view === 'ascan') {
      row = <RangePair label="깊이" range={t.ascan.range} unit="mm" onCommit={(r) => dispatch({ type: 'setAscanRange', groupId, range: r, limits: t.ascan.limits })} />
      canReset = !t.ascan.isDefault
      reset = () => dispatch({ type: 'setAscanRange', groupId, range: null, limits: t.ascan.limits })
    } else {
      row = <RangePair label="깊이" range={t.bscan.range} unit="mm" onCommit={(r) => dispatch({ type: 'setBscanRange', groupId, range: r, limits: t.bscan.limits })} />
      canReset = !t.bscan.isDefault
      reset = () => dispatch({ type: 'setBscanRange', groupId, range: null, limits: t.bscan.limits })
    }
  }
  return (
    <div className="viewer__tools" role="group" aria-label="조정" id="viewer-tools">
      <SubSeg label="조정 항목" value={tab} options={tabs} onChange={props.onTab} />
      {sub}
      <span className="viewer__tools-group unit">{props.groupName}</span>
      {row}
      <span className="toolbar__spacer" />
      {/* 머리글의 '파일값으로'(전부) 와 헷갈리지 않게 항목 이름을 붙인다. 내보내기 탭은 되돌릴 조정이 없다 */}
      {reset ? (
        <button type="button" className="btn btn--ghost" disabled={!canReset} title={`${tabs.find((t) => t.id === tab)?.name ?? ''} 조정만 되돌립니다 (전부는 머리글의 '파일값으로')`} onClick={() => reset?.()}>
          {tabs.find((t) => t.id === tab)?.name} {tab === 'gate' || tab === 'gain' ? '파일값으로' : '초기화'}
        </button>
      ) : null}
    </div>
  )
}
