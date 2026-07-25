import { Checkbox } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface MultiChoiceInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function MultiChoiceInput({ question, value, onChange, error }: MultiChoiceInputProps) {
  const selected = value ? value.split(',').filter(Boolean) : []

  const toggle = (optValue: string) => {
    const next = selected.includes(optValue)
      ? selected.filter((v) => v !== optValue)
      : [...selected, optValue]
    onChange(next.join(','))
  }

  return (
    <div className="grid gap-[var(--space-2)]">
      <p className="m-0 text-[length:var(--font-size-base)] font-[var(--font-weight-medium)]">
        {question.content}
      </p>
      {question.options.map((opt) => (
        <Checkbox
          key={opt.value}
          label={opt.label}
          checked={selected.includes(opt.value)}
          onCheckedChange={() => toggle(opt.value)}
          className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
        />
      ))}
      {error ? (
        <p
          role="alert"
          className="m-0 text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
