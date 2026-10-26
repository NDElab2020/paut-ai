/**
 * NDE 이미지 보기 (OmniPC 6.6 A-C-S 배치). 앱 틀(모듈·사이드바)과 떼어 두어 나중에 별도 창·라벨링 화면에서 그대로 쓴다.
 *   왼쪽 A-scan(현재 그룹) · 위 S-scan(그룹마다) · 아래 C-scan(그룹마다), 아래 줄 측정값.
 *   커서: 스캔 위치(mm)는 모든 그룹이 함께, 빔은 그룹마다. 클릭한 패널의 그룹이 '현재 그룹'.
 *   키: ←/→ 스캔 1칸 (Shift 10칸), ↑/↓ 현재 그룹 빔, G 다음 그룹(Shift+G 이전, 그룹이 여럿 보일 때).
 * 후처리(계획_후처리.md): 범위(C/B-scan 스캔, A/B-scan 깊이, C-scan 세로축(각도·빔 번호) 방향 — S-scan 범위는 사용자 지시로 화면에서 뺌)는 PostProcess(postState) 에,
 *   현재 커서·레이아웃·그룹 모드는 여기 useState 에 (저장하지 않음). 조정값이 없으면 지금과 같은 그림.
 *   키: 휠 확대·Shift+휠 이동, Z 범위 초기화(Shift+Z 모두), Ctrl/Cmd+Z 되돌리기.
 * 라벨 모드(계획_라벨링 1b, 상태 = labeling/state.ts 순수 리듀서): 도구막대 '라벨'·L 키로 켜고 끈다. 켜면
 *   영상 위 라벨 덮개(viewer/overlay.ts), S-scan 확대(후처리 모델 sscanDepthMm·sscanV — 휠·눈금자 끌기·Z), 도구별 조작
 *   (1 점: S-scan 클릭 = 점·끌기 = 사각형 · 2 사각형 · 3 길이: C/B-scan 끌기 = 기준 커서 R + 현재 커서 = S(m−r)(스캔축 — OmniPC 의 U 는 초음파축) · 4 검토 구간: C/B-scan 끌기),
 *   A-scan 클릭·끌기 = 시간(깊이) 커서, R = 지금 커서를 기준 커서로(Shift+R 지움), N = 지금 커서의 게이트 최대 점, Delete = 고른 점 지우기,
 *   오른쪽 라벨 패널 열(labeling/LabelSide·LabelPanel, 접기 가능)이 붙는다. 끄면 덮개·확대·라벨 조작이 모두 빠져 그림은 보통 모드와 바이트 단위로 같다.
 *   Ctrl/Cmd+Z 는 라벨 모드에서 후처리·라벨 초안 가운데 마지막에 고친 쪽부터 (pickUndo), 보통 모드는 후처리만 (지금과 같음).
 *   T = A-scan 시간 커서 깊이를 지금 찍을 점으로, N = 지금 칸 ± 2 칸·± 2 빔의 게이트 최대 (찾은 칸으로 커서를 옮김),
 *   S-scan 클릭으로 찍는 '최대 진폭' 점은 ± 1 빔·± 1.5 mm 안 국소 최대로 붙인다.
 *   라벨 덮개는 영상 위 따로 겹친 캔버스(.vplot__overlay)에 그려, 덮개만 바뀔 때 영상을 다시 칠하지 않는다.
 *   작업 이벤트 세션(labeling/workSession)은 뷰어가 들고 있어 라벨 모드를 껐다 켜도 이어진다.
 * 검수 '영상으로 보기'(target·compare): 그 기록 칸으로 열고, 두 세트 비교 보기(ComparePanel, 읽기 전용 덮개)를 라벨 패널 자리에 띄운다.
 * OmniPC 조사 반영(2026-10-07, OmniPC_조사/조사_보고.md 6절 — 근거는 공개 설명서·사용자 파일·우리 데이터·캡처뿐):
 *   X9 도구막대 '◀ 이전 · 다음 ▶'·키 [ · ] = 같은 플랜 파일을 시편 → 이름 순서로(viewer/fileNav.ts, 라벨 모드면 다음 파일도 라벨 모드로),
 *   X3 A-scan 기준선(기록·평가 — 'Ref' 선은 그리지 않음, viewer/levelLines.ts, 조정 패널 색표 탭, 라벨 모드 기본 켬·보통 모드 기본 끔),
 *   L2 OmniPC 색표(.pal) 불러오기·되돌리기(후처리 paletteFile — 세션), X8 C-scan 내보내기(조정 패널 '내보내기' 탭, viewer:exportCscan),
 *   L1 측정값 줄 툴팁 = 공개 설명서 정의(shared/imaging/readings.ts)·파일에 저장된 측정값 목록, X2·X7·L4·L5·L6 = 경고 줄(파일 설정·게이트·출처).
 *   새 표시는 모두 켤 때만 또는 영상 밖 — 보통 모드 영상은 바이트 그대로.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ViewerCscanExportResult, ViewerOpenResult } from '@shared/api'
import { gateReadingLabel, readingByLabel, readingLabel, readingTooltip } from '@shared/imaging/readings'
import {
  MIN_DEPTH_SPAN_MM,
  MIN_SCAN_CELLS,
  DEG,
  MIN_V_SPAN_MM,
  VIEWER_NO_DATA_SPECIAL_INDEX,
  adjustedParts,
  applyGateOverride,
  ascanDepthRange,
  autoGainDb,
  beamNumber,
  beamPoint,
  clampRange,
  cscanBeamAxis,
  findGate,
  gainedScale,
  gateDisplayValues,
  foldDepth,
  GATE_MIN_LENGTH_MM,
  gatePeakAt,
  groupPostOf,
  hexToRgb,
  isDefaultPost,
  paletteRgb,
  postPaletteOf,
  rangeEquals,
  rawToPercent,
  remapPalette,
  remapPaletteHex,
  sampleAtDepth,
  saturatedPercent,
  scanAxisFull,
  scanIndexAt,
  scanPositionMm,
  scanWindowOf,
  sscanExtent,
  sscanLookupAt,
  sscanLookupBeamSample,
  type GateCscan,
  type GateDisplayValues,
  type GateEdge,
  type GateOverride,
  type InspectionPoint,
  type MmRange,
  type RangeLimits,
  type ViewKind,
  type ViewViewport,
  type ViewerGate,
  type AmplitudeScale,
  type ViewerFormatFamily,
  type ViewerGroup,
  type ViewerTechnique
} from '@shared/imaging'
import { amplitudeFromVolume, type GroupAmplitude } from '@shared/labels'
import { getApi, toUiError, unwrap, type UiError } from '../api'
import { EmptyState } from '../components/EmptyState'
import { ErrorNotice } from '../components/ErrorNotice'
import { Icon } from '../components/Icon'
import { Status } from '../components/Status'
import { num } from '../lib/format'
import { useApp } from '../state/AppContext'
import { useAsync } from '../lib/useAsync'
import { ComparePanel } from '../labeling/ComparePanel'
import { LabelPanel } from '../labeling/LabelPanel'
import { LabelSide } from '../labeling/LabelSide'
import { defaultSetChoice, resolveSet } from '../labeling/labelSet'
import { draftOverlays } from '../labeling/overlays'
import { ascanDepthReading, regionPeakReading, sscanPointReading, type PointReading } from '../labeling/reading'
import { labelSessionGet, labelSessionSet, panelSessionGet, readLabelPanelOpen, writeLabelPanelOpen } from '../labeling/session'
import {
  LABEL_TOOLS,
  initialLabelState,
  isHistoryEdit,
  labelGestures,
  labelReducer,
  lengthFromRef,
  pickUndo,
  postWithoutSscanZoom,
  pushUndoSource,
  type UndoSource
} from '../labeling/state'
import { createValueStore } from '../labeling/store'
import type { LabelCompare, LabelGotoTarget, LabelGroupSource, LabelViewOverlays } from '../labeling/types'
import { useWorkSession } from '../labeling/workSession'
import '../labeling/labeling.css'
import { AscanView } from './AscanView'
import type { AxisInteraction, AxisMarker } from './Axis'
import { BscanView } from './BscanView'
import { CscanView, type ScanMarking } from './CscanView'
import { SscanView, type SscanGateEdit, type SscanMarking, type SscanRange } from './SscanView'
import type { FileRecord } from '@shared/types'
import { ToolsPanel, type ExportTools, type GainTools, type GateTools, type PaletteTools, type PaletteView, type RangeTools, type RangeView, type ToolsTab } from './ToolsPanel'
import { isUndoShortcut, labelOverlayColors, overlayColors } from './canvas'
import { fileNavOf, type FileNav } from './fileNav'
import { KeysHint } from './KeysHint'
import { ascanLevelsOf, levelLinePrefs, levelLinesOn, setLevelLinesOn } from './levelLines'
import './viewer.css'
import { mergeOverlays, type ViewOverlay } from './overlay'
import { derivedCscan, sessionPaletteFile, setSessionPaletteFile, usePostProcess } from './postState'
import { cachedVolume, isVolumeLoadAborted, loadVolume, type GroupVolume } from './volumeStore'
import { PaintbrushNote, PaintbrushPointReadout, ViewerChannelReadout, firstChannelName, viewerChannelText } from './channelDisplay'

type Mode = 'all' | number
/** ACS = X3 화면(A·S·C, 그룹 여러 개), ABCS = A·B·C·S 한 그룹 (B-scan 은 OmniPC 대조 전) */
type Layout = 'ACS' | 'ABCS'

const LAYOUTS: Array<{ id: Layout; name: string; title: string }> = [
  { id: 'ACS', name: 'A-C-S', title: 'A-scan · S-scan · C-scan (그룹 모두 가능)' },
  { id: 'ABCS', name: 'A-B-C-S', title: 'A-scan · B-scan · C-scan · S-scan (한 그룹). B-scan 은 OmniPC 화면과 아직 대조 전' }
]

/** '대조 전' 표시에 쓰는 기법 이름 */
const TECHNIQUE_NAME: Partial<Record<ViewerTechnique, string>> = { 'pa-sectorial': '섹토리얼', 'pa-linear': '리니어', 'pa-compound': '컴파운드' }

/**
 * 대조 전 표시 이름: NDE 는 (형식, 기법) 'NDE 4.x 섹토리얼', OPD 는 (기법, 스큐) 'OPD 섹토리얼 · 스큐 90'
 * (OPD 는 스큐 270 의 출사점 V 부호가 추정이라 스큐마다 대조한다 — core/nde/viewer/meta.ts VERIFIED)
 */
/** A-scan 진폭 축 상한: '200 %'(전체)를 고르면 진폭 눈금 상한이 200 보다 큰 형식(OPD 250 % 추정)은 그 상한으로 — 포화 봉우리가 잘리지 않게 */
function axisMaxOf(choice: 100 | 200, unitMax: number): number {
  return choice === 200 && unitMax > 200 ? unitMax : choice
}

function unverifiedKindName(formatFamily: ViewerFormatFamily, g: ViewerGroup): string {
  if (g.storageMode === 'Paintbrush') return `NDE ${formatFamily} Paintbrush`
  const tech = TECHNIQUE_NAME[g.technique] ?? g.technique
  if (formatFamily !== 'opd') return `NDE ${formatFamily} ${tech}`
  const skew = g.beams[0]?.skewDeg
  return skew === undefined ? `OPD ${tech}` : `OPD ${tech} · 스큐 ${Math.round(skew)}`
}

/** 빔을 굴절각이 아니라 번호로 부르는 그룹인가 (리니어 등 각도가 모두 같은 그룹 — C-scan 축과 같은 판정) */
function byBeamNumber(g: ViewerGroup): boolean {
  return cscanBeamAxis(g).kind === 'beam'
}

/** 패널 제목의 빔 이름: 섹토리얼·컴파운드 = 굴절각('54.0°', 지금까지와 같음), 리니어 = '빔 12 · 60°' (각도만으로는 빔을 구별할 수 없다) */
function beamText(g: ViewerGroup, b: number): string {
  return viewerChannelText(g, b)
}

/** 볼 수 없는 그룹 한 줄: 이유가 이미 그룹 이름으로 시작하면('ToFD: ToFD 그룹은…') 이름을 겹쳐 쓰지 않는다 */
function reasonText(g: { name: string; reason: string | null }): string {
  const r = g.reason ?? '이유 모름'
  return r.startsWith(g.name) ? r : `${g.name}: ${r}`
}

/**
 * '◀ n/N ▶' — 같은 플랜 파일 (시편 → 이름 순서). 끝에서는 그쪽 단추가 꺼진다.
 * 보통 모드 도구막대는 한 줄(줄바꿈 없음 — 영상 크기가 칩에 따라 흔들리지 않게)이라 글자 없는 화살표로 좁게 둔다. 이름은 aria-label·툴팁에
 */
function FileNavButtons({ nav, onGo }: { nav: FileNav<FileRecord>; onGo: (d: -1 | 1) => void }) {
  return (
    <div className="viewer__filenav" role="group" aria-label={`같은 플랜 파일 ${nav.index + 1} / ${nav.files.length}`}>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={!nav.prev}
        aria-label="이전 파일"
        title={nav.prev ? `이전 파일 ([) — ${nav.prev.specimenId} · ${nav.prev.storedFileName} (${nav.index} / ${nav.files.length})` : '처음 파일입니다'}
        onClick={() => onGo(-1)}
      >
        ◀
      </button>
      <span className="viewer__filenav-pos num" aria-hidden="true">
        {nav.index + 1}/{nav.files.length}
      </span>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={!nav.next}
        aria-label="다음 파일"
        title={nav.next ? `다음 파일 (]) — ${nav.next.specimenId} · ${nav.next.storedFileName} (${nav.index + 2} / ${nav.files.length})` : '마지막 파일입니다'}
        onClick={() => onGo(1)}
      >
        ▶
      </button>
    </div>
  )
}

/**
 * [ · ] = 이전·다음 파일 (한글 입력 상태에서도 되도록 code, 수정키 없이). 처리했으면 true.
 * 입력란과 라벨 패널(.label-side — 양식 단추·라디오·지시 표 행) 안에 포커스가 있으면 받지 않는다(패널에서 일하다 파일이 넘어가지 않게)
 */
