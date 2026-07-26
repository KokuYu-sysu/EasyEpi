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
  data: Record<string, unknown>
}

export interface AdminDeleteRecordsRequest {
  ids: string[]
}

// Response types
export interface AdminLoginResult {
  success: boolean
  error?: string
  lockoutUntil?: number
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
  records: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Parsers
export function parseAdminLoginRequest(value: unknown): AdminLoginRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_ADMIN_LOGIN_REQUEST')
  const { password } = value
  if (typeof password !== 'string') throw new Error('INVALID_PASSWORD')
  return { password }
}

export function parseAdminChangePasswordRequest(value: unknown): AdminChangePasswordRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_CHANGE_PASSWORD_REQUEST')
  const { oldPassword, newPassword } = value
  if (typeof oldPassword !== 'string') throw new Error('INVALID_OLD_PASSWORD')
  if (typeof newPassword !== 'string') throw new Error('INVALID_NEW_PASSWORD')
  return { oldPassword, newPassword }
}

export function parseAdminGetRecordsRequest(value: unknown): AdminGetRecordsRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_GET_RECORDS_REQUEST')
  const { page, pageSize, search, sortBy, sortOrder } = value
  if (typeof page !== 'number') throw new Error('INVALID_PAGE')
  if (typeof pageSize !== 'number') throw new Error('INVALID_PAGE_SIZE')
  return {
    page,
    pageSize,
    search: typeof search === 'string' ? search : undefined,
    sortBy: typeof sortBy === 'string' ? sortBy : undefined,
    sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : undefined
  }
}

export function parseAdminUpdateRecordRequest(value: unknown): AdminUpdateRecordRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_UPDATE_RECORD_REQUEST')
  const { id, data } = value
  if (typeof id !== 'string') throw new Error('INVALID_ID')
  if (!isPlainObject(data)) throw new Error('INVALID_DATA')
  return { id, data }
}

export function parseAdminDeleteRecordsRequest(value: unknown): AdminDeleteRecordsRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DELETE_RECORDS_REQUEST')
  const { ids } = value
  if (!Array.isArray(ids)) throw new Error('INVALID_IDS')
  return { ids: ids.filter((id): id is string => typeof id === 'string') }
}