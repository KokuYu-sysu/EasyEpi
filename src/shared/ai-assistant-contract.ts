import {
  isConditionOperator,
  isConstraintType,
  isQuestionType,
  type QuestionnaireDef
} from './types/qnaire'
import { isDerivedResultType } from './types/derived'
import { isUUIDv4 } from './types/project'
import {
  AI_PUBLIC_VALIDATION_SUMMARIES,
  isAIPublicValidationCode,
  type AIPublicValidationCode
} from './ai-public-validation'

export type AIJsonValue =
  | string
  | number
  | boolean
  | null
  | AIJsonValue[]
  | { [key: string]: AIJsonValue }

export const AI_PROVIDER_IDS = [
  'openai',
  'deepseek',
  'gemini',
  'qwen',
  'moonshot',
  'glm',
  'xai',
  'mimo',
  'custom'
] as const

export type AIProviderId = (typeof AI_PROVIDER_IDS)[number]
export type AIResearchStatus = 'searched' | 'not_needed' | 'disabled' | 'unsupported' | 'failed'
export interface AIResearchCitation { url: string; title: string }

export function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

export interface AIProviderConfigUpdate {
  providerId?: AIProviderId
  baseUrl: string
  model: string
  webSearchEnabled?: boolean
  /** Undefined preserves the stored key; null or an empty string clears it. */
  apiKey?: string | null
}

export interface AIProviderConfigView {
  providerId?: AIProviderId
  baseUrl: string
  model: string
  webSearchEnabled?: boolean
  hasApiKey: boolean
  maskedApiKey: string | null
}

export const AI_MASKED_API_KEY = '••••••••'

export type AIProviderConfigErrorCode =
  | 'INVALID_AI_CONFIG'
  | 'AI_CONFIG_READ_FAILED'
  | 'AI_CONFIG_SAVE_FAILED'
  | 'AI_SECURE_STORAGE_UNAVAILABLE'

export type AIProviderConfigResult =
  | { ok: true; config: AIProviderConfigView }
  | { ok: false; code: AIProviderConfigErrorCode }

export const AI_PRIVACY_NOTICE =
  '只有对话内容会被读取并发送，其余隐私信息均不会被发送和读取。'
export const AI_PRIVACY_NOTICE_VERSION = 1

export const AI_CONFIG_GET_CHANNEL = 'ai:config:get'
export const AI_CONFIG_UPDATE_CHANNEL = 'ai:config:update'
export const AI_CONFIG_CLEAR_CHANNEL = 'ai:config:clear'
export const AI_CONFIG_TEST_CONNECTION_CHANNEL = 'ai:config:testConnection'
export const AI_PRIVACY_STATUS_CHANNEL = 'ai:privacy:status'
export const AI_PRIVACY_ACCEPT_CHANNEL = 'ai:privacy:accept'
export const AI_SESSION_CREATE_CHANNEL = 'ai:session:create'
export const AI_SESSION_LIST_CHANNEL = 'ai:session:list'
export const AI_SESSION_GET_CHANNEL = 'ai:session:get'
export const AI_SESSION_UPDATE_CHANNEL = 'ai:session:update'
export const AI_SESSION_DELETE_CHANNEL = 'ai:session:delete'
export const AI_SESSION_CLEAR_CACHE_CHANNEL = 'ai:session:clearCache'
export const AI_SESSION_MIGRATE_CHANNEL = 'ai:session:migrate'
export const AI_SEND_CHANNEL = 'ai:send'
export const AI_CANCEL_CHANNEL = 'ai:cancel'
export const AI_PROGRESS_CHANNEL = 'ai:progress'
export const AI_ARTIFACT_PREVIEW_CHANNEL = 'ai:artifact:preview'
export const AI_ARTIFACT_APPLY_CHANNEL = 'ai:artifact:apply'

export type AIMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AIMessage {
  id: string
  role: AIMessageRole
  content: string
  createdAt: string
  runId?: string
}

export interface AIMessageAttachment {
  attachmentId: string
  messageId: string
  kind: string
  createdAt: string
  value: AIJsonValue
}

export interface AiVersionStamp {
  promptId: string
  promptVersion: string
  promptHash: string
  harnessVersion: string
  schemaVersion: number
}

export type AISessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export type AIProgressStage =
  | 'starting'
  | 'connecting'
  | 'streaming'
  | 'validating'
  | 'repairing'
  | 'clarification'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AIQuickReplyOption {
  id: string
  label: string
}

export interface AIClarification {
  clarificationId: string
  messageId: string
  runId: string
  options: AIQuickReplyOption[]
  status: 'unresolved' | 'resolved'
  createdAt: string
  resolvedAt?: string
  resolvedByMessageId?: string
  selectedOptionId?: string
}

export interface AIPublicClarification {
  clarificationId: string
  options: AIQuickReplyOption[]
  status: 'unresolved' | 'resolved'
  selectedOptionId: string | null
  resolvedByMessageId: string | null
}

export interface AIPublicValidationIssue {
  code: AIPublicValidationCode
  field: string
  summary: string
}

export interface AIPublicAttemptFailure {
  attempt: 1 | 2 | 3
  issues: AIPublicValidationIssue[]
  truncated: boolean
}

export interface AIPublicFailureDetails {
  attempts: AIPublicAttemptFailure[]
}

export interface AIPublicRunSnapshot {
  requestId: string
  runId: string
  stage: AIProgressStage
  attempt: 1 | 2 | 3
  startedAt: string
  updatedAt: string
  streamFallback: boolean
}

export interface AIRunProgress {
  stage: AIProgressStage
  attempt: 1 | 2 | 3
  updatedAt: string
  streamFallback: boolean
}

export interface AIRunFailure {
  errorCode: string
  completedAt: string
  details: AIPublicFailureDetails
}

export type AIRunResult =
  | {
      kind: 'questionnaire'; artifactId: string
      researchStatus?: AIResearchStatus; citations?: AIResearchCitation[]
    }
  | {
      kind: 'clarification'; messageId: string; clarificationId: string
      researchStatus?: AIResearchStatus; citations?: AIResearchCitation[]
    }

export interface AIRun {
  runId: string
  status: Exclude<AISessionStatus, 'idle'>
  startedAt: string
  completedAt?: string
  versionStamp: AiVersionStamp
  errorCode?: string
  /** Optional so pre-v2 persisted run records remain readable until explicit migration. */
  requestId?: string
  operationId?: string
  userMessageId?: string
  progress?: AIRunProgress
  failure?: AIRunFailure
  result?: AIRunResult
}

