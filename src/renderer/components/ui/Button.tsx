import { forwardRef } from 'react'

import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  size?: ButtonSize
  variant?: ButtonVariant
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-[var(--color-brand)] text-[var(--color-on-brand)] hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-active)]',
  secondary:
    'border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]',
  ghost:
    'border-transparent bg-transparent text-[var(--color-text-link)] hover:bg-[var(--color-brand-soft)]',
  danger:
    'border-transparent bg-[var(--color-danger)] text-[var(--color-text-inverse)] hover:opacity-90'
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--font-size-sm)]',
  md: 'min-h-11 px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--font-size-md)]',
  lg: 'min-h-12 px-[var(--space-5)] py-[var(--space-3)] text-[length:var(--font-size-lg)]'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled = false,
    loading = false,
    size = 'md',
    type = 'button',
    variant = 'primary',
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-size={size}
      data-variant={variant}
      className={[
        'inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-1)] border font-[var(--font-weight-semibold)] transition-colors duration-[var(--motion-fast)]',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[var(--color-border-focus)]',
        'disabled:cursor-not-allowed disabled:bg-[var(--color-surface-disabled)] disabled:text-[var(--color-text-disabled)] disabled:opacity-100',
        variantClasses[variant],
        sizeClasses[size],
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-[var(--radius-4)] border-2 border-current border-r-transparent"
          />
          <span className="sr-only">{children}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
})
