import { describe, expect, it } from 'vitest'

import { parseExportCsvRequest } from '@shared/export-contract'

describe('export contract', () => {
  it('normalizes a selected-record export request', () => {
    expect(parseExportCsvRequest({
      outputPath: ' D:/reports/study.csv ',
      encoding: 'dummy',
      dummyReference: 'last',
      scope: 'selected',
      selectedIds: [' record-2 ', 'record-1']
    })).toEqual({
      outputPath: 'D:/reports/study.csv',
      encoding: 'dummy',
      dummyReference: 'last',
      scope: 'selected',
      selectedIds: ['record-2', 'record-1']
    })
  })

  it('accepts an all-record export without renderer-owned data', () => {
    expect(parseExportCsvRequest({
      outputPath: 'D:/reports/study.csv',
      encoding: 'multi_category',
      scope: 'all'
    })).toEqual({
      outputPath: 'D:/reports/study.csv',
      encoding: 'multi_category',
      scope: 'all'
    })
  })

  it('accepts an explicit GBK file encoding', () => {
    expect(parseExportCsvRequest({
      outputPath: 'D:/reports/study.csv',
      encoding: 'one_hot',
      fileEncoding: 'gbk',
      scope: 'all'
    })).toMatchObject({ fileEncoding: 'gbk' })
  })

  it.each([
    undefined,
    { outputPath: '', encoding: 'multi_category', scope: 'all' },
    { outputPath: 'x.csv', encoding: 'unknown', scope: 'all' },
    { outputPath: 'x.csv', encoding: 'dummy', fileEncoding: 'big5', scope: 'all' },
    { outputPath: 'x.csv', encoding: 'dummy', dummyReference: 'middle', scope: 'all' },
    { outputPath: 'x.csv', encoding: 'multi_category', scope: 'selected', selectedIds: [] },
    { outputPath: 'x.csv', encoding: 'multi_category', scope: 'selected', selectedIds: ['a', ' a '] },
    { outputPath: 'x.csv', encoding: 'multi_category', scope: 'all', selectedIds: ['a'] },
    {
      outputPath: 'x.csv',
      encoding: 'multi_category',
      scope: 'all',
      records: [{ id: 'renderer-plaintext' }]
    }
  ])('rejects malformed or over-privileged input %#', (value) => {
    expect(() => parseExportCsvRequest(value)).toThrow('INVALID_EXPORT_REQUEST')
  })
})
