import { describe, expect, it } from 'vitest'

import {
  AI_MASKED_API_KEY,
  AI_PROVIDER_IDS,
  isAIResearchStatus,
  parseAIConfigResponse,
  parseAIConfigUpdateRequest,
  parseAIProgressEvent,
  parseAIPublicRunSnapshot,
  parseAISendResponse,
  type AIProgressStage
} from '@shared/ai-assistant-contract'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'
const at = '2026-08-28T00:00:00.000Z'

const publicMessage = {
  id: 'message-1',
  role: 'assistant' as const,
  content: '请选择筛查年龄范围。',
  createdAt: at,
  clarification: {
    clarificationId: 'clarification-1',
    options: [{ id: 'age_45_74', label: '45–74 岁' }],
    status: 'unresolved' as const,
    selectedOptionId: null,
    resolvedByMessageId: null
  }
}

describe('AI provider configuration contract', () => {
  it('accepts the single-provider update shape with and without an API key', () => {
    expect(parseAIConfigUpdateRequest({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash'
    })).toEqual({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash'
    })
    expect(parseAIConfigUpdateRequest({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      apiKey: 'secret'
    })).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      apiKey: 'secret'
    })
    expect(parseAIConfigUpdateRequest({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: null
    })).toEqual({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: null
    })
  })

  it.each([
    ['a removed provider picker', { providerId: 'deepseek' }],
    ['a removed web-search toggle', { webSearchEnabled: true }],
    ['both removed legacy fields', { providerId: 'openai', webSearchEnabled: false }],
    ['an unknown extra field', { extra: true }]
  ])('rejects %s with INVALID_AI_REQUEST', (_name, legacy) => {
    expect(() => parseAIConfigUpdateRequest({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      ...legacy
    })).toThrow('INVALID_AI_REQUEST')
  })

  it.each([
    ['a non-object', null],
    ['a missing base URL', { model: 'deepseek-v4-flash' }],
    ['a missing model', { baseUrl: 'https://api.deepseek.com' }],
    ['an empty base URL', { baseUrl: '', model: 'deepseek-v4-flash' }],
    ['a padded base URL', { baseUrl: ' https://api.deepseek.com', model: 'deepseek-v4-flash' }],
    ['a padded model', { baseUrl: 'https://api.deepseek.com', model: ' deepseek-v4-flash ' }],
    ['a non-string API key', { baseUrl: 'https://api.deepseek.com', model: 'm', apiKey: 1 }],
    ['a NUL in the API key', { baseUrl: 'https://api.deepseek.com', model: 'm', apiKey: 'a\0b' }]
  ])('rejects %s', (_name, value) => {
    expect(() => parseAIConfigUpdateRequest(value)).toThrow('INVALID_AI_REQUEST')
  })

  it('validates the exact four-key renderer configuration view', () => {
    expect(AI_PROVIDER_IDS).toEqual(['deepseek'])
    const response = {
      ok: true,
      config: {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        hasApiKey: true,
        maskedApiKey: AI_MASKED_API_KEY
      }
    }
    expect(parseAIConfigResponse(response)).toEqual(response)
    expect(parseAIConfigResponse({
      ok: true,
      config: {
        baseUrl: 'https://api.deepseek.com',
        model: '',
        hasApiKey: false,
        maskedApiKey: null
      }
    })).toMatchObject({ ok: true, config: { hasApiKey: false, maskedApiKey: null } })
  })

  it.each([
    ['a leftover provider id', { providerId: 'deepseek' }],
    ['a leftover web-search toggle', { webSearchEnabled: true }],
    ['an unmasked stored key', { maskedApiKey: 'secret' }],
    ['a mask without a stored key', { hasApiKey: false, maskedApiKey: AI_MASKED_API_KEY }],
    ['a stored key without a mask', { hasApiKey: true, maskedApiKey: null }]
  ])('rejects a configuration view carrying %s', (_name, override) => {
    expect(() => parseAIConfigResponse({
      ok: true,
      config: {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        hasApiKey: true,
        maskedApiKey: AI_MASKED_API_KEY,
        ...override
      }
    })).toThrow('INVALID_AI_RESPONSE')
  })
})

