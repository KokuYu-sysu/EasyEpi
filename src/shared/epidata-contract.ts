import type { ImportPreview, ImportResult } from './types/epidata'
import { isQuestionType } from './types/qnaire'
import type { QuestionType } from './types/qnaire'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Channel constants
export const EPIDATA_IMPORT_CHANNEL = 'epidata:import' as const
export const EPIDATA_PREVIEW_CHANNEL = 'epidata:preview' as const
export const EPIDATA_VALIDATE_CHANNEL = 'epidata:validate' as const
export const EPIDATA_IMPORT_PROGRESS_CHANNEL = 'epidata:import-progress' as const

export const ALL_EPIDATA_CHANNELS = [
  EPIDATA_IMPORT_CHANNEL,
  EPIDATA_PREVIEW_CHANNEL,
  EPIDATA_VALIDATE_CHANNEL,
  EPIDATA_IMPORT_PROGRESS_CHANNEL
] as const

export type EpiDataChannel = (typeof ALL_EPIDATA_CHANNELS)[number]

// Request types
export interface EpiDataImportRequest {
  qesFilePath: string
  recFilePath?: string
  targetProjectPath: string
  projectName: string
  password: string
  encoding?: string
  fieldMappings?: Record<string, QuestionType>
}

export interface EpiDataPreviewRequest {
  qesFilePath: string
  encoding?: string
}

export interface EpiDataValidateRequest {
  qesFilePath: string
}

// Response types
export type EpiDataImportResponse = ImportResult
export type EpiDataPreviewResponse = ImportPreview
export type EpiDataValidateResponse = { valid: boolean; errors: string[] }

// Parsers
export function parseEpiDataImportRequest(value: unknown): EpiDataImportRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_EPIDATA_IMPORT_REQUEST')
  const { qesFilePath, recFilePath, targetProjectPath, projectName, password, encoding, fieldMappings } = value
  if (typeof qesFilePath !== 'string' || qesFilePath.trim().length === 0) {
    throw new Error('INVALID_QES_FILE_PATH')
  }
  if (recFilePath !== undefined && (typeof recFilePath !== 'string' || recFilePath.trim().length === 0)) {
    throw new Error('INVALID_REC_FILE_PATH')
  }
  if (typeof targetProjectPath !== 'string' || targetProjectPath.trim().length === 0) {
    throw new Error('INVALID_TARGET_PROJECT_PATH')
  }
  if (typeof projectName !== 'string' || !isSafeProjectName(projectName.trim())) {
    throw new Error('INVALID_PROJECT_NAME')
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('INVALID_PROJECT_PASSWORD')
  }
  const parsedEncoding = parseEncoding(encoding)
  let parsedMappings: Record<string, QuestionType> | undefined
  if (fieldMappings !== undefined) {
    if (!isPlainObject(fieldMappings)) throw new Error('INVALID_FIELD_MAPPINGS')
    parsedMappings = {}
    for (const [fieldName, questionType] of Object.entries(fieldMappings)) {
      if (fieldName.trim().length === 0 || typeof questionType !== 'string' || !isQuestionType(questionType)) {
        throw new Error('INVALID_FIELD_MAPPINGS')
      }
      parsedMappings[fieldName] = questionType
    }
  }
  return {
    qesFilePath: qesFilePath.trim(),
    recFilePath: typeof recFilePath === 'string' ? recFilePath.trim() : undefined,
    targetProjectPath: targetProjectPath.trim(),
    projectName: projectName.trim(),
    password,
    encoding: parsedEncoding,
    fieldMappings: parsedMappings
  }
}

export function parseEpiDataPreviewRequest(value: unknown): EpiDataPreviewRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_EPIDATA_PREVIEW_REQUEST')
  const { qesFilePath, encoding } = value
  if (typeof qesFilePath !== 'string' || qesFilePath.trim().length === 0) {
    throw new Error('INVALID_QES_FILE_PATH')
  }
  return { qesFilePath: qesFilePath.trim(), encoding: parseEncoding(encoding) }
}

function parseEncoding(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !['auto', 'utf-8', 'gbk', 'latin1'].includes(value)) {
    throw new Error('INVALID_EPIDATA_ENCODING')
  }
  return value
}

function isSafeProjectName(name: string): boolean {
  if (name.length === 0 || name.length > 100 || name === '.' || name === '..') return false
  if (/[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) return false
  if ([...name].some((character) => character.charCodeAt(0) < 32)) return false
  return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
}

export function parseEpiDataValidateRequest(value: unknown): EpiDataValidateRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_EPIDATA_VALIDATE_REQUEST')
  const { qesFilePath } = value
  if (typeof qesFilePath !== 'string') throw new Error('INVALID_QES_FILE_PATH')
  return { qesFilePath }
}
