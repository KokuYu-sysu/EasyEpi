# M4 Data Entry System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete data entry system — one-question-per-screen entry with all 6 question types, skip logic, progress tracking, submit confirmation, work session cycle, break-point resume, and Key duplicate checking.

**Architecture:** The record service stores encrypted records in a `.easyepi_data` binary file alongside the project file. IPC handlers expose record CRUD to the renderer. The entry Zustand store manages entry state (current question, answers, visible questions via skip logic). Dedicated input components render per question type. The work session orchestrates submit-confirm → work-end → next-record cycle.

**Tech Stack:** Electron IPC, Zustand 5 vanilla store, React 18, Tailwind CSS 4, Radix UI primitives, existing `crypto.service.ts` for AES-256-GCM.

## Global Constraints

- All IPC channels must use `assertTrustedSender` validation
- Record data is encrypted with AES-256-GCM using the project's encryption key
- The `.easyepi_data` file uses the binary header format defined in `project.ts` (`DATA_MAGIC`, `DATA_VERSION`)
- Existing `evaluateConditions`, `getVisibleQuestions`, `validateQuestionAnswer` from `@shared/types/qnaire` must be reused — do not duplicate
- Follow existing Zustand vanilla store pattern (`createStore` from `zustand/vanilla`)
- Follow existing IPC contract pattern (channel constants, parsers in shared, handler registration in main)
- All new components must use existing UI primitives from `@renderer/components/ui`
- Entry page must support keyboard navigation: 1-9 for options, Enter for next, Backspace for prev, Esc for exit

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/record-contract.ts` | IPC channel constants, request/response types and parsers for record operations |
| `src/shared/desktop-api.ts` | Extend `DesktopApi` with `record` namespace |
| `src/main/services/record.service.ts` | Record file CRUD — create/open/save `.easyepi_data`, add/read/update/delete records, Key duplicate check |
| `src/main/ipc/record.ipc.ts` | IPC handlers for record channels, uses `ProjectIpcState` for encryption key |
| `src/preload/desktop-api.ts` | Extend preload with record channel bindings |
| `src/main/index.ts` | Register `record.ipc` alongside other IPC modules |
| `src/renderer/stores/entry.store.ts` | Production entry store — loads questionnaire via IPC, manages answers, skip logic, submit, resume |
| `src/renderer/components/entry/QuestionCard.tsx` | Dynamic renderer: delegates to type-specific input based on `QuestionDef.type` |
| `src/renderer/components/entry/SingleChoiceInput.tsx` | Radio group with keyboard 1-9 shortcut |
| `src/renderer/components/entry/MultiChoiceInput.tsx` | Checkbox group with space toggle |
| `src/renderer/components/entry/FixedLengthInput.tsx` | Input with character counter |
| `src/renderer/components/entry/FreeTextInput.tsx` | Textarea input |
| `src/renderer/components/entry/NumericRangeInput.tsx` | Number input with range validation |
| `src/renderer/components/entry/DateInput.tsx` | Date input with format validation |
| `src/renderer/components/entry/ProgressBar.tsx` | Entry progress bar with skip-aware coloring |
| `src/renderer/components/entry/EntryNavBar.tsx` | Bottom navigation (prev/next/skip) |
| `src/renderer/pages/EntryPage.tsx` | Replace demo with production entry using `entry.store.ts` |
| `src/renderer/pages/SubmitConfirmPage.tsx` | Pre-submit review showing Key fields |
| `src/renderer/pages/WorkSessionPage.tsx` | Post-submit: batch stats, next record / end work |
| `tests/unit/main/services/record.service.test.ts` | Unit tests for record service |
| `tests/unit/shared/record-contract.test.ts` | Unit tests for contract parsers |
| `tests/unit/renderer/stores/entry.store.test.ts` | Unit tests for entry store |

---

### Task 1: Record Contract — IPC Channel Definitions

**Files:**
- Create: `src/shared/record-contract.ts`
- Test: `tests/unit/shared/record-contract.test.ts`

**Interfaces:**
- Produces: Channel constants, `RecordSubmitRequest`, `RecordSubmitResult`, `RecordListResult`, `EntryProgressResult`, request/response parsers

- [ ] **Step 1: Write the contract file**

```typescript
// src/shared/record-contract.ts

export const RECORD_SUBMIT_CHANNEL = 'record:submit' as const
export const RECORD_LIST_CHANNEL = 'record:list' as const
export const RECORD_DELETE_CHANNEL = 'record:delete' as const
export const RECORD_GET_PROGRESS_CHANNEL = 'record:getProgress' as const
export const RECORD_SAVE_PROGRESS_CHANNEL = 'record:saveProgress' as const
export const RECORD_CHECK_KEY_CHANNEL = 'record:checkKeyDuplicate' as const

export const ALL_RECORD_CHANNELS = [
  RECORD_SUBMIT_CHANNEL,
  RECORD_LIST_CHANNEL,
  RECORD_DELETE_CHANNEL,
  RECORD_GET_PROGRESS_CHANNEL,
  RECORD_SAVE_PROGRESS_CHANNEL,
  RECORD_CHECK_KEY_CHANNEL
] as const

export type RecordChannel = (typeof ALL_RECORD_CHANNELS)[number]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// --- Submit ---

export interface RecordSubmitRequest {
  answers: Record<string, unknown>
}

export function parseRecordSubmitRequest(value: unknown): RecordSubmitRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_RECORD_SUBMIT_REQUEST')
  const { answers } = value
  if (typeof answers !== 'object' || answers === null) {
    throw new Error('INVALID_RECORD_SUBMIT_REQUEST')
  }
  return { answers: answers as Record<string, unknown> }
}

export interface RecordSubmitResult {
  ok: boolean
  error?: string
  recordId?: string
}

export function parseRecordSubmitResult(value: unknown): RecordSubmitResult {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('INVALID_RECORD_SUBMIT_RESULT')
  }
  const obj = value as Record<string, unknown>
  return {
    ok: obj.ok as boolean,
    error: typeof obj.error === 'string' ? obj.error : undefined,
    recordId: typeof obj.recordId === 'string' ? obj.recordId : undefined
  }
}

// --- List ---

export interface RecordListRequest {
  offset?: number
  limit?: number
}

export function parseRecordListRequest(value: unknown): RecordListRequest {
  if (!isPlainObject(value)) return {}
  const obj = value as Record<string, unknown>
  return {
    offset: typeof obj.offset === 'number' ? obj.offset : undefined,
    limit: typeof obj.limit === 'number' ? obj.limit : undefined
  }
}

