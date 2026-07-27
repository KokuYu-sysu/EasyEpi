import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ALL_EXPORT_CHANNELS,
  EXPORT_CSV_CHANNEL,
  type ExportCsvResult
} from '@shared/export-contract'
import { registerExportIpcHandlers } from '../../../src/main/ipc/export.ipc'
import { createProjectIpcState } from '../../../src/main/ipc/project.ipc'
import {
  appendRecord,
  createDataFile,
  getDataFilePath
} from '../../../src/main/services/record.service'

const packagedRendererUrl = 'file:///D:/EasyEpi/out/renderer/index.html'
const trustedEvent = { senderFrame: { url: packagedRendererUrl } }
const testDirectories: string[] = []

type Handler = (
  event: { senderFrame?: { url: string } | null },
  request?: unknown
) => Promise<unknown>

function setup() {
  const folderPath = join(tmpdir(), `easyepi-export-ipc-${randomUUID()}`)
  testDirectories.push(folderPath)
  const key = Buffer.alloc(32, 7)
  const state = createProjectIpcState()
  state.currentProject = {
    meta: {
      name: 'study',
      folderPath,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModifiedAt: '2026-01-01T00:00:00.000Z'
    },
    questionnaire: {
      name: 'study',
      conditionRules: [],
      keyQuestionIds: [],
      questions: [
        {
          id: 'q-age',
          variableName: 'age',
          content: '年龄',
          type: 'numeric_range',
          options: [],
          constraint: { type: 'integer' },
          isKey: false,
          allowSkip: true,
          order: 0
        },
        {
          id: 'q-id',
          variableName: 'id',
          content: '外部编号',
          type: 'free_text',
          options: [],
          constraint: { type: 'none' },
          isKey: false,
          allowSkip: true,
          order: 2
        },
        {
          id: 'q-symptoms',
          variableName: 'symptoms',
          content: '症状',
          type: 'multiple_choice',
          options: [{ value: 'fever', label: '发热' }],
          constraint: { type: 'none' },
          isKey: false,
          allowSkip: true,
          order: 1
        }
      ]
    }
  }
  state.currentFilePath = join(folderPath, 'study.easyepi')
  state.currentHashHex = 'hash'
  state.currentSaltHex = 'salt'
  state.auth.encryptionKey = key

  const dataPath = getDataFilePath(folderPath, 'study')
  createDataFile(dataPath, key)
  appendRecord(dataPath, key, {
    id: 'record-1',
    answers: { 'q-age': 10, 'q-id': 'external-1', 'q-symptoms': ['fever'] },
    createdAt: '2026-01-01T01:00:00.000Z',
    updatedAt: '2026-01-01T02:00:00.000Z'
  })
  appendRecord(dataPath, key, {
    id: 'record-2',
    answers: { 'q-age': 20, 'q-id': 'external-2' },
    createdAt: '2026-01-02T01:00:00.000Z',
    updatedAt: '2026-01-02T02:00:00.000Z'
  })

  const sessionService = { authorize: vi.fn(() => ({ isAuthenticated: true })) }
  const exportCSV = vi.fn(async (): Promise<ExportCsvResult> => ({
      success: true,
      csvPath: 'D:/reports/study.csv',
      dictionaryPath: 'D:/reports/study_dictionary.txt',
      recordCount: 1,
      columnCount: 6
    }))
  const exportService = { exportCSV }
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  }
  const dispose = registerExportIpcHandlers(
    ipcMain,
    state,
    { sessionService, exportService },
    packagedRendererUrl
  )
  return { state, handlers, ipcMain, dispose, sessionService, exportService }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (existsSync(directory)) rmSync(directory, { recursive: true })
  }
})

describe('export IPC', () => {
  it('registers and disposes every export channel', () => {
    const { handlers, ipcMain, dispose } = setup()
    expect([...handlers.keys()]).toEqual(ALL_EXPORT_CHANNELS)
    dispose()
    for (const channel of ALL_EXPORT_CHANNELS) {
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(channel)
    }
  })

  it('checks trust and parses strictly before authorizing the admin session', async () => {
    const { handlers, sessionService } = setup()
    const handler = handlers.get(EXPORT_CSV_CHANNEL)!

    await expect(handler(
      { senderFrame: { url: 'https://attacker.invalid' } },
      { outputPath: 'D:/x.csv', encoding: 'multi_category', scope: 'all' }
    )).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    await expect(handler(trustedEvent, {
      outputPath: 'D:/x.csv',
      encoding: 'multi_category',
      scope: 'all',
      records: [{ id: 'plaintext' }]
    })).rejects.toThrow('INVALID_EXPORT_REQUEST')
    expect(sessionService.authorize).not.toHaveBeenCalled()
  })

  it('loads encrypted records in the main process, selects by id, and flattens question variables', async () => {
    const { handlers, exportService } = setup()

    await expect(handlers.get(EXPORT_CSV_CHANNEL)!(trustedEvent, {
      outputPath: 'D:/reports/study.csv',
      encoding: 'dummy',
      dummyReference: 'last',
      scope: 'selected',
      selectedIds: ['record-2']
    })).resolves.toMatchObject({ success: true, recordCount: 1 })

    expect(exportService.exportCSV).toHaveBeenCalledWith({
      outputPath: 'D:/reports/study.csv',
      encoding: 'dummy',
      dummyReference: 'last',
      metadataHeaders: ['__easyepi_record_id', '__easyepi_created_at', '__easyepi_updated_at'],
      records: [{
        __easyepi_record_id: 'record-2',
        __easyepi_created_at: '2026-01-02T01:00:00.000Z',
        __easyepi_updated_at: '2026-01-02T02:00:00.000Z',
        age: 20,
        id: 'external-2',
        symptoms: undefined
      }],
      questions: [
        { variableName: 'age', label: '年龄', type: 'numeric_range', options: [] },
        { variableName: 'id', label: '外部编号', type: 'free_text', options: [] },
        {
          variableName: 'symptoms',
          label: '症状',
          type: 'multiple_choice',
          options: [{ value: 'fever', label: '发热' }]
        }
      ]
    })
  })

  it('returns stable failures without exposing service or filesystem paths', async () => {
    const { state, handlers, exportService } = setup()
    exportService.exportCSV.mockResolvedValueOnce({
      success: false,
      error: 'EACCES: D:/private/study.csv'
    })
    await expect(handlers.get(EXPORT_CSV_CHANNEL)!(trustedEvent, {
      outputPath: 'D:/reports/study.csv',
      encoding: 'one_hot',
      scope: 'all'
    })).resolves.toEqual({ success: false, error: 'EXPORT_FAILED' })

    state.currentProject = null
    await expect(handlers.get(EXPORT_CSV_CHANNEL)!(trustedEvent, {
      outputPath: 'D:/reports/study.csv',
      encoding: 'one_hot',
      scope: 'all'
    })).resolves.toEqual({ success: false, error: 'NO_PROJECT_OPEN' })
  })
})
