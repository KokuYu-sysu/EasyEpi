import {
  AIClientError,
  createOpenAICompatibleClient,
  type AIChatCompletionRequest,
  type OpenAICompatibleClientOptions
} from '@main/services/openai-compatible.client'
import {
  createAssistantMessageExtractor,
  createSseChatCompletionParser
} from '@main/services/openai-stream.parser'

const encoder = new TextEncoder()
const envelope = '{"assistantMessage":"Hello \u4e16\u754c \ud83d\ude00","rollingSummary":"safe","questionnaire":{}}'
const DEFAULT_COMPLETION_TOKENS = 65_536

function request(overrides: Partial<AIChatCompletionRequest> = {}): AIChatCompletionRequest {
  return {
    baseUrl: 'https://example.test/v1',
    model: 'model',
    messages: [{ role: 'user', content: 'build it' }],
    schemaVersion: 2,
    ...overrides
  }
}

function chunk(content?: string, finishReason: string | null = null, extra: object = {}): string {
  return JSON.stringify({
    choices: [{ index: 0, delta: content === undefined ? {} : { content }, finish_reason: finishReason }],
    ...extra
  })
}

function sse(...events: string[]): string {
  return events.map((event) => `data: ${event}\n\n`).join('')
}

function streamingResponse(parts: Array<string | Uint8Array>, contentType = 'text/event-stream'): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part)
      controller.close()
    }
  }), { status: 200, headers: { 'content-type': contentType } })
}

