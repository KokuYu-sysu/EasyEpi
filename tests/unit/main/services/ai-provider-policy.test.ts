import { describe, expect, it } from 'vitest'

import {
  AI_DEEPSEEK_DEFAULT_BASE_URL,
  getAIProviderRequestPolicy,
  isOfficialAIProviderHost,
  resolveEndpointCandidates,
  resolveOpenAICompatibleEndpoint
} from '@main/services/ai-provider-policy'
import { DEEPSEEK_BASE_URL } from '@shared/ai-provider-profiles'

describe('OpenAI-compatible endpoint resolution', () => {
  it.each([
    ['https://api.deepseek.com', 'chat', 'https://api.deepseek.com/chat/completions'],
    ['https://api.deepseek.com/', 'chat', 'https://api.deepseek.com/chat/completions'],
    ['https://api.deepseek.com/v1', 'chat', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://api.deepseek.com/v1/', 'responses', 'https://api.deepseek.com/v1/responses'],
    [
      'https://api.deepseek.com/v1/chat/completions',
      'chat',
      'https://api.deepseek.com/v1/chat/completions'
    ],
    [
      'https://api.deepseek.com/v1/chat/completions',
      'responses',
      'https://api.deepseek.com/v1/responses'
    ],
    [
      'https://api.deepseek.com/v1/responses',
      'chat',
      'https://api.deepseek.com/v1/chat/completions'
    ],
    ['https://api.deepseek.com/v1/responses', 'responses', 'https://api.deepseek.com/v1/responses']
  ] as const)('resolves %s for %s without duplicating paths', (baseUrl, kind, expected) => {
    expect(resolveOpenAICompatibleEndpoint(baseUrl, kind)).toBe(expected)
  })
})

describe('OpenAI-compatible endpoint candidates', () => {
  it('returns the documented /responses URL first and the /v1 alias second', () => {
    expect(resolveEndpointCandidates('https://api.deepseek.com', 'responses')).toEqual([
      'https://api.deepseek.com/responses',
      'https://api.deepseek.com/v1/responses'
    ])
    expect(resolveEndpointCandidates('https://api.deepseek.com/v1', 'responses')).toEqual([
      'https://api.deepseek.com/v1/responses',
      'https://api.deepseek.com/responses'
    ])
  })

  it('never offers a second candidate for the chat transport', () => {
    expect(resolveEndpointCandidates('https://api.deepseek.com', 'chat')).toEqual([
      'https://api.deepseek.com/chat/completions'
    ])
    expect(resolveEndpointCandidates('https://api.deepseek.com/v1/', 'chat')).toEqual([
      'https://api.deepseek.com/v1/chat/completions'
    ])
  })
})

describe('provider request policy', () => {
  it('always negotiates json_object with the native responses search transport', () => {
    expect(getAIProviderRequestPolicy('https://api.deepseek.com')).toEqual({
      officialHost: true,
      responseFormat: 'json_object',
      searchTransport: 'responses'
    })
    expect(getAIProviderRequestPolicy('https://api.deepseek.com/v1')).toEqual({
      officialHost: true,
      responseFormat: 'json_object',
      searchTransport: 'responses'
    })
  })

  it('keeps the same single-provider policy on a non-official host but never marks it official', () => {
    for (const baseUrl of [
      'https://gateway.example/v1',
      'https://api.deepseek.com.evil.example/v1',
      'not a URL'
    ]) {
      expect(getAIProviderRequestPolicy(baseUrl)).toEqual({
        officialHost: false,
        responseFormat: 'json_object',
        searchTransport: 'responses'
      })
    }
  })

  it('recognizes only the official DeepSeek host', () => {
    expect(isOfficialAIProviderHost('https://api.deepseek.com')).toBe(true)
    expect(isOfficialAIProviderHost('https://api.deepseek.com/v1')).toBe(true)
    expect(isOfficialAIProviderHost('https://gateway.example/v1')).toBe(false)
    expect(isOfficialAIProviderHost('https://api.deepseek.com.evil.example/v1')).toBe(false)
    expect(isOfficialAIProviderHost('not a URL')).toBe(false)
    expect(AI_DEEPSEEK_DEFAULT_BASE_URL).toBe(DEEPSEEK_BASE_URL)
  })
})
