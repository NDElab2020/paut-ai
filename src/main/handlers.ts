/**
 * IPC 핸들러. 로직은 core/service 에 있고, 여기서는 대화상자·탐색기 열기 같은 Electron 기능만 직접 한다.
 * 핸들러는 값을 반환하거나 AppError 를 던진다. ApiResult 포장은 ipc.ts 가 한다.
 * 라벨 엑셀·JSON·검수 CSV 경로와 학습 데이터 폴더는 main 대화상자가 고른 것만 받는다(렌더러가 임의 경로를 읽고 쓰게 하지 않음 — 이미지 보기와 같은 원칙).
 * 이미지 보기의 C-scan 내보내기(viewer:exportCscan)·색표 불러오기(viewer:openPalette)는 대화상자와 읽기·쓰기를 한 호출로 해서 경로를 받지 않는다.
 * 라벨 작업 설정(pcId·labelerId·labelBlindMode)은 settings:set 이 아니라 labels:setSession 으로만 바꾼다(검사가 한곳에 모이게).
 * 2인 독립 모드(labelBlindMode)에서는 색표 불러오기를 막는다(두 판독자 화면을 같게).
 * 자동 시험: tests/main/handlers.test.ts (electron 흉내 — 대화상자 승인 경로·settings:set 라벨 칸·내보낼 범위·색표 막음).
 */
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  IpcHandlers,
  LabelConflictChoice,
  LabelExportRequest,
  LabelSetSubmitOptions,
  LabelerRegisterOptions,
  ReviewCompareRequest,
  ReviewCsvRequest,
  ReviewFinalRequest,
  ReviewFinalSaveOptions,
  TrainingExportRequest,
  TrainingSetRule,
  TrainingSplitOptions,
  ViewerCscanExportRequest
} from '@shared/api'
import { AppError } from '@shared/errors'
import type { LabelSetKey } from '@shared/labels/types'
import type { AppInfo } from '@shared/types'
import type { AppService } from '@core/service'

export interface MainContext {
  service: AppService
  getWindow: () => BrowserWindow | null
}

function platformName(): AppInfo['platform'] {
  const p = process.platform
  return p === 'win32' || p === 'darwin' ? p : 'linux'
}

async function showOpenDialog(ctx: MainContext, options: Electron.OpenDialogOptions): Promise<string[]> {
  const win = ctx.getWindow()
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return res.canceled ? [] : res.filePaths
}

async function showSaveDialog(ctx: MainContext, options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = ctx.getWindow()
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return res.canceled || !res.filePath ? null : res.filePath
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new AppError('INVALID_ARGUMENT', `${what} 값이 올바르지 않습니다.`)
  return v
}
const int = (v: unknown, what: string): number => {
  if (!Number.isSafeInteger(v)) throw new AppError('INVALID_ARGUMENT', `${what} 값이 올바르지 않습니다.`)
  return v as number
}
const obj = <T>(v: unknown, what: string): T => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AppError('INVALID_ARGUMENT', `${what} 값이 올바르지 않습니다.`)
  return v as T
}
/** 없어도 되는 객체 인자 (undefined·null → undefined) */
const optObj = <T>(v: unknown, what: string): T | undefined => (v === undefined || v === null ? undefined : obj<T>(v, what))
const SHA256 = /^[0-9a-fA-F]{64}$/
const exportRequest = (v: unknown): LabelExportRequest => {
  const o = obj<{ kind?: unknown; sha256s?: unknown }>(v, '내보낼 범위')
  if (o.kind === 'all') return { kind: 'all' }
  if (o.kind === 'files' && Array.isArray(o.sha256s) && o.sha256s.length > 0 && o.sha256s.every((x) => typeof x === 'string' && SHA256.test(x))) {
    return { kind: 'files', sha256s: o.sha256s as string[] }
  }
  throw new AppError('INVALID_ARGUMENT', '내보낼 범위 값이 올바르지 않습니다.')
}
const cscanExportRequest = (v: unknown): ViewerCscanExportRequest => {
  const o = obj<Record<string, unknown>>(v, 'C-scan 내보내기 요청')
  return {
    fileId: int(o['fileId'], '파일 ID'),
    key: str(o['key'], '열기 키'),
    groupId: int(o['groupId'], '그룹 ID'),
    // 게이트 값의 칸·숫자 검사는 서비스가 한다
    ...(o['gate'] === undefined || o['gate'] === null ? {} : { gate: obj(o['gate'], '게이트 값') })
  }
}
const conflictChoice = (v: unknown): LabelConflictChoice => {
  if (v === 'mine' || v === 'theirs' || v === 'both') return v
  throw new AppError('INVALID_ARGUMENT', '충돌 해결 방법이 올바르지 않습니다.')
}

