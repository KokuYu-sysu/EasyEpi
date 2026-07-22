import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ComponentGalleryPage } from '@renderer/pages/ComponentGalleryPage'
import { ToastProvider } from '@renderer/components/ui'

test('documents all fourteen components and required gallery states', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <ToastProvider>
      <ComponentGalleryPage />
    </ToastProvider>
  )

  for (const name of [
    'Button', 'Input', 'Textarea', 'Select', 'Checkbox', 'Radio', 'Modal',
    'ConfirmDialog', 'Toast', 'Progress', 'EmptyState', 'Skeleton', 'Badge', 'Tooltip'
  ]) {
    expect(screen.getByText(new RegExp(name))).toBeVisible()
  }
  expect(screen.getByText(/仅开发环境/)).toBeVisible()
  expect(container.querySelectorAll('[data-theme][data-font-scale]')).toHaveLength(4)
  expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '正在加载很长的中文操作' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: '禁用选择器' })).toBeDisabled()
  expect(screen.getAllByRole('alert')).toHaveLength(2)

  await user.click(screen.getByRole('button', { name: '显示danger通知' }))
  expect(screen.getByText('danger 通知')).toBeVisible()
})
