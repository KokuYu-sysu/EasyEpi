import { describe, expect, it } from 'vitest'

import { getAiVersionStamp } from '@main/services/ai-questionnaire.harness'
import { AISessionRepository } from '@main/services/ai-session.repository'
import type {
  AIClarification,
  AIRun,
  AiVersionStamp,
  AIAssistantProjectData
} from '@shared/ai-assistant-contract'
import type { ProjectData } from '@shared/types/project'

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000'
const RUN_ID = 'run-1'
const USER_MESSAGE_ID = 'user-1'
const ASSISTANT_MESSAGE_ID = 'assistant-1'

const V1_STAMP: AiVersionStamp = {
  promptId: 'easyepi-questionnaire-assistant',
  promptVersion: '1.1.0',
  promptHash: 'sha256:d407a445883fa9a015c8772201af387fdbca41df3f33545a58017ba79d47c832',
  harnessVersion: '1.1.0',
  schemaVersion: 1
}

function project(aiAssistant?: AIAssistantProjectData): ProjectData {
  return { ...(aiAssistant === undefined ? {} : { aiAssistant }) } as ProjectData
}

function repository(stamp = getAiVersionStamp()): {
  project: ProjectData
  repository: AISessionRepository
  sessionId: string
} {
  const value = project()
  let now = 0
  const repo = new AISessionRepository(
    value,
    () => SESSION_ID,
    () => `2026-08-29T00:00:0${now++}.000Z`
  )
  return { project: value, repository: repo, sessionId: repo.create(stamp, 'Session').value.manifest.sessionId }
}

function runningRun(overrides: Partial<AIRun> = {}): AIRun {
  return {
    runId: RUN_ID,
    status: 'running',
    startedAt: '2026-08-29T00:00:01.000Z',
    versionStamp: getAiVersionStamp(),
    requestId: 'request-1',
    operationId: 'operation-1',
    userMessageId: USER_MESSAGE_ID,
    progress: {
      stage: 'starting', attempt: 1,
      updatedAt: '2026-08-29T00:00:01.000Z', streamFallback: false
    },
    ...overrides
  }
}

function seedRunning(repo: AISessionRepository, sessionId: string): void {
  repo.appendMessage(sessionId, {
    id: USER_MESSAGE_ID, role: 'user', content: 'Create a questionnaire',
    createdAt: '2026-08-29T00:00:01.000Z'
  })
  repo.upsertRun(sessionId, runningRun())
  repo.updateState(sessionId, { status: 'running', activeRunId: RUN_ID })
}