export interface RecordListItem {
  id: string
  answers: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface RecordListResult {
  ok: boolean
  records: RecordListItem[]
  total: number
}

// --- Delete ---

export interface RecordDeleteRequest {
  recordIds: string[]
}

export function parseRecordDeleteRequest(value: unknown): RecordDeleteRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_RECORD_DELETE_REQUEST')
  const { recordIds } = value
  if (!Array.isArray(recordIds) || !recordIds.every((id) => typeof id === 'string')) {
    throw new Error('INVALID_RECORD_DELETE_REQUEST')
  }
  return { recordIds }
}

// --- Progress ---

export interface EntryProgressResult {
  ok: boolean
  currentIndex: number
  batchCount: number
  batchStartTime: number
  currentAnswers: Record<string, unknown>
}

// --- Key Duplicate Check ---

export interface KeyDuplicateRequest {
  keyValues: Record<string, unknown>
  excludeRecordId?: string
}

export function parseKeyDuplicateRequest(value: unknown): KeyDuplicateRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_KEY_DUPLICATE_REQUEST')
  const { keyValues, excludeRecordId } = value
  if (typeof keyValues !== 'object' || keyValues === null) {
    throw new Error('INVALID_KEY_DUPLICATE_REQUEST')
  }
  return {
    keyValues: keyValues as Record<string, unknown>,
    excludeRecordId: typeof excludeRecordId === 'string' ? excludeRecordId : undefined
  }
}

export interface KeyDuplicateResult {
  ok: boolean
  isDuplicate: boolean
  duplicateRecordId?: string
}
```

- [ ] **Step 2: Write unit tests for parsers**

```typescript
// tests/unit/shared/record-contract.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseRecordSubmitRequest,
  parseRecordListRequest,
  parseRecordDeleteRequest,
  parseKeyDuplicateRequest,
  parseRecordSubmitResult
} from '@shared/record-contract'