export interface AISessionState {
  status: AISessionStatus
  activeRunId?: string
  runs: Record<string, AIRun>
  values: Record<string, AIJsonValue>
}

export interface AIConversationPartition {
  messages: AIMessage[]
  attachments: Record<string, AIMessageAttachment>
  /** Present for v2 Sessions; absent on legacy records until explicit migration. */
  clarifications?: Record<string, AIClarification>
}

export interface AICachePartition {
  values: Record<string, AIJsonValue>
}

export type AIArtifactStatus = 'pending' | 'completed' | 'failed'

export interface AIArtifact {
  /** Stable idempotency key for this artifact. */
  artifactId: string
  /** Stable idempotency key for the operation that produced it. */
  operationId: string
  kind: string
  status: AIArtifactStatus
  versionStamp: AiVersionStamp
  createdAt: string
  updatedAt: string
  value?: AIJsonValue
  errorCode?: string
}

export interface AIArtifactsPartition {
  byId: Record<string, AIArtifact>
}

export interface AIRunTemp {
  runId: string
  versionStamp: AiVersionStamp
  createdAt: string
  values: Record<string, AIJsonValue>
}

export interface AITempPartition {
  runs: Record<string, AIRunTemp>
}

export interface AISessionManifest {
  sessionId: string
  title: string
  /** Immutable except through the explicit, audited Session migration API. */
  versionStamp: AiVersionStamp
  createdAt: string
  updatedAt: string
}

export interface AIPublicMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  clarification: AIPublicClarification | null
}

export interface AIPublicFailureRecord {
  runId: string
  userMessageId: string
  completedAt: string
  errorCode: string
  details: AIPublicFailureDetails
}

export interface AIPublicAttachmentSummary {
  attachmentId: string
  messageId: string
  kind: 'questionnaire'
  createdAt: string
}

export interface AIArtifactSummary {
  artifactId: string
  operationId: string
  kind: string
  status: AIArtifactStatus
  createdAt: string
  updatedAt: string
}

export interface AISessionPage {
  manifest: AISessionManifest
  messages: AIPublicMessage[]
  attachments: AIPublicAttachmentSummary[]
  status: AISessionStatus
  activeArtifactId: string | null
  activeRun: AIPublicRunSnapshot | null
  failures: AIPublicFailureRecord[]
  artifacts: AIArtifactSummary[]
  total: number
  nextOffset: number | null
}

export const AI_SESSION_PAGE_MAX_UTF8_BYTES = 1_048_576

export type AISessionListItem = AISessionManifest

export interface AISessionData {
  manifest: AISessionManifest
  /** Persistent. */
  conversation: AIConversationPartition
  /** Persistent. */
  state: AISessionState
  /** Rebuildable. */
  cache: AICachePartition
  /** Persistent. */
  artifacts: AIArtifactsPartition
  /** Cleared during startup recovery and removable per run. */
  temp: AITempPartition
}

export interface AIAssistantProjectData {
  schemaVersion: 1
  sessions: Record<string, AISessionData>
}

export type AISessionPartition =
  | 'conversation'
  | 'state'
  | 'cache'
  | 'artifacts'
  | 'temp'

export interface AISessionVirtualPath {
  sessionId: string
  partition: AISessionPartition
  segments: string[]
}

export interface AIMutationResult<T> {
  value: T
  mutated: boolean
}

export interface AIConfigUpdateRequest {
  providerId?: AIProviderId
  baseUrl: string
  model: string
  webSearchEnabled?: boolean
  apiKey?: string | null
}

export interface AISessionCreateRequest {
  title?: string
}

export interface AISessionIdRequest {
  sessionId: string
}

export interface AISessionGetRequest extends AISessionIdRequest {
  offset?: number
  limit?: number
}

export interface AISessionUpdateRequest {
  sessionId: string
  title: string
}

export interface AISendRequest {
  requestId: string
  sessionId: string
  content: string
  includeCurrentQuestionnaire: boolean
  clarificationSelection?: {
    clarificationId: string
    optionId: string
  }
}

export interface AICancelRequest {
  requestId: string
}

export interface AIArtifactRequest {
  sessionId: string
  artifactId: string
}

export interface AIArtifactApplyRequest extends AIArtifactRequest {
  operationId?: string
}

export interface AIArtifactPreview {
  draft: QuestionnaireDef
  diff: {
    metadata: {
      name: { before: string; after: string } | null
      description: { before: string | null; after: string | null } | null
    }
    questions: {
      added: Array<{ id: string; variableName: string; content: string }>
      removed: Array<{ id: string; variableName: string; content: string }>
      modified: Array<{ id: string; variableName: string; fields: string[] }>
    }
    rules: { added: string[]; removed: string[]; modified: string[] }
  }
  assistantMessage: string
  rollingSummary: string
  validation: { success: true; errors: [] }
  baseQuestionnaireRevision: string
  baseQuestionnaireHash: string
  baseQuestionnaire: QuestionnaireDef
}

export interface AIQuestionnaireArtifactPreviewDto {
  artifactId: string
  operationId: string
  kind: 'questionnaire-draft'
  status: 'completed'
  createdAt: string
  updatedAt: string
  value: AIArtifactPreview
}

export interface AIErrorResult {
  ok: false
  errorCode: string
  message: string
}

interface AIProgressEventBase {
  requestId: string
  sessionId: string
  runId: string
  at: string
}

export type AIProgressEvent =
  | (AIProgressEventBase & { type: 'started' })
  | (AIProgressEventBase & { type: 'attempt_started'; attempt: 1 | 2 | 3 })
  | (AIProgressEventBase & { type: 'model_streaming'; attempt: 1 | 2 | 3 })
  | (AIProgressEventBase & {
      type: 'assistant_delta'
      attempt: 1 | 2 | 3
      sequence: number
      delta: string
    })
  | (AIProgressEventBase & { type: 'validating'; attempt: 1 | 2 | 3 })
  | (AIProgressEventBase & {
      type: 'validation_failed'
      attempt: 1 | 2 | 3
      failure: AIPublicAttemptFailure
    })
  | (AIProgressEventBase & {
      type: 'repairing'
      attempt: 1 | 2
      nextAttempt: 2 | 3
    })
  | (AIProgressEventBase & {
      type: 'capability_fallback'
      attempt: 1 | 2 | 3
      capability: 'streaming' | 'response_format'
      reason: 'unsupported'
    })
  | (AIProgressEventBase & {
      type: 'clarification'
      attempt: 1 | 2 | 3
      outcome: 'clarification'
      messageId: string
      clarification: AIPublicClarification
    })
  | (AIProgressEventBase & {
      type: 'completed'
      attempt: 1 | 2 | 3
      outcome: 'questionnaire'
      artifactId: string
    })
  | (AIProgressEventBase & {
      type: 'failed'
      attempt: 1 | 2 | 3
      errorCode: string
      details?: AIPublicFailureDetails
    })
  | (AIProgressEventBase & {
      type: 'cancelled'
      attempt: 1 | 2 | 3
      errorCode: 'AI_CANCELLED'
    })

