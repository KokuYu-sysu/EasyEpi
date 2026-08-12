import type { Primitive } from './ast'

export type BuiltinArg = number | string | boolean | null

export type BuiltinFn = (...args: BuiltinArg[]) => BuiltinArg

export interface BuiltinFunction {
  arity: [number, number]
  fn: BuiltinFn
}

function toNumber(value: BuiltinArg): number {
  if (value === null || value === undefined) return Number.NaN
  if (typeof value === 'number') return value
  return Number(value)
}

function isMissing(value: BuiltinArg): boolean {
  return value === null || value === undefined || value === ''
}

function numericResult(value: number): BuiltinArg {
  return Number.isFinite(value) ? value : null
}

interface DateParts {
  year: number
  month: number
  day: number
}

function parseDate(value: BuiltinArg): DateParts | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null
  const normalized = new Date(Date.UTC(year, month - 1, day))
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) return null
  return { year, month, day }
}

function todayString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateDiff(d1: DateParts, d2: DateParts, unit: 'year' | 'month' | 'day'): number {
  const firstTime = Date.UTC(d1.year, d1.month - 1, d1.day)
  const secondTime = Date.UTC(d2.year, d2.month - 1, d2.day)
  const [earlier, later] = firstTime <= secondTime ? [d1, d2] : [d2, d1]
  if (unit === 'day') {
    return Math.round(Math.abs(firstTime - secondTime) / 86_400_000)
  }
  if (unit === 'month') {
    return (later.year - earlier.year) * 12 + (later.month - earlier.month)
  }
  let years = later.year - earlier.year
  if (later.month < earlier.month || (later.month === earlier.month && later.day < earlier.day)) {
    years -= 1
  }
  return years
}

export const BUILTIN_FUNCTIONS: Record<string, BuiltinFunction> = {
  IF: {
    arity: [3, 3],
    fn: (cond, whenTrue, whenFalse) => (isMissing(cond) ? whenFalse : cond ? whenTrue : whenFalse)
  },
  ROUND: {
    arity: [2, 2],
    fn: (x, decimals) => {
      const value = toNumber(x)
      const places = toNumber(decimals)
      if (!Number.isFinite(value) || !Number.isFinite(places) || !Number.isInteger(places)) return null
      const factor = 10 ** places
      return numericResult(Math.round(value * factor) / factor)
    }
  },
  ABS: {
    arity: [1, 1],
    fn: (x) => numericResult(Math.abs(toNumber(x)))
  },
  SQRT: {
    arity: [1, 1],
    fn: (x) => numericResult(Math.sqrt(toNumber(x)))
  },
  LOG: {
    arity: [1, 1],
    fn: (x) => numericResult(Math.log10(toNumber(x)))
  },
  LN: {
    arity: [1, 1],
    fn: (x) => numericResult(Math.log(toNumber(x)))
  },
  EXP: {
    arity: [1, 1],
    fn: (x) => numericResult(Math.exp(toNumber(x)))
  },
  POW: {
    arity: [2, 2],
    fn: (x, n) => numericResult(Math.pow(toNumber(x), toNumber(n)))
  },
  DATE_DIFF: {
    arity: [3, 3],
    fn: (d1, d2, unit) => {
      const first = typeof d1 === 'string' && d1.trim().toUpperCase() === 'TODAY()' ? parseDate(todayString()) : parseDate(d1)
      const second = typeof d2 === 'string' && d2.trim().toUpperCase() === 'TODAY()' ? parseDate(todayString()) : parseDate(d2)
      if (!first || !second) return null
      const unitName = String(unit).toLowerCase()
      if (unitName !== 'year' && unitName !== 'month' && unitName !== 'day') return null
      return dateDiff(first, second, unitName)
    }
  },
  YEAR: {
    arity: [1, 1],
    fn: (d) => {
      const parts = parseDate(d)
      return parts ? parts.year : null
    }
  },
  MONTH: {
    arity: [1, 1],
    fn: (d) => {
      const parts = parseDate(d)
      return parts ? parts.month : null
    }
  },
  TODAY: {
    arity: [0, 0],
    fn: () => todayString()
  },
  CONCAT: {
    arity: [0, Infinity],
    fn: (...args) =>
      args
        .map((arg) => (isMissing(arg) ? '' : typeof arg === 'boolean' ? String(arg) : arg))
        .join('')
  },
  SUBSTR: {
    arity: [2, 3],
    fn: (s, start, len) => {
      const text = isMissing(s) ? '' : String(s)
      const startNum = toNumber(start)
      if (!Number.isFinite(startNum)) return null
      const absoluteStart = startNum < 0 ? text.length + startNum : startNum - 1
      if (len === undefined || isMissing(len)) {
        return absoluteStart < 0 ? '' : text.substring(absoluteStart)
      }
      const lenNum = toNumber(len)
      if (!Number.isFinite(lenNum) || lenNum < 0) return null
      return absoluteStart < 0 ? '' : text.substring(absoluteStart, absoluteStart + lenNum)
    }
  },
  MEAN: {
    arity: [1, Infinity],
    fn: (...args) => {
      const values = args.map(toNumber).filter((value) => Number.isFinite(value))
      if (values.length === 0) return null
      return numericResult(values.reduce((sum, value) => sum + value, 0) / values.length)
    }
  },
  SUM: {
    arity: [1, Infinity],
    fn: (...args) => {
      const values = args.map(toNumber).filter((value) => Number.isFinite(value))
      if (values.length === 0) return null
      return numericResult(values.reduce((sum, value) => sum + value, 0))
    }
  }
}

export const BUILTIN_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  Object.keys(BUILTIN_FUNCTIONS)
)

export function isBuiltinFunctionName(name: string): boolean {
  return BUILTIN_FUNCTION_NAMES.has(name)
}

export function getBuiltinArity(name: string): [number, number] | null {
  const builtin = BUILTIN_FUNCTIONS[name]
  return builtin ? builtin.arity : null
}

export function callBuiltin(name: string, args: BuiltinArg[]): Primitive | null {
  const builtin = BUILTIN_FUNCTIONS[name]
  if (!builtin) return null
  return builtin.fn(...args)
}
