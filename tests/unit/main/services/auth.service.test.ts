import { describe, expect, it } from 'vitest'

import {
  changePassword,
  createAuthService,
  getEncryptionKey,
  lock,
  setPassword,
  unlockWithPassword
} from '../../../../src/main/services/auth.service'

describe('AuthService', () => {
  it('sets, locks, and unlocks password state', () => {
    const state = createAuthService()
    const created = setPassword(state, 'secret')
    expect(getEncryptionKey(state)).toEqual(created.encryptionKey)

    const keyBeforeLock = created.encryptionKey
    lock(state)
    expect(getEncryptionKey(state)).toBeNull()
    expect(keyBeforeLock.every((byte) => byte === 0)).toBe(true)

    expect(
      unlockWithPassword(
        state,
        'wrong',
        created.passwordData.hash,
        created.passwordData.salt
      )
    ).toBe(false)
    expect(
      unlockWithPassword(
        state,
        'secret',
        created.passwordData.hash,
        created.passwordData.salt
      )
    ).toBe(true)
  })

  it('changes a password only when the old password is correct', () => {
    const state = createAuthService()
    const created = setPassword(state, 'old-secret')
    expect(
      changePassword(
        state,
        'wrong',
        'new-secret',
        created.passwordData.hash,
        created.passwordData.salt
      )
    ).toBeNull()
    expect(
      changePassword(
        state,
        'old-secret',
        'new-secret',
        created.passwordData.hash,
        created.passwordData.salt
      )
    ).not.toBeNull()
  })
})
