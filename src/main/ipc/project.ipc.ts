import type { ProjectData } from '@shared/types/project'
import {
  PROJECT_CREATE_CHANNEL,
  PROJECT_OPEN_CHANNEL,
  PROJECT_SAVE_CHANNEL,
  PROJECT_CLOSE_CHANNEL,
  parseProjectCreateRequest,
  parseProjectOpenRequest,
  type ProjectResult
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

export function registerProjectIpc(
  ipcMain: IpcMainLike,
  state: ProjectIpcState,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {

  ipcMain.handle(PROJECT_CREATE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseProjectCreateRequest(rawRequest)

    const result = createProject(request.folderPath, request.name, request.password)
    state.currentProject = {
      meta: result.meta,
      questionnaire: { name: request.name, questions: [], conditionRules: [], keyQuestionIds: [] }
    }
    state.currentFilePath = getProjectFilePath(request.folderPath, request.name)
    state.currentSaltHex = result.salt
    state.currentHashHex = result.passwordHash
    state.auth.encryptionKey = result.encryptionKey
    state.auth.passwordData = { hash: result.passwordHash, salt: result.salt }

    return { ok: true, meta: result.meta } satisfies ProjectResult
  })

  ipcMain.handle(PROJECT_OPEN_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseProjectOpenRequest(rawRequest)

    // Read header to get salt and password hash (unencrypted)
    const header = readProjectHeader(request.filePath)

    if (header.hashHex && header.saltHex) {
      // Verify password and derive key
      const key = verifyAndDeriveKey(request.password, header.saltHex, header.hashHex)
      if (!key) {
        return { ok: false, error: '密码错误' } satisfies ProjectResult
      }
      state.auth.encryptionKey = key
      state.auth.passwordData = { hash: header.hashHex, salt: header.saltHex }
    } else {
      return { ok: false, error: '项目文件格式错误：缺少密码数据' } satisfies ProjectResult
    }

    // Decrypt the payload with the derived key
    try {
      const data = decryptProjectData(request.filePath, state.auth.encryptionKey)
      state.currentProject = data
      state.currentFilePath = request.filePath
      state.currentSaltHex = header.saltHex
      state.currentHashHex = header.hashHex
      return { ok: true, meta: data.meta } satisfies ProjectResult
    } catch {
      return { ok: false, error: '解密失败：文件可能已损坏' } satisfies ProjectResult
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

    saveProject(
      state.currentProject.meta.folderPath,
      state.currentProject.meta.name,
      state.currentProject,
      key,
      state.currentSaltHex,
      state.currentHashHex
    )
    return { ok: true, meta: state.currentProject.meta } satisfies ProjectResult
  })

  ipcMain.handle(PROJECT_CLOSE_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    state.currentProject = null
    state.currentFilePath = null
    state.currentSaltHex = ''
    state.currentHashHex = ''
    lock(state.auth)
    return { ok: true }
  })

  return () => {
    ipcMain.removeHandler(PROJECT_CREATE_CHANNEL)
    ipcMain.removeHandler(PROJECT_OPEN_CHANNEL)
    ipcMain.removeHandler(PROJECT_SAVE_CHANNEL)
    ipcMain.removeHandler(PROJECT_CLOSE_CHANNEL)
  }
}
