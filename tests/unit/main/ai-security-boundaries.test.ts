import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  createAIConfigService,
  normalizeAIBaseUrl,
  validateAIConfigUpdate
} from '@main/services/ai-config.service'
import {
  AISessionRepository,
  parseAISessionVirtualPath
} from '@main/services/ai-session.repository'
import { runWithProjectAIQueue } from '@main/services/ai-questionnaire.orchestrator'
import {
  AI_PRIVACY_NOTICE_VERSION,
  parseAISendRequest,
  type AiVersionStamp
} from '@shared/ai-assistant-contract'
import type { ProjectData } from '@shared/types/project'
import {
  AI_CANCEL_CHANNEL,
  AI_SEND_CHANNEL,
  AI_SESSION_PAGE_MAX_UTF8_BYTES,
  AI_SESSION_CREATE_CHANNEL,
  AI_SESSION_GET_CHANNEL,
  AI_SESSION_LIST_CHANNEL
} from '@shared/ai-assistant-contract'
import { registerAIIpcHandlers } from '@main/ipc/ai.ipc'
import { createProjectIpcState } from '@main/ipc/project.ipc'
import type { IpcInvokeEventLike, IpcMainLike } from '@main/ipc/types'
import type { AIConfigService } from '@main/services/ai-config.service'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'
const versionStamp: AiVersionStamp = {
  promptId: 'questionnaire-assistant',
  promptVersion: '1.0.0',
  promptHash: 'sha256:abc123',
  harnessVersion: '1.0.0',
  schemaVersion: 1
}

function createProjectData(): ProjectData {
  return {
    meta: {
      projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'security-test',
      folderPath: 'virtual-project',
      createdAt: '2026-08-25T00:00:00.000Z',
      lastModifiedAt: '2026-08-25T00:00:00.000Z'
    },
    questionnaireRevision: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    questionnaire: {
      name: 'security-test',
      questions: [],
      conditionRules: [],
      keyQuestionIds: []
    }
  }
}

