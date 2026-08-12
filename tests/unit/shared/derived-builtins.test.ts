import { describe, expect, it } from 'vitest'

import {
  BUILTIN_FUNCTIONS,
  BUILTIN_FUNCTION_NAMES,
  callBuiltin,
  getBuiltinArity,
  isBuiltinFunctionName
} from '@shared/derived/builtins'

describe('BUILTIN_FUNCTIONS registry', () => {
  it('exposes every documented function with arity bounds', () => {
    for (const name of ['IF', 'ROUND', 'ABS', 'SQRT', 'LOG', 'LN', 'EXP', 'POW', 'DATE_DIFF', 'YEAR', 'MONTH', 'TODAY', 'CONCAT', 'SUBSTR', 'MEAN', 'SUM']) {
      expect(BUILTIN_FUNCTIONS[name]).toBeDefined()
      expect(getBuiltinArity(name)).not.toBeNull()
    }
    expect(isBuiltinFunctionName('IF')).toBe(true)
    expect(isBuiltinFunctionName('EVAL')).toBe(false)
    expect(getBuiltinArity('NOPE')).toBeNull()
    expect(callBuiltin('NOPE', [1])).toBeNull()
    expect(BUILTIN_FUNCTION_NAMES.has('ROUND')).toBe(true)
  })
})

describe('numeric builtins return null for non-finite inputs', () => {
  it('ROUND guards non-integer decimals and non-finite values', () => {
    expect(callBuiltin('ROUND', [2.5, 0.5])).toBeNull()
    expect(callBuiltin('ROUND', [Number.NaN, 1])).toBeNull()
    expect(callBuiltin('ABS', [null])).toBeNull()
    expect(callBuiltin('SQRT', ['x'])).toBeNull()
    expect(callBuiltin('LOG', [-5])).toBeNull()
    expect(callBuiltin('LN', [0])).toBeNull()
    expect(callBuiltin('EXP', [Number.NaN])).toBeNull()
    expect(callBuiltin('POW', ['a', 2])).toBeNull()
  })

  it('MEAN and SUM return null when every value is missing', () => {
    expect(callBuiltin('MEAN', [null, null])).toBeNull()
    expect(callBuiltin('SUM', ['x', null])).toBeNull()
  })
})

describe('date builtins handle invalid input', () => {
  it('DATE_DIFF returns null for unparsable dates or units', () => {
    expect(callBuiltin('DATE_DIFF', ['not-a-date', '2026-01-01', 'year'])).toBeNull()
    expect(callBuiltin('DATE_DIFF', ['2026-01-01', '2026-01-01', 'fortnight'])).toBeNull()
    expect(callBuiltin('DATE_DIFF', [null, null, 'year'])).toBeNull()
    expect(callBuiltin('DATE_DIFF', ['2026-13-40', '2026-01-01', 'year'])).toBeNull()
    expect(callBuiltin('DATE_DIFF', ['2026-02-30', '2026-01-01', 'day'])).toBeNull()
  })

  it('YEAR and MONTH return null for invalid dates', () => {
    expect(callBuiltin('YEAR', ['bad'])).toBeNull()
    expect(callBuiltin('MONTH', [null])).toBeNull()
    expect(callBuiltin('YEAR', ['2026-02-30'])).toBeNull()
  })
})

describe('string builtins', () => {
  it('CONCAT joins args and treats missing as empty', () => {
    expect(callBuiltin('CONCAT', ['a', null, 'c'])).toBe('ac')
    expect(callBuiltin('CONCAT', [])).toBe('')
  })

  it('SUBSTR handles edge indexes', () => {
    expect(callBuiltin('SUBSTR', ['hello', 'x'])).toBeNull()
    expect(callBuiltin('SUBSTR', ['hello', 1, 'nope'])).toBeNull()
    expect(callBuiltin('SUBSTR', ['hello', 1, -1])).toBeNull()
    expect(callBuiltin('SUBSTR', ['hello', 100])).toBe('')
    expect(callBuiltin('SUBSTR', ['hello', 4])).toBe('lo')
    expect(callBuiltin('SUBSTR', ['hello', 2])).toBe('ello')
  })
})

describe('IF', () => {
  it('selects branches by truthiness', () => {
    expect(callBuiltin('IF', [true, 'a', 'b'])).toBe('a')
    expect(callBuiltin('IF', [false, 'a', 'b'])).toBe('b')
    expect(callBuiltin('IF', [0, 'a', 'b'])).toBe('b')
    expect(callBuiltin('IF', [null, 'a', 'b'])).toBe('b')
  })
})
