import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import {
  DOUBLE_ENTRY_IMPORT_CHANNEL,
  DOUBLE_ENTRY_COMPARE_CHANNEL,
  parseDoubleEntryImportRequest,
  parseDoubleEntryCompareRequest,
  type DoubleEntryImportResult,
  type DoubleEntryCompareResult
} from '@shared/double-entry-contract'

import type { AdminSessionService } from '../services/admin-session.service'
import type { DoubleEntryService } from '../services/double-entry.service'
import { readComparisonCsv } from '../services/double-entry.service'
import { loadRecords, resolveProjectDataFilePath } from '../services/record.service'
import type { ProjectIpcState } from './project.ipc'
import { assertTrustedSender, type IpcMainLike } from './types'

export interface DoubleEntryIpcServices {
  sessionService: Pick<AdminSessionService, 'authorize'>
  doubleEntryService: Pick<DoubleEntryService, 'compare'>
}

function stableDoubleEntryError(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'NO_PROJECT_OPEN' || code === 'PROJECT_NOT_UNLOCKED') return code
  if (code === 'ENOENT' || code.includes('ENOENT')) return 'DOUBLE_ENTRY_FILE_NOT_FOUND'
  if (code === 'DOUBLE_ENTRY_EMPTY') return code
  return 'DOUBLE_ENTRY_FAILED'
}

export function registerDoubleEntryIpcHandlers(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  services: DoubleEntryIpcServices,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(DOUBLE_ENTRY_IMPORT_CHANNEL, async (event, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    services.sessionService.authorize()
    try {
      const request = parseDoubleEntryImportRequest(rawRequest)
      const imported = readComparisonCsv(request.filePath, request.encoding)
      if (imported.headers.length === 0) throw new Error('DOUBLE_ENTRY_EMPTY')
      return {
        ok: true,
        rowCount: imported.rows.length,
        headers: imported.headers,
        encoding: imported.encoding
      } satisfies DoubleEntryImportResult
    } catch (error) {
      return { ok: false, error: stableDoubleEntryError(error) } satisfies DoubleEntryImportResult
    }
  })

  ipcMain.handle(DOUBLE_ENTRY_COMPARE_CHANNEL, async (event, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    services.sessionService.authorize()
    try {
      const request = parseDoubleEntryCompareRequest(rawRequest)

      const project = projectState.currentProject
      if (!project) throw new Error('NO_PROJECT_OPEN')
      const key = projectState.auth.encryptionKey
      if (!key) throw new Error('PROJECT_NOT_UNLOCKED')
      if (!projectState.currentFilePath) throw new Error('NO_PROJECT_OPEN')
      const dataPath = resolveProjectDataFilePath(projectState.currentFilePath, project.meta.name)
      const primary = existsSync(dataPath) ? loadRecords(dataPath, key) : []

      const secondary = readComparisonCsv(request.secondaryFilePath, request.encoding)
      const keyFieldNames = project.questionnaire.keyQuestionIds
        .map((id) => project.questionnaire.questions.find((question) => question.id === id))
        .filter((question): question is NonNullable<typeof question> => question !== undefined)
        .map((question) => question.variableName)

      const comparison = services.doubleEntryService.compare(
        primary,
        secondary.rows,
        project.questionnaire,
        keyFieldNames
      )
      return {
        ok: true,
        comparison: {
          ...comparison,
          secondaryFileName: basename(request.secondaryFilePath),
          encoding: secondary.encoding
        }
      } satisfies DoubleEntryCompareResult
    } catch (error) {
      return { ok: false, error: stableDoubleEntryError(error) } satisfies DoubleEntryCompareResult
    }
  })

  return () => {
    ipcMain.removeHandler(DOUBLE_ENTRY_IMPORT_CHANNEL)
    ipcMain.removeHandler(DOUBLE_ENTRY_COMPARE_CHANNEL)
  }
}
