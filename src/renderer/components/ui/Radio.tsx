import * as R from '@radix-ui/react-radio-group'
export interface RadioOption {
  value: string
  label: string
  disabled?: boolean
}
export interface RadioProps {
  label: string
  options: RadioOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (v: string) => void
  disabled?: boolean
  name?: string
  className?: string
}
export function Radio({ label, options, className, ...props }: RadioProps) {
  return (
    <fieldset className={className}>
      <legend>{label}</legend>
      <R.Root
        {...props}
        orientation="horizontal"
        aria-label={label}
        className="grid gap-[var(--space-2)]"
      >
        {options.map((o) => (
          <label key={o.value} className="inline-flex items-center gap-[var(--space-2)]">
            <R.Item
              value={o.value}
              disabled={o.disabled}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return
                const radios = [
                  ...event.currentTarget
                    .closest('[role=radiogroup]')!
                    .querySelectorAll<HTMLButtonElement>('[role=radio]:not([disabled])')
                ]
                radios[(radios.indexOf(event.currentTarget) + 1) % radios.length]?.click()
              }}
              className="grid size-5 place-items-center rounded-[var(--radius-4)] border border-[var(--color-border-strong)] data-[disabled]:opacity-50"
            >
              <R.Indicator className="size-3 rounded-[var(--radius-4)] bg-[var(--color-brand)]" />
            </R.Item>
            {o.label}
          </label>
        ))}
      </R.Root>
    </fieldset>
  )
}
