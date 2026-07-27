import type { AnswerValue, RecordData } from './types/record'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Channel constants
export const ADMIN_LOGIN_CHANNEL = 'admin:login' as const
export const ADMIN_LOGOUT_CHANNEL = 'admin:logout' as const
export const ADMIN_CHECK_SESSION_CHANNEL = 'admin:checkSession' as const
export const ADMIN_CHANGE_PASSWORD_CHANNEL = 'admin:changePassword' as const
export const ADMIN_GET_RECORDS_CHANNEL = 'admin:getRecords' as const
export const ADMIN_UPDATE_RECORD_CHANNEL = 'admin:updateRecord' as const
export const ADMIN_DELETE_RECORDS_CHANNEL = 'admin:deleteRecords' as const

export const ALL_ADMIN_CHANNELS = [
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL
] as const

export type AdminChannel = (typeof ALL_ADMIN_CHANNELS)[number]

// Request types
export interface AdminLoginRequest {
  password: string
}

export interface AdminChangePasswordRequest {
  oldPassword: string
  newPassword: string
}

export interface AdminGetRecordsRequest {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface AdminUpdateRecordRequest {
  id: string
  data: { answers: Record<string, AnswerValue> }
}

export interface AdminDeleteRecordsRequest {
  ids: string[]
}

// Response types
export interface AdminLoginResult {
  success: boolean
  error?: string
  lockoutUntil?: number
  expiresAt?: number
}

export interface AdminSessionResult {
  isAuthenticated: boolean
  expiresAt?: number
}

export interface AdminChangePasswordResult {
  success: boolean
  error?: string
}

export interface AdminRecordsResult {
  records: RecordData[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Parsers
export function parseAdminLoginRequest(value: unknown): AdminLoginRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_ADMIN_LOGIN_REQUEST')
  const { password } = value
  if (typeof password !== 'string' || password.length === 0) throw new Error('INVALID_PASSWORD')
  return { password }
}

export function parseAdminChangePasswordRequest(value: unknown): AdminChangePasswordRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_CHANGE_PASSWORD_REQUEST')
  const { oldPassword, newPassword } = value
  if (typeof oldPassword !== 'string' || oldPassword.length === 0) {
    throw new Error('INVALID_OLD_PASSWORD')
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new Error('INVALID_NEW_PASSWORD')
  }
  if (oldPassword === newPassword) throw new Error('PASSWORD_UNCHANGED')
  return { oldPassword, newPassword }
}

export function parseAdminGetRecordsRequest(value: unknown): AdminGetRecordsRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_GET_RECORDS_REQUEST')
  const { page, pageSize, search, sortBy, sortOrder } = value
  if (!Number.isSafeInteger(page) || (page as number) < 1) throw new Error('INVALID_PAGE')
  if (!Number.isSafeInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 500) {
    throw new Error('INVALID_PAGE_SIZE')
  }
  if (search !== undefined && typeof search !== 'string') throw new Error('INVALID_SEARCH')
  if (sortBy !== undefined && (typeof sortBy !== 'string' || sortBy.trim().length === 0)) {
    throw new Error('INVALID_SORT_BY')
  }
  if (sortOrder !== undefined && sortOrder !== 'asc' && sortOrder !== 'desc') {
    throw new Error('INVALID_SORT_ORDER')
  }
  return {
    page: page as number,
    pageSize: pageSize as number,
    search: typeof search === 'string' ? search.trim() || undefined : undefined,
    sortBy: typeof sortBy === 'string' ? sortBy.trim() : undefined,
    sortOrder: sortOrder as 'asc' | 'desc' | undefined
  }
}

export function parseAdminUpdateRecordRequest(value: unknown): AdminUpdateRecordRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_UPDATE_RECORD_REQUEST')
  const { id, data } = value
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('INVALID_ID')
  if (!isPlainObject(data)) throw new Error('INVALID_DATA')
  if (Object.keys(data).length !== 1 || !isPlainObject(data['answers'])) {
    throw new Error('INVALID_DATA')
  }
  const answers = data['answers']
  if (Object.keys(answers).length === 0) throw new Error('INVALID_DATA')
  for (const value of Object.values(answers)) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      !(typeof value === 'number' && Number.isFinite(value)) &&
      !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      throw new Error('INVALID_DATA')
    }
  }
  return { id: id.trim(), data: { answers } as AdminUpdateRecordRequest['data'] }
}

export function parseAdminDeleteRecordsRequest(value: unknown): AdminDeleteRecordsRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DELETE_RECORDS_REQUEST')
  const { ids } = value
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === 'string' && id.trim().length > 0)
  ) {
    throw new Error('INVALID_IDS')
  }
  const normalized = ids.map((id) => (id as string).trim())
  if (new Set(normalized).size !== normalized.length) throw new Error('INVALID_IDS')
  return { ids: normalized }
}
