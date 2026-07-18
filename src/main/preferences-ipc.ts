import {
  parsePreferencesResult,
  parsePreferencesUpdateRequest,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL,
  type PreferencesResult
} from '@shared/preferences-contract'

import type { PreferencesStore } from './preferences-store'
import { assertTrustedSender } from './system-ipc'

interface IpcInvokeEventLike {
  senderFrame?: {
    url: string
  } | null
}

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: IpcInvokeEventLike, request?: unknown) => Promise<PreferencesResult>
  ): void
  removeHandler(channel: string): void
}

function assertTrustedEvent(
  event: IpcInvokeEventLike,
  packagedRendererUrl: string,
  developmentOrigin?: string
): void {
  if (event.senderFrame === undefined || event.senderFrame === null) {
    throw new Error('MISSING_IPC_SENDER_FRAME')
  }

  assertTrustedSender(event.senderFrame.url, packagedRendererUrl, developmentOrigin)
}

export function registerPreferencesIpc(
  ipcMain: IpcMainLike,
  store: PreferencesStore,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(PREFERENCES_GET_CHANNEL, async (event) => {
    assertTrustedEvent(event, packagedRendererUrl, developmentOrigin)

    try {
      return parsePreferencesResult(await store.get())
    } catch {
      return { ok: false, code: 'PREFERENCES_READ_FAILED' }
    }
  })

  ipcMain.handle(PREFERENCES_UPDATE_CHANNEL, async (event, rawRequest) => {
    assertTrustedEvent(event, packagedRendererUrl, developmentOrigin)

    let request
    try {
      request = parsePreferencesUpdateRequest(rawRequest)
    } catch {
      return { ok: false, code: 'INVALID_PREFERENCES_REQUEST' }
    }

    try {
      return parsePreferencesResult(await store.update(request))
    } catch {
      return { ok: false, code: 'PREFERENCES_SAVE_FAILED' }
    }
  })

  let disposed = false
  return () => {
    if (disposed) {
      return
    }
    disposed = true
    ipcMain.removeHandler(PREFERENCES_GET_CHANNEL)
    ipcMain.removeHandler(PREFERENCES_UPDATE_CHANNEL)
  }
}
