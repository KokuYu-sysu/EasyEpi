import type { AstNode } from './ast'
import { parseFormula } from './parser'

type Precedence = 0 | 1 | 2 | 3 | 4 | 5 | 6

function precedenceOf(node: AstNode): Precedence {
  switch (node.type) {
    case 'compare':
      return 1
    case 'binary':
      return node.op === '+' || node.op === '-' ? 2 : node.op === '^' ? 5 : 3
    case 'unary':
      return 4
    default:
      return 6
  }
}

const TEXT_OPS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  '^': '^',
  '==': '==',
  '!=': '!=',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<='
}

const LATEX_OPS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '\\cdot ',
  '/': '',
  '^': '^{',
  '==': '=',
  '!=': '\\ne ',
  '>': '>',
  '<': '<',
  '>=': '\\ge ',
  '<=': '\\le '
}

function printNode(node: AstNode, parent: Precedence, latex: boolean): string {
  const wrap = (text: string, level: Precedence): string =>
    level < parent ? `(${text})` : text

  switch (node.type) {
    case 'literal':
      return typeof node.value === 'number'
        ? String(node.value)
        : latex
          ? `\\text{${escapeLatexText(node.value)}}`
          : `"${node.value}"`

    case 'variable':
      return latex ? `\\mathrm{${escapeLatexName(node.name)}}` : `{${node.name}}`

    case 'binary': {
      const level = precedenceOf(node)
      if (node.op === '^') {
        const left = printNode(node.left, 6 as Precedence, latex)
        const right = printNode(node.right, 5 as Precedence, latex)
        return wrap(
          latex ? `${left}${LATEX_OPS['^']}${right}}` : `${left} ^ ${right}`,
          level
        )
      }
      if (node.op === '/' && latex) {
        return wrap(`\\frac{${printNode(node.left, 0 as Precedence, latex)}}{${printNode(node.right, 0 as Precedence, latex)}}`, level)
      }
      const left = printNode(node.left, level, latex)
      const right = printNode(node.right, (level + 1) as Precedence, latex)
      const operator = (latex ? LATEX_OPS : TEXT_OPS)[node.op] ?? node.op
      return wrap(
        latex ? `${left}${operator}${right}` : `${left} ${operator} ${right}`,
        level
      )
    }

    case 'unary': {
      const sign = node.op === '-' ? '-' : '+'
      const operand = printNode(node.operand, 4, latex)
      return wrap(`${sign}${operand}`, 4)
    }

    case 'compare': {
      const op = (latex ? LATEX_OPS : TEXT_OPS)[node.op] ?? node.op
      const left = printNode(node.left, 2, latex)
      const right = printNode(node.right, 2, latex)
      return `(${left} ${op} ${right})`
    }

    case 'call': {
      const args = node.args.map((arg) => printNode(arg, 0 as Precedence, latex)).join(', ')
      return latex
        ? `\\mathrm{${escapeLatexName(node.name)}}(${args})`
        : `${node.name}(${args})`
    }

    default:
      return ''
  }
}

function escapeLatexText(text: string): string {
  return text.replace(/([{}_#$%&])/g, '\\$1')
}

function escapeLatexName(name: string): string {
  return name.replace(/_/g, '\\_')
}

export function toLatex(formula: string): string {
  const result = parseFormula(formula)
  if (!result.ok) return formula
  return printNode(result.ast, 0, true)
}

export function astToFormula(ast: AstNode): string {
  return printNode(ast, 0, false)
}

export function normalizeFormula(formula: string): string | null {
  const result = parseFormula(formula)
  if (!result.ok) return null
  return astToFormula(result.ast)
}
