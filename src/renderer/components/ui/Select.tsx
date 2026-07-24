import * as R from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
type RootProps = ComponentPropsWithoutRef<typeof R.Root>
export type SelectTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof R.Trigger>,
  'asChild' | 'children'
>
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}
export type SelectProps = Omit<RootProps, 'children'> & {
  label: string
  options: SelectOption[]
  placeholder?: string
  className?: string
  triggerProps?: SelectTriggerProps
}
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { label, options, placeholder = '请选择', className, triggerProps, ...rootProps },
  ref
) {
  return (
    <label className="grid gap-[var(--space-2)]">
      <span>{label}</span>
      <R.Root {...rootProps}>
        <R.Trigger
          {...triggerProps}
          ref={ref}
          aria-label={label}
          className={[
            'flex min-h-11 w-full items-center gap-[var(--space-3)] rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-[var(--space-3)] text-left',
            className,
            triggerProps?.className
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            <R.Value placeholder={placeholder} />
          </span>
          <R.Icon asChild>
            <ChevronDown className="shrink-0" size={20} strokeWidth={2} />
          </R.Icon>
        </R.Trigger>
        <R.Portal>
          <R.Content
            position="popper"
            className="z-[var(--z-5)] rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-[var(--space-1)] shadow-[var(--shadow-z2)]"
          >
            <R.Viewport>
              {options.map((option) => (
                <R.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="cursor-default rounded-[var(--radius-1)] px-[var(--space-3)] py-[var(--space-2)] data-[highlighted]:bg-[var(--color-brand-soft)] data-[disabled]:text-[var(--color-text-disabled)]"
                >
                  <R.ItemText>{option.label}</R.ItemText>
                </R.Item>
              ))}
            </R.Viewport>
          </R.Content>
        </R.Portal>
      </R.Root>
    </label>
  )
})
