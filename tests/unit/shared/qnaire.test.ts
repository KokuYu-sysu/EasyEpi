import { describe, it, expect } from 'vitest'

import {
  evaluateConditions,
  getVisibleQuestions,
  isQuestionType,
  isConstraintType,
  isConditionOperator,
  type QuestionDef,
  type QuestionnaireDef,
  type ConditionRule
} from '../../../src/shared/types/qnaire'

describe('qnaire types', () => {
  describe('type guards', () => {
    it('isQuestionType validates question types', () => {
      expect(isQuestionType('single_choice')).toBe(true)
      expect(isQuestionType('multiple_choice')).toBe(true)
      expect(isQuestionType('free_text')).toBe(true)
      expect(isQuestionType('numeric_range')).toBe(true)
      expect(isQuestionType('date')).toBe(true)
      expect(isQuestionType('invalid')).toBe(false)
    })

    it('isConstraintType validates constraint types', () => {
      expect(isConstraintType('none')).toBe(true)
      expect(isConstraintType('integer')).toBe(true)
      expect(isConstraintType('regex')).toBe(true)
      expect(isConstraintType('invalid')).toBe(false)
    })

    it('isConditionOperator validates operators', () => {
      expect(isConditionOperator('equals')).toBe(true)
      expect(isConditionOperator('is_empty')).toBe(true)
      expect(isConditionOperator('invalid')).toBe(false)
    })
  })

  describe('evaluateConditions', () => {
    it('returns true for empty conditions', () => {
      expect(evaluateConditions([], 'AND', {})).toBe(true)
    })

    it('evaluates equals condition', () => {
      const conditions = [{ questionId: 'q1', operator: 'equals' as const, value: 'yes' }]
      expect(evaluateConditions(conditions, 'AND', { q1: 'yes' })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: 'no' })).toBe(false)
    })

    it('evaluates not_equals condition', () => {
      const conditions = [{ questionId: 'q1', operator: 'not_equals' as const, value: 'yes' }]
      expect(evaluateConditions(conditions, 'AND', { q1: 'no' })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: 'yes' })).toBe(false)
    })

    it('evaluates greater_than condition', () => {
      const conditions = [{ questionId: 'q1', operator: 'greater_than' as const, value: '18' }]
      expect(evaluateConditions(conditions, 'AND', { q1: 25 })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: 15 })).toBe(false)
    })

    it('evaluates less_than condition', () => {
      const conditions = [{ questionId: 'q1', operator: 'less_than' as const, value: '18' }]
      expect(evaluateConditions(conditions, 'AND', { q1: 15 })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: 25 })).toBe(false)
    })

    it('evaluates contains condition', () => {
      const conditions = [{ questionId: 'q1', operator: 'contains' as const, value: 'head' }]
      expect(evaluateConditions(conditions, 'AND', { q1: 'headache' })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: 'fever' })).toBe(false)
    })

    it('evaluates is_empty condition', () => {
      const conditions = [{ questionId: 'q1', operator: 'is_empty' as const, value: '' }]
      expect(evaluateConditions(conditions, 'AND', { q1: '' })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: undefined })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: 'something' })).toBe(false)
    })

    it('evaluates is_not_empty condition', () => {
      const conditions = [{ questionId: 'q1', operator: 'is_not_empty' as const, value: '' }]
      expect(evaluateConditions(conditions, 'AND', { q1: 'something' })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: '' })).toBe(false)
    })

    it('combines conditions with AND logic', () => {
      const conditions = [
        { questionId: 'q1', operator: 'equals' as const, value: 'yes' },
        { questionId: 'q2', operator: 'greater_than' as const, value: '18' }
      ]
      expect(evaluateConditions(conditions, 'AND', { q1: 'yes', q2: 25 })).toBe(true)
      expect(evaluateConditions(conditions, 'AND', { q1: 'yes', q2: 15 })).toBe(false)
      expect(evaluateConditions(conditions, 'AND', { q1: 'no', q2: 25 })).toBe(false)
    })

    it('combines conditions with OR logic', () => {
      const conditions = [
        { questionId: 'q1', operator: 'equals' as const, value: 'yes' },
        { questionId: 'q2', operator: 'greater_than' as const, value: '18' }
      ]
      expect(evaluateConditions(conditions, 'OR', { q1: 'no', q2: 25 })).toBe(true)
      expect(evaluateConditions(conditions, 'OR', { q1: 'yes', q2: 15 })).toBe(true)
      expect(evaluateConditions(conditions, 'OR', { q1: 'no', q2: 15 })).toBe(false)
    })
  })

  describe('getVisibleQuestions', () => {
    const q1: QuestionDef = {
      id: 'q1',
      content: 'Q1',
      variableName: 'q1',
      type: 'single_choice',
      options: [],
      constraint: { type: 'none' },
      isKey: false,
      allowSkip: false,
      order: 0
    }
    const q2: QuestionDef = { ...q1, id: 'q2', variableName: 'q2', content: 'Q2', order: 1 }
    const q3: QuestionDef = { ...q1, id: 'q3', variableName: 'q3', content: 'Q3', order: 2 }

    it('returns all questions when no rules', () => {
      const qnaire: QuestionnaireDef = {
        name: 'Test',
        questions: [q1, q2, q3],
        conditionRules: [],
        keyQuestionIds: []
      }
      expect(getVisibleQuestions(qnaire, {})).toEqual([q1, q2, q3])
    })

    it('hides questions matching skip rules', () => {
      const rule: ConditionRule = {
        id: 'r1',
        sourceQuestionId: 'q1',
        conditions: [{ questionId: 'q1', operator: 'equals', value: 'no' }],
        logic: 'AND',
        action: 'skip',
        targetQuestionIds: ['q2']
      }
      const qnaire: QuestionnaireDef = {
        name: 'Test',
        questions: [q1, q2, q3],
        conditionRules: [rule],
        keyQuestionIds: []
      }
      expect(getVisibleQuestions(qnaire, { q1: 'no' })).toEqual([q1, q3])
      expect(getVisibleQuestions(qnaire, { q1: 'yes' })).toEqual([q1, q2, q3])
    })

    it('maintains question order', () => {
      const qnaire: QuestionnaireDef = {
        name: 'Test',
        questions: [q3, q1, q2],
        conditionRules: [],
        keyQuestionIds: []
      }
      const visible = getVisibleQuestions(qnaire, {})
      expect(visible.map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
    })
  })
})
