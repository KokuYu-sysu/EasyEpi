import { contextBridge, ipcRenderer } from 'electron'

import { createDesktopApi } from './desktop-api'

const desktopApi = createDesktopApi((channel, request) => ipcRenderer.invoke(channel, request))

contextBridge.exposeInMainWorld('easyEpi', desktopApi)