describe('AI research status contract', () => {
  it('accepts exactly the four research statuses', () => {
    for (const status of ['literature_and_web', 'literature_only', 'web_only', 'none']) {
      expect(isAIResearchStatus(status)).toBe(true)
    }
    for (const status of ['searched', 'failed', '', 1, null, undefined]) {
      expect(isAIResearchStatus(status)).toBe(false)
    }
  })

  it('carries an optional research mode and citations on a successful send result', () => {
    const result = {
      ok: true as const,
      requestId: 'request-1',
      outcome: 'clarification' as const,
      message: publicMessage,
      attempts: 1,
      researchStatus: 'literature_only' as const,
      researchMode: 'medical' as const,
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'Study' }]
    }
    expect(parseAISendResponse(result)).toEqual(result)
    expect(parseAISendResponse({ ...result, researchMode: 'non_medical' }))
      .toMatchObject({ researchMode: 'non_medical' })
    expect(() => parseAISendResponse({ ...result, researchMode: 'unsupported' }))
      .toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAISendResponse({ ...result, researchStatus: 'searched' }))
      .toThrow('INVALID_AI_RESPONSE')
  })
})

describe('AI progress stage contract', () => {
  const researchStages = ['planning', 'literature', 'web_search', 'extracting'] as const

  it.each<[AIProgressStage]>(researchStages.map((stage) => [stage]))(
    'accepts the research stage %s on a public run snapshot',
    (stage) => {
      const snapshot = {
        requestId: 'request-1', runId: 'run-1', stage, attempt: 1 as const,
        startedAt: at, updatedAt: at, streamFallback: false, toolCallingFallback: false
      }
      expect(parseAIPublicRunSnapshot(snapshot)).toEqual(snapshot)
    }
  )

  it('rejects an unknown stage on a public run snapshot', () => {
    expect(() => parseAIPublicRunSnapshot({
      requestId: 'request-1', runId: 'run-1', stage: 'thinking', attempt: 1,
      startedAt: at, updatedAt: at, streamFallback: false, toolCallingFallback: false
    })).toThrow('INVALID_AI_RESPONSE')
  })

  // `parseAIProgressEvent` accepts each research stage on `stage_changed`. This is what keeps the
  // live progress UI in `ai.ipc.ts` `deliverProgress` from silently dropping stage transitions.
  it('round-trips a stage_changed progress event for every research stage', () => {
    for (const stage of researchStages) {
      const event = {
        type: 'stage_changed' as const,
        requestId: 'request-1',
        sessionId,
        runId: 'run-1',
        at,
        attempt: 1 as const,
        stage
      }
      expect(parseAIProgressEvent(event)).toEqual(event)
    }
  })

  it('rejects a stage_changed progress event carrying an unknown stage', () => {
    expect(() => parseAIProgressEvent({
      type: 'stage_changed',
      requestId: 'request-1',
      sessionId,
      runId: 'run-1',
      at,
      attempt: 1,
      stage: 'thinking'
    })).toThrow('INVALID_AI_RESPONSE')
    expect(() => parseAIProgressEvent({
      type: 'stage_changed',
      requestId: 'request-1',
      sessionId,
      runId: 'run-1',
      at,
      attempt: 1
    })).toThrow('INVALID_AI_RESPONSE')
  })

  it('rejects the removed function_call capability fallback', () => {
    const base = { requestId: 'request-1', sessionId, runId: 'run-1', at }
    for (const capability of ['streaming', 'response_format']) {
      expect(parseAIProgressEvent({
        ...base, type: 'capability_fallback', attempt: 1, capability, reason: 'unsupported'
      })).toMatchObject({ capability })
    }
    expect(() => parseAIProgressEvent({
      ...base, type: 'capability_fallback', attempt: 1, capability: 'function_call',
      reason: 'unsupported'
    })).toThrow('INVALID_AI_RESPONSE')
  })
})
