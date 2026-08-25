import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { AIArtifact, AIJsonValue, AISessionData } from '@shared/ai-assistant-contract'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { ProjectData } from '@shared/types/project'

import type { AIMainConfig } from './ai-config.service'
import {
  artifactValueAsJson,
  buildAIContentCacheKey,
  buildQuestionnaireContext,
  hashAIQuestionnaire,
  resolveAIRegistryEntry,
  stripDerivedVariables,
  validateQuestionnaireDraft,
  type AIValidationError,
  type QuestionnaireArtifactValue,
  type QuestionnaireDiffSummary
} from './ai-questionnaire.harness'
import { AISessionRepository } from './ai-session.repository'
import { DerivedService } from './derived/derived.service'
import {
  AIClientError,
  createOpenAICompatibleClient,
  type AIChatCompletionRequest,
  type AIChatCompletionResult
} from './openai-compatible.client'

export type AIPersistReason = 'run-started' | 'repair-requested' | 'run-completed' | 'run-failed'
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

function jsonObject(value: unknown): value is Record<string, AIJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

function validDiff(value: unknown): value is QuestionnaireDiffSummary {
  if (!jsonObject(value) || !exactKeys(value, ['metadata', 'questions', 'rules'])) return false
  if (!jsonObject(value.metadata) || !exactKeys(value.metadata, ['name', 'description'])) return false
  const nameChange = value.metadata.name
  const descriptionChange = value.metadata.description
  if (!(nameChange === null || (jsonObject(nameChange) && exactKeys(nameChange, ['before', 'after']) &&
    typeof nameChange.before === 'string' && typeof nameChange.after === 'string'))) return false
  if (!(descriptionChange === null || (jsonObject(descriptionChange) && exactKeys(descriptionChange, ['before', 'after']) &&
    (descriptionChange.before === null || typeof descriptionChange.before === 'string') &&
    (descriptionChange.after === null || typeof descriptionChange.after === 'string')))) return false
  if (!jsonObject(value.questions) || !exactKeys(value.questions, ['added', 'removed', 'modified'])) return false
  if (!Array.isArray(value.questions.added) || !Array.isArray(value.questions.removed) || !Array.isArray(value.questions.modified)) return false
  const validQuestionSummary = (item: AIJsonValue): boolean =>
    jsonObject(item) && exactKeys(item, ['id', 'variableName', 'content']) &&
    typeof item.id === 'string' && typeof item.variableName === 'string' && typeof item.content === 'string'
  const validModified = (item: AIJsonValue): boolean =>
    jsonObject(item) && exactKeys(item, ['id', 'variableName', 'fields']) &&
    typeof item.id === 'string' && typeof item.variableName === 'string' &&
    Array.isArray(item.fields) && item.fields.every((field) => typeof field === 'string')
  if (!value.questions.added.every(validQuestionSummary) ||
    !value.questions.removed.every(validQuestionSummary) ||
    !value.questions.modified.every(validModified)) return false
  if (!jsonObject(value.rules) || !exactKeys(value.rules, ['added', 'removed', 'modified'])) return false
  const rules = value.rules
  return (['added', 'removed', 'modified'] as const).every((key) =>
    Array.isArray(rules[key]) && rules[key].every((item) => typeof item === 'string')
  )
}

function sameVersion(left: AIArtifact['versionStamp'], right: AIArtifact['versionStamp']): boolean {
  return left.promptId === right.promptId && left.promptVersion === right.promptVersion &&
    left.promptHash === right.promptHash && left.harnessVersion === right.harnessVersion &&
    left.schemaVersion === right.schemaVersion
}

