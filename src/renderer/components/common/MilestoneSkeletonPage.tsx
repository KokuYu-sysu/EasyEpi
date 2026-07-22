import { Link } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, EmptyState, Modal } from '@renderer/components/ui'

import { MilestonePage } from './MilestonePage'

export interface MilestoneSkeletonPageProps {
  capability: string
  detail: string
  milestone: `M${number}`
  returnLabel?: string
  returnTo?: string
  skeletonTitle: string
}

const linkClasses =
  'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-1)] border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-[var(--space-4)] py-[var(--space-2)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]'

export function MilestoneSkeletonPage({
  capability,
  detail,
  milestone,
  returnLabel = '返回欢迎页',
  returnTo = '/',
  skeletonTitle
}: MilestoneSkeletonPageProps) {
  const handle = useCurrentRouteHandle()
  if (handle === null) {
    throw new Error('MILESTONE_ROUTE_METADATA_MISSING')
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? capability}
      demoMessage={`演示骨架：本页不处理真实业务数据，完整能力将在 ${milestone} 实现。`}
    >
      <EmptyState
        title={skeletonTitle}
        description={`${capability} ${detail}`}
        action={
          <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
            <Modal
              trigger={<Button>了解后续能力</Button>}
              title={`${milestone} 后续能力说明`}
              description={`${capability} 尚未实现。`}
            >
              <p className="text-[var(--color-text-secondary)]">
                {detail} 当前页面仅用于确认信息结构和安全返回路径，不会保存、导入、认证或修改任何真实数据。
              </p>
            </Modal>
            <Link className={linkClasses} to={returnTo}>
              {returnLabel}
            </Link>
          </div>
        }
      />
    </MilestonePage>
  )
}
