import { EmptyState } from '@renderer/components/ui'
import { MilestonePage } from '@renderer/components/common/MilestonePage'

export interface RoutePlaceholderPageProps {
  title: string
  description: string
}

export function RoutePlaceholderPage({ title, description }: RoutePlaceholderPageProps) {
  return (
    <MilestonePage title={title} description={description}>
      <EmptyState
        title="演示骨架，后续任务替换"
        description="此路由已接入统一应用框架；完整的内存交互将在本里程碑后续任务中实现。"
      />
    </MilestonePage>
  )
}
