import { forwardRef, useId } from 'react'

import type { HTMLAttributes, ReactNode } from 'react'

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  max?: number
  value: number
  valueLabel?: ReactNode
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { className, label, max = 100, value, valueLabel, ...props },
  ref
) {
  const generatedId = useId()
  const labelId = `${generatedId}-label`
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1
  const finiteValue = Number.isFinite(value) ? value : 0
  const safeValue = Math.min(safeMax, Math.max(0, finiteValue))
  const percent = (safeValue / safeMax) * 100

  return (
    <div
      {...props}
      ref={ref}
      className={['grid gap-[var(--space-2)]', className].filter(Boolean).join(' ')}
    >
      <div className="flex items-center justify-between gap-[var(--space-3)] text-[length:var(--font-size-sm)]">
        <span
          id={labelId}
          className="font-[var(--font-weight-medium)] text-[var(--color-text-primary)]"
        >
          {label}
        </span>
        <span className="text-[var(--color-text-secondary)]">
          {valueLabel ?? `${safeValue} / ${safeMax}`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        className="h-2 overflow-hidden rounded-[var(--radius-4)] bg-[var(--color-surface-sunken)]"
      >
        <div
          className="h-full rounded-[var(--radius-4)] bg-[var(--color-brand)] transition-[width] duration-[var(--motion-normal)]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
})
