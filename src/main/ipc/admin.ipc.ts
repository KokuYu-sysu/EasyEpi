import { ipcMain } from 'electron'
import { DataService } from '../services/data.service'
import { ExportService } from '../services/export.service'
import { BaselineService } from '../services/baseline.service'
import {
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL,
  parseAdminLoginRequest,
  parseAdminChangePasswordRequest,
  parseAdminGetRecordsRequest,
  parseAdminUpdateRecordRequest,
  parseAdminDeleteRecordsRequest
} from '@shared/admin-contract'
import { assertTrustedSender } from './types'

const dataService = new DataService()
const exportService = new ExportService()
const baselineService = new BaselineService()

// Admin password (in real app, this would be hashed and stored securely)
let adminPassword = 'admin123'
let loginAttempts = 0
let lockoutUntil: number | null = null

export function registerAdminIpcHandlers(
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(ADMIN_LOGIN_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { password } = parseAdminLoginRequest(request)

    // Check lockout
    if (lockoutUntil && Date.now() < lockoutUntil) {
      return { success: false, error: '账户已锁定', lockoutUntil }
    }

    if (password === adminPassword) {
      loginAttempts = 0
      lockoutUntil = null
      return { success: true }
    }

    loginAttempts++
    if (loginAttempts >= 5) {
      lockoutUntil = Date.now() + 5 * 60 * 1000
    }
    return { success: false, error: '密码错误' }
  })

  ipcMain.handle(ADMIN_LOGOUT_CHANNEL, async (event) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    return { ok: true }
  })

  ipcMain.handle(ADMIN_CHECK_SESSION_CHANNEL, async (event) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    return { isAuthenticated: true }
  })

  ipcMain.handle(ADMIN_CHANGE_PASSWORD_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { oldPassword, newPassword } = parseAdminChangePasswordRequest(request)

    if (oldPassword !== adminPassword) {
      return { success: false, error: '旧密码错误' }
    }

    adminPassword = newPassword
    return { success: true }
  })

  ipcMain.handle(ADMIN_GET_RECORDS_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const options = parseAdminGetRecordsRequest(request)
    return dataService.getRecords(options)
  })

  ipcMain.handle(ADMIN_UPDATE_RECORD_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { id, data } = parseAdminUpdateRecordRequest(request)
    await dataService.updateRecord(id, data)
    return { ok: true }
  })

  ipcMain.handle(ADMIN_DELETE_RECORDS_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { ids } = parseAdminDeleteRecordsRequest(request)
    await dataService.deleteRecords(ids)
    return { ok: true }
  })

  // Return dispose function
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