export interface AIProgressSubscriptionScope {
  requestId: string
  sessionId: string
}

export type AIConfigIpcResult = { ok: true; config: AIProviderConfigView } | AIErrorResult
export type AIConnectionTestResult = { ok: true } | AIErrorResult
export type AIPrivacyStatusResult =
  | { ok: true; accepted: boolean; acceptedAt: string | null; notice: typeof AI_PRIVACY_NOTICE }
  | AIErrorResult
export type AISessionResult = { ok: true; session: AISessionListItem } | AIErrorResult
export type AISessionPageResult = { ok: true; session: AISessionPage } | AIErrorResult
export type AISessionListResult = { ok: true; sessions: AISessionListItem[] } | AIErrorResult
export type AISessionDeleteResult = { ok: true; deleted: boolean } | AIErrorResult
export type AISessionClearCacheResult = { ok: true; removed: number } | AIErrorResult
export type AISessionMigrateResult =
  | { ok: true; migrated: boolean; session: AISessionListItem }
  | AIErrorResult
export type AISendResult =
  | {
      ok: true
      requestId: string
      outcome: 'questionnaire'
      artifact: AIQuestionnaireArtifactPreviewDto
      attempts: number
      researchStatus?: AIResearchStatus
      citations?: AIResearchCitation[]
    }
  | {
      ok: true
      requestId: string
      outcome: 'clarification'
      message: AIPublicMessage
      attempts: number
      researchStatus?: AIResearchStatus
      citations?: AIResearchCitation[]
    }
  | (AIErrorResult & { details?: AIPublicFailureDetails })
export type AICancelResult = { ok: true; cancelled: boolean } | AIErrorResult
export type AIArtifactPreviewResult = { ok: true; preview: AIArtifactPreview } | AIErrorResult
export type AIArtifactApplyResult =
  | {
      ok: true
      applied: boolean
      questionnaire: QuestionnaireDef
      preview: AIArtifactPreview
    }
  | AIErrorResult

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('INVALID_AI_REQUEST')
  }
}

function safeString(value: unknown, maxLength: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength ||
    value !== value.trim() || value.includes('\0') || (pattern !== undefined && !pattern.test(value))) {
    throw new Error('INVALID_AI_REQUEST')
  }
  return value
}

function requestObject(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_REQUEST')
  return value
}

export function parseAIConfigUpdateRequest(value: unknown): AIConfigUpdateRequest {
  const input = requestObject(value)
  exactKeys(input, ['providerId', 'baseUrl', 'model', 'webSearchEnabled'], ['apiKey'])
  if (!isAIProviderId(input.providerId) || typeof input.webSearchEnabled !== 'boolean') {
    throw new Error('INVALID_AI_REQUEST')
  }
  const baseUrl = safeString(input.baseUrl, 2_048)
  const model = safeString(input.model, 200)
  const apiKey = input.apiKey
  if (apiKey !== undefined && apiKey !== null &&
    (typeof apiKey !== 'string' || apiKey.length > 8_192 || apiKey.includes('\0'))) {
    throw new Error('INVALID_AI_REQUEST')
  }
  return {
    providerId: input.providerId,
    baseUrl,
    model,
    webSearchEnabled: input.webSearchEnabled,
    ...(apiKey === undefined ? {} : { apiKey })
  }
}

export function parseAISessionCreateRequest(value: unknown): AISessionCreateRequest {
  const input = requestObject(value)
  exactKeys(input, [], ['title'])
  return input.title === undefined ? {} : { title: safeString(input.title, 120) }
}

export function parseAISessionIdRequest(value: unknown): AISessionIdRequest {
  const input = requestObject(value)
  exactKeys(input, ['sessionId'])
  return { sessionId: safeString(input.sessionId, 36, SESSION_ID_PATTERN) }
}

export function parseAISessionGetRequest(value: unknown): Required<AISessionGetRequest> {
  const input = requestObject(value)
  exactKeys(input, ['sessionId'], ['offset', 'limit'])
  const offset = input.offset ?? 0
  const limit = input.limit ?? 50
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 ||
    !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100) {
    throw new Error('INVALID_AI_REQUEST')
  }
  return {
    sessionId: safeString(input.sessionId, 36, SESSION_ID_PATTERN),
    offset: Number(offset),
    limit: Number(limit)
  }
}

export function parseAISessionUpdateRequest(value: unknown): AISessionUpdateRequest {
  const input = requestObject(value)
  exactKeys(input, ['sessionId', 'title'])
  return {
    sessionId: safeString(input.sessionId, 36, SESSION_ID_PATTERN),
    title: safeString(input.title, 120)
  }
}

export function parseAISendRequest(value: unknown): AISendRequest {
  const input = requestObject(value)
  exactKeys(
    input,
    ['requestId', 'sessionId', 'content', 'includeCurrentQuestionnaire'],
    ['clarificationSelection']
  )
  if (typeof input.includeCurrentQuestionnaire !== 'boolean') throw new Error('INVALID_AI_REQUEST')
  if (typeof input.content !== 'string') throw new Error('INVALID_AI_REQUEST')
  const content = input.content
  if (content.length > 100_000 || content.includes('\0')) {
    throw new Error('INVALID_AI_REQUEST')
  }
  let clarificationSelection: AISendRequest['clarificationSelection']
  if (input.clarificationSelection === undefined) {
    if (content.trim().length === 0) throw new Error('INVALID_AI_REQUEST')
  } else {
    if (content !== '') throw new Error('INVALID_AI_REQUEST')
    const selection = requestObject(input.clarificationSelection)
    exactKeys(selection, ['clarificationId', 'optionId'])
    clarificationSelection = {
      clarificationId: safeString(selection.clarificationId, 128, PUBLIC_ID_PATTERN),
      optionId: safeString(selection.optionId, 128, PUBLIC_ID_PATTERN)
    }
  }
  return {
    requestId: safeString(input.requestId, 128, PUBLIC_ID_PATTERN),
    sessionId: safeString(input.sessionId, 36, SESSION_ID_PATTERN),
    content,
    includeCurrentQuestionnaire: input.includeCurrentQuestionnaire,
    ...(clarificationSelection === undefined ? {} : { clarificationSelection })
  }
}