describe('record-contract parsers', () => {
  describe('parseRecordSubmitRequest', () => {
    it('parses valid request', () => {
      const result = parseRecordSubmitRequest({ answers: { name: '张三', age: 30 } })
      expect(result.answers).toEqual({ name: '张三', age: 30 })
    })
    it('throws on non-object', () => {
      expect(() => parseRecordSubmitRequest(null)).toThrow('INVALID_RECORD_SUBMIT_REQUEST')
    })
    it('throws on missing answers', () => {
      expect(() => parseRecordSubmitRequest({})).toThrow('INVALID_RECORD_SUBMIT_REQUEST')
    })
  })

  describe('parseRecordListRequest', () => {
    it('returns empty on non-object', () => {
      expect(parseRecordListRequest(null)).toEqual({})
    })
    it('parses offset and limit', () => {
      expect(parseRecordListRequest({ offset: 10, limit: 5 })).toEqual({ offset: 10, limit: 5 })
    })
  })

  describe('parseRecordDeleteRequest', () => {
    it('parses valid request', () => {
      expect(parseRecordDeleteRequest({ recordIds: ['a', 'b'] })).toEqual({ recordIds: ['a', 'b'] })
    })
    it('throws on non-array', () => {
      expect(() => parseRecordDeleteRequest({ recordIds: 'a' })).toThrow()
    })
  })

  describe('parseKeyDuplicateRequest', () => {
    it('parses valid request', () => {
      const result = parseKeyDuplicateRequest({ keyValues: { id_card: '123' } })
      expect(result.keyValues).toEqual({ id_card: '123' })
    })
    it('parses with excludeRecordId', () => {
      const result = parseKeyDuplicateRequest({ keyValues: { id_card: '123' }, excludeRecordId: 'rec-1' })
      expect(result.excludeRecordId).toBe('rec-1')
    })
  })

  describe('parseRecordSubmitResult', () => {
    it('parses success', () => {
      expect(parseRecordSubmitResult({ ok: true, recordId: 'abc' })).toEqual({ ok: true, recordId: 'abc', error: undefined })
    })
    it('parses failure', () => {
      expect(parseRecordSubmitResult({ ok: false, error: 'duplicate' })).toEqual({ ok: false, error: 'duplicate', recordId: undefined })
    })
    it('throws on invalid', () => {
      expect(() => parseRecordSubmitResult(null)).toThrow()
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run tests/unit/shared/record-contract.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/record-contract.ts tests/unit/shared/record-contract.test.ts
git commit -m "feat(M4): add record IPC contract definitions and parsers"
```

---

### Task 2: Record Service — Encrypted Record File CRUD

**Files:**
- Create: `src/main/services/record.service.ts`
- Test: `tests/unit/main/services/record.service.test.ts`

**Interfaces:**
- Consumes: `encrypt`, `decrypt` from `crypto.service.ts`, `DATA_MAGIC`, `DATA_VERSION` from `@shared/types/project`
- Produces: `createDataFile`, `loadRecords`, `saveRecord`, `deleteRecords`, `checkKeyDuplicate`

The `.easyepi_data` file format:
```
Header (32 bytes):
  0-3:   Magic (0x45504401)
  4-7:   Version (1)
  8-11:  Record count
  12-15: Reserved
  16-23: Created timestamp (ms)
  24-31: Last modified timestamp (ms)
Body:
  AES-256-GCM encrypted JSON: RecordData[]
```

- [ ] **Step 1: Write unit tests**

```typescript
// tests/unit/main/services/record.service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createDataFile,
  loadRecords,
  appendRecord,
  deleteRecords,
  checkKeyDuplicate,
  getDataFilePath
} from '@main/services/record.service'
import { DATA_MAGIC, DATA_VERSION } from '@shared/types/project'

const TEST_DIR = join(tmpdir(), 'easyepi-test-record-' + Date.now())
const TEST_KEY = randomBytes(32)

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('record.service', () => {
  describe('createDataFile', () => {
    it('creates a valid data file with header', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      expect(existsSync(filePath)).toBe(true)
      const buf = readFileSync(filePath)
      expect(buf.readUInt32BE(0)).toBe(DATA_MAGIC)
      expect(buf.readUInt32BE(4)).toBe(DATA_VERSION)
      expect(buf.readUInt32BE(8)).toBe(0) // 0 records
    })
  })

  describe('appendRecord + loadRecords', () => {
    it('saves and loads a record', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      const recordId = 'test-id-1'
      appendRecord(filePath, TEST_KEY, {
        id: recordId,
        answers: { name: '张三', age: 30 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      const records = loadRecords(filePath, TEST_KEY)
      expect(records).toHaveLength(1)
      expect(records[0]!.id).toBe(recordId)
      expect(records[0]!.answers.name).toBe('张三')
    })

    it('saves multiple records', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      for (let i = 0; i < 5; i++) {
        appendRecord(filePath, TEST_KEY, {
          id: `rec-${i}`,
          answers: { index: i },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
      const records = loadRecords(filePath, TEST_KEY)
      expect(records).toHaveLength(5)
    })
  })

  describe('deleteRecords', () => {
    it('deletes specified records', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, { id: 'a', answers: {}, createdAt: '', updatedAt: '' })
      appendRecord(filePath, TEST_KEY, { id: 'b', answers: {}, createdAt: '', updatedAt: '' })
      appendRecord(filePath, TEST_KEY, { id: 'c', answers: {}, createdAt: '', updatedAt: '' })
      deleteRecords(filePath, TEST_KEY, ['a', 'c'])
      const records = loadRecords(filePath, TEST_KEY)
      expect(records).toHaveLength(1)
      expect(records[0]!.id).toBe('b')
    })
  })

  describe('checkKeyDuplicate', () => {
    it('detects duplicate key', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, {
        id: 'r1',
        answers: { id_card: '110101199001011234', name: '张三' },
        createdAt: '',
        updatedAt: ''
      })
      const result = checkKeyDuplicate(filePath, TEST_KEY, ['id_card'], { id_card: '110101199001011234' })
      expect(result.isDuplicate).toBe(true)
    })

    it('returns false for unique key', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, {
        id: 'r1',
        answers: { id_card: '110101199001011234' },
        createdAt: '',
        updatedAt: ''
      })
      const result = checkKeyDuplicate(filePath, TEST_KEY, ['id_card'], { id_card: '999999999999999999' })
      expect(result.isDuplicate).toBe(false)
    })

    it('excludes specified record id', () => {
      const filePath = join(TEST_DIR, 'test.easyepi_data')
      createDataFile(filePath, TEST_KEY)
      appendRecord(filePath, TEST_KEY, {
        id: 'r1',
        answers: { id_card: '110101199001011234' },
        createdAt: '',
        updatedAt: ''
      })
      const result = checkKeyDuplicate(
        filePath, TEST_KEY, ['id_card'], { id_card: '110101199001011234' }, 'r1'
      )
      expect(result.isDuplicate).toBe(false)
    })
  })

  describe('getDataFilePath', () => {
    it('returns correct path', () => {
      expect(getDataFilePath('/projects', 'myproject')).toBe(join('/projects', 'myproject.easyepi_data'))
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run tests/unit/main/services/record.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the record service**

```typescript
// src/main/services/record.service.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run tests/unit/main/services/record.service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/record.service.ts tests/unit/main/services/record.service.test.ts
git commit -m "feat(M4): implement record service with encrypted data file CRUD"
```

---

### Task 3: Record IPC Handlers

**Files:**
- Create: `src/main/ipc/record.ipc.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `ProjectIpcState` from `project.ipc.ts`, record service functions, contract parsers
- Produces: 6 IPC channels registered on `ipcMain`

- [ ] **Step 1: Create the record IPC handler file**

```typescript
// src/main/ipc/record.ipc.ts
import { randomUUID } from 'node:crypto'

import type { RecordData } from '@shared/types/record'
import {
  RECORD_SUBMIT_CHANNEL,
  RECORD_LIST_CHANNEL,
  RECORD_DELETE_CHANNEL,
  RECORD_GET_PROGRESS_CHANNEL,
  RECORD_SAVE_PROGRESS_CHANNEL,
  RECORD_CHECK_KEY_CHANNEL,
  parseRecordSubmitRequest,
  parseRecordListRequest,
  parseRecordDeleteRequest,
  parseKeyDuplicateRequest,
  type RecordSubmitResult,
  type RecordListResult,
  type EntryProgressResult,
  type KeyDuplicateResult
} from '@shared/record-contract'

import {
  createDataFile,
  loadRecords,
  appendRecord,
  deleteRecords,
  checkKeyDuplicate,
  getDataFilePath
} from '../services/record.service'

import type { ProjectIpcState } from './project.ipc'
import { type IpcMainLike, type IpcInvokeEventLike, assertTrustedSender } from './types'

export interface RecordIpcState {
  entryProgress: {
    currentIndex: number
    batchCount: number
    batchStartTime: number
    currentAnswers: Record<string, unknown>
  }
}

export function createRecordIpcState(): RecordIpcState {
  return {
    entryProgress: {
      currentIndex: 0,
      batchCount: 0,
      batchStartTime: Date.now(),
      currentAnswers: {}
    }
  }
}

function ensureDataFile(projectState: ProjectIpcState): { filePath: string; key: Buffer } {
  if (!projectState.currentProject) throw new Error('NO_PROJECT_OPEN')
  const key = projectState.auth.encryptionKey
  if (!key) throw new Error('PROJECT_NOT_UNLOCKED')

  const folderPath = projectState.currentProject.meta.folderPath
  const name = projectState.currentProject.meta.name
  const filePath = getDataFilePath(folderPath, name)

  if (!require('node:fs').existsSync(filePath)) {
    createDataFile(filePath, key)
  }

  return { filePath, key }
}

export function registerRecordIpc(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  recordState: RecordIpcState,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {

  ipcMain.handle(RECORD_SUBMIT_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseRecordSubmitRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)

    // Check Key duplicate
    const keyQuestionIds = projectState.currentProject?.questionnaire.keyQuestionIds ?? []
    if (keyQuestionIds.length > 0) {
      const keyQuestions = projectState.currentProject?.questionnaire.questions.filter(
        (q) => keyQuestionIds.includes(q.id)
      ) ?? []
      const keyFieldNames = keyQuestions.map((q) => q.variableName)
      const keyValues: Record<string, unknown> = {}
      for (const q of keyQuestions) {
        keyValues[q.variableName] = request.answers[q.id] ?? request.answers[q.variableName]
      }

      const dup = checkKeyDuplicate(filePath, key, keyFieldNames, keyValues)
      if (dup.isDuplicate) {
        return { ok: false, error: 'KEY_DUPLICATE', recordId: dup.duplicateRecordId } satisfies RecordSubmitResult
      }
    }

    const now = new Date().toISOString()
    const record: RecordData = {
      id: randomUUID(),
      answers: request.answers as Record<string, import('@shared/types/record').AnswerValue>,
      createdAt: now,
      updatedAt: now
    }

    appendRecord(filePath, key, record)

    // Update progress
    recordState.entryProgress.batchCount++
    recordState.entryProgress.currentIndex = 0
    recordState.entryProgress.currentAnswers = {}

    return { ok: true, recordId: record.id } satisfies RecordSubmitResult
  })

  ipcMain.handle(RECORD_LIST_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseRecordListRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)

    const allRecords = loadRecords(filePath, key)
    const offset = request.offset ?? 0
    const limit = request.limit ?? 100
    const sliced = allRecords.slice(offset, offset + limit)

    return {
      ok: true,
      records: sliced.map((r) => ({
        id: r.id,
        answers: r.answers as Record<string, unknown>,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })),
      total: allRecords.length
    } satisfies RecordListResult
  })

  ipcMain.handle(RECORD_DELETE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseRecordDeleteRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)
    deleteRecords(filePath, key, request.recordIds)
    return { ok: true }
  })

  ipcMain.handle(RECORD_GET_PROGRESS_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    return {
      ok: true,
      currentIndex: recordState.entryProgress.currentIndex,
      batchCount: recordState.entryProgress.batchCount,
      batchStartTime: recordState.entryProgress.batchStartTime,
      currentAnswers: recordState.entryProgress.currentAnswers
    } satisfies EntryProgressResult
  })

  ipcMain.handle(RECORD_SAVE_PROGRESS_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    if (typeof rawRequest === 'object' && rawRequest !== null) {
      const req = rawRequest as Record<string, unknown>
      if (typeof req.currentIndex === 'number') {
        recordState.entryProgress.currentIndex = req.currentIndex
      }
      if (typeof req.batchStartTime === 'number') {
        recordState.entryProgress.batchStartTime = req.batchStartTime
      }
      if (typeof req.currentAnswers === 'object' && req.currentAnswers !== null) {
        recordState.entryProgress.currentAnswers = req.currentAnswers as Record<string, unknown>
      }
    }
    return { ok: true }
  })

  ipcMain.handle(RECORD_CHECK_KEY_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseKeyDuplicateRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)

    const keyQuestionIds = projectState.currentProject?.questionnaire.keyQuestionIds ?? []
    const keyQuestions = projectState.currentProject?.questionnaire.questions.filter(
      (q) => keyQuestionIds.includes(q.id)
    ) ?? []
    const keyFieldNames = keyQuestions.map((q) => q.variableName)

    const result = checkKeyDuplicate(filePath, key, keyFieldNames, request.keyValues, request.excludeRecordId)
    return { ok: true, isDuplicate: result.isDuplicate, duplicateRecordId: result.duplicateRecordId } satisfies KeyDuplicateResult
  })

  return () => {
    ipcMain.removeHandler(RECORD_SUBMIT_CHANNEL)
    ipcMain.removeHandler(RECORD_LIST_CHANNEL)
    ipcMain.removeHandler(RECORD_DELETE_CHANNEL)
    ipcMain.removeHandler(RECORD_GET_PROGRESS_CHANNEL)
    ipcMain.removeHandler(RECORD_SAVE_PROGRESS_CHANNEL)
    ipcMain.removeHandler(RECORD_CHECK_KEY_CHANNEL)
  }
}
```

- [ ] **Step 2: Update main/index.ts to register record IPC**

Add imports and registration to `src/main/index.ts`:
```typescript
// Add imports:
import { createRecordIpcState, registerRecordIpc } from './ipc/record.ipc'

