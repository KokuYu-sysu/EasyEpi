import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
}

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-muted)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="m-0 text-[length:var(--font-size-2xl)] leading-[var(--line-height-tight)]">
          {title}
        </h1>
        {description ? (
          <p className="mb-0 mt-[var(--space-2)] max-w-[70ch] text-[var(--color-text-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-[var(--space-2)]">{actions}</div> : null}
    </header>
  )
}
