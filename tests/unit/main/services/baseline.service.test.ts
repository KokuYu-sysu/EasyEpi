import { describe, expect, it } from 'vitest'

import { BaselineService } from '@main/services/baseline.service'
import type { QuestionDef } from '@shared/types/qnaire'
import type { RecordData } from '@shared/types/record'

function question(patch: Partial<QuestionDef> & Pick<QuestionDef, 'id' | 'variableName' | 'content' | 'type'>): QuestionDef {
  return {
    options: [],
    constraint: { type: 'none' },
    isKey: false,
    allowSkip: true,
    order: 0,
    ...patch
  }
}

const questions: QuestionDef[] = [
  question({ id: 'group', variableName: 'arm', content: '分组', type: 'single_choice', options: [
    { value: 'A', label: '干预组' }, { value: 'B', label: '对照组' }
  ] }),
  question({ id: 'age', variableName: 'age', content: '年龄', type: 'numeric_range', constraint: { type: 'integer' } }),
  question({ id: 'sex', variableName: 'sex', content: '性别', type: 'single_choice', options: [
    { value: 'M', label: '男' }, { value: 'F', label: '女' }
  ] }),
  question({ id: 'note', variableName: 'note', content: '备注', type: 'free_text' })
]

const records: RecordData[] = [
  { id: '1', answers: { group: 'A', age: 10, sex: 'M', note: 'x' }, createdAt: '', updatedAt: '' },
  { id: '2', answers: { group: 'A', age: 12, sex: 'M' }, createdAt: '', updatedAt: '' },
  { id: '3', answers: { group: 'B', age: 20, sex: 'F' }, createdAt: '', updatedAt: '' },
  { id: '4', answers: { group: 'B', age: 22, sex: 'F' }, createdAt: '', updatedAt: '' },
  { id: '5', answers: { group: 'B', age: null, sex: null }, createdAt: '', updatedAt: '' }
]

