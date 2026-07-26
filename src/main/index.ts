import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, ipcMain, session } from 'electron'

import { registerPreferencesIpc } from './preferences-ipc'
import { createPreferencesStore } from './preferences-store'
import { registerSystemIpc } from './system-ipc'
import {
  createWindowOptions,
  isTrustedRendererUrl,
  resolveDevelopmentRendererUrl
} from './window-policy'
import { createProjectIpcState, registerProjectIpc } from './ipc/project.ipc'
import { registerQnaireIpc } from './ipc/qnaire.ipc'
import { registerDialogIpc } from './dialog-ipc'
import { createRecordIpcState, registerRecordIpc } from './ipc/record.ipc'
import { registerEpiDataIpcHandlers } from './ipc/epidata.ipc'
import { registerAdminIpcHandlers } from './ipc/admin.ipc'

const APP_ID = 'com.kokuyu.easyepi'
const developmentUrl = resolveDevelopmentRendererUrl(
  app.isPackaged,
  process.env['ELECTRON_RENDERER_URL']
)
const packagedRendererPath = join(__dirname, '../renderer/index.html')
const packagedRendererUrl = pathToFileURL(packagedRendererPath).href
const preloadPath = join(__dirname, '../preload/index.cjs')

let mainWindow: BrowserWindow | null = null
let disposePreferencesIpc: (() => void) | undefined
let disposeSystemIpc: (() => void) | undefined
let disposeProjectIpc: (() => void) | undefined
let disposeQnaireIpc: (() => void) | undefined
let disposeDialogIpc: (() => void) | undefined
let disposeRecordIpc: (() => void) | undefined

app.setAppUserModelId(APP_ID)

function configureSessionPermissions(): void {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(createWindowOptions(preloadPath))

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl, packagedRendererUrl, developmentUrl)) {
      event.preventDefault()
    }
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(packagedRendererPath)
  }

  mainWindow = window
  return window
}

void app.whenReady().then(() => {
  configureSessionPermissions()
  disposeSystemIpc = registerSystemIpc(
    ipcMain,
    { version: app.getVersion(), platform: process.platform },
    packagedRendererUrl,
    developmentUrl
  )
  const preferencesStore = createPreferencesStore(app.getPath('userData'))
  disposePreferencesIpc = registerPreferencesIpc(
    ipcMain,
    preferencesStore,
    packagedRendererUrl,
    developmentUrl
  )
  const projectState = createProjectIpcState()
  disposeProjectIpc = registerProjectIpc(
    ipcMain,
    projectState,
    packagedRendererUrl,
    developmentUrl
  )
  disposeQnaireIpc = registerQnaireIpc(
    ipcMain,
    projectState,
    packagedRendererUrl,
    developmentUrl
  )
  disposeDialogIpc = registerDialogIpc(
    ipcMain,
    packagedRendererUrl,
    developmentUrl
  )
  const recordState = createRecordIpcState()
  disposeRecordIpc = registerRecordIpc(
    ipcMain,
    projectState,
    recordState,
    packagedRendererUrl,
    developmentUrl
  )
  registerEpiDataIpcHandlers(packagedRendererUrl, developmentUrl)
  registerAdminIpcHandlers(packagedRendererUrl, developmentUrl)
  createMainWindow()

  app.on('activate', () => {
    if (mainWindow === null) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  disposePreferencesIpc?.()
  disposePreferencesIpc = undefined
  disposeSystemIpc?.()
  disposeSystemIpc = undefined
  disposeProjectIpc?.()
  disposeProjectIpc = undefined
  disposeQnaireIpc?.()
  disposeQnaireIpc = undefined
  disposeDialogIpc?.()
  disposeDialogIpc = undefined
  disposeRecordIpc?.()
  disposeRecordIpc = undefined
})
