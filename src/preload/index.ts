import { contextBridge, ipcRenderer } from 'electron'

import type {
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL,
  PreferencesV1
} from '@shared/preferences-contract'
import type { SYSTEM_PING_CHANNEL, PingRequest, PingResponse } from '@shared/system-contract'
import { createDesktopApi } from './desktop-api'

function invoke(channel: typeof SYSTEM_PING_CHANNEL, request: PingRequest): Promise<PingResponse>
function invoke(channel: typeof PREFERENCES_GET_CHANNEL): Promise<unknown>
function invoke(
  channel: typeof PREFERENCES_UPDATE_CHANNEL,
  request: PreferencesV1
): Promise<unknown>
function invoke(
  channel:
    typeof SYSTEM_PING_CHANNEL | typeof PREFERENCES_GET_CHANNEL | typeof PREFERENCES_UPDATE_CHANNEL,
  request?: PingRequest | PreferencesV1
): Promise<unknown> {
  return request === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, request)
}

const desktopApi = createDesktopApi(invoke)

contextBridge.exposeInMainWorld('easyEpi', desktopApi)
