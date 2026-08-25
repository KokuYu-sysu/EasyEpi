import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { AIArtifact, AIJsonValue, AiVersionStamp, AISessionData } from '@shared/ai-assistant-contract'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { ProjectData } from '@shared/types/project'

import type { AIMainConfig } from './ai-config.service'
import {
  artifactValueAsJson,
  buildAIContentCacheKey,
  buildQuestionnaireContext,
  diffQuestionnaires,
  hashAIQuestionnaire,
  migrateAISessionVersion,
  resolveAIRegistryEntry,
  stripDerivedVariables,
  validateQuestionnaireArtifact,
  validateStrictQuestionnaireDto,
  type AIValidationError,
  type QuestionnaireArtifactValue
} from './ai-questionnaire.harness'
import { AISessionRepository } from './ai-session.repository'
import { DerivedService } from './derived/derived.service'
import {
  AIClientError,
  createOpenAICompatibleClient,
  type AIChatCompletionRequest,
  type AIChatCompletionResult
} from './openai-compatible.client'

export type AIPersistReason =
  | 'run-started'
  | 'repair-requested'
  | 'run-completed'
  | 'run-failed'
  | 'session-migrated'
export type AIPersistProjectHook = (project: ProjectData, reason: AIPersistReason) => void | Promise<void>

export interface AIQuestionnaireOrchestratorDependencies {
  persistProject: AIPersistProjectHook
  client?: { complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> }
  createId?: () => string
  now?: () => string
}

export interface AISendTurnRequest {
  project: ProjectData
  sessionId: string
  userText: string
  config: AIMainConfig
  explicitAttachment?: QuestionnaireDef
  signal?: AbortSignal
  operationId?: string
  runId?: string
}

export type AISendTurnResult =
  | { ok: true; artifact: AIArtifact; attempts: number }
  | { ok: false; errorCode: string; validationErrors?: AIValidationError[] }

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_CONTEXT_CHARACTERS = 60_000
const MAX_REPAIR_INSTRUCTION_BYTES = 8_000
const PROJECT_AI_QUEUES = new WeakMap<ProjectData, Promise<void>>()

function withProjectAIQueue<T>(project: ProjectData, task: () => Promise<T> | T): Promise<T> {
  const previous = PROJECT_AI_QUEUES.get(project) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(task)
  const tail = result.then(() => undefined, () => undefined)
  PROJECT_AI_QUEUES.set(project, tail)
  void tail.then(() => {
    if (PROJECT_AI_QUEUES.get(project) === tail) PROJECT_AI_QUEUES.delete(project)
  })
  return result
}

function jsonObject(value: unknown): value is Record<string, AIJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseArtifactValue(
  project: ProjectData,
  session: AISessionData,
  artifact: AIArtifact | undefined,
  checkStale = true
): QuestionnaireArtifactValue {
  const value = validateQuestionnaireArtifact(
    artifact,
    session.manifest.versionStamp,
    (project.questionnaire.derivedVariables ?? []).map((item) => item.variableName)
  )
  if (checkStale && value.baseQuestionnaireHash !== hashAIQuestionnaire(project.questionnaire)) {
    throw new Error('AI_ARTIFACT_STALE')
  }
  return value
}

function restoreAssistant(project: ProjectData, snapshot: ProjectData['aiAssistant']): void {
  if (snapshot === undefined) delete project.aiAssistant
  else project.aiAssistant = snapshot
}

async function mutateAndPersist(
  project: ProjectData,
  persistProject: AIPersistProjectHook,
  reason: AIPersistReason,
  mutate: () => void
): Promise<void> {
  await withProjectAIQueue(project, async () => {
    const snapshot = project.aiAssistant === undefined ? undefined : structuredClone(project.aiAssistant)
    try {
      mutate()
    } catch (error) {
      restoreAssistant(project, snapshot)
      throw error
    }
    try {
      await persistProject(project, reason)
    } catch {
      restoreAssistant(project, snapshot)
      throw new Error('AI_PERSIST_FAILED')
    }
  })
}

function safeErrorCode(error: unknown): string {
  if (error instanceof AIClientError) return error.code
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,127}$/.test(error.message)) return error.message
  return 'AI_INTERNAL_ERROR'
}

function validateUserText(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 100_000 || value.includes('\0')) {
    throw new Error('INVALID_AI_USER_TEXT')
  }
  return value.trim()
}

function signalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

