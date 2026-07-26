import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createDataFile,
  loadRecords,
  appendRecord,
  deleteRecords,
  checkKeyDuplicate,
  getDataFilePath,
  loadEntryProgress,
  saveEntryProgress,
  atomicWriteFile
} from '../../../../src/main/services/record.service'
import { DATA_MAGIC, DATA_VERSION } from '@shared/types/project'
import { decrypt, encrypt } from '../../../../src/main/services/crypto.service'

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

    it('preserves the previous file when the atomic replacement fails', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      writeFileSync(filePath, 'safe contents')
      const failReplacement = vi.fn(() => {
        throw new Error('simulated rename failure')
      })

      expect(() => atomicWriteFile(filePath, Buffer.from('new contents'), failReplacement)).toThrow(
        'simulated rename failure'
      )

      expect(readFileSync(filePath, 'utf8')).toBe('safe contents')
      expect(failReplacement).toHaveBeenCalledOnce()
      expect(readdirSync(TEST_DIR).filter((name) => name.endsWith('.tmp'))).toEqual([])
    })
  })

  describe('entry progress persistence', () => {
    it('restores a first-record draft from the encrypted data file', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)

      saveEntryProgress(filePath, TEST_KEY, {
        hasDraft: true,
        currentIndex: 1,
        batchCount: 0,
        batchStartTime: 123456,
        currentAnswers: { q1: 'yes' }
      })

      expect(loadEntryProgress(filePath, TEST_KEY)).toEqual({
        hasDraft: true,
        currentIndex: 1,
        batchCount: 0,
        batchStartTime: 123456,
        currentAnswers: { q1: 'yes' }
      })
    })

    it('preserves saved progress when a record is appended', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      saveEntryProgress(filePath, TEST_KEY, {
        hasDraft: true,
        currentIndex: 2,
        batchCount: 3,
        batchStartTime: 123456,
        currentAnswers: { q1: 'saved' }
      })

      appendRecord(filePath, TEST_KEY, {
        id: 'r1',
        answers: { q1: 'submitted' },
        createdAt: '',
        updatedAt: ''
      })

      expect(loadEntryProgress(filePath, TEST_KEY)).toMatchObject({
        currentIndex: 2,
        batchCount: 3,
        currentAnswers: { q1: 'saved' }
      })
    })

    it('loads the legacy encrypted record-array format', () => {
      const filePath = join(TEST_DIR, 'legacy.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, {
        id: 'legacy-record',
        answers: { q1: 'legacy' },
        createdAt: '',
        updatedAt: ''
      })
      const current = readFileSync(filePath)
      const payload = JSON.parse(decrypt(current.subarray(32), TEST_KEY).toString('utf8'))
      writeFileSync(
        filePath,
        Buffer.concat([
          current.subarray(0, 32),
          encrypt(Buffer.from(JSON.stringify(payload.records)), TEST_KEY)
        ])
      )

      expect(loadRecords(filePath, TEST_KEY)).toHaveLength(1)
      expect(loadEntryProgress(filePath, TEST_KEY)).toMatchObject({
        hasDraft: false,
        currentIndex: 0
      })
    })

    it('derives draft state for payloads written before hasDraft was added', () => {
      const filePath = join(TEST_DIR, 'old-progress.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      const current = readFileSync(filePath)
      const payload = JSON.parse(decrypt(current.subarray(32), TEST_KEY).toString('utf8'))
      delete payload.entryProgress.hasDraft
      payload.entryProgress.currentIndex = 1
      writeFileSync(
        filePath,
        Buffer.concat([
          current.subarray(0, 32),
          encrypt(Buffer.from(JSON.stringify(payload)), TEST_KEY)
        ])
      )

      expect(loadEntryProgress(filePath, TEST_KEY)).toMatchObject({
        hasDraft: true,
        currentIndex: 1
      })
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
      const result = checkKeyDuplicate(filePath, TEST_KEY, ['id_card'], {
        id_card: '110101199001011234'
      })
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
      const result = checkKeyDuplicate(filePath, TEST_KEY, ['id_card'], {
        id_card: '999999999999999999'
      })
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
      expect(getDataFilePath('/projects', 'myproject')).toBe(
        join('/projects', 'myproject.easyepi_data')
      )
    })
  })
})
