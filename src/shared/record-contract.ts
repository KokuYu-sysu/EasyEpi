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

export interface EntryProgressResult {
  ok: boolean
  hasDraft: boolean
  currentIndex: number
  batchCount: number
  batchStartTime: number
  currentAnswers: Record<string, unknown>
}

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
