import { describe, expect, it } from 'vitest'

import {
  ALL_DOUBLE_ENTRY_CHANNELS,
  DOUBLE_ENTRY_IMPORT_CHANNEL,
  parseDoubleEntryImportRequest,
  parseDoubleEntryCompareRequest
} from '@shared/double-entry-contract'

describe('double entry contract', () => {
  it('lists both channels', () => {
    expect(ALL_DOUBLE_ENTRY_CHANNELS).toEqual([
      DOUBLE_ENTRY_IMPORT_CHANNEL,
      'doubleEntry:compare'
    ])
    expect(ALL_DOUBLE_ENTRY_CHANNELS).toHaveLength(2)
  })

  it('parses import requests', () => {
    expect(parseDoubleEntryImportRequest({ filePath: 'C:/a.csv' })).toEqual({ filePath: 'C:/a.csv' })
    expect(parseDoubleEntryImportRequest({ filePath: 'C:/a.csv', encoding: 'GBK' })).toEqual({
      filePath: 'C:/a.csv',
      encoding: 'gbk'
    })
  })

  it('rejects invalid import requests', () => {
    expect(() => parseDoubleEntryImportRequest({ filePath: '' })).toThrow(
      'INVALID_DOUBLE_ENTRY_FILE'
    )
    expect(() => parseDoubleEntryImportRequest({ filePath: 'C:/a.csv', encoding: 'bogus' })).toThrow(
      'INVALID_DOUBLE_ENTRY_ENCODING'
    )
    expect(() => parseDoubleEntryImportRequest(null)).toThrow(
      'INVALID_DOUBLE_ENTRY_IMPORT_REQUEST'
    )
  })

  it('parses compare requests', () => {
    expect(parseDoubleEntryCompareRequest({ secondaryFilePath: 'C:/b.csv' })).toEqual({
      secondaryFilePath: 'C:/b.csv'
    })
    expect(() => parseDoubleEntryCompareRequest({ secondaryFilePath: '' })).toThrow(
      'INVALID_DOUBLE_ENTRY_FILE'
    )
    expect(() => parseDoubleEntryCompareRequest(null)).toThrow(
      'INVALID_DOUBLE_ENTRY_COMPARE_REQUEST'
    )
  })
})
