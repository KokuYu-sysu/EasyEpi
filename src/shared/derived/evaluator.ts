import type { AstNode, Value } from './ast'
import { MISSING } from './ast'
import { callBuiltin, type BuiltinArg } from './builtins'

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return Number.NaN
  if (typeof value === 'number') return value
  if (value === '') return Number.NaN
  return Number(value)
}

function numericValue(value: number): Value {
  return Number.isFinite(value) ? { type: 'number', value } : MISSING
}

function unwrap(value: Value): BuiltinArg {
  return value.value
}

function wrapPrimitive(value: BuiltinArg): Value {
  if (value === null || value === undefined) return MISSING
  if (typeof value === 'number') return { type: 'number', value }
  if (typeof value === 'boolean') return { type: 'boolean', value }
  return { type: 'string', value }
}

export function evaluate(ast: AstNode, context: Record<string, unknown>): Value {
  switch (ast.type) {
    case 'literal':
      return ast.valueType === 'number'
        ? { type: 'number', value: ast.value as number }
        : { type: 'string', value: ast.value as string }

    case 'variable': {
      const raw = context[ast.name]
      if (raw === null || raw === undefined || raw === '') return MISSING
      if (typeof raw === 'number' && Number.isFinite(raw)) return { type: 'number', value: raw }
      if (typeof raw === 'boolean') return { type: 'boolean', value: raw }
      return { type: 'string', value: String(raw) }
    }

    case 'binary': {
      const left = evaluate(ast.left, context)
      const right = evaluate(ast.right, context)
      if (left.value === null || right.value === null) return MISSING
      const a = toNumber(left.value)
      const b = toNumber(right.value)
      if (ast.op === '^') return numericValue(Math.pow(a, b))
      switch (ast.op) {
        case '+':
          return numericValue(a + b)
        case '-':
          return numericValue(a - b)
        case '*':
          return numericValue(a * b)
        case '/':
          return b === 0 ? MISSING : numericValue(a / b)
      }
      return MISSING
    }

    case 'unary': {
      const operand = evaluate(ast.operand, context)
      if (operand.value === null) return MISSING
      const value = toNumber(operand.value)
      return ast.op === '-' ? numericValue(-value) : numericValue(value)
    }

    case 'compare': {
      const left = evaluate(ast.left, context)
      const right = evaluate(ast.right, context)
      if (left.value === null || right.value === null) return MISSING
      if (ast.op === '==' || ast.op === '!=') {
        const a = String(left.value)
        const b = String(right.value)
        const equal = a === b
        return { type: 'boolean', value: ast.op === '==' ? equal : !equal }
      }
      const a = toNumber(left.value)
      const b = toNumber(right.value)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return MISSING
      let result: boolean
      switch (ast.op) {
        case '>':
          result = a > b
          break
        case '<':
          result = a < b
          break
        case '>=':
          result = a >= b
          break
        case '<=':
          result = a <= b
          break
        default:
          return MISSING
      }
      return { type: 'boolean', value: result }
    }

    case 'call': {
      const name = ast.name
      if (name === 'IF') {
        const condition = evaluate(ast.args[0]!, context)
        const branch = condition.value !== null && Boolean(condition.value)
          ? ast.args[1]!
          : ast.args[2]!
        return evaluate(branch, context)
      }
      if (name === 'MEAN' || name === 'SUM') {
        const args = ast.args
          .map((arg) => evaluate(arg, context))
          .map(unwrap)
          .filter((value) => value !== null && value !== undefined)
        return wrapPrimitive(callBuiltin(name, args as BuiltinArg[]) ?? null)
      }
      const args = ast.args.map((arg) => unwrap(evaluate(arg, context)))
      return wrapPrimitive(callBuiltin(name, args as BuiltinArg[]) ?? null)
    }

    default:
      return MISSING
  }
}

export type DerivedResultType = 'numeric' | 'categorical' | 'date'

function mergeTypes(a: DerivedResultType, b: DerivedResultType): DerivedResultType {
  return a === b ? a : 'categorical'
}

export function inferResultType(
  ast: AstNode,
  variableTypes: Record<string, DerivedResultType>
): DerivedResultType {
  switch (ast.type) {
    case 'literal':
      return ast.valueType === 'number' ? 'numeric' : 'categorical'
    case 'variable':
      return variableTypes[ast.name] ?? 'categorical'
    case 'binary':
    case 'unary':
      return 'numeric'
    case 'compare':
      return 'categorical'
    case 'call': {
      switch (ast.name) {
        case 'IF':
          return mergeTypes(
            inferResultType(ast.args[1]!, variableTypes),
            inferResultType(ast.args[2]!, variableTypes)
          )
        case 'CONCAT':
        case 'SUBSTR':
          return 'categorical'
        case 'TODAY':
          return 'date'
        case 'DATE_DIFF':
        case 'YEAR':
        case 'MONTH':
        case 'ROUND':
        case 'ABS':
        case 'SQRT':
        case 'LOG':
        case 'LN':
        case 'EXP':
        case 'POW':
        case 'MEAN':
        case 'SUM':
          return 'numeric'
        default:
          return 'categorical'
      }
    }
    default:
      return 'categorical'
  }
}
