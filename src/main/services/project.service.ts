import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectData, ProjectMeta } from '@shared/types/project'
import { PROJECT_MAGIC, PROJECT_VERSION } from '@shared/types/project'

import { encrypt, decrypt } from './crypto.service'

const PROJECT_FILE_EXT = '.easyepi'

interface ProjectFileHeader {
  magic: number
  version: number
  payloadLength: number
  createdAt: number
  lastModifiedAt: number
}

function writeHeader(header: ProjectFileHeader): Buffer {
  const buf = Buffer.alloc(64)
  buf.writeUInt32BE(header.magic, 0)
  buf.writeUInt32BE(header.version, 4)
  buf.writeUInt32BE(header.payloadLength, 8)
  buf.writeBigUInt64BE(BigInt(header.createdAt), 12)
  buf.writeBigUInt64BE(BigInt(header.lastModifiedAt), 20)
  return buf
}

function readHeader(buf: Buffer): ProjectFileHeader {
  if (buf.length < 64) throw new Error('PROJECT_FILE_TOO_SHORT')
  const magic = buf.readUInt32BE(0)
  if (magic !== PROJECT_MAGIC) throw new Error('INVALID_PROJECT_MAGIC')
  const version = buf.readUInt32BE(4)
  if (version !== PROJECT_VERSION) throw new Error('UNSUPPORTED_PROJECT_VERSION')
  return {
    magic,
    version,
    payloadLength: buf.readUInt32BE(8),
    createdAt: Number(buf.readBigUInt64BE(12)),
    lastModifiedAt: Number(buf.readBigUInt64BE(20))
  }
}

export function getProjectFilePath(folderPath: string, projectName: string): string {
  return join(folderPath, `${projectName}${PROJECT_FILE_EXT}`)
}

export function createProject(
  folderPath: string,
  name: string,
  encryptionKey: Buffer
): ProjectMeta {
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true })
  }

  const now = new Date().toISOString()
  const data: ProjectData = {
    meta: {
      name,
      folderPath,
      createdAt: now,
      lastModifiedAt: now
    },
    questionnaire: {
      name,
      questions: [],
      conditionRules: [],
      keyQuestionIds: []
    }
  }

  saveProject(folderPath, name, data, encryptionKey)
  return data.meta
}

export function saveProject(
  folderPath: string,
  name: string,
  data: ProjectData,
  encryptionKey: Buffer
): void {
  const now = Date.now()
  data.meta.lastModifiedAt = new Date(now).toISOString()

  const jsonStr = JSON.stringify(data)
  const plaintext = Buffer.from(jsonStr, 'utf-8')
  const ciphertext = encrypt(plaintext, encryptionKey)

  const header = writeHeader({
    magic: PROJECT_MAGIC,
    version: PROJECT_VERSION,
    payloadLength: ciphertext.length,
    createdAt: new Date(data.meta.createdAt).getTime(),
    lastModifiedAt: now
  })

  const filePath = getProjectFilePath(folderPath, name)
  const fileBuf = Buffer.concat([header, ciphertext])
  writeFileSync(filePath, fileBuf)
}

export function loadProject(
  filePath: string,
  encryptionKey: Buffer
): ProjectData {
  const fileBuf = readFileSync(filePath)
  const header = readHeader(fileBuf)

  const ciphertext = fileBuf.subarray(64, 64 + header.payloadLength)
  const plaintext = decrypt(ciphertext, encryptionKey)
  const jsonStr = plaintext.toString('utf-8')

  const data = JSON.parse(jsonStr) as ProjectData
  return data
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
