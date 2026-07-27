import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'

import {
  BASELINE_EXPORT_CHANNEL,
  BASELINE_GENERATE_CHANNEL,
  parseBaselineExportRequest,
  parseBaselineGenerateRequest,
  type BaselineExportResult,
  type BaselineGenerateRequest,
  type BaselineTable
} from '@shared/baseline-contract'

import type { AdminSessionService } from '../services/admin-session.service'
import type { BaselineOptions, BaselineService } from '../services/baseline.service'
import { loadRecords, resolveProjectDataFilePath } from '../services/record.service'
import type { ProjectIpcState } from './project.ipc'
import { assertTrustedSender, type IpcMainLike } from './types'

interface BaselineWriterResult {
  outputPath: string
  rowCount: number
}

export interface BaselineIpcServices {
  sessionService: Pick<AdminSessionService, 'authorize'>
  baselineService: Pick<BaselineService, 'generateTable'>
  writeTable?: (outputPath: string, table: BaselineTable) => BaselineWriterResult
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function writeBaselineTableCsv(
  requestedPath: string,
  table: BaselineTable
): BaselineWriterResult {
  const outputPath = extname(requestedPath).toLowerCase() === '.csv'
    ? requestedPath
    : `${requestedPath}.csv`
  const outputDirectory = dirname(outputPath)
  if (!existsSync(outputDirectory)) mkdirSync(outputDirectory, { recursive: true })

  const groupHeaders = table.headers.filter((header) => header.key !== 'total')
  const header = [
    '变量',
    '标签',
    table.headers.find((item) => item.key === 'total')?.label ?? '总体',
    ...groupHeaders.map((item) => item.label),
    'P值',
    '检验方法'
  ]
  const rows = table.rows.map((row) => [
    row.variable,
    row.label,
    row.total,
    ...groupHeaders.map((group) => row.groups?.[group.key] ?? ''),
    row.pValue,
    row.testUsed
  ])
  const csv = [header, ...rows]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\n')
  writeFileSync(outputPath, `\uFEFF${csv}`, 'utf8')
  return { outputPath, rowCount: table.rows.length }
}

function loadBaselineOptions(
  projectState: ProjectIpcState,
  request: BaselineGenerateRequest
): BaselineOptions {
  const project = projectState.currentProject
  if (!project) throw new Error('NO_PROJECT_OPEN')
  const key = projectState.auth.encryptionKey
  if (!key) throw new Error('PROJECT_NOT_UNLOCKED')
  if (!projectState.currentFilePath) throw new Error('NO_PROJECT_OPEN')
  const dataPath = resolveProjectDataFilePath(projectState.currentFilePath, project.meta.name)
  return {
    records: existsSync(dataPath) ? loadRecords(dataPath, key) : [],
    questions: project.questionnaire.questions,
    ...request
  }
}

function stableBaselineError(error: unknown, fallback: string): string {
  const code = error instanceof Error ? error.message : ''
  return ['NO_PROJECT_OPEN', 'PROJECT_NOT_UNLOCKED', 'GROUP_QUESTION_NOT_FOUND'].includes(code)
    ? code
    : fallback
}

function throwStableBaselineError(code: string): never {
  throw new Error(code)
}

export function registerBaselineIpcHandlers(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  services: BaselineIpcServices,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  const writeTable = services.writeTable ?? writeBaselineTableCsv

  ipcMain.handle(BASELINE_GENERATE_CHANNEL, async (event, rawRequest) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseBaselineGenerateRequest(rawRequest)
    services.sessionService.authorize()
    try {
      return services.baselineService.generateTable(loadBaselineOptions(projectState, request))
    } catch (error) {
      throwStableBaselineError(stableBaselineError(error, 'BASELINE_GENERATION_FAILED'))
    }
  })

  ipcMain.handle(BASELINE_EXPORT_CHANNEL, async (event, rawRequest) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseBaselineExportRequest(rawRequest)
    services.sessionService.authorize()
    try {
      const { outputPath, ...selection } = request
      const table = services.baselineService.generateTable(
        loadBaselineOptions(projectState, selection)
      )
      return {
        success: true,
        ...writeTable(outputPath, table)
      } satisfies BaselineExportResult
    } catch (error) {
      return {
        success: false,
        error: stableBaselineError(error, 'BASELINE_EXPORT_FAILED')
      } satisfies BaselineExportResult
    }
  })

  return () => {
    ipcMain.removeHandler(BASELINE_GENERATE_CHANNEL)
    ipcMain.removeHandler(BASELINE_EXPORT_CHANNEL)
  }
}
