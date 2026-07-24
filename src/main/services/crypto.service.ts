import {
  argon2Sync,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT_LENGTH = 32
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const PBKDF2_ITERATIONS = 210_000
const ARGON2_PARALLELISM = 4
const ARGON2_MEMORY = 65_536
const ARGON2_PASSES = 3
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1

function hashPasswordBytes(password: string, salt: Buffer): Buffer {
  try {
    return argon2Sync('argon2id', {
      message: password,
      nonce: salt,
      parallelism: ARGON2_PARALLELISM,
      tagLength: KEY_LENGTH,
      memory: ARGON2_MEMORY,
      passes: ARGON2_PASSES
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED') throw error
    return scryptSync(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024
    })
  }
}

export interface EncryptedPayload {
  salt: Buffer
  iv: Buffer
  authTag: Buffer
  ciphertext: Buffer
}

export function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted])
}

export function decrypt(ciphertext: Buffer, key: Buffer): Buffer {
  if (ciphertext.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('CIPHERTEXT_TOO_SHORT')
  }
  const iv = ciphertext.subarray(0, IV_LENGTH)
  const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const encrypted = ciphertext.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(SALT_LENGTH)
  const hash = hashPasswordBytes(password, salt)
  return {
    hash: hash.toString('hex'),
    salt: salt.toString('hex')
  }
}

export function verifyPassword(password: string, storedHash: string, storedSalt: string): boolean {
  const salt = Buffer.from(storedSalt, 'hex')
  const hash = hashPasswordBytes(password, salt)
  const stored = Buffer.from(storedHash, 'hex')
  return stored.length === hash.length && timingSafeEqual(hash, stored)
}

export function generateRecoveryKey(): string {
  const words = [
    'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
    'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
    'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
    'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
    'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
    'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
    'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
    'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
    'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
    'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
    'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
    'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor'
  ]
  const selected: string[] = []
  for (let i = 0; i < 12; i++) {
    const index = randomBytes(2).readUInt16BE(0) % words.length
    selected.push(words[index]!)
  }
  return selected.join(' ')
}
