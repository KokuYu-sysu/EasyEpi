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

function codes(value: unknown): string[] {
  const result = validateQuestionnaireFormat(value)
  if (result.ok) throw new Error('expected rejection')
  return result.issues.map(({ code }) => code)
}

describe('shared questionnaire format validator semantic rules', () => {
  it('rejects questionnaire-level shape failures', () => {
    expect(codes(questionnaire({ name: '' }))).toContain('EMPTY_NAME')
    expect(codes({ ...questionnaire(), name: 7 })).toContain('INVALID_TYPE')
    expect(codes({ ...questionnaire(), questions: [] , name: 'x'.repeat(201) })).toContain('INVALID_TYPE')
    expect(codes({ ...questionnaire(), conditionRules: 'no' })).toContain('INVALID_DRAFT')
    expect(codes({ ...questionnaire(), keyQuestionIds: 'no' })).toContain('INVALID_DRAFT')
    expect(codes({ ...questionnaire(), keyQuestionIds: [7] })).toContain('INVALID_TYPE')
    expect(codes({ ...questionnaire(), questions: [null] })).toContain('INVALID_TYPE')
    expect(codes({ ...questionnaire(), questions: ['x'] })).toContain('INVALID_TYPE')
  })

  it.each([
    ['empty content', { content: '' }, 'EMPTY_QUESTION'],
    ['oversized content', { content: 'x'.repeat(10_001) }, 'QUESTION_TOO_LONG'],
    ['bad variable name', { variableName: '1bad' }, 'INVALID_VARIABLE_NAME'],
    ['bad question type', { type: 'radio' }, 'INVALID_QUESTION_TYPE'],
    ['bad constraint type', { constraint: { type: 'unsupported' } }, 'INVALID_CONSTRAINT_TYPE'],
    ['missing fixed length', { type: 'fixed_length' as const, constraint: { type: 'none' as const } }, 'MISSING_FIXED_LENGTH']
  ])('rejects a question with %s', (_name, override, code) => {
    expect(codes(questionnaire({
      questions: [question(override as Partial<QuestionDef>)]
    }))).toContain(code)
  })

  it('rejects option problems', () => {
    expect(codes(questionnaire({
      questions: [question({
        type: 'single_choice', options: [{ value: '', label: 'Red' }], constraint: { type: 'none' }
      })]
    }))).toContain('EMPTY_OPTION')

    expect(codes(questionnaire({
      questions: [question({
        type: 'single_choice',
        options: [{ value: 'a'.repeat(1_001), label: 'Red' }],
        constraint: { type: 'none' }
      })]
    }))).toContain('OPTION_TOO_LONG')

    expect(codes(questionnaire({
      questions: [question({ type: 'single_choice', options: [], constraint: { type: 'none' } })]
    }))).toContain('MISSING_OPTIONS')

    expect(codes(questionnaire({
      questions: [question({ options: [{ value: 'red', label: 'Red' }] })]
    }))).toContain('UNEXPECTED_OPTIONS')

    expect(codes(questionnaire({
      questions: [question({
        type: 'single_choice',
        options: [{ value: 'red', label: 'Red' }, null as unknown as { value: string; label: string }],
        constraint: { type: 'none' }
      })]
    }))).toContain('INVALID_TYPE')
  })

  it('rejects constraint problems', () => {
    const withConstraint = (constraint: unknown): string[] => codes(questionnaire({
      questions: [question({ constraint: constraint as QuestionDef['constraint'] })]
    }))

    expect(withConstraint({ type: 'alphanumeric', fixedLength: -1 })).toContain('INVALID_FIXED_LENGTH')
    // A non-finite bound is caught by the structural pass, which is stricter than the harness's
    // semantic INVALID_NUMBER; either way the draft is rejected before it can be applied.
    expect(withConstraint({ type: 'integer', minValue: Number.NaN })).toContain('INVALID_TYPE')
    expect(withConstraint({ type: 'decimal', minValue: 10, maxValue: 1 })).toContain('INVALID_RANGE')
    expect(withConstraint({ type: 'decimal', step: 0 })).toContain('INVALID_STEP')
    expect(withConstraint({ type: 'regex' })).toContain('MISSING_REGEX')
    expect(withConstraint({ type: 'regex', regexPattern: 'x', regexFlags: 'z' })).toContain('INVALID_REGEX')
    expect(withConstraint({ type: 'regex', regexPattern: 'x'.repeat(1_001) })).toContain('INVALID_REGEX')
    expect(withConstraint({ type: 'none', regexPattern: 'x' })).toContain('UNEXPECTED_REGEX')
    expect(withConstraint({ type: 'none', extra: 1 })).toContain('INVALID_TYPE')
    expect(withConstraint({ type: 'none', fixedLength: 'x' })).toContain('INVALID_TYPE')
    expect(withConstraint({ type: 'none', minValue: 'x' })).toContain('INVALID_TYPE')
    expect(withConstraint({ type: 'none', regexFlags: 1 })).toContain('INVALID_TYPE')
    expect(withConstraint('none')).toContain('INVALID_TYPE')
  })

  it('rejects default and skip values that contradict the question', () => {
    expect(codes(questionnaire({
      questions: [question({ defaultValue: 'not-a-number' })]
    }))).toContain('INVALID_DEFAULT_VALUE')

    expect(codes(questionnaire({
      questions: [question({ skipValue: '-9', allowSkip: false })]
    }))).toContain('UNEXPECTED_SKIP_VALUE')

    expect(codes(questionnaire({
      questions: [question({ skipValue: 5 as unknown as string })]
    }))).toContain('INVALID_TYPE')
  })

  it('rejects key question list mismatches', () => {
    expect(codes(questionnaire({ keyQuestionIds: ['q1'] }))).toContain('KEY_QUESTION_MISMATCH')
    expect(codes(questionnaire({
      questions: [question({ isKey: true })],
      keyQuestionIds: []
    }))).toContain('KEY_QUESTION_MISMATCH')
    expect(codes(questionnaire({
      questions: [question({ isKey: true })],
      keyQuestionIds: ['q1', 'q1']
    }))).toContain('KEY_QUESTION_MISMATCH')
  })

  it('rejects duplicate question ids and duplicate variable names', () => {
    expect(codes(questionnaire({
      questions: [question({ id: 'q1' }), question({ id: 'q1', order: 1 })]
    }))).toContain('DUPLICATE_QUESTION_ID')
    expect(codes(questionnaire({
      questions: [question(), question({ id: 'q2', order: 1 })]
    }))).toContain('DUPLICATE_VARIABLE_NAME')
  })
})

