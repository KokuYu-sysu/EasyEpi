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
import { getAiVersionStamp } from '@main/services/ai-questionnaire.harness'
import {
  AI_PRIVACY_NOTICE_VERSION,
  AI_PRIVACY_NOTICE,
  parseAIArtifactApplyRequest,
  parseAIArtifactRequest,
  parseAICancelRequest,
  parseAIConfigResponse,
  parseAIConfigUpdateRequest,
  parseAIConnectionTestResponse,
  parseAIProgressEvent,
  parseAIPublicClarification,
  parseAIPublicFailureDetails,
  parseAIPublicRunSnapshot,
  parseAIPrivacyStatusResponse,
  parseAIResponse,
  parseAISessionClearCacheResponse,
  parseAISessionCreateRequest,
  parseAISessionDeleteResponse,
  parseAISessionGetRequest,
  parseAISessionIdRequest,
  parseAISessionUpdateRequest,
  parseAISendResponse,
  parseAISendRequest,
  type AiVersionStamp
} from '@shared/ai-assistant-contract'
import {
  PUBLIC_VALIDATION_CODES,
  sanitizeAIValidationField,
  toAIPublicAttemptFailure,
  toAIPublicFailureDetails
} from '@main/services/ai-public-validation'
import type { ProjectData } from '@shared/types/project'
import {
  AI_CANCEL_CHANNEL,
  AI_CONFIG_TEST_CONNECTION_CHANNEL,
  AI_PROGRESS_CHANNEL,
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
import type { AIChatCompletionRequest } from '@main/services/openai-compatible.client'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'
const versionStamp: AiVersionStamp = getAiVersionStamp()
const legacyVersionStamp: AiVersionStamp = {
  promptId: versionStamp.promptId,
  promptVersion: '1.1.0',
  promptHash: 'sha256:d407a445883fa9a015c8772201af387fdbca41df3f33545a58017ba79d47c832',
  harnessVersion: '1.1.0',
  schemaVersion: 1
}

const at = '2026-08-28T00:00:00.000Z'

const clarification = {
  clarificationId: 'clarification-1',
  options: [{ id: 'age_45_74', label: '45–74 岁' }],
  status: 'unresolved' as const,
  selectedOptionId: null,
  resolvedByMessageId: null
}

const publicMessage = {
  id: 'message-1',
  role: 'assistant' as const,
  content: '请选择筛查年龄范围。',
  createdAt: at,
  clarification
}

function createArtifactPreviewDto() {
  const questionnaire = {
    name: '安全测试', questions: [], conditionRules: [], keyQuestionIds: []
  }
  return {
    artifactId: 'artifact-1', operationId: 'operation-1', kind: 'questionnaire-draft' as const,
    status: 'completed' as const, createdAt: at, updatedAt: at,
    value: {
      draft: questionnaire,
      diff: {
        metadata: { name: null, description: null },
        questions: { added: [], removed: [], modified: [] },
        rules: { added: [], removed: [], modified: [] }
      },
      assistantMessage: '问卷已生成。', rollingSummary: '',
      validation: { success: true as const, errors: [] },
      baseQuestionnaireRevision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      baseQuestionnaireHash: `sha256:${'a'.repeat(64)}`,
      baseQuestionnaire: questionnaire
    }
  }
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

function validQuestionnaireCompletion(): string {
  return JSON.stringify({
    kind: 'questionnaire',
    assistantMessage: '问卷已生成。',
    rollingSummary: '一题问卷。',
    options: [],
    questionnaire: {
      name: '安全测试',
      questions: [{
        id: 'q1', content: '年龄', variableName: 'age', type: 'numeric_range', options: [],
        constraint: { type: 'integer', minValue: 0, maxValue: 120 }, isKey: false,
        allowSkip: false, order: 0
      }],
      conditionRules: [],
      keyQuestionIds: []
    }
  })
}

function validClarificationCompletion(): string {
  return JSON.stringify({
    kind: 'clarification',
    assistantMessage: '请选择筛查年龄范围？',
    rollingSummary: '等待年龄范围。',
    options: [{ id: 'age-range', label: '45–74 岁' }],
    questionnaire: null
  })
}

function invalidQuestionnaireCompletion(): string {
  return JSON.stringify({
    kind: 'questionnaire',
    assistantMessage: 'raw secret assistant text',
    rollingSummary: 'invalid draft',
    options: [],
    questionnaire: { name: '', questions: [], conditionRules: [], keyQuestionIds: [] }
  })
}

describe('AI IPC request parser boundaries', () => {
  const parseInvalidRequestCases: Array<[string, (value: unknown) => unknown, unknown]> = [
    ['config rejects non-objects', parseAIConfigUpdateRequest, null],
    ['config rejects missing fields', parseAIConfigUpdateRequest, { baseUrl: 'https://example.com/v1' }],
    ['config rejects extra fields', parseAIConfigUpdateRequest, {
      baseUrl: 'https://example.com/v1', model: 'model', extra: true
    }],
    ['config rejects empty base URLs', parseAIConfigUpdateRequest, { baseUrl: '', model: 'model' }],
    ['config rejects padded model names', parseAIConfigUpdateRequest, {
      baseUrl: 'https://example.com/v1', model: ' model '
    }],
    ['config rejects non-string API keys', parseAIConfigUpdateRequest, {
      baseUrl: 'https://example.com/v1', model: 'model', apiKey: 1
    }],
    ['config rejects NUL in API keys', parseAIConfigUpdateRequest, {
      baseUrl: 'https://example.com/v1', model: 'model', apiKey: 'secret\0suffix'
    }],
    ['create rejects an empty title', parseAISessionCreateRequest, { title: '' }],
    ['session id rejects malformed UUIDs', parseAISessionIdRequest, { sessionId: 'not-a-session' }],
    ['session get rejects negative offsets', parseAISessionGetRequest, { sessionId, offset: -1 }],
    ['session get rejects fractional offsets', parseAISessionGetRequest, { sessionId, offset: 0.5 }],
    ['session get rejects zero limits', parseAISessionGetRequest, { sessionId, limit: 0 }],
    ['session get rejects oversized limits', parseAISessionGetRequest, { sessionId, limit: 101 }],
    ['session update rejects non-string titles', parseAISessionUpdateRequest, { sessionId, title: 1 }],
    ['send rejects non-boolean questionnaire flags', parseAISendRequest, {
      requestId: 'request-1', sessionId, content: 'hello', includeCurrentQuestionnaire: 1
    }],
    ['send rejects non-string content', parseAISendRequest, {
      requestId: 'request-1', sessionId, content: null, includeCurrentQuestionnaire: false
    }],
    ['send rejects NUL content', parseAISendRequest, {
      requestId: 'request-1', sessionId, content: 'hello\0world', includeCurrentQuestionnaire: false
    }],
    ['send rejects blank free text', parseAISendRequest, {
      requestId: 'request-1', sessionId, content: '   ', includeCurrentQuestionnaire: false
    }],
    ['quick reply rejects simultaneous free text', parseAISendRequest, {
      requestId: 'request-1', sessionId, content: 'also text', includeCurrentQuestionnaire: false,
      clarificationSelection: { clarificationId: 'clarification-1', optionId: 'option-1' }
    }],
    ['quick reply rejects malformed selection objects', parseAISendRequest, {
      requestId: 'request-1', sessionId, content: '', includeCurrentQuestionnaire: false,
      clarificationSelection: []
    }],
    ['quick reply rejects unsafe option ids', parseAISendRequest, {
      requestId: 'request-1', sessionId, content: '', includeCurrentQuestionnaire: false,
      clarificationSelection: { clarificationId: 'clarification-1', optionId: '../option' }
    }],
    ['cancel rejects unsafe request ids', parseAICancelRequest, { requestId: '../request' }],
    ['artifact request rejects unsafe artifact ids', parseAIArtifactRequest, {
      sessionId, artifactId: 'artifact/1'
    }],
    ['artifact apply rejects unsafe operation ids', parseAIArtifactApplyRequest, {
      sessionId, artifactId: 'artifact-1', operationId: 'operation/1'
    }]
  ]

  it.each(parseInvalidRequestCases)('%s', (_name, parser, value) => {
    expect(() => parser(value)).toThrow('INVALID_AI_REQUEST')
  })

  it('preserves optional request fields only when supplied', () => {
    expect(parseAIConfigUpdateRequest({
      baseUrl: 'https://example.com/v1', model: 'model'
    })).toEqual({ baseUrl: 'https://example.com/v1', model: 'model' })
    expect(parseAIConfigUpdateRequest({
      baseUrl: 'https://example.com/v1', model: 'model', apiKey: null
    })).toEqual({ baseUrl: 'https://example.com/v1', model: 'model', apiKey: null })
    expect(parseAISessionCreateRequest({})).toEqual({})
    expect(parseAISessionCreateRequest({ title: 'Study' })).toEqual({ title: 'Study' })
    expect(parseAISessionGetRequest({ sessionId })).toEqual({ sessionId, offset: 0, limit: 50 })
    expect(parseAIArtifactApplyRequest({ sessionId, artifactId: 'artifact-1' }))
      .toEqual({ sessionId, artifactId: 'artifact-1' })
    expect(parseAIArtifactApplyRequest({
      sessionId, artifactId: 'artifact-1', operationId: 'operation-1'
    })).toEqual({ sessionId, artifactId: 'artifact-1', operationId: 'operation-1' })
  })
})

describe('AI IPC response parser boundaries', () => {
  it('accepts both success and public-error response branches', () => {
    expect(parseAIConnectionTestResponse({ ok: true })).toEqual({ ok: true })
    expect(parseAIConnectionTestResponse({
      ok: false, errorCode: 'AI_PROVIDER_ERROR', message: 'Provider unavailable'
    })).toEqual({ ok: false, errorCode: 'AI_PROVIDER_ERROR', message: 'Provider unavailable' })
    expect(parseAIResponse<{ ok: true; value: string }>({ ok: true, value: 'safe' }, ['value']))
      .toEqual({ ok: true, value: 'safe' })
  })

  it('validates provider configuration masking and privacy timestamps', () => {
    expect(parseAIConfigResponse({
      ok: true,
      config: {
        baseUrl: 'https://example.com/v1', model: 'model', hasApiKey: true,
        maskedApiKey: '••••••••'
      }
    })).toMatchObject({ ok: true, config: { hasApiKey: true } })
    expect(parseAIConfigResponse({
      ok: true,
      config: {
        baseUrl: 'https://example.com/v1', model: '', hasApiKey: false, maskedApiKey: null
      }
    })).toMatchObject({ ok: true, config: { hasApiKey: false } })
    expect(parseAIPrivacyStatusResponse({
      ok: true, accepted: true, acceptedAt: at, notice: AI_PRIVACY_NOTICE
    })).toMatchObject({ accepted: true })
    expect(parseAIPrivacyStatusResponse({
      ok: true, accepted: false, acceptedAt: null, notice: AI_PRIVACY_NOTICE
    })).toMatchObject({ accepted: false })
  })

  const invalidResponses: Array<[string, () => unknown]> = [
    ['non-object response', () => parseAIConnectionTestResponse(null)],
    ['unknown result discriminator', () => parseAIConnectionTestResponse({ ok: 'yes' })],
    ['invalid public error code', () => parseAIConnectionTestResponse({
      ok: false, errorCode: 'bad-code', message: 'failure'
    })],
    ['empty public error message', () => parseAIConnectionTestResponse({
      ok: false, errorCode: 'AI_ERROR', message: ''
    })],
    ['unexpected success field', () => parseAIConnectionTestResponse({ ok: true, extra: true })],
    ['unmasked stored key', () => parseAIConfigResponse({
      ok: true,
      config: { baseUrl: 'https://example.com', model: 'm', hasApiKey: true, maskedApiKey: 'secret' }
    })],
    ['mask without a stored key', () => parseAIConfigResponse({
      ok: true,
      config: { baseUrl: 'https://example.com', model: 'm', hasApiKey: false, maskedApiKey: '••••••••' }
    })],
    ['non-boolean key state', () => parseAIConfigResponse({
      ok: true,
      config: { baseUrl: 'https://example.com', model: 'm', hasApiKey: 1, maskedApiKey: null }
    })],
    ['stale privacy notice', () => parseAIPrivacyStatusResponse({
      ok: true, accepted: false, acceptedAt: null, notice: 'stale'
    })],
    ['invalid accepted timestamp', () => parseAIPrivacyStatusResponse({
      ok: true, accepted: true, acceptedAt: 'not-a-date', notice: AI_PRIVACY_NOTICE
    })],
    ['timestamp while unaccepted', () => parseAIPrivacyStatusResponse({
      ok: true, accepted: false, acceptedAt: at, notice: AI_PRIVACY_NOTICE
    })],
    ['non-finite tree number', () => parseAIResponse({ ok: true, value: Number.NaN }, ['value'])],
    ['oversized tree collection', () => parseAIResponse({
      ok: true, value: Array.from({ length: 10_001 }, () => null)
    }, ['value'])],
    ['sensitive tree key', () => parseAIResponse({ ok: true, password: 'secret' }, ['password'])]
  ]

  it.each(invalidResponses)('rejects %s', (_name, parse) => {
    expect(parse).toThrow('INVALID_AI_RESPONSE')
  })

  it('rejects cyclic and excessively deep response trees before DTO parsing', () => {
    const cyclic: Record<string, unknown> = { ok: true }
    cyclic.self = cyclic
    expect(() => parseAIResponse(cyclic, ['self'])).toThrow('INVALID_AI_RESPONSE')

    let deep: Record<string, unknown> = { leaf: true }
    for (let index = 0; index < 25; index += 1) deep = { child: deep }
    expect(() => parseAIResponse({ ok: true, value: deep }, ['value']))
      .toThrow('INVALID_AI_RESPONSE')
  })

  it('validates boolean and non-negative integer response DTOs', () => {
    expect(parseAISessionDeleteResponse({ ok: true, deleted: false })).toEqual({ ok: true, deleted: false })
    expect(parseAISessionClearCacheResponse({ ok: true, removed: 0 })).toEqual({ ok: true, removed: 0 })
    expect(() => parseAISessionDeleteResponse({ ok: true, deleted: 0 })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISessionClearCacheResponse({ ok: true, removed: -1 })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISessionClearCacheResponse({ ok: true, removed: 0.5 })).toThrow('INVALID_AI_RESPONSE')
  })
})

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

describe('AI streaming and clarification public contract', () => {
  it('parses an exact public clarification and rejects unsafe option data or extra keys', () => {
    expect(parseAIPublicClarification(clarification)).toEqual(clarification)
    expect(() => parseAIPublicClarification({ ...clarification, internalPrompt: 'secret' }))
      .toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicClarification({
      ...clarification,
      options: [{ id: '../unsafe', label: 'Unsafe' }]
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicClarification({
      ...clarification,
      options: [{ id: 'safe', label: ' untrimmed ' }]
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicClarification({
      ...clarification,
      status: 'resolved',
      selectedOptionId: 'missing',
      resolvedByMessageId: 'message-2'
    })).toThrow('INVALID_AI_RESPONSE')
  })

  it('keeps single-line labels free of controls without rejecting Unicode text', () => {
    const boundaryText = 'before after~\u00a0中文 👍'
    expect(parseAIPublicClarification({
      ...clarification,
      options: [{ id: 'safe', label: boundaryText }]
    })).toMatchObject({ options: [{ label: boundaryText }] })

    for (const control of [
      '\0', '\u0009', '\u000a', '\u000d', '\u001b', '\u001f', '\u007f', '\u009f'
    ]) {
      expect(() => parseAIPublicClarification({
        ...clarification,
        options: [{ id: 'safe', label: `before${control}after` }]
      })).toThrow('INVALID_AI_RESPONSE')
    }
  })

  it('allows formatting whitespace in readable messages but rejects other controls', () => {
    const formattingWhitespace = '\t\n\r'
    const content = `before after~\u00a0中文 👍${formattingWhitespace}end`
    expect(parseAISendResponse({
      ok: true,
      requestId: 'request-2',
      outcome: 'clarification',
      message: { ...publicMessage, content },
      attempts: 2
    })).toMatchObject({ message: { content } })

    for (const control of [
      '\0', '\u0008', '\u000b', '\u000c', '\u000e', '\u001b', '\u001f', '\u007f', '\u009f'
    ]) {
      expect(() => parseAISendResponse({
        ok: true,
        requestId: 'request-2',
        outcome: 'clarification',
        message: { ...publicMessage, content: `before${control}after` },
        attempts: 2
      })).toThrow('INVALID_AI_RESPONSE')
    }
  })

  it('parses exact bounded failure details and rejects unsafe fields and unknown keys', () => {
    const details = {
      attempts: [{
        attempt: 1,
        issues: [{
          code: 'INVALID_TYPE',
          field: '$.questionnaire.questions[0].content',
          summary: PUBLIC_VALIDATION_CODES.INVALID_TYPE
        }],
        truncated: false
      }]
    }
    const firstAttempt = details.attempts[0]!
    const firstIssue = firstAttempt.issues[0]!
    expect(parseAIPublicFailureDetails(details)).toEqual(details)
    expect(() => parseAIPublicFailureDetails({
      attempts: [{
        ...firstAttempt,
        issues: [{ ...firstIssue, field: 'C:\\Users\\secret.txt' }]
      }]
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicFailureDetails({
      attempts: [{ ...firstAttempt, rawMessage: 'internal' }]
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicFailureDetails({
      attempts: [{
        ...firstAttempt,
        issues: [{ ...firstIssue, code: 'UNKNOWN_INTERNAL_CODE' }]
      }]
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicFailureDetails({
      attempts: [{
        ...firstAttempt,
        issues: [{ ...firstIssue, summary: 'raw Harness message' }]
      }]
    })).toThrow('INVALID_AI_RESPONSE')
  })

  it('parses an exact public run snapshot and rejects unsafe stage, IDs, and extras', () => {
    const snapshot = {
      requestId: 'request-1', runId: 'run-1', stage: 'streaming', attempt: 2,
      startedAt: at, updatedAt: at, streamFallback: false
    }
    expect(parseAIPublicRunSnapshot(snapshot)).toEqual(snapshot)
    expect(() => parseAIPublicRunSnapshot({ ...snapshot, stage: 'thinking' }))
      .toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicRunSnapshot({ ...snapshot, runId: 'run/unsafe' }))
      .toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIPublicRunSnapshot({ ...snapshot, providerRequestId: 'private' }))
      .toThrow('INVALID_AI_RESPONSE')
  })

  it.each([
    { type: 'started' },
    { type: 'attempt_started', attempt: 1 },
    { type: 'model_streaming', attempt: 1 },
    { type: 'assistant_delta', attempt: 1, sequence: 0, delta: '正在生成' },
    { type: 'validating', attempt: 1 },
    {
      type: 'validation_failed', attempt: 1,
      failure: { attempt: 1, issues: [], truncated: false }
    },
    { type: 'repairing', attempt: 1, nextAttempt: 2 },
    {
      type: 'capability_fallback', attempt: 1,
      capability: 'streaming', reason: 'unsupported'
    },
    {
      type: 'clarification', attempt: 1, outcome: 'clarification',
      messageId: 'message-1', clarification
    },
    {
      type: 'completed', attempt: 1, outcome: 'questionnaire', artifactId: 'artifact-1'
    },
    { type: 'failed', attempt: 3, errorCode: 'AI_VALIDATION_FAILED' },
    { type: 'cancelled', attempt: 1, errorCode: 'AI_CANCELLED' }
  ])('parses the exact $type progress event', (specific) => {
    const event = {
      requestId: 'request-1', sessionId, runId: 'run-1', at, ...specific
    }
    expect(parseAIProgressEvent(event)).toEqual(event)
  })

  it('rejects progress events with unknown keys, unsafe values, or mismatched attempts', () => {
    const base = { requestId: 'request-1', sessionId, runId: 'run-1', at }
    expect(() => parseAIProgressEvent({ ...base, type: 'started', raw: '{}' }))
      .toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIProgressEvent({
      ...base, type: 'assistant_delta', attempt: 1, sequence: -1, delta: 'x'
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIProgressEvent({
      ...base, type: 'assistant_delta', attempt: 1, sequence: 0, delta: 'x'.repeat(4_097)
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIProgressEvent({
      ...base, type: 'repairing', attempt: 2, nextAttempt: 2
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIProgressEvent({
      ...base, type: 'cancelled', attempt: 1, errorCode: 'AI_PROVIDER_ERROR'
    })).toThrow('INVALID_AI_RESPONSE')
  })

  it('requires exact empty content for quick replies and non-empty free text otherwise', () => {
    const base = { requestId: 'request-1', sessionId, includeCurrentQuestionnaire: false }
    expect(parseAISendRequest({
      ...base,
      content: '',
      clarificationSelection: { clarificationId: 'clarification-1', optionId: 'age_45_74' }
    })).toEqual({
      ...base,
      content: '',
      clarificationSelection: { clarificationId: 'clarification-1', optionId: 'age_45_74' }
    })
    expect(() => parseAISendRequest({
      ...base,
      content: 'renderer supplied label',
      clarificationSelection: { clarificationId: 'clarification-1', optionId: 'age_45_74' }
    })).toThrow('INVALID_AI_REQUEST')
    expect(() => parseAISendRequest({ ...base, content: '' })).toThrow('INVALID_AI_REQUEST')
    expect(() => parseAISendRequest({
      ...base,
      content: '',
      clarificationSelection: {
        clarificationId: 'clarification-1', optionId: 'age_45_74', label: 'smuggled'
      }
    })).toThrow('INVALID_AI_REQUEST')
  })

  it('parses questionnaire, clarification, and detailed failure send outcomes exactly', () => {
    const questionnaireResult = {
      ok: true as const, requestId: 'request-1', outcome: 'questionnaire' as const,
      artifact: createArtifactPreviewDto(), attempts: 1
    }
    const clarificationResult = {
      ok: true as const, requestId: 'request-2', outcome: 'clarification' as const,
      message: publicMessage, attempts: 2
    }
    const failureResult = {
      ok: false as const, errorCode: 'AI_VALIDATION_FAILED', message: '问卷校验失败。',
      details: { attempts: [{ attempt: 3, issues: [], truncated: false }] }
    }
    expect(parseAISendResponse(questionnaireResult)).toEqual(questionnaireResult)
    expect(parseAISendResponse(clarificationResult)).toEqual(clarificationResult)
    expect(parseAISendResponse(failureResult)).toEqual(failureResult)
    expect(() => parseAISendResponse({
      ...clarificationResult,
      message: { ...publicMessage, role: 'user' }
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISendResponse({
      ...clarificationResult,
      message: { ...publicMessage, clarification: null }
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISendResponse({
      ...clarificationResult,
      message: {
        ...publicMessage,
        clarification: {
          ...clarification,
          status: 'resolved', selectedOptionId: 'age_45_74', resolvedByMessageId: 'message-2'
        }
      }
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISendResponse({ ...clarificationResult, artifact: createArtifactPreviewDto() }))
      .toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISendResponse({ ...clarificationResult, attempts: 0 }))
      .toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISendResponse({
      ...clarificationResult,
      message: { ...publicMessage, content: 'unsafe\u001bmessage' }
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISendResponse({ ...failureResult, internalMessage: 'raw' }))
      .toThrow('INVALID_AI_RESPONSE')
  })

  it('sanitizes, deduplicates, and bounds internal Harness errors without exposing messages', () => {
    const legalField = '$.questionnaire.questions[0]'
    expect(sanitizeAIValidationField(legalField)).toBe(legalField)
    for (const control of [
      '\0', '\u0009', '\u000a', '\u000d', '\u001b', '\u001f', '\u007f', '\u009f'
    ]) {
      // Removing the control would produce legalField, but the original untrusted path is rejected.
      expect(sanitizeAIValidationField(`$.questionnaire${control}.questions[0]`)).toBe('$')
    }
    expect(sanitizeAIValidationField(`$.${'a'.repeat(300)}`)).toBe('$')
    const errors = [
      { code: ' \u0000INVALID_TYPE\u001f ', path: legalField, message: 'trimmed code' },
      {
        code: 'INVALID\u007f_\u009fTYPE', path: '$.questionnaire.name', message: 'C1 controls'
      },
      { code: `INVALID_TYPE${'X'.repeat(128)}`, path: legalField, message: 'bounded code' },
      { code: 'INVALID_TYPE', path: '$.questionnaire.questions[0].content', message: 'raw secret' },
      { code: 'INVALID_TYPE', path: '$.questionnaire.questions[0].content', message: 'different raw' },
      { code: 'UNKNOWN\u0000CODE', path: 'file:///C:/secret', message: 'provider body' },
      ...Array.from({ length: 25 }, (_, index) => ({
        code: 'EMPTY_QUESTION', path: `$.questionnaire.questions[${index}].content`, message: `raw-${index}`
      }))
    ]
    const failure = toAIPublicAttemptFailure(1, errors)
    expect(failure.attempt).toBe(1)
    expect(failure.issues).toHaveLength(20)
    expect(failure.truncated).toBe(true)
    expect(failure.issues[0]).toEqual({
      code: 'INVALID_TYPE',
      field: legalField,
      summary: PUBLIC_VALIDATION_CODES.INVALID_TYPE
    })
    expect(failure.issues[1]).toEqual({
      code: 'INVALID_TYPE',
      field: '$.questionnaire.name',
      summary: PUBLIC_VALIDATION_CODES.INVALID_TYPE
    })
    expect(failure.issues[2]).toEqual({
      code: 'AI_VALIDATION_ERROR',
      field: legalField,
      summary: PUBLIC_VALIDATION_CODES.AI_VALIDATION_ERROR
    })
    expect(failure.issues[3]).toEqual({
      code: 'INVALID_TYPE',
      field: '$.questionnaire.questions[0].content',
      summary: PUBLIC_VALIDATION_CODES.INVALID_TYPE
    })
    expect(failure.issues[4]).toEqual({
      code: 'AI_VALIDATION_ERROR', field: '$',
      summary: PUBLIC_VALIDATION_CODES.AI_VALIDATION_ERROR
    })
    expect(failure.issues[4]?.summary).toContain('校验')
    expect(JSON.stringify(failure)).not.toContain('raw secret')
    expect(JSON.stringify(failure)).not.toContain('provider body')

    const details = toAIPublicFailureDetails([
      { attempt: 3, errors: [] },
      { attempt: 1, errors },
      { attempt: 2, errors: [] },
      { attempt: 2, errors }
    ])
    expect(details.attempts.map((entry) => entry.attempt)).toEqual([1, 2, 3])
    expect(details.attempts).toHaveLength(3)
  })
})

describe('AI IPC privacy boundary', () => {
  it('tests connectivity with one generic non-streaming completion', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const complete = vi.fn().mockResolvedValue({
      content: 'OK', streamingSupported: false, responseFormatSupported: false
    })
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: 'https://example.test/v1', model: 'model', apiKey: 'secret' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: at }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: at } as const)
    } satisfies AIConfigService
    const registration = registerAIIpcHandlers({
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }, createProjectIpcState(), { configService, client: { complete } }, 'file:///app/index.html')
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 1, send: vi.fn() }
    }

    await expect(handlers.get(AI_CONFIG_TEST_CONNECTION_CHANNEL)!(event)).resolves.toEqual({ ok: true })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      streamingSupported: false,
      responseFormatSupported: false
    }))
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('schemaVersion')
    registration.dispose()
  })

  it('projects only page-scoped clarifications and failures with the current active run under budget', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\page.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    const repository = new AISessionRepository(state.currentProject, () => sessionId)
    repository.create(versionStamp, 'Projection')
    const stored = state.currentProject.aiAssistant!.sessions[sessionId]!
    stored.conversation.messages.push(
      { id: 'user-failed', role: 'user', content: '失败请求', createdAt: at, runId: 'run-failed' },
      { id: 'assistant-clarify', role: 'assistant', content: '请选择范围。', createdAt: at, runId: 'run-clarify' },
      { id: 'user-active', role: 'user', content: '继续生成', createdAt: at, runId: 'run-active' }
    )
    stored.conversation.clarifications = {
      'clarification-1': {
        clarificationId: 'clarification-1', messageId: 'assistant-clarify', runId: 'run-clarify',
        options: [{ id: 'age-range', label: '45–74 岁' }], status: 'unresolved', createdAt: at
      }
    }
    stored.state.status = 'running'
    stored.state.activeRunId = 'run-active'
    stored.state.runs = {
      'run-failed': {
        runId: 'run-failed', status: 'failed', startedAt: at, completedAt: at,
        versionStamp, requestId: 'failed-request', operationId: 'failed-operation',
        userMessageId: 'user-failed', errorCode: 'AI_HARNESS_VALIDATION_FAILED',
        progress: { stage: 'failed', attempt: 3, updatedAt: at, streamFallback: false },
        failure: {
          errorCode: 'AI_HARNESS_VALIDATION_FAILED', completedAt: at,
          details: { attempts: [{
            attempt: 3,
            issues: [{ code: 'EMPTY_NAME', field: '$.name', summary: '问卷名称不能为空。' }],
            truncated: false
          }] }
        }
      },
      'run-active': {
        runId: 'run-active', status: 'running', startedAt: at, versionStamp,
        requestId: 'active-request', operationId: 'active-operation', userMessageId: 'user-active',
        progress: { stage: 'streaming', attempt: 2, updatedAt: at, streamFallback: true }
      }
    }
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: '', model: '' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: at }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: at } as const)
    } satisfies AIConfigService
    const registration = registerAIIpcHandlers(
      ipcMain, state, { configService, saveProject: vi.fn() }, 'file:///app/index.html'
    )
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 7, send: () => undefined }
    }

    const firstPage = await handlers.get(AI_SESSION_GET_CHANNEL)!(event, {
      sessionId, offset: 0, limit: 2
    }) as { ok: true; session: Record<string, unknown> }
    expect(firstPage.session).toMatchObject({
      messages: [
        { id: 'user-failed', clarification: null },
        { id: 'assistant-clarify', clarification: { clarificationId: 'clarification-1' } }
      ],
      activeRun: {
        requestId: 'active-request', runId: 'run-active', stage: 'streaming', attempt: 2,
        startedAt: at, updatedAt: at, streamFallback: true
      },
      failures: [{
        runId: 'run-failed', userMessageId: 'user-failed',
        errorCode: 'AI_HARNESS_VALIDATION_FAILED'
      }]
    })
    expect(Buffer.byteLength(JSON.stringify(firstPage), 'utf8'))
      .toBeLessThanOrEqual(AI_SESSION_PAGE_MAX_UTF8_BYTES)
    const originalManifest = structuredClone(stored.manifest)
    const returnedManifest = firstPage.session.manifest as {
      title: string
      versionStamp: { promptHash: string }
    }
    returnedManifest.title = 'renderer mutation'
    returnedManifest.versionStamp.promptHash = `sha256:${'f'.repeat(64)}`
    expect(stored.manifest).toEqual(originalManifest)

    const activeOnly = await handlers.get(AI_SESSION_GET_CHANNEL)!(event, {
      sessionId, offset: 2, limit: 1
    }) as { ok: true; session: { messages: unknown[]; failures: unknown[] } }
    expect(activeOnly.session.messages).toEqual([
      expect.objectContaining({ id: 'user-active', clarification: null })
    ])
    expect(activeOnly.session.failures).toEqual([])
    expect(JSON.stringify(activeOnly)).not.toContain('clarification-1')

    stored.manifest.versionStamp = legacyVersionStamp
    delete stored.conversation.clarifications
    stored.state.status = 'idle'
    delete stored.state.activeRunId
    const legacyPage = await handlers.get(AI_SESSION_GET_CHANNEL)!(event, {
      sessionId, offset: 1, limit: 1
    }) as { ok: true; session: { messages: unknown[]; activeRun: unknown; failures: unknown[] } }
    expect(legacyPage.session).toMatchObject({
      messages: [{ id: 'assistant-clarify', clarification: null }],
      activeRun: null,
      failures: []
    })
    await expect(handlers.get(AI_SEND_CHANNEL)!(event, {
      requestId: 'legacy-request', sessionId, content: 'Create',
      includeCurrentQuestionnaire: false
    })).resolves.toMatchObject({ ok: false, errorCode: 'AI_VERSION_MIGRATION_REQUIRED' })
    registration.dispose()
  })

  it('routes ordered progress only to the initiating live owner and sends terminal before resolution', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\stream.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    new AISessionRepository(state.currentProject, () => sessionId).create(versionStamp, 'Stream')
    const order: string[] = []
    const sent: unknown[] = []
    let destroySecondOwner = false
    let secondOwnerDestroyed = false
    let failRun = false
    let providerCalls = 0
    const burstChunks = Array.from(
      { length: 24 },
      (_, index) => `${index.toString().padStart(2, '0')}:` + '进'.repeat(300)
    )
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: {
        id: 7,
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          expect(channel).toBe(AI_PROGRESS_CHANNEL)
          sent.push(payload)
          order.push((payload as { type: string }).type)
        }
      }
    }
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: 'https://example.test/v1', model: 'model' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: at }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: at } as const)
    } satisfies AIConfigService
    const registration = registerAIIpcHandlers(ipcMain, state, {
      configService,
      saveProject: vi.fn(),
      client: {
        complete: vi.fn(async (request) => {
          providerCalls += 1
          if (destroySecondOwner) secondOwnerDestroyed = true
          request.onModelStreaming?.()
          if (providerCalls === 1) {
            for (const [index, content] of burstChunks.entries()) {
              request.onContentDelta?.({ content, sequence: index + 1 })
            }
          } else {
            request.onContentDelta?.({ content: '问卷', sequence: 1 })
            request.onContentDelta?.({ content: '已生成', sequence: 2 })
          }
          if (providerCalls === 1) {
            await Promise.resolve()
            expect(sent.some((value) => (value as { type: string }).type === 'assistant_delta'))
              .toBe(false)
          }
          return {
            content: failRun
              ? invalidQuestionnaireCompletion()
              : destroySecondOwner
                ? validClarificationCompletion()
                : validQuestionnaireCompletion(),
            streamingSupported: true,
            responseFormatSupported: true
          }
        })
      }
    }, 'file:///app/index.html')

    const result = await handlers.get(AI_SEND_CHANNEL)!(event, {
      requestId: 'request-1', sessionId, content: 'Create', includeCurrentQuestionnaire: false
    }).then((value) => {
      order.push('resolved')
      return value
    })

    expect(result).toMatchObject({
      ok: true, requestId: 'request-1', outcome: 'questionnaire', attempts: 1
    })
    expect(sent.slice(0, 3).map((value) => (value as { type: string }).type))
      .toEqual(['started', 'attempt_started', 'model_streaming'])
    expect(sent.at(-2)).toMatchObject({ type: 'validating' })
    expect(sent.at(-1)).toMatchObject({ type: 'completed' })
    expect(sent.filter((value) => ['completed', 'clarification', 'failed', 'cancelled']
      .includes((value as { type: string }).type))).toHaveLength(1)
    const deliveredDeltas = sent.filter(
      (value) => (value as { type: string }).type === 'assistant_delta'
    ) as Array<{ sequence: number; delta: string }>
    expect(deliveredDeltas.length).toBeLessThan(burstChunks.length)
    expect(deliveredDeltas.map(({ delta }) => delta).join('')).toBe(burstChunks.join(''))
    expect(deliveredDeltas.every(({ delta }) => delta.length <= 4_096)).toBe(true)
    expect(deliveredDeltas.every(
      ({ sequence }, index) => index === 0 || sequence > deliveredDeltas[index - 1]!.sequence
    )).toBe(true)
    expect(order.at(-2)).toBe('completed')
    expect(order.at(-1)).toBe('resolved')

    const firstOwnerEventCount = sent.length
    const secondOwnerSent: unknown[] = []
    const secondOwnerEvent = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: {
        id: 8,
        isDestroyed: () => secondOwnerDestroyed,
        send: (_channel: string, payload: unknown) => secondOwnerSent.push(payload)
      }
    }
    destroySecondOwner = true
    const secondResult = await handlers.get(AI_SEND_CHANNEL)!(secondOwnerEvent, {
      requestId: 'request-2', sessionId, content: 'Create again', includeCurrentQuestionnaire: false
    })
    expect(secondResult).toMatchObject({
      ok: true,
      outcome: 'clarification',
      message: {
        role: 'assistant',
        clarification: { status: 'unresolved', options: [{ id: 'age-range' }] }
      }
    })
    expect(secondOwnerSent.map((value) => (value as { type: string }).type))
      .toEqual(['started', 'attempt_started'])
    expect(sent).toHaveLength(firstOwnerEventCount)

    destroySecondOwner = false
    failRun = true
    const failedEvents: unknown[] = []
    const failedResult = await handlers.get(AI_SEND_CHANNEL)!({
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 9, isDestroyed: () => false, send: (_channel, value) => failedEvents.push(value) }
    }, {
      requestId: 'request-3', sessionId, content: 'Use adults', includeCurrentQuestionnaire: false
    })
    expect(failedResult).toMatchObject({
      ok: false,
      errorCode: 'AI_HARNESS_VALIDATION_FAILED',
      details: { attempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }] }
    })
    expect(failedEvents.at(-1)).toMatchObject({
      type: 'failed', errorCode: 'AI_HARNESS_VALIDATION_FAILED',
      details: { attempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }] }
    })
    expect(JSON.stringify({ failedResult, failedEvents })).not.toContain('raw secret assistant text')
    registration.dispose()
  })

  it('cancels after navigation with the persisted activeRun request id', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\navigation.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    new AISessionRepository(state.currentProject, () => sessionId).create(versionStamp, 'Navigation')
    let releaseProvider!: () => void
    let providerEntered = false
    const providerPending = new Promise<void>((resolve) => { releaseProvider = resolve })
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: 'https://example.test/v1', model: 'model' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: at }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: at } as const)
    } satisfies AIConfigService
    const oldPageEvents: unknown[] = []
    const registration = registerAIIpcHandlers(ipcMain, state, {
      configService,
      saveProject: vi.fn(),
      client: {
        complete: vi.fn(async () => {
          providerEntered = true
          await providerPending
          return {
            content: validQuestionnaireCompletion(),
            streamingSupported: true,
            responseFormatSupported: true
          }
        })
      }
    }, 'file:///app/index.html')
    const oldPageEvent = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 7, send: (_channel: string, value: unknown) => oldPageEvents.push(value) }
    }
    const send = handlers.get(AI_SEND_CHANNEL)!(oldPageEvent, {
      requestId: 'navigation-request', sessionId, content: 'Create',
      includeCurrentQuestionnaire: false
    })
    await vi.waitFor(() => expect(providerEntered).toBe(true))

    const reopenedPageEvent = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 7, send: () => undefined }
    }
    const page = await handlers.get(AI_SESSION_GET_CHANNEL)!(reopenedPageEvent, {
      sessionId, offset: 0, limit: 100
    }) as { ok: true; session: { activeRun: { requestId: string } | null } }
    expect(page.session.activeRun?.requestId).toBe('navigation-request')
    await expect(handlers.get(AI_CANCEL_CHANNEL)!(reopenedPageEvent, {
      requestId: page.session.activeRun!.requestId
    })).resolves.toEqual({ ok: true, cancelled: true })
    releaseProvider()

    await expect(send).resolves.toMatchObject({ ok: false, errorCode: 'AI_CANCELLED' })
    expect(oldPageEvents.at(-1)).toMatchObject({
      type: 'cancelled', requestId: 'navigation-request', errorCode: 'AI_CANCELLED'
    })
    registration.dispose()
  })

  it('delivers the persisted cancelled terminal while cancelAllAndSettle closes intake', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\settle.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    new AISessionRepository(state.currentProject, () => sessionId).create(versionStamp, 'Settle')
    let releaseProvider!: () => void
    let providerRequest: AIChatCompletionRequest | undefined
    const providerPending = new Promise<void>((resolve) => { releaseProvider = resolve })
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: 'https://example.test/v1', model: 'model' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: at }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: at } as const)
    } satisfies AIConfigService
    const sent: unknown[] = []
    const registration = registerAIIpcHandlers(ipcMain, state, {
      configService,
      saveProject: vi.fn(),
      client: {
        complete: vi.fn(async (request) => {
          providerRequest = request
          await providerPending
          return {
            content: validQuestionnaireCompletion(),
            streamingSupported: true,
            responseFormatSupported: true
          }
        })
      }
    }, 'file:///app/index.html')
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 7, isDestroyed: () => false, send: (_channel: string, value: unknown) => sent.push(value) }
    }
    const send = handlers.get(AI_SEND_CHANNEL)!(event, {
      requestId: 'settle-request', sessionId, content: 'Create', includeCurrentQuestionnaire: false
    })
    await vi.waitFor(() => expect(providerRequest).toBeDefined())

    const settling = registration.cancelAllAndSettle()
    releaseProvider()
    await settling
    await expect(send).resolves.toMatchObject({ ok: false, errorCode: 'AI_CANCELLED' })
    expect(sent.at(-1)).toMatchObject({
      type: 'cancelled', requestId: 'settle-request', errorCode: 'AI_CANCELLED'
    })

    const settledEventCount = sent.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toHaveLength(settledEventCount)
    registration.dispose()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toHaveLength(settledEventCount)
  })

  it('aborts an in-flight run when its captured sender is destroyed and removes the listener', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\destroyed.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    new AISessionRepository(state.currentProject, () => sessionId).create(versionStamp, 'Destroyed')
    let releaseProvider!: () => void
    let providerRequest: AIChatCompletionRequest | undefined
    const providerPending = new Promise<void>((resolve) => { releaseProvider = resolve })
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: 'https://example.test/v1', model: 'model' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: at }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: at } as const)
    } satisfies AIConfigService
    const sent: unknown[] = []
    const registration = registerAIIpcHandlers(ipcMain, state, {
      configService,
      saveProject: vi.fn(),
      client: {
        complete: vi.fn(async (request) => {
          providerRequest = request
          await providerPending
          return {
            content: validQuestionnaireCompletion(),
            streamingSupported: true,
            responseFormatSupported: true
          }
        })
      }
    }, 'file:///app/index.html')
    let destructionListener: (() => void) | undefined
    const removeListener = vi.fn((name: string, listener: () => void) => {
      if (name === 'destroyed' && listener === destructionListener) destructionListener = undefined
    })
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: {
        id: 7,
        isDestroyed: () => false,
        send: (_channel: string, value: unknown) => sent.push(value),
        once: (name: string, listener: () => void) => {
          if (name === 'destroyed') destructionListener = listener
        },
        removeListener
      }
    }
    const send = handlers.get(AI_SEND_CHANNEL)!(event, {
      requestId: 'destroy-request', sessionId, content: 'Create', includeCurrentQuestionnaire: false
    })
    await vi.waitFor(() => expect(providerRequest).toBeDefined())
    expect(destructionListener).toBeTypeOf('function')

    const deliveredBeforeDestroy = sent.length
    destructionListener!()
    expect(providerRequest!.signal?.aborted).toBe(true)
    releaseProvider()

    await expect(send).resolves.toMatchObject({ ok: false, errorCode: 'AI_CANCELLED' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toHaveLength(deliveredBeforeDestroy)
    expect(destructionListener).toBeUndefined()
    expect(removeListener).toHaveBeenCalledOnce()
    registration.dispose()
  })

  it('normalizes an internal failed progress code before sending it to the renderer', async () => {
    const handlers = new Map<string, (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>>()
    const ipcMain: IpcMainLike = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => { handlers.delete(channel) }
    }
    const state = createProjectIpcState()
    state.currentProject = createProjectData()
    state.currentFilePath = 'D:\\internal-progress.easyepi'
    state.currentSaltHex = 'a'.repeat(64)
    state.currentHashHex = 'b'.repeat(64)
    state.auth.encryptionKey = Buffer.alloc(32, 1)
    new AISessionRepository(state.currentProject, () => sessionId).create(versionStamp, 'Internal')
    const configService = {
      get: async () => ({ ok: true, config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null } } as const),
      update: async () => ({ ok: false, code: 'INVALID_AI_CONFIG' } as const),
      clear: async () => ({ ok: false, code: 'AI_CONFIG_SAVE_FAILED' } as const),
      getPlaintextForMain: async () => ({ baseUrl: 'https://example.test/v1', model: 'model' }),
      getPrivacyStatus: async () => ({ accepted: true, acceptedAt: at }),
      acceptPrivacy: async () => ({ accepted: true, acceptedAt: at } as const)
    } satisfies AIConfigService
    const sent: unknown[] = []
    const registration = registerAIIpcHandlers(ipcMain, state, {
      configService,
      saveProject: vi.fn(),
      client: {
        complete: vi.fn(async () => {
          throw new Error('AI_RUN_NOT_ACTIVE')
        })
      }
    }, 'file:///app/index.html')
    const event = {
      senderFrame: { url: 'file:///app/index.html' },
      sender: { id: 7, isDestroyed: () => false, send: (_channel: string, value: unknown) => sent.push(value) }
    }

    await expect(handlers.get(AI_SEND_CHANNEL)!(event, {
      requestId: 'internal-request', sessionId, content: 'Create', includeCurrentQuestionnaire: false
    })).resolves.toMatchObject({ ok: false, errorCode: 'AI_INTERNAL_ERROR' })
    expect(sent.at(-1)).toMatchObject({ type: 'failed', errorCode: 'AI_INTERNAL_ERROR' })
    expect(JSON.stringify(sent)).not.toContain('AI_RUN_NOT_ACTIVE')
    registration.dispose()
  })

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
    state.currentProject.aiAssistant!.sessions[first.manifest.sessionId]!.state.status = 'running'
    await expect(handler!(event, { sessionId: first.manifest.sessionId }))
      .resolves.toMatchObject({ ok: false, errorCode: 'AI_SESSION_RUNNING' })
    expect(repository.get(first.manifest.sessionId)!.cache.values).toEqual({ three: true })
    expect(saveProject).toHaveBeenCalledTimes(1)

    state.currentProject.aiAssistant!.sessions[first.manifest.sessionId]!.state.status = 'idle'
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
      versionStamp: structuredClone(versionStamp),
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
    repository.appendMessage(sessionId, {
      id: 'user-message-1',
      role: 'user',
      content: 'Create',
      createdAt: '2026-08-25T01:00:00.000Z',
      runId: 'run-1'
    })
    repository.upsertRun(sessionId, {
      runId: 'run-1',
      status: 'running',
      startedAt: '2026-08-25T01:00:00.000Z',
      versionStamp,
      requestId: 'request-1',
      operationId: 'operation-1',
      userMessageId: 'user-message-1',
      progress: {
        stage: 'starting', attempt: 1, updatedAt: '2026-08-25T01:00:00.000Z',
        streamFallback: false
      }
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
      messages: [{ id: 'user-message-1' }, { id: 'message-1' }],
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
