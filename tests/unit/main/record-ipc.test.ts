import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RECORD_GET_PROGRESS_CHANNEL,
  RECORD_SAVE_PROGRESS_CHANNEL,
  RECORD_SUBMIT_CHANNEL
} from '@shared/record-contract'
import { createProjectIpcState } from '../../../src/main/ipc/project.ipc'
import {
  createRecordIpcState,
  registerRecordIpc
} from '../../../src/main/ipc/record.ipc'

const packagedRendererUrl = 'file:///D:/EasyEpi/out/renderer/index.html'
const trustedEvent = { senderFrame: { url: packagedRendererUrl } }
const TEST_DIR = join(tmpdir(), `easyepi-record-ipc-${Date.now()}`)
const TEST_KEY = randomBytes(32)

type Handler = (
  event: { senderFrame?: { url: string } | null },
  request?: unknown
) => Promise<unknown>

function setup() {
  const projectState = createProjectIpcState()
  projectState.currentProject = {
    meta: {
      name: 'M4 Test',
      folderPath: TEST_DIR,
      createdAt: new Date(0).toISOString(),
      lastModifiedAt: new Date(0).toISOString()
    },
    questionnaire: {
      name: 'M4 Test',
      questions: [
        {
          id: 'q1',
          content: '受试者编号',
          variableName: 'participant_id',
          type: 'fixed_length',
          options: [],
          constraint: { type: 'alphanumeric', fixedLength: 3 },
          isKey: true,
          allowSkip: false,
          order: 0
        }
      ],
      conditionRules: [],
      keyQuestionIds: ['q1']
    }
  }
  projectState.auth.encryptionKey = TEST_KEY

  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  }
  registerRecordIpc(
    ipcMain,
    projectState,
    createRecordIpcState(),
    packagedRendererUrl
  )
  return { handlers }
}

describe('record IPC', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  it('rejects a duplicate Key when submitted answers are keyed by question id', async () => {
    const { handlers } = setup()
    const submit = handlers.get(RECORD_SUBMIT_CHANNEL)!

    await expect(submit(trustedEvent, { answers: { q1: 'A01' } })).resolves.toMatchObject({
      ok: true
    })
    await expect(submit(trustedEvent, { answers: { q1: 'A01' } })).resolves.toEqual({
      ok: false,
      error: 'KEY_DUPLICATE',
      recordId: expect.any(String)
    })
  })

  it('rejects invalid required answers before writing a record', async () => {
    const { handlers } = setup()
    const submit = handlers.get(RECORD_SUBMIT_CHANNEL)!

    await expect(submit(trustedEvent, { answers: { q1: 'too-long' } })).resolves.toEqual({
      ok: false,
      error: 'ANSWER_INVALID'
    })
  })

  it('restores progress from disk after the IPC state is recreated', async () => {
    const first = setup().handlers
    await first.get(RECORD_SAVE_PROGRESS_CHANNEL)!(trustedEvent, {
      currentIndex: 1,
      batchStartTime: 123456,
      currentAnswers: { q1: 'A01' }
    })

    const restarted = setup().handlers
    await expect(restarted.get(RECORD_GET_PROGRESS_CHANNEL)!(trustedEvent)).resolves.toMatchObject({
      ok: true,
      currentIndex: 1,
      batchCount: 0,
      batchStartTime: 123456,
      currentAnswers: { q1: 'A01' }
    })
  })
})
