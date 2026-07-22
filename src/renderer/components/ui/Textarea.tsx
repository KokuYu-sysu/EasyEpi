import { forwardRef, useId } from 'react'

import type { ReactNode, TextareaHTMLAttributes } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
  hint?: string
  label: ReactNode
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    className,
    error,
    hint,
    id,
    label,
    ...props
  },
  ref
) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const hasHint = Boolean(hint)
  const hasError = Boolean(error)
  const hintId = hasHint ? `${controlId}-hint` : undefined
  const errorId = hasError ? `${controlId}-error` : undefined
  const descriptionIds = [describedBy, hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="grid gap-[var(--space-1)]">
      <label
        className="font-[var(--font-weight-medium)] text-[var(--color-text-primary)]"
        htmlFor={controlId}
      >
        {label}
      </label>
      <textarea
        {...props}
        ref={ref}
        id={controlId}
        aria-describedby={descriptionIds}
        aria-invalid={hasError ? true : ariaInvalid}
        className={[
          'min-h-24 w-full resize-y rounded-[var(--radius-1)] border bg-[var(--color-surface-base)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]',
          'focus-visible:border-[var(--color-border-focus)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-[var(--color-border-focus)]',
          'disabled:cursor-not-allowed disabled:bg-[var(--color-surface-disabled)] disabled:text-[var(--color-text-disabled)]',
          hasError ? 'border-[var(--color-border-danger)]' : 'border-[var(--color-border-default)]',
          className
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {hasHint ? (
        <p
          id={hintId}
          className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-muted)]"
        >
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p
          id={errorId}
          role="alert"
          className="m-0 text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
})
