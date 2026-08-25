import { describe, expect, it, vi } from 'vitest'

import {
  applyArtifact,
  createAIQuestionnaireOrchestrator
} from '@main/services/ai-questionnaire.orchestrator'
import { getAiVersionStamp } from '@main/services/ai-questionnaire.harness'
import { AISessionRepository } from '@main/services/ai-session.repository'
import { AIClientError } from '@main/services/openai-compatible.client'
import type { ProjectData } from '@shared/types/project'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'

function project(): ProjectData {
  const value: ProjectData = {
    meta: {
      name: 'AI test',
      folderPath: 'must-not-enter-context',
      createdAt: '2026-08-25T00:00:00.000Z',
      lastModifiedAt: '2026-08-25T00:00:00.000Z'
    },
    questionnaire: { name: 'Existing', questions: [], conditionRules: [], keyQuestionIds: [] }
  }
  new AISessionRepository(value, () => sessionId).create(getAiVersionStamp(), 'AI')
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
    const alwaysInvalid = vi.fn().mockResolvedValue({ content: '{"bad":true}', responseFormatSupported: true })
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
    expect(new AISessionRepository(retryProject).get(sessionId)).toMatchObject({
      state: { status: 'failed' },
      temp: { runs: {} }
    })
  })

  it('cancels safely without replacing the active artifact', async () => {
    const value = project()
    new AISessionRepository(value).updateState(sessionId, { values: { activeArtifactId: 'artifact-before' } })
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
      state: { status: 'cancelled', values: { activeArtifactId: 'artifact-before' } },
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
    const request = {
      project: value,
      sessionId,
      artifactId: generated.artifact.artifactId,
      currentProjectPath: 'D:\\study.easyepi',
      backup: vi.fn(() => { calls.push('backup') }),
      saveAtomic: vi.fn(() => { calls.push('save') })
    }
    expect(await applyArtifact(request)).toMatchObject({ applied: true })
    expect(await applyArtifact(request)).toMatchObject({ applied: false })
    expect(calls).toEqual(['backup', 'save'])
    expect(value.questionnaire.derivedVariables).toEqual([
      expect.objectContaining({ variableName: 'bmi' })
    ])
  })
})
