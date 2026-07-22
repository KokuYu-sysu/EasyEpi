import { StrictMode, isValidElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import { createAppRoutes } from '@renderer/app/routes'
import { ToastProvider } from '@renderer/components/ui'
import { EntryPage } from '@renderer/pages/EntryPage'
import { createEntryDemoStore } from '@renderer/stores/entry-demo-store'

function renderEntry(
  options: { strict?: boolean; store?: ReturnType<typeof createEntryDemoStore> } = {}
) {
  const router = createMemoryRouter(
    [
      {
        path: '/entry',
        handle: { title: '单题录入', description: '以一题一屏方式完成现场录入。' },
        element: <EntryPage store={options.store} />
      },
      { path: '/away', element: <p>另一真实页面</p> }
    ],
    { initialEntries: ['/entry'] }
  )
  const view = render(
    <ToastProvider>
      {options.strict ? (
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>
      ) : (
        <RouterProvider router={router} />
      )}
    </ToastProvider>
  )
  return { ...view, router }
}

describe('entry demo store', () => {
  it('validates required answers and preserves them while moving between questions', () => {
    const store = createEntryDemoStore()

    expect(store.getState().index).toBe(0)
    expect(store.getState().next()).toBe(false)
    expect(store.getState().index).toBe(0)
    expect(store.getState().validationError).toMatch(/必答/)

    store.getState().answer('visit', 'yes')
    expect(store.getState().validationError).toBeNull()
    expect(store.getState().next()).toBe(true)
    store.getState().answer('location', '东城区')
    store.getState().previous()
    expect(store.getState().answers).toEqual({ visit: 'yes', location: '东城区' })
    expect(store.getState().index).toBe(0)
  })

  it('marks only memory completion on the final question and supports reset', () => {
    const store = createEntryDemoStore()
    store.getState().answer('visit', 'no')
    store.getState().next()
    store.getState().answer('location', '朝阳区')

    expect(store.getState().next()).toBe(true)
    expect(store.getState().completed).toBe(true)
    expect(store.getState().answers.location).toBe('朝阳区')

    store.getState().reset()
    expect(store.getState()).toMatchObject({
      index: 0,
      answers: {},
      validationError: null,
      completed: false
    })
  })

  it('rejects radio values that are not one of the declared options', () => {
    const store = createEntryDemoStore()

    store.getState().answer('visit', 'forged-value')

    expect(store.getState().answers).toEqual({})
    expect(store.getState().next()).toBe(false)
    expect(store.getState().validationError).toMatch(/必答/)
  })
})

describe('single-question entry demo page', () => {
  it('shows exactly one question with numeric progress and keyboard guidance', () => {
    renderEntry()

    expect(screen.getByRole('heading', { level: 1, name: '单题录入' })).toBeVisible()
    expect(screen.getByText(/刷新或离开页面可能丢失答案/)).toBeVisible()
    expect(screen.getByText(/键盘/)).toBeVisible()
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemin', '0')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '2')
    expect(screen.getByText('1 / 2')).toBeVisible()
    expect(screen.getByRole('button', { name: '上一题' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '是' })).not.toHaveFocus()
  })

  it('renders injected question definitions from the store as the single source of truth', () => {
    const store = createEntryDemoStore([
      {
        id: 'custom-place',
        title: '自定义调查地点',
        required: true,
        type: 'text',
        hint: '自定义提示'
      }
    ])

    renderEntry({ store })

    expect(screen.getByRole('textbox', { name: /自定义调查地点/ })).toBeVisible()
    expect(screen.getByText('1 / 1')).toBeVisible()
    expect(screen.queryByText(/过去两周/)).not.toBeInTheDocument()
  })

  it('connects required errors to the radio group and clears them after answering', async () => {
    const user = userEvent.setup()
    renderEntry()

    await user.click(screen.getByRole('button', { name: '下一题' }))
    const error = screen.getByRole('alert')
    const group = screen.getByRole('radiogroup', { name: /过去两周/ })
    expect(error).toHaveTextContent(/必答/)
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAttribute('aria-describedby', expect.stringContaining(error.id))

    await user.click(screen.getByRole('radio', { name: '是' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(group).not.toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: '下一题' }))
    expect(screen.getByRole('textbox', { name: /调查地点/ })).toHaveFocus()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')

    await user.click(screen.getByRole('button', { name: '完成演示' }))
    const textInput = screen.getByRole('textbox', { name: /调查地点/ })
    const textError = screen.getByRole('alert')
    expect(textInput).toHaveAttribute('aria-invalid', 'true')
    expect(textInput).toHaveAttribute('aria-describedby', expect.stringContaining(textError.id))
  })

  it('retains radio and text answers across previous and next navigation', async () => {
    const user = userEvent.setup()
    renderEntry()

    await user.click(screen.getByRole('radio', { name: '否' }))
    await user.click(screen.getByRole('button', { name: '下一题' }))
    await user.type(screen.getByRole('textbox', { name: /调查地点/ }), '海淀区')
    await user.click(screen.getByRole('button', { name: '上一题' }))
    expect(screen.getByRole('radio', { name: '否' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: '下一题' }))
    expect(screen.getByRole('textbox', { name: /调查地点/ })).toHaveValue('海淀区')
  })

  it('completes truthfully without browser or desktop writes', async () => {
    const user = userEvent.setup()
    const originalEasyEpi = Object.getOwnPropertyDescriptor(window, 'easyEpi')
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const preferencesGet = vi.fn()
    const preferencesUpdate = vi.fn()
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: { preferences: { get: preferencesGet, update: preferencesUpdate } }
    })

    try {
      renderEntry()
      await user.click(screen.getByRole('radio', { name: '是' }))
      await user.click(screen.getByRole('button', { name: '下一题' }))
      await user.type(screen.getByRole('textbox', { name: /调查地点/ }), '西城区')
      await user.click(screen.getByRole('button', { name: '完成演示' }))

      expect(screen.getByRole('heading', { name: '演示完成' })).toBeVisible()
      expect(screen.getByRole('status', { name: '演示完成' })).toHaveFocus()
      expect(screen.getByText(/未提交.*未保存/)).toBeVisible()
      expect(screen.queryByText(/提交成功|保存成功/)).not.toBeInTheDocument()
      expect(storageWrite).not.toHaveBeenCalled()
      expect(preferencesGet).not.toHaveBeenCalled()
      expect(preferencesUpdate).not.toHaveBeenCalled()
    } finally {
      storageWrite.mockRestore()
      if (originalEasyEpi) Object.defineProperty(window, 'easyEpi', originalEasyEpi)
      else Reflect.deleteProperty(window, 'easyEpi')
    }
  })

  it('creates fresh page state after leaving and returning through the same router under StrictMode', async () => {
    const user = userEvent.setup()
    const view = renderEntry({ strict: true })
    await user.click(screen.getByRole('radio', { name: '是' }))
    await user.click(screen.getByRole('button', { name: '下一题' }))
    await user.type(screen.getByRole('textbox', { name: /调查地点/ }), '第一次会话')
    await act(async () => {
      await view.router.navigate('/away')
    })
    expect(screen.getByText('另一真实页面')).toBeVisible()
    await act(async () => {
      await view.router.navigate('/entry')
    })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByRole('radio', { name: '是' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '否' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '是' })).not.toHaveFocus()
    view.router.dispose()
  })

  it('returns from completion and restarts with focus at the active question', async () => {
    const user = userEvent.setup()
    renderEntry()
    await user.click(screen.getByRole('radio', { name: '否' }))
    await user.click(screen.getByRole('button', { name: '下一题' }))
    await user.type(screen.getByRole('textbox', { name: /调查地点/ }), '东城区')
    await user.click(screen.getByRole('button', { name: '完成演示' }))

    await user.click(screen.getByRole('button', { name: '返回上一题' }))
    expect(screen.getByRole('textbox', { name: /调查地点/ })).toHaveValue('东城区')
    expect(screen.getByRole('textbox', { name: /调查地点/ })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '完成演示' }))
    await user.click(screen.getByRole('button', { name: '重新开始' }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByRole('radio', { name: '是' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '是' })).toHaveFocus()
  })

  it('keeps entry and administration on final M2 pages', () => {
    const childRoutes = createAppRoutes({ isDevelopment: false })[0]?.children ?? []
    const entry = childRoutes.find((route) => route.path === '/entry')
    const adminData = childRoutes.find((route) => route.path === '/admin/data')

    expect(entry?.handle).not.toHaveProperty('placeholder')
    expect(adminData?.handle).not.toHaveProperty('placeholder')
    expect(isValidElement(entry?.element) && entry.element.type).toBe(EntryPage)
  })
})
