import type { AIProviderId } from '@shared/ai-assistant-contract'

import { validateAIConfigUpdate } from './ai-config.service'
import {
  getAIProviderRequestPolicy,
  resolveOpenAICompatibleEndpoint,
  type AIResponseFormatLevel
} from './ai-provider-policy'
import {
  OpenAIStreamParseError,
  createAssistantMessageExtractor,
  createSseChatCompletionParser,
  type CompleteChoiceEvidence,
  type StreamContentDelta
} from './openai-stream.parser'

export type AIClientErrorCode =
  | 'AI_AUTH_ERROR'
  | 'AI_MODEL_NOT_FOUND'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'AI_RESPONSE_TOO_LARGE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_NETWORK_ERROR'
  | 'AI_PROVIDER_ERROR'

export class AIClientError extends Error {
  constructor(readonly code: AIClientErrorCode) {
    super(code)
    this.name = 'AIClientError'
  }
}

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIChatCompletionRequest {
  providerId?: AIProviderId
  baseUrl: string
  model: string
  apiKey?: string
  messages: AIChatMessage[]
  signal?: AbortSignal
  /** False means this provider/model was already proven not to support JSON schema. */
  responseFormatSupported?: boolean
  /** False means this provider/model was already proven not to support SSE streaming. */
  streamingSupported?: boolean
  /** False means this provider/model was already proven not to support function calling. */
  toolCallingSupported?: boolean
  onModelStreaming?: () => void
  onContentDelta?: (delta: StreamContentDelta) => void
  onCapabilityFallback?: (capability: 'streaming' | 'response_format' | 'function_call') => void
  schemaVersion?: number
}

export interface AIChatCompletionResult {
  content: string
  streamingSupported: boolean
  responseFormatSupported: boolean
  toolCallingSupported: boolean
}

export interface OpenAICompatibleClientOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  maxErrorResponseBytes?: number
  maxEventCount?: number
  maxEventBytes?: number
  maxPartialEventBytes?: number
  maxStreamContentCharacters?: number
  maxAssistantMessageCharacters?: number
  maxCallbackDeltaCharacters?: number
}

const MODEL_ENVELOPE_SCHEMA_V2 = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'assistantMessage', 'rollingSummary', 'options', 'questionnaire'],
  properties: {
    kind: { type: 'string', enum: ['clarification', 'questionnaire'] },
    assistantMessage: { type: 'string' },
    rollingSummary: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' }
        }
      }
    },
    questionnaire: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'description', 'questions', 'conditionRules', 'keyQuestionIds'],
      properties: {
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id', 'content', 'variableName', 'type', 'options', 'constraint', 'isKey',
              'defaultValue', 'allowSkip', 'skipValue', 'order'
            ],
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              variableName: { type: 'string' },
              type: {
                type: 'string',
                enum: ['single_choice', 'multiple_choice', 'fixed_length', 'free_text', 'numeric_range', 'date']
              },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['value', 'label'],
                  properties: { value: { type: 'string' }, label: { type: 'string' } }
                }
              },
              constraint: {
                type: 'object',
                description: 'Never create, remove, or modify regex constraints. Only copy an existing regexPattern and regexFlags exactly.',
                additionalProperties: false,
                required: ['type', 'fixedLength', 'minValue', 'maxValue', 'step', 'regexPattern', 'regexFlags'],
                properties: {
                  type: {
                    type: 'string',
                    enum: ['none', 'integer', 'decimal', 'chinese', 'english', 'alphanumeric', 'date', 'regex']
                  },
                  fixedLength: { type: ['integer', 'null'] },
                  minValue: { type: ['number', 'null'] },
                  maxValue: { type: ['number', 'null'] },
                  step: { type: ['number', 'null'] },
                  regexPattern: {
                    type: ['string', 'null'],
                    description: 'Must be null unless copied unchanged from the base questionnaire.'
                  },
                  regexFlags: {
                    type: ['string', 'null'],
                    description: 'Must be null unless copied unchanged from the base questionnaire.'
                  }
                }
              },
              defaultValue: { type: ['string', 'null'] },
              isKey: { type: 'boolean' },
              allowSkip: { type: 'boolean' },
              skipValue: { type: ['string', 'null'] },
              order: { type: 'integer' }
            }
          }
        },
        conditionRules: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'sourceQuestionId', 'conditions', 'logic', 'action', 'targetQuestionIds'],
            properties: {
              id: { type: 'string' },
              sourceQuestionId: { type: 'string' },
              conditions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['questionId', 'operator', 'value'],
                  properties: {
                    questionId: { type: 'string' },
                    operator: {
                      type: 'string',
                      enum: ['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'not_contains', 'is_empty', 'is_not_empty']
                    },
                    value: { type: 'string' }
                  }
                }
              },
              logic: { type: 'string', enum: ['AND', 'OR'] },
              action: { type: 'string', enum: ['skip', 'show', 'require'] },
              targetQuestionIds: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        keyQuestionIds: { type: 'array', items: { type: 'string' } }
      }
    }
  }
} as const

