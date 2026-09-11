import {
  AIClientError,
  createOpenAICompatibleClient,
  type AIChatCompletionRequest
} from '@main/services/openai-compatible.client'
import {
  createAssistantMessageExtractor,
  createSseChatCompletionParser
} from '@main/services/openai-stream.parser'

const encoder = new TextEncoder()
const envelope = '{"assistantMessage":"Hello \u4e16\u754c \ud83d\ude00","rollingSummary":"safe","questionnaire":{}}'

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

function toolChunk(toolCalls: unknown, finishReason: string | null = null): string {
  return JSON.stringify({
    choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: finishReason }]
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

function toolResponse(argumentsValue: unknown = envelope, content: unknown = null): Response {
  return new Response(JSON.stringify({
    choices: [{
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'submit_questionnaire', arguments: argumentsValue }
        }]
      }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function contentResponse(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function toolChoice(index?: number, finishReason = 'tool_calls'): object {
  return {
    ...(index === undefined ? {} : { index }),
    finish_reason: finishReason,
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        type: 'function',
        function: { name: 'submit_questionnaire', arguments: envelope }
      }]
    }
  }
}

function errorResponse(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'content-type': 'application/json' } })
}

function errorCode(error: unknown): string | undefined {
  return error instanceof AIClientError ? error.code : undefined
}

