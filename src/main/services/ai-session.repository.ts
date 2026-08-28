import { randomUUID } from 'node:crypto'

import type {
  AIArtifact,
  AIArtifactStatus,
  AIClarification,
  AIJsonValue,
  AIMessage,
  AIMessageAttachment,
  AIMutationResult,
  AIRun,
  AIRunFailure,
  AIRunProgress,
  AIRunResult,
  AIRunTemp,
  AiVersionStamp,
  AISessionData,
  AISessionListItem,
  AISessionPartition,
  AISessionState,
  AISessionStatus,
  AISessionVirtualPath
} from '@shared/ai-assistant-contract'
import type { ProjectData } from '@shared/types/project'
import { migrateAISessionVersion as validateAISessionVersionMigration } from './ai-questionnaire.harness'

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PARTITIONS = new Set<AISessionPartition>([
  'conversation',
  'state',
  'cache',
  'artifacts',
  'temp'
])
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_VIRTUAL_PATH_LENGTH = 2_048
const MAX_CLARIFICATION_OPTIONS = 5
const MAX_CLARIFICATION_LABEL_LENGTH = 200

export interface AISessionUpdate {
  title?: string
}

export interface AISessionStateUpdate {
  status?: AISessionStatus
  activeRunId?: string | null
  values?: Record<string, AIJsonValue>
}

export interface AIArtifactUpsert {
  artifactId: string
  operationId: string
  kind: string
  status: AIArtifactStatus
  versionStamp: AiVersionStamp
  value?: AIJsonValue
  errorCode?: string
}

export interface AIClarificationResolution {
  clarificationId: string
  resolvedByMessageId: string
  selectedOptionId?: string
}

export interface AIRunFailureInput {
  errorCode: string
  details: AIRunFailure['details']
}

function invalidPath(): never {
  throw new Error('INVALID_AI_SESSION_PATH')
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) invalidPath()
}

function validatePathSegment(segment: unknown): asserts segment is string {
  if (
    typeof segment !== 'string' ||
    !PATH_SEGMENT_PATTERN.test(segment) ||
    segment === '.' ||
    segment === '..' ||
    DANGEROUS_OBJECT_KEYS.has(segment)
  ) {
    invalidPath()
  }
}

export function parseAISessionVirtualPath(
  value: string,
  currentSessionId: string
): AISessionVirtualPath {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_VIRTUAL_PATH_LENGTH ||
    !value.startsWith('session://') ||
    value.includes('\\') ||
    value.includes('%') ||
    hasControlCharacter(value)
  ) {
    invalidPath()
  }

  const parts = value.slice('session://'.length).split('/')
  if (parts.length < 3) invalidPath()
  const [sessionId, rawPartition, ...segments] = parts
  if (sessionId === undefined || rawPartition === undefined || segments.length === 0) invalidPath()
  validateSessionId(sessionId)
  validateSessionId(currentSessionId)
  if (!PARTITIONS.has(rawPartition as AISessionPartition)) invalidPath()
  for (const segment of segments) validatePathSegment(segment)

  if (sessionId !== currentSessionId) {
    throw new Error('AI_SESSION_SCOPE_MISMATCH')
  }

  return {
    sessionId,
    partition: rawPartition as AISessionPartition,
    segments
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertJsonValue(value: unknown, seen = new Set<object>()): asserts value is AIJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return
  }
  if (typeof value !== 'object') throw new Error('INVALID_AI_JSON_VALUE')
  if (seen.has(value)) throw new Error('INVALID_AI_JSON_VALUE')
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen)
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (DANGEROUS_OBJECT_KEYS.has(key)) throw new Error('INVALID_AI_JSON_VALUE')
      assertJsonValue(item, seen)
    }
  } else {
    throw new Error('INVALID_AI_JSON_VALUE')
  }
  seen.delete(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function normalizeTitle(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 120 ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    throw new Error('INVALID_AI_SESSION_TITLE')
  }
  return value
}

function validateVersionStamp(value: unknown): AiVersionStamp {
  if (
    !isPlainObject(value) ||
    typeof value.promptId !== 'string' ||
    value.promptId.length === 0 ||
    value.promptId.length > 128 ||
    typeof value.promptVersion !== 'string' ||
    value.promptVersion.length === 0 ||
    value.promptVersion.length > 64 ||
    typeof value.promptHash !== 'string' ||
    value.promptHash.length === 0 ||
    value.promptHash.length > 256 ||
    typeof value.harnessVersion !== 'string' ||
    value.harnessVersion.length === 0 ||
    value.harnessVersion.length > 64 ||
    typeof value.schemaVersion !== 'number' ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion < 1
  ) {
    throw new Error('INVALID_AI_VERSION_STAMP')
  }
  return {
    promptId: value.promptId,
    promptVersion: value.promptVersion,
    promptHash: value.promptHash,
    harnessVersion: value.harnessVersion,
    schemaVersion: value.schemaVersion
  }
}

