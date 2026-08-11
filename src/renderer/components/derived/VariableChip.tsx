import type { QuestionDef } from '@shared/types/qnaire'
import { QUESTION_TYPE_LABELS } from '@shared/types/qnaire'

export interface VariableChipProps {
  question: QuestionDef
  disabled: boolean
  onInsert(variableName: string): void
}

export function VariableChip({ question, disabled, onInsert }: VariableChipProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title="点击插入 {变量名} 到当前公式"
      onClick={() => onInsert(question.variableName)}
      className="flex flex-col items-start gap-[var(--space-1)] rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-[var(--space-3)] py-[var(--space-2)] text-left transition-shadow duration-200 hover:shadow-[var(--shadow-z1)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <code className="font-mono text-[length:var(--font-size-sm)] text-[var(--color-text-link)]">
        {question.variableName}
      </code>
      <span className="line-clamp-1 text-[length:var(--font-size-xs)] text-[var(--color-text-secondary)]">
        {question.content} · {QUESTION_TYPE_LABELS[question.type]}
      </span>
    </button>
  )
}