describe('shared questionnaire format validator rule graph', () => {
  function rule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'r1',
      sourceQuestionId: 'q1',
      conditions: [{ questionId: 'q1', operator: 'equals', value: 'yes' }],
      logic: 'AND',
      action: 'skip',
      targetQuestionIds: ['q2'],
      ...overrides
    }
  }

  function twoQuestions(): QuestionnaireDef {
    return questionnaire({
      questions: [
        question({
          id: 'q1', variableName: 'q1', content: 'Answer', type: 'single_choice',
          options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
          constraint: { type: 'none' }
        }),
        question({ id: 'q2', variableName: 'q2', order: 1 })
      ]
    })
  }

  it.each([
    ['a malformed condition rule', { conditions: 'x' }, 'INVALID_TYPE'],
    ['an undeclared rule field', { extra: 1 }, 'FORBIDDEN_FIELD'],
    ['an invalid rule id', { id: '-bad' }, 'INVALID_RULE_ID'],
    ['an invalid source id', { sourceQuestionId: '' }, 'INVALID_TYPE'],
    ['an invalid logic value', { logic: 'XOR' }, 'INVALID_LOGIC'],
    ['an invalid action', { action: 'hide' }, 'INVALID_ACTION'],
    ['no conditions', { conditions: [] }, 'EMPTY_CONDITIONS'],
    ['an unknown condition question', { conditions: [{ questionId: 'zz', operator: 'equals', value: 'yes' }] }, 'UNKNOWN_CONDITION_QUESTION'],
    ['an invalid operator', { conditions: [{ questionId: 'q1', operator: 'matches', value: 'yes' }] }, 'INVALID_OPERATOR'],
    ['a condition value on an empty operator', { conditions: [{ questionId: 'q1', operator: 'is_empty', value: 'yes' }] }, 'UNEXPECTED_CONDITION_VALUE'],
    ['a blank condition value', { conditions: [{ questionId: 'q1', operator: 'equals', value: '  ' }] }, 'EMPTY_CONDITION_VALUE'],
    ['a non-numeric comparison value', { conditions: [{ questionId: 'q2', operator: 'greater_than', value: 'lots' }] }, 'INVALID_CONDITION_VALUE'],
    ['an inapplicable option value', { conditions: [{ questionId: 'q1', operator: 'equals', value: 'maybe' }] }, 'INVALID_CONDITION_VALUE'],
    ['no targets', { targetQuestionIds: [] }, 'EMPTY_TARGETS'],
    ['duplicate targets', { targetQuestionIds: ['q2', 'q2'] }, 'DUPLICATE_TARGET'],
    ['an unknown target', { targetQuestionIds: ['zz'] }, 'UNKNOWN_TARGET'],
    ['a self-referential target', { targetQuestionIds: ['q1'] }, 'SELF_REFERENTIAL_RULE']
  ])('rejects %s', (_name, override, code) => {
    expect(codes({
      ...twoQuestions(),
      conditionRules: [rule(override)]
    })).toContain(code)
  })

  it('rejects conflicting actions, cycles, and unreachable show chains', () => {
    expect(codes({
      ...twoQuestions(),
      conditionRules: [rule({ action: 'skip' }), rule({ id: 'r2', action: 'require' })]
    })).toContain('CONDITION_ACTION_CONFLICT')

    expect(codes({
      ...twoQuestions(),
      conditionRules: [
        rule({ conditions: [{ questionId: 'q2', operator: 'equals', value: '1' }], targetQuestionIds: ['q1'], action: 'require' }),
        rule({ id: 'r2', conditions: [{ questionId: 'q1', operator: 'equals', value: 'yes' }], targetQuestionIds: ['q2'], action: 'require' })
      ]
    })).toContain('CONDITION_RULE_CYCLE')

    // Every question is show-controlled and no show rule can ever trigger, so nothing is reachable.
    expect(codes({
      ...twoQuestions(),
      conditionRules: [
        rule({ conditions: [{ questionId: 'q1', operator: 'equals', value: 'yes' }], action: 'show', targetQuestionIds: ['q2'] }),
        rule({ id: 'r2', conditions: [{ questionId: 'q2', operator: 'is_not_empty', value: '' }], action: 'show', targetQuestionIds: ['q1'] })
      ]
    })).toContain('UNREACHABLE_SHOW_CHAIN')
  })
})

