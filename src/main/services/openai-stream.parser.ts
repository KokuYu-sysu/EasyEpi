export interface StreamContentDelta {
  content: string
  sequence: number
}

export interface StreamLimits {
  maxEventCount: number
  maxEventBytes: number
  maxPartialBytes: number
  maxContentCharacters: number
}

export class OpenAIStreamParseError extends Error {
  constructor(readonly kind: 'invalid' | 'limit') {
    super(kind === 'limit' ? 'OpenAI stream limit exceeded' : 'Invalid OpenAI stream')
    this.name = 'OpenAIStreamParseError'
  }
}

export interface SseChatCompletionParser {
  push(bytes: Uint8Array): StreamContentDelta[]
  finish(): StreamCompletionEvidence
  readonly acceptedContent: boolean
}

export interface CompleteChoiceEvidence {
  choiceCount: number
  index: unknown
  finishReason: unknown
  content: unknown
  role: unknown
  refusalPresent: boolean
  toolCallPresent: boolean
}

export interface StreamCompletionEvidence {
  content: string
  toolArguments?: string
  choice: CompleteChoiceEvidence
}

function invalid(): never {
  throw new OpenAIStreamParseError('invalid')
}

function limit(): never {
  throw new OpenAIStreamParseError('limit')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasPayload(value: Record<string, unknown>, key: string): boolean {
  return has(value, key) && value[key] !== null && value[key] !== undefined
}

export function createSseChatCompletionParser(limits: StreamLimits): SseChatCompletionParser {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let currentLine = ''
  let eventBytes = 0
  let eventPresent = false
  let dataLines: string[] = []
  let eventCount = 0
  let sequence = 0
  let content = ''
  let contentPresent = false
  let toolArguments = ''
  let toolCallStarted = false
  let toolNameSeen = false
  let toolTypeSeen = false
  let terminal = false
  let terminalIndex: unknown
  let terminalFinishReason: unknown
  let role: unknown
  let refusalPresent = false
  let toolCallPresent = false
  let done = false
  let finished = false

  function validateLimit(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) limit()
  }
  validateLimit(limits.maxEventCount)
  validateLimit(limits.maxEventBytes)
  validateLimit(limits.maxPartialBytes)
  validateLimit(limits.maxContentCharacters)

  function consumeEvent(): StreamContentDelta[] {
    if (!eventPresent) {
      eventBytes = 0
      return []
    }
    eventCount += 1
    if (eventCount > limits.maxEventCount || eventBytes > limits.maxEventBytes) limit()
    const joined = dataLines.join('\n')
    dataLines = []
    eventPresent = false
    eventBytes = 0
    if (joined.length === 0) return []
    if (done) invalid()
    if (joined.trim() === '[DONE]') {
      if (!terminal) invalid()
      done = true
      return []
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(joined)
    } catch {
      invalid()
    }
    const root = record(parsed)
    if (!Array.isArray(root.choices)) invalid()
    if (root.choices.length === 0) {
      if (!hasPayload(root, 'usage')) invalid()
      record(root.usage)
      return []
    }
    if (terminal) invalid()
    if (root.choices.length !== 1) invalid()
    const choice = record(root.choices[0])
    if (choice.index !== 0) invalid()
    if (!has(choice, 'delta')) invalid()
    const delta = record(choice.delta)
    if (hasPayload(delta, 'function_call')) invalid()
    if (hasPayload(delta, 'tool_calls')) {
      if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length !== 1 || contentPresent) invalid()
      const toolCall = record(delta.tool_calls[0])
      if (toolCall.index !== 0) invalid()
      if (has(toolCall, 'type')) {
        if (toolCall.type !== 'function') invalid()
        toolTypeSeen = true
      }
      if (!has(toolCall, 'function')) invalid()
      const fn = record(toolCall.function)
      if (has(fn, 'name')) {
        // The questionnaire protocol never requests tools, so any tool call is an unexpected
        // response shape. It is captured here and rejected by the transport rather than matched
        // against a specific function name.
        if (typeof fn.name !== 'string' || fn.name.length === 0 || fn.name.length > 128) invalid()
        toolNameSeen = true
      }
      if (has(fn, 'arguments')) {
        if (typeof fn.arguments !== 'string') invalid()
        if (toolArguments.length + fn.arguments.length > limits.maxContentCharacters) limit()
        toolArguments += fn.arguments
      }
      toolCallStarted = true
      toolCallPresent = true
    }
    if (hasPayload(delta, 'refusal')) refusalPresent = true
    if (has(delta, 'role')) role = delta.role

    const finishReason = has(choice, 'finish_reason') ? choice.finish_reason : null
    const emitted: StreamContentDelta[] = []
    if (hasPayload(delta, 'content')) {
      if (typeof delta.content !== 'string') invalid()
      if (delta.content.length > 0) {
        if (toolCallStarted) invalid()
        contentPresent = true
        if (content.length + delta.content.length > limits.maxContentCharacters) limit()
        content += delta.content
        emitted.push({ content: delta.content, sequence: ++sequence })
      }
    }
    if (finishReason !== null) {
      if (terminal) invalid()
      terminal = true
      terminalIndex = choice.index
      terminalFinishReason = finishReason
    }
    return emitted
  }

  function consumeDecoded(text: string): StreamContentDelta[] {
    const emitted: StreamContentDelta[] = []
    for (let index = 0; index < text.length;) {
      const codePoint = text.codePointAt(index)
      if (codePoint === undefined) invalid()
      const character = String.fromCodePoint(codePoint)
      index += character.length
      eventBytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
      if (eventBytes > limits.maxPartialBytes) limit()
      if (character !== '\n') {
        currentLine += character
        continue
      }
      const line = currentLine.endsWith('\r') ? currentLine.slice(0, -1) : currentLine
      currentLine = ''
      if (line.length === 0) {
        emitted.push(...consumeEvent())
        continue
      }
      eventPresent = true
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') dataLines.push(value)
    }
    return emitted
  }

  return {
    get acceptedContent() {
      return content.length > 0
    },
    push(bytes) {
      if (finished || done && bytes.byteLength > 0) invalid()
      let decoded: string
      try {
        decoded = decoder.decode(bytes, { stream: true })
      } catch {
        invalid()
      }
      return consumeDecoded(decoded)
    },
    finish() {
      if (finished) invalid()
      finished = true
      let tail: string
      try {
        tail = decoder.decode()
      } catch {
        invalid()
      }
      consumeDecoded(tail)
      if (currentLine.length > 0 || eventPresent || eventBytes > 0 || !terminal || !done) invalid()
      if (toolCallStarted && (!toolTypeSeen || !toolNameSeen || toolArguments.length === 0)) invalid()
      return {
        content,
        ...(toolCallStarted ? { toolArguments } : {}),
        choice: {
          choiceCount: 1,
          index: terminalIndex,
          finishReason: terminalFinishReason,
          content,
          role,
          refusalPresent,
          toolCallPresent
        }
      }
    }
  }
}

