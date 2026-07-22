import * as R from '@radix-ui/react-radio-group'
import type { ComponentPropsWithoutRef } from 'react'

type RootProps = ComponentPropsWithoutRef<typeof R.Root>
type ItemProps = Omit<ComponentPropsWithoutRef<typeof R.Item>, 'asChild' | 'children' | 'value'>
export interface RadioOption {
  value: string
  label: string
  disabled?: boolean
  itemProps?: ItemProps
}
export type RadioProps = Omit<RootProps, 'asChild' | 'children' | 'className' | 'orientation'> & {
  label: string
  options: RadioOption[]
  orientation?: 'vertical' | 'horizontal'
  className?: string
}
export function Radio({
  label,
  options,
  orientation = 'vertical',
  className,
  ...props
}: RadioProps) {
  return (
    <fieldset className={className}>
      <legend>{label}</legend>
      <R.Root
        {...props}
        orientation={orientation}
        aria-label={label}
        className={
          orientation === 'horizontal' ? 'flex gap-[var(--space-4)]' : 'grid gap-[var(--space-2)]'
        }
      >
        {options.map(({ value, label: optionLabel, disabled, itemProps }) => (
          <label key={value} className="inline-flex items-center gap-[var(--space-2)]">
            <R.Item
              {...itemProps}
              value={value}
              disabled={disabled}
              className={[
                'grid size-5 place-items-center rounded-[var(--radius-4)] border border-[var(--color-border-strong)] data-[disabled]:opacity-50',
                itemProps?.className
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <R.Indicator className="size-3 rounded-[var(--radius-4)] bg-[var(--color-brand)]" />
            </R.Item>
            {optionLabel}
          </label>
        ))}
      </R.Root>
    </fieldset>
  )
}
