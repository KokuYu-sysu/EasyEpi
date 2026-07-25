import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { DATA_MAGIC, DATA_VERSION } from '@shared/types/project'
import type { RecordData } from '@shared/types/record'

import { encrypt, decrypt } from './crypto.service'

const HEADER_SIZE = 32

function writeHeader(buf: Buffer, recordCount: number, createdAt: number, lastModifiedAt: number): void {
  buf.writeUInt32BE(DATA_MAGIC, 0)
  buf.writeUInt32BE(DATA_VERSION, 4)
  buf.writeUInt32BE(recordCount, 8)
  buf.writeUInt32BE(0, 12) // reserved
  buf.writeBigUInt64BE(BigInt(createdAt), 16)
  buf.writeBigUInt64BE(BigInt(lastModifiedAt), 24)
}

function readHeader(buf: Buffer): { recordCount: number; createdAt: number; lastModifiedAt: number } {
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

function encryptRecords(records: RecordData[], key: Buffer): Buffer {
  const json = JSON.stringify(records)
  const plaintext = Buffer.from(json, 'utf-8')
  return encrypt(plaintext, key)
}

function decryptRecords(ciphertext: Buffer, key: Buffer): RecordData[] {
  const plaintext = decrypt(ciphertext, key)
  return JSON.parse(plaintext.toString('utf-8')) as RecordData[]
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

  const emptyCiphertext = encryptRecords([], key)
  writeFileSync(filePath, Buffer.concat([header, emptyCiphertext]))
}

export function loadRecords(filePath: string, key: Buffer): RecordData[] {
  if (!existsSync(filePath)) return []
  const fileBuf = readFileSync(filePath)
  const header = readHeader(fileBuf)
  if (header.recordCount === 0) return []

  const ciphertext = fileBuf.subarray(HEADER_SIZE)
  return decryptRecords(ciphertext, key)
}

export function appendRecord(filePath: string, key: Buffer, record: RecordData): void {
  const records = loadRecords(filePath, key)
  records.push(record)

  const fileBuf = readFileSync(filePath)
  const header = readHeader(fileBuf)
  const now = Date.now()

  const newHeader = Buffer.alloc(HEADER_SIZE)
  writeHeader(newHeader, records.length, header.createdAt, now)

  const ciphertext = encryptRecords(records, key)
  writeFileSync(filePath, Buffer.concat([newHeader, ciphertext]))
}

export function deleteRecords(filePath: string, key: Buffer, recordIds: string[]): void {
  const records = loadRecords(filePath, key)
  const idsToDelete = new Set(recordIds)
  const filtered = records.filter((r) => !idsToDelete.has(r.id))

  const fileBuf = readFileSync(filePath)
  const header = readHeader(fileBuf)
  const now = Date.now()

  const newHeader = Buffer.alloc(HEADER_SIZE)
  writeHeader(newHeader, filtered.length, header.createdAt, now)

  const ciphertext = encryptRecords(filtered, key)
  writeFileSync(filePath, Buffer.concat([newHeader, ciphertext]))
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
