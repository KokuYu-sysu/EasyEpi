import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ALL_BASELINE_CHANNELS,
  BASELINE_EXPORT_CHANNEL,
  BASELINE_GENERATE_CHANNEL,
  type BaselineTable
} from '@shared/baseline-contract'
import {
  registerBaselineIpcHandlers,
  writeBaselineTableCsv
} from '../../../src/main/ipc/baseline.ipc'
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

const table: BaselineTable = {
  headers: [
    { key: 'total', label: '总体 (n=2)' },
    { key: 'A', label: '干预组 (n=1)' }
  ],
  rows: [{
    variable: 'age',
    label: '年龄,岁',
    total: '15.00 ± 7.07',
    groups: { A: '10.00 ± 0.00' },
    pValue: 0.04,
    testUsed: 'Welch t 检验'
  }]
}

function setup() {
  const folderPath = join(tmpdir(), `easyepi-baseline-ipc-${randomUUID()}`)
  testDirectories.push(folderPath)
  const key = Buffer.alloc(32, 8)
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
      questions: [{
        id: 'q-age',
        variableName: 'age',
        content: '年龄',
        type: 'numeric_range',
        options: [],
        constraint: { type: 'integer' },
        isKey: false,
        allowSkip: true,
        order: 0
      }]
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
    answers: { 'q-age': 10 },
    createdAt: '2026-01-01T01:00:00.000Z',
    updatedAt: '2026-01-01T02:00:00.000Z'
  })

  const sessionService = { authorize: vi.fn(() => ({ isAuthenticated: true })) }
  const baselineService = { generateTable: vi.fn(() => table) }
  const writer = vi.fn(() => ({ outputPath: 'D:/reports/baseline.csv', rowCount: 1 }))
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  }
  const dispose = registerBaselineIpcHandlers(
    ipcMain,
    state,
    { sessionService, baselineService, writeTable: writer },
    packagedRendererUrl
  )
  return { state, handlers, ipcMain, dispose, sessionService, baselineService, writer }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (existsSync(directory)) rmSync(directory, { recursive: true })
  }
})

describe('baseline IPC', () => {
  it('registers and disposes every baseline channel', () => {
    const { handlers, ipcMain, dispose } = setup()
    expect([...handlers.keys()]).toEqual(ALL_BASELINE_CHANNELS)
    dispose()
    for (const channel of ALL_BASELINE_CHANNELS) {
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(channel)
    }
  })

  it('checks trust and parses strictly before authorizing the admin session', async () => {
    const { handlers, sessionService } = setup()
    await expect(handlers.get(BASELINE_GENERATE_CHANNEL)!(
      { senderFrame: { url: 'https://attacker.invalid' } },
      {}
    )).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    await expect(handlers.get(BASELINE_GENERATE_CHANNEL)!(trustedEvent, {
      records: [{ id: 'renderer-plaintext' }]
    })).rejects.toThrow('INVALID_BASELINE_REQUEST')
    expect(sessionService.authorize).not.toHaveBeenCalled()
  })

  it('regenerates a table from active encrypted records for preview and export', async () => {
    const { handlers, baselineService, writer } = setup()

    await expect(handlers.get(BASELINE_GENERATE_CHANNEL)!(trustedEvent, {
      selectedQuestionIds: ['q-age']
    })).resolves.toEqual(table)
    expect(baselineService.generateTable).toHaveBeenLastCalledWith(expect.objectContaining({
      records: [expect.objectContaining({ id: 'record-1', answers: { 'q-age': 10 } })],
      questions: [expect.objectContaining({ id: 'q-age' })],
      selectedQuestionIds: ['q-age']
    }))

    await expect(handlers.get(BASELINE_EXPORT_CHANNEL)!(trustedEvent, {
      outputPath: 'D:/reports/baseline.csv',
      selectedQuestionIds: ['q-age']
    })).resolves.toEqual({
      success: true,
      outputPath: 'D:/reports/baseline.csv',
      rowCount: 1
    })
    expect(baselineService.generateTable).toHaveBeenCalledTimes(2)
    expect(writer).toHaveBeenCalledWith('D:/reports/baseline.csv', table)
  })

  it('returns stable errors without leaking paths or statistical internals', async () => {
    const { handlers, baselineService, writer } = setup()
    baselineService.generateTable.mockImplementationOnce(() => {
      throw new Error('D:/private/study.easyepi could not be read')
    })
    await expect(handlers.get(BASELINE_GENERATE_CHANNEL)!(trustedEvent, {})).rejects.toThrow(
      'BASELINE_GENERATION_FAILED'
    )

    writer.mockImplementationOnce(() => {
      throw new Error('EACCES: D:/private/baseline.csv')
    })
    await expect(handlers.get(BASELINE_EXPORT_CHANNEL)!(trustedEvent, {
      outputPath: 'D:/reports/baseline.csv'
    })).resolves.toEqual({ success: false, error: 'BASELINE_EXPORT_FAILED' })
  })
})

describe('writeBaselineTableCsv', () => {
  it('writes a UTF-8 BOM CSV with escaped cells and the generated group columns', () => {
    const directory = join(tmpdir(), `easyepi-baseline-writer-${randomUUID()}`)
    testDirectories.push(directory)
    const result = writeBaselineTableCsv(join(directory, 'table'), table)

    expect(result).toEqual({ outputPath: join(directory, 'table.csv'), rowCount: 1 })
    const csv = readFileSync(result.outputPath, 'utf8')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('变量,标签,总体 (n=2),干预组 (n=1),P值,检验方法')
    expect(csv).toContain('age,"年龄,岁",15.00 ± 7.07,10.00 ± 0.00,0.04,Welch t 检验')
  })
})