function navKey(e: KeyboardEvent<HTMLDivElement>, go: (d: -1 | 1, label: boolean) => void, enabled: boolean, label = false): boolean {
  if (!enabled || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return false
  if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"], .label-side')) return false
  go(e.code === 'BracketLeft' ? -1 : 1, label)
  e.preventDefault()
  return true
}

function Header(props: { title: string; meta?: string; onBack: () => void; backLabel?: string; children?: ReactNode }) {
  const back = props.backLabel ?? '스캔플랜별 데이터로'
  return (
    <div className="viewer__bar">
      {/* 좁은 창(app.css 1440 px 이하)에서는 '뒤로' 만 보인다 — 보통 모드 도구막대가 한 줄을 넘쳐 가로 스크롤이 생기지 않게. 이름은 툴팁·화면 읽기에 그대로 */}
      <button type="button" className="btn btn--ghost viewer__back" title={back} aria-label={back} onClick={props.onBack}>
        <Icon name="chevron-left" />
        <span className="viewer__back-long" aria-hidden="true">
          {back}
        </span>
        <span className="viewer__back-short" aria-hidden="true">
          뒤로
        </span>
      </button>
      <h1 className="page-header__title viewer__title truncate" title={props.title}>
        {props.title}
      </h1>
      {props.meta ? <span className="viewer__meta">{props.meta}</span> : null}
      {props.children}
    </div>
  )
}

/** 한 줄 버튼 묶음 (라디오 그룹): 선택된 것만 Tab 으로 들어가고 ←/→ 로 고른다 */
function Seg<T extends string | number>(props: {
  label: string
  value: T
  /** disabled = 지금 고를 수 없는 칸 (A-B-C-S 의 '모두' — 한 그룹만 그림). ←/→ 도 건너뛴다 */
  options: ReadonlyArray<{ id: T; name: string; title?: string; disabled?: boolean }>
  onChange: (id: T) => void
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    // 영상 키(스캔·빔 이동)로 넘기지 않는다
    e.preventDefault()
    e.stopPropagation()
    const n = props.options.length
    const i = Math.max(0, props.options.findIndex((o) => o.id === props.value))
    let j = i
    for (let step = 0; step < n; step++) {
      j = (j + d + n) % n
      if (!props.options[j]!.disabled) break
    }
    if (j === i || props.options[j]!.disabled) return
    props.onChange(props.options[j]!.id)
    refs.current[j]?.focus()
  }
  return (
    <div className="seg" role="radiogroup" aria-label={props.label} onKeyDown={onKeyDown}>
      {props.options.map((o, i) => (
        <button
          key={String(o.id)}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={props.value === o.id}
          tabIndex={props.value === o.id ? 0 : -1}
          className="seg__item"
          title={o.title}
          disabled={o.disabled}
          onClick={() => props.onChange(o.id)}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

/** 열 때 갈 곳 (검수 '영상으로 보기' — 그 기록의 최대 진폭 칸) */
export interface ViewerTarget {
  scanMm: number
  groupId?: number
  beam?: number
  recordUuid?: string
}

export function NdeViewer({
  fileId,
  onBack,
  backLabel,
  target = null,
  compare = null,
  onOpenFile,
  startInLabelMode = false
}: {
  fileId: number
  onBack: () => void
  /** 뒤로 가기 글자 (기본 '스캔플랜별 데이터로') */
  backLabel?: string
  target?: ViewerTarget | null
  compare?: LabelCompare | null
  /** 같은 플랜의 다른 파일 열기 ('◀ 이전 · 다음 ▶'·[ ]). 없으면 단추를 두지 않는다. label = 지금 라벨 모드인가 */
  onOpenFile?: (fileId: number, opts: { label: boolean }) => void
  /** 라벨 모드로 열기 (라벨 모드에서 이전·다음 파일로 넘어올 때 — 그 파일의 라벨 세션은 이어서) */
  startInLabelMode?: boolean
}) {
  const api = getApi()
  const opened = useAsync(() => unwrap(api.viewer.open(fileId)), [fileId])
  const title = opened.data?.file.storedFileName ?? '이미지 보기'
  // 같은 플랜의 이전·다음 파일 (X9, viewer/fileNav.ts — 시편 → 파일 이름 순) — 볼 수 없는 파일 화면에서도 넘어갈 수 있게 바깥에서 받는다
  const openedFile = opened.data?.file ?? null
  const siblings = useAsync(
    () => (onOpenFile && openedFile ? unwrap(api.files.list({ planId: openedFile.planId, limit: 1000, sort: 'fileName-asc' })) : Promise.resolve(null)),
    [api, !!onOpenFile, openedFile?.planId]
  )
  const navAll = siblings.data && openedFile ? fileNavOf(siblings.data.items, openedFile) : null
  const nav = navAll && navAll.index >= 0 && navAll.files.length > 1 ? navAll : null
  const goFile = useCallback(
    (d: -1 | 1, label: boolean): void => {
      const t = d < 0 ? nav?.prev : nav?.next
      if (t && onOpenFile) onOpenFile(t.id, { label })
    },
    [nav, onOpenFile]
  )
  // 볼 수 없는 파일 화면: 라벨 모드로 넘어온 파일이면 다음 파일도 라벨 모드로 (볼 수 없는 파일을 거쳐도 라벨 모드가 이어지게)
  const navButtons = nav ? <FileNavButtons nav={nav} onGo={(d) => goFile(d, startInLabelMode)} /> : null
  // 부모가 다시 그려져도(진행률·테마 등) 같은 배열을 넘겨 S-scan 다시 그리기·진폭 읽기 재시작을 막는다
  const supported = useMemo(() => opened.data?.info.groups.filter((g) => g.supported) ?? [], [opened.data])

  if (opened.error) {
    return (
      <div className="viewer">
        <Header title={title} onBack={onBack} backLabel={backLabel} />
        <ErrorNotice title="파일을 열지 못했습니다" error={opened.error} onRetry={opened.reload} />
      </div>
    )
  }
  if (!opened.data) {
    return (
      <div className="viewer">
        <Header title={title} onBack={onBack} backLabel={backLabel} />
        <p className="text-subtle loading-line">파일을 여는 중입니다.</p>
      </div>
    )
  }
  if (supported.length === 0) {
    return (
      <div className="viewer" tabIndex={-1} onKeyDown={(e) => navKey(e, goFile, !!nav, startInLabelMode)}>
        <Header title={title} onBack={onBack} backLabel={backLabel}>
          {navButtons}
        </Header>
        <EmptyState
          title="이 파일은 아직 이미지로 볼 수 없습니다"
          desc={
            <>
              {opened.data.info.groups.map((g) => (
                <span key={g.id} className="viewer__reason">
                  {reasonText(g)}
                </span>
              ))}
            </>
          }
        />
      </div>
    )
  }
  return (
    <ViewerBody
      key={opened.data.key}
      opened={opened.data}
      supported={supported}
      onBack={onBack}
      backLabel={backLabel}
      target={target}
      compare={compare}
      nav={nav}
      onGoFile={goFile}
      startInLabelMode={startInLabelMode}
    />
  )
}

/** 창을 기준 안으로 맞춘 값과 '기본값인가' */
function effectiveRange(r: MmRange | null, limits: RangeLimits): { range: MmRange; isDefault: boolean } {
  if (r === null) return { range: limits.full, isDefault: true }
  const c = clampRange(r, limits)
  return { range: c, isDefault: rangeEquals(c, limits.full) }
}

function ViewerBody({
  opened,
  supported,
  onBack,
  backLabel,
  target,
  compare,
  nav,
  onGoFile,
  startInLabelMode
}: {
  opened: ViewerOpenResult
  supported: ViewerGroup[]
  onBack: () => void
  backLabel?: string
  target: ViewerTarget | null
  compare: LabelCompare | null
  /** 같은 플랜 파일 (둘 이상일 때만, 아니면 null) */
  nav: FileNav<FileRecord> | null
  onGoFile: (d: -1 | 1, label: boolean) => void
  startInLabelMode: boolean
}) {
  const api = getApi()
  const { info, file, key } = opened
  // 파일 화면 상태가 Single 이면 저장된 현재 그룹 하나, 아니면 모두 (OmniPC Single/Multiple)
  const savedGroup = supported.find((g) => g.id === info.display.currentGroupId) ?? null
  // 검수에서 그 기록 칸으로 열 때 (target): 그 그룹이 보이게·그 빔·그 스캔 칸
  const targetGroup = target?.groupId !== undefined ? (supported.find((g) => g.id === target.groupId) ?? null) : null
  const [mode, setMode] = useState<Mode>(() => {
    const m: Mode = supported.length > 1 && !(info.display.layoutGroupMode === 'Single' && savedGroup) ? 'all' : (savedGroup ?? supported[0]!).id
    return targetGroup && m !== 'all' && m !== targetGroup.id ? targetGroup.id : m
  })
  // 파일에 저장된 레이아웃 이름: 'ABCS'(한 그룹 A·B·C·S) → A-B-C-S. 'MultiACS'·'MultiABC' 처럼 여러 그룹 레이아웃은
  // 그룹을 다 보여 주는 A-C-S 로 연다 (우리 A-B-C-S 는 한 그룹만 그리므로)
  const savedLayout = info.display.layout ?? ''
  const [layout, setLayout] = useState<Layout>(/ABC/.test(savedLayout) && !/^Multi/i.test(savedLayout) && !/ACS/.test(savedLayout) ? 'ABCS' : 'ACS')
  const [activeId, setActiveId] = useState<number>((targetGroup ?? savedGroup ?? supported[0]!).id)
  // A-B-C-S 는 한 그룹만 (OmniPC 와 같음): '모두' 여도 현재 그룹. A-C-S 는 현재 그룹과 관계없다
  const abcsId = layout === 'ABCS' ? (mode === 'all' ? activeId : mode) : null
  const shown = useMemo(
    () => (abcsId !== null ? supported.filter((g) => g.id === abcsId) : mode === 'all' ? supported : supported.filter((g) => g.id === mode)),
    [supported, abcsId, mode]
  )
  const shownKey = shown.map((g) => g.id).join(',')
  const active = shown.find((g) => g.id === activeId) ?? shown[0]!
  const [beams, setBeams] = useState<Record<number, number>>(() =>
    Object.fromEntries(supported.map((g) => [g.id, targetGroup && g.id === targetGroup.id && target?.beam !== undefined ? Math.min(g.shape[1] - 1, Math.max(0, target.beam)) : g.initialBeam]))
  )
  const [scanMm, setScanMm] = useState<number | null>(() => {
    if (!target) return null
    const g = targetGroup ?? savedGroup ?? supported[0]!
    return scanPositionMm(scanIndexAt(target.scanMm, g.scan), g.scan)
  })
  const [volumes, setVolumes] = useState<Record<number, GroupVolume>>(() => {
    const out: Record<number, GroupVolume> = {}
    for (const g of supported) {
      const v = cachedVolume(key, g.id)
      if (v) out[g.id] = v
    }
    return out
  })
  const [progress, setProgress] = useState<Record<number, number>>({})
  /** 그룹마다 읽기 오류 (실패한 그룹은 '읽는 중' 에서 뺀다) */
  const [loadErrors, setLoadErrors] = useState<Record<number, UiError>>({})
  const [retry, setRetry] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // 2인 블라인드 판독 (settings.labelBlindMode — 라벨 세션 값으로도 확인): 두 판독자 화면을 같게 하려고 색표 불러오기를 막고 세션 색표도 쓰지 않는다
  const { settings } = useApp()
  const labelSession = useAsync(() => unwrap(api.labels.session()), [api])
  const blindMode = (settings?.labelBlindMode ?? false) || (labelSession.data?.blindMode ?? false)
  // 후처리 상태 (세션 캐시 → 기본값, 세션 색표는 열 때 넣음). 현재 커서는 여기 들어가지 않는다
  const [postState, dispatchPost] = usePostProcess(key, supported, blindMode ? null : sessionPaletteFile())
  const post = postState.post
  // 이 파일 보기에서 색표를 불러오거나 뺀 것(되돌리기·초기화·파일값으로 포함)을 세션 색표로 — 다음 파일 보기도 같은 색표 (블라인드면 비움)
  const postPaletteFile = post.paletteFile ?? null
  useEffect(() => setSessionPaletteFile(blindMode ? null : postPaletteFile), [postPaletteFile, blindMode])
  // 블라인드 모드가 늦게 알려지면(라벨 세션을 읽은 뒤) 이미 칠한 불러온 색표를 뺀다
  useEffect(() => {
    if (blindMode && postPaletteFile) dispatchPost({ type: 'setPaletteFile', file: null })
  }, [blindMode, postPaletteFile])
  // 라벨 모드 상태 (세션 보관 → 기본값). 모드·도구·초안 — 순수 리듀서 labeling/state.ts
  const [labelState, dispatchLabel] = useReducer(labelReducer, key, (k: string) => {
    // 라벨 모드에서 '◀ 이전 · 다음 ▶' 으로 온 파일은 라벨 모드로 — 이 파일의 라벨 세션(초안·도구·패널)이 있으면 그것을 이어서
    const s0 = labelSessionGet(k) ?? initialLabelState(readLabelPanelOpen())
    return startInLabelMode && !s0.ui.on ? { ...s0, ui: { ...s0.ui, on: true } } : s0
  })
  useEffect(() => labelSessionSet(key, labelState), [key, labelState])
  const panelOpen = labelState.ui.panelOpen
  useEffect(() => writeLabelPanelOpen(panelOpen), [panelOpen])
  const labelOn = labelState.ui.on
  const gestures = labelGestures(labelState.ui)
  // '조정됨'·'파일값으로' 는 S-scan 확대를 빼고 판단한다 — 확대는 라벨 모드의 보기(따로 '확대' 표시와 Z 초기화)라
  // 확대만으로 '파일값으로'(게이트·이득까지 되돌림)가 생기지 않게. 보통 모드는 지금과 같다
  const postShown = postWithoutSscanZoom(post)
  const postIsDefault = isDefaultPost(postShown)
  const sscanZoomed = labelOn && postShown !== post

  // ── 검수 비교 보기 (검수 '영상으로 보기'에서 연 두 세트) ──
  const [compareView, setCompareView] = useState<LabelCompare | null>(compare)
  const compareKey = compare ? JSON.stringify(compare) : ''
  useEffect(() => {
    setCompareView(compare)
    // 덮개는 라벨 모드에서만 보이므로 비교 보기를 열면 라벨 모드를 켠다
    if (compare) dispatchLabel({ type: 'setMode', on: true })
  }, [compareKey])

  // ── 작업 이벤트 세션 (라벨 모드를 껐다 켜도 이어짐) ──
  const work = useWorkSession(file.storedFileName)
  // 뷰어를 열 때 이 라벨러가 이 파일에 이미 세트가 있으면 그 세트로 바로 시작한다 (보통 모드에서 C-scan 을 훑는 판독 시간도 셈)
  useEffect(() => {
    let alive = true
    const sha = file.meta.sha256
    void Promise.all([api.labels.session(), api.labels.listSets({ sha256: sha })]).then(([s, sets]) => {
      if (!alive || !s.ok || !sets.ok) return
      const choice = panelSessionGet(key)?.setChoice ?? defaultSetChoice(sets.data, sha, s.data.labelerId)
      const r = resolveSet(s.data, sha, choice, sets.data)
      if (r.ok && !r.isNew) work.setKey(r.key)
    })
    return () => {
      alive = false
    }
  }, [api, key, file.meta.sha256, work.setKey])
  // 되돌리기 순서 (후처리·라벨 초안 두 이력): 이력에 남는 고침이 생길 때마다 그 쪽을 적는다 (렌더와 무관하게 ref)
  const undoOrder = useRef<UndoSource[]>([])
  const prevPost = useRef(postState)
  useEffect(() => {
    const p = prevPost.current
    if (isHistoryEdit(p, p.post, postState, postState.post)) undoOrder.current = pushUndoSource(undoOrder.current, 'post')
    prevPost.current = postState
  }, [postState])
  const prevLabel = useRef(labelState)
  useEffect(() => {
    const p = prevLabel.current
    if (isHistoryEdit(p, p.draft, labelState, labelState.draft)) undoOrder.current = pushUndoSource(undoOrder.current, 'label')
    prevLabel.current = labelState
  }, [labelState])
  const undo = (): void => {
    const r = pickUndo(undoOrder.current, { post: postState.history.length > 0, label: labelState.history.length > 0 }, labelOn)
    undoOrder.current = r.order
    if (r.source === 'post') dispatchPost({ type: 'undo' })
    else if (r.source === 'label') dispatchLabel({ type: 'undo' })
  }
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsTab, setToolsTab] = useState<ToolsTab>('range')
  const [toolsView, setToolsView] = useState<RangeView>('cscan')
  const [paletteView, setPaletteView] = useState<PaletteView>('range')
  /**
   * 게이트 끌기(다이아몬드·S-scan 점선) 중의 값 — 선만 움직이고 C-scan 은 손을 뗄 때 다시 계산한다.
   * 초안은 끄는 그룹 id 와 묶는다: 누르는 순간 그 그룹을 활성으로 바꾸거나 끌던 중 G 로 그룹이 바뀌어도 다른 그룹에 붙지 않는다
   */
  const [gateDraft, setGateDraft] = useState<{ groupId: number; ov: GateOverride } | null>(null)
  const clearGateDraft = (groupId: number): void => setGateDraft((d) => (d && d.groupId === groupId ? null : d))
  // 끌던 그룹이 화면에서 빠지면(레이아웃·그룹 전환) 남은 초안을 버린다
  useEffect(() => {
    if (gateDraft && !shownKey.split(',').map(Number).includes(gateDraft.groupId)) setGateDraft(null)
  }, [gateDraft, shownKey])
  const reversed = post.cscanReversed ?? info.display.cscanReversed

  // 여는 중 화면의 제목(App 이 포커스를 둔 곳)이 사라지면 포커스가 body 로 떨어진다 → 이 화면 제목으로 되돌려 방향키가 바로 듣게
  useEffect(() => {
    const a = document.activeElement
    if (a && a !== document.body) return
    const t = rootRef.current?.querySelector<HTMLElement>('.page-header__title')
    if (t) {
      if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1')
      t.focus({ preventScroll: true })
    } else rootRef.current?.focus({ preventScroll: true })
  }, [])

  const showNav = !!nav

  // 영상 안 선 색은 테마를 따른다 (라이트 = 밝은 바탕, 다크 = OmniPC 처럼 검정 바탕)
  const { theme } = useApp()
  const colors = useMemo(() => overlayColors(theme), [theme])
  const labelStyles = useMemo(() => labelOverlayColors(theme), [theme])
  // 칠할 색표: 불러온 OmniPC 색표(L2, 후처리 paletteFile)가 있으면 그것, 없으면 파일 화면 상태의 배열 그대로 (보통 그림 바이트 그대로)
  const shownPal = postPaletteOf(post, info.display)
  const basePalette = shownPal.palette
  const baseSpecial = shownPal.specialColors
  const filePalette = useMemo(() => paletteRgb(basePalette), [basePalette])
  // 데이터 없음 칸 색: 뷰어 상수(VIEWER_NO_DATA_SPECIAL_INDEX — 지금 [2] 회색, 6.6 캡처 10·11 뒤에 정함). 학습 내보내기 상수와 따로 (X11)
  const noData = useMemo(() => hexToRgb(baseSpecial[VIEWER_NO_DATA_SPECIAL_INDEX] ?? '808080'), [baseSpecial])
  // 색표 범위(Zoom Palette): (0, 100) 이면 파일 색표 그대로
  const { minPct: palMin, maxPct: palMax } = post.palette
  const palette = useMemo(() => (palMin === 0 && palMax === 100 ? filePalette : remapPalette(filePalette, palMin, palMax)), [filePalette, palMin, palMax])
  const paletteHex = useMemo(() => (palMin === 0 && palMax === 100 ? basePalette : remapPaletteHex(basePalette, palMin, palMax)), [basePalette, palMin, palMax])
  /** 그룹별 진폭 변환 (소프트 이득 반영; 0 dB 면 파일 객체 그대로). 이득 값이 그대로면 같은 객체 — 뷰의 useMemo 가 다시 돌지 않게 */
  const gainKey = supported.map((g) => `${g.id}:${groupPostOf(post, g.id).gainDb}`).join(',')
  const scales = useMemo(() => {
    const m = new Map<number, AmplitudeScale>()
    for (const g of supported) m.set(g.id, gainedScale(g.ampScale, groupPostOf(post, g.id).gainDb))
    return m
    // post 전체가 아니라 이득 값 문자열(gainKey)에만 건다 — 범위·색표를 바꿔도 변환 객체가 바뀌지 않게
  }, [gainKey, supported])
  const scaleOf = useCallback((g: ViewerGroup) => scales.get(g.id) ?? g.ampScale, [scales])
  const anyGain = supported.some((g) => groupPostOf(post, g.id).gainDb !== 0)

  // 보이는 그룹의 진폭 읽기. 배열 대신 그룹 id 문자열로 걸어 같은 그룹이면 다시 돌지 않는다
  useEffect(() => {
    let alive = true
    const ids = new Set(shownKey.split(',').map(Number))
    const list = supported.filter((g) => ids.has(g.id))
    const releases: Array<() => void> = []
    setLoadErrors({})
    setProgress((p) => {
      const n = { ...p }
      for (const g of list) delete n[g.id]
      return n
    })
    for (const g of list) {
      if (volumes[g.id]) continue
      const load = loadVolume(api, key, file.id, g, (done, total) => alive && setProgress((p) => ({ ...p, [g.id]: done / total })))
      releases.push(load.release)
      load.promise.then(
        (v) => alive && setVolumes((m) => ({ ...m, [g.id]: v })),
        (e: unknown) => {
          if (alive && !isVolumeLoadAborted(e)) setLoadErrors((m) => ({ ...m, [g.id]: toUiError(e) }))
        }
      )
    }
    return () => {
      alive = false
      // 화면을 떠나면 구독을 놓는다 → 아무도 안 보면 다음 조각 전에 멈춘다
      for (const r of releases) r()
    }
    // volumes 는 일부러 빼서 읽기 완료로 다시 돌지 않게 한다
  }, [api, key, file.id, supported, shownKey, retry])

  // 첫 스캔 위치: 현재 그룹 C-scan 이 가장 센 곳 (계획 결정 8). 파일 게이트 기준이며 스캔 창은 바꾸지 않는다
  useEffect(() => {
    if (scanMm !== null) return
    const v = volumes[active.id]
    if (!v) return
    let best = -1
    let at = 0
    const cs = v.cscan
    if (cs) {
      for (let c = 0; c < cs.peakRaw.length; c++) {
        if (cs.peakSample[c]! >= 0 && cs.peakRaw[c]! > best) {
          best = cs.peakRaw[c]!
          at = Math.floor(c / cs.beamCount)
        }
      }
    }
    setScanMm(scanPositionMm(at, active.scan))
  }, [volumes, active, scanMm])

  const cursorMm = scanMm ?? active.scan.offsetMm
  const kOf = useCallback((g: ViewerGroup): number => scanIndexAt(cursorMm, g.scan), [cursorMm])
  const beamOf = (g: ViewerGroup): number => beams[g.id] ?? g.initialBeam

  // ── 범위(후처리) 기본 창과 클램프 기준 ──
  // S-scan: 깊이는 보이는 그룹 공통(부채꼴 합집합 + 2 %), V 는 그룹마다 (OmniPC 처럼 패널을 채움)
  const sscanDefaults = useMemo(() => {
    const ex = shown.map((g) => sscanExtent(g))
    const dMin = Math.min(...ex.map((e) => e.depthMinMm))
    const dMax = Math.max(...ex.map((e) => e.depthMaxMm))
    const dPad = (dMax - dMin) * 0.02
    const v: Record<number, MmRange> = {}
    shown.forEach((g, i) => {
      const e = ex[i]!
      const vPad = (e.vMaxMm - e.vMinMm) * 0.02
      v[g.id] = [e.vMinMm - vPad, e.vMaxMm + vPad]
    })
    const depth: MmRange = [Math.max(0, dMin - dPad), dMax + dPad]
    return { depth, v }
  }, [shown])
  // S-scan 범위 잘라 보기는 사용자 지시(2026-10-06)로 보통 모드 화면에서 뺌 → 항상 기본 창(부채꼴 전체 + 2 %).
  // 라벨 모드에서만 확대를 다시 켠다 (계획_라벨링 6절 결정 6 (가) — 팁을 찍으려면 확대가 필요): 깊이 = sscanDepthMm(뷰어 공통), V = 그룹별 sscanV
  const sscanDepthLimits = useMemo<RangeLimits>(() => ({ full: sscanDefaults.depth, minWidth: MIN_DEPTH_SPAN_MM }), [sscanDefaults])
  const sscanVLimitsOf = (g: ViewerGroup): RangeLimits => ({ full: sscanDefaults.v[g.id] ?? [0, 1], minWidth: MIN_V_SPAN_MM })
  const sscanZoom = gestures.sscanZoom
  const zoomDepth = sscanZoom ? post.sscanDepthMm : null
  const zoomVKey = sscanZoom ? shown.map((g) => `${g.id}:${groupPostOf(post, g.id).sscanV?.join('~') ?? ''}`).join(',') : ''
  const ranges = useMemo(() => {
    const out: Record<number, SscanRange> = {}
    const depth = zoomDepth ? clampRange(zoomDepth, sscanDepthLimits) : sscanDefaults.depth
    for (const g of shown) {
      const vDef = sscanDefaults.v[g.id] ?? [0, 1]
      const vZoom = sscanZoom ? groupPostOf(post, g.id).sscanV : null
      const v = vZoom ? clampRange(vZoom, { full: vDef, minWidth: MIN_V_SPAN_MM }) : vDef
      out[g.id] = { vMinMm: v[0], vMaxMm: v[1], depthMinMm: depth[0], depthMaxMm: depth[1] }
    }
    return out
    // post 전체가 아니라 확대 값(zoomDepth·zoomVKey)에만 건다 — 이득·게이트를 바꿔도 S-scan 창 객체가 바뀌지 않게
  }, [shown, sscanDefaults, sscanZoom, zoomDepth, zoomVKey, sscanDepthLimits])

  // C·B-scan 스캔 창: 뷰어 공통 mm → 그룹별 칸 범위. 그룹 격자와 안 겹치면 전체 + 안내
  const scanFull = useMemo<MmRange>(() => {
    const fulls = shown.map((g) => scanAxisFull(g.scan))
    return [Math.min(...fulls.map((f) => f[0])), Math.max(...fulls.map((f) => f[1]))]
  }, [shown])
  const scanLimits = useMemo<RangeLimits>(() => ({ full: scanFull, minWidth: MIN_SCAN_CELLS * active.scan.resolutionMm }), [scanFull, active.scan.resolutionMm])
  const scanWindows = useMemo(() => {
    const out: Record<number, [number, number] | undefined> = {}
    const outside: string[] = []
    for (const g of shown) {
      const w = scanWindowOf(post.scanRangeMm, g.scan)
      if (w === null) {
        outside.push(g.name)
        out[g.id] = undefined
      } else out[g.id] = w
    }
    return { out, outside }
  }, [shown, post.scanRangeMm])
  const scanEff = effectiveRange(post.scanRangeMm, scanLimits)
  const scanAnchorFrac = (g: ViewerGroup, frac: number): number => {
    // 패널(그룹 창) 안 비율 → 공통 스캔 창 안 비율
    const w = scanWindows.out[g.id]
    if (!w) return frac
    const mm = scanPositionMm(w[0], g.scan) + frac * (w[1] - w[0]) * g.scan.resolutionMm
    const [a, b] = scanEff.range
    return b > a ? (mm - a) / (b - a) : frac
  }

  // A·B-scan 깊이 창 (활성 그룹·현재 빔 기준)
  const k = kOf(active)
  const b = beamOf(active)
  const ascanFull = useMemo<MmRange>(() => {
    const r = ascanDepthRange(active, b)
    return [r.startMm, r.endMm]
  }, [active, b])
  const ascanLimits = useMemo<RangeLimits>(() => ({ full: ascanFull, minWidth: MIN_DEPTH_SPAN_MM }), [ascanFull])
  const ascanEff = effectiveRange(groupPostOf(post, active.id).ascan, ascanLimits)
  const bscanEff = effectiveRange(groupPostOf(post, active.id).bscan, ascanLimits)
  const activeWindow = scanWindows.out[active.id]
  const cursorOutside = !!activeWindow && (k < activeWindow[0] || k >= activeWindow[1])

  // 유효 게이트(편집 반영)와 그 C-scan. 파일 게이트와 창이 같으면 volume.cscan 그대로, 아니면 파생 캐시(postState)
  const effGates = useMemo(() => {
    const out: Record<number, ViewerGate | null> = {}
    for (const g of shown) {
      const fileGate = findGate(g, g.cscanGateId)
      out[g.id] = fileGate ? applyGateOverride(fileGate, g, groupPostOf(post, g.id).gates[fileGate.id]) : null
    }
    return out
  }, [shown, post])
  const effCscans = useMemo(() => {
    const out: Record<number, GateCscan | null> = {}
    for (const g of shown) {
      const v = volumes[g.id]
      out[g.id] = v ? derivedCscan(key, g, v, effGates[g.id] ?? null) : null
    }
    return out
  }, [shown, volumes, effGates, key])

  const setBeam = (g: ViewerGroup, nb: number): void => {
    setBeams((m) => ({ ...m, [g.id]: Math.min(g.shape[1] - 1, Math.max(0, nb)) }))
    setActiveId(g.id)
  }
  const moveScan = (g: ViewerGroup, steps: number): void => {
    const kk = Math.min(g.scan.count - 1, Math.max(0, kOf(g) + steps))
    const mm = scanPositionMm(kk, g.scan)
    setScanMm(mm)
    // 키 이동에서만 스캔 창이 커서를 따라간다 (클릭·첫 커서·다시 열기는 창을 바꾸지 않음)
    dispatchPost({ type: 'ensureScanVisible', cursorMm: mm, full: scanFull })
  }
  const resetRanges = (all: boolean): void => dispatchPost({ type: 'resetRanges', groupId: all ? 'all' : active.id })
  const resetAll = (): void => {
    setAutoNote(null)
    setGateDraft(null)
    dispatchPost({ type: 'resetAll' })
  }
  /** Auto 80 %: 활성 칸의 유효 게이트 최대(포화 전 %)를 파일 기준 진폭(referenceAmplitude, 없으면 80)으로 맞추는 Δ 를 더한다 */
  const [autoNote, setAutoNote] = useState<string | null>(null)
  const autoGain = (): void => {
    const cs = effCscans[active.id]
    const raw = cs ? cs.peakRaw[k * cs.beamCount + b] : undefined
    const sample = cs ? cs.peakSample[k * cs.beamCount + b] : -1
    const gp = groupPostOf(post, active.id)
    const pct = raw !== undefined && sample !== undefined && sample >= 0 ? rawToPercent(raw, gainedScale(active.ampScale, gp.gainDb)) : 0
    const d = autoGainDb(pct, active.referenceAmplitudePct ?? 80)
    if (d === null) {
      setAutoNote('최대값 없음')
      return
    }
    setAutoNote(null)
    dispatchPost({ type: 'nudgeGain', groupId: active.id, dB: d })
  }

  // ── 라벨 모드 조작 ──
  const thicknessMm = info.specimen.thicknessMm
  const gainOf = (g: ViewerGroup): number => groupPostOf(post, g.id).gainDb
  const [lastReading, setLastReading] = useState<PointReading | null>(null)
  /** S-scan 위에 올려 둔 점의 읽기값 — 포인터마다 바뀌므로 뷰어 전체가 아니라 패널만 다시 그리게 저장소로 */
  const hoverStore = useMemo(() => createValueStore<PointReading | null>(null), [])
  /**
   * S-scan 점 찍기: 조회표와 같은 규칙으로 앵커(빔·샘플 실수)를 만들고 그 빔을 현재 빔으로. 부채꼴 밖이면 찍지 않는다.
   * '최대 진폭' 점은 누른 곳 ± 1 빔·± 1.5 mm(펼친 깊이) 안 원값 최대 칸으로 붙인다 — 0.5 mm 비켜 찍어 신호가 반으로 떨어지지 않게
   */
  const addPointAt = (g: ViewerGroup, p: InspectionPoint): void => {
    const l = sscanLookupAt(g, p.vMm, p.depthMm)
    if (!l) return
    const { beam, sample } = sscanLookupBeamSample(l)
    const kk = kOf(g)
    const role = labelState.ui.pointRole
    const vol = volumes[g.id] ?? null
    if (role === 'peak' && vol) {
      const pk = regionPeakReading(g, vol, { k0: kk, k1: kk, b0: beam - 1, b1: beam + 1, d0: p.depthMm - 1.5, d1: p.depthMm + 1.5 }, thicknessMm)
      if (pk && pk.amplitudePct !== null) {
        dispatchLabel({
          type: 'addPoint',
          point: { role, groupId: g.id, scanIndex: kk, scanMm: scanPositionMm(kk, g.scan), vMm: pk.vMm, unfoldedDepthMm: pk.unfoldedDepthMm, beam: pk.beam, sample: pk.sample, displayGainDb: gainOf(g) }
        })
        setBeam(g, pk.beam)
        setLastReading(pk)
        return
      }
    }
    dispatchLabel({
      type: 'addPoint',
      point: { role, groupId: g.id, scanIndex: kk, scanMm: scanPositionMm(kk, g.scan), vMm: p.vMm, unfoldedDepthMm: p.depthMm, beam, sample, displayGainDb: gainOf(g) }
    })
    setBeam(g, Math.round(beam))
    setLastReading(sscanPointReading(g, vol, kk, p.vMm, p.depthMm, thicknessMm))
  }
  /**
   * N: 지금 커서(활성 그룹 칸·빔) ± 2 칸·± 2 빔에서 게이트 최대(문턱과 무관)가 가장 센 칸을 '최대 진폭' 점으로.
   * 찾은 칸·빔으로 커서를 옮긴다 (그 장면 S-scan 이 보이게)
   */
  const addPeakPoint = (): void => {
    const cs = effCscans[active.id]
    if (!cs) return
    let best = -Infinity
    let at: [number, number] | null = null
    for (let kk = Math.max(0, k - 2); kk <= Math.min(cs.scanCount - 1, k + 2); kk++) {
      for (let bb = Math.max(0, b - 2); bb <= Math.min(cs.beamCount - 1, b + 2); bb++) {
        const c = kk * cs.beamCount + bb
        if (cs.peakSample[c]! < 0) continue
        if (cs.peakRaw[c]! > best) {
          best = cs.peakRaw[c]!
          at = [kk, bb]
        }
      }
    }
    if (!at) return
    const [kk, bb] = at
    const sample = cs.peakSample[kk * cs.beamCount + bb]!
    const pk = gatePeakAt(cs, { beams: active.beams, ultrasound: active.ultrasound, ampScale: active.ampScale }, kk, bb)
    if (!pk || !active.beams[bb]) return
    dispatchLabel({
      type: 'addPoint',
      point: { role: 'peak', groupId: active.id, scanIndex: kk, scanMm: scanPositionMm(kk, active.scan), vMm: pk.vMm, unfoldedDepthMm: pk.depthMm, beam: bb, sample, displayGainDb: gainOf(active) }
    })
    if (kk !== k) setScanMm(scanPositionMm(kk, active.scan))
    if (bb !== b) setBeam(active, bb)
    setLastReading(ascanDepthReading(active, activeVol, kk, bb, pk.depthMm, thicknessMm))
  }
  /** T: A-scan 시간 커서(그 빔·지금 스캔 칸의 펼친 깊이)를 지금 역할의 점으로 — 앵커 샘플 = 시간 커서 */
  const addTimePoint = (): void => {
    const tc = labelState.ui.timeCursor
    const g = tc ? supported.find((x) => x.id === tc.groupId) : undefined
    const bm = g && tc ? g.beams[tc.beam] : undefined
    if (!g || !tc || !bm) return
    const smp = sampleAtDepth(bm, tc.depthMm, g.ultrasound)
    if (!(smp >= 0 && smp <= g.ultrasound.count - 1)) return
    const r = ascanDepthReading(g, volumes[g.id] ?? null, kOf(g), tc.beam, tc.depthMm, thicknessMm)
    if (!r) return
    const kk = kOf(g)
    dispatchLabel({
      type: 'addPoint',
      point: { role: labelState.ui.pointRole, groupId: g.id, scanIndex: kk, scanMm: scanPositionMm(kk, g.scan), vMm: r.vMm, unfoldedDepthMm: r.unfoldedDepthMm, beam: tc.beam, sample: smp, displayGainDb: gainOf(g) }
    })
    setLastReading(r)
  }
  /** 라벨 모드 키. 처리했으면 true */
  const onLabelKey = (e: KeyboardEvent<HTMLDivElement>): boolean => {
    const tool = !e.shiftKey ? LABEL_TOOLS.find((t) => e.code === `Digit${t.key}` || e.code === `Numpad${t.key}`) : undefined
    if (tool) {
      dispatchLabel({ type: 'setTool', tool: tool.id })
      return true
    }
    if (e.code === 'KeyR') {
      dispatchLabel({ type: 'setRef', ref: e.shiftKey ? null : { groupId: active.id, scanMm: scanPositionMm(k, active.scan), beam: b } })
      return true
    }
    if (e.code === 'KeyN' && !e.shiftKey) {
      addPeakPoint()
      return true
    }
    if (e.code === 'KeyT' && !e.shiftKey) {
      addTimePoint()
      return true
    }
    const sel = labelState.ui.selectedId
    // 패널(지시 표 행 등) 안에서 누른 Delete 는 초안 점 지우기가 아니다
    const inPanel = e.target instanceof Element && e.target.closest('.label-side') !== null
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !inPanel) {
      if (sel === 'rect') dispatchLabel({ type: 'setRect', rect: null })
      else dispatchLabel({ type: 'removePoint', id: sel })
      return true
    }
    if (e.key === 'Escape' && sel) {
      dispatchLabel({ type: 'select', id: null })
      return true
    }
    return false
  }
  // 라벨 모드를 끄면 끌던 미리보기·올려 둔 점·패널 덮개를 남기지 않는다
  const [scanPreview, setScanPreview] = useState<{ kind: 'ref' | 'review'; groupId: number; startMm: number; endMm: number } | null>(null)
  const scanDragStart = useRef<{ kind: 'ref' | 'review'; groupId: number; startMm: number; beam: number } | null>(null)
  const [panelOverlays, setPanelOverlays] = useState<LabelViewOverlays | null>(null)
  useEffect(() => {
    if (labelOn) return
    setScanPreview(null)
    scanDragStart.current = null
    setPanelOverlays(null)
    hoverStore.set(null)
  }, [labelOn, hoverStore])

  /** 이전(−1)·다음(+1) 파일 열기 — 라벨 모드면 그 파일도 라벨 모드로 (라벨·후처리 세션은 파일마다 남는다) */
  const goFile = (d: -1 | 1): void => onGoFile(d, labelOn)

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return
    // 입력란 안에서는 그 요소의 키 (라디오 묶음은 화살표만 스스로 처리하고 멈추므로 N·R·T·1~4 는 영상 키로 받는다)
    if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')) return
    // 되돌리기 (맥 Cmd 포함) — 수정키 조합 무시보다 먼저. 게이트·눈금자를 끄는 동안에는 Axis·SscanView 가 window 캡처 단계에서
    // 먼저 삼켜 여기까지 오지 않는다 (blockUndoWhileDragging — 잡을 때의 게이트 기준 계산이 어긋나지 않게)
    if (isUndoShortcut(e)) {
      undo()
      e.preventDefault()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // 라벨 모드 켜고 끄기 (한글 입력 상태에서도 되도록 code)
    if (e.code === 'KeyL' && !e.shiftKey) {
      dispatchLabel({ type: 'toggleMode' })
      e.preventDefault()
      return
    }
    // 같은 플랜의 이전·다음 파일 ([ · ] — 한글 입력 상태에서도 되도록 code)
    if (navKey(e, onGoFile, showNav, labelOn)) return
    if (labelOn && onLabelKey(e)) {
      e.preventDefault()
      return
    }
    const step = e.shiftKey ? 10 : 1
    // C-scan 이 뒤집혀 있으면(첫 빔이 아래) ↑ = 뒤 빔 (큰 각도·큰 빔 번호)
    const up = reversed ? 1 : -1
    if (e.key === 'ArrowLeft') moveScan(active, -step)
    else if (e.key === 'ArrowRight') moveScan(active, step)
    else if (e.key === 'ArrowUp') setBeam(active, beamOf(active) + up * step)
    else if (e.key === 'ArrowDown') setBeam(active, beamOf(active) - up * step)
    else if (e.code === 'KeyG' && shown.length > 1) {
      // 한글 입력 상태에서도 되도록 key 대신 code
      const i = shown.findIndex((g) => g.id === active.id)
      setActiveId(shown[(i + (e.shiftKey ? -1 : 1) + shown.length) % shown.length]!.id)
    } else if (e.code === 'KeyZ') resetRanges(e.shiftKey)
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') dispatchPost({ type: 'nudgeGain', groupId: active.id, dB: e.shiftKey ? 0.1 : 1 })
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') dispatchPost({ type: 'nudgeGain', groupId: active.id, dB: e.shiftKey ? -0.1 : -1 })
    else if (e.code === 'Digit0' || e.code === 'Numpad0') {
      setAutoNote(null)
      dispatchPost({ type: 'setGain', groupId: active.id, dB: 0 })
    }
    else if (e.code === 'KeyA') autoGain()
    else return
    e.preventDefault()
  }

  const activeVol = volumes[active.id] ?? null
  const angle = active.beams[b]?.angleDeg
  const activeByBeam = byBeamNumber(active)
  const activeCscan = effCscans[active.id] ?? null
  const activeScale = scaleOf(active)
  const peak = activeCscan ? gatePeakAt(activeCscan, { beams: active.beams, ultrasound: active.ultrasound, ampScale: activeScale }, k, b) : null
  // A-scan 진폭 축 '전체' 상한 = 진폭 눈금 상한 (NDE 200 %, OPD 250 % 추정). 100 % 는 그대로 — NDE 는 바이트 그대로
  const ampAxisMax = axisMaxOf(groupPostOf(post, active.id).ampAxisMaxPct, active.ampScale.unitMax)
  const colorbar = colorbarCss(paletteHex, ampAxisMax)
  const gateA = effGates[active.id] ?? null
  const unsupported = info.groups.filter((g) => !g.supported)
  const isOpd = info.formatFamily === 'opd'
  const isPaintbrush = shown.some((g) => g.storageMode === 'Paintbrush')
  // 형식이 붙인 '자동 변환·학습 내보내기를 막는 이유' (OPD: 대조 전·자체 점검·두께). NDE 는 없다
  const blockReasons = [...new Set(shown.map((g) => g.blockReason).filter((r): r is string => !!r))]
  // 파일 출처 (L6, core 가 채움 — NDE 만): OmniPC 로 다시 저장 · 만든 MXU 판이 6.3.0 전인 X4. 툴팁 = 만든·고친·저장 앱과 장비
  const source = info.source ?? null
  const sourceNotes = source?.notes ?? []
  const stamp = (a: { name: string | null; version: string | null } | null): string | null => (a && (a.name || a.version) ? [a.name, a.version].filter(Boolean).join(' ') : null)
  const sourceTitle = source
    ? [
        stamp(source.createdBy) ? `만든 앱 ${stamp(source.createdBy)}` : null,
        stamp(source.modifiedBy) ? `고친 앱 ${stamp(source.modifiedBy)}` : null,
        stamp(source.savedBy) ? `마지막 저장 앱 ${stamp(source.savedBy)}` : null,
        source.platform ? `장비 ${source.platform}` : null
      ]
        .filter(Boolean)
        .join(' · ')
    : null
  // 게이트 설정 (L5): 화면 그룹의 C-scan 게이트가 장비에서 꺼졌거나, 봉우리 고르기·위치 기준이 앱 계산(가장 큰 봉우리 ^)과 다르면.
  // 앱 값은 늘 가장 큰 봉우리 기준이라 이름을 바꾸지 않고, OmniPC 가 쓰는 이름(설명서 기호 규칙 ^1·/)을 글자로 알린다 (우리 데이터 파일은 모두 해당 없음)
  const gateNotes: string[] = []
  for (const g of shown) {
    const fg = findGate(g, g.cscanGateId)
    if (!fg) continue
    const nm = fg.name.replace(/^gate\s*/i, '게이트 ')
    if (fg.enabled === false) gateNotes.push(`${g.name} ${nm}는 장비에서 꺼진 채 저장됐습니다 — C-scan·측정값은 파일 게이트 창으로 계산합니다(OmniPC 대조 전).`)
    const amp = gateReadingLabel('A%', fg)
    const pos = gateReadingLabel('DA^', fg)
    if (amp.changed || pos.changed) {
      const det = fg.detection === 'first' ? '첫 봉우리' : fg.detection === 'max' ? '가장 큰 봉우리' : '봉우리 고르기 모름'
      const ev = fg.event === 'edge' ? '문턱 교차' : fg.event === 'peak' ? '봉우리 자리' : '위치 기준 모름'
      const how = `${det}·${ev}`
      gateNotes.push(`${g.name} ${nm}: 파일은 ${how} 기준 — OmniPC 측정값 이름은 ${amp.label}·${pos.label} 이고 앱 값(가장 큰 봉우리 ^)과 다를 수 있습니다(대조 전).`)
    }
  }
  const failed = shown.filter((g) => loadErrors[g.id])
  const loading = shown.filter((g) => !volumes[g.id] && !loadErrors[g.id])
  const channelKeyName = active.spatialAxis ? 'Index' : '빔'
  const keysHint = labelOn
    ? `라벨 모드 · L 끄기 · 1 점 · 2 사각형 · 3 길이 · 4 검토 구간 · R 기준 커서 · N 최대 점 · T 시간 커서 점 · A-scan 클릭 시간 커서 · S-scan 휠 확대 · Z 범위 초기화 · ←/→ 스캔 · ↑/↓ ${channelKeyName}${showNav ? ' · [ ] 이전·다음 파일' : ''}`
    : `←/→ 스캔 · Shift 10칸 · ↑/↓ ${channelKeyName}${shown.length > 1 ? ' · G 그룹' : ''} · 클릭으로 이동 · C/A-scan 휠 확대 · Shift+휠 이동 · Z 범위 초기화 · =/− 이득 · A Auto 80 % · L 라벨 모드${showNav ? ' · [ ] 이전·다음 파일' : ''}`
  const adjusted = adjustedParts(postShown)
  // 아직 OmniPC 캡처와 맞춰 보지 않은 것들 — 하나의 표시로 모은다
  const unverified: string[] = []
  const unverifiedTitles: string[] = []
  // 대조 여부는 (형식, 기법, 스큐)마다 (core/nde/viewer/meta.ts VERIFIED: 3.x 섹토리얼, 4.x 컴파운드·리니어, OPD 는 아직 없음) — 대조 전인 조합만 이름으로
  const unverifiedKinds = [...new Set(shown.filter((g) => !g.verified).map((g) => unverifiedKindName(info.formatFamily, g)))]
  if (unverifiedKinds.length) {
    unverified.push(...unverifiedKinds)
    unverifiedTitles.push(`${unverifiedKinds.join(', ')} 그룹은 아직 OmniPC 화면과 맞춰 보지 않았습니다`)
  }
  // OPD 스큐 270: 출사점 V 부호(인덱스 오프셋 − 출사점 X)가 추정 — V·ViA^·S-scan 가로 위치 (글자는 아래 'OPD 읽기 주의' 줄에도 있음)
  if (isOpd && shown.some((g) => !g.verified && g.beams.some((bm) => Math.round(bm.skewDeg) % 360 === 270))) {
    unverifiedTitles.push('출사점 V 부호 추정(스큐 270): V = 인덱스 오프셋 − 출사점 X 로 두었습니다(TP14-ROOT-R 캡처로 확인 전). V·ViA^·S-scan 가로 위치가 바뀔 수 있습니다')
  }
  // 진폭 % 눈금을 파일에서 읽지 못하고 추정한 그룹 (OPD: raw 255 = 250 %)
  if (shown.some((g) => g.ampScale.estimated)) {
    unverified.push('진폭 눈금')
    unverifiedTitles.push('진폭 % 는 추정 눈금(OPD raw 255 = 250 %)입니다. OmniPC 캡처로 확정하기 전입니다')
  }
  if (layout === 'ABCS') {
    unverified.push('B-scan')
    unverifiedTitles.push('B-scan 은 아직 OmniPC 화면과 맞춰 보지 않았습니다')
  }
  if (anyGain) {
    unverified.push('이득')
    unverifiedTitles.push(`소프트 이득(표시 진폭 × 10^(dB/20), ${active.ampScale.unitMax} % 포화)은 OmniPC 캡처 17·18·44 로 아직 대조하지 않았습니다`)
  }
  const unverifiedTitle = unverifiedTitles.join(' / ')

  // 화면 읽기: 값 8개를 키마다 읽지 않고, 멈춘 뒤 한 줄로
  const summary = `${active.name} 스캔 ${num(scanPositionMm(k, active.scan))} mm, ${active.spatialAxis ? viewerChannelText(active, b) : `${activeByBeam ? `빔 ${beamNumber(b)}, ` : ''}각도 ${num(angle)}°`}, A ${num(peak?.pct)}%`
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(summary), 400)
    return () => clearTimeout(t)
  }, [summary])

  const fileGateA = findGate(active, active.cscanGateId)
  const gateTools: GateTools | null =
    fileGateA && gateA
      ? {
          gateId: fileGateA.id,
          name: fileGateA.name,
          values: gateDisplayValues(gateA, active),
          file: gateDisplayValues(fileGateA, active),
          thresholdPct: gateA.thresholdPct,
          fileStartUs: fileGateA.startUs[0] ?? 0,
          fileEndUs: (fileGateA.startUs[0] ?? 0) + (fileGateA.lengthUs[0] ?? 0),
          unitMax: active.ampScale.unitMax,
          // OPD 는 문턱 % 를 파일에서 못 찾아 null — '문턱 모름' (사용자가 넣으면 사라짐)
          ...(isOpd && gateA.thresholdPct === null ? { thresholdUnknown: true } : {}),
          isDefault: groupPostOf(post, active.id).gates[fileGateA.id] === undefined,
          // 장비에서 끈 게이트는 '(꺼짐)' (L5 — 파일 설정. X3 = I·B 꺼짐, A 켜짐)
          others: active.gates.filter((g) => g.id !== fileGateA.id).map((g) => `${g.name.replace(/^gate\s*/i, '게이트 ')}${g.enabled === false ? '(꺼짐)' : ''}`),
          ...(fileGateA.enabled === false ? { fileDisabled: true } : {})
        }
      : null
  // 끌기 중에는 선만 (유효 게이트 + 그 그룹의 초안), C-scan 은 손을 뗄 때 커밋된 값으로
  /** 그룹 g 의 화면 게이트(C-scan 게이트). 그 그룹의 초안이 없으면 유효 게이트 객체 그대로 (뷰가 다시 그리지 않게) */
  const displayGateOf = (g: ViewerGroup): ViewerGate | null => {
    const fileGate = findGate(g, g.cscanGateId)
    if (fileGate && gateDraft && gateDraft.groupId === g.id) return applyGateOverride(fileGate, g, { ...groupPostOf(post, g.id).gates[fileGate.id], ...gateDraft.ov })
    return effGates[g.id] ?? null
  }
  const committedOv = fileGateA ? groupPostOf(post, active.id).gates[fileGateA.id] : undefined

  // ── C-scan 내보내기 (X8): 활성 그룹의 게이트 A C-scan → OmniPC 'Export C-scan' 꼴 .txt (main 이 사본에서 다시 계산, 진폭은 파일 값) ──
  const [exportState, setExportState] = useState<{ busy: boolean; result: (ViewerCscanExportResult & { groupName: string }) | null; error: string | null }>({
    busy: false,
    result: null,
    error: null
  })
  const exportCscan = (): void => {
    const g = active
    const fg = findGate(g, g.cscanGateId)
    if (!fg) return
    // 조정 패널에서 바꾼 게이트 값(시작·폭·문턱 — 문턱을 모르는 OPD 는 사용자가 넣은 문턱)을 함께 넘긴다
    const ov = groupPostOf(post, g.id).gates[fg.id]
    setExportState({ busy: true, result: null, error: null })
    void api.viewer.exportCscan({ fileId: file.id, key, groupId: g.id, ...(ov ? { gate: ov } : {}) }).then((r) =>
      setExportState(
        r.ok ? { busy: false, result: r.data ? { ...r.data, groupName: g.name } : null, error: null } : { busy: false, result: null, error: `내보내지 못했습니다: ${r.message}` }
      )
    )
  }
  const gateAValues = gateA ? gateDisplayValues(gateA, active) : null
  const exportTools: ExportTools = {
    gateText:
      gateA && gateAValues
        ? `${gateA.name.replace(/^gate\s*/i, '게이트 ')} · ${gateAValues.geometry === 'TrueDepth' ? '깊이' : '음로'} ${gateAValues.startMm.toFixed(1)}~${(gateAValues.startMm + gateAValues.lengthMm).toFixed(1)} mm · 문턱 ${
            gateA.thresholdPct === null ? '모름' : `${gateA.thresholdPct.toFixed(1)} %`
          }`
        : null,
    adjusted: committedOv !== undefined,
    thresholdUnknown: !!gateA && gateA.thresholdPct === null,
    gainDeltaDb: groupPostOf(post, active.id).gainDb,
    busy: exportState.busy,
    result: exportState.result,
    error: exportState.error
  }
  const displayGateA = displayGateOf(active)
  // OmniPC 처럼 게이트 문턱을 넘지 못하면 위치값(DA^·ViA^·SA^)은 ND. A% 는 그대로 보여 준다 (문턱 끌기 중에도 바로)
  const detected = !!peak && (displayGateA?.thresholdPct == null || peak.pct >= displayGateA.thresholdPct)
  // OPD 는 게이트 문턱 % 칸을 파일에서 못 찾아 null — ND 판정 없이 위치값을 보이고 '문턱 모름'을 붙인다 (조정 패널에서 넣으면 사라짐)
  const thresholdUnknown = info.formatFamily === 'opd' && !!displayGateA && displayGateA.thresholdPct === null
  const ampEstimated = !!active.ampScale.estimated
  const folded = peak && detected ? foldDepth(peak.depthMm, info.specimen.thicknessMm) : null
  const nd = <span className="unit" title="게이트 A 문턱 미만 — OmniPC 와 같이 ND">ND</span>
  // 측정값 줄 툴팁 (L1): 앱 설명 + 공개 MXU 설명서 정의(shared/imaging/readings.ts) + 이 파일에 저장된 OmniPC 측정값 목록에서의 자리
  const savedReadings = info.display.readings?.find((r) => r.groupId === active.id) ?? null
  const readingTitle = (base: string, label: string | null): string => {
    const ri = label ? readingByLabel(label) : null
    if (!ri) return base
    const at = savedReadings && ri.key ? savedReadings.keys.indexOf(ri.key) : -1
    return [base, readingTooltip(ri), at >= 0 ? `이 파일의 OmniPC 측정값 목록 ${at + 1}번째 칸` : null].filter((x): x is string => !!x).join('\n')
  }
  const savedListTitle = savedReadings ? `이 파일에 저장된 OmniPC 측정값 목록 (${savedReadings.groupName ?? active.name}): ${savedReadings.keys.map(readingLabel).join(' · ')}` : undefined
  const commitGateOf = (g: ViewerGroup, patch: GateOverride): void => {
    const fileGate = findGate(g, g.cscanGateId)
    if (!fileGate) return
    dispatchPost({ type: 'setGate', groupId: g.id, gateId: fileGate.id, patch, unitMax: g.ampScale.unitMax })
    // 라벨 모드의 게이트 바꾸기(루트·몸체 게이트로 다시 보기 등)는 라벨 추가 작업 (평가 정의 9절)
    if (labelOn) work.emit('label-extra', { action: 'gate-change', groupId: g.id })
  }
  /** 게이트 시작·끝 툴팁 (눈금자 다이아몬드·S-scan 점선 공통) */
  const gateEdgeTitles = (gate: ViewerGate, v: GateDisplayValues): Record<GateEdge, string> => {
    const name = gate.name.replace(/^gate\s*/i, '')
    const unit = v.geometry === 'TrueDepth' ? '깊이' : '음로'
    return {
      start: `게이트 ${name} 시작 (${unit} ${v.startMm.toFixed(1)} mm) — 끌어서 옮김`,
      end: `게이트 ${name} 끝 (${unit} ${(v.startMm + v.lengthMm).toFixed(1)} mm) — 끌어서 폭을 바꿈`
    }
  }
  /** 그룹 g 의 게이트 시작·끝 다이아몬드 (toUser: 축 값 → 게이트 사용자 단위 mm, fromUser: 그 역). onGrab = 누르는 순간 */
  const gateMarkersOf = (g: ViewerGroup, toUser: (axisValue: number) => number, fromUser: (userMm: number) => number, onGrab?: () => void): AxisMarker[] => {
    const fileGate = findGate(g, g.cscanGateId)
    const shownGate = displayGateOf(g)
    if (!fileGate || !shownGate) return []
    const v = gateDisplayValues(shownGate, g)
    const base = { ...groupPostOf(post, g.id).gates[fileGate.id] }
    const titles = gateEdgeTitles(fileGate, v)
    return [
      {
        id: 'gate-start',
        kind: 'gate-start',
        value: fromUser(v.startMm),
        title: titles.start,
        onGrab,
        onDrag: (x) => setGateDraft({ groupId: g.id, ov: { ...base, startMm: Math.max(0, toUser(x)) } }),
        onDragEnd: (x) => {
          setGateDraft(null)
          commitGateOf(g, { startMm: Math.max(0, toUser(x)) })
        },
        onDragCancel: () => clearGateDraft(g.id)
      },
      {
        id: 'gate-end',
        kind: 'gate-end',
        value: fromUser(v.startMm + v.lengthMm),
        title: titles.end,
        onGrab,
        onDrag: (x) => setGateDraft({ groupId: g.id, ov: { ...base, lengthMm: Math.max(GATE_MIN_LENGTH_MM, toUser(x) - v.startMm) } }),
        onDragEnd: (x) => {
          setGateDraft(null)
          commitGateOf(g, { lengthMm: Math.max(GATE_MIN_LENGTH_MM, toUser(x) - v.startMm) })
        },
        onDragCancel: () => clearGateDraft(g.id)
      }
    ]
  }
  /** 그룹 g 의 현재 빔에서 깊이 ↔ 게이트 사용자 단위 (TrueDepth 는 그대로, SoundPath 는 음로 = 깊이 / cosθ) — A/B-scan·S-scan 눈금자 공통 */
  const depthUserOf = (g: ViewerGroup): { toUser: (d: number) => number; fromUser: (u: number) => number } => {
    const isDepth = displayGateOf(g)?.geometry === 'TrueDepth'
    const c = Math.cos((g.beams[beamOf(g)]?.angleDeg ?? 0) * DEG) || 1
    return { toUser: (d) => (isDepth ? d : d / c), fromUser: (u) => (isDepth ? u : u * c) }
  }
  const { toUser: depthToUser, fromUser: userToDepth } = depthUserOf(active)
  // S-scan 깊이 눈금자(그룹마다): 그 그룹의 게이트 다이아몬드만 (범위 끌기 없음). SoundPath 게이트는 그 S-scan 의 현재 빔 cosθ 로 깊이에 놓는다.
  // 누르는 순간 그 그룹을 활성으로 (A-scan·조정 패널이 끄는 그룹을 따라가게)
  // 라벨 모드에서는 S-scan 확대도 (눈금자 끌기 = 그 구간, 더블클릭 = 초기화 — 깊이는 뷰어 공통, V 는 그룹별)
  const sscanDepthAxisOf = (g: ViewerGroup): AxisInteraction => {
    const { toUser, fromUser } = depthUserOf(g)
    const markers = gateMarkersOf(g, toUser, fromUser, () => setActiveId(g.id))
    if (!sscanZoom) return { markers }
    return {
      markers,
      onRange: (lo, hi) => dispatchPost({ type: 'setSscanDepth', range: [lo, hi], limits: sscanDepthLimits }),
      onReset: () => dispatchPost({ type: 'setSscanDepth', range: null, limits: sscanDepthLimits })
    }
  }
  const sscanVAxisOf = (g: ViewerGroup): AxisInteraction | undefined =>
    sscanZoom
      ? {
          onRange: (lo, hi) => dispatchPost({ type: 'setSscanV', groupId: g.id, range: [lo, hi], limits: sscanVLimitsOf(g) }),
          onReset: () => dispatchPost({ type: 'setSscanV', groupId: g.id, range: null, limits: sscanVLimitsOf(g) })
        }
      : undefined
  /** S-scan 영상 위 게이트 점선 끌기 (그룹마다). 패치 계산은 SscanView(shared/imaging/sscanGate), 단위·규칙은 다이아몬드와 같다 */
  const sscanGateEditOf = (g: ViewerGroup): SscanGateEdit | undefined => {
    const fileGate = findGate(g, g.cscanGateId)
    const shownGate = displayGateOf(g)
    if (!fileGate || !shownGate) return undefined
    const base = { ...groupPostOf(post, g.id).gates[fileGate.id] }
    return {
      titles: gateEdgeTitles(fileGate, gateDisplayValues(shownGate, g)),
      onGrab: () => setActiveId(g.id),
      onDrag: (patch) => setGateDraft({ groupId: g.id, ov: { ...base, ...patch } }),
      onDragEnd: (patch) => {
        setGateDraft(null)
        commitGateOf(g, patch)
      },
      onDragCancel: () => clearGateDraft(g.id)
    }
  }
  const scanAxis: AxisInteraction = {
    onRange: (lo, hi) => dispatchPost({ type: 'setScanRange', range: [lo, hi], limits: scanLimits }),
    onReset: () => dispatchPost({ type: 'setScanRange', range: null, limits: scanLimits })
  }
  const ascanDepthAxis: AxisInteraction = {
    markers: gateMarkersOf(active, depthToUser, userToDepth),
    onRange: (lo, hi) => dispatchPost({ type: 'setAscanRange', groupId: active.id, range: [lo, hi], limits: ascanLimits }),
    onReset: () => dispatchPost({ type: 'setAscanRange', groupId: active.id, range: null, limits: ascanLimits })
  }
  const bscanDepthAxis: AxisInteraction = {
    markers: gateMarkersOf(active, depthToUser, userToDepth),
    onRange: (lo, hi) => dispatchPost({ type: 'setBscanRange', groupId: active.id, range: [lo, hi], limits: ascanLimits }),
    onReset: () => dispatchPost({ type: 'setBscanRange', groupId: active.id, range: null, limits: ascanLimits })
  }
  const ampAxis: AxisInteraction = {
    markers:
      fileGateA && displayGateA && displayGateA.thresholdPct !== null
        ? [
            {
              id: 'threshold',
              kind: 'threshold',
              value: displayGateA.thresholdPct,
              title: `게이트 문턱 ${displayGateA.thresholdPct.toFixed(1)} % — 끌어서 바꿈 (C-scan 재계산 없음)`,
              // 끌기 중엔 초안(선·ND 바로 반영), 손을 뗄 때 한 번 적용 → 되돌리기 한 단계
              onDrag: (x) => setGateDraft({ groupId: active.id, ov: { ...committedOv, thresholdPct: Math.max(0.1, Math.min(active.ampScale.unitMax, x)) } }),
              onDragEnd: (x) => {
                setGateDraft(null)
                commitGateOf(active, { thresholdPct: Math.max(0.1, Math.min(active.ampScale.unitMax, x)) })
              },
              onDragCancel: () => clearGateDraft(active.id)
            }
          ]
        : []
  }
  const gpActive = groupPostOf(post, active.id)
  const gainTools: GainTools = {
    gainDb: gpActive.gainDb,
    fileGainDb: active.gainDb,
    referenceGainDb: active.referenceGainDb && active.referenceGainDb > 0 ? active.referenceGainDb : null,
    referenceAmplitudePct: active.referenceAmplitudePct ?? 80,
    // OPD 는 기준 이득 0(PCN 등)을 null 로 받는다 — 'Ref 모름' 표시
    ...(info.formatFamily === 'opd' && active.referenceGainDb === null ? { refUnknown: true } : {}),
    ...(active.ampScale.unitMax !== 200 ? { saturatePct: active.ampScale.unitMax } : {}),
    note: autoNote,
    // 파일에 저장된 OmniPC 분석 이득 (L4) — 경고 줄에도 있음. 누를 때만 화면 이득으로
    fileSoftGainDb: active.softGainDb != null && Math.abs(active.softGainDb) >= 0.05 ? active.softGainDb : null
  }
  // ── A-scan 기준선 (X3, viewer/levelLines.ts): 지금 모드의 켜짐(세션 기억) · 활성 그룹 기록·평가 (화면 이득 Δ 반영, Ref 선은 그리지 않음) ──
  const [levelPrefs, setLevelPrefs] = useState(levelLinePrefs)
  const levelsWanted = levelLinesOn(levelPrefs, labelOn)
  const activeGainDb = gpActive.gainDb
  const activeLevels = useMemo(() => ascanLevelsOf(active, thicknessMm, activeGainDb), [active, thicknessMm, activeGainDb])
  // 끄면 null → A-scan 은 기준선 캔버스를 만들지 않는다 (보통 모드 그림 그대로)
  const levelLines = levelsWanted && activeLevels ? activeLevels.lines : null

  // ── 색표 불러오기 (L2): 사용자 OmniPC 색표(.pal) — main 열기 대화상자, 앱에 담지 않고 후처리(paletteFile)에. 앱을 닫을 때까지 모든 파일 보기에
  //    (세션 색표 — postState.ts). 2인 블라인드 판독이면 막는다 ──
  const [palBusy, setPalBusy] = useState(false)
  /** 불러오기 결과: 오류(늘 보임) 또는 불러온 색표에 대한 메모(그 색표가 칠해지는 동안만) */
  const [palNote, setPalNote] = useState<{ error: boolean; text: string } | null>(null)
  const loadPalette = (): void => {
    setPalBusy(true)
    setPalNote(null)
    void api.viewer.openPalette().then((r) => {
      setPalBusy(false)
      if (!r.ok) {
        setPalNote({ error: true, text: `불러오지 못했습니다: ${r.message}` })
        return
      }
      if (!r.data) return
      dispatchPost({ type: 'setPaletteFile', file: { name: r.data.name, palette: r.data.palette, specialColors: r.data.specialColors } })
      setPalNote(r.data.specialFromFile ? null : { error: false, text: '특수색이 없는 색표라 데이터 없음 색은 기본 특수색으로 칠합니다' })
    })
  }
  const paletteFile = post.paletteFile ?? null
  const paletteTools: PaletteTools = {
    minPct: palMin,
    maxPct: palMax,
    ampAxisMaxPct: gpActive.ampAxisMaxPct,
    ...(active.ampScale.unitMax > 200 ? { fullScalePct: active.ampScale.unitMax } : {}),
    levelLines: {
      on: levelsWanted,
      available: activeLevels !== null && activeLevels.lines.length > 0,
      legend: activeLevels?.legend ?? null,
      unavailable: !activeLevels
        ? 'Ref 를 추정할 수 없는 그룹입니다(기준 이득 0·이득 정보 없음)'
        : activeLevels.lines.length === 0
          ? '두께가 시방서 표 13 범위 밖이거나 몰라 평가·기록 기준이 없습니다'
          : null,
      labelMode: labelOn
    },
    paletteFileName: paletteFile ? paletteFile.name || '불러온 색표' : null,
    fileSourceName: info.display.paletteSource === 'default' ? '앱 내장 색표' : '파일 색표',
    paletteBusy: palBusy,
    paletteNote: palNote && (palNote.error || paletteFile) ? palNote.text : null,
    paletteBlocked: blindMode ? '2인 블라인드 판독에서는 두 판독자 화면을 같게 하려고 색표를 불러오지 않습니다 (파일 색표로 봅니다)' : null
  }
  // C-scan 뒤집기 체크 칸의 '첫 빔' 이름: 리니어 = '빔 1', 그 밖은 첫 빔이 작은 각도인지 큰 각도인지
  const firstBeamName = firstChannelName(active)
  const rangeTools: RangeTools = {
    scan: { range: scanEff.range, limits: scanLimits, isDefault: scanEff.isDefault },
    ascan: { range: ascanEff.range, limits: ascanLimits, isDefault: ascanEff.isDefault },
    bscan: { range: bscanEff.range, limits: ascanLimits, isDefault: bscanEff.isDefault },
    reversed,
    firstBeamName,
    spatialAxis: !!active.spatialAxis,
    fileReversed: info.display.cscanReversed,
    reversedIsDefault: post.cscanReversed === null
  }

  // ── 라벨 모드: 뷰 조작·덮개·패널 ──
  /** S-scan 조작 (점·사각형·올려 둔 점). 보통 모드는 없음 → 클릭 = 빔 고르기 */
  const sscanMarkingOf = (g: ViewerGroup): SscanMarking | undefined => {
    if (!labelOn) return undefined
    return {
      onPoint: gestures.sscanClickPoint ? (p) => addPointAt(g, p) : undefined,
      onRect: gestures.sscanDragRect
        ? (a, c) => {
            setActiveId(g.id)
            const kk = kOf(g)
            dispatchLabel({
              type: 'setRect',
              rect: { groupId: g.id, scanIndex: kk, scanMm: scanPositionMm(kk, g.scan), vMinMm: a.vMm, vMaxMm: c.vMm, depthMinMm: a.depthMm, depthMaxMm: c.depthMm, displayGainDb: gainOf(g) }
            })
          }
        : undefined,
      onHover: (p) => hoverStore.set(p ? sscanPointReading(g, volumes[g.id] ?? null, kOf(g), p.vMm, p.depthMm, thicknessMm) : null)
    }
  }
  /** C/B-scan 끌기 (길이 = 기준 커서 R, 검토 구간). 누른 곳이 시작, 4 px 이상 움직여야 끌기 — 움직이지 않은 클릭은 지금처럼 커서만 */
  const scanMarkingOf = (g: ViewerGroup): ScanMarking | undefined => {
    if (!gestures.scanDragLength && !gestures.scanDragReview) return undefined
    const kind = gestures.scanDragLength ? 'ref' : 'review'
    const pos = (kk: number): number => scanPositionMm(kk, g.scan)
    return {
      onStart: (kk, bb) => {
        scanDragStart.current = { kind, groupId: g.id, startMm: pos(kk), beam: bb }
        setScanPreview(null)
      },
      onMove: (kk) => {
        const st = scanDragStart.current
        if (st) setScanPreview({ kind: st.kind, groupId: st.groupId, startMm: st.startMm, endMm: pos(kk) })
      },
      onEnd: (kk, _bb, moved) => {
        const st = scanDragStart.current
        scanDragStart.current = null
        setScanPreview(null)
        if (!st || !moved) return
        if (st.kind === 'ref') dispatchLabel({ type: 'setRef', ref: { groupId: st.groupId, scanMm: st.startMm, beam: st.beam } })
        else dispatchLabel({ type: 'setReview', review: { groupId: st.groupId, scanStartMm: st.startMm, scanEndMm: pos(kk) } })
      },
      onCancel: () => {
        scanDragStart.current = null
        setScanPreview(null)
      }
    }
  }
  const onTimeCursor = gestures.ascanTimeCursor ? (d: number) => dispatchLabel({ type: 'setTimeCursor', cursor: { groupId: active.id, beam: b, depthMm: d } }) : undefined
  // 덮개: 초안(labeling/overlays) + 끄는 중 미리보기 + 패널 덮개. 보통 모드는 없음(undefined) → 그림 그대로
  const beamsKey = supported.map((g) => `${g.id}:${beams[g.id] ?? g.initialBeam}`).join(',')
  // draftOverlays 가 보는 것만 (모드·초안·고른 점·시간 커서) — 도구·패널 접기 등은 덮개를 다시 만들지 않는다
  const ovDraft = labelState.draft
  const ovSelected = labelState.ui.selectedId
  const ovTime = labelState.ui.timeCursor
  const labelOverlaysRaw = useMemo(() => {
    if (!labelOn) return null
    const groupOf = (id: number): ViewerGroup | undefined => supported.find((g) => g.id === id)
    const d = draftOverlays(
      { ...labelState, draft: ovDraft, ui: { ...labelState.ui, on: true, selectedId: ovSelected, timeCursor: ovTime } },
      {
        groupIds: shown.map((g) => g.id),
        activeGroupId: active.id,
        scanIndexOf: (id) => {
          const g = groupOf(id)
          return g ? scanIndexAt(cursorMm, g.scan) : 0
        },
        beamOf: (id) => beams[id] ?? groupOf(id)?.initialBeam ?? 0,
        beamPointOf: (id, beam, depth) => {
          const bm = groupOf(id)?.beams[beam]
          if (!bm) return null
          return beamPoint(bm, depth / (Math.cos(bm.angleDeg * DEG) || 1))
        }
      }
    )
    const preview = (gid: number): ViewOverlay | undefined => {
      const pv = scanPreview
      if (!pv || pv.groupId !== gid) return undefined
      return pv.kind === 'ref'
        ? { vlines: [{ id: 'ref-preview', tone: 'reference', value: pv.startMm, label: 'R' }] }
        : { rects: [{ id: 'review-preview', tone: 'draft', x0: pv.startMm, x1: pv.endMm, y0: null, y1: null }] }
    }
    const sscan: Record<number, ViewOverlay | undefined> = {}
    const cscan: Record<number, ViewOverlay | undefined> = {}
    for (const g of shown) {
      sscan[g.id] = mergeOverlays(d.sscan[g.id], panelOverlays?.sscan?.[g.id])
      cscan[g.id] = mergeOverlays(d.cscan[g.id], preview(g.id), panelOverlays?.cscan?.[g.id])
    }
    return {
      sscan,
      cscan,
      bscan: mergeOverlays(d.bscan, preview(active.id), panelOverlays?.bscan),
      ascan: mergeOverlays(d.ascan, panelOverlays?.ascan)
    }
    // beams 는 beamsKey 로, 라벨 상태는 덮개가 보는 칸만 건다
  }, [labelOn, ovDraft, ovSelected, ovTime, shown, supported, active.id, cursorMm, beamsKey, scanPreview, panelOverlays])
  // 뷰마다 내용이 같으면 같은 객체 — 시간 커서를 끌어도 S·C-scan 덮개 캔버스는 다시 그리지 않는다
  const ovCache = useRef(new Map<string, { json: string; ov: ViewOverlay | undefined }>())
  const stableOv = (k: string, ov: ViewOverlay | undefined): ViewOverlay | undefined => {
    const json = ov ? JSON.stringify(ov) : ''
    const hit = ovCache.current.get(k)
    if (hit && hit.json === json) return hit.ov
    ovCache.current.set(k, { json, ov })
    return ov
  }
  const labelOverlays = labelOverlaysRaw
    ? {
        sscan: Object.fromEntries(shown.map((g) => [g.id, stableOv(`s${g.id}`, labelOverlaysRaw.sscan[g.id])])) as Record<number, ViewOverlay | undefined>,
        cscan: Object.fromEntries(shown.map((g) => [g.id, stableOv(`c${g.id}`, labelOverlaysRaw.cscan[g.id])])) as Record<number, ViewOverlay | undefined>,
        bscan: stableOv('b', labelOverlaysRaw.bscan),
        ascan: stableOv('a', labelOverlaysRaw.ascan)
      }
    : null
  // 뷰가 공개한 보이는 범위 (패널·점검용, 다시 그리지 않게 ref)
  const viewports = useRef(new Map<string, ViewViewport>())
  const onViewport = useCallback((vp: ViewViewport) => viewports.current.set(`${vp.kind}:${vp.groupId}`, vp), [])
  const getViewport = useCallback((kind: ViewKind, groupId: number) => viewports.current.get(`${kind}:${groupId}`) ?? null, [])
  // 패널에 넘길 그룹 진폭 (파일 이득 0 dB — derive GroupAmplitude). 라벨 모드에서만 만든다
  const amplitudes = useMemo(() => {
    const m = new Map<number, GroupAmplitude>()
    if (!labelOn) return m
    for (const g of supported) {
      const v = volumes[g.id]
      if (v) m.set(g.id, amplitudeFromVolume(g, v.amplitude, v.status))
    }
    return m
  }, [labelOn, supported, volumes])
  const labelGroups = useMemo<LabelGroupSource[]>(
    () =>
      labelOn
        ? supported.map((g) => ({
            group: g,
            volume: volumes[g.id] ?? null,
            amplitude: amplitudes.get(g.id) ?? null,
            displayGainDb: groupPostOf(post, g.id).gainDb,
            shown: shownKey.split(',').map(Number).includes(g.id)
          }))
        : [],
    // 이득은 gainKey 로 건다
    [labelOn, supported, volumes, amplitudes, gainKey, shownKey]
  )
  const gotoLabel = (t: LabelGotoTarget): void => {
    const g = supported.find((x) => x.id === t.groupId)
    if (!g) return
    // 그 그룹이 화면에 없으면(다른 그룹 단독) 그 그룹으로
    if (!shown.some((x) => x.id === g.id) && mode !== 'all') setMode(g.id)
    setScanMm(scanPositionMm(scanIndexAt(t.scanMm, g.scan), g.scan))
    if (t.beam !== undefined) setBeam(g, t.beam)
    else setActiveId(g.id)
    // 기록의 화면 스냅샷 (이득·게이트·색표) — 패널이 지금 후처리에 덮어 만든 값
    if (t.post) dispatchPost({ type: 'load', post: t.post })
  }
  // 같은 파일을 다른 기록 자리로 다시 열 때 (검수에서 다른 행의 '영상으로 보기' — 화면은 다시 마운트되지 않는다)
  const targetKey = target ? JSON.stringify(target) : ''
  const firstTarget = useRef(true)
  useEffect(() => {
    if (firstTarget.current) {
      firstTarget.current = false
      return
    }
    if (!target) return
    const g = (target.groupId !== undefined ? supported.find((x) => x.id === target.groupId) : undefined) ?? active
    gotoLabel({ groupId: g.id, scanMm: target.scanMm, ...(target.beam !== undefined ? { beam: target.beam } : {}) })
  }, [targetKey])
  // 라벨 모드를 끄면 패널이 사라지며 포커스가 body 로 떨어진다 → 영상 쪽으로 되돌려 ←/→ 가 바로 듣게
  useEffect(() => {
    if (labelOn) return
    const a = document.activeElement
    if (!a || a === document.body || !a.isConnected) rootRef.current?.focus({ preventScroll: true })
  }, [labelOn])
  const timeCursor = labelState.ui.timeCursor
  const timeGroup = timeCursor ? supported.find((g) => g.id === timeCursor.groupId) : undefined
  const timeReading =
    labelOn && timeCursor && timeGroup ? ascanDepthReading(timeGroup, volumes[timeGroup.id] ?? null, kOf(timeGroup), timeCursor.beam, timeCursor.depthMm, thicknessMm) : null
  const refLength = labelOn ? lengthFromRef(labelState.draft.ref, scanPositionMm(k, active.scan)) : null

  return (
    <div className={labelOn ? 'viewer viewer--label' : 'viewer'} ref={rootRef} tabIndex={-1} onKeyDown={onKey}>
      <Header title={file.storedFileName} meta={`${file.planId} · ${file.specimenId}`} onBack={onBack} backLabel={backLabel}>
        {nav ? <FileNavButtons nav={nav} onGo={goFile} /> : null}
        {supported.length > 1 ? (
          // A-B-C-S 는 한 그룹만 그리므로 묶음도 그 그룹을 눌린 것으로 보이고 '모두' 는 끈다. '모두' 에서 A-B-C-S 로 와 그룹을 고르면
          // 현재 그룹만 바꿔(mode 'all' 그대로) A-C-S 로 돌아가면 다시 모두가 보인다
          <Seg<Mode>
            label="그룹"
            value={abcsId ?? mode}
            options={[
              { id: 'all', name: '모두', ...(abcsId !== null ? { disabled: true, title: 'A-B-C-S 는 한 그룹씩 봅니다 (A-C-S 에서 모두)' } : {}) },
              ...supported.map((g) => ({ id: g.id, name: g.name }))
            ]}
            onChange={(id) => {
              if (id === 'all') {
                setMode('all')
                return
              }
              if (abcsId === null || mode !== 'all') setMode(id)
              setActiveId(id)
            }}
          />
        ) : null}
        <Seg<Layout> label="레이아웃" value={layout} options={LAYOUTS} onChange={setLayout} />
        <button
          type="button"
          className="btn btn--ghost"
          aria-expanded={toolsOpen}
          aria-controls={toolsOpen ? 'viewer-tools' : undefined}
          title="범위 등 후처리 숫자 입력 (휠·키로도 바꿀 수 있음)"
          onClick={() => setToolsOpen((o) => !o)}
        >
          조정 {toolsOpen ? '▴' : '▾'}
        </button>
        <button
          type="button"
          className="btn btn--ghost viewer__toggle"
          aria-pressed={labelOn}
          title={labelOn ? '라벨 모드 끄기 (L) — 덮개·S-scan 확대가 빠지고 보통 화면으로' : '라벨 모드 (L) — 점·사각형·길이·검토 구간을 찍고, 영상 위 라벨 덮개와 S-scan 확대를 켭니다'}
          onClick={() => dispatchLabel({ type: 'toggleMode' })}
        >
          라벨
        </button>
        {!postIsDefault ? (
          <button type="button" className="btn btn--ghost" title="후처리 조정을 모두 파일값으로 되돌립니다 (패널의 버튼은 그 항목만)" onClick={resetAll}>
            파일값으로
          </button>
        ) : null}
        <span className="toolbar__spacer" />
        {/* 상태 표시는 한 줄에 하나·둘만: '대조 전' 은 항목을 모아 한 개로, 그 다음 '조정됨', 범위 밖 안내는 하나만 */}
        {unverified.length ? (
          <Status tone="attention" title={unverifiedTitle}>
            {/* 무엇이 대조 전인지 글자로도 (툴팁은 키보드·화면 읽기로 닿지 않는다). 좁으면 이 칩만 줄어 말줄임 (app.css .viewer__chip-text) */}
            <span className="viewer__chip-text">OmniPC 대조 전 ({unverified.join(' · ')})</span>
          </Status>
        ) : null}
        {!postIsDefault ? (
          <Status tone="muted" title={`조정된 것: ${adjusted.join(' · ')}`}>
            조정됨
          </Status>
        ) : null}
        {sscanZoomed ? (
          <Status tone="muted" title="라벨 모드 S-scan 확대 (휠·눈금자 끌기). Z = 이 그룹 범위 초기화, 더블클릭 = 그 축 초기화. 게이트·이득은 그대로">
            확대
          </Status>
        ) : null}
        {cursorOutside ? (
          <Status tone="muted">커서가 스캔 범위 밖</Status>
        ) : scanWindows.outside.length ? (
          <Status tone="muted">스캔 범위 밖({scanWindows.outside.join(', ')})</Status>
        ) : null}
      </Header>

      {/* 볼 수 없는 그룹·화면 설정 경고: 이유를 툴팁이 아니라 화면에 (있을 때만 한 줄씩) */}
      {unsupported.length || info.warnings.length || isOpd || isPaintbrush || sourceNotes.length || gateNotes.length || paletteFile ? (
        <div className="viewer__notes">
          <PaintbrushNote groups={shown} />
          {unsupported.length ? (
            <p>
              <Status tone="muted">볼 수 없는 그룹 {unsupported.length}개</Status>
              <span>{unsupported.map(reasonText).join(' · ')}</span>
            </p>
          ) : null}
          {info.warnings.length ? (
            <p>
              {/* NDE 의 경고는 파일 설정(색표·Ref·분석 이득·분석 오프셋 — OmniPC 조사 X2·X7·L4) 쪽, OPD 는 구조를 따라 읽은 형식이라는 주의 */}
              <Status tone="attention" title={isOpd ? undefined : '파일 설정에서 읽은 주의 (색표·Ref 추정·분석 이득·분석 오프셋, OmniPC 대조 전)'}>
                {isOpd ? 'OPD 읽기 주의' : '파일 설정 주의'}
              </Status>
              <span>{info.warnings.join(' ')}</span>
            </p>
          ) : null}
          {gateNotes.length ? (
            <p>
              <Status tone="attention">게이트 설정</Status>
              <span>{gateNotes.join(' ')}</span>
            </p>
          ) : null}
          {sourceNotes.length ? (
            <p>
              {/* 파일 출처 (L6): OmniPC 로 다시 저장한 파일 · 만든 MXU 판이 6.3.0 전인 X4 웨지 오프셋 주의 */}
              <Status tone="attention" title={sourceTitle ?? undefined}>
                파일 출처
              </Status>
              <span>{sourceNotes.join(' ')}</span>
            </p>
          ) : null}
          {paletteFile && !isOpd ? (
            <p>
              {/* 불러온 색표(L2)는 판독자가 무엇으로 봤는지 알 수 있게 이름을 화면에. 기록 화면 스냅샷에는 이름·해시만 (2026-10-07 기본값 (나)) */}
              <Status tone="muted" title="조정 패널 색표 탭에서 불러온 OmniPC 색표로 칠합니다 (앱을 닫을 때까지 모든 파일 보기에)">
                색표: 불러옴
              </Status>
              <span>
                {paletteFile.name || '불러온 색표'} — 색만 바뀌고 진폭·측정값·기록 값은 그대로입니다. 이때 저장하는 기록의 화면 스냅샷에 색표 이름·해시가 남습니다.
              </span>
            </p>
          ) : null}
          {isOpd ? (
            <p>
              {paletteFile ? (
                <Status tone="muted" title={`조정 패널 색표 탭에서 불러온 OmniPC 색표(${paletteFile.name || '이름 없음'})로 칠합니다`}>
                  색표: 불러옴
                </Status>
              ) : info.display.paletteSource === 'default' ? (
                <Status tone="muted" title="파일의 진폭 색표는 OmniPC 화면 색과 달라 앱 내장 색표(X3 .nde 파일 ModelSetup 의 256색 — OmniPC 캡처와 맞춘 앱 기본 색표)를 씁니다">
                  색표: 내장
                </Status>
              ) : null}
              {info.scanSync === 'unknown' ? <Status tone="muted">스캔 축 동기 모름</Status> : null}
              {info.scanSync === 'encoder' ? <Status tone="muted">엔코더 동기</Status> : null}
              {info.scanSync === 'time' ? <Status tone="muted">시간 동기 · 명목 위치</Status> : null}
              <span>
                {info.scanSync === 'unknown' ? '스캔 mm 는 칸 번호 × 간격(명목값)입니다 — 엔코더/시간 동기를 파일에서 알 수 없습니다.' : null}
                {info.scanSync === 'time' ? '스캔 mm 는 설정된 시작 위치와 간격으로 계산한 명목값이며, 엔코더로 측정한 위치가 아닙니다.' : null}
                {info.reader ? ` 읽기 규칙 ${info.reader.name} v${info.reader.version}.` : null}
              </span>
            </p>
          ) : null}
          {blockReasons.length ? (
            <p>
              <Status tone="muted">자동 변환·학습 내보내기 막힘</Status>
              <span>라벨 기록은 됩니다. {blockReasons.join(' ')}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {toolsOpen ? (
        <ToolsPanel
          groupId={active.id}
          groupName={active.name}
          hasBscan={layout === 'ABCS'}
          tools={rangeTools}
          gate={gateTools}
          gain={gainTools}
          paletteTools={paletteTools}
          onAutoGain={autoGain}
          dispatch={dispatchPost}
          tab={toolsTab}
          onTab={setToolsTab}
          view={toolsView}
          onView={setToolsView}
          paletteView={paletteView}
          onPaletteView={setPaletteView}
          onLevelLines={(on) => setLevelPrefs(setLevelLinesOn(labelOn, on))}
          onLoadPalette={loadPalette}
          exportTools={exportTools}
          onExport={exportCscan}
        />
      ) : null}

      {failed.length ? (
        <ErrorNotice
          title={`진폭 데이터를 읽지 못했습니다 (${failed.map((g) => g.name).join(', ')})`}
          error={loadErrors[failed[0]!.id]!}
          onRetry={() => {
            setLoadErrors({})
            setRetry((r) => r + 1)
            // 누른 버튼이 사라지므로 키보드 위치를 영상 쪽으로
            rootRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : null}

      <div className="viewer__main">
        <div className={`viewer__body data-canvas viewer__body--${layout.toLowerCase()} viewer__body--n${shown.length}`}>
          <section className="viewer__ascan" aria-label="A-scan">
            <div className="vpanel__head">
              <span>
                {active.name} · A-scan <span className="unit">· {beamText(active, b)}</span>
              </span>
            </div>
            <AscanView
              group={active}
              volume={activeVol}
              scanIndex={k}
              beam={b}
              thicknessMm={info.specimen.thicknessMm}
              depthWindow={ascanEff.isDefault ? null : ascanEff.range}
              gate={displayGateA}
              ampScale={activeScale}
              ampAxisMaxPct={ampAxisMax}
              colorbar={colorbar}
              colors={colors}
              depthAxis={ascanDepthAxis}
              ampAxis={ampAxis}
              onZoomDepth={(frac, factor) => dispatchPost({ type: 'zoomAscan', groupId: active.id, anchorFrac: frac, factor, limits: ascanLimits })}
              onPanDepth={(delta) => dispatchPost({ type: 'panAscan', groupId: active.id, deltaMm: delta, limits: ascanLimits })}
              onTimeCursor={onTimeCursor}
              levels={levelLines}
              levelTag={activeLevels?.basisNote ? 'Ref 대조 전 · TCG 없음' : undefined}
              overlay={labelOverlays?.ascan}
              overlayStyles={labelOn ? labelStyles : undefined}
              onViewport={onViewport}
            />
          </section>
          <section className="viewer__sscans" aria-label="S-scan">
            {shown.map((g) => (
              <div key={g.id} className="vpanel">
                <div className="vpanel__head">
                  <span>
                    {g.name} · S-scan <span className="unit">· {beamText(g, beamOf(g))}</span>
                  </span>
                </div>
                <SscanView
                  group={g}
                  volume={volumes[g.id] ?? null}
                  scanIndex={kOf(g)}
                  beam={beamOf(g)}
                  range={ranges[g.id]!}
                  palette={palette}
                  noData={noData}
                  specimen={info.specimen}
                  active={g.id === active.id && shown.length > 1}
                  colors={colors}
                  ampScale={scaleOf(g)}
                  gate={displayGateOf(g)}
                  depthAxis={sscanDepthAxisOf(g)}
                  vAxis={sscanVAxisOf(g)}
                  gateEdit={gestures.sscanGateDrag ? sscanGateEditOf(g) : undefined}
                  onPickBeam={(nb) => setBeam(g, nb)}
                  onZoom={
                    sscanZoom
                      ? (axis, frac, factor) =>
                          dispatchPost({ type: 'zoomSscan', axis, groupId: g.id, anchorFrac: frac, factor, limits: axis === 'depth' ? sscanDepthLimits : sscanVLimitsOf(g) })
                      : undefined
                  }
                  onPan={
                    sscanZoom
                      ? (axis, delta) => dispatchPost({ type: 'panSscan', axis, groupId: g.id, deltaMm: delta, limits: axis === 'depth' ? sscanDepthLimits : sscanVLimitsOf(g) })
                      : undefined
                  }
                  marking={sscanMarkingOf(g)}
                  overlay={labelOverlays?.sscan[g.id]}
                  overlayStyles={labelOn ? labelStyles : undefined}
                  onViewport={onViewport}
                />
              </div>
            ))}
          </section>
          <section className="viewer__cscans" aria-label="C-scan">
            {shown.map((g, i) => (
              <div key={g.id} className="vpanel">
                <div className="vpanel__head">
                  <span>
                    {g.name} · C-scan <span className="unit">· 게이트 A 최대</span>
                  </span>
                </div>
                <CscanView
                  group={g}
                  volume={volumes[g.id] ?? null}
                  scanIndex={kOf(g)}
                  beam={beamOf(g)}
                  reversed={reversed}
                  cscan={effCscans[g.id] ?? null}
                  scanWindow={scanWindows.out[g.id]}
                  ampScale={scaleOf(g)}
                  palette={palette}
                  noData={noData}
                  active={g.id === active.id && shown.length > 1}
                  showScanAxis={i === shown.length - 1}
                  colors={colors}
                  scanAxis={scanAxis}
                  onPick={(kk, bb) => {
                    setScanMm(scanPositionMm(kk, g.scan))
                    setBeam(g, bb)
                  }}
                  onZoomScan={(frac, factor) => dispatchPost({ type: 'zoomScan', anchorFrac: scanAnchorFrac(g, frac), factor, limits: scanLimits })}
                  onPanScan={(delta) => dispatchPost({ type: 'panScan', deltaMm: delta, limits: scanLimits })}
                  marking={scanMarkingOf(g)}
                  overlay={labelOverlays?.cscan[g.id]}
                  overlayStyles={labelOn ? labelStyles : undefined}
                  onViewport={onViewport}
                />
              </div>
            ))}
          </section>
          {layout === 'ABCS' ? (
            <section className="viewer__bscan" aria-label="B-scan">
              <div className="vpanel">
                <div className="vpanel__head">
                  <span>
                    {active.name} · B-scan <span className="unit">· {beamText(active, b)}</span>
                  </span>
                </div>
                <BscanView
                  group={active}
                  volume={activeVol}
                  scanIndex={k}
                  beam={b}
                  thicknessMm={info.specimen.thicknessMm}
                  scanWindow={scanWindows.out[active.id]}
                  depthWindow={bscanEff.isDefault ? null : bscanEff.range}
                  ampScale={activeScale}
                  palette={palette}
                  noData={noData}
                  colors={colors}
                  gate={displayGateA}
                  depthAxis={bscanDepthAxis}
                  scanAxis={scanAxis}
                  onPickScan={(kk) => setScanMm(scanPositionMm(kk, active.scan))}
                  onZoomScan={(frac, factor) => dispatchPost({ type: 'zoomScan', anchorFrac: scanAnchorFrac(active, frac), factor, limits: scanLimits })}
                  onPanScan={(delta) => dispatchPost({ type: 'panScan', deltaMm: delta, limits: scanLimits })}
                  onZoomDepth={(frac, factor) => dispatchPost({ type: 'zoomBscan', groupId: active.id, anchorFrac: frac, factor, limits: ascanLimits })}
                  marking={scanMarkingOf(active)}
                  overlay={labelOverlays?.bscan}
                  overlayStyles={labelOn ? labelStyles : undefined}
                  onViewport={onViewport}
                />
              </div>
            </section>
          ) : null}
          {loading.length ? (
            <p className="viewer__loading">
              진폭 데이터를 읽는 중 {loading.map((g) => `${g.name} ${Math.round((progress[g.id] ?? 0) * 100)}%`).join(' · ')}
            </p>
          ) : null}
        </div>
        {labelOn ? (
          <LabelSide
            open={labelState.ui.panelOpen}
            onOpen={(open) => dispatchLabel({ type: 'setPanelOpen', open })}
            tool={labelState.ui.tool}
            onTool={(tool) => dispatchLabel({ type: 'setTool', tool })}
          >
            {compareView ? (
              <ComparePanel
                sha256={file.meta.sha256}
                compare={compareView}
                groups={labelGroups}
                thicknessMm={thicknessMm}
                cursor={{
                  activeGroupId: active.id,
                  scanMm: scanPositionMm(k, active.scan),
                  scanIndex: Object.fromEntries(supported.map((g) => [g.id, kOf(g)])),
                  beam: Object.fromEntries(supported.map((g) => [g.id, beamOf(g)]))
                }}
                onOverlays={setPanelOverlays}
                onGoto={gotoLabel}
                onClose={() => setCompareView(null)}
              />
            ) : (
            <LabelPanel
              file={file}
              viewerKey={key}
              info={info}
              sha256={file.meta.sha256}
              groups={labelGroups}
              thicknessMm={thicknessMm}
              state={labelState}
              dispatch={dispatchLabel}
              cursor={{
                activeGroupId: active.id,
                scanMm: scanPositionMm(k, active.scan),
                scanIndex: Object.fromEntries(supported.map((g) => [g.id, kOf(g)])),
                beam: Object.fromEntries(supported.map((g) => [g.id, beamOf(g)]))
              }}
              lengthMm={refLength}
              lastReading={lastReading}
              timeReading={timeReading}
              hover={hoverStore}
              post={post}
              getViewport={getViewport}
              onOverlays={setPanelOverlays}
              onGoto={gotoLabel}
              onCollapse={() => dispatchLabel({ type: 'setPanelOpen', open: false })}
              work={work}
              onTimePoint={addTimePoint}
              onSingleGroup={(id) => {
                setMode(id)
                setActiveId(id)
              }}
            />
            )}
          </LabelSide>
        ) : null}
      </div>

      {/* 측정값 줄: 높이 고정 한 줄 (값이 바뀌어도 영상 크기가 흔들리지 않게), 넘치면 키 안내만 줄어든다 */}
      <div className="viewer__readout">
        <dl className="viewer__values">
          <div>
            <dt title={savedListTitle}>그룹</dt>
            <dd>{active.name}</dd>
          </div>
          <div>
            <dt>스캔</dt>
            <dd className="num">
              {num(scanPositionMm(k, active.scan))} <span className="unit">mm</span>
            </dd>
          </div>
          <ViewerChannelReadout group={active} channel={b} />
          <PaintbrushPointReadout group={active} status={activeVol?.status} scan={k} channel={b} />
          <div>
            <dt title={readingTitle(ampEstimated ? '게이트 A 안 최대 진폭 — 추정 눈금(OPD raw 255 = 250 %, OmniPC 대조 전)' : '게이트 A 안 최대 진폭', 'A%')}>A%</dt>
            <dd className="num">
              {num(peak ? saturatedPercent(peak.pct, activeScale) : undefined)}
              {ampEstimated ? <span className="unit"> · 추정 눈금</span> : null}
            </dd>
          </div>
          {thresholdUnknown ? (
            <div>
              <dt title="게이트 문턱 % 를 파일에서 찾지 못했습니다. ND 판정 없이 위치값을 보입니다 — 조정 패널 '게이트' 탭에서 문턱을 넣으세요">문턱</dt>
              <dd>
                <span className="unit">모름</span>
              </dd>
            </div>
          ) : null}
          <div>
            <dt
              title={readingTitle(
                '앱 값 = 게이트 A 최대 지점의 펼친 깊이(스킵을 펴서 이어짐). 아래 설명서 정의(DA^ = 시편 안 깊이)와는 2레그 이상에서 다를 수 있습니다 — OmniPC 6.6 의 DA^ 가 접힌 깊이인지는 대조 전(캡처 49, 제안 X4). 접은 값은 옆 \'실제 깊이\'',
                'DA^'
              )}
            >
              깊이 DA^
            </dt>
            <dd className="num">
              {peak && !detected ? nd : <>{num(peak?.depthMm, 2)} <span className="unit">mm</span></>}
            </dd>
          </div>
          <div>
            <dt title="두께 안으로 접은 실제 깊이와 레그 (앱 값). OmniPC DA^ 가 설명서 정의대로 시편 안 깊이면 이 값과 같아야 합니다(대조 전 — 캡처 49)">실제 깊이</dt>
            <dd className="num">
              {peak && !detected ? (
                nd
              ) : (
                <>
                  {num(folded?.depthMm, 2)} <span className="unit">mm</span>
                  {folded?.leg ? <span className="unit"> · 레그 {folded.leg}</span> : null}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt title={active.spatialAxis ? '게이트 최대 지점의 인덱스 위치' : readingTitle('용접 중심선(CL) 기준 위치 (OmniPC ViA^)', 'ViA^')}>{active.spatialAxis ? 'Index 위치' : 'CL 기준 ViA^'}</dt>
            <dd className="num">
              {peak && !detected ? nd : <>{num(peak?.vMm, 2)} <span className="unit">mm</span></>}
            </dd>
          </div>
          <div>
            <dt title={readingTitle('음로 (OmniPC SA^)', 'SA^')}>음로 SA^</dt>
            <dd className="num">
              {peak && !detected ? nd : <>{num(peak?.soundPathMm, 2)} <span className="unit">mm</span></>}
            </dd>
          </div>
          {refLength !== null ? (
            <div>
              <dt
                title={readingTitle(
                  '기준 커서 R 에서 현재 커서까지 스캔축 거리 = 길이 (OmniPC S(m−r) — OmniPC 는 측정 커서 m, 앱은 현재 커서. OmniPC 의 U(m−r) 은 초음파축(깊이) 차라 길이가 아님)',
                  'S(m−r)'
                )}
              >
                S(m−r)
              </dt>
              <dd className="num">
                {num(refLength)} <span className="unit">mm</span>
              </dd>
            </div>
          ) : null}
        </dl>
        <KeysHint text={keysHint} />
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}

/** 색표를 CSS 가로 그라디언트로. 진폭 축이 0~ampMax % 이므로 색표(0~100 %)는 그 비율만큼, 나머지는 마지막 색 */
function colorbarCss(palette: readonly string[], ampMax = 100): string {
  const stops: string[] = []
  const span = Math.min(1, 100 / ampMax)
  for (let i = 0; i <= 16; i++) {
    const idx = Math.min(255, Math.round((i * 255) / 16))
    stops.push(`#${palette[idx] ?? '000000'} ${((i / 16) * span * 100).toFixed(1)}%`)
  }
  if (span < 1) stops.push(`#${palette[255] ?? '000000'} 100%`)
  return `linear-gradient(to right, ${stops.join(', ')})`
}
