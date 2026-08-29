import path from 'node:path'
import { createHash } from 'node:crypto'

import type {
  AIArtifact,
  AIArtifactApplyResult,
  AIArtifactPreview,
  AIArtifactPreviewResult,
  AIArtifactSummary,
  AICancelResult,
  AIConfigIpcResult,
  AIConnectionTestResult,
  AIErrorResult,
  AIPrivacyStatusResult,
  AIProgressEvent,
  AIPublicFailureDetails,
  AIQuestionnaireArtifactPreviewDto,
  AISendResult,
  AISessionClearCacheResult,
  AISessionData,
  AISessionDeleteResult,
  AISessionPage,
  AISessionPageResult,
  AISessionListResult,
  AISessionMigrateResult,
  AISessionResult
} from '@shared/ai-assistant-contract'
import {
  AI_ARTIFACT_APPLY_CHANNEL,
  AI_ARTIFACT_PREVIEW_CHANNEL,
  AI_CANCEL_CHANNEL,
  AI_CONFIG_CLEAR_CHANNEL,
  AI_CONFIG_GET_CHANNEL,
  AI_CONFIG_TEST_CONNECTION_CHANNEL,
  AI_CONFIG_UPDATE_CHANNEL,
  AI_PRIVACY_ACCEPT_CHANNEL,
  AI_PRIVACY_NOTICE,
  AI_PRIVACY_STATUS_CHANNEL,
  AI_PROGRESS_CHANNEL,
  AI_SESSION_PAGE_MAX_UTF8_BYTES,
  AI_SEND_CHANNEL,
  AI_SESSION_CLEAR_CACHE_CHANNEL,
  AI_SESSION_CREATE_CHANNEL,
  AI_SESSION_DELETE_CHANNEL,
  AI_SESSION_GET_CHANNEL,
  AI_SESSION_LIST_CHANNEL,
  AI_SESSION_MIGRATE_CHANNEL,
  AI_SESSION_UPDATE_CHANNEL,
  parseAIArtifactApplyRequest,
  parseAIArtifactRequest,
  parseAICancelRequest,
  parseAIConfigUpdateRequest,
  parseAISendRequest,
  parseAIProgressEvent,
  parseAISessionCreateRequest,
  parseAISessionGetRequest,
  parseAISessionIdRequest,
  parseAISessionUpdateRequest
} from '@shared/ai-assistant-contract'
import type { ProjectData } from '@shared/types/project'

import { createBackup } from '../services/backup.service'
import type { AIConfigService } from '../services/ai-config.service'
import { getAiVersionStamp } from '../services/ai-questionnaire.harness'
import {
  applyArtifact,
  createAIQuestionnaireOrchestrator,
  migrateSessionVersion,
  previewQuestionnaireArtifact,
  runWithProjectAIQueue
} from '../services/ai-questionnaire.orchestrator'
import { AISessionRepository } from '../services/ai-session.repository'
import {
  createOpenAICompatibleClient,
  type AIChatCompletionRequest,
  type AIChatCompletionResult
} from '../services/openai-compatible.client'
import { saveProjectToPath } from '../services/project.service'
import { resolveProjectDataFilePath } from '../services/record.service'

import type { ProjectIpcState } from './project.ipc'
import {
  assertTrustedSender,
  type IpcInvokeEventLike,
  type IpcMainLike,
  type IpcWebContentsLike
} from './types'

interface CapturedProject {
  project: ProjectData
  projectId: string
  filePath: string
  key: Buffer
  saltHex: string
  hashHex: string
}

interface InFlightRequest {
  controller: AbortController
  project: ProjectData
  filePath: string
  sender: IpcWebContentsLike
  settled: Promise<void>
  settle(): void
}

export interface AIIpcDependencies {
  configService: AIConfigService
  client?: { complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> }
  createProjectBackup?: typeof createBackup
  saveProject?: typeof saveProjectToPath
}

