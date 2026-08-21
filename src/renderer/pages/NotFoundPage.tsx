import { Link } from 'react-router-dom'

import { EmptyState } from '@renderer/components/ui'

export function NotFoundPage() {
  return (
    <div className="mx-auto grid min-h-full max-w-3xl place-items-center p-[var(--space-5)]">
      <EmptyState
        headingLevel={1}
        title="页面未找到"
        description="这个地址不在当前 EasyEpi 版本中，可能已移动或尚未开放。"
        illustration="search"
        action={
          <Link
            className="inline-flex min-h-11 items-center rounded-[var(--radius-1)] bg-[var(--color-brand)] px-[var(--space-4)] text-[var(--color-on-brand)]"
            to="/"
          >
            返回欢迎页
          </Link>
        }
      />
    </div>
  )
}
