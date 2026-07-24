import { describe, it, expect } from 'vitest'

import {
  createQuestionnaireDef,
  createQuestion,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  createConditionRule,
  addConditionRule,
  deleteConditionRule,
  setKeyQuestion,
  detectConflicts
} from '../../../../src/main/services/qnaire.service'

describe('QnaireService', () => {
  it('creates an empty questionnaire def', () => {
    const q = createQuestionnaireDef('Test')
    expect(q.name).toBe('Test')
    expect(q.questions).toEqual([])
    expect(q.conditionRules).toEqual([])
    expect(q.keyQuestionIds).toEqual([])
  })

  it('creates a question with defaults', () => {
    const q = createQuestion('Your name?', 'name', 'free_text', 0)
    expect(q.content).toBe('Your name?')
    expect(q.variableName).toBe('name')
    expect(q.type).toBe('free_text')
    expect(q.order).toBe(0)
    expect(q.isKey).toBe(false)
    expect(q.allowSkip).toBe(false)
    expect(q.id).toBeTruthy()
  })

  it('adds a question to questionnaire', () => {
    let q = createQuestionnaireDef('Test')
    const question = createQuestion('Q1', 'q1', 'free_text', 0)
    q = addQuestion(q, question)
    expect(q.questions.length).toBe(1)
    expect(q.questions[0]!.id).toBe(question.id)
  })

  it('rejects duplicate variable names on add', () => {
    let q = createQuestionnaireDef('Test')
    q = addQuestion(q, createQuestion('Q1', 'q1', 'free_text', 0))
    expect(() => addQuestion(q, createQuestion('Q2', 'q1', 'free_text', 1))).toThrow(
      'DUPLICATE_VARIABLE_NAME'
    )
  })

  it('updates a question', () => {
    let q = createQuestionnaireDef('Test')
    const question = createQuestion('Q1', 'q1', 'free_text', 0)
    q = addQuestion(q, question)
    q = updateQuestion(q, question.id, { content: 'Updated Q1' })
    expect(q.questions[0]!.content).toBe('Updated Q1')
  })

  it('rejects update with duplicate variable name', () => {
    let q = createQuestionnaireDef('Test')
    const q1 = createQuestion('Q1', 'q1', 'free_text', 0)
    const q2 = createQuestion('Q2', 'q2', 'free_text', 1)
    q = addQuestion(q, q1)
    q = addQuestion(q, q2)
    expect(() => updateQuestion(q, q2.id, { variableName: 'q1' })).toThrow(
      'DUPLICATE_VARIABLE_NAME'
    )
  })

  it('allows update with same variable name (no change)', () => {
    let q = createQuestionnaireDef('Test')
    const question = createQuestion('Q1', 'q1', 'free_text', 0)
    q = addQuestion(q, question)
    q = updateQuestion(q, question.id, { content: 'Updated' })
    expect(q.questions[0]!.variableName).toBe('q1')
  })

  it('deletes a question', () => {
    let q = createQuestionnaireDef('Test')
    const question = createQuestion('Q1', 'q1', 'free_text', 0)
    q = addQuestion(q, question)
    q = deleteQuestion(q, question.id)
    expect(q.questions.length).toBe(0)
  })

  it('deletes condition rules referencing the deleted question', () => {
    let q = createQuestionnaireDef('Test')
    const q1 = createQuestion('Q1', 'q1', 'single_choice', 0)
    const q2 = createQuestion('Q2', 'q2', 'free_text', 1)
    const q3 = createQuestion('Q3', 'q3', 'free_text', 2)
    q = addQuestion(q, q1)
    q = addQuestion(q, q2)
    q = addQuestion(q, q3)

    const rule = createConditionRule(
      q1.id,
      [{ questionId: q1.id, operator: 'equals', value: '1' }],
      'AND',
      'skip',
      [q2.id]
    )
    q = addConditionRule(q, rule)
    expect(q.conditionRules.length).toBe(1)

    q = deleteQuestion(q, q1.id)
    expect(q.conditionRules.length).toBe(0)
  })

  it('reorders questions', () => {
    let q = createQuestionnaireDef('Test')
    const q1 = createQuestion('Q1', 'q1', 'free_text', 0)
    const q2 = createQuestion('Q2', 'q2', 'free_text', 1)
    const q3 = createQuestion('Q3', 'q3', 'free_text', 2)
    q = addQuestion(q, q1)
    q = addQuestion(q, q2)
    q = addQuestion(q, q3)

    q = reorderQuestions(q, [q3.id, q1.id, q2.id])
    expect(q.questions[0]!.id).toBe(q3.id)
    expect(q.questions[0]!.order).toBe(0)
    expect(q.questions[1]!.id).toBe(q1.id)
    expect(q.questions[1]!.order).toBe(1)
    expect(q.questions[2]!.id).toBe(q2.id)
    expect(q.questions[2]!.order).toBe(2)
  })

  it('adds and deletes condition rules', () => {
    let q = createQuestionnaireDef('Test')
    const q1 = createQuestion('Q1', 'q1', 'single_choice', 0)
    const q2 = createQuestion('Q2', 'q2', 'free_text', 1)
    q = addQuestion(q, q1)
    q = addQuestion(q, q2)

    const rule = createConditionRule(
      q1.id,
      [{ questionId: q1.id, operator: 'equals', value: '1' }],
      'AND',
      'skip',
      [q2.id]
    )
    q = addConditionRule(q, rule)
    expect(q.conditionRules.length).toBe(1)
    expect(q.conditionRules[0]!.sourceQuestionId).toBe(q1.id)

    q = deleteConditionRule(q, rule.id)
    expect(q.conditionRules.length).toBe(0)
  })

  it('sets and unsets key questions', () => {
    let q = createQuestionnaireDef('Test')
    const question = createQuestion('Q1', 'q1', 'free_text', 0)
    q = addQuestion(q, question)

    q = setKeyQuestion(q, question.id, true)
    expect(q.keyQuestionIds).toContain(question.id)
    expect(q.questions[0]!.isKey).toBe(false) // isKey on question is separate

    q = setKeyQuestion(q, question.id, false)
    expect(q.keyQuestionIds).not.toContain(question.id)
  })

  it('detects skip/require conflicts', () => {
    let q = createQuestionnaireDef('Test')
    const q1 = createQuestion('Q1', 'q1', 'single_choice', 0)
    const q2 = createQuestion('Q2', 'q2', 'free_text', 1)
    q = addQuestion(q, q1)
    q = addQuestion(q, q2)

    const rule1 = createConditionRule(
      q1.id,
      [{ questionId: q1.id, operator: 'equals', value: '1' }],
      'AND',
      'skip',
      [q2.id]
    )
    const rule2 = createConditionRule(
      q1.id,
      [{ questionId: q1.id, operator: 'equals', value: '2' }],
      'AND',
      'require',
      [q2.id]
    )
    q = addConditionRule(q, rule1)
    q = addConditionRule(q, rule2)

    const conflicts = detectConflicts(q)
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]).toContain('q2')
  })
})