export interface AIIpcRegistration {
  cancelAll(): void
  cancelAllAndSettle(): Promise<void>
  dispose(): void
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_AI_REQUEST: 'AI 请求无效。',
  INVALID_AI_CONFIG: 'AI 配置无效。',
  AI_CONFIG_READ_FAILED: '无法读取 AI 配置。',
  AI_CONFIG_SAVE_FAILED: '无法保存 AI 配置。',
  AI_SECURE_STORAGE_UNAVAILABLE: '系统安全存储不可用。',
  AI_PRIVACY_NOTICE_REQUIRED: '请先确认 AI 隐私说明。',
  AI_PROJECT_REQUIRED: '请先打开项目。',
  AI_PROJECT_LOCKED: '请先解锁项目。',
  PROJECT_CHANGED: '项目已切换，请重试。',
  AI_SESSION_NOT_FOUND: 'AI 对话不存在。',
  AI_SESSION_RUNNING: '该对话正在运行，无法清除缓存。',
  AI_RUN_ALREADY_ACTIVE: '该对话已有正在进行的请求。',
  AI_REQUEST_IN_PROGRESS: '该请求正在进行。',
  AI_CANCELLED: 'AI 请求已取消。',
  AI_AUTH_ERROR: 'AI 认证失败。',
  AI_MODEL_NOT_FOUND: '未找到配置的 AI 模型。',
  AI_RATE_LIMITED: 'AI 服务忙，请稍后重试。',
  AI_TIMEOUT: 'AI 请求超时。',
  AI_NETWORK_ERROR: '无法连接 AI 服务。',
  AI_PROVIDER_ERROR: 'AI 服务返回错误。',
  AI_INVALID_RESPONSE: 'AI 服务返回了无效响应。',
  AI_RESPONSE_TOO_LARGE: 'AI 响应过大。',
  AI_HARNESS_VALIDATION_FAILED: 'AI 生成的问卷未通过本地校验。',
  AI_ARTIFACT_STALE: '问卷已变更，该 AI 结果已过期。',
  AI_ARTIFACT_NOT_APPLICABLE: 'AI 结果不可用。',
  AI_ARTIFACT_DERIVED_CONFLICT: 'AI 结果与衍生变量冲突。',
  AI_ARTIFACT_APPLY_FAILED: '无法应用 AI 结果。',
  AI_PERSIST_FAILED: '无法保存 AI 对话。',
  AI_SESSION_PAGE_TOO_LARGE: 'AI 对话分页内容过大。',
  AI_VERSION_MIGRATION_REQUIRED: '该对话需要先迁移。',
  AI_INTERNAL_ERROR: 'AI 操作失败。'
}

function errorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? code : 'AI_INTERNAL_ERROR'
}

function publicError(error: unknown, details?: AIPublicFailureDetails): AIErrorResult & {
  details?: AIPublicFailureDetails
} {
  const code = errorCode(error)
  return {
    ok: false,
    errorCode: code,
    message: ERROR_MESSAGES[code]!,
    ...(details === undefined ? {} : { details: structuredClone(details) })
  }
}

function configError(code: string): AIErrorResult {
  return publicError(code)
}

function captureProject(state: ProjectIpcState): CapturedProject {
  if (state.currentProject === null || state.currentFilePath === null) {
    throw new Error('AI_PROJECT_REQUIRED')
  }
  if (state.auth.encryptionKey === null || state.auth.encryptionKey.length === 0 ||
    typeof state.currentProject.meta.projectId !== 'string' ||
    !path.isAbsolute(state.currentFilePath) || state.currentFilePath.includes('\0') ||
    !/^[0-9a-f]{64}$/i.test(state.currentSaltHex) || !/^[0-9a-f]{64}$/i.test(state.currentHashHex)) {
    throw new Error('AI_PROJECT_LOCKED')
  }
  return {
    project: state.currentProject,
    projectId: state.currentProject.meta.projectId,
    filePath: state.currentFilePath,
    key: state.auth.encryptionKey,
    saltHex: state.currentSaltHex,
    hashHex: state.currentHashHex
  }
}

function isCurrentProject(state: ProjectIpcState, captured: CapturedProject): boolean {
  return state.currentProject === captured.project && state.currentFilePath === captured.filePath &&
    state.auth.encryptionKey === captured.key && state.currentSaltHex === captured.saltHex &&
    state.currentHashHex === captured.hashHex
}

function restoreAssistant(project: ProjectData, snapshot: ProjectData['aiAssistant']): void {
  if (snapshot === undefined) delete project.aiAssistant
  else project.aiAssistant = snapshot
}

function callerOwner(event: IpcInvokeEventLike): string {
  const senderId = event.sender?.id
  if (!Number.isSafeInteger(senderId)) throw new Error('INVALID_AI_REQUEST')
  return `webContents:${senderId}`
}

function inFlightKey(owner: string, projectId: string, requestId: string): string {
  return JSON.stringify([owner, projectId, requestId])
}

