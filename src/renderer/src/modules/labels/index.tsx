/**
 * 라벨 관리: 지금 라벨러 · 엑셀 가져오기(미리보기 → 확정) · JSON 가져오기 · JSON 백업 내보내기 · 학습 데이터 내보내기 · 충돌
 * · 탭 세 개(파일별 라벨 현황 / 학습 데이터 분할 / 검수 — 두 세트 비교·Level III 확정·보고서, ReviewView.tsx).
 * 미리보기 세부·경고·기록 목록은 접어 둔다. 라벨을 찍는 화면(라벨 모드)은 이미지 보기에 붙는다(1b 단계).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  LabelConflictChoice,
  LabelConflictInfo,
  LabelExportResult,
  LabelJsonImportResult,
  LabelWorkbookCommitResult,
  LabelWorkbookOptions,
  LabelWorkbookPreview,
  TrainingExportResult
} from '@shared/api'
import type { ModuleProps } from '@shared/modules'
import { matchesAllTerms } from '@shared/text'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import { StoreRootEmpty } from '../../components/StoreRootEmpty'
import { useAsync } from '../../lib/useAsync'
import { useApp } from '../../state/AppContext'
import { ConflictList, ResolvedList } from './ConflictList'
import { ExportDialog, type ExportScopeChoice } from './ExportDialog'
import { FileStatusTable } from './FileStatusTable'
import { LabelerBar } from './LabelerBar'
import { CommitResult, ExportResult, JsonImportResult, TrainingResult } from './Results'
import { ReviewView } from './ReviewView'
import { SplitView } from './SplitView'
import { TrainingExportDialog } from './TrainingExportDialog'
import { WorkbookPreview } from './WorkbookPreview'
import './labels.css'

type Panel =
  | { kind: 'preview'; preview: LabelWorkbookPreview }
  | { kind: 'commit'; result: LabelWorkbookCommitResult }
  | { kind: 'json'; result: LabelJsonImportResult }
  | { kind: 'export'; result: LabelExportResult }
  | { kind: 'training'; result: TrainingExportResult }

type Tab = 'files' | 'splits' | 'review'

const TABS: ReadonlyArray<[Tab, string]> = [
  ['files', '파일별 라벨 현황'],
  ['splits', '학습 데이터 분할'],
  ['review', '검수']
]

/** 화면을 떠났다 와도 앱을 닫기 전까지 남기는 값 (모듈 상태) */
let sessionOnlyLabeled = true
let sessionTab: Tab = 'files'

