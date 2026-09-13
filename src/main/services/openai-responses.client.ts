import { normalizeAIBaseUrl } from './ai-config.service'
import { resolveEndpointCandidates } from './ai-provider-policy'
import {
  OpenAIResponsesParseError,
  createOpenAIResponsesSseParser,
  parseOpenAIResponsesJson,
  type AIResponseCitation
} from './openai-responses.parser'
import { AIClientError } from './openai-compatible.client'

/**
 * The Responses API rejects `max_output_tokens` below 16, so the floor is enforced rather than
 * clamped silently at the transport boundary.
 */
export const RESPONSES_MIN_OUTPUT_TOKENS = 16
const RESPONSES_DEFAULT_OUTPUT_TOKENS = 8_192

export interface AIResponsesSearchRequest {
  baseUrl: string
  model: string
  apiKey?: string
  instructions?: string
  input: string
  maxOutputTokens?: number
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
  /** How long the stream may deliver nothing before the request is abandoned. Reset by every chunk. */
  idleTimeoutMs?: number
  /** Absolute ceiling for one request, so a stream that dribbles forever still ends. */
  maxRequestMs?: number
  maxResponseBytes?: number
  maxEventCount?: number
  maxEventBytes?: number
  maxPartialEventBytes?: number
  maxContentCharacters?: number
}

export type AIResponsesUnsupportedReason = 'web_search_tool' | 'responses_endpoint'

/**
 * Raised when the deployment explicitly refuses the hosted `web_search` tool or the `/responses`
 * route. The caller caches this per endpoint and model so the discovery is never paid for twice.
 */
export class AIResponsesUnsupportedError extends Error {
  constructor(
    readonly reason: AIResponsesUnsupportedReason,
    readonly status: number
  ) {
    super(reason === 'web_search_tool' ? 'AI_RESEARCH_UNSUPPORTED' : 'AI_MODEL_NOT_FOUND')
    this.name = 'AIResponsesUnsupportedError'
  }
}

function statusError(status: number): AIClientError {
  if (status === 401 || status === 403) return new AIClientError('AI_AUTH_ERROR')
  if (status === 429) return new AIClientError('AI_RATE_LIMITED')
  return new AIClientError('AI_PROVIDER_ERROR')
}

function errorSignal(text: string): { param: string; message: string } {
  try {
    const root = JSON.parse(text) as unknown
    if (typeof root === 'object' && root !== null && !Array.isArray(root)) {
      const error = (root as Record<string, unknown>).error
      if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
        const record = error as Record<string, unknown>
        return {
          param: typeof record.param === 'string' ? record.param.toLowerCase() : '',
          message: [record.code, record.type, record.message]
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
            .toLowerCase()
        }
      }
    }
  } catch {
    // Fall through to the raw body.
  }
  return { param: '', message: text.toLowerCase() }
}

function namesWebSearchRefusal(status: number, text: string): boolean {
  if (status !== 400 && status !== 422) return false
  const { param, message } = errorSignal(text)
  const namesTool = param.startsWith('tools') || message.includes('web_search') ||
    message.includes('web search') || message.includes('websearch')
  const refusal = message.includes('unsupported') || message.includes('not support') ||
    message.includes('unknown') || message.includes('unrecognized') ||
    message.includes('invalid') || message.includes('not available') ||
    message.includes('not enabled')
  return namesTool && refusal
}

async function readBounded(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  onActivity?: () => void
): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new AIClientError('AI_RESPONSE_TOO_LARGE')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let cancelled = false
  const onAbort = (): void => {
    cancelled = true
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      const next = await reader.read()
      // A non-streaming body can still arrive slowly; received bytes are activity either way.
      onActivity?.()
      if (signal?.aborted === true) throw new Error('ABORTED')
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) {
        cancelled = true
        await reader.cancel().catch(() => undefined)
        throw new AIClientError('AI_RESPONSE_TOO_LARGE')
      }
      chunks.push(next.value)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!cancelled) reader.releaseLock()
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

function parseError(error: unknown): AIClientError {
  if (error instanceof AIClientError) return error
  if (error instanceof OpenAIResponsesParseError) {
    if (error.kind === 'limit') return new AIClientError('AI_RESPONSE_TOO_LARGE')
    if (error.kind === 'truncated') return new AIClientError('AI_RESPONSE_TRUNCATED')
    return new AIClientError('AI_INVALID_RESPONSE')
  }
  return new AIClientError('AI_INVALID_RESPONSE')
}

