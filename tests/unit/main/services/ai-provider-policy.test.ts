import { describe, expect, it } from 'vitest'

import {
  getAIProviderRequestPolicy,
  resolveOpenAICompatibleEndpoint
} from '@main/services/ai-provider-policy'

describe('OpenAI-compatible endpoint resolution', () => {
  it.each([
    ['https://api.openai.com/v1', 'chat', 'https://api.openai.com/v1/chat/completions'],
    ['https://api.openai.com/v1/', 'responses', 'https://api.openai.com/v1/responses'],
    ['https://api.openai.com/v1/chat/completions', 'chat', 'https://api.openai.com/v1/chat/completions'],
    ['https://api.openai.com/v1/chat/completions', 'responses', 'https://api.openai.com/v1/responses'],
    ['https://api.openai.com/v1/responses', 'chat', 'https://api.openai.com/v1/chat/completions'],
    ['https://api.openai.com/v1/responses', 'responses', 'https://api.openai.com/v1/responses']
  ] as const)('resolves %s for %s without duplicating paths', (baseUrl, kind, expected) => {
    expect(resolveOpenAICompatibleEndpoint(baseUrl, kind)).toBe(expected)
  })
})

describe('provider request policy', () => {
  it.each([
    ['openai', 'https://api.openai.com/v1', 'json_schema', {}, 'responses'],
    ['deepseek', 'https://api.deepseek.com', 'json_object', { thinking: { type: 'disabled' } }, 'unsupported'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'json_schema', {}, 'unsupported'],
    ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'json_object', {}, 'chat'],
    ['moonshot', 'https://api.moonshot.cn/v1', 'json_object', { thinking: { type: 'disabled' } }, 'chat'],
    ['glm', 'https://open.bigmodel.cn/api/paas/v4', 'json_object', {}, 'chat'],
    ['xai', 'https://api.x.ai/v1', 'json_schema', {}, 'responses'],
    ['mimo', 'https://api.xiaomimimo.com/v1', 'json_object', { thinking: { type: 'disabled' } }, 'chat'],
    ['custom', 'https://gateway.example/v1', 'json_schema', {}, 'unsupported']
  ] as const)(
    'selects safe capabilities for %s',
    (providerId, baseUrl, responseFormat, chatBody, searchTransport) => {
      expect(getAIProviderRequestPolicy(providerId, baseUrl, 'model')).toEqual({
        officialHost: providerId !== 'custom',
        responseFormat,
        chatBody,
        searchTransport
      })
    }
  )

  it('suppresses private fields when a preset points at a non-official host', () => {
    expect(getAIProviderRequestPolicy('deepseek', 'https://gateway.example/v1', 'deepseek-v4-flash'))
      .toEqual({
        officialHost: false,
        responseFormat: 'json_schema',
        chatBody: {},
        searchTransport: 'unsupported'
      })
  })
})
