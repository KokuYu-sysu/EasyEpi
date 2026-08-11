import { existsSync } from 'node:fs'

import { QUALITY_GET_SUMMARY_CHANNEL, type QualityGetSummaryResult } from '@shared/quality-contract'

import type { AdminSessionService } from '../services/admin-session.service'
import { loadRecords, resolveProjectDataFilePath } from '../services/record.service'
import type { QualityService } from '../services/quality.service'
import type { ProjectIpcState } from './project.ipc'
import { assertTrustedSender, type IpcMainLike } from './types'

export interface QualityIpcServices {
  sessionService: Pick<AdminSessionService, 'authorize'>
  qualityService: Pick<QualityService, 'analyze'>
}

function stableQualityError(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  return code === 'NO_PROJECT_OPEN' || code === 'PROJECT_NOT_UNLOCKED' ? code : 'QUALITY_FAILED'
}

export function registerQualityIpcHandlers(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  services: QualityIpcServices,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(QUALITY_GET_SUMMARY_CHANNEL, async (event) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    services.sessionService.authorize()

    try {
      const project = projectState.currentProject
      if (!project) throw new Error('NO_PROJECT_OPEN')
      const key = projectState.auth.encryptionKey
      if (!key) throw new Error('PROJECT_NOT_UNLOCKED')
      if (!projectState.currentFilePath) throw new Error('NO_PROJECT_OPEN')
      const dataPath = resolveProjectDataFilePath(projectState.currentFilePath, project.meta.name)
      const records = existsSync(dataPath) ? loadRecords(dataPath, key) : []
      const summary = services.qualityService.analyze(project.questionnaire, records)
      return { ok: true, summary } satisfies QualityGetSummaryResult
    } catch (error) {
      return { ok: false, error: stableQualityError(error) } satisfies QualityGetSummaryResult
    }
  })

  return () => {
    ipcMain.removeHandler(QUALITY_GET_SUMMARY_CHANNEL)
  }
}
