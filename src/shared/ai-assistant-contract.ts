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
