import { describe, expect, it } from 'vitest'

import {
  OpenAIResponsesParseError,
  createOpenAIResponsesSseParser,
  parseOpenAIResponsesJson
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

describe('OpenAI Responses parser', () => {
  it('extracts completed text, safe citations, and actual search use', () => {
    expect(parseOpenAIResponsesJson(completedResponse)).toEqual({
      content: 'Evidence [1].',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/123/', title: 'Study' }],
      searched: true
    })
  })

  it('drops unsafe citations without fetching them', () => {
    const response = structuredClone(completedResponse)
    response.output[1]!.content![0]!.annotations = [{
      type: 'url_citation',
      url: 'file:///C:/secret.txt',
      title: 'Secret',
      start_index: 0,
      end_index: 1
    }]
    expect(parseOpenAIResponsesJson(response).citations).toEqual([])
  })

  it.each([
    ['incomplete response', { ...completedResponse, status: 'failed' }],
    ['empty output', { ...completedResponse, output: [] }],
    ['multiple messages', { ...completedResponse, output: [completedResponse.output[1], completedResponse.output[1]] }],
    ['refusal', { ...completedResponse, output: [{
      type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'refusal', refusal: 'no' }]
    }] }]
  ])('rejects %s', (_name, value) => {
    expect(() => parseOpenAIResponsesJson(value)).toThrow(OpenAIResponsesParseError)
  })

  it('parses split SSE deltas and reconciles them with the completed response', () => {
    const parser = createOpenAIResponsesSseParser({
      maxEventCount: 10,
      maxEventBytes: 20_000,
      maxPartialBytes: 20_000,
      maxContentCharacters: 1_000
    })
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
      searched: true
    })
  })

  it('rejects a completed response that disagrees with streamed text', () => {
    const parser = createOpenAIResponsesSseParser({
      maxEventCount: 3,
      maxEventBytes: 20_000,
      maxPartialBytes: 20_000,
      maxContentCharacters: 1_000
    })
    parser.push(new TextEncoder().encode(
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","delta":"different"}\n\n' +
      'event: response.completed\n' +
      `data: ${JSON.stringify({ type: 'response.completed', response: completedResponse })}\n\n`
    ))
    expect(() => parser.finish()).toThrow(OpenAIResponsesParseError)
  })
})