function parseMessage(value: unknown): AIMessage {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_MESSAGE')
  const { id, role, content, createdAt, runId } = value
  if (
    typeof id !== 'string' ||
    typeof role !== 'string' ||
    !['system', 'user', 'assistant', 'tool'].includes(role) ||
    typeof content !== 'string' ||
    typeof createdAt !== 'string' ||
    createdAt.length === 0 ||
    (runId !== undefined && typeof runId !== 'string')
  ) {
    throw new Error('INVALID_AI_MESSAGE')
  }
  validatePathSegment(id)
  if (runId !== undefined) validatePathSegment(runId)
  return { id, role: role as AIMessage['role'], content, createdAt, ...(runId === undefined ? {} : { runId }) }
}

function parseAttachment(value: unknown): AIMessageAttachment {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_ATTACHMENT')
  const { attachmentId, messageId, kind, createdAt, value: attachmentValue } = value
  if (
    typeof attachmentId !== 'string' ||
    typeof messageId !== 'string' ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    typeof createdAt !== 'string' ||
    createdAt.length === 0
  ) {
    throw new Error('INVALID_AI_ATTACHMENT')
  }
  validatePathSegment(attachmentId)
  validatePathSegment(messageId)
  assertJsonValue(attachmentValue)
  return { attachmentId, messageId, kind, createdAt, value: clone(attachmentValue) }
}

function parseArtifactUpsert(value: unknown): AIArtifactUpsert {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_ARTIFACT')
  const {
    artifactId,
    operationId,
    kind,
    status,
    versionStamp: rawVersionStamp,
    value: artifactValue,
    errorCode
  } = value
  if (
    typeof artifactId !== 'string' ||
    typeof operationId !== 'string' ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    kind.length > 128 ||
    kind !== kind.trim() ||
    (status !== 'pending' && status !== 'completed' && status !== 'failed') ||
    (errorCode !== undefined &&
      (typeof errorCode !== 'string' || errorCode.length === 0 || errorCode.length > 128))
  ) {
    throw new Error('INVALID_AI_ARTIFACT')
  }
  validatePathSegment(artifactId)
  validatePathSegment(operationId)
  const versionStamp = validateVersionStamp(rawVersionStamp)
  if (artifactValue !== undefined) assertJsonValue(artifactValue)
  return {
    artifactId,
    operationId,
    kind,
    status,
    versionStamp,
    ...(artifactValue === undefined ? {} : { value: clone(artifactValue) }),
    ...(errorCode === undefined ? {} : { errorCode })
  }
}

function canonicalize(value: AIJsonValue): AIJsonValue {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key] as AIJsonValue)])
  )
}

function structurallyEqual(left: AIJsonValue, right: AIJsonValue): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function versionStampValue(stamp: AiVersionStamp): AIJsonValue {
  return {
    promptId: stamp.promptId,
    promptVersion: stamp.promptVersion,
    promptHash: stamp.promptHash,
    harnessVersion: stamp.harnessVersion,
    schemaVersion: stamp.schemaVersion
  }
}

function artifactPayload(value: AIArtifact | AIArtifactUpsert): AIJsonValue {
  return {
    kind: value.kind,
    status: value.status,
    versionStamp: versionStampValue(value.versionStamp),
    ...(value.value === undefined ? {} : { value: value.value }),
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode })
  }
}

function assertVersionMatchesSession(session: AISessionData, stamp: AiVersionStamp): void {
  if (!structurallyEqual(
    versionStampValue(stamp),
    versionStampValue(session.manifest.versionStamp)
  )) {
    throw new Error('AI_VERSION_STAMP_MISMATCH')
  }
}

function assertGeneralCacheValuePath(path: AISessionVirtualPath): void {
  if (path.partition !== 'cache' || path.segments.length !== 2 || path.segments[0] !== 'values') {
    throw new Error('AI_SESSION_RESERVED_PATH')
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('INVALID_AI_PERSISTED_VALUE')
  }
}

function validateTimestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || hasControlCharacter(value)) {
    throw new Error('INVALID_AI_TIMESTAMP')
  }
}

function validateProgress(value: unknown): AIRunProgress {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_RUN_PROGRESS')
  exactKeys(value, ['stage', 'attempt', 'updatedAt', 'streamFallback'])
  if (![
    'starting', 'connecting', 'streaming', 'validating', 'repairing', 'clarification',
    'completed', 'failed', 'cancelled'
  ].includes(String(value.stage)) || ![1, 2, 3].includes(Number(value.attempt)) ||
    typeof value.streamFallback !== 'boolean') {
    throw new Error('INVALID_AI_RUN_PROGRESS')
  }
  validateTimestamp(value.updatedAt)
  return clone(value) as unknown as AIRunProgress
}

function validateRunResult(value: unknown): AIRunResult {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_RUN_RESULT')
  if (value.kind === 'questionnaire') {
    exactKeys(value, ['kind', 'artifactId'])
    validatePathSegment(value.artifactId)
  } else if (value.kind === 'clarification') {
    exactKeys(value, ['kind', 'messageId', 'clarificationId'])
    validatePathSegment(value.messageId)
    validatePathSegment(value.clarificationId)
  } else {
    throw new Error('INVALID_AI_RUN_RESULT')
  }
  return clone(value) as unknown as AIRunResult
}

