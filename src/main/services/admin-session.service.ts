import type { AdminLoginResult, AdminSessionResult } from '@shared/admin-contract'

import type { ProjectIpcState } from '../ipc/project.ipc'
import { verifyPassword as verifyStoredPassword } from './crypto.service'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 5 * 60 * 1000
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000

interface AdminSessionOptions {
  now?: () => number
  verifyPassword?: (password: string, storedHash: string, storedSalt: string) => boolean
}

interface ProjectBinding {
  filePath: string
  passwordHash: string
  encryptionKey: Buffer
}

export class AdminSessionService {
  private readonly now: () => number
  private readonly verifyPassword: (
    password: string,
    storedHash: string,
    storedSalt: string
  ) => boolean
  private failedAttempts = 0
  private lockoutUntil: number | null = null
  private expiresAt: number | null = null
  private binding: ProjectBinding | null = null

  constructor(
    private readonly projectState: ProjectIpcState,
    options: AdminSessionOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.verifyPassword = options.verifyPassword ?? verifyStoredPassword
  }

  login(password: string): AdminLoginResult {
    const currentProject = this.getUnlockedProjectBinding()
    if (!currentProject) {
      this.clearAuthentication()
      return { success: false, error: 'PROJECT_NOT_UNLOCKED' }
    }

    const now = this.now()
    if (this.lockoutUntil !== null && now < this.lockoutUntil) {
      return {
        success: false,
        error: 'ADMIN_LOGIN_LOCKED',
        lockoutUntil: this.lockoutUntil
      }
    }
    if (this.lockoutUntil !== null) {
      this.failedAttempts = 0
      this.lockoutUntil = null
    }

    if (!this.verifyPassword(password, this.projectState.currentHashHex, this.projectState.currentSaltHex)) {
      this.failedAttempts += 1
      if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.lockoutUntil = now + LOCKOUT_DURATION_MS
        return {
          success: false,
          error: 'ADMIN_LOGIN_LOCKED',
          lockoutUntil: this.lockoutUntil
        }
      }
      return { success: false, error: 'INVALID_ADMIN_PASSWORD' }
    }

    this.failedAttempts = 0
    this.lockoutUntil = null
    this.binding = currentProject
    this.expiresAt = now + SESSION_IDLE_TIMEOUT_MS
    return { success: true, expiresAt: this.expiresAt }
  }

  checkSession(): AdminSessionResult {
    if (!this.hasValidSession()) {
      this.clearAuthentication()
      return { isAuthenticated: false }
    }
    return { isAuthenticated: true, expiresAt: this.expiresAt! }
  }

  authorize(): AdminSessionResult {
    if (!this.hasValidSession()) {
      this.clearAuthentication()
      throw new Error('ADMIN_SESSION_REQUIRED')
    }
    this.expiresAt = this.now() + SESSION_IDLE_TIMEOUT_MS
    return { isAuthenticated: true, expiresAt: this.expiresAt }
  }

  logout(): void {
    this.invalidate()
  }

  invalidate(): void {
    this.clearAuthentication()
  }

  verifyCurrentPassword(password: string): boolean {
    if (!this.getUnlockedProjectBinding()) return false
    return this.verifyPassword(password, this.projectState.currentHashHex, this.projectState.currentSaltHex)
  }

  rebindAfterPasswordChange(): void {
    if (this.expiresAt === null || this.now() >= this.expiresAt) {
      this.clearAuthentication()
      throw new Error('ADMIN_SESSION_REQUIRED')
    }
    const currentProject = this.getUnlockedProjectBinding()
    if (!currentProject) {
      this.clearAuthentication()
      throw new Error('PROJECT_NOT_UNLOCKED')
    }
    this.binding = currentProject
    this.expiresAt = this.now() + SESSION_IDLE_TIMEOUT_MS
  }

  private getUnlockedProjectBinding(): ProjectBinding | null {
    const encryptionKey = this.projectState.auth.encryptionKey
    if (
      !this.projectState.currentProject ||
      !this.projectState.currentFilePath ||
      !this.projectState.currentHashHex ||
      !this.projectState.currentSaltHex ||
      !encryptionKey
    ) {
      return null
    }
    return {
      filePath: this.projectState.currentFilePath,
      passwordHash: this.projectState.currentHashHex,
      encryptionKey
    }
  }

  private hasValidSession(): boolean {
    if (!this.binding || this.expiresAt === null || this.now() >= this.expiresAt) return false
    const current = this.getUnlockedProjectBinding()
    return (
      current !== null &&
      current.filePath === this.binding.filePath &&
      current.passwordHash === this.binding.passwordHash &&
      current.encryptionKey === this.binding.encryptionKey
    )
  }

  private clearAuthentication(): void {
    this.binding = null
    this.expiresAt = null
  }
}
