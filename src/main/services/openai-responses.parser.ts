export interface AIResponseCitation {
  url: string
  title: string
}

export type AIResponsesOutcome = 'completed' | 'incomplete' | 'failed'

export interface AIResponsesResult {
  content: string
  citations: AIResponseCitation[]
  /** True when the payload proves a hosted web search actually ran. */
  searched: boolean
  status: AIResponsesOutcome
  errorCode?: string
}

export type OpenAIResponsesParseErrorKind = 'invalid' | 'limit' | 'truncated' | 'failed'

export class OpenAIResponsesParseError extends Error {
  constructor(readonly kind: OpenAIResponsesParseErrorKind = 'invalid') {
    super(`OpenAI Responses ${kind}`)
    this.name = 'OpenAIResponsesParseError'
  }
}

const MAX_CITATIONS = 40
const MAX_TITLE_LENGTH = 500

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenAIResponsesParseError()
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new OpenAIResponsesParseError()
  return value as Record<string, unknown>
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  return value as Record<string, unknown>
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Citations come only from structured `url_citation` annotations. URLs that appear solely in prose
 * are never promoted to sources, and a non-HTTPS or credentialed URL is discarded.
 */
function safeCitation(value: unknown): AIResponseCitation | undefined {
  const annotation = optionalRecord(value)
  if (annotation === undefined || annotation.type !== 'url_citation') return undefined
  if (typeof annotation.url !== 'string') return undefined
  const rawTitle = annotation.title
  const title = typeof rawTitle === 'string' && rawTitle.length > 0 && rawTitle.length <= MAX_TITLE_LENGTH
    ? rawTitle
    : undefined
  try {
    const url = new URL(annotation.url)
    if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) return undefined
    const normalized = url.toString()
    return { url: normalized, title: title ?? url.hostname }
  } catch {
    return undefined
  }
}

function outputText(value: unknown): string | undefined {
  const content = optionalRecord(value)
  if (content === undefined) return undefined
  // DeepSeek documents `output_text`; tolerate a bare `text` key rather than rejecting the response.
  const text = content.type === 'output_text' || content.type === undefined ? (content.text ?? content.output_text) : undefined
  return typeof text === 'string' ? text : undefined
}

function statusOf(response: Record<string, unknown>): AIResponsesOutcome {
  const status = response.status
  if (status === undefined || status === null) return 'completed'
  if (status === 'completed') return 'completed'
  if (status === 'incomplete') return 'incomplete'
  if (status === 'failed') return 'failed'
  throw new OpenAIResponsesParseError()
}

function errorCodeOf(response: Record<string, unknown>): string | undefined {
  const error = optionalRecord(response.error)
  if (error === undefined) return undefined
  const code = error.code ?? error.type
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) return code
  return undefined
}

export function parseOpenAIResponsesJson(value: unknown): AIResponsesResult {
  const response = record(value)
  const status = statusOf(response)
  if (status === 'failed') {
    return {
      content: '',
      citations: [],
      searched: false,
      status,
      ...(errorCodeOf(response) === undefined ? {} : { errorCode: errorCodeOf(response) as string })
    }
  }
  if (status === 'incomplete') {
    return { content: '', citations: [], searched: false, status }
  }

  const output = response.output
  const textParts: string[] = []
  const citations: AIResponseCitation[] = []
  const seen = new Set<string>()
  let searched = false

  if (isArray(output)) {
    for (const item of output) {
      const entry = optionalRecord(item)
      if (entry === undefined) continue
      if (entry.type === 'web_search_call') {
        searched = true
        continue
      }
      if (entry.type !== 'message') continue
      if (!isArray(entry.content)) continue
      for (const part of entry.content) {
        const text = outputText(part)
        if (text !== undefined && text.length > 0) textParts.push(text)
        const partRecord = optionalRecord(part)
        if (partRecord === undefined || !isArray(partRecord.annotations)) continue
        for (const annotation of partRecord.annotations) {
          const citation = safeCitation(annotation)
          if (citation === undefined || seen.has(citation.url)) continue
          if (citations.length >= MAX_CITATIONS) break
          seen.add(citation.url)
          citations.push(citation)
        }
      }
    }
  }

  let content = textParts.join('')
  if (content.length === 0 && typeof response.output_text === 'string') {
    content = response.output_text
  }
  if (!isArray(output) && content.length === 0) throw new OpenAIResponsesParseError()
  return { content, citations, searched, status: 'completed' }
}

export interface AIResponsesSseParserOptions {
  maxEventCount: number
  maxEventBytes: number
  maxPartialBytes: number
  maxContentCharacters: number
}

export interface AIResponsesSseParser {
  push(chunk: Uint8Array): string[]
  finish(): AIResponsesResult
}

export function createOpenAIResponsesSseParser(
  options: AIResponsesSseParserOptions
): AIResponsesSseParser {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let pending = ''
  let eventCount = 0
  let streamedText = ''
  let completed: AIResponsesResult | undefined
  let terminalError: OpenAIResponsesParseError | undefined

  function fail(kind: OpenAIResponsesParseErrorKind = 'invalid'): never {
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
    const payload = optionalRecord(JSON.parse(data))
    if (payload === undefined) fail()
    const type = typeof payload.type === 'string' ? payload.type : eventName
    if (eventName.length > 0 && payload.type !== undefined && eventName !== payload.type) fail()
    if (type === 'response.output_text.delta') {
      if (typeof payload.delta !== 'string') fail()
      streamedText += payload.delta
      if (streamedText.length > options.maxContentCharacters) fail('limit')
      return payload.delta
    }
    if (type === 'response.completed') {
      completed = parseOpenAIResponsesJson(payload.response)
      return undefined
    }
    if (type === 'response.failed' || type === 'error') {
      terminalError = new OpenAIResponsesParseError('failed')
      return undefined
    }
    if (type === 'response.incomplete') {
      terminalError = new OpenAIResponsesParseError('truncated')
      return undefined
    }
    // Every other documented lifecycle event (created, output_item.*, content_part.*,
    // web_search_call.*, reasoning_*, usage) is informational for this stage.
    if (type.startsWith('response.') || type.startsWith('web_search_call.')) return undefined
    return undefined
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
      if (terminalError !== undefined) throw terminalError
      if (completed === undefined) fail()
      const result = completed as AIResponsesResult
      // The authoritative rebuild from `response.completed` wins; streamed deltas are a fallback
      // only when the terminal payload carried no text of its own.
      const content = result.content.length > 0 ? result.content : streamedText
      return content === result.content ? result : { ...result, content }
    }
  }
}