export function parseAICancelRequest(value: unknown): AICancelRequest {
  const input = requestObject(value)
  exactKeys(input, ['requestId'])
  return { requestId: safeString(input.requestId, 128, PUBLIC_ID_PATTERN) }
}

export function parseAIArtifactRequest(value: unknown): AIArtifactRequest {
  const input = requestObject(value)
  exactKeys(input, ['sessionId', 'artifactId'])
  return {
    sessionId: safeString(input.sessionId, 36, SESSION_ID_PATTERN),
    artifactId: safeString(input.artifactId, 128, PUBLIC_ID_PATTERN)
  }
}

export function parseAIArtifactApplyRequest(value: unknown): AIArtifactApplyRequest {
  const input = requestObject(value)
  exactKeys(input, ['sessionId', 'artifactId'], ['operationId'])
  return {
    sessionId: safeString(input.sessionId, 36, SESSION_ID_PATTERN),
    artifactId: safeString(input.artifactId, 128, PUBLIC_ID_PATTERN),
    ...(input.operationId === undefined
      ? {}
      : { operationId: safeString(input.operationId, 128, PUBLIC_ID_PATTERN) })
  }
}

const MAX_RESPONSE_DEPTH = 24
const MAX_RESPONSE_NODES = 100_000
const MAX_RESPONSE_COLLECTION = 10_000
const MAX_RESPONSE_STRING = 2_000_000
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const SENSITIVE_KEY_PARTS = ['apikey', 'password', 'path', 'stack', 'recovery', 'secret', 'credential']
const SAFE_SENSITIVE_KEYS = new Set(['hasApiKey', 'maskedApiKey'])

function invalidResponse(): never {
  throw new Error('INVALID_AI_RESPONSE')
}

function responseKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (!isPlainObject(value)) invalidResponse()
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))) invalidResponse()
  return value
}

function responseString(value: unknown, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0') ||
    (!allowEmpty && value.length === 0)) invalidResponse()
  return value
}

function responseId(value: unknown, pattern = PUBLIC_ID_PATTERN): string {
  const id = responseString(value, 128)
  if (!pattern.test(id)) invalidResponse()
  return id
}

function responseTimestamp(value: unknown): string {
  const timestamp = responseString(value, 64)
  if (!Number.isFinite(Date.parse(timestamp))) invalidResponse()
  return timestamp
}

function responseAttempt(value: unknown): 1 | 2 | 3 {
  const attempt = responseNumber(value, true)
  if (attempt < 1 || attempt > 3) invalidResponse()
  return attempt as 1 | 2 | 3
}

function responseErrorCode(value: unknown): string {
  const code = responseString(value, 128)
  if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(code)) invalidResponse()
  return code
}

function hasControlCharacter(value: string, allowFormattingWhitespace = false): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
    const isFormattingWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
    if (isControl && (!allowFormattingWhitespace || !isFormattingWhitespace)) return true
  }
  return false
}

function responsePlainText(value: unknown, maxLength: number): string {
  const text = responseString(value, maxLength)
  if (text !== text.trim() || hasControlCharacter(text)) invalidResponse()
  return text
}

function responseReadableText(value: unknown, maxLength: number, allowEmpty = false): string {
  const text = responseString(value, maxLength, allowEmpty)
  if (hasControlCharacter(text, true)) invalidResponse()
  return text
}

function responseNumber(value: unknown, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    invalidResponse()
  }
  return value
}

function assertSafeResponseTree(value: unknown): void {
  const seen = new Set<object>()
  let nodes = 0
  const visit = (current: unknown, depth: number): void => {
    nodes += 1
    if (nodes > MAX_RESPONSE_NODES || depth > MAX_RESPONSE_DEPTH) invalidResponse()
    if (current === null || typeof current === 'boolean') return
    if (typeof current === 'string') {
      if (current.length > MAX_RESPONSE_STRING || current.includes('\0')) invalidResponse()
      return
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) invalidResponse()
      return
    }
    if (typeof current !== 'object' || seen.has(current)) invalidResponse()
    seen.add(current)
    if (Array.isArray(current)) {
      if (current.length > MAX_RESPONSE_COLLECTION) invalidResponse()
      for (const item of current) visit(item, depth + 1)
    } else {
      if (!isPlainObject(current) || Object.keys(current).length > MAX_RESPONSE_COLLECTION) {
        invalidResponse()
      }
      for (const [key, item] of Object.entries(current)) {
        if (key.length === 0 || key.length > 128 || DANGEROUS_KEYS.has(key)) invalidResponse()
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (!SAFE_SENSITIVE_KEYS.has(key) &&
          SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))) {
          invalidResponse()
        }
        visit(item, depth + 1)
      }
    }
    seen.delete(current)
  }
  visit(value, 0)
}

function parseKnownResponse<T>(
  value: unknown,
  successKeys: readonly string[],
  validate: (input: Record<string, unknown>) => void
): T {
  assertSafeResponseTree(value)
  const input = responseKeys(value, ['ok'], value !== null && typeof value === 'object' &&
    'ok' in value && value.ok === false ? ['errorCode', 'message'] : successKeys)
  if (input.ok === false) {
    responseKeys(input, ['ok', 'errorCode', 'message'])
    responseErrorCode(input.errorCode)
    responseString(input.message, 200)
  } else {
    if (input.ok !== true) invalidResponse()
    responseKeys(input, ['ok', ...successKeys])
    validate(input)
  }
  return structuredClone(input) as T
}

function assertVersionStamp(value: unknown): void {
  const input = responseKeys(
    value,
    ['promptId', 'promptVersion', 'promptHash', 'harnessVersion', 'schemaVersion']
  )
  responseString(input.promptId, 128)
  responseString(input.promptVersion, 64)
  responseString(input.promptHash, 256)
  responseString(input.harnessVersion, 64)
  const schemaVersion = responseNumber(input.schemaVersion, true)
  if (schemaVersion < 1 || schemaVersion > 1_000) invalidResponse()
}

