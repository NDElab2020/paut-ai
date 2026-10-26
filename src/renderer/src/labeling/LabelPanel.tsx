/**
 * 라벨 패널 몸 (오른쪽 열, LabelSide 안) — 전문가가 앱에서 파일 하나를 라벨하는 흐름 (계획_라벨링 1b, 규격_초안.md 3·4·7절, 지침서 순서).
 *   세트: 지금 라벨러 · 지침서 버전 · 판독 단계 → 그 세트의 기록·검토 구간·관측 행을 불러온다 (2인 독립 모드면 남의 세트는 서비스가 숨김).
 *     블라인드 제출(잠금) · '설계값 대조 시작'(블라인드를 복사한 대조 세트) — 제출한 세트·확정 세트는 여기서 보기만 한다.
 *   두 도구: '새 기록'(① 단면 ② 길이 + 앱 제안 비교 ③ 속성 → 저장) · '검토 구간'(형상 에코 후보 → 검토 완료·품질 불량·기준 미만, 지침서 순서).
 *   지시 표: 행 → 그 자리로 · 고치기 · 지움 표시 · 그때 화면 · 관측 표 확인. 장면 미리보기(켜면). 단축키 표.
 *   덮개: 저장한 기록 상자·팁 점·에코 띠·검토 구간·(켜면) 장면 세 상태 → onOverlays (뷰어가 초안 덮개와 합침).
 *   작업 이벤트: 세션은 뷰어(props.work)가 들고 있고, 패널은 세트를 정해 주고 기록 생성·수정·삭제·검토 완료·라벨 추가 작업을 남긴다.
 * 진폭은 늘 파일 이득 그대로(소프트 이득 0 dB) — props.groups[].amplitude / volume. 계산은 analysis.ts(derive), 기록 만들기는 record.ts.
 * 신호 칸은 단면 둘레 최대(record.ts regionPeakOf), 고치기는 시작할 때의 버전으로 저장(그사이 바뀌면 CONFLICT → '다시 열기').
 * 라벨러가 바뀌면 앞 라벨러의 초안·고치기·제안을 비운다(2인 독립 모드에서 남의 작업을 보거나 내 세트로 저장하지 않게).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { LabelSession, LabelSetInfo } from '@shared/api'
import { defaultPost, scanIndexAt } from '@shared/imaging'
import {
  echoCandidateRecordFields,
  groupLevelsOf,
  labelSetId,
  newIndicationRecord,
  validateIndicationRecord,
  type EchoCandidate,
  type IndicationRecord,
  type LabelSetKey,
  type LengthSuggestion,
  type ObservationRow,
  type ObservationStatus,
  type PhysicalDefect,
  type ReviewInterval
} from '@shared/labels'
import type { DerivedFileLabels } from '@shared/labels'
import { getApi, toUiError, unwrap, type UiError } from '../api'
import { ErrorNotice } from '../components/ErrorNotice'
import { num } from '../lib/format'
import { confirmedRow, echoCandidatesFor, lengthSuggestionFor, observationsFor, openEchoCandidates, scenePreviewFor, type AnalysisFile, type ObservationLegView } from './analysis'
import { EchoSection } from './EchoSection'
import { newUuid } from './events'
import { IndicationTable } from './IndicationTable'
import { KeyHelp } from './KeyHelp'
import { defaultSetChoice, designSeenForced, resolveSet, suggestionVisibility } from './labelSet'
import { initialPanelState, panelReducer, type PanelAction, type PanelState } from './panelState'
import { MiniSeg } from './PanelParts'
import { ascanDepthReading, sscanPointReading, type PointReading } from './reading'
import {
  acceptedSuggestion,
  buildRecord,
  draftFromRecord,
  draftLength,
  echoRangeRect,
  beamTextOf,
  draftWarnings,
  formFromRecord,
  gotoTargetOf,
  lengthMethodFor,
  lengthPointsFor,
  firstRole,
  nextExternalRef,
  nextRole,
  peakPointOf,
  postWithSnapshot,
  recordNumbers,
  regionPeakOf,
  sectionChecklist,
  sectionPoints,
  signalOf,
  snapshotFormatSourceOf,
  snapshotOf,
  snapshotCursor,
  type GatePeakSample,
  type VolumeSource
} from './record'
import { recordOverlays } from './recordOverlays'
import { RecordSection } from './RecordSection'
import { fullScanRange, reviewGateRange, reviewIntervalOf } from './review'
import { ReviewSection } from './ReviewSection'
import { panelSessionGet, panelSessionSet } from './session'
import { SetBar } from './SetBar'
import { EMPTY_DRAFT, labelReducer, type LabelDraft, type LabelDraftPoint } from './state'
import type { LabelPanelProps } from './types'

interface SetData {
  setId: string | null
  /** 지움 표시 포함 (고정 지시 번호를 다시 쓰지 않게) */
  all: IndicationRecord[]
  records: IndicationRecord[]
  reviews: ReviewInterval[]
  observations: ObservationRow[]
  loading: boolean
}

const EMPTY_DATA: SetData = { setId: null, all: [], records: [], reviews: [], observations: [], loading: false }

/** 세트가 없을 때 계산용 임시 세트 (저장은 하지 않는다) */
function scratchKey(sha256: string): LabelSetKey {
  return { sha256, labelerId: '(라벨러 없음)', guidelineVersion: 'v1', readingStage: 'blind' }
}

/** 초안 위치(점·사각형)의 지문 — 고치기에서 위치를 바꿨는지(화면 스냅샷을 새로 찍을지) 가린다 */
function draftPosKey(d: Pick<LabelDraft, 'points' | 'rect'>): string {
  return JSON.stringify([d.points.map((p) => [p.id, p.role, p.groupId, p.scanIndex, p.vMm, p.unfoldedDepthMm, p.beam, p.sample]), d.rect])
}

/** 단면(점·사각형)의 지문 — 같은 단면이면 앱 제안을 다시 계산하지 않는다 */
function sectionKeyOf(d: Pick<LabelDraft, 'points' | 'rect'>): string {
  return JSON.stringify([sectionPoints(d).map((p) => [p.id, p.groupId, p.scanIndex, p.vMm, p.unfoldedDepthMm]), d.rect])
}

const FINAL_TEXT = "확정 세트는 '라벨 관리 → 검수 → Level III 확정'에서만 만들고 고칩니다. 여기서는 볼 수만 있습니다."
const SUBMITTED_TEXT = "제출(잠금)한 세트라 고치지 않습니다 — 블라인드 기준선을 지키려고. 설계값을 본 뒤에는 세트 줄의 '설계값 대조 시작'으로 만든 사본에서 고칩니다."

