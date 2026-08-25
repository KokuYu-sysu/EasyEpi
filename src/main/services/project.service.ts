import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectData, ProjectMeta } from '@shared/types/project'
import { PROJECT_MAGIC, PROJECT_VERSION } from '@shared/types/project'

import { encrypt, decrypt, deriveKey, hashPassword, verifyPassword } from './crypto.service'
import { atomicWriteFile } from './record.service'

const PROJECT_FILE_EXT = '.easyepi'

/*
File format v1:
  Offset  Size  Field
  0       4     Magic (0x45504901)
  4       4     Version
  8       4     Encrypted payload length
  12      8     Created timestamp (ms)
  20      8     Last modified timestamp (ms)
  28      64    Password salt (64 UTF-8 hex characters)
  92      64    Password hash (64 UTF-8 hex characters)
  156     N     Encrypted JSON payload

Total header: 156 bytes
*/

const SALT_HEX_LEN = 64
const HASH_HEX_LEN = 64
const SALT_OFFSET = 28
const HASH_OFFSET = SALT_OFFSET + SALT_HEX_LEN
const HEADER_SIZE = HASH_OFFSET + HASH_HEX_LEN
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function ensureProjectId(
  project: ProjectData,
  createId: () => string = randomUUID
): boolean {
  if (project.meta.projectId !== undefined) {
    if (!UUID_PATTERN.test(project.meta.projectId)) throw new Error('INVALID_PROJECT_ID')
    return false
  }
  const projectId = createId()
  if (!UUID_PATTERN.test(projectId)) throw new Error('INVALID_PROJECT_ID')
  project.meta = { ...project.meta, projectId }
  return true
}

function writeHeader(opts: {
  payloadLength: number
  createdAt: number
  lastModifiedAt: number
  saltHex: string
  hashHex: string
}): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE)
  buf.writeUInt32BE(PROJECT_MAGIC, 0)
  buf.writeUInt32BE(PROJECT_VERSION, 4)
  buf.writeUInt32BE(opts.payloadLength, 8)
  buf.writeBigUInt64BE(BigInt(opts.createdAt), 12)
  buf.writeBigUInt64BE(BigInt(opts.lastModifiedAt), 20)

  // Write salt (hex string, padded with zeros)
  const saltBuf = Buffer.alloc(SALT_HEX_LEN, 0)
  Buffer.from(opts.saltHex, 'utf-8').copy(saltBuf)
  saltBuf.copy(buf, SALT_OFFSET)

  // Write password hash (hex string, padded with zeros)
  const hashBuf = Buffer.alloc(HASH_HEX_LEN, 0)
  Buffer.from(opts.hashHex, 'utf-8').copy(hashBuf)
  hashBuf.copy(buf, HASH_OFFSET)

  return buf
}

interface ReadHeaderResult {
  payloadLength: number
  createdAt: number
  lastModifiedAt: number
  saltHex: string
  hashHex: string
}

function readHeader(buf: Buffer): ReadHeaderResult {
  if (buf.length < HEADER_SIZE) throw new Error('PROJECT_FILE_TOO_SHORT')
  const magic = buf.readUInt32BE(0)
  if (magic !== PROJECT_MAGIC) throw new Error('INVALID_PROJECT_MAGIC')
  const version = buf.readUInt32BE(4)
  if (version !== PROJECT_VERSION) throw new Error('UNSUPPORTED_PROJECT_VERSION')

  const saltHex = buf
    .subarray(SALT_OFFSET, SALT_OFFSET + SALT_HEX_LEN)
    .toString('utf-8')
    .replace(/\0+$/, '')
  const hashHex = buf
    .subarray(HASH_OFFSET, HASH_OFFSET + HASH_HEX_LEN)
    .toString('utf-8')
    .replace(/\0+$/, '')

  return {
    payloadLength: buf.readUInt32BE(8),
    createdAt: Number(buf.readBigUInt64BE(12)),
    lastModifiedAt: Number(buf.readBigUInt64BE(20)),
    saltHex,
    hashHex
  }
}