export function createOpenAIResponsesClient(
  options: OpenAIResponsesClientOptions = {}
): { search(request: AIResponsesSearchRequest): Promise<AIResponsesSearchResult> } {
  const fetcher = options.fetch ?? fetch
  const idleTimeoutMs = options.idleTimeoutMs ?? 180_000
  const maxRequestMs = options.maxRequestMs ?? 1_800_000
  const maxResponseBytes = options.maxResponseBytes ?? 4_000_000

  async function requestOnce(
    url: string,
    request: AIResponsesSearchRequest,
    maxOutputTokens: number,
    useStreaming: boolean,
    controller: AbortController
  ): Promise<Response> {
    return fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: useStreaming ? 'text/event-stream' : 'application/json',
        ...(request.apiKey === undefined || request.apiKey.length === 0
          ? {}
          : { authorization: `Bearer ${request.apiKey}` })
      },
      body: JSON.stringify({
        model: request.model,
        ...(request.instructions === undefined || request.instructions.length === 0
          ? {}
          : { instructions: request.instructions }),
        input: request.input,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        // `/responses` takes `max_output_tokens`; `max_completion_tokens` belongs to Chat Completions.
        max_output_tokens: maxOutputTokens,
        ...(useStreaming ? { stream: true } : {})
      }),
      signal: controller.signal
    })
  }

  async function readStream(
    response: Response,
    request: AIResponsesSearchRequest,
    controller: AbortController,
    onActivity: () => void
  ): Promise<AIResponsesSearchResult> {
    if (response.body === null) throw new AIClientError('AI_INVALID_RESPONSE')
    const parser = createOpenAIResponsesSseParser({
      // One SSE event per generated token, so the bound tracks the output budget rather than a fixed
      // number that a long answer with hosted search results would exceed.
      maxEventCount: options.maxEventCount ?? 200_000,
      // A single `response.completed` event embeds the whole response, including every hosted search
      // result, so the per-event bound has to be generous rather than the 256 KB that fit a plain chat
      // completion.
      maxEventBytes: Math.min(options.maxEventBytes ?? 2_000_000, maxResponseBytes),
      maxPartialBytes: Math.min(options.maxPartialEventBytes ?? 2_000_000, maxResponseBytes),
      maxContentCharacters: options.maxContentCharacters ?? 1_000_000
    })
    const reader = response.body.getReader()
    let totalBytes = 0
    let readerCancelled = false
    const cancelReader = (): void => {
      readerCancelled = true
      void reader.cancel().catch(() => undefined)
    }
    controller.signal.addEventListener('abort', cancelReader, { once: true })
    try {
      for (;;) {
        const next = await reader.read()
        // Every chunk is activity, so a slow hosted search is never mistaken for a hung connection.
        onActivity()
        if (controller.signal.aborted) throw new Error('ABORTED')
        if (next.done) break
        totalBytes += next.value.byteLength
        if (totalBytes > maxResponseBytes) throw new AIClientError('AI_RESPONSE_TOO_LARGE')
        for (const delta of parser.push(next.value)) request.onContentDelta?.(delta)
      }
      return { ...parser.finish(), streamingSupported: true }
    } catch (error) {
      if (!readerCancelled) await reader.cancel().catch(() => undefined)
      throw error instanceof OpenAIResponsesParseError ? parseError(error) : error
    } finally {
      controller.signal.removeEventListener('abort', cancelReader)
      reader.releaseLock()
    }
  }

  return {
    async search(request) {
      if (request.signal?.aborted === true) throw new AIClientError('AI_CANCELLED')
      let baseUrl: string
      try {
        baseUrl = normalizeAIBaseUrl(request.baseUrl)
      } catch {
        throw new Error('INVALID_AI_SEARCH_REQUEST')
      }
      const model = request.model.trim()
      const input = request.input.trim()
      if (model.length === 0 || model.length > 200 || input.length === 0 || input.length > 200_000) {
        throw new Error('INVALID_AI_SEARCH_REQUEST')
      }
      const requestedTokens = request.maxOutputTokens ?? RESPONSES_DEFAULT_OUTPUT_TOKENS
      const maxOutputTokens = Math.max(RESPONSES_MIN_OUTPUT_TOKENS, Math.min(requestedTokens, 65_536))

      const controller = new AbortController()
      let timedOut = false
      let callerAborted = false
      // Inactivity window, reset by every received chunk, with an absolute backstop. A fixed deadline
      // aborts a slow-but-healthy hosted search, which is the opposite of what a timeout is for.
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const armIdleTimer = (): void => {
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, idleTimeoutMs)
      }
      armIdleTimer()
      const absoluteTimer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, maxRequestMs)
      const onAbort = (): void => {
        callerAborted = true
        controller.abort()
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        const useStreaming = request.streamingSupported !== false
        for (const url of resolveEndpointCandidates(baseUrl, 'responses')) {
          const response = await requestOnce(url, request, maxOutputTokens, useStreaming, controller)
          if (controller.signal.aborted) {
            await response.body?.cancel().catch(() => undefined)
            throw new Error('ABORTED')
          }
          if (response.status === 404) {
            await response.body?.cancel().catch(() => undefined)
            continue
          }
          if (response.status === 400 || response.status === 422) {
            const text = await readBounded(response, 32_000, controller.signal, armIdleTimer).catch(() => '')
            if (namesWebSearchRefusal(response.status, text)) {
              throw new AIResponsesUnsupportedError('web_search_tool', response.status)
            }
            throw statusError(response.status)
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined)
            throw statusError(response.status)
          }
          if (response.redirected) {
            await response.body?.cancel().catch(() => undefined)
            throw new AIClientError('AI_INVALID_RESPONSE')
          }
          const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
          if (!useStreaming || !contentType.includes('text/event-stream')) {
            const text = await readBounded(response, maxResponseBytes, controller.signal, armIdleTimer)
            try {
              return { ...parseOpenAIResponsesJson(JSON.parse(text)), streamingSupported: false }
            } catch (error) {
              throw parseError(error)
            }
          }
          return await readStream(response, request, controller, armIdleTimer)
        }
        throw new AIResponsesUnsupportedError('responses_endpoint', 404)
      } catch (error) {
        if (callerAborted) throw new AIClientError('AI_CANCELLED')
        if (timedOut) throw new AIClientError('AI_TIMEOUT')
        if (error instanceof AIResponsesUnsupportedError) throw error
        if (error instanceof AIClientError) throw error
        throw new AIClientError('AI_NETWORK_ERROR')
      } finally {
        clearTimeout(idleTimer)
        clearTimeout(absoluteTimer)
        request.signal?.removeEventListener('abort', onAbort)
      }
    }
  }
}
