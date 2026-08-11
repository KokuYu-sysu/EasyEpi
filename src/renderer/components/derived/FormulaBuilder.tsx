import { useMemo } from 'react'

import { BUILTIN_FUNCTION_NAMES } from '@shared/derived'
import { tokenize, FormulaSyntaxError } from '@shared/derived/tokenizer'

import { Button, Select } from '../ui'
import { FormulaPreview } from './FormulaPreview'

export interface FormulaBuilderProps {
  formula: string
  onChange(next: string): void
}

const OPERATOR_BUTTONS = [
  { label: '+', insert: '+' },
  { label: '−', insert: '-' },
  { label: '×', insert: '*' },
  { label: '÷', insert: '/' },
  { label: '^', insert: '^' },
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: ',', insert: ',' }
] as const

const FUNCTION_LABELS: Record<string, string> = {
  IF: 'IF(条件,真值,假值)',
  ROUND: 'ROUND(x,n)',
  ABS: 'ABS(x)',
  SQRT: 'SQRT(x)',
  LOG: 'LOG(x)',
  LN: 'LN(x)',
  EXP: 'EXP(x)',
  POW: 'POW(x,n)',
  DATE_DIFF: 'DATE_DIFF(d1,d2,unit)',
  YEAR: 'YEAR(d)',
  MONTH: 'MONTH(d)',
  TODAY: 'TODAY()',
  CONCAT: 'CONCAT(...)',
  SUBSTR: 'SUBSTR(s,start,len)',
  MEAN: 'MEAN(...)',
  SUM: 'SUM(...)'
}

const TOKEN_LABELS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '×',
  '/': '÷',
  '^': '^',
  '(': '(',
  ')': ')',
  ',': ','
}

export function FormulaBuilder({ formula, onChange }: FormulaBuilderProps) {
  const segments = useMemo<{ key: string; text: string }[]>(() => {
    try {
      return tokenize(formula, BUILTIN_FUNCTION_NAMES)
        .filter((token) => token.type !== 'EOF')
        .map((token, index) => ({
          key: `${index}-${token.position}`,
          text:
            token.type === 'VARIABLE'
              ? `{${token.value}}`
              : token.type === 'STRING'
                ? `"${token.value}"`
                : token.type === 'FUNCTION'
                  ? token.value
                  : TOKEN_LABELS[token.value] ?? token.value
        }))
    } catch (error) {
      if (error instanceof FormulaSyntaxError) return [{ key: 'error', text: error.message }]
      return [{ key: 'error', text: '公式无法解析' }]
    }
  }, [formula])

  const isError = segments.length === 1 && segments[0]!.key === 'error'

  const append = (text: string) => onChange(`${formula}${text}`)

  const insertFunction = (name: string) => {
    onChange(`${formula}${name}( )`)
  }

  const backspace = () => onChange(formula.slice(0, -1))

  return (
    <div className="grid gap-[var(--space-2)]">
      <div
        aria-label="公式可视化构建"
        className="flex min-h-11 flex-wrap items-center gap-[var(--space-1)] rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-2)]"
      >
        {isError ? (
          <span className="text-[length:var(--font-size-sm)] text-[var(--color-danger)]">
            {segments[0]!.text}（可切换到「高级」模式直接编辑文本）
          </span>
        ) : (
          segments.map((segment) => (
            <code
              key={segment.key}
              className="rounded-[var(--radius-1)] bg-[var(--color-surface-muted)] px-[var(--space-1)] py-px font-mono text-[length:var(--font-size-sm)]"
            >
              {segment.text}
            </code>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <span className="text-[length:var(--font-size-xs)] text-[var(--color-text-secondary)]">
          运算符:
        </span>
        {OPERATOR_BUTTONS.map((button) => (
          <Button
            key={button.label}
            size="sm"
            variant="secondary"
            onClick={() => append(button.insert)}
          >
            {button.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={backspace} aria-label="删除最后一个字符">
          ⌫ 删除
        </Button>
      </div>
      <Select
        label="插入函数"
        placeholder="选择函数"
        options={Object.keys(FUNCTION_LABELS)
          .filter((name) => BUILTIN_FUNCTION_NAMES.has(name))
          .map((name) => ({ value: name, label: FUNCTION_LABELS[name] ?? name }))}
        onValueChange={insertFunction}
      />
      <FormulaPreview formula={formula} />
    </div>
  )
}