describe('AI configuration security boundary', () => {
  it.each([
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    ['http://localhost:11434/v1/', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:8000/', 'http://127.0.0.1:8000'],
    ['http://[::1]:11434/', 'http://[::1]:11434']
  ])('accepts and normalizes %s', (input, expected) => {
    expect(normalizeAIBaseUrl(input)).toBe(expected)
  })

  it.each([
    'http://api.openai.com/v1',
    'ftp://localhost/model',
    'https://user:password@example.com/v1',
    'https://example.com/v1#secret',
    'https://example.com/%2e%2e/admin'
  ])('rejects unsafe Base URL %s', (input) => {
    expect(() => normalizeAIBaseUrl(input)).toThrow('INVALID_AI_BASE_URL')
  })

  it('never includes a submitted API key in validation errors', () => {
    const apiKey = 'sk-must-never-leak'

    let message = ''
    try {
      validateAIConfigUpdate({ baseUrl: 'http://example.com', model: 'gpt-4.1-mini', apiKey })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toBe('INVALID_AI_BASE_URL')
    expect(message).not.toContain(apiKey)
  })

  it('clears a saved API key when the normalized provider URL changes and the key is omitted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'easyepi-ai-config-origin-'))
    try {
      const service = createAIConfigService(directory, {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString()
      })
      await service.update({
        baseUrl: 'https://first.example/v1/',
        model: 'model-a',
        apiKey: 'first-secret'
      })

      const result = await service.update({
        baseUrl: 'https://second.example/v1/',
        model: 'model-a'
      })

      expect(result).toMatchObject({
        ok: true,
        config: {
          baseUrl: 'https://second.example/v1',
          hasApiKey: false,
          maskedApiKey: null
        }
      })
      await expect(service.getPlaintextForMain()).resolves.toEqual({
        baseUrl: 'https://second.example/v1',
        model: 'model-a'
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([null, ''])(
    'clears a saved API key when the same normalized URL receives explicit %s',
    async (apiKey) => {
      const directory = mkdtempSync(join(tmpdir(), 'easyepi-ai-config-clear-key-'))
      try {
        const service = createAIConfigService(directory, {
          isEncryptionAvailable: () => true,
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString()
        })
        await service.update({
          baseUrl: 'https://first.example/v1',
          model: 'model-a',
          apiKey: 'first-secret'
        })

        const result = await service.update({
          baseUrl: 'https://first.example/v1/',
          model: 'model-a',
          apiKey
        })

        expect(result).toMatchObject({
          ok: true,
          config: { hasApiKey: false, maskedApiKey: null }
        })
        await expect(service.getPlaintextForMain()).resolves.toEqual({
          baseUrl: 'https://first.example/v1',
          model: 'model-a'
        })
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )

  it('retains a saved key for the same normalized URL when the key is omitted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'easyepi-ai-config-retain-key-'))
    try {
      const service = createAIConfigService(directory, {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString()
      })
      await service.update({
        baseUrl: 'https://first.example/v1',
        model: 'model-a',
        apiKey: 'first-secret'
      })

      await service.update({
        baseUrl: 'https://first.example/v1/',
        model: 'model-b',
      })
      await expect(service.getPlaintextForMain()).resolves.toEqual({
        baseUrl: 'https://first.example/v1',
        model: 'model-b',
        apiKey: 'first-secret'
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('preserves application privacy consent when provider config is cleared', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'easyepi-ai-config-'))
    try {
      const service = createAIConfigService(directory, {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString()
      })
      await service.acceptPrivacy()
      await service.update({ baseUrl: 'https://api.openai.com/v1', model: 'test', apiKey: 'secret' })
      await service.clear()

      await expect(service.getPrivacyStatus()).resolves.toMatchObject({ accepted: true })
      expect(JSON.parse(readFileSync(join(directory, 'ai-provider-config.json'), 'utf8')))
        .toMatchObject({ privacyNoticeVersion: AI_PRIVACY_NOTICE_VERSION })
      await expect(service.get()).resolves.toMatchObject({
        ok: true,
        config: { model: '', hasApiKey: false, maskedApiKey: null }
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires fresh privacy consent when the stored notice version is missing or stale', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'easyepi-ai-config-version-'))
    const configPath = join(directory, 'ai-provider-config.json')
    try {
      const service = createAIConfigService(directory, {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString()
      })
      const oldAcceptedAt = '2026-08-25T00:00:00.000Z'
      writeFileSync(configPath, JSON.stringify({
        schemaVersion: 1,
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        privacyAcceptedAt: oldAcceptedAt
      }))
      await expect(service.getPrivacyStatus()).resolves.toEqual({
        accepted: false,
        acceptedAt: null
      })

      writeFileSync(configPath, JSON.stringify({
        schemaVersion: 1,
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        privacyAcceptedAt: oldAcceptedAt,
        privacyNoticeVersion: 999
      }))
      await expect(service.getPrivacyStatus()).resolves.toEqual({
        accepted: false,
        acceptedAt: null
      })

      const accepted = await service.acceptPrivacy()
      expect(accepted.acceptedAt).not.toBe(oldAcceptedAt)
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({
        privacyAcceptedAt: accepted.acceptedAt,
        privacyNoticeVersion: AI_PRIVACY_NOTICE_VERSION
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('AI IPC privacy boundary', () => {
  it('rejects renderer attempts to smuggle sensitive fields into send', () => {
    expect(() => parseAISendRequest({
      requestId: 'request-1',
      sessionId,
      content: 'Draft a questionnaire',
      includeCurrentQuestionnaire: false,
      apiKey: 'sk-must-not-cross-ipc'
    })).toThrow('INVALID_AI_REQUEST')
  })

  it('rejects send in main before reading config when privacy is unconfirmed', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const getPlaintextForMain = vi.fn()
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain,
      getPrivacyStatus: async () => ({ accepted: false, acceptedAt: null }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: '2026-08-25T00:00:00.000Z' } as const)
    } satisfies AIConfigService
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\privacy.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    const registration = registerAIIpcHandlers(
      ipcMain,
      state,
      { configService, saveProject: vi.fn() },
      'file:///app/index.html'
    )
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 1, send: () => undefined }
    }
    const created = await handlers.get(AI_SESSION_CREATE_CHANNEL)!(event, { title: 'Public' })
    expect(created).toMatchObject({
      ok: true,
      session: { title: 'Public' }
    })
    expect((created as { session: object }).session).not.toHaveProperty('cache')
    expect((created as { session: object }).session).not.toHaveProperty('temp')
    expect((created as { session: object }).session).not.toHaveProperty('state')
    const createdSessionId = (created as { session: { sessionId: string } }).session.sessionId
    const repository = new AISessionRepository(state.currentProject)
    repository.appendMessage(createdSessionId, {
      id: 'message-1', role: 'user', content: 'Create', createdAt: '2026-08-25T00:00:00.000Z'
    })
    repository.upsertAttachment(createdSessionId, {
      attachmentId: 'attachment-1', messageId: 'message-1', kind: 'questionnaire',
      createdAt: '2026-08-25T00:00:00.000Z',
      value: { name: 'private', questions: [], conditionRules: [], keyQuestionIds: [] }
    })
    repository.appendMessage(createdSessionId, {
      id: 'message-2', role: 'assistant', content: 'Done', createdAt: '2026-08-25T00:00:01.000Z'
    })
    const listed = await handlers.get(AI_SESSION_LIST_CHANNEL)!(event)
    expect(listed).toMatchObject({
      ok: true,
      sessions: [{ sessionId: createdSessionId, title: 'Public' }]
    })
    expect((listed as { sessions: object[] }).sessions[0]).not.toHaveProperty('messages')
    await expect(handlers.get(AI_SESSION_GET_CHANNEL)!(event, {
      sessionId: createdSessionId,
      offset: 0,
      limit: 1
    })).resolves.toMatchObject({
      ok: true,
      session: {
        messages: [{ id: 'message-1', content: 'Create' }],
        attachments: [{ attachmentId: 'attachment-1', messageId: 'message-1' }],
        artifacts: [], total: 2, nextOffset: 1
      }
    })
    const page = await handlers.get(AI_SESSION_GET_CHANNEL)!(event, {
      sessionId: createdSessionId, offset: 0, limit: 1
    })
    expect(JSON.stringify(page)).not.toContain('private')
    for (let index = 0; index < 11; index += 1) {
      repository.appendMessage(createdSessionId, {
        id: `large-${index}`, role: 'assistant', content: 'x'.repeat(100_000),
        createdAt: '2026-08-25T00:00:02.000Z'
      })
    }
    const boundedPage = await handlers.get(AI_SESSION_GET_CHANNEL)!(event, {
      sessionId: createdSessionId, offset: 0, limit: 100
    })
    expect(Buffer.byteLength(JSON.stringify(boundedPage), 'utf8'))
      .toBeLessThanOrEqual(AI_SESSION_PAGE_MAX_UTF8_BYTES)
    expect(boundedPage).toMatchObject({ ok: true, session: { total: 13 } })
    expect((boundedPage as { session: { nextOffset: number | null } }).session.nextOffset)
      .not.toBeNull()

    const result = await handlers.get(AI_SEND_CHANNEL)!(event, {
      requestId: 'request-1',
      sessionId,
      content: 'Create a short questionnaire',
      includeCurrentQuestionnaire: false
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'AI_PRIVACY_NOTICE_REQUIRED',
      message: '请先确认 AI 隐私说明。'
    })
    expect(getPlaintextForMain).not.toHaveBeenCalled()
    registration.dispose()
  })

  it('serializes cache clearing, rejects running Sessions, and persists only actual removals', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: '', model: '' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: '2026-08-25T00:00:00.000Z' }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: '2026-08-25T00:00:00.000Z' } as const)
    } satisfies AIConfigService
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\cache.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    const repository = new AISessionRepository(state.currentProject)
    const first = repository.create(versionStamp, 'First').value
    const second = repository.create(versionStamp, 'Second').value
    repository.writeVirtual(`session://${first.manifest.sessionId}/cache/values/one`, true, first.manifest.sessionId)
    repository.writeVirtual(`session://${first.manifest.sessionId}/cache/values/two`, true, first.manifest.sessionId)
    repository.writeVirtual(`session://${second.manifest.sessionId}/cache/values/other`, true, second.manifest.sessionId)
    repository.appendMessage(first.manifest.sessionId, {
      id: 'message-1', role: 'user', content: 'Keep me', createdAt: '2026-08-25T00:00:00.000Z'
    })
    const beforeState = structuredClone(repository.get(first.manifest.sessionId)!.state)
    const beforeArtifacts = structuredClone(repository.get(first.manifest.sessionId)!.artifacts)
    const saveProject = vi.fn()
    const registration = registerAIIpcHandlers(
      ipcMain,
      state,
      { configService, saveProject },
      'file:///app/index.html'
    )
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 1, send: () => undefined }
    }
    const handler = handlers.get('ai:session:clearCache')
    expect(handler).toBeTypeOf('function')

    await expect(handler!(event, {
      sessionId: first.manifest.sessionId,
      extra: 'rejected'
    })).resolves.toMatchObject({ ok: false, errorCode: 'INVALID_AI_REQUEST' })

    let releaseQueue!: () => void
    let queueEntered = false
    const queueBlocker = new Promise<void>((resolve) => { releaseQueue = resolve })
    const queuedOperation = runWithProjectAIQueue(state.currentProject, async () => {
      queueEntered = true
      await queueBlocker
    })
    await vi.waitFor(() => expect(queueEntered).toBe(true))
    let clearSettled = false
    const clearResult = handler!(event, { sessionId: first.manifest.sessionId })
      .then((result) => {
        clearSettled = true
        return result
      })
    await Promise.resolve()
    expect(clearSettled).toBe(false)
    expect(repository.get(first.manifest.sessionId)!.cache.values).toEqual({ one: true, two: true })
    releaseQueue()
    await queuedOperation
    await expect(clearResult).resolves.toEqual({ ok: true, removed: 2 })
    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(repository.get(first.manifest.sessionId)!.cache.values).toEqual({})
    expect(repository.get(first.manifest.sessionId)!.conversation.messages)
      .toMatchObject([{ content: 'Keep me' }])
    expect(repository.get(first.manifest.sessionId)!.state).toEqual(beforeState)
    expect(repository.get(first.manifest.sessionId)!.artifacts).toEqual(beforeArtifacts)
    expect(repository.get(second.manifest.sessionId)!.cache.values).toEqual({ other: true })

    repository.writeVirtual(`session://${first.manifest.sessionId}/cache/values/three`, true, first.manifest.sessionId)
    repository.updateState(first.manifest.sessionId, { status: 'running' })
    await expect(handler!(event, { sessionId: first.manifest.sessionId }))
      .resolves.toMatchObject({ ok: false, errorCode: 'AI_SESSION_RUNNING' })
    expect(repository.get(first.manifest.sessionId)!.cache.values).toEqual({ three: true })
    expect(saveProject).toHaveBeenCalledTimes(1)

    repository.updateState(first.manifest.sessionId, { status: 'idle' })
    await expect(handler!(event, { sessionId: first.manifest.sessionId }))
      .resolves.toEqual({ ok: true, removed: 1 })
    expect(saveProject).toHaveBeenCalledTimes(2)
    await expect(handler!(event, { sessionId: first.manifest.sessionId }))
      .resolves.toEqual({ ok: true, removed: 0 })
    expect(saveProject).toHaveBeenCalledTimes(2)
    registration.dispose()
  })

  it('isolates request ids by caller and waits for cancellation settlement', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    let resolveConfig!: (value: { baseUrl: string; model: string }) => void
    const configPending = new Promise<{ baseUrl: string; model: string }>((resolve) => {
      resolveConfig = resolve
    })
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: vi.fn(() => configPending),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: '2026-08-25T00:00:00.000Z' }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: '2026-08-25T00:00:00.000Z' } as const)
    } satisfies AIConfigService
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\study.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    const registration = registerAIIpcHandlers(
      ipcMain,
      state,
      { configService },
      'file:///app/index.html'
    )
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 7, send: () => undefined }
    }
    const otherEvent = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 8, send: () => undefined }
    }
    const request = {
      requestId: 'reserved-request', sessionId, content: 'Create',
      includeCurrentQuestionnaire: false
    }

    const first = handlers.get(AI_SEND_CHANNEL)!(event, request)
    await expect(handlers.get(AI_SEND_CHANNEL)!(event, request)).resolves.toMatchObject({
      ok: false, errorCode: 'AI_REQUEST_IN_PROGRESS'
    })
    const otherCaller = handlers.get(AI_SEND_CHANNEL)!(otherEvent, request)
    await vi.waitFor(() => expect(configService.getPlaintextForMain).toHaveBeenCalledTimes(2))
    await expect(handlers.get(AI_CANCEL_CHANNEL)!(event, {
      requestId: request.requestId
    })).resolves.toEqual({ ok: true, cancelled: true })
    await expect(handlers.get(AI_CANCEL_CHANNEL)!(otherEvent, {
      requestId: request.requestId
    })).resolves.toEqual({ ok: true, cancelled: true })
    let settled = false
    const settling = registration.cancelAllAndSettle().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    resolveConfig({ baseUrl: 'https://example.test/v1', model: 'model' })
    await settling
    await expect(first).resolves.toMatchObject({ ok: false, errorCode: 'AI_CANCELLED' })
    await expect(otherCaller).resolves.toMatchObject({ ok: false, errorCode: 'AI_CANCELLED' })
    registration.dispose()
  })
})

