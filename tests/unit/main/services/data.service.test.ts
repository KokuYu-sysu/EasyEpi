import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAuthService } from '@main/services/auth.service'
import { DataService } from '@main/services/data.service'
import {
  appendRecord,
  createDataFile,
  getDataFilePath,
  loadEntryProgress,
  loadRecords,
  replaceRecords,
  saveEntryProgress
} from '@main/services/record.service'
import type { ProjectIpcState } from '@main/ipc/project.ipc'
import type { RecordData } from '@shared/types/record'

const TEST_DIR = join(tmpdir(), `easyepi-data-service-${process.pid}`)

function makeProjectState(key: Buffer): ProjectIpcState {
  const auth = createAuthService()
  auth.encryptionKey = key
  return {
    currentProject: {
      meta: {
        name: 'study',
        folderPath: TEST_DIR,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastModifiedAt: '2026-01-01T00:00:00.000Z'
      },
      questionnaire: {
        name: 'study',
        questions: [
          {
            id: 'q-name',
            variableName: 'name',
            content: '姓名',
            type: 'free_text',
            options: [],
            constraint: { type: 'none' },
            isKey: false,
            allowSkip: false,
            order: 0
          },
          {
            id: 'q-code',
            variableName: 'code',
            content: '编号',
            type: 'fixed_length',
            options: [],
            constraint: { type: 'none' },
            isKey: true,
            allowSkip: false,
            order: 1
          },
          {
            id: 'q-age',
            variableName: 'age',
            content: '年龄',
            type: 'numeric_range',
            options: [],
            constraint: { type: 'integer', minValue: 0, maxValue: 120 },
            isKey: false,
            allowSkip: true,
            order: 2
          },
          {
            id: 'q-group',
            variableName: 'group',
            content: '组别',
            type: 'single_choice',
            options: [{ value: 'case', label: '病例组' }, { value: 'control', label: '对照组' }],
            constraint: { type: 'none' },
            isKey: false,
            allowSkip: true,
            order: 3
          }
        ],
        conditionRules: [],
        keyQuestionIds: ['q-code']
      }
    },
    currentFilePath: join(TEST_DIR, 'study.easyepi'),
    currentSaltHex: '',
    currentHashHex: '',
    auth
  }
}

function record(id: string, name: string, code: string, age: number): RecordData {
  return {
    id,
    answers: { 'q-name': name, 'q-code': code, 'q-age': age },
    createdAt: `2026-01-0${age % 9}T00:00:00.000Z`,
    updatedAt: `2026-01-0${age % 9}T00:00:00.000Z`
  }
}

