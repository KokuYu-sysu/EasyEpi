export const BASELINE_GENERATE_CHANNEL = 'baseline:generate' as const
export const BASELINE_EXPORT_CHANNEL = 'baseline:export' as const

export const ALL_BASELINE_CHANNELS = [BASELINE_GENERATE_CHANNEL, BASELINE_EXPORT_CHANNEL] as const

export type BaselineStatisticalMethod = 'auto' | 'manual'
export type BaselineContinuousTest = 'welch_t' | 'none'
export type BaselineCategoricalTest = 'chi_square' | 'none'

export interface BaselineGenerateRequest {
  selectedQuestionIds?: string[]
  groupQuestionId?: string
  statisticalMethod?: BaselineStatisticalMethod
  continuousTest?: BaselineContinuousTest
  categoricalTest?: BaselineCategoricalTest
}

export interface BaselineExportRequest extends BaselineGenerateRequest {
  outputPath: string
}

export interface BaselineHeader {
  key: string
  label: string
}

export interface BaselineRow {
  variable: string
  label: string
  total: string
  groups?: Record<string, string>
  pValue?: number
  testUsed?: string
}

export interface BaselineTable {
  headers: BaselineHeader[]
  rows: BaselineRow[]
}

export interface BaselineExportResult {
  success: boolean
  outputPath?: string
  rowCount?: number
  error?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function parseSelection(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  errorCode: string
): BaselineGenerateRequest {
  if (!Object.keys(value).every((key) => allowedKeys.includes(key))) throw new Error(errorCode)
  const {
    selectedQuestionIds,
    groupQuestionId,
    statisticalMethod,
    continuousTest,
    categoricalTest
  } = value
  const parsed: BaselineGenerateRequest = {}
  if (selectedQuestionIds !== undefined) {
    if (
      !Array.isArray(selectedQuestionIds) ||
      selectedQuestionIds.length === 0 ||
      !selectedQuestionIds.every((id) => typeof id === 'string' && id.trim().length > 0)
    ) {
      throw new Error(errorCode)
    }
    const normalized = selectedQuestionIds.map((id) => id.trim())
    if (new Set(normalized).size !== normalized.length) throw new Error(errorCode)
    parsed.selectedQuestionIds = normalized
  }
  if (groupQuestionId !== undefined) {
    if (typeof groupQuestionId !== 'string' || groupQuestionId.trim().length === 0) {
      throw new Error(errorCode)
    }
    parsed.groupQuestionId = groupQuestionId.trim()
  }
  if (statisticalMethod !== undefined && statisticalMethod !== 'auto' && statisticalMethod !== 'manual') {
    throw new Error(errorCode)
  }
  if (continuousTest !== undefined && continuousTest !== 'welch_t' && continuousTest !== 'none') {
    throw new Error(errorCode)
  }
  if (categoricalTest !== undefined && categoricalTest !== 'chi_square' && categoricalTest !== 'none') {
    throw new Error(errorCode)
  }
  if (
    statisticalMethod !== 'manual' &&
    (continuousTest !== undefined || categoricalTest !== undefined)
  ) {
    throw new Error(errorCode)
  }
  if (
    statisticalMethod === 'manual' &&
    (continuousTest === undefined || categoricalTest === undefined)
  ) {
    throw new Error(errorCode)
  }
  if (statisticalMethod !== undefined) parsed.statisticalMethod = statisticalMethod
  if (continuousTest !== undefined) parsed.continuousTest = continuousTest
  if (categoricalTest !== undefined) parsed.categoricalTest = categoricalTest
  return parsed
}

export function parseBaselineGenerateRequest(value: unknown): BaselineGenerateRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_BASELINE_REQUEST')
  return parseSelection(
    value,
    ['selectedQuestionIds', 'groupQuestionId', 'statisticalMethod', 'continuousTest', 'categoricalTest'],
    'INVALID_BASELINE_REQUEST'
  )
}

export function parseBaselineExportRequest(value: unknown): BaselineExportRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_BASELINE_EXPORT_REQUEST')
  const parsed = parseSelection(
    value,
    ['outputPath', 'selectedQuestionIds', 'groupQuestionId', 'statisticalMethod', 'continuousTest', 'categoricalTest'],
    'INVALID_BASELINE_EXPORT_REQUEST'
  )
  if (typeof value.outputPath !== 'string' || value.outputPath.trim().length === 0) {
    throw new Error('INVALID_BASELINE_EXPORT_REQUEST')
  }
  return { outputPath: value.outputPath.trim(), ...parsed }
}
