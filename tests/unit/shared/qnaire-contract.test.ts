import { describe, expect, it } from 'vitest'

import {
  parseProjectCreateRequest,
  parseProjectOpenRequest,
  parseProjectRestoreRequest,
  parseProjectResult,
  parseProjectSaveRequest
} from '@shared/qnaire-contract'

describe('project create contract', () => {
  it.each(['../escape', '..\\escape', 'bad:name', 'CON', 'name.']) (
    'rejects unsafe Windows project name %s',
    (name) => {
      expect(() =>
        parseProjectCreateRequest({ name, folderPath: 'D:\\projects', password: 'secret' })
      ).toThrow('INVALID_PROJECT_NAME')
    }
  )

  it('accepts a normal Chinese project name', () => {
    expect(
      parseProjectCreateRequest({
        name: '社区健康调查',
        folderPath: 'D:\\projects',
        password: 'secret'
      }).name
    ).toBe('社区健康调查')
  })

  it('rejects malformed create requests', () => {
    expect(() => parseProjectCreateRequest(null)).toThrow('INVALID_PROJECT_CREATE_REQUEST')
    expect(() =>
      parseProjectCreateRequest({ name: '', folderPath: 'D:\\projects', password: 'secret' })
    ).toThrow('INVALID_PROJECT_CREATE_REQUEST')
    expect(() =>
      parseProjectCreateRequest({ name: 'name', folderPath: '', password: 'secret' })
    ).toThrow('INVALID_PROJECT_CREATE_REQUEST')
    expect(() =>
      parseProjectCreateRequest({ name: 'name', folderPath: 'D:\\projects', password: '' })
    ).toThrow('INVALID_PROJECT_CREATE_REQUEST')
  })

  it('parses and rejects project open and save requests', () => {
    expect(parseProjectOpenRequest({ filePath: ' D:\\p.easyepi ', password: 'secret' })).toEqual({
      filePath: 'D:\\p.easyepi',
      password: 'secret'
    })
    expect(() => parseProjectOpenRequest(null)).toThrow('INVALID_PROJECT_OPEN_REQUEST')
    expect(() => parseProjectOpenRequest({ filePath: '', password: 'secret' })).toThrow(
      'INVALID_PROJECT_OPEN_REQUEST'
    )
    expect(() => parseProjectOpenRequest({ filePath: 'x', password: '' })).toThrow(
      'INVALID_PROJECT_OPEN_REQUEST'
    )
    expect(parseProjectSaveRequest({ folderPath: ' D:\\projects ' })).toEqual({
      folderPath: 'D:\\projects'
    })
    expect(() => parseProjectSaveRequest(null)).toThrow('INVALID_PROJECT_SAVE_REQUEST')
    expect(() => parseProjectSaveRequest({ folderPath: '' })).toThrow(
      'INVALID_PROJECT_SAVE_REQUEST'
    )
  })

  it('parses successful and failed project results', () => {
    const meta = {
      name: 'name',
      folderPath: 'D:\\projects',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModifiedAt: '2026-01-01T00:00:00.000Z'
    }
    expect(parseProjectResult({ ok: true, meta })).toEqual({ ok: true, meta })
    expect(parseProjectResult({ ok: false, error: 'failed' })).toEqual({
      ok: false,
      error: 'failed'
    })
    expect(parseProjectResult({ ok: false, error: 1 })).toEqual({
      ok: false,
      error: undefined
    })
    expect(() => parseProjectResult({ ok: 'yes' })).toThrow('INVALID_PROJECT_RESULT')
  })

  it('requires a non-empty backup path for restore requests', () => {
    expect(parseProjectRestoreRequest({ backupPath: ' D:\\backups\\study.easyepi.1.bak ' }))
      .toEqual({ backupPath: 'D:\\backups\\study.easyepi.1.bak' })
    expect(() => parseProjectRestoreRequest({ backupPath: '' })).toThrow(
      'INVALID_PROJECT_RESTORE_REQUEST'
    )
    expect(() => parseProjectRestoreRequest(null)).toThrow('INVALID_PROJECT_RESTORE_REQUEST')
  })
})
