import { describe, expect, it } from 'vitest'

import { QUESTIONNAIRE_FORMAT_LIMITS, validateQuestionnaireFormat } from '@shared/questionnaire-format'
import type { QuestionDef, QuestionnaireDef } from '@shared/types/qnaire'

/**
 * `validateQuestionnaireFormat` is the shared structural contract that both the renderer and the
 * main-process orchestrator apply to a generated questionnaire draft. The main-process harness
 * normalizes several fields before it validates (most importantly it rewrites `order` to the array
 * index and drops undeclared fields), so this module is the only place where the raw envelope shape
 * is judged. The orchestrator's pre-persistence gate relies on exactly that: a draft the harness
 * accepted must still be rejected here before an artifact can be stored.
 */
function question(overrides: Partial<QuestionDef> = {}): QuestionDef {
  return {
    id: 'q1',
    content: 'Age',
    variableName: 'age',
    type: 'numeric_range',
    options: [],
    constraint: { type: 'integer', minValue: 0, maxValue: 120 },
    isKey: false,
    allowSkip: false,
    order: 0,
    ...overrides
  }
}

function questionnaire(overrides: Partial<QuestionnaireDef> = {}): QuestionnaireDef {
  return {
    name: 'Study',
    questions: [question()],
    conditionRules: [],
    keyQuestionIds: [],
    ...overrides
  }
}

describe('shared questionnaire format validator', () => {
  it('accepts and clones the draft shape the main-process harness produces', () => {
    const draft = questionnaire()
    const result = validateQuestionnaireFormat(draft)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.questionnaire).toEqual(draft)
    expect(result.questionnaire).not.toBe(draft)
    expect(result.questionnaire.questions[0]).not.toBe(draft.questions[0])
    // Null-ish optional fields are dropped from the normalized clone rather than kept as null.
    expect(result.questionnaire).not.toHaveProperty('description')
    expect(result.questionnaire.questions[0]).not.toHaveProperty('defaultValue')
    expect(result.questionnaire.questions[0]).not.toHaveProperty('skipValue')
  })

  it('rejects a question whose order is not its array index', () => {
    // `runQuestionnaireHarness` normalizes `order` to the array index, so a draft like this can
    // never come out of the harness; the shared module is what refuses it.
    const result = validateQuestionnaireFormat(questionnaire({
      questions: [question({ order: 1 })]
    }))

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: 'INVALID_ORDER',
        path: '$.questions[0].order'
      })]
    })

    const swapped = validateQuestionnaireFormat(questionnaire({
      questions: [
        question({ order: 1, variableName: 'first' }),
        question({ id: 'q2', variableName: 'second', order: 0 })
      ]
    }))
    expect(swapped.ok).toBe(false)
    if (swapped.ok) return
    expect(swapped.issues.map(({ code }) => code)).toEqual(['INVALID_ORDER', 'INVALID_ORDER'])
  })

  it('rejects a question variable name owned by a derived variable', () => {
    const result = validateQuestionnaireFormat(questionnaire(), {
      protectedVariableNames: ['age']
    })

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: 'DUPLICATE_VARIABLE_NAME',
        path: '$.questions[0].variableName'
      })]
    })
  })

  it('reports undeclared fields against the configured path root', () => {
    const result = validateQuestionnaireFormat(
      { ...questionnaire(), derivedVariables: [] },
      { root: '$.draft' }
    )

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: 'FORBIDDEN_FIELD',
        path: '$.draft.derivedVariables'
      })]
    })
  })

  it('rejects semantic violations the harness also checks, such as duplicate option values', () => {
    const result = validateQuestionnaireFormat(questionnaire({
      questions: [question({
        content: 'Colour',
        variableName: 'colour',
        type: 'single_choice',
        options: [
          { value: 'red', label: 'Red' },
          { value: 'red', label: 'Crimson' }
        ],
        constraint: { type: 'none' },
        isKey: true
      })],
      keyQuestionIds: ['q1']
    }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_OPTION_VALUE', path: '$.questions[0].options[1].value' })
    ])
  })

  it('reports structural failures as issues instead of throwing on hostile input', () => {
    const hostile: unknown[] = [
      null,
      { name: 7, questions: 'nope', conditionRules: {}, keyQuestionIds: null },
      { name: 'Study', questions: [question({ id: 7 } as unknown as Partial<QuestionDef>)], conditionRules: [], keyQuestionIds: [] },
      { name: 'Study', questions: [], conditionRules: [], keyQuestionIds: [], description: 5 }
    ]

    for (const value of hostile) {
      const result = validateQuestionnaireFormat(value)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues.length).toBeLessThanOrEqual(QUESTIONNAIRE_FORMAT_LIMITS.maxIssues)
    }
  })
})
