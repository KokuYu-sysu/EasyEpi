import { describe, expect, it } from 'vitest'

import {
  buildQuestionnaireContext,
  getAiVersionStamp,
  migrateAISessionVersion,
  resolveAIRegistryEntry,
  runQuestionnaireHarness,
  stripDerivedVariables
} from '@main/services/ai-questionnaire.harness'
import type { AISessionData } from '@shared/ai-assistant-contract'
import type { QuestionnaireDef } from '@shared/types/qnaire'

function envelope(questionnaire: Record<string, unknown>): string {
  return JSON.stringify({
    assistantMessage: 'Draft ready',
    rollingSummary: 'Created a draft',
    questionnaire
  })
}

describe('questionnaire harness trust boundary', () => {
  it('resolves immutable registered versions and rejects unknown hashes', () => {
    expect(resolveAIRegistryEntry(getAiVersionStamp())).toMatchObject({
      versionStamp: getAiVersionStamp()
    })
    expect(() => resolveAIRegistryEntry({
      ...getAiVersionStamp(),
      promptHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    })).toThrow('AI_VERSION_NOT_REGISTERED')
    expect(() => migrateAISessionVersion(getAiVersionStamp(), {
      ...getAiVersionStamp(), harnessVersion: '2.0.0'
    })).toThrow('AI_MAJOR_VERSION_MIGRATION_REQUIRED')
  })

  it('rejects forbidden fields and invalid references with structured errors', () => {
    const forbidden = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [],
      conditionRules: [],
      keyQuestionIds: [],
      derivedVariables: [{ variableName: 'secret' }]
    }))
    expect(forbidden).toMatchObject({
      ok: false,
      errors: [{ code: 'FORBIDDEN_FIELD', path: '$.questionnaire.derivedVariables' }]
    })

    const brokenReference = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [{
        id: 'q1',
        content: 'Age',
        variableName: 'age',
        type: 'numeric_range',
        options: [],
        constraint: { type: 'integer', minValue: 0, maxValue: 120 },
        isKey: false,
        allowSkip: false,
        order: 8
      }],
      conditionRules: [{
        id: 'r1',
        sourceQuestionId: 'q1',
        conditions: [{ questionId: 'missing', operator: 'equals', value: '1' }],
        logic: 'AND',
        action: 'show',
        targetQuestionIds: ['missing']
      }],
      keyQuestionIds: []
    }))
    expect(brokenReference.ok).toBe(false)
    if (!brokenReference.ok) {
      expect(brokenReference.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
        'UNKNOWN_CONDITION_QUESTION', 'UNKNOWN_TARGET'
      ]))
    }
  })

  it('normalizes order and ids while protecting derived-variable names', () => {
    const text = `\`\`\`json\n${envelope({
      name: 'Study',
      questions: [{
        content: 'Participant code',
        variableName: 'participant_code',
        type: 'free_text',
        isKey: true,
        allowSkip: false,
        order: 99
      }],
      conditionRules: [],
      keyQuestionIds: []
    })}\n\`\`\``
    const mismatch = runQuestionnaireHarness(text)
    expect(mismatch).toMatchObject({ ok: false, errors: [{ code: 'KEY_QUESTION_MISMATCH' }] })

    const protectedName = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [{
        content: 'BMI', variableName: 'bmi', type: 'free_text', isKey: false, allowSkip: false
      }],
      conditionRules: [],
      keyQuestionIds: []
    }), undefined, ['bmi'])
    expect(protectedName).toMatchObject({ ok: false, errors: [{ code: 'DUPLICATE_VARIABLE_NAME' }] })
    expect(getAiVersionStamp().promptHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('never trusts model ids and preserves only semantically stable local ids', () => {
    const base: QuestionnaireDef = {
      name: 'Study',
      questions: [{
        id: 'local-age', content: 'Age', variableName: 'age', type: 'numeric_range',
        options: [], constraint: { type: 'integer' }, isKey: false, allowSkip: false, order: 0
      }, {
        id: 'local-consent', content: 'Consent', variableName: 'consent', type: 'single_choice',
        options: [{ value: '1', label: 'Yes' }], constraint: { type: 'none' },
        isKey: false, allowSkip: false, order: 1
      }],
      conditionRules: [{
        id: 'local-rule', sourceQuestionId: 'local-age',
        conditions: [{ questionId: 'local-age', operator: 'greater_than', value: '17' }],
        logic: 'AND', action: 'show', targetQuestionIds: ['local-consent']
      }],
      keyQuestionIds: []
    }
    const result = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [
        {
          id: 'local-age', content: 'Age in years', variableName: 'age_years', type: 'numeric_range',
          options: [], constraint: { type: 'integer' }, isKey: false, allowSkip: false, order: 4
        },
        {
          id: 'model-consent', content: 'Consent', variableName: 'consent', type: 'single_choice',
          options: [{ value: '1', label: 'Yes' }], constraint: { type: 'none' },
          isKey: false, allowSkip: false, order: 5
        },
        {
          id: 'model-sex', content: 'Sex', variableName: 'sex', type: 'free_text', options: [],
          constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 6
        }
      ],
      conditionRules: [{
        id: 'model-rule', sourceQuestionId: 'local-age',
        conditions: [{ questionId: 'local-age', operator: 'greater_than', value: '17' }],
        logic: 'AND', action: 'show', targetQuestionIds: ['model-consent']
      }],
      keyQuestionIds: []
    }), base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.draft.questions[0]?.id).toBe('local-age')
    expect(result.value.draft.questions[1]?.id).toBe('local-consent')
    expect(result.value.draft.questions[2]?.id).not.toBe('model-sex')
    expect(result.value.draft.conditionRules[0]?.id).toBe('local-rule')
  })

  it('requires the current user turn and rejects non-DTO attachment fields', () => {
    const stamp = getAiVersionStamp()
    const session: AISessionData = {
      manifest: {
        sessionId: '123e4567-e89b-42d3-a456-426614174000', title: 'AI', versionStamp: stamp,
        createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z'
      },
      conversation: {
        messages: [{
          id: 'current', role: 'user', content: 'x'.repeat(200),
          createdAt: '2026-08-25T00:00:00.000Z'
        }],
        attachments: {}
      },
      state: { status: 'idle', runs: {}, values: {} },
      cache: { values: {} }, artifacts: { byId: {} }, temp: { runs: {} }
    }
    expect(() => buildQuestionnaireContext(session, undefined, undefined, 100)).toThrow('AI_CONTEXT_TOO_LARGE')
    session.conversation.messages = [
      { id: 'old-user', role: 'user', content: 'u'.repeat(30_000), createdAt: '2026-08-24T00:00:00.000Z' },
      { id: 'old-assistant', role: 'assistant', content: 'a'.repeat(30_000), createdAt: '2026-08-24T00:01:00.000Z' },
      { id: 'current', role: 'user', content: 'current', createdAt: '2026-08-25T00:00:00.000Z' }
    ]
    const bounded = buildQuestionnaireContext(session, undefined, undefined, 50_000)
    expect(bounded.filter((message) => message.role !== 'system')).toEqual([
      { role: 'user', content: 'current' }
    ])
    expect(() => stripDerivedVariables({
      name: 'Study', questions: [], conditionRules: [], keyQuestionIds: [],
      admin: { password: 'secret' }
    } as unknown as QuestionnaireDef)).toThrow('AI_QUESTIONNAIRE_DTO_INVALID')
    expect(() => stripDerivedVariables({
      name: 'Study', conditionRules: [], keyQuestionIds: [],
      questions: [{
        id: 'q1', content: 'Age', variableName: 'age', type: 'free_text', options: [],
        constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 0,
        responses: ['secret']
      }]
    } as unknown as QuestionnaireDef)).toThrow('AI_QUESTIONNAIRE_DTO_INVALID')
  })

  it('rejects cyclic and conflicting cross-rule dependencies', () => {
    const question = (id: string, variableName: string) => ({
      id, content: variableName, variableName, type: 'free_text', options: [],
      constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 0
    })
    const result = runQuestionnaireHarness(envelope({
      name: 'Study', questions: [question('q1', 'a'), question('q2', 'b')], keyQuestionIds: [],
      conditionRules: [
        {
          id: 'r1', sourceQuestionId: 'q1',
          conditions: [{ questionId: 'q1', operator: 'is_not_empty', value: '' }],
          logic: 'AND', action: 'show', targetQuestionIds: ['q2']
        },
        {
          id: 'r2', sourceQuestionId: 'q2',
          conditions: [{ questionId: 'q2', operator: 'is_not_empty', value: '' }],
          logic: 'AND', action: 'show', targetQuestionIds: ['q1']
        },
        {
          id: 'r3', sourceQuestionId: 'q1',
          conditions: [{ questionId: 'q1', operator: 'is_not_empty', value: '' }],
          logic: 'AND', action: 'skip', targetQuestionIds: ['q2']
        }
      ]
    }))
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'CONDITION_RULE_CYCLE', 'UNREACHABLE_SHOW_CHAIN', 'CONDITION_ACTION_CONFLICT'
    ]))
  })
})
