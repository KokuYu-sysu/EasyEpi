import type { FormulaError } from './derived'
import {
  DERIVED_VARIABLE_NAME_PATTERN,
  isDerivedResultType,
  type DerivedResultType,
  type DerivedVariableDef
} from './types/derived'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const DERIVED_GET_ALL_CHANNEL = 'derived:getAll' as const
export const DERIVED_VALIDATE_CHANNEL = 'derived:validate' as const
export const DERIVED_PREVIEW_CHANNEL = 'derived:preview' as const
export const DERIVED_ADD_CHANNEL = 'derived:add' as const
export const DERIVED_UPDATE_CHANNEL = 'derived:update' as const
export const DERIVED_DELETE_CHANNEL = 'derived:delete' as const
export const DERIVED_REORDER_CHANNEL = 'derived:reorder' as const

export const ALL_DERIVED_CHANNELS = [
  DERIVED_GET_ALL_CHANNEL,
  DERIVED_VALIDATE_CHANNEL,
  DERIVED_PREVIEW_CHANNEL,
  DERIVED_ADD_CHANNEL,
  DERIVED_UPDATE_CHANNEL,
  DERIVED_DELETE_CHANNEL,
  DERIVED_REORDER_CHANNEL
] as const

export type DerivedChannel = (typeof ALL_DERIVED_CHANNELS)[number]

export interface DerivedListResult {
  ok: boolean
  derivedVariables: DerivedVariableDef[]
}

export interface DerivedCrudResult {
  ok: boolean
  errors?: FormulaError[]
  derivedVariables?: DerivedVariableDef[]
}

export interface DerivedValidateRequest {
  formula: string
}

export interface DerivedValidateResult {
  ok: boolean
  errors?: FormulaError[]
  inferredType?: DerivedResultType
}

export interface DerivedPreviewRequest {
  formula: string
  sampleAnswers: Record<string, unknown>
}

export interface DerivedPreviewResult {
  ok: boolean
  value?: string | null
  type?: DerivedResultType
  error?: string
}

export type DerivedDraft = Omit<DerivedVariableDef, 'id' | 'order'>

export interface DerivedAddRequest {
  variable: DerivedDraft
}

export interface DerivedUpdateRequest {
  id: string
  patch: Partial<DerivedDraft>
}

export interface DerivedDeleteRequest {
  id: string
}

export interface DerivedReorderRequest {
  ids: string[]
}

function parseVariableName(value: unknown): string {
  if (typeof value !== 'string' || !DERIVED_VARIABLE_NAME_PATTERN.test(value)) {
    throw new Error('INVALID_DERIVED_VARIABLE_NAME')
  }
  return value
}

function parseFormula(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('INVALID_DERIVED_FORMULA')
  }
  return value
}

export function parseDerivedValidateRequest(value: unknown): DerivedValidateRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DERIVED_VALIDATE_REQUEST')
  return { formula: parseFormula(value['formula']) }
}

export function parseDerivedPreviewRequest(value: unknown): DerivedPreviewRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DERIVED_PREVIEW_REQUEST')
  const formula = parseFormula(value['formula'])
  const sampleAnswers = value['sampleAnswers']
  if (!isPlainObject(sampleAnswers)) throw new Error('INVALID_DERIVED_SAMPLE')
  return { formula, sampleAnswers }
}

export function parseDerivedAddRequest(value: unknown): DerivedAddRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DERIVED_ADD_REQUEST')
  const variable = value['variable']
  if (!isPlainObject(variable)) throw new Error('INVALID_DERIVED_VARIABLE')
  const variableName = parseVariableName(variable['variableName'])
  const label = variable['label']
  const formula = parseFormula(variable['formula'])
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error('INVALID_DERIVED_LABEL')
  }
  if (!isDerivedResultType(variable['resultType'])) {
    throw new Error('INVALID_DERIVED_RESULT_TYPE')
  }
  const displayDecimals = variable['displayDecimals']
  if (
    displayDecimals !== undefined &&
    (typeof displayDecimals !== 'number' ||
      !Number.isInteger(displayDecimals) ||
      displayDecimals < 0 ||
      displayDecimals > 6)
  ) {
    throw new Error('INVALID_DERIVED_DECIMALS')
  }
  return {
    variable: {
      variableName,
      label: label.trim(),
      formula: formula.trim(),
      resultType: variable['resultType'] as DerivedResultType,
      ...(displayDecimals === undefined ? {} : { displayDecimals: displayDecimals as number })
    }
  }
}

export function parseDerivedUpdateRequest(value: unknown): DerivedUpdateRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DERIVED_UPDATE_REQUEST')
  const id = value['id']
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('INVALID_DERIVED_ID')
  const patch = value['patch']
  if (!isPlainObject(patch)) throw new Error('INVALID_DERIVED_PATCH')

  const result: Partial<DerivedDraft> = {}
  if (patch['variableName'] !== undefined) {
    result.variableName = parseVariableName(patch['variableName'])
  }
  if (patch['label'] !== undefined) {
    if (typeof patch['label'] !== 'string' || (patch['label'] as string).trim().length === 0) {
      throw new Error('INVALID_DERIVED_LABEL')
    }
    result.label = (patch['label'] as string).trim()
  }
  if (patch['formula'] !== undefined) {
    result.formula = parseFormula(patch['formula'])
  }
  if (patch['resultType'] !== undefined) {
    if (!isDerivedResultType(patch['resultType'])) throw new Error('INVALID_DERIVED_RESULT_TYPE')
    result.resultType = patch['resultType'] as DerivedResultType
  }
  if (patch['displayDecimals'] !== undefined) {
    const decimals = patch['displayDecimals']
    if (
      decimals !== null &&
      (typeof decimals !== 'number' ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 6)
    ) {
      throw new Error('INVALID_DERIVED_DECIMALS')
    }
    if (decimals === null) {
      result.displayDecimals = undefined
    } else {
      result.displayDecimals = decimals as number
    }
  }
  return { id: id.trim(), patch: result }
}

export function parseDerivedDeleteRequest(value: unknown): DerivedDeleteRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DERIVED_DELETE_REQUEST')
  const id = value['id']
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('INVALID_DERIVED_ID')
  return { id: id.trim() }
}

export function parseDerivedReorderRequest(value: unknown): DerivedReorderRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_DERIVED_REORDER_REQUEST')
  const ids = value['ids']
  if (!Array.isArray(ids) || !ids.every((item) => typeof item === 'string')) {
    throw new Error('INVALID_DERIVED_IDS')
  }
  const normalized = ids.map((item) => (item as string).trim())
  if (new Set(normalized).size !== normalized.length) throw new Error('INVALID_DERIVED_IDS')
  return { ids: normalized }
}
