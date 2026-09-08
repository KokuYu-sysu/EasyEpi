import { normalizeAIBaseUrl } from './ai-config.service'
import { resolveOpenAICompatibleEndpoint } from './ai-provider-policy'
import {
  OpenAIResponsesParseError,
  createOpenAIResponsesSseParser,
  parseOpenAIResponsesJson,
  type AIResponseCitation
} from './openai-responses.parser'
import { AIClientError } from './openai-compatible.client'

export interface AIResponsesSearchRequest {
  baseUrl: string
  model: string
  apiKey?: string
  input: string
  allowedDomains?: string[]
  streamingSupported?: boolean
  signal?: AbortSignal
  onContentDelta?: (delta: string) => void
}

export interface AIResponsesSearchResult {
  content: string
  citations: AIResponseCitation[]
  searched: boolean
  streamingSupported: boolean
}

export interface OpenAIResponsesClientOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  maxEventCount?: number
  maxEventBytes?: number
  maxPartialEventBytes?: number
  maxContentCharacters?: number
}

function statusError(status: number): AIClientError {
  if (status === 401 || status === 403) return new AIClientError('AI_AUTH_ERROR')
  if (status === 404) return new AIClientError('AI_MODEL_NOT_FOUND')
  if (status === 429) return new AIClientError('AI_RATE_LIMITED')
  return new AIClientError('AI_PROVIDER_ERROR')
}

function validDomains(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined
  if (values.length === 0 || values.length > 20) throw new Error('INVALID_AI_SEARCH_REQUEST')
  const normalized = values.map((value) => value.trim().toLowerCase())
  if (normalized.some((value) =>
    value.length === 0 || value.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  )) throw new Error('INVALID_AI_SEARCH_REQUEST')
  return [...new Set(normalized)]
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new AIClientError('AI_RESPONSE_TOO_LARGE')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new AIClientError('AI_RESPONSE_TOO_LARGE')
    }
    chunks.push(next.value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(merged)
  } catch {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
}

export function createOpenAIResponsesClient(
  options: OpenAIResponsesClientOptions = {}
): { search(request: AIResponsesSearchRequest): Promise<AIResponsesSearchResult> } {
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const maxResponseBytes = options.maxResponseBytes ?? 2_000_000

  return {
    async search(request) {
      if (request.signal?.aborted === true) throw new AIClientError('AI_CANCELLED')
      const baseUrl = normalizeAIBaseUrl(request.baseUrl)
      const model = request.model.trim()
      const input = request.input.trim()
      if (model.length === 0 || model.length > 200 || input.length === 0 || input.length > 100_000) {
        throw new Error('INVALID_AI_SEARCH_REQUEST')
      }
      const allowedDomains = validDomains(request.allowedDomains)
      const useStreaming = request.streamingSupported !== false
      const controller = new AbortController()
      let timedOut = false
      let callerAborted = false
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const onAbort = (): void => {
        callerAborted = true
        controller.abort()
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const response = await fetcher(resolveOpenAICompatibleEndpoint(baseUrl, 'responses'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            input,
            tools: [{
              type: 'web_search',
              ...(allowedDomains === undefined
                ? {}
                : { filters: { allowed_domains: allowedDomains } })
            }],
            ...(useStreaming ? { stream: true } : {})
          }),
          signal: controller.signal
        })
        if (controller.signal.aborted) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error('ABORTED')
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw statusError(response.status)
        }
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        if (!useStreaming || !contentType.includes('text/event-stream')) {
          const text = await readBounded(response, maxResponseBytes)
          try {
            return { ...parseOpenAIResponsesJson(JSON.parse(text)), streamingSupported: false }
          } catch (error) {
            if (error instanceof AIClientError) throw error
            throw new AIClientError('AI_INVALID_RESPONSE')
          }
        }
        if (response.body === null) throw new AIClientError('AI_INVALID_RESPONSE')
        const parser = createOpenAIResponsesSseParser({
          maxEventCount: options.maxEventCount ?? 10_000,
          maxEventBytes: Math.min(options.maxEventBytes ?? 128_000, maxResponseBytes),
          maxPartialBytes: Math.min(options.maxPartialEventBytes ?? 128_000, maxResponseBytes),
          maxContentCharacters: options.maxContentCharacters ?? 1_000_000
        })
        const reader = response.body.getReader()
        let totalBytes = 0
        try {
          for (;;) {
            const next = await reader.read()
            if (controller.signal.aborted) throw new Error('ABORTED')
            if (next.done) break
            totalBytes += next.value.byteLength
            if (totalBytes > maxResponseBytes) throw new AIClientError('AI_RESPONSE_TOO_LARGE')
            for (const delta of parser.push(next.value)) request.onContentDelta?.(delta)
          }
          return { ...parser.finish(), streamingSupported: true }
        } finally {
          if (controller.signal.aborted || totalBytes > maxResponseBytes) {
            await reader.cancel().catch(() => undefined)
          }
          reader.releaseLock()
        }
      } catch (error) {
        if (callerAborted) throw new AIClientError('AI_CANCELLED')
        if (timedOut) throw new AIClientError('AI_TIMEOUT')
        if (error instanceof AIClientError) throw error
        if (error instanceof OpenAIResponsesParseError) {
          throw new AIClientError(error.kind === 'limit' ? 'AI_RESPONSE_TOO_LARGE' : 'AI_INVALID_RESPONSE')
        }
        throw new AIClientError('AI_NETWORK_ERROR')
      } finally {
        clearTimeout(timeout)
        request.signal?.removeEventListener('abort', onAbort)
      }
    }
  }
}
