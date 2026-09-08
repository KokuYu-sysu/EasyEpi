import { describe, expect, it } from 'vitest'

import {
  AI_MASKED_API_KEY,
  parseAIConfigResponse,
  parseAIConfigUpdateRequest
} from '@shared/ai-assistant-contract'

describe('AI provider configuration contract', () => {
  it('accepts a known provider and the explicit built-in search preference', () => {
    expect(parseAIConfigUpdateRequest({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      webSearchEnabled: true,
      apiKey: 'secret'
    })).toEqual({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      webSearchEnabled: true,
      apiKey: 'secret'
    })
  })

  it.each([
    ['unknown provider', 'unknown', true],
    ['non-boolean search preference', 'openai', 'yes']
  ])('rejects %s', (_name, providerId, webSearchEnabled) => {
    expect(() => parseAIConfigUpdateRequest({
      providerId,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
      webSearchEnabled
    })).toThrow('INVALID_AI_REQUEST')
  })

  it('validates provider identity and search preference in renderer responses', () => {
    const response = {
      ok: true,
      config: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5',
        webSearchEnabled: false,
        hasApiKey: true,
        maskedApiKey: AI_MASKED_API_KEY
      }
    }
    expect(parseAIConfigResponse(response)).toEqual(response)
  })
})
