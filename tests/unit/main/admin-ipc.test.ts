import { describe, expect, it, vi } from 'vitest'

import {
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  ALL_ADMIN_CHANNELS
} from '@shared/admin-contract'
import { registerAdminIpcHandlers } from '../../../src/main/ipc/admin.ipc'
import { createProjectIpcState } from '../../../src/main/ipc/project.ipc'
import { AdminSessionService } from '../../../src/main/services/admin-session.service'

const packagedRendererUrl = 'file:///D:/EasyEpi/out/renderer/index.html'
const trustedEvent = { senderFrame: { url: packagedRendererUrl } }

type Handler = (
  event: { senderFrame?: { url: string } | null },
  request?: unknown
) => Promise<unknown>

function setup() {
  let now = 10_000
  const projectState = createProjectIpcState()
  projectState.currentProject = {
    meta: {
      name: 'Phase 4',
      folderPath: 'D:/phase4',
      createdAt: new Date(0).toISOString(),
      lastModifiedAt: new Date(0).toISOString()
    },
    questionnaire: { name: 'Phase 4', questions: [], conditionRules: [], keyQuestionIds: [] }
  }
  projectState.currentFilePath = 'D:/phase4/Phase 4.easyepi'
  projectState.currentHashHex = 'old-hash'
  projectState.currentSaltHex = 'old-salt'
  projectState.auth.encryptionKey = Buffer.alloc(32, 1)

  const sessionService = new AdminSessionService(projectState, {
    now: () => now,
    verifyPassword: (password) => password === 'project-password'
  })
  const dataService = {
    getRecords: vi.fn(async (options) => ({
      records: [],
      total: 0,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: 0
    })),
    updateRecord: vi.fn(async () => undefined),
    deleteRecords: vi.fn(async () => undefined)
  }
  const changeProjectPassword = vi.fn(async () => {
    projectState.currentHashHex = 'new-hash'
    projectState.currentSaltHex = 'new-salt'
    projectState.auth.encryptionKey = Buffer.alloc(32, 2)
    return { success: true }
  })
  const beforeChangePassword = vi.fn(async () => undefined)
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  }
  const dispose = registerAdminIpcHandlers(
    ipcMain,
    projectState,
    { sessionService, dataService, changeProjectPassword, beforeChangePassword },
    packagedRendererUrl
  )
  return {
    handlers,
    ipcMain,
    dispose,
    sessionService,
    dataService,
    changeProjectPassword,
    beforeChangePassword,
    advance(milliseconds: number) {
      now += milliseconds
    }
  }
}

