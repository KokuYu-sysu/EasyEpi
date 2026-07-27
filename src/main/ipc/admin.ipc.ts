import type {
  AdminChangePasswordRequest,
  AdminChangePasswordResult,
  AdminGetRecordsRequest,
  AdminRecordsResult,
  AdminUpdateRecordRequest
} from '@shared/admin-contract'
import {
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  parseAdminChangePasswordRequest,
  parseAdminDeleteRecordsRequest,
  parseAdminGetRecordsRequest,
  parseAdminLoginRequest,
  parseAdminUpdateRecordRequest
} from '@shared/admin-contract'

import type { AdminSessionService } from '../services/admin-session.service'
import type { ProjectIpcState } from './project.ipc'
import { assertTrustedSender, type IpcInvokeEventLike, type IpcMainLike } from './types'

export interface AdminDataService {
  getRecords(options: AdminGetRecordsRequest): Promise<AdminRecordsResult>
  updateRecord(id: string, data: AdminUpdateRecordRequest['data']): Promise<void>
  deleteRecords(ids: string[]): Promise<void>
}

export interface AdminIpcServices {
  sessionService: AdminSessionService
  dataService: AdminDataService
  changeProjectPassword?: (
    request: AdminChangePasswordRequest
  ) => Promise<AdminChangePasswordResult>
}

const SAFE_PASSWORD_CHANGE_ERRORS = new Set([
  'INVALID_OLD_PASSWORD',
  'NO_PROJECT_OPEN',
  'PASSWORD_UNCHANGED',
  'PROJECT_NOT_UNLOCKED',
  'WEAK_NEW_PASSWORD'
])

function passwordChangeError(error: unknown): AdminChangePasswordResult {
  const code = error instanceof Error ? error.message : ''
  return {
    success: false,
    error: SAFE_PASSWORD_CHANGE_ERRORS.has(code) ? code : 'PASSWORD_CHANGE_FAILED'
  }
}

export function registerAdminIpcHandlers(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  services: AdminIpcServices,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  const { sessionService, dataService, changeProjectPassword } = services

  ipcMain.handle(
    ADMIN_LOGIN_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      const request = parseAdminLoginRequest(rawRequest)
      return sessionService.login(request.password)
    }
  )

  ipcMain.handle(ADMIN_LOGOUT_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    sessionService.logout()
    return { ok: true }
  })

  ipcMain.handle(ADMIN_CHECK_SESSION_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    return sessionService.checkSession()
  })

  ipcMain.handle(
    ADMIN_CHANGE_PASSWORD_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      sessionService.authorize()
      const request = parseAdminChangePasswordRequest(rawRequest)
      if (!projectState.currentProject || !projectState.auth.encryptionKey) {
        return { success: false, error: 'PROJECT_NOT_UNLOCKED' }
      }
      if (!sessionService.verifyCurrentPassword(request.oldPassword)) {
        return { success: false, error: 'INVALID_OLD_PASSWORD' }
      }
      if (!changeProjectPassword) {
        return { success: false, error: 'PASSWORD_CHANGE_UNAVAILABLE' }
      }

      try {
        const result = await changeProjectPassword(request)
        if (result.success) sessionService.rebindAfterPasswordChange()
        return result
      } catch (error) {
        return passwordChangeError(error)
      }
    }
  )

  ipcMain.handle(
    ADMIN_GET_RECORDS_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      sessionService.authorize()
      return dataService.getRecords(parseAdminGetRecordsRequest(rawRequest))
    }
  )

  ipcMain.handle(
    ADMIN_UPDATE_RECORD_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      sessionService.authorize()
      const { id, data } = parseAdminUpdateRecordRequest(rawRequest)
      await dataService.updateRecord(id, data)
      return { ok: true }
    }
  )

  ipcMain.handle(
    ADMIN_DELETE_RECORDS_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      sessionService.authorize()
      const { ids } = parseAdminDeleteRecordsRequest(rawRequest)
      await dataService.deleteRecords(ids)
      return { ok: true }
    }
  )

  return () => {
    ipcMain.removeHandler(ADMIN_LOGIN_CHANNEL)
    ipcMain.removeHandler(ADMIN_LOGOUT_CHANNEL)
    ipcMain.removeHandler(ADMIN_CHECK_SESSION_CHANNEL)
    ipcMain.removeHandler(ADMIN_CHANGE_PASSWORD_CHANNEL)
    ipcMain.removeHandler(ADMIN_GET_RECORDS_CHANNEL)
    ipcMain.removeHandler(ADMIN_UPDATE_RECORD_CHANNEL)
    ipcMain.removeHandler(ADMIN_DELETE_RECORDS_CHANNEL)
  }
}
