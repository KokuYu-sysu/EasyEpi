import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaselinePage } from '@renderer/pages/BaselinePage'

describe('BaselinePage', () => {
  const generate = vi.fn()
  const exportTable = vi.fn()
  const selectFolder = vi.fn()

  beforeEach(() => {
    generate.mockReset().mockResolvedValue({
      headers: [{ key: 'total', label: '总体 (n=2)' }],
      rows: [{ variable: 'age', label: '年龄', total: '11.00 ± 1.41' }]
    })
    exportTable.mockReset().mockResolvedValue({ success: true, outputPath: 'D:\\out\\easyepi_baseline.csv', rowCount: 1 })
    selectFolder.mockReset().mockResolvedValue({ canceled: false, filePaths: ['D:\\out'] })
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        admin: { checkSession: vi.fn().mockResolvedValue({ isAuthenticated: true }) },
        qnaire: { getData: vi.fn().mockResolvedValue({
          name: 'study', conditionRules: [], keyQuestionIds: [], questions: [{
            id: 'age', variableName: 'age', content: '年龄', type: 'numeric_range',
            options: [], constraint: { type: 'integer' }, isKey: false, allowSkip: true, order: 0
          }]
        }) },
        baseline: { generate, export: exportTable },
        dialog: { selectFolder }
      }
    })
  })

  afterEach(() => Reflect.deleteProperty(window, 'easyEpi'))

  it('generates and previews main-process statistics instead of mock rows', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([{
      path: '/admin/baseline', handle: { title: '基线表', description: '统计' }, element: <BaselinePage />
    }], { initialEntries: ['/admin/baseline'] })
    render(<RouterProvider router={router} />)
    await user.click(await screen.findByRole('button', { name: '生成基线表' }))
    expect(generate).toHaveBeenCalledWith({ selectedQuestionIds: ['age'] })
    expect(await screen.findByText('11.00 ± 1.41')).toBeVisible()
    expect(screen.queryByText('45.3±12.1')).not.toBeInTheDocument()
  })

  it('passes manually selected statistical methods to the main process', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([{
      path: '/admin/baseline', handle: { title: '基线表', description: '统计' }, element: <BaselinePage />
    }], { initialEntries: ['/admin/baseline'] })
    render(<RouterProvider router={router} />)
    await user.click(await screen.findByRole('combobox', { name: '统计方法' }))
    await user.click(screen.getByRole('option', { name: '手动指定检验方法' }))
    await user.click(screen.getByRole('combobox', { name: '连续变量检验' }))
    await user.click(screen.getByRole('option', { name: '仅描述统计' }))
    await user.click(screen.getByRole('button', { name: '生成基线表' }))
    expect(generate).toHaveBeenCalledWith({
      selectedQuestionIds: ['age'],
      statisticalMethod: 'manual',
      continuousTest: 'none',
      categoricalTest: 'chi_square'
    })
  })

  it('exports a generated table and reports structured failure and thrown errors', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([{
      path: '/admin/baseline', handle: { title: '基线表', description: '统计' }, element: <BaselinePage />
    }], { initialEntries: ['/admin/baseline'] })
    render(<RouterProvider router={router} />)
    await user.click(await screen.findByRole('button', { name: '生成基线表' }))
    await user.click(screen.getByRole('button', { name: '导出 UTF-8 CSV' }))
    expect(exportTable).toHaveBeenCalledWith({
      selectedQuestionIds: ['age'],
      outputPath: 'D:\\out\\easyepi_baseline.csv'
    })
    expect(await screen.findByRole('status')).toHaveTextContent('基线表已导出')

    exportTable.mockResolvedValueOnce({ success: false, error: 'BASELINE_EXPORT_FAILED' })
    await user.click(screen.getByRole('button', { name: '导出 UTF-8 CSV' }))
    expect(await screen.findByRole('status')).toHaveTextContent('BASELINE_EXPORT_FAILED')

    exportTable.mockRejectedValueOnce(new Error('disk'))
    await user.click(screen.getByRole('button', { name: '导出 UTF-8 CSV' }))
    expect(await screen.findByRole('status')).toHaveTextContent('请检查目标目录')
  })

  it('validates selection, handles generation errors, and redirects unauthorized users', async () => {
    const user = userEvent.setup()
    const routes = [
      { path: '/admin/baseline', handle: { title: '基线表', description: '统计' }, element: <BaselinePage /> },
      { path: '/admin/login', element: <h1>登录目标页</h1> }
    ]
    const router = createMemoryRouter(routes, { initialEntries: ['/admin/baseline'] })
    const view = render(<RouterProvider router={router} />)
    const checkbox = await screen.findByRole('checkbox', { name: /年龄/ })
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: '生成基线表' }))
    expect(screen.getByRole('status')).toHaveTextContent('至少选择一个统计变量')

    await user.click(checkbox)
    generate.mockRejectedValueOnce(new Error('bad data'))
    await user.click(screen.getByRole('button', { name: '生成基线表' }))
    expect(await screen.findByRole('status')).toHaveTextContent('基线表生成失败')

    view.unmount()
    window.easyEpi.admin.checkSession = vi.fn().mockResolvedValue({ isAuthenticated: false })
    const unauthorized = createMemoryRouter(routes, { initialEntries: ['/admin/baseline'] })
    render(<RouterProvider router={unauthorized} />)
    expect(await screen.findByRole('heading', { name: '登录目标页' })).toBeVisible()
  })

  it('redirects when the administrator session expires during generation', async () => {
    const user = userEvent.setup()
    generate.mockRejectedValueOnce(new Error('ADMIN_SESSION_REQUIRED'))
    const router = createMemoryRouter([
      { path: '/admin/baseline', handle: { title: '基线表', description: '统计' }, element: <BaselinePage /> },
      { path: '/admin/login', element: <h1>登录目标页</h1> }
    ], { initialEntries: ['/admin/baseline'] })
    render(<RouterProvider router={router} />)
    await user.click(await screen.findByRole('button', { name: '生成基线表' }))
    expect(await screen.findByRole('heading', { name: '登录目标页' })).toBeVisible()
  })
})
