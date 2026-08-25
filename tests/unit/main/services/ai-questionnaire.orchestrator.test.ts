import { describe, expect, it, vi } from 'vitest'

import {
  applyArtifact,
  createAIQuestionnaireOrchestrator,
  migrateSessionVersion,
  previewQuestionnaireArtifact
} from '@main/services/ai-questionnaire.orchestrator'
import {
  getAiVersionStamp,
  hashAIQuestionnaire
} from '@main/services/ai-questionnaire.harness'
import { AISessionRepository } from '@main/services/ai-session.repository'
import { AIClientError, createOpenAICompatibleClient } from '@main/services/openai-compatible.client'
import { ensureProjectId } from '@main/services/project.service'
import type { ProjectData } from '@shared/types/project'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'

function project(versionStamp = getAiVersionStamp()): ProjectData {
  const meta = {
    projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'AI test',
    folderPath: 'must-not-enter-context',
    createdAt: '2026-08-25T00:00:00.000Z',
    lastModifiedAt: '2026-08-25T00:00:00.000Z'
  }
  const value: ProjectData = {
    meta,
    questionnaire: { name: 'Existing', questions: [], conditionRules: [], keyQuestionIds: [] }
  }
  new AISessionRepository(value, () => sessionId).create(versionStamp, 'AI')
  return value
}

function validCompletion(): string {
  return JSON.stringify({
    assistantMessage: 'Done',
    rollingSummary: 'One question',
    questionnaire: {
      name: 'Study',
      questions: [{
        id: 'q1', content: 'Age', variableName: 'age', type: 'numeric_range', options: [],
        constraint: { type: 'integer', minValue: 0, maxValue: 120 }, isKey: false,
        allowSkip: false, order: 0
      }],
      conditionRules: [],
      keyQuestionIds: []
    }
  })
}