// Add alongside other state/dispose variables:
let disposeRecordIpc: (() => void) | undefined

// In whenReady, after registerQnaireIpc:
const recordState = createRecordIpcState()
disposeRecordIpc = registerRecordIpc(
  ipcMain,
  projectState,
  recordState,
  packagedRendererUrl,
  developmentUrl
)

// In will-quit handler:
disposeRecordIpc?.()
disposeRecordIpc = undefined
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/record.ipc.ts src/main/index.ts
git commit -m "feat(M4): register record IPC handlers for data entry"
```

---

### Task 4: Extend Desktop API with Record Namespace

**Files:**
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/desktop-api.ts`
- Modify: `src/preload/index.ts` (if needed)

**Interfaces:**
- Produces: `window.easyEpi.record` namespace with submit, list, delete, getProgress, saveProgress, checkKeyDuplicate

- [ ] **Step 1: Add record namespace to DesktopApi interface**

Add to `src/shared/desktop-api.ts`:

```typescript
import type { RecordSubmitResult, RecordListResult, EntryProgressResult, KeyDuplicateResult } from './record-contract'

// Add to DesktopApi interface:
record: {
  submit(answers: Record<string, unknown>): Promise<RecordSubmitResult>
  list(offset?: number, limit?: number): Promise<RecordListResult>
  delete(recordIds: string[]): Promise<{ ok: boolean }>
  getProgress(): Promise<EntryProgressResult>
  saveProgress(data: { currentIndex?: number; batchStartTime?: number; currentAnswers?: Record<string, unknown> }): Promise<{ ok: boolean }>
  checkKeyDuplicate(keyValues: Record<string, unknown>, excludeRecordId?: string): Promise<KeyDuplicateResult>
}
```

- [ ] **Step 2: Add record channel bindings to preload**

Add to `src/preload/desktop-api.ts`:

```typescript
import {
  RECORD_SUBMIT_CHANNEL,
  RECORD_LIST_CHANNEL,
  RECORD_DELETE_CHANNEL,
  RECORD_GET_PROGRESS_CHANNEL,
  RECORD_SAVE_PROGRESS_CHANNEL,
  RECORD_CHECK_KEY_CHANNEL,
  parseRecordSubmitResult,
  type RecordSubmitResult,
  type RecordListResult,
  type EntryProgressResult,
  type KeyDuplicateResult
} from '@shared/record-contract'

// Add to DesktopInvoke interface:
(channel: typeof RECORD_SUBMIT_CHANNEL, answers: Record<string, unknown>): Promise<unknown>
(channel: typeof RECORD_LIST_CHANNEL, request: { offset?: number; limit?: number }): Promise<unknown>
(channel: typeof RECORD_DELETE_CHANNEL, request: { recordIds: string[] }): Promise<unknown>
(channel: typeof RECORD_GET_PROGRESS_CHANNEL): Promise<unknown>
(channel: typeof RECORD_SAVE_PROGRESS_CHANNEL, data: { currentIndex?: number; batchStartTime?: number; currentAnswers?: Record<string, unknown> }): Promise<unknown>
(channel: typeof RECORD_CHECK_KEY_CHANNEL, request: { keyValues: Record<string, unknown>; excludeRecordId?: string }): Promise<unknown>

// Add record namespace in createDesktopApi:
const record = Object.freeze({
  submit: async (answers: Record<string, unknown>) =>
    (await invoke(RECORD_SUBMIT_CHANNEL, answers)) as RecordSubmitResult,
  list: async (offset?: number, limit?: number) =>
    (await invoke(RECORD_LIST_CHANNEL, { offset, limit })) as RecordListResult,
  delete: async (recordIds: string[]) =>
    (await invoke(RECORD_DELETE_CHANNEL, { recordIds })) as { ok: boolean },
  getProgress: async () =>
    (await invoke(RECORD_GET_PROGRESS_CHANNEL)) as EntryProgressResult,
  saveProgress: async (data: { currentIndex?: number; batchStartTime?: number; currentAnswers?: Record<string, unknown> }) =>
    (await invoke(RECORD_SAVE_PROGRESS_CHANNEL, data)) as { ok: boolean },
  checkKeyDuplicate: async (keyValues: Record<string, unknown>, excludeRecordId?: string) =>
    (await invoke(RECORD_CHECK_KEY_CHANNEL, { keyValues, excludeRecordId })) as KeyDuplicateResult
})

// Update the desktopApi object to include record:
const desktopApi = { system, preferences, dialog, project, qnaire, record } satisfies DesktopApi
```

