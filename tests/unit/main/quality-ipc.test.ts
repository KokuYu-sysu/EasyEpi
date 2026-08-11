import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ALL_QUALITY_CHANNELS,
  QUALITY_GET_SUMMARY_CHANNEL
} from '@shared/quality-contract'
import { registerQualityIpcHandlers } from '../../../src/main/ipc/quality.ipc'
import { createProjectIpcState } from '../../../src/main/ipc/project.ipc'
import {
  appendRecord,
  createDataFile,
  getDataFilePath
} from '../../../src/main/services/record.service'
import type { QualitySummary } from '@shared/types/quality'

const packagedRendererUrl = 'file:///D:/EasyEpi/out/renderer/index.html'
const trustedEvent = { senderFrame: { url: packagedRendererUrl } }
const testDirectories: string[] = []

type Handler = (
  event: { senderFrame?: { url: string } | null },
  request?: unknown
) => Promise<unknown>

const summary: QualitySummary = {
  records: 1,
  completeness: { overall: 1, perQuestion: [] },
  outliers: [],
  contradictions: [],
  duplicates: []
}

function setup() {
  const folderPath = join(tmpdir(), `easyepi-quality-ipc-${randomUUID()}`)
  testDirectories.push(folderPath)
  const key = Buffer.alloc(32, 9)
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
    answers: { 'q-age': 10 },
    createdAt: '2026-01-01T01:00:00.000Z',
    updatedAt: '2026-01-01T02:00:00.000Z'
  })

  const sessionService = { authorize: vi.fn(() => ({ isAuthenticated: true })) }
  const qualityService = { analyze: vi.fn(() => summary) }
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  }
  const dispose = registerQualityIpcHandlers(
    ipcMain,
    state,
    { sessionService, qualityService },
    packagedRendererUrl
  )
  return { state, handlers, ipcMain, dispose, sessionService, qualityService }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (existsSync(directory)) rmSync(directory, { recursive: true })
  }
})

describe('quality IPC', () => {
  it('registers and disposes every quality channel', () => {
    const { handlers, ipcMain, dispose } = setup()
    expect([...handlers.keys()]).toEqual(ALL_QUALITY_CHANNELS)
    dispose()
    for (const channel of ALL_QUALITY_CHANNELS) {
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(channel)
    }
  })

  it('checks trust and authorizes the admin session before analyzing', async () => {
    const { handlers, sessionService } = setup()
    await expect(handlers.get(QUALITY_GET_SUMMARY_CHANNEL)!(
      { senderFrame: { url: 'https://attacker.invalid' } }
    )).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    expect(sessionService.authorize).not.toHaveBeenCalled()
  })

  it('loads encrypted records and returns the quality summary', async () => {
    const { handlers, qualityService } = setup()
    await expect(handlers.get(QUALITY_GET_SUMMARY_CHANNEL)!(trustedEvent)).resolves.toEqual({
      ok: true,
      summary
    })
    expect(qualityService.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'study' }),
      [expect.objectContaining({ id: 'record-1' })]
    )
  })

  it('returns stable errors without leaking paths', async () => {
    const { state, handlers, qualityService } = setup()
    qualityService.analyze.mockImplementationOnce(() => {
      throw new Error('D:/private/study.easyepi could not be read')
    })
    await expect(handlers.get(QUALITY_GET_SUMMARY_CHANNEL)!(trustedEvent)).resolves.toEqual({
      ok: false,
      error: 'QUALITY_FAILED'
    })

    state.currentProject = null
    await expect(handlers.get(QUALITY_GET_SUMMARY_CHANNEL)!(trustedEvent)).resolves.toEqual({
      ok: false,
      error: 'NO_PROJECT_OPEN'
    })
  })
})