describe('AI Session virtual path security boundary', () => {
  it('parses a scoped virtual path without exposing an operating-system path', () => {
    expect(
      parseAISessionVirtualPath(
        `session://${sessionId}/artifacts/operations/op-1/result`,
        sessionId
      )
    ).toEqual({
      sessionId,
      partition: 'artifacts',
      segments: ['operations', 'op-1', 'result']
    })
  })

  it.each([
    `session://${sessionId}/conversation/C:/Windows/win.ini`,
    `session://${sessionId}/state/a\\b`,
    `session://${sessionId}/cache/a//b`,
    `session://${sessionId}/artifacts/.`,
    `session://${sessionId}/artifacts/..`,
    `session://${sessionId}/artifacts/%2e%2e/secrets`,
    `session://${sessionId}/temp/%2Fetc/passwd`,
    `session://${sessionId}/unknown/value`,
    'file:///C:/Windows/win.ini'
  ])('rejects traversal or non-virtual path %s', (input) => {
    expect(() => parseAISessionVirtualPath(input, sessionId)).toThrow(
      'INVALID_AI_SESSION_PATH'
    )
  })

  it('rejects access across Sessions', () => {
    expect(() =>
      parseAISessionVirtualPath(
        `session://${sessionId}/state/current`,
        '16fd2706-8baf-433b-82eb-8c7fada847da'
      )
    ).toThrow('AI_SESSION_SCOPE_MISMATCH')
  })

  it('rejects a virtual path when the current Session scope is omitted', () => {
    expect(() =>
      parseAISessionVirtualPath(
        `session://${sessionId}/state/current`,
        undefined as unknown as string
      )
    ).toThrow()
  })
})

