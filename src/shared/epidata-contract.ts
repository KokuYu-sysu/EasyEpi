import type { ImportPreview, ImportResult } from './types/epidata'

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
  targetProjectPath: string
  encoding?: string
}

export interface EpiDataPreviewRequest {
  qesFilePath: string
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
  const { qesFilePath, targetProjectPath, encoding } = value
  if (typeof qesFilePath !== 'string') throw new Error('INVALID_QES_FILE_PATH')
  if (typeof targetProjectPath !== 'string') throw new Error('INVALID_TARGET_PROJECT_PATH')
  return { qesFilePath, targetProjectPath, encoding: typeof encoding === 'string' ? encoding : undefined }
}

export function parseEpiDataPreviewRequest(value: unknown): EpiDataPreviewRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_EPIDATA_PREVIEW_REQUEST')
  const { qesFilePath } = value
  if (typeof qesFilePath !== 'string') throw new Error('INVALID_QES_FILE_PATH')
  return { qesFilePath }
}

export function parseEpiDataValidateRequest(value: unknown): EpiDataValidateRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_EPIDATA_VALIDATE_REQUEST')
  const { qesFilePath } = value
  if (typeof qesFilePath !== 'string') throw new Error('INVALID_QES_FILE_PATH')
  return { qesFilePath }
}