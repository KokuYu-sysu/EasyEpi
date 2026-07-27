import type { ReactNode } from 'react'

import { DemoBanner } from './DemoBanner'
import { PageHeader } from './PageHeader'

export interface MilestonePageProps {
  title: string
  description: string
  children: ReactNode
  actions?: ReactNode
  demoMessage?: ReactNode
}

export function MilestonePage({
  title,
  description,
  children,
  actions,
  demoMessage
}: MilestonePageProps) {
  return (
    <div className="grid gap-[var(--space-5)]">
      <PageHeader title={title} description={description} actions={actions} />
      {demoMessage !== undefined ? <DemoBanner>{demoMessage}</DemoBanner> : null}
      {children}
    </div>
  )
}
