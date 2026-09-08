import { describe, expect, it, vi } from 'vitest'

import { AIClientError } from '@main/services/openai-compatible.client'
import { createOpenAIResponsesClient } from '@main/services/openai-responses.client'

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

function jsonResponse(): Response {
  return new Response(JSON.stringify(completedResponse), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('OpenAI-compatible Responses client', () => {
  it('sends only the bounded built-in web search request and parses citations', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse())
    const client = createOpenAIResponsesClient({ fetch: fetcher })

    await expect(client.search({
      baseUrl: 'https://api.x.ai/v1/chat/completions',
      model: 'grok-4.6',
      apiKey: 'secret',
      input: 'Find evidence',
      allowedDomains: ['pubmed.ncbi.nlm.nih.gov'],
      streamingSupported: false
    })).resolves.toEqual({
      content: 'Evidence [1].',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }],
      searched: true,
      streamingSupported: false
    })

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.x.ai/v1/responses')
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer secret'
    })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'grok-4.6',
      input: 'Find evidence',
      tools: [{
        type: 'web_search',
        filters: { allowed_domains: ['pubmed.ncbi.nlm.nih.gov'] }
      }]
    })
  })

  it('parses streaming deltas and reports streaming support', async () => {
    const body =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","delta":"Evidence [1]."}\n\n' +
      'event: response.completed\n' +
      `data: ${JSON.stringify({ type: 'response.completed', response: completedResponse })}\n\n`
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
    const deltas: string[] = []
    const client = createOpenAIResponsesClient({ fetch: vi.fn().mockResolvedValue(response) })

    await expect(client.search({
      baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', input: 'Find evidence',
      onContentDelta: (delta) => deltas.push(delta)
    })).resolves.toMatchObject({ streamingSupported: true, searched: true })
    expect(deltas).toEqual(['Evidence [1].'])
  })

  it.each([
    [401, 'AI_AUTH_ERROR'],
    [404, 'AI_MODEL_NOT_FOUND'],
    [429, 'AI_RATE_LIMITED'],
    [500, 'AI_PROVIDER_ERROR']
  ])('maps HTTP %i without exposing the provider body', async (status, code) => {
    const client = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(new Response('secret provider detail', { status }))
    })
    let error: unknown
    try {
      await client.search({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', input: 'x' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(AIClientError)
    expect(error).toMatchObject({ code })
    expect(String(error)).not.toContain('secret provider detail')
  })

  it('rejects an already aborted request without starting a network call', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockResolvedValue(jsonResponse())
    const client = createOpenAIResponsesClient({ fetch: fetcher })
    await expect(client.search({
      baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', input: 'x', signal: controller.signal
    })).rejects.toMatchObject({ code: 'AI_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
