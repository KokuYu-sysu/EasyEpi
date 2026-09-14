import type { AIProviderId } from './ai-assistant-contract'

/**
 * EasyEpi supports exactly one AI provider. The provider is a constant rather than a user choice, so
 * the endpoint is fixed here and never accepted from the renderer or from a stored configuration.
 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/**
 * Current DeepSeek catalogue entries are `deepseek-v4.1-flash` and `deepseek-v4-pro`.
 * `deepseek-chat` and `deepseek-reasoner` are legacy V3 aliases and are not assumed to exist.
 */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4.1-flash'
export const DEEPSEEK_MODEL_OPTIONS: readonly string[] = Object.freeze([
  'deepseek-v4.1-flash',
  'deepseek-v4-pro'
])

export interface AIProviderPreset {
  readonly id: AIProviderId
  readonly label: string
  readonly defaultBaseUrl: string
  readonly defaultModel: string
}

export const AI_PROVIDER_PRESET: AIProviderPreset = Object.freeze({
  id: 'deepseek',
  label: 'DeepSeek',
  defaultBaseUrl: DEEPSEEK_BASE_URL,
  defaultModel: DEEPSEEK_DEFAULT_MODEL
})

const PROVIDER_BY_HOST: ReadonlyMap<string, AIProviderId> = new Map([
  ['api.deepseek.com', 'deepseek']
])

/**
 * The configured endpoint is always normalized to `DEEPSEEK_BASE_URL`, but stored legacy
 * configurations may carry another host. Detection is kept so migration can decide whether an
 * existing encrypted API key and model id still belong to the supported provider.
 */
export function detectAIProviderId(baseUrl: string): AIProviderId | undefined {
  try {
    return PROVIDER_BY_HOST.get(new URL(baseUrl).hostname.toLowerCase())
  } catch {
    return undefined
  }
}

export function isSupportedAIProviderId(value: unknown): value is AIProviderId {
  return value === 'deepseek'
}

export function getAIProviderPreset(providerId: unknown): AIProviderPreset | undefined {
  return isSupportedAIProviderId(providerId) ? AI_PROVIDER_PRESET : undefined
}
