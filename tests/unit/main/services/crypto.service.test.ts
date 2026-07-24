import { describe, it, expect } from 'vitest'
import { argon2Sync, pbkdf2Sync } from 'node:crypto'

import { deriveKey, encrypt, decrypt, hashPassword, verifyPassword, generateRecoveryKey } from '../../../../src/main/services/crypto.service'

describe('CryptoService', () => {
  describe('deriveKey', () => {
    it('derives encryption keys with PBKDF2-SHA-256', () => {
      const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
      expect(deriveKey('test-password', salt)).toEqual(
        pbkdf2Sync('test-password', salt, 210_000, 32, 'sha256')
      )
    })
    it('derives a 32-byte key from password and salt', () => {
      const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
      const key = deriveKey('test-password', salt)
      expect(key).toBeInstanceOf(Buffer)
      expect(key.length).toBe(32)
    })

    it('produces the same key for the same password and salt', () => {
      const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
      const key1 = deriveKey('test-password', salt)
      const key2 = deriveKey('test-password', salt)
      expect(key1.equals(key2)).toBe(true)
    })

    it('produces different keys for different passwords', () => {
      const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
      const key1 = deriveKey('password1', salt)
      const key2 = deriveKey('password2', salt)
      expect(key1.equals(key2)).toBe(false)
    })

    it('produces different keys for different salts', () => {
      const salt1 = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
      const salt2 = Buffer.from('fedcba9876543210fedcba9876543210', 'hex')
      const key1 = deriveKey('test-password', salt1)
      const key2 = deriveKey('test-password', salt2)
      expect(key1.equals(key2)).toBe(false)
    })
  })

  describe('encrypt / decrypt', () => {
    it('encrypts and decrypts data correctly', () => {
      const key = deriveKey('test-password', Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))
      const plaintext = Buffer.from('Hello, EasyEpi!', 'utf-8')
      const ciphertext = encrypt(plaintext, key)

      expect(ciphertext).toBeInstanceOf(Buffer)
      expect(ciphertext.length).toBeGreaterThan(plaintext.length)

      const decrypted = decrypt(ciphertext, key)
      expect(decrypted.equals(plaintext)).toBe(true)
    })

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      const key = deriveKey('test-password', Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))
      const plaintext = Buffer.from('Hello, EasyEpi!', 'utf-8')
      const ciphertext1 = encrypt(plaintext, key)
      const ciphertext2 = encrypt(plaintext, key)

      expect(ciphertext1.equals(ciphertext2)).toBe(false)
    })

    it('fails to decrypt with wrong key', () => {
      const key1 = deriveKey('password1', Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))
      const key2 = deriveKey('password2', Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))
      const plaintext = Buffer.from('Hello, EasyEpi!', 'utf-8')
      const ciphertext = encrypt(plaintext, key1)

      expect(() => decrypt(ciphertext, key2)).toThrow()
    })

    it('fails to decrypt tampered ciphertext', () => {
      const key = deriveKey('test-password', Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))
      const plaintext = Buffer.from('Hello, EasyEpi!', 'utf-8')
      const ciphertext = encrypt(plaintext, key)

      // Tamper with the ciphertext
      const tampered = Buffer.from(ciphertext)
      tampered[tampered.length - 1]! ^= 0xff

      expect(() => decrypt(tampered, key)).toThrow()
    })

    it('fails to decrypt too-short ciphertext', () => {
      const key = deriveKey('test-password', Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))
      const short = Buffer.alloc(10)
      expect(() => decrypt(short, key)).toThrow('CIPHERTEXT_TOO_SHORT')
    })
  })

  describe('hashPassword / verifyPassword', () => {
    it('uses Argon2id for password hashes', () => {
      const { hash, salt } = hashPassword('my-secret-password')
      const expected = argon2Sync('argon2id', {
        message: 'my-secret-password',
        nonce: Buffer.from(salt, 'hex'),
        parallelism: 4,
        tagLength: 32,
        memory: 65_536,
        passes: 3
      })
      expect(hash).toBe(expected.toString('hex'))
    })
    it('hashes and verifies a password', () => {
      const { hash, salt } = hashPassword('my-secret-password')
      expect(hash).toBeTruthy()
      expect(salt).toBeTruthy()
      expect(verifyPassword('my-secret-password', hash, salt)).toBe(true)
    })

    it('rejects wrong password', () => {
      const { hash, salt } = hashPassword('correct-password')
      expect(verifyPassword('wrong-password', hash, salt)).toBe(false)
    })

    it('produces different hashes for the same password (random salt)', () => {
      const result1 = hashPassword('same-password')
      const result2 = hashPassword('same-password')
      expect(result1.hash).not.toBe(result2.hash)
      expect(result1.salt).not.toBe(result2.salt)
    })
  })

  describe('generateRecoveryKey', () => {
    it('generates a 12-word recovery key', () => {
      const key = generateRecoveryKey()
      const words = key.split(' ')
      expect(words.length).toBe(12)
      words.forEach((word) => {
        expect(word.length).toBeGreaterThan(0)
        expect(/^[a-z]+$/.test(word)).toBe(true)
      })
    })

    it('generates different keys each time', () => {
      const key1 = generateRecoveryKey()
      const key2 = generateRecoveryKey()
      expect(key1).not.toBe(key2)
    })
  })
})