function responseCapability(value: AIJsonValue | undefined): boolean | undefined {
  if (!jsonObject(value) || typeof value.supported !== 'boolean') return undefined
  return value.supported
}

function repairInstruction(errors: readonly AIValidationError[]): string {
  const prefix = 'The candidate was rejected by the local harness. Return a corrected full JSON envelope. Validation errors:\n'
  const selected: Array<{ code: string; path: string; message: string }> = []
  const encoder = new TextEncoder()
  for (const error of errors) {
    const next = [...selected, { code: error.code, path: error.path, message: error.message.slice(0, 200) }]
    if (encoder.encode(`${prefix}${JSON.stringify(next)}`).byteLength > MAX_REPAIR_INSTRUCTION_BYTES) break
    selected.push(next.at(-1)!)
  }
  return `${prefix}${JSON.stringify(selected)}`
}

function sameVersionStamp(left: AiVersionStamp, right: AiVersionStamp): boolean {
  return left.promptId === right.promptId && left.promptVersion === right.promptVersion &&
    left.promptHash === right.promptHash && left.harnessVersion === right.harnessVersion &&
    left.schemaVersion === right.schemaVersion
}

export interface AIMigrateSessionVersionRequest {
  project: ProjectData
  sessionId: string
  targetVersionStamp: AiVersionStamp
  persistProject: AIPersistProjectHook
}

export async function migrateSessionVersion(
  request: AIMigrateSessionVersionRequest
): Promise<{ migrated: boolean }> {
  const repository = new AISessionRepository(request.project)
  const session = repository.get(request.sessionId)
  if (session === undefined) throw new Error('AI_SESSION_NOT_FOUND')
  resolveAIRegistryEntry(session.manifest.versionStamp)
  const target = resolveAIRegistryEntry(request.targetVersionStamp)
  if (target.compatibility !== 'supported') throw new Error('AI_VERSION_MIGRATION_REQUIRED')
  migrateAISessionVersion(session.manifest.versionStamp, request.targetVersionStamp)
  if (sameVersionStamp(session.manifest.versionStamp, request.targetVersionStamp)) {
    return { migrated: false }
  }
  await mutateAndPersist(request.project, request.persistProject, 'session-migrated', () => {
    repository.migrateSessionVersion(request.sessionId, request.targetVersionStamp)
  })
  return { migrated: true }
}

