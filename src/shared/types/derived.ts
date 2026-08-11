export type DerivedResultType = 'numeric' | 'categorical' | 'date'

export interface DerivedVariableDef {
  id: string
  variableName: string
  label: string
  formula: string
  resultType: DerivedResultType
  displayDecimals?: number
  order: number
}

export function isDerivedResultType(value: unknown): value is DerivedResultType {
  return value === 'numeric' || value === 'categorical' || value === 'date'
}

export const DERIVED_RESULT_TYPE_LABELS: Record<DerivedResultType, string> = {
  numeric: '数值',
  categorical: '分类',
  date: '日期'
}

export const DERIVED_VARIABLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
