import { forwardRef } from 'react'

import type { HTMLAttributes } from 'react'

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]',
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]'
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = 'neutral', ...props },
  ref
) {
  return (
    <span
      {...props}
      ref={ref}
      data-variant={variant}
      className={[
        'inline-flex max-w-full items-center rounded-[var(--radius-4)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)]',
        variantClasses[variant],
        className
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
})
