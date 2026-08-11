import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ALL_DOUBLE_ENTRY_CHANNELS,
  DOUBLE_ENTRY_IMPORT_CHANNEL,
  DOUBLE_ENTRY_COMPARE_CHANNEL
} from '@shared/double-entry-contract'
import type { DoubleEntryComparison } from '@shared/types/double-entry'
import { registerDoubleEntryIpcHandlers } from '../../../src/main/ipc/double-entry.ipc'
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

const comparison: DoubleEntryComparison = {
  secondaryFileName: 'b.csv',
  encoding: 'utf-8',
  primaryCount: 1,
  secondaryCount: 1,
  matchedIdentical: 1,
  matchedWithDiffs: 0,
  recordsOnlyInPrimary: 0,
  recordsOnlyInSecondary: 0,
  matched: [],
  onlyInPrimary: [],
  onlyInSecondary: []
}

function setup() {
  const folderPath = join(tmpdir(), `easyepi-double-entry-ipc-${randomUUID()}`)
  testDirectories.push(folderPath)
  const key = Buffer.alloc(32, 10)
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
      keyQuestionIds: ['q-pid'],
      questions: [
        {
          id: 'q-pid',
          variableName: 'pid',
          content: '编号',
          type: 'free_text',
          options: [],
          constraint: { type: 'none' },
          isKey: true,
          allowSkip: false,
          order: 0
        },
        {
          id: 'q-age',
          variableName: 'age',
          content: '年龄',
          type: 'numeric_range',
          options: [],
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
    answers: { 'q-pid': '001', 'q-age': '30' },
    createdAt: '2026-01-01T01:00:00.000Z',
    updatedAt: '2026-01-01T02:00:00.000Z'
  })

  const secondaryPath = join(folderPath, 'secondary.csv')
  writeFileSync(secondaryPath, 'pid,age\n001,30\n')

  const sessionService = { authorize: vi.fn(() => ({ isAuthenticated: true })) }
  const doubleEntryService = { compare: vi.fn(() => comparison) }
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  }
  const dispose = registerDoubleEntryIpcHandlers(
    ipcMain,
    state,
    { sessionService, doubleEntryService },
    packagedRendererUrl
  )
  return { state, handlers, ipcMain, dispose, sessionService, doubleEntryService, secondaryPath }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (existsSync(directory)) rmSync(directory, { recursive: true })
  }
})

describe('double entry IPC', () => {
  it('registers and disposes every channel', () => {
    const { handlers, ipcMain, dispose } = setup()
    expect([...handlers.keys()]).toEqual(ALL_DOUBLE_ENTRY_CHANNELS)
    dispose()
    for (const channel of ALL_DOUBLE_ENTRY_CHANNELS) {
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(channel)
    }
  })

  it('checks trust and authorizes the admin session', async () => {
    const { handlers, sessionService } = setup()
    await expect(handlers.get(DOUBLE_ENTRY_IMPORT_CHANNEL)!(
      { senderFrame: { url: 'https://attacker.invalid' } },
      { filePath: 'C:/x.csv' }
    )).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    expect(sessionService.authorize).not.toHaveBeenCalled()
  })

  it('imports a secondary CSV and reports row count and encoding', async () => {
    const { handlers, secondaryPath } = setup()
    await expect(handlers.get(DOUBLE_ENTRY_IMPORT_CHANNEL)!(trustedEvent, {
      filePath: secondaryPath
    })).resolves.toMatchObject({ ok: true, rowCount: 1, headers: ['pid', 'age'], encoding: 'utf-8' })
  })

  it('loads primary records and runs the comparison', async () => {
    const { handlers, doubleEntryService, secondaryPath } = setup()
    await expect(handlers.get(DOUBLE_ENTRY_COMPARE_CHANNEL)!(trustedEvent, {
      secondaryFilePath: secondaryPath
    })).resolves.toMatchObject({ ok: true, comparison: expect.objectContaining({ secondaryFileName: 'secondary.csv' }) })
    expect(doubleEntryService.compare).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'record-1' })],
      [expect.objectContaining({ pid: '001', age: '30' })],
      expect.objectContaining({ name: 'study' }),
      ['pid']
    )
  })

  it('returns stable errors', async () => {
    const { state, handlers } = setup()
    await expect(handlers.get(DOUBLE_ENTRY_COMPARE_CHANNEL)!(trustedEvent, {
      secondaryFilePath: join(state.currentProject!.meta.folderPath, 'missing.csv')
    })).resolves.toEqual({ ok: false, error: 'DOUBLE_ENTRY_FILE_NOT_FOUND' })
  })
})
