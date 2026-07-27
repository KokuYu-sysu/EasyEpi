import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminDashboard } from '@renderer/pages/AdminDashboard'

const questionnaire = {
  name: 'study',
  conditionRules: [],
  keyQuestionIds: [],
  questions: [{
    id: 'q-name', variableName: 'name', content: '姓名', type: 'free_text' as const,
    options: [], constraint: { type: 'none' as const }, isKey: false, allowSkip: false, order: 0
  }]
}

function renderDashboard() {
  const router = createMemoryRouter([
    { path: '/admin/data', handle: { title: '数据管理', description: '管理加密记录' }, element: <AdminDashboard /> },
    { path: '/admin/login', element: <h1>管理员登录目标页</h1> },
    { path: '/admin/baseline', element: <h1>基线表目标页</h1> }
  ], { initialEntries: ['/admin/data'] })
  render(<RouterProvider router={router} />)
  return router
}

describe('AdminDashboard', () => {
  const getRecords = vi.fn()
  const updateRecord = vi.fn()
  const deleteRecords = vi.fn()
  const changePassword = vi.fn()
  const logout = vi.fn()

  beforeEach(() => {
    getRecords.mockReset().mockResolvedValue({
      records: [{ id: 'r1', answers: { 'q-name': '张三' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      total: 1, page: 1, pageSize: 50, totalPages: 1
    })
    updateRecord.mockReset().mockResolvedValue({ ok: true })
    deleteRecords.mockReset().mockResolvedValue({ ok: true })
    changePassword.mockReset().mockResolvedValue({ success: true })
    logout.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        admin: {
          checkSession: vi.fn().mockResolvedValue({ isAuthenticated: true }),
          getRecords, updateRecord, deleteRecords, changePassword, logout
        },
        qnaire: { getData: vi.fn().mockResolvedValue(questionnaire) },
        dialog: { selectFolder: vi.fn() },
        exportData: { csv: vi.fn() }
      }
    })
  })

  afterEach(() => Reflect.deleteProperty(window, 'easyEpi'))

  it('loads real records and writes edits through the administrator API', async () => {
    const user = userEvent.setup()
    renderDashboard()
    expect(await screen.findByText('张三')).toBeVisible()
    expect(getRecords).toHaveBeenCalledWith({ page: 1, pageSize: 50 })

    await user.click(screen.getByRole('button', { name: '编辑' }))
    const dialog = screen.getByRole('dialog', { name: '编辑调查记录' })
    const name = within(dialog).getByLabelText('姓名 (name)')
    await user.clear(name)
    await user.type(name, '李四')
    await user.click(within(dialog).getByRole('button', { name: '保存到加密文件' }))
    expect(updateRecord).toHaveBeenCalledWith({ id: 'r1', data: { answers: { 'q-name': '李四' } } })
  })

  it('changes the password after confirmation and reports successful re-encryption', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('张三')
    await user.click(screen.getByRole('tab', { name: '设置' }))
    await user.type(screen.getByLabelText('当前项目密码'), 'old-password')
    await user.type(screen.getByLabelText('新项目密码'), 'new-password')
    await user.type(screen.getByLabelText('确认新项目密码'), 'new-password')
    await user.click(screen.getByRole('button', { name: '重新加密并修改密码' }))
    expect(changePassword).toHaveBeenCalledWith({ oldPassword: 'old-password', newPassword: 'new-password' })
    expect(await screen.findByRole('status')).toHaveTextContent('项目与数据文件已使用新密码重新加密')
  })

  it('redirects to login when no active administrator session exists', async () => {
    window.easyEpi.admin.checkSession = vi.fn().mockResolvedValue({ isAuthenticated: false })
    const router = renderDashboard()
    expect(await screen.findByRole('heading', { name: '管理员登录目标页' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/login')
    expect(getRecords).not.toHaveBeenCalled()
  })

  it('searches, sorts, selects, deletes, navigates, and logs out through real callbacks', async () => {
    const user = userEvent.setup()
    const router = renderDashboard()
    await screen.findByText('张三')

    await user.type(screen.getByLabelText('搜索记录'), '张三')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    expect(await vi.waitFor(() => getRecords.mock.calls.some(([request]) => request.search === '张三'))).toBe(true)
    await user.click(screen.getByRole('button', { name: '记录 ID' }))
    expect(await vi.waitFor(() => getRecords.mock.calls.some(([request]) => request.sortBy === '@record:id' && request.sortOrder === 'asc'))).toBe(true)

    await user.click(screen.getByLabelText('选择记录 r1'))
    await user.click(screen.getByRole('button', { name: /删除选中的 1 条记录/ }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认批量删除' }))
    expect(deleteRecords).toHaveBeenCalledWith({ ids: ['r1'] })

    await user.click(screen.getByRole('tab', { name: '基线表' }))
    await user.click(screen.getByRole('button', { name: '打开基线表生成器' }))
    expect(router.state.location.pathname).toBe('/admin/baseline')
  })

  it('validates password confirmation and maps password-service failures', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('张三')
    await user.click(screen.getByRole('tab', { name: '设置' }))

    await user.type(screen.getByLabelText('当前项目密码'), 'old')
    await user.type(screen.getByLabelText('新项目密码'), 'short')
    await user.type(screen.getByLabelText('确认新项目密码'), 'short')
    await user.click(screen.getByRole('button', { name: '重新加密并修改密码' }))
    expect(screen.getByRole('status')).toHaveTextContent('至少需要 8 个字符')
    expect(changePassword).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('新项目密码'))
    await user.clear(screen.getByLabelText('确认新项目密码'))
    await user.type(screen.getByLabelText('新项目密码'), 'new-password')
    await user.type(screen.getByLabelText('确认新项目密码'), 'different-password')
    await user.click(screen.getByRole('button', { name: '重新加密并修改密码' }))
    expect(screen.getByRole('status')).toHaveTextContent('两次输入的新密码不一致')

    await user.clear(screen.getByLabelText('确认新项目密码'))
    await user.type(screen.getByLabelText('确认新项目密码'), 'new-password')
    changePassword.mockResolvedValueOnce({ success: false, error: 'INVALID_OLD_PASSWORD' })
    await user.click(screen.getByRole('button', { name: '重新加密并修改密码' }))
    expect(await screen.findByRole('status')).toHaveTextContent('当前项目密码不正确')
  })

  it('logs out and redirects to the login route', async () => {
    const user = userEvent.setup()
    const router = renderDashboard()
    await screen.findByText('张三')
    await user.click(screen.getByRole('button', { name: '退出管理后台' }))
    expect(logout).toHaveBeenCalledOnce()
    expect(router.state.location.pathname).toBe('/admin/login')
  })

  it('redirects to login when an edit observes an expired session', async () => {
    const user = userEvent.setup()
    updateRecord.mockRejectedValueOnce(new Error('ADMIN_SESSION_REQUIRED'))
    const router = renderDashboard()
    await screen.findByText('张三')
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存到加密文件' }))
    expect(await screen.findByRole('heading', { name: '管理员登录目标页' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/login')
  })

  it('keeps record identity separate from a questionnaire variable named id', async () => {
    const user = userEvent.setup()
    window.easyEpi.qnaire.getData = vi.fn().mockResolvedValue({
      ...questionnaire,
      questions: [{
        ...questionnaire.questions[0]!,
        id: 'q-id',
        variableName: 'id',
        content: '外部编号'
      }]
    })
    getRecords.mockResolvedValueOnce({
      records: [{ id: 'record-uuid', answers: { 'q-id': 'external-id' }, createdAt: '', updatedAt: '' }],
      total: 1, page: 1, pageSize: 50, totalPages: 1
    })
    renderDashboard()
    expect(await screen.findByText('external-id')).toBeVisible()
    expect(screen.getByText('record-uuid')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存到加密文件' }))
    expect(updateRecord).toHaveBeenCalledWith({
      id: 'record-uuid',
      data: { answers: { 'q-id': 'external-id' } }
    })
  })

  it('normalizes numeric, multiple-choice, and empty answers and maps edit failures', async () => {
    const user = userEvent.setup()
    const extended = {
      ...questionnaire,
      questions: [
        questionnaire.questions[0]!,
        { id: 'q-age', variableName: 'age', content: '年龄', type: 'numeric_range' as const, options: [], constraint: { type: 'integer' as const }, isKey: false, allowSkip: true, order: 1 },
        { id: 'q-tags', variableName: 'tags', content: '标签', type: 'multiple_choice' as const, options: [], constraint: { type: 'none' as const }, isKey: false, allowSkip: true, order: 2 }
      ]
    }
    window.easyEpi.qnaire.getData = vi.fn().mockResolvedValue(extended)
    getRecords.mockResolvedValue({
      records: [{ id: 'r1', answers: { 'q-name': null, 'q-age': 20, 'q-tags': ['a', 'b'] }, createdAt: '', updatedAt: '' }],
      total: 1, page: 1, pageSize: 50, totalPages: 1
    })
    renderDashboard()
    await screen.findByText('a, b')
    await user.click(screen.getByRole('button', { name: '编辑' }))
    const dialog = screen.getByRole('dialog', { name: '编辑调查记录' })
    await user.clear(within(dialog).getByLabelText('年龄 (age)'))
    await user.clear(within(dialog).getByLabelText('标签 (tags)'))
    await user.type(within(dialog).getByLabelText('标签 (tags)'), 'c, d')
    await user.click(within(dialog).getByRole('button', { name: '保存到加密文件' }))
    expect(updateRecord).toHaveBeenCalledWith({
      id: 'r1',
      data: { answers: { 'q-name': null, 'q-age': null, 'q-tags': ['c', 'd'] } }
    })

    updateRecord.mockRejectedValueOnce(new Error('KEY_DUPLICATE'))
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存到加密文件' }))
    expect(await screen.findByRole('status')).toHaveTextContent('关键字段与现有记录重复')
  })

  it('covers export display, cleared search, session expiry, and remaining password errors', async () => {
    const user = userEvent.setup()
    const router = renderDashboard()
    await screen.findByText('张三')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    expect(await vi.waitFor(() => getRecords.mock.calls.some(([request]) => !('search' in request)))).toBe(true)
    await user.click(screen.getByRole('tab', { name: '导出' }))
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeVisible()

    await user.click(screen.getByRole('tab', { name: '设置' }))
    await user.type(screen.getByLabelText('当前项目密码'), 'old-password')
    await user.type(screen.getByLabelText('新项目密码'), 'new-password')
    await user.type(screen.getByLabelText('确认新项目密码'), 'new-password')
    for (const [code, expected] of [
      ['PASSWORD_UNCHANGED', '不能与当前密码相同'],
      ['WEAK_NEW_PASSWORD', '至少需要 8 个字符'],
      ['PASSWORD_CHANGE_FAILED', '原文件未被替换']
    ] as const) {
      changePassword.mockResolvedValueOnce({ success: false, error: code })
      await user.click(screen.getByRole('button', { name: '重新加密并修改密码' }))
      expect(await screen.findByRole('status')).toHaveTextContent(expected)
    }

    getRecords.mockRejectedValueOnce(new Error('ADMIN_SESSION_REQUIRED'))
    await user.click(screen.getByRole('tab', { name: '数据表格' }))
    await user.click(screen.getByRole('button', { name: '记录 ID' }))
    expect(await screen.findByRole('heading', { name: '管理员登录目标页' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/login')
  })
})