describe('AI Session version and artifact idempotency', () => {
  it('fixes a complete version stamp on a newly created Session', () => {
    const repository = new AISessionRepository(
      createProjectData(),
      () => sessionId,
      () => '2026-08-25T01:00:00.000Z'
    )

    const session = repository.create(versionStamp, 'Review').value

    expect(session.manifest.versionStamp).toEqual(versionStamp)
  })

  it('deduplicates structurally equivalent operations and rejects conflicting payloads', () => {
    const repository = new AISessionRepository(
      createProjectData(),
      () => sessionId,
      () => '2026-08-25T01:00:00.000Z'
    )
    repository.create(versionStamp, 'Review')
    const first = repository.upsertArtifact(sessionId, {
      artifactId: 'artifact-1',
      operationId: 'operation-1',
      kind: 'questionnaire-patch',
      status: 'completed',
      versionStamp,
      value: { section: { title: 'A', order: 1 }, enabled: true }
    })

    const replay = repository.upsertArtifact(sessionId, {
      artifactId: 'artifact-2',
      operationId: 'operation-1',
      kind: 'questionnaire-patch',
      status: 'completed',
      versionStamp: {
        schemaVersion: 1,
        harnessVersion: '1.0.0',
        promptHash: 'sha256:abc123',
        promptVersion: '1.0.0',
        promptId: 'questionnaire-assistant'
      },
      value: { enabled: true, section: { order: 1, title: 'A' } }
    })

    expect(first.mutated).toBe(true)
    expect(replay).toEqual({ value: first.value, mutated: false })
    expect(Object.keys(repository.get(sessionId)!.artifacts.byId)).toEqual(['artifact-1'])
    expect(() =>
      repository.upsertArtifact(sessionId, {
        artifactId: 'artifact-3',
        operationId: 'operation-1',
        kind: 'questionnaire-patch',
        status: 'completed',
        versionStamp,
        value: { enabled: false }
      })
    ).toThrow('AI_ARTIFACT_OPERATION_CONFLICT')
    expect(() =>
      repository.upsertArtifact(sessionId, {
        artifactId: 7,
        operationId: 'operation-numeric-id',
        kind: 'questionnaire-patch',
        status: 'completed',
        versionStamp
      })
    ).toThrow('INVALID_AI_ARTIFACT')
    expect(() =>
      repository.upsertArtifact(sessionId, {
        artifactId: 'artifact-invalid-status',
        operationId: 'operation-invalid-status',
        kind: 'questionnaire-patch',
        status: 'done',
        versionStamp
      })
    ).toThrow('INVALID_AI_ARTIFACT')
  })

  it('requires typed APIs for reserved state, run temp, and artifact structures', () => {
    const repository = new AISessionRepository(
      createProjectData(),
      () => sessionId,
      () => '2026-08-25T01:00:00.000Z'
    )
    repository.create(versionStamp, 'Review')
    repository.upsertRun(sessionId, {
      runId: 'run-1',
      status: 'running',
      startedAt: '2026-08-25T01:00:00.000Z',
      versionStamp
    })
    repository.setRunTemp(sessionId, {
      runId: 'run-1',
      createdAt: '2026-08-25T01:00:00.000Z',
      versionStamp,
      values: { partial: true }
    })
    repository.updateState(sessionId, { status: 'running', activeRunId: 'run-1' })
    repository.appendMessage(sessionId, {
      id: 'message-1',
      role: 'assistant',
      content: 'Draft ready',
      createdAt: '2026-08-25T01:00:00.000Z',
      runId: 'run-1'
    })
    repository.upsertAttachment(sessionId, {
      attachmentId: 'attachment-1',
      messageId: 'message-1',
      kind: 'questionnaire-patch',
      createdAt: '2026-08-25T01:00:00.000Z',
      value: { ready: true }
    })

    expect(repository.get(sessionId)?.state).toMatchObject({
      status: 'running',
      activeRunId: 'run-1'
    })
    expect(repository.get(sessionId)?.conversation).toMatchObject({
      messages: [{ id: 'message-1' }],
      attachments: { 'attachment-1': { messageId: 'message-1' } }
    })
    for (const path of [
      `session://${sessionId}/conversation/messages`,
      `session://${sessionId}/state/runs/run-2`,
      `session://${sessionId}/temp/runs/run-2`,
      `session://${sessionId}/artifacts/byId/artifact-2`,
      `session://${sessionId}/cache/values`,
      `session://${sessionId}/cache/other/key`
    ]) {
      expect(() => repository.writeVirtual(path, {}, sessionId)).toThrow(
        'AI_SESSION_RESERVED_PATH'
      )
      expect(() => repository.deleteVirtual(path, sessionId)).toThrow(
        'AI_SESSION_RESERVED_PATH'
      )
    }
    const cachePath = `session://${sessionId}/cache/values/model-response`
    expect(repository.writeVirtual(cachePath, { cached: true }, sessionId).mutated).toBe(true)
    expect(repository.deleteVirtual(cachePath, sessionId)).toEqual({ value: true, mutated: true })
    expect(repository.get(sessionId)?.cache).toEqual({ values: {} })
  })
})