function artifactSummary(artifact: AIArtifact): AIArtifactSummary {
  const { artifactId, operationId, kind, status, createdAt, updatedAt } = artifact
  return { artifactId, operationId, kind, status, createdAt, updatedAt }
}

function toPublicSessionPage(session: AISessionData, offset: number, limit: number): AISessionPage {
  const candidates: AISessionData['conversation']['messages'] = []
  let total = 0
  for (const message of session.conversation.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (total >= offset && candidates.length < limit) candidates.push(message)
    total += 1
  }
  const activeArtifactId = typeof session.state.values.activeArtifactId === 'string' &&
    session.artifacts.byId[session.state.values.activeArtifactId] !== undefined
    ? session.state.values.activeArtifactId
    : null
  const isV2 = session.manifest.versionStamp.schemaVersion === 2
  const activeRunRecord = isV2 && session.state.activeRunId !== undefined
    ? session.state.runs[session.state.activeRunId]
    : undefined
  const activeRun = activeRunRecord?.status === 'running' &&
    activeRunRecord.requestId !== undefined && activeRunRecord.progress !== undefined
    ? {
        requestId: activeRunRecord.requestId,
        runId: activeRunRecord.runId,
        stage: activeRunRecord.progress.stage,
        attempt: activeRunRecord.progress.attempt,
        startedAt: activeRunRecord.startedAt,
        updatedAt: activeRunRecord.progress.updatedAt,
        streamFallback: activeRunRecord.progress.streamFallback
      }
    : null
  const page: AISessionPage = {
    manifest: session.manifest,
    messages: [],
    attachments: [],
    status: session.state.status,
    activeArtifactId,
    activeRun,
    failures: [],
    artifacts: activeArtifactId === null
      ? []
      : [artifactSummary(session.artifacts.byId[activeArtifactId]!)],
    total,
    nextOffset: null
  }
  const fitsBudget = (): boolean => Buffer.byteLength(
    JSON.stringify({ ok: true, session: page }),
    'utf8'
  ) <= AI_SESSION_PAGE_MAX_UTF8_BYTES
  if (!fitsBudget()) throw new Error('AI_SESSION_PAGE_TOO_LARGE')

  const candidateIds = new Set(
    candidates.filter(({ role }) => role === 'user').map(({ id }) => id)
  )
  const attachmentsByMessage = new Map<string, AISessionPage['attachments']>()
  let attachmentCount = 0
  for (const attachmentId in session.conversation.attachments) {
    const attachment = session.conversation.attachments[attachmentId]!
    if (attachment.kind !== 'questionnaire' || !candidateIds.has(attachment.messageId)) continue
    const summaries = attachmentsByMessage.get(attachment.messageId) ?? []
    if (attachmentCount >= 100) break
    summaries.push({
      attachmentId: attachment.attachmentId,
      messageId: attachment.messageId,
      kind: 'questionnaire',
      createdAt: attachment.createdAt
    })
    attachmentsByMessage.set(attachment.messageId, summaries)
    attachmentCount += 1
  }
  const clarificationsByMessage = new Map<string, NonNullable<AISessionPage['messages'][number]['clarification']>>()
  if (isV2) {
    for (const clarification of Object.values(session.conversation.clarifications ?? {})) {
      clarificationsByMessage.set(clarification.messageId, {
        clarificationId: clarification.clarificationId,
        options: structuredClone(clarification.options),
        status: clarification.status,
        selectedOptionId: clarification.selectedOptionId ?? null,
        resolvedByMessageId: clarification.resolvedByMessageId ?? null
      })
    }
  }
  const failuresByUserMessage = new Map<string, AISessionPage['failures']>()
  if (isV2) {
    for (const run of Object.values(session.state.runs)) {
      if (run.failure === undefined || run.userMessageId === undefined) continue
      const userMessage = session.conversation.messages.find(
        (message) => message.id === run.userMessageId && message.role === 'user' &&
          message.runId === run.runId
      )
      if (userMessage === undefined) continue
      const failures = failuresByUserMessage.get(run.userMessageId) ?? []
      failures.push({
        runId: run.runId,
        userMessageId: run.userMessageId,
        completedAt: run.failure.completedAt,
        errorCode: run.failure.errorCode,
        details: structuredClone(run.failure.details)
      })
      failuresByUserMessage.set(run.userMessageId, failures)
    }
  }
  for (const message of candidates) {
    if (message.content.length > 100_000 || message.content.includes('\0')) {
      throw new Error('AI_SESSION_PAGE_TOO_LARGE')
    }
    const previousAttachmentCount = page.attachments.length
    const previousFailureCount = page.failures.length
    const clarification = message.role === 'assistant'
      ? clarificationsByMessage.get(message.id) ?? null
      : null
    page.messages.push({
      id: message.id,
      role: message.role as 'user' | 'assistant',
      content: message.content,
      createdAt: message.createdAt,
      clarification
    })
    page.attachments.push(...(attachmentsByMessage.get(message.id) ?? []).slice(
      0,
      100 - page.attachments.length
    ))
    if (message.role === 'user') {
      page.failures.push(...(failuresByUserMessage.get(message.id) ?? []).slice(
        0,
        100 - page.failures.length
      ))
    }
    page.nextOffset = offset + page.messages.length < total
      ? offset + page.messages.length
      : null
    if (fitsBudget()) continue
    page.messages.pop()
    page.attachments.length = previousAttachmentCount
    page.failures.length = previousFailureCount
    page.nextOffset = offset + page.messages.length < total
      ? offset + page.messages.length
      : null
    break
  }
  if (page.messages.length === 0 && offset < total) {
    throw new Error('AI_SESSION_PAGE_TOO_LARGE')
  }

  for (const artifactId in session.artifacts.byId) {
    if (page.artifacts.length >= 100) break
    if (artifactId === activeArtifactId) continue
    const artifact = session.artifacts.byId[artifactId]!
    page.artifacts.push(artifactSummary(artifact))
    if (fitsBudget()) continue
    page.artifacts.pop()
    break
  }
  return page
}

