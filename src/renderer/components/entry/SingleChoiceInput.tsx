import { Radio } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface SingleChoiceInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function SingleChoiceInput({ question, value, onChange, error }: SingleChoiceInputProps) {
  return (
    <div className="grid gap-[var(--space-2)]">
      <Radio
        label={question.content}
        options={question.options.map((opt) => ({
          value: opt.value,
          label: opt.label,
          itemProps: {
            className:
              'focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]'
          }
        }))}
        value={value}
        onValueChange={onChange}
        aria-invalid={error ? true : undefined}
      />
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
