import { forwardRef, useId } from 'react'

import type { HTMLAttributes, ReactNode } from 'react'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  action?: ReactNode
  description: ReactNode
  headingLevel?: 2 | 3 | 4
  title: ReactNode
}

const headingTags = { 2: 'h2', 3: 'h3', 4: 'h4' } as const

export const EmptyState = forwardRef<HTMLElement, EmptyStateProps>(function EmptyState(
  {
    'aria-labelledby': labelledBy,
    action,
    className,
    description,
    headingLevel = 2,
    title,
    ...props
  },
  ref
) {
  const generatedId = useId()
  const titleId = `${generatedId}-title`
  const Heading = headingTags[headingLevel]

  return (
    <section
      {...props}
      ref={ref}
      aria-labelledby={[labelledBy, titleId].filter(Boolean).join(' ')}
      className={[
        'grid justify-items-center gap-[var(--space-3)] rounded-[var(--radius-2)] border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-6)] text-center',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Heading
        id={titleId}
        className="m-0 text-[length:var(--font-size-lg)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]"
      >
        {title}
      </Heading>
      <p className="m-0 max-w-prose text-[var(--color-text-secondary)]">{description}</p>
      {action ? <div className="mt-[var(--space-1)]">{action}</div> : null}
    </section>
  )
})
