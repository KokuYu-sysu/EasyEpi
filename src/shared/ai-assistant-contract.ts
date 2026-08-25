import type { QuestionnaireDef } from './types/qnaire'

export type AIJsonValue =
  | string
  | number
  | boolean
  | null
  | AIJsonValue[]
  | { [key: string]: AIJsonValue }

export interface AIProviderConfigUpdate {
  baseUrl: string
  model: string
  /** Undefined preserves the stored key; null or an empty string clears it. */
  apiKey?: string | null
}

export interface AIProviderConfigView {
  baseUrl: string
  model: string
  hasApiKey: boolean
  maskedApiKey: string | null
}

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
export const AI_SESSION_MIGRATE_CHANNEL = 'ai:session:migrate'
export const AI_SEND_CHANNEL = 'ai:send'
export const AI_CANCEL_CHANNEL = 'ai:cancel'
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

export interface AIRun {
  runId: string
  status: Exclude<AISessionStatus, 'idle'>
  startedAt: string
  completedAt?: string
  versionStamp: AiVersionStamp
  errorCode?: string
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
  baseUrl: string
  model: string
  apiKey?: string | null
}

export interface AISessionCreateRequest {
  title?: string
}

export interface AISessionIdRequest {
  sessionId: string
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
  baseQuestionnaireHash: string
  baseQuestionnaire: QuestionnaireDef
}

export interface AIErrorResult {
  ok: false
  errorCode: string
  message: string
}

export type AIConfigIpcResult = { ok: true; config: AIProviderConfigView } | AIErrorResult
export type AIConnectionTestResult = { ok: true } | AIErrorResult
export type AIPrivacyStatusResult =
  | { ok: true; accepted: boolean; acceptedAt: string | null; notice: typeof AI_PRIVACY_NOTICE }
  | AIErrorResult
export type AISessionResult = { ok: true; session: AISessionData } | AIErrorResult
export type AISessionListResult = { ok: true; sessions: AISessionListItem[] } | AIErrorResult
export type AISessionDeleteResult = { ok: true; deleted: boolean } | AIErrorResult
export type AISessionMigrateResult =
  | { ok: true; migrated: boolean; session: AISessionData }
  | AIErrorResult
export type AISendResult =
  | { ok: true; requestId: string; artifact: AIArtifact; attempts: number }
  | AIErrorResult
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
  exactKeys(input, ['baseUrl', 'model'], ['apiKey'])
  const baseUrl = safeString(input.baseUrl, 2_048)
  const model = safeString(input.model, 200)
  const apiKey = input.apiKey
  if (apiKey !== undefined && apiKey !== null &&
    (typeof apiKey !== 'string' || apiKey.length > 8_192 || apiKey.includes('\0'))) {
    throw new Error('INVALID_AI_REQUEST')
  }
  return { baseUrl, model, ...(apiKey === undefined ? {} : { apiKey }) }
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
  exactKeys(input, ['requestId', 'sessionId', 'content', 'includeCurrentQuestionnaire'])
  if (typeof input.includeCurrentQuestionnaire !== 'boolean') throw new Error('INVALID_AI_REQUEST')
  const content = typeof input.content === 'string' ? input.content : ''
  if (content.trim().length === 0 || content.length > 100_000 || content.includes('\0')) {
    throw new Error('INVALID_AI_REQUEST')
  }
  return {
    requestId: safeString(input.requestId, 128, PUBLIC_ID_PATTERN),
    sessionId: safeString(input.sessionId, 36, SESSION_ID_PATTERN),
    content,
    includeCurrentQuestionnaire: input.includeCurrentQuestionnaire
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

function assertPublicError(input: Record<string, unknown>): void {
  exactKeys(input, ['ok', 'errorCode', 'message'])
  if (input.ok !== false || typeof input.errorCode !== 'string' ||
    !/^[A-Z][A-Z0-9_]{1,127}$/.test(input.errorCode) ||
    typeof input.message !== 'string' || input.message.length === 0 || input.message.length > 200) {
    throw new Error('INVALID_AI_RESPONSE')
  }
}

export function parseAIResponse<T>(value: unknown, successKeys: readonly string[]): T {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_RESPONSE')
  if (value.ok === false) {
    try {
      assertPublicError(value)
    } catch {
      throw new Error('INVALID_AI_RESPONSE')
    }
    return structuredClone(value) as T
  }
  if (value.ok !== true) throw new Error('INVALID_AI_RESPONSE')
  try {
    exactKeys(value, ['ok', ...successKeys])
  } catch {
    throw new Error('INVALID_AI_RESPONSE')
  }
  return structuredClone(value) as T
}

export function parseAIConfigResponse(value: unknown): AIConfigIpcResult {
  const result = parseAIResponse<AIConfigIpcResult>(value, ['config'])
  if (!result.ok) return result
  const config = result.config
  if (!isPlainObject(config)) throw new Error('INVALID_AI_RESPONSE')
  try {
    exactKeys(config, ['baseUrl', 'model', 'hasApiKey', 'maskedApiKey'])
  } catch {
    throw new Error('INVALID_AI_RESPONSE')
  }
  if (typeof config.baseUrl !== 'string' || typeof config.model !== 'string' ||
    typeof config.hasApiKey !== 'boolean' ||
    (config.maskedApiKey !== null && typeof config.maskedApiKey !== 'string')) {
    throw new Error('INVALID_AI_RESPONSE')
  }
  return result
}