export function createAIQuestionnaireOrchestrator(
  dependencies: AIQuestionnaireOrchestratorDependencies
): { sendTurn(request: AISendTurnRequest): Promise<AISendTurnResult> } {
  const client = dependencies.client ?? createOpenAICompatibleClient()
  const createId = dependencies.createId ?? randomUUID
  const now = dependencies.now ?? (() => new Date().toISOString())

  return {
    async sendTurn(request: AISendTurnRequest): Promise<AISendTurnResult> {
      const repository = new AISessionRepository(request.project)
      const session = repository.get(request.sessionId)
      if (session === undefined) return { ok: false, errorCode: 'AI_SESSION_NOT_FOUND' }
      const operationId = request.operationId ?? createId()
      if (!OPERATION_ID_PATTERN.test(operationId)) {
        return { ok: false, errorCode: 'INVALID_AI_OPERATION_ID' }
      }
      const existingArtifact = Object.values(session.artifacts.byId)
        .find((artifact) => artifact.operationId === operationId)
      if (existingArtifact?.status === 'completed') {
        try {
          parseArtifactValue(request.project, session, existingArtifact, false)
          return { ok: true, artifact: existingArtifact, attempts: 0 }
        } catch (error) {
          return { ok: false, errorCode: safeErrorCode(error) }
        }
      }
      let userText: string
      try {
        userText = validateUserText(request.userText)
      } catch (error) {
        return { ok: false, errorCode: safeErrorCode(error) }
      }
      if (signalAborted(request.signal)) return { ok: false, errorCode: 'AI_CANCELLED' }

      const versionStamp = session.manifest.versionStamp
      let registryEntry: Extract<ReturnType<typeof resolveAIRegistryEntry>, { compatibility: 'supported' }>
      let baseQuestionnaire: QuestionnaireDef
      let baseQuestionnaireHash: string
      let explicitAttachment: QuestionnaireDef | undefined
      let activeDraft: QuestionnaireDef | undefined
      let activeArtifactId: string | undefined
      let capabilityKey: string
      const protectedDerivedNames = (request.project.questionnaire.derivedVariables ?? [])
        .map((item) => item.variableName)
      try {
        const resolvedEntry = resolveAIRegistryEntry(versionStamp)
        if (resolvedEntry.compatibility !== 'supported') throw new Error('AI_VERSION_MIGRATION_REQUIRED')
        registryEntry = resolvedEntry
        baseQuestionnaire = validateStrictQuestionnaireDto(
          stripDerivedVariables(request.project.questionnaire)
        )
        baseQuestionnaireHash = hashAIQuestionnaire(baseQuestionnaire)
        if (request.explicitAttachment !== undefined) {
          explicitAttachment = validateStrictQuestionnaireDto(
            stripDerivedVariables(request.explicitAttachment)
          )
          if (hashAIQuestionnaire(explicitAttachment) !== baseQuestionnaireHash) {
            throw new Error('AI_ARTIFACT_STALE')
          }
        }
        activeArtifactId = typeof session.state.values.activeArtifactId === 'string'
          ? session.state.values.activeArtifactId
          : undefined
        if (activeArtifactId !== undefined) {
          const activeValue = validateQuestionnaireArtifact(
            session.artifacts.byId[activeArtifactId],
            versionStamp,
            protectedDerivedNames
          )
          const activeDraftHash = hashAIQuestionnaire(activeValue.draft)
          if (baseQuestionnaireHash !== activeValue.baseQuestionnaireHash &&
            baseQuestionnaireHash !== activeDraftHash) {
            throw new Error('AI_ARTIFACT_STALE')
          }
          activeDraft = activeValue.draft
        }
        capabilityKey = `cap-${buildAIContentCacheKey({
          projectId: request.project.meta.projectId ?? '',
          sessionId: request.sessionId,
          promptHash: versionStamp.promptHash,
          schemaVersion: versionStamp.schemaVersion,
          baseUrl: request.config.baseUrl,
          model: request.config.model
        })}`
      } catch (error) {
        return { ok: false, errorCode: safeErrorCode(error) }
      }
      const runId = request.runId ?? createId()
      if (!OPERATION_ID_PATTERN.test(runId) || session.state.runs[runId] !== undefined) {
        return { ok: false, errorCode: 'AI_RUN_ID_CONFLICT' }
      }
      const messageId = createId()
      const artifactId = createId()
      const startedAt = now()
      try {
        await mutateAndPersist(request.project, dependencies.persistProject, 'run-started', () => {
          const lockedSession = repository.get(request.sessionId)
          if (lockedSession === undefined) throw new Error('AI_SESSION_NOT_FOUND')
          if (lockedSession.state.activeRunId !== undefined || lockedSession.state.status === 'running') {
            throw new Error('AI_RUN_ALREADY_ACTIVE')
          }
          if (lockedSession.state.runs[runId] !== undefined) throw new Error('AI_RUN_ID_CONFLICT')
          const lockedActiveArtifactId = typeof lockedSession.state.values.activeArtifactId === 'string'
            ? lockedSession.state.values.activeArtifactId
            : undefined
          if (lockedActiveArtifactId !== activeArtifactId ||
            hashAIQuestionnaire(request.project.questionnaire) !== baseQuestionnaireHash) {
            throw new Error('AI_ARTIFACT_STALE')
          }
          repository.upsertRun(request.sessionId, { runId, status: 'running', startedAt, versionStamp })
          repository.appendMessage(request.sessionId, {
            id: messageId,
            role: 'user',
            content: userText,
            createdAt: startedAt,
            runId
          })
          if (request.explicitAttachment !== undefined) {
            repository.upsertAttachment(request.sessionId, {
              attachmentId: createId(),
              messageId,
              kind: 'questionnaire',
              createdAt: startedAt,
              value: explicitAttachment as unknown as AIJsonValue
            })
          }
          repository.setRunTemp(request.sessionId, {
            runId,
            versionStamp,
            createdAt: startedAt,
            values: { operationId, attempt: 1 }
          })
          repository.updateState(request.sessionId, { status: 'running', activeRunId: runId })
        })
      } catch (error) {
        return { ok: false, errorCode: safeErrorCode(error) }
      }

      const runningSession = repository.get(request.sessionId)!
      let errorCode: string | undefined
      const base = activeDraft ?? (explicitAttachment === undefined
        ? { name: '', questions: [], conditionRules: [], keyQuestionIds: [] }
        : explicitAttachment)
      let capability = responseCapability(runningSession.cache.values[capabilityKey])
      let lastErrors: AIValidationError[] | undefined
      let repair: string | undefined
      let attempts = 0
      let resultValue: QuestionnaireArtifactValue | undefined
      for (attempts = 1; attempts <= 3 && errorCode === undefined; attempts += 1) {
        try {
          const messages = buildQuestionnaireContext(
            runningSession,
            activeDraft,
            explicitAttachment,
            MAX_CONTEXT_CHARACTERS - (repair?.length ?? 0),
            registryEntry
          )
          if (repair !== undefined) messages.push({ role: 'system', content: repair })
          const completion = await client.complete({
            ...request.config,
            messages,
            signal: request.signal,
            responseFormatSupported: capability,
            schemaVersion: registryEntry.schemaVersion
          })
          if (signalAborted(request.signal)) throw new AIClientError('AI_CANCELLED')
          capability = completion.responseFormatSupported
          await withProjectAIQueue(request.project, () => {
            repository.writeVirtual(
              `session://${request.sessionId}/cache/values/${capabilityKey}`,
              { supported: completion.responseFormatSupported },
              request.sessionId
            )
          })
          const harness = registryEntry.runHarness(completion.content, base, protectedDerivedNames)
          if (harness.ok) {
            resultValue = {
              ...harness.value,
              diff: diffQuestionnaires(baseQuestionnaire, harness.value.draft),
              baseQuestionnaireHash,
              baseQuestionnaire
            }
            break
          }
          lastErrors = harness.errors
          if (attempts === 3) {
            errorCode = 'AI_HARNESS_VALIDATION_FAILED'
            break
          }
          repair = repairInstruction(harness.errors)
          await mutateAndPersist(request.project, dependencies.persistProject, 'repair-requested', () => {
            repository.setRunTemp(request.sessionId, {
              runId,
              versionStamp,
              createdAt: startedAt,
              values: { operationId, attempt: attempts + 1, validationErrors: harness.errors as unknown as AIJsonValue }
            })
          })
        } catch (error) {
          errorCode = safeErrorCode(error)
          break
        }
      }

      if (resultValue !== undefined && signalAborted(request.signal)) {
        resultValue = undefined
        errorCode = 'AI_CANCELLED'
      }
      if (resultValue !== undefined) {
        try {
          let artifact: AIArtifact | undefined
          const completedAt = now()
          await mutateAndPersist(request.project, dependencies.persistProject, 'run-completed', () => {
            if (hashAIQuestionnaire(request.project.questionnaire) !== baseQuestionnaireHash) {
              throw new Error('AI_ARTIFACT_STALE')
            }
            repository.appendMessage(request.sessionId, {
              id: createId(),
              role: 'assistant',
              content: resultValue!.assistantMessage,
              createdAt: completedAt,
              runId
            })
            artifact = repository.upsertArtifact(request.sessionId, {
              artifactId,
              operationId,
              kind: 'questionnaire-draft',
              status: 'completed',
              versionStamp,
              value: artifactValueAsJson(resultValue!)
            }).value
            const currentValues = repository.get(request.sessionId)!.state.values
            repository.updateState(request.sessionId, {
              status: 'completed',
              activeRunId: null,
              values: {
                ...currentValues,
                activeArtifactId: artifactId,
                rollingSummary: resultValue!.rollingSummary
              }
            })
            repository.upsertRun(request.sessionId, {
              runId,
              status: 'completed',
              startedAt,
              completedAt,
              versionStamp
            })
            repository.cleanupRunTemp(request.sessionId, runId)
          })
          return { ok: true, artifact: artifact!, attempts }
        } catch (error) {
          errorCode = safeErrorCode(error)
        }
      }

      const finalCode = errorCode ?? 'AI_INTERNAL_ERROR'
      try {
        const completedAt = now()
        await mutateAndPersist(request.project, dependencies.persistProject, 'run-failed', () => {
          repository.upsertRun(request.sessionId, {
            runId,
            status: finalCode === 'AI_CANCELLED' ? 'cancelled' : 'failed',
            startedAt,
            completedAt,
            versionStamp,
            errorCode: finalCode
          })
          repository.updateState(request.sessionId, {
            status: finalCode === 'AI_CANCELLED' ? 'cancelled' : 'failed',
            activeRunId: null
          })
          repository.cleanupRunTemp(request.sessionId, runId)
        })
      } catch {
        await withProjectAIQueue(request.project, () => repository.recoverInterruptedRuns())
        return { ok: false, errorCode: 'AI_PERSIST_FAILED', ...(lastErrors === undefined ? {} : { validationErrors: lastErrors }) }
      }
      return { ok: false, errorCode: finalCode, ...(lastErrors === undefined ? {} : { validationErrors: lastErrors }) }
    }
  }
}

