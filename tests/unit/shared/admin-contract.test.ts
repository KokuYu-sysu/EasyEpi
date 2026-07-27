import { describe, expect, it } from 'vitest'

import {
  parseAdminChangePasswordRequest,
  parseAdminDeleteRecordsRequest,
  parseAdminGetRecordsRequest,
  parseAdminLoginRequest,
  parseAdminUpdateRecordRequest
} from '@shared/admin-contract'

describe('admin contract parsers', () => {
  it('requires a non-empty login password', () => {
    expect(parseAdminLoginRequest({ password: 'secret' })).toEqual({ password: 'secret' })
    expect(() => parseAdminLoginRequest({ password: '' })).toThrow('INVALID_PASSWORD')
    expect(() => parseAdminLoginRequest({ password: 123 })).toThrow('INVALID_PASSWORD')
  })

  it('requires a distinct new password of at least eight characters', () => {
    expect(parseAdminChangePasswordRequest({ oldPassword: 'old', newPassword: 'new-pass' })).toEqual({
      oldPassword: 'old',
      newPassword: 'new-pass'
    })
    expect(() =>
      parseAdminChangePasswordRequest({ oldPassword: '', newPassword: 'new-pass' })
    ).toThrow('INVALID_OLD_PASSWORD')
    expect(() =>
      parseAdminChangePasswordRequest({ oldPassword: 'old', newPassword: '' })
    ).toThrow('INVALID_NEW_PASSWORD')
    expect(() =>
      parseAdminChangePasswordRequest({ oldPassword: 'same-password', newPassword: 'same-password' })
    ).toThrow('PASSWORD_UNCHANGED')
  })

  it('accepts only bounded positive integer pagination and explicit sort values', () => {
    expect(
      parseAdminGetRecordsRequest({
        page: 2,
        pageSize: 100,
        search: '  Alice  ',
        sortBy: 'createdAt',
        sortOrder: 'desc'
      })
    ).toEqual({
      page: 2,
      pageSize: 100,
      search: 'Alice',
      sortBy: 'createdAt',
      sortOrder: 'desc'
    })
    for (const page of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseAdminGetRecordsRequest({ page, pageSize: 50 })).toThrow('INVALID_PAGE')
    }
    for (const pageSize of [0, 501, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseAdminGetRecordsRequest({ page: 1, pageSize })).toThrow(
        'INVALID_PAGE_SIZE'
      )
    }
    expect(() =>
      parseAdminGetRecordsRequest({ page: 1, pageSize: 50, search: 42 })
    ).toThrow('INVALID_SEARCH')
    expect(() =>
      parseAdminGetRecordsRequest({ page: 1, pageSize: 50, sortBy: '' })
    ).toThrow('INVALID_SORT_BY')
    expect(() =>
      parseAdminGetRecordsRequest({ page: 1, pageSize: 50, sortOrder: 'sideways' })
    ).toThrow('INVALID_SORT_ORDER')
  })

  it('requires a non-empty record id and a strict answer-only patch', () => {
    expect(parseAdminUpdateRecordRequest({ id: ' record-1 ', data: { answers: { q1: 'yes' } } })).toEqual({
      id: 'record-1',
      data: { answers: { q1: 'yes' } }
    })
    expect(() => parseAdminUpdateRecordRequest({ id: '', data: {} })).toThrow('INVALID_ID')
    expect(() => parseAdminUpdateRecordRequest({ id: 'record-1', data: [] })).toThrow(
      'INVALID_DATA'
    )
    expect(() => parseAdminUpdateRecordRequest({ id: 'record-1', data: {} })).toThrow('INVALID_DATA')
    expect(() => parseAdminUpdateRecordRequest({ id: 'record-1', data: { answers: {}, id: 'x' } })).toThrow('INVALID_DATA')
    expect(() => parseAdminUpdateRecordRequest({ id: 'record-1', data: { answers: { q1: {} } } })).toThrow('INVALID_DATA')
  })

  it('rejects empty, duplicate, or non-string record ids for deletion', () => {
    expect(parseAdminDeleteRecordsRequest({ ids: [' a ', 'b'] })).toEqual({ ids: ['a', 'b'] })
    expect(() => parseAdminDeleteRecordsRequest({ ids: [] })).toThrow('INVALID_IDS')
    expect(() => parseAdminDeleteRecordsRequest({ ids: ['a', 1] })).toThrow('INVALID_IDS')
    expect(() => parseAdminDeleteRecordsRequest({ ids: ['a', 'a'] })).toThrow('INVALID_IDS')
    expect(() => parseAdminDeleteRecordsRequest({ ids: [''] })).toThrow('INVALID_IDS')
  })
})
