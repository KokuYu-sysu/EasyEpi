import { Link } from 'react-router-dom'

import { EmptyState } from '@renderer/components/ui'

export interface RouteErrorPageProps {
  error?: unknown
}

export function RouteErrorPage({ error }: RouteErrorPageProps) {
  return (
    <main
      data-route-error={error === undefined ? 'captured' : 'provided'}
      className="grid min-h-screen place-items-center p-[var(--space-5)]"
    >
      <EmptyState
        title="页面暂时无法显示"
        description="界面遇到错误。你可以返回欢迎页继续使用。"
        action={
          <Link
            className="inline-flex min-h-11 items-center rounded-[var(--radius-1)] bg-[var(--color-brand)] px-[var(--space-4)] text-[var(--color-on-brand)]"
            to="/"
          >
            返回欢迎页
          </Link>
        }
      />
    </main>
  )
}
