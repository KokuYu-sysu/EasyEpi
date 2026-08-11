import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { vi } from 'vitest'

import { ToastProvider } from '@renderer/components/ui'
import { DerivedPage } from '@renderer/pages/DerivedPage'

function renderRoute(routes: RouteObject[], initialEntry = '/derived') {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
  return router
}

const route: RouteObject = {
  path: '/derived',
  handle: { title: '衍生变量', description: '配置由已有字段计算的变量。' },
  element: <DerivedPage />
}

const QUESTIONNAIRE = {
  name: '测试问卷',
  questions: [
    { id: 'q-age', content: '年龄', variableName: 'age', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 0 },
    { id: 'q-weight', content: '体重(kg)', variableName: 'weight', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 1 }
  ],
  conditionRules: [],
  keyQuestionIds: [],
  derivedVariables: []
}

function createApi(overrides: Record<string, unknown> = {}) {
  return {
    qnaire: {
      getData: vi.fn().mockResolvedValue(QUESTIONNAIRE)
    },
    derived: {
      getAll: vi.fn().mockResolvedValue({ ok: true, derivedVariables: [] }),
      validate: vi.fn().mockResolvedValue({ ok: true }),
      preview: vi.fn().mockResolvedValue({ ok: true, value: '24.2' }),
      add: vi.fn().mockResolvedValue({ ok: true, derivedVariables: [] }),
      update: vi.fn().mockResolvedValue({ ok: true, derivedVariables: [] }),
      delete: vi.fn().mockResolvedValue({ ok: true, derivedVariables: [] }),
      reorder: vi.fn().mockResolvedValue({ ok: true, derivedVariables: [] })
    },
    record: {
      list: vi.fn().mockResolvedValue({ ok: true, records: [], total: 0 })
    },
    project: {
      save: vi.fn().mockResolvedValue({ ok: true })
    },
    ...overrides
  }
}

describe('DerivedPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: createApi()
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('renders variable chips from the questionnaire', async () => {
    renderRoute([route])

    expect(await screen.findByRole('heading', { name: '衍生变量' })).toBeVisible()
    expect(screen.getByText('age')).toBeVisible()
    expect(screen.getByText('weight')).toBeVisible()
    expect(screen.getByText('暂无衍生变量')).toBeVisible()
  })

  it('adds a derived variable card and inserts a variable into the formula', async () => {
    const user = userEvent.setup()
    renderRoute([route])

    await user.click(await screen.findByRole('button', { name: '添加衍生变量' }))
    expect(screen.getByRole('heading', { name: '衍生变量 #1' })).toBeVisible()

    await user.click(screen.getByText('age'))
    expect(screen.getByText('{age}')).toBeInTheDocument()
  })

  it('persists via derived.add and project.save on save', async () => {
    const api = createApi()
    Object.defineProperty(window, 'easyEpi', { configurable: true, value: api })
    const user = userEvent.setup()
    renderRoute([route])

    await user.click(await screen.findByRole('button', { name: '添加衍生变量' }))
    await user.type(screen.getByLabelText('变量名'), 'bmi')
    await user.type(screen.getByLabelText('标签'), 'BMI')
    await user.click(screen.getByRole('button', { name: '高级（文本）' }))
    fireEvent.change(screen.getByLabelText('公式文本编辑'), { target: { value: '{weight} / 2' } })
    await user.click(screen.getByRole('button', { name: '保存并完成' }))

    expect(api.derived.add).toHaveBeenCalledTimes(1)
    expect(api.derived.add).toHaveBeenCalledWith({
      variableName: 'bmi',
      label: 'BMI',
      formula: '{weight} / 2',
      resultType: 'numeric'
    })
    expect(api.project.save).toHaveBeenCalledTimes(1)
  })

  it('reconciles server-assigned ids after save so a second save updates instead of re-adding', async () => {
    const add = vi.fn().mockResolvedValue({ ok: true, derivedVariables: [{ id: 'server-1', variableName: 'bmi' }] })
    const getAll = vi.fn()
      .mockResolvedValueOnce({ ok: true, derivedVariables: [] })
      .mockResolvedValue({ ok: true, derivedVariables: [{ id: 'server-1', variableName: 'bmi' }] })
    const update = vi.fn().mockResolvedValue({ ok: true, derivedVariables: [{ id: 'server-1', variableName: 'bmi' }] })
    const api = createApi({
      derived: {
        ...createApi().derived,
        add,
        getAll,
        update
      }
    })
    Object.defineProperty(window, 'easyEpi', { configurable: true, value: api })
    const user = userEvent.setup()
    renderRoute([route])

    await user.click(await screen.findByRole('button', { name: '添加衍生变量' }))
    await user.type(screen.getByLabelText('变量名'), 'bmi')
    await user.type(screen.getByLabelText('标签'), 'BMI')
    await user.click(screen.getByRole('button', { name: '高级（文本）' }))
    fireEvent.change(screen.getByLabelText('公式文本编辑'), { target: { value: '{weight} / 2' } })
    await user.click(screen.getByRole('button', { name: '保存并完成' }))
    expect(add).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '保存并完成' }))
    expect(add).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({ variableName: 'bmi', formula: '{weight} / 2' })
    )
  })

  it('shows a validation error when the formula references an unknown variable', async () => {
    const api = createApi({
      derived: {
        ...createApi().derived,
        validate: vi.fn().mockResolvedValue({
          ok: false,
          errors: [{ code: 'UNKNOWN_VARIABLE', message: '公式引用了不存在的变量 "nope"' }]
        })
      }
    })
    Object.defineProperty(window, 'easyEpi', { configurable: true, value: api })
    const user = userEvent.setup()
    renderRoute([route])

    await user.click(await screen.findByRole('button', { name: '添加衍生变量' }))
    await user.click(screen.getByRole('button', { name: '高级（文本）' }))
    fireEvent.change(screen.getByLabelText('公式文本编辑'), { target: { value: '{nope} + 1' } })

    await vi.waitFor(() => {
      expect(screen.getByText(/公式引用了不存在的变量 "nope"/)).toBeInTheDocument()
    })
  })

  it('navigates back to designer without saving', async () => {
    const api = createApi()
    Object.defineProperty(window, 'easyEpi', { configurable: true, value: api })
    const user = userEvent.setup()
    const router = renderRoute([route, { path: '/designer', element: <h1>设计器目标页</h1> }])

    await user.click(await screen.findByRole('button', { name: '返回设计' }))
    expect(router.state.location.pathname).toBe('/designer')
    expect(api.project.save).not.toHaveBeenCalled()
  })
})
