import { Textarea } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface FreeTextInputProps {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function FreeTextInput({ question, value, onChange, error }: FreeTextInputProps) {
  return (
    <Textarea
      label={question.content}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      rows={4}
      className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
    />
  )
}
