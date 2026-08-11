import { describe, expect, it } from 'vitest'

import { parseFormula, FormulaParseError } from '@shared/derived/parser'
import { tokenize, FormulaSyntaxError } from '@shared/derived/tokenizer'
import { astToFormula } from '@shared/derived/latex'

describe('tokenize', () => {
  it('tokenizes variables, numbers, operators and comparisons', () => {
    const tokens = tokenize('{weight} / ({height} / 100) ^ 2 >= 18.5', new Set(['ABS']))
    expect(tokens.map((t) => t.type)).toEqual([
      'VARIABLE',
      'OPERATOR',
      'LPAREN',
      'VARIABLE',
      'OPERATOR',
      'NUMBER',
      'RPAREN',
      'OPERATOR',
      'NUMBER',
      'COMPARISON',
      'NUMBER',
      'EOF'
    ])
    expect(tokens[0]!.value).toBe('weight')
  })

  it('tokenizes string literals with quotes and escapes', () => {
    const tokens = tokenize('IF({age} >= 60, "老年", \'成年\')', new Set(['IF']))
    expect(tokens.filter((t) => t.type === 'STRING').map((t) => t.value)).toEqual(['老年', '成年'])
  })

  it('throws on unterminated string', () => {
    expect(() => tokenize('CONCAT("abc', new Set(['CONCAT']))).toThrow(FormulaSyntaxError)
  })

  it('throws on empty variable reference', () => {
    expect(() => tokenize('{}', new Set())).toThrow(FormulaSyntaxError)
  })

  it('throws on invalid variable reference patterns', () => {
    expect(() => tokenize('{1bad}', new Set())).toThrow(/变量名 "1bad" 无效/)
    expect(() => tokenize('{a b}', new Set())).toThrow(/变量名 "a b" 无效/)
  })

  it('throws on unterminated variable reference', () => {
    expect(() => tokenize('{age', new Set())).toThrow(FormulaSyntaxError)
  })

  it('throws on unknown bare identifier (not a function)', () => {
    expect(() => tokenize('process + 1', new Set())).toThrow(/未定义函数 "process"/)
  })

  it('throws on illegal characters', () => {
    expect(() => tokenize('1 + @', new Set())).toThrow(/无法识别的字符 "@"/)
  })

  it('accepts negative number syntax via unary minus in parser, decimals in lexer', () => {
    const tokens = tokenize('-.5', new Set())
    expect(tokens.map((t) => t.type)).toEqual(['OPERATOR', 'NUMBER', 'EOF'])
  })
})

describe('parseFormula', () => {
  it('parses arithmetic with correct precedence', () => {
    expect(astToFormula(parseOk('1 + 2 * 3'))).toBe('1 + 2 * 3')
    expect(astToFormula(parseOk('2 ^ 3 ^ 2'))).toBe('2 ^ 3 ^ 2')
  })

  it('parses unary minus before power as -(2^2)', () => {
    const ast = parseOk('-2 ^ 2')
    expect(ast.type).toBe('unary')
  })

  it('parses a function call with multiple args', () => {
    const ast = parseOk('IF({age} >= 60, "老年", "成年")')
    expect(ast.type).toBe('call')
    if (ast.type === 'call') {
      expect(ast.name).toBe('IF')
      expect(ast.args).toHaveLength(3)
    }
  })

  it('rejects unbalanced parens', () => {
    const result = parseFormula('1 + (2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('UNBALANCED_PAREN')
  })

  it('rejects trailing tokens', () => {
    const result = parseFormula('1 + 2 3')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('TRAILING_TOKENS')
  })

  it('rejects an expected expression', () => {
    const result = parseFormula('( )')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('EXPECTED_EXPRESSION')
  })

  it('rejects arg count mismatch', () => {
    const result = parseFormula('ROUND(1)')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('ARG_COUNT_MISMATCH')
  })

  it('rejects invalid function name via syntax error', () => {
    const result = parseFormula('FOO(1)')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('SYNTAX_ERROR')
  })

  it('rejects bare "=" comparison', () => {
    const result = parseFormula('{a} = 1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('SYNTAX_ERROR')
  })

  it('rejects empty formula', () => {
    const result = parseFormula('')
    expect(result.ok).toBe(false)
  })

  it('round-trips canonical text form', () => {
    expect(astToFormula(parseOk('{weight} / ({height} / 100) ^ 2'))).toBe(
      '{weight} / ({height} / 100) ^ 2'
    )
  })
})

function parseOk(input: string) {
  const result = parseFormula(input)
  if (!result.ok) throw new Error(`parse failed: ${JSON.stringify(result.errors)}`)
  return result.ast
}

describe('FormulaParseError', () => {
  it('carries code and position', () => {
    const error = new FormulaParseError('TEST_CODE', 42, 'boom')
    expect(error.code).toBe('TEST_CODE')
    expect(error.position).toBe(42)
    expect(error.message).toBe('boom')
  })
})