function assertQuestionnaire(value: unknown, allowDerivedVariables: boolean): void {
  const input = responseKeys(
    value,
    ['name', 'questions', 'conditionRules', 'keyQuestionIds'],
    allowDerivedVariables ? ['description', 'derivedVariables'] : ['description']
  )
  responseString(input.name, 20_000, true)
  if (input.description !== undefined) responseString(input.description, 20_000, true)
  if (!Array.isArray(input.questions) || input.questions.length > 500 ||
    !Array.isArray(input.conditionRules) || input.conditionRules.length > 1_000 ||
    !Array.isArray(input.keyQuestionIds) || input.keyQuestionIds.length > 500) invalidResponse()
  for (const question of input.questions) {
    const item = responseKeys(
      question,
      ['id', 'content', 'variableName', 'type', 'options', 'constraint', 'isKey', 'allowSkip', 'order'],
      ['defaultValue', 'skipValue']
    )
    responseId(item.id)
    responseString(item.content, 20_000, true)
    responseString(item.variableName, 128)
    if (typeof item.type !== 'string' || !isQuestionType(item.type)) invalidResponse()
    if (!Array.isArray(item.options) || item.options.length > 1_000) invalidResponse()
    for (const option of item.options) {
      const parsed = responseKeys(option, ['value', 'label'])
      responseString(parsed.value, 20_000, true)
      responseString(parsed.label, 20_000, true)
    }
    const constraint = responseKeys(
      item.constraint,
      ['type'],
      ['fixedLength', 'minValue', 'maxValue', 'step', 'regexPattern', 'regexFlags']
    )
    if (typeof constraint.type !== 'string' || !isConstraintType(constraint.type)) invalidResponse()
    for (const key of ['fixedLength', 'minValue', 'maxValue', 'step'] as const) {
      if (constraint[key] !== undefined) responseNumber(constraint[key], key === 'fixedLength')
    }
    if (constraint.regexPattern !== undefined) responseString(constraint.regexPattern, 20_000, true)
    if (constraint.regexFlags !== undefined) responseString(constraint.regexFlags, 32, true)
    if (item.defaultValue !== undefined) responseString(item.defaultValue, 20_000, true)
    if (typeof item.isKey !== 'boolean' || typeof item.allowSkip !== 'boolean') invalidResponse()
    if (item.skipValue !== undefined) responseString(item.skipValue, 20_000, true)
    const order = responseNumber(item.order, true)
    if (order < 0 || order >= input.questions.length) invalidResponse()
  }
  for (const rule of input.conditionRules) {
    const item = responseKeys(
      rule,
      ['id', 'sourceQuestionId', 'conditions', 'logic', 'action', 'targetQuestionIds']
    )
    responseId(item.id)
    responseId(item.sourceQuestionId)
    if (!Array.isArray(item.conditions) || item.conditions.length > 500 ||
      !Array.isArray(item.targetQuestionIds) || item.targetQuestionIds.length > 500) invalidResponse()
    for (const condition of item.conditions) {
      const parsed = responseKeys(condition, ['questionId', 'operator', 'value'])
      responseId(parsed.questionId)
      if (typeof parsed.operator !== 'string' || !isConditionOperator(parsed.operator)) invalidResponse()
      responseString(parsed.value, 20_000, true)
    }
    if (item.logic !== 'AND' && item.logic !== 'OR') invalidResponse()
    if (item.action !== 'skip' && item.action !== 'show' && item.action !== 'require') invalidResponse()
    for (const id of item.targetQuestionIds) responseId(id)
  }
  for (const id of input.keyQuestionIds) responseId(id)
  if (input.derivedVariables !== undefined) {
    if (!allowDerivedVariables || !Array.isArray(input.derivedVariables) ||
      input.derivedVariables.length > 500) invalidResponse()
    for (const derived of input.derivedVariables) {
      const item = responseKeys(
        derived,
        ['id', 'variableName', 'label', 'formula', 'resultType', 'order'],
        ['displayDecimals']
      )
      responseId(item.id)
      responseString(item.variableName, 128)
      responseString(item.label, 20_000, true)
      responseString(item.formula, 100_000)
      if (!isDerivedResultType(item.resultType)) invalidResponse()
      const order = responseNumber(item.order, true)
      if (order < 0 || order >= input.derivedVariables.length) invalidResponse()
      if (item.displayDecimals !== undefined) responseNumber(item.displayDecimals, true)
    }
  }
}

function assertDiff(value: unknown): void {
  const input = responseKeys(value, ['metadata', 'questions', 'rules'])
  const metadata = responseKeys(input.metadata, ['name', 'description'])
  for (const [key, change] of Object.entries(metadata)) {
    if (change === null) continue
    const parsed = responseKeys(change, ['before', 'after'])
    if (key === 'description') {
      if (parsed.before !== null) responseString(parsed.before, 20_000, true)
      if (parsed.after !== null) responseString(parsed.after, 20_000, true)
    } else {
      responseString(parsed.before, 20_000, true)
      responseString(parsed.after, 20_000, true)
    }
  }
  const questions = responseKeys(input.questions, ['added', 'removed', 'modified'])
  for (const key of ['added', 'removed'] as const) {
    if (!Array.isArray(questions[key]) || questions[key].length > 500) invalidResponse()
    for (const entry of questions[key]) {
      const parsed = responseKeys(entry, ['id', 'variableName', 'content'])
      responseId(parsed.id)
      responseString(parsed.variableName, 128)
      responseString(parsed.content, 20_000, true)
    }
  }
  if (!Array.isArray(questions.modified) || questions.modified.length > 500) invalidResponse()
  for (const entry of questions.modified) {
    const parsed = responseKeys(entry, ['id', 'variableName', 'fields'])
    responseId(parsed.id)
    responseString(parsed.variableName, 128)
    if (!Array.isArray(parsed.fields) || parsed.fields.length > 64) invalidResponse()
    for (const field of parsed.fields) responseString(field, 128)
  }
  const rules = responseKeys(input.rules, ['added', 'removed', 'modified'])
  for (const key of ['added', 'removed', 'modified'] as const) {
    if (!Array.isArray(rules[key]) || rules[key].length > 1_000) invalidResponse()
    for (const id of rules[key]) responseId(id)
  }
}

function assertArtifactPreview(value: unknown): void {
  const input = responseKeys(
    value,
    [
      'draft', 'diff', 'assistantMessage', 'rollingSummary', 'validation',
      'baseQuestionnaireRevision', 'baseQuestionnaireHash', 'baseQuestionnaire'
    ]
  )
  assertQuestionnaire(input.draft, false)
  assertDiff(input.diff)
  responseString(input.assistantMessage, 20_000)
  responseString(input.rollingSummary, 20_000, true)
  const validation = responseKeys(input.validation, ['success', 'errors'])
  if (validation.success !== true || !Array.isArray(validation.errors) || validation.errors.length !== 0) {
    invalidResponse()
  }
  if (!isUUIDv4(input.baseQuestionnaireRevision)) invalidResponse()
  if (!/^sha256:[a-f0-9]{64}$/.test(responseString(input.baseQuestionnaireHash, 71))) {
    invalidResponse()
  }
  assertQuestionnaire(input.baseQuestionnaire, false)
}

