import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthService } from '@main/services/auth.service'
import {
  changeProjectPassword,
  getProjectRekeyManifestPath,
  getProjectRekeyManifestTemporaryPath,
  recoverProjectRekeyTransaction
} from '@main/services/project-rekey.service'
import {
  createProject,
  decryptProjectData,
  getProjectFilePath,
  readProjectHeader,
  verifyAndDeriveKey
} from '@main/services/project.service'
import {
  appendRecord,
  createDataFile,
  getDataFilePath,
  loadEntryProgress,
  loadRecords,
  saveEntryProgress
} from '@main/services/record.service'
import type { ProjectIpcState } from '@main/ipc/project.ipc'

const TEST_DIR = join(tmpdir(), `easyepi-rekey-${process.pid}`)

function openTestProject(): ProjectIpcState {
  const created = createProject(TEST_DIR, 'study', 'old-password')
  const auth = createAuthService()
  auth.encryptionKey = created.encryptionKey
  auth.passwordData = { hash: created.passwordHash, salt: created.salt }
  const projectPath = getProjectFilePath(TEST_DIR, 'study')
  return {
    currentProject: decryptProjectData(projectPath, created.encryptionKey),
    currentFilePath: projectPath,
    currentSaltHex: created.salt,
    currentHashHex: created.passwordHash,
    auth
  }
}

