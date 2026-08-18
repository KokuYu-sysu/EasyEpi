import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] shadow-[var(--shadow-z1)] ${className}`}>
      {children}
    </div>
  )
}

interface CardHeaderProps {
  children: React.ReactNode
  className?: string
}

export function CardHeader({ children, className = '' }: CardHeaderProps) {
  return (
    <div className={`flex flex-col gap-[var(--space-1)] p-[var(--space-5)] ${className}`}>
      {children}
    </div>
  )
}

interface CardTitleProps {
  children: React.ReactNode
  className?: string
}

export function CardTitle({ children, className = '' }: CardTitleProps) {
  return (
    <h3 className={`m-0 text-[length:var(--font-size-xl)] font-[var(--font-weight-semibold)] leading-[var(--line-height-tight)] ${className}`}>
      {children}
    </h3>
  )
}

interface CardContentProps {
  children: React.ReactNode
  className?: string
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div className={`px-[var(--space-5)] pb-[var(--space-5)] ${className}`}>
      {children}
    </div>
  )
}