import {
  AI_PROVIDER_IDS,
  type AIProviderId
} from './ai-assistant-contract'

export interface AIProviderPreset {
  readonly id: AIProviderId
  readonly label: string
  readonly defaultBaseUrl: string
}

function preset(
  id: AIProviderId,
  label: string,
  defaultBaseUrl: string
): AIProviderPreset {
  return Object.freeze({ id, label, defaultBaseUrl })
}

export const AI_PROVIDER_PRESETS: readonly AIProviderPreset[] = Object.freeze([
  preset('openai', 'OpenAI', 'https://api.openai.com/v1'),
  preset('deepseek', 'DeepSeek', 'https://api.deepseek.com'),
  preset('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'),
  preset('qwen', '通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  preset('moonshot', 'Kimi / Moonshot', 'https://api.moonshot.cn/v1'),
  preset('glm', '智谱 GLM', 'https://open.bigmodel.cn/api/paas/v4'),
  preset('xai', 'xAI', 'https://api.x.ai/v1'),
  preset('mimo', '小米 MiMo', 'https://api.xiaomimimo.com/v1'),
  preset('custom', '自定义 OpenAI-Compatible', '')
])

const PRESETS_BY_ID = new Map<AIProviderId, AIProviderPreset>(
  AI_PROVIDER_PRESETS.map((entry) => [entry.id, entry])
)

const PROVIDER_BY_HOST = new Map<string, AIProviderId>([
  ['api.openai.com', 'openai'],
  ['api.deepseek.com', 'deepseek'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['dashscope.aliyuncs.com', 'qwen'],
  ['api.moonshot.cn', 'moonshot'],
  ['open.bigmodel.cn', 'glm'],
  ['api.x.ai', 'xai'],
  ['api.xiaomimimo.com', 'mimo']
])

export function getAIProviderPreset(providerId: unknown): AIProviderPreset | undefined {
  if (typeof providerId !== 'string' ||
    !(AI_PROVIDER_IDS as readonly string[]).includes(providerId)) return undefined
  return PRESETS_BY_ID.get(providerId as AIProviderId)
}

export function detectAIProviderId(baseUrl: string): AIProviderId {
  try {
    return PROVIDER_BY_HOST.get(new URL(baseUrl).hostname.toLowerCase()) ?? 'custom'
  } catch {
    return 'custom'
  }
}
