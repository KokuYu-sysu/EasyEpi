import React from 'react'

interface LabelProps {
  children: React.ReactNode
  htmlFor?: string
  className?: string
}

export function Label({ children, htmlFor, className = '' }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={`text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] leading-none text-[var(--color-text-primary)] peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className}`}
    >
      {children}
    </label>
  )
}