import { describe, expect, it } from 'vitest'

import { parseFormula } from '@shared/derived/parser'
import { evaluate, inferResultType } from '@shared/derived/evaluator'

function evalFormula(formula: string, context: Record<string, unknown> = {}) {
  const result = parseFormula(formula)
  if (!result.ok) throw new Error(`parse failed: ${JSON.stringify(result.errors)}`)
  return evaluate(result.ast, context)
}

function value(formula: string, context: Record<string, unknown> = {}) {
  return evalFormula(formula, context).value
}

describe('evaluate arithmetic', () => {
  it('computes precedence correctly', () => {
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('(1 + 2) * 3')).toBe(9)
    expect(value('2 ^ 3 ^ 2')).toBe(512)
    expect(value('-2 ^ 2')).toBe(-4)
    expect(value('2 ^ -3')).toBe(0.125)
    expect(value('10 / 4')).toBe(2.5)
  })

  it('supports decimals and unary plus', () => {
    expect(value('.5 + 1.25')).toBe(1.75)
    expect(value('+5 - 2')).toBe(3)
  })

  it('returns null for division by zero and non-finite results', () => {
    expect(value('1 / 0')).toBe(null)
    expect(value('SQRT(-1)')).toBe(null)
    expect(value('0 / 0')).toBe(null)
  })

  it('propagates null for missing variables', () => {
    expect(value('{height} * 2')).toBe(null)
  })
})

describe('evaluate comparisons and strings', () => {
  it('evaluates numeric comparisons', () => {
    expect(value('{age} >= 60', { age: '70' })).toBe(true)
    expect(value('{age} >= 60', { age: '50' })).toBe(false)
    expect(value('1 < 2')).toBe(true)
    expect(value('2 > 1')).toBe(true)
    expect(value('2 <= 2')).toBe(true)
    expect(value('3 <= 2')).toBe(false)
  })

  it('evaluates numeric inequality and non-numeric equality fallbacks', () => {
    expect(value('{a} != 5', { a: '7' })).toBe(true)
    expect(value('{a} == 5', { a: 5 })).toBe(true)
    expect(value('{a} > {b}', { a: '3', b: '1' })).toBe(true)
  })

  it('evaluates string equality', () => {
    expect(value('{sex} == "男"', { sex: '男' })).toBe(true)
    expect(value('{sex} != "女"', { sex: '男' })).toBe(true)
  })

  it('returns null for comparison with missing operand and non-finite ordering', () => {
    expect(value('{age} >= 60')).toBe(null)
    expect(value('{a} > {b}', { a: 'x', b: 'y' })).toBe(null)
  })

  it('supports unary plus and negation of negatives', () => {
    expect(value('+3 - 1')).toBe(2)
    expect(value('-(-4)')).toBe(4)
  })
})

describe('evaluate functions', () => {
  it('IF is lazy: missing variable in unselected branch does not null the result', () => {
    expect(value('IF(1 > 0, "a", {missing})')).toBe('a')
    expect(value('IF(0 > 1, {missing}, "b")')).toBe('b')
  })

  it('IF with missing condition falls back to false branch', () => {
    expect(value('IF({age} >= 60, "老年", "成年")', {})).toBe('成年')
  })

  it('nested IF', () => {
    expect(value('IF({age} >= 60, "老年", IF({age} >= 18, "成年", "未成年"))', { age: '30' })).toBe(
      '成年'
    )
    expect(value('IF({age} >= 60, "老年", IF({age} >= 18, "成年", "未成年"))', { age: '70' })).toBe(
      '老年'
    )
    expect(
      value('IF({age} >= 60, "老年", IF({age} >= 18, "成年", "未成年"))', { age: '10' })
    ).toBe('未成年')
  })

  it('ROUND / ABS / POW', () => {
    expect(value('ROUND(24.256, 1)')).toBe(24.3)
    expect(value('ABS(-5)')).toBe(5)
    expect(value('POW(2, 10)')).toBe(1024)
  })

  it('CONCAT and SUBSTR', () => {
    expect(value('CONCAT({study_id}, "-", {visit})', { study_id: 'A', visit: '3' })).toBe('A-3')
    expect(value('SUBSTR("hello", 2, 3)')).toBe('ell')
    expect(value('SUBSTR("hello", -2)')).toBe('lo')
  })

  it('MEAN skips missing values', () => {
    expect(value('MEAN({a}, {b}, {c})', { a: '1', c: '3' })).toBe(2)
    expect(value('MEAN({a}, {b})', {})).toBe(null)
  })

  it('DATE_DIFF computes year difference', () => {
    expect(value('DATE_DIFF("2026-08-11", "1990-01-15", "year")')).toBe(36)
    expect(value('DATE_DIFF("1990-01-15", "2026-08-11", "year")')).toBe(36)
    expect(value('DATE_DIFF("2026-08-11", "2026-08-10", "day")')).toBe(1)
    expect(value('DATE_DIFF("2026-08-10", "2026-08-11", "day")')).toBe(1)
  })

  it('YEAR and MONTH extract parts', () => {
    expect(value('YEAR("2026-08-11")')).toBe(2026)
    expect(value('MONTH("2026-08-11")')).toBe(8)
  })

  it('TODAY returns a YYYY-MM-DD string', () => {
    const today = value('TODAY()')
    expect(typeof today).toBe('string')
    expect(/^\d{4}-\d{2}-\d{2}$/.test(String(today))).toBe(true)
  })
})

describe('inferResultType', () => {
  const context: Record<string, 'numeric' | 'categorical' | 'date'> = {
    weight: 'numeric',
    height: 'numeric',
    age: 'numeric',
    birth: 'date',
    sex: 'categorical'
  }

  it('infers numeric for arithmetic', () => {
    expect(inferResultType(parseOk('{weight} / ({height}/100)^2'), context)).toBe('numeric')
  })

  it('infers categorical for comparisons and strings', () => {
    expect(inferResultType(parseOk('{age} >= 60'), context)).toBe('categorical')
    expect(inferResultType(parseOk('CONCAT("a", "b")'), context)).toBe('categorical')
  })

  it('infers date for TODAY and date variables', () => {
    expect(inferResultType(parseOk('TODAY()'), context)).toBe('date')
    expect(inferResultType(parseOk('{birth}'), context)).toBe('date')
  })

  it('infers IF branch merge', () => {
    expect(inferResultType(parseOk('IF({age} >= 60, "老年", "成年")'), context)).toBe('categorical')
    expect(inferResultType(parseOk('IF({age} >= 18, 1, 0)'), context)).toBe('numeric')
    expect(inferResultType(parseOk('IF({age} >= 18, 1, "no")'), context)).toBe('categorical')
  })

  it('maps variable to declared type', () => {
    expect(inferResultType(parseOk('{age}'), context)).toBe('numeric')
    expect(inferResultType(parseOk('{sex}'), context)).toBe('categorical')
  })
})

function parseOk(input: string) {
  const result = parseFormula(input)
  if (!result.ok) throw new Error(`parse failed: ${JSON.stringify(result.errors)}`)
  return result.ast
}
