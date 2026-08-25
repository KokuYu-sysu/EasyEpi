import {
  EPIDATA_IMPORT_CHANNEL,
  EPIDATA_IMPORT_PROGRESS_CHANNEL,
  EPIDATA_PREVIEW_CHANNEL,
  EPIDATA_VALIDATE_CHANNEL,
  parseEpiDataImportRequest,
  parseEpiDataPreviewRequest,
  parseEpiDataValidateRequest
} from '@shared/epidata-contract'
import type { ImportProgress } from '@shared/types/epidata'

import { ImportService } from '../services/import.service'
import {
  decryptProjectData,
  readProjectHeader,
  verifyAndDeriveKey
} from '../services/project.service'
import type { ProjectIpcState } from './project.ipc'
import { assertTrustedSender } from './types'
import type { IpcMainLike } from './types'

export function registerEpiDataIpcHandlers(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  packagedRendererUrl: string,
  developmentOrigin?: string,
  invalidateAdminSession: () => void = () => undefined
): () => void {
  const importService = new ImportService()

  ipcMain.handle(EPIDATA_IMPORT_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const parsed = parseEpiDataImportRequest(request)
    invalidateAdminSession()
    const onProgress = (progress: ImportProgress) => {
      event.sender?.send(EPIDATA_IMPORT_PROGRESS_CHANNEL, progress)
    }
    const result = await importService.importEpiData({ ...parsed, onProgress })
    if (result.success) {
      const header = readProjectHeader(result.projectPath)
      const key = verifyAndDeriveKey(parsed.password, header.saltHex, header.hashHex)
      if (key === null) throw new Error('IMPORTED_PROJECT_UNLOCK_FAILED')
      const project = decryptProjectData(result.projectPath, key)
      projectState.currentProject = project
      projectState.currentFilePath = result.projectPath
      projectState.currentSaltHex = header.saltHex
      projectState.currentHashHex = header.hashHex
      projectState.auth.encryptionKey = key
      projectState.auth.passwordData = { hash: header.hashHex, salt: header.saltHex }
    }
    return result
  })

  ipcMain.handle(EPIDATA_PREVIEW_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const parsed = parseEpiDataPreviewRequest(request)
    return importService.previewImport(parsed.qesFilePath, parsed.encoding)
  })

  ipcMain.handle(EPIDATA_VALIDATE_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const parsed = parseEpiDataValidateRequest(request)
    return importService.validateQES(parsed.qesFilePath)
  })

  return () => {
    ipcMain.removeHandler(EPIDATA_IMPORT_CHANNEL)
    ipcMain.removeHandler(EPIDATA_PREVIEW_CHANNEL)
    ipcMain.removeHandler(EPIDATA_VALIDATE_CHANNEL)
  }
}