function validateFailureInput(value: unknown): AIRunFailureInput {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_RUN_FAILURE')
  exactKeys(value, ['errorCode', 'details'])
  if (typeof value.errorCode !== 'string' || value.errorCode.length === 0 ||
    value.errorCode.length > 128 || value.errorCode !== value.errorCode.trim() ||
    hasControlCharacter(value.errorCode)) {
    throw new Error('INVALID_AI_RUN_FAILURE')
  }
  if (!isPlainObject(value.details)) throw new Error('INVALID_AI_RUN_FAILURE')
  exactKeys(value.details, ['attempts'])
  if (!Array.isArray(value.details.attempts) || value.details.attempts.length > 3) {
    throw new Error('INVALID_AI_RUN_FAILURE')
  }
  let previousAttempt = 0
  for (const attempt of value.details.attempts) {
    if (!isPlainObject(attempt)) throw new Error('INVALID_AI_RUN_FAILURE')
    exactKeys(attempt, ['attempt', 'issues', 'truncated'])
    if (![1, 2, 3].includes(Number(attempt.attempt)) || Number(attempt.attempt) <= previousAttempt ||
      !Array.isArray(attempt.issues) || attempt.issues.length > 20 ||
      typeof attempt.truncated !== 'boolean') {
      throw new Error('INVALID_AI_RUN_FAILURE')
    }
    previousAttempt = Number(attempt.attempt)
    const issues = new Set<string>()
    for (const issue of attempt.issues) {
      if (!isPlainObject(issue)) throw new Error('INVALID_AI_RUN_FAILURE')
      exactKeys(issue, ['code', 'field', 'summary'])
      if (typeof issue.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(issue.code) ||
        typeof issue.field !== 'string' || issue.field.length > 256 ||
        !/^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[(?:0|[1-9][0-9]{0,2})\]){0,12}$/.test(issue.field) ||
        typeof issue.summary !== 'string' || issue.summary.length < 1 || issue.summary.length > 200 ||
        issue.summary !== issue.summary.trim() || hasControlCharacter(issue.summary)) {
        throw new Error('INVALID_AI_RUN_FAILURE')
      }
      const key = `${issue.code}\u0000${issue.field}`
      if (issues.has(key)) throw new Error('INVALID_AI_RUN_FAILURE')
      issues.add(key)
    }
  }
  assertJsonValue(value.details)
  return clone(value) as unknown as AIRunFailureInput
}

function validateClarification(value: unknown): AIClarification {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_CLARIFICATION')
  exactKeys(
    value,
    ['clarificationId', 'messageId', 'runId', 'options', 'status', 'createdAt'],
    ['resolvedAt', 'resolvedByMessageId', 'selectedOptionId']
  )
  validatePathSegment(value.clarificationId)
  validatePathSegment(value.messageId)
  validatePathSegment(value.runId)
  validateTimestamp(value.createdAt)
  if (value.status !== 'unresolved' && value.status !== 'resolved') {
    throw new Error('INVALID_AI_CLARIFICATION')
  }
  if (!Array.isArray(value.options) || value.options.length < 1 ||
    value.options.length > MAX_CLARIFICATION_OPTIONS) {
    throw new Error('INVALID_AI_CLARIFICATION')
  }
  const ids = new Set<string>()
  const labels = new Set<string>()
  for (const option of value.options) {
    if (!isPlainObject(option)) throw new Error('INVALID_AI_CLARIFICATION')
    exactKeys(option, ['id', 'label'])
    validatePathSegment(option.id)
    if (typeof option.label !== 'string' || option.label.length < 1 ||
      option.label.length > MAX_CLARIFICATION_LABEL_LENGTH || option.label !== option.label.trim() ||
      hasControlCharacter(option.label) || ids.has(option.id) || labels.has(option.label)) {
      throw new Error('INVALID_AI_CLARIFICATION')
    }
    ids.add(option.id)
    labels.add(option.label)
  }
  if (value.status === 'unresolved') {
    if (value.resolvedAt !== undefined || value.resolvedByMessageId !== undefined ||
      value.selectedOptionId !== undefined) {
      throw new Error('INVALID_AI_CLARIFICATION')
    }
  } else {
    validateTimestamp(value.resolvedAt)
    validatePathSegment(value.resolvedByMessageId)
    if (value.selectedOptionId !== undefined) {
      validatePathSegment(value.selectedOptionId)
      if (!ids.has(value.selectedOptionId)) throw new Error('INVALID_AI_CLARIFICATION')
    }
  }
  return clone(value) as unknown as AIClarification
}

function requireV2Session(session: AISessionData): Record<string, AIClarification> {
  if (session.manifest.versionStamp.schemaVersion !== 2) {
    throw new Error('AI_SESSION_VERSION_MIGRATION_REQUIRED')
  }
  if (!isPlainObject(session.conversation.clarifications)) {
    throw new Error('INVALID_AI_CLARIFICATION_PARTITION')
  }
  return session.conversation.clarifications
}

