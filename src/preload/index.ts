import { contextBridge, ipcRenderer } from 'electron'

import { createDesktopApi, type DesktopInvoke } from './desktop-api'

function invoke(channel: string, request?: unknown): Promise<unknown> {
  return request === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, request)
}

const desktopApi = createDesktopApi(invoke as DesktopInvoke)

contextBridge.exposeInMainWorld('easyEpi', desktopApi)
