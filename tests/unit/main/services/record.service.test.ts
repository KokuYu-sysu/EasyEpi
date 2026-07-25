import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createDataFile,
  loadRecords,
  appendRecord,
  deleteRecords,
  checkKeyDuplicate,
  getDataFilePath
} from '../../../../src/main/services/record.service'
import { DATA_MAGIC, DATA_VERSION } from '@shared/types/project'

const TEST_DIR = join(tmpdir(), 'easyepi-test-record-' + Date.now())
const TEST_KEY = randomBytes(32)

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('record.service', () => {
  describe('createDataFile', () => {
    it('creates a valid data file with header', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      expect(existsSync(filePath)).toBe(true)
      const buf = readFileSync(filePath)
      expect(buf.readUInt32BE(0)).toBe(DATA_MAGIC)
      expect(buf.readUInt32BE(4)).toBe(DATA_VERSION)
      expect(buf.readUInt32BE(8)).toBe(0) // 0 records
    })
  })

  describe('appendRecord + loadRecords', () => {
    it('saves and loads a record', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      const recordId = 'test-id-1'
      appendRecord(filePath, TEST_KEY, {
        id: recordId,
        answers: { name: '张三', age: 30 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      const records = loadRecords(filePath, TEST_KEY)
      expect(records).toHaveLength(1)
      expect(records[0]!.id).toBe(recordId)
      expect(records[0]!.answers.name).toBe('张三')
    })

    it('saves multiple records', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      for (let i = 0; i < 5; i++) {
        appendRecord(filePath, TEST_KEY, {
          id: `rec-${i}`,
          answers: { index: i },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
      const records = loadRecords(filePath, TEST_KEY)
      expect(records).toHaveLength(5)
    })
  })

  describe('deleteRecords', () => {
    it('deletes specified records', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, { id: 'a', answers: {}, createdAt: '', updatedAt: '' })
      appendRecord(filePath, TEST_KEY, { id: 'b', answers: {}, createdAt: '', updatedAt: '' })
      appendRecord(filePath, TEST_KEY, { id: 'c', answers: {}, createdAt: '', updatedAt: '' })
      deleteRecords(filePath, TEST_KEY, ['a', 'c'])
      const records = loadRecords(filePath, TEST_KEY)
      expect(records).toHaveLength(1)
      expect(records[0]!.id).toBe('b')
    })
  })

  describe('checkKeyDuplicate', () => {
    it('detects duplicate key', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, {
        id: 'r1',
        answers: { id_card: '110101199001011234', name: '张三' },
        createdAt: '',
        updatedAt: ''
      })
      const result = checkKeyDuplicate(filePath, TEST_KEY, ['id_card'], { id_card: '110101199001011234' })
      expect(result.isDuplicate).toBe(true)
    })

    it('returns false for unique key', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, {
        id: 'r1',
        answers: { id_card: '110101199001011234' },
        createdAt: '',
        updatedAt: ''
      })
      const result = checkKeyDuplicate(filePath, TEST_KEY, ['id_card'], { id_card: '999999999999999999' })
      expect(result.isDuplicate).toBe(false)
    })

    it('excludes specified record id', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, {
        id: 'r1',
        answers: { id_card: '110101199001011234' },
        createdAt: '',
        updatedAt: ''
      })
      const result = checkKeyDuplicate(
        filePath,
        TEST_KEY,
        ['id_card'],
        { id_card: '110101199001011234' },
        'r1'
      )
      expect(result.isDuplicate).toBe(false)
    })
  })

  describe('getDataFilePath', () => {
    it('returns correct path', () => {
      expect(getDataFilePath('/projects', 'myproject')).toBe(join('/projects', 'myproject.easyepi_data'))
    })
  })
})
