/** preload (sandbox, CJS 번들): 타입 있는 PautApi 만 window.pautApi 로 노출한다. */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { API_CHANNEL_MAP, IPC_EVENTS, type IpcArgs, type IpcChannel, type IpcResult, type PautApi } from '@shared/api'
import type { ApiResult } from '@shared/errors'
import type { ProgressEvent } from '@shared/types'

function call<C extends IpcChannel>(channel: C) {
  return (...args: IpcArgs<C>): Promise<ApiResult<IpcResult<C>>> => ipcRenderer.invoke(channel, ...args)
}

const api: PautApi = {
  app: { info: call(API_CHANNEL_MAP.app.info) },
  settings: {
    get: call(API_CHANNEL_MAP.settings.get),
    set: call(API_CHANNEL_MAP.settings.set),
    chooseStoreRoot: call(API_CHANNEL_MAP.settings.chooseStoreRoot)
  },
  plans: {
    list: call(API_CHANNEL_MAP.plans.list),
    get: call(API_CHANNEL_MAP.plans.get),
    rename: call(API_CHANNEL_MAP.plans.rename),
    setNote: call(API_CHANNEL_MAP.plans.setNote)
  },
  specimens: {
    list: call(API_CHANNEL_MAP.specimens.list),
    get: call(API_CHANNEL_MAP.specimens.get),
    update: call(API_CHANNEL_MAP.specimens.update)
  },
  files: {
    list: call(API_CHANNEL_MAP.files.list),
    get: call(API_CHANNEL_MAP.files.get),
    update: call(API_CHANNEL_MAP.files.update),
    reveal: call(API_CHANNEL_MAP.files.reveal),
    pathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  import: {
    choosePaths: call(API_CHANNEL_MAP.import.choosePaths),
    analyze: call(API_CHANNEL_MAP.import.analyze),
    commit: call(API_CHANNEL_MAP.import.commit),
    cancel: call(API_CHANNEL_MAP.import.cancel),
    history: call(API_CHANNEL_MAP.import.history)
  },
  store: { maintenance: call(API_CHANNEL_MAP.store.maintenance) },
  viewer: {
    open: call(API_CHANNEL_MAP.viewer.open),
    chunk: call(API_CHANNEL_MAP.viewer.chunk),
    exportCscan: call(API_CHANNEL_MAP.viewer.exportCscan),
    openPalette: call(API_CHANNEL_MAP.viewer.openPalette)
  },
  labels: {
    session: call(API_CHANNEL_MAP.labels.session),
    setSession: call(API_CHANNEL_MAP.labels.setSession),
    registerLabeler: call(API_CHANNEL_MAP.labels.registerLabeler),
    overview: call(API_CHANNEL_MAP.labels.overview),
    listSets: call(API_CHANNEL_MAP.labels.listSets),
    listRecords: call(API_CHANNEL_MAP.labels.listRecords),
    saveRecord: call(API_CHANNEL_MAP.labels.saveRecord),
    deleteRecord: call(API_CHANNEL_MAP.labels.deleteRecord),
    listObservations: call(API_CHANNEL_MAP.labels.listObservations),
    saveObservation: call(API_CHANNEL_MAP.labels.saveObservation),
    deleteObservation: call(API_CHANNEL_MAP.labels.deleteObservation),
    listReviews: call(API_CHANNEL_MAP.labels.listReviews),
    saveReview: call(API_CHANNEL_MAP.labels.saveReview),
    deleteReview: call(API_CHANNEL_MAP.labels.deleteReview),
    appendWorkEvent: call(API_CHANNEL_MAP.labels.appendWorkEvent),
    chooseWorkbook: call(API_CHANNEL_MAP.labels.chooseWorkbook),
    previewWorkbook: call(API_CHANNEL_MAP.labels.previewWorkbook),
    commitWorkbook: call(API_CHANNEL_MAP.labels.commitWorkbook),
    chooseExportPath: call(API_CHANNEL_MAP.labels.chooseExportPath),
    exportJson: call(API_CHANNEL_MAP.labels.exportJson),
    chooseJson: call(API_CHANNEL_MAP.labels.chooseJson),
    importJson: call(API_CHANNEL_MAP.labels.importJson),
    listConflicts: call(API_CHANNEL_MAP.labels.listConflicts),
    resolveConflict: call(API_CHANNEL_MAP.labels.resolveConflict),
    trainingSplits: call(API_CHANNEL_MAP.labels.trainingSplits),
    setTrainingSplits: call(API_CHANNEL_MAP.labels.setTrainingSplits),
    lockTrainingTest: call(API_CHANNEL_MAP.labels.lockTrainingTest),
    trainingCandidates: call(API_CHANNEL_MAP.labels.trainingCandidates),
    chooseTrainingDir: call(API_CHANNEL_MAP.labels.chooseTrainingDir),
    exportTraining: call(API_CHANNEL_MAP.labels.exportTraining),
    trainingStatus: call(API_CHANNEL_MAP.labels.trainingStatus),
    cancelTraining: call(API_CHANNEL_MAP.labels.cancelTraining),
    reviewSources: call(API_CHANNEL_MAP.labels.reviewSources),
    compareSets: call(API_CHANNEL_MAP.labels.compareSets),
    previewFinal: call(API_CHANNEL_MAP.labels.previewFinal),
    saveFinal: call(API_CHANNEL_MAP.labels.saveFinal),
    chooseReviewCsvPath: call(API_CHANNEL_MAP.labels.chooseReviewCsvPath),
    saveReviewCsv: call(API_CHANNEL_MAP.labels.saveReviewCsv),
    submitSet: call(API_CHANNEL_MAP.labels.submitSet),
    startReconcile: call(API_CHANNEL_MAP.labels.startReconcile),
    physicalDefects: call(API_CHANNEL_MAP.labels.physicalDefects)
  },
  onProgress: (cb: (ev: ProgressEvent) => void) => {
    const listener = (_e: IpcRendererEvent, ev: ProgressEvent): void => cb(ev)
    ipcRenderer.on(IPC_EVENTS.progress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.progress, listener)
    }
  }
}

contextBridge.exposeInMainWorld('pautApi', api)
