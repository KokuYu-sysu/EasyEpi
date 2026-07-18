import { contextBridge, ipcRenderer } from 'electron'

import { createDesktopApi } from './desktop-api'

const desktopApi = createDesktopApi((channel, request) =>
  request === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, request)
)

contextBridge.exposeInMainWorld('easyEpi', desktopApi)
