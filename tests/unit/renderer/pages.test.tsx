import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isValidElement } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { vi } from 'vitest'

import { createAppRoutes } from '@renderer/app/routes'
import { AdminLoginPage } from '@renderer/pages/AdminLoginPage'
import { ImportPage } from '@renderer/pages/ImportPage'
import { WelcomePage } from '@renderer/pages/WelcomePage'
import { ToastProvider } from '@renderer/components/ui'

function renderRoute(routes: RouteObject[], initialEntry = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
  return router
}

describe('welcome page', () => {
  const welcomeHandle = {
    title: '欢迎页',
    description: '选择项目并开始现场调查。'
  }

  beforeEach(() => {
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        system: { ping: vi.fn() },
        preferences: { get: vi.fn(), update: vi.fn() },
        dialog: {
          selectFolder: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
          selectFile: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
        },
        project: { create: vi.fn(), open: vi.fn(), save: vi.fn(), close: vi.fn() },
        qnaire: {
          getData: vi.fn(),
          addQuestion: vi.fn(),
          updateQuestion: vi.fn(),
          deleteQuestion: vi.fn(),
          reorderQuestions: vi.fn(),
          addConditionRule: vi.fn(),
          updateConditionRule: vi.fn(),
          deleteConditionRule: vi.fn(),
          updateMeta: vi.fn()
        }
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('describes the offline product and exposes truthful project actions', () => {
    renderRoute([{ path: '/', handle: welcomeHandle, element: <WelcomePage /> }])

    expect(screen.getByRole('heading', { level: 1, name: '欢迎页' })).toBeVisible()
    expect(screen.getAllByText(/离线/).length).toBeGreaterThan(0)
    expect(screen.getByText(/现场调查和问卷信息收集/)).toBeVisible()
    expect(screen.getByRole('button', { name: '新建项目' })).toBeVisible()
    expect(screen.getByRole('button', { name: '打开项目' })).toBeVisible()
    expect(screen.getByText(/暂无最近项目/)).toBeVisible()
  })

  it('provides keyboard-reachable routes into the three main pages', async () => {
    const user = userEvent.setup()
    const router = renderRoute([
      { path: '/', handle: welcomeHandle, element: <WelcomePage /> },
      { path: '/designer', element: <h1>设计器目标页</h1> },
      { path: '/entry', element: <h1>录入目标页</h1> },
      { path: '/admin/data', element: <h1>数据管理目标页</h1> }
    ])

    expect(screen.getByRole('link', { name: '开始问卷设计' })).toHaveAttribute('href', '/designer')
    expect(screen.getByRole('link', { name: '进入录入' })).toHaveAttribute('href', '/entry')
    expect(screen.getByRole('link', { name: '数据管理' })).toHaveAttribute('href', '/admin/data')

    await user.click(screen.getByRole('link', { name: '开始问卷设计' }))
    expect(await screen.findByRole('heading', { name: '设计器目标页' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/designer')
  })
})

describe('standard milestone pages', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        admin: {
          checkSession: vi.fn().mockResolvedValue({ isAuthenticated: false }),
          login: vi.fn()
        },
        qnaire: {
          getData: vi.fn().mockResolvedValue({ name: '', questions: [], conditionRules: [], keyQuestionIds: [] })
        }
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('renders the completed EpiData import page without placeholder claims', () => {
    renderRoute(
      [{ path: '/import', handle: { title: 'EpiData 导入', description: '导入数据' }, element: <ImportPage /> }],
      '/import'
    )

    expect(screen.getByRole('heading', { level: 1, name: 'EpiData 导入' })).toBeVisible()
    expect(screen.getByRole('button', { name: '选择文件' })).toBeVisible()
    expect(screen.queryByText(/尚未实现|演示界面|不会保存/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('演示说明')).not.toBeInTheDocument()
  })

  it('does not impersonate authentication on the administrator skeleton', () => {
    renderRoute(
      [
        {
          path: '/admin/login',
          handle: { title: '管理员验证', description: '了解后续安全管理入口。' },
          element: <AdminLoginPage />
        }
      ],
      '/admin/login'
    )

    expect(screen.getByLabelText(/密码/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument()
  })

  it('keeps all completed M2 pages off placeholder metadata', () => {
    const childRoutes = createAppRoutes({ isDevelopment: false })[0]?.children ?? []
    const realPaths = [
      '/',
      '/designer',
      '/import',
      '/entry',
      '/work-session',
      '/admin/login',
      '/admin/data',
      '/admin/baseline',
      '/admin/double-entry',
      '/derived'
    ]

    for (const path of realPaths) {
      const route = childRoutes.find((candidate) => candidate.path === path)
      expect(isValidElement(route?.element)).toBe(true)
      expect(route?.handle).not.toHaveProperty('placeholder')
    }
  })
})
