/**
 * 검수 탭 (3단계): 파일·시편 고르기 → 두 세트(A·B: 라벨러·판독 단계) 고르기 → 비교(shared/labels/review compareLabelSets)
 *   → [비교 표] 짝·A 만·B 만, mm 차이, 종류 일치, 요약 지표, 쌍 판정 표 CSV
 *   → [Level III 확정] 행마다 결정 → 설계값(물리 결함) 대조 → 확정 세트 저장 (라벨러 = 지금 라벨러)
 *   → [보고서] 평가 정의 10절 미리보기와 CSV.
 * 2인 독립 모드면 막고 이유를 보인다(검수는 Level III 몫). 행의 '영상으로 보기'는 이미지 보기로 그 기록 위치를 넘긴다.
 * 고른 것·비교 결과·결정은 앱을 닫기 전까지 남긴다(이미지 보기에 갔다 와도 그대로).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  ReviewCompareOptions,
  ReviewCompareRequest,
  ReviewComparison,
  ReviewCsvRequest,
  ReviewCsvResult,
  ReviewFinalOptions,
  ReviewFinalPreview,
  ReviewFinalRequest,
  ReviewFinalSaveOptions,
  ReviewFinalSaveResult,
  ReviewSideKey,
  ReviewSources
} from '@shared/api'
import type { ModuleId } from '@shared/modules'
import type { AdjudicationDecision, AdjudicationProvenance, AdjudicationRowResult, ComparisonPurpose, ReportHeaderInput } from '@shared/labels/review'
import type { IndicationRecord, ReadingStage } from '@shared/labels/types'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import { Status } from '../../components/Status'
import { DASH, dateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { SPLIT_LABEL } from './format'
import { ReviewFinalOptionsBar, ReviewFinalPanel } from './ReviewFinal'
import { ReviewReport } from './ReviewReport'
import { ReviewRows, rowMatchesFilter } from './ReviewRows'
import {
  FRAME_LABEL,
  PURPOSE_LABEL,
  ROW_FILTER_LABEL,
  UNIT_LABEL,
  ciText,
  fixed,
  parseSideKey,
  recordGroupId,
  sideKeyId,
  sideText,
  type RowFilter
} from './reviewFormat'

type View = 'compare' | 'decide' | 'report'

interface Memory {
  storeRoot: string | null
  scope: string
  excluded: string[]
  a: string | null
  b: string | null
  options: ReviewCompareOptions
  comparison: ReviewComparison | null
  askedKey: string | null
  decisions: Record<string, AdjudicationDecision>
  /** '남은 행 기본값 채우기'로 채운 행 (직접 고르면 빠진다) — 저장할 때 확인을 받는다 */
  autoFilled: string[]
  view: View
  filter: RowFilter
  finalOptions: ReviewFinalOptions
  header: ReportHeaderInput
}

/** 화면을 떠났다 와도(이미지 보기 등) 앱을 닫기 전까지 남기는 값. 저장소가 바뀌면 버린다 */
let memory: Memory | null = null

const STAGE_ORDER: Record<ReadingStage, number> = { blind: 0, reconciled: 1, final: 2 }
const VIEWS: ReadonlyArray<[View, string]> = [
  ['compare', '비교 표'],
  ['decide', 'Level III 확정'],
  ['report', '보고서']
]

interface SideOption {
  id: string
  key: ReviewSideKey
  name: string | null
  qualification: string | null
  files: number
  defects: number
}

function defaultsFor(storeRoot: string | null): Memory {
  return {
    storeRoot,
    scope: 'all',
    excluded: [],
    a: null,
    b: null,
    options: {},
    comparison: null,
    askedKey: null,
    decisions: {},
    autoFilled: [],
    view: 'compare',
    filter: 'all',
    // 형상 에코 등 비결함 기록은 A 것을 베끼는 것이 기본 — 확정 세트에서 형상 에코(결함 아님) 라벨이 빠지지 않게
    finalOptions: { design: { minTier: 'certified' }, carryNonDefect: 'a' },
    header: {}
  }
}

