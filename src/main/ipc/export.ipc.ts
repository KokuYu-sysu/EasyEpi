import { existsSync } from 'node:fs'

import {
  EXPORT_CSV_CHANNEL,
  parseExportCsvRequest,
  type ExportCsvResult
} from '@shared/export-contract'

import type { AdminSessionService } from '../services/admin-session.service'
import type { ExportOptions, ExportService } from '../services/export.service'
import { loadRecords, resolveProjectDataFilePath } from '../services/record.service'
import type { ProjectIpcState } from './project.ipc'
import { assertTrustedSender, type IpcMainLike } from './types'

export interface ExportIpcServices {
  sessionService: Pick<AdminSessionService, 'authorize'>
  exportService: Pick<ExportService, 'exportCSV'>
}

function stableExportError(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  return code === 'NO_PROJECT_OPEN' || code === 'PROJECT_NOT_UNLOCKED'
    ? code
    : 'EXPORT_FAILED'
}

function buildExportOptions(
  projectState: ProjectIpcState,
  request: ReturnType<typeof parseExportCsvRequest>
): ExportOptions {
  const project = projectState.currentProject
  if (!project) throw new Error('NO_PROJECT_OPEN')
  const key = projectState.auth.encryptionKey
  if (!key) throw new Error('PROJECT_NOT_UNLOCKED')
  if (!projectState.currentFilePath) throw new Error('NO_PROJECT_OPEN')

  const dataPath = resolveProjectDataFilePath(projectState.currentFilePath, project.meta.name)
  const allRecords = existsSync(dataPath) ? loadRecords(dataPath, key) : []
  const usedNames = new Set(project.questionnaire.questions.map((question) => question.variableName))
  const uniqueMetadataName = (base: string): string => {
    let candidate = base
    while (usedNames.has(candidate)) candidate = `_${candidate}`
    usedNames.add(candidate)
    return candidate
  }
  const metadataHeaders = [
    uniqueMetadataName('__easyepi_record_id'),
    uniqueMetadataName('__easyepi_created_at'),
    uniqueMetadataName('__easyepi_updated_at')
  ]
  const selected = request.scope === 'selected'
    ? new Set(request.selectedIds)
    : null
  const records = allRecords
    .filter((record) => selected === null || selected.has(record.id))
    .map((record) => ({
      [metadataHeaders[0]!]: record.id,
      [metadataHeaders[1]!]: record.createdAt,
      [metadataHeaders[2]!]: record.updatedAt,
      ...Object.fromEntries(project.questionnaire.questions.map((question) => [
        question.variableName,
        record.answers[question.id] ?? record.answers[question.variableName]
      ]))
    }))
  const questions = project.questionnaire.questions.map((question) => ({
    variableName: question.variableName,
    label: question.content,
    type: question.type,
    options: question.options
  }))

  return {
    records,
    questions,
    metadataHeaders,
    encoding: request.encoding,
    ...(request.fileEncoding === undefined ? {} : { fileEncoding: request.fileEncoding }),
    ...(request.dummyReference === undefined
      ? {}
      : { dummyReference: request.dummyReference }),
    outputPath: request.outputPath
  }
}

export function registerExportIpcHandlers(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  services: ExportIpcServices,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(EXPORT_CSV_CHANNEL, async (event, rawRequest) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseExportCsvRequest(rawRequest)
    services.sessionService.authorize()

    try {
      const result = await services.exportService.exportCSV(buildExportOptions(projectState, request))
      if (!result.success) return { success: false, error: 'EXPORT_FAILED' } satisfies ExportCsvResult
      return result satisfies ExportCsvResult
    } catch (error) {
      return { success: false, error: stableExportError(error) } satisfies ExportCsvResult
    }
  })

  return () => {
    ipcMain.removeHandler(EXPORT_CSV_CHANNEL)
  }
}
