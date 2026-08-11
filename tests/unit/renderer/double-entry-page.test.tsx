import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { vi } from 'vitest'

import { ToastProvider } from '@renderer/components/ui'
import { DoubleEntryPage } from '@renderer/pages/DoubleEntryPage'

function renderRoute(routes: RouteObject[], initialEntry = '/admin/double-entry') {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
  return router
}

const route: RouteObject = {
  path: '/admin/double-entry',
  handle: { title: '双录入验证', description: '导入次录入 CSV 并与当前数据比对。' },
  element: <DoubleEntryPage />
}

const QUESTIONNAIRE = {
  name: 'study',
  questions: [
    { id: 'q-pid', content: '编号', variableName: 'pid', type: 'free_text', options: [], constraint: { type: 'none' }, isKey: true, allowSkip: false, order: 0 },
    { id: 'q-sex', content: '性别', variableName: 'sex', type: 'single_choice', options: [{ value: '1', label: '男' }, { value: '2', label: '女' }], constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 1 },
    { id: 'q-age', content: '年龄', variableName: 'age', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 2 }
  ],
  conditionRules: [],
  keyQuestionIds: ['q-pid'],
  derivedVariables: []
}

function createApi() {
  return {
    admin: {
      checkSession: vi.fn().mockResolvedValue({ isAuthenticated: true }),
      updateRecord: vi.fn().mockResolvedValue({ ok: true })
    },
    qnaire: { getData: vi.fn().mockResolvedValue(QUESTIONNAIRE) },
    dialog: {
      selectFile: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['C:/secondary.csv'] })
    },
    doubleEntry: {
      import: vi.fn().mockResolvedValue({
        ok: true,
        rowCount: 1,
        headers: ['pid', 'sex', 'age'],
        encoding: 'utf-8'
      }),
      compare: vi.fn().mockResolvedValue({
        ok: true,
        comparison: {
          secondaryFileName: 'secondary.csv',
          encoding: 'utf-8',
          primaryCount: 1,
          secondaryCount: 1,
          matchedIdentical: 0,
          matchedWithDiffs: 1,
          recordsOnlyInPrimary: 0,
          recordsOnlyInSecondary: 0,
          matched: [
            {
              keyValues: { pid: '001' },
              primaryRecordId: 'r1',
              diffs: [
                { variableName: 'sex', label: '性别', oldValue: '1', newValue: '女' },
                { variableName: 'age', label: '年龄', oldValue: '30', newValue: '31' }
              ]
            }
          ],
          onlyInPrimary: [],
          onlyInSecondary: []
        }
      })
    }
  }
}

describe('DoubleEntryPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: createApi()
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('redirects to login when the admin session is missing', async () => {
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        ...createApi(),
        admin: { checkSession: vi.fn().mockResolvedValue({ isAuthenticated: false }) }
      }
    })
    const router = renderRoute([route, { path: '/admin/login', element: <h1>登录</h1> }])
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/admin/login'))
  })

  it('imports a CSV and runs the comparison', async () => {
    const user = userEvent.setup()
    renderRoute([route])

    await user.click(await screen.findByRole('button', { name: '选择 CSV 文件' }))
    expect(await screen.findByText(/已导入 1 行/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: '开始比对' }))
    expect(await screen.findByText('存在差异')).toBeVisible()
    expect(screen.getByText('性别（sex）')).toBeVisible()
  })

  it('adopts a secondary value via admin.updateRecord', async () => {
    const api = createApi()
    Object.defineProperty(window, 'easyEpi', { configurable: true, value: api })
    const user = userEvent.setup()
    renderRoute([route])

    await user.click(await screen.findByRole('button', { name: '选择 CSV 文件' }))
    await user.click(screen.getByRole('button', { name: '开始比对' }))

    const adoptButtons = await screen.findAllByRole('button', { name: '采纳次值' })
    await user.click(adoptButtons[0]!)

    expect(api.admin.updateRecord).toHaveBeenCalledWith({
      id: 'r1',
      data: { answers: { sex: '2' } }
    })
  })
})