describe('admin IPC', () => {
  it('registers and disposes every admin channel', () => {
    const { handlers, ipcMain, dispose } = setup()
    expect([...handlers.keys()]).toEqual(ALL_ADMIN_CHANNELS)

    dispose()

    for (const channel of ALL_ADMIN_CHANNELS) {
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(channel)
    }
  })

  it('checks the trusted sender before parsing or authenticating', async () => {
    const { handlers } = setup()
    const login = handlers.get(ADMIN_LOGIN_CHANNEL)!

    await expect(
      login({ senderFrame: { url: 'https://attacker.invalid' } }, { password: 'project-password' })
    ).rejects.toThrow('UNTRUSTED_IPC_SENDER')
  })

  it('uses the main-process session for login, session checks, and logout', async () => {
    const { handlers } = setup()

    await expect(
      handlers.get(ADMIN_LOGIN_CHANNEL)!(trustedEvent, { password: 'project-password' })
    ).resolves.toEqual({ success: true, expiresAt: 1_810_000 })
    await expect(handlers.get(ADMIN_CHECK_SESSION_CHANNEL)!(trustedEvent)).resolves.toEqual({
      isAuthenticated: true,
      expiresAt: 1_810_000
    })
    await expect(handlers.get(ADMIN_LOGOUT_CHANNEL)!(trustedEvent)).resolves.toEqual({ ok: true })
    await expect(handlers.get(ADMIN_CHECK_SESSION_CHANNEL)!(trustedEvent)).resolves.toEqual({
      isAuthenticated: false
    })
  })

  it('blocks record reads and writes until authenticated, then delegates validated requests', async () => {
    const { handlers, dataService } = setup()
    const getRecords = handlers.get(ADMIN_GET_RECORDS_CHANNEL)!

    await expect(getRecords(trustedEvent, { page: 1, pageSize: 50 })).rejects.toThrow(
      'ADMIN_SESSION_REQUIRED'
    )
    await handlers.get(ADMIN_LOGIN_CHANNEL)!(trustedEvent, { password: 'project-password' })
    await expect(getRecords(trustedEvent, { page: 1, pageSize: 50 })).resolves.toMatchObject({
      page: 1,
      pageSize: 50
    })
    await handlers.get(ADMIN_UPDATE_RECORD_CHANNEL)!(trustedEvent, {
      id: ' record-1 ',
      data: { answers: { q1: 'updated' } }
    })
    await handlers.get(ADMIN_DELETE_RECORDS_CHANNEL)!(trustedEvent, { ids: [' record-1 '] })

    expect(dataService.getRecords).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50,
      search: undefined,
      sortBy: undefined,
      sortOrder: undefined
    })
    expect(dataService.updateRecord).toHaveBeenCalledWith('record-1', {
      answers: { q1: 'updated' }
    })
    expect(dataService.deleteRecords).toHaveBeenCalledWith(['record-1'])
  })

  it('verifies the old project password before rotating encrypted files and preserves the session', async () => {
    const { handlers, changeProjectPassword, beforeChangePassword } = setup()
    await handlers.get(ADMIN_LOGIN_CHANNEL)!(trustedEvent, { password: 'project-password' })
    const changePassword = handlers.get(ADMIN_CHANGE_PASSWORD_CHANNEL)!

    await expect(
      changePassword(trustedEvent, { oldPassword: 'wrong', newPassword: 'new-password' })
    ).resolves.toEqual({ success: false, error: 'INVALID_OLD_PASSWORD' })
    expect(changeProjectPassword).not.toHaveBeenCalled()

    await expect(
      changePassword(trustedEvent, {
        oldPassword: 'project-password',
        newPassword: 'new-password'
      })
    ).resolves.toEqual({ success: true })
    expect(changeProjectPassword).toHaveBeenCalledWith({
      oldPassword: 'project-password',
      newPassword: 'new-password'
    })
    expect(beforeChangePassword.mock.invocationCallOrder[0])
      .toBeLessThan(changeProjectPassword.mock.invocationCallOrder[0]!)
    await expect(handlers.get(ADMIN_CHECK_SESSION_CHANNEL)!(trustedEvent)).resolves.toMatchObject({
      isAuthenticated: true
    })
  })

  it('does not start rekey when pending AI requests fail to settle', async () => {
    const { handlers, changeProjectPassword, beforeChangePassword } = setup()
    await handlers.get(ADMIN_LOGIN_CHANNEL)!(trustedEvent, { password: 'project-password' })
    beforeChangePassword.mockRejectedValueOnce(new Error('settlement failed'))

    await expect(handlers.get(ADMIN_CHANGE_PASSWORD_CHANNEL)!(trustedEvent, {
      oldPassword: 'project-password',
      newPassword: 'new-password'
    })).resolves.toEqual({ success: false, error: 'PASSWORD_CHANGE_FAILED' })
    expect(changeProjectPassword).not.toHaveBeenCalled()
  })

  it('returns a stable password error instead of exposing password-service exceptions', async () => {
    const { handlers, changeProjectPassword } = setup()
    await handlers.get(ADMIN_LOGIN_CHANNEL)!(trustedEvent, { password: 'project-password' })
    changeProjectPassword.mockRejectedValueOnce(new Error('WEAK_NEW_PASSWORD'))

    await expect(
      handlers.get(ADMIN_CHANGE_PASSWORD_CHANNEL)!(trustedEvent, {
        oldPassword: 'project-password',
        newPassword: 'weak-but-long'
      })
    ).resolves.toEqual({ success: false, error: 'WEAK_NEW_PASSWORD' })

    changeProjectPassword.mockRejectedValueOnce(new Error('D:/secret/project.easyepi failed'))
    await expect(
      handlers.get(ADMIN_CHANGE_PASSWORD_CHANNEL)!(trustedEvent, {
        oldPassword: 'project-password',
        newPassword: 'another-password'
      })
    ).resolves.toEqual({ success: false, error: 'PASSWORD_CHANGE_FAILED' })
  })
})
