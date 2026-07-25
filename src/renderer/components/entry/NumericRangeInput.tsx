import { Input } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface NumericRangeInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function NumericRangeInput({ question, value, onChange, error }: NumericRangeInputProps) {
  const { minValue, maxValue, step } = question.constraint
  const hint =
    minValue !== undefined && maxValue !== undefined
      ? `范围: ${minValue} - ${maxValue}${step ? ` (步长: ${step})` : ''}`
      : undefined

  return (
    <div className="grid gap-[var(--space-2)]">
      <Input
        label={question.content}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        min={minValue}
        max={maxValue}
        step={step}
        className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
      />
      {hint ? (
        <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
