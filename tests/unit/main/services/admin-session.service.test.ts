import { describe, expect, it, vi } from 'vitest'

import { createProjectIpcState } from '../../../../src/main/ipc/project.ipc'
import { AdminSessionService } from '../../../../src/main/services/admin-session.service'

function setup() {
  let now = 1_000_000
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
  projectState.currentSaltHex = 'salt'
  projectState.currentHashHex = 'hash'
  projectState.auth.encryptionKey = Buffer.alloc(32, 1)
  projectState.auth.passwordData = { hash: 'hash', salt: 'salt' }
  const verifyPassword = vi.fn((password: string) => password === 'project-password')
  const service = new AdminSessionService(projectState, {
    now: () => now,
    verifyPassword
  })
  return {
    projectState,
    service,
    verifyPassword,
    advance(milliseconds: number) {
      now += milliseconds
    }
  }
}

describe('AdminSessionService', () => {
  it('uses the currently opened project password and rejects access without an unlocked project', () => {
    const { projectState, service, verifyPassword } = setup()
    projectState.auth.encryptionKey = null

    expect(service.login('project-password')).toEqual({
      success: false,
      error: 'PROJECT_NOT_UNLOCKED'
    })
    expect(verifyPassword).not.toHaveBeenCalled()
    expect(service.checkSession()).toEqual({ isAuthenticated: false })
  })

  it('locks for five minutes after five consecutive failures', () => {
    const { service, verifyPassword, advance } = setup()

    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(service.login('wrong')).toEqual({
        success: false,
        error: 'INVALID_ADMIN_PASSWORD'
      })
    }
    const locked = service.login('wrong')
    expect(locked).toEqual({
      success: false,
      error: 'ADMIN_LOGIN_LOCKED',
      lockoutUntil: 1_300_000
    })

    expect(service.login('project-password')).toEqual(locked)
    expect(verifyPassword).toHaveBeenCalledTimes(5)

    advance(300_000)
    expect(service.login('project-password')).toEqual({
      success: true,
      expiresAt: 3_100_000
    })
  })

  it('expires after thirty minutes of inactivity and slides on authorized activity', () => {
    const { service, advance } = setup()

    expect(service.login('project-password')).toEqual({
      success: true,
      expiresAt: 2_800_000
    })
    advance(1_200_000)
    expect(service.authorize()).toEqual({ isAuthenticated: true, expiresAt: 4_000_000 })
    advance(1_799_999)
    expect(service.checkSession()).toEqual({ isAuthenticated: true, expiresAt: 4_000_000 })
    advance(1)
    expect(service.checkSession()).toEqual({ isAuthenticated: false })
    expect(() => service.authorize()).toThrow('ADMIN_SESSION_REQUIRED')
  })

  it('invalidates a session when the project is closed', () => {
    const { projectState, service } = setup()
    service.login('project-password')
    projectState.currentProject = null
    expect(service.checkSession()).toEqual({ isAuthenticated: false })
  })

  it('invalidates a session when the project is locked', () => {
    const { projectState, service } = setup()
    service.login('project-password')
    projectState.auth.encryptionKey = null
    expect(service.checkSession()).toEqual({ isAuthenticated: false })
  })

  it('invalidates a session when a project is reopened with a new key', () => {
    const { projectState, service } = setup()
    service.login('project-password')
    projectState.auth.encryptionKey = Buffer.alloc(32, 2)
    expect(service.checkSession()).toEqual({ isAuthenticated: false })
  })

  it('logout clears the session immediately', () => {
    const { service } = setup()
    service.login('project-password')
    service.logout()
    expect(service.checkSession()).toEqual({ isAuthenticated: false })
  })

  it('does not let logout or a temporarily locked project reset failed login attempts', () => {
    const { projectState, service } = setup()
    for (let attempt = 0; attempt < 4; attempt += 1) service.login('wrong')

    service.logout()
    projectState.auth.encryptionKey = null
    expect(service.login('wrong')).toEqual({ success: false, error: 'PROJECT_NOT_UNLOCKED' })
    projectState.auth.encryptionKey = Buffer.alloc(32, 4)

    expect(service.login('wrong')).toEqual({
      success: false,
      error: 'ADMIN_LOGIN_LOCKED',
      lockoutUntil: 1_300_000
    })
  })

  it('can rebind an authenticated session after a successful project password rotation', () => {
    const { projectState, service, advance } = setup()
    service.login('project-password')
    advance(100)
    projectState.currentHashHex = 'new-hash'
    projectState.currentSaltHex = 'new-salt'
    projectState.auth.encryptionKey = Buffer.alloc(32, 3)

    service.rebindAfterPasswordChange()

    expect(service.checkSession()).toEqual({ isAuthenticated: true, expiresAt: 2_800_100 })
  })
})
