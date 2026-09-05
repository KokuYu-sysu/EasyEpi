import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, ipcMain, Menu, safeStorage, session } from 'electron'

import { registerPreferencesIpc } from './preferences-ipc'
import { createPreferencesStore } from './preferences-store'
import { registerSystemIpc } from './system-ipc'
import {
  createWindowOptions,
  isTrustedRendererUrl,
  resolveDevelopmentRendererUrl
} from './window-policy'
import { createProjectIpcState, registerProjectIpc } from './ipc/project.ipc'
import { registerAIIpcHandlers } from './ipc/ai.ipc'
import { registerQnaireIpc } from './ipc/qnaire.ipc'
import { registerDerivedIpc } from './ipc/derived.ipc'
import { registerQualityIpcHandlers } from './ipc/quality.ipc'
import { registerDoubleEntryIpcHandlers } from './ipc/double-entry.ipc'
import { registerDialogIpc } from './dialog-ipc'
import { createRecordIpcState, registerRecordIpc } from './ipc/record.ipc'
import { registerEpiDataIpcHandlers } from './ipc/epidata.ipc'
import { registerAdminIpcHandlers } from './ipc/admin.ipc'
import { registerExportIpcHandlers } from './ipc/export.ipc'
import { registerBaselineIpcHandlers } from './ipc/baseline.ipc'
import { AdminSessionService } from './services/admin-session.service'
import { DataService } from './services/data.service'
import { ExportService } from './services/export.service'
import { BaselineService } from './services/baseline.service'
import { QualityService } from './services/quality.service'
import { DoubleEntryService } from './services/double-entry.service'
import { changeProjectPassword } from './services/project-rekey.service'
import { createAIConfigService } from './services/ai-config.service'

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
let disposeAIIpc: (() => void) | undefined
let disposeQnaireIpc: (() => void) | undefined
let disposeDerivedIpc: (() => void) | undefined
let disposeQualityIpc: (() => void) | undefined
let disposeDoubleEntryIpc: (() => void) | undefined
let disposeDialogIpc: (() => void) | undefined
let disposeRecordIpc: (() => void) | undefined
let disposeEpiDataIpc: (() => void) | undefined
let disposeAdminIpc: (() => void) | undefined
let disposeExportIpc: (() => void) | undefined
let disposeBaselineIpc: (() => void) | undefined

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
  Menu.setApplicationMenu(null)
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
  const adminSessionService = new AdminSessionService(projectState)
  const aiRegistration = registerAIIpcHandlers(
    ipcMain,
    projectState,
    { configService: createAIConfigService(app.getPath('userData'), safeStorage) },
    packagedRendererUrl,
    developmentUrl
  )
  disposeAIIpc = aiRegistration.dispose
  disposeProjectIpc = registerProjectIpc(
    ipcMain,
    projectState,
    packagedRendererUrl,
    developmentUrl,
    () => adminSessionService.invalidate(),
    aiRegistration.cancelAll
  )
  disposeQnaireIpc = registerQnaireIpc(
    ipcMain,
    projectState,
    packagedRendererUrl,
    developmentUrl
  )
  disposeDerivedIpc = registerDerivedIpc(
    ipcMain,
    projectState,
    { sessionService: adminSessionService },
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
  disposeEpiDataIpc = registerEpiDataIpcHandlers(
    ipcMain,
    projectState,
    packagedRendererUrl,
    developmentUrl,
    () => adminSessionService.invalidate(),
    aiRegistration.cancelAll
  )
  disposeAdminIpc = registerAdminIpcHandlers(
    ipcMain,
    projectState,
    {
      sessionService: adminSessionService,
      dataService: new DataService(projectState),
      beforeChangePassword: aiRegistration.cancelAllAndSettle,
      changeProjectPassword: async ({ oldPassword, newPassword }) =>
        changeProjectPassword(projectState, oldPassword, newPassword)
    },
    packagedRendererUrl,
    developmentUrl
  )
  disposeExportIpc = registerExportIpcHandlers(
    ipcMain,
    projectState,
    {
      sessionService: adminSessionService,
      exportService: new ExportService()
    },
    packagedRendererUrl,
    developmentUrl
  )
  disposeBaselineIpc = registerBaselineIpcHandlers(
    ipcMain,
    projectState,
    {
      sessionService: adminSessionService,
      baselineService: new BaselineService()
    },
    packagedRendererUrl,
    developmentUrl
  )
  disposeQualityIpc = registerQualityIpcHandlers(
    ipcMain,
    projectState,
    {
      sessionService: adminSessionService,
      qualityService: new QualityService()
    },
    packagedRendererUrl,
    developmentUrl
  )
  disposeDoubleEntryIpc = registerDoubleEntryIpcHandlers(
    ipcMain,
    projectState,
    {
      sessionService: adminSessionService,
      doubleEntryService: new DoubleEntryService()
    },
    packagedRendererUrl,
    developmentUrl
  )
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
  disposeAIIpc?.()
  disposeAIIpc = undefined
  disposeProjectIpc?.()
  disposeProjectIpc = undefined
  disposeQnaireIpc?.()
  disposeQnaireIpc = undefined
  disposeDerivedIpc?.()
  disposeDerivedIpc = undefined
  disposeDialogIpc?.()
  disposeDialogIpc = undefined
  disposeRecordIpc?.()
  disposeRecordIpc = undefined
  disposeEpiDataIpc?.()
  disposeEpiDataIpc = undefined
  disposeAdminIpc?.()
  disposeAdminIpc = undefined
  disposeExportIpc?.()
  disposeExportIpc = undefined
  disposeBaselineIpc?.()
  disposeBaselineIpc = undefined
  disposeQualityIpc?.()
  disposeQualityIpc = undefined
  disposeDoubleEntryIpc?.()
  disposeDoubleEntryIpc = undefined
})
