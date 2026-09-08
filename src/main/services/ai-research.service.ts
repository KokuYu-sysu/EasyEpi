import type { AIProviderId } from '@shared/ai-assistant-contract'

import { getAIProviderRequestPolicy, resolveOpenAICompatibleEndpoint } from './ai-provider-policy'
import { AIClientError } from './openai-compatible.client'
import {
  createOpenAIResponsesClient,
  type AIResponsesSearchRequest,
  type AIResponsesSearchResult
} from './openai-responses.client'
import type { AIResponseCitation } from './openai-responses.parser'

export type AIResearchStatus = 'searched' | 'not_needed' | 'disabled' | 'unsupported' | 'failed'

export interface AIResearchRequest {
  providerId: AIProviderId
  baseUrl: string
  model: string
  apiKey?: string
  enabled: boolean
  query: string
  signal?: AbortSignal
}

export interface AIResearchResult {
  status: AIResearchStatus
  evidence: string
  citations: AIResponseCitation[]
}

interface ResponsesClient {
  search(request: AIResponsesSearchRequest): Promise<AIResponsesSearchResult>
}

interface AIResearchServiceOptions {
  fetch?: typeof fetch
  responsesClient?: ResponsesClient
  maxResponseBytes?: number
}

const EMPTY: Pick<AIResearchResult, 'evidence' | 'citations'> = { evidence: '', citations: [] }
const RESEARCH_PROMPT = `请使用当前服务商内置的联网搜索能力检索并综合证据。
优先检索 PubMed、Web of Science、Cochrane Library、WHO、CDC 和国家卫生健康委员会等权威来源。
请给出可核验的标题、年份、HTTPS 链接，以及存在时的 DOI 或 PMID；不得虚构检索结果或引用。`

function searchBody(providerId: AIProviderId): Record<string, unknown> {
  switch (providerId) {
    case 'qwen':
      return { enable_search: true, search_options: { forced_search: true, search_strategy: 'max' } }
    case 'glm':
      return {
        tools: [{
          type: 'web_search',
          web_search: { enable: true, search_engine: 'search_pro', search_result: true, count: 10 }
        }]
      }
    case 'mimo':
      return {
        thinking: { type: 'disabled' },
        tools: [{ type: 'web_search', max_keyword: 3, force_search: true, limit: 10 }],
        tool_choice: 'auto'
      }
    case 'moonshot':
      return {
        thinking: { type: 'disabled' },
        tools: [{ type: 'builtin_function', function: { name: '$web_search' } }]
      }
    default:
      return {}
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid')
  return value as Record<string, unknown>
}

function citationsFrom(message: Record<string, unknown>): AIResponseCitation[] {
  if (!Array.isArray(message.annotations)) return []
  return message.annotations.flatMap((value) => {
    try {
      const item = record(value)
      const nested = typeof item.url_citation === 'object' && item.url_citation !== null
        ? record(item.url_citation)
        : item
      if (typeof nested.url !== 'string') return []
      const url = new URL(nested.url)
      if (url.protocol !== 'https:' || url.username || url.password) return []
      const title = typeof nested.title === 'string' && nested.title.length <= 500 ? nested.title : url.hostname
      return [{ url: url.toString(), title }]
    } catch {
      return []
    }
  })
}

function parseChoice(value: unknown): {
  finishReason: string
  message: Record<string, unknown>
  content?: string
} {
  const root = record(value)
  if (!Array.isArray(root.choices) || root.choices.length !== 1) throw new Error('invalid')
  const choice = record(root.choices[0])
  const message = record(choice.message)
  if (choice.index !== 0 || typeof choice.finish_reason !== 'string' || message.role !== 'assistant') {
    throw new Error('invalid')
  }
  return {
    finishReason: choice.finish_reason,
    message,
    ...(typeof message.content === 'string' && message.content.length > 0 ? { content: message.content } : {})
  }
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('provider')
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('large')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error('large')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export function createAIResearchService(options: AIResearchServiceOptions = {}): {
  research(request: AIResearchRequest): Promise<AIResearchResult>
} {
  const fetcher = options.fetch ?? fetch
  const responsesClient = options.responsesClient ?? createOpenAIResponsesClient({ fetch: fetcher })
  const maxResponseBytes = options.maxResponseBytes ?? 2_000_000

  async function postChat(request: AIResearchRequest, messages: unknown[]): Promise<unknown> {
    const response = await fetcher(resolveOpenAICompatibleEndpoint(request.baseUrl, 'chat'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: request.model,
        messages,
        stream: false,
        ...searchBody(request.providerId)
      }),
      signal: request.signal
    })
    return readJson(response, maxResponseBytes)
  }

  return {
    async research(request) {
      if (!request.enabled) return { status: 'disabled', ...EMPTY }
      const policy = getAIProviderRequestPolicy(request.providerId, request.baseUrl, request.model)
      if (policy.searchTransport === 'unsupported') return { status: 'unsupported', ...EMPTY }
      try {
        if (policy.searchTransport === 'responses') {
          const result = await responsesClient.search({
            baseUrl: request.baseUrl,
            model: request.model,
            apiKey: request.apiKey,
            input: `${RESEARCH_PROMPT}\n\n研究问题：${request.query}`,
            allowedDomains: request.providerId === 'openai'
              ? ['pubmed.ncbi.nlm.nih.gov', 'who.int']
              : undefined,
            signal: request.signal
          })
          return {
            status: result.searched ? 'searched' : 'not_needed',
            evidence: result.content,
            citations: result.citations
          }
        }

        const messages: unknown[] = [
          { role: 'system', content: RESEARCH_PROMPT },
          { role: 'user', content: request.query }
        ]
        const first = parseChoice(await postChat(request, messages))
        if (request.providerId !== 'moonshot') {
          if (first.finishReason !== 'stop' || first.content === undefined) throw new Error('invalid')
          return { status: 'searched', evidence: first.content, citations: citationsFrom(first.message) }
        }
        if (first.finishReason === 'stop' && first.content !== undefined) {
          return { status: 'not_needed', evidence: first.content, citations: citationsFrom(first.message) }
        }
        if (first.finishReason !== 'tool_calls' || !Array.isArray(first.message.tool_calls) ||
          first.message.tool_calls.length !== 1) throw new Error('invalid')
        const toolCall = record(first.message.tool_calls[0])
        const fn = record(toolCall.function)
        if (toolCall.type !== 'builtin_function' || typeof toolCall.id !== 'string' ||
          toolCall.id.length > 200 || fn.name !== '$web_search' || typeof fn.arguments !== 'string' ||
          fn.arguments.length > 20_000) throw new Error('invalid')
        record(JSON.parse(fn.arguments))
        messages.push(first.message, {
          role: 'tool', tool_call_id: toolCall.id, name: '$web_search', content: fn.arguments
        })
        const final = parseChoice(await postChat(request, messages))
        if (final.finishReason !== 'stop' || final.content === undefined) throw new Error('invalid')
        return { status: 'searched', evidence: final.content, citations: citationsFrom(final.message) }
      } catch (error) {
        if (error instanceof AIClientError && error.code === 'AI_CANCELLED') throw error
        if (request.signal?.aborted === true) throw new AIClientError('AI_CANCELLED')
        return { status: 'failed', ...EMPTY }
      }
    }
  }
}