function contentResponse(content: string, finishReason: string | null = 'stop'): Response {
  return new Response(JSON.stringify({
    choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function errorResponse(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'content-type': 'application/json' } })
}

function requestBody(call: unknown[] | undefined): Record<string, unknown> {
  const init = call?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function requestHeaders(call: unknown[] | undefined): Record<string, string> {
  const init = call?.[1] as RequestInit | undefined
  return (init?.headers ?? {}) as Record<string, string>
}

/**
 * Function calling was removed from the questionnaire protocol: no request may carry tools,
 * tool_choice, or the retired `submit_questionnaire` function name.
 */
function expectNoToolPayload(body: Record<string, unknown>): void {
  expect(body).not.toHaveProperty('tools')
  expect(body).not.toHaveProperty('tool_choice')
  expect(JSON.stringify(body)).not.toContain('submit_questionnaire')
}

function errorCode(error: unknown): string | undefined {
  return error instanceof AIClientError ? error.code : undefined
}

describe('OpenAI-compatible Chat Completions transport', () => {
  it('never sends tools, tool_choice, or a questionnaire function name in any request shape', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({ streamingSupported: false }))
    await client.complete(request())
    await client.complete(request({ schemaVersion: undefined, outputMode: 'json_object', streamingSupported: false }))
    await client.complete(request({
      schemaVersion: undefined,
      streamingSupported: false,
      responseFormatSupported: false
    }))

    const bodies = fetcher.mock.calls.map(requestBody)
    expect(bodies).toHaveLength(4)
    for (const body of bodies) {
      expectNoToolPayload(body)
      expect(body).toHaveProperty('max_completion_tokens', DEFAULT_COMPLETION_TOKENS)
      expect(body).not.toHaveProperty('max_tokens')
    }
    // The only structured-output requests carry the documented JSON object mode.
    expect(bodies[0]).toHaveProperty('response_format', { type: 'json_object' })
    expect(bodies[1]).toHaveProperty('response_format', { type: 'json_object' })
    expect(bodies[2]).toHaveProperty('response_format', { type: 'json_object' })
    expect(bodies[3]).not.toHaveProperty('response_format')
  })

  it('sends JSON object mode and the exact envelope instruction for questionnaire generation', async () => {
    const fetcher = vi.fn().mockResolvedValue(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({ streamingSupported: false }))).resolves.toEqual({
      content: envelope,
      streamingSupported: false,
      responseFormatSupported: true
    })

    const body = requestBody(fetcher.mock.calls[0])
    expectNoToolPayload(body)
    expect(body).toMatchObject({ response_format: { type: 'json_object' } })
    expect(body.messages).toHaveLength(2)
    expect(body.messages).toEqual([
      { role: 'user', content: 'build it' },
      { role: 'system', content: expect.stringContaining('No extra fields') }
    ])
    const instruction = (body.messages as Array<{ role: string; content: string }>)[1]!
    const schema = JSON.parse(instruction.content.slice(instruction.content.indexOf('{')))
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ['kind', 'assistantMessage', 'rollingSummary', 'options', 'questionnaire'],
      properties: {
        kind: { enum: ['clarification', 'questionnaire'] },
        questionnaire: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            questions: {
              items: {
                additionalProperties: false,
                properties: {
                  type: {
                    enum: ['single_choice', 'multiple_choice', 'fixed_length', 'free_text', 'numeric_range', 'date']
                  },
                  constraint: {
                    additionalProperties: false,
                    properties: {
                      type: {
                        enum: ['none', 'integer', 'decimal', 'chinese', 'english', 'alphanumeric', 'date', 'regex']
                      },
                      fixedLength: { type: ['integer', 'null'] },
                      minValue: { type: ['number', 'null'] },
                      maxValue: { type: ['number', 'null'] },
                      step: { type: ['number', 'null'] }
                    }
                  },
                  defaultValue: { type: ['string', 'null'] },
                  skipValue: { type: ['string', 'null'] },
                  order: { type: 'integer' }
                }
              }
            },
            conditionRules: {
              items: {
                additionalProperties: false,
                properties: {
                  conditions: {
                    items: {
                      additionalProperties: false,
                      properties: {
                        operator: {
                          enum: ['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'not_contains', 'is_empty', 'is_not_empty']
                        }
                      }
                    }
                  },
                  logic: { enum: ['AND', 'OR'] },
                  action: { enum: ['skip', 'show', 'require'] }
                }
              }
            }
          }
        }
      }
    })
  })

  it('sends JSON object mode for outputMode json_object without the envelope instruction', async () => {
    const fetcher = vi.fn().mockResolvedValue(contentResponse('{"answer":"ok"}'))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({
      schemaVersion: undefined,
      outputMode: 'json_object',
      streamingSupported: false
    }))

    const body = requestBody(fetcher.mock.calls[0])
    expectNoToolPayload(body)
    expect(body).toMatchObject({ response_format: { type: 'json_object' } })
    expect(body.messages).toEqual([{ role: 'user', content: 'build it' }])
  })

  it('keeps JSON object mode for outputMode json_object even when response_format was reported unsupported', async () => {
    const fetcher = vi.fn().mockResolvedValue(contentResponse('{"answer":"ok"}'))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({
      schemaVersion: undefined,
      outputMode: 'json_object',
      responseFormatSupported: false,
      streamingSupported: false
    }))

    expectNoToolPayload(requestBody(fetcher.mock.calls[0]))
    expect(requestBody(fetcher.mock.calls[0])).toMatchObject({ response_format: { type: 'json_object' } })
  })

  it('omits response_format when structured output is known unsupported and JSON mode is off', async () => {
    const fetcher = vi.fn().mockResolvedValue(contentResponse('OK'))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete({
      baseUrl: 'https://example.test/v1',
      model: 'model',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      streamingSupported: false,
      responseFormatSupported: false
    })).resolves.toEqual({
      content: 'OK',
      streamingSupported: false,
      responseFormatSupported: false
    })

    const body = requestBody(fetcher.mock.calls[0])
    expectNoToolPayload(body)
    expect(body).not.toHaveProperty('response_format')
    expect(body).toHaveProperty('max_completion_tokens', DEFAULT_COMPLETION_TOKENS)
  })

  it('sends max_completion_tokens with the default limit and honours the per-request bound', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({ streamingSupported: false }))
    await client.complete(request({ streamingSupported: false, maxOutputTokens: 1_234 }))

    expect(requestBody(fetcher.mock.calls[0])).toHaveProperty('max_completion_tokens', DEFAULT_COMPLETION_TOKENS)
    expect(requestBody(fetcher.mock.calls[1])).toHaveProperty('max_completion_tokens', 1_234)
  })

  it('bounds a per-request token limit by the client completion limit', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher, completionTokenLimit: 500 })

    await client.complete(request({ streamingSupported: false }))
    await client.complete(request({ streamingSupported: false, maxOutputTokens: 900 }))

    expect(requestBody(fetcher.mock.calls[0])).toHaveProperty('max_completion_tokens', 500)
    expect(requestBody(fetcher.mock.calls[1])).toHaveProperty('max_completion_tokens', 500)
  })

  it.each([15, 1_000_001, 100.5, Number.NaN])(
    'rejects an out-of-range completion token limit at construction: %s',
    (completionTokenLimit) => {
      expect(() => createOpenAICompatibleClient({ completionTokenLimit }))
        .toThrow('INVALID_COMPLETION_TOKEN_LIMIT')
    }
  )

  it('accepts the documented completion token limit boundaries', () => {
    expect(() => createOpenAICompatibleClient({ completionTokenLimit: 16 })).not.toThrow()
    expect(() => createOpenAICompatibleClient({ completionTokenLimit: 1_000_000 })).not.toThrow()
  })

  it('negotiates an unsupported max_completion_tokens down to max_tokens and then to no parameter', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(400, JSON.stringify({
        error: {
          message: 'Unsupported parameter: max_completion_tokens',
          param: 'max_completion_tokens',
          code: 'unsupported_parameter'
        }
      })))
      .mockResolvedValueOnce(errorResponse(400, JSON.stringify({
        error: {
          message: 'Unsupported parameter: max_tokens',
          param: 'max_tokens',
          code: 'unsupported_parameter'
        }
      })))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({ streamingSupported: false })))
      .resolves.toMatchObject({ content: envelope })
    expect(fetcher).toHaveBeenCalledTimes(3)

    const bodies = fetcher.mock.calls.map(requestBody)
    expect(bodies[0]).toHaveProperty('max_completion_tokens', DEFAULT_COMPLETION_TOKENS)
    expect(bodies[0]).not.toHaveProperty('max_tokens')
    expect(bodies[1]).not.toHaveProperty('max_completion_tokens')
    expect(bodies[1]).toHaveProperty('max_tokens', DEFAULT_COMPLETION_TOKENS)
    expect(bodies[2]).not.toHaveProperty('max_completion_tokens')
    expect(bodies[2]).not.toHaveProperty('max_tokens')
    for (const body of bodies) expectNoToolPayload(body)
  })

  it('downgrades once from max_completion_tokens to max_tokens when only that parameter is rejected', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(422, JSON.stringify({
        error: { message: 'Unsupported parameter: max_completion_tokens', param: 'max_completion_tokens' }
      })))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({ streamingSupported: false, maxOutputTokens: 4_096 })))
      .resolves.toMatchObject({ content: envelope })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(requestBody(fetcher.mock.calls[1])).toHaveProperty('max_tokens', 4_096)
  })

  it('negotiates a rejected stream parameter once and retries without streaming', async () => {
    const fallback = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(400, JSON.stringify({
        error: { message: 'Unsupported parameter: stream', param: 'stream', code: 'unsupported_parameter' }
      })))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({ onCapabilityFallback: fallback }))).resolves.toEqual({
      content: envelope,
      streamingSupported: false,
      responseFormatSupported: true
    })
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledWith('streaming')
    const bodies = fetcher.mock.calls.map(requestBody)
    expect(bodies[0]).toMatchObject({ stream: true })
    expect(bodies[1]).not.toHaveProperty('stream')
    expect(bodies[1]).toMatchObject({ response_format: { type: 'json_object' } })
  })

  it('parses a complete JSON response to stream:true without a second generation', async () => {
    const fallback = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({ onCapabilityFallback: fallback }))).resolves.toEqual({
      content: envelope,
      streamingSupported: false,
      responseFormatSupported: true
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledWith('streaming')
    const body = requestBody(fetcher.mock.calls[0])
    expect(body).toMatchObject({
      stream: true,
      response_format: { type: 'json_object' },
      max_completion_tokens: DEFAULT_COMPLETION_TOKENS
    })
    expectNoToolPayload(body)
  })

  it('sends the bearer token only when a non-empty API key is configured', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({ streamingSupported: false, apiKey: 'sk-secret' }))
    await client.complete(request({ streamingSupported: false }))
    await client.complete(request({ streamingSupported: false, apiKey: '' }))

    expect(requestHeaders(fetcher.mock.calls[0])).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-secret'
    })
    expect(requestHeaders(fetcher.mock.calls[1])).toEqual({ 'content-type': 'application/json' })
    expect(requestHeaders(fetcher.mock.calls[2])).toEqual({ 'content-type': 'application/json' })
  })

  it('normalizes a Responses Base URL back to the Chat Completions endpoint', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({
      baseUrl: 'https://api.openai.com/v1/responses',
      streamingSupported: false,
      responseFormatSupported: false
    }))

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('sends JSON object mode for questionnaire generation on every host', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({ baseUrl: 'https://api.deepseek.com', streamingSupported: false }))
    await client.complete(request({ baseUrl: 'https://gateway.example/v1', streamingSupported: false }))

    for (const call of fetcher.mock.calls) {
      const body = requestBody(call)
      expect(body.response_format).toEqual({ type: 'json_object' })
      expectNoToolPayload(body)
    }
  })

  it('sends only documented Chat Completions fields with no provider-specific extensions', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({ baseUrl: 'https://api.deepseek.com', streamingSupported: false }))
    await client.complete(request({
      baseUrl: 'https://gateway.example/v1',
      streamingSupported: false,
      schemaVersion: undefined
    }))

    const jsonMode = requestBody(fetcher.mock.calls[0])
    const textMode = requestBody(fetcher.mock.calls[1])
    expect(Object.keys(jsonMode).sort()).toEqual(['max_completion_tokens', 'messages', 'model', 'response_format'])
    expect(Object.keys(textMode).sort()).toEqual(['max_completion_tokens', 'messages', 'model'])
  })

  // Function calling was removed from the protocol, so the streamed-response path only reconciles
  // the streamed `assistantMessage` with the structured deltas for questionnaire generation.
  it('reconciles the streamed assistantMessage with the envelope for questionnaire generation', async () => {
    const deltas: string[] = []
    const response = streamingResponse([sse(
      chunk(envelope),
      chunk(undefined, 'stop'),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })

    await expect(client.complete(request({
      onContentDelta: (delta) => deltas.push(delta.content)
    }))).resolves.toEqual({
      content: envelope,
      streamingSupported: true,
      responseFormatSupported: true
    })
    expect(deltas.join('')).toBe('Hello \u4e16\u754c \ud83d\ude00')
  })

  it('rejects a streamed assistantMessage that does not reconcile with the final root value', async () => {
    const withoutAssistant = '{"rollingSummary":"x","questionnaire":{}}'
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(
        chunk(withoutAssistant), chunk(undefined, 'stop'), '[DONE]'
      )]))
    })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('rejects duplicate root keys before any final reconciliation', async () => {
    const duplicate = '{"assistantMessage":"safe","rollingSummary":"x","assistantMessage":"evil","questionnaire":{}}'
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(
        chunk(duplicate), chunk(undefined, 'stop'), '[DONE]'
      )]))
    })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('accepts large streamed UTF-8 envelope content within the harness character limit', async () => {
    // 1,100,000 Chinese characters stay inside the 2,000,000-character stream content bound.
    const largeEnvelope = JSON.stringify({
      assistantMessage: 'ok',
      rollingSummary: '',
      questionnaire: '\u95ee'.repeat(1_100_000)
    })
    const response = streamingResponse([sse(
      chunk(largeEnvelope),
      chunk(undefined, 'stop'),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })

    await expect(client.complete(request())).resolves.toEqual({
      content: largeEnvelope,
      streamingSupported: true,
      responseFormatSupported: true
    })
  })

  it('preserves split UTF-8 and accepts CRLF/LF framing, comments, keepalives, role/usage/empty chunks, stop, and DONE', async () => {
    const bytes = encoder.encode(sse(
      JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
      chunk(envelope.slice(0, 27)),
      chunk(envelope.slice(27)),
      chunk(undefined),
      chunk(undefined, 'stop'),
      JSON.stringify({ choices: [], usage: { total_tokens: 12 } }),
      '[DONE]'
    ).replace('data: {"choices":[]', ': ping\r\n\r\ndata: {"choices":[]').replaceAll('\n\n', '\r\n\r\n'))
    const splitAt = bytes.findIndex((value, index) => value >= 0x80 && index > 0) + 1
    const deltas: string[] = []
    const started = vi.fn()
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([bytes.slice(0, splitAt), bytes.slice(splitAt)]))
    })

    const result = await client.complete(request({
      schemaVersion: undefined,
      onModelStreaming: started,
      onContentDelta: (delta) => deltas.push(delta.content)
    }))

    expect(result).toEqual({
      content: envelope,
      streamingSupported: true,
      responseFormatSupported: true
    })
    expect(started).toHaveBeenCalledOnce()
    expect(deltas.join('')).toBe('Hello \u4e16\u754c \ud83d\ude00')
    expect(deltas.every((value) => !value.includes('rollingSummary'))).toBe(true)
  })

  it('ignores null SSE content while a reasoning model emits hidden reasoning deltas', async () => {
    const stream = streamingResponse([sse(
      JSON.stringify({
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: null, reasoning_content: '' },
          finish_reason: null
        }]
      }),
      JSON.stringify({
        choices: [{
          index: 0,
          delta: { content: null, reasoning_content: 'hidden reasoning' },
          finish_reason: null
        }]
      }),
      chunk(envelope),
      JSON.stringify({
        choices: [{
          index: 0,
          delta: { content: '', reasoning_content: null },
          finish_reason: 'stop'
        }]
      }),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(stream) })

    await expect(client.complete(request({ schemaVersion: undefined }))).resolves.toEqual({
      content: envelope,
      streamingSupported: true,
      responseFormatSupported: true
    })
  })

  it('treats null refusal payloads as unused in JSON and SSE responses', async () => {
    const jsonBody = {
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: envelope, refusal: null } }]
    }
    const json = new Response(JSON.stringify(jsonBody), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
    const stream = streamingResponse([sse(
      JSON.stringify({
        choices: [{ index: 0, delta: { role: 'assistant', refusal: null }, finish_reason: null }]
      }),
      chunk(envelope),
      chunk(undefined, 'stop'),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValueOnce(json).mockResolvedValueOnce(stream)
    })

    await expect(client.complete(request({ streamingSupported: false })))
      .resolves.toMatchObject({ content: envelope })
    await expect(client.complete(request({ schemaVersion: undefined })))
      .resolves.toMatchObject({ content: envelope })
  })

  it('rejects invalid UTF-8 fatally', async () => {
    const prefix = encoder.encode(`data: ${chunk('{"assistantMessage":"')}\n\n`)
    const invalid = new Uint8Array([...prefix, 0xc3, 0x28])
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(streamingResponse([invalid])) })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('joins multiple data lines before parsing one SSE JSON event', () => {
    const parser = createSseChatCompletionParser({
      maxEventCount: 10, maxEventBytes: 1024, maxPartialBytes: 1024, maxContentCharacters: 1024
    })
    const event = 'data: {"choices":[{"index":0,\n' +
      'data: "delta":{"content":"ok"},"finish_reason":null}]}\n\n' +
      `data: ${chunk(undefined, 'stop')}\n\ndata: [DONE]\n\n`
    expect(parser.push(encoder.encode(event))).toEqual([{ content: 'ok', sequence: 1 }])
    expect(parser.finish()).toEqual({
      content: 'ok',
      choice: {
        choiceCount: 1,
        index: 0,
        finishReason: 'stop',
        content: 'ok',
        role: undefined,
        refusalPresent: false,
        toolCallPresent: false
      }
    })
  })

  it('counts an astral code point using its real UTF-8 event bytes', () => {
    const contentEvent = `data: ${chunk('\ud83d\ude00')}\n\n`
    const parser = createSseChatCompletionParser({
      maxEventCount: 3,
      maxEventBytes: encoder.encode(contentEvent).byteLength,
      maxPartialBytes: encoder.encode(contentEvent).byteLength,
      maxContentCharacters: 10
    })
    expect(parser.push(encoder.encode(
      contentEvent + `data: ${chunk(undefined, 'stop')}\n\ndata: [DONE]\n\n`
    ))).toEqual([{ content: '\ud83d\ude00', sequence: 1 }])
    expect(parser.finish().content).toBe('\ud83d\ude00')
  })

  it.each([
    ['multiple choices', JSON.stringify({ choices: [
      { index: 0, delta: { content: 'a' }, finish_reason: null },
      { index: 1, delta: { content: 'b' }, finish_reason: null }
    ] })],
    ['a non-zero choice', JSON.stringify({ choices: [{ index: 1, delta: { content: 'a' }, finish_reason: null }] })],
    ['a content choice without index zero', JSON.stringify({ choices: [{ delta: { content: envelope }, finish_reason: null }] })],
    ['refusal payloads', JSON.stringify({ choices: [{ index: 0, delta: { refusal: 'no' }, finish_reason: null }] })],
    ['malformed event JSON', '{not-json']
  ])('rejects %s', async (_name, event) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(event, chunk(undefined, 'stop'), '[DONE]')]))
    })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it.each([
    ['length', 'length'],
    ['max_tokens', 'max_tokens']
  ])('rejects a truncated stream that ends with finish_reason %s', async (_name, finishReason) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(
        chunk(envelope), chunk(undefined, finishReason), '[DONE]'
      )]))
    })
    // This transport reports every non-`stop` terminal as unusable; AI_RESPONSE_TRUNCATED is
    // produced by the Responses client for its own truncation signal.
    const error = await client.complete(request()).catch((caught: unknown) => caught)
    expect(['AI_RESPONSE_TRUNCATED', 'AI_INVALID_RESPONSE']).toContain(errorCode(error))
  })

  it.each([
    ['missing DONE', sse(chunk(envelope), chunk(undefined, 'stop'))],
    ['missing stop', sse(chunk(envelope), '[DONE]')],
    ['unfinished event', `data: ${chunk(envelope)}`],
    ['empty EOF', ''],
    ['content after terminal', sse(chunk(envelope), chunk(undefined, 'stop'), chunk('late'), '[DONE]')],
    ['data after DONE', sse(chunk(envelope), chunk(undefined, 'stop'), '[DONE]', chunk('late'))]
  ])('rejects malformed or unfinished streams: %s', async (_name, body) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([body]))
    })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('extracts only the first root assistantMessage with escapes and surrogate pairs across chunk boundaries', () => {
    const extractor = createAssistantMessageExtractor(100)
    const leaked = [
      '{"questionnaire":{"assistantMessage":"SECRET"},',
      '"options":[{"label":"also secret"}],"other":"assistantMessage: fake",',
      '"assistantMes',
      'sage":"safe \\n \\uD83D',
      '\\uDE00 \\u4F60\\u597D"}'
    ]
    const emitted = leaked.flatMap((part) => extractor.push(part))
    expect(extractor.finish()).toBe('safe \n \ud83d\ude00 \u4f60\u597d')
    expect(emitted.join('')).toBe('safe \n \ud83d\ude00 \u4f60\u597d')
    expect(emitted.join('')).not.toContain('SECRET')
    expect(emitted.join('')).not.toContain('also secret')
  })

  it('bounds callback deltas without splitting a surrogate pair', async () => {
    const message = `${'a'.repeat(4095)}\ud83d\ude00b`
    const content = JSON.stringify({ assistantMessage: message, rollingSummary: '', questionnaire: {} })
    const deltas: string[] = []
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(chunk(content), chunk(undefined, 'stop'), '[DONE]')]))
    })
    await client.complete(request({
      schemaVersion: undefined,
      onContentDelta: (delta) => deltas.push(delta.content)
    }))
    expect(deltas.join('')).toBe(message)
    expect(deltas.every((delta) => delta.length <= 4096)).toBe(true)
    expect(deltas.every((delta) => {
      const first = delta.charCodeAt(0)
      const last = delta.charCodeAt(delta.length - 1)
      return !(first >= 0xdc00 && first <= 0xdfff) && !(last >= 0xd800 && last <= 0xdbff)
    })).toBe(true)
  })

  it.each([
    ['zero choices', { choices: [] }],
    ['multiple choices', { choices: [
      { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'a' } },
      { index: 1, finish_reason: 'stop', message: { role: 'assistant', content: 'b' } }
    ] }],
    ['nonzero index', { choices: [
      { index: 2, finish_reason: 'stop', message: { role: 'assistant', content: envelope } }
    ] }],
    ['missing index', { choices: [
      { finish_reason: 'stop', message: { role: 'assistant', content: envelope } }
    ] }],
    ['empty content', { choices: [
      { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }
    ] }],
    ['a refusal', { choices: [
      { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: envelope, refusal: 'no' } }
    ] }]
  ])('rejects invalid non-streaming choice metadata: %s', async (_name, body) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' }
      }))
    })
    await expect(client.complete(request({ streamingSupported: false })))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it.each([
    ['length', 'length'],
    ['max_tokens', 'max_tokens'],
    ['repetition_truncation', 'repetition_truncation']
  ])('maps a %s finish reason to recoverable truncation', async (_name, finishReason) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [
        { index: 0, finish_reason: finishReason, message: { role: 'assistant', content: envelope } }
      ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    // Truncation is recoverable: the orchestrator re-asks for a smaller questionnaire.
    await expect(client.complete(request({ streamingSupported: false })))
      .rejects.toMatchObject({ code: 'AI_RESPONSE_TRUNCATED' })
  })

  it.each<[string, () => Promise<Response>, string]>([
    ['generic 400', () => Promise.resolve(errorResponse(400, 'bad request')), 'AI_PROVIDER_ERROR'],
    ['generic 422', () => Promise.resolve(errorResponse(422, 'unprocessable')), 'AI_PROVIDER_ERROR'],
    ['authentication failure', () => Promise.resolve(errorResponse(401, 'unauthorized')), 'AI_AUTH_ERROR'],
    ['forbidden', () => Promise.resolve(errorResponse(403, 'forbidden')), 'AI_AUTH_ERROR'],
    ['unknown model', () => Promise.resolve(errorResponse(404, 'no model')), 'AI_MODEL_NOT_FOUND'],
    ['quota failure', () => Promise.resolve(errorResponse(429, 'rate limited')), 'AI_RATE_LIMITED'],
    ['provider failure', () => Promise.resolve(errorResponse(500, 'server error')), 'AI_PROVIDER_ERROR'],
    ['network failure', () => Promise.reject(new Error('offline')), 'AI_NETWORK_ERROR'],
    ['an unrelated rejected parameter', () => Promise.resolve(errorResponse(400, JSON.stringify({
      error: {
        message: 'Invalid parameter temperature',
        param: 'temperature',
        code: 'invalid_parameter'
      }
    }))), 'AI_PROVIDER_ERROR'],
    ['malformed SSE', () => Promise.resolve(streamingResponse([sse('{bad')])), 'AI_INVALID_RESPONSE'],
    ['empty EOF', () => Promise.resolve(streamingResponse([''])), 'AI_INVALID_RESPONSE']
  ])('does not retry or downgrade %s', async (_name, respond, expectedCode) => {
    const fallback = vi.fn()
    const fetcher = vi.fn().mockImplementation(respond)
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ onCapabilityFallback: fallback })))
      .rejects.toMatchObject({ code: expectedCode })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('does not cache a transient response_format outage as unsupported', async () => {
    const fallbacks: string[] = []
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(400, JSON.stringify({
        error: {
          message: 'This response_format type is unavailable now',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_request_error'
        }
      })))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({
      streamingSupported: false,
      onCapabilityFallback: (capability) => fallbacks.push(capability)
    }))).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    expect(fallbacks).toEqual([])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('does not remove required JSON object mode after a response_format rejection', async () => {
    const fallback: string[] = []
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(422, JSON.stringify({
        error: { message: 'Unsupported parameter', param: 'response_format', code: 'unsupported_parameter' }
      })))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ onCapabilityFallback: (capability) => fallback.push(capability) })))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })

    expect(fallback).toEqual([])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(requestBody(fetcher.mock.calls[0])).toMatchObject({
      stream: true,
      response_format: { type: 'json_object' }
    })
  })

  it.each([
    ['response_format', JSON.stringify({
      error: {
        message: 'Invalid parameter temperature; response_format was present in the request',
        param: 'temperature',
        code: 'invalid_parameter'
      }
    })],
    ['streaming', JSON.stringify({
      error: {
        message: 'Invalid parameter temperature while stream was requested',
        param: 'temperature',
        code: 'invalid_parameter'
      }
    })]
  ])('does not disable %s when exact error metadata identifies another parameter', async (_name, body) => {
    const fallback = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(400, body))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ onCapabilityFallback: fallback })))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it.each([
    ['response_format', 'invalid parameter temperature; request also contained response_format'],
    ['streaming', 'invalid parameter temperature; stream was true']
  ])('does not disable %s from an incidental plain-text mention', async (_name, body) => {
    const fallback = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(422, body))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ onCapabilityFallback: fallback })))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('honors caller-provided independent capability outcomes without a client-global cache', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(contentResponse(envelope)))
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await client.complete(request({ streamingSupported: false, responseFormatSupported: true }))
    await client.complete(request({ streamingSupported: true, responseFormatSupported: false }))
    const bodies = fetcher.mock.calls.map(requestBody)
    expect(bodies[0]).toMatchObject({ response_format: expect.anything() })
    expect(bodies[0]).not.toHaveProperty('stream')
    expect(bodies[1]).toMatchObject({ stream: true, response_format: { type: 'json_object' } })
    for (const body of bodies) expectNoToolPayload(body)
  })

  it('does not retry a stream failure after accepting a delta', async () => {
    const fetcher = vi.fn().mockResolvedValue(streamingResponse([sse(chunk(envelope), '{bad')]))
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('times out, cancels the reader, and does not retry', async () => {
    const cancelled = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() { return new Promise(() => {}) },
      cancel: cancelled
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const fetcher = vi.fn().mockResolvedValue(response)
    const client = createOpenAICompatibleClient({ fetch: fetcher, timeoutMs: 5 })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('cancels the reader when the caller aborts', async () => {
    const cancelled = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() { return new Promise(() => {}) },
      cancel: cancelled
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const controller = new AbortController()
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })
    const pending = client.complete(request({ signal: controller.signal }))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' })
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('attaches reader cancellation before onModelStreaming can synchronously abort', async () => {
    let closeStream: (() => void) | undefined
    const cancelled = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { closeStream = () => controller.close() },
      cancel: cancelled
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const controller = new AbortController()
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })
    const completion = client.complete(request({
      signal: controller.signal,
      onModelStreaming: () => controller.abort()
    }))
    const outcome = await Promise.race([
      completion.catch((error: unknown) => errorCode(error)),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 25))
    ])
    if (outcome === 'hung') {
      closeStream?.()
      await completion.catch(() => undefined)
    }
    expect(outcome).toBe('AI_CANCELLED')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('handles a rejecting reader cancellation promise in the abort handler', async () => {
    let resolveRead: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined
    const cancellationCatch = vi.fn().mockResolvedValue(undefined)
    const cancel = vi.fn(() => {
      resolveRead?.({ done: true, value: undefined })
      return { catch: cancellationCatch } as unknown as Promise<void>
    })
    const reader = {
      read: () => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => { resolveRead = resolve }),
      cancel,
      releaseLock: vi.fn()
    }
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader: () => reader }
    } as unknown as Response
    const controller = new AbortController()
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })
    const completion = client.complete(request({
      signal: controller.signal,
      onModelStreaming: () => queueMicrotask(() => controller.abort())
    }))
    await expect(completion).rejects.toMatchObject({ code: 'AI_CANCELLED' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancellationCatch).toHaveBeenCalledOnce()
  })

  it('rejects an already-aborted request without starting a network call', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockResolvedValue(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ signal: controller.signal })))
      .rejects.toMatchObject({ code: 'AI_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a non-positive callback bound at construction', () => {
    expect(() => createOpenAICompatibleClient({ maxCallbackDeltaCharacters: 0 })).toThrow()
  })

  it.each<[string, Partial<OpenAICompatibleClientOptions>, string]>([
    ['total bytes', { maxResponseBytes: 32 }, sse(chunk(envelope), chunk(undefined, 'stop'), '[DONE]')],
    ['event bytes', { maxEventBytes: 20 }, sse(chunk(envelope), chunk(undefined, 'stop'), '[DONE]')],
    ['partial bytes', { maxPartialEventBytes: 20 }, `data: ${chunk(envelope)}`],
    ['event count', { maxEventCount: 1 }, sse(chunk(envelope), chunk(undefined, 'stop'), '[DONE]')],
    ['content characters', { maxStreamContentCharacters: 5 }, sse(chunk(envelope), chunk(undefined, 'stop'), '[DONE]')],
    ['assistant characters', { maxAssistantMessageCharacters: 5 }, sse(chunk(envelope), chunk(undefined, 'stop'), '[DONE]')]
  ])('enforces the %s limit', async (_name, limits, body) => {
    const client = createOpenAICompatibleClient({
      ...limits,
      fetch: vi.fn().mockResolvedValue(streamingResponse([body]))
    })
    await expect(client.complete(request())).rejects.toSatisfy((error: unknown) =>
      ['AI_RESPONSE_TOO_LARGE', 'AI_INVALID_RESPONSE'].includes(errorCode(error) ?? ''))
  })
})
