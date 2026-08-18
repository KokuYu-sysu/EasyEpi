import { forwardRef } from 'react'
import type { SVGProps } from 'react'

export type IllustrationVariant = 'empty' | 'no-data' | 'error' | 'success' | 'search'

export interface IllustrationProps extends SVGProps<SVGSVGElement> {
  variant: IllustrationVariant
}

const illustrations: Record<IllustrationVariant, React.ReactNode> = {
  empty: (
    <>
      <circle cx="120" cy="100" r="80" fill="var(--color-brand-soft)" />
      <path d="M80 100 L120 60 L160 100" stroke="var(--color-brand)" strokeWidth="8" fill="none" />
      <path d="M100 80 L140 80" stroke="var(--color-brand)" strokeWidth="8" />
    </>
  ),
  'no-data': (
    <>
      <rect x="40" y="40" width="160" height="120" rx="16" fill="var(--color-brand-soft)" />
      <line x1="80" y1="70" x2="160" y2="70" stroke="var(--color-brand)" strokeWidth="6" />
      <line x1="80" y1="90" x2="140" y2="90" stroke="var(--color-brand)" strokeWidth="6" />
      <line x1="80" y1="110" x2="120" y2="110" stroke="var(--color-brand)" strokeWidth="6" />
    </>
  ),
  error: (
    <>
      <circle cx="120" cy="100" r="80" fill="var(--color-danger-soft)" />
      <path d="M120 60 L120 120" stroke="var(--color-danger)" strokeWidth="8" />
      <circle cx="120" cy="140" r="6" fill="var(--color-danger)" />
    </>
  ),
  success: (
    <>
      <circle cx="120" cy="100" r="80" fill="var(--color-success-soft)" />
      <path d="M80 100 L110 130 L160 70" stroke="var(--color-success)" strokeWidth="8" fill="none" />
    </>
  ),
  search: (
    <>
      <circle cx="120" cy="100" r="80" fill="var(--color-brand-soft)" />
      <circle cx="120" cy="100" r="40" stroke="var(--color-brand)" strokeWidth="8" fill="none" />
      <line x1="150" y1="130" x2="180" y2="160" stroke="var(--color-brand)" strokeWidth="8" />
    </>
  )
}

export const Illustration = forwardRef<SVGSVGElement, IllustrationProps>(function Illustration(
  { variant, className, ...props },
  ref
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 240 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      {illustrations[variant]}
    </svg>
  )
})
