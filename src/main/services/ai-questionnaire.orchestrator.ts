import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type {
  AIArtifact,
  AIJsonValue,
  AiVersionStamp,
  AIPublicFailureDetails,
  AIPublicMessage,
  AIProgressEvent,
  AIProgressStage,
  AIQuickReplyOption,
  AIResearchCitation,
  AIResearchMode,
  AIResearchStatus,
  AISessionData
} from '@shared/ai-assistant-contract'
import { validateQuestionnaireFormat } from '@shared/questionnaire-format'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import { isUUIDv4, type ProjectData } from '@shared/types/project'

import type { AIMainConfig } from './ai-config.service'
import {
  artifactValueAsJson,
  buildAIContentCacheKey,
  buildQuestionnaireContext,
  diffQuestionnaires,
  getAiVersionStamp,
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
import {
  createAIResearchPipeline,
  noEvidenceDisclaimer,
  researchContextMessage,
  type AIResearchPipeline,
  type ResearchPipelineResult
} from './research/pipeline'
import { createAILiteratureService } from './research/literature.service'
import { createAIEvidenceService } from './research/evidence.service'
import { createAIResearchPlanner } from './research/planner.service'
import { createAIWebSearchService } from './research/web-search.service'
import { createEuropePmcClient } from './research/europepmc.client'
import { createPreprintClient } from './research/preprint.client'
import { createPubMedClient } from './research/pubmed.client'
import { createOpenAIResponsesClient } from './openai-responses.client'
import { toAIPublicAttemptFailure } from './ai-public-validation'
import { refreshQuestionnaireRevision } from './project.service'
import { DerivedService } from './derived/derived.service'
import {
  AIClientError,
  createOpenAICompatibleClient,
  questionnaireJsonOnlyInstruction,
  type AIChatCompletionRequest,
  type AIChatCompletionResult
} from './openai-compatible.client'

export type AIPersistReason =
  | 'run-started'
  | 'run-progress'
  | 'capability-updated'
  | 'repair-requested'
  | 'run-completed'
  | 'run-failed'
  | 'session-migrated'
export type AIPersistProjectHook = (project: ProjectData, reason: AIPersistReason) => void | Promise<void>

export interface AIQuestionnaireOrchestratorDependencies {
  persistProject: AIPersistProjectHook
  client?: { complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> }
  researchPipeline?: AIResearchPipeline
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
  requestId?: string
  operationId?: string
  runId?: string
  clarificationSelection?: { clarificationId: string; optionId: string }
  onProgress?: (event: AIProgressEvent) => void
}

export type AISendTurnResult =
  | {
      ok: true
      requestId: string
      outcome: 'questionnaire'
      artifact: AIArtifact
      attempts: number
      researchStatus?: AIResearchStatus
      researchMode?: AIResearchMode
      citations?: AIResearchCitation[]
    }
  | {
      ok: true
      requestId: string
      outcome: 'clarification'
      message: AIPublicMessage
      attempts: number
      researchStatus?: AIResearchStatus
      researchMode?: AIResearchMode
      citations?: AIResearchCitation[]
    }
  | { ok: false; errorCode: string; details?: AIPublicFailureDetails }

type AIProgressPayload = AIProgressEvent extends infer Event
  ? Event extends AIProgressEvent
    ? Omit<Event, 'requestId' | 'sessionId' | 'runId' | 'at'>
    : never
  : never

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
/**
 * Character budget for the assembled model context. DeepSeek's current catalogue serves a
 * 1,000,000-token context, so this is sized for large questionnaires, long attachments, and the
 * runtime research context together rather than for a single short turn.
 */
const MAX_CONTEXT_CHARACTERS = 400_000
const MAX_REPAIR_INSTRUCTION_BYTES = 8_000
const PROJECT_AI_QUEUES = new WeakMap<ProjectData, Promise<void>>()

function honestAssistantMessage(value: string, result: ResearchPipelineResult | undefined): string {
  if (result !== undefined && result.status !== 'none') return value
  return noEvidenceDisclaimer(result?.notes ?? [])
}

export function runWithProjectAIQueue<T>(project: ProjectData, task: () => Promise<T> | T): Promise<T> {
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
  const value = validateQuestionnaireArtifact(artifact, session.manifest.versionStamp)
  if (checkStale && value.baseQuestionnaireRevision !== project.questionnaireRevision) {
    throw new Error('AI_ARTIFACT_STALE')
  }
  return checkStale
    ? validateQuestionnaireArtifact(
        artifact,
        session.manifest.versionStamp,
        (project.questionnaire.derivedVariables ?? []).map((item) => item.variableName)
      )
    : value
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
  await runWithProjectAIQueue(project, async () => {
    const snapshot = project.aiAssistant === undefined ? undefined : structuredClone(project.aiAssistant)
    try {
      mutate()
    } catch (error) {
      restoreAssistant(project, snapshot)
      throw error
    }
    try {
      await persistProject(project, reason)
    } catch (error) {
      restoreAssistant(project, snapshot)
      if (error instanceof Error && error.message === 'PROJECT_CHANGED') throw error
      throw new Error('AI_PERSIST_FAILED', { cause: error })
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

function repairInstruction(
  errors: readonly AIValidationError[],
  branchLock?: 'questionnaire' | 'clarification'
): string {
  const lock = branchLock === undefined
    ? ''
    : ` The response kind is locked to the ${branchLock} branch and must not change.`
  const selected: Array<{ code: string; path: string; message: string }> = []
  const encoder = new TextEncoder()
  const formatInstruction = (): string => {
    const errorCodes = new Set(selected.map(({ code }) => code))
    const guidance = [
      errorCodes.has('INVALID_QUESTION_TYPE')
        ? 'Allowed question.type values: single_choice, multiple_choice, fixed_length, free_text, numeric_range, date.'
        : '',
      errorCodes.has('INVALID_TYPE')
        ? 'Use JSON strings for id/content/variableName and option value/label; string or null for defaultValue/skipValue; JSON booleans for isKey/allowSkip; an integer for order; integer or null for fixedLength; number or null for minValue/maxValue/step.'
        : '',
      errorCodes.has('FORBIDDEN_FIELD')
        ? 'Remove every field that the questionnaire envelope schema does not declare.'
        : ''
    ].filter(Boolean).join(' ')
    return `The candidate was rejected by the local harness.${lock} Return a corrected full JSON envelope.${guidance.length > 0 ? ` ${guidance}` : ''} Validation errors:\n${JSON.stringify(selected)}`
  }
  for (const error of errors) {
    selected.push({ code: error.code, path: error.path, message: error.message.slice(0, 200) })
    if (encoder.encode(formatInstruction()).byteLength <= MAX_REPAIR_INSTRUCTION_BYTES) continue
    selected.pop()
    break
  }
  return formatInstruction()
}

function publicClarification(
  clarificationId: string,
  options: AIQuickReplyOption[],
  status: 'unresolved' | 'resolved' = 'unresolved',
  selectedOptionId: string | null = null,
  resolvedByMessageId: string | null = null
): NonNullable<AIPublicMessage['clarification']> {
  return { clarificationId, options, status, selectedOptionId, resolvedByMessageId }
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
  if (sameVersionStamp(session.manifest.versionStamp, request.targetVersionStamp)) {
    return { migrated: false }
  }
  migrateAISessionVersion(session.manifest.versionStamp, request.targetVersionStamp)
  await mutateAndPersist(request.project, request.persistProject, 'session-migrated', () => {
    repository.migrateSessionVersion(request.sessionId, request.targetVersionStamp)
  })
  return { migrated: true }
}

export function createAIQuestionnaireOrchestrator(
  dependencies: AIQuestionnaireOrchestratorDependencies
): { sendTurn(request: AISendTurnRequest): Promise<AISendTurnResult> } {
  const client = dependencies.client ?? createOpenAICompatibleClient()
  const researchPipeline = dependencies.researchPipeline ?? createAIResearchPipeline({
    planner: createAIResearchPlanner({ client }),
    literature: createAILiteratureService({
      pubmed: createPubMedClient(),
      europePmc: createEuropePmcClient(),
      preprint: createPreprintClient()
    }),
    webSearch: createAIWebSearchService({ client: createOpenAIResponsesClient() }),
    evidence: createAIEvidenceService({ client })
  })
  const createId = dependencies.createId ?? randomUUID
  const now = dependencies.now ?? (() => new Date().toISOString())

  return {
    async sendTurn(request: AISendTurnRequest): Promise<AISendTurnResult> {
      const repository = new AISessionRepository(request.project, createId, now)
      const session = repository.get(request.sessionId)
      if (session === undefined) return { ok: false, errorCode: 'AI_SESSION_NOT_FOUND' }
      const requestId = request.requestId ?? createId()
      const operationId = request.operationId ?? requestId
      if (!OPERATION_ID_PATTERN.test(requestId)) return { ok: false, errorCode: 'INVALID_AI_REQUEST_ID' }
      if (!OPERATION_ID_PATTERN.test(operationId)) return { ok: false, errorCode: 'INVALID_AI_OPERATION_ID' }

      try {
        const replay = repository.findRunByOperationId(request.sessionId, operationId)
        if (replay !== undefined) {
          if (replay.status === 'running') return { ok: false, errorCode: 'AI_REQUEST_IN_PROGRESS' }
          if (replay.status === 'failed' || replay.status === 'cancelled') {
            const replayDetails = replay.failure?.details
            return {
              ok: false,
              errorCode: replay.errorCode ?? (replay.status === 'cancelled' ? 'AI_CANCELLED' : 'AI_INTERNAL_ERROR'),
              ...(replayDetails === undefined || replayDetails.attempts.length === 0
                ? {}
                : { details: replayDetails })
            }
          }
          if (replay.result?.kind === 'questionnaire') {
            const artifact = session.artifacts.byId[replay.result.artifactId]
            parseArtifactValue(request.project, session, artifact, false)
            return {
              ok: true,
              requestId: replay.requestId!,
              outcome: 'questionnaire',
              artifact: artifact!,
              attempts: replay.progress?.attempt ?? 1,
              researchStatus: replay.result.researchStatus,
              researchMode: replay.result.researchMode,
              citations: replay.result.citations
            }
          }
          if (replay.result?.kind === 'clarification') {
            const replayResult = replay.result
            const message = session.conversation.messages.find(({ id }) => id === replayResult.messageId)
            const clarification = session.conversation.clarifications?.[replayResult.clarificationId]
            if (message?.role !== 'assistant' || clarification === undefined) {
              throw new Error('AI_CLARIFICATION_NOT_FOUND')
            }
            return {
              ok: true,
              requestId: replay.requestId!,
              outcome: 'clarification',
              message: {
                id: message.id,
                role: 'assistant',
                content: message.content,
                createdAt: message.createdAt,
                clarification: publicClarification(
                  clarification.clarificationId,
                  clarification.options,
                  clarification.status,
                  clarification.selectedOptionId ?? null,
                  clarification.resolvedByMessageId ?? null
                )
              },
              attempts: replay.progress?.attempt ?? 1,
              researchStatus: replay.result.researchStatus,
              researchMode: replay.result.researchMode,
              citations: replay.result.citations
            }
          }
          throw new Error('INVALID_AI_RUN_RESULT')
        }
      } catch (error) {
        return { ok: false, errorCode: safeErrorCode(error) }
      }

      let userText: string
      try {
        userText = request.clarificationSelection === undefined
          ? validateUserText(request.userText)
          : request.userText === ''
            ? ''
            : (() => { throw new Error('INVALID_AI_USER_TEXT') })()
      } catch (error) {
        return { ok: false, errorCode: safeErrorCode(error) }
      }
      if (signalAborted(request.signal)) return { ok: false, errorCode: 'AI_CANCELLED' }

      const versionStamp = session.manifest.versionStamp
      let registryEntry: Extract<ReturnType<typeof resolveAIRegistryEntry>, { compatibility: 'supported' }>
      let baseQuestionnaire: QuestionnaireDef
      let baseQuestionnaireRevision: string
      let baseQuestionnaireHash: string
      let explicitAttachment: QuestionnaireDef | undefined
      let activeDraft: QuestionnaireDef | undefined
      let activeArtifactId: string | undefined
      let streamingCapabilityKey: string
      let responseFormatCapabilityKey: string
      let webSearchCapabilityKey: string
      // Derived variable names are protected in both the attached questionnaire and the project's
      // current questionnaire. The harness and the post-generation format gate must protect the same
      // set: if they differ, a name collision passes every repair attempt and then fails after the
      // model has already succeeded, which the user cannot act on.
      const protectedDerivedNames = [...new Set([
        ...(request.explicitAttachment?.derivedVariables ?? []),
        ...(request.project.questionnaire.derivedVariables ?? [])
      ].map((item) => item.variableName))]
      try {
        const resolvedEntry = resolveAIRegistryEntry(versionStamp)
        if (resolvedEntry.compatibility !== 'supported') throw new Error('AI_VERSION_MIGRATION_REQUIRED')
        registryEntry = resolvedEntry
        if (!isUUIDv4(request.project.questionnaireRevision)) {
          throw new Error('AI_ARTIFACT_STALE')
        }
        baseQuestionnaireRevision = request.project.questionnaireRevision
        baseQuestionnaire = request.explicitAttachment === undefined
          ? { name: '未命名问卷', questions: [], conditionRules: [], keyQuestionIds: [] }
          : validateStrictQuestionnaireDto(stripDerivedVariables(request.explicitAttachment))
        baseQuestionnaireHash = hashAIQuestionnaire(baseQuestionnaire)
        if (request.explicitAttachment !== undefined) {
          explicitAttachment = baseQuestionnaire
          if (hashAIQuestionnaire(request.project.questionnaire) !== baseQuestionnaireHash) {
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
          if (activeValue.baseQuestionnaireRevision !== baseQuestionnaireRevision) {
            throw new Error('AI_ARTIFACT_STALE')
          }
          if (explicitAttachment === undefined) {
            baseQuestionnaire = activeValue.draft
            baseQuestionnaireHash = activeDraftHash
            baseQuestionnaireRevision = activeValue.baseQuestionnaireRevision
          } else if (baseQuestionnaireHash !== activeValue.baseQuestionnaireHash &&
            baseQuestionnaireHash !== activeDraftHash) {
            throw new Error('AI_ARTIFACT_STALE')
          }
          activeDraft = activeValue.draft
        }
        const capabilityKey = buildAIContentCacheKey({
          projectId: request.project.meta.projectId ?? '',
          sessionId: request.sessionId,
          promptHash: versionStamp.promptHash,
          schemaVersion: versionStamp.schemaVersion,
          baseUrl: request.config.baseUrl,
          model: request.config.model
        })
        streamingCapabilityKey = `cap-streaming-${capabilityKey}`
        responseFormatCapabilityKey = `cap-response-format-${capabilityKey}`
        webSearchCapabilityKey = `cap-web-search-${capabilityKey}`
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
      const emit = (event: AIProgressPayload): void => {
        try {
          request.onProgress?.(structuredClone({
            ...event,
            requestId,
            sessionId: request.sessionId,
            runId,
            at: now()
          }) as AIProgressEvent)
        } catch {
          // A progress observer is best-effort and cannot change the authoritative run result.
        }
      }
      const basisUnchanged = (lockedSession: AISessionData): boolean => {
        const lockedActiveArtifactId = typeof lockedSession.state.values.activeArtifactId === 'string'
          ? lockedSession.state.values.activeArtifactId
          : undefined
        if (lockedActiveArtifactId !== activeArtifactId) return false
        if (request.project.questionnaireRevision !== baseQuestionnaireRevision) return false
        if (explicitAttachment !== undefined) {
          return hashAIQuestionnaire(request.project.questionnaire) === baseQuestionnaireHash
        }
        if (lockedActiveArtifactId === undefined) return true
        const lockedArtifact = validateQuestionnaireArtifact(
          lockedSession.artifacts.byId[lockedActiveArtifactId],
          versionStamp,
          []
        )
        return lockedArtifact.baseQuestionnaireRevision === baseQuestionnaireRevision &&
          hashAIQuestionnaire(lockedArtifact.draft) === baseQuestionnaireHash
      }
      try {
        await mutateAndPersist(request.project, dependencies.persistProject, 'run-started', () => {
          const lockedSession = repository.get(request.sessionId)
          if (lockedSession === undefined) throw new Error('AI_SESSION_NOT_FOUND')
          if (repository.findRunByOperationId(request.sessionId, operationId) !== undefined) {
            throw new Error('AI_REQUEST_IN_PROGRESS')
          }
          if (lockedSession.state.activeRunId !== undefined || lockedSession.state.status === 'running') {
            throw new Error('AI_RUN_ALREADY_ACTIVE')
          }
          if (lockedSession.state.runs[runId] !== undefined) throw new Error('AI_RUN_ID_CONFLICT')
          if (!basisUnchanged(lockedSession)) {
            throw new Error('AI_ARTIFACT_STALE')
          }
          if (request.clarificationSelection !== undefined) {
            const latest = repository.getLatestUnresolvedClarification(request.sessionId)
            if (latest === undefined || latest.clarificationId !== request.clarificationSelection.clarificationId) {
              throw new Error('AI_CLARIFICATION_NOT_LATEST')
            }
            const selected = latest.options.find(({ id }) => id === request.clarificationSelection!.optionId)
            if (selected === undefined) throw new Error('AI_CLARIFICATION_OPTION_NOT_FOUND')
            userText = `我选择：${selected.label}`
          }
          repository.appendMessage(request.sessionId, {
            id: messageId,
            role: 'user',
            content: userText,
            createdAt: startedAt,
            runId
          })
          const latest = repository.getLatestUnresolvedClarification(request.sessionId)
          if (request.clarificationSelection !== undefined) {
            repository.resolveLatestClarification(request.sessionId, {
              clarificationId: request.clarificationSelection.clarificationId,
              resolvedByMessageId: messageId,
              selectedOptionId: request.clarificationSelection.optionId
            })
          } else if (latest !== undefined) {
            repository.resolveLatestClarification(request.sessionId, {
              clarificationId: latest.clarificationId,
              resolvedByMessageId: messageId
            })
          }
          repository.upsertRun(request.sessionId, {
            runId,
            status: 'running',
            startedAt,
            versionStamp,
            requestId,
            operationId,
            userMessageId: messageId,
            progress: {
              stage: 'starting',
              attempt: 1,
              updatedAt: startedAt,
              streamFallback: responseCapability(
                lockedSession.cache.values[streamingCapabilityKey]
              ) === false,
              // Function calling was removed from the questionnaire protocol, so this can never be
              // in a fallback state; the field stays for stored-session compatibility.
              toolCallingFallback: false
            }
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

      emit({ type: 'started' })

      const runningSession = repository.get(request.sessionId)!
      let errorCode: string | undefined
      const base = activeDraft ?? baseQuestionnaire
      const streamingCapability = responseCapability(runningSession.cache.values[streamingCapabilityKey])
      const responseFormatCapability = responseCapability(runningSession.cache.values[responseFormatCapabilityKey])
      const publicFailures: Array<ReturnType<typeof toAIPublicAttemptFailure>> = []
      let repair: string | undefined
      let branchLock: 'questionnaire' | 'clarification' | undefined
      let attempts = 0
      let resultValue: QuestionnaireArtifactValue | undefined
      let clarificationValue: {
        assistantMessage: string
        rollingSummary: string
        options: AIQuickReplyOption[]
      } | undefined
      let streamFallback = streamingCapability === false
      const persistProgress = async (stage: AIProgressStage, attempt: 1 | 2 | 3): Promise<void> => {
        await mutateAndPersist(request.project, dependencies.persistProject, 'run-progress', () => {
          repository.updateRunProgress(request.sessionId, runId, {
            stage,
            attempt,
            updatedAt: now(),
            streamFallback,
            toolCallingFallback: false
          })
        })
      }
      const persistCapabilities = async (
        streaming: boolean | undefined,
        responseFormat: boolean | undefined,
        webSearch: boolean | undefined
      ): Promise<void> => {
        if (streaming === undefined && responseFormat === undefined && webSearch === undefined) return
        await mutateAndPersist(request.project, dependencies.persistProject, 'capability-updated', () => {
          if (streaming !== undefined) {
            repository.writeVirtual(
              `session://${request.sessionId}/cache/values/${streamingCapabilityKey}`,
              { supported: streaming },
              request.sessionId
            )
          }
          if (responseFormat !== undefined) {
            repository.writeVirtual(
              `session://${request.sessionId}/cache/values/${responseFormatCapabilityKey}`,
              { supported: responseFormat },
              request.sessionId
            )
          }
          if (webSearch !== undefined) {
            repository.writeVirtual(
              `session://${request.sessionId}/cache/values/${webSearchCapabilityKey}`,
              { supported: webSearch },
              request.sessionId
            )
          }
        })
      }
      const persistCapabilityFallback = async (
        capability: 'streaming' | 'response_format',
        attempt: 1 | 2 | 3
      ): Promise<void> => {
        await mutateAndPersist(request.project, dependencies.persistProject, 'capability-updated', () => {
          const key = capability === 'streaming' ? streamingCapabilityKey : responseFormatCapabilityKey
          repository.writeVirtual(
            `session://${request.sessionId}/cache/values/${key}`,
            { supported: false },
            request.sessionId
          )
          if (capability === 'streaming') {
            const run = repository.findRunByOperationId(request.sessionId, operationId)
            if (run?.status !== 'running' || run.progress === undefined || run.progress.attempt !== attempt) {
              throw new Error('AI_RUN_NOT_ACTIVE')
            }
            repository.updateRunProgress(request.sessionId, runId, {
              ...run.progress,
              updatedAt: now(),
              streamFallback: true,
              toolCallingFallback: run.progress.toolCallingFallback
            })
          }
        })
      }

      // The research pipeline is the first stage group. Its stage callbacks both persist the run
      // stage and emit a live progress event, so a long PubMed or web-search step is visible instead
      // of looking like a stalled "connecting" state.
      let researchResult: ResearchPipelineResult | undefined
      let stagePersistence: Promise<void> = Promise.resolve()
      const announceStage = (stage: AIProgressStage): void => {
        emit({ type: 'stage_changed', attempt: 1, stage })
        stagePersistence = stagePersistence
          .then(() => persistProgress(stage, 1), () => undefined)
          .catch(() => undefined)
      }
      try {
        if (request.clarificationSelection === undefined) {
          researchResult = await researchPipeline.research({
            userText,
            recentContext: runningSession.conversation.messages
              .filter((message) => message.role !== 'system')
              .slice(-6)
              .map((message) => ({
                role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
                content: message.content
              })),
            config: request.config,
            ...(responseCapability(runningSession.cache.values[webSearchCapabilityKey]) === undefined
              ? {}
              : { cachedWebSearchSupported: responseCapability(runningSession.cache.values[webSearchCapabilityKey]) }),
            ...(request.signal === undefined ? {} : { signal: request.signal }),
            onStage: (stage) => announceStage(stage)
          })
          await stagePersistence
          if (researchResult.webSearchSupported !== undefined) {
            await persistCapabilities(undefined, undefined, researchResult.webSearchSupported)
          }
        }
      } catch (error) {
        errorCode = safeErrorCode(error)
      }
      const researchMessage = researchResult === undefined
        ? { role: 'user' as const, content: '' }
        : researchContextMessage(researchResult)
      for (attempts = 1; attempts <= 3 && errorCode === undefined; attempts += 1) {
        const attempt = attempts as 1 | 2 | 3
        try {
          await persistProgress('connecting', attempt)
          emit({ type: 'attempt_started', attempt })
          const messages = buildQuestionnaireContext(
            runningSession,
            activeDraft,
            explicitAttachment,
            MAX_CONTEXT_CHARACTERS - researchMessage.content.length - (repair?.length ?? 0) -
              questionnaireJsonOnlyInstruction(registryEntry.schemaVersion).length,
            registryEntry
          )
          messages.push(researchMessage)
          if (repair !== undefined) messages.push({ role: 'system', content: repair })
          let callbackPersistence = Promise.resolve()
          let modelStreaming = false
          let sequence = 0
          let completion: AIChatCompletionResult
          try {
            completion = await client.complete({
              baseUrl: request.config.baseUrl,
              model: request.config.model,
              ...(request.config.apiKey === undefined ? {} : { apiKey: request.config.apiKey }),
              messages,
              outputMode: 'json_object',
              ...(request.signal === undefined ? {} : { signal: request.signal }),
              streamingSupported: streamingCapability,
              responseFormatSupported: responseFormatCapability,
              onModelStreaming: () => {
                if (modelStreaming) return
                modelStreaming = true
                callbackPersistence = callbackPersistence.then(() => persistProgress('streaming', attempt))
                emit({ type: 'model_streaming', attempt })
              },
              onContentDelta: ({ content }) => {
                if (content.length === 0) return
                for (let offset = 0; offset < content.length;) {
                  let end = Math.min(offset + 4_096, content.length)
                  if (end < content.length &&
                    content.charCodeAt(end - 1) >= 0xd800 && content.charCodeAt(end - 1) <= 0xdbff &&
                    content.charCodeAt(end) >= 0xdc00 && content.charCodeAt(end) <= 0xdfff) {
                    end -= 1
                  }
                  emit({
                    type: 'assistant_delta',
                    attempt,
                    sequence: ++sequence,
                    delta: content.slice(offset, end)
                  })
                  offset = end
                }
              },
              onCapabilityFallback: (capability) => {
                if (capability === 'streaming') streamFallback = true
                callbackPersistence = callbackPersistence.then(
                  () => persistCapabilityFallback(capability, attempt)
                )
                emit({ type: 'capability_fallback', attempt, capability, reason: 'unsupported' })
              },
              schemaVersion: registryEntry.schemaVersion
            })
          } catch (error) {
            await callbackPersistence
            throw error
          }
          await callbackPersistence
          if (signalAborted(request.signal)) throw new AIClientError('AI_CANCELLED')
          const negotiatedStreaming = completion.streamingSupported
          const negotiatedResponseFormat = completion.responseFormatSupported
          streamFallback ||= !negotiatedStreaming
          await persistCapabilities(negotiatedStreaming, negotiatedResponseFormat, undefined)
          await persistProgress('validating', attempt)
          emit({ type: 'validating', attempt })
          const harness = registryEntry.runHarness(
            completion.content,
            base,
            protectedDerivedNames,
            branchLock
          )
          if (harness.ok) {
            if (harness.kind === 'questionnaire') {
              resultValue = {
                ...harness.value,
                assistantMessage: honestAssistantMessage(harness.value.assistantMessage, researchResult),
                diff: diffQuestionnaires(baseQuestionnaire, harness.value.draft),
                baseQuestionnaireRevision,
                baseQuestionnaireHash,
                baseQuestionnaire
              }
            } else {
              clarificationValue = {
                ...harness.value,
                assistantMessage: honestAssistantMessage(harness.value.assistantMessage, researchResult)
              }
            }
            break
          }
          branchLock ??= harness.establishedKind
          const publicFailure = toAIPublicAttemptFailure(attempt, harness.errors)
          publicFailures.push(publicFailure)
          emit({ type: 'validation_failed', attempt, failure: publicFailure })
          if (attempts === 3) {
            errorCode = 'AI_HARNESS_VALIDATION_FAILED'
            break
          }
          repair = repairInstruction(harness.errors, branchLock)
          await mutateAndPersist(request.project, dependencies.persistProject, 'repair-requested', () => {
            repository.setRunTemp(request.sessionId, {
              runId,
              versionStamp,
              createdAt: startedAt,
              values: { operationId, attempt: attempts + 1, validationErrors: harness.errors as unknown as AIJsonValue }
            })
            repository.updateRunProgress(request.sessionId, runId, {
              stage: 'repairing',
              attempt,
              updatedAt: now(),
              streamFallback,
              toolCallingFallback: false
            })
          })
          emit({ type: 'repairing', attempt: attempt as 1 | 2, nextAttempt: (attempt + 1) as 2 | 3 })
        } catch (error) {
          // A truncated structured response usually means the requested questionnaire is larger than
          // one completion can carry. Re-ask for a more compact questionnaire before giving up.
          if (
            error instanceof AIClientError && error.code === 'AI_RESPONSE_TRUNCATED' && attempts < 3
          ) {
            publicFailures.push(
              toAIPublicAttemptFailure(attempt, [{
                code: 'INVALID_ENVELOPE_SIZE',
                path: '$.questionnaire',
                message: 'Model output was truncated'
              }])
            )
            emit({
              type: 'validation_failed',
              attempt,
              failure: publicFailures[publicFailures.length - 1]!
            })
            repair = 'The previous response was truncated before the JSON object was complete. ' +
              'Return one complete JSON envelope that is as compact as possible: keep every required ' +
              'field, shorten question content and option labels, and reduce the number of questions ' +
              'to the most essential set if needed.'
            emit({ type: 'repairing', attempt: attempt as 1 | 2, nextAttempt: (attempt + 1) as 2 | 3 })
            continue
          }
          errorCode = safeErrorCode(error)
          break
        }
      }

      if ((resultValue !== undefined || clarificationValue !== undefined) && signalAborted(request.signal)) {
        resultValue = undefined
        clarificationValue = undefined
        errorCode = 'AI_CANCELLED'
      }
      if (resultValue !== undefined || clarificationValue !== undefined) {
        try {
          let artifact: AIArtifact | undefined
          let message: AIPublicMessage | undefined
          const completedAt = now()
          await mutateAndPersist(request.project, dependencies.persistProject, 'run-completed', () => {
            const lockedSession = repository.get(request.sessionId)
            if (lockedSession === undefined || !basisUnchanged(lockedSession)) {
              throw new Error('AI_ARTIFACT_STALE')
            }
            const assistantMessageId = createId()
            const assistantContent = resultValue?.assistantMessage ?? clarificationValue!.assistantMessage
            repository.appendMessage(request.sessionId, {
              id: assistantMessageId,
              role: 'assistant',
              content: assistantContent,
              createdAt: completedAt,
              runId
            })
            const currentValues = repository.get(request.sessionId)!.state.values
            if (resultValue !== undefined) {
              // Second gate: the harness already accepted this draft, and the shared validator that the
              // renderer also runs must agree. A disagreement is a programming error, so it fails the
              // run rather than persisting a draft the UI would refuse to show.
              const format = validateQuestionnaireFormat(resultValue.draft, {
                protectedVariableNames: (request.project.questionnaire.derivedVariables ?? [])
                  .map((item) => item.variableName)
              })
              if (!format.ok) throw new Error('AI_HARNESS_VALIDATION_FAILED')
              artifact = repository.upsertArtifact(request.sessionId, {
                artifactId,
                operationId,
                kind: 'questionnaire-draft',
                status: 'completed',
                versionStamp,
                value: artifactValueAsJson(resultValue)
              }).value
              repository.updateState(request.sessionId, {
                values: {
                  ...currentValues,
                  activeArtifactId: artifactId,
                  rollingSummary: resultValue.rollingSummary
                }
              })
              repository.completeRunWithResult(request.sessionId, runId, {
                kind: 'questionnaire',
                artifactId,
                ...(researchResult === undefined
                  ? {}
                  : {
                      researchStatus: researchResult.status,
                      researchMode: researchResult.mode,
                      citations: researchResult.citations
                    })
              })
            } else {
              const clarificationId = createId()
              repository.addClarification(request.sessionId, {
                clarificationId,
                messageId: assistantMessageId,
                runId,
                options: clarificationValue!.options,
                status: 'unresolved',
                createdAt: completedAt
              })
              repository.updateState(request.sessionId, {
                values: { ...currentValues, rollingSummary: clarificationValue!.rollingSummary }
              })
              repository.completeRunWithResult(request.sessionId, runId, {
                kind: 'clarification',
                messageId: assistantMessageId,
                clarificationId,
                ...(researchResult === undefined
                  ? {}
                  : {
                      researchStatus: researchResult.status,
                      researchMode: researchResult.mode,
                      citations: researchResult.citations
                    })
              })
              message = {
                id: assistantMessageId,
                role: 'assistant',
                content: assistantContent,
                createdAt: completedAt,
                clarification: publicClarification(clarificationId, clarificationValue!.options)
              }
            }
          })
          if (artifact !== undefined) {
            emit({ type: 'completed', attempt: attempts as 1 | 2 | 3, outcome: 'questionnaire', artifactId })
            return {
              ok: true, requestId, outcome: 'questionnaire', artifact, attempts,
              ...(researchResult === undefined
                ? {}
                : {
                    researchStatus: researchResult.status,
                    researchMode: researchResult.mode,
                    citations: researchResult.citations
                  })
            }
          }
          emit({
            type: 'clarification',
            attempt: attempts as 1 | 2 | 3,
            outcome: 'clarification',
            messageId: message!.id,
            clarification: message!.clarification!
          })
          return {
            ok: true, requestId, outcome: 'clarification', message: message!, attempts,
            ...(researchResult === undefined
              ? {}
              : {
                  researchStatus: researchResult.status,
                  researchMode: researchResult.mode,
                  citations: researchResult.citations
                })
          }
        } catch (error) {
          errorCode = safeErrorCode(error)
        }
      }

      const finalCode = errorCode ?? 'AI_INTERNAL_ERROR'
      const details: AIPublicFailureDetails = { attempts: publicFailures }
      try {
        await mutateAndPersist(request.project, dependencies.persistProject, 'run-failed', () => {
          if (finalCode === 'AI_CANCELLED') {
            repository.cancelRun(request.sessionId, runId)
          } else {
            repository.failRun(request.sessionId, runId, { errorCode: finalCode, details })
          }
        })
      } catch (error) {
        await runWithProjectAIQueue(request.project, () => repository.recoverInterruptedRuns())
        if (error instanceof Error && error.message === 'PROJECT_CHANGED') {
          return { ok: false, errorCode: 'PROJECT_CHANGED' }
        }
        return { ok: false, errorCode: 'AI_PERSIST_FAILED', ...(details.attempts.length === 0 ? {} : { details }) }
      }
      if (finalCode === 'AI_CANCELLED') {
        emit({ type: 'cancelled', attempt: Math.min(Math.max(attempts, 1), 3) as 1 | 2 | 3, errorCode: 'AI_CANCELLED' })
        return { ok: false, errorCode: 'AI_CANCELLED' }
      }
      emit({
        type: 'failed',
        attempt: Math.min(Math.max(attempts, 1), 3) as 1 | 2 | 3,
        errorCode: finalCode,
        ...(details.attempts.length === 0 ? {} : { details })
      })
      return { ok: false, errorCode: finalCode, ...(details.attempts.length === 0 ? {} : { details }) }
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
  artifactId: string,
  checkStale = true,
  historical = false
): QuestionnaireArtifactValue | undefined {
  const session = new AISessionRepository(project).get(sessionId)
  if (session === undefined) return undefined
  const artifact = session.artifacts.byId[artifactId]
  if (artifact === undefined) return undefined
  return historical
    ? validateQuestionnaireArtifact(artifact, artifact.versionStamp)
    : parseArtifactValue(project, session, artifact, checkStale)
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
  return runWithProjectAIQueue(request.project, async () => {
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
    if (appliedOperations[operationId] !== undefined && appliedOperations[operationId] !== request.artifactId) {
      throw new Error('AI_APPLY_OPERATION_CONFLICT')
    }
    if (appliedOperations[operationId] === request.artifactId ||
      appliedArtifacts[request.artifactId] !== undefined) {
      return { applied: false, questionnaire: structuredClone(request.project.questionnaire) }
    }
    const currentVersionStamp = getAiVersionStamp()
    if (!sameVersionStamp(session.manifest.versionStamp, currentVersionStamp)) {
      throw new Error('AI_VERSION_MIGRATION_REQUIRED')
    }
    const artifact = session.artifacts.byId[request.artifactId]
    if (artifact === undefined || !sameVersionStamp(artifact.versionStamp, currentVersionStamp)) {
      throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
    }
    if (session.state.values.activeArtifactId !== request.artifactId) {
      throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
    }
    const value = previewQuestionnaireArtifact(request.project, request.sessionId, request.artifactId)
    if (value === undefined) throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
    const questionnaireSnapshot = structuredClone(request.project.questionnaire)
    const questionnaireRevisionSnapshot = request.project.questionnaireRevision
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
      refreshQuestionnaireRevision(request.project)
      repository.updateState(request.sessionId, {
        values: {
          ...session.state.values,
          appliedArtifacts: { ...appliedArtifacts, [request.artifactId]: operationId },
          appliedOperations: { ...appliedOperations, [operationId]: request.artifactId }
        }
      })
      await request.saveAtomic(request.project, request.currentProjectPath)
      return { applied: true, questionnaire: structuredClone(nextQuestionnaire) }
    } catch (error) {
      request.project.questionnaire = questionnaireSnapshot
      request.project.questionnaireRevision = questionnaireRevisionSnapshot
      request.project.meta = metaSnapshot
      restoreAssistant(request.project, assistantSnapshot)
      if (error instanceof Error && error.message === 'PROJECT_CHANGED') throw error
      throw new Error('AI_ARTIFACT_APPLY_FAILED', { cause: error })
    }
  })
}
