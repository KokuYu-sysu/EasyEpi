import { describe, it, expect } from 'vitest'
import {
  parseRecordSubmitRequest,
  parseRecordListRequest,
  parseRecordDeleteRequest,
  parseKeyDuplicateRequest,
  parseRecordSubmitResult
} from '@shared/record-contract'

describe('record-contract parsers', () => {
  describe('parseRecordSubmitRequest', () => {
    it('parses valid request', () => {
      const result = parseRecordSubmitRequest({ answers: { name: '张三', age: 30 } })
      expect(result.answers).toEqual({ name: '张三', age: 30 })
    })
    it('throws on non-object', () => {
      expect(() => parseRecordSubmitRequest(null)).toThrow('INVALID_RECORD_SUBMIT_REQUEST')
    })
    it('throws on missing answers', () => {
      expect(() => parseRecordSubmitRequest({})).toThrow('INVALID_RECORD_SUBMIT_REQUEST')
    })
  })

  describe('parseRecordListRequest', () => {
    it('returns empty on non-object', () => {
      expect(parseRecordListRequest(null)).toEqual({})
    })
    it('parses offset and limit', () => {
      expect(parseRecordListRequest({ offset: 10, limit: 5 })).toEqual({ offset: 10, limit: 5 })
    })
  })

  describe('parseRecordDeleteRequest', () => {
    it('parses valid request', () => {
      expect(parseRecordDeleteRequest({ recordIds: ['a', 'b'] })).toEqual({ recordIds: ['a', 'b'] })
    })
    it('throws on non-array', () => {
      expect(() => parseRecordDeleteRequest({ recordIds: 'a' })).toThrow()
    })
  })

  describe('parseKeyDuplicateRequest', () => {
    it('parses valid request', () => {
      const result = parseKeyDuplicateRequest({ keyValues: { id_card: '123' } })
      expect(result.keyValues).toEqual({ id_card: '123' })
    })
    it('parses with excludeRecordId', () => {
      const result = parseKeyDuplicateRequest({ keyValues: { id_card: '123' }, excludeRecordId: 'rec-1' })
      expect(result.excludeRecordId).toBe('rec-1')
    })
  })

  describe('parseRecordSubmitResult', () => {
    it('parses success', () => {
      expect(parseRecordSubmitResult({ ok: true, recordId: 'abc' })).toEqual({
        ok: true,
        recordId: 'abc',
        error: undefined
      })
    })
    it('parses failure', () => {
      expect(parseRecordSubmitResult({ ok: false, error: 'duplicate' })).toEqual({
        ok: false,
        error: 'duplicate',
        recordId: undefined
      })
    })
    it('throws on invalid', () => {
      expect(() => parseRecordSubmitResult(null)).toThrow()
    })
  })
})