describe('AI session repository v2 persistence', () => {
  it('creates a v2 clarification partition and migrates schema 1 to 2 without losing audit data', () => {
    const { project: value, repository: repo, sessionId } = repository(V1_STAMP)
    const raw = value.aiAssistant!.sessions[sessionId]!
    raw.conversation.messages.push({
      id: 'legacy-message', role: 'assistant', content: 'Legacy', createdAt: '2026-08-28T00:00:00.000Z'
    })
    raw.conversation.attachments.legacy = {
      attachmentId: 'legacy', messageId: 'legacy-message', kind: 'questionnaire',
      createdAt: '2026-08-28T00:00:00.000Z', value: { name: 'Legacy' }
    }
    raw.state.runs.done = {
      runId: 'done', status: 'completed', startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z', versionStamp: V1_STAMP
    }
    raw.state.runs.failed = {
      runId: 'failed', status: 'failed', startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z', errorCode: 'OLD_FAILURE', versionStamp: V1_STAMP
    }
    raw.state.values = { rollingSummary: 'Keep me', activeArtifactId: 'old-artifact', versionMigrations: [] }
    raw.cache.values = { capability: true }
    raw.temp.runs.stale = { runId: 'stale', versionStamp: V1_STAMP, createdAt: 'x', values: {} }
    raw.artifacts.byId.old = {
      artifactId: 'old', operationId: 'old-operation', kind: 'questionnaire', status: 'completed',
      versionStamp: V1_STAMP, createdAt: 'x', updatedAt: 'x', value: { draft: true }
    }

    const migrated = repo.migrateSessionVersion(sessionId, getAiVersionStamp()).value

    expect(value.aiAssistant?.schemaVersion).toBe(1)
    expect(migrated.manifest.versionStamp.schemaVersion).toBe(2)
    expect(migrated.conversation).toMatchObject({ clarifications: {}, messages: [{ id: 'legacy-message' }] })
    expect(migrated.conversation.attachments.legacy).toBeDefined()
    expect(migrated.state.runs).toHaveProperty('done')
    expect(migrated.state.runs).toHaveProperty('failed')
    expect(migrated.state.values.rollingSummary).toBe('Keep me')
    expect(migrated.state.values).not.toHaveProperty('activeArtifactId')
    expect(migrated.state.values.versionMigrations).toEqual([
      expect.objectContaining({ from: V1_STAMP, to: getAiVersionStamp() })
    ])
    expect(migrated.artifacts.byId.old).toBeDefined()
    expect(migrated.cache.values).toEqual({})
    expect(migrated.temp.runs).toEqual({})
    expect(migrated.state).toMatchObject({ status: 'idle' })
    expect(migrated.state.activeRunId).toBeUndefined()
    expect(() => repo.migrateSessionVersion(sessionId, { ...getAiVersionStamp(), schemaVersion: 3 }))
      .toThrow()
  })

  it('validates latest-only quick reply and free-text clarification resolution without exposing mutable state', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.appendMessage(sessionId, {
      id: ASSISTANT_MESSAGE_ID, role: 'assistant', content: 'Choose one', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    const first: AIClarification = {
      clarificationId: 'clarification-1', messageId: ASSISTANT_MESSAGE_ID, runId: RUN_ID,
      options: [{ id: 'a', label: 'Option A' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:02.000Z'
    }
    repo.addClarification(sessionId, first)
    const read = repo.getLatestUnresolvedClarification(sessionId)!
    read.options[0]!.label = 'mutated'
    expect(repo.getLatestUnresolvedClarification(sessionId)?.options[0]?.label).toBe('Option A')

    repo.appendMessage(sessionId, {
      id: 'user-2', role: 'user', content: 'I choose A', createdAt: '2026-08-29T00:00:03.000Z'
    })
    expect(() => repo.resolveLatestClarification(sessionId, {
      clarificationId: 'clarification-1', resolvedByMessageId: 'user-2', selectedOptionId: 'missing'
    })).toThrow('AI_CLARIFICATION_OPTION_NOT_FOUND')
    expect(repo.resolveLatestClarification(sessionId, {
      clarificationId: 'clarification-1', resolvedByMessageId: 'user-2', selectedOptionId: 'a'
    }).value).toMatchObject({ status: 'resolved', selectedOptionId: 'a', resolvedByMessageId: 'user-2' })
    expect(repo.getLatestUnresolvedClarification(sessionId)).toBeUndefined()
    expect(() => repo.resolveLatestClarification(sessionId, {
      clarificationId: 'clarification-1', resolvedByMessageId: 'user-2'
    })).toThrow('AI_CLARIFICATION_NOT_LATEST')

    repo.appendMessage(sessionId, {
      id: 'assistant-2', role: 'assistant', content: 'More detail?', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:04.000Z'
    })
    repo.addClarification(sessionId, {
      clarificationId: 'clarification-2', messageId: 'assistant-2', runId: RUN_ID,
      options: [{ id: 'yes', label: 'Yes' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:04.000Z'
    })
    repo.appendMessage(sessionId, {
      id: 'user-empty', role: 'user', content: '', createdAt: '2026-08-29T00:00:05.000Z'
    })
    expect(() => repo.resolveLatestClarification(sessionId, {
      clarificationId: 'clarification-2', resolvedByMessageId: 'user-empty'
    })).toThrow('AI_CLARIFICATION_FREE_TEXT_REQUIRED')
    repo.appendMessage(sessionId, {
      id: 'user-3', role: 'user', content: 'My own answer', createdAt: '2026-08-29T00:00:06.000Z'
    })
    expect(repo.resolveLatestClarification(sessionId, {
      clarificationId: 'clarification-2', resolvedByMessageId: 'user-3'
    }).value.selectedOptionId).toBeUndefined()
  })

  it('persists progress, terminal results and failures with unique replay lookup and legal transitions', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    expect(repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'streaming', attempt: 2,
      updatedAt: '2026-08-29T00:00:02.000Z', streamFallback: true
    }).value.progress).toMatchObject({ stage: 'streaming', attempt: 2, streamFallback: true })
    expect(repo.findRunByOperationId(sessionId, 'operation-1')).toMatchObject({ runId: RUN_ID })
    const replay = repo.findRunByOperationId(sessionId, 'operation-1')!
    replay.operationId = 'mutated'
    expect(repo.findRunByOperationId(sessionId, 'operation-1')?.operationId).toBe('operation-1')

    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-1'
    })).toThrow('AI_ARTIFACT_NOT_FOUND')
    repo.upsertArtifact(sessionId, {
      artifactId: 'artifact-1', operationId: 'operation-1', kind: 'questionnaire',
      status: 'completed', versionStamp: getAiVersionStamp(), value: { draft: true }
    })
    expect(repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-1'
    }).value).toMatchObject({ status: 'completed', result: { kind: 'questionnaire', artifactId: 'artifact-1' } })
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'validating', attempt: 2,
      updatedAt: '2026-08-29T00:00:03.000Z', streamFallback: false
    })).toThrow('AI_RUN_NOT_ACTIVE')
    expect(() => repo.failRun(sessionId, RUN_ID, {
      errorCode: 'LATE_FAILURE', details: { attempts: [] }
    })).toThrow('AI_RUN_NOT_ACTIVE')

    const failedRun = runningRun({ runId: 'run-2', requestId: 'request-2', operationId: 'operation-2' })
    repo.upsertRun(sessionId, failedRun)
    expect(repo.failRun(sessionId, 'run-2', {
      errorCode: 'AI_VALIDATION_FAILED', details: { attempts: [] }
    }).value).toMatchObject({
      status: 'failed', errorCode: 'AI_VALIDATION_FAILED',
      failure: { errorCode: 'AI_VALIDATION_FAILED', details: { attempts: [] } }
    })
    expect(repo.findRunByOperationId(sessionId, 'operation-2')).toMatchObject({ status: 'failed' })
    expect(() => repo.upsertRun(sessionId, runningRun({
      runId: 'run-3', requestId: 'request-3', operationId: 'operation-2'
    }))).toThrow('AI_RUN_OPERATION_CONFLICT')
  })

  it('rejects unknown run fields, duplicate request ids and malformed public failure details', () => {
    const { repository: repo, sessionId } = repository()
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => repo.upsertRun(sessionId, {
      ...runningRun(), secret: 'raw-provider-output'
    } as AIRun)).toThrow('INVALID_AI_RUN')
    repo.upsertRun(sessionId, runningRun())
    expect(() => repo.upsertRun(sessionId, runningRun({
      runId: 'run-duplicate-request', operationId: 'operation-other'
    }))).toThrow('AI_RUN_REQUEST_CONFLICT')
    expect(() => repo.upsertRun(sessionId, runningRun({
      runId: 'run-terminal-bypass', requestId: 'request-terminal', operationId: 'operation-terminal',
      status: 'completed', completedAt: '2026-08-29T00:00:02.000Z',
      result: { kind: 'questionnaire', artifactId: 'missing' }
    }))).toThrow('AI_RUN_STATE_CONFLICT')
    expect(() => repo.failRun(sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED',
      details: { attempts: [{ attempt: 4, issues: [], truncated: false }] }
    })).toThrow('INVALID_AI_RUN_FAILURE')
  })

  it('keeps legacy runs readable but rejects v2-only persistence on a schema-1 session', () => {
    const { repository: repo, sessionId } = repository(V1_STAMP)
    repo.upsertRun(sessionId, {
      runId: 'legacy', status: 'completed', startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z', versionStamp: V1_STAMP
    })
    expect(repo.get(sessionId)?.state.runs.legacy).toMatchObject({ status: 'completed' })
    expect(() => repo.addClarification(sessionId, {
      clarificationId: 'new', messageId: 'missing', runId: 'legacy',
      options: [{ id: 'x', label: 'X' }], status: 'unresolved', createdAt: 'x'
    })).toThrow('AI_SESSION_VERSION_MIGRATION_REQUIRED')
  })
})
