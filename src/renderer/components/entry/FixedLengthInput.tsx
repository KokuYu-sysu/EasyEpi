import { Input } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface FixedLengthInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function FixedLengthInput({ question, value, onChange, error }: FixedLengthInputProps) {
  const length = question.constraint.fixedLength ?? 0

  return (
    <div className="grid gap-[var(--space-2)]">
      <Input
        label={question.content}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        maxLength={length}
        className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
      />
      {length > 0 ? (
        <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
          已输入 {value.length} / {length}
        </p>
      ) : null}
    </div>
  )
}
