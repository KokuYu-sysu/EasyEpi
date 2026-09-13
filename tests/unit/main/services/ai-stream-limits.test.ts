import { describe, expect, it, vi } from 'vitest'

import { createOpenAICompatibleClient } from '@main/services/openai-compatible.client'
import { createOpenAIResponsesClient } from '@main/services/openai-responses.client'
import { createAssistantMessageExtractor } from '@main/services/openai-stream.parser'
import { createOpenAIResponsesSseParser } from '@main/services/openai-responses.parser'

/**
 * These bounds are the ones that decide whether a large questionnaire can come back at all. They
 * regressed once: the SSE event-count bound was a fixed 10,000 while the output budget was 65,536
 * tokens, and OpenAI-compatible streamers emit roughly one event per token, so a comprehensive
 * questionnaire died part-way through with `AI_RESPONSE_TOO_LARGE` — an error that is not repairable
 * and told the user nothing about what had actually happened.
 */

function envelope(questionCount: number, assistantMessage = '已生成问卷。'): string {
  return JSON.stringify({
    kind: 'questionnaire',
    assistantMessage,
    rollingSummary: 'Summary',
    options: [],
    questionnaire: {
      name: '中国老年慢性病调查',
      questions: Array.from({ length: questionCount }, (_, index) => ({
        id: `q${index}`,
        content: `这是第 ${index + 1} 个题目，用于评估老年人的慢性病相关因素。`,
        variableName: `var_${index}`,
        type: 'free_text',
        options: [],
        constraint: { type: 'none' },
        isKey: false,
        allowSkip: true,
        order: index
      })),
      conditionRules: [],
      keyQuestionIds: []
    }
  })
}

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    }
  })
}

function deltaChunk(delta: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: delta }, finish_reason: finishReason }]
  })}\n\n`
}

function completeChunk(finishReason = 'stop'): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`
}

/** Splits the text into many small deltas, the way a real token stream arrives. */
function tokenChunks(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push(deltaChunk(text.slice(offset, offset + size)))
  }
  return chunks
}

