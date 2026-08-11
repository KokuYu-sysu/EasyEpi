export type ValueType = 'number' | 'string' | 'boolean' | 'date'

export type BinaryOperator = '+' | '-' | '*' | '/' | '^'

export type ComparisonOperator = '==' | '!=' | '>' | '<' | '>=' | '<='

export type AstNode =
  | { type: 'literal'; value: number | string; valueType: 'number' | 'string' }
  | { type: 'variable'; name: string }
  | { type: 'binary'; op: BinaryOperator; left: AstNode; right: AstNode }
  | { type: 'unary'; op: '-' | '+'; operand: AstNode }
  | { type: 'compare'; op: ComparisonOperator; left: AstNode; right: AstNode }
  | { type: 'call'; name: string; args: AstNode[] }

export interface FormulaError {
  code: string
  message: string
  position?: number
}

export type ParseResult = { ok: true; ast: AstNode } | { ok: false; errors: FormulaError[] }

export type Primitive = number | string | boolean

export interface Value {
  type: ValueType
  value: number | string | boolean | null
}

export const MISSING: Value = { type: 'number', value: null }
