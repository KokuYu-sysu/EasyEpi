import type { ProjectData } from '@shared/types/project'
import {
  PROJECT_CREATE_CHANNEL,
  PROJECT_OPEN_CHANNEL,
  PROJECT_SAVE_CHANNEL,
  PROJECT_CLOSE_CHANNEL,
  parseProjectCreateRequest,
  parseProjectOpenRequest,
  parseProjectSaveRequest,
  type ProjectResult
} from '@shared/qnaire-contract'

import { createAuthService, lock, setPassword, unlockWithPassword } from '../services/auth.service'
import { createProject, saveProject, loadProject, getProjectFilePath } from '../services/project.service'

import { type IpcMainLike, type IpcInvokeEventLike, assertTrustedSender } from './types'

export interface ProjectIpcState {
  currentProject: ProjectData | null
  currentFilePath: string | null
  auth: ReturnType<typeof createAuthService>
}

export function createProjectIpcState(): ProjectIpcState {
  return {
    currentProject: null,
    currentFilePath: null,
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

    const { passwordData, encryptionKey } = setPassword(state.auth, request.password)
    const meta = createProject(request.folderPath, request.name, encryptionKey)

    const data: ProjectData = {
      meta,
      questionnaire: {
        name: request.name,
        questions: [],
        conditionRules: [],
        keyQuestionIds: []
      },
      passwordHash: passwordData.hash,
      recoveryKeyHash: undefined
    }

    saveProject(request.folderPath, request.name, data, encryptionKey)
    state.currentProject = data
    state.currentFilePath = getProjectFilePath(request.folderPath, request.name)

    return { ok: true, meta } satisfies ProjectResult
  })

  ipcMain.handle(PROJECT_OPEN_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseProjectOpenRequest(rawRequest)

    const data = loadProject(request.filePath, Buffer.alloc(32))

    if (data.passwordHash) {
      const unlocked = unlockWithPassword(
        state.auth,
        request.password,
        data.passwordHash,
        ''
      )
      if (!unlocked) {
        return { ok: false, error: '密码错误' } satisfies ProjectResult
      }
    } else {
      setPassword(state.auth, request.password)
      state.currentProject = data
    }

    state.currentProject = data
    state.currentFilePath = request.filePath

    return { ok: true, meta: data.meta } satisfies ProjectResult
  })

  ipcMain.handle(PROJECT_SAVE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseProjectSaveRequest(rawRequest)

    if (!state.currentProject) {
      return { ok: false, error: '没有打开的项目' } satisfies ProjectResult
    }

    const key = state.auth.encryptionKey
    if (!key) {
      return { ok: false, error: '未解锁项目' } satisfies ProjectResult
    }

    saveProject(request.folderPath, state.currentProject.meta.name, state.currentProject, key)
    return { ok: true, meta: state.currentProject.meta } satisfies ProjectResult
  })

  ipcMain.handle(PROJECT_CLOSE_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    state.currentProject = null
    state.currentFilePath = null
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