describe('changeProjectPassword', () => {
  let state: ProjectIpcState
  let dataPath: string

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_DIR, { recursive: true })
    state = openTestProject()
    dataPath = getDataFilePath(TEST_DIR, 'study')
    createDataFile(dataPath, state.auth.encryptionKey!)
    appendRecord(dataPath, state.auth.encryptionKey!, {
      id: 'r1',
      answers: { q1: 'sensitive' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    saveEntryProgress(dataPath, state.auth.encryptionKey!, {
      hasDraft: true,
      currentIndex: 1,
      batchCount: 2,
      batchStartTime: 123,
      currentAnswers: { q1: 'draft' }
    })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  it('re-encrypts project data, records, and draft with the new password', () => {
    const oldKey = Buffer.from(state.auth.encryptionKey!)
    const oldProject = state.currentProject!
    const oldQuestionnaire = oldProject.questionnaire
    oldProject.aiAssistant = { schemaVersion: 1, sessions: {} }
    const oldAssistant = oldProject.aiAssistant
    const result = changeProjectPassword(state, 'old-password', 'new-password-123')
    expect(result.success).toBe(true)

    const header = readProjectHeader(state.currentFilePath!)
    const newKey = verifyAndDeriveKey('new-password-123', header.saltHex, header.hashHex)
    expect(newKey).not.toBeNull()
    expect(verifyAndDeriveKey('old-password', header.saltHex, header.hashHex)).toBeNull()
    expect(decryptProjectData(state.currentFilePath!, newKey!).meta.name).toBe('study')
    expect(loadRecords(dataPath, newKey!)).toMatchObject([
      { id: 'r1', answers: { q1: 'sensitive' } }
    ])
    expect(loadEntryProgress(dataPath, newKey!)).toMatchObject({
      hasDraft: true,
      currentAnswers: { q1: 'draft' }
    })
    expect(() => loadRecords(dataPath, oldKey)).toThrow()
    expect(state.auth.encryptionKey).toEqual(newKey)
    expect(state.currentSaltHex).toBe(header.saltHex)
    expect(state.currentProject).not.toBe(oldProject)
    expect(state.currentProject?.questionnaire).not.toBe(oldQuestionnaire)
    expect(state.currentProject?.aiAssistant).not.toBe(oldAssistant)
  })

  it('rejects a wrong old password without changing either file or state', () => {
    const projectBefore = readFileSync(state.currentFilePath!)
    const dataBefore = readFileSync(dataPath)
    const keyBefore = Buffer.from(state.auth.encryptionKey!)

    expect(() => changeProjectPassword(state, 'wrong-password', 'new-password-123')).toThrow(
      'INVALID_OLD_PASSWORD'
    )
    expect(readFileSync(state.currentFilePath!)).toEqual(projectBefore)
    expect(readFileSync(dataPath)).toEqual(dataBefore)
    expect(state.auth.encryptionKey).toEqual(keyBefore)
  })

  it('rolls both files back when the second staged file cannot be installed', () => {
    const projectBefore = readFileSync(state.currentFilePath!)
    const dataBefore = readFileSync(dataPath)
    const keyBefore = Buffer.from(state.auth.encryptionKey!)
    let stagedInstallCount = 0
    const rename = vi.fn((source: string, target: string) => {
      if (source.includes('.rekey-') && source.endsWith('.tmp')) {
        stagedInstallCount += 1
        if (stagedInstallCount === 2) throw new Error('simulated install failure')
      }
      renameSync(source, target)
    })

    expect(() =>
      changeProjectPassword(state, 'old-password', 'new-password-123', { rename })
    ).toThrow('simulated install failure')
    expect(readFileSync(state.currentFilePath!)).toEqual(projectBefore)
    expect(readFileSync(dataPath)).toEqual(dataBefore)
    expect(state.auth.encryptionKey).toEqual(keyBefore)
  })

  it('handles projects whose data file has not been created yet', () => {
    rmSync(dataPath)
    expect(changeProjectPassword(state, 'old-password', 'new-password-123')).toMatchObject({
      success: true
    })
    expect(existsSync(dataPath)).toBe(false)
  })

  it('keeps a committed new password when encrypted backup cleanup fails', () => {
    const remove = vi.fn((path: string) => {
      if (path.endsWith('.bak')) throw new Error('simulated backup cleanup failure')
      rmSync(path, { force: true })
    })
    expect(changeProjectPassword(state, 'old-password', 'new-password-123', { remove })).toEqual({
      success: true
    })
    const header = readProjectHeader(state.currentFilePath!)
    const newKey = verifyAndDeriveKey('new-password-123', header.saltHex, header.hashHex)
    expect(newKey).not.toBeNull()
    expect(loadRecords(dataPath, newKey!)).toHaveLength(1)
    expect(existsSync(getProjectRekeyManifestPath(state.currentFilePath!))).toBe(false)
  })

  it('recovers the old consistent pair from an interrupted transaction manifest', () => {
    const projectPath = state.currentFilePath!
    const projectBefore = readFileSync(projectPath)
    const transactionId = '11111111-1111-1111-1111-111111111111'
    const projectBackup = `${projectPath}.rekey-${transactionId}.bak`
    renameSync(projectPath, projectBackup)
    writeFileSync(projectPath, 'partially installed new project')
    writeFileSync(
      getProjectRekeyManifestPath(projectPath),
      JSON.stringify({ version: 1, transactionId, dataFileName: 'study.easyepi_data' })
    )

    expect(recoverProjectRekeyTransaction(projectPath)).toBe(true)
    expect(readFileSync(projectPath)).toEqual(projectBefore)
    expect(loadRecords(dataPath, state.auth.encryptionKey!)).toHaveLength(1)
    expect(existsSync(projectBackup)).toBe(false)
    expect(existsSync(getProjectRekeyManifestPath(projectPath))).toBe(false)
  })

  it('uses the current project-file directory and basename after a project is moved', () => {
    const movedDirectory = join(TEST_DIR, 'moved')
    mkdirSync(movedDirectory)
    const movedProjectPath = join(movedDirectory, 'renamed.easyepi')
    const movedDataPath = join(movedDirectory, 'renamed.easyepi_data')
    renameSync(state.currentFilePath!, movedProjectPath)
    renameSync(dataPath, movedDataPath)
    state.currentFilePath = movedProjectPath

    expect(changeProjectPassword(state, 'old-password', 'new-password-123')).toEqual({ success: true })
    const header = readProjectHeader(movedProjectPath)
    const newKey = verifyAndDeriveKey('new-password-123', header.saltHex, header.hashHex)!
    expect(loadRecords(movedDataPath, newKey)).toHaveLength(1)
    expect(existsSync(dataPath)).toBe(false)
  })

  it('rejects missing project state, locked state, weak passwords, and unchanged passwords', () => {
    const project = state.currentProject
    state.currentProject = null
    expect(() => changeProjectPassword(state, 'old-password', 'new-password-123')).toThrow('NO_PROJECT_OPEN')
    state.currentProject = project
    const key = state.auth.encryptionKey
    state.auth.encryptionKey = null
    expect(() => changeProjectPassword(state, 'old-password', 'new-password-123')).toThrow('PROJECT_NOT_UNLOCKED')
    state.auth.encryptionKey = key
    expect(() => changeProjectPassword(state, 'old-password', 'short')).toThrow('WEAK_NEW_PASSWORD')
    expect(() => changeProjectPassword(state, 'old-password', 'old-password')).toThrow('PASSWORD_UNCHANGED')
  })

  it('rejects invalid recovery manifests without touching the project', () => {
    const projectBefore = readFileSync(state.currentFilePath!)
    writeFileSync(getProjectRekeyManifestPath(state.currentFilePath!), JSON.stringify({ version: 2, transactionId: 'bad' }))
    expect(() => recoverProjectRekeyTransaction(state.currentFilePath!)).toThrow('PROJECT_REKEY_RECOVERY_FAILED')
    expect(readFileSync(state.currentFilePath!)).toEqual(projectBefore)
  })

  it('ignores a truncated unpublished manifest temporary file', () => {
    const projectPath = state.currentFilePath!
    const projectBefore = readFileSync(projectPath)
    const pendingPath = getProjectRekeyManifestTemporaryPath(
      projectPath,
      '33333333-3333-3333-3333-333333333333'
    )
    writeFileSync(pendingPath, '{"version":1')
    expect(recoverProjectRekeyTransaction(projectPath)).toBe(false)
    expect(readFileSync(projectPath)).toEqual(projectBefore)
    expect(decryptProjectData(projectPath, state.auth.encryptionKey!).meta.name).toBe('study')
  })

  it('recovers a project-only interrupted transaction without a data entry', () => {
    const projectPath = state.currentFilePath!
    const projectBefore = readFileSync(projectPath)
    const transactionId = '22222222-2222-2222-2222-222222222222'
    renameSync(projectPath, `${projectPath}.rekey-${transactionId}.bak`)
    writeFileSync(projectPath, 'partial')
    writeFileSync(getProjectRekeyManifestPath(projectPath), JSON.stringify({ version: 1, transactionId }))
    expect(recoverProjectRekeyTransaction(projectPath)).toBe(true)
    expect(readFileSync(projectPath)).toEqual(projectBefore)
  })
})