export interface AssistantMessageExtractor {
  push(text: string): string[]
  finish(): string
  /**
   * False when the mirrored text cannot be trusted to equal the envelope's `assistantMessage`: the
   * value overflowed the mirroring bound, or the streamed text is not the bare JSON object the mirror
   * understands (a fenced code block or prose, for example). The mirror only feeds provisional UI
   * text, so neither case fails the request — the main-process harness validates the final envelope
   * and it strips code fences itself.
   */
  readonly reliable: boolean
}

type RootPhase = 'start' | 'keyOrEnd' | 'colon' | 'value' | 'commaOrEnd' | 'closed'
type StringPurpose = 'rootKey' | 'assistantValue' | 'other'

export function createAssistantMessageExtractor(maxCharacters: number): AssistantMessageExtractor {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters <= 0) limit()
  let phase: RootPhase = 'start'
  let purpose: StringPurpose | null = null
  let escaped = false
  let unicode = ''
  let key = ''
  let pendingKey = ''
  let assistant = ''
  let pendingHighSurrogate = ''
  let assistantSeen = false
  let primitive = false
  let overflowed = false
  let mirroring = true
  const nested: string[] = []
  const rootKeys = new Set<string>()

  function appendScalar(unit: string, emitted: string[], target: 'key' | 'assistant'): void {
    const code = unit.charCodeAt(0)
    if (pendingHighSurrogate.length > 0) {
      if (code < 0xdc00 || code > 0xdfff) invalid()
      const scalar = pendingHighSurrogate + unit
      pendingHighSurrogate = ''
      if (target === 'key') key += scalar
      else if (assistant.length + scalar.length > maxCharacters) overflowed = true
      else {
        assistant += scalar
        emitted.push(scalar)
      }
      return
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      pendingHighSurrogate = unit
      return
    }
    if (code >= 0xdc00 && code <= 0xdfff) invalid()
    if (target === 'key') {
      key += unit
      if (key.length > 4096) limit()
    } else if (assistant.length + unit.length > maxCharacters) {
      overflowed = true
    } else {
      assistant += unit
      emitted.push(unit)
    }
  }

  function decodedEscape(character: string): string {
    switch (character) {
      case '"': return '"'
      case '\\': return '\\'
      case '/': return '/'
      case 'b': return '\b'
      case 'f': return '\f'
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      default: invalid()
    }
  }

  function closeString(): void {
    if (pendingHighSurrogate.length > 0) invalid()
    if (purpose === 'rootKey') {
      if (rootKeys.has(key)) invalid()
      rootKeys.add(key)
      pendingKey = key
      key = ''
      phase = 'colon'
    } else if (purpose === 'assistantValue' || nested.length === 0) {
      if (purpose === 'assistantValue') assistantSeen = true
      if (nested.length === 0) phase = 'commaOrEnd'
    }
    purpose = null
  }

  function consumeStringCharacter(character: string, emitted: string[]): void {
    if (unicode.length > 0) {
      const code = character.charCodeAt(0)
      const hex = code >= 0x30 && code <= 0x39 || code >= 0x41 && code <= 0x46 || code >= 0x61 && code <= 0x66
      if (!hex) invalid()
      unicode += character
      if (unicode.length === 5) {
        const unit = String.fromCharCode(Number.parseInt(unicode.slice(1), 16))
        unicode = ''
        if (purpose === 'rootKey') appendScalar(unit, emitted, 'key')
        else if (purpose === 'assistantValue') appendScalar(unit, emitted, 'assistant')
      }
      return
    }
    if (escaped) {
      escaped = false
      if (character === 'u') {
        unicode = 'u'
        return
      }
      const decoded = decodedEscape(character)
      if (purpose === 'rootKey') appendScalar(decoded, emitted, 'key')
      else if (purpose === 'assistantValue') appendScalar(decoded, emitted, 'assistant')
      return
    }
    if (character === '\\') {
      escaped = true
      return
    }
    if (character === '"') {
      closeString()
      return
    }
    if (character.charCodeAt(0) < 0x20) invalid()
    if (purpose === 'rootKey') appendScalar(character, emitted, 'key')
    else if (purpose === 'assistantValue') appendScalar(character, emitted, 'assistant')
  }

  function beginString(nextPurpose: StringPurpose): void {
    purpose = nextPurpose
    escaped = false
    unicode = ''
    pendingHighSurrogate = ''
    if (nextPurpose === 'rootKey') key = ''
  }

  function beginRootValue(character: string): boolean {
    if (character === '"') {
      beginString(pendingKey === 'assistantMessage' ? 'assistantValue' : 'other')
      return true
    }
    if (character === '{' || character === '[') {
      nested.push(character)
      return true
    }
    primitive = true
    return false
  }

  return {
    push(text) {
      if (!mirroring) return []
      const emitted: string[] = []
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index]!
        if (purpose !== null) {
          consumeStringCharacter(character, emitted)
          continue
        }
        if (nested.length > 0) {
          if (character === '"') beginString('other')
          else if (character === '{' || character === '[') nested.push(character)
          else if (character === '}' || character === ']') {
            const open = nested.pop()
            if ((open === '{') !== (character === '}')) invalid()
            if (nested.length === 0) phase = 'commaOrEnd'
          }
          continue
        }
        if (primitive) {
          if (character === ',') {
            primitive = false
            phase = 'keyOrEnd'
          } else if (character === '}') {
            primitive = false
            phase = 'closed'
          }
          continue
        }
        if (character === ' ' || character === '\t' || character === '\r' || character === '\n') continue
        if (phase === 'start') {
          if (character !== '{') {
            // The streamed text is not a bare JSON object — a ```json fence, a prose preamble, anything
            // else the provider decided to wrap around the answer. The harness strips a fence and is the
            // authority on the final envelope, so the mirror gives up quietly instead of rejecting a
            // response the harness would have accepted. Every other check below stays strict.
            mirroring = false
            return []
          }
          phase = 'keyOrEnd'
        } else if (phase === 'keyOrEnd') {
          if (character === '}') phase = 'closed'
          else if (character === '"') beginString('rootKey')
          else invalid()
        } else if (phase === 'colon') {
          if (character !== ':') invalid()
          phase = 'value'
        } else if (phase === 'value') {
          if (!beginRootValue(character)) index -= 1
        } else if (phase === 'commaOrEnd') {
          if (character === ',') phase = 'keyOrEnd'
          else if (character === '}') phase = 'closed'
          else invalid()
        } else {
          invalid()
        }
      }
      return emitted
    },
    finish() {
      if (!mirroring) return assistant
      if (phase !== 'closed' || purpose !== null || nested.length > 0 || primitive || escaped || unicode.length > 0 || !assistantSeen) invalid()
      return assistant
    },
    get reliable() {
      return mirroring && !overflowed
    }
  }
}