describe('large questionnaire streaming bounds', () => {
  it('accepts a questionnaire carried by far more than 10,000 SSE events', async () => {
    const payload = envelope(80)
    expect(payload.length).toBeGreaterThan(10_000)
    const events = [...tokenChunks(payload, 1), completeChunk(), 'data: [DONE]\n\n']
    expect(events.length).toBeGreaterThan(10_000)

    const client = createOpenAICompatibleClient({
      fetch: vi.fn().mockResolvedValue(new Response(sseStream(events), {
        status: 200, headers: { 'content-type': 'text/event-stream' }
      }))
    })

    const result = await client.complete({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      messages: [],
      outputMode: 'json_object',
      schemaVersion: 2
    })

    expect(JSON.parse(result.content)).toMatchObject({ kind: 'questionnaire' })
  })

  it('derives the event bound from the configured output budget', async () => {
    // A smaller budget means fewer possible events, so a stream that exceeds it must still fail —
    // proving the bound is derived rather than removed.
    const payload = envelope(20)
    const events = [...tokenChunks(payload, 1), completeChunk(), 'data: [DONE]\n\n']

    const client = createOpenAICompatibleClient({
      completionTokenLimit: 16,
      fetch: vi.fn().mockResolvedValue(new Response(sseStream(events), {
        status: 200, headers: { 'content-type': 'text/event-stream' }
      }))
    })

    await expect(client.complete({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      messages: [],
      outputMode: 'json_object',
      schemaVersion: 2
    })).rejects.toMatchObject({ code: 'AI_RESPONSE_TOO_LARGE' })
  })

  it('mirrors a questionnaire whose assistantMessage exceeds the mirroring bound', async () => {
    // The mirror only feeds provisional UI text. It must never abort a request the harness could accept.
    const longMessage = '说明'.repeat(9_000)
    const payload = envelope(20, longMessage)
    const events = [...tokenChunks(payload, 2_000), completeChunk(), 'data: [DONE]\n\n']

    const seen: string[] = []
    const client = createOpenAICompatibleClient({
      maxAssistantMessageCharacters: 500,
      fetch: vi.fn().mockResolvedValue(new Response(sseStream(events), {
        status: 200, headers: { 'content-type': 'text/event-stream' }
      }))
    })

    const result = await client.complete({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      messages: [],
      outputMode: 'json_object',
      schemaVersion: 2,
      onContentDelta: ({ content }) => seen.push(content)
    })

    expect(JSON.parse(result.content)).toMatchObject({ assistantMessage: longMessage })
    // Mirroring stopped at the bound instead of failing, and never ran away past it.
    expect(seen.join('').length).toBeLessThanOrEqual(600)
  })

  it('stops the assistant message mirror at its bound instead of throwing', () => {
    const extractor = createAssistantMessageExtractor(8)
    const emitted = extractor.push('{"assistantMessage":"abcdefghijklmnop"}')
    // Exactly the bound is mirrored, the rest is dropped, and nothing throws.
    expect(emitted.join('')).toBe('abcdefgh')
    expect(extractor.reliable).toBe(false)
    expect(extractor.finish()).toBe('abcdefgh')
  })

  it('reports the mirror as unreliable for an assistant message inside the bound', () => {
    const extractor = createAssistantMessageExtractor(64)
    const emitted = extractor.push('{"assistantMessage":"short"}')
    expect(emitted.join('')).toBe('short')
    expect(extractor.reliable).toBe(true)
    expect(extractor.finish()).toBe('short')
  })

  it('survives streamed content that is not a bare JSON envelope', () => {
    // A fenced code block is what the harness accepts after stripping the fence. The mirror must not
    // be able to reject it, or the client becomes stricter than the authority it feeds.
    const extractor = createAssistantMessageExtractor(1_000)
    expect(extractor.push('```json\n')).toEqual([])
    expect(extractor.push('{"assistantMessage":"x"}')).toEqual([])
    expect(extractor.reliable).toBe(false)
    expect(extractor.finish()).toBe('')
  })
})

describe('large hosted-search response bounds', () => {
  it('accepts a single response.completed event larger than 256 KB', () => {
    // The terminal event embeds the entire response, including every hosted search result, so a
    // per-event bound sized for a plain chat completion rejects exactly the search-assisted answers.
    const bigText = 'x'.repeat(400_000)
    const parser = createOpenAIResponsesSseParser({
      maxEventCount: 200_000,
      maxEventBytes: 2_000_000,
      maxPartialBytes: 2_000_000,
      maxContentCharacters: 1_000_000
    })

    expect(() => parser.push(new TextEncoder().encode(
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            { type: 'web_search_call', id: 'ws_1' },
            {
              type: 'message',
              id: 'm_1',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: bigText, annotations: [] }]
            }
          ]
        }
      })}\n\n`
    ))).not.toThrow()

    const result = parser.finish()
    expect(result.searched).toBe(true)
    expect(result.content.length).toBe(400_000)
  })

  it('resolves a large streamed Responses payload through the client', async () => {
    const bigText = 'y'.repeat(300_000)
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              status: 'completed',
              output: [{
                type: 'message',
                id: 'm_1',
                role: 'assistant',
                status: 'completed',
                content: [{
                  type: 'output_text',
                  text: bigText,
                  annotations: [{ type: 'url_citation', url: 'https://www.who.int/report', title: 'WHO' }]
                }]
              }]
            }
          })}\n\n`
        ))
        controller.close()
      }
    })

    const client = createOpenAIResponsesClient({
      fetch: vi.fn().mockResolvedValue(new Response(body, {
        status: 200, headers: { 'content-type': 'text/event-stream' }
      }))
    })

    const result = await client.search({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      input: 'question'
    })

    expect(result.content.length).toBe(300_000)
    expect(result.citations).toEqual([{ url: 'https://www.who.int/report', title: 'WHO' }])
  })
})
