import { describe, expect, it, vi } from 'vitest'

import { AIClientError } from '@main/services/openai-compatible.client'
import {
  AIResponsesUnsupportedError,
  RESPONSES_MIN_OUTPUT_TOKENS,
  createOpenAIResponsesClient,
  type AIResponsesSearchRequest
} from '@main/services/openai-responses.client'

const completedResponse = {
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  output: [
    { type: 'web_search_call', id: 'search_1', status: 'completed' },
    {
      type: 'message', id: 'msg_1', role: 'assistant', status: 'completed',
      content: [{
        type: 'output_text', text: 'Evidence [1].',
        annotations: [{
          type: 'url_citation', url: 'https://pubmed.ncbi.nlm.nih.gov/123/',
          title: 'Study', start_index: 9, end_index: 12
        }]
      }]
    }
  ]
}

const publishedCitation = { url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }

function jsonResponse(response: unknown = completedResponse): Response {
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

function errorResponse(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'content-type': 'application/json' } })
}

function sseEvent(name: string, payload: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify({ type: name, ...payload })}\n\n`
}

function bodyOf(call: unknown[] | undefined): Record<string, unknown> {
  const init = call?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function headersOf(call: unknown[] | undefined): Record<string, string> {
  const init = call?.[1] as RequestInit | undefined
  return (init?.headers ?? {}) as Record<string, string>
}

async function captured(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => undefined, (error: unknown) => error)
}

function searchRequest(overrides: Partial<AIResponsesSearchRequest> = {}): AIResponsesSearchRequest {
  return {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    input: 'Find evidence',
    streamingSupported: false,
    ...overrides
  }
}

describe('OpenAI-compatible Responses client', () => {
  it('sends exactly the bounded built-in web search request and parses citations', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse())
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    await expect(client.search({
      baseUrl: 'https://api.x.ai/v1/chat/completions',
      model: 'grok-4.6',
      apiKey: 'secret',
      instructions: 'Answer in Chinese.',
      input: 'Find evidence',
      streamingSupported: false
    })).resolves.toEqual({
      content: 'Evidence [1].',
      citations: [publishedCitation],
      searched: true,
      status: 'completed',
      streamingSupported: false
    })

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.x.ai/v1/responses')
    expect(headersOf(fetcher.mock.calls[0])).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer secret'
    })
    const body = bodyOf(fetcher.mock.calls[0])
    expect(body).toEqual({
      model: 'grok-4.6',
      instructions: 'Answer in Chinese.',
      input: 'Find evidence',
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      max_output_tokens: 8_192
    })
    // Chat Completions-only and retired fields must never appear on the Responses body.
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('filters')
    expect(JSON.stringify(body)).not.toContain('max_completion_tokens')
    expect(JSON.stringify(body)).not.toContain('filters')
    expect(JSON.stringify(body)).not.toContain('allowed_domains')
  })

  it('omits optional fields and never sends an undefined key', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse())
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    await client.search(searchRequest({ instructions: undefined }))

    const body = bodyOf(fetcher.mock.calls[0])
    expect(Object.keys(body).sort()).toEqual(['input', 'max_output_tokens', 'model', 'tool_choice', 'tools'])
    expect(headersOf(fetcher.mock.calls[0])).toEqual({
      'content-type': 'application/json',
      accept: 'application/json'
    })
  })

  it('keeps the request body free of filters and max_completion_tokens while streaming', async () => {
    const fetcher = vi.fn().mockResolvedValue(sseResponse(
      sseEvent('response.completed', { response: completedResponse })
    ))
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    await client.search(searchRequest({ streamingSupported: true, instructions: 'Search PubMed first.' }))

    const body = bodyOf(fetcher.mock.calls[0])
    expect(Object.keys(body).sort()).toEqual([
      'input', 'instructions', 'max_output_tokens', 'model', 'stream', 'tool_choice', 'tools'
    ])
    expect(body).toMatchObject({
      stream: true,
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto'
    })
    expect(JSON.stringify(body)).not.toContain('filters')
    expect(JSON.stringify(body)).not.toContain('max_completion_tokens')
    expect(headersOf(fetcher.mock.calls[0])?.accept).toBe('text/event-stream')
  })

  it('never sends max_output_tokens below the documented floor', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse()))
    const client = createOpenAIResponsesClient({ fetch: fetcher })
    const cases: Array<[number | undefined, number]> = [
      [undefined, 8_192],
      [0, RESPONSES_MIN_OUTPUT_TOKENS],
      [1, 16],
      [-5, 16],
      [RESPONSES_MIN_OUTPUT_TOKENS, 16],
      [200, 200],
      [65_536, 65_536],
      [1_000_000, 65_536]
    ]

    for (const [maxOutputTokens] of cases) {
      await client.search(searchRequest({ maxOutputTokens }))
    }

    expect(RESPONSES_MIN_OUTPUT_TOKENS).toBe(16)
    const sent = fetcher.mock.calls.map((call) => bodyOf(call).max_output_tokens)
    expect(sent).toEqual(cases.map((entry) => entry[1]))
    expect(sent.every((value) => typeof value === 'number' && value >= RESPONSES_MIN_OUTPUT_TOKENS)).toBe(true)
  })

  it('parses streaming deltas and reports streaming support', async () => {
    const body =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","delta":"Evidence [1]."}\n\n' +
      'event: response.completed\n' +
      `data: ${JSON.stringify({ type: 'response.completed', response: completedResponse })}\n\n`
    const deltas: string[] = []
    const client = createOpenAIResponsesClient({ fetch: vi.fn().mockResolvedValue(sseResponse(body)) })

    await expect(client.search(searchRequest({
      streamingSupported: true,
      onContentDelta: (delta) => deltas.push(delta)
    }))).resolves.toEqual({
      content: 'Evidence [1].',
      citations: [publishedCitation],
      searched: true,
      status: 'completed',
      streamingSupported: true
    })
    expect(deltas).toEqual(['Evidence [1].'])
  })

  it('falls through to the alternate responses endpoint after a 404', async () => {
    const fetcher = vi.fn().mockImplementation((url: string) =>
      String(url).endsWith('/v1/responses')
        ? Promise.resolve(new Response('not found', { status: 404 }))
        : Promise.resolve(jsonResponse()))
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    await expect(client.search(searchRequest())).resolves.toMatchObject({
      content: 'Evidence [1].',
      searched: true,
      streamingSupported: false
    })
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/responses'
    ])
  })

  it('throws AIResponsesUnsupportedError when every candidate 404s', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    const error = await captured(client.search(searchRequest()))
    expect(error).toBeInstanceOf(AIResponsesUnsupportedError)
    expect(error).toMatchObject({
      reason: 'responses_endpoint',
      status: 404,
      message: 'AI_MODEL_NOT_FOUND'
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    [400, JSON.stringify({
      error: { message: 'The web_search tool is not supported for this model', param: 'tools', code: 'unsupported_tool' }
    })],
    [422, JSON.stringify({
      error: { message: 'web search is not enabled for this deployment', type: 'invalid_request_error' }
    })]
  ])('reports the hosted web_search tool as unsupported on HTTP %i', async (status, text) => {
    const fetcher = vi.fn().mockResolvedValue(errorResponse(status, text))
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    const error = await captured(client.search(searchRequest()))
    expect(error).toBeInstanceOf(AIResponsesUnsupportedError)
    expect(error).toMatchObject({
      reason: 'web_search_tool',
      status,
      message: 'AI_RESEARCH_UNSUPPORTED'
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each([
    [400, 'AI_PROVIDER_ERROR'],
    [422, 'AI_PROVIDER_ERROR'],
    [401, 'AI_AUTH_ERROR'],
    [403, 'AI_AUTH_ERROR'],
    [429, 'AI_RATE_LIMITED'],
    [500, 'AI_PROVIDER_ERROR']
  ])('maps HTTP %i without exposing the provider body', async (status, code) => {
    const client = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(errorResponse(status, 'secret provider detail'))
    })
    const error = await captured(client.search(searchRequest()))
    expect(error).toBeInstanceOf(AIClientError)
    expect(error).toMatchObject({ code })
    expect(String(error)).not.toContain('secret provider detail')
  })

  it('maps a truncated stream to AI_RESPONSE_TRUNCATED', async () => {
    const client = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(sseResponse(
        sseEvent('response.incomplete', { response: { id: 'resp_2', status: 'incomplete' } })
      ))
    })
    await expect(client.search(searchRequest({ streamingSupported: true })))
      .rejects.toMatchObject({ code: 'AI_RESPONSE_TRUNCATED' })
  })

  it('maps a failed stream to AI_INVALID_RESPONSE', async () => {
    const client = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(sseResponse(
        sseEvent('response.failed', { error: { code: 'server_error' } })
      ))
    })
    await expect(client.search(searchRequest({ streamingSupported: true })))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('rejects a redirected response', async () => {
    const response = jsonResponse()
    Object.defineProperty(response, 'redirected', { value: true })
    const client = createOpenAIResponsesClient({ fetch: vi.fn().mockResolvedValue(response) })

    await expect(client.search(searchRequest())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('enforces maxResponseBytes by declared content length and by streamed bytes', async () => {
    const declared = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(new Response(null, {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '4000001' }
      }))
    })
    await expect(declared.search(searchRequest()))
      .rejects.toMatchObject({ code: 'AI_RESPONSE_TOO_LARGE' })

    const streamed = createOpenAIResponsesClient({
      maxResponseBytes: 64,
      fetch: vi.fn().mockResolvedValue(sseResponse(
        sseEvent('response.output_text.delta', { delta: 'Evidence '.repeat(50) })
      ))
    })
    await expect(streamed.search(searchRequest({ streamingSupported: true })))
      .rejects.toMatchObject({ code: 'AI_RESPONSE_TOO_LARGE' })
  })

  it.each<[string, Partial<AIResponsesSearchRequest>]>([
    ['a non-https base URL', { baseUrl: 'http://example.com/v1' }],
    ['a malformed base URL', { baseUrl: 'not a url' }],
    ['an empty model', { model: '   ' }],
    ['an over-long model', { model: 'm'.repeat(201) }],
    ['empty input', { input: '   ' }],
    ['over-long input', { input: 'x'.repeat(200_001) }]
  ])('rejects %s before any network call', async (_name, overrides) => {
    const fetcher = vi.fn()
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    await expect(client.search(searchRequest(overrides) as AIResponsesSearchRequest))
      .rejects.toThrow('INVALID_AI_SEARCH_REQUEST')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('never promotes a prose-only citation list and drops unsafe urls', async () => {
    const proseOnly = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({
        id: 'resp_3',
        status: 'completed',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'See https://pubmed.ncbi.nlm.nih.gov/123/ for details.' }]
        }]
      }))
    })
    await expect(proseOnly.search(searchRequest())).resolves.toMatchObject({
      content: 'See https://pubmed.ncbi.nlm.nih.gov/123/ for details.',
      citations: [],
      searched: false
    })

    const unsafe = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({
        id: 'resp_4',
        status: 'completed',
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'Evidence [1].',
            annotations: [
              { type: 'url_citation', url: 'http://pubmed.ncbi.nlm.nih.gov/1/', title: 'Insecure' },
              { type: 'url_citation', url: 'https://user:pass@pubmed.ncbi.nlm.nih.gov/2/', title: 'Credentialed' },
              { type: 'url_citation', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' },
              { type: 'url_citation', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study again' }
            ]
          }]
        }]
      }))
    })
    await expect(unsafe.search(searchRequest())).resolves.toMatchObject({
      citations: [publishedCitation]
    })
  })

  it('rejects an already aborted request without starting a network call', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockResolvedValue(jsonResponse())
    const client = createOpenAIResponsesClient({ fetch: fetcher })
    await expect(client.search(searchRequest({ signal: controller.signal })))
      .rejects.toMatchObject({ code: 'AI_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports AI_CANCELLED when the caller aborts in flight', async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }))
    const client = createOpenAIResponsesClient({ fetch: fetcher })
    const controller = new AbortController()
    const pending = client.search(searchRequest({ signal: controller.signal }))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' })
  })

  it('reports AI_TIMEOUT when the deployment never answers', async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }))
    const client = createOpenAIResponsesClient({ fetch: fetcher, idleTimeoutMs: 5 })

    await expect(client.search(searchRequest())).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps a slow but active stream alive past the inactivity window', async () => {
    // A fixed deadline aborted healthy long-running hosted searches. Every received chunk must reset
    // the inactivity window, so a stream that keeps delivering is never mistaken for a hung one.
    const encoder = new TextEncoder()
    // 20 deliveries at 40 ms each: the total (≈840 ms) is far past the 400 ms window, while every
    // individual gap is ten times smaller than it. Without a reset per chunk this cannot pass.
    const deltas = Array.from({ length: 20 }, (_, index) =>
      `data: {"type":"response.output_text.delta","delta":"${String.fromCharCode(97 + (index % 26))}"}\n\n`)
    const events = [
      ...deltas,
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{
            type: 'message', id: 'm_1', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: deltas.map((_, index) => String.fromCharCode(97 + (index % 26))).join(''), annotations: [] }]
          }]
        }
      })}\n\n`
    ]
    const expected = deltas.map((_, index) => String.fromCharCode(97 + (index % 26))).join('')
    expect(events.length * 40).toBeGreaterThan(800)

    let index = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        if (index >= events.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(events[index]))
        index += 1
      }
    })

    const client = createOpenAIResponsesClient({
      idleTimeoutMs: 400,
      maxRequestMs: 20_000,
      fetch: vi.fn().mockResolvedValue(new Response(body, {
        status: 200, headers: { 'content-type': 'text/event-stream' }
      }))
    })

    await expect(client.search(searchRequest({ streamingSupported: true })))
      .resolves.toMatchObject({ content: expected })
  })

  it('keeps a slow non-streaming body alive past the inactivity window', async () => {
    // The planner, evidence and hosted-search stages all read a whole JSON body. Bytes arriving slowly
    // are still activity, so they must reset the window too.
    const payload = JSON.stringify({
      status: 'completed',
      output: [{
        type: 'message', id: 'm_1', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'slow', annotations: [] }]
      }]
    })
    const pieces = payload.match(/[\s\S]{1,8}/g)!
    expect(pieces.length * 40).toBeGreaterThan(600)

    let index = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        if (index >= pieces.length) {
          controller.close()
          return
        }
        controller.enqueue(new TextEncoder().encode(pieces[index]!))
        index += 1
      }
    })

    const client = createOpenAIResponsesClient({
      idleTimeoutMs: 400,
      maxRequestMs: 20_000,
      fetch: vi.fn().mockResolvedValue(new Response(body, {
        status: 200, headers: { 'content-type': 'application/json' }
      }))
    })

    await expect(client.search(searchRequest())).resolves.toMatchObject({ content: 'slow' })
  })
})
