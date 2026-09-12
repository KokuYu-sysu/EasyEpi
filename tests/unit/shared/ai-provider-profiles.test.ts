import { describe, expect, it } from 'vitest'

import { AI_PROVIDER_IDS } from '@shared/ai-assistant-contract'
import {
  AI_PROVIDER_PRESET,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MODEL_OPTIONS,
  detectAIProviderId,
  getAIProviderPreset,
  isSupportedAIProviderId
} from '@shared/ai-provider-profiles'

describe('AI provider presets', () => {
  it('exposes one frozen preset for the single supported provider', () => {
    expect(AI_PROVIDER_IDS).toEqual(['deepseek'])
    expect(AI_PROVIDER_PRESET).toEqual({
      id: 'deepseek',
      label: 'DeepSeek',
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash'
    })
    expect(DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com')
    expect(DEEPSEEK_DEFAULT_MODEL).toBe('deepseek-v4-flash')
    expect(DEEPSEEK_MODEL_OPTIONS).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('detects only the DeepSeek host and reports every other vendor as unsupported', () => {
    expect(detectAIProviderId('https://api.deepseek.com')).toBe('deepseek')
    expect(detectAIProviderId('https://api.deepseek.com/chat/completions')).toBe('deepseek')
    expect(detectAIProviderId('https://api.deepseek.com/v1')).toBe('deepseek')
    expect(detectAIProviderId('https://API.DeepSeek.com/v1')).toBe('deepseek')

    for (const foreign of [
      'https://api.openai.com/v1',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://api.moonshot.cn/v1',
      'https://open.bigmodel.cn/api/paas/v4',
      'https://api.x.ai/v1',
      'https://api.xiaomimimo.com/v1',
      'https://proxy.example.com/v1',
      // A look-alike host must not be mistaken for the official endpoint.
      'https://api.deepseek.com.evil.example/v1',
      'not a URL'
    ]) {
      expect(detectAIProviderId(foreign)).toBeUndefined()
    }
  })

  it('returns immutable preset data without accepting unknown identifiers', () => {
    expect(getAIProviderPreset('deepseek')).toBe(AI_PROVIDER_PRESET)
    expect(getAIProviderPreset('openai')).toBeUndefined()
    expect(getAIProviderPreset('qwen')).toBeUndefined()
    expect(getAIProviderPreset(undefined)).toBeUndefined()
    expect(getAIProviderPreset(null)).toBeUndefined()

    expect(isSupportedAIProviderId('deepseek')).toBe(true)
    expect(isSupportedAIProviderId('openai')).toBe(false)
    expect(isSupportedAIProviderId(7)).toBe(false)

    expect(Object.isFrozen(AI_PROVIDER_PRESET)).toBe(true)
    expect(Object.isFrozen(DEEPSEEK_MODEL_OPTIONS)).toBe(true)
  })
})
