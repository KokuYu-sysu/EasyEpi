import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'

import { AppShell } from '@renderer/app/AppShell'
import { ToastProvider } from '@renderer/components/ui'
import {
  createPreferencesStore,
  PreferencesProvider,
  type PreferencesAppearance
} from '@renderer/stores/preferences-store'
import { DEFAULT_PREFERENCES, type PreferencesV1 } from '@shared/preferences-contract'

function renderShell(path = '/entry', currentTitle = '录入页元数据标题') {
  const update = vi.fn(async (preferences: PreferencesV1) => ({
    ok: true as const,
    preferences
  }))
  const appearance: PreferencesAppearance = {
    apply: vi.fn(),
    observeSystemTheme: () => () => undefined
  }
  const store = createPreferencesStore({
    api: {
      get: () => new Promise(() => undefined),
      update
    },
    appearance
  })
  store.setState({ status: 'ready', confirmed: DEFAULT_PREFERENCES, desired: DEFAULT_PREFERENCES })

  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [{ path, handle: { title: currentTitle }, element: <p>页面正文</p> }]
      }
    ],
    { initialEntries: [path] }
  )

  render(
    <PreferencesProvider store={store}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </PreferencesProvider>
  )
  return { store, update }
}

describe('AppShell', () => {
  it('shows product and current-page titles with a working skip link', () => {
    renderShell()
    expect(screen.getAllByText('EasyEpi').some((node) => node.textContent === 'EasyEpi')).toBe(true)
    expect(screen.getByText('录入页元数据标题')).toBeVisible()
    expect(screen.getByRole('link', { name: '跳到主内容' })).toHaveAttribute(
      'href',
      '#main-content'
    )
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
  })

  it('keeps keyboard order aligned with skip, navigation, and top-bar actions', () => {
    renderShell()
    const skip = screen.getByRole('link', { name: '跳到主内容' })
    const firstNavigation = screen.getByRole('link', { name: '欢迎页' })
    const theme = screen.getByRole('button', { name: /切换主题/ })
    expect(
      skip.compareDocumentPosition(firstNavigation) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      firstNavigation.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('persists sidebar, theme, large-text, and settings choices through the store', async () => {
    const user = userEvent.setup()
    const { store, update } = renderShell()
    await waitFor(() => expect(store.getState().status).toBe('ready'))

    await user.click(screen.getByRole('button', { name: '收起侧栏' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ sidebarCollapsed: true })
      )
    )
    expect(screen.getByRole('navigation', { name: '主要导航' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )

    await user.click(screen.getByRole('button', { name: /切换主题/ }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }))
    )
    await user.click(screen.getByRole('button', { name: /大字模式/ }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ largeText: true }))
    )

    await user.click(screen.getByRole('button', { name: '打开设置' }))
    expect(screen.getByRole('dialog', { name: '界面设置' })).toBeVisible()
    await user.click(screen.getByRole('radio', { name: '深色' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }))
    )
  })

  it('keeps all destinations in a labelled compact navigation menu', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: '打开导航菜单' }))
    const menu = screen.getByRole('navigation', { name: '紧凑导航' })
    expect(menu).toBeVisible()
    expect(menu.querySelectorAll('a')).toHaveLength(9)
  })

  it('uses one complementary breakpoint for desktop and compact navigation', () => {
    renderShell()
    expect(screen.getByRole('complementary')).toHaveClass(
      'hidden',
      'min-[1050px]:block'
    )
    expect(screen.getByRole('button', { name: '打开导航菜单' }).parentElement).toHaveClass(
      'min-[1050px]:hidden'
    )
  })

  it('renders one and only one global toast viewport', () => {
    renderShell()
    expect(screen.getAllByLabelText('通知')).toHaveLength(1)
  })
})
