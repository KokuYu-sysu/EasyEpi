import { randomUUID } from 'node:crypto'

import type {
  AIArtifact,
  AIArtifactStatus,
  AIJsonValue,
  AIMessage,
  AIMessageAttachment,
  AIMutationResult,
  AIRun,
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
      conversation: { messages: [], attachments: {} },
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

  upsertRun(sessionId: string, input: AIRun): AIMutationResult<AIRun> {
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
    const run: AIRun = { ...clone(input), versionStamp }
    assertJsonValue(run)
    const existing = session.state.runs[input.runId]
    if (existing !== undefined) assertJsonValue(existing)
    const mutated = existing === undefined || !structurallyEqual(
      existing as unknown as AIJsonValue,
      run as unknown as AIJsonValue
    )
    if (mutated) {
      session.state.runs[input.runId] = run
      this.touch(session)
    }
    return { value: clone(existing === undefined || mutated ? run : existing), mutated }
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
    let removed = 0
    for (const session of Object.values(this.sessions())) {
      const runCount = Object.keys(session.temp.runs).length
      if (runCount > 0) {
        session.temp.runs = {}
        removed += runCount
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
