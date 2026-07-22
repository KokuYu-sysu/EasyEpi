import * as R from '@radix-ui/react-checkbox'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
type RootProps = ComponentPropsWithoutRef<typeof R.Root>
export type CheckboxProps = Omit<RootProps, 'asChild' | 'children' | 'className'> & {
  label: string
  className?: string
}
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { label, className, ...props },
  ref
) {
  return (
    <label className="inline-flex items-center gap-[var(--space-2)]">
      <R.Root
        {...props}
        ref={ref}
        className={[
          'grid size-5 place-items-center rounded-[var(--radius-1)] border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] data-[state=checked]:bg-[var(--color-brand)] data-[disabled]:opacity-50',
          className
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <R.Indicator className="text-[var(--color-on-brand)]">✓</R.Indicator>
      </R.Root>
      <span>{label}</span>
    </label>
  )
})