function assertArtifactSummary(value: unknown): void {
  const input = responseKeys(
    value,
    ['artifactId', 'operationId', 'kind', 'status', 'createdAt', 'updatedAt']
  )
  responseId(input.artifactId)
  responseId(input.operationId)
  responseString(input.kind, 128)
  if (input.status !== 'pending' && input.status !== 'completed' && input.status !== 'failed') {
    invalidResponse()
  }
  responseTimestamp(input.createdAt)
  responseTimestamp(input.updatedAt)
}

const AI_PROGRESS_STAGES = new Set<AIProgressStage>([
  'starting', 'connecting', 'streaming', 'validating', 'repairing',
  'clarification', 'completed', 'failed', 'cancelled'
])
const AI_VALIDATION_FIELD_PATTERN =
  /^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[(?:0|[1-9][0-9]{0,2})\]){0,12}$/

function assertQuickReplyOption(value: unknown): void {
  const input = responseKeys(value, ['id', 'label'])
  responseId(input.id)
  responsePlainText(input.label, 200)
}

function assertPublicClarification(value: unknown): void {
  const input = responseKeys(
    value,
    ['clarificationId', 'options', 'status', 'selectedOptionId', 'resolvedByMessageId']
  )
  responseId(input.clarificationId)
  if (!Array.isArray(input.options) || input.options.length < 1 || input.options.length > 5) {
    invalidResponse()
  }
  const optionIds = new Set<string>()
  for (const option of input.options) {
    assertQuickReplyOption(option)
    const optionId = String((option as { id: unknown }).id)
    if (optionIds.has(optionId)) invalidResponse()
    optionIds.add(optionId)
  }
  if (input.status !== 'unresolved' && input.status !== 'resolved') invalidResponse()
  if (input.selectedOptionId !== null) {
    if (!optionIds.has(responseId(input.selectedOptionId))) invalidResponse()
  }
  if (input.resolvedByMessageId !== null) responseId(input.resolvedByMessageId)
  if (input.status === 'unresolved') {
    if (input.selectedOptionId !== null || input.resolvedByMessageId !== null) invalidResponse()
  } else if (input.resolvedByMessageId === null) {
    invalidResponse()
  }
}

function assertPublicMessage(value: unknown): void {
  const input = responseKeys(value, ['id', 'role', 'content', 'createdAt', 'clarification'])
  responseId(input.id)
  if (input.role !== 'user' && input.role !== 'assistant') invalidResponse()
  responseReadableText(input.content, 100_000, true)
  responseTimestamp(input.createdAt)
  if (input.clarification !== null) {
    if (input.role !== 'assistant') invalidResponse()
    assertPublicClarification(input.clarification)
  }
}

function assertPublicValidationIssue(value: unknown): void {
  const input = responseKeys(value, ['code', 'field', 'summary'])
  const code = responseErrorCode(input.code)
  if (!isAIPublicValidationCode(code)) invalidResponse()
  const field = responseString(input.field, 256)
  if (!AI_VALIDATION_FIELD_PATTERN.test(field)) invalidResponse()
  const summary = responsePlainText(input.summary, 200)
  if (summary !== AI_PUBLIC_VALIDATION_SUMMARIES[code]) invalidResponse()
}

function assertPublicAttemptFailure(value: unknown): void {
  const input = responseKeys(value, ['attempt', 'issues', 'truncated'])
  responseAttempt(input.attempt)
  if (!Array.isArray(input.issues) || input.issues.length > 20) invalidResponse()
  const issueKeys = new Set<string>()
  for (const issue of input.issues) {
    assertPublicValidationIssue(issue)
    const parsed = issue as { code: unknown; field: unknown }
    const key = `${String(parsed.code)}\0${String(parsed.field)}`
    if (issueKeys.has(key)) invalidResponse()
    issueKeys.add(key)
  }
  if (typeof input.truncated !== 'boolean') invalidResponse()
}

function assertPublicFailureDetails(value: unknown): void {
  const input = responseKeys(value, ['attempts'])
  if (!Array.isArray(input.attempts) || input.attempts.length > 3) invalidResponse()
  let previousAttempt = 0
  for (const failure of input.attempts) {
    assertPublicAttemptFailure(failure)
    const attempt = responseAttempt((failure as { attempt: unknown }).attempt)
    if (attempt <= previousAttempt) invalidResponse()
    previousAttempt = attempt
  }
}

function assertPublicRunSnapshot(value: unknown): void {
  const input = responseKeys(
    value,
    ['requestId', 'runId', 'stage', 'attempt', 'startedAt', 'updatedAt', 'streamFallback']
  )
  responseId(input.requestId)
  responseId(input.runId)
  if (typeof input.stage !== 'string' || !AI_PROGRESS_STAGES.has(input.stage as AIProgressStage)) {
    invalidResponse()
  }
  responseAttempt(input.attempt)
  responseTimestamp(input.startedAt)
  responseTimestamp(input.updatedAt)
  if (typeof input.streamFallback !== 'boolean') invalidResponse()
}

function assertManifest(value: unknown): void {
  const input = responseKeys(
    value,
    ['sessionId', 'title', 'versionStamp', 'createdAt', 'updatedAt']
  )
  responseId(input.sessionId, SESSION_ID_PATTERN)
  responseString(input.title, 120)
  assertVersionStamp(input.versionStamp)
  responseTimestamp(input.createdAt)
  responseTimestamp(input.updatedAt)
}

