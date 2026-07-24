import { deriveKey, hashPassword, verifyPassword } from './crypto.service'

export interface PasswordData {
  hash: string
  salt: string
}

export interface AuthServiceState {
  passwordData: PasswordData | null
  encryptionKey: Buffer | null
}

export function createAuthService(): AuthServiceState {
  return {
    passwordData: null,
    encryptionKey: null
  }
}

export function setPassword(
  state: AuthServiceState,
  password: string
): { passwordData: PasswordData; encryptionKey: Buffer } {
  const data = hashPassword(password)
  const salt = Buffer.from(data.salt, 'hex')
  const key = deriveKey(password, salt)
  state.passwordData = data
  state.encryptionKey = key
  return { passwordData: data, encryptionKey: key }
}

export function unlockWithPassword(
  state: AuthServiceState,
  password: string,
  storedHash: string,
  storedSalt: string
): boolean {
  if (!verifyPassword(password, storedHash, storedSalt)) {
    return false
  }
  const salt = Buffer.from(storedSalt, 'hex')
  state.encryptionKey = deriveKey(password, salt)
  state.passwordData = { hash: storedHash, salt: storedSalt }
  return true
}

export function changePassword(
  state: AuthServiceState,
  oldPassword: string,
  newPassword: string,
  storedHash: string,
  storedSalt: string
): { passwordData: PasswordData; encryptionKey: Buffer } | null {
  if (!verifyPassword(oldPassword, storedHash, storedSalt)) {
    return null
  }
  return setPassword(state, newPassword)
}

export function lock(state: AuthServiceState): void {
  if (state.encryptionKey) {
    state.encryptionKey.fill(0)
  }
  state.encryptionKey = null
  state.passwordData = null
}

export function getEncryptionKey(state: AuthServiceState): Buffer | null {
  return state.encryptionKey
}
