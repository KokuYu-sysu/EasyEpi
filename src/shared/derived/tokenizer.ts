export type TokenType =
  | 'VARIABLE'
  | 'NUMBER'
  | 'STRING'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'FUNCTION'
  | 'COMPARISON'
  | 'COMMA'
  | 'EOF'

export interface Token {
  type: TokenType
  value: string
  position: number
}

export class FormulaSyntaxError extends Error {
  readonly position: number

  constructor(message: string, position: number) {
    super(message)
    this.name = 'FormulaSyntaxError'
    this.position = position
  }
}

const IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/

const VARIABLE_REF_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/

function isIdentifierChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char)
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

export function tokenize(input: string, builtinFunctionNames: ReadonlySet<string>): Token[] {
  const tokens: Token[] = []
  let index = 0

  const peek = (): string | null => (index < input.length ? (input[index] as string) : null)

  const next = (): string => {
    const char = input[index]!
    index += 1
    return char
  }

  while (index < input.length) {
    const char = peek()!

    if (isWhitespace(char)) {
      index += 1
      continue
    }

    if (char === '{') {
      const start = index
      index += 1
      let name = ''
      while (index < input.length && peek() !== '}') {
        name += next()
      }
      if (index >= input.length) {
        throw new FormulaSyntaxError('变量引用缺少右花括号 }', start)
      }
      index += 1 // consume '}'
      const trimmed = name.trim()
      if (trimmed.length === 0) {
        throw new FormulaSyntaxError('变量引用不能为空', start)
      }
      if (!VARIABLE_REF_PATTERN.test(trimmed)) {
        throw new FormulaSyntaxError(
          `变量名 "${trimmed}" 无效：需以字母开头，仅含字母、数字、下划线`,
          start
        )
      }
      tokens.push({ type: 'VARIABLE', value: trimmed, position: start })
      continue
    }

    if (char === '"' || char === "'") {
      const start = index
      const quote = next()
      let value = ''
      while (index < input.length && peek() !== quote) {
        const current = next()
        if (current === '\\') {
          const escaped = next()
          if (escaped === 'n') value += '\n'
          else if (escaped === 't') value += '\t'
          else if (escaped === '\\') value += '\\'
          else if (escaped === quote) value += quote
          else value += escaped
        } else {
          value += current
        }
      }
      if (index >= input.length) {
        throw new FormulaSyntaxError('字符串缺少结束引号', start)
      }
      index += 1 // consume closing quote
      tokens.push({ type: 'STRING', value, position: start })
      continue
    }

    if (isDigit(char) || (char === '.' && isDigit(input[index + 1] ?? ''))) {
      const start = index
      let number = ''
      while (index < input.length && isDigit(peek()!)) {
        number += next()
      }
      if (peek() === '.') {
        number += next()
        while (index < input.length && isDigit(peek()!)) {
          number += next()
        }
      }
      tokens.push({ type: 'NUMBER', value: number, position: start })
      continue
    }

    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(', position: index })
      index += 1
      continue
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')', position: index })
      index += 1
      continue
    }
    if (char === ',') {
      tokens.push({ type: 'COMMA', value: ',', position: index })
      index += 1
      continue
    }

    const two = input.slice(index, index + 2)
    if (two === '==' || two === '!=' || two === '>=' || two === '<=') {
      tokens.push({ type: 'COMPARISON', value: two, position: index })
      index += 2
      continue
    }
    if (char === '>' || char === '<') {
      tokens.push({ type: 'COMPARISON', value: char, position: index })
      index += 1
      continue
    }

    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ type: 'OPERATOR', value: char, position: index })
      index += 1
      continue
    }

    if (char === '^') {
      tokens.push({ type: 'OPERATOR', value: '^', position: index })
      index += 1
      continue
    }

    if (isIdentifierChar(char)) {
      const start = index
      let name = ''
      while (index < input.length && isIdentifierChar(peek()!)) {
        name += next()
      }
      if (!IDENTIFIER_PATTERN.test(name)) {
        throw new FormulaSyntaxError(`无效标识符 "${name}"`, start)
      }
      if (!builtinFunctionNames.has(name)) {
        throw new FormulaSyntaxError(`未定义函数 "${name}"（变量引用请使用 {变量名}）`, start)
      }
      tokens.push({ type: 'FUNCTION', value: name, position: start })
      continue
    }

    throw new FormulaSyntaxError(`无法识别的字符 "${char}"`, index)
  }

  tokens.push({ type: 'EOF', value: '', position: input.length })
  return tokens
}