describe('shared questionnaire format validator limits', () => {
  it('enforces every collection and complexity bound', () => {
    expect(codes(questionnaire({
      questions: Array.from({ length: 501 }, (_, index) =>
        question({ id: `q${index}`, variableName: `v${index}`, order: index }))
    }))).toContain('AI_CANDIDATE_LIMIT_EXCEEDED')

    expect(codes(questionnaire({
      questions: [question({
        type: 'single_choice',
        options: Array.from({ length: 501 }, (_, index) => ({ value: `v${index}`, label: `L${index}` })),
        constraint: { type: 'none' }
      })]
    }))).toContain('AI_CANDIDATE_LIMIT_EXCEEDED')

    expect(codes({
      ...questionnaire(),
      conditionRules: Array.from({ length: 1_001 }, (_, index) => ({
        id: `r${index}`, sourceQuestionId: 'q1',
        conditions: [{ questionId: 'q1', operator: 'is_not_empty', value: '' }],
        logic: 'AND', action: 'require', targetQuestionIds: []
      }))
    })).toContain('AI_CANDIDATE_LIMIT_EXCEEDED')

    expect(codes({
      ...questionnaire(),
      conditionRules: [{
        id: 'r1', sourceQuestionId: 'q1',
        conditions: Array.from({ length: 101 }, () => ({ questionId: 'q1', operator: 'is_not_empty', value: '' })),
        logic: 'AND', action: 'require', targetQuestionIds: ['q1']
      }]
    })).toContain('AI_CANDIDATE_LIMIT_EXCEEDED')

    expect(codes({
      ...questionnaire(),
      conditionRules: [{
        id: 'r1', sourceQuestionId: 'q1',
        conditions: [{ questionId: 'q1', operator: 'is_not_empty', value: '' }],
        logic: 'AND', action: 'require',
        targetQuestionIds: Array.from({ length: 501 }, () => 'q1')
      }]
    })).toContain('AI_CANDIDATE_LIMIT_EXCEEDED')
  })

  it('caps the number of reported issues', () => {
    const result = validateQuestionnaireFormat(questionnaire({
      questions: Array.from({ length: 400 }, (_, index) => question({
        id: 'same', variableName: 'value', content: '', order: index + 5
      }))
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toHaveLength(QUESTIONNAIRE_FORMAT_LIMITS.maxIssues)
  })
})
