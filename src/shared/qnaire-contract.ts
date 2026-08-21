export const PROJECT_CREATE_CHANNEL = 'project:create' as const
export const PROJECT_OPEN_CHANNEL = 'project:open' as const
export const PROJECT_SAVE_CHANNEL = 'project:save' as const
export const PROJECT_CLOSE_CHANNEL = 'project:close' as const
export const PROJECT_BACKUP_CHANNEL = 'project:backup' as const
export const PROJECT_LIST_BACKUPS_CHANNEL = 'project:listBackups' as const
export const PROJECT_RESTORE_CHANNEL = 'project:restore' as const

export const QNAIRE_ADD_QUESTION_CHANNEL = 'qnaire:addQuestion' as const
export const QNAIRE_UPDATE_QUESTION_CHANNEL = 'qnaire:updateQuestion' as const
export const QNAIRE_DELETE_QUESTION_CHANNEL = 'qnaire:deleteQuestion' as const
export const QNAIRE_REORDER_QUESTIONS_CHANNEL = 'qnaire:reorderQuestions' as const

export const QNAIRE_ADD_CONDITION_CHANNEL = 'qnaire:addConditionRule' as const
export const QNAIRE_UPDATE_CONDITION_CHANNEL = 'qnaire:updateConditionRule' as const
export const QNAIRE_DELETE_CONDITION_CHANNEL = 'qnaire:deleteConditionRule' as const

export const QNAIRE_GET_DATA_CHANNEL = 'qnaire:getData' as const
export const QNAIRE_UPDATE_META_CHANNEL = 'qnaire:updateMeta' as const

export const ALL_QNAIRE_CHANNELS = [
  PROJECT_CREATE_CHANNEL,
  PROJECT_OPEN_CHANNEL,
  PROJECT_SAVE_CHANNEL,
  PROJECT_CLOSE_CHANNEL,
  QNAIRE_ADD_QUESTION_CHANNEL,
  QNAIRE_UPDATE_QUESTION_CHANNEL,
  QNAIRE_DELETE_QUESTION_CHANNEL,
  QNAIRE_REORDER_QUESTIONS_CHANNEL,
  QNAIRE_ADD_CONDITION_CHANNEL,
  QNAIRE_UPDATE_CONDITION_CHANNEL,
  QNAIRE_DELETE_CONDITION_CHANNEL,
  QNAIRE_GET_DATA_CHANNEL,
  QNAIRE_UPDATE_META_CHANNEL
] as const

export type QnaireChannel = (typeof ALL_QNAIRE_CHANNELS)[number]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export interface ProjectCreateRequest {
  name: string
  folderPath: string
  password: string
}

function isSafeProjectName(name: string): boolean {
  if (name.length === 0 || name.length > 100 || name === '.' || name === '..') return false
  if (/[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) return false
  if ([...name].some((character) => character.charCodeAt(0) < 32)) return false
  return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
}

export function parseProjectCreateRequest(value: unknown): ProjectCreateRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_PROJECT_CREATE_REQUEST')
  const { name, folderPath, password } = value
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('INVALID_PROJECT_CREATE_REQUEST')
  }
  if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
    throw new Error('INVALID_PROJECT_CREATE_REQUEST')
  }
  if (typeof password !== 'string' || password.length < 1) {
    throw new Error('INVALID_PROJECT_CREATE_REQUEST')
  }
  const trimmedName = name.trim()
  if (!isSafeProjectName(trimmedName)) throw new Error('INVALID_PROJECT_NAME')
  return { name: trimmedName, folderPath: folderPath.trim(), password }
}

export interface ProjectOpenRequest {
  filePath: string
  password: string
}

export function parseProjectOpenRequest(value: unknown): ProjectOpenRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_PROJECT_OPEN_REQUEST')
  const { filePath, password } = value
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('INVALID_PROJECT_OPEN_REQUEST')
  }
  if (typeof password !== 'string' || password.length < 1) {
    throw new Error('INVALID_PROJECT_OPEN_REQUEST')
  }
  return { filePath: filePath.trim(), password }
}

export interface ProjectSaveRequest {
  folderPath: string
}

export function parseProjectSaveRequest(value: unknown): ProjectSaveRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_PROJECT_SAVE_REQUEST')
  const { folderPath } = value
  if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
    throw new Error('INVALID_PROJECT_SAVE_REQUEST')
  }
  return { folderPath: folderPath.trim() }
}

export interface ProjectResult {
  ok: boolean
  error?: string
  meta?: {
    name: string
    folderPath: string
    createdAt: string
    lastModifiedAt: string
  }
}

export function parseProjectResult(value: unknown): ProjectResult {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('INVALID_PROJECT_RESULT')
  }
  const obj = value as Record<string, unknown>
  if (obj.ok) {
    return { ok: true, meta: obj.meta as ProjectResult['meta'] }
  }
  return { ok: false, error: typeof obj.error === 'string' ? obj.error : undefined }
}

export interface ProjectRestoreRequest {
  backupPath: string
}

export function parseProjectRestoreRequest(value: unknown): ProjectRestoreRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_PROJECT_RESTORE_REQUEST')
  const { backupPath } = value
  if (typeof backupPath !== 'string' || backupPath.trim().length === 0) {
    throw new Error('INVALID_PROJECT_RESTORE_REQUEST')
  }
  return { backupPath: backupPath.trim() }
}

export interface BackupInfo {
  filePath: string
  timestamp: number
  size: number
  hasData: boolean
}

export interface BackupListResult {
  ok: boolean
  backups: BackupInfo[]
}