- [ ] **Step 3: Run all tests**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/desktop-api.ts src/preload/desktop-api.ts
git commit -m "feat(M4): extend DesktopApi with record namespace"
```

---

### Task 5: Entry Store — Production Zustand Store

**Files:**
- Create: `src/renderer/stores/entry.store.ts`

**Interfaces:**
- Consumes: `window.easyEpi.qnaire.getData()`, `window.easyEpi.record.*`, `getVisibleQuestions`, `validateQuestionAnswer` from `@shared/types/qnaire`
- Produces: `createEntryStore()` returning `StoreApi<EntryState & EntryActions>`

- [ ] **Step 1: Create the entry store**

```typescript
// src/renderer/stores/entry.store.ts
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { QuestionDef, QuestionnaireDef } from '@shared/types/qnaire'
import { getVisibleQuestions, validateQuestionAnswer } from '@shared/types/qnaire'

export type EntryPhase = 'idle' | 'entering' | 'confirming' | 'submitted' | 'work_end'

export interface EntryState {
  phase: EntryPhase
  questionnaire: QuestionnaireDef | null
  visibleQuestions: readonly Readonly<QuestionDef>[]
  currentIndex: number
  answers: Readonly<Record<string, string>>
  validationError: string | null
  batchCount: number
  batchStartTime: number
  isLoading: boolean
  error: string | null
  lastSubmitError: string | null
}

export interface EntryActions {
  loadQuestionnaire(): Promise<void>
  startEntry(): void
  setAnswer(questionId: string, value: string): void
  goNext(): boolean
  goPrev(): void
  skipQuestion(): void
  submitRecord(): Promise<boolean>
  confirmSubmit(): void
  startNextRecord(): void
  endWork(): void
  reset(): void
  saveProgress(): Promise<void>
  restoreProgress(): Promise<void>
}

export type EntryStore = StoreApi<EntryState & EntryActions>

function computeVisibleQuestions(qnaire: QuestionnaireDef, answers: Record<string, string>): QuestionDef[] {
  return getVisibleQuestions(qnaire, answers as Record<string, unknown>)
}