export default function LabelsModule({ navigate }: ModuleProps) {
  const api = getApi()
  const { settings, dataVersion, query, setQuery } = useApp()
  const storeRoot = settings?.storeRoot ?? null
  const [version, setVersion] = useState(0)
  const bump = (): void => setVersion((v) => v + 1)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ title: string; error: UiError; retry?: () => void } | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [onlyLabeled, setOnlyLabeledState] = useState(sessionOnlyLabeled)
  const [exporting, setExporting] = useState(false)
  const [training, setTraining] = useState(false)
  const [tab, setTabState] = useState<Tab>(sessionTab)
  const rootRef = useRef<HTMLDivElement>(null)
  const setTab = (t: Tab): void => {
    sessionTab = t
    setTabState(t)
  }

  const ov = useAsync(() => (storeRoot ? unwrap(api.labels.overview()) : Promise.resolve(null)), [storeRoot, dataVersion, version])
  const conflicts = useAsync(
    () => (storeRoot ? unwrap(api.labels.listConflicts({ pendingOnly: false })) : Promise.resolve([] as LabelConflictInfo[])),
    [storeRoot, dataVersion, version]
  )

  // 결과·미리보기가 새로 뜨면 그 제목으로 포커스 (누른 버튼이 사라지므로)
  useEffect(() => {
    if (!panel) return
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[data-focus-target]')?.focus())
  }, [panel])

  const setOnlyLabeled = (v: boolean): void => {
    sessionOnlyLabeled = v
    setOnlyLabeledState(v)
  }

  /** 오래 걸리는 작업 하나 (버튼을 막고, 실패하면 알림) */
  async function run<T>(label: string, title: string, fn: () => Promise<T>, retry?: () => void): Promise<T | null> {
    setBusy(label)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError({ title, error: toUiError(e), ...(retry ? { retry } : {}) })
      return null
    } finally {
      setBusy(null)
    }
  }

  const previewFrom = async (path: string, options?: LabelWorkbookOptions): Promise<void> => {
    const hasOptions = options && (options.groupChoices || options.fileChoices)
    const pv = await run(
      '엑셀을 읽고 저장소의 파일과 맞추는 중입니다.',
      '엑셀을 읽지 못했습니다',
      () => unwrap(api.labels.previewWorkbook(path, hasOptions ? options : undefined)),
      () => void previewFrom(path, options)
    )
    if (pv) setPanel({ kind: 'preview', preview: pv })
  }

  const chooseExcel = async (): Promise<void> => {
    const path = await run('엑셀 파일을 고르는 중입니다.', '엑셀 파일을 고르지 못했습니다', () => unwrap(api.labels.chooseWorkbook()))
    if (path) await previewFrom(path)
  }

  const commit = async (pv: LabelWorkbookPreview): Promise<void> => {
    // 다시 시도는 고른 그룹·파일 답을 그대로 넘겨 다시 읽는다
    const r = await run('저장하는 중입니다.', '엑셀을 확정하지 못했습니다', () => unwrap(api.labels.commitWorkbook(pv.previewId)), () =>
      void previewFrom(pv.path, pv.options)
    )
    if (r) {
      setPanel({ kind: 'commit', result: r })
      bump()
    }
  }

  /** 파일 고르기(대화상자)와 합치기를 나눠, 대화상자가 열린 동안에는 진행 문구를 띄우지 않는다 */
  const importJson = async (): Promise<void> => {
    const path = await run('파일을 고르는 중입니다.', '라벨 JSON 파일을 고르지 못했습니다', () => unwrap(api.labels.chooseJson()))
    if (!path) return
    const r = await run('라벨 JSON 을 합치는 중입니다.', '라벨 JSON 을 가져오지 못했습니다', () => unwrap(api.labels.importJson(path)))
    if (r) {
      setPanel({ kind: 'json', result: r })
      bump()
    }
  }

  const exportJson = async (scope: ExportScopeChoice): Promise<void> => {
    setExporting(false)
    const req = scope === 'files' ? { kind: 'files' as const, sha256s: [...picked] } : { kind: 'all' as const }
    const path = await run('저장할 곳을 고르는 중입니다.', '저장할 곳을 고르지 못했습니다', () => unwrap(api.labels.chooseExportPath(req)))
    if (!path) return
    const r = await run('라벨을 내보내는 중입니다.', '라벨을 내보내지 못했습니다', () => unwrap(api.labels.exportJson(req, path)))
    if (r) setPanel({ kind: 'export', result: r })
  }

  const resolve = async (c: LabelConflictInfo, choice: LabelConflictChoice): Promise<void> => {
    const r = await run('충돌을 푸는 중입니다.', '충돌을 풀지 못했습니다', () => unwrap(api.labels.resolveConflict(c.id, choice)))
    if (r) bump()
  }

  /** 같은 출처의 충돌을 한꺼번에 (하나씩 차례로 풀고, 실패하면 거기서 멈춤) */
  const resolveMany = async (list: LabelConflictInfo[], choice: 'mine' | 'theirs'): Promise<void> => {
    await run(`충돌 ${list.length}건을 푸는 중입니다.`, '충돌을 다 풀지 못했습니다', async () => {
      for (const c of list) await unwrap(api.labels.resolveConflict(c.id, choice))
      return true
    })
    bump()
  }

  /** 미리보기의 '엑셀 정보로 바꾸기': 등록된 라벨러 이름·자격을 엑셀 값으로 고친 뒤 다시 읽는다 */
  const useReaderInfo = async (pv: LabelWorkbookPreview): Promise<void> => {
    const r = pv.reader
    if (!r) return
    const ok = await run('라벨러 정보를 고치는 중입니다.', '라벨러 정보를 고치지 못했습니다', () =>
      unwrap(api.labels.registerLabeler({ id: r.id, name: r.name, qualification: r.qualification, organization: r.organization }, { overwrite: true }))
    )
    if (ok) {
      bump()
      await previewFrom(pv.path, pv.options)
    }
  }

  const data = ov.data
  const q = query.trim().normalize('NFC')
  const labeledCount = data ? data.files.filter((f) => f.sets.length > 0).length : 0
  const rows = useMemo(() => {
    if (!data) return []
    return data.files.filter(
      (f) =>
        (!onlyLabeled || f.sets.length > 0) &&
        (!q || matchesAllTerms([f.fileName, f.planId, f.planName, f.specimenId, f.stateTag, ...f.sets.map((s) => s.labelerId)], q))
    )
  }, [data, onlyLabeled, q])
  // 표에서 사라진(라벨이 없어진) 파일은 고른 목록에서 뺀다
  const labeledShas = useMemo(() => new Set(data?.files.filter((f) => f.sets.length > 0).map((f) => f.sha256) ?? []), [data])
  const picked = useMemo(() => new Set([...selected].filter((s) => labeledShas.has(s))), [selected, labeledShas])

  if (settings && !storeRoot) return <StoreRootEmpty />

  const previewing = panel?.kind === 'preview'
  const pending = (conflicts.data ?? []).filter((c) => c.resolvedAt === null)
  const resolvedConflicts = (conflicts.data ?? []).filter((c) => c.resolvedAt !== null).reverse()
  const blindLabeler = data?.session.blindMode ? (data.session.labeler?.name ?? data.session.labelerId ?? '(고르지 않음)') : null

  // 다른 PC 와 합치기 (JSON) — 라벨러 줄 오른쪽 고스트 단추
  const jsonButtons = (
    <span className="labels-bar__json">
      <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void importJson()}>
        <Icon name="file" />
        JSON 가져오기
      </button>
      <button type="button" className="btn btn--ghost" disabled={!!busy || labeledCount === 0} onClick={() => setExporting(true)}>
        <Icon name="reveal" />
        JSON 백업 내보내기
      </button>
    </span>
  )

  return (
    <div className="labels" ref={rootRef}>
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">라벨 관리</h1>
          <p className="page-header__desc">전문가 엑셀과 다른 PC 의 라벨을 합치고, 파일별 라벨 현황을 봅니다. 원본 파일은 바꾸지 않습니다.</p>
        </div>
        <div className="page-header__actions">
          {/* 파란 주 버튼은 한 화면에 하나 (PAUT_DESIGN 4절): 평소에는 '엑셀 가져오기', 미리보기 중에는 '확정', 검수 탭에서는 '비교하기'·'확정 세트 저장'. 상단바의 파란 버튼은 이 화면에서 숨긴다 */}
          <button
            type="button"
            className={previewing || (tab === 'review' && !!data) ? 'btn btn--secondary btn--lg' : 'btn btn--primary btn--lg'}
            disabled={!!busy}
            onClick={() => void chooseExcel()}
          >
            <Icon name="import" />
            엑셀 가져오기
          </button>
          <button type="button" className="btn btn--secondary btn--lg" disabled={!!busy || labeledCount === 0} onClick={() => setTraining(true)}>
            <Icon name="layers" />
            학습 데이터 내보내기
          </button>
          {/* 라벨 현황을 읽지 못해 라벨러 줄이 없을 때만 JSON 단추를 여기에 (평소에는 라벨러 줄 오른쪽 — 페이지 머리 단추는 둘까지, 디자인 5절) */}
          {data ? null : jsonButtons}
        </div>
      </div>

      {data ? <LabelerBar session={data.session} onChanged={() => bump()} actions={jsonButtons} /> : null}

      {busy ? (
        <p className="labels-busy" role="status">
          {busy}
        </p>
      ) : null}
      {error ? <ErrorNotice title={error.title} error={error.error} onRetry={error.retry} /> : null}
      {ov.error ? <ErrorNotice title="라벨 현황을 읽지 못했습니다" error={ov.error} onRetry={ov.reload} /> : null}

      {panel?.kind === 'preview' ? (
        <WorkbookPreview
          preview={panel.preview}
          busy={!!busy}
          onCommit={() => void commit(panel.preview)}
          onReparse={(options) => void previewFrom(panel.preview.path, options)}
          onUseReaderInfo={() => void useReaderInfo(panel.preview)}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel?.kind === 'commit' ? <CommitResult result={panel.result} onClose={() => setPanel(null)} /> : null}
      {panel?.kind === 'json' ? <JsonImportResult result={panel.result} onClose={() => setPanel(null)} /> : null}
      {panel?.kind === 'export' ? <ExportResult result={panel.result} onClose={() => setPanel(null)} /> : null}
      {panel?.kind === 'training' ? <TrainingResult result={panel.result} onClose={() => setPanel(null)} /> : null}

      {pending.length > 0 && !previewing ? (
        <ConflictList
          conflicts={pending}
          resolved={resolvedConflicts}
          busy={!!busy}
          onResolve={(c, ch) => void resolve(c, ch)}
          onResolveMany={(list, ch) => void resolveMany(list, ch)}
        />
      ) : null}
      {pending.length === 0 && resolvedConflicts.length > 0 && !previewing ? <ResolvedList resolved={resolvedConflicts} /> : null}

      {data && !previewing ? (
        <div className="tabs labels-tabs" role="tablist" aria-label="라벨 관리 보기">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`labels-tab-${k}`}
              className="tab"
              aria-selected={tab === k}
              aria-controls={`labels-panel-${k}`}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => setTab(k)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const i = TABS.findIndex(([t]) => t === tab)
                  const next: Tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]![0]
                  setTab(next)
                  requestAnimationFrame(() => document.getElementById(`labels-tab-${next}`)?.focus())
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {data && !previewing && tab === 'review' ? (
        <div role="tabpanel" id="labels-panel-review" aria-labelledby="labels-tab-review">
          <ReviewView version={version + dataVersion} storeRoot={storeRoot} navigate={navigate} onChanged={bump} onOpenSplits={() => setTab('splits')} />
        </div>
      ) : null}

      {data && !previewing && tab === 'splits' ? (
        <div role="tabpanel" id="labels-panel-splits" aria-labelledby="labels-tab-splits">
          <SplitView version={version + dataVersion} query={query} />
        </div>
      ) : null}

      {data && !previewing && tab === 'files' ? (
        <section className="labels-files" id="labels-panel-files" role="tabpanel" aria-labelledby="labels-files-title">
          <div className="toolbar">
            {/* 탭 이름과 같아 글자는 숨기고 화면 읽기 프로그램에만 */}
            <h2 className="visually-hidden" id="labels-files-title">
              파일별 라벨 현황
            </h2>
            <span className="toolbar__count">
              라벨 있는 파일 {labeledCount} · 라벨 세트 {data.setCount}
              {data.hiddenSetCount ? ` · 숨긴 세트 ${data.hiddenSetCount} (2인 모드)` : ''}
              {q ? ` · 검색 ${rows.length}` : ''}
            </span>
            <span className="toolbar__spacer" />
            {picked.size > 0 ? (
              <button type="button" className="btn btn--ghost" onClick={() => setSelected(new Set())}>
                고른 파일 {picked.size}개 · 고르기 지우기
              </button>
            ) : null}
            <label className="check">
              <input type="checkbox" checked={onlyLabeled} onChange={(e) => setOnlyLabeled(e.target.checked)} />
              <span>라벨 있는 파일만</span>
            </label>
          </div>
          {data.files.length === 0 ? (
            <EmptyState
              title="저장소에 파일이 없습니다"
              desc="NDE·OPD 파일을 먼저 가져오면, 엑셀의 파일 이름을 저장소의 파일과 맞춰 라벨을 붙입니다."
              action={
                <button type="button" className="btn btn--secondary btn--lg" onClick={() => navigate('import')}>
                  가져오기 화면으로
                </button>
              }
            />
          ) : labeledCount === 0 && onlyLabeled ? (
            <EmptyState
              title={data.hiddenSetCount ? '이 라벨러의 라벨이 아직 없습니다' : '아직 라벨이 없습니다'}
              desc={
                data.hiddenSetCount
                  ? `2인 독립 모드라 다른 라벨러의 라벨 세트 ${data.hiddenSetCount}개를 숨겼습니다. 이 라벨러의 엑셀을 가져오면 여기에 보입니다.`
                  : '전문가가 적은 기록양식 엑셀을 가져오거나, 다른 PC 에서 내보낸 라벨 JSON 을 가져오면 여기에 파일별로 보입니다.'
              }
              action={
                <button type="button" className="btn btn--secondary" onClick={() => setOnlyLabeled(false)}>
                  모든 파일 보기
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={`'${query.trim()}'에 맞는 파일이 없습니다`}
              desc="상단 검색어로 이 표를 거르고 있습니다."
              action={
                <button type="button" className="btn btn--secondary" onClick={() => setQuery('')}>
                  검색 지우기
                </button>
              }
            />
          ) : (
            <FileStatusTable files={rows} selected={picked} onSelect={setSelected} version={version + dataVersion} />
          )}
        </section>
      ) : null}

      {exporting ? (
        <ExportDialog
          selectedCount={picked.size}
          labeledCount={labeledCount}
          blindLabeler={blindLabeler}
          onCancel={() => setExporting(false)}
          onExport={(scope) => void exportJson(scope)}
        />
      ) : null}

      {training && data ? (
        <TrainingExportDialog
          selectedShas={[...picked]}
          session={data.session}
          onClose={() => setTraining(false)}
          onDone={(r) => {
            setTraining(false)
            setPanel({ kind: 'training', result: r })
          }}
        />
      ) : null}
    </div>
  )
}
