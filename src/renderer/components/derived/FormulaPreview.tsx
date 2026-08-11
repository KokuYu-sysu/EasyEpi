import { useMemo } from 'react'
import katex from 'katex'

import { toLatex } from '@shared/derived'
import { parseFormula } from '@shared/derived/parser'

export interface FormulaPreviewProps {
  formula: string
  className?: string
}

export function FormulaPreview({ formula, className }: FormulaPreviewProps) {
  const { html, valid } = useMemo(() => {
    const parsed = parseFormula(formula)
    if (!parsed.ok) return { html: '', valid: false }
    const latex = toLatex(formula)
    try {
      return {
        html: katex.renderToString(latex, { throwOnError: false, displayMode: true }),
        valid: true
      }
    } catch {
      return { html: '', valid: false }
    }
  }, [formula])

  if (!valid || formula.trim().length === 0) return null

  return (
    <div
      className={['overflow-x-auto rounded-[var(--radius-1)] bg-[var(--color-surface-muted)] px-[var(--space-3)] py-[var(--space-2)]', className ?? ''].join(' ')}
      aria-label="公式预览"
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
