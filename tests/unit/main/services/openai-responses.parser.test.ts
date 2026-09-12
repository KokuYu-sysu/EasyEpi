import { describe, expect, it } from 'vitest'

import {
  OpenAIResponsesParseError,
  createOpenAIResponsesSseParser,
  parseOpenAIResponsesJson,
  type AIResponsesSseParser,
  type AIResponsesSseParserOptions
} from '@main/services/openai-responses.parser'

const completedResponse = {
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  output: [
    { type: 'web_search_call', id: 'search_1', status: 'completed' },
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [{
        type: 'output_text',
        text: 'Evidence [1].',
        annotations: [{
          type: 'url_citation',
          url: 'https://pubmed.ncbi.nlm.nih.gov/123/',
          title: 'Study',
          start_index: 9,
          end_index: 12
        }]
      }]
    }
  ]
}

function messageItem(content: unknown[]): Record<string, unknown> {
  return { type: 'message', id: 'msg_x', role: 'assistant', status: 'completed', content }
}

function withAnnotations(annotations: unknown[], text = 'Evidence.'): Record<string, unknown> {
  return {
    ...completedResponse,
    output: [messageItem([{ type: 'output_text', text, annotations }])]
  }
}

function sseEvent(name: string, payload: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify({ type: name, ...payload })}\n\n`
}

function sseData(data: string): string {
  return `data: ${data}\n\n`
}

function createParser(overrides: Partial<AIResponsesSseParserOptions> = {}): AIResponsesSseParser {
  return createOpenAIResponsesSseParser({
    maxEventCount: 20,
    maxEventBytes: 200_000,
    maxPartialBytes: 200_000,
    maxContentCharacters: 1_000,
    ...overrides
  })
}

function pushed(body: string, overrides: Partial<AIResponsesSseParserOptions> = {}): string[] {
  return createParser(overrides).push(new TextEncoder().encode(body))
}

function thrownBy(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  return undefined
}

describe('OpenAI Responses parser', () => {
  it('extracts completed text, safe citations, and actual search use', () => {
    expect(parseOpenAIResponsesJson(completedResponse)).toEqual({
      content: 'Evidence [1].',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }],
      searched: true,
      status: 'completed'
    })
  })

  it('treats a missing status as completed', () => {
    const withoutStatus = structuredClone(completedResponse) as Record<string, unknown>
    delete withoutStatus.status
    expect(parseOpenAIResponsesJson(withoutStatus)).toEqual({
      content: 'Evidence [1].',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }],
      searched: true,
      status: 'completed'
    })
  })

  it('treats a null status as completed', () => {
    expect(parseOpenAIResponsesJson({ ...completedResponse, status: null }))
      .toMatchObject({ status: 'completed' })
  })

  it('rejects an unrecognized status', () => {
    expect(() => parseOpenAIResponsesJson({ ...completedResponse, status: 'queued' }))
      .toThrow(OpenAIResponsesParseError)
  })

  it('reports a failed response with its error code and no content', () => {
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      status: 'failed',
      error: { code: 'server_error', message: 'upstream failure' }
    })).toEqual({
      content: '',
      citations: [],
      searched: false,
      status: 'failed',
      errorCode: 'server_error'
    })
    expect(parseOpenAIResponsesJson({ ...completedResponse, status: 'failed' })).toEqual({
      content: '',
      citations: [],
      searched: false,
      status: 'failed'
    })
  })

  it('reports an incomplete response without promoting its partial output', () => {
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' }
    })).toEqual({ content: '', citations: [], searched: false, status: 'incomplete' })
  })

  it('accepts both the documented output_text part and a bare text part', () => {
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      output: [messageItem([{ text: 'Bare key.' }])]
    })).toEqual({ content: 'Bare key.', citations: [], searched: false, status: 'completed' })
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      output: [messageItem([{ type: 'output_text', output_text: 'Legacy key.' }])]
    })).toEqual({ content: 'Legacy key.', citations: [], searched: false, status: 'completed' })
  })

  it('tolerates missing annotations and non-text content parts', () => {
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      output: [
        messageItem([{ type: 'output_text', text: 'No citations.' }]),
        messageItem([{ type: 'refusal', refusal: 'no' }]),
        { type: 'reasoning', id: 'rs_1', summary: [] }
      ]
    })).toEqual({ content: 'No citations.', citations: [], searched: false, status: 'completed' })
  })

  it('tolerates a missing output array when the payload carries output_text', () => {
    expect(parseOpenAIResponsesJson({ id: 'resp_2', output_text: 'Plain text.' })).toEqual({
      content: 'Plain text.',
      citations: [],
      searched: false,
      status: 'completed'
    })
  })

  it('rejects a payload with neither output nor output_text', () => {
    expect(() => parseOpenAIResponsesJson({ id: 'resp_3' })).toThrow(OpenAIResponsesParseError)
  })

  it('tolerates an empty output array and non-object output entries', () => {
    expect(parseOpenAIResponsesJson({ ...completedResponse, output: [] })).toEqual({
      content: '', citations: [], searched: false, status: 'completed'
    })
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      output: [null, 'x', 42, messageItem([{ type: 'output_text', text: 'Kept.' }])]
    })).toEqual({ content: 'Kept.', citations: [], searched: false, status: 'completed' })
  })

  it('concatenates every message item instead of rejecting a second message', () => {
    const item = completedResponse.output[1]
    expect(parseOpenAIResponsesJson({ ...completedResponse, output: [item, item] })).toEqual({
      content: 'Evidence [1].Evidence [1].',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }],
      searched: false,
      status: 'completed'
    })
  })

  it('drops unsafe citations without fetching them', () => {
    const annotations = [
      { type: 'url_citation', url: 'file:///C:/secret.txt', title: 'Secret' },
      { type: 'url_citation', url: 'http://pubmed.ncbi.nlm.nih.gov/1/', title: 'Insecure' },
      { type: 'url_citation', url: 'https://user:pass@pubmed.ncbi.nlm.nih.gov/2/', title: 'Credentialed' },
      { type: 'url_citation', url: 'not a url', title: 'Broken' },
      { type: 'url_citation', title: 'Missing url' },
      { type: 'url_citation', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }
    ]
    expect(parseOpenAIResponsesJson(withAnnotations(annotations)).citations).toEqual([
      { url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }
    ])
  })

  it('ignores unknown annotation types and keeps only url_citation entries', () => {
    const annotations = [
      { type: 'file_citation', url: 'https://files.example.test/a.pdf', title: 'File' },
      { type: 'container_file_citation', url: 'https://files.example.test/b.pdf', title: 'Container' },
      { type: 'url_citation', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }
    ]
    expect(parseOpenAIResponsesJson(withAnnotations(annotations)).citations).toEqual([
      { url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }
    ])
  })

  it('dedupes repeated citation urls and falls back to the hostname as the title', () => {
    const annotations = [
      { type: 'url_citation', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' },
      { type: 'url_citation', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study again' },
      { type: 'url_citation', url: 'https://europepmc.org/article/1' },
      { type: 'url_citation', url: '', title: '' }
    ]
    expect(parseOpenAIResponsesJson(withAnnotations(annotations)).citations).toEqual([
      { url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' },
      { url: 'https://europepmc.org/article/1', title: 'europepmc.org' }
    ])
  })

  it('bounds the citation list', () => {
    const annotations = Array.from({ length: 45 }, (_value, index) => ({
      type: 'url_citation',
      url: `https://example.test/${index}`,
      title: `Source ${index}`
    }))
    expect(parseOpenAIResponsesJson(withAnnotations(annotations)).citations).toHaveLength(40)
  })

  it('never promotes a url that appears only in prose', () => {
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      output: [
        { type: 'web_search_call', id: 'search_1', status: 'completed' },
        messageItem([{
          type: 'output_text',
          text: 'See https://pubmed.ncbi.nlm.nih.gov/123/ and https://europepmc.org/article/1.'
        }])
      ]
    })).toEqual({
      content: 'See https://pubmed.ncbi.nlm.nih.gov/123/ and https://europepmc.org/article/1.',
      citations: [],
      searched: true,
      status: 'completed'
    })
  })

  it('marks searched only when a web_search_call item is present', () => {
    expect(parseOpenAIResponsesJson(withAnnotations([])).searched).toBe(false)
    expect(parseOpenAIResponsesJson({
      ...completedResponse,
      output: [
        { type: 'web_search_call', id: 'search_1', status: 'in_progress' },
        ...completedResponse.output.slice(1)
      ]
    }).searched).toBe(true)
  })

  it('parses split SSE deltas and reconciles them with the completed response', () => {
    const parser = createParser()
    const body = [
      'event: response.output_text.delta\n',
      'data: {"type":"response.output_text.delta","delta":"Evidence "}\n\n',
      'event: response.output_text.delta\n',
      'data: {"type":"response.output_text.delta","delta":"[1]."}\n\n',
      'event: response.completed\n',
      `data: ${JSON.stringify({ type: 'response.completed', response: completedResponse })}\n\n`
    ].join('')
    const bytes = new TextEncoder().encode(body)

    expect(parser.push(bytes.slice(0, 37))).toEqual([])
    expect(parser.push(bytes.slice(37))).toEqual(['Evidence ', '[1].'])
    expect(parser.finish()).toEqual({
      content: 'Evidence [1].',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }],
      searched: true,
      status: 'completed'
    })
  })

  it('prefers the authoritative completed payload over disagreeing streamed text', () => {
    const parser = createParser()
    const deltas = parser.push(new TextEncoder().encode(
      sseEvent('response.output_text.delta', { delta: 'different' }) +
      sseEvent('response.completed', { response: completedResponse }) +
      sseData('[DONE]')
    ))
    expect(deltas).toEqual(['different'])
    expect(parser.finish()).toEqual({
      content: 'Evidence [1].',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }],
      searched: true,
      status: 'completed'
    })
  })

  it('falls back to the streamed deltas when the terminal payload carries no text', () => {
    const parser = createParser()
    parser.push(new TextEncoder().encode(
      sseEvent('response.output_text.delta', { delta: 'Streamed ' }) +
      sseEvent('response.output_text.delta', { delta: 'answer.' }) +
      sseEvent('response.completed', {
        response: { id: 'resp_4', status: 'completed', output: [] }
      }) +
      sseData('[DONE]')
    ))
    expect(parser.finish()).toEqual({
      content: 'Streamed answer.',
      citations: [],
      searched: false,
      status: 'completed'
    })
  })

  it('ignores every other documented lifecycle event', () => {
    const parser = createParser()
    const deltas = parser.push(new TextEncoder().encode(
      sseEvent('response.created', { response: { id: 'resp_5' } }) +
      sseEvent('response.in_progress', {}) +
      sseEvent('response.output_item.added', { output_index: 0 }) +
      sseEvent('response.content_part.added', { content_index: 0 }) +
      sseEvent('response.content_part.delta', { delta: 'ignored' }) +
      sseEvent('response.reasoning_summary_text.delta', { delta: 'thinking' }) +
      sseEvent('web_search_call.in_progress', { item_id: 'search_1' }) +
      sseEvent('web_search_call.searching', { item_id: 'search_1' }) +
      sseEvent('web_search_call.completed', { item_id: 'search_1' }) +
      sseEvent('response.usage', { total_tokens: 10 }) +
      sseEvent('response.output_text.delta', { delta: 'Evidence [1].' }) +
      sseEvent('response.completed', { response: completedResponse }) +
      sseData('[DONE]')
    ))

    expect(deltas).toEqual(['Evidence [1].'])
    expect(parser.finish()).toMatchObject({ content: 'Evidence [1].', status: 'completed' })
  })

  it.each([
    ['failed', 'response.failed'],
    ['failed', 'error']
  ])('throws kind %s when %s terminates the stream', (kind, name) => {
    const parser = createParser()
    expect(parser.push(new TextEncoder().encode(
      sseEvent(name, { error: { code: 'server_error' } })
    ))).toEqual([])
    expect(thrownBy(() => parser.finish())).toMatchObject({ name: 'OpenAIResponsesParseError', kind })
  })

  it('throws kind truncated for a response.incomplete event', () => {
    const parser = createParser()
    expect(parser.push(new TextEncoder().encode(sseEvent('response.incomplete', {
      response: { id: 'resp_6', status: 'incomplete' }
    })))).toEqual([])
    expect(thrownBy(() => parser.finish())).toMatchObject({ kind: 'truncated' })
  })

  it('throws for a terminal error even after a completed payload arrived', () => {
    const parser = createParser()
    parser.push(new TextEncoder().encode(
      sseEvent('response.completed', { response: completedResponse }) +
      sseEvent('response.failed', { error: { code: 'server_error' } })
    ))
    expect(thrownBy(() => parser.finish())).toMatchObject({ kind: 'failed' })
  })

  it('throws when no terminal payload arrived', () => {
    const parser = createParser()
    expect(parser.push(new TextEncoder().encode(
      sseEvent('response.output_text.delta', { delta: 'partial' })
    ))).toEqual(['partial'])
    expect(thrownBy(() => parser.finish())).toMatchObject({ kind: 'invalid' })
  })

  it('rejects a delta that is not a string and an event whose name disagrees with its type', () => {
    expect(thrownBy(() => pushed(sseEvent('response.output_text.delta', { delta: 42 }))))
      .toMatchObject({ kind: 'invalid' })

    expect(thrownBy(() => pushed(
      'event: response.failed\ndata: {"type":"response.completed"}\n\n'
    ))).toMatchObject({ kind: 'invalid' })
  })

  it('rejects invalid UTF-8 and an unparsable event block', () => {
    const parser = createParser()
    expect(thrownBy(() => parser.push(new Uint8Array([0xc3, 0x28])))).toMatchObject({ kind: 'invalid' })
    // Malformed event JSON is routed through the parser's own failure path, so the client maps it to
    // AI_INVALID_RESPONSE rather than letting a raw SyntaxError escape as AI_NETWORK_ERROR.
    expect(thrownBy(() => pushed('data: {not json\n\n'))).toMatchObject({ kind: 'invalid' })
  })

  it('enforces the event count and partial block limits', () => {
    const body = sseEvent('response.created', { response: { id: 'resp_7' } }) +
      sseEvent('response.completed', { response: completedResponse })
    expect(thrownBy(() => pushed(body, { maxEventCount: 1 }))).toMatchObject({ kind: 'limit' })
    expect(thrownBy(() => pushed('data: {"type":"response.created"', { maxPartialBytes: 4 })))
      .toMatchObject({ kind: 'limit' })
  })

  it('enforces the streamed content character limit', () => {
    expect(thrownBy(() => pushed(
      sseEvent('response.output_text.delta', { delta: 'x'.repeat(11) }),
      { maxContentCharacters: 10 }
    ))).toMatchObject({ kind: 'limit' })
  })
})