describe('AI questionnaire orchestrator', () => {
  it('uses one call normally and no more than two validation-repair calls', async () => {
    const firstProject = project()
    const oneCall = vi.fn().mockResolvedValue({ content: validCompletion(), responseFormatSupported: true })
    const first = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete: oneCall }
    }).sendTurn({
      project: firstProject,
      sessionId,
      userText: 'Create an age questionnaire',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(first).toMatchObject({ ok: true, attempts: 1 })
    expect(oneCall).toHaveBeenCalledTimes(1)
    expect(new AISessionRepository(firstProject).get(sessionId)?.temp.runs).toEqual({})

    const retryProject = project()
    const requestLengths: number[] = []
    const invalidContent = JSON.stringify({
      assistantMessage: 'invalid', rollingSummary: '',
      questionnaire: {
        name: 'Study', conditionRules: [], keyQuestionIds: [],
        questions: Array.from({ length: 500 }, (_, order) => ({
          content: '', variableName: '', type: 'free_text', options: [],
          constraint: { type: 'none' }, isKey: false, allowSkip: false, order
        }))
      }
    })
    const alwaysInvalid = vi.fn().mockImplementation((request: { messages: Array<{ content: string }> }) => {
      requestLengths.push(request.messages.reduce((sum, message) => sum + message.content.length, 0))
      return Promise.resolve({ content: invalidContent, responseFormatSupported: true })
    })
    const retried = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete: alwaysInvalid }
    }).sendTurn({
      project: retryProject,
      sessionId,
      userText: 'Create anything',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(retried).toMatchObject({ ok: false, errorCode: 'AI_HARNESS_VALIDATION_FAILED' })
    expect(alwaysInvalid).toHaveBeenCalledTimes(3)
    expect(Math.max(...requestLengths)).toBeLessThanOrEqual(60_000)
    if (!retried.ok) expect(retried.validationErrors?.length).toBeLessThanOrEqual(100)
    expect(new AISessionRepository(retryProject).get(sessionId)).toMatchObject({
      state: { status: 'failed' },
      temp: { runs: {} }
    })
  })

  it('cancels safely without replacing the active artifact', async () => {
    const value = project()
    new AISessionRepository(value).updateState(sessionId, { values: { preserved: 'yes' } })
    const result = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete: vi.fn().mockRejectedValue(new AIClientError('AI_CANCELLED')) }
    }).sendTurn({
      project: value,
      sessionId,
      userText: 'Create a questionnaire',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(result).toEqual({ ok: false, errorCode: 'AI_CANCELLED' })
    expect(new AISessionRepository(value).get(sessionId)).toMatchObject({
      state: { status: 'cancelled', values: { preserved: 'yes' } },
      temp: { runs: {} }
    })
  })

  it('applies once, backs up first, and preserves derived variables', async () => {
    const value = project()
    value.questionnaire.derivedVariables = [{
      id: 'derived-1', variableName: 'bmi', label: 'BMI', formula: '1',
      resultType: 'numeric', order: 0
    }]
    const generated = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete: vi.fn().mockResolvedValue({ content: validCompletion(), responseFormatSupported: true }) }
    }).sendTurn({
      project: value,
      sessionId,
      userText: 'Create a questionnaire',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const calls: string[] = []
    let releaseBackup!: () => void
    let backupStarted!: () => void
    const started = new Promise<void>((resolve) => { backupStarted = resolve })
    const request = {
      project: value,
      sessionId,
      artifactId: generated.artifact.artifactId,
      currentProjectPath: 'D:\\study.easyepi',
      backup: vi.fn(() => {
        calls.push('backup')
        if (calls.length === 1) {
          backupStarted()
          return new Promise<void>((resolve) => { releaseBackup = resolve })
        }
      }),
      saveAtomic: vi.fn(() => { calls.push('save') })
    }
    const firstApply = applyArtifact(request)
    await started
    const secondApply = applyArtifact(request)
    releaseBackup()
    expect(await Promise.all([firstApply, secondApply])).toEqual([
      expect.objectContaining({ applied: true }),
      expect.objectContaining({ applied: false })
    ])
    expect(calls).toEqual(['backup', 'save'])
    expect(value.questionnaire.derivedVariables).toEqual([
      expect.objectContaining({ variableName: 'bmi' })
    ])
  })

  it('serializes failed run persistence with a later artifact apply', async () => {
    const value = project()
    const generated = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete: vi.fn().mockResolvedValue({ content: validCompletion(), responseFormatSupported: true }) }
    }).sendTurn({
      project: value, sessionId, userText: 'Create',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(generated.ok).toBe(true)
    if (!generated.ok) return

    let rejectPersist!: (error: Error) => void
    let persistStarted!: () => void
    const started = new Promise<void>((resolve) => { persistStarted = resolve })
    const send = createAIQuestionnaireOrchestrator({
      persistProject: vi.fn((_project, reason) => {
        if (reason !== 'run-started') return
        persistStarted()
        return new Promise<void>((_resolve, reject) => { rejectPersist = reject })
      }),
      client: { complete: vi.fn() }
    }).sendTurn({
      project: value, sessionId, userText: 'Refine',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    await started
    const backup = vi.fn()
    const apply = applyArtifact({
      project: value, sessionId, artifactId: generated.artifact.artifactId,
      currentProjectPath: 'D:\\study.easyepi', backup, saveAtomic: vi.fn()
    })
    await Promise.resolve()
    expect(backup).not.toHaveBeenCalled()
    rejectPersist(new Error('disk unavailable'))
    await expect(send).resolves.toMatchObject({ ok: false, errorCode: 'AI_PERSIST_FAILED' })
    await expect(apply).resolves.toMatchObject({ applied: true })
    expect(new AISessionRepository(value).get(sessionId)?.state.values.appliedArtifacts).toMatchObject({
      [generated.artifact.artifactId]: generated.artifact.artifactId
    })
  })

  it('rejects stale and structurally forged artifacts before preview or apply', async () => {
    const value = project()
    const generated = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete: vi.fn().mockResolvedValue({ content: validCompletion(), responseFormatSupported: true }) }
    }).sendTurn({
      project: value, sessionId, userText: 'Create',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    value.questionnaire.name = 'Changed concurrently'
    expect(() => previewQuestionnaireArtifact(value, sessionId, generated.artifact.artifactId)).toThrow('AI_ARTIFACT_STALE')
    const backup = vi.fn()
    await expect(applyArtifact({
      project: value,
      sessionId,
      artifactId: generated.artifact.artifactId,
      currentProjectPath: 'D:\\study.easyepi',
      backup,
      saveAtomic: vi.fn()
    })).rejects.toThrow('AI_ARTIFACT_STALE')
    expect(backup).not.toHaveBeenCalled()

    value.questionnaire.name = 'Existing'
    const artifactValue = generated.artifact.value as Record<string, unknown>
    expect(artifactValue.baseQuestionnaire).toEqual({
      name: 'Existing', questions: [], conditionRules: [], keyQuestionIds: []
    })
    artifactValue.diff = {
      metadataChanged: false,
      questions: { added: [], removed: [], modified: [] },
      rulesChanged: false
    }
    value.aiAssistant!.sessions[sessionId]!.artifacts.byId[generated.artifact.artifactId] = generated.artifact
    expect(() => previewQuestionnaireArtifact(value, sessionId, generated.artifact.artifactId)).toThrow('AI_ARTIFACT_INVALID')
  })

  it('rejects stale refinement but allows refining an applied active artifact', async () => {
    const value = project()
    const complete = vi.fn().mockResolvedValue({ content: validCompletion(), responseFormatSupported: true })
    const orchestrator = createAIQuestionnaireOrchestrator({ persistProject: vi.fn(), client: { complete } })
    const generated = await orchestrator.sendTurn({
      project: value, sessionId, userText: 'Create',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    await applyArtifact({
      project: value, sessionId, artifactId: generated.artifact.artifactId,
      currentProjectPath: 'D:\\study.easyepi', backup: vi.fn(), saveAtomic: vi.fn()
    })
    const refined = await orchestrator.sendTurn({
      project: value, sessionId, userText: 'Refine',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(refined.ok).toBe(true)

    value.questionnaire.name = 'Concurrent edit'
    const callsBefore = complete.mock.calls.length
    const stale = await orchestrator.sendTurn({
      project: value, sessionId, userText: 'Refine again',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(stale).toMatchObject({ ok: false, errorCode: 'AI_ARTIFACT_STALE' })
    expect(complete).toHaveBeenCalledTimes(callsBefore)
  })

  it('requires explicit attachments to match the current formal questionnaire', async () => {
    const value = project()
    const complete = vi.fn()
    const result = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(), client: { complete }
    }).sendTurn({
      project: value, sessionId, userText: 'Use this',
      explicitAttachment: { name: 'Other', questions: [], conditionRules: [], keyQuestionIds: [] },
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(result).toMatchObject({ ok: false, errorCode: 'AI_ARTIFACT_STALE' })
    expect(complete).not.toHaveBeenCalled()
  })

  it('explicitly migrates historical sessions with an audit trail', async () => {
    const historical = {
      ...getAiVersionStamp(),
      promptVersion: '1.0.0',
      promptHash: 'sha256:5bb44f2a0062a001aaeaef8fd1b0b7e46183a41c5b34e01df7542121b8de0b0d',
      harnessVersion: '1.0.0'
    }
    const value = project(historical)
    const repository = new AISessionRepository(value)
    const persistProject = vi.fn()
    await migrateSessionVersion({
      project: value, sessionId, targetVersionStamp: getAiVersionStamp(), persistProject
    })
    expect(repository.get(sessionId)?.manifest.versionStamp).toEqual(getAiVersionStamp())
    expect(repository.get(sessionId)?.state.values.versionMigrations).toEqual([
      expect.objectContaining({ from: historical, to: getAiVersionStamp() })
    ])
    expect(persistProject).toHaveBeenCalledWith(value, 'session-migrated')
  })

  it('requires exact normalized artifact drafts and matching base snapshots', async () => {
    const value = project()
    const generated = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete: vi.fn().mockResolvedValue({ content: validCompletion(), responseFormatSupported: true }) }
    }).sendTurn({
      project: value, sessionId, userText: 'Create',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    const stored = value.aiAssistant!.sessions[sessionId]!.artifacts.byId[generated.artifact.artifactId]!
    const original = structuredClone(stored.value) as Record<string, unknown>
    const valueRecord = stored.value as Record<string, unknown>
    expect(valueRecord.baseQuestionnaireHash).toBe(hashAIQuestionnaire(valueRecord.baseQuestionnaire as ProjectData['questionnaire']))

    const draft = valueRecord.draft as { questions: Array<Record<string, unknown>> }
    delete draft.questions[0]!.isKey
    expect(() => previewQuestionnaireArtifact(value, sessionId, stored.artifactId)).toThrow('AI_ARTIFACT_INVALID')

    stored.value = structuredClone(original) as typeof stored.value
    ;(stored.value as { baseQuestionnaire: { name: string } }).baseQuestionnaire.name = 'Tampered'
    expect(() => previewQuestionnaireArtifact(value, sessionId, stored.artifactId)).toThrow('AI_ARTIFACT_INVALID')
  })

  it('clears active runs in memory when completion and failure persistence both fail', async () => {
    const value = project()
    const result = await createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(async (_project, reason) => {
        if (reason !== 'run-started') throw new Error('disk unavailable')
      }),
      client: { complete: vi.fn().mockResolvedValue({ content: validCompletion(), responseFormatSupported: true }) }
    }).sendTurn({
      project: value, sessionId, userText: 'Create',
      config: { baseUrl: 'https://example.test/v1', model: 'model' }
    })
    expect(result).toMatchObject({ ok: false, errorCode: 'AI_PERSIST_FAILED' })
    const session = new AISessionRepository(value).get(sessionId)!
    expect(session).toMatchObject({ state: { status: 'failed' }, temp: { runs: {} } })
    expect(session.state.activeRunId).toBeUndefined()
  })

  it('recovers orphaned runs and assigns immutable project ids', () => {
    const value = project()
    const repository = new AISessionRepository(value)
    repository.upsertRun(sessionId, {
      runId: 'orphan', status: 'running', startedAt: '2026-08-25T00:00:00.000Z',
      versionStamp: getAiVersionStamp()
    })
    repository.updateState(sessionId, { status: 'running', activeRunId: 'orphan' })
    repository.setRunTemp(sessionId, {
      runId: 'orphan', createdAt: '2026-08-25T00:00:00.000Z',
      versionStamp: getAiVersionStamp(), values: {}
    })
    expect(repository.recoverInterruptedRuns()).toMatchObject({ mutated: true })
    expect(repository.get(sessionId)).toMatchObject({ state: { status: 'failed' }, temp: { runs: {} } })
    expect(repository.get(sessionId)?.state.activeRunId).toBeUndefined()

    const legacy = project()
    delete (legacy.meta as unknown as Record<string, unknown>).projectId
    expect(ensureProjectId(legacy, () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true)
    expect((legacy.meta as unknown as Record<string, unknown>).projectId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('maps decisive HTTP statuses without consuming provider error bodies', async () => {
    let bodyRead = false
    const cancel = vi.fn()
    const response = {
      ok: false,
      status: 401,
      headers: new Headers(),
      body: {
        cancel,
        getReader() {
          bodyRead = true
          throw new Error('body must not be read')
        }
      }
    } as unknown as Response
    const client = createOpenAICompatibleClient({ fetch: vi.fn().mockResolvedValue(response) })
    await expect(client.complete({
      baseUrl: 'https://example.test/v1', model: 'model', apiKey: 'secret', messages: []
    })).rejects.toMatchObject({ code: 'AI_AUTH_ERROR' })
    expect(bodyRead).toBe(false)
    expect(cancel).toHaveBeenCalledOnce()

    const oversizedCancel = vi.fn()
    const oversized = createOpenAICompatibleClient({
      maxResponseBytes: 10,
      fetch: vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Headers({ 'content-length': '11' }),
        body: { cancel: oversizedCancel }
      } as unknown as Response)
    })
    await expect(oversized.complete({
      baseUrl: 'https://example.test/v1', model: 'model', messages: []
    })).rejects.toMatchObject({ code: 'AI_RESPONSE_TOO_LARGE' })
    expect(oversizedCancel).toHaveBeenCalledOnce()
  })
})
