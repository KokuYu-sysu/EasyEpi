import { ipcMain } from 'electron'
import { ImportService } from '../services/import.service'
import {
  EPIDATA_IMPORT_CHANNEL,
  EPIDATA_PREVIEW_CHANNEL,
  EPIDATA_VALIDATE_CHANNEL,
  EPIDATA_IMPORT_PROGRESS_CHANNEL,
  parseEpiDataImportRequest,
  parseEpiDataPreviewRequest,
  parseEpiDataValidateRequest
} from '@shared/epidata-contract'
import { assertTrustedSender } from './types'
import type { ImportProgress } from '@shared/types/epidata'

const importService = new ImportService()

export function registerEpiDataIpcHandlers(
  packagedRendererUrl: string,
  developmentOrigin?: string
): void {
  ipcMain.handle(EPIDATA_IMPORT_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const parsed = parseEpiDataImportRequest(request)
    
    // Use webContents to send progress updates
    const webContents = event.sender
    const onProgress = (progress: ImportProgress) => {
      webContents.send(EPIDATA_IMPORT_PROGRESS_CHANNEL, progress)
    }
    
    return importService.importEpiData(parsed.qesFilePath, parsed.targetProjectPath, onProgress)
  })

  ipcMain.handle(EPIDATA_PREVIEW_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const parsed = parseEpiDataPreviewRequest(request)
    return importService.previewImport(parsed.qesFilePath)
  })

  ipcMain.handle(EPIDATA_VALIDATE_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const parsed = parseEpiDataValidateRequest(request)
    return importService.validateQES(parsed.qesFilePath)
  })
}