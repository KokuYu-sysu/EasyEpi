import { describe, expect, it } from 'vitest'

import {
  getAiVersionStamp,
  runQuestionnaireHarness
} from '@main/services/ai-questionnaire.harness'

function envelope(questionnaire: Record<string, unknown>): string {
  return JSON.stringify({
    assistantMessage: 'Draft ready',
    rollingSummary: 'Created a draft',
    questionnaire
  })
}

describe('questionnaire harness trust boundary', () => {
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
})
