import { DEEPSEEK_BASE_URL, detectAIProviderId } from '@shared/ai-provider-profiles'

export type AIResponseFormatLevel = 'json_schema' | 'json_object' | 'text'
export type AITokenLimitParameter = 'max_completion_tokens' | 'max_tokens' | 'none'
export type AISearchTransport = 'responses' | 'unsupported'

export interface AIProviderRequestPolicy {
  officialHost: boolean
  responseFormat: AIResponseFormatLevel
  /**
   * DeepSeek exposes an OpenAI-compatible Responses API with a hosted `web_search` tool.
   * `responses` means the native search transport is expected to work; an actual 400/404 for the
   * `web_search` tool is discovered at runtime and cached per endpoint and model.
   */
  searchTransport: AISearchTransport
}

const OFFICIAL_HOSTS: readonly string[] = ['api.deepseek.com']

function hostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isOfficialAIProviderHost(baseUrl: string): boolean {
  return OFFICIAL_HOSTS.includes(hostname(baseUrl)) && detectAIProviderId(baseUrl) === 'deepseek'
}

export function resolveOpenAICompatibleEndpoint(
  baseUrl: string,
  kind: 'chat' | 'responses'
): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  const suffix = kind === 'chat' ? '/chat/completions' : '/responses'
  const otherSuffix = kind === 'chat' ? '/responses' : '/chat/completions'
  if (normalized.endsWith(suffix)) return normalized
  if (normalized.endsWith(otherSuffix)) {
    return `${normalized.slice(0, -otherSuffix.length)}${suffix}`
  }
  return `${normalized}${suffix}`
}

/**
 * DeepSeek documents `https://api.deepseek.com/v1` as an alias with no version meaning, so a
 * deployment may answer on either spelling. The first candidate is the documented one; the second is
 * a bounded fallback used only when the first responds 404.
 */
export function resolveEndpointCandidates(baseUrl: string, kind: 'chat' | 'responses'): string[] {
  const primary = resolveOpenAICompatibleEndpoint(baseUrl, kind)
  if (kind !== 'responses') return [primary]
  if (primary.includes('/v1/responses')) {
    return [primary, primary.replace('/v1/responses', '/responses')]
  }
  const origin = primary.slice(0, -'/responses'.length)
  return [primary, `${origin}/v1/responses`]
}

export function getAIProviderRequestPolicy(baseUrl: string): AIProviderRequestPolicy {
  return {
    officialHost: isOfficialAIProviderHost(baseUrl),
    responseFormat: 'json_object',
    searchTransport: 'responses'
  }
}

export const AI_DEEPSEEK_DEFAULT_BASE_URL = DEEPSEEK_BASE_URL
