import { describe, expect, it } from 'vitest'

import {
  AI_PROVIDER_PRESETS,
  detectAIProviderId,
  getAIProviderPreset
} from '@shared/ai-provider-profiles'

describe('AI provider presets', () => {
  it('provides one safe preset for every supported provider', () => {
    expect(AI_PROVIDER_PRESETS).toEqual([
      { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
      { id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com' },
      { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
      { id: 'qwen', label: '通义千问', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { id: 'moonshot', label: 'Kimi / Moonshot', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
      { id: 'glm', label: '智谱 GLM', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      { id: 'xai', label: 'xAI', defaultBaseUrl: 'https://api.x.ai/v1' },
      { id: 'mimo', label: '小米 MiMo', defaultBaseUrl: 'https://api.xiaomimimo.com/v1' },
      { id: 'custom', label: '自定义 OpenAI-Compatible', defaultBaseUrl: '' }
    ])
  })

  it('detects only known official hosts and otherwise uses custom', () => {
    expect(detectAIProviderId('https://api.openai.com/v1')).toBe('openai')
    expect(detectAIProviderId('https://api.deepseek.com/chat/completions')).toBe('deepseek')
    expect(detectAIProviderId('https://generativelanguage.googleapis.com/v1beta/openai')).toBe('gemini')
    expect(detectAIProviderId('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('qwen')
    expect(detectAIProviderId('https://api.moonshot.cn/v1')).toBe('moonshot')
    expect(detectAIProviderId('https://open.bigmodel.cn/api/paas/v4')).toBe('glm')
    expect(detectAIProviderId('https://api.x.ai/v1')).toBe('xai')
    expect(detectAIProviderId('https://api.xiaomimimo.com/v1')).toBe('mimo')
    expect(detectAIProviderId('https://proxy.example.com/v1')).toBe('custom')
    expect(detectAIProviderId('not a URL')).toBe('custom')
  })

  it('returns immutable preset data without accepting unknown identifiers', () => {
    expect(getAIProviderPreset('qwen')).toEqual({
      id: 'qwen',
      label: '通义千问',
      defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    })
    expect(getAIProviderPreset('not-supported')).toBeUndefined()
    expect(Object.isFrozen(AI_PROVIDER_PRESETS)).toBe(true)
    expect(AI_PROVIDER_PRESETS.every(Object.isFrozen)).toBe(true)
  })
})
