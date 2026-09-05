import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'

import { AppShell, NAVIGATION_ITEMS } from '@renderer/app/AppShell'
import { ToastProvider } from '@renderer/components/ui'
import {
  createPreferencesStore,
  PreferencesProvider,
  type PreferencesAppearance
} from '@renderer/stores/preferences-store'
import { DEFAULT_PREFERENCES, type PreferencesV1 } from '@shared/preferences-contract'

function renderShell(
  path = '/entry',
  currentTitle = '录入页元数据标题',
  aiConfig = { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null as string | null }
) {
  const configUpdate = vi.fn()
  Object.defineProperty(window, 'easyEpi', {
    configurable: true,
    value: {
      admin: {
        checkSession: vi.fn().mockResolvedValue({
          isAuthenticated: true,
          expiresAt: Date.now() + 30 * 60 * 1000
        })
      },
      project: {
        onClosed: vi.fn(() => () => undefined)
      },
      ai: {
        config: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            config: aiConfig
          }),
          update: configUpdate,
          clear: vi.fn(),
          testConnection: vi.fn()
        }
      }
    }
  })
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
  return { store, update, configUpdate }
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
    const backup = screen.getByRole('button', { name: '项目备份与恢复' })
    expect(
      skip.compareDocumentPosition(firstNavigation) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      firstNavigation.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      theme.compareDocumentPosition(backup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('persists sidebar, theme, large-text, and settings choices through the store', async () => {
    const user = userEvent.setup()
    const { store, update, configUpdate } = renderShell()
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
    expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
    await user.click(screen.getByRole('radio', { name: '深色' }))
    expect(screen.getByRole('radio', { name: '深色' })).toBeChecked()
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }))
    )

    let resolveConfigUpdate!: (value: {
      ok: true
      config: { baseUrl: string; model: string; hasApiKey: boolean; maskedApiKey: string }
    }) => void
    configUpdate.mockReturnValue(new Promise((resolve) => { resolveConfigUpdate = resolve }))
    await user.type(screen.getByRole('textbox', { name: 'Base URL' }), 'https://example.test/v1')
    await user.type(screen.getByRole('textbox', { name: '模型名称' }), 'model-a')
    await user.type(screen.getByLabelText('API Key'), 'secret-value')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('textbox', { name: 'Base URL' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '模型名称' })).toBeDisabled()
    expect(screen.getByLabelText('API Key')).toBeDisabled()
    resolveConfigUpdate({
      ok: true,
      config: {
        baseUrl: 'https://example.test/v1',
        model: 'model-a',
        hasApiKey: true,
        maskedApiKey: '••••••••'
      }
    })
    expect(await screen.findByText('AI 服务配置已保存。')).toBeVisible()
  })

  it('requires a fresh API key after the provider URL changes', async () => {
    const user = userEvent.setup()
    const { configUpdate } = renderShell('/entry', '录入页元数据标题', {
      baseUrl: 'https://first.example/v1',
      model: 'model-a',
      hasApiKey: true,
      maskedApiKey: '••••••••'
    })
    configUpdate.mockResolvedValue({
      ok: true,
      config: {
        baseUrl: 'https://second.example/v1',
        model: 'model-a',
        hasApiKey: false,
        maskedApiKey: null
      }
    })

    await user.click(screen.getByRole('button', { name: '打开设置' }))
    const baseUrl = await screen.findByRole('textbox', { name: 'Base URL' })
    await user.clear(baseUrl)
    await user.type(baseUrl, 'https://second.example/v1')

    expect(screen.getByText('服务地址变化后需重新输入 API Key')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(configUpdate).toHaveBeenCalledWith({
      baseUrl: 'https://second.example/v1',
      model: 'model-a'
    }))
    expect(await screen.findByText('未配置 API Key。')).toBeVisible()
  })

  it('keeps all destinations in a labelled compact navigation menu', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: '打开导航菜单' }))
    const menu = screen.getByRole('navigation', { name: '紧凑导航' })
    expect(menu).toBeVisible()
    expect(menu.querySelectorAll('a')).toHaveLength(9)
    expect(screen.queryByRole('link', { name: '工作循环' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: '问卷录入' })).toHaveAttribute('href', '/entry')
  })

  it('shows supplemental compact-navigation help on keyboard focus', async () => {
    renderShell()
    const trigger = screen.getByRole('button', { name: '打开导航菜单' })

    fireEvent.focus(trigger)

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '打开导航菜单，显示全部9个页面入口'
    )
  })

  it('keeps compact-navigation help synchronized with the visible links', async () => {
    const user = userEvent.setup()
    NAVIGATION_ITEMS.push({
      path: '/navigation-count-fixture',
      title: '导航数量测试',
      description: '验证动态数量',
      icon: null
    })

    try {
      renderShell()
      const trigger = screen.getByRole('button', { name: '打开导航菜单' })
      await user.hover(trigger)
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        '打开导航菜单，显示全部10个页面入口'
      )

      await user.click(trigger)
      expect(
        screen.getByRole('navigation', { name: '紧凑导航' }).querySelectorAll('a')
      ).toHaveLength(10)
    } finally {
      NAVIGATION_ITEMS.pop()
    }
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