function parseArtifactValue(
  project: ProjectData,
  session: AISessionData,
  artifact: AIArtifact | undefined,
  checkStale = true
): QuestionnaireArtifactValue {
  if (artifact?.kind !== 'questionnaire-draft' || artifact.status !== 'completed' ||
    !sameVersion(artifact.versionStamp, session.manifest.versionStamp)) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  resolveAIRegistryEntry(artifact.versionStamp)
  if (!jsonObject(artifact.value) || !exactKeys(artifact.value, [
    'draft', 'diff', 'assistantMessage', 'rollingSummary', 'baseQuestionnaireHash', 'validation'
  ])) throw new Error('AI_ARTIFACT_INVALID')
  const value = artifact.value
  if (typeof value.assistantMessage !== 'string' || typeof value.rollingSummary !== 'string' ||
    value.assistantMessage.length === 0 || value.assistantMessage.length > 20_000 ||
    value.rollingSummary.length > 20_000 ||
    typeof value.baseQuestionnaireHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.baseQuestionnaireHash) || !validDiff(value.diff) ||
    !jsonObject(value.validation) || !exactKeys(value.validation, ['success', 'errors']) ||
    value.validation.success !== true || !Array.isArray(value.validation.errors) ||
    value.validation.errors.length !== 0 || !jsonObject(value.draft) ||
    Object.prototype.hasOwnProperty.call(value.draft, 'derivedVariables')) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  const draft = value.draft as unknown as QuestionnaireDef
  if (!validateQuestionnaireDraft(draft, (project.questionnaire.derivedVariables ?? []).map((item) => item.variableName)).ok) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  const safeDraft = stripDerivedVariables(draft)
  if (checkStale && value.baseQuestionnaireHash !== hashAIQuestionnaire(project.questionnaire)) {
    throw new Error('AI_ARTIFACT_STALE')
  }
  return {
    draft: safeDraft,
    diff: structuredClone(value.diff),
    assistantMessage: value.assistantMessage,
    rollingSummary: value.rollingSummary,
    baseQuestionnaireHash: value.baseQuestionnaireHash,
    validation: { success: true, errors: [] }
  }
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
  const snapshot = project.aiAssistant === undefined ? undefined : structuredClone(project.aiAssistant)
  mutate()
  try {
    await persistProject(project, reason)
  } catch {
    restoreAssistant(project, snapshot)
    throw new Error('AI_PERSIST_FAILED')
  }
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
      if (session.state.activeRunId !== undefined || session.state.status === 'running') {
        return { ok: false, errorCode: 'AI_RUN_ALREADY_ACTIVE' }
      }
      let userText: string
      try {
        userText = validateUserText(request.userText)
      } catch (error) {
        return { ok: false, errorCode: safeErrorCode(error) }
      }
      if (signalAborted(request.signal)) return { ok: false, errorCode: 'AI_CANCELLED' }

      const versionStamp = session.manifest.versionStamp
      let registryEntry
      let baseQuestionnaireHash: string
      let capabilityKey: string
      try {
        registryEntry = resolveAIRegistryEntry(versionStamp)
        baseQuestionnaireHash = hashAIQuestionnaire(request.project.questionnaire)
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
              value: stripDerivedVariables(request.explicitAttachment) as unknown as AIJsonValue
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
      const activeArtifactId = typeof runningSession.state.values.activeArtifactId === 'string'
        ? runningSession.state.values.activeArtifactId
        : undefined
      let errorCode: string | undefined
      let activeDraft: QuestionnaireDef | undefined
      if (activeArtifactId !== undefined) {
        try {
          activeDraft = parseArtifactValue(
            request.project,
            runningSession,
            runningSession.artifacts.byId[activeArtifactId],
            false
          ).draft
        } catch (error) {
          errorCode = safeErrorCode(error)
        }
      }
      const base = activeDraft ?? (request.explicitAttachment === undefined
        ? { name: '', questions: [], conditionRules: [], keyQuestionIds: [] }
        : stripDerivedVariables(request.explicitAttachment))
      const protectedDerivedNames = (request.project.questionnaire.derivedVariables ?? [])
        .map((item) => item.variableName)
      let messages: ReturnType<typeof buildQuestionnaireContext> = []
      try {
        messages = buildQuestionnaireContext(
          runningSession,
          activeDraft,
          request.explicitAttachment,
          60_000,
          registryEntry
        )
      } catch (error) {
        errorCode = safeErrorCode(error)
      }
      let capability = responseCapability(runningSession.cache.values[capabilityKey])
      let lastErrors: AIValidationError[] | undefined
      let attempts = 0
      let resultValue: QuestionnaireArtifactValue | undefined
      for (attempts = 1; attempts <= 3 && errorCode === undefined; attempts += 1) {
        try {
          const completion = await client.complete({
            ...request.config,
            messages,
            signal: request.signal,
            responseFormatSupported: capability,
            schemaVersion: registryEntry.schemaVersion
          })
          if (signalAborted(request.signal)) throw new AIClientError('AI_CANCELLED')
          capability = completion.responseFormatSupported
          repository.writeVirtual(
            `session://${request.sessionId}/cache/values/${capabilityKey}`,
            { supported: capability },
            request.sessionId
          )
          const harness = registryEntry.runHarness(completion.content, base, protectedDerivedNames)
          if (harness.ok) {
            resultValue = { ...harness.value, baseQuestionnaireHash }
            break
          }
          lastErrors = harness.errors
          if (attempts === 3) {
            errorCode = 'AI_HARNESS_VALIDATION_FAILED'
            break
          }
          messages.push({
            role: 'system',
            content: `The candidate was rejected by the local harness. Return a corrected full JSON envelope. Validation errors:\n${JSON.stringify(harness.errors)}`
          })
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
        repository.recoverInterruptedRuns()
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
}
