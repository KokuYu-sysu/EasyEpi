import { describe, expect, it } from 'vitest'

import { QualityService } from '@main/services/quality.service'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { RecordData } from '@shared/types/record'

function qnaire(): QuestionnaireDef {
  return {
    name: '测试',
    questions: [
      { id: 'q-age', content: '年龄', variableName: 'age', type: 'numeric_range', options: [], constraint: { type: 'integer', minValue: 0, maxValue: 120 }, isKey: false, allowSkip: false, order: 0 },
      { id: 'q-smoke', content: '是否吸烟', variableName: 'smoke', type: 'single_choice', options: [{ value: '1', label: '是' }, { value: '2', label: '否' }], constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 1 },
      { id: 'q-cig', content: '每日吸烟量', variableName: 'cig', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 2 }
    ],
    conditionRules: [
      {
        id: 'r1',
        sourceQuestionId: 'q-smoke',
        conditions: [{ questionId: 'q-smoke', operator: 'equals', value: '2' }],
        logic: 'AND',
        action: 'skip',
        targetQuestionIds: ['q-cig']
      }
    ],
    keyQuestionIds: ['q-age'],
    derivedVariables: []
  }
}

function record(id: string, answers: Record<string, unknown>): RecordData {
  return { id, answers: answers as Record<string, never>, createdAt: 't', updatedAt: 't' }
}

describe('QualityService.analyze', () => {
  it('computes completeness rates per question and overall', () => {
    const summary = new QualityService().analyze(qnaire(), [
      record('r1', { 'q-age': '30', 'q-smoke': '1' }),
      record('r2', { 'q-age': '40' })
    ])
    expect(summary.records).toBe(2)
    const age = summary.completeness.perQuestion.find((item) => item.variableName === 'age')!
    expect(age.answered).toBe(2)
    expect(age.rate).toBe(1)
    const smoke = summary.completeness.perQuestion.find((item) => item.variableName === 'smoke')!
    expect(smoke.answered).toBe(1)
    expect(smoke.rate).toBe(0.5)
    expect(summary.completeness.overall).toBeCloseTo(0.5, 3)
  })

  it('excludes conditionally hidden questions from the completeness denominator', () => {
    const summary = new QualityService().analyze(qnaire(), [
      record('r1', { 'q-age': '30', 'q-smoke': '2' })
    ])
    const cigarettes = summary.completeness.perQuestion.find((item) => item.variableName === 'cig')!
    expect(cigarettes.answered).toBe(0)
    expect(cigarettes.applicable).toBe(0)
    expect(cigarettes.rate).toBe(1)
    expect(summary.completeness.overall).toBe(1)
  })

  it('flags out-of-range and constraint violations as outliers', () => {
    const summary = new QualityService().analyze(qnaire(), [
      record('r1', { 'q-age': '999' }),
      record('r2', { 'q-age': '30' })
    ])
    expect(summary.outliers).toHaveLength(1)
    expect(summary.outliers[0]!.variableName).toBe('age')
    expect(summary.outliers[0]!.reason).toContain('120')
  })

  it('detects logical contradictions from hidden answers', () => {
    const summary = new QualityService().analyze(qnaire(), [
      record('r1', { 'q-smoke': '2', 'q-cig': '10' })
    ])
    expect(summary.contradictions).toHaveLength(1)
    expect(summary.contradictions[0]!.variableName).toBe('cig')
  })

  it('detects key-based duplicates', () => {
    const summary = new QualityService().analyze(qnaire(), [
      record('r1', { 'q-age': '30', 'q-smoke': '1' }),
      record('r2', { 'q-age': '30', 'q-smoke': '2' })
    ])
    expect(summary.duplicates).toHaveLength(1)
    expect(summary.duplicates[0]!.duplicateOf).toBe('r1')
    expect(summary.duplicates[0]!.identicalAnswers).toBe(false)
    expect(summary.duplicates[0]!.matchSummary).toContain('age=30')
  })

  it('detects exact duplicate answers when no key is set', () => {
    const questionnaire = { ...qnaire(), keyQuestionIds: [] }
    const summary = new QualityService().analyze(questionnaire, [
      record('r1', { 'q-age': '30', 'q-smoke': '1' }),
      record('r2', { 'q-age': '30', 'q-smoke': '1' })
    ])
    expect(summary.duplicates).toHaveLength(1)
    expect(summary.duplicates[0]!.identicalAnswers).toBe(true)
    expect(summary.duplicates[0]!.matchSummary).toBe('完全相同')
  })

  it('treats records as identical even when one carries derived keys', () => {
    const questionnaire = { ...qnaire(), keyQuestionIds: [] }
    const summary = new QualityService().analyze(questionnaire, [
      record('r1', { 'q-age': '30', 'q-smoke': '1' }),
      record('r2', { 'q-age': '30', 'q-smoke': '1', bmi: '24.2' })
    ])
    expect(summary.duplicates).toHaveLength(1)
    expect(summary.duplicates[0]!.identicalAnswers).toBe(true)
  })

  it('returns empty reports for empty records and no questions', () => {
    const empty = new QualityService().analyze(qnaire(), [])
    expect(empty.records).toBe(0)
    expect(empty.completeness.overall).toBe(0)
    expect(empty.outliers).toEqual([])
    expect(empty.contradictions).toEqual([])
    expect(empty.duplicates).toEqual([])
  })
})
