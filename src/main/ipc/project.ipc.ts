import type { ProjectData } from '@shared/types/project'
import {
  PROJECT_CREATE_CHANNEL,
  PROJECT_OPEN_CHANNEL,
  PROJECT_SAVE_CHANNEL,
  PROJECT_CLOSE_CHANNEL,
  PROJECT_BACKUP_CHANNEL,
  PROJECT_RESTORE_CHANNEL,
  PROJECT_LIST_BACKUPS_CHANNEL,
  parseProjectCreateRequest,
  parseProjectOpenRequest,
  parseProjectRestoreRequest,
  type ProjectResult,
  type BackupListResult
} from '@shared/qnaire-contract'

import { createAuthService, lock } from '../services/auth.service'
import {
  createProject,
  saveProject,
  readProjectHeader,
  decryptProjectData,
  verifyAndDeriveKey,
  getProjectFilePath
} from '../services/project.service'
import { recoverProjectRekeyTransaction } from '../services/project-rekey.service'
import { loadRecords, resolveProjectDataFilePath } from '../services/record.service'
import {
  createBackup,
  restoreFromBackup,
  getBackups,
  shouldCreateBackup,
  resetBackupTimer,
  startBackupTimer
} from '../services/backup.service'

import { type IpcMainLike, type IpcInvokeEventLike, assertTrustedSender } from './types'

export interface ProjectIpcState {
  currentProject: ProjectData | null
  currentFilePath: string | null
  currentSaltHex: string
  currentHashHex: string
  auth: ReturnType<typeof createAuthService>
}

export function createProjectIpcState(): ProjectIpcState {
  return {
    currentProject: null,
    currentFilePath: null,
    currentSaltHex: '',
    currentHashHex: '',
    auth: createAuthService()
  }
}

function getProjectErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  switch (message) {
    case 'PROJECT_FILE_TOO_SHORT':
      return '项目文件不完整或已损坏：文件太小'
    case 'INVALID_PROJECT_MAGIC':
      return '文件格式错误：不是有效的 EasyEpi 项目文件'
    case 'UNSUPPORTED_PROJECT_VERSION':
      return '项目文件版本不兼容：请更新 EasyEpi 或使用兼容版本'
    case 'CIPHERTEXT_TOO_SHORT':
      return '项目文件损坏：加密数据不完整'
    case 'PROJECT_ALREADY_EXISTS':
      return '项目已存在：请使用不同的项目名称'
    default:
      if (message.includes('Unsupported state or unable to authenticate data')) {
        return '解密失败：密码错误或文件已损坏'
      }
      return `项目操作失败：${message}`
  }
}

