import { FormulaPreview } from './FormulaPreview'

export interface FormulaTextEditorProps {
  formula: string
  onChange(next: string): void
}

const SYNTAX_HINTS = [
  '使用 {变量名} 引用题目变量，如 {weight}',
  '运算符: + - * / ^（乘方），比较: == != > < >= <=',
  '函数: IF(条件, 真值, 假值)  ROUND(x, n)  SQRT(x)  CONCAT(...)',
  '日期: DATE_DIFF(d1, d2, "year")  TODAY()  YEAR(d)'
]

export function FormulaTextEditor({ formula, onChange }: FormulaTextEditorProps) {
  return (
    <div className="grid gap-[var(--space-2)]">
      <textarea
        aria-label="公式文本编辑"
        value={formula}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        spellCheck={false}
        className="min-h-24 w-full resize-y rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-3)] font-mono text-[length:var(--font-size-sm)] focus:border-[var(--color-border-focus)]"
        placeholder='例如: {weight} / ({height} / 100) ^ 2'
      />
      <FormulaPreview formula={formula} />
      <ul className="m-0 grid gap-[var(--space-1)] pl-[var(--space-4)] text-[length:var(--font-size-xs)] text-[var(--color-text-secondary)]">
        {SYNTAX_HINTS.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </div>
  )
}
