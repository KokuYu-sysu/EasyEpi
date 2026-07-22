import { Fragment, forwardRef } from 'react'

import type { HTMLAttributes } from 'react'

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  statusText?: string
}

export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  { className, statusText = 'Loading…', ...props },
  ref
) {
  return (
    <Fragment>
      <span
        {...props}
        ref={ref}
        aria-hidden="true"
        className={[
          'block min-h-4 animate-pulse rounded-[var(--radius-1)] bg-[var(--color-surface-sunken)]',
          className
        ]
          .filter(Boolean)
          .join(' ')}
      />
      <span
        role="status"
        className="text-[length:var(--font-size-sm)] text-[var(--color-text-muted)]"
      >
        {statusText}
      </span>
    </Fragment>
  )
})