function storedSession(project: ProjectData, sessionId: string): AISessionData | undefined {
  if (project.aiAssistant === undefined) return undefined
  if (project.aiAssistant.schemaVersion !== 1) throw new Error('AI_VERSION_MIGRATION_REQUIRED')
  return project.aiAssistant.sessions[sessionId]
}

function toPublicQuestionnaireArtifact(
  artifact: AIArtifact,
  value: AIArtifactPreview
): AIQuestionnaireArtifactPreviewDto {
  if (artifact.kind !== 'questionnaire-draft' || artifact.status !== 'completed') {
    throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
  }
  return {
    artifactId: artifact.artifactId,
    operationId: artifact.operationId,
    kind: 'questionnaire-draft',
    status: 'completed',
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    value
  }
}

export function registerAIIpcHandlers(
  ipcMain: IpcMainLike,
  state: ProjectIpcState,
  dependencies: AIIpcDependencies,
  packagedRendererUrl: string,
  developmentOrigin?: string
): AIIpcRegistration {
  const client = dependencies.client ?? createOpenAICompatibleClient()
  const backup = dependencies.createProjectBackup ?? createBackup
  const saveProject = dependencies.saveProject ?? saveProjectToPath
  const inFlight = new Map<string, InFlightRequest>()
  let acceptingRequests = true
  let settling: Promise<void> | undefined

  const trusted = (event: IpcInvokeEventLike): void => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
  }

  const persist = (captured: CapturedProject): void => {
    if (!isCurrentProject(state, captured)) throw new Error('PROJECT_CHANGED')
    saveProject(captured.filePath, captured.project, captured.key, captured.saltHex, captured.hashHex)
  }

  const mutateSession = <T>(operation: (repository: AISessionRepository) => { value: T; mutated: boolean }): T => {
    const captured = captureProject(state)
    const snapshot = captured.project.aiAssistant === undefined
      ? undefined
      : structuredClone(captured.project.aiAssistant)
    try {
      const result = operation(new AISessionRepository(captured.project))
      if (result.mutated) persist(captured)
      return result.value
    } catch (error) {
      restoreAssistant(captured.project, snapshot)
      throw error
    }
  }

  ipcMain.handle(AI_CONFIG_GET_CHANNEL, async (event) => {
    trusted(event)
    try {
      const result = await dependencies.configService.get()
      return result.ok ? { ok: true, config: result.config } satisfies AIConfigIpcResult : configError(result.code)
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_CONFIG_UPDATE_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    let request: ReturnType<typeof parseAIConfigUpdateRequest>
    try {
      request = parseAIConfigUpdateRequest(rawRequest)
    } catch {
      return publicError('INVALID_AI_REQUEST')
    }
    try {
      const result = await dependencies.configService.update(request)
      return result.ok ? { ok: true, config: result.config } satisfies AIConfigIpcResult : configError(result.code)
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_CONFIG_CLEAR_CHANNEL, async (event) => {
    trusted(event)
    try {
      const result = await dependencies.configService.clear()
      return result.ok ? { ok: true, config: result.config } satisfies AIConfigIpcResult : configError(result.code)
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_CONFIG_TEST_CONNECTION_CHANNEL, async (event) => {
    trusted(event)
    try {
      const config = await dependencies.configService.getPlaintextForMain()
      await client.complete({
        ...config,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        responseFormatSupported: false,
        schemaVersion: 1
      })
      return { ok: true } satisfies AIConnectionTestResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_PRIVACY_STATUS_CHANNEL, async (event) => {
    trusted(event)
    try {
      const status = await dependencies.configService.getPrivacyStatus()
      return { ok: true, ...status, notice: AI_PRIVACY_NOTICE } satisfies AIPrivacyStatusResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_PRIVACY_ACCEPT_CHANNEL, async (event) => {
    trusted(event)
    try {
      const status = await dependencies.configService.acceptPrivacy()
      return { ok: true, ...status, notice: AI_PRIVACY_NOTICE } satisfies AIPrivacyStatusResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_CREATE_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionCreateRequest(rawRequest)
      const session = mutateSession((repository) => repository.create(getAiVersionStamp(), request.title))
      return { ok: true, session: session.manifest } satisfies AISessionResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_LIST_CHANNEL, async (event) => {
    trusted(event)
    try {
      const sessions = new AISessionRepository(captureProject(state).project).list().slice(0, 1_000)
      return { ok: true, sessions } satisfies AISessionListResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_GET_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionGetRequest(rawRequest)
      const session = storedSession(captureProject(state).project, request.sessionId)
      if (session === undefined) throw new Error('AI_SESSION_NOT_FOUND')
      return {
        ok: true,
        session: toPublicSessionPage(session, request.offset, request.limit)
      } satisfies AISessionPageResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_UPDATE_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionUpdateRequest(rawRequest)
      const session = mutateSession((repository) => repository.update(request.sessionId, { title: request.title }))
      return { ok: true, session: session.manifest } satisfies AISessionResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_DELETE_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionIdRequest(rawRequest)
      const deleted = mutateSession((repository) => repository.delete(request.sessionId))
      return { ok: true, deleted } satisfies AISessionDeleteResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_CLEAR_CACHE_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionIdRequest(rawRequest)
      const captured = captureProject(state)
      const removed = await runWithProjectAIQueue(captured.project, async () => {
        if (!isCurrentProject(state, captured)) throw new Error('PROJECT_CHANGED')
        const repository = new AISessionRepository(captured.project)
        const session = repository.get(request.sessionId)
        if (session === undefined) throw new Error('AI_SESSION_NOT_FOUND')
        if (session.state.status === 'running' || session.state.activeRunId !== undefined) {
          throw new Error('AI_SESSION_RUNNING')
        }
        const snapshot = captured.project.aiAssistant === undefined
          ? undefined
          : structuredClone(captured.project.aiAssistant)
        try {
          const result = repository.clearCache(request.sessionId)
          if (result.mutated) {
            try {
              persist(captured)
            } catch (error) {
              if (error instanceof Error && error.message === 'PROJECT_CHANGED') throw error
              throw new Error('AI_PERSIST_FAILED', { cause: error })
            }
          }
          return result.value
        } catch (error) {
          restoreAssistant(captured.project, snapshot)
          throw error
        }
      })
      return { ok: true, removed } satisfies AISessionClearCacheResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_MIGRATE_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionIdRequest(rawRequest)
      const captured = captureProject(state)
      const result = await migrateSessionVersion({
        project: captured.project,
        sessionId: request.sessionId,
        targetVersionStamp: getAiVersionStamp(),
        persistProject: (project) => {
          if (project !== captured.project) throw new Error('PROJECT_CHANGED')
          persist(captured)
        }
      })
      const session = new AISessionRepository(captured.project).get(request.sessionId)
      if (session === undefined) throw new Error('AI_SESSION_NOT_FOUND')
      return {
        ok: true,
        migrated: result.migrated,
        session: session.manifest
      } satisfies AISessionMigrateResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SEND_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    let request: ReturnType<typeof parseAISendRequest>
    try {
      request = parseAISendRequest(rawRequest)
    } catch (error) {
      return publicError(error)
    }
    let captured: CapturedProject
    let owner: string
    try {
      captured = captureProject(state)
      owner = callerOwner(event)
    } catch (error) {
      return publicError(error)
    }
    if (!acceptingRequests) return publicError('AI_REQUEST_IN_PROGRESS')
    const key = inFlightKey(owner, captured.projectId, request.requestId)
    if (inFlight.has(key)) return publicError('AI_REQUEST_IN_PROGRESS')
    const controller = new AbortController()
    let settle!: () => void
    const entry: InFlightRequest = {
      controller,
      project: captured.project,
      filePath: captured.filePath,
      sender: event.sender!,
      settled: new Promise<void>((resolve) => { settle = resolve }),
      settle: () => settle()
    }
    inFlight.set(key, entry)
    let terminalDelivered = false
    let deliveryStopped = false
    let deltaFlushTimer: ReturnType<typeof setTimeout> | undefined
    const queuedDeltas: AIProgressEvent[] = []
    const canDeliver = (): boolean => {
      if (deliveryStopped || !acceptingRequests || inFlight.get(key) !== entry ||
        !isCurrentProject(state, captured) || entry.sender.isDestroyed?.() === true) {
        deliveryStopped = true
        if (deltaFlushTimer !== undefined) clearTimeout(deltaFlushTimer)
        deltaFlushTimer = undefined
        queuedDeltas.length = 0
        return false
      }
      return true
    }
    const sendProgress = (progress: AIProgressEvent): boolean => {
      if (!canDeliver()) return false
      try {
        entry.sender.send(AI_PROGRESS_CHANNEL, structuredClone(progress))
        return true
      } catch {
        deliveryStopped = true
        queuedDeltas.length = 0
        return false
      }
    }
    const flushDeltas = (): void => {
      if (deltaFlushTimer !== undefined) clearTimeout(deltaFlushTimer)
      deltaFlushTimer = undefined
      if (!canDeliver()) return
      while (queuedDeltas.length > 0) {
        const delta = queuedDeltas.shift()!
        if (!sendProgress(delta)) return
      }
    }
    const deliverProgress = (rawProgress: AIProgressEvent): void => {
      let progress: AIProgressEvent
      try {
        progress = parseAIProgressEvent(rawProgress)
      } catch {
        return
      }
      if (progress.requestId !== request.requestId || progress.sessionId !== request.sessionId ||
        terminalDelivered || !canDeliver()) return
      if (progress.type === 'assistant_delta') {
        queuedDeltas.push(progress)
        if (deltaFlushTimer === undefined) {
          deltaFlushTimer = setTimeout(flushDeltas, 16)
        }
        return
      }
      flushDeltas()
      const terminal = progress.type === 'clarification' || progress.type === 'completed' ||
        progress.type === 'failed' || progress.type === 'cancelled'
      if (terminal) terminalDelivered = true
      sendProgress(progress)
    }
    try {
      const privacy = await dependencies.configService.getPrivacyStatus()
      if (!privacy.accepted) throw new Error('AI_PRIVACY_NOTICE_REQUIRED')
      if (controller.signal.aborted) throw new Error('AI_CANCELLED')
      const config = await dependencies.configService.getPlaintextForMain()
      if (controller.signal.aborted) throw new Error('AI_CANCELLED')
      if (!isCurrentProject(state, captured)) throw new Error('PROJECT_CHANGED')
      const orchestrator = createAIQuestionnaireOrchestrator({
        client,
        persistProject: (project) => {
          if (project !== captured.project) throw new Error('PROJECT_CHANGED')
          persist(captured)
        }
      })
      const result = await orchestrator.sendTurn({
        project: captured.project,
        sessionId: request.sessionId,
        userText: request.content,
        config,
        ...(request.includeCurrentQuestionnaire
          ? { explicitAttachment: structuredClone(captured.project.questionnaire) }
          : {}),
        signal: controller.signal,
        requestId: request.requestId,
        operationId: `ipc-${createHash('sha256').update(key).digest('hex')}`,
        ...(request.clarificationSelection === undefined
          ? {}
          : { clarificationSelection: request.clarificationSelection }),
        onProgress: deliverProgress
      })
      if (!result.ok) return publicError(result.errorCode, result.details)
      if (result.outcome === 'clarification') {
        return {
          ok: true,
          requestId: request.requestId,
          outcome: 'clarification',
          message: result.message,
          attempts: result.attempts
        } satisfies AISendResult
      }
      const preview = previewQuestionnaireArtifact(
        captured.project,
        request.sessionId,
        result.artifact.artifactId,
        false
      )
      if (preview === undefined) throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
      return {
        ok: true,
        requestId: request.requestId,
        outcome: 'questionnaire',
        artifact: toPublicQuestionnaireArtifact(result.artifact, preview),
        attempts: result.attempts
      } satisfies AISendResult
    } catch (error) {
      return publicError(error)
    } finally {
      if (inFlight.get(key) === entry) inFlight.delete(key)
      entry.settle()
    }
  })

  ipcMain.handle(AI_CANCEL_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAICancelRequest(rawRequest)
      const projectId = state.currentProject?.meta.projectId
      const entry = projectId === undefined
        ? undefined
        : inFlight.get(inFlightKey(callerOwner(event), projectId, request.requestId))
      const cancelled = entry !== undefined &&
        state.currentProject === entry.project && state.currentFilePath === entry.filePath
      if (cancelled) entry.controller.abort()
      return { ok: true, cancelled } satisfies AICancelResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_ARTIFACT_PREVIEW_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAIArtifactRequest(rawRequest)
      const preview = previewQuestionnaireArtifact(
        captureProject(state).project,
        request.sessionId,
        request.artifactId
      )
      if (preview === undefined) throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
      return { ok: true, preview: preview as AIArtifactPreview } satisfies AIArtifactPreviewResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_ARTIFACT_APPLY_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAIArtifactApplyRequest(rawRequest)
      const captured = captureProject(state)
      const result = await applyArtifact({
        project: captured.project,
        sessionId: request.sessionId,
        artifactId: request.artifactId,
        ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
        currentProjectPath: captured.filePath,
        backup: () => {
          if (!isCurrentProject(state, captured)) throw new Error('PROJECT_CHANGED')
          const dataPath = resolveProjectDataFilePath(captured.filePath, captured.project.meta.name)
          if (backup(captured.filePath, dataPath) === null) throw new Error('AI_ARTIFACT_APPLY_FAILED')
        },
        saveAtomic: (project) => {
          if (project !== captured.project) throw new Error('PROJECT_CHANGED')
          persist(captured)
        }
      })
      const preview = previewQuestionnaireArtifact(
        captured.project,
        request.sessionId,
        request.artifactId,
        false
      )
      if (preview === undefined) throw new Error('AI_ARTIFACT_NOT_APPLICABLE')
      return {
        ok: true,
        applied: result.applied,
        questionnaire: result.questionnaire,
        preview: preview as AIArtifactPreview
      } satisfies AIArtifactApplyResult
    } catch (error) {
      return publicError(error)
    }
  })

  const channels = [
    AI_CONFIG_GET_CHANNEL, AI_CONFIG_UPDATE_CHANNEL, AI_CONFIG_CLEAR_CHANNEL,
    AI_CONFIG_TEST_CONNECTION_CHANNEL, AI_PRIVACY_STATUS_CHANNEL, AI_PRIVACY_ACCEPT_CHANNEL,
    AI_SESSION_CREATE_CHANNEL, AI_SESSION_LIST_CHANNEL, AI_SESSION_GET_CHANNEL,
    AI_SESSION_UPDATE_CHANNEL, AI_SESSION_DELETE_CHANNEL, AI_SESSION_CLEAR_CACHE_CHANNEL,
    AI_SESSION_MIGRATE_CHANNEL,
    AI_SEND_CHANNEL, AI_CANCEL_CHANNEL, AI_ARTIFACT_PREVIEW_CHANNEL, AI_ARTIFACT_APPLY_CHANNEL
  ] as const

  return {
    cancelAll: () => {
      for (const request of inFlight.values()) request.controller.abort()
    },
    cancelAllAndSettle: () => {
      if (settling !== undefined) return settling
      acceptingRequests = false
      const pending = [...inFlight.values()]
      for (const request of pending) request.controller.abort()
      settling = Promise.all(pending.map(({ settled }) => settled)).then(() => undefined)
        .finally(() => {
          acceptingRequests = true
          settling = undefined
        })
      return settling
    },
    dispose: () => {
      acceptingRequests = false
      for (const request of inFlight.values()) request.controller.abort()
      inFlight.clear()
      for (const channel of channels) ipcMain.removeHandler(channel)
    }
  }
}