export function LabelPanel(props: LabelPanelProps) {
  const api = getApi()
  const { state, dispatch, sha256, thicknessMm: t, cursor, work } = props
  const { draft, ui } = state
  const [panel, dispatchPanel] = useReducer(panelReducer, props.viewerKey, (k: string): PanelState => panelSessionGet(k) ?? initialPanelState())
  useEffect(() => panelSessionSet(props.viewerKey, panel), [props.viewerKey, panel])
  const P = (a: PanelAction): void => dispatchPanel(a)
  const topRef = useRef<HTMLSpanElement>(null)

  // ── 세션 · 세트 목록 ──
  const [session, setSession] = useState<LabelSession | null>(null)
  const [sets, setSets] = useState<LabelSetInfo[]>([])
  const [error, setError] = useState<{ title: string; error: UiError } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * 저장·지움 표시로 자동 풀린 검토 완료 구간 알림을 지켜본다: 그 구간들이 풀린 채로 보인 뒤(다시 읽은 뒤), 모두 '다시 검토 완료로'(또는 지움)
   * 되면 알림을 닫는다 — 할 일을 마쳤는데도 '다시 검토하고 누르세요'가 남지 않게 (2026-10-07 화면 점검)
   */
  const [releasedWatch, setReleasedWatch] = useState<{ notice: string; uuids: string[]; seen: boolean } | null>(null)
  const showReleased = (text: string, released: readonly ReviewInterval[]): void => {
    setNotice(text)
    setReleasedWatch(released.length ? { notice: text, uuids: released.map((v) => v.uuid), seen: false } : null)
  }
  const [busy, setBusy] = useState(false)
  const reloadSets = useCallback(async (): Promise<void> => {
    try {
      const [s, list] = await Promise.all([unwrap(api.labels.session()), unwrap(api.labels.listSets({ sha256 }))])
      setSession(s)
      setSets(list)
    } catch (e) {
      setError({ title: '라벨 세션을 읽지 못했습니다', error: toUiError(e) })
    }
  }, [api, sha256])
  useEffect(() => {
    void reloadSets()
  }, [reloadSets])

  const choice = panel.setChoice ?? defaultSetChoice(sets, sha256, session?.labelerId ?? null)
  const ready = resolveSet(session, sha256, choice, sets)
  const setId = ready.ok ? labelSetId(ready.key) : null
  // 같은 세트면 같은 객체 (아래 계산 메모가 다시 돌지 않게)
  const setKey = useMemo<LabelSetKey | null>(() => (ready.ok ? ready.key : null), [setId])
  const blind = session?.blindMode ?? false
  const stage = setKey?.readingStage ?? null
  const setInfo = setId ? (sets.find((x) => x.setId === setId) ?? null) : null
  const submittedAt = setInfo?.submittedAt ?? null
  const readOnly: string | null = stage === 'final' ? FINAL_TEXT : submittedAt ? SUBMITTED_TEXT : null

  // ── 라벨러가 바뀌면 앞 라벨러의 초안·고치기·제안을 버린다 (패널 안 변경·라벨 관리 변경 모두) ──
  const labelerId = session?.labelerId ?? null
  useEffect(() => {
    if (!session) return
    if (panel.owner !== null && labelerId !== panel.owner) {
      dispatch({ type: 'loadDraft', draft: EMPTY_DRAFT })
      dispatch({ type: 'setTimeCursor', cursor: null })
      P({ type: 'resetForLabeler', owner: labelerId, stage: 'blind' })
      setNotice('라벨러가 바뀌어 앞 라벨러의 초안(점·사각형·R·검토 구간)과 고치던 기록을 비웠습니다.')
    } else if (panel.owner === null && labelerId !== null) P({ type: 'setOwner', owner: labelerId })
    // 라벨러가 바뀔 때만
  }, [session, labelerId, panel.owner])

  // ── 작업 이벤트 세션 (뷰어가 들고 있음): 세트를 알려 준다 ──
  const sessionLoaded = session !== null
  useEffect(() => {
    if (setKey) work.setKey(setKey)
    else if (sessionLoaded && !ready.ok) work.end()
  }, [setKey, sessionLoaded, ready.ok, work])

  // ── 세트 데이터 ──
  const [data, setData] = useState<SetData>(EMPTY_DATA)
  const seq = useRef(0)
  const reload = useCallback(async (): Promise<void> => {
    const my = ++seq.current
    if (!setKey) {
      setData(EMPTY_DATA)
      return
    }
    setData((d) => ({ ...d, loading: true }))
    try {
      const [all, reviews] = await Promise.all([
        unwrap(api.labels.listRecords({ sha256, set: setKey, includeDeleted: true })),
        unwrap(api.labels.listReviews({ sha256, set: setKey, includeReleased: true }))
      ])
      const records = all.filter((r) => !r.deleted)
      const observations = records.length ? await unwrap(api.labels.listObservations({ recordUuids: records.map((r) => r.uuid) })) : []
      if (my === seq.current) setData({ setId: labelSetId(setKey), all, records, reviews, observations, loading: false })
    } catch (e) {
      if (my === seq.current) {
        setData((d) => ({ ...d, loading: false }))
        setError({ title: '라벨 기록을 읽지 못했습니다', error: toUiError(e) })
      }
    }
  }, [api, sha256, setKey])
  useEffect(() => {
    void reload()
  }, [reload])
  const loaded = data.setId === setId && !data.loading
  const records = data.setId === setId ? data.records : EMPTY_DATA.records
  const reviews = data.setId === setId ? data.reviews : EMPTY_DATA.reviews
  const observations = data.setId === setId ? data.observations : EMPTY_DATA.observations
  useEffect(() => {
    if (!releasedWatch || !loaded) return
    const stillReleased = reviews.some((v) => releasedWatch.uuids.includes(v.uuid) && v.released && !v.deleted)
    if (stillReleased) {
      if (!releasedWatch.seen) setReleasedWatch({ ...releasedWatch, seen: true })
      return
    }
    if (!releasedWatch.seen) return
    setNotice((n) => (n === releasedWatch.notice ? null : n))
    setReleasedWatch(null)
  }, [releasedWatch, reviews, loaded])

  // ── 설계값 대조·확정 단계: 물리 결함 ID 고르기 목록, 지시 표의 정답 줄(근거 등급·확정/미확정) ──
  const [defects, setDefects] = useState<PhysicalDefect[]>([])
  useEffect(() => {
    if ((stage !== 'reconciled' && stage !== 'final') || blind) {
      setDefects([])
      return
    }
    let alive = true
    void api.labels.physicalDefects({ sha256 }).then((r) => alive && setDefects(r.ok ? r.data : []))
    return () => {
      alive = false
    }
  }, [api, sha256, stage, blind])

  // ── 그룹 · 읽기값 ──
  const groupMap = useMemo(() => new Map(props.groups.map((g) => [g.group.id, g.group] as const)), [props.groups])
  const shownGroups = useMemo(() => props.groups.filter((g) => g.shown).map((g) => g.group), [props.groups])
  const groupName = (id: number | null): string => (id === null ? '모든 그룹' : (groupMap.get(id)?.name ?? `그룹 ${id}`))
  const sourceOf = (id: number): LabelPanelProps['groups'][number] | undefined => props.groups.find((g) => g.group.id === id)
  /** 점의 읽기값. 조회표 끝 빔 선 위의 정수 빔 점(N·국소 최대)은 sscanLookupAt 이 비므로 그 빔 A-scan 으로 읽는다 */
  const readingOf = (p: LabelDraftPoint): PointReading | null => {
    const src = sourceOf(p.groupId)
    if (!src) return null
    const r = sscanPointReading(src.group, src.volume, p.scanIndex, p.vMm, p.unfoldedDepthMm, t)
    if (r) return r
    return Number.isInteger(p.beam) ? ascanDepthReading(src.group, src.volume, p.scanIndex, p.beam, p.unfoldedDepthMm, t) : null
  }
  const levelsOf = (id: number): ReturnType<typeof groupLevelsOf> => {
    const g = groupMap.get(id)
    return g ? groupLevelsOf(g, t) : null
  }
  const gatePeak: GatePeakSample = (gid, k, b) => {
    const cs = sourceOf(gid)?.volume?.cscan
    if (!cs || k < 0 || k >= cs.scanCount || b < 0 || b >= cs.beamCount) return null
    const s = cs.peakSample[k * cs.beamCount + b]!
    return s >= 0 ? s : null
  }
  const volumeSource = useCallback<VolumeSource>(
    (gid) => {
      const src = props.groups.find((g) => g.group.id === gid)
      return src ? { group: src.group, volume: src.volume } : null
    },
    [props.groups]
  )
  // 계산 입력은 그룹·진폭이 그대로면 같은 객체 — 화면 이득(=/−)을 바꿔도 관측 표·형상 에코 계산(derive)이 다시 돌지 않게 (derive 는 이득과 무관)
  const analysisRef = useRef<AnalysisFile | null>(null)
  const analysisFile = ((): AnalysisFile => {
    const prev = analysisRef.current
    const weld = props.info.specimen.weld
    const gs = props.groups
    if (
      prev &&
      prev.sha256 === sha256 &&
      prev.thicknessMm === t &&
      prev.weld === weld &&
      prev.groups.length === gs.length &&
      prev.groups.every((x, i) => x.group === gs[i]!.group && x.amplitude === gs[i]!.amplitude)
    ) {
      return prev
    }
    const next: AnalysisFile = { sha256, thicknessMm: t, weld, groups: gs.map((g) => ({ group: g.group, amplitude: g.amplitude })) }
    analysisRef.current = next
    return next
  })()

  const beamText = beamTextOf

  // ── 새 기록: 미리 보기 (문제·경고·신호·높이) ──
  const editingBase = panel.editingBase
  const liveEditing = panel.editingUuid ? (records.find((r) => r.uuid === panel.editingUuid) ?? null) : null
  const editingGone = panel.editingUuid !== null && loaded && liveEditing === null
  const len = draftLength(draft)
  // 신호 = 단면 둘레 최대 (찍은 점 한 픽셀이 아니라)
  const region = useMemo(() => regionPeakOf(draft, volumeSource, t), [draft, volumeSource, t])
  const clickedPk = peakPointOf(draft, readingOf)
  const clicked = clickedPk?.fromPeak ? clickedPk.reading : null
  const visibility = suggestionVisibility(blind, len !== null)
  const shownSuggestion = visibility === 'show' ? (panel.shown?.suggestion ?? null) : null
  const buildInput = {
    key: setKey ?? scratchKey(sha256),
    base: editingBase,
    draft,
    form: panel.form,
    groups: groupMap,
    thicknessMm: t,
    peak: region.reading,
    clicked,
    volumeReady: !region.volumeMissing,
    levelsOf,
    shownSuggestion,
    qualification: session?.labeler?.qualification ?? null
  }
  const preview = buildRecord({ ...buildInput, uuid: editingBase?.uuid ?? '00000000-0000-4000-8000-000000000000', viewSnapshot: null })
  const previewSignal = region.reading ? signalOf(region.reading, groupMap.get(region.reading.groupId) ?? null, levelsOf(region.reading.groupId), len?.lengthMm ?? null, t) : null
  const previewHeight = panel.form.kind === 'defect' && panel.form.heightMethod !== 'unmeasurable' ? (preview.record?.height.valueMm ?? null) : null
  // 초안 경고 (최대 진폭 빔 · 대조 전 · OPD 스캔 동기·추정 눈금·두께) — 순수 함수 record.ts draftWarnings (시험 tests/labeling/recordFix.test.ts)
  const { warnings: peakWarn, peakBeam, ampEstimated } = draftWarnings({ draft, groups: groupMap, info: props.info, length: len, peak: region.reading })
  const draftStarted = draft.points.length > 0 || draft.rect !== null || panel.editingUuid !== null
  const belowEvaluation = panel.form.kind === 'defect' && preview.record?.signal.exceedsEvaluationLevel === false
  const canSaveRecord = ready.ok && readOnly === null && !panel.conflict && preview.problems.length === 0 && preview.record !== null && !busy

  // 찍을 점 자동 넘김: 지금 역할의 점을 찍으면 다음 빈 칸으로 (점 도구일 때만)
  const prevCount = useRef(draft.points.length)
  useEffect(() => {
    const added = draft.points.length > prevCount.current
    prevCount.current = draft.points.length
    if (ui.tool !== 'point') return
    // 초안을 비우면(저장·지우기·그만두기) 첫 칸(최대 진폭)부터
    if (draft.points.length === 0) {
      const first = firstRole(sectionChecklist(panel.form, draft))
      if (first && first !== ui.pointRole) dispatch({ type: 'setPointRole', role: first })
      return
    }
    if (!added) return
    const items = sectionChecklist(panel.form, draft)
    if (items.some((i) => i.id === ui.pointRole && !i.done)) return
    const nx = nextRole(items)
    if (nx && nx !== ui.pointRole) dispatch({ type: 'setPointRole', role: nx })
    // 점 수가 바뀔 때만
  }, [draft.points.length])
  // 높이 방식·구분을 바꾸면 지금 역할이 목록에 없을 때 첫 빈 칸으로
  useEffect(() => {
    if (ui.tool !== 'point') return
    const items = sectionChecklist(panel.form, draft)
    if (ui.pointRole === 'other' || items.some((i) => i.id === ui.pointRole)) return
    const nx = nextRole(items)
    if (nx) dispatch({ type: 'setPointRole', role: nx })
  }, [panel.form.heightMethod, panel.form.kind])

  // 화면 스냅샷은 첫 점(또는 사각형)을 찍은 때의 화면 (저장한 때가 아니라) — 새 기록만
  // OPD 는 찍을 때의 읽기 규칙·진폭 눈금·V 부호 추정 여부를 스냅샷에 남긴다 (NDE 는 null → 스냅샷 그대로)
  const formatSource = useMemo(() => snapshotFormatSourceOf(props.info), [props.info])
  const snapshotNow = (): unknown =>
    snapshotOf(
      props.post,
      props.groups.map((g) => g.group.id),
      { groupId: cursor.activeGroupId, scanMm: cursor.scanMm, beam: cursor.beam[cursor.activeGroupId] ?? 0 },
      formatSource
    )
  const draftEmpty = draft.points.length === 0 && draft.rect === null
  useEffect(() => {
    if (panel.editingUuid) return
    if (draftEmpty) {
      if (panel.snapshot !== null) P({ type: 'setSnapshot', snapshot: null })
    } else if (panel.snapshot === null) P({ type: 'setSnapshot', snapshot: snapshotNow() })
  }, [draftEmpty, panel.editingUuid])

  // ── 길이 ──
  const [lengthNote, setLengthNote] = useState<string | null>(null)
  const refGroup = draft.ref ? groupMap.get(draft.ref.groupId) : undefined
  const refText = draft.ref ? `${num(draft.ref.scanMm)} → ${num(cursor.scanMm)} mm · ${groupName(draft.ref.groupId)}` : null
  /** 위치 계산만 하는 기록 (속성·높이 문제는 무시, 결함으로) — 길이 제안 계산용 */
  const assembleForAnalysis = (d: typeof draft): IndicationRecord | null =>
    buildRecord({
      key: setKey ?? scratchKey(sha256),
      uuid: '00000000-0000-4000-8000-000000000000',
      base: null,
      draft: d,
      form: { ...panel.form, kind: 'defect', heightMethod: 'unmeasurable', existenceConfidence: 'certain', defectType: panel.form.defectType ?? 'planar-presumed' },
      groups: groupMap,
      thicknessMm: t,
      peak: null,
      positionOnly: true,
      levelsOf,
      shownSuggestion: null,
      viewSnapshot: null
    }).record
  /**
   * 전문가가 길이를 정한 그때 한 번 제안을 계산해 고정한다 (2인 독립 모드면 계산도 하지 않음).
   * 같은 단면이면 다시 '이 길이로'를 눌러도 다시 계산하지 않고, 처음 잰 값(제안을 보기 전)도 덮지 않는다.
   */
  const computeShown = (pts: NonNullable<ReturnType<typeof lengthPointsFor>>): void => {
    if (blind) return
    const sk = sectionKeyOf(draft)
    if (panel.shown && panel.shown.sectionKey === sk) return
    const next = labelReducer(state, { type: 'setPoints', points: pts }).draft
    const l = draftLength(next)
    let r: { suggestion: LengthSuggestion | null; reason: string | null }
    try {
      const rec = panel.form.kind === 'defect' ? assembleForAnalysis(next) : null
      r =
        panel.form.kind !== 'defect'
          ? { suggestion: null, reason: '결함 기록만 길이를 제안합니다.' }
          : rec
            ? lengthSuggestionFor(analysisFile, setKey ?? scratchKey(sha256), rec, { method: lengthMethodFor(t, panel.form.lengthMethod), outerDiameterMm: panel.form.outerDiameterMm })
            : { suggestion: null, reason: '단면 점이 없어 제안할 수 없습니다.' }
    } catch (e) {
      // 계산이 실패해도 전문가 길이는 그대로 — 이유만 보인다
      r = { suggestion: null, reason: `제안을 계산하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` }
    }
    P({ type: 'setShown', shown: { suggestion: r.suggestion, reason: r.reason, expertStartMm: l?.startMm ?? 0, expertEndMm: l?.endMm ?? 0, sectionKey: sk } })
  }
  const commitLength = (): void => {
    const ref = draft.ref
    if (!ref || !refGroup) return
    const endK = cursor.scanIndex[ref.groupId] ?? scanIndexAt(cursor.scanMm, refGroup.scan)
    const pts = lengthPointsFor(refGroup, draft, ref, endK, t, gatePeak, sourceOf(ref.groupId)?.displayGainDb ?? 0)
    if (!pts) {
      setLengthNote('R 칸의 그 빔에 게이트 신호가 없어 길이 점을 놓을 수 없습니다. 단면 점을 먼저 찍거나 신호가 있는 빔에서 R 을 정하세요.')
      return
    }
    setLengthNote(
      pts[0].scanMm === pts[1].scanMm
        ? '시작과 끝이 같은 칸입니다 (길이 0). 커서를 끝으로 옮긴 뒤 다시 누르세요.'
        : sectionPoints(draft).length === 0 && !draft.rect
          ? '단면 점이 없어 R 칸 게이트 최대로 길이 점을 놓았습니다. 저장하려면 단면(최대 진폭 점·팁·에코 범위)을 찍으세요.'
          : null
    )
    dispatch({ type: 'setPoints', points: pts })
    computeShown(pts)
  }
  const acceptSuggestion = (): void => {
    const s = panel.shown?.suggestion
    if (!s?.available || s.scanStartMm === null || s.scanEndMm === null || s.beam === null) return
    const g = groupMap.get(s.groupId)
    if (!g) return
    const ref = { groupId: s.groupId, scanMm: s.scanStartMm, beam: s.beam }
    const pts = lengthPointsFor(g, draft, ref, scanIndexAt(s.scanEndMm, g.scan), t, gatePeak, sourceOf(s.groupId)?.displayGainDb ?? 0)
    if (pts) dispatch({ type: 'setPoints', points: pts })
  }
  /** 길이 빔을 최대 진폭 빔으로: R 의 빔을 바꾸고 그 빔 C-scan 줄로 간다 (다시 '이 길이로') */
  const usePeakBeam = (): void => {
    if (peakBeam === null || !len) return
    if (draft.ref) dispatch({ type: 'setRef', ref: { ...draft.ref, beam: peakBeam } })
    props.onGoto({ groupId: len.groupId, scanMm: cursor.scanMm, beam: peakBeam })
    setLengthNote("R 의 빔을 최대 진폭 빔으로 바꿨습니다. 그 빔 C-scan 줄에서 끝을 확인하고 '이 길이로'를 다시 누르세요.")
  }

  // ── 에코 범위 자동 (최대 진폭 칸에서 평가 기준 이상 칸 덩어리) ──
  const [echoNote, setEchoNote] = useState<string | null>(null)
  const autoEchoRange = (): void => {
    const pk = sectionPoints(draft).find((p) => p.role === 'peak')
    const seed = pk ? { groupId: pk.groupId, scanIndex: pk.scanIndex, beam: pk.beam, sample: pk.sample, gain: pk.displayGainDb } : null
    const src = seed ? sourceOf(seed.groupId) : undefined
    if (!seed || !src) {
      setEchoNote('최대 진폭 점(N 또는 S-scan 클릭)을 먼저 찍으세요 — 그 칸에서 에코 범위를 찾습니다.')
      return
    }
    if (!src.volume) {
      setEchoNote('그룹 진폭을 아직 읽는 중입니다.')
      return
    }
    const lv = levelsOf(seed.groupId)
    if (!lv) {
      setEchoNote('평가 기준(Ref)을 정할 수 없어 에코 범위를 자동으로 찾지 못합니다. 사각형 도구(2)로 그리세요.')
      return
    }
    const r = echoRangeRect(src.group, src.volume, seed.scanIndex, seed, lv.evaluationPct, t, seed.gain)
    if (!r.rect) {
      setEchoNote(r.reason)
      return
    }
    dispatch({ type: 'setRect', rect: r.rect })
    setEchoNote(`평가 기준(${num(lv.evaluationPct)} %) 이상으로 이어진 칸 ${r.cells}개의 범위입니다. 영상에서 확인하고, 다르면 사각형 도구(2)로 다시 그리세요.`)
  }

  // ── 저장 ──
  const fail = (title: string, e: unknown, editing = false): void => {
    const err = toUiError(e)
    if (err.code === 'CONFLICT' && editing) {
      P({ type: 'setConflict', on: true })
      setError({
        title,
        error: { ...err, message: `${err.message} 고치던 초안은 그대로 두었습니다. '다시 열기'로 새 내용을 불러온 뒤 고치세요 (다시 저장해도 다른 곳의 변경을 덮지 않습니다).` }
      })
    } else setError({ title, error: err })
    if (err.code === 'CONFLICT') void reload()
  }
  const saveRecord = async (): Promise<void> => {
    if (!setKey || readOnly || panel.conflict) return
    const base = panel.editingBase
    // 고치기에서 점·사각형을 바꾸지 않았으면 기록의 화면 스냅샷을 그대로 (저장한 때 화면으로 바꾸면 내용이 바뀐 것이 됨)
    const sameGeom = base !== null && panel.editDraftKey === draftPosKey(draft)
    const viewSnapshot = sameGeom ? base.viewSnapshot : (panel.snapshot ?? snapshotNow())
    const out = buildRecord({ ...buildInput, uuid: base?.uuid ?? newUuid(), viewSnapshot })
    if (!out.record) return
    // 처음 저장할 때 고정 지시 번호 ('A1' … · 대조 단계에서 더한 것은 'C1' …) — 패널·검수·CSV 가 같은 이름을 쓰게
    const rec: IndicationRecord = base || out.record.externalRef ? out.record : { ...out.record, externalRef: nextExternalRef(data.all, setKey.readingStage) }
    setBusy(true)
    setError(null)
    try {
      const res = await unwrap(api.labels.saveRecord(rec))
      work.emit(base ? 'record-update' : 'record-create', { recordUuid: res.value.uuid, kind: res.value.kind, changed: res.changed })
      dispatch({ type: 'loadDraft', draft: EMPTY_DRAFT })
      // 다음 기록은 ① 단면부터 (점 도구)
      dispatch({ type: 'setTool', tool: 'point' })
      P({ type: 'saved', uuid: res.value.uuid, stage: setKey.readingStage })
      setLengthNote(null)
      setEchoNote(null)
      if (res.releasedReviews.length) {
        showReleased(
          `저장했습니다. ${base ? '위치·길이가 바뀌어' : '새 결함 기록과'} 겹치는 검토 완료 구간 ${res.releasedReviews.length}개가 자동으로 풀렸습니다 — 다시 검토하고 '다시 검토 완료로'를 누르세요.`,
          res.releasedReviews
        )
      } else {
        setReleasedWatch(null)
        setNotice(res.warnings.length ? `저장했습니다. 확인: ${res.warnings.slice(0, 2).join(' / ')}` : null)
      }
      topRef.current?.closest('.label-side__body')?.scrollTo?.({ top: 0 })
      await Promise.all([reload(), reloadSets()])
    } catch (e) {
      fail('기록을 저장하지 못했습니다', e, base !== null)
    } finally {
      setBusy(false)
    }
  }
  // Ctrl/Cmd+Enter = 저장 (새 기록 화면에서)
  const saveRef = useRef<() => void>(() => undefined)
  saveRef.current = () => {
    if (ui.tool !== 'review' && canSaveRecord) void saveRecord()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey) return
      e.preventDefault()
      saveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 지시 표 ──
  const numbers = useMemo(() => recordNumbers(records), [records])
  const selected = panel.selectedUuid ? (records.find((r) => r.uuid === panel.selectedUuid) ?? null) : null
  const goto = (r: IndicationRecord, withSnapshot = false): void => {
    // 최대 진폭 위치 → 단면 점 → 스냅샷 커서 → (그룹을 모르는 엑셀 기록) 지금 그룹·스캔 구간 가운데 (표에 '그룹 모름' 표시)
    const found = gotoTargetOf(r, cursor.activeGroupId)
    if (!found) return
    const { groupGuessed: _guess, ...target } = found
    const post = withSnapshot ? postWithSnapshot(props.post, r.viewSnapshot, props.groups.map((x) => x.group)) : null
    props.onGoto({ ...target, ...(post ? { post } : {}) })
  }
  const [pendingEdit, setPendingEdit] = useState<IndicationRecord | null>(null)
  const draftDirty = draft.points.length > 0 || draft.rect !== null
  const openEdit = (r: IndicationRecord): void => {
    const d = draftFromRecord(r, groupMap, t)
    dispatch({ type: 'loadDraft', draft: d })
    P({ type: 'startEdit', base: r, form: formFromRecord(r), draftKey: draftPosKey(d) })
    dispatch({ type: 'setTool', tool: 'point' })
    setPendingEdit(null)
    setLengthNote(null)
    setEchoNote(null)
    setError(null)
    goto(r)
  }
  const startEdit = (r: IndicationRecord): void => {
    if (draftDirty && panel.editingUuid !== r.uuid) setPendingEdit(r)
    else openEdit(r)
  }
  const cancelEdit = (): void => {
    dispatch({ type: 'loadDraft', draft: EMPTY_DRAFT })
    P({ type: 'newRecord', stage: stage ?? 'blind' })
  }
  const deleteRecord = async (r: IndicationRecord): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await unwrap(api.labels.deleteRecord(r.uuid))
      work.emit('record-delete', { recordUuid: r.uuid })
      if (panel.editingUuid === r.uuid) dispatch({ type: 'loadDraft', draft: EMPTY_DRAFT })
      P({ type: 'forget', uuid: r.uuid })
      if (res.releasedReviews.length) showReleased(`지움 표시했습니다. 겹치는 검토 완료 구간 ${res.releasedReviews.length}개가 풀렸습니다.`, res.releasedReviews)
      else {
        setReleasedWatch(null)
        setNotice(null)
      }
      await Promise.all([reload(), reloadSets()])
    } catch (e) {
      fail('지움 표시를 하지 못했습니다', e)
    } finally {
      setBusy(false)
    }
  }

  // ── 관측 표 ──
  const obsViews = useMemo(() => (selected && setKey ? safely(() => observationsFor(analysisFile, setKey, selected, observations)) : null), [selected, setKey, analysisFile, observations])
  const saveObservation = async (rows: ObservationRow[]): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      for (const row of rows) await unwrap(api.labels.saveObservation(row))
      await reload()
    } catch (e) {
      fail('관측 표를 저장하지 못했습니다', e)
    } finally {
      setBusy(false)
    }
  }
  const observe = (l: ObservationLegView, status: ObservationStatus): void => void saveObservation([confirmedRow(l.row, status, observations)])
  /** 한 그룹의 계산 상태를 그대로 확인 (그룹마다 한 번씩 — 모든 그룹을 한 번에 확인하지 않게) */
  const confirmGroup = (groupId: number): void => {
    const g = (obsViews ?? []).find((x) => x.groupId === groupId)
    const rows = (g?.legs ?? []).filter((l) => !l.expertConfirmed).map((l) => confirmedRow(l.row, l.status, observations))
    if (rows.length) void saveObservation(rows)
  }

  // ── 형상 에코 후보 ──
  const echo = useMemo(() => (panel.showEchoes ? safely(() => echoCandidatesFor(analysisFile, setKey ?? scratchKey(sha256), records)) : null), [panel.showEchoes, analysisFile, setKey, sha256, records])
  const openEchoes = useMemo(() => (echo ? openEchoCandidates(echo.candidates, records, panel.rejectedEchoes) : null), [echo, records, panel.rejectedEchoes])
  // 블라인드 판독이면 띠 위 결함 단서를 후보 목록에서도, 승인한 기록 메모에서도 숨긴다
  const hideEchoCues = blind || stage === 'blind'
  const approveEcho = async (c: EchoCandidate, edit: PanelState['echoEdit']): Promise<void> => {
    if (!setKey || readOnly) return
    const f = echoCandidateRecordFields(c, { hideCues: hideEchoCues })
    const rec = newIndicationRecord({
      uuid: newUuid(),
      sha256,
      labelerId: setKey.labelerId,
      guidelineVersion: setKey.guidelineVersion,
      readingStage: setKey.readingStage,
      readerDetail: { qualification: session?.labeler?.qualification ?? null },
      externalRef: nextExternalRef(data.all, setKey.readingStage),
      kind: f.kind,
      geometricEcho: { kind: edit?.kind ?? f.geometricEcho.kind, fromSuggestion: true },
      existenceConfidence: f.existenceConfidence,
      derived: { ...f.derived, ...(edit ? { scanStartMm: Math.min(edit.startMm, edit.endMm), scanEndMm: Math.max(edit.startMm, edit.endMm) } : {}) },
      signal: f.signal,
      knowledge: { designValueSeen: designSeenForced(setKey.readingStage) || panel.form.designValueSeen },
      viewSnapshot: snapshotOf(props.post, props.groups.map((g) => g.group.id), { groupId: c.groupId, scanMm: c.peakScanMm, beam: c.peakBeam }, formatSource),
      note: edit ? `${f.note} · 전문가가 고침` : f.note
    })
    const v = validateIndicationRecord(rec)
    if (!v.ok) {
      setError({ title: '형상 에코 기록을 만들지 못했습니다', error: { code: 'INVALID_ARGUMENT', message: v.errors.join(' / ') } })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await unwrap(api.labels.saveRecord(rec))
      work.emit('record-create', { recordUuid: res.value.uuid, kind: 'geometric-echo', fromSuggestion: c.id })
      // 라벨 추가 작업 (평가 정의 9절: 판독과 따로 센다)
      work.emit('label-extra', { action: 'echo-approve', recordUuid: res.value.uuid, edited: edit !== null })
      P({ type: 'setEchoEdit', edit: null })
      await Promise.all([reload(), reloadSets()])
    } catch (e) {
      fail('형상 에코를 저장하지 못했습니다', e)
    } finally {
      setBusy(false)
    }
  }

  // ── 검토 구간 ──
  const reviewGroups = draft.review ? (draft.review.groupId === null ? shownGroups : shownGroups.filter((g) => g.id === draft.review!.groupId)) : shownGroups.filter((g) => g.id === cursor.activeGroupId)
  const gate = reviewGateRange(reviewGroups.length ? reviewGroups : shownGroups, props.post, t)
  // 파일 게이트 (후처리 편집 없이) — 루트·몸체 게이트로 다시 본 좁은 게이트로 '검토 완료'를 저장하지 않게 알린다
  const fileGate = reviewGateRange(reviewGroups.length ? reviewGroups : shownGroups, defaultPost(props.post.fileSha256), t)
  const reviewBuild = reviewIntervalOf(setKey ?? scratchKey(sha256), '00000000-0000-4000-8000-000000000000', draft.review, panel.review, gate)
  const saveReviewInterval = async (v: ReviewInterval, label: string): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const res = await unwrap(api.labels.saveReview(v))
      if (res.value.kind === 'reviewed' && !res.value.released) {
        work.emit('review-complete', { reviewUuid: res.value.uuid, groupId: res.value.groupId, scanStartMm: res.value.scanStartMm, scanEndMm: res.value.scanEndMm })
      }
      work.emit('label-extra', { action: 'review-save', kind: res.value.kind, reviewUuid: res.value.uuid })
      await Promise.all([reload(), reloadSets()])
      return true
    } catch (e) {
      fail(label, e)
      return false
    } finally {
      setBusy(false)
    }
  }
  const saveReview = async (): Promise<void> => {
    if (!setKey || readOnly) return
    const b = reviewIntervalOf(setKey, newUuid(), draft.review, panel.review, gate)
    if (!b.interval) return
    if (await saveReviewInterval(b.interval, '검토 구간을 저장하지 못했습니다')) {
      dispatch({ type: 'setReview', review: null })
      P({ type: 'patchReview', patch: { note: '' } })
    }
  }
  /** 자동 풀린 검토 완료 구간을 다시 검토 완료로 (다시 본 뒤) */
  const unreleaseReview = (v: ReviewInterval): void => {
    void saveReviewInterval({ ...v, released: false }, '검토 구간을 다시 표시하지 못했습니다')
  }
  const deleteReview = async (v: ReviewInterval): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await unwrap(api.labels.deleteReview(v.uuid))
      await Promise.all([reload(), reloadSets()])
    } catch (e) {
      fail('검토 구간을 지우지 못했습니다', e)
    } finally {
      setBusy(false)
    }
  }
  /** 평가 기준 미만 지시: 결함 기록 대신 검토 구간 '기준 미만 지시' 초안으로 (지침서 5.2) */
  const toBelowThreshold = (): void => {
    const sec = sectionPoints(draft)
    const gid = region.groupId ?? sec[0]?.groupId ?? draft.rect?.groupId ?? cursor.activeGroupId
    const g = groupMap.get(gid)
    const res = g?.scan.resolutionMm ?? 1
    const span = len
      ? [len.startMm, len.endMm]
      : sec.length || draft.rect
        ? [Math.min(...sec.map((p) => p.scanMm), draft.rect?.scanMm ?? Infinity) - res, Math.max(...sec.map((p) => p.scanMm), draft.rect?.scanMm ?? -Infinity) + res]
        : [cursor.scanMm - res, cursor.scanMm + res]
    dispatch({ type: 'setReview', review: { groupId: gid, scanStartMm: span[0]!, scanEndMm: span[1]! } })
    P({ type: 'patchReview', patch: { kind: 'below-threshold' } })
    dispatch({ type: 'setTool', tool: 'review' })
    setNotice("기준 미만 지시 구간으로 옮겼습니다. 구간을 확인하고 '구간 저장'을 누르세요. 찍은 점은 초안에 남아 있습니다 — 필요 없으면 '초안 지우기'.")
  }

  // ── 장면 미리보기 (켜면, 늦춰 계산) ──
  const [scenes, setScenes] = useState<DerivedFileLabels | null>(null)
  useEffect(() => {
    if (!panel.preview || !setKey) {
      setScenes(null)
      return
    }
    const timer = setTimeout(() => setScenes(safely(() => scenePreviewFor(analysisFile, setKey, records, reviews, observations))), 80)
    return () => clearTimeout(timer)
  }, [panel.preview, setKey, analysisFile, records, reviews, observations])

  // ── 덮개 ──
  const scanKey = shownGroups.map((g) => `${g.id}:${cursor.scanIndex[g.id] ?? 0}`).join(',')
  const activeBeam = cursor.beam[cursor.activeGroupId] ?? 0
  const overlays = useMemo(
    () =>
      recordOverlays({
        records,
        reviews,
        numbers,
        selectedUuid: panel.selectedUuid,
        editingUuid: panel.editingUuid,
        groups: shownGroups,
        activeGroupId: cursor.activeGroupId,
        scanIndexOf: (id) => cursor.scanIndex[id] ?? 0,
        beamOf: (id) => cursor.beam[id] ?? 0,
        thicknessMm: t,
        echoCandidates: panel.showEchoes ? openEchoes : null,
        preview: panel.preview ? scenes : null
      }),
    // cursor 는 매번 새 객체라 칸 글자(scanKey)·활성 빔으로 건다
    [records, reviews, numbers, panel.selectedUuid, panel.editingUuid, shownGroups, cursor.activeGroupId, scanKey, activeBeam, t, panel.showEchoes, openEchoes, panel.preview, scenes]
  )
  const { onOverlays } = props
  useEffect(() => onOverlays(overlays), [onOverlays, overlays])
  useEffect(() => () => onOverlays(null), [onOverlays])

  const mode = ui.tool === 'review' ? 'review' : 'record'
  const groupsInfo = useMemo(
    () => new Map([...groupMap].map(([id, g]) => [id, { verified: g.verified, name: g.name, ampScale: g.ampScale, beams: g.beams, selfCheck: g.selfCheck }] as const)),
    [groupMap]
  )

  // ── 세트 제출 · 설계값 대조 시작 ──
  const submitSet = async (submit: boolean, reason?: string): Promise<void> => {
    if (!setKey) return
    setBusy(true)
    setError(null)
    try {
      await unwrap(api.labels.submitSet(setKey, submit, reason ? { reason } : undefined))
      setNotice(submit ? '이 세트를 제출(잠금)했습니다. 앞으로 이 세트는 고치지 않습니다.' : '제출을 풀었습니다 (이유가 기록에 남았습니다).')
      await reloadSets()
    } catch (e) {
      fail(submit ? '세트를 제출하지 못했습니다' : '제출을 풀지 못했습니다', e)
    } finally {
      setBusy(false)
    }
  }
  const startReconcile = async (): Promise<void> => {
    if (!setKey || setKey.readingStage !== 'blind') return
    setBusy(true)
    setError(null)
    try {
      const r = await unwrap(api.labels.startReconcile(setKey))
      dispatch({ type: 'loadDraft', draft: EMPTY_DRAFT })
      P({ type: 'setChoice', choice: { guidelineVersion: r.set.guidelineVersion, readingStage: 'reconciled' } })
      setNotice(
        `블라인드 세트를 복사해 설계값 대조 세트를 만들었습니다 (기록 ${r.records} · 검토 구간 ${r.reviewIntervals} · 확인한 관측 ${r.observations}). 블라인드 세트는 제출(잠금)됐습니다 — 이제 설계값을 보고 이 사본에서 고칩니다.`
      )
      await reloadSets()
    } catch (e) {
      fail('설계값 대조를 시작하지 못했습니다', e)
    } finally {
      setBusy(false)
    }
  }

  const multiGroup = shownGroups.length > 1
  // 형상 에코 후보 (검토 구간 모드에서는 위, 새 기록 모드에서는 지시 표 아래 — 같은 것 하나)
  const echoSection = (
    <EchoSection
      open={panel.showEchoes}
      onOpen={(open) => P({ type: 'setShowEchoes', on: open })}
      candidates={openEchoes}
      notes={echo?.notes ?? []}
      groups={groupMap}
      edit={panel.echoEdit}
      onEdit={(e) => P({ type: 'setEchoEdit', edit: e })}
      onApprove={(c, e) => void approveEcho(c, e)}
      onReject={(c) => P({ type: 'rejectEcho', id: c.id })}
      onGoto={(c) => props.onGoto({ groupId: c.groupId, scanMm: c.peakScanMm, beam: c.peakBeam })}
      busy={busy}
      canSave={ready.ok && readOnly === null}
      hideCues={hideEchoCues}
    />
  )

  return (
    <>
      <span ref={topRef} hidden />
      <SetBar
        session={session}
        sets={sets}
        sha256={sha256}
        ready={ready}
        choice={choice}
        open={panel.setOpen}
        busy={busy}
        submittedAt={submittedAt}
        copiedFrom={setInfo?.copiedFrom ?? null}
        hasRecords={records.length + reviews.length > 0}
        onOpen={(open) => P({ type: 'setOpen', open })}
        onChoice={(c) => {
          if (panel.editingUuid) dispatch({ type: 'loadDraft', draft: EMPTY_DRAFT })
          P({ type: 'setChoice', choice: c })
        }}
        onLabeler={(id) => {
          setBusy(true)
          void unwrap(api.labels.setSession({ labelerId: id }))
            .then(async () => {
              // 앞 라벨러의 초안·이력·고치기·제안을 바로 비운다 (세션을 다시 읽은 뒤의 검사보다 먼저)
              dispatch({ type: 'loadDraft', draft: EMPTY_DRAFT })
              dispatch({ type: 'setTimeCursor', cursor: null })
              P({ type: 'resetForLabeler', owner: id, stage: 'blind' })
              await reloadSets()
            })
            .catch((e: unknown) => setError({ title: '라벨러를 바꾸지 못했습니다', error: toUiError(e) }))
            .finally(() => setBusy(false))
        }}
        onSubmit={(submit, reason) => void submitSet(submit, reason)}
        onReconcile={() => void startReconcile()}
      />

      {error ? <ErrorNotice title={error.title} error={error.error} /> : null}
      {notice ? (
        <div className="notice notice--accent label-notice" role="status">
          <div className="notice__body">
            <p>{notice}</p>
          </div>
          <button type="button" className="btn btn--ghost btn--icon" aria-label="알림 닫기" title="알림 닫기" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}
      {work.error ? <p className="label-panel__note status status--attention">{work.error}</p> : null}
      {readOnly ? (
        <div className="notice notice--accent" role="status">
          <div className="notice__body">
            <p>{readOnly}</p>
          </div>
        </div>
      ) : null}
      {editingGone ? (
        <div className="notice notice--accent" role="alert">
          <div className="notice__body">
            <p>고치던 기록이 이 세트에서 없어졌습니다 (다른 곳에서 지움 표시했거나 저장소가 바뀜). 초안은 남아 있습니다.</p>
            <div className="label-actions">
              <button type="button" className="btn btn--secondary" onClick={() => P({ type: 'detachEdit' })}>
                새 기록으로 저장하기
              </button>
              <button type="button" className="btn btn--ghost" onClick={cancelEdit}>
                그만두기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {panel.conflict && liveEditing ? (
        <div className="notice notice--accent" role="alert">
          <div className="notice__body">
            <p>그사이 다른 곳에서 이 기록이 바뀌었습니다. 다시 열어 새 내용에서 고치세요 (지금 초안은 버립니다).</p>
            <div className="label-actions">
              <button type="button" className="btn btn--secondary" onClick={() => openEdit(liveEditing)}>
                다시 열기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="label-panel__mode">
        <MiniSeg<'record' | 'review'>
          label="라벨 작업"
          value={mode}
          returnFocus
          options={[
            { id: 'record', name: '새 기록', title: '지시 하나를 기록: 단면 → 길이 → 속성 → 저장 (도구 1 점 · 2 사각형 · 3 길이)' },
            { id: 'review', name: '검토 구간', title: '형상 에코 후보 → 검토 완료 · 품질 불량 · 기준 미만 구간 (도구 4)' }
          ]}
          onChange={(m) => dispatch({ type: 'setTool', tool: m === 'review' ? 'review' : 'point' })}
        />
      </div>
      {multiGroup ? (
        <p className="label-panel__note">
          그룹 {shownGroups.length}개를 함께 보면 영상이 작아 빔 줄을 정확히 누르기 어렵습니다.{' '}
          <button type="button" className="btn btn--link" onClick={() => props.onSingleGroup(cursor.activeGroupId)}>
            {groupName(cursor.activeGroupId)}만 보기
          </button>
        </p>
      ) : null}

      {pendingEdit ? (
        <div className="notice notice--accent" role="alert">
          <div className="notice__body">
            <p>찍던 초안이 있습니다. 버리고 기록 #{numbers.get(pendingEdit.uuid) ?? ''} 을 고칩니까?</p>
            <div className="label-actions">
              <button type="button" className="btn btn--secondary" onClick={() => openEdit(pendingEdit)}>
                초안 버리고 열기
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setPendingEdit(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'record' ? (
        readOnly ? null : (
          <RecordSection
            state={state}
            dispatch={dispatch}
            form={panel.form}
            onForm={(patch) => P({ type: 'patchForm', patch })}
            stage={stage}
            thicknessMm={t}
            editing={panel.editingUuid ? { uuid: panel.editingUuid, number: numbers.get(panel.editingUuid) ?? null } : null}
            onCancelEdit={cancelEdit}
            readingOf={readingOf}
            groupName={groupName}
            refLengthMm={props.lengthMm}
            refText={refText}
            length={len}
            lengthBeamText={len ? `${groupName(len.groupId)} · ${beamText(groupMap.get(len.groupId), len.beam)}` : null}
            onCommitLength={commitLength}
            onClearLength={() => dispatch({ type: 'removeRoles', roles: ['length-start', 'length-end'] })}
            lengthNote={lengthNote}
            onPeakBeam={peakBeam !== null ? usePeakBeam : null}
            visibility={visibility}
            shown={panel.shown}
            accepted={acceptedSuggestion(shownSuggestion, len)}
            onAccept={acceptSuggestion}
            onAutoRect={autoEchoRange}
            echoNote={echoNote}
            onBelowThreshold={belowEvaluation ? toBelowThreshold : null}
            build={draftStarted ? { ...preview, warnings: [...peakWarn, ...preview.warnings] } : { record: null, problems: [], warnings: [] }}
            signal={previewSignal}
            ampEstimated={ampEstimated}
            refBasis={region.reading ? (groupMap.get(region.reading.groupId)?.refBasis ?? null) : null}
            heightMm={previewHeight}
            canSave={canSaveRecord}
            busy={busy}
            onSave={() => void saveRecord()}
            hover={props.hover}
            timeReading={props.timeReading}
            onTimePoint={props.onTimePoint}
            physicalDefects={defects}
            blind={blind}
          />
        )
      ) : (
        <>
          {echoSection}
          {readOnly ? null : (
            <ReviewSection
              state={state}
              dispatch={dispatch}
              form={panel.review}
              onForm={(patch) => P({ type: 'patchReview', patch })}
              groups={shownGroups}
              activeGroupId={cursor.activeGroupId}
              fullRange={fullScanRange(reviewGroups.length ? reviewGroups : shownGroups)}
              gate={gate}
              fileGate={fileGate}
              problems={reviewBuild.problems}
              canSave={ready.ok && reviewBuild.interval !== null && !busy}
              busy={busy}
              onSave={() => void saveReview()}
              reviews={reviews}
              onDelete={(v) => void deleteReview(v)}
              onUnrelease={unreleaseReview}
              groupName={groupName}
            />
          )}
        </>
      )}

      <IndicationTable
        records={records}
        numbers={numbers}
        selectedUuid={panel.selectedUuid}
        editingUuid={panel.editingUuid}
        groups={groupsInfo}
        groupName={groupName}
        onSelect={(r) => {
          P({ type: 'select', uuid: r.uuid })
          goto(r)
        }}
        onEdit={startEdit}
        onDelete={(r) => void deleteRecord(r)}
        onSnapshot={(r) => goto(r, true)}
        hasSnapshot={(r) => snapshotCursor(r.viewSnapshot) !== null}
        gotoNote={(r) => (gotoTargetOf(r, cursor.activeGroupId)?.groupGuessed ? `그룹 모름 — 지금 그룹(${groupName(cursor.activeGroupId)})의 기록 스캔 구간 가운데로 이동` : null)}
        observations={obsViews}
        observationNote={selected && !obsViews ? '진폭을 읽는 중이라 관측 표를 계산하지 못했습니다.' : null}
        onObserve={observe}
        onConfirmGroup={confirmGroup}
        busy={busy || !ready.ok}
        readOnly={readOnly !== null}
        hideSuggestions={blind}
        physicalDefects={defects}
        loading={data.loading}
      />

      {mode === 'record' ? echoSection : null}

      <section className="label-panel__section" aria-label="장면 미리보기">
        <label className="check label-check" title="이 세트 기록·검토 구간으로 계산한 세 상태(양성·약한 양성·무시·음성)를 C-scan 첫 빔 줄 띠와 S-scan 상자로 봅니다 (규칙 버전 2)">
          <input type="checkbox" checked={panel.preview} disabled={!ready.ok} onChange={(e) => P({ type: 'setPreview', on: e.target.checked })} />
          <span>장면 세 상태 미리보기</span>
        </label>
        {panel.preview && scenes ? (
          <p className="label-panel__note num">
            양성 {scenes.stats.trainScenes.positive} · 약한 양성 {scenes.stats.scenes.weak} · 무시 {scenes.stats.trainScenes.ignore} · 음성 {scenes.stats.trainScenes.negative} · 모름 {scenes.stats.trainScenes.unknown} (장면 수)
          </p>
        ) : null}
      </section>

      <KeyHelp />
    </>
  )
}

/** 계산(derive)이 뜻밖의 값에서 실패해도 화면 전체가 멈추지 않게 — 실패하면 null (콘솔에 남김) */
function safely<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch (e) {
    console.error('라벨 계산 실패', e)
    return null
  }
}
