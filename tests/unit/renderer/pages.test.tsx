import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isValidElement } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'

import { createAppRoutes } from '@renderer/app/routes'
import { AdminLoginPage } from '@renderer/pages/AdminLoginPage'
import { BaselinePage } from '@renderer/pages/BaselinePage'
import { DerivedPage } from '@renderer/pages/DerivedPage'
import { ImportPage } from '@renderer/pages/ImportPage'
import { WelcomePage } from '@renderer/pages/WelcomePage'
import { WorkSessionPage } from '@renderer/pages/WorkSessionPage'

function renderRoute(routes: RouteObject[], initialEntry = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  render(<RouterProvider router={router} />)
  return router
}

describe('welcome page', () => {
  const welcomeHandle = {
    title: '欢迎页',
    description: '选择项目并开始现场调查。'
  }

  it('describes the offline product and exposes truthful project actions', async () => {
    const user = userEvent.setup()
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const preferencesUpdate = vi.fn()
    Object.defineProperty(window, 'easyepi', {
      configurable: true,
      value: { preferences: { get: vi.fn(), update: preferencesUpdate } }
    })

    renderRoute([{ path: '/', handle: welcomeHandle, element: <WelcomePage /> }])

    expect(screen.getByRole('heading', { level: 1, name: '欢迎页' })).toBeVisible()
    expect(screen.getAllByText(/离线/).length).toBeGreaterThan(0)
    expect(screen.getByText(/现场调查和问卷信息收集/)).toBeVisible()
    expect(screen.getByRole('heading', { name: '社区健康调查（合成演示）' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '新建项目' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('M3')
    expect(screen.getByRole('dialog')).toHaveTextContent(/不会创建或保存真实项目/)
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: '打开项目' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('M3')
    expect(storageWrite).not.toHaveBeenCalled()
    expect(preferencesUpdate).not.toHaveBeenCalled()

    storageWrite.mockRestore()
  })

  it('provides keyboard-reachable routes into the three main demos', async () => {
    const user = userEvent.setup()
    const router = renderRoute([
      { path: '/', handle: welcomeHandle, element: <WelcomePage /> },
      { path: '/designer', element: <h1>设计器目标页</h1> },
      { path: '/entry', element: <h1>录入目标页</h1> },
      { path: '/admin/data', element: <h1>数据管理目标页</h1> }
    ])

    expect(screen.getByRole('link', { name: '开始问卷设计' })).toHaveAttribute('href', '/designer')
    expect(screen.getByRole('link', { name: '进入录入演示' })).toHaveAttribute('href', '/entry')
    expect(screen.getByRole('link', { name: '查看数据管理演示' })).toHaveAttribute('href', '/admin/data')

    await user.click(screen.getByRole('link', { name: /继续合成演示项目/ }))
    expect(await screen.findByRole('heading', { name: '设计器目标页' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/designer')
  })
})

describe('standard milestone pages', () => {
  const cases = [
    { path: '/import', title: 'EpiData 导入', milestone: 'M6', Page: ImportPage },
    { path: '/work-session', title: '工作循环', milestone: 'M4', Page: WorkSessionPage },
    { path: '/admin/login', title: '管理员验证', milestone: 'M5', Page: AdminLoginPage },
    { path: '/admin/baseline', title: '基线表', milestone: 'M5', Page: BaselinePage },
    { path: '/derived', title: '衍生变量', milestone: 'M7', Page: DerivedPage }
  ]

  it.each(cases)('renders shared milestone structure and safe recovery for $path', async ({ path, title, milestone, Page }) => {
    const user = userEvent.setup()
    renderRoute([{ path, handle: { title, description: `${title}页面说明` }, element: <Page /> }], path)

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeVisible()
    expect(screen.getByLabelText('演示说明')).toBeVisible()
    expect(screen.getByRole('heading', { level: 2 })).toBeVisible()
    expect(screen.getAllByText(new RegExp(milestone)).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /返回/ })).toHaveAttribute('href')

    await user.click(screen.getByRole('button', { name: /了解后续能力/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText(new RegExp(milestone)).length).toBeGreaterThan(0)
    expect(dialog).toHaveTextContent(/尚未实现/)
  })

  it('does not impersonate authentication on the administrator skeleton', () => {
    renderRoute([
      {
        path: '/admin/login',
        handle: { title: '管理员验证', description: '了解后续安全管理入口。' },
        element: <AdminLoginPage />
      }
    ], '/admin/login')

    expect(screen.queryByLabelText(/密码/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^(验证成功|已登录|默认密码)/)).not.toBeInTheDocument()
    expect(screen.getByText(/不执行真实认证/)).toBeVisible()
  })

  it('keeps the completed Task 9 and Task 10 pages off the remaining placeholders', () => {
    const childRoutes = createAppRoutes({ isDevelopment: false })[0]?.children ?? []
    const realPaths = ['/', '/designer', '/import', '/work-session', '/admin/login', '/admin/baseline', '/derived']
    const placeholderPaths = ['/entry', '/admin/data']

    for (const path of realPaths) {
      const route = childRoutes.find((candidate) => candidate.path === path)
      expect(isValidElement(route?.element)).toBe(true)
      expect(route?.handle).not.toHaveProperty('placeholder')
    }
    for (const path of placeholderPaths) {
      expect(childRoutes.find((route) => route.path === path)?.handle).toHaveProperty('placeholder')
    }
  })
})
