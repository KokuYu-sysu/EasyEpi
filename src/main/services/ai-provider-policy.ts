import type { AIProviderId } from '@shared/ai-assistant-contract'

import { normalizeAIBaseUrl } from './ai-config.service'

export type AIResponseFormatLevel = 'json_schema' | 'json_object' | 'text'
export type AISearchTransport = 'chat' | 'responses' | 'unsupported'

export interface AIProviderRequestPolicy {
  officialHost: boolean
  responseFormat: AIResponseFormatLevel
  chatBody: Readonly<Record<string, unknown>>
  searchTransport: AISearchTransport
}

const OFFICIAL_HOSTS: Readonly<Record<Exclude<AIProviderId, 'custom'>, readonly string[]>> = {
  openai: ['api.openai.com'],
  deepseek: ['api.deepseek.com'],
  gemini: ['generativelanguage.googleapis.com'],
  qwen: ['dashscope.aliyuncs.com'],
  moonshot: ['api.moonshot.cn', 'api.moonshot.ai'],
  glm: ['open.bigmodel.cn'],
  xai: ['api.x.ai'],
  mimo: ['api.xiaomimimo.com']
}

function hostname(baseUrl: string): string {
  try {
    return new URL(normalizeAIBaseUrl(baseUrl)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isOfficialAIProviderHost(providerId: AIProviderId, baseUrl: string): boolean {
  if (providerId === 'custom') return false
  return OFFICIAL_HOSTS[providerId].includes(hostname(baseUrl))
}

export function resolveOpenAICompatibleEndpoint(
  baseUrl: string,
  kind: 'chat' | 'responses'
): string {
  const normalized = normalizeAIBaseUrl(baseUrl)
  const suffix = kind === 'chat' ? '/chat/completions' : '/responses'
  if (normalized.endsWith(suffix)) return normalized
  const otherSuffix = kind === 'chat' ? '/responses' : '/chat/completions'
  if (normalized.endsWith(otherSuffix)) {
    return `${normalized.slice(0, -otherSuffix.length)}${suffix}`
  }
  return `${normalized}${suffix}`
}

const STANDARD_POLICY: AIProviderRequestPolicy = Object.freeze({
  officialHost: false,
  responseFormat: 'json_schema',
  chatBody: Object.freeze({}),
  searchTransport: 'unsupported'
})

export function getAIProviderRequestPolicy(
  providerId: AIProviderId,
  baseUrl: string,
  _model: string
): AIProviderRequestPolicy {
  if (!isOfficialAIProviderHost(providerId, baseUrl)) return STANDARD_POLICY

  switch (providerId) {
    case 'openai':
      return { officialHost: true, responseFormat: 'json_schema', chatBody: {}, searchTransport: 'responses' }
    case 'deepseek':
      return {
        officialHost: true,
        responseFormat: 'json_object',
        chatBody: { thinking: { type: 'disabled' } },
        searchTransport: 'unsupported'
      }
    case 'gemini':
      return { officialHost: true, responseFormat: 'json_schema', chatBody: {}, searchTransport: 'unsupported' }
    case 'qwen':
      return { officialHost: true, responseFormat: 'json_object', chatBody: {}, searchTransport: 'chat' }
    case 'moonshot':
      return {
        officialHost: true,
        responseFormat: 'json_object',
        chatBody: { thinking: { type: 'disabled' } },
        searchTransport: 'chat'
      }
    case 'glm':
      return { officialHost: true, responseFormat: 'json_object', chatBody: {}, searchTransport: 'chat' }
    case 'xai':
      return { officialHost: true, responseFormat: 'json_schema', chatBody: {}, searchTransport: 'responses' }
    case 'mimo':
      return {
        officialHost: true,
        responseFormat: 'json_object',
        chatBody: { thinking: { type: 'disabled' } },
        searchTransport: 'chat'
      }
    case 'custom':
      return STANDARD_POLICY
  }
}
