import { FormulaSyntaxError, tokenize, type Token, type TokenType } from './tokenizer'
import { getBuiltinArity } from './builtins'
import { BUILTIN_FUNCTION_NAMES } from './builtins'
import type {
  AstNode,
  BinaryOperator,
  ComparisonOperator,
  ParseResult
} from './ast'

const COMPARISON_OPS = new Set(['==', '!=', '>', '<', '>=', '<='])

export class FormulaParseError extends Error {
  readonly code: string
  readonly position: number

  constructor(code: string, position: number, message: string) {
    super(message)
    this.name = 'FormulaParseError'
    this.code = code
    this.position = position
  }
}

export function parseFormula(input: string): ParseResult {
  try {
    const tokens = tokenize(input, BUILTIN_FUNCTION_NAMES)
    const parser = new Parser(tokens)
    const ast = parser.parseExpression()
    if (!parser.isAtEnd()) {
      return {
        ok: false,
        errors: [
          {
            code: 'TRAILING_TOKENS',
            message: `公式末尾存在多余内容 "${parser.current.value}"`,
            position: parser.current.position
          }
        ]
      }
    }
    return { ok: true, ast }
  } catch (error) {
    if (error instanceof FormulaSyntaxError) {
      return {
        ok: false,
        errors: [{ code: 'SYNTAX_ERROR', message: error.message, position: error.position }]
      }
    }
    if (error instanceof FormulaParseError) {
      return {
        ok: false,
        errors: [{ code: error.code, message: error.message, position: error.position }]
      }
    }
    return { ok: false, errors: [{ code: 'PARSE_ERROR', message: '公式解析失败' }] }
  }
}

class Parser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  get current(): Token {
    return this.tokens[this.index]!
  }

  isAtEnd(): boolean {
    return this.current.type === 'EOF'
  }

  private advance(): Token {
    const token = this.current
    if (token.type !== 'EOF') this.index += 1
    return token
  }

  private match(type: TokenType): Token | null {
    if (this.current.type === type) return this.advance()
    return null
  }

  private expect(type: TokenType, code: string, message: string): Token {
    const token = this.match(type)
    if (token) return token
    return this.error(code, message)
  }

  private error(code: string, message: string): never {
    throw new FormulaParseError(code, this.current.position, message)
  }

  parseExpression(): AstNode {
    return this.parseComparison()
  }

  private parseComparison(): AstNode {
    let left = this.parseAdditive()
    while (this.current.type === 'COMPARISON') {
      const op = this.current.value as ComparisonOperator
      if (!COMPARISON_OPS.has(op)) {
        return this.error('INVALID_COMPARISON', `无效的比较运算符 "${op}"`)
      }
      this.advance()
      const right = this.parseAdditive()
      left = { type: 'compare', op, left, right }
    }
    return left
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative()
    while (
      this.current.type === 'OPERATOR' &&
      (this.current.value === '+' || this.current.value === '-')
    ) {
      const op = this.advance().value as BinaryOperator
      const right = this.parseMultiplicative()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary()
    while (
      this.current.type === 'OPERATOR' &&
      (this.current.value === '*' || this.current.value === '/')
    ) {
      const op = this.advance().value as BinaryOperator
      const right = this.parseUnary()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseUnary(): AstNode {
    if (this.current.type === 'OPERATOR' && (this.current.value === '-' || this.current.value === '+')) {
      const op = this.advance().value as '-' | '+'
      const operand = this.parseUnary()
      return { type: 'unary', op, operand }
    }
    return this.parsePower()
  }

  private parsePower(): AstNode {
    const left = this.parsePrimary()
    if (this.current.type === 'OPERATOR' && this.current.value === '^') {
      this.advance()
      const right = this.parseUnary()
      return { type: 'binary', op: '^', left, right }
    }
    return left
  }

  private parsePrimary(): AstNode {
    const token = this.current

    if (token.type === 'NUMBER') {
      this.advance()
      const value = Number(token.value)
      if (!Number.isFinite(value)) {
        return this.error('INVALID_NUMBER', `无效的数字 "${token.value}"`)
      }
      return { type: 'literal', value, valueType: 'number' }
    }

    if (token.type === 'STRING') {
      this.advance()
      return { type: 'literal', value: token.value, valueType: 'string' }
    }

    if (token.type === 'VARIABLE') {
      this.advance()
      return { type: 'variable', name: token.value }
    }

    if (token.type === 'LPAREN') {
      this.advance()
      const expression = this.parseExpression()
      this.expect('RPAREN', 'UNBALANCED_PAREN', '缺少右括号 )')
      return expression
    }

    if (token.type === 'FUNCTION') {
      return this.parseCall()
    }

    return this.error(
      'EXPECTED_EXPRESSION',
      `此处需要一个表达式，但遇到 "${token.value}"`
    )
  }

  private parseCall(): AstNode {
    const name = this.advance().value
    const arity = getBuiltinArity(name)
    this.expect('LPAREN', 'EXPECTED_LPAREN', `函数 ${name} 缺少左括号 (`)

    const args: AstNode[] = []
    if (this.current.type !== 'RPAREN') {
      for (;;) {
        args.push(this.parseExpression())
        if (this.match('COMMA')) continue
        break
      }
    }
    this.expect('RPAREN', 'UNBALANCED_PAREN', `函数 ${name} 缺少右括号 )`)

    if (arity) {
      const [min, max] = arity
      const message =
        min === max
          ? `函数 ${name} 需要 ${min} 个参数`
          : `函数 ${name} 需要 ${min}-${max} 个参数`
      if (args.length < min || args.length > max) {
        return this.error('ARG_COUNT_MISMATCH', message)
      }
    }

    return { type: 'call', name, args }
  }
}