export function ReviewView(props: {
  version: number
  storeRoot: string | null
  navigate: (moduleId: ModuleId, params?: Record<string, string>) => void
  onChanged: () => void
  /** '학습 데이터 분할' 탭으로 (시험 세트 잠금·분할 바꾸기) */
  onOpenSplits: () => void
}) {
  const api = getApi()
  const ids = useId()
  const init = memory && memory.storeRoot === props.storeRoot ? memory : defaultsFor(props.storeRoot)
  const [scope, setScope] = useState(init.scope)
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set(init.excluded))
  const [aId, setAId] = useState<string | null>(init.a)
  const [bId, setBId] = useState<string | null>(init.b)
  const [options, setOptions] = useState<ReviewCompareOptions>(init.options)
  const [comparison, setComparison] = useState<ReviewComparison | null>(init.comparison)
  const [askedKey, setAskedKey] = useState<string | null>(init.askedKey)
  const [decisions, setDecisions] = useState<Record<string, AdjudicationDecision>>(init.decisions)
  const [autoFilled, setAutoFilled] = useState<ReadonlySet<string>>(new Set(init.autoFilled ?? []))
  const [fillNote, setFillNote] = useState<string | null>(null)
  const [view, setView] = useState<View>(init.view)
  const [filter, setFilter] = useState<RowFilter>(init.filter)
  const [finalOptions, setFinalOptions] = useState<ReviewFinalOptions>(init.finalOptions)
  const [header, setHeader] = useState<ReportHeaderInput>(init.header)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ title: string; error: UiError } | null>(null)
  const [csvDone, setCsvDone] = useState<ReviewCsvResult | null>(null)
  const [preview, setPreview] = useState<ReviewFinalPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<UiError | null>(null)
  const [previewSeq, setPreviewSeq] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<ReviewFinalSaveResult | null>(null)
  const [saveError, setSaveError] = useState<UiError | null>(null)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)
  const sources = useAsync(() => unwrap(api.labels.reviewSources()), [props.version])
  const src: ReviewSources | null = sources.data
  /** CSV 결과·오류 알림 자리 (아래쪽 버튼으로 저장해도 보이게 그리로 옮긴다) */
  const noticeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (csvDone || error) noticeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [csvDone, error])

  // 남기기
  useEffect(() => {
    memory = {
      storeRoot: props.storeRoot,
      scope,
      excluded: [...excluded],
      a: aId,
      b: bId,
      options,
      comparison,
      askedKey,
      decisions,
      autoFilled: [...autoFilled],
      view,
      filter,
      finalOptions,
      header
    }
  }, [props.storeRoot, scope, excluded, aId, bId, options, comparison, askedKey, decisions, autoFilled, view, filter, finalOptions, header])

  // 범위 (모든 파일 · 시편별)
  const files = src?.files ?? []
  const specimens = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of files) if (f.specimenId) m.set(f.specimenId, (m.get(f.specimenId) ?? 0) + 1)
    return [...m].sort((x, y) => x[0].localeCompare(y[0], 'ko'))
  }, [files])
  const inScope = files.filter((f) => scope === 'all' || f.specimenId === scope.slice(3))
  const picked = inScope.filter((f) => !excluded.has(f.sha256))

  // 세트 후보 (고른 파일에 있는 라벨러·단계·지침서)
  const sideOptions = useMemo<SideOption[]>(() => {
    const m = new Map<string, SideOption>()
    for (const f of picked) {
      for (const s of f.sets) {
        const key: ReviewSideKey = { labelerId: s.labelerId, readingStage: s.readingStage, guidelineVersion: s.guidelineVersion }
        const id = sideKeyId(key)
        const o = m.get(id) ?? { id, key, name: s.labelerName, qualification: s.qualification, files: 0, defects: 0 }
        o.files++
        o.defects += s.defectCount
        m.set(id, o)
      }
    }
    return [...m.values()].sort(
      (x, y) => STAGE_ORDER[x.key.readingStage] - STAGE_ORDER[y.key.readingStage] || y.files - x.files || x.key.labelerId.localeCompare(y.key.labelerId)
    )
    // picked 는 files·scope·excluded 로 정해진다
  }, [files, scope, excluded])

  // A·B 기본값(고른 세트가 후보에 없을 때만): 파일이 가장 많은 두 세트, 블라인드 먼저
  useEffect(() => {
    if (sideOptions.length < 2) return
    const known = new Set(sideOptions.map((o) => o.id))
    const a = aId !== null && known.has(aId) ? aId : sideOptions[0]!.id
    const b = bId !== null && known.has(bId) && bId !== a ? bId : (sideOptions.find((o) => o.id !== a)?.id ?? null)
    if (a !== aId) setAId(a)
    if (b !== bId) setBId(b)
  }, [sideOptions])

  const request: ReviewCompareRequest | null =
    aId && bId && aId !== bId && picked.length > 0 ? { sha256s: picked.map((f) => f.sha256).sort(), a: parseSideKey(aId), b: parseSideKey(bId), options } : null
  const requestKey = request ? JSON.stringify(request) : null
  const stale = comparison !== null && askedKey !== requestKey
  const purpose: ComparisonPurpose = options.purpose ?? 'inter-reader'

  const compare = async (): Promise<void> => {
    if (!request) return
    setBusy('두 세트를 비교하는 중입니다.')
    setError(null)
    setCsvDone(null)
    try {
      const r = await unwrap(api.labels.compareSets(request))
      // 같은 행이면(지문이 같으면) 고른 결정을 그대로 둔다
      if (!comparison || comparison.rowsKey !== r.rowsKey) {
        setDecisions({})
        setAutoFilled(new Set())
        setFillNote(null)
        setPreview(null)
        setSaved(null)
        setRestoreNote(null)
      }
      setComparison(r)
      setAskedKey(JSON.stringify(request))
    } catch (e) {
      setError({ title: '비교하지 못했습니다', error: toUiError(e) })
    } finally {
      setBusy(null)
    }
  }

  // 확정 미리보기: 결정·옵션이 바뀌면 잠깐 기다렸다 서비스에 다시 계산을 맡긴다
  const decisionList = useMemo(() => Object.values(decisions).sort((x, y) => (x.rowId < y.rowId ? -1 : 1)), [decisions])
  const finalRequest: ReviewFinalRequest | null =
    comparison && !stale ? { compare: comparison.request, rowsKey: comparison.rowsKey, decisions: decisionList, carryNonDefect: 'a', ...finalOptions } : null
  const finalKey = finalRequest ? JSON.stringify(finalRequest) : null
  const noAdjudicator = !src?.adjudicator
  const lastPreview = useRef(0)
  useEffect(() => {
    if (view !== 'decide' && view !== 'report') return
    if (!finalRequest || noAdjudicator || (view === 'report' && decisionList.length === 0)) return
    const seq = ++lastPreview.current
    setPreviewing(true)
    const t = setTimeout(() => {
      unwrap(api.labels.previewFinal(finalRequest))
        .then((p) => {
          if (seq !== lastPreview.current) return
          setPreview(p)
          setPreviewError(null)
        })
        .catch((e: unknown) => {
          if (seq !== lastPreview.current) return
          setPreviewError(toUiError(e))
        })
        .finally(() => {
          if (seq === lastPreview.current) setPreviewing(false)
        })
    }, 300)
    return () => {
      clearTimeout(t)
      if (seq === lastPreview.current) setPreviewing(false)
    }
  }, [finalKey, view, noAdjudicator, previewSeq, src?.adjudicator?.id])

  const save = async (o: ReviewFinalSaveOptions): Promise<void> => {
    if (!finalRequest) return
    setSaving(true)
    setSaveError(null)
    setSaved(null)
    try {
      const r = await unwrap(api.labels.saveFinal(finalRequest, o))
      setSaved(r)
      props.onChanged()
      setPreviewSeq((n) => n + 1)
    } catch (e) {
      setSaveError(toUiError(e))
    } finally {
      setSaving(false)
    }
  }

  const saveCsv = async (kind: ReviewCsvRequest['kind']): Promise<void> => {
    if (!comparison || stale) return
    const req: ReviewCsvRequest = { kind, compare: comparison.request, header, sensitivity: true }
    if ((kind === 'design' || kind === 'report') && finalRequest && decisionList.length > 0 && !noAdjudicator) {
      const { compare: _c, ...rest } = finalRequest
      void _c
      req.final = rest
    }
    setError(null)
    setCsvDone(null)
    let path: string | null
    try {
      path = await unwrap(api.labels.chooseReviewCsvPath(req))
    } catch (e) {
      setError({ title: '저장할 곳을 고르지 못했습니다', error: toUiError(e) })
      return
    }
    if (!path) return
    setBusy('CSV 를 쓰는 중입니다.')
    try {
      setCsvDone(await unwrap(api.labels.saveReviewCsv(req, path)))
    } catch (e) {
      setError({ title: 'CSV 를 저장하지 못했습니다', error: toUiError(e) })
    } finally {
      setBusy(null)
    }
  }

  const fileBySha = new Map((comparison?.files ?? []).map((f) => [f.sha256, f]))
  const canView = (sha: string): boolean => (fileBySha.get(sha)?.fileId ?? null) !== null
  const openViewer = (r: IndicationRecord): void => {
    const f = fileBySha.get(r.sha256)
    if (!f || f.fileId === null) return
    const scanMm = r.signal.peak?.scanMm ?? (r.derived.scanStartMm + r.derived.scanEndMm) / 2
    const g = recordGroupId(r)
    props.navigate('viewer', {
      fileId: String(f.fileId),
      ...(f.planId ? { planId: f.planId } : {}),
      scanMm: String(Math.round(scanMm * 1000) / 1000),
      ...(g !== null ? { groupId: String(g) } : {}),
      ...(r.signal.peak?.beam !== null && r.signal.peak?.beam !== undefined ? { beam: String(r.signal.peak.beam) } : {}),
      recordUuid: r.uuid,
      // 이미지 보기가 두 세트 기록을 함께 그린다 (읽기 전용 비교 보기)
      ...(comparison ? { compareA: sideKeyId(comparison.request.a), compareB: sideKeyId(comparison.request.b) } : {}),
      from: 'labels'
    })
  }

  const setDecision = (rowId: string, d: AdjudicationDecision | null): void => {
    setSaved(null)
    // 직접 고른 행은 자동 채움 표시를 뗀다
    setAutoFilled((cur) => {
      if (!cur.has(rowId)) return cur
      const n = new Set(cur)
      n.delete(rowId)
      return n
    })
    setDecisions((cur) => {
      const n = { ...cur }
      if (d === null) delete n[rowId]
      else n[rowId] = d
      return n
    })
  }

  /**
   * 남은 행만 기본값 (자동 채움 표시 — 저장할 때 '직접 보지 않았음' 확인을 받는다):
   *   2인 일치도·전문기관 대비(두 쪽이 대등): 짝 = A 채택. A 만·B 만은 채우지 않는다 — 한쪽만 찾은 결함을 기본으로 버리지 않게(직접 결정).
   *   정확도(A = 정답 쪽): 짝 = A, A 만 = A(참고 단위면 보류), B 만 = 결함 아님 (예측 쪽만 찾은 것).
   */
  const fillRemaining = (): void => {
    if (!comparison) return
    setSaved(null)
    const accuracy = comparison.comparison.purpose === 'accuracy'
    const filled: string[] = []
    let left = 0
    const n = { ...decisions }
    for (const r of comparison.comparison.rows) {
      if (n[r.id]) continue
      if (r.kind === 'pair') n[r.id] = { rowId: r.id, choice: 'a' }
      else if (accuracy && r.kind === 'only-a') n[r.id] = { rowId: r.id, choice: r.counted ? 'a' : 'defer' }
      else if (accuracy) n[r.id] = { rowId: r.id, choice: 'neither' }
      else {
        left++
        continue
      }
      filled.push(r.id)
    }
    setDecisions(n)
    setAutoFilled((cur) => new Set([...cur, ...filled]))
    setFillNote(
      left > 0
        ? `짝 ${filled.length}행을 A 채택으로 채웠습니다. 한쪽만 찾은 행 ${left}개는 두 판독자가 대등해 자동으로 버리지 않습니다 — 영상으로 보고 직접 고르세요.`
        : `${filled.length}행을 기본값으로 채웠습니다 (자동 채움 표시). 저장 전에 확인하세요.`
    )
  }

  const rowResults = useMemo(() => new Map<string, AdjudicationRowResult>((preview?.result.rows ?? []).map((r) => [r.rowId, r])), [preview])

  /**
   * 지난 확정에서 결정 불러오기: 저장된 확정 기록의 출처(adjudication — 행의 두 쪽 원본 기록 UUID·결정·칸 묶음·메모)를
   * 지금 행의 두 쪽 기록과 맞춰 결정을 되살린다. 기록을 만들지 않은 결정(결함 아님 · 보류 넣지 않음)은 되살릴 수 없다.
   * 지금 고른 결정은 덮지 않는다.
   */
  const restoreDecisions = async (): Promise<void> => {
    const adj = src?.adjudicator
    if (!comparison || !adj) return
    const gv = preview?.guidelineVersion ?? comparison.request.a.guidelineVersion
    setBusy('지난 확정 기록을 읽는 중입니다.')
    setError(null)
    try {
      const lists = await Promise.all(
        comparison.request.sha256s.map((sha) =>
          unwrap(api.labels.listRecords({ set: { sha256: sha, labelerId: adj.id, guidelineVersion: gv, readingStage: 'final' } }))
        )
      )
      const keyOf = (a: readonly string[], b: readonly string[]): string => `${[...a].sort().join(',')}|${[...b].sort().join(',')}`
      const found = new Map<string, AdjudicationProvenance>()
      for (const r of lists.flat()) {
        const prov = (r as IndicationRecord & { adjudication?: AdjudicationProvenance }).adjudication
        if (!prov || prov.format !== 'paut-adjudication' || prov.rowId === null) continue
        found.set(keyOf(prov.sources.a, prov.sources.b), prov)
      }
      const restored: Record<string, AdjudicationDecision> = {}
      for (const row of comparison.comparison.rows) {
        const prov = found.get(keyOf(row.a?.records.map((x) => x.uuid) ?? [], row.b?.records.map((x) => x.uuid) ?? []))
        if (!prov) continue
        const choice = prov.decision
        if (choice !== 'a' && choice !== 'b' && choice !== 'merge' && choice !== 'defer') continue
        restored[row.id] = {
          rowId: row.id,
          choice,
          ...(choice === 'merge' && prov.fieldSources ? { fields: { ...prov.fieldSources } } : {}),
          ...(prov.note ? { note: prov.note } : {})
        }
      }
      const n = Object.keys(restored).length
      setDecisions((cur) => ({ ...restored, ...cur }))
      setRestoreNote(
        n > 0
          ? `지난 확정에서 ${n}행의 결정을 불러왔습니다. 기록이 남지 않은 결정(결함 아님 등)은 다시 고르세요.`
          : '지난 확정 기록에서 지금 행과 맞는 결정을 찾지 못했습니다(기록이 바뀌었거나 다른 세트를 비교함).'
      )
    } catch (e) {
      setError({ title: '지난 확정 기록을 읽지 못했습니다', error: toUiError(e) })
    } finally {
      setBusy(null)
    }
  }

  if (sources.error) return <ErrorNotice title="검수 목록을 읽지 못했습니다" error={sources.error} onRetry={sources.reload} />
  if (!src) return <p className="text-subtle loading-line">검수 목록을 읽는 중입니다.</p>

  if (src.blocked) {
    return (
      <section className="labels-review" aria-labelledby={`${ids}-title`}>
        <h2 className="visually-hidden" id={`${ids}-title`}>
          검수
        </h2>
        <EmptyState title="검수는 Level III 몫이라 지금은 막혀 있습니다" desc={src.blocked} />
      </section>
    )
  }

  if (files.length === 0 || (sideOptions.length < 2 && scope === 'all' && excluded.size === 0)) {
    return (
      <section className="labels-review" aria-labelledby={`${ids}-title`}>
        <h2 className="visually-hidden" id={`${ids}-title`}>
          검수
        </h2>
        <EmptyState
          title="비교할 라벨 세트가 둘 이상 있어야 합니다"
          desc="같은 파일을 두 사람이 따로 판독한 엑셀(블라인드)을 가져오거나, 다른 PC 의 라벨 JSON 을 합치면 여기서 비교하고 Level III 가 확정합니다."
        />
      </section>
    )
  }

  const c = comparison?.comparison ?? null
  const sm = c?.summary
  const decidedCount = c ? c.rows.filter((r) => decisions[r.id]).length : 0
  const shownRows = c ? c.rows.filter((r) => rowMatchesFilter(r, filter, decisions[r.id] !== undefined)).length : 0
  const splitCounts = comparison
    ? comparison.files.reduce<Record<string, number>>((m, f) => ((m[SPLIT_LABEL[f.split ?? 'unassigned']] = (m[SPLIT_LABEL[f.split ?? 'unassigned']] ?? 0) + 1), m), {})
    : {}
  const sideLabel = (o: SideOption): string => `${sideText(o.key, o.name)} · 파일 ${o.files}`
  const compareIsPrimary = !(view === 'decide' && comparison && !stale)

  return (
    <section className="labels-review" aria-labelledby={`${ids}-title`}>
      <h2 className="visually-hidden" id={`${ids}-title`}>
        검수
      </h2>

      <div className="labels-review__pick" role="group" aria-label="비교할 파일과 세트">
        <div className="labels-review__pick-row">
          <label className="labels-review__opt">
            <span>범위</span>
            <span className="select">
              <select
                value={scope}
                disabled={!!busy}
                onChange={(e) => {
                  setScope(e.target.value)
                  setExcluded(new Set())
                }}
              >
                <option value="all">라벨 있는 모든 파일 ({files.length})</option>
                {specimens.map(([sp, n]) => (
                  <option key={sp} value={`sp:${sp}`}>
                    시편 {sp} · 파일 {n}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <details className="labels-review__files">
            <summary>
              파일 {inScope.length}개 중 {picked.length}개 고름
            </summary>
            <div className="labels-review__file-list">
              {inScope.map((f) => (
                <label key={f.sha256} className="check" title={`SHA-256 ${f.sha256}`}>
                  <input
                    type="checkbox"
                    checked={!excluded.has(f.sha256)}
                    onChange={() => {
                      const n = new Set(excluded)
                      if (!n.delete(f.sha256)) n.add(f.sha256)
                      setExcluded(n)
                    }}
                  />
                  <span>
                    {f.fileName}
                    <span className="t-caption">
                      {' '}
                      · {f.specimenId ?? DASH} · {SPLIT_LABEL[f.split ?? 'unassigned']} · 세트 {f.sets.length}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </details>
          <span className="toolbar__spacer" />
          {src.testLocked ? (
            <Status tone="ok" title={src.testLockedAt ? dateTime(src.testLockedAt) : undefined}>
              시험 세트 잠김
            </Status>
          ) : (
            <Status tone="muted">시험 세트 잠그지 않음</Status>
          )}
          <button type="button" className="btn btn--link" onClick={props.onOpenSplits} title="시편별 train·val·test 와 시험 세트 잠금">
            분할 보기
          </button>
        </div>
        <div className="labels-review__pick-row">
          <label className="labels-review__opt labels-review__side">
            <span>A</span>
            <span className="select">
              <select aria-label="A 세트" value={aId ?? ''} disabled={!!busy} onChange={(e) => setAId(e.target.value || null)}>
                {sideOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {sideLabel(o)}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="labels-review__opt labels-review__side">
            <span>B</span>
            <span className="select">
              <select aria-label="B 세트" value={bId ?? ''} disabled={!!busy} onChange={(e) => setBId(e.target.value || null)}>
                {sideOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {sideLabel(o)}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="labels-review__opt">
            <span>목적</span>
            <span className="select">
              <select value={purpose} disabled={!!busy} onChange={(e) => setOptions({ ...options, purpose: e.target.value as ComparisonPurpose })}>
                {(Object.keys(PURPOSE_LABEL) as ComparisonPurpose[]).map((p) => (
                  <option key={p} value={p}>
                    {PURPOSE_LABEL[p]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <button type="button" className={compareIsPrimary ? 'btn btn--primary' : 'btn btn--secondary'} disabled={!!busy || !request} onClick={() => void compare()}>
            {comparison && !stale ? '다시 비교' : '비교하기'}
          </button>
        </div>
        <details className="labels-review__more">
          <summary>
            매칭 인자 · {UNIT_LABEL[options.unit ?? 'grouping']} · {FRAME_LABEL[options.frame ?? 'file']} · X {options.scanGapMm ?? 10} mm · Y {options.depthDiffMm ?? 5} mm · 구간{' '}
            {options.gradingUnitMm ?? 20} mm
          </summary>
          <div className="labels-review__pick-row">
            <label className="labels-review__opt">
              <span>비교 단위</span>
              <span className="select">
                <select value={options.unit ?? 'grouping'} disabled={!!busy} onChange={(e) => setOptions({ ...options, unit: e.target.value as 'grouping' | 'record' })}>
                  <option value="grouping">{UNIT_LABEL.grouping}</option>
                  <option value="record">{UNIT_LABEL.record}</option>
                </select>
              </span>
            </label>
            <label className="labels-review__opt">
              <span>좌표 틀</span>
              <span className="select">
                <select value={options.frame ?? 'file'} disabled={!!busy} onChange={(e) => setOptions({ ...options, frame: e.target.value as 'file' | 'weld' })}>
                  <option value="file">{FRAME_LABEL.file}</option>
                  <option value="weld">{FRAME_LABEL.weld}</option>
                </select>
              </span>
            </label>
            {(
              [
                ['scanGapMm', 'X 스캔 간격 (mm)', 10],
                ['depthDiffMm', 'Y 깊이 차 (mm)', 5],
                ['gradingUnitMm', '구간 단위 (mm)', 20]
              ] as const
            ).map(([k, label, def]) => (
              <label key={k} className="labels-review__opt">
                <span>{label}</span>
                <input
                  className="input labels-review__num"
                  type="number"
                  min={k === 'gradingUnitMm' ? 1 : 0}
                  step={0.5}
                  value={options[k] ?? def}
                  disabled={!!busy}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    const next = { ...options }
                    if (e.target.value === '' || !Number.isFinite(v) || v === def) delete next[k]
                    else next[k] = v
                    setOptions(next)
                  }}
                />
              </label>
            ))}
          </div>
          <p className="t-caption">X·Y 는 0단계 2인 라벨로 정하고 시험 전에 동결하는 잠정값입니다(평가 정의 4.4·4.5절). 바꾸면 행 번호가 달라져 고른 결정을 다시 봐야 합니다.</p>
        </details>
      </div>

      {busy ? (
        <p className="labels-busy" role="status">
          {busy}
        </p>
      ) : null}
      <div ref={noticeRef} className="labels-review__notices">
        {error ? <ErrorNotice title={error.title} error={error.error} /> : null}
        {csvDone ? (
          <div className="notice notice--accent" role="status">
            <div className="notice__body">
              <p className="notice__title">CSV 를 저장했습니다: {csvDone.fileName}</p>
              <p className="t-caption">
                {csvDone.path} · {csvDone.rows}줄 · {Math.max(1, Math.round(csvDone.bytes / 1024))} KB (UTF-8, 엑셀에서 바로 열림)
              </p>
            </div>
            <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="알림 닫기" title="닫기" onClick={() => setCsvDone(null)}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
      </div>

      {!comparison ? (
        <p className="t-caption labels-review__hint">
          A·B 세트를 고르고 '비교하기'를 누르면 두 세트의 지시를 같은 규칙(매칭 v1)으로 짝짓습니다. 2인 블라인드 비교·AI 평가·전문기관 비교가 모두 같은 계산입니다.
        </p>
      ) : (
        <>
          {stale ? (
            <div className="notice notice--accent" role="status">
              <div className="notice__body">
                <p className="notice__title">고른 파일·세트·인자가 바뀌었습니다</p>
                <p>아래는 이전 비교 결과입니다. '비교하기'를 누르면 새로 계산합니다(행이 같으면 고른 결정은 그대로 둡니다).</p>
              </div>
            </div>
          ) : null}
          {sm && c ? (
            <div className="labels-review__stats" aria-label="요약 지표">
              <div className="stat">
                <span className="stat__value">
                  {sm.counts.pairs}
                  <span className="stat__unit"> · {sm.counts.onlyA} · {sm.counts.onlyB}</span>
                </span>
                <span className="stat__label">짝 · A 만 · B 만</span>
              </div>
              <div className="stat">
                <span className="stat__value">{fixed(sm.detection.f1, 2)}</span>
                <span className="stat__label" title={`${purpose === 'inter-reader' ? 'A 기준 B' : '재현율'} ${ciText(sm.detection.recall)}\n${purpose === 'inter-reader' ? 'B 기준 A' : '정밀도'} ${ciText(sm.detection.precision)}`}>
                  F1 · 재현 {sm.detection.recall.p !== null ? `${sm.detection.recall.x}/${sm.detection.recall.n}` : DASH} · 정밀{' '}
                  {sm.detection.precision.p !== null ? `${sm.detection.precision.x}/${sm.detection.precision.n}` : DASH}
                </span>
              </div>
              <div className="stat">
                <span className="stat__value">
                  {fixed(sm.errors.scanCenter.mae)}
                  <span className="stat__unit"> mm</span>
                </span>
                <span className="stat__label">스캔 중심 MAE · 95 % {fixed(sm.errors.scanCenter.p95Abs)}</span>
              </div>
              <div className="stat">
                <span className="stat__value">
                  {fixed(sm.errors.length.mae)}
                  <span className="stat__unit"> mm</span>
                </span>
                <span className="stat__label">길이 MAE · 95 % {fixed(sm.errors.length.p95Abs)}</span>
              </div>
              <div className="stat">
                <span className="stat__value">
                  {fixed(sm.errors.depthCenter.mae)}
                  <span className="stat__unit"> mm</span>
                </span>
                <span className="stat__label">깊이 중심 MAE · 95 % {fixed(sm.errors.depthCenter.p95Abs)}</span>
              </div>
              <div className="stat">
                <span className="stat__value">{fixed(sm.character.kappa.kappa, 2)}</span>
                <span className="stat__label">
                  종류 1단 κ · 일치 {sm.character.agreement !== null ? `${Math.round(sm.character.agreement * 100)} %` : DASH}
                </span>
              </div>
              <div className="stat">
                <span className="stat__value">{sm.grading ? fixed(sm.grading.agreement.kappa.kappa, 2) : DASH}</span>
                <span className="stat__label">구간 κ ({fixed(sm.grading?.unitMm ?? null, 0)} mm)</span>
              </div>
              <div className="stat">
                <span className="stat__value">
                  {sm.outside.aOnly}
                  <span className="stat__unit"> · {sm.outside.bOnly}</span>
                </span>
                <span className="stat__label" title="검토 범위 밖이라 미검출·오검출에서 뺀 짝 없는 단위 (따로 보고)">
                  범위 밖 A · B
                </span>
              </div>
            </div>
          ) : null}
          <p className="t-caption labels-review__ctx">
            {c?.name} · A {sideText(comparison.request.a)} · B {sideText(comparison.request.b)} · 검토 범위 {sm?.coverage.known ? `${fixed(sm.coverage.lengthMm, 0)} mm` : '모름'} ·
            파일 {comparison.files.length}개 ({Object.entries(splitCounts).map(([k, n]) => `${k} ${n}`).join(', ')})
            {c && c.warnings.length > 0 ? (
              <>
                {' '}
                ·{' '}
                <details className="labels-review__warn">
                  <summary>확인 사항 {c.warnings.length}건</summary>
                  <ul className="labels-msgs">
                    {c.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              </>
            ) : null}
          </p>

          <div className="labels-review__bar">
            <div className="seg" role="radiogroup" aria-label="검수 보기">
              {VIEWS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  className="seg__item"
                  aria-checked={view === v}
                  tabIndex={view === v ? 0 : -1}
                  onClick={() => setView(v)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                    const i = VIEWS.findIndex(([x]) => x === view)
                    const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length]![0]
                    setView(next)
                    requestAnimationFrame(() => (document.querySelector(`[data-review-view="${next}"]`) as HTMLElement | null)?.focus())
                  }}
                  data-review-view={v}
                >
                  {label}
                </button>
              ))}
            </div>
            {view !== 'report' ? (
              <>
                <span className="select labels-review__filter">
                  <select aria-label="행 거르기" value={filter} onChange={(e) => setFilter(e.target.value as RowFilter)}>
                    {(Object.keys(ROW_FILTER_LABEL) as RowFilter[])
                      .filter((f) => view === 'decide' || f !== 'undecided')
                      .map((f) => (
                        <option key={f} value={f}>
                          {ROW_FILTER_LABEL[f]}
                        </option>
                      ))}
                  </select>
                </span>
                <span className="toolbar__count">
                  행 {shownRows}/{c?.rows.length ?? 0}
                  {view === 'decide' ? ` · 결정 ${decidedCount}/${c?.rows.length ?? 0}` : ''}
                </span>
              </>
            ) : null}
            <span className="toolbar__spacer" />
            {view === 'compare' ? (
              <button type="button" className="btn btn--ghost" disabled={!!busy || stale} onClick={() => void saveCsv('comparison')}>
                쌍 판정 표 CSV 저장
              </button>
            ) : null}
            {view === 'decide' ? (
              <>
                {preview && preview.previousRecords > 0 && !stale ? (
                  <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void restoreDecisions()}>
                    지난 확정 결정 불러오기
                  </button>
                ) : null}
                <button type="button" className="btn btn--ghost" disabled={!!busy || stale || decidedCount === (c?.rows.length ?? 0)} onClick={fillRemaining}>
                  남은 행 기본값 채우기
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!!busy || decidedCount === 0}
                  onClick={() => {
                    setDecisions({})
                    setAutoFilled(new Set())
                    setFillNote(null)
                  }}
                >
                  결정 지우기
                </button>
              </>
            ) : null}
          </div>

          {view === 'decide' ? (
            <>
              {restoreNote ? (
                <p className="labels-review__line" role="status">
                  {restoreNote}
                </p>
              ) : null}
              {fillNote ? (
                <p className="labels-review__line" role="status">
                  {fillNote}
                </p>
              ) : null}
              <p className="t-caption labels-review__hint">
                행마다 A 채택 · B 채택 · 합침(칸 묶음별) · 결함 아님 · 보류를 고릅니다. '남은 행 기본값 채우기'는 짝 = A 로 채우고, 한쪽만 찾은 행은 2인 일치도·전문기관 대비에서는
                비워 둡니다(정확도 비교에서만 A 만 = A, B 만 = 결함 아님). 자동으로 채운 행은 '자동'으로 표시되고 저장할 때 한 번 더 확인합니다.
              </p>
              <ReviewFinalOptionsBar options={finalOptions} disabled={!!busy || saving} onChange={(o) => setFinalOptions(o)} />
            </>
          ) : null}

          {view !== 'report' ? (
            <ReviewRows
              comparison={comparison}
              mode={view === 'decide' ? 'decide' : 'compare'}
              filter={filter}
              decisions={decisions}
              onDecide={setDecision}
              autoFilled={autoFilled}
              rowResults={rowResults}
              disabled={!!busy || saving || stale}
              canView={canView}
              onView={openViewer}
            />
          ) : null}

          {view === 'decide' ? (
            <ReviewFinalPanel
              comparison={comparison}
              preview={stale ? null : preview}
              previewing={previewing}
              previewError={previewError}
              onRetry={() => setPreviewSeq((n) => n + 1)}
              noAdjudicator={noAdjudicator}
              saving={saving}
              saved={saved}
              saveError={saveError}
              onSave={(o) => void save(o)}
              autoFilled={c ? c.rows.filter((r) => autoFilled.has(r.id) && decisions[r.id]).length : 0}
              onDesignCsv={() => void saveCsv('design')}
              busy={!!busy || stale}
            />
          ) : null}

          {view === 'report' ? (
            <ReviewReport
              comparison={comparison}
              design={decisionList.length > 0 && !stale ? (preview?.result.designCheck ?? null) : null}
              header={header}
              onHeader={setHeader}
              onCsv={() => void saveCsv('report')}
              busy={!!busy || stale}
            />
          ) : null}
        </>
      )}
    </section>
  )
}