function assertSessionPage(value: unknown): void {
  const input = responseKeys(
    value,
    [
      'manifest', 'messages', 'attachments', 'status', 'activeArtifactId', 'activeRun',
      'failures', 'artifacts', 'total', 'nextOffset'
    ]
  )
  assertManifest(input.manifest)
  if (!Array.isArray(input.messages) || input.messages.length > 100) invalidResponse()
  const userMessageIds = new Set<string>()
  for (const message of input.messages) {
    assertPublicMessage(message)
    const item = message as { id: unknown; role: unknown }
    if (item.role === 'user') userMessageIds.add(String(item.id))
  }
  if (!Array.isArray(input.attachments) || input.attachments.length > 100) invalidResponse()
  for (const attachment of input.attachments) {
    const item = responseKeys(
      attachment,
      ['attachmentId', 'messageId', 'kind', 'createdAt']
    )
    responseId(item.attachmentId)
    if (!userMessageIds.has(responseId(item.messageId))) invalidResponse()
    if (item.kind !== 'questionnaire') invalidResponse()
    responseTimestamp(item.createdAt)
  }
  if (!['idle', 'running', 'completed', 'failed', 'cancelled'].includes(String(input.status))) {
    invalidResponse()
  }
  if (!Array.isArray(input.artifacts) || input.artifacts.length > 100) invalidResponse()
  const artifactIds = new Set<string>()
  for (const artifact of input.artifacts) {
    assertArtifactSummary(artifact)
    artifactIds.add(String((artifact as { artifactId: unknown }).artifactId))
  }
  if (input.activeArtifactId !== null && !artifactIds.has(responseId(input.activeArtifactId))) {
    invalidResponse()
  }
  if (input.activeRun !== null) assertPublicRunSnapshot(input.activeRun)
  if (!Array.isArray(input.failures) || input.failures.length > 100) invalidResponse()
  const failureRunIds = new Set<string>()
  for (const failure of input.failures) {
    const item = responseKeys(
      failure,
      ['runId', 'userMessageId', 'completedAt', 'errorCode', 'details']
    )
    const runId = responseId(item.runId)
    if (failureRunIds.has(runId) || !userMessageIds.has(responseId(item.userMessageId))) {
      invalidResponse()
    }
    failureRunIds.add(runId)
    responseTimestamp(item.completedAt)
    responseErrorCode(item.errorCode)
    assertPublicFailureDetails(item.details)
  }
  const total = responseNumber(input.total, true)
  if (total < input.messages.length || !Number.isSafeInteger(total)) invalidResponse()
  if (input.nextOffset !== null) {
    const nextOffset = responseNumber(input.nextOffset, true)
    if (nextOffset < 1 || nextOffset > total) invalidResponse()
  }
}

function assertQuestionnaireArtifactPreview(value: unknown): void {
  const input = responseKeys(
    value,
    ['artifactId', 'operationId', 'kind', 'status', 'createdAt', 'updatedAt', 'value']
  )
  responseId(input.artifactId)
  responseId(input.operationId)
  if (input.kind !== 'questionnaire-draft' || input.status !== 'completed') invalidResponse()
  responseTimestamp(input.createdAt)
  responseTimestamp(input.updatedAt)
  assertArtifactPreview(input.value)
}

function parseExactPublicDto<T>(value: unknown, validate: (input: unknown) => void): T {
  assertSafeResponseTree(value)
  validate(value)
  return structuredClone(value) as T
}

export function parseAIPublicClarification(value: unknown): AIPublicClarification {
  return parseExactPublicDto<AIPublicClarification>(value, assertPublicClarification)
}

export function parseAIPublicFailureDetails(value: unknown): AIPublicFailureDetails {
  return parseExactPublicDto<AIPublicFailureDetails>(value, assertPublicFailureDetails)
}

export function parseAIPublicRunSnapshot(value: unknown): AIPublicRunSnapshot {
  return parseExactPublicDto<AIPublicRunSnapshot>(value, assertPublicRunSnapshot)
}

export function parseAIProgressEvent(value: unknown): AIProgressEvent {
  assertSafeResponseTree(value)
  const discriminator = responseKeys(value, ['requestId', 'sessionId', 'runId', 'at', 'type'], [
    'attempt', 'sequence', 'delta', 'failure', 'nextAttempt', 'capability', 'reason',
    'outcome', 'messageId', 'clarification', 'artifactId', 'errorCode', 'details'
  ])
  responseId(discriminator.requestId)
  responseId(discriminator.sessionId, SESSION_ID_PATTERN)
  responseId(discriminator.runId)
  responseTimestamp(discriminator.at)
  const baseKeys = ['requestId', 'sessionId', 'runId', 'at', 'type'] as const
  switch (discriminator.type) {
    case 'started':
      responseKeys(discriminator, baseKeys)
      break
    case 'attempt_started':
    case 'model_streaming':
    case 'validating': {
      const input = responseKeys(discriminator, [...baseKeys, 'attempt'])
      responseAttempt(input.attempt)
      break
    }
    case 'assistant_delta': {
      const input = responseKeys(discriminator, [...baseKeys, 'attempt', 'sequence', 'delta'])
      responseAttempt(input.attempt)
      const sequence = responseNumber(input.sequence, true)
      if (!Number.isSafeInteger(sequence) || sequence < 0) invalidResponse()
      responseString(input.delta, 4_096)
      break
    }
    case 'validation_failed': {
      const input = responseKeys(discriminator, [...baseKeys, 'attempt', 'failure'])
      const attempt = responseAttempt(input.attempt)
      assertPublicAttemptFailure(input.failure)
      if ((input.failure as { attempt: unknown }).attempt !== attempt) invalidResponse()
      break
    }
    case 'repairing': {
      const input = responseKeys(discriminator, [...baseKeys, 'attempt', 'nextAttempt'])
      const attempt = responseAttempt(input.attempt)
      const nextAttempt = responseAttempt(input.nextAttempt)
      if (attempt >= 3 || nextAttempt !== attempt + 1) invalidResponse()
      break
    }
    case 'capability_fallback': {
      const input = responseKeys(
        discriminator,
        [...baseKeys, 'attempt', 'capability', 'reason']
      )
      responseAttempt(input.attempt)
      if (input.capability !== 'streaming' && input.capability !== 'response_format') {
        invalidResponse()
      }
      if (input.reason !== 'unsupported') invalidResponse()
      break
    }
    case 'clarification': {
      const input = responseKeys(
        discriminator,
        [...baseKeys, 'attempt', 'outcome', 'messageId', 'clarification']
      )
      responseAttempt(input.attempt)
      if (input.outcome !== 'clarification') invalidResponse()
      responseId(input.messageId)
      assertPublicClarification(input.clarification)
      break
    }
    case 'completed': {
      const input = responseKeys(
        discriminator,
        [...baseKeys, 'attempt', 'outcome', 'artifactId']
      )
      responseAttempt(input.attempt)
      if (input.outcome !== 'questionnaire') invalidResponse()
      responseId(input.artifactId)
      break
    }
    case 'failed': {
      const input = responseKeys(
        discriminator,
        [...baseKeys, 'attempt', 'errorCode'],
        ['details']
      )
      responseAttempt(input.attempt)
      responseErrorCode(input.errorCode)
      if (input.details !== undefined) assertPublicFailureDetails(input.details)
      break
    }
    case 'cancelled': {
      const input = responseKeys(discriminator, [...baseKeys, 'attempt', 'errorCode'])
      responseAttempt(input.attempt)
      if (input.errorCode !== 'AI_CANCELLED') invalidResponse()
      break
    }
    default:
      invalidResponse()
  }
  return structuredClone(discriminator) as unknown as AIProgressEvent
}

