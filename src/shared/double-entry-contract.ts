import type { DoubleEntryComparison } from './types/double-entry'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const DOUBLE_ENTRY_IMPORT_CHANNEL = 'doubleEntry:import' as const
export const DOUBLE_ENTRY_COMPARE_CHANNEL = 'doubleEntry:compare' as const

export const ALL_DOUBLE_ENTRY_CHANNELS = [
  DOUBLE_ENTRY_IMPORT_CHANNEL,
  DOUBLE_ENTRY_COMPARE_CHANNEL
] as const

export type DoubleEntryChannel = (typeof ALL_DOUBLE_ENTRY_CHANNELS)[number]

export interface DoubleEntryImportRequest {
  filePath: string
  encoding?: string
}

export interface DoubleEntryImportResult {
  ok: boolean
  rowCount?: number
  headers?: string[]
  encoding?: string
  error?: string
}

export interface DoubleEntryCompareRequest {
  secondaryFilePath: string
  encoding?: string
}

export interface DoubleEntryCompareResult {
  ok: boolean
  comparison?: DoubleEntryComparison
  error?: string
}

function parseFilePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('INVALID_DOUBLE_ENTRY_FILE')
  }
  return value.trim()
}

function parseOptionalEncoding(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('INVALID_DOUBLE_ENTRY_ENCODING')
  const normalized = value.toLowerCase()
  if (normalized !== 'auto' && normalized !== 'utf-8' && normalized !== 'utf8' &&
      normalized !== 'gbk' && normalized !== 'windows-1252' && normalized !== 'latin1') {
    throw new Error('INVALID_DOUBLE_ENTRY_ENCODING')
  }
  return normalized
}

export function parseDoubleEntryImportRequest(value: unknown): DoubleEntryImportRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DOUBLE_ENTRY_IMPORT_REQUEST')
  const filePath = parseFilePath(value['filePath'])
  return { filePath, ...(parseOptionalEncoding(value['encoding']) === undefined ? {} : { encoding: parseOptionalEncoding(value['encoding']) }) }
}

export function parseDoubleEntryCompareRequest(value: unknown): DoubleEntryCompareRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DOUBLE_ENTRY_COMPARE_REQUEST')
  const secondaryFilePath = parseFilePath(value['secondaryFilePath'])
  return {
    secondaryFilePath,
    ...(parseOptionalEncoding(value['encoding']) === undefined ? {} : { encoding: parseOptionalEncoding(value['encoding']) })
  }
}
