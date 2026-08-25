import { mkdtempSync, rmSync } from 'node:fs'
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
import { parseAISendRequest, type AiVersionStamp } from '@shared/ai-assistant-contract'
import type { ProjectData } from '@shared/types/project'
import { AI_SEND_CHANNEL } from '@shared/ai-assistant-contract'
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
      name: 'security-test',
      folderPath: 'virtual-project',
      createdAt: '2026-08-25T00:00:00.000Z',
      lastModifiedAt: '2026-08-25T00:00:00.000Z'
    },
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
      await expect(service.get()).resolves.toMatchObject({
        ok: true,
        config: { model: '', hasApiKey: false, maskedApiKey: null }
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
    const registration = registerAIIpcHandlers(
      ipcMain,
      createProjectIpcState(),
      { configService },
      'file:///app/index.html'
    )

    const result = await handlers.get(AI_SEND_CHANNEL)!({
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 1, send: () => undefined }
    }, {
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
