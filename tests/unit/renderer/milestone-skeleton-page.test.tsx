import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { MilestoneSkeletonPage } from '@renderer/components/common/MilestoneSkeletonPage'

function renderPage(
  handle: { title: string; description?: string },
  props: Partial<ComponentProps<typeof MilestoneSkeletonPage>> = {}
) {
  const router = createMemoryRouter([{
    path: '/',
    handle,
    element: (
      <MilestoneSkeletonPage
        capability="批量核查"
        detail="支持规则配置和结果导出。"
        milestone="M9"
        skeletonTitle="核查能力建设中"
        {...props}
      />
    )
  }])
  render(<RouterProvider router={router} />)
  return router
}

describe('MilestoneSkeletonPage', () => {
  it('uses route title, capability fallback, and default return destination', () => {
    const router = renderPage({ title: '质量核查' })

    expect(screen.getByRole('heading', { level: 1, name: '质量核查' })).toBeVisible()
    expect(screen.getByText('批量核查')).toBeVisible()
    expect(screen.getByRole('link', { name: '返回欢迎页' })).toHaveAttribute('href', '/')
    router.dispose()
  })

  it('uses route description and custom return action, and opens milestone details', async () => {
    const user = userEvent.setup()
    const router = renderPage(
      { title: '质量核查', description: '面向管理员的数据核查。' },
      { returnLabel: '返回数据页', returnTo: '/admin/data' }
    )

    expect(screen.getByText('面向管理员的数据核查。')).toBeVisible()
    expect(screen.getByRole('link', { name: '返回数据页' })).toHaveAttribute('href', '/admin/data')
    await user.click(screen.getByRole('button', { name: '了解后续能力' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('M9 后续能力说明')
    expect(screen.getByRole('dialog')).toHaveTextContent('当前页面仅用于确认信息结构和安全返回路径')
    router.dispose()
  })
})
