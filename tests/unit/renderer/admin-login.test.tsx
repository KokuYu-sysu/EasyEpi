import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminLoginPage } from '@renderer/pages/AdminLoginPage'

function renderLogin() {
  const router = createMemoryRouter([
    {
      path: '/admin/login',
      handle: { title: '管理员验证', description: '验证当前项目密码' },
      element: <AdminLoginPage />
    },
    { path: '/admin/data', element: <h1>数据管理目标页</h1> },
    { path: '/', element: <h1>欢迎页</h1> }
  ], { initialEntries: ['/admin/login'] })
  render(<RouterProvider router={router} />)
  return router
}

describe('AdminLoginPage', () => {
  const login = vi.fn()
  const checkSession = vi.fn()

  beforeEach(() => {
    login.mockReset()
    checkSession.mockReset().mockResolvedValue({ isAuthenticated: false })
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: { admin: { login, checkSession } }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('uses the current project password and routes successful authentication to data', async () => {
    const user = userEvent.setup()
    login.mockResolvedValue({ success: true, expiresAt: Date.now() + 1000 })
    const router = renderLogin()
    expect(screen.queryByText(/admin123/)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('当前项目密码'), 'project-password')
    await user.click(screen.getByRole('button', { name: '登录管理后台' }))

    expect(login).toHaveBeenCalledWith({ password: 'project-password' })
    expect(await screen.findByRole('heading', { name: '数据管理目标页' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/data')
  })

  it('renders server-owned lockout state without counting attempts in the renderer', async () => {
    const user = userEvent.setup()
    login.mockResolvedValue({
      success: false,
      error: 'ADMIN_LOGIN_LOCKED',
      lockoutUntil: Date.now() + 60_000
    })
    renderLogin()
    await user.type(screen.getByLabelText('当前项目密码'), 'wrong')
    await user.click(screen.getByRole('button', { name: '登录管理后台' }))

    expect(screen.getByRole('alert')).toHaveTextContent('密码错误次数过多')
    expect(screen.getByRole('status')).toHaveTextContent(/秒后重试/)
    expect(screen.getByLabelText('当前项目密码')).toBeDisabled()
  })

  it('redirects an existing active session without asking for the password again', async () => {
    checkSession.mockResolvedValue({ isAuthenticated: true, expiresAt: Date.now() + 1000 })
    renderLogin()
    expect(await screen.findByRole('heading', { name: '数据管理目标页' })).toBeVisible()
    expect(login).not.toHaveBeenCalled()
  })

  it('explains that an opened unlocked project is required', async () => {
    const user = userEvent.setup()
    login.mockResolvedValue({ success: false, error: 'PROJECT_NOT_UNLOCKED' })
    renderLogin()
    await user.type(screen.getByLabelText('当前项目密码'), 'password')
    await user.click(screen.getByRole('button', { name: '登录管理后台' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请先在欢迎页创建或打开并解锁一个项目')
  })
})
