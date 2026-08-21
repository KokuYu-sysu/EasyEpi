import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createBackup,
  getBackups,
  restoreFromBackup
} from '../../../../src/main/services/backup.service'
import {
  createProject,
  decryptProjectData,
  getProjectFilePath,
  saveProject
} from '../../../../src/main/services/project.service'
import {
  appendRecord,
  createDataFile,
  getDataFilePath,
  loadRecords
} from '../../../../src/main/services/record.service'

describe('BackupService complete project snapshots', () => {
  const folders: string[] = []

  afterEach(() => {
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('restores the questionnaire and encrypted records from the same snapshot', () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-backup-'))
    folders.push(folder)
    const created = createProject(folder, 'study', 'backup-password')
    const projectPath = getProjectFilePath(folder, 'study')
    const dataPath = getDataFilePath(folder, 'study')
    const project = decryptProjectData(projectPath, created.encryptionKey)
    project.questionnaire.name = 'snapshot questionnaire'
    saveProject(
      folder,
      'study',
      project,
      created.encryptionKey,
      created.salt,
      created.passwordHash
    )
    createDataFile(dataPath, created.encryptionKey)
    appendRecord(dataPath, created.encryptionKey, {
      id: 'snapshot-record',
      answers: { q1: 'before' },
      createdAt: '',
      updatedAt: ''
    })

    const backupPath = createBackup(projectPath)
    expect(backupPath).not.toBeNull()

    project.questionnaire.name = 'newer questionnaire'
    saveProject(
      folder,
      'study',
      project,
      created.encryptionKey,
      created.salt,
      created.passwordHash
    )
    appendRecord(dataPath, created.encryptionKey, {
      id: 'newer-record',
      answers: { q1: 'after' },
      createdAt: '',
      updatedAt: ''
    })

    expect(restoreFromBackup(backupPath!, projectPath)).toBe(true)
    expect(decryptProjectData(projectPath, created.encryptionKey).questionnaire.name).toBe(
      'snapshot questionnaire'
    )
    expect(loadRecords(dataPath, created.encryptionKey).map((record) => record.id)).toEqual([
      'snapshot-record'
    ])
  })

  it('rejects a file outside the active project backup set without overwriting data', () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-backup-boundary-'))
    folders.push(folder)
    createProject(folder, 'study', 'backup-password')
    const projectPath = getProjectFilePath(folder, 'study')
    const original = readFileSync(projectPath)
    const arbitraryPath = join(folder, 'arbitrary.bin')
    writeFileSync(arbitraryPath, 'attacker-controlled bytes')

    expect(restoreFromBackup(arbitraryPath, projectPath)).toBe(false)
    expect(readFileSync(projectPath)).toEqual(original)
  })

  it('restores a valid snapshot made before the project had any records', () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-backup-empty-data-'))
    folders.push(folder)
    const created = createProject(folder, 'study', 'backup-password')
    const projectPath = getProjectFilePath(folder, 'study')
    const dataPath = getDataFilePath(folder, 'study')
    const backupPath = createBackup(projectPath)
    expect(backupPath).not.toBeNull()
    expect(getBackups(projectPath)).toEqual([
      expect.objectContaining({ filePath: backupPath, hasData: false })
    ])

    createDataFile(dataPath, created.encryptionKey)
    appendRecord(dataPath, created.encryptionKey, {
      id: 'created-after-backup',
      answers: { q1: 'later' },
      createdAt: '',
      updatedAt: ''
    })

    expect(restoreFromBackup(backupPath!, projectPath)).toBe(true)
    expect(existsSync(dataPath)).toBe(false)
  })

  it('lists only exact backup filenames for the selected project', () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-backup-list-'))
    folders.push(folder)
    createProject(folder, 'study', 'backup-password')
    createProject(folder, 'study-copy', 'backup-password')
    const projectPath = getProjectFilePath(folder, 'study')
    const otherProjectPath = getProjectFilePath(folder, 'study-copy')
    const selectedBackup = createBackup(projectPath)
    createBackup(otherProjectPath)

    expect(getBackups(projectPath).map((backup) => backup.filePath)).toEqual([selectedBackup])
  })
})
