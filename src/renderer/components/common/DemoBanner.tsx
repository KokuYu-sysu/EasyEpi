import { Badge } from '@renderer/components/ui'

export interface DemoBannerProps {
  children?: React.ReactNode
}

export function DemoBanner({ children = '演示模式：内容仅保存在当前内存中，关闭或刷新后会重置。' }: DemoBannerProps) {
  return (
    <aside
      aria-label="演示说明"
      className="flex flex-wrap items-center gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-[var(--space-3)]"
    >
      <Badge variant="warning">演示</Badge>
      <p className="m-0">{children}</p>
    </aside>
  )
}
