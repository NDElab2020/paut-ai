/** IpcHandlers 표 → ipcMain.handle 등록. 결과는 ApiResult 로 포장하고 신뢰하지 않는 발신자는 거부한다. */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, type IpcChannel, type IpcHandlers } from '@shared/api'
import { fail, ok, toApiError, type ApiResult } from '@shared/errors'
import { isTrustedUrl } from './security'

function trustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url
  return typeof url === 'string' && isTrustedUrl(url)
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  for (const channel of Object.values(IPC) as IpcChannel[]) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown
    ipcMain.handle(channel, async (e, ...args: unknown[]): Promise<ApiResult<unknown>> => {
      if (!trustedSender(e)) return fail('INVALID_ARGUMENT', '허용되지 않은 호출입니다.')
      try {
        return ok(await handler(...args))
      } catch (err) {
        const res = toApiError(err)
        if (res.code === 'INTERNAL') console.error(`[ipc] ${channel}`, err)
        return res
      }
    })
  }
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel)
}
