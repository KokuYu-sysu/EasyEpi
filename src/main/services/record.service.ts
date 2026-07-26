import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

import { DATA_MAGIC, DATA_VERSION } from '@shared/types/project'
import type { RecordData } from '@shared/types/record'

import { encrypt, decrypt } from './crypto.service'

const HEADER_SIZE = 32

export interface PersistedEntryProgress {
  hasDraft: boolean
  currentIndex: number
  batchCount: number
  batchStartTime: number
  currentAnswers: Record<string, unknown>
}

interface RecordFilePayload {
  records: RecordData[]
  entryProgress: PersistedEntryProgress
}

function writeHeader(
  buf: Buffer,
  recordCount: number,
  createdAt: number,
  lastModifiedAt: number
): void {
  buf.writeUInt32BE(DATA_MAGIC, 0)
  buf.writeUInt32BE(DATA_VERSION, 4)
  buf.writeUInt32BE(recordCount, 8)
  buf.writeUInt32BE(0, 12) // reserved
  buf.writeBigUInt64BE(BigInt(createdAt), 16)
  buf.writeBigUInt64BE(BigInt(lastModifiedAt), 24)
}

function readHeader(buf: Buffer): {
  recordCount: number
  createdAt: number
  lastModifiedAt: number
} {
  if (buf.length < HEADER_SIZE) throw new Error('DATA_FILE_TOO_SHORT')
  const magic = buf.readUInt32BE(0)
  if (magic !== DATA_MAGIC) throw new Error('INVALID_DATA_MAGIC')
  const version = buf.readUInt32BE(4)
  if (version !== DATA_VERSION) throw new Error('UNSUPPORTED_DATA_VERSION')
  return {
    recordCount: buf.readUInt32BE(8),
    createdAt: Number(buf.readBigUInt64BE(16)),
    lastModifiedAt: Number(buf.readBigUInt64BE(24))
  }
}

function createEmptyProgress(timestamp: number): PersistedEntryProgress {
  return {
    hasDraft: false,
    currentIndex: 0,
    batchCount: 0,
    batchStartTime: timestamp,
    currentAnswers: {}
  }
}

function encryptPayload(payload: RecordFilePayload, key: Buffer): Buffer {
  const json = JSON.stringify(payload)
  const plaintext = Buffer.from(json, 'utf-8')
  return encrypt(plaintext, key)
}

function decryptPayload(
  ciphertext: Buffer,
  key: Buffer,
  fallbackTimestamp: number
): RecordFilePayload {
  const plaintext = decrypt(ciphertext, key)
  const parsed = JSON.parse(plaintext.toString('utf-8')) as unknown

  if (Array.isArray(parsed)) {
    return {
      records: parsed as RecordData[],
      entryProgress: createEmptyProgress(fallbackTimestamp)
    }
  }

  if (typeof parsed !== 'object' || parsed === null) throw new Error('INVALID_DATA_PAYLOAD')
  const payload = parsed as Partial<RecordFilePayload>
  if (
    !Array.isArray(payload.records) ||
    typeof payload.entryProgress !== 'object' ||
    payload.entryProgress === null
  ) {
    throw new Error('INVALID_DATA_PAYLOAD')
  }
  const entryProgress = payload.entryProgress as Partial<PersistedEntryProgress>
  return {
    records: payload.records,
    entryProgress: {
      hasDraft:
        typeof entryProgress.hasDraft === 'boolean'
          ? entryProgress.hasDraft
          : (entryProgress.currentIndex ?? 0) > 0 ||
            Object.keys(entryProgress.currentAnswers ?? {}).length > 0,
      currentIndex: entryProgress.currentIndex ?? 0,
      batchCount: entryProgress.batchCount ?? 0,
      batchStartTime: entryProgress.batchStartTime ?? fallbackTimestamp,
      currentAnswers: entryProgress.currentAnswers ?? {}
    }
  }
}

export function atomicWriteFile(
  filePath: string,
  contents: Buffer,
  replaceFile: typeof renameSync = renameSync
): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporaryPath, 'wx')
    writeFileSync(descriptor, contents)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    replaceFile(temporaryPath, filePath)
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (existsSync(temporaryPath)) rmSync(temporaryPath)
    throw error
  }
}

function readDataFile(
  filePath: string,
  key: Buffer
): {
  header: ReturnType<typeof readHeader>
  payload: RecordFilePayload
} {
  const fileBuf = readFileSync(filePath)
  const header = readHeader(fileBuf)
  const payload = decryptPayload(fileBuf.subarray(HEADER_SIZE), key, header.createdAt)
  if (payload.records.length !== header.recordCount) throw new Error('DATA_RECORD_COUNT_MISMATCH')
  return { header, payload }
}

function writeDataFile(
  filePath: string,
  key: Buffer,
  header: ReturnType<typeof readHeader>,
  payload: RecordFilePayload
): void {
  const newHeader = Buffer.alloc(HEADER_SIZE)
  writeHeader(newHeader, payload.records.length, header.createdAt, Date.now())
  atomicWriteFile(filePath, Buffer.concat([newHeader, encryptPayload(payload, key)]))
}

export function getDataFilePath(folderPath: string, projectName: string): string {
  return join(folderPath, `${projectName}.easyepi_data`)
}

export function createDataFile(filePath: string, key: Buffer): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const header = Buffer.alloc(HEADER_SIZE)
  const now = Date.now()
  writeHeader(header, 0, now, now)

  const emptyCiphertext = encryptPayload(
    { records: [], entryProgress: createEmptyProgress(now) },
    key
  )
  atomicWriteFile(filePath, Buffer.concat([header, emptyCiphertext]))
}

export function loadRecords(filePath: string, key: Buffer): RecordData[] {
  if (!existsSync(filePath)) return []
  return readDataFile(filePath, key).payload.records
}

export function appendRecord(filePath: string, key: Buffer, record: RecordData): void {
  const { header, payload } = readDataFile(filePath, key)
  payload.records.push(record)
  writeDataFile(filePath, key, header, payload)
}

export function deleteRecords(filePath: string, key: Buffer, recordIds: string[]): void {
  const { header, payload } = readDataFile(filePath, key)
  const idsToDelete = new Set(recordIds)
  payload.records = payload.records.filter((r) => !idsToDelete.has(r.id))
  writeDataFile(filePath, key, header, payload)
}

export function loadEntryProgress(filePath: string, key: Buffer): PersistedEntryProgress {
  return readDataFile(filePath, key).payload.entryProgress
}

export function saveEntryProgress(
  filePath: string,
  key: Buffer,
  progress: PersistedEntryProgress
): void {
  const { header, payload } = readDataFile(filePath, key)
  payload.entryProgress = progress
  writeDataFile(filePath, key, header, payload)
}

export function checkKeyDuplicate(
  filePath: string,
  key: Buffer,
  keyFields: string[],
  keyValues: Record<string, unknown>,
  excludeRecordId?: string
): { isDuplicate: boolean; duplicateRecordId?: string } {
  const records = loadRecords(filePath, key)

  for (const record of records) {
    if (excludeRecordId && record.id === excludeRecordId) continue

    const isMatch = keyFields.every((field) => {
      return String(record.answers[field]) === String(keyValues[field])
    })

    if (isMatch) {
      return { isDuplicate: true, duplicateRecordId: record.id }
    }
  }

  return { isDuplicate: false }
}
