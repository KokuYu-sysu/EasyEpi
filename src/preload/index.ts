import { contextBridge, ipcRenderer } from 'electron'

import {
  createDesktopApi,
  type DesktopEventBridge,
  type DesktopInvoke
} from './desktop-api'

function invoke(channel: string, request?: unknown): Promise<unknown> {
  return request === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, request)
}

const events: DesktopEventBridge = {
  on: (channel, listener) => { ipcRenderer.on(channel, listener) },
  removeListener: (channel, listener) => { ipcRenderer.removeListener(channel, listener) }
}

const desktopApi = createDesktopApi(invoke as DesktopInvoke, events)

contextBridge.exposeInMainWorld('easyEpi', desktopApi)