export function parseAIResponse<T>(value: unknown, successKeys: readonly string[]): T {
  return parseKnownResponse<T>(value, successKeys, () => undefined)
}

export function parseAIConfigResponse(value: unknown): AIConfigIpcResult {
  return parseKnownResponse<AIConfigIpcResult>(value, ['config'], (result) => {
    const config = responseKeys(result.config, [
      'providerId', 'baseUrl', 'model', 'webSearchEnabled', 'hasApiKey', 'maskedApiKey'
    ])
    if (!isAIProviderId(config.providerId) || typeof config.webSearchEnabled !== 'boolean') {
      invalidResponse()
    }
    responseString(config.baseUrl, 2_048)
    responseString(config.model, 200, true)
    if (typeof config.hasApiKey !== 'boolean') invalidResponse()
    if (config.hasApiKey) {
      if (config.maskedApiKey !== AI_MASKED_API_KEY) invalidResponse()
    } else if (config.maskedApiKey !== null) invalidResponse()
  })
}

export function parseAIConnectionTestResponse(value: unknown): AIConnectionTestResult {
  return parseKnownResponse<AIConnectionTestResult>(value, [], () => undefined)
}

export function parseAIPrivacyStatusResponse(value: unknown): AIPrivacyStatusResult {
  return parseKnownResponse<AIPrivacyStatusResult>(
    value,
    ['accepted', 'acceptedAt', 'notice'],
    (result) => {
      if (typeof result.accepted !== 'boolean' || result.notice !== AI_PRIVACY_NOTICE) invalidResponse()
      if (result.accepted) responseTimestamp(result.acceptedAt)
      else if (result.acceptedAt !== null) invalidResponse()
    }
  )
}

export function parseAISessionResponse(value: unknown): AISessionResult {
  return parseKnownResponse<AISessionResult>(value, ['session'], (result) => assertManifest(result.session))
}

export function parseAISessionPageResponse(value: unknown): AISessionPageResult {
  return parseKnownResponse<AISessionPageResult>(value, ['session'], (result) => {
    assertSessionPage(result.session)
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > AI_SESSION_PAGE_MAX_UTF8_BYTES) {
      invalidResponse()
    }
  })
}

export function parseAISessionListResponse(value: unknown): AISessionListResult {
  return parseKnownResponse<AISessionListResult>(value, ['sessions'], (result) => {
    if (!Array.isArray(result.sessions) || result.sessions.length > 1_000) invalidResponse()
    for (const session of result.sessions) assertManifest(session)
  })
}

export function parseAISessionDeleteResponse(value: unknown): AISessionDeleteResult {
  return parseKnownResponse<AISessionDeleteResult>(value, ['deleted'], (result) => {
    if (typeof result.deleted !== 'boolean') invalidResponse()
  })
}

export function parseAISessionClearCacheResponse(value: unknown): AISessionClearCacheResult {
  return parseKnownResponse<AISessionClearCacheResult>(value, ['removed'], (result) => {
    const removed = responseNumber(result.removed, true)
    if (removed < 0 || !Number.isSafeInteger(removed)) invalidResponse()
  })
}

export function parseAISessionMigrateResponse(value: unknown): AISessionMigrateResult {
  return parseKnownResponse<AISessionMigrateResult>(value, ['migrated', 'session'], (result) => {
    if (typeof result.migrated !== 'boolean') invalidResponse()
    assertManifest(result.session)
  })
}

export function parseAISendResponse(value: unknown): AISendResult {
  assertSafeResponseTree(value)
  const discriminator = responseKeys(value, ['ok'], [
    'requestId', 'outcome', 'artifact', 'message', 'attempts',
    'researchStatus', 'citations', 'errorCode', 'message', 'details'
  ])
  if (discriminator.ok === false) {
    const failure = responseKeys(
      discriminator,
      ['ok', 'errorCode', 'message'],
      ['details']
    )
    responseErrorCode(failure.errorCode)
    responseString(failure.message, 200)
    if (failure.details !== undefined) assertPublicFailureDetails(failure.details)
  } else if (discriminator.ok === true) {
    responseId(discriminator.requestId)
    responseAttempt(discriminator.attempts)
    if (discriminator.researchStatus !== undefined && ![
      'searched', 'not_needed', 'disabled', 'unsupported', 'failed'
    ].includes(String(discriminator.researchStatus))) invalidResponse()
    if (discriminator.citations !== undefined) {
      if (!Array.isArray(discriminator.citations) || discriminator.citations.length > 20) invalidResponse()
      for (const value of discriminator.citations) {
        const citation = responseKeys(value, ['url', 'title'])
        const url = responseString(citation.url, 2_048)
        responsePlainText(citation.title, 500)
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:' || parsed.username || parsed.password) invalidResponse()
        } catch {
          invalidResponse()
        }
      }
    }
    if (discriminator.outcome === 'questionnaire') {
      responseKeys(
        discriminator,
        ['ok', 'requestId', 'outcome', 'artifact', 'attempts'],
        ['researchStatus', 'citations']
      )
      assertQuestionnaireArtifactPreview(discriminator.artifact)
    } else if (discriminator.outcome === 'clarification') {
      responseKeys(
        discriminator,
        ['ok', 'requestId', 'outcome', 'message', 'attempts'],
        ['researchStatus', 'citations']
      )
      assertPublicMessage(discriminator.message)
      const message = discriminator.message as {
        role: unknown
        clarification: null | { status?: unknown }
      }
      if (message.role !== 'assistant' || message.clarification?.status !== 'unresolved') {
        invalidResponse()
      }
    } else {
      invalidResponse()
    }
  } else {
    invalidResponse()
  }
  return structuredClone(discriminator) as AISendResult
}

export function parseAICancelResponse(value: unknown): AICancelResult {
  return parseKnownResponse<AICancelResult>(value, ['cancelled'], (result) => {
    if (typeof result.cancelled !== 'boolean') invalidResponse()
  })
}

export function parseAIArtifactPreviewResponse(value: unknown): AIArtifactPreviewResult {
  return parseKnownResponse<AIArtifactPreviewResult>(value, ['preview'], (result) => {
    assertArtifactPreview(result.preview)
  })
}

export function parseAIArtifactApplyResponse(value: unknown): AIArtifactApplyResult {
  return parseKnownResponse<AIArtifactApplyResult>(
    value,
    ['applied', 'questionnaire', 'preview'],
    (result) => {
      if (typeof result.applied !== 'boolean') invalidResponse()
      assertQuestionnaire(result.questionnaire, true)
      assertArtifactPreview(result.preview)
    }
  )
}
