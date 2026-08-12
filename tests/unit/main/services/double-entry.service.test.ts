import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DoubleEntryService,
  detectCsvEncoding,
  parseCsv,
  readComparisonCsv
} from '@main/services/double-entry.service'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { RecordData } from '@shared/types/record'

const testFiles: string[] = []

function qnaire(): QuestionnaireDef {
  return {
    name: '测试',
    questions: [
      { id: 'q-id', content: '编号', variableName: 'pid', type: 'free_text', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 0 },
      { id: 'q-sex', content: '性别', variableName: 'sex', type: 'single_choice', options: [{ value: '1', label: '男' }, { value: '2', label: '女' }], constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 1 },
      { id: 'q-age', content: '年龄', variableName: 'age', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 2 }
    ],
    conditionRules: [],
    keyQuestionIds: ['q-id'],
    derivedVariables: []
  }
}

function record(id: string, answers: Record<string, unknown>): RecordData {
  return { id, answers: answers as Record<string, never>, createdAt: 't', updatedAt: 't' }
}

function writeTempCsv(contents: string): string {
  const filePath = join(tmpdir(), `easyepi-de-${testFiles.length}.csv`)
  testFiles.push(filePath)
  writeFileSync(filePath, contents)
  return filePath
}

afterEach(() => {
  for (const file of testFiles.splice(0)) {
    if (existsSync(file)) rmSync(file, { recursive: true })
  }
})

describe('parseCsv', () => {
  it('parses simple rows and headers', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('"a,b",c\n"x""y",z')).toEqual([
      ['a,b', 'c'],
      ['x"y', 'z']
    ])
  })

  it('handles CRLF line endings and trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})

describe('encoding detection', () => {
  it('detects UTF-8', () => {
    expect(detectCsvEncoding(Buffer.from('pid,姓名\n1,张三', 'utf8'))).toBe('utf-8')
  })

  it('falls back to GBK for non-UTF-8 bytes', () => {
    const gbk = Buffer.from([0x70, 0x69, 0x64, 0x2c, 0xbb, 0xd5, 0xc3, 0xf9, 0x0a])
    expect(detectCsvEncoding(gbk)).toBe('gbk')
  })
})

describe('readComparisonCsv', () => {
  it('maps headers to columns and skips metadata columns', () => {
    const file = writeTempCsv(
      '__easyepi_record_id,pid,sex\nr1,001,男'
    )
    const result = readComparisonCsv(file)
    expect(result.encoding).toBe('utf-8')
    expect(result.headers).toEqual(['pid', 'sex'])
    expect(result.rows).toEqual([{ pid: '001', sex: '男' }])
  })
})

describe('DoubleEntryService.compare', () => {
  it('requires at least one Key field instead of silently pairing rows by position', () => {
    expect(() => new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001' })],
      [{ pid: '001' }],
      qnaire(),
      []
    )).toThrow('DOUBLE_ENTRY_KEY_REQUIRED')
  })

  it('requires every Key column in the secondary CSV', () => {
    expect(() => new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001' })],
      [{ age: '30' }],
      qnaire(),
      ['pid']
    )).toThrow('DOUBLE_ENTRY_KEY_COLUMN_MISSING')
  })

  it('matches by Key and reports identical records', () => {
    const result = new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001', 'q-age': '30', 'q-sex': '1' })],
      [{ pid: '001', age: '30', sex: '男' }],
      qnaire(),
      ['pid']
    )
    expect(result.matchedIdentical).toBe(1)
    expect(result.matchedWithDiffs).toBe(0)
    expect(result.onlyInPrimary).toHaveLength(0)
    expect(result.onlyInSecondary).toHaveLength(0)
  })

  it('flags differing fields with raw primary and secondary values', () => {
    const result = new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001', 'q-age': '30' })],
      [{ pid: '001', age: '31' }],
      qnaire(),
      ['pid']
    )
    expect(result.matchedWithDiffs).toBe(1)
    const entry = result.matched[0]!
    expect(entry.primaryRecordId).toBe('r1')
    expect(entry.diffs).toHaveLength(1)
    expect(entry.diffs[0]!.variableName).toBe('age')
    expect(entry.diffs[0]!.oldValue).toBe('30')
    expect(entry.diffs[0]!.newValue).toBe('31')
  })

  it('normalizes single-choice labels so label mismatches are not false positives', () => {
    const result = new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001', 'q-sex': '1' })],
      [{ pid: '001', sex: '男', age: '' }],
      qnaire(),
      ['pid']
    )
    expect(result.matchedIdentical).toBe(1)
    expect(result.matchedWithDiffs).toBe(0)
  })

  it('treats multi-choice values as an unordered set', () => {
    const questionnaire = qnaire()
    questionnaire.questions.push({
      id: 'q-symptoms',
      content: '症状',
      variableName: 'symptoms',
      type: 'multiple_choice',
      options: [{ value: 'a', label: '咳嗽' }, { value: 'b', label: '发热' }],
      constraint: { type: 'none' },
      isKey: false,
      allowSkip: true,
      order: 3
    })
    const result = new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001', 'q-symptoms': ['a', 'b'] })],
      [{ pid: '001', sex: '', age: '', symptoms: '发热,咳嗽' }],
      questionnaire,
      ['pid']
    )
    expect(result.matchedIdentical).toBe(1)
    expect(result.matchedWithDiffs).toBe(0)
  })

  it('reports records only in primary and only in secondary', () => {
    const result = new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001' }), record('r2', { 'q-id': '002' })],
      [{ pid: '002', age: '1' }, { pid: '003', age: '2' }],
      qnaire(),
      ['pid']
    )
    expect(result.recordsOnlyInPrimary).toBe(1)
    expect(result.onlyInPrimary[0]!.primaryRecordId).toBe('r1')
    expect(result.recordsOnlyInSecondary).toBe(1)
    expect(result.onlyInSecondary[0]!.keyValues).toEqual({ pid: '003' })
  })

  it('pairs duplicate-key primary records with secondary rows and reports leftovers', () => {
    const result = new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001', 'q-age': '1' }), record('r2', { 'q-id': '001', 'q-age': '2' })],
      [{ pid: '001', age: '1' }],
      qnaire(),
      ['pid']
    )
    expect(result.matchedIdentical).toBe(1)
    expect(result.recordsOnlyInPrimary).toBe(1)
    expect(result.onlyInPrimary[0]!.primaryRecordId).toBe('r2')
  })

  it('reports every secondary row when the key is missing from primary', () => {
    const result = new DoubleEntryService().compare(
      [],
      [{ pid: '001', age: '1' }, { pid: '002', age: '2' }],
      qnaire(),
      ['pid']
    )
    expect(result.recordsOnlyInSecondary).toBe(2)
  })

  it('ignores blank-key rows from matching', () => {
    const result = new DoubleEntryService().compare(
      [record('r1', { 'q-id': '001', 'q-age': '1' })],
      [{ pid: '001', age: '1' }, { pid: '', age: '9' }],
      qnaire(),
      ['pid']
    )
    expect(result.matchedIdentical).toBe(1)
    expect(result.recordsOnlyInSecondary).toBe(1)
  })
})
