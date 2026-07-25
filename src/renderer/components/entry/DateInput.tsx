import { Input } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface DateInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function DateInput({ question, value, onChange, error }: DateInputProps) {
  return (
    <Input
      label={question.content}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
    />
  )
}