export class AISessionRepository {
  constructor(
    private readonly project: ProjectData,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  private sessions(): Record<string, AISessionData> {
    const assistant = this.project.aiAssistant
    if (assistant === undefined) return {}
    if (assistant.schemaVersion !== 1 || !isPlainObject(assistant.sessions)) {
      throw new Error('UNSUPPORTED_AI_ASSISTANT_SCHEMA')
    }
    return assistant.sessions
  }

  private mutableSessions(): Record<string, AISessionData> {
    if (this.project.aiAssistant === undefined) {
      this.project.aiAssistant = { schemaVersion: 1, sessions: {} }
    }
    return this.sessions()
  }

  private requireSession(sessionId: string): AISessionData {
    validateSessionId(sessionId)
    const session = this.sessions()[sessionId]
    if (session === undefined) throw new Error('AI_SESSION_NOT_FOUND')
    return session
  }

  private touch(session: AISessionData): void {
    session.manifest.updatedAt = this.now()
  }

  private requireActiveRun(session: AISessionData, runId: string): AIRun {
    validatePathSegment(runId)
    const run = session.state.runs[runId]
    if (run === undefined) throw new Error('AI_RUN_NOT_FOUND')
    if (run.status !== 'running') throw new Error('AI_RUN_NOT_ACTIVE')
    if (session.manifest.versionStamp.schemaVersion !== 2) {
      throw new Error('AI_SESSION_VERSION_MIGRATION_REQUIRED')
    }
    return run
  }

  create(versionStamp: AiVersionStamp, title = 'New session'): AIMutationResult<AISessionData> {
    const sessionId = this.createId()
    validateSessionId(sessionId)
    const sessions = this.mutableSessions()
    if (sessions[sessionId] !== undefined) throw new Error('AI_SESSION_ID_COLLISION')
    const timestamp = this.now()
    const normalizedVersionStamp = validateVersionStamp(versionStamp)
    const session: AISessionData = {
      manifest: {
        sessionId,
        title: normalizeTitle(title),
        versionStamp: normalizedVersionStamp,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      conversation: {
        messages: [],
        attachments: {},
        ...(normalizedVersionStamp.schemaVersion === 2 ? { clarifications: {} } : {})
      },
      state: {
        status: 'idle',
        runs: {},
        values: {}
      },
      cache: { values: {} },
      artifacts: { byId: {} },
      temp: { runs: {} }
    }
    sessions[sessionId] = session
    return { value: clone(session), mutated: true }
  }

  list(): AISessionListItem[] {
    return Object.values(this.sessions())
      .map((session) => clone(session.manifest))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  get(sessionId: string): AISessionData | undefined {
    validateSessionId(sessionId)
    const session = this.sessions()[sessionId]
    return session === undefined ? undefined : clone(session)
  }

  update(sessionId: string, update: AISessionUpdate): AIMutationResult<AISessionData> {
    const session = this.requireSession(sessionId)
    let mutated = false
    if (update.title !== undefined) {
      const title = normalizeTitle(update.title)
      if (title !== session.manifest.title) {
        session.manifest.title = title
        mutated = true
      }
    }
    if (mutated) this.touch(session)
    return { value: clone(session), mutated }
  }

  migrateSessionVersion(
    sessionId: string,
    targetVersionStamp: AiVersionStamp
  ): AIMutationResult<AISessionData> {
    const session = this.requireSession(sessionId)
    if (session.state.activeRunId !== undefined || session.state.status === 'running') {
      throw new Error('AI_RUN_ALREADY_ACTIVE')
    }
    const target = validateVersionStamp(targetVersionStamp)
    if (structurallyEqual(
      versionStampValue(session.manifest.versionStamp),
      versionStampValue(target)
    )) {
      return { value: clone(session), mutated: false }
    }
    validateAISessionVersionMigration(session.manifest.versionStamp, target)
    const existingAudit = session.state.values.versionMigrations
    if (existingAudit !== undefined && !Array.isArray(existingAudit)) {
      throw new Error('INVALID_AI_VERSION_MIGRATION_AUDIT')
    }
    const from = clone(session.manifest.versionStamp)
    const migratedAt = this.now()
    session.manifest.versionStamp = target
    session.cache.values = {}
    session.temp.runs = {}
    session.conversation.clarifications = {}
    const values = { ...session.state.values }
    delete values.activeArtifactId
    values.versionMigrations = [
      ...(existingAudit ?? []),
      { from: versionStampValue(from), to: versionStampValue(target), migratedAt }
    ]
    session.state.values = values
    session.state.status = 'idle'
    delete session.state.activeRunId
    session.manifest.updatedAt = migratedAt
    return { value: clone(session), mutated: true }
  }

  updateState(
    sessionId: string,
    update: AISessionStateUpdate
  ): AIMutationResult<AISessionState> {
    const session = this.requireSession(sessionId)
    let mutated = false
    if (update.status !== undefined) {
      if (!['idle', 'running', 'completed', 'failed', 'cancelled'].includes(update.status)) {
        throw new Error('INVALID_AI_SESSION_STATE')
      }
      if (session.state.status !== update.status) {
        session.state.status = update.status
        mutated = true
      }
    }
    if (update.activeRunId !== undefined) {
      if (update.activeRunId === null) {
        if (session.state.activeRunId !== undefined) {
          delete session.state.activeRunId
          mutated = true
        }
      } else {
        validatePathSegment(update.activeRunId)
        if (!hasOwn(session.state.runs, update.activeRunId)) {
          throw new Error('AI_RUN_NOT_FOUND')
        }
        if (session.state.activeRunId !== update.activeRunId) {
          session.state.activeRunId = update.activeRunId
          mutated = true
        }
      }
    }
    if (update.values !== undefined) {
      assertJsonValue(update.values)
      if (!structurallyEqual(session.state.values, update.values)) {
        session.state.values = clone(update.values)
        mutated = true
      }
    }
    if (mutated) this.touch(session)
    return { value: clone(session.state), mutated }
  }

  appendMessage(sessionId: string, input: unknown): AIMutationResult<AIMessage> {
    const session = this.requireSession(sessionId)
    const message = parseMessage(input)
    if (message.runId !== undefined && !hasOwn(session.state.runs, message.runId)) {
      throw new Error('AI_RUN_NOT_FOUND')
    }
    if (session.conversation.messages.some(({ id }) => id === message.id)) {
      throw new Error('AI_MESSAGE_ID_CONFLICT')
    }
    session.conversation.messages.push(message)
    this.touch(session)
    return { value: clone(message), mutated: true }
  }

  upsertAttachment(
    sessionId: string,
    input: unknown
  ): AIMutationResult<AIMessageAttachment> {
    const session = this.requireSession(sessionId)
    const attachment = parseAttachment(input)
    if (!session.conversation.messages.some(({ id }) => id === attachment.messageId)) {
      throw new Error('AI_MESSAGE_NOT_FOUND')
    }
    const existing = session.conversation.attachments[attachment.attachmentId]
    const mutated = existing === undefined || !structurallyEqual(existing as unknown as AIJsonValue, attachment as unknown as AIJsonValue)
    if (mutated) {
      session.conversation.attachments[attachment.attachmentId] = attachment
      this.touch(session)
    }
    return { value: clone(existing === undefined || mutated ? attachment : existing), mutated }
  }

  addClarification(sessionId: string, input: unknown): AIMutationResult<AIClarification> {
    const session = this.requireSession(sessionId)
    const clarifications = requireV2Session(session)
    const clarification = validateClarification(input)
    if (clarification.status !== 'unresolved') throw new Error('INVALID_AI_CLARIFICATION')
    if (hasOwn(clarifications, clarification.clarificationId)) {
      throw new Error('AI_CLARIFICATION_ID_CONFLICT')
    }
    const message = session.conversation.messages.find(({ id }) => id === clarification.messageId)
    if (message === undefined || message.role !== 'assistant' || message.runId !== clarification.runId) {
      throw new Error('AI_CLARIFICATION_MESSAGE_MISMATCH')
    }
    if (!hasOwn(session.state.runs, clarification.runId)) throw new Error('AI_RUN_NOT_FOUND')
    clarifications[clarification.clarificationId] = clarification
    this.touch(session)
    return { value: clone(clarification), mutated: true }
  }

  getLatestUnresolvedClarification(sessionId: string): AIClarification | undefined {
    const session = this.requireSession(sessionId)
    const clarifications = requireV2Session(session)
    for (const message of session.conversation.messages.toReversed()) {
      const clarification = Object.values(clarifications).find(
        (candidate) => candidate.messageId === message.id && candidate.status === 'unresolved'
      )
      if (clarification !== undefined) return clone(validateClarification(clarification))
    }
    return undefined
  }

  resolveLatestClarification(
    sessionId: string,
    input: unknown
  ): AIMutationResult<AIClarification> {
    if (!isPlainObject(input)) throw new Error('INVALID_AI_CLARIFICATION_RESOLUTION')
    exactKeys(input, ['clarificationId', 'resolvedByMessageId'], ['selectedOptionId'])
    validatePathSegment(input.clarificationId)
    validatePathSegment(input.resolvedByMessageId)
    if (input.selectedOptionId !== undefined) validatePathSegment(input.selectedOptionId)
    const session = this.requireSession(sessionId)
    const clarifications = requireV2Session(session)
    const latest = this.getLatestUnresolvedClarification(sessionId)
    if (latest === undefined || latest.clarificationId !== input.clarificationId) {
      throw new Error('AI_CLARIFICATION_NOT_LATEST')
    }
    const resolvingMessage = session.conversation.messages.find(
      ({ id }) => id === input.resolvedByMessageId
    )
    if (resolvingMessage?.role !== 'user') throw new Error('AI_MESSAGE_NOT_FOUND')
    if (input.selectedOptionId === undefined && resolvingMessage.content.trim().length === 0) {
      throw new Error('AI_CLARIFICATION_FREE_TEXT_REQUIRED')
    }
    if (input.selectedOptionId !== undefined &&
      !latest.options.some(({ id }) => id === input.selectedOptionId)) {
      throw new Error('AI_CLARIFICATION_OPTION_NOT_FOUND')
    }
    const resolved: AIClarification = {
      ...latest,
      status: 'resolved',
      resolvedAt: this.now(),
      resolvedByMessageId: input.resolvedByMessageId,
      ...(input.selectedOptionId === undefined ? {} : { selectedOptionId: input.selectedOptionId })
    }
    clarifications[latest.clarificationId] = resolved
    this.touch(session)
    return { value: clone(resolved), mutated: true }
  }

  upsertRun(sessionId: string, input: AIRun): AIMutationResult<AIRun> {
    if (!isPlainObject(input)) throw new Error('INVALID_AI_RUN')
    try {
      exactKeys(
        input,
        ['runId', 'status', 'startedAt', 'versionStamp'],
        [
          'completedAt', 'errorCode', 'requestId', 'operationId', 'userMessageId',
          'progress', 'failure', 'result'
        ]
      )
    } catch {
      throw new Error('INVALID_AI_RUN')
    }
    validatePathSegment(input.runId)
    if (
      !['running', 'completed', 'failed', 'cancelled'].includes(input.status) ||
      typeof input.startedAt !== 'string' ||
      input.startedAt.length === 0 ||
      (input.completedAt !== undefined &&
        (typeof input.completedAt !== 'string' || input.completedAt.length === 0)) ||
      (input.errorCode !== undefined &&
        (typeof input.errorCode !== 'string' || input.errorCode.length === 0))
    ) {
      throw new Error('INVALID_AI_RUN')
    }
    const session = this.requireSession(sessionId)
    const versionStamp = validateVersionStamp(input.versionStamp)
    assertVersionMatchesSession(session, versionStamp)
    if (session.manifest.versionStamp.schemaVersion === 2) {
      if (input.status !== 'running') throw new Error('AI_RUN_STATE_CONFLICT')
      validatePathSegment(input.requestId)
      validatePathSegment(input.operationId)
      validatePathSegment(input.userMessageId)
      if (input.progress === undefined) throw new Error('INVALID_AI_RUN_PROGRESS')
      const userMessage = session.conversation.messages.find(({ id }) => id === input.userMessageId)
      if (userMessage?.role !== 'user') throw new Error('AI_MESSAGE_NOT_FOUND')
    }
    if (input.requestId !== undefined) validatePathSegment(input.requestId)
    if (input.operationId !== undefined) validatePathSegment(input.operationId)
    if (input.userMessageId !== undefined) validatePathSegment(input.userMessageId)
    const progress = input.progress === undefined ? undefined : validateProgress(input.progress)
    const result = input.result === undefined ? undefined : validateRunResult(input.result)
    if (input.failure !== undefined) {
      validateTimestamp(input.failure.completedAt)
      validateFailureInput({ errorCode: input.failure.errorCode, details: input.failure.details })
    }
    if (input.status === 'running' &&
      (input.completedAt !== undefined || input.errorCode !== undefined || result !== undefined || input.failure !== undefined)) {
      throw new Error('INVALID_AI_RUN')
    }
    if (input.status === 'completed' && (input.completedAt === undefined ||
      session.manifest.versionStamp.schemaVersion === 2 && result === undefined)) {
      throw new Error('INVALID_AI_RUN')
    }
    if (input.status === 'failed' && (input.completedAt === undefined ||
      session.manifest.versionStamp.schemaVersion === 2 && input.failure === undefined)) {
      throw new Error('INVALID_AI_RUN')
    }
    if (input.operationId !== undefined && Object.values(session.state.runs).some(
      (run) => run.runId !== input.runId && run.operationId === input.operationId
    )) {
      throw new Error('AI_RUN_OPERATION_CONFLICT')
    }
    if (input.requestId !== undefined && Object.values(session.state.runs).some(
      (run) => run.runId !== input.runId && run.requestId === input.requestId
    )) {
      throw new Error('AI_RUN_REQUEST_CONFLICT')
    }
    const run: AIRun = {
      ...clone(input),
      versionStamp,
      ...(progress === undefined ? {} : { progress }),
      ...(result === undefined ? {} : { result })
    }
    assertJsonValue(run)
    const existing = session.state.runs[input.runId]
    if (existing !== undefined) assertJsonValue(existing)
    const mutated = existing === undefined || !structurallyEqual(
      existing as unknown as AIJsonValue,
      run as unknown as AIJsonValue
    )
    if (mutated) {
      if (existing !== undefined && session.manifest.versionStamp.schemaVersion === 2) {
        throw new Error('AI_RUN_STATE_CONFLICT')
      }
      session.state.runs[input.runId] = run
      this.touch(session)
    }
    return { value: clone(existing === undefined || mutated ? run : existing), mutated }
  }

  updateRunProgress(
    sessionId: string,
    runId: string,
    input: unknown
  ): AIMutationResult<AIRun> {
    const session = this.requireSession(sessionId)
    const run = this.requireActiveRun(session, runId)
    const progress = validateProgress(input)
    if (progress.stage === 'completed' || progress.stage === 'failed' || progress.stage === 'cancelled') {
      throw new Error('INVALID_AI_RUN_PROGRESS')
    }
    const updated = { ...run, progress }
    session.state.runs[runId] = updated
    this.touch(session)
    return { value: clone(updated), mutated: true }
  }

  completeRunWithResult(
    sessionId: string,
    runId: string,
    input: unknown
  ): AIMutationResult<AIRun> {
    const session = this.requireSession(sessionId)
    const run = this.requireActiveRun(session, runId)
    const result = validateRunResult(input)
    if (result.kind === 'questionnaire') {
      const artifact = session.artifacts.byId[result.artifactId]
      if (artifact === undefined || artifact.status !== 'completed') {
        throw new Error('AI_ARTIFACT_NOT_FOUND')
      }
      if (run.operationId !== undefined && artifact.operationId !== run.operationId) {
        throw new Error('AI_ARTIFACT_OPERATION_CONFLICT')
      }
    } else {
      const clarification = requireV2Session(session)[result.clarificationId]
      if (clarification === undefined || clarification.messageId !== result.messageId ||
        clarification.runId !== runId) {
        throw new Error('AI_CLARIFICATION_NOT_FOUND')
      }
    }
    const completedAt = this.now()
    const updated: AIRun = {
      ...run,
      status: 'completed',
      completedAt,
      result,
      progress: {
        stage: 'completed',
        attempt: run.progress?.attempt ?? 1,
        updatedAt: completedAt,
        streamFallback: run.progress?.streamFallback ?? false
      }
    }
    session.state.runs[runId] = updated
    delete session.temp.runs[runId]
    if (session.state.activeRunId === runId) delete session.state.activeRunId
    session.state.status = 'completed'
    this.touch(session)
    return { value: clone(updated), mutated: true }
  }

  failRun(
    sessionId: string,
    runId: string,
    input: unknown
  ): AIMutationResult<AIRun> {
    const session = this.requireSession(sessionId)
    const run = this.requireActiveRun(session, runId)
    const failureInput = validateFailureInput(input)
    const completedAt = this.now()
    const failure: AIRunFailure = { ...failureInput, completedAt }
    const updated: AIRun = {
      ...run,
      status: 'failed',
      completedAt,
      errorCode: failureInput.errorCode,
      failure,
      progress: {
        stage: 'failed',
        attempt: run.progress?.attempt ?? 1,
        updatedAt: completedAt,
        streamFallback: run.progress?.streamFallback ?? false
      }
    }
    session.state.runs[runId] = updated
    delete session.temp.runs[runId]
    if (session.state.activeRunId === runId) delete session.state.activeRunId
    session.state.status = 'failed'
    this.touch(session)
    return { value: clone(updated), mutated: true }
  }

  findRunByOperationId(sessionId: string, operationId: string): AIRun | undefined {
    validatePathSegment(operationId)
    const matches = Object.values(this.requireSession(sessionId).state.runs)
      .filter((run) => run.operationId === operationId)
    if (matches.length > 1) throw new Error('AI_RUN_OPERATION_CONFLICT')
    return matches[0] === undefined ? undefined : clone(matches[0])
  }

  setRunTemp(sessionId: string, input: AIRunTemp): AIMutationResult<AIRunTemp> {
    validatePathSegment(input.runId)
    if (typeof input.createdAt !== 'string' || input.createdAt.length === 0) {
      throw new Error('INVALID_AI_RUN_TEMP')
    }
    assertJsonValue(input.values)
    const session = this.requireSession(sessionId)
    const run = session.state.runs[input.runId]
    if (run === undefined) throw new Error('AI_RUN_NOT_FOUND')
    const versionStamp = validateVersionStamp(input.versionStamp)
    assertVersionMatchesSession(session, versionStamp)
    if (!structurallyEqual(versionStampValue(versionStamp), versionStampValue(run.versionStamp))) {
      throw new Error('AI_VERSION_STAMP_MISMATCH')
    }
    const runTemp: AIRunTemp = { ...clone(input), versionStamp }
    assertJsonValue(runTemp)
    const existing = session.temp.runs[input.runId]
    if (existing !== undefined) assertJsonValue(existing)
    const mutated = existing === undefined || !structurallyEqual(
      existing as unknown as AIJsonValue,
      runTemp as unknown as AIJsonValue
    )
    if (mutated) {
      session.temp.runs[input.runId] = runTemp
      this.touch(session)
    }
    return { value: clone(existing === undefined || mutated ? runTemp : existing), mutated }
  }

  delete(sessionId: string): AIMutationResult<boolean> {
    validateSessionId(sessionId)
    const sessions = this.sessions()
    if (sessions[sessionId] === undefined) return { value: false, mutated: false }
    delete sessions[sessionId]
    return { value: true, mutated: true }
  }

  readVirtual(path: string, currentSessionId: string): AIJsonValue {
    const parsed = parseAISessionVirtualPath(path, currentSessionId)
    const session = this.requireSession(parsed.sessionId)
    let value: unknown = session[parsed.partition]
    for (const segment of parsed.segments) {
      if (!isPlainObject(value) || !hasOwn(value, segment)) {
        throw new Error('AI_SESSION_VALUE_NOT_FOUND')
      }
      value = value[segment]
    }
    assertJsonValue(value)
    return clone(value)
  }

  writeVirtual(
    path: string,
    value: AIJsonValue,
    currentSessionId: string
  ): AIMutationResult<AIJsonValue> {
    const parsed = parseAISessionVirtualPath(path, currentSessionId)
    assertGeneralCacheValuePath(parsed)
    assertJsonValue(value)
    const session = this.requireSession(parsed.sessionId)
    let parent: unknown = session[parsed.partition]
    const parentSegments = parsed.segments.slice(0, -1)
    for (const segment of parentSegments) {
      if (!isPlainObject(parent)) invalidPath()
      if (!hasOwn(parent, segment)) parent[segment] = {}
      parent = parent[segment]
    }
    if (!isPlainObject(parent)) invalidPath()
    const key = parsed.segments.at(-1)!
    const clonedValue = clone(value)
    const mutated = !hasOwn(parent, key) || JSON.stringify(parent[key]) !== JSON.stringify(clonedValue)
    if (mutated) {
      parent[key] = clonedValue
      this.touch(session)
    }
    return { value: clone(clonedValue), mutated }
  }

  deleteVirtual(path: string, currentSessionId: string): AIMutationResult<boolean> {
    const parsed = parseAISessionVirtualPath(path, currentSessionId)
    assertGeneralCacheValuePath(parsed)
    const session = this.requireSession(parsed.sessionId)
    let parent: unknown = session[parsed.partition]
    for (const segment of parsed.segments.slice(0, -1)) {
      if (!isPlainObject(parent) || !hasOwn(parent, segment)) {
        return { value: false, mutated: false }
      }
      parent = parent[segment]
    }
    if (!isPlainObject(parent)) return { value: false, mutated: false }
    const key = parsed.segments.at(-1)!
    if (!hasOwn(parent, key)) return { value: false, mutated: false }
    delete parent[key]
    this.touch(session)
    return { value: true, mutated: true }
  }

  clearCache(sessionId: string): AIMutationResult<number> {
    const session = this.requireSession(sessionId)
    const removed = Object.keys(session.cache.values).length
    if (removed > 0) {
      session.cache.values = {}
      this.touch(session)
    }
    return { value: removed, mutated: removed > 0 }
  }

  cleanupRunTemp(sessionId: string, runId: string): AIMutationResult<boolean> {
    validatePathSegment(runId)
    const session = this.requireSession(sessionId)
    if (!hasOwn(session.temp.runs, runId)) return { value: false, mutated: false }
    delete session.temp.runs[runId]
    this.touch(session)
    return { value: true, mutated: true }
  }

  clearAllTempOnStartup(): AIMutationResult<number> {
    return this.recoverInterruptedRuns()
  }

  recoverInterruptedRuns(): AIMutationResult<number> {
    let removed = 0
    for (const session of Object.values(this.sessions())) {
      const runCount = Object.keys(session.temp.runs).length
      const interruptedRunIds = new Set([
        ...Object.values(session.state.runs)
          .filter((run) => run.status === 'running')
          .map((run) => run.runId),
        ...(session.state.activeRunId === undefined ? [] : [session.state.activeRunId])
      ])
      const interrupted = interruptedRunIds.size > 0 || session.state.status === 'running'
      if (runCount > 0 || interrupted) {
        const completedAt = this.now()
        for (const runId of interruptedRunIds) {
          const run = session.state.runs[runId]
          if (run?.status === 'running') {
            session.state.runs[runId] = {
              ...run,
              status: 'failed',
              completedAt,
              errorCode: 'AI_RUN_INTERRUPTED'
            }
          }
        }
        if (runCount > 0) session.temp.runs = {}
        if (interrupted) {
          delete session.state.activeRunId
          session.state.status = 'failed'
        }
        removed += runCount + (interrupted ? Math.max(interruptedRunIds.size, 1) : 0)
        this.touch(session)
      }
    }
    return { value: removed, mutated: removed > 0 }
  }

  upsertArtifact(sessionId: string, value: unknown): AIMutationResult<AIArtifact> {
    const input = parseArtifactUpsert(value)
    validatePathSegment(input.artifactId)
    validatePathSegment(input.operationId)
    if (
      input.kind.length === 0 ||
      input.kind.length > 128 ||
      input.kind !== input.kind.trim() ||
      (input.errorCode !== undefined &&
        (input.errorCode.length === 0 || input.errorCode.length > 128))
    ) {
      throw new Error('INVALID_AI_ARTIFACT')
    }
    if (input.value !== undefined) assertJsonValue(input.value)
    const versionStamp = validateVersionStamp(input.versionStamp)

    const session = this.requireSession(sessionId)
    assertVersionMatchesSession(session, versionStamp)

    const artifactById = session.artifacts.byId[input.artifactId]
    if (artifactById !== undefined && artifactById.operationId !== input.operationId) {
      throw new Error('AI_ARTIFACT_ID_CONFLICT')
    }

    const artifactByOperation = Object.values(session.artifacts.byId)
      .find((artifact) => artifact.operationId === input.operationId)
    if (artifactByOperation !== undefined) {
      if (structurallyEqual(artifactPayload(artifactByOperation), artifactPayload(input))) {
        return { value: clone(artifactByOperation), mutated: false }
      }
      throw new Error('AI_ARTIFACT_OPERATION_CONFLICT')
    }

    const timestamp = this.now()
    const artifact: AIArtifact = {
      artifactId: input.artifactId,
      operationId: input.operationId,
      kind: input.kind,
      status: input.status,
      versionStamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.value === undefined ? {} : { value: clone(input.value) }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode })
    }
    session.artifacts.byId[input.artifactId] = artifact
    this.touch(session)
    return { value: clone(artifact), mutated: true }
  }
}
