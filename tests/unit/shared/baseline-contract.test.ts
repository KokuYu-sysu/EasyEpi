import { describe, expect, it } from 'vitest'

import {
  parseBaselineExportRequest,
  parseBaselineGenerateRequest
} from '@shared/baseline-contract'

describe('baseline contract', () => {
  it('normalizes optional question selection and grouping', () => {
    expect(parseBaselineGenerateRequest({
      selectedQuestionIds: [' age ', 'sex'],
      groupQuestionId: ' arm '
    })).toEqual({ selectedQuestionIds: ['age', 'sex'], groupQuestionId: 'arm' })
  })

  it('accepts an empty generation request', () => {
    expect(parseBaselineGenerateRequest({})).toEqual({})
  })

  it('accepts explicit manual statistical methods', () => {
    expect(parseBaselineGenerateRequest({
      statisticalMethod: 'manual',
      continuousTest: 'none',
      categoricalTest: 'chi_square'
    })).toEqual({
      statisticalMethod: 'manual',
      continuousTest: 'none',
      categoricalTest: 'chi_square'
    })
  })

  it('requires a path for export while preserving the statistical request', () => {
    expect(parseBaselineExportRequest({
      outputPath: ' D:/reports/baseline.csv ',
      selectedQuestionIds: ['age'],
      groupQuestionId: 'arm'
    })).toEqual({
      outputPath: 'D:/reports/baseline.csv',
      selectedQuestionIds: ['age'],
      groupQuestionId: 'arm'
    })
  })

  it.each([
    undefined,
    { selectedQuestionIds: [] },
    { selectedQuestionIds: ['age', ' age '] },
    { groupQuestionId: '' },
    { statisticalMethod: 'manual' },
    { statisticalMethod: 'manual', continuousTest: 'anova' },
    { statisticalMethod: 'auto', categoricalTest: 'none' },
    { records: [{ id: 'renderer-plaintext' }] },
    { table: { rows: [] } }
  ])('rejects malformed or renderer-computed generation input %#', (value) => {
    expect(() => parseBaselineGenerateRequest(value)).toThrow('INVALID_BASELINE_REQUEST')
  })

  it.each([
    {},
    { outputPath: '' },
    { outputPath: 'x.csv', table: { rows: [] } }
  ])('rejects malformed or renderer-computed export input %#', (value) => {
    expect(() => parseBaselineExportRequest(value)).toThrow('INVALID_BASELINE_EXPORT_REQUEST')
  })
})