/** 라벨 작업 칸은 settings:set 으로 바꾸지 않는다 */
const LABEL_SETTING_KEYS = ['pcId', 'labelerId', 'labelBlindMode'] as const
const generalSettings = <T extends object>(patch: T): T => {
  const hit = LABEL_SETTING_KEYS.filter((k) => k in patch)
  if (hit.length > 0) throw new AppError('INVALID_ARGUMENT', `라벨 작업 설정(${hit.join(', ')})은 라벨 관리 화면에서 바꿉니다.`)
  return patch
}

const paths = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length === 0 || v.some((p) => typeof p !== 'string' || p.length === 0)) {
    throw new AppError('INVALID_ARGUMENT', '가져올 경로 목록이 올바르지 않습니다.')
  }
  return v as string[]
}

export function createHandlers(ctx: MainContext): IpcHandlers {
  const s = ctx.service
  const L = s.labels
  /** OmniPC 사용자 색표 폴더 (문서/Evident/OmniPC/Palette — 없으면 문서 폴더). 색표는 앱에 묶지 않고 여기서 고르게 한다 */
  const paletteDir = (): string => {
    const docs = app.getPath('documents')
    const dir = join(docs, 'Evident', 'OmniPC', 'Palette')
    return existsSync(dir) ? dir : docs
  }
  /** 라벨 대화상자 기본 위치 (마지막 위치 → 문서 폴더) */
  const labelDir = async (): Promise<string> => (await s.getSettings()).lastLabelDir ?? app.getPath('documents')
  /** 설정 쓰기는 core/settings 가 한 줄로 세운다. 기다려서 다음 호출과 겹치지 않게 한다 */
  const rememberLabelDir = async (file: string): Promise<void> => {
    await s.updateSettings({ lastLabelDir: dirname(file) }).catch(() => undefined)
  }
  /** 대화상자로 고른 경로 (이 실행 동안). 라벨 엑셀·JSON 읽기·쓰기·학습 데이터 폴더는 이 경로만 받는다 */
  const approved = {
    workbook: new Set<string>(),
    jsonIn: new Set<string>(),
    jsonOut: new Set<string>(),
    trainingDir: new Set<string>(),
    reviewCsv: new Set<string>()
  }
  const approvedPath = (set: Set<string>, v: unknown, what: string, how: string): string => {
    const p = str(v, what)
    if (!set.has(p)) throw new AppError('INVALID_ARGUMENT', `${what}는 '${how}'로 고른 파일만 받습니다.`)
    return p
  }
  return {
    'app:info': async () => ({
      appName: app.getName(),
      version: app.getVersion(),
      platform: platformName(),
      electron: process.versions.electron ?? null,
      node: process.versions.node ?? null,
      catalogPath: await s.catalogPath(),
      mock: false
    }),
    'settings:get': () => s.getSettings(),
    'settings:set': (patch) => s.updateSettings(generalSettings(obj(patch, '설정'))),
    'settings:chooseStoreRoot': async () => {
      const [dir] = await showOpenDialog(ctx, { title: '저장소 폴더 선택', properties: ['openDirectory', 'createDirectory'] })
      return dir ? s.setStoreRoot(dir) : null
    },

    'plans:list': () => s.listPlans(),
    'plans:get': (id) => s.getPlan(str(id, '플랜 ID')),
    'plans:rename': (id, name) => s.renamePlan(str(id, '플랜 ID'), typeof name === 'string' ? name : ''),
    'plans:setNote': (id, note) => s.setPlanNote(str(id, '플랜 ID'), typeof note === 'string' ? note : ''),
    'specimens:list': (planId) => s.listSpecimens(planId === undefined || planId === null ? undefined : str(planId, '플랜 ID')),
    'specimens:get': (id) => s.getSpecimen(str(id, '시편 ID')),
    'specimens:update': (id, patch) => s.updateSpecimen(str(id, '시편 ID'), obj(patch, '시편 수정')),
    'files:list': (query) => s.listFiles(query === undefined ? {} : obj(query, '검색 조건')),
    'files:get': (id) => s.getFile(int(id, '파일 ID')),
    'files:update': (id, patch) => s.updateFile(int(id, '파일 ID'), obj(patch, '파일 수정')),
    'files:reveal': async (id) => {
      shell.showItemInFolder(await s.storedFilePath(int(id, '파일 ID')))
    },

    'import:choosePaths': async (mode) => {
      const settings = await s.getSettings()
      const folder = mode === 'folder'
      const picked = await showOpenDialog(ctx, {
        title: folder ? '가져올 폴더 선택' : '가져올 NDE·OPD 파일 선택',
        ...(settings.lastImportDir ? { defaultPath: settings.lastImportDir } : {}),
        properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
        ...(folder ? {} : { filters: [{ name: 'NDE·OPD', extensions: ['nde', 'opd'] }, { name: '모든 파일', extensions: ['*'] }] })
      })
      if (picked[0]) await s.updateSettings({ lastImportDir: folder ? picked[0] : dirname(picked[0]) }).catch(() => undefined)
      return picked
    },
    'import:analyze': (p) => s.analyze(paths(p)),
    'import:commit': (req) => s.commit(obj(req, '확정 요청')),
    'import:cancel': (operationId) => s.cancel(str(operationId, '작업 ID')),
    'import:history': () => s.history(),
    'store:maintenance': () => s.maintenanceReport(),
    'viewer:open': (id) => s.viewerOpen(int(id, '파일 ID')),
    'viewer:chunk': (id, key, groupId, scanStart, scanCount) =>
      s.viewerChunk(
        int(id, '파일 ID'),
        str(key, '열기 키'),
        int(groupId, '그룹 ID'),
        int(scanStart, '스캔 시작'),
        int(scanCount, '스캔 칸 수')
      ),
    'viewer:exportCscan': async (request) => {
      const req = cscanExportRequest(request)
      const name = await s.cscanExportFileName(req)
      const file = await showSaveDialog(ctx, {
        title: 'C-scan 내보내기 (OmniPC 꼴 .txt)',
        defaultPath: join(app.getPath('documents'), name),
        filters: [{ name: 'C-scan 텍스트 (.txt)', extensions: ['txt'] }]
      })
      return file ? s.exportCscanTxt(req, file) : null
    },
    'viewer:openPalette': async () => {
      // 2인 독립(블라인드) 판독: 두 판독자 화면을 같게 하려고 색표 불러오기를 막는다 (렌더러도 막음 — 여기서 한 번 더)
      if ((await s.getSettings()).labelBlindMode) {
        throw new AppError('INVALID_ARGUMENT', '2인 독립 모드에서는 색표를 불러오지 않습니다(두 판독자 화면을 같게). 라벨 관리에서 2인 모드를 끈 뒤 불러오세요.')
      }
      const [file] = await showOpenDialog(ctx, {
        title: 'OmniPC 색표(.pal) 불러오기',
        defaultPath: paletteDir(),
        properties: ['openFile'],
        // 서비스가 .pal 만 받으므로 '모든 파일' 필터는 두지 않는다 (다른 확장자를 고르면 오류만 나서)
        filters: [{ name: 'OmniPC 색표 (.pal)', extensions: ['pal'] }]
      })
      return file ? s.readPaletteFile(file) : null
    },

    'labels:session': () => L.session(),
    'labels:setSession': (patch) => L.setSession(obj(patch, '라벨 작업 설정')),
    'labels:registerLabeler': (info, options) => L.registerLabeler(obj(info, '라벨러'), optObj<LabelerRegisterOptions>(options, '라벨러 등록 옵션')),
    'labels:overview': () => L.overview(),
    'labels:listSets': (query) => L.listSets(optObj(query, '검색 조건')),
    'labels:listRecords': (query) => L.listRecords(optObj(query, '검색 조건')),
    'labels:saveRecord': (record) => L.saveRecord(obj(record, '지시 기록')),
    'labels:deleteRecord': (uuid) => L.deleteRecord(str(uuid, '기록 UUID')),
    'labels:listObservations': (query) => L.listObservations(optObj(query, '검색 조건')),
    'labels:saveObservation': (row) => L.saveObservation(obj(row, '관측 표')),
    'labels:deleteObservation': (recordUuid, groupId, leg) =>
      L.deleteObservation(str(recordUuid, '기록 UUID'), int(groupId, '그룹 ID'), int(leg, '레그')),
    'labels:listReviews': (query) => L.listReviews(optObj(query, '검색 조건')),
    'labels:saveReview': (v) => L.saveReview(obj(v, '검토 구간')),
    'labels:deleteReview': (uuid) => L.deleteReview(str(uuid, '구간 UUID')),
    'labels:appendWorkEvent': (event) => L.appendWorkEvent(obj(event, '작업 이벤트')),
    'labels:chooseWorkbook': async () => {
      const [file] = await showOpenDialog(ctx, {
        title: '전문가 기록 엑셀 선택',
        defaultPath: await labelDir(),
        properties: ['openFile'],
        filters: [
          { name: '엑셀 (xlsx)', extensions: ['xlsx'] },
          { name: '모든 파일', extensions: ['*'] }
        ]
      })
      if (!file) return null
      approved.workbook.add(file)
      await rememberLabelDir(file)
      return file
    },
    'labels:previewWorkbook': (path, options) =>
      L.previewWorkbook(approvedPath(approved.workbook, path, '엑셀 경로', '엑셀 가져오기'), optObj(options, '가져오기 옵션')),
    'labels:commitWorkbook': (previewId) => L.commitWorkbook(str(previewId, '미리보기 ID')),
    'labels:chooseExportPath': async (request) => {
      const req = exportRequest(request)
      const name = await L.exportFileName(req)
      const file = await showSaveDialog(ctx, {
        title: '라벨 JSON 내보내기',
        defaultPath: join(await labelDir(), name),
        filters: [{ name: '라벨 JSON', extensions: ['json'] }]
      })
      if (!file) return null
      approved.jsonOut.add(file)
      await rememberLabelDir(file)
      return file
    },
    'labels:exportJson': (request, path) =>
      L.exportJsonFile(exportRequest(request), approvedPath(approved.jsonOut, path, '저장 경로', 'JSON 내보내기'), app.getVersion()),
    'labels:chooseJson': async () => {
      const [picked] = await showOpenDialog(ctx, {
        title: '라벨 JSON 가져오기',
        defaultPath: await labelDir(),
        properties: ['openFile'],
        filters: [
          { name: '라벨 JSON', extensions: ['json'] },
          { name: '모든 파일', extensions: ['*'] }
        ]
      })
      if (!picked) return null
      approved.jsonIn.add(picked)
      await rememberLabelDir(picked)
      return picked
    },
    'labels:importJson': (path) => L.importJsonFile(approvedPath(approved.jsonIn, path, '라벨 파일 경로', 'JSON 가져오기')),
    'labels:listConflicts': (query) => L.listConflicts(optObj(query, '검색 조건')),
    'labels:resolveConflict': (id, choice) => L.resolveConflict(int(id, '충돌 ID'), conflictChoice(choice)),

    // ── 학습 데이터 분할 · 내보내기 (2b) ──
    'labels:trainingSplits': () => L.trainingSplits(),
    'labels:setTrainingSplits': (changes, options) => {
      if (!Array.isArray(changes)) throw new AppError('INVALID_ARGUMENT', '분할 변경 목록이 올바르지 않습니다.')
      return L.setTrainingSplits(changes, optObj<TrainingSplitOptions>(options, '분할 옵션'))
    },
    'labels:lockTrainingTest': (lock, options) => {
      if (typeof lock !== 'boolean') throw new AppError('INVALID_ARGUMENT', '잠금 값이 올바르지 않습니다.')
      return L.lockTrainingTest(lock, optObj<TrainingSplitOptions>(options, '잠금 옵션'))
    },
    'labels:trainingCandidates': (rule) => L.trainingCandidates(obj<TrainingSetRule>(rule, '세트 고르기 규칙')),
    'labels:chooseTrainingDir': async () => {
      const [dir] = await showOpenDialog(ctx, {
        title: '학습 데이터를 둘 폴더 선택 (그 안에 새 폴더를 만듭니다)',
        defaultPath: await labelDir(),
        properties: ['openDirectory', 'createDirectory']
      })
      if (!dir) return null
      approved.trainingDir.add(dir)
      await s.updateSettings({ lastLabelDir: dir }).catch(() => undefined)
      return dir
    },
    'labels:exportTraining': (request, dir) => {
      const d = str(dir, '학습 데이터 폴더')
      if (!approved.trainingDir.has(d)) throw new AppError('INVALID_ARGUMENT', "학습 데이터 폴더는 '폴더 고르기'로 고른 폴더만 받습니다.")
      return L.exportTraining(obj<TrainingExportRequest>(request, '내보낼 범위'), d, app.getVersion())
    },
    'labels:trainingStatus': () => L.trainingStatus(),
    'labels:cancelTraining': (operationId) => L.cancelTraining(str(operationId, '작업 ID')),

    // ── 3단계 검수 ──
    'labels:reviewSources': () => L.reviewSources(),
    'labels:compareSets': (request) => L.compareSets(obj<ReviewCompareRequest>(request, '비교 요청')),
    'labels:previewFinal': (request) => L.previewFinal(obj<ReviewFinalRequest>(request, '확정 요청')),
    'labels:saveFinal': (request, options) =>
      L.saveFinal(obj<ReviewFinalRequest>(request, '확정 요청'), optObj<ReviewFinalSaveOptions>(options, '저장 옵션')),
    'labels:chooseReviewCsvPath': async (request) => {
      const name = await L.reviewCsvFileName(obj<ReviewCsvRequest>(request, 'CSV 요청'))
      const file = await showSaveDialog(ctx, {
        title: '검수 결과 CSV 저장',
        defaultPath: join(await labelDir(), name),
        filters: [{ name: 'CSV (엑셀에서 열림)', extensions: ['csv'] }]
      })
      if (!file) return null
      approved.reviewCsv.add(file)
      await rememberLabelDir(file)
      return file
    },
    'labels:saveReviewCsv': (request, path) =>
      L.saveReviewCsv(obj<ReviewCsvRequest>(request, 'CSV 요청'), approvedPath(approved.reviewCsv, path, '저장 경로', 'CSV 저장')),

    // ── 세트 제출 · 설계값 대조 시작 ──
    'labels:submitSet': (set, submit, options) => {
      if (typeof submit !== 'boolean') throw new AppError('INVALID_ARGUMENT', '제출 값이 올바르지 않습니다.')
      return L.submitSet(obj<LabelSetKey>(set, '라벨 세트'), submit, optObj<LabelSetSubmitOptions>(options, '제출 옵션'))
    },
    'labels:startReconcile': (from) => L.startReconcile(obj<LabelSetKey>(from, '라벨 세트')),
    'labels:physicalDefects': (query) => L.physicalDefects(obj<{ sha256: string }>(query, '파일'))
  }
}
