export const EXPORT_CSV_CHANNEL = 'export:csv' as const

export const ALL_EXPORT_CHANNELS = [EXPORT_CSV_CHANNEL] as const

export type ExportEncoding = 'multi_category' | 'one_hot' | 'dummy'
export type ExportScope = 'all' | 'selected'
export type DummyReference = 'first' | 'last'
export type ExportFileEncoding = 'utf8_bom' | 'gbk'

export interface ExportCsvRequest {
  outputPath: string
  encoding: ExportEncoding
  fileEncoding?: ExportFileEncoding
  dummyReference?: DummyReference
  scope: ExportScope
  selectedIds?: string[]
}

export interface ExportCsvResult {
  success: boolean
  csvPath?: string
  dictionaryPath?: string
  recordCount?: number
  columnCount?: number
  error?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

export function parseExportCsvRequest(value: unknown): ExportCsvRequest {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ['outputPath', 'encoding', 'fileEncoding', 'dummyReference', 'scope', 'selectedIds'])
  ) {
    throw new Error('INVALID_EXPORT_REQUEST')
  }

  const { outputPath, encoding, fileEncoding, dummyReference, scope, selectedIds } = value
  if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
    throw new Error('INVALID_EXPORT_REQUEST')
  }
  if (encoding !== 'multi_category' && encoding !== 'one_hot' && encoding !== 'dummy') {
    throw new Error('INVALID_EXPORT_REQUEST')
  }
  if (fileEncoding !== undefined && fileEncoding !== 'utf8_bom' && fileEncoding !== 'gbk') {
    throw new Error('INVALID_EXPORT_REQUEST')
  }
  if (scope !== 'all' && scope !== 'selected') throw new Error('INVALID_EXPORT_REQUEST')
  if (dummyReference !== undefined && dummyReference !== 'first' && dummyReference !== 'last') {
    throw new Error('INVALID_EXPORT_REQUEST')
  }

  if (scope === 'all') {
    if (selectedIds !== undefined) throw new Error('INVALID_EXPORT_REQUEST')
    return {
      outputPath: outputPath.trim(),
      encoding,
      ...(fileEncoding === undefined ? {} : { fileEncoding }),
      ...(dummyReference === undefined ? {} : { dummyReference }),
      scope
    }
  }

  if (
    !Array.isArray(selectedIds) ||
    selectedIds.length === 0 ||
    !selectedIds.every((id) => typeof id === 'string' && id.trim().length > 0)
  ) {
    throw new Error('INVALID_EXPORT_REQUEST')
  }
  const normalizedIds = selectedIds.map((id) => id.trim())
  if (new Set(normalizedIds).size !== normalizedIds.length) {
    throw new Error('INVALID_EXPORT_REQUEST')
  }
  return {
    outputPath: outputPath.trim(),
    encoding,
    ...(fileEncoding === undefined ? {} : { fileEncoding }),
    ...(dummyReference === undefined ? {} : { dummyReference }),
    scope,
    selectedIds: normalizedIds
  }
}