export function getQuestionnaireArtifact(
  project: ProjectData,
  sessionId: string,
  artifactId: string
): AIArtifact | undefined {
  const session = new AISessionRepository(project).get(sessionId)
  if (session === undefined) return undefined
  const artifact = session.artifacts.byId[artifactId]
  if (artifact === undefined) return undefined
  parseArtifactValue(project, session, artifact)
  return artifact
}

export function previewQuestionnaireArtifact(
  project: ProjectData,
  sessionId: string,
  artifactId: string
): QuestionnaireArtifactValue | undefined {
  const session = new AISessionRepository(project).get(sessionId)
  if (session === undefined) return undefined
  const artifact = session.artifacts.byId[artifactId]
  return artifact === undefined ? undefined : parseArtifactValue(project, session, artifact)
}

export interface ApplyQuestionnaireArtifactRequest {
  project: ProjectData
  sessionId: string
  artifactId: string
  operationId?: string
  currentProjectPath: string
  backup(questionnaire: QuestionnaireDef, currentProjectPath: string, artifactId: string): void | Promise<void>
  saveAtomic(project: ProjectData, currentProjectPath: string): void | Promise<void>
}

export async function applyArtifact(
  request: ApplyQuestionnaireArtifactRequest
): Promise<{ applied: boolean; questionnaire: QuestionnaireDef }> {
  if (!path.isAbsolute(request.currentProjectPath) || request.currentProjectPath.includes('\0')) {
    throw new Error('INVALID_CURRENT_PROJECT_PATH')
  }
  return withProjectAIQueue(request.project, async () => {
    const repository = new AISessionRepository(request.project)
    const session = repository.get(request.sessionId)
    if (session === undefined) throw new Error('AI_SESSION_NOT_FOUND')
    const operationId = request.operationId ?? request.artifactId
    if (!OPERATION_ID_PATTERN.test(operationId)) {
      throw new Error('INVALID_AI_APPLY_OPERATION')
    }
    const appliedArtifacts = jsonObject(session.state.values.appliedArtifacts)
      ? session.state.values.appliedArtifacts
      : {}
    const appliedOperations = jsonObject(session.state.values.appliedOperations)
      ? session.state.values.appliedOperations
      : {}
    if (appliedArtifacts[request.artifactId] !== undefined) {
      return { applied: false, questionnaire: structuredClone(request.project.questionnaire) }
    }
    if (appliedOperations[operationId] !== undefined && appliedOperations[operationId] !== request.artifactId) {
      throw new Error('AI_APPLY_OPERATION_CONFLICT')
    }
    const value = previewQuestionnaireArtifact(request.project, request.sessionId, request.artifactId)
    if (value === undefined) throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
    const questionnaireSnapshot = structuredClone(request.project.questionnaire)
    const metaSnapshot = structuredClone(request.project.meta)
    const assistantSnapshot = request.project.aiAssistant === undefined
      ? undefined
      : structuredClone(request.project.aiAssistant)
    const derivedVariables = questionnaireSnapshot.derivedVariables
    const nextQuestionnaire: QuestionnaireDef = {
      ...structuredClone(value.draft),
      ...(derivedVariables === undefined ? {} : { derivedVariables })
    }
    if (!new DerivedService().validateDerivedVariables(nextQuestionnaire).ok) {
      throw new Error('AI_ARTIFACT_DERIVED_CONFLICT')
    }
    await request.backup(questionnaireSnapshot, request.currentProjectPath, request.artifactId)
    try {
      request.project.questionnaire = nextQuestionnaire
      repository.updateState(request.sessionId, {
        values: {
          ...session.state.values,
          appliedArtifacts: { ...appliedArtifacts, [request.artifactId]: operationId },
          appliedOperations: { ...appliedOperations, [operationId]: request.artifactId }
        }
      })
      await request.saveAtomic(request.project, request.currentProjectPath)
      return { applied: true, questionnaire: structuredClone(nextQuestionnaire) }
    } catch {
      request.project.questionnaire = questionnaireSnapshot
      request.project.meta = metaSnapshot
      restoreAssistant(request.project, assistantSnapshot)
      throw new Error('AI_ARTIFACT_APPLY_FAILED')
    }
  })
}