describe('OpenAI-compatible bounded streaming transport', () => {
  it('accepts ordinary content for a generic connection check without a schema version', async () => {
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
      responseFormatSupported: false,
      toolCallingSupported: false
    })
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body).not.toHaveProperty('response_format')
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('forces and extracts one non-streaming questionnaire function call with empty assistant content', async () => {
    const fetcher = vi.fn().mockResolvedValue(toolResponse(envelope, ''))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({ streamingSupported: false }))).resolves.toEqual({
      content: envelope,
      streamingSupported: false,
      responseFormatSupported: true,
      toolCallingSupported: true
    })
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      response_format: { type: 'json_object' },
      tools: [{
        type: 'function',
        function: {
          name: 'submit_questionnaire',
          parameters: expect.objectContaining({
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'assistantMessage', 'rollingSummary', 'options', 'questionnaire']
          })
        }
      }],
      tool_choice: { type: 'function', function: { name: 'submit_questionnaire' } }
    })
    expect(body.tools[0].function).not.toHaveProperty('strict')
    expect(body.messages).toEqual([{ role: 'user', content: 'build it' }])
  })

  it.each([
    ['wrong function name', { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'other', arguments: envelope } }] } }] }],
    ['missing tool call', { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [] } }] }],
    ['duplicate tool calls', { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [
      { type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } },
      { type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }
    ] } }] }],
    ['non-string arguments', { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'submit_questionnaire', arguments: {} } }] } }] }],
    ['empty arguments', { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'submit_questionnaire', arguments: '' } }] } }] }],
    ['refusal', { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, refusal: 'no', tool_calls: [{ type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }] } }] }],
    ['content mixed with arguments', { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: envelope, tool_calls: [{ type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }] } }] }]
  ])('rejects malformed non-streaming function-call payloads: %s', async (_name, body) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' }
      }))
    })

    await expect(client.complete(request({ streamingSupported: false })))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('normalizes a Responses Base URL back to the Chat Completions endpoint', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(toolResponse()))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({
      baseUrl: 'https://api.openai.com/v1/responses',
      streamingSupported: false,
      responseFormatSupported: false
    }))

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions')
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
      responseFormatSupported: true,
      toolCallingSupported: false
    })
    expect(started).toHaveBeenCalledOnce()
    expect(deltas.join('')).toBe('Hello 世界 😀')
    expect(deltas.every((value) => !value.includes('rollingSummary'))).toBe(true)
  })

  it('rejects questionnaire content before emitting an assistant delta', async () => {
    const deltas = vi.fn()
    const response = streamingResponse([sse(
      chunk(envelope),
      chunk(undefined, 'stop'),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })

    await expect(client.complete(request({ onContentDelta: deltas })))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
    expect(deltas).not.toHaveBeenCalled()
  })

  it('assembles one streamed questionnaire function call after an empty content delta without emitting partial content', async () => {
    const splitAt = 31
    const started = vi.fn()
    const deltas = vi.fn()
    const response = streamingResponse([sse(
      JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
      chunk(''),
      toolChunk([{
        index: 0,
        id: 'call_1',
        type: 'function',
        function: { name: 'submit_questionnaire', arguments: envelope.slice(0, splitAt) }
      }]),
      toolChunk([{
        index: 0,
        function: { arguments: envelope.slice(splitAt) }
      }]),
      chunk(undefined, 'tool_calls'),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })

    await expect(client.complete(request({
      onModelStreaming: started,
      onContentDelta: deltas
    }))).resolves.toEqual({
      content: envelope,
      streamingSupported: true,
      responseFormatSupported: true,
      toolCallingSupported: true
    })
    expect(started).toHaveBeenCalledOnce()
    expect(deltas).not.toHaveBeenCalled()
  })

  it('accepts a large UTF-8 questionnaire function call within the harness character limit', async () => {
    const largeEnvelope = JSON.stringify({ questionnaire: '问'.repeat(1_100_000) })
    const response = streamingResponse([sse(
      toolChunk([{
        index: 0,
        id: 'call_large',
        type: 'function',
        function: { name: 'submit_questionnaire', arguments: largeEnvelope }
      }]),
      chunk(undefined, 'tool_calls'),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })

    await expect(client.complete(request())).resolves.toMatchObject({
      content: largeEnvelope,
      streamingSupported: true,
      toolCallingSupported: true
    })
  })

  it.each([
    ['nonzero first call index', [toolChunk([{ index: 1, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }])]],
    ['changing call index', [
      toolChunk([{ index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope.slice(0, 10) } }]),
      toolChunk([{ index: 1, function: { arguments: envelope.slice(10) } }])
    ]],
    ['multiple calls', [toolChunk([
      { index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } },
      { index: 1, type: 'function', function: { name: 'submit_questionnaire', arguments: '{}' } }
    ])]],
    ['wrong function name', [toolChunk([{ index: 0, type: 'function', function: { name: 'other', arguments: envelope } }])]],
    ['legacy function call', [JSON.stringify({
      choices: [{ index: 0, delta: { function_call: { name: 'submit_questionnaire', arguments: envelope } }, finish_reason: null }]
    })]],
    ['content mixed with arguments', [
      toolChunk([{ index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }]),
      chunk('late')
    ]],
    ['refusal mixed with arguments', [
      toolChunk([{ index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }]),
      JSON.stringify({ choices: [{ index: 0, delta: { refusal: 'no' }, finish_reason: null }] })
    ]],
    ['non-string argument fragment', [toolChunk([{
      index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: {} }
    }])]],
    ['wrong terminal reason', [toolChunk([{
      index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope }
    }])], 'stop'],
    ['data after terminal', [
      toolChunk([{ index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }], 'tool_calls'),
      toolChunk([{ index: 0, function: { arguments: 'late' } }])
    ]]
  ])('rejects invalid streamed questionnaire tool calls: %s', async (_name, events, finishReason = 'tool_calls') => {
    const body = sse(...events, chunk(undefined, finishReason), '[DONE]')
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([body]))
    })

    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('bounds streamed questionnaire arguments by the stream content character limit', async () => {
    const body = sse(
      toolChunk([{ index: 0, type: 'function', function: { name: 'submit_questionnaire', arguments: envelope } }]),
      chunk(undefined, 'tool_calls'),
      '[DONE]'
    )
    const client = createOpenAICompatibleClient({
      maxStreamContentCharacters: envelope.length - 1,
      fetch: vi.fn().mockResolvedValue(streamingResponse([body]))
    })

    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_RESPONSE_TOO_LARGE' })
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
    const contentEvent = `data: ${chunk('😀')}\n\n`
    const parser = createSseChatCompletionParser({
      maxEventCount: 3,
      maxEventBytes: encoder.encode(contentEvent).byteLength,
      maxPartialBytes: encoder.encode(contentEvent).byteLength,
      maxContentCharacters: 10
    })
    expect(parser.push(encoder.encode(
      contentEvent + `data: ${chunk(undefined, 'stop')}\n\ndata: [DONE]\n\n`
    ))).toEqual([{ content: '😀', sequence: 1 }])
    expect(parser.finish().content).toBe('😀')
  })

  it.each([
    ['multiple choices', JSON.stringify({ choices: [
      { index: 0, delta: { content: 'a' }, finish_reason: null },
      { index: 1, delta: { content: 'b' }, finish_reason: null }
    ] })],
    ['a non-zero choice', JSON.stringify({ choices: [{ index: 1, delta: { content: 'a' }, finish_reason: null }] })],
    ['a content choice without index zero', JSON.stringify({ choices: [{ delta: { content: envelope }, finish_reason: null }] })],
    ['tool calls', JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [] }, finish_reason: null }] })],
    ['function calls', JSON.stringify({ choices: [{ index: 0, delta: { function_call: {} }, finish_reason: null }] })],
    ['refusal payloads', JSON.stringify({ choices: [{ index: 0, delta: { refusal: 'no' }, finish_reason: null }] })],
    ['non-stop terminal reasons', chunk(undefined, 'length')],
    ['malformed event JSON', '{not-json']
  ])('rejects %s', async (_name, event) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(event, chunk(undefined, 'stop'), '[DONE]')]))
    })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
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
    expect(extractor.finish()).toBe('safe \n 😀 你好')
    expect(emitted.join('')).toBe('safe \n 😀 你好')
    expect(emitted.join('')).not.toContain('SECRET')
    expect(emitted.join('')).not.toContain('also secret')
  })

  it('rejects duplicate root keys before any final reconciliation', async () => {
    const duplicate = '{"assistantMessage":"safe","rollingSummary":"x","assistantMessage":"evil","questionnaire":{}}'
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(chunk(duplicate), chunk(undefined, 'stop'), '[DONE]')]))
    })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('rejects a streamed assistantMessage that does not reconcile with the final root value', async () => {
    const withoutAssistant = '{"rollingSummary":"x","questionnaire":{}}'
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(streamingResponse([sse(chunk(withoutAssistant), chunk(undefined, 'stop'), '[DONE]')]))
    })
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('bounds callback deltas without splitting a surrogate pair', async () => {
    const message = `${'a'.repeat(4095)}😀b`
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

  it('parses a complete JSON response to stream:true without a second generation', async () => {
    const fallback = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(toolResponse())
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ onCapabilityFallback: fallback }))).resolves.toEqual({
      content: envelope,
      streamingSupported: false,
      responseFormatSupported: true,
      toolCallingSupported: true
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledWith('streaming')
    const init = fetcher.mock.calls[0]?.[1]
    expect(init).toBeDefined()
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stream: true,
      response_format: { type: 'json_object' }
    })
  })

  it.each([
    [400, JSON.stringify({
      error: {
        message: 'Unknown parameter: tools',
        param: 'tools',
        code: 'unknown_parameter'
      }
    })],
    [422, 'tool_choice is not supported'],
    [400, JSON.stringify({
      error: {
        message: 'response_format cannot be used with tools',
        param: 'response_format',
        code: 'invalid_request_error'
      }
    })]
  ])('retries an explicit %i unsupported-tools response once in strict JSON content mode', async (status, errorBody) => {
    const fallback = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(errorResponse(status, errorBody))
      .mockResolvedValueOnce(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({
      streamingSupported: false,
      onCapabilityFallback: fallback
    }))).resolves.toEqual({
      content: envelope,
      streamingSupported: false,
      responseFormatSupported: true,
      toolCallingSupported: false
    })
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledWith('function_call')
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies[0]).toMatchObject({
      response_format: { type: 'json_object' },
      tools: [{ type: 'function', function: { name: 'submit_questionnaire' } }],
      tool_choice: { type: 'function', function: { name: 'submit_questionnaire' } }
    })
    expect(bodies[0].messages).toEqual([{ role: 'user', content: 'build it' }])
    expect(bodies[1]).toMatchObject({ response_format: { type: 'json_object' } })
    expect(bodies[1]).not.toHaveProperty('tools')
    expect(bodies[1]).not.toHaveProperty('tool_choice')
    const fallbackInstruction = bodies[1].messages.at(-1)
    expect(fallbackInstruction).toMatchObject({ role: 'system' })
    expect(fallbackInstruction.content).toContain('No extra fields')
    const fallbackSchema = JSON.parse(fallbackInstruction.content.slice(
      fallbackInstruction.content.indexOf('{')
    ))
    expect(fallbackSchema).toMatchObject({
      additionalProperties: false,
      required: ['kind', 'assistantMessage', 'rollingSummary', 'options', 'questionnaire'],
      properties: {
        kind: { enum: ['clarification', 'questionnaire'] },
        questionnaire: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            questions: { items: { additionalProperties: false, properties: {
              type: { enum: ['single_choice', 'multiple_choice', 'fixed_length', 'free_text', 'numeric_range', 'date'] },
              constraint: { additionalProperties: false, properties: {
                type: { enum: ['none', 'integer', 'decimal', 'chinese', 'english', 'alphanumeric', 'date', 'regex'] },
                fixedLength: { type: ['integer', 'null'] },
                minValue: { type: ['number', 'null'] },
                maxValue: { type: ['number', 'null'] },
                step: { type: ['number', 'null'] }
              } },
              defaultValue: { type: ['string', 'null'] },
              skipValue: { type: ['string', 'null'] },
              order: { type: 'integer' }
            } } },
            conditionRules: { items: { additionalProperties: false, properties: {
              conditions: { items: { additionalProperties: false, properties: {
                operator: { enum: ['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'not_contains', 'is_empty', 'is_not_empty'] }
              } } },
              logic: { enum: ['AND', 'OR'] },
              action: { enum: ['skip', 'show', 'require'] }
            } } }
          }
        }
      }
    })
  })

  it('starts cached unsupported function calling directly in strict JSON content mode', async () => {
    const fallback = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(contentResponse(envelope))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({
      streamingSupported: false,
      toolCallingSupported: false,
      onCapabilityFallback: fallback
    }))).resolves.toEqual({
      content: envelope,
      streamingSupported: false,
      responseFormatSupported: true,
      toolCallingSupported: false
    })
    expect(fallback).not.toHaveBeenCalled()
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ response_format: { type: 'json_object' } })
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body.messages.at(-1)).toMatchObject({
      role: 'system', content: expect.stringContaining('No extra fields')
    })
  })

  it('streams cached unsupported function calling through strict bounded JSON content mode', async () => {
    const fetcher = vi.fn().mockResolvedValue(streamingResponse([
      sse(chunk(envelope), chunk(undefined, 'stop'), '[DONE]')
    ]))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await expect(client.complete(request({ toolCallingSupported: false }))).resolves.toEqual({
      content: envelope,
      streamingSupported: true,
      responseFormatSupported: true,
      toolCallingSupported: false
    })
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ stream: true, response_format: { type: 'json_object' } })
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('disables DeepSeek default thinking without adding provider extensions elsewhere', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(toolResponse()))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({
      baseUrl: 'https://api.deepseek.com',
      streamingSupported: false,
      responseFormatSupported: false
    }))
    await client.complete(request({
      baseUrl: 'https://example.test/v1',
      streamingSupported: false,
      responseFormatSupported: false
    }))

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      thinking: { type: 'disabled' }
    })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).not.toHaveProperty('thinking')
  })

  it('forces JSON object mode for questionnaire tools across provider policies', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(toolResponse()))
    const client = createOpenAICompatibleClient({ fetch: fetcher })

    await client.complete(request({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      streamingSupported: false
    }))
    await client.complete(request({
      providerId: 'deepseek',
      baseUrl: 'https://gateway.example/v1',
      streamingSupported: false
    }))

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).response_format)
      .toEqual({ type: 'json_object' })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).response_format)
      .toEqual({ type: 'json_object' })
  })

  it('treats null refusal payloads as unused in JSON and SSE responses', async () => {
    const jsonBody = JSON.parse(await toolResponse().text())
    jsonBody.choices[0].message.refusal = null
    const json = new Response(JSON.stringify(jsonBody), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
    const stream = streamingResponse([sse(
      JSON.stringify({
        choices: [{
          index: 0,
          delta: { role: 'assistant', refusal: null, tool_calls: null },
          finish_reason: null
        }]
      }),
      chunk(envelope),
      chunk(undefined, 'stop'),
      '[DONE]'
    )])
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValueOnce(json).mockResolvedValueOnce(stream)
    })

    await expect(client.complete(request({ streamingSupported: false }))).resolves.toMatchObject({ content: envelope })
    await expect(client.complete(request({ schemaVersion: undefined })))
      .resolves.toMatchObject({ content: envelope })
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
      responseFormatSupported: true,
      toolCallingSupported: false
    })
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
      .mockResolvedValueOnce(toolResponse())
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
      .mockResolvedValueOnce(errorResponse(400, JSON.stringify({
        error: { message: 'Invalid parameter', param: 'stream', code: 'invalid_parameter' }
      })))
      .mockResolvedValueOnce(toolResponse())
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ onCapabilityFallback: (capability) => fallback.push(capability) })))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })

    expect(fallback).toEqual([])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
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
      .mockResolvedValueOnce(toolResponse())
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
      .mockResolvedValueOnce(toolResponse())
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ onCapabilityFallback: fallback })))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('honors caller-provided independent capability outcomes without a client-global cache', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(toolResponse()))
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await client.complete(request({ streamingSupported: false, responseFormatSupported: true }))
    await client.complete(request({ streamingSupported: true, responseFormatSupported: false }))
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1].body))
    expect(bodies[0]).toMatchObject({ response_format: expect.anything() })
    expect(bodies[0]).not.toHaveProperty('stream')
    expect(bodies[1]).toMatchObject({ stream: true, response_format: { type: 'json_object' } })
  })

  it.each([
    ['generic 400', () => Promise.resolve(errorResponse(400, 'bad request')), 'AI_PROVIDER_ERROR'],
    ['generic 422', () => Promise.resolve(errorResponse(422, 'unprocessable')), 'AI_PROVIDER_ERROR'],
    ['authentication failure', () => Promise.resolve(errorResponse(401, 'unauthorized')), 'AI_AUTH_ERROR'],
    ['quota failure', () => Promise.resolve(errorResponse(429, 'rate limited')), 'AI_RATE_LIMITED'],
    ['provider failure', () => Promise.resolve(errorResponse(500, 'server error')), 'AI_PROVIDER_ERROR'],
    ['network failure', () => Promise.reject(new Error('offline')), 'AI_NETWORK_ERROR'],
    ['nested tools schema error', () => Promise.resolve(errorResponse(400, JSON.stringify({
      error: {
        message: 'Unknown tools schema keyword: additionalProperties',
        param: 'tools',
        code: 'invalid_request_error'
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
    const fetcher = vi.fn().mockResolvedValue(toolResponse())
    const client = createOpenAICompatibleClient({ fetch: fetcher })
    await expect(client.complete(request({ signal: controller.signal }))).rejects.toMatchObject({ code: 'AI_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a non-positive callback bound at construction', () => {
    expect(() => createOpenAICompatibleClient({ maxCallbackDeltaCharacters: 0 })).toThrow()
  })

  it.each([
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

  it.each([
    ['zero choices', { choices: [] }],
    ['multiple choices', { choices: [toolChoice(0), toolChoice(1)] }],
    ['nonzero index', { choices: [toolChoice(2)] }],
    ['missing index', { choices: [toolChoice()] }],
    ['non-tool finish', { choices: [toolChoice(0, 'length')] }]
  ])('rejects invalid non-streaming choice metadata: %s', async (_name, body) => {
    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' }
      }))
    })
    await expect(client.complete(request({ streamingSupported: false }))).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })
})
