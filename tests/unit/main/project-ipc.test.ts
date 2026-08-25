import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PROJECT_OPEN_CHANNEL,
  PROJECT_CREATE_CHANNEL,
  PROJECT_RESTORE_CHANNEL
} from '@shared/qnaire-contract'
import {
  createProjectIpcState,
  registerProjectIpc
} from '../../../src/main/ipc/project.ipc'
import type { IpcInvokeEventLike, IpcMainLike } from '../../../src/main/ipc/types'
import { createBackup, getBackups } from '../../../src/main/services/backup.service'
import { AISessionRepository } from '../../../src/main/services/ai-session.repository'
import { isUUIDv4 } from '../../../src/shared/types/project'
import {
  createProject,
  decryptProjectData,
  getProjectFilePath,
  saveProject,
  saveProjectToPath
} from '../../../src/main/services/project.service'

type Handler = (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>

function createHarness() {
  const handlers = new Map<string, Handler>()
  const ipcMain: IpcMainLike = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    }
  }
  return { handlers, ipcMain }
}

const packagedUrl = 'file:///easyepi/index.html'
const trustedEvent: IpcInvokeEventLike = { senderFrame: { url: packagedUrl } }

describe('Project IPC recovery safety', () => {
  const folders: string[] = []

  afterEach(() => {
    vi.useRealTimers()
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('creates a periodic snapshot while a project remains open without manual saves', async () => {
    vi.useFakeTimers()
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-project-timer-'))
    folders.push(folder)
    const state = createProjectIpcState()
    const { handlers, ipcMain } = createHarness()
    const dispose = registerProjectIpc(ipcMain, state, packagedUrl)

    await handlers.get(PROJECT_CREATE_CHANNEL)!(trustedEvent, {
      folderPath: folder,
      name: 'timed',
      password: 'timed-password'
    })
    const projectPath = getProjectFilePath(folder, 'timed')
    expect(getBackups(projectPath)).toHaveLength(0)

    vi.advanceTimersByTime(5 * 60 * 1_000)

    expect(getBackups(projectPath)).toHaveLength(1)
    dispose()
  })

  it('keeps the active project and key when opening a damaged project fails', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-project-open-'))
    folders.push(folder)
    const active = createProject(folder, 'active', 'active-password')
    const damaged = createProject(folder, 'damaged', 'damaged-password')
    const activePath = getProjectFilePath(folder, 'active')
    const damagedPath = getProjectFilePath(folder, 'damaged')
    truncateSync(damagedPath, 160)

    const state = createProjectIpcState()
    state.currentProject = decryptProjectData(activePath, active.encryptionKey)
    state.currentFilePath = activePath
    state.currentSaltHex = active.salt
    state.currentHashHex = active.passwordHash
    state.auth.encryptionKey = Buffer.from(active.encryptionKey)
    state.auth.passwordData = { hash: active.passwordHash, salt: active.salt }
    const originalKey = Buffer.from(state.auth.encryptionKey)
    const { handlers, ipcMain } = createHarness()
    const cancelAIRequests = vi.fn()
    registerProjectIpc(
      ipcMain,
      state,
      packagedUrl,
      undefined,
      () => undefined,
      cancelAIRequests
    )

    await expect(
      handlers.get(PROJECT_OPEN_CHANNEL)!(trustedEvent, {
        filePath: damagedPath,
        password: 'damaged-password'
      })
    ).resolves.toMatchObject({ ok: false })
    expect(state.currentFilePath).toBe(activePath)
    expect(state.currentProject?.meta.name).toBe('active')
    expect(state.auth.encryptionKey).toEqual(originalKey)
    expect(state.auth.passwordData).toEqual({ hash: active.passwordHash, salt: active.salt })
    expect(damaged.encryptionKey).not.toEqual(originalKey)
    expect(cancelAIRequests).toHaveBeenCalledOnce()
  })

  it('rejects a backup whose unauthenticated header differs from current state', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-project-restore-'))
    folders.push(folder)
    const created = createProject(folder, 'active', 'active-password')
    const projectPath = getProjectFilePath(folder, 'active')
    const backupPath = createBackup(projectPath)!
    const backupBytes = readFileSync(backupPath)
    backupBytes[28] = backupBytes[28] === 0x61 ? 0x62 : 0x61
    writeFileSync(backupPath, backupBytes)
    const currentProject = decryptProjectData(projectPath, created.encryptionKey)
    currentProject.questionnaire.name = 'must remain current'
    saveProject(
      folder,
      'active',
      currentProject,
      created.encryptionKey,
      created.salt,
      created.passwordHash
    )
    const original = readFileSync(projectPath)

    const state = createProjectIpcState()
    state.currentProject = currentProject
    state.currentFilePath = projectPath
    state.currentSaltHex = created.salt
    state.currentHashHex = created.passwordHash
    state.auth.encryptionKey = Buffer.from(created.encryptionKey)
    state.auth.passwordData = { hash: created.passwordHash, salt: created.salt }
    const { handlers, ipcMain } = createHarness()
    registerProjectIpc(ipcMain, state, packagedUrl)

    await expect(
      handlers.get(PROJECT_RESTORE_CHANNEL)!(trustedEvent, { backupPath })
    ).resolves.toMatchObject({ ok: false })
    expect(readFileSync(projectPath)).toEqual(original)
    expect(state.currentProject?.meta.name).toBe('active')
  })

  it('cancels AI requests before activating a restored project object', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-project-restore-switch-'))
    folders.push(folder)
    const created = createProject(folder, 'active', 'active-password')
    const projectPath = getProjectFilePath(folder, 'active')
    const project = decryptProjectData(projectPath, created.encryptionKey)
    project.questionnaire.name = 'Backed up'
    saveProjectToPath(
      projectPath, project, created.encryptionKey, created.salt, created.passwordHash
    )
    const backupPath = createBackup(projectPath)!
    project.questionnaire.name = 'Current'
    saveProjectToPath(
      projectPath, project, created.encryptionKey, created.salt, created.passwordHash
    )

    const state = createProjectIpcState()
    state.currentProject = project
    state.currentFilePath = projectPath
    state.currentSaltHex = created.salt
    state.currentHashHex = created.passwordHash
    state.auth.encryptionKey = Buffer.from(created.encryptionKey)
    const cancelAIRequests = vi.fn(() => {
      expect(state.currentProject).toBe(project)
    })
    const { handlers, ipcMain } = createHarness()
    registerProjectIpc(
      ipcMain, state, packagedUrl, undefined, () => undefined, cancelAIRequests
    )

    await expect(
      handlers.get(PROJECT_RESTORE_CHANNEL)!(trustedEvent, { backupPath })
    ).resolves.toMatchObject({ ok: true })
    expect(cancelAIRequests).toHaveBeenCalledOnce()
    expect(state.currentProject).not.toBe(project)
    expect(state.currentProject?.questionnaire.name).toBe('Backed up')
  })

  it('clears recovered AI temp at the exact moved project path', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-project-moved-'))
    folders.push(folder)
    const created = createProject(folder, 'study', 'study-password')
    const originalPath = getProjectFilePath(folder, 'study')
    const project = decryptProjectData(originalPath, created.encryptionKey)
    project.questionnaireRevision = '11111111-1111-1111-8111-111111111111'
    const repository = new AISessionRepository(
      project,
      () => '123e4567-e89b-42d3-a456-426614174000'
    )
    const session = repository.create({
      promptId: 'assistant',
      promptVersion: '1',
      promptHash: 'hash',
      harnessVersion: '1',
      schemaVersion: 1
    }).value
    project.aiAssistant!.sessions[session.manifest.sessionId]!.temp.runs['run-1'] = {
      runId: 'run-1',
      versionStamp: session.manifest.versionStamp,
      createdAt: '2026-08-25T00:00:00.000Z',
      values: { partial: true }
    }
    project.meta.lastModifiedAt = '2000-01-01T00:00:00.000Z'
    expect(() =>
      saveProjectToPath(
        join(folder, 'missing', 'cannot-write.easyepi'),
        project,
        created.encryptionKey,
        created.salt,
        created.passwordHash
      )
    ).toThrow()
    expect(project.meta.lastModifiedAt).toBe('2000-01-01T00:00:00.000Z')
    saveProject(
      folder,
      'study',
      project,
      created.encryptionKey,
      created.salt,
      created.passwordHash
    )
    const movedDirectory = join(folder, 'moved')
    const movedPath = join(movedDirectory, 'renamed.easyepi')
    mkdirSync(movedDirectory)
    renameSync(originalPath, movedPath)

    const state = createProjectIpcState()
    const { handlers, ipcMain } = createHarness()
    registerProjectIpc(ipcMain, state, packagedUrl)

    await expect(
      handlers.get(PROJECT_OPEN_CHANNEL)!(trustedEvent, {
        filePath: movedPath,
        password: 'study-password'
      })
    ).resolves.toMatchObject({ ok: true })
    expect(state.currentFilePath).toBe(movedPath)
    expect(
      decryptProjectData(movedPath, created.encryptionKey)
        .aiAssistant!.sessions[session.manifest.sessionId]!.temp.runs
    ).toEqual({})
    expect(isUUIDv4(decryptProjectData(movedPath, created.encryptionKey).questionnaireRevision))
      .toBe(true)
    expect(existsSync(originalPath)).toBe(false)
  })
})
