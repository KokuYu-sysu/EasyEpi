import type { QuestionDef } from '@shared/types/qnaire'
import { QUESTION_TYPE_LABELS } from '@shared/types/qnaire'
import {
  SingleChoiceInput,
  MultiChoiceInput,
  FixedLengthInput,
  FreeTextInput,
  NumericRangeInput,
  DateInput
} from '.'

export interface QuestionCardProps {
  question: QuestionDef
  questionIndex: number
  totalVisible: number
  value: string
  onChange: (value: string) => void
  error?: string
}

export function QuestionCard({
  question,
  questionIndex,
  totalVisible,
  value,
  onChange,
  error
}: QuestionCardProps) {
  const inputProps = { question, value, onChange, error }

  return (
    <section
      aria-labelledby="entry-question-heading"
      className="mx-auto grid w-full max-w-3xl gap-[var(--space-5)] rounded-[var(--radius-3)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-5)] shadow-[var(--shadow-z1)]"
    >
      <div className="grid gap-[var(--space-1)]">
        <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
          第 {questionIndex + 1} 题 / 共 {totalVisible} 题
          <span className="ml-[var(--space-2)] text-[length:var(--font-size-xs)] text-[var(--color-text-tertiary)]">
            ({QUESTION_TYPE_LABELS[question.type]})
          </span>
        </p>
        <h2 id="entry-question-heading" className="m-0 text-[length:var(--font-size-xl)]">
          {question.content}
          {question.isKey ? (
            <span className="ml-[var(--space-1)] text-[var(--color-key)]" aria-label="Key 标识符">
              🔑
            </span>
          ) : null}
          {!question.allowSkip ? <span aria-hidden="true"> *</span> : null}
        </h2>
      </div>

      {question.type === 'single_choice' && <SingleChoiceInput {...inputProps} />}
      {question.type === 'multiple_choice' && <MultiChoiceInput {...inputProps} />}
      {question.type === 'fixed_length' && <FixedLengthInput {...inputProps} />}
      {question.type === 'free_text' && <FreeTextInput {...inputProps} />}
      {question.type === 'numeric_range' && <NumericRangeInput {...inputProps} />}
      {question.type === 'date' && <DateInput {...inputProps} />}
    </section>
  )
}
