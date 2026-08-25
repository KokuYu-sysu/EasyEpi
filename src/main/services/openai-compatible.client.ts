import { normalizeAIBaseUrl, validateAIConfigUpdate } from './ai-config.service'

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
  baseUrl: string
  model: string
  apiKey?: string
  messages: AIChatMessage[]
  signal?: AbortSignal
  /** False means this provider/model was already proven not to support JSON schema. */
  responseFormatSupported?: boolean
}

export interface AIChatCompletionResult {
  content: string
  responseFormatSupported: boolean
}

export interface OpenAICompatibleClientOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

const QUESTIONNAIRE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assistantMessage', 'rollingSummary', 'questionnaire'],
  properties: {
    assistantMessage: { type: 'string' },
    rollingSummary: { type: 'string' },
    questionnaire: {
      type: 'object',
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
                  regexPattern: { type: ['string', 'null'] },
                  regexFlags: { type: ['string', 'null'] }
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

function endpoint(baseUrl: string): string {
  const normalized = normalizeAIBaseUrl(baseUrl)
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) throw new AIClientError('AI_RESPONSE_TOO_LARGE')
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new AIClientError('AI_RESPONSE_TOO_LARGE')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function unsupportedResponseFormat(status: number, text: string): boolean {
  if (status < 400 || status >= 500) return false
  const normalized = text.toLowerCase()
  return (normalized.includes('response_format') || normalized.includes('json_schema')) &&
    ['unsupported', 'not support', 'unknown', 'unrecognized', 'invalid parameter'].some((term) => normalized.includes(term))
}

function statusError(status: number): AIClientError {
  if (status === 401 || status === 403) return new AIClientError('AI_AUTH_ERROR')
  if (status === 404) return new AIClientError('AI_MODEL_NOT_FOUND')
  if (status === 429) return new AIClientError('AI_RATE_LIMITED')
  return new AIClientError('AI_PROVIDER_ERROR')
}

function completionContent(text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  if (typeof parsed !== 'object' || parsed === null || !('choices' in parsed) || !Array.isArray(parsed.choices)) {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  const choice = parsed.choices[0]
  if (typeof choice !== 'object' || choice === null || !('message' in choice)) throw new AIClientError('AI_INVALID_RESPONSE')
  const message = choice.message
  if (typeof message !== 'object' || message === null || !('content' in message) || typeof message.content !== 'string' || message.content.length === 0) {
    throw new AIClientError('AI_INVALID_RESPONSE')
  }
  return message.content
}

export function createOpenAICompatibleClient(
  options: OpenAICompatibleClientOptions = {}
): { complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> } {
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const maxResponseBytes = options.maxResponseBytes ?? 2_000_000

  async function requestOnce(
    request: AIChatCompletionRequest,
    useResponseFormat: boolean
  ): Promise<{ response: Response; text: string }> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onAbort = (): void => controller.abort()
    request.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetcher(endpoint(request.baseUrl), {
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
          ...(useResponseFormat
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: 'easyepi_questionnaire_envelope',
                    strict: true,
                    schema: QUESTIONNAIRE_SCHEMA
                  }
                }
              }
            : {})
        }),
        signal: controller.signal
      })
      return { response, text: await boundedText(response, maxResponseBytes) }
    } catch (error) {
      if (error instanceof AIClientError) throw error
      if (request.signal?.aborted === true) throw new AIClientError('AI_CANCELLED')
      if (timedOut) throw new AIClientError('AI_TIMEOUT')
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
        baseUrl: validated.baseUrl,
        model: validated.model,
        apiKey: typeof validated.apiKey === 'string' ? validated.apiKey : undefined
      }
      const preferSchema = safeRequest.responseFormatSupported !== false
      let result = await requestOnce(safeRequest, preferSchema)
      if (!result.response.ok && preferSchema && unsupportedResponseFormat(result.response.status, result.text)) {
        result = await requestOnce(safeRequest, false)
        if (!result.response.ok) throw statusError(result.response.status)
        return { content: completionContent(result.text), responseFormatSupported: false }
      }
      if (!result.response.ok) throw statusError(result.response.status)
      return { content: completionContent(result.text), responseFormatSupported: preferSchema }
    }
  }
}
