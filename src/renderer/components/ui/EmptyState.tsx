import { forwardRef, useId } from 'react'

import type { HTMLAttributes, ReactNode } from 'react'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  action?: ReactNode
  description: ReactNode
  title: ReactNode
}

export const EmptyState = forwardRef<HTMLElement, EmptyStateProps>(function EmptyState(
  { action, className, description, title, ...props },
  ref
) {
  const generatedId = useId()
  const titleId = `${generatedId}-title`

  return (
    <section
      {...props}
      ref={ref}
      aria-labelledby={titleId}
      className={[
        'grid justify-items-center gap-[var(--space-3)] rounded-[var(--radius-2)] border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-6)] text-center',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h2
        id={titleId}
        className="m-0 text-[length:var(--font-size-lg)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]"
      >
        {title}
      </h2>
      <p className="m-0 max-w-prose text-[var(--color-text-secondary)]">{description}</p>
      {action ? <div className="mt-[var(--space-1)]">{action}</div> : null}
    </section>
  )
})