export function createEntryStore(): EntryStore {
  return createStore<EntryState & EntryActions>()((set, get) => ({
    phase: 'idle',
    questionnaire: null,
    visibleQuestions: [],
    currentIndex: 0,
    answers: {},
    validationError: null,
    batchCount: 0,
    batchStartTime: Date.now(),
    isLoading: false,
    error: null,
    lastSubmitError: null,

    loadQuestionnaire: async () => {
      set({ isLoading: true, error: null })
      try {
        const qnaire = await window.easyEpi.qnaire.getData()
        const visible = computeVisibleQuestions(qnaire, {})
        set({
          questionnaire: qnaire,
          visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
          isLoading: false
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ isLoading: false, error: `加载问卷失败: ${msg}` })
      }
    },

    startEntry: () => {
      const state = get()
      if (!state.questionnaire) return
      const visible = computeVisibleQuestions(state.questionnaire, {})
      set({
        phase: 'entering',
        visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
        currentIndex: 0,
        answers: {},
        validationError: null,
        lastSubmitError: null,
        batchStartTime: Date.now()
      })
    },

    setAnswer: (questionId, value) => {
      const state = get()
      const newAnswers = { ...state.answers, [questionId]: value }
      if (!state.questionnaire) return
      const visible = computeVisibleQuestions(state.questionnaire, newAnswers)
      set({
        answers: Object.freeze(newAnswers),
        visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
        validationError: null
      })
    },

    goNext: () => {
      const state = get()
      const question = state.visibleQuestions[state.currentIndex]
      if (!question || state.phase !== 'entering') return false

      const error = validateQuestionAnswer(question, state.answers[question.id])
      if (error) {
        set({ validationError: error })
        return false
      }

      if (state.currentIndex >= state.visibleQuestions.length - 1) {
        set({ phase: 'confirming', validationError: null })
        return true
      }

      set({ currentIndex: state.currentIndex + 1, validationError: null })
      return true
    },

    goPrev: () => {
      const state = get()
      if (state.phase === 'confirming') {
        set({ phase: 'entering', validationError: null })
        return
      }
      if (state.currentIndex > 0) {
        set({ currentIndex: state.currentIndex - 1, validationError: null })
      }
    },

    skipQuestion: () => {
      const state = get()
      const question = state.visibleQuestions[state.currentIndex]
      if (!question || !question.allowSkip || state.phase !== 'entering') return

      const skipValue = question.skipValue ?? '-9'
      const newAnswers = { ...state.answers, [question.id]: skipValue }
      if (!state.questionnaire) return
      const visible = computeVisibleQuestions(state.questionnaire, newAnswers)

      if (state.currentIndex >= state.visibleQuestions.length - 1) {
        set({
          answers: Object.freeze(newAnswers),
          visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
          phase: 'confirming',
          validationError: null
        })
      } else {
        set({
          answers: Object.freeze(newAnswers),
          visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
          currentIndex: state.currentIndex + 1,
          validationError: null
        })
      }
    },

    submitRecord: async () => {
      const state = get()
      if (state.phase !== 'confirming') return false
      try {
        const result = await window.easyEpi.record.submit(state.answers as Record<string, unknown>)
        if (result.ok) {
          set((s) => ({
            phase: 'submitted',
            batchCount: s.batchCount + 1,
            lastSubmitError: null
          }))
          return true
        } else {
          set({ lastSubmitError: result.error ?? '提交失败' })
          return false
        }
      } catch (e) {
        set({ lastSubmitError: (e as Error).message })
        return false
      }
    },

    confirmSubmit: () => {
      set({ phase: 'work_end' })
    },

    startNextRecord: () => {
      const state = get()
      if (!state.questionnaire) return
      const visible = computeVisibleQuestions(state.questionnaire, {})
      set({
        phase: 'entering',
        visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
        currentIndex: 0,
        answers: {},
        validationError: null,
        lastSubmitError: null
      })
    },

    endWork: () => {
      set({
        phase: 'idle',
        currentIndex: 0,
        answers: {},
        validationError: null,
        lastSubmitError: null
      })
    },

    reset: () => {
      set({
        phase: 'idle',
        questionnaire: null,
        visibleQuestions: [],
        currentIndex: 0,
        answers: {},
        validationError: null,
        batchCount: 0,
        batchStartTime: Date.now(),
        isLoading: false,
        error: null,
        lastSubmitError: null
      })
    },

    saveProgress: async () => {
      const state = get()
      try {
        await window.easyEpi.record.saveProgress({
          currentIndex: state.currentIndex,
          batchStartTime: state.batchStartTime,
          currentAnswers: state.answers as Record<string, unknown>
        })
      } catch {
        // Silent fail for auto-save
      }
    },

    restoreProgress: async () => {
      try {
        const progress = await window.easyEpi.record.getProgress()
        if (progress.ok && progress.batchCount > 0) {
          set({
            batchCount: progress.batchCount,
            batchStartTime: progress.batchStartTime,
            currentIndex: progress.currentIndex,
            answers: Object.freeze(progress.currentAnswers as Record<string, string>)
          })
        }
      } catch {
        // Silent fail for restore
      }
    }
  }))
}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/stores/entry.store.ts
git commit -m "feat(M4): implement production entry store with skip logic and submit"
```

---

### Task 6: Entry Input Components

**Files:**
- Create: `src/renderer/components/entry/SingleChoiceInput.tsx`
- Create: `src/renderer/components/entry/MultiChoiceInput.tsx`
- Create: `src/renderer/components/entry/FixedLengthInput.tsx`
- Create: `src/renderer/components/entry/FreeTextInput.tsx`
- Create: `src/renderer/components/entry/NumericRangeInput.tsx`
- Create: `src/renderer/components/entry/DateInput.tsx`
- Create: `src/renderer/components/entry/index.ts`

All components follow the same pattern: receive `question`, `value`, `onChange`, `error` props. Use existing `Radio`, `Checkbox`, `Input`, `Textarea` from `@renderer/components/ui`.

- [ ] **Step 1: Create SingleChoiceInput**

```tsx
// src/renderer/components/entry/SingleChoiceInput.tsx
import { Radio } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface SingleChoiceInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function SingleChoiceInput({ question, value, onChange, error }: SingleChoiceInputProps) {
  return (
    <div className="grid gap-[var(--space-2)]">
      <Radio
        label={question.content}
        options={question.options.map((opt) => ({
          value: opt.value,
          label: opt.label,
          itemProps: {
            className: 'focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]'
          }
        }))}
        value={value}
        onValueChange={onChange}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p role="alert" className="m-0 text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Create MultiChoiceInput**

```tsx
// src/renderer/components/entry/MultiChoiceInput.tsx
import { Checkbox } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface MultiChoiceInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function MultiChoiceInput({ question, value, onChange, error }: MultiChoiceInputProps) {
  const selected = value ? value.split(',').filter(Boolean) : []

  const toggle = (optValue: string) => {
    const next = selected.includes(optValue)
      ? selected.filter((v) => v !== optValue)
      : [...selected, optValue]
    onChange(next.join(','))
  }

  return (
    <div className="grid gap-[var(--space-2)]">
      <p className="m-0 text-[length:var(--font-size-base)] font-[var(--font-weight-medium)]">{question.content}</p>
      {question.options.map((opt) => (
        <Checkbox
          key={opt.value}
          label={opt.label}
          checked={selected.includes(opt.value)}
          onCheckedChange={() => toggle(opt.value)}
          className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
        />
      ))}
      {error ? (
        <p role="alert" className="m-0 text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Create FixedLengthInput**

```tsx
// src/renderer/components/entry/FixedLengthInput.tsx
import { Input } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface FixedLengthInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function FixedLengthInput({ question, value, onChange, error }: FixedLengthInputProps) {
  const length = question.constraint.fixedLength ?? 0

  return (
    <div className="grid gap-[var(--space-2)]">
      <Input
        label={question.content}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        maxLength={length}
        className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
      />
      {length > 0 ? (
        <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
          已输入 {value.length} / {length}
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Create FreeTextInput**

```tsx
// src/renderer/components/entry/FreeTextInput.tsx
import { Textarea } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface FreeTextInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function FreeTextInput({ question, value, onChange, error }: FreeTextInputProps) {
  return (
    <Textarea
      label={question.content}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      rows={4}
      className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
    />
  )
}
```

- [ ] **Step 5: Create NumericRangeInput**

```tsx
// src/renderer/components/entry/NumericRangeInput.tsx
import { Input } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface NumericRangeInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function NumericRangeInput({ question, value, onChange, error }: NumericRangeInputProps) {
  const { minValue, maxValue, step } = question.constraint
  const hint = minValue !== undefined && maxValue !== undefined
    ? `范围: ${minValue} - ${maxValue}${step ? ` (步长: ${step})` : ''}`
    : undefined

  return (
    <div className="grid gap-[var(--space-2)]">
      <Input
        label={question.content}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        min={minValue}
        max={maxValue}
        step={step}
        className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
      />
      {hint ? (
        <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">{hint}</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 6: Create DateInput**

```tsx
// src/renderer/components/entry/DateInput.tsx
import { Input } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface DateInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function DateInput({ question, value, onChange, error }: DateInputProps) {
  return (
    <Input
      label={question.content}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
    />
  )
}
```

- [ ] **Step 7: Create barrel export**

```typescript
// src/renderer/components/entry/index.ts
export { SingleChoiceInput } from './SingleChoiceInput'
export { MultiChoiceInput } from './MultiChoiceInput'
export { FixedLengthInput } from './FixedLengthInput'
export { FreeTextInput } from './FreeTextInput'
export { NumericRangeInput } from './NumericRangeInput'
export { DateInput } from './DateInput'
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/entry/
git commit -m "feat(M4): create entry input components for all 6 question types"
```

---

### Task 7: QuestionCard — Dynamic Question Renderer

**Files:**
- Create: `src/renderer/components/entry/QuestionCard.tsx`

**Interfaces:**
- Consumes: `QuestionDef`, all input components from `entry/index.ts`
- Produces: `QuestionCard` component that renders the correct input for a question's type

- [ ] **Step 1: Create QuestionCard**

```tsx
// src/renderer/components/entry/QuestionCard.tsx
import type { QuestionDef } from '@shared/types/qnaire'
import { QUESTION_TYPE_LABELS } from '@shared/types/qnaire'
import {
  SingleChoiceInput,
  MultiChoiceInput,
  FixedLengthInput,
  FreeTextInput,
  NumericRangeInput,
  DateInput
} from '.'

export interface QuestionCardProps {
  question: QuestionDef
  questionIndex: number
  totalVisible: number
  value: string
  onChange: (value: string) => void
  error?: string
}

export function QuestionCard({
  question,
  questionIndex,
  totalVisible,
  value,
  onChange,
  error
}: QuestionCardProps) {
  const inputProps = { question, value, onChange, error }

  return (
    <section
      aria-labelledby="entry-question-heading"
      className="mx-auto grid w-full max-w-3xl gap-[var(--space-5)] rounded-[var(--radius-3)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-5)] shadow-[var(--shadow-z1)]"
    >
      <div className="grid gap-[var(--space-1)]">
        <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
          第 {questionIndex + 1} 题 / 共 {totalVisible} 题
          <span className="ml-[var(--space-2)] text-[length:var(--font-size-xs)] text-[var(--color-text-tertiary)]">
            ({QUESTION_TYPE_LABELS[question.type]})
          </span>
        </p>
        <h2 id="entry-question-heading" className="m-0 text-[length:var(--font-size-xl)]">
          {question.content}
          {question.isKey ? <span className="ml-[var(--space-1)] text-[var(--color-key)]" aria-label="Key 标识符">🔑</span> : null}
          {!question.allowSkip ? <span aria-hidden="true"> *</span> : null}
        </h2>
      </div>

      {question.type === 'single_choice' && <SingleChoiceInput {...inputProps} />}
      {question.type === 'multiple_choice' && <MultiChoiceInput {...inputProps} />}
      {question.type === 'fixed_length' && <FixedLengthInput {...inputProps} />}
      {question.type === 'free_text' && <FreeTextInput {...inputProps} />}
      {question.type === 'numeric_range' && <NumericRangeInput {...inputProps} />}
      {question.type === 'date' && <DateInput {...inputProps} />}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/entry/QuestionCard.tsx
git commit -m "feat(M4): create QuestionCard dynamic renderer"
```

---

### Task 8: EntryPage — Production Entry Experience

**Files:**
- Modify: `src/renderer/pages/EntryPage.tsx`

**Interfaces:**
- Consumes: `createEntryStore`, `QuestionCard`, `Progress`, `Button` from UI
- Produces: Full one-question-per-screen entry page with keyboard shortcuts

- [ ] **Step 1: Rewrite EntryPage**

```tsx
// src/renderer/pages/EntryPage.tsx
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from 'zustand'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, EmptyState, Progress } from '@renderer/components/ui'
import { QuestionCard } from '@renderer/components/entry/QuestionCard'
import { createEntryStore, type EntryStore } from '@renderer/stores/entry.store'

export interface EntryPageProps {
  store?: EntryStore
}

export function EntryPage({ store: injectedStore }: EntryPageProps) {
  const [store] = useState(() => injectedStore ?? createEntryStore())
  const state = useStore(store)
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  const questionRegionRef = useRef<HTMLElement>(null)
  const shouldMoveFocusRef = useRef(false)

  const { phase, visibleQuestions, currentIndex, answers, validationError, batchCount, isLoading, error, lastSubmitError } = state

  // Load questionnaire on mount
  useEffect(() => {
    store.getState().loadQuestionnaire()
  }, [store])

  // Focus management
  useLayoutEffect(() => {
    if (!shouldMoveFocusRef.current) return
    shouldMoveFocusRef.current = false
    questionRegionRef.current
      ?.querySelector<HTMLElement>('input:not(:disabled), [role="radio"]:not([disabled]), textarea')
      ?.focus()
  }, [currentIndex, phase])

  const handleNext = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().goNext()
  }, [store])

  const handlePrev = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().goPrev()
  }, [store])

  const handleSkip = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().skipQuestion()
  }, [store])

  const handleSubmit = useCallback(async () => {
    const success = await store.getState().submitRecord()
    if (success) {
      store.getState().confirmSubmit()
    }
  }, [store])

  const handleStartNext = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().startNextRecord()
  }, [store])

  const handleEndWork = useCallback(() => {
    store.getState().endWork()
    navigate('/')
  }, [store, navigate])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase !== 'entering') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleNext()
        }
        return
      }

      // Number keys for single choice
      if (e.key >= '1' && e.key <= '9') {
        const question = visibleQuestions[currentIndex]
        if (question?.type === 'single_choice') {
          const optIndex = parseInt(e.key) - 1
          if (optIndex < question.options.length) {
            store.getState().setAnswer(question.id, question.options[optIndex]!.value)
            e.preventDefault()
          }
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        handleNext()
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        handlePrev()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleEndWork()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, visibleQuestions, currentIndex, handleNext, handlePrev, handleEndWork, store])

  if (handle === null) throw new Error('ENTRY_ROUTE_METADATA_MISSING')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-[var(--space-8)]">
        <p className="text-[var(--color-text-secondary)]">加载问卷中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        title="加载失败"
        description={error}
        action={<Button onClick={() => store.getState().loadQuestionnaire()}>重试</Button>}
      />
    )
  }

  if (phase === 'idle') {
    return (
      <EmptyState
        title="准备录入"
        description={`已加载问卷，共 ${visibleQuestions.length} 题。批次已录入: ${batchCount} 份`}
        action={
          <div className="flex gap-[var(--space-3)]">
            <Button onClick={() => { shouldMoveFocusRef.current = true; store.getState().startEntry() }}>
              开始录入
            </Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              返回
            </Button>
          </div>
        }
      />
    )
  }

  if (phase === 'confirming') {
    const keyQuestions = state.questionnaire?.questions.filter((q) => q.isKey) ?? []
    return (
      <section
        className="mx-auto grid w-full max-w-3xl gap-[var(--space-5)] rounded-[var(--radius-3)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-5)] shadow-[var(--shadow-z1)]"
        aria-labelledby="confirm-heading"
      >
        <h2 id="confirm-heading" className="m-0 text-[length:var(--font-size-xl)]">
          确认提交
        </h2>
        <p className="m-0 text-[var(--color-text-secondary)]">请核对以下关键信息后再提交：</p>
        <div className="grid gap-[var(--space-2)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] p-[var(--space-4)]">
          {keyQuestions.map((q) => (
            <div key={q.id} className="flex justify-between">
              <span className="text-[var(--color-text-secondary)]">{q.content}</span>
              <span className="font-[var(--font-weight-medium)]">{answers[q.id] ?? '-'}</span>
            </div>
          ))}
          {keyQuestions.length === 0 ? (
            <p className="m-0 text-[var(--color-text-tertiary)]">未设置 Key 标识符</p>
          ) : null}
        </div>
        {lastSubmitError ? (
          <p role="alert" className="m-0 text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-danger)]">
            {lastSubmitError === 'KEY_DUPLICATE' ? 'Key 标识符重复，请返回修改' : `提交失败: ${lastSubmitError}`}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-[var(--space-3)]">
          <Button variant="secondary" onClick={handlePrev}>返回修改</Button>
          <Button onClick={handleSubmit}>确认提交</Button>
        </div>
      </section>
    )
  }

  if (phase === 'submitted' || phase === 'work_end') {
    return (
      <EmptyState
        title="记录已保存"
        description={`本次已录入: ${batchCount} 份`}
        action={
          <div className="flex gap-[var(--space-3)]">
            <Button onClick={handleStartNext}>开始下一份</Button>
            <Button variant="secondary" onClick={handleEndWork}>结束工作</Button>
          </div>
        }
      />
    )
  }

  // Entering phase
  const currentQuestion = visibleQuestions[currentIndex]
  if (!currentQuestion) {
    return <EmptyState title="没有可见题目" description="所有题目均被条件规则跳过。" />
  }

  const progressValue = currentIndex + 1
  const progressMax = visibleQuestions.length

  return (
    <div className="grid gap-[var(--space-4)]">
      <Progress
        label="录入进度"
        max={progressMax}
        value={progressValue}
        valueLabel={`${progressValue} / ${progressMax}`}
        valueText={`第 ${progressValue} 题，共 ${progressMax} 题`}
      />
      <QuestionCard
        ref={questionRegionRef}
        question={currentQuestion}
        questionIndex={currentIndex}
        totalVisible={visibleQuestions.length}
        value={answers[currentQuestion.id] ?? ''}
        onChange={(v) => store.getState().setAnswer(currentQuestion.id, v)}
        error={validationError ?? undefined}
      />
      <p className="m-0 text-center text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
        键盘: 1-9 选择选项 | Enter 下一题 | Backspace 上一题 | Esc 结束
      </p>
      <div className="flex flex-wrap justify-between gap-[var(--space-3)]">
        <Button variant="secondary" disabled={currentIndex === 0} onClick={handlePrev}>
          上一题
        </Button>
        <div className="flex gap-[var(--space-2)]">
          {currentQuestion.allowSkip ? (
            <Button variant="ghost" onClick={handleSkip}>不想回答</Button>
          ) : null}
          <Button onClick={handleNext}>
            {currentIndex >= visibleQuestions.length - 1 ? '完成录入' : '下一题'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run existing tests**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run`
Expected: PASS (existing entry page tests may need updating for the new interface)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/EntryPage.tsx
git commit -m "feat(M4): replace demo entry page with production entry experience"
```

---

### Task 9: WorkSessionPage — Batch Stats and Cycle

**Files:**
- Modify: `src/renderer/pages/WorkSessionPage.tsx`

- [ ] **Step 1: Update WorkSessionPage to use entry store**

The WorkSessionPage now just shows the work-end state. Since the entry store handles the full lifecycle, this page becomes a redirect or companion. For simplicity, the work-end state is handled directly in EntryPage (phase === 'work_end'). Update WorkSessionPage to be a simple redirect:

```tsx
// src/renderer/pages/WorkSessionPage.tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function WorkSessionPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/entry', { replace: true })
  }, [navigate])

  return null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/pages/WorkSessionPage.tsx
git commit -m "feat(M4): redirect work session to entry page"
```

---

### Task 10: Integration Tests and Final Verification

**Files:**
- Create: `tests/unit/renderer/stores/entry.store.test.ts`

- [ ] **Step 1: Write entry store unit tests**

```typescript
// tests/unit/renderer/stores/entry.store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createEntryStore } from '@renderer/stores/entry.store'

// Mock window.easyEpi
const mockQnaireGetData = vi.fn()
const mockRecordSubmit = vi.fn()
const mockRecordSaveProgress = vi.fn()
const mockRecordGetProgress = vi.fn()

vi.stubGlobal('window', {
  easyEpi: {
    qnaire: { getData: mockQnaireGetData },
    record: {
      submit: mockRecordSubmit,
      saveProgress: mockRecordSaveProgress,
      getProgress: mockRecordGetProgress
    }
  }
})

const testQuestionnaire = {
  name: 'Test',
  questions: [
    {
      id: 'q1',
      content: '性别',
      variableName: 'sex',
      type: 'single_choice' as const,
      options: [
        { value: '1', label: '男' },
        { value: '2', label: '女' }
      ],
      constraint: { type: 'none' as const },
      isKey: false,
      allowSkip: false,
      order: 0
    },
    {
      id: 'q2',
      content: '姓名',
      variableName: 'name',
      type: 'free_text' as const,
      options: [],
      constraint: { type: 'none' as const },
      isKey: true,
      allowSkip: false,
      order: 1
    }
  ],
  conditionRules: [],
  keyQuestionIds: ['q2']
}

describe('entry.store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQnaireGetData.mockResolvedValue(testQuestionnaire)
    mockRecordSubmit.mockResolvedValue({ ok: true, recordId: 'test-id' })
    mockRecordSaveProgress.mockResolvedValue({ ok: true })
    mockRecordGetProgress.mockResolvedValue({ ok: true, currentIndex: 0, batchCount: 0, batchStartTime: Date.now(), currentAnswers: {} })
  })

  it('starts in idle phase', () => {
    const store = createEntryStore()
    expect(store.getState().phase).toBe('idle')
  })

  it('loads questionnaire', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    expect(store.getState().questionnaire?.name).toBe('Test')
    expect(store.getState().visibleQuestions).toHaveLength(2)
  })

  it('starts entry and shows first question', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    expect(store.getState().phase).toBe('entering')
    expect(store.getState().currentIndex).toBe(0)
  })

  it('sets answer and navigates', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    expect(store.getState().answers['q1']).toBe('1')
    const moved = store.getState().goNext()
    expect(moved).toBe(true)
    expect(store.getState().currentIndex).toBe(1)
  })

  it('validates required fields', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    const moved = store.getState().goNext()
    expect(moved).toBe(false)
    expect(store.getState().validationError).toBeTruthy()
  })

  it('goes to confirming phase after last question', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    expect(store.getState().phase).toBe('confirming')
  })

  it('submits record successfully', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    const success = await store.getState().submitRecord()
    expect(success).toBe(true)
    expect(store.getState().batchCount).toBe(1)
  })

  it('handles goPrev from confirming', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    expect(store.getState().phase).toBe('confirming')
    store.getState().goPrev()
    expect(store.getState().phase).toBe('entering')
  })

  it('starts next record after submit', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    await store.getState().submitRecord()
    store.getState().confirmSubmit()
    store.getState().startNextRecord()
    expect(store.getState().phase).toBe('entering')
    expect(store.getState().currentIndex).toBe(0)
    expect(store.getState().answers).toEqual({})
  })
})
```

- [ ] **Step 2: Run all tests**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm vitest run`
Expected: All tests pass

- [ ] **Step 3: Run type check**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `cd D:\EasyEpi\.worktrees\M4; pnpm lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add tests/unit/renderer/stores/entry.store.test.ts
git commit -m "test(M4): add entry store unit tests"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `pnpm vitest run` — all tests pass
- [ ] `pnpm tsc --noEmit` — no type errors
- [ ] `pnpm lint` — no lint errors
- [ ] Can open a project and see the entry page with real questionnaire data
- [ ] Can answer questions of each type (single choice, multi choice, fixed length, free text, numeric, date)
- [ ] Skip logic works (conditional questions appear/disappear based on answers)
- [ ] Progress bar updates correctly
- [ ] Can submit a record and see batch count increment
- [ ] Key duplicate detection works
- [ ] Keyboard shortcuts work (1-9, Enter, Backspace, Esc)
- [ ] Can start next record and end work
