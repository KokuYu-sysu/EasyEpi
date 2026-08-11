import { describe, expect, it } from 'vitest'

import { toLatex, astToFormula, normalizeFormula } from '@shared/derived/latex'
import { parseFormula } from '@shared/derived/parser'

describe('toLatex', () => {
  it('renders variable references as mathrm', () => {
    expect(toLatex('{weight}')).toBe('\\mathrm{weight}')
  })

  it('renders division as frac', () => {
    expect(toLatex('{weight} / 2')).toBe('\\frac{\\mathrm{weight}}{2}')
    expect(toLatex('{weight} / ({height} / 100)')).toBe(
      '\\frac{\\mathrm{weight}}{\\frac{\\mathrm{height}}{100}}'
    )
  })

  it('renders power with braces', () => {
    expect(toLatex('{height} ^ 2')).toBe('\\mathrm{height}^{2}')
  })

  it('renders multiplication with cdot', () => {
    expect(toLatex('2 * {age}')).toBe('2\\cdot \\mathrm{age}')
  })

  it('renders comparisons', () => {
    expect(toLatex('{age} >= 60')).toBe('(\\mathrm{age} \\ge  60)')
  })

  it('renders function calls', () => {
    expect(toLatex('IF({age} >= 60, "老年", "成年")')).toContain('\\mathrm{IF}')
    expect(toLatex('IF({age} >= 60, "老年", "成年")')).toContain('\\text{老年}')
  })

  it('returns raw input when formula is invalid', () => {
    expect(toLatex('{age >')).toBe('{age >')
  })
})

describe('astToFormula', () => {
  it('rebuilds canonical formula text', () => {
    const ast = parseFormula('1 + 2 * 3')
    expect(ast.ok).toBe(true)
    if (ast.ok) expect(astToFormula(ast.ast)).toBe('1 + 2 * 3')
  })

  it('adds parentheses to preserve structure', () => {
    const ast = parseFormula('(1 + 2) * 3')
    expect(ast.ok).toBe(true)
    if (ast.ok) expect(astToFormula(ast.ast)).toBe('(1 + 2) * 3')
  })

  it('prints strings with quotes', () => {
    const ast = parseFormula('IF({a} == "x", "y", "z")')
    expect(ast.ok).toBe(true)
    if (ast.ok) expect(astToFormula(ast.ast)).toBe('IF(({a} == "x"), "y", "z")')
  })
})

describe('normalizeFormula', () => {
  it('returns canonical form for valid formulas', () => {
    expect(normalizeFormula('1+2*3')).toBe('1 + 2 * 3')
  })

  it('returns null for invalid formulas', () => {
    expect(normalizeFormula('1 + (2')).toBe(null)
  })
})
