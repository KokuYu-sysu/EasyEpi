export interface AIResponseCitation {
  url: string
  title: string
}

export interface AIResponsesResult {
  content: string
  citations: AIResponseCitation[]
  searched: boolean
}

export class OpenAIResponsesParseError extends Error {
  constructor(readonly kind: 'invalid' | 'limit' = 'invalid') {
    super(kind === 'limit' ? 'OpenAI Responses limit exceeded' : 'Invalid OpenAI Responses payload')
    this.name = 'OpenAIResponsesParseError'
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenAIResponsesParseError()
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new OpenAIResponsesParseError()
  return value as Record<string, unknown>
}

function safeCitation(value: unknown): AIResponseCitation | undefined {
  const annotation = record(value)
  if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string' ||
    typeof annotation.title !== 'string' || annotation.title.length > 500) return undefined
  try {
    const url = new URL(annotation.url)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return { url: url.toString(), title: annotation.title }
  } catch {
    return undefined
  }
}

export function parseOpenAIResponsesJson(value: unknown): AIResponsesResult {
  const response = record(value)
  if (response.status !== 'completed' || !Array.isArray(response.output)) {
    throw new OpenAIResponsesParseError()
  }
  const messages = response.output.filter((item) => record(item).type === 'message')
  if (messages.length !== 1) throw new OpenAIResponsesParseError()
  const message = record(messages[0])
  if (message.role !== 'assistant' || message.status !== 'completed' || !Array.isArray(message.content)) {
    throw new OpenAIResponsesParseError()
  }

  const textParts: string[] = []
  const citations: AIResponseCitation[] = []
  for (const item of message.content) {
    const content = record(item)
    if (content.type !== 'output_text' || typeof content.text !== 'string' || content.text.length === 0) {
      throw new OpenAIResponsesParseError()
    }
    textParts.push(content.text)
    if (content.annotations !== undefined) {
      if (!Array.isArray(content.annotations)) throw new OpenAIResponsesParseError()
      for (const annotation of content.annotations) {
        const citation = safeCitation(annotation)
        if (citation !== undefined) citations.push(citation)
      }
    }
  }
  const content = textParts.join('')
  if (content.length === 0) throw new OpenAIResponsesParseError()
  return {
    content,
    citations,
    searched: response.output.some((item) => record(item).type === 'web_search_call')
  }
}

export interface AIResponsesSseParserOptions {
  maxEventCount: number
  maxEventBytes: number
  maxPartialBytes: number
  maxContentCharacters: number
}

export function createOpenAIResponsesSseParser(options: AIResponsesSseParserOptions): {
  push(chunk: Uint8Array): string[]
  finish(): AIResponsesResult
} {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let pending = ''
  let eventCount = 0
  let streamedText = ''
  let completed: AIResponsesResult | undefined

  function fail(kind: 'invalid' | 'limit' = 'invalid'): never {
    throw new OpenAIResponsesParseError(kind)
  }

  function parseEvent(block: string): string | undefined {
    eventCount += 1
    if (eventCount > options.maxEventCount || encoder.encode(block).byteLength > options.maxEventBytes) {
      fail('limit')
    }
    let eventName = ''
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      else if (line.trim().length > 0) fail()
    }
    if (dataLines.length === 0) return undefined
    const data = dataLines.join('\n')
    if (data === '[DONE]') return undefined
    let payload: Record<string, unknown>
    try {
      payload = record(JSON.parse(data))
    } catch {
      return fail()
    }
    const type = typeof payload.type === 'string' ? payload.type : eventName
    if (eventName && payload.type !== undefined && eventName !== payload.type) fail()
    if (type === 'response.output_text.delta') {
      if (completed !== undefined || typeof payload.delta !== 'string') fail()
      streamedText += payload.delta
      if (streamedText.length > options.maxContentCharacters) fail('limit')
      return payload.delta
    }
    if (type === 'response.completed') {
      if (completed !== undefined) fail()
      completed = parseOpenAIResponsesJson(payload.response)
      return undefined
    }
    if (type.startsWith('response.') || type.startsWith('web_search_call.')) return undefined
    return fail()
  }

  function drain(): string[] {
    const deltas: string[] = []
    pending = pending.replaceAll('\r\n', '\n')
    for (;;) {
      const boundary = pending.indexOf('\n\n')
      if (boundary < 0) break
      const block = pending.slice(0, boundary)
      pending = pending.slice(boundary + 2)
      if (block.trim().length === 0) continue
      const delta = parseEvent(block)
      if (delta !== undefined && delta.length > 0) deltas.push(delta)
    }
    if (encoder.encode(pending).byteLength > options.maxPartialBytes) fail('limit')
    return deltas
  }

  return {
    push(chunk) {
      try {
        pending += decoder.decode(chunk, { stream: true })
      } catch {
        fail()
      }
      return drain()
    },
    finish() {
      try {
        pending += decoder.decode()
      } catch {
        fail()
      }
      drain()
      if (pending.trim().length > 0 || completed === undefined || completed.content !== streamedText) fail()
      return completed
    }
  }
}
