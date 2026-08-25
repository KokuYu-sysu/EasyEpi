import { describe, expect, it } from 'vitest'

import { normalizeAIBaseUrl, validateAIConfigUpdate } from '@main/services/ai-config.service'
import { parseAISessionVirtualPath } from '@main/services/ai-session.repository'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'

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
})