describe('DataService', () => {
  let key: Buffer
  let state: ProjectIpcState
  let filePath: string
  let service: DataService

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_DIR, { recursive: true })
    key = randomBytes(32)
    state = makeProjectState(key)
    filePath = getDataFilePath(TEST_DIR, 'study')
    createDataFile(filePath, key)
    appendRecord(filePath, key, record('r1', '张三', 'A001', 42))
    appendRecord(filePath, key, record('r2', '李四', 'A002', 18))
    appendRecord(filePath, key, record('r3', '王五', 'A003', 31))
    service = new DataService(state)
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  it('reads a deterministic page from the encrypted data file', async () => {
    await expect(service.getRecords({ page: 2, pageSize: 1 })).resolves.toMatchObject({
      records: [{ id: 'r2' }],
      total: 3,
      page: 2,
      pageSize: 1,
      totalPages: 3
    })
  })

  it('searches scalar answer values and record ids case-insensitively', async () => {
    await expect(
      service.getRecords({ page: 1, pageSize: 20, search: '张三' })
    ).resolves.toMatchObject({ records: [{ id: 'r1' }], total: 1 })
    await expect(
      service.getRecords({ page: 1, pageSize: 20, search: 'R2' })
    ).resolves.toMatchObject({ records: [{ id: 'r2' }], total: 1 })
  })

  it('sorts by a questionnaire variable name', async () => {
    const result = await service.getRecords({
      page: 1,
      pageSize: 20,
      sortBy: 'age',
      sortOrder: 'asc'
    })
    expect(result.records.map(({ id }) => id)).toEqual(['r2', 'r3', 'r1'])
  })

  it('distinguishes record metadata sorting from an answer variable named id', async () => {
    state.currentProject!.questionnaire.questions.push({
      id: 'q-id', variableName: 'id', content: '外部编号', type: 'free_text', options: [],
      constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 4
    })
    replaceRecords(filePath, key, [
      { ...record('z-record', 'A', 'A001', 1), answers: { ...record('z-record', 'A', 'A001', 1).answers, 'q-id': 'a-answer' } },
      { ...record('a-record', 'B', 'A002', 2), answers: { ...record('a-record', 'B', 'A002', 2).answers, 'q-id': 'z-answer' } }
    ])
    expect((await service.getRecords({ page: 1, pageSize: 20, sortBy: '@record:id' })).records.map(({ id }) => id)).toEqual(['a-record', 'z-record'])
    expect((await service.getRecords({ page: 1, pageSize: 20, sortBy: '@answer:q-id' })).records.map(({ id }) => id)).toEqual(['z-record', 'a-record'])
  })

  it('rejects unsupported sort fields', async () => {
    await expect(
      service.getRecords({ page: 1, pageSize: 20, sortBy: '__proto__' })
    ).rejects.toThrow('INVALID_SORT_FIELD')
  })

  it('updates answers without allowing metadata replacement', async () => {
    const before = await service.getRecordById('r1')
    await service.updateRecord('r1', {
      answers: { 'q-name': '赵六', 'q-age': 43 },
      id: 'attacker-controlled',
      createdAt: 'attacker-controlled'
    })
    const updated = await service.getRecordById('r1')
    expect(updated).toMatchObject({
      id: 'r1',
      answers: { 'q-name': '赵六', 'q-code': 'A001', 'q-age': 43 },
      createdAt: before?.createdAt
    })
    expect(updated?.updatedAt).not.toBe(before?.updatedAt)
  })

  it('rejects an update that duplicates a key-field value', async () => {
    await expect(
      service.updateRecord('r2', { answers: { 'q-code': 'A001' } })
    ).rejects.toThrow('KEY_DUPLICATE')
    expect((await service.getRecordById('r2'))?.answers['q-code']).toBe('A002')
  })

  it('rejects unknown records, fields, and invalid answer values', async () => {
    await expect(service.updateRecord('missing', { answers: {} })).rejects.toThrow(
      'RECORD_NOT_FOUND'
    )
    await expect(
      service.updateRecord('r1', { answers: { unknown: 'value' } })
    ).rejects.toThrow('UNKNOWN_QUESTION')
    await expect(
      service.updateRecord('r1', { answers: { 'q-name': { nested: true } } })
    ).rejects.toThrow('INVALID_ANSWER_VALUE')
  })

  it('enforces questionnaire constraints when an administrator edits answers', async () => {
    await expect(
      service.updateRecord('r1', { answers: { 'q-name': null } })
    ).rejects.toThrow('ANSWER_CONSTRAINT_VIOLATION')
    await expect(
      service.updateRecord('r1', { answers: { 'q-age': 121 } })
    ).rejects.toThrow('ANSWER_CONSTRAINT_VIOLATION')
    await expect(
      service.updateRecord('r1', { answers: { 'q-age': 1.5 } })
    ).rejects.toThrow('ANSWER_CONSTRAINT_VIOLATION')
    await expect(
      service.updateRecord('r1', { answers: { 'q-group': 'unknown' } })
    ).rejects.toThrow('ANSWER_CONSTRAINT_VIOLATION')
    await expect(
      service.updateRecord('r1', { answers: { 'q-group': ['case'] } })
    ).rejects.toThrow('ANSWER_CONSTRAINT_VIOLATION')
    expect((await service.getRecordById('r1'))?.answers).toMatchObject({
      'q-name': '张三',
      'q-age': 42
    })
  })

  it('removes answers that become hidden after an administrator edit', async () => {
    state.currentProject!.questionnaire.conditionRules.push({
      id: 'hide-age',
      sourceQuestionId: 'q-group',
      conditions: [{ questionId: 'q-group', operator: 'equals', value: 'control' }],
      logic: 'AND',
      action: 'skip',
      targetQuestionIds: ['q-age']
    })
    await service.updateRecord('r1', { answers: { 'q-group': 'control' } })
    expect((await service.getRecordById('r1'))?.answers).toEqual({
      'q-name': '张三',
      'q-code': 'A001',
      'q-group': 'control'
    })
  })

  it('deletes records while preserving encrypted entry progress', async () => {
    saveEntryProgress(filePath, key, {
      hasDraft: true,
      currentIndex: 2,
      batchCount: 7,
      batchStartTime: 123,
      currentAnswers: { 'q-name': '草稿' }
    })
    await service.deleteRecords(['r1', 'r3'])

    expect(loadRecords(filePath, key).map(({ id }) => id)).toEqual(['r2'])
    expect(loadEntryProgress(filePath, key)).toMatchObject({
      hasDraft: true,
      currentIndex: 2,
      batchCount: 7,
      currentAnswers: { 'q-name': '草稿' }
    })
  })

  it('requires an opened and unlocked project', async () => {
    state.currentProject = null
    await expect(service.getRecordCount()).rejects.toThrow('NO_PROJECT_OPEN')
    state.currentProject = makeProjectState(key).currentProject
    state.auth.encryptionKey = null
    await expect(service.getRecordCount()).rejects.toThrow('PROJECT_NOT_UNLOCKED')
  })

  it('validates pagination, creates a missing data file, and reports an empty page', async () => {
    await expect(service.getRecords({ page: 0, pageSize: 20 })).rejects.toThrow('INVALID_PAGE')
    await expect(service.getRecords({ page: 1, pageSize: 0 })).rejects.toThrow('INVALID_PAGE_SIZE')
    await expect(service.getRecords({ page: 1, pageSize: 501 })).rejects.toThrow('INVALID_PAGE_SIZE')
    rmSync(filePath)
    await expect(service.getRecords({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      records: [], total: 0, totalPages: 0
    })
    expect(existsSync(filePath)).toBe(true)
  })

  it('searches arrays and skips nulls, then sorts metadata descending with stable ties', async () => {
    replaceRecords(filePath, key, [
      { id: 'b', answers: { 'q-name': ['red', 'blue'], 'q-age': null }, createdAt: '2026-01-01', updatedAt: 'same' },
      { id: 'a', answers: { 'q-name': null, 'q-age': 1 }, createdAt: '2026-01-02', updatedAt: 'same' }
    ])
    await expect(service.getRecords({ page: 1, pageSize: 20, search: 'blue' })).resolves.toMatchObject({
      records: [{ id: 'b' }], total: 1
    })
    const sorted = await service.getRecords({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' })
    expect(sorted.records.map(({ id }) => id)).toEqual(['a', 'b'])
    const tied = await service.getRecords({ page: 1, pageSize: 20, sortBy: 'updatedAt' })
    expect(tied.records.map(({ id }) => id)).toEqual(['a', 'b'])
  })

  it('sorts missing answer values last in both comparison directions', async () => {
    replaceRecords(filePath, key, [
      record('r1', 'A', 'A001', 1),
      { ...record('r2', 'B', 'A002', 2), answers: { 'q-name': 'B', 'q-code': 'A002', 'q-age': null } }
    ])
    expect((await service.getRecords({ page: 1, pageSize: 20, sortBy: 'age' })).records.map(({ id }) => id)).toEqual(['r1', 'r2'])
    expect((await service.getRecords({ page: 1, pageSize: 20, sortBy: 'age', sortOrder: 'desc' })).records.map(({ id }) => id)).toEqual(['r2', 'r1'])
  })

  it('accepts string arrays, rejects malformed answer containers, and returns null for a missing id', async () => {
    state.currentProject!.questionnaire.questions.push({
      id: 'q-tags', variableName: 'tags', content: '标签', type: 'multiple_choice',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 3
    })
    await service.updateRecord('r1', { answers: { tags: ['a', 'b'] } })
    expect((await service.getRecordById('r1'))?.answers['q-tags']).toEqual(['a', 'b'])
    await expect(service.updateRecord('r1', { answers: null })).rejects.toThrow('INVALID_ANSWERS')
    await expect(service.updateRecord('r1', { answers: [] })).rejects.toThrow('INVALID_ANSWERS')
    await expect(service.getRecordById('missing')).resolves.toBeNull()
  })

  it('rejects a missing current project path even if project metadata remains in memory', async () => {
    state.currentFilePath = null
    await expect(service.getRecords({ page: 1, pageSize: 20 })).rejects.toThrow('NO_PROJECT_OPEN')
  })
})