describe('BaselineService', () => {
  const service = new BaselineService()

  it('calculates total mean and sample standard deviation while excluding missing values', () => {
    const table = service.generateTable({ records, questions, selectedQuestionIds: ['age'] })
    expect(table.headers).toEqual([{ key: 'total', label: '总体 (n=5)' }])
    expect(table.rows).toEqual([
      expect.objectContaining({ variable: 'age', label: '年龄', total: '16.00 ± 5.89' })
    ])
  })

  it('calculates group columns and a deterministic Welch t-test p value', () => {
    const table = service.generateTable({
      records,
      questions,
      selectedQuestionIds: ['age'],
      groupQuestionId: 'group'
    })
    expect(table.headers).toEqual([
      { key: 'total', label: '总体 (n=5)' },
      { key: 'A', label: '干预组 (n=2)' },
      { key: 'B', label: '对照组 (n=3)' }
    ])
    expect(table.rows[0]).toMatchObject({
      groups: { A: '11.00 ± 1.41', B: '21.00 ± 1.41' },
      testUsed: 'Welch t 检验'
    })
    expect(table.rows[0]!.pValue).toBeCloseTo(0.0194, 3)
  })

  it('generates categorical counts using non-missing denominators and chi-square', () => {
    const table = service.generateTable({
      records,
      questions,
      selectedQuestionIds: ['sex'],
      groupQuestionId: 'group'
    })
    expect(table.rows).toEqual([
      expect.objectContaining({
        variable: 'sex:M',
        label: '  男',
        total: '2 (50.0%)',
        groups: { A: '2 (100.0%)', B: '0 (0.0%)' },
        testUsed: 'Pearson χ² 检验'
      }),
      expect.objectContaining({
        variable: 'sex:F',
        label: '  女',
        total: '2 (50.0%)',
        groups: { A: '0 (0.0%)', B: '2 (100.0%)' }
      })
    ])
    expect(table.rows[0]!.pValue).toBeCloseTo(0.0455, 3)
    expect(table.rows[1]!.pValue).toBeUndefined()
  })

  it('skips free-text/date/id-like fields and rejects an invalid group question', () => {
    expect(service.generateTable({ records, questions, selectedQuestionIds: ['note'] }).rows).toEqual([])
    expect(() => service.generateTable({ records, questions, groupQuestionId: 'missing' })).toThrow(
      'GROUP_QUESTION_NOT_FOUND'
    )
  })

  it('does not emit a p value when a test cannot be calculated', () => {
    const sparse = records.slice(0, 2)
    const table = service.generateTable({
      records: sparse,
      questions,
      selectedQuestionIds: ['age'],
      groupQuestionId: 'group'
    })
    expect(table.rows[0]!.pValue).toBeUndefined()
    expect(table.rows[0]!.testUsed).toBeUndefined()
  })

  it('supports manual descriptive-only choices for continuous and categorical variables', () => {
    const table = service.generateTable({
      records,
      questions,
      selectedQuestionIds: ['age', 'sex'],
      groupQuestionId: 'group',
      statisticalMethod: 'manual',
      continuousTest: 'none',
      categoricalTest: 'none'
    })
    expect(table.rows.every((row) => row.pValue === undefined && row.testUsed === undefined)).toBe(true)
  })

  it('accepts numeric strings, ignores non-numeric values, and handles identical groups', () => {
    const stringRecords: RecordData[] = [
      { id: '1', answers: { group: 'A', age: '10' }, createdAt: '', updatedAt: '' },
      { id: '2', answers: { group: 'A', age: '12' }, createdAt: '', updatedAt: '' },
      { id: '3', answers: { group: 'B', age: '10' }, createdAt: '', updatedAt: '' },
      { id: '4', answers: { group: 'B', age: '12' }, createdAt: '', updatedAt: '' },
      { id: '5', answers: { group: 'B', age: 'not-a-number' }, createdAt: '', updatedAt: '' }
    ]
    const table = service.generateTable({ records: stringRecords, questions, selectedQuestionIds: ['age'], groupQuestionId: 'group' })
    expect(table.rows[0]).toMatchObject({ total: '11.00 ± 1.15', pValue: 1, testUsed: 'Welch t 检验' })
  })

  it('handles multi-select arrays, empty denominators, and ungrouped categorical output', () => {
    const multi = question({
      id: 'symptoms', variableName: 'symptoms', content: '症状', type: 'multiple_choice',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
    })
    const multiRecords: RecordData[] = [
      { id: '1', answers: { symptoms: ['a', 'b'] }, createdAt: '', updatedAt: '' },
      { id: '2', answers: { symptoms: null }, createdAt: '', updatedAt: '' }
    ]
    const table = service.generateTable({ records: multiRecords, questions: [multi] })
    expect(table.rows).toMatchObject([
      { variable: 'symptoms:a', total: '1 (100.0%)' },
      { variable: 'symptoms:b', total: '1 (100.0%)' }
    ])

    const empty = service.generateTable({ records: [], questions: [multi] })
    expect(empty.rows[0]!.total).toBe('0 (0.0%)')
  })

  it('tests each multiple-choice option as an independent yes/no table', () => {
    const multi = question({
      id: 'symptoms', variableName: 'symptoms', content: '症状', type: 'multiple_choice',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
    })
    const grouped: RecordData[] = [
      { id: '1', answers: { group: 'A', symptoms: ['a'] }, createdAt: '', updatedAt: '' },
      { id: '2', answers: { group: 'A', symptoms: ['a', 'b'] }, createdAt: '', updatedAt: '' },
      { id: '3', answers: { group: 'B', symptoms: ['b'] }, createdAt: '', updatedAt: '' },
      { id: '4', answers: { group: 'B', symptoms: ['b'] }, createdAt: '', updatedAt: '' }
    ]
    const table = service.generateTable({
      records: grouped,
      questions: [questions[0]!, multi],
      selectedQuestionIds: ['symptoms'],
      groupQuestionId: 'group'
    })
    expect(table.rows[0]).toMatchObject({
      variable: 'symptoms:a',
      groups: { A: '2 (100.0%)', B: '0 (0.0%)' },
      testUsed: 'Pearson χ² 检验'
    })
    expect(table.rows[0]!.pValue).toBeCloseTo(0.0455, 3)
    expect(table.rows[1]).toMatchObject({ variable: 'symptoms:b', testUsed: 'Pearson χ² 检验' })
  })

  it('omits categorical p values for one category or a zero group denominator', () => {
    const oneCategory = question({
      id: 'flag', variableName: 'flag', content: '标志', type: 'single_choice',
      options: [{ value: 'yes', label: '是' }]
    })
    const sparse: RecordData[] = [
      { id: '1', answers: { group: 'A', flag: 'yes' }, createdAt: '', updatedAt: '' },
      { id: '2', answers: { group: 'B', flag: null }, createdAt: '', updatedAt: '' }
    ]
    const table = service.generateTable({
      records: sparse,
      questions: [questions[0]!, oneCategory],
      selectedQuestionIds: ['flag'],
      groupQuestionId: 'group'
    })
    expect(table.rows[0]).toMatchObject({ groups: { A: '1 (100.0%)', B: '0 (0.0%)' } })
    expect(table.rows[0]!.pValue).toBeUndefined()
  })
})
