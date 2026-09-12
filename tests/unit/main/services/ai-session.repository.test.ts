import { describe, expect, it } from 'vitest'

import { getAiVersionStamp } from '@main/services/ai-questionnaire.harness'
import {
  AISessionRepository,
  parseAISessionVirtualPath
} from '@main/services/ai-session.repository'
import type {
  AIClarification,
  AIRun,
  AiVersionStamp,
  AIAssistantProjectData
} from '@shared/ai-assistant-contract'
import { AI_PUBLIC_VALIDATION_SUMMARIES } from '@shared/ai-public-validation'
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
    () => `2026-08-29T00:00:${String(now++).padStart(2, '0')}.000Z`
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
      updatedAt: '2026-08-29T00:00:01.000Z', streamFallback: false,
      toolCallingFallback: false
    },
    ...overrides
  }
}

function seedRunning(repo: AISessionRepository, sessionId: string): void {
  repo.appendMessage(sessionId, {
    id: USER_MESSAGE_ID, role: 'user', content: 'Create a questionnaire',
    createdAt: '2026-08-29T00:00:01.000Z', runId: RUN_ID
  })
  repo.upsertRun(sessionId, runningRun())
  repo.updateState(sessionId, { status: 'running', activeRunId: RUN_ID })
}

describe('AI session repository v2 persistence', () => {
  it('creates a v2 clarification partition and migrates schema 1 to 2 without losing audit data', () => {
    const { project: value, repository: repo, sessionId } = repository()
    const raw = value.aiAssistant!.sessions[sessionId]!
    raw.manifest.versionStamp = V1_STAMP
    delete raw.conversation.clarifications
    raw.conversation.messages.push({
      id: 'legacy-message', role: 'assistant', content: 'Legacy', createdAt: '2026-08-28T00:00:00.000Z'
    })
    raw.conversation.attachments.legacy = {
      attachmentId: 'legacy', messageId: 'legacy-message', kind: 'questionnaire',
      createdAt: '2026-08-28T00:00:00.000Z', value: { name: 'Legacy' }
    }
    raw.state.runs.done = {
      runId: 'done', status: 'completed', startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z', versionStamp: V1_STAMP,
      operationId: 'legacy-done-operation'
    }
    raw.state.runs.failed = {
      runId: 'failed', status: 'failed', startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z', errorCode: 'OLD_FAILURE', versionStamp: V1_STAMP
    }
    raw.state.runs.active = {
      runId: 'active', status: 'running', startedAt: '2026-08-28T00:00:02.000Z',
      versionStamp: V1_STAMP, operationId: 'legacy-active-operation'
    }
    raw.state.status = 'running'
    raw.state.activeRunId = 'active'
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
    expect(migrated.state.runs).toHaveProperty('active')
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
    expect(repo.findRunByOperationId(sessionId, 'legacy-done-operation')).toBeUndefined()
    expect(() => repo.updateState(sessionId, { activeRunId: 'active' }))
      .toThrow('AI_RUN_VERSION_NOT_CURRENT')
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
      id: 'stale-user', role: 'user', content: 'Too early', createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => repo.resolveLatestClarification(sessionId, {
      clarificationId: 'clarification-1', resolvedByMessageId: 'stale-user', selectedOptionId: 'a'
    })).toThrow('AI_CLARIFICATION_STALE_RESOLUTION')

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
      stage: 'connecting', attempt: 1,
      updatedAt: '2026-08-29T00:00:02.000Z', streamFallback: false
    }).value.progress).toMatchObject({ stage: 'connecting', attempt: 1, streamFallback: false })
    expect(repo.findRunByOperationId(sessionId, 'operation-1')).toMatchObject({ runId: RUN_ID })
    const replay = repo.findRunByOperationId(sessionId, 'operation-1')!
    replay.operationId = 'mutated'
    expect(repo.findRunByOperationId(sessionId, 'operation-1')?.operationId).toBe('operation-1')

    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-1'
    })).toThrow('AI_ARTIFACT_NOT_FOUND')
    repo.upsertArtifact(sessionId, {
      artifactId: 'artifact-wrong-kind', operationId: 'wrong-operation', kind: 'questionnaire',
      status: 'completed', versionStamp: getAiVersionStamp(), value: { draft: true }
    })
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-wrong-kind'
    })).toThrow('AI_ARTIFACT_NOT_APPLICABLE')
    repo.upsertArtifact(sessionId, {
      artifactId: 'artifact-1', operationId: 'operation-1', kind: 'questionnaire-draft',
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

    repo.appendMessage(sessionId, {
      id: 'user-run-2', role: 'user', content: 'Retry', runId: 'run-2',
      createdAt: '2026-08-29T00:00:03.000Z'
    })
    const failedRun = runningRun({
      runId: 'run-2', requestId: 'request-2', operationId: 'operation-2', userMessageId: 'user-run-2',
      startedAt: '2026-08-29T00:00:03.000Z',
      progress: {
        stage: 'starting', attempt: 1, updatedAt: '2026-08-29T00:00:03.000Z',
        streamFallback: false, toolCallingFallback: false
      }
    })
    repo.upsertRun(sessionId, failedRun)
    repo.updateState(sessionId, { status: 'running', activeRunId: 'run-2' })
    expect(repo.failRun(sessionId, 'run-2', {
      errorCode: 'AI_VALIDATION_FAILED', details: { attempts: [] }
    }).value).toMatchObject({
      status: 'failed', errorCode: 'AI_VALIDATION_FAILED',
      failure: { errorCode: 'AI_VALIDATION_FAILED', details: { attempts: [] } }
    })
    expect(repo.findRunByOperationId(sessionId, 'operation-2')).toMatchObject({ status: 'failed' })
    repo.appendMessage(sessionId, {
      id: 'user-run-3', role: 'user', content: 'Retry again', runId: 'run-3',
      createdAt: '2026-08-29T00:00:04.000Z'
    })
    expect(() => repo.upsertRun(sessionId, runningRun({
      runId: 'run-3', requestId: 'request-3', operationId: 'operation-2', userMessageId: 'user-run-3',
      startedAt: '2026-08-29T00:00:04.000Z',
      progress: {
        stage: 'starting', attempt: 1, updatedAt: '2026-08-29T00:00:04.000Z',
        streamFallback: false, toolCallingFallback: false
      }
    }))).toThrow('AI_RUN_OPERATION_CONFLICT')
  })

  it('encodes the research stage order and rejects every out-of-order stage change', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    const step = (stage: string, second: number) => repo.updateRunProgress(sessionId, RUN_ID, {
      stage, attempt: 1,
      updatedAt: `2026-08-29T00:00:${String(second).padStart(2, '0')}.000Z`,
      streamFallback: false
    })

    // A run starts at `starting` and may only enter research planning from there.
    expect(() => step('literature', 2)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => step('web_search', 2)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => step('extracting', 2)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => step('validating', 2)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(step('planning', 2).value.progress?.stage).toBe('planning')

    // Each research stage may only advance to the next one, never jump or move backwards.
    // `planning` may skip `literature` because a non-medical plan has no literature stage.
    expect(() => step('extracting', 3)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => step('validating', 3)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(step('literature', 3).value.progress?.stage).toBe('literature')
    expect(() => step('planning', 4)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => step('extracting', 4)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(step('web_search', 4).value.progress?.stage).toBe('web_search')
    expect(() => step('literature', 5)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(step('extracting', 5).value.progress?.stage).toBe('extracting')
    expect(() => step('web_search', 6)).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(step('connecting', 6).value.progress?.stage).toBe('connecting')

    // Generation keeps its existing order, and the research stages are still running stages.
    expect(step('streaming', 7).value.progress?.stage).toBe('streaming')
    expect(step('validating', 8).value.progress?.stage).toBe('validating')
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 2,
      updatedAt: '2026-08-29T00:00:09.000Z', streamFallback: false
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(step('repairing', 9).value.progress?.stage).toBe('repairing')
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'validating', attempt: 2,
      updatedAt: '2026-08-29T00:00:10.000Z', streamFallback: false
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 2,
      updatedAt: '2026-08-29T00:00:10.000Z', streamFallback: false
    }).value.progress).toMatchObject({ stage: 'connecting', attempt: 2 })
  })

  it('accepts a research stage as the initial running stage and keeps stream fallback sticky', () => {
    const { repository: repo, sessionId } = repository()
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    // A run may be created while the research pipeline is already inside literature/web search.
    expect(repo.upsertRun(sessionId, runningRun({
      progress: {
        stage: 'web_search', attempt: 1, updatedAt: '2026-08-29T00:00:01.000Z',
        streamFallback: false
      }
    })).value.progress).toMatchObject({ stage: 'web_search', attempt: 1 })
    repo.updateState(sessionId, { status: 'running', activeRunId: RUN_ID })
    expect(repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'extracting', attempt: 1, updatedAt: '2026-08-29T00:00:02.000Z',
      streamFallback: true
    }).value.progress).toMatchObject({ stage: 'extracting', streamFallback: true })
    // A negotiated streaming fallback is sticky: it may never return to false.
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1, updatedAt: '2026-08-29T00:00:03.000Z',
      streamFallback: false
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1, updatedAt: '2026-08-29T00:00:03.000Z',
      streamFallback: true
    }).value.progress).toMatchObject({ stage: 'connecting', streamFallback: true })
  })

  it('requires the active run and monotonic progress transitions', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1,
      updatedAt: '2026-08-29T00:00:02.000Z', streamFallback: false
    })
    repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'streaming', attempt: 1,
      updatedAt: '2026-08-29T00:00:03.000Z', streamFallback: true,
      toolCallingFallback: true
    })
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1,
      updatedAt: '2026-08-29T00:00:04.000Z', streamFallback: true
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'validating', attempt: 1,
      updatedAt: '2026-08-29T00:00:02.000Z', streamFallback: true
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'validating', attempt: 1,
      updatedAt: '2026-08-29T00:00:04.000Z', streamFallback: false,
      toolCallingFallback: true
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'validating', attempt: 1,
      updatedAt: '2026-08-29T00:00:04.000Z', streamFallback: true,
      toolCallingFallback: false
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'validating', attempt: 1,
      updatedAt: '2026-08-29T00:00:04.000Z', streamFallback: true,
      toolCallingFallback: true
    })
    repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'repairing', attempt: 1,
      updatedAt: '2026-08-29T00:00:05.000Z', streamFallback: true,
      toolCallingFallback: true
    })
    repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 2,
      updatedAt: '2026-08-29T00:00:06.000Z', streamFallback: true,
      toolCallingFallback: true
    })
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1,
      updatedAt: '2026-08-29T00:00:07.000Z', streamFallback: true
    })).toThrow('INVALID_AI_RUN_PROGRESS_TRANSITION')
    repo.updateState(sessionId, { status: 'idle', activeRunId: null })
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'streaming', attempt: 2,
      updatedAt: '2026-08-29T00:00:07.000Z', streamFallback: true
    })).toThrow('AI_RUN_NOT_ACTIVE')
  })

  it('binds v2 runs to their initiating latest user message', () => {
    const { repository: repo, sessionId } = repository()
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: 'other-run',
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => repo.upsertRun(sessionId, runningRun())).toThrow('AI_RUN_USER_MESSAGE_MISMATCH')

    const later = repository()
    later.repository.appendMessage(later.sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    later.repository.appendMessage(later.sessionId, {
      id: 'later-user', role: 'user', content: 'Actually revise', runId: 'other-run',
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    expect(() => later.repository.upsertRun(later.sessionId, runningRun()))
      .toThrow('AI_RUN_USER_MESSAGE_MISMATCH')
  })

  it('rejects run progress and terminal timestamps before their prior lifecycle instant', () => {
    const initial = repository()
    initial.repository.appendMessage(initial.sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => initial.repository.upsertRun(initial.sessionId, runningRun({
      progress: {
        stage: 'starting', attempt: 1, updatedAt: '2026-08-29T00:00:00.000Z',
        streamFallback: false, toolCallingFallback: false
      }
    }))).toThrow('INVALID_AI_RUN_CHRONOLOGY')

    const current = repository()
    seedRunning(current.repository, current.sessionId)
    current.project.aiAssistant!.sessions[current.sessionId]!.state.runs[RUN_ID]!.progress!.updatedAt =
      '2026-08-29T00:00:00.000Z'
    expect(() => current.repository.updateRunProgress(current.sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1, updatedAt: '2026-08-29T00:00:00.500Z', streamFallback: false
    })).toThrow('INVALID_AI_RUN_CHRONOLOGY')

    const failed = repository()
    seedRunning(failed.repository, failed.sessionId)
    failed.repository.updateRunProgress(failed.sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1, updatedAt: '2026-08-29T00:00:10.000Z', streamFallback: false
    })
    expect(() => failed.repository.failRun(failed.sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED', details: { attempts: [] }
    })).toThrow('INVALID_AI_RUN_CHRONOLOGY')

    const completed = repository()
    seedRunning(completed.repository, completed.sessionId)
    completed.repository.updateRunProgress(completed.sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1, updatedAt: '2026-08-29T00:00:10.000Z', streamFallback: false
    })
    completed.repository.upsertArtifact(completed.sessionId, {
      artifactId: 'chronology-artifact', operationId: 'operation-1', kind: 'questionnaire-draft',
      status: 'completed', versionStamp: getAiVersionStamp(), value: { draft: true }
    })
    expect(() => completed.repository.completeRunWithResult(completed.sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'chronology-artifact'
    })).toThrow('INVALID_AI_RUN_CHRONOLOGY')
  })

  it('requires clarifications to follow their assistant message and remain one-to-one', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.appendMessage(sessionId, {
      id: ASSISTANT_MESSAGE_ID, role: 'assistant', content: 'Choose one', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    expect(() => repo.addClarification(sessionId, {
      clarificationId: 'early-clarification', messageId: ASSISTANT_MESSAGE_ID, runId: RUN_ID,
      options: [{ id: 'one', label: 'One' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:01.000Z'
    })).toThrow('AI_CLARIFICATION_CHRONOLOGY')
    repo.addClarification(sessionId, {
      clarificationId: 'first-clarification', messageId: ASSISTANT_MESSAGE_ID, runId: RUN_ID,
      options: [{ id: 'one', label: 'One' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    expect(() => repo.addClarification(sessionId, {
      clarificationId: 'second-clarification', messageId: ASSISTANT_MESSAGE_ID, runId: RUN_ID,
      options: [{ id: 'two', label: 'Two' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:03.000Z'
    })).toThrow('AI_CLARIFICATION_MESSAGE_CONFLICT')
  })

  it('refuses to reactivate a terminal current-v2 run', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.failRun(sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED', details: { attempts: [] }
    })
    expect(() => repo.updateState(sessionId, { activeRunId: RUN_ID }))
      .toThrow('AI_RUN_NOT_ACTIVE')
  })

  it('requires clearing before a different current-v2 run can become active', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.appendMessage(sessionId, {
      id: 'user-2', role: 'user', content: 'Continue', runId: 'run-2',
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    repo.upsertRun(sessionId, runningRun({
      runId: 'run-2', requestId: 'request-2', operationId: 'operation-2', userMessageId: 'user-2',
      startedAt: '2026-08-29T00:00:02.000Z',
      progress: {
        stage: 'starting', attempt: 1, updatedAt: '2026-08-29T00:00:02.000Z',
        streamFallback: false, toolCallingFallback: false
      }
    }))
    expect(() => repo.updateState(sessionId, { activeRunId: 'run-2' }))
      .toThrow('AI_RUN_ALREADY_ACTIVE')
    expect(repo.get(sessionId)?.state.activeRunId).toBe(RUN_ID)
  })

  it('rejects clarification records for terminal runs', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.appendMessage(sessionId, {
      id: ASSISTANT_MESSAGE_ID, role: 'assistant', content: 'Choose one', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    repo.failRun(sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED', details: { attempts: [] }
    })
    expect(() => repo.addClarification(sessionId, {
      clarificationId: 'terminal-clarification', messageId: ASSISTANT_MESSAGE_ID, runId: RUN_ID,
      options: [{ id: 'one', label: 'One' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:03.000Z'
    })).toThrow('AI_RUN_NOT_ACTIVE')
  })

  it('rejects clarification records for current but inactive runs', () => {
    const { repository: repo, sessionId } = repository()
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    repo.upsertRun(sessionId, runningRun())
    repo.appendMessage(sessionId, {
      id: ASSISTANT_MESSAGE_ID, role: 'assistant', content: 'Choose one', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    expect(() => repo.addClarification(sessionId, {
      clarificationId: 'inactive-clarification', messageId: ASSISTANT_MESSAGE_ID, runId: RUN_ID,
      options: [{ id: 'one', label: 'One' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:03.000Z'
    })).toThrow('AI_RUN_NOT_ACTIVE')
  })

  it('permits only current v2 runs to become active or receive terminal results', () => {
    const { project: value, repository: repo, sessionId } = repository()
    value.aiAssistant!.sessions[sessionId]!.state.runs.legacy = {
      runId: 'legacy', status: 'running', startedAt: '2026-08-28T00:00:00.000Z',
      versionStamp: V1_STAMP, operationId: 'legacy-operation'
    }
    expect(() => repo.updateState(sessionId, { activeRunId: 'legacy' }))
      .toThrow('AI_RUN_VERSION_NOT_CURRENT')
    expect(repo.findRunByOperationId(sessionId, 'legacy-operation')).toBeUndefined()

    seedRunning(repo, sessionId)
    value.aiAssistant!.sessions[sessionId]!.artifacts.byId['artifact-legacy-stamp'] = {
      artifactId: 'artifact-legacy-stamp', operationId: 'operation-1', kind: 'questionnaire-draft',
      status: 'completed', versionStamp: V1_STAMP,
      createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
      value: { draft: true }
    }
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-legacy-stamp'
    })).toThrow('AI_ARTIFACT_NOT_APPLICABLE')
  })

  it('accepts research metadata on completed runs and rejects malformed research metadata', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.upsertArtifact(sessionId, {
      artifactId: 'artifact-research', operationId: 'operation-1', kind: 'questionnaire-draft',
      status: 'completed', versionStamp: getAiVersionStamp(), value: { draft: true }
    })
    const citations = [{ url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'Study' }]

    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research', researchStatus: 'searched'
    })).toThrow('INVALID_AI_RUN_RESULT')
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research', researchMode: 'dental'
    })).toThrow('INVALID_AI_RUN_RESULT')
    // An undeclared key is refused by the shared exact-key helper, which reports its own code.
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research',
      researchStatus: 'literature_and_web', extra: true
    })).toThrow('INVALID_AI_PERSISTED_VALUE')
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research',
      citations: [{ url: 'http://insecure.test/1', title: 'Study' }]
    })).toThrow('INVALID_AI_RUN_RESULT')
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'Study', pmid: '1' }]
    })).toThrow('INVALID_AI_PERSISTED_VALUE')
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research',
      citations: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: '' }]
    })).toThrow('INVALID_AI_RUN_RESULT')
    expect(() => repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research',
      citations: Array.from({ length: 21 }, (_, index) => ({
        url: `https://pubmed.ncbi.nlm.nih.gov/${index}/`, title: 'Study'
      }))
    })).toThrow('INVALID_AI_RUN_RESULT')
    // Every rejected candidate leaves the run untouched and still active.
    expect(repo.get(sessionId)?.state.runs[RUN_ID]).toMatchObject({ status: 'running' })

    expect(repo.completeRunWithResult(sessionId, RUN_ID, {
      kind: 'questionnaire', artifactId: 'artifact-research',
      researchStatus: 'literature_and_web', researchMode: 'medical', citations
    }).value).toMatchObject({
      status: 'completed',
      result: {
        kind: 'questionnaire', artifactId: 'artifact-research',
        researchStatus: 'literature_and_web', researchMode: 'medical', citations
      }
    })

    const clarification = repository()
    seedRunning(clarification.repository, clarification.sessionId)
    clarification.repository.appendMessage(clarification.sessionId, {
      id: ASSISTANT_MESSAGE_ID, role: 'assistant', content: 'Choose one', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    clarification.repository.addClarification(clarification.sessionId, {
      clarificationId: 'clarification-1', messageId: ASSISTANT_MESSAGE_ID, runId: RUN_ID,
      options: [{ id: 'a', label: 'Option A' }], status: 'unresolved',
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    expect(clarification.repository.completeRunWithResult(clarification.sessionId, RUN_ID, {
      kind: 'clarification', messageId: ASSISTANT_MESSAGE_ID, clarificationId: 'clarification-1',
      researchStatus: 'none', researchMode: 'non_medical', citations: []
    }).value).toMatchObject({
      status: 'completed',
      result: {
        kind: 'clarification', researchStatus: 'none', researchMode: 'non_medical', citations: []
      }
    })
  })

  it('normalizes persisted validation details through the shared public allowlist', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    expect(() => repo.failRun(sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED',
      details: { attempts: [{
        attempt: 1,
        issues: [{ code: 'INVALID_TYPE', field: '$.questions[0]', summary: 'wrong summary' }],
        truncated: false
      }] }
    })).toThrow('INVALID_AI_RUN_FAILURE')
  })

  it('recovers current-v2 interrupted runs as valid failed terminal records', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.setRunTemp(sessionId, {
      runId: RUN_ID, versionStamp: getAiVersionStamp(), createdAt: '2026-08-29T00:00:02.000Z', values: {}
    })
    expect(repo.recoverInterruptedRuns()).toMatchObject({ value: 2, mutated: true })
    expect(repo.get(sessionId)?.state).toMatchObject({
      status: 'failed',
      runs: {
        [RUN_ID]: {
          status: 'failed', errorCode: 'AI_RUN_INTERRUPTED',
          failure: { errorCode: 'AI_RUN_INTERRUPTED', details: { attempts: [] } },
          progress: { stage: 'failed', attempt: 1, streamFallback: false }
        }
      }
    })
    expect(repo.get(sessionId)?.state.activeRunId).toBeUndefined()
  })

  it('rejects recovery when the clock precedes an interrupted v2 run progress snapshot', () => {
    const { repository: repo, sessionId } = repository()
    seedRunning(repo, sessionId)
    repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1, updatedAt: '2026-08-29T00:00:10.000Z', streamFallback: false
    })
    const before = JSON.stringify(repo.get(sessionId))
    expect(() => repo.recoverInterruptedRuns()).toThrow('INVALID_AI_RUN_CHRONOLOGY')
    expect(JSON.stringify(repo.get(sessionId))).toBe(before)
  })

  it('parses progress without coercion and only permits running stages for running runs', () => {
    const legacy = repository()
    legacy.repository.appendMessage(legacy.sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    const legacyRun = runningRun()
    delete (legacyRun.progress as { toolCallingFallback?: boolean }).toolCallingFallback
    expect(legacy.repository.upsertRun(legacy.sessionId, legacyRun).value.progress)
      .toMatchObject({ toolCallingFallback: false })

    const { repository: repo, sessionId } = repository()
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => repo.upsertRun(sessionId, runningRun({
      progress: {
        stage: 'starting', attempt: '1' as unknown as 1,
        updatedAt: '2026-08-29T00:00:01.000Z', streamFallback: false,
        toolCallingFallback: false
      }
    }))).toThrow('INVALID_AI_RUN_PROGRESS')
    expect(() => repo.upsertRun(sessionId, runningRun({
      progress: {
        stage: 'clarification', attempt: 1, updatedAt: '2026-08-29T00:00:01.000Z',
        streamFallback: false, toolCallingFallback: false
      }
    }))).toThrow('INVALID_AI_RUN_PROGRESS')
  })

  it('validates strict timestamps and compares progress instants by epoch', () => {
    const { repository: repo, sessionId } = repository()
    expect(() => repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', createdAt: 'not-a-timestamp'
    })).toThrow('INVALID_AI_TIMESTAMP')
    expect(() => repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', createdAt: '2026-02-30T00:00:00.000Z'
    })).toThrow('INVALID_AI_TIMESTAMP')
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => repo.upsertRun(sessionId, runningRun({ startedAt: 'not-a-timestamp' })))
      .toThrow('INVALID_AI_TIMESTAMP')
    repo.upsertRun(sessionId, runningRun({
      progress: {
        stage: 'starting', attempt: 1, updatedAt: '2026-08-29T08:00:03.000+08:00',
        streamFallback: false, toolCallingFallback: false
      }
    }))
    repo.updateState(sessionId, { status: 'running', activeRunId: RUN_ID })
    expect(() => repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'clarification', attempt: 1, updatedAt: '2026-08-28T20:00:00.000Z', streamFallback: false
    })).toThrow('INVALID_AI_RUN_PROGRESS')
    expect(repo.updateRunProgress(sessionId, RUN_ID, {
      stage: 'connecting', attempt: 1, updatedAt: '2026-08-29T00:00:04.000Z', streamFallback: false
    }).value.progress?.stage).toBe('connecting')
    expect(() => repo.setRunTemp(sessionId, {
      runId: RUN_ID, versionStamp: getAiVersionStamp(), createdAt: 'not-a-timestamp', values: {}
    })).toThrow('INVALID_AI_TIMESTAMP')
  })

  it('validates state updates atomically against active-run invariants', () => {
    const { repository: repo, sessionId } = repository()
    const before = JSON.stringify(repo.get(sessionId))
    expect(() => repo.updateState(sessionId, { status: 'running', activeRunId: 'missing' }))
      .toThrow('AI_RUN_NOT_FOUND')
    expect(JSON.stringify(repo.get(sessionId))).toBe(before)
    seedRunning(repo, sessionId)
    const runningBefore = JSON.stringify(repo.get(sessionId))
    expect(() => repo.updateState(sessionId, { status: 'idle' })).toThrow('INVALID_AI_SESSION_STATE')
    expect(JSON.stringify(repo.get(sessionId))).toBe(runningBefore)
  })

  it('creates only sessions stamped with the current supported registry version', () => {
    const value = project()
    const repo = new AISessionRepository(value, () => SESSION_ID)
    expect(() => repo.create(V1_STAMP, 'Legacy session')).toThrow('AI_VERSION_NOT_SUPPORTED')
    expect(repo.create(getAiVersionStamp(), 'Current session').value.manifest.versionStamp)
      .toEqual(getAiVersionStamp())
  })

  it('rejects unknown run fields, duplicate request ids and malformed public failure details', () => {
    const { repository: repo, sessionId } = repository()
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => repo.upsertRun(sessionId, {
      ...runningRun(), secret: 'raw-provider-output'
    } as AIRun)).toThrow('INVALID_AI_RUN')
    repo.upsertRun(sessionId, runningRun())
    repo.updateState(sessionId, { status: 'running', activeRunId: RUN_ID })
    repo.appendMessage(sessionId, {
      id: 'duplicate-request-user', role: 'user', content: 'Duplicate', runId: 'run-duplicate-request',
      createdAt: '2026-08-29T00:00:02.000Z'
    })
    expect(() => repo.upsertRun(sessionId, runningRun({
      runId: 'run-duplicate-request', operationId: 'operation-other', userMessageId: 'duplicate-request-user',
      startedAt: '2026-08-29T00:00:02.000Z',
      progress: {
        stage: 'starting', attempt: 1, updatedAt: '2026-08-29T00:00:02.000Z',
        streamFallback: false, toolCallingFallback: false
      }
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
    expect(() => repo.failRun(sessionId, RUN_ID, {
      errorCode: 'ai validation failed', details: { attempts: [] }
    })).toThrow('INVALID_AI_RUN_FAILURE')
    expect(() => repo.failRun(sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED',
      details: { attempts: [{
        attempt: 1,
        issues: [{ code: 'RAW_SECRET_CODE', field: '$', summary: 'raw secret' }],
        truncated: false
      }] }
    })).toThrow('INVALID_AI_RUN_FAILURE')
    expect(() => repo.failRun(sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED',
      details: { attempts: [{
        attempt: 1,
        issues: [{ code: 'INVALID_TYPE', field: '$.questions[0]', summary: 'wrong summary' }],
        truncated: false
      }] }
    })).toThrow('INVALID_AI_RUN_FAILURE')
    expect(repo.failRun(sessionId, RUN_ID, {
      errorCode: 'AI_VALIDATION_FAILED',
      details: { attempts: [{
        attempt: 1,
        issues: [{
          code: 'INVALID_TYPE',
          field: '$.questions[0]',
          summary: AI_PUBLIC_VALIDATION_SUMMARIES.INVALID_TYPE
        }],
        truncated: false
      }] }
    }).value.status).toBe('failed')
  })

  it('keeps legacy runs readable but rejects v2-only persistence on a schema-1 session', () => {
    const { project: value, repository: repo, sessionId } = repository()
    const raw = value.aiAssistant!.sessions[sessionId]!
    raw.manifest.versionStamp = V1_STAMP
    delete raw.conversation.clarifications
    raw.state.runs.legacy = {
      runId: 'legacy', status: 'completed', startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z', versionStamp: V1_STAMP
    }
    expect(repo.get(sessionId)?.state.runs.legacy).toMatchObject({ status: 'completed' })
    expect(() => repo.addClarification(sessionId, {
      clarificationId: 'new', messageId: 'missing', runId: 'legacy',
      options: [{ id: 'x', label: 'X' }], status: 'unresolved', createdAt: 'x'
    })).toThrow('AI_SESSION_VERSION_MIGRATION_REQUIRED')
  })

  it.each([
    ['control characters', `session://${SESSION_ID}/cache/values/bad\u0001key`],
    ['missing partition and key', `session://${SESSION_ID}`],
    ['missing value key', `session://${SESSION_ID}/cache`],
    ['empty value segment', `session://${SESSION_ID}/cache/values/`],
    ['unknown partition', `session://${SESSION_ID}/unknown/value`]
  ])('rejects virtual paths containing %s', (_name, path) => {
    expect(() => parseAISessionVirtualPath(path, SESSION_ID)).toThrow('INVALID_AI_SESSION_PATH')
  })

  it('covers session creation, lookup, update, and collision boundaries', () => {
    const value = project()
    const repo = new AISessionRepository(
      value,
      () => SESSION_ID,
      () => '2024-02-29T23:59:59.000Z'
    )
    expect(repo.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeUndefined()
    expect(repo.create(getAiVersionStamp(), 'Leap session').value.manifest.createdAt)
      .toBe('2024-02-29T23:59:59.000Z')
    expect(repo.update(SESSION_ID, { title: 'Leap session' }).mutated).toBe(false)
    expect(repo.update(SESSION_ID, { title: 'Updated session' })).toMatchObject({
      mutated: true,
      value: { manifest: { title: 'Updated session' } }
    })
    expect(() => repo.create(getAiVersionStamp(), 'Collision')).toThrow('AI_SESSION_ID_COLLISION')
    expect(() => repo.update(SESSION_ID, { title: ' bad ' })).toThrow('INVALID_AI_SESSION_TITLE')
    expect(() => repo.updateState(SESSION_ID, { status: 'unknown' as never }))
      .toThrow('INVALID_AI_SESSION_STATE')
  })

  it('rejects cyclic, dangerous, and non-JSON cache values', () => {
    const { repository: repo, sessionId } = repository()
    const path = `session://${sessionId}/cache/values/test`
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const invalid of [
      cyclic,
      JSON.parse('{"__proto__":true}'),
      new Date(),
      Number.NaN
    ]) {
      expect(() => repo.writeVirtual(path, invalid as never, sessionId))
        .toThrow('INVALID_AI_JSON_VALUE')
    }
  })

  it('validates message and attachment shapes while preserving idempotent attachments', () => {
    const { repository: repo, sessionId } = repository()
    expect(() => repo.appendMessage(sessionId, null)).toThrow('INVALID_AI_MESSAGE')
    expect(() => repo.appendMessage(sessionId, {
      id: 'assistant-orphan', role: 'assistant', content: 'orphan', createdAt: '2026-08-29T00:00:01.000Z',
      runId: 'missing-run'
    })).toThrow('AI_RUN_NOT_FOUND')
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', createdAt: '2026-08-29T00:00:01.000Z'
    })
    expect(() => repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Duplicate', createdAt: '2026-08-29T00:00:02.000Z'
    })).toThrow('AI_MESSAGE_ID_CONFLICT')
    expect(() => repo.upsertAttachment(sessionId, null)).toThrow('INVALID_AI_ATTACHMENT')
    expect(() => repo.upsertAttachment(sessionId, {
      attachmentId: 'a1', messageId: 'missing', kind: 'questionnaire',
      createdAt: '2026-08-29T00:00:02.000Z', value: {}
    })).toThrow('AI_MESSAGE_NOT_FOUND')
    const attachment = {
      attachmentId: 'a1', messageId: USER_MESSAGE_ID, kind: 'questionnaire',
      createdAt: '2026-08-29T00:00:02.000Z', value: { name: 'Study' }
    }
    expect(repo.upsertAttachment(sessionId, attachment).mutated).toBe(true)
    expect(repo.upsertAttachment(sessionId, attachment).mutated).toBe(false)
    expect(repo.upsertAttachment(sessionId, {
      ...attachment, value: { name: 'Updated' }
    })).toMatchObject({ mutated: true, value: { value: { name: 'Updated' } } })
  })

  it('exercises reserved virtual cache creation, idempotency, reads, and deletions', () => {
    const { repository: repo, sessionId } = repository()
    const path = `session://${sessionId}/cache/values/provider`
    expect(repo.writeVirtual(path, { mode: 'json' }, sessionId)).toMatchObject({ mutated: true })
    expect(repo.writeVirtual(path, { mode: 'json' }, sessionId)).toMatchObject({ mutated: false })
    expect(repo.writeVirtual(path, { mode: 'text' }, sessionId)).toMatchObject({ mutated: true })
    expect(repo.readVirtual(path, sessionId)).toEqual({ mode: 'text' })
    expect(() => repo.readVirtual(
      `session://${sessionId}/cache/values/missing`, sessionId
    )).toThrow('AI_SESSION_VALUE_NOT_FOUND')
    expect(repo.deleteVirtual(`session://${sessionId}/cache/values/missing`, sessionId))
      .toEqual({ value: false, mutated: false })
    expect(repo.deleteVirtual(path, sessionId)).toEqual({ value: true, mutated: true })
    expect(repo.clearCache(sessionId)).toEqual({ value: 0, mutated: false })
    repo.writeVirtual(path, true, sessionId)
    expect(repo.clearCache(sessionId)).toEqual({ value: 1, mutated: true })
    expect(repo.cleanupRunTemp(sessionId, 'missing')).toEqual({ value: false, mutated: false })
    expect(repo.delete('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
      .toEqual({ value: false, mutated: false })
  })

  it('rejects malformed current-version runs before persistence', () => {
    const { repository: repo, sessionId } = repository()
    repo.appendMessage(sessionId, {
      id: USER_MESSAGE_ID, role: 'user', content: 'Create', runId: RUN_ID,
      createdAt: '2026-08-29T00:00:01.000Z'
    })
    const cases: Array<[unknown, string]> = [
      [null, 'INVALID_AI_RUN'],
      [{ ...runningRun(), status: 'idle' }, 'INVALID_AI_RUN'],
      [{ ...runningRun(), completedAt: 1 }, 'INVALID_AI_RUN'],
      [{ ...runningRun(), errorCode: '' }, 'INVALID_AI_RUN'],
      [{ ...runningRun(), progress: undefined }, 'INVALID_AI_RUN_PROGRESS'],
      [{ ...runningRun(), progress: null }, 'INVALID_AI_RUN_PROGRESS'],
      [{ ...runningRun(), result: null }, 'INVALID_AI_RUN_RESULT'],
      [{ ...runningRun(), failure: null }, 'INVALID_AI_RUN_FAILURE'],
      [{ ...runningRun(), completedAt: '2026-08-29T00:00:02.000Z' }, 'INVALID_AI_RUN']
    ]
    for (const [input, code] of cases) {
      expect(() => repo.upsertRun(sessionId, input as AIRun)).toThrow(code)
    }
  })

  it('rejects malformed artifact variants and accepts optional value and error fields', () => {
    const { repository: repo, sessionId } = repository()
    const base = {
      artifactId: 'artifact-1', operationId: 'operation-1', kind: 'questionnaire-draft',
      status: 'pending' as const, versionStamp: getAiVersionStamp()
    }
    expect(() => repo.upsertArtifact(sessionId, null)).toThrow('INVALID_AI_ARTIFACT')
    expect(() => repo.upsertArtifact(sessionId, { ...base, errorCode: '' }))
      .toThrow('INVALID_AI_ARTIFACT')
    expect(() => repo.upsertArtifact(sessionId, { ...base, errorCode: 1 }))
      .toThrow('INVALID_AI_ARTIFACT')
    expect(repo.upsertArtifact(sessionId, { ...base, value: { draft: true } })).toMatchObject({
      mutated: true,
      value: { value: { draft: true } }
    })
    expect(repo.upsertArtifact(sessionId, {
      artifactId: 'artifact-2', operationId: 'operation-2', kind: 'questionnaire-draft',
      status: 'failed', versionStamp: getAiVersionStamp(), errorCode: 'AI_PROVIDER_ERROR'
    })).toMatchObject({ mutated: true, value: { errorCode: 'AI_PROVIDER_ERROR' } })
  })
})