export function getProjectFilePath(folderPath: string, projectName: string): string {
  return join(folderPath, `${projectName}${PROJECT_FILE_EXT}`)
}

export function createProject(
  folderPath: string,
  name: string,
  password: string
): { meta: ProjectMeta; encryptionKey: Buffer; passwordHash: string; salt: string } {
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true })
  }
  if (projectExists(folderPath, name)) {
    throw new Error('PROJECT_ALREADY_EXISTS')
  }

  const { hash, salt } = hashPassword(password)
  const saltBuf = Buffer.from(salt, 'hex')
  const encryptionKey = deriveKey(password, saltBuf)

  const now = new Date().toISOString()
  const meta: ProjectMeta = {
    projectId: randomUUID(), name, folderPath, createdAt: now, lastModifiedAt: now
  }
  const data: ProjectData = {
    meta,
    questionnaire: { name, questions: [], conditionRules: [], keyQuestionIds: [] }
  }

  saveProject(folderPath, name, data, encryptionKey, salt, hash)
  return { meta, encryptionKey, passwordHash: hash, salt }
}

export function saveProject(
  folderPath: string,
  name: string,
  data: ProjectData,
  encryptionKey: Buffer,
  saltHex: string,
  hashHex: string
): void {
  saveProjectToPath(
    getProjectFilePath(folderPath, name),
    data,
    encryptionKey,
    saltHex,
    hashHex
  )
}

export function saveProjectToPath(
  filePath: string,
  data: ProjectData,
  encryptionKey: Buffer,
  saltHex: string,
  hashHex: string
): void {
  const now = Date.now()
  const lastModifiedAt = new Date(now).toISOString()
  atomicWriteFile(
    filePath,
    createProjectFileContents(data, encryptionKey, saltHex, hashHex, now)
  )
  data.meta.lastModifiedAt = lastModifiedAt
}

export function createProjectFileContents(
  data: ProjectData,
  encryptionKey: Buffer,
  saltHex: string,
  hashHex: string,
  lastModifiedAt = Date.now()
): Buffer {
  const serializedData: ProjectData = {
    ...data,
    meta: { ...data.meta, lastModifiedAt: new Date(lastModifiedAt).toISOString() }
  }
  const plaintext = Buffer.from(JSON.stringify(serializedData), 'utf-8')
  const ciphertext = encrypt(plaintext, encryptionKey)
  const header = writeHeader({
    payloadLength: ciphertext.length,
    createdAt: new Date(data.meta.createdAt).getTime(),
    lastModifiedAt,
    saltHex,
    hashHex
  })
  return Buffer.concat([header, ciphertext])
}

/**
 * Read the file header to get password verification data.
 * Does NOT decrypt the payload.
 */
export function readProjectHeader(filePath: string): ReadHeaderResult {
  const fileBuf = readFileSync(filePath)
  return readHeader(fileBuf)
}

/**
 * Decrypt and load project data using the derived key.
 */
export function decryptProjectData(filePath: string, encryptionKey: Buffer): ProjectData {
  const fileBuf = readFileSync(filePath)
  const header = readHeader(fileBuf)
  const ciphertext = fileBuf.subarray(HEADER_SIZE, HEADER_SIZE + header.payloadLength)
  const plaintext = decrypt(ciphertext, encryptionKey)
  return JSON.parse(plaintext.toString('utf-8')) as ProjectData
}

/**
 * Verify password against stored hash and return the derived key.
 */
export function verifyAndDeriveKey(
  password: string,
  saltHex: string,
  storedHashHex: string
): Buffer | null {
  if (!verifyPassword(password, storedHashHex, saltHex)) {
    return null
  }
  const saltBuf = Buffer.from(saltHex, 'hex')
  return deriveKey(password, saltBuf)
}

export function projectExists(folderPath: string, name: string): boolean {
  return existsSync(getProjectFilePath(folderPath, name))
}

export function findProjectFile(folderPath: string): string | null {
  try {
    const files = readdirSync(folderPath) as string[]
    const projectFile = files.find((f: string) => f.endsWith(PROJECT_FILE_EXT))
    return projectFile ? join(folderPath, projectFile) : null
  } catch {
    return null
  }
}
