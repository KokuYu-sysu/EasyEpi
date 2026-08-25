import path from 'node:path'

import type {
  AIArtifactApplyResult,
  AIArtifactPreview,
  AIArtifactPreviewResult,
  AICancelResult,
  AIConfigIpcResult,
  AIConnectionTestResult,
  AIErrorResult,
  AIPrivacyStatusResult,
  AISendResult,
  AISessionDeleteResult,
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
  AI_SEND_CHANNEL,
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
  parseAISessionCreateRequest,
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
  previewQuestionnaireArtifact
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
import { assertTrustedSender, type IpcInvokeEventLike, type IpcMainLike } from './types'

interface CapturedProject {
  project: ProjectData
  filePath: string
  key: Buffer
  saltHex: string
  hashHex: string
}

interface InFlightRequest {
  controller: AbortController
  project: ProjectData
  filePath: string
  owner: unknown
}

export interface AIIpcDependencies {
  configService: AIConfigService
  client?: { complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> }
  createProjectBackup?: typeof createBackup
  saveProject?: typeof saveProjectToPath
}

export interface AIIpcRegistration {
  cancelAll(): void
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
  AI_VERSION_MIGRATION_REQUIRED: '该对话需要先迁移。',
  AI_INTERNAL_ERROR: 'AI 操作失败。'
}

function errorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? code : 'AI_INTERNAL_ERROR'
}

function publicError(error: unknown): AIErrorResult {
  const code = errorCode(error)
  return { ok: false, errorCode: code, message: ERROR_MESSAGES[code]! }
}

function configError(code: string): AIErrorResult {
  return publicError(code)
}

function captureProject(state: ProjectIpcState): CapturedProject {
  if (state.currentProject === null || state.currentFilePath === null) {
    throw new Error('AI_PROJECT_REQUIRED')
  }
  if (state.auth.encryptionKey === null || state.auth.encryptionKey.length === 0 ||
    !path.isAbsolute(state.currentFilePath) || state.currentFilePath.includes('\0') ||
    !/^[0-9a-f]{64}$/i.test(state.currentSaltHex) || !/^[0-9a-f]{64}$/i.test(state.currentHashHex)) {
    throw new Error('AI_PROJECT_LOCKED')
  }
  return {
    project: state.currentProject,
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

function callerOwner(event: IpcInvokeEventLike): unknown {
  return event.sender?.id ?? event.sender ?? event.senderFrame?.url
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
      return { ok: true, session } satisfies AISessionResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_LIST_CHANNEL, async (event) => {
    trusted(event)
    try {
      const sessions = new AISessionRepository(captureProject(state).project).list()
      return { ok: true, sessions } satisfies AISessionListResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_GET_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionIdRequest(rawRequest)
      const session = new AISessionRepository(captureProject(state).project).get(request.sessionId)
      if (session === undefined) throw new Error('AI_SESSION_NOT_FOUND')
      return { ok: true, session } satisfies AISessionResult
    } catch (error) {
      return publicError(error)
    }
  })

  ipcMain.handle(AI_SESSION_UPDATE_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAISessionUpdateRequest(rawRequest)
      const session = mutateSession((repository) => repository.update(request.sessionId, { title: request.title }))
      return { ok: true, session } satisfies AISessionResult
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
      return { ok: true, migrated: result.migrated, session } satisfies AISessionMigrateResult
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
    if (inFlight.has(request.requestId)) return publicError('AI_REQUEST_IN_PROGRESS')

    let captured: CapturedProject
    try {
      captured = captureProject(state)
    } catch (error) {
      return publicError(error)
    }
    const controller = new AbortController()
    const entry: InFlightRequest = {
      controller,
      project: captured.project,
      filePath: captured.filePath,
      owner: callerOwner(event)
    }
    inFlight.set(request.requestId, entry)
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
        operationId: request.requestId
      })
      return result.ok
        ? { ok: true, requestId: request.requestId, artifact: result.artifact, attempts: result.attempts } satisfies AISendResult
        : publicError(result.errorCode)
    } catch (error) {
      return publicError(error)
    } finally {
      if (inFlight.get(request.requestId) === entry) inFlight.delete(request.requestId)
    }
  })

  ipcMain.handle(AI_CANCEL_CHANNEL, async (event, rawRequest) => {
    trusted(event)
    try {
      const request = parseAICancelRequest(rawRequest)
      const entry = inFlight.get(request.requestId)
      const cancelled = entry !== undefined && entry.owner === callerOwner(event) &&
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
    AI_SESSION_UPDATE_CHANNEL, AI_SESSION_DELETE_CHANNEL, AI_SESSION_MIGRATE_CHANNEL,
    AI_SEND_CHANNEL, AI_CANCEL_CHANNEL, AI_ARTIFACT_PREVIEW_CHANNEL, AI_ARTIFACT_APPLY_CHANNEL
  ] as const

  return {
    cancelAll: () => {
      for (const request of inFlight.values()) request.controller.abort()
    },
    dispose: () => {
      for (const request of inFlight.values()) request.controller.abort()
      inFlight.clear()
      for (const channel of channels) ipcMain.removeHandler(channel)
    }
  }
}