const PROVIDER_SCHEMA_REGISTRY = new Map<number, typeof MODEL_ENVELOPE_SCHEMA_V2>([
  [2, MODEL_ENVELOPE_SCHEMA_V2]
])

function providerSchema(schemaVersion: number | undefined): typeof MODEL_ENVELOPE_SCHEMA_V2 {
  const schema = PROVIDER_SCHEMA_REGISTRY.get(schemaVersion ?? 2)
  if (schema === undefined) throw new Error('AI_SCHEMA_NOT_REGISTERED')
  return schema
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Preserve the stable status/size error when a provider rejects cancellation.
  }
}

function cancelReaderWithoutUnhandledRejection(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined)
  } catch {
    // Abort handlers must not replace the timeout/cancellation result.
  }
}

async function boundedText(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) {
    await cancelResponseBody(response)
    throw new AIClientError('AI_RESPONSE_TOO_LARGE')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let bodyCancelled = false
  const onAbort = (): void => {
    bodyCancelled = true
    cancelReaderWithoutUnhandledRejection(reader)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      const result = await reader.read()
      if (signal?.aborted === true) throw new Error('ABORTED')
      if (result.done) break
      size += result.value.byteLength
      if (size > maxBytes) {
        bodyCancelled = true
        try {
          await reader.cancel()
        } catch {
          // Preserve the response-size error.
        }
        throw new AIClientError('AI_RESPONSE_TOO_LARGE')
      }
      chunks.push(result.value)
    }
  } catch (error) {
    if (!bodyCancelled) {
      try {
        await reader.cancel()
      } catch {
        // Preserve the original bounded-read error.
      }
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
}

type NegotiatedCapability = 'streaming' | 'response_format'

function providerErrorMetadata(text: string): { param?: string; signal: string } {
  try {
    const root = asRecord(JSON.parse(text))
    const error = asRecord(root.error)
    const param = typeof error.param === 'string' ? error.param.toLowerCase() : undefined
    const signal = [error.code, error.type, error.message]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
    return { ...(param === undefined ? {} : { param }), signal }
  } catch {
    return { signal: text.toLowerCase() }
  }
}

function unsupportedSignal(signal: string, allowInvalidParameter: boolean): boolean {
  const normalized = signal.replaceAll('_', ' ')
  return ['unsupported', 'not support', 'unknown', 'unrecognized']
    .some((term) => normalized.includes(term)) ||
    allowInvalidParameter && normalized.includes('invalid parameter')
}

function narrowlyNamesUnsupportedCapability(signal: string, capability: NegotiatedCapability): boolean {
  const patterns = capability === 'response_format'
    ? [
        /(?:unsupported|unknown|unrecognized)\s+(?:parameter\s*[:=]?\s*)?["'`]?response_format\b/,
        /\bresponse_format(?:\s+(?:json_schema|type))?\s+(?:parameter\s+)?(?:is\s+)?(?:unsupported|not supported|unknown|unrecognized)\b/,
        /\b(?:does not|doesn't)\s+support\s+(?:the\s+)?response_format\b/
      ]
    : [
        /(?:unsupported|unknown|unrecognized)\s+(?:parameter\s*[:=]?\s*)?["'`]?stream\b/,
        /\bstream\s+(?:parameter\s+)?(?:is\s+)?(?:unsupported|not supported|unknown|unrecognized|unavailable)\b/,
        /\b(?:does not|doesn't)\s+support\s+(?:the\s+)?stream(?:ing)?\b/
      ]
  return patterns.some((pattern) => pattern.test(signal))
}

function unsupportedCapability(
  status: number,
  text: string,
  capability: NegotiatedCapability
): boolean {
  if (status !== 400 && status !== 422) return false
  const metadata = providerErrorMetadata(text)
  const expectedParam = capability === 'streaming' ? 'stream' : 'response_format'
  if (metadata.param !== undefined) {
    return metadata.param === expectedParam && unsupportedSignal(metadata.signal, true)
  }
  return narrowlyNamesUnsupportedCapability(metadata.signal, capability)
}

function statusError(status: number): AIClientError {
  if (status === 401 || status === 403) return new AIClientError('AI_AUTH_ERROR')
  if (status === 404) return new AIClientError('AI_MODEL_NOT_FOUND')
  if (status === 429) return new AIClientError('AI_RATE_LIMITED')
  return new AIClientError('AI_PROVIDER_ERROR')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  return value as Record<string, unknown>
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasPayload(value: Record<string, unknown>, key: string): boolean {
  return has(value, key) && value[key] !== null && value[key] !== undefined
}

function strictCompletionContent(evidence: CompleteChoiceEvidence): string {
  if (
    evidence.choiceCount !== 1 || evidence.index !== 0 || evidence.finishReason !== 'stop' ||
    evidence.refusalPresent || evidence.toolCallPresent ||
    evidence.role !== undefined && evidence.role !== 'assistant' ||
    typeof evidence.content !== 'string' || evidence.content.length === 0
  ) {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  return evidence.content
}

function completeJsonEvidence(parsed: unknown): CompleteChoiceEvidence {
  const root = asRecord(parsed)
  if (!Array.isArray(root.choices)) throw new AIClientError('AI_INVALID_RESPONSE')
  if (root.choices.length !== 1) {
    return {
      choiceCount: root.choices.length,
      index: undefined,
      finishReason: undefined,
      content: undefined,
      role: undefined,
      refusalPresent: false,
      toolCallPresent: false
    }
  }
  const choice = asRecord(root.choices[0])
  const message = asRecord(choice.message)
  return {
    choiceCount: root.choices.length,
    index: choice.index,
    finishReason: choice.finish_reason,
    content: message.content,
    role: message.role,
    refusalPresent: hasPayload(message, 'refusal'),
    toolCallPresent: hasPayload(message, 'tool_calls') || hasPayload(message, 'function_call')
  }
}

function strictToolCallContent(parsed: unknown): string {
  const root = asRecord(parsed)
  if (!Array.isArray(root.choices) || root.choices.length !== 1) {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  const choice = asRecord(root.choices[0])
  const message = asRecord(choice.message)
  if (
    choice.index !== 0 || choice.finish_reason !== 'tool_calls' ||
    message.role !== undefined && message.role !== 'assistant' ||
    hasPayload(message, 'content') || hasPayload(message, 'refusal') ||
    hasPayload(message, 'function_call') || !Array.isArray(message.tool_calls) ||
    message.tool_calls.length !== 1
  ) {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  const toolCall = asRecord(message.tool_calls[0])
  const fn = asRecord(toolCall.function)
  if (
    toolCall.type !== 'function' || fn.name !== 'submit_questionnaire' ||
    typeof fn.arguments !== 'string' || fn.arguments.length === 0
  ) {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  return fn.arguments
}

function completionContent(text: string, questionnaireMode: boolean): string {
  try {
    const parsed: unknown = JSON.parse(text)
    return questionnaireMode
      ? strictToolCallContent(parsed)
      : strictCompletionContent(completeJsonEvidence(parsed))
  } catch (error) {
    if (error instanceof AIClientError) throw error
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
}

function contentTypeIsJson(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  return contentType.includes('application/json') || contentType.includes('+json')
}

export function createOpenAICompatibleClient(
  options: OpenAICompatibleClientOptions = {}
): { complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> } {
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const maxResponseBytes = options.maxResponseBytes ?? 2_000_000
  const maxErrorResponseBytes = options.maxErrorResponseBytes ?? 32_000
  const maxEventCount = options.maxEventCount ?? 10_000
  const maxEventBytes = Math.min(options.maxEventBytes ?? 128_000, maxResponseBytes)
  const maxPartialEventBytes = Math.min(options.maxPartialEventBytes ?? 128_000, maxResponseBytes)
  const maxStreamContentCharacters = options.maxStreamContentCharacters ?? 1_000_000
  const maxAssistantMessageCharacters = options.maxAssistantMessageCharacters ?? 20_000
  const maxCallbackDeltaCharacters = Math.min(options.maxCallbackDeltaCharacters ?? 4_096, 4_096)
  if (!Number.isSafeInteger(maxCallbackDeltaCharacters) || maxCallbackDeltaCharacters < 2) {
    throw new Error('INVALID_STREAM_LIMIT')
  }

  async function requestOnce(
    request: AIChatCompletionRequest,
    useStreaming: boolean,
    responseFormat: AIResponseFormatLevel,
    questionnaireMode: boolean
  ): Promise<
    | { kind: 'error'; status: number; text: string }
    | { kind: 'complete'; content: string; usedSse: boolean }
  > {
    if (request.signal?.aborted === true) throw new AIClientError('AI_CANCELLED')
    const controller = new AbortController()
    let timedOut = false
    let callerAborted = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onAbort = (): void => {
      callerAborted = true
      controller.abort()
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const policy = getAIProviderRequestPolicy(
        request.providerId ?? 'custom', request.baseUrl
      )
      const response = await fetcher(resolveOpenAICompatibleEndpoint(request.baseUrl, 'chat'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(request.apiKey === undefined || request.apiKey.length === 0
            ? {}
            : { authorization: `Bearer ${request.apiKey}` })
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          ...policy.chatBody,
          ...(useStreaming ? { stream: true } : {}),
          ...(questionnaireMode
            ? {
                response_format: { type: 'json_object' },
                tools: [{
                  type: 'function',
                  function: {
                    name: 'submit_questionnaire',
                    parameters: providerSchema(request.schemaVersion)
                  }
                }],
                tool_choice: {
                  type: 'function',
                  function: { name: 'submit_questionnaire' }
                }
              }
            : responseFormat === 'json_schema'
              ? {
                  response_format: {
                    type: 'json_schema',
                    json_schema: {
                      name: 'easyepi_questionnaire_envelope',
                      strict: true,
                      schema: providerSchema(request.schemaVersion)
                    }
                  }
                }
              : responseFormat === 'json_object'
                ? { response_format: { type: 'json_object' } }
                : {})
        }),
        signal: controller.signal
      })
      if (controller.signal.aborted) {
        await cancelResponseBody(response)
        throw new Error('ABORTED')
      }
      if (!response.ok && response.status !== 400 && response.status !== 422) {
        await cancelResponseBody(response)
        throw statusError(response.status)
      }
      if (!response.ok) {
        return {
          kind: 'error',
          status: response.status,
          text: await boundedText(response, maxErrorResponseBytes, controller.signal)
        }
      }
      if (!useStreaming || contentTypeIsJson(response)) {
        const text = await boundedText(response, maxResponseBytes, controller.signal)
        return {
          kind: 'complete',
          content: completionContent(text, questionnaireMode),
          usedSse: false
        }
      }
      const length = response.headers.get('content-length')
      if (length !== null && Number(length) > maxResponseBytes) {
        await cancelResponseBody(response)
        throw new AIClientError('AI_RESPONSE_TOO_LARGE')
      }
      if (response.body === null) throw new AIClientError('AI_INVALID_RESPONSE')
      const parser = createSseChatCompletionParser({
        maxEventCount,
        maxEventBytes,
        maxPartialBytes: maxPartialEventBytes,
        maxContentCharacters: maxStreamContentCharacters
      })
      const extractor = createAssistantMessageExtractor(maxAssistantMessageCharacters)
      const reader = response.body.getReader()
      let totalBytes = 0
      let callbackSequence = 0
      let readerCancelled = false
      const cancelReader = (): void => {
        readerCancelled = true
        cancelReaderWithoutUnhandledRejection(reader)
      }
      controller.signal.addEventListener('abort', cancelReader, { once: true })
      try {
        if (controller.signal.aborted) {
          cancelReader()
          throw new Error('ABORTED')
        }
        request.onModelStreaming?.()
        if (controller.signal.aborted) throw new Error('ABORTED')
        for (;;) {
          const result = await reader.read()
          if (controller.signal.aborted) throw new Error('ABORTED')
          if (result.done) break
          totalBytes += result.value.byteLength
          if (totalBytes > maxResponseBytes) {
            readerCancelled = true
            try { await reader.cancel() } catch { /* Preserve the size error. */ }
            throw new AIClientError('AI_RESPONSE_TOO_LARGE')
          }
          for (const modelDelta of parser.push(result.value)) {
            const safeDelta = extractor.push(modelDelta.content).join('')
            for (let offset = 0; offset < safeDelta.length;) {
              let end = Math.min(offset + maxCallbackDeltaCharacters, safeDelta.length)
              if (
                end < safeDelta.length &&
                safeDelta.charCodeAt(end - 1) >= 0xd800 && safeDelta.charCodeAt(end - 1) <= 0xdbff &&
                safeDelta.charCodeAt(end) >= 0xdc00 && safeDelta.charCodeAt(end) <= 0xdfff
              ) {
                end -= 1
              }
              request.onContentDelta?.({
                content: safeDelta.slice(offset, end),
                sequence: ++callbackSequence
              })
              offset = end
            }
          }
        }
        const streamCompletion = parser.finish()
        if (streamCompletion.toolArguments !== undefined) {
          const evidence = streamCompletion.choice
          if (
            !questionnaireMode || evidence.choiceCount !== 1 || evidence.index !== 0 ||
            evidence.finishReason !== 'tool_calls' || evidence.refusalPresent ||
            !evidence.toolCallPresent || evidence.role !== undefined && evidence.role !== 'assistant' ||
            streamCompletion.content.length > 0
          ) {
            throw new AIClientError('AI_INVALID_RESPONSE')
          }
          return { kind: 'complete', content: streamCompletion.toolArguments, usedSse: true }
        }
        const streamed = streamCompletion.content
        const extracted = extractor.finish()
        let parsedEnvelope: unknown
        try {
          parsedEnvelope = JSON.parse(streamed)
        } catch {
          throw new AIClientError('AI_INVALID_RESPONSE')
        }
        const root = asRecord(parsedEnvelope)
        if (typeof root.assistantMessage !== 'string' || root.assistantMessage !== extracted) {
          throw new AIClientError('AI_INVALID_RESPONSE')
        }
        const content = strictCompletionContent(streamCompletion.choice)
        return { kind: 'complete', content, usedSse: true }
      } catch (error) {
        if (!readerCancelled) {
          try { await reader.cancel() } catch { /* Preserve the parse/read error. */ }
        }
        if (error instanceof OpenAIStreamParseError) {
          throw new AIClientError(error.kind === 'limit' ? 'AI_RESPONSE_TOO_LARGE' : 'AI_INVALID_RESPONSE')
        }
        throw error
      } finally {
        controller.signal.removeEventListener('abort', cancelReader)
        reader.releaseLock()
      }
    } catch (error) {
      if (callerAborted) throw new AIClientError('AI_CANCELLED')
      if (timedOut) throw new AIClientError('AI_TIMEOUT')
      if (error instanceof AIClientError) throw error
      throw new AIClientError('AI_NETWORK_ERROR')
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    async complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> {
      let validated: ReturnType<typeof validateAIConfigUpdate>
      try {
        validated = validateAIConfigUpdate(request)
      } catch {
        throw new Error('INVALID_AI_CONFIG')
      }
      const safeRequest: AIChatCompletionRequest = {
        ...request,
        providerId: validated.providerId,
        baseUrl: validated.baseUrl,
        model: validated.model,
        apiKey: typeof validated.apiKey === 'string' ? validated.apiKey : undefined
      }
      const questionnaireMode = safeRequest.schemaVersion !== undefined
      const policy = getAIProviderRequestPolicy(
        safeRequest.providerId ?? 'custom', safeRequest.baseUrl
      )
      let responseFormat: AIResponseFormatLevel = questionnaireMode
        ? 'json_object'
        : safeRequest.responseFormatSupported === false
          ? 'text'
          : policy.responseFormat
      if (questionnaireMode || responseFormat === 'json_schema') providerSchema(request.schemaVersion)
      let useStreaming = safeRequest.streamingSupported !== false
      for (let negotiation = 0; negotiation < 4; negotiation += 1) {
        const result = await requestOnce(safeRequest, useStreaming, responseFormat, questionnaireMode)
        if (result.kind === 'complete') {
          if (useStreaming && !result.usedSse) {
            useStreaming = false
            safeRequest.onCapabilityFallback?.('streaming')
          }
          return {
            content: result.content,
            streamingSupported: useStreaming && result.usedSse,
            responseFormatSupported: questionnaireMode || responseFormat !== 'text',
            toolCallingSupported: questionnaireMode
          }
        }
        if (
          !questionnaireMode && responseFormat !== 'text' &&
          unsupportedCapability(result.status, result.text, 'response_format')
        ) {
          if (responseFormat === 'json_schema' && result.text.toLowerCase().includes('json_schema')) {
            responseFormat = 'json_object'
          } else {
            responseFormat = 'text'
            safeRequest.onCapabilityFallback?.('response_format')
          }
          continue
        }
        if (useStreaming && unsupportedCapability(result.status, result.text, 'streaming')) {
          useStreaming = false
          safeRequest.onCapabilityFallback?.('streaming')
          continue
        }
        throw statusError(result.status)
      }
      throw new AIClientError('AI_PROVIDER_ERROR')
    }
  }
}