export function registerProjectIpc(
  ipcMain: IpcMainLike,
  state: ProjectIpcState,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  let stopPeriodicBackups: () => void = () => undefined

  const startPeriodicBackups = () => {
    stopPeriodicBackups()
    stopPeriodicBackups = startBackupTimer(() => {
      if (!state.currentFilePath || !state.currentProject || !state.auth.encryptionKey) return
      const dataFilePath = resolveProjectDataFilePath(
        state.currentFilePath,
        state.currentProject.meta.name
      )
      if (createBackup(state.currentFilePath, dataFilePath)) {
        resetBackupTimer(state.currentFilePath)
      }
    })
  }

  ipcMain.handle(PROJECT_CREATE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseProjectCreateRequest(rawRequest)

    try {
      const result = createProject(request.folderPath, request.name, request.password)
      state.currentProject = {
        meta: result.meta,
        questionnaire: {
          name: request.name,
          questions: [],
          conditionRules: [],
          keyQuestionIds: [],
          derivedVariables: []
        }
      }
      state.currentFilePath = getProjectFilePath(request.folderPath, request.name)
      state.currentSaltHex = result.salt
      state.currentHashHex = result.passwordHash
      state.auth.encryptionKey = result.encryptionKey
      state.auth.passwordData = { hash: result.passwordHash, salt: result.salt }
      startPeriodicBackups()

      return { ok: true, meta: result.meta } satisfies ProjectResult
    } catch (error) {
      return { ok: false, error: getProjectErrorMessage(error) } satisfies ProjectResult
    }
  })

  ipcMain.handle(PROJECT_OPEN_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseProjectOpenRequest(rawRequest)

    try {
      // Recover an interrupted password-change transaction before reading either file.
      recoverProjectRekeyTransaction(request.filePath)
      // Read header to get salt and password hash (unencrypted)
      const header = readProjectHeader(request.filePath)

      let key: Buffer
      if (header.hashHex && header.saltHex) {
        // Verify password and derive key
        const derivedKey = verifyAndDeriveKey(request.password, header.saltHex, header.hashHex)
        if (!derivedKey) {
          return { ok: false, error: '密码错误' } satisfies ProjectResult
        }
        key = derivedKey
      } else {
        return { ok: false, error: '项目文件格式错误：缺少密码数据' } satisfies ProjectResult
      }

      // Decrypt the payload with the derived key
      const data = decryptProjectData(request.filePath, key)
      state.currentProject = data
      state.currentFilePath = request.filePath
      state.currentSaltHex = header.saltHex
      state.currentHashHex = header.hashHex
      state.auth.encryptionKey = key
      state.auth.passwordData = { hash: header.hashHex, salt: header.saltHex }
      startPeriodicBackups()
      return { ok: true, meta: data.meta } satisfies ProjectResult
    } catch (error) {
      return { ok: false, error: getProjectErrorMessage(error) } satisfies ProjectResult
    }
  })

  ipcMain.handle(PROJECT_SAVE_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)

    if (!state.currentProject) {
      return { ok: false, error: '没有打开的项目' } satisfies ProjectResult
    }

    const key = state.auth.encryptionKey
    if (!key) {
      return { ok: false, error: '未解锁项目' } satisfies ProjectResult
    }

    try {
      // Create automatic backup if interval has elapsed
      if (state.currentFilePath && shouldCreateBackup(state.currentFilePath)) {
        const dataFilePath = resolveProjectDataFilePath(
          state.currentFilePath,
          state.currentProject.meta.name
        )
        const backupPath = createBackup(state.currentFilePath, dataFilePath)
        if (backupPath) resetBackupTimer(state.currentFilePath)
      }

      saveProject(
        state.currentProject.meta.folderPath,
        state.currentProject.meta.name,
        state.currentProject,
        key,
        state.currentSaltHex,
        state.currentHashHex
      )
      return { ok: true, meta: state.currentProject.meta } satisfies ProjectResult
    } catch (error) {
      return { ok: false, error: getProjectErrorMessage(error) } satisfies ProjectResult
    }
  })

  ipcMain.handle(PROJECT_BACKUP_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)

    if (!state.currentFilePath) {
      return { ok: false, error: '没有打开的项目' } satisfies ProjectResult
    }

    try {
      const dataFilePath = state.currentProject
        ? resolveProjectDataFilePath(state.currentFilePath, state.currentProject.meta.name)
        : undefined
      const backupPath = createBackup(state.currentFilePath, dataFilePath)
      if (backupPath) {
        resetBackupTimer(state.currentFilePath)
        startPeriodicBackups()
        return { ok: true, meta: state.currentProject?.meta } satisfies ProjectResult
      }
      return { ok: false, error: '创建备份失败' } satisfies ProjectResult
    } catch (error) {
      return { ok: false, error: getProjectErrorMessage(error) } satisfies ProjectResult
    }
  })

  ipcMain.handle(PROJECT_LIST_BACKUPS_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)

    if (!state.currentFilePath) {
      return { ok: true, backups: [] } satisfies BackupListResult
    }

    try {
      const dataFilePath = state.currentProject
        ? resolveProjectDataFilePath(state.currentFilePath, state.currentProject.meta.name)
        : undefined
      const backups = getBackups(state.currentFilePath, dataFilePath)
      return { ok: true, backups } satisfies BackupListResult
    } catch {
      return { ok: true, backups: [] } satisfies BackupListResult
    }
  })

  ipcMain.handle(PROJECT_RESTORE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseProjectRestoreRequest(rawRequest)

    if (!state.currentFilePath) {
      return { ok: false, error: '没有打开的项目' } satisfies ProjectResult
    }

    try {
      const key = state.auth.encryptionKey
      if (!key || !state.currentProject) {
        return { ok: false, error: '未解锁项目' } satisfies ProjectResult
      }
      const dataFilePath = resolveProjectDataFilePath(
        state.currentFilePath,
        state.currentProject.meta.name
      )
      const success = restoreFromBackup(request.backupPath, state.currentFilePath, {
        dataFilePath,
        validateProject: (path) => {
          decryptProjectData(path, key)
        },
        validateData: (path) => {
          loadRecords(path, key)
        }
      })
      if (success) {
        // Reload the project after restore
        state.currentProject = decryptProjectData(state.currentFilePath, key)
        return { ok: true, meta: state.currentProject?.meta } satisfies ProjectResult
      }
      return { ok: false, error: '恢复备份失败' } satisfies ProjectResult
    } catch (error) {
      return { ok: false, error: getProjectErrorMessage(error) } satisfies ProjectResult
    }
  })

  ipcMain.handle(PROJECT_CLOSE_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    state.currentProject = null
    state.currentFilePath = null
    state.currentSaltHex = ''
    state.currentHashHex = ''
    lock(state.auth)
    stopPeriodicBackups()
    stopPeriodicBackups = () => undefined
    return { ok: true }
  })

  return () => {
    stopPeriodicBackups()
    ipcMain.removeHandler(PROJECT_CREATE_CHANNEL)
    ipcMain.removeHandler(PROJECT_OPEN_CHANNEL)
    ipcMain.removeHandler(PROJECT_SAVE_CHANNEL)
    ipcMain.removeHandler(PROJECT_BACKUP_CHANNEL)
    ipcMain.removeHandler(PROJECT_LIST_BACKUPS_CHANNEL)
    ipcMain.removeHandler(PROJECT_RESTORE_CHANNEL)
    ipcMain.removeHandler(PROJECT_CLOSE_CHANNEL)
  }
}
