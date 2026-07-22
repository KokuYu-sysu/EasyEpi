import * as R from '@radix-ui/react-select'
import { forwardRef } from 'react'
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}
export interface SelectProps {
  label: string
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  name?: string
  className?: string
}
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { label, options, placeholder = '请选择', className, ...props },
  ref
) {
  return (
    <label className="grid gap-[var(--space-2)]">
      <span>{label}</span>
      <R.Root {...props}>
        <R.Trigger
          ref={ref}
          aria-label={label}
          className={[
            'min-h-11 rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-[var(--space-3)] text-left',
            className
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <R.Value placeholder={placeholder} />
          <R.Icon>⌄</R.Icon>
        </R.Trigger>
        <R.Portal>
          <R.Content
            position="popper"
            className="z-[var(--z-3)] rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-[var(--space-1)] shadow-[var(--shadow-z2)]"
          >
            <R.Viewport>
              {options.map((o) => (
                <R.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className="cursor-default rounded-[var(--radius-1)] px-[var(--space-3)] py-[var(--space-2)] data-[highlighted]:bg-[var(--color-brand-soft)] data-[disabled]:text-[var(--color-text-disabled)]"
                >
                  <R.ItemText>{o.label}</R.ItemText>
                </R.Item>
              ))}
            </R.Viewport>
          </R.Content>
        </R.Portal>
      </R.Root>
    </label>
  )
})
