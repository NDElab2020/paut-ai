import { BrowserWindow } from 'electron'
import { IPC_EVENTS } from '@shared/api'
import type { ProgressEvent } from '@shared/types'

/** 모든 창에 진행률 이벤트 전송 */
export function broadcastProgress(ev: ProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.progress, ev)
  }
}
